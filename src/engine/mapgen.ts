/* ISOROGUE — src/engine/mapgen.ts
 * Geração procedural da masmorra: BSP recursivo, salas de 5 formatos,
 * corredores em L entre folhas irmãs, escada por BFS de grafo, reparo de
 * áreas isoladas por túnel e regeneração com seed derivada.
 * Cobre R12..R17 e R19. Tudo determinístico a partir de (seed, depth).
 *
 * Porte 1:1 de legacy/src-vanilla/10-mapgen.js. A ORDEM DE CONSUMO DO RNG é
 * parte do contrato: um u32() a mais ou a menos muda todos os mapas.
 */
import { CONFIG, hash32, idx, DIRS4, normalizeSeed, makeRng } from './core';
import type { GameMap, RegionsResult, Rng, Room, RoomShape } from './types';

const WALL = CONFIG.TILE.WALL;
const FLOOR = CONFIG.TILE.FLOOR;
const DOOR = CONFIG.TILE.DOOR;
const STAIRS = CONFIG.TILE.STAIRS;

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

/** BFS 4-vizinhança a partir de (sx,sy) sobre tiles caminháveis. */
function bfsFrom(tiles: Uint8Array, w: number, h: number, sx: number, sy: number): BfsResult {
  const n = w * h;
  const dist = new Int32Array(n);
  dist.fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let reached = 0;
  const s = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !isWalkVal(tiles[s])) {
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
      if (dist[ni] !== -1 || !isWalkVal(tiles[ni])) continue;
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

function countWalkable(tiles: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (isWalkVal(tiles[i])) total++;
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
// API pública
// -------------------------------------------------------------------------

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const v = map.tiles[y * map.w + x];
  return v === FLOOR || v === DOOR || v === STAIRS;
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
  notes.push('Escada na sala ' + (stairRoom ? '#' + stairRoom.id : 'mais afastada') +
    ' em (' + stairX + ',' + stairY + '), a ' + Math.max(0, bestDist) + ' ' +
    plural(Math.max(0, bestDist), 'passo', 'passos') + ' do início.');

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
