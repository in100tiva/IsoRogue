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
  Stairs = 3,
  /**
   * O VAZIO do penhasco (fase da água): o tile que cerca o construído entre
   * ele e a moldura externa do mapa. Decisão do dono, sem rediscussão:
   *   · BLOQUEIA o passo de jogador e inimigos como a parede — não é abismo
   *     que mata, é borda de precipício com visual próprio;
   *   · nasce só no mapgen (toda parede longe da divisa do construído), nunca
   *     dentro de sala e nunca no anel externo, que continua parede;
   *   · entra no checksum `map=` do `snapshot()` como tile comum, sem custo
   *     extra de formato — é um valor de tile, não um canal novo;
   *   · NÃO bloqueia luz: o abismo se enxerga (blocksLight continua só Wall).
   * O valor 4 é contrato congelado: viaja no checksum de tiles.
   */
  Void = 4
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
  /**
   * w*h, 0 ou 1 — o bitmap de ÁGUA (fase do penhasco). `1` marca um tile de
   * piso que BLOQUEIA o passo de jogador e inimigos, como a parede. A água
   * vem em duas mãos, e o bitmap não as distingue porque a REGRA é a mesma:
   *
   *   · POÇA — região 4-conexa de 2..5 tiles sorteada DENTRO de uma sala,
   *     sobre piso que já existia. É relevo de sala;
   *   · CANAL — a enseada: braço que nasce na costa do penhasco (a parede da
   *     crosta que encosta no vazio) e avança COMENDO PAREDE, deixando margem
   *     de piso ao lado. É relevo de andar, e o tile dele era `Wall` antes da
   *     fase — nunca piso. Daí a consequência que o resto do engine herda de
   *     graça: o canal não tira um único tile do conjunto caminhável, então
   *     não move conectividade, população nem despojo.
   *
   * Poça e canal que se encostam são um corpo d'água só, 4-conexo — é o que
   * faz a poça da sala ler como margem interna da mesma enseada.
   *
   * Por que um canal paralelo, e não um valor novo em `Tile` nem bits altos
   * do `decor`:
   *   1. o tile da água continua `Floor` — o visual é piso com água por cima
   *      (o renderer já prevê exatamente isto: "uma região marcada no MAPA,
   *      um bitmap ao lado do decor"), e o checksum `map=` não precisa de
   *      formato novo para o relevo interno;
   *   2. o `decor` é hash POR TILE sem correlação espacial — bit alto dele
   *      jamais codificaria uma REGIÃO, e roubar bits mudaria a variação
   *      visual de todo andar já gerado;
   *   3. o bitmap é função pura de (seed, depth) — o mapa NÃO é serializado
   *      (CONTRACTS.md §9), então o save não carrega `agua`: o restore a
   *      regera byte a byte idêntica, e o `snapshot()` a verifica pelo
   *      campo `agua=` (v6). A enseada mudou os VALORES do bitmap, não o
   *      formato: `agua=` continua sendo o checksum dos mesmos w*h bytes, e
   *      por isso a versão do snapshot NÃO subiu.
   *
   * A água NÃO é atravessável a nado (decisão do dono): `isWalkable` devolve
   * `false` para ela, e é essa única mudança que fecha o bloqueio para o
   * jogador, o Dijkstra, a IA e a validação do restore.
   */
  agua: Uint8Array;
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
 * `nivel` é o nível BASE do monstro na escala de balanceamento (§15.1 do
 * BESTIARIO): Slime 1, Goblin 2, Ogro 3. O nível EFETIVO soma um por andar
 * descido — `nivelDoMonstro(kind, andar)`, em entities.ts —, e é o efetivo
 * que dirige o XP do abate (100 × 2^(nivelMonstro − nivelHeroi), cortado a
 * zero quando o herói passa três níveis).
 *
 * O nível NÃO dirige mais a tabela de spawn: a mistura sai do ANDAR (§15.4),
 * não do nível de ninguém.
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

