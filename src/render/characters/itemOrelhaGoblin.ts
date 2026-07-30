/*
 * ISOROGUE — src/render/characters/itemOrelhaGoblin.ts
 *
 * O rig da ORELHA DE GOBLIN: o despojo do Perseguidor (`./goblin`), a orelha
 * decepada que fica caída no chão da masmorra depois do abate, vira ícone de
 * bolsa e serve de moeda de venda ou de entrega de missão.
 *
 * Mesmo molde dos rigs de personagem e os mesmos limites: é a fonte da verdade
 * da FORMA e da COR, e nada mais. Não projeta, não rasteriza, não conhece
 * Canvas, preço nem missão. Um despojo é APARÊNCIA.
 *
 * AUTONOMIA DELIBERADA — não importa nada de `./goblin`, nem a paleta. Os
 * hexes de pele são cópia literal de `PALETA_GOBLIN` (§12.1 do
 * docs/BESTIARIO.md), pelo motivo registrado em `./itemPeOgro`: um item de
 * chão é forjado num atlas próprio e não pode arrastar o módulo do bestiário
 * (1300 linhas, `MODELO_GOBLIN` construído no import) para o bundle só para
 * ler quatro strings.
 *
 * OS TRÊS TRAÇOS DE IDENTIDADE (perder um é perder o item):
 *
 *   I1  A PONTA AFILADA E LONGA. No cofre deste projeto a orelha é O traço do
 *       goblin — "sem elas vira um anão verde". Aqui a orelha é o item
 *       inteiro: sem a ponta, é um naco de carne verde qualquer;
 *   I2  A CONCHA — a parte larga com a depressão interna mais escura. É o que
 *       diz "orelha" e não "folha" ou "chifre";
 *   I3  A LEITURA DE DECEPADO — ela está DEITADA no chão, com a base cortada
 *       mostrando o corte. Orelha em pé leria como planta brotando do piso.
 *
 * ESCALA: **3,2u de comprimento**, o menor despojo do jogo. O contrato dos
 * itens de chão manda 3–5u e uma orelha é pequena por definição — ela é o
 * despojo COMUM (a chance mais alta da tabela), e um item comum grande demais
 * polui o chão da masmorra quando três goblins morrem na mesma sala. Como toda
 * diferença de tamanho neste jogo vem da altura real em `u` (nunca de escala
 * no sprite), este número é a única alavanca.
 *
 * DEITADA: o comprimento se estende no plano do chão (X/Y) e a altura em Z
 * fica baixa (~1,1u no ponto mais alto). A âncora do sprite é o plano z = 0 e
 * a face de baixo assenta exatamente nele: um objeto POUSADO tem de tocar o
 * chão — se afundasse, leria como enterrado.
 *
 * A ORIENTAÇÃO ESCOLHIDA: a ponta aponta para **+Y** (a frente do espaço do
 * rig) e a concha abre para **+Z** (para cima). Foi a única das quatro
 * combinações testadas em que a ponta sobrevive às oito direções do atlas: com
 * a ponta em +X ela desaparece nas direções em que `artX` só enxerga o eixo Y,
 * e com a concha virada para o lado a depressão interna some pelo culling
 * (uma face que olha para −Y é descartada antes de existir).
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta
 *
 * Sete cores, nenhuma inventada por gosto: as quatro de pele e as duas de
 * fundo são cópia literal de `PALETA_GOBLIN`; `carne` é a única cor NOVA e
 * existe para o corte (I3) — sem ela a base decepada seria pele verde e a
 * orelha leria como inteira, arrancada de um goblin vivo e não colhida de um
 * morto. É um tom só, e de propósito: sangue neste jogo já tem dono (a poça da
 * cinemática de morte, `#6e1414`), e este é o mesmo vermelho escurecido para
 * caber contra o verde sem virar o assunto da peça.
 * ------------------------------------------------------------------ */

