/*
 * ISOROGUE — bloco Semente.
 *
 * Junta o que no vanilla estava dividido entre `60-ui.js` (o DOM, a cópia e o
 * "campo sujo") e `70-game.js` (os handlers onGerar/onAleatoria/onCopiar). O
 * comportamento observável é o mesmo, na mesma ordem:
 *
 *   Gerar      -> nova expedição com o texto do campo; o campo passa a mostrar
 *                 a semente JÁ normalizada (setCampoSemente(current.seedStr)).
 *   Aleatória  -> `newSeedString()` e nova expedição com ela.
 *   Copiar     -> `navigator.clipboard` com plano B de seleção + execCommand;
 *                 registra no log o resultado REAL e troca o rótulo do botão
 *                 por 1400 ms ('Copiada' / 'Selecionada').
 *   Enter no campo -> mesmo caminho do Gerar.
 *
 * O campo é controlado. `sujo` reproduz o `sementeSuja` do vanilla: enquanto o
 * jogador estiver editando à mão, o refresh não atropela o que ele digitou.
 *
 * MAS o `sementeSuja` só travava o `R.UI.refresh`. O `newRun` de 70-game.js:1030
 * chamava `setCampoSemente(current.seedStr)`, que escreve em `el.seed.value`
 * DIRETO, ignorando o campo sujo — e há duas vias de nova expedição que não
 * passam por este painel: a tecla `N` (useKeyboard) e o botão `Nova expedição`
 * do resumo de morte (DeathOverlay). Por isso o painel também vigia a TROCA DE
 * PARTIDA: `createState` devolve um `Game` novo a cada `newRun` (`descend`
 * muta o mesmo objeto), então a identidade do `Game` é o sinal exato de
 * "expedição trocou" — inclusive quando a semente resultante é a mesma.
 */

import { useEffect, useRef, useState } from 'react';

import { newSeedString } from '../../engine/core';
import { logMsg } from '../../engine/game';
import { store } from '../../engine/store';
import { useGameValue } from '../hooks/useGameStore';
import type { Game } from '../../engine/types';

const ROTULO_COPIAR = 'Copiar';
const MS_ROTULO = 1400;

interface SeedPanelProps {
  /** Avisa a casca de que algo foi escrito no registro fora de um turno. */
  aoRegistrar?: () => void;
}

export function SeedPanel({ aoRegistrar }: SeedPanelProps) {
  const seedStr = useGameValue((g) => g.seedStr);
  // Referência viva do `Game` — seletor de referência ESTÁVEL, autorizado pelo
  // §4: ela só muda quando a partida troca.
  const jogo = useGameValue((g) => g);

  const [valor, setValor] = useState(seedStr);
  const [sujo, setSujo] = useState(false);
  const [rotuloCopiar, setRotuloCopiar] = useState(ROTULO_COPIAR);

  const refCampo = useRef<HTMLInputElement>(null);
  const refTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refVivo = useRef(true);
  const refJogo = useRef<Game>(jogo);

  useEffect(() => {
    refVivo.current = true;
    return () => {
      refVivo.current = false;
      if (refTimer.current !== null) {
        clearTimeout(refTimer.current);
        refTimer.current = null;
      }
    };
  }, []);

  /*
   * `setCampoSemente(current.seedStr)` do `newRun`: expedição nova reescreve o
   * campo mesmo que o jogador tenha digitado algo (tecla `N`, botão da morte).
   */
  useEffect(() => {
    if (refJogo.current === jogo) return;
    refJogo.current = jogo;
    setValor(jogo.seedStr);
    setSujo(false);
  }, [jogo]);

  /* `R.UI.refresh`: mantém o campo em dia sem atropelar quem está digitando. */
  useEffect(() => {
    if (sujo) return;
    const campo = refCampo.current;
    if (campo && document.activeElement === campo) return;
    setValor((atual) => (atual === seedStr ? atual : seedStr));
  }, [seedStr, sujo]);

  /* ------------------------------------------------------------- ações */

  function adotarSementeDoJogo(): void {
    setValor(store.getGame().seedStr);
    setSujo(false);
  }

  function gerar(semente: string): void {
    store.newRun(semente);
    adotarSementeDoJogo();
  }

  function aleatoria(): void {
    gerar(newSeedString());
  }

  function registrar(texto: string, ok: boolean): void {
    logMsg(
      store.getGame(),
      ok
        ? 'Semente copiada: ' + texto
        : 'Não foi possível copiar automaticamente. Semente selecionada: ' + texto,
      'sistema'
    );
    if (aoRegistrar) aoRegistrar();

    if (!refVivo.current) return;
    setRotuloCopiar(ok ? 'Copiada' : 'Selecionada');
    if (refTimer.current !== null) clearTimeout(refTimer.current);
    refTimer.current = setTimeout(() => {
      refTimer.current = null;
      if (refVivo.current) setRotuloCopiar(ROTULO_COPIAR);
    }, MS_ROTULO);
  }

  /** Plano B do vanilla: seleciona o texto do campo e tenta o `execCommand`. */
  function copiaAlternativa(texto: string): void {
    let ok = false;
    try {
      const campo = refCampo.current;
      if (campo) {
        campo.focus();
        campo.select();
        campo.setSelectionRange(0, campo.value.length);
        if (typeof document.execCommand === 'function') {
          ok = !!document.execCommand('copy');
        }
      }
    } catch (e) {
      ok = false;
    }
    registrar(texto, ok);
  }

  function copiar(): void {
    const texto = valor;
    if (!texto) return;
    try {
      const area = typeof navigator !== 'undefined' ? navigator.clipboard : null;
      if (area && typeof area.writeText === 'function') {
        const p = area.writeText(texto);
        if (p && typeof p.then === 'function') {
          // Promessa SEMPRE tratada — nada de rejeição solta no console.
          p.then(
            () => { registrar(texto, true); },
            () => { copiaAlternativa(texto); }
          ).catch(() => { /* o handler de rejeição acima nunca lança */ });
        } else {
          registrar(texto, true);
        }
        return;
      }
    } catch (e) { /* cai no plano B */ }
    copiaAlternativa(texto);
  }

  /* -------------------------------------------------------------- render */

  return (
    <section className="bloco">
      <h2 className="titulo">Semente</h2>

      <input
        ref={refCampo}
        id="seed"
        className="campo"
        type="text"
        inputMode="text"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        maxLength={48}
        placeholder="K7QX-3M9P"
        aria-label="Semente da masmorra"
        value={valor}
        onChange={(ev) => {
          setValor(ev.target.value);
          setSujo(true);
        }}
        onKeyDown={(ev) => {
          // Enquanto o foco está aqui, o teclado é do campo (contrato §10).
          ev.stopPropagation();
          if (ev.key === 'Enter') {
            ev.preventDefault();
            gerar(valor);
          }
        }}
        onKeyUp={(ev) => { ev.stopPropagation(); }}
      />

      <div className="botoes">
        <button
          type="button"
          id="btn-gerar"
          className="botao botao-primario"
          onClick={() => { gerar(valor); }}
        >
          Gerar
        </button>
        <button
          type="button"
          id="btn-aleatoria"
          className="botao"
          onClick={aleatoria}
        >
          Aleatória
        </button>
        <button
          type="button"
          id="btn-copiar"
          className="botao"
          onClick={copiar}
        >
          {rotuloCopiar}
        </button>
      </div>

      <p className="nota">A mesma semente reconstrói exatamente a mesma masmorra.</p>
    </section>
  );
}
