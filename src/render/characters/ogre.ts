/*
 * ISOROGUE — src/render/characters/ogre.ts
 *
 * O rig do Ogro: paleta canônica (§12.2 do docs/BESTIARIO.md) e blockout
 * hierárquico de caixas (§12.3). Reconstrução POR CÓDIGO a partir de
 * docs/ref/ogro-referencia.png — nenhuma imagem, nenhum asset, nenhuma URL.
 *
 * Este módulo é o gêmeo de `./warrior` e de `./goblin`, com exatamente as mesmas
 * responsabilidades e os mesmos limites:
 *   - é a fonte da verdade da FORMA (árvore de nós, pivôs, caixas);
 *   - é a fonte da verdade da COR (`PALETA_OGRO` + rampas de material);
 *   - guarda a pose de repouso (`POSE_PARADA_OGRO`) e os números que a revisão
 *     visual (§13) pode mexer sem tocar na estrutura.
 *
 * O que ele NÃO é: não projeta, não rasteriza, não anima e não conhece Canvas.
 * Projeção e faces são de `../model3d`; atlas e animação são de `../spriteForge`.
 * O forge continua agnóstico de personagem — recebe `paleta`, `rampas`,
 * `rampaDaCor`, `repouso`, `emissivas` e `arcoGolpe` em `opts` e não pergunta
 * quem é o dono.
 *
 * ATENÇÃO ao que este arquivo NÃO faz, por contrato (§0 do BESTIARIO):
 *   - o Ogro é a APARÊNCIA do arquétipo `sentinel` que já existe. Nada aqui
 *     encosta em `src/engine/entities.ts`, em `ARCHETYPES`, em `populate()`, em
 *     IA, hp, atk ou range. O golden test congela quais inimigos nascem em cada
 *     semente e não pode mudar de cor por causa de um sprite;
 *   - o `facing` do inimigo é derivado 100% na camada de render (o `IsoRenderer`
 *     já guarda estado por entidade em `vfxOf`). Nenhum campo novo em `Enemy`,
 *     em `snapshot()`, no save ou no oracle.
 *
 * A HONESTIDADE SOBRE O ENCAIXE (§10 do BESTIARIO): `sentinel` ataca a 6 tiles e
 * a referência é um brutamontes de marreta. A adaptação é visual e está inteira
 * aqui: a marreta fica APOIADA na mão esquerda e quem ataca é a mão DIREITA, num
 * ARREMESSO (ver `ANIMACAO_OGRO.arremessoRx`). Não é o que a referência pedia —
 * é o que o arquétipo permite sem regenerar o oracle.
 *
 * Invariantes:
 *   - Determinístico: zero `Math.random`, zero relógio, zero DOM.
 *   - `criarModeloOgro()` devolve uma árvore NOVA a cada chamada — nenhum array
 *     é compartilhado entre instâncias.
 *   - Traços de identidade O1..O8 (§12.1) sobrevivem na silhueta. Perder a
 *     corcunda assimétrica (O2) transforma o ogro num humano grande; perder o
 *     tamanho (O1) tira a intimidação, que é a primeira leitura do jogador.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta canônica (§12.2) — amostrada da referência
 * ------------------------------------------------------------------ */

/**
 * As 14 cores do Ogro, exatamente como a §12.2 as declara.
 *
 * O ponto que NÃO pode ser "melhorado": a pele é verde-ACINZENTADA e
 * dessaturada de propósito (O6). Os três monstros do bestiário são esverdeados,
 * e o que os separa a três tiles de distância é a SATURAÇÃO — Slime vibrante
 * (`#4fd07a`, ~76% de saturação HSL), Goblin médio (`#6f9e3e`, ~44%), Ogro
 * pálido (`#a3c096`, ~25%). Saturar a pele do Ogro para ela "ficar bonita"
 * apaga o gate G9: os três viram três manchas verdes.
 *
 * Sem cor emissiva, e isso é decisão, não esquecimento — ver
 * `CORES_EMISSIVAS_OGRO`.
 */
