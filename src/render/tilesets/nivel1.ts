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
  /* ═══ os quatro verdes da PAREDE VEGETAL ═══
   *
   * A referência de muralha viva que o dono mandou é toda verde, e o que separa
   * uma variante da outra ali não é matiz: é REGISTRO. São quatro, e cada um
   * ganha rampa própria de 4 tons porque o quantizador escolhe o degrau pelo
   * fator de luz da FACE (topo 1,0 / frente 0,82 / lado 0,68 — §4.3 de
   * ../model3d) — uma cor sem rampa sai chapada nos três lados e o bloco perde
   * o volume que o rig acabou de construir.
   *
   * Os verdes de `grama*` continuam sendo os do CHÃO. A sebe é de propósito mais
   * escura e menos saturada que eles: parede e piso não podem competir em brilho
   * na mesma tela, senão o jogador perde a leitura de onde dá para andar. */
  mataLuz: '#4e8f6a',     // verde-escuro AZULADO — o fundo frio da folhagem
  mataBase: '#3a7355',
  mataMeio: '#2b5a43',
  mataSombra: '#1b3b2e',
  sebeLuz: '#6bb356',     // verde MÉDIO — o corpo da sebe, o verde de trabalho
  sebeBase: '#4e9440',
  sebeMeio: '#38702f',
  sebeSombra: '#254c21',
  capimLuz: '#cfe273',    // verde-claro AMARELADO — as pontas do capim ao sol
  capimBase: '#aec857',
  capimMeio: '#87a742',
  capimSombra: '#627c30',
  friaLuz: '#4c6f6d',     // a SOMBRA FRIA — o pé da muralha e o vão entre folhas
  friaBase: '#3a5757',
  friaMeio: '#2b4243',
  friaSombra: '#1a2b2e',
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
  /* Os quatro registros da muralha viva. Ordem = do claro ao escuro, como as
   * demais: é `montarTom` quem reordena por luminância, mas declarar fora de
   * ordem só serve para confundir quem lê. */
  mata: ['mataLuz', 'mataBase', 'mataMeio', 'mataSombra'],
  sebe: ['sebeLuz', 'sebeBase', 'sebeMeio', 'sebeSombra'],
  capim: ['capimLuz', 'capimBase', 'capimMeio', 'capimSombra'],
  fria: ['friaLuz', 'friaBase', 'friaMeio', 'friaSombra'],
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
  mataLuz: 'mata', mataBase: 'mata', mataMeio: 'mata', mataSombra: 'mata',
  sebeLuz: 'sebe', sebeBase: 'sebe', sebeMeio: 'sebe', sebeSombra: 'sebe',
  capimLuz: 'capim', capimBase: 'capim', capimMeio: 'capim', capimSombra: 'capim',
  friaLuz: 'fria', friaBase: 'fria', friaMeio: 'fria', friaSombra: 'fria',
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
  /**
   * Quanto o topo da água afunda abaixo do plano do chão.
   *
   * 2,4u = **6 px de tela**, e o número é de LEGIBILIDADE DE REGRA, não de
   * estilo. A poça BLOQUEIA o passo (`isWalkable` devolve falso para todo tile
   * com `map.agua` marcado — src/engine/mapgen.ts) e, pelo corte de canto, ela
   * também tranca as diagonais em volta: medido em quatro sementes, cada andar
   * tem 41 a 58 tiles de água que recusam de 95 a 148 passos ortogonais e de 50
   * a 86 diagonais cujo ALVO estava livre. Com o afundamento antigo de 1,2u
   * (3 px) o degrau não aparecia: a poça lia como uma laje azul rente ao chão,
   * e o jogador batia numa parede invisível.
   *
   * Com 6 px, o barranco do tile vizinho mostra uma faixa da própria face de
   * terra ACIMA da lâmina d'água — é essa faixa, e não a cor, que diz "aqui
   * desce". O teto é o outro lado da conta, e foi medido em foto: quanto mais
   * fundo, mais da lâmina o bloco da FRENTE esconde (o topo dele começa na
   * aresta compartilhada e sobe o afundamento inteiro). A 8 px sobrava menos de
   * metade da poça; a 6 px o degrau ainda se lê de relance e a superfície
   * continua com forma reconhecível. Abaixo de ~4 px o degrau some no contorno
   * entre blocos e a água volta a ler como laje.
   */
  afundamentoAgua: 2.4,
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
 * ═══ E É TAMBÉM O QUE MANTÉM A ORDEM DO PINTOR HONESTA ═══
 *
 * O passe de pisos de uma antidiagonal roda DEPOIS das entidades da anterior
 * (ver `draw` em ../IsoRenderer.ts). Um detalhe que subisse acima do vértice
 * NORTE do próprio losango cairia sobre quem está no tile de trás — e isso não
 * se conserta com ordem de desenho, só com geometria. Como as lâminas moram nas
 * bordas +Y/+X (que projetam para baixo, à frente do próprio tile) e as do
 * miolo são baixas, o bloco inteiro sobe **exatamente 16,0 px**, que é o
 * vértice na mosca. Medido, e travado por test/render.test.ts: subir a altura
 * das lâminas do miolo, ou mudá-las de borda, reprova o caso.
 *
 * O padrão de alturas é FIXO e não aleatório: o render é proibido de sortear, e
 * um padrão declarado é reproduzível em toda tile do mapa.
 *
 * `tons` troca o verde do CHÃO pelo de outro material sem duplicar o helper —
 * é assim que a parede de capim (§5.2) usa a mesma franja com a rampa dela.
 */
