/*
 * ISOROGUE — test/forjaPixel.test.ts
 * ==================================================================
 * ÂNCORA 1: a FORJA DE ATLAS rodando de verdade, sobre pixels de verdade.
 *
 * Por que este arquivo existe. Até aqui a camada de render não tinha um único
 * teste que executasse o pipeline de forja: `test/render.test.ts` monta um
 * `document` de mentira cujo contexto (`contextoMudo`, :504) OMITE
 * `getImageData`/`putImageData` DE PROPÓSITO — e é barato justamente por isso.
 * A consequência é que `snaparBuffer` (`spriteForge.ts:690`) sai em silêncio na
 * primeira linha (`:698`) e o passe 2, o CONTORNO POR MÁSCARA (`:740-765`),
 * nunca rodou em teste algum. Os dois passes são o acabamento inteiro do sprite
 * — alpha binário, fechamento de paleta e silhueta fechada (gates G4/G5) — e
 * são exatamente o que a rodada do `modoContorno` vai mexer.
 *
 * A DIVISÃO DE TRABALHO com os testes irmãos, para ninguém procurar aqui o que
 * não está aqui:
 *
 *   render.test.ts       — o RENDERIZADOR: quem foi colado, onde, com que alfa.
 *                          Não é teste de pixel e não deve virar um (o cabeçalho
 *                          dele, :36-41, declara isso). `contextoMudo` continua
 *                          barato porque os describes de lá dependem disso.
 *   model3d-cor.test.ts  — a REGIÃO DE COR de `model3d`: `montarModelo` e o
 *                          traço de `pintarModelo`, por hash, SEM canvas.
 *   este arquivo         — a FORJA: `forjarAtlas` com `desenhar`/`medir`
 *                          injetados sobre um canvas de SOFTWARE, medindo os
 *                          BYTES da folha.
 *
 * Os helpers são IRMÃOS, não substitutos.
 *
 * ------------------------------------------------------------------
 * O QUE ESTE ARQUIVO NÃO PROVA, dito em voz alta
 *
 * Com `desenhar` injetado, `desenharModelo` não roda: nada aqui julga projeção,
 * sombreamento, ordem do pintor ou o contorno INTERNO de peça contra peça —
 * isso é território das âncoras 2 e 3. O que fica travado aqui é o
 * ACABAMENTO que a forja aplica DEPOIS do pintor, seja ele qual for: snap de
 * paleta, alpha binário, contorno de silhueta pela máscara, o blit para a
 * célula certa da folha 9×8 e a extração da camada emissiva.
 *
 * A figura pintada é um retângulo de duas metades de cores diferentes — a coisa
 * mais previsível que ainda exercita os dois passes. Cada número deste arquivo
 * é derivável no papel a partir dela, e é isso que faz vermelho aqui ser
 * diagnóstico em vez de susto.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  Limites,
  MaterialPorCor,
  No,
  OpcoesGeometria,
  OpcoesModelo,
  Paleta3D,
  Pose,
  RampasPorMaterial
} from '../src/render/model3d';
import {
  DIRECOES,
  ORDEM_ESTADOS,
  QUADROS_POR_ESTADO,
  TOTAL_QUADROS,
  forjarAtlas,
  limparCacheAtlas
} from '../src/render/spriteForge';
import type {
  AtlasPersonagem,
  DesenhaModelo,
  MedeModelo,
  OpcoesForja
} from '../src/render/spriteForge';

/* ================================================================== *
 * 1. O canvas de SOFTWARE
 *
 * A superfície emulada foi MEDIDA lendo `spriteForge.ts`, e é só ela:
 *
 *   HTMLCanvasElement — `document.createElement('canvas')` (:945), `width`/
 *     `height` atribuídos DEPOIS de criar (:946-947), `typeof cv.getContext`
 *     (:952), `cv.getContext('2d')` dentro de try/catch (:953-958), e o próprio
 *     canvas viajando como FONTE de `drawImage` (:1189).
 *   CanvasRenderingContext2D — `imageSmoothingEnabled` (:1148, :1151, só
 *     escrita), `clearRect` (:1166), `typeof getImageData`/`typeof putImageData`
 *     (:698), `getImageData(rx,ry,rw,rh)` (:706), `putImageData(img,rx,ry)`
 *     (:767), `drawImage` na forma de 9 argumentos (:1188-1198) e, em
 *     `extrairEmissivo`, `getImageData(0,0,l,a)` (:1653) + `putImageData(img,0,0)`
 *     (:1677).
 *
 * Fora daí não há nada: sem `globalAlpha`, sem `save`/`restore` no caminho da
 * forja, sem a forma de 7 argumentos do `putImageData`, sem opções de
 * `getContext`, sem a classe global `ImageData` (`snaparBuffer:704` só DECLARA
 * o tipo — não há `new ImageData` nem `instanceof`, então `{data,width,height}`
 * basta). Emular a mais é convidar um teste a travar comportamento que o código
 * nunca pede.
 *
 * QUATRO DECISÕES QUE NÃO SÃO DETALHE — cada uma foi motivo de bug no protótipo:
 *
 *   1. `getImageData` devolve CÓPIA, nunca uma janela do buffer.
 *      `extrairEmissivo` muta `img.data` in place (:1666-1669) e só depois joga
 *      o resultado em OUTRO canvas (:1677). Com uma janela, essa mutação
 *      APAGARIA O ATLAS — e o sintoma não é exceção, é atlas transparente, e só
 *      quando `opts.emissivas` existe.
 *   2. O buffer mora no CANVAS e `getContext` é MEMOIZADO, ligado ao vivo.
 *      `drawImage` (:1189) recebe um canvas como fonte, e o canvas do atlas tem
 *      `getContext('2d')` pedido DUAS vezes (:1127 e :1649): se cada chamada
 *      devolvesse um contexto com buffer próprio, a camada emissiva leria um
 *      atlas vazio.
 *   3. `clearRect` limpa DE VERDADE. Os 72 quadros reusam o mesmo buffer de
 *      arte; um no-op funde as 72 silhuetas e o teste de borda vira ruído.
 *   4. O buffer é realocado na ATRIBUIÇÃO de `width`/`height`, que acontecem
 *      depois da criação — como no canvas real, onde atribuir dimensão zera a
 *      superfície.
 * ================================================================== */

/** O que `getImageData` devolve e `putImageData` aceita. Ver a nota de `ImageData` acima. */
interface DadosDeImagem {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * O estado de um canvas de software. Mora aqui, e não no fecho do contexto,
 * porque é o CANVAS que é passado adiante (fonte de `drawImage`) e é ele que
 * pode ser reconsultado por um segundo `getContext`.
 */
interface EstadoCanvas {
  largura: number;
  altura: number;
  bytes: Uint8ClampedArray;
  /** Memoizado: o mesmo objeto para todo `getContext('2d')` deste canvas. */
  ctx: CanvasRenderingContext2D | null;
}

/**
 * As duas pontes de volta ao buffer. Existem porque o forge trafega
 * `HTMLCanvasElement`/`CanvasRenderingContext2D` (tipos do DOM), e o teste
 * precisa reencontrar os bytes por trás deles — na hora do `drawImage`, na
 * leitura da folha e no pintor injetado.
 */
const ESTADO_POR_CANVAS = new WeakMap<object, EstadoCanvas>();
const ESTADO_POR_CONTEXTO = new WeakMap<object, EstadoCanvas>();

function realocar(est: EstadoCanvas): void {
  const n = est.largura > 0 && est.altura > 0 ? est.largura * est.altura * 4 : 0;
  est.bytes = new Uint8ClampedArray(n);
}

/**
 * Os métodos de TRAÇO que `model3d.pintarModelo` consulta.
 *
 * Eles são inertes e não fazem parte da superfície da forja: `spriteForge` não
 * chama um só deles. Existem para o único caso deste arquivo que roda SEM
 * injeção (a chave do cache), onde `desenharModelo` de verdade entra em cena e
 * lançaria em `ctx.save()`. A consequência é declarada: sem rasterizador de
 * polígono, aquele atlas sai transparente — e o caso assere exatamente isso, em
 * vez de fingir que mediu pixel.
 *
 * A lista é a mesma de `contextoAnotador` em `test/model3d-cor.test.ts`, que é
 * onde o traço É medido.
 */
function metodosDeTraco(): Record<string, unknown> {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    closePath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    rect(): void {},
    fill(): void {},
    stroke(): void {}
  };
}

function criarContextoDePixels(est: EstadoCanvas): CanvasRenderingContext2D {
  const alvo = {
    ...metodosDeTraco(),

    /* Ninguém LÊ este campo — o forge só escreve (`:1148`, `:1151`). Ele existe
     * para a atribuição não estourar em modo estrito e para documentar que a
     * ampliação ×PIXEL é por vizinho mais próximo, que é o que `drawImage`
     * abaixo faz. */
    imageSmoothingEnabled: false,

    clearRect(x: number, y: number, w: number, h: number): void {
      const bytes = est.bytes;
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(est.largura, Math.floor(x + w));
      const y1 = Math.min(est.altura, Math.floor(y + h));
      for (let j = y0; j < y1; j++) {
        const linha = j * est.largura;
        for (let i = x0; i < x1; i++) {
          const k = (linha + i) * 4;
          bytes[k] = 0;
          bytes[k + 1] = 0;
          bytes[k + 2] = 0;
          bytes[k + 3] = 0;
        }
      }
    },

    /** CÓPIA — ver a decisão 1 do cabeçalho desta seção. */
    getImageData(x: number, y: number, w: number, h: number): DadosDeImagem {
      const saida = new Uint8ClampedArray(w > 0 && h > 0 ? w * h * 4 : 0);
      const bytes = est.bytes;
      for (let j = 0; j < h; j++) {
        const oy = y + j;
        if (oy < 0 || oy >= est.altura) continue;
        for (let i = 0; i < w; i++) {
          const ox = x + i;
          if (ox < 0 || ox >= est.largura) continue;
          const o = (oy * est.largura + ox) * 4;
          const d = (j * w + i) * 4;
          saida[d] = bytes[o];
          saida[d + 1] = bytes[o + 1];
          saida[d + 2] = bytes[o + 2];
          saida[d + 3] = bytes[o + 3];
        }
      }
      return { data: saida, width: w, height: h };
    },

    putImageData(img: DadosDeImagem, x: number, y: number): void {
      const bytes = est.bytes;
      for (let j = 0; j < img.height; j++) {
        const ty = y + j;
        if (ty < 0 || ty >= est.altura) continue;
        for (let i = 0; i < img.width; i++) {
          const tx = x + i;
          if (tx < 0 || tx >= est.largura) continue;
          const o = (j * img.width + i) * 4;
          const t = (ty * est.largura + tx) * 4;
          bytes[t] = img.data[o];
          bytes[t + 1] = img.data[o + 1];
          bytes[t + 2] = img.data[o + 2];
          bytes[t + 3] = img.data[o + 3];
        }
      }
    },

    /**
     * A forma de 9 argumentos, a única que a forja usa (:1188-1198), com
     * amostragem por VIZINHO MAIS PRÓXIMO — o `imageSmoothingEnabled = false`
     * de `:1151` em ato.
     *
     * Com `pixel = 1` vale `larguraFrame === larguraArte`, e mesmo assim isto
     * NÃO é cópia identidade: o destino é `(col·larguraFrame, dir·alturaFrame)`,
     * um blit para a célula (dir, col) da folha 9×8. Com `pixel = k > 1` a MESMA
     * chamada vira replicação de bloco k×k.
     *
     * Escrita direta em vez de composição `source-over`: cada célula da folha é
     * escrita UMA vez e nasce transparente, e nessa condição os dois operadores
     * dão bit a bit o mesmo resultado (fonte opaca vence; fonte de alfa 0 sobre
     * destino de alfa 0 continua vazio). Emular Porter-Duff aqui seria código
     * sem consequência observável.
     */
    drawImage(
      fonte: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ): void {
      const origem = ESTADO_POR_CANVAS.get(fonte as object);
      if (!origem) throw new Error('drawImage recebeu uma fonte que não é canvas de software');
      if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
      const destino = est.bytes;
      for (let j = 0; j < dh; j++) {
        const ty = dy + j;
        if (ty < 0 || ty >= est.altura) continue;
        const oy = sy + Math.floor((j * sh) / dh);
        if (oy < 0 || oy >= origem.altura) continue;
        for (let i = 0; i < dw; i++) {
          const tx = dx + i;
          if (tx < 0 || tx >= est.largura) continue;
          const ox = sx + Math.floor((i * sw) / dw);
          if (ox < 0 || ox >= origem.largura) continue;
          const o = (oy * origem.largura + ox) * 4;
          const t = (ty * est.largura + tx) * 4;
          destino[t] = origem.bytes[o];
          destino[t + 1] = origem.bytes[o + 1];
          destino[t + 2] = origem.bytes[o + 2];
          destino[t + 3] = origem.bytes[o + 3];
        }
      }
    }
  };

  const ctx = alvo as unknown as CanvasRenderingContext2D;
  ESTADO_POR_CONTEXTO.set(alvo, est);
  return ctx;
}

