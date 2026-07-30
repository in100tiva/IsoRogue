/*
 * ISOROGUE — src/render/characters/itemGosma.ts
 *
 * O rig do FRASCO DE GOSMA: o despojo do Vinculador (`./slime`), o frasco que
 * fica caído no chão da masmorra depois do abate, vira ícone de bolsa e é
 * matéria-prima da alquimia (gosma → poção) ou moeda de venda.
 *
 * Mesmo molde dos rigs de personagem (`./warrior`, `./goblin`, `./slime`,
 * `./ogre`) e os mesmos limites:
 *   - é a fonte da verdade da FORMA (árvore de nós, pivôs, caixas);
 *   - é a fonte da verdade da COR (`PALETA_GOSMA` + rampas de material);
 *   - guarda a pose de repouso, aqui vazia de propósito (`POSE_PARADA_GOSMA`).
 *
 * O que ele NÃO é: não projeta, não rasteriza, não anima, não conhece Canvas,
 * não conhece receita de alquimia nem preço. Projeção e faces são de
 * `../model3d`; atlas é de `../spriteForge`; quem decide que um slime morto
 * larga isto é o engine. Um despojo é APARÊNCIA.
 *
 * AUTONOMIA DELIBERADA — este arquivo NÃO importa nada de `./slime`, nem a
 * paleta. Os hexes de gosma foram COPIADOS de `PALETA_SLIME` (§12.3 do
 * docs/BESTIARIO.md), pelo mesmo motivo registrado em `./itemPeOgro`: um item
 * de chão é forjado num atlas próprio e não pode arrastar o módulo do
 * bestiário (1000+ linhas, `MODELO_SLIME` construído no import) para dentro do
 * bundle só para ler quatro strings. O acoplamento que importa — "a gosma do
 * frasco é a gosma do bicho" — está preservado no VALOR, e o comentário de
 * cada cor diz de onde ela veio.
 *
 * OS TRÊS TRAÇOS DE IDENTIDADE (o inventário deste item; perder um é perder o
 * item, não é acabamento):
 *
 *   I1  A GOSMA VERDE ocupando o bojo, com o especular claro no alto do
 *       líquido. É ela que diz "isto saiu do slime" — sem ela é um frasco
 *       vazio, indistinguível da poção que o jogo já tem;
 *   I2  A ROLHA no gargalo, em couro claro contra o vidro frio. É o que separa
 *       "frasco fechado, coisa de carregar" de "caco de vidro";
 *   I3  A SILHUETA DE FRASCO — bojo largo, ombro que estreita, gargalo fino.
 *       É o que se lê a 40px quando a cor já não se distingue.
 *
 * A escolha de escala: **4,0u de altura de corpo** (rolha inclusa fecha em
 * ~4,4u). O elenco vive em Slime 7u, Goblin 13u, Guerreiro 18u, Ogro 24u, e o
 * contrato dos despojos manda 3–5u: menos que isso e o frasco some sob o
 * losango de 64×32px; mais e ele compete com o Slime que o largou. Como a
 * diferença de tamanho entre peças deste jogo vem SEMPRE da altura real em `u`
 * (nunca de um fator de escala no sprite — ver [[como-construir-um-personagem]]),
 * este número é a única alavanca de tamanho que existe aqui.
 *
 * A âncora do sprite é o plano z = 0: o fundo do vidro assenta exatamente
 * nele, sem afundar. Ao contrário da bota do Guerreiro (que afunda 1,2u de
 * propósito para o boneco sentar DENTRO do losango), um objeto POUSADO no
 * chão tem de tocá-lo — se afundasse, leria como enterrado.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta
 *
 * Dez cores, nenhuma inventada por gosto:
 *   - as quatro de gosma e o `brilho` são cópia literal de `PALETA_SLIME`
 *     (`./slime`), porque o conteúdo do frasco é o bicho;
 *   - as três de vidro são novas e PRECISAM ser: o Slime não tem vidro na
 *     paleta, e usar verde no recipiente apagaria a leitura de "frasco" (I3) —
 *     o vidro é frio e dessaturado justamente para a gosma quente saltar;
 *   - a rolha reaproveita o couro do Goblin (`couroLuz`/`couroBase`), a mesma
 *     família de material que o resto do jogo usa para couro e cortiça;
 *   - `vazio` e `contorno` seguem a convenção de todos os rigs.
 *
 * `luzAmbar` é EMISSIVA (§1.1): ignora a modulação de luz e continua acesa no
 * escuro. É o mesmo amarelo dos olhos e da bolinha do Slime — e aqui ela é o
 * ponto de brilho que faz o frasco ser AVISTADO no chão de um corredor sem
 * luz. Sem isso, um despojo caído a cinco tiles é invisível e o jogador passa
 * por cima sem saber que existe (o pickup é automático, mas a decisão de ir
 * até lá não é). É um ponto só, de um pixel de arte: o suficiente para chamar
 * o olho, pouco o bastante para não virar tocha.
 * ------------------------------------------------------------------ */

