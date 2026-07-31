/* ISOROGUE — src/engine/entities.ts
 * Porte 1:1 de legacy/src-vanilla/40-entities.js.
 *
 * Arquétipos, spawn proporcional (largest remainder), combate determinístico e IA
 * de inimigos. Todos os arquétipos leem O MESMO game.dmap (nenhum A* individual).
 * Cobre R22..R25 (distribuição) e R35..R43 (IA, combate, dano).
 *
 * Módulo PURO: sem DOM, sem React, sem relógio, sem Math.random. Toda
 * aleatoriedade vem dos streams determinísticos (`rngCombat` e o rng de
 * população derivado da seed do mapa).
 *
 * NOTA DE MIGRAÇÃO — ordem de operações preservada byte a byte:
 *  · ordem de iteração de DIRS8 (desempate de todo passo de gradiente);
 *  · ordem de processamento dos inimigos por `id` crescente;
 *  · Set de tiles ocupados com reserva IMEDIATA no instante do movimento;
 *  · consumo do rng de população: shuffle dos candidatos da sala e, a cada
 *    posição efetivamente ocupada, um sorteio de arquétipo;
 *  · cada string de log e de `ent.plan` em pt-BR.
 */

import type {
  Archetype,
  ArchetypeKey,
  Bag,
  CustoReceita,
  Enemy,
  EnemyState,
  Game,
  GameMap,
  Item,
  ItemKind,
  LogClass,
  MaterialKind,
  Missao,
  Point,
  Population,
  ReceitaKind,
  Rng,
  Room,
  Step
} from './types';
import { CONFIG, DIRS4, DIRS8, cheb, hash32, idx, makeRng } from './core';
import { Tile } from './types';
import { inBounds as mapInBounds, isWalkable, roomAt } from './mapgen';
import {
  ITEM_KINDS,
  RECEITA_KINDS,
  normalizeItemKind,
  normalizeMaterialKind,
  normalizeReceita
} from './vocab';
import { isVisibleFrom } from './fov';
import { bestStep, computeDijkstra, fleeMap as computeFleeMap } from './dijkstra';
import { logMsg } from './game';

/*
 * O vocabulário do contrato (as listas de nomes que viajam em texto) mora em
 * vocab.ts para que core.ts possa validar comandos sem fechar um ciclo de
 * import — a razão está escrita por extenso lá. Entities continua sendo a PORTA
 * DE ENTRADA do domínio: quem já importava estas cinco coisas daqui (game.ts,
 * save.ts, a UI, os testes) não precisa saber que elas se mudaram de arquivo.
 */
export {
  ITEM_KINDS,
  RECEITA_KINDS,
  normalizeItemKind,
  normalizeMaterialKind,
  normalizeReceita
};

/* ------------------------------------------------------------------ *
 * Arquétipos
 * ------------------------------------------------------------------ */

/* `cor`/`corDetalhe`/`forma` são dicas para o render; `nivel` é o nível do
 * monstro na escala de balanceamento (§15 do BESTIARIO — dirige o XP do abate
 * e a tabela de spawn por nível do herói); `ideal` é a distância preferida;
 * `fem` é o gênero gramatical do nome, usado para concordar artigo e particípio
 * nas mensagens do registro ('foge ferida' × 'foge ferido'). */
export const ARCHETYPES: Record<ArchetypeKey, Archetype> = {
  chaser: {
    key: 'chaser',
    nome: 'Perseguidor',
    fem: false,
    hp: 12,
    atk: 4,
    range: 1,
    ideal: 1,
    cor: '#d9534f',
    corDetalhe: '#f2a6a3',
    forma: 'triangulo',
    nivel: 2,
    desc: 'Avança sem hesitar pelo caminho mais curto e golpeia corpo a corpo.'
  },
  sentinel: {
    key: 'sentinel',
    nome: 'Brutamontes',
    fem: false,
    hp: 9,
    atk: 3,
    range: 1,
    ideal: 1,
    cor: '#4a90d9',
    corDetalhe: '#a9cbef',
    forma: 'hexagono',
    nivel: 3,
    desc: 'Avança sem hesitar e esmaga corpo a corpo com a marreta.'
  },
  linker: {
    key: 'linker',
    nome: 'Vinculador',
    fem: false,
    hp: 14,
    atk: 5,
    range: 1,
    ideal: 3,
    cor: '#b06fd0',
    corDetalhe: '#ddb8ec',
    forma: 'duplo-losango',
    nivel: 1,
    desc: 'Só parte para o ataque quando outro inimigo já está colado no jogador.'
  }
};

/** Ordem fixa de iteração dos arquétipos — nunca use Object.keys na lógica. */
export const KINDS: ArchetypeKey[] = ['chaser', 'sentinel', 'linker'];

/* ------------------------------------------------------------------ *
 * Itens — a tabela dos despojos (fase 1)
 * ------------------------------------------------------------------ */

/**
 * Ficha de um tipo de item. Fica ao lado de `ARCHETYPES` porque é a mesma
 * natureza de dado: tabela fixa, lida por todo mundo, escrita por ninguém.
 *
 * `fem` existe pela mesma razão que o `fem` do arquétipo — concordância de
 * gênero em pt-BR no registro. O item tem gênero PRÓPRIO, independente do
 * monstro que o largou: 'O Vinculador larga UM frasco de gosma', 'O
 * Perseguidor larga UMA orelha de goblin'.
 *
 * `valor` é o preço em moedas que o mercador paga pelo item (fase 2). O número
 * é decisão de design e nasceu junto com a tabela, na fase 1; a venda só passou
 * a lê-lo agora.
 */
export interface ItemDef {
  key: ItemKind;
  /** Nome no singular, minúsculo, para compor frases. */
  nome: string;
  plural: string;
  /** Gênero gramatical do NOME (não do monstro): 'uma orelha', 'um pé'. */
  fem: boolean;
  /** Quanto o mercador PAGA por uma unidade, em moedas (fase 2). */
  valor: number;
  /** `true` = vai para `player.bag`; `false` = tem regra própria (a poção). */
  material: boolean;
  desc: string;
}

/**
 * Tabela canônica dos itens.
 *
 * A ORDEM de declaração desta tabela é contrato: `ITEM_KINDS` (vocab.ts) a
 * espelha, e é `ITEM_KINDS` que ordena a bolsa no `snapshot()`, no save e nas
 * linhas de registro da coleta. Nunca leia a bolsa por `Object.keys` — a ordem
 * de um objeto aberto é acidental, e o oracle não perdoa acidente.
 */
export const ITENS: Record<ItemKind, ItemDef> = {
  potion: {
    key: 'potion',
    nome: 'poção',
    plural: 'poções',
    fem: true,
    /* Zero porque a poção NÃO se vende: `valor` é o que o mercador PAGA, e ele
     * só compra material. O que o jogador paga para levar uma é `PRECO_POCAO`,
     * que é outro número (e maior, que é como mercador vive). */
    valor: 0,
    material: false,
    desc: 'Frasco de cura. Restaura vida na hora em que é bebido.'
  },
  gosma: {
    key: 'gosma',
    nome: 'frasco de gosma',
    plural: 'frascos de gosma',
    fem: false,
    valor: 3,
    material: true,
    desc: 'Gosma de Slime raspada do chão. Sozinha não vale quase nada.'
  },
  orelhaGoblin: {
    key: 'orelhaGoblin',
    nome: 'orelha de goblin',
    plural: 'orelhas de goblin',
    fem: true,
    valor: 5,
    material: true,
    desc: 'A prova de abate mais comum da masmorra — e a mais fácil de vender.'
  },
  espadaGoblin: {
    key: 'espadaGoblin',
    nome: 'cimitarra de goblin',
    plural: 'cimitarras de goblin',
    fem: true,
    valor: 18,
    material: true,
    desc: 'Lâmina larga e mal-afiada. Vale pelo aço, não pelo corte.'
  },
  peOgro: {
    key: 'peOgro',
    nome: 'pé de ogro',
    plural: 'pés de ogro',
    fem: false,
    valor: 12,
    material: true,
    desc: 'Pesado, malcheiroso e cotado no mercado de curiosidades.'
  },
  clavaOgro: {
    key: 'clavaOgro',
    /* O render chama a arma do Ogro de "marreta" (docs/BESTIARIO.md §12); a
     * chave do item nasceu `clavaOgro` no desenho da fase 1, e chave é
     * contrato — o nome exibido acompanha a chave para os dois não brigarem. */
    nome: 'clava de ogro',
    plural: 'clavas de ogro',
    fem: true,
    valor: 40,
    material: true,
    desc: 'Tronco cravejado que um humano mal levanta. O despojo mais caro.'
  }
};

/** `true` para tudo que vai para a bolsa — hoje, tudo menos a poção. */
export function ehMaterial(kind: ItemKind): kind is MaterialKind {
  const def = ITENS[kind];
  return !!def && def.material;
}

/* ------------------------------------------------------------------ *
 * Despojos — o que cada arquétipo larga ao morrer
 * ------------------------------------------------------------------ */

/** Uma linha da tabela de despojos: um item e a chance INDEPENDENTE dele. */
export interface DropEntry {
  item: MaterialKind;
  /** Probabilidade em [0,1]. Sorteio próprio, não é fatia de um bolo. */
  chance: number;
}

/**
 * Tabela de despojos por arquétipo (Slime/Goblin/Ogro = linker/chaser/sentinel).
 *
 * Cada linha é um sorteio INDEPENDENTE: um Goblin pode largar orelha e
 * cimitarra no mesmo abate, como pode não largar nada. As chances NÃO somam 1 e
 * não devem somar — não é uma distribuição, são moedas separadas.
 *
 * A ORDEM das linhas é desempate determinístico e portanto CONGELADA: ela fixa
 * (a) a ordem em que os sorteios consomem `rngLoot` e (b) a ordem em que os ids
 * dos itens são atribuídos quando dois caem no mesmo abate. Reordenar esta
 * tabela muda todas as partidas salvas, exatamente como reordenar `DIRS8`.
 */
export const DROPS: Record<ArchetypeKey, ReadonlyArray<DropEntry>> = {
  /* Slime */
  linker: [
    { item: 'gosma', chance: 0.70 }
  ],
  /* Goblin */
  chaser: [
    { item: 'orelhaGoblin', chance: 0.50 },
    { item: 'espadaGoblin', chance: 0.15 }
  ],
  /* Ogro */
  sentinel: [
    { item: 'peOgro', chance: 0.45 },
    { item: 'clavaOgro', chance: 0.20 }
  ]
};

/**
 * Rola a tabela de despojos de um arquétipo. Devolve os itens sorteados na
 * ORDEM DA TABELA — a lista pode sair vazia, com um ou com todos.
 *
 * Consumo do stream: EXATAMENTE `DROPS[kind].length` valores, sempre, dê no que
 * der. Isso vale porque `rng.chance` consome um u32 mesmo quando o resultado é
 * previsível (contrato do rng.ts). É essa propriedade que faz a posição do
 * stream de loot depender apenas de QUAIS monstros morreram, nunca de O QUE
 * caiu — um invariante barato que mantém o determinismo estável a rebalanceio
 * de chance.
 */
