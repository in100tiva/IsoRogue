---
tipo: nota
atualizado: 2026-07-30
tags: [render, tileset, terreno, nivel, pixel-art, extensao]
---

# 🗺️ Tilesets — o terreno, um arquivo por nível

`src/render/tilesets/` é a **única casa do terreno**. Antes desta fase o chão era losango
pintado à mão (`drawFloor`) e a parede eram três faces (`drawWall`), tudo em LUT de cor;
agora terreno é **rig 3D forjado em sprite**, na mesma técnica do herói, dos monstros e da
mobília ([[como-construir-um-personagem]]).

## O ponto de extensão

```
src/render/tilesets/
├── index.ts     ← o registro: TILESETS[depth] e tilesetDoNivel(depth)
└── nivel1.ts    ← "Ruínas Verdes": paleta, 4 pisos, parede, 5 adereços
```

O `IsoRenderer` **não conhece grama nem areia**. Ele pergunta qual é o tileset do andar e
desenha o que vier. É a mesma disciplina de `RETRATOS` no bestiário, e existe pela mesma
razão: quando chegar a referência do nível 2, a mudança é **um arquivo novo mais uma linha
em `TILESETS`** — nunca um `if (depth === 2)` espalhado pelo desenho.

O que um nível novo entrega:

| Campo | O que é |
|---|---|
| `paleta` / `rampas` / `rampaDaCor` / `emissivas` | as cores, no contrato de sempre |
| `piso: No[]` | variantes indexadas pelo **bucket de decor** (`map.decor[i] & 7`), fechadas com módulo |
| `parede: No` | o bloco alto |
| `agua: No \| null` | piso especial, quando houver |
| `aderecos: No[]` | o que fica **em cima** do piso |

O que um nível novo **não** precisa tocar: renderer, engine, oracle. Terreno é aparência — a
masmorra que o engine gera é a mesma.

## A calibração, que é a única parte que não se chuta

A projeção do rig (§4.2 de `model3d`) é `artX = (x−y)·escala` e
`artY = (x+y)·escala·0,5 − z·escala`, com `escala = ART_POR_U = 2,5` px por `u`. Um quadrado
de lado **S** projeta **5S** px de largura e **2,5S** de altura. O losango do mundo mede
`TW × TH` = 64 × 32:

```
5S = 64  ⇒  S = 12,8u        (e 2,5 × 12,8 = 32 ✓ — a altura fecha sozinha)
```

Errar isso por pouco produz **costura branca** entre tiles (bloco menor) ou **serrilha de
sobreposição** (maior), e nenhum dos dois se conserta depois no renderer.

**A âncora**: `z = 0` é o chão, onde o herói assenta. O piso tem o **topo** em z=0 e desce em
−Z; a parede sobe de 0 até 14,4u (= `WALL_H` ÷ 2,5); a água afunda 1,2u, que é o que dá
leitura de poça e não de laje azul.

## Transparência de parede: intacta

O sistema do canto frontal ([[2026-07-29-paredes-translucidas-no-canto-frontal|as três tiles
que cobrem o herói]]) **não mudou**: quem decide o alfa é o renderer, não o rig. O
`globalAlpha` que envolvia o losango envolve o `drawImage` do sprite do mesmo jeito, e o teste
cobre os dois caminhos — sprite e prisma de reserva.

## Adereços

Sorteados por tile de forma **determinística** — mistura com avalanche sobre (x, y) e os bits
ALTOS do decor (os baixos são o bucket do piso; usá-los amarraria flor à areia). Frequência
~1 em 6, e nunca sobre jogador, inimigo, item, escada, porta, mercador, caldeirão ou extras
da estação. Nada de `Math.random` — é proibido no render e o lint pega.

## Água: modelada, não usada (ainda)

O rig existe e **não é forjado**. O motivo está no código: `map.decor` é hash **por tile**,
sem correlação espacial, então qualquer predicado dá sal-e-pimenta — e poça é região
*conexa*. Um tile de água no meio do corredor lê como erro de tileset, não como água. Somam-se
dois: o topo afunda 1,2u enquanto o herói assenta em z=0, e água sugere regra de travessia que
o engine não tem. O caminho certo é uma **região marcada no mapgen**, e aí vira uma linha aqui.

## Custo, medido

