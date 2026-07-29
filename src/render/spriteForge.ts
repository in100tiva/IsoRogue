/*
 * ISOROGUE — src/render/spriteForge.ts
 *
 * Forja de atlas do personagem (§7 do docs/PERSONAGEM.md) e as poses de §6.
 *
 * O que este módulo faz, e só isto:
 *   1. Decide as POSES: `(estado, quadro) -> Pose` — função pura, determinística,
 *      sem estado de módulo, sem `Math.random`, sem relógio (§6).
 *   2. Rasteriza o rig num buffer de ARTE em baixa resolução (via `model3d`),
 *      amplia ×PIXEL com `imageSmoothingEnabled = false` e cola num atlas único.
 *      É DESSA ORDEM que nasce o pixel art — nunca rasterize direto em alta
 *      resolução (§3 do contrato).
 *   3. Guarda o atlas em cache por modelo (forja sob demanda, uma vez só) e mede
 *      o tempo de forja para o painel de debug. Alvo: < 40ms.
 *   4. MODULA o quadro pela luz do tile (§1 do docs/BESTIARIO.md) — ver o bloco
 *      logo abaixo, que é a técnica exigida por aquela seção.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODULAÇÃO POR LUZ E OLHOS EMISSIVOS (§1 e §1.1 do docs/BESTIARIO.md)
 *
 * O jogador é a fonte de luz e sai com brilho pleno (§7.1 do PERSONAGEM.md). Um
 * inimigo no limite do campo de visão, não: sair com o mesmo brilho o deixaria
 * chapado, colado na frente do cenário, e destruiria a leitura de profundidade
 * que o fog of war constrói. `quadroModulado()` é a resposta.
 *
 * A técnica, em três decisões, e o porquê de cada uma:
 *
 *   1. UM atlas só, com brilho pleno. Forjar um atlas por nível de luz
 *      multiplicaria o custo de forja (§7 pede < 40ms) e a memória por nada — o
 *      escurecimento é uma operação de composição, não de geometria.
 *
 *   2. Escurecer com `globalCompositeOperation = 'source-atop'` sobre uma cópia
 *      do quadro, exatamente como `IsoRenderer.tingirQuadro` já faz para o
 *      clarão de dano. `atop` é o único operador que respeita o alfa do sprite:
 *      pela fórmula de Porter-Duff `Co = αs·Cs + (1−αs)·Cb` com `αo = αb`, os
 *      pixels do sprite viram uma mistura linear com a cor de sombra e os
 *      pixels VAZIOS continuam vazios. Um `fillRect` normal (`source-over`)
 *      pintaria o retângulo inteiro e o inimigo viraria um bloco.
 *      Consequência útil e não óbvia: como fora do retângulo do `fillRect` o
 *      alfa da fonte é 0, `atop` também não toca os quadros VIZINHOS na mesma
 *      folha — é o que permite escurecer um quadro de cada vez dentro de uma
 *      cópia do atlas inteiro (item 3).
 *
 *   3. Os olhos NÃO escurecem (§1.1). A cor emissiva não sobrevive à
 *      rasterização como nome — depois do atlas só existe RGB —, então a forja
 *      extrai UMA VEZ uma CAMADA EMISSIVA: uma folha do tamanho do atlas onde
 *      só ficam os pixels cuja cor está na rampa efetiva das cores marcadas em
 *      `opts.emissivas`, tudo o mais transparente. O escurecimento é aplicado e
 *      a camada emissiva é recolada por cima com `source-over`, em brilho
 *      pleno. Um goblin no escuro vira dois pontos vermelhos encarando você.
 *
 *      A alternativa considerada e descartada: recortar o olho por retângulo
 *      conhecido do rig. Depende do facing, da pose e da projeção — 72 casos e
 *      quebra a cada ajuste visual. A camada emissiva é indiferente a tudo isso.
 *
 * CACHE. `nivelLuz` é quantizado em `DEGRAUS_LUZ` (8) degraus e o par
 * (quadro, degrau) é a CHAVE do cache: 72 quadros × 7 degraus escuros = 504
 * pares possíveis. Sem cache, cada inimigo visível refaria o tingimento a cada
 * frame — três operações de composição por inimigo por quadro de animação.
 *
 * Guardar os 504 custaria ~12 MiB de canvas por personagem para um conjunto de
 * trabalho que, na prática, tem o tamanho do número de inimigos na tela. Então
 * o cache é uma FOLHA DE SLOTS de tamanho fixo (`CAPACIDADE_CACHE` = 64 células
 * do tamanho de um quadro, ~1,4 MiB) com despejo LRU. 64 cobre com folga um
 * andar cheio de `chaser` visíveis, e a memória para de depender do tamanho do
 * bestiário. Depois do cache quente: zero pixel novo por frame, um `drawImage`
 * por inimigo. `estatisticasModulacao().despejos` é o sensor — se ele crescer
 * a cada frame, o conjunto de trabalho passou de 64 e é hora de subir a
 * capacidade, não de culpar o cache.
 *
 * CONTRATO COM O AUTOR DO PERSONAGEM. Marcar a cor emissiva é passar o NOME dela
 * na paleta em `opts.emissivas` (para o Goblin: `emissivas: ['olhoBrasa']`).
 * Duas armadilhas que valem a linha de documentação:
 *   - dê à cor emissiva uma rampa PRÓPRIA em `rampas`/`rampaDaCor` (ou nenhuma,
 *     e ela deriva a sua). Se ela dividir rampa com o couro, o couro inteiro
 *     fica aceso no escuro;
 *   - declare as caixas do olho com `contorno: false`. O contorno de silhueta de
 *     §4.5 é traçado por cima da peça, e um olho de 2×2px de arte pode ser
 *     inteiramente coberto por ele — aí não sobra pixel emissivo nenhum.
 *
 * O que este módulo NÃO faz: projeção, faces, sombreamento, contorno e a
 * matemática de matriz — tudo isso é de `./model3d`. Aqui não há um único
 * `Math.cos` de projeção; só ângulos de pose.
 *
 * Camada: render. Pode tocar `document`/Canvas (o engine não pode) e pode ler
 * tipos do engine. Não importa React (tools/check-boundaries.mjs reprova).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SUPERFÍCIE DE ACOPLAMENTO COM `./model3d` (§4 do docs/PERSONAGEM.md)
 *
 * Três funções e duas constantes, e nada mais:
 *   `ART_POR_U` / `PIXEL`  — a escala de §3;
 *   `medirModelo`          — projeta os vértices e devolve os `Limites` em px de arte;
 *   `desenharModelo`       — pinta faces, sombreamento e contorno em px de arte;
 *   `giroParaFrente`       — o giro de facing de §5 (e a armadilha do +Y já resolvida lá).
 * Os tipos das duas primeiras são derivados com `typeof`, então uma mudança de
 * assinatura em `model3d` aparece aqui como erro de compilação em vez de bug.
 *
 * O MATERIAL (paleta, rampas, contorno) não é decidido aqui: chega em `opts` e
 * é repassado inteiro. Quem conhece a cor do personagem é o personagem —
 * `characters/warrior.ts`. É o que mantém o forge servindo a qualquer rig.
 */

import { DIRS8 } from '../engine/core';
import {
  ART_POR_U,
  PIXEL,
  desenharModelo,
  giroParaFrente,
  medirModelo,
  rampaEfetiva
} from './model3d';
import type {
  EntradaPaleta,
  Limites,
  MaterialPorCor,
  No,
  Paleta3D,
  Pose,
  RampasPorMaterial
} from './model3d';

/* ------------------------------------------------------------------ *
 * 1. Estados, quadros e o retículo do atlas
 * ------------------------------------------------------------------ */

/** Estados de animação do personagem (§6). Puramente cosmético (R54). */
export type Estado = 'parado' | 'andando' | 'atacando';

/** Quantos quadros cada estado tem. 2 + 4 + 3 = 9 colunas. */
export const QUADROS_POR_ESTADO: Readonly<Record<Estado, number>> = {
  parado: 2,
  andando: 4,
  atacando: 3
};

/** Ordem das colunas no atlas. Não reordene: `quadro()` deriva a coluna daqui. */
export const ORDEM_ESTADOS: readonly Estado[] = ['parado', 'andando', 'atacando'];

/** 8 direções de `DIRS8` (§5) — uma linha do atlas por direção. */
export const DIRECOES = 8;

/** Coluna inicial de cada estado, derivada de `ORDEM_ESTADOS` (determinístico). */
const COLUNA_DE_ESTADO: Record<Estado, number> = (() => {
  const mapa = { parado: 0, andando: 0, atacando: 0 };
  let acc = 0;
  for (const e of ORDEM_ESTADOS) {
    mapa[e] = acc;
    acc += QUADROS_POR_ESTADO[e];
  }
  return mapa;
})();

/** Total de colunas do atlas (9). */
export const COLUNAS = ORDEM_ESTADOS.reduce((s, e) => s + QUADROS_POR_ESTADO[e], 0);

/** 8 direções × 9 quadros = 72 (§7). */
export const TOTAL_QUADROS = COLUNAS * DIRECOES;

/* ------------------------------------------------------------------ *
 * 2. Poses (§6) — a parte autoral deste módulo
 * ------------------------------------------------------------------ */

const G = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Fator de espelho dos canais `ry`/`rz` — vale para TODO rig deste pipeline.
 *
 * A projeção de §4.2 (`artX = x − y`, `artY = (x + y)/2 − z`) inverte o sentido:
 * um relógio deitado no plano XY do modelo, que visto de cima é anti-horário de
 * +X para +Y, sai HORÁRIO na tela. Prova curta: os eixos projetam em
 * `+X → (1, +0.5)`, `+Y → (−1, +0.5)` e o produto vetorial 2D (com Y para baixo)
 * dá +1. Logo a imagem é a imagem ESPELHADA do modelo — e é por isso que os rigs
 * do projeto são autorados espelhados em X (ver §6.1 de `./characters/warrior`),
 * com o braço da espada em −X para a lâmina cair na esquerda da tela.
 *
 * Consequência aqui: a leitura anatômica ingênua dos sinais (`ry > 0` leva a
 * extremidade de um membro para −X, então a perna que vive em +X abre para fora
 * com `ry` negativo) continua verdadeira NO MODELO, mas os membros trocaram de
 * lado. Todo canal `ry`/`rz` desta animação é multiplicado por `ESPELHO` para
 * acompanhar. Os canais `rx` (passada, balanço, arco do golpe) não mudam: o
 * espelho é em X e não mexe no plano sagital.
 */
