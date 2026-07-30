/*
 * ISOROGUE — engine/game.ts
 * Estado, turnos e progressão. Porte da API PURA de `legacy/src-vanilla/70-game.js`.
 *
 * O que veio: createState, applyCommand, endTurn, snapshot, descend, logMsg, restore.
 * O que NÃO veio (por contrato, docs/ARQUITETURA-REACT.md §0): boot, listeners de
 * teclado/mouse, requestAnimationFrame, câmera, tooltip e qualquer toque em DOM —
 * isso é responsabilidade da camada React (src/ui/**) e do renderer.
 *
 * Regras desta migração: mesmas fórmulas, mesma ordem de operações, mesmos textos
 * de log em pt-BR e `snapshot()` byte a byte igual ao vanilla.
 */

import type {
  ArchetypeKey,
  Command,
  CustoReceita,
  EnemyState,
  Enemy,
  Game,
  GameMap,
  Item,
  ItemKind,
  LogClass,
  LogEntry,
  MaterialKind,
  Player,
  Point,
  ReceitaKind,
  Rng,
  Room
} from './types';
import { Tile } from './types';
import {
  CONFIG,
  DEFAULT_FACING,
  QUANTIDADE_MAX,
  QUANTIDADE_MIN,
  cheb,
  dirIndex,
  hash32,
  idx,
  makeRng,
  normalizeFacing,
  normalizeSeed
} from './core';
import { generate, inBounds, isWalkable, roomAt } from './mapgen';
import { computeFov } from './fov';
import { computeDijkstra } from './dijkstra';
import type { ItemDef, ReceitaDef } from './entities';
import {
  ALQUIMIA_EXTRAS_MAX,
  ARCHETYPES,
  ARMA_NIVEL_MAX,
  ATK_POR_REFINO,
  ITEM_KINDS,
  ITENS,
  POTION_HEAL,
  PRECO_POCAO,
  RECEITAS,
  ehMaterial,
  faltasDaReceita,
  makeItem,
  normalizeItemKind,
  normalizeReceita,
  populate,
  processEnemies,
  rollDamage,
  sortearDespojos
} from './entities';
import {
  base64ToBytes,
  clear as apagarArmazenamento,
  pushHistory as empilharHistorico,
  write as escreverSave
} from './save';

// --------------------------------------------------------------------------
// Constantes de jogo (idênticas ao vanilla)
// --------------------------------------------------------------------------

const PLAYER_BASE = { hp: 42, atk: 7, potions: 3 };
// A cura da poção vem de `entities.ts` (dono do item, §6), que grava o mesmo
// número em `item.heal`. Fonte única, como no vanilla.
// §15 do BESTIARIO — XP PLANO: 100 por nível, para qualquer nível. Ao cruzar
// 100 o herói sobe e o EXCEDENTE é carregado (decisão do dono na fase de
// balanceamento — matar um ogro de 400 xp com 0 acumulado rende 4 níveis).
const XP_POR_NIVEL = 100;
const HP_POR_DESCIDA = 2;  // §7: maxHp += 2 ao descer

const NOMES: Record<string, string> = {
  chaser: 'Perseguidor',
  sentinel: 'Brutamontes',
  linker: 'Vinculador'
};
const FEMININO: Record<string, boolean> = { chaser: false, sentinel: false, linker: false };
const ESTADOS: Record<string, string> = {
  idle: 'ocioso',
  hunt: 'caçando',
  flee: 'em fuga',
  attack: 'atacando',
  wait: 'aguardando'
};
const CLASSES_LOG: Record<string, 1> = { info: 1, bom: 1, ruim: 1, aviso: 1, sistema: 1 };
// Nome pt-BR dos formatos de sala produzidos pelo BSP (§3).
const FORMATOS: Record<string, string> = {
  rect: 'retangular',
  cross: 'em cruz',
  round: 'arredondada',
  pillared: 'com colunas',
  notched: 'recortada'
};

// --------------------------------------------------------------------------
// Helpers puros
// --------------------------------------------------------------------------

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function intOr(v: unknown, def: number): number {
  let n: unknown = v;
  if (typeof n === 'string' && n !== '') n = Number(n);
  return isNum(n) ? Math.floor(n) : def;
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  let n = intOr(v, def);
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}

function objetoDe(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  return v as Record<string, unknown>;
}

/** Lista (array ou array-like) — o vanilla só exigia `length != null`. */
function listaDe(v: unknown): ArrayLike<unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as ArrayLike<unknown>;
  return typeof l.length === 'number' ? l : null;
}

function nomeDe(ent: { kind: string }): string {
  const arch = ARCHETYPES[ent.kind as ArchetypeKey];
  if (arch && arch.nome) return arch.nome;
  return NOMES[ent.kind] || 'Criatura';
}

function feminino(ent: { kind: string }): boolean {
  return !!FEMININO[ent.kind];
}

function artigo(ent: { kind: string }): string {
  return feminino(ent) ? 'a' : 'o';
}

function artigoMaiusculo(ent: { kind: string }): string {
  return feminino(ent) ? 'A' : 'O';
}

/**
 * Artigo INDEFINIDO do item ('um frasco', 'uma orelha'). O gênero é do item,
 * não de quem o largou — por isso vem de `ITENS[kind].fem` e não do arquétipo.
 */
function artigoItem(def: ItemDef): string {
  return def.fem ? 'uma' : 'um';
}

/**
 * Quantidade por extenso do jeito que o registro fala: uma unidade sai com
 * artigo e no singular ('uma poção'), duas ou mais saem com o número e no
 * plural ('2 frascos de gosma'). É o que mantém a mensagem de poção BYTE A
 * BYTE igual à de antes dos despojos.
 */
function quantiaDeItem(def: ItemDef, n: number): string {
  return n === 1 ? artigoItem(def) + ' ' + def.nome : n + ' ' + def.plural;
}

/**
 * Moedas por extenso, com o plural concordando ('1 moeda', '15 moedas').
 * Sempre com o número — inclusive no singular: aqui a informação é a QUANTIA,
 * não a cena, então 'uma moeda' seria estilo no lugar errado.
 */
function moedasEmTexto(n: number): string {
  return n === 1 ? '1 moeda' : n + ' moedas';
}

/** Lista de materiais em pt-BR: 'a, b e c'. Ordem de entrada, nunca alfabética. */
function listaEmTexto(partes: string[]): string {
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
}

/**
 * O custo de uma receita por extenso ('3 frascos de gosma'), na ordem de
 * `ITEM_KINDS` — a mesma ordem da bolsa e do snapshot, jamais `Object.keys`.
 */
function custoEmTexto(custo: CustoReceita): string {
  const partes: string[] = [];
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = custo[kind] || 0;
    if (n > 0) partes.push(quantiaDeItem(ITENS[kind], n));
  }
  return listaEmTexto(partes);
}

function tileEm(map: GameMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return Tile.Wall;
  return map.tiles[idx(map.w, x, y)];
}

// Sala que contém o tile. A busca é de mapgen (`roomAt`), dono do dado; aqui
// fica só o apelido em pt-BR que o resto do módulo já usava. Usado para narrar
// a movimentação no registro (R49).
function salaEm(map: GameMap | null, x: number, y: number): Room | null {
  return roomAt(map, x, y);
}

function idDaSala(map: GameMap | null, x: number, y: number): number | null {
  const r = salaEm(map, x, y);
  return r ? r.id : null;
}

function formatoDaSala(shape: string): string {
  return FORMATOS[shape] || 'irregular';
}

function enemyAt(game: Game, x: number, y: number): Enemy | null {
  const list = game.enemies;
  for (let i = 0; i < list.length; i++) {
    if (list[i].hp > 0 && list[i].x === x && list[i].y === y) return list[i];
  }
  return null;
}

/**
 * Primeiro id livre acima do maior id de item da lista.
 *
 * É a semente de `game.proxItemId` (§ tipo `Game`): `populate` numera de 1 a N,
 * então o primeiro despojo da partida sai com N+1 e nunca colide com o que já
 * está no chão. Vale também como reconstrução de um save antigo, que não
 * gravava o contador.
 */
function proximoIdDeItem(itens: Item[]): number {
  let maior = 0;
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    if (it && it.id > maior) maior = it.id;
  }
  return maior + 1;
}

/**
 * Stream de despojos, com o mesmo fallback determinístico de `combatRng` em
 * entities.ts: o contrato é que ele venha de `createState`, mas um `Game`
 * montado à mão (teste, ferramenta) não pode explodir por causa disso.
 */
function lootRng(game: Game): Rng {
  if (!game.rngLoot) {
    game.rngLoot = makeRng(hash32(String(game.seedStr) + '#loot' + game.depth));
  }
  return game.rngLoot;
}

// --------------------------------------------------------------------------
// Registro (log)
// --------------------------------------------------------------------------

