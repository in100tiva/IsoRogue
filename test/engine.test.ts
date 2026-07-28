/*
 * ISOROGUE — test/engine.test.ts
 * ------------------------------------------------------------------
 * T1..T10 de `legacy/harness-vanilla.mjs`, portados para Vitest
 * (docs/ARQUITETURA-REACT.md §7.3).
 *
 * O que muda em relação ao harness original: o engine é importado direto, sem
 * `node:vm` e sem stub de DOM — mais rápido, e a falha aponta o arquivo real.
 * O que NÃO muda: os números do contrato (60 sementes de conectividade, 40×25
 * de simetria de FOV, 400 comandos de determinismo, 300 de invariantes), as
 * sementes ('T1-0000', 'T6-DETERMINISMO', …) e o RNG que sorteia as sequências
 * de comando — tudo copiado linha a linha, para que estes testes exercitem
 * exatamente os mesmos caminhos que o harness exercitava no vanilla.
 *
 * T9 passou a varrer `dist/index.html` (o entregável do Vite), como manda o
 * §7.3; se o build ainda não existir, o próprio teste o produz.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CONFIG, DIRS8, parseCommand } from '../src/engine/core';
import { generate } from '../src/engine/mapgen';
import { checkSymmetry, computeFov, isVisibleFrom } from '../src/engine/fov';
import { DIJKSTRA_INF, bestStep, computeDijkstra, fleeMap } from '../src/engine/dijkstra';
import { populate } from '../src/engine/entities';
import { applyCommand, createState, descend, snapshot } from '../src/engine/game';
import { setStorage } from '../src/engine/save';
import type { Command, Enemy, Game, GameMap, Point } from '../src/engine/types';

/* O autosave não pode vazar de um teste para o outro (nem existir em Node). */
setStorage(null);

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/* ------------------------------------------------------------------ *
 * Números do contrato (§11 do CONTRACTS.md) — NÃO reduza
 * ------------------------------------------------------------------ */

const N = {
  t1Sementes: 60,
  t2Sementes: 12,
  t3Sementes: 12,
  t4Sementes: 40,
  t4Origens: 25,
  t5Sementes: 12,
  t5Origens: 40,
  t6Comandos: 400,
  t7Turnos: 300,
  t8Sementes: 8,
  t10Niveis: 5
};

/* Testes pesados: o padrão de 5 s do Vitest não cabe em 60 mapas + 1000 FOVs. */
const LENTO = 300_000;

/* ------------------------------------------------------------------ *
 * Utilitários do harness (cópia literal de legacy/harness-vanilla.mjs)
 * ------------------------------------------------------------------ */

/** RNG determinístico do PRÓPRIO teste — nada de Math.random em lugar nenhum. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface RngLocal {
  u32(): number;
  next(): number;
  int(a: number, b: number): number;
}

function rngLocal(semente: number): RngLocal {
  let s = semente >>> 0;
  const rng: RngLocal = {
    u32() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    next() {
      return rng.u32() / 4294967296;
    },
    int(a, b) {
      return a + Math.floor(rng.next() * (b - a + 1));
    }
  };
  return rng;
}

function pad(n: number, largura: number): string {
  return String(n).padStart(largura, '0');
}

/** Mesmo pool e mesmo RNG do harness: as sequências saem idênticas. */
function sequenciaComandos(tag: string, n: number): string[] {
  const rng = rngLocal(fnv1a('isorogue-harness#' + tag));
  const pool: string[] = [];
  for (const d of DIRS8) {
    for (let k = 0; k < 6; k++) pool.push('move:' + d[0] + ',' + d[1]);
  }
  for (let k = 0; k < 3; k++) pool.push('wait');
  for (let k = 0; k < 2; k++) pool.push('use');
  pool.push('descend');
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pool[rng.int(0, pool.length - 1)]);
  return out;
}

const WALK = new Set<number>([CONFIG.TILE.FLOOR, CONFIG.TILE.DOOR, CONFIG.TILE.STAIRS]);

function ehCaminhavel(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  return WALK.has(map.tiles[y * map.w + x]);
}

function listaCaminhaveis(map: GameMap): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (WALK.has(map.tiles[y * map.w + x])) out.push({ x: x, y: y });
    }
  }
  return out;
}