const ESPELHO = -1;

/**
 * Nomes dos nós que a animação de §6 move. São os da árvore obrigatória de §8 —
 * a mesma fonte de onde `characters/warrior.ts` tira o seu `NOS_GUERREIRO`.
 *
 * Repetimos as strings aqui de propósito, em vez de importar do guerreiro: o
 * forge é agnóstico de personagem (recebe um `No` qualquer) e não pode depender
 * de um rig específico. Em troca, um nome errado é SILENCIOSO — o nó
 * simplesmente não gira —, então qualquer renomeação de nó em §8 tem de passar
 * por estas sete linhas.
 */
export const NOS_HUMANOIDE = {
  quadril: 'quadril',
  torso: 'torso',
  cabeca: 'cabeca',
  bracoDir: 'bracoDir',
  bracoEsq: 'bracoEsq',
  pernaDir: 'pernaDir',
  pernaEsq: 'pernaEsq'
} as const;

/* Amplitudes de §6. Nomeadas porque a revisão visual (§10) mexe nelas — e mexeu:
 * os valores abaixo são os da rodada 2, com o motivo de cada mudança ao lado. */

/**
 * Passada, em graus de rotação do quadril.
 *
 * §6 pedia ±22°, e ±22° é o que reprovou: com a perna medindo 7,6u do pivô à
 * sola, sin(22°)·7,6 = 2,58u de avanço em Y contra apenas 1,9u de meia-bitola
 * em X. Nas direções 0/2/4/6 a projeção isométrica SUBTRAI um do outro
 * (`artX = x − y`), a separação dos pés desabava para 1,4u — 1,7px de arte,
 * invisível — em metade do ciclo e ia a 9u na outra metade. Lia manqueira, não
 * passo. A cura é dupla: passada menor e `ABERTURA` constante (ver abaixo).
 */
const PASSO = 14 * G;

/**
 * Abertura lateral CONSTANTE das pernas ao andar, em graus.
 *
 * É o seguro contra o cancelamento acima. A passada vive no eixo Y do modelo e
 * a abertura no eixo X; em `artX = (x − y)·escala` os dois pesos são
 * `√2·cos(giro+45°)` e `√2·cos(giro−45°)` — complementares, então quando um
 * zera o outro está no máximo. Com abertura constante existe separação de pés
 * legível nas 8 direções, e não em 4 delas.
 *
 * Aplicada em `ry` e não em `rz`: um membro se estende no −Z local, e `rz` gira
 * o membro em torno do próprio eixo — a ponta não sai do lugar. Quem abre a
 * perna para fora é `ry` (ver a convenção de sinal em `poseDoQuadro`).
 */
const ABERTURA = 11 * G;

/**
 * Componente LATERAL da passada, defasada 90° da passada em `rx`.
 *
 * A rodada 2 conduzia a marcha só por `rx` — avanço no eixo Y do modelo —, e o
 * eixo Y desaparece da tela em metade das direções. Medida a separação 2D das
 * botas ao longo dos 4 quadros: nas direções 1 e 5 dava 9,6 / 9,9 / 9,6 / 9,9
 * (amplitude de ciclo de 0,3px de arte — as pernas literalmente NÃO se moviam uma
 * em relação à outra), e nas direções 3 e 7 o ciclo de 4 quadros colapsava em 2
 * poses. É exatamente a falha que `DEFASAGEM` foi escrita para evitar: ela
 * conserta a amostragem do seno, mas a PROJEÇÃO desfaz o conserto.
 *
 * Com um seno em quadratura (`cos`) somado à abertura, a perna descreve um
 * CÍRCULO no plano horizontal em vez de uma reta. Um círculo não tem direção de
 * vista que o achate: qualquer que seja o giro, alguma componente sobra na tela.
 */
const LATERAL = 9 * G;

const BALANCO = 14 * G; // braços contrapostos ±14°
/** Contraparte de `LATERAL` nos braços. Menor: o braço direito carrega a espada. */
const LATERAL_BRACO = 5 * G;
const GIRO_TORSO = 3 * G; // torso oscila 3° em Z

/**
 * Quique da marcha, em `u`. §6 pedia 0,4u — que na escala da rodada 1
 * (`ART_POR_U = 1.25`) valia meio pixel de arte e arredondava para zero: medido
 * no atlas de então, o topo da silhueta era o MESMO pixel nos quatro quadros da
 * marcha. 1,6u dá 4px de arte de balanço na escala atual (2px de arte na de
 * então), que se lê, sem descolar o boneco do losango do tile.

 * A amplitude está em `u` de propósito: ela não precisou de reajuste quando
 * `ART_POR_U` dobrou na rodada 3, porque `PIXEL` caiu junto e o balanço em px de
 * TELA é o mesmo.
 */
const QUIQUE_U = 1.6;

/** Respiração do estado `parado`. Mesmo motivo do quique: 0,25u = 0,3px = nada. */
const RESPIRO_U = 0.8;

const INCLINACAO = 2.5 * G; // leve inclinação para a frente ao andar

/**
 * Defasagem do ciclo de caminhada — a diferença entre 4 poses e 2.
 *
 * Amostrando um seno em 0°/90°/180°/270°, os quadros 0 e 2 caem os DOIS no
 * cruzamento por zero: pernas juntas, braços juntos, poses idênticas. Metade do
 * ciclo desperdiçada e uma marcha que "pisca" entre dois desenhos. Deslocando a
 * amostragem em 22,5° saem quatro valores distintos (±0,383 e ±0,924) — o par
 * de passadas e o par de passagens, que é exatamente o ciclo de 4 quadros
 * clássico. `NORMAL_PASSO` reescala para os extremos baterem nos ±22° de §6.
 */
const DEFASAGEM = Math.PI / 8;
const NORMAL_PASSO = 1 / Math.sin(Math.PI * 0.375);

/**
 * Repouso genérico: nenhuma rotação.
 *
 * A pose de repouso REAL é propriedade do personagem, não do forge — quem sabe
 * que a espada precisa de 180° no nó `espada` para apontar para cima é o rig.
 * Para o Guerreiro ela é `POSE_PARADA` de `characters/warrior.ts`, e quem forja
 * passa em `opts.repouso`. Duplicar aqui os ângulos de §8 seria criar uma
 * segunda fonte da verdade que diverge no primeiro ajuste visual.
 *
 * Todo o resto deste módulo (respiração, marcha, golpe) é RELATIVO ao repouso:
 * mudar a pose parada não quebra nenhuma animação.
 */
export const POSE_NEUTRA: Readonly<Pose> = {};

/**
 * Arco do golpe em `rx`, RELATIVO ao repouso (`bracoDirRx` de `warrior.ts`).
 *
 * Por que o sinal é o INVERSO da leitura literal de §6 (−40° → +55°):
 * `criarEspada` espelha as três peças da espada para +Z — a lâmina nasce
 * apontando para CIMA a partir da mão, e é isso que dá a espada erguida de I4
 * sem ângulo mágico escondido em tabela de pose. Consequência direta: com a
 * ponta em +Z local, `rx` POSITIVO joga a ponta para TRÁS (−Y) e `rx` negativo
 * a joga para a FRENTE (+Y, a direção do facing). O arco de §6, aplicado cru,
 * fazia a lâmina viajar de +3,95u para −5,04u em Y — o guerreiro armava o golpe
 * e parava, nunca desferia, e nunca na direção para onde olhava.
 *
 * Rodada 3 (§10): a amplitude em `rx` caiu de 45/−40/−10 para 25/−25/−5 e o
 * grosso do golpe migrou para `ARCO_GOLPE_RY`. Motivo medido: o arco vivia
 * inteiro no plano Y-Z, o mesmo que a projeção isométrica achata. O percurso da
 * ponta da lâmina somando os dois passos era 19,1 / 17,5 / 19,1 / 19,0 / 12,7 /
 * **2,8** / 12,7 / 19,0 px de arte — na direção 5 o golpe viajava 2,8px, ou seja,
 * não se lia como golpe nenhum.
 */
const ARCO_GOLPE: readonly number[] = [25 * G, -25 * G, -5 * G];
/**
 * O golpe agora é um CORTE LATERAL: o plano X-Z é o único que a projeção
 * isométrica nunca achata (ver `LATERAL`, mesma causa raiz). Multiplicado por
 * `ESPELHO` na aplicação — é canal `ry`.
 */
const ARCO_GOLPE_RY: readonly number[] = [-25 * G, 40 * G, 15 * G];

/**
 * Arco do golpe DECLARADO PELO PERSONAGEM, em radianos, quadro a quadro.
 *
 * Por que este canal existe. Os dois arcos acima são genéricos e servem a
 * qualquer humanoide que empunhe a arma alinhada com o braço — o Guerreiro, que
 * segura a espada apontando para +Z a partir da mão. O Goblin apoia a cimitarra
 * DEITADA sobre o ombro, e nesse arranjo o vetor punho→ponta ganha uma
 * componente −Y grande: o sinal de `rx` se INVERTE (positivo passa a baixar a
 * ponta). Aplicado cru, o arco genérico fazia o goblin erguer a cimitarra e
 * parar — o bicho ameaçava e não batia (medido: 2px de arte de percurso da
 * lâmina nos três quadros, com o ponto mais alto no quadro do meio).
 *
 * A alternativa considerada e recusada: um `if` por personagem aqui dentro. O
 * forge é agnóstico de personagem por contrato — ele já recebe paleta, rampas,
 * repouso e emissivas de fora, e o arco do golpe é a mesma espécie de
 * conhecimento. Quem sabe como a arma está empunhada é quem a empunhou.
 *
 * Contrato: RADIANOS, três valores (um por quadro de `atacando`), na MESMA
 * convenção de sinal dos arcos genéricos — `ry` é multiplicado por `ESPELHO` na
 * aplicação, `rx` não. Lista de tamanho errado é ignorada em silêncio e o arco
 * genérico continua valendo: um personagem meio-configurado desenha o golpe
 * padrão em vez de um braço parado.
 *
 * Ausente, nada muda: `poseDoQuadro` produz exatamente os mesmos números de
 * antes deste canal existir, e o atlas do Guerreiro sai byte a byte igual.
 */
