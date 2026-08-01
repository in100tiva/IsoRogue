/* ISOROGUE — src/engine/mapgen.ts
 * Geração procedural da masmorra: BSP recursivo, salas de 5 formatos,
 * corredores em L entre folhas irmãs, escada por BFS de grafo, reparo de
 * áreas isoladas por túnel e regeneração com seed derivada.
 * Cobre R12..R17 e R19. Tudo determinístico a partir de (seed, depth).
 *
 * Fase do penhasco (decisão do dono, sem rediscussão): DEPOIS de salas,
 * corredores e escada, o mapa ganha VAZIO nas bordas (toda parede a mais de
 * VOID_CRUST anéis da divisa do construído vira `Tile.Void` — o nível inteiro
 * é um penhasco) e ÁGUA em duas mãos, no bitmap paralelo `map.agua`: POÇAS
 * 4-conexas de 2..5 tiles dentro das salas e CANAIS — as enseadas — que
 * nascem na costa do penhasco e avançam COMENDO PAREDE. Os três bloqueiam o
 * passo como a parede — jogador E inimigos. Água não é travessia a nado;
 * vazio não é abismo que mata. São barreiras com visual diferente, e a prova
 * de que nada ficou isolado por causa delas é a BFS de conectividade refeita
 * no fim da geração.
 *
 * O CANAL É ÁGUA NO LUGAR DO MURO (referência do dono: a ilha em que o mar
 * delimita o terreno). Ele só escreve sobre `WALL`, nunca sobre piso, e por
 * isso o conjunto de tiles caminháveis do andar atravessa a fase intacto: a
 * enseada troca o visual da barreira sem mover uma vírgula de conectividade,
 * de população ou dos demais streams de rng.
 *
 * Porte 1:1 de legacy/src-vanilla/10-mapgen.js. A ORDEM DE CONSUMO DO RNG é
 * parte do contrato: um u32() a mais ou a menos muda todos os mapas. A água
 * consome um stream PRÓPRIO ('#agua'), criado depois do layout final, então
 * nenhum stream pré-existente (bsp/rooms/corr/decor) muda um passo — e os
 * canais entram no FIM desse mesmo stream, depois das poças, para que nem as
 * poças mudem.
 */
import { CONFIG, hash32, idx, DIRS4, DIRS8, normalizeSeed, makeRng } from './core';
import type { GameMap, Point, RegionsResult, Rng, Room, RoomShape } from './types';

const WALL = CONFIG.TILE.WALL;
const FLOOR = CONFIG.TILE.FLOOR;
const DOOR = CONFIG.TILE.DOOR;
const STAIRS = CONFIG.TILE.STAIRS;
const VOID = CONFIG.TILE.VOID;

// --- parâmetros do gerador (fixos: fazem parte do determinismo) -----------
const MIN_LEAF = 7;        // folha mínima 7x7
const MAX_BSP_DEPTH = 5;   // profundidade máxima da árvore
const MIN_ROOM = 5;        // lado mínimo da sala (garante os 5 formatos)
const MAX_ROOM = 13;       // lado máximo da sala
const SPLIT_MIN = 0.35;
const SPLIT_MAX = 0.65;
const WIDE_CORRIDOR_CHANCE = 0.15;
const MAX_REPAIRS = 3;     // reparos por tentativa
const SHAPES: RoomShape[] = ['rect', 'cross', 'round', 'pillared', 'notched'];

// --- parâmetros da fase do penhasco (fixos: fazem parte do determinismo) ---
/* VOID_CRUST = 1: o vazio fica a MAIS de um anel da parede de divisa (isto é,
 * a dois anéis do piso). A régua de exemplo da fase era 2 — medida em 72
 * andares, ela deixava 12 deles (1 em 6) sem tile de vazio NENHUM, média de
 * 8 tiles num mapa de 45×45: o "penhasco ao redor do construído" não se
 * materializava. Com 1 anel de crosta, todo andar tem penhasco (mínimo 32
 * tiles na mesma amostra) e o invariante estrutural é o mesmo: o vazio jamais
 * é 8-adjacente a um tile caminhável — há sempre a divisa entre ele e a sala,
 * que é a borda que a cachoeira precisa. */
const VOID_CRUST = 1;      // anéis de parede preservados ao redor do construído
const AGUA_CHANCE = 0.60;  // ~60% das salas ganham uma poça
const AGUA_MIN = 2;        // tamanho mínimo da região de água
const AGUA_MAX = 5;        // tamanho máximo da região de água
/* Tentativas de poça por sala sorteada. A garantia de conectividade é DURA
 * (uma poça que isole qualquer tile é revertida por inteiro), e nas salas com
 * gargalo de um tile — a cruz de braços finos é a campeã — a primeira posição
 * sorteada costuma isolar um braço. Medida em 72 andares: uma tentativa
 * vinga 44% das salas; três, ~55% (o restante são salas em que quase toda
 * poça de 2..5 tiles isola algo — aí a sala fica seca, que é a degradação
 * legítima). O consumo do stream é por tentativa: um `int` de tamanho e os
 * sorteios do crescimento, tudo função da seed. */
const AGUA_TENTATIVAS = 3;

/* --- parâmetros dos CANAIS (fixos: fazem parte do determinismo) -----------
 *
 * O canal é a água que SUBSTITUI PAREDE: uma faixa que nasce na crosta do
 * penhasco — a beira onde o construído encosta no vazio — e avança para
 * dentro comendo o muro. É a enseada da referência do dono: o mar de fora
 * entrando pelo terreno, barrando a passagem no lugar do muro.
 *
 * As réguas abaixo saíram de medição em 180 andares (60 sementes ×
 * profundidades 1..3), com o gerador travado nos valores finais:
 *   · 100% dos andares ganham pelo menos uma enseada, e TODA ela nasce
 *     encostada no vazio — nenhuma vira piscina no meio da rocha;
 *   · 1 a 3 corpos de canal por andar (média 1,9) e 3 a 31 tiles de canal por
 *     andar (média 13,3): grande o bastante para o olho ler "enseada",
 *     pequeno o bastante para não virar um lago que engole o andar.
 * Comprimento é medido no EIXO do canal (os tiles do traçado); a largura 2
 * acrescenta a companhia lateral por cima disso. */
const CANAL_MIN = 1;             // canais sorteados por andar (piso)
const CANAL_MAX = 3;             // canais sorteados por andar (teto)
const CANAL_COMP_MIN = 3;        // comprimento mínimo do eixo, em tiles
const CANAL_COMP_MAX = 8;        // comprimento máximo do eixo, em tiles
const CANAL_LARGO_CHANCE = 0.45; // chance de o canal ter 2 tiles de largura
/* Viés de seguir em frente. Sem ele o traçado vira um novelo em cima da boca
 * (a crosta é estreita e o passeio aleatório volta sobre si); com ele o braço
 * entra, dobra ao encontrar o piso e corre pela margem — que é o desenho de
 * enseada. */
const CANAL_RETO = 0.62;
const CANAL_TENTATIVAS = 3;      // tentativas por canal antes de desistir
/* Preferência por boca perto de água que já existe (poça do §água ou canal
 * anterior): é o que dá CONSISTÊNCIA DE AMBIENTE — a poça da sala vira a
 * margem interna da mesma enseada em vez de uma piscina avulsa no meio da
 * rocha. Não é regra dura: 40% das bocas saem de qualquer ponto da costa,
 * senão todo canal do andar se amontoaria no mesmo canto. */
const CANAL_PERTO_DAGUA = 0.60;
/* Raio de Chebyshev que define "mesmo corpo d'água" para a preferência acima.
 * 3 é a distância em que uma poça na beira da sala e uma boca na crosta ainda
 * se leem como uma coisa só: a crosta tem 2 anéis, então a boca já nasce a
 * 2 tiles do piso mais próximo. */
