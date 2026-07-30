/*
 * ISOROGUE — src/engine/core.ts
 *
 * Porte 1:1 de legacy/src-vanilla/00-core.js (menos o RNG, que foi para
 * rng.ts). Constantes globais, hash determinístico, helpers geométricos e o
 * único ponto de entropia real do projeto.
 *
 * Invariantes herdadas do vanilla:
 *  I1. `Math.random` é proibido. A ÚNICA entropia real é `crypto.getRandomValues`,
 *      usada exclusivamente em `newSeedString()` — e injetável para teste.
 *  I2. Nenhum relógio participa da lógica. Nada aqui lê o tempo.
 *  I4. Nenhum acesso a DOM: o engine roda headless.
 *  I5. Toda aritmética de 32 bits fecha com `>>> 0`.
 */

import { makeRng } from './rng';
import { Tile } from './types';
import type { Command, Dir, RandomBytes } from './types';
/*
 * Só o VOCABULÁRIO (as listas de nomes que viajam em texto), nunca as tabelas
 * de domínio: `parseCommand` precisa saber que 'gosma' existe e que 'banana'
 * não, mas não pode conhecer o preço de nada. vocab.ts existe exatamente para
 * essa fatia — e para não fechar o ciclo core → entities → mapgen → core, que
 * derrubaria o engine na primeira importação (ver o cabeçalho de vocab.ts).
 */
import { normalizeMaterialKind, normalizeReceita } from './vocab';

/*
 * Builtins içados para o escopo do módulo — mesma razão de perf documentada em
 * rng.ts (leitura de global dentro de `node:vm` atravessa o proxy do contexto).
 */
const imul = Math.imul;
const floor = Math.floor;
const sqrt = Math.sqrt;

/* Reexportado por conveniência: quem já importa `core` para CONFIG/DIRS8 quase
 * sempre precisa também do gerador. É o mesmo binding de rng.ts, não uma cópia. */
export { makeRng } from './rng';

/* ------------------------------------------------------------------ *
 * 1. Constantes globais (CONTRACTS.md §2 — era `R.C`)
 * ------------------------------------------------------------------ */

export const CONFIG = {
  VERSION: '1.0.0',
  MAP_W: 45,
  MAP_H: 45,
  TILE: { WALL: Tile.Wall, FLOOR: Tile.Floor, DOOR: Tile.Door, STAIRS: Tile.Stairs },
  TW: 64, // largura do losango do piso
  TH: 32, // altura do losango do piso
  WALL_H: 36, // altura vertical da parede em px
  FOV_RADIUS: 9,
  SAFE_RADIUS: 6, // raio livre de inimigos ao redor do início
  MAX_REGEN: 8, // tentativas de regeneração de mapa
  MAX_LOG: 400,
  STORAGE_KEY: 'isorogue.save.v1',
  HISTORY_KEY: 'isorogue.history.v1',
  ZOOM_MIN: 0.45,
  ZOOM_MAX: 2.4
} as const;

/* ------------------------------------------------------------------ *
 * 2. Hash determinístico — FNV-1a 32 bits
 * ------------------------------------------------------------------ */

const FNV_OFFSET_32 = 2166136261; // 0x811C9DC5
const FNV_PRIME_32 = 16777619; // 0x01000193

/**
 * FNV-1a 32 bits sobre as unidades UTF-16 da string.
 * Determinístico, estável entre plataformas e independente de locale.
 * Retorna sempre um uint32 (0..4294967295).
 *
 * Nota: percorremos code units (charCodeAt), não code points. Isso é
 * intencional e estável: seeds são ASCII maiúsculo na prática, e mesmo com
 * caracteres fora do BMP o resultado continua determinístico.
 */