export const PALETA_GOSMA = {
  gosmaLuz: '#7ee89a',    // topo do líquido — cópia de PALETA_SLIME.gosmaLuz
  gosmaBase: '#4fd07a',   // massa da gosma  — cópia de PALETA_SLIME.gosmaBase
  gosmaMeio: '#2fa85e',   // face lateral    — cópia de PALETA_SLIME.gosmaMeio
  gosmaSombra: '#1d7a45', // fundo do bojo   — cópia de PALETA_SLIME.gosmaSombra
  brilho: '#d8fbe6',      // especular do líquido (S3) — cópia de PALETA_SLIME.brilho
  vidroLuz: '#cfe4ee',    // NOVA: aresta iluminada do vidro
  vidroBase: '#9fc0d2',   // NOVA: corpo do vidro, gargalo
  vidroSombra: '#6a8a9c', // NOVA: face afastada do vidro
  rolhaLuz: '#8d6a3c',    // topo da rolha  — cópia de PALETA_GOBLIN.couroLuz
  rolhaBase: '#6b4f2a',   // corpo da rolha — cópia de PALETA_GOBLIN.couroBase
  luzAmbar: '#ffd94a',    // EMISSIVA — o ponto que denuncia o frasco no escuro
  vazio: '#0f2a1c',       // vãos e sombra interna — cópia de PALETA_SLIME.vazio
  contorno: '#0a1a10'     // outline — cópia de PALETA_SLIME.contorno
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorGosma = keyof typeof PALETA_GOSMA;

/* ------------------------------------------------------------------ *
 * 2. Rampas de quantização
 *
 * O fator de luz de cada face NÃO vira cor contínua: ele escolhe o degrau mais
 * próximo dentro da rampa do material (§4.3). É isso que mantém a paleta curta
 * e a cara de arte desenhada à mão.
 *
 * Duas rampas merecem nota:
 *
 * - `brilho` tem rampa própria encadeando de volta na gosma. Se o especular
 *   caísse na rampa `gosma`, o snap o empurraria para `gosmaLuz` nas faces
 *   laterais e o ponto de luz sumiria — o mesmo mecanismo que apaga emissiva
 *   mal-rampada, aqui aplicado a um realce comum.
 * - `ambar` tem UM tom, de propósito. Cor emissiva precisa sobreviver
 *   INTEIRA ao snap: se dividisse rampa com outro material, o degrau vizinho
 *   cobriria o pixel e não sobraria emissivo nenhum para o forge recolar por
 *   cima do escurecimento (a armadilha registrada em [[bestiario-monstros]]).
 * ------------------------------------------------------------------ */

export const RAMPAS_GOSMA = {
  gosma: ['gosmaLuz', 'gosmaBase', 'gosmaMeio', 'gosmaSombra'],
  brilho: ['brilho', 'gosmaLuz', 'gosmaBase', 'gosmaMeio'],
  vidro: ['vidroLuz', 'vidroBase', 'vidroSombra', 'vazio'],
  rolha: ['rolhaLuz', 'rolhaBase', 'vazio', 'contorno'],
  ambar: ['luzAmbar'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorGosma[]>;

/** Rampa a que cada cor pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_GOSMA = {
  gosmaLuz: 'gosma',
  gosmaBase: 'gosma',
  gosmaMeio: 'gosma',
  gosmaSombra: 'gosma',
  brilho: 'brilho',
  vidroLuz: 'vidro',
  vidroBase: 'vidro',
  vidroSombra: 'vidro',
  rolhaLuz: 'rolha',
  rolhaBase: 'rolha',
  luzAmbar: 'ambar',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorGosma, keyof typeof RAMPAS_GOSMA>;

/**
 * As cores que IGNORAM a modulação de luz (§1.1). O forge extrai uma camada
 * emissiva do atlas pronto numa varredura só e a recola por cima do quadro já
 * escurecido — custo zero por frame.
 */
export const CORES_EMISSIVAS_GOSMA: readonly CorGosma[] = ['luzAmbar'];

/* ------------------------------------------------------------------ *
 * 3. Proporções
 *
 * Os números que decidem a silhueta, em `u`, num lugar só: mexer aqui é mexer
 * na leitura, e mexer nas caixas é acabamento.
 * ------------------------------------------------------------------ */

export const PROPORCOES_GOSMA = {
  /** Altura do corpo de vidro (sem rolha). Ver a nota de escala no topo. */
  alturaCorpo: 4.0,
  /** Largura máxima do bojo — a barriga do frasco. */
  larguraBojo: 3.0,
  /** Largura do gargalo. O contraste bojo/gargalo É a silhueta (I3). */
  larguraGargalo: 1.6,
  /** Onde o ombro do frasco começa a estreitar. */
  zOmbro: 2.9,
  /**
   * Altura do líquido dentro do bojo. Ele ocupa a maior parte do corpo de
   * propósito: a gosma é I1, e o vidro só precisa da faixa que sobra.
   */
  nivelGosma: 2.3,
  /**
   * O PISO DE ESPESSURA deste rig, em `u`.
   *
   * A escala de arte do projeto dá ~2,5px de arte por `u`. Uma caixa de 0,3u
   * mede 0,75px: ela não vira pixel nenhum de forma confiável — some, ou pior,
   * aparece só em algumas das oito direções e deixa BURACO por onde o fundo
   * vaza. Foi exatamente o que a rodada 2 produziu (metade de cima do frasco
   * furada como um xadrez). Nada aqui desce abaixo deste valor.
   */
  espessuraMinima: 0.5
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nomes dos nós — chaves estáveis de `Pose`
 *
 * A `Pose` é indexada por STRING: um nó que não existe simplesmente não gira,
 * em silêncio (`../model3d`). Por isso os nomes vivem aqui e nunca em literal
 * solto — a mesma disciplina de `NOS_GUERREIRO` e `NOS_GOBLIN`.
 * ------------------------------------------------------------------ */

export const NOS_GOSMA = {
  raiz: 'raiz',
  frasco: 'frasco'
} as const;

export type NomeNoGosma = (typeof NOS_GOSMA)[keyof typeof NOS_GOSMA];

const P = PROPORCOES_GOSMA;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

/** Caixa COM contorno de silhueta própria (§4.1). */
function peca(cor: CorGosma, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Caixa SEM contorno próprio (§4.5) — o padrão deste rig, como em todos os
 * outros. Só desenha outline a peça que faz SILHUETA EXTERNA; o interior se lê
 * por COR contra a peça vizinha. Num objeto de 4u isso não é preferência: o
 * traço tem 1px de arte em cada borda e uma peça de 1,4u de travessia mede
 * ~3,5px — com outline sobraria 1px de superfície e a peça viraria linha.
 */
function detalhe(cor: CorGosma, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * O frasco inteiro num nó só. Não há articulação para separar: um objeto
 * inanimado não tem membro que gire, e um nó por peça só inflaria a árvore que
 * `achatarRig` percorre a cada quadro do atlas.
 *
 * A ORDEM DAS CAIXAS é o desempate determinístico da ordem do pintor (§4.4):
 * reordená-las muda pixels. Vai de baixo para cima — gosma, ombro, gargalo,
 * rolha, realces.
 *
 * A LIÇÃO QUE ESTE RIG PAGOU (rodada 1, reprovada na bancada): a primeira
 * versão modelava o líquido DENTRO do bojo, recuado 0,35u em cada eixo, com o
 * vidro por fora — que é como um frasco funciona no mundo. Na bancada saiu um
 * bloco cinza-azulado com um chapéu marrom: **caixas são opacas**, o rig não
 * tem transparência, e as paredes de vidro engoliram a gosma inteira. I1
 * (a gosma verde) simplesmente não existia na imagem.
 *
 * A regra que sai daí, e vale para qualquer recipiente futuro deste jogo: **o
 * conteúdo é a SUPERFÍCIE, não o interior**. O bojo é feito de gosma; o vidro
 * aparece só onde o líquido não chega (acima do nível, no gargalo) e como
 * arestas finas nas quinas — que é exatamente como pixel art desenha vidro:
 * por reflexo de borda, não por transparência.
 *
 * A curva do ombro (bojo → gargalo) continua feita com caixas escalonadas,
 * nunca uma: uma caixa só produz degrau reto, que a 40px lê como caixa — e um
 * frasco que lê como caixa perde I3.
 */
function criarFrasco(): No {
  const bojo = P.larguraBojo;
  const fundo = bojo * 0.86; // profundidade: levemente menor que a largura
  return {
    nome: NOS_GOSMA.frasco,
    pivo: [0, 0, 0],
    caixas: [
      /* --- A GOSMA É O CORPO (I1) ---
       * Do chão ao nível do líquido, tudo verde: é a massa que o olho vê
       * primeiro e a razão de o item existir. */
      peca('gosmaBase', [bojo, fundo, P.nivelGosma], [0, 0, P.nivelGosma / 2]),
      /* base mais escura (0,6u = 1,5px): peso, e separa o frasco do piso */
      detalhe('gosmaSombra', [bojo - 0.2, fundo - 0.2, 0.6], [0, 0, 0.3]),
      /* menisco: a lâmina clara no topo do líquido (0,5u = o piso de espessura) */
      detalhe('gosmaLuz', [bojo - 0.6, fundo - 0.6, 0.5], [0, 0, P.nivelGosma - 0.25]),

      /* --- VIDRO ACIMA DO LÍQUIDO (0,6u) ---
       * A faixa onde o frasco está vazio. É aqui — e só aqui — que o vidro
       * pode aparecer sem cobrir I1. */
      peca('vidroBase', [bojo, fundo, P.zOmbro - P.nivelGosma], [0, 0, (P.zOmbro + P.nivelGosma) / 2]),

      /* --- OMBRO: um degrau só, mas GORDO (0,6u) ---
       * A rodada 2 usava dois degraus de 0,42 e 0,34u — ambos sub-pixel, ambos
       * furados. Um degrau que existe lê melhor que dois que não existem. */
      peca('vidroSombra', [bojo - 1.0, fundo - 1.0, 0.6], [0, 0, P.zOmbro + 0.3]),

      /* --- GARGALO (0,8u): metade da silhueta de frasco (I3) --- */
      peca('vidroBase', [P.larguraGargalo, P.larguraGargalo, 0.8], [0, 0, P.alturaCorpo - 0.4]),

      /* --- ROLHA (I2) ---
       * Transborda o gargalo em 0,25u de cada lado: lê como tampa sem virar
       * cogumelo (o defeito da rodada 1, com +0,4u). */
      peca('rolhaBase', [P.larguraGargalo + 0.5, P.larguraGargalo + 0.5, 0.55], [0, 0, P.alturaCorpo + 0.27]),

      /* --- ARESTA DE VIDRO (0,5u de travessia) ---
       * Uma coluna clara na quina frontal, subindo pelo corpo. É o "reflexo"
       * que faz o material ler como vidro sem transparência — pixel art
       * desenha vidro por borda, não por transparência. Uma só: duas, na
       * largura mínima, comeriam a barriga verde. */
      detalhe('vidroLuz', [0.5, 0.5, P.zOmbro - 0.5], [-bojo / 2 + 0.25, -fundo / 2 + 0.25, (P.zOmbro - 0.5) / 2]),

      /* --- O ESPECULAR DA GOSMA (S3 do slime, herdado) ---
       * Na face frontal do líquido, nunca no interior: no interior ele seria
       * comido pela mesma opacidade que matou a rodada 1. */
      detalhe('brilho', [0.55, 0.5, 0.5], [-bojo / 2 + 0.75, -fundo / 2 + 0.2, P.nivelGosma - 0.95]),

      /* --- O PONTO EMISSIVO ---
       * Encostado na face frontal da gosma: é a fagulha que denuncia o frasco
       * num corredor escuro. Na rodada 1 ele estava enterrado no meio do bojo
       * e vazava por baixo como um pixel solto no chão, que lia como sujeira. */
      detalhe('luzAmbar', [0.5, 0.5, 0.5], [bojo / 2 - 0.6, -fundo / 2 + 0.2, P.nivelGosma - 1.0])
    ]
  };
}

/**
 * Monta uma árvore NOVA do frasco. Chame isto (e não mute `MODELO_GOSMA`)
 * sempre que precisar de um rig próprio — variantes, testes, previews.
 */
export function criarModeloGosma(): No {
  return {
    nome: NOS_GOSMA.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarFrasco()]
  };
}

/** O rig canônico do frasco, pronto para o sprite forge. Não mute. */
export const MODELO_GOSMA: No = criarModeloGosma();

/**
 * Repouso VAZIO, de propósito: um frasco não tem membro para articular. A pose
 * existe porque o forge a pede (`opts.repouso`) e porque a coluna
 * ('parado', 0) do atlas devolve exatamente o repouso — que aqui é o objeto
 * como foi modelado.
 */
export const POSE_PARADA_GOSMA: Pose = {};
