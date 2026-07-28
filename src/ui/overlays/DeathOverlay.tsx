/*
 * ISOROGUE — src/ui/overlays/DeathOverlay.tsx
 *
 * Resumo da expedição na morte permanente (R47/R48). Porte de `showDeath` de
 * legacy/src-vanilla/60-ui.js e do marcador `#morte` de
 * legacy/src-vanilla/shell.html.
 *
 * Os nove campos, NESTA ordem e com estes rótulos: Semente, Nível alcançado,
 * Turnos, Inimigos derrotados, Dano causado, Dano recebido, Itens usados,
 * Exploração e a causa da morte (o nono campo é a faixa `.morte-causa`, sem
 * rótulo, como no original). Mais o botão `Nova expedição`.
 *
 * A exploração é RECALCULADA a partir de `map.tiles` + `game.explored` — é o que
 * o vanilla faz; `stats.explorePct` só entra como plano B. Manter os dois
 * caminhos importa: eles arredondam diferente (`stats.explorePct` já vem com uma
 * casa) e o número exibido tem de bater com o do original.
 */

import { useEffect, useRef } from 'react';
import { store } from '../../engine/store';
import { CONFIG, newSeedString } from '../../engine/core';
import { useGameVersion } from '../hooks/useGameStore';
import type { Game } from '../../engine/types';

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function inteiro(v: unknown): number {
  return Math.round(num(v));
}

/** Formata um valor JÁ em escala 0..100 como percentual pt-BR (vírgula decimal). */
function pctBruto(p: number, casas = 1): string {
  if (typeof p !== 'number' || !isFinite(p)) return '—';
  if (p >= 99.995) return '100%';
  if (p <= 0) return '0%';
  return p.toFixed(casas).replace('.', ',') + '%';
}

/** Percentual de tiles caminháveis já explorados no nível atual. */
function exploracao(game: Game): number {
  const map = game ? game.map : null;
  if (map && game.explored && map.tiles && typeof map.w === 'number') {
    const parede = CONFIG.TILE.WALL;
    let total = 0;
    let vistos = 0;
    const n = map.w * map.h;
    for (let i = 0; i < n; i++) {
      if (map.tiles[i] !== parede) {
        total++;
        if (game.explored[i]) vistos++;
      }
    }
    if (total > 0) return (vistos / total) * 100;
  }
  const st = game ? game.stats : null;
  if (st && typeof st.explorePct === 'number' && isFinite(st.explorePct)) {
    return st.explorePct <= 1 ? st.explorePct * 100 : st.explorePct;
  }
  return 0;
}

export function DeathOverlay() {
  useGameVersion();
  const g = store.getGame();
  const botaoRef = useRef<HTMLButtonElement>(null);
  const over = !!g.over;

  // O vanilla dava foco ao botão ao abrir o resumo — teclado continua útil.
  useEffect(() => {
    if (!over) return;
    const b = botaoRef.current;
    if (b && typeof b.focus === 'function') b.focus();
  }, [over]);

  /*
   * O corpo do resumo só é montado na morte — é o que o vanilla faz: em
   * legacy/src-vanilla/shell.html:128 o `#morte-corpo` nasce VAZIO e só o
   * `showDeath` o preenche. Aqui isso também evita que `exploracao()` varra os
   * 45×45 tiles do mapa a cada emissão do store (o realce sob o ponteiro emite
   * a cada troca de tile, dentro do laço de rAF) com o overlay escondido.
   * A casca — `#morte`, `.morte-caixa`, `#morte-corpo`, `#btn-nova` — continua
   * sempre no DOM, como no shell do vanilla e como exige o §9 do CONTRACTS.md.
   */
  const st = g.stats;
  const nivel = Math.max(inteiro(g.depth), inteiro(st.deepest));
  const turnos = inteiro(st.turns) || inteiro(g.turn);
  const causa = typeof g.cause === 'string' && g.cause ? g.cause : 'Causa desconhecida.';

  const linhas: [string, string][] = over
    ? [
      ['Semente', g.seedStr ? g.seedStr : '—'],
      ['Nível alcançado', String(nivel)],
      ['Turnos', String(turnos)],
      ['Inimigos derrotados', String(inteiro(st.kills))],
      ['Dano causado', String(inteiro(st.dmgDealt))],
      ['Dano recebido', String(inteiro(st.dmgTaken))],
      ['Itens usados', String(inteiro(st.itemsUsed))],
      ['Exploração', pctBruto(exploracao(g))]
    ]
    : [];

  // `onNova` do vanilla: semente NOVA e aleatória, não a do campo.
  const novaExpedicao = (): void => {
    store.newRun(newSeedString());
  };

  return (
    <div id="morte" className="morte" hidden={!over}>
      <div
        className="morte-caixa"
        role="dialog"
        aria-modal="true"
        aria-label="Resumo da expedição"
      >
        <p className="morte-tag">Fim da expedição</p>
        <h2 className="morte-titulo">A masmorra ficou com você</h2>
        <div id="morte-corpo" className="morte-corpo">
          {linhas.map(([rotulo, valor]) => (
            <div className="morte-linha" key={rotulo}>
              <span className="morte-rotulo">{rotulo}</span>
              <span className="morte-valor">{valor}</span>
            </div>
          ))}
          {over ? <span className="morte-causa">{causa}</span> : null}
        </div>
        <button
          type="button"
          id="btn-nova"
          className="botao botao-primario botao-largo"
          ref={botaoRef}
          onClick={novaExpedicao}
        >
          Nova expedição
        </button>
      </div>
    </div>
  );
}
