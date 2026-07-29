---
tipo: nota
atualizado: 2026-07-28
tags: [arquitetura, camadas, fronteiras, lint, react]
---

# 🧱 Camadas e fronteiras

Três camadas, dependência de mão única, e um script que reprova o build quando alguém
atravessa a linha.

```
src/engine/**   →  só importa de src/engine/**. Sem react, sem document,
                   sem window, sem Math.random, sem relógio.
src/render/**   →  importa de src/engine/** (tipos e leitura). Fala com
                   Canvas 2D imperativamente. NÃO importa react.
src/ui/**       →  importa de tudo. É a única camada com JSX.
```

## Por que o engine não conhece React

Não é purismo. São três consequências práticas, e cada uma delas já foi usada:

**1. O jogo roda headless.** `test/engine.test.ts` e `test/golden.test.ts` importam
`createState`, `applyCommand` e `snapshot` direto, sem jsdom, sem stub de canvas, sem `node:vm`.
São 200 comandos × 12 sementes × 2 passadas rodando em milissegundos. Se o engine importasse
React, cada teste precisaria montar um ambiente de DOM para calcular um mapa de Dijkstra.

**2. O determinismo sobrevive.** React re-renderiza quando quer, em ordem que ele decide, e
duplica efeitos sob `StrictMode`. Nada disso pode tocar a lógica. Enquanto o engine for uma
função do estado anterior + comando, "mesma semente ⇒ mesmo resultado" continua verdade. Ver
[[determinismo]].

**3. O oracle continua comparável.** O engine novo é medido contra a versão vanilla congelada
em `legacy/`, que não tem React nenhum. Se o miolo tivesse virado hook, não haveria o que
comparar. Ver [[golden-test]].

## O corolário que ninguém pode violar

O estado do jogo (`Game`) é um objeto **mutável**, grande (`Uint8Array`, `Int32Array`,
`Set<number>`) e de vida longa. Ele **nunca** entra em `useState`, nunca é clonado por spread,
nunca é congelado.

React observa esse estado por **assinatura de versão**, não por posse. É o que
`src/engine/store.ts` faz — e é o único arquivo do engine que existe por causa do React,
ainda que não importe React:

```ts
getVersion = (): number => this.version;   // snapshot estável, número
getGame    = (): Game   => { ... };        // referência viva, sem cópia
private emit(): void { this.version++; this.listeners.forEach(l => l()); }
```

`src/engine/store.ts:39-54`. O hook `useGameValue` é
`useSyncExternalStore(store.subscribe, () => select(store.getGame()))`, e daí sai a regra dura:
**o seletor tem de devolver primitivo**. Devolver `{hp, maxHp}` cria objeto novo a cada
chamada, o `useSyncExternalStore` considera que mudou, e a aplicação entra em loop infinito de
render. Para ler várias coisas, use vários `useGameValue` — ou `useGameVersion()` mais leitura
direta de `store.getGame()`.

O canvas não usa hook nenhum: `GameCanvas` lê `store.getGame()` dentro do `requestAnimationFrame`
e desenha. Não há re-render de React por frame.

## Como a fronteira é enforçada

`tools/check-boundaries.mjs` — 85 linhas, sem dependência, roda em `npm run lint` e é o primeiro
passo de `npm run check` (`package.json:15,18`). Ele varre todo `.ts`/`.tsx` de `src/engine/` e
`src/render/` linha a linha e reprova com `process.exit(1)`.

O que é proibido no engine (`tools/check-boundaries.mjs:12-22`):

| Padrão | Motivo |
|---|---|
| `from 'react...` | camada errada |
| `from '../../ui/` ou `../render/` | import de camada superior |
| `import('../ui/...)` | idem, na forma dinâmica |
| `document.` / `window.` | o engine roda headless |
| `Math.random` | mata o determinismo |
| `Date.now` / `new Date(` | relógio na lógica |
| `performance.now` | idem |

Em `src/render/` a lista é menor: nada de `react`, nada de importar `ui/`, nada de
`Math.random` (`tools/check-boundaries.mjs:33-39`). Render pode ler o relógio — `dt` de
animação é legítimo lá.

### Dois detalhes do script que valem mais do que parecem

**A isenção é por caminho, nunca por basename.** Só dois arquivos podem citar `window.`:
`src/engine/save.ts` (que recebe o `Storage` por injeção) e `src/engine/core.ts` (que isola
`crypto` atrás de `newSeedString`). A chave do mapa de isenções é o caminho relativo completo
(`tools/check-boundaries.mjs:26-29`) — se fosse o basename, um futuro
`src/engine/qualquer/core.ts` herdaria a isenção em silêncio, que é exatamente o tipo de furo
que ninguém descobre até virar bug de determinismo.

**Comentário de linha inteira é ignorado** (`tools/check-boundaries.mjs:67`). A regra vale para
código; prosa explicando por que `Math.random` é proibido não pode reprovar o build.

## O que quebra se alguém violar

- **`import react` no engine** → `npm run lint` falha na hora, com arquivo:linha. Nada chega ao
  build.
- **`Math.random` no engine** → mesma reprovação, e se de alguma forma passasse, o T9 pega a
  ocorrência no `src/` (`test/engine.test.ts:712`) e depois no bundle
  (`test/engine.test.ts:769`), onde o único `Math.random` tolerado é o
  `Math.random().toString(36)` do react-dom.
- **`Date.now` na lógica de turno** → dois jogadores com a mesma semente veriam partidas
  diferentes. O [[golden-test]] falharia em algum dos 12 casos, mas provavelmente não no
  primeiro comando — seria uma caçada. Por isso o gate está no lint, antes.
- **`Game` dentro de `useState`** → o lint não pega isso (é `src/ui/`). O que pega é a prática:
  clonar `Uint8Array` de 2.025 posições a cada tecla apertada, e perder a identidade do
  `Set<number>` de visibilidade. Trate como regra de revisão, não como regra automatizada — é a
  lacuna conhecida do gate.

## Ligações

- [[ADR-002-engine-puro-fora-do-react]] — a decisão e as alternativas descartadas.
- [[determinismo]] — o que a fronteira protege.
- [[golden-test]] — o que prova que ela foi respeitada na migração.
- [[rodar-os-testes]] — como disparar `npm run check`.