/**
 * Empilha uma entrada no registro, respeitando `CONFIG.MAX_LOG`.
 * No vanilla esta função também empurrava a linha para o DOM; aqui ela é pura —
 * quem observa o registro é a camada React, via `store` (versão do estado).
 */
export function logMsg(game: Game, text: string, cls?: LogClass): LogEntry | null {
  if (!game || !game.log) return null;
  const entry: LogEntry = {
    turn: game.turn,
    text: String(text),
    cls: (cls && CLASSES_LOG[cls]) ? cls : 'info'
  };
  game.log.push(entry);
  const excedente = game.log.length - CONFIG.MAX_LOG;
  if (excedente > 0) game.log.splice(0, excedente);
  return entry;
}

function logNotasDoMapa(game: Game, map: GameMap | null): void {
  if (!map || !map.notes) return;
  for (let i = 0; i < map.notes.length; i++) {
    logMsg(game, String(map.notes[i]), 'sistema');
  }
}

// --------------------------------------------------------------------------
// Derivados do estado: Dijkstra, FOV, estatísticas
// --------------------------------------------------------------------------

function computeDmap(game: Game): void {
  // `computeDijkstra` recicla um buffer por objeto `map`; passamos um buffer
  // próprio para que nada mais possa sobrescrever game.dmap no meio do turno.
  const n = game.map.w * game.map.h;
  if (!game.dbuf || game.dbuf.length !== n) game.dbuf = new Int32Array(n);
  game.dmap = computeDijkstra(
    game.map,
    [{ x: game.player.x, y: game.player.y, v: 0 }],
    { blocked: null, out: game.dbuf }
  );
  // O gradiente de fuga é derivado do dmap e custa um re-scan iterativo:
  // invalida aqui e deixa entities calculá-lo sob demanda (só quando há ferido).
  game.fleeMap = null;
}

function atualizarFov(game: Game): void {
  const vis = computeFov(game.map, game.player.x, game.player.y, CONFIG.FOV_RADIUS);
  game.visible = vis;
  const ex = game.explored;
  vis.forEach((i) => {
    if (i >= 0 && i < ex.length) ex[i] = 1;
  });
}

function updateStats(game: Game): void {
  const s = game.stats;
  const tiles = game.map.tiles;
  const ex = game.explored;
  let total = 0;
  let vistos = 0;
  s.turns = game.turn;
  if (game.depth > s.deepest) s.deepest = game.depth;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Wall) {
      total++;
      if (ex[i]) vistos++;
    }
  }
  s.explorePct = total > 0 ? Math.round((vistos / total) * 1000) / 10 : 0;
}

function refreshDerived(game: Game): void {
  computeDmap(game);
  atualizarFov(game);
  updateStats(game);
}

// --------------------------------------------------------------------------
// Persistência (sempre tolerante a falhas)
// --------------------------------------------------------------------------

function autosave(game: Game): void {
  if (!game || game.over) return;
  try {
    escreverSave(game);
  } catch (e) { /* armazenamento indisponível não pode quebrar o jogo */ }
}

function apagarSave(): void {
  try {
    apagarArmazenamento();
  } catch (e) { /* silencioso por contrato */ }
}

function gravarHistorico(game: Game): void {
  try {
    empilharHistorico(game);
  } catch (e) { /* silencioso por contrato */ }
}

// --------------------------------------------------------------------------
// Criação de estado
// --------------------------------------------------------------------------

export function createState(seedStr: string, depth: number = 1, heroLevel: number = 1): Game {
  let d = intOr(depth, 1);
  if (d < 1) d = 1;
  let nivel = intOr(heroLevel, 1);
  if (nivel < 1) nivel = 1;
  const seed = normalizeSeed(seedStr);
  const map = generate(seed, d);
  // §15 — a mistura de spawn do primeiro andar usa o nível do herói (1 numa
  // expedição nova; o nível salvo numa retomada — ver `restore`).
  const pop = populate(map, d, nivel);

  const game: Game = {
    seedStr: seed,
    depth: d,
    turn: 0,
    over: false,
    cause: '',
    causeKind: '',     // arquétipo do golpe fatal, gravado por entities
    map: map,
    player: {
      x: map.start.x,
      y: map.start.y,
      hp: PLAYER_BASE.hp,
      maxHp: PLAYER_BASE.hp,
      atk: PLAYER_BASE.atk,
      potions: PLAYER_BASE.potions,
      level: 1,
      xp: 0,
      // Bolsa de materiais vazia — sem limite de capacidade nesta fase.
      bag: {},
      // Fase 2: a expedição começa dura. Toda moeda vem de vender despojo.
      moedas: 0,
      armaNivel: 0,
      // §5.1 do docs/PERSONAGEM.md — cosmético; nunca entra em `snapshot()`.
      facing: DEFAULT_FACING
    },
    // Os dois pontos de parada saem de `populate` (que sabe onde caíram
    // inimigos e itens); podem ser `null` num mapa sem tile elegível.
    mercador: pop.mercador,
    bancada: pop.bancada,
    // A decoração da estação de alquimia acompanha o caldeirão — ela sai do
    // mesmo cálculo e nunca é recomposta em outro lugar.
    alquimiaExtras: pop.alquimiaExtras,
    enemies: pop.enemies,
    items: pop.items,
    // Continua a numeração de `populate` (1..N) — o primeiro despojo é N+1.
    proxItemId: proximoIdDeItem(pop.items),
    // O vanilla começava com `dmap: null`; aqui o campo é tipado como Int32Array,
    // então parte vazio e `refreshDerived` o preenche antes de qualquer leitura.
    dmap: new Int32Array(0),
    fleeMap: null,
    dbuf: null,
    visible: new Set<number>(),
    explored: new Uint8Array(map.w * map.h),
    rngCombat: makeRng(hash32(seed + '#combat' + d)),
    // Stream SEPARADO do combate (ver `Game.rngLoot`): misturar os dois faria o
    // dano do próximo golpe depender da sorte do despojo anterior.
    rngLoot: makeRng(hash32(seed + '#loot' + d)),
    log: [],
    stats: {
      turns: 0,
      kills: 0,
      dmgDealt: 0,
      dmgTaken: 0,
      itemsUsed: 0,
      deepest: d,
      explorePct: 0
    },
    ui: { hover: null, debug: false, fovProbe: false, follow: true },
    lastRoomId: null,  // sala em que o jogador está (log de movimentação, R49)
    emTurno: false,    // trava de reentrância do fim de turno
    abatesRecentes: [] // §16 — fila visual dos flutuantes de XP (o renderer drena)
  };
  game.lastRoomId = idDaSala(map, game.player.x, game.player.y);

  logMsg(game, 'Nível ' + d + ' — masmorra gerada com a semente ' + seed + '.', 'sistema');
  logNotasDoMapa(game, map);
  logMsg(game, 'Inimigos: ' + game.enemies.length + ' — poções no chão: ' + game.items.length + '.', 'sistema');
  refreshDerived(game);
  return game;
}

// --------------------------------------------------------------------------
// Ações do jogador
// --------------------------------------------------------------------------

/**
 * §15 do BESTIARIO — o XP do abate, na escala do dono: 100 quando o monstro é
 * do nível do herói, DOBRANDO por nível acima (200/400) e CAINdo pela metade
 * por nível abaixo (50/25), até zero quando o herói passa três níveis do
 * monstro — um slime deixa de render XP no nível 4, um goblin no 5, um ogro
 * no 6.
 */
function xpPorAbate(p: Player, ent: Enemy): number {
  const arch = ARCHETYPES[ent.kind];
  const nivelMonstro = arch && isNum(arch.nivel) ? arch.nivel : 1;
  const diff = p.level - nivelMonstro;
  if (diff >= 3) return 0;
  return Math.round(100 * Math.pow(2, -diff));
}

function ganharXp(game: Game, quanto: number): void {
  const p = game.player;
  p.xp += quanto;
  // XP plano de 100 por nível, com o excedente CARREGADO (§15).
  while (p.xp >= XP_POR_NIVEL) {
    p.xp -= XP_POR_NIVEL;
    p.level += 1;
    p.maxHp += 4;
    p.hp = Math.min(p.maxHp, p.hp + 4);
    p.atk += 1;
    logMsg(game, 'Você alcança o nível ' + p.level + ' de experiência. Vida máxima ' +
      p.maxHp + ', ataque ' + p.atk + '.', 'bom');
  }
}

function removerInimigo(game: Game, ent: Enemy): void {
  for (let i = 0; i < game.enemies.length; i++) {
    if (game.enemies[i] === ent) {
      game.enemies.splice(i, 1);
      return;
    }
  }
}

