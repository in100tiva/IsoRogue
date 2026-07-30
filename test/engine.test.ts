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

import { CONFIG, DIRS8, formatCommand, hash32, makeRng, parseCommand } from '../src/engine/core';
import { generate, isWalkable, roomAt } from '../src/engine/mapgen';
import { checkSymmetry, computeFov, isVisibleFrom } from '../src/engine/fov';
import { DIJKSTRA_INF, bestStep, computeDijkstra, fleeMap } from '../src/engine/dijkstra';
import {
  ALQUIMIA_EXTRAS_MAX,
  ARCHETYPES,
  ARMA_NIVEL_MAX,
  CRIATURAS,
  DROPS,
  ITEM_KINDS,
  ITENS,
  KINDS,
  POTION_HEAL,
  PRECO_POCAO,
  RECEITAS,
  RECEITA_KINDS,
  descDaMissao,
  ehMaterial,
  gerarMissoes,
  itemPrincipal,
  makeItem,
  nomeDaMissao,
  pesosSpawn,
  populate
} from '../src/engine/entities';
import { applyCommand, createState, descend, restore, snapshot } from '../src/engine/game';
import { read as lerSave, setStorage, write as escreverSave } from '../src/engine/save';
import type { StorageLike } from '../src/engine/save';
import type {
  ArchetypeKey,
  Bag,
  Command,
  Enemy,
  Game,
  GameMap,
  Item,
  MaterialKind,
  Missao,
  Point
} from '../src/engine/types';

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
        const pa = populate(mapa, depth, 1);
        const pb = populate(mapb, depth, 1);
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

/* ================================================================== *
 * T11 — balanceamento §15 do BESTIARIO (XP em escala + spawn por nível)
 * ================================================================== */

describe('T11 — a escala de XP e a mistura de spawn pelo nível do herói', () => {
  it('a tabela de pesos segue o contrato, com clamp nos dois extremos', () => {
    // colunas: [chaser (goblin), sentinel (ogro), linker (slime)]
    expect(pesosSpawn(1)).toEqual([10, 1, 100]);
    expect(pesosSpawn(2)).toEqual([100, 10, 30]);
    expect(pesosSpawn(3)).toEqual([40, 100, 10]);
    expect(pesosSpawn(4)).toEqual([15, 100, 3]);
    expect(pesosSpawn(99), 'T11: acima do 4 vale a régua do 4').toEqual([15, 100, 3]);
    expect(pesosSpawn(0), 'T11: abaixo do 1 vale a régua do 1').toEqual([10, 1, 100]);
  });

  it('cada monstro declara o nível do contrato: slime 1, goblin 2, ogro 3', () => {
    expect(ARCHETYPES.linker.nivel, 'T11: slime (linker)').toBe(1);
    expect(ARCHETYPES.chaser.nivel, 'T11: goblin (chaser)').toBe(2);
    expect(ARCHETYPES.sentinel.nivel, 'T11: ogro (sentinel)').toBe(3);
  });

  it('a mistura desloca com o nível do herói e permanece determinística', () => {
    const contar = (nivel: number): Record<ArchetypeKey, number> => {
      const conta: Record<ArchetypeKey, number> = { chaser: 0, sentinel: 0, linker: 0 };
      for (let s = 0; s < 24; s++) {
        const pop = populate(generate('T11-MISTURA-' + s, 2), 2, nivel);
        for (const e of pop.enemies) conta[e.kind]++;
      }
      return conta;
    };
    const l1 = contar(1);
    const l2 = contar(2);
    const l3 = contar(3);
    const l4 = contar(4);
    // herói 1: a masmorra é dos slimes (100 contra 10 e 1)
    expect(l1.linker, 'T11: herói 1 devia ser dos slimes').toBeGreaterThan(l1.chaser * 3);
    // herói 2: os goblins dominam
    expect(l2.chaser, 'T11: herói 2 devia ser dos goblins').toBeGreaterThan(l2.linker * 2);
    // herói 3: os ogros dominam e o slime já é minoria
    expect(l3.sentinel, 'T11: herói 3 devia ser dos ogros').toBeGreaterThan(l3.chaser);
    expect(l3.sentinel, 'T11: herói 3 com slime minoritário').toBeGreaterThan(l3.linker * 3);
    // herói 4+: slime raro em absoluto, ogro comum, goblin em minoria
    expect(l4.linker, 'T11: herói 4 com slime raro').toBeLessThan(l1.linker / 4);
    expect(l4.sentinel, 'T11: herói 4 com ogro comum').toBeGreaterThan(l4.chaser * 3);
    // mesma semente + mesmo nível → mesma mistura, sempre
    const a = populate(generate('T11-DET', 1), 1, 3).enemies.map((e) => e.kind);
    const b = populate(generate('T11-DET', 1), 1, 3).enemies.map((e) => e.kind);
    expect(a, 'T11: populate divergiu com os mesmos argumentos').toEqual(b);
  }, LENTO);

  it('o XP do abate obedece à escala: 100 no próprio nível, 200/400 acima, 50/25/0 abaixo', () => {
    const game = createState('T11-XP', 1);
    const fabricar = (id: number, kind: ArchetypeKey): Enemy | null => {
      for (const d of DIRS8) {
        const x = game.player.x + d[0];
        const y = game.player.y + d[1];
        if (!isWalkable(game.map, x, y)) continue;
        if (game.enemies.some((e) => e.x === x && e.y === y)) continue;
        const ent: Enemy = {
          id: id, kind: kind, x: x, y: y, hp: 1, maxHp: 1, atk: 1, range: 1,
          state: 'idle', plan: '', lastDmg: 0, bump: 0
        };
        game.enemies.push(ent);
        return ent;
      }
      return null;
    };
    const matar = (ent: Enemy | null): void => {
      expect(ent, 'T11: sem tile livre ao redor do jogador para o abate').not.toBe(null);
      if (!ent) return;
      const dx = ent.x - game.player.x;
      const dy = ent.y - game.player.y;
      game.player.atk = 50; // golpe certeiro: o abate é o que está em teste
      aplicar(game, 'move:' + dx + ',' + dy);
    };

    // nível 1 mata slime (nível 1): +100 xp → sobe ao 2 e zera o acumulado
    game.player.level = 1;
    game.player.xp = 0;
    matar(fabricar(901, 'linker'));
    expect(game.player.level, 'T11: 100 xp não subiu exatamente um nível').toBe(2);
    expect(game.player.xp, 'T11: o excedente devia zerar (100 justos)').toBe(0);

    // nível 2 mata slime (nível 1): +50 xp, sem subir
    matar(fabricar(902, 'linker'));
    expect(game.player.level, 'T11: 50 xp não devia subir').toBe(2);
    expect(game.player.xp, 'T11: slime no nível 2 devia render 50').toBe(50);

    // nível 2 mata goblin (nível 2): +100 xp → sobe ao 3 carregando os 50
    matar(fabricar(903, 'chaser'));
    expect(game.player.level, 'T11: 50+100 xp devia subir um nível').toBe(3);
    expect(game.player.xp, 'T11: o excedente (50) devia CARREGAR').toBe(50);

    // nível 3 mata ogro (nível 3): +100 xp → sobe ao 4 com 50 de sobra
    matar(fabricar(904, 'sentinel'));
    expect(game.player.level, 'T11: ogro no próprio nível devia render 100').toBe(4);
    expect(game.player.xp, 'T11: excedente de 50 carregado').toBe(50);

    // nível 4 mata slime (nível 1): sem xp — o corte do contrato (3 acima)
    game.player.xp = 0;
    matar(fabricar(905, 'linker'));
    expect(game.player.level, 'T11: slime no nível 4 não devia render nível').toBe(4);
    expect(game.player.xp, 'T11: slime no nível 4 devia render 0 xp').toBe(0);

    // nível 4 mata goblin (nível 2): dois níveis abaixo = 25 xp
    matar(fabricar(906, 'chaser'));
    expect(game.player.xp, 'T11: goblin dois níveis abaixo devia render 25').toBe(25);

    // nível 1 mata goblin (nível 2): um nível ACIMA = 200 xp = dois níveis
    game.player.level = 1;
    game.player.xp = 0;
    matar(fabricar(907, 'chaser'));
    expect(game.player.level, 'T11: 200 xp devia render dois níveis').toBe(3);
    expect(game.player.xp, 'T11: 200 xp justos, excedente zero').toBe(0);

    // nível 1 mata ogro (nível 3): dois níveis ACIMA = 400 xp = quatro níveis
    game.player.level = 1;
    game.player.xp = 0;
    matar(fabricar(908, 'sentinel'));
    expect(game.player.level, 'T11: 400 xp devia render quatro níveis').toBe(5);
    expect(game.player.xp, 'T11: 400 xp justos, excedente zero').toBe(0);
  }, LENTO);
});

/* ================================================================== *
 * T12 — despojos, fase 1: drop no abate, bolsa e determinismo
 *
 * O que estes testes protegem, em uma frase cada:
 *   · o loot é determinístico pela semente (T12.1);
 *   · o loot e o combate são streams SEPARADOS — mexer num não move o outro
 *     (T12.2), e cada abate consome do loot uma quantia fixa (T12.3);
 *   · itens empilham no tile e a coleta recolhe a pilha inteira somando certo
 *     na bolsa (T12.4);
 *   · bolsa e `kind` sobrevivem ao save, e um save legado (sem nenhum dos dois)
 *     ainda carrega (T12.5);
 *   · o `snapshot()` expõe kind, bolsa (em ordem de TABELA) e rngLoot (T12.6) —
 *     garantias da fase 1 que as etiquetas seguintes não podem ter perdido.
 * ================================================================== */

/** Armazenamento de memória: o save do teste não encosta em disco nem em DOM. */
function armazemDeMemoria(): StorageLike {
  const dados = new Map<string, string>();
  return {
    getItem: (k) => (dados.has(k) ? (dados.get(k) as string) : null),
    setItem: (k, v) => {
      dados.set(k, String(v));
    },
    removeItem: (k) => {
      dados.delete(k);
    }
  };
}

/** Soma de tudo que está na bolsa — serve para provar que o teste não é vazio. */
function somaBolsa(bag: Bag): number {
  let total = 0;
  for (const kind of ITEM_KINDS) {
    if (!ehMaterial(kind)) continue;
    total += bag[kind] || 0;
  }
  return total;
}

/** Bolsa em texto, na ordem da tabela — comparável com `toBe`, não com `toEqual`. */
function bolsaEmTexto(bag: Bag): string {
  const partes: string[] = [];
  for (const kind of ITEM_KINDS) {
    if (!ehMaterial(kind)) continue;
    partes.push(kind + '=' + (bag[kind] || 0));
  }
  return partes.join(',');
}

function itensEmTexto(game: Game): string[] {
  return game.items.slice()
    .sort((a, b) => a.id - b.id)
    .map((it) => it.id + ':' + it.kind + ':' + it.x + ':' + it.y);
}

/**
 * Projeção do estado de COMBATE — tudo que a sorte do despojo não pode tocar.
 * Note o que está de fora: itens do chão, bolsa e `rngLoot`. É isso que faz o
 * teste de independência dizer alguma coisa.
 */
function estadoDeCombate(game: Game): string {
  const p = game.player;
  const inimigos = game.enemies.slice().sort((a, b) => a.id - b.id)
    .map((e) => e.id + ':' + e.kind + ':' + e.hp + ':' + e.x + ':' + e.y + ':' + e.state)
    .join('|');
  const s = game.stats;
  return [
    't=' + game.turn, 'over=' + (game.over ? 1 : 0), 'd=' + game.depth,
    'p=' + p.x + ',' + p.y + ',' + p.hp + '/' + p.maxHp + ',atk' + p.atk +
      ',poc' + p.potions + ',lv' + p.level + ':' + p.xp,
    'E[' + inimigos + ']',
    'S=' + s.kills + ',' + s.dmgDealt + ',' + s.dmgTaken + ',' + s.itemsUsed,
    'rng=' + (game.rngCombat.s >>> 0)
  ].join('|');
}

/** Tile vizinho caminhável, sem inimigo e sem item — o palco limpo da coleta. */
function tileLimpoAoLado(game: Game): { x: number; y: number; dx: number; dy: number } | null {
  for (const d of DIRS8) {
    /* Só ortogonais: a diagonal tem a regra de corte de canto e um passo
     * recusado transformaria a falha do teste numa charada. */
    if (d[0] !== 0 && d[1] !== 0) continue;
    const x = game.player.x + d[0];
    const y = game.player.y + d[1];
    if (!isWalkable(game.map, x, y)) continue;
    if (game.enemies.some((e) => e.hp > 0 && e.x === x && e.y === y)) continue;
    if (game.items.some((it) => it.x === x && it.y === y)) continue;
    return { x: x, y: y, dx: d[0], dy: d[1] };
  }
  return null;
}

/** Planta um inimigo de 1 de vida colado no jogador, para um abate sob medida. */
function plantarInimigo(game: Game, id: number, kind: ArchetypeKey): Enemy | null {
  for (const d of DIRS8) {
    const x = game.player.x + d[0];
    const y = game.player.y + d[1];
    if (!isWalkable(game.map, x, y)) continue;
    if (game.enemies.some((e) => e.x === x && e.y === y)) continue;
    const ent: Enemy = {
      id: id, kind: kind, x: x, y: y, hp: 1, maxHp: 1, atk: 1, range: 1,
      state: 'idle', plan: '', lastDmg: 0, bump: 0
    };
    game.enemies.push(ent);
    return ent;
  }
  return null;
}

/** Partida de despojos: golpe que sempre abate, vida folgada, N comandos. */
function partidaDeLoot(
  semente: string,
  tag: string,
  n: number,
  ajuste?: (g: Game) => void
): Game {
  const g = createState(semente, 1);
  g.player.maxHp = 999;
  g.player.hp = 999;
  /* Ataque absurdo de propósito: cada golpe é um abate, e um abate é um
   * sorteio de despojo. Sem isso, 160 comandos rendem loot quase nenhum e o
   * teste passaria a verde sem exercitar nada. */
  g.player.atk = 99;
  if (ajuste) ajuste(g);
  for (const cmd of sequenciaComandos(tag, n)) {
    if (!g.over) g.player.hp = g.player.maxHp;
    aplicar(g, cmd);
  }
  return g;
}

