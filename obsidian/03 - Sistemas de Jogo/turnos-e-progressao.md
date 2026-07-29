---
tipo: nota
atualizado: 2026-07-28
tags: [turnos, progressao, morte-permanente, engine, estado]
---

# ⏳ Turnos e progressão

`src/engine/game.ts`. É o módulo que orquestra: recebe comando, decide se ele consumiu o
turno e, se consumiu, resolve a fase pós-ação inteira. Puro — sem DOM, sem `requestAnimationFrame`,
sem relógio. Ver [[camadas-e-fronteiras]].

## O que consome turno

`applyCommand` (`src/engine/game.ts:499`) aceita quatro comandos:

| Comando | Consome turno quando |
|---|---|
| `move` | o passo foi aceito **ou** virou ataque |
| `wait` | sempre |
| `use` | havia poção **e** a vida não estava cheia |
| `descend` | o jogador está sobre a escada |

Recusas devolvem `false` e **não** avançam o turno — mas escrevem no registro
(`'Você não tem poções.'`, `'Sua vida já está completa.'`, `'Não há escada aqui.'`). Por
isso o `store.dispatch` emite quando o turno foi consumido **ou** quando a última entrada
do registro mudou (`src/engine/store.ts:119-126`): no vanilla o próprio `logMsg` anexava a
linha ao DOM, então a recusa aparecia no ato.

Regras de detalhe que o `mover` implementa (`src/engine/game.ts:419`):

- Mover para tile com inimigo **é** atacar, e o ataque é testado antes do corte de canto
  em diagonal (`src/engine/game.ts:426-434`).
- Pisar em item recolhe automaticamente (`pegarItem`, `src/engine/game.ts:394`).
- Pisar na escada **não** desce: escreve um aviso e espera o comando `descend`
  (`src/engine/game.ts:446-449`).
- Entrar numa sala nova narra `'Você entra na sala N (formato).'`; corredores ficam
  silenciosos de propósito (`narrarSala`, `src/engine/game.ts:409`) — um registro por passo
  viraria ruído em 400 linhas.

