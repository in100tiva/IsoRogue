// ---------------------------------------------------------------------------
// Campo de visão — SHADOWCASTING RECURSIVO SIMÉTRICO (variante de Albert Ford).
//
// Porte literal de legacy/src-vanilla/20-fov.js. A simetria depende dos
// detalhes exatos (regras de arredondamento de slope, ordem da recursão,
// aritmética inteira): NÃO reescreva de forma "mais elegante".
//
// O mapa é varrido em 4 quadrantes (norte/leste/sul/oeste). Cada quadrante é
// percorrido linha a linha (row = distância ao longo do eixo principal) e cada
// linha é limitada por dois slopes racionais (start/end). Ao encontrar uma
// transição piso -> parede a varredura RECURSA para a linha seguinte com o
// slope final apertado; ao encontrar parede -> piso o slope inicial é apertado
// na própria linha. Não existe amostragem de raios (Bresenham/DDA) em lugar
// nenhum deste arquivo: nada parte da origem "andando" até o alvo.
//
// SIMETRIA: um tile de piso só é marcado visível quando o CENTRO dele está
// dentro do cone de luz (teste `isSymmetricCol`), e os limites de coluna de
// cada linha usam as regras de arredondamento simétricas round_ties_up /
// round_ties_down. Isso garante, para quaisquer dois tiles TRANSPARENTES
// (= caminháveis) A e B dentro do raio: vê(A -> B) <=> vê(B -> A).
//
// PAREDES: são marcadas sempre que caem na faixa de colunas da linha, mesmo
// que o centro delas fique fora do cone — isso é necessário para o renderizador
// desenhar as paredes que fecham a sala. Portanto a simetria NÃO vale (nem é
// exigida) para paredes: `checkSymmetry` avalia APENAS pares de tiles
// caminháveis, exatamente como manda o contrato (§4 do CONTRACTS.md).
//
// Slopes são frações de inteiros pequenos (num/den, den > 0) manipuladas por
// aritmética inteira — nada de acúmulo de erro de ponto flutuante.
// ---------------------------------------------------------------------------

import type { GameMap, Point } from './types.ts';
import { CONFIG } from './core.ts';

/** Resultado da sonda de simetria (tecla V). */
export interface SymmetryReport {
  tested: number;
  broken: Point[];
  ok: boolean;
}

const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

// Contexto da varredura corrente. Fica em escopo de módulo para que a recursão
// receba apenas números e não aloque objetos/closures por chamada.
let cTiles: Uint8Array | null = null;
let cW = 0;
let cH = 0;
let cWall = 0;
let cOx = 0;
let cOy = 0;
let cCard: number = NORTH;
let cMaxDepth = 0;
let cLim2 = 0; // (radius + 0.5)^2
let cOut: Set<number> | null = null;

// Sets reutilizados internamente (a API pública sempre devolve um Set).
const SCRATCH_VIS = new Set<number>();
const SCRATCH_SYM_A = new Set<number>();
const SCRATCH_SYM_B = new Set<number>();

function defaultRadius(): number {
  return CONFIG.FOV_RADIUS;
}

function wallValue(): number {
  return CONFIG.TILE.WALL;
}

// Duck typing em vez de `instanceof Set` — o Set pode vir de outro realm
// (node:vm no gerador do golden) e `instanceof` falharia silenciosamente.
function isSetLike(o: Set<number> | null | undefined): o is Set<number> {
  return !!o && typeof o.add === 'function' &&
    typeof o.clear === 'function' && typeof o.has === 'function';
}

function validMap(map: GameMap): boolean {
  return !!(map && map.tiles && typeof map.w === 'number' && typeof map.h === 'number');
}

function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

// Transparência = não é parede e está dentro do mapa. Fora do mapa bloqueia.
// Deliberadamente derivada só de CONFIG.TILE.WALL para que "transparente" e
// "caminhável" sejam exatamente o mesmo conjunto (ver notas do retorno).
function blocksAt(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= cW || y >= cH) return true;
  return cTiles![y * cW + x] === cWall;
}

