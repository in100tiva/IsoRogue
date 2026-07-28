#!/usr/bin/env node
/*
 * ISOROGUE — gerador do ORACLE da migração (docs/ARQUITETURA-REACT.md §7.1)
 * ------------------------------------------------------------------------
 * Carrega `legacy/isorogue-vanilla.html` (a versão vanilla CONGELADA), extrai o
 * conteúdo do <script> e executa em `node:vm` com o mesmo sandbox mínimo do
 * `legacy/harness-vanilla.mjs` (window, document, canvas 2D, localStorage,
 * crypto). Roda 12 partidas determinísticas e grava `test/golden/snapshots.json`.
 *
 * O JSON resultante é o oracle contra o qual `test/golden.test.ts` compara o
 * engine novo. Ele é DETERMINÍSTICO por construção: rodar duas vezes produz um
 * arquivo byte a byte idêntico.
 *
 * Parâmetros fixos do contrato (§7.1):
 *   · 12 sementes GOLD-0001 .. GOLD-0012
 *   · profundidades 1..3 (ciclo: caso 1 -> 1, caso 2 -> 2, caso 3 -> 3, caso 4 -> 1, ...)
 *   · 200 comandos por caso, gerados por um LCG do próprio script (semente 20260728)
 *   · snapshot() a cada 10 turnos + snapshot final
 *   · log completo, stats finais, hashes de tiles/decor
 *
 * Além do mínimo do contrato, cada caso registra (para que QUALQUER divergência
 * do port apareça, e apareça no turno certo):
 *   · `aceitos`          — string de 200 dígitos: 1 = applyCommand devolveu true
 *   · `hashesPorComando` — hash de 8 hex do snapshot() após CADA comando
 *   · `inimigosFinais`   — posição/hp/estado/plano de cada inimigo ao final
 *   · `itensFinais`      — itens que sobraram no chão
 *   · `visiveis`         — tamanho + hash de game.visible
 *   · `explorados`       — tamanho + hash de game.explored, e explorePct
 *   · `niveis`           — mapa de cada nível visitado (o comando `descend` está no pool)
 *   · `morte`            — turno, índice do comando e causa, quando a run acaba antes
 *
 * Node >= 18, ESM, zero dependências.
 *
 * Uso:
 *   node tools/gen-golden.mjs             gera test/golden/snapshots.json
 *   node tools/gen-golden.mjs --resumo    só imprime o resumo, não grava
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto, createHash } from 'node:crypto';
import { inspect } from 'node:util';
import vm from 'node:vm';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const ARQ_HTML = join(RAIZ, 'legacy', 'isorogue-vanilla.html');
const DIR_SAIDA = join(RAIZ, 'test', 'golden');
const ARQ_SAIDA = join(DIR_SAIDA, 'snapshots.json');

const argv = process.argv.slice(2);
const SO_RESUMO = argv.includes('--resumo') || argv.includes('--dry-run');

/* ------------------------------------------------------------------ */
/* parâmetros do contrato §7.1                                         */
/* ------------------------------------------------------------------ */

const N_CASOS = 12;
const N_COMANDOS = 200;
const INTERVALO_SNAPSHOT = 10;
const SEMENTE_LCG = 20260728;

/* ------------------------------------------------------------------ */
/* utilitários                                                         */
/* ------------------------------------------------------------------ */

function rel(caminho) {
  const r = relative(RAIZ, caminho);
  return r === '' ? '.' : r.split('\\').join('/');
}

function abortar(mensagem, dicas) {
  console.error('');
  console.error('[gen-golden] ERRO FATAL: ' + mensagem);
  if (dicas && dicas.length) {
    console.error('');
    for (const d of dicas) console.error('             · ' + d);
  }
  console.error('');
  process.exit(1);
}

/* FNV-1a 32 bits — o mesmo algoritmo do jogo, para hashes curtos e estáveis. */
function fnv1aStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fnv1aBytes(arr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i] & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/*
 * LCG do PRÓPRIO script (Numerical Recipes, 32 bits) — semente 20260728.
 * Nada de Math.random em lugar nenhum: as 12 sequências de comandos têm de ser
 * reproduzíveis por quem quiser regerar o oracle.
 */
function makeLcg(semente) {
  let s = semente >>> 0;
  const lcg = {
    u32() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    },
    int(a, b) {
      return a + (lcg.u32() % (b - a + 1));
    }
  };
  return lcg;
}