Também em `move`, e só nele, o `player.facing` é atualizado a partir da **intenção**
(`src/engine/game.ts:516-517`): o guerreiro se vira mesmo quando o passo é barrado por
parede. `wait`, `use` e `descend` não mexem no olhar. Campo cosmético, invisível ao
oráculo — ver [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

## A ordem do endTurn

`endTurn` (`src/engine/game.ts:623`) é rígida:

1. `turn += 1`.
2. **Dijkstra** único recalculado a partir do jogador (`computeDmap`), e
   `game.fleeMap = null` para forçar recálculo preguiçoso do gradiente de fuga.
3. **Inimigos** — `processEnemies`, em ordem de `id` crescente
   ([[arquetipos-de-inimigo]]).
4. **FOV** — `atualizarFov`, que também marca `explored`.
5. **Estatísticas** — `updateStats`, incluindo `explorePct` (fração dos tiles não-parede já
   vistos, arredondada a uma casa).
6. **Morte permanente ou autosave.**

A ordem 2→3 é o coração da arquitetura: o campo é calculado **uma vez**, antes de qualquer
inimigo andar, e todos leem o mesmo. Se o Dijkstra fosse recalculado por inimigo, cada
criatura veria um mundo diferente e o determinismo dependeria da ordem de avaliação.

Duas redes de segurança pós-`processEnemies` (`src/engine/game.ts:646-654`): se o jogador
perdeu vida mas `stats.dmgTaken` não subiu, a contabilidade é feita aqui; se nada foi
narrado, a narração de fallback (`narrarInimigos`) entra. São compensações para o caso de
um caminho de IA esquecer de registrar — não removem a responsabilidade do módulo de
entidades.

`applyCommand` protege `endTurn` com uma trava de **reentrância**, não de chamador
(`src/engine/game.ts:534-545`): `g.emTurno` impede que um `endTurn` disparado de dentro do
próprio turno resolva o turno duas vezes. Chamado de fora, `endTurn` continua fazendo a
fase completa que o contrato promete.

## Morte permanente

`hp <= 0` no fim do turno chama `matarJogador` (`src/engine/game.ts:596`), que:

- fixa `over = true` (`applyCommand` recusa **qualquer** comando depois disso,
  `src/engine/game.ts:500`);
- monta `game.cause` a partir de `causeKind` — o arquétipo que desferiu o golpe fatal,
  gravado pelo módulo de entidades no instante do golpe. `acharAlgoz`
  (`src/engine/game.ts:571`) é só o palpite de reserva (menor `id` em estado `attack`), e
  num turno com vários atacantes pode não ser o autor;
- grava a run no histórico e **apaga o autosave**.

`restore` recusa retomar uma run morta (`src/engine/game.ts:873`: `if (obj.over) return null`).
Morte permanente é permanente nas duas pontas — o save some e, mesmo que sobrasse, não
seria aceito.

Detalhe fácil de perder: sobreviver ao turno zera `causeKind`
(`src/engine/game.ts:668`), para que a autoria de um golpe quase fatal não sobre para a
morte seguinte.

## Descida de nível

`descend` (`src/engine/game.ts:678`) **muta o mesmo objeto `Game`** — é `createState` que
devolve objeto novo. Essa distinção é o sinal que a UI usa para saber que a *expedição*
trocou (`src/ui/panels/SeedPanel.tsx:75-80`).

O que acontece ao descer:

- mapa e população regerados por `(mesma seed, depth + 1)` — a seed nunca muda dentro de
  uma run;
- `rngCombat` recriado com `hash32(seedStr + '#combat' + depth)`
  (`src/engine/game.ts:689`) — cada nível tem seu stream de combate;
- `explored` zerado, `visible` zerado, `dmap`/`fleeMap` invalidados;
- `maxHp += 2` e `hp += 2` limitado ao teto (`HP_POR_DESCIDA`, `src/engine/game.ts:57`);
- `stats` **acumulam** entre níveis; só `deepest` sobe.

## Escalonamento de dificuldade

Duas alavancas, ambas em função de `depth`:

**Quantidade e força dos inimigos** — `min(22, 4 + depth*2)` criaturas,
`hp = base + floor(base * 0.15 * (depth-1))`, `atk = base + floor((depth-1)/2)`, e pesos de
sorteio que favorecem Sentinela e Vinculador conforme desce
(`src/engine/entities.ts:513-528`). Detalhes em [[arquetipos-de-inimigo]].

**Recursos** — poções no chão `max(1, 3 + ((depth*7) % 3) - floor(depth/4))`: a fórmula
oscila e depois seca.

Do lado do jogador, duas curvas somam:

- descer: `maxHp += 2`;
- nível de experiência: `xp >= level * 10` (`XP_POR_NIVEL`, `src/engine/game.ts:56`) sobe o
  nível, `maxHp += 4`, cura 4 e `atk += 1` (`ganharXp`, `src/engine/game.ts:352`). O xp por
  abate vem do arquétipo (3 / 4 / 6).

Base do jogador: 42 de vida, 7 de ataque, 3 poções (`PLAYER_BASE`,
`src/engine/game.ts:53`); poção cura 12 (`POTION_HEAL`, `src/engine/entities.ts:561` — a
constante mora no módulo dono do item, e é a mesma que `item.heal` carrega, para que o
item nunca minta sobre o que faz).

O balanceamento foi calibrado **contra bot, nunca contra humano**: num teste de 3.000
comandos o jogador tomou 1.144 de dano e causou 90. O número diz que o piloto automático
morre; não diz que um jogador humano morre. Isso continua sem medição.

## Snapshot

`snapshot` (`src/engine/game.ts:730`) é o resumo textual determinístico: versão, seed,
depth, turn, `over`, posição/vida/atributos do jogador, cada inimigo por id, cada item por
id, as estatísticas, o **estado do `rngCombat`** e um checksum FNV-1a dos `tiles`. É essa
string que o [[golden-test]] compara byte a byte contra o oráculo vanilla. O que não entra
nela não é regra de jogo — foi por essa porta que o `facing` passou
([[ADR-005-facing-cosmetico-invisivel-ao-oracle]]).

Ver também: [[semente-e-rng]], [[determinismo]], [[_moc-sistemas-de-jogo]].