// round_ties_up(a/b) = floor(a/b + 1/2), com b > 0.
function roundTiesUp(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

// round_ties_down(a/b) = ceil(a/b - 1/2), com b > 0.
function roundTiesDown(a: number, b: number): number {
  return Math.ceil((2 * a - b) / (2 * b));
}

function setContext(map: GameMap, ox: number, oy: number, radius: number | undefined, out: Set<number>): void {
  cTiles = map.tiles;
  cW = map.w | 0;
  cH = map.h | 0;
  cWall = wallValue();
  cOx = ox | 0;
  cOy = oy | 0;
  let rr = (typeof radius === 'number' && isFinite(radius)) ? radius : defaultRadius();
  if (rr < 0) rr = 0;
  cMaxDepth = Math.floor(rr + 0.5);
  const lim = rr + 0.5;
  cLim2 = lim * lim;
  cOut = out;
}

// Marca o tile (x, y) como visível, aplicando o raio CIRCULAR:
// descarta quem tem distância euclidiana > radius + 0.5. A distância é
// simétrica, então esse corte preserva a simetria da visão.
function reveal(x: number, y: number): void {
  if (x < 0 || y < 0 || x >= cW || y >= cH) return;
  const dx = x - cOx;
  const dy = y - cOy;
  if (dx * dx + dy * dy > cLim2) return;
  cOut!.add(y * cW + x);
}

// Centro do tile dentro do cone? col >= depth*start && col <= depth*end,
// avaliado com inteiros (denominadores sempre positivos).
function isSymmetricCol(depth: number, col: number, sn: number, sd: number, en: number, ed: number): boolean {
  return (col * sd >= depth * sn) && (col * ed <= depth * en);
}

// Varredura recursiva de uma linha do quadrante corrente.
// depth: distância da linha à origem (>= 1)
// sn/sd: slope inicial (fração), en/ed: slope final (fração)
function scan(depth: number, sn: number, sd: number, en: number, ed: number): void {
  if (depth > cMaxDepth) return;

  const minCol = roundTiesUp(depth * sn, sd);
  const maxCol = roundTiesDown(depth * en, ed);

  let prev = 2; // 0 = piso, 1 = parede, 2 = nenhum tile anterior
  let col = 0;
  let x = 0;
  let y = 0;
  let wall = false;

  for (col = minCol; col <= maxCol; col++) {
    switch (cCard) {
      case NORTH: x = cOx + col; y = cOy - depth; break;
      case EAST: x = cOx + depth; y = cOy + col; break;
      case SOUTH: x = cOx + col; y = cOy + depth; break;
      default: x = cOx - depth; y = cOy + col; break; // WEST
    }

    wall = blocksAt(x, y);

    // Parede entra sempre (para desenhar); piso só com o centro no cone.
    if (wall || isSymmetricCol(depth, col, sn, sd, en, ed)) reveal(x, y);

    if (prev === 1 && !wall) {
      // parede -> piso: aperta o slope inicial desta mesma linha
      sn = 2 * col - 1;
      sd = 2 * depth;
    }
    if (prev === 0 && wall) {
      // piso -> parede: recursa na linha seguinte com o slope final apertado
      scan(depth + 1, sn, sd, 2 * col - 1, 2 * depth);
    }

    prev = wall ? 1 : 0;
  }

  // Linha terminou em piso: o cone continua inteiro na linha seguinte.
  if (prev === 0) scan(depth + 1, sn, sd, en, ed);
}

// O quadrante `card` alcança o deslocamento (dx, dy)? Cada quadrante cobre
// exatamente o cone |col| <= row do seu eixo; tiles na diagonal exata são
// cobertos por dois quadrantes (irrelevante: o resultado é um Set).
function quadrantCovers(card: number, dx: number, dy: number): boolean {
  switch (card) {
    case NORTH: return dy <= -1 && (dx <= -dy) && (-dx <= -dy);
    case EAST: return dx >= 1 && (dy <= dx) && (-dy <= dx);
    case SOUTH: return dy >= 1 && (dx <= dy) && (-dx <= dy);
    default: return dx <= -1 && (dy <= -dx) && (-dy <= -dx); // WEST
  }
}

// Preenche `out` com todos os índices visíveis a partir de (ox, oy).
function computeInto(map: GameMap, ox: number, oy: number, radius: number | undefined, out: Set<number>): Set<number> {
  out.clear();
  if (!validMap(map)) return out;
  if (!inBounds(map, ox, oy)) return out;

  setContext(map, ox, oy, radius, out);
  out.add((oy | 0) * cW + (ox | 0)); // a origem é sempre visível

  for (let card = NORTH; card <= WEST; card++) {
    cCard = card;
    scan(1, -1, 1, 1, 1);
  }
  cOut = null;
  return out;
}

// Teste dirigido: (bx, by) é visto a partir de (ax, ay)? Varre apenas os
// quadrantes que cobrem o alvo — mesmo algoritmo, mesmo resultado de
// `computeFov`, só que sem gastar os outros quadrantes.
function visibleBetween(
  map: GameMap, ax: number, ay: number, bx: number, by: number,
  radius: number | undefined, scratch: Set<number>
): boolean {
  if (!validMap(map)) return false;
  if (!inBounds(map, ax, ay) || !inBounds(map, bx, by)) return false;
  if (ax === bx && ay === by) return true;

  scratch.clear();
  setContext(map, ax, ay, radius, scratch);

  const dx = (bx | 0) - cOx;
  const dy = (by | 0) - cOy;
  if (dx * dx + dy * dy > cLim2) { cOut = null; return false; }

  const targetIdx = (by | 0) * cW + (bx | 0);
  let found = false;
  for (let card = NORTH; card <= WEST && !found; card++) {
    if (!quadrantCovers(card, dx, dy)) continue;
    cCard = card;
    scan(1, -1, 1, 1, 1);
    if (scratch.has(targetIdx)) found = true;
  }
  cOut = null;
  return found;
}

/**
 * Índices (y*w + x) visíveis a partir de (ox, oy), incluindo a origem.
 * `out` é opcional: um Set reciclado que será limpo e repreenchido.
 */
export function computeFov(
  map: GameMap, ox: number, oy: number, radius?: number, out?: Set<number> | null
): Set<number> {
  const set = isSetLike(out) ? out : new Set<number>();
  return computeInto(map, ox, oy, radius, set);
}

/** (tx, ty) está visível a partir de (ox, oy)? */
export function isVisibleFrom(
  map: GameMap, ox: number, oy: number, tx: number, ty: number, radius?: number
): boolean {
  return visibleBetween(map, ox, oy, tx, ty, radius, SCRATCH_VIS);
}

/**
 * Sonda de simetria (tecla V). Computa o FOV da origem e, para cada tile
 * CAMINHÁVEL visível, computa a visão de volta. Paredes visíveis são
 * ignoradas de propósito: a simetria só é exigida entre tiles caminháveis.
 */
export function checkSymmetry(map: GameMap, ox: number, oy: number, radius?: number): SymmetryReport {
  const broken: Point[] = [];
  let tested = 0;

  if (!validMap(map) || !inBounds(map, ox, oy)) {
    return { tested: 0, broken: broken, ok: true };
  }

  const w = map.w | 0;
  const wall = wallValue();
  const oxi = ox | 0;
  const oyi = oy | 0;
  const originIdx = oyi * w + oxi;

  // Origem em parede: a simetria não é definida para tiles opacos.
  if (map.tiles[originIdx] === wall) {
    return { tested: 0, broken: broken, ok: true };
  }

  const vis = computeInto(map, oxi, oyi, radius, SCRATCH_SYM_A);
  const it = vis.values();
  let step = it.next();
  while (!step.done) {
    const idx = step.value;
    step = it.next();
    if (map.tiles[idx] === wall) continue; // só pares caminháveis
    tested++;
    if (idx === originIdx) continue;       // trivialmente simétrico
    const x = idx % w;
    const y = (idx - x) / w;
    if (!visibleBetween(map, x, y, oxi, oyi, radius, SCRATCH_SYM_B)) {
      broken.push({ x: x, y: y });
    }
  }

  return { tested: tested, broken: broken, ok: broken.length === 0 };
}