export function sortearDespojos(rng: Rng, kind: ArchetypeKey): MaterialKind[] {
  const tabela = DROPS[kind];
  const out: MaterialKind[] = [];
  if (!tabela) return out;
  for (let i = 0; i < tabela.length; i++) {
    if (rng.chance(tabela[i].chance)) out.push(tabela[i].item);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Missões — as caçadas do quadro do mercador (fase 3)
 * ------------------------------------------------------------------ */

/**
 * O nome POPULAR da criatura, com plural — o do bestiário do jogador, não o
 * nome de exibição do arquétipo. `ARCHETYPES[chaser].nome` é 'Perseguidor',
 * mas a caçada se chama 'Caça ao Goblin' porque é assim que os despojos já o
 * chamam ('orelha de goblin', 'pé de ogro', 'gosma de Slime'): missão e
 * despojo têm de falar da mesma criatura com a mesma palavra, ou o jogador
 * não descobre que a orelha na bolsa é a prova que o quadro pede.
 */
export const CRIATURAS: Record<ArchetypeKey, { nome: string; plural: string }> = {
  chaser: { nome: 'Goblin', plural: 'Goblins' },
  sentinel: { nome: 'Ogro', plural: 'Ogros' },
  linker: { nome: 'Slime', plural: 'Slimes' }
};

/** Título pt-BR da caçada: 'Caça ao Goblin'. Todos masculinos hoje. */
export function nomeDaMissao(alvo: ArchetypeKey): string {
  return 'Caça ao ' + (CRIATURAS[alvo] ? CRIATURAS[alvo].nome : 'monstro');
}

/**
 * A descrição pt-BR da caçada, gerada UMA vez na criação e gravada na missão.
 *
 * `matar` nasce na faixa 2..4, então a criatura sai sempre no plural. A
 * entrega é mais sutil: ela pede um TOTAL somando os tipos de `itens`, então
 *   · um tipo só (o Slime) pode nomear o item direto ('2 frascos de gosma');
 *   · dois tipos (Goblin, Ogro) não podem dizer '2 orelhas' — seria mentira,
 *     porque uma orelha e uma cimitarra também fecham a conta. Por isso a
 *     frase diz 'despojos' e lista os tipos aceitos entre parênteses.
 */
export function descDaMissao(
  alvo: ArchetypeKey,
  matar: number,
  entregar: number,
  itens: MaterialKind[]
): string {
  const criatura = CRIATURAS[alvo] ? CRIATURAS[alvo].plural : 'monstros';
  let entrega: string;
  if (itens.length === 1) {
    const def = ITENS[itens[0]];
    entrega = entregar === 1
      ? (def.fem ? 'uma' : 'um') + ' ' + def.nome
      : entregar + ' ' + def.plural;
  } else {
    const nomes: string[] = [];
    for (let i = 0; i < itens.length; i++) nomes.push(ITENS[itens[i]].nome);
    const bicho = CRIATURAS[alvo] ? CRIATURAS[alvo].nome.toLowerCase() : 'monstro';
    entrega = entregar + ' ' + (entregar === 1 ? 'despojo' : 'despojos') +
      ' de ' + bicho + ' (' + nomes.join(' ou ') + ')';
  }
  return 'Mate ' + matar + ' ' + criatura + ' e entregue ' + entrega + '.';
}

/**
 * O item MAIS COMUM do alvo — a linha de maior `chance` da tabela de despojos
 * (gosma do Slime, orelha do Goblin, pé do Ogro). Empate resolve pela ordem
 * da tabela, que é congelada.
 *
 * É ele que precifica a entrega na fórmula da recompensa: a missão cobra um
 * TOTAL que o jogador fecha na maioria com o despojo comum, então a moeda de
 * conta da caçada é o valor dele — usar o item raro (a clava de 40) pagaria
 * fortuna por uma entrega que quase nunca inclui a clava.
 */
export function itemPrincipal(alvo: ArchetypeKey): MaterialKind {
  const tabela = DROPS[alvo];
  let melhor: MaterialKind = 'gosma';
  let melhorChance = -1;
  for (let i = 0; i < tabela.length; i++) {
    if (tabela[i].chance > melhorChance) {
      melhorChance = tabela[i].chance;
      melhor = tabela[i].item;
    }
  }
  return melhor;
}

/** A moeda de conta da recompensa: quanto vale um abate, em moedas. */
const MOEDAS_POR_ABATE = 4;

/**
 * Gera as caçadas de UM andar, consumindo SÓ o stream de população.
 *
 * A ordem de consumo do stream é contrato (mudá-la muda todas as missões de
 * todas as sementes):
 *   1. `int(1, 3)` — quantas missões o andar oferece;
 *   2. `shuffle` de `KINDS` — QUAIS arquétipos (sem repetição: um shuffle
 *      cortado nos primeiros N nunca repete), reordenados de volta à ordem
 *      de `KINDS` para a leitura do painel — o sorteio decide o CONJUNTO, a
 *      tabela decide a ORDEM, e o painel não balança de andar para andar;
 *   3. por missão, na ordem de `KINDS`: `int(2, 4)` de abates, `int(1, 3)`
 *      de entrega (total somando os tipos), `chance(0.5)` de bônus e, se
 *      houver bônus, um `pick` entre os tipos do alvo.
 *
 * A FÓRMULA DA RECOMPENSA: `matar * MOEDAS_POR_ABATE + entregar * valor do
 * item principal do alvo`. O esforço tem duas pernas — os abates contam no
 * primeiro termo e a coleta no segundo, pesada pelo preço de tabela do
 * despojo comum. Faixas resultantes: Slime 11..24 moedas, Goblin 13..31,
 * Ogro 20..52 (contra os 15 da poção do mercador) — o ogro paga mais porque
 * o pé vale mais e o brutamontes bate mais, e é essa a escala que a fórmula
 * captura sem uma tabela nova.
 */
export function gerarMissoes(rng: Rng): Missao[] {
  const out: Missao[] = [];
  const quantas = rng.int(1, 3);
  const sorteados = rng.shuffle(KINDS.slice()).slice(0, quantas);
  /* De volta à ordem de KINDS: o painel lê sempre Goblin, Ogro, Slime. */
  sorteados.sort(function (a, b) { return KINDS.indexOf(a) - KINDS.indexOf(b); });

  for (let i = 0; i < sorteados.length; i++) {
    const alvo = sorteados[i];
    const matar = rng.int(2, 4);
    const itens: MaterialKind[] = [];
    const tabela = DROPS[alvo];
    for (let k = 0; k < tabela.length; k++) itens.push(tabela[k].item);
    const entregar = rng.int(1, 3);
    let bonus: { kind: MaterialKind; n: number } | null = null;
    if (rng.chance(0.5)) {
      const kind = rng.pick(itens);
      if (kind) bonus = { kind: kind, n: 1 };
    }
    const recompensa = matar * MOEDAS_POR_ABATE + entregar * ITENS[itemPrincipal(alvo)].valor;
    out.push({
      key: 'abate-' + alvo,
      alvo: alvo,
      matar: matar,
      itens: itens,
      entregar: entregar,
      progressoMatar: 0,
      recompensaMoedas: recompensa,
      recompensaItem: bonus,
      nome: nomeDaMissao(alvo),
      desc: descDaMissao(alvo, matar, entregar, itens),
      completa: false,
      entregue: false
    });
  }
  return out;
}

/** Rótulos pt-BR dos estados, para o tooltip da UI. */
export const STATE_LABEL: Record<EnemyState, string> = {
  idle: 'ocioso',
  hunt: 'em perseguição',
  flee: 'em fuga',
  attack: 'atacando',
  wait: 'aguardando'
};

export const WOUNDED_RATIO = 0.3; /* hp <= 30% do maxHp entra em fuga */
export const FLEE_FACTOR = -1.2; /* fator padrão do gradiente de fuga */
const LINK_MIN = 2; /* faixa em que o Vinculador circula aguardando aliado */
const LINK_MAX = 3;

/* ------------------------------------------------------------------ *
 * Utilidades internas
 * ------------------------------------------------------------------ */

/** Contexto compartilhado por todos os inimigos dentro de um turno. */
export interface TurnContext {
  map: GameMap;
  occupied: Set<number>;
  dmap: Int32Array;
  fleeMap: Int32Array | null;
  alive: Enemy[];
}

/** Predicado de bloqueio; aceita (x, y) ou (índice) — as duas convenções
 *  possíveis de `bestStep`. */
type BlockedFn = (a: number, b?: number) => boolean;

function say(game: Game, text: string, cls?: LogClass): void {
  logMsg(game, text, cls ?? 'info');
}

function archOf(kind: ArchetypeKey): Archetype {
  return ARCHETYPES[kind] ?? ARCHETYPES.chaser;
}

/* Concordância de gênero: hoje os três arquétipos são masculinos; o mecanismo
 * fica de pé para futuros arquétipos femininos.
 * `art` devolve a vogal do artigo ('o'/'a') — serve tanto para o artigo solto
 * quanto para contrações ('d' + art, 'pel' + art) e para o particípio
 * ('ferid' + art). `Art` é o artigo inicial de frase, maiúsculo. */
function art(arch: Archetype): string {
  return arch && arch.fem ? 'a' : 'o';
}

function Art(arch: Archetype): string {
  return arch && arch.fem ? 'A' : 'O';
}

function walkable(map: GameMap, x: number, y: number): boolean {
  return !!isWalkable(map, x, y);
}

function inBounds(map: GameMap, x: number, y: number): boolean {
  return !!mapInBounds(map, x, y);
}

function hasLOS(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number
): boolean {
  return !!isVisibleFrom(map, ax, ay, bx, by, radius);
}

/* Bloqueio para o passo de gradiente: fora do mapa, parede, tile ocupado
 * (inimigo vivo ou jogador) e corte de canto em diagonal.
 * Aceita tanto (x, y) quanto (índice) para tolerar as duas convenções
 * possíveis de `bestStep`. */
function makeBlocker(
  map: GameMap,
  occupied: Set<number>,
  sx: number,
  sy: number
): BlockedFn {
  const w = map.w;
  return function (a: number, b?: number): boolean {
    let x: number;
    let y: number;
    if (b === undefined || b === null) {
      x = a % w;
      y = (a - x) / w;
    } else {
      x = a;
      y = b;
    }
    if (!inBounds(map, x, y)) return true;
    if (!walkable(map, x, y)) return true;
    if (occupied.has(idx(w, x, y))) return true;
    const dx = x - sx;
    const dy = y - sy;
    if (dx !== 0 && dy !== 0) {
      /* sem corte de canto: as duas ortogonais precisam ser caminháveis */
      if (!walkable(map, sx + dx, sy)) return true;
      if (!walkable(map, sx, sy + dy)) return true;
    }
    return false;
  };
}

/* Varredura local do gradiente: menor valor entre os 8 vizinhos, estritamente
 * menor que o tile atual; empate resolvido pela ordem de DIRS8. */
function scanBest(
  field: Int32Array,
  map: GameMap,
  x: number,
  y: number,
  blocked: BlockedFn
): Step | null {
  const w = map.w;
  const cur = field[idx(w, x, y)];
  let best: Step | null = null;
  let bestV = cur;
  for (let d = 0; d < DIRS8.length; d++) {
    const nx = x + DIRS8[d][0];
    const ny = y + DIRS8[d][1];
    if (!inBounds(map, nx, ny)) continue;
    if (blocked(nx, ny)) continue;
    const v = field[idx(w, nx, ny)];
    if (v < bestV) {
      bestV = v;
      best = { x: nx, y: ny, v: v };
    }
  }
  return best;
}

function validStep(
  map: GameMap,
  occupied: Set<number>,
  ent: Enemy,
  step: Step | null
): step is Step {
  if (!step) return false;
  if (typeof step.x !== 'number' || typeof step.y !== 'number') return false;
  if (step.x === ent.x && step.y === ent.y) return false;
  if (cheb(ent.x, ent.y, step.x, step.y) !== 1) return false;
  if (!walkable(map, step.x, step.y)) return false;
  if (occupied.has(idx(map.w, step.x, step.y))) return false;
  const dx = step.x - ent.x;
  const dy = step.y - ent.y;
  if (dx !== 0 && dy !== 0) {
    if (!walkable(map, ent.x + dx, ent.y)) return false;
    if (!walkable(map, ent.x, ent.y + dy)) return false;
  }
  return true;
}

/* Reserva o tile no instante do movimento — é o que garante que dois inimigos
 * jamais ocupem o mesmo tile (R40 / teste T7). */
function moveTo(ctx: TurnContext, ent: Enemy, x: number, y: number): void {
  const w = ctx.map.w;
  ctx.occupied.delete(idx(w, ent.x, ent.y));
  ent.x = x;
  ent.y = y;
  ctx.occupied.add(idx(w, x, y));
}

/* Desce o gradiente `field` um passo. Usa `bestStep` (contrato do Dijkstra) e
 * valida o resultado; se o preferido não servir, cai na varredura local que
 * escolhe o segundo melhor vizinho pela mesma ordem de DIRS8. */
function gradientStep(ent: Enemy, ctx: TurnContext, field: Int32Array): Step | null {
  const map = ctx.map;
  const blocked = makeBlocker(map, ctx.occupied, ent.x, ent.y);
  let step: Step | null = bestStep(field, ent.x, ent.y, blocked);
  if (!validStep(map, ctx.occupied, ent, step)) {
    step = scanBest(field, map, ent.x, ent.y, blocked);
  }
  if (!validStep(map, ctx.occupied, ent, step)) return null;
  moveTo(ctx, ent, step.x, step.y);
  return step;
}

function dmapOf(game: Game): Int32Array {
  const map = game.map;
  const need = map.w * map.h;
  if (game.dmap && game.dmap.length === need) return game.dmap;
  const d = computeDijkstra(
    map,
    [{ x: game.player.x, y: game.player.y, v: 0 }],
    { blocked: null }
  );
  game.dmap = d;
  return d;
}

/* Gradiente de fuga calculado no máximo uma vez por turno e compartilhado
 * por todos os inimigos que precisarem dele. */
function fleeMapOf(game: Game, ctx: TurnContext): Int32Array {
  if (ctx.fleeMap) return ctx.fleeMap;
  const fm = computeFleeMap(ctx.dmap, ctx.map, FLEE_FACTOR);
  ctx.fleeMap = fm;
  game.fleeMap = fm;
  return fm;
}

function setState(
  game: Game,
  ent: Enemy,
  state: EnemyState,
  msg: string | null,
  cls?: LogClass
): void {
  if (ent.state !== state && msg) say(game, msg, cls ?? 'aviso');
  ent.state = state;
}

function isWounded(ent: Enemy): boolean {
  return ent.hp <= ent.maxHp * WOUNDED_RATIO;
}

function combatRng(game: Game): Rng {
  if (!game.rngCombat) {
    /* Contrato: o stream vem de createState. Fallback determinístico apenas
     * para não quebrar caso alguém chame processEnemies isolado. */
    game.rngCombat = makeRng(hash32(String(game.seedStr) + '#combate'));
  }
  return game.rngCombat;
}

/* ------------------------------------------------------------------ *
 * Combate
 * ------------------------------------------------------------------ */

export function rollDamage(rng: Rng, atk: number): number {
  const d = atk + rng.int(-1, 1);
  return d < 1 ? 1 : d;
}

function attackPlayerInterno(game: Game, ent: Enemy, ranged: boolean): number {
  const arch = archOf(ent.kind);
  const dmg = rollDamage(combatRng(game), ent.atk);
  const p = game.player;
  ent.state = 'attack';
  ent.plan = ranged ? 'ataca à distância' : 'ataca corpo a corpo';
  ent.bump = 1;
  p.hp -= dmg;
  if (p.hp < 0) p.hp = 0;
  if (game.stats) {
    game.stats.dmgTaken = (game.stats.dmgTaken || 0) + dmg;
  }
  say(
    game,
    Art(arch) + ' ' + arch.nome + (ranged ? ' dispara de longe' : ' golpeia') +
      ' e causa ' + dmg + ' de dano.',
    'ruim'
  );
  if (p.hp <= 0) {
    /* A transição para `over` (autosave, histórico, tela de morte) e a frase
     * final são do módulo game; aqui só registramos QUEM desferiu o golpe
     * fatal — informação que só as entidades têm neste instante. O módulo
     * game monta a causa a partir deste arquétipo. */
    game.causeKind = ent.kind;
    say(game, 'Você tomba diante d' + art(arch) + ' ' + arch.nome + '.', 'ruim');
  }
  return dmg;
}

export function attackPlayer(game: Game, ent: Enemy): number {
  return attackPlayerInterno(game, ent, ent.range > 1);
}

/* ------------------------------------------------------------------ *
 * Spawn proporcional à área das salas (R22..R25)
 * ------------------------------------------------------------------ */

interface Frac {
  i: number;
  frac: number;
  id: number;
}

/* Largest remainder method: cota = área/áreaTotal × N; as sobras vão para as
 * maiores frações; empate de fração desempata pelo menor room.id. */
function largestRemainder(rooms: Room[], n: number): number[] {
  const quotas: number[] = [];
  let i: number;
  for (i = 0; i < rooms.length; i++) quotas.push(0);
  if (n <= 0 || rooms.length === 0) return quotas;

  let totalArea = 0;
  for (i = 0; i < rooms.length; i++) {
    totalArea += Math.max(0, rooms[i].area || 0);
  }
  if (totalArea <= 0) {
    /* Sem área declarada: reparte em rodízio pela ordem das salas. */
    for (i = 0; i < n; i++) quotas[i % rooms.length]++;
    return quotas;
  }

  const fracs: Frac[] = [];
  let assigned = 0;
  for (i = 0; i < rooms.length; i++) {
    const exact = (Math.max(0, rooms[i].area || 0) / totalArea) * n;
    const base = Math.floor(exact);
    quotas[i] = base;
    assigned += base;
    fracs.push({ i: i, frac: exact - base, id: rooms[i].id });
  }
  fracs.sort(function (a, b) {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return a.id - b.id;
  });
  const left = n - assigned;
  for (i = 0; i < left && i < fracs.length; i++) quotas[fracs[i].i]++;
  return quotas;
}

interface Candidate {
  x: number;
  y: number;
  i: number;
}

/* Tiles livres de uma sala, em ordem determinística (linha a linha). */
function roomCandidates(
  map: GameMap,
  room: Room,
  taken: Set<number>,
  start: Point,
  stairs: Point | null
): Candidate[] {
  const out: Candidate[] = [];
  const x0 = room.x;
  const y0 = room.y;
  const x1 = room.x + room.w;
  const y1 = room.y + room.h;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!inBounds(map, x, y)) continue;
      if (!walkable(map, x, y)) continue;
      if (x === start.x && y === start.y) continue;
      if (stairs && x === stairs.x && y === stairs.y) continue;
      if (cheb(x, y, start.x, start.y) <= CONFIG.SAFE_RADIUS) continue;
      const i = idx(map.w, x, y);
      if (taken.has(i)) continue;
      out.push({ x: x, y: y, i: i });
    }
  }
  return out;
}

