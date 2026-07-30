/*
 * ISOROGUE — src/engine/types.ts
 *
 * Tipos compartilhados do domínio. Porte 1:1 de docs/ARQUITETURA-REACT.md §3 e
 * docs/CONTRACTS.md (§2..§9), a partir de legacy/src-vanilla/*.js.
 *
 * Regras que este módulo carrega:
 *   - Nome de campo é CONTRATO. Nada aqui pode ser renomeado, traduzido ou
 *     "melhorado": `snapshot()`, o save em localStorage e o golden test
 *     dependem dos nomes exatos.
 *   - Só tipos. Uma única declaração emite runtime (`const enum Tile`), e ela
 *     existe porque docs/ARQUITETURA-REACT.md §3 a exige literalmente.
 *   - Sem imports: este é o nó raiz do grafo de dependências do engine.
 */

/* ------------------------------------------------------------------ *
 * 1. Grade e geometria
 * ------------------------------------------------------------------ */

/** Valores possíveis de `map.tiles`. Espelha `R.C.TILE` do vanilla. */
export const enum Tile {
  Wall = 0,
  Floor = 1,
  Door = 2,
  Stairs = 3
}

/** Par (x, y) em coordenadas de grade. Nunca em pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Vetor de direção `[dx, dy]` das tabelas DIRS8/DIRS4.
 * `readonly` de propósito: a ORDEM e o CONTEÚDO de DIRS8 são determinismo puro
 * (desempate do Dijkstra e da IA). Quem precisar de cópia mutável que copie.
 */
export type Dir = readonly [number, number];

/* ------------------------------------------------------------------ *
 * 2. RNG (implementado em rng.ts)
 * ------------------------------------------------------------------ */

/**
 * Gerador mulberry32 determinístico. O estado inteiro é `s` (uint32):
 * salvar/restaurar o RNG é copiar esse número, nada mais.
 */
export interface Rng {
  /** Estado uint32. Único dado serializável do gerador. */
  s: number;
  /** Próximo uint32 da sequência; avança o estado exatamente um passo. */
  u32(): number;
  /** Float em [0, 1). */
  next(): number;
  /** Inteiro em [a, b] — INCLUSIVO nos dois extremos. */
  int(a: number, b: number): number;
  /** Float em [a, b). */
  float(a: number, b: number): number;
  /** Elemento aleatório; `undefined` se vazio/inválido. */
  pick<T>(arr: readonly T[] | null | undefined): T | undefined;
  /** Fisher–Yates in place; devolve o PRÓPRIO array. */
  shuffle<T>(arr: T[]): T[];
  /** `true` com probabilidade p. Consome sempre exatamente um u32. */
  chance(p: number): boolean;
  /** Sub-stream derivado; avança o pai exatamente um u32. */
  fork(tag: string): Rng;
}

/**
 * Fonte de bytes para `newSeedString`. Injetável só para teste — em produção é
 * `crypto.getRandomValues`, o ÚNICO ponto de entropia real do projeto.
 */
export type RandomBytes = (n: number) => Uint8Array;

/* ------------------------------------------------------------------ *
 * 3. Mapa (mapgen.ts)
 * ------------------------------------------------------------------ */

export type RoomShape = 'rect' | 'cross' | 'round' | 'pillared' | 'notched';

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  area: number;
  shape: RoomShape;
}

export interface GameMap {
  /** Semente já normalizada. */
  seed: string;
  /** Profundidade 1-based. */
  depth: number;
  w: number;
  h: number;
  /** w*h valores de `Tile`. */
  tiles: Uint8Array;
  /** w*h, 0..255 — variação visual determinística. */
  decor: Uint8Array;
  rooms: Room[];
  start: Point;
  stairs: Point;
  /** 0..1 — fração de tiles caminháveis alcançáveis a partir de `start`. */
  connectivity: number;
  walkable: number;
  regenerations: number;
  repairs: number;
  /** Mensagens em pt-BR destinadas ao registro. */
  notes: string[];
}