function laminasDeGrama(
  topoZ: number,
  tons: readonly [CorNivel1, CorNivel1, CorNivel1] = ['gramaLuz', 'gramaBase', 'gramaMeio']
): Caixa[] {
  const [claro, base, meioTom] = tons;
  const meio = L / 2;
  const alturas = [2.4, 1.4, 2.9, 1.8, 2.2, 1.2, 2.6, 1.6, 2.0];
  const out: Caixa[] = [];
  /* borda +Y (a que fica de frente para a câmera, embaixo na tela) */
  for (let k = 0; k < 6; k++) {
    const h = alturas[k % alturas.length];
    const px = -meio + 1.2 + k * 2.1;
    out.push(detalhe(k % 2 === 0 ? claro : base, [0.6, 0.7, h], [px, meio - 0.4, topoZ + h / 2 - 0.3]));
  }
  /* borda +X (a da direita na tela) */
  for (let k = 0; k < 6; k++) {
    const h = alturas[(k + 3) % alturas.length];
    const py = -meio + 1.5 + k * 2.1;
    out.push(detalhe(k % 2 === 0 ? base : claro, [0.7, 0.6, h], [meio - 0.4, py, topoZ + h / 2 - 0.3]));
  }
  /* algumas no miolo, mais baixas: tiram o ar de "cerca viva" das bordas */
  out.push(detalhe(meioTom, [0.6, 0.6, 1.1], [-2.6, -1.4, topoZ + 0.25]));
  out.push(detalhe(claro, [0.6, 0.6, 1.4], [2.2, -3.0, topoZ + 0.4]));
  out.push(detalhe(base, [0.6, 0.6, 0.9], [0.4, 1.0, topoZ + 0.15]));
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
 * ÁGUA — a poça que BLOQUEIA o passo, e que por isso precisa PARECER que
 * bloqueia. Três traços, nesta ordem de importância:
 *
 *   1. ela AFUNDA `afundamentoAgua` (6 px). O leito continua com a altura cheia
 *      de um piso (`alturaPiso`) em vez de encolher junto: encolher deixaria a
 *      caixa de volume de `corpoDeBloco` com espessura negativa quando o
 *      afundamento passasse da laje de topo, e um bloco com altura cheia dá à
 *      poça profundidade de verdade. O fundo desce 6 px abaixo do dos vizinhos
 *      — nunca aparece, porque quem está à frente é desenhado depois e cobre a
 *      saia; na beira do mapa, aparece como água funda, que é o que se quer;
 *   2. a ESPUMA DA BEIRADA, nas duas bordas que a projeção mostra (+Y e +X): é
 *      o contato da lâmina com o barranco, e é o que separa "poça" de "buraco
 *      azul". Nas bordas de trás não se gasta caixa — o culling as descarta;
 *   3. o BRILHO: dois riscos claros fora do centro. Reflexo é o que o olho lê
 *      como líquido; sem ele, o mesmo azul lê como laje pintada. O brilho que
 *      SE MEXE é do renderer (`desenharBrilhoDaAgua`) — rig não anima.
 *
 * A espuma é laje POR CIMA da superfície, nunca "dentro" dela: caixa é opaca, e
 * espuma modelada sob a água não existiria na imagem.
 */
export const MODELO_PISO_AGUA: No = comoRig([
  ...corpoDeBloco('aguaLuz', 'aguaFundo', 'aguaFundo', -P.afundamentoAgua, P.alturaPiso),
  /* o fundo entrevisto: mancha central, não o topo inteiro — cobrir a
   * superfície toda de `aguaBase` apagava o azul claro que dá a lâmina */
  detalhe('aguaBase', [L - 5.2, L - 5.2, P.detalheTopo], [0, 0, -P.afundamentoAgua + 0.2]),
  detalhe('aguaFundo', [3.4, 2.4, P.detalheTopo], [1.6, 1.2, -P.afundamentoAgua + 0.22]),
  /* a espuma da beirada, nas duas bordas visíveis */
  detalhe('aguaEspuma', [L - 1.8, 0.9, P.detalheTopo], [0, L / 2 - 0.9, -P.afundamentoAgua + 0.34]),
  detalhe('aguaEspuma', [0.9, L - 1.8, P.detalheTopo], [L / 2 - 0.9, 0, -P.afundamentoAgua + 0.34]),
  /* o brilho parado: dois riscos no quadrante afastado da beirada */
  detalhe('aguaEspuma', [3.8, 0.8, P.detalheTopo], [-1.8, -2.4, -P.afundamentoAgua + 0.4]),
  detalhe('aguaEspuma', [2.0, 0.8, P.detalheTopo], [-3.6, -0.8, -P.afundamentoAgua + 0.4])
]);

/**
 * PAREDE DE BARRANCO — o bloco alto de terra com topo de grama: o mesmo bloco
 * do piso, porém alto, com as laterais estratificadas (a estratificação é o que
 * impede uma parede de 14u de virar um paralelepípedo marrom chapado).
 *
 * ═══ ELA SAIU DO TILESET DO ANDAR 1 ═══
 *
 * O dono trocou o barranco por MURALHA VIVA (§5.2): as paredes do nível 1 são
 * sebes. Este rig continua exportado porque está calibrado, revisado e é o
 * terreno natural de um andar a céu aberto — o nível 2 que quiser barranco
 * gasta uma linha, não uma tarde. Não é código morto: é peça de reposição com
 * a etiqueta escrita.
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
 * 5.2 A MURALHA VIVA — as paredes vegetais do andar 1
 *
 * O dono trocou o barranco de terra por SEBE: as paredes do nível 1 são moitas
 * densas e intransponíveis, no molde da referência de oito blocos cobertos de
 * folhagem. Quatro delas viraram rig — as quatro que ainda se distinguem quando
 * o bloco tem 64×36 px na tela:
 *
 *   · SEBE (ref. 1, folhas médias arredondadas) — verde médio, textura fina e
 *     uniforme, topo mais claro. É a "cor de fundo" do conjunto;
 *   · CAPIM (ref. 3, grama alta e densa) — o único CLARO E AMARELADO, e o único
 *     de textura VERTICAL. Distingue-se por matiz e por direção ao mesmo tempo;
 *   · FOLHAGEM (ref. 5, folhas grandes pontudas) — o mais volumoso: manchas
 *     grandes, contraste alto, coroa recortada. Distingue-se pelo TAMANHO do
 *     motivo, que é o que sobrevive melhor à redução;
 *   · SUCULENTA (ref. 8, rosetas grandes) — corpo ESCURO com motivos redondos e
 *     concêntricos no topo. Distingue-se por valor (o mais escuro dos quatro).
 *
 * As quatro que ficaram de fora ficaram por não sobreviverem a 40px: o musgo
 * liso (2) e a trepadeira (7) chegam na tela como a sebe com um pouco menos de
 * ruído; as espirais (4) são as rosetas (8) em tamanho pequeno demais para o
 * anel do meio existir; as lanceoladas (6) são a folhagem (5) com menos
 * contraste. Quatro rigs que o jogador SEPARA valem mais do que oito que ele
 * confunde.
 *
 * ═══ AS DUAS CONTAS QUE MANDAM NESTE BLOCO ═══
 *
 * (1) O TETO. `test/render.test.ts` trava que nenhum bloco de terreno passe do
 *     vértice NORTE do próprio losango, porque o passe seguinte de terreno roda
 *     depois das entidades da antidiagonal anterior e o que passar do vértice
 *     cai em cima de quem está atrás. Para o PISO o vértice está a 16px da
 *     âncora; para a PAREDE, que sobe `alturaParede` de propósito, o mesmo
 *     vértice está no topo do prisma — **52 px**, que é o que a parede de terra
 *     e a de tijolo medem hoje. Em `u`, a conta da projeção (§4.2) dá
 *
 *         sobe(px) = 2,5 · [ z_topo − (x_min + y_min)/2 ]
 *
 *     e o teto é `alturaParede + L/2` = 20,8u. Note o que isso significa: uma
 *     folha ganha teto conforme AVANÇA para +X/+Y (para a frente da tela) e
 *     perde conforme recua para o norte. É `TETO_DA_COROA`, e `folhaDeCoroa` o
 *     aplica sozinha — nenhuma folha deste arquivo pode estourar o limite,
 *     porque nenhuma folha escolhe a própria altura final.
 *
 * (2) A ORDEM DO PINTOR. As faces saem ordenadas pela soma (x+y+z) do CENTRO
 *     delas (§4.4 de ../model3d), e não há z-buffer: uma mancha rente a uma
 *     face grande só aparece se a soma dela for MAIOR que a da face inteira.
 *     Como o centro de uma face de 14,4u de altura está no meio dela, mancha no
 *     canto de baixo à esquerda é pintada ANTES e some — foi assim que a fiada
 *     de baixo do tijolo e duas das três faixas de `estratosDeTerra` viraram
 *     caixa que só custa forja. Daí as duas decisões deste bloco:
 *       · o corpo é EMPILHADO em faixas (`corpoVegetal`), nunca um paralelepípedo
 *         só com listras por cima: faixas empilhadas não se cobrem, então TODAS
 *         aparecem, e a junta entre elas ainda traça a linha escura que lê como
 *         sombra sob uma camada de folhas;
 *       · o manto e a coroa só emitem caixa onde o pintor as mostra
 *         (`mantoDeFolhas` filtra pela soma; a coroa mora na metade da frente).
 * ------------------------------------------------------------------ */

/**
 * O teto absoluto de qualquer folha da coroa, em `u`: o vértice N do losango na
 * altura da parede. Ver a conta (1) acima — 20,8u ⇒ 52 px acima da âncora, o
 * mesmo que a parede de terra mede.
 */
const TETO_DA_COROA = P.alturaParede + L / 2;

/**
 * Uma folha da COROA (o que sobe do topo da parede), com os dois limites
 * aplicados na própria construção:
 *
 *   · o FOOTPRINT: a caixa é empurrada para dentro do quadrado do tile. Folha
 *     que passasse da quina alargaria o quadro do sprite e invadiria a coluna
 *     do vizinho — a referência tem folha escapando pela borda, o nosso tile
 *     não pode ter;
 *   · o TETO: o topo é cortado em `TETO_DA_COROA + (x_min + y_min)/2`. É por
 *     isso que a bagunça da referência aqui vira altura ESCALONADA em vez de
 *     folha atravessada: quanto mais ao norte, menos folha cabe.
 *
 * `sobe` é o quanto se PEDE acima do topo da parede; o que se recebe é o que
 * couber. A caixa nunca fica mais fina que `espessuraMinima` — ela afunda no
 * bloco em vez de encolher, porque peça de 0,3u pisca entre direções (regra 2).
 */
function folhaDeCoroa(
  cor: CorNivel1, dim: [number, number, number], centro: [number, number], sobe: number
): Caixa {
  const [sx, sy, sz] = dim;
  const meio = L / 2;
  /* a espessura é resolvida ANTES do topo: fosse depois, uma folha pedida com
   * 0,3u sairia engordada para 0,5u a partir do centro e o topo dela subiria
   * meio degrau ACIMA do teto — o helper que existe para não estourar o limite
   * seria o único jeito de estourá-lo */
  const alt = Math.max(P.espessuraMinima, sz);
  const cx = Math.min(meio - sx / 2, Math.max(-meio + sx / 2, centro[0]));
  const cy = Math.min(meio - sy / 2, Math.max(-meio + sy / 2, centro[1]));
  const teto = TETO_DA_COROA + ((cx - sx / 2) + (cy - sy / 2)) / 2;
  const topo = Math.min(P.alturaParede + sobe, teto);
  return detalhe(cor, [sx, sy, alt], [cx, cy, topo - alt / 2]);
}

/**
 * O CORPO de uma parede vegetal: três faixas EMPILHADAS de z = 0 até
 * `alturaParede`, cada uma com a sua cor.
 *
 * Por que empilhar em vez de usar `corpoDeBloco` + listras (a receita do
 * barranco): ver a conta (2) do cabeçalho desta seção. Faixa empilhada é face
 * DISJUNTA — nenhuma cobre a outra, então as três aparecem sempre, inclusive a
 * de baixo, que é justamente a que some quando se pinta listra sobre um bloco
 * inteiro. De brinde, a junta entre faixas é aresta de silhueta e sai traçada
 * no contorno: uma linha escura atravessando a face, que numa muralha de folhas
 * lê exatamente como a sombra sob uma camada — o mesmo truque da linha entre a
 * grama e a terra do barranco.
 *
 * `contorno` fica LIGADO nas três (elas são o CORPO, regra 6): é delas que sai
 * a linha escura que separa um tile do vizinho.
 */
function corpoVegetal(
  pe: CorNivel1, corpo: CorNivel1, coroa: CorNivel1, alturaPe: number, alturaCoroa: number
): Caixa[] {
  const zPe = alturaPe;
  const zCorpo = P.alturaParede - alturaCoroa;
  return [
    /* o pé, na sombra fria: é o que dá peso e assenta a moita no chão */
    peca(pe, [L, L, zPe], [0, 0, zPe / 2]),
    /* a massa do meio, que é quase toda a face visível */
    peca(corpo, [L, L, zCorpo - zPe], [0, 0, (zPe + zCorpo) / 2]),
    /* a camada de cima, mais clara: é ela que dá o topo iluminado da referência */
    peca(coroa, [L, L, P.alturaParede - zCorpo], [0, 0, (zCorpo + P.alturaParede) / 2])
  ];
}

/**
 * O MANTO: as folhas rentes às duas faces visíveis, dentro da janela de altura
 * de UMA faixa do corpo.
 *
 * Cada folha é uma caixa de 0,7u de mordida na face. Rente, e não saliente, por
 * duas razões: sair da face alargaria o quadro (ver `folhaDeCoroa`), e rente já
 * basta — a caixa é opaca e desenhada DEPOIS da faixa, então o topo dela sai
 * como um filete claro sobre a face escura. É esse filete, e não a saliência,
 * que o olho lê como relevo a 40px (é o mesmo mecanismo das fiadas de tijolo).
 *
 * ═══ QUEM ENTRA ═══
 *
 * Só a folha cuja soma (x + z) na face +Y — ou (y + z) na face +X — passa do
 * CENTRO da faixa. Abaixo disso a face da faixa é pintada por cima e a folha
 * não existe na imagem: o filtro é o que impede este helper de encher o rig de
 * caixa invisível. É por isso também que a folhagem adensa para a direita e
 * para o alto de cada faixa, o que casa com a luz vindo de +X+Y+Z.
 *
 * `celX`/`celZ` são o tamanho do motivo — e são o que separa as quatro paredes
 * mais do que a cor: célula estreita e alta vira capim, célula larga vira folha
 * grande.
 */
function mantoDeFolhas(
  z0: number, z1: number, tons: readonly CorNivel1[], celX: number, celZ: number
): Caixa[] {
  const meio = L / 2;
  const centro = (z0 + z1) / 2;
  const mordida = 0.7;
  /* Desvios DECLARADOS: o rig é proibido de sortear (o mesmo tile tem de sair
   * igual em toda partida), e uma tabela curta já quebra a grade. */
  const desvio = [0.0, 0.55, -0.4, 0.3, -0.55, 0.45, -0.25, 0.2];
  const colunas = Math.max(2, Math.round(L / celX));
  const linhas = Math.max(1, Math.round((z1 - z0) / celZ));
  const out: Caixa[] = [];
  let k = 0;
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < colunas; c++, k++) {
      const d1 = desvio[k % desvio.length];
      const d2 = desvio[(k + 3) % desvio.length];
      /* a folha nunca é maior que a faixa que a hospeda nem que o tile: com o
       * motivo maior que a janela, os dois travamentos abaixo brigariam entre
       * si e a folha sairia com o pé para fora do bloco */
      const larg = Math.min(L, Math.max(P.espessuraMinima, celX * 0.78 + d1 * 0.5));
      const alt = Math.min(z1 - z0, Math.max(P.espessuraMinima, celZ * 0.62 + d2 * 0.5));
      /* o eixo longo (x na face da frente, y na face da direita) e a altura,
       * ambos travados para não passar da quina nem da própria faixa */
      const eixo = Math.min(meio - larg / 2, Math.max(-meio + larg / 2,
        -meio + L * ((c + 0.5) / colunas) + d1 * 0.8));
      const cz = Math.min(z1 - alt / 2, Math.max(z0 + alt / 2,
        z0 + (z1 - z0) * ((l + 0.5) / linhas) + d2 * 0.6));
      if (eixo + cz <= centro + 0.4) continue; // o pintor a cobriria: não nasce
      out.push(detalhe(tons[(c + l * 2) % tons.length],
        [larg, mordida, alt], [eixo, meio - mordida / 2, cz]));
      out.push(detalhe(tons[(c + l * 2 + 1) % tons.length],
        [mordida, larg, alt], [meio - mordida / 2, eixo, cz]));
    }
  }
  return out;
}