export interface ArcoGolpe {
  readonly rx: readonly number[];
  readonly ry: readonly number[];
}

/** O arco declarado, se ele estiver completo; senão o genérico. */
function arcoValido(arco: ArcoGolpe | undefined): ArcoGolpe {
  const n = QUADROS_POR_ESTADO.atacando;
  if (arco && arco.rx.length === n && arco.ry.length === n) return arco;
  return { rx: ARCO_GOLPE, ry: ARCO_GOLPE_RY };
}
/** "torso acompanha 8°" — torção em Z, agora na ordem armar → desferir → assentar. */
const TORCAO_GOLPE: readonly number[] = [8 * G, -8 * G, -2 * G];
const ESCUDO_GOLPE: readonly number[] = [-8 * G, 8 * G, 2 * G];
const CABECA_GOLPE: readonly number[] = [4 * G, -5 * G, -2 * G];
const INCLINA_GOLPE: readonly number[] = [-2 * G, 7 * G, 3 * G];
const PERNA_DIR_GOLPE: readonly number[] = [-8 * G, 10 * G, 4 * G];
const PERNA_ESQ_GOLPE: readonly number[] = [6 * G, -6 * G, -2 * G];
/**
 * Sobe ao armar, afunda no impacto. Amplitude ditada pela grade de arte, não
 * pela anatomia: `deslocY` arredonda `alturaU × ART_POR_U` para px de arte
 * INTEIROS, então qualquer coisa abaixo de 0,4u vira 0 e o peso do golpe some
 * (o mesmo defeito que matava o quique). 0,8u = exatamente 1px de arte.
 */
const ALTURA_GOLPE: readonly number[] = [0.8, -0.8, 0];

/**
 * Uma pose pronta para desenho.
 *
 * `alturaU` existe porque `Pose` (§4.1) só tem canais de rotação: o quique da
 * marcha e a respiração são TRANSLAÇÕES, e o único lugar onde uma translação
 * do modelo inteiro cabe é aqui, na composição do quadro. Quem desenha desloca
 * a origem; o rig não sabe de nada disso.
 */
export interface PoseQuadro {
  pose: Pose;
  /** Deslocamento vertical do modelo inteiro, em `u` (+ = para cima). */
  alturaU: number;
}

function clonarPose(base: Readonly<Pose>): Pose {
  const saida: Pose = {};
  for (const nome of Object.keys(base)) {
    const r = base[nome];
    saida[nome] = { rx: r.rx ?? 0, ry: r.ry ?? 0, rz: r.rz ?? 0 };
  }
  return saida;
}

/** Soma rotações no nó (cria se não existir). Tudo é relativo ao repouso. */
function somar(p: Pose, nome: string, rx: number, ry: number, rz: number): void {
  let a = p[nome];
  if (!a) {
    a = { rx: 0, ry: 0, rz: 0 };
    p[nome] = a;
  }
  a.rx = (a.rx ?? 0) + rx;
  a.ry = (a.ry ?? 0) + ry;
  a.rz = (a.rz ?? 0) + rz;
}

/** Normaliza o índice de quadro para dentro do estado (defensivo, determinístico). */
export function normalizarQuadro(estado: Estado, quadro: number): number {
  const n = QUADROS_POR_ESTADO[estado];
  if (!Number.isFinite(quadro)) return 0;
  const i = Math.floor(quadro) % n;
  return i < 0 ? i + n : i;
}

/** Normaliza a direção para 0..7 na ordem fixa de `DIRS8` (§5). */
export function normalizarDirecao(dir: number): number {
  if (!Number.isFinite(dir)) return 0;
  const i = Math.floor(dir) % DIRECOES;
  return i < 0 ? i + DIRECOES : i;
}

/**
 * Giro do modelo para o índice de direção do grid (§5): a FRENTE do rig (+Y)
 * passa a apontar para `DIRS8[dir]`.
 *
 * A conta em si é de `model3d.giroParaFrente` — de propósito. O §5 sugere
 * `atan2(dy, dx)`, que alinha o +X do modelo (o ombro direito), não a frente;
 * ter duas versões da fórmula em dois arquivos é como o gate G3 falha em
 * silêncio. Aqui só entra a normalização do índice.
 */
export function giroDaDirecao(dir: number): number {
  const d = DIRS8[normalizarDirecao(dir)];
  return giroParaFrente(d[0], d[1]);
}

/**
 * A função de pose de §6: `(estado, quadro) -> Pose`. Pura e determinística —
 * mesma entrada, mesma saída, sempre um objeto novo (nada compartilhado).
 *
 * Convenção de sinal (derivada de §3 + regra da mão direita): membros se
 * estendem no −Z local, então `rx > 0` leva a extremidade para +Y, a FRENTE, e
 * `ry > 0` a leva para −X. Por isso a perna direita avança com `rx` positivo e o
 * braço direito recua. Para a abertura lateral vale a mesma conta, MAS com o
 * fator `ESPELHO`: o rig é autorado espelhado em X (a perna direita vive em −X),
 * então quem abre a bota para fora é `ry` positivo.
 *
 * Corolário que já custou uma rodada de revisão: `rz` num membro que se estende
 * no −Z gira o membro em torno do PRÓPRIO eixo — a extremidade não sai do
 * lugar. Abertura, adução e abdução são `ry`; nunca `rz`.
 */
export function poseDoQuadro(
  estado: Estado,
  quadro: number,
  repouso: Readonly<Pose> = POSE_NEUTRA,
  arcoGolpe?: ArcoGolpe
): PoseQuadro {
  const f = normalizarQuadro(estado, quadro);
  const pose = clonarPose(repouso);

  if (estado === 'andando') {
    const fase = DEFASAGEM + (f / QUADROS_POR_ESTADO.andando) * TAU;
    const sw = Math.sin(fase) * NORMAL_PASSO; // ≈ +0,41 / +1 / −0,41 / −1
    const sl = Math.cos(fase) * NORMAL_PASSO; // em QUADRATURA — ver `LATERAL`
    // `rx` = passada (avanço em Y); `ry` = abertura lateral (em X), com uma
    // parcela CONSTANTE (`ABERTURA`, as botas sempre abertas para fora) e uma
    // parcela em quadratura (`LATERAL`), que faz o pé percorrer um círculo em
    // vez de uma reta. Sem a constante a marcha some em 4 das 8 direções; sem a
    // quadratura ela some nas outras 4.
    somar(pose, NOS_HUMANOIDE.pernaDir, PASSO * sw, ESPELHO * (-ABERTURA - LATERAL * sl), 0);
    somar(pose, NOS_HUMANOIDE.pernaEsq, -PASSO * sw, ESPELHO * (ABERTURA + LATERAL * sl), 0);
    // contraposição: braço direito recua quando a perna direita avança, e abre
    // para o lado contrário dela — o mesmo par `rx`/`ry` em quadratura das
    // pernas, pelo mesmo motivo de projeção.
    // A torção em Z é REPLICADA nos irmãos porque o rig de §8 é plano — cabeça,
    // bracoDir e bracoEsq são irmãos de `torso`, não filhos —, então girar só o
    // torso faz o tronco rodar por dentro do próprio contorno sem que nada
    // apareça na silhueta.
    somar(pose, NOS_HUMANOIDE.bracoDir, -BALANCO * sw, ESPELHO * (LATERAL_BRACO * sl), ESPELHO * (-GIRO_TORSO * sw));
    somar(pose, NOS_HUMANOIDE.bracoEsq, BALANCO * sw, ESPELHO * (-LATERAL_BRACO * sl), ESPELHO * (-GIRO_TORSO * sw));
    somar(pose, NOS_HUMANOIDE.cabeca, 0, 0, ESPELHO * (-GIRO_TORSO * 0.5 * sw));
    somar(pose, NOS_HUMANOIDE.torso, INCLINACAO, 0, ESPELHO * (-GIRO_TORSO * sw));
    somar(pose, NOS_HUMANOIDE.quadril, 0, 0, ESPELHO * (GIRO_TORSO * 0.5 * sw));
    // Quique: quadros pares (pernas passando perto uma da outra) sobem, ímpares
    // (pernas abertas, pé no chão) ficam assentados. Uma curva contínua não
    // serve aqui: `deslocY` arredonda para px de arte inteiros, e qualquer valor
    // intermediário cairia no mesmo pixel — o balanço sumiria.
    return { pose: pose, alturaU: f % 2 === 0 ? QUIQUE_U : 0 };
  }

  if (estado === 'atacando') {
    // O quadro de IMPACTO é o **1** — quem sincroniza o flash de dano com o
    // golpe (`IsoRenderer`) depende disso, e continua valendo com o arco lateral
    // e com o arco declarado pelo personagem (ver `ArcoGolpe`).
    const arco = arcoValido(arcoGolpe);
    somar(pose, NOS_HUMANOIDE.bracoDir, arco.rx[f], ESPELHO * arco.ry[f], 0);
    somar(pose, NOS_HUMANOIDE.bracoEsq, ESCUDO_GOLPE[f], 0, 0);
    somar(pose, NOS_HUMANOIDE.torso, INCLINA_GOLPE[f], 0, ESPELHO * TORCAO_GOLPE[f]);
    somar(pose, NOS_HUMANOIDE.quadril, 0, 0, ESPELHO * TORCAO_GOLPE[f] * 0.4);
    somar(pose, NOS_HUMANOIDE.cabeca, CABECA_GOLPE[f], 0, ESPELHO * TORCAO_GOLPE[f] * 0.5);
    somar(pose, NOS_HUMANOIDE.pernaDir, PERNA_DIR_GOLPE[f], 0, 0);
    somar(pose, NOS_HUMANOIDE.pernaEsq, PERNA_ESQ_GOLPE[f], 0, 0);
    return { pose: pose, alturaU: ALTURA_GOLPE[f] };
  }

  // parado: quadro 0 é o repouso EXATO (é ele que assenta o boneco no losango);
  // quadro 1 é a inspiração.
  const r = f === 1 ? 1 : 0;
  somar(pose, NOS_HUMANOIDE.torso, -1.8 * G * r, 0, 0);
  somar(pose, NOS_HUMANOIDE.cabeca, 1.2 * G * r, 0, 0);
  somar(pose, NOS_HUMANOIDE.bracoDir, -2.6 * G * r, 0, 0);
  somar(pose, NOS_HUMANOIDE.bracoEsq, 2.2 * G * r, 0, 0);
  return { pose: pose, alturaU: RESPIRO_U * r };
}

