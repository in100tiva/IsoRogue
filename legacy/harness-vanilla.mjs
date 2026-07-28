#!/usr/bin/env node
/*
 * ISOROGUE — harness headless
 * ---------------------------
 * Carrega index.html, extrai o conteúdo do <script> e executa em node:vm com
 * um sandbox mínimo (window, document, canvas 2D, localStorage, crypto...).
 * Roda os 10 testes obrigatórios do contrato (§11) e sai com código 1 se
 * qualquer um falhar.
 *
 * Regra dura: QUALQUER console.error ou console.warn emitido pelo jogo
 * (na carga ou durante os testes) é FALHA.
 *
 * Node >= 18, ESM, zero dependências.
 *
 * Uso:
 *   node tools/harness.mjs                  roda tudo (parâmetros do contrato)
 *   node tools/harness.mjs --only T4,T6     roda só alguns testes
 *   node tools/harness.mjs --rapido         amostras menores (iteração rápida)
 *   node tools/harness.mjs --verbose        mostra console.log do jogo
 *   node tools/harness.mjs --listar         lista os testes e sai
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { inspect } from 'node:util';
import vm from 'node:vm';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const ARQ_HTML = join(RAIZ, 'index.html');

const SEP = '─'.repeat(74);
const SEP2 = '═'.repeat(74);

/* ------------------------------------------------------------------ */
/* argumentos                                                          */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const RAPIDO = flags.has('--rapido') || flags.has('--quick');
const VERBOSE = flags.has('--verbose') || flags.has('--detalhado');
const LISTAR = flags.has('--listar') || flags.has('--list');

let SOMENTE = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only' || argv[i] === '--somente') {
    SOMENTE = new Set(String(argv[i + 1] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  } else if (argv[i].startsWith('--only=') || argv[i].startsWith('--somente=')) {
    SOMENTE = new Set(argv[i].split('=')[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  }
}

/* ------------------------------------------------------------------ */
/* utilitários gerais                                                  */
/* ------------------------------------------------------------------ */

function rel(caminho) {
  const r = relative(RAIZ, caminho);
  return r === '' ? '.' : r.split('\\').join('/');
}

function abortar(mensagem, dicas) {
  console.error('');
  console.error('[harness] ERRO FATAL: ' + mensagem);
  if (dicas && dicas.length) {
    console.error('');
    for (const d of dicas) console.error('          · ' + d);
  }
  console.error('');
  process.exit(1);
}

/* RNG determinístico do PRÓPRIO harness (nada de Math.random em lugar nenhum). */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rngLocal(semente) {
  let s = semente >>> 0;
  const rng = {
    u32() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    next() {
      return rng.u32() / 4294967296;
    },
    int(a, b) {
      return a + Math.floor(rng.next() * (b - a + 1));
    },
    pick(arr) {
      return arr.length ? arr[rng.int(0, arr.length - 1)] : undefined;
    }
  };
  return rng;
}

const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function pad(n, largura) {
  return String(n).padStart(largura, '0');
}

function ms(n) {
  return n < 1000 ? n.toFixed(0) + ' ms' : (n / 1000).toFixed(2).replace('.', ',') + ' s';
}

function recorta(texto, max) {
  const t = String(texto);
  return t.length <= max ? t : t.slice(0, max) + '…(+' + (t.length - max) + ')';
}

/* ------------------------------------------------------------------ */
/* 1. carregar index.html e extrair o script                           */
/* ------------------------------------------------------------------ */

if (!existsSync(ARQ_HTML)) {
  abortar('não encontrei ' + rel(ARQ_HTML) + '.', [
    'Gere o entregável primeiro: node tools/build.mjs'
  ]);
}

let html = '';
try {
  html = readFileSync(ARQ_HTML, 'utf8');
} catch (err) {
  abortar('não consegui ler ' + rel(ARQ_HTML) + ': ' + (err && err.message));
}

function extrairScripts(fonte) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const blocos = [];
  let base = 1;
  let m;
  while ((m = re.exec(fonte)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (blocos.length === 0) {
      const antes = fonte.slice(0, m.index + m[0].indexOf('>') + 1);
      base = antes.split('\n').length; // linha do html onde o conteúdo começa
    }
    blocos.push(m[2]);
  }
  return { blocos: blocos, linhaBase: base };
}

const extracao = extrairScripts(html);
const blocos = extracao.blocos;
/* Todas as linhas reportadas pelo harness são linhas reais de index.html. */
const LINHA_BASE = extracao.linhaBase;
if (blocos.length === 0) {
  abortar('nenhum bloco <script> inline encontrado em ' + rel(ARQ_HTML) + '.', [
    'O build deve injetar os módulos no marcador <!--INJECT_JS--> dentro de <script>.'
  ]);
}
const codigo = blocos.join('\n;\n');
if (codigo.trim().length < 200) {
  abortar('o <script> de ' + rel(ARQ_HTML) + ' tem apenas ' + codigo.trim().length +
    ' caracteres — provavelmente o build não injetou os módulos.', [
      'Rode: node tools/build.mjs'
    ]);
}

/* mapa linha de index.html -> módulo, usando os banners de src/XX-nome.js */
const marcasModulo = (function () {
  const linhas = codigo.split('\n');
  const re = /^\s*\/\* === (src\/[^\s*]+) === \*\/\s*$/;
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = re.exec(linhas[i]);
    if (m) out.push({ linha: i + LINHA_BASE, arquivo: m[1] });
  }
  return out;
})();

function moduloNaLinha(linha) {
  let atual = null;
  for (const m of marcasModulo) {
    if (m.linha <= linha) atual = m;
    else break;
  }
  if (!atual) return null;
  return { arquivo: atual.arquivo, linhaRelativa: linha - atual.linha };
}

function localizar(stack) {
  if (!stack) return null;
  const m = /index\.html:(\d+):(\d+)/.exec(String(stack));
  if (!m) return null;
  const linha = parseInt(m[1], 10);
  const col = parseInt(m[2], 10);
  const mod = moduloNaLinha(linha);
  if (!mod) return 'index.html:' + linha + ':' + col;
  return mod.arquivo + ' (linha ~' + mod.linhaRelativa + ' do módulo) · index.html:' +
    linha + ':' + col;
}

/* ------------------------------------------------------------------ */
/* 2. sandbox                                                          */
/* ------------------------------------------------------------------ */

const registro = {
  fase: 'carga',
  problemas: [], // console.warn / console.error
  logs: []
};

function fmt(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 2, colors: false, breakLength: 120 })))
    .join(' ');
}

function anotarProblema(nivel, args) {
  const stack = new Error('marcador').stack;
  registro.problemas.push({
    fase: registro.fase,
    nivel: nivel,
    texto: fmt(args),
    onde: localizar(stack)
  });
}

function criarConsole() {
  const nada = () => {};
  const registrarLog = (...a) => {
    const texto = fmt(a);
    registro.logs.push({ fase: registro.fase, texto: texto });
    if (registro.logs.length > 400) registro.logs.shift();
    if (VERBOSE) console.log('        [jogo] ' + recorta(texto, 400));
  };
  return {
    log: registrarLog,
    info: registrarLog,
    debug: registrarLog,
    dir: registrarLog,
    table: registrarLog,
    trace: registrarLog,
    warn: (...a) => anotarProblema('warn', a),
    error: (...a) => anotarProblema('error', a),
    assert: (cond, ...a) => {
      if (!cond) anotarProblema('error', ['console.assert falhou:', ...a]);
    },
    group: nada,
    groupCollapsed: nada,
    groupEnd: nada,
    time: nada,
    timeEnd: nada,
    timeLog: nada,
    count: nada,
    countReset: nada,
    clear: nada
  };
}

function criarLocalStorage() {
  const dados = new Map();
  return {
    getItem(k) {
      k = String(k);
      return dados.has(k) ? dados.get(k) : null;
    },
    setItem(k, v) {
      dados.set(String(k), String(v));
    },
    removeItem(k) {
      dados.delete(String(k));
    },
    clear() {
      dados.clear();
    },
    key(i) {
      const chaves = Array.from(dados.keys());
      return i >= 0 && i < chaves.length ? chaves[i] : null;
    },
    get length() {
      return dados.size;
    }
  };
}

function criarClassList() {
  const s = new Set();
  return {
    add(...cs) {
      for (const c of cs) if (c) s.add(String(c));
    },
    remove(...cs) {
      for (const c of cs) s.delete(String(c));
    },
    toggle(c, forcar) {
      c = String(c);
      const tem = s.has(c);
      const ligar = forcar === undefined ? !tem : !!forcar;
      if (ligar) s.add(c);
      else s.delete(c);
      return ligar;
    },
    contains(c) {
      return s.has(String(c));
    },
    replace(a, b) {
      if (s.has(String(a))) {
        s.delete(String(a));
        s.add(String(b));
        return true;
      }
      return false;
    },
    item(i) {
      return Array.from(s)[i] || null;
    },
    get length() {
      return s.size;
    },
    toString() {
      return Array.from(s).join(' ');
    }
  };
}

const METODOS_CTX = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'quadraticCurveTo', 'bezierCurveTo', 'arcTo', 'arc', 'ellipse', 'rect',
  'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform',
  'fillText', 'strokeText', 'drawImage', 'setLineDash', 'putImageData',
  'scrollPathIntoView', 'drawFocusIfNeeded'
];

