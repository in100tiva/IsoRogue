---
tipo: nota
atualizado: 2026-07-30
tags: [arquitetura, teste, oracle, migracao, regressao]
---

# 🏅 Golden test

O teste mais importante do projeto. Ele responde à pergunta *"o jogo continua se comportando
como se comportava?"* — não por opinião, por medição, em 12 sementes, turno a turno.

> **Mudou em 2026-07-30.** Até essa data o golden media o engine contra o **vanilla
> congelado**, e o que ele provava era a fidelidade da migração. A partir dela o oracle é
> derivado do **próprio engine** e o teste virou **baseline de regressão caracterizada**.
> A decisão, o preço e o que se perdeu estão em
> [[ADR-008-oracle-derivado-do-engine]]. A prova da migração não foi jogada fora — ver
> "[[#A prova da migração, e por quanto tempo ela vive]]" mais abaixo.

## As duas peças

| Arquivo | O que compara | Papel |
|---|---|---|
| `test/golden.test.ts` | engine × `test/golden/engine-snapshots.json` | **baseline de regressão** — é o teste que roda todo dia |
| `test/golden-vanilla.test.ts` | engine × `test/golden/snapshots.json` (vanilla), com os despojos projetados para fora | **prova histórica** da migração, com data de validade declarada |

As duas usam o MESMO protocolo, que mora em um lugar só: `test/golden/protocolo.ts`.

## De onde o oracle vem

`tools/gen-golden-engine.mjs` carrega `test/golden/protocolo.ts` pelo módulo runner do Vite —
o mesmo mecanismo que o Vitest usa por baixo para carregar `src/**` — roda os 12 casos e grava
`test/golden/engine-snapshots.json` (1,4 MB).

Usar o pipeline do Vitest não é conveniência: um oracle derivado do engine só vale se
codificar o comportamento do **exato programa que o teste executa**. Um segundo transpilador
entre os dois seria uma diferença pequena, provavelmente inócua, e impossível de lembrar às
três da manhã.

```bash
npm run golden:engine              # regenera o baseline
npm run golden:engine:verificar    # gera duas vezes e prova que o resultado é idêntico
node tools/gen-golden-engine.mjs --resumo   # só imprime o quadro, não grava
```

O arquivo é **byte a byte reprodutível**: duas execuções dão o mesmo `sha256`. Não há campo
`geradoEm` — um carimbo de tempo quebraria isso. A proveniência é `fonteSha256`, o hash do
conteúdo de `src/engine/**` no momento da geração, gravado como **informação e não como
gate**: se fosse gate, editar um comentário no engine deixaria o golden vermelho e treinaria
todo mundo a regenerar o oracle por reflexo — o hábito exato que a regra de ouro proíbe.

O gerador antigo, `tools/gen-golden.mjs` (`npm run golden`), continua no repositório e
continua funcionando. Ele roda `legacy/isorogue-vanilla.html` em `node:vm` e produz
`test/golden/snapshots.json`. É peça histórica: nenhuma fase nova precisa dele.

## O que está gravado

Por caso, e é o mesmo protocolo desde o primeiro dia (§7.1 do `docs/ARQUITETURA-REACT.md`):

- **12 sementes fixas**, `GOLD-0001` a `GOLD-0012`, profundidades 1 a 3 em ciclo.
- **200 comandos** por caso, sorteados por um LCG do próprio protocolo (Numerical Recipes,
  semente `20260728`). Sorteados uma vez, gravados, **executados a partir do arquivo** — e um
  caso do teste confere que o gravado é o que o LCG produz hoje, senão mexer no pool passaria
  despercebido.
- **Duas passadas** por caso: a **canônica** (o jogador morre quando morre) e a **resistente**,
  com vida reposta antes de cada comando, que é o protocolo T6 do harness vanilla. A
  resistente existe porque na canônica muitas partidas acabam cedo e os últimos 150 comandos
  não exercitam nada.
- **4 descidas forçadas** por `descend()`, para cobrir a progressão de níveis que os comandos
  sorteados nunca alcançam — e, desde os despojos, para provar que a **bolsa atravessa o andar
  intacta** enquanto `rngLoot`, `rngCombat` e `proxItemId` são reiniciados.

E, dentro de cada passada:

| Granularidade | O que é comparado |
|---|---|
| Por comando (200×) | se o comando foi aceito + hash FNV-1a do `snapshot()` |
| A cada 10 turnos | o `snapshot()` **completo**, string com string |
| A cada troca de nível | mapa inteiro: hash de tiles, de decor, salas, conectividade, reparos |
| Na morte | turno, índice do comando, causa em pt-BR, arquétipo do golpe fatal, snapshot, jogador |
| No fim | jogador **com a bolsa**, inimigos, itens com `kind`, stats, visíveis, explorados, `rngCombat.s`, `rngLoot.s`, `proxItemId`, **log completo** |

