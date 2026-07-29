/*
 * ISOROGUE — src/render/characters/goblin.ts
 *
 * O rig do Goblin: paleta canônica (§3 do docs/BESTIARIO.md) e blockout
 * hierárquico de caixas (§5). Reconstrução POR CÓDIGO a partir de
 * docs/ref/goblin-referencia.jpg — nenhuma imagem, nenhum asset, nenhuma URL.
 *
 * Este módulo é o gêmeo de `./warrior` e tem exatamente as mesmas
 * responsabilidades e os mesmos limites:
 *   - é a fonte da verdade da FORMA (árvore de nós, pivôs, caixas);
 *   - é a fonte da verdade da COR (`PALETA_GOBLIN` + rampas de material);
 *   - guarda a pose de repouso (`POSE_PARADA_GOBLIN`) e os números que a revisão
 *     visual (§8) pode mexer sem tocar na estrutura.
 *
 * O que ele NÃO é: não projeta, não rasteriza, não anima e não conhece Canvas.
 * Projeção e faces são de `../model3d`; atlas e animação são de `../spriteForge`.
 * O forge continua agnóstico de personagem — ele recebe `paleta`, `rampas`,
 * `rampaDaCor`, `repouso` e `emissivas` em `opts` e não pergunta quem é o dono.
 *
 * ATENÇÃO ao que este arquivo NÃO faz, por contrato (§0 do BESTIARIO):
 *   - o Goblin é a APARÊNCIA do arquétipo `chaser` que já existe. Nada aqui
 *     encosta em `src/engine/entities.ts`, em `ARCHETYPES`, em `populate()`,
 *     em IA, hp, atk ou range. O golden test congela quais inimigos nascem em
 *     cada semente e não pode mudar de cor por causa de um sprite;
 *   - o `facing` do inimigo é derivado 100% na camada de render (o `IsoRenderer`
 *     já guarda estado por entidade em `vfxOf`). Nenhum campo novo em `Enemy`,
 *     em `snapshot()`, no save ou no oracle.
 *
 * Invariantes:
 *   - Determinístico: zero `Math.random`, zero relógio, zero DOM.
 *   - `criarModeloGoblin()` devolve uma árvore NOVA a cada chamada — nenhum
 *     array é compartilhado entre instâncias.
 *   - Traços de identidade I1..I8 (§2 do BESTIARIO) sobrevivem na silhueta.
 *     Perder as orelhas (I2) transforma o goblin num anão verde; perder a
 *     cimitarra no ombro (I6) ou os olhos (I4) tira a ameaça.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta canônica (§3 do BESTIARIO) — amostrada da referência
 * ------------------------------------------------------------------ */

/**
 * As 15 cores do Goblin, exatamente como a §3 as declara. É a paleta INTEIRA do
 * personagem: o sombreamento de face (§4.3 do PERSONAGEM.md) quantiza para
 * estes tons em vez de gerar cor nova, e é isso que mantém a cara de pixel art.
 * Não acrescente cor aqui sem passar pelo gate G5.
 */
