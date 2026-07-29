/*
 * ISOROGUE — src/render/model3d.ts
 *
 * O pipeline 3D do personagem (§4 do docs/PERSONAGEM.md): rig hierárquico de
 * caixas orientadas → matrizes acumuladas → projeção isométrica → 6 faces por
 * caixa com back-face culling → fator de luz interpolado → quantização para a
 * rampa do material → ordem do pintor → traço de silhueta.
 *
 * O que este módulo é: matemática e rasterização GENÉRICAS. Ele não conhece o
 * guerreiro, não conhece o jogo, não conhece o atlas. Recebe uma árvore de nós,
 * uma pose, um giro e uma paleta, e pinta num `CanvasRenderingContext2D` em
 * coordenadas de ARTE (baixa resolução). Quem amplia ×PIXEL com
 * `imageSmoothingEnabled = false` é o sprite forge (§7) — nunca este arquivo.
 *
 * O que este módulo NÃO faz: não cria canvas, não anima, não usa `Math.random`,
 * não lê relógio. Duas chamadas com os mesmos argumentos produzem exatamente os
 * mesmos pixels — o atlas do §7 depende disso. O único estado mutável do módulo
 * é o registro de paleta (§3.1), que é configuração declarada uma vez na
 * inicialização, nunca dado de jogo.
 *
 * Duas assinaturas para as mesmas duas funções: além da forma por objeto de
 * opções (rica, com paleta explícita), `medirModelo` e `desenharModelo` aceitam
 * a forma POSICIONAL que `spriteForge.ts` documenta no próprio cabeçalho
 * (`(raiz, pose, yaw, artPorU)` e `(ctx, raiz, pose, yaw, origemX, origemY,
 * artPorU)`). São sobrecargas da mesma implementação — nenhuma duplicação de
 * lógica —, e existem para que o forge compile sem adaptador.
 *
 * Convenções (§3 do PERSONAGEM.md), espaço local do modelo, destro:
 *   +X = direita do personagem   +Y = frente (para onde ele olha)   +Z = cima
 *   origem (0,0,0) = centro dos pés, no chão.
 *
 * Degradação: `ctx` nulo (jsdom, §7.4 da ARQUITETURA-REACT.md) sai em silêncio.
 * Nada aqui lança.
 */

/* ================================================================== *
 * 1. Constantes de projeção, luz e acabamento
 * ================================================================== */

/**
 * §3 — px de arte por unidade `u` do modelo.
 *
 * Rodada 3 (§10): 1.25 reprovado por ORÇAMENTO DE PIXELS, não por forma. Com
 * 1.25 o corpo tinha ~24px de arte de altura; a referência só consegue a leitura
 * dela com ~114px. A 21% da resolução a viseira (0.9u = 1,1px), o umbo, o gorjal
 * e o vão entre as pernas são FISICAMENTE irrepresentáveis — nenhum ajuste de
 * forma salva I2 e I5 nesse orçamento.
 *
 * A troca é 1.25/PIXEL 2 → 2.5/PIXEL 1: o PRODUTO (px de TELA por `u`) não muda,
 * então o sprite continua com os mesmos ~45px de altura em zoom 1, a comparação
 * com `WALL_H = 36` de §3 continua valendo e nem o `IsoRenderer` nem a âncora
 * enxergam diferença. O que muda é só onde o detalhe é decidido: o buffer de arte
 * vai de 48×47 para 96×94 e o corpo de ~24 para ~48px de arte.
 *
 * O aspecto "chunky" NÃO vinha do `PIXEL = 2` — vem do snap de 10 cores com alpha
 * binário do sprite forge (§2.1 de `./spriteForge`), que continua intacto. Efeito
 * colateral desejado: o personagem para de ser mais grosso que o cenário, que já
 * é desenhado em 1px de tela.
 */
export const ART_POR_U = 2.5;

/**
 * §3 — px de tela por px de arte, em zoom 1. Quem aplica é o sprite forge, no
 * `drawImage` de baixa→alta resolução com `imageSmoothingEnabled = false`; mora
 * aqui só porque é a outra metade da escala canônica de §3.
 *
 * Rodada 3 (§10): 2 → 1, junto com `ART_POR_U`. Ver a nota lá — o produto
 * `ART_POR_U × PIXEL = 2.5` px de tela por `u` é o invariante de §3, e ele não
 * mudou.
 */
export const PIXEL = 1;

/** §4.2 — encolhimento horizontal da projeção. É 1.0: a razão 2:1 vem do 0.5 vertical. */
export const COS_ISO = 1.0;

/**
 * §4.3 — o observador está no "alto do nordeste" do modelo. Uma face é visível
 * quando sua normal (já rotacionada) tem produto escalar positivo com isto.
 * Não precisa estar normalizado: só o SINAL do produto decide o culling, e o
 * fator de luz normaliza por conta própria.
 */
export const DIR_VISAO: readonly [number, number, number] = [1, 1, 1];

/** §4.3 — fator da face de topo (normal +Z). */
export const FATOR_TOPO = 1.0;
/** §4.3 — fator da face de frente / esquerda visual (normal +Y). Casa com as paredes. */
export const FATOR_FRENTE = 0.82;
/** §4.3 — fator da face de lado / direita visual (normal +X). Casa com as paredes. */
export const FATOR_LADO = 0.68;

/**
 * Expansão de contraste aplicada ANTES da quantização.
 *
 * Por que ela existe: os fatores canônicos (1.00 / 0.82 / 0.68) foram calibrados
 * para iluminação contínua nas paredes. Multiplicados crus, topo-frente-lado
 * variam ~1.2 degrau numa rampa de 4 tons — as três orientações caem no MESMO
 * tom e o modelo fica chapado, sem leitura de volume. A expansão abre esse leque
 * até as três orientações canônicas caírem em três degraus distintos da rampa,
 * que é a leitura da referência (I1, §1).
 *
 * Calibração da rodada 2 (§10): 1.6 punia demais. Como `quantizar` nunca sobe
 * ACIMA do tom declarado — o alvo é `lumBase × efetivo`, e `efetivo ≤ 1` —, uma
 * caixa `ouroBase` produzia base/meio/sombra e `ouroLuz` NUNCA aparecia no
 * sprite: o guerreiro lia marrom, sem o dourado de I1. A cura é dupla: ganho
 * menor (1.15) e um realce que empurra o topo um degrau para cima
 * (`REALCE_TOPO`). Ver a tabela em `quantizar`.
 *
 * A expansão é linear e contínua: não reintroduz degrau ao girar (o degrau vem
 * da quantização, que é justamente o que dá a cara de pixel art).
 */
