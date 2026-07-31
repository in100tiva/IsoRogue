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
 *
 * O QUE MUDOU NA FASE DO TERRENO (src/render/tilesets/):
 *   - O CHÃO deixou de ser losango pintado à mão e virou SPRITE forjado, pelo
 *     mesmo pipeline do elenco: o piso, a parede e os adereços de cada andar são
 *     rigs 3D que moram em `./tilesets/nivelN.ts`, chegam aqui por
 *     `tilesetDoNivel(depth)` e são colados com a âncora no centro do losango —
 *     a MESMA âncora dos personagens. Este arquivo não conhece grama nem areia.
 *   - O desenho geométrico do piso e da parede NÃO saiu: virou o fallback de
 *     quem não conseguiu forjar (jsdom, Node, qualquer ambiente sem contexto
 *     2D), exatamente como já era para os monstros (§7.3 do BESTIARIO).
 *   - A transparência das paredes do canto frontal continua onde estava, em
 *     `draw`, e continua valendo: `globalAlpha` afeta `drawImage` como afetava
 *     `fill()`. Ver o bloco de `ALFA_PAREDE_OCULTA` e `colarTerreno`.
 */

import { CONFIG, DEFAULT_FACING, cheb, dirIndex, normalizeFacing } from '../engine/core';
import { DIJKSTRA_INF } from '../engine/dijkstra';
import { checkSymmetry, computeFov } from '../engine/fov';
import type {
  ArchetypeKey, Enemy, Game, GameMap, Item, ItemKind, MaterialKind, Player, Point
} from '../engine/types';
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
import type { Luts, ShadeKey } from './palette';
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
  MODELO_CIMITARRA,
  MODELO_GOBLIN,
  MODELO_GOBLIN_SEM_CIMITARRA,
  PALETA_GOBLIN,
  POSE_MORTE_GOBLIN_AGACHADO,
  POSE_MORTE_GOBLIN_CAIDO,
  POSE_PARADA_GOBLIN,
  RAMPAS_GOBLIN,
  RAMPA_DA_COR_GOBLIN
} from './characters/goblin';
import {
  ARCO_GOLPE_SLIME,
  CORES_EMISSIVAS_SLIME,
  MODELO_SLIME,
  MODELO_SLIME_DERRETIDO_1,
  MODELO_SLIME_DERRETIDO_2,
  MODELO_SLIME_DERRETIDO_3,
  PALETA_SLIME,
  POSE_PARADA_SLIME,
  RAMPAS_SLIME,
  RAMPA_DA_COR_SLIME
} from './characters/slime';
import {
  ARCO_GOLPE_OGRO,
  CORES_EMISSIVAS_OGRO,
  MODELO_MARRETA,
  MODELO_OGRO,
  MODELO_OGRO_SEM_MARRETA,
  PALETA_OGRO,
  POSE_MORTE_OGRO_AGACHADO,
  POSE_MORTE_OGRO_CAIDO,
  POSE_PARADA_OGRO,
  RAMPAS_OGRO,
  RAMPA_DA_COR_OGRO
} from './characters/ogre';
import {
  PALETA_XP,
  RAMPA_DA_COR_XP,
  RAMPAS_XP,
  modeloDeXp
} from './characters/xpTexto';
import {
  CORES_EMISSIVAS_GOSMA,
  MODELO_GOSMA,
  PALETA_GOSMA,
  POSE_PARADA_GOSMA,
  RAMPAS_GOSMA,
  RAMPA_DA_COR_GOSMA
} from './characters/itemGosma';
import {
  MODELO_ORELHA_GOBLIN,
  PALETA_ORELHA_GOBLIN,
  POSE_PARADA_ORELHA_GOBLIN,
  RAMPAS_ORELHA_GOBLIN,
  RAMPA_DA_COR_ORELHA_GOBLIN
} from './characters/itemOrelhaGoblin';
import {
  MODELO_PE_OGRO,
  PALETA_PE_OGRO,
  POSE_PARADA_PE_OGRO,
  RAMPAS_PE_OGRO,
  RAMPA_DA_COR_PE_OGRO
} from './characters/itemPeOgro';
import {
  CORES_EMISSIVAS_MERCADOR,
  MODELO_MERCADOR,
  PALETA_MERCADOR,
  POSE_PARADA_MERCADOR,
  RAMPAS_MERCADOR,
  RAMPA_DA_COR_MERCADOR
} from './characters/mercador';
import {
  CORES_EMISSIVAS_ALQUIMIA,
  MODELO_CALDEIRAO,
  MODELO_ESTANTE,
  MODELO_MESA_ALQUIMIA,
  PALETA_ALQUIMIA,
  POSE_PARADA_ALQUIMIA,
  RAMPAS_ALQUIMIA,
  RAMPA_DA_COR_ALQUIMIA
} from './characters/alquimia';
import { tilesetDoNivel } from './tilesets';
import type { Tileset } from './tilesets';
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
/**
 * Guerreiro em pé SEM a espada — o quadro que existe entre o instante em que a
 * arma se solta (`MORTE_ESPADA_INICIO`) e a troca para o ajoelhado. Sem ele o
 * corpo seguia sendo o atlas normal, com a espada na mão, enquanto a espada
 * solta já caía: duas espadas na tela por 0,75 s. Mesmo repouso do atlas
 * normal (`FORJA_GUERREIRO` já carrega `POSE_PARADA`); só o rig muda.
 */
const FORJA_MORTE_PARADO: OpcoesForja = { ...FORJA_GUERREIRO };

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

/* ------------------------------------------------------------------ *
 * As MORTES do bestiário (docs/BESTIARIO.md §14)
 *
 * A MESMA técnica da cinemática de morte do Guerreiro, generalizada para os
 * três monstros: poses/estágios congelados na coluna ('parado', 0) de atlases
 * secundários (a chave de cache do forge já inclui o repouso E o modelo), a
 * queda da arma por rotação de TELA, o sangue e a geleia como decalques de
 * chão em primitivas de canvas, e o relógio por `dt` — tudo por OBSERVAÇÃO
 * do `Game`, sem uma letra no engine (R54). Cada bicho deixa um RASTRO
 * persistente e distinto no tile do abate:
 *
 *   - GOBLIN  → o CORPO caído sobre o sangue (a cimitarra cai e some);
 *   - OGRO    → a MARRETA pousada sobre o sangue (o corpo cai e some);
 *   - SLIME   → a GELEIA no chão (o estágio 3 do derretimento, com a bolinha
 *               âmbar afogada — emissiva, acesa até no escuro).
 *
 * Lendo o chão da masmorra, o jogador sabe QUEM morreu ali sem ter visto o
 * abate. Os rastros vivem até a troca de mapa (`syncRun` os zera), como o
 * sangue do Guerreiro vive até a próxima expedição.
 * ------------------------------------------------------------------ */

/** Forjas da morte do Goblin — corpo sem cimitarra em duas poses + a arma solta. */
const FORJA_MORTE_GOBLIN_AGACHADO: OpcoesForja = { ...FORJA_GOBLIN, repouso: POSE_MORTE_GOBLIN_AGACHADO };
const FORJA_MORTE_GOBLIN_CAIDO: OpcoesForja = { ...FORJA_GOBLIN, repouso: POSE_MORTE_GOBLIN_CAIDO };
const FORJA_CIMITARRA: OpcoesForja = { ...FORJA_GOBLIN, repouso: POSE_NEUTRA };

/** Forjas da morte do Ogro — corpo sem marreta em duas poses + a arma solta. */
const FORJA_MORTE_OGRO_AGACHADO: OpcoesForja = { ...FORJA_OGRO, repouso: POSE_MORTE_OGRO_AGACHADO };
const FORJA_MORTE_OGRO_CAIDO: OpcoesForja = { ...FORJA_OGRO, repouso: POSE_MORTE_OGRO_CAIDO };
const FORJA_MARRETA: OpcoesForja = { ...FORJA_OGRO, repouso: POSE_NEUTRA };

/** Forja dos estágios de derretimento do Slime — o derretido é GEOMETRIA, não pose. */
const FORJA_SLIME_DERRETIDA: OpcoesForja = { ...FORJA_SLIME, repouso: POSE_NEUTRA };

/* --- tempos da morte do GOBLIN (sequência de 1,1 s) --- */
/** Sangue: a poça cresce de 0 até aqui e persiste. Valor compartilhado com o Ogro. */
const MORTE_MOB_SANGUE = 0.9;
/** Cimitarra: solta-se da mão neste instante, pousa e esmaece até sumir. */
const GOB_MORTE_ARMA_INICIO = 0.1;
const GOB_MORTE_ARMA_FIM = 0.55;
const GOB_MORTE_ARMA_SOME = 0.85;
/** Troca dura para a pose agachada, depois para a caída (que persiste). */
const GOB_MORTE_AGACHADO = 0.3;
const GOB_MORTE_CAIDO = 0.75;
const DUR_MORTE_GOBLIN = 1.1;
/** Raio final da poça do goblin, em px a zoom 1 (bicho pequeno, poça pequena). */
const SANGUE_RAIO_GOBLIN = 16;

/* --- tempos da morte do OGRO (sequência de 1,7 s — ele é PESADO) --- */
/** Sangue do ogro: cresce mais devagar e maior. */
const OGRO_MORTE_SANGUE = 1.1;
/** Marreta: solta-se da mão, pousa na poça e FICA (é o rastro). */
const OGRO_MORTE_ARMA_INICIO = 0.2;
const OGRO_MORTE_ARMA_FIM = 0.95;
/** Troca dura para a pose agachada, depois para a caída. */
const OGRO_MORTE_AGACHADO = 0.45;
const OGRO_MORTE_CAIDO = 1.0;
/** O corpo caído ESMAECE e some: o rastro do ogro é a arma, não o corpo. */
const OGRO_MORTE_CORPO_SOME_INICIO = 1.25;
const OGRO_MORTE_CORPO_SOME_FIM = 1.65;
const DUR_MORTE_OGRO = 1.7;
const SANGUE_RAIO_OGRO = 24;

/* --- tempos da morte do SLIME (sequência de 1,0 s — derretimento) --- */
/** Geleia: a poça verde cresce de 0 até aqui e persiste. */
const SLIME_MORTE_GOSMA = 1.0;
/** Cortes duros entre os estágios de derretimento (o 3º é a poça persistente). */
const SLIME_MORTE_ESTAGIO_1 = 0.25;
const SLIME_MORTE_ESTAGIO_2 = 0.6;
const SLIME_MORTE_ESTAGIO_3 = 0.95;
const DUR_MORTE_SLIME = 1.0;
const GOSMA_RAIO_SLIME = 18;

/** Giro total das armas na queda, em radianos (~70°). O giro pixelado é desejado. */
const ARMA_GIRO_MORTE = (70 * Math.PI) / 180;

/* ------------------------------------------------------------------ *
 * O texto de XP flutuante (docs/BESTIARIO.md §16)
 *
 * O abate chega pela fila VISUAL `game.abatesRecentes` (o engine escreve no
 * instante do golpe, com o nível do herói ainda certo; o renderer drena a
 * cada quadro — mesmo estatuto do `bump`). O texto é o rig de caixas de
 * `./characters/xpTexto` forjado sob demanda por valor, lido na linha `dir 2`
 * (a frente) da coluna ('parado', 0) — estático, quem se move é a POSIÇÃO de
 * tela: sobe com ease-out e esmaece no último terço. Brilho pleno sempre: é
 * feedback de recompensa, não cenário (o mesmo estatuto do clarão de dano).
 * ------------------------------------------------------------------ */

/** Forja do texto de XP — repouso neutro: o rig é um nó único sem pose. */
const FORJA_XP: OpcoesForja = {
  paleta: PALETA_XP,
  rampas: RAMPAS_XP,
  rampaDaCor: RAMPA_DA_COR_XP,
  repouso: POSE_NEUTRA
};

/** Duração total da subida do texto, em segundos. */
const DUR_FLUTUA_XP = 1.1;
/** Deslocamento vertical total, em px a zoom 1 (da âncora do tile para cima). */
const FLUTUA_XP_SUBIDA = 38;
/** Fração final em que o texto esmaece (antes disso, alpha 1). */
const FLUTUA_XP_FADE = 0.65;

/** Um flutuante de XP vivo, puramente visual. */
interface FlutuanteXp {
  x: number;
  y: number;
  xp: number;
  t: number;
}

/* ------------------------------------------------------------------ *
 * OS DESPOJOS NO CHÃO (fase 1 dos itens)
 *
 * A mesma mecânica de `RETRATOS`, aplicada a coisa morta: cada MATERIAL tem
 * uma ficha (rig + forja), o atlas é forjado sob demanda e o quadro sai da
 * coluna ('parado', 0) — item não anda, não respira e não ataca, então as
 * outras 8 colunas do atlas existem só porque a forja é genérica.
 *
 * O que NÃO entra nesta tabela: a poção. Ela é contrato antigo (R7), continua
 * desenhada pelo caminho geométrico de sempre (`drawPotion`, byte a byte o do
 * vanilla) e é justamente por isso que a tabela é indexada por `MaterialKind`
 * e não por `ItemKind` — o compilador recusa `FICHAS_DE_ITEM.potion` e recusa
 * também esquecer um material novo, que é o erro que dá para prevenir de graça.
 *
 * Duas fichas reaproveitam rig E forja das armas da cinemática de morte
 * (`FORJA_CIMITARRA`, `FORJA_MARRETA`): o despojo "cimitarra de goblin" É a
 * cimitarra que o goblin largou. Como a chave do cache do forge é (modelo,
 * opções) e as duas constantes são as MESMAS, o atlas é literalmente o mesmo
 * objeto — a arma no chão não custa uma segunda forja.
 *
 * As duas armas são desenhadas EM PÉ, na mesma âncora dos outros despojos, e
 * NÃO deitadas como o prop da §14. É deliberado: a arma da morte está caída no
 * chão (é rastro de um acontecimento), a arma-item está PARA SER PEGA — em pé,
 * com o bob suave, ela lê como coisa que se recolhe, que é a convenção do
 * gênero. O custo de deitá-la seria um segundo canal na tabela (um ângulo por
 * ficha) para dizer o que a leitura já diz.
 * ------------------------------------------------------------------ */

/**
 * Forjas dos rigs próprios de despojo. Constante de módulo pelos mesmos dois
 * motivos de sempre (o forge memoiza por (modelo, opções) — objeto novo a cada
 * chamada gera chave nova e reforja tudo; e a cor é propriedade do rig).
 *
 * O `repouso` vem do próprio rig e é VAZIO nos três: um frasco não tem membro
 * para articular. Está aqui, e não omitido, porque é assim que o arquivo do
 * item continua sendo a fonte da verdade — se um dia um despojo ganhar pose, a
 * mudança é lá e esta linha já a colhe.
 */
const FORJA_GOSMA: OpcoesForja = {
  paleta: PALETA_GOSMA,
  rampas: RAMPAS_GOSMA,
  rampaDaCor: RAMPA_DA_COR_GOSMA,
  repouso: POSE_PARADA_GOSMA,
  /* O ponto âmbar do frasco é EMISSIVO (§1.1): é ele que faz o despojo ser
   * avistado num corredor escuro. Sem isso o item cai no chão e desaparece. */
  emissivas: CORES_EMISSIVAS_GOSMA
};

const FORJA_ORELHA_GOBLIN: OpcoesForja = {
  paleta: PALETA_ORELHA_GOBLIN,
  rampas: RAMPAS_ORELHA_GOBLIN,
  rampaDaCor: RAMPA_DA_COR_ORELHA_GOBLIN,
  repouso: POSE_PARADA_ORELHA_GOBLIN
};

const FORJA_PE_OGRO: OpcoesForja = {
  paleta: PALETA_PE_OGRO,
  rampas: RAMPAS_PE_OGRO,
  rampaDaCor: RAMPA_DA_COR_PE_OGRO,
  repouso: POSE_PARADA_PE_OGRO
};

/**
 * ══ PONTO DE EXTENSÃO: como um despojo ganha rosto ══
 *
 * `MaterialKind` → ficha do rig. Um material novo em `ItemKind` (engine) deixa
 * ESTA tabela vermelha até ganhar a sua linha — de propósito: um item sem
 * ficha sairia como bolha geométrica em silêncio, e ninguém descobriria antes
 * do jogador. O caminho é o mesmo de `RETRATOS`: escreva
 * `./characters/item<Coisa>.ts`, declare a `FORJA_<COISA>` acima, some uma
 * linha aqui. Nada mais neste arquivo muda.
 */
const FICHAS_DE_ITEM: Readonly<Record<MaterialKind, FichaDeSprite>> = {
  gosma: { modelo: MODELO_GOSMA, forja: FORJA_GOSMA },
  orelhaGoblin: { modelo: MODELO_ORELHA_GOBLIN, forja: FORJA_ORELHA_GOBLIN },
  /* A arma que caiu da mão do goblin — mesmo rig e mesma forja da §14. */
  espadaGoblin: { modelo: MODELO_CIMITARRA, forja: FORJA_CIMITARRA },
  peOgro: { modelo: MODELO_PE_OGRO, forja: FORJA_PE_OGRO },
  clavaOgro: { modelo: MODELO_MARRETA, forja: FORJA_MARRETA }
};

/**
 * Cor do desenho de RESERVA de cada despojo — o que aparece sem atlas (jsdom,
 * Node, qualquer ambiente sem contexto 2D). Nunca deixar de desenhar é a regra
 * que mantém esses ambientes vivos, e a regra vale para item como vale para
 * monstro (§7.3).
 *
 * O critério é o vocabulário GEOMÉTRICO do vanilla, onde cada arquétipo tem uma
 * cor: o despojo herda a de quem o largou (a gosma é roxa como o `linker`
 * geométrico, a orelha é vermelha como o `chaser`), e o que é aço fica na
 * pedra. Não é a cor do rig 3D — no caminho de reserva não existe rig.
 */
const RESERVA_DE_ITEM: Readonly<Record<MaterialKind, ShadeKey>> = {
  gosma: 'linker',
  orelhaGoblin: 'chaser',
  espadaGoblin: 'stone',
  peOgro: 'sentinel',
  clavaOgro: 'stone'
};

