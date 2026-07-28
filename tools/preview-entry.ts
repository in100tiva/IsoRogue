/**
 * ISOROGUE — bancada de revisão visual do guerreiro (docs/PERSONAGEM.md §10).
 *
 * Esta página NÃO faz parte do jogo. Ela existe para que um humano possa abrir
 * `docs/ref/preview-atlas.png` ao lado de `docs/ref/guerreiro-referencia.png` e
 * responder por escrito aos gates G1..G6. É a única ferramenta de revisão desta
 * fase: se ela mentir ou esconder um quadro, a revisão fica cega.
 *
 * O que ela mostra:
 *   1. as 8 direções paradas, ampliadas (≥ 4×), rotuladas com o índice, o delta
 *      do grid e para onde aquilo aponta NA TELA (é o gate G3);
 *   2 e 3. os 4 quadros de caminhada e os 3 de ataque da direção 2;
 *   4. os 8 sprites no tamanho do jogo (1× e 2×), sentados em losangos de tile,
 *      para julgar legibilidade;
 *   5. a paleta efetivamente exportada (G5);
 *   6. a lista de gates, para o revisor responder olhando;
 *   7. o atlas inteiro com cada quadro demarcado — quadro vazio salta aos olhos (G2).
 *
 * Restrições que valem aqui como valem no jogo: zero recurso externo (nenhuma URL,
 * nenhuma fonte, nenhuma imagem), zero dependência nova. Só Canvas 2D e DOM.
 *
 * Acoplamento deliberadamente frouxo: os módulos do personagem são importados como
 * namespace e resolvidos por FORMA, não por nome de export. Um rename em
 * `warrior.ts` ou em `spriteForge.ts` não pode apagar a bancada — no pior caso ela
 * desenha um painel de erro legível dizendo exatamente o que encontrou.
 */

import { CONFIG, DIRS8 } from '../src/engine/core';
import * as modWarrior from '../src/render/characters/warrior';
import * as modForge from '../src/render/spriteForge';
import * as modModel from '../src/render/model3d';

/* ------------------------------------------------------------------ *
 * 1. Formas mínimas esperadas (contrato §7 e §4.1 do PERSONAGEM.md)
 * ------------------------------------------------------------------ */

type Registro = Record<string, unknown>;

interface QuadroAtlas {
  readonly sx: number;
  readonly sy: number;
}

interface AtlasLike {
  /** Nulo quando não houve contexto 2D (§7 manda degradar sem lançar). */
  readonly canvas: HTMLCanvasElement | null;
  readonly larguraFrame: number;
  readonly alturaFrame: number;
  readonly ancoraX: number;
  readonly ancoraY: number;
  quadro(dir: number, estado: string, frame: number): QuadroAtlas;
  /* Diagnóstico opcional — a bancada mostra o que existir. */
  readonly disponivel?: boolean;
  readonly msForja?: number;
  readonly larguraArte?: number;
  readonly alturaArte?: number;
  readonly pixel?: number;
}

/** Atlas com pixels de verdade: só depois desta checagem dá para desenhar. */
interface AtlasPronto extends AtlasLike {
  readonly canvas: HTMLCanvasElement;
}

interface RigLike {
  readonly nome: string;
  readonly caixas: readonly unknown[];
  readonly filhos?: readonly unknown[];
}

interface EstadoAnim {
  readonly chave: string;
  readonly quadros: number;
  readonly descricao: string;
}

/** §6 do PERSONAGEM.md. 8 × (2+4+3) = 72 quadros. */
const ESTADOS: readonly EstadoAnim[] = [
  { chave: 'parado', quadros: 2, descricao: 'respiração — torso ±0,25u em Z' },
  { chave: 'andando', quadros: 4, descricao: 'pernas ±22°, braços contrapostos, quique 0,4u' },
  { chave: 'atacando', quadros: 3, descricao: 'braço direito −40° → +55° em X' }
];