type PlaceFn = (x: number, y: number) => void;

/* Distribui `total` posições pelas salas conforme as cotas, migrando a sobra
 * para a próxima sala por id quando a sala está saturada. */
function distribute(
  map: GameMap,
  rooms: Room[],
  quotas: number[],
  total: number,
  rng: Rng,
  taken: Set<number>,
  start: Point,
  stairs: Point | null,
  place: PlaceFn
): number {
  const order: Array<{ room: Room; q: number }> = [];
  let i: number;
  for (i = 0; i < rooms.length; i++) {
    order.push({ room: rooms[i], q: quotas[i] });
  }
  order.sort(function (a, b) { return a.room.id - b.room.id; });

  let placed = 0;
  let carry = 0;

  function fill(room: Room, want: number): number {
    if (want <= 0) return 0;
    const cand = roomCandidates(map, room, taken, start, stairs);
    if (cand.length === 0) return 0;
    rng.shuffle(cand);
    let got = 0;
    for (let k = 0; k < cand.length && got < want; k++) {
      const c = cand[k];
      if (taken.has(c.i)) continue;
      taken.add(c.i);
      place(c.x, c.y);
      got++;
    }
    return got;
  }

  for (i = 0; i < order.length; i++) {
    const want = order[i].q + carry;
    const got = fill(order[i].room, want);
    carry = want - got;
    placed += got;
  }

  /* Passadas extras: a cota que sobrou continua migrando pelas salas por id
   * enquanto houver progresso. */
  while (carry > 0 && placed < total) {
    let progress = 0;
    for (i = 0; i < order.length && carry > 0; i++) {
      const g = fill(order[i].room, carry);
      carry -= g;
      placed += g;
      progress += g;
    }
    if (progress === 0) break;
  }
  return placed;
}

/**
 * §15 do BESTIARIO — a mistura de spawn, dirigida pelo NÍVEL DO HERÓI (não
 * mais pela profundidade). Cada linha é um degrau do herói; as colunas seguem
 * `KINDS` (chaser/sentinel/linker = Goblin/Ogro/Slime). A progressão pedida
 * pelo dono:
 *
 *   herói 1: 10 goblin · 1 ogro · 100 slime — a cada 10 slimes, 1 goblin; a
 *            cada 10 goblins, 1 ogro (a masmorra é dos slimes);
 *   herói 2: os goblins dominam, ogros aparecem, slimes recuam;
 *   herói 3: os ogros dominam, goblins continuam comuns, slimes raros;
 *   herói 4+: ogros comuns, goblins em minoria, slimes raríssimos — o estado
 *            final descrito pelo dono, estável dali em diante.
 *
 * O degrau 4 é também a régua dos níveis seguintes: com XP plano de 100 por
 * nível o herói pode subir indefinidamente, e a mistura não volta a mudar.
 */
const PESOS_SPAWN: readonly (readonly [number, number, number])[] = [
  [10, 1, 100],   // herói 1
  [100, 10, 30],  // herói 2
  [40, 100, 10],  // herói 3
  [15, 100, 3]    // herói 4+
];

/** Os pesos da linha do herói (clamp nos dois extremos da tabela). */
export function pesosSpawn(heroLevel: number): readonly [number, number, number] {
  let l = Math.floor(heroLevel);
  if (!Number.isFinite(l) || l < 1) l = 1;
  if (l > PESOS_SPAWN.length) l = PESOS_SPAWN.length;
  return PESOS_SPAWN[l - 1];
}

