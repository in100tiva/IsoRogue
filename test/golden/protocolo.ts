/*
 * ISOROGUE — test/golden/protocolo.ts
 * ==================================================================
 * O PROTOCOLO DO GOLDEN, EM UM LUGAR SÓ.
 *
 * Este módulo define, de uma vez, as três coisas que o golden test precisa:
 *
 *   1. o FORMATO do oracle (os tipos `O*` — é o contrato do arquivo JSON);
 *   2. os EXTRATORES (o que de `Game` vira dado comparável, e o que fica de
 *      fora por ser animação);
 *   3. os PROTOCOLOS de execução (`rodarPartida`, `rodarProgressao`) e a
 *      sequência de comandos sorteada pelo LCG de semente 20260728.
 *
 * Quem o consome:
 *   · `tools/gen-golden-engine.mjs` → chama `montarOracle()` e grava
 *     `test/golden/engine-snapshots.json`;
 *   · `test/golden.test.ts`         → reexecuta os mesmos protocolos e compara
 *     o resultado com aquele arquivo.
 *
 * ------------------------------------------------------------------
 * POR QUE COMPARTILHADO, E NÃO DUPLICADO
 * ------------------------------------------------------------------
 * Enquanto o oracle vinha do vanilla (`tools/gen-golden.mjs` rodando
 * `legacy/isorogue-vanilla.html` em `node:vm`), gerador e teste eram programas
 * DIFERENTES, em linguagens diferentes, e os extratores tinham de ser "cópia
 * literal" um do outro — mantidos em sincronia à mão. Era o preço de medir duas
 * implementações independentes.
 *
 * Com o oracle derivado do PRÓPRIO ENGINE (ADR-008), esse preço vira só risco:
 * duas cópias do extrator podem divergir, e uma divergência que ESTREITA o que
 * é extraído afrouxa o teste **em silêncio** — o pior modo de falha possível
 * para um teste de regressão. Uma fonte só elimina a classe inteira.
 *
 * E isso não cria o buraco que parece criar. O arquivo gravado é IMUTÁVEL entre
 * regenerações: se alguém amanhã tirar um campo do extrator, o campo continua
 * no JSON e some do lado obtido — `toEqual` reprova na hora. A única maneira de
 * afrouxar o teste passa a ser regenerar o oracle, que é ato deliberado e
 * documentado (§ REGRA DE OURO em `test/golden.test.ts`).
 *
 * ------------------------------------------------------------------
 * O QUE FICA DE FORA, E POR QUÊ
 * ------------------------------------------------------------------
 * Só ANIMAÇÃO. Nada de estado lógico:
 *   · `enemy.bump`         — float de animação (precedente original, ADR-003);
 *   · `player.facing`      — direção do olhar, §5.1 do docs/PERSONAGEM.md
 *                            ([[ADR-005-facing-cosmetico-invisivel-ao-oracle]]);
 *   · `game.abatesRecentes`— fila de flutuantes de XP, drenada pelo renderer;
 *   · `game.ui`            — hover, debug, follow: estado de interface;
 *   · buffers derivados    — `dmap`, `fleeMap`, `dbuf`: recalculados a cada
 *                            turno a partir do que JÁ está comparado.
 *
 * Tudo o mais entra, inclusive o que a fase dos despojos acrescentou: a bolsa,
 * o `rngLoot`, o `proxItemId` e o `kind` de cada item no chão.
 */

import { parseCommand } from '../../src/engine/core';
import { ITEM_KINDS, ehMaterial } from '../../src/engine/entities';
import { applyCommand, createState, descend, snapshot } from '../../src/engine/game';
import { setStorage } from '../../src/engine/save';
import type {
  ArchetypeKey,
  Bag,
  Enemy,
  Game,
  GameMap,
  Item,
  LogEntry,
  MaterialKind,
  Player,
  Room,
  Stats
} from '../../src/engine/types';