/** Direção usada nas faixas de animação (2 = sul do grid, a pose da referência). */
const DIR_ANIMACAO = 2;

/** Nomes do grid na ORDEM FIXA de DIRS8 (core.ts) — não reordene. */
const NOMES_DIR: readonly string[] = [
  'leste',
  'sudeste',
  'sul',
  'sudoeste',
  'oeste',
  'noroeste',
  'norte',
  'nordeste'
];

/* ------------------------------------------------------------------ *
 * 2. Resolução por forma dos módulos do personagem
 * ------------------------------------------------------------------ */

function ehObjeto(v: unknown): v is Registro {
  return typeof v === 'object' && v !== null;
}

function ehRig(v: unknown): v is RigLike {
  return ehObjeto(v) && typeof v['nome'] === 'string' && Array.isArray(v['caixas']);
}

/**
 * Reconhece um AtlasPersonagem pela forma. `canvas` NÃO entra no teste de
 * propósito: ele pode ser nulo por contrato (degradação sem DOM), e confundir
 * "atlas vazio" com "objeto errado" daria uma mensagem de erro mentirosa.
 */
function ehAtlas(v: unknown): v is AtlasLike {
  if (!ehObjeto(v)) return false;
  return (
    typeof v['quadro'] === 'function' &&
    typeof v['larguraFrame'] === 'number' &&
    typeof v['alturaFrame'] === 'number' &&
    typeof v['ancoraX'] === 'number' &&
    typeof v['ancoraY'] === 'number'
  );
}

function exigirPixels(atlas: AtlasLike): AtlasPronto {
  if (!atlas.canvas) {
    throw new Error(
      'o atlas foi forjado, mas sem pixels: canvas === null ' +
        `(disponivel = ${String(atlas.disponivel)}). No navegador isso só acontece ` +
        'se getContext("2d") devolveu null.'
    );
  }
  return atlas as AtlasPronto;
}

function msgDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function chaves(mod: Registro): string {
  const ks = Object.keys(mod).filter((k) => k !== '__esModule' && k !== 'default');
  return ks.length > 0 ? ks.join(', ') : '(nenhum)';
}

/** Acha o rig do guerreiro: um `No` exportado direto ou devolvido por uma fábrica. */
function resolverRig(mod: Registro): RigLike {
  for (const valor of Object.values(mod)) {
    if (ehRig(valor)) return valor;
  }
  for (const valor of Object.values(mod)) {
    if (typeof valor !== 'function') continue;
    const fabrica = valor as (...args: unknown[]) => unknown;
    if (fabrica.length > 0) continue;
    try {
      const r = fabrica();
      if (ehRig(r)) return r;
    } catch {
      /* não era fábrica de rig; segue procurando */
    }
  }
  throw new Error(
    `src/render/characters/warrior.ts não exporta nenhum rig (objeto com { nome, caixas }). ` +
      `Exports vistos: ${chaves(mod)}.`
  );
}

/**
 * Acha `forjarAtlas` e chama com as opções que o personagem exige.
 *
 * A forja NÃO é chamável só com o rig: `opts.paleta` é obrigatória, e a pose de
 * repouso (a espada erguida de I4) também vem do personagem, não do forge. Por
 * isso montamos `opts` a partir do próprio módulo do guerreiro (§2 e §8) e
 * descemos uma escada de tentativas até uma pegar — assim a bancada sobrevive a
 * um `opts` que ganhe ou perca campo obrigatório amanhã.
 */