export const PALETA_GOBLIN = {
  peleLuz: '#9ecb63', // topo da cabeça, orelhas contra a luz
  peleBase: '#6f9e3e', // pele em geral
  peleMeio: '#517a2b', // faces laterais
  peleSombra: '#35521c', // faces afastadas, vãos
  couroLuz: '#8d6a3c', // topo do elmo
  couroBase: '#6b4f2a', // elmo, colete, cabo
  couroSombra: '#45311a', // cinto, sombra do couro
  trapo: '#7d7660', // bandagens e tanga puída
  acoLuz: '#e2e8f0', // fio da cimitarra
  acoBase: '#a9b4c1', // corpo da lâmina, espinhos
  acoSombra: '#77828f', // face escura da lâmina
  dente: '#efe7cf', // dentes
  olhoBrasa: '#ff4a32', // EMISSIVA — não recebe modulação de luz (§1.1)
  vazio: '#1b2410', // boca, vãos, sombra interna
  contorno: '#121a0b' // outline
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorGoblin = keyof typeof PALETA_GOBLIN;

/**
 * As rampas de quantização por material (§4.3 do PERSONAGEM.md): o fator de luz
 * da face escolhe um destes tons. A rampa é propriedade do MATERIAL, e o
 * material é propriedade do modelo — por isso ela mora aqui e não no forge.
 *
 * Medido com os fatores canônicos do `model3d` (`GANHO_SOMBRA` 1.15,
 * `REALCE_TOPO` 1.25), uma caixa declarada `peleBase` sai:
 *
 * | face   | normal | alvo  | degrau      |
 * |--------|--------|-------|-------------|
 * | topo   | +Z     | 166,3 | `peleLuz`   |
 * | frente | +Y     | 131,8 | `peleBase`  |
 * | lado   | +X     | 105,1 | `peleMeio`  |
 *
 * — os três tons de verde de I1 numa peça só, e `peleSombra` aparece nos vãos.
 * Mesma conta para `couroBase` (couroLuz/couroBase/couroSombra) e `acoBase`
 * (acoLuz/acoBase/acoSombra).
 *
 * Duas rampas merecem nota:
 *
 * - `trapo` não tem tons próprios na §3 (é uma cor só). Sem rampa de material
 *   ela cairia na rampa DERIVADA de `model3d`, que inventa 4 multiplicações da
 *   cor base — cores fora da §3, gate G5 reprovado por construção. Encadeada em
 *   couroBase/couroSombra ela escurece DENTRO da paleta: a bandagem clara ganha
 *   face lateral parda, que é como a referência sombreia pano.
 * - `brasa` tem UM tom, de propósito. Ver §1.2 abaixo.
 */
export const RAMPAS_GOBLIN = {
  pele: ['peleLuz', 'peleBase', 'peleMeio', 'peleSombra'],
  couro: ['couroLuz', 'couroBase', 'couroSombra', 'vazio'],
  trapo: ['trapo', 'couroBase', 'couroSombra', 'vazio'],
  aco: ['acoLuz', 'acoBase', 'acoSombra', 'vazio'],
  dente: ['dente', 'trapo', 'couroSombra', 'vazio'],
  brasa: ['olhoBrasa'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorGoblin[]>;

/** Rampa a que cada cor de peça pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_GOBLIN = {
  peleLuz: 'pele',
  peleBase: 'pele',
  peleMeio: 'pele',
  peleSombra: 'pele',
  couroLuz: 'couro',
  couroBase: 'couro',
  couroSombra: 'couro',
  trapo: 'trapo',
  acoLuz: 'aco',
  acoBase: 'aco',
  acoSombra: 'aco',
  dente: 'dente',
  olhoBrasa: 'brasa',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorGoblin, keyof typeof RAMPAS_GOBLIN>;

/* ------------------------------------------------------------------ *
 * 1.2 A marcação de EMISSIVA (§1.1 do BESTIARIO) — o formato, explicado
 * ------------------------------------------------------------------ */

/**
 * As cores que IGNORAM a modulação de luz de `quadroModulado()` e saem sempre em
 * brilho pleno: um goblin no escuro vira dois pontos vermelhos encarando você.
 *
 * FORMATO DO CONTRATO — três peças, e as três são necessárias:
 *
 * 1. **Esta lista.** São nomes de CHAVE da `PALETA_GOBLIN` (`'olhoBrasa'`),
 *    nunca hex: quem consome resolve o hex pela paleta que ele já recebeu, então
 *    trocar o vermelho na §3 não deixa a marcação para trás. É o valor que vai
 *    direto em `forjarAtlas(modelo, { …, emissivas: CORES_EMISSIVAS_GOBLIN })` e
 *    o mesmo nome que `tools/preview-entry.ts` procura (`CORES_EMISSIVAS_GOBLIN`
 *    → `CORES_EMISSIVAS` → `EMISSIVAS`) para montar a tira de 4 níveis de luz do
 *    gate G8. Um personagem sem cor emissiva exporta lista vazia ou não exporta
 *    nada — o caminho de tingimento simples continua valendo.
 *
 * 2. **A rampa de UM tom** (`RAMPAS_GOBLIN.brasa`). O atlas é forjado uma vez, em
 *    brilho pleno, e o escurecimento é feito depois, por pixel. Para reconhecer
 *    o pixel do olho depois da rasterização — quando o nome da cor já não existe
 *    e só sobrou RGB — o consumidor pede a `rampaEfetiva()` de `../model3d`
 *    todos os hexes que a quantização pode produzir para aquela cor. Com uma
 *    rampa de 4 tons o olho sairia claro na face de topo e escuro na lateral, e
 *    a máscara teria de casar 4 vermelhos; com UM tom a quantização não tem para
 *    onde ir — as seis faces do olho saem em `#ff4a32` cravado, e a máscara é
 *    uma comparação de igualdade. De quebra é o que faz a brasa NÃO escurecer já
 *    dentro do atlas, que seria o jeito silencioso de perder o efeito.
 *
 * 3. **A distância do hex.** `#ff4a32` está a uma distância enorme de qualquer
 *    outra cor da §3 (a paleta inteira é verde, parda e cinza-aço). Isso importa
 *    porque o snap de paleta do sprite forge (§2.1 de `../spriteForge`) empurra
 *    todo pixel borrado para o degrau mais próximo: um vermelho vizinho faria
 *    pixels de borda virarem "olho" e a máscara emissiva acenderia sujeira em
 *    volta do rosto. Medido: a mistura olho+pele mais desfavorável cai em
 *    `couroLuz`, não em `olhoBrasa` — a máscara sai limpa.
 *
 * Quem NÃO precisa saber de nada disto: o rig (as caixas só declaram `cor`) e o
 * `model3d` (para ele `olhoBrasa` é um material como outro qualquer).
 */
export const CORES_EMISSIVAS_GOBLIN: readonly CorGoblin[] = ['olhoBrasa'];

/* ------------------------------------------------------------------ *
 * 2. Proporções (§4 e §5) — a estrutura, que NÃO se ajusta
 * ------------------------------------------------------------------ */

/**
 * Medidas em `u` (espaço local do modelo: +X direita, +Y frente, +Z cima,
 * origem no centro dos pés). Vêm do blockout obrigatório da §5 — mexer nelas
 * muda a proporção de ~2,5 cabeças (I8) e reprova os gates G1 e G7.
 *
 * A regra de escala da §4 é o coração do gate G7: o Goblin usa a MESMA
 * `ART_POR_U` do Guerreiro, e a diferença de tamanho na tela vem da altura real
 * do modelo (13u contra 18u), nunca de um fator aplicado no sprite. É isso que
 * põe os dois na mesma perspectiva e faz o goblin bater na altura do peito do
 * guerreiro em vez de virar um guerreiro em miniatura.
 */
export const PROPORCOES_GOBLIN = {
  /**
   * §4 ALTURA_MODELO_GOBLIN: da sola ao topo do espinho central do elmo. O
   * blockout fecha em 12,93u (−0,2 a 12,725) — os 13u da §4 quase exatos, contra
   * 18u do Guerreiro. É esta razão, e nenhum fator de escala no sprite, que faz
   * o gate G7 passar.
   *
   * Rodada 1 (§8): o topo do modelo deixou de ser o espinho central (12,45) e
   * passou a ser a PONTA DA ORELHA (12,725) — ver `criarOrelha`. Medido no atlas
   * contra o Guerreiro, corpo contra corpo (sem arma nem contorno), a razão sai
   * 42px / 57px = 74%, contra os 72% de 13u/18u.
   */
  altura: 13,
  /**
   * §4 LARGURA_ORELHAS: ponta a ponta.
   *
   * Rodada 1 (§8): a §4 pede 9u e o blockout fechava em 9,15u — e mesmo assim as
   * orelhas não liam. O comprimento nunca foi o problema (ver `criarOrelha`): o
   * problema era a ALTURA da ponta. Ao levantá-la a raiz também precisou abrir,
   * porque uma escada de três caixas a 48° gasta em X o que ganha em Z. O
   * blockout agora fecha em 10,3u (`2 · (xOrelha 2.3 + 2.35 + 0.5)`), 14% acima
   * da §4 — e é a medida da referência, onde o vão de orelha a orelha é ~1,45×
   * a bitola dos ombros (aqui: 6,8u × 1,45 = 9,9u).
   */
  larguraOrelhas: 10.3,
  /** I8 — cabeça enorme, corpo curto, pernas curtas: ≈2,5 cabeças de altura. */
  cabecas: 2.5,

  /** Altura (z) dos pivôs, medida do chão. Todos da §5, sem alteração. */
  zQuadril: 4.4,
  zTorso: 5.9,
  zCabeca: 8.6,
  zOmbro: 7.9,
  zQuadrilPerna: 4.2,

  /**
   * Meia-bitola dos ombros (§5 pede 2.9).
   *
   * Rodada 1 (§8): I8 estava INVERTIDO. O crânio media 4,4u de largura contra
   * 4,6 do peito e 4,9 do colete — a cabeça era a peça mais ESTREITA do
   * conjunto, e nas direções 3 e 7 cabeça e tronco viravam um retângulo verde
   * único. Num personagem cuja identidade é "cabeça enorme" isso é o defeito de
   * estrutura, não de acabamento.
   *
   * A cura tem duas metades e as duas moram aqui: o tronco ESTREITOU (peito
   * 4.6 → 3.8, colete 4.9 → 4.1, cinto 4.7 → 4.0, ombro 2.0 → 1.8) e a cabeça
   * ENGORDOU (crânio 4.4 → 5.0, elmo 4.7 → 5.3). Com o pivô do braço em 2.6 o
   * ombro fecha em ±3.5 contra ±2.5 do crânio e ±5.15 da ponta da orelha: a
   * massa mais larga do modelo passa a ser a cabeça, que é o que I8 pede.
   *
   * Efeito colateral que precisou de conta: o pivô do braço é também a origem da
   * cimitarra, e aproximá-lo do centro encurta o percurso da lâmina até a nuca.
   * Ver `AJUSTES_GOBLIN.maoY`.
   */
  xOmbro: 2.6,

  /**
   * Meia-bitola das pernas. A §5 pede 1.3; este é o único número de estrutura
   * que a revisão mexeu, e por medição do rig do Guerreiro, não por gosto.
   *
   * Com 1.3 e o pé de 2.0u de largura o vão entre as duas solas vale
   * 2·1.3 − 2.0 = 0.6u = 1,5px de arte. É a mesma armadilha documentada em
   * `PROPORCOES_GUERREIRO.xPerna`: abaixo de ~2px de arte as duas pernas viram
   * uma coluna só e nenhum ciclo de caminhada lê como passo. Com 1.45 o vão vai
   * a 0.9u = 2,25px e sobrevive ao acabamento.
   *
   * Teto: a pelve tem 4.2u de largura (±2.1) e a coxa fecha em ±2.4 — as pernas
   * já saem um pouco por fora do quadril, que é justamente o "pernas curtas e
   * arqueadas" de I8. Passar de 1.5 romperia a leitura de quadril e ele ficaria
   * cambaio, não arqueado.
   */
  xPerna: 1.45,

  /**
   * Meia-bitola da RAIZ das orelhas, medida no crânio (ver `criarOrelha`).
   * Acompanhou o alargamento do crânio (4.4 → 5.0): a raiz precisa nascer sob a
   * aba do elmo, e o elmo agora fecha em ±2.65.
   */
  xOrelha: 2.3
} as const;

/* ------------------------------------------------------------------ *
 * 3. Ajustes de revisão visual (§8) — os únicos números "negociáveis"
 * ------------------------------------------------------------------ */

/**
 * Números que a revisão visual pode mexer sem tocar na árvore de nós nem nas
 * dimensões das caixas.
 */
export const AJUSTES_GOBLIN = {
  /**
   * Altura de montagem da orelha no crânio, relativa ao pivô da cabeça. A §5 põe
   * a caixa da orelha em `cz +0.5`; o nó sobe porque a orelha aqui não é uma
   * caixa e sim uma escada de três (ver `criarOrelha`), e é a PONTA dela que
   * carrega I2.
   *
   * Rodada 1 (§8): com +0.9 a ponta fechava em z 11,18 — contra 11,15 do topo do
   * elmo e 12,45 do espinho central. A orelha NUNCA era o ponto mais alto e
   * portanto nunca quebrava o topo da silhueta; nas direções 3 e 7 as duas
   * viravam um caroço de 2–3px sobre o elmo e o critério da §5 ("nenhuma direção
   * apaga as duas") era violado na letra. Na referência a ponta da orelha é o
   * ponto MAIS ALTO da figura inteira, acima dos espinhos — é isso, e não o
   * comprimento, que faz o olho ler "goblin".
   *
   * Com +1.4 a raiz continua nascendo sob a aba do elmo (z 9,2, contra 9,45 da
   * aba) e a ponta fecha em z 12,73: acima dos 12,45 do espinho central, ou seja
   * a orelha passa a SER o topo do modelo em todas as direções.
   */
  orelhaMontagemZ: 1.4,

  /**
   * Centro da mão direita no espaço de `bracoDir`, e — por construção — o pivô
   * da cimitarra. Os dois saem da MESMA constante de propósito: a arma gira NA
   * MÃO, e uma segunda cópia deste número seria a maneira silenciosa de a lâmina
   * descolar do punho no primeiro ajuste de pose.
   *
   * Rodada 1 (§8): recuou de −1.0 para −1.4 por CONTA, não por gosto. Com o
   * ombro puxado para dentro (`xOmbro` 2.9 → 2.6) a lâmina passa a cruzar o eixo
   * do corpo 0,4u mais cedo, e com os ângulos novos (`cimitarraRx/Ry`) a folga
   * atrás da nuca caía para 0,11u — meio pixel de arte, ou seja, a lâmina
   * encostando no crânio em algumas direções. Recuando a mão 0,4u a folga volta
   * a 0,5u:
   *
   *   travessia de x = 0 em `t = xOmbro / dx` = 2.6 / 0.7193 = 3,61u do punho
   *   y na travessia = −1.4 − 3,61 · 0,5759 = −3,48
   *   meia-espessura projetada da lâmina em Y = 0,72  →  borda dianteira −2,76
   *   nuca do elmo (sy 4.5) = −2,25                   →  0,51u de folga
   */
  maoY: -1.4,
  maoZ: 0.05
} as const;

/**
 * Ângulos da pose de repouso, em GRAUS (a conversão para radianos é feita ao
 * montar `POSE_PARADA_GOBLIN`). Ajustáveis pela revisão visual — gates G1 e G6.
 */
export const ANGULOS_GOBLIN = {
  /**
   * A cimitarra deitada sobre os ombros (I6) — o traço que faz a silhueta ler
   * como "goblin encrenqueiro" à distância.
   *
   * Convenção de sinal, e ela é o INVERSO da dos membros: um membro se estende
   * no −Z local (`ry > 0` leva a extremidade para −X), mas a cimitarra é
   * declarada apontando para +Z a partir da mão (ver `criarCimitarra`). Para um
   * apêndice em +Z vale `d = (sin ry, −cos ry · sin rx, cos ry · cos rx)`: logo
   * `ry > 0` leva a PONTA para +X e `rx > 0` a leva para −Y, o fundo. É o par
   * que joga a lâmina para o outro ombro e para trás da cabeça.
   *
   * Rodada 1 (§8) — o par `rx 74° / ry 55°` REPROVOU, e a medição diz por quê:
   * o eixo da lâmina valia (0.819, −0.551, 0.158), ou seja subia só 9° acima da
   * horizontal, e a ponta fechava em z ≈ 10,9 — ABAIXO do topo do elmo (11,15).
   * Uma lâmina que não passa da cabeça não lê como cimitarra apoiada: lê como
   * tábua. Na direção 1 ela sumia por completo e na 5 virava uma barra cinza
   * atravessada no peito. A referência mostra o contrário — a lâmina sobe em
   * diagonal com a ponta bem acima da cabeça.
   *
   * Com `rx 56° / ry 46°` o eixo vale
   * `(sen 46, −cos 46 · sen 56, cos 46 · cos 56) = (0.719, −0.576, 0.388)`:
   *
   * - sobe 23° acima da horizontal, contra 9° antes;
   * - a ponta (7,95u do pivô da mão, mais o desvio de 0,6u da barriga da lâmina)
   *   fecha em z ≈ 12,7 — acima do elmo (11,15), na linha do espinho central
   *   (12,45) e da ponta da orelha (12,73). É a leitura da referência;
   * - a lâmina continua passando POR TRÁS da cabeça: na travessia do eixo do
   *   corpo ela está em y = −3,48 e a borda dianteira em −2,76, contra a nuca do
   *   elmo em −2,25 — 0,5u de folga (ver a conta em `AJUSTES_GOBLIN.maoY`, que
   *   foi ajustada junto justamente para manter essa folga);
   * - a ordem do pintor (§4.4) fecha o resto sem z-buffer: quando a face frontal
   *   da cabeça é visível, a profundidade da lâmina é sempre MENOR que a dela
   *   (a lâmina está atrás e o desenho é do fundo para a frente); quando o que
   *   se vê é a nuca, a relação se inverte sozinha e a lâmina aparece na frente
   *   das costas — que é o certo.
   *
   * O parágrafo da rodada anterior dizia que "baixar de ~70° enfia a lâmina na
   * cabeça". Aquela conta valia para `ry 55`, onde a lâmina corre quase paralela
   * ao plano frontal; com `ry 46` ela sai mais para o lado por unidade de
   * profundidade e o limite se desloca. O que continua verdade: subir `rx` além
   * de ~75° deita a lâmina na horizontal e ela some no perfil.
   */
  cimitarraRx: 56,
  cimitarraRy: 46,

  /**
   * O braço esquerdo, que só pende. `ry < 0` porque este braço mora em +X (o rig
   * é autorado espelhado, ver §6.1 de `./warrior`) e para um membro que se
   * estende em −Z é `ry < 0` que leva a extremidade para +X, ou seja, para FORA.
   *
   * Rodada 1 (§8): com −12° o braço era ENGOLIDO pelo tronco. O pivô ficava em
   * x +2,9 e a caixa de 1,5u ocupava 2,15..3,65, enquanto o ombro já ocupava
   * 1,8..3,8 — o antebraço nunca saía da silhueta e I7 (bandagens no braço)
   * ficava sem suporte visual. Na direção 1 não havia braço nenhum do lado
   * livre.
   *
   * Com −24°/+10° e o tronco estreitado, o antebraço (em `trapo`, claro) fica
   * centrado em x ≈ 3,8 contra ±2,05 do colete: sobra ~1,1u = 2,7px de arte de
   * fundo entre os dois, e a barra clara do braço destaca contra o couro escuro.
   * É também a pose da referência, com a mão apoiada na cintura.
   */
  bracoEsqRx: 10,
  bracoEsqRy: -24
} as const;

/**
 * Os números de §6 (animação) que são PRÓPRIOS do Goblin — o "tempero do bicho"
 * em cima do ciclo genérico de `../spriteForge`.
 *
 * Ficam aqui, e não lá, pela mesma razão que a paleta fica aqui: o forge é
 * agnóstico de personagem e não pode ganhar um `if (goblin)`.
 *
 * Estado de consumo, para não haver ilusão: só o ARCO DO GOLPE está plugado
 * (via `ARCO_GOLPE_GOBLIN` → `opts.arcoGolpe` da forja). Respiração, balanço de
 * orelha, inclinação e quique continuam sem consumidor — plugá-los é a fase da
 * animação, e ela abre mais canais em `OpcoesForja`.
 *
 * Nada disto toca o estado do engine. A fase da animação vive na camada de
 * render, alimentada por `dt` (R54).
 */
export const ANIMACAO_GOBLIN = {
  /** §6 `parado`: respiração mais rápida que a do Guerreiro (multiplicador). */
  respiroRitmo: 1.4,
  /** §6 `parado`: leve balanço das orelhas, em graus, nos nós `orelha*`. */
  balancoOrelha: 5,
  /** §6 `andando`: torso inclina ~6° para a frente (o Guerreiro usa 2,5°). */
  inclinacaoAndar: 6,
  /** §6 `andando`: passo curto e SALTITANTE — quique maior, em `u`. */
  quiqueAndar: 2.0,

  /**
   * §6 `atacando` — o GOLPE DESCENDENTE, quadro a quadro, em graus, no nó
   * `bracoDir`. Somado ao repouso pelo forge, na mesma convenção de sinal dos
   * arcos genéricos de `../spriteForge` (o canal `ry` é multiplicado por
   * `ESPELHO` na aplicação; o canal `rx` não).
   *
   * Rodada 1 (§8): o arco GENÉRICO reprovou neste bicho, e a causa é geométrica.
   * O guerreiro segura a espada apontando para +Z a partir da mão, quase
   * alinhada com o eixo do braço; o goblin apoia a cimitarra DEITADA sobre o
   * ombro, então o vetor punho→ponta tem uma componente −Y enorme. Nesse
   * arranjo o sinal se inverte: `rx` positivo BAIXA a ponta e `rx` negativo a
   * levanta. Aplicado cru, o arco genérico (`+25 / −25 / −5`) fazia a ponta
   * viajar z 6,5 → 16,0 → 13,3 — o bicho erguia a cimitarra e parava. Medido na
   * bancada, a lâmina percorria 2px de arte nos três quadros, com o ponto mais
   * ALTO no quadro do meio: o goblin ameaçava e não batia.
   *
   * O arco daqui é monotonicamente DESCENDENTE, medido no eixo de tela da
   * direção 2 (`artY = (x + y)/2 − z`, onde o giro é zero):
   *
   *   | quadro | rx  | ry  | ponta da lâmina | `artY` da ponta |
   *   |--------|-----|-----|-----------------|-----------------|
   *   | 0 armar    | −25 | +25 | (1,05, −2,70, 15,46) | −16,3 |
   *   | 1 impacto  | +55 | −25 | (4,12, −3,96,  3,79) |  −3,7 |
   *   | 2 assentar | +75 | −35 | (4,17, −1,17,  2,38) |  −0,9 |
   *
   * ou seja 15,4u de arte de percurso, com o grosso dele ENTRE os quadros 0 e 1
   * — o quadro de impacto é o **1**, e é com ele que o `IsoRenderer` sincroniza
   * o clarão de dano. No quadro 2 a ponta fecha em z 2,38, abaixo do quadril
   * (4,4): o golpe termina embaixo, como §6 pede.
   *
   * O `ry` acompanha porque o plano X-Z é o único que a projeção isométrica
   * nunca achata (a mesma causa raiz de `LATERAL` em `../spriteForge`): sem ele
   * o arco viveria no plano Y-Z e encolheria em metade das direções.
   */
  golpeRx: [-25, 55, 75],
  golpeRy: [25, -25, -35]
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
 * O arco do golpe de §6 em RADIANOS, no formato que `forjarAtlas` aceita em
 * `opts.arcoGolpe` (`../spriteForge`).
 *
 * É a única peça de `ANIMACAO_GOBLIN` que já tem consumidor. Existe como export
 * próprio, e não como campo de `ANIMACAO_GOBLIN`, porque as duas unidades são
 * diferentes: lá os números são AUTORAIS e estão em graus, como todo ângulo
 * deste arquivo; aqui eles já estão na unidade do rig. Uma constante só, em
 * graus, obrigaria o forge a converter — e converter graus é exatamente o tipo
 * de conhecimento de personagem que ele não pode ter.
 *
 * Quem não passa isto (o Guerreiro) continua com o arco genérico do forge, byte
 * a byte: `opts.arcoGolpe` ausente não muda um pixel.
 */
export const ARCO_GOLPE_GOBLIN: { rx: readonly number[]; ry: readonly number[] } = {
  rx: ANIMACAO_GOBLIN.golpeRx.map(grausParaRad),
  ry: ANIMACAO_GOBLIN.golpeRy.map(grausParaRad)
};

/**
 * Monta uma caixa a partir da notação da tabela da §5:
 * `peca(cor, [sx, sy, sz], [cx, cy, cz])`. O centro é opcional (padrão: no pivô
 * do nó) e o contorno de silhueta fica ligado.
 */
function peca(cor: CorGoblin, dim: Vec3, centro?: Vec3): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro ?? [0, 0, 0];
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Igual a `peca`, mas SEM contorno próprio (§4.5 do PERSONAGEM.md). É o PADRÃO
 * deste rig: só duas peças traçam contorno.
 *
 * A regra vem medida do Guerreiro (rodada 3, §10): o contorno tem 1px de ARTE e
 * é traçado nas duas bordas da peça, então numa peça de 2u de travessia (5px de
 * arte) ele come 2 e sobra 3 — com dezenove peças contornadas, metade do sprite
 * virava linha preta e a figura perdia cabeça, ombro e perna.
 *
 * O Goblin é AINDA mais sensível a isso: ele tem 13u contra 18u do Guerreiro, ou
 * seja ~32px de arte de altura, e peças como a lâmina (0,9u = 2,25px) ou o
 * espinho do elmo (0,8u = 2px) desapareceriam por dentro do próprio outline. Por
 * isso só `cranio` e `colete` — as duas maiores massas, e as que fazem silhueta
 * externa — traçam contorno próprio. Todo o resto se lê por COR contra a peça
 * vizinha, e a silhueta EXTERNA continua fechada porque quem a desenha é a
 * máscara de alpha do sprite forge (§2.1 de `../spriteForge`), não isto aqui.
 */
function detalhe(cor: CorGoblin, dim: Vec3, centro?: Vec3): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/* ------------------------------------------------------------------ *
 * 5. Nomes dos nós — chaves estáveis de `Pose`
 * ------------------------------------------------------------------ */

/**
 * Os nomes são contrato entre o rig, as poses e a animação (§6). Os sete
 * primeiros são exatamente os de `NOS_HUMANOIDE` (`../spriteForge`): é por eles
 * que o ciclo genérico de caminhada e o golpe encontram o corpo do goblin. Um
 * nome errado é SILENCIOSO — o nó simplesmente não gira —, então use estas
 * constantes em vez de string literal solta.
 *
 * `orelhaEsq`/`orelhaDir` e `cimitarra` são os nós extras deste personagem: as
 * orelhas existem como nó (e não só como caixa) para que o balanço de §6 tenha
 * onde morar, e a cimitarra pelo mesmo motivo que a espada do Guerreiro — ela
 * gira na mão, não no ombro.
 */
export const NOS_GOBLIN = {
  raiz: 'raiz',
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  bracoDir: 'bracoDir',
  bracoEsq: 'bracoEsq',
  pernaDir: 'pernaDir',
  pernaEsq: 'pernaEsq',
  orelhaDir: 'orelhaDir',
  orelhaEsq: 'orelhaEsq',
  cimitarra: 'cimitarra'
} as const;

export type NomeNoGoblin = (typeof NOS_GOBLIN)[keyof typeof NOS_GOBLIN];

/* ------------------------------------------------------------------ *
 * 6. O blockout (§5)
 *
 * CHIRALIDADE — o rig é autorado ESPELHADO em X, como o do Guerreiro. A prova
 * está em §6.1 de `./warrior` e vale para o projeto inteiro (quem projeta é
 * `../model3d`, e a projeção de §4.2 inverte o sentido): o braço que empunha a
 * arma mora em −X para a lâmina cair na ESQUERDA da tela nas vistas de frente,
 * que é onde a referência do goblin a mostra — punho à esquerda, lâmina varrendo
 * para a direita por trás da cabeça. As pernas seguem o mesmo espelho, e a
 * animação genérica de `../spriteForge` já assume esse espaço (a constante
 * `ESPELHO` de lá). As orelhas e os espinhos são simétricos e não se importam.
 * ------------------------------------------------------------------ */

const P = PROPORCOES_GOBLIN;
const AJ = AJUSTES_GOBLIN;

/**
 * quadril — pelve de couro e a tanga esfarrapada (I7).
 *
 * Rodada 1 (§8) — AS PERNAS SUMIAM. A tanga da §5 (4.6 × 3.2 × 2.4, descendo a
 * z 1,8) cobria a coxa INTEIRA (2,35..4,25) e encostava na canela, que por sua
 * vez era da MESMA cor `trapo`: do cinto até os pés saía um retângulo bege
 * único, com um entalhe de 2px de arte no meio. "Pernas curtas e arqueadas"
 * (I8) não lia, e nenhum ciclo de caminhada leria como passo — o vão entre as
 * pernas existia, mas recortado contra bege, não contra verde.
 *
 * A tanga encurtou para 1.6u de altura e subiu para z 2,6..4,2: ela ainda cobre
 * a metade de cima da coxa (é uma tanga, não uma saia) e libera a de baixo. A
 * outra metade da cura está em `criarPerna` — a canela voltou a ser pele, com a
 * bandagem reduzida a uma faixa.
 */
function criarQuadril(): No {
  return {
    nome: NOS_GOBLIN.quadril,
    pivo: [0, 0, P.zQuadril],
    caixas: [
      detalhe('couroBase', [4.2, 2.8, 1.8]), //  pelve
      detalhe('trapo', [4.2, 3.0, 1.6], [0, 0, -1.0]) //  tanga  ← I7
    ]
  };
}

/**
 * torso — peito nu, colete de couro, cinto e os dois ombros (I7).
 *
 * Ordem de declaração = desempate da ordem do pintor (§4.4): o peito primeiro,
 * o colete por cima dele. O peito sobe até z 7,5 e o colete até 6,7, mas quem
 * ocupa a faixa entre os dois é a `garganta` da cabeça (5,9..7,0, e declarada
 * depois) — ou seja o peito verde nu da referência virou a sombra do queixo, que
 * é o que a silhueta precisava. Ver o item (c) de `criarCabeca`.
 *
 * O cinto em `couroSombra` é a linha escura que separa colete de tanga sem
 * gastar outline: 0,7u = ~2px de arte de uma cor duas paradas abaixo do colete.
 * É o mesmo truque com que a referência separa as camadas de trapo.
 *
 * Rodada 1 (§8) — o tronco INTEIRO estreitou. Ele era mais largo que a cabeça
 * (colete 4,9 e peito 4,6 contra crânio 4,4), o que inverte I8 e transforma
 * cabeça e tronco num retângulo verde só nas direções 3 e 7. As larguras caíram
 * ~17% (peito 3.8, colete 4.1, cinto 4.0, ombro 1.8 em `cx ∓2.5`) enquanto a
 * cabeça engordou — ver `PROPORCOES_GOBLIN.xOmbro`, onde a conta inteira está.
 *
 * O fundo caiu junto, mas menos que a largura, de propósito: a razão
 * largura/fundo do peito foi de 1,44:1 para 1,31:1 e a do colete de 1,40:1 para
 * 1,28:1. É a armadilha da "placa" que a rodada 3 do Guerreiro documentou — um
 * tronco raso encolhe nas direções em que `artX` só enxerga o eixo Y.
 *
 * Os ombros vão a ±3,4u de silhueta contra ±2,05 do colete: o goblin continua
 * atarracado, e é esse degrau que dá o encaixe do braço sem precisar de junta.
 */
function criarTorso(): No {
  return {
    nome: NOS_GOBLIN.torso,
    pivo: [0, 0, P.zTorso],
    caixas: [
      detalhe('peleBase', [3.8, 2.9, 3.2]), //  peito
      peca('couroBase', [4.1, 3.2, 2.2], [0, 0, -0.3]), //  colete  ← I7
      detalhe('couroSombra', [4.0, 3.3, 0.7], [0, 0, -1.6]), //  cinto
      detalhe('peleBase', [1.8, 2.2, 1.6], [-2.5, 0, 1.1]), //  ombro.esq
      detalhe('peleBase', [1.8, 2.2, 1.6], [2.5, 0, 1.1]) //  ombro.dir
    ]
  };
}

/**
 * ORELHA (I2) — o traço que define o goblin, e a única peça do blockout que
 * mudou de FORMA em vez de mudar de número.
 *
 * A §5 declara uma caixa só (0.6 × 3.2 × 2.4, em `cx ±3.1`) com a instrução de
 * "inclinar ~25° para fora e para cima". Não dá para cumprir a instrução com uma
 * caixa: `Caixa` não tem rotação — quem gira é o NÓ, e uma inclinação que
 * morasse na `Pose` seria ângulo mágico escondido em tabela (o defeito que
 * `criarEspada` documenta em `./warrior`), some no primeiro `clonarPose` que
 * alguém escrever errado e não sobrevive a uma pose de repouso vazia.
 *
 * Duas outras coisas condenavam a caixa única, e as duas são medição:
 *
 * - 0,6u de espessura vale 1,5px de ARTE. Abaixo de ~2px uma peça se desfaz em
 *   pontilhado depois da rasterização — é o defeito que engrossou a lâmina do
 *   Guerreiro de 1,3 para 2,2u na rodada 3. Uma orelha pontilhada em metade das
 *   direções reprova G6 sozinha;
 * - a §4 pede 9u de ponta a ponta, e `cx ±3.1` com 0,6u de largura fecha em
 *   6,8u. O número e a caixa da própria §5 não podem ser verdade ao mesmo tempo.
 *
 * A solução é a mesma do escudo do Guerreiro: aproximar a forma por caixas. Três
 * caixas em escada, cada uma menor e mais alta que a anterior, produzem de uma
 * vez a inclinação, o afinamento para a ponta (orelha PONTUDA, não aba) e a
 * espessura mínima.
 *
 * RODADA 1 (§8) — a escada estava DEITADA, e esse foi o defeito mais caro da
 * entrega. As três caixas subiam só 25,8°, a ponta fechava em z 11,18 e o topo
 * saía quase plano. O número do contrato ("~25° para fora e para cima") era
 * cumprido ao pé da letra e mesmo assim I2 morria, porque o que faz o olho ler
 * "goblin" não é o comprimento da orelha nem o ângulo dela: é a ponta ROMPER o
 * topo da silhueta. Com z 11,18 ela ficava abaixo do espinho central (12,45) e
 * na linha do elmo (11,15) — nunca era o ponto mais alto, e nas direções 3 e 7
 * as duas viravam um caroço de 2–3px sobre o couro. Na referência as pontas das
 * orelhas são o ponto MAIS ALTO da figura inteira, acima dos espinhos.
 *
 * A escada nova sobe 48° (`atan(1,85 / 1,65)` entre os centros de raiz e ponta),
 * a ponta fecha em |x| 5,15 (10,3u ponta a ponta) e em z 12,73 — acima do
 * espinho central. A orelha passa a ser o topo do modelo, em todas as direções,
 * e é ela que define a altura de 13u da §4.
 *
 * Legibilidade nas 8 direções (o que G6 cobra):
 *   - de frente e de costas as duas orelhas projetam para os lados, muito além
 *     do elmo (±2,65): a silhueta é inconfundível;
 *   - nos perfis (direções 3 e 7) `artX` só enxerga o eixo Y, onde a orelha é
 *     fina — mas `artY` enxerga o X inteiro, e com |x| 5,15 uma das duas sobe
 *     3,35u = 8,4px de arte ACIMA do topo do elmo enquanto a outra afunda. É o
 *     dobro dos 4px da rodada anterior, e é o que faz nenhuma direção apagar as
 *     duas — o critério da §5.
 *
 * O PREÇO da orelha grande, medido, para ninguém "consertar" isto por engano.
 * A altura da silhueta nas 8 direções passou a ser 47/44/44/46/44/36/44/46px de
 * arte — 11px de amplitude, praticamente a mesma de antes (10px). Não é defeito
 * de acabamento: é a projeção. Em `artY = (X + Y)/2 − z`, a ponta em |x| 5,15
 * soma `5,15 · |cos θ + sen θ| / 2`, que vale 0 nas direções 1 e 5 e 3,64u nas
 * direções 3 e 7 — 9,1px de amplitude só disso, com QUALQUER traço lateral desse
 * tamanho. Baixar a orelha para achatar a curva é desfazer I2.
 *
 * Para calibrar o que é aceitável: medido no mesmo atlas e do mesmo jeito, o
 * GUERREIRO varia de 57 a 96px (39px, 51% da figura) por causa da espada
 * erguida; o goblin varia 11px sobre 44 (25%). O bicho novo oscila METADE do que
 * o personagem que já passou pelos gates.
 *
 * Sobre o nome: `lado > 0` é a orelha DIREITA do goblin, e o pivô sai em −X pelo
 * espelho de §6.1 — a mesma convenção das pernas. `fora` é a direção que aponta
 * para longe do crânio no espaço já espelhado.
 *
 * Em `peleLuz` porque na referência as orelhas são finas e pegam luz por trás;
 * na rampa `pele` elas saem luz/luz/base, um degrau acima do corpo inteiro, e é
 * esse contraste que as destaca contra a cabeça em vez de fundi-las nela.
 */
function criarOrelha(lado: 1 | -1): No {
  const fora = -lado;
  return {
    nome: lado > 0 ? NOS_GOBLIN.orelhaDir : NOS_GOBLIN.orelhaEsq,
    pivo: [fora * P.xOrelha, 0, AJ.orelhaMontagemZ],
    caixas: [
      detalhe('peleLuz', [1.5, 2.8, 2.2], [fora * 0.7, 0.05, 0.3]), //  raiz
      detalhe('peleLuz', [1.25, 2.1, 1.7], [fora * 1.55, 0.1, 1.25]), //  meio
      detalhe('peleLuz', [1.0, 1.3, 1.15], [fora * 2.35, 0.15, 2.15]) //  ponta
    ]
  };
}

/**
 * cabeca — a peça mais importante da silhueta (I8: cabeça enorme, ~2,5 cabeças
 * de altura total). Concentra I2 (orelhas, em nós filhos), I3 (elmo espinhado),
 * I4 (olhos em brasa) e I5 (sorriso).
 *
 * Três desvios da §5, todos pelo mesmo motivo — a grade de arte:
 *
 * 1. os ESPINHOS foram de 0.5/0.4 para 0.8/0.7 de bitola. 0,5u = 1,25px de arte,
 *    abaixo do piso de ~2px onde a peça vira pontilhado (a mesma medição que
 *    engrossou a lâmina do Guerreiro). Um elmo espinhado com os espinhos
 *    apagados é um gorro — I3 perdido;
 * 2. os OLHOS foram de 0.8 × 0.5 × 0.6 para 0.9 × 0.6 × 0.7 e avançaram de
 *    `cy 1.9` para `cy 2.3`. A bitola porque o olho é a peça que menos pode
 *    sumir (I4, e é a única emissiva); o avanço porque em `cy 1.9` a face
 *    frontal do olho ficava COPLANAR com a do crânio (ambas em y = 2,0 depois de
 *    somar a meia-espessura), e faces coplanares empatam na ordem do pintor —
 *    o mesmo defeito que fazia o escudo do Guerreiro virar mancha com ruído.
 *    Em `cy 2.3` o olho fica 0,6u à frente e o empate desaparece;
 * 3. a BOCA existe. A §5 lista só `dentes`, mas a §3 declara `vazio` como a cor
 *    da "boca" — a fenda escura é peça de paleta, não invenção. Sem ela os
 *    dentes flutuam sobre a pele e o sorriso de I5 não fecha.
 *
 * RODADA 1 (§8) — três correções, todas medidas no atlas:
 *
 * a. os DENTES não existiam no jogo. A caixa da §5 tinha 0,55u = 1,4px de arte
 *    de altura e sobrava 0,25u à frente da face do focinho; medido a 2×, dava
 *    0px de `#efe7cf` na direção 7, 4px na 3 e 8px na 0. A 1× o sorriso
 *    simplesmente não estava lá. Agora a fileira tem 1,0u = 2,5px de arte,
 *    avança 0,5u além do focinho e é 0,15u MAIS LARGA que ele de cada lado, de
 *    modo que vaza para fora do focinho — a "boca larga" de I5. A boca `vazio`
 *    acompanhou, logo acima dela;
 * b. o CRÂNIO era a peça mais estreita do modelo (4,4 contra 4,6 do peito e 4,9
 *    do colete) — I8 ao contrário. Foi para 5,0 × 4,2 e o elmo para 5,3 × 4,5,
 *    enquanto o tronco estreitava (ver `PROPORCOES_GOBLIN.xOmbro`);
 * c. não havia TRANSIÇÃO entre cabeça e tronco: crânio (base 6,9) e peito (topo
 *    7,5) eram os dois `peleBase` e se interpenetravam, e a fileira de dentes
 *    encostava direto no colete. A caixa `garganta` resolve pela mesma economia
 *    do `cinto` — uma faixa de cor duas paradas abaixo separando duas massas da
 *    mesma cor, sem gastar outline.
 *
 *    Ela precisou de DUAS medições para aparecer, e as duas valem registro
 *    porque a mesma armadilha vai pegar o próximo monstro. A primeira: uma caixa
 *    de "pescoço" contida no volume do peito não desenha pixel nenhum — sem
 *    z-buffer quem manda é a ordem do pintor, e peito (±1,45 em Y) e crânio
 *    (±2,1) estão os dois MAIS À FRENTE do que um pescoço estreito, então os
 *    dois a cobrem. Por isso a garganta avança até y +2,2, na frente do peito e
 *    quase na do crânio. A segunda: mesmo assim ela saía com 1px, porque a
 *    fileira de DENTES (y até 3,2) projeta 0,45u mais abaixo e come a metade de
 *    cima dela. A cura é largura — 4,0u contra os 2,9 dos dentes —, de modo que
 *    a faixa escura sobra dos dois lados do sorriso. Continua 1u mais estreita
 *    que o crânio (5,0), que é o que a faz ler como base da cabeça e não como
 *    gola.
 *
 * Alturas resultantes (absolutas): garganta 6,1..7,1 · crânio 6,9..10,3 ·
 * elmo 9,45..11,15 · espinho central 10,85..12,45 · orelhas 9,2..12,73. O topo
 * do modelo agora é a PONTA DA ORELHA, não o espinho: com a sola em −0,2 dá
 * 12,93u, os 13u de §4 quase exatos.
 *
 * Os olhos ficam em 8,65..9,35, logo ABAIXO da aba do elmo (9,45): "pequenos,
 * intensos, sob o elmo" (I4).
 */
function criarCabeca(): No {
  return {
    nome: NOS_GOBLIN.cabeca,
    pivo: [0, 0, P.zCabeca],
    caixas: [
      detalhe('peleSombra', [4.0, 3.6, 1.1], [0, 0.4, -2.15]), //  garganta      ← I1
      peca('peleBase', [5.0, 4.2, 3.4]), //  cranio        ← I8
      detalhe('peleBase', [2.6, 1.0, 1.4], [0, 2.2, -0.6]), //  focinho
      detalhe('vazio', [2.9, 0.4, 0.55], [0, 2.9, -0.42]), //  boca          ← I5
      detalhe('dente', [2.9, 0.5, 1.0], [0, 2.95, -1.15]), //  dentes        ← I5
      detalhe('olhoBrasa', [0.9, 0.6, 0.7], [-0.9, 2.3, 0.4]), //  olho.esq      ← I4
      detalhe('olhoBrasa', [0.9, 0.6, 0.7], [0.9, 2.3, 0.4]), //  olho.dir      ← I4
      detalhe('couroBase', [5.3, 4.5, 1.7], [0, 0, 1.7]), //  elmo          ← I3
      detalhe('acoBase', [0.8, 0.8, 1.6], [0, 0, 3.05]), //  espinho.meio  ← I3
      detalhe('acoBase', [0.7, 0.7, 1.2], [-1.3, 0, 2.85]), //  espinho.esq
      detalhe('acoBase', [0.7, 0.7, 1.2], [1.3, 0, 2.85]) //  espinho.dir
    ],
    filhos: [criarOrelha(1), criarOrelha(-1)]
  };
}

/**
 * cimitarra — punho, guarda e a lâmina larga e curva (I6).
 *
 * Como no Guerreiro, o blockout da §5 é autocontraditório neste ponto e a
 * correção é obrigatória: ele lista as peças da arma DESCENDO a partir da mão
 * (`cz` de −5.2 a −10.6, no mesmo −Z em que o braço se estende), o que num
 * ombro a 7,9u de altura enfiaria a ponta da lâmina 4u ABAIXO do chão — e no
 * parágrafo seguinte exige a lâmina "apoiada sobre o ombro".
 *
 * A compensação é feita na DECLARAÇÃO, não na pose (mesma cura de `criarEspada`
 * em `./warrior`): o nó é ancorado no centro da mão e as quatro peças são
 * espelhadas para +Z. As distâncias ao punho são as mesmas da §5, peça por peça
 * (0,95 · 2,10 · 3,85 · 6,65u), e nenhum tamanho mudou de propósito — é o mesmo
 * blockout, empunhado do jeito certo. A lâmina nasce apontando para CIMA com
 * rotação zero; quem a deita no ombro é `POSE_PARADA_GOBLIN`, com os dois
 * ângulos documentados em `ANGULOS_GOBLIN`.
 *
 * A CURVA sai do escalonamento das duas caixas, como a §5 manda: a ponta é mais
 * larga (2.4 contra 1.6) e desloca 0,6u no +Y local. Com a pose de repouso o +Y
 * local aponta quase para cima, então o alargamento vira barriga de lâmina
 * subindo para a ponta — a curva da cimitarra. Não é uma caixa torta: é o
 * degrau entre duas caixas, que na rasterização em baixa resolução lê como
 * curva pelo mesmo motivo que o octógono do escudo lê como disco.
 *
 * Espessuras: 0.8 e 0.9u (a §5 pede 0.7 e 0.8). É o piso de ~2px de arte de
 * novo — abaixo dele a lâmina se desfia em pontilhado e o contorno acaba de
 * matá-la. A largura da lâmina (1.6 e 2.4u) não mudou: é ela que carrega I6.
 *
 * `acoBase` e não `acoLuz`: com o `REALCE_TOPO` de `../model3d` uma caixa
 * `acoBase` cai em acoLuz (topo) / acoBase (frente) / acoSombra (lado) — os TRÊS
 * tons de aço da §3. Declarada `acoLuz`, topo e frente colapsariam no mesmo
 * branco e o volume da lâmina sumiria.
 *
 * Declarada por ÚLTIMO dentro do braço direito — §4.4, a arma é o caso limite da
 * ordem do pintor.
 */
function criarCimitarra(): No {
  return {
    nome: NOS_GOBLIN.cimitarra,
    pivo: [0, AJ.maoY, AJ.maoZ],
    caixas: [
      detalhe('couroBase', [0.8, 0.8, 1.8], [0, 0, 0.95]), //  punho enfaixado (§5: cz −5.2)
      detalhe('acoSombra', [1.8, 0.9, 0.5], [0, 0, 2.1]), //  guarda          (§5: cz −6.2)
      detalhe('acoBase', [0.9, 1.6, 3.0], [0, 0, 3.85]), //  lamina.base     (§5: cz −8.0)
      detalhe('acoBase', [0.8, 2.4, 2.6], [0, 0.6, 6.65]) //  lamina.ponta    (§5: cz −10.6)
    ]
  };
}

/**
 * bracoDir — o braço que apoia a cimitarra no ombro (I6). Mora em −X pelo
 * espelho de §6.1.
 *
 * O COTOVELO é dobrado na geometria, e isto merece explicação porque contraria a
 * leitura ingênua da §5 (`braco`, `antebraco` e `mao` empilhados em −Z, um braço
 * reto pendurado).
 *
 * O rig da §5 é plano: braço, antebraço e mão são caixas do MESMO nó, não nós
 * encadeados — não existe junta de cotovelo para dobrar por pose. E um braço
 * reto de 4,2u girando no ombro descreve um círculo de raio 4,2: a mão nunca
 * pode ficar PERTO do ombro, que é justamente onde a referência a põe. Qualquer
 * rotação que erga a mão à altura do ombro a joga 4,2u para fora do corpo, e a
 * cimitarra sai flutuando no ar em vez de apoiada.
 *
 * Acrescentar um nó de antebraço resolveria, e foi recusado: mudaria a árvore de
 * §5 (que o `NOS_HUMANOIDE` do forge espelha) para ganhar um grau de liberdade
 * que nenhuma animação desta fase usa. A cura barata é a mesma da arma —
 * descrever a dobra nas coordenadas das caixas: o braço pende do ombro, o
 * antebraço sobe por trás (em `trapo`, a bandagem de I7) e a mão fecha ACIMA e
 * ATRÁS do ombro, a 1,4u da linha do tronco. Dali a lâmina cai sobre o ombro
 * com um giro só, e a arma fica onde a referência a mostra.
 *
 * Efeito colateral desejado: como a mão nasce atrás do ombro, todo o conjunto
 * punho-guarda-lâmina fica ATRÁS do plano do tronco, e a ordem do pintor (§4.4)
 * resolve a oclusão sozinha nas 8 direções — sem z-buffer e sem caso especial.
 */
function criarBracoDir(): No {
  return {
    nome: NOS_GOBLIN.bracoDir,
    pivo: [-P.xOmbro, 0, P.zOmbro],
    caixas: [
      detalhe('peleBase', [1.5, 1.5, 2.2], [0, 0.1, -1.1]), //  braço
      detalhe('trapo', [1.3, 1.9, 1.5], [0, -0.75, -1.25]), //  antebraço dobrado ← I7
      detalhe('peleBase', [1.4, 1.4, 1.0], [0, AJ.maoY, AJ.maoZ]) //  mão
    ],
    filhos: [criarCimitarra()]
  };
}

/**
 * bracoEsq — o braço livre, que só pende ao lado do corpo. Caixas exatamente
 * como a §5 as declara: com o ombro a 7,9u e a mão em `cz −4.2`, ela fecha em
 * z 3,25..4,15 — na linha do quadril (4,4), que é onde a referência a mostra.
 * Mora em +X, o espelho de `criarBracoDir` (§6.1).
 */
function criarBracoEsq(): No {
  return {
    nome: NOS_GOBLIN.bracoEsq,
    pivo: [P.xOmbro, 0, P.zOmbro],
    caixas: [
      detalhe('peleBase', [1.5, 1.5, 2.2], [0, 0, -1.1]), //  braço
      detalhe('trapo', [1.4, 1.4, 1.8], [0, 0, -3.0]), //  antebraço ← I7
      detalhe('peleBase', [1.5, 1.5, 0.9], [0, 0, -4.2]) //  mão
    ]
  };
}

/**
 * Perna. As caixas são simétricas em X (todas em `cx = 0` no espaço do nó), então
 * o espelhamento da §5 é só o sinal do pivô — nada de duplicar a tabela e
 * arriscar as duas pernas divergirem num ajuste futuro. O pivô sai em
 * `−lado · xPerna` porque o rig inteiro é autorado espelhado (§6.1).
 *
 * Pernas curtas (I8): coxa 2,35..4,25 · canela 0,75..2,45 · pé −0,2..0,6. Dão
 * 4,45u de perna contra 13u de altura total, um terço — a proporção atarracada
 * da referência, contra os ~40% do Guerreiro.
 *
 * Dois ajustes sobre a §5, os dois herdados de medição do Guerreiro:
 *
 * - o PÉ ficou quadrado em planta (2.0 × 2.2 contra 1.9 × 2.6) e quase centrado
 *   (`cy 0.15` contra 0.5). Um pé fundo e deslocado, cisalhado pelo pivô em
 *   x = ±1.45, faz a base da silhueta oscilar entre direções — o boneco "afunda
 *   e emerge" do losango ao girar, contra uma sombra elíptica que é fixa. Foi a
 *   correção da rodada 3 do Guerreiro, medida em 2,31px de arte de oscilação;
 * - a sola fecha em z −0,2, ou seja, o pé afunda 0,2u no plano do chão, de
 *   propósito, para o goblin assentar DENTRO do losango do tile em vez de ficar
 *   equilibrado em cima dele. A âncora do sprite é o plano z = 0 do modelo,
 *   NUNCA a borda de baixo do quadro — há pixels abaixo dela, como no Guerreiro.
 *
 * RODADA 1 (§8) — a canela era `trapo` INTEIRA, a mesma cor da tanga, e as duas
 * juntas transformavam o trecho do cinto aos pés num tijolo bege sem perna
 * nenhuma dentro. O vão de 0,9u entre as pernas existia e não servia para nada:
 * ele recortava bege contra bege.
 *
 * A cura é dividir a peça. A canela voltou a ser `peleBase` e a bandagem de I7
 * virou uma FAIXA de 0,6u no alto dela — que é como a referência enfaixa a
 * canela, com pano em volta e pele aparecendo em cima e embaixo. Agora a perna
 * lê verde-faixa-verde, e o vão entre as duas recorta contra verde. A outra
 * metade da cura está em `criarQuadril` (a tanga encurtou).
 *
 * A faixa é 0,1u mais larga que a canela de propósito: com a mesma bitola as
 * faces laterais ficariam coplanares e empatariam na ordem do pintor.
 */
function criarPerna(lado: 1 | -1): No {
  return {
    nome: lado > 0 ? NOS_GOBLIN.pernaDir : NOS_GOBLIN.pernaEsq,
    pivo: [-lado * P.xPerna, 0, P.zQuadrilPerna],
    caixas: [
      detalhe('peleBase', [1.9, 1.9, 1.9], [0, 0, -0.9]), //  coxa
      detalhe('peleBase', [1.7, 1.7, 1.7], [0, 0, -2.6]), //  canela
      detalhe('trapo', [1.8, 1.8, 0.6], [0, 0, -2.15]), //  bandagem ← I7
      detalhe('peleBase', [2.0, 2.2, 0.8], [0, 0.15, -4.0]) //  pé
    ]
  };
}

/**
 * Monta uma árvore NOVA do Goblin. Chame isto (e não mute `MODELO_GOBLIN`)
 * sempre que precisar de um rig próprio — variantes, testes, previews.
 *
 * A ordem dos filhos importa só para desempate da ordem do pintor (§4.4):
 * quadril e torso antes dos apêndices, braço da arma por último. É a mesma
 * ordem do Guerreiro, de propósito — os dois rigs se comportam igual sob o
 * mesmo forge.
 */
export function criarModeloGoblin(): No {
  return {
    nome: NOS_GOBLIN.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [
      criarQuadril(),
      criarTorso(),
      criarCabeca(),
      criarPerna(1),
      criarPerna(-1),
      criarBracoEsq(),
      criarBracoDir()
    ]
  };
}

/** O rig canônico do Goblin, pronto para o sprite forge (§7). Não mute. */
export const MODELO_GOBLIN: No = criarModeloGoblin();

/* ------------------------------------------------------------------ *
 * 7. Pose de repouso (§6, estado `parado`)
 * ------------------------------------------------------------------ */

const A = ANGULOS_GOBLIN;

/**
 * A pose de referência: cimitarra DEITADA sobre o ombro, passando por trás da
 * cabeça e saindo do outro lado (I6), e o braço livre pendendo um pouco aberto.
 * É a pose que faz a silhueta ler como "goblin encrenqueiro" à distância — a
 * arma pendurada ao lado não lê.
 *
 * É a base sobre a qual a animação de §6 SOMA respiração, passo saltitante e
 * golpe descendente. Como `poseDoQuadro` (`../spriteForge`) clona o repouso e
 * soma por cima, os dois ângulos da cimitarra sobrevivem a todos os 9 quadros —
 * e o golpe, que gira `bracoDir`, arrasta o conjunto inteiro do ombro para
 * baixo, que é exatamente o "golpe descendente" que a §6 pede. Nada disto toca o
 * estado do engine (R54).
 *
 * Nós ausentes daqui ficam em repouso (rotação zero): quadril, torso, cabeça,
 * pernas, braço direito e as duas orelhas. É intencional em dois pontos:
 *
 * - o braço direito não gira porque a dobra do cotovelo está na GEOMETRIA (ver
 *   `criarBracoDir`) — o repouso não esconde ângulo mágico nenhum;
 * - as orelhas não giram porque a inclinação de 48° de I2 também está na
 *   geometria (ver `criarOrelha`). Os nós existem para o balanço de §6 somar
 *   por cima, e um repouso vazio continua produzindo as orelhas certas.
 *
 * Para quem integra com o sprite forge (§7): o lugar de passar isto é
 * `opts.repouso`, junto de `paleta`, `rampas`, `rampaDaCor` e
 * `emissivas: CORES_EMISSIVAS_GOBLIN`.
 */
export const POSE_PARADA_GOBLIN: Pose = {
  [NOS_GOBLIN.cimitarra]: {
    rx: grausParaRad(A.cimitarraRx),
    ry: grausParaRad(A.cimitarraRy)
  },
  [NOS_GOBLIN.bracoEsq]: {
    rx: grausParaRad(A.bracoEsqRx),
    ry: grausParaRad(A.bracoEsqRy)
  }
};
