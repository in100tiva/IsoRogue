/*
 * ISOROGUE — engine/save.ts
 * Persistência local (R.Save do vanilla, `legacy/src-vanilla/60-ui.js`).
 *
 * Porte 1:1 da seção "persistência" do módulo de UI vanilla. O que muda é só a
 * fronteira: aqui o armazenamento é INJETÁVEL. O padrão continua sendo o
 * localStorage quando ele existir, mas os testes (e o harness headless) podem
 * entregar qualquer coisa que respeite `StorageLike`.
 *
 * Invariantes preservados do vanilla:
 *   · Tudo dentro de try/catch — armazenamento indisponível NUNCA quebra o jogo.
 *   · O MAPA NÃO É SERIALIZADO: ele é regerado por seed+depth (determinismo).
 *   · `explored` viaja em base64 próprio (btoa/atob podem faltar no sandbox).
 *   · O histórico guarda no máximo as 10 últimas runs mortas, mais recente primeiro.
 *   · O log é truncado nas últimas 80 entradas.
 */

import type {
  Bag,
  Game,
  HistoryEntry,
  LogClass,
  LogEntry,
  Player,
  Point,
  SaveData,
  SavedEnemy,
  SavedItem,
  Stats
} from './types';
import { Tile } from './types';
import { CONFIG, normalizeFacing } from './core';
/*
 * A tabela de itens entra aqui SÓ pela ordem canônica das chaves da bolsa e
 * pelo filtro de material — nada de regra de jogo. O ciclo de import que isso
 * cria (save -> entities -> game -> save) é o mesmo, e igualmente inerte, que
 * já existe entre game e entities: ninguém lê estes bindings durante a
 * avaliação do módulo, apenas dentro de funções.
 */
import { ITEM_KINDS, ehMaterial } from './entities';

/* ------------------------------------------------------------------ *
 * Armazenamento injetável
 * ------------------------------------------------------------------ */

/** Interface mínima de armazenamento — o subconjunto de `Storage` que usamos. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

let injetado: StorageLike | null = null;
let injetadoDefinido = false;

/**
 * Injeta (ou remove, com `null`) o armazenamento usado por todas as funções
 * deste módulo. Sem injeção, o padrão é `globalThis.localStorage` se existir.
 */
export function setStorage(s: StorageLike | null): void {
  injetado = s;
  injetadoDefinido = true;
}

