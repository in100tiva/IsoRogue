/*
 * ISOROGUE — test/model3d-cor.test.ts
 * ==================================================================
 * ÂNCORAS 2 e 3: a REGIÃO DE COR de `src/render/model3d.ts`.
 *
 * Por que este arquivo existe. A âncora 1 (hash dos bytes de `atlas.canvas`
 * depois de `forjarAtlas` com `desenhar`/`medir` INJETADOS) é cega para metade
 * do território: com injeção, `spriteForge.forjar` chama o stub e NÃO chama
 * `desenharModelo` — logo `montarModelo`, `pintarModelo`, `medirModelo`,
 * `fatorLuz`, `quantizar` e `tracarContornoNitido` nunca rodam. Estas duas
 * âncoras fecham exatamente esse buraco, sem canvas de verdade.
 *
 * A DIVISÃO (o que cada hash prende):
 *
 *   cor    — `faces[].cor` indexada por (peça, face), `corContorno`,
 *            `larguraContorno` e quais peças têm silhueta. ZERO ponto
 *            flutuante: só strings e inteiros. É o hash que a rodada do
 *            `modoContorno` vai mover, e o único que pode ser lido como
 *            "a cor mudou" sem ressalva.
 *   ordem  — a sequência (peça.face) na ordem do pintor. Inteiros, mas
 *            derivados de um `sort` por `profundidade` (float): é o hash
 *            FRÁGIL, o único que uma diferença de ULP poderia mexer.
 *   geo    — `pts`, `profundidade` e `limites`, quantizados. Move junto de
 *            qualquer mudança de geometria/projeção/pose.
 *   traco  — âncora 3: o log de chamadas de `pintarModelo` sobre o MESMO
 *            `ModeloMontado`. É o único que cobre `tracarContornoNitido`
 *            (Bresenham, `Math.floor`, a trava `limite`) e a ORDEM
 *            `fillStyle` → `fill` → `strokeStyle` → `stroke` → contorno.
 *
 * Separar não é preciosismo: quando um só número guarda cor + ordem + geometria,
 * vermelho não diz nada. Aqui o vermelho já é o diagnóstico.
 *
 * O RIG É SINTÉTICO DE PROPÓSITO — ver a nota em `RIG_PROVA`.
 */

import { describe, expect, it } from 'vitest';

import { fnv1aStr } from './golden/protocolo';
import { montarModelo, pintarModelo } from '../src/render/model3d';
import type {
  Caixa,
  MaterialPorCor,
  ModeloMontado,
  No,
  OpcoesModelo,
  Paleta3D,
  Pose,
  RampasPorMaterial
} from '../src/render/model3d';

/* ================================================================== *
 * 1. O rig de prova
 *
 * POR QUE SINTÉTICO, e não `MODELO_GOSMA`/`MODELO_GUERREIRO`. Os rigs de
 * `src/render/characters/**` são a fonte da verdade da APARÊNCIA e mudam por
 * decisão de arte — o cabeçalho de `itemGosma.ts` já narra duas rodadas de
 * revisão, e cada uma teria pintado estas âncoras de vermelho por um motivo que
 * nada tem a ver com cor. Uma âncora que se regenera por churn de arte deixa de
 * ser âncora (a regra 3 de `golden.test.ts`: nunca se regenera para consertar
 * vermelho). Este rig é do TESTE, não muda sozinho, e foi desenhado para tocar
 * todos os ramos da região de cor de uma vez:
 *
 *   · `contorno` ligado (padrão) e desligado (`nucleo`, `brilho`);
 *   · cor com rampa CANÔNICA declarada em `rampas` + `rampaDaCor` (`pedra`,
 *     `metal`);
 *   · cor com rampa RICA inline, entrada `Tom` (`cristal`);
 *   · rampa de UM degrau só, o molde das cores emissivas (`brasa`);
 *   · cor AUSENTE da paleta que parece hex → `tomDeFallback` + `rampaDerivada`
 *     (`#c0ffee`);
 *   · cor ausente que NÃO parece hex → cinza médio `#808080` (`corInventada`);
 *   · EMPATE EXATO de luminância dentro de uma rampa (`lasca`) — ver a nota da
 *     paleta. Sem ele o desempate `<` estrito de `quantizar` fica descoberto:
 *     medido por mutação, trocar `<` por `<=` passava com o rig sem `lasca`;
 *   · três níveis de nó com pivô, para a pose girar filho e neto.
 * ------------------------------------------------------------------ */

