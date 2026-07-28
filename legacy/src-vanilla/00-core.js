/*
 * ISOROGUE — src/00-core.js
 * Módulo "core": namespace, constantes, RNG determinístico e helpers geométricos.
 *
 * Este arquivo é a BASE DE TODO O DETERMINISMO DO JOGO. Invariantes globais:
 *
 *  I1. O gerador pseudoaleatório nativo do JS é proibido em todo o projeto.
 *      A ÚNICA fonte de entropia real é crypto.getRandomValues, usada
 *      exclusivamente em R.newSeedString().
 *  I2. Nenhum relógio (nem parede, nem alta resolução) participa da lógica.
 *      Nenhuma função deste módulo lê o tempo.
 *  I3. Todo valor produzido pelo RNG é função pura do estado uint32 `rng.s`.
 *      Snapshot/restauração de save = copiar `rng.s`.
 *  I4. Nenhum acesso a DOM no top-level (o harness headless carrega sem document).
 *  I5. Toda aritmética de 32 bits fecha com `>>> 0` (uint32) — nunca vaza negativo.
 */
(function (R) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. Builtins içados para o escopo do módulo
   *
   * PERF (medido, não suposto): dentro de `node:vm` — que é como o harness
   * headless roda o jogo inteiro — cada leitura de um global como `Math`
   * atravessa o interceptor do global proxy do contexto. Em laço quente isso
   * custa ~19x: 3M chamadas de u32() caem de 631ms para 33ms apenas por ler
   * `imul` de uma variável de escopo em vez de `Math.imul`.
   * No navegador o ganho é neutro. Não remova estas linhas.
   * ------------------------------------------------------------------ */

  var imul = Math.imul;
  var floor = Math.floor;
  var sqrt = Math.sqrt;

  /* ------------------------------------------------------------------ *
   * 1. Constantes globais (contrato §2)
   * ------------------------------------------------------------------ */

  R.C = {
    VERSION: '1.0.0',
    MAP_W: 45,
    MAP_H: 45,
    TILE: { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3 },
    TW: 64,          // largura do losango do piso
    TH: 32,          // altura do losango do piso
    WALL_H: 36,      // altura vertical da parede em px
    FOV_RADIUS: 9,
    SAFE_RADIUS: 6,  // raio livre de inimigos ao redor do início
    MAX_REGEN: 8,    // tentativas de regeneração de mapa
    MAX_LOG: 400,
    STORAGE_KEY: 'isorogue.save.v1',
    HISTORY_KEY: 'isorogue.history.v1',
    ZOOM_MIN: 0.45,
    ZOOM_MAX: 2.4
  };

  /* ------------------------------------------------------------------ *
   * 2. Hash determinístico — FNV-1a 32 bits
   * ------------------------------------------------------------------ */

  var FNV_OFFSET_32 = 2166136261;   // 0x811C9DC5
  var FNV_PRIME_32 = 16777619;      // 0x01000193

  /**
   * FNV-1a 32 bits sobre as unidades UTF-16 da string.
   * Determinístico, estável entre plataformas e independente de locale.
   * Retorna sempre um uint32 (0..4294967295).
   *
   * Nota: percorremos code units (charCodeAt), não code points. Isso é
   * intencional e estável: seeds são ASCII maiúsculo na prática, e mesmo
   * com caracteres fora do BMP o resultado continua determinístico.
   */
  R.hash32 = function (str) {
    var s = (str === null || str === undefined) ? '' : String(str);
    var h = FNV_OFFSET_32;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // Math.imul garante multiplicação 32 bits com wrap-around correto.
      h = imul(h, FNV_PRIME_32);
    }
    return h >>> 0;
  };

  /* ------------------------------------------------------------------ *
   * 3. RNG — mulberry32
   * ------------------------------------------------------------------ */

  var UINT32_COUNT = 4294967296;    // 2^32

  // Protótipo compartilhado: os métodos vivem aqui, cada rng carrega só `s`.
  // Isso mantém o objeto barato de criar (forks são frequentes) e garante
  // que o estado serializável seja exatamente uma propriedade uint32.
  var rngProto = {

    /**
     * Próximo uint32 da sequência mulberry32.
     * Avança o estado `s` (uint32) exatamente um passo.
     */
    u32: function () {
      // s = (s + 0x6D2B79F5) mod 2^32
      var a = (this.s + 0x6D2B79F5) >>> 0;
      this.s = a;
      var t = imul(a ^ (a >>> 15), 1 | a);
      // O `^ t` final faz a truncagem para int32 do somatório (ToInt32).
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    },

    /** Float em [0, 1). Divisão por 2^32 — nunca alcança 1. */
    next: function () {
      return this.u32() / UINT32_COUNT;
    },

    /**
     * Inteiro em [a, b] — INCLUSIVO nos dois extremos.
     *
     * Uniformidade: rejection sampling (método de Lemire "modulo rejection").
     * Descartamos a franja superior do espaço uint32 que não é múltipla exata
     * do intervalo, eliminando o viés de módulo. O laço termina com
     * probabilidade 1 e, na prática, quase sempre na primeira iteração
     * (a franja tem no máximo `range-1` valores em 2^32).
     */
    int: function (a, b) {
      var lo = floor(a);
      var hi = floor(b);
      if (!(hi > lo)) return lo;              // intervalo degenerado ou invertido
      var range = hi - lo + 1;
      if (range >= UINT32_COUNT) return lo + this.u32();
      var limit = UINT32_COUNT - (UINT32_COUNT % range);
      var v = this.u32();
      while (v >= limit) v = this.u32();
      return lo + (v % range);
    },

    /** Float em [a, b). */
    float: function (a, b) {
      return a + this.next() * (b - a);
    },

    /** Elemento aleatório do array; `undefined` se vazio/inválido. */
    pick: function (arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[this.int(0, arr.length - 1)];
    },

    /**
     * Fisher–Yates in place (varredura do fim para o início).
     * Retorna o PRÓPRIO array (contrato).
     */
    shuffle: function (arr) {
      if (!arr) return arr;
      for (var i = arr.length - 1; i > 0; i--) {
        var j = this.int(0, i);
        if (j !== i) {
          var tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
      }
      return arr;
    },

    /**
     * `true` com probabilidade p (0..1).
     * Consome exatamente um u32 sempre — inclusive para p=0 e p=1 — para que a
     * sequência não dependa do valor de p (determinismo estável a refactor).
     * next() ∈ [0,1): chance(0) é sempre false, chance(1) é sempre true.
     */
    chance: function (p) {
      return this.next() < p;
    },

    /**
     * Sub-stream derivado e independente.
     *
     * Semente do filho = hash32(tag) ^ estado atual do pai (antes de avançar).
     * O pai avança EXATAMENTE um u32(), independentemente de quanto o filho for
     * usado depois — é isso que torna `fork` reprodutível: consumir o filho
     * nunca perturba a sequência do pai.
     *
     * Tags distintas a partir do mesmo estado produzem streams distintos
     * (hash32 espalha o tag por todos os 32 bits antes do XOR).
     */
    fork: function (tag) {
      var seed = (R.hash32(tag) ^ this.s) >>> 0;
      this.u32();                              // avanço fixo do pai
      return R.makeRNG(seed);
    }
  };

  /**
   * Cria um RNG mulberry32 com estado uint32 exposto em `rng.s`.
   * Para snapshot/save basta guardar `rng.s`; para restaurar,
   * `R.makeRNG(saved.s)` reproduz a sequência exatamente.
   */
  R.makeRNG = function (seedUint32) {
    var rng = Object.create(rngProto);
    rng.s = (seedUint32 === null || seedUint32 === undefined ? 0 : seedUint32) >>> 0;
    return rng;
  };

  /* ------------------------------------------------------------------ *
   * 4. Helpers de grade e geometria
   * ------------------------------------------------------------------ */

  /** Índice linear de (x, y) numa grade de largura w. */
  R.idx = function (w, x, y) {
    return y * w + x;
  };

  /**
   * ORDEM FIXA — NUNCA REORDENE.
   * Toda desempate determinístico do jogo (bestStep do Dijkstra, escolha de
   * tile alternativo na IA) depende desta ordem exata. Reordenar muda o
   * resultado de partidas salvas.
   * Sentido: leste, sudeste, sul, sudoeste, oeste, noroeste, norte, nordeste.
   */
  R.DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  /** Vizinhança ortogonal (usada pelo BFS de conectividade). Ordem também fixa. */
  R.DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  /** Distância de Chebyshev (movimento em 8 direções com custo uniforme). */
  R.cheb = function (ax, ay, bx, by) {
    var dx = ax - bx; if (dx < 0) dx = -dx;
    var dy = ay - by; if (dy < 0) dy = -dy;
    return dx > dy ? dx : dy;
  };

  /** Distância euclidiana (usada no raio circular do FOV e na iluminação). */
  R.euclid = function (ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return sqrt(dx * dx + dy * dy);
  };

  /** Prende v ao intervalo [lo, hi]. */
  R.clamp = function (v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  };

  /** Interpolação linear. Usada só em animação/câmera — nunca na lógica. */
  R.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  /* ------------------------------------------------------------------ *
   * 5. Sementes
   * ------------------------------------------------------------------ */

  // Alfabeto sem caracteres ambíguos: sem 0 e O, sem 1 e I.
  // Dígitos 2-9 (8) + letras A-Z menos I e O (24) = exatamente 32 símbolos,
  // então `byte & 31` é uniforme e sem viés de módulo.
  var SEED_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  var SEED_GROUP = 4;
  var SEED_GROUPS = 2;
  var SEED_LEN = SEED_GROUP * SEED_GROUPS;

  // Contador de fallback: só é usado se crypto.getRandomValues não existir
  // (ambiente exótico). Não recorremos ao gerador nativo nem ao relógio.
  var seedFallbackCounter = 0;

  function randomBytes(n) {
    var out = new Uint8Array(n);
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto)
      ? globalThis.crypto
      : (typeof crypto !== 'undefined' ? crypto : null);
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(out);
      return out;
    }
    // Fallback determinístico-por-contador. Mantém a promessa "nunca lança"
    // sem recorrer ao gerador nativo. Degrada a entropia, não o determinismo.
    seedFallbackCounter = (seedFallbackCounter + 1) >>> 0;
    var rng = R.makeRNG(R.hash32('isorogue#fallback#' + seedFallbackCounter));
    for (var i = 0; i < n; i++) out[i] = rng.u32() & 255;
    return out;
  }

  /**
   * Gera uma semente nova no formato 'XXXX-XXXX' (ex.: 'K7QX-3M9P').
   * ÚNICO ponto de entropia real do projeto inteiro.
   */
  R.newSeedString = function () {
    var bytes = randomBytes(SEED_LEN);
    var out = '';
    for (var i = 0; i < SEED_LEN; i++) {
      if (i > 0 && i % SEED_GROUP === 0) out += '-';
      out += SEED_ALPHABET.charAt(bytes[i] & 31);
    }
    return out;
  };

  /**
   * Normaliza uma semente digitada pelo usuário:
   * trim, maiúsculas, espaços internos colapsados para um único espaço.
   * Entrada vazia (ou nula) devolve uma semente nova de R.newSeedString().
   *
   * A normalização é a fronteira do determinismo: 'k7qx-3m9p' e ' K7QX-3M9P '
   * devem gerar o mesmo mundo.
   */
  R.normalizeSeed = function (str) {
    var s = (str === null || str === undefined) ? '' : String(str);
    s = s.replace(/\s+/g, ' ').trim().toUpperCase();
    if (s === '') return R.newSeedString();
    return s;
  };

})(window.R = window.R || {});