function criarContexto2D(canvas) {
  const ctx = {
    canvas: canvas,
    /* propriedades usadas pelo render */
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'ltr',
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: 'none',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    /* métodos que devolvem algo */
    measureText(texto) {
      const n = texto == null ? 0 : String(texto).length;
      return {
        width: 0,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 0,
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
        fontBoundingBoxAscent: 0,
        fontBoundingBoxDescent: 0,
        emHeightAscent: 0,
        emHeightDescent: 0,
        caracteres: n
      };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    createConicGradient() {
      return { addColorStop() {} };
    },
    createPattern() {
      return { setTransform() {} };
    },
    getLineDash() {
      return [];
    },
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
    createImageData(w, h) {
      const largura = Math.max(1, w | 0);
      const altura = Math.max(1, (h === undefined ? 1 : h) | 0);
      return { width: largura, height: altura, data: new Uint8ClampedArray(largura * altura * 4) };
    },
    getImageData(x, y, w, h) {
      const largura = Math.max(1, w | 0);
      const altura = Math.max(1, h | 0);
      return { width: largura, height: altura, data: new Uint8ClampedArray(largura * altura * 4) };
    },
    isPointInPath() {
      return false;
    },
    isPointInStroke() {
      return false;
    }
  };
  for (const nome of METODOS_CTX) {
    if (typeof ctx[nome] !== 'function') ctx[nome] = function () {};
  }
  return ctx;
}

let contadorNos = 0;

function criarElemento(tag, id) {
  const filhos = [];
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    id: id || '',
    className: '',
    title: '',
    value: '',
    textContent: '',
    innerHTML: '',
    innerText: '',
    outerHTML: '',
    disabled: false,
    checked: false,
    hidden: false,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 1000,
    scrollWidth: 1000,
    clientWidth: 960,
    clientHeight: 640,
    offsetWidth: 960,
    offsetHeight: 640,
    width: 960,
    height: 640,
    parentNode: null,
    parentElement: null,
    ownerDocument: null,
    style: {},
    dataset: {},
    classList: criarClassList(),
    children: filhos,
    childNodes: filhos,
    _harnessId: ++contadorNos,
    get firstChild() {
      return filhos.length ? filhos[0] : null;
    },
    get lastChild() {
      return filhos.length ? filhos[filhos.length - 1] : null;
    },
    get firstElementChild() {
      return filhos.length ? filhos[0] : null;
    },
    get lastElementChild() {
      return filhos.length ? filhos[filhos.length - 1] : null;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    appendChild(no) {
      if (no) {
        filhos.push(no);
        no.parentNode = el;
        no.parentElement = el;
      }
      return no;
    },
    append(...nos) {
      for (const n of nos) if (n && typeof n === 'object') el.appendChild(n);
    },
    prepend(...nos) {
      for (const n of nos) if (n && typeof n === 'object') filhos.unshift(n);
    },
    insertBefore(no, ref) {
      const i = filhos.indexOf(ref);
      if (i >= 0) filhos.splice(i, 0, no);
      else filhos.push(no);
      if (no) {
        no.parentNode = el;
        no.parentElement = el;
      }
      return no;
    },
    removeChild(no) {
      const i = filhos.indexOf(no);
      if (i >= 0) filhos.splice(i, 1);
      if (no) {
        no.parentNode = null;
        no.parentElement = null;
      }
      return no;
    },
    replaceChild(novo, velho) {
      const i = filhos.indexOf(velho);
      if (i >= 0) filhos[i] = novo;
      return velho;
    },
    replaceChildren(...nos) {
      filhos.length = 0;
      for (const n of nos) if (n && typeof n === 'object') filhos.push(n);
    },
    remove() {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    },
    insertAdjacentHTML() {},
    insertAdjacentElement(pos, no) {
      return no;
    },
    insertAdjacentText() {},
    cloneNode() {
      return criarElemento(tag, '');
    },
    contains() {
      return false;
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
    querySelector() {
      return criarElemento('div', '');
    },
    querySelectorAll() {
      return [];
    },
    getElementsByTagName() {
      return [];
    },
    getElementsByClassName() {
      return [];
    },
    setAttribute(nome, valor) {
      if (nome === 'id') el.id = String(valor);
      if (nome === 'class') el.className = String(valor);
    },
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    removeAttribute() {},
    setAttributeNS() {},
    focus() {},
    blur() {},
    click() {},
    select() {},
    setSelectionRange() {},
    scrollIntoView() {},
    scrollTo() {},
    scrollBy() {},
    animate() {
      return { cancel() {}, finish() {}, play() {}, pause() {} };
    },
    getBoundingClientRect() {
      return {
        x: 0, y: 0, left: 0, top: 0,
        width: el.clientWidth, height: el.clientHeight,
        right: el.clientWidth, bottom: el.clientHeight
      };
    },
    getContext(tipo) {
      if (String(tipo).toLowerCase() !== '2d') return null;
      if (!el._ctx2d) el._ctx2d = criarContexto2D(el);
      return el._ctx2d;
    },
    toDataURL() {
      return '';
    },
    toBlob(cb) {
      if (typeof cb === 'function') cb(null);
    }
  };
  return el;
}

function criarDocumento() {
  const cache = new Map();
  const raiz = criarElemento('html', '');
  const corpo = criarElemento('body', '');
  const cabeca = criarElemento('head', '');
  raiz.appendChild(cabeca);
  raiz.appendChild(corpo);

  const doc = {
    /* 'loading' faz o padrão canônico cair no addEventListener('DOMContentLoaded'),
     * que é no-op aqui — o harness testa a API pura, sem boot(). */
    readyState: 'loading',
    hidden: false,
    visibilityState: 'visible',
    title: 'ISOROGUE',
    documentElement: raiz,
    body: corpo,
    head: cabeca,
    activeElement: corpo,
    nodeType: 9,
    getElementById(id) {
      const chave = String(id);
      if (!cache.has(chave)) {
        const tag = chave === 'cv' ? 'canvas' : chave === 'seed' ? 'input' : 'div';
        cache.set(chave, criarElemento(tag, chave));
      }
      return cache.get(chave);
    },
    querySelector(sel) {
      const s = String(sel || '');
      if (s.charAt(0) === '#') return doc.getElementById(s.slice(1));
      const tag = /canvas/i.test(s) ? 'canvas' : /input/i.test(s) ? 'input' : 'div';
      const chave = 'sel:' + s;
      if (!cache.has(chave)) cache.set(chave, criarElemento(tag, ''));
      return cache.get(chave);
    },
    querySelectorAll() {
      return [];
    },
    getElementsByTagName() {
      return [];
    },
    getElementsByClassName() {
      return [];
    },
    createElement(tag) {
      return criarElemento(tag, '');
    },
    createElementNS(_ns, tag) {
      return criarElemento(tag, '');
    },
    createTextNode(texto) {
      const n = criarElemento('#text', '');
      n.nodeType = 3;
      n.textContent = String(texto == null ? '' : texto);
      return n;
    },
    createDocumentFragment() {
      return criarElemento('#fragment', '');
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    execCommand() {
      return true;
    },
    hasFocus() {
      return true;
    }
  };
  raiz.ownerDocument = doc;
  corpo.ownerDocument = doc;
  cabeca.ownerDocument = doc;
  return doc;
}

const documento = criarDocumento();

const sandbox = {
  console: criarConsole(),
  crypto: webcrypto,
  performance: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} },
  localStorage: criarLocalStorage(),
  sessionStorage: criarLocalStorage(),
  document: documento,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  outerWidth: 1280,
  outerHeight: 720,
  screen: { width: 1280, height: 720, availWidth: 1280, availHeight: 720 },
  navigator: {
    userAgent: 'isorogue-harness/1.0 (node)',
    language: 'pt-BR',
    languages: ['pt-BR'],
    platform: 'linux',
    maxTouchPoints: 0,
    clipboard: {
      writeText() {
        return Promise.resolve();
      },
      readText() {
        return Promise.resolve('');
      }
    }
  },
  location: { href: 'file:///index.html', protocol: 'file:', hash: '', search: '', pathname: '/index.html' },
  requestAnimationFrame() {
    return 0;
  },
  cancelAnimationFrame() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
  matchMedia() {
    return { matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  },
  getComputedStyle() {
    return { getPropertyValue() { return ''; } };
  },
  setTimeout() {
    return 0;
  },
  clearTimeout() {},
  setInterval() {
    return 0;
  },
  clearInterval() {},
  queueMicrotask(fn) {
    if (typeof fn === 'function') queueMicrotask(fn);
  },
  alert() {},
  confirm() {
    return false;
  },
  prompt() {
    return null;
  },
  btoa(s) {
    return Buffer.from(String(s), 'binary').toString('base64');
  },
  atob(s) {
    return Buffer.from(String(s), 'base64').toString('binary');
  },
  Buffer: undefined,
  process: undefined
};

const contexto = vm.createContext(sandbox, { name: 'isorogue' });
/* window auto-referente e igual ao global do contexto. */
vm.runInContext(
  'globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis; globalThis.frames = globalThis;',
  contexto,
  { filename: 'harness-bootstrap.js' }
);

/* ------------------------------------------------------------------ */
/* 3. executar o script do jogo                                        */
/* ------------------------------------------------------------------ */

const t0Carga = process.hrtime.bigint();
try {
  const script = new vm.Script(codigo, { filename: 'index.html', lineOffset: LINHA_BASE - 1 });
  script.runInContext(contexto, { displayErrors: true });
} catch (err) {
  const onde = localizar(err && err.stack);
  abortar('o script de index.html lançou durante a carga: ' + (err && err.message), [
    onde ? 'Origem: ' + onde : 'Origem: não identificada',
    'Trecho da pilha:',
    ...String((err && err.stack) || '').split('\n').slice(0, 6).map((l) => '  ' + l.trim())
  ]);
}
const msCarga = Number(process.hrtime.bigint() - t0Carga) / 1e6;

const R = sandbox.R;
if (!R || typeof R !== 'object') {
  abortar('o script carregou mas não expôs window.R.', [
    'Cada módulo deve ser uma IIFE no formato (function (R) { ... })(window.R = window.R || {});'
  ]);
}

const problemasDeCarga = registro.problemas.filter((p) => p.fase === 'carga');

/* ------------------------------------------------------------------ */
/* 4. acesso ao contrato                                               */
/* ------------------------------------------------------------------ */

class ApiAusente extends Error {}

function api(caminho) {
  const partes = caminho.split('.');
  let atual = R;
  let percorrido = 'R';
  for (const p of partes) {
    if (atual == null || typeof atual[p] === 'undefined') {
      throw new ApiAusente('API ausente: R.' + caminho + ' (parou em ' + percorrido +
        ' — o módulo responsável não expôs "' + p + '")');
    }
    atual = atual[p];
    percorrido += '.' + p;
  }
  return atual;
}

function fn(caminho) {
  const v = api(caminho);
  if (typeof v !== 'function') {
    throw new ApiAusente('R.' + caminho + ' existe mas não é função (é ' + typeof v + ')');
  }
  return v;
}

function constantes() {
  const C = api('C');
  for (const chave of ['MAP_W', 'MAP_H', 'TILE', 'FOV_RADIUS', 'SAFE_RADIUS']) {
    if (typeof C[chave] === 'undefined') {
      throw new ApiAusente('R.C.' + chave + ' ausente (contrato §2)');
    }
  }
  return C;
}

function conjuntoCaminhavel() {
  const T = constantes().TILE;
  return new Set([T.FLOOR, T.DOOR, T.STAIRS]);
}

function ehCaminhavel(map, x, y, WALK) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  return WALK.has(map.tiles[y * map.w + x]);
}

function listaCaminhaveis(map, WALK) {
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (WALK.has(map.tiles[y * map.w + x])) out.push({ x: x, y: y });
    }
  }
  return out;
}

