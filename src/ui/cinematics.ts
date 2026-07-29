/*
 * ISOROGUE — src/ui/cinematics.ts
 *
 * Micro-store da fase da cinemática do guerreiro, no padrão de
 * `src/engine/store.ts` (subscribe/getSnapshot para `useSyncExternalStore`).
 *
 * A dona da verdade é a máquina do `IsoRenderer` (campos `cin.*`, alimentados
 * só por `dt` e por observação do estado — R54: nada disto toca o engine).
 * Este módulo é só a PONTE: o laço de rAF de `GameCanvas.tsx` chama
 * `sincronizar(renderer.faseCinematica())` a cada quadro e a store emite
 * APENAS quando a fase muda — um emit por transição, nunca um por quadro.
 *
 * Consumidores:
 *   - `overlays/DeathOverlay.tsx` — o modal de morte só abre em 'concluida'
 *     (depois do fade completo), assinando `faseAtual()`;
 *   - `hooks/useKeyboard.ts` e `hooks/usePointer.ts` — `inputBloqueado()`
 *     trava o input do jogador durante 'intro' e 'morte'.
 *
 * O tipo `FaseCinematica` é importado do renderer: duas uniões literais
 * duplicadas divergiriam em silêncio, e a fronteira de camadas permite
 * ui → render (o contrário é proibido — tools/check-boundaries.mjs).
 */

import type { FaseCinematica } from '../render/IsoRenderer';

export type { FaseCinematica };

let fase: FaseCinematica = 'nenhuma';
const listeners = new Set<() => void>();

function emitir(): void {
  listeners.forEach((l) => {
    l();
  });
}

/** Assinatura no formato de `useSyncExternalStore`. */
export function subscribeCinematics(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Snapshot estável: a fase só troca por `sincronizar`, nunca no meio do render. */
export function faseAtual(): FaseCinematica {
  return fase;
}

/** Input do jogador travado (intro e morte). Lido direto, sem assinatura. */
export function inputBloqueado(): boolean {
  return fase === 'intro' || fase === 'morte';
}

/**
 * Chamada a cada quadro pelo laço de rAF. Emite SOMENTE quando a fase muda —
 * é o que mantém o React fora do caminho quente da animação.
 */
export function sincronizar(faseDoRenderer: FaseCinematica): void {
  if (faseDoRenderer === fase) return;
  fase = faseDoRenderer;
  emitir();
}
