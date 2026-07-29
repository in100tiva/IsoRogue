/*
 * ISOROGUE — src/render/IsoRenderer.ts
 *
 * Renderização isométrica em Canvas 2D puro. Porte 1:1 de
 * legacy/src-vanilla/50-render.js (§8 e §12 do docs/CONTRACTS.md;
 * R01..R11, R29, R30, R31, R50, R54).
 *
 * O que mudou em relação ao vanilla — e SÓ isto:
 *   - O singleton `R.Render` virou classe. Todo estado que era variável de
 *     módulo (câmera, LUTs, buffers de índice, VFX, relógio visual) é campo da
 *     instância: dois canvases simultâneos não podem interferir um no outro.
 *   - `init(canvas)` virou `constructor(canvas)` e ganhou par: `dispose()`.
 *   - O listener de `resize` do `window` saiu (quem observa o container agora é
 *     o `ResizeObserver` da casca React, docs/ARQUITETURA-REACT.md §5). O zoom
 *     por roda continua sendo desta classe — daí `handlesWheel`.
 * Nenhuma cor, fórmula, ordem de desenho ou camada de debug foi alterada.
 *
 * Invariantes deste módulo:
 *   - `update(game, dt)` só escreve em campos puramente visuais (câmera, VFX,
 *     `ent.bump`). Nunca em posição, hp ou turno (R54).
 *   - Zero aleatoriedade e zero alocação de objeto no laço quente (LUTs prontas).
 *   - `getContext('2d')` nulo (jsdom) degrada em silêncio: nada lança.
 *
 * O QUE MUDOU NESTA FASE (docs/PERSONAGEM.md §9):
 *   - O jogador deixou de ser desenhado com formas soltas e passou a ser um
 *     quadro do atlas do Guerreiro (`./spriteForge` + `./characters/warrior`),
 *     colado com `drawImage` e `imageSmoothingEnabled = false`. A sombra
 *     elíptica, a barra de vida e a ordem do pintor por antidiagonal continuam
 *     exatamente como estavam.
 *   - A máquina de animação (parado/andando/atacando) vive AQUI, alimentada só
 *     por `dt` e pela OBSERVAÇÃO do estado (tile do jogador, `stats.dmgDealt`,
 *     `player.facing`). Ela não escreve uma única letra no engine, e o turno
 *     jamais espera por ela (R54, §6 do PERSONAGEM.md).
 *
 * O QUE MUDOU NA FASE DO BESTIÁRIO (docs/BESTIARIO.md §0, §1 e §7):
 *   - Os TRÊS arquétipos ganharam rosto: `chaser` é o GOBLIN, `linker` é o
 *     SLIME (§11) e `sentinel` é o OGRO (§12), cada um desenhado com um quadro
 *     do atlas do seu rig em `./characters/`. Quem faz o encaixe é a tabela
 *     `RETRATOS` (logo abaixo) — uma linha por bicho, e nada mais neste arquivo
 *     sabe qual monstro está desenhando.
 *   - O desenho geométrico NÃO saiu: ele deixou de ser o caminho normal de
 *     `sentinel`/`linker` e virou a rede de segurança de quem não conseguiu
 *     forjar atlas (jsdom, sem contexto 2D). Os dois caminhos continuam
 *     convivendo, e é o que mantém o jogo desenhável em ambiente sem Canvas.
 *   - O quadro do inimigo é MODULADO pela luz do tile (`lvl`) via
 *     `quadroModulado()` do sprite forge, com os olhos emissivos preservados em
 *     brilho pleno (§1.1). O jogador continua em brilho pleno: ele é a fonte de
 *     luz (§7.1 do PERSONAGEM.md).
 *   - O `facing` do inimigo é DERIVADO aqui, por observação da mudança de tile
 *     entre turnos (§0.2), e mora no `Vfx` desta classe. Nenhum campo novo em
 *     `Enemy`, em `snapshot()`, no save ou no oracle — ver `orientarInimigo`.
 */

import { CONFIG, DEFAULT_FACING, cheb, dirIndex, normalizeFacing } from '../engine/core';
import { DIJKSTRA_INF } from '../engine/dijkstra';
import { checkSymmetry, computeFov } from '../engine/fov';
import type { ArchetypeKey, Enemy, Game, GameMap, Item, Player } from '../engine/types';
import {
  buildLuts,
  COL_BG,
  COL_BROKEN,
  COL_BROKEN_LINE,
  COL_EDGE_DIM,
  COL_EDGE_LIT,
  COL_GRID,
  COL_HOVER_FILL,
  COL_HOVER_LINE,
  COL_HPBAR_BG,
  COL_PROBE,
  COL_PROBE_LINE,
  COL_SHADOW_ENT,
  COL_SHADOW_WALL,
  COL_SHADOW_WALL_DIM,
  COL_WALL_EDGE_DIM,
  COL_WALL_EDGE_LIT,
  FONT_MONO,
  LEVELS
} from './palette';
import type { Luts } from './palette';
import {
  MODELO_ESPADA,
  MODELO_GUERREIRO,
  MODELO_GUERREIRO_SEM_ESPADA,
  PALETA_GUERREIRO,
  POSE_AJOELHADA,
  POSE_CAIDA,
  POSE_PARADA,
  RAMPAS_GUERREIRO,
  RAMPA_DA_COR
} from './characters/warrior';
import {
  ARCO_GOLPE_GOBLIN,
  CORES_EMISSIVAS_GOBLIN,
  MODELO_GOBLIN,
  PALETA_GOBLIN,
  POSE_PARADA_GOBLIN,
  RAMPAS_GOBLIN,
  RAMPA_DA_COR_GOBLIN
} from './characters/goblin';
import {
  ARCO_GOLPE_SLIME,
  CORES_EMISSIVAS_SLIME,
  MODELO_SLIME,
  PALETA_SLIME,
  POSE_PARADA_SLIME,
  RAMPAS_SLIME,
  RAMPA_DA_COR_SLIME
} from './characters/slime';
import {
  ARCO_GOLPE_OGRO,
  CORES_EMISSIVAS_OGRO,
  MODELO_OGRO,
  PALETA_OGRO,
  POSE_PARADA_OGRO,
  RAMPAS_OGRO,
  RAMPA_DA_COR_OGRO
} from './characters/ogre';
import { forjarAtlas, POSE_NEUTRA, quadroModulado } from './spriteForge';
import type { AtlasPersonagem, Estado, OpcoesForja } from './spriteForge';
import type { No } from './model3d';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ *
 * O Guerreiro (docs/PERSONAGEM.md §7 e §9)
 * ------------------------------------------------------------------ */

/**
 * Opções da forja, em constante de módulo por dois motivos: o forge memoiza por
 * (modelo, opções) e um objeto novo a cada chamada geraria uma chave nova; e a
 * paleta/rampas/repouso do personagem são propriedade dele, não do renderizador
 * — aqui só passam de mão em mão.
 *
 * `repouso: POSE_PARADA` é obrigatório: é a pose que ergue a espada na diagonal
 * e põe o escudo em guarda (I4/I5). Sem ela o forge usaria a pose neutra e o
 * guerreiro perderia o desenho da referência.
 */
const FORJA_GUERREIRO: OpcoesForja = {
  paleta: PALETA_GUERREIRO,
  rampas: RAMPAS_GUERREIRO,
  rampaDaCor: RAMPA_DA_COR,
  repouso: POSE_PARADA
};

/* ------------------------------------------------------------------ *
 * As cinemáticas do guerreiro (intro da descida e morte)
 *
 * Tudo nesta seção é COSMÉTICO: alimentado por `dt` e por observação do
 * estado (troca de mapa, borda de `game.over`), sem uma letra no engine (R54).
 * As poses da morte não são animação de §6 — são REPUSOS de forja congelados
 * na coluna ('parado', 0) de atlases secundários (a chave de cache do forge
 * já inclui o repouso), lidos sempre nessa coluna, na direção do facing.
 * ------------------------------------------------------------------ */

/** A fase da cinemática, exposta à UI pelo micro-store de `ui/cinematics.ts`. */
export type FaseCinematica = 'nenhuma' | 'intro' | 'morte' | 'concluida';

/** Forja do corpo ajoelhado, sem espada (fase 3 da morte). */
const FORJA_MORTE_AJOELHADO: OpcoesForja = { ...FORJA_GUERREIRO, repouso: POSE_AJOELHADA };
/** Forja do corpo caído, sem espada (fase 4 da morte). */
const FORJA_MORTE_CAIDO: OpcoesForja = { ...FORJA_GUERREIRO, repouso: POSE_CAIDA };
/** Forja da espada solta — repouso neutro: a rotação da queda é de tela. */
const FORJA_ESPADA: OpcoesForja = { ...FORJA_GUERREIRO, repouso: POSE_NEUTRA };

/* --- tempos da INTRO (descendo as escadas) --- */
/** Duração total da intro. */
const DUR_INTRO = 1.3;
/** Trecho em que o sprite desliza de `INTRO_ALTURA_PX`·zoom até a âncora. */
const INTRO_DESLIZE = 1.0;
/** Trecho final em que o glifo da escada esmaece (prop cinematográfico). */
const INTRO_ESMAECER = 0.3;
/** Altura de tela de onde o guerreiro desce, em px a zoom 1. */
const INTRO_ALTURA_PX = 48;

/* --- tempos da MORTE (sequência de 3,4 s) --- */
/** Sangue: a poça cresce de 0 até aqui e persiste. */
const MORTE_SANGUE = 0.9;
/** Espada: solta-se da mão neste instante e pousa em `MORTE_ESPADA_FIM`. */
const MORTE_ESPADA_INICIO = 0.15;
const MORTE_ESPADA_FIM = 0.9;
/** Troca dura para o atlas ajoelhado. */
const MORTE_AJOELHADO = 0.9;
/** Troca dura para o atlas caído. */
const MORTE_CAIDO = 1.7;
/** O fade preto começa aqui e fecha em alpha 0,9 no fim da sequência. */
const MORTE_FADE_INICIO = 2.2;
const DUR_MORTE = 3.4;

/** Raio final da poça de sangue, em px a zoom 1. */
const SANGUE_RAIO = 26;
/** Giro total da espada na queda, em radianos (~75°). O giro pixelado é desejado. */
const ESPADA_GIRO = (75 * Math.PI) / 180;

/* --- transparência das paredes do canto frontal ---
 * As três tiles à frente do jogador ((p.x+1,p.y), (p.x,p.y+1), (p.x+1,p.y+1))
 * são desenhadas DEPOIS dele no passe das paredes e o cobrem. A parede que
 * encobre o herói fica translúcida — nunca invisível: abaixo de ~0,3 o bloco
 * some contra o fundo escuro e o buraco lê como erro de desenho. */
const ALFA_PAREDE_OCULTA = 0.35;

/**
 * `prefers-reduced-motion`, consultado no instante do gatilho (a preferência
 * pode mudar com a página aberta). jsdom-safe: sem `matchMedia`, degrada para
 * "sem restrição" — que é o comportamento de sempre.
 */