/** BFS independente (4-vizinhança) — não confia no cálculo do próprio módulo. */
function alcancaveis(map: GameMap): { total: number; vistos: Uint8Array; inicioInvalido: boolean } {
  const w = map.w;
  const h = map.h;
  const vistos = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let ini = 0;
  let fim = 0;
  const s = map.start;
  if (!s || !WALK.has(map.tiles[s.y * w + s.x])) {
    return { total: 0, vistos: vistos, inicioInvalido: true };
  }
  vistos[s.y * w + s.x] = 1;
  fila[fim++] = s.y * w + s.x;
  let total = 1;
  const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w;
    const y = (i - x) / w;
    for (const d of D4) {
      const nx = x + d[0];
      const ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (vistos[ni]) continue;
      if (!WALK.has(map.tiles[ni])) continue;
      vistos[ni] = 1;
      total++;
      fila[fim++] = ni;
    }
  }
  return { total: total, vistos: vistos, inicioInvalido: false };
}

function contarCaminhaveis(map: GameMap): number {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (WALK.has(map.tiles[i])) n++;
  }
  return n;
}

function vivos(game: Game): Enemy[] {
  const lista: Enemy[] = [];
  for (let i = 0; i < game.enemies.length; i++) {
    const e = game.enemies[i];
    if (e && typeof e.hp === 'number' && e.hp > 0) lista.push(e);
  }
  return lista;
}

/** Aplica a forma textual do harness ('move:1,0'), como no vanilla. */
function aplicar(game: Game, texto: string): boolean {
  const cmd: Command | null = parseCommand(texto);
  if (!cmd) return false;
  return applyCommand(game, cmd) === true;
}

function ondeEsta(rotulo: string, extra: Record<string, unknown>): string {
  const partes = Object.keys(extra).map((k) => k + '=' + String(extra[k]));
  return rotulo + ' — ' + partes.join(', ');
}

/* ================================================================== *
 * T1
 * ================================================================== */

describe('T1 — conectividade: ' + N.t1Sementes + ' sementes × profundidades 1..3', () => {
  it('todo tile caminhável é alcançável a partir do início', () => {
    for (let i = 0; i < N.t1Sementes; i++) {
      const semente = 'T1-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = generate(semente, depth);
        const onde = ondeEsta('T1', { semente, depth });

        expect(map.tiles.length, onde + ': tiles com tamanho errado').toBe(map.w * map.h);

        const total = contarCaminhaveis(map);
        const r = alcancaveis(map);
        expect(r.inicioInvalido, onde + ': map.start fora de tile caminhável').toBe(false);
        expect(r.total, onde + ': há tiles caminháveis inalcançáveis a partir de start').toBe(total);
        expect(map.connectivity, onde + ': map.connectivity !== 1').toBe(1);
        expect(
          Math.abs(map.connectivity - r.total / Math.max(1, total)) < 1e-9,
          onde + ': connectivity não bate com a BFS independente do teste'
        ).toBe(true);
        expect(
          ehCaminhavel(map, map.stairs.x, map.stairs.y),
          onde + ': map.stairs fora de tile caminhável'
        ).toBe(true);
      }
    }
  }, LENTO);
});

/* ================================================================== *
 * T2
 * ================================================================== */

describe('T2 — determinismo de mapa: mesma semente gera o mesmo mapa', () => {
  it('tiles, decor, rooms, start e stairs são idênticos em duas gerações', () => {
    for (let i = 0; i < N.t2Sementes; i++) {
      const semente = 'T2-' + pad(i, 4);
      for (let depth = 1; depth <= 2; depth++) {
        const a = generate(semente, depth);
        const b = generate(semente, depth);
        const onde = ondeEsta('T2', { semente, depth });

        expect(Array.from(a.tiles), onde + ': tiles divergem').toEqual(Array.from(b.tiles));
        expect(Array.from(a.decor), onde + ': decor diverge').toEqual(Array.from(b.decor));
        expect(a.rooms, onde + ': rooms divergem').toEqual(b.rooms);
        expect(a.start, onde + ': start diverge').toEqual(b.start);
        expect(a.stairs, onde + ': stairs diverge').toEqual(b.stairs);
        expect(a.seed, onde + ': map.seed diverge').toBe(b.seed);
      }
    }
  }, LENTO);
});

/* ================================================================== *
 * T3
 * ================================================================== */

