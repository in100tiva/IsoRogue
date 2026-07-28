/*
 * ISOROGUE — src/ui/hooks/useFps.ts
 *
 * Medidor de quadros por segundo do painel de depuração (R51).
 *
 * Porte de `frame()` em legacy/src-vanilla/70-game.js: média exponencial do
 * inverso do `dt` do laço de animação, com o mesmo fator 0,08 e as mesmas
 * guardas de `dt` inválido. No vanilla o número morava em `game.ui.fps`; aqui
 * ele vive na camada de UI, porque `GameUi` (engine/types.ts) não tem — e não
 * pode ter — um campo alimentado por relógio de parede: o engine é puro.
 *
 * O `dt` só influencia animação e este contador. Jamais o estado lógico (R54).
 *
 * A cadência de NOTIFICAÇÃO é a do vanilla: o painel de depuração era reescrito
 * a cada 6 quadros (`frameTick % 6 === 0`) e só quando o texto mudava — sem esse
 * portão o `DebugPanel` re-renderizaria 60 vezes por segundo.
 *
 * O VALOR, porém, é atualizado a cada quadro, como em 70-game.js:1341
 * (`game.ui.fps = ...` dentro do próprio `frame()`). São coisas diferentes: com
 * o rAF estrangulado (aba em segundo plano, máquina fraca, primeiro instante da
 * página) o portão de 6 quadros travava o painel em '—' onde o vanilla já
 * mostrava um número — e qualquer re-render vindo de um turno lia o valor velho.
 */

import { useSyncExternalStore } from 'react';

let fpsAvg = 0; // média exponencial (float)
let frameTick = 0; // contador de quadros desde o último reset
let fpsAtual = 0; // snapshot ESTÁVEL exposto ao React
let pendente = false; // o valor mudou desde a última notificação?

const listeners = new Set<() => void>();

function emitir(): void {
  listeners.forEach((l) => {
    l();
  });
}

/**
 * Alimenta o medidor com o `dt` (em segundos) do quadro recém-desenhado.
 * Chamado pelo laço de rAF de `GameCanvas`, nunca pelo engine.
 */
export function reportFrame(dt: number): void {
  // Mesma guarda do vanilla: quadro degenerado (aba em segundo plano, primeiro
  // quadro, relógio andando para trás) vale 1/60 e não contamina a média.
  let d = dt;
  if (!(d > 0) || d > 0.25) d = 1 / 60;

  const inst = 1 / d;
  fpsAvg = fpsAvg === 0 ? inst : fpsAvg + (inst - fpsAvg) * 0.08;
  frameTick++;

  // Valor: sempre em dia (é uma variável de módulo, custo zero).
  const arredondado = Math.round(fpsAvg);
  if (arredondado !== fpsAtual) {
    fpsAtual = arredondado;
    pendente = true;
  }

  // Notificação: a cada 6 quadros, e só se houve mudança desde a última.
  if (frameTick % 6 !== 0) return;
  if (!pendente) return;
  pendente = false;
  emitir();
}

/**
 * Zera a média. O laço de rAF chama isto ao montar e ao desmontar para que a
 * montagem dupla do StrictMode não deixe resíduo de um laço já cancelado.
 */
export function resetFps(): void {
  fpsAvg = 0;
  frameTick = 0;
  pendente = false;
  if (fpsAtual !== 0) {
    fpsAtual = 0;
    emitir();
  }
}

/** Último valor arredondado. Referência estável — seguro para getSnapshot. */
export function getFps(): number {
  return fpsAtual;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Quadros por segundo arredondados. `0` significa "ainda não medido" (o painel mostra '—'). */
export function useFps(): number {
  return useSyncExternalStore(subscribe, getFps, getFps);
}