/* ------------------------------------------------------------------ *
 * 2.1 Snap de paleta e contorno por máscara (§2, §4.5 e gates G4/G5)
 *
 * Por que este passe existe — o achado que reprovou a rodada 1:
 *
 * `montarModelo` decide a cor de cada face DENTRO da paleta (a quantização de
 * §4.3 faz o trabalho dela corretamente), mas quem põe pixel na tela depois é
 * `ctx.fill()` de polígono, e o Canvas 2D antialiasa toda borda. Em px de ARTE
 * — onde uma peça inteira tem 3 ou 4 pixels de travessia — a borda É a peça:
 * medido no atlas da rodada 1, 86,6% dos pixels do sprite estavam FORA da
 * paleta (1426 tons quentes distintos onde a §2 permite 10). G5 reprovado por
 * construção, G4 junto, e o sprite com aquele aspecto de "3D liso" nas
 * ombreiras e no escudo em vez de pixel art.
 *
 * A cura é rasterizar e depois SNAPAR: varrer a `ImageData` do buffer de arte
 * (44×44 px) e forçar cada pixel para dentro da paleta, com alpha binário. Duas
 * consequências, as duas desejadas:
 *
 *   1. o gradiente contínuo desaparece — G5 vira verde por construção;
 *   2. o alpha binário dá uma MÁSCARA de silhueta exata, e o contorno de I6
 *      passa a sair dela (todo pixel opaco com vizinho-4 transparente vira
 *      `contorno`) em vez de um `stroke` de largura fracionária com `lineCap`
 *      'round' — que era o que deixava o outline da rodada 1 com alpha parcial
 *      e com furos. G4.
 *
 * O passe roda entre `desenhar()` e a ampliação ×PIXEL — nunca depois, senão
 * snaparia os pixels já ampliados e o custo subiria ×4.
 * ------------------------------------------------------------------ */

/** Acima disto o pixel é opaco; abaixo, some. Meio-tom não existe em pixel art. */
const LIMIAR_ALPHA = 128;

/** Recorte em px de arte, meio-aberto em `x1`/`y1`. */
interface Retangulo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Folga, em px de arte, entre a caixa medida do quadro e o recorte que o snap
 * varre. Cobre o arredondamento da projeção (até 1px) e o contorno de silhueta
 * (1px) — abaixo disso o outline da borda direita/inferior ficaria de fora.
 */
const FOLGA_SUJO = 2;

/* Pesos da distância euclidiana em RGB. O verde domina a luminância percebida,
 * então erra menos em ouro/aço do que a distância crua. */
const PESO_R = 2;
const PESO_G = 4;
const PESO_B = 3;

/** As cores legais do sprite, desdobradas em canais para busca sem alocação. */
interface PaletaSnap {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  /** Índice do contorno dentro dos arrays acima, ou −1 se o contorno está desligado. */
  contorno: number;
}

function lerHexRgb(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let s = hex.trim();
  if (s.charAt(0) === '#') s = s.slice(1);
  if (s.length === 3) {
    s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
  }
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Cor de uma entrada de paleta — a mesma resolução que `montarModelo` usa: uma
 * entrada rica (`Tom`) vale pelo degrau que ela declara. `undefined` quando a
 * chave não existe na paleta.
 */
function corDaEntrada(entrada: EntradaPaleta | undefined): string | null {
  if (entrada === undefined) return null;
  if (typeof entrada === 'string') return entrada;
  const i = Math.min(Math.max(Math.round(entrada.indice), 0), Math.max(0, entrada.rampa.length - 1));
  const h = entrada.rampa[i];
  return typeof h === 'string' ? h : null;
}

/**
 * Todas as cores alcançáveis a partir de uma `Paleta3D`: as entradas diretas e
 * também os degraus das rampas de material (§4.3), porque é para eles que a
 * quantização de `montarModelo` manda as faces. Deduplicado e determinístico
 * (ordem de declaração da paleta).
 */
function coresDaPaleta(paleta: Paleta3D, corContorno: string | null): PaletaSnap | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const vistos = new Set<number>();

  const juntar = (hex: string): number => {
    const c = lerHexRgb(hex);
    if (!c) return -1;
    const chave = (c[0] << 16) | (c[1] << 8) | c[2];
    if (vistos.has(chave)) {
      for (let i = 0; i < r.length; i++) if (r[i] === c[0] && g[i] === c[1] && b[i] === c[2]) return i;
      return -1;
    }
    vistos.add(chave);
    r.push(c[0]);
    g.push(c[1]);
    b.push(c[2]);
    return r.length - 1;
  };

  for (const nome of Object.keys(paleta)) {
    const entrada = paleta[nome];
    if (typeof entrada === 'string') {
      juntar(entrada);
    } else {
      for (const h of entrada.rampa) juntar(h);
    }
  }

  let contorno = -1;
  if (corContorno !== null) contorno = juntar(corContorno);
  if (r.length === 0) return null;

  return {
    r: Uint8Array.from(r),
    g: Uint8Array.from(g),
    b: Uint8Array.from(b),
    contorno: contorno
  };
}

/** Índice do degrau mais próximo, por distância euclidiana ponderada. */
function maisProximo(pal: PaletaSnap, r: number, g: number, b: number): number {
  let melhor = 0;
  let dist = Infinity;
  for (let i = 0; i < pal.r.length; i++) {
    const dr = r - pal.r[i];
    const dg = g - pal.g[i];
    const db = b - pal.b[i];
    const d = PESO_R * dr * dr + PESO_G * dg * dg + PESO_B * db * db;
    // `<` estrito: empate fica com a primeira cor declarada. Determinístico.
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  }
  return melhor;
}

/**
 * Snap + contorno, in place, sobre o buffer de ARTE.
 *
 * `memo` é o cache de "cor borrada → degrau da paleta" compartilhado pelos 72
 * quadros: o antialias gera ~1,4k cores distintas no atlas inteiro, então a
 * busca linear roda ~1,4k vezes em vez de ~140k. É o que mantém a forja dentro
 * dos 40ms de §7.
 *
 * Sai em silêncio quando o contexto não expõe `getImageData` (jsdom sem a lib
 * `canvas`) — o atlas continua válido, só sem o acabamento.
 */
function snaparBuffer(
  ctx: CanvasRenderingContext2D,
  largura: number,
  altura: number,
  pal: PaletaSnap,
  memo: Map<number, number>,
  sujo: Retangulo
): void {
  if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
  const rx = Math.max(0, Math.min(largura, sujo.x0));
  const ry = Math.max(0, Math.min(altura, sujo.y0));
  const rw = Math.max(0, Math.min(largura, sujo.x1) - rx);
  const rh = Math.max(0, Math.min(altura, sujo.y1) - ry);
  if (rw <= 0 || rh <= 0) return;
  let img: ImageData;
  try {
    img = ctx.getImageData(rx, ry, rw, rh);
  } catch {
    return;
  }
  const d = img.data;
  if (!d || d.length < rw * rh * 4) return;

  /* ---- 1. alpha binário + cor dentro da paleta (G5) ---- */
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < LIMIAR_ALPHA) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
      continue;
    }
    const chave = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let k = memo.get(chave);
    if (k === undefined) {
      k = maisProximo(pal, d[i], d[i + 1], d[i + 2]);
      memo.set(chave, k);
    }
    d[i] = pal.r[k];
    d[i + 1] = pal.g[k];
    d[i + 2] = pal.b[k];
    d[i + 3] = 255;
  }

  /* ---- 2. contorno pela máscara de alpha (I6, G4) ---- */
  // O critério é o ALPHA, que este passe não altera — então dá para reescrever a
  // cor no mesmo varrimento sem contaminar a decisão do pixel seguinte. Fora do
  // recorte conta como transparente: como o recorte é a caixa do desenho MAIS a
  // folga do contorno (ver `retanguloSujo`), o que está fora dele é vazio de
  // qualquer modo, e a silhueta encostada na borda ainda fecha.
  if (pal.contorno >= 0) {
    const cr = pal.r[pal.contorno];
    const cg = pal.g[pal.contorno];
    const cb = pal.b[pal.contorno];
    const passo = rw * 4;
    for (let y = 0; y < rh; y++) {
      const linha = y * rw;
      for (let x = 0; x < rw; x++) {
        const i = (linha + x) * 4;
        if (d[i + 3] === 0) continue;
        const borda =
          x === 0 ||
          x === rw - 1 ||
          y === 0 ||
          y === rh - 1 ||
          d[i - 4 + 3] === 0 ||
          d[i + 4 + 3] === 0 ||
          d[i - passo + 3] === 0 ||
          d[i + passo + 3] === 0;
        if (!borda) continue;
        d[i] = cr;
        d[i + 1] = cg;
        d[i + 2] = cb;
      }
    }
  }

  ctx.putImageData(img, rx, ry);
}

/* ------------------------------------------------------------------ *
 * 3. Tipos da forja
 * ------------------------------------------------------------------ */

/** O pintor do rig. Derivado de `model3d` — mudou lá, quebra a compilação aqui. */
export type DesenhaModelo = typeof desenharModelo;

/** O medidor do rig. Idem. */
export type MedeModelo = typeof medirModelo;

