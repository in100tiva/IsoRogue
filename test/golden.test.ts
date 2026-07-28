/*
 * ISOROGUE — test/golden.test.ts
 * ------------------------------------------------------------------
 * PARIDADE ENGINE NOVO × ORACLE VANILLA (docs/ARQUITETURA-REACT.md §7.2).
 *
 * Consome `test/golden/snapshots.json`, gerado por `tools/gen-golden.mjs` a
 * partir de `legacy/isorogue-vanilla.html` rodando em `node:vm`, e reexecuta
 * EXATAMENTE o mesmo protocolo com o engine portado:
 *
 *   · 12 sementes GOLD-0001..GOLD-0012, profundidades 1..3
 *   · 200 comandos por caso, na mesma ordem gravada
 *   · duas passadas por caso: canônica e "resistente" (vida reposta antes de
 *     cada comando — protocolo T6 do harness vanilla)
 *   · 4 descidas forçadas por `descend()` (a progressão que os comandos
 *     sorteados nunca alcançam)
 *
 * A comparação é feita na ORDEM CRONOLÓGICA do jogo, de modo que a primeira
 * falha apontada seja sempre a primeira divergência real:
 *   mapa → população → estado inicial → comando a comando → marcos de 10 turnos
 *   → níveis visitados → morte → estado final (log incluso) → progressão.
 *
 * REGRA DE OURO desta fase: se algo divergir, o errado é o PORT, nunca o
 * oracle. Não regere o snapshots.json, não afrouxe a comparação, não pule caso.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseCommand } from '../src/engine/core';
import { applyCommand, createState, descend, snapshot } from '../src/engine/game';
import { setStorage } from '../src/engine/save';
import type { Enemy, Game, GameMap, Item, LogEntry, Player, Room, Stats } from '../src/engine/types';

/*
 * O engine é puro, mas `endTurn` chama o autosave. Em Node não existe
 * localStorage e o save já degradaria em silêncio; desligamos explicitamente
 * para que NENHUM resíduo de uma partida alcance a seguinte — é o equivalente
 * ao `armazenamento.clear()` que o gerador do oracle faz antes de cada partida.
 */
setStorage(null);

/* ------------------------------------------------------------------ *
 * 1. O oracle
 * ------------------------------------------------------------------ */

interface OPonto {
  x: number;
  y: number;
}

