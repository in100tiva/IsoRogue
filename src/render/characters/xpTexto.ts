/*
 * ISOROGUE — src/render/characters/xpTexto.ts
 *
 * O texto de XP flutuante dos abates (+25, +50, +100, +200, +400, +800 … — a
 * escala de §15 do BESTIARIO: 100 × 2^(nivelMonstro − nivelHeroi), cortada a
 * zero com três níveis de diferença) como rig de caixas, na MESMA
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
 * (`game.abatesRecentes`); este módulo só sabe desenhar um número. Desde que o
 * nível do monstro passou a subir com o andar, o conjunto de valores deixou de
 * ser fechado — ver `modeloDeXp`.
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
 * Os cinco valores que a escala de §15 produzia quando o nível do monstro era
 * só o do arquétipo. Continuam pré-forjados no import porque são os que quase
 * todo abate rende — mas o conjunto DEIXOU DE SER FECHADO (ver `modeloDeXp`).
 */
export const MODELO_XP: Readonly<Record<number, No>> = {
  25: criarModeloXpTexto('+25'),
  50: criarModeloXpTexto('+50'),
  100: criarModeloXpTexto('+100'),
  200: criarModeloXpTexto('+200'),
  400: criarModeloXpTexto('+400')
};

/** Teto de rigs memoizados. Ver `modeloDeXp` — é trava de vazamento, não de escala. */
const TETO_MEMO = 32;

/** Os rigs forjados sob demanda, além dos cinco de `MODELO_XP`. */
const memo = new Map<number, No>();

/**
 * O rig de um valor de XP.
 *
 * O CONJUNTO ERA FECHADO em 25/50/100/200/400 e deixou de ser na emenda da
 * descida: o nível do monstro passou a somar um por andar (`nivelDoMonstro`,
 * engine/entities.ts), então 800, 1600 e adiante são valores COMUNS — um goblin
 * do andar 3 contra um herói de nível 1 rende 800. Com a tabela fechada esses
 * abates simplesmente não mostravam texto, e o flutuante sumia exatamente nos
 * abates que mais valem a pena celebrar.
 *
 * A cura não é acrescentar dois números à tabela — seria a mesma dívida adiada
 * dois andares. O rig é construído a partir da string do valor, e construir é
 * barato (um punhado de caixas por glifo, uma vez por valor); o que era caro
 * seria refazê-lo por quadro, e disso cuida a memoização — aqui e, do outro
 * lado, o `atlasXp` do IsoRenderer, que memoiza o ATLAS (o custo real: a
 * rasterização).
 *
 * O teto existe como trava de vazamento, não como régua de escala: os valores
 * são potências de dois vezes 100, então 32 chaves cobrem de 25 a 8·10^8 e
 * nenhuma partida real chega perto. Estourado o teto, o rig ainda é DEVOLVIDO —
 * só não fica guardado. Degradar em desempenho, nunca em imagem.
 *
 * Devolve `null` só para o que não é valor de XP: zero (a escala cortou — §16
 * manda não desenhar), negativo, não-inteiro ou não-finito.
 */
export function modeloDeXp(xp: number): No | null {
  const pronto = MODELO_XP[xp];
  if (pronto) return pronto;
  if (!Number.isFinite(xp) || !Number.isInteger(xp) || xp <= 0) return null;
  const guardado = memo.get(xp);
  if (guardado) return guardado;
  const rig = criarModeloXpTexto('+' + xp);
  if (memo.size < TETO_MEMO) memo.set(xp, rig);
  return rig;
}