export function hash32(str: string | null | undefined): number {
  const s = str === null || str === undefined ? '' : String(str);
  let h = FNV_OFFSET_32;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // Math.imul garante multiplicação 32 bits com wrap-around correto.
    h = imul(h, FNV_PRIME_32);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ *
 * 3. Helpers de grade e geometria
 * ------------------------------------------------------------------ */

/** Índice linear de (x, y) numa grade de largura w. */
export function idx(w: number, x: number, y: number): number {
  return y * w + x;
}

/**
 * ORDEM FIXA — NUNCA REORDENE.
 * Todo desempate determinístico do jogo (bestStep do Dijkstra, escolha de tile
 * alternativo na IA) depende desta ordem exata. Reordenar muda o resultado de
 * partidas salvas.
 * Sentido: leste, sudeste, sul, sudoeste, oeste, noroeste, norte, nordeste.
 */
export const DIRS8: readonly Dir[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1]
];

/** Vizinhança ortogonal (usada pelo BFS de conectividade). Ordem também fixa. */
export const DIRS4: readonly Dir[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1]
];

/**
 * Direção inicial (e de reserva) do olhar do jogador: `DIRS8[2]` = `(0,1)`, o
 * sul do grid — na tela, baixo-esquerda, a pose mais próxima da referência
 * (§5.1 do docs/PERSONAGEM.md).
 */
export const DEFAULT_FACING = 2;

/**
 * Índice de `(dx, dy)` em `DIRS8`, ou `-1` quando o delta não é uma das oito
 * direções (inclusive `(0,0)`). Varredura linear sobre oito pares: é a ÚNICA
 * forma de garantir que o índice acompanhe a ordem fixa da tabela mesmo que
 * alguém, um dia, tenha a péssima ideia de reordená-la.
 */
export function dirIndex(dx: number, dy: number): number {
  for (let i = 0; i < DIRS8.length; i++) {
    const d = DIRS8[i];
    if (d[0] === dx && d[1] === dy) return i;
  }
  return -1;
}

/**
 * Normaliza um `facing` vindo de fora (save antigo, JSON de terceiro) para
 * 0..7. Valor ausente ou impossível cai em `DEFAULT_FACING` — o campo é
 * cosmético, então degradar é sempre melhor do que recusar o save.
 */
export function normalizeFacing(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v)) return DEFAULT_FACING;
  const i = floor(v) % DIRS8.length;
  return i < 0 ? i + DIRS8.length : i;
}

/** Distância de Chebyshev (movimento em 8 direções com custo uniforme). */
export function cheb(ax: number, ay: number, bx: number, by: number): number {
  let dx = ax - bx;
  if (dx < 0) dx = -dx;
  let dy = ay - by;
  if (dy < 0) dy = -dy;
  return dx > dy ? dx : dy;
}

/** Distância euclidiana (usada no raio circular do FOV e na iluminação). */
export function euclid(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return sqrt(dx * dx + dy * dy);
}

/** Prende v ao intervalo [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Interpolação linear. Usada só em animação/câmera — nunca na lógica. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ *
 * 4. Sementes
 * ------------------------------------------------------------------ */

// Alfabeto sem caracteres ambíguos: sem 0 e O, sem 1 e I.
// Dígitos 2-9 (8) + letras A-Z menos I e O (24) = exatamente 32 símbolos,
// então `byte & 31` é uniforme e sem viés de módulo.
const SEED_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SEED_GROUP = 4;
const SEED_GROUPS = 2;
const SEED_LEN = SEED_GROUP * SEED_GROUPS;

// Contador de fallback: só é usado se crypto.getRandomValues não existir
// (ambiente exótico). Não recorremos ao gerador nativo nem ao relógio.
let seedFallbackCounter = 0;

/**
 * Acesso isolado ao `crypto` da plataforma. É o único lugar do engine que olha
 * para o ambiente, e olha sem lançar: ausência de crypto degrada a entropia,
 * nunca o determinismo.
 */
function cryptoSource(): Crypto | null {
  const escopo: { crypto?: Crypto } = globalThis;
  const c = escopo.crypto;
  if (c && typeof c.getRandomValues === 'function') return c;
  return null;
}