/**
 * As ROSETAS da suculenta: três degraus concêntricos, do anel largo e escuro ao
 * miolo estreito e claro. Curva por caixas escalonadas, como o domo da moita.
 *
 * `tam` é o diâmetro do anel de fora. Abaixo de ~3u o anel do meio não sobra
 * pixel nenhum depois do snap e a roseta vira um quadrado claro — é o motivo de
 * a referência nº 4 (as espirais pequenas) não ter virado rig.
 */
function rosetas(
  postos: readonly (readonly [number, number, number])[],
  fora: CorNivel1, meioTom: CorNivel1, miolo: CorNivel1
): Caixa[] {
  const out: Caixa[] = [];
  for (const [cx, cy, tam] of postos) {
    out.push(folhaDeCoroa(fora, [tam, tam, 1.1], [cx, cy], 1.2));
    out.push(folhaDeCoroa(meioTom, [tam * 0.62, tam * 0.62, 1.2], [cx, cy], 2.3));
    out.push(folhaDeCoroa(miolo, [tam * 0.3, tam * 0.3, 1.1], [cx, cy], 3.3));
  }
  return out;
}

/**
 * As FOLHAS GRANDES E PONTUDAS da coroa: cada uma são três caixas que encolhem
 * e caminham na direção da ponta, o que dá a lâmina inclinada sem rotação de nó
 * (rig de terreno não articula).
 *
 * `[cx, cy, dx, dy]` é o pé da folha e o rumo para onde ela aponta — sempre com
 * componente para +X/+Y, porque é para lá que a projeção dá teto (conta (1)) e
 * é lá que a ordem do pintor deixa a folha aparecer.
 */