describe('T3 — determinismo e regras de população', () => {
  it('mesma semente gera os mesmos inimigos e itens, dentro das regras do §6', () => {
    const chaveInimigo = (e: Enemy): string =>
      [e.kind, e.x, e.y, e.hp, e.maxHp, e.atk, e.range].join('|');
    const chaveItem = (it: { kind: string; x: number; y: number; heal: number }): string =>
      [it.kind, it.x, it.y, it.heal].join('|');

    for (let i = 0; i < N.t3Sementes; i++) {
      const semente = 'T3-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const mapa = generate(semente, depth);
        const mapb = generate(semente, depth);
        const pa = populate(mapa, depth);
        const pb = populate(mapb, depth);
        const onde = ondeEsta('T3', { semente, depth });

        expect(pa.enemies.map(chaveInimigo), onde + ': inimigos divergem entre duas populações')
          .toEqual(pb.enemies.map(chaveInimigo));
        expect(pa.items.map(chaveItem), onde + ': itens divergem entre duas populações')
          .toEqual(pb.items.map(chaveItem));

        /* cotas do contrato (R22..R25) */
        const alvoInimigos = Math.min(22, 4 + depth * 2);
        const alvoItens = Math.max(1, 3 + ((depth * 7) % 3) - Math.floor(depth / 4));
        expect(pa.enemies.length, onde + ': inimigos acima da cota').toBeLessThanOrEqual(alvoInimigos);
        expect(pa.items.length, onde + ': itens acima da cota').toBeLessThanOrEqual(alvoItens);

        const ocupados = new Set<string>();
        const registrar = (o: { x: number; y: number }, tipo: string): void => {
          const chave = o.x + ',' + o.y;
          expect(ocupados.has(chave), onde + ': duas entidades no mesmo tile (' + chave + ')')
            .toBe(false);
          ocupados.add(chave);
          expect(ehCaminhavel(mapa, o.x, o.y), onde + ': ' + tipo + ' fora de tile caminhável')
            .toBe(true);
          expect(o.x === mapa.start.x && o.y === mapa.start.y, onde + ': ' + tipo + ' sobre o start')
            .toBe(false);
          expect(o.x === mapa.stairs.x && o.y === mapa.stairs.y, onde + ': ' + tipo + ' sobre a escada')
            .toBe(false);
        };
        for (const e of pa.enemies) {
          registrar(e, 'inimigo');
          /* "dentro de SAFE_RADIUS" é lido como d < SAFE_RADIUS proibido. */
          const d = Math.max(Math.abs(e.x - mapa.start.x), Math.abs(e.y - mapa.start.y));
          expect(d, onde + ': inimigo dentro do raio seguro inicial')
            .toBeGreaterThanOrEqual(CONFIG.SAFE_RADIUS);
        }
        for (const it of pa.items) registrar(it, 'item');
      }
    }
  }, LENTO);
});

/* ================================================================== *
 * T4
 * ================================================================== */

describe('T4 — simetria de FOV: ' + N.t4Sementes + ' sementes × ' + N.t4Origens + ' origens', () => {
  it('vê(A→B) ⇔ vê(B→A) para todo par de tiles caminháveis', () => {
    const raio = CONFIG.FOV_RADIUS;
    for (let i = 0; i < N.t4Sementes; i++) {
      const semente = 'T4-' + pad(i, 4);
      const depth = 1 + (i % 3);
      const map = generate(semente, depth);
      const livres = listaCaminhaveis(map);
      const rng = rngLocal(fnv1a('T4#' + semente));
      for (let k = 0; k < N.t4Origens; k++) {
        const o = livres[rng.int(0, livres.length - 1)];
        const res = checkSymmetry(map, o.x, o.y, raio);
        const onde = ondeEsta('T4', { semente, depth, origem: '(' + o.x + ',' + o.y + ')' });

        expect(Array.isArray(res.broken), onde + ': checkSymmetry devolveu formato inesperado')
          .toBe(true);
        expect(
          res.broken.map((b) => '(' + b.x + ',' + b.y + ')'),
          onde + ': FOV assimétrico'
        ).toEqual([]);
        expect(res.tested, onde + ': checkSymmetry não testou nenhum par').toBeGreaterThan(0);
        expect(res.ok, onde + ': campo ok inconsistente com broken').toBe(res.broken.length === 0);
      }
    }
  }, LENTO);
});

/* ================================================================== *
 * T5
 * ================================================================== */

