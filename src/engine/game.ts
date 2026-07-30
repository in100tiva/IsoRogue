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
  EnemyState,
  Enemy,
  Game,
  GameMap,
  Item,
  LogClass,
  LogEntry,
  Player,
  Room
} from './types';
import { Tile } from './types';
import {
  CONFIG,
  DEFAULT_FACING,
  cheb,
  dirIndex,
  hash32,
  idx,
  makeRng,
  normalizeFacing,
  normalizeSeed
} from './core';
import { generate, inBounds, isWalkable } from './mapgen';
import { computeFov } from './fov';
import { computeDijkstra } from './dijkstra';
import { ARCHETYPES, POTION_HEAL, populate, processEnemies, rollDamage } from './entities';
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

function tileEm(map: GameMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return Tile.Wall;
  return map.tiles[idx(map.w, x, y)];
}

// Sala que contém o tile (as folhas do BSP não se sobrepõem, logo a primeira
// que casar é a única). Usado para narrar a movimentação no registro (R49).
function salaEm(map: GameMap | null, x: number, y: number): Room | null {
  const rooms = map ? map.rooms : null;
  if (!rooms) return null;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  }
  return null;
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

function itemIndexAt(game: Game, x: number, y: number): number {
  const list = game.items;
  for (let i = 0; i < list.length; i++) {
    if (list[i].x === x && list[i].y === y) return i;
  }
  return -1;
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
      // §5.1 do docs/PERSONAGEM.md — cosmético; nunca entra em `snapshot()`.
      facing: DEFAULT_FACING
    },
    enemies: pop.enemies,
    items: pop.items,
    // O vanilla começava com `dmap: null`; aqui o campo é tipado como Int32Array,
    // então parte vazio e `refreshDerived` o preenche antes de qualquer leitura.
    dmap: new Int32Array(0),
    fleeMap: null,
    dbuf: null,
    visible: new Set<number>(),
    explored: new Uint8Array(map.w * map.h),
    rngCombat: makeRng(hash32(seed + '#combat' + d)),
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
    ganharXp(game, xp);
  } else {
    logMsg(game, 'Você atinge ' + artigo(ent) + ' ' + nome + ' por ' + dmg +
      ' de dano (' + ent.hp + '/' + ent.maxHp + ').', 'info');
  }
}

function pegarItem(game: Game, explicito: boolean): boolean {
  const p = game.player;
  const i = itemIndexAt(game, p.x, p.y);
  if (i < 0) {
    if (explicito) logMsg(game, 'Não há nada para recolher aqui.', 'aviso');
    return false;
  }
  game.items.splice(i, 1);
  p.potions += 1;
  logMsg(game, 'Você recolhe uma poção (' + p.potions + ' no total).', 'bom');
  return true;
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
  if (!isWalkable(map, nx, ny)) return false;
  p.x = nx;
  p.y = ny;
  narrarSala(game);
  pegarItem(game, false);
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
  g.rngCombat = makeRng(hash32(g.seedStr + '#combat' + depth));
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
 * Resumo textual determinístico do estado. O golden test compara string com
 * string: o formato tem de sair BYTE A BYTE igual ao do vanilla.
 */
export function snapshot(game: Game): string {
  if (!game) return '';
  const p = game.player;
  const partes: string[] = [];
  partes.push('v1');
  partes.push('seed=' + game.seedStr);
  partes.push('d=' + game.depth);
  partes.push('t=' + game.turn);
  partes.push('over=' + (game.over ? 1 : 0));
  partes.push('p=' + p.x + ',' + p.y + ',' + p.hp + '/' + p.maxHp +
    ',atk' + p.atk + ',poc' + p.potions + ',lv' + p.level + ':' + p.xp);

  const inimigos = game.enemies.slice().sort((a, b) => a.id - b.id);
  let buf: string[] = [];
  let i: number;
  for (i = 0; i < inimigos.length; i++) {
    const e = inimigos[i];
    buf.push(e.id + ':' + e.kind + ':' + e.hp + ':' + e.x + ':' + e.y);
  }
  partes.push('E[' + buf.join('|') + ']');

  const itens = game.items.slice().sort((a, b) => a.id - b.id);
  buf = [];
  for (i = 0; i < itens.length; i++) {
    const it = itens[i];
    buf.push(it.id + ':' + it.x + ':' + it.y);
  }
  partes.push('I[' + buf.join('|') + ']');

  const s = game.stats;
  partes.push('S=' + s.turns + ',' + s.kills + ',' + s.dmgDealt + ',' + s.dmgTaken +
    ',' + s.itemsUsed + ',' + s.deepest + ',' + s.explorePct);
  partes.push('rng=' + (isNum(game.rngCombat.s) ? (game.rngCombat.s >>> 0) : 0));
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

function reconstruirItem(bruto: unknown, map: GameMap): Item | null {
  const o = objetoDe(bruto);
  if (!o) return null;
  const x = intOr(o.x, -1);
  const y = intOr(o.y, -1);
  if (!isWalkable(map, x, y)) return null;
  return {
    id: intOr(o.id, 0),
    kind: 'potion',
    x: x,
    y: y,
    heal: intOr(o.heal, POTION_HEAL)
  };
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

  game.emTurno = false;
  game.causeKind = '';
  game.lastRoomId = idDaSala(map, p.x, p.y);
  refreshDerived(game);
  game.stats.turns = game.turn;
  return game;
}