/* ------------------------------------------------------------------ *
 * 6.5. Missões (fase 3)
 * ------------------------------------------------------------------ */

/**
 * Chave de uma missão, em texto: 'abate-chaser' | 'abate-sentinel' |
 * 'abate-linker'. Viaja no save e no `snapshot()`, então é nome de contrato.
 *
 * A chave NÃO é única por partida: as missões são geradas POR ANDAR e
 * atravessam a descida, então o andar 3 pode oferecer uma segunda
 * 'abate-chaser' convivendo com a do andar 1. Quem precisa distinguir duas
 * com a mesma chave usa a receita inteira (matar/entregar/itens/recompensa),
 * que é o que o `snapshot()` grava.
 */
export type MissaoKey = string;

/**
 * Uma CAÇADA oferecida pelo mercador (fase 3).
 *
 * Dois requisitos que se acumulam e só fecham JUNTOS:
 *   · ABATE — matar `matar` monstros do arquétipo `alvo`. O progresso mora em
 *     `progressoMatar` e a parte de abate está feita quando
 *     `progressoMatar >= matar` (predicado derivado, sem campo próprio: uma
 *     verdade guardada em dois lugares é uma mentira esperando a descida);
 *   · ENTREGA — levar ao mercador `entregar` despojos NO TOTAL, somando os
 *     tipos de `itens` (que são exatamente a tabela `DROPS[alvo]`).
 *
 * `completa` e `entregue` nascem juntas no comando `entregar` — fechou as
 * duas partes, recebeu a recompensa. São dois campos, e não um, porque dizem
 * coisas diferentes ("a caçada fechou" × "o prêmio foi pago") e o painel e o
 * save as leem separado; nesta fase elas mudam no mesmo instante, mas o modelo
 * já admite o dia em que completar e premiar forem passos separados.
 *
 * `nome` e `desc` são pt-BR gerados na criação e GRAVADOS (não reconstruídos
 * na leitura): o texto que o jogador viu no andar 1 é o texto que ele lê no
 * andar 5, mesmo que a fórmula do texto mude numa versão futura.
 */
export interface Missao {
  key: MissaoKey;
  /** Arquétipo que cai no abate. */
  alvo: ArchetypeKey;
  /** Quantos abates a missão exige. */
  matar: number;
  /** Tipos de despojo aceitos na entrega — a tabela `DROPS[alvo]` inteira. */
  itens: MaterialKind[];
  /** Quantos despojos entregar, NO TOTAL somando os tipos de `itens`. */
  entregar: number;
  /** Abates já feitos (vai no snapshot e no save). */
  progressoMatar: number;
  recompensaMoedas: number;
  /** Item bônus do alvo (50% de chance na geração), ou `null`. */
  recompensaItem: { kind: MaterialKind; n: number } | null;
  /** pt-BR: 'Caça ao Goblin'. */
  nome: string;
  /** pt-BR: 'Mate 3 Goblins e entregue 2 despojos de goblin (…).' */
  desc: string;
  /** As DUAS partes fecharam e a entrega aconteceu. */
  completa: boolean;
  /** Completou E recebeu a recompensa (ver o comentário do par, acima). */
  entregue: boolean;
}