const CANAL_RAIO_CORPO = 3;

const SHAPE_NOME: Record<RoomShape, [string, string]> = {
  rect: ['retangular', 'retangulares'],
  cross: ['em cruz', 'em cruz'],
  round: ['arredondada', 'arredondadas'],
  pillared: ['com colunas', 'com colunas'],
  notched: ['recortada', 'recortadas']
};

// -------------------------------------------------------------------------
// Tipos internos (não fazem parte do contrato público)
// -------------------------------------------------------------------------

interface BspNode {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  left: BspNode | null;
  right: BspNode | null;
  room: Room | null;
}

interface Carver {
  hall(y: number, x1: number, x2: number, wide: number): void;
  vert(x: number, y1: number, y2: number, wide: number): void;
}

interface Layout {
  w: number;
  h: number;
  tiles: Uint8Array;
  rooms: Room[];
  leaves: number;
  corridors: number;
  carver: Carver;
  rngCorr: Rng;
  decorSeed: number;
}

interface BfsResult {
  dist: Int32Array;
  reached: number;
}

interface RegionResult {
  labels: Int32Array;
  count: number;
  sizes: number[];
  lists: number[][];
}

interface NearestPair {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  d: number;
}

// -------------------------------------------------------------------------
// Helpers locais
// -------------------------------------------------------------------------

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}

function isWalkVal(v: number): boolean {
  return v === FLOOR || v === DOOR || v === STAIRS;
}

/** Percentual no formato pt-BR: 97.42 -> '97,4' */
function pct(frac: number): string {
  return (frac * 100).toFixed(1).replace('.', ',');
}

function plural(n: number, sing: string, plur: string): string {
  return n === 1 ? sing : plur;
}

/** Mistura inteira determinística para o decor por tile (sem alocação). */
function mixTile(seedNum: number, x: number, y: number): number {
  let v = (seedNum ^ 0x9e3779b9) >>> 0;
  v = Math.imul(v ^ (x + 0x85ebca6b), 0x27d4eb2d) >>> 0;
  v = Math.imul(v ^ (y + 0xc2b2ae35), 0x165667b1) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  v = Math.imul(v, 0x2545f491) >>> 0;
  return (v ^ (v >>> 13)) >>> 0;
}

// -------------------------------------------------------------------------
// Estruturas de varredura (BFS)
// -------------------------------------------------------------------------

/** BFS 4-vizinhança a partir de (sx,sy) sobre tiles caminháveis.
 *  `agua` (opcional) exclui as poças do passeio: é a BFS da caminhabilidade
 *  EFETIVA, usada na validação da água e na conectividade final do mapa. */
function bfsFrom(
  tiles: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  agua?: Uint8Array | null
): BfsResult {
  const n = w * h;
  const dist = new Int32Array(n);
  dist.fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let reached = 0;
  const s = sy * w + sx;
  const passa = (i: number): boolean => isWalkVal(tiles[i]) && !(agua && agua[i]);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !passa(s)) {
    return { dist: dist, reached: 0 };
  }
  dist[s] = 0;
  queue[tail++] = s;
  reached = 1;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const dc = dist[cur] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS4[k][0];
      const ny = cy + DIRS4[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1 || !passa(ni)) continue;
      dist[ni] = dc;
      queue[tail++] = ni;
      reached++;
    }
  }
  return { dist: dist, reached: reached };
}

/** Rotulagem de componentes conexos (4-vizinhança). -1 = parede. */
function labelRegions(tiles: Uint8Array, w: number, h: number): RegionResult {
  const n = w * h;
  const labels = new Int32Array(n);
  labels.fill(-1);
  const queue = new Int32Array(n);
  const sizes: number[] = [];
  const lists: number[][] = [];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1 || !isWalkVal(tiles[i])) continue;
    let head = 0;
    let tail = 0;
    const list: number[] = [];
    labels[i] = count;
    queue[tail++] = i;
    while (head < tail) {
      const cur = queue[head++];
      list.push(cur);
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS4[k][0];
        const ny = cy + DIRS4[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (labels[ni] !== -1 || !isWalkVal(tiles[ni])) continue;
        labels[ni] = count;
        queue[tail++] = ni;
      }
    }
    sizes.push(list.length);
    lists.push(list);
    count++;
  }
  return { labels: labels, count: count, sizes: sizes, lists: lists };
}

function countWalkable(tiles: Uint8Array, agua?: Uint8Array | null): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (isWalkVal(tiles[i]) && !(agua && agua[i])) total++;
  }
  return total;
}

// -------------------------------------------------------------------------
// BSP
// -------------------------------------------------------------------------

function makeNode(x: number, y: number, w: number, h: number, depth: number): BspNode {
  return { x: x, y: y, w: w, h: h, depth: depth, left: null, right: null, room: null };
}

function splitNode(node: BspNode, rng: Rng): void {
  if (node.depth >= MAX_BSP_DEPTH) return;
  const canV = node.w >= MIN_LEAF * 2; // corte no eixo x
  const canH = node.h >= MIN_LEAF * 2; // corte no eixo y
  if (!canV && !canH) return;

  let vertical: boolean;
  if (canV && !canH) {
    vertical = true;
  } else if (canH && !canV) {
    vertical = false;
  } else if (node.w / node.h >= 1.25) {
    vertical = true;
  } else if (node.h / node.w >= 1.25) {
    vertical = false;
  } else {
    vertical = rng.chance(0.5);
  }

  const len = vertical ? node.w : node.h;
  const ratio = rng.float(SPLIT_MIN, SPLIT_MAX);
  const cut = clampInt(Math.floor(len * ratio), MIN_LEAF, len - MIN_LEAF);

  if (vertical) {
    node.left = makeNode(node.x, node.y, cut, node.h, node.depth + 1);
    node.right = makeNode(node.x + cut, node.y, node.w - cut, node.h, node.depth + 1);
  } else {
    node.left = makeNode(node.x, node.y, node.w, cut, node.depth + 1);
    node.right = makeNode(node.x, node.y + cut, node.w, node.h - cut, node.depth + 1);
  }
  splitNode(node.left, rng);
  splitNode(node.right, rng);
}

/** Folhas em ordem fixa (esquerda antes da direita) — define os ids das salas. */
function collectLeaves(node: BspNode, out: BspNode[]): void {
  if (!node.left) {
    out.push(node);
    return;
  }
  collectLeaves(node.left, out);
  collectLeaves(node.right as BspNode, out);
}

// -------------------------------------------------------------------------
// Salas — 5 formatos visivelmente distintos
// -------------------------------------------------------------------------

function shapeAllows(shape: RoomShape, rw: number, rh: number): boolean {
  if (shape === 'rect') return true;
  return rw >= MIN_ROOM && rh >= MIN_ROOM;
}

/** Saco embaralhado: garante que os 5 formatos apareçam quando há salas suficientes. */
function makeShapeBag(rng: Rng): { take(rw: number, rh: number): RoomShape } {
  let bag: RoomShape[] = [];
  return {
    take: function (rw: number, rh: number): RoomShape {
      for (let guard = 0; guard < 12; guard++) {
        if (bag.length === 0) {
          // shuffle é in place e devolve o próprio array (contrato do RNG).
          bag = SHAPES.slice();
          rng.shuffle(bag);
        }
        const s = bag.pop();
        // Inalcançável: o saco é reabastecido acima sempre que esvazia.
        if (s === undefined) continue;
        if (shapeAllows(s, rw, rh)) return s;
      }
      return 'rect';
    }
  };
}

