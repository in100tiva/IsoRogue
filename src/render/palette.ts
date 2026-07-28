/*
 * ISOROGUE — src/render/palette.ts
 *
 * Paleta (§12 do docs/CONTRACTS.md) e construção das LUTs de cor usadas pelo
 * IsoRenderer. Porte 1:1 de legacy/src-vanilla/50-render.js — os valores das
 * cores, as fórmulas de iluminação e o número de níveis são CONTRATO visual:
 * mudar qualquer constante daqui muda a aparência do jogo.
 *
 * Regras deste módulo:
 *   - Sem DOM, sem React, sem `Math.random`. Só aritmética de cor.
 *   - `buildLuts()` devolve um bloco NOVO a cada chamada: as tabelas são
 *     propriedade da instância do renderizador, nunca estado de módulo
 *     (dois canvases simultâneos não podem compartilhar buffer nenhum).
 */

/** Cor em componentes 0..255, sem alfa. Mutável só durante o cálculo das LUTs. */
export type Rgb = [number, number, number];

/* ------------------------------------------------------------------ *
 * 1. Paleta (§12 do contrato)
 * ------------------------------------------------------------------ */

export const COL_BG = '#0d1014';

export const RGB_FLOOR: Rgb = [58, 66, 80]; // #3a4250
export const RGB_WALL: Rgb = [82, 93, 110]; // #525d6e
export const RGB_AMBER: Rgb = [224, 164, 60]; // #e0a43c
export const RGB_GREEN: Rgb = [95, 179, 106]; // #5fb36a
export const RGB_RED: Rgb = [217, 83, 79]; // #d9534f
export const RGB_BLUE: Rgb = [74, 144, 217]; // #4a90d9
export const RGB_PURPLE: Rgb = [176, 111, 208]; // #b06fd0
export const RGB_CYAN: Rgb = [63, 208, 216]; // #3fd0d8
export const RGB_MAGENTA: Rgb = [224, 79, 160]; // #e04fa0
export const RGB_WEAK: Rgb = [125, 136, 153]; // #7d8899
export const RGB_TEXT: Rgb = [201, 211, 222]; // #c9d3de
export const RGB_PLAYER: Rgb = [219, 228, 239];
export const RGB_COLD: Rgb = [26, 34, 47]; // névoa fria
export const RGB_WARM: Rgb = [255, 198, 120]; // luz âmbar quente
export const RGB_WHITE: Rgb = [255, 255, 255];

export const COL_EDGE_LIT = 'rgba(255,255,255,0.070)';
export const COL_EDGE_DIM = 'rgba(255,255,255,0.028)';
export const COL_WALL_EDGE_LIT = 'rgba(255,255,255,0.085)';
export const COL_WALL_EDGE_DIM = 'rgba(255,255,255,0.030)';
export const COL_SHADOW_ENT = 'rgba(5,7,11,0.42)';
export const COL_SHADOW_WALL = 'rgba(6,8,12,0.34)';
export const COL_SHADOW_WALL_DIM = 'rgba(6,8,12,0.18)';
export const COL_HOVER_FILL = 'rgba(224,164,60,0.10)';
export const COL_HOVER_LINE = '#e0a43c';
export const COL_HPBAR_BG = 'rgba(8,10,14,0.78)';
export const COL_GRID = 'rgba(201,211,222,0.10)';
export const COL_PROBE = 'rgba(63,208,216,0.22)';
export const COL_PROBE_LINE = 'rgba(63,208,216,0.55)';
export const COL_BROKEN = 'rgba(224,79,160,0.34)';
export const COL_BROKEN_LINE = '#e04fa0';

export const FONT_MONO =
  '10px ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace';

/* ------------------------------------------------------------------ *
 * 2. Helpers de cor (usados só na construção das LUTs)
 * ------------------------------------------------------------------ */

