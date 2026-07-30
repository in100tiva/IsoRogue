/*
 * ISOROGUE — bloco de marca e cabeçalho do painel.
 *
 * Equivale a `#hud-nivel` / `#hud-turno` do vanilla (setTexto em
 * `R.UI.refresh`), com o mesmo arredondamento: `inteiro()` de 60-ui.js.
 * Os `id` originais permanecem — nada mais depende deles, mas manter o DOM
 * idêntico é a forma mais barata de provar paridade.
 *
 * §16 do docs/BESTIARIO.md (fase do XP visível): o "Nível" do cabeçalho
 * SEMPRE foi a profundidade da masmorra (`game.depth`) e a confusão era
 * inevitável — o jogador lia "o meu nível não sobe". O rótulo agora diz o
 * que o número é: ANDAR. O NÍVEL DE VERDADE (o do herói, `player.level`)
 * entra ao lado, com o XP acumulado (`player.xp`/100, a régua plana de §15)
 * e a barra de progresso — o mesmo idioma visual da barra de vida.
 */

import { useGameValue } from '../hooks/useGameStore';

/** `inteiro()` de legacy/src-vanilla/60-ui.js: não-finito vira 0. */
function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/** `setLargura` do vanilla: recorta em [0, 100] e formata com uma casa. */
function largura(porcento: number): string {
  const v = Number.isFinite(porcento) ? porcento : 0;
  return Math.max(0, Math.min(100, v)).toFixed(1) + '%';
}

/** §15 — XP plano: 100 por nível, para qualquer nível. */
const XP_POR_NIVEL = 100;

export function Header() {
  const nivel = useGameValue((g) => inteiro(g.depth));
  const turno = useGameValue((g) => inteiro(g.turn));
  const nivelHeroi = useGameValue((g) => inteiro(g.player.level));
  const xp = useGameValue((g) => Math.max(0, inteiro(g.player.xp)));

  return (
    <header className="bloco bloco-marca">
      <h1 className="marca">ISOROGUE</h1>
      <p className="marca-sub">Expedição isométrica por turnos</p>
      <div className="grade-2">
        <div className="dado">
          <span className="rotulo">Andar</span>
          <span className="valor valor-g" id="hud-nivel">{nivel}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Turno</span>
          <span className="valor valor-g" id="hud-turno">{turno}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Nível</span>
          <span className="valor valor-g" id="hud-heroi-nivel">{nivelHeroi}</span>
        </div>
        <div className="dado">
          <span className="rotulo">XP</span>
          <span className="valor" id="hud-xp">{xp}/{XP_POR_NIVEL}</span>
        </div>
      </div>
      <div className="barra" title="Experiência">
        <span
          className="barra-preenche barra-xp"
          id="hud-xp-barra"
          style={{ width: largura((xp / XP_POR_NIVEL) * 100) }}
        />
      </div>
    </header>
  );
}