export const GANHO_SOMBRA = 1.15;

/**
 * Realce aplicado ao alvo de luminância antes de escolher o degrau da rampa.
 *
 * Sem ele o tom declarado é o TETO do que a peça pode mostrar, e a face de topo
 * fica presa nele; com ele o topo sobe um degrau e a rampa inteira do material
 * entra em jogo. Para uma caixa declarada `ouroBase` (§2) o resultado medido é:
 *
 * | face | normal | fator | efetivo | alvo | degrau |
 * |---|---|---|---|---|---|
 * | topo   | +Z | 1.00 | 1.000 | 210.7 | `ouroLuz`   |
 * | frente | +Y | 0.82 | 0.793 | 167.1 | `ouroBase`  |
 * | lado   | +X | 0.68 | 0.632 | 133.2 | `ouroMeio`  |
 *
 * e os vãos (peças declaradas `ouroMeio`, como gorjal e coxa) descem para
 * `ouroSombra` na face lateral — os 4 níveis de tom de I1, todos presentes.
 */
export const REALCE_TOPO = 1.25;

/**
 * Largura do traço que sela a costura entre faces vizinhas, em px de arte.
 * Preencher dois polígonos que compartilham uma aresta deixa um fio de fundo
 * aparecendo (o antialias de cada lado cobre ~metade do pixel). Contornar cada
 * face com a própria cor fecha isso sem mudar a silhueta.
 */
const SELAGEM = 0.5;

/**
 * Largura padrão do contorno de silhueta (§4.5) — 1px de arte, e desde a rodada
 * 2 (§10) o ÚNICO valor possível: `tracarContornoNitido` acende pixels inteiros,
 * não traça linha. O campo `larguraContorno` sobrevive como liga/desliga.
 */
export const LARGURA_CONTORNO = 1;

/** Abaixo disto uma face é considerada de perfil e descartada. */
const EPS_VISIVEL = 1e-6;

/* ================================================================== *
 * 2. Tipos do rig (§4.1)
 * ================================================================== */

/** Uma caixa orientada, no espaço do NÓ a que pertence. Dimensões em `u`. */
export interface Caixa {
  /** Centro da caixa no espaço do nó. */
  cx: number;
  cy: number;
  cz: number;
  /** Dimensões: largura (X), profundidade (Y), altura (Z). */
  sx: number;
  sy: number;
  sz: number;
  /** Chave de cor na paleta. É o TOM declarado — o que a face de topo recebe. */
  cor: string;
  /** Desenha o contorno de silhueta desta peça (§4.5). Padrão: `true`. */
  contorno?: boolean;
}

/** Nó do rig. O pivô é a posição do nó no espaço do PAI; a rotação é aplicada nele. */
export interface No {
  nome: string;
  pivo: readonly [number, number, number];
  caixas: readonly Caixa[];
  filhos?: readonly No[];
}

/** Rotação de um nó, em radianos. Ordem de aplicação: Z → Y → X (yaw, pitch, roll). */
export interface RotacaoNo {
  rx?: number;
  ry?: number;
  rz?: number;
}

/**
 * Pose: rotação por nome de nó. Nós ausentes ficam em repouso (rotação zero).
 * Um nome errado é silencioso por construção — o nó simplesmente não roda.
 */
export interface Pose {
  [nomeDoNo: string]: RotacaoNo;
}

/* ================================================================== *
 * 3. Paleta de materiais e quantização (§4.3)
 * ================================================================== */

/**
 * Tom declarado com a rampa do material a que pertence. A rampa pode vir em
 * qualquer ordem: ela é reordenada por luminância e deduplicada na normalização.
 */
export interface Tom {
  /** Todos os tons do material, em cor CSS hexadecimal. */
  rampa: readonly string[];
  /** Posição do tom declarado dentro de `rampa` (antes da reordenação). */
  indice: number;
}

/** Entrada de paleta: só a cor (rampa derivada) ou a cor com a rampa do material. */
export type EntradaPaleta = string | Tom;

/**
 * Paleta: nome de cor → entrada. Um `Record<string, string>` de cores hex (a
 * `PALETA_GUERREIRO` da §2, por exemplo) É uma paleta válida — nesse caso a
 * rampa de cada cor é derivada dela mesma. Para usar as rampas canônicas do
 * material, passe `rampas` + `rampaDaCor` nas opções, ou monte com `criarPaleta`.
 */
export type Paleta3D = Readonly<Record<string, EntradaPaleta>>;

/** Rampas por material: nome do material → nomes de cor que o compõem. */
export type RampasPorMaterial = Readonly<Record<string, readonly string[]>>;

/** Material de cada cor: nome de cor → nome do material. */
export type MaterialPorCor = Readonly<Record<string, string>>;

/** Cor RGB 0..255. */
type Rgb = [number, number, number];

/** Rampa normalizada de um tom: hexes ordenados do mais escuro ao mais claro. */
interface TomNormalizado {
  hex: string[];
  lum: number[];
  /** RGB do tom declarado (o que a face de topo recebe). */
  rgb: Rgb;
  /** Luminância do tom declarado. */
  lumBase: number;
}

/** Fatores da rampa derivada quando o material não declara os próprios tons. */
const RAMPA_DERIVADA = [0.42, 0.66, 1, 1.34];

