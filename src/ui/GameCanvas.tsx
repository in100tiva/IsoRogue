/*
 * ISOROGUE — src/ui/GameCanvas.tsx
 *
 * O canvas vive FORA do React (docs/ARQUITETURA-REACT.md §5).
 *
 *   - `useEffect` com array de dependências VAZIO, de propósito: o laço nunca
 *     deve reiniciar por causa de um re-render.
 *   - Laço de rAF próprio. O componente NÃO usa hook de estado do jogo: lê
 *     `store.getGame()` dentro do quadro. Um `useGameValue` aqui re-renderizaria
 *     o React 60 vezes por segundo sem necessidade.
 *   - `ResizeObserver` no elemento PAI (o `.palco`), no lugar do listener de
 *     `resize` do vanilla.
 *   - O cleanup precisa ser exato: o StrictMode monta e desmonta duas vezes em
 *     desenvolvimento e dois laços de rAF sobrepostos dobrariam o FPS e a
 *     velocidade da animação. Ele cancela o rAF, desconecta o observer, solta os
 *     eventos de ponteiro, zera o medidor de FPS e chama `renderer.dispose()`.
 *   - `performance.now()` é legítimo AQUI: alimenta apenas animação e o contador
 *     de quadros. Nunca chega ao engine (R54).
 */

import { useEffect, useRef } from 'react';
import { store } from '../engine/store';
import { IsoRenderer } from '../render/IsoRenderer';
import { attachPointer, reprojectPointer } from './hooks/usePointer';
import { reportFrame, resetFps } from './hooks/useFps';

/*
 * Referência viva ao renderer em uso.
 *
 * O renderer é criado dentro do efeito (é ele quem possui o canvas), mas o
 * teclado precisa dele para o zoom — `R.Render.setZoom` no vanilla. Guardar a
 * instância aqui, no módulo que a cria, evita passar renderer por props ou
 * contexto só por causa de duas teclas. O cleanup limpa a referência apenas se
 * ela ainda apontar para a própria instância, para a montagem dupla do
 * StrictMode não anular o renderer do segundo laço.
 */
let rendererAtual: IsoRenderer | null = null;

/** Renderer em uso, ou `null` antes da montagem do canvas. */
export function getRenderer(): IsoRenderer | null {
  return rendererAtual;
}

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    const renderer = new IsoRenderer(cv);
    rendererAtual = renderer;
    resetFps();

    const soltarPonteiro = attachPointer(cv, renderer);

    let raf = 0;
    let vivo = true;
    let last = performance.now();

    const frame = (now: number): void => {
      if (!vivo) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        const g = store.getGame();
        renderer.update(g, dt); // SÓ animação (R54)
        reportFrame(dt);
        // A câmera anda sozinha a cada passo (R09): o tile sob um ponteiro
        // PARADO muda de quadro em quadro. Reprojetamos com a câmera já lerpada
        // deste quadro e ANTES de desenhar — sem isso o realce âmbar (R11), a
        // sonda de FOV (R28), o campo "cursor" do painel (R51) e o balão (R52)
        // ficariam presos no tile antigo.
        reprojectPointer(renderer);
        renderer.draw(g);
      } catch (err) {
        // Um erro por quadro viraria uma tempestade no console (R57): o laço
        // para na primeira falha, exatamente como no vanilla.
        vivo = false;
        console.error('ISOROGUE: laço de desenho interrompido —', err);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let ro: ResizeObserver | null = null;
    const pai = cv.parentElement;
    // `ResizeObserver` não existe no jsdom dos testes de UI: a ausência degrada
    // sem lançar, ela não é motivo para derrubar a montagem.
    if (pai && typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => {
        renderer.resize();
      });
      ro.observe(pai);
    } else {
      renderer.resize();
    }

    /*
     * O `ResizeObserver` observa a caixa em pixels CSS. Uma troca APENAS de
     * `devicePixelRatio` — arrastar a janela para um monitor de DPI diferente,
     * mudar o zoom do navegador — não muda o tamanho do elemento e não dispara o
     * observer: o backing store ficaria na resolução antiga e o jogo apareceria
     * borrado. O vanilla recomputava o dpr em todo `resize` de janela
     * (50-render.js:296 e 70-game.js:1376). A sonda equivalente aqui, e sem
     * nenhum custo por quadro, é uma media query de resolução que se
     * re-registra com o dpr novo a cada troca.
     */
    let mql: MediaQueryList | null = null;

    const soltarDpr = (): void => {
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', aoTrocarDpr);
      }
      mql = null;
    };

    function observarDpr(): void {
      // jsdom não implementa `matchMedia`: a ausência degrada sem lançar.
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      soltarDpr();
      const dpr = window.devicePixelRatio || 1;
      const consulta = window.matchMedia('(resolution: ' + dpr + 'dppx)');
      if (!consulta || typeof consulta.addEventListener !== 'function') return;
      mql = consulta;
      consulta.addEventListener('change', aoTrocarDpr);
    }

    function aoTrocarDpr(): void {
      renderer.resize();
      observarDpr(); // o dppx é outro: a consulta anterior não vale mais
    }

    observarDpr();

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      soltarDpr();
      soltarPonteiro();
      resetFps();
      if (rendererAtual === renderer) rendererAtual = null;
      renderer.dispose();
    };
  }, []);

  return <canvas id="cv" ref={ref} className="game-canvas" />;
}