function mul(c: Rgb, f: number): Rgb {
  return [c[0] * f, c[1] * f, c[2] * f];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function desat(c: Rgb, t: number): Rgb {
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return mix(c, [l, l, l], t);
}

function ch(v: number): number {
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

function rgbStr(c: Rgb): string {
  return 'rgb(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ')';
}

function rgbaStr(c: Rgb, a: number): string {
  return (
    'rgba(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ',' +
    Math.round(a * 1000) / 1000 + ')'
  );
}

/* ------------------------------------------------------------------ *
 * 3. LUTs
 * ------------------------------------------------------------------ */

/** Níveis de luz 0..16 (17 degraus). Índice máximo é sempre `LEVELS - 1`. */
export const LEVELS = 17;

/** Baldes de variação vinda de `map.decor` (3 bits: `decor[i] & 7`). */
export const DEC_B = 8;

/** Tons pré-calculados de uma silhueta: corpo, facetas escuras e realces. */
export interface Shades {
  main: string[];
  dark: string[];
  light: string[];
}

/** Chaves de `Luts.SHADES` — arquétipos mais jogador, poção, âmbar e pedra. */
export type ShadeKey = 'player' | 'chaser' | 'sentinel' | 'linker' | 'potion' | 'amber' | 'stone';

/**
 * Bloco completo de tabelas de cor. Todas as buscas do laço quente saem daqui:
 * nenhuma string de cor é montada durante o desenho.
 */
export interface Luts {
  /** d² (inteiro) -> nível 0..16. */
  LIGHT_LEVEL: Uint8Array;
  /** [ladrilho][balde][nível] */
  FLOOR_LIT: string[][][];
  /** [ladrilho][balde] */
  FLOOR_DIM: string[][];
  /** [face][balde][nível] — face: 0 topo, 1 esquerda, 2 direita. */
  WALL_LIT: string[][][];
  /** [face][balde] */
  WALL_DIM: string[][];
  SHADES: Record<ShadeKey, Shades>;
  /** [0..16] vermelho -> verde. */
  HP_COL: string[];
  /** [0..16] clarão branco quente. */
  FLASH_COL: string[];
  /** Cor do número de Dijkstra por magnitude. */
  DMAP_COL: string[];
  /** '0'..'999' — evita alocar string no laço de debug. */
  NUMSTR: string[];
}

/** Variação sutil de luminosidade de ±6% derivada de `map.decor`. */
function decorFactor(b: number): number {
  return 0.94 + (b / (DEC_B - 1)) * 0.12;
}

function litColor(base: Rgb, level: number): Rgb {
  const b = level / (LEVELS - 1);
  let c = mul(base, 0.32 + 0.68 * b);
  c = mix(c, RGB_COLD, 0.34 * (1 - b));
  c = mix(c, RGB_WARM, 0.2 * b * b);
  return c;
}

/** Explorado fora do FOV: estrutura estática dessaturada e escura (R30). */
function dimColor(base: Rgb): Rgb {
  const c = mul(desat(base, 0.58), 0.4);
  return mix(c, RGB_COLD, 0.45);
}

function litEntity(base: Rgb, level: number): Rgb {
  const b = level / (LEVELS - 1);
  const c = mul(base, 0.5 + 0.5 * b);
  return mix(c, RGB_WARM, 0.12 * b);
}

function buildShades(base: Rgb): Shades {
  const main: string[] = [];
  const dark: string[] = [];
  const light: string[] = [];
  for (let l = 0; l < LEVELS; l++) {
    const c = litEntity(base, l);
    main.push(rgbStr(c));
    dark.push(rgbStr(mul(c, 0.6)));
    light.push(rgbStr(mix(c, RGB_WHITE, 0.38)));
  }
  return { main: main, dark: dark, light: light };
}

/**
 * Monta um bloco de LUTs novo para o raio de FOV informado.
 * Chamado uma vez por instância de renderizador — nunca no laço de desenho.
 */
export function buildLuts(fovRadius: number): Luts {
  // luz radial quente: 1 - (d / raio)^1.6
  const maxD2 = (fovRadius + 2) * (fovRadius + 2) + 2;
  const LIGHT_LEVEL = new Uint8Array(maxD2);
  for (let d2 = 0; d2 < maxD2; d2++) {
    const d = Math.sqrt(d2);
    let br = 1 - Math.pow(d / fovRadius, 1.6);
    if (br < 0) br = 0;
    if (br > 1) br = 1;
    LIGHT_LEVEL[d2] = Math.round(br * (LEVELS - 1));
  }

  const FLOOR_LIT: string[][][] = [];
  const FLOOR_DIM: string[][] = [];
  for (let v = 0; v < 2; v++) {
    const litRow: string[][] = [];
    const dimRow: string[] = [];
    for (let b = 0; b < DEC_B; b++) {
      const fbase = mul(RGB_FLOOR, decorFactor(b) * (v ? 0.955 : 1));
      const lv: string[] = [];
      for (let l = 0; l < LEVELS; l++) lv.push(rgbStr(litColor(fbase, l)));
      litRow.push(lv);
      dimRow.push(rgbStr(dimColor(fbase)));
    }
    FLOOR_LIT.push(litRow);
    FLOOR_DIM.push(dimRow);
  }

  // faces do prisma: esquerda 18% mais escura, direita 32% mais escura
  const faceF = [1, 0.82, 0.68];
  const WALL_LIT: string[][][] = [];
  const WALL_DIM: string[][] = [];
  for (let f = 0; f < 3; f++) {
    const wl: string[][] = [];
    const wd: string[] = [];
    for (let b = 0; b < DEC_B; b++) {
      const wbase = mul(RGB_WALL, decorFactor(b) * faceF[f]);
      const wv: string[] = [];
      for (let l = 0; l < LEVELS; l++) wv.push(rgbStr(litColor(wbase, l)));
      wl.push(wv);
      wd.push(rgbStr(dimColor(wbase)));
    }
    WALL_LIT.push(wl);
    WALL_DIM.push(wd);
  }

  const SHADES: Record<ShadeKey, Shades> = {
    player: buildShades(RGB_PLAYER),
    chaser: buildShades(RGB_RED),
    sentinel: buildShades(RGB_BLUE),
    linker: buildShades(RGB_PURPLE),
    potion: buildShades(RGB_GREEN),
    amber: buildShades(RGB_AMBER),
    stone: buildShades(RGB_WALL)
  };

  const HP_COL: string[] = [];
  const FLASH_COL: string[] = [];
  for (let l = 0; l < LEVELS; l++) {
    const t = l / (LEVELS - 1);
    HP_COL.push(rgbStr(mix(RGB_RED, RGB_GREEN, t)));
    FLASH_COL.push(rgbaStr([255, 236, 222], 0.8 * t));
  }

  const DMAP_COL: string[] = [
    rgbStr(RGB_AMBER),
    rgbStr(mix(RGB_AMBER, RGB_GREEN, 0.5)),
    rgbStr(RGB_GREEN),
    rgbStr(mix(RGB_GREEN, RGB_BLUE, 0.5)),
    rgbStr(RGB_BLUE),
    rgbStr(mix(RGB_BLUE, RGB_WEAK, 0.5)),
    rgbStr(RGB_WEAK),
    rgbStr(mul(RGB_WEAK, 0.72))
  ];

  const NUMSTR = new Array<string>(1000);
  for (let n = 0; n < 1000; n++) NUMSTR[n] = String(n);

  return {
    LIGHT_LEVEL: LIGHT_LEVEL,
    FLOOR_LIT: FLOOR_LIT,
    FLOOR_DIM: FLOOR_DIM,
    WALL_LIT: WALL_LIT,
    WALL_DIM: WALL_DIM,
    SHADES: SHADES,
    HP_COL: HP_COL,
    FLASH_COL: FLASH_COL,
    DMAP_COL: DMAP_COL,
    NUMSTR: NUMSTR
  };
}
