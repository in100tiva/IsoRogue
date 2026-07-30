---
tipo: nota
atualizado: 2026-07-30
tags: [balanceamento, xp, niveis, spawn, engine]
---

# 📊 Níveis de monstro, XP em escala e spawn por nível do herói

`docs/BESTIARIO.md` §15. A fase de balanceamento que a §10 do bestiário reservava, feita
com o dono e com a **segunda regeneração deliberada do oracle** da história do projeto —
o rito já documentado em [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]]: mudança
espelhada no vanilla congelado → `npm run golden` → `npm run check` verde.

## Os níveis dos monstros

Cada arquétipo declara `nivel` (`src/engine/entities.ts:50`) — dado do ARQUÉTIPO, não da
entidade: `Enemy` continua com os mesmos campos de sempre.

| Monstro | Arquétipo | `nivel` |
|---|---|---|
| Slime | `linker` | 1 |
| Goblin | `chaser` | 2 |
| Ogro | `sentinel` | 3 |

`nivel` **substituiu** os campos `xp` e `peso`, abolidos na mesma fase: o XP deixou de
ser um valor fixo por arquétipo e o peso de spawn saiu da tabela para uma régua por
nível do herói. Os dois conceitos passaram a nascer de um número só.

## O XP do abate, na escala do dono

`xpPorAbate` (`src/engine/game.ts:358`):

```
xp = 100 × 2^(nivelMonstro − nivelHeroi)     — zero quando nivelHeroi ≥ nivelMonstro + 3
```

| herói \ monstro | slime | goblin | ogro |
|---|---|---|---|
| 1 | 100 | **200** | **400** |
| 2 | 50 | 100 | 200 |
| 3 | 25 | 50 | 100 |
| 4 | **0** | 25 | 50 |
| 5 | 0 | **0** | 25 |
| 6 | 0 | 0 | **0** |

Duas decisões **do dono**, registradas porque mudariam o jogo se fossem outras:

- **dobra por nível ACIMA** (200/400): matar bicho mais forte recompensa o risco. A
  alternativa recusada era teto em 100 — um ogro morto no nível 1 valer o mesmo que um
  slime;
- **o excedente CARREGA**: cruzar 100 sobe o nível e o resto fica. A alternativa
  recusada era zerar sempre — um ogro de 400 xp renderia um nível só e descartaria 300.

## Nível do herói: 100 XP plano

`XP_POR_NIVEL = 100` para **qualquer** nível (`src/engine/game.ts:56`) — antes era
`level × 10`, curva que apertava a progressão conforme subia. Com a régua plana e a
escala acima, matar o bicho do próprio nível rende exatamente um nível a cada abate;
matar abaixo rende frações; matar acima rende níveis em bloco.

Os bônus por nível (+4 maxHp, +4 hp, +1 atk) ficaram **inalterados** — o que cada nível
dá em status é a conversa seguinte, marcada pelo dono.

## A mistura de spawn, pelo nível do herói

`populate(map, depth, heroLevel)` (`src/engine/entities.ts:599`) — assinatura nova; o
terceiro argumento dirige `pickKind` via `PESOS_SPAWN` (`src/engine/entities.ts:512`),
uma linha por degrau do herói, colunas em `KINDS` (chaser/sentinel/linker):

| herói | goblin | ogro | slime | leitura |
|---|---|---|---|---|
| 1 | 10 | 1 | 100 | a cada 10 slimes, 1 goblin; a cada 10 goblins, 1 ogro |
| 2 | 100 | 10 | 30 | goblins dominam; ogros aparecem; slimes recuam |
| 3 | 40 | 100 | 10 | ogros dominam; slimes raros |
| 4+ | 15 | 100 | 3 | ogros comuns, goblins em minoria, slimes raríssimos |

A linha 4 é a **régua de todos os níveis seguintes**: com XP plano o herói pode subir
indefinidamente e a mistura estabiliza no estado final descrito pelo dono.

O que a profundidade **continua** fazendo (intocado): a **contagem** de inimigos
(`min(22, 4 + depth×2)`) e o **hp/atk** de cada um (`makeEnemy`). Ela saiu só da
mistura — antes um `+ depth/2` e `+ depth/3` reforçava dois arquétipos.

Os pontos de chamada, todos com o nível certo: `createState(seedStr, depth, heroLevel)`
(1 numa expedição nova; o nível salvo numa retomada — `restore` lê `player.level` do
save ANTES de chamar, `src/engine/game.ts:885`) e `descend` (o nível atual).

## O feedback da escala

A escala nasceu visível em dois lugares (§16, ver [[bestiario-monstros]] e
[[2026-07-30-abates-balanceamento-e-xp-visivel]]):

- o **registro do abate** mostra o XP: `(+100 xp)` ou `(sem xp — monstro muito abaixo
  do seu nível)`;
- o **texto flutuante 3D** sobe do tile do abate com o valor, via fila visual
  `game.abatesRecentes` — campo APENAS-animado, fora de `snapshot()`, do save e do
  oracle, no estatuto de `ent.bump` ([[ADR-005-facing-cosmetico-invisivel-ao-oracle]]).

E o painel diz o que cada número é: **ANDAR** (profundidade — o antigo "Nível",
rotulado por engano desde o vanilla) × **NÍVEL** (do herói) × **XP** (`xp/100`, barra
âmbar).

## O que quebra se mudar

- **Mexer em `PESOS_SPAWN`, na fórmula de XP ou em `nivel` sem regenerar o oracle** — o
  golden reprova apontando o comando e o snapshot. O rito é: espelhar no vanilla →
  `npm run golden` → check verde. Fazer na mão inversa (engine novo diferente do
  vanilla) deixa o oracle mentindo para os dois lados.
- **Chamar `populate` sem o nível do herói** — o TypeScript acusa; em JS puro (harness
  vanilla) `pesosSpawn` faz clamp para a linha 1 e a mistura sai de iniciante em qualquer
  ponto da run.
- **Teste T11** (`test/engine.test.ts`) cobre a tabela, os níveis, a distribuição real
  de spawn por nível e a escala de XP inteira (100/50/25/0 abaixo, 200/400 acima, o
  threshold plano e o excedente carregado). Mexeu nesses números? É ele que fala
  primeiro — depois o golden.

Ver também: [[arquetipos-de-inimigo]], [[turnos-e-progressao]], [[golden-test]],
[[_moc-sistemas-de-jogo]].