/**
 * Larga os despojos do abate NO TILE onde o monstro morreu.
 *
 * Regras da fase 1:
 *  · a tabela é rolada em `sortearDespojos` (entities.ts), que consome sempre o
 *    mesmo número de valores de `rngLoot` — a sorte do despojo não desloca o
 *    stream de ninguém;
 *  · os ids saem de `game.proxItemId`, na ordem da tabela de despojos, e são
 *    monotônicos pela partida inteira;
 *  · itens EMPILHAM: dois despojos do mesmo abate (ou de dois abates no mesmo
 *    tile) ficam ali, um sobre o outro. Nada é empurrado para tile vizinho —
 *    deslocar item mudaria a leitura do mapa por um detalhe de arrumação, e
 *    `pegarItem` recolhe a pilha inteira num passo só.
 */
function largarDespojos(game: Game, ent: Enemy): void {
  const sorteados = sortearDespojos(lootRng(game), ent.kind);
  for (let i = 0; i < sorteados.length; i++) {
    const def = ITENS[sorteados[i]];
    game.items.push(makeItem(game.proxItemId++, ent.x, ent.y, def.key));
    logMsg(game, artigoMaiusculo(ent) + ' ' + nomeDe(ent) + ' larga ' +
      artigoItem(def) + ' ' + def.nome + '.', 'bom');
  }
}

function atacarInimigo(game: Game, ent: Enemy): void {
  const dmg = rollDamage(game.rngCombat, game.player.atk);
  ent.hp -= dmg;
  ent.lastDmg = dmg;
  ent.bump = 1;
  game.stats.dmgDealt += dmg;
  const nome = nomeDe(ent);
  if (ent.hp <= 0) {
    ent.hp = 0;
    removerInimigo(game, ent);
    game.stats.kills += 1;
    // §15 — o XP do abate vai no registro: é o único feedback visível da
    // escala enquanto a UI não mostra XP (a barra de XP é fase futura).
    const xp = xpPorAbate(game.player, ent);
    // §16 — e vai para a fila visual: o renderer faz o texto de XP flutuar do
    // tile do abate. O valor daqui é o CERTO — lido antes de `ganharXp` poder
    // subir o nível do herói neste mesmo golpe. Teto de segurança para o jogo
    // headless (oracle, testes), onde ninguém drena a fila.
    game.abatesRecentes.push({ x: ent.x, y: ent.y, kind: ent.kind, xp: xp });
    if (game.abatesRecentes.length > 32) game.abatesRecentes.shift();
    logMsg(game, 'Você abate ' + artigo(ent) + ' ' + nome + ' com ' + dmg + ' de dano' +
      (xp > 0 ? ' (+' + xp + ' xp).' : ' (sem xp — monstro muito abaixo do seu nível).'), 'bom');
    // Despojo ANTES do XP: o abate e o que caiu no chão são a mesma cena, e a
    // subida de nível (que pode render várias linhas) fecha o bloco.
    largarDespojos(game, ent);
    ganharXp(game, xp);
  } else {
    logMsg(game, 'Você atinge ' + artigo(ent) + ' ' + nome + ' por ' + dmg +
      ' de dano (' + ent.hp + '/' + ent.maxHp + ').', 'info');
  }
}

/**
 * Recolhe TUDO que estiver no tile do jogador, numa única ação.
 *
 * Destino por tipo: `'potion'` continua indo para o contador `player.potions`
 * (contrato antigo, R7) e material vai para `player.bag`. Uma linha de registro
 * por TIPO recolhido — não por item —, na ordem fixa de `ITEM_KINDS`, para que
 * pisar numa pilha de cinco coisas não vire cinco linhas iguais no registro.
 *
 * `explicito` é o comando manual de recolher: só ele avisa quando não há nada
 * ali (andar sobre tile vazio tem de ser silencioso).
 */
function pegarItem(game: Game, explicito: boolean): boolean {
  const p = game.player;
  const restantes: Item[] = [];
  /* Contagem por tipo. Aberto (não por `ITEM_KINDS`) porque só as chaves que
   * apareceram interessam; a ORDEM de leitura é que vem da tabela, adiante. */
  const contagem: Partial<Record<ItemKind, number>> = {};
  let total = 0;

  for (let i = 0; i < game.items.length; i++) {
    const it = game.items[i];
    if (!it) continue;
    if (it.x !== p.x || it.y !== p.y) {
      restantes.push(it);
      continue;
    }
    const kind = normalizeItemKind(it.kind);
    contagem[kind] = (contagem[kind] || 0) + 1;
    total++;
  }

  if (total === 0) {
    if (explicito) logMsg(game, 'Não há nada para recolher aqui.', 'aviso');
    return false;
  }
  game.items = restantes;

  for (let k = 0; k < ITEM_KINDS.length; k++) {
    const kind = ITEM_KINDS[k];
    const n = contagem[kind] || 0;
    if (n <= 0) continue;
    const def = ITENS[kind];
    let acumulado: number;
    if (ehMaterial(kind)) {
      acumulado = (p.bag[kind] || 0) + n;
      p.bag[kind] = acumulado;
    } else {
      /* Hoje o único não-material é a poção; se outro consumível surgir, ele
       * ganha o seu ramo aqui em vez de cair no contador errado em silêncio. */
      p.potions += n;
      acumulado = p.potions;
    }
    logMsg(game, 'Você recolhe ' + quantiaDeItem(def, n) +
      ' (' + acumulado + ' no total).', 'bom');
  }
  return true;
}

/**
 * O jogador está EXATAMENTE sobre o ponto? `null` (andar sem aquele ponto)
 * responde `false` — não existe negociar com um mercador que não veio.
 */
function sobreOPonto(game: Game, ponto: Point | null): boolean {
  if (!ponto) return false;
  return game.player.x === ponto.x && game.player.y === ponto.y;
}

/**
 * O jogador está AO LADO (Chebyshev ≤ 1) do ponto? É o que habilita a
 * negociação: móvel e NPC são sólidos desde a fase 2.2, então ninguém mais
 * fica EM CIMA — interagir é encostar.
 */
function aoLadoDa(game: Game, ponto: Point | null): boolean {
  if (!ponto) return false;
  return cheb(game.player.x, game.player.y, ponto.x, ponto.y) <= 1;
}

/**
 * Esbarrar numa parada: narra UMA vez por encontro e devolve `true` (o passo
 * é recusado, como numa parede). A trava anti-repetição mora num campo
 * transitório (`game.ultimoEsbarrao`, não serializado): sem ela, martelar a
 * direção do mercador encheria o registro de "O mercador ergue os olhos" — e
 * o registro é o lugar que o jogador lê o combate, não o vendedor.
 */
function esbarrar(game: Game, x: number, y: number): boolean {
  let qual: 'mercador' | 'alquimia' | null = null;
  let texto: string | null = null;
  if (game.mercador && x === game.mercador.x && y === game.mercador.y) {
    qual = 'mercador';
    texto = 'O mercador ergue os olhos: há o que negociar.';
  } else if (game.bancada && x === game.bancada.x && y === game.bancada.y) {
    qual = 'alquimia';
    texto = 'O caldeirão borbulha. A estação pede gosma e ferro.';
  } else if (game.alquimiaExtras) {
    for (let i = 0; i < game.alquimiaExtras.length; i++) {
      const e = game.alquimiaExtras[i];
      if (e.x === x && e.y === y) {
        qual = 'alquimia';
        texto = 'A estação de alquimia. O caldeirão fica ao lado.';
        break;
      }
    }
  }
  if (!qual) return false;
  if (game.ultimoEsbarrao !== qual) {
    game.ultimoEsbarrao = qual;
    logMsg(game, texto as string, 'info');
  }
  return true;
}

/**
 * Narra a chegada a um ponto de parada. Vale a cada passo que TERMINA no tile,
 * inclusive voltando ao mesmo ponto: pisar de novo é chegar de novo, e o
 * jogador precisa da lembrança de que ali se negocia.
 *
 * Nada é anunciado na geração do andar de propósito — descobrir o mercador é
 * parte da exploração, e uma linha de sistema por nível entregaria o mapa.
 */
function narrarParada(game: Game): void {
  if (sobreOPonto(game, game.mercador)) {
    logMsg(game, 'Você chega ao mercador. Ele avalia sua bolsa.', 'info');
  }
  if (sobreOPonto(game, game.bancada)) {
    logMsg(game, 'Uma bancada de alquimia. Há um caldeirão e uma bigorna.', 'info');
  }
}

// R49 (movimentação): um registro por passo viraria ruído em 400 linhas, então
// narramos só a troca de sala. Corredores ficam silenciosos de propósito.
function narrarSala(game: Game): void {
  const sala = salaEm(game.map, game.player.x, game.player.y);
  const id = sala ? sala.id : null;
  if (id === game.lastRoomId) return;
  game.lastRoomId = id;
  if (!sala) return;
  logMsg(game, 'Você entra na sala ' + sala.id + ' (' +
    formatoDaSala(sala.shape) + ').', 'info');
}