function peca(
  cor: string,
  dim: readonly [number, number, number],
  centro: readonly [number, number, number],
  contorno?: boolean
): Caixa {
  const c: Caixa = {
    cx: centro[0], cy: centro[1], cz: centro[2],
    sx: dim[0], sy: dim[1], sz: dim[2],
    cor: cor
  };
  if (contorno === false) c.contorno = false;
  return c;
}

/**
 * A paleta é declarada UMA vez e nunca mutada — `normalizarPaleta` memoiza num
 * `WeakMap` chaveado pela IDENTIDADE do objeto (`model3d.ts:362`), e mutar em
 * lugar devolveria tom velho sem jeito de invalidar de fora.
 */
const PALETA_PROVA: Paleta3D = {
  pedraLuz: '#b9b2a4',
  pedraBase: '#8b8577',
  pedraSombra: '#5d584e',
  metalLuz: '#dfe6ef',
  metalBase: '#9aa6b8',
  metalSombra: '#5b6675',
  brasa: '#ff7a2f',
  cristal: { rampa: ['#2a3f7a', '#4f6fd0', '#8fb4ff'], indice: 1 },
  /*
   * O EMPATE DE PROPÓSITO. `#9a7` e `#99aa77` são o MESMO RGB (153,170,119),
   * mas `normalizarRampa` deduplica por STRING em minúsculas — abreviado e
   * estendido são chaves diferentes, então os dois degraus sobrevivem com
   * luminância bit-a-bit idêntica. É a única forma barata de forçar um empate
   * EXATO em `quantizar` sem caçar floats: com `<` estrito vence o primeiro
   * (`#9a7`), com `<=` venceria o segundo — e a string devolvida muda, então o
   * hash de cor se mexe. Não "conserte" esta duplicata: ela É o caso de teste.
   */
  lascaCurta: '#9a7',
  lascaLonga: '#99aa77',
  lascaFundo: '#3a2f22',
  // A chave `contorno` existe para exercitar o ramo em que `opts.corContorno`
  // é `undefined` e `montarModelo` a procura na paleta (model3d.ts:887-889).
  contorno: '#0b0d12'
};

const RAMPAS_PROVA: RampasPorMaterial = {
  pedra: ['pedraLuz', 'pedraBase', 'pedraSombra'],
  metal: ['metalLuz', 'metalBase', 'metalSombra'],
  brasa: ['brasa'],
  lasca: ['lascaCurta', 'lascaLonga', 'lascaFundo']
};

const RAMPA_DA_COR_PROVA: MaterialPorCor = {
  pedraLuz: 'pedra',
  pedraBase: 'pedra',
  pedraSombra: 'pedra',
  metalLuz: 'metal',
  metalBase: 'metal',
  metalSombra: 'metal',
  brasa: 'brasa',
  lascaCurta: 'lasca',
  lascaLonga: 'lasca',
  lascaFundo: 'lasca'
};

const NOS_PROVA = { raiz: 'raiz', haste: 'haste', ponta: 'ponta' } as const;

