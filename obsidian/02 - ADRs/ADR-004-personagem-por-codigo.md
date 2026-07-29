---
tipo: adr
atualizado: 2026-07-28
tags: [render, personagem, arte, 3d]
---

# 🗡️ ADR-004 — Personagem reconstruído por código

**Status:** aceita · Guerreiro entregue, com pendências visuais conhecidas

## Contexto

O R08 pede "personagens feitos com formas geométricas" (`docs/BRIEF.md:13`) e o R02 proíbe
qualquer recurso externo. A referência do Guerreiro é uma pixel art de 151×151
(`docs/ref/guerreiro-referencia.png`): armadura dourada integral, elmo fechado com viseira
escura, ombreiras volumosas, espada erguida na diagonal, escudo redondo, contorno escuro
contínuo, proporção heroica de ~4 cabeças.

Perder as ombreiras, a espada ou o escudo descaracteriza o personagem. Perder o contorno
mata o estilo (`docs/PERSONAGEM.md:23-36`).

Como transformar essa imagem em algo desenhável em Canvas 2D, sem importar malha, sem
fotogrametria e sem baixar pacote de arte?

## Decisão

Adotar o método do **img2threejs** (https://github.com/img2threejs/img2threejs), adaptado.

O nome engana: ele **não voxeliza nem extruda** a imagem. Ele reconstrói o objeto **como
código** — primitivas determinísticas montadas a partir de uma spec derivada da referência —
em passes revisados visualmente contra ela.

Duas adaptações:

1. **Three.js não entrou.** O projeto não tem dependências
   ([[ADR-001-arquivo-unico-sem-dependencias]]). `THREE.Group` virou um rig próprio de
   caixas orientadas, projetado isometricamente e rasterizado no Canvas 2D
   (`docs/PERSONAGEM.md:9-11`).
2. A saída não é uma cena 3D em tempo real: é um **atlas de sprites** forjado no boot
   ([[ADR-006-atlas-forjado-em-runtime]]).

O rig vive em `src/render/characters/warrior.ts` como uma árvore de nós
(`raiz → quadril, torso, cabeca, bracoDir, bracoEsq, pernaDir, pernaEsq`), cada nó com um
pivô e uma lista de caixas em unidades `u`. A matemática — rotação Z→Y→X, projeção,
back-face culling, sombreamento por face, quantização de paleta e contorno — está em
`src/render/model3d.ts`. Ver [[personagem-rig-3d]].

Duas invariantes que não são detalhe:

- **A projeção do modelo é a mesma projeção do mundo.** `artX = (x−y)·escala`,
  `artY = (x+y)·escala/2 − z·escala` (`src/render/model3d.ts:630-636`), a razão 2:1 do tile.
  Inventar outra projeção faz o personagem parecer colado num plano diferente do chão.
  Ver [[projecao-isometrica]].
- **O pixel art nasce da rasterização.** O rig é desenhado num buffer de *arte* em baixa
  resolução e só então ampliado com `imageSmoothingEnabled = false`. Rasterizar direto em
  alta resolução produz 3D liso, não pixel art — a **ordem** das duas operações é o estilo.
  Ver [[pixel-art-nasce-da-rasterizacao]].

O loop de qualidade também veio do método: nenhum passe é dado por concluído sem revisão
visual contra a referência, respondendo por escrito aos gates G1..G6
(`docs/PERSONAGEM.md:313-331`). Foram três rodadas, e os motivos de cada uma estão
registrados no próprio rig (`src/render/characters/warrior.ts:380-405`) — a rodada 3, por
exemplo, trocou largura por fundo em todas as caixas do tronco porque, com `artX = x − y`,
nos yaws das direções 3 e 7 só o **fundo** aparece e a massa de pixels caía 39% em relação à
direção mais gorda. É o "pular de tamanho" que o gate G2 proíbe.

## Consequências

**Boas**

- Arte versionada como código: um `git diff` mostra que a ombreira baixou 0,4u e por quê.
- Paleta, proporção e pose são **parâmetros**. Trocar o esquema de cores é editar um objeto,
  não reexportar 72 PNGs.
- Zero bytes de asset no entregável — o Guerreiro custa o tamanho do seu código-fonte.
- Determinístico: sem `Math.random` na forja (`tools/check-boundaries.mjs` reprova em
  `src/render/**` também).

**Ruins**

- **Caro em iteração.** É esperado precisar de 2 a 3 rodadas de revisão visual; foram três,
  e ainda há pendências.
- Exige uma bancada própria só para olhar o resultado
  (`tools/preview-personagem.mjs` + `vite.preview.config.ts`), com toda a fricção de
  inspeção visual headless que isso trouxe — ver [[revisar-o-personagem]] e
  [[inspecao-visual-headless]].
- **Pendências visuais conhecidas e assumidas:**
  - a silhueta ainda está mais atarracada que a referência (pernas curtas);
  - a direção 7 (nordeste) fica estreita demais;
  - o sprite invade ~12 px do tile vizinho na mesma antidiagonal e passa por cima de
    paredes — corrigir exigiria z-buffer, que o pintor por antidiagonal não tem
    (`docs/PERSONAGEM.md:150-154`).
- Sem z-buffer, a ordem de pintura é por profundidade do centro da face, com empate resolvido
  pela **ordem de declaração** das caixas. Reordenar caixas no rig é uma mudança visual, não
  cosmética de código.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Three.js (o img2threejs original) | Dependência, e grande. Mata [[ADR-001-arquivo-unico-sem-dependencias]]. |
| Sprite sheet desenhado à mão e embutido em base64 | Viola R02, infla o arquivo e congela a arte — não dá para mudar paleta nem proporção sem reexportar por fora. |
| Voxelizar / extrudar a referência | Não é o que o img2threejs faz, e produziria um bloco chapado sem as ombreiras e sem a leitura interna que a referência tem. |
| Manter o jogador em formas geométricas soltas, como os inimigos | Era o estado anterior. Atende R08 na letra, mas não entrega o personagem da referência nem as 8 direções. |
| Migrar os inimigos junto | Fora de escopo por decisão (`docs/PERSONAGEM.md:307-309`). Falta o caminho de modulação do quadro pela luz do tile, que o jogador não precisa por ser a fonte de luz — registrado em `src/render/IsoRenderer.ts:923` como `TODO(inimigos-no-atlas)`. Ver [[arquetipos-de-inimigo]] e [[fog-of-war-e-iluminacao]]. |

Relacionadas: [[personagem-rig-3d]] · [[sprite-forge]] · [[paleta-e-estilo]] · [[armadilha-do-yaw-isometrico]]
