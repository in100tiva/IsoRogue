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
 * A fase 2 (economia) acrescentou um terceiro da mesma família: os PONTOS DE
 * PARADA. Desenhar o mercador e a bancada é trivial; o que não é são as três
 * regras em volta — o recorte por FOV, a ORIENTAÇÃO do mercador por observação
 * (ele encara quem chega, sem uma letra no `Game`) e o BRILHO DE CONVITE, que
 * existe enquanto o jogador está longe e apaga quando ele pisa no tile.
 *
 * O que este arquivo NÃO tenta ser: teste de pixel. Sem contexto 2D real não há
 * sprite nenhum — e é justamente esse o caminho exercitado aqui, o desenho de
 * RESERVA que mantém o jogo desenhável em ambiente sem Canvas (§7.3 do
 * BESTIARIO, agora valendo também para item e para ponto de parada). A
 * aparência dos rigs é julgada na bancada de revisão
 * (tools/preview-personagem.mjs), não aqui.
 *
 * O invariante R54 aparece de graça em todos os casos: o renderer só recebe o
 * `Game`, e quem move o jogador e recolhe item é o engine, por `store.dispatch`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { CONFIG, DEFAULT_FACING, DIRS8, dirIndex } from '../src/engine/core';
import { setStorage } from '../src/engine/save';
import { store } from '../src/engine/store';
import type { Item, ItemKind, Point } from '../src/engine/types';
import { IsoRenderer } from '../src/render/IsoRenderer';
import { COL_HOVER_LINE, LEVELS, buildLuts } from '../src/render/palette';

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
 * Assinaturas do desenho de reserva dos PONTOS DE PARADA
 *
 * Sem contexto 2D não há atlas, então o mercador e a bancada saem pelo caminho
 * geométrico — e cada um tem uma elipse de corpo com raios próprios, que é o
 * que permite contá-los e localizá-los nas anotações do contexto falso. Os
 * números vivem em `IsoRenderer.desenharMercadorGeometrico` /
 * `desenharBancadaGeometrica`; se mudarem lá, mudam aqui.
 * ------------------------------------------------------------------ */

/** O sino do manto do mercador: 6 × 9 px de tela a zoom 1. */
function corposDeMercador(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 6 && e.ry === 9);
}

/** A laje da bancada: 13 × 6 px de tela a zoom 1. */
function corposDeBancada(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 13 && e.ry === 6);
}

/** A cor do pulso de convite: âmbar em brilho pleno, nunca no `lvl` do tile. */
const COR_CONVITE = LUTS.SHADES.amber.main[LEVELS - 1];

function convites(preenchimentos: Preenchimento[]): Preenchimento[] {
  return preenchimentos.filter((p) => p.cor === COR_CONVITE);
}

/**
 * Um vizinho caminhável do jogador, para pôr um ponto de parada ao lado dele —
 * perto o bastante para estar no FOV e para o mercador reparar em quem chegou.
 */
function vizinhoLivre(px: number, py: number): Point {
  const g = store.getGame();
  const map = g.map;
  for (let i = 0; i < DIRS8.length; i++) {
    const d = DIRS8[i];
    const nx = px + d[0];
    const ny = py + d[1];
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    if (map.tiles[ny * map.w + nx] === CONFIG.TILE.WALL) continue;
    return { x: nx, y: ny };
  }
  throw new Error('o jogador nasceu sem vizinho caminhável');
}

/**
 * Para onde o mercador olha. O campo é INTERNO do renderer de propósito (o
 * `facing` dele não existe no `Game` — ver `orientarMercador`), e este acesso
 * é o preço de testar a regra sem abrir API pública só para o teste.
 */