/*
 * ISOLAMENTO DE PERSISTÊNCIA — efeito de importação, de propósito.
 *
 * O engine é puro, mas `endTurn` chama o autosave. Em Node não existe
 * `localStorage` e o save já degradaria em silêncio; ainda assim desligamos
 * explicitamente, para que NENHUM resíduo de uma partida alcance a seguinte.
 * É o equivalente ao `armazenamento.clear()` que o gerador do oracle vanilla
 * fazia antes de cada partida.
 *
 * Fica aqui, no módulo compartilhado, e não em cada consumidor: gerador e teste
 * TÊM de rodar sob a mesma condição de isolamento, e "lembrar de chamar" é
 * exatamente o tipo de disciplina que falha uma vez e produz um teste instável
 * cuja ordem de execução muda o resultado.
 */
setStorage(null);

/* ================================================================== *
 * 1. Parâmetros do contrato (docs/ARQUITETURA-REACT.md §7.1)
 * ================================================================== */

/** 12 sementes `GOLD-0001` .. `GOLD-0012`. */
export const N_CASOS = 12;
/** 200 comandos por caso, sorteados pelo LCG abaixo. */
export const N_COMANDOS = 200;
/** `snapshot()` completo a cada 10 turnos (o turno 0 é marco natural). */
export const INTERVALO_SNAPSHOT = 10;
/** Semente do LCG que sorteia as sequências de comando. NÃO é semente de jogo. */
export const SEMENTE_LCG = 20260728;
/** Descidas forçadas por `descend()` na sonda de progressão. */
export const N_DESCIDAS = 4;

/** `GOLD-0001` .. `GOLD-0012`, na ordem dos casos (índice 0-based). */
export function sementeDoCaso(indice: number): string {
  return 'GOLD-' + String(indice + 1).padStart(4, '0');
}

/** Profundidades 1..3 em ciclo: caso 1 → 1, caso 2 → 2, caso 3 → 3, caso 4 → 1… */
export function profundidadeDoCaso(indice: number): number {
  return (indice % 3) + 1;
}

/*
 * As oito direções do pool de comandos. Cópia da tabela do gerador vanilla —
 * NÃO é `DIRS8` do engine: aqui a ordem só afeta a composição do pool, e ela
 * está congelada porque muda a sequência sorteada.
 */
const DIRS8_POOL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
];

/**
 * Pool de comandos: 8 direções × 6 + 3 esperas + 2 usos de poção + 1 descida
 * = 54 entradas. Composição idêntica à do harness vanilla (§11 T6/T7).
 *
 * `descend` no pool é de propósito, mesmo sabendo que ele quase nunca é aceito
 * (o jogador precisaria cair em cima da escada por acaso): ele exercita o ramo
 * de recusa de `tentarDescer`. A progressão de verdade é medida à parte, por
 * `rodarProgressao`.
 */
export function montarPool(): string[] {
  const pool: string[] = [];
  for (const d of DIRS8_POOL) {
    for (let k = 0; k < 6; k++) pool.push('move:' + d[0] + ',' + d[1]);
  }
  for (let k = 0; k < 3; k++) pool.push('wait');
  for (let k = 0; k < 2; k++) pool.push('use');
  pool.push('descend');
  return pool;
}

/** LCG 32 bits (Numerical Recipes). Nada de `Math.random`: tem de ser regerável. */
function makeLcg(semente: number): { int(a: number, b: number): number } {
  let s = semente >>> 0;
  return {
    int(a: number, b: number): number {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return a + (s % (b - a + 1));
    }
  };
}

/**
 * As 12 sequências de 200 comandos.
 *
 * O LCG é consumido em uma ÚNICA corrida contínua, do caso 1 ao caso 12 — é por
 * isso que não dá para regerar a sequência de um caso isolado, e é por isso que
 * elas são gravadas no oracle: o teste confere que o que está gravado é o que o
 * LCG produz hoje (integridade), mas EXECUTA o que está gravado.
 */
