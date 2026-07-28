/// <reference types="vite/client" />
/*
 * ISOROGUE — ponto de entrada da aplicação.
 *
 * Só três responsabilidades, nesta ordem:
 *   1. carregar as folhas de estilo (o build inlina as duas no arquivo único);
 *   2. retomar o autosave — ou começar uma expedição nova — ANTES do primeiro
 *      render, para que a árvore já nasça com o estado pronto e nenhum
 *      componente precise disparar mutação durante o render;
 *   3. montar <App/> na raiz.
 *
 * `StrictMode` só em desenvolvimento (docs/ARQUITETURA-REACT.md §2): em produção
 * ele não pode duplicar os efeitos do laço de animação.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { store } from './engine/store';
import { App } from './ui/App';

import './styles/global.css';
import './styles/ui.css';

const raiz = document.getElementById('raiz');

if (!raiz) {
  throw new Error('ISOROGUE: elemento #raiz não encontrado no documento.');
}

// Idempotente por contrato (§4 do store): montar duas vezes não descarta a
// partida em curso.
store.restoreOrNew();

createRoot(raiz).render(
  import.meta.env.DEV
    ? (
      <StrictMode>
        <App />
      </StrictMode>
    )
    : <App />
);