function folhasPontudas(
  pontas: readonly (readonly [number, number, number, number])[],
  base: CorNivel1, meioTom: CorNivel1, ponta: CorNivel1
): Caixa[] {
  const out: Caixa[] = [];
  for (const [cx, cy, dx, dy] of pontas) {
    out.push(folhaDeCoroa(base, [3.6, 3.2, 1.4], [cx, cy], 1.8));
    out.push(folhaDeCoroa(meioTom, [2.6, 2.2, 1.4], [cx + dx * 0.7, cy + dy * 0.7], 3.2));
    out.push(folhaDeCoroa(ponta, [1.4, 1.2, 1.3], [cx + dx * 1.4, cy + dy * 1.4], 4.5));
  }
  return out;
}

/**
 * PAREDE DE SEBE (referência 1) — folhas médias e arredondadas cobrindo o bloco
 * inteiro, mais claras no topo. É a parede PADRÃO do andar: a que o renderer
 * desenha hoje, e a régua contra a qual as outras três se distinguem.
 *
 * O corpo vai do pé na sombra fria ao topo em verde médio; o manto usa célula
 * média (2,8 × 2,2u), que é o tamanho em que a folha ainda tem miolo e borda
 * depois do snap; e a coroa são domos de dois degraus — o mesmo escalonamento
 * da moita, que é como se faz curva com caixa.
 */