const defaultRandomBytes: RandomBytes = function (n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = cryptoSource();
  if (c) {
    c.getRandomValues(out);
    return out;
  }
  // Fallback determinístico-por-contador. Mantém a promessa "nunca lança" sem
  // recorrer ao gerador nativo. Degrada a entropia, não o determinismo.
  seedFallbackCounter = (seedFallbackCounter + 1) >>> 0;
  const rng = makeRng(hash32('isorogue#fallback#' + seedFallbackCounter));
  for (let i = 0; i < n; i++) out[i] = rng.u32() & 255;
  return out;
};

/**
 * Gera uma semente nova no formato 'XXXX-XXXX' (ex.: 'K7QX-3M9P').
 * ÚNICO ponto de entropia real do projeto inteiro.
 *
 * `randomBytes` existe para o teste injetar determinismo; em produção nunca é
 * passado e a implementação padrão usa `crypto.getRandomValues`.
 */
export function newSeedString(randomBytes: RandomBytes = defaultRandomBytes): string {
  const bytes = randomBytes(SEED_LEN);
  let out = '';
  for (let i = 0; i < SEED_LEN; i++) {
    if (i > 0 && i % SEED_GROUP === 0) out += '-';
    out += SEED_ALPHABET.charAt(bytes[i] & 31);
  }
  return out;
}

/**
 * Normaliza uma semente digitada pelo usuário: trim, maiúsculas, espaços
 * internos colapsados para um único espaço. Entrada vazia (ou nula) devolve uma
 * semente nova de `newSeedString()`.
 *
 * A normalização é a fronteira do determinismo: 'k7qx-3m9p' e ' K7QX-3M9P '
 * devem gerar o mesmo mundo.
 */
export function normalizeSeed(
  str: string | null | undefined,
  randomBytes: RandomBytes = defaultRandomBytes
): string {
  const bruto = str === null || str === undefined ? '' : String(str);
  const s = bruto.replace(/\s+/g, ' ').trim().toUpperCase();
  if (s === '') return newSeedString(randomBytes);
  return s;
}

/* ------------------------------------------------------------------ *
 * 5. Comandos — ponte entre a união discriminada e a forma textual
 *
 * O vanilla trafegava o comando como string ('move:1,-1', 'wait', ...). O port
 * usa `Command` (docs/ARQUITETURA-REACT.md §3); estas duas funções mantêm a
 * forma textual viva para o golden test conseguir replicar as sequências
 * gravadas do oracle.
 * ------------------------------------------------------------------ */

/**
 * Réplica exata do `intOr(v, NaN)` do vanilla, restrita ao caso string:
 * string vazia não vira número; o resto passa por `Number` e depois `floor`.
 * Devolve NaN quando não dá um número finito.
 */
function inteiroOuNaN(v: string): number {
  if (v === '') return NaN;
  const n = Number(v);
  if (typeof n !== 'number' || !isFinite(n)) return NaN;
  return floor(n);
}

/**
 * Limites de quantidade de uma negociação, em unidades por comando.
 *
 * O piso 1 é o óbvio (vender zero não é ação). O teto 99 é de contrato e vale
 * para os dois lados do balcão: ele mantém a forma textual curta e previsível
 * ('vender:gosma,99' e nada maior), e é o que impede um comando forjado de
 * pedir 2^31 poções e estourar a aritmética do preço. Quem quiser vender 200
 * gosmas manda dois comandos — e paga dois turnos por isso.
 */
export const QUANTIDADE_MIN = 1;
export const QUANTIDADE_MAX = 99;

/**
 * Quantidade de uma negociação, ou `NaN` se o texto não for um inteiro dentro
 * de [QUANTIDADE_MIN, QUANTIDADE_MAX].
 *
 * Note o que NÃO é aceito: 'tudo'. Não existe atalho de "vender tudo" no
 * protocolo — quem sabe quanto há na bolsa na hora do clique é a interface, e é
 * ela que manda o número. O engine não adivinha intenção.
 */
function quantidadeOuNaN(v: string): number {
  const n = inteiroOuNaN(v);
  if (!isFinite(n)) return NaN;
  if (n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) return NaN;
  return n;
}