function prefereReduzirMovimento(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * O bestiário (docs/BESTIARIO.md §0.1, §1.1 e §7) — O PONTO DE EXTENSÃO
 * ------------------------------------------------------------------ */

/**
 * Opções da forja do Goblin. Mesma constante de módulo, pelos mesmos dois
 * motivos do Guerreiro (o forge memoiza por (modelo, opções); a cor é
 * propriedade do personagem).
 *
 * `emissivas` é o que o Guerreiro não tem: `olhoBrasa` ignora a modulação de luz
 * e sai sempre em brilho pleno (§1.1). Quem faz esse trabalho é o forge — ele
 * extrai a camada emissiva UMA vez, na forja, e `quadroModulado()` a recola por
 * cima do quadro escurecido. Este arquivo não conhece um único pixel disso.
 *
 * `arcoGolpe` é o segundo: o goblin apoia a cimitarra DEITADA sobre o ombro, e
 * nesse arranjo o sinal do arco genérico de §6 se inverte — aplicado cru, ele
 * erguia a arma e parava, sem impacto nenhum. O arco descendente vem do próprio
 * personagem (`ARCO_GOLPE_GOBLIN`), como vem a paleta e a pose de repouso.
 */
const FORJA_GOBLIN: OpcoesForja = {
  paleta: PALETA_GOBLIN,
  rampas: RAMPAS_GOBLIN,
  rampaDaCor: RAMPA_DA_COR_GOBLIN,
  repouso: POSE_PARADA_GOBLIN,
  emissivas: CORES_EMISSIVAS_GOBLIN,
  arcoGolpe: ARCO_GOLPE_GOBLIN
};

/**
 * Opções da forja do Slime (§11 do BESTIARIO). Mesma forma da do Goblin — este
 * arquivo continua sem saber o que é uma antena ou um olho em `+`.
 *
 * Duas coisas do rig do Slime que valem a linha, porque quem ler só esta
 * constante não as veria:
 *
 * - `emissivas: CORES_EMISSIVAS_SLIME` é `['luzAmbar']`, e ela pinta os olhos
 *   (S4) E a bolinha da antena (S5) — as duas peças que a §11.1 nomeia como a
 *   leitura à distância do bicho. É o mesmo mecanismo dos olhos do Goblin, com
 *   um pixel a mais em jogo: no escuro o slime vira dois `+` âmbar e um ponto
 *   flutuante acima deles;
 * - `arcoGolpe: ARCO_GOLPE_SLIME` NÃO move um braço, porque o slime não tem
 *   braço nenhum: o rig pendura a antena num nó chamado `bracoDir` de propósito
 *   (leia `NOS_SLIME` em `./characters/slime` antes de renomear qualquer coisa
 *   lá), e é por esse canal que o chicote da antena no bote entra. Renomear o nó
 *   sem ler aquele bloco quebra o chicote EM SILÊNCIO — o forge não reclama de
 *   nome de nó que não existe.
 */
const FORJA_SLIME: OpcoesForja = {
  paleta: PALETA_SLIME,
  rampas: RAMPAS_SLIME,
  rampaDaCor: RAMPA_DA_COR_SLIME,
  repouso: POSE_PARADA_SLIME,
  emissivas: CORES_EMISSIVAS_SLIME,
  arcoGolpe: ARCO_GOLPE_SLIME
};

/**
 * Opções da forja do Ogro (§12 do BESTIARIO). Idem, com uma diferença que é
 * decisão do personagem e não omissão desta constante:
 *
 * `CORES_EMISSIVAS_OGRO` é a lista VAZIA — a §12.2 não declara cor emissiva e
 * inventar uma reprovaria o gate G5. O forge trata vazio como ausente (nenhuma
 * camada extra é alocada e `quadroModulado()` cai no tingimento simples), então
 * passar a constante aqui custa zero e evita um `if` por personagem numa tabela
 * que existe justamente para não ter nenhum. No escuro o Ogro não acende: ele é
 * grande demais para caber no tile, e é ASSIM que se lê ogro a três tiles (G9).
 *
 * `arcoGolpe: ARCO_GOLPE_OGRO` é o ARREMESSO da §10 — a marreta fica apoiada na
 * mão esquerda e quem trabalha nos 3 quadros de `atacando` é o braço direito. O
 * arco genérico de §6 desferiria uma martelada que o `sentinel`, que ataca a 6
 * tiles, nunca poderia estar dando.
 */
const FORJA_OGRO: OpcoesForja = {
  paleta: PALETA_OGRO,
  rampas: RAMPAS_OGRO,
  rampaDaCor: RAMPA_DA_COR_OGRO,
  repouso: POSE_PARADA_OGRO,
  emissivas: CORES_EMISSIVAS_OGRO,
  arcoGolpe: ARCO_GOLPE_OGRO
};

/** O rig e o material de um monstro — tudo o que a forja precisa saber dele. */
interface FichaDeSprite {
  modelo: No;
  forja: OpcoesForja;
}

/**
 * ══ PONTO DE EXTENSÃO: como um monstro ganha rosto ══
 *
 * Arquétipo → ficha do personagem. Quem tem ficha é desenhado com um quadro do
 * atlas (`desenharSpriteInimigo`); quem NÃO tem cai no desenho geométrico
 * (`desenharInimigoGeometrico`). Os dois caminhos convivem de propósito — é a
 * §7.3 do BESTIARIO, e foi por aqui que os monstros 2 e 3 entraram:
 *
 *   1. escreva `./characters/<bicho>.ts` no molde de `./characters/goblin.ts`
 *      (modelo, paleta, rampas, rampa-da-cor, pose de repouso e — se ele tiver
 *      parte que brilha no escuro — a lista de cores emissivas);
 *   2. declare a constante `FORJA_<BICHO>` ao lado de `FORJA_GOBLIN`;
 *   3. acrescente UMA linha nesta tabela.
 *
 * Nada mais neste arquivo muda: a orientação (§0.2), a modulação por luz (§1), a
 * sombra elíptica, a barra de vida e o clarão de dano já são genéricos. Foi o
 * que o Slime e o Ogro comprovaram — os dois entraram com três edições deste
 * arquivo (dois imports, duas constantes, duas linhas aqui) e ZERO mudança em
 * `drawEnemy`, em `desenharSpriteInimigo`, em `quadroDoInimigo` ou na âncora.
 *
 * A tabela agora está COMPLETA: os três arquétipos do jogo têm rosto, e o
 * caminho geométrico deixou de ser o normal de dois deles para ser só a rede de
 * segurança de quem não conseguiu forjar (jsdom, sem contexto 2D). Ele continua
 * vivo e testado por isso — não é código morto, e apagá-lo tiraria os inimigos
 * da tela em qualquer ambiente sem Canvas.
 *
 * O que NÃO se faz por aqui: arquétipo novo. A tabela é indexada por
 * `ArchetypeKey`, e essa união vem do engine — acrescentar um bicho de
 * COMPORTAMENTO novo é mudança de `populate()` e regeneração deliberada do
 * oracle (§0.1 do BESTIARIO), não é sprite. Um quarto MONSTRO, por outro lado,
 * não cabe aqui de jeito nenhum: as três linhas abaixo esgotam `ArchetypeKey`, e
 * é isso que a §10 chama de encaixe forçado do Ogro — resolver isso é a fase de
 * balanceamento, com o oracle regenerado de propósito.
 */
const RETRATOS: Readonly<Partial<Record<ArchetypeKey, FichaDeSprite>>> = {
  /** §7.2 — o Goblin é a APARÊNCIA do `chaser` que já existe. */
  chaser: { modelo: MODELO_GOBLIN, forja: FORJA_GOBLIN },
  /** §11 — o Slime é a APARÊNCIA do `linker` (encaixe natural, §10). */
  linker: { modelo: MODELO_SLIME, forja: FORJA_SLIME },
  /** §12 — o Ogro é a APARÊNCIA do `sentinel` (encaixe forçado e assumido, §10). */
  sentinel: { modelo: MODELO_OGRO, forja: FORJA_OGRO }
};

/**
 * §6 — a troca de tile leva ~120 ms NA TELA. O estado lógico já mudou antes do
 * primeiro quadro desta interpolação: o turno não espera animação (R54).
 */
const DUR_PASSO = 0.12;

/** §6 — duração total dos 3 quadros do golpe. */
const DUR_ATAQUE = 0.24;

/** §6 — respiração lenta: um quadro de `parado` a cada 0,9 s. */
const DUR_RESPIRO = 0.9;

/** Folga em px de arte entre o topo do quadro e a barra de vida do jogador. */
const FOLGA_BARRA = 6;

/**
 * Altura da barra de vida sobre o desenho GEOMÉTRICO de um inimigo, em px de
 * tela a zoom 1 — o número do vanilla, preservado intacto. Quem tem sprite
 * deriva a sua do atlas (`ancoraY − FOLGA_BARRA`), como o jogador.
 */
const TOPO_BARRA_INIMIGO = 33;

/**
 * Estado de animação do jogador (§6). TUDO aqui é derivado por observação do
 * `Game` — nenhum canal novo foi aberto no engine além do `facing`.
 */
interface AnimJogador {
  /** Tile em que o sprite acredita estar (espelho do estado, não fonte). */
  x: number;
  y: number;
  /** Deslocamento iso corrente, em px de mundo (antes do zoom). */
  ox: number;
  oy: number;
  /** Deslocamento no INÍCIO do passo atual — a interpolação é linear sobre ele. */
  origemX: number;
  origemY: number;
  /** Segundos restantes do deslize entre tiles. */
  passo: number;
  /** 0/1 — qual metade do ciclo de marcha o próximo passo usa (perna alternada). */
  pe: number;
  /** Segundos restantes do golpe. */
  ataque: number;
  /** Relógio da respiração, em segundos (sempre dentro de um ciclo). */
  respiro: number;
  /** `stats.dmgDealt` observado: crescer significa "o jogador acertou alguém". */
  dano: number;
  /** Falso enquanto a animação não foi sincronizada com a partida atual. */
  pronta: boolean;
}

/** Cria um canvas de trabalho. Sem DOM devolve `null` — nada aqui lança. */
function novoCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

/** `getContext('2d')` tolerante: jsdom devolve null e pode até lançar. */
function contexto2d(cv: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!cv || typeof cv.getContext !== 'function') return null;
  try {
    return cv.getContext('2d');
  } catch {
    return null;
  }
}

/**
 * Conjunto vazio compartilhado — constante, nunca mutado. Serve de fallback
 * quando `game.visible` ainda não existe; não é estado (não guarda nada).
 */
const EMPTY_SET: ReadonlySet<number> = new Set<number>();

/** Câmera puramente visual. `t*` são os alvos; os demais, os valores suavizados. */
export interface Cam {
  x: number;
  y: number;
  zoom: number;
  tx: number;
  ty: number;
  tzoom: number;
}

/** Estado de animação de uma entidade (deslize, clarão de dano, pulo). */
interface Vfx {
  x: number;
  y: number;
  ox: number;
  oy: number;
  hp: number;
  flash: number;
  bump: number;
  /**
   * §0.2 do BESTIARIO — a direção do olhar, 0..7 na ordem de `DIRS8`.
   *
   * Mora AQUI, e não em `Enemy`, porque dá para derivá-la de graça: o renderer
   * já guarda o tile anterior de cada entidade neste mesmo objeto, e comparar
   * `v.x/v.y` com `e.x/e.y` é toda a informação necessária (ver
   * `orientarInimigo`). Um campo em `Enemy` entraria em `snapshot()`, no save e
   * no oracle para não dizer nada que o render não saiba sozinho.
   */
  facing: number;
  /** Segundos restantes do deslize entre tiles — alimenta o ciclo de marcha. */
  passo: number;
  /** 0/1 — qual metade do ciclo de 4 quadros o próximo passo usa. */
  pe: number;
}

/* ------------------------------------------------------------------ *
 * Geometria de desenho (puras, sem estado)
 * ------------------------------------------------------------------ */

function pathDiamond(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number
): void {
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.lineTo(sx, sy + hh + hh);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.closePath();
}

function fillEllipse(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string
): void {
  if (rx <= 0 || ry <= 0) return;
  ctx.fillStyle = color;
  if (typeof ctx.ellipse === 'function') {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function fillCircle(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string
): void {
  if (r <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

function pathChaserBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 25 * z);
  ctx.lineTo(cx + 11 * z, cy + 1 * z);
  ctx.lineTo(cx, cy - 5 * z);
  ctx.lineTo(cx - 11 * z, cy + 1 * z);
  ctx.closePath();
}

function pathSentinelBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
  const my = cy - 13 * z;
  ctx.beginPath();
  ctx.moveTo(cx - 12 * z, my);
  ctx.lineTo(cx - 6 * z, my - 8 * z);
  ctx.lineTo(cx + 6 * z, my - 8 * z);
  ctx.lineTo(cx + 12 * z, my);
  ctx.lineTo(cx + 6 * z, my + 8 * z);
  ctx.lineTo(cx - 6 * z, my + 8 * z);
  ctx.closePath();
}

function pathLinkerBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 27 * z);
  ctx.lineTo(cx + 11 * z, cy - 13 * z);
  ctx.lineTo(cx, cy + 1 * z);
  ctx.lineTo(cx - 11 * z, cy - 13 * z);
  ctx.closePath();
}

function pathPlayerBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 27 * z);
  ctx.lineTo(cx + 10 * z, cy - 4 * z);
  ctx.lineTo(cx, cy + 3 * z);
  ctx.lineTo(cx - 10 * z, cy - 4 * z);
  ctx.closePath();
}

function hopOf(v: Vfx, extra: number): number {
  let b = v.bump;
  if (typeof extra === 'number' && extra > b) b = extra;
  if (b <= 0) return 0;
  return Math.sin(b * Math.PI);
}

/* ------------------------------------------------------------------ *
 * A classe
 * ------------------------------------------------------------------ */

export class IsoRenderer {
  /** O zoom por roda é ligado aqui; a camada de input não precisa repetir. */
  readonly handlesWheel = true;

