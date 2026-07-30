/*
 * ISOROGUE — src/render/characters/mercador.ts
 *
 * O rig do MERCADOR: o NPC que nasce perto da escada de cada andar e compra os
 * despojos do herói (fase 2 do sistema de itens). Ele não luta, não persegue e
 * não anda — está POSTO, ao lado da própria tralha, esperando.
 *
 * Mesmo molde dos rigs de personagem (`./warrior`, `./goblin`, `./slime`,
 * `./ogre`) e os mesmos limites: é a fonte da verdade da FORMA e da COR, e
 * nada mais. Não projeta, não rasteriza, não conhece Canvas, preço nem bolsa.
 *
 * OS TRÊS TRAÇOS DE IDENTIDADE (perder um é perder o personagem):
 *
 *   I1  O CAPUZ FUNDO com o rosto no escuro e dois olhos acesos no vão. É o
 *       que diz "figura da masmorra" em vez de "aldeão". A cor do olho é
 *       EMISSIVA: no corredor escuro, o que o jogador vê primeiro — e o que o
 *       faz caminhar até lá — são os dois pontos verdes;
 *   I2  A CORCOVA DO FARDO nas costas, alta e volumosa, com alças cruzando o
 *       peito. É o que diz mercador ambulante e não monge;
 *   I3  O MANTO ATÉ O CHÃO, sem pernas visíveis. Ele não caminha: a silhueta
 *       fecha num sino apoiado no piso, e é isso que o separa de todo o resto
 *       do elenco, que tem perna e bota.
 *
 * ESCALA: **15u de altura** — entre o Goblin (13u) e o Guerreiro (18u). Como
 * ele é curvado sob o fardo, lê como baixo mesmo sendo alto; a corcova sobe
 * acima da declarada, e isso é construção, não erro (o mesmo acontece com a
 * crista do Ogro e a antena do Slime).
 *
 * AS DUAS REGRAS QUE ESTE ARQUIVO RESPEITA POR TEREM CUSTADO CARO HOJE
 * (ver [[o-frasco-que-nao-tinha-gosma]]):
 *   1. caixa é OPACA — o conteúdo tem de ser a SUPERFÍCIE. O fardo se lê pelo
 *      volume e pelas alças, nunca por tralha modelada "dentro" dele;
 *   2. nada abaixo de `PROPORCOES_MERCADOR.espessuraMinima` (0,5u ≈ 1,25px de
 *      arte): peça mais fina que isso some em algumas das oito direções e
 *      deixa buraco por onde o fundo vaza.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta — própria, não herdada de nenhum bicho
 *
 * O mercador não é do bestiário: ele não podia sair verde de goblin nem
 * cinza de ogro. O manto é um roxo-terroso escurecido (tecido gasto de quem
 * anda muito), o couro é o mesmo território de material que o resto do jogo
 * usa para couro, e o olho é um verde-veneno EMISSIVO — deliberadamente
 * diferente do vermelho-brasa do Goblin e do âmbar do Slime, para que a
 * silhueta acesa no escuro seja identificável antes de o sprite ser legível.
 * ------------------------------------------------------------------ */

export const PALETA_MERCADOR = {
  mantoLuz: '#6b5a86',    // topo dos ombros e do capuz
  mantoBase: '#4e4064',   // massa do manto
  mantoMeio: '#382e49',   // faces laterais
  mantoSombra: '#241d31', // barra do manto, vãos, o vão do capuz
  couroLuz: '#8d6a3c',    // topo do fardo e das alças
  couroBase: '#6b4f2a',   // corpo do fardo
  couroSombra: '#45311a', // face escura do fardo
  panoLuz: '#b9a888',     // trouxas claras amarradas no fardo
  panoBase: '#8a7c62',    // sombra do pano
  metal: '#a9b4c1',       // as fivelas e a balança pendurada
  olhoVeneno: '#7dffb0',  // EMISSIVA — os dois olhos no vão do capuz (I1)
  vazio: '#151120',       // interior do capuz, vãos
  contorno: '#0d0a14'     // outline
} as const;

export type CorMercador = keyof typeof PALETA_MERCADOR;