function criarCanvasDePixels(): HTMLCanvasElement {
  const est: EstadoCanvas = {
    largura: 0,
    altura: 0,
    bytes: new Uint8ClampedArray(0),
    ctx: null
  };

  const alvo = {
    get width(): number {
      return est.largura;
    },
    set width(v: number) {
      est.largura = Math.max(0, Math.floor(v));
      realocar(est);
    },
    get height(): number {
      return est.altura;
    },
    set height(v: number) {
      est.altura = Math.max(0, Math.floor(v));
      realocar(est);
    },
    getContext(tipo: string): CanvasRenderingContext2D | null {
      if (tipo !== '2d') return null;
      if (est.ctx === null) est.ctx = criarContextoDePixels(est);
      return est.ctx;
    }
  };

  ESTADO_POR_CANVAS.set(alvo, est);
  return alvo as unknown as HTMLCanvasElement;
}

/**
 * Instala o `document` de pixels. Irmão de `instalarDomDeForja` de
 * `test/render.test.ts` e deliberadamente MAIS CARO: lá o objetivo é a forja
 * acontecer; aqui é ela deixar rastro que se possa medir.
 *
 * `limparCacheAtlas()` nas duas pontas: os casos com injeção desviam a
 * memoização (`spriteForge.ts:991-992`), mas o caso da CHAVE DE CACHE não —
 * e um atlas do caso anterior sobrevivendo trocaria o teste de assunto.
 */
function instalarDomDeForjaPixel(): void {
  const raiz = globalThis as unknown as { document?: unknown };
  raiz.document = {
    createElement: (tag: string): unknown => {
      if (tag !== 'canvas') throw new Error('o DOM de pixels só sabe criar canvas, não ' + tag);
      return criarCanvasDePixels();
    }
  };
  limparCacheAtlas();
}

/**
 * Desmonta o `document`. NÃO é opcional: deixá-lo de pé faz os describes de
 * `test/render.test.ts` (que testam justamente a bifurcação com e sem atlas)
 * mudarem de caminho conforme a ordem de execução dos arquivos.
 */
function removerDomDeForjaPixel(): void {
  const raiz = globalThis as unknown as { document?: unknown };
  delete raiz.document;
  limparCacheAtlas();
}

/* ================================================================== *
 * 2. Cor: leitura e chave
 * ================================================================== */

/** Chave inteira de um RGB — a mesma de `spriteForge` (`(r<<16)|(g<<8)|b`). */
function chaveRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function rgbDeHex(hex: string): [number, number, number] {
  const s = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error('hex de 6 dígitos esperado, veio ' + hex);
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function chaveDeHex(hex: string): number {
  const c = rgbDeHex(hex);
  return chaveRgb(c[0], c[1], c[2]);
}

/* ================================================================== *
 * 3. O material do teste
 *
 * A paleta declara TRÊS coisas de propósito, porque as três são lidas por
 * caminhos diferentes da forja:
 *
 *   · degraus normais (`casca*`) — o corpo do fechamento de paleta;
 *   · a própria cor de CONTORNO, sob a chave `contorno` — é ela que
 *     `spriteForge:1141-1144` procura quando `opts.corContorno` é `undefined`,
 *     e é ela que `coresDaPaleta` precisa achar para `pal.contorno >= 0` e o
 *     passe 2 ligar;
 *   · uma cor EMISSIVA com rampa própria de um degrau só (`veiaViva`) — o
 *     molde recomendado pelo cabeçalho de `spriteForge` para cor emissiva, e o
 *     que torna o conjunto de `coresEmissivas` exatamente conhecido.
 *
 * O pintor injetado NÃO pinta nenhuma dessas cores: ele pinta duas cores CRUAS,
 * fora da paleta, cada uma a um passo curto de um degrau declarado. Se o snap
 * deixar de rodar, as cores cruas aparecem na folha e o fechamento de paleta
 * reprova — que é o ponto.
 * ================================================================== */

const COR_CONTORNO = '#101018';

const PALETA_FORJA: Paleta3D = {
  cascaLuz: '#e8d7a8',
  cascaBase: '#b89a52',
  cascaSombra: '#6d5a2e',
  veiaViva: '#ff2fa0',
  contorno: COR_CONTORNO
};

const RAMPAS_FORJA: RampasPorMaterial = {
  casca: ['cascaLuz', 'cascaBase', 'cascaSombra'],
  // Rampa de UM degrau: a rampa efetiva da cor emissiva é ela mesma, então
  // `coresEmissivas` (spriteForge:1607) devolve um conjunto de tamanho 1 e a
  // contagem de pixels vivos é derivável no papel.
  veia: ['veiaViva']
};

const RAMPA_DA_COR_FORJA: MaterialPorCor = {
  cascaLuz: 'casca',
  cascaBase: 'casca',
  cascaSombra: 'casca',
  veiaViva: 'veia'
};

/** Cores cruas do pintor: fora da paleta, vizinhas óbvias de um degrau cada. */
const CRUA_ESQUERDA = '#bb9d55'; // snapa para `cascaBase`
const CRUA_DIREITA = '#fa33a4'; // snapa para `veiaViva`

const ALVO_ESQUERDA = '#b89a52';
const ALVO_DIREITA = '#ff2fa0';

/** Todas as cores legais da folha — o mesmo desdobramento de `coresDaPaleta`. */
const CHAVES_DA_PALETA = (() => {
  const saida = new Set<number>();
  for (const nome of Object.keys(PALETA_FORJA)) {
    const entrada = PALETA_FORJA[nome];
    if (typeof entrada === 'string') saida.add(chaveDeHex(entrada));
    else for (const h of entrada.rampa) saida.add(chaveDeHex(h));
  }
  return saida;
})();

/* ================================================================== *
 * 4. A figura, o medidor e o pintor injetados
 *
 * A CAIXA declarada por `medir` e o retângulo pintado são o mesmo par de
 * números por um motivo que não é estético. `spriteForge:751-754` conta as
 * QUATRO ARESTAS do retângulo sujo como transparentes: uma silhueta que alcance
 * a aresta ganha uma fileira de contorno que não é silhueta nenhuma. O recorte
 * sujo é a caixa medida MAIS `FOLGA_SUJO` (2 px de arte, :571) de cada lado,
 * então pintar exatamente DENTRO da caixa medida deixa 2 px de folga em volta e
 * o artefato não existe. Pintar 1 px além congelaria o artefato como se fosse
 * regra.
 * ------------------------------------------------------------------ */

/** A caixa que `medir` declara, em px de arte, a partir da origem do rig. */
const CAIXA = { minX: -4, minY: -12, maxX: 4, maxY: 0 } as const;

const LARGURA_FIGURA = CAIXA.maxX - CAIXA.minX; // 8
const ALTURA_FIGURA = CAIXA.maxY - CAIXA.minY; // 12
const METADE = LARGURA_FIGURA / 2; // 4

/**
 * Um rig mínimo. Com injeção ele nunca é lido — só serve de IDENTIDADE para o
 * `WeakMap` de cache. Sem injeção (o caso da chave de cache) ele é medido de
 * verdade por `medirModelo`, e por isso precisa ser um sólido legítimo.
 */
const RIG_FORJA: No = {
  nome: 'bloco',
  pivo: [0, 0, 0],
  caixas: [{ cx: 0, cy: 0, cz: 1, sx: 2, sy: 2, sz: 2, cor: 'cascaBase' }]
};

/**
 * Escreve um bloco chapado direto no buffer de arte.
 *
 * O pintor do teste não usa `fill()`: um rasterizador PÕE PIXEL, e é o pixel
 * posto que o snap vai ler de volta por `getImageData`. Manter isto fora do
 * contexto é o que permite ao canvas de software expor exatamente — e só — a
 * superfície que `spriteForge` consome.
 */
function pintarBloco(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  largura: number,
  altura: number,
  hex: string
): void {
  const est = ESTADO_POR_CONTEXTO.get(ctx as unknown as object);
  if (!est) throw new Error('o pintor injetado recebeu um contexto que não é o de software');
  const c = rgbDeHex(hex);
  const bytes = est.bytes;
  for (let y = y0; y < y0 + altura; y++) {
    if (y < 0 || y >= est.altura) continue;
    for (let x = x0; x < x0 + largura; x++) {
      if (x < 0 || x >= est.largura) continue;
      const i = (y * est.largura + x) * 4;
      bytes[i] = c[0];
      bytes[i + 1] = c[1];
      bytes[i + 2] = c[2];
      bytes[i + 3] = 255;
    }
  }
}

/**
 * O medidor injetado: a MESMA caixa para as 72 combinações.
 *
 * Constante de propósito. A união das caixas é o que dimensiona o quadro
 * (`spriteForge:1059-1098`), e uma caixa constante deixa a única variação
 * vertical ser o `deslocY` das poses — que é o número que se quer ver aparecer
 * na altura do quadro, sem ruído de geometria por cima.
 *
 * As sobrecargas são as de `medirModelo`, e é por elas que este objeto satisfaz
 * `MedeModelo` sem um único `as any`.
 */
function medirFixo(raiz: No, opts?: OpcoesGeometria): Limites;
function medirFixo(raiz: No, pose: Pose | undefined, yaw: number, artPorU?: number): Limites;
function medirFixo(
  _raiz: No,
  _a?: OpcoesGeometria | Pose,
  _yaw?: number,
  _artPorU?: number
): Limites {
  return {
    minX: CAIXA.minX,
    minY: CAIXA.minY,
    maxX: CAIXA.maxX,
    maxY: CAIXA.maxY,
    largura: LARGURA_FIGURA,
    altura: ALTURA_FIGURA
  };
}

const MEDIR_INJETADO: MedeModelo = medirFixo;

interface PintorInjetado {
  desenhar: DesenhaModelo;
  /** Cada `OpcoesModelo` que a forja entregou, na ordem das 72 chamadas. */
  recebidas: OpcoesModelo[];
}

/**
 * O pintor injetado: duas metades 4×12 de cores CRUAS, encostadas na origem que
 * a forja mandou em `offsetX`/`offsetY`, e um registro do `OpcoesModelo`
 * recebido.
 *
 * O registro não é enfeite: `spriteForge:1181` repassa `opts.corContorno` CRU
 * ao pintor (não o valor resolvido de `:1141-1144`), e esse repasse é o canal
 * por onde `model3d` fica sabendo de que cor traçar o contorno INTERNO. Se
 * alguém o perder no caminho, a folha continua com a silhueta certa — o passe 2
 * a repinta — e o contorno interno sai da cor errada, em silêncio.
 */
function criarPintorInjetado(): PintorInjetado {
  const recebidas: OpcoesModelo[] = [];

  function desenhar(ctx: CanvasRenderingContext2D | null, raiz: No, opts: OpcoesModelo): void;
  function desenhar(
    ctx: CanvasRenderingContext2D | null,
    raiz: No,
    pose: Pose | undefined,
    yaw: number,
    origemX?: number,
    origemY?: number,
    artPorU?: number,
    paleta?: Paleta3D
  ): void;
  function desenhar(
    ctx: CanvasRenderingContext2D | null,
    _raiz: No,
    a: OpcoesModelo | Pose | undefined,
    yaw?: number,
    _origemX?: number,
    _origemY?: number,
    _artPorU?: number,
    _paleta?: Paleta3D
  ): void {
    if (typeof yaw === 'number' || a === undefined) {
      throw new Error('a forja chamou `desenhar` na forma POSICIONAL — este teste mede a de opções');
    }
    const opts = a as OpcoesModelo;
    recebidas.push(opts);
    if (!ctx) return;
    const ox = typeof opts.offsetX === 'number' ? opts.offsetX : 0;
    const oy = typeof opts.offsetY === 'number' ? opts.offsetY : 0;
    const topo = oy + CAIXA.minY;
    pintarBloco(ctx, ox + CAIXA.minX, topo, METADE, ALTURA_FIGURA, CRUA_ESQUERDA);
    pintarBloco(ctx, ox, topo, METADE, ALTURA_FIGURA, CRUA_DIREITA);
  }

  return { desenhar: desenhar, recebidas: recebidas };
}

/* ================================================================== *
 * 5. Forjar e ler
 * ================================================================== */

interface Forjadura {
  atlas: AtlasPersonagem;
  pintor: PintorInjetado;
}

function opcoesBase(): OpcoesForja {
  return {
    paleta: PALETA_FORJA,
    rampas: RAMPAS_FORJA,
    rampaDaCor: RAMPA_DA_COR_FORJA,
    corContorno: COR_CONTORNO
  };
}

/** Forja com `desenhar`/`medir` injetados — o caminho que desvia o cache. */
function forjar(extra?: Partial<OpcoesForja>): Forjadura {
  const pintor = criarPintorInjetado();
  const opts: OpcoesForja = {
    ...opcoesBase(),
    ...extra,
    desenhar: pintor.desenhar,
    medir: MEDIR_INJETADO
  };
  return { atlas: forjarAtlas(RIG_FORJA, opts), pintor: pintor };
}

/** Uma superfície de pixels lida de volta: bytes RGBA + dimensões. */
interface Folha {
  bytes: Uint8ClampedArray;
  largura: number;
  altura: number;
}

/** Caminho (a): o `Uint8ClampedArray` que o canvas de software carrega. */
function folhaCrua(cv: HTMLCanvasElement | null): Folha {
  if (!cv) throw new Error('a forja não devolveu canvas — o DOM de pixels não entrou em cena');
  const est = ESTADO_POR_CANVAS.get(cv as unknown as object);
  if (!est) throw new Error('o canvas devolvido não é o de software');
  return { bytes: est.bytes, largura: est.largura, altura: est.altura };
}

/**
 * Caminho (b): o canônico — `getContext('2d').getImageData(...)`, exatamente
 * como qualquer consumidor de navegador leria. Os dois caminhos têm de dar os
 * mesmos bytes; é isso que prova que o canvas de software não guarda o
 * resultado num lugar diferente de onde diz guardar.
 */
function folhaCanonica(atlas: AtlasPersonagem): Folha {
  const cv = atlas.canvas;
  if (!cv) throw new Error('a forja não devolveu canvas');
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('o canvas do atlas não devolveu contexto 2d');
  const img = ctx.getImageData(0, 0, atlas.larguraFolha, atlas.alturaFolha);
  return { bytes: img.data, largura: img.width, altura: img.height };
}

/** Retângulo em px da FOLHA, meio-aberto à direita e embaixo. */
interface Recorte {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function folhaInteira(f: Folha): Recorte {
  return { x0: 0, y0: 0, x1: f.largura, y1: f.altura };
}

/** As 72 células da folha, na ordem (direção, estado, quadro). */
function celulas(atlas: AtlasPersonagem): Recorte[] {
  const saida: Recorte[] = [];
  for (let dir = 0; dir < DIRECOES; dir++) {
    for (const estado of ORDEM_ESTADOS) {
      for (let f = 0; f < QUADROS_POR_ESTADO[estado]; f++) {
        // A grade NÃO é recalculada à mão: quem sabe onde mora o quadro é o
        // próprio atlas (`fazerQuadro`, spriteForge:1217).
        const q = atlas.quadro(dir, estado, f);
        saida.push({
          x0: q.sx,
          y0: q.sy,
          x1: q.sx + atlas.larguraFrame,
          y1: q.sy + atlas.alturaFrame
        });
      }
    }
  }
  return saida;
}

/** Alpha de um pixel da folha; fora dela conta como transparente. */
function alphaEm(f: Folha, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= f.largura || y >= f.altura) return 0;
  return f.bytes[(y * f.largura + x) * 4 + 3];
}

/**
 * O censo de um recorte da folha. Os vizinhos-4 são consultados na FOLHA
 * INTEIRA, não dentro do recorte: se a figura de uma célula encostasse na borda
 * dela, contar a borda da célula como vazio inventaria contorno. (Ela não
 * encosta — sobram 2 px de arte de cada lado —, e é justamente por isso que os
 * dois modos de contar dão o mesmo número. Consultar a folha é o que mantém
 * essa coincidência sendo verificada em vez de assumida.)
 */
interface Censo {
  /** Pixels com alpha > 0. */
  opacos: number;
  /** Pixels com alpha estritamente entre 0 e 255 — o pecado que G5 proíbe. */
  alphaParcial: number;
  /** Pixels opacos cuja cor não está na paleta declarada. */
  foraDaPaleta: number;
  /** Pixels opacos com pelo menos um vizinho-4 transparente. */
  bordas: number;
  /** ...desses, quantos NÃO estão na cor de contorno. Tem de ser zero. */
  bordasSemContorno: number;
  /** Pixels na cor de contorno que NÃO são borda. Também tem de ser zero. */
  contornoNoInterior: number;
  /** Quantos pixels opacos de cada chave RGB. */
  porCor: Map<number, number>;
}

function censo(f: Folha, r: Recorte, chaveContorno: number): Censo {
  const c: Censo = {
    opacos: 0,
    alphaParcial: 0,
    foraDaPaleta: 0,
    bordas: 0,
    bordasSemContorno: 0,
    contornoNoInterior: 0,
    porCor: new Map<number, number>()
  };
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = (y * f.largura + x) * 4;
      const a = f.bytes[i + 3];
      if (a > 0 && a < 255) c.alphaParcial++;
      if (a === 0) continue;
      c.opacos++;
      const chave = chaveRgb(f.bytes[i], f.bytes[i + 1], f.bytes[i + 2]);
      if (!CHAVES_DA_PALETA.has(chave)) c.foraDaPaleta++;
      c.porCor.set(chave, (c.porCor.get(chave) ?? 0) + 1);
      const borda =
        alphaEm(f, x - 1, y) === 0 ||
        alphaEm(f, x + 1, y) === 0 ||
        alphaEm(f, x, y - 1) === 0 ||
        alphaEm(f, x, y + 1) === 0;
      if (borda) {
        c.bordas++;
        if (chave !== chaveContorno) c.bordasSemContorno++;
      } else if (chave === chaveContorno) {
        c.contornoNoInterior++;
      }
    }
  }
  return c;
}

