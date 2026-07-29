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

import { store } from '../src/engine/store';
import { setStorage } from '../src/engine/save';
import { App } from '../src/ui/App';
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

    /* Ordem dos blocos fixada pelo §9 do CONTRACTS.md. */
    const titulos = Array.from(container.ownerDocument.querySelectorAll('.painel .titulo'))
      .map((el) => (el.textContent || '').trim());
    expect(titulos, 'blocos do painel lateral fora de ordem ou ausentes').toEqual([
      'Vitais', 'Semente', 'Estado do mapa', 'Registro', 'Ajuda'
    ]);
    expect(screen.getByText('Nível'), 'rótulo Nível ausente').toBeTruthy();
    expect(screen.getByText('Turno'), 'rótulo Turno ausente').toBeTruthy();

    const ids = [
      'cv', 'seed', 'btn-gerar', 'btn-aleatoria', 'btn-copiar', 'log',
      'hud-vida', 'hud-vida-barra', 'hud-nivel', 'hud-turno', 'hud-atk', 'hud-pocoes',
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
    expect(document.getElementById('hud-vida')!.textContent)
      .toContain(String(g.player.hp));
    expect(document.getElementById('map-salas')!.textContent).toBe(String(g.map.rooms.length));
    expect(document.getElementById('map-itens')!.textContent).toBe(String(g.items.length));
    expect(document.getElementById('map-visiveis')!.textContent).toBe(String(g.visible.size));

    /* Conectividade 100% recebe o destaque verde do §9. */
    expect(document.getElementById('map-conect')!.className).toContain('valor-otimo');

    esperarConsoleLimpo();
  });
});
