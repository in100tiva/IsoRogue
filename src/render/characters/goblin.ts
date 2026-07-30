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
 *     cimitarra (I6) ou os olhos (I4) tira a ameaça.
 *
 * RODADA 2 (§8) — A EMPUNHADURA MUDOU DE LADO, e é a maior mudança desde a
 * entrega. A §5 e a referência mostram a cimitarra APOIADA SOBRE O OMBRO,
 * passando por trás da cabeça, e a rodada 1 cumpriu isso ao pé da letra. Numa
 * ILUSTRAÇÃO de 700px aquilo funciona: dá para ver o punho fechado na frente do
 * peito, o antebraço, e o olho fecha sozinho o circuito "mão → cabo → lâmina".
 * Num sprite de ~40px de arte não sobra mão nenhuma na frente do corpo, e o que
 * resta é uma barra cinza atravessada atrás da cabeça, sem dono.
 *
 * A medição que condenou a pose (rasterização com ordem do pintor, 8 direções):
 *   - em 3 das 8 (4, 5 e 6) a lâmina era desenhada POR CIMA da cabeça;
 *   - em outras 3 (0, 1 e 2) 100% da lâmina visível ficava numa região da tela
 *     sem nenhum pixel de mão, cabo ou braço por perto — a arma flutuava;
 *   - o Guerreiro, no mesmo atlas e no mesmo pipeline, lê em todas as 8, porque
 *     ele empunha a espada À FRENTE, com a mão fora da silhueta do tronco.
 *
 * Esta rodada troca I6 de "cimitarra apoiada no ombro" para "cimitarra empunhada
 * em guarda diagonal à frente" — mais baixa e mais lateral que a do Guerreiro,
 * porque a lâmina é curta e curva e o bicho é atarracado. É desvio consciente da
 * referência, autorizado pela revisão visual: a legibilidade em 40px manda, e o
 * que carrega I6 é a lâmina LARGA E CURVA, não o ombro onde ela descansa.
 * Ver `AJUSTES_GOBLIN.maoY`, `ANGULOS_GOBLIN.cimitarraRx` e `criarBracoDir`.
 *
 * O PREÇO DA MUDANÇA, medido, para ninguém "consertar" isto por engano: o QUADRO
 * CRESCEU (56×59 → 84×68 px de arte na rodada 2, e → 90×69 na 3). A arma sai da
 * silhueta em vez de se dobrar sobre o corpo, e quem dimensiona o quadro é a
 * caixa da silhueta (§7 de `../spriteForge`). É margem transparente: o corpo não
 * mudou de tamanho (G7 continua 42px contra 57px do Guerreiro, 74%).
 *
 * RODADA 3 (§8) — O BRAÇO ABRIU. A rodada 2 curou a lâmina atrás da cabeça, mas
 * "ler como segurando" só valia em 4 das 8 direções. O que faltava, medido por
 * rasterização com ordem do pintor (a mesma de `../model3d`, contando pixels de
 * BRAÇO + mão + cabo visíveis no repouso, por direção):
 *
 *   direção     0   1   2   3   4   5   6   7
 *   rodada 2   40  60  61  16   0  46  63  44   ← a direção 4 não tinha NADA
 *   rodada 3   56  83  94  20  12  73  82  50
 *
 * A rodada 2 escrevia aqui que a direção 4 "não é ajustável — é a projeção",
 * porque um ponto no azimute de costas projeta em `artX = x − y = 0`. A conta
 * está certa e a CONCLUSÃO estava errada: `artX = 0` vale para o azimute 225°
 * exato, e o que decide o quanto a mão escapa da coluna do tronco é o RAIO dela
 * em torno do eixo do corpo — 4,66u na rodada 2 contra 7,3u do Guerreiro, que
 * resolve a mesma direção no mesmo atlas. Com a mão a 6,84u a direção 4 passa a
 * mostrar 12px de braço e a lâmina inteira ligada a ele. Foi racionalização, não
 * medição; ficou registrado aqui porque a próxima rodada acreditaria nela.
 *
 * Três números fizeram o trabalho, e os três estão neste arquivo — nada subiu
 * para `../spriteForge` nem para `../model3d`:
 *
 * 1. a MÃO abriu de `x −4,0` para `x −6,4` (`AJUSTES_GOBLIN.maoX`), com úmero e
 *    antebraço acompanhando em `criarBracoDir` — sem isso o braço descolava do
 *    ombro e a mão viraria um bloco solto, que é o defeito que se estava curando;
 * 2. a GUARDA subiu de 50,3° para 59,5° de elevação (`ANGULOS_GOBLIN`). O eixo
 *    projetado da lâmina nas 8 direções passou de
 *    `7,8 · 19,5 · 25,1 · 24,8 · 24,4 · 25,4 · 21,8 · 11,2` px de arte para
 *    `12,7 · 21,7 · 26,4 · 26,7 · 26,7 · 26,3 · 21,3 · 12,3`: o pior caso sobe
 *    58% e a razão pior/melhor cai de 3,3× para 2,2×. Ver a conta fechada em
 *    `cimitarraRx`, que diz por que a elevação é o único parâmetro que levanta o
 *    PISO e por que 35,26° seria o pior valor possível;
 * 3. o ARCO DO GOLPE deixou de partir de uma guarda alta (ver `ANIMACAO_GOBLIN`).
 *
 * O que a varredura garante hoje, nos 32 quadros medidos (8 direções × repouso +
 * 3 de ataque): ZERO pixel de lâmina desenhado sobre a cabeça (rodada 2: 59),
 * nenhum quadro com menos de 32px de lâmina fora do corpo (rodada 2: 12) e a
 * silhueta inteira em UMA ilha 4-conexa em todos eles — nada flutuando, que é a
 * forma medível de "a arma está presa a alguém".
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
   * cimitarra. Na rodada 1, com a lâmina deitada no ombro, aproximá-lo do centro
   * encurtava o percurso da lâmina até a nuca; na rodada 2, com a arma empunhada
   * à frente, ele passou a ser o que define o RAIO da mão em torno do eixo do
   * corpo — e é esse raio que decide se a mão aparece ou some atrás do tronco.
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
   * da cimitarra. Os TRÊS eixos saem das MESMAS constantes de propósito: a arma
   * gira NA MÃO, e uma segunda cópia destes números seria a maneira silenciosa
   * de a lâmina descolar do punho no primeiro ajuste de pose.
   *
   * RODADA 2 (§8) — A MÃO ATRAVESSOU O CORPO, de trás para a frente. Era
   * `(0, −1.4, +0.05)`: ACIMA e ATRÁS do ombro, que é onde ela tem de ficar para
   * a lâmina cair sobre o ombro. O preço, medido, está no cabeçalho do módulo —
   * em 3 direções a lâmina era desenhada por cima da cabeça e em outras 3 ela
   * flutuava sem mão à vista. É o defeito que esta rodada existe para curar.
   *
   * Na rodada 2 virou `(−1.4, +2.4, −2.0)` e na 3 é **`(−3.8, +2.4, −2.3)`**, ou
   * seja, no mundo (com o pivô do braço em `(−2.6, 0, 7.9)`):
   * **(−6.4, +2.4, +5.6)**. O que cada eixo compra:
   *
   * - **Y +2.4** põe a mão 0,8u À FRENTE da face dianteira do colete (y +1.6) e
   *   0,3u atrás do focinho (y +2.7). Ela recorta contra o fundo, não contra o
   *   peito, e é isso que faz o olho ler "segurando", que é o pedido;
   * - **Z −2.3** desce a mão para z 5,6 — altura do colete (4,5..6,7), entre o
   *   cinto e o peito. Guarda BAIXA, como um bicho atarracado segura uma lâmina
   *   curta; à altura do ombro ela viraria a pose do Guerreiro em miniatura;
   * - **X −3.8** é o número desta rodada, e é ele que decide em quantas direções
   *   existe braço na silhueta. A conta é a projeção: um ponto no azimute
   *   "de costas para a câmera" (225°) projeta em `artX = x − y = 0`, ou seja na
   *   coluna do corpo. Isso NÃO significa que a direção 4 seja perdida — o que
   *   decide é a distância angular até esse azimute cego e o RAIO da mão em
   *   torno do eixo do corpo. Com `−1.4` o raio era `hypot(4.0, 2.4) = 4,66u` e
   *   a direção 4 saía com ZERO pixel de braço, mão ou cabo; com `−3.8` o raio é
   *   `hypot(6.4, 2.4) = 6,84u` (o Guerreiro usa 7,3u, e é por isso que ele lê
   *   nessa direção) e sobram 12px. A tabela das 8 direções está no cabeçalho.
   *
   * O TETO deste número não é estético, é anatômico: com `−3.8` o segmento
   * ombro→mão mede `hypot(3.8, 2.4, 2.3) = 5,05u`, 39% da altura do bicho —
   * proporção de braço humano (~44%). O que cresceu foi a ABDUÇÃO, não o osso: o
   * goblin passou a segurar a cimitarra afastada do corpo, que é o que a leitura
   * em 40px exige. Passar disto começa a pedir um braço longo demais para I8.
   *
   * A lâmina, saindo daqui, nunca mais volta para o corpo: ver
   * `ANGULOS_GOBLIN.cimitarraRx`.
   */
  maoX: -3.8,
  maoY: 2.4,
  maoZ: -2.3
} as const;