const RIG_PROVA: No = {
  nome: NOS_PROVA.raiz,
  pivo: [0, 0, 0],
  caixas: [peca('pedraBase', [3, 3, 1], [0, 0, 0.5])],
  filhos: [
    {
      nome: NOS_PROVA.haste,
      pivo: [0, 0, 1],
      caixas: [
        peca('metalBase', [1, 1.4, 3], [0, 0, 1.5]),
        peca('brasa', [0.6, 0.6, 0.6], [0.4, -0.5, 2.2], false)
      ],
      filhos: [
        {
          nome: NOS_PROVA.ponta,
          pivo: [0, 0, 3],
          caixas: [
            peca('cristal', [1.6, 1.2, 1.2], [0, 0, 0.6]),
            peca('#c0ffee', [0.5, 0.5, 0.5], [-0.6, 0.3, 1.1]),
            peca('corInventada', [0.4, 0.4, 0.4], [0.6, 0.3, 1.1], false),
            // A peça do empate — ver a nota de `lascaCurta` na paleta.
            peca('lascaCurta', [0.9, 0.7, 0.5], [0, 0.5, 1.35])
          ]
        }
      ]
    }
  ]
};

const POSE_REPOUSO: Pose = {};
const POSE_TORTA: Pose = {
  [NOS_PROVA.haste]: { rz: 0.7, rx: -0.35 },
  [NOS_PROVA.ponta]: { ry: 1.1 }
};
const POSE_DEITADA: Pose = {
  [NOS_PROVA.haste]: { rx: 1.4 },
  [NOS_PROVA.ponta]: { rz: -2.2, ry: 0.4 }
};

function opcoesBase(pose: Pose, giro: number): OpcoesModelo {
  return {
    paleta: PALETA_PROVA,
    rampas: RAMPAS_PROVA,
    rampaDaCor: RAMPA_DA_COR_PROVA,
    pose: pose,
    giro: giro
  };
}

/* ================================================================== *
 * 2. Serialização estável
 * ================================================================== */

/**
 * Quantização dos floats em milionésimos de px de ARTE.
 *
 * POR QUE 1e-6 E NÃO 1e-3. Não existe arredondamento que seja ao mesmo tempo
 * cego ao ruído de ULP e incapaz de virar numa borda — `toFixed` não remove a
 * navalha, só a muda de lugar. O que se escolhe é a MARGEM:
 *   · piso de ruído: `Math.cos`/`Math.sin` não são especificados bit-a-bit pelo
 *     ECMAScript; num valor de ordem 30px o erro relativo de 1 ULP é ~1e-15 px;
 *   · menor mudança REAL: qualquer regressão de geometria vem de constante ou
 *     fórmula trocada e mexe ≥ 1e-2 px.
 * 1e-6 fica ~9 ordens acima do ruído e ~4 abaixo do menor sinal — margem dos
 * dois lados. 1e-3 também não esconderia regressão de verdade, mas gasta 3
 * ordens de folga sem comprar nada.
 *
 * `String(-0) === '0'`, então zero negativo não vira hash diferente. Não-finito
 * vira token explícito em vez de `null` (o que `JSON.stringify` faria, colidindo
 * com um `null` legítimo).
 */
function q(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
  return String(Math.round(v * 1e6));
}

/**
 * Chave estável de uma face: (peça, face) — a identidade DECLARADA, imune à
 * ordenação por profundidade.
 */
function chaveFace(peca: number, face: number): string {
  return String(peca).padStart(4, '0') + '.' + String(face);
}