/** Esculpe o piso da sala conforme o formato. Sempre deixa o centro caminhável. */
function carveRoom(tiles: Uint8Array, w: number, room: Room, rng: Rng): void {
  const x0 = room.x;
  const y0 = room.y;
  const rw = room.w;
  const rh = room.h;
  const cxo = Math.floor(rw / 2);
  const cyo = Math.floor(rh / 2);
  let x: number;
  let y: number;
  let i: number;

  if (room.shape === 'cross') {
    const bw = Math.max(1, Math.floor(rw / 3) | 1);
    const bh = Math.max(1, Math.floor(rh / 3) | 1);
    const sx = Math.floor((rw - bw) / 2);
    const sy = Math.floor((rh - bh) / 2);
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        const inV = (x >= sx && x < sx + bw);
        const inH = (y >= sy && y < sy + bh);
        if (inV || inH) {
          tiles[idx(w, x0 + x, y0 + y)] = FLOOR;
        }
      }
    }
  } else if (room.shape === 'round') {
    const ccx = (rw - 1) / 2;
    const ccy = (rh - 1) / 2;
    const rx = rw / 2;
    const ry = rh / 2;
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        const dx = (x - ccx) / rx;
        const dy = (y - ccy) / ry;
        if (dx * dx + dy * dy <= 1.0) {
          tiles[idx(w, x0 + x, y0 + y)] = FLOOR;
        }
      }
    }
  } else if (room.shape === 'pillared') {
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        tiles[idx(w, x0 + x, y0 + y)] = FLOOR;
      }
    }
    for (y = 1; y < rh - 1; y += 2) {
      for (x = 1; x < rw - 1; x += 2) {
        if (x === cxo && y === cyo) continue; // centro nunca vira coluna
        tiles[idx(w, x0 + x, y0 + y)] = WALL;
      }
    }
  } else if (room.shape === 'notched') {
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        tiles[idx(w, x0 + x, y0 + y)] = FLOOR;
      }
    }
    // O recorte nunca pode engolir o centro: limite = floor((lado-1)/2).
    const nw = clampInt(Math.round(rw * 0.45), 1, Math.floor((rw - 1) / 2));
    const nh = clampInt(Math.round(rh * 0.45), 1, Math.floor((rh - 1) / 2));
    const corner = rng.int(0, 3);
    const nx0 = (corner === 1 || corner === 3) ? rw - nw : 0;
    const ny0 = (corner === 2 || corner === 3) ? rh - nh : 0;
    for (y = ny0; y < ny0 + nh; y++) {
      for (x = nx0; x < nx0 + nw; x++) {
        tiles[idx(w, x0 + x, y0 + y)] = WALL;
      }
    }
  } else {
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        tiles[idx(w, x0 + x, y0 + y)] = FLOOR;
      }
    }
  }

  // invariante: o centro é sempre caminhável (é a boca dos corredores)
  i = idx(w, room.cx, room.cy);
  tiles[i] = FLOOR;
}

// -------------------------------------------------------------------------
// Corredores
// -------------------------------------------------------------------------

function makeCarver(tiles: Uint8Array, w: number, h: number): Carver {
  function put(x: number, y: number): void {
    if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return;
    const i = idx(w, x, y);
    if (tiles[i] === WALL) tiles[i] = FLOOR;
  }
  return {
    hall: function (y, x1, x2, wide) {
      const a = Math.min(x1, x2);
      const b = Math.max(x1, x2);
      for (let x = a; x <= b; x++) {
        put(x, y);
        if (wide) put(x, y + 1);
      }
    },
    vert: function (x, y1, y2, wide) {
      const a = Math.min(y1, y2);
      const b = Math.max(y1, y2);
      for (let y = a; y <= b; y++) {
        put(x, y);
        if (wide) put(x + 1, y);
      }
    }
  };
}

/** Corredor em L de (ax,ay) até (bx,by); 15% de chance de largura 2. */
function carveL(carver: Carver, rng: Rng, ax: number, ay: number, bx: number, by: number): void {
  const wide = rng.chance(WIDE_CORRIDOR_CHANCE) ? 1 : 0;
  if (rng.chance(0.5)) {
    carver.hall(ay, ax, bx, wide);
    carver.vert(bx, ay, by, wide);
  } else {
    carver.vert(ax, ay, by, wide);
    carver.hall(by, ax, bx, wide);
  }
}

/**
 * Na volta da recursão liga a sala representativa da sub-árvore esquerda
 * à da direita e devolve a representativa deste nó.
 */
function connectNode(
  node: BspNode,
  carver: Carver,
  rng: Rng,
  stats: { corridors: number }
): Room | null {
  if (!node.left) return node.room;
  const a = connectNode(node.left, carver, rng, stats);
  const b = connectNode(node.right as BspNode, carver, rng, stats);
  if (a && b) {
    carveL(carver, rng, a.cx, a.cy, b.cx, b.cy);
    stats.corridors++;
  }
  const takeLeft = rng.chance(0.5);
  if (!a) return b;
  if (!b) return a;
  return takeLeft ? a : b;
}

// -------------------------------------------------------------------------
// Reparo de áreas isoladas
// -------------------------------------------------------------------------

/** Par de tiles (isolado, principal) de menor distância de Manhattan. */
function nearestPair(listA: number[], listB: number[], w: number): NearestPair | null {
  let best: NearestPair | null = null;
  let bestD = Infinity;
  for (let i = 0; i < listA.length; i++) {
    const a = listA[i];
    const ax = a % w;
    const ay = (a - ax) / w;
    for (let j = 0; j < listB.length; j++) {
      const b = listB[j];
      const bx = b % w;
      const by = (b - bx) / w;
      const d = Math.abs(ax - bx) + Math.abs(ay - by);
      if (d < bestD) {
        bestD = d;
        best = { ax: ax, ay: ay, bx: bx, by: by, d: d };
      }
    }
  }
  return best;
}

/**
 * Enquanto houver região isolada e orçamento de reparos, cava um túnel em L
 * entre a região isolada e a principal pelo par de tiles mais próximo.
 */
function repairIsolated(
  tiles: Uint8Array,
  w: number,
  h: number,
  startIdx: number,
  carver: Carver,
  rng: Rng
): { repairs: number; fixed: number } {
  let repairs = 0;
  let fixed = 0;
  for (let pass = 0; pass < MAX_REPAIRS; pass++) {
    const reg = labelRegions(tiles, w, h);
    if (reg.count <= 1) break;
    const main = reg.labels[startIdx];
    if (main < 0) break;
    let target = -1;
    for (let lab = 0; lab < reg.count; lab++) {
      if (lab !== main) { target = lab; break; }
    }
    if (target < 0) break;
    const pair = nearestPair(reg.lists[target], reg.lists[main], w);
    if (!pair) break;
    carveL(carver, rng, pair.ax, pair.ay, pair.bx, pair.by);
    repairs++;
    fixed++;
  }
  return { repairs: repairs, fixed: fixed };
}

// -------------------------------------------------------------------------
// Montagem de uma tentativa
// -------------------------------------------------------------------------

