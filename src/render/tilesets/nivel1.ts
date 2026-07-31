/*
 * ISOROGUE — src/render/tilesets/nivel1.ts
 *
 * O TILESET DO NÍVEL 1: "Ruínas Verdes". Blocos de terreno e adereços em 3D
 * pixel art por código, na mesma técnica de todo o elenco (rig de caixas
 * orientadas → projeção isométrica → rasterização em baixa resolução →
 * quantização numa paleta curta). Ver [[como-construir-um-personagem]].
 *
 * ESTE DIRETÓRIO É A ÚNICA CASA DOS TILESETS, um arquivo por nível. Quem for
 * fazer o nível 2 copia este molde, troca a paleta e os rigs, e acrescenta uma
 * linha em `./index.ts` — nada fora daqui precisa saber que existe terreno
 * novo. É a mesma disciplina de `RETRATOS` no bestiário: um ponto de extensão,
 * e nenhum `if` espalhado pelo renderer.
 *
 * ═══ A CALIBRAÇÃO, que é a única parte que não se chuta ═══
 *
 * A projeção do rig (§4.2 de `../model3d`) é
 *     artX = (x − y) · escala          (COS_ISO = 1)
 *     artY = (x + y) · escala · 0,5 − z · escala
 * com `escala = ART_POR_U = 2,5` px de arte por `u` (e `PIXEL = 1`, então px de
 * arte é px de tela).
 *
 * Um quadrado de lado **S** em planta tem `(x − y)` variando de −S a +S, logo
 * projeta **2 · S · 2,5 = 5S** px de largura; e `(x + y)` de 0 a 2S, logo
 * **2 · S · 1,25 = 2,5S** px de altura. O losango do mundo mede
 * `CONFIG.TW × CONFIG.TH` = **64 × 32 px**:
 *
 *     5S = 64   ⇒   S = 12,8u        (e 2,5 · 12,8 = 32 ✓ — a altura fecha sozinha)
 *
 * Daí `ladoDoTile = 12.8`. Errar isto por pouco produz costura branca entre
 * tiles (bloco menor) ou serrilha de sobreposição (bloco maior), e nenhum dos
 * dois se conserta depois no renderer.
 *
 * ═══ A ÂNCORA ═══
 *
 * O plano `z = 0` é o chão — é onde o herói e os monstros assentam. Portanto:
 *   · bloco de PISO: o topo fica em z = 0 e o corpo desce em −Z. O sprite é
 *     desenhado com a âncora no centro do losango, e tudo o que pisa nele
 *     continua assentando exatamente onde assentava com o losango pintado à mão;
 *   · bloco de PAREDE: sobe de z = 0 até `alturaParede` — é o mesmo volume que
 *     o `drawWall` geométrico ocupava, agora modelado;
 *   · ÁGUA: o topo afunda `afundamentoAgua` abaixo de zero, que é o que dá a
 *     leitura de poça e não de laje azul.
 *
 * ═══ AS TRÊS REGRAS QUE ESTE ARQUIVO OBEDECE POR TEREM CUSTADO CARO ═══
 * ([[o-frasco-que-nao-tinha-gosma]])
 *   1. caixa é OPACA — o conteúdo tem de ser a SUPERFÍCIE;
 *   2. nada abaixo de ~0,5u (~1,25px), senão a peça pisca entre direções e
 *      deixa buraco por onde o fundo vaza;
 *   3. o que está embaixo só existe se sobrar para fora.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta — amostrada da referência do dono
 * ------------------------------------------------------------------ */