/** Índice do primeiro byte diferente, ou −1 quando as duas folhas são iguais. */
function primeiraDiferenca(a: Folha, b: Folha): number {
  if (a.largura !== b.largura || a.altura !== b.altura) return 0;
  for (let i = 0; i < a.bytes.length; i++) if (a.bytes[i] !== b.bytes[i]) return i;
  return -1;
}

/* ================================================================== *
 * 6. Os números derivados no papel
 *
 * Com a caixa `[-4,-12]..[4,0]`, `margem = 2` (MARGEM_PADRAO), `artPorU = 2.5`
 * (ART_POR_U) e os `deslocY` das 9 poses — `parado` 0/2, `andando` 4/0/4/0,
 * `atacando` 2/−2/0, em px de arte — sai tudo:
 *
 *   larguraArte  = ceil(4) − floor(−4) + 2·margem              = 12
 *   alturaArte   = (0 − min dy) − (−12 − max dy) + 2·margem    = 22
 *   âncora       = (margem − floor(minX), margem − floor(minY)) = (6, 18)
 *   folha        = 12·9 × 22·8                                 = 108 × 176
 *   opacos/quadro= 8 × 12                                      = 96
 *   contorno     = perímetro 2·(8+12) − 4                      = 36
 *   interior     = 96 − 36 = 60, metade a metade                = 30 + 30
 *
 * Congelar estes valores é congelar a CONTA, não uma medição: qualquer um deles
 * mexendo aponta para uma linha específica de `forjar`.
 * ================================================================== */

const LARGURA_ARTE = 12;
const ALTURA_ARTE = 22;
const ANCORA_X = 6;
const ANCORA_Y = 18;
const OPACOS_POR_QUADRO = 96;
const CONTORNO_POR_QUADRO = 36;
const INTERIOR_POR_COR = 30;

const CHAVE_CONTORNO = chaveDeHex(COR_CONTORNO);

/* ================================================================== *
 * 7. Os casos
 * ================================================================== */

