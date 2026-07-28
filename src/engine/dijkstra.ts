// ---------------------------------------------------------------------------
// Dijkstra / mapa de fluxo (R34, R35, R36, R41)
//
// Porte literal de legacy/src-vanilla/30-dijkstra.js.
//
// Um ÚNICO mapa por turno, recalculado a partir do jogador. A* individual é
// proibido: toda a IA lê este mesmo campo escalar.
//
// INVARIANTES TESTADAS PELO HARNESS (T8):
//   1. O tile do jogador (fonte com v = 0) vale 0.
//   2. Todo tile caminhável alcançável a partir das fontes tem valor finito
//      (< INF); tiles de parede e tiles caminháveis ilhados permanecem INF.
//   3. Dois tiles vizinhos diferem no máximo 1 — considerando as transições
//      REALMENTE permitidas, isto é, as 8 direções sem corte de canto: a
//      diagonal (dx,dy) só existe se (dx,0) e (0,dy) também forem caminháveis.
//      Vizinhos diagonais separados por um "pinçamento" de paredes não são
//      vizinhos do grafo e podem diferir de mais de 1 legitimamente.
// ---------------------------------------------------------------------------

import type { GameMap } from './types.ts';
import { CONFIG, DIRS8 } from './core.ts';
import { isWalkable } from './mapgen.ts';

export const DIJKSTRA_INF = 99999;
export const DIJKSTRA_FLEE_FACTOR = -1.2;

const INF = DIJKSTRA_INF;
const DEFAULT_FLEE_FACTOR = DIJKSTRA_FLEE_FACTOR;
const MAX_SCAN_PASSES = 256; // teto de segurança do re-scan iterativo (Brogue)

/** Fonte do campo escalar; `v` padrão 0. */
export interface DijkstraSource {
  x: number;
  y: number;
  v?: number | null;
}

export interface DijkstraOptions {
  /** índices intransponíveis */
  blocked?: Set<number> | null;
  /** buffer do chamador */
  out?: Int32Array | null;
  /** false => aloca novo em vez de reciclar por mapa */
  reuse?: boolean;
}

export interface ScanOptions {
  blocked?: Set<number> | null;
  maxPasses?: number;
}

export interface DijkstraStep {
  x: number;
  y: number;
  v: number;
}

export type IsBlockedFn = (nx: number, ny: number, ni: number) => boolean;

interface FieldMeta {
  w: number;
  h: number;
  map: GameMap | null;
}

// Buffers reaproveitados. As chaves são os objetos `map`, de modo que dois
// estados de jogo vivos ao mesmo tempo (harness comparando duas partidas)
// nunca compartilhem o mesmo Int32Array.
const computeCache = new WeakMap<GameMap, Int32Array>();
const fleeCache = new WeakMap<GameMap, Int32Array>();
// Int32Array -> { w, h, map }: permite que bestStep()/fleeMap() conheçam as
// dimensões do campo sem receber o mapa na assinatura pública.
const metaOf = new WeakMap<Int32Array, FieldMeta>();

let queueBuf: Int32Array | null = null; // fila circular
let markBuf: Uint8Array | null = null;  // flag "já está na fila"
let passBuf: Uint8Array | null = null;  // passabilidade pré-computada para o re-scan

// --- helpers ---------------------------------------------------------------

function grabField(cache: WeakMap<GameMap, Int32Array>, key: GameMap | null, n: number): Int32Array {
  let buf = key ? cache.get(key) : null;
  if (!buf || buf.length !== n) {
    buf = new Int32Array(n);
    if (key) { cache.set(key, buf); }
  }
  return buf;
}

function ensureQueue(n: number): Int32Array {
  if (!queueBuf || queueBuf.length < n) { queueBuf = new Int32Array(n); }
  return queueBuf;
}

function ensureMark(n: number): Uint8Array {
  if (!markBuf || markBuf.length < n) { markBuf = new Uint8Array(n); }
  return markBuf;
}