export function sequenciasDeComando(): string[][] {
  const pool = montarPool();
  const lcg = makeLcg(SEMENTE_LCG);
  const saida: string[][] = [];
  for (let ci = 0; ci < N_CASOS; ci++) {
    const comandos: string[] = [];
    for (let i = 0; i < N_COMANDOS; i++) comandos.push(pool[lcg.int(0, pool.length - 1)]);
    saida.push(comandos);
  }
  return saida;
}

/* ================================================================== *
 * 2. Hashes — FNV-1a 32 bits, o mesmo algoritmo do jogo
 * ================================================================== */

export function fnv1aStr(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fnv1aBytes(arr: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i] & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ================================================================== *
 * 3. O FORMATO DO ORACLE
 * ================================================================== */

export interface OPonto {
  x: number;
  y: number;
}

export interface OSala {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  area: number;
  shape: string;
}

export interface OMapa {
  seed: string;
  depth: number;
  w: number;
  h: number;
  tilesHash: string;
  decorHash: string;
  start: OPonto | null;
  stairs: OPonto | null;
  connectivity: number;
  walkable: number;
  regenerations: number;
  repairs: number;
  salas: number;
  salasHash: string;
  notes: string[];
  /** Lista completa só no mapa de abertura de cada caso; nos demais, `salasHash`. */
  rooms?: OSala[];
}

export interface OInimigo {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  range: number;
  state: string;
  plan: string;
  lastDmg: number;
}

export interface OItem {
  id: number;
  kind: string;
  x: number;
  y: number;
  heal: number;
}

/** Uma linha da bolsa, já normalizada (ver `extrairBolsa`). */
export interface OMaterial {
  kind: MaterialKind;
  n: number;
}

export interface OConjunto {
  tamanho: number;
  hash: string;
}

/**
 * O jogador como o oracle o conhece: os oito campos lógicos de `Player` mais a
 * BOLSA normalizada.
 *
 * `facing` fica fora por ser cosmético (ADR-005). `bag` sai do tipo bruto e
 * entra como `bolsa`, uma LISTA na ordem de `ITEM_KINDS`, porque `Bag` é um
 * objeto aberto cuja ordem de chaves é a de inserção — acidental, portanto
 * imprópria para um arquivo que precisa ser byte a byte reprodutível.
 */
export interface JogadorOracle extends Omit<Player, 'facing' | 'bag'> {
  bolsa: OMaterial[];
}

export interface OInicial {
  snapshot: string;
  jogador: JogadorOracle;
  inimigos: OInimigo[];
  itens: OItem[];
  stats: Stats;
  visiveis: OConjunto;
  explorados: OConjunto;
  log: LogEntry[];
  /** Próximo id de item da partida — o primeiro despojo sai daqui. */
  proxItemId: number;
}

export interface OFinal {
  snapshot: string;
  depth: number;
  turn: number;
  over: boolean;
  cause: string;
  /** Arquétipo do golpe fatal. `''` enquanto o jogador está vivo. */
  causeKind: ArchetypeKey | '';
  jogador: JogadorOracle;
  inimigos: OInimigo[];
  inimigosVivos: number;
  itens: OItem[];
  stats: Stats;
  explorePct: number;
  visiveis: OConjunto;
  explorados: OConjunto;
  rngCombat: number;
  /** Estado do stream de despojos — separado do combate por contrato. */
  rngLoot: number;
  proxItemId: number;
  mapa: OMapa;
  log: LogEntry[];
}

export interface OMorte {
  turno: number;
  comandoIndice: number;
  comando: string;
  causa: string;
  causaKind: ArchetypeKey | '';
  snapshot: string;
  jogador: JogadorOracle;
}

export interface OPassada {
  aceitos: string;
  aceitosTotal: number;
  hashesPorComando: string[];
  snapshots: Record<string, string>;
  niveis: OMapa[];
  morte: OMorte | null;
  final: OFinal;
}

export interface ONivelProgressao {
  depth: number;
  snapshot: string;
  jogador: JogadorOracle;
  stats: Stats;
  mapa: OMapa;
  inimigos: OInimigo[];
  itens: OItem[];
  rngCombat: number;
  rngLoot: number;
  proxItemId: number;
}

export interface OProgressao {
  protocolo: string;
  niveis: ONivelProgressao[];
  log: LogEntry[];
}

export interface OCaso extends OPassada {
  id: number;
  seed: string;
  depth: number;
  mapa: OMapa;
  populacao: { inimigos: OInimigo[]; itens: OItem[] };
  progressao: OProgressao;
  inicial: OInicial;
  comandos: string[];
  resistente: OPassada & { protocolo: string; snapshotInicial: string };
}

export interface OArquivo {
  /** Versão do FORMATO deste arquivo (não do jogo). */
  formato: number;
  /** De onde o oracle é derivado. `'engine'` desde ADR-008. */
  oracle: 'engine';
  fonte: string;
  /** SHA-256 do conteúdo de `src/engine/**` no momento da geração. */
  fonteSha256: string;
  fonteArquivos: string[];
  papel: string;
  regraDeOuro: string;
  gerador: {
    script: string;
    protocolo: string;
    contrato: string;
    casos: number;
    comandosPorCaso: number;
    intervaloSnapshot: number;
    descidasForcadas: number;
    lcg: {
      tipo: string;
      semente: number;
      consumo: string;
      indice: string;
      pool: string[];
    };
    hash: string;
    campos: Record<string, string>;
  };
  casos: OCaso[];
}

/** Proveniência calculada por quem tem acesso ao disco (o script em `tools/`). */
export interface Proveniencia {
  fonteSha256: string;
  fonteArquivos: string[];
}

/* ================================================================== *
 * 4. Extratores
 * ================================================================== */

function ponto(p: { x: number; y: number } | null): OPonto | null {
  return p ? { x: p.x, y: p.y } : null;
}

/**
 * A bolsa na ordem da TABELA (`ITEM_KINDS`), jamais na ordem de inserção do
 * objeto, e sem as chaves em zero — exatamente a regra que `snapshot()` aplica
 * ao montar o bloco `B[...]` (src/engine/game.ts). Duas partidas que recolheram
 * os mesmos materiais em ordens diferentes produzem a MESMA lista aqui, que é o
 * que se quer comparar.
 */
export function extrairBolsa(bag: Bag): OMaterial[] {
  const out: OMaterial[] = [];
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = bag[kind] || 0;
    if (n > 0) out.push({ kind: kind, n: n });
  }
  return out;
}

