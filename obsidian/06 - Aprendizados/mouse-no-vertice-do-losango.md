---
tipo: aprendizado
atualizado: 2026-07-28
tags: [ui, ponteiro, isometrico, armadilha, headless]
---

# 🎯 Não mire no vértice do losango

## O sintoma

Ao dirigir o jogo por evento de mouse sintético — inspeção headless, script de
verificação — o tile realçado sai **vizinho** do que se mirou. Um a mais em X, ou um a
menos em Y. Parece bug de conversão tela→grid: a suspeita imediata recai sobre
`screenToTile`, sobre o zoom, ou sobre o `getBoundingClientRect` do canvas.

Nenhum dos três. A conversão está certa; a mira é que estava na fronteira.

## A causa

`MouseEvent.clientX` chega **truncado para inteiro**. A projeção isométrica converte com:

```ts
// src/render/IsoRenderer.ts:452-459
const fx = isoX / this.TW + isoY / this.TH;
const fy = isoY / this.TH - isoX / this.TW;
return { x: Math.floor(fx), y: Math.floor(fy) };
```

Com `TW = 64` e `TH = 32`, cada tile é um losango cujos **quatro vértices** são pontos
onde `fx` e/ou `fy` valem exatamente um inteiro. Nesses pontos quatro tiles se encontram,
e quem decide é o `Math.floor` — que responde certo, mas sobre um valor que o
arredondamento do evento acabou de empurrar para o lado errado da fronteira. Um subpixel
de erro no `clientX` vira um tile inteiro de erro na saída.

O caminho completo do ponteiro só piora a aritmética: `clientX` menos o `left` do
`getBoundingClientRect` (`src/ui/hooks/usePointer.ts:84-95`), dividido pelo zoom da
câmera, somado à posição da câmera — que é um `lerp` contínuo e quase nunca está num
valor redondo (`src/render/IsoRenderer.ts:452-455`). Cada etapa acrescenta fração; a
fronteira não perdoa nenhuma.

## A lição

**Mire sempre no centro da célula.** A geometria de um alvo de clique não é o retângulo
que o envolve nem o ponto que ficou bonito no cálculo: é a região onde uma imprecisão de
um pixel ainda cai dentro. Num grid isométrico essa região é o miolo do losango, e o
ponto mais tolerante que existe é o centro dele — obtido pela inversa exata,
`tileToScreen(game, x, y)` (`src/render/IsoRenderer.ts:442-450`), que é a função de par
com `screenToTile` e devolve o centro do losango do tile.

Regra geral: quando um teste ou uma automação reclama de uma conversão de coordenadas,
verifique primeiro se ela foi exercitada **na fronteira**. Fronteira é onde o
arredondamento manda, e arredondamento errado se parece muito com fórmula errada.

## Nota de contexto

Esse realce nunca toca em estado lógico: `reprojectPointer` só mexe em `ui.hover`, e
`store.setHover` só emite quando o **tile** muda (`src/ui/hooks/usePointer.ts:102-116`).
Um erro de mira desses causa realce e balão no lugar errado — não altera partida, não
altera o oracle. Já um clique errado, sim: `onMouseDown` despacha `move` para qualquer
tile adjacente (`src/ui/hooks/usePointer.ts:159-172`), então errar o alvo por um tile
gasta um turno na direção errada.

## O que quebra se mudar

- Trocar `Math.floor` por `Math.round` em `screenToTile` desloca o grid inteiro em meio
  tile: a inversa deixa de ser exata e o round-trip de um canto não volta ao mesmo tile.
- Arredondar `sx`/`sy` antes da conversão não ajuda — o erro já veio de fora, no
  `clientX`.

Ver [[projecao-isometrica]], [[inspecao-visual-headless]] e
[[virtual-time-congela-animacao]].