/** Retorno de `regions(map)` — rotulagem de componentes conexos. */
export interface RegionsResult {
  /** w*h; -1 em parede. */
  labels: Int32Array;
  count: number;
  sizes: number[];
}

/* ------------------------------------------------------------------ *
 * 4. Campo de visão (fov.ts)
 * ------------------------------------------------------------------ */

/**
 * Sonda de simetria (tecla V). `broken` lista tiles CAMINHÁVEIS visíveis da
 * origem que não enxergam de volta — paredes são ignoradas de propósito.
 */
export interface FovSymmetryReport {
  tested: number;
  broken: Point[];
  ok: boolean;
}

/* ------------------------------------------------------------------ *
 * 5. Dijkstra (dijkstra.ts)
 * ------------------------------------------------------------------ */

/** Origem do campo de Dijkstra; `v` é o valor inicial (padrão 0). */
export interface DijkstraSource {
  x: number;
  y: number;
  v?: number;
}

export interface DijkstraOptions {
  /** Índices intransponíveis. Outros inimigos NÃO entram aqui (contrato §5). */
  blocked?: Set<number> | null;
  /** Buffer do chamador, reaproveitado quando o tamanho bate. */
  out?: Int32Array | null;
  /** `false` força alocação de um campo novo. */
  reuse?: boolean;
}

export interface DijkstraScanOptions {
  blocked?: Set<number> | null;
  maxPasses?: number;
}

/** Vizinho escolhido por `bestStep`. */
export interface Step {
  x: number;
  y: number;
  v: number;
}

/** Predicado de bloqueio de `bestStep`: truthy = proibido. */
export type IsBlockedFn = (x: number, y: number, i: number) => boolean;

/* ------------------------------------------------------------------ *
 * 6. Entidades (entities.ts)
 * ------------------------------------------------------------------ */

export type ArchetypeKey = 'chaser' | 'sentinel' | 'linker';

export type EnemyState = 'idle' | 'hunt' | 'flee' | 'attack' | 'wait';

/** Dica de desenho lida pelo render; não participa da lógica. */
export type ArchetypeShape = 'triangulo' | 'hexagono' | 'duplo-losango';

/**
 * Definição fixa de arquétipo (`R.Ent.ARCH`). `fem` é o gênero gramatical do
 * nome em pt-BR — o registro concorda artigo e particípio por ele.
 *
 * `nivel` é o nível do monstro na escala de balanceamento (§15 do
 * BESTIARIO): Slime 1, Goblin 2, Ogro 3. É ele que dirige o XP do abate
 * (100 × 2^(nivelMonstro − nivelHeroi), cortado a zero quando o herói passa
 * três níveis) e a tabela de spawn, que desloca a mistura conforme o nível
 * do herói.
 */
export interface Archetype {
  key: ArchetypeKey;
  nome: string;
  fem: boolean;
  hp: number;
  atk: number;
  range: number;
  /** Distância preferida. */
  ideal: number;
  cor: string;
  corDetalhe: string;
  forma: ArchetypeShape;
  /** Nível do monstro na escala de XP e de spawn (§15 do BESTIARIO). */
  nivel: number;
  desc: string;
}

export interface Enemy {
  id: number;
  kind: ArchetypeKey;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  range: number;
  state: EnemyState;
  /** Descrição curta em pt-BR da ação planejada (tooltip). */
  plan: string;
  lastDmg: number;
  /** 0..1 — APENAS animação. */
  bump: number;
}

/**
 * Tipos de item que existem no chão da masmorra (tabela `ITENS`, entities.ts).
 *
 * `'potion'` é CONTRATO ANTIGO (R7) e não se mexe: continua sendo o consumível
 * fungível que vira `player.potions`, com `heal = POTION_HEAL`. Os demais são
 * os despojos da fase 1 — MATERIAIS, que vão para a bolsa do jogador e um dia
 * (fase 2) para o mercador.
 *
 * A chave é em camelCase e em pt-BR de propósito: ela viaja no save e no
 * `snapshot()`, então é nome de contrato, não rótulo de tela. O nome exibido
 * mora em `ITENS[kind].nome`.
 */
