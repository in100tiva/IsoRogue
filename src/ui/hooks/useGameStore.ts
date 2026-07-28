/*
 * ISOROGUE — src/ui/hooks/useGameStore.ts
 *
 * A única porta de leitura do estado do jogo pelo React
 * (docs/ARQUITETURA-REACT.md §4).
 *
 * O `Game` é um objeto mutável, grande e de vida longa: `Uint8Array`,
 * `Int32Array`, `Set<number>`. Ele NUNCA entra em `useState`, nunca é clonado
 * por spread, nunca é congelado. O React observa esse estado por assinatura de
 * VERSÃO — `store.getVersion()` — e lê o dado direto de `store.getGame()`.
 *
 * ─────────────────────── REGRA DURA DO SELETOR ───────────────────────
 * `useGameValue(select)` roda `select(store.getGame())` a CADA render e a cada
 * notificação, e o React compara o resultado com `Object.is`. Portanto o
 * seletor DEVE devolver:
 *
 *   - um primitivo (number | string | boolean | null | undefined); OU
 *   - uma referência estável que só muda quando o dado muda
 *     (ex.: `g.enemies`, `g.log`, `g.map` — os próprios arrays/objetos vivos).
 *
 * Devolver um objeto NOVO a cada chamada — `g => ({ hp: g.player.hp })`,
 * `g => g.log.slice(-200)`, `g => [...g.visible]` — cria uma referência
 * diferente toda vez, `Object.is` sempre falha, e o React entra em loop
 * infinito de render ("The result of getSnapshot should be cached").
 *
 * Para ler várias coisas há dois caminhos, ambos corretos:
 *   1. vários `useGameValue`, um por primitivo; ou
 *   2. `useGameVersion()` no topo do componente + leitura direta de
 *      `store.getGame()` no corpo — a versão já garante a re-renderização.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useSyncExternalStore } from 'react';
import { store } from '../../engine/store';
import type { Game } from '../../engine/types';

/**
 * Assina o store e devolve o contador de versão. Só serve para forçar a
 * re-renderização: o valor em si não interessa a ninguém. Use quando o
 * componente lê muitos campos e vai buscá-los em `store.getGame()`.
 */
export function useGameVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/**
 * Assina o store e devolve `select(game)`.
 * Leia a REGRA DURA DO SELETOR no topo do arquivo antes de usar.
 */
export function useGameValue<T>(select: (g: Game) => T): T {
  const ler = (): T => select(store.getGame());
  return useSyncExternalStore(store.subscribe, ler, ler);
}
