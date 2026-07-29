---
tipo: nota
atualizado: 2026-07-28
tags: [fov, shadowcasting, simetria, engine, render]
---

# 👁️ Campo de visão: shadowcasting simétrico

`src/engine/fov.ts`. Três funções públicas: `computeFov`, `isVisibleFrom` e
`checkSymmetry`. Raio padrão `CONFIG.FOV_RADIUS` = 9 (`src/engine/core.ts:44`).

## Por que raycasting por amostragem foi proibido

A tentação óbvia é traçar N raios da origem e marcar o que cada um atravessa. Isso falha
de duas maneiras que o jogo sente:

- **Buracos e artefatos de amostragem.** Com raios discretos, tiles distantes ficam entre
  dois raios e somem; aumentar N esconde o sintoma e custa caro.
- **Assimetria.** O raio A→B e o raio B→A percorrem sequências de arredondamento
  diferentes. O resultado é um inimigo que atira em você de um lugar de onde você não o
  vê. Como a Sentinela decide atacar exatamente por linha de visão
  (`src/engine/entities.ts:698`, ver [[arquetipos-de-inimigo]]), a assimetria vira uma
  regra de jogo injusta e não um detalhe gráfico.

O contrato então fixa **shadowcasting recursivo por quadrantes** (variante simétrica de
Albert Ford). O comentário de cabeça do arquivo (`src/engine/fov.ts:1-30`) documenta que
nenhuma linha do módulo "anda" da origem até o alvo: não há Bresenham nem DDA em lugar
nenhum.

## Como a varredura funciona

Quatro quadrantes — `NORTH`, `EAST`, `SOUTH`, `WEST` (`src/engine/fov.ts:42-45`) — e um
`scan(depth, sn, sd, en, ed)` recursivo (`src/engine/fov.ts:141`). Cada linha do quadrante
é limitada por dois *slopes* racionais mantidos como pares de inteiros (`num/den`,
`den > 0`): nada de acumular erro de ponto flutuante.

Dentro da linha:

```ts
if (prev === 1 && !wall) { sn = 2 * col - 1; sd = 2 * depth; }   // parede -> piso
if (prev === 0 && wall)  { scan(depth + 1, sn, sd, 2 * col - 1, 2 * depth); }  // piso -> parede
```

(`src/engine/fov.ts:166-174`) — transição parede→piso aperta o slope inicial **na própria
linha**; piso→parede **recursa** para a linha seguinte com o slope final apertado. Linha
que termina em piso continua inteira na linha seguinte (`src/engine/fov.ts:180`).

Os limites de coluna usam arredondamento de empate explícito e assimétrico entre os dois
lados — `roundTiesUp` e `roundTiesDown` (`src/engine/fov.ts:97-104`). É esse par que faz a
simetria fechar; trocar um `floor` genérico ali quebra pares de tiles na diagonal.

O contexto da varredura (`cTiles`, `cOx`, `cCard`, …) mora em escopo de módulo
(`src/engine/fov.ts:49-58`) para que a recursão receba só números e não aloque closure por
chamada. Efeito colateral a respeitar: **`computeFov` não é reentrante**. Não chame FOV de
dentro de um callback de FOV.

## O que "simétrico" significa aqui

Exatamente isto: para quaisquer dois tiles **caminháveis** A e B dentro do raio,
`vê(A→B) ⇔ vê(B→A)`. Paredes ficam de fora da promessa, e de propósito.

O motivo está em `src/engine/fov.ts:164`:

```ts
if (wall || isSymmetricCol(depth, col, sn, sd, en, ed)) reveal(x, y);
```

Piso só é revelado quando o **centro** do tile cai dentro do cone (`isSymmetricCol`,
`src/engine/fov.ts:134`, comparação inteira). Parede é revelada sempre que cai na faixa de
colunas da linha, com centro dentro do cone ou não — porque o renderizador precisa das
paredes que fecham a sala, senão o cômodo aparece com buracos na borda. Essa concessão
torna a visão de paredes assimétrica, e é por isso que `checkSymmetry`
(`src/engine/fov.ts:265`) pula todo índice cujo tile seja `WALL`
(`src/engine/fov.ts:290`).

O corte de raio é **circular e euclidiano**: `reveal` descarta quem tem
`dx² + dy² > (radius + 0.5)²` (`src/engine/fov.ts:124-130`). Distância euclidiana é
simétrica por construção, então o corte não introduz assimetria — ao contrário do que um
corte por Chebyshev com arredondamento faria.

`isVisibleFrom` reusa o mesmo `scan`, mas só varre os quadrantes que cobrem o alvo
(`quadrantCovers`, `src/engine/fov.ts:186`). Mesmo algoritmo, mesmo resultado, um quarto
do trabalho — a Sentinela chama isso todo turno.

## A sonda da tecla V

`V` alterna `game.ui.fovProbe` (`src/ui/hooks/useKeyboard.ts:121-122` e
`src/engine/store.ts:157`). Com ela ligada, o renderizador desenha o FOV calculado **a
partir do tile sob o cursor**, não do jogador: `IsoRenderer` chama `computeFov` no hover,
pinta os tiles em ciano translúcido, contorna a origem da sonda e então roda
`checkSymmetry(map, hx, hy, FOV_R)` (`src/render/IsoRenderer.ts:1434`), pintando em
magenta com um "X" cada tile que falhou o teste de volta
(`src/render/IsoRenderer.ts:1437-1452`). O gate está em `src/render/IsoRenderer.ts:660`.

Ou seja: a sonda não é um debug decorativo — ela roda **o mesmo predicado** que o teste
automatizado T4 (`test/engine.test.ts:316`, 40 sementes × 25 origens caminháveis, exigindo
`broken.length === 0`). Se um dia aparecer magenta na tela, o T4 também está vermelho.

## O que quebra se mudar

- **Trocar `roundTiesUp`/`roundTiesDown` por um arredondamento uniforme** — a simetria cai
  em pares específicos de diagonal; T4 acusa.
- **Revelar piso sem o teste `isSymmetricCol`** — o FOV fica "mais generoso" e visivelmente
  assimétrico.
- **Derivar transparência de algo que não seja `CONFIG.TILE.WALL`** (`blocksAt`,
  `src/engine/fov.ts:91`) — "transparente" e "caminhável" deixariam de ser o mesmo
  conjunto e a definição de simetria perderia sentido, porque `checkSymmetry` filtra por
  caminhável.
- **Reescrever o `scan` "mais elegante"** — o cabeçalho do arquivo pede explicitamente que
  não. Ordem da recursão e regra de arredondamento *são* o algoritmo.

O que o FOV alimenta: `game.visible` (Set de índices) e `game.explored` (Uint8Array,
1 = já visto), atualizados em `atualizarFov` (`src/engine/game.ts:223`). Só o que está em
`visible` desenha inimigos, itens e efeitos; explorado fora do FOV mostra apenas estrutura
estática — ver [[fog-of-war-e-iluminacao]].

Ver também: [[dijkstra-e-comportamento]], [[turnos-e-progressao]],
[[_moc-sistemas-de-jogo]].