function mover(game: Game, dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return false;
  const p = game.player;
  const map = game.map;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (!inBounds(map, nx, ny)) return false;
  // Atacar vem ANTES do corte de canto: o alcance corpo a corpo do jogador é
  // Chebyshev 1, o mesmo que os arquétipos usam contra ele (§6). Se o teste de
  // canto viesse antes, numa quina de corredor o inimigo golpearia e o jogador
  // levaria um no-op mudo (§7: "mover para tile com inimigo = atacar").
  const alvo = enemyAt(game, nx, ny);
  if (alvo) {
    atacarInimigo(game, alvo);
    return true;
  }
  // Sem corte de canto na diagonal para o DESLOCAMENTO (mesma regra do
  // Dijkstra, §5).
  if (dx !== 0 && dy !== 0) {
    if (!isWalkable(map, p.x + dx, p.y)) return false;
    if (!isWalkable(map, p.x, p.y + dy)) return false;
  }
  // As paradas são SÓLIDAS: móvel e NPC não se atravessa. O passo é recusado
  // como numa parede (sem consumir turno), e o esbarrão narra uma vez — é o
  // convite para quem ainda não notou que ali se negocia.
  if (esbarrar(game, nx, ny)) return false;
  if (!isWalkable(map, nx, ny)) return false;
  p.x = nx;
  p.y = ny;
  narrarSala(game);
  pegarItem(game, false);
  narrarParada(game);
  if (tileEm(map, nx, ny) === Tile.Stairs) {
    logMsg(game, 'Você pisa na escada. Use ">" ou Enter para descer ao nível ' +
      (game.depth + 1) + '.', 'aviso');
  }
  return true;
}

function esperar(game: Game): boolean {
  logMsg(game, 'Você aguarda, atento aos ruídos.', 'info');
  return true;
}

function usarPocao(game: Game): boolean {
  const p = game.player;
  if (p.potions <= 0) {
    logMsg(game, 'Você não tem poções.', 'aviso');
    return false;
  }
  if (p.hp >= p.maxHp) {
    logMsg(game, 'Sua vida já está completa.', 'aviso');
    return false;
  }
  p.potions -= 1;
  const cura = Math.min(POTION_HEAL, p.maxHp - p.hp);
  p.hp += cura;
  game.stats.itemsUsed += 1;
  logMsg(game, 'Você bebe uma poção e recupera ' + cura + ' de vida (' +
    p.hp + '/' + p.maxHp + ').', 'bom');
  return true;
}

function tentarDescer(game: Game): boolean {
  if (tileEm(game.map, game.player.x, game.player.y) !== Tile.Stairs) {
    logMsg(game, 'Não há escada aqui.', 'aviso');
    return false;
  }
  descend(game);
  return true;
}

// --------------------------------------------------------------------------
// Economia e oficina (fase 2)
//
// As três ações abaixo — vender, comprar, criar — dividem a mesma anatomia:
//
//   1. RECUSA (devolve `false`): lugar errado, quantidade impossível, material
//      que falta, moeda que falta, teto atingido. Toda recusa escreve UMA linha
//      de registro em 'aviso' e não toca no estado. Não consumir turno numa
//      recusa é regra dura: um clique errado no balcão não pode custar um turno
//      de vida com um Ogro na sala.
//   2. EFEITO (devolve `true`): a troca acontece e o turno é CONSUMIDO.
//      Negociar em masmorra custa tempo — é decisão de design, não descuido: o
//      mercador não é um menu de pausa, e os monstros continuam andando
//      enquanto o jogador conta moedas. É isso que torna "vendo agora ou levo
//      até a escada?" uma decisão de verdade.
//
// E o que NÃO existe aqui: sorteio. Preço, receita e resultado são tabela.
// Nenhuma destas funções encosta em `rngCombat` ou `rngLoot` — se um dia
// encostarem, o determinismo do combate passa a depender de quanta gosma o
// jogador vendeu, que é exatamente o acoplamento que a fase 1 desfez ao
// separar os dois streams.
// --------------------------------------------------------------------------

/** Quantidade aceitável de negociação (1..99), ou `null` se não for. */
function quantidadeValida(game: Game, quantidade: unknown): number | null {
  const n = intOr(quantidade, NaN);
  if (!isNum(n) || n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) {
    logMsg(game, 'Quantidade inválida: negocie de ' + QUANTIDADE_MIN + ' a ' +
      QUANTIDADE_MAX + ' por vez.', 'aviso');
    return null;
  }
  return n;
}

/** Tira `n` unidades da bolsa. A chave some quando zera — ausência é zero. */
function tirarDaBolsa(p: Player, kind: MaterialKind, n: number): void {
  const resto = (p.bag[kind] || 0) - n;
  if (resto > 0) p.bag[kind] = resto;
  else delete p.bag[kind];
}

/**
 * Vende material ao mercador. `moedas += ITENS[kind].valor * quantidade`.
 *
 * A poção não chega aqui: `MaterialKind` a exclui no compilador e
 * `normalizeMaterialKind` a recusa no parse do comando textual.
 */
function vender(game: Game, item: MaterialKind, quantidade: number): boolean {
  const p = game.player;
  if (!aoLadoDa(game, game.mercador)) {
    logMsg(game, 'Você precisa estar ao lado do mercador.', 'aviso');
    return false;
  }
  if (!ehMaterial(item)) {
    /* Rede para chamador não tipado (JSON, console, ferramenta). */
    logMsg(game, 'O mercador não compra isso.', 'aviso');
    return false;
  }
  const n = quantidadeValida(game, quantidade);
  if (n === null) return false;

  const def = ITENS[item];
  const tem = p.bag[item] || 0;
  if (tem < n) {
    logMsg(game, 'Você não tem ' + n + ' ' + (n === 1 ? def.nome : def.plural) +
      ' para vender (bolsa: ' + tem + ').', 'aviso');
    return false;
  }

  const ganho = def.valor * n;
  tirarDaBolsa(p, item, n);
  p.moedas += ganho;
  logMsg(game, 'Você vende ' + quantiaDeItem(def, n) + ' por ' +
    moedasEmTexto(ganho) + '. Total: ' + moedasEmTexto(p.moedas) + '.', 'bom');
  return true;
}

/**
 * Compra poção do mercador, a `PRECO_POCAO` a unidade.
 *
 * O item é `'potion'` por assinatura: hoje o mercador só vende isso, e o dia em
 * que vender outra coisa a união de `Command` tem de mudar junto — o que é o
 * ponto de usar um literal em vez de `ItemKind`.
 */
function comprar(game: Game, item: 'potion', quantidade: number): boolean {
  const p = game.player;
  if (!aoLadoDa(game, game.mercador)) {
    logMsg(game, 'Você precisa estar ao lado do mercador.', 'aviso');
    return false;
  }
  if (item !== 'potion') {
    logMsg(game, 'O mercador não vende isso.', 'aviso');
    return false;
  }
  const n = quantidadeValida(game, quantidade);
  if (n === null) return false;

  const def = ITENS.potion;
  const custo = PRECO_POCAO * n;
  if (p.moedas < custo) {
    logMsg(game, 'Moedas insuficientes: ' + quantiaDeItem(def, n) + ' custa' +
      (n === 1 ? '' : 'm') + ' ' + moedasEmTexto(custo) + ' e você tem ' +
      moedasEmTexto(p.moedas) + '.', 'aviso');
    return false;
  }

  p.moedas -= custo;
  p.potions += n;
  logMsg(game, 'Você compra ' + quantiaDeItem(def, n) + ' por ' +
    moedasEmTexto(custo) + '. Restam ' + moedasEmTexto(p.moedas) +
    ' e você carrega ' + p.potions + '.', 'bom');
  return true;
}

/**
 * Aplica o EFEITO de uma receita já validada (lugar certo, material em mãos,
 * teto respeitado) e narra o resultado.
 *
 * O efeito mora aqui, e não em `RECEITAS`, porque é a única parte da receita
 * que é REGRA e não dado: mexe no jogador, e o jogador é deste módulo. A tabela
 * continua sendo fonte única do que a receita CUSTA e do que ela PRODUZ em
 * texto — nenhuma quantidade de material aparece nesta função.
 *
 * O `never` do `default` não é decoração: quando `RECEITAS` ganhar a terceira
 * receita, o compilador PARA aqui. Sem ele, a receita nova consumiria material
 * e não faria nada — bug silencioso que custa a bolsa do jogador.
 */
function aplicarReceita(game: Game, receita: ReceitaDef): void {
  const p = game.player;
  switch (receita.key) {
    case 'pocao':
      p.potions += 1;
      logMsg(game, 'Você ferve ' + custoEmTexto(receita.custo) +
        ' no caldeirão e engarrafa uma poção (' + p.potions + ' no total).', 'bom');
      return;
    case 'refino':
      p.armaNivel += 1;
      p.atk += ATK_POR_REFINO;
      logMsg(game, 'Você bate ' + custoEmTexto(receita.custo) +
        ' na bigorna e afia a arma: refino ' + p.armaNivel + ' de ' +
        ARMA_NIVEL_MAX + ', ataque ' + p.atk + '.', 'bom');
      return;
    default: {
      const semEfeito: never = receita.key;
      logMsg(game, 'A bancada não sabe o que fazer com "' + String(semEfeito) + '".', 'aviso');
      return;
    }
  }
}