/* ------------------------------------------------------------------ *
 * 2. Rampas de quantização
 *
 * O fator de luz da face escolhe o degrau mais próximo dentro da rampa do
 * material (§4.3) — é o que mantém a paleta curta e a cara de arte desenhada.
 *
 * `veneno` tem UM tom, de propósito: cor emissiva precisa sobreviver INTEIRA
 * ao snap. Dividindo rampa com outro material, o degrau vizinho cobriria o
 * pixel e não sobraria emissivo nenhum para o forge recolar por cima do
 * escurecimento — a armadilha registrada em [[bestiario-monstros]].
 * ------------------------------------------------------------------ */

export const RAMPAS_MERCADOR = {
  manto: ['mantoLuz', 'mantoBase', 'mantoMeio', 'mantoSombra'],
  couro: ['couroLuz', 'couroBase', 'couroSombra', 'vazio'],
  pano: ['panoLuz', 'panoBase', 'couroSombra', 'vazio'],
  metal: ['metal', 'panoBase', 'couroSombra', 'vazio'],
  veneno: ['olhoVeneno'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorMercador[]>;

export const RAMPA_DA_COR_MERCADOR = {
  mantoLuz: 'manto',
  mantoBase: 'manto',
  mantoMeio: 'manto',
  mantoSombra: 'manto',
  couroLuz: 'couro',
  couroBase: 'couro',
  couroSombra: 'couro',
  panoLuz: 'pano',
  panoBase: 'pano',
  metal: 'metal',
  olhoVeneno: 'veneno',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorMercador, keyof typeof RAMPAS_MERCADOR>;

/** As cores que IGNORAM a modulação de luz (§1.1): os olhos no vão do capuz. */
export const CORES_EMISSIVAS_MERCADOR: readonly CorMercador[] = ['olhoVeneno'];

/* ------------------------------------------------------------------ *
 * 3. Proporções — os números que decidem a silhueta, num lugar só
 * ------------------------------------------------------------------ */

export const PROPORCOES_MERCADOR = {
  /** Altura declarada do corpo (a corcova do fardo passa disso, de propósito). */
  altura: 15.0,
  /** Largura da barra do manto, no chão. O sino que substitui as pernas (I3). */
  larguraBarra: 6.4,
  /** Largura na altura dos ombros. */
  larguraOmbro: 5.2,
  /** Onde termina o manto e começa o torso. */
  zCintura: 6.5,
  /** Altura dos ombros — o pivô dos braços. */
  zOmbro: 10.6,
  /** Altura da base do capuz. */
  zCabeca: 11.6,
  /**
   * O PISO DE ESPESSURA, em `u`. ~2,5px de arte por `u`: peça mais fina que
   * isto não rasteriza de forma confiável, some em parte das oito direções e
   * deixa buraco. Aprendido no frasco de gosma, em três rodadas de bancada.
   */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nomes dos nós — chaves estáveis de `Pose`
 *
 * `Pose` é indexada por STRING: nó que não existe simplesmente não gira, em
 * silêncio. Os nomes seguem os dos humanoides do elenco de propósito — o
 * ciclo genérico do forge anima `torso`, `cabeca`, `bracoDir` e `bracoEsq`, e
 * um mercador que respira de leve sai de graça.
 * ------------------------------------------------------------------ */

export const NOS_MERCADOR = {
  raiz: 'raiz',
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  fardo: 'fardo',
  bracoDir: 'bracoDir',
  bracoEsq: 'bracoEsq'
} as const;

export type NomeNoMercador = (typeof NOS_MERCADOR)[keyof typeof NOS_MERCADOR];

const P = PROPORCOES_MERCADOR;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

/** Caixa COM contorno de silhueta própria (§4.1). */
function peca(cor: CorMercador, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Caixa SEM contorno próprio (§4.5) — o padrão deste rig, como em todos os
 * outros. Só traça outline a peça que faz SILHUETA EXTERNA: capuz, ombros do
 * manto e fardo. O interior se lê por COR contra a peça vizinha; outline
 * demais vira mancha preta a 40px, que é a regra medida do projeto.
 */
function detalhe(cor: CorMercador, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * O manto: o sino que substitui as pernas (I3). Três degraus de largura
 * decrescente da barra até a cintura — curva se faz com caixas escalonadas,
 * nunca com uma só, senão a 40px lê como caixa de papelão.
 */
function criarQuadril(): No {
  return {
    nome: NOS_MERCADOR.quadril,
    pivo: [0, 0, 0],
    caixas: [
      peca('mantoSombra', [P.larguraBarra, P.larguraBarra * 0.8, 1.6], [0, 0, 0.8]),
      peca('mantoBase', [P.larguraBarra - 0.9, P.larguraBarra * 0.8 - 0.9, 2.4], [0, 0, 2.8]),
      peca('mantoBase', [P.larguraBarra - 1.8, P.larguraBarra * 0.8 - 1.6, 2.4], [0, 0, 5.2]),
      /* prega central: uma faixa mais escura que quebra o campo chapado do
       * manto sem precisar de outline interno */
      detalhe('mantoMeio', [0.7, 0.6, 4.6], [0, -P.larguraBarra * 0.4 + 0.3, 3.2])
    ]
  };
}

/**
 * O torso, curvado sob o peso: mais estreito que o manto e recuado em Y, o que
 * inclina a leitura para a frente sem precisar girar nó nenhum.
 */
function criarTorso(): No {
  return {
    nome: NOS_MERCADOR.torso,
    pivo: [0, 0, P.zCintura],
    caixas: [
      peca('mantoBase', [P.larguraOmbro, 4.0, 3.4], [0, 0.2, 1.7]),
      /* ombros: as duas peças que fecham a silhueta em cima */
      peca('mantoLuz', [P.larguraOmbro + 0.4, 3.6, 1.2], [0, 0.1, 3.7]),
      /* alças do fardo cruzando o peito (I2): elas são o que amarra a corcova
       * ao corpo — sem elas o fardo lê como corcunda, não como bagagem */
      detalhe('couroBase', [0.8, 0.6, 4.2], [-1.5, -1.9, 2.2]),
      detalhe('couroBase', [0.8, 0.6, 4.2], [1.5, -1.9, 2.2]),
      detalhe('metal', [0.9, 0.55, 0.6], [-1.5, -2.0, 2.6]),
      detalhe('metal', [0.9, 0.55, 0.6], [1.5, -2.0, 2.6])
    ],
    filhos: [criarFardo()]
  };
}

/**
 * O FARDO (I2): a corcova nas costas (+Y é a frente, então as costas são −Y).
 * Três volumes escalonados mais duas trouxas de pano: é o volume e a variação
 * de material que dizem "tralha", nunca o miolo — caixa é opaca e o que está
 * dentro não existe.
 */
function criarFardo(): No {
  return {
    nome: NOS_MERCADOR.fardo,
    pivo: [0, -2.6, 3.0],
    caixas: [
      peca('couroBase', [4.6, 2.8, 3.6], [0, 0, 1.4]),
      peca('couroLuz', [3.8, 2.4, 1.4], [0, 0.1, 3.6]),
      detalhe('couroSombra', [4.2, 2.4, 0.8], [0, -0.1, 0.5]),
      /* trouxas amarradas em cima, em pano claro: o contraste de material é o
       * que impede a corcova de virar um bloco marrom só */
      detalhe('panoLuz', [1.6, 1.4, 1.2], [-1.1, 0, 4.7]),
      detalhe('panoBase', [1.4, 1.2, 1.0], [1.0, -0.2, 4.6]),
      /* a balança pendurada — o adereço que diz COMÉRCIO */
      detalhe('metal', [0.5, 0.5, 1.8], [2.3, 0.3, 2.2]),
      detalhe('metal', [1.4, 0.9, 0.5], [2.3, 0.3, 1.2])
    ]
  };
}

/**
 * A cabeça é o CAPUZ (I1): uma casca de manto em três degraus com o vão
 * frontal escuro e os dois olhos acesos dentro dele.
 *
 * O vão é uma caixa de `vazio` que AVANÇA 0,1u além da face frontal do capuz.
 * Sem esse avanço ela empataria com a casca e o snap poderia escolher o tom do
 * manto — o rosto acenderia de dia e sumiria de noite. Os olhos, por sua vez,
 * avançam mais 0,1u sobre o vão, pelo mesmo motivo elevado ao quadrado: eles
 * são emissivos e precisam existir como PIXEL para o forge extrair a camada.
 */
function criarCabeca(): No {
  return {
    nome: NOS_MERCADOR.cabeca,
    pivo: [0, 0, P.zCabeca],
    caixas: [
      peca('mantoBase', [3.6, 3.4, 2.2], [0, 0, 1.2]),
      peca('mantoLuz', [3.0, 2.8, 0.8], [0, 0, 2.6]),
      /* bico do capuz, caído para a frente: 2 degraus, a curva de sempre */
      detalhe('mantoMeio', [2.2, 1.0, 0.9], [0, 1.5, 2.2]),
      /* o vão escuro do rosto */
      detalhe('vazio', [2.4, 0.6, 1.4], [0, 1.6, 1.2]),
      /* os dois olhos emissivos, 0,5u cada (o piso de espessura) */
      detalhe('olhoVeneno', [0.5, 0.5, 0.5], [-0.7, 1.85, 1.3]),
      detalhe('olhoVeneno', [0.5, 0.5, 0.5], [0.7, 1.85, 1.3])
    ]
  };
}

/**
 * Braços dentro das mangas do manto: sem mão modelada, porque a mão fecharia
 * a silhueta num detalhe de 1px que a 40px vira ruído. A manga termina numa
 * boca escura, que é como a referência de figura encapuzada resolve isso.
 *
 * O pivô é `−lado · x`: o rig inteiro é autorado espelhado em X (§6.1), a
 * mesma convenção dos outros personagens.
 */
function criarBraco(lado: 1 | -1): No {
  return {
    nome: lado > 0 ? NOS_MERCADOR.bracoDir : NOS_MERCADOR.bracoEsq,
    pivo: [-lado * (P.larguraOmbro / 2 + 0.2), 0, P.zOmbro],
    caixas: [
      detalhe('mantoBase', [1.4, 1.6, 3.2], [0, 0.2, -1.6]),
      detalhe('mantoMeio', [1.2, 1.4, 0.8], [0, 0.3, -3.4]),
      detalhe('vazio', [0.9, 1.0, 0.5], [0, 0.4, -3.9])
    ]
  };
}

/**
 * Monta uma árvore NOVA do mercador. Chame isto (e não mute
 * `MODELO_MERCADOR`) sempre que precisar de um rig próprio.
 *
 * A ordem dos filhos é o desempate determinístico da ordem do pintor (§4.4):
 * manto e torso (que carrega o fardo nas costas) antes dos apêndices.
 */
export function criarModeloMercador(): No {
  return {
    nome: NOS_MERCADOR.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarQuadril(), criarTorso(), criarCabeca(), criarBraco(1), criarBraco(-1)]
  };
}

/** O rig canônico do Mercador, pronto para o sprite forge. Não mute. */
export const MODELO_MERCADOR: No = criarModeloMercador();

/**
 * A pose de repouso: ele está DEBRUÇADO sobre a própria bagagem, não em
 * sentido. O torso fecha 10° para a frente, a cabeça acompanha mais 8° (é o
 * capuz que se inclina, e é essa inclinação que faz os olhos apontarem para
 * quem chega) e os braços descansam levemente abertos, longe do tronco, para
 * não fundirem com o manto em nenhuma das oito direções.
 *
 * Nós ausentes ficam em rotação zero. Como o forge anima por NOME, esta pose é
 * aditiva: o respiro do ciclo `parado` soma sobre ela sem conflito.
 */
export const POSE_PARADA_MERCADOR: Pose = {
  [NOS_MERCADOR.torso]: { rx: (10 * Math.PI) / 180 },
  [NOS_MERCADOR.cabeca]: { rx: (8 * Math.PI) / 180 },
  [NOS_MERCADOR.bracoDir]: { rx: (6 * Math.PI) / 180, ry: (10 * Math.PI) / 180 },
  [NOS_MERCADOR.bracoEsq]: { rx: (6 * Math.PI) / 180, ry: (-10 * Math.PI) / 180 }
};
