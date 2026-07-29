---
tipo: adr
atualizado: 2026-07-28
tags: [arquitetura, react, estado, fronteiras]
---

# ⚙️ ADR-002 — Engine puro, fora do React

**Status:** aceita · fronteira verificada por script de lint

## Contexto

O estado do jogo (`Game`) não é um objeto de formulário. É grande, mutável e de vida
longa: `Uint8Array` de tiles, `Uint8Array` de explorados, `Int32Array` do mapa de Dijkstra,
`Set<number>` de visíveis, arrays de inimigos e de log (`src/engine/types.ts:143-150`).

O caminho "React normal" seria pôr isso em `useState` e clonar a cada turno. Num mapa de
milhares de células, cada turno viraria uma cópia de vários arrays tipados — e o pior nem é
o custo: é que o engine passaria a **saber** que existe React, o que mataria o golden test
headless ([[ADR-003-golden-test-como-oracle-da-migracao]]) e o determinismo.

## Decisão

**O engine não conhece React, não conhece DOM, não conhece Canvas.**

O `Game` nunca entra em `useState`, nunca é clonado por spread, nunca é congelado. O React
observa o estado por **assinatura de versão**, via `useSyncExternalStore`:

```ts
// src/engine/store.ts:28-54
private version = 0;                       // incrementa a CADA mutação observável
getVersion = (): number => this.version;   // snapshot ESTÁVEL (um número)
getGame   = (): Game   => { ... };         // a referência VIVA, sem cópia
private emit(): void { this.version++; this.listeners.forEach(l => l()); }
```

`src/engine/store.ts` é o único arquivo do engine que existe por causa do React — e ainda
assim não importa React: é um observable puro. Do outro lado, `src/ui/hooks/useGameStore.ts`
expõe `useGameVersion()` e `useGameValue(select)`.

O `GameCanvas` **não usa hook nenhum**: lê `store.getGame()` dentro do `requestAnimationFrame`
(`docs/ARQUITETURA-REACT.md:206-207`).

A fronteira é executável: `tools/check-boundaries.mjs` reprova `import de react`, `document.`,
`window.`, `Math.random`, `Date.now`/`new Date(` e `performance.now` dentro de `src/engine/**`
(`tools/check-boundaries.mjs:8-30`), com isenções por **caminho relativo** — nunca por
basename — para `save.ts` e `core.ts`. Roda em `npm run lint`. Ver [[camadas-e-fronteiras]].

## A armadilha do seletor (a que derruba a aplicação)

`useGameValue(select)` roda `select(store.getGame())` a cada render e a cada notificação, e
o React compara com `Object.is`. Logo o seletor **tem de devolver primitivo ou referência
estável** (`src/ui/hooks/useGameStore.ts:12-30`).

```ts
useGameValue(g => g.player.hp)        // ✅ número
useGameValue(g => g.log)              // ✅ o array vivo, muda quando o dado muda
useGameValue(g => ({ hp: g.player.hp }))  // ❌ objeto NOVO toda chamada
useGameValue(g => g.log.slice(-200))      // ❌ array NOVO toda chamada
```

As duas últimas criam referência diferente a cada leitura, `Object.is` sempre falha e o
React entra em loop infinito ("The result of getSnapshot should be cached"). Para ler várias
coisas: vários `useGameValue`, ou `useGameVersion()` no topo + leitura direta de
`store.getGame()` no corpo do componente.

## Uma sutileza que custa comportamento

`dispatch` **não** emite apenas quando o turno é consumido (`src/engine/store.ts:119-126`).
No vanilla o próprio `logMsg` anexava a linha ao DOM, então a **recusa** de um comando
aparecia no ato — "Você não tem poções.", "Sua vida já está completa.", "Não há escada aqui."
saem de caminhos que devolvem `false`. Emitir só no sucesso deixaria a linha presa em
`game.log` até a próxima ação: divergência observável. A sonda é a **referência** da última
entrada, não `log.length`, porque no teto de `CONFIG.MAX_LOG` o comprimento fica igual depois
do push.

## Consequências

**Boas**

- O engine roda em Node, sem DOM, sem `vm`, sem stub: é o que torna o golden test rápido e
  legível ([[golden-test]]).
- Zero cópia por turno. O custo de renderizar independe do tamanho do mapa.
- A regra é objetiva: se `npm run lint` reclama, a fronteira foi cruzada. Não é discussão de
  revisão de código.

**Ruins**

- A imutabilidade que o React normalmente dá de graça vira responsabilidade humana: quem
  mutar o `Game` sem chamar `emit()` produz UI silenciosamente desatualizada.
- O seletor tem uma regra que a tipagem **não** consegue impor. É comentário no topo do
  arquivo, não erro de compilação.
- `StrictMode` monta duas vezes em dev; o loop de rAF e `restoreOrNew()` precisam ser
  idempotentes de propósito (`src/engine/store.ts:173-181`).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| `useState` + estado imutável | Clonar `Uint8Array`/`Int32Array`/`Set` a cada turno; e obrigaria o engine a devolver estado novo, acoplando domínio a React. |
| Redux / Zustand / Jotai | Dependência nova ([[ADR-001-arquivo-unico-sem-dependencias]]) para resolver um problema que `useSyncExternalStore` já resolve em 20 linhas. |
| Context + re-render da árvore | Cada turno re-renderizaria tudo, inclusive o canvas — que não deve nem participar do ciclo do React. |
| Deixar o engine emitir eventos de DOM | Reintroduz `document` no núcleo e mata o teste headless. |

Relacionadas: [[camadas-e-fronteiras]] · [[determinismo]] · [[visao-geral]]
