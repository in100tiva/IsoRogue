---
tipo: aprendizado
atualizado: 2026-07-28
tags: [personagem, render, isometrico, armadilha, spec]
---

# 🧭 A spec do yaw estava errada

## O sintoma

O guerreiro andava para o lado certo e **olhava 90° fora**. Andando para leste do grid
(tecla `D`, delta `(1,0)`) ele descia para baixo-direita na tela, como manda o gate G3 de
`docs/PERSONAGEM.md`, mas o rosto, o escudo e a espada apontavam para outra direção.
Não é bug de animação nem de ordem de quadros do atlas: as 8 direções estavam todas
giradas do mesmo ângulo.

## A causa

A fórmula veio **da própria spec**, e a spec estava errada. `docs/PERSONAGEM.md:169`
prescreve:

```ts
const yaw = Math.atan2(DIRS8[dir][1], DIRS8[dir][0]);   // atan2(dy, dx)
```

`atan2(dy, dx)` é o ângulo que alinha o eixo **+X** do modelo com o delta do grid. Mas o
sistema de coordenadas do rig, definido duas seções acima na mesma spec, diz que **+X é a
direita do personagem e +Y é a frente**. Ou seja: aquela conta alinha o *ombro direito*
com a direção do movimento, não o rosto. Erro de exatamente −90°, constante, em todas as
direções — o que é justamente o tipo de defeito que passa despercebido numa direção só e
salta aos olhos quando você compara as oito lado a lado.

O giro correto é `atan2(dy, dx) − π/2`, que se simplifica para:

```ts
// src/render/model3d.ts:649
export function giroParaFrente(dx: number, dy: number): number {
  return Math.atan2(-dx, dy);
}
```

Conferência: leste do grid `(1, 0)` → `atan2(-1, 0)` = −π/2 → a frente do modelo passa a
apontar para `(1, 0)`, que na projeção isométrica é baixo-direita. G3 verde.

## A lição

**A spec é entrada, não oráculo.** Quem escreveu o módulo tinha as duas afirmações da
spec na frente — "a frente é +Y" e "yaw = atan2(dy, dx)" — e elas são incompatíveis. Ler
os dois trechos juntos custou menos que uma rodada de revisão visual; aceitar a fórmula
por autoridade teria custado três.

Corolário aplicado no código: a conta existe **num lugar só**. `spriteForge` não
reimplementa a fórmula, importa `giroParaFrente` e só cuida da normalização do índice
0..7 (`src/render/spriteForge.ts:328-334`). O comentário lá diz por quê, com todas as
letras: "ter duas versões da fórmula em dois arquivos é como o gate G3 falha em
silêncio". Uma cópia corrigida e outra esquecida dá um sprite certo e um errado, e aí o
bug some da revisão do atlas e reaparece no jogo.

## O que quebra se mudar

- Trocar o sinal ou a ordem dos argumentos de `giroParaFrente` gira **os 72 quadros** do
  atlas juntos. O gate G3 é o único que pega isso, e só por inspeção visual.
- Reordenar `DIRS8` no engine desalinha o índice `facing` das linhas do atlas sem que
  nada falhe: o atlas continua com 8 linhas, só que a linha errada. A ordem de `DIRS8`
  é fixa por contrato.
- Nada disso toca em regra de jogo — ver [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

Ver também [[personagem-rig-3d]], [[sprite-forge]], [[projecao-isometrica]] e
[[revisar-o-personagem]].
