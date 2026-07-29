/*
 * ISOROGUE — src/render/characters/warrior.ts
 *
 * O rig do Guerreiro: paleta canônica (§2 do docs/PERSONAGEM.md) e blockout
 * hierárquico de caixas (§8). Reconstrução POR CÓDIGO a partir de
 * docs/ref/guerreiro-referencia.png — nenhuma imagem, nenhum asset, nenhuma URL.
 *
 * O que este módulo é:
 *   - a fonte da verdade da FORMA do personagem (árvore de nós, pivôs, caixas);
 *   - a fonte da verdade da COR (PALETA_GUERREIRO, §2);
 *   - a pose de repouso de referência (POSE_PARADA) e os números que a revisão
 *     visual pode mexer sem tocar na estrutura (AJUSTES_GUERREIRO, ANGULOS_GUERREIRO).
 *
 * O que este módulo NÃO é: ele não projeta, não rasteriza, não anima e não
 * conhece Canvas. Isso é do `../model3d` (projeção/faces) e do `../spriteForge`
 * (atlas). Aqui só existe geometria declarativa e aritmética de graus→radianos.
 *
 * Invariantes:
 *   - Determinístico: zero `Math.random`, zero relógio, zero DOM.
 *   - `criarModeloGuerreiro()` devolve uma árvore NOVA a cada chamada — nenhum
 *     array é compartilhado entre instâncias (quem quiser deformar o rig em
 *     runtime não pode corromper o modelo dos outros).
 *   - Traços de identidade I1..I8 (§1) sobrevivem na silhueta. Perder a ombreira
 *     (I3), a espada erguida (I4) ou o escudo redondo (I5) descaracteriza o
 *     personagem — qualquer ajuste tem de ser revisado contra a referência (§10).
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta canônica (§2) — amostrada da referência
 * ------------------------------------------------------------------ */

/**
 * Paleta curta e saturada (I7): 4 tons de ouro, 1 de couro, 3 de aço, vazio e
 * contorno. É a paleta INTEIRA do personagem — o sombreamento de face (§4.3)
 * quantiza para estes tons em vez de gerar cor nova, e é isso que mantém a cara
 * de pixel art em vez de 3D com iluminação contínua. Não acrescente cor aqui
 * sem passar pelo gate G5.
 */