function limitar(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Lê `#rgb` ou `#rrggbb`. Entrada inválida vira magenta de depuração — nunca lança. */
function lerHex(hex: string): Rgb {
  let s = typeof hex === 'string' ? hex.trim() : '';
  if (s.charAt(0) === '#') s = s.slice(1);
  if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return [255, 0, 255];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function comp(v: number): string {
  const n = Math.round(limitar(v, 0, 255));
  return n < 16 ? '0' + n.toString(16) : n.toString(16);
}

function paraHex(c: Rgb): string {
  return '#' + comp(c[0]) + comp(c[1]) + comp(c[2]);
}

/** Luminância perceptual (mesmos pesos do `desat` de palette.ts). */
function lum(c: Rgb): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function multiplicar(c: Rgb, f: number): Rgb {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/**
 * Normaliza uma lista de hexes numa rampa utilizável: deduplica e ordena do
 * mais escuro ao mais claro. Ordenação por luminância torna o módulo indiferente
 * a quem escreveu a rampa "do claro para o escuro" ou vice-versa.
 */
function normalizarRampa(hexes: readonly string[]): { hex: string[]; lum: number[] } {
  const vistos = new Set<string>();
  const pares: { h: string; l: number }[] = [];
  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i];
    if (typeof h !== 'string') continue;
    const chave = h.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    pares.push({ h: h, l: lum(lerHex(h)) });
  }
  // Empate de luminância resolvido pela ordem de declaração: determinístico.
  pares.sort((a, b) => a.l - b.l);
  const hex: string[] = [];
  const lums: number[] = [];
  for (let i = 0; i < pares.length; i++) {
    hex.push(pares[i].h);
    lums.push(pares[i].l);
  }
  if (hex.length === 0) {
    hex.push('#ff00ff');
    lums.push(lum([255, 0, 255]));
  }
  return { hex: hex, lum: lums };
}

/** Rampa de 4 tons derivada de uma única cor, para materiais sem rampa própria. */
function rampaDerivada(base: Rgb): string[] {
  const saida: string[] = [];
  for (let i = 0; i < RAMPA_DERIVADA.length; i++) saida.push(paraHex(multiplicar(base, RAMPA_DERIVADA[i])));
  return saida;
}

function montarTom(hexDeclarado: string, rampa: readonly string[] | null): TomNormalizado {
  const rgb = lerHex(hexDeclarado);
  const bruta = rampa && rampa.length > 0 ? rampa : rampaDerivada(rgb);
  const norm = normalizarRampa(bruta);
  return { hex: norm.hex, lum: norm.lum, rgb: rgb, lumBase: lum(rgb) };
}

/**
 * Monta uma paleta rica a partir das cores e (opcionalmente) das rampas de
 * material. Atalho de conveniência: passar `cores`, `rampas` e `rampaDaCor`
 * direto nas opções de desenho tem exatamente o mesmo efeito.
 */
export function criarPaleta(
  cores: Readonly<Record<string, string>>,
  rampas?: RampasPorMaterial,
  rampaDaCor?: MaterialPorCor
): Paleta3D {
  const saida: Record<string, EntradaPaleta> = {};
  const nomes = Object.keys(cores);
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    const hex = cores[nome];
    const material = rampaDaCor ? rampaDaCor[nome] : undefined;
    const tons = rampas && material ? rampas[material] : undefined;
    if (tons && tons.length > 0) {
      const hexes: string[] = [];
      let indice = 0;
      for (let k = 0; k < tons.length; k++) {
        const chave = tons[k];
        const h = cores[chave];
        hexes.push(typeof h === 'string' ? h : chave);
        if (chave === nome) indice = k;
      }
      saida[nome] = { rampa: hexes, indice: indice };
    } else {
      saida[nome] = hex;
    }
  }
  return saida;
}

/* --- normalização com cache (a mesma paleta é usada nos 72 quadros) --- */

interface PaletaCache {
  rampas: RampasPorMaterial | undefined;
  rampaDaCor: MaterialPorCor | undefined;
  cores: Readonly<Record<string, string>>;
  mapa: Map<string, TomNormalizado>;
}

const CACHE_PALETA = new WeakMap<object, PaletaCache>();

function hexDaEntrada(e: EntradaPaleta): string {
  if (typeof e === 'string') return e;
  const i = limitar(Math.round(e.indice), 0, Math.max(0, e.rampa.length - 1));
  const h = e.rampa[i];
  return typeof h === 'string' ? h : '#ff00ff';
}

function normalizarPaleta(
  paleta: Paleta3D,
  rampas?: RampasPorMaterial,
  rampaDaCor?: MaterialPorCor
): Map<string, TomNormalizado> {
  const cache = CACHE_PALETA.get(paleta);
  if (cache && cache.rampas === rampas && cache.rampaDaCor === rampaDaCor) return cache.mapa;

  const cores: Record<string, string> = {};
  const nomes = Object.keys(paleta);
  for (let i = 0; i < nomes.length; i++) cores[nomes[i]] = hexDaEntrada(paleta[nomes[i]]);

  const mapa = new Map<string, TomNormalizado>();
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    const entrada = paleta[nome];
    let rampa: readonly string[] | null = null;
    if (typeof entrada !== 'string' && entrada.rampa.length > 0) {
      rampa = entrada.rampa;
    } else {
      const material = rampaDaCor ? rampaDaCor[nome] : undefined;
      const tons = rampas && material ? rampas[material] : undefined;
      if (tons && tons.length > 0) {
        const hexes: string[] = [];
        for (let k = 0; k < tons.length; k++) {
          const h = cores[tons[k]];
          hexes.push(typeof h === 'string' ? h : tons[k]);
        }
        rampa = hexes;
      }
    }
    mapa.set(nome, montarTom(cores[nome], rampa));
  }

  CACHE_PALETA.set(paleta, { rampas: rampas, rampaDaCor: rampaDaCor, cores: cores, mapa: mapa });
  return mapa;
}

/**
 * Todos os hexes que a quantização de §4.3 pode produzir para uma cor da paleta:
 * a rampa DECLARADA do material quando existe, ou a rampa derivada
 * (`RAMPA_DERIVADA`) quando o material não declara a sua. Ordenados do mais
 * escuro ao mais claro, deduplicados.
 *
 * Existe para quem precisa saber, de fora, em que cores uma peça pode terminar
 * sem reimplementar a derivação — hoje o único chamador é a extração da camada
 * EMISSIVA do sprite forge (§1.1 do docs/BESTIARIO.md), que precisa reconhecer
 * os pixels do olho do goblin depois da rasterização, quando o nome da cor já
 * não existe mais e só sobrou RGB. Ter duas cópias da derivação é exatamente
 * como uma cor emissiva deixaria de ser reconhecida em silêncio.
 *
 * Nome ausente da paleta devolve lista vazia — nunca lança.
 */