export function extrairJogador(p: Player): JogadorOracle {
  return {
    x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
    atk: p.atk, potions: p.potions, level: p.level, xp: p.xp,
    bolsa: extrairBolsa(p.bag)
  };
}

/* `bump` fica de fora de propósito: é float de animação (§6 do CONTRACTS.md),
 * não é estado lógico. */
export function extrairInimigo(e: Enemy): OInimigo {
  return {
    id: e.id, kind: e.kind, x: e.x, y: e.y,
    hp: e.hp, maxHp: e.maxHp, atk: e.atk, range: e.range,
    state: e.state, plan: String(e.plan === null || e.plan === undefined ? '' : e.plan),
    lastDmg: e.lastDmg
  };
}

export function extrairItem(it: Item): OItem {
  return { id: it.id, kind: it.kind, x: it.x, y: it.y, heal: it.heal };
}

export function extrairInimigos(lista: Enemy[]): OInimigo[] {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairInimigo);
}

/* Ordenado por id — que é único e monotônico, então a pilha de despojos de um
 * mesmo tile sai sempre na ordem em que foi criada. */
export function extrairItens(lista: Item[]): OItem[] {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairItem);
}

export function extrairStats(s: Stats): Stats {
  return {
    turns: s.turns, kills: s.kills, dmgDealt: s.dmgDealt, dmgTaken: s.dmgTaken,
    itemsUsed: s.itemsUsed, deepest: s.deepest, explorePct: s.explorePct
  };
}

