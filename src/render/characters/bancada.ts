/*
 * ISOROGUE — src/render/characters/bancada.ts
 *
 * O rig da BANCADA DE ALQUIMIA E REFINO: a mobília que nasce numa sala da
 * masmorra e onde o herói transforma despojo em vantagem — gosma vira poção no
 * caldeirão, o ferro da cimitarra vira ataque na bigorna (fase 2 do sistema de
 * itens).
 *
 * Mesmo molde dos outros rigs e os mesmos limites: fonte da verdade da FORMA e
 * da COR, e nada mais. Não projeta, não rasteriza, não conhece Canvas nem
 * receita — quem sabe que 3 gosmas viram 1 poção é o engine.
 *
 * OS TRÊS TRAÇOS DE IDENTIDADE (perder um é perder o objeto):
 *
 *   I1  O CALDEIRÃO panzudo com a BOCA ABERTA mostrando o caldo verde. É a
 *       alquimia. A boca é o próprio líquido — ver a regra 1 abaixo;
 *   I2  A BIGORNA ao lado, em ferro escuro, com a silhueta clássica: base
 *       larga, cintura estreita, topo com bico. É o refino;
 *   I3  AS BRASAS ACESAS sob o caldeirão. São EMISSIVAS, e é por elas que a
 *       oficina se anuncia num corredor escuro — sem elas o conjunto lê como
 *       entulho, e o jogador não caminha até entulho.
 *
 * MEDIDAS: **7,0u de largura × 4,4u de profundidade × 5,0u de altura**. É
 * mobília de UM tile: o losango tem 64×32px de tela e o conjunto precisa
 * caber nele sem invadir o vizinho — por isso caldeirão e bigorna dividem a
 * largura em vez de empilhar.
 *
 * AS DUAS REGRAS QUE ESTE ARQUIVO RESPEITA POR TEREM CUSTADO CARO HOJE
 * (ver [[o-frasco-que-nao-tinha-gosma]]):
 *   1. **caixa é OPACA: o conteúdo tem de ser a SUPERFÍCIE**. O caldo NÃO é
 *      modelado dentro da panela — ele É a tampa do caldeirão, uma laje verde
 *      no topo com a borda de ferro em volta. Modelado por dentro, ele
 *      simplesmente não existiria na imagem;
 *   2. nada abaixo de `PROPORCOES_BANCADA.espessuraMinima` (0,5u ≈ 1,25px de
 *      arte): peça mais fina some em parte das oito direções e deixa buraco.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta
 *
 * Ferro (caldeirão e bigorna), pedra (a base que assenta tudo no chão), o
 * caldo verde — que ecoa de propósito o verde do Slime, já que é dele que a
 * poção vem — e a brasa emissiva. Onze cores, sem gradiente.
 * ------------------------------------------------------------------ */

export const PALETA_BANCADA = {
  ferroLuz: '#8b939c',   // topo da bigorna e do aro do caldeirão
  ferroBase: '#5d666f',  // corpo do ferro
  ferroMeio: '#41484f',  // faces laterais
  ferroSombra: '#282d33', // pés, vãos, sombra do ferro
  pedraLuz: '#7b7264',   // topo da base de pedra
  pedraBase: '#584f45',  // corpo da base
  caldoLuz: '#7ee89a',   // o alto do caldo (eco de PALETA_SLIME.gosmaLuz)
  caldoBase: '#2fa85e',  // o caldo (eco de PALETA_SLIME.gosmaMeio)
  brasa: '#ff8a2b',      // EMISSIVA — o fogo sob o caldeirão (I3)
  vazio: '#1a1512',      // vãos e sombra interna
  contorno: '#0e0b09'    // outline
} as const;

export type CorBancada = keyof typeof PALETA_BANCADA;

/* ------------------------------------------------------------------ *
 * 2. Rampas de quantização
 *
 * `fogo` tem UM tom, de propósito: emissiva precisa sobreviver INTEIRA ao
 * snap. Dividindo rampa com o ferro, o degrau vizinho cobriria a brasa e não
 * sobraria pixel para o forge recolar aceso por cima do escurecimento.
 * ------------------------------------------------------------------ */

