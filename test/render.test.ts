/*
 * ISOROGUE — test/render.test.ts
 * ------------------------------------------------------------------
 * A camada de apresentação sob teste EM NODE, sem jsdom e sem canvas: o
 * `IsoRenderer` recebe um contexto 2D falso que só ANOTA o que foi pedido.
 *
 * Por que isto existe: a fase 1 dos despojos pôs no renderer dois algoritmos
 * que nenhum outro teste alcança — a PILHA de itens no mesmo tile (ordem e
 * corte) e a detecção de COLETA por observação do estado. Os dois são lógica
 * pura disfarçada de desenho, e lógica pura sem teste é lógica que quebra em
 * silêncio na primeira refatoração.
 *
 * O que este arquivo NÃO tenta ser: teste de pixel. Sem contexto 2D real não há
 * sprite nenhum — e é justamente esse o caminho exercitado aqui, o desenho de
 * RESERVA que mantém o jogo desenhável em ambiente sem Canvas (§7.3 do
 * BESTIARIO, agora valendo também para item). A aparência dos rigs é julgada na
 * bancada de revisão (tools/preview-personagem.mjs), não aqui.
 *
 * O invariante R54 aparece de graça em todos os casos: o renderer só recebe o
 * `Game`, e quem move o jogador e recolhe item é o engine, por `store.dispatch`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { CONFIG, DIRS8 } from '../src/engine/core';
import { setStorage } from '../src/engine/save';
import { store } from '../src/engine/store';
import type { Item, ItemKind } from '../src/engine/types';
import { IsoRenderer } from '../src/render/IsoRenderer';
import { COL_HOVER_LINE, buildLuts } from '../src/render/palette';

/* Sem localStorage: cada caso parte de um estado explícito. */
setStorage(null);

const SEMENTE = 'RENDER-TESTE';

/* As LUTs são determinísticas e as mesmas que o renderer constrói: usá-las aqui
 * testa o MAPEAMENTO item → cor de reserva, não o valor da cor. */
const LUTS = buildLuts(CONFIG.FOV_RADIUS);
/** Nível de luz do tile do próprio jogador (distância 0 — o mais claro). */
const LVL_NO_JOGADOR = LUTS.LIGHT_LEVEL[0];

/* ------------------------------------------------------------------ *
 * O contexto 2D falso — anota, não pinta
 * ------------------------------------------------------------------ */

/** Uma elipse pedida ao contexto, com a cor que estava armada na hora. */
interface Elipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  cor: string;
}

/** Um `fill()` de caminho, com cor e opacidade correntes. */
interface Preenchimento {
  cor: string;
  alfa: number;
}

interface ContextoFalso {
  ctx: CanvasRenderingContext2D;
  elipses: Elipse[];
  preenchimentos: Preenchimento[];
}

/** Campos que `save()`/`restore()` precisam empilhar de verdade. */
interface EstadoCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
}

function criarContextoFalso(): ContextoFalso {
  const elipses: Elipse[] = [];
  const preenchimentos: Preenchimento[] = [];
  const pilha: EstadoCtx[] = [];

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    font: '',
    textAlign: '',
    textBaseline: '',
    setTransform(): void {},
    /* `save`/`restore` de verdade: sem eles o alpha de um efeito vazaria para
     * tudo o que é desenhado depois e as anotações mentiriam. */
    save(): void {
      pilha.push({
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha,
        imageSmoothingEnabled: ctx.imageSmoothingEnabled
      });
    },
    restore(): void {
      const s = pilha.pop();
      if (!s) return;
      ctx.fillStyle = s.fillStyle;
      ctx.strokeStyle = s.strokeStyle;
      ctx.lineWidth = s.lineWidth;
      ctx.globalAlpha = s.globalAlpha;
      ctx.imageSmoothingEnabled = s.imageSmoothingEnabled;
    },
    translate(): void {},
    scale(): void {},
    rotate(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    closePath(): void {},
    stroke(): void {},
    clearRect(): void {},
    fillRect(): void {},
    fillText(): void {},
    drawImage(): void {},
    arc(): void {},
    ellipse(cx: number, cy: number, rx: number, ry: number): void {
      elipses.push({ cx: cx, cy: cy, rx: rx, ry: ry, cor: String(ctx.fillStyle) });
    },
    fill(): void {
      preenchimentos.push({ cor: String(ctx.fillStyle), alfa: ctx.globalAlpha });
    }
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    elipses: elipses,
    preenchimentos: preenchimentos
  };
}

