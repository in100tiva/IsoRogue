/* ISOROGUE — 40-entities.js
 * Arquétipos, spawn proporcional (largest remainder), combate determinístico e IA
 * de inimigos. Todos os arquétipos leem O MESMO game.dmap (nenhum A* individual).
 * Cobre R22..R25 (distribuição) e R35..R43 (IA, combate, dano).
 * Nenhum acesso a DOM, nenhuma fonte de aleatoriedade fora dos rng determinísticos.
 */
(function (R) {
  'use strict';

  var Ent = {};

  /* ------------------------------------------------------------------ *
   * Arquétipos
   * ------------------------------------------------------------------ */

  /* `cor`/`corDetalhe`/`forma` são dicas para o render; `xp` para a progressão;
   * `peso` é o peso base de sorteio no spawn; `ideal` é a distância preferida;
   * `fem` é o gênero gramatical do nome, usado para concordar artigo e particípio
   * nas mensagens do registro ('A Sentinela foge ferida'). */
  var ARCH = {
    chaser: {
      key: 'chaser',
      nome: 'Perseguidor',
      fem: false,
      hp: 12,
      atk: 4,
      range: 1,
      ideal: 1,
      cor: '#d9534f',
      corDetalhe: '#f2a6a3',
      forma: 'triangulo',
      xp: 3,
      peso: 5,
      desc: 'Avança sem hesitar pelo caminho mais curto e golpeia corpo a corpo.'
    },
    sentinel: {
      key: 'sentinel',
      nome: 'Sentinela',
      fem: true,
      hp: 9,
      atk: 3,
      range: 6,
      ideal: 4,
      cor: '#4a90d9',
      corDetalhe: '#a9cbef',
      forma: 'hexagono',
      xp: 4,
      peso: 2,
      desc: 'Mantém quatro passos de distância e dispara quando tem linha de visão.'
    },
    linker: {
      key: 'linker',
      nome: 'Vinculador',
      fem: false,
      hp: 14,
      atk: 5,
      range: 1,
      ideal: 3,
      cor: '#b06fd0',
      corDetalhe: '#ddb8ec',
      forma: 'duplo-losango',
      xp: 6,
      peso: 1,
      desc: 'Só parte para o ataque quando outro inimigo já está colado no jogador.'
    }
  };

  /* Ordem fixa de iteração dos arquétipos — nunca use Object.keys na lógica. */
  var KINDS = ['chaser', 'sentinel', 'linker'];

  /* Rótulos pt-BR dos estados, para o tooltip da UI. */
  var STATE_LABEL = {
    idle: 'ocioso',
    hunt: 'em perseguição',
    flee: 'em fuga',
    attack: 'atacando',
    wait: 'aguardando'
  };

  var WOUNDED_RATIO = 0.3;   /* hp <= 30% do maxHp entra em fuga */
  var FLEE_FACTOR = -1.2;    /* fator padrão do gradiente de fuga */
  var LINK_MIN = 2;          /* faixa em que o Vinculador circula aguardando aliado */
  var LINK_MAX = 3;

  /* ------------------------------------------------------------------ *
   * Utilidades internas
   * ------------------------------------------------------------------ */

  function say(game, text, cls) {
    if (R.Game && typeof R.Game.logMsg === 'function') {
      R.Game.logMsg(game, text, cls || 'info');
    }
  }

  function archOf(kind) {
    return ARCH[kind] || ARCH.chaser;
  }

  /* Concordância de gênero: 'Sentinela' é feminino, os demais masculinos.
   * `art` devolve a vogal do artigo ('o'/'a') — serve tanto para o artigo solto
   * quanto para contrações ('d' + art, 'pel' + art) e para o particípio
   * ('ferid' + art). `Art` é o artigo inicial de frase, maiúsculo. */
  function art(arch) {
    return arch && arch.fem ? 'a' : 'o';
  }

  function Art(arch) {
    return arch && arch.fem ? 'A' : 'O';
  }

  function walkable(map, x, y) {
    if (R.MapGen && typeof R.MapGen.isWalkable === 'function') {
      return !!R.MapGen.isWalkable(map, x, y);
    }
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
    var t = map.tiles[R.idx(map.w, x, y)];
    return t === R.C.TILE.FLOOR || t === R.C.TILE.DOOR || t === R.C.TILE.STAIRS;
  }

  function inBounds(map, x, y) {
    if (R.MapGen && typeof R.MapGen.inBounds === 'function') {
      return !!R.MapGen.inBounds(map, x, y);
    }
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
  }

  function hasLOS(map, ax, ay, bx, by, radius) {
    if (R.FOV && typeof R.FOV.isVisibleFrom === 'function') {
      return !!R.FOV.isVisibleFrom(map, ax, ay, bx, by, radius);
    }
    return R.cheb(ax, ay, bx, by) <= radius;
  }

  /* Bloqueio para o passo de gradiente: fora do mapa, parede, tile ocupado
   * (inimigo vivo ou jogador) e corte de canto em diagonal.
   * Aceita tanto (x, y) quanto (índice) para tolerar as duas convenções
   * possíveis de `R.Dijkstra.bestStep`. */
  function makeBlocker(map, occupied, sx, sy) {
    var w = map.w;
    return function (a, b) {
      var x, y;
      if (b === undefined || b === null) {
        x = a % w;
        y = (a - x) / w;
      } else {
        x = a;
        y = b;
      }
      if (!inBounds(map, x, y)) return true;
      if (!walkable(map, x, y)) return true;
      if (occupied.has(R.idx(w, x, y))) return true;
      var dx = x - sx;
      var dy = y - sy;
      if (dx !== 0 && dy !== 0) {
        /* sem corte de canto: as duas ortogonais precisam ser caminháveis */
        if (!walkable(map, sx + dx, sy)) return true;
        if (!walkable(map, sx, sy + dy)) return true;
      }
      return false;
    };
  }

  /* Varredura local do gradiente: menor valor entre os 8 vizinhos, estritamente
   * menor que o tile atual; empate resolvido pela ordem de R.DIRS8. */
  function scanBest(field, map, x, y, blocked) {
    var w = map.w;
    var cur = field[R.idx(w, x, y)];
    var best = null;
    var bestV = cur;
    for (var d = 0; d < R.DIRS8.length; d++) {
      var nx = x + R.DIRS8[d][0];
      var ny = y + R.DIRS8[d][1];
      if (!inBounds(map, nx, ny)) continue;
      if (blocked(nx, ny)) continue;
      var v = field[R.idx(w, nx, ny)];
      if (v < bestV) {
        bestV = v;
        best = { x: nx, y: ny, v: v };
      }
    }
    return best;
  }

  function validStep(map, occupied, ent, step) {
    if (!step) return false;
    if (typeof step.x !== 'number' || typeof step.y !== 'number') return false;
    if (step.x === ent.x && step.y === ent.y) return false;
    if (R.cheb(ent.x, ent.y, step.x, step.y) !== 1) return false;
    if (!walkable(map, step.x, step.y)) return false;
    if (occupied.has(R.idx(map.w, step.x, step.y))) return false;
    var dx = step.x - ent.x;
    var dy = step.y - ent.y;
    if (dx !== 0 && dy !== 0) {
      if (!walkable(map, ent.x + dx, ent.y)) return false;
      if (!walkable(map, ent.x, ent.y + dy)) return false;
    }
    return true;
  }

  /* Reserva o tile no instante do movimento — é o que garante que dois inimigos
   * jamais ocupem o mesmo tile (R40 / teste T7). */
  function moveTo(ctx, ent, x, y) {
    var w = ctx.map.w;
    ctx.occupied.delete(R.idx(w, ent.x, ent.y));
    ent.x = x;
    ent.y = y;
    ctx.occupied.add(R.idx(w, x, y));
  }

  /* Desce o gradiente `field` um passo. Usa R.Dijkstra.bestStep (contrato) e
   * valida o resultado; se o preferido não servir, cai na varredura local que
   * escolhe o segundo melhor vizinho pela mesma ordem de R.DIRS8. */
  function gradientStep(game, ent, ctx, field) {
    if (!field) return null;
    var map = ctx.map;
    var blocked = makeBlocker(map, ctx.occupied, ent.x, ent.y);
    var step = null;
    if (R.Dijkstra && typeof R.Dijkstra.bestStep === 'function') {
      step = R.Dijkstra.bestStep(field, ent.x, ent.y, blocked);
    }
    if (!validStep(map, ctx.occupied, ent, step)) {
      step = scanBest(field, map, ent.x, ent.y, blocked);
    }
    if (!validStep(map, ctx.occupied, ent, step)) return null;
    moveTo(ctx, ent, step.x, step.y);
    return step;
  }

  function dmapOf(game) {
    var map = game.map;
    var need = map.w * map.h;
    if (game.dmap && game.dmap.length === need) return game.dmap;
    var d = R.Dijkstra.compute(
      map,
      [{ x: game.player.x, y: game.player.y, v: 0 }],
      { blocked: null }
    );
    game.dmap = d;
    return d;
  }

  /* Gradiente de fuga calculado no máximo uma vez por turno e compartilhado
   * por todos os inimigos que precisarem dele. */
  function fleeMapOf(game, ctx) {
    if (ctx.fleeMap) return ctx.fleeMap;
    if (!R.Dijkstra || typeof R.Dijkstra.flee !== 'function') return null;
    var fm = R.Dijkstra.flee(ctx.dmap, ctx.map, FLEE_FACTOR);
    ctx.fleeMap = fm;
    game.fleeMap = fm;
    return fm;
  }

  function setState(game, ent, state, msg, cls) {
    if (ent.state !== state && msg) say(game, msg, cls || 'aviso');
    ent.state = state;
  }

  function isWounded(ent) {
    return ent.hp <= ent.maxHp * WOUNDED_RATIO;
  }

  function combatRng(game) {
    if (!game.rngCombat) {
      /* Contrato: o stream vem de R.Game.createState. Fallback determinístico
       * apenas para não quebrar caso alguém chame processEnemies isolado. */
      game.rngCombat = R.makeRNG(R.hash32(String(game.seedStr) + '#combate'));
    }
    return game.rngCombat;
  }

  /* ------------------------------------------------------------------ *
   * Combate
   * ------------------------------------------------------------------ */

  Ent.rollDamage = function (rng, atk) {
    var d = atk + rng.int(-1, 1);
    return d < 1 ? 1 : d;
  };

  function attackPlayer(game, ent, ranged) {
    var arch = archOf(ent.kind);
    var dmg = Ent.rollDamage(combatRng(game), ent.atk);
    var p = game.player;
    ent.state = 'attack';
    ent.plan = ranged ? 'ataca à distância' : 'ataca corpo a corpo';
    ent.bump = 1;
    p.hp -= dmg;
    if (p.hp < 0) p.hp = 0;
    if (game.stats) {
      game.stats.dmgTaken = (game.stats.dmgTaken || 0) + dmg;
    }
    say(
      game,
      Art(arch) + ' ' + arch.nome + (ranged ? ' dispara de longe' : ' golpeia') +
        ' e causa ' + dmg + ' de dano.',
      'ruim'
    );
    if (p.hp <= 0) {
      /* A transição para `over` (autosave, histórico, tela de morte) e a frase
       * final são do módulo game; aqui só registramos QUEM desferiu o golpe
       * fatal — informação que só as entidades têm neste instante. O module
       * game monta a causa a partir deste arquétipo. */
      game.causeKind = ent.kind;
      say(game, 'Você tomba diante d' + art(arch) + ' ' + arch.nome + '.', 'ruim');
    }
    return dmg;
  }

  Ent.attackPlayer = function (game, ent) {
    return attackPlayer(game, ent, ent.range > 1);
  };

  /* ------------------------------------------------------------------ *
   * Spawn proporcional à área das salas (R22..R25)
   * ------------------------------------------------------------------ */

  /* Largest remainder method: cota = área/áreaTotal × N; as sobras vão para as
   * maiores frações; empate de fração desempata pelo menor room.id. */
  function largestRemainder(rooms, n) {
    var quotas = [];
    var i;
    for (i = 0; i < rooms.length; i++) quotas.push(0);
    if (n <= 0 || rooms.length === 0) return quotas;

    var totalArea = 0;
    for (i = 0; i < rooms.length; i++) {
      totalArea += Math.max(0, rooms[i].area || 0);
    }
    if (totalArea <= 0) {
      /* Sem área declarada: reparte em rodízio pela ordem das salas. */
      for (i = 0; i < n; i++) quotas[i % rooms.length]++;
      return quotas;
    }

    var fracs = [];
    var assigned = 0;
    for (i = 0; i < rooms.length; i++) {
      var exact = (Math.max(0, rooms[i].area || 0) / totalArea) * n;
      var base = Math.floor(exact);
      quotas[i] = base;
      assigned += base;
      fracs.push({ i: i, frac: exact - base, id: rooms[i].id });
    }
    fracs.sort(function (a, b) {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.id - b.id;
    });
    var left = n - assigned;
    for (i = 0; i < left && i < fracs.length; i++) quotas[fracs[i].i]++;
    return quotas;
  }

  /* Tiles livres de uma sala, em ordem determinística (linha a linha). */
  function roomCandidates(map, room, taken, start, stairs) {
    var out = [];
    var x0 = room.x;
    var y0 = room.y;
    var x1 = room.x + room.w;
    var y1 = room.y + room.h;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        if (!inBounds(map, x, y)) continue;
        if (!walkable(map, x, y)) continue;
        if (x === start.x && y === start.y) continue;
        if (stairs && x === stairs.x && y === stairs.y) continue;
        if (R.cheb(x, y, start.x, start.y) <= R.C.SAFE_RADIUS) continue;
        var i = R.idx(map.w, x, y);
        if (taken.has(i)) continue;
        out.push({ x: x, y: y, i: i });
      }
    }
    return out;
  }

  /* Distribui `total` posições pelas salas conforme as cotas, migrando a sobra
   * para a próxima sala por id quando a sala está saturada. */
  function distribute(map, rooms, quotas, total, rng, taken, start, stairs, place) {
    var order = [];
    var i;
    for (i = 0; i < rooms.length; i++) {
      order.push({ room: rooms[i], q: quotas[i] });
    }
    order.sort(function (a, b) { return a.room.id - b.room.id; });

    var placed = 0;
    var carry = 0;

    function fill(room, want) {
      if (want <= 0) return 0;
      var cand = roomCandidates(map, room, taken, start, stairs);
      if (cand.length === 0) return 0;
      rng.shuffle(cand);
      var got = 0;
      for (var k = 0; k < cand.length && got < want; k++) {
        var c = cand[k];
        if (taken.has(c.i)) continue;
        taken.add(c.i);
        place(c.x, c.y, room);
        got++;
      }
      return got;
    }

    for (i = 0; i < order.length; i++) {
      var want = order[i].q + carry;
      var got = fill(order[i].room, want);
      carry = want - got;
      placed += got;
    }

    /* Passadas extras: a cota que sobrou continua migrando pelas salas por id
     * enquanto houver progresso. */
    while (carry > 0 && placed < total) {
      var progress = 0;
      for (i = 0; i < order.length && carry > 0; i++) {
        var g = fill(order[i].room, carry);
        carry -= g;
        placed += g;
        progress += g;
      }
      if (progress === 0) break;
    }
    return placed;
  }

  /* Sorteio do arquétipo: pesos fixos com leve reforço de Sentinela/Vinculador
   * conforme a profundidade. Determinístico (consome o rng de população). */
  function pickKind(rng, depth) {
    var weights = [
      ARCH.chaser.peso,
      ARCH.sentinel.peso + Math.floor(depth / 2),
      ARCH.linker.peso + Math.floor(depth / 3)
    ];
    var total = 0;
    var i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = rng.int(1, total);
    for (i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return KINDS[i];
    }
    return KINDS[0];
  }

  Ent.makeEnemy = function (id, kind, x, y, depth) {
    var arch = archOf(kind);
    var d = depth < 1 ? 1 : depth;
    var hp = arch.hp + Math.floor(arch.hp * 0.15 * (d - 1));
    var atk = arch.atk + Math.floor((d - 1) / 2);
    return {
      id: id,
      kind: arch.key,
      x: x,
      y: y,
      hp: hp,
      maxHp: hp,
      atk: atk,
      range: arch.range,
      state: 'idle',
      plan: 'em repouso',
      lastDmg: 0,
      bump: 0
    };
  };

  // Poções são fungíveis: o contrato (seção 7) guarda só um CONTADOR em
  // player.potions, sem espaço para curas individuais. Logo todas curam o mesmo,
  // e este é o valor único que o módulo de jogo também consome — item.heal
  // nunca mente sobre o que a poção faz.
  Ent.POTION_HEAL = 12;

  Ent.makeItem = function (id, x, y) {
    return {
      id: id,
      kind: 'potion',
      x: x,
      y: y,
      heal: Ent.POTION_HEAL
    };
  };

  Ent.populate = function (map, depth) {
    var d = depth < 1 ? 1 : depth;
    var rng = R.makeRNG(R.hash32(map.seed + '#pop#' + d));
    var enemies = [];
    var items = [];

    var nEnemies = Math.min(22, 4 + d * 2);
    var nItems = Math.max(1, 3 + ((d * 7) % 3) - Math.floor(d / 4));

    var rooms = map.rooms || [];
    var start = map.start;
    var stairs = map.stairs;
    if (!rooms.length || !start) return { enemies: enemies, items: items };

    /* Um único conjunto de tiles tomados: nada de sobreposição entre inimigos,
     * itens, início ou escada (R23/R24). */
    var taken = new Set();
    taken.add(R.idx(map.w, start.x, start.y));
    if (stairs) taken.add(R.idx(map.w, stairs.x, stairs.y));

    var qEnemies = largestRemainder(rooms, nEnemies);
    var nextEnemyId = 1;
    distribute(map, rooms, qEnemies, nEnemies, rng, taken, start, stairs,
      function (x, y) {
        var kind = pickKind(rng, d);
        enemies.push(Ent.makeEnemy(nextEnemyId++, kind, x, y, d));
      });

    var qItems = largestRemainder(rooms, nItems);
    var nextItemId = 1;
    distribute(map, rooms, qItems, nItems, rng, taken, start, stairs,
      function (x, y) {
        items.push(Ent.makeItem(nextItemId++, x, y));
      });

    return { enemies: enemies, items: items };
  };

  /* ------------------------------------------------------------------ *
   * Contexto de turno
   * ------------------------------------------------------------------ */

  Ent.makeContext = function (game) {
    var map = game.map;
    var occupied = new Set();
    occupied.add(R.idx(map.w, game.player.x, game.player.y));
    var alive = [];
    for (var i = 0; i < game.enemies.length; i++) {
      var e = game.enemies[i];
      if (!e || e.hp <= 0) continue;
      alive.push(e);
      occupied.add(R.idx(map.w, e.x, e.y));
    }
    alive.sort(function (a, b) { return a.id - b.id; });
    return {
      map: map,
      occupied: occupied,
      dmap: dmapOf(game),
      fleeMap: null,
      alive: alive
    };
  };

  /* ------------------------------------------------------------------ *
   * IA — todos os arquétipos leem o MESMO game.dmap
   * ------------------------------------------------------------------ */

  /* Fuga por ferimento (R36): sobe o gradiente invertido, ou seja, desce o
   * mapa de fuga produzido por R.Dijkstra.flee. */
  function fleeBehaviour(game, ent, ctx) {
    var arch = archOf(ent.kind);
    if (ent.state !== 'flee') {
      say(game, Art(arch) + ' ' + arch.nome + ' foge ferid' + art(arch) + '.', 'aviso');
    }
    ent.state = 'flee';
    var step = gradientStep(game, ent, ctx, fleeMapOf(game, ctx));
    if (step) {
      ent.plan = 'foge para (' + step.x + ',' + step.y + ')';
      return;
    }
    /* Encurralado: ainda revida se o jogador estiver ao alcance. */
    var p = game.player;
    var dist = R.cheb(ent.x, ent.y, p.x, p.y);
    var ranged = ent.range > 1;
    var canHit = dist <= Math.max(1, ent.range) &&
      (!ranged || hasLOS(ctx.map, ent.x, ent.y, p.x, p.y, Math.max(ent.range, R.C.FOV_RADIUS)));
    if (canHit) {
      attackPlayer(game, ent, ranged);
      ent.state = 'flee';
      ent.plan = 'ataca encurralado';
      return;
    }
    ent.plan = 'encurralado, sem saída';
  }

  /* R37 — Perseguidor: desce o gradiente e bate corpo a corpo. */
  Ent.aiChaser = function (game, ent, ctx) {
    ctx = ctx || Ent.makeContext(game);
    if (isWounded(ent)) return fleeBehaviour(game, ent, ctx);
    var p = game.player;
    var dist = R.cheb(ent.x, ent.y, p.x, p.y);
    if (dist <= Math.max(1, ent.range)) {
      attackPlayer(game, ent, false);
      return;
    }
    setState(game, ent, 'hunt', null);
    var step = gradientStep(game, ent, ctx, ctx.dmap);
    if (step) {
      ent.plan = 'avança para (' + step.x + ',' + step.y + ')';
    } else {
      ent.state = 'wait';
      ent.plan = 'aguarda passagem';
    }
  };

  /* R38 — Sentinela: distância ideal 4. Recua abaixo de 3, aproxima acima de 5,
   * atira com linha de visão dentro do alcance. */
  Ent.aiSentinel = function (game, ent, ctx) {
    ctx = ctx || Ent.makeContext(game);
    if (isWounded(ent)) return fleeBehaviour(game, ent, ctx);
    var p = game.player;
    var map = ctx.map;
    var arch = archOf(ent.kind);
    var dist = R.cheb(ent.x, ent.y, p.x, p.y);
    var losR = Math.max(ent.range, R.C.FOV_RADIUS);
    var los = hasLOS(map, ent.x, ent.y, p.x, p.y, losR);

    if (dist < 3) {
      var back = gradientStep(game, ent, ctx, fleeMapOf(game, ctx));
      if (back) {
        /* Recuo TÁTICO (mantém a distância ideal), não fuga: a criatura segue
         * caçando. O estado 'flee' fica reservado à fuga por ferimento (§6),
         * senão o tooltip rotularia de 'em fuga' uma Sentinela com vida cheia.
         * A mensagem sai só na primeira vez da sequência de recuo. */
        if (String(ent.plan || '').indexOf('recua') !== 0) {
          say(game, Art(arch) + ' ' + arch.nome + ' recua.', 'aviso');
        }
        ent.state = 'hunt';
        ent.plan = 'recua para (' + back.x + ',' + back.y + ')';
        return;
      }
      if (los && dist <= ent.range) {
        attackPlayer(game, ent, true);
        return;
      }
      ent.state = 'wait';
      ent.plan = 'sem recuo possível';
      return;
    }

    if (dist > 5 || !los) {
      setState(game, ent, 'hunt', null);
      var step = gradientStep(game, ent, ctx, ctx.dmap);
      if (step) {
        ent.plan = los
          ? 'aproxima-se para (' + step.x + ',' + step.y + ')'
          : 'procura linha de tiro';
      } else {
        ent.state = 'wait';
        ent.plan = 'aguarda passagem';
      }
      return;
    }

    if (dist <= ent.range) {
      attackPlayer(game, ent, true);
      return;
    }

    setState(game, ent, 'hunt', null);
    var s2 = gradientStep(game, ent, ctx, ctx.dmap);
    if (s2) {
      ent.plan = 'aproxima-se para (' + s2.x + ',' + s2.y + ')';
    } else {
      ent.state = 'wait';
      ent.plan = 'aguarda passagem';
    }
  };

  /* Há outro inimigo vivo colado no jogador neste instante? */
  function allyAdjacentToPlayer(game, ent) {
    var p = game.player;
    for (var i = 0; i < game.enemies.length; i++) {
      var o = game.enemies[i];
      if (!o || o === ent || o.id === ent.id) continue;
      if (o.hp <= 0) continue;
      if (R.cheb(o.x, o.y, p.x, p.y) <= 1) return true;
    }
    return false;
  }

  /* Circula mantendo a faixa 2–3 do jogador, no sentido determinado pelo id
   * (par gira em um sentido, ímpar no outro) — determinístico. */
  function circleStep(game, ent, ctx) {
    var p = game.player;
    var map = ctx.map;
    var vx = ent.x - p.x;
    var vy = ent.y - p.y;
    var sense = (ent.id % 2 === 0) ? 1 : -1;
    var px = -vy * sense;
    var py = vx * sense;
    var blocked = makeBlocker(map, ctx.occupied, ent.x, ent.y);
    var best = null;
    var bestScore = 0;
    for (var d = 0; d < R.DIRS8.length; d++) {
      var nx = ent.x + R.DIRS8[d][0];
      var ny = ent.y + R.DIRS8[d][1];
      if (!inBounds(map, nx, ny)) continue;
      if (blocked(nx, ny)) continue;
      var dist = R.cheb(nx, ny, p.x, p.y);
      if (dist < LINK_MIN || dist > LINK_MAX) continue;
      var score = R.DIRS8[d][0] * px + R.DIRS8[d][1] * py;
      if (score > bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
    if (!best) return null;
    moveTo(ctx, ent, best.x, best.y);
    return best;
  }

  /* R39 — Vinculador: só parte para o ataque com outro inimigo adjacente ao
   * jogador; caso contrário circula a 2–3 tiles aguardando o aliado. */
  Ent.aiLinker = function (game, ent, ctx) {
    ctx = ctx || Ent.makeContext(game);
    if (isWounded(ent)) return fleeBehaviour(game, ent, ctx);
    var p = game.player;
    var arch = archOf(ent.kind);
    var dist = R.cheb(ent.x, ent.y, p.x, p.y);

    if (allyAdjacentToPlayer(game, ent)) {
      if (dist <= Math.max(1, ent.range)) {
        attackPlayer(game, ent, ent.range > 1);
        return;
      }
      setState(game, ent, 'hunt', Art(arch) + ' ' + arch.nome + ' avança com o aliado.', 'aviso');
      var step = gradientStep(game, ent, ctx, ctx.dmap);
      if (step) {
        ent.plan = 'avança para (' + step.x + ',' + step.y + ')';
      } else {
        ent.state = 'wait';
        ent.plan = 'aguarda passagem';
      }
      return;
    }

    setState(game, ent, 'wait', Art(arch) + ' ' + arch.nome + ' aguarda um aliado.', 'aviso');
    if (dist < LINK_MIN) {
      var back = gradientStep(game, ent, ctx, fleeMapOf(game, ctx));
      ent.plan = back ? 'afasta-se e aguarda aliado' : 'aguarda aliado';
      return;
    }
    if (dist > LINK_MAX) {
      var near = gradientStep(game, ent, ctx, ctx.dmap);
      ent.plan = near ? 'ronda aguardando aliado' : 'aguarda aliado';
      return;
    }
    var c = circleStep(game, ent, ctx);
    ent.plan = c ? 'circula à espreita' : 'aguarda aliado';
  };

  var AI = {
    chaser: Ent.aiChaser,
    sentinel: Ent.aiSentinel,
    linker: Ent.aiLinker
  };

  /* ------------------------------------------------------------------ *
   * Turno dos inimigos
   * ------------------------------------------------------------------ */

  Ent.processEnemies = function (game) {
    if (!game || !game.map || !game.player || !game.enemies) return;
    if (game.over || game.player.hp <= 0) return;

    var ctx = Ent.makeContext(game);
    var alive = ctx.alive;   /* já ordenado por id crescente */

    for (var i = 0; i < alive.length; i++) {
      var ent = alive[i];
      if (ent.hp <= 0) continue;
      if (game.over || game.player.hp <= 0) break;
      var fn = AI[ent.kind] || AI.chaser;
      fn(game, ent, ctx);
    }
  };

  /* ------------------------------------------------------------------ *
   * Consultas auxiliares
   * ------------------------------------------------------------------ */

  Ent.enemyAt = function (game, x, y) {
    for (var i = 0; i < game.enemies.length; i++) {
      var e = game.enemies[i];
      if (e && e.hp > 0 && e.x === x && e.y === y) return e;
    }
    return null;
  };

  Ent.itemAt = function (game, x, y) {
    for (var i = 0; i < game.items.length; i++) {
      var it = game.items[i];
      if (it && it.x === x && it.y === y) return it;
    }
    return null;
  };

  Ent.stateLabel = function (state) {
    return STATE_LABEL[state] || 'ocioso';
  };

  Ent.ARCH = ARCH;
  Ent.KINDS = KINDS;
  Ent.STATE_LABEL = STATE_LABEL;
  Ent.AI = AI;
  Ent.WOUNDED_RATIO = WOUNDED_RATIO;
  Ent.FLEE_FACTOR = FLEE_FACTOR;

  R.Ent = Ent;
})(window.R = window.R || {});