Forja do tileset inteiro (14 entradas → 9 modelos distintos): **~82 ms a frio**, uma vez por
sessão (descer de andar não repete — mesmos modelos, memo do forge). Em regime o terreno é
**mais barato** que o desenho antigo: 0,32 ms/quadro contra 0,48 — um `drawImage` por tile
vence losango + aresta.

Dívida registrada: o atlas é 8 direções × 9 poses e o terreno usa **1 quadro de 72**. O forge
não expõe canal para forjar menos, e gambiarra local seria pior que o desperdício.


## Rodada 2 — o que a referência do Game Assembly ensinou

O primeiro tileset foi reprovado por ser **simples demais**: blocos de três lajes com
"tufinhos" chapados. A referência (tileset de Weronika Kowalczyk, The Game Assembly) mostrou
o que faltava, e virou três helpers no arquivo do nível:

- **`laminasDeGrama(topoZ)`** — o traço nº 1. O topo não termina numa aresta reta: lâminas
  irregulares SOBEM acima da superfície e **quebram a silhueta**. São caixas de 0,6u com
  altura de 1 a 3u — a irregularidade vem da **altura**, nunca da finura, porque abaixo de
  0,5u a peça não rasteriza. Densidade maior nas bordas +Y e +X, as duas que a projeção
  mostra de corpo inteiro; gastar caixa nas de trás é pagar por pixel que o culling descarta.
  O padrão de alturas é **declarado**, não sorteado — render não sorteia.
- **`estratosDeTerra(topoZ, altura)`** — faixas horizontais de tom na lateral e raízes
  escorrendo do topo. Sem elas a face é um campo chapado de 4 a 14u.
- **`fiadasDeTijolo(topoZ, altura)`** — retângulos em relevo POR FORA da face, deslocados meio
  tijolo entre fiadas. Três tijolos por fiada, não seis: com o piso de 0,5u, metade piscaria
  entre direções.

Peças novas: `MODELO_PISO_TIJOLO`, `MODELO_PISO_TIJOLO_GRAMA` (a alvenaria que a mata está
retomando — o bloco mais bonito da referência), `MODELO_PISO_LAJOTA` (o caminho de pedra
polida), `MODELO_PAREDE_TIJOLO` e `MODELO_FLORES_TURQUESA`.

`Tileset` ganhou **`paredeAlternativa`**: uma segunda parede de outro material, pronta para o
renderer alternar por sala e quebrar a monotonia do andar. Enquanto ele não usa, não custa
nada — atlas só é forjado quando alguém pede.

## Água, vazio e cachoeira (fase 2.3)

- **Vazio** = `Tile.Void`, a crosta de parede a mais de um anel da divisa, virando penhasco ao
  redor do construído. O renderer **não desenha nada** ali: o que fica embaixo é o fundo.
- **Água** = bitmap paralelo `map.agua`, poças 4-conexas de 2 a 5 tiles, uma por sala em ~60%
  delas, com validação dura de conectividade (se isolar qualquer tile seco, a região é
  revertida inteira).
- **Ambos bloqueiam** jogador e inimigos: `isWalkable` recusa a água num ponto único, e os
  dois entram no `occupied` do contexto de turno.
- **Cachoeira**: onde a poça encosta no vazio, um fluxo desce pela borda com lâminas de espuma
  marchando por `dt`. É efeito de TELA, não rig — modelá-lo em caixa exigiria um rig por
  combinação de borda. As cores vêm do **tileset**, não das LUTs: a água do andar 2 pode ser
  lava.

## O que quebra se mudar

- **Mexer em `ladoDoTile` sem refazer a conta** — costura ou sobreposição em todo o mapa.
- **Ancorar o piso em outro plano que não z=0** — o elenco inteiro passa a flutuar ou afundar.
- **Sortear adereço com os bits baixos do decor** — o adereço vira função do material e o
  terreno fica com cara de padrão de papel de parede.
- **Desenhar adereço depois das entidades** — o tufo passa por cima do herói.

---

Vizinhos: [[projecao-isometrica]] · [[sprite-forge]] · [[fog-of-war-e-iluminacao]] ·
[[2026-07-29-paredes-translucidas-no-canto-frontal]] · [[o-frasco-que-nao-tinha-gosma]]
