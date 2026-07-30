// @vitest-environment jsdom
/*
 * ISOROGUE — test/ui.test.tsx
 * ------------------------------------------------------------------
 * Smoke da casca React em jsdom (docs/ARQUITETURA-REACT.md §7.4).
 *
 * O docblock acima é OBRIGATÓRIO: o `environmentMatchGlobs` do vite.config.ts
 * foi removido no Vitest 4 e é ignorado em silêncio. Sem esta linha o arquivo
 * roda no ambiente `node` e falha com "window is not defined".
 *
 * O que este arquivo prova:
 *   · <App/> monta sob StrictMode com todos os painéis e todos os id fixos do
 *     §9 do CONTRACTS.md;
 *   · o campo de semente aceita digitação e o botão Gerar inicia a expedição
 *     com a semente JÁ normalizada — e a tecla `N` e o botão da morte reescrevem
 *     o campo mesmo com ele "sujo", como fazia `setCampoSemente` no `newRun`;
 *   · o registro recebe entradas novas conforme o jogo avança — inclusive a
 *     linha de um comando RECUSADO, que no vanilla ia ao DOM dentro do próprio
 *     `logMsg` (`R.UI.pushLog`) e portanto aparecia no ato;
 *   · o overlay de morte aparece com `over: true`, com os 9 campos do R48;
 *   · o BALCÃO (fase 2 da economia) só existe sobre o mercador ou sobre o
 *     caldeirão da estação de alquimia (`game.bancada`), despacha os comandos
 *     certos e reflete bolsa, moedas e receitas — e os tiles de CENÁRIO da
 *     estação (`game.alquimiaExtras`) não abrem painel nenhum;
 *   · o `IsoRenderer` degrada sem lançar quando `getContext('2d')` devolve null
 *     (jsdom não tem canvas 2D) — defensivo, não gambiarra;
 *   · o laço de rAF NÃO duplica com a montagem dupla do StrictMode e é
 *     encerrado no unmount (§5) — verificado com um relógio de quadros manual;
 *   · o console fica limpo: nenhum aviso do React (`key` faltando,
 *     `getSnapshot` instável, atualização de estado durante o render) — §8.5.
 */

import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ARMA_NIVEL_MAX, ITENS, PRECO_POCAO } from '../src/engine/entities';
import { store } from '../src/engine/store';
import { setStorage } from '../src/engine/save';
import { App } from '../src/ui/App';
import { sincronizar } from '../src/ui/cinematics';
import { getRenderer } from '../src/ui/GameCanvas';

/* Sem localStorage nos testes: cada caso parte de um estado explícito. */
setStorage(null);

const SEMENTE = 'UI-TESTE';

/* ------------------------------------------------------------------ *
 * Relógio de quadros manual — substitui o rAF do jsdom por uma fila que
 * só avança quando NÓS mandamos. É o que torna determinístico o teste de
 * "um laço, e só um" do §5.
 * ------------------------------------------------------------------ */

const quadrosPendentes = new Map<number, FrameRequestCallback>();
let proximoQuadro = 1;
let relogio = 0;

function instalarRelogioDeQuadros(): void {
  quadrosPendentes.clear();
  proximoQuadro = 1;
  relogio = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    const id = proximoQuadro++;
    quadrosPendentes.set(id, cb);
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number): void => {
    quadrosPendentes.delete(id);
  }) as typeof window.cancelAnimationFrame;
}

/** Dispara todos os quadros pendentes uma vez (como faria o navegador). */
function passarQuadro(ms = 16): void {
  relogio += ms;
  const atuais = Array.from(quadrosPendentes.entries());
  quadrosPendentes.clear();
  for (const [, cb] of atuais) cb(relogio);
}

/* ------------------------------------------------------------------ *
 * Vigilância do console — §8.5 exige zero erro e zero aviso
 * ------------------------------------------------------------------ */

/*
 * Única mensagem tolerada: a limitação conhecida do jsdom, que não implementa
 * canvas 2D. Ela vem do ambiente, não do nosso código — e o fato de o app
 * continuar de pé com `getContext` devolvendo null É o comportamento exigido
 * pelo §7.4.
 */
const RUIDO_DO_AMBIENTE = /Not implemented:\s*HTMLCanvasElement/i;

let ruido: string[] = [];
let espiaErro: ReturnType<typeof vi.spyOn>;
let espiaAviso: ReturnType<typeof vi.spyOn>;

function anotar(args: unknown[]): void {
  const texto = args
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : String(a)))
    .join(' ');
  if (RUIDO_DO_AMBIENTE.test(texto)) return;
  ruido.push(texto);
}

function esperarConsoleLimpo(): void {
  expect(ruido, 'o console recebeu erro/aviso durante o teste').toEqual([]);
}