/** Retorno de `populate(map, depth)`. */
export interface Population {
  enemies: Enemy[];
  items: Item[];
  /**
   * Os dois pontos de parada do andar (fase 2), ou `null` quando o mapa não
   * ofereceu tile elegível. Saem daqui, e não de `generate`, porque dependem de
   * onde inimigos e itens caíram — nenhum dos dois pode ficar embaixo deles.
   *
   * Desde a fase 2.1 os dois nascem no CÔMODO EM QUE O HERÓI COMEÇA (ver
   * `populate`): o dono jogou e não achou o mercador, e ponto de parada que não
   * se descobre é conteúdo que não existe.
   */
  mercador: Point | null;
  bancada: Point | null;
  /**
   * Os tiles de DECORAÇÃO da estação de alquimia (fase 2.1): até dois vizinhos
   * ortogonais do caldeirão (`bancada`), na ordem canônica do índice linear.
   * Ver `Game.alquimiaExtras` — aqui vale a mesma regra, inclusive a de que a
   * lista pode ser mais curta (ou vazia) num cômodo apertado.
   */
  alquimiaExtras: Point[];
  /**
   * As caçadas do andar (fase 3): 1 a 3 missões, uma por arquétipo sorteado,
   * sem repetir arquétipo no mesmo andar. Saem de `populate` — e não de uma
   * função posterior — porque o sorteio tem de ser do stream de POPULAÇÃO
   * (`seed + '#pop#' + depth`): encostar em `rngCombat` ou `rngLoot` faria a
   * caçada depender da sorte do combate, que é o acoplamento que a fase 1
   * desfez. Geradas POR ÚLTIMO em `populate`, depois das paradas, para que o
   * consumo novo de stream não desloque a posição de um inimigo sequer dos
   * andares já gerados (a mesma disciplina que as paradas impuseram à fase 1).
   */
  missoes: Missao[];
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
   * ONDE ELE NASCE (fase 2.1): no CÔMODO EM QUE O HERÓI COMEÇA, a Chebyshev
   * 2..4 do ponto de início. A regra antiga — perto da escada — era boa no
   * papel e ruim na mão: o dono jogou uma expedição inteira sem achar o
   * mercador, porque a escada é o fim do andar e não o começo. Dois é longe o
   * bastante para ele não colar no herói; quatro é perto o bastante para caber
   * no primeiro campo de visão.
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
  /**
   * O CALDEIRÃO da estação de alquimia — o tile de INTERAÇÃO da oficina, onde
   * `criar` (alquimia e refino) é aceito. Ver `mercador`.
   *
   * O nome do campo é anterior à estação de três tiles da fase 2.1 e ficou como
   * está de propósito: ele é contrato de `snapshot()`, do save, do render e da
   * interface. Renomeá-lo para `caldeirao` custaria uma migração em quatro
   * camadas para trocar a palavra que aparece na tela por outra que aparece na
   * tela — e a peça continua sendo a mesma.
   */
  bancada: Point | null;
  /**
   * Os tiles de DECORAÇÃO da estação de alquimia (fase 2.1): a estante e a mesa
   * que ladeiam o caldeirão. No máximo dois, sempre ORTOGONALMENTE adjacentes a
   * `bancada`, na ordem canônica do índice linear (linha a linha).
   *
   * O que eles são: cenário com TERRITÓRIO RESERVADO. Não têm interação nenhuma
   * — `criar` só responde sobre `bancada` —, mas `populate` os marca como
   * ocupados, então nenhum item e nenhum inimigo nasce em cima da instalação.
   *
   * Lista CURTA (ou vazia) é degradação legítima, não erro: num cômodo apertado
   * a estação perde a mesa, depois a estante, e o caldeirão fica sozinho. O que
   * nunca acontece é a estação existir sem caldeirão.
   */
  alquimiaExtras: Point[];
  /**
   * As caçadas aceitas no quadro do mercador (fase 3). Lista de VIDA LONGA do
   * jogador, como a bolsa e as moedas: gerada por andar (1 a 3 novas a cada
   * `populate`) e ATRAVESSA a descida — `descend` SOMA as do andar novo às
   * pendentes, nunca zera. Uma missão do andar 1 continua valendo no andar 5:
   * o abate conta por ARQUÉTIPO, não por andar, e a entrega acontece em
   * qualquer mercador.
   *
   * A ordem da lista é contrato (é a ordem de geração: andar a andar, e
   * dentro do andar a ordem de `KINDS`): é ela que o painel lê, que o
   * `snapshot()` grava e que o `entregar` varre quando duas missões disputam
   * o mesmo despojo da bolsa.
   */
  missoes: Missao[];
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
  emTurno: boolean
  /**
   * Último tipo de obstáculo em que o jogador esbarrou ('mercador' |
   * 'alquimia' | 'agua' | 'vazio'). Campo TRANSITÓRIO, não serializado:
   * existe só para a mensagem de esbarrão não repetir enquanto o jogador
   * martela a mesma direção. Sai do snapshot de propósito — é rumo de
   * diálogo, não de estado. Os dois tipos de TERRENO ('agua'/'vazio', fase
   * do penhasco) dividem a mesma trava: esbarrão é esbarrão, mude o que
   * mudou o que está à frente.
   */
  ultimoEsbarrao?: 'mercador' | 'alquimia' | 'agua' | 'vazio' | null;
  /**
   * Chave da última missão cujo lembrete de entrega foi narrado. Campo
   * TRANSITÓRIO, não serializado, no mesmo estatuto de `ultimoEsbarrao`: sem
   * ele, cada passo ao redor do mercador repetiria "a caçada está pronta" —
   * e o registro é o lugar que o jogador lê o combate. Volta a `null` quando
   * o jogador se afasta do balcão, então sair e voltar lembra de novo (uma
   * vez por encontro, que é o bem-vindo sem o spam).
   */
  ultimoLembreteMissao?: MissaoKey | null;
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
 * A fase 3 acrescenta o comando de ENTREGA de caçadas, sem parâmetro nenhum:
 *   · `{ kind: 'entregar' }`                              ⇄ `'entregar'`
 * Não há 'entregar:abate-chaser' de propósito: o comando varre TODAS as
 * missões prontas (abate feito + despojos na bolsa) e liquida cada uma, na
 * ordem da lista. Escolher missão no comando seria pedir que a interface
 * soubesse o que o engine já sabe — o mesmo motivo pelo qual não existe
 * 'vender:gosma,tudo'.
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
  | { kind: 'criar'; receita: ReceitaKind }
  | { kind: 'entregar' };

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
 * Missão como sai do save. `alvo`/`itens`/o kind do bônus chegam como `string`
 * porque vêm de JSON não confiável — quem valida e estreita (contra `KINDS` e
 * `normalizeMaterialKind`) é `restore`, no mesmo padrão de `SavedEnemy.kind`.
 */
export interface SavedMissao {
  key: string;
  alvo: string;
  matar: number;
  itens: string[];
  entregar: number;
  progressoMatar: number;
  recompensaMoedas: number;
  recompensaItem: { kind: string; n: number } | null;
  nome: string;
  desc: string;
  completa: boolean;
  entregue: boolean;
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
  /**
   * Os tiles de decoração da estação de alquimia (ver `Game.alquimiaExtras`).
   *
   * A degradação aqui é MAIS DURA do que a dos dois pontos, de propósito: um
   * save que não traga a lista (todo save anterior à fase 2.1) retoma com a
   * estação SEM decoração, e não com a decoração que `createState` acabou de
   * calcular. O motivo é que os extras só fazem sentido colados no caldeirão, e
   * o caldeirão que vale na retomada é o do save: herdar extras de outro
   * cálculo poria estante e mesa flutuando longe da oficina. Cenário faltando é
   * discreto; cenário no lugar errado é bug visível.
   */
  alquimiaExtras: Point[];
  /**
   * As caçadas da partida (fase 3), com progresso, flags e receita. Vão para
   * o save porque são do JOGADOR e atravessam a descida — regerá-las por
   * seed+depth não serviria: a lista acumula andares, e o progresso de abate
   * e as flags de entrega não nascem da semente.
   *
   * Ausente num save antigo, `restore` degrada para a LISTA VAZIA — e NÃO para
   * a lista que `createState` acabou de gerar. Uma caçada a menos é discreto
   * (o andar seguinte oferece outras); uma caçada inventada a meio da run,
   * com progresso zerado numa partida avançada, é o jogo mentindo. Lista
   * vazia, nunca recusa de run.
   */
  missoes: SavedMissao[];
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
