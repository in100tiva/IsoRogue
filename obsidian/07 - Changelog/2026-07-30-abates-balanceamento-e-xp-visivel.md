---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, mortes, balanceamento, xp, render, engine, ui]
---

# 📆 30/07/2026 — Cinemáticas de abate, balanceamento e XP visível

Três fases num dia só, e a primeira que **mexe no engine de propósito** desde a migração.
Na ordem em que aconteceram: os monstros aprenderam a morrer em cena (fase de render, sem
uma linha de engine), o jogo ganhou níveis de monstro, XP em escala e spawn por nível do
herói (fase de engine, com a segunda regeneração deliberada do oracle da história), e o XP
ficou visível no mundo e no painel (texto flutuante 3D + HUD).

---

## 1. As mortes do bestiário (`docs/BESTIARIO.md` §14)

Cada monstro ganhou uma sequência de morte própria e deixa um **rastro persistente** no
tile pelo resto do andar — quem passar depois sabe QUEM morreu ali:

| Monstro | Sequência | RASTRO |
|---|---|---|
| **Goblin** (1,1 s) | sangue cresce → cimitarra cai girando e **some** → corpo desaba (parado → agachado → caído) | **o CORPO** na poça de sangue |
| **Ogro** (1,7 s) | sangue maior → marreta cai e **pousa na poça** → corpo desaba e **esmaece até sumir** | **a MARRETA** na poça de sangue |
| **Slime** (1,0 s) | geleia cresce → derrete em 3 estágios de geometria (achatou → desabou → poça) | **a GELEIA** com a bolinha âmbar afogada, **acesa no escuro** |

A técnica é a da cinemática de morte do guerreiro ([[2026-07-29-cinematicas-do-guerreiro]]),
generalizada: poses/estágios congelados na coluna `parado/0` de atlases secundários, queda
da arma por rotação de tela, poças como decalques com respingos de LCG semeado pelo tile,
tudo modulado pela luz do tile (as emissivas atravessam acesas). O gatilho é **observação**:
diff de ids entre quadros (double-buffer de `Set`s) — a única via de saída de
`game.enemies` é o golpe fatal. **Zero mudança de engine**: `npm run check` ficou verde sem
tocar o oracle.

O desvio honrado: o Slime não derrete por pose (repouso só rotaciona nós) — derrete por
**variantes de modelo** (`criarModeloSlimeDerretido`), o molde de
`criarModeloGuerreiroSemEspada` aplicado a geometria que se deforma.

A bancada ganhou a faixa "cinemática de morte — as fases congeladas" nos quatro
personagens (tabela `MORTE_PREVIEW` de `tools/preview-entry.ts`); a folha do guerreiro saiu
**idêntica** à de antes, que era a prova exigida pela generalização.

## 2. Balanceamento (`docs/BESTIARIO.md` §15)

A conversa que a §10 do bestiário reservava, feita com o dono. Detalhe por extenso em
[[niveis-xp-e-spawn]]; o resumo:

- **Níveis de monstro**: Slime 1, Goblin 2, Ogro 3 — campo `nivel` no arquétipo,
  **substituindo** `xp` e `peso` (abolidos).
- **XP em escala**: `100 × 2^(nivelMonstro − nivelHeroi)`, cortada a zero com 3 níveis de
  diferença — 100 no mesmo nível, **200/400 acima** (decisão do dono: recompensa o risco),
  50/25/0 abaixo.
- **100 XP plano por nível**, para qualquer nível (antes: `level × 10`), com o
  **excedente carregado** (decisão do dono: um ogro de 400 xp rende 4 níveis).
- **Spawn por nível do herói**: `populate(map, depth, heroLevel)` — 10/1/100 no nível 1
  (a masmorra dos slimes) até 15/100/3 no 4+ (ogros comuns, slimes raríssimos). A
  profundidade segue endurecendo contagem e hp/atk; saiu só da mistura.

**O processo foi o da Emenda, pela segunda vez**: vanilla congelado espelhado com as
mesmas edições → `npm run golden` (oracle regenerado **deliberadamente**) →
`npm run check` verde. O golden reprovou 34/49 quando a mudança chegou — exatamente o
trabalho dele — e voltou a 49/49 depois da regeneração. Teste novo **T11** cobre a
tabela, os níveis, a distribuição real de spawn e a escala de XP inteira.

## 3. O XP visível (`docs/BESTIARIO.md` §16)

A escala nasceu cega: o XP só existia no registro textual, e o "NÍVEL" do cabeçalho —
sempre foi a profundidade — era lido como o nível do herói ("matei vários e o nível
continuou em 1", reportou o dono). Duas curas:

**O texto flutuante.** Um "+100" dourado sobe do tile do abate (~1,1 s, ease-out, esmaece
no último terço), em **rig de caixas** (`characters/xpTexto.ts`): cada pixel de uma fonte
3×5 vira um cubo de ouro isométrico. Duas peças novas dignas de nota:

- a fila `game.abatesRecentes` — campo APENAS-animado no estatuto de `ent.bump` (fora de
  `snapshot()`, do save e do oracle), porque o XP certo só existe **antes** do level-up
  que o próprio golpe pode causar;
- a **pré-distorção de outdoors** — texto deitado no plano X-Z cisalha ~26° e vira
  emaranhado (rodada 1 reprovada na bancada); os passos-modelo `(e, −e, 0)` e
  `(−f, −f, 2f)` endireitam a grade na tela. Lição completa em
  [[texto-em-isometrica-cisalha]].

**O painel.** O cabeçalho agora diz o que cada número é: **ANDAR** (profundidade) ×
**TURNO** × **NÍVEL** (do herói, de verdade) × **XP** (`xp/100` + barra âmbar). Ids novos
`#hud-heroi-nivel`, `#hud-xp`, `#hud-xp-barra`; os antigos intactos, teste de UI cobrindo
todos.

## Verificação

- `npm run check` verde: fronteiras, typecheck (src e tools), **74/77** — golden 49/49,
  UI 12/12, engine 13/16. As 3 falhas de `engine.test.ts` são **pré-existentes do ambiente
  Windows** (`find`/`npx` ausentes para o spawn do teste — confirmado falhando igual no
  repositório intacto via `git stash`).
- Bancadas revisadas em rodadas: mortes do goblin/slime/ogro aprovadas, folha do guerreiro
  idêntica, e o texto de XP aprovado na segunda rodada (a primeira expôs o cisalhamento).

## O que NÃO mudou

- Os bônus de status por nível (+4 maxHp, +1 atk) — é a **próxima conversa**, marcada pelo
  dono ("depois vamos abordar o que cada nível vai dar").
- O tempero de animação dos vivos (`ANIMACAO_*` sem consumidor, `TODO(tempero-goblin)`) —
  continua de pé, e continua sendo outra fase.
- `stats` de morte, save, `snapshot()` e o formato do oracle.

---

Ver [[niveis-xp-e-spawn]], [[bestiario-monstros]], [[texto-em-isometrica-cisalha]],
[[2026-07-29-cinematicas-do-guerreiro]] e [[estado-atual-e-proximos-passos]].
