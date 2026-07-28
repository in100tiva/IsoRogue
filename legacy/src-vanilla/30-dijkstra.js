(function (R) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Dijkstra / mapa de fluxo (R34, R35, R36, R41)
  //
  // Um ÚNICO mapa por turno, recalculado a partir do jogador. A* individual é
  // proibido: toda a IA lê este mesmo campo escalar.
  //
  // INVARIANTES TESTADAS PELO HARNESS (T8):
  //   1. O tile do jogador (fonte com v = 0) vale 0.
  //   2. Todo tile caminhável alcançável a partir das fontes tem valor finito
  //      (< INF); tiles de parede e tiles caminháveis ilhados permanecem INF.
  //   3. Dois tiles vizinhos diferem no máximo 1 — considerando as transições
  //      REALMENTE permitidas, isto é, as 8 direções sem corte de canto: a
  //      diagonal (dx,dy) só existe se (dx,0) e (0,dy) também forem caminháveis.
  //      Vizinhos diagonais separados por um "pinçamento" de paredes não são
  //      vizinhos do grafo e podem diferir de mais de 1 legitimamente.
  // ---------------------------------------------------------------------------

  var INF = 99999;
  var DEFAULT_FLEE_FACTOR = -1.2;
  var MAX_SCAN_PASSES = 256; // teto de segurança do re-scan iterativo (Brogue)

  var DIRS8_FALLBACK = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];

  // Buffers reaproveitados. As chaves são os objetos `map`, de modo que dois
  // estados de jogo vivos ao mesmo tempo (harness comparando duas partidas)
  // nunca compartilhem o mesmo Int32Array.
  var computeCache = new WeakMap();
  var fleeCache = new WeakMap();
  // Int32Array -> { w, h, map }: permite que bestStep()/flee() conheçam as
  // dimensões do campo sem receber o mapa na assinatura pública.
  var metaOf = new WeakMap();

  var queueBuf = null; // fila circular (Int32Array)
  var markBuf = null;  // flag "já está na fila" (Uint8Array)
  var passBuf = null;  // passabilidade pré-computada para o re-scan (Uint8Array)

  // --- helpers ---------------------------------------------------------------

  function dirs8() {
    return (R && R.DIRS8) ? R.DIRS8 : DIRS8_FALLBACK;
  }

  function grabField(cache, key, n) {
    var buf = key ? cache.get(key) : null;
    if (!buf || buf.length !== n) {
      buf = new Int32Array(n);
      if (key) { cache.set(key, buf); }
    }
    return buf;
  }

  function ensureQueue(n) {
    if (!queueBuf || queueBuf.length < n) { queueBuf = new Int32Array(n); }
    return queueBuf;
  }

  function ensureMark(n) {
    if (!markBuf || markBuf.length < n) { markBuf = new Uint8Array(n); }
    return markBuf;
  }

  function ensurePass(n) {
    if (!passBuf || passBuf.length < n) { passBuf = new Uint8Array(n); }
    return passBuf;
  }

  // Caminhável = FLOOR, DOOR ou STAIRS dentro dos limites. Usa R.MapGen quando
  // disponível (fonte da verdade); o fallback existe só para o módulo poder ser
  // carregado isolado em teste.
  function walkable(map, x, y) {
    if (!map) { return true; }
    if (R.MapGen && typeof R.MapGen.isWalkable === 'function') {
      return !!R.MapGen.isWalkable(map, x, y);
    }
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) { return false; }
    var wall = (R.C && R.C.TILE) ? R.C.TILE.WALL : 0;
    return map.tiles[y * map.w + x] !== wall;
  }

  function fieldDims(field, map) {
    if (map && map.w && map.h) { return { w: map.w, h: map.h, map: map }; }
    var mt = metaOf.get(field);
    if (mt) { return { w: mt.w, h: mt.h, map: mt.map }; }
    if (R.C && R.C.MAP_W && R.C.MAP_H && field && field.length === R.C.MAP_W * R.C.MAP_H) {
      return { w: R.C.MAP_W, h: R.C.MAP_H, map: null };
    }
    return null;
  }

  function isFiniteVal(v) {
    return v < INF && v > -INF;
  }

  // --- compute ---------------------------------------------------------------

  /**
   * Mapa de Dijkstra com custo uniforme 1 em 8 direções, sem corte de canto.
   *
   * @param {Object} map   mapa de R.MapGen.generate
   * @param {Array}  sources [{ x, y, v }] — `v` padrão 0
   * @param {Object} opts  { blocked: Set<Number>|null,   índices intransponíveis
   *                         out: Int32Array|null,        buffer do chamador
   *                         reuse: Boolean }             false => aloca novo
   * @returns {Int32Array} campo de tamanho w*h, INF onde inalcançável
   */
  function compute(map, sources, opts) {
    var w = map.w, h = map.h, n = w * h;
    var options = opts || {};
    var blocked = options.blocked || null;
    var D = dirs8();

    var dist = options.out;
    if (!dist || dist.length !== n) {
      dist = (options.reuse === false) ? new Int32Array(n) : grabField(computeCache, map, n);
    }
    dist.fill(INF);

    // Fila circular: com a flag `mark` cada índice está no máximo uma vez na
    // fila, então n + 1 posições bastam e nunca há estouro.
    var cap = n + 1;
    var q = ensureQueue(cap);
    var mark = ensureMark(n);
    mark.fill(0, 0, n);
    var head = 0, tail = 0;

    var i, s, sx, sy, sv, si;
    if (sources) {
      for (i = 0; i < sources.length; i++) {
        s = sources[i];
        if (!s) { continue; }
        sx = s.x | 0;
        sy = s.y | 0;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) { continue; }
        sv = (s.v === undefined || s.v === null) ? 0 : (s.v | 0);
        si = sy * w + sx;
        if (sv < dist[si]) {
          dist[si] = sv;
          if (!mark[si]) {
            mark[si] = 1;
            q[tail] = si;
            tail = (tail + 1) % cap;
          }
        }
      }
    }

    var guard = 0;
    var maxOps = n * 16 + 64; // rede de segurança: BFS uniforme visita n vezes
    var ci, cv, cx, cy, nd, d, dx, dy, nx, ny, ni;

    while (head !== tail && guard++ < maxOps) {
      ci = q[head];
      head = (head + 1) % cap;
      mark[ci] = 0;
      cv = dist[ci];
      if (cv >= INF) { continue; }
      cx = ci % w;
      cy = (ci - cx) / w;
      nd = cv + 1;

      for (d = 0; d < D.length; d++) {
        dx = D[d][0];
        dy = D[d][1];
        nx = cx + dx;
        ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
        ni = ny * w + nx;
        if (nd >= dist[ni]) { continue; }
        if (!walkable(map, nx, ny)) { continue; }
        if (blocked && blocked.has(ni)) { continue; }
        // sem corte de canto: a diagonal exige os dois ortogonais caminháveis
        if (dx !== 0 && dy !== 0) {
          if (!walkable(map, cx + dx, cy)) { continue; }
          if (!walkable(map, cx, cy + dy)) { continue; }
        }
        dist[ni] = nd;
        if (!mark[ni]) {
          mark[ni] = 1;
          q[tail] = ni;
          tail = (tail + 1) % cap;
        }
      }
    }

    metaOf.set(dist, { w: w, h: h, map: map });
    return dist;
  }

  // --- scan (reaproveitado pelo flee) ----------------------------------------

  /**
   * Re-scan iterativo clássico do Brogue: passadas sobre o campo inteiro
   * (ida e volta) relaxando `dist[vizinho] = dist[celula] + 1` até que nenhuma
   * passada mude nada, com teto de iterações para não travar.
   *
   * Opera IN PLACE. Só escreve em tiles passáveis; INF permanece INF onde não
   * há caminho. Reaproveitável por qualquer campo escalar (não só o flee).
   *
   * @param {Int32Array} dist campo a estabilizar
   * @param {Object} map      mapa (pode ser null se `dist` veio de compute/flee)
   * @param {Object} opts     { blocked: Set|null, maxPasses: Number }
   * @returns {Number} quantidade de passadas executadas
   */
  function scan(dist, map, opts) {
    var options = opts || {};
    var dims = fieldDims(dist, map);
    if (!dims) { return 0; }
    var w = dims.w, h = dims.h, n = w * h;
    var src = dims.map;
    var blocked = options.blocked || null;
    var maxPasses = (options.maxPasses > 0) ? (options.maxPasses | 0) : MAX_SCAN_PASSES;
    var D = dirs8();

    // Passabilidade pré-computada: evita milhares de chamadas por passada.
    var pass = ensurePass(n);
    var i, x, y;
    for (i = 0; i < n; i++) {
      x = i % w;
      y = (i - x) / w;
      if (src) {
        pass[i] = (walkable(src, x, y) && !(blocked && blocked.has(i))) ? 1 : 0;
      } else {
        pass[i] = (isFiniteVal(dist[i]) && !(blocked && blocked.has(i))) ? 1 : 0;
      }
    }

    var passes = 0;
    var changed = true;
    var cv, nd, d, dx, dy, nx, ny, ni;

    while (changed && passes < maxPasses) {
      changed = false;
      passes++;

      for (i = 0; i < n; i++) {
        cv = dist[i];
        if (cv >= INF) { continue; }
        x = i % w;
        y = (i - x) / w;
        nd = cv + 1;
        for (d = 0; d < D.length; d++) {
          dx = D[d][0];
          dy = D[d][1];
          nx = x + dx;
          ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
          ni = ny * w + nx;
          if (!pass[ni] || nd >= dist[ni]) { continue; }
          if (dx !== 0 && dy !== 0) {
            if (!pass[y * w + (x + dx)] || !pass[(y + dy) * w + x]) { continue; }
          }
          dist[ni] = nd;
          changed = true;
        }
      }

      for (i = n - 1; i >= 0; i--) {
        cv = dist[i];
        if (cv >= INF) { continue; }
        x = i % w;
        y = (i - x) / w;
        nd = cv + 1;
        for (d = 0; d < D.length; d++) {
          dx = D[d][0];
          dy = D[d][1];
          nx = x + dx;
          ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
          ni = ny * w + nx;
          if (!pass[ni] || nd >= dist[ni]) { continue; }
          if (dx !== 0 && dy !== 0) {
            if (!pass[y * w + (x + dx)] || !pass[(y + dy) * w + x]) { continue; }
          }
          dist[ni] = nd;
          changed = true;
        }
      }
    }

    return passes;
  }

  // --- flee ------------------------------------------------------------------

  /**
   * Gradiente de fuga (R36). Multiplica os valores FINITOS por `factor`
   * (padrão -1.2) e re-escaneia até estabilizar. O resultado é um campo cujos
   * mínimos locais ficam LONGE do jogador: descer por ele = fugir.
   *
   * `Math.round` é usado na multiplicação porque o campo é inteiro; como
   * |factor| > 1, o arredondamento preserva a monotonicidade do gradiente.
   *
   * @param {Int32Array} dmap  campo vindo de compute()
   * @param {Object} map       mapa (opcional se `dmap` veio de compute())
   * @param {Number} factor    padrão -1.2
   * @returns {Int32Array} novo campo (buffer próprio, nunca alias de `dmap`)
   */
  function flee(dmap, map, factor) {
    var dims = fieldDims(dmap, map);
    if (!dims) { return dmap; }
    var w = dims.w, h = dims.h, n = w * h;
    var src = dims.map;
    var f = (typeof factor === 'number' && isFinite(factor)) ? factor : DEFAULT_FLEE_FACTOR;

    var out = grabField(fleeCache, src, n);
    if (out === dmap) { out = new Int32Array(n); }

    var i, v;
    for (i = 0; i < n; i++) {
      v = dmap[i];
      out[i] = isFiniteVal(v) ? Math.round(v * f) : INF;
    }

    metaOf.set(out, { w: w, h: h, map: src });
    scan(out, src, null);
    return out;
  }

  // --- bestStep --------------------------------------------------------------

  /**
   * Melhor passo descendente a partir de (x, y).
   *
   * Empate resolvido pela ORDEM DE R.DIRS8 — o primeiro da ordem vence (a
   * comparação é estritamente menor, então um empate nunca substitui o
   * candidato anterior). Determinismo obrigatório (R41).
   *
   * @param {Int32Array} dmap  campo de compute() ou flee()
   * @param {Number} x
   * @param {Number} y
   * @param {Function} isBlockedFn chamada como (nx, ny, ni); truthy = proibido
   * @returns {{x:Number,y:Number,v:Number}|null} null se nenhum vizinho válido
   *          for ESTRITAMENTE melhor que o tile atual
   */
  function bestStep(dmap, x, y, isBlockedFn) {
    var dims = fieldDims(dmap, null);
    if (!dims) { return null; }
    var w = dims.w, h = dims.h;
    var map = dims.map;
    if (x < 0 || y < 0 || x >= w || y >= h) { return null; }

    var D = dirs8();
    var ci = y * w + x;
    var bestV = dmap[ci];
    var best = null;
    var d, dx, dy, nx, ny, ni, nv;

    for (d = 0; d < D.length; d++) {
      dx = D[d][0];
      dy = D[d][1];
      nx = x + dx;
      ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
      ni = ny * w + nx;
      nv = dmap[ni];
      if (nv >= INF) { continue; }
      if (!(nv < bestV)) { continue; } // estrito: primeiro da ordem DIRS8 vence
      if (map && !walkable(map, nx, ny)) { continue; }
      if (dx !== 0 && dy !== 0) {
        if (map) {
          if (!walkable(map, x + dx, y)) { continue; }
          if (!walkable(map, x, y + dy)) { continue; }
        } else {
          if (dmap[y * w + (x + dx)] >= INF) { continue; }
          if (dmap[(y + dy) * w + x] >= INF) { continue; }
        }
      }
      if (isBlockedFn && isBlockedFn(nx, ny, ni)) { continue; }
      best = { x: nx, y: ny, v: nv };
      bestV = nv;
    }

    return best;
  }

  // --- extras utilitários ----------------------------------------------------

  function valueAt(dmap, x, y) {
    var dims = fieldDims(dmap, null);
    if (!dims) { return INF; }
    if (x < 0 || y < 0 || x >= dims.w || y >= dims.h) { return INF; }
    return dmap[y * dims.w + x];
  }

  function dimsOf(dmap) {
    var dims = fieldDims(dmap, null);
    return dims ? { w: dims.w, h: dims.h } : null;
  }

  R.Dijkstra = {
    INF: INF,
    FLEE_FACTOR: DEFAULT_FLEE_FACTOR,
    compute: compute,
    scan: scan,
    flee: flee,
    bestStep: bestStep,
    valueAt: valueAt,
    dimsOf: dimsOf
  };

})(window.R = window.R || {});