export function extrairLog(log: LogEntry[]): LogEntry[] {
  return log.map((e) => ({ turn: e.turn, text: e.text, cls: e.cls }));
}

export function extrairSala(r: Room): OSala {
  return {
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
    cx: r.cx, cy: r.cy, area: r.area, shape: r.shape
  };
}

/**
 * `completo` inclui a lista inteira de salas. Só o mapa de abertura de cada caso
 * a carrega; os demais ficam com `salasHash`, que já detecta qualquer
 * divergência — repetir 25 salas cinco vezes por caso só engordaria o arquivo.
 */
export function extrairMapa(map: GameMap, completo: boolean): OMapa {
  const salas = map.rooms.map(extrairSala);
  const out: OMapa = {
    seed: map.seed,
    depth: map.depth,
    w: map.w,
    h: map.h,
    tilesHash: fnv1aBytes(map.tiles),
    decorHash: fnv1aBytes(map.decor),
    start: ponto(map.start),
    stairs: ponto(map.stairs),
    connectivity: map.connectivity,
    walkable: map.walkable,
    regenerations: map.regenerations,
    repairs: map.repairs,
    salas: salas.length,
    salasHash: fnv1aStr(JSON.stringify(salas)),
    notes: map.notes.slice()
  };
  if (completo) out.rooms = salas;
  return out;
}

/** Ordem canônica ASCENDENTE de índice — independe da ordem de inserção do Set. */
export function extrairVisiveis(game: Game): OConjunto {
  const n = game.map.w * game.map.h;
  const partes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (game.visible.has(i)) partes.push(i);
  }
  return { tamanho: partes.length, hash: fnv1aStr(partes.join(',')) };
}

export function extrairExplorados(game: Game): OConjunto {
  let n = 0;
  for (let i = 0; i < game.explored.length; i++) {
    if (game.explored[i]) n++;
  }
  return { tamanho: n, hash: fnv1aBytes(game.explored) };
}

function estadoRng(r: { s: number } | null | undefined): number {
  return r && typeof r.s === 'number' ? r.s >>> 0 : 0;
}

/* ================================================================== *
 * 5. Protocolos de execução
 * ================================================================== */

/**
 * O resultado de uma passada. É um SUPERCONJUNTO de `OPassada`: o campo
 * `snapshotsPorComando` guarda os 200 snapshots completos em memória para o
 * relatório de divergência do teste, e NÃO é serializado no oracle — 4.800
 * strings de ~300 caracteres dobrariam o arquivo para dizer o que os hashes já
 * dizem.
 */
export interface Passada {
  mapaCompleto: OMapa;
  inicial: OInicial;
  aceitos: string;
  aceitosTotal: number;
  hashesPorComando: string[];
  snapshots: Record<string, string>;
  snapshotsPorComando: string[];
  niveis: OMapa[];
  morte: OMorte | null;
  final: OFinal;
}

export const PROTOCOLO_RESISTENTE =
  'player.maxHp = 999 no início; antes de cada comando, se !over, ' +
  'player.hp = player.maxHp (idêntico ao T6 de legacy/harness-vanilla.mjs)';

export const PROTOCOLO_PROGRESSAO =
  'createState(seed, depth) e depois ' + N_DESCIDAS +
  ' chamadas diretas a descend(game), sem comando nenhum entre elas';

/**
 * Aplica a forma TEXTUAL do comando (a que o oracle grava) sobre o engine.
 * `parseCommand` é a ponte contratada em docs/ARQUITETURA-REACT.md §3: string
 * inválida devolve `null` e o comando é simplesmente recusado, como no vanilla.
 */