export const MODELO_PAREDE_SEBE: No = comoRig([
  ...corpoVegetal('mataMeio', 'sebeMeio', 'sebeBase', 3.0, 3.4),
  ...mantoDeFolhas(0, 3.0, ['mataMeio', 'sebeSombra'], 2.8, 2.2),
  ...mantoDeFolhas(3.0, 11.0, ['sebeBase', 'sebeMeio', 'sebeSombra'], 2.8, 2.2),
  ...mantoDeFolhas(11.0, P.alturaParede, ['sebeLuz', 'sebeBase'], 2.6, 2.0),
  /* a coroa: domos de dois degraus na metade da frente do topo — arredondado é
   * o que a referência 1 tem de próprio, e dois degraus é como se faz curva
   * com caixa (o mesmo da moita).
   *
   * O CAPO É DE OUTRA RAMPA, e isso não é enfeite: a face de topo recebe
   * `REALCE_TOPO` (§4.3 de ../model3d) e já sai no degrau mais claro do próprio
   * material — um domo declarado na mesma rampa da laje sairia na MESMA cor
   * dela e o relevo sumiria. O amarelado do `capim` é o que faz "folha mais
   * clara no topo" existir na imagem, e é o que a referência 1 mostra. */
  folhaDeCoroa('sebeBase', [3.2, 2.8, 1.4], [3.0, -1.0], 1.7),
  folhaDeCoroa('capimMeio', [1.8, 1.6, 1.2], [3.4, -0.6], 2.6),
  folhaDeCoroa('sebeBase', [3.0, 3.2, 1.4], [-0.8, 2.8], 1.8),
  folhaDeCoroa('capimMeio', [1.7, 1.8, 1.2], [-0.4, 3.2], 2.7),
  folhaDeCoroa('sebeMeio', [2.6, 2.6, 1.3], [4.6, 4.2], 1.5),
  folhaDeCoroa('capimSombra', [1.5, 1.5, 1.1], [5.0, 4.6], 2.4),
  folhaDeCoroa('sebeBase', [2.4, 2.2, 1.2], [-3.6, 0.6], 1.2),
  folhaDeCoroa('sebeMeio', [2.0, 2.4, 1.2], [0.8, -3.6], 1.1),
  folhaDeCoroa('capimSombra', [1.8, 1.8, 1.1], [-2.4, 4.8], 1.6),
  folhaDeCoroa('sebeBase', [1.6, 1.6, 1.0], [1.4, 1.2], 1.4)
]);