function facingDoMercador(r: IsoRenderer): number {
  return (r as unknown as { facingMercador: number }).facingMercador;
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

/* ================================================================== *
 * Os pontos de parada (fase 2 da economia)
 * ================================================================== */

describe('IsoRenderer — o mercador e a bancada', () => {
  let falso: ContextoFalso;
  let renderer: IsoRenderer;

  beforeEach(() => {
    store.newRun(SEMENTE);
    falso = criarContextoFalso();
    renderer = new IsoRenderer(criarCanvasFalso(falso.ctx));
  });

  it('desenha os dois no tile de cada um, com a âncora do tile', () => {
    const g = store.getGame();
    const merc = vizinhoLivre(g.player.x, g.player.y);
    /* A bancada num tile diferente do mercador — no jogo eles nunca coincidem
     * (`populate` reserva o tile do mercador antes de sortear a bancada). */
    const banc = vizinhoLivre(merc.x, merc.y);
    expect(banc.x !== merc.x || banc.y !== merc.y, 'os dois pontos caíram no mesmo tile')
      .toBe(true);
    g.mercador = merc;
    g.bancada = banc;

    renderer.update(g, 0.016);
    renderer.draw(g);

    const mercs = corposDeMercador(falso.elipses);
    const bancs = corposDeBancada(falso.elipses);
    expect(mercs.length, 'o mercador não foi desenhado').toBe(1);
    expect(bancs.length, 'a bancada não foi desenhada').toBe(1);

    /* A âncora é a mesma dos inimigos: o `sx` do losango do tile, sem leque e
     * sem deslize — o ponto de parada não anda. */
    expect(Math.round(mercs[0].cx), 'o mercador saiu do tile dele')
      .toBe(Math.round(renderer.tileToScreen(g, merc.x, merc.y).sx));
    expect(Math.round(bancs[0].cx), 'a bancada saiu do tile dela')
      .toBe(Math.round(renderer.tileToScreen(g, banc.x, banc.y).sx));
  });

  it('andar sem mercador nem bancada não desenha ponto nenhum', () => {
    /* `populate` devolve `null` quando o mapa não ofereceu tile elegível. Um
     * `null` lido como zero desenharia o mercador no canto (0,0) do mapa. */
    const g = store.getGame();
    g.mercador = null;
    g.bancada = null;

    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(corposDeMercador(falso.elipses).length, 'apareceu mercador do nada').toBe(0);
    expect(corposDeBancada(falso.elipses).length, 'apareceu bancada do nada').toBe(0);
    expect(convites(falso.preenchimentos).length, 'apareceu convite sem ponto de parada')
      .toBe(0);
  });

  it('fora do campo de visão não desenha nada — a regra dos inimigos (R31)', () => {
    const g = store.getGame();
    const merc = vizinhoLivre(g.player.x, g.player.y);
    g.mercador = merc;
    g.bancada = null;

    /* O MESMO tile, no MESMO lugar da tela: só a visibilidade muda. Testar com
     * um tile distante provaria o recorte de tela, não o recorte de FOV. */
    renderer.update(g, 0.016);
    renderer.draw(g);
    expect(corposDeMercador(falso.elipses).length, 'o mercador visível não foi desenhado')
      .toBe(1);

    g.visible.delete(merc.y * g.map.w + merc.x);
    falso.elipses.length = 0;
    falso.preenchimentos.length = 0;
    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(corposDeMercador(falso.elipses).length, 'o mercador apareceu fora do FOV')
      .toBe(0);
    expect(convites(falso.preenchimentos).length, 'o convite piscou fora do FOV')
      .toBe(0);
  });

  it('o mercador encara quem chega e guarda a direção de quem sobe no tile', () => {
    /*
     * §0.2 do BESTIARIO adaptado a quem não anda (ver `orientarMercador`). As
     * coordenadas do ponto são fabricadas em volta do jogador de propósito: a
     * regra é aritmética de posição e não pode depender do desenho do mapa.
     * Nada aqui desenha — a orientação acontece no `update`.
     */
    const g = store.getGame();
    const px = g.player.x;
    const py = g.player.y;

    expect(facingDoMercador(renderer), 'o mercador não nasceu olhando para o sul do grid')
      .toBe(DEFAULT_FACING);

    /* Longe demais: mantém o que tinha (regra (c)). */
    g.mercador = { x: px + 9, y: py };
    renderer.update(g, 0.016);
    expect(facingDoMercador(renderer), 'o mercador se virou para um jogador longe demais')
      .toBe(DEFAULT_FACING);

    /* Ao lado, na horizontal: encara (regra (a)). O jogador está a oeste dele. */
    g.mercador = { x: px + 1, y: py };
    renderer.update(g, 0.016);
    const oeste = dirIndex(-1, 0);
    expect(facingDoMercador(renderer), 'o mercador não encarou quem chegou pelo oeste')
      .toBe(oeste);

    /* Ao lado, na vertical: encara de novo, agora para o norte do grid. */
    g.mercador = { x: px, y: py + 1 };
    renderer.update(g, 0.016);
    const norte = dirIndex(0, -1);
    expect(norte, 'o caso perdeu a graça: a direção esperada virou a padrão')
      .not.toBe(DEFAULT_FACING);
    expect(facingDoMercador(renderer), 'o mercador não encarou quem chegou pelo norte')
      .toBe(norte);

    /* Em cima dele: delta (0,0) não é direção — ele guarda de onde o jogador
     * veio, em vez de escolher uma das oito ao acaso (regra (b)). */
    g.mercador = { x: px, y: py };
    renderer.update(g, 0.016);
    expect(facingDoMercador(renderer), 'o mercador girou quando o jogador subiu no tile')
      .toBe(norte);
  });

  it('o convite pulsa no tile do ponto e apaga quando o jogador chega', () => {
    const g = store.getGame();
    const merc = vizinhoLivre(g.player.x, g.player.y);
    g.mercador = merc;
    g.bancada = null;

    renderer.update(g, 0.016);
    renderer.draw(g);

    const primeiro = convites(falso.preenchimentos);
    expect(primeiro.length, 'o ponto de parada não convidou ninguém').toBe(1);
    expect(primeiro[0].alfa, 'o convite tem de ser translúcido').toBeGreaterThan(0);
    expect(primeiro[0].alfa, 'o convite ficou berrante — ele é discreto por contrato')
      .toBeLessThan(0.2);

    /* PULSA: meio ciclo depois o alfa é outro. `update` limita `dt` a 0,1 s, e
     * é por isso que o tempo anda em passos e não num salto só. */
    falso.preenchimentos.length = 0;
    for (let i = 0; i < 6; i++) renderer.update(g, 0.1);
    renderer.draw(g);
    const depois = convites(falso.preenchimentos);
    expect(depois.length, 'o convite sumiu sozinho').toBe(1);
    expect(depois[0].alfa, 'o convite não pulsa — ficou parado no mesmo alfa')
      .not.toBe(primeiro[0].alfa);

    /* O jogador CHEGA: o convite foi aceito e a luz apaga. O mercador continua
     * desenhado — quem some é o brilho do chão, não ele. */
    g.player.x = merc.x;
    g.player.y = merc.y;
    falso.elipses.length = 0;
    falso.preenchimentos.length = 0;
    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(convites(falso.preenchimentos).length, 'o convite continuou aceso sob os pés do jogador')
      .toBe(0);
    expect(corposDeMercador(falso.elipses).length, 'o mercador sumiu quando o jogador chegou')
      .toBe(1);
  });
});

