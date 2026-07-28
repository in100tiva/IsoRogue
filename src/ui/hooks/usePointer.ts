/*
 * ISOROGUE — src/ui/hooks/usePointer.ts
 *
 * Ponteiro sobre o canvas: realce do tile (R11), sonda de FOV (R28), campo
 * "cursor" do painel de depuração (R51) e posição do balão de criatura (R52).
 *
 * Porte de `onMouseMove` / `onMouseLeave` / `onClick` / `reprojetarPonteiro`
 * de legacy/src-vanilla/70-game.js, com as mesmas regras:
 *
 *   - o tile sob o ponteiro é `renderer.screenToTile(game, sx, sy)` com `sx/sy`
 *     RELATIVOS ao canvas (via `getBoundingClientRect`);
 *   - fora dos limites do mapa, o realce é limpo;
 *   - `store.setHover` só emite quando o TILE muda — mexer no realce nunca toca
 *     no estado lógico (R54);
 *   - a cada quadro a câmera anda sozinha (R09), então o tile sob um ponteiro
 *     PARADO muda de quadro em quadro: `reprojectPointer` é chamado pelo laço de
 *     rAF depois do `update` da câmera e antes do `draw`. Sem isso o realce, a
 *     sonda, o campo "cursor" e o balão ficariam presos no tile antigo.
 *     Custo O(1) por quadro.
 *
 * A posição de tela do ponteiro (coordenadas de cliente) fica num store externo
 * mínimo, consumido pelo `Tooltip` via `usePointer()`.
 */

import { useSyncExternalStore } from 'react';
import { store } from '../../engine/store';
import { CONFIG, idx } from '../../engine/core';
import { inBounds } from '../../engine/mapgen';
import type { Game, Point } from '../../engine/types';

/** Posição do ponteiro em coordenadas de cliente (as que o balão usa). */
export interface PointerPos {
  clientX: number;
  clientY: number;
}

/**
 * A fatia do renderer de que este módulo precisa. Interface estrutural de
 * propósito: o hook não deve depender da classe inteira nem importá-la.
 * Assinatura conforme docs/CONTRACTS.md §8.
 */
export interface PointerRenderer {
  screenToTile(game: Game, sx: number, sy: number): Point | null;
}

/* ------------------------------------------------------------------ *
 * Store externo mínimo da posição do ponteiro
 * ------------------------------------------------------------------ */

let ponteiro: PointerPos | null = null; // snapshot ESTÁVEL (só troca quando muda)
let ultimoNoCanvas: { sx: number; sy: number } | null = null; // para reprojetar

const listeners = new Set<() => void>();

function emitir(): void {
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getPointer(): PointerPos | null {
  return ponteiro;
}

/**
 * Posição de tela do ponteiro, ou `null` quando ele não está sobre o canvas.
 * Consumida pelo `Tooltip` para se posicionar.
 */
export function usePointer(): PointerPos | null {
  return useSyncExternalStore(subscribe, getPointer, getPointer);
}

/* ------------------------------------------------------------------ *
 * Projeção
 * ------------------------------------------------------------------ */

function posNoCanvas(cv: HTMLCanvasElement, ev: MouseEvent): { sx: number; sy: number } {
  let left = 0;
  let top = 0;
  if (typeof cv.getBoundingClientRect === 'function') {
    const r = cv.getBoundingClientRect();
    if (r) {
      left = r.left || 0;
      top = r.top || 0;
    }
  }
  return { sx: (ev.clientX || 0) - left, sy: (ev.clientY || 0) - top };
}

/**
 * Reprojeta a última posição de tela do ponteiro para um tile e atualiza o
 * realce. Devolve `true` se o tile sob o ponteiro mudou.
 * Só mexe em `ui.hover` (dado de interface), nunca no estado lógico — R54.
 */
export function reprojectPointer(renderer: PointerRenderer | null): boolean {
  const lp = ultimoNoCanvas;
  if (!renderer || !lp) return false;
  const g = store.getGame();
  const anterior = g.ui.hover;
  const t = renderer.screenToTile(g, lp.sx, lp.sy);
  if (t && inBounds(g.map, t.x, t.y)) {
    if (anterior && anterior.x === t.x && anterior.y === t.y) return false;
    store.setHover({ x: t.x, y: t.y });
    return true;
  }
  if (!anterior) return false;
  store.setHover(null);
  return true;
}

/* ------------------------------------------------------------------ *
 * Ligação com o canvas
 * ------------------------------------------------------------------ */

function tileEm(g: Game, x: number, y: number): number {
  if (!inBounds(g.map, x, y)) return CONFIG.TILE.WALL;
  return g.map.tiles[idx(g.map.w, x, y)];
}

/**
 * Liga os eventos de ponteiro ao canvas. Devolve a função de limpeza — o
 * `GameCanvas` a chama no cleanup do efeito, e é ela que torna o hook resiliente
 * à montagem dupla do StrictMode.
 */
export function attachPointer(
  cv: HTMLCanvasElement,
  renderer: PointerRenderer
): () => void {
  const onMouseMove = (ev: MouseEvent): void => {
    const pos = posNoCanvas(cv, ev);
    ultimoNoCanvas = pos;
    const cx = ev.clientX || 0;
    const cy = ev.clientY || 0;
    if (!ponteiro || ponteiro.clientX !== cx || ponteiro.clientY !== cy) {
      ponteiro = { clientX: cx, clientY: cy };
      emitir();
    }
    reprojectPointer(renderer);
  };

  const onMouseLeave = (): void => {
    ultimoNoCanvas = null;
    if (ponteiro) {
      ponteiro = null;
      emitir();
    }
    store.setHover(null);
  };

  // Clique em tile adjacente move/ataca; clique sobre a própria escada desce.
  // (Porte de `onClick` do vanilla — é comportamento existente, não feature nova.)
  const onMouseDown = (ev: MouseEvent): void => {
    const g = store.getGame();
    if (g.over) return;
    const pos = posNoCanvas(cv, ev);
    const t = renderer.screenToTile(g, pos.sx, pos.sy);
    if (!t || !inBounds(g.map, t.x, t.y)) return;
    const dx = t.x - g.player.x;
    const dy = t.y - g.player.y;
    if (dx === 0 && dy === 0) {
      if (tileEm(g, t.x, t.y) === CONFIG.TILE.STAIRS) store.dispatch({ kind: 'descend' });
      return;
    }
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) store.dispatch({ kind: 'move', dx, dy });
  };

  const onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  cv.addEventListener('mousemove', onMouseMove, false);
  cv.addEventListener('mouseleave', onMouseLeave, false);
  cv.addEventListener('mousedown', onMouseDown, false);
  cv.addEventListener('contextmenu', onContextMenu, false);

  return () => {
    cv.removeEventListener('mousemove', onMouseMove, false);
    cv.removeEventListener('mouseleave', onMouseLeave, false);
    cv.removeEventListener('mousedown', onMouseDown, false);
    cv.removeEventListener('contextmenu', onContextMenu, false);
    ultimoNoCanvas = null;
    if (ponteiro) {
      ponteiro = null;
      emitir();
    }
  };
}