describe('forjarAtlas — o acabamento em pixel (snap de paleta e contorno)', () => {
  beforeEach(() => {
    instalarDomDeForjaPixel();
  });

  afterEach(() => {
    removerDomDeForjaPixel();
  });

  it('a folha sai com as dimensões e a âncora que a conta manda', () => {
    const { atlas } = forjar();

    expect(atlas.disponivel, 'a forja não achou canvas — o DOM de pixels não entrou').toBe(true);
    expect(atlas.larguraArte, 'larguraArte').toBe(LARGURA_ARTE);
    expect(atlas.alturaArte, 'alturaArte').toBe(ALTURA_ARTE);
    expect(atlas.pixel, 'o padrão de PIXEL mudou').toBe(1);
    expect(atlas.larguraFrame, 'larguraFrame').toBe(LARGURA_ARTE);
    expect(atlas.alturaFrame, 'alturaFrame').toBe(ALTURA_ARTE);
    expect(atlas.larguraFolha, 'larguraFolha').toBe(108);
    expect(atlas.alturaFolha, 'alturaFolha').toBe(176);

    /* NÃO asserir `atlas.colunas === COLUNAS` (nem `linhas`, nem `totalQuadros`):
     * `spriteForge:1113-1115` preenche os três como CÓPIA LITERAL das mesmas
     * constantes que este arquivo importa, então a igualdade passaria com
     * qualquer implementação do pipeline — mede o objeto literal, não a forja.
     * O que morde é a COERÊNCIA entre a grade anunciada e o buffer real: se a
     * folha for dimensionada por uma conta e recortada por outra, isto reprova. */
    expect(atlas.colunas * atlas.larguraFrame, 'a grade não cobre a largura da folha')
      .toBe(atlas.larguraFolha);
    expect(atlas.linhas * atlas.alturaFrame, 'a grade não cobre a altura da folha')
      .toBe(atlas.alturaFolha);
    expect(atlas.ancoraX, 'ancoraX').toBe(ANCORA_X);
    expect(atlas.ancoraY, 'ancoraY').toBe(ANCORA_Y);

    /* O buffer de verdade tem o tamanho anunciado — é o que garante que
     * `cv.width`/`cv.height`, atribuídos DEPOIS da criação, realocaram. */
    const f = folhaCrua(atlas.canvas);
    expect(f.largura, 'a largura do buffer não bate com a anunciada').toBe(atlas.larguraFolha);
    expect(f.altura, 'a altura do buffer não bate com a anunciada').toBe(atlas.alturaFolha);
    expect(f.bytes.length, 'o buffer não foi realocado na atribuição de width/height')
      .toBe(atlas.larguraFolha * atlas.alturaFolha * 4);

    expect(Number.isFinite(atlas.msForja), 'msForja não é número').toBe(true);
    expect(atlas.msForja, 'msForja negativo').toBeGreaterThanOrEqual(0);
  });

  it('o pintor foi chamado 72 vezes e recebeu o corContorno pedido', () => {
    const { pintor } = forjar();

    /* Esta conta o número REAL de chamadas ao pintor — não é tautologia, ao
     * contrário de `atlas.totalQuadros`, que é cópia literal da constante. */
    expect(pintor.recebidas.length, 'a forja não pintou os 72 quadros').toBe(TOTAL_QUADROS);

    for (const opts of pintor.recebidas) {
      /* `spriteForge:1181` repassa o valor CRU de `opts.corContorno`. É por este
       * canal que `model3d` sabe de que cor traçar o contorno INTERNO — e é ele
       * que a rodada do `modoContorno` vai ter de estender. */
      expect(opts.corContorno, 'o corContorno não chegou ao pintor').toBe(COR_CONTORNO);
      expect(opts.paleta, 'a paleta não chegou ao pintor').toBe(PALETA_FORJA);
      expect(opts.rampas, 'as rampas não chegaram ao pintor').toBe(RAMPAS_FORJA);
      expect(opts.rampaDaCor, 'o rampaDaCor não chegou ao pintor').toBe(RAMPA_DA_COR_FORJA);
      expect(opts.escala, 'a escala não chegou ao pintor').toBe(2.5);
      expect(opts.offsetX, 'o offsetX não é a âncora de arte').toBe(ANCORA_X);
    }

    /* O `offsetY` varia com o `deslocY` da pose e é o que dá os 22px de altura:
     * 6 px de arte de amplitude entre o quadro mais alto e o mais baixo. */
    const offsets = pintor.recebidas.map((o) => (typeof o.offsetY === 'number' ? o.offsetY : NaN));
    expect(Math.min(...offsets), 'o offsetY mínimo mudou').toBe(14);
    expect(Math.max(...offsets), 'o offsetY máximo mudou').toBe(20);
  });

  it('o alpha é BINÁRIO: nenhum pixel entre 1 e 254', () => {
    const { atlas } = forjar();
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(c.alphaParcial, 'sobrou meio-tom de alpha na folha — G5').toBe(0);
    expect(c.opacos, 'a folha saiu vazia').toBeGreaterThan(0);
  });

  it('toda cor opaca pertence à paleta declarada — e nenhuma cor CRUA sobreviveu', () => {
    const { atlas } = forjar();
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);

    expect(c.foraDaPaleta, 'pixel fora da paleta na folha — o snap de §2.1 não rodou').toBe(0);

    /* A prova de que o snap AGIU, e não de que o pintor já pintava certo: as
     * duas cores cruas não existem em lugar nenhum da folha, e as duas cores
     * ALVO existem. */
    expect(c.porCor.get(chaveDeHex(CRUA_ESQUERDA)) ?? 0, 'a cor crua da esquerda sobreviveu').toBe(0);
    expect(c.porCor.get(chaveDeHex(CRUA_DIREITA)) ?? 0, 'a cor crua da direita sobreviveu').toBe(0);
    expect(c.porCor.get(chaveDeHex(ALVO_ESQUERDA)) ?? 0, 'a esquerda não snapou para cascaBase')
      .toBeGreaterThan(0);
    expect(c.porCor.get(chaveDeHex(ALVO_DIREITA)) ?? 0, 'a direita não snapou para veiaViva')
      .toBeGreaterThan(0);
  });

  it('o contorno é CONTÍNUO: toda borda de silhueta está na cor de contorno', () => {
    const { atlas } = forjar();
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);

    /* I6/G4 em uma linha: pixel opaco com vizinho-4 vazio É contorno. Sem o
     * passe 2 de `snaparBuffer` (:740-765) a borda fica da cor da peça e este
     * número explode. */
    expect(c.bordasSemContorno, 'há borda de silhueta fora da cor de contorno').toBe(0);
    expect(c.bordas, 'a folha não tem borda nenhuma').toBe(CONTORNO_POR_QUADRO * TOTAL_QUADROS);

    /* A recíproca, que é o que impede um contorno guloso de passar: a cor de
     * contorno não aparece em pixel de interior. */
    expect(c.contornoNoInterior, 'a cor de contorno vazou para o miolo da figura').toBe(0);
    expect(c.porCor.get(CHAVE_CONTORNO) ?? 0, 'total de pixels de contorno')
      .toBe(CONTORNO_POR_QUADRO * TOTAL_QUADROS);
  });

  it('as 72 células têm todas os MESMOS números: 96 opacos, 36 de contorno, 30+30 de interior', () => {
    const { atlas } = forjar();
    const f = folhaCrua(atlas.canvas);
    const quadros = celulas(atlas);
    expect(quadros.length, 'a grade do atlas não tem 72 células').toBe(TOTAL_QUADROS);

    for (let k = 0; k < quadros.length; k++) {
      const c = censo(f, quadros[k], CHAVE_CONTORNO);
      const onde = 'célula ' + k;
      expect(c.opacos, onde + ': pixels opacos').toBe(OPACOS_POR_QUADRO);
      expect(c.porCor.get(CHAVE_CONTORNO) ?? 0, onde + ': pixels de contorno')
        .toBe(CONTORNO_POR_QUADRO);
      expect(c.porCor.get(chaveDeHex(ALVO_ESQUERDA)) ?? 0, onde + ': interior da metade esquerda')
        .toBe(INTERIOR_POR_COR);
      expect(c.porCor.get(chaveDeHex(ALVO_DIREITA)) ?? 0, onde + ': interior da metade direita')
        .toBe(INTERIOR_POR_COR);
      expect(c.porCor.size, onde + ': cores distintas na célula').toBe(3);
    }

    /* E o total fecha: a grade 9×8 ladrilha a folha exatamente, então nada foi
     * colado fora de célula nenhuma. */
    const total = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(total.opacos, 'total de pixels opacos na folha').toBe(OPACOS_POR_QUADRO * TOTAL_QUADROS);
  });

  it('cada quadro foi para a CÉLULA dele — as 72 são distintas e o resto da folha é vazio', () => {
    const { atlas } = forjar();
    const f = folhaCrua(atlas.canvas);
    const vistas = new Set<string>();
    for (const r of celulas(atlas)) vistas.add(r.x0 + 'x' + r.y0);
    expect(vistas.size, 'duas poses caíram na mesma célula — o blit perdeu o destino')
      .toBe(TOTAL_QUADROS);

    /* O `drawImage` de 9 argumentos leva o buffer de arte para
     * `(col·larguraFrame, dir·alturaFrame)`. Se o destino virasse (0,0) — a
     * armadilha da "cópia identidade" quando `pixel = 1` —, 71 células ficariam
     * vazias e esta contagem cairia para 96. */
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(c.opacos, 'a folha inteira não recebeu os 72 quadros')
      .toBe(OPACOS_POR_QUADRO * TOTAL_QUADROS);
  });

  it('os dois caminhos de leitura veem os mesmos bytes', () => {
    const { atlas } = forjar();
    const crua = folhaCrua(atlas.canvas);
    const canonica = folhaCanonica(atlas);
    expect(canonica.largura).toBe(crua.largura);
    expect(canonica.altura).toBe(crua.altura);
    expect(primeiraDiferenca(crua, canonica), 'o getImageData do atlas discorda do buffer')
      .toBe(-1);
    /* E a cópia é CÓPIA: mexer no que `getImageData` devolveu não pode tocar o
     * atlas. É a decisão 1 do canvas de software, e a razão dela é
     * `extrairEmissivo`, que muta o retorno in place. */
    canonica.bytes[3] = 42;
    expect(folhaCrua(atlas.canvas).bytes[3], 'getImageData devolveu uma janela do buffer').toBe(
      crua.bytes[3]
    );
  });

  it('forjar duas vezes dá os mesmos bytes', () => {
    const a = folhaCrua(forjar().atlas.canvas);
    const b = folhaCrua(forjar().atlas.canvas);
    expect(primeiraDiferenca(a, b), 'a forja não é determinística — primeiro byte diferente')
      .toBe(-1);
  });

  it('sem corContorno explícito o snap acha a cor na entrada `contorno` da paleta', () => {
    /*
     * `spriteForge:1141-1144`: `undefined` procura a chave `contorno` na paleta,
     * e é ESSA cor que `coresDaPaleta` marca como o índice do contorno. O
     * pintor, esse, recebe o valor cru — `undefined` — e é o que se assere aqui
     * junto: as duas metades do contrato num caso só.
     */
    const { atlas, pintor } = forjar({ corContorno: undefined });
    for (const opts of pintor.recebidas) {
      expect(opts.corContorno, 'o pintor deveria receber o valor CRU, não o resolvido')
        .toBeUndefined();
    }
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(c.bordasSemContorno, 'a resolução pela paleta não pintou o contorno').toBe(0);
    expect(c.porCor.get(CHAVE_CONTORNO) ?? 0, 'total de pixels de contorno')
      .toBe(CONTORNO_POR_QUADRO * TOTAL_QUADROS);
  });

  it('com corContorno: null o passe 2 não roda e a borda fica da cor da peça', () => {
    /*
     * O interruptor de desligar, e a prova de que os números acima vêm do passe
     * 2 e não de coincidência: sem cor de contorno, `pal.contorno` é −1
     * (`coresDaPaleta:649-650`), o bloco de `:740-765` é pulado inteiro e a
     * figura sai chapada — 48 pixels de cada cor, sem moldura.
     */
    const { atlas } = forjar({ corContorno: null });
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);

    expect(c.porCor.get(CHAVE_CONTORNO) ?? 0, 'apareceu contorno com corContorno: null').toBe(0);
    expect(c.opacos, 'a silhueta mudou de tamanho ao desligar o contorno')
      .toBe(OPACOS_POR_QUADRO * TOTAL_QUADROS);
    expect(c.porCor.get(chaveDeHex(ALVO_ESQUERDA)) ?? 0, 'a metade esquerda não ficou chapada')
      .toBe((OPACOS_POR_QUADRO / 2) * TOTAL_QUADROS);
    expect(c.porCor.get(chaveDeHex(ALVO_DIREITA)) ?? 0, 'a metade direita não ficou chapada')
      .toBe((OPACOS_POR_QUADRO / 2) * TOTAL_QUADROS);
    /* O snap de paleta continua rodando — é o passe 1, independente do 2. */
    expect(c.foraDaPaleta, 'desligar o contorno desligou o snap junto').toBe(0);
    expect(c.alphaParcial, 'desligar o contorno soltou meio-tom de alpha').toBe(0);
  });

  it('com pixel: 3 cada pixel de arte vira um bloco 3×3 exato', () => {
    const um = forjar();
    const tres = forjar({ pixel: 3 });

    expect(tres.atlas.pixel).toBe(3);
    expect(tres.atlas.larguraArte, 'o buffer de ARTE não pode mudar com o pixel')
      .toBe(um.atlas.larguraArte);
    expect(tres.atlas.alturaArte).toBe(um.atlas.alturaArte);
    expect(tres.atlas.larguraFrame).toBe(LARGURA_ARTE * 3);
    expect(tres.atlas.alturaFrame).toBe(ALTURA_ARTE * 3);
    expect(tres.atlas.ancoraX, 'a âncora tem de escalar junto').toBe(ANCORA_X * 3);
    expect(tres.atlas.ancoraY).toBe(ANCORA_Y * 3);

    /*
     * A prova pixel a pixel: a célula ampliada é a célula 1:1 replicada 3×3.
     * O que isto trava é o CONTRATO da forja — origem = buffer de arte inteiro,
     * destino = a célula do tamanho do quadro (`:1188-1198`) —, não o
     * reamostrador do navegador, que aqui é o do canvas de software.
     */
    const f1 = folhaCrua(um.atlas.canvas);
    const f3 = folhaCrua(tres.atlas.canvas);
    const c1 = celulas(um.atlas);
    const c3 = celulas(tres.atlas);
    let divergencias = 0;
    for (let k = 0; k < c1.length; k++) {
      for (let y = 0; y < ALTURA_ARTE; y++) {
        for (let x = 0; x < LARGURA_ARTE; x++) {
          const o = ((c1[k].y0 + y) * f1.largura + (c1[k].x0 + x)) * 4;
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 3; dx++) {
              const t = ((c3[k].y0 + y * 3 + dy) * f3.largura + (c3[k].x0 + x * 3 + dx)) * 4;
              for (let ch = 0; ch < 4; ch++) if (f1.bytes[o + ch] !== f3.bytes[t + ch]) divergencias++;
            }
          }
        }
      }
    }
    expect(divergencias, 'a ampliação ×3 não é replicação de bloco').toBe(0);

    /* E as contagens escalam por 9, incluindo o contorno: a moldura de 1px de
     * ARTE vira uma moldura de 3px de TELA — é assim que o pixel art engorda. */
    const c = censo(f3, folhaInteira(f3), CHAVE_CONTORNO);
    expect(c.opacos, 'opacos com pixel 3').toBe(OPACOS_POR_QUADRO * 9 * TOTAL_QUADROS);
    expect(c.porCor.get(CHAVE_CONTORNO) ?? 0, 'contorno com pixel 3')
      .toBe(CONTORNO_POR_QUADRO * 9 * TOTAL_QUADROS);
    expect(c.bordasSemContorno, 'a moldura ampliada deixou de ser contorno').toBe(0);
    expect(c.alphaParcial, 'a ampliação inventou meio-tom de alpha').toBe(0);
  });

  it('com emissivas a camada emissiva sai viva — e o atlas continua inteiro', () => {
    const { atlas } = forjar({ emissivas: ['veiaViva'] });

    expect(atlas.emissivo, 'a camada emissiva não foi extraída').not.toBeNull();
    const e = folhaCrua(atlas.emissivo);
    expect(e.largura, 'a camada emissiva tem de ter o retículo do atlas').toBe(atlas.larguraFolha);
    expect(e.altura).toBe(atlas.alturaFolha);

    /*
     * Quantos pixels sobrevivem, e por quê: só os do INTERIOR da metade direita.
     * A borda daquela metade foi comida pelo contorno de silhueta — que é
     * exatamente a segunda armadilha documentada no cabeçalho de `spriteForge`
     * ("declare as caixas do olho com `contorno: false`"). 30 por quadro.
     */
    let vivos = 0;
    let foraDaCorEmissiva = 0;
    const chaveEmissiva = chaveDeHex(ALVO_DIREITA);
    for (let i = 0; i < e.bytes.length; i += 4) {
      if (e.bytes[i + 3] === 0) continue;
      vivos++;
      if (chaveRgb(e.bytes[i], e.bytes[i + 1], e.bytes[i + 2]) !== chaveEmissiva) foraDaCorEmissiva++;
    }
    expect(vivos, 'pixels vivos na camada emissiva').toBe(INTERIOR_POR_COR * TOTAL_QUADROS);
    expect(foraDaCorEmissiva, 'a camada emissiva guardou cor que não é emissiva').toBe(0);

    /*
     * O ATLAS SOBREVIVEU. `extrairEmissivo` muta `img.data` in place
     * (`:1666-1669`) e o `img` veio de um `getImageData` do PRÓPRIO atlas
     * (`:1653`): se aquilo fosse uma janela do buffer, o atlas sairia
     * transparente — sem exceção, sem aviso, e só quando há `emissivas`.
     */
    const f = folhaCrua(atlas.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(c.opacos, 'a extração da camada emissiva apagou o atlas')
      .toBe(OPACOS_POR_QUADRO * TOTAL_QUADROS);
    expect(c.bordasSemContorno, 'a extração emissiva estragou o contorno do atlas').toBe(0);
  });

  it('a camada emissiva escala com o pixel, como o resto da folha', () => {
    /*
     * O mesmo interior de 30 px de ARTE por quadro, agora ampliado ×3: 30·9·72.
     * O caso existe para fechar a conta com a ampliação — a camada emissiva sai
     * do ATLAS já ampliado (`spriteForge:1205`), não do buffer de arte, e um dia
     * em que ela passasse a sair do buffer este número cairia para 2160 sem que
     * nada mais na folha se mexesse.
     */
    const { atlas } = forjar({ emissivas: ['veiaViva'], pixel: 3 });
    const e = folhaCrua(atlas.emissivo);
    let vivos = 0;
    for (let i = 3; i < e.bytes.length; i += 4) if (e.bytes[i] !== 0) vivos++;
    expect(vivos, 'pixels vivos na camada emissiva ampliada')
      .toBe(INTERIOR_POR_COR * 9 * TOTAL_QUADROS);
  });

  it('sem emissivas não há camada emissiva nenhuma', () => {
    const { atlas } = forjar();
    expect(atlas.emissivo, 'apareceu camada emissiva sem ninguém declarar cor emissiva')
      .toBeNull();
  });
});