export function rampaEfetiva(
  paleta: Paleta3D,
  nome: string,
  rampas?: RampasPorMaterial,
  rampaDaCor?: MaterialPorCor
): readonly string[] {
  const tom = normalizarPaleta(paleta, rampas, rampaDaCor).get(nome);
  return tom ? tom.hex : [];
}

/** Cor desconhecida: se parecer hex, usa-se ela mesma; senão, cinza médio. */
function tomDeFallback(cor: string): TomNormalizado {
  const hex = typeof cor === 'string' && cor.charAt(0) === '#' ? cor : '#808080';
  return montarTom(hex, null);
}

/* ------------------------------------------------------------------ *
 * 3.1 Registro de paleta (a ponte com a forma posicional)
 *
 * A forma posicional de `desenharModelo` (a que `spriteForge.ts` chama) não tem
 * onde passar paleta: o forge é agnóstico de personagem e não conhece cor. Como
 * este módulo também não pode conhecer o guerreiro, a cor entra por um registro
 * declarado UMA vez na inicialização — por modelo, ou como padrão do processo.
 *
 * Quem compõe (o `IsoRenderer`, o preview de §10, um teste) faz:
 *
 *   registrarPaleta(MODELO_GUERREIRO, {
 *     paleta: PALETA_GUERREIRO, rampas: RAMPAS_GUERREIRO, rampaDaCor: RAMPA_DA_COR
 *   });
 *
 * Sem registro nenhum o modelo sai em cinza — visível e fácil de diagnosticar,
 * em vez de silenciosamente errado.
 * ------------------------------------------------------------------ */

/** Paleta + rampas de um modelo. */
export interface ConfigPaleta {
  paleta: Paleta3D;
  rampas?: RampasPorMaterial;
  rampaDaCor?: MaterialPorCor;
}

const REGISTRO_PALETA = new WeakMap<No, ConfigPaleta>();

/** Padrão do processo. Configuração, não estado de jogo — não afeta determinismo. */
let paletaPadrao: ConfigPaleta | null = null;

/** Associa uma paleta à raiz de um rig. Vale para a árvore inteira. */
export function registrarPaleta(modelo: No, cfg: ConfigPaleta): void {
  REGISTRO_PALETA.set(modelo, cfg);
}

/** Paleta usada quando o modelo não tem registro próprio. `null` desfaz. */
export function definirPaletaPadrao(cfg: ConfigPaleta | null): void {
  paletaPadrao = cfg;
}

const SEM_PALETA: ConfigPaleta = { paleta: {} };

function resolverPaleta(explicita: Paleta3D | undefined, modelo: No): ConfigPaleta {
  if (explicita) return { paleta: explicita };
  return REGISTRO_PALETA.get(modelo) ?? paletaPadrao ?? SEM_PALETA;
}

/**
 * §4.3 — fator de luz INTERPOLADO pelo ângulo entre a normal e cada eixo.
 * Nada de "escolher o eixo mais próximo": isso cria degraus ao girar. O peso de
 * cada eixo é o cosseno do ângulo (clampado em zero), e o fator é a média
 * ponderada — contínua em toda a esfera visível.
 */
export function fatorLuz(nx: number, ny: number, nz: number): number {
  const px = nx > 0 ? nx : 0;
  const py = ny > 0 ? ny : 0;
  const pz = nz > 0 ? nz : 0;
  const soma = px + py + pz;
  // Só acontece em face totalmente afastada — que o culling já descartou.
  if (soma <= EPS_VISIVEL) return FATOR_LADO;
  return (px * FATOR_LADO + py * FATOR_FRENTE + pz * FATOR_TOPO) / soma;
}

/**
 * §4.3 — multiplica o RGB do tom pelo fator (expandido por `ganho`) e quantiza
 * o resultado para o degrau mais próximo da rampa do material, comparando por
 * luminância. Sem esta quantização o modelo vira 3D com iluminação contínua e
 * perde a cara de pixel art.
 */
function quantizar(tom: TomNormalizado, fator: number, ganho: number): string {
  const efetivo = 1 - (1 - fator) * ganho;
  // `REALCE_TOPO` antes de escolher o degrau: sem ele o tom declarado é o TETO
  // da peça e o degrau mais claro da rampa nunca aparece (ver a constante).
  const alvo = tom.lumBase * (efetivo > 0 ? efetivo : 0) * REALCE_TOPO;
  let melhor = 0;
  let dist = Infinity;
  for (let i = 0; i < tom.lum.length; i++) {
    const d = Math.abs(tom.lum[i] - alvo);
    // `<` estrito: empate fica com o tom mais escuro (o primeiro). Determinístico.
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  }
  return tom.hex[melhor];
}

/** Caminho sem quantização (depuração / preview de iluminação contínua). */
function corContinua(tom: TomNormalizado, fator: number, ganho: number): string {
  const efetivo = 1 - (1 - fator) * ganho;
  return paraHex(multiplicar(tom.rgb, efetivo > 0 ? efetivo : 0));
}

/* ================================================================== *
 * 4. Matemática de matriz 4×4 (guardada em 3×4 — a última linha é 0,0,0,1)
 * ================================================================== */

/** Matriz afim 3×4 em ordem linha-maior: [m00 m01 m02 tx  m10 … tz]. */
export type Mat = number[];

/** Matriz identidade nova. */
export function matIdentidade(): Mat {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
}

/**
 * Translação para o pivô combinada com a rotação Z → Y → X do nó:
 * `M = T(p) · Rx(rx) · Ry(ry) · Rz(rz)`. Aplicada a um vértice, gira primeiro em
 * Z, depois em Y, depois em X, e só então translada — que é a ordem do §4.1.
 */
