---
tipo: nota
atualizado: 2026-07-28
tags: [arquitetura, build, vite, entregavel, singlefile]
---

# 📦 Build e entregável

O entregável é `dist/index.html`: **296.019 bytes** de HTML auto-contido, com todo o JavaScript
e todo o CSS inlinados. Abre por `file://`, sem servidor, sem rede, sem pasta de assets ao lado.

## A cadeia, do fonte ao arquivo

```
index.html (entrada do Vite)   →  <script type="module" src="/src/main.tsx">
  src/main.tsx                 →  importa store, App, e as duas folhas de estilo
    src/ui/**                  →  React 19 + JSX
    src/render/**              →  Canvas 2D imperativo
    src/engine/**              →  lógica pura
  react + react-dom            →  as duas únicas dependências de runtime
        ↓  npm run build  (vite build)
dist/index.html                →  um arquivo, 296 KB
```

Saída real do build:

```
vite v8.1.5 building client environment for production...
✓ 47 modules transformed.
[plugin vite:singlefile] Inlining: index-CmBOrJjb.js
[plugin vite:singlefile] Inlining: style-B5WmwUMB.css
dist/index.html  296.01 kB
✓ built in 190ms
```

Os 47 módulos são os **32 arquivos `.ts`/`.tsx` de `src/`** somados ao React e ao react-dom.
Nenhum outro pacote entra: `package.json:26-28` tem exatamente `react` e `react-dom` em
`dependencies`; tudo mais (Vite, Vitest, TypeScript, jsdom, Testing Library) é
`devDependency` e não sobrevive ao build.

## A configuração que garante o arquivo único

`vite.config.ts` é curto de propósito:

```ts
plugins: [react(), viteSingleFile()],
build: {
  target: 'es2022',
  cssCodeSplit: false,
  assetsInlineLimit: 100_000_000,   // qualquer asset vira data: URI
  chunkSizeWarningLimit: 4096,
  reportCompressedSize: false
}
```

`vite.config.ts:11-18`. `viteSingleFile` faz o trabalho de inlinar; `cssCodeSplit: false`
impede o CSS de sair como arquivo separado; o `assetsInlineLimit` absurdo garante que nada
vire referência externa.

Um detalhe que já custou tempo: o `defineConfig` vem de **`vitest/config`**, não de `'vite'`
(`vite.config.ts:4`). Importar de `'vite'` deixava `npm run typecheck` vermelho com TS2769 e
derrubava o gate `npm run check`. O bundle gerado é idêntico nos dois casos.

## Como se verifica que não há rede

Três camadas, todas em `test/engine.test.ts` sob o rótulo T9:

**1. O nosso código** (`test/engine.test.ts:712`). Varre todo `.ts`/`.tsx` de `src/` atrás de
`Math.random`, `require(`, `eval(`, `new Function`, `http://`, `https://`, `XMLHttpRequest`,
`WebSocket`, `fetch(`. Comentário de linha inteira é ignorado. Falha apontando arquivo, linha e
coluna — é o teste que pega regressão de verdade, porque diz onde alguém escreveu a coisa errada.

**2. O entregável** (`test/engine.test.ts:739`). Busca por **referência**, não por substring:
`<script src>`, `<link href>`, `<img src>`, `@import`, `url(http…)`, `importScripts(`,
`new Worker('http…')`. Nada disso pode existir. Confere também o `<!doctype html>` e que o
arquivo não está vazio.

**3. O censo dos resíduos** (`test/engine.test.ts:769`). Esta é a parte esperta. O bundle do
React *contém* as strings `http://www.w3.org/2000/svg` (namespaces XML) e
`https://react.dev/errors/` (link de mensagem de erro). Nenhuma delas gera requisição — mas um
grep ingênuo por `http://` acusaria e o teste viraria ruído até alguém desligá-lo. Em vez
disso, cada token proibido tem uma lista de padrões **conhecidos e permitidos**:

```ts
'Math.random':    [/Math\.random\(\)\.toString\(36\)/],   // chave de fiber do react-dom
'http://':        [/http:\/\/www\.w3\.org\//],
'https://':       [/https:\/\/react\.dev\/errors\//],
'fetch(':         [/fetch\([a-zA-Z_$][\w$]*\.href/],      // polyfill de modulepreload do Vite
'eval(':          [],                                     // nunca, em contexto nenhum
'new Function':   [],
```

Qualquer ocorrência que não case reprova, mostrando o trecho. Um `Math.random` escrito por nós
não passaria disfarçado de React.

**O build roda sempre dentro do T9**, nunca "só se o arquivo não existir"
(`test/engine.test.ts:646-664`). Com um `dist/` velho no disco — o caso normal de quem buildou,
depois mexeu em `src/` — a varredura passaria verde sobre um artefato que não corresponde ao
código. E roda com `NODE_ENV=production` explícito: o Vitest roda em `NODE_ENV=test`, e nesse
modo o bundle sai com o React de **desenvolvimento**, que tem avisos, `Date.now()` e
`Math.random()` do profiler. O que o R56 promete é o entregável de produção; é ele que precisa
ser varrido.

## StrictMode só em desenvolvimento

`src/main.tsx:35-42` monta `<App/>` dentro de `<StrictMode>` apenas quando `import.meta.env.DEV`.
O motivo é o laço de `requestAnimationFrame` do canvas: em produção o StrictMode não pode
duplicar o efeito. Em desenvolvimento ele **deve** duplicar — é assim que se descobre um cleanup
mal escrito, cujo sintoma é FPS dobrado e animação com o dobro da velocidade. Há teste para
isso (`test/ui.test.tsx:384`, `test/ui.test.tsx:411`).

Ainda em `main.tsx`: `store.restoreOrNew()` é chamado **antes** do primeiro render, para que a
árvore nasça com o estado pronto e nenhum componente precise mutar durante o render.

## O segundo build: a bancada do personagem

`vite.preview.config.ts` produz `.preview/preview.html`, um HTML auto-contido que existe só
para ser fotografado por `tools/preview-personagem.mjs`. **Não tem relação com o entregável** —
`vite.config.ts` continua sendo a única configuração que gera `dist/index.html`.

Por que reusar o Vite em vez de bundlar por fora: **o projeto está no Vite 8, que roda sobre
Rolldown e não expõe esbuild** (`vite.preview.config.ts:8-11`). Não há como transpilar o
`preview-entry.ts` na mão sem inventar uma dependência nova — e dependência nova é proibida. O
Vite já está aqui, já resolve TypeScript e já sabe inlinar tudo.

Diferenças em relação ao build do jogo: sem o plugin do React (a bancada é DOM + Canvas puro,
sem JSX), `minify: false` (ferramenta de diagnóstico: bundle legível vale mais que bundle
pequeno) e `base: './'`, porque o HTML é aberto por `file://` e nada pode virar caminho
absoluto. Ver [[revisar-o-personagem]].

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento do Vite |
| `npm run build` | gera `dist/index.html` |
| `npm run test` | `vitest run` — engine, golden e UI |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `node tools/check-boundaries.mjs` |
| `npm run check` | lint → typecheck → test, nessa ordem |
| `npm run golden` | regera o oracle a partir do `legacy/` |
| `npm run preview:personagem` | builda e fotografa a bancada do guerreiro |

`package.json:9-19`. Detalhes de uso em [[rodar-e-buildar]] e [[rodar-os-testes]].

## Ligações

- [[ADR-001-arquivo-unico-sem-dependencias]] — a restrição de origem.
- [[camadas-e-fronteiras]] — o que o `npm run lint` cobra.
- [[golden-test]] — o outro gate antes de qualquer entrega.
- [[revisar-o-personagem]] — o build da bancada.