function buildLayout(seedNum: number): Layout {
  const w = CONFIG.MAP_W;
  const h = CONFIG.MAP_H;
  const tiles = new Uint8Array(w * h); // 0 = WALL

  const rng = makeRng(seedNum);
  const rngBsp = rng.fork('bsp');
  rng.u32();
  const rngRooms = rng.fork('rooms');
  rng.u32();
  const rngCorr = rng.fork('corr');
  rng.u32();
  const rngDecor = rng.fork('decor');
  rng.u32();
  const decorSeed = rngDecor.u32();

  // 1) árvore BSP sobre o retângulo interno (mantém a moldura de parede)
  const root = makeNode(1, 1, w - 2, h - 2, 0);
  splitNode(root, rngBsp);
  const leaves: BspNode[] = [];
  collectLeaves(root, leaves);

  // 2) uma sala por folha, com margem >= 1 do limite da folha
  const bag = makeShapeBag(rngRooms);
  const rooms: Room[] = [];
  for (let li = 0; li < leaves.length; li++) {
    const leaf = leaves[li];
    const maxW = Math.min(leaf.w - 2, MAX_ROOM);
    const maxH = Math.min(leaf.h - 2, MAX_ROOM);
    if (maxW < 4 || maxH < 4) continue;
    // Sorteio enviesado para salas grandes: os formatos ficam visíveis.
    const lowW = clampInt(maxW - 3, Math.min(MIN_ROOM, maxW), maxW);
    const lowH = clampInt(maxH - 3, Math.min(MIN_ROOM, maxH), maxH);
    const rw = rngRooms.int(lowW, maxW);
    const rh = rngRooms.int(lowH, maxH);
    let rx = leaf.x + 1 + rngRooms.int(0, leaf.w - 2 - rw);
    let ry = leaf.y + 1 + rngRooms.int(0, leaf.h - 2 - rh);
    // trava de segurança: a moldura externa do mapa jamais é escrita
    rx = clampInt(rx, 1, w - 1 - rw);
    ry = clampInt(ry, 1, h - 1 - rh);
    const shape = bag.take(rw, rh);
    const room: Room = {
      id: rooms.length,
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      cx: rx + Math.floor(rw / 2),
      cy: ry + Math.floor(rh / 2),
      area: 0,
      shape: shape
    };
    carveRoom(tiles, w, room, rngRooms);
    leaf.room = room;
    rooms.push(room);
  }

  // 3) corredores em L entre folhas irmãs, na volta da recursão
  const carver = makeCarver(tiles, w, h);
  const stats = { corridors: 0 };
  connectNode(root, carver, rngCorr, stats);

  return {
    w: w,
    h: h,
    tiles: tiles,
    rooms: rooms,
    leaves: leaves.length,
    corridors: stats.corridors,
    carver: carver,
    rngCorr: rngCorr,
    decorSeed: decorSeed
  };
}

/** Sela (vira parede) tudo que não pertence à região principal. Último recurso. */
function sealIsolated(tiles: Uint8Array, w: number, h: number, startIdx: number): number {
  const reg = labelRegions(tiles, w, h);
  if (reg.count <= 1) return 0;
  const main = reg.labels[startIdx];
  if (main < 0) return 0;
  let sealed = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (reg.labels[i] !== -1 && reg.labels[i] !== main) {
      tiles[i] = WALL;
      sealed++;
    }
  }
  return sealed;
}

function computeDecor(tiles: Uint8Array, w: number, h: number, decorSeed: number): Uint8Array {
  const decor = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(w, x, y);
      decor[i] = mixTile(decorSeed + tiles[i] * 131, x, y) & 255;
    }
  }
  return decor;
}

function recomputeAreas(tiles: Uint8Array, w: number, rooms: Room[]): void {
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    let count = 0;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (isWalkVal(tiles[idx(w, x, y)])) count++;
      }
    }
    room.area = count;
  }
}

function shapeSummary(rooms: Room[]): string {
  const counts: Record<RoomShape, number> = {
    rect: 0, cross: 0, round: 0, pillared: 0, notched: 0
  };
  let i: number;
  for (i = 0; i < SHAPES.length; i++) counts[SHAPES[i]] = 0;
  for (i = 0; i < rooms.length; i++) counts[rooms[i].shape]++;
  const parts: string[] = [];
  for (i = 0; i < SHAPES.length; i++) {
    const key = SHAPES[i];
    const n = counts[key];
    if (n > 0) parts.push(n + ' ' + plural(n, SHAPE_NOME[key][0], SHAPE_NOME[key][1]));
  }
  return parts.join(', ');
}

// -------------------------------------------------------------------------
// Fase do penhasco — vazio nas bordas, água nas salas
//
// Os dois nascem DEPOIS de salas, corredores e escada, sempre nesta ordem:
// primeiro o vazio (geometria pura, sem rng), depois a água (stream próprio
// derivado de seed+depth). Nenhum dos dois consome um u32 dos streams do
// layout — bsp/rooms/corr/decor saem byte a byte como antes.
// -------------------------------------------------------------------------

/**
 * Máscara dos RETÂNGULOS de sala (1 = dentro de alguma sala).
 *
 * Mora fora de `carveVoid` porque é a MESMA régua que o vazio e o canal
 * precisam obedecer: o recorte da sala 'notched' e as colunas da 'pillared'
 * são arquitetura, não penhasco e não enseada. Duas cópias desta varredura
 * seriam duas chances de divergir no dia em que a régua mudar.
 */
function mascaraDeSalas(w: number, h: number, rooms: Room[]): Uint8Array {
  const emSala = new Uint8Array(w * h);
  for (let r = 0; r < rooms.length; r++) {
    const sala = rooms[r];
    for (let y = sala.y; y < sala.y + sala.h; y++) {
      for (let x = sala.x; x < sala.x + sala.w; x++) {
        emSala[y * w + x] = 1;
      }
    }
  }
  return emSala;
}

/**
 * Converte em `Tile.Void` a parede LONGE do construído: o nível inteiro é um
 * penhasco, e o vazio é o que fica ENTRE o construído e a moldura externa.
 *
 * A régua, em três passos determinísticos:
 *   1. DIVISA — toda parede que encosta (8-vizinhança) em piso, porta ou
 *      escada é parede de divisa: a borda do construído. Elas são as sementes
 *      de uma BFS de 8 direções limitada a VOID_CRUST anéis;
 *   2. CROSTA — toda parede alcançada (distância Chebyshev <= VOID_CRUST da
 *      divisa) PERMANECE parede: é o rebordo do precipício. Não cortamos o
 *      vazio onde ele se encostaria na sala — a cachoeira precisa da borda,
 *      e mesmo com um anel só de crosta o vazio nunca toca um tile
 *      caminhável (quem encosta no piso é a divisa, distância 0);
 *   3. CONVERSÃO — a parede que sobrou fora da crosta vira Void, COM DUAS
 *      EXCEÇÕES DURAS: nada dentro de nenhum retângulo de sala (o recorte da
 *      sala 'notched' e as colunas da 'pillared' são arquitetura, não
 *      penhasco) e nada no anel externo do mapa (a moldura continua parede,
 *      como sempre foi).
 *
 * Só escreve sobre WALL — nunca sobre tile caminhável — então a conversão
 * não toca a conectividade e dispensa revalidação. Devolve a contagem.
 */
function carveVoid(tiles: Uint8Array, w: number, h: number, rooms: Room[]): number {
  const n = w * h;
  /* Máscara dos retângulos de sala: o vazio NUNCA entra numa sala. */
  const emSala = mascaraDeSalas(w, h, rooms);

  /* Distância até a parede de divisa mais próxima (BFS 8 direções, -1 =
   * "além da crosta"). As sementes (dist 0) são as divisas. */
  const dist = new Int32Array(n);
  dist.fill(-1);
  const fila = new Int32Array(n);
  let ini = 0;
  let fim = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] !== WALL) continue;
      let divisa = false;
      for (let d = 0; d < DIRS8.length && !divisa; d++) {
        const nx = x + DIRS8[d][0];
        const ny = y + DIRS8[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (isWalkVal(tiles[ny * w + nx])) divisa = true;
      }
      if (divisa) {
        dist[i] = 0;
        fila[fim++] = i;
      }
    }
  }
  while (ini < fim) {
    const cur = fila[ini++];
    const dc = dist[cur];
    if (dc >= VOID_CRUST) continue;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < DIRS8.length; d++) {
      const nx = cx + DIRS8[d][0];
      const ny = cy + DIRS8[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1 || tiles[ni] !== WALL) continue;
      dist[ni] = dc + 1;
      fila[fim++] = ni;
    }
  }

  /* A varredura 1..w-2 × 1..h-2 é a moldura preservada: o anel externo
   * continua parede, e o vazio mora entre ele e o construído. */
  let convertidos = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] !== WALL || dist[i] !== -1 || emSala[i]) continue;
      tiles[i] = VOID;
      convertidos++;
    }
  }
  return convertidos;
}