describe('T5 — FOV não vaza: nada além do raio, origem sempre visível', () => {
  it('o conjunto visível respeita o raio circular e concorda com isVisibleFrom', () => {
    const raio = CONFIG.FOV_RADIUS;
    const limite = raio + 0.5 + 1e-9;

    for (let i = 0; i < N.t5Sementes; i++) {
      const semente = 'T5-' + pad(i, 4);
      const depth = 1 + (i % 3);
      const map = generate(semente, depth);
      const livres = listaCaminhaveis(map);
      const rng = rngLocal(fnv1a('T5#' + semente));

      for (let k = 0; k < N.t5Origens; k++) {
        const o = livres[rng.int(0, livres.length - 1)];
        const set = computeFov(map, o.x, o.y, raio);
        const onde = ondeEsta('T5', { semente, depth, origem: '(' + o.x + ',' + o.y + ')' });

        expect(set instanceof Set, onde + ': computeFov não devolveu um Set').toBe(true);
        expect(set.has(o.y * map.w + o.x), onde + ': a origem não está no conjunto visível')
          .toBe(true);

        let vazou: { x: number; y: number; d: number } | null = null;
        let foraDoMapa: number | null = null;
        for (const v of Array.from(set)) {
          if (typeof v !== 'number' || v < 0 || v >= map.w * map.h) {
            if (foraDoMapa === null) foraDoMapa = v;
            continue;
          }
          const x = v % map.w;
          const y = (v - x) / map.w;
          const d = Math.sqrt((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y));
          if (d > limite && vazou === null) vazou = { x: x, y: y, d: d };
        }
        expect(foraDoMapa, onde + ': índice fora dos limites do mapa no conjunto visível')
          .toBe(null);
        expect(vazou, onde + ': tile visível além do raio ' + (raio + 0.5)).toBe(null);

        /* isVisibleFrom deve concordar com computeFov */
        const rng2 = rngLocal(fnv1a('T5v#' + semente + '#' + k));
        for (let t = 0; t < 6; t++) {
          const alvo = livres[rng2.int(0, livres.length - 1)];
          const esperado = set.has(alvo.y * map.w + alvo.x);
          const obtido = isVisibleFrom(map, o.x, o.y, alvo.x, alvo.y, raio);
          expect(
            obtido,
            onde + ': isVisibleFrom discorda de computeFov no alvo (' + alvo.x + ',' + alvo.y + ')'
          ).toBe(esperado);
        }
      }
    }
  }, LENTO);
});

/* ================================================================== *
 * T6
 * ================================================================== */

describe('T6 — determinismo de partida: ' + N.t6Comandos + ' comandos, snapshot a cada turno', () => {
  it('duas partidas com a mesma semente e a mesma sequência ficam byte a byte iguais', () => {
    const semente = 'T6-DETERMINISMO';
    const cmds = sequenciaComandos('T6', N.t6Comandos);

    const a = createState(semente, 1);
    const b = createState(semente, 1);

    /* Intervenção IDÊNTICA nas duas partidas: sem vida folgada o jogador morre
     * nos primeiros turnos e os 400 comandos viram 400 recusas — que não
     * provariam determinismo de nada. O snapshot é comparado depois de cada
     * comando, antes da próxima reposição. */
    for (const g of [a, b]) {
      g.player.maxHp = 999;
      g.player.hp = 999;
    }

    let sa = String(snapshot(a));
    let sb = String(snapshot(b));
    expect(sa, 'T6: snapshots iniciais já divergem').toBe(sb);
    expect(sa.length, 'T6: snapshot vazio').toBeGreaterThan(0);

    const reanimar = (g: Game): void => {
      if (!g.over) g.player.hp = g.player.maxHp;
    };

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      reanimar(a);
      reanimar(b);
      const ra = aplicar(a, cmd);
      const rb = aplicar(b, cmd);
      expect(ra, 'T6: applyCommand divergiu no comando #' + i + ' (' + cmd + ')').toBe(rb);
      sa = String(snapshot(a));
      sb = String(snapshot(b));
      expect(sa, 'T6: snapshots divergem após o comando #' + i + ' (' + cmd + ')').toBe(sb);
    }
  }, LENTO);
});

/* ================================================================== *
 * T7
 * ================================================================== */