/**
 * PAREDE DE CAPIM (referência 3) — grama alta e densa, em pé, de textura
 * "peluda" e verde-claro amarelado. É a única parede CLARA do conjunto e a
 * única de textura VERTICAL: as duas coisas juntas é que a fazem reconhecível
 * de relance no meio de uma sala de sebe.
 *
 * O manto usa célula estreita e alta (1,6 × 4,2u) — a mesma função das outras
 * paredes com outro número, que é o que "peludo" quer dizer em rig de caixas. A
 * franja do topo é `laminasDeGrama`, o helper do chão, com a rampa do capim: as
 * lâminas do chão já foram calibradas contra o vértice do losango, e reaproveitá-las
 * é herdar essa calibração de graça.
 */
export const MODELO_PAREDE_CAPIM: No = comoRig([
  ...corpoVegetal('mataMeio', 'capimMeio', 'capimBase', 3.0, 3.6),
  ...mantoDeFolhas(0, 3.0, ['mataBase', 'capimSombra'], 1.6, 2.8),
  ...mantoDeFolhas(3.0, 10.8, ['capimBase', 'capimSombra', 'capimMeio'], 1.6, 4.2),
  ...mantoDeFolhas(10.8, P.alturaParede, ['capimLuz', 'capimMeio'], 1.6, 3.0),
  /* a franja: a mesma do torrão de grama, na rampa do capim */
  ...laminasDeGrama(P.alturaParede, ['capimLuz', 'capimBase', 'capimMeio']),
  /* e as touceiras altas, que é o que separa "capim" de "grama aparada" */
  folhaDeCoroa('capimBase', [0.8, 0.8, 4.2], [2.6, 1.6], 4.0),
  folhaDeCoroa('capimLuz', [0.7, 0.7, 4.6], [3.4, 2.6], 4.8),
  folhaDeCoroa('capimBase', [0.8, 0.8, 3.6], [0.4, 3.6], 3.4),
  folhaDeCoroa('capimLuz', [0.7, 0.7, 4.0], [4.6, 0.6], 4.2),
  folhaDeCoroa('capimMeio', [0.8, 0.8, 3.0], [-1.6, 2.6], 2.6),
  folhaDeCoroa('capimLuz', [0.7, 0.7, 3.4], [1.4, 4.8], 3.6),
  folhaDeCoroa('capimBase', [0.8, 0.8, 2.8], [5.4, 3.4], 3.0),
  folhaDeCoroa('capimMeio', [0.7, 0.7, 2.6], [-0.6, 5.4], 2.4)
]);