/* BFS independente (4-vizinhança) para conferir map.connectivity sem confiar
 * no cálculo do próprio módulo. */
function alcancaveis(map, WALK) {
  const w = map.w;
  const h = map.h;
  const vistos = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let ini = 0;
  let fim = 0;
  const s = map.start;
  if (!s || !WALK.has(map.tiles[s.y * w + s.x])) {
    return { total: 0, vistos: vistos, inicioInvalido: true };
  }
  vistos[s.y * w + s.x] = 1;
  fila[fim++] = s.y * w + s.x;
  let total = 1;
  const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w;
    const y = (i - x) / w;
    for (const d of D4) {
      const nx = x + d[0];
      const ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (vistos[ni]) continue;
      if (!WALK.has(map.tiles[ni])) continue;
      vistos[ni] = 1;
      total++;
      fila[fim++] = ni;
    }
  }
  return { total: total, vistos: vistos, inicioInvalido: false };
}

function contarCaminhaveis(map, WALK) {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (WALK.has(map.tiles[i])) n++;
  return n;
}

function compararTipados(a, b, w, rotulo) {
  if (!a || !b) return rotulo + ': um dos arrays está ausente';
  if (a.length !== b.length) return rotulo + ': tamanhos diferentes (' + a.length + ' vs ' + b.length + ')';
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const x = i % w;
      const y = (i - x) / w;
      return rotulo + ': divergem no índice ' + i + ' = (' + x + ',' + y + ') — ' +
        a[i] + ' vs ' + b[i];
    }
  }
  return null;
}

function primeiraDivergencia(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function sequenciaComandos(tag, n) {
  const rng = rngLocal(fnv1a('isorogue-harness#' + tag));
  const pool = [];
  for (const d of DIRS8) {
    for (let k = 0; k < 6; k++) pool.push('move:' + d[0] + ',' + d[1]);
  }
  for (let k = 0; k < 3; k++) pool.push('wait');
  for (let k = 0; k < 2; k++) pool.push('use');
  pool.push('descend');
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[rng.int(0, pool.length - 1)]);
  return out;
}

function vivos(game) {
  const lista = [];
  const es = game.enemies || [];
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e && typeof e.hp === 'number' && e.hp > 0) lista.push(e);
  }
  return lista;
}

/* ------------------------------------------------------------------ */
/* 5. coletor de resultados                                            */
/* ------------------------------------------------------------------ */

const MAX_FALHAS_GUARDADAS = 12;

class Coletor {
  constructor(id) {
    this.id = id;
    this.checagens = 0;
    this.falhas = [];
    this.falhasTotais = 0;
    this.notas = [];
  }
  checar(cond, titulo, campos) {
    this.checagens++;
    if (cond) return true;
    this.falhasTotais++;
    if (this.falhas.length < MAX_FALHAS_GUARDADAS) {
      this.falhas.push({
        titulo: titulo,
        campos: typeof campos === 'function' ? campos() : campos || []
      });
    }
    return false;
  }
  falhar(titulo, campos) {
    return this.checar(false, titulo, campos);
  }
  nota(texto) {
    this.notas.push(texto);
  }
  get ok() {
    return this.falhasTotais === 0;
  }
}

/* ------------------------------------------------------------------ */
/* 6. testes                                                           */
/* ------------------------------------------------------------------ */

const N = {
  t1Sementes: RAPIDO ? 10 : 60,
  t2Sementes: RAPIDO ? 4 : 12,
  t3Sementes: RAPIDO ? 4 : 12,
  t4Sementes: RAPIDO ? 6 : 40,
  t4Origens: RAPIDO ? 6 : 25,
  t5Sementes: RAPIDO ? 4 : 12,
  t5Origens: RAPIDO ? 8 : 40,
  t6Comandos: RAPIDO ? 120 : 400,
  t7Turnos: RAPIDO ? 100 : 300,
  t8Sementes: RAPIDO ? 3 : 8,
  t10Niveis: 5
};

const TESTES = [];

/* ---------------- T0 (extra, além do §11) ---------------- */
TESTES.push({
  id: 'T0',
  nome: 'Boot, render e UI sob DOM/canvas simulados (extra, além do §11)',
  run(c) {
    const tentar = (rotulo, acao) => {
      c.checagens++;
      try {
        acao();
        return true;
      } catch (err) {
        c.falhasTotais++;
        if (c.falhas.length < MAX_FALHAS_GUARDADAS) {
          c.falhas.push({
            titulo: rotulo + ' lançou exceção com o DOM simulado',
            campos: [
              ['erro', String(err && err.message)],
              ['origem', localizar(err && err.stack) || '(não identificada)'],
              ['pilha', String((err && err.stack) || '').split('\n').slice(1, 4)
                .filter((l) => l.indexOf('index.html') !== -1).join('\n') || '(sem quadro do jogo)'],
              ['observação', 'o stub de canvas 2D cobre os métodos do contrato §8; ' +
                'se faltar algum, avise o agente tooling']
            ]
          });
        }
        return false;
      }
    };

    if (typeof R.Game === 'object' && typeof R.Game.boot === 'function') {
      tentar('R.Game.boot()', () => R.Game.boot());
    } else {
      c.nota('R.Game.boot ausente — etapa de boot pulada.');
    }

    const game = fn('Game.createState')('T0-BOOT', 1);
    const canvas = documento.getElementById('cv');

    if (R.Render && typeof R.Render.init === 'function') {
      tentar('R.Render.init(canvas)', () => R.Render.init(canvas));
      if (typeof R.Render.resize === 'function') tentar('R.Render.resize()', () => R.Render.resize());
      if (typeof R.Render.setZoom === 'function') {
        tentar('R.Render.setZoom(1.5)', () => R.Render.setZoom(1.5));
      }
      if (typeof R.Render.update === 'function') {
        tentar('R.Render.update(game, dt)', () => R.Render.update(game, 0.016));
      }
      if (typeof R.Render.draw === 'function') {
        tentar('R.Render.draw(game)', () => R.Render.draw(game));
        game.ui.debug = true;
        game.ui.fovProbe = true;
        game.ui.hover = { x: game.player.x + 1, y: game.player.y + 1 };
        tentar('R.Render.draw(game) com debug e sonda de FOV ligados', () => R.Render.draw(game));
        game.ui.debug = false;
        game.ui.fovProbe = false;
      }
      /* screenToTile deve ser a inversa exata de tileToScreen (§8). */
      if (typeof R.Render.screenToTile === 'function' && typeof R.Render.tileToScreen === 'function') {
        const alvos = [
          { x: game.player.x, y: game.player.y },
          { x: 1, y: 1 },
          { x: game.map.w - 2, y: 1 },
          { x: 1, y: game.map.h - 2 },
          { x: game.map.w - 2, y: game.map.h - 2 }
        ];
        for (const t of alvos) {
          let s = null;
          let v = null;
          const okIda = tentar('R.Render.tileToScreen', () => {
            s = R.Render.tileToScreen(game, t.x, t.y);
          });
          if (!okIda || !s) continue;
          const okVolta = tentar('R.Render.screenToTile', () => {
            v = R.Render.screenToTile(game, s.sx, s.sy);
          });
          if (!okVolta || !v) continue;
          c.checar(v.x === t.x && v.y === t.y,
            'screenToTile não é a inversa exata de tileToScreen', () => [
              ['tile original', '(' + t.x + ',' + t.y + ')'],
              ['tela', '(' + s.sx + ',' + s.sy + ')'],
              ['tile de volta', '(' + v.x + ',' + v.y + ')'],
              ['câmera', R.Render.cam ? inspect(R.Render.cam, { depth: 1 }) : '(ausente)']
            ]);
        }
      }
    } else {
      c.nota('R.Render.init ausente — etapa de render pulada.');
    }

    if (R.UI && typeof R.UI.init === 'function') {
      const handlers = {
        onGerar() {}, onAleatoria() {}, onCopiar() {}, onNova() {}
      };
      tentar('R.UI.init(game, handlers)', () => R.UI.init(game, handlers));
      const chamar = (nome, args) => {
        if (typeof R.UI[nome] === 'function') {
          tentar('R.UI.' + nome + '()', () => R.UI[nome].apply(R.UI, args));
        }
      };
      chamar('refresh', [game]);
      chamar('rebuildLog', [game]);
      chamar('pushLog', [game, { turn: game.turn, text: 'Mensagem de teste do harness.', cls: 'info' }]);
      chamar('setDebug', [game]);
      chamar('showTooltip', ['<b>teste</b>', 20, 20]);
      chamar('hideTooltip', []);
      chamar('showDeath', [game]);
      chamar('hideDeath', []);
    } else {
      c.nota('R.UI.init ausente — etapa de interface pulada.');
    }

    if (R.Save && typeof R.Save.write === 'function') {
      tentar('R.Save.write(game)', () => R.Save.write(game));
      if (typeof R.Save.read === 'function') tentar('R.Save.read()', () => R.Save.read());
      if (typeof R.Save.pushHistory === 'function') {
        tentar('R.Save.pushHistory(game)', () => R.Save.pushHistory(game));
      }
      if (typeof R.Save.readHistory === 'function') {
        tentar('R.Save.readHistory()', () => R.Save.readHistory());
      }
      if (typeof R.Save.clear === 'function') tentar('R.Save.clear()', () => R.Save.clear());
    }
  }
});

