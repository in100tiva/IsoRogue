---
tipo: nota
atualizado: 2026-07-29
tags: [ia, arquetipos, combate, spawn, engine]
---

# 👹 Arquétipos de inimigo

`src/engine/entities.ts`. Três arquétipos, uma tabela (`ARCHETYPES`,
`src/engine/entities.ts:50-96`), zero herança. `KINDS`
(`src/engine/entities.ts:99`) fixa a ordem de iteração — `Object.keys` na lógica de jogo é
proibido.

| | Perseguidor | Brutamontes | Vinculador |
|---|---|---|---|
| chave | `chaser` | `sentinel` | `linker` |
| hp base | 12 | 9 | 14 |
| atk base | 4 | 3 | 5 |
| alcance | 1 | 1 | 1 |
| distância ideal | 1 | 1 | 3 |
| xp | 3 | 4 | 6 |
| peso base no spawn | 10 | 1 | 100 |
| forma | triângulo | hexágono | duplo-losango |

`fem` (`src/engine/entities.ts:54`, `:69`, `:84`) existe porque as mensagens do registro
são em pt-BR e precisam concordar: "O Brutamontes foge ferido", "O Perseguidor foge
ferido". Hoje os três arquétipos são masculinos — a última feminina era a Sentinela,
aposentada em 2026-07-29 — mas o mecanismo fica: o próximo nome feminino não pode
exigir mudança estrutural. Os helpers `art`/`Art` (`src/engine/entities.ts:145-151`)
devolvem só a vogal, o que serve para artigo solto, contração (`d` + `a`) e particípio
(`ferid` + `a`).

## A regra de cada um

Todos leem o **mesmo** `ctx.dmap` — ver [[dijkstra-e-comportamento]].

**Perseguidor** (`aiChaser`, `src/engine/entities.ts:672`). Se `cheb <= max(1, range)`,
ataca corpo a corpo; senão desce o gradiente. Sem sutileza: é o arquétipo que dá
previsibilidade ao encontro.

**Brutamontes** (`aiSentinel`, `src/engine/entities.ts:693`). A mesma estrutura do
Perseguidor, deliberadamente: se `cheb <= max(1, range)` (alcance 1), esmaga corpo a
corpo com a marreta; senão desce o gradiente. Sem faixa morta, sem recuo tático, sem
tiro à distância e sem teste de linha de visão — a `aiSentinel` antiga (distância ideal
4, faixa 3–5, recuo, disparo a 6 tiles) foi reescrita em 2026-07-29 exatamente porque o
rosto do arquétipo é o Ogro, e um brutamontes de marreta que foge do jogador não se
sustentava (ver [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]]). O que o diferencia
do Perseguidor hoje são os números — hp 9 × 12, atk 3 × 4, xp 4 × 3 — e a raridade
(peso 1 × 10), não a tática.

**Vinculador** (`aiLinker`, `src/engine/entities.ts:757`). Só parte para o ataque quando
**outro** inimigo vivo está adjacente ao jogador *neste instante*
(`allyAdjacentToPlayer`, `src/engine/entities.ts:713` — Chebyshev ≤ 1). Sem aliado colado,
circula na faixa `LINK_MIN`..`LINK_MAX` = 2..3 (`src/engine/entities.ts:112-113`):

- `dist < 2` → afasta pelo gradiente de fuga;
- `dist > 3` → aproxima pelo `dmap`;
- dentro da faixa → `circleStep` (`src/engine/entities.ts:726`), que orbita o jogador
  usando o vetor perpendicular `(-vy, vx)`. O sentido da órbita vem da **paridade do
  `id`** (`src/engine/entities.ts:731`): par gira num sentido, ímpar no outro. É
  determinístico e, de quebra, dois Vinculadores no mesmo cerco não colam um no outro.

**Fuga por ferimento** (`fleeBehaviour`, `src/engine/entities.ts:645`) é transversal aos
três: `hp <= maxHp * WOUNDED_RATIO`, com `WOUNDED_RATIO` = 0,3
(`src/engine/entities.ts:110`), desvia o turno inteiro para descer o gradiente invertido.
Encurralado sem passo válido, o ferido ainda revida se o jogador estiver ao alcance
(`src/engine/entities.ts:656-667`) — `plan` vira `'ataca encurralado'`. Como não existe
cura no jogo, na prática ninguém sai de `flee` a não ser morrendo.

Esse 0,3 é o número que a mutação de teste alterou para 0,31 e o oráculo pegou no comando
94 de 200 — ver [[golden-test-precisa-ser-testado]].

## Resolução determinística de conflito de movimento

R40 (nunca dois inimigos no mesmo tile) e R41 (conflito resolvido de forma determinística)
são resolvidos por um protocolo de três partes, todo em `makeContext`
(`src/engine/entities.ts:618`) e `moveTo` (`src/engine/entities.ts:257`):

1. **Ordem fixa.** `alive` é ordenado por `id` crescente
   (`src/engine/entities.ts:630`) e `processEnemies` percorre nessa ordem
   (`src/engine/entities.ts:807`). O `id` é sequencial e atribuído na criação, em ordem
   determinística de spawn.
2. **`Set` de ocupação com o jogador dentro.** `occupied` começa com o tile do jogador e o
   de cada inimigo vivo (`src/engine/entities.ts:620-628`).
