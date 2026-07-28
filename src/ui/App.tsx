/*
 * ISOROGUE — casca da aplicação.
 *
 * Reproduz a estrutura de legacy/src-vanilla/shell.html nó a nó:
 *
 *   <div class="app">
 *     <main class="palco"> <canvas id="cv"> <div id="debug"> </main>
 *     <aside class="painel"> ...blocos... </aside>
 *   </div>
 *   <div id="tooltip">
 *   <div id="morte">
 *
 * `tooltip` e `morte` continuam FORA de `.app`, como no vanilla: o balão é
 * `position: absolute` ancorado no documento e o overlay de morte é `fixed`.
 *
 * O App não lê estado do jogo. Ele monta a árvore, liga o teclado global e sai
 * do caminho — quem observa o `store` é cada painel, pelo seu próprio seletor.
 */

import { GameCanvas } from './GameCanvas';
import { Sidebar } from './Sidebar';
import { DebugPanel } from './overlays/DebugPanel';
import { DeathOverlay } from './overlays/DeathOverlay';
import { Tooltip } from './overlays/Tooltip';
import { useKeyboard } from './hooks/useKeyboard';

export function App() {
  useKeyboard();

  return (
    <>
      <div className="app">
        <main className="palco">
          <GameCanvas />
          <DebugPanel />
        </main>

        <Sidebar />
      </div>

      <Tooltip />
      <DeathOverlay />
    </>
  );
}