export const PALETA_NIVEL1 = {
  gramaLuz: '#7ec850',    // tufos e quinas iluminadas do topo
  gramaBase: '#4fa832',   // o topo de grama
  gramaMeio: '#3b8527',   // faces de grama viradas para o lado
  gramaSombra: '#2a5f1c', // a linha de contato com a terra
  terraLuz: '#a4593a',    // topo de terra batida
  terraBase: '#8a4530',   // laterais dos blocos
  terraMeio: '#6b3423',   // faces afastadas
  terraSombra: '#40201a', // base do bloco, vãos
  areiaLuz: '#f0d9a0',    // topo de areia
  areiaBase: '#d9b271',   // marcas e ondulações
  areiaSombra: '#a97f45', // laterais de areia
  aguaEspuma: '#e8f7ff',  // a espuma branca da superfície agitada
  aguaLuz: '#5fc8ff',     // o azul claro do topo
  aguaBase: '#2b8fd8',    // corpo da água
  aguaFundo: '#17558f',   // laterais e profundidade
  pedraLuz: '#9aa2ad',    // topo da pedra
  pedraBase: '#6d757f',   // corpo da pedra
  petala: '#f2f2ea',      // as flores brancas
  miolo: '#ffd94a',       // o miolo amarelo das flores
  frutoLaranja: '#ff9a2b', // EMISSIVA — a flor/fruto que acende no escuro
  tijoloLuz: '#d99a63',   // fiada de tijolo batida pela luz
  tijoloBase: '#bd7846',  // o tijolo
  tijoloSombra: '#8c5230', // fiada na sombra
  argamassa: '#6b4028',   // a junta entre tijolos
  lajotaLuz: '#f2ece0',   // a lajota polida do caminho
  lajotaBase: '#d9d2c4',  // face lateral da lajota
  lajotaJunta: '#a89f8d', // as juntas em grade
  turquesa: '#3fd0c0',    // as florzinhas azul-turquesa da referência
  turquesaLuz: '#a8f5ec', // o miolo claro delas
  contorno: '#2a1b12'     // o outline escuro entre blocos da referência
} as const;

export type CorNivel1 = keyof typeof PALETA_NIVEL1;

/* ------------------------------------------------------------------ *
 * 2. Rampas — `laranja` tem UM tom porque emissiva precisa sobreviver
 *    inteira ao snap (dividindo rampa, o degrau vizinho a cobre e não sobra
 *    pixel aceso para o forge recolar).
 * ------------------------------------------------------------------ */

