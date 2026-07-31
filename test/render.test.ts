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
 * PARADA. Desenhar o mercador e a estação de alquimia é trivial; o que não é
 * são as regras em volta — o recorte por FOV, a ORIENTAÇÃO do mercador por
 * observação (ele encara quem chega, sem uma letra no `Game`) e o BRILHO DE
 * CONVITE, que existe enquanto o jogador está longe e apaga quando ele pisa no
 * tile.
 *
 * A fase 2.1 partiu a oficina em TRÊS peças, uma por tile: o caldeirão em
 * `game.bancada` (o tile de interação) e, em `game.alquimiaExtras`, a estante
 * (primeiro extra) e a mesa (segundo). A lista de extras pode ser curta ou
 * VAZIA num cômodo apertado — e "desenhar menos peças" é o comportamento
 * correto, não uma exceção a tolerar. É o que os dois últimos casos deste
 * arquivo fixam.
 *
 * A fase do TERRENO trouxe o quarto, e é o de maior alcance: o CHÃO virou
 * sprite forjado (`src/render/tilesets/`), e com ele entraram três regras que
 * só existem no renderer — a escolha da variante de piso pelo bucket de decor,
 * a transparência das paredes do canto frontal aplicada agora a um `drawImage`,
 * e o sorteio determinístico dos adereços, que precisa ceder o tile a tudo o
 * que estiver de pé nele. Os casos do fim deste arquivo cobrem os três, nos
 * DOIS caminhos: com atlas (um `document` de mentira faz a forja acreditar que
 * há DOM) e sem atlas nenhum, que é o ambiente natural deste arquivo.
 *
 * O que este arquivo NÃO tenta ser: teste de pixel. Sem contexto 2D real não há
 * sprite nenhum — e é justamente esse o caminho exercitado aqui, o desenho de
 * RESERVA que mantém o jogo desenhável em ambiente sem Canvas (§7.3 do
 * BESTIARIO, agora valendo também para item, ponto de parada e terreno). A
 * aparência dos rigs é julgada na bancada de revisão
 * (tools/preview-personagem.mjs), não aqui.
 *
 * O invariante R54 aparece de graça em todos os casos: o renderer só recebe o
 * `Game`, e quem move o jogador e recolhe item é o engine, por `store.dispatch`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG, DEFAULT_FACING, DIRS8, dirIndex } from '../src/engine/core';
import { setStorage } from '../src/engine/save';
import { store } from '../src/engine/store';
import type { Enemy, Game, Item, ItemKind, Point } from '../src/engine/types';
import { IsoRenderer } from '../src/render/IsoRenderer';
import { ART_POR_U, PIXEL, medirModelo } from '../src/render/model3d';
import { COL_HOVER_LINE, LEVELS, buildLuts } from '../src/render/palette';
import { giroDaDirecao, limparCacheAtlas, limparCacheLuz } from '../src/render/spriteForge';
import { TILESET_NIVEL1 } from '../src/render/tilesets';

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

/**
 * Uma COLAGEM de sprite: o recorte pedido e onde ele foi parar, mais o alfa que
 * estava armado no contexto.
 *
 * O par (`largura`, `altura`) é a assinatura de QUEM foi colado — cada rig tem
 * um quadro de tamanho próprio, medido pelo forge a partir da geometria (e
 * portanto igual com ou sem pixels de verdade). É o mesmo truque das elipses de
 * raio conhecido que este arquivo já usava para contar despojos, aplicado ao
 * caminho de sprite.
 *
 * `alfa` é o que prova a transparência das paredes do canto frontal: o
 * `globalAlpha` do contexto compõe o `drawImage` como compõe o `fill()`.
 */
interface Colagem {
  largura: number;
  altura: number;
  dx: number;
  dy: number;
  alfa: number;
}

interface ContextoFalso {
  ctx: CanvasRenderingContext2D;
  elipses: Elipse[];
  preenchimentos: Preenchimento[];
  colagens: Colagem[];
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
  const colagens: Colagem[] = [];
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
    /* O renderer só usa a forma de 9 argumentos (recorte + destino) — é ela que
     * `colarTerreno`, o elenco e os despojos chamam. */
    drawImage(
      _fonte: unknown, _sx: number, _sy: number, largura: number, altura: number,
      dx: number, dy: number
    ): void {
      colagens.push({
        largura: largura, altura: altura, dx: dx, dy: dy, alfa: ctx.globalAlpha
      });
    },
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
    preenchimentos: preenchimentos,
    colagens: colagens
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
 * Sem contexto 2D não há atlas, então o mercador e as três peças da estação de
 * alquimia saem pelo caminho geométrico — e cada um tem uma elipse de CORPO com
 * raios próprios, que é o que permite contá-los e localizá-los nas anotações do
 * contexto falso. Os números vivem em `IsoRenderer.desenharMercadorGeometrico`,
 * `desenharCaldeiraoGeometrico`, `desenharEstanteGeometrica` e
 * `desenharMesaGeometrica`; se mudarem lá, mudam aqui.
 *
 * As quatro assinaturas são distintas entre si E das sombras elípticas (que
 * também passam pelo `ellipse` do contexto falso): é isso que faz contar peça
 * ser contar peça, e não contar sombra.
 * ------------------------------------------------------------------ */

/** O sino do manto do mercador: 6 × 9 px de tela a zoom 1. */
function corposDeMercador(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 6 && e.ry === 9);
}

/** O bojo do caldeirão — o tile de INTERAÇÃO: 9 × 6 px de tela a zoom 1. */
function corposDeCaldeirao(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 9 && e.ry === 6);
}

/** A estante, a peça ALTA da estação: 6,5 × 13 px de tela a zoom 1. */
function corposDeEstante(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 6.5 && e.ry === 13);
}

/** A mesa, a peça BAIXA da estação: 10 × 4,5 px de tela a zoom 1. */
function corposDeMesa(elipses: Elipse[]): Elipse[] {
  return elipses.filter((e) => e.rx === 10 && e.ry === 4.5);
}

/**
 * Quantas peças da ESTAÇÃO foram desenhadas neste quadro — caldeirão, estante e
 * mesa somados. É o número que a fase 2.1 fixa: três com dois extras, uma sem
 * extra nenhum.
 */
