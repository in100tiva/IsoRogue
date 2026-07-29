---
tipo: changelog
atualizado: 2026-07-29
tags: [changelog, arquetipos, balanceamento, spawn, golden]
---

# 📆 29/07/2026 — Brutamontes e a masmorra de slimes

Primeira fase de comportamento desde a migração — e, com ela, a **primeira regeneração
deliberada do oracle** da história do projeto. O `sentinel` deixou de ser a Sentinela
atiradora e virou o Brutamontes corpo a corpo, e a distribuição de spawn virou de
cabeça para cima: a masmorra agora é dos slimes.

---

## O que mudou

**A Sentinela virou o Brutamontes.** O arquétipo `sentinel` era o atirador tático:
alcance 6, distância ideal 4, faixa morta 3–5, recuava pelo gradiente de fuga quando o
jogador chegava perto e disparava à distância com linha de visão. A `aiSentinel`
(`src/engine/entities.ts:693`) foi reescrita com **exatamente a estrutura de `aiChaser`**:
se `cheb <= max(1, range)` — agora 1 — esmaga corpo a corpo com a marreta; senão desce o
gradiente. Sem recuo tático, sem tiro, sem teste de LOS. Em `ARCHETYPES`: nome
`'Brutamontes'`, `fem: false`, `range: 1`, `ideal: 1`, `peso: 1`, descrição nova. Em
`src/engine/game.ts`: `NOMES.sentinel = 'Brutamontes'`, `FEMININO.sentinel = false` — os
três arquétipos são agora masculinos, e o mecanismo de concordância `art`/`Art` fica
dormente, mas de pé.

**Os pesos de spawn passaram de 5/2/1 para 10/1/100** — "a cada 10 slimes 1 goblin, a
cada 10 goblins 1 ogro". No nível 1 o Slime (`linker`) responde por **~90%** dos
encontros, contra 13% antes; o Goblin virou tempero (~9%) e o Ogro, raridade (~1%). O
reforço por profundidade de `pickKind` (`+floor(depth/2)` para `sentinel`,
`+floor(depth/3)` para `linker`) foi **mantido** — Brutamontes e Vinculadores extras
ganham terreno conforme se desce.

## Por quê — os três relatos do dono

Três queixas de jogo real, todas rastreadas até esta fase:

- **"O Ogro corre de mim."** Era o recuo tático da Sentinela — um brutamontes de 24u,
  o maior sprite do jogo, fugindo do jogador. A dívida estava registrada por extenso em
  [[ADR-007-monstro-e-aparencia-nao-arquetipo]] como "encaixe forçado assumido", com
  revisão marcada para esta fase. Resolvido: ele agora persegue e martela de perto.
- **"Nunca vejo o Slime."** Com peso 1 em 8, cerca de 45% das sementes não tinham slime
  nenhum no nível 1 — o bicho de encaixe mais natural era o mais raro. Resolvido pelos
  pesos 10/1/100.
- **"O herói perde vida conforme anda."** Auditoria confirmou que **não existe** drain de
  hp por passo: a única fonte de dano ao jogador é `attackPlayerInterno`. O que acontecia
  era a Sentinela atirando de 6 tiles de distância a cada turno enquanto o jogador
  atravessava a sala — dano "por andar", na percepção de quem joga. Resolvido de
  passagem: sem atirador, não há mais dano à distância.

## Como foi feito

O fluxo é o que [[ADR-003-golden-test-como-oracle-da-migracao]] prescreve para mudança
intencional de comportamento, executado pela primeira vez:

1. **Engine e vanilla espelhados.** `legacy/isorogue-vanilla.html` — congelado desde a
   migração — recebeu as **mesmas edições**, mesma lógica e mesmas strings, para
   continuar sendo a fonte da verdade do oracle.
2. **Oracle regenerado de propósito.** `node tools/gen-golden.mjs` regravou
   `test/golden/snapshots.json` a partir do vanilla atualizado.
3. **`npm run check` verde, 73/73** — golden 12/12 incluído.

Não foi "o teste ficou vermelho e eu regenerei": foi o comportamento que mudou de
propósito, com o dono sabendo, e o oracle acompanhando. A nota de [[golden-test]]
registra o precedente.

## O que NÃO mudou

- **Stats de arquétipo:** hp 9, atk 3, xp 4 do `sentinel` — e todos os números de
  `chaser` e `linker` — seguem byte a byte.
- **`PLAYER_BASE 42/7/3` e `POTION_HEAL`** intocados.
- **Fuga por ferimento** (`WOUNDED_RATIO` = 0,3) continua transversal aos três: o
  Brutamontes ferido foge como qualquer um.
- A **animação** do Ogro não foi revista — o rig e o atlas são os mesmos da fase de arte.

## O que ficou pendente

- **"O jogo é agressivo demais" permanece.** É o insumo que sobra da conversa de
  balanceamento: num teste de 3.000 comandos, 1.144 de dano recebido contra 90 causados.
  A próxima fase é a metade dos números — `PLAYER_BASE`, `POTION_HEAL`, hp/atk, curva por
  profundidade — e cada um deles pede nova regeneração deliberada do oracle.
- **A animação de ataque do Ogro é um arremesso** (`ARCO_GOLPE_OGRO`), concebida para
  justificar um ataque à distância que não existe mais. Visualmente hoje ele "arremessa"
  a um tile de distância. Rever é decisão de arte, para a fase de animação.

---

Ver [[arquetipos-de-inimigo]], [[ADR-007-monstro-e-aparencia-nao-arquetipo]],
[[golden-test]], [[2026-07-28-o-bestiario-goblin-slime-ogro]] e
[[estado-atual-e-proximos-passos]].