/* ---------------- T1 ---------------- */
TESTES.push({
  id: 'T1',
  nome: 'Conectividade — ' + N.t1Sementes + ' sementes × profundidades 1..3',
  run(c) {
    const gerar = fn('MapGen.generate');
    const WALK = conjuntoCaminhavel();
    for (let i = 0; i < N.t1Sementes; i++) {
      const semente = 'T1-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const map = gerar(semente, depth);
        if (!c.checar(map && map.tiles && map.tiles.length === map.w * map.h,
          'mapa inválido (tiles com tamanho errado)',
          () => [['semente', semente], ['profundidade', depth],
            ['tiles.length', map && map.tiles ? map.tiles.length : '(ausente)'],
            ['esperado', map ? map.w * map.h : '?']])) continue;

        const total = contarCaminhaveis(map, WALK);
        const r = alcancaveis(map, WALK);
        if (r.inicioInvalido) {
          c.falhar('map.start não está em tile caminhável', () => [
            ['semente', semente], ['profundidade', depth],
            ['start', '(' + map.start.x + ',' + map.start.y + ')'],
            ['tile', map.tiles[map.start.y * map.w + map.start.x]],
            ['repro', 'R.MapGen.generate(\'' + semente + '\', ' + depth + ')']
          ]);
          continue;
        }
        c.checar(r.total === total, 'há tiles caminháveis inalcançáveis a partir de start', () => {
          const exemplos = [];
          for (let k = 0; k < map.tiles.length && exemplos.length < 5; k++) {
            if (WALK.has(map.tiles[k]) && !r.vistos[k]) {
              exemplos.push('(' + (k % map.w) + ',' + ((k - (k % map.w)) / map.w) + ')');
            }
          }
          return [
            ['semente', semente], ['profundidade', depth],
            ['caminháveis', total], ['alcançáveis', r.total],
            ['inalcançáveis', total - r.total],
            ['exemplos', exemplos.join(' ')],
            ['start', '(' + map.start.x + ',' + map.start.y + ')'],
            ['regenerações', map.regenerations], ['reparos', map.repairs],
            ['repro', 'R.MapGen.generate(\'' + semente + '\', ' + depth + ')']
          ];
        });
        c.checar(map.connectivity === 1, 'map.connectivity !== 1', () => [
          ['semente', semente], ['profundidade', depth],
          ['connectivity', map.connectivity],
          ['medido pelo harness', (r.total / Math.max(1, total)).toFixed(6)],
          ['repro', 'R.MapGen.generate(\'' + semente + '\', ' + depth + ')']
        ]);
        c.checar(Math.abs(map.connectivity - r.total / Math.max(1, total)) < 1e-9,
          'map.connectivity não bate com a BFS independente do harness', () => [
            ['semente', semente], ['profundidade', depth],
            ['reportado', map.connectivity],
            ['medido', r.total / Math.max(1, total)]
          ]);
        const st = map.stairs;
        c.checar(!!st && ehCaminhavel(map, st.x, st.y, WALK),
          'map.stairs não está em tile caminhável', () => [
            ['semente', semente], ['profundidade', depth],
            ['stairs', st ? '(' + st.x + ',' + st.y + ')' : '(ausente)']
          ]);
      }
    }
  }
});

/* ---------------- T2 ---------------- */
TESTES.push({
  id: 'T2',
  nome: 'Determinismo de mapa — mesma semente gera o mesmo mapa',
  run(c) {
    const gerar = fn('MapGen.generate');
    for (let i = 0; i < N.t2Sementes; i++) {
      const semente = 'T2-' + pad(i, 4);
      for (let depth = 1; depth <= 2; depth++) {
        const a = gerar(semente, depth);
        const b = gerar(semente, depth);
        const campos = () => [
          ['semente', semente], ['profundidade', depth],
          ['repro', 'R.MapGen.generate(\'' + semente + '\', ' + depth + ') duas vezes']
        ];
        const dTiles = compararTipados(a.tiles, b.tiles, a.w, 'tiles');
        c.checar(dTiles === null, 'tiles divergem entre duas gerações',
          () => campos().concat([['detalhe', dTiles]]));
        const dDecor = compararTipados(a.decor, b.decor, a.w, 'decor');
        c.checar(dDecor === null, 'decor diverge entre duas gerações',
          () => campos().concat([['detalhe', dDecor]]));
        const ra = JSON.stringify(a.rooms);
        const rb = JSON.stringify(b.rooms);
        c.checar(ra === rb, 'rooms divergem entre duas gerações', () => campos().concat([
          ['A', recorta(ra, 220)], ['B', recorta(rb, 220)]
        ]));
        c.checar(a.start.x === b.start.x && a.start.y === b.start.y,
          'start diverge', () => campos().concat([
            ['A', '(' + a.start.x + ',' + a.start.y + ')'],
            ['B', '(' + b.start.x + ',' + b.start.y + ')']
          ]));
        c.checar(a.stairs.x === b.stairs.x && a.stairs.y === b.stairs.y,
          'stairs diverge', () => campos().concat([
            ['A', '(' + a.stairs.x + ',' + a.stairs.y + ')'],
            ['B', '(' + b.stairs.x + ',' + b.stairs.y + ')']
          ]));
        c.checar(a.seed === b.seed, 'map.seed diverge',
          () => campos().concat([['A', a.seed], ['B', b.seed]]));
      }
    }
  }
});

/* ---------------- T3 ---------------- */
TESTES.push({
  id: 'T3',
  nome: 'Determinismo e regras de população (inimigos e itens)',
  run(c) {
    const gerar = fn('MapGen.generate');
    const popular = fn('Ent.populate');
    const C = constantes();
    const WALK = conjuntoCaminhavel();

    const chaveInimigo = (e) => [e.kind, e.x, e.y, e.hp, e.maxHp, e.atk, e.range].join('|');
    const chaveItem = (it) => [it.kind, it.x, it.y, it.heal].join('|');

    for (let i = 0; i < N.t3Sementes; i++) {
      const semente = 'T3-' + pad(i, 4);
      for (let depth = 1; depth <= 3; depth++) {
        const mapa = gerar(semente, depth);
        const mapb = gerar(semente, depth);
        const pa = popular(mapa, depth);
        const pb = popular(mapb, depth);
        const campos = () => [
          ['semente', semente], ['profundidade', depth],
          ['repro', 'R.Ent.populate(R.MapGen.generate(\'' + semente + '\', ' + depth + '), ' + depth + ')']
        ];

        const ea = pa.enemies.map(chaveInimigo).join('\n');
        const eb = pb.enemies.map(chaveInimigo).join('\n');
        c.checar(ea === eb, 'inimigos divergem entre duas populações da mesma semente', () => {
          const la = pa.enemies.map(chaveInimigo);
          const lb = pb.enemies.map(chaveInimigo);
          const k = primeiraDivergencia(la, lb);
          return campos().concat([
            ['quantidade', la.length + ' vs ' + lb.length],
            ['1º divergente (índice ' + k + ')', (la[k] || '(nada)') + '  vs  ' + (lb[k] || '(nada)')]
          ]);
        });

        const ia = pa.items.map(chaveItem).join('\n');
        const ib = pb.items.map(chaveItem).join('\n');
        c.checar(ia === ib, 'itens divergem entre duas populações da mesma semente', () => {
          const la = pa.items.map(chaveItem);
          const lb = pb.items.map(chaveItem);
          const k = primeiraDivergencia(la, lb);
          return campos().concat([
            ['quantidade', la.length + ' vs ' + lb.length],
            ['1º divergente (índice ' + k + ')', (la[k] || '(nada)') + '  vs  ' + (lb[k] || '(nada)')]
          ]);
        });

        /* regras de posicionamento (R22..R25) */
        const alvoInimigos = Math.min(22, 4 + depth * 2);
        const alvoItens = Math.max(1, 3 + ((depth * 7) % 3) - Math.floor(depth / 4));
        c.checar(pa.enemies.length <= alvoInimigos, 'inimigos acima da cota do contrato',
          () => campos().concat([['obtido', pa.enemies.length], ['máximo', alvoInimigos]]));
        c.checar(pa.items.length <= alvoItens, 'itens acima da cota do contrato',
          () => campos().concat([['obtido', pa.items.length], ['máximo', alvoItens]]));
        if (pa.enemies.length < alvoInimigos) {
          c.nota('semente ' + semente + ' nível ' + depth + ': ' + pa.enemies.length +
            '/' + alvoInimigos + ' inimigos (cotas sem posição livre — permitido pelo contrato).');
        }

        const ocupados = new Set();
        const registrar = (o, tipo) => {
          const chave = o.x + ',' + o.y;
          c.checar(!ocupados.has(chave), 'duas entidades no mesmo tile',
            () => campos().concat([['tipo', tipo], ['tile', '(' + o.x + ',' + o.y + ')']]));
          ocupados.add(chave);
          c.checar(ehCaminhavel(mapa, o.x, o.y, WALK), tipo + ' fora de tile caminhável',
            () => campos().concat([['tile', '(' + o.x + ',' + o.y + ')'],
              ['valor do tile', mapa.tiles[o.y * mapa.w + o.x]]]));
          c.checar(!(o.x === mapa.start.x && o.y === mapa.start.y), tipo + ' sobre o start',
            () => campos().concat([['tile', '(' + o.x + ',' + o.y + ')']]));
          c.checar(!(o.x === mapa.stairs.x && o.y === mapa.stairs.y), tipo + ' sobre a escada',
            () => campos().concat([['tile', '(' + o.x + ',' + o.y + ')']]));
        };
        for (const e of pa.enemies) {
          registrar(e, 'inimigo');
          const d = Math.max(Math.abs(e.x - mapa.start.x), Math.abs(e.y - mapa.start.y));
          /* "dentro de SAFE_RADIUS" é lido como d < SAFE_RADIUS proibido. */
          c.checar(d >= C.SAFE_RADIUS,
            'inimigo dentro do raio seguro inicial',
            () => campos().concat([
              ['tile', '(' + e.x + ',' + e.y + ')'],
              ['start', '(' + mapa.start.x + ',' + mapa.start.y + ')'],
              ['distância Chebyshev', d], ['SAFE_RADIUS', C.SAFE_RADIUS]
            ]));
        }
        for (const it of pa.items) registrar(it, 'item');
      }
    }
  }
});

