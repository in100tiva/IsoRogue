---
tipo: aprendizado
atualizado: 2026-07-28
tags: [render, bestiario, revisao-visual, silhueta, goblin]
---

# 🔍 Fidelidade à referência perde para legibilidade em 40 px

O aprendizado mais caro da fase do bestiário, e o menos intuitivo: **a peça foi construída
exatamente como a referência mandava e por isso mesmo ficou errada.**

## O sintoma

`docs/BESTIARIO.md` §5 é explícito sobre a pose de repouso do Goblin: *"`bracoDir`
rotacionado para trás de modo que a cimitarra fique apoiada sobre o ombro, como na
referência — não com a arma pendurada ao lado. É essa pose que faz a silhueta ler como
'goblin encrenqueiro' à distância."*

A rodada 1 cumpriu isso ao pé da letra. Na bancada ampliada, a pose está correta: a lâmina
descansa no ombro, passa atrás da cabeça, o punho fecha na frente do peito.

O dono olhou o jogo e reprovou (`docs/ref/goblin-problema-espada.png`). No tamanho real, o
que ele viu ao lado do Guerreiro foi **uma tábua cinza atravessada atrás da cabeça de um
bicho verde, sem dono** — uma peça de metal flutuando, não uma arma sendo empunhada.

## A causa

O que sustenta aquela pose numa ilustração é um circuito que o olho fecha sozinho:
mão fechada → cabo → guarda → lâmina. Numa arte de 700 px cada elo desse circuito tem dezenas
de pixels. Num sprite de ~40 px de arte **não sobra mão nenhuma na frente do corpo**: a mão
tem 1 ou 2 px, o cabo some atrás da cabeça, e o único elo que sobrevive é o último — a lâmina.
Uma lâmina sem os elos anteriores não é uma arma empunhada; é um retângulo cinza.

A medição que condenou a pose (rasterização com ordem do pintor, 8 direções, registrada em
`src/render/characters/goblin.ts:37-63`):

- em **3 das 8** direções (4, 5 e 6) a lâmina era desenhada **por cima da cabeça**;
- em outras **3** (0, 1 e 2) 100% da lâmina visível caía numa região da tela **sem nenhum
  pixel de mão, cabo ou braço por perto**;
- o Guerreiro, no mesmo atlas e no mesmo pipeline, lê nas 8 direções — porque ele empunha a
  espada **à frente**, com a mão fora da silhueta do tronco.

A cura foi trocar o traço I6 de "cimitarra apoiada no ombro" para "cimitarra empunhada em
guarda diagonal à frente" (`criarBracoDir` e `criarCimitarra`,
`src/render/characters/goblin.ts:1085` e `:1017`). Desvio consciente da referência: **o que
carrega I6 é a lâmina larga e curva, não o ombro onde ela descansa.**

O preço foi medido antes de ser aceito, para ninguém "consertar" isto por engano: o quadro
cresceu de 56×59 para 84×68 px de arte, e depois para 90×69. É margem transparente — a arma
sai da silhueta em vez de se dobrar sobre o corpo, e quem dimensiona o quadro é a caixa da
silhueta ([[sprite-forge]]). O corpo não mudou de tamanho: G7 continua em 42 px contra 57 px
do Guerreiro, 74%.

## O mesmo erro, com outra roupa, em outro bicho

A lição não é sobre espadas. É sobre **medir a coisa errada**, e a fase produziu dois
gêmeos:

**A antena do Slime.** A rodada 1 mediu a área visível da bolinha luminosa nas 8 direções —
47,8 a 74,3 px², nunca zero — e concluiu que o traço S5 estava entregue. Estava errado: com o
arco baixo, a borda de baixo da bolinha ficava 0,9u (2,25 px) acima do domo, e depois da
projeção as duas **máscaras encostavam**. Sem um pixel de fundo entre as duas, a bolinha vira
um caroço do corpo. Ela tinha 74 px² de área e **contribuição zero para a silhueta**
(`src/render/characters/slime.ts:824-842`).

> Área não é legibilidade. A medição que detecta fusão de silhueta é a **contribuição de
> máscara** — quantos pixels da silhueta somem quando a peça é removida — e o **fundo livre**
> entre a peça e o resto do corpo. Vale para qualquer apêndice de qualquer bicho futuro.

**A marreta do Ogro.** A rodada 1 comparou **largura de quadro** com a do Guerreiro (130 px
contra 113 px), concluiu "a oclusão não piora de forma relevante" e a revisão derrubou a
conclusão. Os 113 px do Guerreiro vêm da espada **erguida**, que ocupa `artY` acima do tile;
os do Ogro vinham da marreta **deitada ao lado**, que ocupa `artX` e invade o tile vizinho no
plano do chão — exatamente onde a ordem do pintor por antidiagonal erra sem z-buffer
([[projecao-isometrica]]). São 2 px iguais em lugares que doem de forma diferente. A medida
certa separa os eixos e olha o extremo em `artX` contra os 32 px de meio tile: a cabeça da
marreta estava em −39,4 px e voltou para −29,8 px quando a arma passou a ser erguida
(`src/render/characters/ogre.ts:188-217`).

## A lição

**Fidelidade à referência é meio, não fim.** A referência existe para dizer *o que* torna o
bicho aquele bicho; ela não sabe em quantos pixels ele será desenhado. Quando as duas coisas
brigam, ganha a escala real — e o traço de identidade tem de ser reancorado em outra peça
(no Goblin: a lâmina larga e curva, não o ombro).

**E a revisão visual tem de acontecer no tamanho do jogo.** A bancada já tinha um painel de
tamanho real desde o Guerreiro (painel 4 de [[revisar-o-personagem]]) — e mesmo assim o
veredito da rodada 1 saiu do painel ampliado, porque é onde dá para *ver*. Ampliar 4× é o que
permite julgar a construção; só o tamanho real permite julgar a leitura. São perguntas
diferentes e o olho responde a mais fácil quando as duas estão na mesma folha.

A consequência prática foi instrumentar o resto: a bancada dos monstros ganhou os painéis que
faltavam para os gates novos serem julgáveis — o bicho ao lado do Guerreiro em escala
(painel 4b, G7), o mesmo quadro em 5 níveis de luz com as emissivas preservadas (4c, G8) e o
elenco inteiro lado a lado (4d, G9 e G10). Gate sem painel que o responda não é gate; é
intenção.

## O que quebra se mudar

- **Devolver a cimitarra ao ombro "porque a referência mostra assim"** — volta a lâmina
  flutuante em 6 das 8 direções, e o bloco de comentário do arquivo existe para que a próxima
  rodada não repita a medição do zero.
- **Encurtar o arco da antena do Slime para "caber" na altura declarada de 7u** — foi a
  decisão da rodada 1 e ela funde a bolinha no domo. As duas alturas do Slime são medidas
  diferentes: a massa (7u) responde G10, a silhueta (~11u) inclui o ápice do arco.
- **Julgar oclusão por largura de quadro** — mistura `artX` e `artY` e produz uma conclusão
  confiante e errada.
- **Aceitar um traço de identidade por área medida** — área não distingue "aparece" de
  "recorta contra o fundo".

Ver [[bestiario-monstros]], [[personagem-rig-3d]], [[sprite-forge]],
[[revisar-o-personagem]], [[pixel-art-nasce-da-rasterizacao]].
