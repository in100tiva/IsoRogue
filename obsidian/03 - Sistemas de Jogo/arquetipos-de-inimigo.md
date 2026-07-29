---
tipo: nota
atualizado: 2026-07-28
tags: [ia, arquetipos, combate, spawn, engine]
---

# 👹 Arquétipos de inimigo

`src/engine/entities.ts`. Três arquétipos, uma tabela (`ARCHETYPES`,
`src/engine/entities.ts:50-96`), zero herança. `KINDS`
(`src/engine/entities.ts:99`) fixa a ordem de iteração — `Object.keys` na lógica de jogo é
proibido.

| | Perseguidor | Sentinela | Vinculador |
|---|---|---|---|
| chave | `chaser` | `sentinel` | `linker` |
| hp base | 12 | 9 | 14 |
| atk base | 4 | 3 | 5 |
| alcance | 1 | 6 | 1 |
| distância ideal | 1 | 4 | 3 |
| xp | 3 | 4 | 6 |
| peso base no spawn | 5 | 2 | 1 |
| forma | triângulo | hexágono | duplo-losango |

`fem` (`src/engine/entities.ts:53`, `:73`, `:84`) existe porque as mensagens do registro
são em pt-BR e precisam concordar: "A Sentinela foge ferida", "O Perseguidor foge ferido".
Os helpers `art`/`Art` (`src/engine/entities.ts:144-150`) devolvem só a vogal, o que serve
para artigo solto, contração (`d` + `a`) e particípio (`ferid` + `a`).

## A regra de cada um

Todos leem o **mesmo** `ctx.dmap` — ver [[dijkstra-e-comportamento]].

**Perseguidor** (`aiChaser`, `src/engine/entities.ts:669`). Se `cheb <= max(1, range)`,
ataca corpo a corpo; senão desce o gradiente. Sem sutileza: é o arquétipo que dá
previsibilidade ao encontro.

**Sentinela** (`aiSentinel`, `src/engine/entities.ts:690`). Distância ideal 4, com faixa
morta 3–5:

- `dist < 3` → recua pelo gradiente de fuga (`src/engine/entities.ts:700-721`). Se não há
  recuo possível e há linha de tiro, atira encurralada; senão `wait`.
- `dist > 5` **ou sem linha de visão** → aproxima pelo `dmap`
  (`src/engine/entities.ts:723`). O plano vira `'procura linha de tiro'` quando é a falta
  de LOS que a move.
- Dentro da faixa, com LOS e `dist <= range` (6) → dispara.

A LOS usa raio `max(ent.range, CONFIG.FOV_RADIUS)` = 9 (`src/engine/entities.ts:697`) e é o
`isVisibleFrom` simétrico do [[campo-de-visao-shadowcasting]]. Isso é o que impede o tiro
injusto: se ela te vê, você a vê.

Detalhe deliberado que economiza um bug de UX: o recuo tático **não** liga
`state = 'flee'`, liga `'hunt'` (`src/engine/entities.ts:710`). O estado `flee` fica
reservado à fuga por ferimento; senão o tooltip rotularia "em fuga" uma Sentinela com vida
cheia que só está mantendo posição.

**Vinculador** (`aiLinker`, `src/engine/entities.ts:797`). Só parte para o ataque quando
**outro** inimigo vivo está adjacente ao jogador *neste instante*
(`allyAdjacentToPlayer`, `src/engine/entities.ts:753` — Chebyshev ≤ 1). Sem aliado colado,
circula na faixa `LINK_MIN`..`LINK_MAX` = 2..3 (`src/engine/entities.ts:112-113`):

- `dist < 2` → afasta pelo gradiente de fuga;
- `dist > 3` → aproxima pelo `dmap`;
- dentro da faixa → `circleStep` (`src/engine/entities.ts:766`), que orbita o jogador
  usando o vetor perpendicular `(-vy, vx)`. O sentido da órbita vem da **paridade do
  `id`** (`src/engine/entities.ts:771`): par gira num sentido, ímpar no outro. É
  determinístico e, de quebra, dois Vinculadores no mesmo cerco não colam um no outro.

**Fuga por ferimento** (`fleeBehaviour`, `src/engine/entities.ts:642`) é transversal aos
três: `hp <= maxHp * WOUNDED_RATIO`, com `WOUNDED_RATIO` = 0,3
(`src/engine/entities.ts:110`), desvia o turno inteiro para descer o gradiente invertido.
Encurralado sem passo válido, o ferido ainda revida se o jogador estiver ao alcance
(`src/engine/entities.ts:653-664`) — `plan` vira `'ataca encurralado'`. Como não existe
cura no jogo, na prática ninguém sai de `flee` a não ser morrendo.

Esse 0,3 é o número que a mutação de teste alterou para 0,31 e o oráculo pegou no comando
94 de 200 — ver [[golden-test-precisa-ser-testado]].

## Resolução determinística de conflito de movimento

R40 (nunca dois inimigos no mesmo tile) e R41 (conflito resolvido de forma determinística)
são resolvidos por um protocolo de três partes, todo em `makeContext`
(`src/engine/entities.ts:615`) e `moveTo` (`src/engine/entities.ts:256`):