/* ---------------- T4 ---------------- */
TESTES.push({
  id: 'T4',
  nome: 'Simetria de FOV — ' + N.t4Sementes + ' sementes × ' + N.t4Origens + ' origens',
  run(c) {
    const gerar = fn('MapGen.generate');
    const checkSymmetry = fn('FOV.checkSymmetry');
    const C = constantes();
    const WALK = conjuntoCaminhavel();
    const raio = C.FOV_RADIUS;

    for (let i = 0; i < N.t4Sementes; i++) {
      const semente = 'T4-' + pad(i, 4);
      const map = gerar(semente, 1 + (i % 3));
      const livres = listaCaminhaveis(map, WALK);
      const rng = rngLocal(fnv1a('T4#' + semente));
      for (let k = 0; k < N.t4Origens; k++) {
        const o = livres[rng.int(0, livres.length - 1)];
        const res = checkSymmetry(map, o.x, o.y, raio);
        if (!c.checar(res && typeof res.tested === 'number' && Array.isArray(res.broken),
          'checkSymmetry devolveu formato inesperado', () => [
            ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
            ['recebido', recorta(inspect(res, { depth: 1 }), 200)],
            ['esperado', '{ tested: Number, broken: Array, ok: Boolean }']
          ])) continue;
        c.checar(res.broken.length === 0, 'FOV assimétrico', () => {
          const amostra = res.broken.slice(0, 6)
            .map((b) => '(' + b.x + ',' + b.y + ')').join(' ');
          return [
            ['semente', semente], ['profundidade', 1 + (i % 3)],
            ['origem', '(' + o.x + ',' + o.y + ')'], ['raio', raio],
            ['pares testados', res.tested], ['quebrados', res.broken.length],
            ['tiles inconsistentes', amostra],
            ['repro', 'R.FOV.checkSymmetry(R.MapGen.generate(\'' + semente + '\', ' +
              (1 + (i % 3)) + '), ' + o.x + ', ' + o.y + ', ' + raio + ')']
          ];
        });
        c.checar(res.tested > 0, 'checkSymmetry não testou nenhum par', () => [
          ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')']
        ]);
        c.checar(res.ok === (res.broken.length === 0),
          'campo ok inconsistente com broken', () => [
            ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
            ['ok', String(res.ok)], ['broken.length', res.broken.length]
          ]);
      }
    }
  }
});

/* ---------------- T5 ---------------- */
TESTES.push({
  id: 'T5',
  nome: 'FOV não vaza — nada além do raio, origem sempre visível',
  run(c) {
    const gerar = fn('MapGen.generate');
    const compute = fn('FOV.compute');
    const isVisibleFrom = fn('FOV.isVisibleFrom');
    const C = constantes();
    const WALK = conjuntoCaminhavel();
    const raio = C.FOV_RADIUS;
    const limite = raio + 0.5 + 1e-9;

    for (let i = 0; i < N.t5Sementes; i++) {
      const semente = 'T5-' + pad(i, 4);
      const map = gerar(semente, 1 + (i % 3));
      const livres = listaCaminhaveis(map, WALK);
      const rng = rngLocal(fnv1a('T5#' + semente));
      for (let k = 0; k < N.t5Origens; k++) {
        const o = livres[rng.int(0, livres.length - 1)];
        const set = compute(map, o.x, o.y, raio);
        if (!c.checar(set && typeof set.has === 'function' && typeof set.size === 'number',
          'FOV.compute não devolveu um Set', () => [
            ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
            ['recebido', recorta(inspect(set, { depth: 1 }), 160)]
          ])) continue;

        const iOrigem = o.y * map.w + o.x;
        c.checar(set.has(iOrigem), 'a origem não está no conjunto visível', () => [
          ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
          ['índice', iOrigem], ['tamanho do Set', set.size],
          ['repro', 'R.FOV.compute(R.MapGen.generate(\'' + semente + '\', ' +
            (1 + (i % 3)) + '), ' + o.x + ', ' + o.y + ', ' + raio + ')']
        ]);

        let vazou = null;
        let foraDoMapa = null;
        const idx = Array.from(set);
        for (const v of idx) {
          if (typeof v !== 'number' || v < 0 || v >= map.w * map.h) {
            if (foraDoMapa === null) foraDoMapa = v;
            continue;
          }
          const x = v % map.w;
          const y = (v - x) / map.w;
          const d = Math.sqrt((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y));
          if (d > limite && vazou === null) vazou = { x: x, y: y, d: d };
        }
        c.checar(foraDoMapa === null, 'índice fora dos limites do mapa no conjunto visível',
          () => [['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
            ['índice', String(foraDoMapa)], ['w*h', map.w * map.h]]);
        c.checar(vazou === null, 'tile visível além do raio', () => [
          ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
          ['tile', vazou ? '(' + vazou.x + ',' + vazou.y + ')' : '?'],
          ['distância euclidiana', vazou ? vazou.d.toFixed(4) : '?'],
          ['limite', (raio + 0.5).toFixed(2)],
          ['repro', 'R.FOV.compute(R.MapGen.generate(\'' + semente + '\', ' +
            (1 + (i % 3)) + '), ' + o.x + ', ' + o.y + ', ' + raio + ')']
        ]);

        /* isVisibleFrom deve concordar com compute */
        const rng2 = rngLocal(fnv1a('T5v#' + semente + '#' + k));
        for (let t = 0; t < 6; t++) {
          const alvo = livres[rng2.int(0, livres.length - 1)];
          const esperado = set.has(alvo.y * map.w + alvo.x);
          const obtido = !!isVisibleFrom(map, o.x, o.y, alvo.x, alvo.y, raio);
          c.checar(esperado === obtido,
            'isVisibleFrom discorda de compute', () => [
              ['semente', semente], ['origem', '(' + o.x + ',' + o.y + ')'],
              ['alvo', '(' + alvo.x + ',' + alvo.y + ')'],
              ['compute', String(esperado)], ['isVisibleFrom', String(obtido)]
            ]);
        }
      }
    }
  }
});

/* ---------------- T6 ---------------- */
TESTES.push({
  id: 'T6',
  nome: 'Determinismo de partida — ' + N.t6Comandos + ' comandos, snapshot a cada turno',
  run(c) {
    const createState = fn('Game.createState');
    const applyCommand = fn('Game.applyCommand');
    const snapshot = fn('Game.snapshot');
    const semente = 'T6-DETERMINISMO';
    const cmds = sequenciaComandos('T6', N.t6Comandos);

    const a = createState(semente, 1);
    const b = createState(semente, 1);

    /* Intervenção IDÊNTICA nas duas partidas: jogador com vida folgada e
     * reposta a cada comando. Sem isso o jogador morre nos primeiros turnos e
     * os 400 comandos viram 400 recusas — que não provariam determinismo de
     * nada. Como o estado das duas partidas é idêntico, a intervenção é
     * determinística e não mascara divergência (o snapshot é comparado depois
     * de cada comando, antes da próxima reposição). */
    for (const g of [a, b]) {
      g.player.maxHp = 999;
      g.player.hp = 999;
    }

    let sa = String(snapshot(a));
    let sb = String(snapshot(b));
    if (!c.checar(sa === sb, 'snapshots iniciais já divergem', () => [
      ['semente', semente],
      ['A', recorta(sa, 300)], ['B', recorta(sb, 300)],
      ['repro', 'R.Game.snapshot(R.Game.createState(\'' + semente + '\', 1))']
    ])) return;
    c.checar(sa.length > 0, 'snapshot vazio', () => [['semente', semente]]);

    const reanimar = (g) => {
      if (!g.over) g.player.hp = g.player.maxHp;
    };

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      reanimar(a);
      reanimar(b);
      const ra = applyCommand(a, cmd);
      const rb = applyCommand(b, cmd);
      if (!c.checar(ra === rb, 'applyCommand devolveu valores diferentes nas duas partidas',
        () => [['semente', semente], ['comando #' + i, cmd],
          ['A', String(ra)], ['B', String(rb)]])) return;
      sa = String(snapshot(a));
      sb = String(snapshot(b));
      if (!c.checar(sa === sb, 'snapshots divergem após comando', () => {
        const k = (function () {
          const n = Math.min(sa.length, sb.length);
          for (let j = 0; j < n; j++) if (sa[j] !== sb[j]) return j;
          return n;
        })();
        return [
          ['semente', semente],
          ['comando #' + i, cmd],
          ['turno A', a.turn], ['turno B', b.turn],
          ['jogador A', '(' + a.player.x + ',' + a.player.y + ') hp=' + a.player.hp],
          ['jogador B', '(' + b.player.x + ',' + b.player.y + ') hp=' + b.player.hp],
          ['1ª diferença no caractere', k],
          ['A', recorta(sa.slice(Math.max(0, k - 60)), 200)],
          ['B', recorta(sb.slice(Math.max(0, k - 60)), 200)],
          ['sequência', 'harness RNG "isorogue-harness#T6" — comandos 0..' + i]
        ];
      })) return;
    }
    c.nota('vida do jogador elevada a 999 e reposta a cada comando, igual nas duas ' +
      'partidas — os comandos precisam ser executados de verdade, não recusados por morte.');
    c.nota('partida A terminou em: nível ' + a.depth + ', turno ' + a.turn +
      ', hp ' + a.player.hp + (a.over ? ' (jogador morto)' : ''));
  }
});