/* ================================================================== *
 * 8. A CHAVE DO CACHE — o único caso SEM injeção
 *
 * Limite declarado: sem injeção quem pinta é `desenharModelo`, e o canvas de
 * software não tem rasterizador de polígono (`fill()` é inerte — ver
 * `metodosDeTraco`). Então este caso NÃO mede pixel: mede a memoização de
 * `forjarAtlas` (`:990-1034`), que é o caminho que a injeção desvia de propósito
 * (`:991-992`) e que nenhum outro teste alcança.
 *
 * As três opções usadas — `pixel`, `corContorno` e a limpeza de geração — já
 * estão na chave hoje (`:1004`, `:1020`, `:1000`), então o caso mede o que
 * existe em vez de pedir chave nova.
 * ================================================================== */

describe('forjarAtlas — a chave do cache, sem injeção', () => {
  beforeEach(() => {
    instalarDomDeForjaPixel();
  });

  afterEach(() => {
    removerDomDeForjaPixel();
  });

  it('memoiza por opções, e duas opções diferentes não se atropelam', () => {
    const base: OpcoesForja = opcoesBase();

    const a1 = forjarAtlas(RIG_FORJA, { ...base });
    expect(a1.disponivel, 'a forja sem injeção não completou').toBe(true);

    /* Mesmas opções, objeto novo: `chaveEstavel` ordena as chaves, então a
     * memoização é por VALOR e não por identidade do objeto de opções. */
    expect(forjarAtlas(RIG_FORJA, { ...base }), 'a memoização por valor quebrou').toBe(a1);

    /* `pixel` está na chave (:1004). Sem ele lá, o atlas ×2 devolveria o ×1 e o
     * sprite sairia com metade da resolução pedida, em silêncio. */
    const a2 = forjarAtlas(RIG_FORJA, { ...base, pixel: 2 });
    expect(a2, 'duas escalas do mesmo rig colidiram no cache').not.toBe(a1);
    expect(a2.larguraFrame, 'o atlas ×2 não dobrou o quadro').toBe(a1.larguraFrame * 2);
    expect(a2.larguraArte, 'o buffer de ARTE mudou junto — não devia').toBe(a1.larguraArte);

    /* `corContorno` idem (:1020) — é a opção que a rodada do `modoContorno` vai
     * mexer, e a que mais barato seria esquecer na chave. */
    const a3 = forjarAtlas(RIG_FORJA, { ...base, corContorno: null });
    expect(a3, 'dois contornos do mesmo rig colidiram no cache').not.toBe(a1);
    expect(a3, 'o contorno nulo devolveu o atlas ×2').not.toBe(a2);

    /* E os vizinhos não despejaram o primeiro: o cache é um mapa por chave, não
     * um slot único. */
    expect(forjarAtlas(RIG_FORJA, { ...base }), 'a entrada original foi sobrescrita').toBe(a1);

    /* `limparCacheAtlas` invalida a geração (:914-916): a próxima forja é OUTRO
     * objeto. É o que os testes (e o preview) usam para não herdar atlas de um
     * `document` que já não existe. */
    limparCacheAtlas();
    const depois = forjarAtlas(RIG_FORJA, { ...base });
    expect(depois, 'limparCacheAtlas não invalidou nada').not.toBe(a1);
    expect(depois.larguraFrame, 'a forja pós-limpeza mudou de tamanho').toBe(a1.larguraFrame);

    /*
     * O limite, em número: sem rasterizador de polígono a folha sai vazia. Se um
     * dia isto deixar de ser zero, é porque o contexto de software ganhou
     * `fill()` de verdade — e aí este arquivo pode medir o traço, não só a
     * forja.
     */
    const f = folhaCrua(a1.canvas);
    const c = censo(f, folhaInteira(f), CHAVE_CONTORNO);
    expect(c.opacos, 'o contexto de software passou a rasterizar polígono').toBe(0);
  });
});

/* ================================================================== *
 * 9. O MODO DE CONTORNO `'local'` (§2.1 de `spriteForge`)
 *
 * O passe 2 do snap ganhou uma segunda régua. No modo `'fixo'` — o de sempre —
 * toda borda de silhueta sai em `corContorno`, um traço único. No `'local'` cada
 * pixel de borda sai numa versão MAIS ESCURA da própria cor dele, escolhida
 * dentro da paleta declarada, pela escada de `tabelaBordaLocal`.
 *
 * O DEFEITO QUE ESTE DESCRIBE EXISTE PARA PEGAR É O HALO CLARO. A implementação
 * ingênua de "escurecer a cor local" é pegar o degrau mais próximo de `k·F` e
 * pintar. Quando `k` já é a cor mais escura da paleta, o melhor candidato
 * disponível é mais CLARO que `k` — e o que sai na tela não é contorno, é uma
 * AURÉOLA em volta das regiões escuras, exatamente onde o traço deveria estar
 * mais firme. Um teste que perguntasse "a borda mudou de cor?" ou "a borda está
 * na paleta?" daria verde para esse bug: as duas coisas continuam verdadeiras.
 * Por isso o predicado central aqui (P3) é de LUMINÂNCIA — e medida na MESMA
 * régua ponderada que a forja usa para escolher cor, porque o desacordo entre
 * duas réguas é justamente onde o halo nasce.
 *
 * ------------------------------------------------------------------
 * A BASE DE COMPARAÇÃO: três forjas idênticas, menos por uma opção.
 *
 *   A — `modoContorno` omitido   → o padrão `'fixo'`, o comportamento de hoje.
 *   B — `modoContorno: 'local'`  → o que está sob julgamento.
 *   C — `corContorno: null`      → o passe 2 NÃO RODA (`pal.contorno` é −1 e
 *                                  `bordaLocal` é null, então o bloco inteiro é
 *                                  pulado). É a referência de COR LOCAL PURA: o
 *                                  que cada pixel seria se ninguém repintasse a
 *                                  borda.
 *
 * Sem C não há teste nenhum. "Mais escuro" só quer dizer alguma coisa contra a
 * cor que o pixel TERIA; comparar B com A responde outra pergunta ("o modo mudou
 * o desenho?"), que é P4 — a mais fraca das seis, e a única que uma
 * implementação errada passa de graça.
 *
 * ------------------------------------------------------------------
 * AS TRÊS TRAVAS que mantêm as corridas comparáveis pixel a pixel. Sem elas o
 * describe mede ruído em vez de medir o modo:
 *
 *   1. `larguraContorno: 0` nas TRÊS. `pintarModelo` só traça o contorno INTERNO
 *      sob `larguraContorno > 0`; com 0, alpha e miolo saem idênticos entre as
 *      corridas e o ÚNICO delta possível é o passe de máscara. Com o pintor
 *      injetado deste arquivo isso importa menos (quem põe pixel é
 *      `criarPintorFaixas`, que ignora a opção), mas fica declarado: no dia em
 *      que alguém trocar o pintor por um de verdade, a trava já está no lugar.
 *
 *   2. A paleta DECLARA a chave `contorno`, e `corContorno` fica `undefined` em
 *      A e B. É o que faz `coresDaPaleta` produzir arrays `r`/`g`/`b`
 *      BYTE-IDÊNTICOS nas três corridas, mudando só `pal.contorno` (um índice em
 *      A/B, −1 em C). Se a cor de contorno fosse um hex estranho à paleta, a
 *      corrida COM contorno teria UMA COR A MAIS no snap, o passe 1 poderia
 *      mandar o antialias para outro degrau, e o miolo deixaria de ser
 *      comparável — P1 viraria um teste sobre quantização, não sobre o passe 2.
 *
 *   3. A paleta tem DEGRAUS DE SOBRA para a escada ter escolha: duas famílias em
 *      três luminâncias cada, uma cor emissiva, e a cor de contorno como a mais
 *      escura de todas. Com uma paleta rala a escada cairia no fallback em todo
 *      degrau e o describe passaria medindo o modo `'fixo'` disfarçado.
 * ================================================================== */