1. **Ordem fixa.** `alive` é ordenado por `id` crescente
   (`src/engine/entities.ts:626`) e `processEnemies` percorre nessa ordem
   (`src/engine/entities.ts:854`). O `id` é sequencial e atribuído na criação, em ordem
   determinística de spawn.
2. **`Set` de ocupação com o jogador dentro.** `occupied` começa com o tile do jogador e o
   de cada inimigo vivo (`src/engine/entities.ts:617-625`).
3. **Reserva imediata.** `moveTo` remove o tile antigo e adiciona o novo **no instante do
   movimento**, não no fim do turno. Quem anda primeiro reserva; quem vem depois vê o tile
   ocupado, `bestStep` recusa via `makeBlocker` (`src/engine/entities.ts:175`) e
   `gradientStep` cai no segundo melhor vizinho pela mesma ordem `DIRS8`. Se nada servir,
   `state = 'wait'`.

Note que os outros inimigos **não** entram como `blocked` no cálculo do campo
(`src/engine/game.ts:216`: `{ blocked: null }`). O campo é único e limpo; o bloqueio é
aplicado só na escolha do passo. Se os inimigos entrassem no campo, ele teria de ser
recalculado a cada movimento — 22 Dijkstras por turno, exatamente o que a arquitetura
evita.

## Spawn proporcional à área

`populate` (`src/engine/entities.ts:573`), com RNG próprio derivado de
`hash32(map.seed + '#pop#' + depth)` (`src/engine/entities.ts:575`, ver [[semente-e-rng]]).

```
inimigos = min(22, 4 + depth * 2)
poções   = max(1, 3 + ((depth * 7) % 3) - floor(depth / 4))
```

(`src/engine/entities.ts:579-580`.)

A distribuição usa **largest remainder** (`src/engine/entities.ts:380`): cota =
`área_da_sala / área_total × N`, parte inteira primeiro, sobras para as maiores frações, e
**empate de fração desempata pelo menor `room.id`** (`src/engine/entities.ts:405-408`). O
id vem da ordem de folhas do BSP, então o desempate é estável — ver
[[geracao-de-masmorra-bsp]].

Restrições, todas num único `Set taken` compartilhado entre inimigos e itens
(`roomCandidates`, `src/engine/entities.ts:421`): nunca sobre `start`, nunca sobre
`stairs`, nunca sobre outra entidade, nunca dentro de `CONFIG.SAFE_RADIUS` = 6 (Chebyshev)
do início, sempre em tile caminhável. Sala saturada devolve a cota, que migra para a
próxima sala por id e continua migrando enquanto houver progresso
(`src/engine/entities.ts:489-507`).

O sorteio do arquétipo é por peso, com reforço por profundidade
(`pickKind`, `src/engine/entities.ts:513`):

```ts
[ chaser.peso,                        // 5
  sentinel.peso + floor(depth / 2),   // 2 + …
  linker.peso  + floor(depth / 3) ]   // 1 + …
```

Ou seja, a masmorra fica progressivamente menos "corredor de Perseguidores" e mais tática
conforme desce.

Escalonamento (`makeEnemy`, `src/engine/entities.ts:530`):
`hp = base + floor(base * 0.15 * (depth-1))`, `atk = base + floor((depth-1) / 2)`.

## Combate

`rollDamage(rng, atk) = atk + rng.int(-1, 1)`, mínimo 1
(`src/engine/entities.ts:330`). Todo dano do jogo — do jogador e dos inimigos — consome
`game.rngCombat`, um stream único e sequencial (`src/engine/game.ts:318`). É isso que faz
"mesma semente + mesma sequência de comandos ⇒ mesmo resultado" valer também para o
combate.

Quando o golpe é fatal, quem sabe a autoria é a entidade, não o módulo de jogo: `attackPlayerInterno`
grava `game.causeKind = ent.kind` (`src/engine/entities.ts:358`) e o módulo de jogo monta a
frase de morte a partir dele — ver [[turnos-e-progressao]].

## O que quebra se mudar

- **Reordenar `KINDS`** — `pickKind` mapeia índice de peso para arquétipo por posição
  (`src/engine/entities.ts:526`); trocar a ordem troca as criaturas de todos os níveis.
- **Adiantar ou atrasar a reserva do `moveTo`** — dois inimigos no mesmo tile; T7 acusa
  (`test/engine.test.ts:448`).
- **Mudar `WOUNDED_RATIO`, os limiares 3/5 da Sentinela ou a faixa 2–3 do Vinculador** —
  divergência imediata no [[golden-test]].
- **Trocar `isVisibleFrom` por um teste de LOS próprio na Sentinela** — reintroduz o tiro
  assimétrico que o [[campo-de-visao-shadowcasting]] existe para eliminar.

Nota visual: os inimigos **não** migraram para o sistema de sprites do jogador; continuam
em formas geométricas (`TODO(inimigos-no-atlas)`, `src/render/IsoRenderer.ts:923`). Ver
[[sprite-forge]] e [[personagem-rig-3d]].

Ver também: [[dijkstra-e-comportamento]], [[turnos-e-progressao]],
[[_moc-sistemas-de-jogo]].