describe('T12 — despojos: drop no abate, bolsa e determinismo do loot', () => {
  it('as tabelas ITENS e DROPS são as do contrato da fase 1', () => {
    /* Valores de moeda (fase 2 usa; a fase 1 só guarda) e o que é material. */
    expect(ITENS.gosma.valor, 'T12.0: gosma').toBe(3);
    expect(ITENS.orelhaGoblin.valor, 'T12.0: orelha de goblin').toBe(5);
    expect(ITENS.espadaGoblin.valor, 'T12.0: cimitarra de goblin').toBe(18);
    expect(ITENS.peOgro.valor, 'T12.0: pé de ogro').toBe(12);
    expect(ITENS.clavaOgro.valor, 'T12.0: clava de ogro').toBe(40);

    expect(ITENS.potion.material, 'T12.0: a poção NÃO é material (contrato antigo R7)')
      .toBe(false);
    expect(ehMaterial('potion'), 'T12.0: poção fora da bolsa').toBe(false);
    for (const kind of ITEM_KINDS) {
      if (kind === 'potion') continue;
      expect(ehMaterial(kind), 'T12.0: ' + kind + ' devia ser material').toBe(true);
      const def = ITENS[kind];
      expect(def.key, 'T12.0: chave da ficha de ' + kind).toBe(kind);
      expect(def.nome.length > 0 && def.plural.length > 0 && def.desc.length > 0,
        'T12.0: ' + kind + ' sem nome, plural ou descrição').toBe(true);
    }

    /* A tabela de despojos, entrada por entrada e NA ORDEM (que é desempate
     * determinístico: fixa a ordem dos sorteios e dos ids dos itens). */
    expect(DROPS.linker.map((d) => d.item + ':' + d.chance), 'T12.0: Slime (linker)')
      .toEqual(['gosma:0.7']);
    expect(DROPS.chaser.map((d) => d.item + ':' + d.chance), 'T12.0: Goblin (chaser)')
      .toEqual(['orelhaGoblin:0.5', 'espadaGoblin:0.15']);
    expect(DROPS.sentinel.map((d) => d.item + ':' + d.chance), 'T12.0: Ogro (sentinel)')
      .toEqual(['peOgro:0.45', 'clavaOgro:0.2']);
  });

  it('mesma semente e mesma sequência ⇒ mesmos despojos (posição, kind e ordem de id)', () => {
    const a = partidaDeLoot('T12-DETERMINISMO', 'T12det', 160);
    const b = partidaDeLoot('T12-DETERMINISMO', 'T12det', 160);

    /* O teste só vale se a partida realmente matou e realmente largou coisa. */
    expect(a.stats.kills, 'T12.1: a partida não abateu ninguém — teste vazio')
      .toBeGreaterThan(0);
    const materiaisNoChao = a.items.filter((it) => ehMaterial(it.kind)).length;
    expect(
      materiaisNoChao + somaBolsa(a.player.bag),
      'T12.1: nenhum despojo foi gerado — teste vazio'
    ).toBeGreaterThan(0);

    expect(itensEmTexto(b), 'T12.1: itens do chão divergem entre duas partidas iguais')
      .toEqual(itensEmTexto(a));
    expect(bolsaEmTexto(b.player.bag), 'T12.1: bolsa diverge entre duas partidas iguais')
      .toBe(bolsaEmTexto(a.player.bag));
    expect(b.rngLoot.s >>> 0, 'T12.1: o stream de despojo parou em posições diferentes')
      .toBe(a.rngLoot.s >>> 0);
    expect(b.proxItemId, 'T12.1: o contador de id de item divergiu').toBe(a.proxItemId);
    expect(String(snapshot(b)), 'T12.1: snapshots divergem').toBe(String(snapshot(a)));
  }, LENTO);

  it('trocar SÓ a sorte do despojo não muda uma vírgula do combate', () => {
    const semente = 'T12-STREAMS';
    const cmds = sequenciaComandos('T12str', 160);
    const a = createState(semente, 1);
    const b = createState(semente, 1);
    for (const g of [a, b]) {
      g.player.maxHp = 999;
      g.player.hp = 999;
      g.player.atk = 99;
    }
    /* ÚNICA diferença entre as duas partidas: onde o stream de loot começa.
     * Se `rngCombat` fosse consumido pelo loot (ou vice-versa), o dano, a
     * posição dos inimigos e o XP passariam a depender disto. */
    b.rngLoot = makeRng(hash32(semente + '#loot#outra-sorte'));

    expect(estadoDeCombate(b), 'T12.2: estados de combate já divergem no início')
      .toBe(estadoDeCombate(a));

    for (let i = 0; i < cmds.length; i++) {
      if (!a.over) a.player.hp = a.player.maxHp;
      if (!b.over) b.player.hp = b.player.maxHp;
      const ra = aplicar(a, cmds[i]);
      const rb = aplicar(b, cmds[i]);
      expect(rb, 'T12.2: applyCommand divergiu no comando #' + i + ' (' + cmds[i] + ')')
        .toBe(ra);
      expect(
        estadoDeCombate(b),
        'T12.2: o combate divergiu após o comando #' + i + ' (' + cmds[i] + ') — ' +
          'a sorte do despojo vazou para o stream de combate'
      ).toBe(estadoDeCombate(a));
    }

    expect(b.rngCombat.s >>> 0, 'T12.2: rngCombat parou em posições diferentes')
      .toBe(a.rngCombat.s >>> 0);

    /* Contraprova: a sorte do despojo REALMENTE mudou. Sem isto o bloco acima
     * estaria comparando duas partidas idênticas e não provaria nada.
     * A comparação é do QUADRO COMPLETO do loot — chão MAIS bolsa —, porque
     * numa caminhada aleatória o jogador costuma passar por cima do próprio
     * abate e o despojo migra do chão para a bolsa. */
    const lootDe = (g: Game): string =>
      itensEmTexto(g).join('|') + ' # ' + bolsaEmTexto(g.player.bag);
    expect(a.stats.kills, 'T12.2: a partida não abateu ninguém — contraprova vazia')
      .toBeGreaterThan(0);
    expect(
      somaBolsa(a.player.bag) + a.items.filter((it) => ehMaterial(it.kind)).length,
      'T12.2: nenhum despojo foi gerado — contraprova vazia'
    ).toBeGreaterThan(0);
    expect(lootDe(b), 'T12.2: o loot não mudou — a contraprova do teste falhou')
      .not.toBe(lootDe(a));
  }, LENTO);

  it('cada abate consome do rngLoot uma tiragem por linha da tabela, dê no que der', () => {
    const game = createState('T12-CONSUMO', 1);
    game.player.maxHp = 999;
    game.player.hp = 999;
    game.player.atk = 99;

    let id = 8100;
    for (const kind of KINDS) {
      const ent = plantarInimigo(game, id++, kind);
      expect(ent, 'T12.3: sem tile livre ao redor do jogador para plantar o alvo')
        .not.toBe(null);
      if (!ent) return;
      const alvo = { x: ent.x, y: ent.y };
      const idsAntes = new Set(game.items.map((it) => it.id));
      const proxAntes = game.proxItemId;

      /* Quanto o stream DEVERIA andar: uma tiragem por linha da tabela, nem
       * mais nem menos — o resultado do sorteio não pode alterar o consumo. */
      const esperado = makeRng(game.rngLoot.s);
      for (let k = 0; k < DROPS[kind].length; k++) esperado.u32();

      game.player.hp = game.player.maxHp;
      const aceito = aplicar(game, 'move:' + (ent.x - game.player.x) + ',' + (ent.y - game.player.y));
      expect(aceito, 'T12.3: o golpe em ' + kind + ' não foi aceito').toBe(true);

      expect(
        game.rngLoot.s >>> 0,
        'T12.3: o abate de ' + kind + ' consumiu do rngLoot algo diferente de ' +
          DROPS[kind].length + ' tiragem(ns)'
      ).toBe(esperado.s >>> 0);

      const novos = game.items.filter((it) => !idsAntes.has(it.id));
      const permitidos = DROPS[kind].map((d) => d.item);
      for (const it of novos) {
        expect(
          permitidos.indexOf(it.kind as MaterialKind) >= 0,
          'T12.3: ' + kind + ' largou ' + it.kind + ', que não está na tabela dele'
        ).toBe(true);
        expect(
          it.x === alvo.x && it.y === alvo.y,
          'T12.3: despojo em (' + it.x + ',' + it.y + '), fora do tile do abate ' +
            '(' + alvo.x + ',' + alvo.y + ')'
        ).toBe(true);
        expect(it.heal, 'T12.3: material com cura — só a poção cura').toBe(0);
      }
      /* Ids sequenciais: o contador andou exatamente o número de drops, e
       * nenhum id novo colidiu com o que já estava no chão. */
      expect(game.proxItemId, 'T12.3: o contador de id não acompanhou os drops')
        .toBe(proxAntes + novos.length);
      const ids = game.items.map((it) => it.id);
      expect(new Set(ids).size, 'T12.3: id de item repetido no chão').toBe(ids.length);
    }
  }, LENTO);

  it('itens empilham no tile e a coleta recolhe a pilha inteira, somando na bolsa', () => {
    const game = createState('T12-PILHA', 1);
    game.player.maxHp = 999;
    game.player.hp = 999;
    const alvo = tileLimpoAoLado(game);
    expect(alvo, 'T12.4: nenhum tile vizinho limpo para montar a pilha').not.toBe(null);
    if (!alvo) return;

    /* Pilha de quatro itens de três tipos no MESMO tile. */
    const empilhados: Item[] = [
      makeItem(game.proxItemId++, alvo.x, alvo.y, 'gosma'),
      makeItem(game.proxItemId++, alvo.x, alvo.y, 'gosma'),
      makeItem(game.proxItemId++, alvo.x, alvo.y, 'orelhaGoblin'),
      makeItem(game.proxItemId++, alvo.x, alvo.y, 'potion')
    ];
    for (const it of empilhados) game.items.push(it);

    /* Estado anterior, para provar que a coleta SOMA em vez de sobrescrever. */
    game.player.bag.gosma = 3;
    game.player.potions = 3;
    const marcaDoLog = game.log.length;

    const aceito = aplicar(game, 'move:' + alvo.dx + ',' + alvo.dy);
    expect(aceito, 'T12.4: o passo sobre a pilha não foi aceito').toBe(true);
    expect(game.player.x === alvo.x && game.player.y === alvo.y,
      'T12.4: o jogador não chegou ao tile da pilha').toBe(true);

    expect(
      game.items.filter((it) => it.x === alvo.x && it.y === alvo.y).length,
      'T12.4: sobrou item no tile — a coleta não pegou a pilha inteira'
    ).toBe(0);
    expect(game.player.bag.gosma, 'T12.4: 3 na bolsa + 2 recolhidos').toBe(5);
    expect(game.player.bag.orelhaGoblin, 'T12.4: orelha não entrou na bolsa').toBe(1);
    expect(game.player.potions, 'T12.4: a poção não foi para o contador de poções').toBe(4);
    expect(
      Object.prototype.hasOwnProperty.call(game.player.bag, 'potion'),
      'T12.4: a poção entrou na BOLSA — ela é do contador, contrato antigo (R7)'
    ).toBe(false);

    /* Uma linha por TIPO, na ordem da tabela ITENS (poção, gosma, orelha) —
     * e a linha da poção byte a byte igual à de antes dos despojos. */
    const recolhas = game.log.slice(marcaDoLog)
      .map((l) => l.text)
      .filter((t) => t.indexOf('Você recolhe') === 0);
    expect(recolhas, 'T12.4: mensagens de coleta fora do padrão ou fora de ordem').toEqual([
      'Você recolhe uma poção (4 no total).',
      'Você recolhe 2 frascos de gosma (5 no total).',
      'Você recolhe uma orelha de goblin (1 no total).'
    ]);
  }, LENTO);

  it('save/restore preserva bolsa e kinds; save legado (sem bag nem kind) ainda carrega', () => {
    const armazem = armazemDeMemoria();
    const game = createState('T12-SAVE', 1);
    game.player.bag.gosma = 4;
    game.player.bag.clavaOgro = 1;
    /* A escada é caminhável e `populate` nunca põe nada nela: tile garantido
     * para um material sobreviver à validação do restore. */
    game.items.push(makeItem(game.proxItemId++, game.map.stairs.x, game.map.stairs.y, 'peOgro'));
    game.rngLoot.u32(); /* desloca o stream: queremos vê-lo viajar no save */

    expect(escreverSave(game, armazem), 'T12.5: o save não foi gravado').toBe(true);
    const lido = lerSave(armazem);
    expect(lido, 'T12.5: o save não foi lido de volta').not.toBe(null);

    const voltou = restore(lido);
    expect(voltou, 'T12.5: restore recusou um save válido').not.toBe(null);
    if (!voltou) return;

    expect(bolsaEmTexto(voltou.player.bag), 'T12.5: a bolsa não sobreviveu ao round-trip')
      .toBe(bolsaEmTexto(game.player.bag));
    expect(voltou.player.bag.gosma, 'T12.5: gosma').toBe(4);
    expect(voltou.player.bag.clavaOgro, 'T12.5: clava de ogro').toBe(1);
    expect(itensEmTexto(voltou), 'T12.5: id/kind/posição dos itens divergem')
      .toEqual(itensEmTexto(game));
    expect(voltou.proxItemId, 'T12.5: o contador de id de item não sobreviveu')
      .toBe(game.proxItemId);
    expect(voltou.rngLoot.s >>> 0, 'T12.5: o estado do rngLoot não sobreviveu')
      .toBe(game.rngLoot.s >>> 0);
    expect(voltou.player.potions, 'T12.5: as poções do contador antigo').toBe(game.player.potions);

    /* ---- save LEGADO: o de antes dos despojos, sem bag, sem kind, sem
     * contador de id e sem rngLoot. Tem de carregar, não recusar a run. ---- */
    const bruto = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    delete (bruto.player as Record<string, unknown>).bag;
    delete bruto.proxItemId;
    delete bruto.rngLoot;
    const itensBrutos = bruto.items as Array<Record<string, unknown>>;
    for (const it of itensBrutos) delete it.kind;
    /* No primeiro item também apagamos o `heal`, para exercitar o outro
     * caminho de degradação: sem kind E sem cura, o item vira a poção padrão. */
    delete itensBrutos[0].heal;

    const legado = restore(bruto);
    expect(legado, 'T12.5: restore recusou um save legado').not.toBe(null);
    if (!legado) return;
    expect(legado.player.bag, 'T12.5: save sem bag devia restaurar bolsa VAZIA').toEqual({});
    expect(
      legado.items.every((it) => it.kind === 'potion'),
      'T12.5: item sem kind devia virar poção (leitura correta de um save antigo)'
    ).toBe(true);
    expect(legado.items.length, 'T12.5: o save legado perdeu itens no caminho')
      .toBe(game.items.length);
    expect(legado.items[0].heal, 'T12.5: item sem kind e sem heal cai na cura padrão')
      .toBe(POTION_HEAL);
    let maiorId = 0;
    for (const it of legado.items) maiorId = Math.max(maiorId, it.id);
    expect(legado.proxItemId, 'T12.5: sem contador salvo, o piso é max(id)+1')
      .toBe(maiorId + 1);
    expect(legado.rngLoot, 'T12.5: sem rngLoot salvo, vale o stream semeado por createState')
      .not.toBe(null);
  }, LENTO);

  it('o snapshot expõe kind do item, bolsa em ordem de tabela e estado do rngLoot', () => {
    const game = createState('T12-SNAP', 1);
    const inicial = String(snapshot(game));

    /* A etiqueta subiu para v5 na fase 3 (as caçadas). O que este teste guarda
     * são as garantias que a fase 1 introduziu e que NÃO podem se perder na
     * troca de versão — o formato do bloco de itens, da bolsa e do rngLoot. */
    expect(inicial.indexOf('v5|'), 'T12.6: o snapshot não é v5').toBe(0);
    expect(inicial.indexOf('|B[]|') >= 0, 'T12.6: bolsa vazia devia sair como B[]').toBe(true);
    expect(
      /\|I\[\d+:potion:\d+:\d+(\|\d+:potion:\d+:\d+)*\]\|/.test(inicial),
      'T12.6: I[...] devia trazer id:kind:x:y de cada item — ' + inicial
    ).toBe(true);
    expect(
      inicial.indexOf('|rngL=' + (game.rngLoot.s >>> 0) + '|') >= 0,
      'T12.6: o estado do rngLoot não aparece no snapshot — ' + inicial
    ).toBe(true);

    /* Inserção FORA de ordem de propósito: a bolsa tem de sair na ordem da
     * tabela ITENS (gosma antes de clavaOgro), nunca na ordem de inserção. */
    game.player.bag.clavaOgro = 2;
    game.player.bag.gosma = 1;
    game.items.push(makeItem(game.proxItemId++, game.map.stairs.x, game.map.stairs.y, 'espadaGoblin'));
    const depois = String(snapshot(game));

    expect(
      depois.indexOf('|B[gosma1|clavaOgro2]|') >= 0,
      'T12.6: a bolsa saiu fora da ordem da tabela — ' + depois
    ).toBe(true);
    expect(
      depois.indexOf(':espadaGoblin:') >= 0,
      'T12.6: o kind do despojo não aparece em I[...] — ' + depois
    ).toBe(true);

    /* E o que NÃO pode aparecer: a poção não é material e não entra na bolsa. */
    expect(depois.indexOf('B[') >= 0 && depois.indexOf('potion0') === -1,
      'T12.6: contador de poção vazou para a bolsa').toBe(true);
  }, LENTO);
});