describe('T7 — invariantes de turno: ' + N.t7Turnos + ' comandos', () => {
  it('turno, posições e bloqueio pós-morte respeitam o §7 a cada comando', () => {
    const semente = 'T7-INVARIANTES';
    const cmds = sequenciaComandos('T7', N.t7Turnos);
    const game = createState(semente, 1);

    /* Vida folgada nos primeiros 75% dos comandos, para que os 300 turnos sejam
     * de fato jogados; no último quarto o jogador fica à própria sorte, de modo
     * que a morte natural e o bloqueio de comandos pós-morte sejam exercitados. */
    game.player.maxHp = 999;
    game.player.hp = 999;
    const corteReanimacao = Math.floor(cmds.length * 0.75);

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      if (i < corteReanimacao && !game.over) game.player.hp = game.player.maxHp;
      const turnoAntes = game.turn;
      const nivelAntes = game.depth;
      const estavaMorto = game.over;
      const aceito = aplicar(game, cmd);
      const onde = ondeEsta('T7', { comando: '#' + i + ' ' + cmd, turno: game.turn });

      if (estavaMorto) {
        expect(aceito, onde + ': comando aceito depois de over === true').toBe(false);
        expect(game.turn, onde + ': turno avançou depois da morte').toBe(turnoAntes);
        continue;
      }

      if (aceito) {
        if (game.depth === nivelAntes) {
          expect(game.turn, onde + ': turno não incrementou exatamente 1 num comando aceito')
            .toBe(turnoAntes + 1);
        }
      } else {
        expect(game.turn, onde + ': turno avançou num comando recusado').toBe(turnoAntes);
      }

      /* invariantes espaciais */
      const map = game.map;
      const p = game.player;
      expect(ehCaminhavel(map, p.x, p.y), onde + ': jogador em tile não caminhável').toBe(true);

      const ocupados = new Map<string, Enemy>();
      for (const e of vivos(game)) {
        expect(
          ehCaminhavel(map, e.x, e.y),
          onde + ': inimigo ' + e.id + ' em tile não caminhável (' + e.x + ',' + e.y + ')'
        ).toBe(true);
        const chave = e.x + ',' + e.y;
        const outro = ocupados.get(chave);
        expect(
          outro === undefined,
          onde + ': dois inimigos no mesmo tile (' + chave + '): ' +
            (outro ? outro.id : '?') + ' e ' + e.id
        ).toBe(true);
        ocupados.set(chave, e);
        expect(
          e.x === p.x && e.y === p.y,
          onde + ': inimigo ' + e.id + ' no mesmo tile do jogador'
        ).toBe(false);
      }
    }

    /* morte forçada: nenhum comando pode ser aceito depois de over */
    if (!game.over) {
      game.over = true;
      game.player.hp = 0;
    }
    const turno = game.turn;
    for (const cmd of ['wait', 'move:1,0', 'use', 'descend']) {
      expect(aplicar(game, cmd), 'T7: comando "' + cmd + '" aceito com over === true').toBe(false);
      expect(game.turn, 'T7: turno avançou com over === true no comando "' + cmd + '"').toBe(turno);
    }
  }, LENTO);
});

/* ================================================================== *
 * T8
 * ================================================================== */