/*
 * Pool de comandos — mesma composição do harness vanilla (§11 T6/T7):
 * 8 direções × 6 + 3 esperas + 2 usos de poção + 1 descida = 54 entradas.
 * `descend` no pool é de propósito: exercita a progressão de nível.
 */
const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function montarPool() {
  const pool = [];
  for (const d of DIRS8) {
    for (let k = 0; k < 6; k++) pool.push('move:' + d[0] + ',' + d[1]);
  }
  for (let k = 0; k < 3; k++) pool.push('wait');
  for (let k = 0; k < 2; k++) pool.push('use');
  pool.push('descend');
  return pool;
}

function pad(n, largura) {
  return String(n).padStart(largura, '0');
}

function ms(n) {
  return n < 1000 ? n.toFixed(0) + ' ms' : (n / 1000).toFixed(2).replace('.', ',') + ' s';
}

/* ------------------------------------------------------------------ */
/* 1. carregar o vanilla congelado e extrair o script                  */
/* ------------------------------------------------------------------ */

if (!existsSync(ARQ_HTML)) {
  abortar('não encontrei ' + rel(ARQ_HTML) + '.', [
    'O oracle é gerado a partir da versão vanilla congelada em legacy/.'
  ]);
}

let html = '';
try {
  html = readFileSync(ARQ_HTML, 'utf8');
} catch (err) {
  abortar('não consegui ler ' + rel(ARQ_HTML) + ': ' + (err && err.message));
}

const FONTE_SHA256 = createHash('sha256').update(html, 'utf8').digest('hex');

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
      base = antes.split('\n').length;
    }
    blocos.push(m[2]);
  }
  return { blocos: blocos, linhaBase: base };
}

const extracao = extrairScripts(html);
if (extracao.blocos.length === 0) {
  abortar('nenhum bloco <script> inline em ' + rel(ARQ_HTML) + '.');
}
const codigo = extracao.blocos.join('\n;\n');
const LINHA_BASE = extracao.linhaBase;
if (codigo.trim().length < 200) {
  abortar('o <script> de ' + rel(ARQ_HTML) + ' tem só ' + codigo.trim().length + ' caracteres.');
}

/* ------------------------------------------------------------------ */
/* 2. sandbox (portado de legacy/harness-vanilla.mjs)                  */
/* ------------------------------------------------------------------ */

const problemas = [];

function fmt(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 2, colors: false, breakLength: 120 })))
    .join(' ');
}