/* ================================================================== *
 * T13 — economia e oficina, fase 2: mercador, bancada, moedas e receitas
 *
 * O que estes testes protegem, em uma frase cada:
 *   · as tabelas (preço, teto de refino, receitas) são as do contrato (T13.0);
 *   · os dois pontos de parada são determinísticos pela semente e nunca caem
 *     sobre início, escada, item ou inimigo (T13.1) — ONDE eles caem é assunto
 *     do T14, que é quem guarda a regra do cômodo inicial;
 *   · negociar longe do balcão é RECUSA — sem turno e sem mexer no estado
 *     (T13.2);
 *   · vender troca material por moeda pelo valor da TABELA, com quantidade
 *     fora da faixa 1..99 recusada (T13.3);
 *   · comprar troca moeda por poção a `PRECO_POCAO`, e sem moeda não há
 *     compra (T13.4);
 *   · a alquimia e o refino cobram exatamente o que `RECEITAS` diz, e o refino
 *     respeita o teto (T13.5, T13.6);
 *   · moedas, refino e bolsa são do JOGADOR e descem a escada; os pontos são
 *     do ANDAR e ficam para trás (T13.7);
 *   · tudo isso sobrevive ao save — e um save legado, que não tem nada disso,
 *     ainda carrega (T13.8);
 *   · negociar e forjar não consomem sorteio nenhum (T13.9);
 *   · a forma textual dos três comandos é a do protocolo, ida e volta (T13.10);
 *   · o `snapshot()` mostra moedas, refino e os dois pontos (T13.11);
 *   · pisar no ponto anuncia o balcão no registro (T13.12).
 * ================================================================== */

/** Projeção do que uma NEGOCIAÇÃO pode mudar. Recusa tem de deixar isto intacto. */
function estadoDeComercio(game: Game): string {
  const p = game.player;
  return [
    't=' + game.turn,
    'moedas=' + p.moedas,
    'poc=' + p.potions,
    'atk=' + p.atk,
    'arma=' + p.armaNivel,
    'B[' + bolsaEmTexto(p.bag) + ']',
    'rng=' + (game.rngCombat.s >>> 0),
    'rngL=' + (game.rngLoot.s >>> 0)
  ].join('|');
}

/**
 * Partida montada para negociar: vida folgada e o jogador POSTO sobre o ponto.
 *
 * Teleportar em vez de caminhar é deliberado — o caminho até o mercador é
 * assunto do movimento (T6/T7), e fazer o teste andar até lá o tornaria refém
 * da IA dos monstros do andar.
 */
/**
 * Coloca o jogador AO LADO do ponto, não em cima: desde a fase 2.2 o tile é
 * sólido, e um teste que começa numa posição que o jogo nunca produziria não
 * prova comportamento, prova um estado impossível.
 */
function partidaNoPonto(semente: string, onde: 'mercador' | 'bancada'): Game {
  const game = createState(semente, 1);
  game.player.maxHp = 999;
  game.player.hp = 999;
  const ponto = onde === 'mercador' ? game.mercador : game.bancada;
  expect(ponto, 'T13: a semente ' + semente + ' não tem ' + onde).not.toBe(null);
  if (ponto) {
    let vizinho = null;
    for (let i = 0; i < DIRS8.length; i++) {
      const x = ponto.x + DIRS8[i][0];
      const y = ponto.y + DIRS8[i][1];
      if (isWalkable(game.map, x, y)) {
        vizinho = { x: x, y: y };
        break;
      }
    }
    expect(vizinho, 'T13: ' + onde + ' sem vizinho caminhável').not.toBe(null);
    if (vizinho) {
      game.player.x = vizinho.x;
      game.player.y = vizinho.y;
    }
  }
  return game;
}

/** Semente cujo nível 1 tem os DOIS pontos — a varredura é determinística. */
function sementeComParadas(): string {
  for (let i = 0; i < 64; i++) {
    const semente = 'T13-' + pad(i, 4);
    const g = createState(semente, 1);
    if (g.mercador && g.bancada) return semente;
  }
  throw new Error('T13: nenhuma das 64 sementes gerou mercador E bancada');
}