interface OSala {
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

interface OMapa {
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
  rooms?: OSala[];
}

interface OInimigo {
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

interface OItem {
  id: number;
  kind: string;
  x: number;
  y: number;
  heal: number;
}

interface OConjunto {
  tamanho: number;
  hash: string;
}

/*
 * O jogador COMO O ORACLE O CONHECE.
 *
 * §5.1 do docs/PERSONAGEM.md: `player.facing` é cosmético (mesmo estatuto do
 * `bump` dos inimigos) e NÃO pode chegar ao oracle — o vanilla que gerou o
 * snapshots.json não tem esse campo. `extrairJogador` continua copiando
 * exatamente os mesmos oito valores de antes; só o TIPO passa a dizer a verdade
 * sobre o que ele devolve. Correção de tipo, não afrouxamento de teste.
 */
type JogadorOracle = Omit<Player, 'facing'>;

interface OInicial {
  snapshot: string;
  jogador: JogadorOracle;
  inimigos: OInimigo[];
  itens: OItem[];
  stats: Stats;
  visiveis: OConjunto;
  explorados: OConjunto;
  log: LogEntry[];
}

interface OFinal {
  snapshot: string;
  depth: number;
  turn: number;
  over: boolean;
  cause: string;
  jogador: JogadorOracle;
  inimigos: OInimigo[];
  inimigosVivos: number;
  itens: OItem[];
  stats: Stats;
  explorePct: number;
  visiveis: OConjunto;
  explorados: OConjunto;
  rngCombat: number;
  mapa: OMapa;
  log: LogEntry[];
}

interface OMorte {
  turno: number;
  comandoIndice: number;
  comando: string;
  causa: string;
  snapshot: string;
  jogador: JogadorOracle;
}

interface OPassada {
  aceitos: string;
  aceitosTotal: number;
  hashesPorComando: string[];
  snapshots: Record<string, string>;
  niveis: OMapa[];
  morte: OMorte | null;
  final: OFinal;
}

interface ONivelProgressao {
  depth: number;
  snapshot: string;
  jogador: JogadorOracle;
  stats: Stats;
  mapa: OMapa;
  inimigos: OInimigo[];
  itens: OItem[];
  rngCombat: number;
}

interface OCaso extends OPassada {
  id: number;
  seed: string;
  depth: number;
  mapa: OMapa;
  populacao: { inimigos: OInimigo[]; itens: OItem[] };
  progressao: { protocolo: string; niveis: ONivelProgressao[]; log: LogEntry[] };
  inicial: OInicial;
  comandos: string[];
  resistente: OPassada & { snapshotInicial: string };
}

interface OArquivo {
  geradoEm: string;
  fonte: string;
  fonteSha256: string;
  gerador: { casos: number; comandosPorCaso: number; intervaloSnapshot: number };
  casos: OCaso[];
}

const oracle: OArquivo = JSON.parse(
  readFileSync(new URL('./golden/snapshots.json', import.meta.url), 'utf8')
) as OArquivo;

/* ------------------------------------------------------------------ *
 * 2. Extratores — CÓPIA LITERAL dos de tools/gen-golden.mjs
 *
 * Mesma ordem de campos, mesmo algoritmo de hash, mesmas omissões
 * (`bump` fica de fora: é float de animação, não estado lógico).
 * ------------------------------------------------------------------ */

function fnv1aStr(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fnv1aBytes(arr: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i] & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function ponto(p: { x: number; y: number } | null): OPonto | null {
  return p ? { x: p.x, y: p.y } : null;
}

function extrairJogador(p: Player): JogadorOracle {
  return {
    x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
    atk: p.atk, potions: p.potions, level: p.level, xp: p.xp
  };
}

function extrairInimigo(e: Enemy): OInimigo {
  return {
    id: e.id, kind: e.kind, x: e.x, y: e.y,
    hp: e.hp, maxHp: e.maxHp, atk: e.atk, range: e.range,
    state: e.state, plan: String(e.plan === null || e.plan === undefined ? '' : e.plan),
    lastDmg: e.lastDmg
  };
}

function extrairItem(it: Item): OItem {
  return { id: it.id, kind: it.kind, x: it.x, y: it.y, heal: it.heal };
}

function extrairInimigos(lista: Enemy[]): OInimigo[] {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairInimigo);
}

function extrairItens(lista: Item[]): OItem[] {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairItem);
}

function extrairStats(s: Stats): Stats {
  return {
    turns: s.turns, kills: s.kills, dmgDealt: s.dmgDealt, dmgTaken: s.dmgTaken,
    itemsUsed: s.itemsUsed, deepest: s.deepest, explorePct: s.explorePct
  };
}

function extrairLog(log: LogEntry[]): LogEntry[] {
  return log.map((e) => ({ turn: e.turn, text: e.text, cls: e.cls }));
}

function extrairSala(r: Room): OSala {
  return {
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
    cx: r.cx, cy: r.cy, area: r.area, shape: r.shape
  };
}

function extrairMapa(map: GameMap, completo: boolean): OMapa {
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
function extrairVisiveis(game: Game): OConjunto {
  const n = game.map.w * game.map.h;
  const partes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (game.visible.has(i)) partes.push(i);
  }
  return { tamanho: partes.length, hash: fnv1aStr(partes.join(',')) };
}

function extrairExplorados(game: Game): OConjunto {
  let n = 0;
  for (let i = 0; i < game.explored.length; i++) {
    if (game.explored[i]) n++;
  }
  return { tamanho: n, hash: fnv1aBytes(game.explored) };
}

/* ------------------------------------------------------------------ *
 * 3. Protocolos — cópia literal de `rodarPartida` e `rodarProgressao`
 * ------------------------------------------------------------------ */

const INTERVALO_SNAPSHOT = 10;
const N_DESCIDAS = 4;

interface Passada {
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

/**
 * Aplica a forma TEXTUAL do comando (a do oracle) sobre o engine novo.
 * `parseCommand` é a ponte contratada em docs/ARQUITETURA-REACT.md §3: string
 * inválida devolve `null` e, como no vanilla, o comando é simplesmente recusado.
 */
function aplicarTexto(game: Game, texto: string): boolean {
  const cmd = parseCommand(texto);
  if (!cmd) return false;
  return applyCommand(game, cmd) === true;
}

function rodarPartida(seed: string, depth: number, comandos: string[], vidaFolgada: boolean): Passada {
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
    log: extrairLog(game.log)
  };

