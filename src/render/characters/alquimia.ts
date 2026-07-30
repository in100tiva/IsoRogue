/*
 * ISOROGUE — src/render/characters/alquimia.ts
 *
 * A ESTAÇÃO DE ALQUIMIA em três rigs, um por tile: caldeirão, estante e mesa.
 * Substitui a `./bancada` da rodada 1 (um móvel só), reprovada pelo dono, que
 * mandou como referência uma SALA de alquimia — caldeirão de caldo roxo,
 * estante de frascos coloridos e mesa com livro aberto e vela acesa.
 *
 * POR QUE TRÊS RIGS E NÃO UM GRANDE: o mundo é um grid isométrico de losangos
 * de 64×32px e o desenho é ordenado por antidiagonal. Um móvel de três tiles
 * de largura invadiria os vizinhos e romperia a ordem do pintor — o defeito
 * que o cofre já registra como pendência ("sprites invadem o tile vizinho").
 * Três peças, três tiles, três âncoras: cada uma desenha no seu lugar, com a
 * profundidade certa, e o conjunto lê como uma instalação. O engine reserva os
 * três tiles (`game.bancada` é o caldeirão, o tile de interação, e
 * `game.alquimiaExtras` guarda estante e mesa).
 *
 * TRAÇOS DE IDENTIDADE:
 *   I1  o CALDO ROXO ACESO na boca do caldeirão — emissivo, é o que anuncia a
 *       oficina num cômodo escuro;
 *   I2  a ESTANTE com frascos coloridos alinhados, alta e encostada;
 *   I3  o LIVRO ABERTO e a VELA ACESA na mesa — é o que diz "alguém trabalha
 *       aqui" em vez de "isto é entulho".
 *
 * AS TRÊS REGRAS QUE ESTE ARQUIVO OBEDECE POR TEREM CUSTADO CARO HOJE:
 *   1. **caixa é OPACA: o conteúdo é a SUPERFÍCIE**. O caldo NÃO está dentro
 *      da panela — ele É a laje do topo, com a borda de pedra em volta. Frasco
 *      não tem líquido dentro: o CORPO do frasco já é a cor do líquido;
 *   2. **nada abaixo de 0,5u** (~1,25px de arte) — por isso são três frascos
 *      por prateleira, não seis: três que existem valem mais que seis que
 *      piscam entre direções;
 *   3. **o que está embaixo só existe se sobrar para fora** — as brasas do
 *      caldeirão transbordam a barriga, senão a panela as engole (erro real,
 *      corrigido na bancada da rodada 1).
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta — uma só para os três rigs (eles são um conjunto)
 * ------------------------------------------------------------------ */

export const PALETA_ALQUIMIA = {
  madeiraLuz: '#7a5b3a',   // quinas da estante e da mesa
  madeiraBase: '#5a4128',  // madeira em geral
  madeiraMeio: '#43301c',  // faces laterais
  madeiraSombra: '#2b1e12', // vãos e pés
  pedraLuz: '#7e7a86',     // topo da borda do caldeirão
  pedraBase: '#5c5866',    // corpo do caldeirão
  pedraSombra: '#3b384a',  // base e faces afastadas
  metal: '#a9b4c1',        // aros e a haste da colher
  papel: '#e8dfc4',        // as páginas do livro aberto (I3)
  papelSombra: '#b9ad8c',  // a lombada e a sombra da página
  cera: '#d8cbb2',         // a vela
  caldoRoxo: '#c264ff',    // EMISSIVA — o caldo do caldeirão (I1)
  frascoVerde: '#6ee27a',  // EMISSIVA — frasco de prateleira
  frascoAzul: '#5fc8ff',   // EMISSIVA — frasco de prateleira
  chama: '#ffb340',        // EMISSIVA — a chama da vela (I3)
  vazio: '#160f1c',        // vãos e sombra interna
  contorno: '#0b0710'      // outline
} as const;

export type CorAlquimia = keyof typeof PALETA_ALQUIMIA;