/**
 * A estação é UMA coisa de três tiles: criar funciona a partir de qualquer
 * uma das peças (caldeirão, estante ou mesa). Exigir o caldeirão exato seria
 * pedir que o jogador adivinhasse qual tile é o certo.
 */
function aoLadoDaEstacao(game: Game): boolean {
  if (aoLadoDa(game, game.bancada)) return true;
  const extras = game.alquimiaExtras;
  if (extras) {
    for (let i = 0; i < extras.length; i++) {
      if (aoLadoDa(game, extras[i])) return true;
    }
  }
  return false;
}

/** Usa a bancada: alquimia (`'pocao'`) ou refino (`'refino'`). */
function criar(game: Game, receitaBruta: ReceitaKind): boolean {
  const p = game.player;
  if (!aoLadoDaEstacao(game)) {
    logMsg(game, 'Você precisa estar ao lado da estação de alquimia.', 'aviso');
    return false;
  }
  /* Normaliza mesmo já vindo tipado, pela mesma razão de `ehMaterial` em
   * `vender`: rede para chamador não tipado (JSON de save, console, ferramenta
   * headless). Receita desconhecida NÃO degrada para nenhuma outra — chutar
   * gastaria material do jogador por causa de um nome errado. */
  const key = normalizeReceita(receitaBruta);
  const receita = key ? RECEITAS[key] : null;
  if (!receita) {
    logMsg(game, 'A bancada não conhece essa receita.', 'aviso');
    return false;
  }

  /* O teto vem ANTES do material: recusar por limite depois de o jogador ler
   * "faltam cimitarras" mandaria a mensagem errada — e o material continuaria
   * na bolsa de qualquer jeito, já que recusa não consome nada. */
  if (receita.key === 'refino' && p.armaNivel >= ARMA_NIVEL_MAX) {
    logMsg(game, 'Sua arma já está no refino máximo (' + ARMA_NIVEL_MAX + ').', 'aviso');
    return false;
  }

  const faltas = faltasDaReceita(p.bag, receita.custo);
  if (faltas.length > 0) {
    const texto: string[] = [];
    for (let i = 0; i < faltas.length; i++) {
      texto.push(quantiaDeItem(ITENS[faltas[i].item], faltas[i].falta));
    }
    /* Concordância: o verbo acompanha o SUJEITO, que é a quantia que falta —
     * 'Falta uma cimitarra' × 'Faltam 2 cimitarras'. Contar as linhas da falta
     * (e não as unidades) daria 'Falta 2 cimitarras', que é erro de português
     * em texto que o jogador lê toda hora. */
    const plural = faltas.length > 1 || faltas[0].falta > 1;
    logMsg(game, receita.nome + ' pede ' + custoEmTexto(receita.custo) +
      '. Falta' + (plural ? 'm' : '') + ' ' + listaEmTexto(texto) + '.', 'aviso');
    return false;
  }

  /* Consumo na ordem de `ITEM_KINDS`, a mesma de todo o resto. */
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = receita.custo[kind] || 0;
    if (n > 0) tirarDaBolsa(p, kind, n);
  }
  aplicarReceita(game, receita);
  return true;
}

// --------------------------------------------------------------------------
// Porta única de comandos
// --------------------------------------------------------------------------

/**
 * Aplica um comando do jogador. Devolve `true` se ele consumiu o turno — e, nesse
 * caso, já resolveu o fim de turno (Dijkstra -> inimigos -> FOV -> stats -> autosave).
 *
 * Única diferença de forma em relação ao vanilla: `cmd` é a união discriminada
 * `Command` no lugar da string `'move:1,-1'`. A semântica é idêntica — mover para
 * cima de um inimigo ataca, pisar em item recolhe, escada exige `descend` e nada
 * é aceito depois de `over`.
 */
export function applyCommand(g: Game, cmd: Command): boolean {
  if (!g || g.over) return false;
  if (!cmd) return false;
  let consumiu = false;

  switch (cmd.kind) {
    case 'move': {
      const dx = intOr(cmd.dx, NaN);
      const dy = intOr(cmd.dy, NaN);
      if (!isNum(dx) || !isNum(dy)) return false;
      if (dx < -1 || dx > 1 || dy < -1 || dy > 1) return false;
      // §5.1 do docs/PERSONAGEM.md: o olhar acompanha a INTENÇÃO, não o
      // resultado. Vale nas três situações do contrato — passo aceito, passo que
      // virou ataque e passo barrado por parede (ele se vira mesmo assim). O
      // delta (0,0) não é direção nenhuma e por isso não mexe em nada.
      // `wait`, `use` e `descend` nunca chegam aqui: o olhar deles é inalterado.
      // Escrita puramente cosmética — não consome turno e não vaza para o oracle.
      const dir = dirIndex(dx, dy);
      if (dir >= 0) g.player.facing = dir;
      consumiu = mover(g, dx, dy);
      break;
    }
    case 'wait':
      consumiu = esperar(g);
      break;
    case 'use':
      consumiu = usarPocao(g);
      break;
    case 'descend':
      consumiu = tentarDescer(g);
      break;
    /* Fase 2 — economia. Cada uma valida sozinha e só devolve `true` quando a
     * troca aconteceu; a recusa já escreveu a linha de registro e não custa
     * turno (ver o bloco "Economia e oficina"). */
    case 'vender':
      consumiu = vender(g, cmd.item, cmd.quantidade);
      break;
    case 'comprar':
      consumiu = comprar(g, cmd.item, cmd.quantidade);
      break;
    case 'criar':
      consumiu = criar(g, cmd.receita);
      break;
    default:
      return false;
  }

  if (consumiu) {
    // Trava de REENTRÂNCIA (não de chamador): impede que um endTurn disparado
    // de dentro do próprio turno resolva o turno duas vezes. Chamado de fora,
    // endTurn segue fazendo a fase completa que o §7 promete.
    if (g.emTurno) return consumiu;
    g.emTurno = true;
    try {
      endTurn(g);
    } finally {
      g.emTurno = false;
    }
  }
  return consumiu;
}

// --------------------------------------------------------------------------
// Fim de turno
// --------------------------------------------------------------------------

function narrarInimigos(
  game: Game,
  estadosAnteriores: Record<number, EnemyState>,
  danoSofrido: number
): void {
  for (let i = 0; i < game.enemies.length; i++) {
    const e = game.enemies[i];
    if (estadosAnteriores[e.id] !== 'flee' && e.state === 'flee') {
      logMsg(game, artigoMaiusculo(e) + ' ' + nomeDe(e) + ' recua ferid' +
        (feminino(e) ? 'a' : 'o') + '.', 'aviso');
    }
  }
  if (danoSofrido > 0) {
    logMsg(game, 'Você sofre ' + danoSofrido + ' de dano (' +
      Math.max(0, game.player.hp) + '/' + game.player.maxHp + ').', 'ruim');
  }
}

function acharAlgoz(game: Game): Enemy | null {
  const lista = game.enemies;
  let melhor: Enemy | null = null;
  let i: number;
  let e: Enemy;
  for (i = 0; i < lista.length; i++) {
    e = lista[i];
    if (e.hp > 0 && e.state === 'attack') {
      if (!melhor || e.id < melhor.id) melhor = e;
    }
  }
  if (melhor) return melhor;
  let melhorDist = Infinity;
  for (i = 0; i < lista.length; i++) {
    e = lista[i];
    if (e.hp <= 0) continue;
    const d = cheb(game.player.x, game.player.y, e.x, e.y);
    if (d < melhorDist || (d === melhorDist && melhor && e.id < melhor.id)) {
      melhorDist = d;
      melhor = e;
    }
  }
  return melhor;
}

function matarJogador(game: Game): void {
  const p = game.player;
  p.hp = 0;
  game.over = true;
  // Autoria: quem desferiu o golpe fatal é registrado por entities (attackPlayer)
  // em `game.causeKind` (só as entidades sabem disso no instante do golpe).
  // `acharAlgoz` é só o palpite de reserva — ele devolve o inimigo de menor id
  // em estado de ataque, que num turno com vários atacantes pode não ser o
  // autor. A tabela de gênero (FEMININO) mora aqui, então a frase é montada
  // aqui em ambos os casos.
  let algoz: { kind: string } | null = null;
  if (game.causeKind && NOMES[game.causeKind]) algoz = { kind: game.causeKind };
  if (!algoz) algoz = acharAlgoz(game);
  game.cause = algoz
    ? ('Morto pel' + artigo(algoz) + ' ' + nomeDe(algoz) + ' no nível ' + game.depth)
    : ('Morto nas profundezas do nível ' + game.depth);
  logMsg(game, game.cause + '.', 'ruim');
  logMsg(game, 'Expedição encerrada no turno ' + game.turn + ' — ' + game.stats.kills +
    ' inimigos derrotados, ' + game.stats.explorePct + '% do nível explorado.', 'sistema');
  gravarHistorico(game);
  apagarSave();
}