/* Sorteio do arquétipo pela linha de `PESOS_SPAWN` do nível do herói.
 * Determinístico (consome o rng de população). */
function pickKind(rng: Rng, heroLevel: number): ArchetypeKey {
  const weights = pesosSpawn(heroLevel);
  let total = 0;
  let i: number;
  for (i = 0; i < weights.length; i++) total += weights[i];
  let r = rng.int(1, total);
  for (i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return KINDS[i];
  }
  return KINDS[0];
}

export function makeEnemy(
  id: number,
  kind: ArchetypeKey,
  x: number,
  y: number,
  depth: number
): Enemy {
  const arch = archOf(kind);
  const d = depth < 1 ? 1 : depth;
  const hp = arch.hp + Math.floor(arch.hp * 0.15 * (d - 1));
  const atk = arch.atk + Math.floor((d - 1) / 2);
  return {
    id: id,
    kind: arch.key,
    x: x,
    y: y,
    hp: hp,
    maxHp: hp,
    atk: atk,
    range: arch.range,
    state: 'idle',
    plan: 'em repouso',
    lastDmg: 0,
    bump: 0
  };
}

// Poções são fungíveis: o contrato (seção 7) guarda só um CONTADOR em
// player.potions, sem espaço para curas individuais. Logo todas curam o mesmo,
// e este é o valor único que o módulo de jogo também consome — item.heal
// nunca mente sobre o que a poção faz.
export const POTION_HEAL = 12;

/* ------------------------------------------------------------------ *
 * Economia e oficina (fase 2)
 * ------------------------------------------------------------------ */

/**
 * Quanto o mercador COBRA por uma poção, em moedas.
 *
 * Mora ao lado de `POTION_HEAL` porque é o outro lado do mesmo item, e os dois
 * são a mesma decisão de balanceamento: 15 moedas por 12 de cura significa
 * cinco frascos de gosma (3 cada) por um gole — o material mais barato da
 * masmorra não paga a saída fácil, mas o despojo de goblin (18) paga.
 */
export const PRECO_POCAO = 15;

/** Teto de refinos da arma. Cada degrau vale +1 de ataque, permanente. */
export const ARMA_NIVEL_MAX = 5;

/** Quanto de ataque cada degrau de refino soma. */
export const ATK_POR_REFINO = 1;

/**
 * Ficha de uma receita da bancada. Mesma natureza de `ITENS` e `DROPS`: tabela
 * fixa, lida por todo mundo (inclusive pela interface, que MONTA A LISTA a
 * partir daqui), escrita por ninguém.
 *
 * O que a ficha NÃO carrega é o EFEITO: consumir os materiais é regra comum
 * (está em `custo`), mas o que sai da bancada mexe no jogador e é decisão de
 * jogo — mora em game.ts, num lugar só. `produz` é a descrição em pt-BR desse
 * efeito, para a UI listar sem precisar conhecê-lo.
 */
export interface ReceitaDef {
  key: ReceitaKind;
  /** Nome exibido, em pt-BR. */
  nome: string;
  /** Ofício, para a UI agrupar: o caldeirão ou a bigorna. */
  oficio: 'alquimia' | 'refino';
  /** Materiais consumidos. Leia SEMPRE pela ordem de `ITEM_KINDS`. */
  custo: CustoReceita;
  /** O que sai da bancada, em uma frase. */
  produz: string;
  desc: string;
}

/** Alquimia: três gosmas viram uma poção. */
export const RECEITA_POCAO: CustoReceita = { gosma: 3 };

/** Refino: duas cimitarras viram um degrau de arma. */
export const RECEITA_REFINO: CustoReceita = { espadaGoblin: 2 };

/**
 * Tabela canônica das receitas — FONTE ÚNICA.
 *
 * Nenhum outro ponto do código pode escrever "3 gosmas" ou "2 cimitarras": a
 * validação, o consumo, o log de falta e a lista da interface leem todos daqui.
 * É a mesma disciplina de `ITENS`, e pela mesma razão: uma receita duplicada é
 * uma receita que um dia vai divergir.
 */
export const RECEITAS: Record<ReceitaKind, ReceitaDef> = {
  pocao: {
    key: 'pocao',
    nome: 'Poção de cura',
    oficio: 'alquimia',
    custo: RECEITA_POCAO,
    produz: '1 poção',
    desc: 'Fervida no caldeirão, a gosma de Slime coalha numa cura decente.'
  },
  refino: {
    key: 'refino',
    nome: 'Refino de arma',
    oficio: 'refino',
    custo: RECEITA_REFINO,
    produz: '+1 de ataque (até ' + ARMA_NIVEL_MAX + ' refinos)',
    desc: 'O aço mole das cimitarras de goblin, batido na bigorna, vira gume.'
  }
};

/* A ordem fixa de iteração das receitas é `RECEITA_KINDS` (vocab.ts),
 * reexportado no topo deste módulo. A UI lista por ela. */

/**
 * A bolsa cobre o custo? Varre pela ordem de `ITEM_KINDS` (jamais
 * `Object.keys`) e devolve o que FALTA, na mesma ordem — lista vazia significa
 * "dá para fazer". Devolver a falta, e não um booleano, é o que permite ao
 * registro dizer o que está faltando sem recalcular nada.
 */
export function faltasDaReceita(bag: Bag, custo: CustoReceita): Array<{ item: MaterialKind; falta: number }> {
  const out: Array<{ item: MaterialKind; falta: number }> = [];
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const pedido = custo[kind] || 0;
    if (pedido <= 0) continue;
    const tem = bag[kind] || 0;
    if (tem < pedido) out.push({ item: kind, falta: pedido - tem });
  }
  return out;
}

/**
 * Cria um item no chão. `kind` é o ÚLTIMO parâmetro e tem padrão `'potion'`
 * para que as chamadas antigas — `populate`, que só semeia poções — continuem
 * lendo exatamente como liam.
 *
 * `heal` só faz sentido para a poção; material nasce com 0 (ele não cura, e um
 * número mentiroso ali acabaria virando cura no dia em que alguém confiasse no
 * campo em vez do `kind`).
 */
export function makeItem(id: number, x: number, y: number, kind: ItemKind = 'potion'): Item {
  return {
    id: id,
    kind: kind,
    x: x,
    y: y,
    heal: kind === 'potion' ? POTION_HEAL : 0
  };
}

/* ------------------------------------------------------------------ *
 * A PASSAGEM — o povoamento não pode trancar o andar
 *
 * O BRIEF exige em R15 "BFS ao final garantindo 100% dos tiles caminháveis
 * conectados" e em R16 "áreas isoladas são conectadas ou o mapa é regenerado".
 * O gerador CUMPRE: o portão vive dentro de `generate()` (mapgen.ts), com BFS,
 * reparo por túnel e laço de regeneração até `CONFIG.MAX_REGEN`.
 *
 * Só que os SÓLIDOS PERMANENTES do andar — mercador, caldeirão e a decoração da
 * estação — nascem aqui, em `populate()`, DEPOIS daquele portão, e por isso ele
 * nunca os viu. Desde a fase 2.2 os três recusam o passo como uma parede
 * (`esbarrar`, em game.ts), e o resultado apareceu numa captura de tela do
 * dono: o mercador plantado no ÚNICO tile de saída da sala inicial, o herói
 * preso no cômodo, a escada do outro lado, a partida acabada antes do primeiro
 * monstro. O gerador entregava o mapa inteiro; o povoador o partia.
 *
 * MEDIDO ANTES DO CONSERTO, em 3000 andares (500 sementes × 6 profundidades):
 * 34,7% saíam com o mapa PARTIDO e 14,2% com a ESCADA INALCANÇÁVEL. A mesma
 * varredura sem sólido nenhum deu 0 de 3000 — ou seja, água e vazio (que também
 * barram) já estão cobertos pelo portão do gerador, e a quebra inteira era do
 * povoamento. Nos piores casos sobravam 24 de ~780 tiles: a sala inicial e nada
 * mais.
 *
 * O CONSERTO, em uma frase: nenhum sólido permanente pode nascer num PONTO DE
 * ARTICULAÇÃO do grafo do passo — um tile cuja retirada parte o grafo em dois.
 * ------------------------------------------------------------------ */

/**
 * A aresta (x,y) → (x+dx, y+dy) existe para o PASSO DO JOGADOR?
 *
 * A vizinhança é a de `mover` (game.ts), NÃO a do BFS de conectividade do
 * gerador (que é de quatro direções). Usar a errada torna todo este módulo
 * inútil ou paranoico: com 4-vizinhança, um tile vira "gargalo" onde a diagonal
 * passa tranquila; com 8-vizinhança crua, o filtro libera cantos que o jogo não
 * deixa cortar. Só a vizinhança REAL do passo responde à pergunta real.
 *
 * O detalhe que decide tudo: o teste de canto de `mover` consulta `isWalkable`,
 * ou seja o TERRENO. Um móvel parado na quina NÃO fecha a diagonal — ele só
 * tira o próprio tile do caminho. É por isso que `fora` entra na checagem do
 * DESTINO e fica de fora da checagem do CANTO. Fosse o contrário, o filtro
 * recusaria tiles que não trancam nada e a estação sumiria de cômodos onde ela
 * cabe perfeitamente.
 */
function passoLigado(
  map: GameMap,
  fora: Set<number>,
  x: number,
  y: number,
  dx: number,
  dy: number
): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (!walkable(map, nx, ny)) return false;
  if (fora.has(idx(map.w, nx, ny))) return false;
  if (dx !== 0 && dy !== 0) {
    if (!walkable(map, nx, y)) return false;
    if (!walkable(map, x, ny)) return false;
  }
  return true;
}

/**
 * Os PONTOS DE ARTICULAÇÃO do grafo do passo, ignorando os tiles de `fora`.
 * Devolve um bitmap w*h com 1 em cada tile cuja retirada partiria o grafo.
 *
 * É o Tarjan clássico — DFS com `descoberta` e low-link `baixo` —, com duas
 * escolhas que valem um parágrafo cada:
 *
 * · POR QUE TARJAN, e não uma BFS por candidato. Medido em 200 andares: a BFS
 *   candidato a candidato custa 7,687 ms por andar contra 0,676 ms de um passe
 *   de Tarjan — onze vezes mais —, e a exatidão é a MESMA. Conferido contra a
 *   verdade medida por BFS em 14.100 candidatos de 600 andares: 1150 tiles
 *   partem o mapa, 1150 acusados, zero falso negativo e zero falso positivo.
 *
 * · POR QUE A PILHA É EXPLÍCITA, e não recursão. O andar tem 45×45 = 2025 tiles
 *   e o caminho de DFS num traçado degenerado pode encostar nesse número.
 *   Recursão de dois mil quadros não estoura o V8 de hoje, mas depende do
 *   tamanho do quadro e do que mais já está na pilha — e um engine puro não
 *   pede desculpa por `RangeError`. A pilha explícita custa duas linhas e não
 *   tem teto.
 *
 * O grafo pode estar DESCONEXO (o `fora` já retirou tiles, ou o mapa foi
 * fabricado à mão por ferramenta): o laço externo visita cada componente, e a
 * articulação é sempre relativa ao componente em que o tile vive — que é
 * exatamente a pergunta certa.
 */
