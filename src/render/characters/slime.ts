/*
 * ISOROGUE — src/render/characters/slime.ts
 *
 * O rig do Slime: paleta canônica (§11.2 do docs/BESTIARIO.md) e blockout
 * hierárquico de caixas (§11.3). Reconstrução POR CÓDIGO a partir de
 * docs/ref/slime-referencia.jpg — nenhuma imagem, nenhum asset, nenhuma URL.
 *
 * Este módulo é o gêmeo de `./warrior` e de `./goblin` e tem exatamente as
 * mesmas responsabilidades e os mesmos limites:
 *   - é a fonte da verdade da FORMA (árvore de nós, pivôs, caixas);
 *   - é a fonte da verdade da COR (`PALETA_SLIME` + rampas de material);
 *   - guarda a pose de repouso (`POSE_PARADA_SLIME`) e os números que a revisão
 *     visual (§13) pode mexer sem tocar na estrutura.
 *
 * O que ele NÃO é: não projeta, não rasteriza, não anima e não conhece Canvas.
 * Projeção e faces são de `../model3d`; atlas e animação são de `../spriteForge`.
 * O forge continua agnóstico de personagem — ele recebe `paleta`, `rampas`,
 * `rampaDaCor`, `repouso`, `arcoGolpe` e `emissivas` em `opts` e não pergunta
 * quem é o dono.
 *
 * ATENÇÃO ao que este arquivo NÃO faz, por contrato (§0 do BESTIARIO):
 *   - o Slime é a APARÊNCIA do arquétipo `linker` que já existe. Nada aqui
 *     encosta em `src/engine/entities.ts`, em `ARCHETYPES`, em `populate()`,
 *     em IA, hp, atk ou range. O golden test congela quais inimigos nascem em
 *     cada semente e não pode mudar de cor por causa de um sprite;
 *   - o `facing` do inimigo é derivado 100% na camada de render (o `IsoRenderer`
 *     já guarda estado por entidade em `vfxOf`). Nenhum campo novo em `Enemy`,
 *     em `snapshot()`, no save ou no oracle.
 *
 * Invariantes:
 *   - Determinístico: zero `Math.random`, zero relógio, zero DOM.
 *   - `criarModeloSlime()` devolve uma árvore NOVA a cada chamada — nenhum
 *     array é compartilhado entre instâncias.
 *   - Traços de identidade S1..S6 (§11.1) sobrevivem na silhueta. Perder os
 *     olhos em cruz (S4) e a antena com bolinha (S5) transforma o slime numa
 *     pedra verde: são eles a leitura à distância.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta canônica (§11.2 do BESTIARIO) — amostrada da referência
 * ------------------------------------------------------------------ */

/**
 * As 10 cores do Slime, exatamente como a §11.2 as declara. É a paleta INTEIRA
 * do personagem: o sombreamento de face (§4.3 do PERSONAGEM.md) quantiza para
 * estes tons em vez de gerar cor nova, e é isso que mantém a cara de pixel art.
 * Não acrescente cor aqui sem passar pelo gate G5.
 *
 * A saturação é deliberadamente ALTA: os três monstros são esverdeados e é a
 * saturação que os separa à distância (§12.2) — Slime vibrante, Goblin médio,
 * Ogro pálido. Mexer nos verdes daqui é mexer no gate G9.
 */