/**
 * Fase pós-ação do turno (§7): dmap -> inimigos -> FOV -> stats -> autosave.
 * Vale tanto para `applyCommand` quanto para um chamador externo do contrato.
 */
export function endTurn(g: Game): void {
  if (!g || !g.map) return;
  // Run encerrada não avança mais nada; só revalida os derivados para a UI.
  if (g.over) {
    refreshDerived(g);
    return;
  }

  g.turn += 1;

  // 1) mapa de Dijkstra único, recalculado a partir do jogador
  computeDmap(g);

  // 2) turno de todos os inimigos
  const hpAntes = g.player.hp;
  const danoAntes = g.stats.dmgTaken;
  const logAntes = g.log.length;
  const estadosAnteriores: Record<number, EnemyState> = {};
  for (let i = 0; i < g.enemies.length; i++) {
    estadosAnteriores[g.enemies[i].id] = g.enemies[i].state;
  }
  processEnemies(g);

  const sofrido = hpAntes - g.player.hp;
  if (sofrido > 0 && g.stats.dmgTaken === danoAntes) {
    // O módulo de entidades não contabilizou: contabiliza aqui.
    g.stats.dmgTaken += sofrido;
  }
  if (g.log.length === logAntes) {
    // O módulo de entidades não narrou nada: narra aqui.
    narrarInimigos(g, estadosAnteriores, sofrido);
  }

  // 3) campo de visão + 4) exploração
  atualizarFov(g);

  // 5) estatísticas
  updateStats(g);

  // 6) morte permanente / autosave
  if (g.player.hp <= 0) {
    matarJogador(g);
  } else {
    // Sobreviveu ao turno: a autoria de um golpe quase fatal não pode
    // sobrar para a morte seguinte.
    g.causeKind = '';
    autosave(g);
  }
}

// --------------------------------------------------------------------------
// Progressão de nível
// --------------------------------------------------------------------------

/** Desce um nível: mapa novo pela mesma seed, população mais dura, maxHp += 2. */
export function descend(g: Game): void {
  if (!g || g.over) return;
  const depth = g.depth + 1;
  const map = generate(g.seedStr, depth);
  // §15 — a mistura de monstros do andar novo sai do nível ATUAL do herói.
  const pop = populate(map, depth, g.player.level);
  const p = g.player;

  g.depth = depth;
  g.map = map;
  g.enemies = pop.enemies;
  g.items = pop.items;
  // Andar novo, paradas novas: o mercador e a bancada são do ANDAR. A BOLSA, as
  // MOEDAS e o REFINO da arma não — são do jogador e descem com ele (nada aqui
  // toca em `p.bag`, `p.moedas` ou `p.armaNivel`).
  g.mercador = pop.mercador;
  g.bancada = pop.bancada;
  g.alquimiaExtras = pop.alquimiaExtras;
  // Andar novo, numeração de item nova: `populate` voltou a contar do 1.
  g.proxItemId = proximoIdDeItem(pop.items);
  g.rngCombat = makeRng(hash32(g.seedStr + '#combat' + depth));
  // Sorte de despojo é por ANDAR, no mesmo padrão do combate.
  g.rngLoot = makeRng(hash32(g.seedStr + '#loot' + depth));
  g.explored = new Uint8Array(map.w * map.h);
  g.visible = new Set<number>();
  g.dmap = new Int32Array(0);
  g.fleeMap = null;
  g.causeKind = '';   // nível novo, autoria do golpe fatal zerada

  p.x = map.start.x;
  p.y = map.start.y;
  g.lastRoomId = idDaSala(map, p.x, p.y);
  p.maxHp += HP_POR_DESCIDA;
  p.hp = Math.min(p.maxHp, p.hp + HP_POR_DESCIDA);

  if (depth > g.stats.deepest) g.stats.deepest = depth;

  logMsg(g, 'Você desce a escada e chega ao nível ' + depth + '.', 'sistema');
  logNotasDoMapa(g, map);
  logMsg(g, 'Inimigos: ' + g.enemies.length + ' — poções no chão: ' +
    g.items.length + '. Vida máxima agora ' + p.maxHp + '.', 'sistema');

  refreshDerived(g);
  autosave(g);
}

// --------------------------------------------------------------------------
// Snapshot determinístico
// --------------------------------------------------------------------------

function checksumTiles(tiles: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < tiles.length; i++) {
    h ^= tiles[i];
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0)).toString(16);
}

/**
 * Um ponto de parada no snapshot: `'x,y'`, ou `'-'` quando o andar não tem.
 * O traço é um símbolo, não um número: `'0,0'` seria uma coordenada legítima
 * (canto do mapa) e confundiria "não existe" com "existe na origem".
 */
function pontoEmTexto(p: Point | null): string {
  return p ? p.x + ',' + p.y : '-';
}

/**
 * A lista de pontos da decoração da estação: `'x,y;x,y'`, ou `'-'` quando não
 * há nenhum. Mesmo traço, mesma razão — e o separador interno é `;` para não
 * disputar com o `|` que separa os campos do snapshot.
 *
 * A ordem sai ESTÁVEL do próprio dado: `populate` guarda os extras em ordem de
 * índice linear crescente, e `restore` preserva a ordem gravada. Ordenar de
 * novo aqui só esconderia o dia em que alguém guardasse a lista embaralhada.
 */
function extrasEmTexto(lista: Point[] | null | undefined): string {
  if (!lista || lista.length === 0) return '-';
  const buf: string[] = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    if (p) buf.push(p.x + ',' + p.y);
  }
  return buf.length ? buf.join(';') : '-';
}

/**
 * Resumo textual determinístico do estado. O golden test compara string com
 * string: o formato tem de sair estável byte a byte.
 *
 * FORMATO v4 (a fase 2.1 — a estação de alquimia com três tiles):
 *
 *   v4|seed=K7QX-3M9P|d=1|t=12|over=0|p=22,7,38/42,atk7,poc3,lv1:50,mo24,arm1
 *     |E[1:linker:9:14:20|2:chaser:12:18:9]
 *     |I[3:potion:11:7|7:orelhaGoblin:18:9|8:espadaGoblin:18:9]
 *     |B[gosma2|orelhaGoblin1]
 *     |S=12,3,41,18,1,1,23.4|rng=2748472837|rngL=91827364
 *     |merc=24,9|banc=8,31|alq=8,30;9,31|map=1f3ac2b9
 *
 * O que mudou do v3, e por quê:
 *  · nasceu `alq=`, a lista dos tiles de DECORAÇÃO da estação de alquimia
 *    (estante e mesa), no formato `x,y;x,y` e com `-` para lista vazia. Ela
 *    entra pelo mesmo motivo que `merc=` e `banc=` entraram: é estado de jogo
 *    que o mapa não carrega — o checksum de `map=` é cego a ela —, e é
 *    território RESERVADO, então duas partidas com a estação montada de lados
 *    diferentes precisam sair diferentes para o oracle;
 *  · o lugar é logo depois de `banc=`, porque o caldeirão e os extras são a
 *    mesma instalação e se leem juntos;
 *  · a etiqueta subiu de `v3` para `v4`: o golden gravado com o formato antigo
 *    DEVE reprovar, e reprovar dizendo qual é o problema (formato novo) em vez
 *    de fingir divergência de simulação.
 *
 * O que veio do v3 e continua valendo: `,mo<moedas>` e `,arm<armaNivel>` no FIM
 * do bloco do jogador, para que a leitura da esquerda continue idêntica à do
 * v2; e `merc=`/`banc=`, os dois pontos de parada, no formato `x,y` ou `-`.
 *
 * O que veio do v2 (herança dos despojos): `I[...]` traz `id:kind:x:y` — sem o
 * `kind` o oracle não distingue uma orelha de uma clava caídas no mesmo tile;
 * `B[...]` é a bolsa na ordem fixa de `ITEM_KINDS`, só com contagem positiva
 * (bolsa vazia sai `B[]`); e `rngL=` é o estado do stream de despojos, que é
 * divergência de estado como qualquer outra.
 */