export interface OpcoesForja {
  /* ---- material (repassado inteiro ao `model3d`, §4.3) ---- */
  /** Nome de cor da peça → cor. Do personagem, não do forge. Obrigatório. */
  paleta: Paleta3D;
  /** Rampas de quantização por material (§4.3). */
  rampas?: RampasPorMaterial;
  /** A qual rampa cada cor pertence (§4.3). */
  rampaDaCor?: MaterialPorCor;
  /** Expansão de contraste antes da quantização. */
  ganhoSombra?: number;
  /** Cor do contorno de silhueta (I6). `null` desliga. */
  corContorno?: string | null;
  /** Largura do contorno em px de arte. */
  larguraContorno?: number;
  /** `false` desliga a quantização — só para preview de iluminação contínua. */
  quantizar?: boolean;
  /**
   * §1.1 do docs/BESTIARIO.md — nomes de cor da paleta que são EMISSIVAS: elas
   * ignoram a modulação de luz de `quadroModulado()` e saem sempre em brilho
   * pleno. Para o Goblin: `['olhoBrasa']`.
   *
   * Custo quando ausente ou vazio: zero. Nenhuma camada extra é alocada e
   * `quadroModulado()` cai no caminho de tingimento simples.
   *
   * Ver as duas armadilhas no cabeçalho deste arquivo (rampa própria; caixas do
   * olho com `contorno: false`).
   */
  emissivas?: readonly string[];

  /* ---- escala e enquadramento ---- */
  /** px de arte por unidade `u` (§3). Padrão: `ART_POR_U`. */
  artPorU?: number;
  /** px de tela por px de arte (§3). Padrão: `PIXEL`. Inteiro ≥ 1. */
  pixel?: number;
  /** Folga em px de ARTE em torno da silhueta (o contorno de §4.5 mora nela). */
  margem?: number;

  /* ---- animação ---- */
  /** Pose de repouso do personagem (para o Guerreiro: `POSE_PARADA`). */
  repouso?: Readonly<Pose>;
  /**
   * §6 — arco do golpe declarado pelo personagem, em radianos (para o Goblin:
   * `ARCO_GOLPE_GOBLIN`). Ausente ou malformado usa o arco genérico. Ver
   * `ArcoGolpe`, que explica por que este canal não podia ser um `if` aqui.
   */
  arcoGolpe?: ArcoGolpe;

  /* ---- injeção (preview de §10, testes). Fornecer qualquer uma ignora o cache. ---- */
  desenhar?: DesenhaModelo;
  medir?: MedeModelo;
}

/**
 * Atlas pronto (§7).
 *
 * Desvio declarado em relação à assinatura de §7: `canvas` é
 * `HTMLCanvasElement | null`. O próprio §7 exige "degrade sem lançar quando não
 * houver `getContext('2d')` (jsdom)", e degradar em silêncio devolvendo um
 * canvas que não existe seria mentira de tipo. Quem desenha checa `disponivel`
 * e cai no desenho geométrico antigo.
 */
export interface AtlasPersonagem {
  canvas: HTMLCanvasElement | null;
  /**
   * §1.1 do docs/BESTIARIO.md — camada EMISSIVA: uma folha do mesmo tamanho e
   * do mesmo retículo de `canvas` onde só existem os pixels das cores marcadas
   * em `opts.emissivas` (tudo o mais transparente). `null` quando o personagem
   * não declara cor emissiva ou quando nenhum pixel dela sobreviveu ao sprite.
   *
   * Quem desenha não precisa tocar nisto: `quadroModulado()` já recola a camada
   * por cima do quadro escurecido. Está exposto para o painel de debug e para a
   * bancada de revisão do gate G8.
   */
  emissivo: HTMLCanvasElement | null;
  /** Falso quando não há DOM ou contexto 2D: o atlas existe, mas está vazio. */
  disponivel: boolean;
  larguraFrame: number;
  alturaFrame: number;
  /**
   * Ponto do sprite que assenta no CENTRO DO LOSANGO do tile, em px de tela.
   * É a projeção da origem do modelo (centro dos pés, §3) — NÃO a borda de
   * baixo do quadro: no rig do Guerreiro a bota afunda no plano do chão de
   * propósito, e há pixels abaixo da âncora. Uso no `IsoRenderer`:
   *
   *   const q = atlas.quadro(p.facing, estado, quadro);
   *   ctx.drawImage(atlas.canvas, q.sx, q.sy, atlas.larguraFrame, atlas.alturaFrame,
   *                 cx - atlas.ancoraX * z, cyTile - atlas.ancoraY * z,
   *                 atlas.larguraFrame * z, atlas.alturaFrame * z);
   */
  ancoraX: number;
  ancoraY: number;
  quadro(dir: number, estado: Estado, frame: number): { sx: number; sy: number };
  /* ---- diagnóstico (painel de debug) ---- */
  /** Tempo de forja em ms, uma casa decimal. Alvo < 40ms (§7). */
  msForja: number;
  totalQuadros: number;
  colunas: number;
  linhas: number;
  /** Dimensões da FOLHA inteira (`larguraFrame × colunas`). */
  larguraFolha: number;
  /** Dimensões da FOLHA inteira (`alturaFrame × linhas`). */
  alturaFolha: number;
  larguraArte: number;
  alturaArte: number;
  pixel: number;
}

/* ------------------------------------------------------------------ *
 * 4. Forja
 * ------------------------------------------------------------------ */

const MARGEM_PADRAO = 2;
/** Trava de sanidade: um rig doente não vai alocar um atlas gigante. */
const MAX_ART = 256;
/** Caixa de emergência quando a medição não devolve nada finito. */
const ARTE_FALLBACK = { largura: 32, altura: 40 };

/**
 * Cache por modelo. `WeakMap` na raiz do rig (o modelo é a identidade) e, dentro,
 * uma chave textual das opções — dois zooms/paletas do mesmo rig são atlas
 * diferentes e não podem se atropelar.
 */
const cache = new WeakMap<No, Map<string, AtlasPersonagem>>();

/**
 * Geração do cache. `WeakMap` não itera, então não dá para esvaziá-lo de fora:
 * o "clear" possível é invalidar as chaves, e é o que `limparCacheAtlas()` faz.
 */
let cacheGeracao = 0;

/**
 * Invalida os atlas em cache — a próxima forja do mesmo modelo é refeita.
 * Serve ao preview e aos testes; o jogo nunca precisa chamar.
 */
export function limparCacheAtlas(): void {
  cacheGeracao++;
}

/**
 * Serialização estável de qualquer valor de opção (chaves ordenadas): dois
 * objetos equivalentes dão a mesma chave, independentemente da ordem em que
 * foram escritos. Roda uma vez por forja, nunca no laço de desenho.
 */
function chaveEstavel(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return '[' + v.map(chaveEstavel).join(',') + ']';
  const o = v as Record<string, unknown>;
  const nomes = Object.keys(o).sort();
  let s = '{';
  for (const nome of nomes) s += nome + ':' + chaveEstavel(o[nome]) + ',';
  return s + '}';
}

function agora(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return 0;
}

function criarCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function contexto(cv: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!cv || typeof cv.getContext !== 'function') return null;
  try {
    return cv.getContext('2d');
  } catch {
    // jsdom sem a lib `canvas` chega a lançar em vez de devolver null.
    return null;
  }
}

function inteiroPositivo(v: number | undefined, padrao: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return padrao;
  const i = Math.round(v);
  return i >= 1 ? i : padrao;
}

function positivo(v: number | undefined, padrao: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : padrao;
}