function valido(s: StorageLike | null | undefined): StorageLike | null {
  if (!s) return null;
  if (typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
  return s;
}

/** Armazenamento efetivo: o explícito da chamada, o injetado, ou o padrão. */
function armazem(explicito?: StorageLike | null): StorageLike | null {
  try {
    const dado = valido(explicito);
    if (dado) return dado;
    if (injetadoDefinido) return valido(injetado);
    const global = globalThis as { localStorage?: StorageLike };
    return valido(global.localStorage);
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers (mesma semântica do 60-ui.js)
 * ------------------------------------------------------------------ */

const CLASSES_LOG: Record<string, 1> = { info: 1, bom: 1, ruim: 1, aviso: 1, sistema: 1 };

function num(v: unknown): number {
  return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

function inteiro(v: unknown): number {
  return Math.round(num(v));
}

function classeLog(cls: unknown): LogClass {
  return (typeof cls === 'string' && CLASSES_LOG[cls]) ? (cls as LogClass) : 'info';
}

function chaveSave(): string {
  return CONFIG.STORAGE_KEY;
}

function chaveHistorico(): string {
  return CONFIG.HISTORY_KEY;
}

/** Percentual (0..100) de tiles caminháveis já explorados no nível atual. */
function exploracao(game: Game): number {
  const map = game ? game.map : null;
  if (map && game.explored && map.tiles && typeof map.w === 'number') {
    let total = 0;
    let vistos = 0;
    const n = map.w * map.h;
    for (let i = 0; i < n; i++) {
      if (map.tiles[i] !== Tile.Wall) {
        total++;
        if (game.explored[i]) vistos++;
      }
    }
    if (total > 0) return (vistos / total) * 100;
  }
  const st = game ? game.stats : null;
  if (st && typeof st.explorePct === 'number' && isFinite(st.explorePct)) {
    return st.explorePct <= 1 ? st.explorePct * 100 : st.explorePct;
  }
  return 0;
}

/* ------------------------------------------------------------ base64 puro
   Implementação própria porque `btoa`/`atob` podem não existir no sandbox
   headless usado pelos testes — e o autosave roda lá também. */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let B64_INV: Record<string, number> | null = null;

/** Bytes -> base64 (idêntico a `bytesParaB64` do vanilla). */
export function bytesToBase64(bytes: Uint8Array | null): string {
  if (!bytes || typeof bytes.length !== 'number') return '';
  const n = bytes.length;
  let i = 0;
  let out = '';
  let a: number;
  let b: number;
  let c: number;
  while (i + 2 < n) {
    a = bytes[i] & 255; b = bytes[i + 1] & 255; c = bytes[i + 2] & 255;
    out += B64.charAt(a >> 2) +
      B64.charAt(((a & 3) << 4) | (b >> 4)) +
      B64.charAt(((b & 15) << 2) | (c >> 6)) +
      B64.charAt(c & 63);
    i += 3;
  }
  const resto = n - i;
  if (resto === 1) {
    a = bytes[i] & 255;
    out += B64.charAt(a >> 2) + B64.charAt((a & 3) << 4) + '==';
  } else if (resto === 2) {
    a = bytes[i] & 255; b = bytes[i + 1] & 255;
    out += B64.charAt(a >> 2) +
      B64.charAt(((a & 3) << 4) | (b >> 4)) +
      B64.charAt((b & 15) << 2) + '=';
  }
  return out;
}

/** base64 -> bytes (idêntico a `b64ParaBytes` do vanilla). */
export function base64ToBytes(str: unknown, tamanho?: number): Uint8Array | null {
  if (typeof str !== 'string') return null;
  if (!B64_INV) {
    B64_INV = {};
    for (let k = 0; k < B64.length; k++) B64_INV[B64.charAt(k)] = k;
  }
  const inv = B64_INV;
  const limpo = str.replace(/[^A-Za-z0-9+/]/g, '');
  const total = (typeof tamanho === 'number' && tamanho > 0)
    ? tamanho
    : Math.floor(limpo.length * 3 / 4);
  const out = new Uint8Array(total);
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < limpo.length && p < total; i++) {
    const v = inv[limpo.charAt(i)];
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Formato serializado
 * ------------------------------------------------------------------ */

/**
 * Forma GRAVADA do save: idêntica a `SaveData` (types.ts §8), só que `explored`
 * viaja como base64. `read()` decodifica e devolve o `SaveData` de verdade.
 */
type SaveGravado = Omit<SaveData, 'explored'> & { explored: string };

/** Forma CRUA recém-saída do JSON.parse: `explored` ainda pode ser texto. */
type SaveCru = Omit<SaveData, 'explored'> & { explored: Uint8Array | string | null };

/* ------------------------------------------------------------------ *
 * Cópias defensivas
 * ------------------------------------------------------------------ */

/**
 * Cópia defensiva da bolsa: só chaves conhecidas, na ordem de `ITEM_KINDS`, e
 * só contagens inteiras positivas. Gravar na ordem da tabela não é exigência do
 * formato (JSON não promete ordem de chave), é higiene: o arquivo fica legível
 * e dois saves do mesmo estado saem com o mesmo texto.
 */
function copiaBolsa(bag: Bag | null | undefined): Bag {
  const out: Bag = {};
  if (!bag || typeof bag !== 'object') return out;
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = inteiro(bag[kind]);
    if (n > 0) out[kind] = n;
  }
  return out;
}

function copiaJogador(p: Player | null | undefined): Player {
  const j = p || ({} as Partial<Player>);
  return {
    x: inteiro(j.x), y: inteiro(j.y),
    hp: inteiro(j.hp), maxHp: inteiro(j.maxHp),
    atk: inteiro(j.atk), potions: inteiro(j.potions),
    level: inteiro(j.level), xp: inteiro(j.xp),
    bag: copiaBolsa(j.bag),
    // Fase 2: moedas e degraus de refino são do JOGADOR e atravessam tudo —
    // descida e retomada. Quem valida a leitura é o `restore` (que aplica piso
    // zero e o teto de refino); aqui só garantimos inteiro.
    moedas: inteiro(j.moedas),
    armaNivel: inteiro(j.armaNivel),
    // `facing` é cosmético, mas gravá-lo evita o guerreiro girar para o sul ao
    // retomar. `normalizeFacing` (e não `inteiro`) porque a ausência tem de cair
    // no padrão 2, não no zero — save antigo carrega sem quebrar.
    facing: normalizeFacing(j.facing)
  };
}

/**
 * Cópia defensiva de um ponto de parada. `null` é valor legítimo (andar sem
 * mercador), e é o que sai também de qualquer coisa que não seja um par de
 * números finitos — `num()` sozinho não serviria aqui, porque ele devolve 0
 * para texto, e `{x:'a',y:'b'}` viraria a coordenada (0,0), que é um ponto de
 * mapa de verdade. O `restore` valida de novo do outro lado, contra o mapa
 * regerado, mas gravar lixo já corrigido não é trabalho do leitor.
 */
function copiaPonto(p: Point | null | undefined): Point | null {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.x !== 'number' || !isFinite(p.x)) return null;
  if (typeof p.y !== 'number' || !isFinite(p.y)) return null;
  return { x: inteiro(p.x), y: inteiro(p.y) };
}

/**
 * Cópia defensiva da decoração da estação de alquimia: os pontos válidos, na
 * ordem em que estão (que sai canônica de `populate`), descartando o que não
 * for par de números finitos. Lista vazia é valor legítimo — cômodo apertado
 * monta a estação com uma peça só. Quem valida contra o mapa regerado (e contra
 * o caldeirão) é o `restore`; aqui só garantimos que não gravamos lixo.
 */
function copiaExtras(lista: Point[] | null | undefined): Point[] {
  const out: Point[] = [];
  if (!lista || typeof lista.length !== 'number') return out;
  for (let i = 0; i < lista.length; i++) {
    const p = copiaPonto(lista[i]);
    if (p) out.push(p);
  }
  return out;
}

function copiaInimigos(lista: Game['enemies'] | null | undefined): SavedEnemy[] {
  const out: SavedEnemy[] = [];
  if (!lista || typeof lista.length !== 'number') return out;
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i];
    if (!e) continue;
    out.push({
      id: inteiro(e.id), kind: String(e.kind || ''),
      x: inteiro(e.x), y: inteiro(e.y),
      hp: inteiro(e.hp), maxHp: inteiro(e.maxHp),
      atk: inteiro(e.atk), range: inteiro(e.range),
      state: String(e.state || 'idle'),
      plan: String(e.plan || '')
    });
  }
  return out;
}

function copiaItens(lista: Game['items'] | null | undefined): SavedItem[] {
  const out: SavedItem[] = [];
  if (!lista || typeof lista.length !== 'number') return out;
  for (let i = 0; i < lista.length; i++) {
    const it = lista[i];
    if (!it) continue;
    /* `kind` já era gravado desde a primeira versão do save (valia sempre
     * 'potion'); agora ele carrega informação de verdade. Quem valida é o
     * `restore` — aqui só garantimos que é texto e que a ausência vira poção. */
    out.push({
      id: inteiro(it.id), kind: String(it.kind || 'potion'),
      x: inteiro(it.x), y: inteiro(it.y), heal: inteiro(it.heal)
    });
  }
  return out;
}

function copiaStats(st: Stats | null | undefined): Stats {
  const s = st || ({} as Partial<Stats>);
  return {
    turns: inteiro(s.turns), kills: inteiro(s.kills),
    dmgDealt: inteiro(s.dmgDealt), dmgTaken: inteiro(s.dmgTaken),
    itemsUsed: inteiro(s.itemsUsed), deepest: inteiro(s.deepest),
    explorePct: num(s.explorePct)
  };
}

function copiaLog(lista: LogEntry[] | null | undefined, quantos: number): LogEntry[] {
  const out: LogEntry[] = [];
  if (!lista || typeof lista.length !== 'number') return out;
  const inicio = Math.max(0, lista.length - quantos);
  for (let i = inicio; i < lista.length; i++) {
    const e = lista[i];
    if (!e) continue;
    out.push({
      turn: inteiro(e.turn),
      text: String(e.text === null || e.text === undefined ? '' : e.text),
      cls: classeLog(e.cls)
    });
  }
  return out;
}

function serializar(game: Game): SaveGravado {
  let estadoRng = 0;
  if (game.rngCombat && typeof game.rngCombat.s === 'number') {
    estadoRng = game.rngCombat.s >>> 0;
  }
  let estadoLoot = 0;
  if (game.rngLoot && typeof game.rngLoot.s === 'number') {
    estadoLoot = game.rngLoot.s >>> 0;
  }
  const explored = game.explored || null;
  return {
    v: 1,
    version: CONFIG.VERSION,
    seed: String(game.seedStr || ''),
    seedStr: String(game.seedStr || ''),
    depth: inteiro(game.depth),
    turn: inteiro(game.turn),
    over: !!game.over,
    cause: String(game.cause || ''),
    player: copiaJogador(game.player),
    enemies: copiaInimigos(game.enemies),
    items: copiaItens(game.items),
    proxItemId: inteiro(game.proxItemId),
    /* Os pontos de parada não saem da geração do mapa (`populate` os escolhe
     * depois de saber onde caíram inimigos e itens), então são a única parte do
     * andar que o save PRECISA carregar — todo o resto é regerado por seed. */
    mercador: copiaPonto(game.mercador),
    bancada: copiaPonto(game.bancada),
    /* A decoração da estação vai junto pelo mesmo motivo, e com um a mais: ela
     * é território RESERVADO do andar, e um andar retomado com a estante em
     * outro tile seria um andar diferente do que o jogador deixou. */
    alquimiaExtras: copiaExtras(game.alquimiaExtras),
    explored: bytesToBase64(explored),
    exploredLen: explored && typeof explored.length === 'number' ? explored.length : 0,
    stats: copiaStats(game.stats),
    rngCombat: estadoRng,
    rngCombatS: estadoRng,
    rngLoot: estadoLoot,
    log: copiaLog(game.log, 80)
  };
}

/* ------------------------------------------------------------------ *
 * API pública
 * ------------------------------------------------------------------ */

/** Grava o autosave. Devolve `false` (sem lançar) se não houver armazenamento. */
export function write(game: Game | null, storage?: StorageLike | null): boolean {
  const s = armazem(storage);
  if (!s || !game) return false;
  try {
    s.setItem(chaveSave(), JSON.stringify(serializar(game)));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Lê o autosave. `explored` volta já decodificado em `Uint8Array`.
 *
 * O objeto devolvido é o JSON cru (de terceiro, portanto suspeito) com os mesmos
 * ajustes do vanilla — quem reconstrói é `restore()` em game.ts, e ele valida
 * campo a campo antes de acreditar em qualquer coisa daqui.
 */
export function read(storage?: StorageLike | null): SaveData | null {
  const s = armazem(storage);
  if (!s) return null;
  try {
    const bruto = s.getItem(chaveSave());
    if (!bruto || typeof bruto !== 'string') return null;
    const parsed: unknown = JSON.parse(bruto);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as SaveCru;
    // Devolve `explored` já pronto para uso (Uint8Array) e guarda o texto
    // original em `exploredB64` para quem preferir a forma serializada.
    if (typeof obj.explored === 'string') {
      obj.exploredB64 = obj.explored;
      obj.explored = base64ToBytes(obj.explored, inteiro(obj.exploredLen));
    } else if (obj.explored && typeof obj.explored.length === 'number') {
      obj.explored = new Uint8Array(obj.explored);
    }
    if (!obj.seedStr && obj.seed) obj.seedStr = obj.seed;
    if (!obj.seed && obj.seedStr) obj.seed = obj.seedStr;
    if (typeof obj.rngCombatS !== 'number') obj.rngCombatS = inteiro(obj.rngCombat);
    return obj as SaveData;
  } catch (e) {
    return null;
  }
}

/** Apaga o autosave (morte permanente). */
export function clear(storage?: StorageLike | null): boolean {
  const s = armazem(storage);
  if (!s) return false;
  try {
    if (typeof s.removeItem === 'function') s.removeItem(chaveSave());
    else s.setItem(chaveSave(), '');
    return true;
  } catch (e) {
    return false;
  }
}

/** Histórico das últimas runs mortas (mais recente primeiro). */
export function readHistory(storage?: StorageLike | null): HistoryEntry[] {
  const s = armazem(storage);
  if (!s) return [];
  try {
    const bruto = s.getItem(chaveHistorico());
    if (!bruto || typeof bruto !== 'string') return [];
    const arr: unknown = JSON.parse(bruto);
    if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') return [];
    return arr as HistoryEntry[];
  } catch (e) {
    return [];
  }
}

/** Empilha a run morta no histórico, mantendo no máximo 10. */
export function pushHistory(game: Game | null, storage?: StorageLike | null): boolean {
  const s = armazem(storage);
  if (!s || !game) return false;
  try {
    const st = game.stats || ({} as Partial<Game['stats']>);
    const arr = readHistory(storage);
    arr.unshift({
      seed: String(game.seedStr || ''),
      depth: Math.max(inteiro(game.depth), inteiro(st.deepest)),
      turns: inteiro(st.turns) || inteiro(game.turn),
      kills: inteiro(st.kills),
      dmgDealt: inteiro(st.dmgDealt),
      dmgTaken: inteiro(st.dmgTaken),
      itemsUsed: inteiro(st.itemsUsed),
      explorePct: exploracao(game),
      cause: String(game.cause || '')
    });
    if (arr.length > 10) arr.length = 10;
    s.setItem(chaveHistorico(), JSON.stringify(arr));
    return true;
  } catch (e) {
    return false;
  }
}