export const RAMPAS_BANCADA = {
  ferro: ['ferroLuz', 'ferroBase', 'ferroMeio', 'ferroSombra'],
  pedra: ['pedraLuz', 'pedraBase', 'ferroSombra', 'vazio'],
  caldo: ['caldoLuz', 'caldoBase', 'ferroMeio', 'ferroSombra'],
  fogo: ['brasa'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorBancada[]>;

export const RAMPA_DA_COR_BANCADA = {
  ferroLuz: 'ferro',
  ferroBase: 'ferro',
  ferroMeio: 'ferro',
  ferroSombra: 'ferro',
  pedraLuz: 'pedra',
  pedraBase: 'pedra',
  caldoLuz: 'caldo',
  caldoBase: 'caldo',
  brasa: 'fogo',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorBancada, keyof typeof RAMPAS_BANCADA>;

/** As cores que IGNORAM a modulação de luz (§1.1): o fogo da oficina. */
export const CORES_EMISSIVAS_BANCADA: readonly CorBancada[] = ['brasa'];

/* ------------------------------------------------------------------ *
 * 3. Proporções
 * ------------------------------------------------------------------ */

export const PROPORCOES_BANCADA = {
  /** Largura total do conjunto — o limite é o losango de um tile. */
  largura: 7.0,
  /** Profundidade total. */
  profundidade: 4.4,
  /** Altura total, do chão ao caldo. */
  altura: 5.0,
  /** Centro do caldeirão em X (fica à esquerda de quem olha). */
  xCaldeirao: -1.7,
  /** Centro da bigorna em X (à direita). */
  xBigorna: 2.1,
  /**
   * Folga entre caldeirão e bigorna. Separação por GEOMETRIA vale nas oito
   * direções; separação por ordem de desenho, não — é a armadilha registrada
   * no cofre quando a cimitarra do Goblin atravessou o tronco.
   */
  folga: 0.6,
  /** Piso de espessura: ~2,5px de arte por `u`; abaixo disto a peça não existe. */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nomes dos nós
 * ------------------------------------------------------------------ */

export const NOS_BANCADA = {
  raiz: 'raiz',
  base: 'base',
  caldeirao: 'caldeirao',
  bigorna: 'bigorna'
} as const;

export type NomeNoBancada = (typeof NOS_BANCADA)[keyof typeof NOS_BANCADA];

const P = PROPORCOES_BANCADA;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

function peca(cor: CorBancada, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/** Caixa sem contorno próprio — o padrão; só silhueta externa traça outline. */
function detalhe(cor: CorBancada, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * A base de pedra: a laje que assenta o conjunto no chão e o faz ler como
 * instalação, não como duas coisas jogadas no piso. Ela também resolve a
 * âncora — o plano z=0 corta exatamente a face de baixo dela.
 */
function criarBase(): No {
  return {
    nome: NOS_BANCADA.base,
    pivo: [0, 0, 0],
    caixas: [
      peca('pedraBase', [P.largura, P.profundidade, 0.7], [0, 0, 0.35]),
      detalhe('pedraLuz', [P.largura - 0.8, P.profundidade - 0.8, 0.5], [0, 0, 0.75])
    ]
  };
}

/**
 * O CALDEIRÃO (I1) e as BRASAS (I3).
 *
 * A barriga é feita de três degraus (estreito embaixo, largo no meio, aro no
 * topo) — curva se faz com caixas escalonadas, jamais com uma.
 *
 * O CALDO é a laje verde do topo, com o aro de ferro em volta: é a aplicação
 * literal de "o conteúdo é a superfície". Uma versão anterior deste projeto
 * modelou líquido dentro de vidro e o líquido sumiu da imagem inteira.
 *
 * As brasas ficam SOB a barriga, avançando 0,1u além da silhueta do caldeirão
 * em Y: emissiva precisa existir como PIXEL para o forge extrair a camada, e
 * uma brasa exatamente rente à panela seria comida por ela em metade das
 * direções.
 */
function criarCaldeirao(): No {
  return {
    nome: NOS_BANCADA.caldeirao,
    pivo: [P.xCaldeirao, 0, 1.0],
    caixas: [
      /* BRASAS (I3) — primeiro na ordem do pintor, e MAIS LARGAS que a barriga.
       *
       * A rodada 1 as escondeu: com 2,6u contra os 3,2u da barriga, elas
       * ficavam debaixo do caldeirão e a panela as engolia em todas as
       * direções — o traço que anuncia a oficina no escuro não existia na
       * imagem. Agora o leito de brasas TRANSBORDA o caldeirão em ~0,5u de
       * cada lado, e uma língua de fogo avança para a frente (+Y), onde a
       * projeção isométrica sempre mostra. Mesma lição do frasco de gosma:
       * numa pilha de caixas opacas, o que está embaixo só existe se sobrar
       * para fora. */
      detalhe('ferroSombra', [4.2, 3.2, 0.5], [0, 0, -0.15]),
      detalhe('brasa', [3.8, 2.8, 0.6], [0, 0, 0.2]),
      detalhe('brasa', [1.6, 0.9, 0.6], [0, 1.7, 0.2]),
      /* barriga em três degraus */
      peca('ferroMeio', [2.4, 2.2, 0.7], [0, 0, 0.75]),
      peca('ferroBase', [3.2, 2.9, 1.3], [0, 0, 1.75]),
      peca('ferroLuz', [3.0, 2.7, 0.5], [0, 0, 2.65]),
      /* o caldo: a laje verde que É o conteúdo (I1) */
      detalhe('caldoBase', [2.4, 2.1, 0.5], [0, 0, 2.95]),
      detalhe('caldoLuz', [1.5, 1.3, 0.5], [-0.3, -0.2, 3.1])
    ]
  };
}

/**
 * A BIGORNA (I2): base larga, cintura estreita, mesa comprida com bico.
 *
 * A cintura é o traço que distingue bigorna de bloco — e é justamente a peça
 * que mais tenta ficar fina. Ela respeita o piso de espessura (0,8u de
 * travessia), custe o realismo que custar: uma cintura de 0,3u simplesmente
 * não existiria em metade das direções, e a silhueta viraria um cubo.
 */
function criarBigorna(): No {
  return {
    nome: NOS_BANCADA.bigorna,
    pivo: [P.xBigorna, 0, 0.7],
    caixas: [
      /* cepo de pedra sob a bigorna: levanta a mesa até altura de trabalho */
      peca('pedraBase', [2.2, 2.0, 0.9], [0, 0, 0.45]),
      /* base de ferro */
      peca('ferroMeio', [2.0, 1.8, 0.5], [0, 0, 1.15]),
      /* cintura */
      peca('ferroBase', [1.2, 1.2, 0.6], [0, 0, 1.7]),
      /* mesa: a peça larga que dá a leitura de bigorna */
      peca('ferroBase', [2.6, 1.6, 0.7], [0, 0, 2.35]),
      detalhe('ferroLuz', [2.4, 1.4, 0.5], [0, 0, 2.7]),
      /* bico, em dois degraus decrescentes para a frente (+Y) */
      detalhe('ferroBase', [0.9, 0.9, 0.6], [0, 1.2, 2.35]),
      detalhe('ferroMeio', [0.6, 0.7, 0.5], [0, 1.8, 2.3]),
      /* martelo pousado na mesa: o adereço que diz "em uso" */
      detalhe('ferroSombra', [1.4, 0.6, 0.5], [-0.2, -0.5, 3.0])
    ]
  };
}

/**
 * Monta uma árvore NOVA da bancada. Chame isto (e não mute `MODELO_BANCADA`)
 * sempre que precisar de um rig próprio.
 *
 * A ordem dos filhos é o desempate determinístico da ordem do pintor (§4.4):
 * base, depois caldeirão (à esquerda, mais ao fundo na leitura isométrica) e
 * por fim a bigorna.
 */
export function criarModeloBancada(): No {
  return {
    nome: NOS_BANCADA.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarBase(), criarCaldeirao(), criarBigorna()]
  };
}

/** O rig canônico da bancada, pronto para o sprite forge. Não mute. */
export const MODELO_BANCADA: No = criarModeloBancada();

/**
 * Repouso VAZIO, de propósito: mobília não articula. A pose existe porque o
 * forge a pede (`opts.repouso`) e porque a coluna ('parado', 0) do atlas
 * devolve exatamente o repouso — que aqui é o objeto como foi modelado.
 */
export const POSE_PARADA_BANCADA: Pose = {};