export const PALETA_ORELHA_GOBLIN = {
  peleLuz: '#9ecb63',    // dorso contra a luz — cópia de PALETA_GOBLIN.peleLuz
  peleBase: '#6f9e3e',   // pele em geral      — cópia de PALETA_GOBLIN.peleBase
  peleMeio: '#517a2b',   // faces laterais     — cópia de PALETA_GOBLIN.peleMeio
  peleSombra: '#35521c', // interior da concha — cópia de PALETA_GOBLIN.peleSombra
  carne: '#7a2320',      // NOVA: a secção do corte, na base (I3)
  vazio: '#1b2410',      // vãos e sombra interna — cópia de PALETA_GOBLIN.vazio
  contorno: '#121a0b'    // outline — cópia de PALETA_GOBLIN.contorno
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorOrelhaGoblin = keyof typeof PALETA_ORELHA_GOBLIN;

/* ------------------------------------------------------------------ *
 * 2. Rampas de quantização
 *
 * O fator de luz da face escolhe o degrau mais próximo dentro da rampa do
 * material (§4.3) — é isso que mantém a paleta curta e a cara de pixel art.
 *
 * `carne` encadeia em `peleSombra`/`vazio` em vez de ter tons próprios: sem
 * rampa de material ela cairia na rampa DERIVADA do `model3d`, que inventa
 * quatro multiplicações da cor base — cores fora da paleta, gate G5 reprovado
 * por construção. Encadeada, ela escurece DENTRO do que já existe.
 * ------------------------------------------------------------------ */

export const RAMPAS_ORELHA_GOBLIN = {
  pele: ['peleLuz', 'peleBase', 'peleMeio', 'peleSombra'],
  carne: ['carne', 'carne', 'peleSombra', 'vazio'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorOrelhaGoblin[]>;

/** Rampa a que cada cor pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_ORELHA_GOBLIN = {
  peleLuz: 'pele',
  peleBase: 'pele',
  peleMeio: 'pele',
  peleSombra: 'pele',
  carne: 'carne',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorOrelhaGoblin, keyof typeof RAMPAS_ORELHA_GOBLIN>;

/* ------------------------------------------------------------------ *
 * 3. Proporções — os números que decidem a silhueta, num lugar só
 * ------------------------------------------------------------------ */

export const PROPORCOES_ORELHA_GOBLIN = {
  /** Comprimento total, da base cortada à ponta. Ver a nota de escala. */
  comprimento: 3.2,
  /** Largura máxima, na concha. */
  larguraConcha: 1.7,
  /** Altura do ponto mais alto (a borda da concha). Objeto deitado é raso. */
  altura: 1.1,
  /** Quanto do comprimento é concha; o resto é a afilada até a ponta (I1). */
  fatiaConcha: 0.45
} as const;

/* ------------------------------------------------------------------ *
 * 4. Nomes dos nós — chaves estáveis de `Pose`
 *
 * A `Pose` é indexada por STRING e um nó inexistente não gira, em silêncio.
 * Mesma disciplina de `NOS_GUERREIRO` e `NOS_GOBLIN`.
 * ------------------------------------------------------------------ */

export const NOS_ORELHA_GOBLIN = {
  raiz: 'raiz',
  orelha: 'orelha'
} as const;

export type NomeNoOrelhaGoblin = (typeof NOS_ORELHA_GOBLIN)[keyof typeof NOS_ORELHA_GOBLIN];

const P = PROPORCOES_ORELHA_GOBLIN;

/* ------------------------------------------------------------------ *
 * 5. Blockout
 * ------------------------------------------------------------------ */

/** Caixa COM contorno de silhueta própria (§4.1). */
function peca(cor: CorOrelhaGoblin, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro;
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Caixa SEM contorno próprio (§4.5) — o padrão deste rig. Só traça outline a
 * peça que faz SILHUETA EXTERNA; o interior se lê por COR contra a vizinha.
 * Numa peça de 3u isso é sobrevivência: o traço tem 1px de arte em cada borda,
 * e a ponta da orelha mede menos de 1u de travessia — com outline ela seria
 * 100% linha preta e I1 morreria no primeiro quadro.
 */
function detalhe(cor: CorOrelhaGoblin, dim: [number, number, number], centro: [number, number, number]): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/**
 * A orelha num nó só: objeto inanimado não tem membro que gire, e um nó por
 * peça só inflaria a árvore que `achatarRig` percorre a cada quadro.
 *
 * A ORDEM DAS CAIXAS é o desempate determinístico da ordem do pintor (§4.4):
 * reordenar muda pixels. Vai da base (−Y) para a ponta (+Y), e dentro de cada
 * altura, do fundo para a frente.
 *
 * A PONTA é feita com TRÊS caixas escalonadas decrescentes, jamais uma: é a
 * regra de "curva" do método (chifre, cimitarra, antena). Uma caixa só produz
 * um bico reto que a 40px lê como cunha de madeira — e a ponta é I1, o traço
 * que não pode sumir.
 */
function criarOrelha(): No {
  const meio = P.comprimento * P.fatiaConcha; // onde a concha termina
  return {
    nome: NOS_ORELHA_GOBLIN.orelha,
    pivo: [0, 0, 0],
    caixas: [
      /* --- base decepada (I3): a secção do corte, no extremo −Y ---
       * O corte olha para −Y... e uma face −Y é descartada pelo culling
       * (`../model3d`: sobrevive quem tem produto escalar positivo com a
       * direção de visão). Por isso a carne não é a FACE de trás e sim uma
       * FATIA fina de 0,25u: assim ela aparece pelas faces de topo e de lado,
       * que sobrevivem, e o corte se lê nas oito direções. */
      peca('peleBase', [P.larguraConcha * 0.8, 0.5, 0.75], [0, -P.comprimento / 2 + 0.25, 0.38]),
      detalhe('carne', [P.larguraConcha * 0.62, 0.25, 0.55], [0, -P.comprimento / 2 + 0.1, 0.34]),

      /* --- concha (I2): a massa larga, com a borda subindo e a depressão
       * interna em peleSombra. Duas caixas de borda + um miolo rebaixado é o
       * que dá a leitura de "cuia" sem precisar de face côncava, que caixas
       * orientadas não sabem fazer. */
      peca('peleBase', [P.larguraConcha, meio + 0.4, 0.55], [0, -0.35, 0.28]),
      detalhe('peleLuz', [0.35, meio + 0.2, P.altura], [-P.larguraConcha / 2 + 0.18, -0.35, 0.55]),
      detalhe('peleLuz', [0.35, meio + 0.2, P.altura], [P.larguraConcha / 2 - 0.18, -0.35, 0.55]),
      detalhe('peleSombra', [P.larguraConcha - 0.7, meio, 0.3], [0, -0.35, 0.62]),

      /* --- afilada até a ponta (I1): três degraus decrescentes em largura,
       * altura e comprimento, avançando para +Y --- */
      detalhe('peleBase', [P.larguraConcha * 0.62, 0.7, 0.5], [0, meio - 0.15, 0.3]),
      detalhe('peleMeio', [P.larguraConcha * 0.38, 0.6, 0.38], [0, meio + 0.45, 0.26]),
      detalhe('peleLuz', [P.larguraConcha * 0.2, 0.5, 0.26], [0, meio + 0.95, 0.22])
    ]
  };
}

/**
 * Monta uma árvore NOVA da orelha. Chame isto (e não mute
 * `MODELO_ORELHA_GOBLIN`) sempre que precisar de um rig próprio.
 */
export function criarModeloOrelhaGoblin(): No {
  return {
    nome: NOS_ORELHA_GOBLIN.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarOrelha()]
  };
}

/** O rig canônico da orelha, pronto para o sprite forge. Não mute. */
export const MODELO_ORELHA_GOBLIN: No = criarModeloOrelhaGoblin();

/**
 * Repouso VAZIO, de propósito: uma orelha decepada não tem membro para
 * articular. A pose existe porque o forge a pede (`opts.repouso`) e porque a
 * coluna ('parado', 0) do atlas devolve exatamente o repouso — que aqui é o
 * objeto como foi modelado.
 */
export const POSE_PARADA_ORELHA_GOBLIN: Pose = {};
