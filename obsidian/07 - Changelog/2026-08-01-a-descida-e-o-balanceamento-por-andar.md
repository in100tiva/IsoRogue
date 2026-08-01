# 2026-08-01 — A descida: bússola da saída e balanceamento por andar

**Regeneração deliberada do `test/golden/engine-snapshots.json`.**
Aprovada pelo dono antes de rodar. Motivo abaixo.

## O que o dono pediu

Quatro coisas, numa frase só: *"encontrar o final da masmorra do primeiro andar e
descer para o próximo andar, com os níveis dos monstros aumentando em 1
consecutivamente; os goblins são mais comuns que os slimes agora, e na masmorra
de nível 3 os slimes já são raros."*

## O que a medição encontrou antes de mexer

A primeira parte do pedido não era um bug de mecânica — era de **descoberta**.
Medido em 200 andares do primeiro nível, antes de qualquer mudança:

| Medida | Resultado |
|---|---|
| escadas **inalcançáveis a pé** | **0 de 200** |
| distância Chebyshev início → escada | **média 30,2 · máximo 36** |
| `descend` recusado sobre o tile de escada | **nunca** |

Ou seja: a descida sempre funcionou (`>`, `Enter`, ou clique na escada), e o
portão de R15/R16 mais o filtro de articulação da fase anterior já garantiam
passagem. O que faltava era o jogador **saber para onde ir**: mapa de 45×45,
campo de visão de raio 9, escada a trinta tiles, e nenhum ponteiro em lugar
nenhum. É o mesmo defeito que criou a fase 2.1 dos pontos de parada, com as
mesmas palavras — *conteúdo que não se descobre é conteúdo que não existe*.

## O que mudou

### 1. A bússola da saída (`src/ui/panels/ExitPanel.tsx`)

Bloco novo no painel, logo depois dos Vitais: **direção** (o octante da grade,
com a tecla de movimento ao lado — `sudeste (C)`) e **passos** (o valor do campo
de Dijkstra do jogador no tile da escada, ou seja o caminho REAL, contornando
parede, água e vazio).

A tecla ao lado do nome não é enfeite: o mundo é desenhado em isométrico, então o
"norte" da grade não é o topo da tela. Quem lê a tecla não traduz nada.

Nenhuma informação nova entrou no jogo — o balão de criatura já mostrava valores
de Dijkstra desde o vanilla. Ela só deixou de estar escondida.

**Onde o bloco ficou, e por quê.** O lugar temático seria colado no "Estado do
mapa", no rodapé da barra. Seria enterrar a cura no mesmo armário do problema.
Para onde eu vou é decisão de turno, como quanta vida eu tenho.

### 2. O nível do monstro sobe um por andar

`nivelDoMonstro(kind, depth)` = nível do arquétipo + (andar − 1).

| andar | Slime | Goblin | Ogro |
|---|---|---|---|
| 1 | 1 | 2 | 3 |
| 2 | 2 | 3 | 4 |
| 3 | 3 | 4 | 5 |

É **função**, não campo de `Enemy` — o nível é derivável do par (arquétipo,
andar), e um campo novo entraria em `snapshot()`, no save e no oracle para
guardar uma conta de uma linha. Valor derivado que vira campo é valor que um dia
discorda da própria fórmula.

O efeito é a razão de ser da mudança: **descer passa a render XP**. Pela escala
de §15.2 (`100 × 2^(nivelMonstro − nivelHeroi)`), o mesmo bicho vale o dobro um
andar abaixo — e o corte de três níveis de diferença, que antes era uma parede
permanente, virou uma dívida que a próxima descida paga.

| | andar 1 | andar 2 | andar 3 |
|---|---|---|---|
| herói 2 mata slime | 50 | 100 | 200 |
| herói 4 mata slime | **0** (cortado) | 25 | 50 |

### 3. A mistura de spawn trocou de eixo: nível do herói → ANDAR

Era o nível do herói que dirigia `PESOS_SPAWN`. Na mão o efeito era o contrário
do que o papel prometia: quem descia sem matar levava a masmorra do andar 1 para
o andar 5, e quem subia de nível numa sala só via a fauna trocar sem sair do
lugar. O jogador lê o mundo pelo ANDAR.

Pesos novos (colunas em `KINDS` — goblin, ogro, slime) e a mistura medida em 40
sementes por andar:

