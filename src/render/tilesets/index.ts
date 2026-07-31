/*
 * ISOROGUE — src/render/tilesets/index.ts
 *
 * O REGISTRO DE TILESETS, um por nível de masmorra.
 *
 * Este diretório é a ÚNICA casa do terreno: paleta, blocos de piso, bloco de
 * parede e adereços de cada andar moram num arquivo próprio (`nivel1.ts`,
 * `nivel2.ts`, …) e chegam ao renderer por esta tabela. O `IsoRenderer` não
 * conhece grama nem areia — ele pergunta "qual é o tileset deste andar?" e
 * desenha o que vier.
 *
 * É a mesma disciplina de `RETRATOS` no bestiário, e existe pela mesma razão:
 * quando o dono entregar a referência do nível 2, a mudança tem de ser UM
 * arquivo novo mais UMA linha aqui — nunca um `if (depth === 2)` espalhado
 * pelo desenho.
 *
 * ═══ O QUE UM NÍVEL NOVO PRECISA ENTREGAR ═══
 *
 *   1. um arquivo `nivelN.ts` neste diretório, no molde de `nivel1.ts`,
 *      exportando paleta, rampas, mapa cor→rampa, emissivas, os rigs de piso,
 *      o rig de parede e os adereços;
 *   2. a calibração do bloco respeitando `ladoDoTile` (a conta está no
 *      cabeçalho de `nivel1.ts`: 5·S = `CONFIG.TW` ⇒ S = 12,8u) e a âncora em
 *      z = 0 (topo do piso no plano do chão; parede subindo dali);
 *   3. uma linha em `TILESETS` abaixo.
 *
 * O que um nível novo NÃO precisa: tocar no renderer, no engine ou no oracle.
 * Terreno é aparência — a masmorra que o engine gera é a mesma.
 */

import type { No, Pose } from '../model3d';
import { ART_POR_U, PIXEL } from '../model3d';
import {
  CORES_EMISSIVAS_NIVEL1,
  MODELO_FLORES,
  MODELO_FLORES_TURQUESA,
  MODELO_PAREDE_CAPIM,
  MODELO_PAREDE_FOLHAGEM,
  MODELO_PAREDE_SEBE,
  MODELO_PAREDE_SUCULENTA,
  MODELO_PAREDE_TIJOLO,
  MODELO_PISO_LAJOTA,
  MODELO_PISO_TIJOLO,
  MODELO_PISO_TIJOLO_GRAMA,
  MODELO_FLOR_LARANJA,
  MODELO_MOITA,
  MODELO_PEDRA,
  MODELO_PISO_AGUA,
  MODELO_PISO_AREIA,
  MODELO_PISO_GRAMA,
  MODELO_PISO_TERRA,
  MODELO_TUFO,
  PALETA_NIVEL1,
  POSE_PARADA_NIVEL1,
  PROPORCOES_NIVEL1,
  RAMPAS_NIVEL1,
  RAMPA_DA_COR_NIVEL1
} from './nivel1';

/** Uma paleta de tileset: nome de cor → hexadecimal, como nos personagens. */
export type PaletaTileset = Readonly<Record<string, string>>;

/**
 * O contrato que todo nível entrega ao renderer.
 *
 * `piso` é indexado pelo BUCKET de decoração que o mapa já produz
 * (`map.decor[i] & 7`, o mesmo que hoje escolhe a variação de cor do losango):
 * a lista pode ter menos de oito entradas, e o renderer fecha o índice com
 * módulo. É o que dá variedade determinística sem o tileset precisar conhecer
 * a geração de mapa.
 *
 * `adereços` seguem a mesma regra: sorteados por tile a partir do decor, de
 * forma determinística. Lista vazia = andar sem adereço, e nada quebra.
 */
export interface Tileset {
  /** Nome de exibição, para o cofre e para a bancada de revisão. */
  readonly nome: string;
  readonly paleta: PaletaTileset;
  readonly rampas: Readonly<Record<string, readonly string[]>>;
  readonly rampaDaCor: Readonly<Record<string, string>>;
  readonly emissivas: readonly string[];
  /** Repouso do rig — terreno não articula, então é sempre vazio. */
  readonly repouso: Pose;
  /** Variantes de piso, escolhidas pelo bucket de decor. Nunca vazia. */
  readonly piso: readonly No[];
  /** O bloco alto. Sujeito ao sistema de transparência do canto frontal. */
  readonly parede: No;
  /**
   * TODAS as paredes do mesmo material do andar — a muralha viva do nível 1 são
   * quatro sebes diferentes (folhas arredondadas, capim, folhagem grande e
   * suculenta), e a referência do dono é justamente um mostruário de variantes.
   *
   * Por que uma LISTA e não um `if` no renderer: é o mesmo contrato de `piso`.
   * O renderer fecha o índice com módulo sobre o bucket que o mapa já produz
   * (`map.decor[i] & 7`), e com isso a variação sai DETERMINÍSTICA e por TILE —
   * a mesma parede na mesma casa em toda partida com a mesma semente, sem o
   * render sortear nada (sortear no desenho é como um replay deixa de bater).
   *
   * Duas regras que este campo carrega:
   *
   *   1. `parede` continua sendo A parede — é ela que o renderer desenha hoje, e
   *      é ela que responde pelo alfa do canto frontal. Enquanto o sorteio por
   *      tile não entrar, esta lista é rig revisado à espera; o dia em que
   *      entrar, é uma linha lá e nada aqui;
   *   2. `parede` PRECISA ser uma das variantes. Se não fosse, ligar o sorteio
   *      trocaria o visual de todo o andar de uma vez — a lista existe para
   *      ACRESCENTAR variedade, nunca para substituir o que já se viu na tela.
   *
   * Lista vazia é legítima: o andar não varia e todo tile usa `parede`.
   */
  readonly paredesVariantes: readonly No[];
  /** Piso especial de água, quando o tileset tem um. */
  readonly agua: No | null;
  /**
   * Quanto o topo da água afunda abaixo do plano do chão, em **px de tela a
   * zoom 1** — não em `u`, porque quem consome é o renderer e ele trabalha em
   * px (o fator `ART_POR_U × PIXEL` é assunto da forja, não dele).
   *
   * Existe porque dois efeitos de TELA precisam saber onde está a lâmina
   * d'água e não têm como descobrir: o brilho que corre pela poça e a
   * cachoeira que escorre pela borda. Sem este número os dois desenhariam no
   * plano do chão seco, acima da lâmina, e o fluxo nasceria no ar.
   *
   * Tileset sem água declara 0 e nada o consulta.
   */
  readonly aguaAfundaPx: number;
  /** Adereços que ficam em cima do piso. Pode ser vazia. */
  readonly aderecos: readonly No[];
  /**
   * Uma SEGUNDA parede, de outro material (no nível 1: alvenaria de tijolo com
   * grama por cima). Fica pronta para o renderer alternar parede por sala e
   * quebrar a monotonia do andar; enquanto ele não usa, o rig já está revisado
   * e não custa nada — atlas só é forjado quando alguém pede.
   */
  readonly paredeAlternativa: No | null;
}

