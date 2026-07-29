---
tipo: adr
atualizado: 2026-07-28
tags: [bestiario, arquetipos, golden, render, decisao]
---

# 🎭 ADR-007 — Monstro é aparência de arquétipo, não arquétipo novo

**Status:** aceita, com um encaixe forçado assumido (o Ogro) · revisão marcada para a fase de
balanceamento

## Contexto

O jogo precisava de três monstros com cara: Goblin, Slime e Ogro. O engine tem três
arquétipos de comportamento — `chaser`, `sentinel`, `linker` (`src/engine/entities.ts:50-96`,
ver [[arquetipos-de-inimigo]]) — e o [[golden-test]] congela, para 12 sementes,
**quantos e quais** inimigos nascem em cada nível.

A tentação é escrever "monstro" e pensar em criatura: um bicho novo com hp próprio, alcance
próprio, uma IA própria. Isso é mudança em `ARCHETYPES`, em `KINDS` e em `populate()`
(`src/engine/entities.ts:513`, onde o sorteio por peso mapeia índice para arquétipo **por
posição**). Qualquer uma das três invalida os 12 casos do oracle de uma só vez, e o oracle é o
que sustenta [[ADR-003-golden-test-como-oracle-da-migracao]] — a única prova que o projeto tem
de que o comportamento não mudou.

## Decisão

**Monstro é aparência. O comportamento é o do arquétipo que já existe.**

Cada um dos três bichos entrou como um rig em `src/render/characters/` e uma linha na tabela
`RETRATOS` do renderizador (`src/render/IsoRenderer.ts:262`). Zero mudança em `src/engine/`.

| Arquétipo | Comportamento | Monstro | Encaixe |
|---|---|---|---|
| `chaser` (alcance 1, ideal 1, peso 5) | avança sempre, corpo a corpo | **Goblin** | natural |
| `linker` (alcance 1, ideal 3, peso 1) | só ataca com aliado adjacente ao jogador | **Slime** | natural |
| `sentinel` (alcance 6, ideal 4, peso 2) | mantém distância, ataca à distância | **Ogro** | **forçado** |

**Goblin → `chaser`.** Um capanga verde de cimitarra que corre para cima do jogador é a
definição de `chaser`. Não há o que justificar.

**Slime → `linker`.** O `linker` só parte para o ataque quando **outro** inimigo já está
adjacente ao jogador (`aiLinker`, `src/engine/entities.ts:797`); sem aliado colado, ele orbita
na faixa 2..3. É o comportamento de bicho que anda em bando, e a referência do Slime mostra
três indivíduos lado a lado. O encaixe é honesto.

Vale registrar o que a referência **não** decidiu: os três slimes da imagem são composição de
arte — o mesmo bicho de três ângulos. O entregável é um rig, um atlas, uma criatura. Quem
decide quantos aparecem na masmorra é o `populate()`, que já sorteia vários inimigos por sala.
A trinca da referência serviu para escolher o arquétipo e para mais nada.

**Ogro → `sentinel`, e este é o encaixe fraco.** A referência é um brutamontes de marreta —
corpo a corpo puro. O `sentinel` ataca a **6 tiles** e recua quando o jogador chega perto
(`aiSentinel`, `src/engine/entities.ts:690`). Um ogro de marreta que foge de você e martela à
distância de seis tiles não é uma leitura defensável.

A saída foi visual: a marreta fica na mão esquerda, apoiada, e **a animação de ataque é um
arremesso** com a mão direita (`ARCO_GOLPE_OGRO`, `src/render/characters/ogre.ts:621`). O arco
genérico de golpe desferiria uma martelada que o `sentinel` nunca poderia estar dando — foi
por isso que o arco virou propriedade do personagem, e não do forge. Funciona, é comum no
gênero, e é adaptação: a referência não pedia isso.

## O custo, dito por extenso

**O Ogro está no arquétipo errado e continua lá de propósito.** O que se ganhou foi o oracle
intacto; o que se pagou:

- a leitura de perigo fica torta. Um bicho de 24u, o maior sprite do jogo, é o que recua
  quando o jogador se aproxima. A intuição do jogador diz o contrário;
- a animação de arremesso é uma justificativa retroativa. Ela resolve a inconsistência
  visual sem resolver a de design;