describe('T13 — economia e oficina: mercador, bancada, moedas e receitas', () => {
  it('as tabelas de economia são as do contrato da fase 2', () => {
    expect(PRECO_POCAO, 'T13.0: preço da poção').toBe(15);
    expect(ARMA_NIVEL_MAX, 'T13.0: teto de refino').toBe(5);

    /* Ordem fixa, como `ITEM_KINDS`: é ela que a UI vai listar. */
    expect(RECEITA_KINDS.slice(), 'T13.0: ordem das receitas').toEqual(['pocao', 'refino']);
    expect(RECEITAS.pocao.custo, 'T13.0: RECEITA_POCAO').toEqual({ gosma: 3 });
    expect(RECEITAS.refino.custo, 'T13.0: RECEITA_REFINO').toEqual({ espadaGoblin: 2 });

    for (const key of RECEITA_KINDS) {
      const r = RECEITAS[key];
      expect(r.key, 'T13.0: chave da ficha de ' + key).toBe(key);
      expect(
        r.nome.length > 0 && r.desc.length > 0 && r.produz.length > 0,
        'T13.0: ' + key + ' sem nome, descrição ou produto — a UI lista a partir daqui'
      ).toBe(true);
      /* Receita só cobra MATERIAL: poção é contador, não ingrediente. */
      for (const kind of Object.keys(r.custo)) {
        expect(ehMaterial(kind as MaterialKind), 'T13.0: ' + key + ' cobra ' + kind).toBe(true);
      }
    }
  });

  it('mesma semente ⇒ mesmos pontos, e eles nunca caem sobre start/escada/item/inimigo', () => {
    let comMercador = 0;
    let comBancada = 0;

    for (let i = 0; i < 24; i++) {
      const semente = 'T13-POS-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = generate(semente, depth);
        const a = populate(map, depth, 1);
        const b = populate(map, depth, 1);
        const onde = 'semente ' + semente + ' d=' + depth;

        /* Determinismo: duas chamadas, os mesmos dois pontos. */
        expect(JSON.stringify(b.mercador), 'T13.1: mercador divergiu — ' + onde)
          .toBe(JSON.stringify(a.mercador));
        expect(JSON.stringify(b.bancada), 'T13.1: bancada divergiu — ' + onde)
          .toBe(JSON.stringify(a.bancada));
        /* E o mesmo vale pelo caminho de verdade, `createState`. */
        const game = createState(semente, depth);
        expect(JSON.stringify(game.mercador), 'T13.1: createState ≠ populate (mercador) — ' + onde)
          .toBe(JSON.stringify(a.mercador));
        expect(JSON.stringify(game.bancada), 'T13.1: createState ≠ populate (bancada) — ' + onde)
          .toBe(JSON.stringify(a.bancada));

        const ocupados = new Set<string>();
        ocupados.add(map.start.x + ',' + map.start.y);
        ocupados.add(map.stairs.x + ',' + map.stairs.y);
        for (const e of a.enemies) ocupados.add(e.x + ',' + e.y);
        for (const it of a.items) ocupados.add(it.x + ',' + it.y);

        const paradas: Array<[string, Point | null]> = [
          ['mercador', a.mercador],
          ['bancada', a.bancada]
        ];
        for (const [nome, ponto] of paradas) {
          if (!ponto) continue;
          expect(isWalkable(map, ponto.x, ponto.y),
            'T13.1: ' + nome + ' em tile não caminhável — ' + onde).toBe(true);
          expect(ocupados.has(ponto.x + ',' + ponto.y),
            'T13.1: ' + nome + ' sobre início, escada, item ou inimigo — ' + onde).toBe(false);
        }
        if (a.mercador && a.bancada) {
          expect(a.mercador.x === a.bancada.x && a.mercador.y === a.bancada.y,
            'T13.1: mercador e bancada no MESMO tile — ' + onde).toBe(false);
        }

        if (a.mercador) {
          comMercador++;
          const d = Math.max(Math.abs(a.mercador.x - map.start.x),
            Math.abs(a.mercador.y - map.start.y));
          expect(d >= 2 && d <= 4,
            'T13.1: mercador a Chebyshev ' + d + ' do início (esperado 2..4) — ' + onde).toBe(true);
        }
        if (a.bancada) {
          comBancada++;
          /* A oficina deixou de ser um desvio do caminho e virou instalação da
           * entrada: mesma sala do herói. A geometria fina — anel, decoração,
           * degradação — é o T14 que prova; aqui basta que ela esteja no cômodo
           * certo, que é o que o dono não achava antes. */
          const salaBancada = roomAt(map, a.bancada.x, a.bancada.y);
          const salaInicio = roomAt(map, map.start.x, map.start.y);
          expect(salaBancada, 'T13.1: bancada fora de sala — ' + onde).not.toBe(null);
          if (salaBancada && salaInicio) {
            expect(salaBancada.id, 'T13.1: bancada FORA da sala do início — ' + onde)
              .toBe(salaInicio.id);
          }
        }
      }
    }

    /* Contraprova: o laço acima só diz alguma coisa se os pontos existirem.
     * 72 de 72 não é sorte — o cômodo inicial é uma sala de verdade e o anel
     * 2..4 do herói cai inteiro dentro do raio seguro, onde inimigo e item não
     * nascem (medido em 600 andares no T14, nenhum sem os dois pontos). O dia
     * em que faltar é mudança de MAPA que merece decisão, não um teste que
     * afrouxa o número. */
    expect(comMercador, 'T13.1: andar sem mercador — o gerador mudou').toBe(72);
    expect(comBancada, 'T13.1: andar sem bancada — o gerador mudou').toBe(72);
  }, LENTO);

  it('fora do tile certo, negociar é recusa: sem turno e sem mexer no estado', () => {
    const semente = sementeComParadas();
    const game = createState(semente, 1);
    game.player.bag.gosma = 9;
    game.player.bag.espadaGoblin = 4;
    game.player.moedas = 500;

    /* O jogador começa no start, que nunca é ponto de parada (T13.1). */
    const antes = estadoDeComercio(game);
    const marcaLog = game.log.length;
    const proibidos = ['vender:gosma,3', 'comprar:potion,1', 'criar:pocao', 'criar:refino'];
    for (const texto of proibidos) {
      expect(aplicar(game, texto), 'T13.2: ' + texto + ' foi ACEITO longe do balcão').toBe(false);
      expect(estadoDeComercio(game), 'T13.2: ' + texto + ' mexeu no estado ao ser recusado')
        .toBe(antes);
    }
    /* Uma linha de aviso por recusa: recusa muda é recusa que o jogador não
     * entende (é o mesmo contrato de 'Não há escada aqui.'). */
    const avisos = game.log.slice(marcaLog);
    expect(avisos.length, 'T13.2: uma linha de registro por recusa').toBe(proibidos.length);
    expect(avisos.every((l) => l.cls === 'aviso'), 'T13.2: recusa tem de ser classe aviso')
      .toBe(true);

    /* Cada balcão só aceita o seu ofício: no mercador não se forja, na bancada
     * não se vende. */
    /* Fase 2.2: mercador e estação dividem a sala inicial, então ao lado do
     * mercador a alquimia PODE valer (a estação é uma coisa só). O que não
     * pode é o contrário: comprar e vender fora dele. */
    const noMercador = partidaNoPonto(semente, 'mercador');
    noMercador.player.bag.gosma = 9;
    noMercador.player.moedas = 500;  /* compra exige moedas, não só estar ao lado */
    const antesM = estadoDeComercio(noMercador);
    for (const texto of ['vender:gosma,3', 'comprar:potion,1']) {
      expect(aplicar(noMercador, texto), 'T13.2: "' + texto + '" aceito no mercador')
        .toBe(true);
    }
    expect(estadoDeComercio(noMercador) === antesM, 'T13.2: vender/comprar no mercador não mudou nada')
      .toBe(false);

    const naBancada = partidaNoPonto(semente, 'bancada');
    naBancada.player.bag.gosma = 9;
    naBancada.player.moedas = 500;
    const antesB = estadoDeComercio(naBancada);
    expect(aplicar(naBancada, 'vender:gosma,3'), 'T13.2: venda aceita na bancada').toBe(false);
    expect(aplicar(naBancada, 'comprar:potion,1'), 'T13.2: compra aceita na bancada').toBe(false);
    expect(estadoDeComercio(naBancada), 'T13.2: a recusa na bancada mexeu no estado')
      .toBe(antesB);
  }, LENTO);

  it('venda: a bolsa cai, as moedas sobem pelo valor da tabela, e a quantidade tem faixa', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'mercador');
    game.player.bag.gosma = 5;
    game.player.bag.clavaOgro = 1;
    const turnoAntes = game.turn;
    const marcaLog = game.log.length;

    expect(aplicar(game, 'vender:gosma,3'), 'T13.3: a venda válida não foi aceita').toBe(true);
    expect(game.player.bag.gosma, 'T13.3: 5 − 3 na bolsa').toBe(2);
    expect(game.player.moedas, 'T13.3: 3 × ITENS.gosma.valor').toBe(3 * ITENS.gosma.valor);
    /* Negociar custa tempo: é decisão de design, e o turno prova que valeu. */
    expect(game.turn, 'T13.3: a venda tem de consumir turno').toBe(turnoAntes + 1);
    expect(
      game.log.slice(marcaLog).some((l) => l.text === 'Você vende 3 frascos de gosma por 9 moedas. Total: 9 moedas.'),
      'T13.3: a linha da venda saiu fora do padrão — ' +
        JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))
    ).toBe(true);

    /* Vender o último de um material APAGA a chave: ausência é zero (é a regra
     * da bolsa aberta, e é o que mantém `B[]` limpo no snapshot). */
    expect(aplicar(game, 'vender:clavaOgro,1'), 'T13.3: venda da clava').toBe(true);
    expect(Object.prototype.hasOwnProperty.call(game.player.bag, 'clavaOgro'),
      'T13.3: chave zerada devia sumir da bolsa').toBe(false);
    expect(game.player.moedas, 'T13.3: 9 + valor da clava').toBe(9 + ITENS.clavaOgro.valor);

    /* Recusas: mais do que se tem, e quantidade fora de 1..99. */
    const antes = estadoDeComercio(game);
    expect(aplicar(game, 'vender:gosma,3'), 'T13.3: vendeu 3 tendo 2').toBe(false);
    expect(aplicar(game, 'vender:peOgro,1'), 'T13.3: vendeu o que não tem').toBe(false);
    expect(estadoDeComercio(game), 'T13.3: a recusa por falta mexeu no estado').toBe(antes);

    for (const texto of ['vender:gosma,0', 'vender:gosma,-2', 'vender:gosma,100', 'vender:gosma,tudo']) {
      expect(parseCommand(texto), 'T13.3: "' + texto + '" não devia nem virar comando').toBe(null);
      expect(aplicar(game, texto), 'T13.3: "' + texto + '" foi aceito').toBe(false);
    }
    expect(estadoDeComercio(game), 'T13.3: quantidade inválida mexeu no estado').toBe(antes);

    /* O comando montado à mão (sem passar pelo texto) também é barrado. */
    expect(applyCommand(game, { kind: 'vender', item: 'gosma', quantidade: 100 }),
      'T13.3: 100 unidades aceitas por objeto').toBe(false);
    expect(applyCommand(game, { kind: 'vender', item: 'gosma', quantidade: 1.5 }),
      'T13.3: quantidade fracionária aceita').toBe(true);
    /* 1.5 vira 1 (mesmo `intOr` de 'move:1.7,0'): a venda acontece, uma só. */
    expect(game.player.bag.gosma, 'T13.3: 2 − 1 depois do arredondamento').toBe(1);
  }, LENTO);

  it('compra: as moedas caem, as poções sobem, e sem moeda não há poção', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'mercador');
    game.player.potions = 1;
    game.player.moedas = PRECO_POCAO * 2;
    const turnoAntes = game.turn;
    const marcaLog = game.log.length;

    expect(aplicar(game, 'comprar:potion,2'), 'T13.4: a compra válida não foi aceita').toBe(true);
    expect(game.player.moedas, 'T13.4: 2 × PRECO_POCAO gastos').toBe(0);
    expect(game.player.potions, 'T13.4: 1 + 2 poções').toBe(3);
    expect(game.turn, 'T13.4: a compra tem de consumir turno').toBe(turnoAntes + 1);
    expect(
      game.log.slice(marcaLog).some((l) => l.text.indexOf('Você compra 2 poções por 30 moedas') === 0),
      'T13.4: a linha da compra saiu fora do padrão — ' +
        JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))
    ).toBe(true);

    /* Sem moeda: recusa seca. */
    const antes = estadoDeComercio(game);
    expect(aplicar(game, 'comprar:potion,1'), 'T13.4: comprou sem moeda').toBe(false);
    expect(estadoDeComercio(game), 'T13.4: a recusa por moeda mexeu no estado').toBe(antes);

    /* Uma moeda a menos do que o preço ainda é pouco — o teste do limite. */
    game.player.moedas = PRECO_POCAO - 1;
    expect(aplicar(game, 'comprar:potion,1'), 'T13.4: comprou com 14 moedas').toBe(false);
    game.player.moedas = PRECO_POCAO;
    expect(aplicar(game, 'comprar:potion,1'), 'T13.4: 15 moedas exatas deviam bastar').toBe(true);
    expect(game.player.moedas, 'T13.4: pagou exatamente o preço').toBe(0);

    /* O mercador não vende material — nem pelo texto, nem por objeto. */
    expect(parseCommand('comprar:gosma,1'), 'T13.4: "comprar:gosma,1" virou comando').toBe(null);
  }, LENTO);

  it('alquimia: 3 gosmas viram 1 poção; com 2 na bolsa, recusa', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'bancada');
    game.player.potions = 0;
    game.player.bag.gosma = 2;

    /* Com 2 de 3, a bancada recusa e não come nada. */
    const antes = estadoDeComercio(game);
    const marcaFalta = game.log.length;
    expect(aplicar(game, 'criar:pocao'), 'T13.5: destilou com 2 gosmas').toBe(false);
    expect(estadoDeComercio(game), 'T13.5: a recusa por falta consumiu material').toBe(antes);
    expect(game.player.bag.gosma, 'T13.5: as 2 gosmas continuam na bolsa').toBe(2);
    /* A frase diz o que a receita pede E o que falta, com o verbo concordando
     * com a QUANTIA que falta (uma, singular). */
    expect(game.log.slice(marcaFalta).map((l) => l.text), 'T13.5: a recusa saiu fora do padrão')
      .toEqual(['Poção de cura pede 3 frascos de gosma. Falta um frasco de gosma.']);

    game.player.bag.gosma = 4;
    const turnoAntes = game.turn;
    const marcaLog = game.log.length;
    expect(aplicar(game, 'criar:pocao'), 'T13.5: a alquimia válida não foi aceita').toBe(true);
    expect(game.player.bag.gosma, 'T13.5: 4 − 3 gosmas').toBe(1);
    expect(game.player.potions, 'T13.5: +1 poção').toBe(1);
    expect(game.turn, 'T13.5: a alquimia tem de consumir turno').toBe(turnoAntes + 1);
    expect(game.player.moedas, 'T13.5: a bancada não cobra moeda').toBe(0);
    expect(
      game.log.slice(marcaLog).some((l) => l.text.indexOf('caldeirão') >= 0 && l.cls === 'bom'),
      'T13.5: a linha do caldeirão não saiu — ' +
        JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))
    ).toBe(true);
  }, LENTO);

  it('refino: 2 cimitarras dão +1 de ataque e +1 de refino, com o teto respeitado', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'bancada');
    const atkBase = game.player.atk;
    expect(game.player.armaNivel, 'T13.6: o refino começa em zero').toBe(0);

    /* Uma cimitarra não basta. */
    game.player.bag.espadaGoblin = 1;
    const antes = estadoDeComercio(game);
    const marcaFalta = game.log.length;
    expect(aplicar(game, 'criar:refino'), 'T13.6: refinou com 1 cimitarra').toBe(false);
    expect(estadoDeComercio(game), 'T13.6: a recusa por falta mexeu no estado').toBe(antes);
    /* Concordância do verbo com a QUANTIA: uma faltando é 'Falta', duas é
     * 'Faltam' — e não com o número de materiais distintos. */
    expect(game.log.slice(marcaFalta).map((l) => l.text), 'T13.6: recusa com 1 cimitarra')
      .toEqual(['Refino de arma pede 2 cimitarras de goblin. Falta uma cimitarra de goblin.']);
    delete game.player.bag.espadaGoblin;
    const marcaFalta2 = game.log.length;
    expect(aplicar(game, 'criar:refino'), 'T13.6: refinou com a bolsa vazia').toBe(false);
    expect(game.log.slice(marcaFalta2).map((l) => l.text), 'T13.6: recusa com bolsa vazia')
      .toEqual(['Refino de arma pede 2 cimitarras de goblin. Faltam 2 cimitarras de goblin.']);

    /* Cinco refinos: material para todos, e nem um a mais. */
    game.player.bag.espadaGoblin = 2 * (ARMA_NIVEL_MAX + 1);
    for (let n = 1; n <= ARMA_NIVEL_MAX; n++) {
      expect(aplicar(game, 'criar:refino'), 'T13.6: refino #' + n + ' recusado').toBe(true);
      expect(game.player.armaNivel, 'T13.6: nível de arma após o refino #' + n).toBe(n);
      expect(game.player.atk, 'T13.6: ataque após o refino #' + n).toBe(atkBase + n);
    }
    expect(game.player.bag.espadaGoblin, 'T13.6: 12 − 5×2 cimitarras')
      .toBe(2 * (ARMA_NIVEL_MAX + 1) - 2 * ARMA_NIVEL_MAX);

    /* No teto: recusa, com o material sobrando na bolsa. */
    const noTeto = estadoDeComercio(game);
    expect(aplicar(game, 'criar:refino'), 'T13.6: o teto de refino foi furado').toBe(false);
    expect(estadoDeComercio(game), 'T13.6: a recusa no teto mexeu no estado').toBe(noTeto);
    expect(game.player.atk, 'T13.6: o ataque passou do teto').toBe(atkBase + ARMA_NIVEL_MAX);

    /* Receita que não existe também não gasta nada. */
    expect(parseCommand('criar:banana'), 'T13.6: "criar:banana" virou comando').toBe(null);
    expect(estadoDeComercio(game), 'T13.6: receita desconhecida mexeu no estado').toBe(noTeto);
  }, LENTO);

  it('moedas, refino e bolsa descem a escada; os pontos de parada não', () => {
    const semente = sementeComParadas();
    const game = createState(semente, 1);
    game.player.moedas = 42;
    game.player.armaNivel = 2;
    game.player.bag.gosma = 7;
    const antes = {
      mercador: JSON.stringify(game.mercador),
      bancada: JSON.stringify(game.bancada)
    };

    descend(game);

    expect(game.player.moedas, 'T13.7: as moedas são do JOGADOR, descem com ele').toBe(42);
    expect(game.player.armaNivel, 'T13.7: o refino da arma desce com ele').toBe(2);
    expect(game.player.bag.gosma, 'T13.7: a bolsa desce com ele').toBe(7);
    /* Os pontos, ao contrário, são do ANDAR: o nível novo tem os seus. */
    expect(JSON.stringify(game.mercador), 'T13.7: o mercador do nível 1 sobreviveu à descida')
      .not.toBe(antes.mercador);
    expect(JSON.stringify(game.bancada), 'T13.7: a bancada do nível 1 sobreviveu à descida')
      .not.toBe(antes.bancada);
    expect(game.mercador, 'T13.7: o nível 2 nasceu sem mercador').not.toBe(null);
    expect(game.bancada, 'T13.7: o nível 2 nasceu sem bancada').not.toBe(null);
  }, LENTO);

  it('save/restore: moedas, refino e os dois pontos sobrevivem; save legado degrada', () => {
    const armazem = armazemDeMemoria();
    const semente = sementeComParadas();
    const game = createState(semente, 1);
    game.player.moedas = 137;
    game.player.armaNivel = 3;
    game.player.atk += 3;
    game.player.bag.gosma = 2;

    expect(escreverSave(game, armazem), 'T13.8: o save não foi gravado').toBe(true);
    const voltou = restore(lerSave(armazem));
    expect(voltou, 'T13.8: restore recusou um save válido').not.toBe(null);
    if (!voltou) return;

    expect(voltou.player.moedas, 'T13.8: as moedas não sobreviveram').toBe(137);
    expect(voltou.player.armaNivel, 'T13.8: o refino não sobreviveu').toBe(3);
    expect(JSON.stringify(voltou.mercador), 'T13.8: o mercador não sobreviveu')
      .toBe(JSON.stringify(game.mercador));
    expect(JSON.stringify(voltou.bancada), 'T13.8: a bancada não sobreviveu')
      .toBe(JSON.stringify(game.bancada));

    /* Um ponto GRAVADO NA PAREDE é ponto inalcançável: o restore o descarta e
     * fica com o que a geração determinística acabou de produzir. */
    const adulterado = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    adulterado.mercador = { x: 0, y: 0 };
    const consertado = restore(adulterado);
    expect(consertado, 'T13.8: restore recusou o save adulterado em vez de degradar').not.toBe(null);
    if (consertado) {
      expect(JSON.stringify(consertado.mercador), 'T13.8: mercador dentro da parede aceito')
        .toBe(JSON.stringify(game.mercador));
    }

    /* ---- save LEGADO: o de antes da fase 2, sem moeda, sem refino e sem os
     * pontos. Tem de carregar, com zero nos contadores e os pontos regerados
     * pela semente — nunca uma recusa de run. ---- */
    const bruto = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    const jogador = bruto.player as Record<string, unknown>;
    delete jogador.moedas;
    delete jogador.armaNivel;
    delete bruto.mercador;
    delete bruto.bancada;

    const legado = restore(bruto);
    expect(legado, 'T13.8: restore recusou um save legado').not.toBe(null);
    if (!legado) return;
    expect(legado.player.moedas, 'T13.8: save sem moedas devia restaurar ZERO').toBe(0);
    expect(legado.player.armaNivel, 'T13.8: save sem refino devia restaurar ZERO').toBe(0);
    expect(JSON.stringify(legado.mercador), 'T13.8: sem ponto salvo, vale o determinístico')
      .toBe(JSON.stringify(game.mercador));
    expect(JSON.stringify(legado.bancada), 'T13.8: sem ponto salvo, vale o determinístico')
      .toBe(JSON.stringify(game.bancada));

    /* Save adulterado com refino acima do teto: o teto vale na leitura também. */
    jogador.armaNivel = 99;
    const exagerado = restore(bruto);
    expect(exagerado ? exagerado.player.armaNivel : -1, 'T13.8: refino 99 aceito do save')
      .toBe(ARMA_NIVEL_MAX);
  }, LENTO);

  it('nada de sorteio: negociar e forjar não movem rngCombat nem rngLoot', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'mercador');
    game.player.bag.gosma = 9;
    game.player.moedas = 100;

    /* O turno consumido pela negociação MOVE o combate (os monstros agem), e é
     * por isso que a sonda tem de ser a própria transação: comparamos o estado
     * dos dois streams imediatamente antes e depois da chamada interna, sem
     * deixar o fim de turno rodar. É o que `applyCommand` faria se a ação
     * tivesse sorteio escondido. */
    const combateAntes = game.rngCombat.s >>> 0;
    const lootAntes = game.rngLoot.s >>> 0;
    /* Recusas: nenhuma delas chega ao fim de turno, então os dois streams têm
     * de ficar EXATAMENTE onde estavam. */
    for (const texto of ['vender:gosma,99', 'comprar:potion,99', 'criar:pocao', 'vender:gosma,0']) {
      aplicar(game, texto);
    }
    expect(game.rngCombat.s >>> 0, 'T13.9: uma recusa consumiu rngCombat').toBe(combateAntes);
    expect(game.rngLoot.s >>> 0, 'T13.9: uma recusa consumiu rngLoot').toBe(lootAntes);

    /* Transação aceita: o loot NÃO pode andar (não há despojo numa venda). O
     * combate anda, mas por causa do turno — e só do turno. */
    expect(aplicar(game, 'vender:gosma,3'), 'T13.9: a venda não foi aceita').toBe(true);
    expect(game.rngLoot.s >>> 0, 'T13.9: a venda mexeu no stream de despojos').toBe(lootAntes);
  }, LENTO);

  it('o protocolo textual dos três comandos vai e volta sem perder nada', () => {
    const casos: Array<[string, Command]> = [
      ['vender:gosma,3', { kind: 'vender', item: 'gosma', quantidade: 3 }],
      ['vender:clavaOgro,99', { kind: 'vender', item: 'clavaOgro', quantidade: 99 }],
      ['comprar:potion,1', { kind: 'comprar', item: 'potion', quantidade: 1 }],
      ['criar:pocao', { kind: 'criar', receita: 'pocao' }],
      ['criar:refino', { kind: 'criar', receita: 'refino' }]
    ];
    for (const [texto, cmd] of casos) {
      expect(parseCommand(texto), 'T13.10: parse de "' + texto + '"').toEqual(cmd);
      expect(formatCommand(cmd), 'T13.10: format de "' + texto + '"').toBe(texto);
    }

    /* O que NÃO é comando. 'tudo' está aqui de propósito: quem sabe quanto há
     * na bolsa é a interface, e é ela que manda o número. */
    const lixo = [
      'vender:gosma,tudo', 'vender:gosma', 'vender:gosma,3,4', 'vender:banana,1',
      'vender:potion,1', 'vender:gosma,0', 'vender:gosma,100',
      'comprar:potion,0', 'comprar:gosma,1', 'comprar:potion',
      'criar', 'criar:', 'criar:pocao,1', 'criar:POCAO'
    ];
    for (const texto of lixo) {
      expect(parseCommand(texto), 'T13.10: "' + texto + '" NÃO devia virar comando').toBe(null);
    }

    /* Os comandos antigos continuam intactos — o protocolo só cresceu. */
    expect(parseCommand('move:1,-1'), 'T13.10: move').toEqual({ kind: 'move', dx: 1, dy: -1 });
    expect(parseCommand('wait'), 'T13.10: wait').toEqual({ kind: 'wait' });
    expect(parseCommand('use'), 'T13.10: use').toEqual({ kind: 'use' });
    expect(parseCommand('descend'), 'T13.10: descend').toEqual({ kind: 'descend' });
  });

  it('o snapshot v5 traz moedas, refino e os dois pontos de parada', () => {
    const semente = sementeComParadas();
    const game = createState(semente, 1);
    const inicial = String(snapshot(game));

    expect(inicial.indexOf('v5|'), 'T13.11: o snapshot não é v5').toBe(0);
    expect(inicial.indexOf(',mo0,arm0|') >= 0,
      'T13.11: moedas e refino não aparecem no bloco do jogador — ' + inicial).toBe(true);
    expect(
      inicial.indexOf('|merc=' + (game.mercador ? game.mercador.x + ',' + game.mercador.y : '-') + '|') >= 0,
      'T13.11: o mercador não aparece — ' + inicial
    ).toBe(true);
    expect(
      inicial.indexOf('|banc=' + (game.bancada ? game.bancada.x + ',' + game.bancada.y : '-') + '|') >= 0,
      'T13.11: a bancada não aparece — ' + inicial
    ).toBe(true);
    /* Os dois pontos vêm ANTES do checksum de tiles, que fecha o snapshot — e
     * a decoração da estação (`alq=`, do T14) entra entre eles e o checksum. */
    expect(/\|merc=[^|]+\|banc=[^|]+\|alq=[^|]+\|map=[0-9a-f]+$/.test(inicial),
      'T13.11: merc/banc fora do lugar no formato — ' + inicial).toBe(true);

    /* O snapshot ACOMPANHA a economia: mudou moeda ou refino, mudou o resumo. */
    game.player.moedas = 137;
    game.player.armaNivel = 2;
    const depois = String(snapshot(game));
    expect(depois.indexOf(',mo137,arm2|') >= 0,
      'T13.11: o snapshot não acompanhou moedas/refino — ' + depois).toBe(true);
    expect(depois, 'T13.11: mudar a economia tem de mudar o snapshot').not.toBe(inicial);

    /* Andar sem ponto sai com traço, não com '0,0' — que é coordenada válida.
     * Sem caldeirão não há estação, e a lista de decoração some junto. */
    game.mercador = null;
    game.bancada = null;
    game.alquimiaExtras = [];
    expect(String(snapshot(game)).indexOf('|merc=-|banc=-|alq=-|map=') >= 0,
      'T13.11: ponto ausente devia sair como "-" — ' + String(snapshot(game))).toBe(true);
  }, LENTO);

  it('esbarrar na parada anuncia o balcão, uma vez por encontro, e o passo é recusado', () => {
    const semente = sementeComParadas();

    const paradas: Array<['mercador' | 'bancada', string]> = [
      ['mercador', 'O mercador ergue os olhos: há o que negociar.'],
      ['bancada', 'O caldeirão borbulha. A estação pede gosma e ferro.']
    ];
    for (const [qual, frase] of paradas) {
      const game = createState(semente, 1);
      game.player.maxHp = 999;
      game.player.hp = 999;
      const ponto = qual === 'mercador' ? game.mercador : game.bancada;
      expect(ponto, 'T13.12: a semente não tem ' + qual).not.toBe(null);
      if (!ponto) continue;

      /* Um vizinho ORTOGONAL caminhável: a diagonal tem regra de corte de
       * canto, e um passo recusado transformaria a falha numa charada. */
      const vizinho = DIRS8.find((d) =>
        (d[0] === 0 || d[1] === 0) && isWalkable(game.map, ponto.x + d[0], ponto.y + d[1]));
      expect(vizinho, 'T13.12: ' + qual + ' sem vizinho ortogonal caminhável').not.toBe(undefined);
      if (!vizinho) continue;
      game.player.x = ponto.x + vizinho[0];
      game.player.y = ponto.y + vizinho[1];

      const marcaLog = game.log.length;
      /* O tile é SÓLIDO: o passo é recusado e o jogador fica onde estava. */
      const aceito = aplicar(game, 'move:' + (-vizinho[0]) + ',' + (-vizinho[1]));
      expect(aceito, 'T13.12: o esbarrão em ' + qual + ' consumiu turno').toBe(false);
      expect(game.player.x === ponto.x && game.player.y === ponto.y,
        'T13.12: o jogador atravessou ' + (qual === 'bancada' ? 'a' : 'o') + ' ' + qual)
        .toBe(false);
      expect(
        game.log.slice(marcaLog).some((l) => l.text === frase),
        'T13.12: a chegada a' + (qual === 'bancada' ? '' : 'o') + ' ' + qual +
          ' não foi anunciada — ' + JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))
      ).toBe(true);
    }
  }, LENTO);
});