/**
 * "Ruínas Verdes" — o andar 1: grama, terra batida, areia e poças, com tufos,
 * pedras, moitas e flores. A flor laranja é o único adereço emissivo.
 *
 * As PAREDES são muralha viva: sebes densas e intransponíveis, no lugar do
 * barranco de terra que o andar tinha. É leitura de regra, não estilo — parede
 * de terra com grama por cima usa exatamente as mesmas cores do piso de grama,
 * e o que separava "chão" de "obstáculo" era só a altura. Sebe é outro material,
 * outro verde e outra textura: não dá para confundir com o gramado nem de
 * relance, que é o que se pede de uma parede.
 */
export const TILESET_NIVEL1: Tileset = {
  nome: 'Ruínas Verdes',
  paleta: PALETA_NIVEL1,
  rampas: RAMPAS_NIVEL1,
  rampaDaCor: RAMPA_DA_COR_NIVEL1,
  emissivas: CORES_EMISSIVAS_NIVEL1,
  repouso: POSE_PARADA_NIVEL1,
  /* A ordem É a distribuição: o bucket de decor indexa esta lista. Contando os
   * oito slots: grama pura em 2 (0 e 3), terra em 2 (2 e 6), lajota, areia,
   * tijolo-com-grama e tijolo em 1 cada. Ou seja, VERDE em 3 dos 8 se o tijolo
   * com grama contar, e a areia é a exceção com 1 — a proporção da referência.
   * (Esta contagem dizia "grama em 5 dos 8", o que nunca bateu com a lista
   * abaixo; o número saiu daqui para a bancada de terreno antes de alguém
   * conferir. Se mexer na lista, refaça a conta na mão.) */
  piso: [
    MODELO_PISO_GRAMA,
    MODELO_PISO_LAJOTA,
    MODELO_PISO_TERRA,
    MODELO_PISO_GRAMA,
    MODELO_PISO_AREIA,
    MODELO_PISO_TIJOLO_GRAMA,
    MODELO_PISO_TERRA,
    MODELO_PISO_TIJOLO
  ],
  parede: MODELO_PAREDE_SEBE,
  /* A ordem É a distribuição, como em `piso`: a sebe de folhas arredondadas
   * abre a lista porque é a mais neutra das quatro — ela é o verde de fundo
   * contra o qual o capim claro, a folhagem grande e a suculenta escura se
   * distinguem. E é a mesma de `parede` acima, pela regra 2 do contrato. */
  paredesVariantes: [
    MODELO_PAREDE_SEBE,
    MODELO_PAREDE_CAPIM,
    MODELO_PAREDE_FOLHAGEM,
    MODELO_PAREDE_SUCULENTA
  ],
  paredeAlternativa: MODELO_PAREDE_TIJOLO,
  agua: MODELO_PISO_AGUA,
  /* Em px de tela: a calibração do rig é em `u`, e é aqui que ela vira o número
   * que o renderer entende. Derivado, nunca digitado duas vezes — mudar
   * `afundamentoAgua` em nivel1.ts move a lâmina, o brilho e a cachoeira juntos. */
  aguaAfundaPx: PROPORCOES_NIVEL1.afundamentoAgua * ART_POR_U * PIXEL,
  aderecos: [
    MODELO_TUFO, MODELO_PEDRA, MODELO_MOITA,
    MODELO_FLORES, MODELO_FLORES_TURQUESA, MODELO_FLOR_LARANJA
  ]
};

/**
 * O registro por profundidade. Uma linha por nível; a ausência cai no
 * fallback de `tilesetDoNivel`.
 */
export const TILESETS: Readonly<Record<number, Tileset>> = {
  1: TILESET_NIVEL1
};

/**
 * O tileset de um andar. Enquanto os outros níveis não existem, todos usam o
 * do nível 1 — degradar para um terreno conhecido é melhor do que desenhar
 * nada, e o dia em que o nível 2 chegar é uma linha em `TILESETS`.
 */
export function tilesetDoNivel(depth: number): Tileset {
  const t = TILESETS[depth];
  return t ?? TILESET_NIVEL1;
}

export { PROPORCOES_NIVEL1 as PROPORCOES_TILE };