| andar | pesos | goblin | ogro | slime |
|---|---|---|---|---|
| 1 | `[100, 1, 40]` | **69,6 %** | 0,8 % | 29,6 % |
| 2 | `[100, 15, 20]` | 72,8 % | 11,9 % | 15,3 % |
| 3 | `[60, 100, 8]` | 40,5 % | 53,3 % | **6,3 %** |
| 4+ | `[15, 100, 3]` | 16,0 % | 81,9 % | 2,1 % |

Os dois pedidos do dono, travados em teste: o goblin é mais comum que o slime em
**todo** andar da tabela, e no andar 3 o slime já é raro (6,3 %).

`heroLevel` sumiu de `populate()` e de `createState()`. Parâmetro que não muda
nada é pior do que nenhum — ele convida quem lê a acreditar que muda.

## O preço, medido

Um bot ingênuo (segue o gradiente até a escada, nunca bebe poção, nunca recua),
40 expedições no andar 1:

| | antes | depois |
|---|---|---|
| chegaram à escada | 29/40 | 26/40 |
| morreram no caminho | 10 (25 %) | **13 (32,5 %)** |
| desceram de andar | 29/29 | 26/26 |
| "Passos" subiu no trajeto | nunca | nunca |

O andar 1 ficou mais perigoso, e era inevitável: o Goblin (`chaser`) persegue e
bate; o Slime (`linker`) só ataca quando outro inimigo já está colado no jogador.
Trocar 90 % de slime por 70 % de goblin é trocar cenário por combate. O aumento
de 25 % para 32,5 % com um bot que **nunca usa poção nem foge** é um piso, não a
experiência do jogador.

## Por que o oracle mudou

Os arquétipos que nascem em cada semente mudaram — é literalmente o pedido. A
classificação da divergência, campo a campo nos 12 casos:

| Medida | Resultado |
|---|---|
| campos do snapshot inicial que divergiram | **só `E[…]`**, nos 12 casos |
| inimigos comparados | 96 |
| inimigos que mudaram de **id, x ou y** | **0** |
| inimigos que mudaram só `kind`/`hp` | 83 |
| `map=`, `agua=`, `I[…]`, `B[…]`, `M[…]`, `merc=`, `banc=`, `alq=`, `rng=`, `rngL=` | idênticos |

Zero posições movidas é a prova de que **nenhum u32 vazou**: `pickKind` continua
consumindo exatamente um `rng.int` por inimigo, dê no que der a linha de pesos.
A mistura nos 12 andares do oracle foi de `goblin 5,2 % · ogro 0,0 % · slime
94,8 %` para `goblin 59,4 % · ogro 29,2 % · slime 11,5 %`.

A mesma verificação foi feita no congelado de T17.5 (`test/engine.test.ts`), que
existe justamente para pegar roubo de stream: as seis linhas de `e` tiveram o
`kind` regravado e **as posições saíram idênticas, tile por tile**. `seco`, `it` e
`par` não se mexeram.

Uma segunda regeneração entrou no mesmo ato: a nota do gerador
`'Escada na sala #12 em (39,5), a 97 passos do início'` ganhou o qualificador
**"em quatro direções"**. Ela mede `bfsFrom` (quatro direções, mapa cru,
pré-água); o painel novo mede o campo de Dijkstra (oito direções, mapa final).
Os dois números aparecem na mesma tela e nunca batem — duas medidas com o mesmo
nome viram, invariavelmente, um relato de bug.

## O bug que o teste novo pescou

Escrever o caso "sobre a escada, `>` desce" acendeu um aviso do React que
ninguém tinha visto: **`Encountered two children with the same key: abate-chaser`**.

`QuestPanel` usava `m.key` como chave de lista, e `MissaoKey` **não é única por
partida** — está escrito no próprio tipo (`types.ts`). As caçadas são geradas por
andar e atravessam a descida, então uma `abate-chaser` do andar 1 convive com a
do andar 2. O aviso era inalcançável enquanto ninguém descia; a partir desta
fase, é o caminho comum.

Corrigido para o **índice**, que aqui é a identidade real: a lista é append-only
na ordem de geração (`descend` concatena, nunca reordena nem remove).

## Lição

**Mecânica que funciona e ninguém acha é mecânica que não existe.** A descida
estava certa em 200 de 200 andares medidos e o dono ainda assim não conseguia
descer. O gate do projeto prova o engine; ele não prova que a informação chegou
ao jogador. Da próxima vez que uma fase entregar um sistema, a pergunta a fazer
antes de fechar é: **em que pixel da tela isto aparece?**

E o corolário: **um número novo na tela obriga a reler os números velhos.** A
bússola não teria custado nada além de si mesma se a nota do gerador não
estivesse usando a mesma palavra — "passos" — para outra medida.