export const PALETA_GUERREIRO = {
  ouroLuz: '#f2d693', // topo de ombreira, brilho do elmo
  ouroBase: '#d9a441', // placas em geral
  ouroMeio: '#a8702c', // faces laterais
  ouroSombra: '#6d4418', // faces afastadas, vãos
  couro: '#6b4526', // correias, cabo da espada
  acoLuz: '#eef2f8', // fio da lâmina
  acoBase: '#c2ccda', // corpo da lâmina
  acoSombra: '#8b96a8', // face escura da lâmina
  vazio: '#241a12', // viseira, juntas, sombra interna
  contorno: '#191008' // outline
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorGuerreiro = keyof typeof PALETA_GUERREIRO;

/**
 * As rampas de quantização por material (§4.3): o fator de luz da face escolhe
 * um destes tons, do mais claro para o mais escuro. Exportado aqui porque a
 * rampa é propriedade do MATERIAL, e o material é propriedade do modelo.
 */
export const RAMPAS_GUERREIRO = {
  ouro: ['ouroLuz', 'ouroBase', 'ouroMeio', 'ouroSombra'],
  aco: ['acoLuz', 'acoBase', 'acoSombra', 'vazio'],
  couro: ['couro', 'couro', 'ouroSombra', 'vazio'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorGuerreiro[]>;

/** Rampa a que cada cor de peça pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR = {
  ouroLuz: 'ouro',
  ouroBase: 'ouro',
  ouroMeio: 'ouro',
  ouroSombra: 'ouro',
  couro: 'couro',
  acoLuz: 'aco',
  acoBase: 'aco',
  acoSombra: 'aco',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorGuerreiro, keyof typeof RAMPAS_GUERREIRO>;

/* ------------------------------------------------------------------ *
 * 2. Proporções (§3 e §8) — a estrutura, que NÃO se ajusta
 * ------------------------------------------------------------------ */

/**
 * Medidas em `u` (unidades do espaço local do modelo: +X direita, +Y frente,
 * +Z cima, origem no centro dos pés). Estes números vêm do blockout obrigatório
 * da §8 — mexer neles muda a proporção heroica de ~4 cabeças (I8) e reprova o
 * gate G1. O que a revisão visual ajusta é `AJUSTES_GUERREIRO`, não isto.
 */
export const PROPORCOES_GUERREIRO = {
  /** §3 ALTURA_MODELO: pés ao topo do elmo. A crista do blockout fecha em 18.0u. */
  altura: 18,
  /** §3 LARGURA_OMBROS. A silhueta do blockout mede 11.4u de ponta a ponta. */
  larguraOmbros: 11,
  /** I8 — proporção heroica: cabeça grande, pernas curtas, ≈4 cabeças de altura. */
  cabecas: 4,

  /** Altura (z) dos pivôs, medida do chão. */
  zQuadril: 6.6,
  zTorso: 8.8,
  /**
   * Rodada 2 (§10): 14.4 punha o fundo do elmo em 12.4 e o topo da ombreira
   * TAMBÉM em 12.4 — pescoço zero. Com o cisalhamento isométrico a ombreira do
   * lado alto subia até 2,3u em `artY` (3,25u nas direções 3 e 7) e invadia
   * 58%–81% da altura do elmo: cabeça e ombro fundiam num caroço e o guerreiro
   * lia corcunda em 4 das 8 direções. Em 15.0 o elmo ocupa 12.7..17.3 contra
   * ombreira até 12.0 — sobra 0,7u de gorjal visível.
   */
  zCabeca: 15.0,
  zOmbro: 12.9,
  zQuadrilPerna: 6.4,

  /**
   * Meia-bitola dos braços. Rodada 2 (§10): com 5.0 a silhueta de dir1 media
   * 35px de arte de largura contra 28 de altura — mais LARGO que alto, onde a
   * referência é 1:2. Os braços presos em ±5.0, com o disco do escudo pendurado
   * na ponta, formavam asas horizontais (I8 reprovado). 3.9 traz a largura total
   * de ombro de 12.8u para 11.4u, alinhada com `larguraOmbros`.
   */
  xOmbro: 3.9,

  /**
   * Meia-bitola das pernas. Rodada 3 (§10): com 1.9 e bota de 3.0u o vão entre
   * as duas botas era 2·1.9 − 3.0 = 0.8u, e o contorno de 1px de cada lado o
   * fechava por completo — medido no atlas, o maior vão interno nos px de baixo
   * era 0,1px nas direções 0, 2, 4 e 6 e nos dois primeiros quadros de `andando`:
   * as duas pernas eram literalmente uma coluna só. Sem separação de pernas
   * nenhum ciclo de caminhada lê como passo, por melhor que fique a pose.
   * Com 2.2 e bota de 2.8u o vão vai a 1.6u — o dobro, e sobrevive ao contorno.
   *
   * Teto: 2.4 abriria 2.5px de vão, mas aí a bitola do quadril (pelve, 5.8u de
   * largura) deixa de cobrir as coxas e ele lê cambaio.
   */
  xPerna: 2.2
} as const;

/* ------------------------------------------------------------------ *
 * 3. Ajustes de revisão visual (§10) — os únicos números "negociáveis"
 * ------------------------------------------------------------------ */

/**
 * Números que a revisão visual (as 2–3 rodadas previstas no gate §10) pode
 * mexer sem tocar na árvore de nós nem nas dimensões das caixas.
 */
export const AJUSTES_GUERREIRO = {
  /**
   * Altura de montagem do escudo no antebraço esquerdo, relativa ao pivô do
   * ombro. A §8 omite o `cz` do grupo `escudo` (logo, 0 = na altura do ombro);
   * com 0 o disco sobe até a linha do elmo e come a cabeça na silhueta. Descido
   * para a altura do antebraço (`cz −5.0`) o disco fica do peito ao cinto,
   * "ocupando quase metade da altura do torso" — que é a leitura da referência
   * (I5). Geometria interna do escudo intacta.
   *
   * Rodada 3 (§10): −2.8 mais o braço a +55° punham o centro do disco em z ≈ 11,8
   * — altura de OMBRO. Na revisão visual o escudo fundia com a ombreira e com o
   * elmo e o guerreiro lia como um caroço só nas vistas 3/4. Com −5.0 e o braço a
   * +40° o centro cai em z ≈ 9,5 e a frente em y ≈ +3,7: peito ao cinto, à frente
   * do tronco, exatamente a leitura de I5.
   */
  escudoMontagemZ: -5.0,

  /**
   * Avanço do escudo no eixo Y do antebraço: tira o disco de "pendurado para
   * fora" e o põe na FRENTE do peito, em guarda. Sem isto o disco fica no plano
   * do braço e, nas direções 3 e 7, some atrás do torso — o buraco de volume que
   * o gate G2 mediu (55% da massa de dir1/dir5).
   */
  escudoMontagemY: 0.6,

  /**
   * Pivô da espada = centro da manopla (`cz −6.8` da §8), no espaço do braço
   * direito. É o eixo de giro anatomicamente certo (a espada gira NA MÃO) e a
   * origem a partir da qual `criarEspada` empilha punho → guarda → lâmina.
   */
  espadaPivoZ: -6.8
} as const;

/**
 * Ângulos da pose de repouso, em GRAUS (a conversão para radianos é feita ao
 * montar `POSE_PARADA`). Ajustáveis pela revisão visual — gates G1 e G6.
 */
export const ANGULOS_GUERREIRO = {
  /**
   * O braço da espada.
   *
   * A §8 manda −35° em X e a rodada 3 (§10) o revisou — com medição, não com
   * gosto. Levantar a mão por PITCH deixa 52% do eixo da lâmina apontando para a
   * FRENTE do modelo (+Y), e em `artY = +0.625y − 1.25z` (§4.2) o componente
   * frontal CANCELA o vertical: a lâmina foreshortena. Medido nas 8 direções com
   * −35°, o comprimento de tela ia de 4,2 a 17,5px de arte (razão 4,16×), e o
   * toco de 4,2px caía justamente na direção 2, que é o `facing` inicial de §5.1
   * — a primeira coisa que o jogador vê era o pior quadro do conjunto.
   *
   * A cura é levantar a mão por ABDUÇÃO (`ry`) em vez de pitch, e o eixo X é o
   * único que a projeção isométrica nunca achata. Com −8°/+30° o comprimento
   * passa a variar de 18,7 a 32,9px (razão 1,76×) e o ângulo de tela da lâmina
   * fica entre 57° e 81° — nunca abaixo dos 45° que I4 exige. Note que a própria
   * §8 já era autocontraditória neste ponto (ver o cabeçalho de `criarEspada`).
   */
  bracoDirRx: -8,
  /**
   * Abdução do braço da espada — é ELA que ergue a lâmina, não o pitch acima.
   * Positivo porque o braço mora em −X (o rig é espelhado, §6.1) e `ry > 0` leva
   * a extremidade para −X, ou seja, para FORA do corpo.
   */
  bracoDirRy: 30,

  /**
   * Joga a ponta da espada para fora do corpo e para cima, como na referência —
   * sem isto a lâmina sobe no plano sagital e lê como vertical, não como
   * diagonal. O módulo tem de superar `bracoDirRy`, senão as duas abduções se
   * cancelam. Com −52° a ponta fica acima da crista do elmo, afastada do tronco
   * em X, e ainda em diagonal.
   */
  espadaRy: -52,

  /**
   * Braço do escudo subindo: põe o disco em GUARDA, na frente do peito.
   *
   * Rodada 3 (§10): estava em −10°, e o comentário dizia fazer o contrário do que
   * o valor fazia. Com a rotação Rx de `../model3d` (`y' = y·cos − z·sin`) e o
   * antebraço em `cz −5.0`, o deslocamento em Y vale `5·sin(rx)` — negativo joga
   * o escudo 0,87u para TRÁS. O disco nunca saía do plano do braço, e nas
   * direções onde a largura de tela só enxerga o Y do modelo ele ficava inteiro
   * dentro da silhueta do torso. Medido por rasterização com ordem do pintor, o
   * escudo aparecia com 31–64px visíveis nas piores direções. Com +40° o pior
   * caso sobe para 3 dígitos e a razão pior/melhor despenca.
   *
   * O ótimo puro da varredura era +55°, e ele foi RECUSADO na revisão visual: a
   * essa altura o disco encosta na ombreira e no elmo e a figura vira um caroço
   * nas vistas 3/4. +40° com `escudoMontagemZ −5.0` põe o disco no peito, que é
   * onde a referência o mostra, sem perder legibilidade em nenhuma das 8.
   */
  bracoEsqRx: 40,
  /**
   * Abdução do braço do escudo — afasta o disco do tronco. Negativo porque o
   * braço mora em +X (§6.1). É a variável de MAIOR alavanca das três do escudo:
   * de −28° para −40°, com o resto fixo, os pixels visíveis do disco na pior das
   * 8 direções vão de 54 para 109.
   */
  bracoEsqRy: -40,
  /**
   * Contra-inclinação do disco, para ele ficar EM PÉ apesar do braço erguido.
   *
   * O escudo é filho de `bracoEsq`, então herda o `+40°` de `bracoEsqRx`: sem
   * isto o plano do disco tomba para trás 40° e a rasterização o mostra visto de
   * cima — na revisão visual da rodada 3 ele lia como pá, não como escudo. Os
   * −50° passam 10° do cancelamento exato de propósito: o disco fica vertical com
   * uma pontinha de inclinação para a frente, que é como um escudo em guarda se
   * apoia, e mede melhor que os −40° exatos em 6 das 8 direções.
   */
  escudoRx: -50,
  /**
   * Gira a face do disco, para ele ler como disco e não como placa.
   *
   * Rodada 3 (§10): 22° (rodada 1) e 40° (rodada 2) foram os dois insuficientes
   * porque o problema não era o ângulo — era a ESPESSURA e a FORMA (ver
   * `criarEscudo`). Com o disco já octogonal e com fundo, varri as três variáveis
   * do escudo por pixels VISÍVEIS nas 8 direções (rasterização com ordem do
   * pintor, não caixa envolvente): o platô fica entre −30° e −45° e o valor
   * escolhido é o meio dele.
   *
   * De passagem, a hipótese de que a soma `bracoEsqRy + escudoRz` precisa fugir
   * dos múltiplos de 45° NÃO se sustenta na medição — o melhor resultado tem soma
   * 78°, e mesmo somas de 90° medem bem. A regra vale para uma PLACA, que fica de
   * perfil; um disco com massa nos três eixos não tem perfil.
   */
  escudoRz: -38
} as const;

/* ------------------------------------------------------------------ *
 * 4. Utilitários locais (nada disso escapa do módulo)
 * ------------------------------------------------------------------ */

type Vec3 = [number, number, number];

const RAD_POR_GRAU = Math.PI / 180;

/** Graus → radianos. As poses do contrato estão em graus; o rig fala radianos. */
export function grausParaRad(graus: number): number {
  return graus * RAD_POR_GRAU;
}

/**
 * Monta uma caixa a partir da notação da tabela da §8:
 * `peca(cor, [sx, sy, sz], [cx, cy, cz])`. O centro é opcional (padrão: no
 * pivô do nó), e `contorno` fica no padrão `true` de §4.1 — I6 exige outline
 * contínuo em toda a silhueta.
 */
function peca(cor: CorGuerreiro, dim: Vec3, centro?: Vec3): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro ?? [0, 0, 0];
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Igual a `peca`, mas SEM contorno de silhueta próprio (§4.5). É o PADRÃO deste
 * rig desde a rodada 3 — `peca` sobrou para exatamente quatro peças.
 *
 * O achado que virou regra. Na rodada 2, dezenove peças traçavam contorno
 * próprio. O contorno tem 1px de ARTE de largura e é traçado nas duas bordas da
 * peça; na escala de então (`ART_POR_U = 1.25`) uma peça de 3u de travessia media
 * 3,75px de arte, então o outline comia 2
 * e sobrava 1px de superfície. Medido no atlas: 40%–52% dos pixels do sprite
 * eram `contorno` (#191008), contra os ~17% que o perímetro EXTERNO justificaria
 * — metade do personagem era linha preta. Nas quatro vistas 3/4 (direções 0, 2,
 * 4 e 6), justamente as mais parecidas com a pose da referência, o resultado era
 * uma mancha escura sem cabeça, sem ombro e sem perna separável.
 *
 * A regra que sai daí: **só desenha contorno próprio a peça que faz SILHUETA
 * EXTERNA** — peitoral, as duas ombreiras e o elmo. Todo o resto se lê por COR
 * contra a peça vizinha (é assim que a referência separa peitoral, abdome e
 * cinto), e a silhueta externa continua fechada porque quem a desenha é a
 * máscara de alpha do sprite forge (§2.1 de `../spriteForge`), não este contorno.
 */
function detalhe(cor: CorGuerreiro, dim: Vec3, centro?: Vec3): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/* ------------------------------------------------------------------ *
 * 5. Nomes dos nós — chaves estáveis de `Pose`
 * ------------------------------------------------------------------ */

/**
 * Os nomes são contrato entre o rig, as poses e a animação (§6). Use estas
 * constantes em vez de string literal solta: um erro de digitação numa `Pose`
 * é silencioso (o nó simplesmente não roda).
 */
export const NOS_GUERREIRO = {
  raiz: 'raiz',
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  bracoDir: 'bracoDir',
  espada: 'espada',
  bracoEsq: 'bracoEsq',
  escudo: 'escudo',
  pernaDir: 'pernaDir',
  pernaEsq: 'pernaEsq'
} as const;

export type NomeNoGuerreiro = (typeof NOS_GUERREIRO)[keyof typeof NOS_GUERREIRO];

/* ------------------------------------------------------------------ *
 * 6. O blockout (§8)
 * ------------------------------------------------------------------ */

const P = PROPORCOES_GUERREIRO;

/**
 * quadril — a pelve que liga tronco e pernas.
 *
 * A profundidade (sy) subiu de 3.8 para 4.8 na rodada 2 e para 5.6 na rodada 3.
 * Ver `criarTorso`: o modelo inteiro era uma PLACA (fundo muito menor que a
 * largura) e encolhia ao girar para o perfil.
 */
function criarQuadril(): No {
  return {
    nome: NOS_GUERREIRO.quadril,
    pivo: [0, 0, P.zQuadril],
    caixas: [detalhe('ouroBase', [5.8, 5.6, 2.6])]
  };
}

/**
 * torso — peitoral, abdome, gorjal, cinto e as duas ombreiras.
 * As ombreiras (I3) são as peças mais largas do modelo: elas, e não o peitoral,
 * definem a silhueta do guerreiro. Ficam em `ouroLuz` porque na referência
 * pegam a luz de cima em cheio.
 *
 * Três correções da rodada 2 (§10) moram aqui:
 *
 * 1. PROFUNDIDADE. Todas as caixas do tronco eram rasas (sy ~4u contra sx ~7u):
 *    o guerreiro era uma placa, e nas direções 3 e 7 — onde `artX` só enxerga o
 *    eixo Y — a silhueta caía de 34 para 14px de arte de largura (−57% de área).
 *    É o "pular de tamanho" que o gate G2 proíbe. Peitoral, abdome, cinto e
 *    ombreiras ganharam fundo.
 * 2. PESCOÇO. A ombreira encostava exatamente no fundo do elmo. Ela baixou
 *    (topo de 12.4 para 12.0) e recuou 0.2u, e a cabeça subiu (ver
 *    `PROPORCOES_GUERREIRO.zCabeca`) — abre a folga de gorjal da referência.
 * 3. LEITURA INTERNA. O peitoral era um campo chapado de um tom só. Virou duas
 *    peças com 1.0u de degrau em X e 0.8u em Y e tons diferentes: o degrau gera
 *    aresta de silhueta e o tom garante a linha peitoral/abdome mesmo sem
 *    outline interno, que é como a referência separa peitoral, abdome e cinto.
 *
 * Rodada 3 (§10) fecha o item 1, que a rodada 2 só aliviou. A planta do corpo
 * ainda era 11,4u de largura por 6,0u de fundo (1,9:1); como `artX = x − y`, nos
 * yaws das direções 3 e 7 só o FUNDO aparece, e a massa de pixels caía 39% em
 * relação à direção mais gorda — a "coluna estreita" que o gate G2 proíbe. Cada
 * caixa do tronco trocou largura por fundo (peitoral 7.2×6.0 → 6.8×7.0, abdome
 * 6.2×5.2 → 6.0×6.2, cinto idem) e as ombreiras trocaram fundo por volume
 * vertical (3.4×5.6×3.0 → 3.6×5.0×3.4), preservando a linha de ombro.
 *
 * Só o peitoral e as duas ombreiras traçam contorno próprio aqui: são as peças
 * que fazem silhueta externa. Ver `detalhe` — na rodada 2 o outline interno
 * consumia até 52% dos pixels do sprite.
 *
 * Ordem de declaração = desempate da ordem do pintor (§4.4): tronco antes das
 * ombreiras, que são as peças que avançam sobre ele.
 */
function criarTorso(): No {
  return {
    nome: NOS_GUERREIRO.torso,
    pivo: [0, 0, P.zTorso],
    caixas: [
      peca('ouroBase', [6.8, 7.0, 3.0], [0, 0, 1.0]), //  peitoral — placa alta
      detalhe('ouroMeio', [6.0, 6.2, 2.0], [0, 0, -1.4]), //  abdome
      detalhe('ouroMeio', [3.4, 3.6, 2.0], [0, 0, 3.2]), //  gorjal — pescoço/colar
      detalhe('couro', [6.2, 6.0, 1.0], [0, 0, -2.4]), //  cinto
      peca('ouroLuz', [3.6, 5.0, 3.4], [-4.0, -0.2, 1.7]), //  ombreira.esq  ← I3
      peca('ouroLuz', [3.6, 5.0, 3.4], [4.0, -0.2, 1.7]) //  ombreira.dir  ← I3
    ]
  };
}

/**
 * cabeca — elmo fechado, sem rosto (I2). A viseira é uma fenda de `vazio`
 * atravessada na frente do elmo; a crista corre no eixo Y (da testa à nuca).
 *
 * Rodada 2 (§10), três defeitos medidos e corrigidos:
 *
 * - a viseira era MAIS LARGA que o elmo (4.7 contra 4.6): em vez de fenda, uma
 *   máscara escura cobrindo o rosto inteiro — I2 ao contrário. Agora tem 3.4
 *   contra 5.4, e avança 0.2u além da frente do elmo para não brigar com ele na
 *   ordem do pintor;
 * - o elmo era pequeno demais contra os ombros (29% da largura, contra ~41% na
 *   referência). 5.4 sobre a bitola de 11.4u devolve a cabeça grande de I8;
 * - a crista era curta em Y (3.6). Ela é a MELHOR pista de para onde ele olha
 *   justamente no perfil, que é onde a viseira não aparece — foi para 4.8.
 *
 * Rodada 3 (§10), três medidas e três correções:
 *
 * - o elmo tinha 5.2u de FUNDO contra 6.0u do torso: nos perfis (direções 3 e 7)
 *   a cabeça ficava com quase a mesma largura de tela do corpo e a figura lia
 *   como duas caixas empilhadas, matando I8. Foi para 5.0×4.4×4.4, e a silhueta
 *   da cabeça cai abaixo de 70% da do tronco nas 8 direções;
 * - a crista cresceu em Y e afinou em X (1.2×5.4×1.2): ela passa a ser a pista de
 *   direção nos perfis, que era a intenção declarada na rodada 2;
 * - a viseira tinha 0,9u de altura = 1,1px de arte, que o snap arredondava para
 *   1px e a cor `vazio` (#241a12), a um passo de `contorno` (#191008), fundia com
 *   o outline do elmo: nas 8 direções não dava para localizar a fenda. Com 1.4u
 *   ela vale 3,5px de arte no `ART_POR_U` novo, e `cy 2.4` a põe 0,5u À FRENTE da
 *   face do elmo (que agora fecha em y = 2.2) em vez de rente a ela, tirando a
 *   briga com a ordem do pintor.
 *
 * Alturas resultantes: elmo 12.8..17.2, crista 16.7..17.9 — a crista fecha na
 * `altura` de 18u de §3.
 */
function criarCabeca(): No {
  return {
    nome: NOS_GUERREIRO.cabeca,
    pivo: [0, 0, P.zCabeca],
    caixas: [
      peca('ouroBase', [5.0, 4.4, 4.4]), //  elmo     ← I2
      detalhe('vazio', [3.6, 0.6, 1.4], [0, 2.4, 0.1]), //  viseira  ← I2
      detalhe('ouroLuz', [1.2, 5.4, 1.2], [0, 0, 2.3]) //  crista
    ]
  };
}

/**
 * espada — punho, guarda e lâmina (I4).
 *
 * Aqui mora a única correção real ao blockout, e ela é obrigatória. A §8 lista a
 * espada descendo a partir da manopla (`cz` de −8.4 a −15.0, ou seja, no mesmo
 * −Z em que o braço se estende) e no parágrafo seguinte exige que ela aponte
 * "para cima e para fora" com o braço a −35° em X. As duas coisas não podem ser
 * verdade ao mesmo tempo: pela regra da mão direita, −35° sobre um apêndice que
 * desce joga a ponta para TRÁS e para BAIXO — espada baixada, exatamente o que a
 * §8 proíbe, e adeus I4.
 *
 * A compensação é feita na DECLARAÇÃO das caixas, não na pose: o nó é ancorado
 * no centro da manopla (`AJUSTES_GUERREIRO.espadaPivoZ`) e as três peças são
 * espelhadas para +Z — a mão fecha na base do punho, a guarda fica acima da mão
 * e a lâmina sobe. As distâncias ao punho são as mesmas da §8, peça por peça
 * (1.6, 3.0 e 8.2u), e os tamanhos não mudam: é o mesmo blockout, empunhado do
 * jeito certo.
 *
 * Consequência que importa: a espada nasce ERGUIDA com rotação zero. Qualquer
 * pose que respeite o `bracoDir` a −35° da §8 — a `POSE_PARADA` daqui ou a do
 * sprite forge — resulta na lâmina a ~55° acima da horizontal, a diagonal da
 * referência. Nenhum ângulo mágico fica escondido numa tabela de pose.
 *
 * Declarada por ÚLTIMO dentro do braço direito — §4.4, a espada é o caso limite
 * da ordem do pintor.
 *
 * Rodada 2 (§10): a lâmina de 1.3u dava 1,6px de arte de travessia e se desfazia
 * em pontilhado depois da rasterização (visível nas direções 0 e 4); guarda e
 * punho sumiam de vez; e a ponta não passava do elmo, então nem "erguida" ela
 * lia. Todas as peças engrossaram e a lâmina foi a 11.0u de comprimento, que leva
 * a ponta acima da crista. Um pomo novo fecha a base do punho.
 *
 * Rodada 3 (§10) — a lâmina era uma FITA. Com 2.0u de largura por 0.9u de fundo,
 * a espessura na tela dependia de qual das duas faces estava virada para o
 * observador e variava de 2,0 a 3,8px de arte (razão 1,93×); nas direções 0 e 4
 * ela virava um fio que o contorno pontilhava, e dava para contar os furos no
 * recorte ampliado. A cura é SEÇÃO QUADRADA: com 2.2×1.8 a espessura deixa de
 * depender do giro. Mesmo raciocínio para a `guarda`, que era ainda mais
 * achatada (4.0×1.2) e sumia de perfil — foi para 4.2×2.4.
 *
 * A lâmina continua em `acoBase`, e não em `acoLuz`: com o `REALCE_TOPO` de
 * `model3d` uma caixa `acoBase` cai em acoLuz (topo) / acoBase (frente) /
 * acoSombra (lado) — os TRÊS tons de aço da §2. Declarada `acoLuz`, topo e
 * frente colapsariam no mesmo branco e o volume da lâmina sumiria.
 *
 * As quatro peças moram em `caixasDaEspada()` porque a espada tem DOIS donos de
 * montagem: o nó pendurado na mão (`criarEspada`, logo abaixo) e o mini-rig
 * solto de `criarModeloEspada`, forjado num atlas próprio para a cinemática de
 * morte do guerreiro. Uma fonte só — as duas montagens nunca divergem.
 */
function caixasDaEspada(): Caixa[] {
  return [
    detalhe('ouroLuz', [1.6, 1.6, 0.9], [0, 0, 0.1]), //  pomo
    detalhe('couro', [1.4, 1.4, 2.6], [0, 0, 1.6]), //  punho   (§8: cz −8.4)
    detalhe('ouroLuz', [4.2, 2.4, 1.2], [0, 0, 3.0]), //  guarda  (§8: cz −9.8)
    detalhe('acoBase', [2.2, 1.8, 11.0], [0, 0, 9.0]) //  lâmina  (§8: cz −15.0)
  ];
}

function criarEspada(): No {
  return {
    nome: NOS_GUERREIRO.espada,
    pivo: [0, 0, AJUSTES_GUERREIRO.espadaPivoZ],
    caixas: caixasDaEspada()
  };
}

/**
 * escudo — o disco redondo grande (I5).
 *
 * Não há primitiva de círculo: o disco é aproximado por caixas — TRÊS caixas
 * cruzadas no plano do disco (larga, alta e a diagonal do quadrado), cuja união
 * lê como octógono na rasterização em baixa resolução, mais a face do disco à
 * frente delas e o umbo saliente no centro. É o truque que faz a silhueta ler
 * como disco.
 * A montagem sai de `AJUSTES_GUERREIRO.escudoMontagem{Y,Z}`.
 *
 * Rodada 2 (§10) — por que virou empilhamento em Y. As 3 caixas antigas se
 * interpenetravam: a face ocupava y 1.1..2.1 e o aro y 0.9..2.1, praticamente
 * COPLANARES e com cores diferentes. Sem z-buffer, a ordem do pintor (§4.4)
 * ordena pela profundidade do centro da face, e faces coplanares de cores
 * distintas se intercalam pixel a pixel: o disco virava mancha com ruído, e em
 * dir0 lia caixote. Agora cada peça tem sua FAIXA de Y, sem sobreposição:
 *
 *   aro / aroCruz  0.8 .. 1.6   (mesma faixa, mas mesma cor — a união é o alvo)
 *   face           1.6 .. 2.3
 *   umbo           2.3 .. 3.3
 *
 * As duas caixas do aro são propositalmente coplanares entre si: sendo do mesmo
 * tom, qualquer ordem produz o mesmo pixel, e o empate é resolvido pela ordem de
 * declaração (§4.4) — determinístico.
 *
 * Rodada 3 (§10) — duas mudanças, e a segunda foi achada na revisão visual.
 *
 * 1. ESPESSURA. Com 0.7–1.0u ele era uma PLACA: 2,37u de meia-extensão em Y
 *    contra 3,0u do torso, matematicamente impossível aparecer nos perfis. Medido
 *    por rasterização com ordem do pintor, o disco tinha 31–64px visíveis nas
 *    piores direções contra ~450 na melhor. Agora tem 1.8u de aro mais o umbo
 *    saliente: carrega massa nos TRÊS eixos, e o pior caso vai a 109px.
 * 2. FORMA. A cruz de duas caixas não fecha um octógono — fecha um sinal de
 *    "mais", com quatro reentrâncias. Na primeira revisão desta rodada o escudo
 *    lia como barbatana, não como disco. A terceira caixa (`chanfro`, a diagonal
 *    do quadrado) preenche os cantos e é o que transforma a união em octógono.
 *
 * O diâmetro também caiu de 6.4u para 5.4u: a 6.4u o disco media 28px de arte de
 * largura de tela contra 48 de altura da figura inteira — ele deixava de ser um
 * escudo e virava uma asa. As faixas de Y ficam 0.0–1.8 (as três caixas do aro),
 * 1.5–2.3 (face) e 2.05–2.95 (umbo).
 *
 * Todas as cinco são `detalhe` (sem contorno próprio). O disco é a única peça
 * do rig que gira fora dos eixos do modelo (`escudoRz`), então as suas faces
 * projetam como paralelogramos oblíquos; contorná-las uma a uma enchia o escudo
 * de linhas cruzadas e ele lia como mancha rasgada, não como disco. Sem contorno
 * interno o disco vira um bloco só, com o umbo mais claro no meio, e a silhueta
 * fecha pela máscara de alpha do sprite forge.
 */
function criarEscudo(): No {
  return {
    nome: NOS_GUERREIRO.escudo,
    pivo: [0, AJUSTES_GUERREIRO.escudoMontagemY, AJUSTES_GUERREIRO.escudoMontagemZ],
    caixas: [
      detalhe('ouroMeio', [5.4, 1.8, 3.4], [0, 0.9, 0]), //  aro     — travessa larga
      detalhe('ouroMeio', [3.4, 1.8, 5.4], [0, 0.9, 0]), //  aroCruz — travessa alta
      detalhe('ouroMeio', [4.5, 1.8, 4.5], [0, 0.9, 0]), //  chanfro — fecha o octógono
      detalhe('ouroBase', [3.8, 0.8, 3.8], [0, 1.9, 0]), //  face
      detalhe('ouroLuz', [1.6, 0.9, 1.6], [0, 2.5, 0]) //  umbo
    ]
  };
}

/** Úmero e antebraço são idênticos nos dois braços; o que muda é o que pendura. */
function caixasDoBraco(): Caixa[] {
  return [
    detalhe('ouroMeio', [2.2, 2.2, 3.6], [0, 0, -1.8]), //  úmero
    detalhe('ouroBase', [2.0, 2.0, 3.2], [0, 0, -5.0]) //  antebraço
  ];
}

/* ------------------------------------------------------------------ *
 * 6.1 CHIRALIDADE — por que o braço da espada mora em −X
 *
 * A projeção de §4.2 é ESPELHADA. Não é opinião, é o determinante: os três eixos
 * do modelo projetam em `artX = x − y`, `artY = (x + y)/2 − z` (com `artY` para
 * BAIXO, convenção de canvas), ou seja
 *
 *     +X → ( 1, +0.5)     +Y → (−1, +0.5)     +Z → ( 0, −1)
 *
 * Ponha um relógio no chão (plano XY) e ande de +X para +Y: no mundo, visto de
 * cima (que é de onde olhamos, já que +Z sobe na tela), isso é ANTI-horário. Na
 * tela, o produto vetorial dá `(1)(0.5) − (0.5)(−1) = +1` num sistema com Y para
 * baixo, ou seja HORÁRIO. O sentido inverte: a imagem é a imagem espelhada do
 * modelo. (Conferindo por outro caminho: a base de tela `direita × cima` vale
 * −(1,1,1)/√3, e não +(1,1,1)/√3, que é de onde o culling de §4.3 olha.)
 *
 * Consequência prática, medida na rodada 2: com a espada no braço em +X — a mão
 * anatomicamente direita — nas vistas de frente e de costas (direções 1 e 5) a
 * lâmina caía na DIREITA da tela e o escudo na esquerda. A referência é o
 * oposto: a lâmina chega a x = 18 de 151 (bem à esquerda) e o escudo a x = 108.
 * Um guerreiro de frente para você com a espada na mão direita mostra a lâmina do
 * SEU lado esquerdo — e a direção 1 é a pose que o jogo mais mostra.
 *
 * A cura é autorar o rig ESPELHADO em X: braço da espada em −X, braço do escudo
 * em +X, pernas idem. O giro de facing não é afetado (a frente é +Y, que o
 * espelho não toca), então o gate G3 continua verde; o que troca de lado é só a
 * lateralidade do corpo, que é exatamente o defeito.
 *
 * O espelho vale para o PROJETO inteiro, não para este personagem: quem projeta é
 * `../model3d`, e todo rig que passar por ele sai espelhado. Por isso a animação
 * genérica de `../spriteForge` também assume espaço espelhado (ver a constante
 * `ESPELHO` lá) — abrir a perna "para fora" troca de sinal junto.
 * ------------------------------------------------------------------ */

/**
 * bracoDir — a mão DIREITA do guerreiro, a que empunha a espada; ganha a manopla
 * que fecha na mão. Mora em −X por causa do espelho da projeção (§6.1): é isso
 * que faz a lâmina cair na esquerda da tela, como na referência.
 */
function criarBracoDir(): No {
  return {
    nome: NOS_GUERREIRO.bracoDir,
    pivo: [-P.xOmbro, 0, P.zOmbro],
    caixas: [...caixasDoBraco(), detalhe('ouroLuz', [2.4, 2.4, 1.2], [0, 0, -6.8])],
    filhos: [criarEspada()]
  };
}

/**
 * bracoEsq — carrega o escudo (não tem manopla: a mão some atrás do disco).
 * Mora em +X — o espelho de `criarBracoDir`, ver §6.1.
 */
function criarBracoEsq(): No {
  return {
    nome: NOS_GUERREIRO.bracoEsq,
    pivo: [P.xOmbro, 0, P.zOmbro],
    caixas: caixasDoBraco(),
    filhos: [criarEscudo()]
  };
}

/**
 * Perna. As caixas são simétricas em X (todas centradas em `cx = 0` no espaço
 * do nó), então o espelhamento da §8 é só o sinal do pivô — nada de duplicar a
 * tabela e arriscar as duas pernas divergirem num ajuste futuro.
 *
 * Atenção do forge (§7): com os `cz` da §8, a canela encosta exatamente em
 * `z = 0` e a bota desce até `z = −1.2` — o pé fica ENTERRADO 1.2u no plano do
 * chão, de propósito, para o boneco assentar DENTRO do losango do tile em vez de
 * ficar equilibrado em cima dele. Logo a âncora do sprite é o plano `z = 0` do
 * modelo, NUNCA a borda inferior do quadro. A caixa (AABB) do rig em z é
 * [−1.2, +18.0] — a sola fecha exatamente no mesmo −1.2 da bota antiga.
 *
 * Rodada 2 (§10), duas correções de cor e uma de massa:
 *
 * - a coxa era `ouroMeio` e a bota era `vazio` (#241a12), quase a cor do
 *   contorno: os pés desapareciam na sombra e a perna terminava em nada. Na
 *   referência é o CONTRÁRIO — coxa escura (`couro`), greva e bota douradas.
 *   A sola nova, essa sim `vazio`, é a linha escura que assenta o pé;
 * - a bota era funda (sy 4.0, cy +0.6) e, cisalhada pelo pivô em x = ±1.9,
 *   fazia a base da silhueta oscilar 2px de arte entre direções — o boneco
 *   parecia afundar e emergir do losango ao girar.
 *
 * Rodada 3 (§10): a rodada 2 disse ter derrubado essa oscilação para ~1px, e
 * medido no rig ela continuava em 2,31px de arte (base em 5,00 nas direções 0 e 2
 * contra 2,69 na 5) — contra uma sombra elíptica FIXA, ou seja, ele flutuava
 * andando para cima e afundava andando para baixo-direita. A causa que sobrava
 * era a assimetria: bota e sola ainda eram mais fundas em Y (3.4 e 3.5) do que
 * largas em X (3.0 e 3.1) e ficavam deslocadas em `cy +0.4`. Com o pé QUADRADO em
 * planta e centrado (`cy 0`) a oscilação cai para 1,75px e — o que importa mais
 * para G2 — o padrão vira simétrico entre direções opostas, em vez de dir0 = 5,00
 * contra dir4 = 4,50. O resíduo é efeito de canto do AABB nas 4 diagonais; zerar
 * exigiria chanfrar o pé com uma 4ª caixa cruzada (o truque do aro do escudo).
 *
 * As larguras caíram junto (bota 3.0 → 2.8, sola 3.1 → 2.9, canela 2.3 → 2.2)
 * para abrir o vão entre as pernas — ver `PROPORCOES_GUERREIRO.xPerna`.
 *
 * O pivô é `−lado · xPerna`: o rig inteiro é autorado espelhado em X (§6.1).
 */
function criarPerna(lado: 1 | -1): No {
  return {
    nome: lado > 0 ? NOS_GUERREIRO.pernaDir : NOS_GUERREIRO.pernaEsq,
    pivo: [-lado * P.xPerna, 0, P.zQuadrilPerna],
    caixas: [
      detalhe('couro', [2.6, 2.6, 3.4], [0, 0, -1.7]), //  coxa   — escura, como na ref.
      detalhe('ouroBase', [2.2, 2.2, 3.0], [0, 0, -4.9]), //  canela — greva dourada
      detalhe('ouroMeio', [2.8, 2.8, 0.9], [0, 0, -6.65]), //  bota
      detalhe('vazio', [2.9, 2.9, 0.5], [0, 0, -7.35]) //  sola
    ]
  };
}

/**
 * Monta uma árvore NOVA do Guerreiro. Chame isto (e não mute `MODELO_GUERREIRO`)
 * sempre que precisar de um rig próprio — variantes de equipamento, testes,
 * previews. A ordem dos filhos importa só para desempate da ordem do pintor
 * (§4.4): quadril e torso antes dos apêndices, espada por último no braço.
 */
export function criarModeloGuerreiro(): No {
  return {
    nome: NOS_GUERREIRO.raiz,
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

/** O rig canônico do Guerreiro, pronto para o sprite forge (§7). Não mute. */
export const MODELO_GUERREIRO: No = criarModeloGuerreiro();

/**
 * Variante SEM a espada, para a cinemática de morte: `criarModeloGuerreiro()`
 * (árvore NOVA — `MODELO_GUERREIRO` nunca é tocado) com o filho `espada` de
 * `bracoDir` podado pelo nome. Os campos de `No` são readonly, então a poda
 * reconstrói os dois nós do caminho em vez de mutar — mesmo espírito do
 * "árvore nova a cada chamada" do cabeçalho.
 *
 * Por que podar e não autorar um segundo rig: o corpo é o mesmo, e duas
 * declarações do mesmo corpo divergem no primeiro ajuste visual.
 */
export function criarModeloGuerreiroSemEspada(): No {
  const modelo = criarModeloGuerreiro();
  const filhos = modelo.filhos ?? [];
  return {
    ...modelo,
    filhos: filhos.map((no) =>
      no.nome === NOS_GUERREIRO.bracoDir
        ? {
          ...no,
          filhos: (no.filhos ?? []).filter((f) => f.nome !== NOS_GUERREIRO.espada)
        }
        : no
    )
  };
}

/**
 * A espada SOZINHA, como mini-rig: um nó raiz com as quatro caixas de
 * `caixasDaEspada()` em pé a partir da origem (a base do punho em z ≈ 0 — a
 * âncora do atlas é o pomo, que é por onde a cinemática de morte a faz girar).
 * Forjada com repouso neutro e lida na coluna ('parado', 0): a rotação da queda
 * é de TELA (`ctx.rotate` no renderer), não de pose.
 */
export function criarModeloEspada(): No {
  return {
    nome: NOS_GUERREIRO.raiz,
    pivo: [0, 0, 0],
    caixas: caixasDaEspada()
  };
}

/** Mesmo padrão de `MODELO_GUERREIRO`: constantes de módulo, não mutar. */
export const MODELO_GUERREIRO_SEM_ESPADA: No = criarModeloGuerreiroSemEspada();
export const MODELO_ESPADA: No = criarModeloEspada();

/* ------------------------------------------------------------------ *
 * 7. Pose de repouso (§6, estado `parado`)
 * ------------------------------------------------------------------ */

const A = ANGULOS_GUERREIRO;

/**
 * A pose de referência: a que a §8 descreve e a que a referência mostra —
 * espada ERGUIDA na diagonal, escudo em guarda na frente do peito, braços
 * afastados do tronco. É a base sobre a qual a animação (§6) soma o balanço de
 * respiração, o passo e o golpe; a animação vive na camada de render, alimentada
 * por `dt`, e JAMAIS toca o estado lógico (R54).
 *
 * Nós ausentes daqui ficam em repouso (rotação zero): quadril, torso, cabeça e
 * pernas. Isso é intencional — a pose parada é uma pose de BRAÇOS.
 *
 * Para quem integra com o sprite forge (§7): esta é a pose de repouso do RIG e o
 * lugar certo de passá-la é `opts.repouso`. Ela é aditiva e segura de trocar —
 * `espada` e `escudo` só levam refinamento de ângulo, e a espada erguida (I4) não
 * depende de nenhuma entrada desta tabela: ela está na geometria (`criarEspada`).
 * Uma pose de repouso que ignore `espada`/`escudo` continua produzindo um
 * guerreiro correto, só um pouco menos gracioso.
 */
export const POSE_PARADA: Pose = {
  [NOS_GUERREIRO.bracoDir]: {
    rx: grausParaRad(A.bracoDirRx),
    ry: grausParaRad(A.bracoDirRy)
  },
  [NOS_GUERREIRO.espada]: {
    ry: grausParaRad(A.espadaRy)
  },
  [NOS_GUERREIRO.bracoEsq]: {
    rx: grausParaRad(A.bracoEsqRx),
    ry: grausParaRad(A.bracoEsqRy)
  },
  [NOS_GUERREIRO.escudo]: {
    rx: grausParaRad(A.escudoRx),
    rz: grausParaRad(A.escudoRz)
  }
};

/* ------------------------------------------------------------------ *
 * 8. Poses da cinemática de morte (repousos de forja, não animação)
 *
 * Estas duas poses NÃO passam pela animação de §6: elas são passadas como
 * `opts.repouso` ao sprite forge, que as congela na coluna ('parado', 0) de um
 * atlas secundário — o IsoRenderer lê só essa coluna, na direção do facing.
 *
 * Convenção de sinal: a MESMA de `POSE_PARADA` (valores crus no espaço do
 * modelo — o `ESPELHO` de `../spriteForge` só multiplica os deltas da animação
 * genérica, nunca o repouso: ver `clonarPose` lá). Membros se estendem em −Z
 * local: `rx > 0` leva a extremidade para +Y (a frente), `ry > 0` para −X.
 * `Pose` não translada: "descer" o corpo se faz girando as pernas.
 * ------------------------------------------------------------------ */

/**
 * POSE_AJOELHADA — um joelho no chão (fase 3 da morte, ~0,9 s).
 *
 * `pernaDir` dobrada para trás (rx −80°: a canela vai quase à horizontal para
 * −Y, a leitura do joelho que tocou o chão) e `pernaEsq` à frente (rx +28°, o
 * pé plantado adiante). Como a pose não baixa o quadril, é o par de pernas
 * aberto em tesoura que vende a queda de altura — o tronco "pende" sobre o
 * joelho. Torso +25° para a frente, cabeça caída +22° e os dois braços
 * pendentes (rx perto de zero = mãos para baixo, com ry só para não fundirem
 * no tronco; base nos valores de `POSE_PARADA`). O escudo perde parte da
 * contra-inclinação de guarda porque o braço já não sobe. Sem `espada`: esta
 * pose é forjada sobre `MODELO_GUERREIRO_SEM_ESPADA`.
 */
export const POSE_AJOELHADA: Pose = {
  [NOS_GUERREIRO.pernaDir]: { rx: grausParaRad(-80) },
  [NOS_GUERREIRO.pernaEsq]: { rx: grausParaRad(28) },
  [NOS_GUERREIRO.torso]: { rx: grausParaRad(25) },
  [NOS_GUERREIRO.cabeca]: { rx: grausParaRad(22) },
  [NOS_GUERREIRO.bracoDir]: { rx: grausParaRad(8), ry: grausParaRad(18) },
  [NOS_GUERREIRO.bracoEsq]: { rx: grausParaRad(10), ry: grausParaRad(-22) },
  [NOS_GUERREIRO.escudo]: { rx: grausParaRad(-30), rz: grausParaRad(A.escudoRz) }
};

/**
 * POSE_CAIDA — deitado no chão (fase 4 da morte, ~1,7 s).
 *
 * A via simples: girar a `raiz` em rx +85° tomba o corpo INTEIRO para a frente
 * — na direção do olhar, já que o giro de facing do forge aponta +Y para cada
 * direção do atlas. O corpo se estende a partir da âncora (os pés ficam na
 * origem): aceitável e desejado, é o cadáver deitado no tile. Braços abertos
 * (ry ±45°, a mesma convenção de abdução de `POSE_PARADA`), pernas levemente
 * dobradas e assimétricas (cadáver simétrico lê como manequim), torso −8° e
 * cabeça −12° compensando para o peito e o rosto não mergulharem no plano do
 * chão, com rz +20° na cabeça — o elmo tombado de lado é o que separa
 * "deitado" de "agachado" na ordem do pintor.
 */
export const POSE_CAIDA: Pose = {
  [NOS_GUERREIRO.raiz]: { rx: grausParaRad(85) },
  [NOS_GUERREIRO.torso]: { rx: grausParaRad(-8) },
  [NOS_GUERREIRO.cabeca]: { rx: grausParaRad(-12), rz: grausParaRad(20) },
  [NOS_GUERREIRO.bracoDir]: { rx: grausParaRad(10), ry: grausParaRad(45) },
  [NOS_GUERREIRO.bracoEsq]: { rx: grausParaRad(10), ry: grausParaRad(-45) },
  [NOS_GUERREIRO.escudo]: { rx: grausParaRad(A.escudoRx), rz: grausParaRad(A.escudoRz) },
  [NOS_GUERREIRO.pernaDir]: { rx: grausParaRad(18) },
  [NOS_GUERREIRO.pernaEsq]: { rx: grausParaRad(-12) }
};