function limitar(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Monta a lista das 9 poses do atlas, na ordem das colunas. */
function posesDoAtlas(repouso: Readonly<Pose>, arcoGolpe?: ArcoGolpe): PoseQuadro[] {
  const saida: PoseQuadro[] = [];
  for (const estado of ORDEM_ESTADOS) {
    const n = QUADROS_POR_ESTADO[estado];
    for (let f = 0; f < n; f++) saida.push(poseDoQuadro(estado, f, repouso, arcoGolpe));
  }
  return saida;
}

/**
 * Forja o atlas. Memoizado por modelo + opções: chamar de novo com o mesmo rig
 * devolve o mesmo objeto, então o lugar natural da chamada é o primeiro
 * `draw()` do personagem (sob demanda, §7).
 */
export function forjarAtlas(modelo: No, opts: OpcoesForja): AtlasPersonagem {
  const injetado = typeof opts.desenhar === 'function' || typeof opts.medir === 'function';
  if (injetado) return forjar(modelo, opts);

  let porModelo = cache.get(modelo);
  if (!porModelo) {
    porModelo = new Map<string, AtlasPersonagem>();
    cache.set(modelo, porModelo);
  }
  const chave =
    cacheGeracao +
    '|' +
    positivo(opts.artPorU, ART_POR_U) +
    '|' +
    inteiroPositivo(opts.pixel, PIXEL) +
    '|' +
    inteiroPositivo(opts.margem, MARGEM_PADRAO) +
    '|' +
    chaveEstavel(opts.repouso) +
    '|' +
    chaveEstavel(opts.arcoGolpe) +
    '|' +
    chaveEstavel(opts.paleta) +
    '|' +
    chaveEstavel(opts.rampas) +
    '|' +
    chaveEstavel(opts.rampaDaCor) +
    '|' +
    chaveEstavel(opts.ganhoSombra) +
    '|' +
    chaveEstavel(opts.corContorno) +
    '|' +
    chaveEstavel(opts.larguraContorno) +
    '|' +
    chaveEstavel(opts.quantizar) +
    '|' +
    chaveEstavel(opts.emissivas);

  const pronto = porModelo.get(chave);
  if (pronto) return pronto;

  const atlas = forjar(modelo, opts);
  porModelo.set(chave, atlas);
  return atlas;
}

function forjar(modelo: No, opts: OpcoesForja): AtlasPersonagem {
  const t0 = agora();

  const artPorU = positivo(opts.artPorU, ART_POR_U);
  const pixel = inteiroPositivo(opts.pixel, PIXEL);
  const margem = inteiroPositivo(opts.margem, MARGEM_PADRAO);
  const repouso = opts.repouso ?? POSE_NEUTRA;
  const desenhar: DesenhaModelo = opts.desenhar ?? desenharModelo;
  const medir: MedeModelo = opts.medir ?? medirModelo;

  const poses = posesDoAtlas(repouso, opts.arcoGolpe);

  // Deslocamento vertical de cada coluna, em px de ARTE INTEIROS. Arredondar é
  // obrigatório: meio pixel de arte tira o sprite da grade e desfia o pixel art.
  // (Foi por isto que a respiração de §6 — 0,25u — precisou subir para
  // `RESPIRO_U`: na escala da rodada 1 ela valia 0,31px de arte e quantizava
  // para 0. Com `ART_POR_U = 2.5` a grade de arte é o dobro mais fina, e as
  // amplitudes em `u` continuam valendo o mesmo em px de TELA.)
  const deslocY: number[] = poses.map((p) => Math.round(p.alturaU * artPorU));

  /* ---- 1. medir a união de TODAS as 72 combinações ---- */
  // Uma silhueta só, igual para todos os quadros: é o que impede o boneco de
  // "pular" entre direções (gate G2 de §10).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Guardadas para o passe de desenho: cada quadro só suja a PRÓPRIA caixa, e o
  // snap de §2.1 varre só ela em vez do buffer inteiro. Com `ART_POR_U = 2.5` o
  // buffer tem 4× a área da rodada 2 e a silhueta ocupa ~1/3 dele — varrer tudo
  // 72 vezes é o que estourava o alvo de 40ms de §7.
  const caixas: Limites[] = new Array<Limites>(DIRECOES * poses.length);
  for (let dir = 0; dir < DIRECOES; dir++) {
    const giro = giroDaDirecao(dir);
    for (let col = 0; col < poses.length; col++) {
      const c = medir(modelo, { pose: poses[col].pose, giro: giro, escala: artPorU });
      caixas[dir * poses.length + col] = c;
      const dy = deslocY[col];
      if (c.minX < minX) minX = c.minX;
      if (c.maxX > maxX) maxX = c.maxX;
      if (c.minY - dy < minY) minY = c.minY - dy;
      if (c.maxY - dy > maxY) maxY = c.maxY - dy;
    }
  }

  let larguraArte: number;
  let alturaArte: number;
  let ancoraArteX: number;
  let ancoraArteY: number;
  if (Number.isFinite(minX) && Number.isFinite(minY) && maxX > minX && maxY > minY) {
    const x0 = Math.floor(minX);
    const y0 = Math.floor(minY);
    larguraArte = limitar(Math.ceil(maxX) - x0 + margem * 2, 1, MAX_ART);
    alturaArte = limitar(Math.ceil(maxY) - y0 + margem * 2, 1, MAX_ART);
    ancoraArteX = margem - x0;
    ancoraArteY = margem - y0;
  } else {
    // Rig vazio ou medição inutilizável: caixa de emergência centrada nos pés.
    larguraArte = ARTE_FALLBACK.largura;
    alturaArte = ARTE_FALLBACK.altura;
    ancoraArteX = Math.floor(larguraArte / 2);
    ancoraArteY = alturaArte - margem;
  }

  const larguraFrame = larguraArte * pixel;
  const alturaFrame = alturaArte * pixel;

  const atlas: AtlasPersonagem = {
    canvas: null,
    emissivo: null,
    disponivel: false,
    larguraFrame: larguraFrame,
    alturaFrame: alturaFrame,
    ancoraX: ancoraArteX * pixel,
    ancoraY: ancoraArteY * pixel,
    quadro: fazerQuadro(larguraFrame, alturaFrame),
    msForja: 0,
    totalQuadros: TOTAL_QUADROS,
    colunas: COLUNAS,
    linhas: DIRECOES,
    larguraFolha: larguraFrame * COLUNAS,
    alturaFolha: alturaFrame * DIRECOES,
    larguraArte: larguraArte,
    alturaArte: alturaArte,
    pixel: pixel
  };

  /* ---- 2. buffers ---- */
  const arte = criarCanvas(larguraArte, alturaArte);
  const ctxArte = contexto(arte);
  const canvas = criarCanvas(larguraFrame * COLUNAS, alturaFrame * DIRECOES);
  const ctxAtlas = contexto(canvas);
  if (!arte || !ctxArte || !canvas || !ctxAtlas) {
    // jsdom / node: degrada sem lançar (§7). O atlas existe e responde a
    // `quadro()`; só não tem pixels — e `disponivel` diz isso em voz alta.
    atlas.msForja = Math.round((agora() - t0) * 10) / 10;
    return atlas;
  }

  atlas.canvas = canvas;

  /* ---- 2.1 material do acabamento (§2.1) ---- */
  // Mesma resolução de `montarModelo`: `undefined` procura a chave `contorno` na
  // paleta, `null` desliga. Sem isso o snap e o modelo discordariam sobre a cor
  // do outline — e o modelo é quem manda.
  const corContorno =
    opts.corContorno === undefined
      ? corDaEntrada(opts.paleta['contorno'])
      : opts.corContorno;
  const paletaSnap = coresDaPaleta(opts.paleta, corContorno);
  const memoSnap = new Map<number, number>();

  ctxArte.imageSmoothingEnabled = false;
  // O upscale mora AQUI, e só aqui: é o `drawImage` de baixa→alta resolução com
  // suavização desligada que transforma o 3D em pixel art (§3).
  ctxAtlas.imageSmoothingEnabled = false;

  /* ---- 3. 72 quadros ---- */
  for (let dir = 0; dir < DIRECOES; dir++) {
    const giro = giroDaDirecao(dir);
    const destinoY = dir * alturaFrame;
    for (let col = 0; col < poses.length; col++) {
      const offsetY = ancoraArteY - deslocY[col];
      const caixa = caixas[dir * poses.length + col];
      const sujo: Retangulo = {
        x0: Math.floor(caixa.minX + ancoraArteX) - FOLGA_SUJO,
        y0: Math.floor(caixa.minY + offsetY) - FOLGA_SUJO,
        x1: Math.ceil(caixa.maxX + ancoraArteX) + FOLGA_SUJO,
        y1: Math.ceil(caixa.maxY + offsetY) + FOLGA_SUJO
      };
      ctxArte.clearRect(0, 0, larguraArte, alturaArte);
      desenhar(ctxArte, modelo, {
        pose: poses[col].pose,
        giro: giro,
        escala: artPorU,
        offsetX: ancoraArteX,
        offsetY: offsetY,
        paleta: opts.paleta,
        rampas: opts.rampas,
        rampaDaCor: opts.rampaDaCor,
        ganhoSombra: opts.ganhoSombra,
        // O contorno que sobra aqui é só o INTERNO (aresta de peça contra peça):
        // `model3d` o traça em px de arte inteiros, sem antialias, então ele
        // chega ao snap já na cor exata. A silhueta EXTERNA é do passe de
        // máscara de §2.1 — é ela que garante contorno fechado, sem furo (G4).
        corContorno: opts.corContorno,
        larguraContorno: opts.larguraContorno,
        quantizar: opts.quantizar
      });
      // §2.1 — snap para a paleta + contorno pela máscara, AINDA em px de arte.
      // Depois da ampliação seria tarde: o antialias já teria virado bloco.
      if (paletaSnap) snaparBuffer(ctxArte, larguraArte, alturaArte, paletaSnap, memoSnap, sujo);
      ctxAtlas.drawImage(
        arte,
        0,
        0,
        larguraArte,
        alturaArte,
        col * larguraFrame,
        destinoY,
        larguraFrame,
        alturaFrame
      );
    }
  }

  // §1.1 — a camada emissiva sai de UMA varredura do atlas pronto, não de 72
  // varreduras do buffer de arte: é a mesma informação por um custo de um
  // `getImageData` só. Depois desta linha nada mais lê pixel do atlas.
  atlas.emissivo = extrairEmissivo(canvas, atlas.larguraFolha, atlas.alturaFolha, coresEmissivas(opts));

  atlas.disponivel = true;
  atlas.msForja = Math.round((agora() - t0) * 10) / 10;
  return atlas;
}

/**
 * Fecha sobre o tamanho do quadro e devolve o localizador de §7.
 * Direção e quadro chegam normalizados: um `facing` fora de faixa devolve um
 * quadro válido em vez de um `NaN` que pintaria o atlas inteiro na tela.
 */
function fazerQuadro(
  larguraFrame: number,
  alturaFrame: number
): (dir: number, estado: Estado, frame: number) => { sx: number; sy: number } {
  return function quadro(dir: number, estado: Estado, frame: number) {
    const e: Estado = QUADROS_POR_ESTADO[estado] ? estado : 'parado';
    const col = COLUNA_DE_ESTADO[e] + normalizarQuadro(e, frame);
    return {
      sx: col * larguraFrame,
      sy: normalizarDirecao(dir) * alturaFrame
    };
  };
}

/* ================================================================== *
 * 5. Modulação por luz (§1 do docs/BESTIARIO.md)
 *
 * A técnica está documentada no cabeçalho do arquivo — leia lá antes de mexer
 * aqui. Este bloco é só a mecânica: quantizar o nível, achar/pintar o slot do
 * par (quadro, degrau) e devolver uma fonte pronta para `drawImage`.
 * ================================================================== */

/**
 * Degraus de luz. §1 pede "no máximo 8" — e 8 é o teto útil, não uma escolha
 * tímida: o degrau 7 é brilho pleno (nenhum tingimento, devolve o próprio
 * atlas), então sobram 7 níveis de sombra, um a cada ~7,4% de alfa. Abaixo
 * disso a diferença entre dois degraus vizinhos some no ruído do pixel art;
 * acima, o cache cresce sem ganho visível.
 */
export const DEGRAUS_LUZ = 8;

/**
 * Cor da sombra do tingimento, em componentes 0..255.
 *
 * É `RGB_COLD` de `./palette` dividido por dois — a mesma névoa fria que
 * `litColor` mistura no chão e nas paredes conforme a luz cai (§12 do
 * CONTRACTS.md), só que mais escura porque aqui ela entra como TINTA por cima
 * do sprite, não como mistura da cor base. Duplicada como número em vez de
 * importada de `./palette` de propósito: o forge não conhece as LUTs do
 * renderizador e não deve passar a conhecer por causa de três bytes.
 */
const SOMBRA_LUZ: readonly [number, number, number] = [13, 17, 24];

/**
 * Alfa da sombra no degrau 0 (a escuridão máxima que um inimigo visível pode
 * receber).
 *
 * Calibrado contra o que os inimigos GEOMÉTRICOS já fazem hoje: `litEntity` de
 * `./palette` multiplica a cor por `0.5 + 0.5·b`, ou seja, no nível 0 uma
 * entidade sai com metade do brilho. Com `Co = αs·Cs + (1−αs)·Cb` e uma sombra
 * quase preta, `αs = 0.52` reproduz esse mesmo meio-brilho. Isso importa porque
 * `sentinel` e `linker` continuam geométricos nesta fase (§7.3 do BESTIARIO):
 * o goblin em sprite e o sentinela em losango têm de escurecer JUNTOS, senão a
 * leitura de distância mente para o jogador.
 */
const ALFA_SOMBRA_MAX = 0.52;

/**
 * Slots do cache de tingimento — pares (quadro, degrau) vivos ao mesmo tempo.
 *
 * O universo de pares é 72 quadros × 7 degraus escuros = 504. Guardar os 504
 * seria uma folha de 504 quadros: ~12 MiB por personagem, para um conjunto de
 * trabalho que na prática tem o tamanho do número de inimigos na tela. 64 slots
 * cobrem esse conjunto com folga (um andar cheio de `chaser` visíveis é ~10) e
 * fixam a memória em ~1,4 MiB, independentemente do tamanho do bestiário.
 *
 * 64 = 8×8: o slot é endereçado como uma célula de uma folha quadrada, e o
 * `sx`/`sy` devolvido é o dessa célula. Mudar este número exige manter a
 * fatoração (ver `SLOTS_POR_LINHA`).
 */
const CAPACIDADE_CACHE = 64;
const SLOTS_POR_LINHA = 8;

/**
 * O cache de luz de um atlas: uma folha de slots + a contabilidade de LRU.
 *
 * Por que LRU e não FIFO: a rotação natural do jogo (o inimigo vira, anda, o
 * jogador se aproxima e o degrau muda) faz o conjunto de trabalho migrar aos
 * poucos. Um FIFO despejaria o quadro `parado` do inimigo que está imóvel na
 * porta só porque ele entrou primeiro; o LRU despeja o que ninguém pediu.
 *
 * Por que relógio lógico em `Float64Array` e não a ordem de inserção de um
 * `Map`: promover uma entrada num `Map` custa `delete` + `set` A CADA DESENHO
 * de cada inimigo — o caminho quente. Aqui o acerto é um `get` e uma escrita em
 * array tipado; a varredura dos 64 slots só acontece no despejo, que é o
 * caminho frio.
 */
interface CacheLuz {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  larguraSlot: number;
  alturaSlot: number;
  /** chave do par (quadro, degrau) → índice do slot. */
  porChave: Map<number, number>;
  /** slot → chave que ele guarda (−1 = livre). Necessário para despejar. */
  chaveDoSlot: Int32Array;
  /** slot → instante lógico do último uso. */
  usoDoSlot: Float64Array;
  relogio: number;
  ocupados: number;
  /* ---- diagnóstico ---- */
  tingimentos: number;
  despejos: number;
  /** Custo do PRIMEIRO tingimento (alocação da folha + 1 quadro), em ms. */
  msPrimeiro: number;
}

/**
 * Cache por atlas. `WeakMap`: reforjar o personagem cria um `AtlasPersonagem`
 * novo e a folha do antigo vira lixo coletável sem ninguém precisar avisar.
 */
let cacheLuz = new WeakMap<AtlasPersonagem, CacheLuz>();

/**
 * Descarta as folhas de luz em cache. Serve ao preview e aos testes; o jogo
 * nunca precisa chamar — o cache é limitado por construção.
 */
export function limparCacheLuz(): void {
  cacheLuz = new WeakMap<AtlasPersonagem, CacheLuz>();
}

/**
 * Quantiza o nível de luz em `DEGRAUS_LUZ` degraus.
 *
 * `nivelLuz` é NORMALIZADO em 0..1 — 0 = escuridão, 1 = brilho pleno. Quem tem
 * o `lvl` inteiro do renderizador (0..`LEVELS−1`) converte na chamada:
 * `quadroModulado(atlas, dir, estado, frame, lvl / (LEVELS - 1))`. Manter a
 * normalização do lado de fora é o que impede este módulo de importar as LUTs
 * do `IsoRenderer` e virar refém do número de níveis dele.
 *
 * Valor não finito cai em brilho pleno: um `NaN` vindo de uma divisão por zero
 * mostra o inimigo iluminado, não invisível.
 */
export function degrauDeLuz(nivelLuz: number): number {
  if (!Number.isFinite(nivelLuz)) return DEGRAUS_LUZ - 1;
  const d = Math.round(nivelLuz * (DEGRAUS_LUZ - 1));
  if (d <= 0) return 0;
  return d >= DEGRAUS_LUZ - 1 ? DEGRAUS_LUZ - 1 : d;
}

/** Cor de tingimento do degrau, já em `rgba()`. Só no caminho frio. */
function corDoDegrau(degrau: number): string {
  const a = ALFA_SOMBRA_MAX * (1 - degrau / (DEGRAUS_LUZ - 1));
  return (
    'rgba(' + SOMBRA_LUZ[0] + ',' + SOMBRA_LUZ[1] + ',' + SOMBRA_LUZ[2] + ',' +
    Math.round(a * 1000) / 1000 + ')'
  );
}

/**
 * Onde desenhar um quadro modulado.
 *
 * Mesmo formato de `atlas.canvas` + `atlas.quadro()`, de propósito: o
 * `IsoRenderer` troca uma chamada pela outra sem mudar o `drawImage`. A ÂNCORA
 * continua sendo a do atlas (`ancoraX`/`ancoraY`) — o slot tem exatamente o
 * tamanho do quadro, então nada se desloca.
 *
 *   const f = quadroModulado(atlas, dir, estado, frame, lvl / (LEVELS - 1));
 *   if (f.fonte) {
 *     const suave = ctx.imageSmoothingEnabled;
 *     ctx.imageSmoothingEnabled = false;
 *     ctx.drawImage(f.fonte, f.sx, f.sy, f.largura, f.altura,
 *                   Math.round(cx - atlas.ancoraX * z), Math.round(cy - atlas.ancoraY * z),
 *                   f.largura * z, f.altura * z);
 *     ctx.imageSmoothingEnabled = suave;
 *   }
 *
 * O objeto é NOVO a cada chamada (5 números e uma referência — o motor de JS
 * costuma nem alocar), mas o CANVAS por trás dele não é: nenhum pixel novo é
 * produzido enquanto o par (quadro, degrau) estiver no cache.
 */
export interface FonteQuadro {
  /** Folha de onde recortar. `null` só quando o atlas não pôde ser forjado. */
  fonte: HTMLCanvasElement | null;
  sx: number;
  sy: number;
  largura: number;
  altura: number;
  /** Degrau efetivamente aplicado (0..`DEGRAUS_LUZ−1`; o máximo é brilho pleno). */
  degrau: number;
  /**
   * `false` quando o quadro saiu em brilho pleno — degrau máximo, ou degradação
   * por falta de contexto 2D. Diagnóstico; o `drawImage` é o mesmo nos dois casos.
   */
  modulado: boolean;
}

/**
 * §1 — o quadro `(dir, estado, frame)` escurecido para `nivelLuz`, com as cores
 * emissivas preservadas em brilho pleno (§1.1).
 *
 * Nunca lança e nunca devolve `null`: sem contexto 2D (jsdom) devolve o quadro
 * cru, que é exatamente o que o chamador teria com `atlas.quadro()`. Degradar
 * para "claro demais" é o modo de falha certo — o inimigo continua na tela.
 *
 * Custo depois do cache quente: um `Map.get` com chave numérica, uma escrita em
 * `Float64Array` e a montagem do retorno. Nenhum canvas, nenhum `getImageData`,
 * nenhuma string, nenhum pixel.
 */
export function quadroModulado(
  atlas: AtlasPersonagem,
  dir: number,
  estado: Estado,
  frame: number,
  nivelLuz: number
): FonteQuadro {
  const q = atlas.quadro(dir, estado, frame);
  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const degrau = degrauDeLuz(nivelLuz);

  // Brilho pleno, atlas indisponível ou quadro degenerado: o atlas cru serve.
  if (!atlas.canvas || !atlas.disponivel || degrau >= DEGRAUS_LUZ - 1 || lw <= 0 || lh <= 0) {
    return semModulacao(atlas, q.sx, q.sy, lw, lh, degrau);
  }

  const cache = obterCacheLuz(atlas, lw, lh);
  if (!cache) return semModulacao(atlas, q.sx, q.sy, lw, lh, degrau);

  // Chave do par: o índice do quadro no retículo do atlas (derivado do próprio
  // `sx`/`sy`, para não haver uma segunda fórmula que possa divergir de
  // `quadro()`) combinado com o degrau.
  const idxQuadro = (q.sy / lh) * atlas.colunas + q.sx / lw;
  const chave = idxQuadro * DEGRAUS_LUZ + degrau;

  let slot = cache.porChave.get(chave);
  if (slot === undefined) {
    const t0 = cache.msPrimeiro < 0 ? agora() : 0;
    slot = reservarSlot(cache, chave);
    pintarSlot(atlas, cache, slot, degrau, q.sx, q.sy, lw, lh);
    cache.tingimentos++;
    if (cache.msPrimeiro < 0) cache.msPrimeiro = Math.round((agora() - t0) * 1000) / 1000;
  }
  cache.usoDoSlot[slot] = ++cache.relogio;

  return {
    fonte: cache.canvas,
    sx: (slot % SLOTS_POR_LINHA) * lw,
    sy: Math.floor(slot / SLOTS_POR_LINHA) * lh,
    largura: lw,
    altura: lh,
    degrau: degrau,
    modulado: true
  };
}

function semModulacao(
  atlas: AtlasPersonagem, sx: number, sy: number, lw: number, lh: number, degrau: number
): FonteQuadro {
  return {
    fonte: atlas.canvas,
    sx: sx,
    sy: sy,
    largura: lw,
    altura: lh,
    degrau: degrau,
    modulado: false
  };
}

/**
 * A folha de slots do atlas, alocada na primeira vez que um quadro escuro é
 * pedido — um personagem que nunca aparece no escuro não custa um byte.
 *
 * Uma falha de contexto 2D (jsdom) NÃO é memorizada aqui, e não precisa ser: o
 * caminho só chega neste ponto quando `atlas.canvas` existe, e um atlas com
 * canvas veio de um ambiente que sabe criar contexto. Se ainda assim falhar, o
 * custo do erro é uma tentativa de `createElement` por desenho — nunca um
 * lançamento.
 */
function obterCacheLuz(atlas: AtlasPersonagem, lw: number, lh: number): CacheLuz | null {
  const pronto = cacheLuz.get(atlas);
  // Um zoom novo não muda `larguraFrame` (o atlas é reforjado, e o cache segue
  // o objeto), mas a checagem é barata e transforma um bug de aliasing em
  // realocação silenciosa em vez de sprite recortado errado.
  if (pronto && pronto.larguraSlot === lw && pronto.alturaSlot === lh) return pronto;

  const linhas = Math.ceil(CAPACIDADE_CACHE / SLOTS_POR_LINHA);
  const cv = criarCanvas(SLOTS_POR_LINHA * lw, linhas * lh);
  const ctx = contexto(cv);
  if (!cv || !ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const chaveDoSlot = new Int32Array(CAPACIDADE_CACHE);
  chaveDoSlot.fill(-1);
  const cache: CacheLuz = {
    canvas: cv,
    ctx: ctx,
    larguraSlot: lw,
    alturaSlot: lh,
    porChave: new Map<number, number>(),
    chaveDoSlot: chaveDoSlot,
    usoDoSlot: new Float64Array(CAPACIDADE_CACHE),
    relogio: 0,
    ocupados: 0,
    tingimentos: 0,
    despejos: 0,
    msPrimeiro: -1
  };
  cacheLuz.set(atlas, cache);
  return cache;
}

/**
 * Slot livre, ou o menos recentemente usado. A varredura dos 64 slots roda só
 * quando o cache está cheio E o par pedido é novo — o caminho frio, que já vai
 * pagar três `drawImage`.
 */
function reservarSlot(cache: CacheLuz, chave: number): number {
  if (cache.ocupados < CAPACIDADE_CACHE) {
    const slot = cache.ocupados++;
    cache.chaveDoSlot[slot] = chave;
    cache.porChave.set(chave, slot);
    return slot;
  }
  let vitima = 0;
  let menor = Infinity;
  for (let i = 0; i < CAPACIDADE_CACHE; i++) {
    if (cache.usoDoSlot[i] < menor) {
      menor = cache.usoDoSlot[i];
      vitima = i;
    }
  }
  const antiga = cache.chaveDoSlot[vitima];
  if (antiga >= 0) cache.porChave.delete(antiga);
  cache.chaveDoSlot[vitima] = chave;
  cache.porChave.set(chave, vitima);
  cache.despejos++;
  return vitima;
}

/**
 * Pinta um slot: cópia do quadro → sombra com `source-atop` → camada emissiva
 * por cima.
 *
 * O `fillRect` limitado ao retângulo do slot é o que mantém os slots vizinhos
 * intactos: em `source-atop`, onde o alfa da FONTE é zero o destino não é
 * tocado (a fórmula está no cabeçalho do arquivo). É essa propriedade que
 * permite empilhar 64 quadros independentes numa folha só.
 *
 * O `clearRect` antes da cópia não é zelo: o slot pode estar sendo REUSADO
 * depois de um despejo, e `drawImage` compõe sobre o que havia ali.
 */
function pintarSlot(
  atlas: AtlasPersonagem,
  cache: CacheLuz,
  slot: number,
  degrau: number,
  sx: number,
  sy: number,
  lw: number,
  lh: number
): void {
  const fonte = atlas.canvas;
  if (!fonte) return;
  const dx = (slot % SLOTS_POR_LINHA) * lw;
  const dy = Math.floor(slot / SLOTS_POR_LINHA) * lh;
  const ctx = cache.ctx;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(dx, dy, lw, lh);
  ctx.drawImage(fonte, sx, sy, lw, lh, dx, dy, lw, lh);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = corDoDegrau(degrau);
  ctx.fillRect(dx, dy, lw, lh);
  ctx.globalCompositeOperation = 'source-over';
  // §1.1 — os olhos voltam ao brilho pleno DEPOIS da sombra, nunca antes.
  if (atlas.emissivo) ctx.drawImage(atlas.emissivo, sx, sy, lw, lh, dx, dy, lw, lh);
}

/* ------------------------------------------------------------------ *
 * 5.1 Camada emissiva (§1.1)
 * ------------------------------------------------------------------ */

/**
 * As cores que não escurecem, empacotadas em `0xRRGGBB` para comparação sem
 * alocação.
 *
 * Reúne a RAMPA EFETIVA de cada nome marcado (via `rampaEfetiva` de
 * `./model3d`), não só o tom declarado: a quantização de §4.3 manda cada face
 * do olho para um degrau da rampa conforme a orientação, então casar só com o
 * tom declarado deixaria as faces laterais do olho escurecendo enquanto a de
 * frente fica acesa — meio olho apagado, que é pior que olho nenhum.
 */
function coresEmissivas(opts: OpcoesForja): Set<number> | null {
  const nomes = opts.emissivas;
  if (!nomes || nomes.length === 0) return null;
  const saida = new Set<number>();
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    const rampa = rampaEfetiva(opts.paleta, nome, opts.rampas, opts.rampaDaCor);
    for (let k = 0; k < rampa.length; k++) {
      const c = lerHexRgb(rampa[k]);
      if (c) saida.add((c[0] << 16) | (c[1] << 8) | c[2]);
    }
    // A rampa efetiva já cobre o tom declarado; esta linha só socorre o caso de
    // um nome que não está na paleta e chegou como hex literal.
    if (rampa.length === 0) {
      const direto = lerHexRgb(nome);
      if (direto) saida.add((direto[0] << 16) | (direto[1] << 8) | direto[2]);
    }
  }
  return saida.size > 0 ? saida : null;
}

/**
 * Extrai a camada emissiva do atlas pronto: mesma folha, mesmo retículo, só os
 * pixels cuja cor está em `emissivos`; todo o resto transparente.
 *
 * Por que sobre o ATLAS e não sobre cada buffer de arte: é uma varredura em vez
 * de 72, e o snap de paleta de §2.1 já garantiu que cada pixel tem exatamente
 * uma das cores declaradas — a comparação é de igualdade, não de proximidade.
 * (Com `quantizar: false` ou sem `getImageData` o snap não roda e a camada sai
 * vazia; o preview de iluminação contínua perde os olhos acesos e nada mais.)
 *
 * Devolve `null` quando não há cor emissiva, quando o ambiente não expõe
 * `getImageData` (jsdom) ou quando nenhum pixel casou — e `null` custa zero no
 * caminho de desenho.
 */
function extrairEmissivo(
  fonte: HTMLCanvasElement,
  largura: number,
  altura: number,
  emissivos: Set<number> | null
): HTMLCanvasElement | null {
  if (!emissivos || largura <= 0 || altura <= 0) return null;
  const ctxFonte = contexto(fonte);
  if (!ctxFonte || typeof ctxFonte.getImageData !== 'function') return null;
  let img: ImageData;
  try {
    img = ctxFonte.getImageData(0, 0, largura, altura);
  } catch {
    return null;
  }
  const d = img.data;
  if (!d || d.length < largura * altura * 4) return null;

  let vivos = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 0 && emissivos.has((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])) {
      vivos++;
      continue;
    }
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = 0;
  }
  if (vivos === 0) return null;

  const cv = criarCanvas(largura, altura);
  const ctx = contexto(cv);
  if (!cv || !ctx) return null;
  try {
    ctx.putImageData(img, 0, 0);
  } catch {
    return null;
  }
  return cv;
}