function ensurePass(n: number): Uint8Array {
  if (!passBuf || passBuf.length < n) { passBuf = new Uint8Array(n); }
  return passBuf;
}

// Caminhável = FLOOR, DOOR ou STAIRS dentro dos limites — fonte da verdade é
// o mapgen. Campo sem mapa associado (`map` nulo) trata tudo como passável,
// exatamente como o vanilla.
function walkable(map: GameMap | null, x: number, y: number): boolean {
  if (!map) { return true; }
  return !!isWalkable(map, x, y);
}

function fieldDims(field: Int32Array, map: GameMap | null): FieldMeta | null {
  if (map && map.w && map.h) { return { w: map.w, h: map.h, map: map }; }
  const mt = metaOf.get(field);
  if (mt) { return { w: mt.w, h: mt.h, map: mt.map }; }
  if (CONFIG.MAP_W && CONFIG.MAP_H && field && field.length === CONFIG.MAP_W * CONFIG.MAP_H) {
    return { w: CONFIG.MAP_W, h: CONFIG.MAP_H, map: null };
  }
  return null;
}

function isFiniteVal(v: number): boolean {
  return v < INF && v > -INF;
}

// --- compute ---------------------------------------------------------------

/**
 * Mapa de Dijkstra com custo uniforme 1 em 8 direções, sem corte de canto.
 * Devolve um campo de tamanho w*h, INF onde inalcançável.
 */
export function computeDijkstra(
  map: GameMap,
  sources: readonly DijkstraSource[] | null | undefined,
  opts?: DijkstraOptions | null
): Int32Array {
  const w = map.w;
  const h = map.h;
  const n = w * h;
  const options: DijkstraOptions = opts || {};
  const blocked = options.blocked || null;
  const D = DIRS8;

  let dist: Int32Array | null = options.out || null;
  if (!dist || dist.length !== n) {
    dist = (options.reuse === false) ? new Int32Array(n) : grabField(computeCache, map, n);
  }
  dist.fill(INF);

  // Fila circular: com a flag `mark` cada índice está no máximo uma vez na
  // fila, então n + 1 posições bastam e nunca há estouro.
  const cap = n + 1;
  const q = ensureQueue(cap);
  const mark = ensureMark(n);
  mark.fill(0, 0, n);
  let head = 0;
  let tail = 0;

  let i = 0;
  let s: DijkstraSource | null = null;
  let sx = 0;
  let sy = 0;
  let sv = 0;
  let si = 0;
  if (sources) {
    for (i = 0; i < sources.length; i++) {
      s = sources[i];
      if (!s) { continue; }
      sx = s.x | 0;
      sy = s.y | 0;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) { continue; }
      sv = (s.v === undefined || s.v === null) ? 0 : (s.v | 0);
      si = sy * w + sx;
      if (sv < dist[si]) {
        dist[si] = sv;
        if (!mark[si]) {
          mark[si] = 1;
          q[tail] = si;
          tail = (tail + 1) % cap;
        }
      }
    }
  }

  let guard = 0;
  const maxOps = n * 16 + 64; // rede de segurança: BFS uniforme visita n vezes
  let ci = 0;
  let cv = 0;
  let cx = 0;
  let cy = 0;
  let nd = 0;
  let d = 0;
  let dx = 0;
  let dy = 0;
  let nx = 0;
  let ny = 0;
  let ni = 0;

  while (head !== tail && guard++ < maxOps) {
    ci = q[head];
    head = (head + 1) % cap;
    mark[ci] = 0;
    cv = dist[ci];
    if (cv >= INF) { continue; }
    cx = ci % w;
    cy = (ci - cx) / w;
    nd = cv + 1;

    for (d = 0; d < D.length; d++) {
      dx = D[d][0];
      dy = D[d][1];
      nx = cx + dx;
      ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
      ni = ny * w + nx;
      if (nd >= dist[ni]) { continue; }
      if (!walkable(map, nx, ny)) { continue; }
      if (blocked && blocked.has(ni)) { continue; }
      // sem corte de canto: a diagonal exige os dois ortogonais caminháveis
      if (dx !== 0 && dy !== 0) {
        if (!walkable(map, cx + dx, cy)) { continue; }
        if (!walkable(map, cx, cy + dy)) { continue; }
      }
      dist[ni] = nd;
      if (!mark[ni]) {
        mark[ni] = 1;
        q[tail] = ni;
        tail = (tail + 1) % cap;
      }
    }
  }

  metaOf.set(dist, { w: w, h: h, map: map });
  return dist;
}

