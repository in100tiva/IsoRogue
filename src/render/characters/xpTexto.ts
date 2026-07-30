/*
 * ISOROGUE — src/render/characters/xpTexto.ts
 *
 * O texto de XP flutuante dos abates (+25, +50, +100, +200, +400 — o conjunto
 * FECHADO da escala de §15 do BESTIARIO: 100 × 2^(nivelMonstro − nivelHeroi),
 * cortada a zero com três níveis de diferença) como rig de caixas, na MESMA
 * técnica dos personagens (docs/PERSONAGEM.md §4): cada pixel do glifo é um
 * cubo de 1u, o rig inteiro é rasterizado no buffer de arte com a projeção
 * isométrica de sempre e lido na coluna ('parado', 0) de um atlas forjado sob
 * demanda pelo IsoRenderer.
 *
 * Não é texto de canvas (`fillText` ficaria liso contra a pixel art e quebraria
 * o gate G5 por construção): o "3D" sai da GEOMETRIA — cada cubo tem topo,
 * frente e lado, e a quantização de §4.3 dá a leitura de bloco.
 *
 * Nada aqui toca o engine (R54): quem decide QUANTO vale o texto é o engine
 * (`game.abatesRecentes`); este módulo só sabe desenhar os cinco valores.
 */

import type { Caixa, No } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta e rampas (§2/§4.3 do PERSONAGEM.md) — ouro de XP, sem cor
 *    inventada: o âmbar é o da bolinha do Slime e dos olhos em `+`, que já é
 *    a cor de "recompensa luminosa" do jogo.
 * ------------------------------------------------------------------ */

export const PALETA_XP = {
  xpLuz: '#ffe98a', // topo dos cubos (o brilho)
  xpBase: '#ffd94a', // corpo dos glifos — o `luzAmbar` da paleta do Slime
  xpMeio: '#d9a82e', // faces laterais
  xpSombra: '#8a6414', // faces afastadas
  contorno: '#2a1c08' // outline
} as const;

/** Nome de cor válido para uma caixa do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorXp = keyof typeof PALETA_XP;

/** A rampa única (tudo é o mesmo ouro), do mais claro ao mais escuro (§4.3). */
export const RAMPAS_XP = {
  ouro: ['xpLuz', 'xpBase', 'xpMeio', 'xpSombra']
} as const satisfies Record<string, readonly CorXp[]>;

/** Rampa a que cada cor de caixa pertence — usada pela quantização de §4.3. */
export const RAMPA_DA_COR_XP = {
  xpLuz: 'ouro',
  xpBase: 'ouro',
  xpMeio: 'ouro',
  xpSombra: 'ouro',
  contorno: 'ouro'
} as const satisfies Record<CorXp, keyof typeof RAMPAS_XP>;

/* ------------------------------------------------------------------ *
 * 2. A fonte 3×5 — cada glifo é três colunas de cinco pixels. O `+` ocupa as
 *    três linhas do meio para pendurar na linha de base dos dígitos.
 * ------------------------------------------------------------------ */

const GLIFOS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...']
};

/** Colunas por glifo, mais uma de espaço entre eles. */
const LARGURA_GLIFO = 3;
const ESPACO = 1;
const ALTURA = 5;

/**
 * Monta o rig de um texto de XP: um nó único (nada de hierarquia — o texto não
 * tem articulação), com cada pixel do glifo virando um cubo de ouro.
 *
 * A ARMADILHA deste rig (rodada 1, reprovada na bancada): glifos deitados no
 * plano X-Z do modelo ficam ILEGÍVEIS. A projeção de §4.2 leva o passo +X para
 * (1, +0,5) na tela — a grade 3×5 da fonte cisalha ~26° e o bitmap vira um
 * emaranhado de cubos. Um rig humanoide lê pelo VOLUME e não se importa; um
 * TEXTO lê pelo bitmap, e o bitmap não sobrevive ao cisalhamento.
 *
 * A cura é a "pré-distorção de outdoors": posicionar os pixels para que, DEPOIS
 * da projeção, caiam numa grade QUADRADA na tela. Da álgebra de §4.2 (com A =
 * ART_POR_U): o passo modelo (e, −e, 0) anda 2eA em artX e zero em artY — é o
 * passo horizontal da fonte; o passo modelo (−f, −f, 2f) anda zero em artX e
 * −3fA em artY — é o passo vertical. Com e = 0,5 e f = 1/3 os dois valem o
 * mesmo pitch na tela e a fonte fica quadrada e legível — mas cada pixel
 * continua sendo um CUBO isométrico (topo/frente/lado, ouro quantizado), que
 * é o "3D pixel art" do pedido: a leitura vem do bitmap, o volume vem do cubo.
 */
export function criarModeloXpTexto(texto: string): No {
  const caixas: Caixa[] = [];
  const e = 0.5;             // meio passo horizontal do billboard (2eA = pitch na tela)
  const f = 1 / 3;           // passo vertical do billboard (3fA = mesmo pitch)
  const lado = 0.7;          // aresta do cubo — quase tocando na linha, tocando na coluna
  const passo = LARGURA_GLIFO + ESPACO;
  const larguraTotal = (texto.length * passo - ESPACO) * e;
  const u0 = -larguraTotal / 2 + (LARGURA_GLIFO * e) / 2;
  for (let i = 0; i < texto.length; i++) {
    const glifo = GLIFOS[texto.charAt(i)];
    if (!glifo) continue;
    for (let r = 0; r < ALTURA; r++) {
      const linha = glifo[r];
      for (let c = 0; c < LARGURA_GLIFO; c++) {
        if (linha.charAt(c) !== '#') continue;
        const u = u0 + (i * passo + c - (LARGURA_GLIFO - 1) / 2) * e;
        const v = (ALTURA - 1 - r) * f;
        caixas.push({
          cx: u - v,
          cy: -u - v,
          cz: 2 * v + lado / 2,
          sx: lado,
          sy: lado,
          sz: lado,
          cor: 'xpBase'
        });
      }
    }
  }
  return { nome: 'raiz', pivo: [0, 0, 0], caixas };
}

/**
 * Os cinco valores da escala de §15, forjáveis. Fora deles o renderer NÃO
 * desenha flutuante nenhum (degradar sem lançar: uma escala futura que gere
 * outro valor simplesmente não mostra texto até o modelo existir — nunca
 * quebra o jogo).
 */
export const MODELO_XP: Readonly<Record<number, No>> = {
  25: criarModeloXpTexto('+25'),
  50: criarModeloXpTexto('+50'),
  100: criarModeloXpTexto('+100'),
  200: criarModeloXpTexto('+200'),
  400: criarModeloXpTexto('+400')
};

/** O rig de um valor de XP, ou `null` fora do conjunto fechado (§15). */
export function modeloDeXp(xp: number): No | null {
  return MODELO_XP[xp] ?? null;
}