/* ------------------------------------------------------------------ *
 * 2. Rampas — cada emissiva com rampa PRÓPRIA de um tom só, senão o snap da
 *    paleta a cobre com o degrau vizinho e não sobra pixel para o forge
 *    recolar aceso por cima do escurecimento.
 * ------------------------------------------------------------------ */

export const RAMPAS_ALQUIMIA = {
  madeira: ['madeiraLuz', 'madeiraBase', 'madeiraMeio', 'madeiraSombra'],
  pedra: ['pedraLuz', 'pedraBase', 'pedraSombra', 'vazio'],
  metal: ['metal', 'pedraLuz', 'pedraSombra', 'vazio'],
  papel: ['papel', 'papelSombra', 'madeiraMeio', 'madeiraSombra'],
  cera: ['cera', 'papelSombra', 'madeiraMeio', 'vazio'],
  roxo: ['caldoRoxo'],
  verde: ['frascoVerde'],
  azul: ['frascoAzul'],
  fogo: ['chama'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorAlquimia[]>;

export const RAMPA_DA_COR_ALQUIMIA = {
  madeiraLuz: 'madeira', madeiraBase: 'madeira', madeiraMeio: 'madeira', madeiraSombra: 'madeira',
  pedraLuz: 'pedra', pedraBase: 'pedra', pedraSombra: 'pedra',
  metal: 'metal', papel: 'papel', papelSombra: 'papel', cera: 'cera',
  caldoRoxo: 'roxo', frascoVerde: 'verde', frascoAzul: 'azul', chama: 'fogo',
  vazio: 'vazio', contorno: 'vazio'
} as const satisfies Record<CorAlquimia, keyof typeof RAMPAS_ALQUIMIA>;

/** O que acende no escuro: o caldo, os frascos e a chama da vela (§1.1). */
export const CORES_EMISSIVAS_ALQUIMIA: readonly CorAlquimia[] = [
  'caldoRoxo', 'frascoVerde', 'frascoAzul', 'chama'
];

/* ------------------------------------------------------------------ *
 * 3. Proporções
 * ------------------------------------------------------------------ */

export const PROPORCOES_ALQUIMIA = {
  /** Caldeirão: 5,0u de altura, 4,6u de barriga. É o tile de interação. */
  caldeiraoAltura: 5.0,
  caldeiraoBarriga: 4.6,
  /** Estante: alta e rasa, como quem está encostada na parede. */
  estanteAltura: 7.0,
  estanteLargura: 5.0,
  estanteFundo: 2.4,
  /** Mesa: baixa e larga. */
  mesaAltura: 3.4,
  mesaLargura: 5.0,
  mesaFundo: 3.4,
  /** Limite de planta por tile: o losango é 64×32px e ~2,5px de arte por `u`. */
  larguraMaxima: 6.0,
  /** ~2,5px de arte por `u`: abaixo disto a peça não rasteriza de forma confiável. */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nós — `Pose` é indexada por string; nó inexistente não gira, em silêncio.
 * ------------------------------------------------------------------ */

export const NOS_ALQUIMIA = {
  raiz: 'raiz',
  caldeirao: 'caldeirao',
  estante: 'estante',
  mesa: 'mesa'
} as const;

export type NomeNoAlquimia = (typeof NOS_ALQUIMIA)[keyof typeof NOS_ALQUIMIA];

const P = PROPORCOES_ALQUIMIA;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

function peca(cor: CorAlquimia, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/** Sem contorno próprio — o padrão; só silhueta externa traça outline. */
function detalhe(cor: CorAlquimia, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * O CALDEIRÃO (I1). Barriga em três degraus (curva se faz com caixas
 * escalonadas), caldo roxo como LAJE DO TOPO — nunca "dentro" —, colher de
 * madeira saindo na diagonal e brasas que TRANSBORDAM a barriga para não
 * serem engolidas por ela.
 */
function criarCaldeiraoNo(): No {
  const b = P.caldeiraoBarriga;
  return {
    nome: NOS_ALQUIMIA.caldeirao,
    pivo: [0, 0, 0],
    caixas: [
      /* brasas primeiro (ficam atrás na ordem do pintor) e mais largas que a
       * panela, senão desaparecem sob ela */
      detalhe('pedraSombra', [b + 0.6, b * 0.8 + 0.6, 0.6], [0, 0, 0.3]),
      /* A brasa é um DETALHE, não um palco: na rodada 1 ela era tão larga e
       * alta quanto a panela e virou uma plataforma laranja que roubava a
       * leitura do caldo (I1). Ficou só a língua de fogo que escapa pela
       * frente (+Y) — o bastante para acender no escuro, pouco para competir. */
      detalhe('chama', [1.8, 1.0, 0.5], [0, b * 0.42, 0.55]),
      detalhe('chama', [0.9, 0.7, 0.5], [-1.5, b * 0.30, 0.55]),
      /* barriga: três degraus */
      peca('pedraSombra', [b - 1.4, b * 0.8 - 1.2, 0.8], [0, 0, 1.2]),
      peca('pedraBase', [b, b * 0.8, 1.8], [0, 0, 2.5]),
      peca('pedraLuz', [b - 0.4, b * 0.8 - 0.4, 0.6], [0, 0, 3.6]),
      /* o CALDO: a laje roxa que É o conteúdo */
      detalhe('caldoRoxo', [b - 1.4, b * 0.8 - 1.4, 0.6], [0, 0, 3.9]),
      /* colher de madeira apoiada na borda, saindo na diagonal */
      detalhe('madeiraBase', [0.6, 0.6, 3.2], [1.3, -0.9, 4.4]),
      detalhe('madeiraLuz', [0.8, 0.8, 0.6], [1.5, -1.2, 5.9])
    ]
  };
}

/**
 * A ESTANTE (I2): duas colunas, três prateleiras e três frascos por prateleira
 * — o corpo do frasco JÁ é a cor do líquido, porque líquido dentro de vidro
 * opaco não existe na imagem. Frascos de 0,7u: acima do piso de espessura, e
 * três por nível em vez de seis, que a 40px virariam serrilha.
 */
function criarEstanteNo(): No {
  const L = P.estanteLargura;
  const F = P.estanteFundo;
  const prateleira = (z: number, a: CorAlquimia, b: CorAlquimia, c: CorAlquimia): Caixa[] => [
    peca('madeiraBase', [L, F, 0.5], [0, 0, z]),
    detalhe(a, [0.7, 0.8, 1.1], [-1.4, 0.35, z + 0.8]),
    detalhe(b, [0.7, 0.8, 0.9], [0, 0.35, z + 0.7]),
    detalhe(c, [0.7, 0.8, 1.2], [1.4, 0.35, z + 0.85]),
    detalhe('metal', [0.7, 0.6, 0.5], [-1.4, 0.35, z + 1.5]),
    detalhe('metal', [0.7, 0.6, 0.5], [1.4, 0.35, z + 1.6])
  ];
  return {
    nome: NOS_ALQUIMIA.estante,
    pivo: [0, 0, 0],
    caixas: [
      /* fundo e colunas: a silhueta externa da estante */
      /* O FUNDO fica em −Y: +Y é a FRENTE do rig. Na rodada 1 ele estava em
       * +Y e tapava as três prateleiras inteiras — os frascos existiam no
       * modelo e não existiam na imagem, que é o mesmo erro do frasco de
       * gosma por outro caminho. */
      peca('madeiraMeio', [L, 0.6, P.estanteAltura], [0, -F / 2 + 0.3, P.estanteAltura / 2]),
      peca('madeiraBase', [0.7, F, P.estanteAltura], [-L / 2 + 0.35, 0, P.estanteAltura / 2]),
      peca('madeiraBase', [0.7, F, P.estanteAltura], [L / 2 - 0.35, 0, P.estanteAltura / 2]),
      /* três prateleiras, cada uma com sua trinca de frascos */
      ...prateleira(0.6, 'frascoVerde', 'caldoRoxo', 'frascoAzul'),
      ...prateleira(2.8, 'frascoAzul', 'frascoVerde', 'caldoRoxo'),
      ...prateleira(5.0, 'caldoRoxo', 'frascoAzul', 'frascoVerde'),
      /* tampo, fechando por cima */
      detalhe('madeiraLuz', [L + 0.4, F + 0.3, 0.5], [0, 0, P.estanteAltura - 0.25])
    ]
  };
}

/**
 * A MESA (I3): tampo sobre quatro pés, com o LIVRO ABERTO (duas páginas
 * inclinadas por escalonamento, não por rotação — o rig não gira caixa por
 * peça), a VELA acesa e dois frascos pequenos.
 */
function criarMesaNo(): No {
  const L = P.mesaLargura;
  const F = P.mesaFundo;
  const h = P.mesaAltura;
  const pe = (x: number, y: number): Caixa =>
    detalhe('madeiraMeio', [0.6, 0.6, h - 0.5], [x, y, (h - 0.5) / 2]);
  return {
    nome: NOS_ALQUIMIA.mesa,
    pivo: [0, 0, 0],
    caixas: [
      pe(-L / 2 + 0.5, -F / 2 + 0.5),
      pe(L / 2 - 0.5, -F / 2 + 0.5),
      pe(-L / 2 + 0.5, F / 2 - 0.5),
      pe(L / 2 - 0.5, F / 2 - 0.5),
      /* tampo */
      peca('madeiraBase', [L, F, 0.6], [0, 0, h - 0.3]),
      detalhe('madeiraLuz', [L - 0.6, F - 0.6, 0.5], [0, 0, h + 0.05]),
      /* livro aberto: lombada escura + duas páginas escalonadas */
      detalhe('madeiraSombra', [0.6, 1.8, 0.5], [-0.4, 0.2, h + 0.35]),
      detalhe('papel', [1.4, 1.8, 0.5], [-1.2, 0.2, h + 0.4]),
      detalhe('papel', [1.4, 1.8, 0.6], [0.4, 0.2, h + 0.45]),
      detalhe('papelSombra', [1.2, 1.4, 0.5], [0.4, 0.2, h + 0.6]),
      /* vela acesa, à direita do livro */
      detalhe('cera', [0.7, 0.7, 1.2], [1.7, -0.8, h + 0.9]),
      detalhe('chama', [0.6, 0.6, 0.7], [1.7, -0.8, h + 1.8]),
      /* dois frascos pequenos: o corpo é o líquido */
      detalhe('frascoAzul', [0.7, 0.7, 0.9], [-1.8, -1.0, h + 0.75]),
      detalhe('frascoVerde', [0.7, 0.7, 0.8], [-1.0, -1.1, h + 0.7])
    ]
  };
}

/* ------------------------------------------------------------------ *
 * 6. As três árvores. Cada uma nasce na própria raiz porque cada uma é
 *    desenhada num TILE diferente, com âncora própria em z = 0.
 * ------------------------------------------------------------------ */

export function criarModeloCaldeirao(): No {
  return { nome: NOS_ALQUIMIA.raiz, pivo: [0, 0, 0], caixas: [], filhos: [criarCaldeiraoNo()] };
}

export function criarModeloEstante(): No {
  return { nome: NOS_ALQUIMIA.raiz, pivo: [0, 0, 0], caixas: [], filhos: [criarEstanteNo()] };
}

export function criarModeloMesaAlquimia(): No {
  return { nome: NOS_ALQUIMIA.raiz, pivo: [0, 0, 0], caixas: [], filhos: [criarMesaNo()] };
}

/** Os rigs canônicos. Não mute. */
export const MODELO_CALDEIRAO: No = criarModeloCaldeirao();
export const MODELO_ESTANTE: No = criarModeloEstante();
export const MODELO_MESA_ALQUIMIA: No = criarModeloMesaAlquimia();

/** Mobília não articula: repouso vazio é legítimo, e a coluna ('parado', 0)
 *  do atlas devolve exatamente o objeto como foi modelado. */
export const POSE_PARADA_ALQUIMIA: Pose = {};