/**
 * A régua de luminância — a MESMA de `spriteForge.lumSnap`, e é obrigatório que
 * seja: os pesos `2/4/3` são os da distância de `maisProximo`, e a escada decide
 * "mais escuro" por eles. Reimplementar aqui com a luma de vídeo
 * (0.299/0.587/0.114) faria o teste e a forja discordarem sobre qual cor é mais
 * escura — e o desacordo entre duas réguas é o bug que P3 procura. O divisor 9
 * (= 2+4+3) só mantém a escala em 0..255; a comparação é relativa.
 */
function lumDeRgb(r: number, g: number, b: number): number {
  return (2 * r + 4 * g + 3 * b) / 9;
}

function lumDeChave(chave: number): number {
  return lumDeRgb((chave >> 16) & 255, (chave >> 8) & 255, chave & 255);
}

/* ------------------------------------------------------------------ *
 * 9.1 O material: uma paleta com escada de verdade
 *
 * Duas famílias (musgo, pedra) em três luminâncias cada, uma emissiva e o
 * contorno no piso. As luminâncias na régua acima, para quem quiser conferir a
 * escada no papel:
 *
 *   pedraLuz 195,4 · musgoLuz 162,0 · pedraBase 135,3 · brasa 128,0 (emissiva)
 *   musgoBase 104,7 · pedraSombra 74,4 · musgoSombra 57,2 · contorno 13,6
 *
 * `contorno` é o PISO, e é de propósito: é a única cor para a qual a escada não
 * tem resposta possível e precisa CALAR (degrau 4). Sem uma cor no piso tocando
 * a silhueta, o degrau 4 nunca roda e o halo — que é o defeito dele — fica fora
 * do alcance do teste.
 * ------------------------------------------------------------------ */

const COR_CONTORNO_LOCAL = '#0d0c10';
const NOME_EMISSIVA_LOCAL = 'brasa';

const PALETA_LOCAL: Paleta3D = {
  musgoLuz: '#9ad06a',
  musgoBase: '#5f8f3c',
  musgoSombra: '#33501f',
  pedraLuz: '#c8c6bd',
  pedraBase: '#8d8a80',
  pedraSombra: '#4e4c46',
  brasa: '#ff8a1e',
  contorno: COR_CONTORNO_LOCAL
};

const RAMPAS_LOCAL: RampasPorMaterial = {
  musgo: ['musgoLuz', 'musgoBase', 'musgoSombra'],
  pedra: ['pedraLuz', 'pedraBase', 'pedraSombra'],
  // Rampa de UM degrau, o molde que o cabeçalho de `spriteForge` recomenda para
  // cor emissiva: `coresEmissivas` devolve um conjunto de tamanho 1 e a contagem
  // de pixels vivos fica derivável no papel.
  brasa: ['brasa']
};

const RAMPA_DA_COR_LOCAL: MaterialPorCor = {
  musgoLuz: 'musgo',
  musgoBase: 'musgo',
  musgoSombra: 'musgo',
  pedraLuz: 'pedra',
  pedraBase: 'pedra',
  pedraSombra: 'pedra',
  brasa: 'brasa'
};

/** Todas as cores legais da folha — o mesmo desdobramento de `coresDaPaleta`. */
const CHAVES_DA_PALETA_LOCAL = (() => {
  const saida = new Set<number>();
  for (const nome of Object.keys(PALETA_LOCAL)) {
    const entrada = PALETA_LOCAL[nome];
    if (typeof entrada === 'string') saida.add(chaveDeHex(entrada));
    else for (const h of entrada.rampa) saida.add(chaveDeHex(h));
  }
  return saida;
})();

/** O conjunto que `coresEmissivas` produz: a rampa efetiva de `brasa`, um degrau. */
const CHAVES_EMISSIVAS_LOCAL = new Set<number>([
  chaveDeHex(PALETA_LOCAL[NOME_EMISSIVA_LOCAL] as string)
]);

/**
 * A luminância do PISO: o degrau NÃO-EMISSIVO mais escuro da paleta.
 *
 * É o predicado exato de `tabela[k] === -1` para um `k` não-emissivo — a escada
 * cala quando não existe `j` com `lum[j] < lum[k]`, e isso acontece exatamente
 * quando `lum[k]` é o mínimo. Calculado por mínimo (e comparado com `<=`) em vez
 * de fixado no hex de `contorno` para que um EMPATE de luminância no piso, que a
 * escada também trata como piso, não vire falso negativo.
 */
const PISO_LUM = (() => {
  let piso = Infinity;
  for (const chave of CHAVES_DA_PALETA_LOCAL) {
    if (CHAVES_EMISSIVAS_LOCAL.has(chave)) continue;
    const l = lumDeChave(chave);
    if (l < piso) piso = l;
  }
  return piso;
})();

/* ------------------------------------------------------------------ *
 * 9.2 A figura: quatro faixas e um olho
 *
 * A MESMA silhueta 8×12 de §4 — é `medirFixo` que a declara, e ele é reusado
 * inteiro —, repartida em quatro faixas verticais de 2px, mais um bloco 2×2 da
 * cor emissiva ESTRITAMENTE NO MIOLO.
 *
 *   ┌──┬──┬──┬──┐   faixa 0 → musgoBase   (a escada acha um degrau da família)
 *   │  │  │  │  │   faixa 1 → pedraLuz    (idem, outra família)
 *   │  │▒▒│▒▒│  │   faixa 2 → contorno    (o PISO: a escada CALA aqui)
 *   │  │  │  │  │   faixa 3 → musgoLuz
 *   └──┴──┴──┴──┘   ▒▒ = brasa, emissiva, 2×2, sem tocar o perímetro
 *
 * DUAS DECISÕES DE GEOMETRIA de que o describe inteiro depende:
 *
 *   · as faixas são de altura CHEIA, então as quatro tocam o perímetro — é o que
 *     dá a P4 mais de uma cor de borda e a P3 um caso de piso (a faixa 2) ao lado
 *     de casos repintados;
 *   · o bloco emissivo NÃO toca o perímetro. Se tocasse, o modo `'local'`
 *     deixaria aqueles pixels intactos (degrau 0 da escada) enquanto o `'fixo'`
 *     os cobriria de contorno, e a camada emissiva de B teria MAIS pixels que a
 *     de A — P5 reprovaria medindo uma diferença legítima entre os dois modos,
 *     não um defeito. Um olho no miolo é também o que o cabeçalho de
 *     `spriteForge` manda o autor do personagem fazer.
 *
 * Números por quadro, todos derivados: 96 opacos (`OPACOS_POR_QUADRO`), 36 de
 * borda (`CONTORNO_POR_QUADRO`, que é o perímetro 2·(8+12)−4) e 4 emissivos. A
 * borda se reparte entre as faixas em 14 / 4 / 4 / 14 — as das pontas levam
 * também as colunas laterais.
 * ------------------------------------------------------------------ */

/** 4 faixas × 2px = 8 = `LARGURA_FIGURA`. */
const LARGURA_FAIXA = 2;

/** Canto e lado do bloco emissivo, em coordenadas LOCAIS da figura (0..7, 0..11). */
const BRASA_X = 3;
const BRASA_Y = 5;
const BRASA_LADO = 2;
const EMISSIVOS_POR_QUADRO = BRASA_LADO * BRASA_LADO;

/**
 * As cores CRUAS das faixas: fora da paleta, cada uma a +3 por canal do degrau
 * que deve capturá-la. O deslocamento é grande o bastante para provar que o snap
 * agiu (nenhuma delas sobrevive na folha) e pequeno o bastante para o degrau
 * vizinho ser inequívoco — 81 de distância ponderada até o alvo, contra dezenas
 * de milhares até qualquer outro degrau.
 */
const CRUAS_DAS_FAIXAS: readonly string[] = ['#62923f', '#c5c3ba', '#100f13', '#9dd36d'];
const CRUA_BRASA = '#fc8d21';

/** Onde cada faixa termina depois do snap — na ordem de `CRUAS_DAS_FAIXAS`. */
const ALVOS_DAS_FAIXAS: readonly string[] = ['#5f8f3c', '#c8c6bd', '#0d0c10', '#9ad06a'];

/**
 * O pintor das faixas. Irmão de `criarPintorInjetado`: mesma injeção, mesma caixa
 * medida, mesma regra de encostar a figura na origem que a forja mandou — só a
 * repartição interna muda.
 */
function criarPintorFaixas(): PintorInjetado {
  const recebidas: OpcoesModelo[] = [];

  function desenhar(ctx: CanvasRenderingContext2D | null, raiz: No, opts: OpcoesModelo): void;
  function desenhar(
    ctx: CanvasRenderingContext2D | null,
    raiz: No,
    pose: Pose | undefined,
    yaw: number,
    origemX?: number,
    origemY?: number,
    artPorU?: number,
    paleta?: Paleta3D
  ): void;
  function desenhar(
    ctx: CanvasRenderingContext2D | null,
    _raiz: No,
    a: OpcoesModelo | Pose | undefined,
    yaw?: number,
    _origemX?: number,
    _origemY?: number,
    _artPorU?: number,
    _paleta?: Paleta3D
  ): void {
    if (typeof yaw === 'number' || a === undefined) {
      throw new Error('a forja chamou `desenhar` na forma POSICIONAL — este teste mede a de opções');
    }
    const opts = a as OpcoesModelo;
    recebidas.push(opts);
    if (!ctx) return;
    const ox = typeof opts.offsetX === 'number' ? opts.offsetX : 0;
    const oy = typeof opts.offsetY === 'number' ? opts.offsetY : 0;
    const esq = ox + CAIXA.minX;
    const topo = oy + CAIXA.minY;
    for (let k = 0; k < CRUAS_DAS_FAIXAS.length; k++) {
      pintarBloco(ctx, esq + k * LARGURA_FAIXA, topo, LARGURA_FAIXA, ALTURA_FIGURA, CRUAS_DAS_FAIXAS[k]);
    }
    // Por último e por cima: o olho é uma sobreposição, não uma quinta faixa.
    pintarBloco(ctx, esq + BRASA_X, topo + BRASA_Y, BRASA_LADO, BRASA_LADO, CRUA_BRASA);
  }

  return { desenhar: desenhar, recebidas: recebidas };
}

/* ------------------------------------------------------------------ *
 * 9.3 Forjar as três corridas e ler as bordas
 * ------------------------------------------------------------------ */

/**
 * As opções comuns às três corridas. `corContorno` é OMITIDO de propósito (trava
 * 2 do cabeçalho desta seção) e `larguraContorno: 0` é a trava 1.
 */
function opcoesLocais(): OpcoesForja {
  return {
    paleta: PALETA_LOCAL,
    rampas: RAMPAS_LOCAL,
    rampaDaCor: RAMPA_DA_COR_LOCAL,
    emissivas: [NOME_EMISSIVA_LOCAL],
    larguraContorno: 0
  };
}