/** Tile elegível para poça: FLOOR puro da sala, fora do início, ainda seco.
 *  A escada já sai de graça (é STAIRS, não FLOOR); a porta idem (é DOOR) —
 *  poça é poça de piso, nunca um vão molhado de passagem. */
function elegivelAgua(
  tiles: Uint8Array,
  agua: Uint8Array,
  w: number,
  room: Room,
  start: Point,
  x: number,
  y: number
): boolean {
  if (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) return false;
  const i = y * w + x;
  if (tiles[i] !== FLOOR) return false;
  if (x === start.x && y === start.y) return false;
  return !agua[i];
}

/**
 * Sorteia UMA região 4-conexa de água dentro da sala, crescendo a partir de
 * uma semente sorteada: a cada passo um tile da fronteira é promovido à
 * região e os vizinhos elegíveis dele engrossam a fronteira. Devolve os
 * índices da região (menor que AGUA_MIN se a sala não comportou a poça —
 * quem decide se ela vinga é o chamador).
 *
 * Todo sorteio vem do rng da água, na ordem fixa: semente, depois um `int`
 * por tile promovido. A ordem de varredura dos elegíveis é o índice linear
 * (linha a linha), como em todo o mapgen.
 */
function regiaoDeAgua(
  tiles: Uint8Array,
  agua: Uint8Array,
  w: number,
  room: Room,
  start: Point,
  tamanho: number,
  rng: Rng
): number[] {
  const cand: number[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (elegivelAgua(tiles, agua, w, room, start, x, y)) cand.push(y * w + x);
    }
  }
  if (cand.length === 0) return [];

  const regiao: number[] = [];
  const naRegiao = new Set<number>();
  const fronteira: number[] = [];
  const naFronteira = new Set<number>();
  const promover = (i: number): void => {
    regiao.push(i);
    naRegiao.add(i);
    const px = i % w;
    const py = (i - px) / w;
    for (let d = 0; d < 4; d++) {
      const nx = px + DIRS4[d][0];
      const ny = py + DIRS4[d][1];
      const ni = ny * w + nx;
      if (naRegiao.has(ni) || naFronteira.has(ni)) continue;
      if (!elegivelAgua(tiles, agua, w, room, start, nx, ny)) continue;
      fronteira.push(ni);
      naFronteira.add(ni);
    }
  };

  promover(cand[rng.int(0, cand.length - 1)]);
  while (regiao.length < tamanho && fronteira.length > 0) {
    const k = rng.int(0, fronteira.length - 1);
    const prox = fronteira.splice(k, 1)[0];
    naFronteira.delete(prox);
    promover(prox);
  }
  return regiao;
}

interface AguaResult {
  agua: Uint8Array;
  regioes: number;
  pocas: number;
}

/**
 * Planta as poças do nível: no máximo UMA região por sala, em ~AGUA_CHANCE
 * das salas, com 2..5 tiles 4-conexos. O bitmap é paralelo aos tiles — a
 * poça continua FLOOR em `map.tiles` (piso no visual) e é `agua[i] = 1` que
 * a torna intransponível.
 *
 * A GARANTIA DE CONECTIVIDADE é por região e global: aplicada a poça, a BFS
 * do início (caminhabilidade efetiva — piso seco, porta e escada) tem de
 * continuar alcançando TODOS os tiles ainda secos. Uma poça que isole
 * qualquer coisa — o start, a escada, um braço de cruz — é REVERTIDA por
 * inteiro e a sala tenta outra posição, até AGUA_TENTATIVAS vezes; se
 * nenhuma vingar, a sala amanhece seca. Não há poça parcial: ou a região
 * inteira fica, ou nada fica. Como a conectividade crua é 100% quando isto
 * roda (a geração só aceita mapa pleno), a invariante sai daqui provada,
 * não esperada.
 *
 * `rng` é o stream dedicado ('#agua'): consumido por sala, na ordem de id —
 * um `chance` sempre, e, se a sala foi sorteada, um `int` de tamanho e os
 * sorteios do crescimento POR TENTATIVA.
 */
function plantarAgua(
  tiles: Uint8Array,
  w: number,
  h: number,
  rooms: Room[],
  start: Point,
  rng: Rng
): AguaResult {
  const agua = new Uint8Array(w * h);
  const totalSeco = countWalkable(tiles);
  let regioes = 0;
  let pocas = 0;
  for (let r = 0; r < rooms.length; r++) {
    if (!rng.chance(AGUA_CHANCE)) continue;
    for (let tent = 0; tent < AGUA_TENTATIVAS; tent++) {
      const tamanho = rng.int(AGUA_MIN, AGUA_MAX);
      const regiao = regiaoDeAgua(tiles, agua, w, rooms[r], start, tamanho, rng);
      if (regiao.length < AGUA_MIN) continue; // sala sem poça: degrada, não força
      for (let k = 0; k < regiao.length; k++) agua[regiao[k]] = 1;
      const scan = bfsFrom(tiles, w, h, start.x, start.y, agua);
      if (scan.reached < totalSeco - pocas - regiao.length) {
        /* A poça isolou algo: reverte por inteiro e tenta outra posição. */
        for (let k = 0; k < regiao.length; k++) agua[regiao[k]] = 0;
        continue;
      }
      pocas += regiao.length;
      regioes++;
      break; // uma poça por sala, vingou — próxima sala
    }
  }
  return { agua: agua, regioes: regioes, pocas: pocas };
}

// -------------------------------------------------------------------------
// Canais — a água que SUBSTITUI a parede (a enseada da referência do dono)
//
// A poça é relevo de sala; o canal é relevo de ANDAR. Ele nasce na costa (a
// parede da crosta que encosta no vazio), avança comendo muro e deixa margem
// dos dois lados: onde o canal passa, a parede some e a água toma o lugar.
// Para o jogador, água e parede barram igual — a diferença é o que o olho lê,
// e é exatamente essa diferença que o dono pediu.
//
// AS TRÊS TRAVAS QUE FAZEM ISTO SER BARATO E SEGURO, nesta ordem:
//
//   1. O CANAL SÓ COME PAREDE. Nunca piso, porta, escada ou o retângulo de
//      uma sala. É a trava estrutural: um tile que já era intransponível
//      continua intransponível, então o CONJUNTO DE TILES CAMINHÁVEIS do
//      andar sai do canal byte a byte igual ao que entrou. Disso decorre, de
//      graça, que nenhuma sala, escada, início, mercador ou estação pode ser
//      isolada — e que `populate` (que sorteia sobre `isWalkable`) devolve os
//      MESMOS inimigos e os MESMOS itens de antes da fase da enseada.
//   2. TODO CANAL TEM MARGEM. Pelo menos um tile do leito precisa encostar
//      (4-vizinhança) em piso seco. Um braço d'água enterrado no meio da
//      rocha, que nenhuma sala enxerga, não é enseada — é desperdício de
//      geração; e, além do estético, é a margem que mantém o canal dentro da
//      região caminhável CRUA do mapa (a água continua sendo `Tile.Floor`).
//   3. A CONECTIVIDADE É REVALIDADA MESMO ASSIM. Aplicado o leito, a BFS de
//      caminhabilidade efetiva refaz o passeio do início: se um tile seco
//      qualquer deixou de ser alcançável, o canal INTEIRO é revertido e o
//      andar tenta outro traçado. Pela trava 1 isso nunca dispara, e é
//      justamente por isso que ela fica: no dia em que alguém deixar o canal
//      morder piso, o gerador degrada sozinho em vez de entregar um andar
//      partido em silêncio.
//
// O stream é o '#agua' que já existia, consumido DEPOIS das poças. A ordem
// não é gosto: as poças precisam sair do gerador com os mesmos sorteios de
// sempre — elas mexem em `isWalkable`, e mexer nelas moveria inimigo e item
// de todo andar já gerado. Os canais, que não mexem, entram por último.
// -------------------------------------------------------------------------

