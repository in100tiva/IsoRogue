/*
 * ISOROGUE — bloco Vitais.
 *
 * Porte de `R.UI.refresh` (legacy/src-vanilla/60-ui.js), inclusive nos limiares:
 *   razão > 0,50            -> barra-ok
 *   razão <= 0,50 e > 0,25  -> barra-alerta
 *   razão <= 0,25           -> barra-critico + `valor-baixo` no número
 * A largura sai por `setLargura`: 0..100 com uma casa decimal e sufixo '%'.
 *
 * FASE 2 (economia): as MOEDAS e o REFINO da arma entram aqui, e não no painel
 * de troca, porque são estado permanente do JOGADOR — atravessam a descida
 * junto com a bolsa (`descend` não os toca) e precisam estar na tela quando o
 * jogador decide se vale a pena voltar ao mercador. Um número que só existe
 * quando o balcão está aberto não ajuda a planejar a ida até ele.
 *
 * O refino aparece como `n/ARMA_NIVEL_MAX` porque o interessante dele é o que
 * FALTA: 'Refino 2/5' diz que ainda há três degraus; o '+2 de ataque' que ele
 * já rendeu está somado em `player.atk`, logo ali ao lado, e mostrá-lo duas
 * vezes só faria o jogador procurar a soma que não existe.
 */

import { ARMA_NIVEL_MAX } from '../../engine/entities';
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

export function Vitals() {
  const hp = useGameValue((g) => Math.max(0, inteiro(g.player.hp)));
  const maxHp = useGameValue((g) => Math.max(1, inteiro(g.player.maxHp)));
  const atk = useGameValue((g) => inteiro(g.player.atk));
  const pocoes = useGameValue((g) => inteiro(g.player.potions));
  const moedas = useGameValue((g) => Math.max(0, inteiro(g.player.moedas)));
  const armaNivel = useGameValue((g) => Math.max(0, inteiro(g.player.armaNivel)));

  const razao = hp / maxHp;
  const classeBarra = razao > 0.5
    ? 'barra-ok'
    : (razao > 0.25 ? 'barra-alerta' : 'barra-critico');

  return (
    <section className="bloco">
      <h2 className="titulo">Vitais</h2>

      <div className="vida-cabeca">
        <span className="rotulo">Vida</span>
        <span
          className={'valor valor-vida' + (razao <= 0.25 ? ' valor-baixo' : '')}
          id="hud-vida"
        >
          {hp}/{maxHp}
        </span>
      </div>

      <div className="barra">
        <span
          className={'barra-preenche ' + classeBarra}
          id="hud-vida-barra"
          style={{ width: largura(razao * 100) }}
        />
      </div>

      <div className="grade-2">
        <div className="dado">
          <span className="rotulo">Ataque</span>
          <span className="valor" id="hud-atk">{atk}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Poções</span>
          <span className="valor" id="hud-pocoes">{pocoes}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Moedas</span>
          <span className="valor valor-moedas" id="hud-moedas">{moedas}</span>
        </div>
        <div className="dado">
          <span className="rotulo">Refino</span>
          <span className="valor" id="hud-arma">{armaNivel}/{ARMA_NIVEL_MAX}</span>
        </div>
      </div>
    </section>
  );
}