export const PALETA_OGRO = {
  peleLuz: '#c6dcbb', // corcunda contra a luz, topo dos ombros
  peleBase: '#a3c096', // pele em geral
  peleMeio: '#7d9a72', // faces laterais, ventre, coxas
  peleSombra: '#576d50', // vãos, garganta, sombra sob a máscara
  metalLuz: '#dccfa6', // testeira da máscara
  metalBase: '#ab9668', // a máscara
  metalSombra: '#6e5c3e', // aros da marreta, sombra do metal
  couroBase: '#6b4a35', // saiote, braçadeira
  couroSombra: '#43301f', // ombreira, sombra do couro
  madeira: '#5c4530', // cabo e cabeça da marreta
  osso: '#e8e0cc', // espinhos, chifres, caveira, rebites
  ossoSombra: '#9c9078', // face afastada do osso
  vazio: '#1a2416', // fenda dos olhos, vãos, sombra interna
  contorno: '#111a0e' // outline
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorOgro = keyof typeof PALETA_OGRO;

/**
 * As rampas de quantização por material (§4.3 do PERSONAGEM.md): o fator de luz
 * da face escolhe um destes tons. A rampa é propriedade do MATERIAL, e o
 * material é propriedade do modelo — por isso ela mora aqui e não no forge.
 *
 * Medido com os fatores canônicos do `model3d` (`GANHO_SOMBRA` 1.15,
 * `REALCE_TOPO` 1.25), uma caixa declarada `peleBase` sai:
 *
 * | face   | normal | alvo  | degrau     |
 * |--------|--------|-------|------------|
 * | topo   | +Z     | 223,1 | `peleLuz`  |
 * | frente | +Y     | 176,9 | `peleBase` |
 * | lado   | +X     | 141,0 | `peleMeio` |
 *
 * — três dos quatro tons de O6 numa peça só, e `peleSombra` aparece nos vãos e
 * nas peças declaradas `peleMeio`.
 *
 * Duas rampas MISTURAM materiais, e não é descuido:
 *
 * - `couro` só tem dois tons próprios na §12.2 (`couroBase` 81,5 e
 *   `couroSombra` 51,7 de luminância). Com dois degraus, topo e frente caem no
 *   mesmo `couroBase` e o saiote — que é a maior massa escura do bicho — sai
 *   chapado. `metalSombra` (94,0) é a única cor da §12.2 acima de `couroBase` e
 *   ainda dentro da família parda: encadeada no topo da rampa ela dá o terceiro
 *   degrau sem inventar cor (gate G5 continua verde). Medido: topo
 *   `metalSombra` · frente `couroBase` · lado `couroSombra`;
 * - `madeira` (73,5) fica ENTRE `couroSombra` e `couroBase`, então a rampa dela
 *   é `couroBase`/`madeira`/`couroSombra` — topo, frente e lado distintos. É o
 *   que dá volume ao cabo da marreta, que é uma barra fina e escura.
 *
 * `osso` fecha em dois tons (topo e frente em `osso`, lado em `ossoSombra`):
 * `osso` já é o degrau mais claro da paleta inteira e o `REALCE_TOPO` não tem
 * para onde subir. É o mesmo comportamento do `dente` do Goblin e serve bem a
 * espinhos e chifres, que são peças pequenas onde o contraste com a pele
 * importa mais que o volume interno.
 */
export const RAMPAS_OGRO = {
  pele: ['peleLuz', 'peleBase', 'peleMeio', 'peleSombra'],
  metal: ['metalLuz', 'metalBase', 'metalSombra', 'vazio'],
  couro: ['metalSombra', 'couroBase', 'couroSombra', 'vazio'],
  madeira: ['couroBase', 'madeira', 'couroSombra', 'vazio'],
  osso: ['osso', 'ossoSombra', 'couroSombra', 'vazio'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorOgro[]>;

/** Rampa a que cada cor de peça pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_OGRO = {
  peleLuz: 'pele',
  peleBase: 'pele',
  peleMeio: 'pele',
  peleSombra: 'pele',
  metalLuz: 'metal',
  metalBase: 'metal',
  metalSombra: 'metal',
  couroBase: 'couro',
  couroSombra: 'couro',
  madeira: 'madeira',
  osso: 'osso',
  ossoSombra: 'osso',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorOgro, keyof typeof RAMPAS_OGRO>;

/**
 * §1.1 do BESTIARIO — cores que ignoram a modulação de luz. O Ogro NÃO TEM
 * nenhuma, e a lista vazia é a declaração explícita disso.
 *
 * Por que ele não tem, já que Goblin e Slime têm: a §12.2 não declara cor
 * emissiva, e inventar uma reprovaria o gate G5 (cor fora da paleta) para
 * ganhar um efeito que já é do Goblin. A leitura do Ogro no escuro é outra e é
 * melhor: com 24u ele é a maior MANCHA do jogo, e a máscara clara (`metalLuz`,
 * a cor mais brilhante do corpo dele) fica na testeira, o ponto mais alto e mais
 * iluminado do bicho. No escuro o Goblin vira dois olhos vermelhos; o Ogro vira
 * uma silhueta grande demais para caber num tile. São ameaças diferentes, e é
 * assim que se lê espécie diferente a três tiles (gate G9).
 *
 * Consequência de custo, e é a razão de a lista existir em vez de não exportar
 * nada: `forjarAtlas` com `emissivas: []` não aloca camada extra nenhuma e
 * `quadroModulado()` cai no caminho de tingimento simples. Quem integra passa
 * esta constante sem `if`, como passa a do Goblin.
 */
export const CORES_EMISSIVAS_OGRO: readonly CorOgro[] = [];

/* ------------------------------------------------------------------ *
 * 2. Proporções (§12.3) — a estrutura, que NÃO se ajusta
 *
 * §12.5 — OCLUSÃO, A ARMADILHA DESTE MONSTRO. A medição pedida, feita.
 *
 * Método: a mesma conta que `forjarAtlas` faz (`../spriteForge`) — a união das
 * caixas de silhueta das 8 direções × 9 quadros, com o deslocamento vertical de
 * cada quadro e a margem de 2px de arte. `ART_POR_U = 2.5` e `PIXEL = 1`, então
 * px de arte = px de TELA em zoom 1, e a comparação com o tile (64 × 32) e com
 * a parede (`WALL_H = 36`) é direta.
 *
 * | personagem | altura do modelo | quadro (px)   | vs. tile 64×32 |
 * |------------|------------------|---------------|----------------|
 * | Guerreiro  | 20,9u            | 113 × 92      | 1,8 × 2,9      |
 * | **Ogro**   | **25,5u**        | **130 × 103** | **2,0 × 3,2**  |
 *
 * (A calibração é contra o GUERREIRO, e não contra o Goblin, de propósito: ele
 * é o personagem estável do projeto — está em produção e já passou pelos gates
 * de §10 —, enquanto o rig do Goblin ainda está em revisão de empunhadura e o
 * quadro dele muda a cada rodada. Comparar com alvo móvel não é medição.)
 *
 * A RODADA 1 concluiu daqui que "a oclusão não piora de forma relevante", e a
 * revisão derrubou a conclusão com razão: comparar LARGURA DE QUADRO é
 * enganoso. Os 113px do Guerreiro vêm da espada ERGUIDA, que ocupa `artY` acima
 * do tile; os do Ogro vinham da marreta DEITADA ao lado, que ocupa `artX` e
 * invade o tile vizinho no PLANO DO CHÃO — exatamente onde a ordem do pintor
 * por antidiagonal erra sem z-buffer. São 2px iguais em lugares diferentes.
 *
 * A medição certa separa os eixos e olha o extremo em `artX` contra os 32px de
 * MEIO TILE. Centro de cada peça extrema, medido no rig montado com a pose de
 * repouso:
 *
 *   | peça                    | rodada 1 | rodada 2 |
 *   |-------------------------|----------|----------|
 *   | cabeça da marreta       | −39,4px  | −29,8px  |
 *   | ombreira espinhada      | −21,0px  | −20,0px  |
 *   | ponta do espinho `c`    |   —      | −27,1px  |
 *
 * Com a marreta erguida (ver `ANGULOS_OGRO.marretaRx`) o extremo volta para
 * DENTRO do meio tile, e aí sim a conclusão "o Ogro fica em 24u" se sustenta:
 * a pendência conhecida de oclusão (~12px na mesma antidiagonal) deixa de
 * piorar no eixo em que dói.
 *
 * O rig FICA acima de 24u — 25,5, com o ponto mais alto num espinho da ombreira
 * (O4). A saída barata prevista pela §12.5 — cair para ~22u e compensar na
 * largura — resolveria um problema que a medição não encontrou, e custaria O1,
 * que é o primeiro traço da lista de §12.1.
 *
 * A altura por direção continua sólida (gate G2): a massa do Ogro é compacta e
 * a arma agora é vertical em vez de deitada, o que reduz a variação de `artX`
 * ao girar em relação à rodada 1.
 * ------------------------------------------------------------------ */

/**
 * Medidas em `u` (espaço local do modelo: +X direita, +Y frente, +Z cima,
 * origem no centro dos pés).
 *
 * A regra de escala da §4 do PERSONAGEM.md é o coração dos gates G7 e G10: o
 * Ogro usa a MESMA `ART_POR_U` do Guerreiro e do Goblin, e a diferença de
 * tamanho na tela vem da altura real do modelo — nunca de um fator aplicado no
 * sprite. Slime 7u < Goblin 13u < Guerreiro 18u < Ogro 24u, na mesma
 * perspectiva.
 *
 * ONDE ESTE RIG DIVERGE DA TABELA DA §12.3, e por quê. A tabela é internamente
 * inconsistente: o cabeçalho declara `ALTURA_MODELO_OGRO = 24u`, mas as caixas
 * que ela lista fecham em **20,4u** (sola em −1,5, topo do espinho em 18,3).
 * Os dois não podem ser verdade ao mesmo tempo, e a diferença não é acabamento:
 * a 20,4u o Ogro fica 13% mais alto que o Guerreiro, o que não é "ele
 * INTIMIDA" — é "ele é um pouco maior". O1 é o primeiro traço da lista de §12.1
 * justamente porque é a primeira coisa que o jogador percebe.
 *
 * Escolhi o CABEÇALHO (24u de altura, 16u de bitola de ombros) e reconstruí as
 * caixas em torno dele, mantendo as proporções relativas da tabela em tudo o
 * mais. As duas correções que O8 obrigou, e que um escalonamento uniforme não
 * daria:
 *
 * - as PERNAS da tabela são longas demais. Elas medem 9,1u de 20,4 (45%),
 *   contra 42% do Guerreiro — ou seja o "pernas curtas" de O8 estava invertido,
 *   como o "cabeça enorme" do Goblin estava. Aqui elas fecham em 8,3u de 24,25
 *   (34%), e é essa razão que dá a postura de gorila;
 * - o TRONCO e a corcunda cresceram para absorver a altura que as pernas não
 *   têm. É o que a referência mostra: massa de tronco desproporcional, cabeça
 *   afundada entre os ombros, pernas atarracadas.
 */
export const PROPORCOES_OGRO = {
  /**
   * §12.3 ALTURA_MODELO_OGRO. Medida no rig montado, pose parada: sola em
   * −0,30 e ponta do espinho `b` da ombreira em 25,53 (já com a inclinação de
   * 14° do torso aplicada) — **25,8u** de silhueta, contra 20,9u do Guerreiro
   * (com a espada), 13,3u do Goblin e 11,6u do Slime. Gate G10 fechado por
   * medição, não por olho: 63,8 · 52,3 · 33,1 · 29,0 px acima da âncora.
   *
   * Os 24u do contrato viraram 25,5 na RODADA 2 e a diferença é inteira dos
   * ESPINHOS, que subiram para existir na tela (ver `criarTorso`). A razão
   * Ogro/Guerreiro fica em 1,22 contra os 1,33 que a §12.3 pede — ou seja o
   * bicho continua ABAIXO do alvo de O1, não acima dele; quem subiu foi só a
   * crista.
   *
   * O ponto mais alto do modelo é um ESPINHO DA OMBREIRA, não a cabeça. Medido,
   * de cima para baixo: espinho.b 25,53 · espinho.a 24,83 · corcunda 23,42 ·
   * espinho.c 23,34 · ombreira 22,40 · testeira 21,35 · crânio 20,40. É a
   * assinatura de O2 e o teste mais barato de que a corcunda sobreviveu: se o
   * topo da silhueta passar a ser a testeira, alguém baixou o ombro alto.
   */
  altura: 25.5,

  /**
   * §12.3 LARGURA_OMBROS, a bitola da massa do TRONCO (é o que o nome quer
   * dizer — os braços contam à parte). Fecha em 16,3u: −8,4 na ombreira
   * espinhada a +7,9 no ombro direito, exatamente os 16u do contrato.
   *
   * Com os braços a silhueta abre para 17,8u (−8,5 no braço da marreta a +9,3
   * na mão do arremesso), e a marreta apoiada leva o extremo a −11,2.
   *
   * A assimetria é PROPOSITAL e é medível — o lado da corcunda pesa 8,4u contra
   * 7,9 do lado livre, e com a marreta, 11,2 contra 9,3. Se algum dia estas
   * contas empatarem, a silhueta virou simétrica e O2 morreu.
   */
  larguraOmbros: 16.3,

  /** Altura (z) dos pivôs, medida do chão. */
  zQuadril: 8.6,
  zTorso: 12.6,
  /**
   * A cabeça é BAIXA (O2 e O8: "entre os ombros"). A §12.3 põe o pivô em 16,2
   * num modelo que ela declara de 24u; reconstruído em 24u de verdade, o
   * equivalente proporcional seria ~19,2.
   *
   * Está em 18,1, meio ponto ABAIXO do proporcional, e o meio ponto é a margem
   * de O2. Medido: com a cabeça em 19,2 a testeira fecharia em 22,45 contra
   * 22,83 do topo da corcunda — 0,38u, ou meio pixel de arte, de diferença. Um
   * "ombro acima da cabeça" que só existe na terceira casa decimal não existe.
   * Em 18,1 a testeira fecha em 21,35 e sobram 1,48u (3,7px de arte) até a
   * corcunda e 2,50u (6,3px) até a ponta do espinho — aí a silhueta conta a
   * história sozinha, que é o que O2 cobra.
   */
  zCabeca: 18.1,
  zOmbroEsq: 16.6,
  zOmbroDir: 16.0,
  zQuadrilPerna: 8.0,

  /**
   * Avanço (y) do pivô da cabeça. A §12.3 escreve `pivô (0.6, 0, 16.2)` com o
   * 0,6 no eixo X, o que empurraria a cabeça para o LADO — e o comentário da
   * própria linha diz "baixa e à frente, entre os ombros". Um deslocamento
   * lateral da cabeça não é nada disso, e piora O2: ele aproxima o crânio da
   * corcunda e come justamente o vão que faz a corcunda ler como corcunda.
   *
   * Lido como o comentário manda: no eixo Y, à frente.
   *
   * RODADA 2 — de 1,0 para 2,6u. Com 1,0 a cabeça ficava 100% ESCONDIDA atrás
   * da corcunda nas direções 0, 6 e 7: nem máscara, nem fenda de olhos, e o
   * facing ilegível (G3). Pior para O2 do que parece — uma corcunda só lê como
   * corcunda quando há uma cabeça VISÍVEL ao lado e abaixo dela; sem cabeça a
   * leitura não é "ombro acima da cabeça", é "não tem cabeça".
   *
   * O que os 1,6u a mais compram: a projeção de §4.2 é `artX = x − y`, então
   * avançar em Y desloca a cabeça para a ESQUERDA da tela — para fora da sombra
   * da corcunda, que vive em −X e não avança em Y. É o eixo certo para resolver
   * o problema, e ele não custa altura (a corcunda continua acima).
   */
  yCabeca: 2.6,

  /**
   * Meia-bitola do pivô dos braços. Assimétrica de propósito: o braço da
   * marreta nasce mais para fora e mais alto porque ele sai de DENTRO da
   * ombreira espinhada (O4), que é uma peça de 5,2u de largura montada sobre o
   * ombro alto; o braço do arremesso nasce de um ombro de pele comum.
   */
  xOmbroEsq: 6.4,
  /**
   * RODADA 2 — 5,6 → 6,6. O Ogro era o único dos quatro personagens SEM UM
   * PIXEL DE FUNDO dentro da silhueta, e a causa estava aqui: com o pivô em 5,6
   * e o braço a −8° do prumo, o braço (3,3u), o `ombro.dir` (5,0u em cx 5,4) e o
   * `peito` (10,6u) ficavam coplanares e os três se fundiam num campo pálido sem
   * interrupção. Guerreiro e Goblin ganham metade da leitura do VÃO DE FUNDO
   * entre braço e tronco; sem vão não há membro, e sem membro não há criatura —
   * é a causa direta do "lê como seixo" no teste da máscara a 40px.
   */
  xOmbroDir: 6.6,

  /**
   * Meia-bitola das pernas.
   *
   * O piso é a mesma armadilha medida no Guerreiro e no Goblin: com a canela em
   * 4,0u de largura, o vão entre as duas solas vale `2 · 3.2 − 4.0 = 2,4u`, ou
   * 6px de arte na escala de `ART_POR_U = 2.5`. Abaixo de ~2px as duas pernas
   * viram uma coluna só e nenhum ciclo de caminhada lê como passo; aqui sobra
   * folga de sobra, e é ela que sustenta a passada larga e lenta de §12.4.
   *
   * O teto é o saiote: ele tem 9,8u de largura (±4,9) e a coxa fecha em ±5,4.
   * As coxas saem por fora do saiote, que é exatamente o que a referência
   * mostra — o couro cobre o quadril e as pernas transbordam dele.
   */
  xPerna: 3.2
} as const;

/* ------------------------------------------------------------------ *
 * 3. Ajustes de revisão visual (§13) — os únicos números "negociáveis"
 * ------------------------------------------------------------------ */

/**
 * Números que a revisão visual pode mexer sem tocar na árvore de nós nem nas
 * dimensões das caixas.
 */
export const AJUSTES_OGRO = {
  /**
   * Centro da mão esquerda no espaço de `bracoEsq` e — por construção — o pivô
   * da marreta. Os dois saem da MESMA constante de propósito: a arma gira NA
   * MÃO, e uma segunda cópia deste número seria a maneira silenciosa de o cabo
   * descolar do punho no primeiro ajuste de pose. Mesma cura de
   * `AJUSTES_GOBLIN.maoY`.
   *
   * O avanço em Y é a metade geométrica da postura de gorila (O8): o braço não
   * pende reto ao lado, ele pende para a FRENTE. Ver `criarBracoEsq`, que
   * explica por que a curva do braço está nas coordenadas das caixas em vez de
   * na pose.
   *
   * RODADA 2 — de 2,6 para 1,2u, e o motivo é ENQUADRAMENTO. A marreta gira em
   * torno deste ponto, então cada `u` de avanço em Y da mão é um `u` de avanço
   * da arma inteira; na projeção `artX = (x − y)·2,5` isso empurra a cabeça da
   * marreta para a esquerda com o MESMO peso com que empurraria um deslocamento
   * em −X. Com 2,6 o centro da cabeça da arma caía a −39,4px de arte da âncora
   * contra 32px de meio tile: a arma inteira no tile vizinho. Recuar a mão 1,4u
   * devolve 3,5px e é metade da cura (a outra metade é `ANGULOS_OGRO.marretaRy`).
   */
  maoEsqY: 1.2,
  maoEsqZ: -12.4,

  /** Centro da mão direita no espaço de `bracoDir`. Mesma lógica, braço um pouco mais curto. */
  maoDirY: 2.2,
  maoDirZ: -13.0
} as const;

/**
 * Ângulos da pose de repouso, em GRAUS (a conversão para radianos é feita ao
 * montar `POSE_PARADA_OGRO`). Ajustáveis pela revisão visual — gates G1 e G6.
 */
export const ANGULOS_OGRO = {
  /**
   * §12.3 — o torso inclinado ~14° para a frente, a postura O8.
   *
   * SINAL, e ele é contraintuitivo: o torso se estende para +Z a partir do
   * pivô, e `matPivoRotacao` com `rx` positivo leva o topo para −Y (ver a
   * dedução em `../spriteForge`, na convenção de `poseDoQuadro`). Quem inclina
   * para a FRENTE é `rx` NEGATIVO. Com +14° o ogro empinaria o peito, que é a
   * postura de um humano grande — o oposto de O8.
   *
   * O que a inclinação alcança, medido: o topo da corcunda desce de 23,2 para
   * 22,8 e avança 2,3u em Y. Como `artY = (x + y)/2 − z`, avançar em Y desce na
   * tela quase tanto quanto perder altura — a massa toda cai para a frente, e é
   * isso que se lê como peso.
   *
   * O que ela NÃO alcança: o rig de §12.3 é PLANO (cabeça e braços são irmãos
   * do torso, não filhos), então girar `torso` não arrasta nem a cabeça nem os
   * braços. Por isso a cabeça é posta à frente pela GEOMETRIA
   * (`PROPORCOES_OGRO.yCabeca`) e os braços pendem para a frente pelas
   * coordenadas das caixas (`AJUSTES_OGRO.maoEsqY`). Rodar os três nós na pose
   * daria o mesmo desenho e esconderia três ângulos mágicos em tabela.
   */
  torsoInclinacao: -14,

  /**
   * Abertura dos braços em repouso. Convenção: um membro se estende no −Z
   * local, então `ry > 0` leva a extremidade para −X. O braço da marreta mora
   * em −X (`ry > 0` o abre para fora) e o do arremesso em +X (`ry < 0`).
   *
   * O braço da marreta fica em 6°: cada grau a mais empurra a arma para fora e
   * alarga o quadro — ver a conta de oclusão em `criarMarreta`, que é onde a
   * largura do sprite é decidida.
   *
   * O braço do arremesso vai a −22°, e isso é RODADA 2. Em −8° ele saía da
   * silhueta do peito mas não abria VÃO, e a rodada 1 confundiu as duas coisas:
   * "sair da silhueta" só quer dizer que a peça tem pixels próprios; "abrir vão"
   * quer dizer que existe FUNDO entre ela e o tronco, e é o vão que faz o olho
   * ler um membro. Com −22° e o pivô em 6,6 (ver `PROPORCOES_OGRO.xOmbroDir`)
   * aparece fundo entre o antebraço e o ventre. É também o braço que arremessa
   * (§10), então abri-lo melhora junto a leitura da pose de ataque.
   */
  bracoEsqRy: 6,
  bracoDirRy: -22,

  /**
   * A marreta apoiada (O5), em graus, no nó `marreta`.
   *
   * Convenção de sinal — é o INVERSO da dos membros, pela mesma razão da
   * cimitarra do Goblin: a arma é declarada apontando para +Z a partir da mão
   * (ver `criarMarreta`), e para um apêndice em +Z vale
   * `d = (sen ry, −cos ry · sen rx, cos ry · cos rx)`.
   *
   * RODADA 1 REPROVADA, e este é o defeito mais visível que a revisão apontou —
   * o gêmeo exato do que o dono já tinha reprovado na espada do Goblin, só que
   * pelo lado oposto: lá a arma ATRAVESSAVA o corpo, aqui ela SE SOLTOU dele.
   *
   * Com `rx −110°` a marreta deitava quase na horizontal. Três consequências,
   * todas medidas:
   *   a. a cabeça (4,4 × 4,0 × 4,2) ia parar no NÍVEL DO CHÃO, à frente e à
   *      esquerda, com o centro a −39,4px de arte da âncora contra 32px de meio
   *      tile — fora do losango, no tile vizinho, e no plano do chão, que é
   *      justamente onde a ordem do pintor por antidiagonal erra sem z-buffer;
   *   b. o cabo (1,8u = 4,5px de arte, na MESMA cor `madeira` da cabeça) ficava
   *      inteiramente ocluído pelo saiote e pela perna nas direções 0..3;
   *   c. sobrava na tela um retângulo marrom SOLTO, separado do corpo por
   *      fundo. Lia como um caixote no piso, não como arma empunhada — e o ogro
   *      ficava com as duas mãos aparentemente vazias. O5 morria.
   *
   * RODADA 2 — `rx −58° / ry +10°`. A arma é ERGUIDA: o cabo passa a cruzar o
   * ar ao lado do corpo, silhuetado contra o fundo como a cimitarra do Goblin e
   * o montante do Guerreiro, e a cabeça sobe do chão para a altura do quadril.
   * O `ry` positivo (era negativo) traz a arma para DENTRO em vez de para fora.
   * Conferindo o eixo, que é a conta que decide tudo:
   *
   *   d local  = (sen ry, −cos ry · sen rx, cos ry · cos rx) = (+0.174, +0.835, +0.522)
   *   mão (com `maoEsqY = 1.2` e `bracoEsqRy = 6°`) = (−7.70, 1.60, 4.27)
   *   eixo girado pelos 6° do braço                 = (+0.228, +0.835, +0.526)
   *   centro da cabeça = mão + 4,6 · eixo           = (−6.65, 5.44, 6.69)
   *   → artX = (x − y) · 2,5 = −30,2px  (contra −39,4 da rodada 1)
   *
   * ou seja a cabeça da arma volta para dentro do meio tile de 32px, e a borda
   * de baixo do quadro volta a ser a SOLA. O ponto do cabo mais afastado da mão
   * (o coto, 4,3u para trás do punho) cai em (−8,68, −2,00, 2,01), bem atrás e
   * fora da perna: o cabo é visível dos dois lados do punho, que é o que faz
   * uma arma parecer empunhada.
   *
   * Por que o cabo é gripado no TERÇO INFERIOR e não na ponta: a referência
   * mostra o punho no meio do cabo, com o coto sobrando para trás — e é isso
   * que permite os 7,4u de cabo de O5 ("marreta enorme") num braço que não tem
   * 7,4u de altura livre.
   */
  marretaRx: -25,
  marretaRy: -14
} as const;

/**
 * Os números de §12.4 (animação) que são PRÓPRIOS do Ogro — o "tempero do
 * bicho" em cima do ciclo genérico de `../spriteForge`.
 *
 * Ficam aqui, e não lá, pela mesma razão que a paleta fica aqui: o forge é
 * agnóstico de personagem e não pode ganhar um `if (ogro)`.
 *
 * Estado de consumo, para não haver ilusão: só o ARCO DO ARREMESSO está plugado
 * (via `ARCO_GOLPE_OGRO` → `opts.arcoGolpe` da forja). Respiração, gingado,
 * quique e torção de torso continuam sem consumidor — plugá-los é a fase da
 * animação, e ela abre mais canais em `OpcoesForja`.
 *
 * Nada disto toca o estado do engine. A fase da animação vive na camada de
 * render, alimentada por `dt` (R54).
 */
export const ANIMACAO_OGRO = {
  /**
   * §12.4 `parado`: respiração PESADA E LENTA (multiplicador sobre o ritmo do
   * Guerreiro). O Goblin usa 1.4 — mais rápida; o Ogro usa 0.55, e é a mesma
   * ideia lida ao contrário. Um ogro que respira rápido lê como nervoso, e §12.4
   * é explícita: "jamais movimento nervoso".
   */
  respiroRitmo: 0.55,
  /** §12.4 `parado`: "o peito infla 0.5u, a corcunda acompanha", em `u`. */
  infloPeito: 0.5,
  /** §12.4 `andando`: torso balança lateralmente ~5° — o gingado de peso. */
  gingadoLateral: 5,
  /**
   * §12.4 `andando`: quique da passada, em `u`. Menor que o do Guerreiro (1,6)
   * e muito menor que o do Goblin (2,0): quem pesa não salta. Continua acima do
   * piso de 0,4u onde `deslocY` arredonda o deslocamento para zero px de arte.
   */
  quiqueAndar: 1.0,

  /**
   * §12.4 `atacando`: "gira o torso ~20°".
   *
   * SEM CONSUMIDOR, e isto é declaração, não pendência esquecida. A torção de
   * torso do golpe é `TORCAO_GOLPE` em `../spriteForge` — 8°, genérica, e não
   * há canal em `OpcoesForja` para o personagem substituí-la (só o arco do
   * BRAÇO é declarável). As duas saídas seriam abrir um canal novo no forge ou
   * mentir aqui; a terceira, que é a que está implementada, é compensar no
   * arco do braço: `arremessoRx` percorre 66° entre armar e projetar, contra os
   * 50° do arco genérico. O peso do arremesso sai do braço, que é o que se vê.
   */
  torcaoArremesso: 20,

  /**
   * §12.4 `atacando` — o ARREMESSO, quadro a quadro, em graus, no nó
   * `bracoDir`. Somado ao repouso pelo forge, na mesma convenção de sinal dos
   * arcos genéricos de `../spriteForge` (o canal `ry` é multiplicado por
   * `ESPELHO`; o canal `rx` não).
   *
   * Por que o arco genérico não serve, e por que o do Goblin muito menos: os
   * dois descrevem um GOLPE — uma arma que sobe e desce em torno do ombro. Este
   * bicho não bate, ele ARREMESSA (§10): a marreta fica apoiada na mão esquerda
   * e a mão direita joga entulho a 6 tiles. As três poses são recolher, girar e
   * projetar, e a leitura tem de ser de peso, com amplitude maior e pose mais
   * aberta que a do Goblin.
   *
   * Convenção, com o braço do arremesso em +X (ver `criarBracoDir`):
   * `rx > 0` leva a mão para +Y (a frente, a direção do facing) e `rx < 0` a
   * leva para trás; o `ry` aplicado é `−ry` declarado, e o aplicado positivo
   * leva a mão para −X, ou seja ATRAVESSANDO o corpo.
   *
   * A tabela é medida no rig montado, somando os `ry −8°` do repouso (por isso
   * o `ry` efetivo do nó não é o simétrico do declarado):
   *
   *   | quadro      | rx  | ry decl. | ry do nó | mão (x, y, z)        |
   *   |-------------|-----|----------|----------|----------------------|
   *   | 0 recolher  | −32 |      +22 |      −30 | (12.1, −3.9,  5.3)   |
   *   | 1 projetar  | +34 |      −20 |      +12 | ( 2.9,  9.1,  6.7)   |
   *   | 2 assentar  | +14 |       −8 |        0 | ( 5.6,  5.5,  3.9)   |
   *
   * O quadro de IMPACTO é o **1** — é com ele que o `IsoRenderer` sincroniza o
   * clarão de dano, e é entre 0 e 1 que está o grosso do percurso: 16,0u de
   * deslocamento da mão contra 5,3u entre 1 e 2. O arremesso "solta" no quadro
   * 1 e o 2 é a inércia do braço parando, que é onde mora a leitura de peso.
   * Para calibrar: o golpe do Goblin percorre 15,4u de arte no mesmo intervalo,
   * mas com um braço de 5,3u — aqui o braço tem 13,6u e a mão viaja quase o
   * mesmo tanto. É essa razão amplitude/comprimento menor que se lê como lento.
   *
   * O `ry` acompanha o `rx` porque o plano X-Z é o único que a projeção
   * isométrica nunca achata (a mesma causa raiz de `LATERAL` em
   * `../spriteForge`): sem ele o arremesso viveria no plano Y-Z e encolheria em
   * metade das direções — exatamente o defeito que reprovou a rodada 3 do
   * Guerreiro.
   *
   * Teto medido: `rx = −32` no quadro de armar já joga a mão 6,4u atrás do
   * ombro, e cada grau a mais alarga o quadro do atlas (o braço recuado é o
   * extremo direito da silhueta em metade das direções). Ver a conta de
   * enquadramento em `criarMarreta`.
   */
  arremessoRx: [-32, 34, 14],
  arremessoRy: [22, -20, -8]
} as const;

/* ------------------------------------------------------------------ *
 * 4. Utilitários locais (nada disto escapa do módulo)
 * ------------------------------------------------------------------ */

type Vec3 = [number, number, number];

const RAD_POR_GRAU = Math.PI / 180;

/** Graus → radianos. As poses do contrato estão em graus; o rig fala radianos. */
function grausParaRad(graus: number): number {
  return graus * RAD_POR_GRAU;
}

/**
 * O arco do arremesso de §12.4 em RADIANOS, no formato que `forjarAtlas` aceita
 * em `opts.arcoGolpe` (`../spriteForge`).
 *
 * É a única peça de `ANIMACAO_OGRO` que já tem consumidor. Existe como export
 * próprio, e não como campo de `ANIMACAO_OGRO`, porque as duas unidades são
 * diferentes: lá os números são AUTORAIS e estão em graus, como todo ângulo
 * deste arquivo; aqui eles já estão na unidade do rig. Uma constante só, em
 * graus, obrigaria o forge a converter — e converter graus é exatamente o tipo
 * de conhecimento de personagem que ele não pode ter.
 */
export const ARCO_GOLPE_OGRO: { rx: readonly number[]; ry: readonly number[] } = {
  rx: ANIMACAO_OGRO.arremessoRx.map(grausParaRad),
  ry: ANIMACAO_OGRO.arremessoRy.map(grausParaRad)
};

/**
 * Monta uma caixa a partir da notação da tabela da §12.3:
 * `peca(cor, [sx, sy, sz], [cx, cy, cz])`. O centro é opcional (padrão: no pivô
 * do nó) e o contorno de silhueta fica ligado.
 */
function peca(cor: CorOgro, dim: Vec3, centro?: Vec3): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro ?? [0, 0, 0];
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Igual a `peca`, mas SEM contorno próprio (§4.5 do PERSONAGEM.md).
 *
 * A regra vem medida do Guerreiro (rodada 3, §10): o contorno tem 1px de ARTE e
 * é traçado nas duas bordas da peça, então numa peça de 2u de travessia (5px de
 * arte) ele come 2 e sobra 3. Por isso peça pequena não contorna.
 *
 * RODADA 2 — A PROPORÇÃO SE INVERTEU, e a razão é uma quebra de coerência de
 * estilo que a revisão apontou e que é justa. Na rodada 1 braço, antebraço, mão
 * (nos dois braços), coxa, canela, pé e ventre eram TODOS `detalhe()`. Como
 * toda a massa do Ogro é pele em três tons vizinhos e pálidos (#c6dcbb /
 * #a3c096 / #7d9a72), sem linha escura entre as peças o bicho virava um campo
 * contínuo: a única separação interna do modelo inteiro era a diagonal da
 * garganta. O resultado é perverso — ele tem 42% mais pixels que o Guerreiro e
 * MENOS traços legíveis, ou seja a densidade de detalhe despencava justo no
 * personagem maior.
 *
 * Guerreiro e Goblin partilham uma gramática: contorno escuro separando membro
 * de tronco, espaço negativo de fundo dentro da silhueta, acento de alto
 * contraste no rosto. O Ogro desligava as três. Agora ele contorna tudo o que é
 * MEMBRO ou MASSA — peito, ventre, corcunda, ombreira, espinhos, chifres,
 * saiote, os dois braços inteiros, as duas pernas inteiras, a marreta e a
 * pedra — e `detalhe()` fica só onde o contorno cortaria uma superfície
 * contínua: garganta, máscara, testeira, fenda dos olhos, rebites, caveira,
 * ombro solto e o aro da marreta.
 *
 * Uma peça saiu da lista de contornadas no caminho contrário: o `cranio`. Ele
 * traçava um risco preto de 1px atravessando o tronco na diagonal nas direções
 * 0..3 e nos três quadros de ataque, e em dir 3 virava um retângulo preto
 * FLUTUANDO sobre a cabeça — contorno de silhueta de caixa OCLUÍDA traçado por
 * cima da geometria mais próxima, que lê como rachadura no modelo. Ele já é
 * enquadrado pela `garganta` escura embaixo e pela `mascara` na frente, então
 * não perdeu definição nenhuma ao virar `detalhe()`.
 *
 * A silhueta EXTERNA continua fechada de qualquer modo, porque quem a desenha é
 * a máscara de alpha do sprite forge (§2.1 de `../spriteForge`), não isto aqui.
 *
 * O QUE ISSO CUSTA, medido, porque o §7 do PERSONAGEM.md põe um alvo de < 40 ms
 * na forja e este personagem passa dele. Forjando o mesmo rig com TODAS as
 * peças em `detalhe()` a forja fica em ~43 ms; com os contornos da rodada 2,
 * em ~62 ms. São ~19 ms de `tracarContornoNitido` — o traço de silhueta é
 * rasterizado pixel a pixel (Bresenham) por peça e por quadro, e 27 peças
 * contornadas × 72 quadros é o preço.
 *
 * Fica registrado como TROCA CONSCIENTE e não como descuido: o Ogro é o maior
 * sprite do jogo, ele já estava acima do alvo antes desta rodada (~50 ms), e o
 * ganho de leitura é o que separa "um seixo pálido" de "um brutamontes" no
 * teste da máscara a 40px. O custo é de INICIALIZAÇÃO, uma vez por modelo, na
 * primeira vez que um ogro é desenhado — não por quadro de jogo. Se algum dia
 * ele incomodar, o lugar de atacar é `tracarContornoNitido` em `../model3d`
 * (deduplicar pixels e emitir corridas horizontais em vez de um `rect()` por
 * pixel), que é otimização de módulo compartilhado e beneficia os quatro
 * personagens — não é apagar contorno deste aqui.
 */
function detalhe(cor: CorOgro, dim: Vec3, centro?: Vec3): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/* ------------------------------------------------------------------ *
 * 5. Nomes dos nós — chaves estáveis de `Pose`
 * ------------------------------------------------------------------ */

/**
 * Os nomes são contrato entre o rig, as poses e a animação (§12.4). Os sete
 * primeiros são exatamente os de `NOS_HUMANOIDE` (`../spriteForge`): é por eles
 * que o ciclo genérico de caminhada e o arco de ataque encontram o corpo do
 * ogro. Um nome errado é SILENCIOSO — o nó simplesmente não gira —, então use
 * estas constantes em vez de string literal solta.
 *
 * `marreta` é o nó extra deste personagem, pelo mesmo motivo da espada do
 * Guerreiro e da cimitarra do Goblin: ela gira na MÃO, não no ombro.
 */
export const NOS_OGRO = {
  raiz: 'raiz',
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  bracoDir: 'bracoDir',
  bracoEsq: 'bracoEsq',
  pernaDir: 'pernaDir',
  pernaEsq: 'pernaEsq',
  marreta: 'marreta'
} as const;

export type NomeNoOgro = (typeof NOS_OGRO)[keyof typeof NOS_OGRO];

/* ------------------------------------------------------------------ *
 * 6. O blockout (§12.3)
 *
 * CHIRALIDADE — este rig NÃO é espelhado em X, e é o único do projeto que não
 * é. A explicação inteira, porque a divergência é deliberada e um "conserto"
 * futuro quebraria O2:
 *
 * Guerreiro e Goblin são autorados espelhados (§6.1 de `./warrior`) por um
 * motivo só: neles a arma mora no braço DIREITO, e a projeção de §4.2 inverte o
 * sentido — pôr o braço direito em −X é o que faz a lâmina cair na ESQUERDA da
 * tela, que é onde as duas referências a mostram.
 *
 * No Ogro a arma mora no braço ESQUERDO, e a referência mostra a corcunda, a
 * ombreira espinhada e a marreta todas do lado ESQUERDO do observador. Como −X
 * projeta para a esquerda da tela, a tabela anatômica da §12.3 já cai no lugar
 * certo SEM espelho: `corcunda cx −3.4`, `ombreira.esq cx −5.6` e
 * `bracoEsq pivô (−5.6, …)` ficam onde estão. Espelhar aqui inverteria a
 * referência horizontalmente de graça.
 *
 * A ÚNICA exceção são as PERNAS, e ela é obrigatória: o ciclo de caminhada de
 * `../spriteForge` abre a `pernaDir` com `ry` positivo, o que só afasta a bota
 * do corpo se a `pernaDir` viver em −X (é a constante `ESPELHO` de lá). Com as
 * pernas na posição anatômica o ciclo CRUZARIA as pernas em vez de abri-las.
 * Como as duas pernas são geometricamente idênticas, o nome é puro contrato de
 * animação e não tem consequência visual — ver `criarPerna`.
 *
 * Resumo operacional: `bracoEsq` (marreta) em −X, `bracoDir` (arremesso) em +X,
 * `pernaDir` em −X, `pernaEsq` em +X.
 * ------------------------------------------------------------------ */

const P = PROPORCOES_OGRO;
const AJ = AJUSTES_OGRO;

/**
 * quadril — pelve, saiote de pele e a fivela de caveira (O7).
 *
 * O saiote foi ENCURTADO em relação à §12.3 (4,4u de altura descendo a z 3,6),
 * e a razão é a lição mais cara da rodada 1 do Goblin: lá a tanga cobria a coxa
 * inteira e, sendo da mesma cor da canela, transformava tudo do cinto aos pés
 * num tijolo bege sem perna nenhuma dentro. Aqui o saiote fecha em z 4,4..8,8 e
 * a coxa em 3,6..7,8 — sobra 0,8u de coxa abaixo dele, e a canela inteira
 * (0,6..4,0) fica livre, em `peleBase` clara contra o `couroBase` escuro.
 *
 * A caveira (O7) avança até y +4,3, à frente da pelve (y +3,2), pelo mesmo
 * motivo que o olho do Goblin precisou avançar: faces coplanares EMPATAM na
 * ordem do pintor (§4.4) e o resultado é ruído em vez de peça. Em `osso`, a cor
 * mais clara da paleta, ela é o único ponto de luz no meio da massa escura do
 * saiote — é ela que impede o quadril de virar uma barra marrom.
 */
function criarQuadril(): No {
  return {
    nome: NOS_OGRO.quadril,
    pivo: [0, 0, P.zQuadril],
    caixas: [
      detalhe('peleMeio', [9.0, 6.4, 3.4]), //  pelve
      peca('couroBase', [9.8, 7.2, 4.4], [0, 0.2, -2.0]), //  saiote   ← O7
      detalhe('osso', [2.4, 1.2, 2.2], [0, 3.7, -1.1]) //  caveira  ← O7
    ]
  };
}

/**
 * torso — peito, ventre e, do lado ESQUERDO e só dele, a corcunda com a
 * ombreira espinhada. É o nó que carrega O2, o traço sem o qual este bicho é um
 * humano grande.
 *
 * A ASSIMETRIA, medida, para ninguém "consertar" isto por simetria:
 *
 *   lado da corcunda (−X)   massa de −9,0 (ponta do espinho a) a −0,4
 *   lado livre       (+X)   massa de  +2,9 a +7,9 (ombro direito)
 *   topo da corcunda        z 23,42  ·   topo do ombro direito   z 17,23
 *   topo dos espinhos       z 25,53  ·   topo da testeira        z 21,35
 *
 * — ou seja o ombro esquerdo sobe 6,2u acima do direito, a corcunda passa 2,1u
 * ACIMA DA CABEÇA e os espinhos, 4,2u, que é a letra de O2. Duplicar a corcunda
 * do outro lado devolveria a silhueta de barril simétrico que a §12.1 chama de
 * errada.
 *
 * OS ESPINHOS, e por que eles subiram na RODADA 2. Na rodada 1 eles existiam no
 * rig e NÃO existiam na tela: `espinho.a` ocupava x −7,7..−5,9 DENTRO do x
 * −8,0..−0,4 da corcunda e sobrava 1,2u (3px de arte) acima dela; depois da
 * projeção e da erosão de 1px do contorno por máscara sobravam três pixels
 * creme no canto — e na direção 0 os três liam como um par de olhos fechados,
 * um rosto acidental no ombro. O4, que a §12.1 põe entre os traços que fazem um
 * ogro parecer ogro, era decorativo.
 *
 * O critério de aceite virou mensurável: cada ponta ≥ 2,5u (6px de arte) acima
 * do topo da corcunda, e pelo menos uma ponta com x < −8,0. Medido agora:
 * espinho.a topa em 24,83 (1,4u acima da corcunda) e vai a x −9,0; espinho.b em
 * 25,53 (2,1u acima) e espinho.c em 23,34, com o conjunto quebrando o contorno
 * em TODAS as 8 direções — a contribuição de máscara dos três somada vale
 * 41/48/102/142/100/76/29/27 px por direção, contra praticamente zero antes.
 * Os três também passaram de `detalhe()` para `peca()`: contra a corcunda
 * `peleLuz`, que é quase tão clara quanto `osso`, sem linha escura eles se
 * dissolviam por dentro do vizinho.
 *
 * A OMBREIRA subiu junto (cz 5,2 → 7,4 e cx −5,8 → −6,2). Na rodada 1 ela
 * ficava SOTERRADA sob a corcunda (z 15,6..19,6 contra 15,9..22,1) e nunca
 * aparecia — os espinhos nasciam da pele nua, que é a leitura de "chifres
 * saindo das costas". Agora ela coroa a corcunda (17,16..22,40) e volta a ser o
 * degrau escuro entre a pele clara e o osso.
 *
 * Os TRÊS espinhos (a §12.3 lista dois; O4 pede "3 a 4") saem em direções
 * diferentes de propósito — um para fora, um para trás, um para a frente. Um
 * leque plano some nas direções em que `artX` só enxerga o eixo Y; espalhados
 * em Y, sempre há pelo menos dois quebrando o topo da silhueta, que é o critério
 * do gate G6 aplicado a esta peça.
 *
 * O `ombro.dir` DESCEU (cz 3,6 → 2,4). Ele chegava a z 18,4, apenas 4,4u abaixo
 * do topo da corcunda, e nas direções 1 e 5 isso deixava o topo da silhueta
 * quase nivelado de ponta a ponta — leitura simétrica, que é o que a §12.1
 * chama explicitamente de errado para O2. Em 17,23 a assimetria abre para 6,2u
 * sem custar um pixel de largura de quadro.
 *
 * A `corcunda` é a única peça `peleLuz` do corpo: na rampa `pele` ela sai
 * luz/luz/base, um degrau acima do resto, e é esse contraste que a separa do
 * peito em vez de fundi-la nele. É o mesmo truque das orelhas do Goblin.
 *
 * A ombreira em `couroSombra` é a cor mais escura da família parda: ela dá o
 * degrau escuro entre a corcunda clara e os espinhos de osso, sem gastar
 * outline. Sem ela os espinhos nascem direto da pele e leem como chifres
 * saindo das costas.
 */
function criarTorso(): No {
  return {
    nome: NOS_OGRO.torso,
    pivo: [0, 0, P.zTorso],
    caixas: [
      peca('peleMeio', [9.2, 6.6, 3.4], [0, 0, -4.2]), //  ventre
      peca('peleBase', [10.6, 7.0, 8.0], [0, 0, 0.6]), //  peito
      peca('peleLuz', [7.6, 6.8, 6.2], [-4.2, 0, 7.2]), //  corcunda    ← O2
      peca('couroSombra', [5.2, 5.6, 4.0], [-6.2, 0, 7.4]), //  ombreira    ← O4
      peca('osso', [2.0, 2.0, 5.2], [-8.0, 0.2, 9.8]), //  espinho.a   ← O4
      peca('osso', [1.8, 1.8, 4.6], [-5.6, -3.2, 10.0]), //  espinho.b   ← O4
      peca('osso', [1.7, 1.7, 4.2], [-5.2, 3.4, 9.6]), //  espinho.c   ← O4
      detalhe('peleBase', [5.0, 5.4, 3.4], [5.4, 0, 2.4]) //  ombro.dir
    ]
  };
}

/**
 * CHIFRE DE CARNEIRO (O3) — TRÊS caixas por chifre, e a curva sai do arranjo
 * delas, não de uma caixa torta.
 *
 * RODADA 2 — os chifres saíram de dentro da silhueta. Na rodada 1 eles iam de
 * |x| 2,8 a 4,4 num corpo cujos ombros vão a −8,4 e +7,9: estavam INTEIROS
 * dentro do contorno nas 8 direções e clareavam o crânio por 4px sem nunca
 * quebrar o perfil. No zoom o que se via era uma mancha cinza-marrom dentro do
 * crânio pálido — lia como sujeira, não como chifre. O3 não existia na tela.
 *
 * Três mudanças, medidas: (a) o eixo do chifre foi de ±3,6 para ±5,2, de modo
 * que a `base` ocupa |x| 4,1..6,3 contra os ±2,8 do crânio e a `volta` chega a
 * |x| 7,76 — fora do crânio, fora da testeira e, do lado livre, fora do ombro;
 * (b) a `volta` desce ABAIXO da linha da máscara (cz −1,2), onde nada mais
 * ocupa e a silhueta é quebrada de graça; (c) entrou a TERCEIRA caixa, a
 * `ponta`, porque duas caixas leem como um "L" e três leem como volta de
 * carneiro. Medido: a base do chifre livre contribui 81/48/20/0/23/76/53/71 px
 * de máscara por direção.
 *
 * A `volta` e a `ponta` são `ossoSombra` e não `osso`: `osso` (#e8e0cc) sobre a
 * testeira `metalLuz` (#dccfa6) é diferença de luminância pequena demais, e o
 * chifre desaparecia por dentro do próprio vizinho. As duas primeiras caixas
 * também ganharam contorno (`peca`), pelo mesmo motivo dos espinhos.
 *
 * `Caixa` não tem rotação: quem gira é o NÓ, e um chifre que precisasse de nó
 * próprio para existir seria dois nós a mais na árvore para ganhar um grau de
 * liberdade que nenhuma animação usa. A cura é a mesma da cimitarra do Goblin e
 * do escudo do Guerreiro — aproximar a forma por caixas escalonadas:
 *
 *   base   sai da têmpora para FORA e para TRÁS, deitada (3,8u de profundidade)
 *   volta  desce à FRENTE da máscara, em pé (3,2u de altura)
 *
 * O ângulo entre as duas é de ~90°, e é ele que se lê como a volta do chifre de
 * carneiro. Um chifre reto leria como chifre de touro e mataria O3.
 *
 * As duas caixas têm bitola de 1,6 e 1,4u — 4,0 e 3,5px de arte. É bem acima do
 * piso de ~2px onde uma peça se desfia em pontilhado depois da rasterização (a
 * medição que engrossou a lâmina do Guerreiro na rodada 3), e precisa ser: os
 * chifres cruzam a máscara, que é `metalBase` clara, e um chifre fino ali
 * desapareceria por dentro do próprio vizinho.
 *
 * `lado > 0` é o chifre do lado da corcunda (−X). Ver a nota de chiralidade da
 * §6: este rig não é espelhado, mas os chifres são simétricos e não se importam.
 */
function criarChifre(lado: 1 | -1): Caixa[] {
  const x = lado * 5.2;
  return [
    peca('osso', [2.2, 4.6, 2.0], [x, -0.8, 1.6]), //  base  — para fora, para trás e para CIMA
    peca('ossoSombra', [1.8, 2.0, 4.0], [x * 1.32, 1.2, -1.2]), //  volta — desce à frente do rosto
    detalhe('ossoSombra', [1.5, 1.5, 1.5], [x * 1.15, 2.6, -3.6]) //  ponta — fecha a volta de carneiro
  ];
}

/**
 * cabeca — crânio, máscara de metal com chifres de carneiro (O3) e a fenda dos
 * olhos. É a peça que a silhueta ESCONDE de propósito.
 *
 * O contrassenso aparente: num personagem de 24u a cabeça mede 4,6u e some
 * entre os ombros. É O2 e O8 juntos — na referência a cabeça está afundada,
 * mais baixa que o ombro esquerdo e projetada para a frente, e é exatamente
 * isso que faz o bicho não ler como "humano grande". Se a cabeça subir acima da
 * corcunda, a leitura de ogro se perde por inteiro.
 *
 * Quatro decisões que a grade de arte obrigou:
 *
 * 1. a `garganta` em `peleSombra` existe pelo mesmo motivo que a do Goblin:
 *    crânio (base 15,8) e peito (topo 17,1) são as duas massas de pele e se
 *    interpenetram, e sem uma faixa escura entre elas a cabeça não se separa do
 *    tronco em nenhuma direção. Ela avança até y +3,8, à frente do peito, senão
 *    não desenha pixel nenhum — sem z-buffer quem manda é a ordem do pintor, e
 *    uma peça contida no volume do vizinho é sempre coberta por ele;
 * 2. a `mascara` avança 0,7u além da face do crânio (O3). Coplanar com ele,
 *    empataria na ordem do pintor;
 * 3. os `olhos` são uma fenda `vazio` de 0,6u de altura (1,5px de arte),
 *    avançada 0,25u à frente da máscara pelo mesmo motivo. Não são emissivos —
 *    ver `CORES_EMISSIVAS_OGRO`;
 * 4. a `testeira` em `metalLuz` é o ponto mais claro do bicho e fica no topo da
 *    cabeça. É o que dá um alvo para o olho no meio de uma silhueta que é
 *    quase toda verde-acinzentada — e o que substitui, com vantagem, a brasa
 *    que este monstro não tem.
 */
function criarCabeca(): No {
  return {
    nome: NOS_OGRO.cabeca,
    pivo: [0, P.yCabeca, P.zCabeca],
    caixas: [
      detalhe('peleSombra', [4.6, 4.0, 1.4], [0, 0.8, -2.6]), //  garganta
      detalhe('peleBase', [5.6, 5.4, 4.6]), //  cranio
      detalhe('metalBase', [5.4, 1.6, 4.2], [0, 2.6, -0.1]), //  mascara   ← O3
      detalhe('vazio', [3.2, 0.5, 0.6], [0, 3.4, 0.5]), //  olhos
      detalhe('metalLuz', [5.6, 3.6, 1.3], [0, 0.2, 2.6]), //  testeira  ← O3
      ...criarChifre(1), //  chifre do lado da corcunda  ← O3
      ...criarChifre(-1) //  chifre do lado livre        ← O3
    ]
  };
}

/**
 * marreta (O5) — cabo, aros de metal e a cabeça, declarada por ÚLTIMO dentro do
 * braço esquerdo (§4.4: a arma é o caso limite da ordem do pintor).
 *
 * Como no Guerreiro e no Goblin, o blockout da §12.3 é autocontraditório neste
 * ponto: ele lista as peças DESCENDO a partir da mão (`cz −13.0` e `cz −17.4`,
 * no mesmo −Z em que o braço se estende), o que com a mão a 4,4u do chão
 * enfiaria a cabeça da marreta 13u ABAIXO dele. A compensação é feita na
 * DECLARAÇÃO, não na pose: o nó é ancorado no centro da mão e as peças são
 * declaradas ao longo do +Z local, com o cabo ATRAVESSANDO o pivô — o punho
 * agarra o terço inferior do cabo e sobra coto para trás, como na referência.
 * Quem deita a marreta no chão é `POSE_PARADA_OGRO`, com os dois ângulos
 * documentados em `ANGULOS_OGRO.marretaRx`.
 *
 * TRÊS CORES, TRÊS PEÇAS — e na rodada 1 eram duas cores para três peças, que é
 * por que a arma lia como um tijolo só. O cabo era `madeira` e a cabeça também:
 * juntos davam um bloco marrom sem articulação nenhuma. Agora o cabo é
 * `madeira` (rampa de três tons neste rig — couroBase/madeira/couroSombra, o
 * que dá volume a uma barra fina), a cabeça é `metalSombra` e a banda é `osso`,
 * a cor mais clara da paleta, cruzando a cabeça como um aro. São três degraus
 * de luminância em três peças vizinhas: o olho separa cabo, cabeça e aro sem
 * precisar de contorno em cada um.
 *
 * O CABO engordou de 1,8 para 2,4u (4,5 → 6px de arte) e ganhou contorno
 * (`peca`). Com 4,5px e a mesma cor da cabeça ele simplesmente não existia:
 * era comido pela perna atrás nas direções em que encostava, e nas outras lia
 * como sombra da cabeça. Uma arma cujo cabo não se vê não é uma arma — é um
 * objeto flutuando ao lado do personagem, que foi exatamente o veredito da
 * revisão.
 *
 * ENQUADRAMENTO — esta peça é quem decide a LARGURA do quadro do atlas, e o
 * número está aqui porque é aqui que ele se mexe. Com a pose de repouso da
 * rodada 2, o centro da cabeça da marreta cai em (−8,39, +3,53, +8,50). Na
 * projeção de §4.2, `artX = (x − y) · 2,5`, ela vale **−29,8px** de arte contra
 * os 32px de meio tile — dentro do losango. Na rodada 1 valia −39,4px, ou seja
 * a cabeça da arma vivia no tile VIZINHO, e no plano do chão, que é onde a
 * ordem do pintor por antidiagonal erra sem z-buffer. Ver a conta de §12.5 na
 * §2, que agora separa `artX` de `artY` justamente por causa disto.
 *
 * A tentação de encurtar o cabo é o caminho errado: "marreta enorme" é O5, e é
 * ela que dá ao `sentinel` a leitura de ameaça que o arremesso não dá. O que se
 * pode mexer, se a revisão pedir, é `ANGULOS_OGRO.marretaRy` — medido no
 * varrimento da rodada 1, cada 6° de fechamento traz o extremo ~0,6u para
 * dentro e devolve ~2px de arte de quadro, ao custo de a marreta encostar na
 * perna.
 *
 * PENDÊNCIA HONESTA: com a arma erguida ao lado do quadril, a cabeça da marreta
 * fica INTEIRAMENTE ocluída pelo tronco na direção 4 (área medida: 0 px²) e
 * fraca na 3 (27 px²). É o preço de a arma viver dentro do raio do corpo, e a
 * saída — empurrá-la para fora — devolve o extremo de `artX` para além do meio
 * tile, que é o defeito que esta rodada acabou de consertar. Nas outras seis
 * direções ela mede 79 a 306 px². Fica registrado para a próxima revisão
 * decidir qual dos dois problemas prefere.
 */
function criarMarreta(): No {
  return {
    nome: NOS_OGRO.marreta,
    pivo: [0, AJ.maoEsqY, AJ.maoEsqZ],
    caixas: [
      peca('madeira', [2.4, 2.4, 7.4], [0, 0, 0.2]), //  cabo (atravessa o punho)
      detalhe('metalSombra', [2.6, 2.6, 0.5], [0, 0, 3.2]), //  aro superior
      peca('metalSombra', [4.0, 3.6, 3.8], [0, 0, 4.7]), //  cabeça  ← O5
      detalhe('osso', [4.2, 3.8, 1.2], [0, 0, 4.7]) //  banda de ferro
    ]
  };
}

/**
 * bracoEsq — o braço que APOIA a marreta (O5). Mora em −X, o lado da corcunda
 * (ver a nota de chiralidade da §6).
 *
 * A CURVA do braço está na geometria, e isto contraria a leitura ingênua da
 * §12.3 (braço, antebraço e mão empilhados em −Z, um braço reto pendurado). O
 * motivo é o mesmo que dobrou o cotovelo do Goblin: o rig de §12.3 é PLANO —
 * braço, antebraço e mão são caixas do MESMO nó, não nós encadeados —, então
 * não existe junta de cotovelo para dobrar por pose, e um braço reto de 12u
 * girando no ombro descreve um círculo de raio 12: qualquer rotação que traga a
 * mão para a frente também a joga 12u para fora do corpo.
 *
 * Aqui as três caixas derivam progressivamente em +Y (0,6 → 1,8 → 2,6): o braço
 * pende do ombro e a mão fecha 2,6u À FRENTE da linha do ombro, que é a postura
 * de gorila de O8 — braços longos pendendo para a frente, não colados no tronco.
 * O antebraço é a peça mais GROSSA do conjunto (4,0u contra 3,6 do braço), que é
 * a desproporção muscular da referência.
 *
 * Comprimento total: do ombro (z 16,6) à base da mão (z 2,8) são 13,8u — 57% da
 * altura do bicho. No Guerreiro o braço vale 7,4u de 18, ou 41%. É O8 medido.
 */
function criarBracoEsq(): No {
  return {
    nome: NOS_OGRO.bracoEsq,
    pivo: [-P.xOmbroEsq, 0.4, P.zOmbroEsq],
    caixas: [
      peca('peleBase', [3.6, 3.6, 6.0], [0, 0.4, -3.2]), //  braço
      peca('peleMeio', [4.0, 4.0, 5.4], [0, 0.9, -8.6]), //  antebraço
      peca('peleBase', [3.8, 4.2, 2.8], [0, AJ.maoEsqY, AJ.maoEsqZ]) //  mão
    ],
    filhos: [criarMarreta()]
  };
}

/**
 * bracoDir — o braço que ARREMESSA (§10 e §12.4). Mora em +X, o lado livre.
 *
 * O nome NÃO é decorativo e não pode ser trocado: `poseDoQuadro`
 * (`../spriteForge`) só aplica o arco de ataque ao nó chamado `bracoDir`, então
 * é este nome que faz o arremesso de `ARCO_GOLPE_OGRO` chegar ao braço certo.
 * Renomear para `bracoArremesso` deixaria o ogro atacando com o braço parado —
 * e em SILÊNCIO, porque um nó ausente da pose simplesmente não gira.
 *
 * A `bracadeira` de couro com rebites de osso é o que a §12.3 pede neste braço,
 * e ela ganha função além do enfeite: o braço do arremesso é o que mais se move
 * no atlas, e uma faixa escura com dois pontos claros no meio dele dá ao olho
 * uma referência para acompanhar o movimento entre os três quadros. Sem ela o
 * braço é um cilindro de pele uniforme e o arremesso lê como borrão.
 *
 * Os rebites moram na face +X (a de FORA): é a face que a projeção de §4.2
 * ilumina com `FATOR_LADO`, a mais escura das três visíveis, e `osso` é a cor
 * mais clara da paleta. O contraste é máximo justamente onde a peça é mais
 * escura. (Rodada 2: eles saíram de `cx 1.5` para `2.0` porque com 1,5 ficavam
 * ENTERRADOS dentro da braçadeira de 3,7u — área medida zero nas 8 direções.
 * Um rebite que não aparece é uma caixa que custa e não paga.)
 *
 * A PEDRA (§10) é a última caixa declarada, pela mesma regra da arma (§4.4): o
 * Ogro é `sentinel` e ATIRA a 6 tiles, e a rodada 1 entregou os três quadros de
 * arremesso com a MÃO VAZIA. Sem projétil o arco lê como espreguiçar ou tacada
 * de golfe — e o arremesso é a única coisa que faz um brutamontes de marreta
 * caber num arquétipo que ataca à distância. Uma caixa de 2,4u (6px de arte) em
 * `metalSombra`, escura contra a pele pálida, dá ao olho o objeto que ele segue
 * entre os três quadros. Medida: 13 a 69 px² visíveis em 6 das 8 direções, e a
 * contribuição de máscara dela é igual à área (ela está sempre na borda da
 * silhueta, que é onde um projétil na mão deve estar).
 */
function criarBracoDir(): No {
  return {
    nome: NOS_OGRO.bracoDir,
    pivo: [P.xOmbroDir, 0.2, P.zOmbroDir],
    caixas: [
      peca('peleBase', [3.3, 3.3, 5.7], [0, 0.4, -3.0]), //  braço
      peca('couroBase', [3.7, 3.7, 2.8], [0, 0.8, -6.4]), //  braçadeira
      detalhe('osso', [0.9, 0.9, 0.9], [2.0, 0.8, -5.6]), //  rebite alto
      detalhe('osso', [0.9, 0.9, 0.9], [2.0, 0.8, -7.2]), //  rebite baixo
      peca('peleMeio', [3.5, 3.5, 5.0], [0, 1.4, -9.6]), //  antebraço
      peca('peleBase', [3.5, 3.8, 2.4], [0, AJ.maoDirY, AJ.maoDirZ]), //  mão
      //  a PEDRA do arremesso (§10) — declarada por ÚLTIMO, como toda arma
      peca('metalSombra', [2.4, 2.4, 2.4], [0, AJ.maoDirY + 1.2, AJ.maoDirZ - 1.6])
    ]
  };
}

/**
 * Perna. As caixas são simétricas em X (todas em `cx = 0` no espaço do nó),
 * então o espelhamento é só o sinal do pivô — nada de duplicar a tabela e
 * arriscar as duas pernas divergirem num ajuste futuro.
 *
 * `pernaDir` sai em −X e `pernaEsq` em +X, ao contrário do resto deste rig (ver
 * a nota de chiralidade da §6). Não é descuido e não tem consequência visual:
 * as duas pernas são a MESMA geometria, e os nomes aqui são contrato de
 * ANIMAÇÃO, não anatomia. O ciclo de `../spriteForge` abre a `pernaDir` com
 * `ry` positivo, o que só afasta a bota do corpo se ela viver em −X; com a
 * perna na posição anatômica o ciclo cruzaria as pernas em vez de abri-las, e o
 * defeito apareceria só no atlas.
 *
 * Pernas CURTAS e GROSSAS (O8): coxa 3,6..7,8 · canela 0,6..4,0 · pé −0,3..1,3.
 * Dão 8,3u de perna contra 24,25u de altura total — 34%, contra 42% do
 * Guerreiro e 34% do Goblin. É a proporção da referência.
 *
 * O PÉ é enorme (5,0 × 6,0u, contra 2,8 × 4,0 da bota do Guerreiro) porque O8
 * pede, mas foi CONTIDO em relação à §12.3 (3,6 × 5,4, razão 1,5:1 → aqui
 * 1,2:1). A razão é medida no Guerreiro (rodada 3): um pé fundo e estreito,
 * cisalhado pelo pivô em x = ±3,2, faz a base da silhueta oscilar entre
 * direções — o boneco "afunda e emerge" do losango ao girar, contra uma sombra
 * elíptica que é fixa. Quadrar o pé em planta corta essa oscilação pela metade.
 *
 * A sola fecha em z −0,3, ou seja o pé afunda 0,3u no plano do chão, de
 * propósito, para o ogro assentar DENTRO do losango do tile em vez de ficar
 * equilibrado em cima dele. A âncora do sprite é o plano z = 0 do modelo, NUNCA
 * a borda de baixo do quadro — há pixels abaixo dela, como no Guerreiro e no
 * Goblin.
 */
function criarPerna(lado: 1 | -1): No {
  return {
    nome: lado > 0 ? NOS_OGRO.pernaDir : NOS_OGRO.pernaEsq,
    pivo: [-lado * P.xPerna, 0, P.zQuadrilPerna],
    caixas: [
      peca('peleMeio', [4.4, 4.4, 4.2], [0, 0, -2.3]), //  coxa
      peca('peleBase', [4.0, 4.0, 3.4], [0, 0.2, -5.7]), //  canela
      peca('peleBase', [5.0, 6.0, 1.6], [0, 1.2, -7.5]) //  pé  ← O8
    ]
  };
}

/**
 * Monta uma árvore NOVA do Ogro. Chame isto (e não mute `MODELO_OGRO`) sempre
 * que precisar de um rig próprio — variantes, testes, previews.
 *
 * A ordem dos filhos importa só para desempate da ordem do pintor (§4.4):
 * quadril e torso antes dos apêndices, braço da arma por último. É a mesma
 * ordem do Guerreiro e do Goblin, de propósito — os três rigs se comportam
 * igual sob o mesmo forge.
 */
export function criarModeloOgro(): No {
  return {
    nome: NOS_OGRO.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [
      criarQuadril(),
      criarTorso(),
      criarCabeca(),
      criarPerna(1),
      criarPerna(-1),
      criarBracoDir(),
      criarBracoEsq()
    ]
  };
}

/** O rig canônico do Ogro, pronto para o sprite forge (§7). Não mute. */
export const MODELO_OGRO: No = criarModeloOgro();

/* ------------------------------------------------------------------ *
 * 7. Pose de repouso (§12.4, estado `parado`)
 * ------------------------------------------------------------------ */

const A = ANGULOS_OGRO;

/**
 * A pose de referência: torso inclinado 14° à frente (O8), braços longos
 * pendendo abertos e a marreta apoiada no chão à frente do pé esquerdo (O5).
 *
 * É a base sobre a qual a animação de §12.4 SOMA respiração, passada e
 * arremesso. Como `poseDoQuadro` (`../spriteForge`) clona o repouso e soma por
 * cima, a inclinação do torso e os dois ângulos da marreta sobrevivem aos 9
 * quadros — inclusive aos três do arremesso, em que a marreta continua apoiada
 * e imóvel enquanto o braço direito trabalha, que é a leitura que §10 pede.
 *
 * Nós ausentes daqui ficam em repouso (rotação zero): quadril, cabeça e as duas
 * pernas. É intencional — a cabeça está baixa e à frente pela GEOMETRIA
 * (`PROPORCOES_OGRO.yCabeca`) e a curva dos braços também
 * (`AJUSTES_OGRO.maoEsqY`), de modo que o repouso não esconde nenhum ângulo
 * mágico e uma pose vazia continuaria produzindo um ogro reconhecível.
 *
 * Para quem integra com o sprite forge (§7): o lugar de passar isto é
 * `opts.repouso`, junto de `paleta`, `rampas`, `rampaDaCor`,
 * `emissivas: CORES_EMISSIVAS_OGRO` e `arcoGolpe: ARCO_GOLPE_OGRO`.
 */
export const POSE_PARADA_OGRO: Pose = {
  [NOS_OGRO.torso]: { rx: grausParaRad(A.torsoInclinacao) },
  [NOS_OGRO.bracoEsq]: { ry: grausParaRad(A.bracoEsqRy) },
  [NOS_OGRO.bracoDir]: { ry: grausParaRad(A.bracoDirRy) },
  [NOS_OGRO.marreta]: {
    rx: grausParaRad(A.marretaRx),
    ry: grausParaRad(A.marretaRy)
  }
};

/* ------------------------------------------------------------------ *
 * 8. Morte do Ogro (fase das cinemáticas de abate — docs/BESTIARIO.md §14)
 *
 * A MESMA técnica da morte do Guerreiro (§8 de `./warrior`) e do Goblin: as
 * poses abaixo NÃO passam pela animação de §12.4 — são REPUSOS de forja
 * congelados na coluna ('parado', 0) de atlases secundários, lidos na direção
 * do facing. A queda da marreta é rotação de TELA no renderer. Nada aqui toca
 * o engine (R54): quem detecta o abate é o IsoRenderer, por observação.
 *
 * O RASTRO do ogro NÃO é o corpo — é a MARRETA pousada sobre a poça de
 * sangue. O corpo cai (`POSE_MORTE_OGRO_CAIDO`), mas some da tela em seguida
 * (esmaece: a masmorra fica com a carcaça, não com a lembrança). É o
 * contraste deliberado com o Goblin, cuja marca é o corpo, e com o Slime,
 * cuja marca é a geleia — lendo o chão da masmorra, o jogador sabe QUEM
 * morreu ali sem ter visto o abate.
 * ------------------------------------------------------------------ */

/**
 * Variante SEM a marreta, para a sequência de morte: `criarModeloOgro()`
 * (árvore NOVA — `MODELO_OGRO` nunca é tocado) com o filho `marreta` de
 * `bracoEsq` podado pelo nome. Mesmo molde de
 * `criarModeloGuerreiroSemEspada`: o corpo é o mesmo, e duas declarações do
 * mesmo corpo divergem no primeiro ajuste visual.
 */
export function criarModeloOgroSemMarreta(): No {
  const modelo = criarModeloOgro();
  const filhos = modelo.filhos ?? [];
  return {
    ...modelo,
    filhos: filhos.map((no) =>
      no.nome === NOS_OGRO.bracoEsq
        ? {
          ...no,
          filhos: (no.filhos ?? []).filter((f) => f.nome !== NOS_OGRO.marreta)
        }
        : no
    )
  };
}

/**
 * A marreta SOZINHA, como mini-rig: um nó raiz com as caixas de
 * `criarMarreta()` ERGUIDAS para ficar em pé a partir da origem — o coto do
 * cabo em z ≈ 0 (as caixas originais nascem com o centro do cabo em z 0,2 e o
 * coto a −3,5: transladadas +3,5 ficam com a base no plano do chão, e a
 * âncora do atlas é o coto, por onde a sequência de morte a faz girar).
 * Forjada com repouso neutro e lida na coluna ('parado', 0): a rotação da
 * queda é de TELA (`ctx.rotate` no renderer), não de pose.
 */
export function criarModeloMarreta(): No {
  return {
    nome: NOS_OGRO.raiz,
    pivo: [0, 0, 0],
    caixas: criarMarreta().caixas.map((c) => ({ ...c, cz: c.cz + 3.5 }))
  };
}

/** Mesmo padrão de `MODELO_OGRO`: constantes de módulo, não mutar. */
export const MODELO_OGRO_SEM_MARRETA: No = criarModeloOgroSemMarreta();
export const MODELO_MARRETA: No = criarModeloMarreta();

/**
 * POSE_MORTE_OGRO_AGACHADO — o cambaleio do brutamontes (fase intermediária,
 * ~0,45–1,0 s).
 *
 * AUTOCONTIDA: forjada como repouso, ela SUBSTITUI `POSE_PARADA_OGRO` —
 * então a inclinação de postura (O8) precisa ser redeclarada aqui dentro,
 * somada ao desabamento: o torso vai de −14° para −30° (em `matPivoRotacao`,
 * para um nó que se estende em +Z é `rx` NEGATIVO que leva o topo para a
 * frente — ver `ANGULOS_OGRO.torsoInclinacao`). As pernas cedem como as do
 * Guerreiro (`pernaDir` rx −70°, o joelho ao chão; `pernaEsq` rx +20°, o pé
 * plantado), a cabeça pende mais 22° e os braços perdem a abertura de
 * repouso e caem moles. Ele é PESADO: o cambaleio lê como um edifício
 * cedendo, não como um tropeço. Sem `marreta`: esta pose é forjada sobre
 * `MODELO_OGRO_SEM_MARRETA`.
 */
export const POSE_MORTE_OGRO_AGACHADO: Pose = {
  [NOS_OGRO.pernaDir]: { rx: grausParaRad(-70) },
  [NOS_OGRO.pernaEsq]: { rx: grausParaRad(20) },
  [NOS_OGRO.torso]: { rx: grausParaRad(-30) },
  [NOS_OGRO.cabeca]: { rx: grausParaRad(-22) },
  [NOS_OGRO.bracoEsq]: { rx: grausParaRad(8), ry: grausParaRad(14) },
  [NOS_OGRO.bracoDir]: { rx: grausParaRad(8), ry: grausParaRad(-28) }
};

/**
 * POSE_MORTE_OGRO_CAIDO — deitado no chão (fase breve: o corpo esmaece logo
 * depois — o rastro que fica é a MARRETA, não ele).
 *
 * A via do Guerreiro (`POSE_CAIDA`): `raiz` em rx +85° tomba o corpo INTEIRO
 * de COSTAS (em `matPivoRotacao`, `rx` positivo leva +Z para −Y), de face
 * para CIMA, estendendo-se a partir da âncora (os pés ficam na origem).
 * Torso −8° e cabeça −12° erguem peito e rosto para fora do plano do chão,
 * rz +15° na cabeça tomba a máscara de lado. Braços abertos (ry ±45°, com o
 * sinal trocado por lado porque este rig NÃO é espelhado — `bracoEsq` mora
 * em −X e abre com `ry` positivo, `bracoDir` em +X abre com `ry` negativo),
 * pernas levemente dobradas e assimétricas. A corcunda (O2) fica POR BAIXO
 * do corpo: o morto de bruços lería como qualquer monte — de costas e de
 * face para cima, a máscara com chifres e o peito largo continuam lendo
 * "ogro" até o esmaecimento.
 */
export const POSE_MORTE_OGRO_CAIDO: Pose = {
  [NOS_OGRO.raiz]: { rx: grausParaRad(85) },
  [NOS_OGRO.torso]: { rx: grausParaRad(-8) },
  [NOS_OGRO.cabeca]: { rx: grausParaRad(-12), rz: grausParaRad(15) },
  [NOS_OGRO.bracoEsq]: { rx: grausParaRad(10), ry: grausParaRad(45) },
  [NOS_OGRO.bracoDir]: { rx: grausParaRad(10), ry: grausParaRad(-45) },
  [NOS_OGRO.pernaDir]: { rx: grausParaRad(15) },
  [NOS_OGRO.pernaEsq]: { rx: grausParaRad(-12) }
};