/**
 * Tile elegível para leito de canal: parede pura, fora de sala e dentro da
 * moldura. O tile que um canal anterior já comeu deixou de ser `WALL` (virou
 * piso com o bitmap marcado), então o próprio teste de parede impede que dois
 * canais se sobreponham — não há caso especial para água aqui.
 */
function elegivelCanal(
  tiles: Uint8Array,
  emSala: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number
): boolean {
  if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return false; // moldura intacta
  const i = y * w + x;
  if (tiles[i] !== WALL) return false;
  return !emSala[i];
}

/** Há piso SECO encostado (4-vizinhança) em (x,y)? É o teste de margem. */
function temMargem(
  tiles: Uint8Array,
  agua: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number
): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS4[d][0];
    const ny = y + DIRS4[d][1];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    if (isWalkVal(tiles[ni]) && !agua[ni]) return true;
  }
  return false;
}

/**
 * Bocas de canal: tiles elegíveis que encostam (4-vizinhança) no VAZIO.
 *
 * É a costa do andar — a linha em que o construído dá de cara com o penhasco.
 * Ancorar ali é o que faz o braço ler como MAR ENTRANDO pelo mapa, e não como
 * piscina cavada no meio da rocha: a água nasce na beira do abismo e o
 * renderer, que já sabe desenhar a cachoeira onde a água encosta no vazio,
 * fecha a leitura sozinho.
 *
 * Devolve pares (índice do tile, índice da direção de ENTRADA em DIRS4) — a
 * direção é o oposto de onde está o vazio, isto é, para dentro do terreno.
 */
function bocasDeCanal(
  tiles: Uint8Array,
  emSala: Uint8Array,
  w: number,
  h: number
): { i: number; dir: number }[] {
  const out: { i: number; dir: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!elegivelCanal(tiles, emSala, w, h, x, y)) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS4[d][0];
        const ny = y + DIRS4[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (tiles[ny * w + nx] !== VOID) continue;
        out.push({ i: y * w + x, dir: (d + 2) % 4 }); // entra ao contrário do mar
        break;
      }
    }
  }
  return out;
}

/** Há água a até `raio` (Chebyshev) do tile? Define "mesmo corpo d'água". */
function pertoDeAgua(
  agua: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  raio: number
): boolean {
  const x0 = Math.max(0, x - raio);
  const x1 = Math.min(w - 1, x + raio);
  const y0 = Math.max(0, y - raio);
  const y1 = Math.min(h - 1, y + raio);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (agua[yy * w + xx]) return true;
    }
  }
  return false;
}

/**
 * Traça o LEITO de um canal a partir da boca, sem escrever nada no mapa.
 *
 * O passeio é enviesado: a cada passo, se o tile na direção atual for
 * elegível, ele é tomado com probabilidade `CANAL_RETO`; senão (ou no azar do
 * sorteio) o passo sai por sorteio uniforme entre os vizinhos elegíveis, na
 * ordem fixa de `DIRS4`. A direção corrente passa a ser a do passo dado — o
 * braço "escoa" em vez de zigue-zaguear em torno da boca.
 *
 * Largura 2: uma única companheira lateral por tile do eixo, sempre do MESMO
 * lado (sorteado uma vez para o canal inteiro). Alternar o lado tile a tile
 * produziria uma mancha gorda no meio e pontas finas; um lado só produz uma
 * faixa — que é o que uma enseada é.
 *
 * Consumo do rng, por canal e nesta ordem: um `chance` de largura, um `int`
 * de lado, e por passo do eixo um `chance` de seguir reto mais, quando o reto
 * não vinga, um `int` de escolha. Nada é sorteado na fase da largura.
 */
function tracarCanal(
  tiles: Uint8Array,
  emSala: Uint8Array,
  w: number,
  h: number,
  boca: { i: number; dir: number },
  comprimento: number,
  rng: Rng
): number[] {
  const eixo: number[] = [boca.i];
  const dirs: number[] = [boca.dir];
  const noLeito = new Set<number>([boca.i]);
  let dir = boca.dir;
  let cx = boca.i % w;
  let cy = (boca.i - cx) / w;

  const largo = rng.chance(CANAL_LARGO_CHANCE);
  const lado = rng.int(0, 1); // 0 = perpendicular horária, 1 = anti-horária

  while (eixo.length < comprimento) {
    /* Candidatos na ordem fixa de DIRS4 — a mesma varredura determinística de
     * todo o mapgen. A volta sobre o próprio leito fica de fora: canal não
     * come a si mesmo. */
    const cand: number[] = [];
    let reto = -1;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS4[d][0];
      const ny = cy + DIRS4[d][1];
      if (!elegivelCanal(tiles, emSala, w, h, nx, ny)) continue;
      const ni = ny * w + nx;
      if (noLeito.has(ni)) continue;
      cand.push(d);
      if (d === dir) reto = d;
    }
    if (cand.length === 0) break; // encalhou: o braço termina onde chegou
    let escolha: number;
    if (reto >= 0 && rng.chance(CANAL_RETO)) {
      escolha = reto;
    } else {
      escolha = cand[rng.int(0, cand.length - 1)];
    }
    cx += DIRS4[escolha][0];
    cy += DIRS4[escolha][1];
    dir = escolha;
    const ni = cy * w + cx;
    eixo.push(ni);
    dirs.push(dir);
    noLeito.add(ni);
  }

  if (!largo) return eixo;

  /* Alargamento: a perpendicular do escoamento local, sempre do mesmo lado.
   * O que não for elegível simplesmente não entra — o canal afina onde a
   * rocha aperta, que é o desenho certo para uma enseada. */
  const leito = eixo.slice();
  for (let k = 0; k < eixo.length; k++) {
    const perp = lado === 0 ? (dirs[k] + 1) % 4 : (dirs[k] + 3) % 4;
    const px = (eixo[k] % w) + DIRS4[perp][0];
    const py = ((eixo[k] - (eixo[k] % w)) / w) + DIRS4[perp][1];
    if (!elegivelCanal(tiles, emSala, w, h, px, py)) continue;
    const pi = py * w + px;
    if (noLeito.has(pi)) continue;
    noLeito.add(pi);
    leito.push(pi);
  }
  return leito;
}

interface CanalResult {
  /** Canais que vingaram. Todos nascem colados no vazio, por construção. */
  canais: number;
  /** Tiles de parede que viraram água. */
  tiles: number;
}

/**
 * Escava de `CANAL_MIN` a `CANAL_MAX` canais no andar, no bitmap `agua` e nos
 * `tiles` (a parede comida vira `Tile.Floor` com o bitmap marcado — a mesma
 * representação da poça, e por isso o renderer, o Dijkstra, a IA e o restore
 * já sabem o que fazer com ela sem uma linha nova).
 *
 * Cada canal tenta até `CANAL_TENTATIVAS` traçados; um traçado é RECUSADO
 * quando fica mais curto que `CANAL_COMP_MIN` (não lê como braço), quando não
 * encosta em piso seco nenhum (não tem margem) ou quando a BFS de
 * conectividade efetiva perde um tile seco (a trava dura). Recusa não escreve
 * nada: ou o leito inteiro entra, ou o andar segue sem aquele canal.
 */