  const snapshotsPorTurno: Record<string, string> = {};
  const hashesPorComando: string[] = [];
  const snapshotsPorComando: string[] = [];
  let aceitos = '';
  let morte: OMorte | null = null;
  let ultimoMarco = 0;

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
    jogador: extrairJogador(game.player),
    inimigos: extrairInimigos(game.enemies),
    inimigosVivos: game.enemies.filter((e) => e.hp > 0).length,
    itens: extrairItens(game.items),
    stats: extrairStats(game.stats),
    explorePct: game.stats.explorePct,
    visiveis: extrairVisiveis(game),
    explorados: extrairExplorados(game),
    rngCombat: game.rngCombat.s >>> 0,
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

function rodarProgressao(seed: string, depth: number): { niveis: ONivelProgressao[]; log: LogEntry[] } {
  const game = createState(seed, depth);
  const medir = (): ONivelProgressao => ({
    depth: game.depth,
    snapshot: String(snapshot(game)),
    jogador: extrairJogador(game.player),
    stats: extrairStats(game.stats),
    mapa: extrairMapa(game.map, false),
    inimigos: extrairInimigos(game.enemies),
    itens: extrairItens(game.items),
    rngCombat: game.rngCombat.s >>> 0
  });
  const niveis: ONivelProgressao[] = [medir()];
  for (let k = 0; k < N_DESCIDAS; k++) {
    descend(game);
    niveis.push(medir());
  }
  return { niveis: niveis, log: extrairLog(game.log) };
}

/* ------------------------------------------------------------------ *
 * 4. Relatório de divergência
 * ------------------------------------------------------------------ */

function primeiraDivergencia<T>(a: readonly T[], b: readonly T[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function recorta(texto: string, max: number): string {
  const t = String(texto);
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/** Bloco legível "campo: valor" para a mensagem de falha. */
function bloco(titulo: string, campos: Array<[string, unknown]>): string {
  const larg = campos.reduce((m, c) => Math.max(m, c[0].length), 0);
  const linhas = campos.map(([k, v]) => '    ' + k.padEnd(larg) + ' : ' + String(v));
  return '\n  ' + titulo + '\n' + linhas.join('\n') + '\n';
}

/**
 * Compara a sequência comando a comando e ACUSA O PRIMEIRO TURNO DIVERGENTE,
 * com o comando, o turno, o snapshot obtido e o último ponto de concordância.
 */
function conferirSequencia(
  rotulo: string,
  caso: OCaso,
  esperado: OPassada,
  obtido: Passada
): void {
  const kAceitos = primeiraDivergencia(esperado.aceitos.split(''), obtido.aceitos.split(''));
  const kHashes = primeiraDivergencia(esperado.hashesPorComando, obtido.hashesPorComando);

  const k = (kAceitos === -1) ? kHashes : (kHashes === -1 ? kAceitos : Math.min(kAceitos, kHashes));
  if (k === -1) return;

  const anterior = k > 0 ? obtido.snapshotsPorComando[k - 1] : caso.inicial.snapshot;
  const snapObtido = obtido.snapshotsPorComando[k];

  /* Último marco de 10 turnos em que oracle e port ainda concordavam — é o
   * ponto de partida para investigar o que aconteceu entre ele e o comando k. */
  const marcosIguais = Object.keys(esperado.snapshots)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((t) => esperado.snapshots[String(t)] === obtido.snapshots[String(t)]);
  const marcoAnterior = marcosIguais.pop();

  /*
   * O oracle guarda o snapshot COMPLETO só nos marcos de 10 turnos, na morte e
   * no fim; nos demais comandos guarda o hash. Quando o completo existe para
   * este ponto, mostramos os dois lado a lado e o caractere onde se separam —
   * é o que diz de imediato se a divergência é de posição, hp, inimigo, rng ou
   * mapa.
   */
  const snapEsperado =
    (esperado.morte && esperado.morte.comandoIndice === k) ? esperado.morte.snapshot :
      (k === caso.comandos.length - 1 ? esperado.final.snapshot : undefined);
  let coluna = -1;
  if (snapEsperado && snapObtido) {
    const n = Math.min(snapEsperado.length, snapObtido.length);
    for (let j = 0; j < n; j++) {
      if (snapEsperado[j] !== snapObtido[j]) {
        coluna = j;
        break;
      }
    }
    if (coluna === -1 && snapEsperado.length !== snapObtido.length) coluna = n;
  }

  const detalhe = bloco(
    'PRIMEIRA DIVERGÊNCIA — ' + caso.seed + ' (nível ' + caso.depth + ', passada ' + rotulo + ')',
    [
      ['comando nº', k + ' de ' + caso.comandos.length],
      ['comando', JSON.stringify(caso.comandos[k])],
      ['aceito (oracle)', esperado.aceitos.charAt(k) === '1'],
      ['aceito (port)', obtido.aceitos.charAt(k) === '1'],
      ['hash esperado', esperado.hashesPorComando[k] || '(fim da lista)'],
      ['hash obtido', obtido.hashesPorComando[k] || '(fim da lista)'],
      ['snapshot anterior', recorta(anterior, 240)],
      ['snapshot obtido', recorta(snapObtido || '(ausente)', 240)],
      ['snapshot esperado', snapEsperado ? recorta(snapEsperado, 240)
        : '(o oracle só guarda o hash neste ponto)'],
      ['1ª diferença', coluna === -1 ? '(não comparável aqui)' : 'caractere ' + coluna],
      ['último marco igual', marcoAnterior === undefined ? '(nenhum)' : 'turno ' + marcoAnterior],
      ['reprodução', 'createState(\'' + caso.seed + '\', ' + caso.depth + ') + ' +
        (k + 1) + ' comandos de casos[' + (caso.id - 1) + '].comandos' +
        (rotulo === 'resistente' ? ' (com hp reposto antes de cada comando)' : '')]
    ]
  );

  expect(
    { comando: k, aceito: obtido.aceitos.charAt(k) === '1', hash: obtido.hashesPorComando[k] },
    detalhe
  ).toEqual(
    { comando: k, aceito: esperado.aceitos.charAt(k) === '1', hash: esperado.hashesPorComando[k] }
  );
}

/** Confere uma passada inteira, do mapa ao log final, em ordem cronológica. */
function conferirPassada(rotulo: string, caso: OCaso, esperado: OPassada, obtido: Passada): void {
  const onde = caso.seed + ' [' + rotulo + ']';

  // 1) o jogo, comando a comando — é aqui que a primeira divergência aparece
  conferirSequencia(rotulo, caso, esperado, obtido);
  expect(obtido.aceitos, onde + ': string de comandos aceitos').toBe(esperado.aceitos);
  expect(obtido.aceitosTotal, onde + ': total de comandos aceitos').toBe(esperado.aceitosTotal);
  expect(obtido.hashesPorComando, onde + ': hashes por comando').toEqual(esperado.hashesPorComando);

  // 2) marcos de 10 turnos — snapshot() completo, string com string
  expect(Object.keys(obtido.snapshots).sort(), onde + ': marcos de snapshot').toEqual(
    Object.keys(esperado.snapshots).sort()
  );
  for (const turno of Object.keys(esperado.snapshots)) {
    expect(obtido.snapshots[turno], onde + ': snapshot no turno ' + turno).toBe(
      esperado.snapshots[turno]
    );
  }

  // 3) níveis visitados durante a sequência
  expect(obtido.niveis.length, onde + ': quantidade de níveis visitados').toBe(esperado.niveis.length);
  for (let i = 0; i < esperado.niveis.length; i++) {
    expect(obtido.niveis[i], onde + ': mapa do nível visitado nº ' + i).toEqual(esperado.niveis[i]);
  }

  // 4) morte (turno, comando e causa em pt-BR)
  expect(obtido.morte, onde + ': morte').toEqual(esperado.morte);

  // 5) estado final completo, log incluído
  expect(obtido.final.snapshot, onde + ': snapshot final').toBe(esperado.final.snapshot);
  expect(obtido.final.turn, onde + ': turno final').toBe(esperado.final.turn);
  expect(obtido.final.depth, onde + ': nível final').toBe(esperado.final.depth);
  expect(obtido.final.over, onde + ': over final').toBe(esperado.final.over);
  expect(obtido.final.cause, onde + ': causa da morte').toBe(esperado.final.cause);
  expect(obtido.final.jogador, onde + ': jogador final').toEqual(esperado.final.jogador);
  expect(obtido.final.inimigos, onde + ': inimigos finais').toEqual(esperado.final.inimigos);
  expect(obtido.final.itens, onde + ': itens finais').toEqual(esperado.final.itens);
  expect(obtido.final.stats, onde + ': estatísticas finais').toEqual(esperado.final.stats);
  expect(obtido.final.visiveis, onde + ': tiles visíveis').toEqual(esperado.final.visiveis);
  expect(obtido.final.explorados, onde + ': tiles explorados').toEqual(esperado.final.explorados);
  expect(obtido.final.rngCombat, onde + ': estado do rngCombat').toBe(esperado.final.rngCombat);
  expect(obtido.final.mapa, onde + ': mapa final').toEqual(esperado.final.mapa);

  const kLog = primeiraDivergencia(
    esperado.final.log.map((e) => e.turn + '|' + e.cls + '|' + e.text),
    obtido.final.log.map((e) => e.turn + '|' + e.cls + '|' + e.text)
  );
  if (kLog !== -1) {
    const detalhe = bloco('REGISTRO DIVERGENTE — ' + onde, [
      ['linha nº', kLog],
      ['tamanho oracle', esperado.final.log.length],
      ['tamanho port', obtido.final.log.length],
      ['oracle', JSON.stringify(esperado.final.log[kLog] || null)],
      ['port', JSON.stringify(obtido.final.log[kLog] || null)]
    ]);
    expect(obtido.final.log[kLog], detalhe).toEqual(esperado.final.log[kLog]);
  }
  expect(obtido.final.log, onde + ': registro completo').toEqual(esperado.final.log);
}

/* ------------------------------------------------------------------ *
 * 5. Os 12 casos
 * ------------------------------------------------------------------ */

describe('golden — paridade do engine portado com o oracle vanilla', () => {
  it('o oracle está íntegro e no formato do contrato §7.1', () => {
    expect(oracle.fonte).toBe('legacy/isorogue-vanilla.html');
    expect(oracle.casos.length).toBe(12);
    expect(oracle.gerador.comandosPorCaso).toBe(200);
    expect(oracle.gerador.intervaloSnapshot).toBe(INTERVALO_SNAPSHOT);
    for (const caso of oracle.casos) {
      expect(caso.comandos.length, caso.seed + ': comandos gravados').toBe(200);
      expect(caso.hashesPorComando.length, caso.seed + ': hashes gravados').toBe(200);
      expect(caso.aceitos.length, caso.seed + ': dígitos de aceitação').toBe(200);
    }
  });

  for (const caso of oracle.casos) {
    describe(caso.seed + ' (nível ' + caso.depth + ')', () => {
      it('gera o mesmo mapa e a mesma população', () => {
        const game = createState(caso.seed, caso.depth);

        expect(extrairMapa(game.map, true), caso.seed + ': mapa de abertura').toEqual(caso.mapa);
        expect(extrairInimigos(game.enemies), caso.seed + ': inimigos do spawn').toEqual(
          caso.populacao.inimigos
        );
        expect(extrairItens(game.items), caso.seed + ': itens do spawn').toEqual(
          caso.populacao.itens
        );

        expect(String(snapshot(game)), caso.seed + ': snapshot inicial').toBe(caso.inicial.snapshot);
        expect(extrairJogador(game.player), caso.seed + ': jogador inicial').toEqual(
          caso.inicial.jogador
        );
        expect(extrairStats(game.stats), caso.seed + ': estatísticas iniciais').toEqual(
          caso.inicial.stats
        );
        expect(extrairVisiveis(game), caso.seed + ': FOV inicial').toEqual(caso.inicial.visiveis);
        expect(extrairExplorados(game), caso.seed + ': explorados iniciais').toEqual(
          caso.inicial.explorados
        );
        expect(extrairLog(game.log), caso.seed + ': registro de abertura').toEqual(
          caso.inicial.log
        );
      });

      it('reproduz os 200 comandos da partida canônica', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, false);
        expect(obtido.mapaCompleto, caso.seed + ': mapa').toEqual(caso.mapa);
        expect(obtido.inicial, caso.seed + ': estado inicial').toEqual(caso.inicial);
        conferirPassada('canônica', caso, caso, obtido);
      });

      it('reproduz os 200 comandos da partida resistente (vida reposta)', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, true);
        expect(obtido.inicial.snapshot, caso.seed + ': snapshot inicial resistente').toBe(
          caso.resistente.snapshotInicial
        );
        conferirPassada('resistente', caso, caso.resistente, obtido);
      });

      it('reproduz as ' + N_DESCIDAS + ' descidas forçadas da progressão', () => {
        const obtido = rodarProgressao(caso.seed, caso.depth);
        expect(obtido.niveis.length, caso.seed + ': níveis da progressão').toBe(
          caso.progressao.niveis.length
        );
        for (let i = 0; i < caso.progressao.niveis.length; i++) {
          const esperado = caso.progressao.niveis[i];
          const atual = obtido.niveis[i];
          const onde = caso.seed + ': progressão nível ' + esperado.depth;
          expect(atual.snapshot, onde + ' — snapshot').toBe(esperado.snapshot);
          expect(atual.depth, onde + ' — profundidade').toBe(esperado.depth);
          expect(atual.jogador, onde + ' — jogador').toEqual(esperado.jogador);
          expect(atual.stats, onde + ' — estatísticas').toEqual(esperado.stats);
          expect(atual.mapa, onde + ' — mapa').toEqual(esperado.mapa);
          expect(atual.inimigos, onde + ' — inimigos').toEqual(esperado.inimigos);
          expect(atual.itens, onde + ' — itens').toEqual(esperado.itens);
          expect(atual.rngCombat, onde + ' — rngCombat').toBe(esperado.rngCombat);
        }
        expect(obtido.log, caso.seed + ': registro da progressão').toEqual(caso.progressao.log);
      });
    });
  }
});
