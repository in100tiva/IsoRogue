---
tipo: nota
atualizado: 2026-07-28
tags: [render, isometrico, camera, projecao]
---

# 🧭 Projeção isométrica

Todo o desenho do mundo sai de quatro linhas de aritmética em `src/render/IsoRenderer.ts`.
Não há biblioteca de matriz, não há WebGL: é Canvas 2D com uma projeção fechada e uma
inversa exata dela.

## As fórmulas

```
isoX = (x - y) * TW/2        screenX = (isoX - cam.x) * zoom + vw/2
isoY = (x + y) * TH/2        screenY = (isoY - cam.y) * zoom + vh/2
```

`TW = 64`, `TH = 32`, `WALL_H = 36` (`src/engine/core.ts:41`). A razão `TW/TH = 2` é o
que dá o losango 2:1 — e é a mesma razão que o rig do personagem reproduz em
[[personagem-rig-3d]], senão o boneco pareceria colado num plano diferente do chão.

`tileToScreen` (`src/render/IsoRenderer.ts:442`) devolve o **canto norte** do losango,
não o centro. Quem quer o centro soma `HH0` — é o que `isoCenter`
(`src/render/IsoRenderer.ts:694`) faz para a câmera e para o assentamento das entidades.

## `screenToTile` é a inversa, não uma aproximação

```ts
const fx = isoX / this.TW + isoY / this.TH;
const fy = isoY / this.TH - isoX / this.TW;
return { x: Math.floor(fx), y: Math.floor(fy) };
```

`src/render/IsoRenderer.ts:452`. Substituindo `isoX = (x−y)·32` e `isoY = (x+y)·16`:
`fx = (x−y)/2 + (x+y)/2 = x` e `fy = (x+y)/2 − (x−y)/2 = y`. Ida e volta fecham em
igualdade algébrica, sem termo de correção.

Isso importa porque três consumidores dependem dela: o realce âmbar do tile sob o mouse,
a sonda de FOV e o clique que move/ataca o tile adjacente
(`src/ui/hooks/usePointer.ts:102` e `:159`). Se a inversa divergir da projeção por meio
tile, os três erram juntos e o sintoma parece bug de jogo, não de geometria. A armadilha
real de quem testa isso à mão está em [[mouse-no-vertice-do-losango]].

## Ordem do pintor por antidiagonal

Não existe z-buffer. A oclusão vem da ordem de desenho: um laço sobre `s = x + y`,
de `0` até `(w−1)+(h−1)`, e dentro de cada antidiagonal **três passes separados**
(`src/render/IsoRenderer.ts:562`):

1. pisos da diagonal (mais escada e porta);
2. paredes da diagonal — são elas que ocultam quem está atrás;
3. entidades daquele tile (item, inimigo, jogador).

Trocar a ordem dos passes, ou fundir os três num só, é o jeito mais rápido de fazer um
inimigo aparecer por cima da parede que deveria escondê-lo. Dentro da diagonal,
`sx = hw·(2x − s) + ox` é a mesma coisa que `(x−y)·hw`, escrita assim para não recalcular
`y`.

O recorte é feito por diagonal: descarte vertical em `src/render/IsoRenderer.ts:564` e
recorte horizontal resolvendo `sx` para `x` em `:571`, com `padX` de folga. É o que
mantém o custo proporcional ao que está na tela, e não aos 45×45 tiles do mapa.

### O buraco conhecido

O sprite do jogador é colado no passo do tile dele, mas o quadro tem 118×97 px com âncora
em `x = 59` — bem mais largo que os 64 px do losango. Ele portanto **cobre** parte dos
tiles vizinhos na mesma antidiagonal, inclusive paredes que já foram desenhadas.
Sem z-buffer não há como recortar isso; é pendência declarada, não descuido. Ver
[[sprite-forge]].

## Câmera e zoom

Puramente visual, e escrita só em `update()` (`src/render/IsoRenderer.ts:472`), nunca em
`draw()`:

- alvo = centro do losango do jogador, a menos que `game.ui.follow === false`;
- suavização exponencial independente de FPS: `k = 1 − 0.001^dt` para posição
  (`:496`) e `1 − 0.0008^dt` para zoom (`:502`), com snap em `0.02` px e `0.0015`;
- roda do mouse multiplica o zoom-alvo por `0.88` ou `1/0.88` (`:384`), sempre preso a
  `ZOOM_MIN = 0.45` / `ZOOM_MAX = 2.4`;
- `resize()` respeita `devicePixelRatio` (limitado a 3) e mede o container, não a janela
  (`:390`).

O listener de `wheel` é do renderer (`handlesWheel = true`); o de `resize` não é — quem
observa o container é o `ResizeObserver` da casca React, mais uma media query de
`dppx` para pegar troca de monitor sem mudança de tamanho (`src/ui/GameCanvas.tsx:88`
e `:117`).

**O que quebra se mudar:** qualquer alteração em `TW`/`TH` obriga a mexer junto na escala
do personagem (o invariante `ART_POR_U × PIXEL = 2.5` de [[personagem-rig-3d]]) e na
altura de parede; `update()` escrevendo posição, hp ou turno viola R54 e contamina o
oracle do [[golden-test]].

Ver também: [[fog-of-war-e-iluminacao]], [[paleta-e-estilo]], [[camadas-e-fronteiras]],
[[_moc-render-e-arte]].