function escavarCanais(
  tiles: Uint8Array,
  w: number,
  h: number,
  rooms: Room[],
  agua: Uint8Array,
  start: Point,
  rng: Rng
): CanalResult {
  const emSala = mascaraDeSalas(w, h, rooms);
  const quantos = rng.int(CANAL_MIN, CANAL_MAX);
  let canais = 0;
  let escavados = 0;

  for (let c = 0; c < quantos; c++) {
    for (let tent = 0; tent < CANAL_TENTATIVAS; tent++) {
      /* A costa é recalculada a cada tentativa: o canal anterior comeu parede
       * e pode ter aberto (ou fechado) bocas. */
      const bocas = bocasDeCanal(tiles, emSala, w, h);
      if (bocas.length === 0) return { canais: canais, tiles: escavados };

      /* Consistência de ambiente: com 60% de chance a boca sai de perto de
       * água que já existe, para que poça e canal se leiam como o MESMO
       * corpo d'água. Sem candidata perto, cai na costa inteira. */
      const perto = bocas.filter((b) =>
        pertoDeAgua(agua, w, h, b.i % w, (b.i - (b.i % w)) / w, CANAL_RAIO_CORPO));
      const lista = (perto.length > 0 && rng.chance(CANAL_PERTO_DAGUA)) ? perto : bocas;
      const boca = lista[rng.int(0, lista.length - 1)];
      const comprimento = rng.int(CANAL_COMP_MIN, CANAL_COMP_MAX);
      const leito = tracarCanal(tiles, emSala, w, h, boca, comprimento, rng);
      if (leito.length < CANAL_COMP_MIN) continue; // braço curto demais: não vale

      /* Margem obrigatória (trava 2): o braço tem de encostar em piso seco. */
      let margem = false;
      for (let k = 0; k < leito.length && !margem; k++) {
        const lx = leito[k] % w;
        const ly = (leito[k] - lx) / w;
        if (temMargem(tiles, agua, w, h, lx, ly)) margem = true;
      }
      if (!margem) continue;

      /* Aplica o leito inteiro: a parede some, a água toma o lugar. */
      for (let k = 0; k < leito.length; k++) {
        tiles[leito[k]] = FLOOR;
        agua[leito[k]] = 1;
      }

      /* Trava 3: a conectividade efetiva refeita do zero. Pela trava 1 ela
       * não pode cair — o canal só comeu tile que já barrava —, e é por isso
       * que a comparação é com o total RECONTADO agora, e não com um número
       * guardado antes: se um dia o canal morder piso, a conta acusa. */
      const secos = countWalkable(tiles, agua);
      const scan = bfsFrom(tiles, w, h, start.x, start.y, agua);
      if (scan.reached < secos) {
        for (let k = 0; k < leito.length; k++) {
          tiles[leito[k]] = WALL;
          agua[leito[k]] = 0;
        }
        continue;
      }

      canais++;
      escavados += leito.length;
      break;
    }
  }
  return { canais: canais, tiles: escavados };
}

// -------------------------------------------------------------------------
// API pública
// -------------------------------------------------------------------------

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

/**
 * Caminhável para efeito de PASSO: piso, porta ou escada — e NÃO água.
 *
 * A fase do penhasco mudou esta função em um único ponto, e é por ele que a
 * decisão do dono vira regra sem que mais nada precise saber por quê:
 *   · o VAZIO (`Tile.Void`) cai fora do trio de valores caminháveis, como a
 *     parede — sem linha nova;
 *   · a ÁGUA é piso com o bitmap `map.agua` marcado, e o bitmap a exclui —
 *     tanto a poça da sala quanto o canal que substituiu parede.
 *
 * Tudo que lê caminhabilidade herda o bloqueio de graça: o passo do jogador
 * (game.ts), o campo de Dijkstra e o passo do gradiente (dijkstra.ts), a IA
 * (entities.ts), a colocação de inimigos, itens e paradas (populate) e a
 * validação de posições do restore (game.ts). `map.agua` ausente (mapa
 * fabricado à mão por ferramenta) degrada para "sem água", nunca para erro.
 */
export function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const i = y * map.w + x;
  const v = map.tiles[i];
  if (v !== FLOOR && v !== DOOR && v !== STAIRS) return false;
  const agua = map.agua;
  if (agua && agua[i]) return false;
  return true;
}

export function blocksLight(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
  return map.tiles[y * map.w + x] === WALL;
}

export function regions(map: GameMap): RegionsResult {
  const reg = labelRegions(map.tiles, map.w, map.h);
  return { labels: reg.labels, count: reg.count, sizes: reg.sizes };
}

/**
 * Sala que contém (x, y), ou `null` se o tile está em corredor (ou fora).
 *
 * As folhas do BSP não se sobrepõem, então a PRIMEIRA sala que casar é a única
 * — a varredura linear é a resposta completa, não um palpite. Mora aqui, e não
 * em quem pergunta, porque `rooms` é dado de mapa: game.ts (narração de sala) e
 * entities.ts (colocação da bancada) precisavam da mesma resposta, e duas
 * implementações da mesma pergunta são duas chances de divergir.
 */
export function roomAt(map: GameMap | null, x: number, y: number): Room | null {
  const rooms = map ? map.rooms : null;
  if (!rooms) return null;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  }
  return null;
}

/**
 * Gera o mapa do nível. Mesma (seed, depth) => mapa byte-a-byte idêntico.
 * @param seedStr semente crua (será normalizada)
 * @param depth   profundidade 1-based
 */