3. **Reserva imediata.** `moveTo` remove o tile antigo e adiciona o novo **no instante do
   movimento**, não no fim do turno. Quem anda primeiro reserva; quem vem depois vê o tile
   ocupado, `bestStep` recusa via `makeBlocker` (`src/engine/entities.ts:176`) e
   `gradientStep` cai no segundo melhor vizinho pela mesma ordem `DIRS8`. Se nada servir,
   `state = 'wait'`.

Note que os outros inimigos **não** entram como `blocked` no cálculo do campo
(`src/engine/game.ts:216`: `{ blocked: null }`). O campo é único e limpo; o bloqueio é
aplicado só na escolha do passo. Se os inimigos entrassem no campo, ele teria de ser
recalculado a cada movimento — 22 Dijkstras por turno, exatamente o que a arquitetura
evita.

## Spawn proporcional à área

`populate` (`src/engine/entities.ts:576`), com RNG próprio derivado de
`hash32(map.seed + '#pop#' + depth)` (`src/engine/entities.ts:578`, ver [[semente-e-rng]]).

```
inimigos = min(22, 4 + depth * 2)
poções   = max(1, 3 + ((depth * 7) % 3) - floor(depth / 4))
```

(`src/engine/entities.ts:582-583`.)

A distribuição usa **largest remainder** (`src/engine/entities.ts:381`): cota =
`área_da_sala / área_total × N`, parte inteira primeiro, sobras para as maiores frações, e
**empate de fração desempata pelo menor `room.id`** (`src/engine/entities.ts:406-409`). O
id vem da ordem de folhas do BSP, então o desempate é estável — ver
[[geracao-de-masmorra-bsp]].

Restrições, todas num único `Set taken` compartilhado entre inimigos e itens
(`roomCandidates`, `src/engine/entities.ts:422`): nunca sobre `start`, nunca sobre
`stairs`, nunca sobre outra entidade, nunca dentro de `CONFIG.SAFE_RADIUS` = 6 (Chebyshev)
do início, sempre em tile caminhável. Sala saturada devolve a cota, que migra para a
próxima sala por id e continua migrando enquanto houver progresso
(`src/engine/entities.ts:497-508`).

O sorteio do arquétipo é por peso, com reforço por profundidade
(`pickKind`, `src/engine/entities.ts:516`):

```ts
[ chaser.peso,                        // 10
  sentinel.peso + floor(depth / 2),   // 1 + …
  linker.peso  + floor(depth / 3) ]   // 100 + …
```

Os pesos base são 10/1/100 desde 2026-07-29 — "a cada 10 Slimes, 1 Goblin; a cada 10
Goblins, 1 Ogro". No nível 1 o Vinculador responde por ~90% dos encontros: a masmorra é
de slimes, com o Perseguidor de tempero e o Brutamontes de raridade. O reforço por
profundidade foi mantido, então Brutamontes e Vinculadores extras ganham terreno conforme
se desce — ver [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]].

Escalonamento (`makeEnemy`, `src/engine/entities.ts:533`):
`hp = base + floor(base * 0.15 * (depth-1))`, `atk = base + floor((depth-1) / 2)`.

## Combate

`rollDamage(rng, atk) = atk + rng.int(-1, 1)`, mínimo 1
(`src/engine/entities.ts:331`). Todo dano do jogo — do jogador e dos inimigos — consome
`game.rngCombat`, um stream único e sequencial (`src/engine/game.ts:318`). É isso que faz
"mesma semente + mesma sequência de comandos ⇒ mesmo resultado" valer também para o
combate.

Quando o golpe é fatal, quem sabe a autoria é a entidade, não o módulo de jogo: `attackPlayerInterno`
grava `game.causeKind = ent.kind` (`src/engine/entities.ts:359`) e o módulo de jogo monta a
frase de morte a partir dele — ver [[turnos-e-progressao]].

## O que quebra se mudar

- **Reordenar `KINDS`** — `pickKind` mapeia índice de peso para arquétipo por posição
  (`src/engine/entities.ts:528`); trocar a ordem troca as criaturas de todos os níveis.
- **Mudar os pesos base 10/1/100 ou o reforço por profundidade** — muda quem nasce em
  cada semente; divergência imediata no [[golden-test]].
- **Adiantar ou atrasar a reserva do `moveTo`** — dois inimigos no mesmo tile; T7 acusa
  (`test/engine.test.ts:448`).
- **Mudar `WOUNDED_RATIO` ou a faixa 2–3 do Vinculador** — divergência imediata no
  [[golden-test]].

Nota visual: os três arquétipos têm **rosto** — `chaser` é o Goblin, `linker` é o Slime
e `sentinel` é o Ogro (`RETRATOS`, `src/render/IsoRenderer.ts:262`). Nada disso é
comportamento, e arte nunca muda a tabela acima
([[ADR-007-monstro-e-aparencia-nao-arquetipo]]). A tabela mudou em 2026-07-29, mas por
decisão de design, não de arte: foi o dia em que a Sentinela virou Brutamontes — ver
[[2026-07-29-brutamontes-e-a-masmorra-de-slimes]]. O desenho geométrico desta seção
continua no código como rede de segurança para ambientes sem Canvas. Ver
[[bestiario-monstros]], [[sprite-forge]] e [[personagem-rig-3d]].

Ver também: [[dijkstra-e-comportamento]], [[turnos-e-progressao]],
[[_moc-sistemas-de-jogo]].