/* ================================================================== *
 * T14 — a instalação da entrada, fase 2.1: mercador e estação de alquimia
 *   no cômodo em que o herói começa
 *
 * POR QUE ESTE BLOCO EXISTE: o dono jogou uma expedição inteira e não achou o
 * mercador. A regra antiga o punha perto da ESCADA (o fim do andar) e punha a
 * oficina em OUTRA sala — conteúdo que existe no código e não existe na
 * partida. A decisão nova é curta: os dois nascem no cômodo do início, e a
 * alquimia fica logo na entrada dele.
 *
 * O que cada teste protege, em uma frase:
 *   · mercador e caldeirão nascem na SALA DO INÍCIO, a Chebyshev 2..4 do herói,
 *     e nunca faltam — 600 andares varridos (T14.1);
 *   · a estação é uma INSTALAÇÃO de até três tiles: o caldeirão (interação) e
 *     até dois extras ortogonais (decoração), que degradam num cômodo apertado
 *     mas nunca levam o caldeirão junto (T14.2);
 *   · nada da instalação pisa em início, escada, item, inimigo — nem em si
 *     mesma (T14.3);
 *   · mesma semente ⇒ mesmos pontos e mesmos extras, por `populate` e por
 *     `createState` (T14.4);
 *   · extra é CENÁRIO: reserva o tile e não abre balcão nenhum (T14.5);
 *   · a estação é do ANDAR e se refaz na descida (T14.6);
 *   · o save leva os extras, e um save antigo retoma sem eles em vez de
 *     inventar mobília no lugar errado (T14.7);
 *   · o `snapshot()` mostra a estação inteira, com `alq=` entre `banc=` e o
 *     checksum de tiles (T14.8).
 * ================================================================== */