/**
 * Linha do atlas em que todo despojo é lido. Um objeto largado no chão não
 * encara ninguém: fixar a direção (2 = a frente, a mesma do texto de XP) é o
 * que garante que o mesmo item desenhe igual em toda partida — e é o oposto do
 * inimigo, cujo `facing` é derivado por observação (§0.2).
 */
const DIR_ITEM = 2;

/**
 * Quantos sprites de uma PILHA de itens no mesmo tile são desenhados. Um abate
 * pode largar dois despojos no mesmo losango e uma sala pode acumular vários —
 * mas o losango tem 64×32 px e a partir do terceiro sprite a pilha vira mancha.
 * Três é o que ainda se conta de relance; o resto está no registro e na bolsa.
 */
const PILHA_MAX = 3;
/** Deslocamento em tela por item extra da pilha, em px a zoom 1. */
const PILHA_DX = 3;
const PILHA_DY = -2;

/**
 * O LEQUE: deslocamento horizontal do item `ordem` de uma pilha, em px de tela.
 * Ímpares para a direita, pares para a esquerda — a pilha abre em leque em vez
 * de escorregar toda para um lado. Vale para os itens no chão E para os pops de
 * coleta: recolher três coisas de um tile mostra três pops, não um só com o
 * triplo da opacidade.
 */
function dxDoLeque(ordem: number, z: number): number {
  if (ordem <= 0) return 0;
  return (ordem % 2 === 1 ? PILHA_DX : -PILHA_DX) * z;
}

/* --- o feedback de COLETA (observação pura: o engine não avisa nada) --- */
/** Duração do brilho no tile e do "pop" do sprite, em segundos. */
const DUR_COLETA = 0.35;
/** Quanto o sprite recolhido sobe no pop, em px a zoom 1. */
const COLETA_SUBIDA = 16;
/** Alpha do brilho âmbar no auge (decai linearmente até zero). */
const COLETA_BRILHO = 0.34;
/**
 * Teto de pops simultâneos. Pisar numa pilha recolhe TUDO de uma vez, então a
 * rajada é do tamanho da pilha; o teto existe para que um bug de observação
 * jamais vire uma lista que cresce sem parar.
 */
const COLETA_MAX = 8;

/**
 * A memória de um item visto no chão — a única coisa que torna a coleta
 * detectável sem o engine avisar nada.
 *
 * O gatilho é o mesmo dos abates (§14): um id que o renderer conhecia SUMIU da
 * lista. Como `pegarItem` remove no mesmo turno em que o jogador entra no tile,
 * a última posição conhecida do item é comparada com o tile ATUAL do jogador —
 * se batem, ele recolheu; se não, o item saiu da lista por outra via (troca de
 * mapa, retomada de save) e nada é celebrado.
 */
interface ItemVisto {
  kind: ItemKind;
  x: number;
  y: number;
  /** Nº do quadro em que este item foi visto pela última vez. */
  carimbo: number;
}

/** Um "pop" de coleta vivo: brilho no tile + sprite subindo e esmaecendo. */
interface ColetaVfx {
  x: number;
  y: number;
  kind: ItemKind;
  t: number;
  /** Posição na rajada daquele tile — abre o mesmo leque da pilha do chão. */
  ordem: number;
}

/* ------------------------------------------------------------------ *
 * OS PONTOS DE PARADA: o MERCADOR e a ESTAÇÃO DE ALQUIMIA
 *
 * `game.mercador` e `game.bancada` são dois `Point | null` do ANDAR, e
 * `game.alquimiaExtras` é uma lista de até DOIS `Point` (ver `Game` em
 * src/engine/types.ts — nenhum deles é valor novo de `Tile`, e é por isso que o
 * passe de pisos não sabe nada deles). Aqui todos são desenhados no PASSE DE
 * ENTIDADES, no tile em que estão, exatamente como um inimigo: mesma âncora
 * (`atlas.ancoraY` sobre o centro do losango), mesma sombra elíptica no chão,
 * mesma modulação pela luz do tile (`quadroModulado`) e a MESMA regra de visão
 * (R31 — fora do FOV, nada).
 *
 * O QUE MUDOU NA FASE 2.1: a `bancada` deixou de ser um móvel só. A oficina
 * virou uma INSTALAÇÃO DE TRÊS TILES — caldeirão, estante e mesa —, um rig por
 * tile (ver o cabeçalho de `./characters/alquimia` para o porquê: um móvel de
 * três tiles de largura invadiria os vizinhos e romperia a ordem do pintor).
 * O campo `game.bancada` continua sendo o CALDEIRÃO, que é o tile de interação;
 * os outros dois saem de `game.alquimiaExtras`, na ordem em que o engine os
 * entrega (ver `PECAS_EXTRAS_ALQUIMIA`).
 *
 * As naturezas em jogo, e o que cada uma implica:
 *
 *   - o MERCADOR é gente. Ele encara quem chega — a direção sai por
 *     OBSERVAÇÃO em `orientarMercador`, no espírito da regra (b) de §0.2 do
 *     BESTIARIO, e mora num campo desta instância. Nenhuma letra no `Game`;
 *   - as TRÊS PEÇAS da alquimia são mobília. Direção FIXA (`DIR_PARADA_FIXA`),
 *     como todo despojo no chão: um caldeirão não vira para ninguém, e fixar a
 *     direção é o que garante que ele desenhe igual em toda partida.
 *
 * O BRILHO DE CONVITE (ver `desenharConvite`) é dos tiles com que se INTERAGE:
 * o mercador e o caldeirão. A estante e a mesa são cenário — não há comando
 * nenhum sobre elas, e um losango piscando embaixo de coisa que não responde
 * ensinaria o jogador a desconfiar do próprio convite.
 * ------------------------------------------------------------------ */

/**
 * Forja do MERCADOR. Constante de módulo pelos dois motivos de sempre (o forge
 * memoiza por (modelo, opções) — objeto novo a cada chamada gera chave nova e
 * reforja tudo; e a cor é propriedade do rig, não do renderizador).
 *
 * `emissivas: CORES_EMISSIVAS_MERCADOR` é `['lenteAmbar']`: as duas lentes
 * redondas do rosto (I1) e a chama da lanterna do mastro (I3) atravessam a
 * modulação acesas (§1.1). É deliberado que sejam a primeira coisa visível
 * dele num corredor escuro — o rig foi desenhado assim —, e é esse par de
 * pontos âmbar que puxa o jogador até o balcão antes de o sprite ser legível.
 *
 * Sem `arcoGolpe`: o mercador não bate em ninguém. As colunas de 'atacando' do
 * atlas existem só porque a forja é genérica, e nunca são lidas.
 */
const FORJA_MERCADOR: OpcoesForja = {
  paleta: PALETA_MERCADOR,
  rampas: RAMPAS_MERCADOR,
  rampaDaCor: RAMPA_DA_COR_MERCADOR,
  repouso: POSE_PARADA_MERCADOR,
  emissivas: CORES_EMISSIVAS_MERCADOR
};

/**
 * As TRÊS forjas da estação de alquimia. Uma constante por peça e não uma só
 * reaproveitada, porque a chave do cache do forge é o par (modelo, opções): as
 * opções são idênticas nas três — mesma paleta, mesmas rampas, mesmas
 * emissivas — e é o MODELO que separa um atlas do outro. Declará-las
 * separadamente é o que mantém a leitura "uma peça, uma ficha" de
 * `FICHAS_DE_PARADA` e o que permite a uma delas divergir amanhã sem mexer nas
 * outras duas.
 *
 * `repouso: POSE_PARADA_ALQUIMIA` é a pose VAZIA que o rig declara: mobília não
 * articula, e a coluna ('parado', 0) devolve o objeto exatamente como foi
 * modelado.
 *
 * `emissivas: CORES_EMISSIVAS_ALQUIMIA` é `['caldoRoxo', 'frascoVerde',
 * 'frascoAzul', 'chama']` — o caldo do caldeirão (I1), os frascos da estante
 * (I2) e a vela da mesa (I3). É o análogo das lentes do mercador: a oficina se
 * anuncia pelo que nela está aceso, e sem isso o conjunto lê como entulho no
 * escuro. A lista é a MESMA nas três peças de propósito: cada rig usa só as
 * cores que tem, e o forge ignora em silêncio as que não aparecem no modelo.
 */
const FORJA_CALDEIRAO: OpcoesForja = {
  paleta: PALETA_ALQUIMIA,
  rampas: RAMPAS_ALQUIMIA,
  rampaDaCor: RAMPA_DA_COR_ALQUIMIA,
  repouso: POSE_PARADA_ALQUIMIA,
  emissivas: CORES_EMISSIVAS_ALQUIMIA
};

const FORJA_ESTANTE: OpcoesForja = {
  paleta: PALETA_ALQUIMIA,
  rampas: RAMPAS_ALQUIMIA,
  rampaDaCor: RAMPA_DA_COR_ALQUIMIA,
  repouso: POSE_PARADA_ALQUIMIA,
  emissivas: CORES_EMISSIVAS_ALQUIMIA
};

const FORJA_MESA_ALQUIMIA: OpcoesForja = {
  paleta: PALETA_ALQUIMIA,
  rampas: RAMPAS_ALQUIMIA,
  rampaDaCor: RAMPA_DA_COR_ALQUIMIA,
  repouso: POSE_PARADA_ALQUIMIA,
  emissivas: CORES_EMISSIVAS_ALQUIMIA
};

/**
 * Os pontos de parada do andar, como chave de tabela e de cache. Um por PEÇA
 * desenhável, e não um por campo do `Game`: a estação de alquimia é um campo só
 * (`bancada`) mais uma lista (`alquimiaExtras`), mas são três atlas distintos e
 * três desenhos de reserva distintos.
 */
type TipoParada = 'mercador' | 'caldeirao' | 'estante' | 'mesa';

/**
 * ══ PONTO DE EXTENSÃO: como um ponto de parada ganha rosto ══
 *
 * A gêmea de `RETRATOS` e de `FICHAS_DE_ITEM`, para os pontos de parada. Uma
 * peça nova (um altar, um poço) entra com um arquivo em `./characters/`, uma
 * `FORJA_<COISA>` acima, um membro em `TipoParada` e UMA linha aqui — mais o
 * campo correspondente no `Game`, que é decisão do engine e não deste arquivo.
 */
const FICHAS_DE_PARADA: Readonly<Record<TipoParada, FichaDeSprite>> = {
  mercador: { modelo: MODELO_MERCADOR, forja: FORJA_MERCADOR },
  caldeirao: { modelo: MODELO_CALDEIRAO, forja: FORJA_CALDEIRAO },
  estante: { modelo: MODELO_ESTANTE, forja: FORJA_ESTANTE },
  mesa: { modelo: MODELO_MESA_ALQUIMIA, forja: FORJA_MESA_ALQUIMIA }
};

/**
 * ══ O MAPEAMENTO extras → peça ══
 *
 * `game.alquimiaExtras[k]` é desenhado com `PECAS_EXTRAS_ALQUIMIA[k]`: o
 * PRIMEIRO extra é a ESTANTE, o SEGUNDO é a MESA. Posicional, e não por nome,
 * porque o engine entrega pontos e não papéis — ele reserva território, não
 * escolhe mobília (ver `Game.alquimiaExtras` em src/engine/types.ts).
 *
 * A ordem tem uma razão de leitura: a estante é a peça ALTA (7u) e a mesa é a
 * BAIXA (3,4u). Quando o cômodo só comporta um extra, sobra a peça que mais
 * acrescenta silhueta ao conjunto — a estação encolhe perdendo a mesa primeiro,
 * depois a estante, e o caldeirão nunca cai (é ele o tile de interação).
 *
 * Lista mais curta que esta tabela é DEGRADAÇÃO LEGÍTIMA, não erro: desenha-se
 * o que houver. Lista mais longa (que o engine não produz) tem os excedentes
 * ignorados pelo `Math.min` de `draw` — nunca um `undefined` virando peça.
 */
const PECAS_EXTRAS_ALQUIMIA: readonly TipoParada[] = ['estante', 'mesa'];

/**
 * Linha do atlas das peças de alquimia — a mesma direção fixa dos despojos
 * (`DIR_ITEM`), pelo mesmo motivo: objeto não encara ninguém.
 */
const DIR_PARADA_FIXA = DIR_ITEM;

/**
 * Meia-largura e meia-altura da sombra elíptica de cada peça, em px de tela a
 * zoom 1. Elas diferem porque as SILHUETAS diferem: o caldeirão é um bojo largo
 * e baixo, a estante é alta e rasa (a sombra de coisa encostada é curta), a
 * mesa é larga e baixa, e a figura encapuzada do mercador não ocupa o tile
 * inteiro. Sombra pequena sob peça larga lê como objeto flutuando; sombra larga
 * sob a estante a faz parecer tombada.
 */
const SOMBRA_PARADA: Readonly<Record<TipoParada, readonly [number, number]>> = {
  mercador: [11, 4.6],
  caldeirao: [13, 5.4],
  estante: [12, 4.4],
  mesa: [12.5, 5.0]
};

/**
 * Até onde o mercador PERCEBE o jogador, em Chebyshev. Quatro tiles é a
 * distância em que ele já cabe na tela junto do herói — mais que isso e a
 * cabeça girando ao longe vira ruído; menos e ele só se vira quando já não
 * importa. Fora do raio ele mantém a última direção (regra (c) de §0.2).
 */
const MERCADOR_ATENCAO = 4;

/**
 * O BRILHO DE CONVITE — o pulso âmbar no losango dos tiles COM INTERAÇÃO (o
 * mercador e o caldeirão; a estante e a mesa não respondem a nada e não
 * piscam).
 *
 * Existe por um problema de desenho de jogo, não de estética: desde a fase 2.1
 * o mercador e a estação nascem na SALA INICIAL, a 2–4 tiles do herói, e mesmo
 * assim nenhum dos dois grita. Um tile que pulsa devagar é o convite que faz o
 * jogador atravessar a sala para ver o que é — a mesma frase visual do realce
 * sob o cursor e do clarão da coleta ("olhe para este tile"), no mesmo âmbar.
 *
 * O pulso APAGA quando o jogador chega ao tile: o convite já foi aceito, e
 * manter a luz acesa embaixo dos próprios pés só disputaria atenção com o
 * painel de troca que acabou de abrir.
 *
 * Relógio: `this.t`, o relógio visual da instância, somado por `dt` — o mesmo
 * que move o bob dos itens e a respiração. Nada disto toca o `Game` (R54).
 */
const CONVITE_PERIODO = 2.4;
/** Alfa do losango no vale e no pico do pulso. Discreto por contrato. */
const CONVITE_ALFA_MIN = 0.05;
const CONVITE_ALFA_MAX = 0.16;

/* ------------------------------------------------------------------ *
 * O TERRENO (src/render/tilesets/) — o chão como SPRITE forjado
 *
 * O piso, a parede e os adereços de um andar são rigs 3D como o Guerreiro é um
 * rig 3D, forjados pelo MESMO `spriteForge` e colados com a MESMA âncora (o
 * centro do losango do tile). Quem sabe que o nível 1 é grama, terra e areia é
 * `./tilesets/nivel1.ts`; este arquivo pergunta `tilesetDoNivel(depth)` e
 * desenha o que vier — é a disciplina de `RETRATOS`, aplicada ao chão.
 *
 * ═══ AS QUATRO DECISÕES DESTA SEÇÃO ═══
 *
 * 1. AS OPÇÕES DE FORJA SÃO UMA CONSTANTE DERIVADA, uma por tileset
 *    (`forjaDoTileset`). O forge memoiza por (modelo, opções) e a chave das
 *    opções é uma serialização do objeto: montar `{ paleta, rampas, … }` a cada
 *    chamada geraria chave nova e reforjaria o andar inteiro 60 vezes por
 *    segundo. As forjas do elenco resolvem isso sendo constantes de módulo
 *    escritas à mão; aqui não dá — o material é propriedade do TILESET, que só
 *    se conhece em tempo de desenho —, então a constante é memoizada por objeto
 *    de tileset. É a mesma regra, pelo mesmo motivo.
 *
 * 2. O CAMINHO GEOMÉTRICO NÃO FOI APAGADO. `drawFloor` e `drawWall` tentam o
 *    sprite e caem no losango/prisma de sempre quando não há atlas (jsdom, Node,
 *    qualquer ambiente sem contexto 2D). É a §7.3 do BESTIARIO valendo para o
 *    chão: nunca deixar de desenhar. test/render.test.ts exercita os dois lados.
 *
 * 3. NÃO HÁ ÁGUA NESTA RODADA — e é decisão, não esquecimento. O tileset entrega
 *    `agua` (o rig existe, calibrado e pronto), mas o ENGINE não tem tile de
 *    água: a única fonte de variação por tile disponível aqui é `map.decor`, um
 *    hash POR TILE (ver `computeDecor` em src/engine/mapgen.ts) sem nenhuma
 *    correlação espacial. Qualquer predicado sobre ele — `(decor & 7) === 0`
 *    inclusive — produz sal-e-pimenta, nunca uma poça: poça é uma REGIÃO
 *    conexa, e um tile de água isolado no meio de um corredor de grama não lê
 *    como água, lê como erro de tileset. Some-se a isso que o topo da água
 *    afunda 1,2u (~3px) enquanto o herói continua assentando em z = 0, e que
 *    água sugere ao jogador uma regra de travessia que o engine não tem. Um
 *    tileset correto sem água vale mais do que poças aleatórias.
 *    O dia em que a água entrar, ela entra pelo lugar certo: uma região marcada
 *    no MAPA (flood fill no mapgen, um valor de `Tile` ou um bitmap ao lado do
 *    decor), e aqui vira uma linha — `agua` já está no contrato do tileset.
 *
 * 4. O CUSTO. O atlas do forge é 8 direções × 9 poses = 72 quadros, e o terreno
 *    lê exatamente UM deles: a coluna ('parado', 0) na linha `DIR_TERRENO`. Os
 *    71 restantes são desperdício assumido — o forge não expõe canal para forjar
 *    menos (nem `DIRECOES` nem `COLUNAS` são opção), e criar um seria mexer no
 *    módulo que serve a todo o elenco para poupar o que se paga UMA vez por
 *    andar. O que impede o desperdício de virar preço é o cache: um atlas por
 *    (nível, papel, índice), memoizado sob demanda, mais a memoização do próprio
 *    forge por (modelo, opções) — o nível 1 declara 8 entradas de piso mas só 3
 *    modelos distintos, e as 5 repetições de grama não custam uma segunda forja.
 * ------------------------------------------------------------------ */