export function aplicarTexto(game: Game, texto: string): boolean {
  const cmd = parseCommand(texto);
  if (!cmd) return false;
  return applyCommand(game, cmd) === true;
}

/**
 * Executa `comandos` sobre uma partida nova (seed, depth) e devolve tudo o que
 * a comparação precisa.
 *
 * `vidaFolgada` reproduz o protocolo do T6 do harness vanilla: `maxHp = 999` uma
 * vez e, antes de CADA comando, `if (!over) hp = maxHp`. Sem isso o jogador
 * morre por volta do turno 30 e os 200 comandos viram 170 recusas — que não
 * provam nada. A intervenção é externa ao engine, determinística e trivial de
 * reproduzir (o `Game` é o mesmo objeto mutável dos dois lados).
 */
export function rodarPartida(
  seed: string,
  depth: number,
  comandos: string[],
  vidaFolgada: boolean
): Passada {
  const game = createState(seed, depth);
  if (vidaFolgada) {
    game.player.maxHp = 999;
    game.player.hp = 999;
  }

  const mapaCompleto = extrairMapa(game.map, true);
  const niveis: OMapa[] = [extrairMapa(game.map, false)];
  let depthAtual = game.depth;

  const inicial: OInicial = {
    snapshot: String(snapshot(game)),
    jogador: extrairJogador(game.player),
    inimigos: extrairInimigos(game.enemies),
    itens: extrairItens(game.items),
    stats: extrairStats(game.stats),
    visiveis: extrairVisiveis(game),
    explorados: extrairExplorados(game),
    log: extrairLog(game.log),
    proxItemId: game.proxItemId
  };

  const snapshotsPorTurno: Record<string, string> = {};
  const hashesPorComando: string[] = [];
  const snapshotsPorComando: string[] = [];
  let aceitos = '';
  let morte: OMorte | null = null;
  let ultimoMarco = 0;

  /* turno 0 é marco natural do intervalo de 10 */
  snapshotsPorTurno['0'] = inicial.snapshot;

  for (let i = 0; i < comandos.length; i++) {
    const cmd = comandos[i];
    const jaMorto = game.over;
    if (vidaFolgada && !game.over) game.player.hp = game.player.maxHp;

    const aceito = aplicarTexto(game, cmd);
    aceitos += aceito ? '1' : '0';

    const snap = String(snapshot(game));
    hashesPorComando.push(fnv1aStr(snap));
    snapshotsPorComando.push(snap);

    if (game.depth !== depthAtual) {
      depthAtual = game.depth;
      niveis.push(extrairMapa(game.map, false));
    }

    /* Marco a cada 10 turnos. `endTurn` soma 1 por vez, então o laço fecha
     * sempre no próprio turno; o `while` é só blindagem contra salto. */
    while (game.turn >= ultimoMarco + INTERVALO_SNAPSHOT) {
      ultimoMarco += INTERVALO_SNAPSHOT;
      if (game.turn === ultimoMarco) snapshotsPorTurno[String(ultimoMarco)] = snap;
    }

    if (!jaMorto && game.over && !morte) {
      morte = {
        turno: game.turn,
        comandoIndice: i,
        comando: cmd,
        causa: game.cause,
        causaKind: game.causeKind,
        snapshot: snap,
        jogador: extrairJogador(game.player)
      };
    }
  }

  const final: OFinal = {
    snapshot: String(snapshot(game)),
    depth: game.depth,
    turn: game.turn,
    over: game.over === true,
    cause: game.cause,
    causeKind: game.causeKind,
    jogador: extrairJogador(game.player),
    inimigos: extrairInimigos(game.enemies),
    inimigosVivos: game.enemies.filter((e) => e.hp > 0).length,
    itens: extrairItens(game.items),
    stats: extrairStats(game.stats),
    explorePct: game.stats.explorePct,
    visiveis: extrairVisiveis(game),
    explorados: extrairExplorados(game),
    rngCombat: estadoRng(game.rngCombat),
    rngLoot: estadoRng(game.rngLoot),
    proxItemId: game.proxItemId,
    mapa: extrairMapa(game.map, false),
    log: extrairLog(game.log)
  };

  return {
    mapaCompleto: mapaCompleto,
    inicial: inicial,
    aceitos: aceitos,
    aceitosTotal: aceitos.split('1').length - 1,
    hashesPorComando: hashesPorComando,
    snapshotsPorComando: snapshotsPorComando,
    snapshots: snapshotsPorTurno,
    niveis: niveis,
    morte: morte,
    final: final
  };
}