/** Um canvas falso, o mínimo que o construtor e o `resize()` consultam. */
function criarCanvasFalso(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    parentNode: null,
    getContext: (): CanvasRenderingContext2D => ctx,
    getBoundingClientRect: (): { width: number; height: number } => ({ width: 960, height: 600 }),
    addEventListener: (): void => {},
    removeEventListener: (): void => {}
  } as unknown as HTMLCanvasElement;
}

function item(id: number, kind: ItemKind, x: number, y: number): Item {
  return { id: id, kind: kind, x: x, y: y, heal: 0 };
}

/**
 * A trouxa geométrica de reserva de um despojo tem assinatura própria: a elipse
 * do corpo é 5 × 3,4 (px de tela a zoom 1). É por ela que se conta quantos itens
 * foram desenhados e em que ordem — a sombra não serve, porque é igual para
 * todos, e não há sprite nenhum sem contexto 2D de verdade.
 */
function corposDeItem(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 5 && e.ry === 3.4);
}

/** Cor do corpo de reserva de um material, no nível de luz dado. */
function corDoItem(chave: 'linker' | 'chaser' | 'sentinel' | 'stone', lvl: number): string {
  return LUTS.SHADES[chave].main[lvl];
}

/* ------------------------------------------------------------------ *
 * Testes
 * ------------------------------------------------------------------ */

