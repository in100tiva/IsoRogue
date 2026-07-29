---
tipo: nota
atualizado: 2026-07-28
tags: [render, personagem, 3d, pixel-art, guerreiro]
---

# 🗡️ O rig 3D do personagem

`src/render/model3d.ts` é matemática genérica: recebe uma árvore de nós, uma pose, um giro
e uma paleta, e pinta num contexto 2D em **coordenadas de arte** (baixa resolução). Ele não
conhece o guerreiro, não conhece o jogo e não cria canvas. Quem sabe a forma do Guerreiro é
`src/render/characters/warrior.ts`; quem transforma isso em sprite é [[sprite-forge]].

A escolha de reconstruir o personagem por código (e não voxelizar, extrudar ou importar
malha) está registrada em [[ADR-004-personagem-por-codigo]].

## A árvore de nós

```
raiz
├─ quadril · torso · cabeca
├─ pernaDir · pernaEsq
├─ bracoEsq ── escudo
└─ bracoDir ── espada
```

`src/render/characters/warrior.ts:713`. Cada `No` tem `nome`, `pivo` (posição no espaço do
**pai**) e uma lista de `Caixa` — caixa orientada com centro, dimensões em `u` e um nome de
cor. Espaço destro: `+X` direita, `+Y` frente (para onde ele olha), `+Z` cima, origem no
centro dos pés, no chão.

Duas consequências que já custaram rodada de revisão:

- **A bota afunda de propósito.** Com os `cz` do blockout a sola fecha em `z = −1.2`
  (`src/render/characters/warrior.ts:656`): o boneco assenta *dentro* do losango em vez de
  ficar equilibrado sobre ele. Por isso a âncora do sprite é o plano `z = 0`, jamais a borda
  de baixo do quadro.
- **Nome de nó errado é silencioso.** A `Pose` é indexada por string; um nó que não existe
  simplesmente não gira (`src/render/model3d.ts:598`). É por isso que os nomes vivem em
  `NOS_GUERREIRO` e são repetidos, de propósito, em `NOS_HUMANOIDE` no forge.

`achatarRig` percorre a árvore acumulando matrizes 3×4 (`src/render/model3d.ts:592`). A
rotação de nó é `T(pivô) · Rx · Ry · Rz` — ordem **Z → Y → X** aplicada no pivô
(`:525`). A **ordem de declaração** das caixas é o desempate determinístico da ordem do
pintor: reordená-las muda pixels.

## Faces, culling e sombreamento

Cada caixa gera 6 faces. A normal é rotacionada pela matriz do nó e a face sobrevive se o
produto escalar com a direção de visão `(1, 1, 1)` for positivo
(`src/render/model3d.ts:82` e `:913`) — o observador está no "alto do nordeste".

O fator de luz é **interpolado**, nunca escolhido pelo eixo mais próximo
(`src/render/model3d.ts:468`): o peso de cada eixo é o cosseno clampado em zero e o fator é
a média ponderada de `FATOR_TOPO 1.00`, `FATOR_FRENTE 0.82` e `FATOR_LADO 0.68` — os mesmos
fatores das paredes do mundo. Escolher o eixo mais próximo cria degrau visível ao girar.

Depois vem a parte que dá a cara de pixel art: `quantizar` (`src/render/model3d.ts:484`)
não devolve a cor multiplicada — devolve o **degrau mais próximo da rampa do material**,
comparado por luminância. Dois números calibrados moram aí:

- `GANHO_SOMBRA = 1.15` expande o contraste antes da quantização; sem ele topo/frente/lado
  caem no mesmo degrau e o modelo fica chapado;
- `REALCE_TOPO = 1.25` empurra o alvo um degrau para cima; sem ele o tom declarado é o
  **teto** da peça e o degrau mais claro da rampa nunca aparece.

Com os dois, uma caixa declarada `ouroBase` produz `ouroLuz` no topo, `ouroBase` na frente e
`ouroMeio` no lado — os quatro níveis de tom da referência ficam todos em jogo. A tabela
medida está no comentário de `REALCE_TOPO`.

## Ordem do pintor e contorno

Sem z-buffer aqui também: as faces são ordenadas por `profundidade = média de (wx+wy+wz)`
dos quatro vértices, com empate por peça e depois por índice de face
(`src/render/model3d.ts:954`). O terceiro critério existe para que dois quadros idênticos
nunca saiam com pixels diferentes.

O contorno de silhueta usa a tabela `FACE_VIZINHA` (`:682`): uma aresta é de silhueta
quando a face do outro lado foi descartada pelo culling — O(faces), sem varredura de
imagem. Ele é traçado com `tracarContornoNitido` (`:1001`), que **não** chama `stroke()`:
em px de arte um traço de 1px cai em coordenada fracionária e o Canvas antialiasa, e a
mistura resultante vai para o degrau errado no snap do forge. A cura é Bresenham acumulando
`rect(x, y, 1, 1)` num único `fill()`. A costura entre faces vizinhas é selada com um
`stroke` de 0.5px **da mesma cor** (`:1073`) — isso não muda a silhueta, só tapa o fio de
fundo entre dois polígonos que dividem uma aresta.

## A armadilha do yaw

A spec original mandava `yaw = atan2(dy, dx)`. Isso alinha o eixo **+X** do modelo — o ombro
— com a direção do grid. A frente do personagem é **+Y**: o guerreiro saía olhando 90° para
o lado errado. A fórmula correta está em `src/render/model3d.ts:648`:

```ts
export function giroParaFrente(dx: number, dy: number): number {
  return Math.atan2(-dx, dy);
}
```

Ela existe em **um** lugar só, de propósito: o forge chama `giroDaDirecao`
(`src/render/spriteForge.ts:332`), que delega. Duas cópias da fórmula em dois arquivos é
exatamente como o gate G3 falha em silêncio. História completa em
[[armadilha-do-yaw-isometrico]].

## Chiralidade: o rig é espelhado em X

A projeção de arte inverte o sentido — `+X → (1, +0.5)`, `+Y → (−1, +0.5)`, e o produto
vetorial 2D com Y para baixo dá `+1`. A imagem é a imagem **espelhada** do modelo. Com a
espada no braço anatomicamente direito (`+X`), nas vistas de frente a lâmina caía na direita
da tela; na referência ela está na esquerda. Por isso `bracoDir` mora em `−X`
(`src/render/characters/warrior.ts:634`) e a animação genérica do forge multiplica todo
canal `ry`/`rz` por `ESPELHO = −1` (`src/render/spriteForge.ts:113`). O giro de facing não é
afetado: o espelho é em X e a frente é +Y.

**O que quebra se mudar:** trocar `ART_POR_U` sem trocar `PIXEL` na razão inversa muda o
tamanho do sprite na tela (o invariante é o produto, `2.5` px de tela por `u`); acrescentar
cor à paleta sem passar pelo gate G5 reintroduz gradiente; usar `rz` para abrir um membro
não move nada — membros se estendem em `−Z` local, então abdução é `ry`. E desde as
cinemáticas do guerreiro: **renomear um nó desativa `POSE_AJOELHADA`/`POSE_CAIDA` em
silêncio** — elas são repousos de forja indexados por nome (`NOS_GUERREIRO`), e o forge
não reclama de nome que não existe; idem para a poda do filho `espada` em
`criarModeloGuerreiroSemEspada()`.

Ver também: [[sprite-forge]], [[paleta-e-estilo]], [[projecao-isometrica]],
[[revisar-o-personagem]], [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].