/**
 * Opções de forja de um tileset. Ver a decisão 1 acima: uma por objeto de
 * tileset, montada na primeira vez e nunca mais.
 *
 * `WeakMap` e não `Map` porque a chave é o próprio objeto do tileset: um
 * registro novo (o dia do nível 2) não deixa entrada órfã para trás.
 */
const FORJAS_DE_TILESET = new WeakMap<Tileset, OpcoesForja>();

function forjaDoTileset(tileset: Tileset): OpcoesForja {
  const pronta = FORJAS_DE_TILESET.get(tileset);
  if (pronta) return pronta;
  /* Os cinco campos de material do tileset, repassados inteiros — o renderer
   * não escolhe cor de terreno, como não escolhe cor de monstro. `emissivas` é
   * o que faz a flor laranja do nível 1 atravessar acesa a modulação de luz
   * (§1.1 do BESTIARIO); lista vazia custa zero no forge. */
  const nova: OpcoesForja = {
    paleta: tileset.paleta,
    rampas: tileset.rampas,
    rampaDaCor: tileset.rampaDaCor,
    repouso: tileset.repouso,
    emissivas: tileset.emissivas
  };
  FORJAS_DE_TILESET.set(tileset, nova);
  return nova;
}

/**
 * Linha do atlas em que TODO bloco de terreno é lido — a mesma direção fixa dos
 * despojos (`DIR_ITEM`), e aqui ela é mais que convenção: `giroParaFrente(0, 1)`
 * é giro ZERO, ou seja, o bloco sai projetado exatamente como
 * `./tilesets/nivel1.ts` o modelou e calibrou (5·S = `CONFIG.TW`). Qualquer
 * outra linha giraria o quadrado do tile por dentro do losango e desalinharia os
 * tufos que transbordam a quina.
 */
const DIR_TERRENO = DIR_ITEM;

/**
 * Um em cada quantos tiles de piso recebe adereço.
 *
 * Seis é o número que enche o chão sem virar mato: a referência do andar tem
 * tufo/pedra/flor como PONTUAÇÃO do terreno, não como cobertura. Abaixo de ~4 o
 * jogador perde a leitura do que é cenário e do que é coisa com a qual se
 * interage (o despojo no chão é do mesmo tamanho); acima de ~10 o andar volta a
 * parecer um tabuleiro vazio.
 */
const ADERECO_EM_CADA = 6;

/* ------------------------------------------------------------------ *
 * O BRILHO DA POÇA (ver `desenharBrilhoDaAgua`)
 *
 * A água é o único terreno que PARECE piso e não é: `map.tiles` a mantém como
 * `Tile.Floor` e quem a bloqueia é o bitmap `map.agua` (src/engine/mapgen.ts).
 * O rig já a afunda 6 px e põe espuma na beirada; estes quatro números são a
 * parte que se mexe, e é ela que fecha a leitura de líquido.
 * ------------------------------------------------------------------ */

/** Ciclos por segundo do vaivém do reflexo. Devagar: é lâmina parada, não onda. */
const BRILHO_AGUA_VELOCIDADE = 0.16;
/** Curso do reflexo, em fração da meia-diagonal do tile. */
const BRILHO_AGUA_CURSO = 0.34;
/** Meia-largura do losango do reflexo, em fração da meia-diagonal do tile. */
const BRILHO_AGUA_MEIA_LARGURA = 0.3;
/** Alfa nas pontas do curso e no meio dele. Discreto: é reflexo, não holofote. */
const BRILHO_AGUA_ALFA_MIN = 0.05;
const BRILHO_AGUA_ALFA_MAX = 0.3;
/** Fração do brilho que sobrevive no degrau de luz mais escuro do FOV. */
const BRILHO_AGUA_PISO = 0.35;

/**
 * O sorteio do adereço de um tile: DETERMINÍSTICO, sem estado e sem relógio —
 * `Math.random` é proibido nesta camada (tools/check-boundaries.mjs reprova) e
 * seria pior que proibido: o tufo mudaria de lugar a cada quadro.
 *
 * A mistura é sobre (x, y) E sobre os bits ALTOS do decor do tile, por duas
 * razões distintas:
 *
 *   - (x, y) sozinho daria o MESMO mapa de adereços em toda semente e em todo
 *     andar (o hash não conhece a partida). `decor` é derivado da semente do
 *     mapa (`computeDecor`, src/engine/mapgen.ts), então entra como tempero de
 *     partida sem que este arquivo precise de um canal novo no engine;
 *   - os bits BAIXOS (`decor & 7`) são o bucket que já escolhe a variante de
 *     piso. Reaproveitá-los amarraria o adereço ao chão — flores só na areia,
 *     pedra só na terra — e o padrão apareceria a olho nu. Os bits 3..7 estão
 *     livres, e é deles que este sorteio vive.
 *
 * Avalanche à la Wang/xxhash: um bit de entrada mexe em todos os de saída, que
 * é o que permite tirar DUAS decisões independentes do mesmo número (o `% 6` da
 * frequência sai dos bits baixos; a escolha da peça, dos bits 8 em diante).
 */
function sorteioDeAdereco(x: number, y: number, decor: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = (h ^ Math.imul((decor >>> 3) + 1, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2654435761);
  return (h ^ (h >>> 13)) >>> 0;
}

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
  /** 0/1 — qual metade do ciclo de 4 quadros o próximo passo usa (perna alternada). */
  pe: number;
}

/**
 * Um abate registrado, puramente visual (docs/BESTIARIO.md §14). O gatilho é
 * OBSERVAÇÃO: um id que o renderer conhecia some de `game.enemies` dentro do
 * mesmo mapa — e a única via de saída é `removerInimigo`, chamada só por
 * `atacarInimigo` quando o golpe do jogador mata. Nenhum campo novo em
 * `Enemy`, em `snapshot()`, no save ou no oracle.
 *
 * `t` avança por `dt` em `update` e para na duração da sequência: a partir
 * daí o desenho é o estado final — o RASTRO persistente do abate, que fica
 * no tile até a troca de mapa. Posição e `facing` são os últimos conhecidos
 * do `Vfx` da entidade (o corpo cai olhando para onde olhava).
 */
interface MorteInimigo {
  id: number;
  kind: ArchetypeKey;
  x: number;
  y: number;
  facing: number;
  t: number;
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
  /** Tile.Void do mapgen (fase 2.3): a beira do penhasco. −1 quando o mapa não tem. */
  private readonly T_VOID: number;
  /**
   * Os índices dos tiles de água JUNTO ao vazio, recalculados uma vez por mapa:
   * a água não se move, e varrer o mapa inteiro a cada frame é desperdício.
   */
  private cachoeirasDoMapa: { mapa: unknown; indices: number[] } | null = null;
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

  /* --- os abates do bestiário (docs/BESTIARIO.md §14) --- */
  /**
   * Abates registrados, por id da entidade. Vivem até a troca de mapa: o
   * rastro é persistente por contrato, não por esquecimento.
   */
  private readonly mortes = new Map<number, MorteInimigo>();
  /**
   * Índice tile → abates, preenchido no REGISTRO (evento raro — alocação fora
   * do laço quente) e lido no passe das entidades por índice de tile, como
   * `entAt`/`itemAt`. Dois abates no mesmo tile empilham na ordem de registro.
   */
  private readonly mortesPorTile = new Map<number, MorteInimigo[]>();
  /**
   * Ids vistos no `update` anterior e neste, em double-buffer: os conjuntos se
   * TROCAM a cada quadro em vez de se alocar — a diferença entre eles é o
   * gatilho do abate, e ela não pode custar um `Set` novo por frame.
   */
  private vivosA = new Set<number>();
  private vivosB = new Set<number>();
  /** O `kind` de cada id vivo — a ficha de identidade consultada na hora do abate. */
  private readonly kindPorId = new Map<number, ArchetypeKey>();
  /** Largura do mapa corrente, para o índice de tile dos abates. Vinda de `syncRun`. */
  private mapW = 0;
  /**
   * Atlases secundários da morte dos monstros (agachado/caído/arma/estágios),
   * memoizados sob demanda no padrão de `atlasMorte`: chave `kind:qual`,
   * `undefined` = nunca tentado, `null` guardado = já tentou e não há canvas.
   */
  private readonly atlasMorteInimigo = new Map<string, AtlasPersonagem | null>();

  /* --- os despojos no chão (ver `FICHAS_DE_ITEM`) --- */
  /**
   * Atlas por MATERIAL, forjado sob demanda no primeiro desenho daquele
   * despojo. Mesmo protocolo de `atlasInimigo`: `undefined` = nunca tentado,
   * `null` GUARDADO = tentou e não há canvas — a forja nunca vira retentativa
   * por quadro. A poção não entra aqui: ela não tem atlas, tem geometria.
   */
  private readonly atlasItem = new Map<MaterialKind, AtlasPersonagem | null>();
  /**
   * Memória dos itens vistos no chão, por id — a base da detecção de coleta.
   * As entradas são MUTADAS no lugar (nada é alocado por quadro depois do
   * primeiro) e some quem não recebe o carimbo do quadro corrente.
   */
  private readonly itensVistos = new Map<number, ItemVisto>();
  /** Contador de quadros que carimba `itensVistos`. Só cresce; só é comparado. */
  private carimboItens = 0;
  /** Pops de coleta vivos. Poucos e de vida curtíssima — varridos sem índice. */
  private readonly coletas: ColetaVfx[] = [];

  /* --- o TERRENO (ver a seção `O TERRENO`, acima) --- */
  /**
   * O tileset do andar corrente. Trocado só em `sincronizarTileset`, que roda
   * na troca de mapa — e não por quadro: perguntar `tilesetDoNivel(depth)` no
   * laço de pisos seria uma busca em tabela por tile para responder sempre a
   * mesma coisa.
   */
  private tileset: Tileset = tilesetDoNivel(1);
  /** Nível cujo tileset está hasteado acima (−1 = nenhum ainda). */
  private nivelTileset = -1;
  /**
   * Atlas do terreno por (nível, papel, índice) — `1:piso:3`, `1:parede`,
   * `1:adereco:2`. Mesmo protocolo de `atlasInimigo` e de `atlasItem`:
   * `undefined` = nunca tentado, `null` GUARDADO = tentou e não há canvas
   * (jsdom) — a forja jamais vira retentativa por quadro.
   *
   * A chave carrega o NÍVEL porque o cache sobrevive à descida: voltar ao andar
   * 1 não deve reforjar a grama, e o piso 0 do nível 2 não pode ser servido no
   * lugar do piso 0 do nível 1.
   */
  private readonly atlasTerreno = new Map<string, AtlasPersonagem | null>();
  /**
   * As chaves de `atlasTerreno` do andar corrente, montadas UMA vez por nível.
   *
   * Existem por uma razão de laço quente: o passe de pisos roda por tile
   * VISÍVEL e por quadro (centenas de vezes a 60 fps), e concatenar
   * `nivel + ':piso:' + k` ali dentro seria alocar uma string por tile por
   * quadro — contra a invariante deste arquivo ("zero alocação de objeto no
   * laço quente"). Com as chaves prontas, o custo por tile é um `Map.get`.
   */
  private chavesPiso: readonly string[] = [];
  private chavesAdereco: readonly string[] = [];
  private chaveParede = '';
  /** Chave de cache do rig de água do andar (vazia quando o tileset não tem). */
  private chaveAgua = '';

  /* --- os pontos de parada (ver `FICHAS_DE_PARADA`) --- */
  /**
   * Atlas do mercador e das TRÊS peças da estação de alquimia (caldeirão,
   * estante e mesa), forjados SOB DEMANDA no primeiro desenho de cada um.
   * Mesmo protocolo de `atlasInimigo` e `atlasItem`: `undefined` = nunca
   * tentado, `null` GUARDADO = tentou e não há canvas (jsdom) — a forja jamais
   * vira retentativa por quadro. São quatro entradas no máximo, uma por membro
   * de `TipoParada`, e cada peça paga a sua forja só se aparecer na tela.
   *
   * Sobrevive à troca de mapa junto com os atlases da morte: o andar novo tem
   * outra estação em outro lugar, mas são os MESMOS rigs, e o forge os memoiza.
   */
  private readonly atlasParada = new Map<TipoParada, AtlasPersonagem | null>();
  /**
   * Para onde o MERCADOR olha, 0..7 na ordem de `DIRS8`. Mora aqui pela mesma
   * razão do `facing` dos inimigos (ver `Vfx`): dá para derivá-lo de graça por
   * observação, e um campo em `Game.mercador` entraria em `snapshot()`, no save
   * e no oracle para não dizer nada que o render não saiba sozinho.
   *
   * Um número, e não um `Vfx`: o mercador não desliza, não pisca de dano e não
   * quica — ele está POSTO. A única coisa dele que muda na tela é para onde
   * olha.
   */
  private facingMercador = DEFAULT_FACING;
  /**
   * `prefers-reduced-motion` amostrado na troca de partida/andar (`syncRun`), e
   * não por quadro: o pulso do convite é contínuo, e consultar `matchMedia`
   * 60 vezes por segundo para saber se um losango deve piscar seria caro e
   * ridículo. A preferência que muda com a página aberta é colhida no próximo
   * andar — que é a mesma granularidade das cinemáticas.
   */
  private movimentoReduzido = false;

  /* --- o texto de XP flutuante (docs/BESTIARIO.md §16) --- */
  /** Flutuantes vivos. Poucos e de vida curta — varridos por quadro sem índice. */
  private readonly flutuantes: FlutuanteXp[] = [];
  /** Atlas do texto por VALOR (o conjunto é fechado: 25/50/100/200/400). */
  private readonly atlasXp = new Map<number, AtlasPersonagem | null>();
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
    this.T_VOID = (C.TILE as { VOID?: number }).VOID ?? -1;
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
    // O mercador acompanha quem chega. Observação pura, como tudo aqui.
    this.orientarMercador(game);

    const en = game.enemies;
    if (en) {
      // §0.2 — as regras de orientação falam em TURNO ("mudou de tile neste
      // turno"), não em quadro. `game.turn` é a única leitura nova, e é leitura:
      // sem ela a regra (b) reavaliaria a cada quadro e sobrescreveria a (a) no
      // quadro seguinte ao passo, invertendo a precedência que o contrato fixa.
      const turno = typeof game.turn === 'number' ? game.turn : 0;
      const novoTurno = turno !== this.turnoOrientado;
      // §14 — o conjunto deste quadro, no conjunto RESERVA (double-buffer: a
      // diferença entre os dois não pode custar uma alocação por frame).
      const vistos = this.vivosB;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (!e) continue;
        vistos.add(e.id);
        this.kindPorId.set(e.id, e.kind);
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
      // §14 — quem estava no quadro anterior e não está neste foi abatido.
      this.registrarAbates(vistos);
      this.vivosB = this.vivosA;
      this.vivosA = vistos;
      this.vivosB.clear();
      this.turnoOrientado = turno;
    }

    // §14 — os relógios dos abates avançam SEMPRE, tile visto ou não: a morte
    // não congela quando o jogador vira o corredor. O estado final (o rastro)
    // é desenhado sob a mesma regra de visão dos itens (R31 — só dentro do FOV).
    for (const m of this.mortes.values()) {
      const dur = m.kind === 'chaser' ? DUR_MORTE_GOBLIN
        : m.kind === 'sentinel' ? DUR_MORTE_OGRO
          : DUR_MORTE_SLIME;
      if (m.t < dur) {
        m.t += d;
        if (m.t > dur) m.t = dur;
      }
    }

    // §16 — a fila de abates é do RENDER: o engine escreve no golpe, aqui se
    // drena. Sem quadro (testes, oracle headless) ela acumula até o teto de
    // lá — aqui nunca passa de uma rajada de abates por frame.
    const filaAbates = game.abatesRecentes;
    if (filaAbates && filaAbates.length > 0) {
      for (let i = 0; i < filaAbates.length; i++) {
        const a = filaAbates[i];
        if (a && a.xp > 0) {
          this.flutuantes.push({ x: a.x, y: a.y, xp: a.xp, t: 0 });
        }
      }
      filaAbates.length = 0;
    }
    for (let i = this.flutuantes.length - 1; i >= 0; i--) {
      const f = this.flutuantes[i];
      f.t += d;
      if (f.t >= DUR_FLUTUA_XP) this.flutuantes.splice(i, 1);
    }

