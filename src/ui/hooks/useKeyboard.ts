/*
 * ISOROGUE — src/ui/hooks/useKeyboard.ts
 *
 * Mapa de teclas do docs/CONTRACTS.md §10, portado 1:1 de `handleKey` /
 * `acaoDaTecla` em legacy/src-vanilla/70-game.js.
 *
 *   W A S D · setas · numpad 8/4/2/6   mover ou atacar
 *   Q E Z C · numpad 7/9/1/3           diagonais
 *   . , 5 Espaço · Numpad5/Decimal     esperar (consome turno)
 *   H · 1                              usar poção
 *   > · Enter · Return · NumpadEnter   descer a escada
 *   V                                  sonda de campo de visão
 *   Shift+D · F3                       painel de depuração
 *   F                                  câmera segue o jogador
 *   + = · - _ · Numpad +/-             zoom
 *   N                                  nova expedição com a semente do campo
 *
 * Duas notas de fidelidade (não são escolhas novas, são as do vanilla):
 *
 * 1. O §10 dá `D` ao movimento e ao painel de depuração ao mesmo tempo. O
 *    vanilla resolveu mantendo W-A-S-D intacto e pondo o painel em Shift+D,
 *    com `F3` como atalho de tecla única. Mantido igual.
 * 2. `preventDefault` em setas e espaço acontece ANTES de decidir se a tecla
 *    virou comando — é o que impede a página de rolar mesmo quando a tecla não
 *    faz nada. As demais teclas só têm `preventDefault` se viraram ação.
 *
 * Teclas são ignoradas quando o foco (ou o alvo do evento) é campo de texto:
 * `input`, `textarea`, `select`, qualquer `contenteditable`, e o `#seed`.
 */

import { useEffect } from 'react';
import { store } from '../../engine/store';
import { CONFIG, clamp } from '../../engine/core';
import { getRenderer } from '../GameCanvas';

const ZOOM_STEP = 1.12;

type Delta = readonly [number, number];

// Cardinais da GRADE lógica nas teclas primárias: é por elas que se percorrem
// os corredores (traçados nos eixos x/y do mapa).
const MOVE_KEY: Record<string, Delta> = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
};

const MOVE_CODE: Record<string, Delta> = {
  Numpad8: [0, -1],
  Numpad2: [0, 1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad7: [-1, -1],
  Numpad9: [1, -1],
  Numpad1: [-1, 1],
  Numpad3: [1, 1]
};

type Acao =
  | 'wait'
  | 'use'
  | 'descend'
  | 'debug'
  | 'fov'
  | 'follow'
  | 'nova'
  | 'zoomin'
  | 'zoomout';

function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!alvo) return false;
  const el = alvo as Partial<HTMLElement> & { tagName?: string; id?: string };
  if (el.id === 'seed') return true;
  if (el.isContentEditable) return true;
  const tag = el.tagName ? String(el.tagName).toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function elementoFocado(): Element | null {
  if (typeof document === 'undefined' || !document) return null;
  return document.activeElement;
}

/** Semente digitada no campo; se o campo não existir, a da partida em curso. */
function campoSemente(): string {
  if (typeof document !== 'undefined' && document) {
    const campo = document.getElementById('seed');
    if (campo && typeof (campo as HTMLInputElement).value === 'string') {
      return (campo as HTMLInputElement).value;
    }
  }
  return store.getGame().seedStr;
}

function acaoDaTecla(lk: string, ev: KeyboardEvent): Acao | null {
  if (lk === 'd' && ev.shiftKey) return 'debug';
  if (lk === 'f3') return 'debug';
  switch (lk) {
    case '.':
    case ',':
    case ' ':
    case 'spacebar':
    case '5':
      return 'wait';
    case 'h':
    case '1':
      return 'use';
    case '>':
      return 'descend';
    case 'enter':
    case 'return':
      return 'descend';
    case 'v':
      return 'fov';
    case 'f':
      return 'follow';
    case 'n':
      return 'nova';
    case '+':
    case '=':
      return 'zoomin';
    case '-':
    case '_':
      return 'zoomout';
    default:
      return null;
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function zoomBy(fator: number): void {
  const r = getRenderer();
  if (!r) return;
  const cam = r.cam;
  let base = 1;
  if (cam) {
    if (isNum(cam.tzoom)) base = cam.tzoom;
    else if (isNum(cam.zoom)) base = cam.zoom;
  }
  r.setZoom(clamp(base * fator, CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX));
}

function executar(acao: Acao): void {
  switch (acao) {
    case 'wait':
      store.dispatch({ kind: 'wait' });
      break;
    case 'use':
      store.dispatch({ kind: 'use' });
      break;
    case 'descend':
      store.dispatch({ kind: 'descend' });
      break;
    case 'debug':
      store.toggleDebug();
      break;
    case 'fov':
      store.toggleFovProbe();
      break;
    case 'follow':
      store.toggleFollow();
      break;
    case 'nova':
      store.newRun(campoSemente());
      break;
    case 'zoomin':
      zoomBy(ZOOM_STEP);
      break;
    case 'zoomout':
      zoomBy(1 / ZOOM_STEP);
      break;
    default:
      break;
  }
}

export function handleKey(ev: KeyboardEvent): void {
  if (!ev) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ehCampoDeTexto(ev.target) || ehCampoDeTexto(elementoFocado())) return;

  const code = typeof ev.code === 'string' ? ev.code : '';
  const key = typeof ev.key === 'string' ? ev.key : '';
  let mv: Delta | null = null;
  let acao: Acao | null = null;

  if (code.indexOf('Numpad') === 0) {
    if (MOVE_CODE[code]) mv = MOVE_CODE[code];
    else if (code === 'Numpad5' || code === 'NumpadDecimal') acao = 'wait';
    else if (code === 'NumpadAdd') acao = 'zoomin';
    else if (code === 'NumpadSubtract') acao = 'zoomout';
    else if (code === 'NumpadEnter') acao = 'descend';
  } else {
    const lk = key.toLowerCase();
    const mk = key.length === 1 ? lk : key;
    if (MOVE_KEY[mk] && !(mk === 'd' && ev.shiftKey)) mv = MOVE_KEY[mk];
    else acao = acaoDaTecla(lk, ev);
  }

  // Nunca deixar a página rolar com setas/espaço.
  if (key === ' ' || key === 'Spacebar' || key.indexOf('Arrow') === 0) {
    ev.preventDefault();
  }
  if (!mv && !acao) return;
  ev.preventDefault();

  if (mv) {
    store.dispatch({ kind: 'move', dx: mv[0], dy: mv[1] });
    return;
  }
  if (acao) executar(acao);
}

/**
 * Registra o teclado em `window` e limpa no unmount. Dependências vazias: o
 * mapa de teclas não muda e o listener não pode ser recriado por re-render.
 */
export function useKeyboard(): void {
  useEffect(() => {
    const ouvinte = (ev: KeyboardEvent): void => {
      handleKey(ev);
    };
    window.addEventListener('keydown', ouvinte, false);
    return () => {
      window.removeEventListener('keydown', ouvinte, false);
    };
  }, []);
}
