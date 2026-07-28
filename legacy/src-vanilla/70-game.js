/* ISOROGUE — módulo game: estado, turnos, progressão, input e laço de animação.
   Contrato: docs/CONTRACTS.md §7 e §10 (R32, R33, R44..R47, R53, R57, R58).
   Regras: sem aleatoriedade nativa, sem DOM no top-level, determinismo total. */
(function (R) {
  'use strict';

  var Game = {};
  R.Game = Game;

  // --------------------------------------------------------------------------
  // Constantes de jogo
  // --------------------------------------------------------------------------

  var PLAYER_BASE = { hp: 42, atk: 7, potions: 3 };
  // Fonte única da cura da poção: o módulo de entidades é dono do item (§6) e
  // grava o mesmo número em item.heal. Fallback só para carga fora de ordem.
  var POTION_HEAL = (R.Ent && R.Ent.POTION_HEAL) || 12;
  var XP_POR_NIVEL = 10;     // xp necessário = level * XP_POR_NIVEL
  var HP_POR_DESCIDA = 2;    // §7: maxHp += 2 ao descer
  var ZOOM_STEP = 1.12;

  var NOMES = { chaser: 'Perseguidor', sentinel: 'Sentinela', linker: 'Vinculador' };
  var FEMININO = { chaser: false, sentinel: true, linker: false };
  var ESTADOS = {
    idle: 'ocioso',
    hunt: 'caçando',
    flee: 'em fuga',
    attack: 'atacando',
    wait: 'aguardando'
  };
  var CLASSES_LOG = { info: 1, bom: 1, ruim: 1, aviso: 1, sistema: 1 };
  // Nome pt-BR dos formatos de sala produzidos pelo BSP (§3).
  var FORMATOS = {
    rect: 'retangular',
    cross: 'em cruz',
    round: 'arredondada',
    pillared: 'com colunas',
    notched: 'recortada'
  };

  // Mapeamento de teclas -> deslocamento na GRADE lógica (§10).
  // Cardinais da grade nas teclas primárias: é por elas que se percorrem os
  // corredores (que são traçados nos eixos x/y do mapa).
  var MOVE_KEY = {
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]
  };
  var MOVE_CODE = {
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1]
  };

  // --------------------------------------------------------------------------
  // Estado do módulo (somente a camada com DOM usa isto)
  // --------------------------------------------------------------------------

  var current = null;      // instância viva ligada à UI/render
  var uiBound = false;     // true só depois de R.UI.init
  var booted = false;
  var started = false;
  var loopOn = false;
  var reported = false;    // já reportou uma falha de integração no console
  var lastTs = 0;
  var fpsAvg = 0;
  var frameTick = 0;
  var els = { canvas: null, seed: null, lastPointer: null };

  // --------------------------------------------------------------------------
  // Helpers puros
  // --------------------------------------------------------------------------

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function intOr(v, def) {
    if (typeof v === 'string' && v !== '') v = Number(v);
    return isNum(v) ? Math.floor(v) : def;
  }

  function clampInt(v, lo, hi, def) {
    var n = intOr(v, def);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function nomeDe(ent) {
    var arch = (R.Ent && R.Ent.ARCH) ? R.Ent.ARCH[ent.kind] : null;
    if (arch && arch.nome) return arch.nome;
    return NOMES[ent.kind] || 'Criatura';
  }

  function feminino(ent) {
    return !!FEMININO[ent.kind];
  }

  function artigo(ent) {
    return feminino(ent) ? 'a' : 'o';
  }

  function artigoMaiusculo(ent) {
    return feminino(ent) ? 'A' : 'O';
  }

  function estadoPt(state) {
    return ESTADOS[state] || 'ocioso';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tileEm(map, x, y) {
    if (!R.MapGen.inBounds(map, x, y)) return R.C.TILE.WALL;
    return map.tiles[R.idx(map.w, x, y)];
  }

  // Sala que contém o tile (as folhas do BSP não se sobrepõem, logo a primeira
  // que casar é a única). Usado para narrar a movimentação no registro (R49).
  function salaEm(map, x, y) {
    var rooms = map ? map.rooms : null;
    if (!rooms) return null;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  function idDaSala(map, x, y) {
    var r = salaEm(map, x, y);
    return r ? r.id : null;
  }

  function formatoDaSala(shape) {
    return FORMATOS[shape] || 'irregular';
  }

  function enemyAt(game, x, y) {
    var list = game.enemies;
    for (var i = 0; i < list.length; i++) {
      if (list[i].hp > 0 && list[i].x === x && list[i].y === y) return list[i];
    }
    return null;
  }

  function itemIndexAt(game, x, y) {
    var list = game.items;
    for (var i = 0; i < list.length; i++) {
      if (list[i].x === x && list[i].y === y) return i;
    }
    return -1;
  }

  function reportOnce(err) {
    if (reported) return;
    reported = true;
    // Só reporta em navegador real (o harness headless não monta <body>).
    if (typeof document === 'undefined' || !document || !document.body) return;
    if (typeof console === 'undefined' || !console || !console.error) return;
    console.error('ISOROGUE: falha na camada de interface —', err);
  }

  // --------------------------------------------------------------------------
  // Registro (log)
  // --------------------------------------------------------------------------

  function logMsg(game, text, cls) {
    if (!game || !game.log) return null;
    var entry = {
      turn: game.turn,
      text: String(text),
      cls: (cls && CLASSES_LOG[cls]) ? cls : 'info'
    };
    game.log.push(entry);
    var excedente = game.log.length - R.C.MAX_LOG;
    if (excedente > 0) game.log.splice(0, excedente);
    if (uiBound && game === current && R.UI && R.UI.pushLog) {
      try { R.UI.pushLog(game, entry); } catch (e) { reportOnce(e); }
    }
    return entry;
  }

  function logNotasDoMapa(game, map) {
    if (!map || !map.notes) return;
    for (var i = 0; i < map.notes.length; i++) {
      logMsg(game, String(map.notes[i]), 'sistema');
    }
  }

  // --------------------------------------------------------------------------
  // Derivados do estado: Dijkstra, FOV, estatísticas
  // --------------------------------------------------------------------------

  function computeDmap(game) {
    // R.Dijkstra.compute recicla um buffer por objeto `map`; passamos um buffer
    // próprio para que nada mais possa sobrescrever game.dmap no meio do turno.
    var n = game.map.w * game.map.h;
    if (!game.dbuf || game.dbuf.length !== n) game.dbuf = new Int32Array(n);
    game.dmap = R.Dijkstra.compute(
      game.map,
      [{ x: game.player.x, y: game.player.y, v: 0 }],
      { blocked: null, out: game.dbuf }
    );
    // O gradiente de fuga é derivado do dmap e custa um re-scan iterativo:
    // invalida aqui e deixa R.Ent calculá-lo sob demanda (só quando há ferido).
    game.fleeMap = null;
  }

  function computeFov(game) {
    var vis = R.FOV.compute(game.map, game.player.x, game.player.y, R.C.FOV_RADIUS);
    game.visible = vis;
    var ex = game.explored;
    vis.forEach(function (i) {
      if (i >= 0 && i < ex.length) ex[i] = 1;
    });
  }

  function updateStats(game) {
    var s = game.stats;
    var tiles = game.map.tiles;
    var ex = game.explored;
    var total = 0;
    var vistos = 0;
    s.turns = game.turn;
    if (game.depth > s.deepest) s.deepest = game.depth;
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i] !== R.C.TILE.WALL) {
        total++;
        if (ex[i]) vistos++;
      }
    }
    s.explorePct = total > 0 ? Math.round((vistos / total) * 1000) / 10 : 0;
  }

  function refreshDerived(game) {
    computeDmap(game);
    computeFov(game);
    updateStats(game);
  }

  // --------------------------------------------------------------------------
  // Persistência (sempre tolerante a falhas)
  // --------------------------------------------------------------------------

  function autosave(game) {
    if (!game || game.over) return;
    try {
      if (R.Save && R.Save.write) R.Save.write(game);
    } catch (e) { /* localStorage indisponível não pode quebrar o jogo */ }
  }

  function apagarSave() {
    try {
      if (R.Save && R.Save.clear) R.Save.clear();
    } catch (e) { /* silencioso por contrato */ }
  }

  function gravarHistorico(game) {
    try {
      if (R.Save && R.Save.pushHistory) R.Save.pushHistory(game);
    } catch (e) { /* silencioso por contrato */ }
  }

  // --------------------------------------------------------------------------
  // Criação de estado
  // --------------------------------------------------------------------------

  function createState(seedStr, depth) {
    var d = intOr(depth, 1);
    if (d < 1) d = 1;
    var seed = R.normalizeSeed(seedStr);
    var map = R.MapGen.generate(seed, d);
    var pop = R.Ent.populate(map, d);

    var game = {
      seedStr: seed,
      depth: d,
      turn: 0,
      over: false,
      cause: '',
      causeKind: '',     // arquétipo do golpe fatal, gravado por R.Ent
      map: map,
      player: {
        x: map.start.x,
        y: map.start.y,
        hp: PLAYER_BASE.hp,
        maxHp: PLAYER_BASE.hp,
        atk: PLAYER_BASE.atk,
        potions: PLAYER_BASE.potions,
        level: 1,
        xp: 0
      },
      enemies: pop.enemies,
      items: pop.items,
      dmap: null,
      fleeMap: null,
      dbuf: null,
      visible: new Set(),
      explored: new Uint8Array(map.w * map.h),
      rngCombat: R.makeRNG(R.hash32(seed + '#combat' + d)),
      log: [],
      stats: {
        turns: 0,
        kills: 0,
        dmgDealt: 0,
        dmgTaken: 0,
        itemsUsed: 0,
        deepest: d,
        explorePct: 0
      },
      ui: { hover: null, debug: false, fovProbe: false, follow: true, fps: 0 },
      lastRoomId: null,  // sala em que o jogador está (log de movimentação, R49)
      emTurno: false     // trava de reentrância do fim de turno
    };
    game.lastRoomId = idDaSala(map, game.player.x, game.player.y);

    logMsg(game, 'Nível ' + d + ' — masmorra gerada com a semente ' + seed + '.', 'sistema');
    logNotasDoMapa(game, map);
    logMsg(game, 'Inimigos: ' + game.enemies.length + ' — poções no chão: ' + game.items.length + '.', 'sistema');
    refreshDerived(game);
    return game;
  }

  // --------------------------------------------------------------------------
  // Ações do jogador
  // --------------------------------------------------------------------------

  function xpPorAbate(ent) {
    var arch = (R.Ent && R.Ent.ARCH) ? R.Ent.ARCH[ent.kind] : null;
    if (arch && isNum(arch.xp)) return Math.max(1, Math.floor(arch.xp));
    return Math.max(1, Math.floor(intOr(ent.maxHp, 9) / 3));
  }

  function ganharXp(game, quanto) {
    var p = game.player;
    p.xp += quanto;
    while (p.xp >= p.level * XP_POR_NIVEL) {
      p.xp -= p.level * XP_POR_NIVEL;
      p.level += 1;
      p.maxHp += 4;
      p.hp = Math.min(p.maxHp, p.hp + 4);
      p.atk += 1;
      logMsg(game, 'Você alcança o nível ' + p.level + ' de experiência. Vida máxima ' +
        p.maxHp + ', ataque ' + p.atk + '.', 'bom');
    }
  }

  function removerInimigo(game, ent) {
    for (var i = 0; i < game.enemies.length; i++) {
      if (game.enemies[i] === ent) {
        game.enemies.splice(i, 1);
        return;
      }
    }
  }

  function atacarInimigo(game, ent) {
    var dmg = R.Ent.rollDamage(game.rngCombat, game.player.atk);
    ent.hp -= dmg;
    ent.lastDmg = dmg;
    ent.bump = 1;
    game.stats.dmgDealt += dmg;
    var nome = nomeDe(ent);
    if (ent.hp <= 0) {
      ent.hp = 0;
      removerInimigo(game, ent);
      game.stats.kills += 1;
      logMsg(game, 'Você abate ' + artigo(ent) + ' ' + nome + ' com ' + dmg + ' de dano.', 'bom');
      ganharXp(game, xpPorAbate(ent));
    } else {
      logMsg(game, 'Você atinge ' + artigo(ent) + ' ' + nome + ' por ' + dmg +
        ' de dano (' + ent.hp + '/' + ent.maxHp + ').', 'info');
    }
  }

  function pegarItem(game, explicito) {
    var p = game.player;
    var i = itemIndexAt(game, p.x, p.y);
    if (i < 0) {
      if (explicito) logMsg(game, 'Não há nada para recolher aqui.', 'aviso');
      return false;
    }
    game.items.splice(i, 1);
    p.potions += 1;
    logMsg(game, 'Você recolhe uma poção (' + p.potions + ' no total).', 'bom');
    return true;
  }

  // R49 (movimentação): um registro por passo viraria ruído em 400 linhas, então
  // narramos só a troca de sala. Corredores ficam silenciosos de propósito.
  function narrarSala(game) {
    var sala = salaEm(game.map, game.player.x, game.player.y);
    var id = sala ? sala.id : null;
    if (id === game.lastRoomId) return;
    game.lastRoomId = id;
    if (!sala) return;
    logMsg(game, 'Você entra na sala ' + sala.id + ' (' +
      formatoDaSala(sala.shape) + ').', 'info');
  }

  function mover(game, dx, dy) {
    if (dx === 0 && dy === 0) return false;
    var p = game.player;
    var map = game.map;
    var nx = p.x + dx;
    var ny = p.y + dy;
    if (!R.MapGen.inBounds(map, nx, ny)) return false;
    // Atacar vem ANTES do corte de canto: o alcance corpo a corpo do jogador é
    // Chebyshev 1, o mesmo que os arquétipos usam contra ele (§6). Se o teste de
    // canto viesse antes, numa quina de corredor o inimigo golpearia e o jogador
    // levaria um no-op mudo (§7: "mover para tile com inimigo = atacar").
    var alvo = enemyAt(game, nx, ny);
    if (alvo) {
      atacarInimigo(game, alvo);
      return true;
    }
    // Sem corte de canto na diagonal para o DESLOCAMENTO (mesma regra do
    // Dijkstra, §5).
    if (dx !== 0 && dy !== 0) {
      if (!R.MapGen.isWalkable(map, p.x + dx, p.y)) return false;
      if (!R.MapGen.isWalkable(map, p.x, p.y + dy)) return false;
    }
    if (!R.MapGen.isWalkable(map, nx, ny)) return false;
    p.x = nx;
    p.y = ny;
    narrarSala(game);
    pegarItem(game, false);
    if (tileEm(map, nx, ny) === R.C.TILE.STAIRS) {
      logMsg(game, 'Você pisa na escada. Use ">" ou Enter para descer ao nível ' +
        (game.depth + 1) + '.', 'aviso');
    }
    return true;
  }

  function esperar(game) {
    logMsg(game, 'Você aguarda, atento aos ruídos.', 'info');
    return true;
  }

  function usarPocao(game) {
    var p = game.player;
    if (p.potions <= 0) {
      logMsg(game, 'Você não tem poções.', 'aviso');
      return false;
    }
    if (p.hp >= p.maxHp) {
      logMsg(game, 'Sua vida já está completa.', 'aviso');
      return false;
    }
    p.potions -= 1;
    var cura = Math.min(POTION_HEAL, p.maxHp - p.hp);
    p.hp += cura;
    game.stats.itemsUsed += 1;
    logMsg(game, 'Você bebe uma poção e recupera ' + cura + ' de vida (' +
      p.hp + '/' + p.maxHp + ').', 'bom');
    return true;
  }

  function tentarDescer(game) {
    if (tileEm(game.map, game.player.x, game.player.y) !== R.C.TILE.STAIRS) {
      logMsg(game, 'Não há escada aqui.', 'aviso');
      return false;
    }
    descend(game);
    return true;
  }

  // --------------------------------------------------------------------------
  // Porta única de comandos
  // --------------------------------------------------------------------------

  function applyCommand(game, cmd) {
    if (!game || game.over) return false;
    if (typeof cmd !== 'string') return false;
    var c = cmd.trim();
    var consumiu = false;

    if (c.indexOf('move:') === 0) {
      var partes = c.slice(5).split(',');
      if (partes.length !== 2) return false;
      var dx = intOr(partes[0].trim(), NaN);
      var dy = intOr(partes[1].trim(), NaN);
      if (!isNum(dx) || !isNum(dy)) return false;
      if (dx < -1 || dx > 1 || dy < -1 || dy > 1) return false;
      consumiu = mover(game, dx, dy);
    } else if (c === 'wait') {
      consumiu = esperar(game);
    } else if (c === 'use') {
      consumiu = usarPocao(game);
    } else if (c === 'pickup') {
      consumiu = pegarItem(game, true);
    } else if (c === 'descend') {
      consumiu = tentarDescer(game);
    } else {
      return false;
    }

    if (consumiu) {
      // Trava de REENTRÂNCIA (não de chamador): impede que um endTurn disparado
      // de dentro do próprio turno resolva o turno duas vezes. Chamado de fora,
      // R.Game.endTurn segue fazendo a fase completa que o §7 promete.
      if (game.emTurno) return consumiu;
      game.emTurno = true;
      try {
        endTurn(game);
      } finally {
        game.emTurno = false;
      }
    }
    return consumiu;
  }

  // --------------------------------------------------------------------------
  // Fim de turno
  // --------------------------------------------------------------------------

  function narrarInimigos(game, estadosAnteriores, danoSofrido) {
    var i, e;
    for (i = 0; i < game.enemies.length; i++) {
      e = game.enemies[i];
      if (estadosAnteriores[e.id] !== 'flee' && e.state === 'flee') {
        logMsg(game, artigoMaiusculo(e) + ' ' + nomeDe(e) + ' recua ferid' +
          (feminino(e) ? 'a' : 'o') + '.', 'aviso');
      }
    }
    if (danoSofrido > 0) {
      logMsg(game, 'Você sofre ' + danoSofrido + ' de dano (' +
        Math.max(0, game.player.hp) + '/' + game.player.maxHp + ').', 'ruim');
    }
  }

  function acharAlgoz(game) {
    var lista = game.enemies;
    var i, e;
    var melhor = null;
    for (i = 0; i < lista.length; i++) {
      e = lista[i];
      if (e.hp > 0 && e.state === 'attack') {
        if (!melhor || e.id < melhor.id) melhor = e;
      }
    }
    if (melhor) return melhor;
    var melhorDist = Infinity;
    for (i = 0; i < lista.length; i++) {
      e = lista[i];
      if (e.hp <= 0) continue;
      var d = R.cheb(game.player.x, game.player.y, e.x, e.y);
      if (d < melhorDist || (d === melhorDist && melhor && e.id < melhor.id)) {
        melhorDist = d;
        melhor = e;
      }
    }
    return melhor;
  }

  function matarJogador(game) {
    var p = game.player;
    p.hp = 0;
    game.over = true;
    // Autoria: quem desferiu o golpe fatal é registrado por R.Ent.attackPlayer
    // em `game.causeKind` (só as entidades sabem disso no instante do golpe).
    // `acharAlgoz` é só o palpite de reserva — ele devolve o inimigo de menor id
    // em estado de ataque, que num turno com vários atacantes pode não ser o
    // autor. A tabela de gênero (FEMININO) mora aqui, então a frase é montada
    // aqui em ambos os casos.
    var algoz = null;
    if (game.causeKind && NOMES[game.causeKind]) algoz = { kind: game.causeKind };
    if (!algoz) algoz = acharAlgoz(game);
    game.cause = algoz
      ? ('Morto pel' + artigo(algoz) + ' ' + nomeDe(algoz) + ' no nível ' + game.depth)
      : ('Morto nas profundezas do nível ' + game.depth);
    logMsg(game, game.cause + '.', 'ruim');
    logMsg(game, 'Expedição encerrada no turno ' + game.turn + ' — ' + game.stats.kills +
      ' inimigos derrotados, ' + game.stats.explorePct + '% do nível explorado.', 'sistema');
    gravarHistorico(game);
    apagarSave();
    if (uiBound && game === current && R.UI && R.UI.showDeath) {
      try { R.UI.showDeath(game); } catch (e) { reportOnce(e); }
    }
  }

  function uiRefresh(game) {
    if (!uiBound || game !== current) return;
    try {
      if (R.UI && R.UI.refresh) R.UI.refresh(game);
      if (game.ui.debug && R.UI && R.UI.setDebug) R.UI.setDebug(game);
    } catch (e) { reportOnce(e); }
  }

  // §7: endTurn é a fase pós-ação — dmap -> inimigos -> FOV -> stats -> autosave.
  // Vale tanto para applyCommand quanto para um chamador externo do contrato.
  function endTurn(game) {
    if (!game || !game.map) return;
    // Run encerrada não avança mais nada; só revalida os derivados para a UI.
    if (game.over) {
      refreshDerived(game);
      uiRefresh(game);
      return;
    }

    game.turn += 1;

    // 1) mapa de Dijkstra único, recalculado a partir do jogador
    computeDmap(game);

    // 2) turno de todos os inimigos
    var hpAntes = game.player.hp;
    var danoAntes = game.stats.dmgTaken;
    var logAntes = game.log.length;
    var estadosAnteriores = {};
    var i;
    for (i = 0; i < game.enemies.length; i++) {
      estadosAnteriores[game.enemies[i].id] = game.enemies[i].state;
    }
    R.Ent.processEnemies(game);

    var sofrido = hpAntes - game.player.hp;
    if (sofrido > 0 && game.stats.dmgTaken === danoAntes) {
      // O módulo de entidades não contabilizou: contabiliza aqui.
      game.stats.dmgTaken += sofrido;
    }
    if (game.log.length === logAntes) {
      // O módulo de entidades não narrou nada: narra aqui.
      narrarInimigos(game, estadosAnteriores, sofrido);
    }

    // 3) campo de visão + 4) exploração
    computeFov(game);

    // 5) estatísticas
    updateStats(game);

    // 6) morte permanente / autosave
    if (game.player.hp <= 0) {
      matarJogador(game);
    } else {
      // Sobreviveu ao turno: a autoria de um golpe quase fatal não pode
      // sobrar para a morte seguinte.
      game.causeKind = '';
      autosave(game);
    }

    uiRefresh(game);
  }

  // --------------------------------------------------------------------------
  // Progressão de nível
  // --------------------------------------------------------------------------

  function descend(game) {
    if (!game || game.over) return;
    var depth = game.depth + 1;
    var map = R.MapGen.generate(game.seedStr, depth);
    var pop = R.Ent.populate(map, depth);
    var p = game.player;

    game.depth = depth;
    game.map = map;
    game.enemies = pop.enemies;
    game.items = pop.items;
    game.rngCombat = R.makeRNG(R.hash32(game.seedStr + '#combat' + depth));
    game.explored = new Uint8Array(map.w * map.h);
    game.visible = new Set();
    game.dmap = null;
    game.fleeMap = null;
    game.causeKind = '';   // nível novo, autoria do golpe fatal zerada

    p.x = map.start.x;
    p.y = map.start.y;
    game.lastRoomId = idDaSala(map, p.x, p.y);
    p.maxHp += HP_POR_DESCIDA;
    p.hp = Math.min(p.maxHp, p.hp + HP_POR_DESCIDA);

    if (depth > game.stats.deepest) game.stats.deepest = depth;

    logMsg(game, 'Você desce a escada e chega ao nível ' + depth + '.', 'sistema');
    logNotasDoMapa(game, map);
    logMsg(game, 'Inimigos: ' + game.enemies.length + ' — poções no chão: ' +
      game.items.length + '. Vida máxima agora ' + p.maxHp + '.', 'sistema');

    refreshDerived(game);
    autosave(game);
    if (uiBound && game === current) {
      centerCamera(game);
      uiRefresh(game);
    }
  }

  // --------------------------------------------------------------------------
  // Snapshot determinístico
  // --------------------------------------------------------------------------

  function checksumTiles(tiles) {
    var h = 2166136261;
    for (var i = 0; i < tiles.length; i++) {
      h ^= tiles[i];
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0)).toString(16);
  }

  function snapshot(game) {
    if (!game) return '';
    var p = game.player;
    var partes = [];
    partes.push('v1');
    partes.push('seed=' + game.seedStr);
    partes.push('d=' + game.depth);
    partes.push('t=' + game.turn);
    partes.push('over=' + (game.over ? 1 : 0));
    partes.push('p=' + p.x + ',' + p.y + ',' + p.hp + '/' + p.maxHp +
      ',atk' + p.atk + ',poc' + p.potions + ',lv' + p.level + ':' + p.xp);

    var inimigos = game.enemies.slice().sort(function (a, b) { return a.id - b.id; });
    var buf = [];
    var i, e, it;
    for (i = 0; i < inimigos.length; i++) {
      e = inimigos[i];
      buf.push(e.id + ':' + e.kind + ':' + e.hp + ':' + e.x + ':' + e.y);
    }
    partes.push('E[' + buf.join('|') + ']');

    var itens = game.items.slice().sort(function (a, b) { return a.id - b.id; });
    buf = [];
    for (i = 0; i < itens.length; i++) {
      it = itens[i];
      buf.push(it.id + ':' + it.x + ':' + it.y);
    }
    partes.push('I[' + buf.join('|') + ']');

    var s = game.stats;
    partes.push('S=' + s.turns + ',' + s.kills + ',' + s.dmgDealt + ',' + s.dmgTaken +
      ',' + s.itemsUsed + ',' + s.deepest + ',' + s.explorePct);
    partes.push('rng=' + ((game.rngCombat && isNum(game.rngCombat.s)) ? (game.rngCombat.s >>> 0) : 0));
    partes.push('map=' + checksumTiles(game.map.tiles));
    return partes.join('|');
  }

  // --------------------------------------------------------------------------
  // Restauração de save (o mapa é REGERADO pela seed+depth, nunca serializado)
  // --------------------------------------------------------------------------

  function decodificarExplored(destino, bruto) {
    var n = destino.length;
    var i, b;
    if (!bruto) return;

    if (typeof bruto === 'string') {
      var s = bruto;
      // Formato "0101..." com um caractere por tile.
      if (s.length === n && /^[01]+$/.test(s)) {
        for (i = 0; i < n; i++) destino[i] = s.charCodeAt(i) === 49 ? 1 : 0;
        return;
      }
      // Base64: um byte por tile, ou bitset compactado.
      var bin = null;
      try {
        if (typeof atob === 'function') bin = atob(s);
      } catch (e) { bin = null; }
      if (!bin) return;
      if (bin.length >= n) {
        for (i = 0; i < n; i++) destino[i] = bin.charCodeAt(i) ? 1 : 0;
      } else if (bin.length >= Math.ceil(n / 8)) {
        for (i = 0; i < n; i++) {
          b = bin.charCodeAt(i >> 3);
          destino[i] = (b >> (i & 7)) & 1;
        }
      }
      return;
    }

    if (typeof bruto === 'object') {
      var len = isNum(bruto.length) ? bruto.length : n;
      var lim = Math.min(n, len);
      for (i = 0; i < lim; i++) {
        var v = bruto[i];
        destino[i] = v ? 1 : 0;
      }
    }
  }

  function reconstruirInimigo(bruto, depth, map) {
    if (!bruto || typeof bruto !== 'object') return null;
    var kind = bruto.kind;
    if (kind !== 'chaser' && kind !== 'sentinel' && kind !== 'linker') return null;
    var arch = (R.Ent && R.Ent.ARCH) ? R.Ent.ARCH[kind] : null;
    var baseHp = arch && isNum(arch.hp) ? arch.hp : 10;
    var baseAtk = arch && isNum(arch.atk) ? arch.atk : 3;
    var baseRange = arch && isNum(arch.range) ? arch.range : 1;
    var maxHp = intOr(bruto.maxHp, baseHp + Math.floor(baseHp * 0.15 * (depth - 1)));
    if (maxHp < 1) maxHp = 1;
    var hp = clampInt(bruto.hp, 1, maxHp, maxHp);
    var x = intOr(bruto.x, -1);
    var y = intOr(bruto.y, -1);
    if (!R.MapGen.isWalkable(map, x, y)) return null;
    return {
      id: intOr(bruto.id, 0),
      kind: kind,
      x: x,
      y: y,
      hp: hp,
      maxHp: maxHp,
      atk: intOr(bruto.atk, baseAtk + Math.floor((depth - 1) / 2)),
      range: intOr(bruto.range, baseRange),
      state: (bruto.state && ESTADOS[bruto.state]) ? bruto.state : 'idle',
      plan: typeof bruto.plan === 'string' ? bruto.plan : 'aguarda',
      lastDmg: 0,
      bump: 0
    };
  }

  function reconstruirItem(bruto, map) {
    if (!bruto || typeof bruto !== 'object') return null;
    var x = intOr(bruto.x, -1);
    var y = intOr(bruto.y, -1);
    if (!R.MapGen.isWalkable(map, x, y)) return null;
    return {
      id: intOr(bruto.id, 0),
      kind: 'potion',
      x: x,
      y: y,
      heal: intOr(bruto.heal, POTION_HEAL)
    };
  }

  function restore(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var seed = (typeof obj.seed === 'string' && obj.seed) ? obj.seed :
      ((typeof obj.seedStr === 'string' && obj.seedStr) ? obj.seedStr : null);
    if (!seed) return null;
    if (obj.over) return null; // morte permanente: run encerrada não retoma
    var depth = intOr(obj.depth, 1);
    if (depth < 1) depth = 1;

    var game;
    try {
      game = createState(seed, depth);
    } catch (e) {
      return null;
    }

    var map = game.map;
    var i, ent, it;

    // Registro salvo substitui as notas recém-geradas.
    game.log.length = 0;
    if (obj.log && obj.log.length) {
      for (i = 0; i < obj.log.length; i++) {
        var l = obj.log[i];
        if (!l || typeof l !== 'object') continue;
        game.log.push({
          turn: intOr(l.turn, 0),
          text: String(l.text == null ? '' : l.text),
          cls: (l.cls && CLASSES_LOG[l.cls]) ? l.cls : 'info'
        });
      }
      var excedente = game.log.length - R.C.MAX_LOG;
      if (excedente > 0) game.log.splice(0, excedente);
    }

    game.turn = Math.max(0, intOr(obj.turn, 0));

    // Jogador
    var sp = (obj.player && typeof obj.player === 'object') ? obj.player : {};
    var p = game.player;
    p.maxHp = Math.max(1, intOr(sp.maxHp, p.maxHp));
    p.hp = clampInt(sp.hp, 1, p.maxHp, p.maxHp);
    p.atk = Math.max(1, intOr(sp.atk, p.atk));
    p.potions = Math.max(0, intOr(sp.potions, p.potions));
    p.level = Math.max(1, intOr(sp.level, 1));
    p.xp = Math.max(0, intOr(sp.xp, 0));
    var px = intOr(sp.x, p.x);
    var py = intOr(sp.y, p.y);
    if (R.MapGen.isWalkable(map, px, py)) {
      p.x = px;
      p.y = py;
    }

    // Inimigos (sem duplicar tile, nunca sobre o jogador)
    if (obj.enemies && obj.enemies.length != null) {
      var ocupados = new Set();
      ocupados.add(R.idx(map.w, p.x, p.y));
      var novos = [];
      for (i = 0; i < obj.enemies.length; i++) {
        ent = reconstruirInimigo(obj.enemies[i], depth, map);
        if (!ent) continue;
        var k = R.idx(map.w, ent.x, ent.y);
        if (ocupados.has(k)) continue;
        ocupados.add(k);
        novos.push(ent);
      }
      novos.sort(function (a, b) { return a.id - b.id; });
      game.enemies = novos;
    }

    // Itens
    if (obj.items && obj.items.length != null) {
      var itens = [];
      for (i = 0; i < obj.items.length; i++) {
        it = reconstruirItem(obj.items[i], map);
        if (it) itens.push(it);
      }
      itens.sort(function (a, b) { return a.id - b.id; });
      game.items = itens;
    }

    // Exploração
    decodificarExplored(game.explored, obj.explored);

    // Estatísticas
    var ss = (obj.stats && typeof obj.stats === 'object') ? obj.stats : {};
    var st = game.stats;
    st.turns = Math.max(0, intOr(ss.turns, game.turn));
    st.kills = Math.max(0, intOr(ss.kills, 0));
    st.dmgDealt = Math.max(0, intOr(ss.dmgDealt, 0));
    st.dmgTaken = Math.max(0, intOr(ss.dmgTaken, 0));
    st.itemsUsed = Math.max(0, intOr(ss.itemsUsed, 0));
    st.deepest = Math.max(depth, intOr(ss.deepest, depth));

    // Estado do RNG de combate
    var s = obj.rngCombat;
    if (s && typeof s === 'object' && isNum(s.s)) s = s.s;
    if (s == null) s = obj.rngCombatS;
    if (s == null) s = obj.rng;
    if (s && typeof s === 'object' && isNum(s.s)) s = s.s;
    if (isNum(s) && game.rngCombat) game.rngCombat.s = s >>> 0;

    game.emTurno = false;
    game.causeKind = '';
    game.lastRoomId = idDaSala(map, p.x, p.y);
    refreshDerived(game);
    game.stats.turns = game.turn;
    return game;
  }

  function carregarSave() {
    var bruto = null;
    try {
      if (R.Save && R.Save.read) bruto = R.Save.read();
    } catch (e) { bruto = null; }
    if (!bruto) return null;
    var g = null;
    try {
      g = restore(bruto);
    } catch (e) { g = null; }
    return g;
  }

  // --------------------------------------------------------------------------
  // Camada com DOM
  // --------------------------------------------------------------------------

  function byId(id) {
    if (typeof document === 'undefined' || !document || !document.getElementById) return null;
    return document.getElementById(id);
  }

  function campoSemente() {
    if (els.seed && typeof els.seed.value === 'string') return els.seed.value;
    return current ? current.seedStr : '';
  }

  function setCampoSemente(v) {
    if (els.seed) {
      try { els.seed.value = v; } catch (e) { /* stub sem setter */ }
    }
  }

  function centerCamera(game) {
    if (!R.Render || !R.Render.cam || !game) return;
    var cam = R.Render.cam;
    var isoX = (game.player.x - game.player.y) * (R.C.TW / 2);
    var isoY = (game.player.x + game.player.y) * (R.C.TH / 2);
    cam.x = isoX;
    cam.y = isoY;
    if ('tx' in cam) cam.tx = isoX;
    if ('ty' in cam) cam.ty = isoY;
  }

  function adotarEstado(alvo, novo) {
    alvo.seedStr = novo.seedStr;
    alvo.depth = novo.depth;
    alvo.turn = novo.turn;
    alvo.over = novo.over;
    alvo.cause = novo.cause;
    alvo.causeKind = novo.causeKind;
    alvo.map = novo.map;
    alvo.player = novo.player;
    alvo.enemies = novo.enemies;
    alvo.items = novo.items;
    alvo.dmap = novo.dmap;
    alvo.fleeMap = novo.fleeMap;
    alvo.visible = novo.visible;
    alvo.explored = novo.explored;
    alvo.rngCombat = novo.rngCombat;
    alvo.log = novo.log;
    alvo.stats = novo.stats;
    alvo.lastRoomId = novo.lastRoomId;
    alvo.emTurno = false;
    // Preferências de interface sobrevivem à troca de partida.
    alvo.ui.hover = null;
    if (!isNum(alvo.ui.fps)) alvo.ui.fps = 0;
    return alvo;
  }

  function recarregarUI(game) {
    if (!uiBound) return;
    try {
      if (R.UI && R.UI.hideDeath) R.UI.hideDeath();
      if (R.UI && R.UI.hideTooltip) R.UI.hideTooltip();
      if (R.UI && R.UI.rebuildLog) R.UI.rebuildLog(game);
      if (R.UI && R.UI.refresh) R.UI.refresh(game);
      if (R.UI && R.UI.setDebug) R.UI.setDebug(game);
    } catch (e) { reportOnce(e); }
  }

  function newRun(seedStr) {
    var novo = createState(seedStr, 1);
    if (current) adotarEstado(current, novo);
    else current = novo;
    Game.state = current;
    logMsg(current, 'Nova expedição iniciada.', 'sistema');
    setCampoSemente(current.seedStr);
    recarregarUI(current);
    centerCamera(current);
    autosave(current);
    return current;
  }

  // A cópia em si é feita pela UI (dona do DOM e do fallback de seleção).
  // Aqui só registramos no log o resultado que ela reportou — nunca escrevemos
  // na área de transferência em paralelo.
  function registrarCopia(info) {
    var texto = '';
    var ok = true;
    if (info && typeof info === 'object') {
      texto = typeof info.texto === 'string' ? info.texto : '';
      ok = !!info.ok;
    } else if (typeof info === 'string') {
      texto = info;
    }
    if (!texto) texto = campoSemente() || (current ? current.seedStr : '');
    logMsg(current, ok ? ('Semente copiada: ' + texto)
      : ('Não foi possível copiar automaticamente. Semente selecionada: ' + texto),
      'sistema');
  }

  var handlers = {
    onGerar: function (semente) {
      newRun(semente == null ? campoSemente() : semente);
    },
    onAleatoria: function () {
      var s = R.newSeedString();
      setCampoSemente(s);
      newRun(s);
    },
    onCopiar: function (info) {
      registrarCopia(info);
    },
    onNova: function () {
      var s = R.newSeedString();
      setCampoSemente(s);
      newRun(s);
    }
  };

  // ---- teclado -------------------------------------------------------------

  function ehCampoDeTexto(el) {
    if (!el) return false;
    if (el.id === 'seed') return true;
    if (el.isContentEditable) return true;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function elementoFocado() {
    if (typeof document === 'undefined' || !document) return null;
    return document.activeElement || null;
  }

  function acaoDaTecla(lk, e) {
    // §10 dá `D` ao movimento e ao debug ao mesmo tempo. Mantemos W-A-S-D
    // intacto e o painel em Shift+D, com `F3` como atalho de tecla única para
    // quem seguir o R50 ao pé da letra.
    if (lk === 'd' && e.shiftKey) return 'debug';
    if (lk === 'f3') return 'debug';
    switch (lk) {
      case '.':
      case ',':
      case ' ':
      case 'spacebar':
      case '5':
        return 'wait';
      case 'h':
      case '1':
        return 'use';
      case '>':
        return 'descend';
      case 'enter':
      case 'return':
        return 'descend';
      case 'v':
        return 'fov';
      case 'f':
        return 'follow';
      case 'n':
        return 'nova';
      case '+':
      case '=':
        return 'zoomin';
      case '-':
      case '_':
        return 'zoomout';
      default:
        return null;
    }
  }

  function zoomBy(fator) {
    if (!R.Render || !R.Render.setZoom) return;
    var cam = R.Render.cam || {};
    var base = isNum(cam.tzoom) ? cam.tzoom : (isNum(cam.zoom) ? cam.zoom : 1);
    R.Render.setZoom(R.clamp(base * fator, R.C.ZOOM_MIN, R.C.ZOOM_MAX));
  }

  function comando(cmd) {
    if (!current) return;
    applyCommand(current, cmd);
  }

  function handleKey(e) {
    if (!current || !e) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ehCampoDeTexto(e.target) || ehCampoDeTexto(elementoFocado())) return;

    var code = typeof e.code === 'string' ? e.code : '';
    var key = typeof e.key === 'string' ? e.key : '';
    var mv = null;
    var acao = null;

    if (code.indexOf('Numpad') === 0) {
      if (MOVE_CODE[code]) mv = MOVE_CODE[code];
      else if (code === 'Numpad5' || code === 'NumpadDecimal') acao = 'wait';
      else if (code === 'NumpadAdd') acao = 'zoomin';
      else if (code === 'NumpadSubtract') acao = 'zoomout';
      else if (code === 'NumpadEnter') acao = 'descend';
    } else {
      var lk = key.toLowerCase();
      var mk = key.length === 1 ? lk : key;
      if (MOVE_KEY[mk] && !(mk === 'd' && e.shiftKey)) mv = MOVE_KEY[mk];
      else acao = acaoDaTecla(lk, e);
    }

    // Nunca deixar a página rolar com setas/espaço.
    if (key === ' ' || key === 'Spacebar' || key.indexOf('Arrow') === 0) {
      if (e.preventDefault) e.preventDefault();
    }
    if (!mv && !acao) return;
    if (e.preventDefault) e.preventDefault();

    if (mv) {
      comando('move:' + mv[0] + ',' + mv[1]);
      return;
    }

    switch (acao) {
      case 'wait':
        comando('wait');
        break;
      case 'use':
        comando('use');
        break;
      case 'descend':
        comando('descend');
        break;
      case 'debug':
        current.ui.debug = !current.ui.debug;
        logMsg(current, current.ui.debug ? 'Painel de depuração ligado.'
          : 'Painel de depuração desligado.', 'sistema');
        try {
          if (R.UI && R.UI.setDebug) R.UI.setDebug(current);
        } catch (err) { reportOnce(err); }
        break;
      case 'fov':
        current.ui.fovProbe = !current.ui.fovProbe;
        logMsg(current, current.ui.fovProbe ? 'Sonda de campo de visão ligada.'
          : 'Sonda de campo de visão desligada.', 'sistema');
        break;
      case 'follow':
        current.ui.follow = !current.ui.follow;
        logMsg(current, current.ui.follow ? 'Câmera seguindo o jogador.'
          : 'Câmera livre.', 'sistema');
        break;
      case 'nova':
        newRun(campoSemente());
        break;
      case 'zoomin':
        zoomBy(ZOOM_STEP);
        break;
      case 'zoomout':
        zoomBy(1 / ZOOM_STEP);
        break;
      default:
        break;
    }
  }

  // ---- mouse ---------------------------------------------------------------

  function posNoCanvas(e) {
    var cv = els.canvas;
    var left = 0;
    var top = 0;
    if (cv && cv.getBoundingClientRect) {
      var r = cv.getBoundingClientRect();
      if (r) {
        left = r.left || 0;
        top = r.top || 0;
      }
    }
    return { sx: (e.clientX || 0) - left, sy: (e.clientY || 0) - top };
  }

  function tooltipHtml(game, ent) {
    var i = R.idx(game.map.w, ent.x, ent.y);
    var d = game.dmap ? game.dmap[i] : null;
    var dv = (d == null || d >= R.Dijkstra.INF) ? 'inalcançável' : String(d);
    var dist = R.cheb(game.player.x, game.player.y, ent.x, ent.y);
    return '<div class="tt-nome">' + esc(nomeDe(ent)) + '</div>' +
      '<div>Vida ' + ent.hp + '/' + ent.maxHp + '</div>' +
      '<div>Distância ' + dist + '</div>' +
      '<div>Dijkstra ' + esc(dv) + '</div>' +
      '<div>Estado: ' + esc(estadoPt(ent.state)) + '</div>' +
      '<div>Ação: ' + esc(ent.plan ? ent.plan : 'sem plano') + '</div>';
  }

  function atualizarTooltip(clientX, clientY) {
    if (!uiBound || !R.UI || !current) return;
    var h = current.ui.hover;
    var ent = null;
    if (h) {
      var i = R.idx(current.map.w, h.x, h.y);
      if (current.visible && current.visible.has(i)) ent = enemyAt(current, h.x, h.y);
    }
    try {
      if (ent && R.UI.showTooltip) R.UI.showTooltip(tooltipHtml(current, ent), clientX, clientY);
      else if (R.UI.hideTooltip) R.UI.hideTooltip();
    } catch (e) { reportOnce(e); }
  }

  // Reprojeta a última posição de tela do ponteiro para um tile e atualiza o
  // realce. Devolve true se o tile sob o ponteiro mudou. Só mexe em ui.hover
  // (dado de interface), nunca no estado lógico — R54 preservado.
  function reprojetarPonteiro() {
    var lp = els.lastPointer;
    if (!current || !lp || !R.Render || !R.Render.screenToTile) return false;
    var t = R.Render.screenToTile(current, lp.sx, lp.sy);
    var h = current.ui.hover;
    if (t && R.MapGen.inBounds(current.map, t.x, t.y)) {
      if (h && h.x === t.x && h.y === t.y) return false;
      current.ui.hover = { x: t.x, y: t.y };
      return true;
    }
    if (!h) return false;
    current.ui.hover = null;
    return true;
  }

  function onMouseMove(e) {
    if (!current || !R.Render || !R.Render.screenToTile) return;
    var pos = posNoCanvas(e);
    els.lastPointer = {
      sx: pos.sx,
      sy: pos.sy,
      clientX: e.clientX || 0,
      clientY: e.clientY || 0
    };
    reprojetarPonteiro();
    atualizarTooltip(els.lastPointer.clientX, els.lastPointer.clientY);
  }

  function onMouseLeave() {
    if (!current) return;
    els.lastPointer = null;
    current.ui.hover = null;
    if (uiBound && R.UI && R.UI.hideTooltip) {
      try { R.UI.hideTooltip(); } catch (e) { reportOnce(e); }
    }
  }

  function onWheel(e) {
    if (!current) return;
    if (e.preventDefault) e.preventDefault();
    var dy = isNum(e.deltaY) ? e.deltaY : 0;
    if (dy === 0) return;
    zoomBy(dy < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  // Clique em tile adjacente move/ataca; clique sobre a própria escada desce.
  function onClick(e) {
    if (!current || current.over || !R.Render || !R.Render.screenToTile) return;
    var pos = posNoCanvas(e);
    var t = R.Render.screenToTile(current, pos.sx, pos.sy);
    if (!t || !R.MapGen.inBounds(current.map, t.x, t.y)) return;
    var dx = t.x - current.player.x;
    var dy = t.y - current.player.y;
    if (dx === 0 && dy === 0) {
      if (tileEm(current.map, t.x, t.y) === R.C.TILE.STAIRS) comando('descend');
      return;
    }
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) comando('move:' + dx + ',' + dy);
  }

  function onResize() {
    if (R.Render && R.Render.resize) R.Render.resize();
  }

  // ---- laço de animação (jamais altera estado lógico — R54) ----------------

  function frame(ts) {
    if (!loopOn) return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
    var t = isNum(ts) ? ts : lastTs + 16.6667;
    var dt = lastTs === 0 ? (1 / 60) : (t - lastTs) / 1000;
    lastTs = t;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;

    var inst = 1 / dt;
    fpsAvg = fpsAvg === 0 ? inst : fpsAvg + (inst - fpsAvg) * 0.08;
    frameTick++;

    if (!current) return;
    current.ui.fps = Math.round(fpsAvg);
    Game.fps = current.ui.fps;
    try {
      if (R.Render.update) R.Render.update(current, dt);
      // A câmera anda sozinha a cada passo (R09), então o tile sob um ponteiro
      // PARADO muda de quadro em quadro. Reprojetamos com a câmera já lerpada
      // deste quadro e antes de desenhar; sem isso o realce âmbar (R11), a sonda
      // de FOV (R28), o campo "cursor" do debug (R51) e o tooltip (R52) ficariam
      // presos no tile antigo. Custo O(1) por quadro e nada de estado lógico (R54).
      if (reprojetarPonteiro()) {
        atualizarTooltip(els.lastPointer.clientX, els.lastPointer.clientY);
      }
      if (R.Render.draw) R.Render.draw(current);
      if (current.ui.debug && (frameTick % 6 === 0) && R.UI && R.UI.setDebug) {
        R.UI.setDebug(current);
      }
    } catch (err) {
      loopOn = false;
      if (typeof console !== 'undefined' && console && console.error) {
        console.error('ISOROGUE: laço de desenho interrompido —', err);
      }
    }
  }

  function startLoop() {
    if (loopOn) return;
    if (typeof requestAnimationFrame !== 'function') return;
    loopOn = true;
    lastTs = 0;
    requestAnimationFrame(frame);
  }

  function attachListeners() {
    if (typeof window !== 'undefined' && window && window.addEventListener) {
      window.addEventListener('keydown', handleKey, false);
      window.addEventListener('resize', onResize, false);
    }
    var cv = els.canvas;
    if (cv && cv.addEventListener) {
      cv.addEventListener('mousemove', onMouseMove, false);
      cv.addEventListener('mouseleave', onMouseLeave, false);
      cv.addEventListener('mousedown', onClick, false);
      // O módulo de render já liga o zoom por roda no próprio canvas (§8).
      // Registrar aqui também dobraria o zoom a cada entalhe.
      if (!(R.Render && R.Render.handlesWheel)) {
        try {
          cv.addEventListener('wheel', onWheel, { passive: false });
        } catch (e) {
          cv.addEventListener('wheel', onWheel, false);
        }
      }
      cv.addEventListener('contextmenu', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
      }, false);
    }
  }

  function startInner() {
    if (started) return;
    started = true;
    els.canvas = byId('cv');
    els.seed = byId('seed');

    var retomado = carregarSave();
    current = retomado || createState(R.newSeedString(), 1);
    Game.state = current;

    if (els.canvas && R.Render && R.Render.init) R.Render.init(els.canvas);
    if (R.UI && R.UI.init) R.UI.init(current, handlers);
    uiBound = true;

    setCampoSemente(current.seedStr);
    if (retomado) {
      logMsg(current, 'Expedição retomada no nível ' + current.depth +
        ', turno ' + current.turn + '.', 'sistema');
    } else {
      logMsg(current, 'Nova expedição. Semente ' + current.seedStr + '.', 'sistema');
    }

    recarregarUI(current);
    attachListeners();
    centerCamera(current);
    if (R.Render && R.Render.resize) R.Render.resize();
    autosave(current);
    startLoop();
  }

  function start() {
    try {
      startInner();
    } catch (err) {
      reportOnce(err);
    }
  }

  function boot() {
    if (booted) return;
    if (typeof document === 'undefined' || !document) return;
    booted = true;
    if (document.readyState && document.readyState !== 'loading') {
      start();
    } else if (document.addEventListener) {
      document.addEventListener('DOMContentLoaded', start, false);
    } else {
      start();
    }
  }

  // --------------------------------------------------------------------------
  // API pública
  // --------------------------------------------------------------------------

  Game.createState = createState;
  Game.applyCommand = applyCommand;
  Game.endTurn = endTurn;
  Game.snapshot = snapshot;
  Game.descend = descend;
  Game.logMsg = logMsg;
  Game.restore = restore;
  Game.boot = boot;
  Game.newRun = newRun;
  Game.state = null;
  Game.fps = 0;
  Game.getState = function () { return current; };

  boot();

})(window.R = window.R || {});