// --- scan (reaproveitado pelo flee) ----------------------------------------

/**
 * Re-scan iterativo clássico do Brogue: passadas sobre o campo inteiro
 * (ida e volta) relaxando `dist[vizinho] = dist[celula] + 1` até que nenhuma
 * passada mude nada, com teto de iterações para não travar.
 *
 * Opera IN PLACE. Só escreve em tiles passáveis; INF permanece INF onde não
 * há caminho. Reaproveitável por qualquer campo escalar (não só o flee).
 *
 * @returns quantidade de passadas executadas
 */
export function scanField(dist: Int32Array, map: GameMap | null, opts?: ScanOptions | null): number {
  const options: ScanOptions = opts || {};
  const dims = fieldDims(dist, map);
  if (!dims) { return 0; }
  const w = dims.w;
  const h = dims.h;
  const n = w * h;
  const src = dims.map;
  const blocked = options.blocked || null;
  const maxPassesOpt = options.maxPasses;
  const maxPasses = (typeof maxPassesOpt === 'number' && maxPassesOpt > 0)
    ? (maxPassesOpt | 0)
    : MAX_SCAN_PASSES;
  const D = DIRS8;

  // Passabilidade pré-computada: evita milhares de chamadas por passada.
  const pass = ensurePass(n);
  let i = 0;
  let x = 0;
  let y = 0;
  for (i = 0; i < n; i++) {
    x = i % w;
    y = (i - x) / w;
    if (src) {
      pass[i] = (walkable(src, x, y) && !(blocked && blocked.has(i))) ? 1 : 0;
    } else {
      pass[i] = (isFiniteVal(dist[i]) && !(blocked && blocked.has(i))) ? 1 : 0;
    }
  }

  let passes = 0;
  let changed = true;
  let cv = 0;
  let nd = 0;
  let d = 0;
  let dx = 0;
  let dy = 0;
  let nx = 0;
  let ny = 0;
  let ni = 0;

  while (changed && passes < maxPasses) {
    changed = false;
    passes++;

    for (i = 0; i < n; i++) {
      cv = dist[i];
      if (cv >= INF) { continue; }
      x = i % w;
      y = (i - x) / w;
      nd = cv + 1;
      for (d = 0; d < D.length; d++) {
        dx = D[d][0];
        dy = D[d][1];
        nx = x + dx;
        ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
        ni = ny * w + nx;
        if (!pass[ni] || nd >= dist[ni]) { continue; }
        if (dx !== 0 && dy !== 0) {
          if (!pass[y * w + (x + dx)] || !pass[(y + dy) * w + x]) { continue; }
        }
        dist[ni] = nd;
        changed = true;
      }
    }

    for (i = n - 1; i >= 0; i--) {
      cv = dist[i];
      if (cv >= INF) { continue; }
      x = i % w;
      y = (i - x) / w;
      nd = cv + 1;
      for (d = 0; d < D.length; d++) {
        dx = D[d][0];
        dy = D[d][1];
        nx = x + dx;
        ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
        ni = ny * w + nx;
        if (!pass[ni] || nd >= dist[ni]) { continue; }
        if (dx !== 0 && dy !== 0) {
          if (!pass[y * w + (x + dx)] || !pass[(y + dy) * w + x]) { continue; }
        }
        dist[ni] = nd;
        changed = true;
      }
    }
  }

  return passes;
}

// --- flee ------------------------------------------------------------------

