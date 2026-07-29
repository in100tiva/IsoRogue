---
tipo: nota
atualizado: 2026-07-29
tags: [arquitetura, teste, oracle, migracao, regressao]
---

# 🏅 Golden test

O teste mais importante do projeto. É ele que autoriza dizer que a migração de JavaScript
vanilla para React 19 + TypeScript não mudou nada no jogo — não por opinião, por medição.

## De onde ele vem

O ISOROGUE nasceu em vanilla puro: oito arquivos JS concatenados num HTML por um script de
build. Na migração, essa versão **não foi apagada**. Foi congelada em `legacy/` e promovida a
**oracle**: a fonte da verdade sobre como o jogo se comporta.

`legacy/` não é código morto que ninguém teve coragem de deletar. É instrumento de medição. O
dia em que ele for apagado, o projeto perde a régua. Ver
[[ADR-003-golden-test-como-oracle-da-migracao]].

## O que está gravado

`tools/gen-golden.mjs` carrega `legacy/isorogue-vanilla.html` em `node:vm` e escreve
`test/golden/snapshots.json` — **1,4 MB** de estado esperado. O conteúdo, por caso:

- **12 sementes fixas**, `GOLD-0001` a `GOLD-0012`, profundidades 1 a 3.
- **200 comandos** por caso, sorteados por um LCG do próprio script (Numerical Recipes, semente
  `20260728`, `tools/gen-golden.mjs:62`). Sorteados uma vez, gravados, nunca mais recalculados —
  a sequência é dado, não é sorteio em tempo de teste.
- **Duas passadas** por caso: a **canônica** (o jogador morre quando morre) e a **resistente**,
  com vida reposta antes de cada comando, que é o protocolo T6 do harness vanilla. A resistente
  existe porque na canônica muitas partidas acabam cedo e os últimos 150 comandos não exercitam
  nada.
- **4 descidas forçadas** por `descend()`, para cobrir a progressão de níveis que os comandos
  sorteados nunca alcançam.

E, dentro de cada passada:

| Granularidade | O que é comparado |
|---|---|
| Por comando (200×) | se o comando foi aceito + hash FNV-1a do `snapshot()` |
| A cada 10 turnos | o `snapshot()` **completo**, string com string |
| A cada troca de nível | mapa inteiro: hash de tiles, de decor, salas, conectividade, reparos |
| Na morte | turno, índice do comando, causa em pt-BR, snapshot, jogador |
| No fim | jogador, inimigos, itens, stats, visíveis, explorados, `rngCombat.s`, **log completo** |

O `snapshot()` é a assinatura textual do estado (`src/engine/game.ts:730-765`): semente,
profundidade, turno, jogador, cada inimigo por id, cada item, as sete estatísticas, o estado do
RNG de combate e um checksum FNV-1a dos tiles. Formato estável, comparado byte a byte.

O log entra inteiro na comparação — inclusive as frases em pt-BR. Se alguém "melhorar" a
redação de *"Morto pelo Perseguidor no nível 3"*, o teste reprova. É intencional: texto visível
é comportamento.

## Como rodar

```bash
npm run test          # roda tudo: engine, golden, ui
npx vitest run test/golden.test.ts
```

Detalhes em [[rodar-os-testes]].

## A regra de ouro

> **Se divergir, o errado é o código. Nunca o oracle.**

Não regere o `snapshots.json` para "resolver" uma falha. Não afrouxe uma comparação. Não pule
caso. O comentário de cabeçalho do arquivo diz isso em letras maiúsculas
(`test/golden.test.ts:22-23`), e é a única postura que faz o teste valer alguma coisa: um
oracle que se ajusta ao código sob teste não é oracle, é espelho.

A exceção que confirma a regra aconteceu em **2026-07-29**: a primeira regeneração
**deliberada** do oracle. O comportamento mudou de propósito — a Sentinela virou o
Brutamontes e os pesos de spawn passaram a 10/1/100 —, o vanilla legacy recebeu as mesmas
edições **antes**, e só então `node tools/gen-golden.mjs` rodou: vanilla espelhado →
gen-golden → `npm run check` 73/73. Não foi "o teste ficou vermelho e eu regenerei"; foi o
procedimento de [[ADR-003-golden-test-como-oracle-da-migracao]] para mudança intencional,
executado pela primeira vez. Ver [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]].

