/* ISOROGUE — src/50-render.js
 * Renderização isométrica em Canvas 2D puro.
 * Cobre R01..R11, R29, R30, R31, R50, R54 e a §8/§12 do contrato.
 *
 * Invariantes deste módulo:
 *  - Nenhum acesso a DOM fora de init()/resize()/handlers ligados por init().
 *  - update(game, dt) só escreve em R.Render.cam e em campos puramente visuais
 *    (offsets internos de animação, ent.bump). Nunca em posição, hp ou turno (R54).
 *  - Zero aleatoriedade e zero alocação de objetos no laço quente (LUTs prontas).
 */
(function (R) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ *
   * Paleta (§12 do contrato)
   * ------------------------------------------------------------------ */
  var COL_BG = '#0d1014';
  var RGB_FLOOR = [58, 66, 80];      // #3a4250
  var RGB_WALL = [82, 93, 110];      // #525d6e
  var RGB_AMBER = [224, 164, 60];    // #e0a43c
  var RGB_GREEN = [95, 179, 106];    // #5fb36a
  var RGB_RED = [217, 83, 79];       // #d9534f
  var RGB_BLUE = [74, 144, 217];     // #4a90d9
  var RGB_PURPLE = [176, 111, 208];  // #b06fd0
  var RGB_CYAN = [63, 208, 216];     // #3fd0d8
  var RGB_MAGENTA = [224, 79, 160];  // #e04fa0
  var RGB_WEAK = [125, 136, 153];    // #7d8899
  var RGB_TEXT = [201, 211, 222];    // #c9d3de
  var RGB_PLAYER = [219, 228, 239];
  var RGB_COLD = [26, 34, 47];       // névoa fria
  var RGB_WARM = [255, 198, 120];    // luz âmbar quente
  var RGB_WHITE = [255, 255, 255];

  var COL_EDGE_LIT = 'rgba(255,255,255,0.070)';
  var COL_EDGE_DIM = 'rgba(255,255,255,0.028)';
  var COL_WALL_EDGE_LIT = 'rgba(255,255,255,0.085)';
  var COL_WALL_EDGE_DIM = 'rgba(255,255,255,0.030)';
  var COL_SHADOW_ENT = 'rgba(5,7,11,0.42)';
  var COL_SHADOW_WALL = 'rgba(6,8,12,0.34)';
  var COL_SHADOW_WALL_DIM = 'rgba(6,8,12,0.18)';
  var COL_HOVER_FILL = 'rgba(224,164,60,0.10)';
  var COL_HOVER_LINE = '#e0a43c';
  var COL_HPBAR_BG = 'rgba(8,10,14,0.78)';
  var COL_GRID = 'rgba(201,211,222,0.10)';
  var COL_PROBE = 'rgba(63,208,216,0.22)';
  var COL_PROBE_LINE = 'rgba(63,208,216,0.55)';
  var COL_BROKEN = 'rgba(224,79,160,0.34)';
  var COL_BROKEN_LINE = '#e04fa0';
  var FONT_MONO = '10px ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace';

  /* ------------------------------------------------------------------ *
   * Helpers de cor (usados só na construção das LUTs)
   * ------------------------------------------------------------------ */
  function mul(c, f) {
    return [c[0] * f, c[1] * f, c[2] * f];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function desat(c, t) {
    var l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    return mix(c, [l, l, l], t);
  }
  function ch(v) {
    v = Math.round(v);
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v;
  }
  function rgbStr(c) {
    return 'rgb(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ')';
  }
  function rgbaStr(c, a) {
    return 'rgba(' + ch(c[0]) + ',' + ch(c[1]) + ',' + ch(c[2]) + ',' + (Math.round(a * 1000) / 1000) + ')';
  }

  /* ------------------------------------------------------------------ *
   * Constantes do contrato (lidas de R.C na primeira inicialização)
   * ------------------------------------------------------------------ */
  var TW = 64, TH = 32, HW0 = 32, HH0 = 16, WALL_H = 36, FOV_R = 9;
  var ZMIN = 0.45, ZMAX = 2.4;
  var T_WALL = 0, T_FLOOR = 1, T_DOOR = 2, T_STAIRS = 3;

  function readConstants() {
    var C = R.C || {};
    TW = C.TW || 64;
    TH = C.TH || 32;
    WALL_H = C.WALL_H || 36;
    FOV_R = C.FOV_RADIUS || 9;
    ZMIN = typeof C.ZOOM_MIN === 'number' ? C.ZOOM_MIN : 0.45;
    ZMAX = typeof C.ZOOM_MAX === 'number' ? C.ZOOM_MAX : 2.4;
    HW0 = TW / 2;
    HH0 = TH / 2;
    var t = C.TILE || {};
    T_WALL = typeof t.WALL === 'number' ? t.WALL : 0;
    T_FLOOR = typeof t.FLOOR === 'number' ? t.FLOOR : 1;
    T_DOOR = typeof t.DOOR === 'number' ? t.DOOR : 2;
    T_STAIRS = typeof t.STAIRS === 'number' ? t.STAIRS : 3;
  }

  /* ------------------------------------------------------------------ *
   * LUTs
   * ------------------------------------------------------------------ */
  var LUT_READY = false;
  var LEVELS = 17;          // 0..16 níveis de luz
  var DEC_B = 8;            // baldes de variação vinda de map.decor
  var LIGHT_LEVEL = null;   // d2 (inteiro) -> nível 0..16
  var FLOOR_LIT = null;     // [ladrilho][balde][nível]
  var FLOOR_DIM = null;     // [ladrilho][balde]
  var WALL_LIT = null;      // [face][balde][nível]  face: 0 topo, 1 esquerda, 2 direita
  var WALL_DIM = null;      // [face][balde]
  var SHADES = null;        // por arquétipo: { main[], dark[], light[] }
  var HP_COL = null;        // [0..16] vermelho -> verde
  var FLASH_COL = null;     // [0..16] clarão branco quente
  var DMAP_COL = null;      // cor do número de Dijkstra por magnitude
  var NUMSTR = null;        // strings '0'..'999' (evita alocar no laço de debug)

  function decorFactor(b) {
    // variação sutil de luminosidade de ±6% derivada de map.decor
    return 0.94 + (b / (DEC_B - 1)) * 0.12;
  }

  function litColor(base, level) {
    var b = level / (LEVELS - 1);
    var c = mul(base, 0.32 + 0.68 * b);
    c = mix(c, RGB_COLD, 0.34 * (1 - b));
    c = mix(c, RGB_WARM, 0.20 * b * b);
    return c;
  }

  function dimColor(base) {
    // explorado fora do FOV: estrutura estática dessaturada e escura (R30)
    var c = mul(desat(base, 0.58), 0.40);
    return mix(c, RGB_COLD, 0.45);
  }

  function litEntity(base, level) {
    var b = level / (LEVELS - 1);
    var c = mul(base, 0.50 + 0.50 * b);
    return mix(c, RGB_WARM, 0.12 * b);
  }

  function buildShades(base) {
    var main = [], dark = [], light = [];
    for (var l = 0; l < LEVELS; l++) {
      var c = litEntity(base, l);
      main.push(rgbStr(c));
      dark.push(rgbStr(mul(c, 0.60)));
      light.push(rgbStr(mix(c, RGB_WHITE, 0.38)));
    }
    return { main: main, dark: dark, light: light };
  }

  function buildLUTs() {
    var b, l, v, f;

    // luz radial quente: 1 - (d / raio)^1.6
    var maxD2 = (FOV_R + 2) * (FOV_R + 2) + 2;
    LIGHT_LEVEL = new Uint8Array(maxD2);
    for (var d2 = 0; d2 < maxD2; d2++) {
      var d = Math.sqrt(d2);
      var br = 1 - Math.pow(d / FOV_R, 1.6);
      if (br < 0) br = 0;
      if (br > 1) br = 1;
      LIGHT_LEVEL[d2] = Math.round(br * (LEVELS - 1));
    }

    FLOOR_LIT = [];
    FLOOR_DIM = [];
    for (v = 0; v < 2; v++) {
      var litRow = [], dimRow = [];
      for (b = 0; b < DEC_B; b++) {
        var fbase = mul(RGB_FLOOR, decorFactor(b) * (v ? 0.955 : 1));
        var lv = [];
        for (l = 0; l < LEVELS; l++) lv.push(rgbStr(litColor(fbase, l)));
        litRow.push(lv);
        dimRow.push(rgbStr(dimColor(fbase)));
      }
      FLOOR_LIT.push(litRow);
      FLOOR_DIM.push(dimRow);
    }

    // faces do prisma: esquerda 18% mais escura, direita 32% mais escura
    var faceF = [1, 0.82, 0.68];
    WALL_LIT = [];
    WALL_DIM = [];
    for (f = 0; f < 3; f++) {
      var wl = [], wd = [];
      for (b = 0; b < DEC_B; b++) {
        var wbase = mul(RGB_WALL, decorFactor(b) * faceF[f]);
        var wv = [];
        for (l = 0; l < LEVELS; l++) wv.push(rgbStr(litColor(wbase, l)));
        wl.push(wv);
        wd.push(rgbStr(dimColor(wbase)));
      }
      WALL_LIT.push(wl);
      WALL_DIM.push(wd);
    }

    SHADES = {
      player: buildShades(RGB_PLAYER),
      chaser: buildShades(RGB_RED),
      sentinel: buildShades(RGB_BLUE),
      linker: buildShades(RGB_PURPLE),
      potion: buildShades(RGB_GREEN),
      amber: buildShades(RGB_AMBER),
      stone: buildShades(RGB_WALL)
    };

    HP_COL = [];
    FLASH_COL = [];
    for (l = 0; l < LEVELS; l++) {
      var t = l / (LEVELS - 1);
      HP_COL.push(rgbStr(mix(RGB_RED, RGB_GREEN, t)));
      FLASH_COL.push(rgbaStr([255, 236, 222], 0.80 * t));
    }

    DMAP_COL = [
      rgbStr(RGB_AMBER),
      rgbStr(mix(RGB_AMBER, RGB_GREEN, 0.5)),
      rgbStr(RGB_GREEN),
      rgbStr(mix(RGB_GREEN, RGB_BLUE, 0.5)),
      rgbStr(RGB_BLUE),
      rgbStr(mix(RGB_BLUE, RGB_WEAK, 0.5)),
      rgbStr(RGB_WEAK),
      rgbStr(mul(RGB_WEAK, 0.72))
    ];

    NUMSTR = new Array(1000);
    for (var n = 0; n < 1000; n++) NUMSTR[n] = String(n);
  }

  function ensureLUTs() {
    if (LUT_READY) return;
    readConstants();
    buildLUTs();
    LUT_READY = true;
  }

  /* ------------------------------------------------------------------ *
   * Estado interno do renderizador
   * ------------------------------------------------------------------ */
  var EMPTY_SET = new Set();

  var S = {
    canvas: null,
    ctx: null,
    vw: 960,
    vh: 600,
    dpr: 1,
    t: 0,          // relógio puramente visual (só animação)
    fps: 0,
    lastMap: null,
    entAt: null,
    itemAt: null,
    vfx: null,
    bound: false
  };

  var cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1 };

  // temporários de módulo (evitam alocação por frame)
  var ISO_X = 0, ISO_Y = 0;

  function isoCenter(x, y) {
    ISO_X = (x - y) * HW0;
    ISO_Y = (x + y) * HH0 + HH0;
  }

  function vfxOf(key, x, y, hp) {
    var v = S.vfx[key];
    if (!v) {
      v = { x: x, y: y, ox: 0, oy: 0, hp: hp, flash: 0, bump: 0 };
      S.vfx[key] = v;
    }
    return v;
  }

  /* ------------------------------------------------------------------ *
   * init / resize
   * ------------------------------------------------------------------ */
  function init(canvas) {
    ensureLUTs();
    if (!canvas || typeof canvas.getContext !== 'function') return;
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    S.vfx = Object.create(null);
    resize();
    if (S.bound) return;
    S.bound = true;
    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('wheel', onWheel, { passive: false });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', resize);
    }
  }

  function onWheel(ev) {
    if (!ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    var d = ev.deltaY;
    if (typeof d !== 'number' || d === 0) return;
    setZoom(cam.tzoom * (d > 0 ? 0.88 : 1 / 0.88));
  }

  function resize() {
    var cv = S.canvas;
    if (!cv) return;
    var dpr = 1;
    if (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') {
      dpr = window.devicePixelRatio;
    }
    if (!(dpr > 0)) dpr = 1;
    if (dpr > 3) dpr = 3;

    var w = 0, h = 0;
    var host = cv.parentNode;
    if (host) {
      if (typeof host.clientWidth === 'number') w = host.clientWidth;
      if (typeof host.clientHeight === 'number') h = host.clientHeight;
    }
    if ((!w || !h) && typeof cv.getBoundingClientRect === 'function') {
      var r = cv.getBoundingClientRect();
      if (r) {
        if (!w && r.width) w = Math.round(r.width);
        if (!h && r.height) h = Math.round(r.height);
      }
    }
    if (!w) w = 960;
    if (!h) h = 600;

    S.vw = w;
    S.vh = h;
    S.dpr = dpr;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    if (cv.style) {
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }
    if (S.ctx && typeof S.ctx.setTransform === 'function') {
      S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* ------------------------------------------------------------------ *
   * Projeção e inversa (§8)
   *   isoX = (x - y) * TW/2          screenX = (isoX - cam.x) * zoom + vw/2
   *   isoY = (x + y) * TH/2          screenY = (isoY - cam.y) * zoom + vh/2
   * tileToScreen devolve o canto NORTE do losango (a projeção literal do
   * contrato); screenToTile é a inversa exata dela — o round-trip de um canto
   * volta ao mesmo tile e o centro do losango cai no tile certo.
   * ------------------------------------------------------------------ */
  function tileToScreen(game, x, y) {
    ensureLUTs();
    var isoX = (x - y) * HW0;
    var isoY = (x + y) * HH0;
    return {
      sx: (isoX - cam.x) * cam.zoom + S.vw / 2,
      sy: (isoY - cam.y) * cam.zoom + S.vh / 2
    };
  }

  function screenToTile(game, sx, sy) {
    ensureLUTs();
    var isoX = (sx - S.vw / 2) / cam.zoom + cam.x;
    var isoY = (sy - S.vh / 2) / cam.zoom + cam.y;
    var fx = isoX / TW + isoY / TH;
    var fy = isoY / TH - isoX / TW;
    return { x: Math.floor(fx), y: Math.floor(fy) };
  }

  function setZoom(z) {
    ensureLUTs();
    if (typeof z !== 'number' || !isFinite(z)) return;
    if (z < ZMIN) z = ZMIN;
    if (z > ZMAX) z = ZMAX;
    cam.tzoom = z;
  }

  /* ------------------------------------------------------------------ *
   * update — SOMENTE animação (R54)
   * ------------------------------------------------------------------ */
  function update(game, dt) {
    ensureLUTs();
    if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    S.t += dt;
    if (dt > 0) {
      var inst = 1 / dt;
      var k = dt * 4;
      if (k > 1) k = 1;
      S.fps += (inst - S.fps) * k;
      Render.fps = Math.round(S.fps);
    }
    if (!game || !game.map || !game.player) return;
    syncRun(game);

    var p = game.player;
    if (!game.ui || game.ui.follow !== false) {
      isoCenter(p.x, p.y);
      cam.tx = ISO_X;
      cam.ty = ISO_Y;
    }

    var kc = 1 - Math.pow(0.001, dt);
    cam.x += (cam.tx - cam.x) * kc;
    cam.y += (cam.ty - cam.y) * kc;
    if (Math.abs(cam.tx - cam.x) < 0.02) cam.x = cam.tx;
    if (Math.abs(cam.ty - cam.y) < 0.02) cam.y = cam.ty;

    var kz = 1 - Math.pow(0.0008, dt);
    cam.zoom += (cam.tzoom - cam.zoom) * kz;
    if (Math.abs(cam.tzoom - cam.zoom) < 0.0015) cam.zoom = cam.tzoom;

    var decay = Math.pow(0.0006, dt);
    trackVfx(vfxOf('p', p.x, p.y, p.hp), p.x, p.y, p.hp, dt, decay);

    var en = game.enemies;
    if (en) {
      for (var i = 0; i < en.length; i++) {
        var e = en[i];
        if (!e) continue;
        trackVfx(vfxOf('e' + e.id, e.x, e.y, e.hp), e.x, e.y, e.hp, dt, decay);
        // ent.bump é campo puramente visual do contrato: só decai aqui
        if (typeof e.bump === 'number' && e.bump > 0) {
          e.bump -= dt * 3.4;
          if (e.bump < 0) e.bump = 0;
        }
      }
    }
  }

  function trackVfx(v, x, y, hp, dt, decay) {
    if (v.x !== x || v.y !== y) {
      isoCenter(v.x, v.y);
      var ax = ISO_X, ay = ISO_Y;
      isoCenter(x, y);
      v.ox += ax - ISO_X;
      v.oy += ay - ISO_Y;
      v.x = x;
      v.y = y;
      v.bump = 1;
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

  function syncRun(game) {
    if (S.lastMap === game.map) return;
    S.lastMap = game.map;
    S.vfx = Object.create(null);
    var p = game.player;
    if (p) {
      isoCenter(p.x, p.y);
      cam.x = cam.tx = ISO_X;
      cam.y = cam.ty = ISO_Y;
    }
  }

  /* ------------------------------------------------------------------ *
   * Geometria de desenho
   * ------------------------------------------------------------------ */
  function pathDiamond(ctx, sx, sy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.lineTo(sx, sy + hh + hh);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.closePath();
  }

  function fillEllipse(ctx, cx, cy, rx, ry, color) {
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

  function fillCircle(ctx, cx, cy, r, color) {
    if (r <= 0) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
  }

  /* ------------------------------------------------------------------ *
   * draw
   * ------------------------------------------------------------------ */
  function draw(game) {
    ensureLUTs();
    var ctx = S.ctx;
    if (!ctx) return;
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, S.vw, S.vh);
    if (!game || !game.map || !game.player) return;

    syncRun(game);
    indexEntities(game);

    var map = game.map;
    var w = map.w, h = map.h;
    var tiles = map.tiles;
    var decor = map.decor || null;
    var vis = (game.visible && typeof game.visible.has === 'function') ? game.visible : EMPTY_SET;
    var expl = game.explored || null;
    var p = game.player;

    var z = cam.zoom;
    var hw = HW0 * z, hh = HH0 * z, wh = WALL_H * z;
    var ox = S.vw / 2 - cam.x * z;
    var oy = S.vh / 2 - cam.y * z;
    var sMax = (w - 1) + (h - 1);
    var padX = TW * z + 8;
    var lightMax = LIGHT_LEVEL.length;

    for (var s = 0; s <= sMax; s++) {
      var sy = s * hh + oy;
      if (sy + hh + hh < -48 * z || sy - wh - 48 * z > S.vh) continue;

      var lo = s - (h - 1);
      if (lo < 0) lo = 0;
      var hi = s;
      if (hi > w - 1) hi = w - 1;

      // recorte horizontal: sx = hw*(2x - s) + ox
      var xa = Math.floor((s + (-padX - ox) / hw) / 2) - 1;
      var xb = Math.ceil((s + (S.vw + padX - ox) / hw) / 2) + 1;
      if (xa > lo) lo = xa;
      if (xb < hi) hi = xb;
      if (lo > hi) continue;

      var x, y, i, t, sx, seen, known, lvl, dx, dy, d2, bucket, alt;

      /* --- pisos da antidiagonal --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        t = tiles[i];
        if (t === T_WALL) continue;
        seen = vis.has(i);
        known = seen || (expl ? expl[i] !== 0 : false);
        if (!known) continue;            // nunca visto: nada é desenhado (R29)
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x; dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = seen ? (d2 < lightMax ? LIGHT_LEVEL[d2] : 0) : 0;
        bucket = decor ? (decor[i] & 7) : 0;
        alt = (((x >> 2) + (y >> 2)) & 1);
        drawFloor(ctx, sx, sy, hw, hh, bucket, alt, seen, lvl);
        if (x > 0 && y > 0 && tiles[i - w - 1] === T_WALL) {
          drawWallShadow(ctx, sx, sy, hw, hh, seen);
        }
        if (t === T_STAIRS) drawStairs(ctx, sx, sy, hw, hh, seen, lvl);
        else if (t === T_DOOR) drawDoor(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
      }

      /* --- paredes da antidiagonal (ocultam quem está atrás) --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        if (tiles[i] !== T_WALL) continue;
        seen = vis.has(i);
        known = seen || (expl ? expl[i] !== 0 : false);
        if (!known) continue;
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x; dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = seen ? (d2 < lightMax ? LIGHT_LEVEL[d2] : 0) : 0;
        bucket = decor ? (decor[i] & 7) : 0;
        drawWall(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl);
      }

      /* --- entidades da antidiagonal (só dentro do FOV — R31) --- */
      for (x = lo; x <= hi; x++) {
        y = s - x;
        i = y * w + x;
        var isPlayer = (p.x === x && p.y === y);
        seen = vis.has(i);
        if (!seen && !isPlayer) continue;
        sx = hw * (2 * x - s) + ox;
        dx = x - p.x; dy = y - p.y;
        d2 = dx * dx + dy * dy;
        lvl = d2 < lightMax ? LIGHT_LEVEL[d2] : 0;
        var cy = sy + hh;
        if (seen && S.itemAt) {
          var ii = S.itemAt[i];
          if (ii >= 0) drawPotion(ctx, game.items[ii], sx, cy, z, lvl, ii);
        }
        if (seen && S.entAt) {
          var ei = S.entAt[i];
          if (ei >= 0) drawEnemy(ctx, game.enemies[ei], sx, cy, z, lvl, p);
        }
        if (isPlayer) drawPlayer(ctx, p, sx, cy, z);
      }
    }

    drawHover(ctx, game, hw, hh, ox, oy);
    if (game.ui && game.ui.debug) drawDebugLayer(ctx, game, hw, hh, ox, oy);
    if (game.ui && game.ui.fovProbe) drawFovProbe(ctx, game, hw, hh, ox, oy);
  }

  function indexEntities(game) {
    var map = game.map;
    var n = map.w * map.h;
    if (!S.entAt || S.entAt.length !== n) {
      S.entAt = new Int32Array(n);
      S.itemAt = new Int32Array(n);
    }
    S.entAt.fill(-1);
    S.itemAt.fill(-1);
    var en = game.enemies, k, e, i;
    if (en) {
      for (k = 0; k < en.length; k++) {
        e = en[k];
        if (!e || e.hp <= 0) continue;
        i = e.y * map.w + e.x;
        if (i >= 0 && i < n) S.entAt[i] = k;
      }
    }
    var it = game.items;
    if (it) {
      for (k = 0; k < it.length; k++) {
        e = it[k];
        if (!e) continue;
        i = e.y * map.w + e.x;
        if (i >= 0 && i < n) S.itemAt[i] = k;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Piso, parede, sombras, escada e porta
   * ------------------------------------------------------------------ */
  function drawFloor(ctx, sx, sy, hw, hh, bucket, alt, seen, lvl) {
    ctx.fillStyle = seen ? FLOOR_LIT[alt][bucket][lvl] : FLOOR_DIM[alt][bucket];
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

  function drawWallShadow(ctx, sx, sy, hw, hh, seen) {
    ctx.fillStyle = seen ? COL_SHADOW_WALL : COL_SHADOW_WALL_DIM;
    pathDiamond(ctx, sx + hw * 0.07, sy + hh * 0.10, hw * 0.86, hh * 0.86);
    ctx.fill();
  }

  function drawWall(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl) {
    var top = seen ? WALL_LIT[0][bucket][lvl] : WALL_DIM[0][bucket];
    var left = seen ? WALL_LIT[1][bucket][lvl] : WALL_DIM[1][bucket];
    var right = seen ? WALL_LIT[2][bucket][lvl] : WALL_DIM[2][bucket];
    var h2 = hh + hh;

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

  function drawStairs(ctx, sx, sy, hw, hh, seen, lvl) {
    var sh = SHADES.stone;
    var k, f, oyk;
    for (k = 1; k <= 3; k++) {
      f = 1 - k * 0.24;
      oyk = k * hh * 0.30;
      ctx.fillStyle = seen ? sh.dark[Math.max(0, lvl - k * 2)] : FLOOR_DIM[0][k & 7];
      pathDiamond(ctx, sx, sy + oyk, hw * f, hh * f);
      ctx.fill();
    }
    if (seen) {
      ctx.strokeStyle = SHADES.amber.main[lvl];
      ctx.lineWidth = 1;
      pathDiamond(ctx, sx, sy + hh * 0.90, hw * 0.28, hh * 0.28);
      ctx.stroke();
    }
  }

  function drawDoor(ctx, sx, sy, hw, hh, wh, bucket, seen, lvl) {
    var post = seen ? WALL_LIT[1][bucket][lvl] : WALL_DIM[1][bucket];
    var lint = seen ? SHADES.amber.dark[lvl] : FLOOR_DIM[1][bucket];
    var ph = wh * 0.60;
    var pw = Math.max(1, hw * 0.10);
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
  function hopOf(v, extra) {
    var b = v.bump;
    if (typeof extra === 'number' && extra > b) b = extra;
    if (b <= 0) return 0;
    return Math.sin(b * Math.PI);
  }

  function drawHpBar(ctx, cx, cy, z, ratio) {
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    var wBar = 22 * z, hBar = Math.max(1, 3 * z);
    ctx.fillStyle = COL_HPBAR_BG;
    ctx.fillRect(cx - wBar / 2, cy, wBar, hBar);
    ctx.fillStyle = HP_COL[Math.round(ratio * (LEVELS - 1))];
    ctx.fillRect(cx - wBar / 2, cy, wBar * ratio, hBar);
  }

  function pathChaserBody(ctx, cx, cy, z) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 25 * z);
    ctx.lineTo(cx + 11 * z, cy + 1 * z);
    ctx.lineTo(cx, cy - 5 * z);
    ctx.lineTo(cx - 11 * z, cy + 1 * z);
    ctx.closePath();
  }

  function pathSentinelBody(ctx, cx, cy, z) {
    var my = cy - 13 * z;
    ctx.beginPath();
    ctx.moveTo(cx - 12 * z, my);
    ctx.lineTo(cx - 6 * z, my - 8 * z);
    ctx.lineTo(cx + 6 * z, my - 8 * z);
    ctx.lineTo(cx + 12 * z, my);
    ctx.lineTo(cx + 6 * z, my + 8 * z);
    ctx.lineTo(cx - 6 * z, my + 8 * z);
    ctx.closePath();
  }

  function pathLinkerBody(ctx, cx, cy, z) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 27 * z);
    ctx.lineTo(cx + 11 * z, cy - 13 * z);
    ctx.lineTo(cx, cy + 1 * z);
    ctx.lineTo(cx - 11 * z, cy - 13 * z);
    ctx.closePath();
  }

  function pathPlayerBody(ctx, cx, cy, z) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 27 * z);
    ctx.lineTo(cx + 10 * z, cy - 4 * z);
    ctx.lineTo(cx, cy + 3 * z);
    ctx.lineTo(cx - 10 * z, cy - 4 * z);
    ctx.closePath();
  }

  function drawEnemy(ctx, ent, sx, cyBase, z, lvl, player) {
    if (!ent) return;
    var v = vfxOf('e' + ent.id, ent.x, ent.y, ent.hp);
    var cx = sx + v.ox * z;
    var cy = cyBase + v.oy * z;
    var hop = hopOf(v, ent.bump) * 6 * z;
    cy -= hop;

    fillEllipse(ctx, cx, cyBase + 2 * z, 11 * z, 4.6 * z, COL_SHADOW_ENT);

    var sh = SHADES[ent.kind] || SHADES.chaser;
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
      var my = cy - 13 * z;
      fillEllipse(ctx, cx, my, 5.2 * z, 3.4 * z, sh.light[lvl]);
      var ex = 0, ey = 0;
      if (player) {
        var ddx = player.x - ent.x, ddy = player.y - ent.y;
        var iso = (ddx - ddy);
        var isoy = (ddx + ddy);
        var len = Math.sqrt(iso * iso + isoy * isoy);
        if (len > 0) { ex = (iso / len) * 2.2 * z; ey = (isoy / len) * 1.3 * z; }
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
      ctx.fillStyle = FLASH_COL[Math.round(v.flash * (LEVELS - 1))];
      ctx.fill();
    }

    if (ent.maxHp > 0 && ent.hp < ent.maxHp) {
      drawHpBar(ctx, cx, cy - 33 * z, z, ent.hp / ent.maxHp);
    }
  }

  function drawPlayer(ctx, p, sx, cyBase, z) {
    var v = vfxOf('p', p.x, p.y, p.hp);
    var cx = sx + v.ox * z;
    var cy = cyBase + v.oy * z - hopOf(v, 0) * 6 * z;
    var sh = SHADES.player;
    var am = SHADES.amber;
    var lvl = LEVELS - 1;

    fillEllipse(ctx, cx, cyBase + 2 * z, 12 * z, 5 * z, COL_SHADOW_ENT);

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

    if (v.flash > 0) {
      pathPlayerBody(ctx, cx, cy, z);
      ctx.fillStyle = FLASH_COL[Math.round(v.flash * (LEVELS - 1))];
      ctx.fill();
    }

    if (p.maxHp > 0 && p.hp < p.maxHp) {
      drawHpBar(ctx, cx, cy - 42 * z, z, p.hp / p.maxHp);
    }
  }

  function drawPotion(ctx, item, sx, cyBase, z, lvl, seedIdx) {
    if (!item) return;
    var sh = SHADES.potion;
    var am = SHADES.amber;
    var bob = Math.sin(S.t * 2 + (typeof item.id === 'number' ? item.id : seedIdx)) * 1.2 * z;
    var cx = sx;
    var cy = cyBase + bob;

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
  function drawHover(ctx, game, hw, hh, ox, oy) {
    var ui = game.ui;
    if (!ui || !ui.hover) return;
    var map = game.map;
    var hx = ui.hover.x, hy = ui.hover.y;
    if (hx < 0 || hy < 0 || hx >= map.w || hy >= map.h) return;
    var s = hx + hy;
    var sx = hw * (2 * hx - s) + ox;
    var sy = s * hh + oy;
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
  function drawDebugLayer(ctx, game, hw, hh, ox, oy) {
    var map = game.map;
    var dmap = game.dmap;
    var tiles = map.tiles;
    var w = map.w, h = map.h;
    var vis = (game.visible && typeof game.visible.has === 'function') ? game.visible : EMPTY_SET;
    var expl = game.explored || null;
    var INF = (R.Dijkstra && typeof R.Dijkstra.INF === 'number') ? R.Dijkstra.INF : 99999;

    ctx.font = FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (var s = 0; s <= (w - 1) + (h - 1); s++) {
      var sy = s * hh + oy;
      if (sy + hh + hh < -48 || sy > S.vh + 48) continue;
      var lo = s - (h - 1);
      if (lo < 0) lo = 0;
      var hi = s;
      if (hi > w - 1) hi = w - 1;
      for (var x = lo; x <= hi; x++) {
        var y = s - x;
        var i = y * w + x;
        var t = tiles[i];
        if (t === T_WALL) continue;
        if (!vis.has(i) && !(expl && expl[i] !== 0)) continue;
        var sx = hw * (2 * x - s) + ox;
        if (sx < -hw - 8 || sx > S.vw + hw + 8) continue;
        // grade fina
        ctx.strokeStyle = COL_GRID;
        pathDiamond(ctx, sx, sy, hw, hh);
        ctx.stroke();
        if (!dmap) continue;
        var v = dmap[i];
        if (v === undefined || v >= INF) continue;
        ctx.fillStyle = DMAP_COL[Math.min(DMAP_COL.length - 1, Math.max(0, v >> 2))];
        ctx.fillText(
          (v >= 0 && v < NUMSTR.length) ? NUMSTR[v] : String(v),
          sx,
          sy + hh
        );
      }
    }
  }

  function drawFovProbe(ctx, game, hw, hh, ox, oy) {
    var ui = game.ui;
    if (!ui || !ui.hover) return;
    if (!R.FOV || typeof R.FOV.compute !== 'function') return;
    var map = game.map;
    var hx = ui.hover.x, hy = ui.hover.y;
    if (hx < 0 || hy < 0 || hx >= map.w || hy >= map.h) return;

    var w = map.w;
    var set = R.FOV.compute(map, hx, hy, FOV_R);
    var sx, sy, s;
    if (set && typeof set.forEach === 'function') {
      ctx.fillStyle = COL_PROBE;
      set.forEach(function (i) {
        var px = i % w;
        var py = (i - px) / w;
        s = px + py;
        sx = hw * (2 * px - s) + ox;
        sy = s * hh + oy;
        pathDiamond(ctx, sx, sy, hw, hh);
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

    if (typeof R.FOV.checkSymmetry !== 'function') return;
    var sym = R.FOV.checkSymmetry(map, hx, hy, FOV_R);
    if (!sym || !sym.broken || !sym.broken.length) return;
    ctx.lineWidth = 2;
    for (var k = 0; k < sym.broken.length; k++) {
      var b = sym.broken[k];
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

  /* ------------------------------------------------------------------ *
   * API pública
   * ------------------------------------------------------------------ */
  var Render = {
    cam: cam,
    fps: 0,
    handlesWheel: true,   // init() liga o zoom por roda; o módulo de input não precisa
    init: init,
    resize: resize,
    update: update,
    draw: draw,
    screenToTile: screenToTile,
    tileToScreen: tileToScreen,
    setZoom: setZoom
  };

  R.Render = Render;
})(window.R = window.R || {});
