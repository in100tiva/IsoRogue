---
tipo: adr
atualizado: 2026-07-28
tags: [testes, migracao, oracle, determinismo]
---

# 🥇 ADR-003 — Congelar o vanilla e usá-lo como oracle

**Status:** aceita · o teste mais importante do projeto nesta fase

## Contexto

O jogo nasceu em JavaScript vanilla puro — um HTML montado por concatenação de sete
arquivos (`legacy/src-vanilla/00-core.js` … `70-game.js`) — e foi migrado para
React 19 + TypeScript no mesmo dia.

Migração é o tipo de mudança em que "parece igual" não vale nada. FOV, Dijkstra, ordem de
consumo do RNG de combate, textos de log em pt-BR, arredondamento de dano: qualquer um
desses pode divergir de um jeito que só aparece na décima partida, e aí ninguém sabe se a
diferença é bug novo ou comportamento antigo mal lembrado.

O contrato da fase foi explícito: **migração pura — zero feature nova, zero mudança de
balanceamento, zero "melhoria"** — e a fidelidade tinha de ser *provada por teste, não por
opinião* (`docs/ARQUITETURA-REACT.md:4-6`).

## Decisão

A versão vanilla **não é lixo, é instrumento de medição**. Foi congelada em `legacy/` com
a instrução "NÃO EDITAR, é o oracle" e virou a referência contra a qual o engine novo é
comparado.

- `tools/gen-golden.mjs` roda `legacy/isorogue-vanilla.html` dentro de `node:vm` e grava
  `test/golden/snapshots.json`, com o SHA-256 da fonte junto.
- `test/golden.test.ts` reexecuta o **mesmo protocolo** com o engine portado:
  12 sementes `GOLD-0001..GOLD-0012`, profundidades 1..3, **200 comandos por caso**, duas
  passadas (canônica e "resistente", com vida reposta antes de cada comando) e 4 descidas
  forçadas por caso (`test/golden.test.ts:10-19`).
- A comparação segue a **ordem cronológica do jogo** — mapa → população → estado inicial →
  comando a comando → marcos de 10 turnos → níveis visitados → morte → estado final com log
  → progressão — para que a primeira falha apontada seja sempre a primeira divergência real
  (`test/golden.test.ts:20-23`).

**Regra de ouro, escrita no topo do arquivo:** *se algo divergir, o errado é o port, nunca o
oracle. Não regere o `snapshots.json`, não afrouxe a comparação, não pule caso.*

Detalhes que fazem o teste funcionar:

- `setStorage(null)` no início (`test/golden.test.ts:40`): o `endTurn` chama autosave e
  nenhum resíduo pode atravessar de uma partida para outra.
- Os extratores são **cópia literal** dos de `gen-golden.mjs` — mesma ordem de campos,
  mesmo hash FNV-1a, mesmas omissões.
- `bump` dos inimigos fica **de fora**: é float de animação, não estado lógico
  (`test/golden.test.ts:207-208`). Esse precedente é o que depois permitiu
  [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].
- A única mudança de representação permitida foi `Command` virar união discriminada em vez
  da string `'move:1,-1'`; `parseCommand` continua existindo justamente para o golden
  conseguir replicar as sequências gravadas (`docs/ARQUITETURA-REACT.md:157-160`).

## O teste foi testado por mutação

Um teste de regressão que nunca falhou não vale nada. O valor dele só é conhecido quando
você o vê **reprovar de propósito**.

Mutação aplicada: `WOUNDED_RATIO` de `0.3` para `0.31` — um ponto percentual no limiar em
que o inimigo ferido entra em fuga (`src/engine/entities.ts:110`, espelhando
`legacy/src-vanilla/40-entities.js:80`).

Resultado: o golden pegou. Apontou **GOLD-0008, comando 94 de 200**, com o snapshot anterior
e o obtido lado a lado e a coluna exata do caractere divergente — a saída de
`conferirSequencia` (`test/golden.test.ts:497-569`). Depois, revertida a mutação, verde de
novo. Ver [[golden-test-precisa-ser-testado]].

## Consequências

**Boas**

- A migração passa a ser **fiel por construção**. Se o golden passa, não sobra "acho que
  está igual".
- Refactor futuro fica barato: o oracle continua lá, e mexer no engine tem rede.
- O relatório de falha é acionável — comando nº, texto do comando, aceito/recusado nos dois
  lados, hashes, último marco em que ainda concordavam e a linha de reprodução pronta:
  `createState('GOLD-0008', 2) + 95 comandos`.

**Ruins**

- **Bugs do vanilla foram portados junto.** O oracle congela o comportamento, não a
  qualidade dele. Corrigir qualquer um deles exige um passo separado, deliberado, com
  regeneração consciente do snapshot — e isso ainda não aconteceu.
- `legacy/` fica no repositório para sempre (ou até alguém decidir aposentar o oracle), com
  o custo de manutenção zero mas o custo cognitivo de "por que tem dois jogos aqui".
- Toda feature nova precisa provar que **não** é observável pelo oracle, senão o golden fica
  vermelho por motivo legítimo e não há como distinguir de regressão. Foi exatamente o
  problema que [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] teve de resolver.
- O `snapshots.json` é grande e ilegível por humano — é dado de máquina, não documentação.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Migrar e testar "no olho", jogando | Não detecta divergência de RNG, de ordem de turno nem de FOV. É o método que produz "funciona diferente e ninguém sabe desde quando". |
| Escrever testes de snapshot **depois** da migração | Congelaria o comportamento do código novo, incluindo os erros introduzidos por ele. Um oracle escrito depois do fato mede nada. |
| Reescrever os testes T1..T10 e parar por aí | Cobrem invariantes (conectividade, simetria de FOV, determinismo), não paridade. Foram portados **além** do golden, não no lugar dele (`test/engine.test.ts`). |
| Comparar só o estado final | Divergência no turno 12 e no turno 199 dariam a mesma mensagem inútil. A comparação comando a comando é o que dá o *primeiro* ponto de quebra. |

Relacionadas: [[golden-test]] · [[determinismo]] · [[rodar-os-testes]] · [[2026-07-28-nascimento-migracao-e-guerreiro]]