/**
 * Ângulos da pose de repouso, em GRAUS (a conversão para radianos é feita ao
 * montar `POSE_PARADA_GOBLIN`). Ajustáveis pela revisão visual — gates G1 e G6.
 */
export const ANGULOS_GOBLIN = {
  /**
   * A cimitarra em GUARDA DIAGONAL À FRENTE (I6) — lâmina saindo da mão para
   * fora e para cima, longe do corpo e longe da cabeça em todas as 8 direções.
   *
   * Convenção de sinal, e ela é o INVERSO da dos membros: um membro se estende
   * no −Z local (`ry > 0` leva a extremidade para −X), mas a cimitarra é
   * declarada apontando para +Z a partir da mão (ver `criarCimitarra`). Para um
   * apêndice em +Z vale `d = (sin ry, −cos ry · sin rx, cos ry · cos rx)`: logo
   * `ry > 0` leva a PONTA para +X e `rx > 0` a leva para −Y, o fundo.
   *
   * O braço da arma mora em −X (§6.1), então o sinal que AFASTA a lâmina do
   * corpo é `ry < 0` — e é aqui que a rodada 1 errava por construção: com
   * `ry +46` a ponta viajava para +X, isto é, atravessava o corpo inteiro em
   * direção ao outro ombro, passando por trás da cabeça. Trocar o sinal é
   * metade da cura desta rodada; a outra metade é a mão (`AJUSTES_GOBLIN.maoY`).
   *
   * Com `rx −6° / ry −30°` (rodada 3) o eixo vale
   * `(sen −30, −cos −30 · sen −6, cos −30 · cos −6) = (−0.500, +0.091, +0.861)`:
   *
   * - **sobe 59,5°** acima da horizontal e aponta 170° no azimute (medindo de
   *   +X), ou seja quase reto para fora e levemente à frente. É a diagonal do
   *   Guerreiro (ele sobe 67°) rebaixada, que é o que a lâmina curta e o bicho
   *   atarracado pedem;
   * - a **ponta** (8,65u do pivô da mão, com a caixa do bico) fecha em
   *   `(−10.72, +3.18, +13.05)`. Compare com o elmo (|x| ≤ 2,65), com o colete
   *   (|x| ≤ 2,05) e com a ponta da orelha (|x| 5,15): saindo da mão em x −6,4 e
   *   só DIMINUINDO em x (o giro `rx` não mexe em X, e o desvio da barriga
   *   também não), a lâmina não tem como cruzar cabeça nem tronco. Não é ordem do
   *   pintor segurando as pontas — é separação geométrica, e por isso vale nas 8
   *   direções e nos 9 quadros;
   * - medido por rasterização com ordem do pintor, **zero** pixel de lâmina sai
   *   por cima da cabeça nos 32 quadros medidos (rodada 1: 3 direções com a
   *   lâmina sobre o crânio; rodada 2: 59px, concentrados no quadro de armar das
   *   direções 0 e 7).
   *
   * POR QUE A ELEVAÇÃO É O PARÂMETRO QUE IMPORTA — a conta que a rodada 2 não
   * fez. Escreva o eixo da lâmina como `h = cos(elev)` no azimute `φ` mais
   * `sen(elev)` em Z. Sob a projeção de §4.2, girado de `θ`, ele mede
   *
   *   artX = h·√2·cos(ψ)          artY = h·(√2/2)·sen(ψ) − sen(elev)
   *
   * com `ψ = φ + θ + 45°`. O eixo projetado ZERA quando `cos ψ = 0` e os dois
   * termos de `artY` se cancelam, isto é quando `tg(elev) = √2/2` —
   * **elev = 35,26°**, o pior valor possível para qualquer azimute. Longe dele o
   * PISO sobe, e é só a elevação que o levanta: o azimute apenas escolhe QUAIS
   * das 8 direções caem perto do buraco. Daí a rodada 2, a 50,3°, ter ficado com
   * o pior eixo em 7,8px enquanto 59,5° o leva a 12,3px:
   *
   *   dir 0..7 (rodada 2):  7,8 · 19,5 · 25,1 · 24,8 · 24,4 · 25,4 · 21,8 · 11,2
   *   dir 0..7 (rodada 3): 12,7 · 21,7 · 26,4 · 26,7 · 26,7 · 26,3 · 21,3 · 12,3
   *
   * — pior caso +58%, razão pior/melhor de 3,3× para 2,2×. O ótimo teórico desta
   * família fica em ~69° de elevação (piso 15,4px), e não foi usado porque acima
   * de ~62° a lâmina volta a subir na frente do rosto nas direções 0 e 7.
   *
   * Limites, para quem for ajustar. Eles dependem de `AJUSTES_GOBLIN.maoX`, e é
   * por isso que os dois números têm de ser mexidos JUNTOS: o teto de ~52° de
   * subida que a rodada 2 registrou aqui foi medido com a mão em x −4,0, e com a
   * mão em x −6,4 a folga lateral cresce 2,4u e o teto vai para ~62°. Abaixo de
   * ~35° a lâmina cai no buraco da projeção acima; abaixo de ~20° ela deita e lê
   * como tábua, o defeito da rodada 1. O SINAL de `ry` continua inegociável:
   * positivo joga a ponta contra o próprio corpo.
   */
  cimitarraRx: -6,
  cimitarraRy: -30,

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
   * Rodada 1 (§8): o arco GENÉRICO reprovou neste bicho, e a causa era
   * geométrica. Com a cimitarra DEITADA sobre o ombro, o vetor punho→ponta tinha
   * uma componente −Y enorme e o sinal de `rx` se invertia — o arco genérico
   * fazia o goblin erguer a arma e parar. A cura de então foi inverter os sinais
   * (`rx +55/+75` no impacto).
   *
   * RODADA 2 (§8): a pose de repouso mudou de lado (ver o cabeçalho do módulo) e
   * o arco da rodada 1 morreu junto — ele estava calibrado para uma arma que
   * nascia atrás da nuca. Pior: como o repouso escondia a arma, o quadro 0 do
   * ataque partia de uma guarda invisível, e era isso que fazia a animação "ficar
   * feia" mesmo com números grandes de percurso. Golpe começa onde o olho já
   * estava.
   *
   * Com a arma à frente, os sinais voltam a ser os NATURAIS, os mesmos do
   * Guerreiro: a mão está em `+Y/−Z` em relação ao ombro, então `rx > 0` a leva
   * para a frente e para CIMA (armar) e `rx < 0` a traz para baixo (desferir).
   * O canal `ry` é multiplicado por `ESPELHO` na aplicação (§ `poseDoQuadro` de
   * `../spriteForge`), de modo que `ry` NEGATIVO aqui abre o braço para FORA e
   * `ry` positivo o traz para dentro, cruzando o corpo — que é o gesto de quem
   * corta com uma lâmina curva.
   *
   * RODADA 3 (§8): o arco da rodada 2 ARMAVA ALTO (`rx +15`) e depois cruzava o
   * corpo (`ry` de −10 a +45). As duas coisas cobravam preço nos extremos: o
   * armar alto pintava 30px de lâmina sobre a cabeça na direção 0 e 29px na 7 —
   * a queixa original do dono reencarnada no quadro de preparo —, e o cruzamento
   * enfiava a lâmina atrás do tronco nas rotações de costas, onde o quadro de
   * impacto da direção 4 caía para 18px de arte. Agora o arco COMEÇA MAIS BAIXO
   * (`rx −4`) e vira menos para dentro.
   *
   * O arco é monotonicamente DESCENDENTE. Medido no eixo de tela da direção 2
   * (`artY = (x + y)/2 − z`, onde o giro é zero; `artY` cresce para BAIXO), já
   * com o `deslocY` que o forge aplica por quadro (`ALTURA_GOLPE`, +2/−2/0 px de
   * arte — esquecê-lo é medir um percurso que o atlas não tem):
   *
   *   | quadro     | rx  | ry  | ponta da lâmina        | `artY` |
   *   |------------|-----|-----|------------------------|--------|
   *   | 0 armar    |  −4 |  −4 | (−10,35, +4,46, 13,21) | −42,4  |
   *   | 1 impacto  |  −8 | +12 | (−11,60, +4,49, 10,56) | −33,3  |
   *   | 2 assentar | −54 | +14 | (−11,71, +4,78,  6,33) | −24,5  |
   *
   * O quadro de impacto é o **1** — é com ele que o `IsoRenderer` sincroniza o
   * clarão de dano. No quadro 2 a ponta fecha em z 6,33, abaixo do ombro (7,9) e
   * na linha do peito: o golpe termina descendo, como §6 manda.
   *
   * O CRITÉRIO DE ACEITAÇÃO, endurecido nesta rodada. O da rodada 2 dava por bom
   * "a máscara vale 17% da do melhor quadro", e foi ele que carimbou como OK um
   * quadro de impacto com 18px de arte de lâmina. Agora cada um dos 24 quadros de
   * ataque tem de ter, medido por rasterização com ordem do pintor:
   *
   * - **≥ 25px de arte de lâmina FORA da silhueta do corpo** (piso absoluto) e
   *   **≥ 40% do melhor quadro daquela direção** (piso relativo). Hoje o pior de
   *   todos vale 32px, contra 12px da rodada 2;
   * - **zero** pixel de lâmina sobre a cabeça (rodada 2: 59px no total);
   * - a silhueta desenhada em **uma única ilha 4-conexa** — é a forma medível de
   *   "a arma está presa a alguém", e é o que reprova a lâmina flutuante que o
   *   dono recusou;
   * - a ponta DESCE na tela nos dois passos em **8 das 8** direções, com percurso
   *   0→1 ≥ 8px de arte (hoje: mínimo 8,4) e 1→2 ≥ 60% do primeiro passo (hoje:
   *   mínimo 0,67, média 0,79) — os três quadros nunca se confundem e o terceiro
   *   deixou de ser um cutucão.
   *
   * UM ALVO QUE FOI MEDIDO E RECUSADO, para não voltar como pedido: "a máscara do
   * quadro 2 vale ≥ 80% da do quadro de impacto". Ele é INALCANÇÁVEL neste rig —
   * varrendo a família inteira de arcos e de guardas, o melhor que existe é 74%,
   * e não porque o golpe recolha: nas direções 3 e 4 a lâmina chega ao impacto de
   * FACE para a câmera (máscara ~131px) e termina o arco mais de fio (~89px). É
   * encurtamento de perspectiva de uma lâmina rígida, não perda de leitura — o
   * valor absoluto continua 3× acima do piso. O que a rodada 2 tinha de errado
   * ali era outra coisa: 36px, 39% do impacto.
   *
   * Os valores de `ry` existem porque o plano X-Z é o único que a projeção
   * isométrica nunca achata (a mesma causa raiz de `LATERAL` em
   * `../spriteForge`); um arco só em `rx` vive no plano Y-Z e encolhe em metade
   * das direções. Mas eles são MENORES que os da rodada 2 de propósito: `ry`
   * positivo traz o braço para dentro, cruzando o corpo, e passar de ~+15 no
   * último quadro põe a lâmina atrás do tronco nas direções 3 e 4.
   */
  golpeRx: [-4, -8, -54],
  golpeRy: [-4, 12, 14]
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
 * em `./warrior`): o nó é ancorado no centro da mão e as peças são espelhadas
 * para +Z. As distâncias ao punho são as mesmas da §5, peça por peça
 * (0,95 · 2,10 · 3,85 · 6,65u), mais o `bico` da rodada 3 em 8,0u — a lâmina
 * fecha em 8,65u da mão, contra 7,95 da §5, +9% de comprimento e nada de
 * proporção: continua uma cimitarra curta, não uma espada. A lâmina nasce
 * apontando para CIMA com
 * rotação zero; quem a inclina na guarda à frente é `POSE_PARADA_GOBLIN`, com os
 * dois ângulos documentados em `ANGULOS_GOBLIN`.
 *
 * O pivô sai INTEIRO de `AJUSTES_GOBLIN.mao{X,Y,Z}` — as mesmas três constantes
 * que posicionam a caixa da mão em `criarBracoDir`. Enquanto for assim, mudar a
 * guarda move mão e arma juntas e não existe o estado "cabo a meio palmo do
 * punho", que é o defeito silencioso deste tipo de rig.
 *
 * A CURVA sai do escalonamento das duas caixas, como a §5 manda: a ponta é mais
 * larga (2.4 contra 1.6) e desloca 0,6u no +Y local. Com a guarda de repouso o
 * +Y local aponta para cima e para a frente, então o alargamento vira barriga de
 * lâmina subindo para a ponta — a curva da cimitarra. Não é uma caixa torta: é o
 * degrau entre duas caixas, que na rasterização em baixa resolução lê como
 * curva pelo mesmo motivo que o octógono do escudo lê como disco.
 *
 * Espessuras: 1.1 e 1.0u (a §5 pede 0.7 e 0.8). É o piso de ~2px de arte de
 * novo — abaixo dele a lâmina se desfia em pontilhado e o contorno acaba de
 * matá-la. A largura da lâmina (1.6 e 2.4u) não mudou: é ela que carrega I6.
 *
 * RODADA 3 (§8) — DUAS MUDANÇAS NA LÂMINA, as duas por legibilidade de perfil:
 *
 * - a ESPESSURA subiu de 0.8/0.9 para 1.1/1.0u. Nas direções em que a lâmina
 *   fica de fio para o observador ela imprimia 1–3px e virava um espeto; com
 *   ~2,5px de arte sobra corpo cinza mesmo no pior giro. Custa alguns pixels de
 *   silhueta e nada na forja;
 * - ganhou uma QUARTA caixa, o `bico`, mais estreita que a ponta (1.4 contra
 *   2.4u) e depois dela. O degrau passa a ser 1,6 → 2,4 → 1,4: a barriga cresce e
 *   depois afina, que é o desenho da cimitarra de I6, e a silhueta termina em
 *   BICO em vez de reto. Sem ela, nas direções em que a lâmina aparece de face
 *   (0 e 7, as de eixo mais curto — ver `ANGULOS_GOBLIN.cimitarraRx`), o que se
 *   via era um retângulo cinza sem ponta. É a mesma economia do escudo do
 *   Guerreiro: aproximar a forma por caixas em vez de pedir rotação ao rig.
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
    pivo: [AJ.maoX, AJ.maoY, AJ.maoZ],
    caixas: [
      detalhe('couroBase', [0.8, 0.8, 1.8], [0, 0, 0.95]), //  punho enfaixado (§5: cz −5.2)
      detalhe('acoSombra', [1.8, 0.9, 0.5], [0, 0, 2.1]), //  guarda          (§5: cz −6.2)
      detalhe('acoBase', [1.1, 1.6, 3.0], [0, 0, 3.85]), //  lamina.base     (§5: cz −8.0)
      detalhe('acoBase', [1.0, 2.4, 2.6], [0, 0.6, 6.65]), //  lamina.ponta    (§5: cz −10.6)
      detalhe('acoBase', [0.9, 1.4, 1.3], [0, 0.9, 8.0]) //  bico            ← I6 (a curva fecha em ponta)
    ]
  };
}

