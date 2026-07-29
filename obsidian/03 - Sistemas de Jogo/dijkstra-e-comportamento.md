---
tipo: nota
atualizado: 2026-07-29
tags: [dijkstra, ia, pathfinding, determinismo, engine]
---

# 🧭 Dijkstra e comportamento

`src/engine/dijkstra.ts`. Um **único** campo escalar por turno, recalculado a partir do
jogador. `A*` individual é proibido pelo contrato (R34) e a proibição é estrutural, não
estilística.

## Um mapa por turno, não N buscas

`endTurn` chama `computeDmap` **antes** de processar qualquer inimigo
(`src/engine/game.ts:633-634`, implementação em `src/engine/game.ts:208`):

```ts
game.dmap = computeDijkstra(game.map, [{ x: player.x, y: player.y, v: 0 }],
                            { blocked: null, out: game.dbuf });
```

Depois disso, `processEnemies` monta um `TurnContext` compartilhado
(`src/engine/entities.ts:615`) e **todos** os arquétipos leem `ctx.dmap`. Nenhum deles
executa busca própria.

Três razões, nesta ordem de importância:

1. **Custo.** Com 22 inimigos no teto (`src/engine/entities.ts:579`), 22 buscas A* por
   turno num mapa 45×45 é o dobro-triplo de trabalho de uma passada BFS única — e o alvo é
   60 FPS num arquivo sem dependências.
2. **Determinismo.** Um campo escalar único tem *uma* resposta por tile. N buscas
   independentes têm N heurísticas, N filas de prioridade e N critérios de desempate, tudo
   candidato a divergir entre plataformas. Ver [[determinismo]].
3. **Comportamento emergente barato.** Fuga por ferimento, cerco e a órbita do
   Vinculador saem de *transformações do mesmo campo*, sem escrever pathfinding novo.

O buffer é ainda reservado: `computeDmap` mantém um `game.dbuf` próprio
(`src/engine/game.ts:211-212`) porque `computeDijkstra` recicla um `Int32Array` por objeto
`map` via `WeakMap` (`src/engine/dijkstra.ts:69`) — sem o buffer dedicado, uma segunda
chamada no meio do turno sobrescreveria `game.dmap` por baixo.

`DIJKSTRA_INF` = 99999 (`src/engine/dijkstra.ts:24`) marca inalcançável. Com 100% de
conectividade garantida ([[geracao-de-masmorra-bsp]]), nenhum tile caminhável deveria
carregar INF — e o teste T8 (`test/engine.test.ts:528`) cobra isso.

## Sem corte de canto

Custo uniforme 1 em 8 direções, mas a diagonal `(dx, dy)` só existe se `(dx, 0)` e
`(0, dy)` também forem caminháveis (`src/engine/dijkstra.ts:221-224`). A mesma regra
aparece em quatro lugares e precisa continuar igual nos quatro:

| Onde | Linha |
|---|---|
| propagação do campo | `src/engine/dijkstra.ts:221` |
| re-scan iterativo | `src/engine/dijkstra.ts:309` |
| escolha do passo | `src/engine/dijkstra.ts:425` |
| movimento do jogador | `src/engine/game.ts:437-440` |

Consequência que confunde na primeira leitura: dois tiles diagonalmente vizinhos separados
por um "pinçamento" de paredes **não são vizinhos do grafo** e podem diferir de mais de 1
no campo. O comentário em `src/engine/dijkstra.ts:9-17` registra isso porque a invariante
ingênua ("vizinhos diferem no máximo 1") parece violada e não está.

Uma exceção deliberada no lado do jogador: em `mover`, o ataque é resolvido **antes** do
teste de canto (`src/engine/game.ts:426-434`). O alcance corpo a corpo do jogador é
Chebyshev 1, igual ao dos inimigos; se o corte de canto viesse antes, numa quina de
corredor o inimigo golpearia e o jogador levaria um no-op mudo.

## Empate por ordem de DIRS8

`bestStep` (`src/engine/dijkstra.ts:392`) varre os 8 vizinhos na ordem fixa de `DIRS8`
(`src/engine/core.ts:97-106`: leste, sudeste, sul, sudoeste, oeste, noroeste, norte,
nordeste) e a comparação é **estrita**:

```ts
if (!(nv < bestV)) { continue; } // estrito: primeiro da ordem DIRS8 vence
```

(`src/engine/dijkstra.ts:423`). Um empate nunca substitui o candidato anterior, então o
primeiro da ordem ganha. Retorna `null` quando nenhum vizinho é estritamente melhor que o
tile atual — o inimigo em mínimo local fica parado em vez de tremer.

`DIRS8` é a peça mais frágil do determinismo do jogo. Reordená-la não quebra teste de
tipo, não quebra lint e não muda nenhuma regra escrita — apenas faz cada partida gravada
divergir a partir do primeiro empate. Por isso o aviso está em caixa alta no próprio
`src/engine/core.ts:91-96`.

Do lado das entidades há um segundo nível: `gradientStep` (`src/engine/entities.ts:267`)
tenta o `bestStep`, valida o resultado com `validStep` e, se o preferido não servir (tile
já reservado por outro inimigo, por exemplo), cai em `scanBest`
(`src/engine/entities.ts:208`) — que é a mesma varredura, mesma ordem `DIRS8`, escolhendo
o segundo melhor. O empate continua determinístico no plano B.

## O gradiente invertido da fuga

`fleeMap` (`src/engine/dijkstra.ts:355`) faz duas coisas:

1. Multiplica todo valor **finito** por `FLEE_FACTOR` = −1,2 (`src/engine/dijkstra.ts:25`),
   com `Math.round` porque o campo é inteiro. Como |factor| > 1, o arredondamento preserva
   a monotonicidade.
2. Re-escaneia o campo até estabilizar (`scanField`, `src/engine/dijkstra.ts:250` — o
   re-scan clássico do Brogue: passadas ida-e-volta sobre o campo inteiro relaxando
   `dist[vizinho] = dist[célula] + 1`, com teto de `MAX_SCAN_PASSES` = 256).

O resultado é um campo cujos **mínimos locais ficam longe do jogador**. Fugir é descer por
ele, exatamente com o mesmo `bestStep` — a IA de fuga não tem código de navegação próprio.
O passo 2 é o que evita que o fugitivo entre num beco sem saída: sem re-scan, o −1,2 puro
faria o canto de uma sala parecer ótimo.

O custo é real, então o gradiente é **preguiçoso**: `computeDmap` invalida
`game.fleeMap = null` a cada turno (`src/engine/game.ts:220`) e só é calculado quando algum
inimigo ferido precisa dele, uma vez por turno, compartilhado por todos (`fleeMapOf`,
`src/engine/entities.ts:294`).

## O que quebra se mudar

- **Reordenar `DIRS8`** — todas as partidas gravadas divergem. [[golden-test]] pega.
- **Trocar a comparação estrita de `bestStep` por `<=`** — o *último* da ordem passa a
  vencer os empates; mesma consequência.
- **Dar A* a um arquétipo** — além de violar R34, quebra a premissa de que o tooltip mostra
  o valor de Dijkstra do tile da criatura como explicação do que ela vai fazer.
- **Mexer em `FLEE_FACTOR`** — muda quando e para onde os feridos correm; o
  [[golden-test]] detecta na hora (foi assim que a mutação de `WOUNDED_RATIO` foi pega,
  ver [[golden-test-precisa-ser-testado]]).

Ver também: [[arquetipos-de-inimigo]], [[turnos-e-progressao]], [[_moc-sistemas-de-jogo]].
