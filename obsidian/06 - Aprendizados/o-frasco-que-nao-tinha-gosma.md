---
tipo: aprendizado
atualizado: 2026-07-30
tags: [aprendizado, render, pixel-art, rig, item, armadilha]
---

# 🧪 O frasco que não tinha gosma

Duas armadilhas de modelagem por caixas, descobertas na mesma tarde construindo o
**frasco de gosma** (o despojo do Slime). As duas produzem imagem *errada* sem produzir
erro *nenhum*: compila, forja, desenha — e o item não é o que devia ser.

## Armadilha 1 — caixa opaca não guarda conteúdo

**O sintoma.** O rig modelava o frasco como o mundo o modela: paredes de vidro por fora,
líquido verde recuado 0,35u por dentro. Na bancada saiu um **bloco cinza-azulado com um
chapéu marrom**. A gosma — o traço de identidade I1, a razão de o item existir — não
aparecia em nenhum dos oito quadros.

**A causa.** O rig deste projeto é feito de **caixas opacas**. Não há transparência, não há
refração, não há vidro: há faces que sobrevivem ao culling e faces que não. Um líquido
"dentro" de um recipiente está, para o rasterizador, atrás de uma parede sólida — e nunca
será desenhado.

**A cura, que virou regra:** **o conteúdo é a SUPERFÍCIE, não o interior.** O bojo passou a
ser feito *de gosma*; o vidro aparece só onde o líquido não chega (a faixa acima do nível, o
gargalo) e como **arestas claras nas quinas**. É assim que pixel art sempre desenhou vidro —
por reflexo de borda, não por transparência. Quem for modelar poção, garrafa, ampulheta ou
lampião no futuro começa por aí.

## Armadilha 2 — abaixo de ~0,5u a peça não existe

**O sintoma.** Corrigida a armadilha 1, a metade de cima do frasco saiu **furada**: um
xadrez, com o fundo transparente vazando entre os pixels. Parecia bug do forge.

**A causa.** A escala de arte do projeto dá ~2,5 px de arte por `u`. As peças do ombro e das
arestas tinham 0,26–0,42u — ou seja, **0,65 a 1,05 px**. Uma caixa assim não rasteriza de
forma confiável: aparece em algumas das oito direções, some nas outras, e onde some deixa
buraco.

**A cura:** um **piso de espessura** declarado no próprio rig
(`PROPORCOES_GOSMA.espessuraMinima = 0.5`), e nada abaixo dele. Um degrau que existe lê
melhor que dois que não existem — o ombro de dois degraus finos virou um degrau gordo, e a
silhueta melhorou junto.

**Corolário aprendido logo depois:** tentei recuperar o gargalo estreito com um "colar" de
0,5u no encontro com o ombro. Voltou a furar. Numa peça de 4u de altura, detalhe de um pixel
compete com a silhueta e perde: **a três pixels de largura não existe detalhe, só existe
forma**. O colar foi revertido.

## A lição de método

As duas armadilhas foram encontradas **na bancada, não no jogo** — e nenhuma delas seria
encontrada lendo o código. Vale o que o método já dizia e esta tarde confirmou por dinheiro:
rig novo só está pronto depois de **forjado e olhado**, e a folha de revisão é barata perto
de um item que ninguém reconhece no chão da masmorra.

Ordem que funcionou: modelar → forjar → **recortar e ampliar o item na folha** → corrigir →
repetir. Foram três rodadas para um objeto de doze caixas.

## O que quebra se mudar

- **Modelar recipiente novo com conteúdo interno** — o conteúdo some, e some em silêncio.
- **Baixar `ART_POR_U` sem revisar os pisos de espessura** — todo detalhe entre 0,5 e 0,8u
  entra na zona de vazamento e os rigs de item começam a furar sem que ninguém tenha mexido
  neles.
- **Copiar as proporções de um personagem para um item** — o Guerreiro tem 18u para gastar
  em detalhe; um despojo tem 3 a 5u, e a mesma peça em escala menor deixa de existir.

---

Vizinhos: [[pixel-art-nasce-da-rasterizacao]] · [[legibilidade-em-40px]] ·
[[como-construir-um-personagem]] · [[personagem-rig-3d]] · [[revisar-o-personagem]]