    // Os despojos: quem sumiu do chão sob os pés do jogador foi recolhido.
    // OBSERVAÇÃO pura — o engine não abre canal nenhum para avisar (R54).
    this.observarColeta(game);
    for (let i = this.coletas.length - 1; i >= 0; i--) {
      const c = this.coletas[i];
      c.t += d;
      if (c.t >= DUR_COLETA) this.coletas.splice(i, 1);
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

  /**
   * Para onde o MERCADOR olha — a regra (b) de §0.2 do BESTIARIO aplicada a
   * quem nunca muda de tile:
   *
   *   (a) o jogador está no raio de atenção e NÃO em cima dele → encara-o;
   *   (b) o jogador está em cima dele → mantém o que já olhava, que é
   *       exatamente a direção de onde ele veio (delta (0,0) não é direção);
   *   (c) longe demais, ou não há mercador → mantém o último;
   *   (d) andar novo → sul (`DEFAULT_FACING`, zerado em `syncRun`).
   *
   * Não existe regra (a) de MOVIMENTO aqui, porque não existe movimento: o
   * ponto de parada é do ANDAR e fica onde nasceu. E não existe escrita: `game`
   * é lido, ponto — o `facing` mora no campo desta instância (R54).
   *
   * `Math.sign` no delta pela mesma razão de `orientarInimigo`: um salto de
   * dois tiles (teclado em repetição, dois turnos entre dois quadros) daria
   * `dirIndex(2, 0) === −1` e o mercador olharia para o lugar errado.
   */
  private orientarMercador(game: Game): void {
    const m: Point | null = game.mercador;
    if (!m) return;
    const p = game.player;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    if (dx === 0 && dy === 0) return;               // (b)
    if (cheb(m.x, m.y, p.x, p.y) > MERCADOR_ATENCAO) return; // (c)
    const i = dirIndex(Math.sign(dx), Math.sign(dy));
    if (i >= 0) this.facingMercador = i;            // (a)
  }

  /**
   * §14 — o gatilho do abate, por OBSERVAÇÃO: todo id presente no quadro
   * anterior e ausente deste dentro do mesmo mapa foi morto pelo jogador (a
   * única via de saída de `game.enemies` é `removerInimigo`, chamada só de
   * `atacarInimigo` no golpe fatal — ver src/engine/game.ts). Não há outra:
   * `syncRun` zera os conjuntos na troca de mapa, então descida e retomada de
   * save não geram abates fantasmas.
   *
   * O registro captura o último `Vfx` conhecido (tile, facing) e o `kind` da
   * ficha de identidade. `prefers-reduced-motion` pula a sequência direto
   * para o rastro, como `pularCinematica` faz com a morte do Guerreiro.
   */
  private registrarAbates(vistos: ReadonlySet<number>): void {
    for (const id of this.vivosA) {
      if (vistos.has(id)) continue;
      const v = this.vfx.get('e' + id);
      const kind = this.kindPorId.get(id);
      this.kindPorId.delete(id);
      if (!v || !kind) continue;
      const m: MorteInimigo = { id: id, kind: kind, x: v.x, y: v.y, facing: v.facing, t: 0 };
      if (prefereReduzirMovimento()) {
        m.t = kind === 'chaser' ? DUR_MORTE_GOBLIN : kind === 'sentinel' ? DUR_MORTE_OGRO : DUR_MORTE_SLIME;
      }
      this.mortes.set(id, m);
      const ti = m.y * this.mapW + m.x;
      const lista = this.mortesPorTile.get(ti);
      if (lista) lista.push(m);
      else this.mortesPorTile.set(ti, [m]);
    }
  }

  /**
   * O gatilho da COLETA, pelo mesmo método dos abates: marca-e-varre sobre
   * `game.items`. Todo item que estava na lista no quadro anterior, sumiu neste
   * e cuja última posição conhecida é o tile ATUAL do jogador foi recolhido —
   * `pegarItem` (src/engine/game.ts) esvazia o tile no mesmo turno em que o
   * jogador entra nele, então essa igualdade é a assinatura da coleta.
   *
   * Por que a comparação NÃO é "sumiu do tile onde o jogador está parado": no
   * quadro anterior à coleta o jogador ainda estava no tile de origem, e um
   * observador preso ao tile dele jamais veria os itens do destino. A memória
   * é da LISTA inteira, e é a última posição do item que fecha a conta.
   *
   * As outras saídas da lista (troca de mapa, retomada de save) não celebram
   * nada: `syncRun` limpa a memória antes que este método rode, então o primeiro
   * quadro de um andar novo apenas cadastra o que existe.
   *
   * Custo: um `Map.get` por item por quadro (dezenas), zero alocação depois do
   * primeiro cadastro — as entradas são mutadas no lugar.
   */
  private observarColeta(game: Game): void {
    const memoria = this.itensVistos;
    const p = game.player;
    const itens = game.items;
    const carimbo = ++this.carimboItens;

    if (itens) {
      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        if (!it) continue;
        const visto = memoria.get(it.id);
        if (visto) {
          visto.kind = it.kind;
          visto.x = it.x;
          visto.y = it.y;
          visto.carimbo = carimbo;
        } else {
          memoria.set(it.id, { kind: it.kind, x: it.x, y: it.y, carimbo: carimbo });
        }
      }
    }

    for (const [id, v] of memoria) {
      if (v.carimbo === carimbo) continue;
      // Apagar durante a iteração de um Map é seguro por especificação.
      memoria.delete(id);
      if (v.x !== p.x || v.y !== p.y) continue;
      if (this.coletas.length >= COLETA_MAX) continue;
      // Quantos pops já vivem neste tile: pisar numa pilha recolhe tudo de uma
      // vez, e sem o leque os três sairiam exatamente um sobre o outro.
      let ordem = 0;
      for (let i = 0; i < this.coletas.length; i++) {
        const outra = this.coletas[i];
        if (outra.x === v.x && outra.y === v.y) ordem++;
      }
      const c: ColetaVfx = { x: v.x, y: v.y, kind: v.kind, t: 0, ordem: ordem };
      // `prefers-reduced-motion` fica só com o brilho: o pop já nasce no fim
      // da subida, como a cinemática de morte nasce no rastro.
      if (prefereReduzirMovimento()) c.t = DUR_COLETA * 0.5;
      this.coletas.push(c);
    }
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
    /* Os pontos de parada do andar, hasteados FORA do laço: eles são
     * consultados uma vez por tile visível, e um `game.mercador` por tile seria
     * uma leitura de propriedade no laço quente para responder sempre a mesma
     * coisa. `null` (mapa sem tile elegível) simplesmente nunca casa. */
    const paradaMerc = game.mercador;
    /* `game.bancada` é o CALDEIRÃO — o tile de interação da estação (o nome do
     * campo é anterior à instalação de três tiles; ver `Game` em types.ts). */
    const paradaCald = game.bancada;
    /* Os extras da estação (estante e mesa). A lista pode ser curta ou vazia
     * num cômodo apertado: `quantos` é o que faz "menos extras" desenhar menos
     * peças em vez de quebrar. Save antigo pode nem trazer o campo — daí o
     * teste de array antes de perguntar o comprimento. */
    const extrasAlq = game.alquimiaExtras;
    const quantosExtras = extrasAlq
      ? Math.min(extrasAlq.length, PECAS_EXTRAS_ALQUIMIA.length)
      : 0;

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
        // O VAZIO não desenha nada: é a beira do penhasco, e o que fica embaixo
        // é o fundo escuro do canvas — nenhum piso, parede ou adereço. A
        // cachoeira que escorre para dentro dele é desenhada pela parede/piso
        // da borda, nunca por ele.
        if (t === this.T_VOID) continue;
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
        const agua = !!(game.map.agua && game.map.agua[i]);
        this.drawFloor(ctx, sx, sy, hw, hh, z, bucket, alt, seen, lvl, agua);
        if (x > 0 && y > 0 && tiles[i - w - 1] === this.T_WALL) {
          this.drawWallShadow(ctx, sx, sy, hw, hh, seen);
        }
        if (t === this.T_STAIRS) this.drawStairs(ctx, sx, sy, hw, hh, seen, lvl);
        else if (t === this.T_DOOR) this.drawDoor(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
        if (agua) {
          /* A poça: o BRILHO que anda por cima dela (é o movimento que faz a
           * superfície ler como líquido, e é o que avisa que ali não se pisa)
           * e, onde ela encosta no vazio ou no limite do mapa a sul/leste, a
           * CACHOEIRA escorrendo pela borda. Efeito de render puro — nada no
           * Game, e nada de `Math.random`: a fase sai de um hash de (x, y). */
          this.desenharBrilhoDaAgua(ctx, x, y, sx, sy, hw, hh, z, seen, lvl);
        } else if (t !== this.T_STAIRS && t !== this.T_DOOR) {
          /* O adereço do tileset, no fim do passe de PISOS: depois do bloco (ele
           * fica em cima do chão) e da sombra da parede (que é decalque de
           * chão), e antes das entidades desta mesma antidiagonal — que só são
           * desenhadas no terceiro laço. É o que garante que o herói pise SOBRE
           * o tufo, e não atrás dele.
           *
           * As TRÊS exclusões são explícitas, e não mais um `else` pendurado no
           * encadeamento de escada/porta: quando a cachoeira entrou no meio, o
           * `else` passou a casar com o `if (agua)` e a escada voltou a poder
           * receber seixo — o glifo da única saída do andar coberto por um
           * adereço, calado. Escada e porta já desenham no losango inteiro;
           * água não tem onde plantar mato. O resto das exclusões (quem está de
           * pé no tile) é de `desenharAdereco`. */
          this.desenharAdereco(ctx, game, x, y, i, sx, sy + hh, z, decor ? decor[i] : 0, lvl);
        }
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
          /* A transparência do canto frontal, intacta desde o losango: o
           * `globalAlpha` do contexto vale para o `drawImage` do sprite
           * exatamente como valia para o `fill()` do prisma — é o alfa do
           * COMPOSITOR, não uma propriedade do caminho. Os dois desenhos de
           * `drawWall` (sprite e reserva geométrica) o respeitam sem saber que
           * ele existe. */
          ctx.save();
          ctx.globalAlpha = wa;
          this.drawWall(ctx, sx, sy, hw, hh, wh, z, bucket, seen, lvl);
          ctx.restore();
        } else {
          this.drawWall(ctx, sx, sy, hw, hh, wh, z, bucket, seen, lvl);
        }
      }