export function snapshot(game: Game): string {
  if (!game) return '';
  const p = game.player;
  const partes: string[] = [];
  partes.push('v4');
  partes.push('seed=' + game.seedStr);
  partes.push('d=' + game.depth);
  partes.push('t=' + game.turn);
  partes.push('over=' + (game.over ? 1 : 0));
  partes.push('p=' + p.x + ',' + p.y + ',' + p.hp + '/' + p.maxHp +
    ',atk' + p.atk + ',poc' + p.potions + ',lv' + p.level + ':' + p.xp +
    ',mo' + (isNum(p.moedas) ? p.moedas : 0) +
    ',arm' + (isNum(p.armaNivel) ? p.armaNivel : 0));

  const inimigos = game.enemies.slice().sort((a, b) => a.id - b.id);
  let buf: string[] = [];
  let i: number;
  for (i = 0; i < inimigos.length; i++) {
    const e = inimigos[i];
    buf.push(e.id + ':' + e.kind + ':' + e.hp + ':' + e.x + ':' + e.y);
  }
  partes.push('E[' + buf.join('|') + ']');

  /* Itens ordenados por id — que é único e monotônico, então a pilha de um
   * mesmo tile sai sempre na ordem em que foi criada. */
  const itens = game.items.slice().sort((a, b) => a.id - b.id);
  buf = [];
  for (i = 0; i < itens.length; i++) {
    const it = itens[i];
    buf.push(it.id + ':' + it.kind + ':' + it.x + ':' + it.y);
  }
  partes.push('I[' + buf.join('|') + ']');

  /* Bolsa na ordem da TABELA, jamais na ordem de inserção do objeto. */
  buf = [];
  for (i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = p.bag[kind] || 0;
    if (n > 0) buf.push(kind + n);
  }
  partes.push('B[' + buf.join('|') + ']');

  const s = game.stats;
  partes.push('S=' + s.turns + ',' + s.kills + ',' + s.dmgDealt + ',' + s.dmgTaken +
    ',' + s.itemsUsed + ',' + s.deepest + ',' + s.explorePct);
  partes.push('rng=' + (isNum(game.rngCombat.s) ? (game.rngCombat.s >>> 0) : 0));
  partes.push('rngL=' + (game.rngLoot && isNum(game.rngLoot.s) ? (game.rngLoot.s >>> 0) : 0));
  partes.push('merc=' + pontoEmTexto(game.mercador));
  partes.push('banc=' + pontoEmTexto(game.bancada));
  partes.push('alq=' + extrasEmTexto(game.alquimiaExtras));
  partes.push('map=' + checksumTiles(game.map.tiles));
  return partes.join('|');
}

// --------------------------------------------------------------------------
// Restauração de save (o mapa é REGERADO pela seed+depth, nunca serializado)
// --------------------------------------------------------------------------

function decodificarExplored(destino: Uint8Array, bruto: unknown): void {
  const n = destino.length;
  let i: number;
  let b: number;
  if (!bruto) return;

  if (typeof bruto === 'string') {
    const s = bruto;
    // Formato "0101..." com um caractere por tile.
    if (s.length === n && /^[01]+$/.test(s)) {
      for (i = 0; i < n; i++) destino[i] = s.charCodeAt(i) === 49 ? 1 : 0;
      return;
    }
    // Base64: um byte por tile, ou bitset compactado.
    // (O vanilla usava `atob`; aqui vale o decodificador próprio do save.ts,
    //  que existe justamente porque `atob` pode faltar no sandbox headless.)
    let bin: Uint8Array | null = null;
    try {
      bin = base64ToBytes(s);
    } catch (e) {
      bin = null;
    }
    if (!bin) return;
    if (bin.length >= n) {
      for (i = 0; i < n; i++) destino[i] = bin[i] ? 1 : 0;
    } else if (bin.length >= Math.ceil(n / 8)) {
      for (i = 0; i < n; i++) {
        b = bin[i >> 3];
        destino[i] = (b >> (i & 7)) & 1;
      }
    }
    return;
  }

  if (typeof bruto === 'object') {
    const arr = bruto as ArrayLike<unknown>;
    const len = isNum(arr.length) ? arr.length : n;
    const lim = Math.min(n, len);
    for (i = 0; i < lim; i++) {
      destino[i] = arr[i] ? 1 : 0;
    }
  }
}

function reconstruirInimigo(bruto: unknown, depth: number, map: GameMap): Enemy | null {
  const o = objetoDe(bruto);
  if (!o) return null;
  const kind = o.kind;
  if (kind !== 'chaser' && kind !== 'sentinel' && kind !== 'linker') return null;
  const arch = ARCHETYPES[kind];
  const baseHp = arch && isNum(arch.hp) ? arch.hp : 10;
  const baseAtk = arch && isNum(arch.atk) ? arch.atk : 3;
  const baseRange = arch && isNum(arch.range) ? arch.range : 1;
  let maxHp = intOr(o.maxHp, baseHp + Math.floor(baseHp * 0.15 * (depth - 1)));
  if (maxHp < 1) maxHp = 1;
  const hp = clampInt(o.hp, 1, maxHp, maxHp);
  const x = intOr(o.x, -1);
  const y = intOr(o.y, -1);
  if (!isWalkable(map, x, y)) return null;
  const estado = o.state;
  return {
    id: intOr(o.id, 0),
    kind: kind,
    x: x,
    y: y,
    hp: hp,
    maxHp: maxHp,
    atk: intOr(o.atk, baseAtk + Math.floor((depth - 1) / 2)),
    range: intOr(o.range, baseRange),
    state: (typeof estado === 'string' && ESTADOS[estado]) ? (estado as EnemyState) : 'idle',
    plan: typeof o.plan === 'string' ? o.plan : 'aguarda',
    lastDmg: 0,
    bump: 0
  };
}

/**
 * Reconstrói um item do save.
 *
 * `kind` desconhecido ou ausente vira `'potion'` (`normalizeItemKind`): antes
 * dos despojos todo item era poção, então é assim que um save legado tem de ser
 * lido — e é assim que um save corrompido degrada em vez de derrubar a run.
 * `heal` só é respeitado para a poção; material nasce com 0, dê no que der o
 * que estiver escrito no arquivo.
 */
function reconstruirItem(bruto: unknown, map: GameMap): Item | null {
  const o = objetoDe(bruto);
  if (!o) return null;
  const x = intOr(o.x, -1);
  const y = intOr(o.y, -1);
  if (!isWalkable(map, x, y)) return null;
  const kind = normalizeItemKind(o.kind);
  return {
    id: intOr(o.id, 0),
    kind: kind,
    x: x,
    y: y,
    heal: kind === 'potion' ? intOr(o.heal, POTION_HEAL) : 0
  };
}

/**
 * Reconstrói a bolsa do save. Lê apenas as chaves conhecidas, na ordem da
 * tabela, e apenas contagens inteiras positivas: chave desconhecida, valor
 * negativo, `NaN` ou texto são descartados sem cerimônia. Save antigo (sem
 * `bag`) devolve bolsa vazia — degradar, nunca recusar.
 */
function reconstruirBolsa(bruto: unknown): Player['bag'] {
  const bolsa: Player['bag'] = {};
  const o = objetoDe(bruto);
  if (!o) return bolsa;
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = intOr(o[kind], 0);
    if (n > 0) bolsa[kind] = n;
  }
  return bolsa;
}

/**
 * Reconstrói um ponto de parada do save.
 *
 * Devolve `null` para qualquer coisa que não seja um par de inteiros sobre tile
 * CAMINHÁVEL do mapa recém-regerado. A validação importa porque o mapa não vem
 * do save: um save de outra versão do gerador (ou editado à mão) traria um
 * ponto dentro de uma parede, e um mercador dentro da parede é um mercador
 * inalcançável — pior do que mercador nenhum, porque some sem dizer por quê.
 *
 * Quem chama decide o que fazer com o `null` (ver `restore`).
 */
function reconstruirPonto(bruto: unknown, map: GameMap): Point | null {
  const o = objetoDe(bruto);
  if (!o) return null;
  const x = intOr(o.x, -1);
  const y = intOr(o.y, -1);
  if (!isWalkable(map, x, y)) return null;
  return { x: x, y: y };
}

/**
 * Reconstrói a decoração da estação de alquimia (`Game.alquimiaExtras`).
 *
 * Três filtros, e todos existem por um motivo concreto:
 *   1. tile CAMINHÁVEL do mapa regerado — a mesma razão de `reconstruirPonto`:
 *      cenário dentro de parede é cenário que some sem dizer por quê;
 *   2. ORTOGONALMENTE ADJACENTE ao caldeirão restaurado — os extras são a
 *      estante e a mesa DAQUELE caldeirão; sem caldeirão (ou longe dele) não há
 *      estação, e a lista volta vazia em vez de flutuar pelo cômodo;
 *   3. sem repetição e no máximo `ALQUIMIA_EXTRAS_MAX` — save adulterado não
 *      mobília o andar inteiro.
 *
 * Save antigo (sem o campo) cai no caso vazio, que é a degradação escolhida:
 * ver `SaveData.alquimiaExtras`. A ordem gravada é preservada; ela já sai
 * canônica de `populate` e é o `snapshot()` que a lê de volta.
 */