/** Forja com o pintor de faixas injetado — o caminho que desvia o cache. */
function forjarFaixas(extra?: Partial<OpcoesForja>): AtlasPersonagem {
  const pintor = criarPintorFaixas();
  return forjarAtlas(RIG_FORJA, {
    ...opcoesLocais(),
    ...extra,
    desenhar: pintor.desenhar,
    medir: MEDIR_INJETADO
  });
}

interface Trio {
  /** `modoContorno` omitido: o modo `'fixo'`. */
  a: Folha;
  /** `modoContorno: 'local'`. */
  b: Folha;
  /** `corContorno: null`: cor local pura, sem passe 2. */
  c: Folha;
  atlasA: AtlasPersonagem;
  atlasB: AtlasPersonagem;
}

function forjarTrio(): Trio {
  const atlasA = forjarFaixas();
  const atlasB = forjarFaixas({ modoContorno: 'local' });
  const atlasC = forjarFaixas({ corContorno: null });
  return {
    a: folhaCrua(atlasA.canvas),
    b: folhaCrua(atlasB.canvas),
    c: folhaCrua(atlasC.canvas),
    atlasA: atlasA,
    atlasB: atlasB
  };
}

/** Índices de BYTE (múltiplos de 4) dos pixels opacos, separados por borda/miolo. */
interface Varredura {
  borda: number[];
  miolo: number[];
}

/**
 * O mesmo critério de `censo` e o mesmo de `snaparBuffer`: opaco com pelo menos
 * um vizinho-4 transparente. Devolve as POSIÇÕES em vez de contagens porque os
 * predicados desta seção comparam folha contra folha no mesmo endereço.
 */
function varrer(f: Folha): Varredura {
  const borda: number[] = [];
  const miolo: number[] = [];
  for (let y = 0; y < f.altura; y++) {
    for (let x = 0; x < f.largura; x++) {
      const i = (y * f.largura + x) * 4;
      if (f.bytes[i + 3] === 0) continue;
      const eBorda =
        alphaEm(f, x - 1, y) === 0 ||
        alphaEm(f, x + 1, y) === 0 ||
        alphaEm(f, x, y - 1) === 0 ||
        alphaEm(f, x, y + 1) === 0;
      if (eBorda) borda.push(i);
      else miolo.push(i);
    }
  }
  return { borda: borda, miolo: miolo };
}

function chaveEm(f: Folha, i: number): number {
  return chaveRgb(f.bytes[i], f.bytes[i + 1], f.bytes[i + 2]);
}

function lumEm(f: Folha, i: number): number {
  return lumDeRgb(f.bytes[i], f.bytes[i + 1], f.bytes[i + 2]);
}

function hexEm(f: Folha, i: number): string {
  return '#' + chaveEm(f, i).toString(16).padStart(6, '0');
}

/** `(x,y)` na folha, a partir do índice de byte — para a mensagem de falha. */
function ondeEsta(f: Folha, i: number): string {
  const p = i / 4;
  return '(' + (p % f.largura) + ',' + Math.floor(p / f.largura) + ')';
}

/** Quantas cores distintas ocupam um conjunto de posições. */
function coresDistintas(f: Folha, posicoes: readonly number[]): Set<number> {
  const saida = new Set<number>();
  for (const i of posicoes) saida.add(chaveEm(f, i));
  return saida;
}

/** Pixels não transparentes de uma camada emissiva. */
function vivosNaEmissiva(cv: HTMLCanvasElement | null): number {
  const e = folhaCrua(cv);
  let vivos = 0;
  for (let i = 3; i < e.bytes.length; i += 4) if (e.bytes[i] !== 0) vivos++;
  return vivos;
}

/* ------------------------------------------------------------------ *
 * 9.4 Os casos, na ordem dos predicados
 * ------------------------------------------------------------------ */