export type ItemKind =
  | 'potion'
  | 'gosma'
  | 'orelhaGoblin'
  | 'espadaGoblin'
  | 'peOgro'
  | 'clavaOgro';

/**
 * Todo item que NÃO é a poção. Nasce como `Exclude<...>` em vez de uma lista
 * nova para que acrescentar um tipo em `ItemKind` já o torne material sem
 * ninguém precisar lembrar de editar dois lugares — e para que o compilador
 * proíba, de graça, que `'potion'` acabe dentro da bolsa (§4 dos despojos).
 */
export type MaterialKind = Exclude<ItemKind, 'potion'>;

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  /**
   * Cura em pontos de vida. Só a poção usa (POTION_HEAL); material carrega 0.
   * O campo continua OBRIGATÓRIO porque `SavedItem` (§8) já o grava desde a
   * primeira versão do save — tirá-lo seria quebrar o formato por estética.
   */
  heal: number;
}

/**
 * A BOLSA: contador de materiais do jogador.
 *
 * Escolha de tipo (pedido explícito de documentação): objeto ABERTO
 * `Partial<Record<MaterialKind, number>>`, não um objeto fechado com todos os
 * contadores em zero. Três razões, nesta ordem:
 *   1. serializa sozinho — é JSON puro, sem Map/Set, e o save só carrega o que
 *      o jogador de fato tem;
 *   2. somar é uma linha (`bag[k] = (bag[k] || 0) + n`), e a ausência já
 *      significa zero;
 *   3. um objeto fechado obrigaria a inicializar (e migrar) todas as chaves a
 *      cada tipo novo de material, e ainda assim não impediria ninguém de
 *      escrever `bag.potion`.
 *
 * O preço é que a ORDEM das chaves de um objeto aberto é acidental — por isso
 * ninguém aqui usa `Object.keys` para ler a bolsa: `snapshot()`, o save e o
 * registro varrem `ITEM_KINDS` (ordem fixa da tabela `ITENS`).
 *
 * Sem limite de capacidade nesta fase.
 */
export type Bag = Partial<Record<MaterialKind, number>>;

/**
 * As receitas da OFICINA (fase 2). Chave em pt-BR e sem acento porque ela viaja
 * na forma textual do comando (`'criar:pocao'`), que é protocolo do oracle — o
 * nome exibido mora em `RECEITAS[key].nome`.
 *
 *  · `pocao`  — alquimia: gosma vira poção de cura;
 *  · `refino` — bigorna: cimitarras viram um degrau de arma.
 *
 * As duas moram no MESMO ponto do mapa (a bancada). São dois ofícios, não dois
 * móveis: separar em dois tiles dobraria a colocação determinística e a
 * superfície de teste sem mudar uma vírgula da decisão do jogador.
 */
export type ReceitaKind = 'pocao' | 'refino';

/**
 * Custo de uma receita em materiais. É o MESMO formato da bolsa de propósito:
 * é assim que `faltasDaReceita(bag, custo)` compara os dois lado a lado sem
 * conversão nenhuma, e é o compilador (não a disciplina de quem escreve) que
 * proíbe uma receita cobrar `'potion'`.
 */
export type CustoReceita = Partial<Record<MaterialKind, number>>;

/** Retorno de `populate(map, depth, heroLevel)`. */
export interface Population {
  enemies: Enemy[];
  items: Item[];
  /**
   * Os dois pontos de parada do andar (fase 2), ou `null` quando o mapa não
   * ofereceu tile elegível. Saem daqui, e não de `generate`, porque dependem de
   * onde inimigos e itens caíram — nenhum dos dois pode ficar embaixo deles.
   */
  mercador: Point | null;
  bancada: Point | null;
}