function resolverForja(
  modForja: Registro,
  opts: Registro
): (rig: RigLike) => AtlasLike {
  const candidatos = Object.entries(modForja).filter(
    ([nome, valor]) => typeof valor === 'function' && /forjar|atlas/i.test(nome)
  );
  const escolhido = candidatos.find(([nome]) => nome === 'forjarAtlas') ?? candidatos[0];
  if (!escolhido) {
    throw new Error(
      `src/render/spriteForge.ts não exporta uma função de forja (esperado 'forjarAtlas'). ` +
        `Exports vistos: ${chaves(modForja)}.`
    );
  }
  const fn = escolhido[1] as (...args: unknown[]) => unknown;
  const paletaSo = opts['paleta'] === undefined ? {} : { paleta: opts['paleta'] };
  return (rig: RigLike): AtlasLike => {
    let ultimo: unknown = new Error('sem tentativa');
    for (const args of [[rig, opts], [rig, paletaSo], [rig, {}], [rig]]) {
      try {
        const r = fn(...args);
        if (ehAtlas(r)) return r;
        ultimo = new Error(
          'o retorno não tem a forma de AtlasPersonagem ' +
            '{ larguraFrame, alturaFrame, ancoraX, ancoraY, quadro() }'
        );
      } catch (e) {
        ultimo = e;
      }
    }
    throw new Error(`${escolhido[0]}() não produziu um atlas: ${msgDe(ultimo)}`);
  };
}

/* ---- detectores de forma para as opções do personagem ---- */

const RE_HEX = /^#[0-9a-f]{3,8}$/i;

function ehPaleta(v: unknown): v is Record<string, string> {
  if (!ehObjeto(v)) return false;
  const pares = Object.entries(v);
  return pares.length >= 4 && pares.every(([, c]) => typeof c === 'string' && RE_HEX.test(c));
}

function ehRampas(v: unknown): boolean {
  if (!ehObjeto(v)) return false;
  const vals = Object.values(v);
  return (
    vals.length >= 1 &&
    vals.every((r) => Array.isArray(r) && r.length > 0 && r.every((c) => typeof c === 'string'))
  );
}

/** Mapa cor → nome de rampa: strings que NÃO são hex e cujas chaves são cores. */
function ehMapaDeCor(v: unknown, coresValidas: readonly string[]): boolean {
  if (!ehObjeto(v)) return false;
  const pares = Object.entries(v);
  if (pares.length < 2) return false;
  if (!pares.every(([, r]) => typeof r === 'string' && !RE_HEX.test(r))) return false;
  return pares.some(([k]) => coresValidas.includes(k));
}

/** Pose: nome do nó → { rx?, ry?, rz? } em radianos. */
function ehPose(v: unknown): boolean {
  if (!ehObjeto(v)) return false;
  const vals = Object.values(v);
  return (
    vals.length >= 1 &&
    vals.every(
      (r) =>
        ehObjeto(r) &&
        ['rx', 'ry', 'rz'].some((eixo) => typeof r[eixo] === 'number') &&
        Object.keys(r).every((k) => ['rx', 'ry', 'rz'].includes(k))
    )
  );
}

/** Nome canônico primeiro; forma depois. Nunca devolve algo que não sirva. */
function acharExport(
  mod: Registro,
  nomes: readonly string[],
  forma: (v: unknown) => boolean
): unknown {
  for (const n of nomes) {
    const v = mod[n];
    if (v !== undefined && forma(v)) return v;
  }
  for (const v of Object.values(mod)) {
    if (forma(v)) return v;
  }
  return undefined;
}

/**
 * Monta o `opts` da forja a partir do módulo do personagem. Devolve também a
 * lista do que foi encontrado — ela vai para o rodapé da folha, porque uma pose
 * de repouso não aplicada muda a leitura de I4 e o revisor precisa saber.
 */