/**
 * ÂNCORA 2a — a projeção de COR. Não contém um único float: cor de face, cor de
 * contorno, largura, e quantos segmentos de silhueta cada peça produziu.
 * Indexada e ORDENADA por (peça, face), de modo que um empate de `profundidade`
 * resolvido de outro jeito não a mova.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A ÚNICA MANUTENÇÃO OBRIGATÓRIA DA RODADA DO `modoContorno`.             │
 * │                                                                         │
 * │ Hoje a cor da borda é UMA para o modelo inteiro e cabe em `corContorno`. │
 * │ O modo novo (borda = cor local escurecida) exige um canal de cor POR     │
 * │ PEÇA, e é aqui que ele tem de entrar — junto de `sil<peça>`. Se o campo  │
 * │ novo não for serializado, este hash continua VERDE com a borda pintada   │
 * │ da cor errada: falso verde, o único modo de falha que uma âncora não     │
 * │ pode ter. Ao acrescentar `modoContorno`, estenda `silhuetas` com a cor   │
 * │ resolvida da peça ANTES de regerar a baseline.                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
function projecaoCor(m: ModeloMontado): string {
  const linhas: string[] = [];
  for (let i = 0; i < m.faces.length; i++) {
    const f = m.faces[i];
    linhas.push(chaveFace(f.peca, f.face) + '=' + f.cor);
  }
  // Silhueta por PEÇA (não por índice de face): o slot em `contornoApos` é a
  // última face visível daquela peça, e esse índice muda com a ordenação.
  const silhuetas: string[] = [];
  for (let i = 0; i < m.contornoApos.length; i++) {
    const seg = m.contornoApos[i];
    if (seg === null) continue;
    silhuetas.push('sil' + String(m.faces[i].peca).padStart(4, '0') + '=' + String(seg.length / 4));
  }
  linhas.sort();
  silhuetas.sort();
  return (
    'contorno=' + (m.corContorno === null ? 'nulo' : m.corContorno) +
    '|largura=' + String(m.larguraContorno) +
    '|nfaces=' + String(m.faces.length) +
    '|' + linhas.join(';') +
    '|' + silhuetas.join(';')
  );
}

/**
 * ÂNCORA 2b — a ORDEM DO PINTOR. Inteiros, mas nascidos de um `sort` por float
 * (`model3d.ts:979-981`). É o hash frágil por construção: se algum dia ele
 * mover sozinho entre versões de Node, é aqui que se olha primeiro.
 */
function projecaoOrdem(m: ModeloMontado): string {
  const partes: string[] = [];
  for (let i = 0; i < m.faces.length; i++) partes.push(m.faces[i].peca + '.' + m.faces[i].face);
  return partes.join(',');
}

/**
 * ÂNCORA 2c — a GEOMETRIA. Também indexada por (peça, face) e ordenada por essa
 * chave, para que uma troca na ordem do pintor apareça só em `ordem` e não
 * contamine este hash.
 */
function projecaoGeo(m: ModeloMontado): string {
  const linhas: string[] = [];
  for (let i = 0; i < m.faces.length; i++) {
    const f = m.faces[i];
    const pts: string[] = [];
    for (let k = 0; k < f.pts.length; k++) pts.push(q(f.pts[k]));
    const seg = m.contornoApos[i];
    const sil: string[] = [];
    if (seg !== null) for (let k = 0; k < seg.length; k++) sil.push(q(seg[k]));
    linhas.push(chaveFace(f.peca, f.face) + '=' + pts.join(',') + '@' + q(f.profundidade) + '#' + sil.join(','));
  }
  linhas.sort();
  const l = m.limites;
  return (
    'lim=' + [q(l.minX), q(l.minY), q(l.maxX), q(l.maxY), q(l.largura), q(l.altura)].join(',') +
    '|' + linhas.join(';')
  );
}

/* ================================================================== *
 * 3. Âncora 3 — o contexto que só ANOTA
 * ================================================================== */

interface Anotador {
  ctx: CanvasRenderingContext2D;
  log: string[];
}

/**
 * Um `CanvasRenderingContext2D` de mentira que não desenha nada e registra tudo,
 * ATRIBUIÇÃO DE PROPRIEDADE INCLUSA.
 *
 * As atribuições são a metade que importa aqui: o defeito clássico da rodada do
 * `modoContorno` é calcular a cor certa e aplicá-la DEPOIS do `fill()`, ou
 * deixar o `fillStyle` da selagem vazar para o contorno. Um objeto de campos
 * simples não veria isso; por isso `fillStyle`/`strokeStyle`/`lineWidth`/… são
 * ACESSORES que empurram para o log na ordem exata em que `pintarModelo` os
 * toca. O `cast` é inevitável: `pintarModelo` pede o tipo do DOM inteiro e usa
 * doze membros dele.
 */