/**
 * Um abate para efeito visual — o flutuante de XP de §16 do BESTIARIO.
 * Escrito pelo engine em `atacarInimigo` (o único lugar onde o XP do abate é
 * conhecido com o nível CERTO do herói, antes do level-up que o golpe pode
 * causar) e DRENADO pelo renderer a cada quadro.
 *
 * APENAS ANIMAÇÃO — mesmo estatuto do `bump` dos inimigos e do `facing` do
 * jogador: nenhuma regra de jogo o lê, ele NÃO entra em `snapshot()`, NÃO
 * entra no save e NÃO pode chegar ao oracle do golden.
 */
export interface AbateVisual {
  x: number;
  y: number;
  kind: ArchetypeKey;
  /** O XP que o abate rendeu (0 quando a escala cortou — o renderer não mostra). */
  xp: number;
}

/* ------------------------------------------------------------------ *
 * 7. Estado do jogo (game.ts)
 * ------------------------------------------------------------------ */

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  potions: number;
  level: number;
  xp: number;
  /**
   * A bolsa de materiais (fase 1 dos despojos). Atravessa os níveis: é do
   * JOGADOR, não do andar — `descend` não a toca.
   *
   * A poção NÃO entra aqui: ela continua em `potions`, pelo contrato antigo
   * (R7). O tipo `Bag` só aceita `MaterialKind`, então isso é garantido pelo
   * compilador, não pela disciplina de quem escreve.
   */
  bag: Bag;
  /**
   * A bolsa de MOEDAS (fase 2). Inteiro, começa em 0 e só cresce vendendo ou
   * cai comprando — não há moeda no chão da masmorra nesta fase.
   *
   * Mesmo estatuto da bolsa de materiais: é do JOGADOR, atravessa a descida
   * (`descend` não a toca) e entra em `snapshot()` e no save.
   */
  moedas: number;
  /**
   * Degraus de REFINO já aplicados à arma (fase 2). Começa em 0, teto em
   * `ARMA_NIVEL_MAX`, e cada degrau soma +1 permanente em `atk`.
   *
   * Guardamos o CONTADOR e não só o `atk` porque o teto precisa de memória: sem
   * ele não há como distinguir um ataque alto vindo de nível de experiência de
   * um vindo da bigorna, e o limite de cinco refinos viraria letra morta.
   */
  armaNivel: number;
  /**
   * Para onde o personagem OLHA: índice 0..7 em `DIRS8` (core.ts), na ordem
   * fixa daquela tabela. Começa em `DEFAULT_FACING` (2 = sul do grid).
   *
   * APENAS ANIMAÇÃO — mesmo estatuto do `bump` dos inimigos (§5.1 do
   * docs/PERSONAGEM.md). Nenhuma regra de jogo o lê, ele NÃO entra em
   * `snapshot()` e NÃO pode chegar ao oracle do golden. Quem o escreve é
   * `applyCommand`, e só em comando de movimento.
   */
  facing: number;
}

export interface Stats {
  turns: number;
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  itemsUsed: number;
  deepest: number;
  explorePct: number;
}

export type LogClass = 'info' | 'bom' | 'ruim' | 'aviso' | 'sistema';

export interface LogEntry {
  turn: number;
  text: string;
  cls: LogClass;
}

/** Estado de interface guardado dentro do jogo (não é estado de React). */
export interface GameUi {
  hover: Point | null;
  debug: boolean;
  fovProbe: boolean;
  follow: boolean;
}

/**
 * O estado mutável e de vida longa do jogo. NUNCA entra em `useState`, nunca é
 * clonado por spread, nunca é congelado (docs/ARQUITETURA-REACT.md §0).
 */