/**
 * PAREDE DE FOLHAGEM (referência 5) — folhas grandes e pontudas empilhadas: a
 * mais volumosa e bagunçada das oito, com folhas escapando das bordas.
 *
 * ═══ E É AQUI QUE A REFERÊNCIA NÃO PODE SER OBEDECIDA AO PÉ DA LETRA ═══
 *
 * Folha que escapa da borda estoura o vértice N (conta (1)) e cai sobre a
 * entidade do tile de trás. O volume fica DENTRO do prisma, e a bagunça vem de
 * onde ela pode vir sem cobrar esse preço: motivo GRANDE (célula de 4,2 × 3,2u,
 * o dobro da sebe), contraste ALTO entre folha clara e vão escuro (por isso a
 * `mata` no manto junto com a `sebe`), e coroa em ALTURAS diferentes, que
 * recorta a silhueta de cima em degraus irregulares em vez de uma aresta reta.
 */
export const MODELO_PAREDE_FOLHAGEM: No = comoRig([
  ...corpoVegetal('friaMeio', 'mataBase', 'sebeMeio', 3.2, 3.6),
  ...mantoDeFolhas(0, 3.2, ['mataMeio', 'friaBase'], 4.2, 3.0),
  ...mantoDeFolhas(3.2, 10.8, ['sebeBase', 'mataMeio', 'sebeLuz', 'sebeMeio'], 4.2, 3.2),
  ...mantoDeFolhas(10.8, P.alturaParede, ['sebeLuz', 'mataMeio', 'sebeBase'], 4.0, 2.8),
  /* três folhas grandes apontando para fora, em alturas diferentes: os três
   * degraus atravessam TRÊS rampas (mata → sebe → capim), que é como uma folha
   * de 3px de espessura ainda mostra base escura e ponta clara */
  ...folhasPontudas([[1.8, -2.4, 1.4, -0.8], [-2.0, 2.4, -0.6, 1.6], [4.2, 3.8, 0.9, 0.9]],
    'mataBase', 'sebeBase', 'capimMeio'),
  /* e as folhas menores que preenchem os vãos, sem alinhar com as grandes: é
   * daqui que sai a "bagunça" da referência 5, já que folha atravessando a
   * borda está proibida — o que se pode desalinhar é a ALTURA e o posto */
  folhaDeCoroa('sebeBase', [2.4, 2.0, 1.4], [-3.8, 4.6], 2.0),
  folhaDeCoroa('mataLuz', [1.8, 2.6, 1.4], [5.2, -0.8], 2.2),
  folhaDeCoroa('sebeMeio', [2.2, 2.2, 1.3], [0.4, 0.6], 1.8),
  folhaDeCoroa('capimSombra', [1.4, 1.4, 1.1], [0.8, 1.2], 2.6),
  folhaDeCoroa('mataBase', [2.0, 1.6, 1.2], [-4.6, 1.8], 1.4),
  folhaDeCoroa('sebeMeio', [1.6, 2.0, 1.2], [2.2, 5.2], 1.6),
  folhaDeCoroa('sebeLuz', [1.2, 1.2, 1.0], [2.4, 5.4], 2.4)
]);