/**
 * bracoDir — o braço que empunha a cimitarra (I6). Mora em −X pelo espelho de
 * §6.1.
 *
 * O COTOVELO é dobrado na geometria, e isto merece explicação porque contraria a
 * leitura ingênua da §5 (`braco`, `antebraco` e `mao` empilhados em −Z, um braço
 * reto pendurado).
 *
 * O rig da §5 é plano: braço, antebraço e mão são caixas do MESMO nó, não nós
 * encadeados — não existe junta de cotovelo para dobrar por pose. E um braço
 * reto de 4,2u girando no ombro descreve um círculo de raio 4,2: a mão só pode
 * estar na borda desse círculo, nunca dobrada à frente do peito. Acrescentar um
 * nó de antebraço resolveria, e foi recusado: mudaria a árvore de §5 (que o
 * `NOS_HUMANOIDE` do forge espelha) para ganhar um grau de liberdade que nenhuma
 * animação desta fase usa. A cura barata é a mesma da arma — descrever a dobra
 * nas coordenadas das caixas.
 *
 * RODADA 2 (§8) — A DOBRA VIROU DE LADO. Ela apontava para TRÁS (`antebraço` em
 * `cy −0.75`, mão em `cy −1.4`): o cotovelo subia por trás e a mão fechava acima
 * e atrás do ombro, que é o único jeito de deitar a lâmina no ombro. O efeito
 * colateral era o defeito desta rodada — o conjunto punho-guarda-lâmina ficava
 * inteiro atrás do plano do tronco, sem mão à vista na frente do corpo.
 *
 * Agora a dobra é um **L para a frente e para FORA**, a mesma de quem segura uma
 * arma em guarda afastada do corpo:
 *
 *   ombro (0, 0, 0) → cotovelo (≈ −1.7, +1.4, −1.9) → mão (−3.8, +2.4, −2.3)
 *
 * - o `braço` (úmero) PENDE do ombro abrindo para fora: a caixa cobre o pivô
 *   (x −1.9..+0.3) e por isso continua costurada na caixa `ombro.esq` do torso
 *   (x −3.4..−1.6 no mundo), sem vão;
 * - o `antebraço` sai para a FRENTE e para fora, em `trapo` — e este é o único
 *   lugar do rig onde a bandagem clara de I7 recorta contra o FUNDO, porque a
 *   caixa fecha em x −6,35..−4,25 no mundo, inteiramente fora do colete
 *   (|x| ≤ 2,05). É a peça que liga visualmente ombro e cabo;
 * - a `mão` fecha em `AJUSTES_GOBLIN.mao{X,Y,Z}`, à frente do peito. As três
 *   constantes são as MESMAS que ancoram `criarCimitarra` — ver lá.
 *
 * RODADA 3 (§8) — AS TRÊS CAIXAS ACOMPANHARAM A MÃO, e não é acabamento: é a
 * condição para a abertura do braço não virar outro defeito. A mão foi de x −4,0
 * para x −6,4 no mundo (ver `AJUSTES_GOBLIN.maoX`); com o úmero e o antebraço nos
 * números da rodada 2 sobraria um VÃO entre o ombro e a mão, e a silhueta se
 * partiria em duas ilhas — exatamente a "peça de metal solta" que esta fase
 * existe para eliminar, só que agora com a mão junto. As caixas se sobrepõem em
 * cadeia (ombro −3,4..−1,6 · úmero −4,5..−2,3 · antebraço −6,35..−4,25 · mão
 * −7,1..−5,7), e a varredura confirma: silhueta em UMA ilha 4-conexa nos 32
 * quadros medidos. O úmero também engrossou em X (1.5 → 2.2) porque, esticado, um
 * cilindro fino de 1,5u lê como galho, não como braço.
 *
 * O que se perde, e é aceitável: sem nó de cotovelo, o golpe (§6) gira o braço
 * inteiro no ombro, então a dobra é RÍGIDA durante o ataque — o goblin corta com
 * o ombro, não com o cotovelo. Num bicho de 40px de arte isso não é distinguível;
 * o que é distinguível, e agora existe, é a lâmina saindo da mão.
 */