export function generate(seedStr: string, depth: number): GameMap {
  const seed = normalizeSeed(seedStr);
  const d = Math.max(1, Math.floor(depth || 1));
  const notes: string[] = [];
  let regenerations = 0;
  let repairs = 0;

  let layout: Layout | null = null;
  let startIdx = 0;
  let startX = 0;
  let startY = 0;
  let walk = 0;
  let reach = 0;
  let connectivity = 0;
  let scan: BfsResult | null = null;
  let accepted = false;

  for (let attempt = 0; attempt <= CONFIG.MAX_REGEN; attempt++) {
    const seedNum = attempt === 0
      ? hash32(seed + '#' + d)
      : hash32(seed + '#' + d + '#retry' + attempt);

    layout = buildLayout(seedNum);

    if (layout.rooms.length === 0) {
      // Sem salas não há mapa jogável: força nova tentativa.
      notes.push('Tentativa ' + (attempt + 1) + ' descartada: nenhuma sala pôde ser esculpida.');
      regenerations++;
      continue;
    }

    // início: centro da sala de menor id
    startX = layout.rooms[0].cx;
    startY = layout.rooms[0].cy;
    startIdx = idx(layout.w, startX, startY);

    walk = countWalkable(layout.tiles);
    scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
    reach = scan.reached;
    connectivity = walk > 0 ? reach / walk : 0;

    if (connectivity < 1) {
      const before = connectivity;
      const rep = repairIsolated(layout.tiles, layout.w, layout.h, startIdx, layout.carver, layout.rngCorr);
      if (rep.repairs > 0) {
        repairs += rep.repairs;
        walk = countWalkable(layout.tiles);
        scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
        reach = scan.reached;
        connectivity = walk > 0 ? reach / walk : 0;
        notes.push('Conectividade ' + pct(before) + '% — ' + rep.repairs + ' ' +
          plural(rep.repairs, 'área isolada religada', 'áreas isoladas religadas') + ' por túnel.');
      }
    }

    if (connectivity >= 1) {
      accepted = true;
      break;
    }

    if (attempt < CONFIG.MAX_REGEN) {
      notes.push('Tentativa ' + (attempt + 1) + ' descartada (conectividade ' + pct(connectivity) +
        '%): mapa refeito com semente derivada.');
      regenerations++;
    }
  }

  // Último recurso: sela o que sobrou isolado para garantir 100% de conectividade.
  if (!accepted && layout && layout.rooms.length > 0) {
    const sealed = sealIsolated(layout.tiles, layout.w, layout.h, startIdx);
    if (sealed > 0) {
      notes.push('Limite de regenerações atingido: ' + sealed + ' ' +
        plural(sealed, 'tile inalcançável foi selado', 'tiles inalcançáveis foram selados') + '.');
    }
    walk = countWalkable(layout.tiles);
    scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
    reach = scan.reached;
    connectivity = walk > 0 ? reach / walk : 0;
  }

  const built = layout as Layout;
  const w = built.w;
  const h = built.h;
  const tiles = built.tiles;
  const rooms = built.rooms;
  const dist = (scan as BfsResult).dist;

  // Escada: sala mais distante do início em distância de grafo (BFS).
  let stairRoom: Room | null = null;
  let bestDist = -1;
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    const ri = idx(w, room.cx, room.cy);
    if (dist[ri] < 0) continue;
    if (rooms.length > 1 && r === 0) continue; // evita escada em cima do início
    if (dist[ri] > bestDist) {
      bestDist = dist[ri];
      stairRoom = room;
    }
  }

  let stairX: number;
  let stairY: number;
  if (stairRoom) {
    stairX = stairRoom.cx;
    stairY = stairRoom.cy;
  } else {
    // fallback: tile caminhável mais distante do início
    let bi = startIdx;
    let bd = -1;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] > bd) { bd = dist[i]; bi = i; }
    }
    stairX = bi % w;
    stairY = (bi - stairX) / w;
    bestDist = bd;
  }
  tiles[idx(w, stairX, stairY)] = STAIRS;

  /* -------------------------------------------------------------- *
   * Fase do penhasco — DEPOIS de salas, corredores e escada.
   *
   * A escolha da escada usa o `dist` do mapa CRU (pré-água) de propósito: a
   * escada é decidida sobre o relevo completo, e a água nunca a cobre
   * (STAIRS não é FLOOR). O vazio vem primeiro (geometria pura, sem rng) e
   * a água depois, com stream PRÓPRIO derivado de seed+depth — nenhum u32
   * dos streams do layout é consumido aqui, então salas e corredores saem
   * byte a byte como antes da fase.
   *
   * A ÁGUA VEM EM DUAS MÃOS, e a ordem é contrato:
   *   1. POÇAS, dentro das salas, sobre piso — mexem em `isWalkable`, logo
   *      mexem nos candidatos de `populate`. Vêm PRIMEIRO e com os mesmos
   *      sorteios de sempre, para que inimigo e item de todo andar já gerado
   *      continuem exatamente onde estavam;
   *   2. CANAIS, sobre parede — as enseadas. Consomem o MESMO stream '#agua',
   *      logo depois das poças, e por só comerem tile que já barrava o passo
   *      não movem uma vírgula da população.
   * -------------------------------------------------------------- */
  const vazios = carveVoid(tiles, w, h, rooms);
  const rngAgua = makeRng(hash32(seed + '#' + d + '#agua'));
  const aguas = plantarAgua(tiles, w, h, rooms, { x: startX, y: startY }, rngAgua);
  const agua = aguas.agua;
  const canais = escavarCanais(tiles, w, h, rooms, agua, { x: startX, y: startY }, rngAgua);

  /* Conectividade EFETIVA: a água barra o passo, então os números públicos
   * (`connectivity`, `walkable`) e a nota correspondente passam a medir o
   * relevo de verdade — piso seco. A validação por região de `plantarAgua`
   * garante 100% aqui; recomputar é registrar a prova, não torcer por ela. */
  walk = countWalkable(tiles, agua);
  scan = bfsFrom(tiles, w, h, startX, startY, agua);
  reach = scan.reached;
  connectivity = walk > 0 ? reach / walk : 0;

  recomputeAreas(tiles, w, rooms);
  const decor = computeDecor(tiles, w, h, built.decorSeed);

  // --- notas em pt-BR ----------------------------------------------------
  notes.unshift('Nível ' + d + ', semente ' + seed + ': BSP produziu ' + built.leaves + ' ' +
    plural(built.leaves, 'folha', 'folhas') + ', ' + rooms.length + ' ' +
    plural(rooms.length, 'sala', 'salas') + ' e ' + built.corridors + ' ' +
    plural(built.corridors, 'corredor em L', 'corredores em L') + '.');
  notes.splice(1, 0, 'Formatos das salas: ' + shapeSummary(rooms) + '.');
  if (regenerations > 0) {
    notes.splice(2, 0, 'Mapa regenerado ' + regenerations + ' ' +
      plural(regenerations, 'vez', 'vezes') + ' com semente derivada.');
  }
  /* O QUALIFICADOR "em quatro direções" não é preciosismo: desde que o painel
   * ganhou a bússola da saída (`ui/panels/ExitPanel.tsx`), existem DOIS números
   * de passos até a escada na tela, e eles não batem. Este aqui é `bfsFrom` —
   * quatro direções, sobre o mapa CRU, antes da água; o do painel é o campo de
   * Dijkstra do jogador — oito direções, sobre o mapa final. O de baixo é
   * sempre maior, e nunca é o número de passos que o jogador vai dar. Duas
   * medidas com o mesmo nome viram, invariavelmente, um relato de bug. */
  notes.push('Escada na sala ' + (stairRoom ? '#' + stairRoom.id : 'mais afastada') +
    ' em (' + stairX + ',' + stairY + '), a ' + Math.max(0, bestDist) + ' ' +
    plural(Math.max(0, bestDist), 'passo', 'passos') + ' do início em quatro direções.');

  if (vazios > 0) {
    notes.push('O nível é um penhasco: ' + vazios + ' ' +
      plural(vazios, 'tile de vazio cerca', 'tiles de vazio cercam') +
      ' o construído, entre ele e a borda.');
  }
  if (aguas.regioes > 0) {
    notes.push(aguas.regioes + ' ' + plural(aguas.regioes, 'poça', 'poças') +
      ' de água (' + aguas.pocas + ' ' + plural(aguas.pocas, 'tile', 'tiles') +
      '): a água barra o passo como a parede.');
  }
  if (canais.canais > 0) {
    notes.push(canais.canais + ' ' + plural(canais.canais, 'canal', 'canais') +
      ' de água (' + canais.tiles + ' ' + plural(canais.tiles, 'tile', 'tiles') +
      ') ' + plural(canais.canais, 'entra', 'entram') + ' pela beira do penhasco: ' +
      'onde a enseada passa, a parede deu lugar à água.');
  }

  const unreachable = walk - reach;
  if (connectivity >= 1) {
    notes.push('Conectividade 100,0% — ' + walk + ' tiles caminháveis, todos alcançáveis a partir do início.');
  } else {
    notes.push('Conectividade ' + pct(connectivity) + '% — ' + walk + ' tiles caminháveis, ' +
      unreachable + ' ' + plural(unreachable, 'inalcançável', 'inalcançáveis') + '.');
  }

  return {
    seed: seed,
    depth: d,
    w: w,
    h: h,
    tiles: tiles,
    decor: decor,
    agua: agua,
    rooms: rooms,
    start: { x: startX, y: startY },
    stairs: { x: stairX, y: stairY },
    connectivity: connectivity,
    walkable: walk,
    regenerations: regenerations,
    repairs: repairs,
    notes: notes
  };
}