export interface Game {
  seedStr: string;
  depth: number;
  turn: number;
  over: boolean;
  /** Causa da morte, em pt-BR. */
  cause: string;
  /** Arquétipo do golpe fatal — gravado pelas entidades no instante do golpe. */
  causeKind: ArchetypeKey | '';
  map: GameMap;
  player: Player;
  /**
   * O MERCADOR do andar — onde `vender` e `comprar` são aceitos. `null` quando
   * o mapa não ofereceu tile elegível (ver `populate`).
   *
   * DECISÃO DE MODELAGEM (fase 2): os dois pontos de parada são estado do
   * JOGO, não um valor novo em `Tile`. Três razões, nesta ordem:
   *   1. o mapa NÃO é serializado — ele é regerado por seed+depth no restore
   *      (CONTRACTS.md §9); um tile novo teria de nascer da geração, e a
   *      geração não conhece inimigos nem itens, que é justamente o que a
   *      colocação precisa evitar;
   *   2. `snapshot()` fecha com o checksum de `map.tiles`; mexer no conteúdo
   *      dos tiles mudaria o checksum de todo andar e misturaria "o mapa é
   *      outro" com "o mercador está em outro lugar" numa única evidência;
   *   3. render, FOV, Dijkstra e caminhabilidade leem `Tile` num switch cada:
   *      um valor novo obrigaria todos a decidir o que fazer com ele, quando o
   *      ponto de parada é chão comum com uma pessoa em cima.
   *
   * O preço é que o ponto viaja no save — e é o que fazemos, com validação e
   * degradação tolerante (ver `SaveData`).
   */
  mercador: Point | null;
  /** A BANCADA do andar (alquimia + refino no mesmo ponto). Ver `mercador`. */
  bancada: Point | null;
  enemies: Enemy[];
  items: Item[];
  /**
   * Próximo `id` a ser dado a um item CRIADO EM PARTIDA (despojo de abate).
   *
   * Por que um contador no estado, e não `max(id) + 1` na hora: `max(id) + 1`
   * é calculado sobre os itens que ainda estão NO CHÃO, então recolher o item
   * de maior id faz o próximo drop reaproveitar aquele número. Ids reciclados
   * não quebram regra nenhuma (o id só ordena `snapshot()` e identifica o item
   * para o render), mas tornam a leitura de um registro de partida ambígua —
   * "item 7" passaria a significar duas coisas. Um contador monotônico custa um
   * número e acaba com o assunto.
   *
   * Inicializado logo APÓS `populate` (que numera de 1 até N) como N+1, tanto
   * em `createState` quanto em `descend`. É serializado no save; um save antigo
   * que não o traga é reconstruído como `max(id) + 1` dos itens restaurados —
   * degradação tolerada, nunca colisão.
   */
  proxItemId: number;
  dmap: Int32Array;
  fleeMap: Int32Array | null;
  /** Buffer reaproveitado pelo cálculo do `dmap`. Nunca lido como dado. */
  dbuf: Int32Array | null;
  /** Índices y*w+x visíveis neste turno. */
  visible: Set<number>;
  /** w*h; 1 = já visto alguma vez. */
  explored: Uint8Array;
  /** Stream dedicado ao combate — a espinha do determinismo de partida. */
  rngCombat: Rng;
  /**
   * Stream dedicado aos DESPOJOS, separado de `rngCombat` por necessidade, não
   * por organização: se o loot sorteasse do mesmo stream, o dano do próximo
   * golpe passaria a depender da sorte do abate anterior — a mesma sequência de
   * comandos daria partidas diferentes conforme o que caiu no chão.
   *
   * Semeado com `hash32(seed + '#loot' + depth)`, no mesmo padrão de
   * `rngCombat`, e RESSEMEADO a cada `descend` (andar novo, sorte nova).
   */
  rngLoot: Rng;
  log: LogEntry[];
  stats: Stats;
  ui: GameUi;
  /** Sala em que o jogador está (log de movimentação, R49). */
  lastRoomId: number | null;
  /** Trava de reentrância do fim de turno. */
  emTurno: boolean;
  /**
   * Fila de abates para efeito visual (ver `AbateVisual`). APENAS ANIMAÇÃO:
   * o renderer a drena a cada quadro; fora dele (testes, oracle headless) ela
   * só acumula até o teto de segurança — nunca cresce sem bound.
   */
  abatesRecentes: AbateVisual[];
}