/* ---------------- T7 ---------------- */
TESTES.push({
  id: 'T7',
  nome: 'Invariantes de turno — ' + N.t7Turnos + ' comandos',
  run(c) {
    const createState = fn('Game.createState');
    const applyCommand = fn('Game.applyCommand');
    const WALK = conjuntoCaminhavel();
    const semente = 'T7-INVARIANTES';
    const cmds = sequenciaComandos('T7', N.t7Turnos);
    const game = createState(semente, 1);
    c.nota('vida do jogador elevada a 999 e reposta nos primeiros 75% dos comandos ' +
      '(intervenção do harness) para que as invariantes sejam checadas em turnos reais.');

    /* Vida folgada e reposta nos primeiros 75% dos comandos, para que os 300
     * turnos sejam de fato jogados e as invariantes espaciais sejam checadas
     * turno a turno; no último quarto o jogador é deixado à própria sorte, de
     * modo que a morte natural e o bloqueio de comandos pós-morte também sejam
     * exercitados (e, se ele sobreviver, a morte forçada no fim cobre isso). */
    game.player.maxHp = 999;
    game.player.hp = 999;
    const corteReanimacao = Math.floor(cmds.length * 0.75);

    let jaMorreu = false;
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      if (i < corteReanimacao && !game.over) game.player.hp = game.player.maxHp;
      const turnoAntes = game.turn;
      const nivelAntes = game.depth;
      const estavaMorto = !!game.over;
      const aceito = applyCommand(game, cmd);

      if (estavaMorto) {
        c.checar(aceito === false, 'comando aceito depois de over === true', () => [
          ['semente', semente], ['comando #' + i, cmd],
          ['turno', game.turn], ['causa', String(game.cause)]
        ]);
        c.checar(game.turn === turnoAntes, 'turno avançou depois da morte', () => [
          ['semente', semente], ['comando #' + i, cmd],
          ['antes', turnoAntes], ['depois', game.turn]
        ]);
        continue;
      }

      if (aceito === true) {
        if (game.depth === nivelAntes) {
          c.checar(game.turn === turnoAntes + 1,
            'turno não incrementou exatamente 1 num comando aceito', () => [
              ['semente', semente], ['comando #' + i, cmd],
              ['turno antes', turnoAntes], ['turno depois', game.turn],
              ['nível', game.depth]
            ]);
        } else {
          c.nota('comando "' + cmd + '" mudou o nível (' + nivelAntes + ' -> ' +
            game.depth + '); checagem de turno pulada nesse comando.');
        }
      } else {
        c.checar(game.turn === turnoAntes,
          'turno avançou num comando recusado', () => [
            ['semente', semente], ['comando #' + i, cmd],
            ['turno antes', turnoAntes], ['turno depois', game.turn]
          ]);
      }

      /* invariantes espaciais */
      const map = game.map;
      const p = game.player;
      c.checar(ehCaminhavel(map, p.x, p.y, WALK), 'jogador em tile não caminhável', () => [
        ['semente', semente], ['comando #' + i, cmd],
        ['jogador', '(' + p.x + ',' + p.y + ')'],
        ['tile', map.tiles[p.y * map.w + p.x]], ['turno', game.turn]
      ]);

      const ocupados = new Map();
      for (const e of vivos(game)) {
        c.checar(ehCaminhavel(map, e.x, e.y, WALK), 'inimigo em tile não caminhável', () => [
          ['semente', semente], ['comando #' + i, cmd],
          ['inimigo id', e.id], ['tipo', e.kind],
          ['tile', '(' + e.x + ',' + e.y + ')'],
          ['valor do tile', map.tiles[e.y * map.w + e.x]], ['turno', game.turn]
        ]);
        const chave = e.x + ',' + e.y;
        const outro = ocupados.get(chave);
        c.checar(outro === undefined, 'dois inimigos no mesmo tile', () => [
          ['semente', semente], ['comando #' + i, cmd],
          ['tile', '(' + e.x + ',' + e.y + ')'],
          ['ids', (outro === undefined ? '?' : outro.id) + ' e ' + e.id],
          ['turno', game.turn]
        ]);
        ocupados.set(chave, e);
        c.checar(!(e.x === p.x && e.y === p.y), 'inimigo no mesmo tile do jogador', () => [
          ['semente', semente], ['comando #' + i, cmd],
          ['inimigo id', e.id], ['tile', '(' + e.x + ',' + e.y + ')'], ['turno', game.turn]
        ]);
      }

      if (game.over && !jaMorreu) {
        jaMorreu = true;
        c.nota('jogador morreu no comando #' + i + ' (turno ' + game.turn + '): ' +
          String(game.cause));
      }
    }

    /* morte forçada: nenhum comando pode ser aceito depois de over */
    if (!game.over) {
      game.over = true;
      game.player.hp = 0;
      const turno = game.turn;
      for (const cmd of ['wait', 'move:1,0', 'use', 'descend']) {
        const aceito = applyCommand(game, cmd);
        c.checar(aceito === false, 'comando aceito com over === true (morte forçada)', () => [
          ['semente', semente], ['comando', cmd], ['retorno', String(aceito)]
        ]);
        c.checar(game.turn === turno, 'turno avançou com over === true (morte forçada)', () => [
          ['semente', semente], ['comando', cmd],
          ['antes', turno], ['depois', game.turn]
        ]);
      }
      c.nota('morte forçada pelo harness ao fim do teste para validar o bloqueio de comandos.');
    }
  }
});