O `snapshot()` é a assinatura textual do estado (`src/engine/game.ts`), hoje na versão **v2**:
semente, profundidade, turno, jogador, cada inimigo por id, cada item com o seu tipo, a bolsa
na ordem de `ITEM_KINDS`, as sete estatísticas, o estado dos dois RNGs e um checksum FNV-1a
dos tiles. Formato estável, comparado byte a byte.

O log entra inteiro na comparação — inclusive as frases em pt-BR. Se alguém "melhorar" a
redação de *"Morto pelo Perseguidor no nível 3"*, o teste reprova. É intencional: texto
visível é comportamento.

## Como rodar

```bash
npm run test          # roda tudo: engine, golden, golden-vanilla, render, ui
npx vitest run test/golden.test.ts
npx vitest run test/golden-vanilla.test.ts
```

Detalhes em [[rodar-os-testes]].

## A regra de ouro

> **Divergência é REGRESSÃO DO ENGINE até prova em contrário.**
> **Regenerar o oracle é ATO DELIBERADO, e ele passa pelo changelog.**

Diante de vermelho, o reflexo correto continua sendo abrir o engine, não o oracle. Não se
regenera o baseline para "resolver" uma falha, não se afrouxa uma comparação, não se pula
caso. Um oracle que se ajusta ao código sob teste não é oracle, é espelho.

**E agora essa regra é mais frágil do que era, o que a torna mais importante.** Quando o
oracle vinha do vanilla, regenerá-lo exigia editar *outro programa* primeiro, e aquele
trabalho chato era metade da garantia: ninguém regenera por engano o que custa uma hora de
espelhamento manual. Hoje custa três segundos. A passagem obrigatória por
`obsidian/07 - Changelog` — o que mudou, por quê, o que se conferiu antes de aceitar o novo
baseline — não é burocracia: **é o atrito que sobrou**, e é a única coisa entre uma regressão
real e um diff que a apaga sem deixar rastro.

Há um corolário que vale escrever: **a frequência de regeneração é, ela mesma, uma métrica de
qualidade.** Um baseline regenerado toda semana não prova nada, porque todo o valor dele está
no tempo decorrido entre a geração e a mudança seguinte. Um regenerado três vezes por ano
prova muito.

A primeira regeneração deliberada aconteceu em **2026-07-29**, ainda no regime antigo: a
Sentinela virou o Brutamontes e os pesos de spawn passaram a 10/1/100. O vanilla legacy
recebeu as mesmas edições **antes**, e só então `gen-golden.mjs` rodou. Não foi "o teste ficou
vermelho e eu regenerei"; foi o procedimento executado pela primeira vez. Ver
[[2026-07-29-brutamontes-e-a-masmorra-de-slimes]].

O relatório de falha foi construído para essa postura. A comparação é feita em **ordem
cronológica do jogo** — mapa → população → estado inicial → comando a comando → marcos de 10
turnos → níveis visitados → morte → estado final → progressão — de modo que a primeira falha
apontada seja sempre a primeira divergência real, e não um efeito colateral 80 turnos depois.
Quando ela aparece, o bloco traz: número e texto do comando, se foi aceito dos dois lados,
hash esperado e obtido, o snapshot anterior, o snapshot obtido, a coluna exata do primeiro
caractere diferente, o **último marco de 10 turnos em que ainda concordavam** e uma linha de
reprodução pronta.

## A prova da migração, e por quanto tempo ela vive

Trocar a procedência do oracle custa uma coisa real: **ninguém mais compara duas
implementações independentes**. É essa comparação que pega a classe de erro em que oracle e
código "concordam" porque são o mesmo código.

Antes de aceitar essa perda, foi medido quanto dela dava para salvar. Projetando para fora
exatamente o que os despojos acrescentaram, o engine de hoje reproduz o oracle vanilla em
**12/12 casos, em todos os eixos**: hash por comando nas duas passadas, marcos de 10 turnos,
string de aceitos, níveis visitados, morte, `rngCombat`, stats, inimigos, FOV, explorados,
mapa, as 4 descidas e o log linha por linha. Ou seja, **os despojos não mexeram em nada que já
existia** — e isso agora está sob teste, em `test/golden-vanilla.test.ts`, por 0,8 s de suíte.

A projeção é toda a licença que aquele teste tem, e são duas transformações:

1. `rebaixarSnapshot()` — leva o `snapshot()` v2 de volta ao v1: `v2|`→`v1|`,
   `I[id:kind:x:y]`→`I[id:x:y]` guardando só as poções, fora o bloco `B[...]`, fora `rngL=`.
   Ela **lança** se a gramática não for exatamente a que conhece — um formato v3 tem de
   derrubar o teste dizendo "o formato mudou", não passar meia string adiante.
2. `ocultarDespojos()` — tira do registro as duas famílias de linha que a fase criou: "… larga
   …" e "Você recolhe *material* …". A poção recolhida continua comparada: aquela frase é do
   vanilla.

Um caso extra confere que a projeção **está viva** (escondeu itens e escondeu linhas), para o
teste não ficar verde por vacuidade no dia em que os drops pararem de cair.

**Ele tem data de validade, e ela está escrita no cabeçalho do arquivo.** Vive enquanto a
projeção couber nas ~40 linhas que ocupa hoje. No dia em que a economia exigir esconder um
preço, e a alquimia uma receita, e as missões um contador, ele terá virado uma reimplementação
do vanilla por procuração — o custo que [[ADR-008-oracle-derivado-do-engine]] recusou pagar. A
ação correta nesse dia é **aposentá-lo**: apagar, registrar no changelog, deixar `legacy/`
como o documento histórico que é. O que não se faz é inchar a projeção para manter o verde.

## O teste que foi testado

Um teste de regressão que nunca falhou não vale nada. O valor dele só é conhecido quando você
o vê reprovar de propósito.

Foi o que se fez: **mutação deliberada** de `WOUNDED_RATIO`, o limiar em que um inimigo ferido
entra em fuga, de `0.3` para `0.31` — um ponto percentual, uma casa decimal, em
`src/engine/entities.ts`:

```ts
export const WOUNDED_RATIO = 0.3; /* hp <= 30% do maxHp entra em fuga */
```

O golden pegou. Apontou **GOLD-0008, comando 94 de 200**, com o snapshot anterior e o obtido
lado a lado. Um inimigo que deveria continuar caçando entrou em fuga um ponto percentual
antes, foi para outro tile, e a partida inteira divergiu a partir dali.

Isso é o que dá autoridade ao teste: ele não só está verde, ele sabe ficar vermelho, e sabe
dizer **onde**. Ver [[golden-test-precisa-ser-testado]].

## O que ele não cobre

Ser honesto sobre o alcance é parte do valor:

- **Nada visual.** O golden compara estado lógico. Cor, sprite, câmera, iluminação — nada
  disso entra. O guerreiro pode estar de cabeça para baixo e o golden passa. Para isso existe
  a [[inspecao-visual-headless]].
- **Nada de UI.** Painéis, teclado e overlay de morte são cobertos por `test/ui.test.tsx`, em
  jsdom, separadamente.
- **Campos cosméticos são excluídos de propósito.** `player.facing`, o `bump` dos inimigos e a
  fila `abatesRecentes` (os flutuantes de XP) não entram em `snapshot()` nem nos extratores.
  Ver [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].
- **O baseline não sabe se o comportamento é *certo*, só se é o *mesmo*.** É a natureza de um
  oracle derivado do próprio código: no minuto zero de cada regeneração ele não pode falhar,
  por construção. Bug congelado é bug repetido com convicção. Quem julga se o comportamento é
  desejável são os invariantes de `test/engine.test.ts` e a leitura humana.
- **Só as 12 sementes gravadas.** Cobertura ampla vem dos T1..T10 de `test/engine.test.ts`: 60
  sementes de conectividade, 40×25 de simetria de FOV, 400 comandos de determinismo, 300 de
  invariantes de turno.

## Uma armadilha operacional

O engine é puro, mas `endTurn` chama o autosave. Em Node não existe `localStorage`, então o
save já degradaria em silêncio — ainda assim `test/golden/protocolo.ts` chama `setStorage(null)`
no ato da importação, para que **nenhum resíduo de uma partida alcance a seguinte**.

Ele mora no módulo compartilhado de propósito: gerador e teste têm de rodar sob a **mesma**
condição de isolamento, e "lembrar de chamar" é exatamente o tipo de disciplina que falha uma
vez e produz um teste instável cuja ordem de execução muda o resultado — o pior tipo de teste
que existe.

## Ligações

- [[determinismo]] — o que o golden está de fato medindo.
- [[golden-test-precisa-ser-testado]] — o teste de mutação, em detalhe.
- [[ADR-008-oracle-derivado-do-engine]] — a troca de procedência do oracle, e o preço dela.
- [[ADR-003-golden-test-como-oracle-da-migracao]] — a decisão original de congelar o vanilla.
- [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] — como acrescentar estado sem quebrá-lo.
- [[rodar-os-testes]] — comandos e tempos.