/**
 * PAREDE DE SUCULENTA (referência 8) — rosetas grandes no topo, corpo mais
 * escuro embaixo. É a mais ESCURA das quatro, e é isso que a separa das outras
 * antes mesmo de o olho achar as rosetas: numa tela pequena, valor chega antes
 * de forma.
 *
 * O corpo quase não tem manto (célula pequena, tons vizinhos): a referência põe
 * toda a informação no topo, e competir com a roseta seria perder as duas.
 */
export const MODELO_PAREDE_SUCULENTA: No = comoRig([
  ...corpoVegetal('friaMeio', 'mataMeio', 'mataBase', 3.4, 3.2),
  ...mantoDeFolhas(0, 3.4, ['friaBase', 'mataSombra'], 2.4, 2.6),
  ...mantoDeFolhas(3.4, 11.2, ['friaBase', 'mataSombra', 'friaMeio'], 2.4, 2.6),
  ...mantoDeFolhas(11.2, P.alturaParede, ['mataLuz', 'friaLuz'], 2.4, 2.2),
  /* as rosetas: três na metade da frente do topo, a maior à direita. O anel de
   * fora é UM DEGRAU MAIS ESCURO que a laje da coroa de propósito — é o
   * contorno escuro que a referência 8 desenha em volta de cada roseta, e sem
   * ele os três anéis se fundem com o topo e a roseta some. */
  ...rosetas([[3.0, -0.6, 4.4], [-1.0, 3.0, 4.0], [4.6, 4.4, 3.4]],
    'mataMeio', 'sebeMeio', 'sebeLuz'),
  /* dois filhotes, para o topo não virar três círculos em fila */
  folhaDeCoroa('mataMeio', [2.0, 2.0, 1.0], [-3.6, 1.2], 1.1),
  folhaDeCoroa('sebeMeio', [1.1, 1.1, 1.0], [-3.6, 1.2], 1.9),
  folhaDeCoroa('mataMeio', [1.8, 1.8, 1.0], [1.0, -3.8], 1.0),
  folhaDeCoroa('sebeMeio', [1.0, 1.0, 1.0], [1.0, -3.8], 1.8)
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
