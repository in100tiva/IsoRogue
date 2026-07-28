/*
 * ISOROGUE — src/ui/overlays/Tooltip.tsx
 *
 * Balão de criatura (R52). Porte de `tooltipHtml` + `atualizarTooltip` de
 * legacy/src-vanilla/70-game.js e de `showTooltip` / `posicionarTooltip` de
 * legacy/src-vanilla/60-ui.js.
 *
 * Os seis campos, NESTA ordem e com estes textos:
 *   arquétipo (título) · Vida x/y · Distância (Chebyshev) · Dijkstra do tile da
 *   criatura · Estado · Ação planejada (`ent.plan`).
 *
 * Só aparece sobre criatura VISÍVEL: o índice do tile sob o cursor precisa estar
 * em `game.visible` (R31). `pointer-events: none` vem do CSS (`.tooltip`).
 *
 * O posicionamento é imperativo, num `useLayoutEffect`, porque depende de
 * `offsetWidth`/`offsetHeight` do próprio balão já renderizado — é o mesmo
 * cálculo do vanilla, inclusive as viradas de lado perto das bordas da janela e
 * o deslocamento por `scrollX/scrollY` (a caixa é `position: absolute`).
 */

import { useLayoutEffect, useRef } from 'react';
import { store } from '../../engine/store';
import { cheb, idx } from '../../engine/core';
import { ARCHETYPES, enemyAt } from '../../engine/entities';
import { DIJKSTRA_INF } from '../../engine/dijkstra';
import { useGameVersion } from '../hooks/useGameStore';
import { usePointer } from '../hooks/usePointer';
import type { Enemy, EnemyState } from '../../engine/types';

/*
 * O vanilla tem DUAS tabelas de estado em pt-BR: a de `40-entities.js`
 * (`STATE_LABEL`, com `hunt: 'em perseguição'`) e a de `70-game.js`
 * (`ESTADOS`, com `hunt: 'caçando'`). Quem alimenta o balão é a SEGUNDA.
 * A duplicação é um defeito do original; migração pura preserva o texto que o
 * jogador vê, então aqui fica `caçando` — não troque por `stateLabel()`.
 */
const ESTADOS: Record<EnemyState, string> = {
  idle: 'ocioso',
  hunt: 'caçando',
  flee: 'em fuga',
  attack: 'atacando',
  wait: 'aguardando'
};

function estadoPt(state: EnemyState): string {
  return ESTADOS[state] || 'ocioso';
}

function nomeDe(ent: Enemy): string {
  const arch = ARCHETYPES[ent.kind];
  return arch && arch.nome ? arch.nome : 'Criatura';
}

const MARGEM = 16;

export function Tooltip() {
  useGameVersion();
  const pos = usePointer();
  const ref = useRef<HTMLDivElement>(null);

  const g = store.getGame();
  const h = g.ui.hover;

  let ent: Enemy | null = null;
  if (h) {
    const i = idx(g.map.w, h.x, h.y);
    if (g.visible && g.visible.has(i)) ent = enemyAt(g, h.x, h.y);
  }

  const visivel = !!ent && !!pos;
  const sx = pos ? pos.clientX : 0;
  const sy = pos ? pos.clientY : 0;

  // Sem array de dependências: reposiciona a cada render, como o vanilla
  // reposicionava a cada `showTooltip`.
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || !visivel) return;
    const larg = t.offsetWidth || 220;
    const alt = t.offsetHeight || 96;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const ox = window.scrollX || 0;
    const oy = window.scrollY || 0;

    let x = sx + MARGEM;
    let y = sy + MARGEM;
    if (vw && x + larg + 8 > vw) x = sx - larg - MARGEM;
    if (vh && y + alt + 8 > vh) y = sy - alt - MARGEM;
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    t.style.left = x + ox + 'px';
    t.style.top = y + oy + 'px';
  });

  if (!visivel || !ent) {
    return <div id="tooltip" ref={ref} className="tooltip" role="tooltip" hidden />;
  }

  const i = idx(g.map.w, ent.x, ent.y);
  const d = g.dmap ? g.dmap[i] : null;
  const dv = d === null || d === undefined || d >= DIJKSTRA_INF ? 'inalcançável' : String(d);
  const dist = cheb(g.player.x, g.player.y, ent.x, ent.y);

  return (
    <div id="tooltip" ref={ref} className="tooltip" role="tooltip">
      <div className="tt-nome">{nomeDe(ent)}</div>
      <div>{'Vida ' + ent.hp + '/' + ent.maxHp}</div>
      <div>{'Distância ' + dist}</div>
      <div>{'Dijkstra ' + dv}</div>
      <div>{'Estado: ' + estadoPt(ent.state)}</div>
      <div>{'Ação: ' + (ent.plan ? ent.plan : 'sem plano')}</div>
    </div>
  );
}