function articulacoes(map: GameMap, fora: Set<number>): Uint8Array {
  const w = map.w;
  const n = w * map.h;
  const arti = new Uint8Array(n);
  const descoberta = new Int32Array(n).fill(-1);
  const baixo = new Int32Array(n);
  const pai = new Int32Array(n).fill(-1);
  /* `pilha` guarda o tile; `proxima`, indexada pelo TILE, guarda a direção de
   * DIRS8 que falta tentar nele. Juntas são o "ponto de retorno" que a recursão
   * guardaria sozinha no quadro. Indexar por tile é seguro porque cada tile
   * entra na pilha no máximo uma vez (só se empilha o não descoberto, e a
   * descoberta é marcada no empilhamento). */
  const pilha = new Int32Array(n);
  const proxima = new Int32Array(n);
  let relogio = 0;

  for (let raiz = 0; raiz < n; raiz++) {
    if (descoberta[raiz] !== -1) continue;
    const rx = raiz % w;
    const ry = (raiz - rx) / w;
    if (!walkable(map, rx, ry) || fora.has(raiz)) continue;

    /* A RAIZ tem regra própria: ela é articulação quando tem DOIS OU MAIS
     * filhos na árvore de DFS (com um só, tudo que pendia dela continua ligado
     * por esse filho). O resto do grafo usa o teste de low-link. */
    let filhosDaRaiz = 0;
    let topo = 0;
    descoberta[raiz] = relogio;
    baixo[raiz] = relogio;
    relogio++;
    pilha[0] = raiz;
    proxima[raiz] = 0;

    while (topo >= 0) {
      const u = pilha[topo];
      if (proxima[u] < DIRS8.length) {
        const d = DIRS8[proxima[u]];
        proxima[u]++;
        const ux = u % w;
        const uy = (u - ux) / w;
        if (!passoLigado(map, fora, ux, uy, d[0], d[1])) continue;
        const v = (uy + d[1]) * w + (ux + d[0]);
        if (v === pai[u]) continue; // a aresta de árvore de volta ao pai
        if (descoberta[v] !== -1) {
          /* Aresta de retorno: o ancestral já visto puxa o low-link para cima
           * na árvore — é ela que prova que existe desvio. */
          if (descoberta[v] < baixo[u]) baixo[u] = descoberta[v];
          continue;
        }
        pai[v] = u;
        descoberta[v] = relogio;
        baixo[v] = relogio;
        relogio++;
        if (u === raiz) filhosDaRaiz++;
        topo++;
        pilha[topo] = v;
        proxima[v] = 0;
        continue;
      }
      /* Esgotou as oito direções: desempilha, devolve o low-link ao pai e
       * decide se o PAI é articulação — nenhum descendente de `u` alcançou algo
       * anterior ao pai, logo tirar o pai isola a subárvore. */
      topo--;
      const p = pai[u];
      if (p === -1) continue;
      if (baixo[u] < baixo[p]) baixo[p] = baixo[u];
      if (p !== raiz && baixo[u] >= descoberta[p]) arti[p] = 1;
    }

    if (filhosDaRaiz > 1) arti[raiz] = 1;
  }
  return arti;
}

/**
 * O guarda-passagem do povoamento: os tiles já fechados por sólido permanente e
 * o mapa de articulações do grafo QUE SOBROU.
 *
 * POR QUE RECALCULAR A CADA PEÇA, e não uma vez só no mapa intacto (que seria
 * um terço do custo): porque a colocação é SEQUENCIAL, e duas peças que
 * sozinhas não são gargalo podem, EM CONJUNTO, estrangular um corredor de
 * largura dois. Medido: com Tarjan calculado uma única vez sobram 176 de 2400
 * andares partidos (7,33%); com Tarjan refeito a cada peça, 0 de 2400.
 *
 * E o zero não é sorte medida, é INDUÇÃO: se G é conexo e t não é articulação
 * de G, então G−t é conexo; refazendo a conta depois de cada retirada, o grafo
 * final é conexo por construção, peça a peça. É essa prova — e não a varredura
 * — que garante o invariante para as sementes que ninguém rodou. T20.1 e T20.2
 * medem 1350 andares e confirmam: nenhum partido, nenhuma escada presa.
 *
 * O PREÇO, medido em 200 andares: `populate` inteiro passou de 0,13..0,30 ms
 * para 3,53 ms por andar — até cinco passes de Tarjan (o mapa intacto e um por
 * peça) mais a BFS do cinto de segurança. Caro em proporção, irrelevante em
 * absoluto: o andar é povoado uma vez por descida, o jogo é por turnos e a
 * alternativa é a partida travada na primeira sala.
 */
interface Passagem {
  /** Tiles fora do grafo: os sólidos permanentes já plantados neste andar. */
  fora: Set<number>;
  /** w*h — 1 no tile cuja retirada PARTIRIA o grafo do passo. */
  arti: Uint8Array;
}

function abrirPassagem(map: GameMap): Passagem {
  const fora = new Set<number>();
  return { fora: fora, arti: articulacoes(map, fora) };
}

/** Fecha o tile para sempre e refaz as articulações do grafo que sobrou. */
function fecharTile(map: GameMap, passagem: Passagem, i: number): void {
  passagem.fora.add(i);
  passagem.arti = articulacoes(map, passagem.fora);
}

/**
 * Alcance do PASSO a partir de `start`, ignorando os tiles de `fora` — mesma
 * vizinhança de `passoLigado`, ou seja, a de `mover`.
 */
function alcancePeloPasso(
  map: GameMap,
  fora: Set<number>,
  start: Point
): { vistos: Uint8Array; total: number } {
  const w = map.w;
  const n = w * map.h;
  const vistos = new Uint8Array(n);
  if (!walkable(map, start.x, start.y)) return { vistos: vistos, total: 0 };
  const si = idx(w, start.x, start.y);
  if (fora.has(si)) return { vistos: vistos, total: 0 };

  const fila = new Int32Array(n);
  let ini = 0;
  let fim = 0;
  vistos[si] = 1;
  fila[fim++] = si;
  let total = 1;
  while (ini < fim) {
    const cur = fila[ini++];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < DIRS8.length; k++) {
      const d = DIRS8[k];
      if (!passoLigado(map, fora, cx, cy, d[0], d[1])) continue;
      const ni = (cy + d[1]) * w + (cx + d[0]);
      if (vistos[ni]) continue;
      vistos[ni] = 1;
      total++;
      fila[fim++] = ni;
    }
  }
  return { vistos: vistos, total: total };
}

/** A instalação da entrada, enquanto ela ainda pode encolher. */
interface Instalacao {
  mercador: Point | null;
  bancada: Point | null;
  extras: Point[];
}

/**
 * CINTO DE SEGURANÇA — nunca entregar um andar partido.
 *
 * Uma BFS ao final, com TODOS os sólidos bloqueados, e a poda da instalação
 * enquanto o andar estiver partido. Na mesma disciplina das checagens de
 * `taken` mais abaixo e do bloqueio explícito de água e vazio em `makeContext`:
 * a trava que continua no código depois de a regra já a tornar desnecessária.
 *
 * E ela É desnecessária hoje, por prova: o filtro incremental de `Passagem`
 * garante por indução que o grafo final é conexo, e em 1350 andares medidos
 * (T20.1 e T20.2) esta BFS nunca teve o que podar — T20.6 fecha a conta pelo
 * outro lado, provando que as poucas peças AUSENTES faltaram por não haver
 * tile seguro, e não por poda. Ela fica porque a garantia depende de TODO
 * sólido novo passar pelo filtro: o dia em que alguém acrescentar um quarto
 * móvel sem lembrar disso, o andar degrada em vez de trancar.
 *
 * A REFERÊNCIA É O ANDAR SEM SÓLIDO NENHUM, e não o total de tiles caminháveis.
 * Comparar com o total seria frágil: um mapa fabricado à mão (ferramenta ou
 * teste) pode ter bolsão inalcançável por terreno, e o cinto começaria a podar
 * peça inocente por culpa do relevo. A pergunta certa é "os sólidos custaram
 * algo ALÉM dos próprios tiles?", e essa não depende do mapa.
 */
