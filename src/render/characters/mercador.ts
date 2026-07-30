/*
 * ISOROGUE — src/render/characters/mercador.ts
 *
 * O rig do MERCADOR, refeito sobre a referência que o dono mandou (rodada 2 —
 * a rodada 1 era um vulto encapuzado genérico e foi reprovada).
 *
 * A REFERÊNCIA, e o que dela virou requisito duro:
 *
 *   I1  As duas LENTES REDONDAS AMARELAS ACESAS ocupando quase o rosto todo.
 *       É por elas que a criatura é reconhecida antes de qualquer outra coisa —
 *       e, sendo EMISSIVAS, é o que se enxerga dele num corredor sem luz;
 *   I2  A BARRACA nas costas: estrutura de madeira com TOLDO DE LONA CLARA
 *       esticado por cima. É o volume que diz "mercador ambulante" a 40px;
 *   I3  A LANTERNA DOURADA ACESA no mastro que sai da barraca para cima;
 *   I4  A PELE VERMELHA no rosto e nas mãos, contra o manto escuro. O contraste
 *       quente/frio é metade da leitura;
 *   I5  A CAUDA grossa saindo por trás do manto.
 *
 * ESCALA: 15u de corpo. Mastro e toldo passam disso de propósito — extremidade
 * fora da altura declarada é a norma do elenco (a crista do Ogro, a antena do
 * Slime). Entre o Goblin (13u) e o Guerreiro (18u): ele é uma criatura pequena
 * carregando algo grande.
 *
 * O QUE FOI SIMPLIFICADO, e por quê: a ilustração tem dezenas de bugigangas,
 * runas legíveis e franjas de tecido. Em 40px isso vira ruído — as bugigangas
 * viraram três volumes pendurados, as runas viraram uma faixa clara, e os
 * dedos viraram uma caixa vermelha com ponta escura. Fidelidade perde para
 * legibilidade; é a armadilha nº 1 do método ([[legibilidade-em-40px]]).
 *
 * AS DUAS REGRAS QUE ESTE ARQUIVO OBEDECE POR TEREM CUSTADO CARO
 * ([[o-frasco-que-nao-tinha-gosma]]): caixa é OPACA (o conteúdo tem de ser a
 * superfície — o vão do capuz AVANÇA além da face, senão o rosto some), e nada
 * abaixo de `espessuraMinima` (0,5u ≈ 1,25px de arte), senão a peça pisca
 * entre direções e deixa buraco.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta — quente (a criatura) contra frio-terroso (o pano e a madeira)
 * ------------------------------------------------------------------ */

export const PALETA_MERCADOR = {
  peleLuz: '#d4523f',     // topo do focinho e das mãos
  peleBase: '#b8392e',    // a pele vermelha (I4)
  peleSombra: '#7d2019',  // faces afastadas, base da cauda
  garra: '#2a1410',       // pontas dos dedos e dos pés
  mantoLuz: '#6e6455',    // topo do capuz e dos ombros
  mantoBase: '#514839',   // o manto
  mantoMeio: '#3a3327',   // faces laterais
  mantoSombra: '#241f18', // barra do manto e vãos
  lenco: '#cbbfa4',       // o cachecol no pescoço
  lona: '#d9cfb0',        // o toldo da barraca (I2)
  lonaSombra: '#a99f84',  // as abas do toldo
  madeiraLuz: '#8a6a42',  // quinas da estrutura
  madeiraBase: '#6a4f2f', // a barraca
  metal: '#a9b4c1',       // panelas, fivelas, o aro das lentes
  lenteAmbar: '#ffd94a',  // EMISSIVA — as lentes (I1) e a chama da lanterna (I3)
  vazio: '#140f0c',       // vão do capuz, sombra interna
  contorno: '#0d0906'     // outline
} as const;

export type CorMercador = keyof typeof PALETA_MERCADOR;

/* ------------------------------------------------------------------ *
 * 2. Rampas — `ambar` tem UM tom porque emissiva precisa sobreviver inteira
 *    ao snap; dividindo rampa com metal, o degrau vizinho cobriria a lente e
 *    não sobraria pixel aceso para o forge recolar.
 * ------------------------------------------------------------------ */