function criarConsole() {
  const nada = () => {};
  const registrarLog = () => {};
  const anotar = (nivel, args) => {
    problemas.push({ nivel: nivel, texto: fmt(args) });
  };
  return {
    log: registrarLog,
    info: registrarLog,
    debug: registrarLog,
    dir: registrarLog,
    table: registrarLog,
    trace: registrarLog,
    warn: (...a) => anotar('warn', a),
    error: (...a) => anotar('error', a),
    assert: (cond, ...a) => {
      if (!cond) anotar('error', ['console.assert falhou:', ...a]);
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
    _sandboxId: ++contadorNos,
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
    /* 'loading' faz o boot cair no addEventListener('DOMContentLoaded'), que é
     * no-op aqui — o oracle usa a API pura, sem boot(). */
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
const armazenamento = criarLocalStorage();

const sandbox = {
  console: criarConsole(),
  crypto: webcrypto,
  performance: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} },
  localStorage: armazenamento,
  sessionStorage: criarLocalStorage(),
  document: documento,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  outerWidth: 1280,
  outerHeight: 720,
  screen: { width: 1280, height: 720, availWidth: 1280, availHeight: 720 },
  navigator: {
    userAgent: 'isorogue-gen-golden/1.0 (node)',
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

const contexto = vm.createContext(sandbox, { name: 'isorogue-golden' });
vm.runInContext(
  'globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis; globalThis.frames = globalThis;',
  contexto,
  { filename: 'gen-golden-bootstrap.js' }
);

/* ------------------------------------------------------------------ */
/* 3. executar o script do jogo                                        */
/* ------------------------------------------------------------------ */

try {
  const script = new vm.Script(codigo, { filename: 'isorogue-vanilla.html', lineOffset: LINHA_BASE - 1 });
  script.runInContext(contexto, { displayErrors: true });
} catch (err) {
  abortar('o script de ' + rel(ARQ_HTML) + ' lançou durante a carga: ' + (err && err.message), [
    ...String((err && err.stack) || '').split('\n').slice(0, 6).map((l) => '  ' + l.trim())
  ]);
}

const R = sandbox.R;
if (!R || typeof R !== 'object' || !R.Game) {
  abortar('o script carregou mas não expôs window.R.Game.');
}

const createState = R.Game.createState;
const applyCommand = R.Game.applyCommand;
const snapshot = R.Game.snapshot;
for (const [nome, f] of [['createState', createState], ['applyCommand', applyCommand], ['snapshot', snapshot]]) {
  if (typeof f !== 'function') abortar('R.Game.' + nome + ' não é função.');
}

/* ------------------------------------------------------------------ */
/* 4. extratores de estado (formato fechado — é o contrato do oracle)  */
/* ------------------------------------------------------------------ */

function ponto(p) {
  return p ? { x: p.x, y: p.y } : null;
}

function extrairJogador(p) {
  return {
    x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
    atk: p.atk, potions: p.potions, level: p.level, xp: p.xp
  };
}

/* `bump` fica de fora de propósito: é float de animação (§6 do CONTRACTS.md),
 * não é estado lógico, e comparar float entre implementações é ruído. */
function extrairInimigo(e) {
  return {
    id: e.id, kind: e.kind, x: e.x, y: e.y,
    hp: e.hp, maxHp: e.maxHp, atk: e.atk, range: e.range,
    state: e.state, plan: String(e.plan == null ? '' : e.plan), lastDmg: e.lastDmg
  };
}

function extrairItem(it) {
  return { id: it.id, kind: it.kind, x: it.x, y: it.y, heal: it.heal };
}

function extrairInimigos(lista) {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairInimigo);
}

function extrairItens(lista) {
  return lista.slice().sort((a, b) => a.id - b.id).map(extrairItem);
}

function extrairStats(s) {
  return {
    turns: s.turns, kills: s.kills, dmgDealt: s.dmgDealt, dmgTaken: s.dmgTaken,
    itemsUsed: s.itemsUsed, deepest: s.deepest, explorePct: s.explorePct
  };
}

function extrairLog(log) {
  return log.map((e) => ({ turn: e.turn, text: e.text, cls: e.cls }));
}

function extrairSala(r) {
  return {
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
    cx: r.cx, cy: r.cy, area: r.area, shape: r.shape
  };
}

/*
 * `completo` inclui a lista inteira de salas. Só o mapa de abertura de cada caso
 * a carrega; os demais ficam com `salasHash`, que já detecta qualquer divergência
 * — repetir 21 salas cinco vezes por caso só engordaria o arquivo.
 */
function extrairMapa(map, completo) {
  const salas = map.rooms.map(extrairSala);
  const out = {
    seed: map.seed,
    depth: map.depth,
    w: map.w,
    h: map.h,
    tilesHash: fnv1aBytes(map.tiles),
    decorHash: fnv1aBytes(map.decor),
    start: ponto(map.start),
    stairs: ponto(map.stairs),
    connectivity: map.connectivity,
    walkable: map.walkable,
    regenerations: map.regenerations,
    repairs: map.repairs,
    salas: salas.length,
    salasHash: fnv1aStr(JSON.stringify(salas)),
    notes: map.notes.slice()
  };
  if (completo) out.rooms = salas;
  return out;
}

/* Ordem canônica ASCENDENTE de índice — independe da ordem de inserção do Set. */
function extrairVisiveis(game) {
  const n = game.map.w * game.map.h;
  const partes = [];
  for (let i = 0; i < n; i++) {
    if (game.visible.has(i)) partes.push(i);
  }
  return { tamanho: partes.length, hash: fnv1aStr(partes.join(',')) };
}

function extrairExplorados(game) {
  let n = 0;
  for (let i = 0; i < game.explored.length; i++) {
    if (game.explored[i]) n++;
  }
  return { tamanho: n, hash: fnv1aBytes(game.explored) };
}

/* ------------------------------------------------------------------ */
/* 5. rodar uma partida                                                */
/* ------------------------------------------------------------------ */

/*
 * Executa `comandos` sobre uma partida nova (seed, depth) e devolve tudo o que
 * o teste de paridade precisa comparar.
 *
 * `vidaFolgada` reproduz o protocolo do T6 do harness vanilla: maxHp = 999 uma
 * vez e, antes de CADA comando, `if (!over) hp = maxHp`. Sem isso o jogador
 * morre por volta do turno 30 e os 200 comandos viram 170 recusas — que não
 * provam nada. A intervenção é externa ao engine, determinística e trivial de
 * reproduzir no port (o Game é o mesmo objeto mutável).
 */
function rodarPartida(seed, depth, comandos, vidaFolgada) {
  /* Cada partida parte de um armazenamento limpo: o autosave do vanilla escreve
   * em localStorage e não queremos vazamento de uma partida para a outra. */
  armazenamento.clear();

  const game = createState(seed, depth);
  if (vidaFolgada) {
    game.player.maxHp = 999;
    game.player.hp = 999;
  }

  const mapaCompleto = extrairMapa(game.map, true);
  const niveis = [extrairMapa(game.map, false)];
  let depthAtual = game.depth;

  const inicial = {
    snapshot: String(snapshot(game)),
    jogador: extrairJogador(game.player),
    inimigos: extrairInimigos(game.enemies),
    itens: extrairItens(game.items),
    stats: extrairStats(game.stats),
    visiveis: extrairVisiveis(game),
    explorados: extrairExplorados(game),
    log: extrairLog(game.log)
  };

  const snapshotsPorTurno = {};
  const hashesPorComando = [];
  let aceitos = '';
  let morte = null;
  let ultimoMarco = 0;

  /* turno 0 é marco natural do intervalo de 10 */
  snapshotsPorTurno['0'] = inicial.snapshot;

  for (let i = 0; i < comandos.length; i++) {
    const cmd = comandos[i];
    const jaMorto = game.over;
    if (vidaFolgada && !game.over) game.player.hp = game.player.maxHp;

    const aceito = applyCommand(game, cmd) === true;
    aceitos += aceito ? '1' : '0';

    const snap = String(snapshot(game));
    hashesPorComando.push(fnv1aStr(snap));

    if (game.depth !== depthAtual) {
      depthAtual = game.depth;
      niveis.push(extrairMapa(game.map, false));
    }

    /* Marco a cada 10 turnos. `endTurn` soma 1 por vez, então o laço fecha
     * sempre no próprio turno; o `while` é só blindagem contra salto. */
    while (game.turn >= ultimoMarco + INTERVALO_SNAPSHOT) {
      ultimoMarco += INTERVALO_SNAPSHOT;
      if (game.turn === ultimoMarco) snapshotsPorTurno[String(ultimoMarco)] = snap;
    }

    if (!jaMorto && game.over && !morte) {
      morte = {
        turno: game.turn,
        comandoIndice: i,
        comando: cmd,
        causa: game.cause,
        snapshot: snap,
        jogador: extrairJogador(game.player)
      };
    }
  }

  const final = {
    snapshot: String(snapshot(game)),
    depth: game.depth,
    turn: game.turn,
    over: game.over === true,
    cause: game.cause,
    jogador: extrairJogador(game.player),
    inimigos: extrairInimigos(game.enemies),
    inimigosVivos: game.enemies.filter((e) => e.hp > 0).length,
    itens: extrairItens(game.items),
    stats: extrairStats(game.stats),
    explorePct: game.stats.explorePct,
    visiveis: extrairVisiveis(game),
    explorados: extrairExplorados(game),
    rngCombat: game.rngCombat.s >>> 0,
    mapa: extrairMapa(game.map, false),
    log: extrairLog(game.log)
  };

  return {
    mapaCompleto: mapaCompleto,
    inicial: inicial,
    aceitos: aceitos,
    aceitosTotal: aceitos.split('1').length - 1,
    hashesPorComando: hashesPorComando,
    snapshots: snapshotsPorTurno,
    niveis: niveis,
    morte: morte,
    final: final
  };
}

/*
 * O comando `descend` está no pool, mas só é aceito com o jogador em cima da
 * escada — coisa que 200 comandos sorteados nunca conseguem. Sem este bloco o
 * oracle não cobriria R.Game.descend (regeneração do mapa pela seed+depth,
 * maxHp += 2, novo rngCombat, stats.deepest, população mais dura).
 * Aqui a descida é forçada pela API, 4 níveis a partir do nível do caso.
 */
const N_DESCIDAS = 4;

function rodarProgressao(seed, depth) {
  armazenamento.clear();
  const game = createState(seed, depth);
  const niveis = [{
    depth: game.depth,
    snapshot: String(snapshot(game)),
    jogador: extrairJogador(game.player),
    stats: extrairStats(game.stats),
    mapa: extrairMapa(game.map, false),
    inimigos: extrairInimigos(game.enemies),
    itens: extrairItens(game.items),
    rngCombat: game.rngCombat.s >>> 0
  }];
  for (let k = 0; k < N_DESCIDAS; k++) {
    R.Game.descend(game);
    niveis.push({
      depth: game.depth,
      snapshot: String(snapshot(game)),
      jogador: extrairJogador(game.player),
      stats: extrairStats(game.stats),
      mapa: extrairMapa(game.map, false),
      inimigos: extrairInimigos(game.enemies),
      itens: extrairItens(game.items),
      rngCombat: game.rngCombat.s >>> 0
    });
  }
  return {
    protocolo: 'createState(seed, depth) e depois ' + N_DESCIDAS +
      ' chamadas diretas a R.Game.descend(game), sem comando nenhum entre elas',
    niveis: niveis,
    log: extrairLog(game.log)
  };
}

/* ------------------------------------------------------------------ */
/* 6. rodar os 12 casos                                                */
/* ------------------------------------------------------------------ */

const pool = montarPool();
const lcg = makeLcg(SEMENTE_LCG);
const t0 = process.hrtime.bigint();
const casos = [];

for (let ci = 0; ci < N_CASOS; ci++) {
  const seed = 'GOLD-' + pad(ci + 1, 4);
  const depth = (ci % 3) + 1;

  /* A sequência de comandos é sorteada ANTES da partida e independe do estado
   * do jogo — é a mesma lista que o teste de paridade vai reproduzir. */
  const comandos = [];
  for (let i = 0; i < N_COMANDOS; i++) comandos.push(pool[lcg.int(0, pool.length - 1)]);

  const normal = rodarPartida(seed, depth, comandos, false);
  const resistente = rodarPartida(seed, depth, comandos, true);

  casos.push({
    id: ci + 1,
    seed: seed,
    depth: depth,
    mapa: normal.mapaCompleto,
    populacao: { inimigos: normal.inicial.inimigos, itens: normal.inicial.itens },
    progressao: rodarProgressao(seed, depth),
    inicial: normal.inicial,
    comandos: comandos,
    /* Partida canônica: jogador como o jogo o cria. Costuma morrer antes dos
     * 200 comandos — a morte também é comportamento a preservar. */
    aceitos: normal.aceitos,
    aceitosTotal: normal.aceitosTotal,
    hashesPorComando: normal.hashesPorComando,
    snapshots: normal.snapshots,
    niveis: normal.niveis,
    morte: normal.morte,
    final: normal.final,
    /* Segunda passada, mesmos comandos, jogador curado antes de cada um:
     * garante que os 200 comandos sejam de fato executados. */
    resistente: {
      protocolo: 'player.maxHp = 999 no início; antes de cada comando, se !over, ' +
        'player.hp = player.maxHp (idêntico ao T6 de legacy/harness-vanilla.mjs)',
      snapshotInicial: resistente.inicial.snapshot,
      aceitos: resistente.aceitos,
      aceitosTotal: resistente.aceitosTotal,
      hashesPorComando: resistente.hashesPorComando,
      snapshots: resistente.snapshots,
      niveis: resistente.niveis,
      morte: resistente.morte,
      final: resistente.final
    }
  });
}

const msTotal = Number(process.hrtime.bigint() - t0) / 1e6;

/* ------------------------------------------------------------------ */
/* 7. gravar                                                           */
/* ------------------------------------------------------------------ */

/*
 * `geradoEm` é o mtime da FONTE, não o relógio da máquina: o oracle precisa ser
 * byte a byte reprodutível (rodar duas vezes ⇒ mesmo arquivo). Um Date.now()
 * aqui quebraria isso. A proveniência real de conteúdo é `fonteSha256`.
 */
const geradoEm = new Date(statSync(ARQ_HTML).mtimeMs).toISOString();

const saida = {
  geradoEm: geradoEm,
  fonte: 'legacy/isorogue-vanilla.html',
  fonteSha256: FONTE_SHA256,
  gerador: {
    script: 'tools/gen-golden.mjs',
    contrato: 'docs/ARQUITETURA-REACT.md §7.1',
    versaoJogo: (R.C && R.C.VERSION) || null,
    casos: N_CASOS,
    comandosPorCaso: N_COMANDOS,
    intervaloSnapshot: INTERVALO_SNAPSHOT,
    lcg: {
      tipo: 'LCG 32 bits (Numerical Recipes): s = (1664525*s + 1013904223) mod 2^32',
      semente: SEMENTE_LCG,
      consumo: 'um u32 por comando, em sequência contínua do caso 1 ao caso 12',
      indice: 'cmd = pool[s % pool.length]',
      pool: pool
    },
    hash: 'FNV-1a 32 bits, 8 dígitos hex (mesmo algoritmo do jogo)',
    campos: {
      aceitos: 'string de ' + N_COMANDOS + ' dígitos; 1 = applyCommand devolveu true',
      hashesPorComando: 'hash do snapshot() após cada comando — aponta o primeiro turno divergente',
      snapshots: 'snapshot() nos turnos múltiplos de ' + INTERVALO_SNAPSHOT + ' (inclui o turno 0)',
      niveis: 'mapa de cada nível visitado, na ordem — o comando descend está no pool',
      morte: 'null se a run sobreviveu aos ' + N_COMANDOS + ' comandos',
      resistente: 'segunda passada com os MESMOS comandos e o jogador curado antes de ' +
        'cada um (protocolo T6 do harness vanilla); é o que garante que os ' + N_COMANDOS +
        ' comandos sejam executados de verdade em vez de recusados por morte precoce',
      progressao: N_DESCIDAS + ' descidas forçadas por R.Game.descend — cobre o que a ' +
        'sequência sorteada nunca alcança (o jogador nunca cai em cima da escada por acaso)',
      rooms: 'lista completa de salas só em casos[].mapa; os demais mapas trazem salasHash',
      bump: 'NÃO capturado: é animação (float), não estado lógico'
    }
  },
  casos: casos
};

const json = JSON.stringify(saida, null, 2) + '\n';

if (!SO_RESUMO) {
  mkdirSync(DIR_SAIDA, { recursive: true });
  writeFileSync(ARQ_SAIDA, json, 'utf8');
}

/* ------------------------------------------------------------------ */
/* 8. resumo                                                           */
/* ------------------------------------------------------------------ */

const SEP = '─'.repeat(96);
const kb = Buffer.byteLength(json, 'utf8') / 1024;

function col(v, n) {
  return String(v).padStart(n);
}

console.log('');
console.log('ISOROGUE — oracle da migração (docs/ARQUITETURA-REACT.md §7.1)');
console.log(SEP);
console.log('  fonte    : ' + rel(ARQ_HTML) + '  (sha256 ' + FONTE_SHA256.slice(0, 12) + '…)');
console.log('  saída    : ' + rel(ARQ_SAIDA) + (SO_RESUMO ? '  (NÃO gravado — --resumo)' : ''));
console.log('  tamanho  : ' + kb.toFixed(1).replace('.', ',') + ' KB');
console.log('  tempo    : ' + ms(msTotal));
console.log(SEP);
console.log('                          ┌──── partida canônica ─────┐  ┌──── partida resistente ────┐');
console.log('  caso  semente     nív   turnos  aceit  morte  explor%   turnos  aceit  nív  kills  explor%');
console.log(SEP);
for (const c of casos) {
  const r = c.resistente;
  console.log([
    '  ' + pad(c.id, 2),
    '  ' + c.seed.padEnd(11),
    col(c.depth, 4),
    col(c.final.turn, 9),
    col(c.aceitosTotal, 7),
    col(c.morte ? 't' + c.morte.turno : '—', 7),
    col(c.final.explorePct + '%', 9),
    col(r.final.turn, 9),
    col(r.aceitosTotal, 7),
    col(r.final.depth, 5),
    col(r.final.stats.kills, 7),
    col(r.final.explorePct + '%', 9)
  ].join(''));
}
console.log(SEP);
const mortos = casos.filter((c) => c.morte).length;
console.log('  canônica  : ' + mortos + '/' + N_CASOS + ' terminam em morte; ' +
  (N_CASOS - mortos) + ' sobrevivem aos ' + N_COMANDOS + ' comandos.');
console.log('  resistente: ' + casos.filter((c) => c.resistente.morte).length + '/' + N_CASOS +
  ' mortes; níveis alcançados ' +
  Array.from(new Set(casos.map((c) => c.resistente.final.depth))).sort((a, b) => a - b).join(', ') +
  '; ' + casos.reduce((s, c) => s + c.resistente.niveis.length, 0) + ' mapas gerados no total.');
console.log('  causas de morte (canônica):');
for (const c of casos) {
  if (c.morte) console.log('    · ' + c.seed + ' — ' + c.morte.causa + ' (turno ' + c.morte.turno + ')');
}

if (problemas.length) {
  console.log(SEP);
  console.log('  ATENÇÃO: o jogo emitiu ' + problemas.length + ' console.warn/error durante a geração:');
  for (const p of problemas.slice(0, 8)) {
    console.log('    · [' + p.nivel + '] ' + p.texto.slice(0, 160));
  }
}
console.log('');