O relatório de falha foi construído para essa postura. A comparação é feita em **ordem
cronológica do jogo** — mapa → população → estado inicial → comando a comando → marcos de 10
turnos → níveis visitados → morte → estado final — de modo que a primeira falha apontada seja
sempre a primeira divergência real, e não um efeito colateral 80 turnos depois. Quando ela
aparece, o bloco traz: número e texto do comando, se foi aceito dos dois lados, hash esperado e
obtido, o snapshot anterior, o snapshot obtido, a coluna exata do primeiro caractere diferente,
o **último marco de 10 turnos em que ainda concordavam** e uma linha de reprodução pronta
(`test/golden.test.ts:542-561`).

## O teste que foi testado

Um teste de regressão que nunca falhou não vale nada. O valor dele só é conhecido quando você o
vê reprovar de propósito.

Foi o que se fez: **mutação deliberada** de `WOUNDED_RATIO`, o limiar em que um inimigo ferido
entra em fuga, de `0.3` para `0.31` — um ponto percentual, uma casa decimal, em
`src/engine/entities.ts:110`:

```ts
export const WOUNDED_RATIO = 0.3; /* hp <= 30% do maxHp entra em fuga */
```

O golden pegou. Apontou **GOLD-0008, comando 94 de 200**, com o snapshot anterior e o obtido
lado a lado. Um inimigo que deveria continuar caçando entrou em fuga um ponto percentual antes,
foi para outro tile, e a partida inteira divergiu a partir dali.

Isso é o que dá autoridade ao teste: ele não só está verde, ele sabe ficar vermelho, e sabe
dizer **onde**. Ver [[golden-test-precisa-ser-testado]].

## O que ele não cobre

Ser honesto sobre o alcance é parte do valor:

- **Nada visual.** O golden compara estado lógico. Cor, sprite, câmera, iluminação — nada disso
  entra. O guerreiro pode estar de cabeça para baixo e o golden passa. Para isso existe a
  [[inspecao-visual-headless]].
- **Nada de UI.** Painéis, teclado e overlay de morte são cobertos por `test/ui.test.tsx`, em
  jsdom, separadamente.
- **Campos cosméticos são excluídos de propósito.** `player.facing` não entra em `snapshot()` e
  não entra em `extrairJogador()` (`test/golden.test.ts:118`, `test/golden.test.ts:233-238`) —
  foi assim que a direção do olhar do guerreiro entrou sem invalidar o oracle. O precedente é o
  `bump` dos inimigos, float de animação já excluído pelo mesmo motivo. Ver
  [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].
- **Só as 12 sementes gravadas.** Cobertura ampla de comportamento vem dos testes T1..T10 de
  `test/engine.test.ts`: 60 sementes de conectividade, 40×25 de simetria de FOV, 400 comandos de
  determinismo, 300 de invariantes de turno.

## Uma armadilha operacional

O engine é puro, mas `endTurn` chama o autosave. Em Node não existe `localStorage`, então o
save já degradaria em silêncio — ainda assim o teste chama `setStorage(null)` explicitamente no
topo (`test/golden.test.ts:40`), para que **nenhum resíduo de uma partida alcance a seguinte**.
É o equivalente ao `clear()` que o gerador do oracle faz antes de cada partida. Sem isso, a
ordem de execução dos casos poderia mudar o resultado — o pior tipo de teste instável.

## Ligações

- [[determinismo]] — o que o golden está de fato medindo.
- [[golden-test-precisa-ser-testado]] — o teste de mutação, em detalhe.
- [[ADR-003-golden-test-como-oracle-da-migracao]] — a decisão de congelar o vanilla.
- [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] — como acrescentar estado sem quebrá-lo.
- [[rodar-os-testes]] — comandos e tempos.