export const RAMPAS_MERCADOR = {
  pele: ['peleLuz', 'peleBase', 'peleSombra', 'garra'],
  manto: ['mantoLuz', 'mantoBase', 'mantoMeio', 'mantoSombra'],
  pano: ['lenco', 'lonaSombra', 'mantoMeio', 'mantoSombra'],
  lona: ['lona', 'lonaSombra', 'mantoMeio', 'mantoSombra'],
  madeira: ['madeiraLuz', 'madeiraBase', 'mantoSombra', 'vazio'],
  metal: ['metal', 'lonaSombra', 'mantoMeio', 'vazio'],
  ambar: ['lenteAmbar'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorMercador[]>;

export const RAMPA_DA_COR_MERCADOR = {
  peleLuz: 'pele', peleBase: 'pele', peleSombra: 'pele', garra: 'pele',
  mantoLuz: 'manto', mantoBase: 'manto', mantoMeio: 'manto', mantoSombra: 'manto',
  lenco: 'pano', lona: 'lona', lonaSombra: 'lona',
  madeiraLuz: 'madeira', madeiraBase: 'madeira',
  metal: 'metal', lenteAmbar: 'ambar',
  vazio: 'vazio', contorno: 'vazio'
} as const satisfies Record<CorMercador, keyof typeof RAMPAS_MERCADOR>;

/** As lentes e a chama: ignoram a modulação de luz e acendem no escuro (§1.1). */
export const CORES_EMISSIVAS_MERCADOR: readonly CorMercador[] = ['lenteAmbar'];

/* ------------------------------------------------------------------ *
 * 3. Proporções
 * ------------------------------------------------------------------ */

export const PROPORCOES_MERCADOR = {
  altura: 15.0,
  larguraBarra: 6.0,   // a barra do manto, no chão
  larguraOmbro: 4.6,
  zCintura: 5.4,
  zOmbro: 9.6,
  zCabeca: 10.6,
  /** Diâmetro de cada lente. Grande de propósito: I1 é o traço da referência. */
  lente: 1.3,
  /** ~2,5px de arte por `u`: abaixo disto a peça não rasteriza de forma confiável. */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nós — `Pose` é indexada por string; nó inexistente não gira, em silêncio.
 *    Os nomes humanoides são de propósito: o ciclo genérico do forge os anima.
 * ------------------------------------------------------------------ */

export const NOS_MERCADOR = {
  raiz: 'raiz',
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  barraca: 'barraca',
  cauda: 'cauda',
  bracoDir: 'bracoDir',
  bracoEsq: 'bracoEsq'
} as const;

export type NomeNoMercador = (typeof NOS_MERCADOR)[keyof typeof NOS_MERCADOR];

const P = PROPORCOES_MERCADOR;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

function peca(cor: CorMercador, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/** Sem contorno próprio — o padrão. Só silhueta externa traça outline: em 40px,
 *  traço em peça estreita vira mancha preta e come o miolo. */
function detalhe(cor: CorMercador, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/** O manto em sino, com os pés vermelhos aparecendo embaixo (I4). Três degraus:
 *  curva se faz com caixas escalonadas, nunca com uma. */
function criarQuadril(): No {
  return {
    nome: NOS_MERCADOR.quadril,
    pivo: [0, 0, 0],
    caixas: [
      detalhe('peleBase', [1.3, 1.6, 0.7], [-1.2, 0.9, 0.35]),
      detalhe('peleBase', [1.3, 1.6, 0.7], [1.2, 0.9, 0.35]),
      detalhe('garra', [1.3, 0.6, 0.5], [-1.2, 1.6, 0.25]),
      detalhe('garra', [1.3, 0.6, 0.5], [1.2, 1.6, 0.25]),
      peca('mantoSombra', [P.larguraBarra, 4.6, 1.4], [0, 0, 0.9]),
      peca('mantoBase', [P.larguraBarra - 0.8, 4.2, 2.0], [0, 0, 2.6]),
      peca('mantoBase', [P.larguraBarra - 1.6, 3.8, 2.0], [0, 0, 4.5]),
      detalhe('mantoMeio', [0.8, 0.6, 4.0], [0, -2.1, 3.0])
    ]
  };
}

/** Torso curvado sob o peso, com o cachecol claro fechando o pescoço. */
function criarTorso(): No {
  return {
    nome: NOS_MERCADOR.torso,
    pivo: [0, 0, P.zCintura],
    caixas: [
      peca('mantoBase', [P.larguraOmbro, 3.6, 3.0], [0, 0.2, 1.5]),
      peca('mantoLuz', [P.larguraOmbro + 0.5, 3.4, 1.1], [0, 0.1, 3.4]),
      detalhe('lenco', [2.6, 2.2, 0.8], [0, 0.5, 4.0]),
      /* mãos vermelhas juntas na frente do peito, como na referência */
      detalhe('peleBase', [1.8, 1.0, 1.0], [0, 2.0, 2.2]),
      detalhe('garra', [1.8, 0.5, 0.5], [0, 2.4, 1.9])
    ],
    filhos: [criarBarraca()]
  };
}

/**
 * A BARRACA (I2) e a LANTERNA (I3), nas costas — e as costas são −Y, porque
 * +Y é a frente. Tudo aqui é volume por FORA: caixa é opaca, e mercadoria
 * modelada "dentro" da barraca não existiria na imagem.
 *
 * O toldo é a peça mais larga do rig inteiro, de propósito: é ele que dá a
 * silhueta reconhecível, e é claro contra o manto escuro para separar à
 * primeira vista.
 */
function criarBarraca(): No {
  return {
    nome: NOS_MERCADOR.barraca,
    pivo: [0, -2.8, 2.4],
    caixas: [
      /* estrutura de madeira */
      peca('madeiraBase', [4.4, 2.4, 4.2], [0, 0, 2.1]),
      detalhe('madeiraLuz', [0.6, 0.6, 4.2], [-2.0, -1.0, 2.1]),
      detalhe('madeiraLuz', [0.6, 0.6, 4.2], [2.0, -1.0, 2.1]),
      /* toldo de lona: três degraus caindo para os lados */
      peca('lona', [5.6, 3.0, 0.8], [0, 0, 4.7]),
      detalhe('lonaSombra', [6.2, 2.4, 0.6], [0, -0.3, 4.2]),
      detalhe('lona', [4.8, 2.0, 0.6], [0, 0.2, 5.3]),
      /* mastro + lanterna acesa, projetados para cima e para a frente */
      detalhe('madeiraBase', [0.6, 0.6, 3.0], [-2.3, 0.6, 5.8]),
      detalhe('metal', [1.2, 1.2, 0.6], [-2.3, 1.4, 6.6]),
      detalhe('lenteAmbar', [1.0, 1.0, 1.0], [-2.3, 1.4, 5.9]),
      detalhe('metal', [1.2, 1.2, 0.5], [-2.3, 1.4, 5.3]),
      /* bugigangas penduradas: três volumes, não trinta */
      detalhe('metal', [1.2, 0.8, 1.2], [2.2, 0.7, 2.6]),
      detalhe('peleSombra', [0.8, 0.7, 0.9], [2.3, 0.7, 1.4]),
      detalhe('madeiraLuz', [0.9, 0.6, 0.9], [-2.2, 0.7, 1.6]),
      /* a placa com runas: faixa clara com uma listra escura no meio */
      detalhe('lona', [3.6, 0.6, 1.2], [0, 1.3, 0.9]),
      detalhe('mantoSombra', [2.6, 0.5, 0.5], [0, 1.5, 0.9])
    ]
  };
}

/**
 * A cabeça: capuz fundo, vão escuro AVANÇANDO além da face (senão o rosto some
 * no snap), focinho vermelho e as duas lentes gigantes acesas (I1).
 *
 * As lentes têm 1,3u — mais de 3px de arte cada. Foi medido contra a
 * alternativa de 0,8u: a 40px, lente pequena vira um pixel amarelo solto e a
 * criatura perde exatamente o que a torna reconhecível.
 */
function criarCabeca(): No {
  return {
    nome: NOS_MERCADOR.cabeca,
    pivo: [0, 0, P.zCabeca],
    caixas: [
      peca('mantoBase', [3.8, 3.6, 2.4], [0, -0.2, 1.3]),
      peca('mantoLuz', [3.2, 3.0, 0.9], [0, -0.2, 2.8]),
      detalhe('mantoMeio', [2.4, 1.2, 1.0], [0, 1.5, 2.4]),
      /* o vão escuro do rosto, avançando 0,2u além da testa do capuz */
      detalhe('vazio', [3.0, 0.8, 1.8], [0, 1.5, 1.1]),
      /* focinho vermelho saindo do vão */
      detalhe('peleBase', [1.4, 0.8, 0.8], [0, 1.9, 0.6]),
      /* as lentes: aro de metal + disco âmbar aceso, avançando sobre o vão */
      detalhe('metal', [P.lente + 0.3, 0.5, P.lente + 0.3], [-0.9, 1.85, 1.3]),
      detalhe('metal', [P.lente + 0.3, 0.5, P.lente + 0.3], [0.9, 1.85, 1.3]),
      detalhe('lenteAmbar', [P.lente, 0.5, P.lente], [-0.9, 2.05, 1.3]),
      detalhe('lenteAmbar', [P.lente, 0.5, P.lente], [0.9, 2.05, 1.3])
    ]
  };
}

/** A cauda (I5): três caixas decrescentes descrevendo o arco por trás (−Y). */
function criarCauda(): No {
  return {
    nome: NOS_MERCADOR.cauda,
    pivo: [1.4, -1.8, 1.2],
    caixas: [
      detalhe('peleSombra', [1.0, 1.6, 1.0], [0, 0, 0]),
      detalhe('peleBase', [0.9, 1.4, 0.9], [0.7, -1.2, 0.5]),
      detalhe('peleLuz', [0.7, 1.1, 0.7], [1.2, -2.2, 1.3])
    ]
  };
}

/** Braços dentro das mangas; a mão vermelha vem do torso (elas estão juntas
 *  na frente do peito, como na referência), então aqui a manga fecha escura. */
function criarBraco(lado: 1 | -1): No {
  return {
    nome: lado > 0 ? NOS_MERCADOR.bracoDir : NOS_MERCADOR.bracoEsq,
    pivo: [-lado * (P.larguraOmbro / 2 + 0.3), 0, P.zOmbro],
    caixas: [
      detalhe('mantoBase', [1.5, 1.7, 2.8], [0, 0.4, -1.4]),
      detalhe('mantoMeio', [1.3, 1.5, 0.8], [0, 0.8, -3.0]),
      detalhe('vazio', [1.0, 1.1, 0.5], [0, 1.0, -3.5])
    ]
  };
}

/**
 * Monta uma árvore NOVA. A ordem dos filhos é o desempate determinístico da
 * ordem do pintor (§4.4): manto e torso (que carrega a barraca nas costas)
 * antes da cabeça, e a cauda por último porque ela cruza a silhueta.
 */
export function criarModeloMercador(): No {
  return {
    nome: NOS_MERCADOR.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarQuadril(), criarTorso(), criarCabeca(), criarBraco(1), criarBraco(-1), criarCauda()]
  };
}

/** O rig canônico do Mercador. Não mute. */
export const MODELO_MERCADOR: No = criarModeloMercador();

/**
 * Repouso: curvado sob o peso da barraca, cabeça baixa (é a inclinação do
 * capuz que aponta as lentes para quem chega) e braços recolhidos à frente.
 * A pose é aditiva — o respiro do ciclo `parado` soma sobre ela.
 */
export const POSE_PARADA_MERCADOR: Pose = {
  [NOS_MERCADOR.torso]: { rx: (12 * Math.PI) / 180 },
  [NOS_MERCADOR.cabeca]: { rx: (6 * Math.PI) / 180 },
  [NOS_MERCADOR.bracoDir]: { rx: (14 * Math.PI) / 180, ry: (12 * Math.PI) / 180 },
  [NOS_MERCADOR.bracoEsq]: { rx: (14 * Math.PI) / 180, ry: (-12 * Math.PI) / 180 },
  [NOS_MERCADOR.cauda]: { rx: (-18 * Math.PI) / 180 }
};