export const RAMPAS_NIVEL1 = {
  grama: ['gramaLuz', 'gramaBase', 'gramaMeio', 'gramaSombra'],
  terra: ['terraLuz', 'terraBase', 'terraMeio', 'terraSombra'],
  areia: ['areiaLuz', 'areiaBase', 'areiaSombra', 'terraSombra'],
  agua: ['aguaLuz', 'aguaBase', 'aguaFundo', 'contorno'],
  espuma: ['aguaEspuma', 'aguaLuz', 'aguaBase', 'aguaFundo'],
  pedra: ['pedraLuz', 'pedraBase', 'terraMeio', 'terraSombra'],
  petala: ['petala', 'areiaBase', 'terraMeio', 'terraSombra'],
  miolo: ['miolo', 'areiaBase', 'terraMeio', 'terraSombra'],
  laranja: ['frutoLaranja'],
  tijolo: ['tijoloLuz', 'tijoloBase', 'tijoloSombra', 'argamassa'],
  argamassa: ['argamassa', 'tijoloSombra', 'terraSombra', 'contorno'],
  lajota: ['lajotaLuz', 'lajotaBase', 'lajotaJunta', 'terraSombra'],
  turquesa: ['turquesaLuz', 'turquesa', 'gramaMeio', 'gramaSombra'],
  vazio: ['contorno', 'contorno', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorNivel1[]>;

export const RAMPA_DA_COR_NIVEL1 = {
  gramaLuz: 'grama', gramaBase: 'grama', gramaMeio: 'grama', gramaSombra: 'grama',
  terraLuz: 'terra', terraBase: 'terra', terraMeio: 'terra', terraSombra: 'terra',
  areiaLuz: 'areia', areiaBase: 'areia', areiaSombra: 'areia',
  aguaEspuma: 'espuma', aguaLuz: 'agua', aguaBase: 'agua', aguaFundo: 'agua',
  pedraLuz: 'pedra', pedraBase: 'pedra',
  petala: 'petala', miolo: 'miolo', frutoLaranja: 'laranja',
  tijoloLuz: 'tijolo', tijoloBase: 'tijolo', tijoloSombra: 'tijolo', argamassa: 'argamassa',
  lajotaLuz: 'lajota', lajotaBase: 'lajota', lajotaJunta: 'lajota',
  turquesa: 'turquesa', turquesaLuz: 'turquesa',
  contorno: 'vazio'
} as const satisfies Record<CorNivel1, keyof typeof RAMPAS_NIVEL1>;

/** O fruto laranja acende no escuro, como as brasas da alquimia (§1.1). */
export const CORES_EMISSIVAS_NIVEL1: readonly CorNivel1[] = ['frutoLaranja'];

/* ------------------------------------------------------------------ *
 * 3. Proporções — os números da calibração, num lugar só
 * ------------------------------------------------------------------ */

export const PROPORCOES_NIVEL1 = {
  /** Lado do quadrado do tile, em `u`. Ver a conta no cabeçalho: 5S = TW. */
  ladoDoTile: 12.8,
  /** Espessura do bloco de piso (~10px de tela ÷ 2,5). */
  alturaPiso: 4.0,
  /** Altura do bloco de parede: `CONFIG.WALL_H` (36px) ÷ 2,5. */
  alturaParede: 14.4,
  /** Quanto o topo da água afunda abaixo do plano do chão (~3px). */
  afundamentoAgua: 1.2,
  /** Espessura das lajes de detalhe do topo (tufos, ondas, espuma). */
  detalheTopo: 0.6,
  /** ~2,5px de arte por `u`: abaixo disto a peça não rasteriza de forma confiável. */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nós — `Pose` é indexada por string; nó inexistente não gira, em silêncio.
 * ------------------------------------------------------------------ */

export const NOS_NIVEL1 = {
  raiz: 'raiz',
  bloco: 'bloco',
  adereco: 'adereco'
} as const;

export type NomeNoNivel1 = (typeof NOS_NIVEL1)[keyof typeof NOS_NIVEL1];

const P = PROPORCOES_NIVEL1;
const L = P.ladoDoTile;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

function peca(cor: CorNivel1, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Caixa sem contorno próprio — o padrão aqui. Só o CORPO do bloco traça
 * outline: é ele que produz a linha escura entre tiles da referência. Detalhe
 * de topo com contorno viraria uma grade preta sobre o terreno inteiro.
 */
function detalhe(cor: CorNivel1, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * As LÂMINAS DE GRAMA que sobem da borda do bloco e QUEBRAM A SILHUETA.
 *
 * É o traço número um da referência, e o que separa "cubo verde" de "torrão de
 * grama": o topo não termina numa aresta reta — dezenas de lâminas irregulares
 * passam do plano da superfície. Aqui elas são caixas finas (0,6u, acima do
 * piso de espessura) com ALTURA variada de 1 a 3u; a irregularidade vem da
 * altura, nunca da finura, porque abaixo de 0,5u a peça não rasteriza.
 *
 * `lado` diz qual borda recebe: as duas voltadas para a câmera (sul e leste em
 * espaço de rig, +Y e +X) ganham mais lâminas, porque são as únicas que a
 * projeção mostra de corpo inteiro — gastar caixa nas de trás é pagar por
 * pixel que o culling descarta.
 *
 * O padrão de alturas é FIXO e não aleatório: o render é proibido de sortear, e
 * um padrão declarado é reproduzível em toda tile do mapa.
 */
function laminasDeGrama(topoZ: number): Caixa[] {
  const meio = L / 2;
  const alturas = [2.4, 1.4, 2.9, 1.8, 2.2, 1.2, 2.6, 1.6, 2.0];
  const out: Caixa[] = [];
  /* borda +Y (a que fica de frente para a câmera, embaixo na tela) */
  for (let k = 0; k < 6; k++) {
    const h = alturas[k % alturas.length];
    const px = -meio + 1.2 + k * 2.1;
    out.push(detalhe(k % 2 === 0 ? 'gramaLuz' : 'gramaBase', [0.6, 0.7, h], [px, meio - 0.4, topoZ + h / 2 - 0.3]));
  }
  /* borda +X (a da direita na tela) */
  for (let k = 0; k < 6; k++) {
    const h = alturas[(k + 3) % alturas.length];
    const py = -meio + 1.5 + k * 2.1;
    out.push(detalhe(k % 2 === 0 ? 'gramaBase' : 'gramaLuz', [0.7, 0.6, h], [meio - 0.4, py, topoZ + h / 2 - 0.3]));
  }
  /* algumas no miolo, mais baixas: tiram o ar de "cerca viva" das bordas */
  out.push(detalhe('gramaMeio', [0.6, 0.6, 1.1], [-2.6, -1.4, topoZ + 0.25]));
  out.push(detalhe('gramaLuz', [0.6, 0.6, 1.4], [2.2, -3.0, topoZ + 0.4]));
  out.push(detalhe('gramaBase', [0.6, 0.6, 0.9], [0.4, 1.0, topoZ + 0.15]));
  return out;
}

/**
 * Os ESTRATOS e as RAÍZES da face de terra: faixas horizontais de tom diferente
 * descendo pela lateral, e fiapos escuros que escorrem do topo.
 *
 * Sem isso a lateral é um campo chapado de 4 a 14u — que é exatamente o que a
 * referência não tem e o nosso bloco tinha.
 */
function estratosDeTerra(topoZ: number, altura: number): Caixa[] {
  const meio = L / 2;
  const out: Caixa[] = [];
  const faixas = [0.28, 0.55, 0.78];
  for (let k = 0; k < faixas.length; k++) {
    const z = topoZ - altura * faixas[k];
    const cor: CorNivel1 = k === 1 ? 'terraLuz' : 'terraMeio';
    out.push(detalhe(cor, [L, L, 0.6], [0, 0, z]));
  }
  /* raízes: três fiapos curtos descendo da borda de cima, nas duas faces
   * visíveis (mais que isso vira listra) */
  out.push(detalhe('terraSombra', [0.6, 0.7, 1.8], [-3.2, meio - 0.3, topoZ - 1.4]));
  out.push(detalhe('terraSombra', [0.6, 0.7, 1.2], [1.8, meio - 0.3, topoZ - 1.1]));
  out.push(detalhe('terraSombra', [0.7, 0.6, 1.6], [meio - 0.3, -0.8, topoZ - 1.3]));
  return out;
}

/**
 * As FIADAS DE TIJOLO das duas faces visíveis: retângulos em relevo, deslocados
 * meio tijolo entre fiadas, com a junta escura aparecendo entre eles.
 *
 * Relevo POR FORA da face (caixa é opaca — tijolo "dentro" do bloco não
 * existiria na imagem), e três tijolos por fiada: a conta de 0,5u de piso de
 * espessura não deixa caber seis sem que metade pisque entre direções.
 */
function fiadasDeTijolo(topoZ: number, altura: number): Caixa[] {
  const meio = L / 2;
  const out: Caixa[] = [];
  const nFiadas = Math.max(2, Math.round(altura / 3.2));
  for (let f = 0; f < nFiadas; f++) {
    const z = topoZ - 1.4 - f * 3.0;
    if (z < topoZ - altura + 0.8) break;
    const desloca = f % 2 === 0 ? 0 : 2.1;
    const cor: CorNivel1 = f % 2 === 0 ? 'tijoloBase' : 'tijoloLuz';
    for (let k = 0; k < 3; k++) {
      const px = -meio + 2.2 + k * 4.2 + desloca;
      if (px > meio - 1.0) continue;
      out.push(detalhe(cor, [3.4, 0.7, 2.0], [px, meio - 0.35, z]));
      const py = -meio + 2.2 + k * 4.2 + desloca;
      if (py <= meio - 1.0) {
        out.push(detalhe(cor, [0.7, 3.4, 2.0], [meio - 0.35, py, z]));
      }
    }
  }
  return out;
}

/**
 * O corpo de um bloco: laje de topo com a cor do material e o volume abaixo
 * dela com a cor das laterais. É o esqueleto compartilhado pelos quatro pisos
 * e pela parede.
 *
 * `topoZ` é onde fica a SUPERFÍCIE (0 para piso, negativo para a água,
 * `alturaParede` para a parede) e `altura` é o quanto o volume desce a partir
 * dali.
 */
function corpoDeBloco(
  topo: CorNivel1, lateral: CorNivel1, base: CorNivel1, topoZ: number, altura: number
): Caixa[] {
  const lajeTopo = 1.2;
  return [
    /* o volume: é ele que faz a silhueta e traça o contorno entre tiles */
    peca(lateral, [L, L, altura - lajeTopo], [0, 0, topoZ - lajeTopo - (altura - lajeTopo) / 2]),
    /* a base, mais escura: dá peso e separa do bloco de baixo */
    detalhe(base, [L, L, 0.9], [0, 0, topoZ - altura + 0.45]),
    /* a laje do topo, na cor do material */
    peca(topo, [L, L, lajeTopo], [0, 0, topoZ - lajeTopo / 2])
  ];
}

/** Envelope comum: um nó `bloco` dentro da raiz, para todos os rigs do tileset. */
function comoRig(caixas: Caixa[]): No {
  return {
    nome: NOS_NIVEL1.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [{ nome: NOS_NIVEL1.bloco, pivo: [0, 0, 0], caixas: caixas }]
  };
}

/**
 * GRAMA — o piso mais comum. O que a referência tem e um bloco liso não teria:
 * **tufos claros pendurados nas bordas do topo**, que é o que faz a grama
 * "transbordar" a quina e separar visualmente um tile do outro sem depender do
 * contorno.
 */
export const MODELO_PISO_GRAMA: No = comoRig([
  ...corpoDeBloco('gramaBase', 'terraBase', 'terraSombra', 0, P.alturaPiso),
  ...estratosDeTerra(0, P.alturaPiso),
  /* manchas de tom no topo, para o verde não ser um campo chapado */
  detalhe('gramaMeio', [3.0, 2.2, P.detalheTopo], [-2.0, 2.4, 0.15]),
  detalhe('gramaLuz', [2.4, 1.8, P.detalheTopo], [2.6, -1.6, 0.15]),
  /* e as LÂMINAS: o traço nº 1 da referência, que quebra a silhueta */
  ...laminasDeGrama(0)
]);

/** TERRA — topo batido com pedriscos. */
export const MODELO_PISO_TERRA: No = comoRig([
  ...corpoDeBloco('terraLuz', 'terraBase', 'terraSombra', 0, P.alturaPiso),
  ...estratosDeTerra(0, P.alturaPiso),
  detalhe('terraBase', [2.6, 1.8, P.detalheTopo], [-2.4, -1.6, 0.15]),
  detalhe('terraBase', [1.8, 2.2, P.detalheTopo], [2.8, 1.4, 0.15]),
  detalhe('terraMeio', [1.4, 1.4, P.detalheTopo], [0.6, -3.2, 0.15])
]);

/** AREIA — topo claro com as marcas onduladas da referência. */
export const MODELO_PISO_AREIA: No = comoRig([
  ...corpoDeBloco('areiaLuz', 'areiaSombra', 'terraSombra', 0, P.alturaPiso),
  ...estratosDeTerra(0, P.alturaPiso),
  detalhe('areiaBase', [4.4, 1.0, P.detalheTopo], [-1.0, -2.0, 0.15]),
  detalhe('areiaBase', [3.2, 1.0, P.detalheTopo], [1.6, 1.2, 0.15]),
  detalhe('areiaBase', [1.0, 2.6, P.detalheTopo], [-3.4, 1.8, 0.15])
]);

/**
 * ÁGUA — o topo afunda `afundamentoAgua` (é poça, não laje) e a espuma branca
 * é uma laje POR CIMA da superfície, nunca "dentro" dela: caixa é opaca, e
 * espuma modelada sob a água não existiria na imagem.
 */
export const MODELO_PISO_AGUA: No = comoRig([
  ...corpoDeBloco('aguaLuz', 'aguaFundo', 'aguaFundo', -P.afundamentoAgua, P.alturaPiso - P.afundamentoAgua),
  detalhe('aguaBase', [L - 2.0, L - 2.0, P.detalheTopo], [0, 0, -P.afundamentoAgua + 0.2]),
  /* manchas de espuma: quatro lajes rasas, tamanhos diferentes */
  detalhe('aguaEspuma', [3.0, 1.2, P.detalheTopo], [-2.2, -1.8, -P.afundamentoAgua + 0.4]),
  detalhe('aguaEspuma', [2.0, 1.2, P.detalheTopo], [2.0, 0.6, -P.afundamentoAgua + 0.4]),
  detalhe('aguaEspuma', [1.2, 2.4, P.detalheTopo], [0.2, 2.6, -P.afundamentoAgua + 0.4]),
  detalhe('aguaEspuma', [1.2, 1.2, P.detalheTopo], [-3.0, 2.4, -P.afundamentoAgua + 0.4])
]);

/**
 * PAREDE — o barranco: o mesmo bloco, porém alto, com topo de grama e as
 * laterais de terra em camadas (a estratificação é o que impede uma parede de
 * 14u de virar um paralelepípedo marrom chapado).
 *
 * Ela sobe de z = 0 até `alturaParede`, ocupando o mesmo volume que o
 * `drawWall` geométrico ocupava — e continua sujeita ao sistema de
 * transparência do canto frontal: quem decide o alfa é o renderer, não o rig.
 */
export const MODELO_PAREDE_TERRA: No = comoRig([
  ...corpoDeBloco('gramaBase', 'terraBase', 'terraSombra', P.alturaParede, P.alturaParede),
  ...estratosDeTerra(P.alturaParede, P.alturaParede),
  /* as lâminas transbordam a quina do topo, como nos pisos: é o que faz o
   * barranco ler como terreno e não como caixote de terra */
  ...laminasDeGrama(P.alturaParede)
]);

/**
 * PAREDE DE TIJOLO — a alvenaria da referência: fiadas deslocadas meio tijolo,
 * junta escura, e grama transbordando o topo (o bloco mais bonito da imagem que
 * o dono mandou).
 *
 * Fica pronta em `paredeAlternativa` do tileset: o renderer ainda desenha só a
 * de terra, e o dia em que quiser alternar parede por sala é uma linha lá — o
 * rig já existe e já está revisado.
 */
export const MODELO_PAREDE_TIJOLO: No = comoRig([
  ...corpoDeBloco('gramaBase', 'tijoloBase', 'argamassa', P.alturaParede, P.alturaParede),
  ...fiadasDeTijolo(P.alturaParede, P.alturaParede),
  ...laminasDeGrama(P.alturaParede)
]);

/** PISO DE TIJOLO — a alvenaria rasa, sem grama: o pátio da referência. */
export const MODELO_PISO_TIJOLO: No = comoRig([
  ...corpoDeBloco('tijoloLuz', 'tijoloBase', 'argamassa', 0, P.alturaPiso),
  ...fiadasDeTijolo(0, P.alturaPiso),
  /* juntas no topo: duas linhas cruzadas de argamassa */
  detalhe('argamassa', [L - 1.0, 0.6, P.detalheTopo], [0, -1.2, 0.15]),
  detalhe('argamassa', [0.6, L - 1.0, P.detalheTopo], [1.4, 0, 0.15])
]);

/** PISO DE TIJOLO COM GRAMA — a alvenaria que a mata está retomando. */
export const MODELO_PISO_TIJOLO_GRAMA: No = comoRig([
  ...corpoDeBloco('gramaBase', 'tijoloBase', 'argamassa', 0, P.alturaPiso),
  ...fiadasDeTijolo(0, P.alturaPiso),
  /* o tijolo aparecendo por baixo da grama, num canto */
  detalhe('tijoloLuz', [4.2, 3.0, P.detalheTopo], [2.4, 2.6, 0.16]),
  ...laminasDeGrama(0)
]);

/**
 * LAJOTA — o caminho de pedra polida que corta a grama na referência: claro,
 * liso, com as juntas em grade. É o piso que diz "alguém construiu aqui".
 */
export const MODELO_PISO_LAJOTA: No = comoRig([
  ...corpoDeBloco('lajotaLuz', 'lajotaBase', 'lajotaJunta', 0, P.alturaPiso),
  /* a grade de juntas: duas linhas em cada eixo, formando nove lajotas */
  detalhe('lajotaJunta', [L, 0.6, P.detalheTopo], [0, -L / 6, 0.15]),
  detalhe('lajotaJunta', [L, 0.6, P.detalheTopo], [0, L / 6, 0.15]),
  detalhe('lajotaJunta', [0.6, L, P.detalheTopo], [-L / 6, 0, 0.15]),
  detalhe('lajotaJunta', [0.6, L, P.detalheTopo], [L / 6, 0, 0.15]),
  /* uma lajota mais gasta, para a grade não ficar perfeita demais */
  detalhe('lajotaBase', [3.0, 3.0, P.detalheTopo], [-3.0, 3.0, 0.16])
]);

/* ------------------------------------------------------------------ *
 * 6. Adereços — pequenos, ficam EM CIMA do bloco (z = 0 é a superfície do
 *    piso), e o renderer os sorteia por tile de forma determinística.
 * ------------------------------------------------------------------ */

/** TUFO de mato: três folhas pontudas, cada uma em dois degraus. */
export const MODELO_TUFO: No = comoRig([
  detalhe('gramaMeio', [1.0, 1.0, 1.6], [-0.9, 0.3, 0.8]),
  detalhe('gramaBase', [0.8, 0.8, 1.0], [-1.2, 0.3, 2.1]),
  detalhe('gramaBase', [1.0, 1.0, 2.2], [0.2, -0.4, 1.1]),
  detalhe('gramaLuz', [0.8, 0.8, 1.2], [0.3, -0.5, 2.8]),
  detalhe('gramaMeio', [1.0, 1.0, 1.4], [1.3, 0.5, 0.7]),
  detalhe('gramaBase', [0.8, 0.8, 0.9], [1.6, 0.6, 1.8])
]);

/** PEDRA: baixa e larga, dois degraus — a silhueta de seixo da referência. */
export const MODELO_PEDRA: No = comoRig([
  peca('pedraBase', [3.2, 2.6, 1.2], [0, 0, 0.6]),
  detalhe('pedraLuz', [2.2, 1.8, 0.7], [-0.3, -0.2, 1.5])
]);

/** MOITA: domo denso em três camadas decrescentes (curva = caixas escalonadas). */
export const MODELO_MOITA: No = comoRig([
  peca('gramaSombra', [4.6, 4.0, 1.4], [0, 0, 0.7]),
  peca('gramaMeio', [4.0, 3.4, 1.6], [0, 0, 2.1]),
  peca('gramaBase', [3.0, 2.6, 1.4], [0, -0.2, 3.4]),
  detalhe('gramaLuz', [1.8, 1.6, 0.8], [-0.6, -0.6, 4.4])
]);

/** FLORES brancas de miolo amarelo: três hastes com pétala e miolo. */
export const MODELO_FLORES: No = comoRig([
  detalhe('gramaMeio', [0.5, 0.5, 1.4], [-1.4, 0.6, 0.7]),
  detalhe('petala', [1.2, 1.2, 0.8], [-1.4, 0.6, 1.8]),
  detalhe('miolo', [0.5, 0.5, 0.5], [-1.4, 0.35, 1.9]),
  detalhe('gramaMeio', [0.5, 0.5, 1.8], [0.4, -0.8, 0.9]),
  detalhe('petala', [1.2, 1.2, 0.8], [0.4, -0.8, 2.2]),
  detalhe('miolo', [0.5, 0.5, 0.5], [0.4, -1.05, 2.3]),
  detalhe('gramaMeio', [0.5, 0.5, 1.2], [1.6, 0.9, 0.6]),
  detalhe('petala', [1.0, 1.0, 0.7], [1.6, 0.9, 1.6])
]);

/**
 * FLOR LARANJA: a variante que ACENDE. É o único adereço emissivo do tileset,
 * e existe pela mesma razão da antena do Slime e das brasas da alquimia —
 * num corredor escuro, um ponto quente dá referência de lugar.
 */
export const MODELO_FLOR_LARANJA: No = comoRig([
  detalhe('gramaMeio', [0.5, 0.5, 1.4], [-0.9, 0.4, 0.7]),
  detalhe('frutoLaranja', [1.2, 1.2, 1.0], [-0.9, 0.4, 1.9]),
  detalhe('gramaMeio', [0.5, 0.5, 1.1], [1.0, -0.6, 0.55]),
  detalhe('frutoLaranja', [1.0, 1.0, 0.9], [1.0, -0.6, 1.6])
]);

/**
 * FLORZINHAS TURQUESA — as pequenas flores ciano espalhadas pela grama da
 * referência. Não são emissivas (só a laranja é): elas são cor, não luz.
 */
export const MODELO_FLORES_TURQUESA: No = comoRig([
  detalhe('gramaMeio', [0.5, 0.5, 1.0], [-1.2, 0.5, 0.5]),
  detalhe('turquesa', [1.1, 1.1, 0.7], [-1.2, 0.5, 1.4]),
  detalhe('turquesaLuz', [0.5, 0.5, 0.5], [-1.2, 0.25, 1.5]),
  detalhe('gramaMeio', [0.5, 0.5, 1.3], [0.6, -0.7, 0.65]),
  detalhe('turquesa', [1.0, 1.0, 0.7], [0.6, -0.7, 1.7]),
  detalhe('turquesaLuz', [0.5, 0.5, 0.5], [0.6, -0.95, 1.8]),
  detalhe('turquesa', [0.9, 0.9, 0.6], [1.8, 1.0, 0.9])
]);

/** Mobília e terreno não articulam: repouso vazio é legítimo. */
export const POSE_PARADA_NIVEL1: Pose = {};