  /** FPS suavizado, derivado só do `dt` do laço de animação (R51). */
  fps = 0;

  /* --- constantes de projeção (§2/§8 do contrato) --- */
  private readonly TW: number;
  private readonly TH: number;
  private readonly HW0: number;
  private readonly HH0: number;
  private readonly WALL_H: number;
  private readonly FOV_R: number;
  private readonly ZMIN: number;
  private readonly ZMAX: number;
  private readonly T_WALL: number;
  private readonly T_DOOR: number;
  private readonly T_STAIRS: number;

  /* --- estado da instância (nada disso é de módulo) --- */
  private readonly luts: Luts;
  private readonly camState: Cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1 };
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private vw = 960;
  private vh = 600;
  /**
   * Último `devicePixelRatio` aplicado. Público só por paridade com o `S.dpr`
   * do vanilla, que também era apenas escrito — nada no jogo o consome.
   */
  dpr = 1;
  /** Relógio puramente visual (só animação). */
  private t = 0;
  private fpsAvg = 0;
  private lastMap: GameMap | null = null;
  private entAt: Int32Array | null = null;
  private itemAt: Int32Array | null = null;
  private vfx = new Map<string, Vfx>();
  private wheelBound = false;
  private disposed = false;

  /* --- o Guerreiro (§6, §7 e §9 do docs/PERSONAGEM.md) --- */
  /** Atlas de 72 quadros, forjado sob demanda no primeiro desenho do jogador. */
  private atlas: AtlasPersonagem | null = null;
  /** A forja é tentada UMA vez por instância; falhar não pode virar retentativa por quadro. */
  private atlasTentado = false;

  /* --- o bestiário (docs/BESTIARIO.md §7) --- */
  /**
   * Atlas por arquétipo, forjado sob demanda no primeiro desenho daquele bicho.
   * O `null` GUARDADO é significativo: distingue "já tentei e não deu" (jsdom,
   * sem contexto 2D) de "ainda não tentei", e é o que impede a forja de virar
   * retentativa por quadro. Arquétipo sem ficha em `RETRATOS` guarda `null` na
   * primeira consulta e nunca mais é perguntado.
   */
  private readonly atlasInimigo = new Map<ArchetypeKey, AtlasPersonagem | null>();
  /** Último `game.turn` em que as regras de §0.2 rodaram (−1 = nenhum ainda). */
  private turnoOrientado = -1;
  /** Buffer de tingimento do clarão de dano (o sprite não é um caminho, não dá para preencher). */
  private tinta: HTMLCanvasElement | null = null;
  private tintaCtx: CanvasRenderingContext2D | null = null;
  private readonly anim: AnimJogador = {
    x: 0, y: 0, ox: 0, oy: 0, origemX: 0, origemY: 0,
    passo: 0, pe: 0, ataque: 0, respiro: 0, dano: 0, pronta: false
  };

  /* --- as cinemáticas do guerreiro (ver o bloco de constantes acima) --- */
  /**
   * A máquina: fase + relógio próprio (soma de `dt`), no padrão de `anim`.
   * Avançada em `update` e lida em `draw`/`drawPlayer`. Nada aqui toca o Game.
   */
  private readonly cin: { fase: FaseCinematica; t: number } = { fase: 'nenhuma', t: 0 };
  /**
   * Última `game.depth` observada (−1 = nenhuma ainda). O gatilho da intro é
   * "turn 0 OU depth maior que a observada" — a primeira observação com turn >
   * 0 é a retomada de save, e ela NÃO toca intro.
   */
  private ultimaDepth = -1;
  /** Último `game.over` observado — a morte dispara na borda de subida. */
  private ultimoOver = false;
  /**
   * Atlases secundários da morte (ajoelhado/caído/espada), memoizados sob
   * demanda no padrão de `atlasInimigo`: `undefined` = nunca tentado, `null`
   * guardado = já tentou e não há canvas (jsdom) — nunca retenta por quadro.
   */
  private readonly atlasMorte = new Map<string, AtlasPersonagem | null>();

  /**
   * Alpha corrente das paredes do canto frontal do jogador (índice de tile →
   * 0,35..1). O alvo é `ALFA_PAREDE_OCULTA` para as três tiles à frente dele
   * que são parede e 1 para todas as demais; o valor desliza em `update` e é
   * lido no passe das paredes em `draw`. Entradas de volta a ~1 saem do mapa.
   */
  private readonly alfaParedes = new Map<number, number>();

  /* --- temporários (evitam alocação por frame) --- */
  private isoXTmp = 0;
  private isoYTmp = 0;

  constructor(canvas: HTMLCanvasElement | null) {
    const C = CONFIG;
    this.TW = C.TW;
    this.TH = C.TH;
    this.HW0 = C.TW / 2;
    this.HH0 = C.TH / 2;
    this.WALL_H = C.WALL_H;
    this.FOV_R = C.FOV_RADIUS;
    this.ZMIN = C.ZOOM_MIN;
    this.ZMAX = C.ZOOM_MAX;
    this.T_WALL = C.TILE.WALL;
    this.T_DOOR = C.TILE.DOOR;
    this.T_STAIRS = C.TILE.STAIRS;
    this.luts = buildLuts(this.FOV_R);

    if (!canvas || typeof canvas.getContext !== 'function') return;
    this.canvas = canvas;
    // jsdom devolve null (e pode até lançar) — degradar em silêncio é requisito.
    try {
      this.ctx = canvas.getContext('2d');
    } catch {
      this.ctx = null;
    }
    this.resize();
    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.wheelBound = true;
    }
  }

  /** A câmera é lida E escrita de fora (centralizar ao trocar de nível). */
  get cam(): Cam {
    return this.camState;
  }

  /* ------------------------------------------------------------------ *
   * Zoom por roda (o vanilla também era dono deste listener)
   * ------------------------------------------------------------------ */
  private readonly onWheel = (ev: WheelEvent): void => {
    if (!ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    const d = ev.deltaY;
    if (typeof d !== 'number' || d === 0) return;
    this.setZoom(this.camState.tzoom * (d > 0 ? 0.88 : 1 / 0.88));
  };

  /* ------------------------------------------------------------------ *
   * resize — respeita devicePixelRatio e o tamanho do container
   * ------------------------------------------------------------------ */
  resize(): void {
    const cv = this.canvas;
    if (!cv) return;
    let dpr = 1;
    if (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') {
      dpr = window.devicePixelRatio;
    }
    if (!(dpr > 0)) dpr = 1;
    if (dpr > 3) dpr = 3;

    let w = 0;
    let h = 0;
    const host = cv.parentNode as HTMLElement | null;
    if (host) {
      if (typeof host.clientWidth === 'number') w = host.clientWidth;
      if (typeof host.clientHeight === 'number') h = host.clientHeight;
    }
    if ((!w || !h) && typeof cv.getBoundingClientRect === 'function') {
      const r = cv.getBoundingClientRect();
      if (r) {
        if (!w && r.width) w = Math.round(r.width);
        if (!h && r.height) h = Math.round(r.height);
      }
    }
    if (!w) w = 960;
    if (!h) h = 600;

    this.vw = w;
    this.vh = h;
    this.dpr = dpr;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    if (cv.style) {
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }
    const ctx = this.ctx;
    if (ctx && typeof ctx.setTransform === 'function') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* ------------------------------------------------------------------ *
   * Projeção e inversa (§8)
   *   isoX = (x - y) * TW/2          screenX = (isoX - cam.x) * zoom + vw/2
   *   isoY = (x + y) * TH/2          screenY = (isoY - cam.y) * zoom + vh/2
   * tileToScreen devolve o canto NORTE do losango (a projeção literal do
   * contrato); screenToTile é a inversa exata dela — o round-trip de um canto
   * volta ao mesmo tile e o centro do losango cai no tile certo.
   * O primeiro parâmetro (`game`) existe só por paridade com a assinatura do
   * vanilla; a projeção não depende do estado do jogo.
   * ------------------------------------------------------------------ */
  tileToScreen(_game: Game | null, x: number, y: number): { sx: number; sy: number } {
    const cam = this.camState;
    const isoX = (x - y) * this.HW0;
    const isoY = (x + y) * this.HH0;
    return {
      sx: (isoX - cam.x) * cam.zoom + this.vw / 2,
      sy: (isoY - cam.y) * cam.zoom + this.vh / 2
    };
  }

  screenToTile(_game: Game | null, sx: number, sy: number): { x: number; y: number } {
    const cam = this.camState;
    const isoX = (sx - this.vw / 2) / cam.zoom + cam.x;
    const isoY = (sy - this.vh / 2) / cam.zoom + cam.y;
    const fx = isoX / this.TW + isoY / this.TH;
    const fy = isoY / this.TH - isoX / this.TW;
    return { x: Math.floor(fx), y: Math.floor(fy) };
  }

  setZoom(z: number): void {
    if (typeof z !== 'number' || !isFinite(z)) return;
    let v = z;
    if (v < this.ZMIN) v = this.ZMIN;
    if (v > this.ZMAX) v = this.ZMAX;
    this.camState.tzoom = v;
  }

  /* ------------------------------------------------------------------ *
   * update — SOMENTE animação (R54)
   * ------------------------------------------------------------------ */
  update(game: Game | null, dt: number): void {
    if (this.disposed) return;
    let d = dt;
    if (typeof d !== 'number' || !isFinite(d) || d < 0) d = 0;
    if (d > 0.1) d = 0.1;
    this.t += d;
    if (d > 0) {
      const inst = 1 / d;
      let k = d * 4;
      if (k > 1) k = 1;
      this.fpsAvg += (inst - this.fpsAvg) * k;
      this.fps = Math.round(this.fpsAvg);
    }
    if (!game || !game.map || !game.player) return;
    this.syncRun(game);

    // Cinemática de morte: dispara na BORDA de subida de `game.over` (o turno
    // que matou já está resolvido — isto só ilustra, R54). Observação pura.
    const over = !!game.over;
    if (over && !this.ultimoOver) this.iniciarMorte();
    this.ultimoOver = over;
    this.avancarCinematica(d);

    const cam = this.camState;
    const p = game.player;
    if (!game.ui || game.ui.follow !== false) {
      this.isoCenter(p.x, p.y);
      cam.tx = this.isoXTmp;
      cam.ty = this.isoYTmp;
    }

    const kc = 1 - Math.pow(0.001, d);
    cam.x += (cam.tx - cam.x) * kc;
    cam.y += (cam.ty - cam.y) * kc;
    if (Math.abs(cam.tx - cam.x) < 0.02) cam.x = cam.tx;
    if (Math.abs(cam.ty - cam.y) < 0.02) cam.y = cam.ty;

    const kz = 1 - Math.pow(0.0008, d);
    cam.zoom += (cam.tzoom - cam.zoom) * kz;
    if (Math.abs(cam.tzoom - cam.zoom) < 0.0015) cam.zoom = cam.tzoom;

    const decay = Math.pow(0.0006, d);
    this.trackVfx(this.vfxOf('p', p.x, p.y, p.hp), p.x, p.y, p.hp, d, decay);
    // §6 — a máquina de animação do Guerreiro. Só lê o estado; nunca o escreve.
    this.animarJogador(game, d);

    const en = game.enemies;
    if (en) {
      // §0.2 — as regras de orientação falam em TURNO ("mudou de tile neste
      // turno"), não em quadro. `game.turn` é a única leitura nova, e é leitura:
      // sem ela a regra (b) reavaliaria a cada quadro e sobrescreveria a (a) no
      // quadro seguinte ao passo, invertendo a precedência que o contrato fixa.
      const turno = typeof game.turn === 'number' ? game.turn : 0;
      const novoTurno = turno !== this.turnoOrientado;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (!e) continue;
        const v = this.vfxOf('e' + e.id, e.x, e.y, e.hp);
        // ANTES do trackVfx: é ele que sincroniza `v.x/v.y` com o tile novo, e a
        // regra (a) precisa justamente do delta entre os dois.
        if (novoTurno) this.orientarInimigo(v, e, p);
        this.trackVfx(v, e.x, e.y, e.hp, d, decay);
        // ent.bump é campo puramente visual do contrato: só decai aqui
        if (typeof e.bump === 'number' && e.bump > 0) {
          e.bump -= d * 3.4;
          if (e.bump < 0) e.bump = 0;
        }
      }
      this.turnoOrientado = turno;
    }

    /*
     * Paredes do canto frontal: desliza o alpha para o alvo. As três tiles à
     * frente do jogador que são parede miram ALFA_PAREDE_OCULTA; as demais
     * voltam a 1 e saem do mapa. Cosmético — não lê nada além de posição/tiles.
     */
    const mapaAlfa = this.alfaParedes;
    const mw = game.map.w;
    const mh = game.map.h;
    const mt = game.map.tiles;
    const ocultam: number[] = [];
    if (p.x + 1 < mw && mt[p.y * mw + p.x + 1] === this.T_WALL) {
      ocultam.push(p.y * mw + p.x + 1);
    }
    if (p.y + 1 < mh && mt[(p.y + 1) * mw + p.x] === this.T_WALL) {
      ocultam.push((p.y + 1) * mw + p.x);
    }
    if (p.x + 1 < mw && p.y + 1 < mh && mt[(p.y + 1) * mw + p.x + 1] === this.T_WALL) {
      ocultam.push((p.y + 1) * mw + p.x + 1);
    }
    const ka = Math.min(1, d * 9);
    for (let j = 0; j < ocultam.length; j++) {
      const ti = ocultam[j];
      const a = mapaAlfa.has(ti) ? (mapaAlfa.get(ti) as number) : 1;
      mapaAlfa.set(ti, a + (ALFA_PAREDE_OCULTA - a) * ka);
    }
    for (const [ti, a] of mapaAlfa) {
      if (ocultam.indexOf(ti) >= 0) continue;
      const na = a + (1 - a) * ka;
      if (na > 0.995) mapaAlfa.delete(ti);
      else mapaAlfa.set(ti, na);
    }
  }

  /**
   * §0.2 do docs/BESTIARIO.md — de onde sai o `facing` do inimigo, na ordem
   * exata que o contrato fixa:
   *
   *   (a) mudou de tile neste turno  → índice do delta em `DIRS8`;
   *   (b) não mudou, mas está adjacente ao jogador (Chebyshev 1) → encara-o;
   *   (c) nenhum dos dois            → mantém o último;
   *   (d) entidade nunca vista antes → sul (`DEFAULT_FACING`, em `vfxOf`).
   *
   * Tudo derivado por OBSERVAÇÃO, na camada de apresentação: o parâmetro `e` é
   * lido e nunca escrito, e `Enemy` continua com os mesmos 12 campos de sempre.
   *
   * `Math.sign` no delta é o que segura o caso raro de dois turnos caberem entre
   * dois quadros (teclado em repetição rápida): o deslocamento vira 2 tiles,
   * `dirIndex` de `(2,0)` devolveria −1 e o bicho ficaria olhando para o lugar
   * errado. Normalizado pelo sinal, qualquer salto vira uma das oito direções.
   */
  private orientarInimigo(v: Vfx, e: Enemy, p: Player | null): void {
    const dx = Math.sign(e.x - v.x);
    const dy = Math.sign(e.y - v.y);
    if (dx !== 0 || dy !== 0) {
      const i = dirIndex(dx, dy);
      if (i >= 0) v.facing = i; // (a)
      return;
    }
    if (p && cheb(e.x, e.y, p.x, p.y) === 1) {
      const i = dirIndex(Math.sign(p.x - e.x), Math.sign(p.y - e.y));
      if (i >= 0) v.facing = i; // (b)
    }
    // (c) — silêncio de propósito: `v.facing` já é o último conhecido.
  }

  /* ------------------------------------------------------------------ *
   * draw
   * ------------------------------------------------------------------ */
  draw(game: Game | null): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (!game || !game.map || !game.player) return;

    this.syncRun(game);
    this.indexEntities(game);

    const luts = this.luts;
    const cam = this.camState;
    const map = game.map;
    const w = map.w;
    const h = map.h;
    const tiles = map.tiles;
    const decor = map.decor || null;
    const vis: ReadonlySet<number> =
      game.visible && typeof game.visible.has === 'function' ? game.visible : EMPTY_SET;
    const expl = game.explored || null;
    const p = game.player;

    const z = cam.zoom;
    const hw = this.HW0 * z;
    const hh = this.HH0 * z;
    const wh = this.WALL_H * z;
    const ox = this.vw / 2 - cam.x * z;
    const oy = this.vh / 2 - cam.y * z;
    const sMax = w - 1 + (h - 1);
    const padX = this.TW * z + 8;
    const lightMax = luts.LIGHT_LEVEL.length;

    for (let s = 0; s <= sMax; s++) {
      const sy = s * hh + oy;
      if (sy + hh + hh < -48 * z || sy - wh - 48 * z > this.vh) continue;

      let lo = s - (h - 1);
      if (lo < 0) lo = 0;
      let hi = s;
      if (hi > w - 1) hi = w - 1;

      // recorte horizontal: sx = hw*(2x - s) + ox
      const xa = Math.floor((s + (-padX - ox) / hw) / 2) - 1;
      const xb = Math.ceil((s + (this.vw + padX - ox) / hw) / 2) + 1;
      if (xa > lo) lo = xa;
      if (xb < hi) hi = xb;
      if (lo > hi) continue;

      let x: number;
      let y: number;
      let i: number;
      let t: number;
      let sx: number;
      let seen: boolean;
      let known: boolean;
      let lvl: number;
      let dx: number;
      let dy: number;
      let d2: number;
      let bucket: number;
      let alt: number;

      /* --- pisos da antidiagonal --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        t = tiles[i];
        if (t === this.T_WALL) continue;
        seen = vis.has(i);
        known = seen || (expl ? expl[i] !== 0 : false);
        if (!known) continue; // nunca visto: nada é desenhado (R29)
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x;
        dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = seen ? (d2 < lightMax ? luts.LIGHT_LEVEL[d2] : 0) : 0;
        bucket = decor ? decor[i] & 7 : 0;
        alt = ((x >> 2) + (y >> 2)) & 1;
        this.drawFloor(ctx, sx, sy, hw, hh, bucket, alt, seen, lvl);
        if (x > 0 && y > 0 && tiles[i - w - 1] === this.T_WALL) {
          this.drawWallShadow(ctx, sx, sy, hw, hh, seen);
        }
        if (t === this.T_STAIRS) this.drawStairs(ctx, sx, sy, hw, hh, seen, lvl);
        else if (t === this.T_DOOR) this.drawDoor(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
      }

      /* --- paredes da antidiagonal (translúcidas quando encobrem o herói) --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        if (tiles[i] !== this.T_WALL) continue;
        seen = vis.has(i);
        known = seen || (expl ? expl[i] !== 0 : false);
        if (!known) continue;
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x;
        dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = seen ? (d2 < lightMax ? luts.LIGHT_LEVEL[d2] : 0) : 0;
        bucket = decor ? decor[i] & 7 : 0;
        const wa = this.alfaParedes.get(i);
        if (wa !== undefined && wa < 0.995) {
          ctx.save();
          ctx.globalAlpha = wa;
          this.drawWall(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
          ctx.restore();
        } else {
          this.drawWall(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
        }
      }

      /* --- entidades da antidiagonal (só dentro do FOV — R31) --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        const isPlayer = p.x === x && p.y === y;
        seen = vis.has(i);
        if (!seen && !isPlayer) continue;
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x;
        dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = d2 < lightMax ? luts.LIGHT_LEVEL[d2] : 0;
        const cy = sy + hh;
        if (seen && this.itemAt) {
          const ii = this.itemAt[i];
          if (ii >= 0) this.drawPotion(ctx, game.items[ii], sx, cy, z, lvl, ii);
        }
        if (seen && this.entAt) {
          const ei = this.entAt[i];
          if (ei >= 0) this.drawEnemy(ctx, game.enemies[ei], sx, cy, z, lvl, p);
        }
        if (isPlayer) this.drawPlayer(ctx, p, sx, cy, z);
      }
    }

    this.drawHover(ctx, game, hw, hh, ox, oy);
    if (game.ui && game.ui.debug) this.drawDebugLayer(ctx, game, hw, hh, ox, oy);
    if (game.ui && game.ui.fovProbe) this.drawFovProbe(ctx, game, hw, hh, ox, oy);

    /*
     * Cinemática de morte — o apagar das luzes, por cima de TUDO (última
     * operação do quadro, alpha 0→0,9 entre MORTE_FADE_INICIO e o fim). Em
     * 'concluida' o véu fica fechado: é sobre ele que o modal da UI abre.
     */
    const cin = this.cin;
    let veu = 0;
    if (cin.fase === 'concluida') veu = 0.9;
    else if (cin.fase === 'morte' && cin.t > MORTE_FADE_INICIO) {
      veu = 0.9 * (cin.t - MORTE_FADE_INICIO) / (DUR_MORTE - MORTE_FADE_INICIO);
      if (veu > 0.9) veu = 0.9;
    }
    if (veu > 0) {
      ctx.save();
      ctx.globalAlpha = veu;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ *
   * dispose — o par obrigatório do constructor.
   * O StrictMode monta e desmonta duas vezes em dev: sem isto, sobra um
   * listener vivo e um segundo loop desenhando por cima do primeiro.
   * ------------------------------------------------------------------ */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const cv = this.canvas;
    if (cv && this.wheelBound && typeof cv.removeEventListener === 'function') {
      cv.removeEventListener('wheel', this.onWheel);
    }
    this.wheelBound = false;
    this.canvas = null;
    this.ctx = null;
    this.lastMap = null;
    this.entAt = null;
    this.itemAt = null;
    this.vfx.clear();
    // O atlas em si é memoizado pelo forge (por modelo): soltamos só a
    // referência desta instância e o buffer de tingimento, que é dela.
    this.atlas = null;
    this.atlasInimigo.clear();
    this.atlasMorte.clear();
    this.tinta = null;
    this.tintaCtx = null;
    this.anim.pronta = false;
    this.cin.fase = 'nenhuma';
    this.cin.t = 0;
    this.ultimaDepth = -1;
    this.ultimoOver = false;
  }

  /* ------------------------------------------------------------------ *
   * Internos — animação e índices
   * ------------------------------------------------------------------ */

  private isoCenter(x: number, y: number): void {
    this.isoXTmp = (x - y) * this.HW0;
    this.isoYTmp = (x + y) * this.HH0 + this.HH0;
  }

  private vfxOf(key: string, x: number, y: number, hp: number): Vfx {
    let v = this.vfx.get(key);
    if (!v) {
      // §0.2 regra (d): entidade nunca vista antes nasce olhando para o sul do
      // grid — o mesmo padrão do jogador (`DEFAULT_FACING`).
      v = {
        x: x, y: y, ox: 0, oy: 0, hp: hp, flash: 0, bump: 0,
        facing: DEFAULT_FACING, passo: 0, pe: 0
      };
      this.vfx.set(key, v);
    }
    return v;
  }

  private trackVfx(v: Vfx, x: number, y: number, hp: number, dt: number, decay: number): void {
    if (v.x !== x || v.y !== y) {
      this.isoCenter(v.x, v.y);
      const ax = this.isoXTmp;
      const ay = this.isoYTmp;
      this.isoCenter(x, y);
      v.ox += ax - this.isoXTmp;
      v.oy += ay - this.isoYTmp;
      v.x = x;
      v.y = y;
      v.bump = 1;
      // Marcha: um tile = meio ciclo, e `pe` alterna a metade — dois passos
      // seguidos percorrem os 4 quadros de §6 na ordem certa. Mesmo mecanismo do
      // jogador (`AnimJogador.passo`/`pe`), aqui por entidade.
      v.passo = DUR_PASSO;
      v.pe = v.pe === 0 ? 1 : 0;
    }
    if (v.passo > 0) {
      v.passo -= dt;
      if (v.passo < 0) v.passo = 0;
    }
    v.ox *= decay;
    v.oy *= decay;
    if (v.ox < 0.05 && v.ox > -0.05) v.ox = 0;
    if (v.oy < 0.05 && v.oy > -0.05) v.oy = 0;
    if (typeof hp === 'number') {
      if (hp < v.hp) v.flash = 1;
      v.hp = hp;
    }
    if (v.flash > 0) {
      v.flash -= dt * 3;
      if (v.flash < 0) v.flash = 0;
    }
    if (v.bump > 0) {
      v.bump -= dt * 3.4;
      if (v.bump < 0) v.bump = 0;
    }
  }

  private syncRun(game: Game): void {
    if (this.lastMap === game.map) return;
    this.lastMap = game.map;
    this.vfx = new Map<string, Vfx>();
    // Índices de tile são por mapa: os alphas das paredes do nível anterior
    // não significam nada no novo.
    this.alfaParedes.clear();
    // Mapa novo = bestiário novo. O relógio de orientação (§0.2) volta a zero
    // para que a primeira leitura do andar já encare o jogador quem estiver
    // colado nele, em vez de esperar o turno seguinte.
    this.turnoOrientado = -1;
    // Mapa novo (nova expedição ou descida): o guerreiro reaparece parado no
    // ponto de partida. Sem isto ele deslizaria do tile do nível anterior e
    // `stats.dmgDealt` (que sobrevive à descida) dispararia um golpe fantasma.
    this.anim.pronta = false;
    const p = game.player;
    if (p) {
      this.isoCenter(p.x, p.y);
      const cam = this.camState;
      cam.x = cam.tx = this.isoXTmp;
      cam.y = cam.ty = this.isoYTmp;
    }

    /*
     * Gatilho da INTRO (descendo as escadas). Mapa novo chega a três mãos:
     *
     *   - expedição nova (`game.turn === 0`) → toca;
     *   - DESCIDA de nível (`game.depth` maior que a última observada) → toca;
     *   - retomada de save (primeira observação, turn > 0) → NÃO toca: o
     *     jogador já estava no andar, a escada não aconteceu na tela.
     *
     * O jogador nasce em `map.start`, que não é escada — o glifo desenhado
     * durante a intro é prop cinematográfico, não o tile real.
     */
    this.cin.fase = 'nenhuma';
    this.cin.t = 0;
    const turn = typeof game.turn === 'number' ? game.turn : 0;
    const depth = typeof game.depth === 'number' ? game.depth : 0;
    const primeiraObservacao = this.ultimaDepth < 0;
    if (turn === 0 || (!primeiraObservacao && depth > this.ultimaDepth)) {
      this.iniciarIntro();
    }
    this.ultimaDepth = depth;
  }

  /* ------------------------------------------------------------------ *
   * A máquina de cinemática do guerreiro (intro e morte)
   *
   * Mesmo padrão de `anim`/`vfx`: campos da instância, avanço por `dt` em
   * `update`, leitura em `draw`/`drawPlayer`. A UI lê a fase por
   * `faseCinematica()` (o laço de rAF a republica no micro-store de
   * `ui/cinematics.ts`, que segura o modal de morte e trava o input).
   * ------------------------------------------------------------------ */

  /** A fase atual — a mesma união que `ui/cinematics.ts` republica. */
  faseCinematica(): FaseCinematica {
    return this.cin.fase;
  }

  /**
   * Leva a cinemática direto ao estado final — `prefers-reduced-motion` (no
   * gatilho) e testes. Intro: some como se nunca houvesse; morte: corpo caído
   * e fade fechado na hora, que é o que libera o modal.
   */
  pularCinematica(): void {
    const cin = this.cin;
    if (cin.fase === 'intro') {
      cin.fase = 'nenhuma';
      cin.t = 0;
    } else if (cin.fase === 'morte') {
      cin.fase = 'concluida';
      cin.t = DUR_MORTE;
    }
  }

  private iniciarIntro(): void {
    this.cin.fase = 'intro';
    this.cin.t = 0;
    if (prefereReduzirMovimento()) this.pularCinematica();
  }

  private iniciarMorte(): void {
    this.cin.fase = 'morte';
    this.cin.t = 0;
    if (prefereReduzirMovimento()) this.pularCinematica();
  }

  /** Avança o relógio e os cortes de fase. Só o tempo decide — nada do Game. */
  private avancarCinematica(d: number): void {
    const cin = this.cin;
    if (cin.fase === 'intro') {
      cin.t += d;
      if (cin.t >= DUR_INTRO) {
        cin.fase = 'nenhuma';
        cin.t = 0;
      }
    } else if (cin.fase === 'morte') {
      cin.t += d;
      if (cin.t >= DUR_MORTE) {
        cin.fase = 'concluida';
        cin.t = DUR_MORTE;
      }
    }
    // 'concluida' é terminal até a próxima partida (syncRun a zera).
  }

  private indexEntities(game: Game): void {
    const map = game.map;
    const n = map.w * map.h;
    let entAt = this.entAt;
    let itemAt = this.itemAt;
    if (!entAt || !itemAt || entAt.length !== n) {
      entAt = new Int32Array(n);
      itemAt = new Int32Array(n);
      this.entAt = entAt;
      this.itemAt = itemAt;
    }
    entAt.fill(-1);
    itemAt.fill(-1);
    let i: number;
    const en = game.enemies;
    if (en) {
      for (let k = 0; k < en.length; k++) {
        const e = en[k];
        if (!e || e.hp <= 0) continue;
        i = e.y * map.w + e.x;
        if (i >= 0 && i < n) entAt[i] = k;
      }
    }
    const it = game.items;
    if (it) {
      for (let k = 0; k < it.length; k++) {
        const o = it[k];
        if (!o) continue;
        i = o.y * map.w + o.x;
        if (i >= 0 && i < n) itemAt[i] = k;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Piso, parede, sombras, escada e porta
   * ------------------------------------------------------------------ */

  private drawFloor(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number,
    bucket: number, alt: number, seen: boolean, lvl: number
  ): void {
    const luts = this.luts;
    ctx.fillStyle = seen ? luts.FLOOR_LIT[alt][bucket][lvl] : luts.FLOOR_DIM[alt][bucket];
    pathDiamond(ctx, sx, sy, hw, hh);
    ctx.fill();
    // aresta 1px mais clara no topo-esquerdo
    ctx.strokeStyle = seen ? COL_EDGE_LIT : COL_EDGE_DIM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy + hh);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  }

  private drawWallShadow(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, seen: boolean
  ): void {
    ctx.fillStyle = seen ? COL_SHADOW_WALL : COL_SHADOW_WALL_DIM;
    pathDiamond(ctx, sx + hw * 0.07, sy + hh * 0.1, hw * 0.86, hh * 0.86);
    ctx.fill();
  }

  private drawWall(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, wh: number,
    bucket: number, seen: boolean, lvl: number
  ): void {
    const luts = this.luts;
    const top = seen ? luts.WALL_LIT[0][bucket][lvl] : luts.WALL_DIM[0][bucket];
    const left = seen ? luts.WALL_LIT[1][bucket][lvl] : luts.WALL_DIM[1][bucket];
    const right = seen ? luts.WALL_LIT[2][bucket][lvl] : luts.WALL_DIM[2][bucket];
    const h2 = hh + hh;

    // face esquerda (~18% mais escura)
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy + hh - wh);
    ctx.lineTo(sx, sy + h2 - wh);
    ctx.lineTo(sx, sy + h2);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.closePath();
    ctx.fill();

    // face direita (~32% mais escura)
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx, sy + h2 - wh);
    ctx.lineTo(sx + hw, sy + hh - wh);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.lineTo(sx, sy + h2);
    ctx.closePath();
    ctx.fill();

    // topo em losango + contorno sutil
    ctx.fillStyle = top;
    pathDiamond(ctx, sx, sy - wh, hw, hh);
    ctx.fill();
    ctx.strokeStyle = seen ? COL_WALL_EDGE_LIT : COL_WALL_EDGE_DIM;
    ctx.lineWidth = 1;
    ctx.stroke();

    // aresta vertical central, dá leitura de volume
    ctx.beginPath();
    ctx.moveTo(sx, sy + h2 - wh);
    ctx.lineTo(sx, sy + h2);
    ctx.stroke();
  }

  private drawStairs(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number,
    seen: boolean, lvl: number
  ): void {
    const luts = this.luts;
    const sh = luts.SHADES.stone;
    for (let k = 1; k <= 3; k++) {
      const f = 1 - k * 0.24;
      const oyk = k * hh * 0.3;
      ctx.fillStyle = seen ? sh.dark[Math.max(0, lvl - k * 2)] : luts.FLOOR_DIM[0][k & 7];
      pathDiamond(ctx, sx, sy + oyk, hw * f, hh * f);
      ctx.fill();
    }
    if (seen) {
      ctx.strokeStyle = luts.SHADES.amber.main[lvl];
      ctx.lineWidth = 1;
      pathDiamond(ctx, sx, sy + hh * 0.9, hw * 0.28, hh * 0.28);
      ctx.stroke();
    }
  }

  private drawDoor(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, wh: number,
    bucket: number, seen: boolean, lvl: number
  ): void {
    const luts = this.luts;
    const post = seen ? luts.WALL_LIT[1][bucket][lvl] : luts.WALL_DIM[1][bucket];
    const lint = seen ? luts.SHADES.amber.dark[lvl] : luts.FLOOR_DIM[1][bucket];
    const ph = wh * 0.6;
    const pw = Math.max(1, hw * 0.1);
    ctx.fillStyle = post;
    ctx.fillRect(sx - hw * 0.72 - pw, sy + hh * 0.72 - ph, pw * 2, ph);
    ctx.fillRect(sx + hw * 0.72 - pw, sy + hh * 0.72 - ph, pw * 2, ph);
    ctx.strokeStyle = lint;
    ctx.lineWidth = Math.max(1, hh * 0.09);
    ctx.beginPath();
    ctx.moveTo(sx - hw * 0.72, sy + hh * 0.72 - ph);
    ctx.lineTo(sx + hw * 0.72, sy + hh * 0.72 - ph);
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ *
   * Entidades — formas geométricas por arquétipo (§8)
   * ------------------------------------------------------------------ */

  private drawHpBar(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, ratio: number
  ): void {
    let r = ratio;
    if (r < 0) r = 0;
    if (r > 1) r = 1;
    const wBar = 22 * z;
    const hBar = Math.max(1, 3 * z);
    ctx.fillStyle = COL_HPBAR_BG;
    ctx.fillRect(cx - wBar / 2, cy, wBar, hBar);
    ctx.fillStyle = this.luts.HP_COL[Math.round(r * (LEVELS - 1))];
    ctx.fillRect(cx - wBar / 2, cy, wBar * r, hBar);
  }

  /*
   * TODO(tempero-goblin): o Goblin já anda e respira com o ciclo GENÉRICO de
   * `./spriteForge` — o mesmo do Guerreiro. O GOLPE já é dele (`arcoGolpe` em
   * `FORJA_GOBLIN`, revisão §8 rodada 1: com o arco genérico a cimitarra subia
   * em vez de descer e o bicho nunca batia). O que continua sem consumidor é o
   * resto de `ANIMACAO_GOBLIN`: respiração 1,4× mais rápida, balanço de 5° nas
   * orelhas, inclinação de 6° ao andar contra 2,5° e quique de 2,0u. Plugá-los
   * abre mais canais em `OpcoesForja`, no mesmo molde do `arcoGolpe` — o forge é
   * agnóstico de personagem por contrato e não pode ganhar um `if (goblin)`. É a
   * fase da animação, e ela mexe em `spriteForge.ts`, não aqui.
   *
   * A dívida que este bloco registrava até a fase passada — "inimigos no atlas",
   * ou seja, modulação do quadro pela luz do tile — está PAGA: ver
   * `desenharSpriteInimigo` e `quadroModulado()`. O marcador saiu com ela; o que
   * sobra acima é dívida NOVA e de outro dono.
   */
  private drawEnemy(
    ctx: CanvasRenderingContext2D, ent: Enemy, sx: number, cyBase: number, z: number,
    lvl: number, player: Player | null
  ): void {
    if (!ent) return;
    const v = this.vfxOf('e' + ent.id, ent.x, ent.y, ent.hp);
    const cx = sx + v.ox * z;
    const cy = cyBase + v.oy * z;

    // §7.4 — a sombra elíptica vem antes de tudo e continua no CHÃO: ela não
    // sobe com o quique nem com o quadro da animação.
    fillEllipse(ctx, cx, cyBase + 2 * z, 11 * z, 4.6 * z, COL_SHADOW_ENT);

    // ══ A BIFURCAÇÃO (§7.3): quem tem ficha em `RETRATOS` vira sprite; quem não
    // tem, continua em forma geométrica. Nenhum dos dois caminhos sabe do outro.
    // Os dois devolvem o Y DE TELA da barra de vida, porque só eles sabem onde
    // termina o desenho que fizeram — o sprite tem a altura do rig, o geométrico
    // tem os 33px do vanilla, e o quique entra só num deles.
    const atlas = this.atlasDoInimigo(ent.kind);
    const barraY = atlas
      ? this.desenharSpriteInimigo(ctx, atlas, ent, v, cx, cy, z, lvl)
      : this.desenharInimigoGeometrico(ctx, ent, v, cx, cy, z, lvl, player);

    if (ent.maxHp > 0 && ent.hp < ent.maxHp) {
      this.drawHpBar(ctx, cx, barraY, z, ent.hp / ent.maxHp);
    }
  }

  /**
   * §7 do BESTIARIO — o atlas de um arquétipo, forjado SOB DEMANDA e uma vez só,
   * no primeiro desenho daquele bicho. Sem ficha em `RETRATOS` (ou sem canvas,
   * em jsdom) devolve `null` e quem chamou cai no desenho geométrico: degradar
   * sem lançar é requisito, não gambiarra.
   */
  private atlasDoInimigo(kind: ArchetypeKey): AtlasPersonagem | null {
    const pronto = this.atlasInimigo.get(kind);
    // `undefined` = nunca perguntado; `null` = já perguntado e não há atlas.
    if (pronto !== undefined) return pronto;
    const ficha = RETRATOS[kind];
    const atlas = ficha ? this.forjarSeguro(ficha.modelo, ficha.forja) : null;
    this.atlasInimigo.set(kind, atlas);
    return atlas;
  }

  /**
   * Estado e quadro de §6 para um inimigo, derivados por OBSERVAÇÃO — nenhum
   * canal novo no engine, nem sequer um relógio por entidade:
   *
   *   - `ent.bump` é acesa pelo engine em UM lugar só, `attackPlayerInterno`
   *     (`src/engine/entities.ts`), e decai aqui no `update()`. Ou seja: `bump`
   *     positivo significa exatamente "este bicho atacou agora" — o gatilho do
   *     estado `atacando`, de graça. (O `bump` de MOVIMENTO é outro campo, o
   *     `v.bump` do `Vfx`, e não confunde os dois.)
   *   - `v.passo` é o deslize entre tiles que o `trackVfx` já mantinha.
   *   - a respiração sai do relógio visual da instância, defasada por `id` para
   *     que dois goblins lado a lado não respirem em uníssono.
   */
  private quadroDoInimigo(ent: Enemy, v: Vfx): { estado: Estado; frame: number } {
    if (typeof ent.bump === 'number' && ent.bump > 0) {
      // bump 1 → 0 percorre os 3 quadros do golpe; o impacto é o quadro 1.
      let f = Math.floor((1 - ent.bump) * 3);
      if (f < 0) f = 0;
      if (f > 2) f = 2;
      return { estado: 'atacando', frame: f };
    }
    if (v.passo > 0) {
      const t = 1 - v.passo / DUR_PASSO;
      return { estado: 'andando', frame: v.pe * 2 + (t < 0.5 ? 0 : 1) };
    }
    const fase = this.t / DUR_RESPIRO + ent.id * 0.37;
    return { estado: 'parado', frame: fase - Math.floor(fase / 2) * 2 < 1 ? 0 : 1 };
  }

  /**
   * §1 e §7.2 do BESTIARIO — o inimigo como quadro do atlas, MODULADO pela luz
   * do tile. Devolve o Y de tela da barra de vida, derivado da âncora do atlas
   * pelo mesmo critério do jogador: um bicho de 13u e outro de 18u não podem
   * pendurar a barra na mesma altura.
   *
   * A modulação inteira é uma linha: `quadroModulado()` cuida de quantizar `lvl`
   * em 8 degraus, do cache por (quadro, degrau) e de recolar a camada emissiva —
   * os olhos em brasa não escurecem (§1.1). Aqui só entra a conversão de
   * unidade: `lvl` é o ÍNDICE inteiro 0..`LEVELS−1` das LUTs deste renderizador
   * e o forge quer fração 0..1. Manter a divisão visível na chamada (e não
   * escondida lá dentro) é o que impede o forge de virar refém do número de
   * níveis de `./palette`.
   *
   * O quadro NÃO recebe o `hop` do desenho geométrico: o quique da marcha e o
   * peso do golpe já estão dentro dos quadros de §6, e somar os dois faria o
   * bicho saltar duas vezes por passo.
   */
  private desenharSpriteInimigo(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem, ent: Enemy, v: Vfx,
    cx: number, cy: number, z: number, lvl: number
  ): number {
    const q = this.quadroDoInimigo(ent, v);
    const f = quadroModulado(atlas, v.facing, q.estado, q.frame, lvl / (LEVELS - 1));
    if (!f.fonte) return cy - TOPO_BARRA_INIMIGO * z;

    const dx = Math.round(cx - atlas.ancoraX * z);
    const dy = Math.round(cy - atlas.ancoraY * z);
    const dw = f.largura * z;
    const dh = f.altura * z;

    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, dw, dh);
    if (v.flash > 0) {
      // §7.4 — o clarão de dano reusa o caminho de `source-atop` do jogador, mas
      // tingindo o quadro JÁ ESCURECIDO: `FLASH_COL` tem alfa < 1, então a cor
      // por baixo importa e um clarão sobre o quadro cru acenderia um inimigo
      // que está no escuro.
      const tinta = this.tingirQuadro(
        f.fonte, f.sx, f.sy, f.largura, f.altura,
        this.luts.FLASH_COL[Math.round(v.flash * (LEVELS - 1))]
      );
      if (tinta) ctx.drawImage(tinta, 0, 0, f.largura, f.altura, dx, dy, dw, dh);
    }
    ctx.imageSmoothingEnabled = suave;
    return cy - (atlas.ancoraY - FOLGA_BARRA) * z;
  }

  /**
   * Os inimigos em formas geométricas — o desenho do vanilla, intacto. É o
   * caminho de `sentinel` e `linker` (§7.3) e também a rede de segurança de
   * qualquer bicho cujo atlas não pôde ser forjado (jsdom, sem contexto 2D).
   * Devolve o Y de tela da barra de vida, como o caminho de sprite — aqui ela
   * acompanha o quique, exatamente como no vanilla.
   */
  private desenharInimigoGeometrico(
    ctx: CanvasRenderingContext2D, ent: Enemy, v: Vfx, cx: number, cyBase: number,
    z: number, lvl: number, player: Player | null
  ): number {
    const luts = this.luts;
    const cy = cyBase - hopOf(v, ent.bump) * 6 * z;
    const sh = luts.SHADES[ent.kind] || luts.SHADES.chaser;
    if (ent.kind === 'sentinel') {
      pathSentinelBody(ctx, cx, cy, z);
      ctx.fillStyle = sh.main[lvl];
      ctx.fill();
      ctx.strokeStyle = sh.dark[lvl];
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.stroke();
      // haste de apoio
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5 * z);
      ctx.lineTo(cx, cy + 1 * z);
      ctx.stroke();
      // olho voltado para o jogador
      const my = cy - 13 * z;
      fillEllipse(ctx, cx, my, 5.2 * z, 3.4 * z, sh.light[lvl]);
      let ex = 0;
      let ey = 0;
      if (player) {
        const ddx = player.x - ent.x;
        const ddy = player.y - ent.y;
        const iso = ddx - ddy;
        const isoy = ddx + ddy;
        const len = Math.sqrt(iso * iso + isoy * isoy);
        if (len > 0) {
          ex = (iso / len) * 2.2 * z;
          ey = (isoy / len) * 1.3 * z;
        }
      }
      fillCircle(ctx, cx + ex, my + ey, 1.7 * z, sh.dark[lvl]);
    } else if (ent.kind === 'linker') {
      pathLinkerBody(ctx, cx, cy, z);
      ctx.fillStyle = sh.main[lvl];
      ctx.fill();
      ctx.strokeStyle = sh.dark[lvl];
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.stroke();
      // losango interno concêntrico
      ctx.beginPath();
      ctx.moveTo(cx, cy - 20 * z);
      ctx.lineTo(cx + 5.5 * z, cy - 13 * z);
      ctx.lineTo(cx, cy - 6 * z);
      ctx.lineTo(cx - 5.5 * z, cy - 13 * z);
      ctx.closePath();
      ctx.fillStyle = sh.light[lvl];
      ctx.fill();
      // marcas de vínculo
      ctx.strokeStyle = sh.light[lvl];
      ctx.lineWidth = Math.max(1, 1 * z);
      ctx.beginPath();
      ctx.moveTo(cx - 14 * z, cy - 13 * z);
      ctx.lineTo(cx - 11 * z, cy - 13 * z);
      ctx.moveTo(cx + 11 * z, cy - 13 * z);
      ctx.lineTo(cx + 14 * z, cy - 13 * z);
      ctx.stroke();
    } else {
      pathChaserBody(ctx, cx, cy, z);
      ctx.fillStyle = sh.main[lvl];
      ctx.fill();
      // faceta esquerda mais escura: volume
      ctx.beginPath();
      ctx.moveTo(cx, cy - 25 * z);
      ctx.lineTo(cx - 11 * z, cy + 1 * z);
      ctx.lineTo(cx, cy - 5 * z);
      ctx.closePath();
      ctx.fillStyle = sh.dark[lvl];
      ctx.fill();
      // olhos
      ctx.fillStyle = sh.light[lvl];
      ctx.fillRect(cx - 5 * z, cy - 16 * z, 3 * z, 1.6 * z);
      ctx.fillRect(cx + 2 * z, cy - 16 * z, 3 * z, 1.6 * z);
    }

    if (v.flash > 0) {
      if (ent.kind === 'sentinel') pathSentinelBody(ctx, cx, cy, z);
      else if (ent.kind === 'linker') pathLinkerBody(ctx, cx, cy, z);
      else pathChaserBody(ctx, cx, cy, z);
      ctx.fillStyle = luts.FLASH_COL[Math.round(v.flash * (LEVELS - 1))];
      ctx.fill();
    }

    return cy - TOPO_BARRA_INIMIGO * z;
  }

  /* ------------------------------------------------------------------ *
   * O Guerreiro — animação (§6), atlas (§7) e desenho (§9)
   *
   * Nada nesta seção escreve no `Game`. A animação é DERIVADA por observação:
   * a mudança de tile do jogador vira deslize, o crescimento de
   * `stats.dmgDealt` vira golpe e `player.facing` escolhe a linha do atlas.
   * ------------------------------------------------------------------ */

  /**
   * Avança a fase da animação com o `dt` do laço de desenho (§6). O turno lógico
   * já aconteceu quando isto roda — a animação só ilustra, jamais atrasa (R54).
   */
  private animarJogador(game: Game, dt: number): void {
    const a = this.anim;
    const p = game.player;
    const dano = game.stats ? game.stats.dmgDealt : a.dano;

    if (!a.pronta) {
      // Primeira leitura (ou partida nova): assenta no lugar, sem deslize e sem
      // golpe herdado do nível anterior.
      a.x = p.x;
      a.y = p.y;
      a.ox = 0;
      a.oy = 0;
      a.origemX = 0;
      a.origemY = 0;
      a.passo = 0;
      a.ataque = 0;
      a.dano = dano;
      a.pronta = true;
    }

    if (a.x !== p.x || a.y !== p.y) {
      // O estado já está no tile novo: o sprite parte do antigo e o alcança em
      // DUR_PASSO. O resíduo de um passo interrompido é somado, nunca descartado.
      this.isoCenter(a.x, a.y);
      const ax = this.isoXTmp;
      const ay = this.isoYTmp;
      this.isoCenter(p.x, p.y);
      a.ox += ax - this.isoXTmp;
      a.oy += ay - this.isoYTmp;
      a.origemX = a.ox;
      a.origemY = a.oy;
      a.x = p.x;
      a.y = p.y;
      a.passo = DUR_PASSO;
      a.pe = a.pe === 0 ? 1 : 0; // alterna a perna: 2 passos = 1 ciclo de 4 quadros
    }

    // Gatilho do golpe: o jogador causou dano neste turno (§6).
    if (dano > a.dano) a.ataque = DUR_ATAQUE;
    a.dano = dano;

    if (a.passo > 0) {
      a.passo -= dt;
      if (a.passo <= 0) {
        a.passo = 0;
        a.ox = 0;
        a.oy = 0;
      } else {
        const k = a.passo / DUR_PASSO;
        a.ox = a.origemX * k;
        a.oy = a.origemY * k;
      }
    }
    if (a.ataque > 0) {
      a.ataque -= dt;
      if (a.ataque < 0) a.ataque = 0;
    }
    // O ciclo de respiração é fechado em si: nada de somar segundos para sempre.
    a.respiro += dt;
    const ciclo = DUR_RESPIRO * 2;
    if (a.respiro >= ciclo) a.respiro -= Math.floor(a.respiro / ciclo) * ciclo;
  }

  /** Estado e quadro de §6 derivados da fase corrente. Puro, sem efeito colateral. */
  private quadroDoJogador(): { estado: Estado; frame: number } {
    const a = this.anim;
    if (a.ataque > 0) {
      const t = 1 - a.ataque / DUR_ATAQUE;
      let f = Math.floor(t * 3);
      if (f < 0) f = 0;
      if (f > 2) f = 2;
      return { estado: 'atacando', frame: f };
    }
    if (a.passo > 0) {
      // Um tile = meio ciclo (dois quadros). `pe` alterna a metade, então dois
      // passos seguidos percorrem os 4 quadros de §6 na ordem certa.
      const t = 1 - a.passo / DUR_PASSO;
      return { estado: 'andando', frame: a.pe * 2 + (t < 0.5 ? 0 : 1) };
    }
    return { estado: 'parado', frame: a.respiro < DUR_RESPIRO ? 0 : 1 };
  }

  /**
   * §7 — o atlas é forjado SOB DEMANDA, uma única vez, no primeiro desenho do
   * jogador. Sem canvas (jsdom) devolve `null` e o desenho cai nas formas
   * geométricas antigas: degradar sem lançar é requisito, não gambiarra.
   */
  private atlasDoGuerreiro(): AtlasPersonagem | null {
    if (this.atlasTentado) return this.atlas;
    this.atlasTentado = true;
    this.atlas = this.forjarSeguro(MODELO_GUERREIRO, FORJA_GUERREIRO);
    return this.atlas;
  }

  /**
   * Forja um atlas sem NUNCA lançar: sem DOM ou sem contexto 2D o forge devolve
   * um atlas vazio (`disponivel: false`), e aqui isso vira `null` — o sinal de
   * "desenhe do jeito antigo". Compartilhado pelo jogador e pelo bestiário para
   * que os dois degradem exatamente igual.
   */
  private forjarSeguro(modelo: No, opcoes: OpcoesForja): AtlasPersonagem | null {
    try {
      const forjado = forjarAtlas(modelo, opcoes);
      return forjado.disponivel && forjado.canvas ? forjado : null;
    } catch {
      return null;
    }
  }

  /**
   * Cópia tingida de um quadro, para o clarão de dano. O sprite não é um
   * caminho — não dá para `fill()` a silhueta dele —, então o tingimento sai de
   * um buffer próprio com `source-atop`, que respeita o alfa do quadro. O buffer
   * é da instância e reaproveitado: nada é alocado por quadro de animação.
   *
   * A FONTE é parâmetro (e não mais o atlas do jogador) porque o inimigo tinge o
   * quadro já modulado pela luz, que mora na folha de slots do forge, não no
   * atlas. Como o buffer serve a personagens de tamanhos diferentes, ele só
   * CRESCE — encolher a cada troca de dono transformaria um clarão simultâneo de
   * jogador e goblin em duas alocações de canvas por quadro de animação.
   */
  private tingirQuadro(
    fonte: HTMLCanvasElement, sx: number, sy: number, lw: number, lh: number, cor: string
  ): HTMLCanvasElement | null {
    if (lw <= 0 || lh <= 0) return null;
    const atual = this.tinta;
    if (!atual || atual.width < lw || atual.height < lh) {
      const novo = novoCanvas(
        Math.max(lw, atual ? atual.width : 0),
        Math.max(lh, atual ? atual.height : 0)
      );
      this.tinta = novo;
      this.tintaCtx = contexto2d(novo);
    }
    const cv = this.tinta;
    const tctx = this.tintaCtx;
    if (!cv || !tctx) return null;
    tctx.globalCompositeOperation = 'source-over';
    // Só o canto usado: quem lê a tinta lê exatamente este retângulo.
    tctx.clearRect(0, 0, lw, lh);
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(fonte, sx, sy, lw, lh, 0, 0, lw, lh);
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = cor;
    tctx.fillRect(0, 0, lw, lh);
    tctx.globalCompositeOperation = 'source-over';
    return cv;
  }

  /**
   * §9.1/§9.3 — cola o quadro do atlas com a ÂNCORA (a projeção do plano z = 0
   * do modelo, o centro dos pés) sobre o centro do losango do tile. Nunca a
   * borda de baixo do quadro: no rig do Guerreiro a bota afunda no chão de
   * propósito e há pixels abaixo da âncora.
   *
   * `imageSmoothingEnabled = false` antes e restaurado depois: interpolar um
   * sprite de pixel art o transforma em borrão, e deixar o flag desligado
   * estragaria qualquer outro `drawImage` do mesmo contexto.
   */
  private desenharSpriteJogador(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem, p: Player,
    cx: number, cy: number, z: number, flash: number,
    quadro?: { estado: Estado; frame: number }
  ): void {
    const cv = atlas.canvas;
    if (!cv) return;
    const lw = atlas.larguraFrame;
    const lh = atlas.alturaFrame;
    const q = quadro ?? this.quadroDoJogador();
    const alvo = atlas.quadro(normalizeFacing(p.facing), q.estado, q.frame);
    const dx = Math.round(cx - atlas.ancoraX * z);
    const dy = Math.round(cy - atlas.ancoraY * z);
    const dw = lw * z;
    const dh = lh * z;

    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, alvo.sx, alvo.sy, lw, lh, dx, dy, dw, dh);
    if (flash > 0) {
      const tinta = this.tingirQuadro(
        cv, alvo.sx, alvo.sy, lw, lh, this.luts.FLASH_COL[Math.round(flash * (LEVELS - 1))]
      );
      if (tinta) ctx.drawImage(tinta, 0, 0, lw, lh, dx, dy, dw, dh);
    }
    ctx.imageSmoothingEnabled = suave;
  }

  /**
   * O jogador em formas geométricas — o desenho do vanilla, intacto. Só entra em
   * cena quando o atlas não pôde ser forjado (sem DOM / sem contexto 2D); o
   * jogo nunca fica sem personagem por causa de um ambiente pobre.
   */
  private desenharJogadorGeometrico(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, flash: number
  ): void {
    const luts = this.luts;
    const sh = luts.SHADES.player;
    const am = luts.SHADES.amber;
    const lvl = LEVELS - 1;

    // corpo em cone/losango claro
    pathPlayerBody(ctx, cx, cy, z);
    ctx.fillStyle = sh.main[lvl];
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 27 * z);
    ctx.lineTo(cx - 10 * z, cy - 4 * z);
    ctx.lineTo(cx, cy + 3 * z);
    ctx.closePath();
    ctx.fillStyle = sh.dark[lvl];
    ctx.fill();

    // arma
    ctx.strokeStyle = am.main[lvl];
    ctx.lineWidth = Math.max(1, 2.2 * z);
    ctx.beginPath();
    ctx.moveTo(cx + 6 * z, cy - 6 * z);
    ctx.lineTo(cx + 15 * z, cy - 28 * z);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.4 * z);
    ctx.beginPath();
    ctx.moveTo(cx + 7 * z, cy - 14 * z);
    ctx.lineTo(cx + 13 * z, cy - 12 * z);
    ctx.stroke();

    // cabeça
    fillCircle(ctx, cx, cy - 33 * z, 5.4 * z, sh.light[lvl]);
    fillCircle(ctx, cx - 1.6 * z, cy - 34.5 * z, 1.8 * z, sh.main[lvl]);

    if (flash > 0) {
      pathPlayerBody(ctx, cx, cy, z);
      ctx.fillStyle = luts.FLASH_COL[Math.round(flash * (LEVELS - 1))];
      ctx.fill();
    }
  }

  /**
   * §9 — o jogador, desenhado no passo do tile dele dentro da ordem do pintor
   * por antidiagonal (nada mudou nessa ordem). A sombra elíptica vem primeiro,
   * o sprite depois e a barra de vida por último.
   *
   * A barra sobe para o topo do quadro quando há sprite: com a espada erguida o
   * personagem é bem mais alto que o boneco geométrico antigo, e os 42 px de
   * antes cruzariam a lâmina.
   */
  private drawPlayer(
    ctx: CanvasRenderingContext2D, p: Player, sx: number, cyBase: number, z: number
  ): void {
    const fase = this.cin.fase;

    /*
     * Cinemática de MORTE — o desenho inteiro do jogador é dela: decalque de
     * sangue, corpo (parado → ajoelhado → caído), espada solta. SEM barra de
     * vida (o guerreiro não tem mais vida a mostrar). O tile, não o deslize do
     * passo, ancora a sequência: `sx`/`cyBase` crus.
     */
    if (fase === 'morte' || fase === 'concluida') {
      this.desenharMorte(ctx, p, sx, cyBase, z);
      return;
    }

    const v = this.vfxOf('p', p.x, p.y, p.hp);
    const a = this.anim;
    const cx = sx + a.ox * z;
    const cy = cyBase + a.oy * z;

    /*
     * Cinemática de INTRO (descendo as escadas) — dois adereços sobre o desenho
     * normal: o glifo de escada como prop no tile (esmaece nos últimos ~0,3 s)
     * e o sprite entrando de `INTRO_ALTURA_PX`·zoom acima da âncora em ciclo de
     * marcha, fechando em 'parado'. Curva ease-out simples.
     */
    let cySprite = cy;
    let quadroIntro: { estado: Estado; frame: number } | undefined;
    if (fase === 'intro') {
      const t = this.cin.t;
      const hw = this.HW0 * z;
      const hh = this.HH0 * z;
      let alfa = 1;
      if (t > DUR_INTRO - INTRO_ESMAECER) {
        alfa = (DUR_INTRO - t) / INTRO_ESMAECER;
        if (alfa < 0) alfa = 0;
      }
      const alfaAntes = ctx.globalAlpha;
      ctx.globalAlpha = alfaAntes * alfa;
      this.drawStairs(ctx, sx, cyBase - hh, hw, hh, true, LEVELS - 1);
      ctx.globalAlpha = alfaAntes;

      let k = t / INTRO_DESLIZE;
      if (k > 1) k = 1;
      const ease = 1 - (1 - k) * (1 - k);
      cySprite = cy - INTRO_ALTURA_PX * z * (1 - ease);
      quadroIntro = k < 1
        ? { estado: 'andando', frame: Math.floor(t / DUR_PASSO) % 4 }
        : { estado: 'parado', frame: 0 };
    }

    // §9.2 — a sombra elíptica continua existindo: é ela que cola o boneco no
    // chão. Ela acompanha o deslize NOS DOIS EIXOS (o vanilla só a arrastava na
    // horizontal): a âncora do sprite é o plano do chão do modelo, e uma sombra
    // parada enquanto os pés escorregam lê como defeito. Parado, `cy === cyBase`
    // e o desenho é idêntico ao de antes. A sombra nunca sobe com o quique — ela
    // é do chão, não do personagem.
    fillEllipse(ctx, cx, cy + 2 * z, 12 * z, 5 * z, COL_SHADOW_ENT);

    const atlas = this.atlasDoGuerreiro();
    let topoBarra = 42;
    if (atlas) {
      this.desenharSpriteJogador(ctx, atlas, p, cx, cySprite, z, v.flash, quadroIntro);
      topoBarra = atlas.ancoraY - FOLGA_BARRA;
    } else {
      this.desenharJogadorGeometrico(ctx, cx, cySprite - hopOf(v, 0) * 6 * z, z, v.flash);
    }

    if (p.maxHp > 0 && p.hp < p.maxHp) {
      this.drawHpBar(ctx, cx, cy - topoBarra * z, z, p.hp / p.maxHp);
    }
  }

  /* ------------------------------------------------------------------ *
   * Cinemática de MORTE — o desenho por fase
   *
   * Sem atlas (jsdom, sem contexto 2D) nada quebra: o sangue e o véu são
   * primitivas de canvas e desenham sempre; os sprites simplesmente não saem —
   * o relógio e as fases, que são o que a UI consome, vivem em `update`.
   * ------------------------------------------------------------------ */

  /** Atlas secundário da morte, sob demanda e uma vez só (ver `atlasMorte`). */
  private atlasDeMorte(qual: 'ajoelhado' | 'caido' | 'espada'): AtlasPersonagem | null {
    const pronto = this.atlasMorte.get(qual);
    if (pronto !== undefined) return pronto;
    let atlas: AtlasPersonagem | null = null;
    if (qual === 'ajoelhado') {
      atlas = this.forjarSeguro(MODELO_GUERREIRO_SEM_ESPADA, FORJA_MORTE_AJOELHADO);
    } else if (qual === 'caido') {
      atlas = this.forjarSeguro(MODELO_GUERREIRO_SEM_ESPADA, FORJA_MORTE_CAIDO);
    } else {
      atlas = this.forjarSeguro(MODELO_ESPADA, FORJA_ESPADA);
    }
    this.atlasMorte.set(qual, atlas);
    return atlas;
  }

  /**
   * Cola a coluna ('parado', 0) de um atlas — a pose EXATA do repouso forjado
   * (§7: `poseDoQuadro` devolve o repouso sem deltas em parado/0) — com a
   * âncora sobre o centro do losango, na direção dada. Sem flash, sem barra.
   */
  private desenharQuadroExato(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem, dir: number,
    cx: number, cy: number, z: number
  ): void {
    const cv = atlas.canvas;
    if (!cv) return;
    const lw = atlas.larguraFrame;
    const lh = atlas.alturaFrame;
    const alvo = atlas.quadro(dir, 'parado', 0);
    const dx = Math.round(cx - atlas.ancoraX * z);
    const dy = Math.round(cy - atlas.ancoraY * z);
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, alvo.sx, alvo.sy, lw, lh, dx, dy, lw * z, lh * z);
    ctx.imageSmoothingEnabled = suave;
  }

  /**
   * A poça de sangue (fase 1): elipse vermelho-escura no plano do piso,
   * crescendo de 0 a `SANGUE_RAIO`·zoom em MORTE_SANGUE e persistindo até o
   * fim. Desenhada ANTES do sprite — é decalque de chão. Os respingos saem de
   * um LCG próprio semeado por (x, y): determinísticos e só cosméticos (nada
   * de `Math.random` no render — ver tools/check-boundaries.mjs).
   */
  private desenharSangue(
    ctx: CanvasRenderingContext2D, p: Player, cx: number, cy: number, z: number, t: number
  ): void {
    let k = t / MORTE_SANGUE;
    if (k > 1) k = 1;
    if (k <= 0) return;
    const ease = 1 - (1 - k) * (1 - k);
    const r = SANGUE_RAIO * z * ease;
    const by = cy + 2 * z;
    fillEllipse(ctx, cx, by, r, r * 0.42, '#6e1414');
    fillEllipse(ctx, cx - 2 * z, by - 0.5 * z, r * 0.6, r * 0.25, '#4a0d0d');

    /* Respingos determinísticos em torno da poça (LCG semeado pelo tile). */
    let s = ((p.x * 374761393) ^ (p.y * 668265263) ^ 0x9e3779b9) >>> 0;
    if (s === 0) s = 1;
    for (let i = 0; i < 8; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const ang = (s / 4294967296) * TAU;
      s = (s * 1664525 + 1013904223) >>> 0;
      const dist = (0.5 + (s / 4294967296) * 0.65) * SANGUE_RAIO * z * ease;
      s = (s * 1664525 + 1013904223) >>> 0;
      const rr = (0.8 + (s / 4294967296) * 1.6) * z;
      fillEllipse(
        ctx, cx + Math.cos(ang) * dist, by + Math.sin(ang) * dist * 0.42,
        rr, rr * 0.42, i % 2 === 0 ? '#6e1414' : '#4a0d0d'
      );
    }
  }

  /**
   * A espada solta (fase 2): sai da altura da mão e cai ao lado girando até
   * ~75°, acelerando (queda, não deslize); ao pousar, fica como decalque
   * estático. O giro é de TELA (`ctx.rotate` com suavização desligada — o
   * giro pixelado é desejado), então o atlas é sempre a coluna ('parado', 0)
   * na direção do facing e a pose do rig não se envolve.
   */
  private desenharEspadaSolta(
    ctx: CanvasRenderingContext2D, dir: number, cx: number, cy: number, z: number, t: number
  ): void {
    if (t < MORTE_ESPADA_INICIO) return;
    const atlas = this.atlasDeMorte('espada');
    if (!atlas || !atlas.canvas) return;
    let k = (t - MORTE_ESPADA_INICIO) / (MORTE_ESPADA_FIM - MORTE_ESPADA_INICIO);
    if (k > 1) k = 1;
    const queda = k * k;
    const px = (cx - 6 * z) + 20 * z * queda; // da mão para +14px·zoom ao lado
    const py = (cy - 22 * z) + 28 * z * queda; // da altura da mão para +6px·zoom
    const lw = atlas.larguraFrame;
    const lh = atlas.alturaFrame;
    const alvo = atlas.quadro(dir, 'parado', 0);
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ESPADA_GIRO * k);
    ctx.drawImage(
      atlas.canvas, alvo.sx, alvo.sy, lw, lh,
      Math.round(-atlas.ancoraX * z), Math.round(-atlas.ancoraY * z), lw * z, lh * z
    );
    ctx.restore();
    ctx.imageSmoothingEnabled = suave;
  }

  /**
   * A sequência completa, ancorada no tile (sem o deslize do passo): sangue →
   * sombra → corpo por fase → espada solta. A barra de vida não existe aqui.
   */
  private desenharMorte(
    ctx: CanvasRenderingContext2D, p: Player, sx: number, cyBase: number, z: number
  ): void {
    const t = this.cin.t;
    const cx = sx;
    const cy = cyBase;
    const dir = normalizeFacing(p.facing);

    // 1. SANGUE (0→0,9 s, persiste) — decalque de chão, antes de tudo.
    this.desenharSangue(ctx, p, cx, cy, z, t);

    // A sombra elíptica continua: o cadáver também está no chão.
    fillEllipse(ctx, cx, cy + 2 * z, 12 * z, 5 * z, COL_SHADOW_ENT);

    // 3/4. CORPO — parado (até 0,9) → AJOELHADO → CAÍDO (1,7). Trocas duras.
    let corpo: AtlasPersonagem | null;
    if (t >= MORTE_CAIDO) corpo = this.atlasDeMorte('caido');
    else if (t >= MORTE_AJOELHADO) corpo = this.atlasDeMorte('ajoelhado');
    else corpo = this.atlasDoGuerreiro();
    if (corpo) {
      this.desenharQuadroExato(ctx, corpo, dir, cx, cy, z);
    } else if (t < MORTE_AJOELHADO) {
      // Rede de segurança sem atlas (jsdom): o boneco geométrico de sempre.
      this.desenharJogadorGeometrico(ctx, cx, cy, z, 0);
    }

    // 2. ESPADA (0,15→0,9) — depois do corpo: ao pousar é decalque ao lado.
    this.desenharEspadaSolta(ctx, dir, cx, cy, z, t);
  }

  private drawPotion(
    ctx: CanvasRenderingContext2D, item: Item, sx: number, cyBase: number, z: number,
    lvl: number, seedIdx: number
  ): void {
    if (!item) return;
    const luts = this.luts;
    const sh = luts.SHADES.potion;
    const am = luts.SHADES.amber;
    const bob = Math.sin(this.t * 2 + (typeof item.id === 'number' ? item.id : seedIdx)) * 1.2 * z;
    const cx = sx;
    const cy = cyBase + bob;

    fillEllipse(ctx, cx, cyBase + 2 * z, 7 * z, 3 * z, COL_SHADOW_ENT);
    // corpo
    fillCircle(ctx, cx, cy - 7 * z, 5.2 * z, sh.main[lvl]);
    // gargalo
    ctx.fillStyle = sh.dark[lvl];
    ctx.fillRect(cx - 1.8 * z, cy - 16 * z, 3.6 * z, 6 * z);
    // rolha
    ctx.fillStyle = am.dark[lvl];
    ctx.fillRect(cx - 2.8 * z, cy - 18.5 * z, 5.6 * z, 3 * z);
    // brilho
    fillCircle(ctx, cx - 1.8 * z, cy - 8.6 * z, 1.4 * z, sh.light[lvl]);
  }

  /* ------------------------------------------------------------------ *
   * Destaque do tile sob o mouse (R11)
   * ------------------------------------------------------------------ */
  private drawHover(
    ctx: CanvasRenderingContext2D, game: Game, hw: number, hh: number, ox: number, oy: number
  ): void {
    const ui = game.ui;
    if (!ui || !ui.hover) return;
    const map = game.map;
    const hx = ui.hover.x;
    const hy = ui.hover.y;
    if (hx < 0 || hy < 0 || hx >= map.w || hy >= map.h) return;
    const s = hx + hy;
    const sx = hw * (2 * hx - s) + ox;
    const sy = s * hh + oy;
    pathDiamond(ctx, sx, sy, hw, hh);
    ctx.fillStyle = COL_HOVER_FILL;
    ctx.fill();
    ctx.strokeStyle = COL_HOVER_LINE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ *
   * Camadas de debug (R50) e sonda de FOV (R28)
   * ------------------------------------------------------------------ */
  private drawDebugLayer(
    ctx: CanvasRenderingContext2D, game: Game, hw: number, hh: number, ox: number, oy: number
  ): void {
    const luts = this.luts;
    const map = game.map;
    const dmap = game.dmap;
    const tiles = map.tiles;
    const w = map.w;
    const h = map.h;
    const vis: ReadonlySet<number> =
      game.visible && typeof game.visible.has === 'function' ? game.visible : EMPTY_SET;
    const expl = game.explored || null;
    const INF = DIJKSTRA_INF;

    ctx.font = FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (let s = 0; s <= w - 1 + (h - 1); s++) {
      const sy = s * hh + oy;
      if (sy + hh + hh < -48 || sy > this.vh + 48) continue;
      let lo = s - (h - 1);
      if (lo < 0) lo = 0;
      let hi = s;
      if (hi > w - 1) hi = w - 1;
      for (let x = lo; x <= hi; x++) {
        const y = s - x;
        const i = y * w + x;
        const t = tiles[i];
        if (t === this.T_WALL) continue;
        if (!vis.has(i) && !(expl && expl[i] !== 0)) continue;
        const sx = hw * (2 * x - s) + ox;
        if (sx < -hw - 8 || sx > this.vw + hw + 8) continue;
        // grade fina
        ctx.strokeStyle = COL_GRID;
        pathDiamond(ctx, sx, sy, hw, hh);
        ctx.stroke();
        if (!dmap) continue;
        const v = dmap[i];
        // Fora do buffer o índice devolve `undefined`; a negação cobre esse caso
        // e o `>= INF` do vanilla de uma vez só (undefined < INF é falso).
        if (!(v < INF)) continue;
        ctx.fillStyle = luts.DMAP_COL[Math.min(luts.DMAP_COL.length - 1, Math.max(0, v >> 2))];
        ctx.fillText(v >= 0 && v < luts.NUMSTR.length ? luts.NUMSTR[v] : String(v), sx, sy + hh);
      }
    }
  }

  private drawFovProbe(
    ctx: CanvasRenderingContext2D, game: Game, hw: number, hh: number, ox: number, oy: number
  ): void {
    const ui = game.ui;
    if (!ui || !ui.hover) return;
    const map = game.map;
    const hx = ui.hover.x;
    const hy = ui.hover.y;
    if (hx < 0 || hy < 0 || hx >= map.w || hy >= map.h) return;

    const w = map.w;
    const set = computeFov(map, hx, hy, this.FOV_R);
    let sx: number;
    let sy: number;
    let s: number;
    if (set && typeof set.forEach === 'function') {
      ctx.fillStyle = COL_PROBE;
      set.forEach((i: number) => {
        const px = i % w;
        const py = (i - px) / w;
        const ss = px + py;
        const psx = hw * (2 * px - ss) + ox;
        const psy = ss * hh + oy;
        pathDiamond(ctx, psx, psy, hw, hh);
        ctx.fill();
      });
    }

    // origem da sonda
    s = hx + hy;
    sx = hw * (2 * hx - s) + ox;
    sy = s * hh + oy;
    ctx.strokeStyle = COL_PROBE_LINE;
    ctx.lineWidth = 2;
    pathDiamond(ctx, sx, sy, hw, hh);
    ctx.stroke();

    const sym = checkSymmetry(map, hx, hy, this.FOV_R);
    if (!sym || !sym.broken || !sym.broken.length) return;
    ctx.lineWidth = 2;
    for (let k = 0; k < sym.broken.length; k++) {
      const b = sym.broken[k];
      if (!b) continue;
      s = b.x + b.y;
      sx = hw * (2 * b.x - s) + ox;
      sy = s * hh + oy;
      ctx.fillStyle = COL_BROKEN;
      pathDiamond(ctx, sx, sy, hw, hh);
      ctx.fill();
      ctx.strokeStyle = COL_BROKEN_LINE;
      ctx.beginPath();
      ctx.moveTo(sx - hw * 0.5, sy + hh * 0.5);
      ctx.lineTo(sx + hw * 0.5, sy + hh * 1.5);
      ctx.moveTo(sx + hw * 0.5, sy + hh * 0.5);
      ctx.lineTo(sx - hw * 0.5, sy + hh * 1.5);
      ctx.stroke();
    }
  }
}