beforeEach(() => {
  ruido = [];
  espiaErro = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    anotar(args);
  });
  espiaAviso = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    anotar(args);
  });
  instalarRelogioDeQuadros();
  /*
   * A fase da cinemática é estado de MÓDULO (src/ui/cinematics.ts) e vaza de um
   * caso para o outro: basta um `passarQuadro()` com a partida no turno 0 para
   * a fase virar 'intro' — e 'intro' TRAVA o teclado do jogador
   * (`inputBloqueado`). Sem este reparo, todo teste de tecla que rodasse depois
   * de um teste com quadros passaria em silêncio, provando nada.
   */
  sincronizar('nenhuma');
  store.newRun(SEMENTE);
});

afterEach(() => {
  cleanup();
  espiaErro.mockRestore();
  espiaAviso.mockRestore();
});

/** Monta a árvore completa exatamente como `main.tsx` faz em desenvolvimento. */
function montarApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

/* ================================================================== *
 * Testes
 * ================================================================== */

describe('UI — smoke da casca React (§7.4)', () => {
  it('monta <App/> sob StrictMode com todos os painéis e os id do contrato §9', () => {
    const { container } = montarApp();

    /* Ordem dos blocos fixada pelo §9 do CONTRACTS.md — com a Bolsa (fase 1
     * dos despojos) logo após os Vitais: o que o jogador é e o que ele carrega
     * ficam juntos, antes de qualquer coisa sobre o andar (ver Sidebar.tsx). */
    const titulos = Array.from(container.ownerDocument.querySelectorAll('.painel .titulo'))
      .map((el) => (el.textContent || '').trim());
    expect(titulos, 'blocos do painel lateral fora de ordem ou ausentes').toEqual([
      'Vitais', 'Bolsa', 'Semente', 'Estado do mapa', 'Registro', 'Ajuda'
    ]);
    expect(screen.getByText('Nível'), 'rótulo Nível ausente').toBeTruthy();
    expect(screen.getByText('Turno'), 'rótulo Turno ausente').toBeTruthy();

    const ids = [
      'cv', 'seed', 'btn-gerar', 'btn-aleatoria', 'btn-copiar', 'log',
      'hud-vida', 'hud-vida-barra', 'hud-nivel', 'hud-turno', 'hud-atk', 'hud-pocoes',
      'hud-heroi-nivel', 'hud-xp', 'hud-xp-barra',
      'map-conect', 'map-salas', 'map-inimigos', 'map-itens', 'map-visiveis',
      'tooltip', 'debug', 'morte', 'morte-corpo', 'btn-nova'
    ];
    for (const id of ids) {
      expect(container.ownerDocument.getElementById(id), 'elemento #' + id + ' ausente').toBeTruthy();
    }

    /* Estado inicial: sobrepostos escondidos, canvas no palco. */
    expect(document.getElementById('morte')!.hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('tooltip')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.palco > canvas#cv'), 'canvas fora do palco').toBeTruthy();

    esperarConsoleLimpo();
  });

  it('o campo de semente aceita digitação e o botão Gerar inicia a expedição', () => {
    montarApp();
    const campo = document.getElementById('seed') as HTMLInputElement;
    expect(campo.value).toBe(SEMENTE);

    fireEvent.change(campo, { target: { value: 'gerada-pelo-teste' } });
    expect(campo.value, 'o campo não aceitou digitação').toBe('gerada-pelo-teste');

    act(() => {
      fireEvent.click(document.getElementById('btn-gerar') as HTMLButtonElement);
    });

    /* `normalizeSeed`: maiúsculas, sem espaços nas pontas. */
    expect(store.getGame().seedStr, 'a nova expedição não usou a semente digitada')
      .toBe('GERADA-PELO-TESTE');
    expect(campo.value, 'o campo não adotou a semente normalizada').toBe('GERADA-PELO-TESTE');
    expect(store.getGame().turn, 'a expedição nova deveria começar no turno 0').toBe(0);

    esperarConsoleLimpo();
  });

  it('o botão Aleatória troca a semente por uma nova', () => {
    montarApp();
    const anterior = store.getGame().seedStr;

    act(() => {
      fireEvent.click(document.getElementById('btn-aleatoria') as HTMLButtonElement);
    });

    const nova = store.getGame().seedStr;
    expect(nova, 'a semente aleatória repetiu a anterior').not.toBe(anterior);
    expect(nova, 'formato de semente inesperado').toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect((document.getElementById('seed') as HTMLInputElement).value).toBe(nova);

    esperarConsoleLimpo();
  });

  it('o registro recebe as entradas novas do jogo', () => {
    montarApp();
    const lista = document.getElementById('log') as HTMLElement;
    expect(lista.tagName, 'o registro deve ser <ul> (§6)').toBe('UL');

    const antes = lista.querySelectorAll('li.log-linha').length;
    expect(antes, 'o registro deveria abrir com as notas do mapa').toBeGreaterThan(0);
    const turnoAntes = store.getGame().turn;

    act(() => {
      store.dispatch({ kind: 'wait' });
    });

    expect(store.getGame().turn, 'o comando de espera não consumiu turno').toBe(turnoAntes + 1);
    const depois = lista.querySelectorAll('li.log-linha').length;
    expect(depois, 'nenhuma linha nova apareceu no registro').toBeGreaterThan(antes);
    expect(lista.textContent, 'a mensagem de espera não chegou ao registro')
      .toContain('Você aguarda, atento aos ruídos.');

    esperarConsoleLimpo();
  });

  it('a recusa de um comando chega ao registro NA HORA', () => {
    /*
     * Paridade com `R.UI.pushLog`: no vanilla o `logMsg` anexava a linha ao DOM
     * de dentro de si mesmo (legacy/src-vanilla/70-game.js:184), então o comando
     * recusado respondia imediatamente. Os três caminhos que registram e
     * devolvem `false` são estes.
     */
    montarApp();
    const lista = document.getElementById('log') as HTMLElement;
    const g = store.getGame();
    const turnoAntes = g.turn;

    /* 1. poção sem nenhuma poção */
    g.player.potions = 0;
    act(() => {
      fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
    });
    expect(lista.textContent, 'a recusa "Você não tem poções." não foi ao registro na hora')
      .toContain('Você não tem poções.');

    /* 2. poção com a vida cheia */
    g.player.potions = 3;
    g.player.hp = g.player.maxHp;
    act(() => {
      fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
    });
    expect(lista.textContent, 'a recusa "Sua vida já está completa." não foi ao registro na hora')
      .toContain('Sua vida já está completa.');

    /* 3. descer fora da escada */
    expect(
      g.player.x === g.map.stairs.x && g.player.y === g.map.stairs.y,
      'a semente do teste nasceu em cima da escada'
    ).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: '>', code: 'Period', shiftKey: true });
    });
    expect(lista.textContent, 'a recusa "Não há escada aqui." não foi ao registro na hora')
      .toContain('Não há escada aqui.');

    expect(store.getGame().turn, 'nenhuma das três recusas podia consumir turno')
      .toBe(turnoAntes);

    esperarConsoleLimpo();
  });

  it('a tecla N e o botão da morte reescrevem o campo de semente', () => {
    /*
     * `newRun` do vanilla fazia `setCampoSemente(current.seedStr)` — escrita
     * DIRETA no input, ignorando o campo "sujo" (70-game.js:1030). As duas vias
     * que não passam pelo painel são a tecla `N` e o botão do resumo de morte.
     */
    montarApp();
    const campo = document.getElementById('seed') as HTMLInputElement;

    fireEvent.change(campo, { target: { value: '  minha   semente ' } });
    act(() => {
      fireEvent.keyDown(window, { key: 'n', code: 'KeyN' });
    });
    expect(store.getGame().seedStr, 'a tecla N não usou o texto do campo')
      .toBe('MINHA SEMENTE');
    expect(campo.value, 'o campo não adotou a semente normalizada da tecla N')
      .toBe('MINHA SEMENTE');

    /* Campo sujo de novo + morte: o botão começa uma expedição de semente nova. */
    fireEvent.change(campo, { target: { value: 'texto-do-jogador' } });
    const g = store.getGame();
    act(() => {
      g.over = true;
      g.player.hp = 0;
      store.setHover({ x: g.player.x, y: g.player.y });
    });
    act(() => {
      fireEvent.click(document.getElementById('btn-nova') as HTMLButtonElement);
    });
    expect(store.getGame().seedStr, 'o botão da morte reaproveitou a semente antiga')
      .not.toBe('MINHA SEMENTE');
    expect(campo.value, 'o campo ficou com o texto digitado em vez da semente da partida')
      .toBe(store.getGame().seedStr);

    esperarConsoleLimpo();
  });

  it('o teclado global avança o turno e alterna o painel de depuração', () => {
    montarApp();
    const turnoAntes = store.getGame().turn;

    act(() => {
      fireEvent.keyDown(window, { key: '.', code: 'Period' });
    });
    expect(store.getGame().turn, 'a tecla "." não consumiu turno').toBe(turnoAntes + 1);

    expect(store.getGame().ui.debug).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', shiftKey: true });
    });
    expect(store.getGame().ui.debug, 'Shift+D não ligou o painel de depuração').toBe(true);
    expect(document.getElementById('debug')!.hasAttribute('hidden')).toBe(false);

    act(() => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', shiftKey: true });
    });
    expect(store.getGame().ui.debug, 'Shift+D não desligou o painel').toBe(false);

    esperarConsoleLimpo();
  });

  it('o teclado é ignorado enquanto o foco está no campo de semente (§10)', () => {
    montarApp();
    const campo = document.getElementById('seed') as HTMLInputElement;
    campo.focus();
    const turnoAntes = store.getGame().turn;

    act(() => {
      fireEvent.keyDown(campo, { key: 'w', code: 'KeyW' });
    });

    expect(store.getGame().turn, 'a tecla de movimento vazou do campo de semente')
      .toBe(turnoAntes);

    esperarConsoleLimpo();
  });

  it('o overlay de morte aparece com over: true e traz os 9 campos do R48', () => {
    montarApp();
    const overlay = document.getElementById('morte') as HTMLElement;
    expect(overlay.hasAttribute('hidden')).toBe(true);

    const g = store.getGame();
    act(() => {
      g.over = true;
      g.player.hp = 0;
      g.cause = 'Morto pelo Perseguidor no nível 1';
      /* `setHover` é a via pública mais barata de notificar os assinantes. */
      store.setHover({ x: g.player.x, y: g.player.y });
    });

    /*
     * Gate da cinemática de morte: o modal SÓ abre na fase 'concluida' (fade
     * completo). Dirigimos a máquina pelo relógio de quadros manual: um quadro
     * para o renderer detectar a borda de `game.over` e iniciar a sequência,
     * `pularCinematica()` para levá-la ao fim na hora, e um segundo quadro para
     * o laço de rAF republicar a fase no micro-store da UI. O comportamento
     * pretendido é o mesmo do jogo — só que sem esperar os 3,4 s.
     */
    expect(overlay.hasAttribute('hidden'), 'o modal abriu antes do fim da cinemática')
      .toBe(true);
    act(() => {
      passarQuadro();
    });
    act(() => {
      getRenderer()!.pularCinematica();
    });
    act(() => {
      passarQuadro();
    });

    expect(overlay.hasAttribute('hidden'), 'o overlay continuou escondido com over === true')
      .toBe(false);
    const corpo = document.getElementById('morte-corpo') as HTMLElement;
    for (const rotulo of [
      'Semente', 'Nível alcançado', 'Turnos', 'Inimigos derrotados',
      'Dano causado', 'Dano recebido', 'Itens usados', 'Exploração'
    ]) {
      expect(corpo.textContent, 'campo "' + rotulo + '" ausente no resumo').toContain(rotulo);
    }
    expect(corpo.textContent, 'a causa da morte não apareceu')
      .toContain('Morto pelo Perseguidor no nível 1');
    const botaoNova = document.getElementById('btn-nova') as HTMLButtonElement;
    expect((botaoNova.textContent || '').trim(), 'rótulo do botão de reinício').toBe('Nova expedição');

    /* O botão começa uma expedição nova e o overlay se fecha. */
    act(() => {
      fireEvent.click(document.getElementById('btn-nova') as HTMLButtonElement);
    });
    expect(store.getGame().over, 'a nova expedição nasceu morta').toBe(false);
    expect(overlay.hasAttribute('hidden'), 'o overlay não sumiu na nova expedição').toBe(true);

    esperarConsoleLimpo();
  });

  it('o canvas degrada sem contexto 2D e o laço de rAF não duplica sob StrictMode', () => {
    const { unmount } = montarApp();

    /* jsdom não implementa getContext('2d'); o IsoRenderer tem de aguentar. */
    const cv = document.getElementById('cv') as HTMLCanvasElement;
    expect(cv, 'canvas ausente').toBeTruthy();

    /*
     * §5: mesmo com a montagem/desmontagem dupla do StrictMode, tem de haver
     * EXATAMENTE um quadro pendente. Dois significam dois laços desenhando
     * (sintoma: FPS dobrado, animação em dobro).
     */
    expect(quadrosPendentes.size, 'número de laços de rAF vivos após a montagem').toBe(1);

    for (let i = 0; i < 5; i++) {
      act(() => {
        passarQuadro();
      });
      expect(quadrosPendentes.size, 'o laço de rAF duplicou no quadro ' + i).toBe(1);
    }

    unmount();
    expect(quadrosPendentes.size, 'o laço de rAF continuou vivo após o unmount').toBe(0);

    esperarConsoleLimpo();
  });

  it('montar e desmontar repetidamente não deixa laço nem ouvinte órfão', () => {
    for (let i = 0; i < 3; i++) {
      const { unmount } = montarApp();
      act(() => {
        passarQuadro();
      });
      expect(quadrosPendentes.size, 'ciclo ' + i + ': mais de um laço de rAF').toBe(1);
      unmount();
      expect(quadrosPendentes.size, 'ciclo ' + i + ': laço sobreviveu ao unmount').toBe(0);
    }

    /* Sem árvore montada, o teclado global não pode mais mexer no jogo. */
    const turnoAntes = store.getGame().turn;
    fireEvent.keyDown(window, { key: '.', code: 'Period' });
    expect(store.getGame().turn, 'o ouvinte de teclado sobreviveu ao unmount').toBe(turnoAntes);

    esperarConsoleLimpo();
  });

  it('os painéis refletem o estado do jogo lido do store', () => {
    montarApp();
    const g = store.getGame();

    expect(document.getElementById('hud-nivel')!.textContent).toBe(String(g.depth));
    expect(document.getElementById('hud-turno')!.textContent).toBe(String(g.turn));
    expect(document.getElementById('hud-atk')!.textContent).toBe(String(g.player.atk));
    expect(document.getElementById('hud-pocoes')!.textContent).toBe(String(g.player.potions));
    /* §16 — o nível REAL do herói e o XP acumulado, na régua plana de 100. */
    expect(document.getElementById('hud-heroi-nivel')!.textContent).toBe(String(g.player.level));
    expect(document.getElementById('hud-xp')!.textContent).toBe(String(g.player.xp) + '/100');
    expect(document.getElementById('hud-vida')!.textContent)
      .toContain(String(g.player.hp));
    expect(document.getElementById('map-salas')!.textContent).toBe(String(g.map.rooms.length));
    expect(document.getElementById('map-itens')!.textContent).toBe(String(g.items.length));
    expect(document.getElementById('map-visiveis')!.textContent).toBe(String(g.visible.size));

    /* Conectividade 100% recebe o destaque verde do §9. */
    expect(document.getElementById('map-conect')!.className).toContain('valor-otimo');

    esperarConsoleLimpo();
  });

  it('a bolsa mostra o que o jogador carrega — e some quando está vazia', () => {
    /*
     * Fase 1 dos despojos. O painel lê `player.bag` (materiais) e
     * `player.potions` (contrato antigo R7), na ordem de `ITEM_KINDS` — que
     * abre com a poção, e é dela que sai o "poções primeiro" sem ordenação no
     * componente. Aqui se prova o que o jogador vê: nome no singular OU no
     * plural conforme a quantidade, a quantidade, e o vazio dito com todas as
     * letras em vez de um painel em branco.
     */
    montarApp();
    const g = store.getGame();

    /* Bolsa vazia: nada de listar o catálogo com zeros. */
    act(() => {
      g.player.potions = 0;
      g.player.bag = {};
      store.setHover({ x: g.player.x, y: g.player.y });
    });
    expect(document.getElementById('bolsa-vazia')!.textContent,
      'a bolsa vazia deveria dizer que está vazia').toBe('A bolsa está vazia.');
    expect(document.getElementById('bolsa'), 'a bolsa vazia não pode listar nada').toBeNull();

    /* Bolsa cheia: uma poção, um frasco e três orelhas. */
    act(() => {
      g.player.potions = 1;
      g.player.bag = { gosma: 1, orelhaGoblin: 3 };
      /* `setHover` só notifica quando o TILE muda: o primeiro já foi usado. */
      store.setHover({ x: g.player.x + 1, y: g.player.y });
    });

    const bolsa = document.getElementById('bolsa') as HTMLElement;
    expect(bolsa, 'a bolsa com itens deveria listar').toBeTruthy();
    expect(document.getElementById('bolsa-vazia'), 'a linha de vazio sobreviveu aos itens')
      .toBeNull();

    /* Quantidades, por id de linha. */
    expect(document.getElementById('bolsa-potion')!.textContent).toBe('1');
    expect(document.getElementById('bolsa-gosma')!.textContent).toBe('1');
    expect(document.getElementById('bolsa-orelhaGoblin')!.textContent).toBe('3');
    expect(document.getElementById('bolsa-clavaOgro'), 'material que o jogador não tem foi listado')
      .toBeNull();

    /* Singular com 1, plural com 3 — e o preço unitário da fase 2 já visível. */
    const nomes = Array.from(bolsa.querySelectorAll('.bolsa-nome'))
      .map((el) => (el.textContent || '').trim());
    expect(nomes, 'nome, plural ou ordem errados na bolsa')
      .toEqual(['Poção', 'Frasco de gosma', 'Orelhas de goblin']);
    expect(bolsa.textContent, 'o valor unitário do material não apareceu')
      .toContain('5 moedas cada');

    esperarConsoleLimpo();
  });

  /* ================================================================ *
   * O BALCÃO — o mercador e a ESTAÇÃO DE ALQUIMIA (fase 2 da economia)
   *
   * Os pontos de parada são estado do JOGO (`game.mercador` /
   * `game.bancada`), então pôr o jogador "em cima" de um deles é mover o
   * PONTO até ele — muito mais barato e mais determinístico do que caminhar
   * até onde a semente resolveu colocá-lo, e a regra em teste ('estou sobre o
   * tile?') é exatamente a mesma nos dois casos.
   *
   * DESDE A FASE 2.1, `game.bancada` é o CALDEIRÃO: o tile de interação de uma
   * instalação de até três tiles. Os outros dois (`game.alquimiaExtras`) são
   * cenário puro — o engine não aceita comando sobre eles e esta interface não
   * pode abrir painel neles. Há um caso só para isso.
   *
   * Notificação: `store.setHover` é a via pública mais barata de acordar os
   * assinantes sem consumir turno — e ela só emite quando o TILE muda, daí as
   * coordenadas diferentes a cada bloco.
   * ================================================================ */

  function acordar(dx: number): void {
    const g = store.getGame();
    store.setHover({ x: g.player.x + dx, y: g.player.y });
  }

  it('o balcão não existe longe dos pontos de parada', () => {
    montarApp();
    const g = store.getGame();

    /* `populate` nunca põe ponto de parada no tile inicial (start entra em
     * `taken` antes de qualquer sorteio), então a partida nasce longe dos dois. */
    const sobreMercador = !!g.mercador && g.mercador.x === g.player.x && g.mercador.y === g.player.y;
    const sobreCaldeirao = !!g.bancada && g.bancada.x === g.player.x && g.bancada.y === g.player.y;
    expect(sobreMercador || sobreCaldeirao, 'a semente do teste nasceu em cima de um balcão')
      .toBe(false);

    expect(document.getElementById('troca'), 'o balcão apareceu com o jogador longe dele')
      .toBeNull();

    /* Andar sem mercador nem estação (mapa sem tile elegível) também não abre. */
    act(() => {
      g.mercador = null;
      g.bancada = null;
      g.alquimiaExtras = [];
      acordar(1);
    });
    expect(document.getElementById('troca'), 'o balcão abriu num andar sem pontos de parada')
      .toBeNull();

    esperarConsoleLimpo();
  });

  it('ao lado de QUALQUER peça da estação, o painel de alquimia abre (fase 2.2)', () => {
    /*
     * Fase 2.1: a estante e a mesa (`game.alquimiaExtras`) ocupam território e
     * não têm interação — `criar` só é aceito sobre `game.bancada` (o
     * caldeirão). Pisar na estante tem de ser tão silencioso quanto pisar em
     * chão comum: abrir a oficina ali seria a interface prometendo um comando
     * que o engine recusa, e a recusa custa uma linha de 'aviso' no registro.
     */
    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = null;
      /* Ao lado do primeiro extra (a estante): a estação é uma coisa só. */
      g.bancada = { x: g.player.x + 2, y: g.player.y };
      g.alquimiaExtras = [
        { x: g.player.x + 1, y: g.player.y },
        { x: g.player.x + 3, y: g.player.y }
      ];
      acordar(0);
    });

    expect(document.getElementById('troca'),
      'ao lado da estante, a oficina não abriu — a estação é uma coisa só').not.toBeNull();

    /* E o caldeirão, ao lado, continua abrindo — o caso não passou por engano. */
    act(() => {
      g.bancada = { x: g.player.x, y: g.player.y };
      acordar(1);
    });
    expect(document.getElementById('troca'), 'o caldeirão parou de abrir a oficina')
      .toBeTruthy();

    esperarConsoleLimpo();
  });

  it('sobre o mercador: vender despacha o comando e a bolsa e as moedas seguem', () => {
    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = { x: g.player.x, y: g.player.y };
      g.bancada = null;
      g.player.bag = { gosma: 3 };
      g.player.moedas = 0;
      acordar(0);
    });

    /* O bloco entra entre a Bolsa e a Semente — o que carrego, e o que posso
     * fazer com isso (ver Sidebar.tsx). */
    const titulos = Array.from(document.querySelectorAll('.painel .titulo'))
      .map((el) => (el.textContent || '').trim());
    expect(titulos, 'o balcão entrou fora de lugar na barra lateral').toEqual([
      'Vitais', 'Bolsa', 'Mercador', 'Semente', 'Estado do mapa', 'Registro', 'Ajuda'
    ]);
    expect(document.getElementById('troca-moedas')!.textContent, 'moedas do balcão').toBe('0');

    const preco = ITENS.gosma.valor;
    const turnoAntes = g.turn;

    /* VENDER 1 — o botão manda `{kind:'vender', item:'gosma', quantidade:1}`. */
    act(() => {
      fireEvent.click(document.getElementById('vender-gosma') as HTMLButtonElement);
    });

    expect(g.player.bag.gosma, 'a venda de uma unidade não saiu da bolsa').toBe(2);
    expect(g.player.moedas, 'a venda não pagou o preço da tabela').toBe(preco);
    expect(g.turn, 'negociar custa um turno (e é decisão de design)').toBe(turnoAntes + 1);
    expect(document.getElementById('troca-moedas')!.textContent, 'o balcão não recontou as moedas')
      .toBe(String(preco));
    expect(document.getElementById('hud-moedas')!.textContent, 'os vitais não recontaram as moedas')
      .toBe(String(preco));
    expect(document.getElementById('bolsa-gosma')!.textContent, 'a bolsa não recontou o material')
      .toBe('2');

    /* VENDER TUDO — a quantidade EXATA (o engine não aceita 'tudo'). */
    act(() => {
      fireEvent.click(document.getElementById('vender-tudo-gosma') as HTMLButtonElement);
    });

    expect(g.player.bag.gosma, 'vender tudo deixou material para trás').toBeUndefined();
    expect(g.player.moedas, 'o lote não pagou as duas unidades restantes').toBe(preco * 3);
    expect(document.getElementById('troca-venda'), 'a lista de venda sobreviveu à bolsa vazia')
      .toBeNull();
    expect(document.getElementById('troca-sem-material'), 'ninguém disse que não há o que vender')
      .toBeTruthy();

    esperarConsoleLimpo();
  });

  it('sobre o mercador: a poção só pode ser comprada com moeda no bolso', () => {
    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = { x: g.player.x, y: g.player.y };
      g.bancada = null;
      g.player.bag = {};
      g.player.moedas = PRECO_POCAO - 1;
      g.player.potions = 0;
      acordar(0);
    });

    const semMoeda = document.getElementById('comprar-potion') as HTMLButtonElement;
    expect(semMoeda.tagName, 'o gatilho de compra tem de ser um <button> de verdade')
      .toBe('BUTTON');
    expect(semMoeda.disabled, 'a compra sem moeda tinha de estar desabilitada').toBe(true);
    expect(document.getElementById('troca-motivo-potion')!.textContent,
      'a falta de moeda não foi dita com todas as letras').toBe('Falta 1 moeda.');
    expect(semMoeda.getAttribute('aria-describedby'),
      'o botão desabilitado não aponta para o motivo').toBe('troca-motivo-potion');

    /* Botão desabilitado não vira comando — nem turno. */
    const turnoAntes = g.turn;
    act(() => { fireEvent.click(semMoeda); });
    expect(g.turn, 'o clique no botão desabilitado consumiu turno').toBe(turnoAntes);
    expect(g.player.potions, 'o botão desabilitado comprou mesmo assim').toBe(0);

    act(() => {
      g.player.moedas = PRECO_POCAO;
      acordar(1);
    });

    const comMoeda = document.getElementById('comprar-potion') as HTMLButtonElement;
    expect(comMoeda.disabled, 'a compra continuou travada com a moeda no bolso').toBe(false);
    act(() => { fireEvent.click(comMoeda); });

    expect(g.player.potions, 'a poção comprada não chegou').toBe(1);
    expect(g.player.moedas, 'o preço não foi cobrado').toBe(0);
    expect(document.getElementById('hud-pocoes')!.textContent).toBe('1');

    esperarConsoleLimpo();
  });

  it('sobre o caldeirão: sem material a receita fica desabilitada; com material, cria', () => {
    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = null;
      g.bancada = { x: g.player.x, y: g.player.y };
      g.alquimiaExtras = [];
      g.player.bag = {};
      g.player.potions = 0;
      acordar(0);
    });

    /* O título é o da INSTALAÇÃO que o jogador vê no tile — caldeirão, estante
     * e mesa (src/render/characters/alquimia.ts) —, e não o do campo do engine,
     * que continua se chamando `bancada` por ser contrato de save e snapshot. */
    expect((document.querySelector('#troca .titulo') as HTMLElement).textContent)
      .toBe('Alquimia');
    expect((document.getElementById('troca') as HTMLElement).getAttribute('aria-label'),
      'o rótulo acessível não descreve a estação')
      .toBe('Estação de alquimia e refino');

    const travado = document.getElementById('criar-pocao') as HTMLButtonElement;
    expect(travado.tagName, 'o gatilho da receita tem de ser um <button> de verdade')
      .toBe('BUTTON');
    expect(travado.disabled, 'a receita sem material tinha de estar desabilitada').toBe(true);
    /* O motivo, escrito, e ligado ao botão para quem lê por leitor de tela. */
    expect(document.getElementById('troca-motivo-pocao')!.textContent,
      'a falta não foi dita com todas as letras').toBe('Faltam 3 frascos de gosma.');
    expect(travado.getAttribute('aria-describedby'),
      'o botão desabilitado não aponta para o motivo').toBe('troca-motivo-pocao');

    const turnoAntes = g.turn;
    act(() => { fireEvent.click(travado); });
    expect(g.turn, 'o clique no botão desabilitado consumiu turno').toBe(turnoAntes);
    expect(g.player.potions, 'a oficina criou sem material').toBe(0);

    /* Com as três gosmas na bolsa o botão abre e o caldeirão trabalha. */
    act(() => {
      g.player.bag = { gosma: 3 };
      acordar(1);
    });

    const liberado = document.getElementById('criar-pocao') as HTMLButtonElement;
    expect(liberado.disabled, 'a receita continuou travada com o material em mãos').toBe(false);
    expect(document.getElementById('troca-motivo-pocao'), 'sobrou motivo com o material em mãos')
      .toBeNull();

    act(() => { fireEvent.click(liberado); });

    expect(g.player.potions, 'o caldeirão não engarrafou a poção').toBe(1);
    expect(g.player.bag.gosma, 'a receita não consumiu a gosma').toBeUndefined();
    expect(g.turn, 'usar a oficina custa um turno').toBe(turnoAntes + 1);
    expect(document.getElementById('log')!.textContent, 'o caldeirão não foi narrado')
      .toContain('engarrafa uma poção');

    esperarConsoleLimpo();
  });

  it('o teclado que ativa um botão do balcão não vira comando de jogo também', () => {
    /*
     * Acessibilidade de verdade: quem joga no teclado chega ao botão com Tab e
     * o ativa com Enter ou Espaço. As duas teclas TAMBÉM são comando global —
     * Enter desce a escada, Espaço espera um turno (useKeyboard.ts). Sem a
     * barreira do painel, um único Espaço venderia a gosma E queimaria um turno
     * a mais, com um Ogro na sala. As demais teclas continuam passando: o foco
     * num botão não pode prender o jogador no lugar.
     */    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = { x: g.player.x, y: g.player.y };
      g.bancada = null;
      g.player.bag = { gosma: 1 };
      acordar(0);
    });

    const botao = document.getElementById('vender-gosma') as HTMLButtonElement;
    botao.focus();

    const turnoAntes = g.turn;
    act(() => {
      fireEvent.keyDown(botao, { key: ' ', code: 'Space' });
      fireEvent.keyDown(botao, { key: 'Enter', code: 'Enter' });
    });
    expect(g.turn, 'a tecla que ativa o botão vazou para o comando global')
      .toBe(turnoAntes);

    /* Mas as OUTRAS teclas continuam passando: o foco num botão do balcão não
     * pode prender o jogador. ('.' é esperar — o único comando que consome
     * turno sem depender do desenho do mapa em volta.) */
    act(() => {
      fireEvent.keyDown(botao, { key: '.', code: 'Period' });
    });
    expect(g.turn, 'o foco no botão engoliu o resto do teclado')
      .toBe(turnoAntes + 1);

    esperarConsoleLimpo();
  });

  it('sobre o caldeirão: o refino mostra o nível da arma e trava no teto', () => {
    montarApp();
    const g = store.getGame();

    act(() => {
      g.mercador = null;
      g.bancada = { x: g.player.x, y: g.player.y };
      g.alquimiaExtras = [];
      g.player.bag = { espadaGoblin: 2 };
      g.player.armaNivel = 0;
      acordar(0);
    });

    expect(document.getElementById('troca-arma-nivel')!.textContent,
      'o nível da arma não apareceu na receita de refino')
      .toBe('Sua arma: refino 0 de ' + ARMA_NIVEL_MAX);
    expect(document.getElementById('hud-arma')!.textContent, 'o refino sumiu dos vitais')
      .toBe('0/' + ARMA_NIVEL_MAX);

    const atkAntes = g.player.atk;
    act(() => {
      fireEvent.click(document.getElementById('criar-refino') as HTMLButtonElement);
    });

    expect(g.player.armaNivel, 'o refino não subiu um degrau').toBe(1);
    expect(g.player.atk, 'o degrau de refino não somou ataque').toBe(atkAntes + 1);
    expect(document.getElementById('hud-arma')!.textContent).toBe('1/' + ARMA_NIVEL_MAX);

    /* No TETO o botão trava mesmo com material de sobra — e diz por quê. */
    act(() => {
      g.player.bag = { espadaGoblin: 4 };
      g.player.armaNivel = ARMA_NIVEL_MAX;
      acordar(1);
    });

    const noTeto = document.getElementById('criar-refino') as HTMLButtonElement;
    expect(noTeto.disabled, 'o refino no teto continuou clicável').toBe(true);
    expect(document.getElementById('troca-motivo-refino')!.textContent,
      'o teto do refino não foi explicado')
      .toBe('Refino máximo atingido (' + ARMA_NIVEL_MAX + ').');

    esperarConsoleLimpo();
  });
});
