/*
 * ISOROGUE — engine/store.ts
 *
 * ─────────────────────────── A FRONTEIRA ───────────────────────────
 * Este é o ÚNICO ponto do engine que existe por causa do React — e, ainda
 * assim, ele NÃO importa react, não conhece JSX, não toca em DOM. É apenas um
 * observable: guarda o `Game` (objeto mutável, grande e de vida longa), expõe
 * `subscribe`/`getVersion` no formato que `useSyncExternalStore` consome e
 * incrementa a versão a cada mutação observável.
 *
 * A regra do §0/§4 do docs/ARQUITETURA-REACT.md em uma frase: o React observa o
 * estado por assinatura de versão, nunca por posse. Nada aqui clona, congela ou
 * copia o `Game`; `getGame()` devolve a referência viva.
 *
 * Do lado de cá também moram os efeitos colaterais que no vanilla ficavam na
 * camada com DOM de `70-game.js` (newRun, retomada do autosave, alternância das
 * preferências de interface) — todos com os MESMOS textos de log.
 * ───────────────────────────────────────────────────────────────────
 */

import type { Command, Game, Point } from './types';
import { newSeedString } from './core';
import { applyCommand, createState, descend as descerNivel, logMsg, restore } from './game';
import { read as lerSave, write as escreverSave } from './save';

export class GameStore {
  private game: Game | null = null;
  private version = 0;                       // incrementa a CADA mutação observável
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  /** Snapshot estável para useSyncExternalStore — número, nunca objeto novo. */
  getVersion = (): number => this.version;

  /** Acesso direto ao estado vivo, sem cópia. */
  getGame = (): Game => {
    // Leitura nunca notifica ninguém (emitir durante um render derrubaria o
    // React), por isso a carga preguiçosa aqui é silenciosa.
    if (!this.game) this.carregar();
    return this.game as Game;
  };

  private emit(): void {
    this.version++;
    this.listeners.forEach((l) => {
      l();
    });
  }

  /**
   * Retomada do vanilla (`startInner`): se houver save válido e a run não estiver
   * morta, retoma; senão começa uma expedição nova. Mesmas mensagens de registro.
   */
  private carregar(): void {
    let retomado: Game | null = null;
    try {
      retomado = restore(lerSave());
    } catch (e) {
      retomado = null;
    }
    const g = retomado || createState(newSeedString(), 1);
    this.game = g;
    if (retomado) {
      logMsg(g, 'Expedição retomada no nível ' + g.depth +
        ', turno ' + g.turn + '.', 'sistema');
    } else {
      logMsg(g, 'Nova expedição. Semente ' + g.seedStr + '.', 'sistema');
    }
    this.autosave(g);
  }

  private autosave(game: Game): void {
    if (game.over) return;
    try {
      escreverSave(game);
    } catch (e) { /* armazenamento indisponível não pode quebrar o jogo */ }
  }

  /** Nova expedição com a semente dada (nível 1). Preferências de UI sobrevivem. */
  newRun(seed: string): void {
    const anterior = this.game;
    const novo = createState(seed, 1);
    if (anterior) {
      // `adotarEstado` do vanilla: as preferências de interface atravessam a
      // troca de partida; o realce sob o cursor, não.
      novo.ui.debug = anterior.ui.debug;
      novo.ui.fovProbe = anterior.ui.fovProbe;
      novo.ui.follow = anterior.ui.follow;
      novo.ui.hover = null;
    }
    this.game = novo;
    logMsg(novo, 'Nova expedição iniciada.', 'sistema');
    this.autosave(novo);
    this.emit();
  }

  /**
   * Porta única de comando vinda da UI. `applyCommand` já resolve a fase de fim
   * de turno internamente (Dijkstra -> inimigos -> FOV -> stats -> autosave), como
   * no vanilla — chamar `endTurn` de novo aqui processaria o turno duas vezes.
   *
   * Emitir só quando o turno foi consumido NÃO basta. No vanilla o próprio
   * `logMsg` anexava a linha ao DOM (`R.UI.pushLog`, legacy/src-vanilla/70-game.js:184),
   * então a RECUSA de um comando aparecia no ato: 'Você não tem poções.',
   * 'Sua vida já está completa.' e 'Não há escada aqui.' saem de caminhos que
   * devolvem `false`. Sem esta emissão a linha entrava em `game.log` e só surgia
   * na próxima ação bem-sucedida — divergência de comportamento observável.
   *
   * A sonda é a REFERÊNCIA da última entrada, não `log.length`: no teto de
   * `CONFIG.MAX_LOG` o `logMsg` apara o excesso e o comprimento fica igual
   * depois do push.
   */
  dispatch(cmd: Command): boolean {
    const g = this.getGame();
    const ultimaAntes = g.log.length ? g.log[g.log.length - 1] : null;
    const consumiu = applyCommand(g, cmd);
    const ultimaDepois = g.log.length ? g.log[g.log.length - 1] : null;
    if (consumiu || ultimaDepois !== ultimaAntes) this.emit();
    return consumiu;
  }

  /** Desce a escada (o comando `descend` já passa por `dispatch`; isto é a via direta). */
  descend(): void {
    const g = this.getGame();
    descerNivel(g);
    this.emit();
  }

  /** Realce do tile sob o ponteiro. Só notifica quando o TILE muda. */
  setHover(p: Point | null): void {
    const g = this.getGame();
    const h = g.ui.hover;
    if (p) {
      if (h && h.x === p.x && h.y === p.y) return;
      g.ui.hover = { x: p.x, y: p.y };
    } else {
      if (!h) return;
      g.ui.hover = null;
    }
    this.emit();
  }

  toggleDebug(): void {
    const g = this.getGame();
    g.ui.debug = !g.ui.debug;
    logMsg(g, g.ui.debug ? 'Painel de depuração ligado.'
      : 'Painel de depuração desligado.', 'sistema');
    this.emit();
  }

  toggleFovProbe(): void {
    const g = this.getGame();
    g.ui.fovProbe = !g.ui.fovProbe;
    logMsg(g, g.ui.fovProbe ? 'Sonda de campo de visão ligada.'
      : 'Sonda de campo de visão desligada.', 'sistema');
    this.emit();
  }

  toggleFollow(): void {
    const g = this.getGame();
    g.ui.follow = !g.ui.follow;
    logMsg(g, g.ui.follow ? 'Câmera seguindo o jogador.'
      : 'Câmera livre.', 'sistema');
    this.emit();
  }

  /**
   * Ponto de entrada da aplicação. Idempotente de propósito: o StrictMode do
   * React monta o App duas vezes em desenvolvimento e a segunda montagem não
   * pode descartar a partida em curso.
   */
  restoreOrNew(): void {
    if (!this.game) this.carregar();
    this.emit();
  }
}

export const store = new GameStore();