function contextoAnotador(): Anotador {
  const log: string[] = [];
  let fillStyle: unknown = '#000';
  let strokeStyle: unknown = '#000';
  let lineWidth = 1;
  let lineCap = 'butt';
  let lineJoin = 'miter';
  let miterLimit = 10;

  const alvo = {
    get fillStyle(): unknown { return fillStyle; },
    set fillStyle(v: unknown) { fillStyle = v; log.push('fillStyle=' + String(v)); },
    get strokeStyle(): unknown { return strokeStyle; },
    set strokeStyle(v: unknown) { strokeStyle = v; log.push('strokeStyle=' + String(v)); },
    get lineWidth(): number { return lineWidth; },
    set lineWidth(v: number) { lineWidth = v; log.push('lineWidth=' + q(v)); },
    get lineCap(): string { return lineCap; },
    set lineCap(v: string) { lineCap = v; log.push('lineCap=' + v); },
    get lineJoin(): string { return lineJoin; },
    set lineJoin(v: string) { lineJoin = v; log.push('lineJoin=' + v); },
    get miterLimit(): number { return miterLimit; },
    set miterLimit(v: number) { miterLimit = v; log.push('miterLimit=' + q(v)); },
    save(): void { log.push('save'); },
    restore(): void { log.push('restore'); },
    beginPath(): void { log.push('beginPath'); },
    closePath(): void { log.push('closePath'); },
    moveTo(x: number, y: number): void { log.push('moveTo(' + q(x) + ',' + q(y) + ')'); },
    lineTo(x: number, y: number): void { log.push('lineTo(' + q(x) + ',' + q(y) + ')'); },
    rect(x: number, y: number, w: number, h: number): void {
      log.push('rect(' + q(x) + ',' + q(y) + ',' + q(w) + ',' + q(h) + ')');
    },
    fill(): void { log.push('fill'); },
    stroke(): void { log.push('stroke'); }
  };

  return { ctx: alvo as unknown as CanvasRenderingContext2D, log: log };
}

/**
 * ÂNCORA 3 — o traço. `pintarModelo` sobre o MESMO `ModeloMontado` que a âncora
 * 2 hasheia: as duas medem faces do mesmo objeto, então uma divergência só na 3
 * é necessariamente da rasterização (`tracarContornoNitido`) ou da ordem de
 * `pintarModelo`, nunca da montagem.
 */
function projecaoTraco(m: ModeloMontado): string {
  const a = contextoAnotador();
  pintarModelo(a.ctx, m);
  return a.log.join('|');
}

/* ================================================================== *
 * 4. Os casos e a baseline
 * ================================================================== */

interface Caso {
  nome: string;
  opts: OpcoesModelo;
}

const CASOS: readonly Caso[] = [
  { nome: 'repouso/giro0', opts: opcoesBase(POSE_REPOUSO, 0) },
  { nome: 'torta/giro+45', opts: opcoesBase(POSE_TORTA, Math.PI / 4) },
  { nome: 'deitada/giro-120', opts: opcoesBase(POSE_DEITADA, (-Math.PI * 2) / 3) },
  // Variantes de OPÇÃO sobre a pose canônica — os dois interruptores que a
  // rodada do `modoContorno` mais arrisca desligar por acidente.
  {
    nome: 'repouso/semContorno',
    opts: { ...opcoesBase(POSE_REPOUSO, 0), corContorno: null }
  },
  {
    nome: 'repouso/larguraZero',
    opts: { ...opcoesBase(POSE_REPOUSO, 0), larguraContorno: 0 }
  },
  {
    nome: 'repouso/semQuantizacao',
    opts: { ...opcoesBase(POSE_REPOUSO, 0), quantizar: false }
  }
];

/**
 * A BASELINE. Regenerar é ato deliberado, com a mesma disciplina de
 * `test/golden.test.ts`: só quando o comportamento mudou DE PROPÓSITO, com
 * registro do porquê. Vermelho aqui é regressão até prova em contrário.
 */
