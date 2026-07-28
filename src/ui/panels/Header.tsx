/*
 * ISOROGUE — bloco de marca e cabeçalho do painel.
 *
 * Equivale a `#hud-nivel` / `#hud-turno` do vanilla (setTexto em
 * `R.UI.refresh`), com o mesmo arredondamento: `inteiro()` de 60-ui.js.
 * Os `id` originais permanecem — nada mais depende deles, mas manter o DOM
 * idêntico é a forma mais barata de provar paridade.
 */

import { useGameValue } from '../hooks/useGameStore';

/** `inteiro()` de legacy/src-vanilla/60-ui.js: não-finito vira 0. */
function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

export function Header() {
  const nivel = useGameValue((g) => inteiro(g.depth));
  const turno = useGameValue((g) => inteiro(g.turn));

  return (
    <header className="bloco bloco-marca">
      <h1 className="marca">ISOROGUE</h1>
      <p className="marca-sub">Expedição isométrica por turnos</p>
      <div className="grade-2">
        <div className="dado">
          <span className="rotulo">Nível</span>
          <span className="valor valor-g" id="hud-nivel">{nivel}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Turno</span>
          <span className="valor valor-g" id="hud-turno">{turno}</span>
        </div>
      </div>
    </header>
  );
}