function podarAtePassar(map: GameMap, start: Point, inst: Instalacao, taken: Set<number>): void {
  /* Andar sem instalação nenhuma não precisa nem da BFS de referência. */
  if (!inst.mercador && !inst.bancada && inst.extras.length === 0) return;
  const pristino = alcancePeloPasso(map, new Set<number>(), start);
  for (;;) {
    const fora = new Set<number>();
    let ocupados = 0;
    const conta = (p: Point | null): void => {
      if (!p) return;
      const i = idx(map.w, p.x, p.y);
      fora.add(i);
      if (pristino.vistos[i]) ocupados++;
    };
    conta(inst.mercador);
    conta(inst.bancada);
    for (let k = 0; k < inst.extras.length; k++) conta(inst.extras[k]);
    if (fora.size === 0) return;

    const agora = alcancePeloPasso(map, fora, start);
    if (agora.total + ocupados >= pristino.total) return;

    /* PARTIU. A ordem da poda é de custo CRESCENTE para a partida:
     *   1. os EXTRAS, do último para o primeiro — são decoração pura, sem
     *      interação nenhuma (`esbarrar` só narra a estação ao lado), e o andar
     *      não perde sistema algum sem eles;
     *   2. o CALDEIRÃO — a oficina do andar. Cai antes do mercador porque a
     *      estação já degrada por desenho (ela existe com uma peça só) e porque
     *      perder o balcão custa UM sistema, não a economia inteira;
     *   3. o MERCADOR, por último. Ele foi a queixa que criou a fase 2.1 — o
     *      dono jogou uma expedição inteira e não achou o vendedor —, e um
     *      andar sem ele é aquele bug de conteúdo invisível de volta.
     * Nesta ordem os extras nunca sobrevivem ao caldeirão: estante e mesa
     * flutuando sem oficina seriam cenário mentiroso. */
    /* DEVOLVER O TILE A `taken` JUNTO COM A PODA, e não só apagar a peça.
     *
     * `taken` é o conjunto de tiles reservados, e as missões e o despojo da
     * fase 3 rodam DEPOIS deste ponto e o consultam. Podar sem liberar deixaria
     * o tile reservado para uma peça que não existe mais: nada nasceria ali de
     * novo, e o andar perderia conteúdo duas vezes pela mesma poda — uma vez a
     * peça, outra o que ocuparia a vaga.
     *
     * Hoje isto é inalcançável (o filtro de articulação garante que a poda
     * nunca dispara), e é exatamente por isso que precisa estar certo agora: no
     * dia em que o cinto virar a linha de defesa real, ninguém vai lembrar de
     * revisar a contabilidade de `taken`. */
    const liberar = (p: Point | null): void => {
      if (p) taken.delete(idx(map.w, p.x, p.y));
    };
    if (inst.extras.length > 0) {
      liberar(inst.extras.pop() ?? null);
    } else if (inst.bancada) {
      liberar(inst.bancada);
      inst.bancada = null;
    } else {
      liberar(inst.mercador);
      inst.mercador = null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pontos de parada — mercador e estação de alquimia (fase 2 / 2.1)
 * ------------------------------------------------------------------ */

/**
 * Faixa Chebyshev entre as paradas e o INÍCIO do andar.
 *
 * A régua mudou na fase 2.1. Até então o mercador nascia perto da ESCADA e a
 * bancada numa sala qualquer que não fosse a do início: bonito no papel — "o
 * jogador decide o que fazer com a bolsa no instante em que pode descer" — e
 * ruim na mão. O dono jogou uma expedição inteira e não achou o mercador,
 * porque a escada é o FIM do andar, não o começo, e uma oficina escondida em
 * outro cômodo é uma oficina que não existe.
 *
 * Agora os dois nascem no cômodo em que o herói começa. Dois é o mínimo para
 * não colarem no herói (nem bloquearem o primeiro passo); quatro é o máximo
 * para caberem no primeiro campo de visão, que tem raio 9 — quem nasce vê.
 */
const PARADA_DIST_MIN = 2;
const PARADA_DIST_MAX = 4;

/**
 * Quantos tiles de DECORAÇÃO a estação de alquimia ganha ao redor do caldeirão:
 * a estante e a mesa. Dois porque a estação é uma instalação de canto — três
 * peças em L ou em linha —, não um cômodo dentro do cômodo.
 */
export const ALQUIMIA_EXTRAS_MAX = 2;

/**
 * A escolha determinística de um ponto, num lugar só.
 *
 * O contrato é: candidatos coletados em ordem CANÔNICA pelo chamador (índice
 * linear crescente — varredura linha a linha), embaralhados pelo rng de
 * POPULAÇÃO e escolhido o PRIMEIRO do resultado que possa receber sólido. É a
 * mesma disciplina de `distribute`, e é o que faz a colocação depender só da
 * semente: a ordem de entrada não é acidente de iteração, e o sorteio não é
 * `pick` (que consumiria o stream de forma diferente conforme o tamanho da
 * lista... e, pior, deixaria a ordem de entrada invisível na leitura).
 *
 * POR QUE O FILTRO DA PASSAGEM VEM DEPOIS DO EMBARALHO, e não antes. Porque
 * `shuffle` é Fisher–Yates: ele consome um sorteio por posição, então a
 * QUANTIDADE de u32 gastos depende do TAMANHO da lista. Filtrar antes encolhe a
 * lista, muda o consumo e desloca tudo o que vem depois no mesmo stream — as
 * caçadas da fase 3, inclusive —, o que faria um conserto de conectividade
 * mexer em conteúdo que não tem nada a ver com ele. Filtrar depois custa zero
 * u32 e dá EXATAMENTE a mesma distribuição: sortear a lista inteira e pegar o
 * primeiro seguro é o mesmo que sortear só os seguros e pegar o primeiro.
 *
 * Sem nenhum candidato seguro devolve `null`: mapa que não tem onde pôr não
 * inventa ponto — e, desde a fase da passagem, também não tranca o andar para
 * arrumar um.
 */
function escolherParada(rng: Rng, arti: Uint8Array, cand: Candidate[]): Candidate | null {
  if (cand.length === 0) return null;
  rng.shuffle(cand);
  for (let k = 0; k < cand.length; k++) {
    if (!arti[cand[k].i]) return cand[k];
  }
  return null;
}

/** O ponto está dentro da caixa da sala? Sem sala (corredor), tudo vale. */
function naSala(room: Room | null, x: number, y: number): boolean {
  if (!room) return true;
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

/**
 * Tile utilizável pela instalação da entrada (mercador, caldeirão ou extra):
 * caminhável, livre, dentro do escopo (a sala inicial) e fora do anel íntimo do
 * herói.
 *
 * Note que o teto da faixa NÃO é checado aqui: quem o aplica é a varredura de
 * candidatos. É de propósito — um extra é vizinho do caldeirão, então pode cair
 * a cinco tiles do início sem deixar de ser parte da mesma instalação.
 *
 * `taken` já carrega início, escada, todo inimigo e todo item deste andar — é
 * ele que garante "nunca sobre start, escada, item ou inimigo" sem uma segunda
 * varredura das listas.
 *
 * ELEGIBILIDADE, e só ela: esta função responde "o tile SERVE?", não "o tile é
 * SEGURO?". A segurança — o filtro de pontos de articulação — mora em
 * `tileDoSolido`, logo abaixo, e a separação é deliberada: a varredura de
 * candidatos precisa da lista ELEGÍVEL inteira, porque o tamanho dela dirige o
 * consumo de u32 do `shuffle` (o porquê está por extenso em `escolherParada`).
 */
function tileDaEntrada(
  map: GameMap,
  taken: Set<number>,
  start: Point,
  stairs: Point | null,
  escopo: Room | null,
  x: number,
  y: number
): boolean {
  if (!inBounds(map, x, y)) return false;
  if (!walkable(map, x, y)) return false;
  if (!naSala(escopo, x, y)) return false;
  if (cheb(x, y, start.x, start.y) < PARADA_DIST_MIN) return false;
  if (stairs && x === stairs.x && y === stairs.y) return false;
  return !taken.has(idx(map.w, x, y));
}

/**
 * O tile é elegível E não tranca o andar. É a porta única por onde passa TODA
 * peça sólida da instalação — mercador, caldeirão e decoração.
 *
 * R15/R16 estendidos ao povoamento: o gerador garante 100% dos tiles
 * caminháveis conectados, e nenhuma peça nossa tem o direito de desfazer isso.
 * O sólido que um dia for colocado sem passar por aqui é o sólido que vai
 * trancar o andar de novo.
 */
function tileDoSolido(
  map: GameMap,
  taken: Set<number>,
  arti: Uint8Array,
  start: Point,
  stairs: Point | null,
  escopo: Room | null,
  x: number,
  y: number
): boolean {
  if (!tileDaEntrada(map, taken, start, stairs, escopo, x, y)) return false;
  return !arti[idx(map.w, x, y)];
}

/** Tiles elegíveis no anel 2..4 do início, dentro do escopo. Ordem canônica. */
function varrerEntrada(
  map: GameMap,
  taken: Set<number>,
  start: Point,
  stairs: Point | null,
  escopo: Room | null
): Candidate[] {
  const out: Candidate[] = [];
  for (let y = start.y - PARADA_DIST_MAX; y <= start.y + PARADA_DIST_MAX; y++) {
    for (let x = start.x - PARADA_DIST_MAX; x <= start.x + PARADA_DIST_MAX; x++) {
      if (cheb(x, y, start.x, start.y) > PARADA_DIST_MAX) continue;
      if (!tileDaEntrada(map, taken, start, stairs, escopo, x, y)) continue;
      out.push({ x: x, y: y, i: idx(map.w, x, y) });
    }
  }
  return out;
}

/** O escopo efetivo da colocação e os tiles que sobraram dentro dele. */
interface Entrada {
  /** A sala inicial, ou `null` quando a colocação degradou para o anel nu. */
  escopo: Room | null;
  cand: Candidate[];
}

/**
 * Os tiles da ENTRADA do cômodo inicial, com a degradação embutida: primeiro a
 * sala do início; se ela não tiver nenhum tile utilizável no anel (cômodo
 * recortado, tomado por inimigo e item, ou início em corredor), o anel inteiro,
 * sala ou não.
 *
 * Devolve também o escopo EFETIVO, porque é ele que os extras da estação usam
 * para não atravessarem a parede para o cômodo vizinho.
 *
 * A DEGRADAÇÃO É O RAMO PERIGOSO, e é bom que isto esteja escrito: o anel nu
 * inclui CORREDOR, que é gargalo por definição. É por aqui que nascia o pior
 * caso do bug da passagem — sala inicial minúscula, anel nu, três candidatos e
 * os três dentro do mesmo corredor de largura um. O filtro de `tileDoSolido`
 * recusa os três na hora da escolha, e o cômodo fica sem instalação: andar sem
 * mercador é conteúdo a menos, andar trancado é partida perdida.
 *
 * A degradação continua olhando a ELEGIBILIDADE, não a segurança — sala com
 * tiles elegíveis não cai para o anel nu ainda que todos eles tranquem o andar.
 * É de propósito: o anel nu é pior candidato do que a sala em toda dimensão que
 * importa (visibilidade, pertencimento ao cômodo, risco de gargalo), então
 * ampliar a busca por causa da segurança seria trocar um problema por outro.
 */
function entradaDoInicio(
  map: GameMap,
  taken: Set<number>,
  start: Point,
  stairs: Point | null,
  sala: Room | null
): Entrada {
  const dentro = varrerEntrada(map, taken, start, stairs, sala);
  if (dentro.length > 0 || !sala) return { escopo: sala, cand: dentro };
  return { escopo: null, cand: varrerEntrada(map, taken, start, stairs, null) };
}

/**
 * Quantos tiles de DECORAÇÃO uma estação plantada em `caldeirao` COMPORTARIA:
 * até `ALQUIMIA_EXTRAS_MAX` vizinhos ORTOGONAIS livres, na ordem fixa de
 * `DIRS4` e devolvidos em ordem canônica de índice linear.
 *
 * Duas ordens diferentes de propósito: a de ESCOLHA é `DIRS4` (leste, sul,
 * oeste, norte — a mesma tabela que o BFS de conectividade usa), e a de
 * ARMAZENAMENTO é o índice crescente, que é o que faz a lista sair igual no
 * `snapshot()` e no save venha de onde vier. Dois vizinhos ortogonais quaisquer
 * do mesmo tile formam sempre um L ou uma linha — não há terceira forma.
 *
 * Esta é a versão que só CONTA, e serve à nota de `escolherCaldeirao`. Ela lê o
 * `arti` que já está na mão (sem o caldeirão candidato fechado), então a conta
 * é uma ESTIMATIVA — de propósito. Ela vale como PREFERÊNCIA entre candidatos,
 * e refazer Tarjan duas vezes para cada um dos ~24 candidatos do anel custaria
 * trinta vezes o povoamento inteiro para melhorar um desempate estético. Quem
 * planta de verdade é `plantarExtras`, e esse não estima nada.
 */
function extrasDaEstacao(
  map: GameMap,
  taken: Set<number>,
  arti: Uint8Array,
  start: Point,
  stairs: Point | null,
  escopo: Room | null,
  caldeirao: Point
): Candidate[] {
  const out: Candidate[] = [];
  for (let d = 0; d < DIRS4.length && out.length < ALQUIMIA_EXTRAS_MAX; d++) {
    const x = caldeirao.x + DIRS4[d][0];
    const y = caldeirao.y + DIRS4[d][1];
    if (!tileDoSolido(map, taken, arti, start, stairs, escopo, x, y)) continue;
    out.push({ x: x, y: y, i: idx(map.w, x, y) });
  }
  out.sort(function (a, b) { return a.i - b.i; });
  return out;
}

/**
 * Planta a DECORAÇÃO de verdade, mesma ordem de escolha e mesma ordem de
 * armazenamento de `extrasDaEstacao`, com UMA diferença que é o motivo de esta
 * função existir: cada peça aceita é FECHADA NA HORA e o mapa de articulações é
 * refeito antes de a próxima ser considerada.
 *
 * Porque dois tiles que sozinhos não são gargalo podem, juntos, estrangular um
 * corredor de largura dois — e a decoração é o maior ofensor medido do bug
 * original (culpada sozinha em 525 dos 1041 andares partidos, contra 339 do
 * mercador). Estante e mesa são cenário; trancar o andar com cenário seria a
 * pior versão possível deste bug.
 *
 * A varredura é de UMA passada por `DIRS4`, e isso deixa dinheiro na mesa de
 * propósito: um vizinho recusado no começo pode voltar a caber depois que outro
 * extra entrou (o extra que entrou pode ter sido, ele mesmo, o beco que o
 * primeiro isolava). Reexaminar em laço renderia decoração no rabo da
 * distribuição e custaria mais um Tarjan por passada — a estação completa já
 * sai em 89% dos andares (T14.1), e cenário não vale um orçamento a mais.
 */
function plantarExtras(
  map: GameMap,
  taken: Set<number>,
  passagem: Passagem,
  start: Point,
  stairs: Point | null,
  escopo: Room | null,
  caldeirao: Point
): Candidate[] {
  const out: Candidate[] = [];
  for (let d = 0; d < DIRS4.length && out.length < ALQUIMIA_EXTRAS_MAX; d++) {
    const x = caldeirao.x + DIRS4[d][0];
    const y = caldeirao.y + DIRS4[d][1];
    if (!tileDoSolido(map, taken, passagem.arti, start, stairs, escopo, x, y)) continue;
    const i = idx(map.w, x, y);
    out.push({ x: x, y: y, i: i });
    /* Território reservado NA HORA, nos dois sentidos: `taken` é o que impede um
     * despojo futuro de cair dentro da estante, e `fecharTile` tira o tile do
     * grafo antes de o próximo extra ser sequer olhado. */
    taken.add(i);
    fecharTile(map, passagem, i);
  }
  out.sort(function (a, b) { return a.i - b.i; });
  return out;
}

/**
 * Escolhe o CALDEIRÃO — o tile de interação da estação.
 *
 * Não é `escolherParada` porque aqui a peça não vem sozinha: entre os
 * candidatos preferimos o que comporta a INSTALAÇÃO INTEIRA. A nota é
 * `extras × 2 + encostado`, que é ordem lexicográfica escrita como número:
 *   · `extras` (0..2) manda, porque estação de três peças é a decisão de
 *     design — duas e uma são degradação, não alternativa;
 *   · `encostado` (0 ou 1) desempata em favor do tile com parede ortogonal ao
 *     lado, que é o "logo na entrada do cômodo": a instalação fica rente à
 *     borda e o meio do cômodo continua sendo do jogador. Num salão grande
 *     nenhum tile do anel 2..4 encosta em parede, e aí o desempate simplesmente
 *     não opina.
 *
 * O embaralho continua sendo o mesmo de `escolherParada` — um `shuffle` do rng
 * de população — e o `>` (e não `>=`) do laço mantém o PRIMEIRO empatado, isto
 * é, o sorteado. Determinismo pela semente, com preferência estrutural por
 * cima.
 *
 * ATENÇÃO AO `encostado`, que é onde este desempate encontra o bug da passagem:
 * premiar o tile com parede ortogonal ao lado é premiar exatamente onde moram
 * portas e bocas de corredor — a heurística de estética empurra a estação PARA
 * os gargalos. Por isso o gargalo é DESCARTADO no topo do laço, antes de a nota
 * existir: a estética só opina sobre tiles que já provaram não trancar o andar.
 * Pontuar primeiro e filtrar depois seria deixar a estética escolher e a
 * segurança só reclamar.
 *
 * O descarte fica AQUI, e não na varredura de candidatos, pelo motivo de
 * `escolherParada`: encolher a lista antes do `shuffle` mudaria quantos u32 o
 * embaralho consome, e com eles tudo o que vem depois no stream de população.
 * `melhor` começa em `null` justamente porque `cand[0]` pode ser um gargalo.
 */
function escolherCaldeirao(
  rng: Rng,
  map: GameMap,
  taken: Set<number>,
  arti: Uint8Array,
  start: Point,
  stairs: Point | null,
  escopo: Room | null,
  cand: Candidate[]
): Candidate | null {
  if (cand.length === 0) return null;
  rng.shuffle(cand);
  let melhor: Candidate | null = null;
  let melhorNota = -1;
  for (let k = 0; k < cand.length; k++) {
    const c = cand[k];
    if (arti[c.i]) continue;
    const extras = extrasDaEstacao(map, taken, arti, start, stairs, escopo, c).length;
    let encostado = 0;
    for (let d = 0; d < DIRS4.length; d++) {
      if (!walkable(map, c.x + DIRS4[d][0], c.y + DIRS4[d][1])) {
        encostado = 1;
        break;
      }
    }
    const nota = extras * 2 + encostado;
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = c;
    }
  }
  return melhor;
}

export function populate(map: GameMap, depth: number, heroLevel: number): Population {
  const d = depth < 1 ? 1 : depth;
  const rng = makeRng(hash32(map.seed + '#pop#' + d));
  const enemies: Enemy[] = [];
  const items: Item[] = [];

  const nEnemies = Math.min(22, 4 + d * 2);
  const nItems = Math.max(1, 3 + ((d * 7) % 3) - Math.floor(d / 4));

  const rooms = map.rooms || [];
  const start = map.start;
  const stairs: Point | null = map.stairs ?? null;
  if (!rooms.length || !start) {
    return { enemies: enemies, items: items, mercador: null, bancada: null,
      alquimiaExtras: [], missoes: [] };
  }

  /* Um único conjunto de tiles tomados: nada de sobreposição entre inimigos,
   * itens, início ou escada (R23/R24). */
  const taken = new Set<number>();
  taken.add(idx(map.w, start.x, start.y));
  if (stairs) taken.add(idx(map.w, stairs.x, stairs.y));

  const qEnemies = largestRemainder(rooms, nEnemies);
  let nextEnemyId = 1;
  distribute(map, rooms, qEnemies, nEnemies, rng, taken, start, stairs,
    function (x: number, y: number): void {
      // §15 — a MISTURA sai do nível do herói; a profundidade segue endurecendo
      // contagem (acima) e hp/atk (`makeEnemy`).
      const kind = pickKind(rng, heroLevel);
      enemies.push(makeEnemy(nextEnemyId++, kind, x, y, d));
    });

  const qItems = largestRemainder(rooms, nItems);
  let nextItemId = 1;
  distribute(map, rooms, qItems, nItems, rng, taken, start, stairs,
    function (x: number, y: number): void {
      items.push(makeItem(nextItemId++, x, y));
    });

  /* ---------------------------------------------------------------- *
   * Pontos de parada (fase 2) — DEPOIS de inimigos e itens, sempre.
   *
   * A ordem não é estética: colocar as paradas antes deslocaria o consumo do
   * stream de população e mudaria a posição de TODO inimigo e TODO item de
   * TODO andar já gerado — inclusive os do oracle vanilla congelado, que a
   * migração usa para provar paridade. Vindo por último, a fase 1 continua
   * saindo byte a byte igual e as paradas só acrescentam.
   *
   * COMO A ESTAÇÃO NÃO PISA EM NINGUÉM, sem inverter a ordem (fase 2.1): as
   * paradas só se candidatam a tiles que já estão livres — `taken` carrega
   * inimigos e itens quando esta seção começa —, e por isso NADA aqui remove
   * nem move item nenhum; o consumo do rng de inimigos e itens fica intocado, e
   * a fase 1 continua byte a byte igual. O anel 2..4 do início, aliás, é livre
   * por construção: `roomCandidates` recusa tudo a Chebyshev ≤ SAFE_RADIUS (6)
   * do início, então a instalação inteira — caldeirão, extras a cinco tiles
   * inclusive — nasce dentro de um raio onde inimigo e item nunca caem. As
   * checagens de `taken` continuam no código como cinto de segurança: no dia em
   * que o raio seguro encolher, a colocação degrada sozinha em vez de sobrepor.
   *
   * A contrapartida honesta: por virem depois dos inimigos, os pontos também
   * dependem do nível do herói no instante em que o andar foi povoado (é ele
   * que dirige `pickKind`, e `rng.int` consome um número variável de u32).
   * Continua determinístico — mesma semente, mesma profundidade e mesmo nível
   * dão sempre os mesmos pontos — e o save carrega os pontos escolhidos, então
   * nada disso é observável numa retomada.
   * ---------------------------------------------------------------- */
  const salaInicial = roomAt(map, start.x, start.y);

  /* A PASSAGEM abre aqui e acompanha as três peças: cada uma escolhe num grafo
   * que já perdeu as anteriores. Ver a seção "A PASSAGEM" no topo do módulo —
   * este é o objeto que impede o povoamento de trancar o andar. */
  const passagem = abrirPassagem(map);

  let mercador: Point | null = null;
  const entradaMercador = entradaDoInicio(map, taken, start, stairs, salaInicial);
  const escolhido = escolherParada(rng, passagem.arti, entradaMercador.cand);
  if (escolhido) {
    mercador = { x: escolhido.x, y: escolhido.y };
    /* Reservado nos dois sentidos: `taken` para a estação não nascer em cima do
     * mercador, `fecharTile` para o caldeirão ser sorteado já contando com o
     * corpo dele no caminho. */
    taken.add(escolhido.i);
    fecharTile(map, passagem, escolhido.i);
  }

  /* A estação vem depois do mercador e enxerga o tile dele já tomado — é o
   * desempate que a interface documenta ("populate reserva o tile do mercador
   * ANTES de sortear a bancada"), e o que garante que os dois nunca coincidem. */
  const entradaEstacao = entradaDoInicio(map, taken, start, stairs, salaInicial);
  const caldeirao = escolherCaldeirao(rng, map, taken, passagem.arti, start, stairs,
    entradaEstacao.escopo, entradaEstacao.cand);
  let bancada: Point | null = null;
  const alquimiaExtras: Point[] = [];
  if (caldeirao) {
    bancada = { x: caldeirao.x, y: caldeirao.y };
    taken.add(caldeirao.i);
    fecharTile(map, passagem, caldeirao.i);
    const extras = plantarExtras(map, taken, passagem, start, stairs,
      entradaEstacao.escopo, caldeirao);
    for (let k = 0; k < extras.length; k++) {
      alquimiaExtras.push({ x: extras[k].x, y: extras[k].y });
    }
  }

  /* O cinto de segurança, depois de a instalação inteira estar de pé. Não deve
   * podar nada — o filtro incremental já garante o andar conexo por indução —,
   * e é justamente por isso que ele fica: é a trava que sobra para o dia em que
   * um sólido novo entrar por outra porta. */
  const instalacao: Instalacao = {
    mercador: mercador,
    bancada: bancada,
    extras: alquimiaExtras
  };
  podarAtePassar(map, start, instalacao, taken);
  mercador = instalacao.mercador;
  bancada = instalacao.bancada;

  /* ---------------------------------------------------------------- *
   * Missões (fase 3) — depois de TUDO, sempre.
   *
   * Última por disciplina de stream, não por importância: gerar as caçadas
   * aqui mantém o consumo do rng de população das fases 1 e 2 INTACTO — todo
   * inimigo, item, mercador e estação de todo andar já gerado continua saindo
   * no mesmo tile, e o custo da fase 3 no oracle é só o acréscimo do campo
   * novo (a mesma contabilidade que as paradas fizeram em relação à fase 1).
   * ---------------------------------------------------------------- */
  const missoes = gerarMissoes(rng);

  return {
    enemies: enemies,
    items: items,
    mercador: mercador,
    bancada: bancada,
    alquimiaExtras: alquimiaExtras,
    missoes: missoes
  };
}

/* ------------------------------------------------------------------ *
 * Contexto de turno
 * ------------------------------------------------------------------ */

export function makeContext(game: Game): TurnContext {
  const map = game.map;
  const occupied = new Set<number>();
  occupied.add(idx(map.w, game.player.x, game.player.y));
  /* Móvel e NPC são sólidos também para os inimigos: nenhum monstro termina o
   * turno em cima do mercador nem da mobília da estação. O campo de Dijkstra
   * em si não muda ({ blocked: null } continua — recalculá-lo por turno é o
   * custo que a arquitetura evita); o bloqueio é só na escolha do passo. */
  if (game.mercador) occupied.add(idx(map.w, game.mercador.x, game.mercador.y));
  if (game.bancada) occupied.add(idx(map.w, game.bancada.x, game.bancada.y));
  const extras = game.alquimiaExtras;
  if (extras) {
    for (let i = 0; i < extras.length; i++) {
      occupied.add(idx(map.w, extras[i].x, extras[i].y));
    }
  }
  /* Água e vazio entram no `occupied` como as paradas (decisão do dono, fase
   * do penhasco): os dois tiles BLOQUEIAM o passo dos inimigos. A recusa já
   * viria de `isWalkable` — o campo de Dijkstra (blocked: null, sempre) e o
   * `makeBlocker` a consultam —, então este bloco é a trava explícita, na
   * mesma disciplina de cinto e segurança das paradas: o dia em que alguém
   * alargar `isWalkable`, o monstro continua fora da poça e do precipício.
   * `moveTo` nunca remove estes índices porque nenhum inimigo está sobre eles
   * (populate e restore já os excluem pela mesma `isWalkable`). */
  const tiles = map.tiles;
  const agua = map.agua;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Void || (agua && agua[i])) occupied.add(i);
  }
  const alive: Enemy[] = [];
  for (let i = 0; i < game.enemies.length; i++) {
    const e = game.enemies[i];
    if (!e || e.hp <= 0) continue;
    alive.push(e);
    occupied.add(idx(map.w, e.x, e.y));
  }
  alive.sort(function (a, b) { return a.id - b.id; });
  return {
    map: map,
    occupied: occupied,
    dmap: dmapOf(game),
    fleeMap: null,
    alive: alive
  };
}

/* ------------------------------------------------------------------ *
 * IA — todos os arquétipos leem o MESMO game.dmap
 * ------------------------------------------------------------------ */

/* Fuga por ferimento (R36): sobe o gradiente invertido, ou seja, desce o
 * mapa de fuga produzido por `fleeMap` do Dijkstra. */
function fleeBehaviour(game: Game, ent: Enemy, ctx: TurnContext): void {
  const arch = archOf(ent.kind);
  if (ent.state !== 'flee') {
    say(game, Art(arch) + ' ' + arch.nome + ' foge ferid' + art(arch) + '.', 'aviso');
  }
  ent.state = 'flee';
  const step = gradientStep(ent, ctx, fleeMapOf(game, ctx));
  if (step) {
    ent.plan = 'foge para (' + step.x + ',' + step.y + ')';
    return;
  }
  /* Encurralado: ainda revida se o jogador estiver ao alcance. */
  const p = game.player;
  const dist = cheb(ent.x, ent.y, p.x, p.y);
  const ranged = ent.range > 1;
  const canHit = dist <= Math.max(1, ent.range) &&
    (!ranged || hasLOS(ctx.map, ent.x, ent.y, p.x, p.y, Math.max(ent.range, CONFIG.FOV_RADIUS)));
  if (canHit) {
    attackPlayerInterno(game, ent, ranged);
    ent.state = 'flee';
    ent.plan = 'ataca encurralado';
    return;
  }
  ent.plan = 'encurralado, sem saída';
}

/* R37 — Perseguidor: desce o gradiente e bate corpo a corpo. */
export function aiChaser(game: Game, ent: Enemy, ctx?: TurnContext): void {
  const c = ctx || makeContext(game);
  if (isWounded(ent)) return fleeBehaviour(game, ent, c);
  const p = game.player;
  const dist = cheb(ent.x, ent.y, p.x, p.y);
  if (dist <= Math.max(1, ent.range)) {
    attackPlayerInterno(game, ent, false);
    return;
  }
  setState(game, ent, 'hunt', null);
  const step = gradientStep(ent, c, c.dmap);
  if (step) {
    ent.plan = 'avança para (' + step.x + ',' + step.y + ')';
  } else {
    ent.state = 'wait';
    ent.plan = 'aguarda passagem';
  }
}

/* R38 — Brutamontes: desce o gradiente e esmaga corpo a corpo com a marreta.
 * Mesma estrutura do Perseguidor — sem recuo tático, sem tiro à distância. */
export function aiSentinel(game: Game, ent: Enemy, ctx?: TurnContext): void {
  const c = ctx || makeContext(game);
  if (isWounded(ent)) return fleeBehaviour(game, ent, c);
  const p = game.player;
  const dist = cheb(ent.x, ent.y, p.x, p.y);
  if (dist <= Math.max(1, ent.range)) {
    attackPlayerInterno(game, ent, false);
    return;
  }
  setState(game, ent, 'hunt', null);
  const step = gradientStep(ent, c, c.dmap);
  if (step) {
    ent.plan = 'avança para (' + step.x + ',' + step.y + ')';
  } else {
    ent.state = 'wait';
    ent.plan = 'aguarda passagem';
  }
}

/* Há outro inimigo vivo colado no jogador neste instante? */
function allyAdjacentToPlayer(game: Game, ent: Enemy): boolean {
  const p = game.player;
  for (let i = 0; i < game.enemies.length; i++) {
    const o = game.enemies[i];
    if (!o || o === ent || o.id === ent.id) continue;
    if (o.hp <= 0) continue;
    if (cheb(o.x, o.y, p.x, p.y) <= 1) return true;
  }
  return false;
}

/* Circula mantendo a faixa 2–3 do jogador, no sentido determinado pelo id
 * (par gira em um sentido, ímpar no outro) — determinístico. */
function circleStep(game: Game, ent: Enemy, ctx: TurnContext): Point | null {
  const p = game.player;
  const map = ctx.map;
  const vx = ent.x - p.x;
  const vy = ent.y - p.y;
  const sense = (ent.id % 2 === 0) ? 1 : -1;
  const px = -vy * sense;
  const py = vx * sense;
  const blocked = makeBlocker(map, ctx.occupied, ent.x, ent.y);
  let best: Point | null = null;
  let bestScore = 0;
  for (let d = 0; d < DIRS8.length; d++) {
    const nx = ent.x + DIRS8[d][0];
    const ny = ent.y + DIRS8[d][1];
    if (!inBounds(map, nx, ny)) continue;
    if (blocked(nx, ny)) continue;
    const dist = cheb(nx, ny, p.x, p.y);
    if (dist < LINK_MIN || dist > LINK_MAX) continue;
    const score = DIRS8[d][0] * px + DIRS8[d][1] * py;
    if (score > bestScore) {
      bestScore = score;
      best = { x: nx, y: ny };
    }
  }
  if (!best) return null;
  moveTo(ctx, ent, best.x, best.y);
  return best;
}

/* R39 — Vinculador: só parte para o ataque com outro inimigo adjacente ao
 * jogador; caso contrário circula a 2–3 tiles aguardando o aliado. */
export function aiLinker(game: Game, ent: Enemy, ctx?: TurnContext): void {
  const c = ctx || makeContext(game);
  if (isWounded(ent)) return fleeBehaviour(game, ent, c);
  const p = game.player;
  const arch = archOf(ent.kind);
  const dist = cheb(ent.x, ent.y, p.x, p.y);

  if (allyAdjacentToPlayer(game, ent)) {
    if (dist <= Math.max(1, ent.range)) {
      attackPlayerInterno(game, ent, ent.range > 1);
      return;
    }
    setState(game, ent, 'hunt', Art(arch) + ' ' + arch.nome + ' avança com o aliado.', 'aviso');
    const step = gradientStep(ent, c, c.dmap);
    if (step) {
      ent.plan = 'avança para (' + step.x + ',' + step.y + ')';
    } else {
      ent.state = 'wait';
      ent.plan = 'aguarda passagem';
    }
    return;
  }

  setState(game, ent, 'wait', Art(arch) + ' ' + arch.nome + ' aguarda um aliado.', 'aviso');
  if (dist < LINK_MIN) {
    const back = gradientStep(ent, c, fleeMapOf(game, c));
    ent.plan = back ? 'afasta-se e aguarda aliado' : 'aguarda aliado';
    return;
  }
  if (dist > LINK_MAX) {
    const near = gradientStep(ent, c, c.dmap);
    ent.plan = near ? 'ronda aguardando aliado' : 'aguarda aliado';
    return;
  }
  const circ = circleStep(game, ent, c);
  ent.plan = circ ? 'circula à espreita' : 'aguarda aliado';
}

type AiFn = (game: Game, ent: Enemy, ctx: TurnContext) => void;

export const AI: Record<ArchetypeKey, AiFn> = {
  chaser: aiChaser,
  sentinel: aiSentinel,
  linker: aiLinker
};

/* ------------------------------------------------------------------ *
 * Turno dos inimigos
 * ------------------------------------------------------------------ */

export function processEnemies(game: Game): void {
  if (!game || !game.map || !game.player || !game.enemies) return;
  if (game.over || game.player.hp <= 0) return;

  const ctx = makeContext(game);
  const alive = ctx.alive; /* já ordenado por id crescente */

  for (let i = 0; i < alive.length; i++) {
    const ent = alive[i];
    if (ent.hp <= 0) continue;
    if (game.over || game.player.hp <= 0) break;
    const fn = AI[ent.kind] ?? AI.chaser;
    fn(game, ent, ctx);
  }
}

/* ------------------------------------------------------------------ *
 * Consultas auxiliares
 * ------------------------------------------------------------------ */

export function enemyAt(game: Game, x: number, y: number): Enemy | null {
  for (let i = 0; i < game.enemies.length; i++) {
    const e = game.enemies[i];
    if (e && e.hp > 0 && e.x === x && e.y === y) return e;
  }
  return null;
}

/**
 * Primeiro item do tile na ordem de `game.items`.
 *
 * Com os despojos os itens EMPILHAM (vários no mesmo tile), então isto é uma
 * sonda de "há algo aqui?", não a lista completa — quem recolhe é `pegarItem`
 * em game.ts, que varre todos.
 */
export function itemAt(game: Game, x: number, y: number): Item | null {
  for (let i = 0; i < game.items.length; i++) {
    const it = game.items[i];
    if (it && it.x === x && it.y === y) return it;
  }
  return null;
}

export function stateLabel(state: EnemyState): string {
  return STATE_LABEL[state] ?? 'ocioso';
}
