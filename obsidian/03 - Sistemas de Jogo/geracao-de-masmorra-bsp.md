---
tipo: nota
atualizado: 2026-07-28
tags: [mapgen, bsp, conectividade, determinismo, engine]
---

# 🗺️ Geração de masmorra por BSP

Arquivo único: `src/engine/mapgen.ts`. Entrada `(seedStr, depth)`, saída um `GameMap`
fechado — `tiles`, `decor`, `rooms`, `start`, `stairs`, `connectivity`, `walkable`,
`regenerations`, `repairs`, `notes`. Nada aqui lê relógio, DOM ou `Math.random`; ver
[[determinismo]].

## A árvore

`splitNode` (`src/engine/mapgen.ts:213`) divide recursivamente o retângulo interno do mapa
(`makeNode(1, 1, w-2, h-2, 0)` em `src/engine/mapgen.ts:514` — a moldura de parede externa
nunca é escrita). Os números são fixos e fazem parte do determinismo
(`src/engine/mapgen.ts:19-26`):

| Parâmetro | Valor |
|---|---|
| `MIN_LEAF` | 7 (folha mínima 7×7) |
| `MAX_BSP_DEPTH` | 5 |
| `MIN_ROOM` / `MAX_ROOM` | 5 / 13 |
| `SPLIT_MIN` / `SPLIT_MAX` | 0,35 / 0,65 |
| `WIDE_CORRIDOR_CHANCE` | 0,15 |
| `MAX_REPAIRS` | 3 por tentativa |

O eixo do corte não é sorteado quando o nó é claramente alongado: `w/h >= 1.25` corta na
vertical, `h/w >= 1.25` na horizontal, e só o caso quase-quadrado cai em `rng.chance(0.5)`
(`src/engine/mapgen.ts:224-230`). Isso evita salas em fita.

`collectLeaves` (`src/engine/mapgen.ts:248`) percorre esquerda antes de direita — e é essa
ordem que **define os `room.id`**. O id importa muito além da estética: o início do jogador
é o centro da sala de menor id (`src/engine/mapgen.ts:689-690`) e o desempate do
*largest remainder* do spawn é pelo menor id (ver [[arquetipos-de-inimigo]]).

## Os 5 formatos

`carveRoom` (`src/engine/mapgen.ts:288`) esculpe `rect`, `cross`, `round`, `pillared` e
`notched`. Cada um é um recorte diferente do retângulo da sala, não um tema visual:

- `cross` — duas faixas de largura ímpar (`Math.floor(rw/3) | 1`) cruzadas no centro.
- `round` — elipse inscrita, `dx² + dy² <= 1` normalizado.
- `pillared` — piso cheio e colunas em grade a cada 2 tiles, **exceto o tile central**.
- `notched` — piso cheio menos um canto (sorteado por `rng.int(0, 3)`), com o recorte
  limitado a `floor((lado-1)/2)` para nunca engolir o centro.

A invariante que sustenta os corredores está em `src/engine/mapgen.ts:364-366`: o centro da
sala é forçado a `FLOOR` no fim de `carveRoom`, sempre. É a boca por onde os corredores
entram. Se alguém remover essa linha "porque é redundante", `pillared` e `notched` podem
fechar o único ponto de conexão da sala e a conectividade despenca.

O sorteio dos formatos usa um **saco embaralhado** (`makeShapeBag`,
`src/engine/mapgen.ts:267`), não um `pick` independente: enquanto houver salas suficientes,
os cinco formatos aparecem. Salas pequenas (`< MIN_ROOM` em qualquer lado) só aceitam
`rect` — `shapeAllows` recusa o resto e o saco continua girando.

## Corredores entre folhas irmãs

`connectNode` (`src/engine/mapgen.ts:415`) liga **na volta da recursão**: desce até as
folhas, pega a sala representativa da subárvore esquerda e a da direita e cava um L entre
os dois centros. Depois sorteia qual das duas sobe como representativa deste nó
(`takeLeft`). Isso é o que garante que a árvore inteira fique costurada com
`folhas - 1` corredores, sem precisar de grafo nenhum.