/* ------------------------------------------------------------------ *
 * 5.2 Diagnóstico (painel de debug e bancada do gate G8)
 * ------------------------------------------------------------------ */

/** O que o cache de luz de um atlas está custando agora. */
export interface EstatisticasLuz {
  /** Slots ocupados (0..`CAPACIDADE_CACHE`). */
  slots: number;
  /** Teto de slots — a memória do cache não passa disto. */
  capacidade: number;
  /** Quantos tingimentos foram feitos ao todo (inclui os refeitos após despejo). */
  tingimentos: number;
  /**
   * Quantas vezes um par vivo foi despejado. Zero é o esperado no jogo; um
   * número que cresce a cada frame significa conjunto de trabalho maior que
   * `CAPACIDADE_CACHE` — o único cenário em que o cache voltaria a alocar
   * pixels todo frame.
   */
  despejos: number;
  /** Memória das folhas (slots + camada emissiva), em bytes. */
  bytes: number;
  /** Custo do primeiro tingimento em ms (alocação da folha + 1 quadro). −1 = ainda não houve. */
  msPrimeiro: number;
  /** Há camada emissiva neste atlas? */
  emissivo: boolean;
}

/**
 * Leitura do cache de luz. Pura: não aloca folha nenhuma, não muda o cache.
 *
 * Teto de memória por atlas:
 *   `CAPACIDADE_CACHE × larguraFrame × alturaFrame × 4` (folha de slots)
 * mais `larguraFolha × alturaFolha × 4` quando há camada emissiva.
 */
export function estatisticasModulacao(atlas: AtlasPersonagem): EstatisticasLuz {
  const cache = cacheLuz.get(atlas);
  const bytesEmissivo = atlas.emissivo ? atlas.larguraFolha * atlas.alturaFolha * 4 : 0;
  const bytesSlots = cache ? cache.canvas.width * cache.canvas.height * 4 : 0;
  return {
    slots: cache ? cache.ocupados : 0,
    capacidade: CAPACIDADE_CACHE,
    tingimentos: cache ? cache.tingimentos : 0,
    despejos: cache ? cache.despejos : 0,
    bytes: bytesSlots + bytesEmissivo,
    msPrimeiro: cache ? cache.msPrimeiro : -1,
    emissivo: atlas.emissivo !== null
  };
}
