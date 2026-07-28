/* ISOROGUE — 10-mapgen.js
 * Geração procedural da masmorra: BSP recursivo, salas de 5 formatos,
 * corredores em L entre folhas irmãs, escada por BFS de grafo, reparo de
 * áreas isoladas por túnel e regeneração com seed derivada.
 * Cobre R12..R17 e R19. Tudo determinístico a partir de (seed, depth).
 */
(function (R) {
  'use strict';

  var C = R.C;
  var WALL = C.TILE.WALL;
  var FLOOR = C.TILE.FLOOR;
  var DOOR = C.TILE.DOOR;
  var STAIRS = C.TILE.STAIRS;

  // --- parâmetros do gerador (fixos: fazem parte do determinismo) -----------
  var MIN_LEAF = 7;        // folha mínima 7x7
  var MAX_BSP_DEPTH = 5;   // profundidade máxima da árvore
  var MIN_ROOM = 5;        // lado mínimo da sala (garante os 5 formatos)
  var MAX_ROOM = 13;       // lado máximo da sala
  var SPLIT_MIN = 0.35;
  var SPLIT_MAX = 0.65;
  var WIDE_CORRIDOR_CHANCE = 0.15;
  var MAX_REPAIRS = 3;     // reparos por tentativa
  var SHAPES = ['rect', 'cross', 'round', 'pillared', 'notched'];

  var SHAPE_NOME = {
    rect: ['retangular', 'retangulares'],
    cross: ['em cruz', 'em cruz'],
    round: ['arredondada', 'arredondadas'],
    pillared: ['com colunas', 'com colunas'],
    notched: ['recortada', 'recortadas']
  };

  // -------------------------------------------------------------------------
  // Helpers locais (não tocam o namespace R)
  // -------------------------------------------------------------------------

  function clampInt(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function isWalkVal(v) {
    return v === FLOOR || v === DOOR || v === STAIRS;
  }

  /** Percentual no formato pt-BR: 97.42 -> '97,4' */
  function pct(frac) {
    return (frac * 100).toFixed(1).replace('.', ',');
  }

  function plural(n, sing, plur) {
    return n === 1 ? sing : plur;
  }

  /** Normaliza a semente sem depender da ordem de carga dos módulos. */
  function normalizeSeed(seedStr) {
    if (typeof R.normalizeSeed === 'function') {
      return R.normalizeSeed(seedStr);
    }
    var s = String(seedStr == null ? '' : seedStr).trim().toUpperCase();
    return s.replace(/\s+/g, ' ');
  }

  /** Mistura inteira determinística para o decor por tile (sem alocação). */
  function mixTile(seedNum, x, y) {
    var v = (seedNum ^ 0x9e3779b9) >>> 0;
    v = Math.imul(v ^ (x + 0x85ebca6b), 0x27d4eb2d) >>> 0;
    v = Math.imul(v ^ (y + 0xc2b2ae35), 0x165667b1) >>> 0;
    v = (v ^ (v >>> 15)) >>> 0;
    v = Math.imul(v, 0x2545f491) >>> 0;
    return (v ^ (v >>> 13)) >>> 0;
  }

  // -------------------------------------------------------------------------
  // Estruturas de varredura (BFS)
  // -------------------------------------------------------------------------

  /** BFS 4-vizinhança a partir de (sx,sy) sobre tiles caminháveis. */
  function bfsFrom(tiles, w, h, sx, sy) {
    var n = w * h;
    var dist = new Int32Array(n);
    dist.fill(-1);
    var queue = new Int32Array(n);
    var head = 0;
    var tail = 0;
    var reached = 0;
    var s = sy * w + sx;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h || !isWalkVal(tiles[s])) {
      return { dist: dist, reached: 0 };
    }
    dist[s] = 0;
    queue[tail++] = s;
    reached = 1;
    while (head < tail) {
      var cur = queue[head++];
      var cx = cur % w;
      var cy = (cur - cx) / w;
      var dc = dist[cur] + 1;
      for (var k = 0; k < 4; k++) {
        var nx = cx + R.DIRS4[k][0];
        var ny = cy + R.DIRS4[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var ni = ny * w + nx;
        if (dist[ni] !== -1 || !isWalkVal(tiles[ni])) continue;
        dist[ni] = dc;
        queue[tail++] = ni;
        reached++;
      }
    }
    return { dist: dist, reached: reached };
  }

  /** Rotulagem de componentes conexos (4-vizinhança). -1 = parede. */
  function labelRegions(tiles, w, h) {
    var n = w * h;
    var labels = new Int32Array(n);
    labels.fill(-1);
    var queue = new Int32Array(n);
    var sizes = [];
    var lists = [];
    var count = 0;
    for (var i = 0; i < n; i++) {
      if (labels[i] !== -1 || !isWalkVal(tiles[i])) continue;
      var head = 0;
      var tail = 0;
      var list = [];
      labels[i] = count;
      queue[tail++] = i;
      while (head < tail) {
        var cur = queue[head++];
        list.push(cur);
        var cx = cur % w;
        var cy = (cur - cx) / w;
        for (var k = 0; k < 4; k++) {
          var nx = cx + R.DIRS4[k][0];
          var ny = cy + R.DIRS4[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (labels[ni] !== -1 || !isWalkVal(tiles[ni])) continue;
          labels[ni] = count;
          queue[tail++] = ni;
        }
      }
      sizes.push(list.length);
      lists.push(list);
      count++;
    }
    return { labels: labels, count: count, sizes: sizes, lists: lists };
  }

  function countWalkable(tiles) {
    var total = 0;
    for (var i = 0; i < tiles.length; i++) {
      if (isWalkVal(tiles[i])) total++;
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // BSP
  // -------------------------------------------------------------------------

  function makeNode(x, y, w, h, depth) {
    return { x: x, y: y, w: w, h: h, depth: depth, left: null, right: null, room: null };
  }

  function splitNode(node, rng) {
    if (node.depth >= MAX_BSP_DEPTH) return;
    var canV = node.w >= MIN_LEAF * 2; // corte no eixo x
    var canH = node.h >= MIN_LEAF * 2; // corte no eixo y
    if (!canV && !canH) return;

    var vertical;
    if (canV && !canH) {
      vertical = true;
    } else if (canH && !canV) {
      vertical = false;
    } else if (node.w / node.h >= 1.25) {
      vertical = true;
    } else if (node.h / node.w >= 1.25) {
      vertical = false;
    } else {
      vertical = rng.chance(0.5);
    }

    var len = vertical ? node.w : node.h;
    var ratio = rng.float(SPLIT_MIN, SPLIT_MAX);
    var cut = clampInt(Math.floor(len * ratio), MIN_LEAF, len - MIN_LEAF);

    if (vertical) {
      node.left = makeNode(node.x, node.y, cut, node.h, node.depth + 1);
      node.right = makeNode(node.x + cut, node.y, node.w - cut, node.h, node.depth + 1);
    } else {
      node.left = makeNode(node.x, node.y, node.w, cut, node.depth + 1);
      node.right = makeNode(node.x, node.y + cut, node.w, node.h - cut, node.depth + 1);
    }
    splitNode(node.left, rng);
    splitNode(node.right, rng);
  }

  /** Folhas em ordem fixa (esquerda antes da direita) — define os ids das salas. */
  function collectLeaves(node, out) {
    if (!node.left) {
      out.push(node);
      return;
    }
    collectLeaves(node.left, out);
    collectLeaves(node.right, out);
  }

  // -------------------------------------------------------------------------
  // Salas — 5 formatos visivelmente distintos
  // -------------------------------------------------------------------------

  function shapeAllows(shape, rw, rh) {
    if (shape === 'rect') return true;
    return rw >= MIN_ROOM && rh >= MIN_ROOM;
  }

  /** Saco embaralhado: garante que os 5 formatos apareçam quando há salas suficientes. */
  function makeShapeBag(rng) {
    var bag = [];
    return {
      take: function (rw, rh) {
        for (var guard = 0; guard < 12; guard++) {
          if (bag.length === 0) {
            bag = rng.shuffle(SHAPES.slice());
          }
          var s = bag.pop();
          if (shapeAllows(s, rw, rh)) return s;
        }
        return 'rect';
      }
    };
  }

  /** Esculpe o piso da sala conforme o formato. Sempre deixa o centro caminhável. */
  function carveRoom(tiles, w, room, rng) {
    var x0 = room.x;
    var y0 = room.y;
    var rw = room.w;
    var rh = room.h;
    var cxo = Math.floor(rw / 2);
    var cyo = Math.floor(rh / 2);
    var x;
    var y;
    var i;

    if (room.shape === 'cross') {
      var bw = Math.max(1, Math.floor(rw / 3) | 1);
      var bh = Math.max(1, Math.floor(rh / 3) | 1);
      var sx = Math.floor((rw - bw) / 2);
      var sy = Math.floor((rh - bh) / 2);
      for (y = 0; y < rh; y++) {
        for (x = 0; x < rw; x++) {
          var inV = (x >= sx && x < sx + bw);
          var inH = (y >= sy && y < sy + bh);
          if (inV || inH) {
            tiles[R.idx(w, x0 + x, y0 + y)] = FLOOR;
          }
        }
      }
    } else if (room.shape === 'round') {
      var ccx = (rw - 1) / 2;
      var ccy = (rh - 1) / 2;
      var rx = rw / 2;
      var ry = rh / 2;
      for (y = 0; y < rh; y++) {
        for (x = 0; x < rw; x++) {
          var dx = (x - ccx) / rx;
          var dy = (y - ccy) / ry;
          if (dx * dx + dy * dy <= 1.0) {
            tiles[R.idx(w, x0 + x, y0 + y)] = FLOOR;
          }
        }
      }
    } else if (room.shape === 'pillared') {
      for (y = 0; y < rh; y++) {
        for (x = 0; x < rw; x++) {
          tiles[R.idx(w, x0 + x, y0 + y)] = FLOOR;
        }
      }
      for (y = 1; y < rh - 1; y += 2) {
        for (x = 1; x < rw - 1; x += 2) {
          if (x === cxo && y === cyo) continue; // centro nunca vira coluna
          tiles[R.idx(w, x0 + x, y0 + y)] = WALL;
        }
      }
    } else if (room.shape === 'notched') {
      for (y = 0; y < rh; y++) {
        for (x = 0; x < rw; x++) {
          tiles[R.idx(w, x0 + x, y0 + y)] = FLOOR;
        }
      }
      // O recorte nunca pode engolir o centro: limite = floor((lado-1)/2).
      var nw = clampInt(Math.round(rw * 0.45), 1, Math.floor((rw - 1) / 2));
      var nh = clampInt(Math.round(rh * 0.45), 1, Math.floor((rh - 1) / 2));
      var corner = rng.int(0, 3);
      var nx0 = (corner === 1 || corner === 3) ? rw - nw : 0;
      var ny0 = (corner === 2 || corner === 3) ? rh - nh : 0;
      for (y = ny0; y < ny0 + nh; y++) {
        for (x = nx0; x < nx0 + nw; x++) {
          tiles[R.idx(w, x0 + x, y0 + y)] = WALL;
        }
      }
    } else {
      for (y = 0; y < rh; y++) {
        for (x = 0; x < rw; x++) {
          tiles[R.idx(w, x0 + x, y0 + y)] = FLOOR;
        }
      }
    }

    // invariante: o centro é sempre caminhável (é a boca dos corredores)
    i = R.idx(w, room.cx, room.cy);
    tiles[i] = FLOOR;
  }

  // -------------------------------------------------------------------------
  // Corredores
  // -------------------------------------------------------------------------

  function makeCarver(tiles, w, h) {
    function put(x, y) {
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return;
      var i = R.idx(w, x, y);
      if (tiles[i] === WALL) tiles[i] = FLOOR;
    }
    return {
      hall: function (y, x1, x2, wide) {
        var a = Math.min(x1, x2);
        var b = Math.max(x1, x2);
        for (var x = a; x <= b; x++) {
          put(x, y);
          if (wide) put(x, y + 1);
        }
      },
      vert: function (x, y1, y2, wide) {
        var a = Math.min(y1, y2);
        var b = Math.max(y1, y2);
        for (var y = a; y <= b; y++) {
          put(x, y);
          if (wide) put(x + 1, y);
        }
      }
    };
  }

  /** Corredor em L de (ax,ay) até (bx,by); 15% de chance de largura 2. */
  function carveL(carver, rng, ax, ay, bx, by) {
    var wide = rng.chance(WIDE_CORRIDOR_CHANCE) ? 1 : 0;
    if (rng.chance(0.5)) {
      carver.hall(ay, ax, bx, wide);
      carver.vert(bx, ay, by, wide);
    } else {
      carver.vert(ax, ay, by, wide);
      carver.hall(by, ax, bx, wide);
    }
  }

  /**
   * Na volta da recursão liga a sala representativa da sub-árvore esquerda
   * à da direita e devolve a representativa deste nó.
   */
  function connectNode(node, carver, rng, stats) {
    if (!node.left) return node.room;
    var a = connectNode(node.left, carver, rng, stats);
    var b = connectNode(node.right, carver, rng, stats);
    if (a && b) {
      carveL(carver, rng, a.cx, a.cy, b.cx, b.cy);
      stats.corridors++;
    }
    var takeLeft = rng.chance(0.5);
    if (!a) return b;
    if (!b) return a;
    return takeLeft ? a : b;
  }

  // -------------------------------------------------------------------------
  // Reparo de áreas isoladas
  // -------------------------------------------------------------------------

  /** Par de tiles (isolado, principal) de menor distância de Manhattan. */
  function nearestPair(listA, listB, w) {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < listA.length; i++) {
      var a = listA[i];
      var ax = a % w;
      var ay = (a - ax) / w;
      for (var j = 0; j < listB.length; j++) {
        var b = listB[j];
        var bx = b % w;
        var by = (b - bx) / w;
        var d = Math.abs(ax - bx) + Math.abs(ay - by);
        if (d < bestD) {
          bestD = d;
          best = { ax: ax, ay: ay, bx: bx, by: by, d: d };
        }
      }
    }
    return best;
  }

  /**
   * Enquanto houver região isolada e orçamento de reparos, cava um túnel em L
   * entre a região isolada e a principal pelo par de tiles mais próximo.
   */
  function repairIsolated(tiles, w, h, startIdx, carver, rng) {
    var repairs = 0;
    var fixed = 0;
    for (var pass = 0; pass < MAX_REPAIRS; pass++) {
      var reg = labelRegions(tiles, w, h);
      if (reg.count <= 1) break;
      var main = reg.labels[startIdx];
      if (main < 0) break;
      var target = -1;
      for (var lab = 0; lab < reg.count; lab++) {
        if (lab !== main) { target = lab; break; }
      }
      if (target < 0) break;
      var pair = nearestPair(reg.lists[target], reg.lists[main], w);
      if (!pair) break;
      carveL(carver, rng, pair.ax, pair.ay, pair.bx, pair.by);
      repairs++;
      fixed++;
    }
    return { repairs: repairs, fixed: fixed };
  }

  // -------------------------------------------------------------------------
  // Montagem de uma tentativa
  // -------------------------------------------------------------------------

  function buildLayout(seedNum) {
    var w = C.MAP_W;
    var h = C.MAP_H;
    var tiles = new Uint8Array(w * h); // 0 = WALL

    var rng = R.makeRNG(seedNum);
    var rngBsp = rng.fork('bsp');
    rng.u32();
    var rngRooms = rng.fork('rooms');
    rng.u32();
    var rngCorr = rng.fork('corr');
    rng.u32();
    var rngDecor = rng.fork('decor');
    rng.u32();
    var decorSeed = rngDecor.u32();

    // 1) árvore BSP sobre o retângulo interno (mantém a moldura de parede)
    var root = makeNode(1, 1, w - 2, h - 2, 0);
    splitNode(root, rngBsp);
    var leaves = [];
    collectLeaves(root, leaves);

    // 2) uma sala por folha, com margem >= 1 do limite da folha
    var bag = makeShapeBag(rngRooms);
    var rooms = [];
    for (var li = 0; li < leaves.length; li++) {
      var leaf = leaves[li];
      var maxW = Math.min(leaf.w - 2, MAX_ROOM);
      var maxH = Math.min(leaf.h - 2, MAX_ROOM);
      if (maxW < 4 || maxH < 4) continue;
      // Sorteio enviesado para salas grandes: os formatos ficam visíveis.
      var lowW = clampInt(maxW - 3, Math.min(MIN_ROOM, maxW), maxW);
      var lowH = clampInt(maxH - 3, Math.min(MIN_ROOM, maxH), maxH);
      var rw = rngRooms.int(lowW, maxW);
      var rh = rngRooms.int(lowH, maxH);
      var rx = leaf.x + 1 + rngRooms.int(0, leaf.w - 2 - rw);
      var ry = leaf.y + 1 + rngRooms.int(0, leaf.h - 2 - rh);
      // trava de segurança: a moldura externa do mapa jamais é escrita
      rx = clampInt(rx, 1, w - 1 - rw);
      ry = clampInt(ry, 1, h - 1 - rh);
      var shape = bag.take(rw, rh);
      var room = {
        id: rooms.length,
        x: rx,
        y: ry,
        w: rw,
        h: rh,
        cx: rx + Math.floor(rw / 2),
        cy: ry + Math.floor(rh / 2),
        area: 0,
        shape: shape
      };
      carveRoom(tiles, w, room, rngRooms);
      leaf.room = room;
      rooms.push(room);
    }

    // 3) corredores em L entre folhas irmãs, na volta da recursão
    var carver = makeCarver(tiles, w, h);
    var stats = { corridors: 0 };
    connectNode(root, carver, rngCorr, stats);

    return {
      w: w,
      h: h,
      tiles: tiles,
      rooms: rooms,
      leaves: leaves.length,
      corridors: stats.corridors,
      carver: carver,
      rngCorr: rngCorr,
      decorSeed: decorSeed
    };
  }

  /** Sela (vira parede) tudo que não pertence à região principal. Último recurso. */
  function sealIsolated(tiles, w, h, startIdx) {
    var reg = labelRegions(tiles, w, h);
    if (reg.count <= 1) return 0;
    var main = reg.labels[startIdx];
    if (main < 0) return 0;
    var sealed = 0;
    for (var i = 0; i < tiles.length; i++) {
      if (reg.labels[i] !== -1 && reg.labels[i] !== main) {
        tiles[i] = WALL;
        sealed++;
      }
    }
    return sealed;
  }

  function computeDecor(tiles, w, h, decorSeed) {
    var decor = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = R.idx(w, x, y);
        decor[i] = mixTile(decorSeed + tiles[i] * 131, x, y) & 255;
      }
    }
    return decor;
  }

  function recomputeAreas(tiles, w, rooms) {
    for (var r = 0; r < rooms.length; r++) {
      var room = rooms[r];
      var count = 0;
      for (var y = room.y; y < room.y + room.h; y++) {
        for (var x = room.x; x < room.x + room.w; x++) {
          if (isWalkVal(tiles[R.idx(w, x, y)])) count++;
        }
      }
      room.area = count;
    }
  }

  function shapeSummary(rooms) {
    var counts = {};
    var i;
    for (i = 0; i < SHAPES.length; i++) counts[SHAPES[i]] = 0;
    for (i = 0; i < rooms.length; i++) counts[rooms[i].shape]++;
    var parts = [];
    for (i = 0; i < SHAPES.length; i++) {
      var key = SHAPES[i];
      var n = counts[key];
      if (n > 0) parts.push(n + ' ' + plural(n, SHAPE_NOME[key][0], SHAPE_NOME[key][1]));
    }
    return parts.join(', ');
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  var MapGen = {};

  MapGen.inBounds = function (map, x, y) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
  };

  MapGen.isWalkable = function (map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
    var v = map.tiles[y * map.w + x];
    return v === FLOOR || v === DOOR || v === STAIRS;
  };

  MapGen.blocksLight = function (map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
    return map.tiles[y * map.w + x] === WALL;
  };

  MapGen.regions = function (map) {
    var reg = labelRegions(map.tiles, map.w, map.h);
    return { labels: reg.labels, count: reg.count, sizes: reg.sizes };
  };

  /**
   * Gera o mapa do nível. Mesma (seed, depth) => mapa byte-a-byte idêntico.
   * @param {String} seedStr semente crua (será normalizada)
   * @param {Number} depth   profundidade 1-based
   */
  MapGen.generate = function (seedStr, depth) {
    var seed = normalizeSeed(seedStr);
    var d = Math.max(1, Math.floor(depth || 1));
    var notes = [];
    var regenerations = 0;
    var repairs = 0;

    var layout = null;
    var startIdx = 0;
    var startX = 0;
    var startY = 0;
    var walk = 0;
    var reach = 0;
    var connectivity = 0;
    var scan = null;
    var accepted = false;

    for (var attempt = 0; attempt <= C.MAX_REGEN; attempt++) {
      var seedNum = attempt === 0
        ? R.hash32(seed + '#' + d)
        : R.hash32(seed + '#' + d + '#retry' + attempt);

      layout = buildLayout(seedNum);

      if (layout.rooms.length === 0) {
        // Sem salas não há mapa jogável: força nova tentativa.
        notes.push('Tentativa ' + (attempt + 1) + ' descartada: nenhuma sala pôde ser esculpida.');
        regenerations++;
        continue;
      }

      // início: centro da sala de menor id
      startX = layout.rooms[0].cx;
      startY = layout.rooms[0].cy;
      startIdx = R.idx(layout.w, startX, startY);

      walk = countWalkable(layout.tiles);
      scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
      reach = scan.reached;
      connectivity = walk > 0 ? reach / walk : 0;

      if (connectivity < 1) {
        var before = connectivity;
        var rep = repairIsolated(layout.tiles, layout.w, layout.h, startIdx, layout.carver, layout.rngCorr);
        if (rep.repairs > 0) {
          repairs += rep.repairs;
          walk = countWalkable(layout.tiles);
          scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
          reach = scan.reached;
          connectivity = walk > 0 ? reach / walk : 0;
          notes.push('Conectividade ' + pct(before) + '% — ' + rep.repairs + ' ' +
            plural(rep.repairs, 'área isolada religada', 'áreas isoladas religadas') + ' por túnel.');
        }
      }

      if (connectivity >= 1) {
        accepted = true;
        break;
      }

      if (attempt < C.MAX_REGEN) {
        notes.push('Tentativa ' + (attempt + 1) + ' descartada (conectividade ' + pct(connectivity) +
          '%): mapa refeito com semente derivada.');
        regenerations++;
      }
    }

    // Último recurso: sela o que sobrou isolado para garantir 100% de conectividade.
    if (!accepted && layout && layout.rooms.length > 0) {
      var sealed = sealIsolated(layout.tiles, layout.w, layout.h, startIdx);
      if (sealed > 0) {
        notes.push('Limite de regenerações atingido: ' + sealed + ' ' +
          plural(sealed, 'tile inalcançável foi selado', 'tiles inalcançáveis foram selados') + '.');
      }
      walk = countWalkable(layout.tiles);
      scan = bfsFrom(layout.tiles, layout.w, layout.h, startX, startY);
      reach = scan.reached;
      connectivity = walk > 0 ? reach / walk : 0;
    }

    var w = layout.w;
    var h = layout.h;
    var tiles = layout.tiles;
    var rooms = layout.rooms;
    var dist = scan.dist;

    // Escada: sala mais distante do início em distância de grafo (BFS).
    var stairRoom = null;
    var bestDist = -1;
    for (var r = 0; r < rooms.length; r++) {
      var room = rooms[r];
      var ri = R.idx(w, room.cx, room.cy);
      if (dist[ri] < 0) continue;
      if (rooms.length > 1 && r === 0) continue; // evita escada em cima do início
      if (dist[ri] > bestDist) {
        bestDist = dist[ri];
        stairRoom = room;
      }
    }

    var stairX;
    var stairY;
    if (stairRoom) {
      stairX = stairRoom.cx;
      stairY = stairRoom.cy;
    } else {
      // fallback: tile caminhável mais distante do início
      var bi = startIdx;
      var bd = -1;
      for (var i = 0; i < dist.length; i++) {
        if (dist[i] > bd) { bd = dist[i]; bi = i; }
      }
      stairX = bi % w;
      stairY = (bi - stairX) / w;
      bestDist = bd;
    }
    tiles[R.idx(w, stairX, stairY)] = STAIRS;

    recomputeAreas(tiles, w, rooms);
    var decor = computeDecor(tiles, w, h, layout.decorSeed);

    // --- notas em pt-BR ----------------------------------------------------
    notes.unshift('Nível ' + d + ', semente ' + seed + ': BSP produziu ' + layout.leaves + ' ' +
      plural(layout.leaves, 'folha', 'folhas') + ', ' + rooms.length + ' ' +
      plural(rooms.length, 'sala', 'salas') + ' e ' + layout.corridors + ' ' +
      plural(layout.corridors, 'corredor em L', 'corredores em L') + '.');
    notes.splice(1, 0, 'Formatos das salas: ' + shapeSummary(rooms) + '.');
    if (regenerations > 0) {
      notes.splice(2, 0, 'Mapa regenerado ' + regenerations + ' ' +
        plural(regenerations, 'vez', 'vezes') + ' com semente derivada.');
    }
    notes.push('Escada na sala ' + (stairRoom ? '#' + stairRoom.id : 'mais afastada') +
      ' em (' + stairX + ',' + stairY + '), a ' + Math.max(0, bestDist) + ' ' +
      plural(Math.max(0, bestDist), 'passo', 'passos') + ' do início.');

    var unreachable = walk - reach;
    if (connectivity >= 1) {
      notes.push('Conectividade 100,0% — ' + walk + ' tiles caminháveis, todos alcançáveis a partir do início.');
    } else {
      notes.push('Conectividade ' + pct(connectivity) + '% — ' + walk + ' tiles caminháveis, ' +
        unreachable + ' ' + plural(unreachable, 'inalcançável', 'inalcançáveis') + '.');
    }

    return {
      seed: seed,
      depth: d,
      w: w,
      h: h,
      tiles: tiles,
      decor: decor,
      rooms: rooms,
      start: { x: startX, y: startY },
      stairs: { x: stairX, y: stairY },
      connectivity: connectivity,
      walkable: walk,
      regenerations: regenerations,
      repairs: repairs,
      notes: notes
    };
  };

  R.MapGen = MapGen;
})(window.R = window.R || {});