describe('T8 — Dijkstra: origem 0, alcance total, degrau máximo 1, descida até o jogador', () => {
  it('o campo é consistente e o gradiente sempre chega ao jogador', () => {
    for (let i = 0; i < N.t8Sementes; i++) {
      const semente = 'T8-' + pad(i, 4);
      const game = createState(semente, 1 + (i % 3));
      const map = game.map;
      const p = game.player;
      const w = map.w;
      const h = map.h;
      const dmap = computeDijkstra(map, [{ x: p.x, y: p.y, v: 0 }], { blocked: null });
      const onde = ondeEsta('T8', {
        semente, depth: game.depth, jogador: '(' + p.x + ',' + p.y + ')'
      });

      expect(dmap.length, onde + ': dmap com tamanho errado').toBe(w * h);
      expect(dmap[p.y * w + p.x], onde + ': valor no tile do jogador não é 0').toBe(0);
      expect(game.dmap.length, onde + ': game.dmap com tamanho errado').toBe(w * h);
      expect(game.dmap[p.y * w + p.x], onde + ': game.dmap no tile do jogador não é 0').toBe(0);

      let inalcancavel: { x: number; y: number; v: number } | null = null;
      for (let y = 0; y < h && inalcancavel === null; y++) {
        for (let x = 0; x < w; x++) {
          if (!WALK.has(map.tiles[y * w + x])) continue;
          if (dmap[y * w + x] >= DIJKSTRA_INF) {
            inalcancavel = { x: x, y: y, v: dmap[y * w + x] };
            break;
          }
        }
      }
      expect(inalcancavel, onde + ': tile caminhável com valor infinito').toBe(null);

      /* degrau máximo 1 entre vizinhos LEGALMENTE conectados (sem corte de canto) */
      let degrau: string | null = null;
      for (let y = 0; y < h && degrau === null; y++) {
        for (let x = 0; x < w && degrau === null; x++) {
          if (!WALK.has(map.tiles[y * w + x])) continue;
          const va = dmap[y * w + x];
          if (va >= DIJKSTRA_INF) continue;
          for (const d of DIRS8) {
            const nx = x + d[0];
            const ny = y + d[1];
            if (!ehCaminhavel(map, nx, ny)) continue;
            const diagonal = d[0] !== 0 && d[1] !== 0;
            if (diagonal && (!ehCaminhavel(map, x + d[0], y) || !ehCaminhavel(map, x, y + d[1]))) {
              continue; // corte de canto bloqueado: par ignorado, conforme §5
            }
            const vb = dmap[ny * w + nx];
            if (vb >= DIJKSTRA_INF) continue;
            if (Math.abs(va - vb) > 1) {
              degrau = '(' + x + ',' + y + ')=' + va + ' vs (' + nx + ',' + ny + ')=' + vb;
              break;
            }
          }
        }
      }
      expect(degrau, onde + ': vizinhos com diferença maior que 1 no Dijkstra').toBe(null);

      /* descida por bestStep chega ao jogador */
      const livres = listaCaminhaveis(map);
      const rng = rngLocal(fnv1a('T8#' + semente));
      const bloqueado = (x: number, y: number): boolean => !ehCaminhavel(map, x, y);
      for (let t = 0; t < 5; t++) {
        const o = livres[rng.int(0, livres.length - 1)];
        let cx = o.x;
        let cy = o.y;
        let passos = 0;
        let travou = false;
        while (!(cx === p.x && cy === p.y) && passos < w * h) {
          const passo = bestStep(dmap, cx, cy, bloqueado);
          if (!passo) {
            travou = true;
            break;
          }
          expect(
            dmap[passo.y * w + passo.x],
            onde + ': bestStep devolveu vizinho que não reduz o valor, de (' + cx + ',' + cy + ')'
          ).toBeLessThan(dmap[cy * w + cx]);
          cx = passo.x;
          cy = passo.y;
          passos++;
        }
        expect(
          !travou && cx === p.x && cy === p.y,
          onde + ': descida do gradiente de (' + o.x + ',' + o.y + ') parou em (' + cx + ',' + cy + ')'
        ).toBe(true);
      }

      /* gradiente de fuga */
      const fmap = fleeMap(dmap, map, -1.2);
      expect(fmap.length, onde + ': fleeMap devolveu array de tamanho errado').toBe(w * h);
      let ruim: number | null = null;
      for (let k = 0; k < dmap.length && ruim === null; k++) {
        if (dmap[k] < DIJKSTRA_INF && WALK.has(map.tiles[k]) && !(fmap[k] < DIJKSTRA_INF)) {
          ruim = k;
        }
      }
      expect(ruim, onde + ': tile alcançável ficou infinito no mapa de fuga').toBe(null);
    }
  }, LENTO);
});

/* ================================================================== *
 * T9
 * ================================================================== */

/*
 * §7.3: "T9 (construções proibidas) passa a varrer dist/index.html APÓS O
 * BUILD". O build roda SEMPRE, nunca "só se o arquivo não existir": com um
 * `dist/` velho no disco — o caso normal de quem roda `npm run build` e depois
 * mexe em `src/` — a varredura passaria verde sobre um artefato que não
 * corresponde ao código atual, que é justamente o que a parte 3 (censo de
 * tokens residuais) existe para pegar. O build custa poucos segundos.
 *
 * `htmlDoBuild` guarda o resultado para as duas partes do T9 compartilharem UM
 * build por execução — sempre fresco, nunca repetido.
 */
let htmlDoBuild: string | null = null;

function garantirBuild(): string {
  if (htmlDoBuild !== null) return htmlDoBuild;
  const arquivo = new URL('../dist/index.html', import.meta.url);
  /*
   * NODE_ENV=production é obrigatório: o Vitest roda com NODE_ENV=test, e
   * nesse modo o bundle sai com o React de DESENVOLVIMENTO — outro artefato,
   * com avisos, `Date.now()` e `Math.random()` do profiler. O que o R56
   * promete é o entregável de produção; é ele que tem de ser varrido.
   */
  execFileSync('npx', ['vite', 'build'], {
    cwd: RAIZ,
    stdio: 'pipe',
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: 'production' }
  });
  expect(existsSync(arquivo), 'T9: dist/index.html não foi produzido pelo build').toBe(true);
  htmlDoBuild = readFileSync(arquivo, 'utf8');
  return htmlDoBuild;
}

interface Ocorrencia {
  linha: number;
  coluna: number;
  /** Janela ao redor do token — o suficiente para reconhecer o contexto. */
  trecho: string;
  /** A linha inteira, usada para descartar comentários. */
  linhaTexto: string;
}