/** Chebyshev — a mesma métrica de `cheb` do engine, reescrita para o teste. */
function chebT14(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** O ponto está na MESMA sala em que o herói começa? (`roomAt` de um e de outro) */
function mesmaSalaQueOInicio(map: GameMap, p: Point): boolean {
  const sala = roomAt(map, p.x, p.y);
  const salaInicio = roomAt(map, map.start.x, map.start.y);
  return !!sala && !!salaInicio && sala.id === salaInicio.id;
}

/** As peças da instalação (até três), na ordem em que o engine as produz. */
function tilesDaEstacao(pontos: { bancada: Point | null; alquimiaExtras: Point[] }): Point[] {
  const out: Point[] = [];
  if (pontos.bancada) out.push(pontos.bancada);
  for (const e of pontos.alquimiaExtras) out.push(e);
  return out;
}

describe('T14 — a instalação da entrada: mercador e estação no cômodo inicial', () => {
  it('600 andares: mercador e caldeirão sempre na sala do início, a 2..4 do herói', () => {
    let andares = 0;
    let semMercador = 0;
    let semCaldeirao = 0;
    let estacaoCompleta = 0;

    for (let i = 0; i < 200; i++) {
      const semente = 'T14-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = generate(semente, depth);
        const pop = populate(map, depth, 1);
        const onde = ondeEsta('T14.1', { semente, depth });
        andares++;

        if (!pop.mercador) semMercador++;
        if (!pop.bancada) semCaldeirao++;
        if (pop.alquimiaExtras.length === ALQUIMIA_EXTRAS_MAX) estacaoCompleta++;

        const paradas: Array<[string, Point | null]> = [
          ['mercador', pop.mercador],
          ['caldeirão', pop.bancada]
        ];
        for (const [nome, ponto] of paradas) {
          if (!ponto) continue;
          expect(isWalkable(map, ponto.x, ponto.y),
            onde + ': ' + nome + ' em tile não caminhável').toBe(true);
          expect(mesmaSalaQueOInicio(map, ponto),
            onde + ': ' + nome + ' fora da sala do início — ' + JSON.stringify(ponto)).toBe(true);
          const d = chebT14(ponto, map.start);
          expect(d >= 2 && d <= 4,
            onde + ': ' + nome + ' a Chebyshev ' + d + ' do início (esperado 2..4)').toBe(true);
        }
      }
    }

    /* O número que importa: a instalação NUNCA falta. Não é sorte — o anel
     * 2..4 do início cai inteiro dentro do raio seguro (SAFE_RADIUS = 6), onde
     * inimigo e item não nascem, e a sala do início é uma sala de verdade
     * (`map.start` é o centro de `rooms[0]`). O dia em que faltar é mudança de
     * MAPA que merece decisão, não um teste que afrouxa o número. */
    expect(andares, 'T14.1: a varredura não rodou os 600 andares').toBe(600);
    expect(semMercador, 'T14.1: andar sem mercador').toBe(0);
    expect(semCaldeirao, 'T14.1: andar sem caldeirão').toBe(0);

    /* A estação COMPLETA (três peças) é o caso normal, não o excepcional:
     * medido 579 de 600 (96,5%) — os que faltam são cômodos em cruz de braço
     * estreito, onde a decoração não cabe sem sair da sala. O piso de 90% pega
     * a regressão de verdade (a estação parar de montar) sem transformar um
     * ajuste de gerador em build vermelho. */
    expect(estacaoCompleta / andares,
      'T14.1: a estação parou de montar as três peças — ' + estacaoCompleta + '/' + andares)
      .toBeGreaterThan(0.9);
  }, LENTO);

  it('a estação tem até três tiles: caldeirão de interação e dois extras colados nele', () => {
    let comDois = 0;
    let comMenos = 0;

    for (let i = 0; i < 60; i++) {
      const semente = 'T14-EXTRAS-' + pad(i, 4);
      for (let depth = 1; depth <= 2; depth++) {
        const map = generate(semente, depth);
        const pop = populate(map, depth, 1);
        const onde = ondeEsta('T14.2', { semente, depth });
        const caldeirao = pop.bancada;
        expect(caldeirao, onde + ': andar sem caldeirão').not.toBe(null);
        if (!caldeirao) continue;

        expect(pop.alquimiaExtras.length <= ALQUIMIA_EXTRAS_MAX,
          onde + ': mais extras do que o teto — ' + JSON.stringify(pop.alquimiaExtras)).toBe(true);
        if (pop.alquimiaExtras.length === ALQUIMIA_EXTRAS_MAX) comDois++;
        else comMenos++;

        const vistos = new Set<string>();
        let anterior = -1;
        for (const extra of pop.alquimiaExtras) {
          const chave = extra.x + ',' + extra.y;
          /* Colado no caldeirão e ORTOGONAL: a estação é uma peça só. Dois
           * vizinhos ortogonais do mesmo tile formam sempre um L ou uma linha. */
          const dist = Math.abs(extra.x - caldeirao.x) + Math.abs(extra.y - caldeirao.y);
          expect(dist, onde + ': extra ' + chave + ' não é vizinho ortogonal do caldeirão')
            .toBe(1);
          expect(isWalkable(map, extra.x, extra.y),
            onde + ': extra ' + chave + ' em tile não caminhável').toBe(true);
          expect(mesmaSalaQueOInicio(map, extra),
            onde + ': extra ' + chave + ' fora da sala do início').toBe(true);
          expect(chebT14(extra, map.start) >= 2,
            onde + ': extra ' + chave + ' colado no herói').toBe(true);
          expect(vistos.has(chave), onde + ': extra repetido — ' + chave).toBe(false);
          vistos.add(chave);
          /* Ordem ESTÁVEL: índice linear crescente, como sai de `populate` e
           * como o `snapshot()` a lê de volta. */
          const indice = extra.y * map.w + extra.x;
          expect(indice > anterior, onde + ': extras fora da ordem canônica').toBe(true);
          anterior = indice;
        }
      }
    }

    /* Os dois caminhos existem de verdade na amostra: se `comMenos` fosse zero
     * a degradação nunca teria sido exercitada, e se `comDois` fosse zero a
     * estação simplesmente não estaria montando. */
    expect(comDois, 'T14.2: nenhuma estação completa na amostra').toBeGreaterThan(0);
    expect(comDois + comMenos, 'T14.2: a varredura não rodou os 120 andares').toBe(120);
  }, LENTO);

  it('a instalação inteira é território reservado: nada nasce embaixo dela', () => {
    for (let i = 0; i < 80; i++) {
      const semente = 'T14-RESERVA-' + pad(i, 4);
      for (let depth = 1; depth <= 2; depth++) {
        const map = generate(semente, depth);
        const pop = populate(map, depth, 1);
        const onde = ondeEsta('T14.3', { semente, depth });

        const ocupados = new Map<string, string>();
        ocupados.set(map.start.x + ',' + map.start.y, 'o início');
        ocupados.set(map.stairs.x + ',' + map.stairs.y, 'a escada');
        for (const e of pop.enemies) ocupados.set(e.x + ',' + e.y, 'o inimigo ' + e.id);
        for (const it of pop.items) ocupados.set(it.x + ',' + it.y, 'o item ' + it.id);

        const pecas: Array<[string, Point]> = [];
        if (pop.mercador) pecas.push(['o mercador', pop.mercador]);
        if (pop.bancada) pecas.push(['o caldeirão', pop.bancada]);
        for (let k = 0; k < pop.alquimiaExtras.length; k++) {
          pecas.push(['o extra ' + (k + 1), pop.alquimiaExtras[k]]);
        }
        for (const [nome, p] of pecas) {
          const chave = p.x + ',' + p.y;
          expect(ocupados.get(chave),
            onde + ': ' + nome + ' nasceu sobre ' + ocupados.get(chave) + ' em ' + chave)
            .toBe(undefined);
          ocupados.set(chave, nome);
        }
      }
    }
  }, LENTO);

  it('determinismo: mesma semente ⇒ mesmo mercador, mesmo caldeirão, mesmos extras', () => {
    for (let i = 0; i < 24; i++) {
      const semente = 'T14-DET-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = generate(semente, depth);
        const a = populate(map, depth, 1);
        const b = populate(map, depth, 1);
        const onde = ondeEsta('T14.4', { semente, depth });

        expect(JSON.stringify(b.alquimiaExtras), onde + ': os extras divergiram entre chamadas')
          .toBe(JSON.stringify(a.alquimiaExtras));

        /* E pelo caminho de verdade, que é o que a partida usa. */
        const game = createState(semente, depth);
        expect(JSON.stringify(game.mercador), onde + ': createState ≠ populate (mercador)')
          .toBe(JSON.stringify(a.mercador));
        expect(JSON.stringify(game.bancada), onde + ': createState ≠ populate (caldeirão)')
          .toBe(JSON.stringify(a.bancada));
        expect(JSON.stringify(game.alquimiaExtras), onde + ': createState ≠ populate (extras)')
          .toBe(JSON.stringify(a.alquimiaExtras));
      }
    }
  }, LENTO);

  it('extra é cenário: reserva o tile, mas não abre balcão nenhum', () => {
    /* Uma semente cuja estação nasceu COMPLETA — a varredura é determinística. */
    let game: Game | null = null;
    for (let i = 0; i < 32 && !game; i++) {
      const candidata = createState('T14-CENARIO-' + pad(i, 4), 1);
      if (candidata.bancada && candidata.alquimiaExtras.length === ALQUIMIA_EXTRAS_MAX) {
        game = candidata;
      }
    }
    expect(game, 'T14.5: nenhuma das 32 sementes montou a estação completa').not.toBe(null);
    if (!game) return;

    game.player.maxHp = 999;
    game.player.hp = 999;
    game.player.bag.gosma = 9;
    game.player.bag.espadaGoblin = 4;
    game.player.moedas = 500;

    /* Fase 2.2: o extra é cenário, mas a ESTAÇÃO é uma coisa só — a peça de
     * decoração também abre a oficina, porque exigir o caldeirão exato faria o
     * jogador adivinhar o tile. O que o extra NÃO é: um mercador. */
    for (const extra of game.alquimiaExtras) {
      /* Ao lado do extra (o tile dele é sólido), no primeiro vizinho livre. */
      let achou = false;
      for (let i = 0; i < DIRS8.length && !achou; i++) {
        const x = extra.x + DIRS8[i][0];
        const y = extra.y + DIRS8[i][1];
        if (isWalkable(game.map, x, y)) {
          game.player.x = x;
          game.player.y = y;
          achou = true;
        }
      }
      expect(achou, 'T14.5: extra sem vizinho caminhável em ' + extra.x + ',' + extra.y)
        .toBe(true);
      const antes = estadoDeComercio(game);
      const marcaLog = game.log.length;
      for (const texto of ['vender:gosma,3', 'comprar:potion,1']) {
        expect(aplicar(game, texto),
          'T14.5: "' + texto + '" foi aceito ao lado da DECORAÇÃO em ' + extra.x + ',' + extra.y)
          .toBe(false);
      }
      expect(estadoDeComercio(game), 'T14.5: a recusa sobre o extra mexeu no estado').toBe(antes);
      /* A recusa da oficina é a mesma de sempre — o extra não é meia bancada. */
      expect(game.log.slice(marcaLog).map((l) => l.text).indexOf('Você precisa estar ao lado do mercador.') >= 0,
        'T14.5: a recusa saiu fora do padrão — ' +
          JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))).toBe(true);
    }

    /* Contraprova: no CALDEIRÃO, a mesma alquimia é aceita. */
    if (game.bancada) {
      game.player.x = game.bancada.x;
      game.player.y = game.bancada.y;
      expect(aplicar(game, 'criar:pocao'), 'T14.5: a alquimia foi recusada no caldeirão')
        .toBe(true);
    }
  }, LENTO);

  it('a estação é do ANDAR: descer a escada monta outra, no cômodo novo', () => {
    const game = createState('T14-DESCIDA', 1);
    const antes = JSON.stringify({
      mercador: game.mercador,
      bancada: game.bancada,
      extras: game.alquimiaExtras
    });

    descend(game);

    expect(game.mercador, 'T14.6: o nível 2 nasceu sem mercador').not.toBe(null);
    expect(game.bancada, 'T14.6: o nível 2 nasceu sem caldeirão').not.toBe(null);
    const depois = JSON.stringify({
      mercador: game.mercador,
      bancada: game.bancada,
      extras: game.alquimiaExtras
    });
    expect(depois, 'T14.6: a instalação do nível 1 sobreviveu à descida').not.toBe(antes);
    /* E ela continua colada no herói: o cômodo é outro, a regra é a mesma. */
    for (const p of tilesDaEstacao(game)) {
      expect(mesmaSalaQueOInicio(game.map, p),
        'T14.6: peça da estação fora da sala do início do nível 2').toBe(true);
    }
  }, LENTO);

  it('save/restore: os extras sobrevivem; save antigo retoma sem mobília inventada', () => {
    const armazem = armazemDeMemoria();
    let game: Game | null = null;
    for (let i = 0; i < 32 && !game; i++) {
      const candidata = createState('T14-SAVE-' + pad(i, 4), 1);
      if (candidata.bancada && candidata.alquimiaExtras.length === ALQUIMIA_EXTRAS_MAX) {
        game = candidata;
      }
    }
    expect(game, 'T14.7: nenhuma das 32 sementes montou a estação completa').not.toBe(null);
    if (!game) return;

    expect(escreverSave(game, armazem), 'T14.7: o save não foi gravado').toBe(true);
    const voltou = restore(lerSave(armazem));
    expect(voltou, 'T14.7: restore recusou um save válido').not.toBe(null);
    if (!voltou) return;
    expect(JSON.stringify(voltou.alquimiaExtras), 'T14.7: os extras não sobreviveram ao save')
      .toBe(JSON.stringify(game.alquimiaExtras));
    /* O snapshot é a prova de que a retomada é o MESMO andar, não um parecido. */
    expect(String(snapshot(voltou)), 'T14.7: o snapshot da retomada divergiu')
      .toBe(String(snapshot(game)));

    /* Extra gravado LONGE do caldeirão (save de outra versão, ou editado à mão):
     * o restore o descarta em vez de plantar uma estante no meio do cômodo. */
    const adulterado = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    adulterado.alquimiaExtras = [
      { x: game.map.start.x, y: game.map.start.y },              // em cima do herói
      { x: 0, y: 0 },                                            // dentro da parede
      { x: game.bancada ? game.bancada.x + 3 : 9, y: game.bancada ? game.bancada.y : 9 }
    ];
    const limpo = restore(adulterado);
    expect(limpo, 'T14.7: restore recusou o save adulterado em vez de degradar').not.toBe(null);
    if (limpo) {
      expect(limpo.alquimiaExtras, 'T14.7: extra solto no cômodo foi aceito').toEqual([]);
    }

    /* Save LEGADO (anterior à fase 2.1): não tem o campo. Retoma com a estação
     * SEM decoração — o caldeirão que vale é o do save, e herdar extras de
     * outro cálculo poria estante e mesa longe dele. */
    const legado = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    delete legado.alquimiaExtras;
    const retomado = restore(legado);
    expect(retomado, 'T14.7: restore recusou um save legado').not.toBe(null);
    if (!retomado) return;
    expect(retomado.alquimiaExtras, 'T14.7: save sem o campo devia retomar sem decoração')
      .toEqual([]);
    expect(JSON.stringify(retomado.bancada), 'T14.7: o caldeirão do save legado se perdeu')
      .toBe(JSON.stringify(game.bancada));
  }, LENTO);

  it('o snapshot v5 traz a estação inteira em alq=, logo depois de banc=', () => {
    let game: Game | null = null;
    for (let i = 0; i < 32 && !game; i++) {
      const candidata = createState('T14-SNAP-' + pad(i, 4), 1);
      if (candidata.bancada && candidata.alquimiaExtras.length === ALQUIMIA_EXTRAS_MAX) {
        game = candidata;
      }
    }
    expect(game, 'T14.8: nenhuma das 32 sementes montou a estação completa').not.toBe(null);
    if (!game) return;

    const inicial = String(snapshot(game));
    expect(inicial.indexOf('v5|'), 'T14.8: o snapshot não é v5').toBe(0);

    const esperado = game.alquimiaExtras.map((p) => p.x + ',' + p.y).join(';');
    expect(inicial.indexOf('|alq=' + esperado + '|') >= 0,
      'T14.8: a estação não aparece em alq= — ' + inicial).toBe(true);
    /* `;` separa os pontos porque `|` já separa os campos do snapshot. */
    expect(/\|alq=\d+,\d+;\d+,\d+\|map=[0-9a-f]+$/.test(inicial),
      'T14.8: alq= fora do lugar (tem de vir entre banc= e map=) — ' + inicial).toBe(true);

    /* Mudou a estação, mudou o resumo: é território reservado, e dois andares
     * com a estante de lados diferentes NÃO são o mesmo andar. */
    game.alquimiaExtras = [game.alquimiaExtras[0]];
    const menor = String(snapshot(game));
    expect(menor, 'T14.8: tirar um extra não mudou o snapshot').not.toBe(inicial);
    game.alquimiaExtras = [];
    expect(String(snapshot(game)).indexOf('|alq=-|map=') >= 0,
      'T14.8: estação sem decoração devia sair como "-" — ' + String(snapshot(game))).toBe(true);
  }, LENTO);
});

