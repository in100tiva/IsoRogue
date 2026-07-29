---
tipo: aprendizado
atualizado: 2026-07-28
tags: [render, pixel-art, sprite-forge, personagem]
---

# 🧱 Pixel art nasce da rasterização

## O sintoma

O rig 3D era o mesmo, a paleta era a mesma, e mesmo assim o guerreiro saía com aspecto de
**3D liso** — ombreiras e escudo com degradê contínuo, borda macia, nada de bloco. Medido
no atlas da rodada 1: **86,6% dos pixels do sprite estavam fora da paleta**, 1426 tons
quentes distintos onde a especificação de cor permite 10
(`src/render/spriteForge.ts:415-425`).

## A causa

Duas causas em série, e a ordem entre elas é o estilo visual.

**1. Resolução.** O modelo é desenhado num buffer de *arte* de baixa resolução e só depois
ampliado para a tela com `imageSmoothingEnabled = false`
(`src/render/spriteForge.ts:993-998`). Rasterizar direto no tamanho final produz um render
3D pequeno, não pixel art. Não existe passe de "pixelizar depois": o que decide a arte é
onde ela é decidida.

**2. Antialias.** Quem põe pixel no buffer é `ctx.fill()` de polígono, e o Canvas 2D
antialiasa toda borda. Em px de arte — onde uma peça inteira tem 3 ou 4 pixels de
travessia — **a borda é a peça**. Daí os 1426 tons.

A cura é rasterizar e **depois snapar**: varrer a `ImageData` do buffer de arte e forçar
cada pixel para a cor mais próxima da paleta, com alpha binário (`LIMIAR_ALPHA = 128`,
`src/render/spriteForge.ts:443`). Duas consequências, as duas desejadas: o degradê some, e
o alpha binário entrega uma **máscara de silhueta exata** — o contorno passa a sair dela
(todo pixel opaco com vizinho-4 transparente vira contorno) em vez de um `stroke` de
largura fracionária que deixava furos no outline.

E o snap roda **entre** o desenho e a ampliação, nunca depois
(`src/render/spriteForge.ts:1034`). Depois seria tarde: o antialias já teria virado bloco,
e o custo subiria ×4 por varrer pixels ampliados.

## A reviravolta (rodada 3)

A escala canônica original era `ART_POR_U = 1.25` com `PIXEL = 2`. Foi reprovada por
**orçamento de pixels**, não por forma: com 1.25 o corpo tinha ~24px de arte de altura, e
nesse orçamento a viseira (0.9u ≈ 1,1px), o umbo do escudo e o vão entre as pernas são
fisicamente irrepresentáveis. Nenhum ajuste de modelagem salva um detalhe que não cabe
num pixel.

A troca foi `1.25/2 → 2.5/1` (`src/render/model3d.ts:60` e `:71`), preservando o produto
`ART_POR_U × PIXEL = 2.5` px de tela por unidade — o sprite continua com os mesmos ~45px
de altura em zoom 1 e nem o renderer nem a âncora enxergam diferença. O buffer de arte vai
de 48×47 para 96×94.

Repare no que isso revela: **hoje `PIXEL = 1`, e o sprite continua chunky**. O aspecto
pixel art nunca veio do `drawImage` de ampliação — vem do snap de 10 cores com alpha
binário. A ampliação é o mecanismo óbvio; o snap é o que faz o trabalho.

## A lição

Estilo visual não é filtro aplicado no fim do pipeline; é uma restrição imposta no ponto
onde a informação ainda existe. Baixa resolução limita **o que pode ser dito**; a paleta
fechada limita **como pode ser dito**. Inverter a ordem de qualquer uma das duas
operações — ampliar antes de snapar, ou snapar em alta resolução — dá um resultado que
parece quase certo e não é.

## O que quebra se mudar

- Mover o snap para depois da ampliação: contorno com furos e custo ×4.
- Ligar `imageSmoothingEnabled` no `drawImage` do atlas: volta o 3D liso, agora borrado.
- Mexer em `ART_POR_U` **ou** `PIXEL` sem preservar o produto 2.5: o sprite muda de
  tamanho em relação a `WALL_H = 36` e a âncora do losango deixa de bater.

Ver [[sprite-forge]], [[paleta-e-estilo]], [[personagem-rig-3d]] e
[[ADR-006-atlas-forjado-em-runtime]].
