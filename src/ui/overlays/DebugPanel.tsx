/*
 * ISOROGUE — src/ui/overlays/DebugPanel.tsx
 *
 * Painel de depuração (R50/R51). Porte de `setDebug` + `descreverCursor` de
 * legacy/src-vanilla/60-ui.js.
 *
 * Os oito campos, NESTA ordem: semente, fps, jogador, cursor, conect., inimigos,
 * itens, visíveis. O texto é monoespaçado e alinhado em coluna 12 — o CSS
 * `.debug` usa `white-space: pre`, então os espaços do rótulo é que fazem o
 * alinhamento. Não troque por tabela: o formato tem de sair idêntico ao do
 * original.
 *
 * As camadas de debug DESENHADAS (valores de Dijkstra sobre o piso, grade,
 * sonda de FOV) são do renderer — este componente é só a caixa de texto.
 *
 * O FPS vem de `useFps()`, que já entrega o valor arredondado e só notifica a
 * cada 6 quadros, como o vanilla reescrevia o painel. `0` significa "ainda não
 * medido" e sai como '—'.
 */

import { store } from '../../engine/store';
import { useGameVersion } from '../hooks/useGameStore';
import { useFps } from '../hooks/useFps';
import type { Game } from '../../engine/types';

const NOME_TILE = ['parede', 'piso', 'porta', 'escada'];

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function inteiro(v: unknown): number {
  return Math.round(num(v));
}

/** Valor JÁ em escala 0..100 formatado como percentual pt-BR. */
function pctBruto(p: number, casas = 1): string {
  if (typeof p !== 'number' || !isFinite(p)) return '—';
  if (p >= 99.995) return '100%';
  if (p <= 0) return '0%';
  return p.toFixed(casas).replace('.', ',') + '%';
}

/** Fração 0..1 (formato de `map.connectivity`) formatada como percentual. */
function pct(v: number): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return pctBruto(v <= 1 ? v * 100 : v);
}

function inimigosVivos(game: Game): number {
  const lista = game.enemies;
  if (!lista || typeof lista.length !== 'number') return 0;
  let n = 0;
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i];
    if (e && num(e.hp) > 0) n++;
  }
  return n;
}

function descreverCursor(game: Game): string {
  const h = game.ui ? game.ui.hover : null;
  if (!h || typeof h.x !== 'number' || typeof h.y !== 'number') return '—';
  let txt = '(' + inteiro(h.x) + ',' + inteiro(h.y) + ')';
  const map = game.map;
  if (map && map.tiles && typeof map.w === 'number' &&
      h.x >= 0 && h.y >= 0 && h.x < map.w && h.y < map.h) {
    const t = map.tiles[h.y * map.w + h.x];
    txt += ' ' + (NOME_TILE[t] || 'desconhecido');
  }
  return txt;
}

export function DebugPanel() {
  useGameVersion();
  const quadros = useFps();
  const g = store.getGame();

  if (!g.ui.debug) return <div id="debug" className="debug" hidden />;

  const p = g.player;
  const map = g.map;

  const texto = [
    'semente     ' + (g.seedStr ? g.seedStr : '—'),
    'fps         ' + (quadros > 0 ? quadros : '—'),
    'jogador     (' + inteiro(p.x) + ',' + inteiro(p.y) + ')',
    'cursor      ' + descreverCursor(g),
    'conect.     ' + (map ? pct(map.connectivity) : '—'),
    'inimigos    ' + inimigosVivos(g),
    'itens       ' + (g.items ? g.items.length : 0),
    'visíveis    ' + (g.visible && typeof g.visible.size === 'number' ? g.visible.size : 0)
  ].join('\n');

  return (
    <div id="debug" className="debug">
      {texto}
    </div>
  );
}