export function matPivoRotacao(
  px: number, py: number, pz: number,
  rx: number, ry: number, rz: number
): Mat {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz, -cy * sz, sy, px,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, py,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy, pz
  ];
}

/** Produto `a · b` (aplica `b` primeiro). Devolve matriz nova — nunca aliasa. */
export function matMultiplicar(a: Mat, b: Mat): Mat {
  const saida: Mat = new Array<number>(12);
  for (let l = 0; l < 3; l++) {
    const o = l * 4;
    const a0 = a[o], a1 = a[o + 1], a2 = a[o + 2], a3 = a[o + 3];
    saida[o] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    saida[o + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    saida[o + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    saida[o + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
  }
  return saida;
}

/** Transforma um PONTO (com translação). Escreve em `saida` e a devolve. */
export function matPonto(m: Mat, x: number, y: number, z: number, saida: number[]): number[] {
  saida[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
  saida[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
  saida[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  return saida;
}

/**
 * Transforma uma DIREÇÃO (sem translação). Como só há rotações — a parte 3×3 é
 * ortonormal —, isto serve também para normais: elas continuam unitárias.
 */
export function matDirecao(m: Mat, x: number, y: number, z: number, saida: number[]): number[] {
  saida[0] = m[0] * x + m[1] * y + m[2] * z;
  saida[1] = m[4] * x + m[5] * y + m[6] * z;
  saida[2] = m[8] * x + m[9] * y + m[10] * z;
  return saida;
}

/* ================================================================== *
 * 5. Achatamento do rig (§4.1)
 * ================================================================== */

/** Uma caixa já resolvida no espaço do mundo, com a matriz acumulada do seu nó. */
export interface PecaAchatada {
  /** O nó dono da caixa — só para depuração; a geometria já está em `m`. */
  no: No;
  caixa: Caixa;
  /** Matriz acumulada raiz→nó. Compartilhada pelas caixas do mesmo nó: só leitura. */
  m: Mat;
  /** Ordem de declaração (profundidade primeiro, caixas na ordem do array). */
  ordem: number;
}

/**
 * Percorre a árvore aplicando pivôs e rotações da pose, acumulando matrizes, e
 * devolve a lista plana de caixas em ordem de declaração. A ordem é o desempate
 * determinístico da ordem do pintor (§4.4) — não a altere.
 */
export function achatarRig(raiz: No, pose?: Pose, base?: Mat): PecaAchatada[] {
  const saida: PecaAchatada[] = [];
  visitarNo(raiz, pose, base ?? matIdentidade(), saida);
  return saida;
}

function visitarNo(no: No, pose: Pose | undefined, paiM: Mat, saida: PecaAchatada[]): void {
  const rot: RotacaoNo | undefined = pose ? pose[no.nome] : undefined;
  const p = no.pivo;
  const local = matPivoRotacao(
    p[0], p[1], p[2],
    rot && typeof rot.rx === 'number' ? rot.rx : 0,
    rot && typeof rot.ry === 'number' ? rot.ry : 0,
    rot && typeof rot.rz === 'number' ? rot.rz : 0
  );
  const m = matMultiplicar(paiM, local);

  const caixas = no.caixas;
  for (let i = 0; i < caixas.length; i++) {
    saida.push({ no: no, caixa: caixas[i], m: m, ordem: saida.length });
  }
  const filhos = no.filhos;
  if (filhos) {
    for (let i = 0; i < filhos.length; i++) visitarNo(filhos[i], pose, m, saida);
  }
}

/* ================================================================== *
 * 6. Projeção isométrica (§4.2)
 * ================================================================== */

/**
 * §4.2, exatamente:
 *   artX = (x − y) · (escala · COS_ISO)
 *   artY = (x + y) · (escala · 0.5) − z · escala
 * A razão 2:1 horizontal e o 0.5 vertical são os mesmos do mundo (TW/TH = 2),
 * então o personagem senta no losango do tile com a perspectiva das paredes.
 */
export function projetarX(x: number, y: number, escala: number): number {
  return (x - y) * (escala * COS_ISO);
}

export function projetarY(x: number, y: number, z: number, escala: number): number {
  return (x + y) * (escala * 0.5) - z * escala;
}

/**
 * Giro em Z (radianos) que faz a FRENTE do modelo (+Y) apontar para o delta do
 * grid `(dx, dy)`.
 *
 * Atenção — armadilha do §5: `Math.atan2(dy, dx)` alinha o eixo +X do modelo com
 * o delta, não o +Y. Como a frente é +Y (§3), o giro correto é
 * `atan2(dy, dx) − π/2`, que é o que esta função devolve. Verificação do gate G3:
 * leste do grid `(1, 0)` → giro −π/2 → frente = (1, 0) = leste → na tela,
 * baixo-direita.
 */
export function giroParaFrente(dx: number, dy: number): number {
  return Math.atan2(-dx, dy);
}

/* ================================================================== *
 * 7. Topologia do cubo
 * ================================================================== */

/* Vértice `i`: bit 0 → X, bit 1 → Y, bit 2 → Z (0 = −1, 1 = +1). */
const VERT_X = [-1, 1, -1, 1, -1, 1, -1, 1];
const VERT_Y = [-1, -1, 1, 1, -1, -1, 1, 1];
const VERT_Z = [-1, -1, -1, -1, 1, 1, 1, 1];

/* Faces: 0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z. */
const FACE_NX = [1, -1, 0, 0, 0, 0];
const FACE_NY = [0, 0, 1, -1, 0, 0];
const FACE_NZ = [0, 0, 0, 0, 1, -1];

/** Os 4 vértices de cada face, em anel. */
const FACE_VERTS: readonly (readonly number[])[] = [
  [1, 3, 7, 5],
  [0, 4, 6, 2],
  [2, 6, 7, 3],
  [0, 1, 5, 4],
  [4, 5, 7, 6],
  [0, 2, 3, 1]
];

/**
 * Face vizinha através de cada aresta do anel acima (aresta `k` liga
 * `FACE_VERTS[f][k]` a `FACE_VERTS[f][(k+1)%4]`). É a tabela que permite achar a
 * silhueta de uma peça em O(faces): a aresta pertence à silhueta quando a
 * vizinha do outro lado está descartada pelo culling.
 */
const FACE_VIZINHA: readonly (readonly number[])[] = [
  [5, 2, 4, 3],
  [3, 4, 2, 5],
  [1, 4, 0, 5],
  [5, 0, 4, 1],
  [3, 0, 2, 1],
  [1, 2, 0, 3]
];

/* ================================================================== *
 * 8. Montagem: faces projetadas, ordenadas, com silhueta
 * ================================================================== */

/** Geometria pura — o que basta para medir o modelo. */
export interface OpcoesGeometria {
  pose?: Pose;
  /** Giro em Z aplicado à raiz antes de projetar (facing, §5). Ver `giroParaFrente`. */
  giro?: number;
  /** px de arte por `u`. Padrão: `ART_POR_U`. */
  escala?: number;
  /** Deslocamento em px de arte, somado à projeção (centralização no buffer). */
  offsetX?: number;
  offsetY?: number;
}

/** Tudo o que o desenho precisa. */
export interface OpcoesModelo extends OpcoesGeometria {
  /** Nome de cor → cor hex, ou → tom com rampa. Ver `Paleta3D`. */
  paleta: Paleta3D;
  /** Rampas canônicas por material (opcional; casa com `rampaDaCor`). */
  rampas?: RampasPorMaterial;
  /** Material de cada cor (opcional; casa com `rampas`). */
  rampaDaCor?: MaterialPorCor;
  /** Expansão de contraste antes da quantização. Padrão: `GANHO_SOMBRA`. */
  ganhoSombra?: number;
  /**
   * Cor do contorno de silhueta. `undefined` procura a chave `contorno` na
   * paleta; `null` desliga o contorno.
   */
  corContorno?: string | null;
  /**
   * Largura do contorno. Desde a rodada 2 (§10) o traço é rasterizado em px de
   * arte INTEIROS (ver `tracarContornoNitido`), então ele vale sempre 1px e
   * este número virou um LIGA/DESLIGA: `0` desliga, qualquer valor > 0 liga.
   * Padrão: `LARGURA_CONTORNO`.
   */
  larguraContorno?: number;
  /** `false` desliga a quantização (preview de iluminação contínua). Padrão: `true`. */
  quantizar?: boolean;
}

/** Uma face pronta para pintar, em coordenadas de arte. */
export interface FaceDesenho {
  /** 8 números: x0,y0, x1,y1, x2,y2, x3,y3. */
  pts: number[];
  cor: string;
  /** §4.4 — `wx + wy + wz` do centro da face. Menor = mais ao fundo. */
  profundidade: number;
  /** Índice da peça achatada (ordem de declaração) — desempate determinístico. */
  peca: number;
  /** Índice da face no cubo (0..5) — segundo desempate. */
  face: number;
}

/**
 * Caixa da silhueta em px de ARTE, medida a partir da projeção da origem
 * (0,0,0) do modelo — que é o centro dos pés, no chão. É o que o sprite forge
 * usa para dimensionar o quadro e achar a âncora.
 */
export interface CaixaArte {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** `CaixaArte` com as dimensões já calculadas. */
export interface Limites extends CaixaArte {
  largura: number;
  altura: number;
}

/** O modelo pronto para o traço: faces ordenadas + contornos + limites. */
export interface ModeloMontado {
  /** Ordenadas do fundo para a frente (§4.4). */
  faces: FaceDesenho[];
  /**
   * Alinhado com `faces`: quando não for `null`, contém os segmentos de
   * silhueta (x0,y0,x1,y1, …) a traçar DEPOIS daquela face — é a última face
   * visível da peça, então o contorno sai por cima das faces dela e por baixo
   * das peças mais à frente (§4.5).
   */
  contornoApos: (number[] | null)[];
  corContorno: string | null;
  larguraContorno: number;
  limites: Limites;
}

function limitesVazios(): Limites {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0, largura: 0, altura: 0 };
}

/**
 * Converte a forma posicional `(pose, yaw, artPorU)` — a que o sprite forge usa
 * — na forma por opções. Discriminada pelo TIPO do 3º argumento, não pelo
 * formato do 2º: `yaw` numérico só existe na forma posicional.
 */
function normalizarGeometria(
  a: OpcoesGeometria | Pose | undefined,
  yaw: number | undefined,
  artPorU: number | undefined
): OpcoesGeometria {
  if (typeof yaw === 'number') {
    return {
      pose: a as Pose | undefined,
      giro: yaw,
      escala: typeof artPorU === 'number' ? artPorU : ART_POR_U
    };
  }
  return (a as OpcoesGeometria | undefined) ?? {};
}

/** Projeta os 8 vértices de cada caixa e devolve os limites. Não gera face nenhuma. */
export function medirModelo(raiz: No, opts?: OpcoesGeometria): Limites;
/** Forma posicional (sprite forge): `medirModelo(raiz, pose, yaw, artPorU)`. */
export function medirModelo(
  raiz: No,
  pose: Pose | undefined,
  yaw: number,
  artPorU?: number
): Limites;
export function medirModelo(
  raiz: No,
  a?: OpcoesGeometria | Pose,
  yaw?: number,
  artPorU?: number
): Limites {
  const opts = normalizarGeometria(a, yaw, artPorU);
  const escala = typeof opts.escala === 'number' ? opts.escala : ART_POR_U;
  const ox = typeof opts.offsetX === 'number' ? opts.offsetX : 0;
  const oy = typeof opts.offsetY === 'number' ? opts.offsetY : 0;
  const giro = typeof opts.giro === 'number' ? opts.giro : 0;
  const pecas = achatarRig(raiz, opts.pose, matPivoRotacao(0, 0, 0, 0, 0, giro));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const p: number[] = [0, 0, 0];
  for (let i = 0; i < pecas.length; i++) {
    const c = pecas[i].caixa;
    const m = pecas[i].m;
    const hx = c.sx * 0.5, hy = c.sy * 0.5, hz = c.sz * 0.5;
    for (let v = 0; v < 8; v++) {
      matPonto(m, c.cx + VERT_X[v] * hx, c.cy + VERT_Y[v] * hy, c.cz + VERT_Z[v] * hz, p);
      const ax = projetarX(p[0], p[1], escala) + ox;
      const ay = projetarY(p[0], p[1], p[2], escala) + oy;
      if (ax < minX) minX = ax;
      if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay;
      if (ay > maxY) maxY = ay;
    }
  }
  if (!isFinite(minX)) return limitesVazios();
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, largura: maxX - minX, altura: maxY - minY };
}

/**
 * Achata o rig, projeta, descarta as faces de costas, ilumina, quantiza,
 * ordena pela ordem do pintor e extrai as silhuetas. Puro: nenhum canvas
 * envolvido — dá para testar sem DOM.
 */
export function montarModelo(raiz: No, opts: OpcoesModelo): ModeloMontado {
  const escala = typeof opts.escala === 'number' ? opts.escala : ART_POR_U;
  const ox = typeof opts.offsetX === 'number' ? opts.offsetX : 0;
  const oy = typeof opts.offsetY === 'number' ? opts.offsetY : 0;
  const giro = typeof opts.giro === 'number' ? opts.giro : 0;
  const ganho = typeof opts.ganhoSombra === 'number' ? opts.ganhoSombra : GANHO_SOMBRA;
  const usaQuantizacao = opts.quantizar !== false;
  const largura = typeof opts.larguraContorno === 'number' ? opts.larguraContorno : LARGURA_CONTORNO;
  const tons = normalizarPaleta(opts.paleta, opts.rampas, opts.rampaDaCor);

  let corContorno: string | null;
  if (opts.corContorno === undefined) {
    const doPaleta = opts.paleta['contorno'];
    corContorno = doPaleta === undefined ? null : hexDaEntrada(doPaleta);
  } else {
    corContorno = opts.corContorno;
  }

  const pecas = achatarRig(raiz, opts.pose, matPivoRotacao(0, 0, 0, 0, 0, giro));
  const faces: FaceDesenho[] = [];
  const silhuetas: (number[] | null)[] = new Array<number[] | null>(pecas.length);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Buffers reaproveitados entre peças: nada de alocar 8 arrays por caixa.
  const wx = new Array<number>(8);
  const wy = new Array<number>(8);
  const wz = new Array<number>(8);
  const ax = new Array<number>(8);
  const ay = new Array<number>(8);
  const nx = new Array<number>(6);
  const ny = new Array<number>(6);
  const nz = new Array<number>(6);
  const visivel = new Array<boolean>(6);
  const p: number[] = [0, 0, 0];

  for (let i = 0; i < pecas.length; i++) {
    const caixa = pecas[i].caixa;
    const m = pecas[i].m;
    const hx = caixa.sx * 0.5, hy = caixa.sy * 0.5, hz = caixa.sz * 0.5;

    for (let v = 0; v < 8; v++) {
      matPonto(m, caixa.cx + VERT_X[v] * hx, caixa.cy + VERT_Y[v] * hy, caixa.cz + VERT_Z[v] * hz, p);
      wx[v] = p[0];
      wy[v] = p[1];
      wz[v] = p[2];
      const px = projetarX(p[0], p[1], escala) + ox;
      const py = projetarY(p[0], p[1], p[2], escala) + oy;
      ax[v] = px;
      ay[v] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    // Normais no mundo + back-face culling (§4.3).
    for (let f = 0; f < 6; f++) {
      matDirecao(m, FACE_NX[f], FACE_NY[f], FACE_NZ[f], p);
      nx[f] = p[0];
      ny[f] = p[1];
      nz[f] = p[2];
      const dot = p[0] * DIR_VISAO[0] + p[1] * DIR_VISAO[1] + p[2] * DIR_VISAO[2];
      visivel[f] = dot > EPS_VISIVEL;
    }

    const tom = tons.get(caixa.cor) ?? tomDeFallback(caixa.cor);
    const desenhaContorno = caixa.contorno !== false;
    let segmentos: number[] | null = null;

    for (let f = 0; f < 6; f++) {
      if (!visivel[f]) continue;
      const vs = FACE_VERTS[f];
      const v0 = vs[0], v1 = vs[1], v2 = vs[2], v3 = vs[3];
      const fator = fatorLuz(nx[f], ny[f], nz[f]);
      faces.push({
        pts: [ax[v0], ay[v0], ax[v1], ay[v1], ax[v2], ay[v2], ax[v3], ay[v3]],
        cor: usaQuantizacao ? quantizar(tom, fator, ganho) : corContinua(tom, fator, ganho),
        // §4.4 — profundidade do centro da face.
        profundidade:
          (wx[v0] + wy[v0] + wz[v0] + wx[v1] + wy[v1] + wz[v1] +
            wx[v2] + wy[v2] + wz[v2] + wx[v3] + wy[v3] + wz[v3]) * 0.25,
        peca: i,
        face: f
      });

      if (!desenhaContorno) continue;
      // §4.5 — aresta de silhueta: a face do outro lado está descartada.
      const viz = FACE_VIZINHA[f];
      for (let k = 0; k < 4; k++) {
        if (visivel[viz[k]]) continue;
        const a = vs[k];
        const b = vs[(k + 1) & 3];
        if (segmentos === null) segmentos = [];
        segmentos.push(ax[a], ay[a], ax[b], ay[b]);
      }
    }

    silhuetas[i] = segmentos;
  }

  // §4.4 — do fundo para a frente; empate pela ordem de declaração, depois pela
  // face. Sem isso, dois quadros idênticos poderiam sair com pixels diferentes.
  faces.sort(
    (a, b) => a.profundidade - b.profundidade || a.peca - b.peca || a.face - b.face
  );

  // O contorno de uma peça é traçado logo depois da última face dela.
  const contornoApos: (number[] | null)[] = new Array<number[] | null>(faces.length);
  for (let i = 0; i < faces.length; i++) contornoApos[i] = null;
  const ultima = new Array<number>(pecas.length);
  for (let i = 0; i < pecas.length; i++) ultima[i] = -1;
  for (let i = 0; i < faces.length; i++) ultima[faces[i].peca] = i;
  for (let i = 0; i < pecas.length; i++) {
    const pos = ultima[i];
    if (pos >= 0 && silhuetas[i] !== null) contornoApos[pos] = silhuetas[i];
  }

  const limites: Limites = isFinite(minX)
    ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY, largura: maxX - minX, altura: maxY - minY }
    : limitesVazios();

  return {
    faces: faces,
    contornoApos: contornoApos,
    corContorno: corContorno,
    larguraContorno: largura,
    limites: limites
  };
}

/* ================================================================== *
 * 9. Rasterização
 * ================================================================== */

/**
 * Traça os segmentos de silhueta de uma peça em px de arte INTEIROS.
 *
 * Por que não `ctx.stroke()`: em px de arte um traço de 1px cai quase sempre em
 * coordenada fracionária, e o Canvas 2D o antialiasa — o pixel resultante é uma
 * MISTURA do contorno com a face por baixo. Depois do snap de paleta do sprite
 * forge essa mistura vai para o degrau errado: medido na rodada 1 (§10), a
 * silhueta da crista traçada sobre o topo do elmo (`ouroLuz` puro) saía `couro`
 * e `ouroMeio`, e 86,6% do sprite terminava fora da paleta.
 *
 * Aqui os extremos são levados para a grade e o segmento vira uma corrente de
 * quadrados 1×1 (Bresenham) acumulados num único `Path2D` implícito: uma
 * chamada de `fill()` por peça, exatamente como era uma de `stroke()`. Cor
 * chapada, zero antialias, determinístico.
 */
function tracarContornoNitido(
  ctx: CanvasRenderingContext2D,
  seg: number[],
  cor: string
): void {
  ctx.beginPath();
  for (let k = 0; k + 3 < seg.length; k += 4) {
    const ax = seg[k];
    const ay = seg[k + 1];
    const bx = seg[k + 2];
    const by = seg[k + 3];
    if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) continue;
    let x = Math.floor(ax);
    let y = Math.floor(ay);
    const xf = Math.floor(bx);
    const yf = Math.floor(by);
    const dx = Math.abs(xf - x);
    const dy = -Math.abs(yf - y);
    const sx = x < xf ? 1 : -1;
    const sy = y < yf ? 1 : -1;
    let err = dx + dy;
    // Trava de sanidade: a diagonal do buffer de arte é da ordem de dezenas de
    // px; centenas de passos só aconteceriam com geometria doente.
    const limite = dx - dy + 2;
    for (let n = 0; n <= limite; n++) {
      ctx.rect(x, y, 1, 1);
      if (x === xf && y === yf) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  ctx.fillStyle = cor;
  ctx.fill();
}

function caminhoFace(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  ctx.lineTo(pts[2], pts[3]);
  ctx.lineTo(pts[4], pts[5]);
  ctx.lineTo(pts[6], pts[7]);
  ctx.closePath();
}

/**
 * Pinta um modelo já montado no contexto, em coordenadas de ARTE (baixa
 * resolução). Quem amplia ×PIXEL com `imageSmoothingEnabled = false` é o sprite
 * forge (§3 e §7) — inverter essa ordem produz 3D liso em vez de pixel art.
 *
 * `ctx` nulo sai em silêncio (jsdom).
 */
export function pintarModelo(ctx: CanvasRenderingContext2D | null, modelo: ModeloMontado): void {
  if (!ctx) return;
  const faces = modelo.faces;
  ctx.save();
  ctx.miterLimit = 2;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    caminhoFace(ctx, f.pts);
    ctx.fillStyle = f.cor;
    ctx.fill();
    // Selagem da costura entre faces vizinhas — mesma cor, traço fino.
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = f.cor;
    ctx.lineWidth = SELAGEM;
    ctx.stroke();

    const seg = modelo.contornoApos[i];
    if (seg && modelo.corContorno && modelo.larguraContorno > 0) {
      tracarContornoNitido(ctx, seg, modelo.corContorno);
    }
  }
  ctx.restore();
}

/**
 * O caminho completo: monta e pinta. É esta a função que o sprite forge chama
 * uma vez por quadro do atlas (8 direções × 9 quadros = 72), nunca por frame de
 * jogo. Determinística: mesmos argumentos ⇒ mesmos pixels.
 *
 * `ctx` nulo sai em silêncio, sem montar nada (jsdom, §7.4 da ARQUITETURA).
 */
export function desenharModelo(
  ctx: CanvasRenderingContext2D | null,
  raiz: No,
  opts: OpcoesModelo
): void;
/**
 * Forma posicional (sprite forge):
 * `desenharModelo(ctx, raiz, pose, yaw, origemX, origemY, artPorU)`.
 * A origem do modelo (centro dos pés) cai em `(origemX, origemY)` no buffer de
 * arte. A paleta vem do registro de §3.1 — ou do 8º argumento, se dado.
 */
export function desenharModelo(
  ctx: CanvasRenderingContext2D | null,
  raiz: No,
  pose: Pose | undefined,
  yaw: number,
  origemX?: number,
  origemY?: number,
  artPorU?: number,
  paleta?: Paleta3D
): void;
export function desenharModelo(
  ctx: CanvasRenderingContext2D | null,
  raiz: No,
  a: OpcoesModelo | Pose | undefined,
  yaw?: number,
  origemX?: number,
  origemY?: number,
  artPorU?: number,
  paleta?: Paleta3D
): void {
  if (!ctx) return;
  let opts: OpcoesModelo;
  if (typeof yaw === 'number') {
    const cfg = resolverPaleta(paleta, raiz);
    opts = {
      paleta: cfg.paleta,
      rampas: cfg.rampas,
      rampaDaCor: cfg.rampaDaCor,
      pose: a as Pose | undefined,
      giro: yaw,
      offsetX: typeof origemX === 'number' ? origemX : 0,
      offsetY: typeof origemY === 'number' ? origemY : 0,
      escala: typeof artPorU === 'number' ? artPorU : ART_POR_U
    };
  } else {
    opts = a as OpcoesModelo;
  }
  pintarModelo(ctx, montarModelo(raiz, opts));
}