/** Corpo 'nome,quantidade' de vender/comprar; `null` se a forma não fecha. */
function parNomeQuantidade(corpo: string): { nome: string; n: number } | null {
  const partes = corpo.split(',');
  if (partes.length !== 2) return null;
  const n = quantidadeOuNaN(partes[1].trim());
  if (!isFinite(n)) return null;
  return { nome: partes[0].trim(), n: n };
}

/**
 * Converte a forma textual do vanilla em `Command`, ou `null` se inválida.
 *
 * Aceita exatamente o que `R.Game.applyCommand` aceitava, na mesma ordem de
 * validação: trim da string inteira, prefixo 'move:', exatamente duas partes,
 * cada parte com trim, `Number` + `Math.floor`, e só então o limite [-1, 1].
 * Isso preserva casos de borda do original — 'move:1.7,0' vira {1, 0}, e
 * 'move:1,0,2' é rejeitado.
 *
 * Os três comandos de economia (fase 2) seguem a mesma disciplina de forma:
 * 'vender:gosma,3', 'comprar:potion,1', 'criar:pocao'. O que este parse recusa
 * é ERRO DE FORMA (nome que não existe, quantidade fora da faixa, vírgula a
 * mais) — devolver `null` aqui é dizer "isto não é um comando". O que ele NÃO
 * julga é ERRO DE SITUAÇÃO (estar longe do mercador, não ter o material, não
 * ter moeda): isso é comando legítimo que o jogo recusa com uma linha de
 * registro, e quem decide é `applyCommand`. A fronteira importa porque só o
 * segundo caso tem de VIRAR MENSAGEM para o jogador.
 */
export function parseCommand(s: string): Command | null {
  if (typeof s !== 'string') return null;
  const c = s.trim();

  if (c.indexOf('move:') === 0) {
    const partes = c.slice(5).split(',');
    if (partes.length !== 2) return null;
    const dx = inteiroOuNaN(partes[0].trim());
    const dy = inteiroOuNaN(partes[1].trim());
    if (!isFinite(dx) || !isFinite(dy)) return null;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1) return null;
    return { kind: 'move', dx: dx, dy: dy };
  }
  if (c.indexOf('vender:') === 0) {
    const par = parNomeQuantidade(c.slice(7));
    if (!par) return null;
    /* Só MATERIAL se vende: 'vender:potion,1' cai aqui e é recusado, porque a
     * poção é contador, não mercadoria (contrato antigo R7). */
    const item = normalizeMaterialKind(par.nome);
    if (!item) return null;
    return { kind: 'vender', item: item, quantidade: par.n };
  }
  if (c.indexOf('comprar:') === 0) {
    const par = parNomeQuantidade(c.slice(8));
    if (!par) return null;
    /* O mercador só VENDE poção. A comparação é literal de propósito: o dia em
     * que ele vender outra coisa, este ponto tem de doer. */
    if (par.nome !== 'potion') return null;
    return { kind: 'comprar', item: 'potion', quantidade: par.n };
  }
  if (c.indexOf('criar:') === 0) {
    const receita = normalizeReceita(c.slice(6).trim());
    if (!receita) return null;
    return { kind: 'criar', receita: receita };
  }
  if (c === 'wait') return { kind: 'wait' };
  if (c === 'use') return { kind: 'use' };
  if (c === 'descend') return { kind: 'descend' };
  /* Palavra nua, sem parâmetro (fase 3): o engine é quem sabe quais missões
   * estão prontas — não existe 'entregar:abate-chaser' (ver `Command`). */
  if (c === 'entregar') return { kind: 'entregar' };
  return null;
}

/** Inversa de `parseCommand`: devolve a forma textual do vanilla. */
export function formatCommand(c: Command): string {
  switch (c.kind) {
    case 'move':
      return 'move:' + c.dx + ',' + c.dy;
    case 'wait':
      return 'wait';
    case 'use':
      return 'use';
    case 'descend':
      return 'descend';
    case 'vender':
      return 'vender:' + c.item + ',' + c.quantidade;
    case 'comprar':
      return 'comprar:' + c.item + ',' + c.quantidade;
    case 'criar':
      return 'criar:' + c.receita;
    case 'entregar':
      return 'entregar';
  }
}