describe("forjarAtlas — o contorno no modo 'local' (§2.1)", () => {
  beforeEach(() => {
    instalarDomDeForjaPixel();
  });

  afterEach(() => {
    removerDomDeForjaPixel();
  });

  it('a base de comparação é o que se pensa: figura, faixas e olho no lugar', () => {
    /*
     * Antes dos predicados, o chão. Se a figura não for a descrita, P0-P5 medem
     * outra coisa e o vermelho deles apontaria para o lugar errado. Este caso é o
     * que transforma "P3 falhou" em "P3 falhou E a figura estava certa".
     */
    const { a, c, atlasA } = forjarTrio();
    const varreduraC = varrer(c);

    expect(varreduraC.borda.length, 'perímetro da silhueta na folha inteira')
      .toBe(CONTORNO_POR_QUADRO * TOTAL_QUADROS);
    expect(varreduraC.borda.length + varreduraC.miolo.length, 'pixels opacos na folha inteira')
      .toBe(OPACOS_POR_QUADRO * TOTAL_QUADROS);

    /* As quatro faixas snaparam para onde deviam, e nenhuma cor crua sobreviveu —
     * a prova de que o passe 1 agiu, não de que o pintor já pintava certo. */
    const porCorC = new Map<number, number>();
    for (const i of [...varreduraC.borda, ...varreduraC.miolo]) {
      const k = chaveEm(c, i);
      porCorC.set(k, (porCorC.get(k) ?? 0) + 1);
    }
    for (const crua of CRUAS_DAS_FAIXAS) {
      expect(porCorC.get(chaveDeHex(crua)) ?? 0, 'a cor crua ' + crua + ' sobreviveu ao snap').toBe(0);
    }
    expect(porCorC.get(chaveDeHex(CRUA_BRASA)) ?? 0, 'a cor crua do olho sobreviveu ao snap').toBe(0);
    for (const alvo of ALVOS_DAS_FAIXAS) {
      expect(porCorC.get(chaveDeHex(alvo)) ?? 0, 'a faixa ' + alvo + ' não chegou ao seu degrau')
        .toBeGreaterThan(0);
    }

    /*
     * A PRECONDIÇÃO DE P3, dita em voz alta: nenhum pixel de borda é emissivo.
     * A escada cala sobre cor emissiva (degrau 0), então um olho encostado na
     * silhueta seria um caso em que B === C sem que C esteja no piso — e P3, que
     * não tem esse ramo, reprovaria por um motivo que não é defeito. Aqui a
     * condição é geometria (o bloco 2×2 está no miolo), e é aqui que ela é
     * VERIFICADA em vez de assumida.
     */
    let bordasEmissivas = 0;
    for (const i of varreduraC.borda) if (CHAVES_EMISSIVAS_LOCAL.has(chaveEm(c, i))) bordasEmissivas++;
    expect(bordasEmissivas, 'o olho encostou na silhueta — a precondição de P3 caiu').toBe(0);

    /* E a corrida A é mesmo o modo `'fixo'`: a borda inteira na cor de contorno,
     * resolvida pela chave `contorno` da paleta — a trava 2 em ato. */
    const bordaDeA = coresDistintas(a, varreduraC.borda);
    expect(bordaDeA.size, 'a borda do modo fixo não é de uma cor só').toBe(1);
    expect(bordaDeA.has(chaveDeHex(COR_CONTORNO_LOCAL)), 'a borda do modo fixo não é a cor de contorno')
      .toBe(true);

    /* O piso é o contorno, e é o que faz a faixa 2 exercitar o degrau 4 da
     * escada. Se um dia a paleta ganhar uma cor mais escura, esta linha avisa. */
    expect(lumDeChave(chaveDeHex(COR_CONTORNO_LOCAL)), 'a cor de contorno deixou de ser o piso da paleta')
      .toBe(PISO_LUM);

    expect(atlasA.disponivel, 'a forja não completou').toBe(true);
  });

  it('P0 — o alpha é o MESMO nas três corridas, pixel a pixel', () => {
    /*
     * Primeiro de todos, por um motivo estrutural: os predicados seguintes
     * comparam cor no MESMO endereço entre folhas diferentes. Se a silhueta
     * mudasse entre as corridas, "a borda ficou mais escura" compararia dois
     * pixels que não são o mesmo pixel, e tanto o verde quanto o vermelho seriam
     * mentira. O passe 2 só reescreve RGB — alpha é decisão exclusiva do passe 1,
     * e o passe 1 é idêntico nas três (trava 2).
     */
    const { a, b, c } = forjarTrio();
    expect(b.largura + 'x' + b.altura, 'B mudou de tamanho').toBe(a.largura + 'x' + a.altura);
    expect(c.largura + 'x' + c.altura, 'C mudou de tamanho').toBe(a.largura + 'x' + a.altura);

    let divergenciasAB = 0;
    let divergenciasAC = 0;
    for (let i = 3; i < a.bytes.length; i += 4) {
      if (a.bytes[i] !== b.bytes[i]) divergenciasAB++;
      if (a.bytes[i] !== c.bytes[i]) divergenciasAC++;
    }
    expect(divergenciasAB, "o modo 'local' mexeu no alpha — o passe 2 só pode escrever RGB").toBe(0);
    expect(divergenciasAC, 'desligar o contorno mexeu no alpha').toBe(0);
  });

  it('P1 — o passe 2 não vaza para dentro: todo miolo de B é a cor local de C', () => {
    /*
     * O modo `'local'` decide pela cor do PRÓPRIO pixel, então a tentação de
     * implementação é varrer sem filtrar borda e escurecer tudo — o sprite
     * inteiro sairia um degrau mais escuro, o que na bancada lê como "ficou
     * bonito" e é, na verdade, a paleta do personagem trocada em silêncio.
     */
    const { b, c } = forjarTrio();
    const { miolo } = varrer(c);
    expect(miolo.length, 'a figura não tem miolo — a comparação seria vazia').toBeGreaterThan(0);

    const vazamentos: string[] = [];
    for (const i of miolo) {
      if (chaveEm(b, i) === chaveEm(c, i)) continue;
      if (vazamentos.length < 5) {
        vazamentos.push(ondeEsta(c, i) + ' C=' + hexEm(c, i) + ' B=' + hexEm(b, i));
      }
    }
    expect(vazamentos, 'o passe 2 repintou pixel que não é borda').toEqual([]);
  });

  it('P2 — G5: nenhuma cor inventada, toda a folha de B está na paleta declarada', () => {
    /*
     * O modo escurece por MULTIPLICAÇÃO (`k·F`), e o produto quase nunca é uma
     * cor declarada. O contrato é que a multiplicação sirva só de ALVO DE BUSCA:
     * o que vai para o pixel é sempre um degrau da paleta. Escrever `k·F` cru
     * seria a implementação mais curta — e a que fura o G5 passando em P0, P1,
     * P3 e P4 sem tirar um fio do lugar.
     */
    const { b, c } = forjarTrio();
    const { borda, miolo } = varrer(c);

    const forasteiras = new Set<string>();
    for (const i of [...borda, ...miolo]) {
      if (!CHAVES_DA_PALETA_LOCAL.has(chaveEm(b, i))) forasteiras.add(hexEm(b, i));
    }
    expect([...forasteiras], "o modo 'local' inventou cor fora da paleta").toEqual([]);
  });

  it('P3 — O HALO: nenhuma borda de B ficou mais clara que a cor local de C', () => {
    /*
     * O predicado, e por que ele tem exatamente estes dois ramos:
     *
     *   (a) lum(B[p]) < lum(C[p])                      — repintada MAIS ESCURA;
     *   (b) B[p] === C[p]  E  lum(C[p]) === PISO_LUM   — NÃO repintada, porque a
     *                                                    cor local já era o piso.
     *
     * O ramo (a) subsume "B[p] ≠ C[p]": desigualdade estrita de luminância já
     * implica cor diferente, então não há por que testar a diferença à parte.
     *
     * O ramo (b) exige `B[p] === C[p]`, e é AÍ que mora o teste. A leitura
     * ingênua — "pixel no piso está dispensado" — seria uma anistia: a escada
     * poderia pintar o que quisesse por cima da cor mais escura da paleta e
     * passar. E é precisamente isso que o bug do halo faz. Quando `k` é o piso, a
     * implementação errada cai na "cor mais escura com índice diferente de k",
     * que por construção é mais CLARA que `k`; o pixel muda, fica mais claro, e um
     * ramo (b) frouxo daria verde. Com `B[p] === C[p]` no ramo, o único jeito de
     * passar é a escada CALAR — que é o degrau 4 de `tabelaBordaLocal`.
     *
     * As duas contagens no fim não são enfeite: elas provam que os DOIS ramos
     * rodaram. Um predicado disjuntivo em que só um lado acontece é um predicado
     * pela metade — e aqui seria pior, porque o lado que não rodasse é justamente
     * o que enxerga o halo.
     */
    const { b, c } = forjarTrio();
    const { borda } = varrer(c);

    let repintadasMaisEscuras = 0;
    let caladasNoPiso = 0;
    const halos: string[] = [];

    for (const i of borda) {
      const lb = lumEm(b, i);
      const lc = lumEm(c, i);
      if (lb < lc) {
        repintadasMaisEscuras++;
        continue;
      }
      if (chaveEm(b, i) === chaveEm(c, i) && lc <= PISO_LUM) {
        caladasNoPiso++;
        continue;
      }
      if (halos.length < 5) {
        halos.push(
          ondeEsta(c, i) +
            ' local=' +
            hexEm(c, i) +
            ' (lum ' +
            lc.toFixed(1) +
            ') borda=' +
            hexEm(b, i) +
            ' (lum ' +
            lb.toFixed(1) +
            ')'
        );
      }
    }

    expect(halos, 'HALO: borda mais clara que a cor local, ou repintada estando no piso').toEqual([]);
    expect(repintadasMaisEscuras, 'nenhuma borda foi escurecida — o modo não fez nada')
      .toBeGreaterThan(0);
    expect(caladasNoPiso, 'nenhuma borda no piso da paleta — o degrau 4 da escada não foi exercitado')
      .toBeGreaterThan(0);
  });

  it('P4 — a borda de B tem mais de uma cor, e B difere de A', () => {
    /*
     * O par de asserções que uma implementação silenciosamente caída no modo
     * `'fixo'` não passa — e ela passaria em P0, P1, P2 e P3 sem tirar um fio do
     * lugar (uma borda toda na cor de contorno é mais escura que qualquer cor
     * local, exceto a própria, que o ramo (b) de P3 dispensa).
     *
     *   · MAIS DE UMA cor na borda: é a definição operacional de "local". Um traço
     *     único, seja de que cor for, tem cardinalidade 1.
     *   · B ≠ A em ao menos uma borda: fecha a porta do caso degenerado em que a
     *     paleta conspirasse para a escada devolver sempre a cor de contorno.
     */
    const { a, b, c } = forjarTrio();
    const { borda } = varrer(c);

    const coresDeB = coresDistintas(b, borda);
    expect(coresDeB.size, "a borda do modo 'local' tem cor única — o modo caiu no 'fixo'")
      .toBeGreaterThan(1);

    let diferencasContraA = 0;
    for (const i of borda) if (chaveEm(b, i) !== chaveEm(a, i)) diferencasContraA++;
    expect(diferencasContraA, "o modo 'local' desenhou a mesma borda do 'fixo'").toBeGreaterThan(0);
  });

  it('P5 — o brilho sobreviveu: a camada emissiva de B é a de A', () => {
    /*
     * A camada emissiva sai de `extrairEmissivo`, que roda DEPOIS, sobre o atlas
     * pronto, e reconhece o olho por igualdade de RGB. Qualquer coisa que repinte
     * um pixel emissivo o apaga da camada — em silêncio, sem exceção e sem mudar
     * mais nada na folha. É a armadilha que o cabeçalho de `spriteForge` documenta
     * para o contorno de silhueta, e o modo `'local'` tinha de nascer imune a ela
     * (degrau 0 da escada: cor emissiva nunca é escurecida).
     *
     * Com o olho no miolo (ver §9.2) os dois modos preservam os mesmos 4 px por
     * quadro, e a IGUALDADE é a asserção certa. A contagem absoluta entra junto
     * porque "iguais" também seria verdade com as duas zeradas.
     */
    const { atlasA, atlasB } = forjarTrio();
    expect(atlasA.emissivo, 'a camada emissiva de A não foi extraída').not.toBeNull();
    expect(atlasB.emissivo, 'a camada emissiva de B não foi extraída').not.toBeNull();

    const vivosA = vivosNaEmissiva(atlasA.emissivo);
    const vivosB = vivosNaEmissiva(atlasB.emissivo);
    expect(vivosA, 'pixels vivos na camada emissiva do modo fixo')
      .toBe(EMISSIVOS_POR_QUADRO * TOTAL_QUADROS);
    expect(vivosB, "o modo 'local' comeu pixel emissivo").toBe(vivosA);
  });

  it('P6 — `modoContorno` e `fatorContorno` estão na CHAVE do cache', () => {
    /*
     * SEM INJEÇÃO de propósito: `forjarAtlas` desvia a memoização inteira quando
     * `desenhar` ou `medir` chegam, e é justamente a memoização que está em
     * julgamento aqui. Como no §8, este caso não mede pixel — o canvas de software
     * não rasteriza polígono — e não precisa: a pergunta é se duas forjas com
     * opções diferentes devolvem OBJETOS diferentes.
     *
     * O que uma chave incompleta faria: a segunda forja receberia o atlas da
     * primeira, com o modo errado, sem erro de tipo, sem exceção e sem nenhum
     * teste de unidade acusando — o terreno sairia com o contorno do personagem
     * ou vice-versa, conforme quem forjou primeiro. É a falha mais barata de
     * cometer e a mais cara de diagnosticar.
     */
    const base: OpcoesForja = opcoesLocais();

    const fixo1 = forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'fixo' });
    expect(fixo1.disponivel, 'a forja sem injeção não completou').toBe(true);
    expect(forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'fixo' }), 'a memoização por valor quebrou')
      .toBe(fixo1);

    const local1 = forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'local' });
    expect(local1, "'fixo' e 'local' colidiram no cache — `modoContorno` não está na chave")
      .not.toBe(fixo1);
    expect(forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'local' }), "a memoização do 'local' quebrou")
      .toBe(local1);

    const forte = forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'local', fatorContorno: 0.9 });
    expect(forte, 'dois fatores colidiram no cache — `fatorContorno` não está na chave')
      .not.toBe(local1);
    expect(
      forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'local', fatorContorno: 0.9 }),
      'a memoização do fator quebrou'
    ).toBe(forte);

    /* E os vizinhos não despejaram o primeiro: o cache é um mapa por chave. */
    expect(forjarAtlas(RIG_FORJA, { ...base, modoContorno: 'fixo' }), 'a entrada original foi sobrescrita')
      .toBe(fixo1);
  });

  it('P7 — os sensores de degeneração: zerados no fixo, coerentes no local', () => {
    /*
     * `bordaLocalFallback` e `bordaLocalMudos` contam DEGRAUS DA PALETA, não
     * pixels: a escada é uma tabela calculada uma vez por forja. Daí os números
     * pequenos, e daí serem exatos e deriváveis.
     *
     * No modo `'fixo'` a tabela nem é montada, então os dois têm de ser 0 — um
     * valor não-zero ali significaria que o modo `'local'` rodou sem ninguém
     * pedir.
     *
     * No `'local'` com o fator padrão (0,5), mudos = 2 e são NOMEÁVEIS: `brasa`
     * (emissiva, degrau 0 da escada) e `contorno` (o piso, degrau 4). Nenhum dos
     * outros seis precisa de fallback — cada um tem um degrau mais escuro a
     * distância curta de `k·0,5`, que é exatamente a condição que a trava 3
     * (paleta com degraus de sobra) existe para garantir.
     */
    const fixo = forjarFaixas();
    expect(fixo.bordaLocalFallback, 'o modo fixo montou tabela de borda local').toBe(0);
    expect(fixo.bordaLocalMudos, 'o modo fixo montou tabela de borda local').toBe(0);

    const local = forjarFaixas({ modoContorno: 'local' });
    expect(local.bordaLocalMudos, 'mudos: a cor emissiva e a cor do piso').toBe(2);
    expect(local.bordaLocalFallback, 'com fator 0,5 esta paleta não devia precisar de fallback').toBe(0);
    /* NÃO asserir `fallback + mudos <= tamanho da paleta`: é garantido por
     * construção (cada `k` do laço de `tabelaBordaLocal` incrementa no máximo um
     * dos dois contadores), então passaria com qualquer implementação — inclusive
     * com a escada quebrada. As duas asserções exatas acima é que carregam a
     * informação. */
  });

  it('`corContorno: null` desliga a silhueta TAMBÉM no modo local', () => {
    /*
     * A combinação que ninguém cobria, e onde uma guarda plausível quebra o
     * contrato. `OpcoesForja.corContorno` promete que `null` desliga o contorno
     * de silhueta; `modoContorno` decide COMO a borda escolhe a cor, não SE ela
     * existe. Escrever a guarda do passe 2 como `pal.contorno >= 0 || bordaLocal
     * !== null` — que parece a extensão natural — faz o modo `'local'` repintar
     * a silhueta inteira mesmo com `null`, porque a escada acha cores escuras
     * sozinha pelo degrau 3, sem precisar da cor de contorno declarada.
     *
     * A asserção é de igualdade byte a byte com a referência SEM contorno: não
     * basta "algum pixel igual", tem de ser a folha inteira. E os sensores têm de
     * ficar zerados, senão o painel de debug reportaria uma tabela que ninguém
     * consultou.
     */
    const semContorno = forjarFaixas({ corContorno: null });
    const semContornoLocal = forjarFaixas({ corContorno: null, modoContorno: 'local' });

    const a = folhaCrua(semContorno.canvas).bytes;
    const b = folhaCrua(semContornoLocal.canvas).bytes;
    expect(b.length, 'as duas folhas têm tamanhos diferentes').toBe(a.length);

    let diferentes = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diferentes++;
    expect(diferentes, 'o modo local repintou a silhueta apesar de corContorno: null').toBe(0);

    expect(semContornoLocal.bordaLocalFallback, 'montou tabela sem contorno para pintar').toBe(0);
    expect(semContornoLocal.bordaLocalMudos, 'montou tabela sem contorno para pintar').toBe(0);
  });

  it('P8 — o sensor mede o que promete: fator alto degenera a escada', () => {
    /*
     * A degeneração documentada em `OpcoesForja.fatorContorno`: quanto mais perto
     * de 1 o fator, mais `k·F` fica perto do próprio `k`, e mais degraus têm a SI
     * MESMOS como vizinho mais próximo — o que a escada resolve caindo na cor de
     * contorno declarada. Com F = 0,9 isso vale para todo degrau que não seja o
     * piso nem emissivo, e o modo vira o `'fixo'` sem avisar.
     *
     * Duas asserções, e a segunda é a que dá sentido à primeira: o CONTADOR sobe,
     * e a FOLHA confirma que ele não está contando ficção — a borda perde cores
     * distintas, que é o efeito visível da degeneração. Um sensor que subisse sem
     * a folha mudar seria um número decorativo.
     */
    const meio = forjarFaixas({ modoContorno: 'local' });
    const alto = forjarFaixas({ modoContorno: 'local', fatorContorno: 0.9 });

    expect(alto.bordaLocalFallback, 'o fallback não cresceu com o fator — o sensor não mede degeneração')
      .toBeGreaterThan(meio.bordaLocalFallback);

    const c = folhaCrua(forjarFaixas({ corContorno: null }).canvas);
    const { borda } = varrer(c);
    const coresMeio = coresDistintas(folhaCrua(meio.canvas), borda);
    const coresAlto = coresDistintas(folhaCrua(alto.canvas), borda);
    expect(coresAlto.size, 'o fator alto não achatou a borda — a degeneração é só do contador')
      .toBeLessThan(coresMeio.size);
  });
});