const BASELINE: Readonly<Record<string, string>> = {
  'repouso/giro0:cor': 'cdc13b86',
  'repouso/giro0:ordem': 'ae4061ea',
  'repouso/giro0:geo': '623e9d4a',
  'repouso/giro0:traco': '4fc722b8',
  'torta/giro+45:cor': '281fd8ea',
  'torta/giro+45:ordem': 'c924f1d6',
  'torta/giro+45:geo': 'e43850a9',
  'torta/giro+45:traco': '95809359',
  'deitada/giro-120:cor': '5ac2634d',
  'deitada/giro-120:ordem': 'eb41ff15',
  'deitada/giro-120:geo': '8432246f',
  'deitada/giro-120:traco': '71cc5820',
  // As três variantes de opção NÃO movem geometria nem ordem — os hashes
  // `geo`/`ordem` delas são, de propósito, os mesmos de `repouso/giro0`. Se
  // algum dia divergirem, a rodada em curso mexeu em algo que não devia.
  'repouso/semContorno:cor': '02a781ba',
  'repouso/semContorno:ordem': 'ae4061ea',
  'repouso/semContorno:geo': '623e9d4a',
  'repouso/semContorno:traco': '14b16d79',
  'repouso/larguraZero:cor': '994b1d1d',
  'repouso/larguraZero:ordem': 'ae4061ea',
  'repouso/larguraZero:geo': '623e9d4a',
  // Mesmo traço de `semContorno`: os dois desligamentos passam pelo mesmo
  // portão em `pintarModelo:1102`.
  'repouso/larguraZero:traco': '14b16d79',
  'repouso/semQuantizacao:cor': 'ef53e52b',
  'repouso/semQuantizacao:ordem': 'ae4061ea',
  'repouso/semQuantizacao:geo': '623e9d4a',
  'repouso/semQuantizacao:traco': 'aa3ebc60'
};

function conferir(chave: string, texto: string): void {
  const obtido = fnv1aStr(texto);
  const esperado = BASELINE[chave];
  expect(esperado, 'baseline ausente para ' + chave + ' — valor de hoje: ' + obtido).toBeTruthy();
  expect(obtido, chave).toBe(esperado);
}

describe('model3d — âncora 2: a saída de montarModelo', () => {
  for (const caso of CASOS) {
    it('cor: ' + caso.nome, () => {
      conferir(caso.nome + ':cor', projecaoCor(montarModelo(RIG_PROVA, caso.opts)));
    });
    it('ordem do pintor: ' + caso.nome, () => {
      conferir(caso.nome + ':ordem', projecaoOrdem(montarModelo(RIG_PROVA, caso.opts)));
    });
    it('geometria: ' + caso.nome, () => {
      conferir(caso.nome + ':geo', projecaoGeo(montarModelo(RIG_PROVA, caso.opts)));
    });
  }

  it('montarModelo não muta o rig nem as opções', () => {
    const antesRig = JSON.stringify(RIG_PROVA);
    const opts = opcoesBase(POSE_TORTA, 0.5);
    const antesOpts = JSON.stringify({ pose: opts.pose, giro: opts.giro });
    montarModelo(RIG_PROVA, opts);
    montarModelo(RIG_PROVA, opts);
    expect(JSON.stringify(RIG_PROVA)).toBe(antesRig);
    expect(JSON.stringify({ pose: opts.pose, giro: opts.giro })).toBe(antesOpts);
  });

  it('duas chamadas seguidas devolvem objetos novos e idênticos', () => {
    const opts = opcoesBase(POSE_TORTA, 0.5);
    const a = montarModelo(RIG_PROVA, opts);
    const b = montarModelo(RIG_PROVA, opts);
    expect(a).not.toBe(b);
    expect(projecaoCor(a)).toBe(projecaoCor(b));
    expect(projecaoGeo(a)).toBe(projecaoGeo(b));
  });
});

describe('model3d — âncora 3: o traço de pintarModelo', () => {
  for (const caso of CASOS) {
    it('traço: ' + caso.nome, () => {
      conferir(caso.nome + ':traco', projecaoTraco(montarModelo(RIG_PROVA, caso.opts)));
    });
  }

  it('ctx nulo sai em silêncio', () => {
    expect(() => pintarModelo(null, montarModelo(RIG_PROVA, opcoesBase(POSE_REPOUSO, 0)))).not.toThrow();
  });
});