/* ================================================================== *
 * T15 — missões (fase 3): a caçada tem duas partes, e só fecha no balcão
 *
 * POR QUE ESTE BLOCO EXISTE: a missão é o primeiro sistema que junta o que
 * as fases 1 e 2 criaram separadas — o ABATE (que alimenta a bolsa) e o
 * MERCADOR (que a esvazia). Os dois requisitos se acumulam e só valem
 * JUNTOS: matar sem entregar não paga, entregar sem matar não fecha.
 *
 * O que cada teste protege, em uma frase:
 *   · a geração é determinística pela semente, 1 a 3 caçadas por andar, sem
 *     arquétipo repetido, na ordem de `KINDS`, com a recompensa na fórmula
 *     documentada (T15.1);
 *   · o abate conta só para a caçada do arquétipo certo — e o registro fica
 *     MUDO até a missão inteira fechar (T15.2);
 *   · a entrega exige as DUAS partes e consome o TOTAL somando os tipos da
 *     missão, pagando moedas e bônus (T15.3);
 *   · entregar longe do mercador, ou sem a parte de abate, é recusa sem
 *     turno e sem mexer no estado (T15.4);
 *   · o lembrete do balcão sai uma vez por encontro — sem spam — e torna a
 *     sair quando o jogador volta (T15.5);
 *   · as caçadas atravessam a descida e o save, com progresso, completa e
 *     entregue intactos; save antigo sem o campo degrada para lista vazia
 *     (T15.6);
 *   · o `snapshot()` v5 grava a receita inteira de cada missão, na ordem de
 *     geração (T15.7);
 *   · 'entregar' vai e volta pelo protocolo textual, e a entrega não toca o
 *     stream de despojos (T15.8).
 * ================================================================== */

/**
 * Projeção do que uma ENTREGA pode mudar. Recusa tem de deixar isto intacto:
 * as missões inteiras (progresso e flags), as moedas, a bolsa, o turno e os
 * dois streams — a entrega é conferência, não sorteio.
 */
function estadoDeMissoes(game: Game): string {
  return [
    JSON.stringify(game.missoes),
    't=' + game.turn,
    'moedas=' + game.player.moedas,
    'B[' + bolsaEmTexto(game.player.bag) + ']',
    'rng=' + (game.rngCombat.s >>> 0),
    'rngL=' + (game.rngLoot.s >>> 0)
  ].join('|');
}

/**
 * Uma caçada sob medida: a receita explícita nos argumentos, o resto na
 * fórmula de geração. É como os outros testes montam bolsa e moedas — a
 * mecânica da entrega é assunto do teste, o sorteio da caçada é assunto do
 * T15.1.
 */
function missaoSobMedida(alvo: ArchetypeKey, op?: {
  matar?: number;
  entregar?: number;
  progressoMatar?: number;
  moedas?: number;
  bonus?: { kind: MaterialKind; n: number } | null;
}): Missao {
  const o = op || {};
  const itens: MaterialKind[] = DROPS[alvo].map((d) => d.item);
  const matar = o.matar !== undefined ? o.matar : 2;
  const entregar = o.entregar !== undefined ? o.entregar : 2;
  return {
    key: 'abate-' + alvo,
    alvo: alvo,
    matar: matar,
    itens: itens,
    entregar: entregar,
    progressoMatar: o.progressoMatar !== undefined ? o.progressoMatar : 0,
    recompensaMoedas: o.moedas !== undefined ? o.moedas :
      matar * 4 + entregar * ITENS[itemPrincipal(alvo)].valor,
    recompensaItem: o.bonus !== undefined ? o.bonus : null,
    nome: nomeDaMissao(alvo),
    desc: descDaMissao(alvo, matar, entregar, itens),
    completa: false,
    entregue: false
  };
}

/** Vizinhos ORTOGONAIS caminháveis do ponto (a diagonal tem corte de canto). */
function vizinhosOrtogonais(game: Game, p: Point): Point[] {
  const out: Point[] = [];
  for (const d of DIRS8) {
    if (d[0] !== 0 && d[1] !== 0) continue;
    const x = p.x + d[0];
    const y = p.y + d[1];
    if (isWalkable(game.map, x, y)) out.push({ x: x, y: y });
  }
  return out;
}