/* ---------------- T8 ---------------- */
TESTES.push({
  id: 'T8',
  nome: 'Dijkstra — origem 0, alcance total, degrau máximo 1, descida até o jogador',
  run(c) {
    const createState = fn('Game.createState');
    const compute = fn('Dijkstra.compute');
    const bestStep = fn('Dijkstra.bestStep');
    const flee = fn('Dijkstra.flee');
    const INF = api('Dijkstra.INF');
    const WALK = conjuntoCaminhavel();

    for (let i = 0; i < N.t8Sementes; i++) {
      const semente = 'T8-' + pad(i, 4);
      const game = createState(semente, 1 + (i % 3));
      const map = game.map;
      const p = game.player;
      const w = map.w;
      const h = map.h;
      const dmap = compute(map, [{ x: p.x, y: p.y, v: 0 }], { blocked: null });
      const campos = () => [
        ['semente', semente], ['profundidade', game.depth],
        ['jogador', '(' + p.x + ',' + p.y + ')'],
        ['repro', 'R.Dijkstra.compute(game.map, [{x:' + p.x + ',y:' + p.y + ',v:0}], {blocked:null})']
      ];

      if (!c.checar(dmap && dmap.length === w * h, 'dmap com tamanho errado',
        () => campos().concat([['length', dmap ? dmap.length : '(ausente)'],
          ['esperado', w * h]]))) continue;

      c.checar(dmap[p.y * w + p.x] === 0, 'valor no tile do jogador não é 0',
        () => campos().concat([['valor', dmap[p.y * w + p.x]]]));

      if (game.dmap && game.dmap.length === w * h) {
        c.checar(game.dmap[p.y * w + p.x] === 0,
          'game.dmap no tile do jogador não é 0',
          () => campos().concat([['valor', game.dmap[p.y * w + p.x]]]));
      }

      let inalcancavel = null;
      for (let y = 0; y < h && inalcancavel === null; y++) {
        for (let x = 0; x < w; x++) {
          if (!WALK.has(map.tiles[y * w + x])) continue;
          if (dmap[y * w + x] >= INF) {
            inalcancavel = { x: x, y: y, v: dmap[y * w + x] };
            break;
          }
        }
      }
      c.checar(inalcancavel === null, 'tile caminhável com valor infinito',
        () => campos().concat([
          ['tile', inalcancavel ? '(' + inalcancavel.x + ',' + inalcancavel.y + ')' : '?'],
          ['valor', inalcancavel ? inalcancavel.v : '?'], ['INF', INF],
          ['conectividade do mapa', map.connectivity]
        ]));

      /* degrau máximo 1 entre vizinhos LEGALMENTE conectados (sem corte de canto). */
      let degrau = null;
      let pinches = 0;
      for (let y = 0; y < h && degrau === null; y++) {
        for (let x = 0; x < w && degrau === null; x++) {
          if (!WALK.has(map.tiles[y * w + x])) continue;
          const va = dmap[y * w + x];
          if (va >= INF) continue;
          for (const d of DIRS8) {
            const nx = x + d[0];
            const ny = y + d[1];
            if (!ehCaminhavel(map, nx, ny, WALK)) continue;
            const diagonal = d[0] !== 0 && d[1] !== 0;
            if (diagonal &&
              (!ehCaminhavel(map, x + d[0], y, WALK) || !ehCaminhavel(map, x, y + d[1], WALK))) {
              pinches++;
              continue;
            }
            const vb = dmap[ny * w + nx];
            if (vb >= INF) continue;
            if (Math.abs(va - vb) > 1) {
              degrau = { ax: x, ay: y, va: va, bx: nx, by: ny, vb: vb };
              break;
            }
          }
        }
      }
      c.checar(degrau === null, 'vizinhos com diferença maior que 1 no Dijkstra',
        () => campos().concat([
          ['tile A', degrau ? '(' + degrau.ax + ',' + degrau.ay + ') = ' + degrau.va : '?'],
          ['tile B', degrau ? '(' + degrau.bx + ',' + degrau.by + ') = ' + degrau.vb : '?'],
          ['observação', 'pares diagonais com corte de canto bloqueado são ignorados']
        ]));
      if (pinches > 0) {
        c.nota('semente ' + semente + ': ' + pinches +
          ' pares diagonais bloqueados por corte de canto (ignorados, conforme §5).');
      }

      /* descida por bestStep chega ao jogador */
      const livres = listaCaminhaveis(map, WALK);
      const rng = rngLocal(fnv1a('T8#' + semente));
      const bloqueado = (x, y) => !ehCaminhavel(map, x, y, WALK);
      for (let t = 0; t < 5; t++) {
        const o = livres[rng.int(0, livres.length - 1)];
        let cx = o.x;
        let cy = o.y;
        let passos = 0;
        let travou = false;
        while (!(cx === p.x && cy === p.y) && passos < w * h) {
          const passo = bestStep(dmap, cx, cy, bloqueado);
          if (!passo) {
            travou = true;
            break;
          }
          if (dmap[passo.y * w + passo.x] >= dmap[cy * w + cx]) {
            c.falhar('bestStep devolveu vizinho que não reduz o valor', () => campos().concat([
              ['de', '(' + cx + ',' + cy + ') = ' + dmap[cy * w + cx]],
              ['para', '(' + passo.x + ',' + passo.y + ') = ' + dmap[passo.y * w + passo.x]]
            ]));
            travou = true;
            break;
          }
          cx = passo.x;
          cy = passo.y;
          passos++;
        }
        c.checar(!travou && cx === p.x && cy === p.y,
          'descida do gradiente não chegou ao jogador', () => campos().concat([
            ['origem', '(' + o.x + ',' + o.y + ')'],
            ['parou em', '(' + cx + ',' + cy + ') = ' + dmap[cy * w + cx]],
            ['passos', passos],
            ['repro', 'R.Dijkstra.bestStep(dmap, ' + cx + ', ' + cy + ', fnBloqueio)']
          ]));
      }

      /* gradiente de fuga */
      const fmap = flee(dmap, map, -1.2);
      if (c.checar(fmap && fmap.length === w * h, 'flee devolveu array de tamanho errado',
        () => campos().concat([['length', fmap ? fmap.length : '(ausente)'],
          ['esperado', w * h]]))) {
        let ruim = null;
        for (let k = 0; k < dmap.length && ruim === null; k++) {
          if (dmap[k] < INF && WALK.has(map.tiles[k]) && !(fmap[k] < INF)) {
            ruim = k;
          }
        }
        c.checar(ruim === null, 'tile alcançável ficou infinito no mapa de fuga',
          () => campos().concat([
            ['tile', ruim === null ? '?' : '(' + (ruim % w) + ',' + ((ruim - (ruim % w)) / w) + ')'],
            ['dmap', ruim === null ? '?' : dmap[ruim]],
            ['fleeMap', ruim === null ? '?' : fmap[ruim]]
          ]));
      }
    }
  }
});

/* ---------------- T9 ---------------- */
TESTES.push({
  id: 'T9',
  nome: 'Sem construções proibidas em index.html',
  run(c) {
    // 'performance.now' e 'Date.now' entram na lista por causa do §0.6: relógio
    // de parede é proibido em qualquer lugar do arquivo, não só na lógica.
    const proibidos = ['Math.random', 'import ', 'require(', 'fetch(', 'http://', 'https://',
      'eval(', 'new Function', 'performance.now', 'Date.now'];
    const linhas = html.split('\n');
    for (const token of proibidos) {
      const ocorrencias = [];
      for (let i = 0; i < linhas.length; i++) {
        let de = 0;
        for (;;) {
          const j = linhas[i].indexOf(token, de);
          if (j === -1) break;
          ocorrencias.push({ linha: i + 1, coluna: j + 1, texto: linhas[i].trim() });
          de = j + token.length;
        }
      }
      c.checar(ocorrencias.length === 0, 'token proibido encontrado: "' + token + '"', () => {
        const campos = [
          ['ocorrências', ocorrencias.length],
          ['arquivo', rel(ARQ_HTML)]
        ];
        for (const o of ocorrencias.slice(0, 8)) {
          const mod = moduloNaLinha(o.linha);
          campos.push([
            'index.html:' + o.linha + ':' + o.coluna,
            recorta(o.texto, 120) + (mod ? '   [' + mod.arquivo + ']' : '')
          ]);
        }
        if (ocorrencias.length > 8) campos.push(['…', 'mais ' + (ocorrencias.length - 8) + ' ocorrência(s)']);
        return campos;
      });
    }
    c.nota('varredura em ' + linhas.length + ' linhas de ' + rel(ARQ_HTML) + '.');
  }
});

/* ---------------- T10 ---------------- */
TESTES.push({
  id: 'T10',
  nome: 'Progressão — descer ' + N.t10Niveis + ' níveis, dificuldade e estatísticas',
  run(c) {
    const createState = fn('Game.createState');
    const applyCommand = fn('Game.applyCommand');
    const descend = fn('Game.descend');
    const semente = 'T10-PROGRESSAO';
    const game = createState(semente, 1);
    const historico = [];

    const medir = () => {
      const vs = vivos(game);
      const somaHp = vs.reduce((s, e) => s + (e.maxHp || e.hp || 0), 0);
      return {
        depth: game.depth,
        inimigos: vs.length,
        mediaHp: vs.length ? somaHp / vs.length : 0,
        maxHp: game.player.maxHp,
        turnos: game.stats ? game.stats.turns : game.turn,
        deepest: game.stats ? game.stats.deepest : game.depth
      };
    };
    historico.push(medir());

    for (let nivel = 1; nivel <= N.t10Niveis; nivel++) {
      /* alguns turnos por nível, com vida reposta pelo harness para isolar
       * a progressão de uma morte acidental. */
      const antesTurnos = game.stats ? game.stats.turns : game.turn;
      for (let k = 0; k < 3; k++) {
        game.player.hp = game.player.maxHp;
        applyCommand(game, 'wait');
      }
      const depoisTurnos = game.stats ? game.stats.turns : game.turn;
      c.checar(depoisTurnos > antesTurnos, 'estatística de turnos não acumulou', () => [
        ['semente', semente], ['nível', game.depth],
        ['antes', antesTurnos], ['depois', depoisTurnos]
      ]);

      const antes = medir();
      game.player.hp = game.player.maxHp;
      game.player.x = game.map.stairs.x;
      game.player.y = game.map.stairs.y;
      let desceu = applyCommand(game, 'descend');
      if (game.depth === antes.depth) {
        descend(game);
        if (game.depth === antes.depth + 1) {
          c.nota('nível ' + antes.depth + ': o comando "descend" não desceu (retorno ' +
            String(desceu) + '); usei R.Game.descend(game) diretamente.');
        }
      }

      const agora = medir();
      c.checar(agora.depth === antes.depth + 1, 'não desceu de nível', () => [
        ['semente', semente],
        ['nível antes', antes.depth], ['nível depois', agora.depth],
        ['jogador', '(' + game.player.x + ',' + game.player.y + ')'],
        ['escada do nível anterior', '(' + game.map.stairs.x + ',' + game.map.stairs.y + ')'],
        ['retorno de applyCommand', String(desceu)],
        ['repro', 'R.Game.descend(R.Game.createState(\'' + semente + '\', ' + antes.depth + '))']
      ]);
      c.checar(!game.over, 'jogo terminou durante a descida', () => [
        ['semente', semente], ['nível', game.depth], ['causa', String(game.cause)]
      ]);
      c.checar(agora.maxHp === antes.maxHp + 2, 'maxHp do jogador não subiu 2 ao descer', () => [
        ['semente', semente], ['nível', agora.depth],
        ['antes', antes.maxHp], ['depois', agora.maxHp]
      ]);
      const cota = Math.min(22, 4 + agora.depth * 2);
      c.checar(agora.inimigos <= cota, 'inimigos acima da cota do nível', () => [
        ['semente', semente], ['nível', agora.depth],
        ['obtido', agora.inimigos], ['máximo', cota]
      ]);
      if (game.stats && typeof game.stats.deepest === 'number') {
        c.checar(game.stats.deepest >= agora.depth, 'stats.deepest não acompanhou a descida', () => [
          ['semente', semente], ['nível', agora.depth], ['deepest', game.stats.deepest]
        ]);
      }
      historico.push(agora);
    }

    const primeiro = historico[0];
    const ultimo = historico[historico.length - 1];
    c.checar(ultimo.depth === primeiro.depth + N.t10Niveis, 'profundidade final inesperada', () => [
      ['semente', semente], ['esperado', primeiro.depth + N.t10Niveis], ['obtido', ultimo.depth]
    ]);
    c.checar(ultimo.inimigos > primeiro.inimigos, 'quantidade de inimigos não cresceu', () => [
      ['semente', semente],
      ['nível ' + primeiro.depth, primeiro.inimigos + ' inimigos'],
      ['nível ' + ultimo.depth, ultimo.inimigos + ' inimigos']
    ]);
    c.checar(ultimo.mediaHp > primeiro.mediaHp, 'vida média dos inimigos não cresceu', () => [
      ['semente', semente],
      ['nível ' + primeiro.depth, primeiro.mediaHp.toFixed(2)],
      ['nível ' + ultimo.depth, ultimo.mediaHp.toFixed(2)]
    ]);
    c.checar(ultimo.turnos > primeiro.turnos, 'stats.turns não acumulou entre níveis', () => [
      ['semente', semente], ['antes', primeiro.turnos], ['depois', ultimo.turnos]
    ]);
    c.nota('progressão: ' + historico.map((s) => 'N' + s.depth + '=' + s.inimigos +
      ' inimigos/hpMed ' + s.mediaHp.toFixed(1)).join('  ·  '));
  }
});