export const PALETA_SLIME = {
  gosmaLuz: '#7ee89a', // topo do domo, cume
  gosmaBase: '#4fd07a', // massa central da gota
  gosmaMeio: '#2fa85e', // camada que assenta no chão
  gosmaSombra: '#1d7a45', // saia de contato com o piso, faces afastadas
  gosmaFundo: '#145c34', // vãos, faces laterais da saia e a haste NO AR (S5)
  brilho: '#d8fbe6', // o especular do topo (S3)
  antena: '#14201a', // raiz da haste, onde ela cruza o corpo claro (S5)
  luzAmbar: '#ffd94a', // EMISSIVA — olhos e bolinha (S4, S5), §1.1
  vazio: '#0f2a1c', // boca, vãos, sombra interna
  contorno: '#0a1a10' // outline
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorSlime = keyof typeof PALETA_SLIME;

/**
 * As rampas de quantização por material (§4.3 do PERSONAGEM.md): o fator de luz
 * da face escolhe um destes tons. A rampa é propriedade do MATERIAL, e o
 * material é propriedade do modelo — por isso ela mora aqui e não no forge.
 *
 * Luminâncias medidas (mesmos pesos de `../model3d`), para quem for reajustar:
 * gosmaLuz 191,4 · gosmaBase 159,6 · gosmaMeio 123,4 · gosmaSombra 88,1 ·
 * gosmaFundo 65,9 · brilho 238,1 · luzAmbar 212,0 · vazio 32,3 · antena 27,7 ·
 * contorno 20,1.
 *
 * Com os fatores canônicos (`GANHO_SOMBRA` 1.15, `REALCE_TOPO` 1.25) uma caixa
 * declarada `gosmaBase` sai:
 *
 * | face   | normal | alvo  | degrau       |
 * |--------|--------|-------|--------------|
 * | topo   | +Z     | 199,5 | `gosmaLuz`   |
 * | frente | +Y     | 158,2 | `gosmaBase`  |
 * | lado   | +X     | 126,1 | `gosmaMeio`  |
 *
 * e uma declarada `gosmaMeio` desce para gosmaBase/gosmaMeio/gosmaSombra. É
 * essa cascata, e não alfa, que faz a translucidez de S2: cinco degraus de um
 * verde só, do fundo da poça ao alto do domo.
 *
 * Três rampas merecem nota:
 *
 * - `brilho` PRECISA da própria rampa. Sem ela o especular cairia na rampa
 *   DERIVADA de `../model3d`, que inventa 4 multiplicações da cor base — cores
 *   fora da §11.2, gate G5 reprovado por construção. Encadeada nos verdes, o
 *   branco fica chapado no topo e na frente (as duas caem em `brilho`) e só a
 *   face lateral desce para `gosmaLuz`: é exatamente o que um ponto especular
 *   deve fazer — não ter volume próprio;
 * - `antena` tem três tons quase pretos de propósito, e a RODADA 2 reduziu o
 *   alcance dela a um único trecho. O raciocínio original — "`antena` (27,7) e
 *   `contorno` (20,1) são vizinhos, então a haste sobrevive à própria erosão
 *   sem mudar de leitura" — está certo COMO ARITMÉTICA e errado como leitura:
 *   ele vale enquanto a haste vive sobre o verde claro do corpo, e deixa de
 *   valer no instante em que ela sai para o AR. Contra o piso da masmorra
 *   (#0d1117, luminância ~16,6) uma haste de `antena`/`contorno` é preto sobre
 *   preto: S5 tem 74 px² de área medida e mesmo assim não existe na silhueta.
 *   Por isso a haste no ar é `gosmaFundo` (65,9) — quatro vezes a luminância do
 *   fundo, ainda escura o bastante para ler como haste contra o corpo — e só a
 *   RAIZ, o trecho que cruza a coroa clara, continua em `antena`;
 * - `ambar` tem UM tom, de propósito. Ver §1.2 abaixo.
 */
export const RAMPAS_SLIME = {
  gosma: ['gosmaLuz', 'gosmaBase', 'gosmaMeio', 'gosmaSombra', 'gosmaFundo'],
  brilho: ['brilho', 'gosmaLuz', 'gosmaBase', 'gosmaMeio'],
  antena: ['antena', 'vazio', 'contorno'],
  ambar: ['luzAmbar'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorSlime[]>;

/** Rampa a que cada cor de peça pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_SLIME = {
  gosmaLuz: 'gosma',
  gosmaBase: 'gosma',
  gosmaMeio: 'gosma',
  gosmaSombra: 'gosma',
  gosmaFundo: 'gosma',
  brilho: 'brilho',
  antena: 'antena',
  luzAmbar: 'ambar',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorSlime, keyof typeof RAMPAS_SLIME>;

/* ------------------------------------------------------------------ *
 * 1.2 A marcação de EMISSIVA (§1.1 do BESTIARIO) — o formato, explicado
 * ------------------------------------------------------------------ */

/**
 * As cores que IGNORAM a modulação de luz de `quadroModulado()` e saem sempre em
 * brilho pleno. No Goblin são dois pontos vermelhos no escuro; aqui são TRÊS
 * pontos âmbar — os dois olhos em cruz (S4) e a bolinha da antena (S5) —, e a
 * bolinha é a que fica ACIMA do corpo, o que faz um slime no limite do campo de
 * visão aparecer antes como uma isca flutuando do que como uma pedra.
 *
 * O contrato é o mesmo do `CORES_EMISSIVAS_GOBLIN`, nas mesmas três peças:
 *
 * 1. **Esta lista.** São nomes de CHAVE da `PALETA_SLIME` (`'luzAmbar'`), nunca
 *    hex: quem consome resolve o hex pela paleta que já recebeu. É o valor que
 *    vai direto em `forjarAtlas(modelo, { …, emissivas: CORES_EMISSIVAS_SLIME })`
 *    e o mesmo nome que `tools/preview-entry.ts` procura
 *    (`CORES_EMISSIVAS_SLIME` → `CORES_EMISSIVAS` → `EMISSIVAS`) para montar a
 *    tira de 4 níveis de luz do gate G8.
 *
 * 2. **A rampa de UM tom** (`RAMPAS_SLIME.ambar`). O atlas é forjado uma vez, em
 *    brilho pleno, e o escurecimento é por pixel; para reconhecer o pixel do
 *    olho DEPOIS da rasterização — quando o nome da cor já não existe e só
 *    sobrou RGB — o consumidor pede a `rampaEfetiva()` de `../model3d`. Com uma
 *    rampa de 4 tons as seis faces do olho sairiam em 4 âmbares diferentes e a
 *    máscara teria de casar os quatro; com UM tom a quantização não tem para
 *    onde ir e as seis faces saem em `#ffd94a` cravado.
 *
 * 3. **A distância do hex.** O snap de paleta (§2.1 de `../spriteForge`) empurra
 *    todo pixel borrado para o degrau mais próximo, então um âmbar com vizinho
 *    próximo acenderia sujeira em volta do rosto. Medido com a distância
 *    ponderada do snap (2/4/3 em R/G/B), na mistura olho+corpo (`luzAmbar` com
 *    `gosmaBase`, que é o tom da face onde o olho é montado) o ponto de virada
 *    está em **54% de âmbar**: abaixo disso o pixel cai em `gosmaLuz`, acima
 *    cai em `luzAmbar`. Ou seja o vazamento é meio pixel de borda, não uma
 *    auréola. O único vizinho perigoso é `brilho` (o especular), que empata com
 *    o âmbar numa mistura 50/50 — e empate vai para a primeira cor declarada,
 *    que é `brilho`. Por isso especular e bolinha nascem em alturas diferentes
 *    do modelo: eles nunca se tocam na projeção.
 *
 * Quem NÃO precisa saber de nada disto: o rig (as caixas só declaram `cor`) e o
 * `../model3d` (para ele `luzAmbar` é um material como outro qualquer).
 */
export const CORES_EMISSIVAS_SLIME: readonly CorSlime[] = ['luzAmbar'];

/* ------------------------------------------------------------------ *
 * 2. Proporções (§11.3) — a estrutura, que NÃO se ajusta
 * ------------------------------------------------------------------ */

/**
 * Medidas em `u` (espaço local do modelo: +X direita, +Y frente, +Z cima,
 * origem no centro da base, no chão). Vêm do blockout obrigatório da §11.3 —
 * mexer nelas muda a identidade S1 (mais largo que alto) e reprova G1 e G10.
 *
 * A regra de escala é a mesma do Goblin e do Guerreiro: `ART_POR_U` é UMA para
 * o projeto inteiro e a diferença de tamanho na tela vem da altura real do
 * modelo, nunca de um fator aplicado no sprite. É isso que põe os três na mesma
 * perspectiva e faz o gate G10 (Slime < Goblin < Guerreiro < Ogro) ser
 * julgável.
 */
export const PROPORCOES_SLIME = {
  /**
   * ALTURA_MASSA_SLIME: a GOTA, do plano do chão ao alto da coroa. O blockout
   * fecha em 7,0u — os 7u da §11.3 cravados, contra 13u do Goblin e 18u do
   * Guerreiro. É ESTA medida que carrega G10, e não a silhueta (ver abaixo).
   *
   * Ela não conta a parte da saia que afunda no piso (`afundar`), porque a
   * âncora do sprite é o plano z = 0 e é dele que a bancada mede
   * `alturaAcimaDaAncora` no painel 7.
   */
  alturaCorpo: 7.0,

  /**
   * ALTURA_SILHUETA_SLIME: a silhueta inteira, com o arco da antena
   * (−1,0 no fundo da saia até ~10,3 no alto do arco).
   *
   * A §11.3 declara 7u de altura e ao mesmo tempo lista uma antena que sobe a
   * 10,25u — os dois números não podem ser verdade juntos. A RODADA 1 resolveu
   * isso encurtando a antena (bolinha em z 8,3), e essa foi a decisão que matou
   * S5: com o arco baixo, a bolinha encostava no domo e as duas máscaras
   * FUNDIAM. Não havia um pixel de fundo entre a isca e o corpo, então a
   * bolinha lia como um caroço da gota — 74 px² de área visível e zero
   * contribuição de silhueta. Área não é legibilidade, e a tabela de oclusão
   * desta rodada 1 (que media área) não tinha como detectar isso.
   *
   * A RODADA 2 desfaz a decisão e separa as duas medidas em vez de escolher
   * uma: a MASSA fica nos 7u da §11.3 (é ela que responde por G10) e a
   * SILHUETA sobe para 11,8u no ápice do arco, com o CENTRO DA BOLINHA em
   * z 10,15 — dentro dos 9,6..10,5 que a própria §11.3 desenha. O arco passa
   * 4,8u acima da coroa e a bolinha desce depois dele, que é o percurso da isca
   * de tamboril da referência.
   *
   * O critério de aceite desta peça deixou de ser área e passou a ser
   * CONTRIBUIÇÃO DE MÁSCARA: quantos pixels da silhueta existem só por causa
   * dela, e quantos pixels de FUNDO LIVRE a separam do corpo, medidos nas 8
   * direções. Ver a tabela em `criarAntena`.
   */
  altura: 11.8,

  /**
   * §11.3 LARGURA_SLIME: mais largo que alto — é a identidade S1. A §11.3 pede
   * 11u e o blockout dela fechava em 10,4; a saia (ver `criarCorpo`) leva a
   * 11,4u, e é ela que entrega os 11u com um degrau visível em vez de com um
   * número no papel.
   *
   * Razão largura/altura da massa: 11,4 / 7,0 = 1,63:1. Na referência a gota
   * mede ~1,7:1. S1 fecha.
   */
  largura: 11.4,

  /**
   * Quanto a saia afunda no plano do chão, em `u`.
   *
   * A âncora do sprite é o plano z = 0 do modelo (o centro do losango do tile),
   * NUNCA a borda de baixo do quadro. O Guerreiro afunda a bota 0,2u e o Goblin
   * a sola; o Slime afunda a saia pelo mesmo motivo e com um bônus: S6 pede
   * "base achatada, quase colada no chão", e uma poça que entra no piso lê como
   * gosma escorrendo para dentro do losango em vez de um domo equilibrado em
   * cima dele.
   *
   * RODADA 2 — de 0,2 para 1,0u, e o motivo é MEDIDO, não estético. O estado
   * `parado` do forge levanta o modelo inteiro em `RESPIRO_U` (0,8u = 2px de
   * arte) no quadro 1. Com 0,2u de afundamento a saia subia 0,6u ACIMA do plano
   * do chão e o slime LEVITAVA — descolado do losango justamente no bicho cuja
   * identidade S6 é "assenta no chão, sem pernas". Com 1,0u ele continua 0,2u
   * dentro do piso no quadro levantado: a poça respira sem nunca soltar do
   * losango. O custo é zero de leitura, porque a saia cresceu de 1,0 para 1,8u
   * de altura e o que aparece acima do chão continua sendo 0,8u dela.
   */
  afundar: 1.0,

  /**
   * Altura (z) do pivô da antena, medida do chão. A §11.3 põe 6.4 num domo que
   * fechava em 6,4; com o perfil novo (coroa em 7,0) o pivô fica 0,2u dentro do
   * cume, de modo que a raiz da haste nasce ENTERRADA em vez de brotar do ar.
   */
  zAntena: 6.2,
  /** Deslocamento em X do pivô da antena (§11.3: 0.8). */
  xAntena: 0.6,

  /**
   * Meia-bitola dos olhos (a §11.3 pede 1.9).
   *
   * RODADA 2 — 1,75 → 2,0. O número de antes vinha de uma margem contra a borda
   * da camada `alto`, e essa margem mudou junto com o perfil do domo: `alto`
   * agora tem 8,6u (meia 4,3) em vez de 6,8. Com o recesso escuro de 3,4u de
   * largura em torno de cada cruz, o par fecha em |x| ≤ 3,7 — sobram 0,6u
   * (1,5px de arte) até a borda de `alto` e 0,6u (1,5px) de gosma ENTRE os dois
   * recessos. Os dois olhos continuam ilhados e continuam lendo como um PAR:
   * afastá-los mais separaria em X e, pela projeção (`artY` cresce com `x`),
   * também em altura de tela — que é o defeito que desfaz a gestalt de par.
   */
  xOlho: 2.0,

  /**
   * Plano frontal do ROSTO, em `u`. Olhos, recessos e boca são montados com o
   * centro neste `y`, ou seja avançam ~0,9u além da face frontal da camada
   * `alto` (3,55) e ~0,2u além da de `meio` (4,25).
   *
   * A protrusão não é enfeite: ela é o que faz o rosto GANHAR a ordem do pintor.
   * Ver o bloco de `criarCorpo` sobre a costura das camadas — é a armadilha
   * estrutural deste monstro.
   */
  yRosto: 4.1,

  /**
   * A COSTURA: o `x` em que a camada `alto` é partida em duas caixas. Número de
   * estrutura, não de acabamento — ver a explicação inteira em `criarCorpo`.
   *
   * RODADA 2 — `meio` deixou de precisar de costura, porque o rosto subiu para
   * a camada `alto` e ganhou 1,3u de altura sobre `meio`; na profundidade
   * `x + y + z` essa altura sozinha já põe os dois olhos na frente de `meio`
   * nas duas metades. Uma costura a menos é uma caixa a menos e um degrau a
   * menos de risco de aresta interna.
   */
  costuraAlto: 0.4
} as const;

/* ------------------------------------------------------------------ *
 * 3. Ajustes de revisão visual (§13) — os únicos números "negociáveis"
 * ------------------------------------------------------------------ */

/**
 * Ângulos da pose de repouso, em GRAUS (a conversão para radianos é feita ao
 * montar `POSE_PARADA_SLIME`). Ajustáveis pela revisão visual — gates G1 e G6.
 */
export const ANGULOS_SLIME = {
  /**
   * A antena pendendo para a FRENTE no repouso, como a isca de um tamboril.
   *
   * Convenção de sinal, e ela é o INVERSO da dos membros do Guerreiro: um
   * membro se estende no −Z local, então `rx > 0` leva a extremidade para +Y; a
   * antena se estende no +Z a partir do cume, então `rx > 0` a leva para −Y (o
   * fundo) e `rx < 0` para a frente. Mesma inversão que a cimitarra do Goblin
   * documenta, pela mesma causa.
   *
   * Por que não zero: com a antena exatamente na vertical o ciclo de caminhada
   * oscila em torno do prumo e o bicho lê como rígido. Com −12° a bolinha nasce
   * 0,59u à frente do cume (2,83u de braço × sen 12°) e o balanço de §11.4
   * passa a ter um centro fora do zero — gelatina nunca está reta.
   */
  antenaRepousoRx: -12
} as const;

/**
 * Os números de §11.4 (animação) que são PRÓPRIOS do Slime — o "tempero do
 * bicho" em cima do ciclo genérico de `../spriteForge`.
 *
 * Ficam aqui, e não lá, pela mesma razão que a paleta fica aqui: o forge é
 * agnóstico de personagem e não pode ganhar um `if (slime)`.
 *
 * ESTADO DE CONSUMO, para não haver ilusão (§11.4 pede o atraso da antena e ele
 * merece a verdade):
 *
 * | número                        | consumidor hoje                            |
 * |-------------------------------|--------------------------------------------|
 * | `golpeRx` / `golpeRy`         | SIM — via `ARCO_GOLPE_SLIME` → `opts.arcoGolpe` |
 * | `saltoU`                      | INDIRETO — `QUIQUE_U` (1,6u) do forge já sobe o modelo inteiro nos quadros pares |
 * | `atrasoAntena`                | INDIRETO — ver a medição abaixo            |
 * | `respiroAchata`/`respiroAlarga` | NÃO — não existe canal de ESCALA em `Pose` |
 *
 * O que falta, e por quê: `Pose` (§4.1 do PERSONAGEM.md) só tem `rx`/`ry`/`rz`.
 * A pulsação de §11.4 ("achata 8% e alarga 6%") é uma DEFORMAÇÃO, e deformar
 * exige um canal de escala por nó que hoje não existe nem no rig nem no forge.
 * Inventá-lo aqui seria escrever animação dentro do personagem; os números
 * ficam declarados e medidos, esperando a fase da animação abrir o canal — o
 * mesmo tratamento que `ANIMACAO_GOBLIN` deu ao balanço das orelhas.
 *
 * O QUE A RODADA 2 CONSERTOU SEM ESSE CANAL, porque era o defeito de verdade.
 * Medida a bbox do corpo nos quadros animados, a largura é CONSTANTE — a
 * pulsação não existe, e continua não existindo. Mas o que o revisor viu na
 * tela não foi "falta pulsar": foi o slime LEVITAR no repouso. O estado
 * `parado` do forge levanta o modelo inteiro em `RESPIRO_U` (0,8u = 2px de
 * arte) no quadro 1, e com a saia afundando só 0,2u ela DESCOLAVA do losango —
 * num bicho cuja identidade S6 é "assenta no chão, sem pernas", flutuar é o
 * oposto do pedido. A cura não precisava de canal nenhum: `afundar` foi de 0,2
 * para 1,0u (ver `PROPORCOES_SLIME.afundar`) e a saia cresceu de 1,0 para 1,8u
 * de altura, então a poça continua 0,2u DENTRO do piso mesmo no quadro
 * levantado, mostrando a mesma quantidade de gosma acima do chão.
 *
 * Fica a dívida da pulsação, agora sozinha e nomeada: ela exige `sx`/`sy`/`sz`
 * em `Pose` e um canal em `OpcoesForja` para o personagem declarar a
 * deformação sem que o forge ganhe um `if (slime)`. É mudança em módulo
 * COMPARTILHADO (`../model3d` e `../spriteForge`), ou seja mexe no Guerreiro e
 * no Goblin junto, e por isso ela é fase de animação e não ajuste de escultura.
 *
 * O ATRASO DA ANTENA, que a §11.4 manda não cortar, SAI DE GRAÇA e isto é
 * medição, não esperança. O nó da antena é montado com o nome `bracoDir` (ver
 * `NOS_SLIME`), então o ciclo genérico de caminhada o gira em
 * `−BALANCO · sen(fase)`, com fase amostrada em quadratura. Nos 4 quadros:
 *
 *   | quadro | salto (`alturaU`) | balanço somado | antena no nó |
 *   |--------|-------------------|----------------|--------------|
 *   | 0      | +1,6u (no ar)     |  −5,8°         | −17,8°       |
 *   | 1      | 0    (assentado)  | −14,0°         | −26,0°       |
 *   | 2      | +1,6u (no ar)     |  +5,8°         |  −6,2°       |
 *   | 3      | 0    (assentado)  | +14,0°         |  +2,0°       |
 *
 * (a coluna da direita é o ângulo final, com o repouso de −12° de
 * `ANGULOS_SLIME.antenaRepousoRx` — medido em `poseDoQuadro`.)
 *
 * ou seja o corpo sobe nos quadros 0 e 2 e a antena só chega ao extremo nos
 * quadros 1 e 3 — UM QUADRO DEPOIS. É exatamente o "a antena atrasa meio
 * quadro" da §11.4, e é o que faz a gelatina parecer gelatina.
 *
 * AMPLITUDE, medida na tela e não no ângulo — porque foi aí que a rodada 1
 * falhou. O atraso existia e ninguém via: o percurso lateral do centroide da
 * bolinha em relação ao dos olhos, ao longo dos 4 quadros da direção 2, valia
 * ~4px de ARTE. Num bicho de ~21px de altura, a 1×, 4px é sub-perceptível — o
 * traço estava lá e não se via.
 *
 * Com o arco alto da rodada 2 o braço de alavanca do pivô até a bolinha subiu
 * de 2,83u para ~5,7u, e o MESMO ângulo passa a render mais percurso. Medido
 * agora, quadro a quadro (Δx bolinha − olhos, px de arte, direção 2):
 *
 *   | quadro | salto  | Δx     |
 *   |--------|--------|--------|
 *   | 0      | +1,6u  | 14,3   |
 *   | 1      |  0     | 14,0   |
 *   | 2      | +1,6u  | 19,2   |
 *   | 3      |  0     | 20,3   |
 *
 * — 6,2px de percurso contra os ~4 de antes (+55%), com o extremo ainda caindo
 * um quadro depois do ápice do corpo. Ainda abaixo dos 8px que a revisão pediu
 * como alvo, e o que falta para lá NÃO é geometria: é um multiplicador de
 * balanço por personagem em `OpcoesForja`, canal que hoje não existe e que,
 * como o de escala, mora em módulo compartilhado.
 *
 * Nada disto toca o estado do engine. A fase da animação vive na camada de
 * render (R54).
 */
export const ANIMACAO_SLIME = {
  /** §11.4 `parado`: achatamento da respiração gelatinosa. SEM CONSUMIDOR. */
  respiroAchata: 0.08,
  /** §11.4 `parado`: alargamento correspondente. SEM CONSUMIDOR. */
  respiroAlarga: 0.06,
  /**
   * §11.4 `andando`: altura do salto, em `u`. O forge sobe 1,6u nos quadros
   * pares (`QUIQUE_U`), 0,1u acima do pedido — e em `u`, não em pixels, então
   * não é preciso reajustar se a escala mudar.
   */
  saltoU: 1.5,
  /** §11.4 `andando`: atraso da antena, em quadros. Ver a tabela acima. */
  atrasoAntena: 0.5,

  /**
   * §11.4 `atacando` — o BOTE, quadro a quadro, em graus, no nó da antena
   * (`bracoDir`). Somado ao repouso pelo forge, na mesma convenção de sinal dos
   * arcos genéricos de `../spriteForge` (o canal `ry` é multiplicado por
   * `ESPELHO` na aplicação; o canal `rx` não).
   *
   * O arco genérico não serve aqui pela mesma razão que não servia no Goblin, e
   * por uma a mais. A razão comum: o apêndice deste rig se estende para +Z a
   * partir do pivô, então o sinal de `rx` se inverte — positivo RECOLHE a
   * bolinha para trás, negativo a projeta para a frente. A razão a mais: o
   * genérico foi calibrado para um braço de 4u que carrega uma arma de 8u; aqui
   * o braço é uma haste de 2,83u do pivô à bolinha, e a amplitude precisa ser
   * maior para o mesmo percurso de tela.
   *
   * O arco daqui, com o ângulo que sobra no nó (o repouso de −12° somado, e o
   * `ry` já multiplicado por `ESPELHO`) e a posição da BOLINHA medida no rig:
   *
   *   | quadro     | rx  | ry  | no nó       | bolinha (x · y · z)   |
   *   |------------|-----|-----|-------------|-----------------------|
   *   | 0 recolher | +20 | −16 | +8° / +16°  | 3,29 · −0,37 · 7,65   |
   *   | 1 bote     | −46 | +40 | −58° / −40° | 0,84 ·  1,54 · 8,14   |
   *   | 2 assentar | −16 | +12 | −28° / −12° | 2,42 ·  0,72 · 8,48   |
   *
   * A isca recua para a direita e para trás, cruza por cima da coroa e chega à
   * frente-esquerda, e depois volta um terço do caminho — a sobra de inércia
   * que faz gelatina parecer gelatina. Ela nunca desce abaixo de z 7,6, ou seja
   * jamais atravessa o domo (que fecha em 6,4).
   *
   * O quadro de IMPACTO é o **1** — é com ele que o `IsoRenderer` sincroniza o
   * clarão de dano —, e é lá que o corpo está no ponto mais baixo
   * (`ALTURA_GOLPE` do forge vale −0,8u) e mais inclinado para a frente
   * (`INCLINA_GOLPE` vale +7°). Corpo que afunda e isca que chicoteia no mesmo
   * quadro: é o bote da §11.4.
   *
   * O `ry` NÃO é enfeite, e o SINAL dele é medição e não gosto. Percurso da
   * bolinha do quadro 0 ao 1, em px de arte, nas 8 direções, com o MESMO `rx`:
   *
   *   | `ry`                  | 0   1   2    3   4   5    6    7  | pior | média |
   *   |-----------------------|-----------------------------------|------|-------|
   *   | ausente               | 5,0 4,4 5,3  5,3 3,2 1,1  4,1 5,6 | 1,1  |  4,2  |
   *   | em fase   (+16 / −40) | 5,7 7,7 8,3  8,2 8,2 7,3  4,9 3,4 | 3,4  |  6,7  |
   *   | contrafase (−16 / +40)| 4,4 8,9 11,0 8,7 6,8 9,8 10,9 7,4 | 4,4  |  8,5  |
   *
   * Sem lateral nenhum o golpe some na direção 5 (1,1px — dois pixels de tela em
   * três quadros não é golpe). Com o lateral em FASE com o chicote ele melhora
   * na média e continua fraco nas pontas, porque nas direções em que o mergulho
   * em Z é cancelado pelo termo `(x + y)/2` da projeção (§4.2) as duas
   * componentes se anulam juntas. Em CONTRAFASE elas nunca zeram ao mesmo tempo:
   * o pior caso dobra e a média também. É a mesma causa raiz de `LATERAL` em
   * `../spriteForge`, com a diferença de que aqui ela decidiu um SINAL, não só
   * uma amplitude.
   */
  golpeRx: [20, -46, -16],
  golpeRy: [-16, 40, 12]
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
 * O arco do bote de §11.4 em RADIANOS, no formato que `forjarAtlas` aceita em
 * `opts.arcoGolpe` (`../spriteForge`).
 *
 * É a única peça de `ANIMACAO_SLIME` com consumidor direto. Existe como export
 * próprio, e não como campo de `ANIMACAO_SLIME`, porque as duas unidades são
 * diferentes: lá os números são AUTORAIS e estão em graus, como todo ângulo
 * deste arquivo; aqui já estão na unidade do rig.
 */
export const ARCO_GOLPE_SLIME: { rx: readonly number[]; ry: readonly number[] } = {
  rx: ANIMACAO_SLIME.golpeRx.map(grausParaRad),
  ry: ANIMACAO_SLIME.golpeRy.map(grausParaRad)
};

/**
 * Monta uma caixa a partir da notação da tabela da §11.3:
 * `peca(cor, [sx, sy, sz], [cx, cy, cz])`. O centro é opcional (padrão: no pivô
 * do nó) e o contorno de silhueta fica ligado.
 */
function peca(cor: CorSlime, dim: Vec3, centro?: Vec3): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro ?? [0, 0, 0];
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Igual a `peca`, mas SEM contorno próprio (§4.5 do PERSONAGEM.md). É o PADRÃO
 * deste rig: só duas peças traçam contorno.
 *
 * A regra vem medida do Guerreiro e do Goblin: o contorno tem 1px de ARTE e é
 * traçado nas duas bordas da peça, então numa peça de 2u de travessia (5px de
 * arte) ele come 2 e sobra 3. Aqui o problema é ainda mais agudo porque o corpo
 * é um DOMO — camadas empilhadas que se tocam de propósito. Contornar cada
 * camada desenharia cinco linhas pretas horizontais atravessando a gota, e a
 * curva de S1, que existe justamente por causa do degrau entre camadas, viraria
 * um bolo de casamento.
 *
 * As duas exceções são as que a referência mostra em traço:
 *   - `saia`, cuja aresta de baixo é a linha escura onde a gosma encontra o
 *     piso (ela cola o bicho no losango, como a sombra elíptica);
 *   - `topo`, cuja aresta de baixo separa o miolo claro do corpo escuro — é a
 *     mesma separação que a referência desenha entre a casca e o núcleo.
 *
 * A silhueta EXTERNA continua fechada porque quem a desenha é a máscara de
 * alpha do sprite forge (§2.1 de `../spriteForge`), não isto aqui.
 */
function detalhe(cor: CorSlime, dim: Vec3, centro?: Vec3): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/* ------------------------------------------------------------------ *
 * 5. Nomes dos nós — chaves estáveis de `Pose`
 * ------------------------------------------------------------------ */

/**
 * Os nomes são contrato entre o rig, as poses e a animação (§11.4).
 *
 * AQUI MORA A ÚNICA ESPERTEZA DESTE ARQUIVO, e ela precisa ser lida antes de
 * qualquer manutenção. A §11.3 nomeia dois nós, `corpo` e `antena`. O ciclo
 * genérico de `../spriteForge` procura SETE nomes fixos (`NOS_HUMANOIDE`:
 * quadril, torso, cabeça, braços, pernas) e um nome que ele não conhece é
 * SILENCIOSO — o nó simplesmente não gira. Um slime com os nomes da §11.3 e
 * nada mais sairia do forge como uma ESTÁTUA: os 9 quadros do atlas seriam o
 * mesmo desenho deslocado em Z, sem pulsação, sem chicote, sem §11.4.
 *
 * As três saídas possíveis eram: (a) ensinar o forge quem é o slime — proibido,
 * ele é agnóstico por contrato; (b) aceitar a estátua e declarar o débito; (c)
 * pendurar as duas peças da §11.3 em nós-ADAPTADORES que carregam os nomes que
 * o ciclo procura. Esta é a (c), e ela é honesta desde que fique escrita:
 *
 *   `torso`    é o nó do CORPO   — recebe respiração, inclinação e torção do
 *              ciclo, e o bote de `atacando`. Pivô no chão (0,0,0), de modo que
 *              toda rotação gira a gota em torno do ponto em que ela toca o
 *              piso: uma poça inclina sem descolar do losango.
 *   `bracoDir` é o nó da ANTENA  — recebe o balanço de ±14° da caminhada (que
 *              é o atraso de §11.4, ver `ANIMACAO_SLIME`) e é o ÚNICO nó a que
 *              o forge deixa o personagem declarar um arco próprio
 *              (`opts.arcoGolpe`). Sem esta escolha o chicote do bote não teria
 *              onde entrar.
 *
 * `corpo` e `antena` continuam existindo, com os nomes e os pivôs da §11.3,
 * como filhos dos adaptadores: é neles que as caixas moram, e é por eles que
 * uma pose futura endereça as peças sem passar pela animação genérica. Os
 * adaptadores não têm caixa nenhuma — custam uma matriz cada.
 *
 * Nós de `NOS_HUMANOIDE` que NÃO existem aqui (quadril, cabeça, bracoEsq, as
 * duas pernas) são inofensivos: o forge escreve a rotação deles na `Pose` e
 * `achatarRig` não acha o nó. É o mesmo silêncio de sempre, só que desta vez
 * ele está do nosso lado.
 */
export const NOS_SLIME = {
  raiz: 'raiz',
  /** Adaptador do corpo — o nome que o ciclo genérico do forge procura. */
  corpoAnimado: 'torso',
  /** O `corpo` da §11.3: o domo, o rosto e o especular. */
  corpo: 'corpo',
  /** Adaptador da antena — o nó a que `opts.arcoGolpe` é aplicado. */
  antenaAnimada: 'bracoDir',
  /** A `antena` da §11.3: haste e bolinha. */
  antena: 'antena'
} as const;

export type NomeNoSlime = (typeof NOS_SLIME)[keyof typeof NOS_SLIME];

/* ------------------------------------------------------------------ *
 * 6. O blockout (§11.3)
 *
 * CHIRALIDADE — o rig é autorado ESPELHADO em X, como os do Guerreiro e do
 * Goblin (§6.1 de `./warrior`). No Slime isso só importa para dois traços,
 * porque o domo é simétrico:
 *   - a ANTENA nasce em +X e curva para +X, e a referência mostra a bolinha à
 *     direita da gota;
 *   - o ESPECULAR nasce em +X/+Y, e o porquê é uma medição — ver `criarCorpo`.
 * ------------------------------------------------------------------ */

const P = PROPORCOES_SLIME;

/**
 * corpo — o domo (S1), o rosto (S4) e o especular (S3).
 *
 * O DOMO É UMA ESCADA, e o PERFIL dela é o que decide se a escada lê como curva
 * ou como arquitetura. A rodada 1 errou exatamente aqui, e o erro tem nome
 * geométrico: com larguras 11,4 · 10,0 · 8,4 · 6,8 · 4,4 · 2,2 o recuo por lado
 * ficava quase CONSTANTE (0,7 · 0,8 · 0,8 · 1,2 · 1,1) enquanto as alturas
 * ficavam em 1,4..1,8u. Recuo constante com degrau alto é a definição de CONE:
 * o bicho saía um zigurate de lados retos — "bolo de casamento verde" —, e um
 * terraço regular visto de cima em isométrica é a assinatura gráfica de
 * TERRENO, não de criatura. A aposta de então ("uma escada com passo de 2px lê
 * como curva, é o truque do escudo do Guerreiro") era verdadeira e insuficiente:
 * no escudo a escada é RASA, e aqui ela era íngreme — um degrau 2,5× mais alto
 * do que fundo lê como parede com sacada.
 *
 * RODADA 2 — o perfil é invertido: recuo CRESCENTE para cima, altura
 * DECRESCENTE. Sete camadas, do chão à coroa:
 *
 *   | camada | largura | altura | recuo por lado |
 *   |--------|---------|--------|----------------|
 *   | saia   |  11,4   |  1,8   |  —             |
 *   | base   |  11,0   |  1,3   |  0,20          |
 *   | meio   |  10,2   |  1,4   |  0,40          |
 *   | alto   |   8,6   |  1,3   |  0,80          |
 *   | topo   |   6,2   |  1,0   |  1,20          |
 *   | cume   |   3,8   |  0,7   |  1,20          |
 *   | coroa  |   1,9   |  0,5   |  0,95          |
 *
 * As duas camadas de baixo quase não recuam e leem juntas como uma PAREDE de
 * gosma — a "saia" da referência —, o meio começa a curvar e o alto fecha
 * depressa. A `coroa` existe só para tirar o bico do cume: sem ela a última
 * transição é de 3,8 para nada e a gota termina em ponta.
 *
 * Desvios da §11.3, e o motivo de cada um:
 *
 * a. A SAIA não está na §11.3. Ela existe por três razões que se somam: (1) é a
 *    camada em `gosmaSombra`, sem a qual `gosmaSombra` e `gosmaFundo` nunca
 *    apareceriam no sprite e os "4 tons" de S2 seriam três; (2) a referência
 *    mostra uma casca verde-escura envolvendo a base da gota, mais larga que o
 *    miolo claro; (3) é ela que entrega os 11u de largura da §11.3 — o blockout
 *    de lá fechava em 10,4. Ela afunda 1,0u no piso (ver
 *    `PROPORCOES_SLIME.afundar`), que é o que cumpre S6 e o que impede o slime
 *    de levitar no quadro de respiração.
 * b. Ela é também a ÚNICA peça do corpo que traça contorno próprio. Na rodada 1
 *    `topo` também traçava, e isso desenhava um retângulo preto FECHADO
 *    flutuando sobre o monte nas direções 1/3/5/7 — o bicho lia como um baú de
 *    tesouro com tampa e uma gema amarela em cima. Foi o defeito mais barato do
 *    lote (uma palavra) e o de maior retorno. A silhueta EXTERNA continua
 *    fechada porque quem a desenha é a máscara de alpha do sprite forge.
 * c. O ESPECULAR mudou de lado, e este é o desvio que mais precisa de defesa.
 *    A §11.3 o põe em `cx −1.8, cy −1.4` — atrás e à esquerda —, lendo "topo-
 *    esquerdo" da referência como uma posição no CORPO. Mas o brilho especular
 *    da referência não é uma mancha pintada no bicho: é onde a luz da cena bate.
 *    Neste pipeline a luz e o observador estão em `DIR_VISAO = (1,1,1)`
 *    (§4.3 do PERSONAGEM.md), então o alto molhado da gota fica em +X/+Y/+Z; em
 *    `cx −1.8, cy −1.4` a peça nasce ENTERRADA dentro da camada vizinha.
 *
 *    O que a rodada 1 errou foi a FORMA, não o lugar: um bloco de 1,9 × 1,5 ×
 *    1,0 no meio da face de topo lia como mais um patamar do zigurate, e media
 *    1,4 e 4,2 px² nas direções 4 e 5 — sumia. Agora ele é uma PLACA fina cujo
 *    topo fica 0,05u ACIMA do teto do `cume`. Numa projeção isométrica de câmera
 *    fixa a face +Z é a única visível nas 8 direções, então a placa lê em todas
 *    — inclusive de costas, que é o que "molhado" exige (brilho não gira com o
 *    bicho). Ela ficou ACIMA da linha dos olhos de propósito: no rosto do slime
 *    já há três manchas âmbar, e um quarto blob do mesmo tamanho entre elas
 *    tirava a hierarquia do olho. O critério é o Guerreiro — lá o acento claro
 *    do peito não disputa com o visor.
 * d. A BOCA subiu para `cz 3.6` e engordou para 0,7u de altura: 0,5u = 1,25px
 *    de arte e a boca sumiria. O `z` é estrutural — ver a COSTURA logo abaixo.
 * e. Os OLHOS são DUAS CAIXAS CRUZADAS cada um, como a §11.3 manda, mais uma
 *    TERCEIRA que a §11.3 não pede e sem a qual S4 não existe na tela. Ver o
 *    bloco do RECESSO.
 *
 * O RECESSO — por que a cruz precisa de um fundo escuro.
 *
 * Na rodada 1 os dois olhos liam como BOLOTAS redondas, não como `+`: as barras
 * tinham 0,9u (2,25px) de bitola contra 2,1u de envelope, ou seja 43% do vão, e
 * uma cruz cujo braço ocupa quase metade do vão fecha em octógono na
 * quantização. Pior: a bolinha da antena tem a MESMA cor, o MESMO brilho pleno
 * emissivo e tamanho comparável, então o rosto lia como TRÊS moedas âmbar
 * espalhadas — o jogador não distinguia olho de isca e a criatura parecia ter
 * três olhos.
 *
 * A cura não é engordar nem afinar o âmbar: é dar a ele um FUNDO. É o
 * dispositivo que o Goblin já usa e que dá coerência de estilo ao elenco — lá a
 * brasa vermelha assenta numa reentrância escura, e é o contraste com o escuro
 * que desenha a forma do olho. Aqui cada olho ganha uma caixa `vazio` de
 * 3,4 × 3,3u atrás do âmbar; a cruz de 2,8 × 2,6u com 1,05u de bitola deixa
 * quatro cantos escuros de ~1,2 × 1,1u (3 × 2,8px de arte) em volta. São esses
 * quatro cantos que desenham o `+`, e eles não dependem de a barra sobreviver à
 * quantização.
 *
 * A COSTURA — a armadilha estrutural deste monstro, e a lição que o próximo rig
 * de corpo simétrico vai precisar.
 *
 * Sem z-buffer, quem decide o que fica na frente é a ordem do pintor (§4.4):
 * `profundidade = x + y + z` do CENTRO de cada face, do menor para o maior. Num
 * domo simétrico a face frontal de uma camada tem centro em `x = 0`, e um
 * detalhe montado sobre ela em `x = −2,0` (o olho da esquerda) começa 2,0 de
 * profundidade ATRÁS dela: o olho é desenhado ANTES e a própria camada o apaga.
 * Não é acabamento — no quadro de frente o slime ficava CAOLHO.
 *
 * A cura é PARTIR a camada em duas caixas com a costura deslocada em X:
 * `alto.esq` cobre −4,3..0,4 e a face frontal dela cai ABAIXO, em profundidade,
 * do olho da esquerda, que passa a ser desenhado por cima. As duas metades são
 * COPLANARES e da MESMA cor: a costura não aparece — não há aresta de silhueta
 * entre elas (a face interna de uma fica dentro do volume da outra) e a
 * quantização dá o mesmo tom aos dois lados. É um dispositivo de ORDEM, não de
 * forma.
 *
 * Nesta rodada `meio` DEIXOU de precisar da costura dele: o rosto subiu para a
 * camada `alto` e ganhou 1,3u de altura sobre `meio`, e na profundidade
 * `x + y + z` essa altura sozinha já basta para os dois olhos ficarem à frente
 * das duas metades de `meio`. Uma costura a menos, uma caixa a menos.
 */
/**
 * Uma CAMADA do domo, montada como um par de caixas CRUZADAS.
 *
 * É o mesmo dispositivo com que o escudo do Guerreiro vira disco (§8 do
 * PERSONAGEM.md: "aro … cruzado, chanfra o círculo"), aplicado aqui ao problema
 * que a rodada 1 não tinha resolvido: uma caixa sozinha tem planta RETANGULAR, e
 * um retângulo projetado em isométrica dá quatro quinas DURAS de 90°. Empilhar
 * seis retângulos dá um zigurate por construção, por melhor que seja o perfil.
 *
 * O par é `sx × (sy − 2c)` e `(sx − 2c) × sy` no mesmo centro: a união é o
 * retângulo `sx × sy` MENOS quatro cantos de `c × c`, ou seja um octógono. Com
 * `c` entre 1,2 e 1,6u o canto cortado vale 3 a 4px de arte em `artX` — o
 * bastante para a quina de 90° virar chanfro e a planta ler como redonda.
 *
 * `costura` parte as duas caixas em X (ver o bloco da COSTURA acima); ausente,
 * a camada sai inteira.
 */
function camada(
  cor: CorSlime,
  sx: number,
  sy: number,
  sz: number,
  cz: number,
  chanfro: number,
  costura?: number
): Caixa[] {
  const pares: [number, number][] = [
    [sx, sy - 2 * chanfro],
    [sx - 2 * chanfro, sy]
  ];
  const saida: Caixa[] = [];
  for (const [larg, prof] of pares) {
    if (costura === undefined) {
      saida.push(detalhe(cor, [larg, prof, sz], [0, 0, cz]));
      continue;
    }
    const meia = larg * 0.5;
    saida.push(detalhe(cor, [meia + costura, prof, sz], [(costura - meia) * 0.5, 0, cz]));
    saida.push(detalhe(cor, [meia - costura, prof, sz], [(costura + meia) * 0.5, 0, cz]));
  }
  return saida;
}

function criarCorpo(): No {
  const c = P.costuraAlto;
  return {
    nome: NOS_SLIME.corpo,
    pivo: [0, 0, 0],
    caixas: [
      //  saia — a poça de contato com o piso (S6) e a largura de §11.3
      ...camada('gosmaSombra', P.largura, 9.6, 1.8, 0.9 - P.afundar, 1.6),
      //  base   — quase sem recuo: com a saia, a "parede" de gosma da referência
      ...camada('gosmaMeio', 11.0, 9.2, 1.3, 1.45, 1.6),
      //  meio   — aqui a curva começa
      ...camada('gosmaBase', 10.2, 8.5, 1.4, 2.8, 1.5),
      //  alto   — a camada do ROSTO, partida em `costuraAlto`
      ...camada('gosmaBase', 8.6, 7.1, 1.3, 4.15, 1.3, c),
      //  topo   — o arredondamento rápido do alto da gota
      ...camada('gosmaBase', 6.2, 5.1, 1.0, 5.3, 1.0),
      //  cume
      ...camada('gosmaLuz', 3.8, 3.1, 0.7, 6.15, 0.7),
      //  coroa  — tira o bico do cume; é o teto da MASSA (7,0u)
      detalhe('gosmaLuz', [1.9, 1.6, 0.5], [0, 0, 6.75]),
      //  boca pequena                                                   ← §11.1
      detalhe('vazio', [0.9, 0.8, 0.7], [0, P.yRosto, 3.6]),
      //  olho.esq: recesso escuro + barra vertical + barra horizontal   ← S4
      detalhe('vazio', [3.4, 0.6, 3.3], [-P.xOlho, P.yRosto - 0.25, 4.5]),
      detalhe('luzAmbar', [1.05, 0.7, 2.6], [-P.xOlho, P.yRosto, 4.5]),
      detalhe('luzAmbar', [2.8, 0.7, 1.05], [-P.xOlho, P.yRosto, 4.5]),
      //  olho.dir                                                       ← S4
      detalhe('vazio', [3.4, 0.6, 3.3], [P.xOlho, P.yRosto - 0.25, 4.5]),
      detalhe('luzAmbar', [1.05, 0.7, 2.6], [P.xOlho, P.yRosto, 4.5]),
      detalhe('luzAmbar', [2.8, 0.7, 1.05], [P.xOlho, P.yRosto, 4.5]),
      //  especular — PLACA com o topo exposto, acima da linha dos olhos  ← S3
      detalhe('brilho', [2.6, 2.0, 0.45], [1.2, 1.2, 6.32])
    ]
  };
}

/**
 * antena — a haste e a bolinha luminosa (S5). É a leitura à distância do bicho e
 * o que denuncia a direção quando o rosto está de costas (§11.5).
 *
 * O QUE A RODADA 1 ERROU, porque é a lição mais cara deste arquivo: ela mediu a
 * ÁREA VISÍVEL da bolinha nas 8 direções (47,8 a 74,3 px², nunca zero) e
 * concluiu que S5 estava entregue. Área não é legibilidade. Com a bolinha
 * centrada em z 8,3 e a coroa em 6,4, a borda de baixo dela ficava 0,9u (2,25px)
 * acima do corpo — e depois da projeção as duas MÁSCARAS encostavam. Sem um
 * único pixel de fundo entre as duas, a bolinha vira um caroço do domo, não uma
 * isca pendurada: ela tem 74 px² de área e contribuição ZERO para a silhueta.
 * Some a isso uma haste em `antena` (#14201a) contra um piso #0d1117 — dois
 * quase-pretos — e o traço que a §11.1 chama de insubstituível simplesmente não
 * estava na tela.
 *
 * A medição que detecta isto NÃO é área por direção: é (a) a CONTRIBUIÇÃO DE
 * MÁSCARA (quantos pixels da silhueta somem quando a peça é removida) e (b) o
 * FUNDO LIVRE entre a peça e o resto do corpo. Fica registrado para o próximo
 * rig: um rig que só mede área não enxerga fusão de silhueta.
 *
 * RODADA 2 — três mudanças, nesta ordem de importância:
 *
 * 1. O ARCO SUBIU. A haste tem cinco trechos escalonados que sobem do cume,
 *    tombam para +X e DESCEM — o percurso da isca de tamboril, que a referência
 *    mostra e que a rodada 1 tinha achatado. O ápice fica em z ~10,3 (3,3u acima
 *    da coroa) e a bolinha desce dele para z ~8,4, ao lado do corpo e não em
 *    cima dele. Com o arco alto sobra AR entre a bolinha e o domo nas 8
 *    direções — ver a tabela abaixo.
 * 2. A COR DA HASTE mudou de `antena` para `gosmaFundo` no trecho que voa. O
 *    raciocínio antigo (haste quase-preta é segura porque vive sobre o verde
 *    claro do corpo) deixa de valer no instante em que a haste sai para o ar.
 *    Só a RAIZ — o trecho enterrado na coroa — continua em `antena`, onde o
 *    quase-preto é justamente o que precisa ser.
 * 3. A BITOLA subiu para 1,2–1,4u. Não é gosto, é o passe de contorno por
 *    máscara: ele pinta de `contorno` todo pixel opaco que faz borda com o
 *    vazio, e numa haste de 2px de largura ISSO É A HASTE INTEIRA. Com 1,3u
 *    (3,25px) sobra um miolo aceso de ~1px por linha, que é o mínimo para a
 *    haste existir como linha verde em vez de como fio preto sobre preto.
 *
 * A BOLINHA continua com 2,0u de envelope (5px de arte) pela medição da rodada
 * 1, que continua válida: ela é uma ilha, todo o anel externo dela vira
 * `contorno`, e de 3×3px sobraria UM pixel âmbar. Com 5px o anel come a borda e
 * sobra um miolo de 3×3 — nove pixels acesos, que é o que a faz BRILHAR no
 * escuro em vez de piscar. O que mudou foi a FORMA: o cubo de 2,0u rasterizava
 * como um quadrado de quinas retas nas direções axiais (um tijolo âmbar, não
 * uma bolinha), então ele virou a UNIÃO de um núcleo de 1,6u com duas placas
 * cruzadas de 2,2 × 1,2 — um octógono com o mesmo diâmetro máximo e o mesmo
 * miolo de 3×3.
 *
 * O arco também deixou de ser PLANO. Com todos os trechos em `y = 0` ele vive
 * num plano vertical, e nas direções em que esse plano fica de perfil o arco
 * inteiro colapsa numa linha reta — a antena virava um espeto. Cada trecho
 * agora avança um pouco em +Y à medida que sobe (0,25 → 0,6 → 0,95 → 1,15 →
 * 1,8 na bolinha), de modo que a curva é uma hélice curta e nenhuma direção a
 * achata por completo. O avanço em Y tem um segundo efeito, e ele é o que põe a
 * bolinha NA FRENTE do último trecho da haste em vez de atrás: na profundidade
 * `x + y + z` da ordem do pintor, 0,65u a mais de `y` valem 0,65 a mais de
 * profundidade.
 *
 * MEDIDO no rig montado, nas 8 direções (rasterização em px de arte com a
 * ordem do pintor e o passe de contorno por máscara, pose de repouso):
 *
 *   | dir                          |  0   1   2   3   4   5   6   7 |
 *   |------------------------------|--------------------------------|
 *   | contribuição de máscara da haste (px) | 22  16   8   9  20  18  24  24 |
 *   | contribuição de máscara da bolinha    |  4  11   1   2  10  16   9   5 |
 *   | fundo LIVRE bolinha ↔ domo (px)       |  7   1   0   0   1   4   6   8 |
 *
 * A haste quebra a silhueta em TODAS as 8 (8 a 24px de máscara que só existem
 * por causa dela), que é o que a rodada 1 não tinha em nenhuma.
 *
 * O FUNDO LIVRE FECHA EM 0 NAS DIREÇÕES 2 E 3, e a causa é a projeção, não a
 * altura — o que importa registrar porque a direção 2 é a de repouso do jogo e
 * a que a bancada usa em todos os painéis de animação. Em `artY = (x + y)/2 − z`
 * um apêndice deslocado em +X e +Y DESCE na tela tanto quanto a altura o sobe:
 * com a bolinha em (5,1 · 1,8 · 9,8) ela projeta em `artY −17,1`, enquanto o
 * canto de trás da coroa, a 7,0u do chão, projeta em −18,5 — ou seja o topo do
 * domo está ACIMA da bolinha na tela mesmo com 2,8u a menos de altura real.
 * Para vencer isso por altura seriam precisos ~2,2u a mais de arco, o que faria
 * a antena valer metade da silhueta do bicho.
 *
 * Varrido o caminho alternativo, e ele fica registrado para a rodada 3: inclinar
 * o arco para TRÁS (offsets em −Y e `antenaRepousoRx` positivo) melhora 1, 5 e 7
 * e piora 4, com soma de fundo livre 34 contra 27 — ganho real, mas pequeno, e
 * ao custo de a isca deixar de pender para a frente, que é como a referência a
 * mostra e o que `ANGULOS_SLIME.antenaRepousoRx` defende. Não vale a troca sem
 * o dono olhar.
 *
 * Nas duas direções em que o fundo fecha, quem separa a bolinha do corpo é o
 * CONTORNO (a máscara pinta a borda dela de `contorno`) e o arco escuro de 8 a
 * 20px continua legível ligando as duas — a leitura é "isca pendurada", não
 * "caroço", que era o defeito da rodada 1.
 */
function criarAntena(): No {
  return {
    nome: NOS_SLIME.antena,
    pivo: [0, 0, 0],
    caixas: [
      //  raiz — enterrada na coroa; é o único trecho que ainda é quase-preto
      detalhe('antena', [1.35, 1.35, 2.0], [0, 0, 0.8]),
      //  subida
      detalhe('gosmaFundo', [1.25, 1.25, 1.9], [0.35, 0.25, 2.75]),
      //  ombro do arco
      detalhe('gosmaFundo', [1.2, 1.2, 1.4], [1.15, 0.6, 4.35]),
      //  alto do arco, já tombando para +X
      detalhe('gosmaFundo', [1.15, 1.15, 1.1], [2.3, 0.95, 5.05]),
      //  descida até a isca
      detalhe('gosmaFundo', [1.1, 1.1, 1.2], [3.5, 1.15, 4.75]),
      //  bolha — núcleo + duas placas cruzadas = octógono                ← S5
      detalhe('luzAmbar', [1.6, 1.6, 1.6], [4.5, 1.8, 3.95]),
      detalhe('luzAmbar', [2.2, 1.2, 1.2], [4.5, 1.8, 3.95]),
      detalhe('luzAmbar', [1.2, 1.2, 2.2], [4.5, 1.8, 3.95])
    ]
  };
}

/**
 * Monta uma árvore NOVA do Slime. Chame isto (e não mute `MODELO_SLIME`) sempre
 * que precisar de um rig próprio — variantes, testes, previews.
 *
 * A hierarquia é a da §11.3 (`corpo` e `antena` pendurados na raiz), com os dois
 * nós-adaptadores no meio do caminho — leia `NOS_SLIME` antes de mexer aqui. A
 * antena é filha do adaptador do CORPO, e não irmã dele: quando a gota inclina,
 * a isca inclina junto e depois soma o próprio atraso por cima. Uma antena
 * pendurada na raiz ficaria de pé enquanto o corpo tomba, que é o defeito que
 * §11.4 chama de "a antena não acompanha".
 *
 * A ordem dos filhos importa só para desempate da ordem do pintor (§4.4): o
 * corpo antes da antena, que é o apêndice mais alto e sempre à frente na
 * profundidade.
 */
export function criarModeloSlime(): No {
  return {
    nome: NOS_SLIME.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [
      {
        nome: NOS_SLIME.corpoAnimado,
        pivo: [0, 0, 0],
        caixas: [],
        filhos: [
          criarCorpo(),
          {
            nome: NOS_SLIME.antenaAnimada,
            pivo: [P.xAntena, 0, P.zAntena],
            caixas: [],
            filhos: [criarAntena()]
          }
        ]
      }
    ]
  };
}

/** O rig canônico do Slime, pronto para o sprite forge (§7). Não mute. */
export const MODELO_SLIME: No = criarModeloSlime();

/* ------------------------------------------------------------------ *
 * 7. Pose de repouso (§11.4, estado `parado`)
 * ------------------------------------------------------------------ */

const A = ANGULOS_SLIME;

/**
 * A pose de referência: a gota assentada no losango e a antena pendendo um pouco
 * para a frente, como a isca de um tamboril (S5).
 *
 * É a base sobre a qual a animação de §11.4 SOMA respiração, salto e bote. Como
 * `poseDoQuadro` (`../spriteForge`) clona o repouso e soma por cima, a inclinação
 * da antena sobrevive aos 9 quadros e o balanço da caminhada oscila em torno
 * dela — ver a tabela de `ANIMACAO_SLIME`.
 *
 * O CORPO não aparece aqui, e é intencional: o domo é declarado já assentado, em
 * coordenadas absolutas, e a §11.3 não pede inclinação nenhuma no repouso. Um
 * ângulo aqui seria ângulo mágico escondido em tabela — o defeito que
 * `criarEspada` documenta em `./warrior`. O que o corpo recebe é só o que a
 * animação soma.
 *
 * Para quem integra com o sprite forge (§7): o lugar de passar isto é
 * `opts.repouso`, junto de `paleta`, `rampas`, `rampaDaCor`,
 * `arcoGolpe: ARCO_GOLPE_SLIME` e `emissivas: CORES_EMISSIVAS_SLIME`.
 */
export const POSE_PARADA_SLIME: Pose = {
  [NOS_SLIME.antenaAnimada]: {
    rx: grausParaRad(A.antenaRepousoRx)
  }
};

/* ------------------------------------------------------------------ *
 * 8. Morte do Slime (fase das cinemáticas de abate — docs/BESTIARIO.md §14)
 *
 * A técnica é a da morte do Guerreiro (§8 de `./warrior`) com um desvio
 * necessário: as poses de lá são REPUSOS de forja, e um repouso só ROTACIONA
 * nós — mas o slime não MORRE tombando, ele DERRETE, e derreter é deformar
 * geometria (achatar e alargar as camadas do domo). Então aqui a variante não
 * é de pose, é de MODELO: três rigs derivados de `criarModeloSlime()` pelo
 * mesmo molde de `criarModeloGuerreiroSemEspada` ("árvore nova a cada
 * chamada; quem precisa de variante monta a sua"), cada um forjado com
 * repouso NEUTRO e lido na coluna ('parado', 0). Nada aqui toca o engine
 * (R54): quem detecta o abate é o IsoRenderer, por observação.
 *
 * O RASTRO do slime é a GELEIA: o estágio 3 é uma poça achatada que persiste
 * no tile onde ele morreu, com a bolinha da antena afogada dentro — a âmbar
 * EMISSIVA continua acesa no escuro (§1.1), então o jogador encontra o ponto
 * luminoso na poça antes de ler a poça. É o contraste com o corpo do Goblin
 * e com a marreta do Ogro.
 * ------------------------------------------------------------------ */

/**
 * O corpo derretido: as mesmas camadas de `criarCorpo` achatadas por `f` (em
 * altura E em z — a pilha é contígua a partir da base afundada, então escalar
 * `cz` e `sz` pelo mesmo fator a mantém empilhada) e alargadas por `larg`.
 *
 * O ROSTO morre por afogamento, em três atos: `inteiro` (estágio 1 — olhos,
 * recessos e boca no lugar, descidos junto com a superfície), `afogando`
 * (estágio 2 — sobram só as barras âmbar, encolhidas e sem o recesso escuro;
 * boca e especular já submergiram) e `nenhum` (estágio 3 — a superfície não
 * tem mais traço nenhum: o rosto virou geleia).
 */
function criarCorpoDerretido(f: number, larg: number, rosto: 'inteiro' | 'afogando' | 'nenhum'): No {
  const caixas: Caixa[] = [
    //  o perfil de `criarCorpo`, camada a camada, achatado e alargado
    ...camada('gosmaSombra', P.largura * larg, 9.6 * larg, 1.8 * f, (0.9 - P.afundar) * f, 1.6 * larg),
    ...camada('gosmaMeio', 11.0 * larg, 9.2 * larg, 1.3 * f, 1.45 * f, 1.6 * larg),
    ...camada('gosmaBase', 10.2 * larg, 8.5 * larg, 1.4 * f, 2.8 * f, 1.5 * larg),
    ...camada('gosmaBase', 8.6 * larg, 7.1 * larg, 1.3 * f, 4.15 * f, 1.3 * larg, P.costuraAlto),
    ...camada('gosmaBase', 6.2 * larg, 5.1 * larg, 1.0 * f, 5.3 * f, 1.0 * larg),
    ...camada('gosmaLuz', 3.8 * larg, 3.1 * larg, 0.7 * f, 6.15 * f, 0.7 * larg),
    detalhe('gosmaLuz', [1.9 * larg, 1.6 * larg, 0.5 * f], [0, 0, 6.75 * f])
  ];
  if (rosto === 'inteiro') {
    caixas.push(
      detalhe('vazio', [0.9, 0.8, 0.7], [0, P.yRosto, 3.6 * f]),
      detalhe('vazio', [3.4, 0.6, 3.3], [-P.xOlho, P.yRosto - 0.25, 4.5 * f]),
      detalhe('luzAmbar', [1.05, 0.7, 2.6], [-P.xOlho, P.yRosto, 4.5 * f]),
      detalhe('luzAmbar', [2.8, 0.7, 1.05], [-P.xOlho, P.yRosto, 4.5 * f]),
      detalhe('vazio', [3.4, 0.6, 3.3], [P.xOlho, P.yRosto - 0.25, 4.5 * f]),
      detalhe('luzAmbar', [1.05, 0.7, 2.6], [P.xOlho, P.yRosto, 4.5 * f]),
      detalhe('luzAmbar', [2.8, 0.7, 1.05], [P.xOlho, P.yRosto, 4.5 * f]),
      detalhe('brilho', [2.6, 2.0, 0.45], [1.2, 1.2, 6.32 * f])
    );
  } else if (rosto === 'afogando') {
    //  Só o âmbar, encolhido e meio submerso — os olhos BOIANDO na geleia.
    caixas.push(
      detalhe('luzAmbar', [0.9, 0.7, 1.6], [-P.xOlho, P.yRosto - 0.4, 4.5 * f]),
      detalhe('luzAmbar', [1.8, 0.7, 0.9], [-P.xOlho, P.yRosto - 0.4, 4.5 * f]),
      detalhe('luzAmbar', [0.9, 0.7, 1.6], [P.xOlho, P.yRosto - 0.4, 4.5 * f]),
      detalhe('luzAmbar', [1.8, 0.7, 0.9], [P.xOlho, P.yRosto - 0.4, 4.5 * f])
    );
  }
  return { nome: NOS_SLIME.corpo, pivo: [0, 0, 0], caixas };
}

/**
 * A antena derretida. No estágio 1 o arco DESABA pela metade (`f` escala o z
 * de cada trecho e do próprio pivô); no estágio 2 ela está deitada sobre a
 * geleia (`f` mínimo: a haste toda achatada, esparramada para +X). A bolinha
 * acompanha — ela afoga por ÚLTIMO, é o adeus do bicho.
 */
function criarAntenaDerretida(f: number): No {
  const esparrame = 1 + (1 - f) * 0.8;
  return {
    nome: NOS_SLIME.antena,
    pivo: [0, 0, 0],
    caixas: [
      detalhe('antena', [1.35, 1.35, 2.0 * f], [0, 0, 0.8 * f]),
      detalhe('gosmaFundo', [1.25, 1.25, 1.9 * f], [0.35 * esparrame, 0.25, 2.75 * f]),
      detalhe('gosmaFundo', [1.2, 1.2, 1.4 * f], [1.15 * esparrame, 0.6, 4.35 * f]),
      detalhe('gosmaFundo', [1.15, 1.15, 1.1 * f], [2.3 * esparrame, 0.95, 5.05 * f]),
      detalhe('gosmaFundo', [1.1, 1.1, 1.2 * f], [3.5 * esparrame, 1.15, 4.75 * f]),
      detalhe('luzAmbar', [1.6, 1.6, 1.6 * f], [4.5 * esparrame, 1.8, 3.95 * f]),
      detalhe('luzAmbar', [2.2, 1.2, 1.2 * f], [4.5 * esparrame, 1.8, 3.95 * f]),
      detalhe('luzAmbar', [1.2, 1.2, 2.2 * f], [4.5 * esparrame, 1.8, 3.95 * f])
    ]
  };
}

/**
 * Monta o rig do estágio de derretimento. A hierarquia é a de
 * `criarModeloSlime()` (adaptadores `torso`/`bracoDir` inclusos, para o rig se
 * comportar igual sob o mesmo forge) — menos no estágio 3, em que o ramo da
 * antena não existe mais e a bolinha afogada vira caixa do corpo.
 *
 * Estágios: 1 = achatou (62% da altura, +15% de largura, rosto inteiro,
 * antena caída); 2 = desabou (34%, +32%, olhos boiando, antena deitada);
 * 3 = POÇA (16%, +50%, sem rosto nem antena — só a geleia e a bolinha
 * afogada). O estágio 3 é o rastro persistente do abate.
 */
export function criarModeloSlimeDerretido(estagio: 1 | 2 | 3): No {
  if (estagio === 3) {
    const corpo = criarCorpoDerretido(0.16, 1.5, 'nenhum');
    return {
      nome: NOS_SLIME.raiz,
      pivo: [0, 0, 0],
      caixas: [],
      filhos: [
        {
          nome: NOS_SLIME.corpoAnimado,
          pivo: [0, 0, 0],
          caixas: [],
          filhos: [
            {
              ...corpo,
              caixas: [
                ...corpo.caixas,
                //  a bolinha AFOGADA na geleia (S5 — ela afoga por último,
                //  e é ela que fica brilhando na poça como rastro)
                detalhe('luzAmbar', [1.3, 1.3, 0.9], [1.6, 1.2, 0.85]),
                detalhe('luzAmbar', [1.8, 0.9, 0.7], [1.6, 1.2, 0.85]),
                //  o brilho molhado não morre: uma película de especular na poça
                detalhe('brilho', [2.2, 1.7, 0.3], [-1.4, 0.8, 1.15])
              ]
            }
          ]
        }
      ]
    };
  }
  const f = estagio === 1 ? 0.62 : 0.34;
  const larg = estagio === 1 ? 1.15 : 1.32;
  return {
    nome: NOS_SLIME.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [
      {
        nome: NOS_SLIME.corpoAnimado,
        pivo: [0, 0, 0],
        caixas: [],
        filhos: [
          criarCorpoDerretido(f, larg, estagio === 1 ? 'inteiro' : 'afogando'),
          {
            nome: NOS_SLIME.antenaAnimada,
            pivo: [P.xAntena, 0, P.zAntena * f],
            caixas: [],
            filhos: [criarAntenaDerretida(estagio === 1 ? 0.55 : 0.15)]
          }
        ]
      }
    ]
  };
}

/** Os três estágios, no padrão de `MODELO_SLIME`: constantes de módulo, não mutar. */
export const MODELO_SLIME_DERRETIDO_1: No = criarModeloSlimeDerretido(1);
export const MODELO_SLIME_DERRETIDO_2: No = criarModeloSlimeDerretido(2);
export const MODELO_SLIME_DERRETIDO_3: No = criarModeloSlimeDerretido(3);