function montarOpcoes(mod: Registro): { opts: Registro; achados: string[] } {
  const opts: Registro = {};
  const achados: string[] = [];
  const paleta = acharExport(mod, ['PALETA_GUERREIRO', 'PALETA'], ehPaleta);
  if (ehPaleta(paleta)) {
    opts['paleta'] = paleta;
    achados.push('paleta');
    const cores = Object.keys(paleta);
    const rampas = acharExport(mod, ['RAMPAS_GUERREIRO', 'RAMPAS'], ehRampas);
    if (rampas !== undefined) {
      opts['rampas'] = rampas;
      achados.push('rampas');
    }
    const rampaDaCor = acharExport(mod, ['RAMPA_DA_COR'], (v) => ehMapaDeCor(v, cores));
    if (rampaDaCor !== undefined) {
      opts['rampaDaCor'] = rampaDaCor;
      achados.push('rampaDaCor');
    }
  }
  const repouso = acharExport(mod, ['POSE_PARADA', 'POSE_REPOUSO', 'POSE_NEUTRA'], ehPose);
  if (repouso !== undefined) {
    opts['repouso'] = repouso;
    achados.push('repouso');
  }
  return { opts, achados };
}

/** As cores da paleta, em pares, para a legenda de G5. */
function paresDaPaleta(...mods: readonly Registro[]): ReadonlyArray<readonly [string, string]> {
  for (const mod of mods) {
    const p = acharExport(mod, ['PALETA_GUERREIRO', 'PALETA'], ehPaleta);
    if (ehPaleta(p)) return Object.entries(p);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * 3. Utilidades de desenho
 * ------------------------------------------------------------------ */

interface Tela {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function novaTela(w: number, h: number): Tela {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível — a bancada precisa de getContext("2d").');
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

/** Xadrez discreto: dá referência de fundo sem competir com a silhueta. */
function xadrez(ctx: CanvasRenderingContext2D, w: number, h: number, passo: number): void {
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const par = ((x / passo) | 0) + ((y / passo) | 0);
      ctx.fillStyle = par % 2 === 0 ? '#171c23' : '#1c222a';
      ctx.fillRect(x, y, passo, passo);
    }
  }
}

/** Losango do tile (TW×TH do jogo) — mostra se o personagem "senta" no chão. */
function losango(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tw: number,
  th: number,
  preenche: string | null,
  traco: string | null
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - th / 2);
  ctx.lineTo(cx + tw / 2, cy);
  ctx.lineTo(cx, cy + th / 2);
  ctx.lineTo(cx - tw / 2, cy);
  ctx.closePath();
  if (preenche) {
    ctx.fillStyle = preenche;
    ctx.fill();
  }
  if (traco) {
    ctx.strokeStyle = traco;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function cruz(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = 'rgba(224,164,60,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r, y + 0.5);
  ctx.lineTo(x + r, y + 0.5);
  ctx.moveTo(x + 0.5, y - r);
  ctx.lineTo(x + 0.5, y + r);
  ctx.stroke();
}

/**
 * Um quadro ampliado, com xadrez de fundo, o losango do tile na âncora e a cruz
 * da âncora. A ampliação é feita no canvas com imageSmoothingEnabled=false — é o
 * mesmo caminho do jogo, então o que aparece aqui é o pixel real, não um borrão.
 */
function celulaQuadro(
  atlas: AtlasPronto,
  dir: number,
  estado: string,
  frame: number,
  zoom: number
): HTMLCanvasElement {
  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const margemBaixo = 8;
  const cw = Math.max(lw, CONFIG.TW + 8);
  const ch = lh + margemBaixo;
  const offX = Math.round((cw - lw) / 2);
  const offY = 2;

  const { cv, ctx } = novaTela(cw * zoom, ch * zoom);
  xadrez(ctx, cw * zoom, ch * zoom, Math.max(4, zoom * 2));

  const ax = (offX + atlas.ancoraX) * zoom;
  const ay = (offY + atlas.ancoraY) * zoom;
  losango(ctx, ax, ay, CONFIG.TW * zoom, CONFIG.TH * zoom, 'rgba(58,66,80,0.55)', 'rgba(201,211,222,0.16)');
  cruz(ctx, ax, ay, 5 * zoom);

  const q = atlas.quadro(dir, estado, frame);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, q.sx, q.sy, lw, lh, offX * zoom, offY * zoom, lw * zoom, lh * zoom);

  // Moldura do quadro: torna visível qualquer vazamento para fora da célula.
  ctx.strokeStyle = 'rgba(201,211,222,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(offX * zoom + 0.5, offY * zoom + 0.5, lw * zoom - 1, lh * zoom - 1);
  return cv;
}

/**
 * Os 8 sprites do jeito que o jogador vê: um por tile, sobre o losango do chão.
 * `zoom` 1 é o tamanho real; o jogo permite até 2,4× (CONFIG.ZOOM_MAX), então
 * vale olhar também um pouco ampliado antes de dar a legibilidade por boa.
 */
function tiraTamanhoReal(atlas: AtlasPronto, zoom: number): HTMLCanvasElement {
  const passo = CONFIG.TW * zoom;
  const margem = 16;
  const w = passo * 8 + margem * 2;
  const h = atlas.alturaFrame * zoom + 44;
  const baseY = h - 26;

  const { cv, ctx } = novaTela(w, h);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 8; i++) {
    const cx = margem + passo / 2 + i * passo;
    losango(ctx, cx, baseY, CONFIG.TW * zoom, CONFIG.TH * zoom, '#3a4250', 'rgba(255,255,255,0.07)');
  }

  ctx.imageSmoothingEnabled = false;
  for (let dir = 0; dir < 8; dir++) {
    const cx = margem + passo / 2 + dir * passo;
    const q = atlas.quadro(dir, 'parado', 0);
    ctx.drawImage(
      atlas.canvas,
      q.sx,
      q.sy,
      atlas.larguraFrame,
      atlas.alturaFrame,
      Math.round(cx - atlas.ancoraX * zoom),
      Math.round(baseY - atlas.ancoraY * zoom),
      atlas.larguraFrame * zoom,
      atlas.alturaFrame * zoom
    );
  }

  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d8899';
  for (let dir = 0; dir < 8; dir++) {
    const cx = margem + passo / 2 + dir * passo;
    ctx.fillText(String(dir), cx, h - 6);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0a43c';
  ctx.fillText(`${zoom}×`, 6, 14);
  return cv;
}

/** O atlas inteiro, com cada quadro demarcado: quadro vazio ou torto salta aos olhos. */
function folhaContato(atlas: AtlasPronto, zoom: number): HTMLCanvasElement {
  const w = atlas.canvas.width * zoom;
  const h = atlas.canvas.height * zoom;
  const { cv, ctx } = novaTela(w, h);
  xadrez(ctx, w, h, 8);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, 0, 0, atlas.canvas.width, atlas.canvas.height, 0, 0, w, h);

  ctx.strokeStyle = 'rgba(224,164,60,0.28)';
  ctx.lineWidth = 1;
  for (let dir = 0; dir < 8; dir++) {
    for (const estado of ESTADOS) {
      for (let f = 0; f < estado.quadros; f++) {
        const q = atlas.quadro(dir, estado.chave, f);
        ctx.strokeRect(
          q.sx * zoom + 0.5,
          q.sy * zoom + 0.5,
          atlas.larguraFrame * zoom - 1,
          atlas.alturaFrame * zoom - 1
        );
      }
    }
  }
  return cv;
}

/* ------------------------------------------------------------------ *
 * 4. Montagem do DOM
 * ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function secao(titulo: string, sub: string): HTMLElement {
  const s = el('section', 'secao');
  s.append(el('h2', undefined, titulo), el('p', 'sub', sub));
  return s;
}

function cartao(canvas: HTMLCanvasElement, rotulo: string, detalhe: string): HTMLElement {
  const c = el('div', 'cartao');
  c.append(canvas, el('div', 'rotulo', rotulo), el('div', 'detalhe', detalhe));
  return c;
}

function medida(rot: string, val: string, destaque = false): HTMLElement {
  const d = el('div', destaque ? 'medida destaque' : 'medida');
  d.append(el('span', 'rot', rot), el('span', 'val', val));
  return d;
}

/**
 * Para onde a direção do grid aponta NA TELA, derivado de DIRS8 pela mesma
 * projeção do jogo (isoX = x−y, isoY = (x+y)/2). É o gate G3 escrito na imagem:
 * o revisor não precisa fazer a conta de cabeça.
 */
function rumoNaTela(dx: number, dy: number): string {
  const sx = dx - dy;
  const sy = (dx + dy) / 2;
  const vert = sy > 0.01 ? 'baixo' : sy < -0.01 ? 'cima' : '';
  const horiz = sx > 0.01 ? 'direita' : sx < -0.01 ? 'esquerda' : '';
  const partes = [vert, horiz].filter((p) => p !== '');
  return partes.length > 0 ? partes.join('-') : '—';
}

function zoomDirecoes(atlas: AtlasPronto): number {
  const maior = Math.max(atlas.larguraFrame, atlas.alturaFrame, 1);
  // ≥ 4× por contrato; sobe até 6× quando o quadro é pequeno o bastante.
  return Math.max(4, Math.min(6, Math.floor(300 / maior)));
}

function montar(
  raiz: HTMLElement,
  atlas: AtlasPronto,
  rig: RigLike,
  forjaMs: number,
  achados: readonly string[]
): number {
  const zDir = zoomDirecoes(atlas);
  const zAnim = Math.max(4, zDir - 1);
  const totalQuadros = 8 * ESTADOS.reduce((s, e) => s + e.quadros, 0);

  /* --- cabeçalho --- */
  const cab = el('header', 'cabecalho');
  const tit = el('div');
  tit.append(
    el('h1', 'titulo', 'ISOROGUE — bancada do guerreiro'),
    el(
      'p',
      'subtitulo',
      `rig "${rig.nome}" · docs/PERSONAGEM.md §10 · compare com docs/ref/guerreiro-referencia.png`
    )
  );
  const meds = el('div', 'medidas');
  meds.append(
    // Alvo de §7: < 40 ms na inicialização. Verde = dentro.
    medida('forja', `${forjaMs.toFixed(1)} ms`, forjaMs <= 40),
    medida('quadros', String(totalQuadros)),
    medida('quadro', `${atlas.larguraFrame}×${atlas.alturaFrame}`),
    medida('âncora', `${atlas.ancoraX},${atlas.ancoraY}`),
    medida('atlas', `${atlas.canvas.width}×${atlas.canvas.height}`)
  );
  // A resolução do buffer de ARTE é o que decide se isto é pixel art ou 3D liso
  // (§3): o modelo é rasterizado aí e só depois ampliado ×PIXEL.
  if (typeof atlas.larguraArte === 'number' && typeof atlas.alturaArte === 'number') {
    meds.append(medida('arte', `${atlas.larguraArte}×${atlas.alturaArte}`));
  }
  if (typeof atlas.pixel === 'number') meds.append(medida('pixel', `${atlas.pixel}×`));
  meds.append(medida('ampliação', `${zDir}×`));
  cab.append(tit, meds);
  raiz.append(cab);

  /* --- 1. as 8 direções paradas --- */
  const sDir = secao(
    '1 · as 8 direções — estado parado, quadro 0',
    `ampliadas ${zDir}× · o losango é o tile 64×32 do jogo, a cruz âmbar é a âncora · ` +
      'G3: a direção 0 (1,0) tem de olhar para baixo-direita'
  );
  const fDir = el('div', 'faixa');
  for (let dir = 0; dir < 8; dir++) {
    const d = DIRS8[dir];
    const dx = d ? d[0] : 0;
    const dy = d ? d[1] : 0;
    fDir.append(
      cartao(
        celulaQuadro(atlas, dir, 'parado', 0, zDir),
        `${dir} (${dx},${dy}) ${NOMES_DIR[dir] ?? '?'}`,
        `na tela: ${rumoNaTela(dx, dy)}`
      )
    );
  }
  sDir.append(fDir);
  raiz.append(sDir);

  /* --- 2 e 3. as duas animações, lado a lado --- */
  const colsAnim = el('div', 'colunas');
  const dAnim = DIRS8[DIR_ANIMACAO];
  const rotuloDir = `dir ${DIR_ANIMACAO} (${dAnim ? dAnim[0] : 0},${dAnim ? dAnim[1] : 0}) ${
    NOMES_DIR[DIR_ANIMACAO] ?? '?'
  }`;
  for (const estado of ESTADOS) {
    if (estado.chave === 'parado') continue;
    const s = secao(
      `${estado.chave === 'andando' ? '2' : '3'} · ${estado.chave} — ${rotuloDir}`,
      `${estado.quadros} quadros · ${estado.descricao} · ampliados ${zAnim}×`
    );
    const f = el('div', 'faixa');
    for (let i = 0; i < estado.quadros; i++) {
      f.append(
        cartao(
          celulaQuadro(atlas, DIR_ANIMACAO, estado.chave, i, zAnim),
          `quadro ${i}`,
          `${estado.chave} · ${i + 1}/${estado.quadros}`
        )
      );
    }
    s.append(f);
    colsAnim.append(s);
  }

  /* --- 4, 5 e 6. tamanho de jogo, paleta e gates --- */
  const colsBaixo = el('div', 'colunas');

  const sReal = secao(
    '4 · como o jogador vê (1× e 2×)',
    'um sprite por tile, sem ampliação de bancada · o jogo vai de 0,45× a 2,4× de zoom'
  );
  const tiras = el('div');
  tiras.style.display = 'grid';
  tiras.style.gap = '8px';
  tiras.append(tiraTamanhoReal(atlas, 1), tiraTamanhoReal(atlas, 2));
  sReal.append(tiras);
  colsBaixo.append(sReal);

  const paleta = paresDaPaleta(
    modWarrior as unknown as Registro,
    modModel as unknown as Registro,
    modForge as unknown as Registro
  );
  if (paleta.length > 0) {
    const sPal = secao(
      '5 · paleta exportada',
      `${paleta.length} cores · G5: nenhuma cor fora desta lista pode aparecer nos sprites`
    );
    const grade = el('div', 'paleta');
    for (const [nome, cor] of paleta) {
      const a = el('div', 'amostra');
      const sw = el('i');
      sw.style.background = cor;
      a.append(sw, el('span', undefined, nome), el('b', undefined, cor));
      grade.append(a);
    }
    sPal.append(grade);
    colsBaixo.append(sPal);
  }

  const sGates = secao('6 · gates da revisão (§10)', 'responda por escrito, um a um');
  const lista = el('ul', 'gates');
  const gates: ReadonlyArray<readonly [string, string]> = [
    ['G1', 'A silhueta é reconhecível como ESTE guerreiro? (I1–I8)'],
    ['G2', 'As 8 direções são coerentes entre si — mesma altura, mesmo volume, sem "pular"?'],
    ['G3', 'A direção 0 (leste do grid) olha mesmo para baixo-direita na tela?'],
    ['G4', 'O contorno está contínuo, sem furos?'],
    ['G5', 'A paleta é a de §2, sem cor inventada nem gradiente contínuo?'],
    ['G6', 'A espada e o escudo estão nos lados certos e legíveis em todas as direções?']
  ];
  for (const [id, texto] of gates) {
    const li = el('li');
    li.append(el('b', undefined, `${id} `), document.createTextNode(texto));
    lista.append(li);
  }
  sGates.append(lista);
  colsBaixo.append(sGates);

  /* --- 7. folha de contato, alta, ocupando a coluna da direita --- */
  const zAtlas = atlas.canvas.width * 2 <= 900 ? 2 : 1;
  const sAtlas = secao(
    '7 · atlas completo',
    `${totalQuadros} quadros a ${zAtlas}× · cada moldura âmbar é um quadro reivindicado ` +
      'por quadro(dir, estado, i) — moldura vazia é quadro perdido'
  );
  sAtlas.append(folhaContato(atlas, zAtlas));

  const esquerda = el('div', 'pilha');
  esquerda.append(colsAnim, colsBaixo);
  const corpo = el('div', 'colunas');
  corpo.append(esquerda, sAtlas);
  raiz.append(corpo);
  raiz.append(
    el(
      'div',
      'rodape',
      `Gerado por tools/preview-personagem.mjs · opções passadas à forja: ` +
        `${achados.length > 0 ? achados.join(', ') : 'nenhuma (a forja rodou com o padrão dela)'} · ` +
        'nenhum recurso externo · reprovou em algum gate: corrige e roda de novo ' +
        '(2 a 3 rodadas é o esperado).'
    )
  );

  return totalQuadros;
}

function painelErro(raiz: HTMLElement, e: unknown): void {
  const p = el('div', 'erro');
  p.append(
    el('h2', undefined, 'A bancada não conseguiu forjar o atlas'),
    el('p', undefined, msgDe(e)),
    el(
      'pre',
      undefined,
      e instanceof Error && e.stack ? e.stack : 'sem pilha disponível'
    )
  );
  raiz.append(p);
}

/* ------------------------------------------------------------------ *
 * 5. Marcação para o capturador
 * ------------------------------------------------------------------ */

/**
 * Escreve no <body> o tamanho exato da página. tools/preview-personagem.mjs lê
 * isso com `--dump-dom` e só então tira a foto com a janela do tamanho certo —
 * é o que garante uma imagem sem corte e sem tarja preta.
 *
 * A leitura de scrollWidth força o layout de forma síncrona, então isto vale
 * ainda que nada tenha sido pintado: não dependemos de requestAnimationFrame,
 * que sob `--virtual-time-budget` pode não fechar antes do dump.
 */
function marcar(forjaMs: number, quadros: number, erro?: string): void {
  const doc = document.documentElement;
  const w = Math.ceil(Math.max(doc.scrollWidth, document.body.scrollWidth));
  const h = Math.ceil(Math.max(doc.scrollHeight, document.body.scrollHeight));
  document.body.dataset['bancada'] = `${w}x${h}`;
  document.body.dataset['forja'] = forjaMs.toFixed(2);
  document.body.dataset['quadros'] = String(quadros);
  if (erro) document.body.dataset['erro'] = erro.replace(/\s+/g, ' ').slice(0, 400);
}

/**
 * O relógio do Chrome headless é virtualizado por `--virtual-time-budget`, e sob
 * ele um trecho síncrono pode medir 0 ms. Por isso o capturador mede o tempo de
 * forja numa primeira passada SEM relógio virtual e devolve o número real pelo
 * fragmento da URL (#forja=12.3). Havendo esse valor, ele manda.
 */
function forjaInformada(): number | null {
  const frag = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const v = new URLSearchParams(frag).get('forja');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function principal(): void {
  const raiz = document.getElementById('bancada');
  if (!raiz) return;
  try {
    const rig = resolverRig(modWarrior as unknown as Registro);
    const { opts, achados } = montarOpcoes(modWarrior as unknown as Registro);
    const forjar = resolverForja(modForge as unknown as Registro, opts);
    const t0 = performance.now();
    const bruto = forjar(rig);
    const medido = performance.now() - t0;
    const atlas = exigirPixels(bruto);
    // Ordem de preferência: o número real medido pelo capturador (passada 1, sem
    // relógio virtual) > o que a própria forja cronometrou > o nosso relógio.
    const forjaMs = forjaInformada() ?? atlas.msForja ?? medido;
    const quadros = montar(raiz, atlas, rig, forjaMs, achados);
    marcar(forjaMs, quadros);
  } catch (e) {
    painelErro(raiz, e);
    marcar(0, 0, msgDe(e));
  }
}

principal();