describe('IsoRenderer — os despojos no chão', () => {
  let falso: ContextoFalso;
  let renderer: IsoRenderer;

  beforeEach(() => {
    store.newRun(SEMENTE);
    falso = criarContextoFalso();
    renderer = new IsoRenderer(criarCanvasFalso(falso.ctx));
  });

  it('empilha no máximo 3 itens por tile, em ordem de id crescente', () => {
    const g = store.getGame();
    const px = g.player.x;
    const py = g.player.y;

    /* Quatro despojos no MESMO tile, embaralhados de propósito: a ordem de
     * `game.items` é ordem de criação e não pode ser a ordem do desenho. */
    g.items = [
      item(40, 'orelhaGoblin', px, py),
      item(10, 'gosma', px, py),
      item(30, 'clavaOgro', px, py),
      item(20, 'peOgro', px, py)
    ];

    renderer.update(g, 0.016);
    renderer.draw(g);

    const corpos = corposDeItem(falso.elipses);
    expect(corpos.length, 'a pilha deveria parar em 3 sprites').toBe(3);

    /* Os TRÊS MENORES ids, na ordem deles: gosma (10), pé (20), clava (30).
     * A orelha (40) chegou por último e não é desenhada. */
    expect(corpos.map((c) => c.cor), 'a pilha saiu fora da ordem de id').toEqual([
      corDoItem('linker', LVL_NO_JOGADOR),
      corDoItem('sentinel', LVL_NO_JOGADOR),
      corDoItem('stone', LVL_NO_JOGADOR)
    ]);

    /* Deslocamento em leque: o primeiro na âncora do tile, os extras ±3 px. */
    const base = corpos[0].cx;
    expect(corpos.map((c) => Math.round(c.cx - base)), 'o leque da pilha mudou')
      .toEqual([0, 3, -3]);
  });

  it('o item que sai da lista sob os pés do jogador acende o tile', () => {
    const g = store.getGame();
    const map = g.map;

    /* Um vizinho caminhável do jogador — é para lá que ele vai pisar. */
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < DIRS8.length; i++) {
      const d = DIRS8[i];
      const nx = g.player.x + d[0];
      const ny = g.player.y + d[1];
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      if (map.tiles[ny * map.w + nx] === CONFIG.TILE.WALL) continue;
      if (g.enemies.some((e) => e.x === nx && e.y === ny)) continue;
      dx = d[0];
      dy = d[1];
      break;
    }
    expect(dx !== 0 || dy !== 0, 'o jogador nasceu sem vizinho caminhável').toBe(true);

    g.items = [item(7, 'gosma', g.player.x + dx, g.player.y + dy)];

    /* Quadro 1: o renderer conhece o item no chão. Nada acende ainda. */
    renderer.update(g, 0.016);
    renderer.draw(g);
    expect(
      falso.preenchimentos.some((p) => p.cor === COL_HOVER_LINE),
      'acendeu o tile sem ninguém ter recolhido nada'
    ).toBe(false);

    /* O ENGINE recolhe (pisar em item recolhe); o renderer só observa. */
    store.dispatch({ kind: 'move', dx: dx, dy: dy });
    expect(g.player.bag.gosma, 'o engine não recolheu o despojo').toBe(1);
    expect(g.items.length, 'o item continuou no chão').toBe(0);

    falso.preenchimentos.length = 0;
    renderer.update(g, 0.016);
    renderer.draw(g);

    const brilho = falso.preenchimentos.filter((p) => p.cor === COL_HOVER_LINE);
    expect(brilho.length, 'a coleta não acendeu o tile').toBeGreaterThan(0);
    expect(brilho[0].alfa, 'o brilho da coleta tem de ser translúcido')
      .toBeGreaterThan(0);
    expect(brilho[0].alfa, 'o brilho da coleta ficou opaco demais').toBeLessThan(0.4);

    /* E apaga sozinho: passado o tempo do efeito, o tile volta ao normal. */
    falso.preenchimentos.length = 0;
    renderer.update(g, 0.1);
    renderer.update(g, 0.1);
    renderer.update(g, 0.1);
    renderer.update(g, 0.1);
    renderer.draw(g);
    expect(
      falso.preenchimentos.some((p) => p.cor === COL_HOVER_LINE),
      'o brilho da coleta não apagou'
    ).toBe(false);
  });

  it('trocar de andar não inventa coleta nenhuma', () => {
    /*
     * A memória dos itens é POR MAPA. Sem a limpeza de `syncRun`, todo item do
     * andar anterior contaria como "sumido" no primeiro quadro do novo — e o
     * que estivesse no tile de nascimento do jogador soltaria um pop de coleta
     * que nunca houve. Aqui a expedição nova faz as vezes da descida: mapa
     * novo, lista de itens nova, memória zerada.
     */
    const g1 = store.getGame();
    g1.items = [item(1, 'gosma', g1.player.x, g1.player.y)];
    renderer.update(g1, 0.016);
    renderer.draw(g1);

    store.newRun('OUTRA-SEMENTE');
    const g2 = store.getGame();
    g2.items = [];
    falso.preenchimentos.length = 0;
    renderer.update(g2, 0.016);
    renderer.draw(g2);

    expect(
      falso.preenchimentos.some((p) => p.cor === COL_HOVER_LINE),
      'a troca de mapa acendeu um tile como se o jogador tivesse recolhido algo'
    ).toBe(false);
  });

  it('a poção continua no caminho geométrico de sempre', () => {
    /*
     * R7: a poção é contrato antigo e não virou sprite nesta fase. O sinal de
     * que ela seguiu pelo desenho do vanilla é a assinatura dele — o corpo é um
     * CÍRCULO (arc), não a trouxa 5 × 3,4 dos despojos —, e a sombra elíptica
     * de 7 × 3 que ela sempre teve.
     */
    const g = store.getGame();
    g.items = [item(3, 'potion', g.player.x, g.player.y)];

    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(corposDeItem(falso.elipses).length, 'a poção foi desenhada como despojo')
      .toBe(0);
    expect(
      falso.elipses.some((e) => e.rx === 7 && e.ry === 3),
      'a sombra da poção sumiu'
    ).toBe(true);
  });
});