/* ------------------------------------------------------------------ */
/* 7. execução e relatório                                             */
/* ------------------------------------------------------------------ */

if (LISTAR) {
  console.log('');
  console.log('ISOROGUE — testes do harness');
  for (const t of TESTES) console.log('  ' + t.id.padEnd(4) + t.nome);
  console.log('');
  process.exit(0);
}

function imprimirCampos(campos, prefixo) {
  if (!campos || !campos.length) return;
  const larg = campos.reduce((m, cx) => Math.max(m, String(cx[0]).length), 0);
  for (const [rotulo, valor] of campos) {
    const texto = String(valor);
    const linhas = texto.split('\n');
    console.log(prefixo + String(rotulo).padEnd(larg, ' ') + ' : ' + linhas[0]);
    for (let i = 1; i < linhas.length; i++) {
      console.log(prefixo + ' '.repeat(larg) + '   ' + linhas[i]);
    }
  }
}

console.log('');
console.log(SEP2);
console.log(' ISOROGUE — harness headless' + (RAPIDO ? '  [modo rápido]' : ''));
console.log(SEP2);
console.log('  entrada  : ' + rel(ARQ_HTML) + '  (' +
  (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1).replace('.', ',') + ' KB)');
console.log('  script   : ' + codigo.split('\n').length + ' linhas · ' +
  marcasModulo.length + ' módulo(s) detectado(s)' +
  (marcasModulo.length ? ' (' + marcasModulo.map((m) => m.arquivo.replace('src/', '')).join(', ') + ')' : ''));
console.log('  carga    : ' + ms(msCarga) + ' · window.R exposto com ' +
  Object.keys(R).length + ' chave(s): ' + Object.keys(R).join(', '));
console.log('  node     : ' + process.version);

if (problemasDeCarga.length) {
  console.log('');
  console.log(' [FALHA] a carga do script emitiu ' + problemasDeCarga.length +
    ' console.warn/console.error — isso é falha (contrato §11).');
  for (const p of problemasDeCarga.slice(0, 10)) {
    console.log('         · console.' + p.nivel + ': ' + recorta(p.texto, 300));
    if (p.onde) console.log('           origem: ' + p.onde);
  }
}

const selecionados = TESTES.filter((t) => !SOMENTE || SOMENTE.has(t.id));
if (SOMENTE && selecionados.length === 0) {
  abortar('nenhum teste corresponde a --only ' + Array.from(SOMENTE).join(','), [
    'Disponíveis: ' + TESTES.map((t) => t.id).join(', ')
  ]);
}

const resultados = [];

for (const teste of selecionados) {
  const c = new Coletor(teste.id);
  registro.fase = teste.id;
  const t0 = process.hrtime.bigint();
  let erro = null;
  try {
    teste.run(c);
  } catch (err) {
    erro = err;
  }
  const dt = Number(process.hrtime.bigint() - t0) / 1e6;
  const problemas = registro.problemas.filter((p) => p.fase === teste.id);
  const passou = !erro && c.ok && problemas.length === 0;

  console.log('');
  console.log(SEP);
  console.log((passou ? ' [ OK ]  ' : ' [FALHA] ') + teste.id + ' — ' + teste.nome);
  console.log('         ' + c.checagens + ' verificação(ões) · ' + ms(dt));

  if (erro) {
    if (erro instanceof ApiAusente) {
      console.log('');
      console.log('         O teste não pôde rodar:');
      console.log('           ' + erro.message);
      console.log('           Corrija o módulo responsável (contrato §1) e rode de novo.');
    } else {
      const onde = localizar(erro && erro.stack);
      console.log('');
      console.log('         Exceção durante o teste: ' + (erro && erro.message));
      if (onde) console.log('           origem: ' + onde);
      const todas = String((erro && erro.stack) || '').split('\n').slice(1);
      const doJogo = todas.filter((l) => l.indexOf('index.html') !== -1);
      const pilha = (doJogo.length ? doJogo : todas).slice(0, 6);
      for (const l of pilha) console.log('           ' + l.trim());
    }
  }

  if (c.falhasTotais > 0) {
    console.log('');
    console.log('         ' + c.falhasTotais + ' de ' + c.checagens + ' verificações falharam.');
    c.falhas.forEach((f, i) => {
      console.log('');
      console.log('         ' + (i + 1) + ') ' + f.titulo);
      imprimirCampos(f.campos, '            ');
    });
    if (c.falhasTotais > c.falhas.length) {
      console.log('');
      console.log('         (mais ' + (c.falhasTotais - c.falhas.length) +
        ' falha(s) do mesmo teste não detalhadas)');
    }
  }

  if (problemas.length) {
    console.log('');
    console.log('         ' + problemas.length +
      ' console.warn/console.error emitido(s) pelo jogo durante o teste (falha):');
    for (const p of problemas.slice(0, 8)) {
      console.log('           · console.' + p.nivel + ': ' + recorta(p.texto, 260));
      if (p.onde) console.log('             origem: ' + p.onde);
    }
    if (problemas.length > 8) {
      console.log('           (mais ' + (problemas.length - 8) + ')');
    }
  }

  if (c.notas.length) {
    const mostrar = c.notas.slice(0, passou ? 3 : 8);
    console.log('');
    for (const n of mostrar) console.log('         nota: ' + recorta(n, 220));
    if (c.notas.length > mostrar.length) {
      console.log('         nota: (mais ' + (c.notas.length - mostrar.length) + ')');
    }
  }

  resultados.push({
    id: teste.id,
    nome: teste.nome,
    passou: passou,
    checagens: c.checagens,
    falhas: c.falhasTotais,
    problemas: problemas.length,
    erro: erro,
    ms: dt
  });
}

registro.fase = 'final';

const falhados = resultados.filter((r) => !r.passou);
const totalChecagens = resultados.reduce((s, r) => s + r.checagens, 0);
const totalMs = resultados.reduce((s, r) => s + r.ms, 0);

console.log('');
console.log(SEP2);
console.log(' RESUMO');
console.log(SEP2);
for (const r of resultados) {
  console.log('  ' + (r.passou ? '[ OK ]  ' : '[FALHA] ') + r.id.padEnd(4, ' ') +
    String(r.checagens).padStart(7, ' ') + ' verificações · ' + ms(r.ms).padStart(9, ' ') +
    '   ' + r.nome);
}
console.log('');
console.log('  ' + totalChecagens + ' verificações em ' + ms(totalMs) + '.');

if (problemasDeCarga.length) {
  console.log('  ' + problemasDeCarga.length +
    ' problema(s) de console durante a carga do script (conta como falha).');
}

if (falhados.length === 0 && problemasDeCarga.length === 0) {
  console.log('');
  console.log('  TODOS OS TESTES PASSARAM');
  console.log('');
  process.exit(0);
}

console.log('');
console.log('  FALHAS (' + (falhados.length + (problemasDeCarga.length ? 1 : 0)) + '):');
if (problemasDeCarga.length) {
  console.log('    · carga do script — ' + problemasDeCarga.length + ' console.warn/error');
}
for (const r of falhados) {
  const motivo = r.erro
    ? (r.erro instanceof ApiAusente ? 'API ausente' : 'exceção: ' + r.erro.message)
    : (r.falhas ? r.falhas + ' verificação(ões)' : '') +
      (r.falhas && r.problemas ? ' + ' : '') +
      (r.problemas ? r.problemas + ' console.warn/error' : '');
  console.log('    · ' + r.id + ' — ' + r.nome + '  [' + motivo + ']');
}
console.log('');
process.exit(1);