function criarBracoDir(): No {
  return {
    nome: NOS_GOBLIN.bracoDir,
    pivo: [-P.xOmbro, 0, P.zOmbro],
    caixas: [
      detalhe('peleBase', [2.2, 1.6, 2.0], [-0.8, 0.2, -0.95]), //  braço (pende do ombro, abrindo)
      detalhe('trapo', [2.1, 1.9, 1.4], [-2.7, 1.4, -1.95]), //  antebraço à frente ← I7
      detalhe('peleBase', [1.4, 1.4, 1.1], [AJ.maoX, AJ.maoY, AJ.maoZ]) //  mão
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
 * A pose de referência: cimitarra EMPUNHADA À FRENTE, em guarda diagonal baixa e
 * lateral (I6), e o braço livre pendendo um pouco aberto. É a pose que faz a
 * silhueta ler como "goblin encrenqueiro" à distância — a arma pendurada ao lado
 * não lê, e a arma deitada no ombro (a da rodada 1, e a da referência) lê como
 * barra cinza solta neste tamanho de sprite. Ver o cabeçalho do módulo.
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

/* ------------------------------------------------------------------ *
 * 8. Morte do Goblin (fase das cinemáticas de abate — docs/BESTIARIO.md §14)
 *
 * A MESMA técnica da morte do Guerreiro (§8 de `./warrior`): as poses abaixo
 * NÃO passam pela animação de §6 — são REPUSOS de forja congelados na coluna
 * ('parado', 0) de atlases secundários, lidos na direção do facing. A queda da
 * cimitarra é rotação de TELA no renderer, não de pose. Nada aqui toca o
 * engine (R54): quem detecta o abate é o IsoRenderer, por observação.
 *
 * O RASTRO do goblin é o CORPO caído sobre a poça de sangue — a cimitarra cai
 * junto, mas some (afunda fora da tela): é o contraste deliberado com o Ogro,
 * cuja marca é a arma, e com o Slime, cuja marca é a geleia.
 * ------------------------------------------------------------------ */

/**
 * Variante SEM a cimitarra, para a sequência de morte: `criarModeloGoblin()`
 * (árvore NOVA — `MODELO_GOBLIN` nunca é tocado) com o filho `cimitarra` de
 * `bracoDir` podado pelo nome. Mesmo molde de `criarModeloGuerreiroSemEspada`:
 * o corpo é o mesmo, e duas declarações do mesmo corpo divergem no primeiro
 * ajuste visual.
 */
export function criarModeloGoblinSemCimitarra(): No {
  const modelo = criarModeloGoblin();
  const filhos = modelo.filhos ?? [];
  return {
    ...modelo,
    filhos: filhos.map((no) =>
      no.nome === NOS_GOBLIN.bracoDir
        ? {
          ...no,
          filhos: (no.filhos ?? []).filter((f) => f.nome !== NOS_GOBLIN.cimitarra)
        }
        : no
    )
  };
}

/**
 * A cimitarra SOZINHA, como mini-rig: um nó raiz com as caixas de
 * `criarCimitarra()` em pé a partir da origem (a base do punho em z ≈ 0 — a
 * âncora do atlas é o punho, que é por onde a sequência de morte a faz girar).
 * Forjada com repouso neutro e lida na coluna ('parado', 0): a rotação da
 * queda é de TELA (`ctx.rotate` no renderer), não de pose.
 */
export function criarModeloCimitarra(): No {
  return {
    nome: NOS_GOBLIN.raiz,
    pivo: [0, 0, 0],
    caixas: criarCimitarra().caixas
  };
}

/** Mesmo padrão de `MODELO_GOBLIN`: constantes de módulo, não mutar. */
export const MODELO_GOBLIN_SEM_CIMITARRA: No = criarModeloGoblinSemCimitarra();
export const MODELO_CIMITARRA: No = criarModeloCimitarra();

/**
 * POSE_MORTE_GOBLIN_AGACHADO — o cambaleio (fase intermediária, ~0,3–0,75 s).
 *
 * No molde de `POSE_AJOELHADA` do Guerreiro, com o tempero do bicho: o goblin
 * é baixo e cartunesco, então o tronco fecha MAIS (+32° — ele desaba para a
 * frente, não se ajoelha com dignidade). `pernaDir` dobrada para trás (rx
 * −75°: a leitura do joelho que tocou o chão), `pernaEsq` plantada à frente.
 * Braços pendentes, abertos só o bastante para não fundirem no tronco. As
 * ORELHAS caem para a frente junto com a cabeça (rx +28° somados à inclinação
 * de geometria): são o traço I2, e é o desabamento delas que vende o apagar
 * dos olhos. Sem `cimitarra`: esta pose é forjada sobre
 * `MODELO_GOBLIN_SEM_CIMITARRA`.
 */
export const POSE_MORTE_GOBLIN_AGACHADO: Pose = {
  [NOS_GOBLIN.pernaDir]: { rx: grausParaRad(-75) },
  [NOS_GOBLIN.pernaEsq]: { rx: grausParaRad(25) },
  [NOS_GOBLIN.torso]: { rx: grausParaRad(32) },
  [NOS_GOBLIN.cabeca]: { rx: grausParaRad(25) },
  [NOS_GOBLIN.bracoDir]: { rx: grausParaRad(12), ry: grausParaRad(15) },
  [NOS_GOBLIN.bracoEsq]: { rx: grausParaRad(14), ry: grausParaRad(-18) },
  [NOS_GOBLIN.orelhaEsq]: { rx: grausParaRad(28) },
  [NOS_GOBLIN.orelhaDir]: { rx: grausParaRad(28) }
};

/**
 * POSE_MORTE_GOBLIN_CAIDO — deitado no chão (fase final, PERSISTENTE: é o
 * rastro do abate).
 *
 * A via do Guerreiro (`POSE_CAIDA`): girar a `raiz` em rx +85° tomba o corpo
 * INTEIRO de COSTAS — em `matPivoRotacao`, `rx` positivo leva o topo (+Z)
 * para −Y, as costas — e o corpo se estende a partir da âncora (os pés ficam
 * na origem), de face para CIMA. Torso −8° e cabeça −12° erguem peito e rosto
 * para fora do plano do chão, com rz +25° na cabeça — o elmo tombado de lado
 * separa "deitado" de "agachado". Braços abertos (ry ±40°), pernas levemente
 * dobradas e assimétricas (cadáver simétrico lê como manequim). As orelhas
 * abrem em leque (ry ∓35°): no chão, elas são a silhueta que continua lendo
 * "goblin morto" a três tiles — sem elas o corpo caído seria um monte verde
 * anônimo.
 */
export const POSE_MORTE_GOBLIN_CAIDO: Pose = {
  [NOS_GOBLIN.raiz]: { rx: grausParaRad(85) },
  [NOS_GOBLIN.torso]: { rx: grausParaRad(-8) },
  [NOS_GOBLIN.cabeca]: { rx: grausParaRad(-12), rz: grausParaRad(25) },
  [NOS_GOBLIN.bracoDir]: { rx: grausParaRad(10), ry: grausParaRad(40) },
  [NOS_GOBLIN.bracoEsq]: { rx: grausParaRad(10), ry: grausParaRad(-40) },
  [NOS_GOBLIN.pernaDir]: { rx: grausParaRad(15) },
  [NOS_GOBLIN.pernaEsq]: { rx: grausParaRad(-10) },
  [NOS_GOBLIN.orelhaEsq]: { ry: grausParaRad(-35) },
  [NOS_GOBLIN.orelhaDir]: { ry: grausParaRad(35) }
};
