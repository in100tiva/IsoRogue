---
tipo: runbook
atualizado: 2026-07-28
tags: [build, vite, entregavel, dev]
---

# ▶️ Rodar e buildar

Do zero ao entregável. Tudo mora em `package.json` — não há Makefile, nem script
de shell, nem passo manual escondido.

## Pré-requisitos

Node ≥ 18 e as dependências instaladas. São 2 de runtime (`react`, `react-dom`) e
10 de desenvolvimento; nenhuma delas entra no jogo — ver [[ADR-001-arquivo-unico-sem-dependencias]].

```bash
cd /home/tech-lead/Documentos/DEV/isorogue
npm ci
```

## Desenvolver

```bash
npm run dev
```

Saída esperada, em ~150 ms:

```
  VITE v8.1.5  ready in 157 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Abra o `Local`. Não conte com HMR para preservar a partida em curso: o `Game` é um
objeto mutável, grande e de vida longa, que vive fora do React de propósito
([[camadas-e-fronteiras]]) — depois de mexer no engine, recarregue e gere de novo com a
mesma semente, que a masmorra volta idêntica.

A entrada do Vite é `index.html` na raiz, que só monta `<div id="raiz">` e chama
`src/main.tsx`. **Esse `index.html` não é o entregável** — o entregável é gerado.

## Buildar

```bash
npm run build
```

Saída esperada:

```
vite v8.1.5 building client environment for production...
✓ 47 modules transformed.
[plugin vite:singlefile] Inlining: index-CmBOrJjb.js
[plugin vite:singlefile] Inlining: style-B5WmwUMB.css
dist/index.html  296.01 kB

✓ built in 208ms
```

O entregável é **`dist/index.html`**, um único arquivo de ~296 KB com o JS e o CSS
inlinados por `vite-plugin-singlefile`. O hash no nome do chunk (`index-CmBOrJjb.js`)
muda a cada alteração de código e não significa nada — aquele arquivo é consumido e
descartado dentro do próprio build.

## Abrir o entregável

```bash
google-chrome-stable "file://$PWD/dist/index.html"
# ou, sem sair do terminal:
xdg-open dist/index.html
```

`file://` funciona porque o arquivo não faz **nenhuma** requisição de rede. Isso não é
promessa, é teste: `T9` em `test/engine.test.ts:739` varre `dist/index.html` atrás de
`http://`, `https://`, `src=`/`href=` externos e `import` de rede, e reprova o build
se achar qualquer um. Detalhe em [[build-e-entregavel]].

Se preferir servir por HTTP (para testar service worker, headers, o que for):

```bash
npm run preview
```

## Quando falha

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `dist/index.html` sai com `<script src="...">` | `viteSingleFile()` saiu da lista de plugins | reponha em `vite.config.ts`; `T9` já teria reprovado |
| Aviso de chunk grande | `chunkSizeWarningLimit` (4096) foi baixado | é ruído, não erro — o arquivo é single-file por projeto |
| `npm run build` reclama de tipo | não deveria: o build não typechecka | rode `npm run typecheck` — ver [[rodar-os-testes]] |
| Página em branco ao abrir por `file://` | algum asset virou URL relativa | confira `assetsInlineLimit` (está em 100 MB de propósito) |

## O que quebra se mudar

- Tirar `assetsInlineLimit: 100_000_000` faz o Vite emitir assets como arquivos
  separados e mata o R01/R02 (arquivo único, zero recurso externo).
- Trocar `target: 'es2022'` por algo mais novo é permitido; por algo mais velho
  não — o código usa sintaxe de 2022 sem transpile de fallback.
- Adicionar **qualquer** dependência de runtime derruba a premissa inteira do
  projeto. Leia [[ADR-001-arquivo-unico-sem-dependencias]] antes.

---

Vizinhos: [[rodar-os-testes]] · [[inspecao-visual-headless]] · [[_moc-arquitetura]]