      /* --- entidades da antidiagonal (só dentro do FOV — R31) ---
       *
       * ═══ A ORDEM DO PINTOR E O QUE ELA CUSTA (medido) ═══
       *
       * Este é o terceiro passe da faixa `s`, e o passe de PISOS da faixa `s+1`
       * roda depois dele. Ou seja: o chão dos tiles da frente é desenhado por
       * cima das entidades daqui. Isso é correto — os tiles da frente estão
       * mais perto da câmera —, mas só continua inofensivo enquanto o bloco de
       * terreno não subir acima do plano do chão. Os números, medidos sobre os
       * rigs de `./tilesets/nivel1.ts` em px de tela a zoom 1:
       *
       *   · o bloco de piso sobe EXATAMENTE 16,0 px acima do centro do próprio
       *     losango — o vértice norte dele, nem um pixel além. As lâminas de
       *     grama não estouram esse teto porque estão todas nas bordas +Y e +X,
       *     as que a projeção mostra À FRENTE do próprio tile; as do miolo são
       *     baixas de propósito. test/render.test.ts trava esse limite;
       *   · sobre a COLUNA de uma entidade (faixa de ±12 px em volta da âncora
       *     dela), o chão dos vizinhos da frente começa em +10,0 px abaixo da
       *     âncora — (x+1,y) e (x,y+1) — e em +16,0 px — (x+1,y+1). Não é
       *     arbitrário: é onde o plano z = 0 daqueles tiles realmente passa
       *     naquela coluna de tela;
       *   · o elenco desce, abaixo da própria âncora: guerreiro 9,4 px · goblin
       *     5,1 · mercador 6,1 · slime 13,6 · ogro 19,6.
       *
       * Conclusão: nenhum pixel de entidade com z >= 0 pode ser coberto por
       * piso vizinho — a conta não permite. O que É coberto é exatamente o que
       * o rig modelou ABAIXO do plano do chão, e aí a oclusão está certa: aquilo
       * está enterrado. Sobram 3,6 px no slime e 9,6 px no ogro, e é essa a
       * origem do "sprite por baixo do chão" — não a ordem, e não as lâminas.
       * O conserto é de RIG (subir o corpo do bicho para z >= 0), mora em
       * `./characters/`, e está registrado aqui com o número para quem for
       * fazê-lo não precisar medir de novo.
       *
       * A PAREDE é outro assunto: ela cobre até 26 px ACIMA da âncora de quem
       * está atrás, e é para isso que existe `ALFA_PAREDE_OCULTA` — nos três
       * tiles do canto frontal do herói, que são exatamente os três medidos
       * acima. */
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
        // §14 — os abates do tile: decalques (sangue/geleia) e corpos PRIMEIRO,
        // para que qualquer coisa viva (item, inimigo, o próprio jogador
        // pisando no rastro) seja desenhada POR CIMA deles.
        if (seen && this.mortesPorTile.size > 0) {
          const ms = this.mortesPorTile.get(i);
          if (ms) {
            for (let k = 0; k < ms.length; k++) {
              this.desenharMorteInimigo(ctx, ms[k], sx, cy, z, lvl);
            }
          }
        }
        if (seen && this.coletas.length > 0) {
          // O brilho da coleta é LUZ DE CHÃO: entra depois dos decalques do
          // abate e antes de tudo o que está de pé, para não pintar por cima
          // das botas do jogador — que é exatamente quem está nesse tile.
          this.desenharBrilhoColeta(ctx, x, y, sx, sy, hw, hh);
        }
        // Os PONTOS DE PARADA, antes dos itens e do bicho: o mercador está
        // POSTO e a estação de alquimia é mobília — o que se recolhe do chão e
        // o que anda por cima deles vem depois, como vem por cima de qualquer
        // cenário. A regra de visão é a dos inimigos (R31): fora do FOV, nada.
        if (seen) {
          if (paradaMerc && paradaMerc.x === x && paradaMerc.y === y) {
            this.desenharParada(
              ctx, 'mercador', this.facingMercador, sx, sy, cy, hw, hh, z, lvl, !isPlayer
            );
          }
          if (paradaCald && paradaCald.x === x && paradaCald.y === y) {
            this.desenharParada(
              ctx, 'caldeirao', DIR_PARADA_FIXA, sx, sy, cy, hw, hh, z, lvl, !isPlayer
            );
          }
          // A estante e a mesa, cada uma no tile que o engine reservou para ela
          // (`PECAS_EXTRAS_ALQUIMIA` é o mapeamento posição → peça). `convida`
          // é FALSO nas duas: são cenário, e não há comando nenhum sobre elas.
          for (let k = 0; k < quantosExtras; k++) {
            const ex = extrasAlq[k];
            if (!ex || ex.x !== x || ex.y !== y) continue;
            this.desenharParada(
              ctx, PECAS_EXTRAS_ALQUIMIA[k], DIR_PARADA_FIXA, sx, sy, cy, hw, hh, z, lvl, false
            );
          }
        }
        if (seen && this.itemAt) {
          // A PILHA: até `PILHA_MAX` sprites por tile, já ordenados por `id`
          // crescente pelo índice. Os slots são contíguos e o primeiro vazio
          // encerra a pilha — não há buraco no meio, por construção.
          const base = i * PILHA_MAX;
          for (let k = 0; k < PILHA_MAX; k++) {
            const ii = this.itemAt[base + k];
            if (ii < 0) break;
            this.drawItem(ctx, game.items[ii], sx, cy, z, lvl, k, ii);
          }
        }
        if (seen && this.entAt) {
          const ei = this.entAt[i];
          if (ei >= 0) this.drawEnemy(ctx, game.enemies[ei], sx, cy, z, lvl, p);
        }
        if (isPlayer) this.drawPlayer(ctx, p, sx, cy, z);
      }
    }

    /*
     * §16 — os flutuantes de XP, DEPOIS do mundo: são feedback de recompensa
     * (o mesmo estatuto do clarão de dano), não cenário — ficam por cima até
     * das paredes, porque um "+100" escondido atrás de uma parede não cumpre
     * a função dele. Mas seguem a regra de visão dos itens (R31): um abate que
     * o jogador não viu acontecer não solta texto — quem conta essa história é
     * o rastro (§14), não o flutuante.
     */
    if (this.flutuantes.length > 0) {
      for (let i = 0; i < this.flutuantes.length; i++) {
        const f = this.flutuantes[i];
        if (!vis.has(f.y * w + f.x)) continue;
        this.desenharFlutuanteXp(ctx, f, hw, hh, ox, oy, z);
      }
    }

    /*
     * O "pop" da coleta, pelo mesmo motivo e no mesmo lugar dos flutuantes: é
     * feedback, não cenário. O tile é sempre o do jogador (foi ele quem
     * recolheu), então o recorte por visão é trivialmente verdadeiro — mas fica
     * escrito, porque quem herdar isto vai querer disparar coleta de outra
     * fonte um dia.
     */
    if (this.coletas.length > 0) {
      for (let i = 0; i < this.coletas.length; i++) {
        const c = this.coletas[i];
        if (!vis.has(c.y * w + c.x)) continue;
        this.desenharPopColeta(ctx, c, hw, hh, ox, oy, z);
      }
    }

    /* As cachoeiras, por cima de TUDO que está desenhado: o fluxo escorrendo
     * para dentro do vazio é o contorno do mapa inteiro, e não pode ser
     * coberto nem por parede nem por entidade. Varre o mapa uma vez por frame
     * — o custo é linear nos tiles de água junto ao vazio, que são poucos. */
    if (game.map.agua && this.T_VOID >= 0) {
      /* A cachoeira nasce na PAREDE que encosta na água, não na poça — assim
       * ela aparece mesmo quando a poça está fora do FOV (o jogador vê a
       * parede ao lado, não a água no escuro). O índice é recalculado uma vez
       * por mapa, porque a água não se move. */
      if (this.cachoeirasDoMapa === null || this.cachoeirasDoMapa.mapa !== game.map) {
        const aguaMap = game.map.agua;
        const tiles = game.map.tiles;
        const mapW = game.map.w;
        const mapH = game.map.h;
        const lista: number[] = [];
        for (let y = 0; y < mapH; y++) {
          for (let x = 0; x < mapW; x++) {
            const i = y * mapW + x;
            if (!aguaMap[i]) continue;
            const temVazio =
              (y + 1 < mapH && tiles[(y + 1) * mapW + x] === this.T_VOID) ||
              (y - 1 >= 0 && tiles[(y - 1) * mapW + x] === this.T_VOID) ||
              (x + 1 < mapW && tiles[y * mapW + x + 1] === this.T_VOID) ||
              (x - 1 >= 0 && tiles[y * mapW + x - 1] === this.T_VOID);
            if (temVazio) lista.push(i);
          }
        }
        this.cachoeirasDoMapa = { mapa: game.map, indices: lista };
      }
      const mapaW = game.map.w;
      const vis = game.visible;
      const expl = game.explored;
      for (const i of this.cachoeirasDoMapa.indices) {
        /* A visibilidade olha a VIZINHANÇA, não só o tile: a queda fica na
         * beira do abismo, e o jogador enxerga a borda de onde ele está, na
         * margem — exigir o tile exato no FOV escondia toda cachoeira.
         * Explorado também serve: a beira do mapa não volta a ser segredo. */
        const x = i % mapaW;
        const y = (i - x) / mapaW;
        const perto =
          vis.has(i) ||
          (expl && expl[i] !== 0) ||
          vis.has(i - 1) || vis.has(i + 1) ||
          vis.has(i - mapaW) || vis.has(i + mapaW);
        if (!perto) continue;
        const s2 = x + y;
        const sx2 = hw * (2 * x - s2) + ox;
        const sy2 = s2 * hh + oy;
        this.desenharCachoeira(ctx, game, x, y, sx2, sy2, hw, hh, wh, z, true);
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
    this.atlasMorteInimigo.clear();
    this.mortes.clear();
    this.mortesPorTile.clear();
    this.vivosA.clear();
    this.vivosB.clear();
    this.kindPorId.clear();
    this.flutuantes.length = 0;
    this.atlasXp.clear();
    this.atlasItem.clear();
    this.atlasParada.clear();
    // O terreno segue a mesma regra dos outros atlas: o forge continua com os
    // pixels memoizados por (modelo, opções); aqui só soltamos as referências
    // desta instância. `nivelTileset` volta a −1 para que um renderizador
    // reaproveitado remonte as chaves no primeiro `syncRun`.
    this.atlasTerreno.clear();
    this.nivelTileset = -1;
    this.facingMercador = DEFAULT_FACING;
    this.itensVistos.clear();
    this.coletas.length = 0;
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
    // Andar novo, terreno novo: o tileset e as chaves de cache dele são
    // hasteados AQUI, uma vez por mapa. Os atlas já forjados ficam — a chave
    // deles carrega o nível, e descer e voltar não pode reforjar a grama.
    this.sincronizarTileset(game.map.depth);
    this.vfx = new Map<string, Vfx>();
    // Mapa novo = chão novo. Os rastros dos abates são do andar que ficou para
    // trás — como o sangue do Guerreiro, eles não descem a escada. Os ATLASES
    // da morte ficam: são memoizados pelo forge e não mudam com o mapa.
    this.mortes.clear();
    this.mortesPorTile.clear();
    this.vivosA.clear();
    this.vivosB.clear();
    this.kindPorId.clear();
    this.flutuantes.length = 0;
    // Andar novo = chão novo também para os despojos. A memória dos itens tem
    // de ir junto: sem isto, TODOS os itens do andar anterior contariam como
    // "sumidos" no primeiro quadro do novo, e os que por acaso estivessem no
    // tile de nascimento do jogador soltariam um pop de coleta que não houve.
    this.itensVistos.clear();
    this.coletas.length = 0;
    this.mapW = game.map.w;
    // Andar novo, mercador novo: ele nasce olhando para o sul do grid, como
    // toda entidade nunca vista antes (regra (d) de §0.2). O atlas fica — é o
    // mesmo rig, memoizado pelo forge.
    this.facingMercador = DEFAULT_FACING;
    // A preferência de movimento é amostrada aqui, uma vez por andar: o pulso
    // do convite é contínuo e não pode consultar `matchMedia` por quadro.
    this.movimentoReduzido = prefereReduzirMovimento();
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

  /**
   * Os dois índices tile → entidade, refeitos por quadro (sem alocar: os
   * buffers só nascem quando o mapa muda de tamanho).
   *
   * `entAt` guarda UM inimigo por tile — o engine não deixa dois no mesmo
   * lugar. `itemAt` guarda ATÉ `PILHA_MAX`, em slots contíguos por tile
   * (`tile * PILHA_MAX + k`), porque um abate pode largar dois despojos no
   * mesmo losango e uma sala pode acumular mais.
   *
   * A ordem dentro da pilha é por `item.id` CRESCENTE, garantida por inserção
   * ordenada numa janela de três — não pela ordem de `game.items`, que é ordem
   * de criação e sobrevive a remoções no meio. Duas consequências que valem o
   * custo de três comparações por item:
   *
   *   - o desenho é ESTÁVEL: o mesmo par de itens empilha na mesma ordem em
   *     todo quadro e em toda partida, e nada pisca ao trocar de lugar;
   *   - o corte em três é o determinístico possível: ficam os TRÊS MENORES
   *     ids, isto é, os três que caíram primeiro. Um item que chega depois não
   *     desloca quem já estava sendo desenhado.
   */
  private indexEntities(game: Game): void {
    const map = game.map;
    const n = map.w * map.h;
    let entAt = this.entAt;
    let itemAt = this.itemAt;
    if (!entAt || !itemAt || entAt.length !== n || itemAt.length !== n * PILHA_MAX) {
      entAt = new Int32Array(n);
      itemAt = new Int32Array(n * PILHA_MAX);
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
        if (i < 0 || i >= n) continue;
        const base = i * PILHA_MAX;
        // Onde este item entra: antes do primeiro slot vazio ou do primeiro
        // ocupante de id MAIOR. Sair do laço em `PILHA_MAX` significa "há três
        // itens mais antigos aqui" — este simplesmente não é desenhado.
        let s = 0;
        while (s < PILHA_MAX) {
          const ocupante = itemAt[base + s];
          if (ocupante < 0) break;
          const outro = it[ocupante];
          if (!outro || o.id < outro.id) break;
          s++;
        }
        if (s >= PILHA_MAX) continue;
        for (let j = PILHA_MAX - 1; j > s; j--) itemAt[base + j] = itemAt[base + j - 1];
        itemAt[base + s] = k;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Piso, parede, sombras, escada e porta
   *
   * O piso e a parede são SPRITE (o bloco do tileset do andar) com o desenho
   * geométrico do vanilla como reserva. Escada, porta e sombra de parede
   * continuam sendo primitivas por cima do chão, sem uma vírgula alterada: os
   * três são LINGUAGEM DE JOGO (aqui se desce, aqui se passa, ali há um vulto),
   * não terreno, e não é o tileset que decide como o jogo fala com o jogador.
   * ------------------------------------------------------------------ */

  /**
   * A CACHOEIRA: onde uma poça encosta no vazio, a água escorre por cima da
   * borda e cai no abismo.
   *
   * É efeito de TELA, não rig: o fluxo é uma faixa vertical desenhada a partir
   * da quina do tile de água para dentro do vazio, com espuma marchando por
   * `dt` (o relógio visual da instância). Modelá-lo como caixa exigiria um rig
   * por combinação de borda; como faixa, uma função resolve as quatro.
   *
   * Determinismo: a variação de fase vem de um hash de (x, y) — nada de
   * `Math.random`, que é proibido no render e o lint pega.
   */
  private desenharCachoeira(
    ctx: CanvasRenderingContext2D, game: Game, x: number, y: number,
    sx: number, sy: number, hw: number, hh: number, wh: number, z: number, seen: boolean
  ): void {
    if (!seen || this.T_VOID < 0) return;
    const map = game.map;
    const w = map.w;
    const tiles = map.tiles;
    /* Só as bordas que a projeção MOSTRA: sul (y+1) e leste (x+1). As outras
     * duas ficam atrás do próprio bloco e o fluxo nunca apareceria. */
    /* As QUATRO bordas: não só sul e leste. Uma poça encostada no abismo em
     * qualquer lado escorre para ele — e a poça da referência do dono escorria
     * exatamente para oeste, que eu não estava desenhando. */
    const paraSul = y + 1 < map.h && tiles[(y + 1) * w + x] === this.T_VOID;
    const paraNorte = y - 1 >= 0 && tiles[(y - 1) * w + x] === this.T_VOID;
    const paraLeste = x + 1 < w && tiles[y * w + x + 1] === this.T_VOID;
    const paraOeste = x - 1 >= 0 && tiles[y * w + x - 1] === this.T_VOID;
    if (!paraSul && !paraNorte && !paraLeste && !paraOeste) return;

    /* As cores vêm do TILESET, não das LUTs: a água do andar 2 pode ser lava,
     * e o fluxo tem de acompanhar o terreno. */
    const paleta = this.tileset.paleta;
    const claro = paleta.aguaLuz ?? '#5fc8ff';
    const escuro = paleta.aguaBase ?? '#2b8fd8';
    const espuma = paleta.aguaEspuma ?? '#e8f7ff';

    /* Fase da queda: hash do tile + o relógio, para os filetes não marcharem
     * todos juntos como um metrônomo. */
    let h = ((x * 374761393) ^ (y * 668265263) ^ 0x9e3779b9) >>> 0;
    h = (h * 1664525 + 1013904223) >>> 0;
    const fase = (this.t * 1.4 + (h / 4294967296)) % 1;

    /* A queda nasce na LÂMINA D'ÁGUA, não no plano seco — e agora TAMBÉM na
     * borda: a espuma coroa o transbordamento, que é o que separa uma coluna
     * caindo do céu de uma queda d'água que sai da poça. */
    const topo = sy + hh + this.tileset.aguaAfundaPx * z;
    /* A queda morre numa BASE com espuma — a bacia onde a água aterrissa no
     * vazio. Sem ela o fluxo sumia para dentro da tela como uma corda solta. */

    /**
     * O jato, desenhado como LÂMINA COLADA NA FACE do bloco — não como coluna
     * solta no ar.
     *
     * A rodada anterior desenhava retângulos verticais compridos com uma
     * elipse arredondada embaixo: na tela viraram três TUBOS DE VIDRO
     * pendurados no vazio, e o dono reprovou na hora. Três erros num só
     * desenho, e todos de conceito:
     *
     *   1. COMPRIMENTO — a queda descia 3 losangos, muito além da face do
     *      bloco de onde ela sai. Água que cai num abismo some no escuro
     *      depois de um vão curto; o que se vê é o TRECHO COLADO na parede.
     *      Agora a lâmina tem a altura do bloco (`wh`) mais um respingo;
     *   2. FORMA — a base arredondada é a assinatura de um tubo, não de uma
     *      queda. Trocada por respingo: duas lascas horizontais que se abrem,
     *      que é como pixel art desenha água batendo;
     *   3. INCLINAÇÃO — a face lateral do bloco isométrico é um
     *      PARALELOGRAMO, e a lâmina tem de acompanhar essa inclinação
     *      (meio pixel de x por pixel de y, a razão 2:1 do losango), senão
     *      ela cruza a parede em diagonal e denuncia que é um retângulo
     *      pregado por cima.
     *
     * `sinal` diz para que lado a face corre: +1 quando a queda sai pela
     * borda leste (a face desce para a direita) e −1 pela oeste.
     */
    const desenhar = (px: number, sinal: number): void => {
      const larg = Math.max(3, hw * 0.44);
      const meia = larg / 2;
      /* A altura da face do bloco, mais um respingo curto. Nada de descer
       * até o infinito: o resto da queda se perde no escuro do abismo. */
      const alturaFace = wh > 0 ? wh : hh * 2 * z;
      const total = alturaFace + hh * 0.9 * z;

      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * 0.95;

      /* 1. A LÂMINA, em fatias que acompanham a inclinação da face. Cada
       * fatia anda `sinal * 0,5px` em x por px de y — a razão 2:1. */
      const passo = Math.max(1, Math.round(1 * z));
      for (let dy = 0; dy < total; dy += passo) {
        const desl = sinal * dy * 0.5;
        const t = dy / total;
        /* estreita de leve na descida: a água acelera e afina */
        const w2 = meia * (1 - t * 0.22);
        ctx.fillStyle = t < 0.12 ? espuma : (t > 0.82 ? claro : escuro);
        ctx.fillRect(px + desl - w2, topo + dy, w2 * 2, passo);
      }

      /* 2. OS FILETES que descem: a única animação, e ela acompanha a mesma
       * inclinação — filete reto sobre lâmina inclinada lê como risco. */
      ctx.fillStyle = espuma;
      for (let k = 0; k < 3; k++) {
        const t = (fase + k / 3) % 1;
        const dy = t * total;
        const desl = sinal * dy * 0.5;
        const w2 = meia * (1 - (dy / total) * 0.22);
        ctx.fillRect(px + desl - w2 * 0.5, topo + dy, Math.max(1, w2), Math.max(1, 2 * z));
      }

      /* 3. A CRISTA no lábio: a lasca clara onde a água transborda a borda.
       * É ela que amarra o jato à poça — sem ela ele nasce do nada. */
      ctx.fillStyle = espuma;
      ctx.fillRect(px - meia * 1.15, topo - Math.max(1, 1 * z), meia * 2.3, Math.max(2, 2.5 * z));

      /* 4. O RESPINGO no fim: duas lascas que se abrem para os lados. Não é
       * uma bacia com fundo — é água batendo e espirrando. */
      const fimY = topo + total;
      const deslFim = sinal * total * 0.5;
      ctx.fillStyle = espuma;
      ctx.fillRect(px + deslFim - meia * 1.4, fimY, meia * 2.8, Math.max(1, 2 * z));
      ctx.fillRect(px + deslFim - meia * 1.9, fimY + Math.max(1, 2 * z), meia * 0.9, Math.max(1, 1.5 * z));
      ctx.fillRect(px + deslFim + meia * 1.0, fimY + Math.max(1, 2 * z), meia * 0.9, Math.max(1, 1.5 * z));

      ctx.restore();
    };

    /* Cada borda tem o seu ponto de saída. Sul e leste saem na quina de baixo
     * (a que a câmera vê); norte e oeste saem na quina de cima, atrás do
     * próprio bloco — a queda ainda aparece escorrendo pelas laterais. */
    /* O sinal é o lado para onde a face do bloco corre: leste e norte descem
     * para a direita (+1), sul e oeste para a esquerda (−1). É o que faz a
     * lâmina deitar SOBRE a parede em vez de cruzá-la. */
    if (paraSul) desenhar(sx - hw * 0.30, -1);
    if (paraLeste) desenhar(sx + hw * 0.30, 1);
    if (paraNorte) desenhar(sx + hw * 0.30, 1);
    if (paraOeste) desenhar(sx - hw * 0.30, -1);
  }

  /**
   * O BRILHO QUE ANDA NA POÇA — o reflexo que atravessa a lâmina devagar.
   *
   * Não é enfeite: é LINGUAGEM DE REGRA. A água bloqueia o passo (`isWalkable`
   * devolve falso para todo tile de `map.agua` — src/engine/mapgen.ts) e, pelo
   * corte de canto de `mover`, tranca também as diagonais em volta. Medido em
   * quatro sementes, um andar tem 41 a 58 tiles de água que recusam 95 a 148
   * passos ortogonais e 50 a 86 diagonais de alvo livre. Terreno que barra tem
   * de gritar que barra, e o que o olho lê como líquido não é a cor — é o
   * MOVIMENTO. O rig entrega o afundamento e a espuma parada; a coisa que se
   * mexe só pode vir daqui, porque rig não anima.
   *
   * O desenho é um losango claro, alinhado à grade (o mesmo `pathDiamond` do
   * chão), que desliza pelo eixo do tile e some nas pontas. Losango e não
   * retângulo porque um retângulo em isométrica cisalha e vira mancha —
   * [[texto-em-isometrica-cisalha]] vale para qualquer forma reta.
   *
   * Determinismo, como em toda esta camada: a fase sai de um hash de (x, y)
   * misturado ao relógio visual. `Math.random` é proibido aqui e o lint pega.
   *
   * Só no que está VISÍVEL: a poça lembrada não pisca. Fora do FOV o terreno é
   * memória, e memória não tem reflexo.
   */
  private desenharBrilhoDaAgua(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    sx: number, sy: number, hw: number, hh: number, z: number, seen: boolean, lvl: number
  ): void {
    if (!seen) return;
    const espuma = this.tileset.paleta.aguaEspuma;
    if (!espuma) return;
    /* Hash de (x, y): poças vizinhas brilham fora de compasso, o que é o que
     * impede a superfície inteira de piscar como um letreiro. */
    let h = ((x * 2246822519) ^ (y * 3266489917) ^ 0x85ebca6b) >>> 0;
    h = (h * 1664525 + 1013904223) >>> 0;
    const fase = h / 4294967296;
    /* Vaivém suave em vez de laço: o reflexo volta, não recomeça. */
    const u = Math.sin((this.t * BRILHO_AGUA_VELOCIDADE + fase) * TAU);
    const cy = sy + hh + this.tileset.aguaAfundaPx * z;
    /* Desliza pelo eixo (+1, 0) do grid — em tela, a diagonal para baixo-direita. */
    const px = sx + u * hw * BRILHO_AGUA_CURSO;
    const py = cy + u * hh * BRILHO_AGUA_CURSO;
    const rx = hw * BRILHO_AGUA_MEIA_LARGURA;
    const ry = hh * BRILHO_AGUA_MEIA_LARGURA;
    /* Mais fraco nas pontas do curso, cheio no meio: o reflexo entra e sai da
     * lâmina em vez de bater na beirada e sumir. */
    const forca = 1 - Math.abs(u);
    /* E ele obedece à LUZ do tile, ao contrário do convite e do texto de XP:
     * reflexo é cenário, não feedback — água longe da tocha reflete menos. Não
     * apaga de todo (`BRILHO_AGUA_PISO`) porque o que ele comunica é "aqui não
     * se pisa", e essa informação vale no escuro também. */
    const luz = BRILHO_AGUA_PISO + (1 - BRILHO_AGUA_PISO) * (lvl / (LEVELS - 1));
    ctx.save();
    ctx.globalAlpha =
      ctx.globalAlpha * luz * (BRILHO_AGUA_ALFA_MIN + forca * (BRILHO_AGUA_ALFA_MAX - BRILHO_AGUA_ALFA_MIN));
    ctx.fillStyle = espuma;
    pathDiamond(ctx, px, py - ry, rx, ry);
    ctx.fill();
    ctx.restore();
  }

  /**
   * O bloco de terreno de um tile, colado pela ÂNCORA do atlas sobre o centro
   * do losango — o MESMO ponto e o MESMO critério do herói, dos monstros, dos
   * despojos e dos pontos de parada. É essa coincidência, e só ela, que faz o
   * terreno e o elenco dividirem uma grade só.
   *
   * ═══ POR QUE A ÂNCORA, E NÃO O CENTRO DO QUADRO ═══
   *
   * `atlas.ancoraX/ancoraY` NÃO é "o meio do desenho": é a projeção da ORIGEM
   * do modelo, o ponto (0, 0, 0) do rig, medida em px dentro do quadro (ver
   * `ancoraArteX = margem − x0` em `./spriteForge`). Como o tileset calibra
   * todo bloco com o topo do piso em z = 0 (cabeçalho de `./tilesets/nivel1.ts`)
   * e a projeção manda `(0,0,0)` para o centro do losango, colar a âncora no
   * centro do losango é colar a SUPERFÍCIE do bloco exatamente onde o jogo diz
   * que o chão daquele tile está.
   *
   * Medido, e não deduzido (sonda de forja do piso de grama, zoom 1):
   *
   *   piso grama    quadro 68×57  âncora (34, 27)  centro do quadro (34, 28,5)
   *   parede terra  quadro 68×83  âncora (34, 63)  centro do quadro (34, 41,5)
   *   água          quadro 68×49  âncora (34, 19)  centro do quadro (34, 24,5)
   *   tufo          quadro 20×25  âncora (10, 17)  centro do quadro (10, 12,5)
   *
   * Com a âncora em (34, 27), os quatro cantos do quadrado do tile em z = 0
   * caem em (34, 11), (66, 27), (34, 43) e (2, 27) — ou seja, um losango de
   * 64 × 32 px centrado na âncora, que é `CONFIG.TW × CONFIG.TH` na mosca.
   *
   * A tentativa anterior colava pelo centro do quadro mais uma correção
   * `(alturaFrame − ancoraY)/2`. Ela punha a origem do modelo ABAIXO do centro
   * do losango, e por uma distância DIFERENTE em cada peça — porque a distância
   * entre a âncora e o centro do quadro depende de quanto o rig sobe e desce, e
   * cada rig sobe e desce o seu: +14 px no piso, +32 px na parede, +10 px na
   * água, +9 px no tufo. Daí os três sintomas de uma vez: o elenco (colado pela
   * âncora, certo) parecia flutuar sobre um chão que descera 14 px; a parede
   * descia 32 px e cobria quem estava atrás dela; e o piso, a água e o adereço
   * do MESMO tile desalinhavam entre si, porque cada um errava por um número
   * diferente. Escada, porta e sombra de parede continuavam em cima do losango
   * de verdade (são primitivas, não sprite) e ficavam pairando num buraco preto
   * — que era o retrato mais claro do defeito.
   *
   * A luz entra por `quadroModulado`, como no elenco: o terreno escurece com a
   * distância, e as cores emissivas do tileset (a flor laranja do nível 1)
   * atravessam acesas sem que este método saiba que elas existem.
   *
   * Devolve `false` quando não há pixel nenhum a colar (atlas indisponível) —
   * o sinal de "desenhe do jeito antigo" para quem chamou.
   *
   * Posição arredondada e tamanho não: é o que o resto do arquivo faz com todo
   * sprite, e no terreno tem uma consequência a mais que vale registrar. Em
   * zoom 1 os tiles distam 32/16 px INTEIROS, então arredondar preserva o
   * espaçamento exato e os blocos encaixam sem costura. Em zoom fracionário
   * pode sobrar meio pixel entre dois blocos — e o que aparece nessa fresta não
   * é o fundo, é a SAIA do bloco de trás (o corpo de 4u que desce abaixo do
   * topo, desenhado antes por estar numa antidiagonal anterior). Ou seja: o pior
   * caso é uma linha escura de um pixel onde o tileset já desenha o contorno
   * entre blocos.
   */
  private colarTerreno(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem,
    cx: number, cy: number, z: number, lvl: number
  ): boolean {
    const f = quadroModulado(atlas, DIR_TERRENO, 'parado', 0, lvl / (LEVELS - 1));
    if (!f.fonte) return false;
    const dx = Math.round(cx - atlas.ancoraX * z);
    const dy = Math.round(cy - atlas.ancoraY * z);
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, f.largura * z, f.altura * z);
    ctx.imageSmoothingEnabled = suave;
    return true;
  }

  /**
   * O atlas de uma peça do terreno, forjado SOB DEMANDA e uma vez só — o padrão
   * de `atlasDoInimigo`, com a chave (nível, papel, índice) de `atlasTerreno`.
   * Sem canvas devolve `null` E GUARDA o `null`.
   */
  private atlasDoTerreno(chave: string, modelo: No): AtlasPersonagem | null {
    const pronto = this.atlasTerreno.get(chave);
    // `undefined` = nunca perguntado; `null` = já perguntado e não há atlas.
    if (pronto !== undefined) return pronto;
    const atlas = this.forjarSeguro(modelo, forjaDoTileset(this.tileset));
    this.atlasTerreno.set(chave, atlas);
    return atlas;
  }

  /**
   * Hasteia o tileset do andar e monta as chaves de cache dele. Chamado por
   * `syncRun` (troca de mapa), nunca no laço de desenho.
   *
   * Profundidade inválida (save antigo, `undefined`) cai no nível 1 — o mesmo
   * espírito de `tilesetDoNivel`, que degrada para um terreno conhecido em vez
   * de não desenhar chão nenhum.
   */
  private sincronizarTileset(depth: number): void {
    const nivel = typeof depth === 'number' && isFinite(depth) && depth >= 1 ? Math.floor(depth) : 1;
    if (nivel === this.nivelTileset) return;
    this.nivelTileset = nivel;
    const t = tilesetDoNivel(nivel);
    this.tileset = t;
    const piso: string[] = [];
    for (let k = 0; k < t.piso.length; k++) piso.push(nivel + ':piso:' + k);
    const aderecos: string[] = [];
    for (let k = 0; k < t.aderecos.length; k++) aderecos.push(nivel + ':adereco:' + k);
    this.chavesPiso = piso;
    this.chavesAdereco = aderecos;
    this.chaveParede = nivel + ':parede';
    this.chaveAgua = nivel + ':agua';
  }

  /**
   * O piso: o bloco do tileset escolhido pelo BUCKET de decoração
   * (`map.decor[i] & 7`, o mesmo número que antes escolhia a variação de cor do
   * losango), fechado com módulo sobre a lista — é o tileset que decide a
   * distribuição, declarando a mesma variante mais de uma vez (no nível 1, a
   * grama ocupa 5 dos 8 buckets).
   *
   * Sem atlas, o losango pintado do vanilla, byte a byte: cor de
   * `FLOOR_LIT`/`FLOOR_DIM` pelo par (alt, bucket) e a aresta de 1px no
   * topo-esquerdo. `alt` (o xadrez de blocos 4×4) só vive aqui — o sprite tira a
   * variação da geometria do rig, não de um segundo tom da mesma cor.
   */
  private drawFloor(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, z: number,
    bucket: number, alt: number, seen: boolean, lvl: number, agua?: boolean
  ): void {
    const piso = this.tileset.piso;
    if (piso.length > 0) {
      if (agua && this.tileset.agua) {
        const atlas = this.atlasDoTerreno(this.chaveAgua, this.tileset.agua);
        if (atlas && this.colarTerreno(ctx, atlas, sx, sy + hh, z, lvl)) return;
      } else {
        const k = bucket % piso.length;
        const atlas = this.atlasDoTerreno(this.chavesPiso[k], piso[k]);
        if (atlas && this.colarTerreno(ctx, atlas, sx, sy + hh, z, lvl)) return;
      }
    }

    /* --- reserva: o losango de sempre (jsdom, Node, sem contexto 2D) --- */
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

  /**
   * O adereço de um tile de piso (tufo, seixo, moita, flor): sorteado de forma
   * determinística por `sorteioDeAdereco` e desenhado EM CIMA do bloco, na
   * mesma âncora dele.
   *
   * A ordem das três guardas é a ordem do CUSTO, e é ela que mantém isto fora
   * do orçamento do laço quente: primeiro a lista vazia (um andar sem adereço
   * não paga nada), depois o sorteio (três `imul` que dispensam 5 de cada 6
   * tiles) e só então a consulta de ocupação, que é a cara.
   *
   * O adereço CEDE o tile a quem estiver nele — herói, monstro, despojo,
   * mercador ou peça da alquimia. O preço é honesto e está aqui escrito: o tufo
   * SOME enquanto alguém pisa nele e volta quando o tile esvazia. É pop, e o
   * pop é o menor dos males — a alternativa é uma moita de 4u nascendo no meio
   * do sprite do goblin, e nenhum ajuste de ordem de desenho conserta um objeto
   * que ocupa o mesmo volume que a entidade.
   *
   * Desenhado também no que é só MEMÓRIA (tile explorado fora do FOV), como o
   * piso e a parede: adereço é terreno, e terreno lembrado não pisca. A luz
   * disso é `lvl = 0`, o degrau mais escuro — o mesmo que o piso recebe ali.
   * Consequência assumida: a flor laranja do nível 1 é EMISSIVA, e emissiva
   * atravessa a modulação acesa (§1.1 do BESTIARIO) — ou seja, ela continua
   * brilhando no que o herói só se lembra de ter visto. É o comportamento certo
   * pela leitura (uma coisa que emite luz é justamente o que se enxerga de
   * longe, e é para isso que o rig tem essa peça) e atinge ~3% dos tiles de
   * piso: um adereço em cinco, num tile em seis.
   */
  private desenharAdereco(
    ctx: CanvasRenderingContext2D, game: Game, x: number, y: number, i: number,
    sx: number, cy: number, z: number, decor: number, lvl: number
  ): void {
    const lista = this.tileset.aderecos;
    if (lista.length === 0) return;
    const h = sorteioDeAdereco(x, y, decor);
    if (h % ADERECO_EM_CADA !== 0) return;
    if (!this.tileLivreParaAdereco(game, x, y, i)) return;
    // Bits ALTOS para a peça: os baixos já foram gastos na frequência acima.
    const k = (h >>> 8) % lista.length;
    const atlas = this.atlasDoTerreno(this.chavesAdereco[k], lista[k]);
    if (atlas) this.colarTerreno(ctx, atlas, sx, cy, z, lvl);
  }

  /**
   * Há espaço para um adereço neste tile? Só se não houver NADA de pé nele.
   *
   * Entidade e despojo saem dos índices que `indexEntities` acabou de montar
   * (`entAt`/`itemAt`) — a mesma leitura por índice de tile que o passe de
   * entidades faz, sem varrer lista nenhuma. Os pontos de parada saem do `Game`
   * porque não têm índice: são até quatro pontos no andar inteiro, e quatro
   * comparações num tile que já passou pelo funil de 1-em-6 custam menos que o
   * quinto array de índice deste arquivo.
   */
  private tileLivreParaAdereco(game: Game, x: number, y: number, i: number): boolean {
    const p = game.player;
    if (p && p.x === x && p.y === y) return false;
    if (this.entAt && this.entAt[i] >= 0) return false;
    // Só o primeiro slot da pilha: se ele está vazio, não há item nenhum aqui.
    if (this.itemAt && this.itemAt[i * PILHA_MAX] >= 0) return false;
    const merc = game.mercador;
    if (merc && merc.x === x && merc.y === y) return false;
    const cald = game.bancada;
    if (cald && cald.x === x && cald.y === y) return false;
    const extras = game.alquimiaExtras;
    if (extras) {
      for (let k = 0; k < extras.length; k++) {
        const ex = extras[k];
        if (ex && ex.x === x && ex.y === y) return false;
      }
    }
    return true;
  }

  private drawWallShadow(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, seen: boolean
  ): void {
    ctx.fillStyle = seen ? COL_SHADOW_WALL : COL_SHADOW_WALL_DIM;
    pathDiamond(ctx, sx + hw * 0.07, sy + hh * 0.1, hw * 0.86, hh * 0.86);
    ctx.fill();
  }

  /**
   * A parede: o bloco alto do tileset, ancorado no MESMO ponto do piso (o centro
   * do losango). Quem sobe de z = 0 até `WALL_H` é o rig — o volume desenhado é
   * o mesmo que o prisma geométrico ocupava, e é por isso que a silhueta do
   * andar não mudou de lugar ao trocar de técnica.
   *
   * O alfa da transparência do canto frontal NÃO é decidido aqui: quem o arma é
   * `draw`, com `ctx.globalAlpha` em volta da chamada (ver `ALFA_PAREDE_OCULTA`).
   * Os dois caminhos abaixo o respeitam de graça — `drawImage` e `fill()` são os
   * dois compostos pelo alfa do contexto.
   *
   * Sem atlas, o prisma do vanilla: topo em losango, face esquerda 18% mais
   * escura, face direita 32%, contorno sutil e a aresta vertical central.
   */
  private drawWall(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number, wh: number,
    z: number, bucket: number, seen: boolean, lvl: number
  ): void {
    const parede = this.tileset.parede;
    if (parede) {
      const atlas = this.atlasDoTerreno(this.chaveParede, parede);
      if (atlas && this.colarTerreno(ctx, atlas, sx, sy + hh, z, lvl)) return;
    }

    /* --- reserva: o prisma de sempre (jsdom, Node, sem contexto 2D) --- */
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
   * As MORTES do bestiário (docs/BESTIARIO.md §14) — desenho por fase
   *
   * Mesma técnica da cinemática de morte do Guerreiro (ver `desenharMorte`):
   * decalque de chão em primitivas de canvas, corpo em coluna ('parado', 0)
   * de atlas secundário modulado pela luz do tile, arma solta por rotação de
   * TELA. Sem atlas (jsdom, sem contexto 2D) nada quebra: quem desenha checa
   * `f.fonte` antes do `drawImage`, e os decalques saem mesmo assim.
   * ------------------------------------------------------------------ */

  /** O despachante: uma linha por bicho, como `RETRATOS` faz com os vivos. */
  private desenharMorteInimigo(
    ctx: CanvasRenderingContext2D, m: MorteInimigo, sx: number, cy: number, z: number, lvl: number
  ): void {
    if (m.kind === 'chaser') this.desenharMorteGoblin(ctx, m, sx, cy, z, lvl);
    else if (m.kind === 'sentinel') this.desenharMorteOgro(ctx, m, sx, cy, z, lvl);
    else if (m.kind === 'linker') this.desenharMorteSlime(ctx, m, sx, cy, z, lvl);
  }

  /**
   * Atlas secundário da morte de um monstro, sob demanda e uma vez só — o
   * padrão de `atlasDeMorte` do Guerreiro, com a chave `kind:qual` porque aqui
   * são três bichos. `qual`: 'parado' | 'agachado' | 'caido' | 'arma'
   * (goblin/ogro), 'estagio1' | 'estagio2' | 'estagio3' (slime).
   *
   * 'parado' é o bicho em pé SEM a arma — o quadro entre o instante em que ela
   * se solta e a troca para o agachado; sem ele a arma aparece duas vezes (na
   * mão e caindo), o mesmo defeito que o Guerreiro tinha.
   */
  private atlasMorteDe(kind: ArchetypeKey, qual: string): AtlasPersonagem | null {
    const chave = kind + ':' + qual;
    const pronto = this.atlasMorteInimigo.get(chave);
    if (pronto !== undefined) return pronto;
    let atlas: AtlasPersonagem | null = null;
    if (kind === 'chaser') {
      if (qual === 'parado') atlas = this.forjarSeguro(MODELO_GOBLIN_SEM_CIMITARRA, FORJA_GOBLIN);
      else if (qual === 'agachado') atlas = this.forjarSeguro(MODELO_GOBLIN_SEM_CIMITARRA, FORJA_MORTE_GOBLIN_AGACHADO);
      else if (qual === 'caido') atlas = this.forjarSeguro(MODELO_GOBLIN_SEM_CIMITARRA, FORJA_MORTE_GOBLIN_CAIDO);
      else if (qual === 'arma') atlas = this.forjarSeguro(MODELO_CIMITARRA, FORJA_CIMITARRA);
    } else if (kind === 'sentinel') {
      if (qual === 'parado') atlas = this.forjarSeguro(MODELO_OGRO_SEM_MARRETA, FORJA_OGRO);
      else if (qual === 'agachado') atlas = this.forjarSeguro(MODELO_OGRO_SEM_MARRETA, FORJA_MORTE_OGRO_AGACHADO);
      else if (qual === 'caido') atlas = this.forjarSeguro(MODELO_OGRO_SEM_MARRETA, FORJA_MORTE_OGRO_CAIDO);
      else if (qual === 'arma') atlas = this.forjarSeguro(MODELO_MARRETA, FORJA_MARRETA);
    } else if (kind === 'linker') {
      if (qual === 'estagio1') atlas = this.forjarSeguro(MODELO_SLIME_DERRETIDO_1, FORJA_SLIME_DERRETIDA);
      else if (qual === 'estagio2') atlas = this.forjarSeguro(MODELO_SLIME_DERRETIDO_2, FORJA_SLIME_DERRETIDA);
      else if (qual === 'estagio3') atlas = this.forjarSeguro(MODELO_SLIME_DERRETIDO_3, FORJA_SLIME_DERRETIDA);
    }
    this.atlasMorteInimigo.set(chave, atlas);
    return atlas;
  }

  /**
   * A poça (sangue ou geleia), a generalização de `desenharSangue`: elipse no
   * plano do piso crescendo de 0 a `raio`·zoom com ease-out e persistindo,
   * mais respingos determinísticos de um LCG semeado pelo tile (nada de
   * `Math.random` no render — tools/check-boundaries.mjs). `alfaLuz` modula o
   * decalque pela luz do tile: uma poça no limite do campo de visão não pode
   * brilhar como se estivesse aos pés do jogador (§1 do BESTIARIO, mesmo
   * espírito). O Guerreiro não precisa disto — ele É a fonte de luz.
   */
  private desenharPoca(
    ctx: CanvasRenderingContext2D, sementeX: number, sementeY: number,
    cx: number, cy: number, z: number, k: number, raio: number,
    corA: string, corB: string, alfaLuz: number
  ): void {
    if (k <= 0) return;
    if (k > 1) k = 1;
    const ease = 1 - (1 - k) * (1 - k);
    const r = raio * z * ease;
    const by = cy + 2 * z;
    const alfaAntes = ctx.globalAlpha;
    ctx.globalAlpha = alfaAntes * alfaLuz;
    fillEllipse(ctx, cx, by, r, r * 0.42, corA);
    fillEllipse(ctx, cx - 2 * z, by - 0.5 * z, r * 0.6, r * 0.25, corB);

    /* Respingos determinísticos em torno da poça (LCG semeado pelo tile). */
    let s = ((sementeX * 374761393) ^ (sementeY * 668265263) ^ 0x9e3779b9) >>> 0;
    if (s === 0) s = 1;
    for (let i = 0; i < 8; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const ang = (s / 4294967296) * TAU;
      s = (s * 1664525 + 1013904223) >>> 0;
      const dist = (0.5 + (s / 4294967296) * 0.65) * raio * z * ease;
      s = (s * 1664525 + 1013904223) >>> 0;
      const rr = (0.8 + (s / 4294967296) * 1.6) * z;
      fillEllipse(
        ctx, cx + Math.cos(ang) * dist, by + Math.sin(ang) * dist * 0.42,
        rr, rr * 0.42, i % 2 === 0 ? corA : corB
      );
    }
    ctx.globalAlpha = alfaAntes;
  }

  /**
   * O corpo morto: a coluna ('parado', 0) do atlas dado — a pose EXATA do
   * repouso forjado — MODULADA pela luz do tile (os monstros não são fonte de
   * luz, §1 do BESTIARIO; as cores emissivas atravessam acesas, §1.1) e com
   * alfa opcional (o esmaecimento final do Ogro). Sem flash e sem barra de
   * vida: morto não tem vida a mostrar.
   */
  private desenharCorpoMorto(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem, dir: number,
    cx: number, cy: number, z: number, lvl: number, alfa: number
  ): void {
    const f = quadroModulado(atlas, dir, 'parado', 0, lvl / (LEVELS - 1));
    if (!f.fonte) return;
    const dx = Math.round(cx - atlas.ancoraX * z);
    const dy = Math.round(cy - atlas.ancoraY * z);
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    if (alfa < 1) {
      const alfaAntes = ctx.globalAlpha;
      ctx.globalAlpha = alfaAntes * alfa;
      ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, f.largura * z, f.altura * z);
      ctx.globalAlpha = alfaAntes;
    } else {
      ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, f.largura * z, f.altura * z);
    }
    ctx.imageSmoothingEnabled = suave;
  }

  /**
   * A arma solta, a generalização de `desenharEspadaSolta`: sai da altura da
   * mão (`x0`,`y0`) e cai para o lado (`x1`,`y1`) girando até `ARMA_GIRO_MORTE`
   * ·k, acelerando (queda, não deslize); ao pousar fica como decalque — ou
   * esmaece, conforme `alfa`. O giro é de TELA (`ctx.rotate` com suavização
   * desligada — o giro pixelado é desejado), então o atlas é sempre a coluna
   * ('parado', 0) na direção do facing, modulada pela luz como o corpo.
   */
  private desenharArmaCaida(
    ctx: CanvasRenderingContext2D, atlas: AtlasPersonagem, dir: number,
    x0: number, y0: number, x1: number, y1: number,
    z: number, lvl: number, k: number, alfa: number
  ): void {
    if (k <= 0 || alfa <= 0) return;
    if (k > 1) k = 1;
    const queda = k * k;
    const px = x0 + (x1 - x0) * queda;
    const py = y0 + (y1 - y0) * queda;
    const f = quadroModulado(atlas, dir, 'parado', 0, lvl / (LEVELS - 1));
    if (!f.fonte) return;
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alfa;
    ctx.translate(px, py);
    ctx.rotate(ARMA_GIRO_MORTE * k);
    ctx.drawImage(
      f.fonte, f.sx, f.sy, f.largura, f.altura,
      Math.round(-atlas.ancoraX * z), Math.round(-atlas.ancoraY * z),
      f.largura * z, f.altura * z
    );
    ctx.restore();
    ctx.imageSmoothingEnabled = suave;
  }

  /**
   * GOBLIN (`chaser`) — sequência de 1,1 s: o sangue cresce, a cimitarra cai
   * girando e SOME, o corpo desaba (parado → agachado → caído) e FICA. O
   * rastro é o CORPO sobre a poça: quem passar depois vê o cadáver verde e
   * sabe que ali morreu um goblin.
   */
  private desenharMorteGoblin(
    ctx: CanvasRenderingContext2D, m: MorteInimigo, sx: number, cy: number, z: number, lvl: number
  ): void {
    const t = m.t;
    const cx = sx;
    const dir = normalizeFacing(m.facing);
    const alfaLuz = 0.35 + 0.65 * (lvl / (LEVELS - 1));

    // 1. SANGUE (0→0,9 s, persiste) — as cores da poça do Guerreiro: sangue é sangue.
    this.desenharPoca(ctx, m.x, m.y, cx, cy, z, t / MORTE_MOB_SANGUE, SANGUE_RAIO_GOBLIN, '#6e1414', '#4a0d0d', alfaLuz);

    // A sombra elíptica continua: o cadáver também está no chão.
    fillEllipse(ctx, cx, cy + 2 * z, 10 * z, 4.2 * z, COL_SHADOW_ENT);

    // 2. CORPO — parado com cimitarra → parado SEM ela (no instante em que a
    // arma se solta) → AGACHADO → CAÍDO (persiste: é o rastro).
    let corpo: AtlasPersonagem | null;
    if (t >= GOB_MORTE_CAIDO) corpo = this.atlasMorteDe('chaser', 'caido');
    else if (t >= GOB_MORTE_AGACHADO) corpo = this.atlasMorteDe('chaser', 'agachado');
    else if (t >= GOB_MORTE_ARMA_INICIO) corpo = this.atlasMorteDe('chaser', 'parado');
    else corpo = this.atlasDoInimigo('chaser');
    if (corpo) this.desenharCorpoMorto(ctx, corpo, dir, cx, cy, z, lvl, 1);

    // 3. CIMITARRA (0,1→0,55 cai; 0,55→0,85 esmaece e some — o rastro é o CORPO).
    if (t >= GOB_MORTE_ARMA_INICIO && t < GOB_MORTE_ARMA_SOME) {
      const arma = this.atlasMorteDe('chaser', 'arma');
      if (arma) {
        let k = (t - GOB_MORTE_ARMA_INICIO) / (GOB_MORTE_ARMA_FIM - GOB_MORTE_ARMA_INICIO);
        if (k > 1) k = 1;
        let alfa = 1;
        if (t > GOB_MORTE_ARMA_FIM) {
          alfa = 1 - (t - GOB_MORTE_ARMA_FIM) / (GOB_MORTE_ARMA_SOME - GOB_MORTE_ARMA_FIM);
        }
        this.desenharArmaCaida(ctx, arma, dir, cx - 7 * z, cy - 12 * z, cx - 15 * z, cy + 1 * z, z, lvl, k, alfa);
      }
    }
  }

  /**
   * OGRO (`sentinel`) — sequência de 1,7 s, a mais longa: ele é PESADO. O
   * sangue cresce maior, a marreta cai girando e POUSA na poça — e FICA —, o
   * corpo desaba (parado → agachado → caído) e ESMAECE até sumir. O rastro é
   * a ARMA sobre o sangue: o corpo some, a marreta fica — quem passar depois
   * vê o montante abandonado e sabe que ali morreu um ogro.
   */
  private desenharMorteOgro(
    ctx: CanvasRenderingContext2D, m: MorteInimigo, sx: number, cy: number, z: number, lvl: number
  ): void {
    const t = m.t;
    const cx = sx;
    const dir = normalizeFacing(m.facing);
    const alfaLuz = 0.35 + 0.65 * (lvl / (LEVELS - 1));

    // 1. SANGUE (0→1,1 s, persiste) — poça grande, de bicho grande.
    this.desenharPoca(ctx, m.x, m.y, cx, cy, z, t / OGRO_MORTE_SANGUE, SANGUE_RAIO_OGRO, '#6e1414', '#4a0d0d', alfaLuz);

    // 2. MARRETA (0,2→0,95 cai e POUSA — é o rastro; desenhada antes do corpo:
    // no chão ela fica sob a massa dele enquanto ele cai por cima).
    if (t >= OGRO_MORTE_ARMA_INICIO) {
      const arma = this.atlasMorteDe('sentinel', 'arma');
      if (arma) {
        let k = (t - OGRO_MORTE_ARMA_INICIO) / (OGRO_MORTE_ARMA_FIM - OGRO_MORTE_ARMA_INICIO);
        if (k > 1) k = 1;
        this.desenharArmaCaida(ctx, arma, dir, cx - 9 * z, cy - 20 * z, cx - 15 * z, cy + 2 * z, z, lvl, k, 1);
      }
    }

    // A sombra acompanha o corpo enquanto ele existe (some junto com ele).
    if (t < OGRO_MORTE_CORPO_SOME_FIM) {
      fillEllipse(ctx, cx, cy + 2 * z, 13 * z, 5 * z, COL_SHADOW_ENT);

      // 3. CORPO — parado com marreta → parado SEM ela (no instante em que a
      // arma se solta) → AGACHADO → CAÍDO → ESMAECE e some (o rastro é a ARMA).
      let corpo: AtlasPersonagem | null;
      if (t >= OGRO_MORTE_CAIDO) corpo = this.atlasMorteDe('sentinel', 'caido');
      else if (t >= OGRO_MORTE_AGACHADO) corpo = this.atlasMorteDe('sentinel', 'agachado');
      else if (t >= OGRO_MORTE_ARMA_INICIO) corpo = this.atlasMorteDe('sentinel', 'parado');
      else corpo = this.atlasDoInimigo('sentinel');
      let alfa = 1;
      if (t >= OGRO_MORTE_CORPO_SOME_INICIO) {
        alfa = 1 - (t - OGRO_MORTE_CORPO_SOME_INICIO) / (OGRO_MORTE_CORPO_SOME_FIM - OGRO_MORTE_CORPO_SOME_INICIO);
        if (alfa < 0) alfa = 0;
      }
      if (corpo) this.desenharCorpoMorto(ctx, corpo, dir, cx, cy, z, lvl, alfa);
    }
  }

  /**
   * SLIME (`linker`) — sequência de 1,0 s, o DERRETIMENTO: a geleia cresce sob
   * ele enquanto o domo desaba em três estágios de geometria (achatou →
   * desabou → POÇA), os olhos âmbar afogam por último e a bolinha da antena
   * fica boiando na poça — EMISSIVA, acesa até no escuro (§1.1). O rastro é
   * a GELEIA: quem passar depois vê a mancha verde brilhando e sabe que ali
   * morreu um slime.
   */
  private desenharMorteSlime(
    ctx: CanvasRenderingContext2D, m: MorteInimigo, sx: number, cy: number, z: number, lvl: number
  ): void {
    const t = m.t;
    const cx = sx;
    const dir = normalizeFacing(m.facing);
    const alfaLuz = 0.35 + 0.65 * (lvl / (LEVELS - 1));

    // 1. GELEIA (0→1,0 s, persiste) — os verdes da própria paleta do bicho
    // (§11.2): a poça é feita do que ele era.
    this.desenharPoca(
      ctx, m.x, m.y, cx, cy, z, t / SLIME_MORTE_GOSMA, GOSMA_RAIO_SLIME,
      PALETA_SLIME.gosmaSombra, PALETA_SLIME.gosmaFundo, alfaLuz
    );

    // 2. CORPO — parado → ESTÁGIO 1 → ESTÁGIO 2 → ESTÁGIO 3 (a POÇA, que
    // persiste: é o rastro). Sem sombra elíptica: a geleia no chão já o assenta.
    let corpo: AtlasPersonagem | null;
    if (t >= SLIME_MORTE_ESTAGIO_3) corpo = this.atlasMorteDe('linker', 'estagio3');
    else if (t >= SLIME_MORTE_ESTAGIO_2) corpo = this.atlasMorteDe('linker', 'estagio2');
    else if (t >= SLIME_MORTE_ESTAGIO_1) corpo = this.atlasMorteDe('linker', 'estagio1');
    else corpo = this.atlasDoInimigo('linker');
    if (corpo) this.desenharCorpoMorto(ctx, corpo, dir, cx, cy, z, lvl, 1);
  }

  /**
   * §16 — o atlas do texto de um valor de XP, forjado sob demanda e uma vez
   * só (o padrão de `atlasDoInimigo`): o conjunto é fechado, então no máximo
   * cinco atlases existem por instância. Valor fora da escala (§15) guarda
   * `null` e o flutuante simplesmente não sai — degradar sem lançar.
   */
  private atlasDoXp(xp: number): AtlasPersonagem | null {
    const pronto = this.atlasXp.get(xp);
    if (pronto !== undefined) return pronto;
    const modelo = modeloDeXp(xp);
    const atlas = modelo ? this.forjarSeguro(modelo, FORJA_XP) : null;
    this.atlasXp.set(xp, atlas);
    return atlas;
  }

  /**
   * §16 — o texto subindo do tile do abate: estático (a linha `dir 2` da
   * coluna ('parado', 0) — a frente, que é onde o texto lê na ordem certa),
   * quem se move é a posição de tela. Sobe `FLUTUA_XP_SUBIDA`·zoom com
   * ease-out e esmaece no último terço. Brilho pleno e por cima do mundo —
   * feedback, não cenário.
   */
  private desenharFlutuanteXp(
    ctx: CanvasRenderingContext2D, f: FlutuanteXp,
    hw: number, hh: number, ox: number, oy: number, z: number
  ): void {
    const atlas = this.atlasDoXp(f.xp);
    if (!atlas || !atlas.canvas) return;
    let k = f.t / DUR_FLUTUA_XP;
    if (k > 1) k = 1;
    const ease = 1 - (1 - k) * (1 - k);
    let alfa = 1;
    if (k > FLUTUA_XP_FADE) alfa = 1 - (k - FLUTUA_XP_FADE) / (1 - FLUTUA_XP_FADE);
    if (alfa <= 0) return;

    const s = f.x + f.y;
    const sx = hw * (2 * f.x - s) + ox;
    const cy = s * hh + oy + hh - (10 + FLUTUA_XP_SUBIDA * ease) * z;
    const q = atlas.quadro(2, 'parado', 0);
    const lw = atlas.larguraFrame;
    const lh = atlas.alturaFrame;
    const suave = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alfa;
    ctx.drawImage(
      atlas.canvas, q.sx, q.sy, lw, lh,
      Math.round(sx - atlas.ancoraX * z), Math.round(cy - atlas.ancoraY * z),
      lw * z, lh * z
    );
    ctx.restore();
    ctx.imageSmoothingEnabled = suave;
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
  private atlasDeMorte(qual: 'parado' | 'ajoelhado' | 'caido' | 'espada'): AtlasPersonagem | null {
    const pronto = this.atlasMorte.get(qual);
    if (pronto !== undefined) return pronto;
    let atlas: AtlasPersonagem | null = null;
    if (qual === 'parado') {
      atlas = this.forjarSeguro(MODELO_GUERREIRO_SEM_ESPADA, FORJA_MORTE_PARADO);
    } else if (qual === 'ajoelhado') {
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

    // 3/4. CORPO — parado COM espada (até ela se soltar) → parado SEM espada →
    // AJOELHADO (0,9) → CAÍDO (1,7). Trocas duras.
    //
    // A troca para o atlas sem espada acontece no MESMO instante em que a
    // espada solta começa a cair (`MORTE_ESPADA_INICIO`): é o que faz a arma
    // "sair da mão" em vez de existir duas vezes na tela.
    let corpo: AtlasPersonagem | null;
    if (t >= MORTE_CAIDO) corpo = this.atlasDeMorte('caido');
    else if (t >= MORTE_AJOELHADO) corpo = this.atlasDeMorte('ajoelhado');
    else if (t >= MORTE_ESPADA_INICIO) corpo = this.atlasDeMorte('parado');
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

  /* ------------------------------------------------------------------ *
   * Os itens no chão — a poção (geometria) e os despojos (sprite)
   * ------------------------------------------------------------------ */

  /**
   * A BIFURCAÇÃO dos itens, gêmea da dos inimigos (§7.3): a poção continua no
   * caminho geométrico do vanilla, INALTERADO, e todo material é um quadro do
   * atlas do seu rig. Nenhum dos dois caminhos sabe do outro.
   *
   * `ordem` é a posição na pilha do tile (0 = o mais antigo, embaixo). O
   * deslocamento por item extra é pequeno de propósito: ele existe para o
   * jogador PERCEBER que há mais de uma coisa ali, não para separar as coisas
   * — quem quiser o inventário exato tem o registro e a bolsa.
   *
   * `indice` é a posição em `game.items`, usada só como semente de reserva do
   * bob quando o item não tem `id` numérico (save malformado). É o parâmetro
   * que `drawPotion` já recebia, e ele continua chegando lá intacto.
   */
  private drawItem(
    ctx: CanvasRenderingContext2D, item: Item, sx: number, cyBase: number, z: number,
    lvl: number, ordem: number, indice: number
  ): void {
    if (!item) return;
    // O empilhamento é em TELA: o tile lógico é o mesmo, só o desenho se
    // desloca. O leque é o mesmo do pop da coleta — uma regra, dois lugares.
    const dxPilha = dxDoLeque(ordem, z);
    const dyPilha = PILHA_DY * ordem * z;

    if (item.kind === 'potion') {
      this.drawPotion(ctx, item, sx + dxPilha, cyBase + dyPilha, z, lvl, indice);
      return;
    }

    // A partir daqui `item.kind` é `MaterialKind` — o compilador já o sabe, e é
    // por isso que `FICHAS_DE_ITEM` pode ser um Record total.
    const kind = item.kind;
    const bob = Math.sin(this.t * 2 + (typeof item.id === 'number' ? item.id : indice)) * 1.2 * z;
    const cx = sx + dxPilha;
    const chao = cyBase + dyPilha;
    const cy = chao + bob;

    // A sombra fica no CHÃO e não sobe com o bob — a mesma regra do inimigo
    // (§7.4). É ela que impede o despojo de ler como flutuando no vazio.
    fillEllipse(ctx, cx, chao + 2 * z, 7 * z, 3 * z, COL_SHADOW_ENT);

    const atlas = this.atlasDoItem(kind);
    if (atlas) {
      // Coluna ('parado', 0) na direção fixa, MODULADA pela luz do tile: um
      // despojo caído num corredor escuro tem de escurecer como o resto do
      // mundo. As cores emissivas do rig (o ponto âmbar do frasco) atravessam a
      // modulação sozinhas — quem cuida disso é `quadroModulado`.
      const f = quadroModulado(atlas, DIR_ITEM, 'parado', 0, lvl / (LEVELS - 1));
      if (f.fonte) {
        const dx = Math.round(cx - atlas.ancoraX * z);
        const dy = Math.round(cy - atlas.ancoraY * z);
        const suave = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, f.largura * z, f.altura * z);
        ctx.imageSmoothingEnabled = suave;
        return;
      }
    }
    // Sem atlas (jsdom, Node, qualquer ambiente sem contexto 2D): a reserva.
    // NUNCA deixar de desenhar — é a regra que mantém esses ambientes vivos.
    this.desenharItemGeometrico(ctx, RESERVA_DE_ITEM[kind], cx, cy, z, lvl);
  }

  /**
   * O atlas de um despojo, forjado SOB DEMANDA e uma vez só, no primeiro
   * desenho daquele material (o padrão de `atlasDoInimigo`). Sem canvas devolve
   * `null` E GUARDA o `null`: a forja não pode virar retentativa por quadro.
   */
  private atlasDoItem(kind: MaterialKind): AtlasPersonagem | null {
    const pronto = this.atlasItem.get(kind);
    // `undefined` = nunca perguntado; `null` = já perguntado e não há atlas.
    if (pronto !== undefined) return pronto;
    const ficha = FICHAS_DE_ITEM[kind];
    const atlas = ficha ? this.forjarSeguro(ficha.modelo, ficha.forja) : null;
    this.atlasItem.set(kind, atlas);
    return atlas;
  }

  /**
   * O despojo em forma geométrica — a rede de segurança de quem não tem atlas,
   * e também o corpo do pop de coleta quando ele não tem sprite (a poção).
   * Deliberadamente ANÔNIMO: uma trouxa de duas elipses na cor de quem largou o
   * item. Sem canvas não há rig, e fingir silhueta com primitivas custaria
   * manutenção para um caminho que nenhum jogador vê.
   */
  private desenharItemGeometrico(
    ctx: CanvasRenderingContext2D, chave: ShadeKey, cx: number, cy: number, z: number, lvl: number
  ): void {
    const sh = this.luts.SHADES[chave] || this.luts.SHADES.stone;
    fillEllipse(ctx, cx, cy - 3.4 * z, 5 * z, 3.4 * z, sh.main[lvl]);
    fillEllipse(ctx, cx, cy - 5 * z, 2.4 * z, 1.5 * z, sh.light[lvl]);
  }

  /**
   * O brilho da coleta: o losango do tile pintado de âmbar, esmaecendo em
   * `DUR_COLETA`. É o âmbar de realce da UI (`COL_HOVER_LINE`) porque é a mesma
   * frase visual — "olhe para este tile" —, e no auge ele fica bem abaixo da
   * opacidade do piso: é um clarão, não um bloco de cor.
   *
   * Coletas simultâneas no mesmo tile (pisar numa pilha recolhe tudo de uma
   * vez) tomam o MÁXIMO, nunca a soma: três despojos não podem acender três
   * vezes mais forte que um.
   */
  private desenharBrilhoColeta(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    sx: number, sy: number, hw: number, hh: number
  ): void {
    let vivo = 0;
    for (let k = 0; k < this.coletas.length; k++) {
      const c = this.coletas[k];
      if (c.x !== x || c.y !== y) continue;
      const a = 1 - c.t / DUR_COLETA;
      if (a > vivo) vivo = a;
    }
    if (vivo <= 0) return;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * vivo * COLETA_BRILHO;
    ctx.fillStyle = COL_HOVER_LINE;
    pathDiamond(ctx, sx, sy, hw, hh);
    ctx.fill();
    ctx.restore();
  }

  /**
   * O "pop" do item recolhido: o sprite sobe `COLETA_SUBIDA`·zoom com ease-out
   * e esmaece — a mesma mecânica do flutuante de XP (§16), com um terço da
   * duração, porque isto acompanha uma linha de registro e não uma recompensa.
   *
   * BRILHO PLENO, sem modulação de luz, por dois motivos que se reforçam: é
   * feedback (mesmo estatuto do clarão de dano e do texto de XP), e o tile é o
   * do jogador — que é sempre o mais iluminado do mapa, já que a fonte de luz é
   * ele. Não haveria o que escurecer.
   *
   * A poção não tem rig e cai na trouxa geométrica: o brilho do tile é que
   * carrega o feedback dela. Sprite de poção fica para o dia em que ela ganhar
   * um rig como os despojos ganharam.
   */
  private desenharPopColeta(
    ctx: CanvasRenderingContext2D, c: ColetaVfx,
    hw: number, hh: number, ox: number, oy: number, z: number
  ): void {
    let k = c.t / DUR_COLETA;
    if (k > 1) k = 1;
    const ease = 1 - (1 - k) * (1 - k);
    const alfa = 1 - k;
    if (alfa <= 0) return;

    const s = c.x + c.y;
    const sx = hw * (2 * c.x - s) + ox + dxDoLeque(c.ordem, z);
    const cy = s * hh + oy + hh - COLETA_SUBIDA * ease * z;

    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alfa;
    const atlas = c.kind === 'potion' ? null : this.atlasDoItem(c.kind);
    if (atlas && atlas.canvas) {
      const q = atlas.quadro(DIR_ITEM, 'parado', 0);
      const suave = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        atlas.canvas, q.sx, q.sy, atlas.larguraFrame, atlas.alturaFrame,
        Math.round(sx - atlas.ancoraX * z), Math.round(cy - atlas.ancoraY * z),
        atlas.larguraFrame * z, atlas.alturaFrame * z
      );
      ctx.imageSmoothingEnabled = suave;
    } else {
      const chave: ShadeKey = c.kind === 'potion' ? 'potion' : RESERVA_DE_ITEM[c.kind];
      this.desenharItemGeometrico(ctx, chave, sx, cy, z, LEVELS - 1);
    }
    ctx.restore();
  }

  /**
   * A poção no chão — o desenho do vanilla, intacto: bob senoidal defasado pelo
   * `id`, sombra elíptica no chão e o frasco em primitivas. Continua sendo o
   * caminho da poção por contrato (R7), e não por falta de rig.
   */
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
   * Os PONTOS DE PARADA — o mercador e a estação de alquimia
   *
   * Ver o bloco de constantes `FICHAS_DE_PARADA` para o porquê de cada
   * decisão. Aqui só há desenho, e ele é o mesmo de um inimigo com sprite:
   * sombra elíptica no chão, quadro da coluna ('parado', 0) modulado pela luz
   * do tile e colado pela âncora do atlas, e a rede de segurança geométrica
   * para quem não pôde forjar (jsdom, Node, qualquer ambiente sem contexto 2D).
   * ------------------------------------------------------------------ */

  /**
   * O atlas de um ponto de parada, forjado SOB DEMANDA e uma vez só (o padrão
   * de `atlasDoInimigo`). Sem canvas devolve `null` E GUARDA o `null`.
   */
  private atlasDaParada(tipo: TipoParada): AtlasPersonagem | null {
    const pronto = this.atlasParada.get(tipo);
    // `undefined` = nunca perguntado; `null` = já perguntado e não há atlas.
    if (pronto !== undefined) return pronto;
    const ficha = FICHAS_DE_PARADA[tipo];
    const atlas = ficha ? this.forjarSeguro(ficha.modelo, ficha.forja) : null;
    this.atlasParada.set(tipo, atlas);
    return atlas;
  }

  /**
   * Um ponto de parada no tile dele. `convida` liga o pulso âmbar do chão — ele
   * é falso quando o jogador está EM CIMA do ponto e falso, sempre, nos tiles
   * de cenário da estação (estante e mesa não têm interação nenhuma).
   */
  private desenharParada(
    ctx: CanvasRenderingContext2D, tipo: TipoParada, dir: number,
    sx: number, sy: number, cy: number, hw: number, hh: number,
    z: number, lvl: number, convida: boolean
  ): void {
    if (convida) this.desenharConvite(ctx, sx, sy, hw, hh);

    const sombra = SOMBRA_PARADA[tipo];
    fillEllipse(ctx, sx, cy + 2 * z, sombra[0] * z, sombra[1] * z, COL_SHADOW_ENT);

    const atlas = this.atlasDaParada(tipo);
    if (atlas) {
      // Coluna ('parado', 0) — nem o mercador nem a mobília andam ou atacam —,
      // MODULADA pela luz do tile, como todo inimigo (§1). As emissivas (as
      // lentes dele, o caldo e os frascos dela) atravessam acesas sozinhas:
      // quem cuida disso é `quadroModulado`, e este arquivo não conhece um
      // pixel do assunto.
      const f = quadroModulado(atlas, dir, 'parado', 0, lvl / (LEVELS - 1));
      if (f.fonte) {
        const dx = Math.round(sx - atlas.ancoraX * z);
        const dy = Math.round(cy - atlas.ancoraY * z);
        const suave = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura, dx, dy, f.largura * z, f.altura * z);
        ctx.imageSmoothingEnabled = suave;
        return;
      }
    }
    // Sem atlas: NUNCA deixar de desenhar. Um andar em que o mercador é
    // invisível é um andar em que o jogador não sabe que pode negociar — e uma
    // estação sem caldeirão é um tile de interação que ninguém encontra.
    if (tipo === 'mercador') this.desenharMercadorGeometrico(ctx, sx, cy, z, lvl);
    else if (tipo === 'caldeirao') this.desenharCaldeiraoGeometrico(ctx, sx, cy, z, lvl);
    else if (tipo === 'estante') this.desenharEstanteGeometrica(ctx, sx, cy, z, lvl);
    else this.desenharMesaGeometrica(ctx, sx, cy, z, lvl);
  }

  /**
   * O pulso âmbar no losango do ponto de parada (ver `CONVITE_PERIODO`).
   *
   * Cor: `SHADES.amber` no nível MÁXIMO, e não no `lvl` do tile. Um convite que
   * escurece com a distância não convida — é justamente de longe que ele
   * precisa ser visto. É a mesma decisão de brilho pleno do clarão de dano e do
   * texto de XP: feedback, não cenário.
   *
   * Com `prefers-reduced-motion` o pulso congela no meio do curso: o tile
   * continua marcado, sem nada piscando.
   */
  private desenharConvite(
    ctx: CanvasRenderingContext2D, sx: number, sy: number, hw: number, hh: number
  ): void {
    const fase = this.movimentoReduzido
      ? 0.5
      : 0.5 - 0.5 * Math.cos((this.t / CONVITE_PERIODO) * TAU);
    const alfa = CONVITE_ALFA_MIN + (CONVITE_ALFA_MAX - CONVITE_ALFA_MIN) * fase;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alfa;
    ctx.fillStyle = this.luts.SHADES.amber.main[LEVELS - 1];
    pathDiamond(ctx, sx, sy, hw, hh);
    ctx.fill();
    ctx.restore();
  }

  /**
   * O MERCADOR sem atlas: o sino do manto (I2), a cabeça e as duas lentes
   * acesas (I1). Deliberadamente pobre, como toda reserva geométrica deste
   * arquivo — o que ela precisa dizer é "há ALGUÉM neste tile", e as lentes
   * acesas dizem que esse alguém é o mercador, não um monstro.
   *
   * As lentes saem em brilho pleno (`LEVELS − 1`), e não no `lvl` do tile: é a
   * tradução honesta da camada emissiva do rig para um caminho que não tem
   * camada nenhuma.
   */
  private desenharMercadorGeometrico(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, lvl: number
  ): void {
    const manto = this.luts.SHADES.linker;
    const lente = this.luts.SHADES.amber;
    fillEllipse(ctx, cx, cy - 7 * z, 6 * z, 9 * z, manto.main[lvl]);
    fillEllipse(ctx, cx, cy - 16 * z, 4 * z, 3.4 * z, manto.dark[lvl]);
    fillCircle(ctx, cx - 1.6 * z, cy - 16 * z, 1.3 * z, lente.light[LEVELS - 1]);
    fillCircle(ctx, cx + 1.6 * z, cy - 16 * z, 1.3 * z, lente.light[LEVELS - 1]);
  }

  /* ------------------------------------------------------------------ *
   * A estação de alquimia sem atlas — três peças, três silhuetas
   *
   * A reserva do móvel único da rodada 1 virou três, uma por tile, pela mesma
   * razão que os rigs viraram três: cada peça desenha no SEU losango. O
   * vocabulário é o de sempre — elipses na cor de quem o objeto é —, e o que
   * muda entre elas é só a silhueta: bojuda no caldeirão, ALTA e estreita na
   * estante, BAIXA e larga na mesa. Três formas que se distinguem de relance é
   * tudo o que uma reserva precisa entregar.
   *
   * O que está ACESO sai em brilho pleno (`LEVELS − 1`) e não no `lvl` do tile:
   * é a tradução honesta das cores emissivas do rig (`CORES_EMISSIVAS_ALQUIMIA`)
   * para um caminho que não tem camada emissiva nenhuma. Sempre em `.light`, e
   * nunca em `.main`: `SHADES.amber.main[LEVELS − 1]` é EXATAMENTE a cor do
   * pulso de convite, e um fogo daquela cor faria o desenho de reserva se
   * confundir com o convite para quem lê o canvas (o que test/render.test.ts
   * faz literalmente).
   * ------------------------------------------------------------------ */

  /**
   * O CALDEIRÃO sem atlas: o bojo de pedra, a LAJE ROXA do caldo por cima (I1 —
   * o conteúdo é a superfície, a mesma regra que o rig obedece) e a língua de
   * fogo que escapa pela frente. É a peça do tile de interação, e é por isso
   * que ela é a mais berrante das três: o jogador precisa achá-la.
   */
  private desenharCaldeiraoGeometrico(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, lvl: number
  ): void {
    const pedra = this.luts.SHADES.stone;
    const caldo = this.luts.SHADES.linker;
    const fogo = this.luts.SHADES.amber;
    fillEllipse(ctx, cx, cy - 6 * z, 9 * z, 6 * z, pedra.main[lvl]);
    fillEllipse(ctx, cx, cy - 11 * z, 7 * z, 3.2 * z, pedra.light[lvl]);
    /* A laje roxa: o caldo É o topo do caldeirão, nunca algo "dentro" dele. */
    fillEllipse(ctx, cx, cy - 12 * z, 5 * z, 2.2 * z, caldo.light[LEVELS - 1]);
    fillCircle(ctx, cx, cy - 1.5 * z, 2.4 * z, fogo.light[LEVELS - 1]);
  }

  /**
   * A ESTANTE sem atlas: um bloco ALTO de madeira com três frascos acesos
   * escalonados (I2). A silhueta é o recado — ela é a única peça da estação que
   * sobe acima da linha da cabeça do herói, e é o que faz a instalação ser
   * notada de longe mesmo sem sprite nenhum.
   *
   * Madeira não tem chave própria em `SHADES` (a paleta do vanilla é por
   * arquétipo, não por material): o tom quente escuro do âmbar é o que mais se
   * aproxima, e é o mesmo critério de `RESERVA_DE_ITEM` — a cor de reserva é
   * uma APROXIMAÇÃO deliberada, não a cor do rig 3D.
   */
  private desenharEstanteGeometrica(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, lvl: number
  ): void {
    const madeira = this.luts.SHADES.amber;
    const frascoA = this.luts.SHADES.potion;
    const frascoB = this.luts.SHADES.sentinel;
    const frascoC = this.luts.SHADES.linker;
    fillEllipse(ctx, cx, cy - 13 * z, 6.5 * z, 13 * z, madeira.dark[lvl]);
    fillEllipse(ctx, cx, cy - 25 * z, 7 * z, 2 * z, madeira.main[lvl]);
    /* Três frascos, um por prateleira, acesos como no rig. As cores são as das
     * trincas de `criarEstanteNo`: verde, azul e roxo. */
    fillCircle(ctx, cx - 2.6 * z, cy - 20 * z, 1.7 * z, frascoA.light[LEVELS - 1]);
    fillCircle(ctx, cx + 2.6 * z, cy - 13 * z, 1.7 * z, frascoB.light[LEVELS - 1]);
    fillCircle(ctx, cx - 2.6 * z, cy - 6 * z, 1.7 * z, frascoC.light[LEVELS - 1]);
  }

  /**
   * A MESA sem atlas: um tampo BAIXO e largo de madeira com o livro aberto por
   * cima e a chama da vela acesa ao lado (I3). Baixa por contraste com a
   * estante — as duas peças de cenário só valem alguma coisa se lerem como
   * coisas diferentes num relance.
   */
  private desenharMesaGeometrica(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number, lvl: number
  ): void {
    const madeira = this.luts.SHADES.amber;
    fillEllipse(ctx, cx, cy - 5 * z, 10 * z, 4.5 * z, madeira.dark[lvl]);
    fillEllipse(ctx, cx, cy - 9 * z, 8.5 * z, 2.6 * z, madeira.main[lvl]);
    /* O livro aberto: a página clara, a leitura de "alguém trabalha aqui". */
    fillEllipse(ctx, cx - 2 * z, cy - 11 * z, 4 * z, 1.5 * z, madeira.light[lvl]);
    /* A vela: a única coisa acesa da peça. A chama sai da MESMA rampa da
     * madeira (não há chave de fogo em `SHADES`, e o âmbar é as duas coisas);
     * o que a separa do tampo é o brilho PLENO — `light[LEVELS − 1]` contra o
     * `main[lvl]` que escurece com a distância. */
    fillCircle(ctx, cx + 5.5 * z, cy - 13 * z, 1.5 * z, madeira.light[LEVELS - 1]);
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