/**
 * O comando `descend` está no pool, mas só é aceito com o jogador em cima da
 * escada — coisa que 200 comandos sorteados nunca conseguem. Sem esta sonda o
 * oracle não cobriria `descend()`: regeneração do mapa por seed+depth,
 * `maxHp += 2`, `rngCombat` e `rngLoot` ressemeados, `proxItemId` reiniciado,
 * `stats.deepest`, população mais dura — e o fato, que é regra e não detalhe,
 * de que a BOLSA atravessa o andar intacta.
 */
export function rodarProgressao(seed: string, depth: number): OProgressao {
  const game = createState(seed, depth);
  const medir = (): ONivelProgressao => ({
    depth: game.depth,
    snapshot: String(snapshot(game)),
    jogador: extrairJogador(game.player),
    stats: extrairStats(game.stats),
    mapa: extrairMapa(game.map, false),
    inimigos: extrairInimigos(game.enemies),
    itens: extrairItens(game.items),
    rngCombat: estadoRng(game.rngCombat),
    rngLoot: estadoRng(game.rngLoot),
    proxItemId: game.proxItemId
  });
  const niveis: ONivelProgressao[] = [medir()];
  for (let k = 0; k < N_DESCIDAS; k++) {
    descend(game);
    niveis.push(medir());
  }
  return { protocolo: PROTOCOLO_PROGRESSAO, niveis: niveis, log: extrairLog(game.log) };
}

/* ================================================================== *
 * 6. Montagem do oracle
 * ================================================================== */

/** Projeta uma `Passada` no que de fato vai para o arquivo (sem os 200 snapshots). */
function serializarPassada(p: Passada): OPassada {
  return {
    aceitos: p.aceitos,
    aceitosTotal: p.aceitosTotal,
    hashesPorComando: p.hashesPorComando,
    snapshots: p.snapshots,
    niveis: p.niveis,
    morte: p.morte,
    final: p.final
  };
}

/** Um caso completo: mapa, população, progressão e as duas passadas. */
export function montarCaso(indice: number, comandos: string[]): OCaso {
  const seed = sementeDoCaso(indice);
  const depth = profundidadeDoCaso(indice);

  const normal = rodarPartida(seed, depth, comandos, false);
  const resistente = rodarPartida(seed, depth, comandos, true);

  return {
    id: indice + 1,
    seed: seed,
    depth: depth,
    mapa: normal.mapaCompleto,
    populacao: { inimigos: normal.inicial.inimigos, itens: normal.inicial.itens },
    progressao: rodarProgressao(seed, depth),
    inicial: normal.inicial,
    comandos: comandos,
    /* Partida canônica: o jogador como o jogo o cria. Costuma morrer antes dos
     * 200 comandos — a morte também é comportamento a preservar. */
    ...serializarPassada(normal),
    /* Segunda passada, mesmos comandos, jogador curado antes de cada um:
     * garante que os 200 comandos sejam de fato executados. */
    resistente: {
      protocolo: PROTOCOLO_RESISTENTE,
      snapshotInicial: resistente.inicial.snapshot,
      ...serializarPassada(resistente)
    }
  };
}

