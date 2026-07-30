---
tipo: indice
atualizado: 2026-07-30
tags: [indice, render, arte, personagem, moc]
---

# 🎨 MOC — Render e arte

Canvas 2D escrito à mão, sem WebGL, sem biblioteca de matriz e sem um único arquivo de
imagem: a arte é código que desenha. Esta pasta cobre de como um tile vira losango até como
o guerreiro — e os três monstros — viram 72 quadros de pixel art forjados sob demanda.

## O mundo na tela

- [[projecao-isometrica]] — quatro linhas de aritmética, e a inversa exata delas. Vale a
  leitura pela ordem do pintor por antidiagonal, que é o que substitui o z-buffer que o
  projeto não tem.
- [[fog-of-war-e-iluminacao]] — os três estados de cada tile e o corte que impede o vazamento
  de informação. Inimigo nunca é desenhado por estar explorado; só por estar visível.
- [[paleta-e-estilo]] — as duas paletas que não se misturam (mundo e personagem), as LUTs
  montadas uma vez por renderer, e as duas quantizações — por face e por pixel.

## O personagem

Leia nesta ordem: a decisão, o modelo, a fábrica.

- [[como-construir-um-personagem]] — **comece por aqui se for fazer o quinto bicho.** O passo
  a passo completo, do intake ao gate: onde o pixel art nasce (a ordem da rasterização), os
  truques de modelar curva e disco com caixas, e as quatro armadilhas que já custaram caro.
- [[ADR-004-personagem-por-codigo]] — por que reconstruir o guerreiro como primitivas
  determinísticas em vez de voxelizar, extrudar ou importar malha. O método vem do
  img2threejs, adaptado — e sem Three.js, que é dependência.
- [[personagem-rig-3d]] — a árvore de nós, o espaço destro (`+Y` é a frente), o culling por
  normal e o sombreamento interpolado. Traz duas armadilhas que já custaram rodada de
  revisão: a bota afunda de propósito, e nome de nó errado falha em silêncio.
- [[sprite-forge]] — 8 direções × 9 quadros = 72, medidos com uma âncora só, snapados para a
  paleta e ampliados sem suavização. Termina com as pendências visuais em aberto.
- [[ADR-006-atlas-forjado-em-runtime]] — por que forjar o atlas no boot (~37 ms) em vez de
  rasterizar o rig a cada frame ou embutir um PNG.

## Os monstros

O mesmo pipeline do guerreiro, apontado para os inimigos — e uma regra que protege o oracle.

- [[ADR-007-monstro-e-aparencia-nao-arquetipo]] — por que Goblin, Slime e Ogro entraram como
  **rosto** de `chaser`, `linker` e `sentinel`, sem uma linha de engine. Traz o custo dito por
  extenso: o encaixe do Ogro é forçado e continua assim de propósito, com a correção marcada
  para a fase de balanceamento.
- [[bestiario-monstros]] — a tabela `RETRATOS` como ponto de extensão (três passos para o
  próximo bicho), a modulação do sprite pela luz do tile, o cache LRU de 64 slots e as cores
  emissivas que fazem um goblin no escuro virar dois pontos vermelhos. **2026-07-30:** ganhou
  as cinemáticas de abate (cada monstro morre em cena e deixa rastro no tile) e o texto de
  XP flutuante em rig de caixas.

## As armadilhas desta pasta

Oito erros reais, com sintoma, causa e lição. Valem mais que a documentação do módulo quando
alguma coisa parece "bug de cor" ou "bug de conversão".

- [[armadilha-do-yaw-isometrico]] — a spec prescrevia `atan2(dy, dx)` e estava **errada**: o
  guerreiro andava certo e olhava 90° fora. O correto é `atan2(-dx, dy)`.
- [[pixel-art-nasce-da-rasterizacao]] — o estilo visual não é um filtro aplicado no fim; é a
  ordem entre rasterizar em baixa resolução e ampliar sem suavização. Inverter a ordem devolve
  3D liso.
- [[mouse-no-vertice-do-losango]] — `clientX` é inteiro, e o vértice do losango é a fronteira
  de quatro tiles. Mire no centro da célula antes de acusar `screenToTile`.
- [[virtual-time-congela-animacao]] — o creme que tinge o personagem inteiro na captura
  headless não é bug de blend: é o clarão de dano preso em 1 porque o relógio virtual parou o
  decaimento por `dt`.
- [[legibilidade-em-40px]] — a cimitarra do goblin foi construída **fiel à referência** e por
  isso mesmo ficou errada: no tamanho do jogo virou uma tábua cinza sem dono. Leia antes de
  copiar qualquer pose de uma ilustração — e antes de aceitar um traço por área medida.
- [[texto-em-isometrica-cisalha]] — texto deitado no plano X-Z vira emaranhado: a projeção
  cisalha o bitmap ~26°. A cura é a pré-distorção de outdoors — passos-modelo que projetam
  uma grade quadrada na tela. Leia antes de qualquer número de dano futuro.
- [[o-frasco-que-nao-tinha-gosma]] — duas armadilhas de rig num item só: caixa OPACA não
  guarda conteúdo (o líquido modelado por dentro não existe na imagem — o conteúdo tem
  de ser a superfície), e abaixo de ~0,5u a peça não rasteriza e deixa o fundo vazar.
- [[arma-que-cai-e-continua-na-mao]] — a espada caía e continuava na mão por 0,75 s: o prop
  nascia numa constante de tempo e a troca do rig acontecia em outra. Objeto que sai do
  personagem some do rig no MESMO instante em que passa a existir sozinho — e folha de
  revisão que só congela as poses finais não prova a sequência.

## Olhar para o resultado

- [[revisar-o-personagem]] — a bancada que fotografa o atlas inteiro e os seis gates que um
  humano responde por escrito. Não existe assert para "parece o desenho".
- [[inspecao-visual-headless]] — como tirar foto do jogo rodando nesta máquina, e por que o
  caminho óbvio (automação de navegador) não alcança nem `file://` nem `localhost`.

## De onde vêm os dados

O renderer só lê: as posições, o conjunto de visíveis e o mapa explorado são produzidos pelo
engine — ver [[_moc-sistemas-de-jogo]]. A fronteira que impede o render de importar React
está em [[camadas-e-fronteiras]].

---

Vizinhos: [[_moc-arquitetura]] · [[_moc-sistemas-de-jogo]] · [[como-usar-este-cofre]]
