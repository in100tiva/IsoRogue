# 2026-07-31 — NPC sólido nunca nasce numa garganta

**Regeneração deliberada do `test/golden/engine-snapshots.json`.**
Aprovada pelo dono antes de rodar. Motivo abaixo.

## O que aconteceu

O dono mandou a captura de tela: o **mercador plantado no único tile de saída da
sala inicial**, o herói trancado, a masmorra inteira do outro lado. Jogo parado
no turno 0.

Medindo, o caso não era azar de uma semente. Em **3000 andares** varridos (500
sementes × profundidades 1, 2, 3, 5, 8, 12):

| Medida | Resultado |
|---|---|
| andares com o mapa **partido** | **1041 (34,70 %)** |
| andares com a **escada inalcançável** | **425 (14,17 %)** |
| controle: os mesmos 3000 **sem os sólidos** | **0 partidos, 0 com escada presa** |

O controle é o que fecha a atribuição: água e `Tile.Void`, que também são
intransponíveis, já estavam cobertos pela garantia do gerador. **Toda** a quebra
vinha dos móveis de `populate()`.

A profundidade quase não mudava o quadro (d=1: 169/500; d=8: 198/500; d=12:
169/500) — não era andar apertado, era estrutural. Nos piores casos o herói ficava
com 20 a 90 tiles de um mapa de ~780: literalmente só a sala inicial.

## A causa

`tileDaEntrada` (`src/engine/entities.ts`) validava seis coisas — dentro do mapa,
caminhável, dentro da sala, longe do herói, não ser a escada, não estar tomado —
e **nenhuma delas era conectividade**.

O contrato já exigia a garantia, só que **no lugar errado do pipeline**: R15
("BFS ao final garantindo 100% dos tiles caminháveis conectados") e R16 vivem
dentro de `generate()`, em `mapgen.ts`. Os sólidos entram **depois**, em
`populate()`, e ninguém revalidava. O gerador cumpria o contrato; o povoador o
desfazia.

Dois agravantes que valem registro:

1. **A heurística de estética empurrava para a garganta.** `escolherCaldeirao`
   pontua `extras * 2 + encostado`, e `encostado` premia o tile com parede
   ortogonal ao lado — que é exatamente onde ficam portas e bocas de corredor. Por
   isso o filtro novo entra **antes** da pontuação, não depois.
2. **O maior ofensor era a decoração.** Os extras da alquimia trancaram sozinhos
   525 andares, contra 339 do mercador. Peças sem interação nenhuma fechando a
   masmorra.

## A correção

Duas camadas, porque uma só não basta:

1. **Pontos de articulação** (Tarjan iterativo — 2025 tiles estouram pilha em DFS
   recursivo), recalculados **a cada peça colocada**. Uma passada só no mapa
   pristino não resolve: a colocação é sequencial e 176 de 2400 andares (7,33 %)
   quebravam apenas pela **combinação** das peças. Recalculando por peça: 0 de
   2400.
2. **Cinto de segurança**: BFS final com todos os sólidos bloqueados; se partiu,
   poda em ordem de custo crescente (extras → caldeirão → mercador). Hoje nunca
   dispara, e fica para o dia em que um sólido novo entrar por outra porta.

A vizinhança do Tarjan é a **mesma do movimento**, com a regra de não-corte-de-
canto na diagonal. Com 8-direções ingênuo a garantia não se sustenta.

## Por que o oracle mudou

O filtro muda quais tiles são candidatos, então as peças mudam de lugar. **Doze
casos** do golden mudaram, e cada um foi verificado por força bruta — bloqueando a
instalação **antiga** e medindo o alcance a partir de `map.start`:

| Caso | Peça antiga | Tiles que ela tornava inalcançáveis |
|---|---|---|
| GOLD-0012 d=3 | extra (6,5) | **740** |
| GOLD-0006 d=5 | caldeirão (5,6) | **737** |
| GOLD-0003 d=4 | extra (11,7) | **727** |
| GOLD-0008 d=5 | extra (8,7) | 51 |
| GOLD-0009 d=4 | extra (6,6) | 32 |
| GOLD-0004 d=2 | caldeirão (6,4) | 5 |
| GOLD-0010 d=2 | extra (4,3) | 3 |
| GOLD-0001 d=3 | extra (4,3) | 1 |
| GOLD-0002 d=2 | caldeirão (8,2) | 1 |
| GOLD-0011 d=3 | **mercador** (3,4) | 1 |

**Nenhuma mudança é gratuita.** O baseline anterior estava congelando andares
partidos — três deles com o mapa praticamente inteiro atrás de uma peça de
decoração. Regenerar aqui não é "consertar vermelho": é parar de certificar um
defeito.

## Custo

Tarjan é **exato** contra a verdade medida por BFS: 0 falso positivo e 0 falso
negativo em 14.100 candidatos de 600 andares. E sai **11× mais barato** que
BFS-por-candidato — 1,945 ms/andar contra 7,687. Na suíte inteira, ~1,2 s a mais
sobre ~25 s.

Em **0 de 2400** andares faltou candidato seguro, então os invariantes duros de
T14.1 (mercador e caldeirão nunca ausentes) sobrevivem ao filtro: o conserto nunca
custa a instalação.

## A lição, para não repetir

> Toda garantia estrutural do mapa (conectividade, alcançabilidade) tem de ser
> revalidada **por quem coloca sólidos**, não só por quem gera o terreno. O gate
> que roda no meio do pipeline não protege o que entra depois dele.

Está registrada em `docs/METODO.md`.