/**
 * O oracle inteiro, pronto para `JSON.stringify`.
 *
 * DETERMINISMO: nada aqui lê relógio, `Math.random` ou variável de ambiente. Não
 * existe campo `geradoEm` de propósito — um carimbo de tempo quebraria a
 * promessa de que rodar o gerador duas vezes produz o mesmo arquivo byte a
 * byte, e a data da regeneração pertence ao changelog e ao git, não ao dado.
 * A proveniência de CONTEÚDO é `fonteSha256`.
 */
export function montarOracle(prov: Proveniencia): OArquivo {
  const casos = sequenciasDeComando().map((comandos, i) => montarCaso(i, comandos));

  return {
    formato: 2,
    oracle: 'engine',
    fonte: 'src/engine/**',
    fonteSha256: prov.fonteSha256,
    fonteArquivos: prov.fonteArquivos,
    papel:
      'Baseline de regressão caracterizada do engine. NÃO é mais prova de paridade ' +
      'com o vanilla — ver obsidian/02 - ADRs/ADR-008-oracle-derivado-do-engine.md. ' +
      'O oracle vanilla histórico continua em test/golden/snapshots.json.',
    regraDeOuro:
      'Divergência é REGRESSÃO DO ENGINE até prova em contrário. Regenerar este ' +
      'arquivo é ato deliberado, feito com o dono junto e registrado no changelog ' +
      '(obsidian/07 - Changelog). Nunca se regenera para "consertar" um teste vermelho.',
    gerador: {
      script: 'tools/gen-golden-engine.mjs',
      protocolo: 'test/golden/protocolo.ts',
      contrato: 'docs/ARQUITETURA-REACT.md §7.1',
      casos: N_CASOS,
      comandosPorCaso: N_COMANDOS,
      intervaloSnapshot: INTERVALO_SNAPSHOT,
      descidasForcadas: N_DESCIDAS,
      lcg: {
        tipo: 'LCG 32 bits (Numerical Recipes): s = (1664525*s + 1013904223) mod 2^32',
        semente: SEMENTE_LCG,
        consumo: 'um u32 por comando, em sequência contínua do caso 1 ao caso 12',
        indice: 'cmd = pool[s % pool.length]',
        pool: montarPool()
      },
      hash: 'FNV-1a 32 bits, 8 dígitos hex (mesmo algoritmo do jogo)',
      campos: {
        aceitos: 'string de ' + N_COMANDOS + ' dígitos; 1 = applyCommand devolveu true',
        hashesPorComando:
          'hash do snapshot() após cada comando — aponta o primeiro turno divergente',
        snapshots:
          'snapshot() nos turnos múltiplos de ' + INTERVALO_SNAPSHOT + ' (inclui o turno 0)',
        niveis: 'mapa de cada nível visitado, na ordem — o comando descend está no pool',
        morte: 'null se a run sobreviveu aos ' + N_COMANDOS + ' comandos',
        resistente:
          'segunda passada com os MESMOS comandos e o jogador curado antes de cada um ' +
          '(protocolo T6 do harness vanilla); é o que garante que os ' + N_COMANDOS +
          ' comandos sejam executados de verdade em vez de recusados por morte precoce',
        progressao:
          N_DESCIDAS + ' descidas forçadas por descend() — cobre o que a sequência ' +
          'sorteada nunca alcança (o jogador nunca cai em cima da escada por acaso)',
        bolsa:
          'materiais do jogador na ordem de ITEM_KINDS, zeros omitidos — nunca na ' +
          'ordem de inserção do objeto Bag',
        rngLoot: 'estado do stream de despojos, separado do rngCombat por contrato',
        proxItemId: 'contador monotônico de id de item criado em partida',
        rooms: 'lista completa de salas só em casos[].mapa; os demais mapas trazem salasHash',
        excluidos:
          'bump (float de animação), player.facing (ADR-005), abatesRecentes (fila de ' +
          'flutuantes de XP), game.ui e os buffers derivados dmap/fleeMap/dbuf'
      }
    },
    casos: casos
  };
}