/**
 * Gradiente de fuga (R36). Multiplica os valores FINITOS por `factor`
 * (padrão -1.2) e re-escaneia até estabilizar. O resultado é um campo cujos
 * mínimos locais ficam LONGE do jogador: descer por ele = fugir.
 *
 * `Math.round` é usado na multiplicação porque o campo é inteiro; como
 * |factor| > 1, o arredondamento preserva a monotonicidade do gradiente.
 *
 * @returns novo campo (buffer próprio, nunca alias de `dmap`)
 */
export function fleeMap(dmap: Int32Array, map?: GameMap | null, factor?: number): Int32Array {
  const dims = fieldDims(dmap, map || null);
  if (!dims) { return dmap; }
  const w = dims.w;
  const h = dims.h;
  const n = w * h;
  const src = dims.map;
  const f = (typeof factor === 'number' && isFinite(factor)) ? factor : DEFAULT_FLEE_FACTOR;

  let out = grabField(fleeCache, src, n);
  if (out === dmap) { out = new Int32Array(n); }

  let i = 0;
  let v = 0;
  for (i = 0; i < n; i++) {
    v = dmap[i];
    out[i] = isFiniteVal(v) ? Math.round(v * f) : INF;
  }

  metaOf.set(out, { w: w, h: h, map: src });
  scanField(out, src, null);
  return out;
}

// --- bestStep --------------------------------------------------------------

/**
 * Melhor passo descendente a partir de (x, y).
 *
 * Empate resolvido pela ORDEM DE DIRS8 — o primeiro da ordem vence (a
 * comparação é estritamente menor, então um empate nunca substitui o
 * candidato anterior). Determinismo obrigatório (R41).
 *
 * `isBlockedFn` é chamada como (nx, ny, ni); truthy = proibido.
 *
 * @returns null se nenhum vizinho válido for ESTRITAMENTE melhor que o tile atual
 */
export function bestStep(
  dmap: Int32Array, x: number, y: number, isBlockedFn?: IsBlockedFn | null
): DijkstraStep | null {
  const dims = fieldDims(dmap, null);
  if (!dims) { return null; }
  const w = dims.w;
  const h = dims.h;
  const map = dims.map;
  if (x < 0 || y < 0 || x >= w || y >= h) { return null; }

  const D = DIRS8;
  const ci = y * w + x;
  let bestV = dmap[ci];
  let best: DijkstraStep | null = null;
  let d = 0;
  let dx = 0;
  let dy = 0;
  let nx = 0;
  let ny = 0;
  let ni = 0;
  let nv = 0;

  for (d = 0; d < D.length; d++) {
    dx = D[d][0];
    dy = D[d][1];
    nx = x + dx;
    ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
    ni = ny * w + nx;
    nv = dmap[ni];
    if (nv >= INF) { continue; }
    if (!(nv < bestV)) { continue; } // estrito: primeiro da ordem DIRS8 vence
    if (map && !walkable(map, nx, ny)) { continue; }
    if (dx !== 0 && dy !== 0) {
      if (map) {
        if (!walkable(map, x + dx, y)) { continue; }
        if (!walkable(map, x, y + dy)) { continue; }
      } else {
        if (dmap[y * w + (x + dx)] >= INF) { continue; }
        if (dmap[(y + dy) * w + x] >= INF) { continue; }
      }
    }
    if (isBlockedFn && isBlockedFn(nx, ny, ni)) { continue; }
    best = { x: nx, y: ny, v: nv };
    bestV = nv;
  }

  return best;
}

// --- extras utilitários ----------------------------------------------------

export function valueAt(dmap: Int32Array, x: number, y: number): number {
  const dims = fieldDims(dmap, null);
  if (!dims) { return INF; }
  if (x < 0 || y < 0 || x >= dims.w || y >= dims.h) { return INF; }
  return dmap[y * dims.w + x];
}

export function dimsOf(dmap: Int32Array): { w: number; h: number } | null {
  const dims = fieldDims(dmap, null);
  return dims ? { w: dims.w, h: dims.h } : null;
}