function ocorrencias(texto: string, token: string): Ocorrencia[] {
  const linhas = texto.split('\n');
  const out: Ocorrencia[] = [];
  for (let i = 0; i < linhas.length; i++) {
    let de = 0;
    for (;;) {
      const j = linhas[i].indexOf(token, de);
      if (j === -1) break;
      out.push({
        linha: i + 1,
        coluna: j + 1,
        trecho: linhas[i].slice(Math.max(0, j - 40), j + token.length + 40),
        linhaTexto: linhas[i]
      });
      de = j + token.length;
    }
  }
  return out;
}

/** Todo arquivo TypeScript/TSX de src/ — o código que É nosso. */
function fontesDoProjeto(): string[] {
  const saida = execFileSync(
    'find',
    ['src', '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')'],
    { cwd: RAIZ, encoding: 'utf8' }
  );
  return saida.split('\n').filter((l) => l.trim() !== '').sort();
}

describe('T9 — sem construções proibidas', () => {
  /*
   * Parte 1 — o NOSSO código. É o teste que pega uma regressão de verdade,
   * porque aponta o arquivo e a linha onde o programador escreveu a coisa
   * errada. `import`/`export` são exceções declaradas: o §1 da
   * ARQUITETURA-REACT.md exige ESM e o bundler os elimina no entregável.
   */
  it('nenhuma fonte de src/ usa Math.random, eval, new Function, rede ou URL externa', () => {
    const proibidos = [
      'Math.random', 'require(', 'eval(', 'new Function',
      'http://', 'https://', 'XMLHttpRequest', 'WebSocket', 'fetch('
    ];
    for (const rel of fontesDoProjeto()) {
      const conteudo = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
      for (const token of proibidos) {
        const achados = ocorrencias(conteudo, token)
          // Comentário de linha inteira é prosa, não código — mesma regra do
          // tools/check-boundaries.mjs.
          .filter((o) => !/^\s*(\/\/|\*|\/\*)/.test(o.linhaTexto));
        expect(
          achados.map((o) => rel + ':' + o.linha + ':' + o.coluna + ' — ' + o.trecho.trim()),
          'T9: token proibido "' + token + '" em ' + rel
        ).toEqual([]);
      }
    }
  }, LENTO);

  /*
   * Parte 2 — o ENTREGÁVEL. R56/§8.6: um único arquivo, sem nenhuma referência
   * de rede. Aqui a busca é por REFERÊNCIA (o que o navegador iria buscar), não
   * por substring: o bundle do React carrega namespaces XML ('http://www.w3.org/…')
   * e o link de erro 'https://react.dev/errors/' como texto, e nenhum deles gera
   * requisição. Ver `pendencias` do relatório de integração.
   */
  it('dist/index.html é auto-contido: nenhuma referência externa', () => {
    const html = garantirBuild();
    const referencias = [
      /<script[^>]+\bsrc\s*=\s*["']?(?!data:)[^"'>]+/gi,
      /<link[^>]+\bhref\s*=\s*["']?(?!data:)[^"'>]+/gi,
      /<img[^>]+\bsrc\s*=\s*["']?(?!data:)[^"'>]+/gi,
      /@import\s+(url\()?["']?[^"';]+/gi,
      /url\(\s*["']?https?:/gi,
      /\bimportScripts\s*\(/gi,
      /\bnew\s+Worker\s*\(\s*["']https?:/gi
    ];
    for (const re of referencias) {
      const achados = html.match(re) || [];
      expect(
        achados.map((s) => s.slice(0, 120)),
        'T9: dist/index.html referencia recurso externo'
      ).toEqual([]);
    }
    expect(html.indexOf('<!doctype html>'), 'T9: dist/index.html não começa com doctype')
      .toBeGreaterThanOrEqual(0);
    expect(html.length, 'T9: dist/index.html vazio').toBeGreaterThan(50_000);
  }, LENTO);

  /*
   * Parte 3 — censo do que sobra no bundle. Cada ocorrência residual dos tokens
   * do §11 T9 tem de casar com um padrão CONHECIDO do runtime de terceiros
   * (React 19 / polyfill de modulepreload do Vite), que o §2 da
   * ARQUITETURA-REACT.md torna obrigatório. Qualquer ocorrência nova — em
   * especial um `Math.random` escrito por nós — reprova, mostrando o contexto.
   */
  it('os tokens residuais do bundle são só do runtime React/Vite', () => {
    const html = garantirBuild();
    const permitido: Record<string, RegExp[]> = {
      // Chave interna do fiber e do registro de listeners do react-dom.
      'Math.random': [/Math\.random\(\)\.toString\(36\)/],
      // Namespaces XML e link de erro do React — texto, nunca requisição.
      'http://': [/http:\/\/www\.w3\.org\//],
      'https://': [/https:\/\/react\.dev\/errors\//],
      // Polyfill de modulepreload do Vite: sem <link rel=modulepreload> no
      // single-file, o laço não itera e o fetch nunca é chamado.
      'fetch(': [/fetch\([a-zA-Z_$][\w$]*\.href/],
      // Agendador do React (Date.now/performance.now) + o laço de rAF do
      // GameCanvas, onde o §5 autoriza o relógio para animação.
      'Date.now': [/Date\.now\(\)/],
      'performance.now': [/performance\.now/],
      // Nunca aceitos, em contexto nenhum.
      'eval(': [],
      'new Function': [],
      'require(': [],
      'import ': []
    };
    for (const token of Object.keys(permitido)) {
      const padroes = permitido[token];
      const suspeitas = ocorrencias(html, token).filter(
        (o) => !padroes.some((re) => re.test(o.trecho))
      );
      expect(
        suspeitas.map((o) => 'dist/index.html:' + o.linha + ':' + o.coluna + ' — ' + o.trecho),
        'T9: ocorrência não prevista de "' + token + '" no entregável'
      ).toEqual([]);
    }
  }, LENTO);
});

/* ================================================================== *
 * T10
 * ================================================================== */

describe('T10 — progressão: descer ' + N.t10Niveis + ' níveis, dificuldade e estatísticas', () => {
  it('a dificuldade sobe e as estatísticas acumulam entre níveis', () => {
    const semente = 'T10-PROGRESSAO';
    const game = createState(semente, 1);

    interface Medida {
      depth: number;
      inimigos: number;
      mediaHp: number;
      maxHp: number;
      turnos: number;
      deepest: number;
    }
    const medir = (): Medida => {
      const vs = vivos(game);
      const somaHp = vs.reduce((s, e) => s + (e.maxHp || e.hp || 0), 0);
      return {
        depth: game.depth,
        inimigos: vs.length,
        mediaHp: vs.length ? somaHp / vs.length : 0,
        maxHp: game.player.maxHp,
        turnos: game.stats.turns,
        deepest: game.stats.deepest
      };
    };

    const historico: Medida[] = [medir()];

    for (let nivel = 1; nivel <= N.t10Niveis; nivel++) {
      const antesTurnos = game.stats.turns;
      for (let k = 0; k < 3; k++) {
        game.player.hp = game.player.maxHp;
        aplicar(game, 'wait');
      }
      expect(game.stats.turns, 'T10: estatística de turnos não acumulou no nível ' + game.depth)
        .toBeGreaterThan(antesTurnos);

      const antes = medir();
      game.player.hp = game.player.maxHp;
      game.player.x = game.map.stairs.x;
      game.player.y = game.map.stairs.y;
      aplicar(game, 'descend');
      if (game.depth === antes.depth) descend(game);

      const agora = medir();
      expect(agora.depth, 'T10: não desceu de nível a partir do ' + antes.depth)
        .toBe(antes.depth + 1);
      expect(game.over, 'T10: jogo terminou durante a descida').toBe(false);
      expect(agora.maxHp, 'T10: maxHp do jogador não subiu 2 ao descer').toBe(antes.maxHp + 2);
      const cota = Math.min(22, 4 + agora.depth * 2);
      expect(agora.inimigos, 'T10: inimigos acima da cota do nível ' + agora.depth)
        .toBeLessThanOrEqual(cota);
      expect(game.stats.deepest, 'T10: stats.deepest não acompanhou a descida')
        .toBeGreaterThanOrEqual(agora.depth);
      historico.push(agora);
    }

    const primeiro = historico[0];
    const ultimo = historico[historico.length - 1];
    expect(ultimo.depth, 'T10: profundidade final inesperada').toBe(primeiro.depth + N.t10Niveis);
    expect(ultimo.inimigos, 'T10: quantidade de inimigos não cresceu')
      .toBeGreaterThan(primeiro.inimigos);
    expect(ultimo.mediaHp, 'T10: vida média dos inimigos não cresceu')
      .toBeGreaterThan(primeiro.mediaHp);
    expect(ultimo.turnos, 'T10: stats.turns não acumulou entre níveis')
      .toBeGreaterThan(primeiro.turnos);
  }, LENTO);
});