`carveL` (`src/engine/mapgen.ts:400`) consome **três valores do RNG por corredor**: a chance
de largura 2 (15%), a ordem H→V ou V→H (`chance(0.5)`) e nada mais. O `put` interno só
converte `WALL` em `FLOOR` (`src/engine/mapgen.ts:374-378`) — corredor nunca reescreve
piso de sala nem toca a moldura externa.

## Por que 100% de conectividade é requisito

R15 exige que **todo tile caminhável seja alcançável a partir do início**. Não é enfeite
de gerador bonito: o jogo inteiro é construído sobre um único campo escalar. O mapa de
Dijkstra é calculado a partir do jogador e é a única fonte de navegação da IA
([[dijkstra-e-comportamento]]). Um tile caminhável isolado produz três defeitos em cadeia:

1. O spawn distribui inimigos e poções proporcionalmente à área das salas — uma sala numa
   ilha recebe cota e as criaturas dela ficam com `dmap = INF`, congeladas para sempre.
2. A escada é escolhida pela sala mais distante **em distância de grafo BFS**
   (`src/engine/mapgen.ts:744-756`); numa ilha ela seria inalcançável e a run travaria.
3. O percentual de exploração (`explorePct`) nunca fecharia, porque conta sobre todos os
   tiles não-parede.

Por isso a conectividade tem três linhas de defesa, nesta ordem:

**BFS** — `bfsFrom` (`src/engine/mapgen.ts:125`), 4-vizinhança, a partir de `start`.
`connectivity = reached / walkable`.

**Reparo por túnel** — `repairIsolated` (`src/engine/mapgen.ts:464`) rotula as regiões
(`labelRegions`, `src/engine/mapgen.ts:160`), pega a primeira região que não é a principal,
acha o par de tiles de menor distância de Manhattan entre as duas (`nearestPair`,
`src/engine/mapgen.ts:439`) e cava um L. Até 3 passadas por tentativa.

**Regeneração** — se ainda faltar, o mapa é descartado e refeito com semente derivada
`hash32(seed + '#' + d + '#retry' + n)`, até `CONFIG.MAX_REGEN` = 8
(`src/engine/core.ts:46`, laço em `src/engine/mapgen.ts:674-722`).

E há um quarto recurso que o contrato não pedia: `sealIsolated`
(`src/engine/mapgen.ts:573`) converte em parede tudo que sobrou fora da região principal
depois de esgotadas as 8 regenerações. O tile isolado deixa de existir em vez de continuar
contando como caminhável inalcançável — a conectividade fecha em 100% por definição, e a
nota registra quantos tiles foram selados. É a rede de segurança que faz o teste T1 (60
sementes × profundidades 1..3, `test/engine.test.ts:203`) nunca depender de sorte.

## O que quebra se mudar

- **Reordenar `SHAPES`, mexer num dos parâmetros da tabela acima ou trocar um `chance`
  por outro** muda o consumo do RNG e portanto *todos* os mapas de *todas* as sementes.
  O [[golden-test]] reprova em massa, não em um caso.
- **Trocar a ordem de `fork` em `buildLayout`** (`src/engine/mapgen.ts:502-511`: `bsp`,
  `rooms`, `corr`, `decor`, com um `u32()` do pai entre cada fork) tem o mesmo efeito.
  Ver [[semente-e-rng]].
- **Remover o `u32()` extra depois de cada fork** parece inofensivo e não é: o contrato do
  `fork` é que o pai avança exatamente um passo por derivação.

As `notes` do mapa (`src/engine/mapgen.ts:779-799`) viram entradas de registro classe
`sistema` assim que o estado é criado, então qualquer regeneração ou reparo fica visível
para o jogador — a conectividade em % também aparece no painel lateral
(`src/ui/panels/MapStats.tsx:49-51`, com destaque verde em 100%).

Ver também: [[campo-de-visao-shadowcasting]], [[turnos-e-progressao]],
[[_moc-sistemas-de-jogo]].