function reconstruirExtras(bruto: unknown, map: GameMap, caldeirao: Point | null): Point[] {
  const out: Point[] = [];
  if (!caldeirao) return out;
  const lista = listaDe(bruto);
  if (!lista) return out;
  const vistos = new Set<number>();
  for (let i = 0; i < lista.length && out.length < ALQUIMIA_EXTRAS_MAX; i++) {
    const p = reconstruirPonto(lista[i], map);
    if (!p) continue;
    const dx = Math.abs(p.x - caldeirao.x);
    const dy = Math.abs(p.y - caldeirao.y);
    if (dx + dy !== 1) continue; // ortogonal e colado: nada de diagonal, nada de longe
    const k = idx(map.w, p.x, p.y);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Reconstrói um estado a partir do objeto lido do armazenamento.
 * O mapa NÃO vem do save: é regerado por seed+depth (determinismo garante que é
 * o mesmo mapa). Run morta não retoma — morte é permanente.
 */
export function restore(dados: unknown): Game | null {
  const obj = objetoDe(dados);
  if (!obj) return null;
  const seedBruta = (typeof obj.seed === 'string' && obj.seed) ? obj.seed :
    ((typeof obj.seedStr === 'string' && obj.seedStr) ? obj.seedStr : null);
  if (!seedBruta) return null;
  if (obj.over) return null; // morte permanente: run encerrada não retoma
  let depth = intOr(obj.depth, 1);
  if (depth < 1) depth = 1;

  let game: Game;
  try {
    // §15 — a retomada repovoa com o nível SALVO do herói (usado só se o save
    // não trouxer a lista de inimigos, que é quem manda quando existe).
    const nivelSalvo = Math.max(1, intOr(objetoDe(obj.player)?.level, 1));
    game = createState(seedBruta, depth, nivelSalvo);
  } catch (e) {
    return null;
  }

  const map = game.map;
  let i: number;

  // Registro salvo substitui as notas recém-geradas.
  game.log.length = 0;
  const logSalvo = listaDe(obj.log);
  if (logSalvo && logSalvo.length) {
    for (i = 0; i < logSalvo.length; i++) {
      const l = objetoDe(logSalvo[i]);
      if (!l) continue;
      const cls = l.cls;
      game.log.push({
        turn: intOr(l.turn, 0),
        text: String(l.text === null || l.text === undefined ? '' : l.text),
        cls: (typeof cls === 'string' && CLASSES_LOG[cls]) ? (cls as LogClass) : 'info'
      });
    }
    const excedente = game.log.length - CONFIG.MAX_LOG;
    if (excedente > 0) game.log.splice(0, excedente);
  }

  game.turn = Math.max(0, intOr(obj.turn, 0));

  // Jogador
  const sp = objetoDe(obj.player) || {};
  const p = game.player;
  p.maxHp = Math.max(1, intOr(sp.maxHp, p.maxHp));
  p.hp = clampInt(sp.hp, 1, p.maxHp, p.maxHp);
  p.atk = Math.max(1, intOr(sp.atk, p.atk));
  p.potions = Math.max(0, intOr(sp.potions, p.potions));
  p.level = Math.max(1, intOr(sp.level, 1));
  p.xp = Math.max(0, intOr(sp.xp, 0));
  // A bolsa atravessa a retomada como atravessa a descida: é do jogador.
  p.bag = reconstruirBolsa(sp.bag);
  // Moedas e refino, idem. Save de antes da fase 2 não os tem: zero é a leitura
  // certa de um save legado (não havia mercador, logo não havia moeda) e é
  // também o piso — negativo aqui seria dívida, que o jogo não modela.
  p.moedas = Math.max(0, intOr(sp.moedas, 0));
  // O teto vale na leitura também: um save adulterado não compra refino infinito.
  p.armaNivel = clampInt(sp.armaNivel, 0, ARMA_NIVEL_MAX, 0);
  // Save gravado antes desta fase não tem `facing`: `normalizeFacing` devolve o
  // padrão (sul) em vez de recusar o save. Campo cosmético não invalida run.
  p.facing = normalizeFacing(sp.facing);
  const px = intOr(sp.x, p.x);
  const py = intOr(sp.y, p.y);
  if (isWalkable(map, px, py)) {
    p.x = px;
    p.y = py;
  }

  // Inimigos (sem duplicar tile, nunca sobre o jogador)
  const inimigosSalvos = listaDe(obj.enemies);
  if (inimigosSalvos) {
    const ocupados = new Set<number>();
    ocupados.add(idx(map.w, p.x, p.y));
    const novos: Enemy[] = [];
    for (i = 0; i < inimigosSalvos.length; i++) {
      const ent = reconstruirInimigo(inimigosSalvos[i], depth, map);
      if (!ent) continue;
      const k = idx(map.w, ent.x, ent.y);
      if (ocupados.has(k)) continue;
      ocupados.add(k);
      novos.push(ent);
    }
    novos.sort((a, b) => a.id - b.id);
    game.enemies = novos;
  }

  // Itens
  const itensSalvos = listaDe(obj.items);
  if (itensSalvos) {
    const itens: Item[] = [];
    for (i = 0; i < itensSalvos.length; i++) {
      const it = reconstruirItem(itensSalvos[i], map);
      if (it) itens.push(it);
    }
    itens.sort((a, b) => a.id - b.id);
    game.items = itens;
  }

  /* Contador de ids de item. O save é a fonte preferida; o `max(id)+1` dos
   * itens restaurados é o PISO, e vale sozinho num save antigo que não gravava
   * o campo. Tomar o máximo dos dois é o que garante que um contador mentiroso
   * (save editado, truncado, de outra versão) não produza id repetido no chão. */
  game.proxItemId = Math.max(intOr(obj.proxItemId, 0), proximoIdDeItem(game.items));

  /* Pontos de parada. O save é a fonte preferida; um save que não os traga (ou
   * que os traga inválidos) fica com os que `createState` acabou de calcular
   * para esta mesma seed+depth+nível — determinístico, portanto uma retomada
   * honesta, nunca uma recusa de run.
   *
   * Note que NÃO forçamos `null` quando o save omite: `null` significaria "este
   * andar não tem mercador", que é uma afirmação que um save antigo nunca fez. */
  const mercadorSalvo = reconstruirPonto(obj.mercador, map);
  if (mercadorSalvo) game.mercador = mercadorSalvo;
  const bancadaSalva = reconstruirPonto(obj.bancada, map);
  if (bancadaSalva) game.bancada = bancadaSalva;

  /* A decoração da estação segue o caldeirão RESTAURADO, não o recém-calculado:
   * é o único jeito de estante e mesa não amanhecerem em outro canto do cômodo
   * quando o save traz um caldeirão diferente. Sem lista salva, a estação
   * retoma sem decoração — o motivo por extenso está em `SaveData`. */
  game.alquimiaExtras = reconstruirExtras(obj.alquimiaExtras, map, game.bancada);

  // Exploração
  decodificarExplored(game.explored, obj.explored);

  // Estatísticas
  const ss = objetoDe(obj.stats) || {};
  const st = game.stats;
  st.turns = Math.max(0, intOr(ss.turns, game.turn));
  st.kills = Math.max(0, intOr(ss.kills, 0));
  st.dmgDealt = Math.max(0, intOr(ss.dmgDealt, 0));
  st.dmgTaken = Math.max(0, intOr(ss.dmgTaken, 0));
  st.itemsUsed = Math.max(0, intOr(ss.itemsUsed, 0));
  st.deepest = Math.max(depth, intOr(ss.deepest, depth));

  // Estado do RNG de combate
  let s: unknown = obj.rngCombat;
  const comoObj = objetoDe(s);
  if (comoObj && isNum(comoObj.s)) s = comoObj.s;
  if (s === null || s === undefined) s = obj.rngCombatS;
  if (s === null || s === undefined) s = obj.rng;
  const comoObj2 = objetoDe(s);
  if (comoObj2 && isNum(comoObj2.s)) s = comoObj2.s;
  if (isNum(s) && game.rngCombat) game.rngCombat.s = s >>> 0;

  // Estado do RNG de despojos. Save antigo não o tem: fica o stream que
  // `createState` acabou de semear com a seed+depth — determinístico, só não
  // é a continuação exata daquela partida. Bolsa e chão já foram restaurados,
  // então o pior caso é a próxima sorte de drop ser "de um jogo novo".
  let sl: unknown = obj.rngLoot;
  const lootObj = objetoDe(sl);
  if (lootObj && isNum(lootObj.s)) sl = lootObj.s;
  if (isNum(sl) && game.rngLoot) game.rngLoot.s = sl >>> 0;

  game.emTurno = false;
  game.causeKind = '';
  game.lastRoomId = idDaSala(map, p.x, p.y);
  refreshDerived(game);
  game.stats.turns = game.turn;
  return game;
}
