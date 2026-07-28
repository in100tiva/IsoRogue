/* ISOROGUE — camada de interface (HUD, registro, tooltip, depuração, morte)
   e persistência local (R.Save).

   Regras respeitadas neste módulo:
   - Nenhum acesso a DOM no top-level: tudo acontece dentro de R.UI.init e
     das funções chamadas depois dela.
   - Os elementos são resolvidos UMA vez em init e ficam em cache; nada de
     getElementById/querySelector por frame.
   - Nada aqui influencia o estado lógico do jogo: a UI só lê `game`.
   - Todo acesso a localStorage vive dentro de try/catch. */
(function (R) {
  'use strict';

  /* ------------------------------------------------------------ constantes */

  var IDS = [
    'cv', 'seed', 'btn-gerar', 'btn-aleatoria', 'btn-copiar', 'log',
    'hud-vida', 'hud-vida-barra', 'hud-nivel', 'hud-turno', 'hud-atk', 'hud-pocoes',
    'map-conect', 'map-salas', 'map-inimigos', 'map-itens', 'map-visiveis',
    'tooltip', 'debug', 'morte', 'morte-corpo', 'btn-nova'
  ];

  var CLASSES_LOG = { info: 1, bom: 1, ruim: 1, aviso: 1, sistema: 1 };

  var NOME_TILE = ['parede', 'piso', 'porta', 'escada'];

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_INV = null;

  /* --------------------------------------------------------------- estado */

  var doc = null;          // referência ao document, resolvida em init
  var el = null;           // cache de elementos por id
  var handlers = {};       // callbacks fornecidos pelo módulo de jogo
  var ligado = false;      // eventos já conectados?
  var cache = {};          // último texto escrito em cada nó (evita reflow à toa)
  var linhasLog = 0;       // quantas linhas existem no #log
  var sementeSuja = false; // o jogador editou o campo de semente à mão?
  var rotuloCopiar = 'Copiar';
  var timerCopia = 0;


  /* --------------------------------------------------------------- utils */

  function getDoc() {
    if (typeof document !== 'undefined' && document) return document;
    if (typeof window !== 'undefined' && window && window.document) return window.document;
    return null;
  }

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  function inteiro(v) {
    return Math.round(num(v));
  }

  function maxLog() {
    return (R.C && num(R.C.MAX_LOG)) ? R.C.MAX_LOG : 400;
  }

  function chaveSave() {
    return (R.C && R.C.STORAGE_KEY) ? R.C.STORAGE_KEY : 'isorogue.save.v1';
  }

  function chaveHistorico() {
    return (R.C && R.C.HISTORY_KEY) ? R.C.HISTORY_KEY : 'isorogue.history.v1';
  }

  function tileParede() {
    return (R.C && R.C.TILE && typeof R.C.TILE.WALL === 'number') ? R.C.TILE.WALL : 0;
  }

  // Formata um valor JÁ em escala 0..100 como percentual pt-BR.
  function pctBruto(p, casas) {
    if (typeof p !== 'number' || !isFinite(p)) return '—';
    var c = (typeof casas === 'number') ? casas : 1;
    if (p >= 99.995) return '100%';
    if (p <= 0) return '0%';
    return p.toFixed(c).replace('.', ',') + '%';
  }

  // Formata uma fração 0..1 (formato de `map.connectivity`) como percentual.
  function pct(v, casas) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return pctBruto(v <= 1 ? v * 100 : v, casas);
  }

  function chamar(nome, arg) {
    var fn = handlers ? handlers[nome] : null;
    if (typeof fn !== 'function') return;
    // O jogo é dono do erro dele; a UI só não pode derrubar o clique.
    try { fn(arg); } catch (e) { /* silencioso por contrato: zero ruído no console */ }
  }

  function ouvir(no, evento, fn) {
    if (no && typeof no.addEventListener === 'function') no.addEventListener(evento, fn, false);
  }

  function temClasse(no) {
    return !!(no && no.classList && typeof no.classList.add === 'function' &&
      typeof no.classList.remove === 'function');
  }

  function marcarClasse(no, classe, ativo) {
    if (!temClasse(no)) return;
    if (ativo) no.classList.add(classe);
    else no.classList.remove(classe);
  }

  function setTexto(id, valor) {
    var no = el ? el[id] : null;
    if (!no) return;
    var s = (valor === null || valor === undefined) ? '—' : String(valor);
    if (cache[id] === s) return;
    cache[id] = s;
    try { no.textContent = s; } catch (e) { /* stub sem textContent */ }
  }

  function setLargura(id, porcento) {
    var no = el ? el[id] : null;
    if (!no || !no.style) return;
    var s = Math.max(0, Math.min(100, num(porcento))).toFixed(1) + '%';
    if (cache['larg:' + id] === s) return;
    cache['larg:' + id] = s;
    try { no.style.width = s; } catch (e) { /* stub sem style */ }
  }

  function criar(tag, classe, texto) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    var no;
    try { no = doc.createElement(tag); } catch (e) { return null; }
    if (!no) return null;
    if (classe) no.className = classe;
    if (texto !== undefined && texto !== null) no.textContent = String(texto);
    return no;
  }

  function anexar(pai, filho) {
    if (pai && filho && typeof pai.appendChild === 'function') pai.appendChild(filho);
  }

  function limpar(no) {
    if (!no) return;
    try { no.textContent = ''; } catch (e) { /* stub */ }
  }

  function inimigosVivos(game) {
    var lista = game && game.enemies;
    if (!lista || typeof lista.length !== 'number') return 0;
    var n = 0;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] && num(lista[i].hp) > 0) n++;
    }
    return n;
  }

  // Percentual de tiles caminháveis já explorados no nível atual.
  function exploracao(game) {
    var map = game ? game.map : null;
    if (map && game.explored && map.tiles && typeof map.w === 'number') {
      var parede = tileParede();
      var total = 0, vistos = 0;
      var n = map.w * map.h;
      for (var i = 0; i < n; i++) {
        if (map.tiles[i] !== parede) {
          total++;
          if (game.explored[i]) vistos++;
        }
      }
      if (total > 0) return (vistos / total) * 100;
    }
    var st = game ? game.stats : null;
    if (st && typeof st.explorePct === 'number' && isFinite(st.explorePct)) {
      return st.explorePct <= 1 ? st.explorePct * 100 : st.explorePct;
    }
    return 0;
  }

  /* ------------------------------------------------------------ base64 puro
     Implementação própria porque `btoa` pode não existir no sandbox headless
     usado pelos testes — e o autosave roda lá também. */

  function bytesParaB64(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return '';
    var n = bytes.length, i = 0, out = '', a, b, c;
    while (i + 2 < n) {
      a = bytes[i] & 255; b = bytes[i + 1] & 255; c = bytes[i + 2] & 255;
      out += B64.charAt(a >> 2) +
             B64.charAt(((a & 3) << 4) | (b >> 4)) +
             B64.charAt(((b & 15) << 2) | (c >> 6)) +
             B64.charAt(c & 63);
      i += 3;
    }
    var resto = n - i;
    if (resto === 1) {
      a = bytes[i] & 255;
      out += B64.charAt(a >> 2) + B64.charAt((a & 3) << 4) + '==';
    } else if (resto === 2) {
      a = bytes[i] & 255; b = bytes[i + 1] & 255;
      out += B64.charAt(a >> 2) +
             B64.charAt(((a & 3) << 4) | (b >> 4)) +
             B64.charAt((b & 15) << 2) + '=';
    }
    return out;
  }

  function b64ParaBytes(str, tamanho) {
    if (typeof str !== 'string') return null;
    if (!B64_INV) {
      B64_INV = {};
      for (var k = 0; k < B64.length; k++) B64_INV[B64.charAt(k)] = k;
    }
    var limpo = str.replace(/[^A-Za-z0-9+/]/g, '');
    var total = (typeof tamanho === 'number' && tamanho > 0)
      ? tamanho
      : Math.floor(limpo.length * 3 / 4);
    var out = new Uint8Array(total);
    var p = 0, acc = 0, bits = 0;
    for (var i = 0; i < limpo.length && p < total; i++) {
      var v = B64_INV[limpo.charAt(i)];
      if (v === undefined) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[p++] = (acc >> bits) & 255;
      }
    }
    return out;
  }

  /* ----------------------------------------------------------------- init */

  function init(game, hs) {
    doc = getDoc();
    handlers = hs || {};
    cache = {};
    if (!doc || typeof doc.getElementById !== 'function') { el = null; return; }

    el = {};
    for (var i = 0; i < IDS.length; i++) {
      el[IDS[i]] = doc.getElementById(IDS[i]);
    }

    if (!ligado) {
      conectarEventos();
      ligado = true;
    }

    if (el.seed && typeof el.seed.value === 'string' && game && game.seedStr) {
      el.seed.value = game.seedStr;
    }
    sementeSuja = false;

    hideTooltip();
    hideDeath();
    rebuildLog(game);
    refresh(game);
  }

  function conectarEventos() {
    ouvir(el['btn-gerar'], 'click', function () {
      sementeSuja = false;
      chamar('onGerar', valorSemente());
    });

    ouvir(el['btn-aleatoria'], 'click', function () {
      sementeSuja = false;
      chamar('onAleatoria');
    });

    // A cópia é responsabilidade da UI (contrato, seção 9). O jogo é avisado
    // pelo handler onCopiar com o resultado real — nunca copia por conta própria,
    // senão haveria duas escritas concorrentes na área de transferência.
    ouvir(el['btn-copiar'], 'click', function () {
      copiarSemente();
    });

    ouvir(el['btn-nova'], 'click', function () {
      hideDeath();
      chamar('onNova');
    });

    // Enquanto o foco está no campo de semente, o teclado é do campo — o jogo
    // não deve receber essas teclas (contrato, seção 10).
    ouvir(el.seed, 'keydown', function (ev) {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      if (!ev) return;
      if (ev.key === 'Enter') {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        sementeSuja = false;
        chamar('onGerar', valorSemente());
      }
    });
    ouvir(el.seed, 'keyup', pararPropagacao);
    ouvir(el.seed, 'keypress', pararPropagacao);
    ouvir(el.seed, 'input', function () { sementeSuja = true; });
  }

  function pararPropagacao(ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  }

  function valorSemente() {
    var campo = el ? el.seed : null;
    return (campo && typeof campo.value === 'string') ? campo.value : '';
  }

  /* -------------------------------------------------------------- semente */

  function copiarSemente() {
    var campo = el ? el.seed : null;
    var texto = valorSemente();
    if (!texto) return;
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        var p = nav.clipboard.writeText(texto);
        if (p && typeof p.then === 'function') {
          // Promessa SEMPRE tratada: nada de rejeição solta no console.
          p.then(
            function () { avisoCopia(true, texto); },
            function () { copiaAlternativa(campo, texto); }
          );
        } else {
          avisoCopia(true, texto);
        }
        return;
      }
    } catch (e) { /* cai no plano B */ }
    copiaAlternativa(campo, texto);
  }

  function copiaAlternativa(campo, texto) {
    var ok = false;
    try {
      if (campo && typeof campo.select === 'function') {
        campo.focus();
        campo.select();
        if (typeof campo.setSelectionRange === 'function') {
          campo.setSelectionRange(0, valorSemente().length);
        }
        if (doc && typeof doc.execCommand === 'function') {
          ok = !!doc.execCommand('copy');
        }
      }
    } catch (e) { ok = false; }
    avisoCopia(ok, texto);
  }

  function avisoCopia(ok, texto) {
    // O jogo registra no log a partir do resultado REAL da cópia.
    chamar('onCopiar', { texto: (texto == null ? valorSemente() : texto), ok: !!ok });
    var botao = el ? el['btn-copiar'] : null;
    if (!botao) return;
    try {
      botao.textContent = ok ? 'Copiada' : 'Selecionada';
      if (typeof setTimeout === 'function') {
        if (timerCopia && typeof clearTimeout === 'function') clearTimeout(timerCopia);
        timerCopia = setTimeout(function () {
          timerCopia = 0;
          try { botao.textContent = rotuloCopiar; } catch (e) { /* stub */ }
        }, 1400);
      }
    } catch (e) { /* stub */ }
  }

  /* -------------------------------------------------------------- refresh */

  function refresh(game) {
    if (!el || !game) return;

    var p = game.player || {};
    var map = game.map || null;

    setTexto('hud-nivel', inteiro(game.depth));
    setTexto('hud-turno', inteiro(game.turn));

    var hp = Math.max(0, inteiro(p.hp));
    var maxHp = Math.max(1, inteiro(p.maxHp));
    setTexto('hud-vida', hp + '/' + maxHp);

    var razao = hp / maxHp;
    setLargura('hud-vida-barra', razao * 100);
    var barra = el['hud-vida-barra'];
    marcarClasse(barra, 'barra-ok', razao > 0.5);
    marcarClasse(barra, 'barra-alerta', razao <= 0.5 && razao > 0.25);
    marcarClasse(barra, 'barra-critico', razao <= 0.25);
    marcarClasse(el['hud-vida'], 'valor-baixo', razao <= 0.25);

    setTexto('hud-atk', inteiro(p.atk));
    setTexto('hud-pocoes', inteiro(p.potions));

    if (map) {
      var con = num(map.connectivity);
      setTexto('map-conect', pct(map.connectivity));
      marcarClasse(el['map-conect'], 'valor-otimo', con >= 1);
      setTexto('map-salas', (map.rooms && map.rooms.length) || 0);
    } else {
      setTexto('map-conect', '—');
      setTexto('map-salas', '—');
    }

    setTexto('map-inimigos', inimigosVivos(game));
    setTexto('map-itens', (game.items && game.items.length) || 0);
    setTexto('map-visiveis',
      (game.visible && typeof game.visible.size === 'number') ? game.visible.size : 0);

    // Mantém o campo em dia sem atropelar o que o jogador está digitando.
    var campo = el.seed;
    if (campo && typeof campo.value === 'string' && game.seedStr && !sementeSuja) {
      var focado = false;
      try { focado = !!(doc && doc.activeElement === campo); } catch (e) { focado = false; }
      if (!focado && campo.value !== game.seedStr) campo.value = game.seedStr;
    }

    setDebug(game);
  }

  /* --------------------------------------------------------------- registro */

  function classeLog(cls) {
    return (typeof cls === 'string' && CLASSES_LOG[cls]) ? cls : 'info';
  }

  function criarLinha(entrada) {
    if (!entrada) return null;
    var linha = criar('div', 'log-linha log-' + classeLog(entrada.cls));
    if (!linha) return null;
    var turno = criar('span', 'log-turno', inteiro(entrada.turn));
    var texto = criar('span', 'log-texto',
      entrada.text === null || entrada.text === undefined ? '' : entrada.text);
    anexar(linha, turno);
    anexar(linha, texto);
    return linha;
  }

  function coladoNoFim(caixa) {
    var sh = num(caixa.scrollHeight);
    if (sh <= 0) return true;
    return (sh - num(caixa.scrollTop) - num(caixa.clientHeight)) <= 24;
  }

  function irParaOFim(caixa) {
    if (!caixa || typeof caixa.scrollHeight !== 'number') return;
    try { caixa.scrollTop = caixa.scrollHeight; } catch (e) { /* stub */ }
  }

  function aparar(caixa) {
    var teto = maxLog();
    while (linhasLog > teto) {
      if (!caixa.firstChild || typeof caixa.removeChild !== 'function') { linhasLog = teto; break; }
      try { caixa.removeChild(caixa.firstChild); } catch (e) { break; }
      linhasLog--;
    }
  }

  // Anexa UMA entrada nova; não redesenha a lista inteira.
  function pushLog(game, entry) {
    if (!el || !el.log) return;
    var entrada = entry;
    if (!entrada && game && game.log && game.log.length) {
      entrada = game.log[game.log.length - 1];
    }
    if (!entrada) return;

    var caixa = el.log;
    var linha = criarLinha(entrada);
    if (!linha) return;

    var colado = coladoNoFim(caixa);
    anexar(caixa, linha);
    linhasLog++;
    aparar(caixa);
    if (colado) irParaOFim(caixa);
  }

  function rebuildLog(game) {
    if (!el || !el.log) return;
    var caixa = el.log;
    limpar(caixa);
    linhasLog = 0;

    var lista = (game && game.log) || [];
    var inicio = Math.max(0, lista.length - maxLog());
    var frag = (doc && typeof doc.createDocumentFragment === 'function')
      ? doc.createDocumentFragment() : null;

    for (var i = inicio; i < lista.length; i++) {
      var linha = criarLinha(lista[i]);
      if (!linha) break;
      anexar(frag || caixa, linha);
      linhasLog++;
    }
    if (frag) anexar(caixa, frag);
    irParaOFim(caixa);
  }

  /* ---------------------------------------------------------------- tooltip */

  function showTooltip(html, sx, sy) {
    if (!el || !el.tooltip) return;
    var t = el.tooltip;
    var conteudo = (html === null || html === undefined) ? '' : String(html);
    try { t.innerHTML = conteudo; } catch (e) {
      try { t.textContent = conteudo; } catch (e2) { return; }
    }
    try { t.hidden = false; } catch (e) { /* stub */ }
    posicionarTooltip(t, sx, sy);
  }

  function posicionarTooltip(t, sx, sy) {
    if (!t.style) return;
    var margem = 16;
    var larg = num(t.offsetWidth) || 220;
    var alt = num(t.offsetHeight) || 96;
    var vw = 0, vh = 0, ox = 0, oy = 0;
    if (typeof window !== 'undefined' && window) {
      vw = num(window.innerWidth);
      vh = num(window.innerHeight);
      ox = num(window.scrollX);
      oy = num(window.scrollY);
    }
    var x = num(sx) + margem;
    var y = num(sy) + margem;
    if (vw && x + larg + 8 > vw) x = num(sx) - larg - margem;
    if (vh && y + alt + 8 > vh) y = num(sy) - alt - margem;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    try {
      t.style.left = (x + ox) + 'px';
      t.style.top = (y + oy) + 'px';
    } catch (e) { /* stub */ }
  }

  function hideTooltip() {
    if (!el || !el.tooltip) return;
    try { el.tooltip.hidden = true; } catch (e) { /* stub */ }
  }

  /* ------------------------------------------------------------------ morte */

  function linhaMorte(rotulo, valor) {
    var linha = criar('div', 'morte-linha');
    if (!linha) return null;
    anexar(linha, criar('span', 'morte-rotulo', rotulo));
    anexar(linha, criar('span', 'morte-valor', valor));
    return linha;
  }

  function showDeath(game) {
    if (!el || !el.morte) return;
    var corpo = el['morte-corpo'];
    var st = (game && game.stats) || {};
    var nivel = Math.max(inteiro(game && game.depth), inteiro(st.deepest));
    var turnos = inteiro(st.turns) || inteiro(game && game.turn);
    var causa = (game && typeof game.cause === 'string' && game.cause)
      ? game.cause : 'Causa desconhecida.';

    if (corpo) {
      limpar(corpo);
      var linhas = [
        ['Semente', (game && game.seedStr) ? game.seedStr : '—'],
        ['Nível alcançado', String(nivel)],
        ['Turnos', String(turnos)],
        ['Inimigos derrotados', String(inteiro(st.kills))],
        ['Dano causado', String(inteiro(st.dmgDealt))],
        ['Dano recebido', String(inteiro(st.dmgTaken))],
        ['Itens usados', String(inteiro(st.itemsUsed))],
        ['Exploração', pctBruto(exploracao(game))]
      ];
      var frag = (doc && typeof doc.createDocumentFragment === 'function')
        ? doc.createDocumentFragment() : null;
      var alvo = frag || corpo;
      var feito = false;
      for (var i = 0; i < linhas.length; i++) {
        var linha = linhaMorte(linhas[i][0], linhas[i][1]);
        if (!linha) break;
        anexar(alvo, linha);
        feito = true;
      }
      var causaNo = criar('span', 'morte-causa', causa);
      if (causaNo) anexar(alvo, causaNo);
      if (frag) anexar(corpo, frag);

      if (!feito) {
        // Ambiente sem createElement (harness): texto corrido serve.
        var plano = [];
        for (var j = 0; j < linhas.length; j++) plano.push(linhas[j][0] + ': ' + linhas[j][1]);
        plano.push('Causa: ' + causa);
        try { corpo.textContent = plano.join('\n'); } catch (e) { /* stub */ }
      }
    }

    try { el.morte.hidden = false; } catch (e) { /* stub */ }
    var botao = el['btn-nova'];
    if (botao && typeof botao.focus === 'function') {
      try { botao.focus(); } catch (e) { /* stub */ }
    }
  }

  function hideDeath() {
    if (!el || !el.morte) return;
    try { el.morte.hidden = true; } catch (e) { /* stub */ }
  }

  /* ------------------------------------------------------------------ debug */

  function medirFps(game) {
    // Duas fontes possíveis (o contrato não fixa por onde vem), ambas derivadas
    // do `dt` do laço de animação — nenhum relógio de parede é lido aqui, como
    // manda o §0.6. Só aceita valor positivo: um zero do laço ainda não aquecido
    // não pode esconder a outra fonte; o painel já mostra 0 como '—'.
    var externo = null;
    if (game && game.ui && isFinite(game.ui.fps) && game.ui.fps > 0) {
      externo = game.ui.fps;
    } else if (R.Render && isFinite(R.Render.fps) && R.Render.fps > 0) {
      externo = R.Render.fps;
    }
    return externo === null ? 0 : Math.round(externo);
  }

  function descreverCursor(game) {
    var h = (game && game.ui) ? game.ui.hover : null;
    if (!h || typeof h.x !== 'number' || typeof h.y !== 'number') return '—';
    var txt = '(' + inteiro(h.x) + ',' + inteiro(h.y) + ')';
    var map = game.map;
    if (map && map.tiles && typeof map.w === 'number' &&
        h.x >= 0 && h.y >= 0 && h.x < map.w && h.y < map.h) {
      var t = map.tiles[h.y * map.w + h.x];
      txt += ' ' + (NOME_TILE[t] || 'desconhecido');
    }
    return txt;
  }

  function setDebug(game) {
    if (!el || !el.debug) return;
    var painel = el.debug;
    var ativo = !!(game && game.ui && game.ui.debug);
    try { painel.hidden = !ativo; } catch (e) { /* stub */ }
    if (!ativo) return;

    var p = (game && game.player) || {};
    var map = (game && game.map) || null;
    var quadros = medirFps(game);

    var linhas = [
      'semente     ' + ((game && game.seedStr) ? game.seedStr : '—'),
      'fps         ' + (quadros > 0 ? quadros : '—'),
      'jogador     (' + inteiro(p.x) + ',' + inteiro(p.y) + ')',
      'cursor      ' + descreverCursor(game),
      'conect.     ' + (map ? pct(map.connectivity) : '—'),
      'inimigos    ' + inimigosVivos(game),
      'itens       ' + (((game && game.items) || []).length),
      'visíveis    ' +
        ((game && game.visible && typeof game.visible.size === 'number') ? game.visible.size : 0)
    ];
    var texto = linhas.join('\n');
    if (cache.debug === texto) return;
    cache.debug = texto;
    try { painel.textContent = texto; } catch (e) { /* stub */ }
  }

  /* ------------------------------------------------------------ persistência */

  function armazem() {
    try {
      var s = null;
      if (typeof localStorage !== 'undefined' && localStorage) s = localStorage;
      else if (typeof window !== 'undefined' && window && window.localStorage) s = window.localStorage;
      if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function copiaJogador(p) {
    p = p || {};
    return {
      x: inteiro(p.x), y: inteiro(p.y),
      hp: inteiro(p.hp), maxHp: inteiro(p.maxHp),
      atk: inteiro(p.atk), potions: inteiro(p.potions),
      level: inteiro(p.level), xp: inteiro(p.xp)
    };
  }

  function copiaInimigos(lista) {
    var out = [];
    if (!lista || typeof lista.length !== 'number') return out;
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (!e) continue;
      out.push({
        id: inteiro(e.id), kind: String(e.kind || ''),
        x: inteiro(e.x), y: inteiro(e.y),
        hp: inteiro(e.hp), maxHp: inteiro(e.maxHp),
        atk: inteiro(e.atk), range: inteiro(e.range),
        state: String(e.state || 'idle'),
        plan: String(e.plan || '')
      });
    }
    return out;
  }

  function copiaItens(lista) {
    var out = [];
    if (!lista || typeof lista.length !== 'number') return out;
    for (var i = 0; i < lista.length; i++) {
      var it = lista[i];
      if (!it) continue;
      out.push({
        id: inteiro(it.id), kind: String(it.kind || 'potion'),
        x: inteiro(it.x), y: inteiro(it.y), heal: inteiro(it.heal)
      });
    }
    return out;
  }

  function copiaStats(st) {
    st = st || {};
    return {
      turns: inteiro(st.turns), kills: inteiro(st.kills),
      dmgDealt: inteiro(st.dmgDealt), dmgTaken: inteiro(st.dmgTaken),
      itemsUsed: inteiro(st.itemsUsed), deepest: inteiro(st.deepest),
      explorePct: num(st.explorePct)
    };
  }

  function copiaLog(lista, quantos) {
    var out = [];
    if (!lista || typeof lista.length !== 'number') return out;
    var inicio = Math.max(0, lista.length - quantos);
    for (var i = inicio; i < lista.length; i++) {
      var e = lista[i];
      if (!e) continue;
      out.push({
        turn: inteiro(e.turn),
        text: String(e.text === null || e.text === undefined ? '' : e.text),
        cls: classeLog(e.cls)
      });
    }
    return out;
  }

  function serializar(game) {
    var estadoRng = 0;
    if (game.rngCombat && typeof game.rngCombat.s === 'number') {
      estadoRng = game.rngCombat.s >>> 0;
    }
    var explored = game.explored || null;
    return {
      v: 1,
      version: (R.C && R.C.VERSION) ? R.C.VERSION : '1.0.0',
      seed: String(game.seedStr || ''),
      seedStr: String(game.seedStr || ''),
      depth: inteiro(game.depth),
      turn: inteiro(game.turn),
      over: !!game.over,
      cause: String(game.cause || ''),
      player: copiaJogador(game.player),
      enemies: copiaInimigos(game.enemies),
      items: copiaItens(game.items),
      explored: bytesParaB64(explored),
      exploredLen: explored && typeof explored.length === 'number' ? explored.length : 0,
      stats: copiaStats(game.stats),
      rngCombat: estadoRng,
      rngCombatS: estadoRng,
      log: copiaLog(game.log, 80)
    };
  }

  function write(game) {
    var s = armazem();
    if (!s || !game) return false;
    try {
      s.setItem(chaveSave(), JSON.stringify(serializar(game)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function read() {
    var s = armazem();
    if (!s) return null;
    try {
      var bruto = s.getItem(chaveSave());
      if (!bruto || typeof bruto !== 'string') return null;
      var obj = JSON.parse(bruto);
      if (!obj || typeof obj !== 'object') return null;
      // Devolve `explored` já pronto para uso (Uint8Array) e guarda o texto
      // original em `exploredB64` para quem preferir a forma serializada.
      if (typeof obj.explored === 'string') {
        obj.exploredB64 = obj.explored;
        obj.explored = b64ParaBytes(obj.explored, inteiro(obj.exploredLen));
      } else if (obj.explored && typeof obj.explored.length === 'number') {
        obj.explored = new Uint8Array(obj.explored);
      }
      if (!obj.seedStr && obj.seed) obj.seedStr = obj.seed;
      if (!obj.seed && obj.seedStr) obj.seed = obj.seedStr;
      if (typeof obj.rngCombatS !== 'number') obj.rngCombatS = inteiro(obj.rngCombat);
      return obj;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    var s = armazem();
    if (!s) return false;
    try {
      if (typeof s.removeItem === 'function') s.removeItem(chaveSave());
      else s.setItem(chaveSave(), '');
      return true;
    } catch (e) {
      return false;
    }
  }

  function readHistory() {
    var s = armazem();
    if (!s) return [];
    try {
      var bruto = s.getItem(chaveHistorico());
      if (!bruto || typeof bruto !== 'string') return [];
      var arr = JSON.parse(bruto);
      if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') return [];
      return arr;
    } catch (e) {
      return [];
    }
  }

  function pushHistory(game) {
    var s = armazem();
    if (!s || !game) return false;
    try {
      var st = game.stats || {};
      var arr = readHistory();
      arr.unshift({
        seed: String(game.seedStr || ''),
        depth: Math.max(inteiro(game.depth), inteiro(st.deepest)),
        turns: inteiro(st.turns) || inteiro(game.turn),
        kills: inteiro(st.kills),
        dmgDealt: inteiro(st.dmgDealt),
        dmgTaken: inteiro(st.dmgTaken),
        itemsUsed: inteiro(st.itemsUsed),
        explorePct: exploracao(game),
        cause: String(game.cause || '')
      });
      if (arr.length > 10) arr.length = 10;
      s.setItem(chaveHistorico(), JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ API */

  R.UI = {
    init: init,
    refresh: refresh,
    pushLog: pushLog,
    rebuildLog: rebuildLog,
    showTooltip: showTooltip,
    hideTooltip: hideTooltip,
    showDeath: showDeath,
    hideDeath: hideDeath,
    setDebug: setDebug
  };

  R.Save = {
    write: write,
    read: read,
    clear: clear,
    pushHistory: pushHistory,
    readHistory: readHistory
  };

})(window.R = window.R || {});