describe('T15 — missões: geração por andar, abate, entrega e travessia', () => {
  it('geração: 1 a 3 por andar, sem arquétipo repetido, determinística pela semente', () => {
    /* Unidade pura: no MESMO stream, o gerador isolado repete a caçada. */
    const r1 = makeRng(hash32('T15-GER-UNIT'));
    const r2 = makeRng(hash32('T15-GER-UNIT'));
    expect(JSON.stringify(gerarMissoes(r1)), 'T15.1: gerarMissoes divergiu no mesmo stream')
      .toBe(JSON.stringify(gerarMissoes(r2)));

    const contagem = [0, 0, 0, 0];
    let comBonus = 0;
    let semBonus = 0;

    for (let i = 0; i < 24; i++) {
      const semente = 'T15-GER-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = generate(semente, depth);
        const a = populate(map, depth, 1);
        const b = populate(map, depth, 1);
        const onde = ondeEsta('T15.1', { semente, depth });

        /* Determinismo: duas chamadas, as mesmas caçadas — alvos, quantias e
         * recompensas, byte a byte. E pelo caminho de verdade, `createState`. */
        expect(JSON.stringify(b.missoes), onde + ': as missões divergiram entre chamadas')
          .toBe(JSON.stringify(a.missoes));
        const game = createState(semente, depth);
        expect(JSON.stringify(game.missoes), onde + ': createState ≠ populate (missões)')
          .toBe(JSON.stringify(a.missoes));

        expect(a.missoes.length >= 1 && a.missoes.length <= 3,
          onde + ': ' + a.missoes.length + ' missões — fora da faixa 1..3').toBe(true);
        contagem[a.missoes.length]++;

        const vistos = new Set<ArchetypeKey>();
        let anterior = -1;
        for (const m of a.missoes) {
          /* Sem repetir arquétipo no mesmo andar, e na ordem de KINDS — o
           * painel não balança de andar para andar. */
          expect(vistos.has(m.alvo), onde + ': arquétipo repetido — ' + m.alvo).toBe(false);
          vistos.add(m.alvo);
          const pos = KINDS.indexOf(m.alvo);
          expect(pos > anterior, onde + ': missões fora da ordem de KINDS').toBe(true);
          anterior = pos;

          expect(m.key, onde + ': a chave não é abate-<alvo>').toBe('abate-' + m.alvo);
          expect(m.matar >= 2 && m.matar <= 4,
            onde + ': matar ' + m.matar + ' fora de 2..4').toBe(true);
          expect(m.entregar >= 1 && m.entregar <= 3,
            onde + ': entregar ' + m.entregar + ' fora de 1..3').toBe(true);
          /* Os tipos da entrega são a tabela de despojos do alvo, inteira e
           * na ordem da tabela — nem um tipo a mais, nem outra ordem. */
          expect(m.itens, onde + ': itens ≠ DROPS[' + m.alvo + ']')
            .toEqual(DROPS[m.alvo].map((d) => d.item));
          /* A fórmula documentada: matar × 4 + entregar × valor do principal. */
          expect(m.recompensaMoedas, onde + ': recompensa fora da fórmula')
            .toBe(m.matar * 4 + m.entregar * ITENS[itemPrincipal(m.alvo)].valor);
          /* O bônus é do alvo ou não existe — nunca um item de outra tabela. */
          if (m.recompensaItem) {
            comBonus++;
            expect(m.itens.indexOf(m.recompensaItem.kind) >= 0,
              onde + ': bônus ' + m.recompensaItem.kind + ' não é despojo de ' + m.alvo)
              .toBe(true);
            expect(m.recompensaItem.n, onde + ': bônus com n ≠ 1').toBe(1);
          } else {
            semBonus++;
          }
          expect(m.progressoMatar, onde + ': caçada nova com progresso').toBe(0);
          expect(m.completa, onde + ': caçada nova já completa').toBe(false);
          expect(m.entregue, onde + ': caçada nova já entregue').toBe(false);
          expect(m.nome, onde + ': o título não é o da criatura')
            .toBe('Caça ao ' + CRIATURAS[m.alvo].nome);
          expect(m.desc.indexOf('Mate ' + m.matar + ' ') === 0 && m.desc.length > 20,
            onde + ': a descrição não narra a caçada — ' + m.desc).toBe(true);
        }
      }
    }

    /* Contraprova: os dois lados da moeda de 50% existem na amostra — se um
     * deles sumisse, o sorteio do bônus teria morrido e o teste passaria
     * verde sem exercitá-lo. */
    expect(contagem[1] + contagem[2] + contagem[3], 'T15.1: a varredura não rodou os 72 andares')
      .toBe(72);
    expect(comBonus, 'T15.1: nenhuma missão com bônus na amostra (50%)').toBeGreaterThan(0);
    expect(semBonus, 'T15.1: nenhuma missão sem bônus na amostra (50%)').toBeGreaterThan(0);
  }, LENTO);

  it('o abate conta só para a caçada do arquétipo certo — e o registro fica mudo', () => {
    const game = createState('T15-ABATE', 1);
    game.player.maxHp = 999;
    game.player.hp = 999;
    game.player.atk = 99;
    game.missoes = [
      missaoSobMedida('chaser', { matar: 2 }),
      missaoSobMedida('linker', { matar: 2 })
    ];
    const marcaLog = game.log.length;

    let id = 9100;
    const matarUm = (kind: ArchetypeKey): void => {
      const ent = plantarInimigo(game, id++, kind);
      expect(ent, 'T15.2: sem tile livre ao redor do jogador para plantar ' + kind)
        .not.toBe(null);
      if (!ent) return;
      game.player.hp = game.player.maxHp;
      const aceito = aplicar(game, 'move:' + (ent.x - game.player.x) + ',' + (ent.y - game.player.y));
      expect(aceito, 'T15.2: o golpe em ' + kind + ' não foi aceito').toBe(true);
    };

    matarUm('chaser');
    expect(game.missoes[0].progressoMatar, 'T15.2: o abate do Goblin não contou').toBe(1);
    expect(game.missoes[1].progressoMatar, 'T15.2: a caçada do Slime avançou com abate alheio')
      .toBe(0);

    matarUm('linker');
    expect(game.missoes[1].progressoMatar, 'T15.2: o abate do Slime não contou').toBe(1);
    expect(game.missoes[0].progressoMatar, 'T15.2: a caçada do Goblin avançou com abate alheio')
      .toBe(1);

    matarUm('chaser');
    expect(game.missoes[0].progressoMatar, 'T15.2: o segundo Goblin não fechou a parte de abate')
      .toBe(2);
    /* A parte de abate FECHOU e a missão continua ABERTA: sem a entrega não
     * há completa — as duas partes ou nada. */
    expect(game.missoes[0].completa, 'T15.2: completou sem a entrega').toBe(false);
    expect(game.missoes[0].entregue, 'T15.2: entregou sem o balcão').toBe(false);

    /* O registro fica MUDO sobre caçada até ela inteira fechar: o progresso
     * é do painel, não do log. */
    const falouDeMissao = game.log.slice(marcaLog).some((l) =>
      l.text.indexOf('Missão') >= 0 || l.text.indexOf('Caça ao') >= 0);
    expect(falouDeMissao, 'T15.2: o registro falou de missão antes da entrega — ' +
      JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))).toBe(false);
  }, LENTO);

  it('a entrega exige as DUAS partes: consome o total somando os tipos, paga moedas e bônus', () => {
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'mercador');
    game.missoes = [missaoSobMedida('chaser', {
      matar: 2, entregar: 3, progressoMatar: 2, moedas: 26,
      bonus: { kind: 'espadaGoblin', n: 1 }
    })];

    /* Abate feito, mas 2 orelhas para uma entrega de 3: recusa, sem turno e
     * sem comer um item sequer. */
    game.player.bag.orelhaGoblin = 2;
    const antes = estadoDeMissoes(game);
    const marcaFalta = game.log.length;
    expect(aplicar(game, 'entregar'), 'T15.3: entregou com 2 de 3 despojos').toBe(false);
    expect(estadoDeMissoes(game), 'T15.3: a recusa por falta mexeu no estado').toBe(antes);
    expect(
      game.log.slice(marcaFalta).some((l) =>
        l.cls === 'aviso' && l.text.indexOf('aguarda os despojos') >= 0),
      'T15.3: a recusa por falta saiu fora do padrão — ' +
        JSON.stringify(game.log.slice(marcaFalta).map((l) => l.text))
    ).toBe(true);

    /* A terceira peça é de OUTRO tipo da tabela: a entrega é um TOTAL, e uma
     * cimitarra fecha a mesma conta que uma orelha. */
    game.player.bag.espadaGoblin = 1;
    const turnoAntes = game.turn;
    const marcaLog = game.log.length;
    expect(aplicar(game, 'entregar'), 'T15.3: a entrega pronta não foi aceita').toBe(true);

    const m = game.missoes[0];
    expect(m.completa, 'T15.3: a missão não fechou com as duas partes feitas').toBe(true);
    expect(m.entregue, 'T15.3: fechou sem marcar o prêmio pago').toBe(true);
    expect(game.turn, 'T15.3: a entrega tem de consumir turno').toBe(turnoAntes + 1);
    expect(game.player.moedas, 'T15.3: as moedas da recompensa não caíram').toBe(26);
    /* Consumo na ordem da TABELA: as 2 orelhas primeiro, a cimitarra depois —
     * e a chave zerada SOME da bolsa (ausência é zero). Sobrou só o bônus. */
    expect(Object.prototype.hasOwnProperty.call(game.player.bag, 'orelhaGoblin'),
      'T15.3: a orelha zerada devia sumir da bolsa').toBe(false);
    expect(game.player.bag.espadaGoblin, 'T15.3: 1 consumida + 1 de bônus = 1').toBe(1);
    expect(somaBolsa(game.player.bag), 'T15.3: a entrega devia consumir exatamente 3 itens')
      .toBe(1);
    expect(
      game.log.slice(marcaLog).some((l) =>
        l.cls === 'bom' && l.text === 'Missão cumprida: Caça ao Goblin! O mercador paga ' +
          '26 moedas e uma cimitarra de goblin de bônus. Total: 26 moedas.'),
      'T15.3: a linha da entrega saiu fora do padrão — ' +
        JSON.stringify(game.log.slice(marcaLog).map((l) => l.text))
    ).toBe(true);

    /* Entregar de novo: caçada paga não paga duas vezes. */
    const depois = estadoDeMissoes(game);
    expect(aplicar(game, 'entregar'), 'T15.3: a mesma caçada foi paga duas vezes').toBe(false);
    expect(estadoDeMissoes(game), 'T15.3: a segunda entrega mexeu no estado').toBe(depois);
  }, LENTO);

  it('entregar longe do mercador, ou sem a parte de abate, é recusa sem turno', () => {
    const semente = sementeComParadas();

    /* Longe do balcão: o jogador começa no start, que nunca é parada (T13.1)
     * — e mesmo pronta, a caçada não sai dele. */
    const longe = createState(semente, 1);
    longe.player.bag.orelhaGoblin = 5;
    longe.missoes = [missaoSobMedida('chaser', { matar: 1, entregar: 2, progressoMatar: 1 })];
    const estadoLonge = estadoDeMissoes(longe);
    const marcaLonge = longe.log.length;
    expect(aplicar(longe, 'entregar'), 'T15.4: entregou LONGE do mercador').toBe(false);
    expect(estadoDeMissoes(longe), 'T15.4: a recusa de longe mexeu no estado').toBe(estadoLonge);
    expect(
      longe.log.slice(marcaLonge).map((l) => l.text)
        .indexOf('Você precisa estar ao lado do mercador.') >= 0,
      'T15.4: a recusa de longe saiu fora do padrão — ' +
        JSON.stringify(longe.log.slice(marcaLonge).map((l) => l.text))
    ).toBe(true);

    /* Ao lado, com os despojos na bolsa, mas sem UM abate sequer: a caçada
     * ainda é caçada — a entrega não fecha a parte que falta. */
    const semAbate = partidaNoPonto(semente, 'mercador');
    semAbate.player.bag.orelhaGoblin = 5;
    semAbate.missoes = [missaoSobMedida('chaser', { matar: 1, entregar: 2, progressoMatar: 0 })];
    const estadoSem = estadoDeMissoes(semAbate);
    const marcaSem = semAbate.log.length;
    expect(aplicar(semAbate, 'entregar'), 'T15.4: entregou sem a parte de abate').toBe(false);
    expect(estadoDeMissoes(semAbate), 'T15.4: a recusa sem abate mexeu no estado')
      .toBe(estadoSem);
    expect(
      semAbate.log.slice(marcaSem).some((l) =>
        l.cls === 'aviso' && l.text.indexOf('o abate vem primeiro') >= 0),
      'T15.4: a recusa sem abate saiu fora do padrão — ' +
        JSON.stringify(semAbate.log.slice(marcaSem).map((l) => l.text))
    ).toBe(true);
  }, LENTO);

  it('o lembrete do balcão sai uma vez por encontro, e torna a sair na volta', () => {
    /* Palco: um mercador com um corredor ortogonal livre N → T → T2, onde T e
     * T2 são ao lado dele e N não. Sem inimigos: o lembrete é do balcão. */
    let game: Game | null = null;
    let merc: Point | null = null;
    let N: Point | null = null;
    let T: Point | null = null;
    let T2: Point | null = null;
    for (let i = 0; i < 64 && !game; i++) {
      const candidata = createState('T15-LEMBRETE-' + pad(i, 4), 1);
      const ponto = candidata.mercador;
      if (!ponto) continue;
      for (const t of vizinhosOrtogonais(candidata, ponto)) {
        for (const t2 of vizinhosOrtogonais(candidata, t)) {
          const colado2 = Math.max(Math.abs(t2.x - ponto.x), Math.abs(t2.y - ponto.y));
          if (colado2 > 1 || (t2.x === ponto.x && t2.y === ponto.y)) continue;
          for (const n of vizinhosOrtogonais(candidata, t)) {
            const coladoN = Math.max(Math.abs(n.x - ponto.x), Math.abs(n.y - ponto.y));
            if (coladoN <= 1) continue;
            game = candidata; merc = ponto; N = n; T = t; T2 = t2;
            break;
          }
          if (game) break;
        }
        if (game) break;
      }
    }
    expect(game, 'T15.5: nenhuma das 64 sementes montou o palco do lembrete').not.toBe(null);
    if (!game || !merc || !N || !T || !T2) return;

    game.player.maxHp = 999;
    game.player.hp = 999;
    game.enemies = [];
    game.missoes = [missaoSobMedida('chaser', { matar: 1, entregar: 1, progressoMatar: 1 })];
    game.player.bag.orelhaGoblin = 1;
    game.player.x = N.x;
    game.player.y = N.y;
    const lembretes = (): number =>
      game.log.filter((l) => l.text.indexOf('quadro de caçadas') >= 0).length;
    const passo = (para: Point): void => {
      const aceito = aplicar(game, 'move:' + (para.x - game.player.x) + ',' + (para.y - game.player.y));
      expect(aceito, 'T15.5: o passo para (' + para.x + ',' + para.y + ') não foi aceito').toBe(true);
    };

    passo(T);
    expect(lembretes(), 'T15.5: chegar ao lado com a caçada pronta devia lembrar').toBe(1);
    passo(T2);
    expect(lembretes(), 'T15.5: passear AO REDOR do mercador repetiu o lembrete').toBe(1);
    passo(T);
    expect(lembretes(), 'T15.5: voltar um tile dentro do mesmo encontro repetiu').toBe(1);
    /* Saiu do lado do balcão, o encontro fechou: a próxima chegada merece o
     * lembrete de novo — é a volta que o jogador faz com a bolsa cheia. */
    passo(N);
    expect(lembretes(), 'T15.5: sair do balcão não devia lembrar de nada').toBe(1);
    passo(T);
    expect(lembretes(), 'T15.5: a volta ao balcão devia lembrar de novo').toBe(2);
  }, LENTO);

  it('as caçadas atravessam a descida e o save; save antigo degrada para lista vazia', () => {
    const armazem = armazemDeMemoria();
    const game = createState('T15-TRAVESSIA', 1);
    const pendente = missaoSobMedida('chaser', { matar: 3, entregar: 2, progressoMatar: 1 });
    const paga = missaoSobMedida('linker', { matar: 2, entregar: 1, progressoMatar: 2 });
    paga.completa = true;
    paga.entregue = true;
    game.missoes = [pendente, paga];
    const antes = JSON.stringify(game.missoes);

    /* A descida SOMA: as do andar 1 continuam, na frente, com progresso e
     * flags — e as do andar novo chegam atrás, zeradas. */
    descend(game);
    expect(game.missoes.length > 2, 'T15.6: o andar 2 não ofereceu caçada nova').toBe(true);
    expect(game.missoes.length <= 2 + 3, 'T15.6: o andar 2 ofereceu mais de 3').toBe(true);
    expect(JSON.stringify(game.missoes.slice(0, 2)),
      'T15.6: a descida perdeu progresso, completa ou entregue').toBe(antes);
    for (const m of game.missoes.slice(2)) {
      expect(m.progressoMatar, 'T15.6: caçada do andar novo já nasceu com progresso').toBe(0);
      expect(m.completa, 'T15.6: caçada do andar novo já nasceu completa').toBe(false);
    }

    /* Save/restore: a lista inteira sobrevive — e o snapshot fecha, porque é
     * a prova de que a retomada é o MESMO jogo, não um parecido. */
    expect(escreverSave(game, armazem), 'T15.6: o save não foi gravado').toBe(true);
    const voltou = restore(lerSave(armazem));
    expect(voltou, 'T15.6: restore recusou um save válido').not.toBe(null);
    if (!voltou) return;
    expect(JSON.stringify(voltou.missoes), 'T15.6: as caçadas não sobreviveram ao save')
      .toBe(JSON.stringify(game.missoes));
    expect(String(snapshot(voltou)), 'T15.6: o snapshot da retomada divergiu')
      .toBe(String(snapshot(game)));

    /* Save adulterado: alvo desconhecido é descartado, itens apagados voltam
     * à tabela do alvo, e 'entregue' sem 'completa' é lido da forma coerente. */
    const adulterado = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    adulterado.missoes = [
      { key: 'abate-dragon', alvo: 'dragon', matar: 9, itens: ['escama'], entregar: 9,
        progressoMatar: 9, recompensaMoedas: 999, recompensaItem: null,
        nome: 'Caça ao Dragão', desc: '.', completa: false, entregue: false },
      { key: 'abate-chaser', alvo: 'chaser', matar: 2, itens: ['banana'], entregar: 2,
        progressoMatar: 1, recompensaMoedas: 18, recompensaItem: null,
        nome: 'Caça ao Goblin', desc: '.', completa: false, entregue: true }
    ];
    const limpo = restore(adulterado);
    expect(limpo, 'T15.6: restore recusou o save adulterado em vez de degradar').not.toBe(null);
    if (limpo) {
      expect(limpo.missoes.length, 'T15.6: a caçada de arquétipo desconhecido entrou').toBe(1);
      expect(limpo.missoes[0].itens, 'T15.6: itens apagados deviam voltar à tabela do alvo')
        .toEqual(DROPS.chaser.map((d) => d.item));
      expect(limpo.missoes[0].entregue, 'T15.6: o entregue salvo se perdeu').toBe(true);
      expect(limpo.missoes[0].completa, 'T15.6: entregue sem completa é leitura incoerente')
        .toBe(true);
    }

    /* Save LEGADO (anterior à fase 3): sem o campo, retoma com a LISTA VAZIA —
     * nunca recusa a run, nunca inventa caçada a meio da partida. */
    const legado = JSON.parse(String(armazem.getItem(CONFIG.STORAGE_KEY))) as Record<string, unknown>;
    delete legado.missoes;
    const retomado = restore(legado);
    expect(retomado, 'T15.6: restore recusou um save legado').not.toBe(null);
    if (retomado) {
      expect(retomado.missoes, 'T15.6: save sem o campo devia retomar com lista vazia')
        .toEqual([]);
    }
  }, LENTO);

  it('o snapshot v5 grava a receita inteira de cada caçada, na ordem de geração', () => {
    const game = createState('T15-SNAP', 1);
    const inicial = String(snapshot(game));

    expect(inicial.indexOf('v5|'), 'T15.7: o snapshot não é v5').toBe(0);
    /* O bloco fica entre a bolsa e as estatísticas: "o que eu tenho", "o que
     * me pediram", "o que eu fiz". */
    expect(/\|B\[[^\]]*\]\|M\[/.test(inicial),
      'T15.7: M[...] fora do lugar (tem de vir depois de B[...]) — ' + inicial).toBe(true);
    expect(/\|M\[[^\]]*\]\|S=/.test(inicial),
      'T15.7: M[...] fora do lugar (tem de vir antes de S=) — ' + inicial).toBe(true);

    /* A receita INTEIRA, campo a campo — duas 'abate-chaser' de andares
     * diferentes só se distinguem por ela. */
    const m = game.missoes[0];
    expect(m, 'T15.7: a semente não gerou caçada nenhuma').not.toBe(undefined);
    const esperado = m.key + ':' + m.alvo + ':' + m.matar + ':' + m.entregar + ':' +
      m.itens.join('+') + ':0:' + m.recompensaMoedas + ':' +
      (m.recompensaItem ? m.recompensaItem.kind + '*' + m.recompensaItem.n : '-') + ':0:0';
    expect(inicial.indexOf('M[' + esperado) >= 0,
      'T15.7: a receita da caçada não aparece em M[...] — ' + inicial).toBe(true);

    /* O snapshot ACOMPANHA a caçada: mudou progresso ou flag, mudou o resumo. */
    game.missoes[0].progressoMatar = 1;
    const depois = String(snapshot(game));
    expect(depois, 'T15.7: mudar o progresso tem de mudar o snapshot').not.toBe(inicial);
    game.missoes[0].completa = true;
    game.missoes[0].entregue = true;
    expect(String(snapshot(game)).indexOf(m.key + ':' + m.alvo + ':' + m.matar + ':' +
      m.entregar + ':' + m.itens.join('+') + ':1:' + m.recompensaMoedas + ':') >= 0 &&
      String(snapshot(game)).indexOf(':1:1') >= 0,
      'T15.7: as flags completa/entregue não aparecem como 1:1 — ' + String(snapshot(game)))
      .toBe(true);

    /* A ordem é a de GERAÇÃO, sem reordenação: uma lista montada fora da
     * ordem de KINDS sai exatamente como está — o snapshot grava a ordem que
     * o painel lê. */
    game.missoes = [missaoSobMedida('linker'), missaoSobMedida('chaser')];
    const foraDeOrdem = String(snapshot(game));
    expect(foraDeOrdem.indexOf('M[abate-linker:linker') >= 0 &&
      foraDeOrdem.indexOf('abate-linker') < foraDeOrdem.indexOf('abate-chaser'),
      'T15.7: o snapshot reordenou as caçadas — ' + foraDeOrdem).toBe(true);

    /* Sem caçada, traço vazio: 'M[]', como a bolsa vazia sai 'B[]'. */
    game.missoes = [];
    expect(String(snapshot(game)).indexOf('|M[]|') >= 0,
      'T15.7: lista vazia devia sair como M[] — ' + String(snapshot(game))).toBe(true);
  }, LENTO);

  it("'entregar' vai e volta pelo protocolo textual, e a entrega não toca o rngLoot", () => {
    expect(parseCommand('entregar'), 'T15.8: parse de "entregar"').toEqual({ kind: 'entregar' });
    expect(formatCommand({ kind: 'entregar' }), 'T15.8: format de "entregar"').toBe('entregar');

    /* O que NÃO é comando: a palavra é nua, sem parâmetro — o engine é quem
     * sabe quais caçadas estão prontas. */
    for (const texto of ['entregar:', 'entregar:abate-chaser', 'entregar:1', 'entregaar', 'ENTREGAR']) {
      expect(parseCommand(texto), 'T15.8: "' + texto + '" NÃO devia virar comando').toBe(null);
    }

    /* A entrega é conferência, não sorteio: o turno passa e os monstros
     * agem, mas o stream de despojos fica EXATAMENTE onde estava. */
    const semente = sementeComParadas();
    const game = partidaNoPonto(semente, 'mercador');
    game.missoes = [missaoSobMedida('linker', { matar: 1, entregar: 2, progressoMatar: 1 })];
    game.player.bag.gosma = 3;
    const lootAntes = game.rngLoot.s >>> 0;
    expect(aplicar(game, 'entregar'), 'T15.8: a entrega pronta não foi aceita').toBe(true);
    expect(game.rngLoot.s >>> 0, 'T15.8: a entrega mexeu no stream de despojos').toBe(lootAntes);
  }, LENTO);
});
