---
tipo: nota
atualizado: 2026-07-30
tags: [sistemas, despojos, loot, itens, bolsa, determinismo]
---

# 🎒 Despojos, itens e a bolsa

O que o monstro deixa no chão quando morre, como o herói recolhe e onde isso fica
guardado. Esta é a **fase 1** de um sistema maior — economia (venda no mercador),
alquimia/refino (bancada) e missões vêm depois, e já têm lugar reservado aqui.

## O que é um item neste jogo

Duas famílias, e a diferença é dura:

| | Consumível | Material |
|---|---|---|
| exemplo | poção | gosma, orelha, cimitarra, pé, clava |
| onde mora | `player.potions` (contador) | `player.bag[kind]` (contadores) |
| o que faz | cura na hora (`POTION_HEAL`) | matéria-prima, venda, missão |
| origem | `populate()` no chão | **abate** de monstro |

A poção continua exatamente o que era (contrato R7 desde o vanilla). O que nasceu foi a
união `ItemKind` e a tabela `ITENS` (`src/engine/entities.ts`), que descreve nome, plural,
gênero gramatical, `valor` em moedas e se o item é material.

O `valor` já está lá **sem ninguém para gastá-lo**: é a fase 2 que abre o mercador. Deixar o
número no contrato desde agora é o que evita que a arte e a bolsa sejam construídas sem
saber quanto vale o que carregam.

## A tabela de despojos

`DROPS` (`src/engine/entities.ts`), lida no abate:

| Monstro | Item | Chance | Para que serve |
|---|---|---|---|
| Slime (`linker`) | frasco de gosma | 70% | alquimia · venda (3) |
| Goblin (`chaser`) | orelha de goblin | 50% | missão · venda (5) |
| Goblin (`chaser`) | cimitarra | 15% | refino (ferro) · venda (18) |
| Ogro (`sentinel`) | pé de ogro | 45% | missão · venda (12) |
| Ogro (`sentinel`) | clava | 20% | venda alta (40) |

Cada linha é um sorteio **independente**: um goblin pode largar orelha e cimitarra no mesmo
abate, ou nada. A **ordem da tabela é fixa** e é desempate determinístico — reordenar muda o
que cai em toda semente já jogada.

A leitura de design: o item comum é o que o bicho comum larga (o Slime domina a masmorra
desde [[2026-07-29-brutamontes-e-a-masmorra-de-slimes|a mudança de proporção]]), e a arma é
sempre o drop raro — é ela que vale dinheiro de verdade.

## O stream próprio de RNG

`game.rngLoot`, semeado com `hash32(seed + '#loot' + depth)`, criado em `createState` e
recriado em `descend` — o mesmo padrão de `rngCombat` ([[semente-e-rng]]).

**Por que um stream separado, e não o de combate:** se o despojo consumisse `rngCombat`, o
próximo dano do jogo mudaria conforme a sorte do drop. Duas partidas com a mesma semente e
os mesmos comandos divergiriam porque um goblin largou uma orelha a mais. O teste T12 prova
a independência perturbando só o loot e comparando o estado de combate comando a comando.

Consumo: cada abate gasta **exatamente `DROPS[kind].length` valores** (o sorteio consome um
u32 mesmo quando falha). A posição do stream depende de *quais* monstros morreram, nunca de
*o que* caiu — que é o que torna o sistema replicável.

## Empilhar e recolher

Os itens caem **no tile onde o monstro morreu**, e podem empilhar: nada é deslocado para o
vizinho. `pegarItem` recolhe a pilha inteira num passo — poção vai para o contador, material
para a bolsa, uma linha de registro por tipo, com plural e concordância.

No render, a pilha desenha até **três** sprites em leque (±3px·zoom), escolhidos pelos três
menores `id` — os que caíram primeiro. É corte determinístico, não "os três primeiros que o
laço encontrar".

## O que isso mudou no oracle

`snapshot()` subiu para **v2**: os itens agora publicam `kind` (`I[id:kind:x:y]`), a bolsa
entra como `B[...]` na ordem canônica de `ITEM_KINDS` e o `rngLoot` publica seu estado
(`rngL=`). A etiqueta de versão subiu de propósito — assim o golden reprova dizendo *formato
novo*, e não *divergência de simulação*.

Foi esta fase que motivou o [[ADR-008-oracle-derivado-do-engine]]: o oracle passou a ser
gerado do próprio engine, e o vanilla ficou congelado como peça histórica. A prova de que a
migração continua válida sobreviveu — [[golden-test]] explica como.

## O que quebra se mudar

- **Reordenar `DROPS` ou `ITEM_KINDS`** — muda o consumo do RNG e a ordem da bolsa no
  snapshot; toda semente jogada passa a cair diferente.
- **Sortear loot com `rngCombat`** — acopla sorte de despojo a dano; o determinismo do
  combate morre em silêncio.
- **Deslocar o drop para um tile livre** — parece gentileza e quebra a leitura de "morreu
  aqui, largou aqui"; além disso muda posição em toda semente.
- **Guardar material em `player.potions`** — a poção é consumível com regra própria; misturar
  os dois faz a bolsa curar.

Ver também: [[arquetipos-de-inimigo]] · [[semente-e-rng]] · [[determinismo]] ·
[[o-frasco-que-nao-tinha-gosma]] · [[2026-07-30-despojos-bolsa-e-itens-3d]]