function pecasDaEstacao(elipses: Elipse[]): number {
  return corposDeCaldeirao(elipses).length
    + corposDeEstante(elipses).length
    + corposDeMesa(elipses).length;
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
 * `quantos` tiles DISTINTOS, caminháveis e dentro do campo de visão do jogador
 * — a matéria-prima de todo caso que precisa espalhar peças pelo mapa.
 *
 * Sair de `game.visible` (e não de um raio em volta do herói) é o que garante
 * que `seen` seja verdadeiro nos tiles escolhidos: o renderer recorta por FOV
 * (R31), e um tile "perto" que a sombra de uma parede cortou não desenharia
 * nada — o caso falharia pelo motivo errado.
 *
 * O tile do próprio jogador fica de fora: ele desenha o herói por cima, e o
 * convite apaga sob os pés dele. Misturar as duas coisas num caso de contagem
 * de peças só criaria ruído.
 */
function todosOsTilesVisiveisLivres(): Point[] {
  const g = store.getGame();
  const map = g.map;
  const saida: Point[] = [];
  for (const i of g.visible) {
    if (map.tiles[i] === CONFIG.TILE.WALL) continue;
    const x = i % map.w;
    const y = (i - x) / map.w;
    if (x === g.player.x && y === g.player.y) continue;
    saida.push({ x: x, y: y });
  }
  return saida;
}

function tilesVisiveisLivres(quantos: number): Point[] {
  const saida = todosOsTilesVisiveisLivres();
  if (saida.length < quantos) {
    throw new Error('o campo de visão inicial não ofereceu ' + quantos + ' tiles livres');
  }
  return saida.slice(0, quantos);
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
 * O TERRENO — o instrumental do caminho de SPRITE
 *
 * Nada aqui pinta um pixel: o que se mede é QUEM foi colado e ONDE. A ponte
 * entre as duas coisas é o quadro do atlas — `larguraFrame × alturaFrame` sai
 * da geometria do rig (o forge o calcula com `medirModelo`, que é matemática
 * pura), então ele é o MESMO com ou sem rasterização de verdade. É a versão
 * "caminho de sprite" das elipses de raio conhecido usadas acima.
 * ------------------------------------------------------------------ */

/** O que o renderer guarda em `atlasTerreno` — só o que este arquivo lê dele. */
interface AtlasMedido {
  larguraFrame: number;
  alturaFrame: number;
  /**
   * A projeção da ORIGEM do rig dentro do quadro (`spriteForge`). É o ponto que
   * tem de cair no centro do losango — para o terreno E para o elenco. Sem ele
   * não dá para provar o alinhamento: a colagem é `centro − âncora`, e sem a
   * âncora só se veem dois números de tela sem relação declarada.
   */
  ancoraX: number;
  ancoraY: number;
}

/**
 * O cache de atlas do terreno, por (nível, papel, índice). Privado no renderer
 * pelo mesmo motivo de `facingMercador`: é estado de desenho, não API. Lê-lo
 * aqui é o que permite reconhecer um bloco de piso ou um adereço nas colagens
 * sem repetir no teste a tabela de rigs do tileset.
 */
function atlasesDoTerreno(r: IsoRenderer): Map<string, AtlasMedido | null> {
  return (r as unknown as { atlasTerreno: Map<string, AtlasMedido | null> }).atlasTerreno;
}

/** `largura×altura` — a assinatura de um quadro, como chave de conjunto. */
function medida(largura: number, altura: number): string {
  return largura + 'x' + altura;
}

/** As assinaturas dos quadros de um papel do tileset já forjados. */
function medidasDoPapel(r: IsoRenderer, papel: string): Set<string> {
  const saida = new Set<string>();
  for (const [chave, atlas] of atlasesDoTerreno(r)) {
    if (!atlas) continue;
    if (chave !== papel && chave.indexOf(papel + ':') !== 0) continue;
    saida.add(medida(atlas.larguraFrame, atlas.alturaFrame));
  }
  return saida;
}

/** As colagens cujo quadro é de um dos atlas daquele papel. */
function colagensDe(colagens: Colagem[], medidas: Set<string>): Colagem[] {
  return colagens.filter((c) => medidas.has(medida(c.largura, c.altura)));
}

/**
 * O cache de atlas dos PONTOS DE PARADA (mercador, caldeirão, estante, mesa).
 * Privado pelo mesmo motivo de `atlasTerreno`, e lido aqui pela mesma razão: é
 * o único jeito de reconhecer a peça numa colagem e de saber a âncora dela.
 */
function atlasesDeParada(r: IsoRenderer): Map<string, AtlasMedido | null> {
  return (r as unknown as { atlasParada: Map<string, AtlasMedido | null> }).atlasParada;
}

/**
 * ONDE aquela colagem assentou: o ponto do mundo em que a ORIGEM do rig caiu.
 *
 * É a conta de `colarTerreno` e de `desenharParada` desfeita — as duas colam em
 * `centro − âncora·zoom`, então somar a âncora de volta devolve o centro. É esta
 * função que transforma "dois `drawImage` em posições diferentes" em "duas peças
 * apontando para o MESMO ponto de referência", que é o invariante em teste.
 */
function assentamento(c: Colagem, a: AtlasMedido, z: number): { x: number; y: number } {
  return { x: c.dx + a.ancoraX * z, y: c.dy + a.ancoraY * z };
}

/** O centro do losango de um tile — o ponto onde tudo assenta. */
function centroDoLosango(r: IsoRenderer, g: Game, x: number, y: number): { x: number; y: number } {
  const p = r.tileToScreen(g, x, y);
  return { x: p.sx, y: p.sy + (CONFIG.TH / 2) * r.cam.zoom };
}

/**
 * Todas as cores de ENTIDADE. Elas não marcam nada por si — entram aqui para
 * serem SUBTRAÍDAS dos marcadores de terreno logo abaixo.
 *
 * O motivo é um falso positivo real, custou uma rodada de depuração: os três
 * degraus da escada (`drawStairs`) são preenchidos com `SHADES.stone.dark`, e
 * `stone.dark[12]` é EXATAMENTE a mesma string que `FLOOR_LIT[0][4][9]`
 * (rgb(53,55,59)) — duas rampas de cinza-azulado que se cruzam num ponto. Um
 * marcador que aceite essa cor acusa "o piso saiu geométrico" toda vez que a
 * escada aparece no campo de visão.
 */
const CORES_DE_ENTIDADE = (() => {
  const saida = new Set<string>();
  for (const sh of Object.values(LUTS.SHADES)) {
    for (const c of sh.main) saida.add(c);
    for (const c of sh.dark) saida.add(c);
    for (const c of sh.light) saida.add(c);
  }
  return saida;
})();

/**
 * As cores que SÓ o losango geométrico do piso usa (`FLOOR_LIT`, menos o que
 * colide com entidade). É por elas que se prova que o caminho de reserva rodou
 * — ou que não rodou, quando há atlas. `FLOOR_DIM` fica de fora de propósito:
 * `drawStairs` também a usa, e o marcador tem de ser inequívoco.
 */
const CORES_DE_PISO_GEOMETRICO = (() => {
  const saida = new Set<string>();
  for (const alt of LUTS.FLOOR_LIT) {
    for (const bucket of alt) {
      for (const c of bucket) if (!CORES_DE_ENTIDADE.has(c)) saida.add(c);
    }
  }
  return saida;
})();

/** Idem para o prisma da parede — as três faces, acesas ou lembradas. */
const CORES_DE_PAREDE_GEOMETRICA = (() => {
  const saida = new Set<string>();
  for (const face of LUTS.WALL_LIT) {
    for (const bucket of face) {
      for (const c of bucket) if (!CORES_DE_ENTIDADE.has(c)) saida.add(c);
    }
  }
  for (const face of LUTS.WALL_DIM) {
    for (const c of face) if (!CORES_DE_ENTIDADE.has(c)) saida.add(c);
  }
  return saida;
})();

function losangosDePiso(preenchimentos: Preenchimento[]): Preenchimento[] {
  return preenchimentos.filter((p) => CORES_DE_PISO_GEOMETRICO.has(p.cor));
}

function prismasDeParede(preenchimentos: Preenchimento[]): Preenchimento[] {
  return preenchimentos.filter((p) => CORES_DE_PAREDE_GEOMETRICA.has(p.cor));
}

/**
 * Um contexto 2D MUDO para os canvases da forja.
 *
 * Ele não pode ser o contexto que o teste observa: `desenharModelo` pinta
 * centenas de faces por quadro do atlas, e essas pinceladas afogariam as
 * anotações do desenho de verdade. Aqui não se registra nada — o que importa da
 * forja é só que ela ACONTEÇA.
 *
 * Os métodos são exatamente os que `model3d` e `spriteForge` usam. Faltam
 * `getImageData`/`putImageData` de propósito: sem eles o forge pula o snap de
 * paleta e a camada emissiva (ele já degrada assim em jsdom), o que aqui é
 * ótimo — o atlas continua com o tamanho e a âncora certos, que é tudo o que
 * estes casos medem, e a forja fica barata.
 */
function contextoMudo(): unknown {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    closePath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    rect(): void {},
    fill(): void {},
    stroke(): void {},
    clearRect(): void {},
    fillRect(): void {},
    drawImage(): void {}
  };
}

/**
 * Instala um `document` de mentira, o mínimo que `spriteForge.criarCanvas`
 * exige para acreditar que há DOM. Com ele a forja completa e `disponivel` sai
 * verdadeiro — é o único jeito de exercitar o caminho de SPRITE em Node, onde
 * não existe canvas nenhum.
 *
 * Os caches do forge são invalidados na entrada E na saída, e as duas metades
 * importam: na entrada porque um caso anterior já pode ter memoizado o MESMO
 * rig como indisponível (e o `null` memoizado venceria o `document` novo); na
 * saída porque o inverso também é verdade — deixar um atlas "disponível" no
 * cache faria os casos sem DOM caírem no caminho de sprite e testarem outra
 * coisa. Sem essas duas linhas os casos deste arquivo passariam a depender da
 * ordem em que rodam.
 */
function instalarDomDeForja(): void {
  const raiz = globalThis as unknown as { document?: unknown };
  raiz.document = {
    createElement: (): unknown => ({
      width: 0,
      height: 0,
      getContext: (): unknown => contextoMudo()
    })
  };
  limparCacheAtlas();
  limparCacheLuz();
}

function removerDomDeForja(): void {
  const raiz = globalThis as unknown as { document?: unknown };
  delete raiz.document;
  limparCacheAtlas();
  limparCacheLuz();
}

/** Um inimigo mínimo, só o que o desenho consulta. */
function inimigo(id: number, x: number, y: number): Enemy {
  return {
    id: id, kind: 'chaser', x: x, y: y, hp: 5, maxHp: 5, atk: 1, range: 1,
    state: 'idle', plan: '', lastDmg: 0, bump: 0
  };
}

/**
 * Transforma em PAREDE o primeiro dos três tiles do canto frontal do jogador —
 * (x+1, y), (x, y+1), (x+1, y+1) —, que são os que o cobrem no passe de
 * paredes. É a única forma de garantir o cenário do teste: o mapa gerado pode
 * ter os três livres, e a transparência só existe quando há parede ali.
 *
 * O tile entra em `game.visible` à força porque a FOV não é recalculada: ele já
 * era visível como chão, e o renderer só pergunta se o índice está no conjunto.
 */
function paredeNoCantoFrontal(g: Game): void {
  const p = g.player;
  const alvos: Point[] = [
    { x: p.x + 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x + 1, y: p.y + 1 }
  ];
  for (const a of alvos) {
    if (a.x >= g.map.w || a.y >= g.map.h) continue;
    const i = a.y * g.map.w + a.x;
    g.map.tiles[i] = CONFIG.TILE.WALL;
    g.visible.add(i);
    return;
  }
  throw new Error('o jogador nasceu encostado na borda do mapa');
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
 * Os pontos de parada: o mercador e a estação de alquimia
 * ================================================================== */

describe('IsoRenderer — o mercador e a estação de alquimia', () => {
  let falso: ContextoFalso;
  let renderer: IsoRenderer;

  beforeEach(() => {
    store.newRun(SEMENTE);
    falso = criarContextoFalso();
    renderer = new IsoRenderer(criarCanvasFalso(falso.ctx));
  });

  it('desenha o mercador e as três peças da estação, cada uma no tile dela', () => {
    const g = store.getGame();
    /* Quatro tiles distintos e visíveis: mercador, caldeirão e os dois extras.
     * No jogo eles nunca coincidem — `populate` reserva um a um em `taken`. */
    const [merc, cald, ex1, ex2] = tilesVisiveisLivres(4);
    g.mercador = merc;
    g.bancada = cald;
    g.alquimiaExtras = [ex1, ex2];

    renderer.update(g, 0.016);
    renderer.draw(g);

    const mercs = corposDeMercador(falso.elipses);
    const calds = corposDeCaldeirao(falso.elipses);
    const estantes = corposDeEstante(falso.elipses);
    const mesas = corposDeMesa(falso.elipses);
    expect(mercs.length, 'o mercador não foi desenhado').toBe(1);
    expect(calds.length, 'o caldeirão não foi desenhado').toBe(1);
    expect(estantes.length, 'a estante não foi desenhada').toBe(1);
    expect(mesas.length, 'a mesa não foi desenhada').toBe(1);

    /* A âncora é a mesma dos inimigos: o `sx` do losango do tile, sem leque e
     * sem deslize — ponto de parada não anda. É esta asserção que prova o
     * MAPEAMENTO extras → peça: o primeiro extra é a estante, o segundo é a
     * mesa (`PECAS_EXTRAS_ALQUIMIA` no renderer). */
    const ancora = (p: Point): number => Math.round(renderer.tileToScreen(g, p.x, p.y).sx);
    expect(Math.round(mercs[0].cx), 'o mercador saiu do tile dele').toBe(ancora(merc));
    expect(Math.round(calds[0].cx), 'o caldeirão saiu do tile dele').toBe(ancora(cald));
    expect(Math.round(estantes[0].cx), 'a estante não foi para o PRIMEIRO extra')
      .toBe(ancora(ex1));
    expect(Math.round(mesas[0].cx), 'a mesa não foi para o SEGUNDO extra')
      .toBe(ancora(ex2));
  });

  it('com dois extras desenha três peças; com nenhum, só o caldeirão — e não quebra', () => {
    /*
     * O contrato da fase 2.1 em uma frase: `game.alquimiaExtras` é uma lista de
     * ATÉ dois pontos, e lista curta é degradação legítima. Num cômodo apertado
     * a estação perde a mesa, depois a estante; o caldeirão nunca cai, porque é
     * ele o tile de interação. Nenhum desses casos pode lançar.
     */
    const g = store.getGame();
    const [cald, ex1, ex2] = tilesVisiveisLivres(3);
    g.mercador = null;
    g.bancada = cald;

    /* DOIS extras: a estação inteira, três peças. */
    g.alquimiaExtras = [ex1, ex2];
    renderer.update(g, 0.016);
    renderer.draw(g);
    expect(pecasDaEstacao(falso.elipses), 'com dois extras a estação não saiu com três peças')
      .toBe(3);

    /* UM extra: caldeirão + estante. A mesa é a primeira a cair. */
    falso.elipses.length = 0;
    g.alquimiaExtras = [ex1];
    renderer.update(g, 0.016);
    renderer.draw(g);
    expect(pecasDaEstacao(falso.elipses), 'com um extra a estação não saiu com duas peças')
      .toBe(2);
    expect(corposDeEstante(falso.elipses).length, 'o extra único não virou a ESTANTE').toBe(1);
    expect(corposDeMesa(falso.elipses).length, 'apareceu mesa sem segundo extra').toBe(0);

    /* NENHUM extra: só o caldeirão, e nada explode. */
    falso.elipses.length = 0;
    g.alquimiaExtras = [];
    expect(() => {
      renderer.update(g, 0.016);
      renderer.draw(g);
    }, 'a estação sem extras quebrou o desenho').not.toThrow();
    expect(pecasDaEstacao(falso.elipses), 'sem extras deveria sobrar só o caldeirão').toBe(1);
    expect(corposDeCaldeirao(falso.elipses).length, 'o caldeirão sumiu junto com os extras')
      .toBe(1);
  });

  it('os extras são CENÁRIO: só o mercador e o caldeirão convidam', () => {
    /*
     * O pulso âmbar diz "olhe para este tile, há algo a fazer aqui". A estante e
     * a mesa não respondem a comando nenhum (`criar` só é aceito sobre
     * `game.bancada`), e um losango piscando embaixo de coisa que não responde
     * ensinaria o jogador a desconfiar do próprio convite.
     */
    const g = store.getGame();
    const [merc, cald, ex1, ex2] = tilesVisiveisLivres(4);
    g.mercador = merc;
    g.bancada = cald;
    g.alquimiaExtras = [ex1, ex2];

    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(convites(falso.preenchimentos).length,
      'o convite deveria sair uma vez para o mercador e uma para o caldeirão — e mais nenhuma')
      .toBe(2);
  });

  it('andar sem mercador nem estação não desenha ponto nenhum', () => {
    /* `populate` devolve `null` quando o mapa não ofereceu tile elegível. Um
     * `null` lido como zero desenharia o mercador no canto (0,0) do mapa. */
    const g = store.getGame();
    g.mercador = null;
    g.bancada = null;
    g.alquimiaExtras = [];

    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(corposDeMercador(falso.elipses).length, 'apareceu mercador do nada').toBe(0);
    expect(pecasDaEstacao(falso.elipses), 'apareceu peça de alquimia do nada').toBe(0);
    expect(convites(falso.preenchimentos).length, 'apareceu convite sem ponto de parada')
      .toBe(0);
  });

  it('fora do campo de visão não desenha nada — a regra dos inimigos (R31)', () => {
    const g = store.getGame();
    const [merc, cald] = tilesVisiveisLivres(2);
    g.mercador = merc;
    g.bancada = cald;
    g.alquimiaExtras = [];

    /* Os MESMOS tiles, no MESMO lugar da tela: só a visibilidade muda. Testar
     * com um tile distante provaria o recorte de tela, não o recorte de FOV. */
    renderer.update(g, 0.016);
    renderer.draw(g);
    expect(corposDeMercador(falso.elipses).length, 'o mercador visível não foi desenhado')
      .toBe(1);
    expect(corposDeCaldeirao(falso.elipses).length, 'o caldeirão visível não foi desenhado')
      .toBe(1);

    g.visible.delete(merc.y * g.map.w + merc.x);
    g.visible.delete(cald.y * g.map.w + cald.x);
    falso.elipses.length = 0;
    falso.preenchimentos.length = 0;
    renderer.update(g, 0.016);
    renderer.draw(g);

    expect(corposDeMercador(falso.elipses).length, 'o mercador apareceu fora do FOV')
      .toBe(0);
    expect(pecasDaEstacao(falso.elipses), 'o caldeirão apareceu fora do FOV').toBe(0);
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
    g.alquimiaExtras = [];

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


/* ================================================================== *
 * O TERRENO: piso, parede e adereços como sprite forjado
 *
 * O que estes casos protegem, e que nenhum outro alcança:
 *
 *   1. a BIFURCAÇÃO. Com atlas o chão é sprite; sem atlas é o losango do
 *      vanilla. Os dois caminhos têm de continuar vivos — o segundo é o que
 *      mantém o jogo desenhável em Node e em jsdom, e é o único que este
 *      arquivo veria se ninguém montasse o `document` de mentira;
 *   2. a TRANSPARÊNCIA do canto frontal. Ela é armada em `draw`, fora de
 *      `drawWall`, com `ctx.globalAlpha` — e a fase do terreno trocou o que
 *      está lá dentro (era `fill()`, virou `drawImage`). Se o alfa deixar de
 *      atravessar, a parede volta a cobrir o herói e ninguém percebe até jogar;
 *   3. o SORTEIO dos adereços. É a única lógica autoral desta fase: sem
 *      `Math.random` (proibido nesta camada), estável de quadro para quadro, e
 *      cedendo o tile a tudo o que estiver de pé nele.
 * ================================================================== */

describe('IsoRenderer — o terreno do tileset', () => {
  let falso: ContextoFalso;
  let renderer: IsoRenderer;

  beforeEach(() => {
    store.newRun(SEMENTE);
    /* Com o `document` de mentira a forja completa e o caminho de SPRITE entra
     * em cena. Os casos que precisam do contrário o desmontam no meio. */
    instalarDomDeForja();
    falso = criarContextoFalso();
    renderer = new IsoRenderer(criarCanvasFalso(falso.ctx));
  });

  afterEach(() => {
    removerDomDeForja();
  });

  it('o piso é SPRITE quando há atlas e volta ao losango geométrico sem canvas', () => {
    const g = store.getGame();
    renderer.update(g, 0.016);
    renderer.draw(g);

    const pisos = colagensDe(falso.colagens, medidasDoPapel(renderer, '1:piso'));
    expect(pisos.length, 'nenhum bloco de piso foi colado').toBeGreaterThan(0);
    expect(
      losangosDePiso(falso.preenchimentos).length,
      'com o atlas na mão o renderer ainda pintou losango à mão'
    ).toBe(0);

    /* O MESMO andar sem canvas nenhum (Node cru, jsdom): a forja falha, o
     * renderer guarda `null` e o chão volta a ser o losango do vanilla. Não é
     * degradação tolerada — é o caminho que mantém o jogo desenhável. */
    removerDomDeForja();
    const semDom = criarContextoFalso();
    const outro = new IsoRenderer(criarCanvasFalso(semDom.ctx));
    outro.update(g, 0.016);
    outro.draw(g);

    expect(semDom.colagens.length, 'colou sprite sem ter canvas nenhum').toBe(0);
    expect(
      losangosDePiso(semDom.preenchimentos).length,
      'sem canvas o chão simplesmente sumiu'
    ).toBeGreaterThan(0);
  });

  it('a parede do canto frontal recebe alfa < 1 — no sprite e na reserva geométrica', () => {
    const g = store.getGame();
    paredeNoCantoFrontal(g);
    /* Um passo de 0,1 s basta: o alfa desliza com `k = min(1, dt·9)`, então a
     * primeira atualização já leva 1 → ~0,42 rumo a `ALFA_PAREDE_OCULTA`. */
    renderer.update(g, 0.1);
    renderer.draw(g);

    const paredes = colagensDe(falso.colagens, medidasDoPapel(renderer, '1:parede'));
    expect(paredes.length, 'nenhuma parede foi colada').toBeGreaterThan(0);
    const translucidas = paredes.filter((c) => c.alfa < 0.995);
    expect(
      translucidas.length,
      'a parede que encobre o herói não recebeu alfa nenhum no `drawImage`'
    ).toBeGreaterThan(0);
    for (const t of translucidas) {
      expect(t.alfa, 'a parede translúcida ficou opaca demais').toBeLessThan(0.9);
      /* Nunca invisível: abaixo de ~0,3 o bloco some contra o fundo escuro e o
       * buraco lê como erro de desenho (ver `ALFA_PAREDE_OCULTA`). */
      expect(t.alfa, 'a parede translúcida virou buraco').toBeGreaterThan(0.3);
    }
    expect(
      paredes.some((c) => c.alfa === 1),
      'TODAS as paredes ficaram translúcidas — o alfa vazou do canto frontal'
    ).toBe(true);

    /* E a reserva geométrica respeita o mesmo alfa, porque ele é do CONTEXTO e
     * não do caminho: `fill()` e `drawImage` são compostos pelos dois. */
    removerDomDeForja();
    const semDom = criarContextoFalso();
    const outro = new IsoRenderer(criarCanvasFalso(semDom.ctx));
    outro.update(g, 0.1);
    outro.draw(g);

    const prismas = prismasDeParede(semDom.preenchimentos);
    expect(prismas.length, 'nenhuma parede geométrica foi desenhada').toBeGreaterThan(0);
    expect(
      prismas.some((p) => p.alfa > 0.3 && p.alfa < 0.9),
      'o prisma de reserva ignorou a transparência do canto frontal'
    ).toBe(true);
    expect(
      prismas.some((p) => p.alfa === 1),
      'TODOS os prismas ficaram translúcidos'
    ).toBe(true);
  });

  it('o adereço não nasce sob entidade nem sob despojo', () => {
    const g = store.getGame();
    g.enemies = [];
    g.items = [];
    g.mercador = null;
    g.bancada = null;
    g.alquimiaExtras = [];

    renderer.update(g, 0.016);
    renderer.draw(g);
    const medidas = medidasDoPapel(renderer, '1:adereco');
    const n0 = colagensDe(falso.colagens, medidas).length;
    expect(n0, 'o andar não recebeu adereço nenhum — o sorteio não está rodando')
      .toBeGreaterThan(0);

    /* Um monstro em CADA tile do campo de visão: como o adereço só é desenhado
     * onde o piso é desenhado, cobrir o campo inteiro é cobrir todos os
     * candidatos. Não pode sobrar nenhum. */
    const tiles = todosOsTilesVisiveisLivres();
    g.enemies = tiles.map((t, k) => inimigo(k + 1, t.x, t.y));
    falso.colagens.length = 0;
    renderer.draw(g);
    expect(
      colagensDe(falso.colagens, medidas).length,
      'nasceu adereço embaixo de monstro'
    ).toBe(0);

    /* O mesmo com despojos no chão: eles são pequenos como o adereço, e é
     * justamente por isso que um seixo por cima de uma gosma seria confusão. */
    g.enemies = [];
    g.items = tiles.map((t, k) => item(k + 1, 'gosma', t.x, t.y));
    falso.colagens.length = 0;
    renderer.draw(g);
    expect(
      colagensDe(falso.colagens, medidas).length,
      'nasceu adereço embaixo de despojo'
    ).toBe(0);

    /* E VOLTA quando o tile esvazia, com a mesma conta do primeiro quadro: o
     * sorteio é função de (x, y, decor) e de mais nada — nem de relógio, nem de
     * `Math.random`, que esta camada proíbe (tools/check-boundaries.mjs). */
    g.items = [];
    falso.colagens.length = 0;
    renderer.draw(g);
    expect(
      colagensDe(falso.colagens, medidas).length,
      'o adereço não voltou quando o tile esvaziou'
    ).toBe(n0);
  });

  it('o mesmo tile recebe o mesmo adereço em todo quadro', () => {
    const g = store.getGame();
    renderer.update(g, 0.016);
    renderer.draw(g);
    const medidas = medidasDoPapel(renderer, '1:adereco');
    const assinar = (cs: Colagem[]): string[] =>
      colagensDe(cs, medidas).map((c) => c.dx + ',' + c.dy + ':' + medida(c.largura, c.altura)).sort();

    const primeiro = assinar(falso.colagens);
    expect(primeiro.length, 'nenhum adereço para comparar').toBeGreaterThan(0);

    /* Meio segundo de relógio visual depois (o `update` limita `dt` a 0,1 s, e
     * a câmera já está no alvo, então nada na tela deveria ter se mexido). */
    falso.colagens.length = 0;
    for (let k = 0; k < 5; k++) renderer.update(g, 0.1);
    renderer.draw(g);
    expect(assinar(falso.colagens), 'o adereço mudou de lugar sozinho entre dois quadros')
      .toEqual(primeiro);
  });

  it('o adereço cede o tile ao ponto de parada e ao herói', () => {
    const g = store.getGame();
    g.enemies = [];
    g.items = [];
    g.mercador = null;
    g.bancada = null;
    g.alquimiaExtras = [];

    renderer.update(g, 0.016);
    renderer.draw(g);
    const medidas = medidasDoPapel(renderer, '1:adereco');
    const contar = (): number => {
      falso.colagens.length = 0;
      renderer.draw(g);
      return colagensDe(falso.colagens, medidas).length;
    };
    const n0 = colagensDe(falso.colagens, medidas).length;
    expect(n0, 'o andar não recebeu adereço nenhum').toBeGreaterThan(0);

    /* Onde há adereço e onde não há, achados por ELIMINAÇÃO: o caldeirão é
     * posto em cada candidato e o total ou cai de exatamente um (aquele tile
     * tinha adereço) ou não se mexe (não tinha). Se a regra não existisse, o
     * total jamais cairia — é essa a prova. */
    let comAdereco: Point | null = null;
    let semAdereco: Point | null = null;
    for (const c of todosOsTilesVisiveisLivres()) {
      g.bancada = c;
      const n = contar();
      expect([n0, n0 - 1], 'o caldeirão mexeu em mais de um adereço (ou criou um)').toContain(n);
      if (n === n0 - 1) {
        if (!comAdereco) comAdereco = c;
      } else if (!semAdereco) {
        semAdereco = c;
      }
      if (comAdereco && semAdereco) break;
    }
    expect(comAdereco, 'nenhum tile cedeu o adereço ao caldeirão').not.toBeNull();
    expect(semAdereco, 'o caso perdeu a graça: todo tile visível tem adereço').not.toBeNull();
    g.bancada = null;

    /* O HERÓI segue a mesma regra. A comparação é entre os DOIS destinos, e não
     * contra `n0`, porque sair do tile de origem LIBERA o adereço de lá — o
     * efeito colateral se cancela quando os dois quadros o têm. */
    const alvoCom = comAdereco as Point;
    const alvoSem = semAdereco as Point;
    g.player.x = alvoSem.x;
    g.player.y = alvoSem.y;
    const nSemAdereco = contar();
    g.player.x = alvoCom.x;
    g.player.y = alvoCom.y;
    const nComAdereco = contar();
    expect(nComAdereco, 'o herói pisou no adereço e ele continuou desenhado')
      .toBe(nSemAdereco - 1);
  });

  /* ------------------------------------------------------------------ *
   * A ESCADA NÃO RECEBE ADEREÇO — regressão de um `else` que trocou de dono
   * ------------------------------------------------------------------ */

  it('a escada não recebe adereço: o glifo da saída nunca é coberto', () => {
    /*
     * O passe de pisos era `if (escada) … else if (porta) … else adereço`. Quando
     * a cachoeira entrou entre o encadeamento e o `else`, o `else` passou a casar
     * com `if (agua)` — e a escada, que estava protegida pela estrutura, voltou a
     * sortear seixo em silêncio. Um adereço em cima do glifo esconde a única
     * saída do andar, e nada no jogo avisa.
     *
     * A prova é por ELIMINAÇÃO, o mesmo método do caso anterior: acha-se um tile
     * visível QUE TEM adereço, transforma-se ele em escada e o total tem de cair
     * de exatamente um. Se a exclusão não existisse, o total não se mexeria.
     */
    const g = store.getGame();
    g.enemies = [];
    g.items = [];
    g.mercador = null;
    g.bancada = null;
    g.alquimiaExtras = [];

    renderer.update(g, 0.016);
    renderer.draw(g);
    const medidas = medidasDoPapel(renderer, '1:adereco');
    const contar = (): number => {
      falso.colagens.length = 0;
      renderer.draw(g);
      return colagensDe(falso.colagens, medidas).length;
    };
    const n0 = colagensDe(falso.colagens, medidas).length;
    expect(n0, 'o andar não recebeu adereço nenhum').toBeGreaterThan(0);

    let comAdereco: Point | null = null;
    for (const c of todosOsTilesVisiveisLivres()) {
      if (g.map.tiles[c.y * g.map.w + c.x] !== CONFIG.TILE.FLOOR) continue;
      if (g.map.agua && g.map.agua[c.y * g.map.w + c.x]) continue;
      g.bancada = c;
      const n = contar();
      g.bancada = null;
      if (n === n0 - 1) { comAdereco = c; break; }
    }
    expect(comAdereco, 'nenhum tile visível tinha adereço para ceder').not.toBeNull();

    const alvo = comAdereco as Point;
    const i = alvo.y * g.map.w + alvo.x;
    const antes = g.map.tiles[i];
    g.map.tiles[i] = CONFIG.TILE.STAIRS;
    expect(contar(), 'nasceu adereço em cima do glifo da escada').toBe(n0 - 1);
    g.map.tiles[i] = CONFIG.TILE.DOOR;
    expect(contar(), 'nasceu adereço em cima da porta').toBe(n0 - 1);
    g.map.tiles[i] = antes;
    expect(contar(), 'o adereço não voltou quando o tile virou piso de novo').toBe(n0);
  });
});

/* ================================================================== *
 * A GRADE: o terreno e o elenco assentam no MESMO ponto
 *
 * Este bloco existe por causa de uma regressão que custou os três sintomas de
 * uma vez — herói e mobília "descentralizados", peças de terreno cobrindo
 * entidades, e cantos que a imagem mostrava abertos recusando a passagem.
 *
 * A causa foi uma só: `colarTerreno` deixou de colar pela ÂNCORA do atlas e
 * passou a colar pelo centro do quadro mais uma correção. `ancoraX/ancoraY` NÃO
 * é o meio do desenho — é a projeção da origem `(0,0,0)` do rig dentro do
 * quadro (ver `spriteForge`), e como o tileset calibra todo bloco com o topo do
 * piso em z = 0, essa origem é EXATAMENTE o centro do losango. O centro do
 * quadro, por outro lado, depende de quanto cada rig sobe e desce: o erro dava
 * +14 px no piso, +32 px na parede, +10 px na água e +9 px no tufo — cada peça
 * do MESMO tile num lugar diferente, e o elenco (que sempre colou pela âncora)
 * flutuando sobre tudo.
 *
 * O que estes casos travam, e que nenhum outro alcança:
 *
 *   1. o piso e a peça do mesmo tile reconstroem o MESMO ponto, e esse ponto é
 *      o centro do losango. A diferença entre as duas colagens é, na conta,
 *      exatamente a diferença das âncoras — que é o que a frase "usam o mesmo
 *      critério" quer dizer em números;
 *   2. NENHUM bloco de piso sai da grade: todo assentamento cai num centro de
 *      losango conhecido do mapa;
 *   3. o rig do terreno não sobe acima do vértice N do próprio losango. Este é
 *      o guarda GEOMÉTRICO da ordem do pintor: o passe de pisos de uma
 *      antidiagonal roda DEPOIS das entidades da anterior, então um bloco que
 *      passasse do próprio vértice cobriria quem está atrás — e o conserto não
 *      seria de ordem, seria de rig. Hoje as lâminas de grama respeitam o
 *      limite na mosca (topo em −16,0 px, o vértice); o caso está aqui para o
 *      dia em que alguém quiser lâminas de 6u.
 * ================================================================== */

describe('IsoRenderer — a grade do terreno e a do elenco', () => {
  let falso: ContextoFalso;
  let renderer: IsoRenderer;

  beforeEach(() => {
    store.newRun(SEMENTE);
    instalarDomDeForja();
    falso = criarContextoFalso();
    renderer = new IsoRenderer(criarCanvasFalso(falso.ctx));
  });

  afterEach(() => {
    removerDomDeForja();
  });

  it('o piso e a peça do MESMO tile assentam no centro do losango', () => {
    const g = store.getGame();
    /* Um tile visível, livre e de piso comum: o caldeirão vai para cima dele, e
     * é o par (bloco de piso, peça) daquele losango que este caso mede. */
    let alvo: Point | null = null;
    for (const c of todosOsTilesVisiveisLivres()) {
      const i = c.y * g.map.w + c.x;
      if (g.map.tiles[i] !== CONFIG.TILE.FLOOR) continue;
      if (g.map.agua && g.map.agua[i]) continue;
      alvo = c;
      break;
    }
    expect(alvo, 'o campo de visão não ofereceu um tile de piso seco').not.toBeNull();
    const tile = alvo as Point;

    g.enemies = [];
    g.items = [];
    g.mercador = null;
    g.alquimiaExtras = [];
    g.bancada = tile;

    renderer.update(g, 0.016);
    renderer.draw(g);

    const z = renderer.cam.zoom;
    const centro = centroDoLosango(renderer, g, tile.x, tile.y);

    /* Qual variante de piso o tile usa: a MESMA conta do renderer (bucket do
     * decor, fechado com módulo sobre a lista do tileset). Sem isto não dá para
     * escolher o atlas certo entre as oito chaves de `1:piso:k`. */
    const bucket = g.map.decor ? g.map.decor[tile.y * g.map.w + tile.x] & 7 : 0;
    const k = bucket % TILESET_NIVEL1.piso.length;
    const atlasPiso = atlasesDoTerreno(renderer).get('1:piso:' + k);
    const atlasCald = atlasesDeParada(renderer).get('caldeirao');
    expect(atlasPiso, 'o atlas do piso daquele tile não foi forjado').toBeTruthy();
    expect(atlasCald, 'o atlas do caldeirão não foi forjado').toBeTruthy();
    const ap = atlasPiso as AtlasMedido;
    const ac = atlasCald as AtlasMedido;

    /* As duas colagens: reconhecidas pelo tamanho do quadro (a assinatura de
     * quem foi colado) e, no caso do piso, pela posição — há um bloco de piso
     * por tile visível, e só um deles é o do losango em questão. */
    const doPiso = falso.colagens.filter(
      (c) => c.largura === ap.larguraFrame && c.altura === ap.alturaFrame
    );
    const daPeca = falso.colagens.filter(
      (c) => c.largura === ac.larguraFrame && c.altura === ac.alturaFrame
    );
    expect(daPeca.length, 'o caldeirão não foi colado').toBe(1);

    const pontoPeca = assentamento(daPeca[0], ac, z);
    expect(Math.abs(pontoPeca.x - centro.x), 'a peça não assentou no centro do losango (x)')
      .toBeLessThanOrEqual(0.5);
    expect(Math.abs(pontoPeca.y - centro.y), 'a peça não assentou no centro do losango (y)')
      .toBeLessThanOrEqual(0.5);

    const pisoDoTile = doPiso.filter((c) => {
      const p = assentamento(c, ap, z);
      return Math.abs(p.x - centro.x) <= 0.5 && Math.abs(p.y - centro.y) <= 0.5;
    });
    expect(
      pisoDoTile.length,
      'nenhum bloco de piso assentou no centro daquele losango — terreno e elenco em grades diferentes'
    ).toBe(1);

    /* E o fecho da frase: a diferença entre os dois pontos de colagem é
     * INTEIRAMENTE explicada pelas âncoras. Um pixel de folga em cada eixo é o
     * arredondamento que as duas colagens fazem em separado (`Math.round` por
     * peça), não um deslocamento. */
    const dxEsperado = (ac.ancoraX - ap.ancoraX) * z;
    const dyEsperado = (ac.ancoraY - ap.ancoraY) * z;
    expect(
      Math.abs((pisoDoTile[0].dx - daPeca[0].dx) - dxEsperado),
      'a diferença horizontal entre as colagens não é a diferença das âncoras'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((pisoDoTile[0].dy - daPeca[0].dy) - dyEsperado),
      'a diferença vertical entre as colagens não é a diferença das âncoras'
    ).toBeLessThanOrEqual(1);
  });

  it('nenhum sprite de terreno sai da grade: todo assentamento é um centro de losango', () => {
    const g = store.getGame();
    renderer.update(g, 0.016);
    renderer.draw(g);

    const z = renderer.cam.zoom;
    /* Todos os centros de losango do mapa, arredondados — a grade inteira. */
    const grade = new Set<string>();
    for (let y = 0; y < g.map.h; y++) {
      for (let x = 0; x < g.map.w; x++) {
        const c = centroDoLosango(renderer, g, x, y);
        grade.add(Math.round(c.x) + ',' + Math.round(c.y));
      }
    }

    /*
     * Os atlas de terreno indexados pela assinatura do quadro. Uma medida pode
     * ter MAIS DE UM dono — o piso de lajota e a água são os dois 68×52 — e as
     * âncoras deles diferem em 8 px, que é justamente o afundamento da poça.
     * Por isso a conferência é "ALGUM dono explica esta colagem", e não "o dono
     * é este": com espaçamento vertical de 32 px entre losangos de mesma coluna,
     * dois candidatos a 8 px de distância jamais caem os dois na grade — a
     * ambiguidade não afrouxa a prova.
     */
    const candidatos = new Map<string, AtlasMedido[]>();
    for (const [, atlas] of atlasesDoTerreno(renderer)) {
      if (!atlas) continue;
      const m = medida(atlas.larguraFrame, atlas.alturaFrame);
      const lista = candidatos.get(m);
      if (lista) lista.push(atlas);
      else candidatos.set(m, [atlas]);
    }
    expect(candidatos.size, 'nenhum atlas de terreno foi forjado').toBeGreaterThan(0);

    let conferidos = 0;
    for (const c of falso.colagens) {
      const donos = candidatos.get(medida(c.largura, c.altura));
      if (!donos) continue;
      const pontos = donos.map((a) => {
        const p = assentamento(c, a, z);
        return Math.round(p.x) + ',' + Math.round(p.y);
      });
      expect(
        pontos.some((p) => grade.has(p)),
        'um sprite de terreno assentou fora da grade de losangos: ' + pontos.join(' | ')
      ).toBe(true);
      conferidos++;
    }
    expect(conferidos, 'nenhum sprite de terreno foi conferido').toBeGreaterThan(10);
  });

  it('nenhum bloco do tileset sobe acima do vértice N do próprio losango', () => {
    /*
     * O GUARDA GEOMÉTRICO da ordem do pintor. Os pisos de uma antidiagonal são
     * desenhados DEPOIS das entidades da antidiagonal anterior — é o preço de
     * um passe único por faixa, e não se conserta com ordem. O que mantém isso
     * inofensivo é o RIG: enquanto o bloco não passar do vértice norte do
     * próprio losango, nenhum pixel dele pode cair sobre quem está atrás.
     *
     * `CONFIG.TH / 2` = 16 px é o vértice. Hoje os pisos batem exatos nele (as
     * lâminas de grama são todas das bordas +Y e +X, as que a projeção mostra à
     * frente, e por isso não estouram o topo). Uma lâmina de 6u no miolo do
     * bloco quebraria este caso — e é para isso que ele existe.
     *
     * A PAREDE fica de fora, e é decisão, não esquecimento: ela SOBE 36 px de
     * propósito (é o volume que o prisma geométrico sempre ocupou) e cobrir o
     * que está atrás é o trabalho dela. Quem cuida do caso em que isso encobre
     * o herói é `ALFA_PAREDE_OCULTA`, não a geometria.
     */
    const limite = CONFIG.TH / 2;
    const giro = giroDaDirecao(2); // DIR_TERRENO: giro zero, o bloco sem rotação
    const pecas: Array<[string, unknown]> = [];
    TILESET_NIVEL1.piso.forEach((m, i) => { pecas.push(['piso[' + i + ']', m]); });
    TILESET_NIVEL1.aderecos.forEach((m, i) => { pecas.push(['adereço[' + i + ']', m]); });
    if (TILESET_NIVEL1.agua) pecas.push(['água', TILESET_NIVEL1.agua]);

    for (const [nome, modelo] of pecas) {
      const c = medirModelo(modelo as never, {
        pose: TILESET_NIVEL1.repouso, giro: giro, escala: ART_POR_U
      });
      const sobe = -c.minY * PIXEL;
      expect(sobe, nome + ' sobe ' + sobe.toFixed(1) + ' px acima do centro do losango — o teto é ' + limite)
        .toBeLessThanOrEqual(limite);
    }
  });

  it('a poça AFUNDA o bastante para ler como obstáculo', () => {
    /*
     * A água é o único terreno que parece piso e não é: `map.tiles` a mantém
     * como `Tile.Floor` e quem barra o passo é o bitmap `map.agua`
     * (`isWalkable`, src/engine/mapgen.ts) — e, pelo corte de canto de `mover`,
     * ela tranca também as diagonais em volta. Medido em quatro sementes, um
     * andar tem 41 a 58 tiles de água que recusam de 95 a 148 passos ortogonais
     * e de 50 a 86 diagonais cujo ALVO estava livre.
     *
     * Regra que não se vê é regra que o jogador chama de bug. Com o afundamento
     * antigo de 1,2u (3 px) a poça lia como laje azul rente ao chão; o degrau
     * mínimo para o barranco do vizinho aparecer acima da lâmina é meia fileira
     * de tela. Este caso trava o número, não a cor.
     */
    expect(TILESET_NIVEL1.agua, 'o tileset perdeu o rig de água').toBeTruthy();
    expect(
      TILESET_NIVEL1.aguaAfundaPx,
      'a poça afundou de menos: o degrau não aparece e a água lê como piso'
    ).toBeGreaterThanOrEqual(6);
    /* E ela não pode virar cratera: mais que uma fileira inteira e a lâmina
     * some atrás do bloco da frente. */
    expect(TILESET_NIVEL1.aguaAfundaPx, 'a poça virou buraco').toBeLessThanOrEqual(CONFIG.TH / 2);

    /* O topo do rig tem de estar de fato ABAIXO do plano do chão, e por esse
     * mesmo tanto: o número acima só vale se o modelo o obedecer. */
    const c = medirModelo(TILESET_NIVEL1.agua as never, {
      pose: TILESET_NIVEL1.repouso, giro: giroDaDirecao(2), escala: ART_POR_U
    });
    const sobe = -c.minY * PIXEL;
    expect(
      CONFIG.TH / 2 - sobe,
      'o rig da água não afunda o que o tileset declara'
    ).toBeGreaterThanOrEqual(TILESET_NIVEL1.aguaAfundaPx - 1);
  });
});
