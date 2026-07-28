(function (R) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Campo de visão — SHADOWCASTING RECURSIVO SIMÉTRICO (variante de Albert Ford).
  //
  // O mapa é varrido em 4 quadrantes (norte/leste/sul/oeste). Cada quadrante é
  // percorrido linha a linha (row = distância ao longo do eixo principal) e cada
  // linha é limitada por dois slopes racionais (start/end). Ao encontrar uma
  // transição piso -> parede a varredura RECURSA para a linha seguinte com o
  // slope final apertado; ao encontrar parede -> piso o slope inicial é apertado
  // na própria linha. Não existe amostragem de raios (Bresenham/DDA) em lugar
  // nenhum deste arquivo: nada parte da origem "andando" até o alvo.
  //
  // SIMETRIA: um tile de piso só é marcado visível quando o CENTRO dele está
  // dentro do cone de luz (teste `isSymmetricCol`), e os limites de coluna de
  // cada linha usam as regras de arredondamento simétricas round_ties_up /
  // round_ties_down. Isso garante, para quaisquer dois tiles TRANSPARENTES
  // (= caminháveis) A e B dentro do raio: vê(A -> B) <=> vê(B -> A).
  //
  // PAREDES: são marcadas sempre que caem na faixa de colunas da linha, mesmo
  // que o centro delas fique fora do cone — isso é necessário para o renderizador
  // desenhar as paredes que fecham a sala. Portanto a simetria NÃO vale (nem é
  // exigida) para paredes: `checkSymmetry` avalia APENAS pares de tiles
  // caminháveis, exatamente como manda o contrato (§4).
  //
  // Slopes são frações de inteiros pequenos (num/den, den > 0) manipuladas por
  // aritmética inteira — nada de acúmulo de erro de ponto flutuante.
  // ---------------------------------------------------------------------------

  var NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3;

  // Contexto da varredura corrente. Fica em escopo de módulo para que a recursão
  // receba apenas números e não aloque objetos/closures por chamada.
  var cTiles = null;
  var cW = 0, cH = 0;
  var cWall = 0;
  var cOx = 0, cOy = 0;
  var cCard = NORTH;
  var cMaxDepth = 0;
  var cLim2 = 0;      // (radius + 0.5)^2
  var cOut = null;

  // Sets reutilizados internamente (a API pública sempre devolve um Set).
  var SCRATCH_VIS = new Set();
  var SCRATCH_SYM_A = new Set();
  var SCRATCH_SYM_B = new Set();

  function defaultRadius() {
    if (R.C && typeof R.C.FOV_RADIUS === 'number') return R.C.FOV_RADIUS;
    return 9;
  }

  function wallValue() {
    if (R.C && R.C.TILE && typeof R.C.TILE.WALL === 'number') return R.C.TILE.WALL;
    return 0;
  }

  // Duck typing em vez de `instanceof Set` — o harness pode criar o Set em
  // outro realm (node:vm) e `instanceof` falharia silenciosamente.
  function isSetLike(o) {
    return !!o && typeof o.add === 'function' &&
      typeof o.clear === 'function' && typeof o.has === 'function';
  }

  function validMap(map) {
    return !!(map && map.tiles && typeof map.w === 'number' && typeof map.h === 'number');
  }

  function inBounds(map, x, y) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
  }

  // Transparência = não é parede e está dentro do mapa. Fora do mapa bloqueia.
  // Deliberadamente derivada só de R.C.TILE.WALL para que "transparente" e
  // "caminhável" sejam exatamente o mesmo conjunto (ver notas do retorno).
  function blocksAt(x, y) {
    if (x < 0 || y < 0 || x >= cW || y >= cH) return true;
    return cTiles[y * cW + x] === cWall;
  }

  // round_ties_up(a/b) = floor(a/b + 1/2), com b > 0.
  function roundTiesUp(a, b) {
    return Math.floor((2 * a + b) / (2 * b));
  }

  // round_ties_down(a/b) = ceil(a/b - 1/2), com b > 0.
  function roundTiesDown(a, b) {
    return Math.ceil((2 * a - b) / (2 * b));
  }

  function setContext(map, ox, oy, radius, out) {
    cTiles = map.tiles;
    cW = map.w | 0;
    cH = map.h | 0;
    cWall = wallValue();
    cOx = ox | 0;
    cOy = oy | 0;
    var rr = (typeof radius === 'number' && isFinite(radius)) ? radius : defaultRadius();
    if (rr < 0) rr = 0;
    cMaxDepth = Math.floor(rr + 0.5);
    var lim = rr + 0.5;
    cLim2 = lim * lim;
    cOut = out;
  }

  // Marca o tile (x, y) como visível, aplicando o raio CIRCULAR:
  // descarta quem tem distância euclidiana > radius + 0.5. A distância é
  // simétrica, então esse corte preserva a simetria da visão.
  function reveal(x, y) {
    if (x < 0 || y < 0 || x >= cW || y >= cH) return;
    var dx = x - cOx;
    var dy = y - cOy;
    if (dx * dx + dy * dy > cLim2) return;
    cOut.add(y * cW + x);
  }

  // Centro do tile dentro do cone? col >= depth*start && col <= depth*end,
  // avaliado com inteiros (denominadores sempre positivos).
  function isSymmetricCol(depth, col, sn, sd, en, ed) {
    return (col * sd >= depth * sn) && (col * ed <= depth * en);
  }

  // Varredura recursiva de uma linha do quadrante corrente.
  // depth: distância da linha à origem (>= 1)
  // sn/sd: slope inicial (fração), en/ed: slope final (fração)
  function scan(depth, sn, sd, en, ed) {
    if (depth > cMaxDepth) return;

    var minCol = roundTiesUp(depth * sn, sd);
    var maxCol = roundTiesDown(depth * en, ed);

    var prev = 2; // 0 = piso, 1 = parede, 2 = nenhum tile anterior
    var col, x, y, wall;

    for (col = minCol; col <= maxCol; col++) {
      switch (cCard) {
        case NORTH: x = cOx + col; y = cOy - depth; break;
        case EAST:  x = cOx + depth; y = cOy + col; break;
        case SOUTH: x = cOx + col; y = cOy + depth; break;
        default:    x = cOx - depth; y = cOy + col; break; // WEST
      }

      wall = blocksAt(x, y);

      // Parede entra sempre (para desenhar); piso só com o centro no cone.
      if (wall || isSymmetricCol(depth, col, sn, sd, en, ed)) reveal(x, y);

      if (prev === 1 && !wall) {
        // parede -> piso: aperta o slope inicial desta mesma linha
        sn = 2 * col - 1;
        sd = 2 * depth;
      }
      if (prev === 0 && wall) {
        // piso -> parede: recursa na linha seguinte com o slope final apertado
        scan(depth + 1, sn, sd, 2 * col - 1, 2 * depth);
      }

      prev = wall ? 1 : 0;
    }

    // Linha terminou em piso: o cone continua inteiro na linha seguinte.
    if (prev === 0) scan(depth + 1, sn, sd, en, ed);
  }

  // O quadrante `card` alcança o deslocamento (dx, dy)? Cada quadrante cobre
  // exatamente o cone |col| <= row do seu eixo; tiles na diagonal exata são
  // cobertos por dois quadrantes (irrelevante: o resultado é um Set).
  function quadrantCovers(card, dx, dy) {
    switch (card) {
      case NORTH: return dy <= -1 && (dx <= -dy) && (-dx <= -dy);
      case EAST:  return dx >= 1 && (dy <= dx) && (-dy <= dx);
      case SOUTH: return dy >= 1 && (dx <= dy) && (-dx <= dy);
      default:    return dx <= -1 && (dy <= -dx) && (-dy <= -dx); // WEST
    }
  }

  // Preenche `out` com todos os índices visíveis a partir de (ox, oy).
  function computeInto(map, ox, oy, radius, out) {
    out.clear();
    if (!validMap(map)) return out;
    if (!inBounds(map, ox, oy)) return out;

    setContext(map, ox, oy, radius, out);
    out.add((oy | 0) * cW + (ox | 0)); // a origem é sempre visível

    for (var card = NORTH; card <= WEST; card++) {
      cCard = card;
      scan(1, -1, 1, 1, 1);
    }
    cOut = null;
    return out;
  }

  // Teste dirigido: (bx, by) é visto a partir de (ax, ay)? Varre apenas os
  // quadrantes que cobrem o alvo — mesmo algoritmo, mesmo resultado de
  // `compute`, só que sem gastar os outros quadrantes.
  function visibleBetween(map, ax, ay, bx, by, radius, scratch) {
    if (!validMap(map)) return false;
    if (!inBounds(map, ax, ay) || !inBounds(map, bx, by)) return false;
    if (ax === bx && ay === by) return true;

    scratch.clear();
    setContext(map, ax, ay, radius, scratch);

    var dx = (bx | 0) - cOx;
    var dy = (by | 0) - cOy;
    if (dx * dx + dy * dy > cLim2) { cOut = null; return false; }

    var targetIdx = (by | 0) * cW + (bx | 0);
    var found = false;
    for (var card = NORTH; card <= WEST && !found; card++) {
      if (!quadrantCovers(card, dx, dy)) continue;
      cCard = card;
      scan(1, -1, 1, 1, 1);
      if (scratch.has(targetIdx)) found = true;
    }
    cOut = null;
    return found;
  }

  R.FOV = {
    /**
     * Índices (y*w + x) visíveis a partir de (ox, oy), incluindo a origem.
     * `out` é opcional: um Set reciclado que será limpo e repreenchido.
     */
    compute: function (map, ox, oy, radius, out) {
      var set = isSetLike(out) ? out : new Set();
      return computeInto(map, ox, oy, radius, set);
    },

    /** (tx, ty) está visível a partir de (ox, oy)? */
    isVisibleFrom: function (map, ox, oy, tx, ty, radius) {
      return visibleBetween(map, ox, oy, tx, ty, radius, SCRATCH_VIS);
    },

    /**
     * Sonda de simetria (tecla V). Computa o FOV da origem e, para cada tile
     * CAMINHÁVEL visível, computa a visão de volta. Paredes visíveis são
     * ignoradas de propósito: a simetria só é exigida entre tiles caminháveis.
     * -> { tested, broken: [{x, y}], ok }
     */
    checkSymmetry: function (map, ox, oy, radius) {
      var broken = [];
      var tested = 0;

      if (!validMap(map) || !inBounds(map, ox, oy)) {
        return { tested: 0, broken: broken, ok: true };
      }

      var w = map.w | 0;
      var wall = wallValue();
      var oxi = ox | 0, oyi = oy | 0;
      var originIdx = oyi * w + oxi;

      // Origem em parede: a simetria não é definida para tiles opacos.
      if (map.tiles[originIdx] === wall) {
        return { tested: 0, broken: broken, ok: true };
      }

      var vis = computeInto(map, oxi, oyi, radius, SCRATCH_SYM_A);
      var it = vis.values();
      var step = it.next();
      while (!step.done) {
        var idx = step.value;
        step = it.next();
        if (map.tiles[idx] === wall) continue; // só pares caminháveis
        tested++;
        if (idx === originIdx) continue;       // trivialmente simétrico
        var x = idx % w;
        var y = (idx - x) / w;
        if (!visibleBetween(map, x, y, oxi, oyi, radius, SCRATCH_SYM_B)) {
          broken.push({ x: x, y: y });
        }
      }

      return { tested: tested, broken: broken, ok: broken.length === 0 };
    }
  };
})(window.R = window.R || {});