- a distribuição de spawn ficou de cabeça para baixo em relação à qualidade do encaixe. Com
  os pesos base 5/2/1, no nível 1 o jogador vê **Goblin 62%, Ogro 25%, Slime 13%** — o bicho
  de encaixe mais natural é o mais raro, e o de encaixe forçado é um em cada quatro
  encontros. O reforço por profundidade (`+floor(depth/2)` para `sentinel`,
  `+floor(depth/3)` para `linker`, `src/engine/entities.ts:513`) só piora isso nos primeiros
  níveis, que é onde o jogador forma a impressão do bestiário;
- a tabela `RETRATOS` está **cheia**. Ela é indexada por `ArchetypeKey`, as três linhas
  esgotam a união, e um quarto monstro não cabe por definição. O ponto de extensão que a
  fase construiu extingue-se no ato em que é usado pela terceira vez.

## A saída, e ela está marcada

O momento certo de consertar é a **fase de balanceamento de níveis e dificuldade**, que é o
próximo passo combinado com o dono. Lá os arquétipos são revistos e o oracle é **regenerado de
propósito**, com o usuário sabendo — que é exatamente o procedimento que
[[ADR-003-golden-test-como-oracle-da-migracao]] descreve para mudança intencional de
comportamento, e o oposto de relaxar um teste que ficou vermelho.

Concretamente, o que aquela fase tem de decidir: se o `sentinel` continua sendo o arquétipo do
Ogro (e então o Ogro deixa de ter marreta), se nasce um arquétipo `brute` corpo a corpo pesado
(e então o `sentinel` ganha outro rosto — algo que atire de longe faz sentido), e se os pesos
5/2/1 são a distribuição que se quer mostrar ao jogador nos três primeiros níveis.

**Enquanto essa fase não chega, ninguém "conserta" isto por engano.** Um arquétipo novo
introduzido fora dela derruba os 12 casos e a leitura natural é que a mudança quebrou o jogo,
não que ela mudou o jogo de propósito.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Criar um arquétipo por monstro (o modelo "óbvio") | Muda `ARCHETYPES`, `KINDS` e `populate()`; derruba os 12 casos do oracle e mistura mudança de arte com mudança de comportamento num diff só, tornando impossível saber qual das duas quebrou o quê. |
| Regenerar o oracle agora e seguir em frente | Regenerar oracle é operação deliberada com o dono junto. Fazer isso para viabilizar uma fase de **arte** troca a garantia mais forte do projeto por conveniência de agenda. |
| Dar marreta ao Ogro e ignorar que `sentinel` ataca a 6 tiles | A incoerência apareceria em jogo no primeiro encontro: o bicho martela o ar a seis tiles de distância. Adaptar a animação custa um `arcoGolpe`; não adaptar custa credibilidade. |
| Deixar `sentinel` e `linker` em formas geométricas e entregar só o Goblin | Foi o estado da fase anterior, e ele tem um defeito de leitura: dois dos três inimigos do jogo pareciam objetos de depuração ao lado de um personagem acabado. |
| Reduzir o Ogro para caber melhor no papel de atirador (bicho pequeno, franzino) | Mataria O1 — "maior que o Guerreiro" é o primeiro traço da referência e o que faz G10 valer alguma coisa. Corrigir o encaixe amputando a identidade visual é resolver o problema errado. |

## Consequências

**Boas**

- `npx vitest run` continua 100% verde com o golden em 12/12, e a fase de arte pode ser
  julgada por gates visuais em vez de por regressão de comportamento.
- A arte ficou inteiramente na camada de render. `src/engine/` não tem uma linha sobre
  aparência, o que preserva a fronteira de [[camadas-e-fronteiras]].
- O ponto de extensão ficou barato e explícito: três passos, documentados em
  [[bestiario-monstros]].

**Ruins**

- A dívida de design do Ogro é real e está registrada, não resolvida.
- `RETRATOS` está saturada: a próxima criatura é obrigatoriamente uma conversa de arquétipo,
  não uma linha de tabela.
- A regra "monstro é aparência" é fácil de esquecer seis meses depois, quando alguém for
  acrescentar o quarto bicho e achar que basta copiar `goblin.ts`.

Relacionadas: [[bestiario-monstros]] · [[arquetipos-de-inimigo]] · [[golden-test]] ·
[[ADR-003-golden-test-como-oracle-da-migracao]] ·
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]] · [[ADR-006-atlas-forjado-em-runtime]]