/**
 * Comando do jogador.
 *
 * ÚNICA mudança deliberada de representação em relação ao vanilla
 * (docs/ARQUITETURA-REACT.md §3): a string `'move:1,-1'` virou união
 * discriminada. `parseCommand`/`formatCommand` em core.ts fazem a ponte com as
 * sequências gravadas no golden.
 *
 * Os três comandos de ECONOMIA (fase 2) nasceram já com forma textual, pela
 * mesma razão: o protocolo do oracle é texto.
 *   · `{ kind: 'vender', item: 'gosma', quantidade: 3 }`  ⇄ `'vender:gosma,3'`
 *   · `{ kind: 'comprar', item: 'potion', quantidade: 1 }` ⇄ `'comprar:potion,1'`
 *   · `{ kind: 'criar', receita: 'pocao' }`                ⇄ `'criar:pocao'`
 *
 * `quantidade` é sempre um NÚMERO: não existe `'vender:gosma,tudo'`. Quem
 * traduz "vender tudo" para o número é a interface, que é quem sabe o que está
 * na bolsa na hora do clique — o engine não adivinha intenção.
 *
 * `comprar` só aceita `'potion'` hoje, e o tipo diz isso em vez de aceitar
 * `ItemKind` e recusar em runtime: material é o que o jogador VENDE ao
 * mercador, não o que ele compra.
 */
export type Command =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'wait' }
  | { kind: 'use' }
  | { kind: 'descend' }
  | { kind: 'vender'; item: MaterialKind; quantidade: number }
  | { kind: 'comprar'; item: 'potion'; quantidade: number }
  | { kind: 'criar'; receita: ReceitaKind };

/* ------------------------------------------------------------------ *
 * 8. Persistência (save.ts)
 * ------------------------------------------------------------------ */

/**
 * Inimigo como sai do save. `kind`/`state` chegam como `string` porque vêm de
 * JSON não confiável — quem restaura é que valida e estreita.
 */
export interface SavedEnemy {
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
}

export interface SavedItem {
  id: number;
  /** `ItemKind` como texto: vem de JSON não confiável, quem valida é `restore`. */
  kind: string;
  x: number;
  y: number;
  heal: number;
}

/**
 * Payload do autosave. O mapa NÃO é serializado: é regerado por seed+depth —
 * o determinismo garante que é o mesmo mapa (CONTRACTS.md §9).
 */
export interface SaveData {
  v: number;
  version: string;
  /** `seed` e `seedStr` carregam o mesmo valor (compatibilidade). */
  seed: string;
  seedStr: string;
  depth: number;
  turn: number;
  over: boolean;
  cause: string;
  player: Player;
  enemies: SavedEnemy[];
  items: SavedItem[];
  /**
   * Contador de ids de item (ver `Game.proxItemId`). Save antigo não o tem:
   * `restore` recalcula por `max(id) + 1` em vez de recusar a run.
   */
  proxItemId: number;
  /**
   * Os dois pontos de parada do andar (fase 2). Vão para o save porque não
   * saem da geração do mapa: `populate` os escolhe DEPOIS de saber onde caíram
   * inimigos e itens (ver `Game.mercador`).
   *
   * Ausentes num save antigo, `restore` fica com os pontos que `createState`
   * acabou de calcular para a mesma seed+depth — determinístico, portanto uma
   * retomada honesta, nunca uma recusa de run.
   */
  mercador: Point | null;
  bancada: Point | null;
  /** Já decodificado por `read()`; base64 na forma gravada. */
  explored: Uint8Array | null;
  exploredB64?: string;
  exploredLen: number;
  stats: Stats;
  /** Estado uint32 de `rngCombat`. Ambos os campos carregam o mesmo valor. */
  rngCombat: number;
  rngCombatS: number;
  /**
   * Estado uint32 de `rngLoot`. Ausente no save antigo — nesse caso `restore`
   * fica com o stream recém-semeado por `createState`, que é determinístico
   * pela seed+depth e portanto continua uma retomada honesta.
   */
  rngLoot: number;
  /** Últimas 80 entradas. */
  log: LogEntry[];
}

/** Uma linha do histórico de runs mortas (máximo 10). */
export interface HistoryEntry {
  seed: string;
  depth: number;
  turns: number;
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  itemsUsed: number;
  explorePct: number;
  cause: string;
}
