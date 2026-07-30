---
tipo: adr
atualizado: 2026-07-30
tags: [testes, oracle, regressao, despojos, migracao, decisao]
---

# 🔁 ADR-008 — O oracle deixa de vir do vanilla e passa a vir do engine

**Status:** aceita · **supera parcialmente** [[ADR-003-golden-test-como-oracle-da-migracao]]
(o mecanismo continua; a procedência muda)

## Contexto

O sistema de **despojos** entrou no engine: monstro abatido larga item, o jogador tem uma
bolsa de materiais, nasceu um stream de RNG dedicado (`rngLoot`) e o `snapshot()` virou v2 —
`I[id:kind:x:y]`, `B[...]` e `rngL=`.

O golden ficou vermelho: **48 falhas de 49**. Todas de formato e de itens. Foi conferido, uma
a uma: jogador, inimigos, estatísticas, `rngCombat`, contagem de turnos e mortes continuam
**idênticos** ao oracle. Nenhuma regressão. O que quebrou foi a régua, não a peça.

Aqui está o problema, e ele não é deste vermelho — é do próximo:

O oracle era gerado por `tools/gen-golden.mjs`, que roda `legacy/isorogue-vanilla.html`
dentro de `node:vm`. Para o golden voltar ao verde **daquele jeito**, seria preciso
implementar o sistema de despojos inteiro — tabela de drops, bolsa, `rngLoot`, formato v2 do
`snapshot()` — **dentro do HTML congelado**. E depois de novo para a economia. E de novo para
a alquimia. E de novo para as missões.

Isso é escrever cada feature duas vezes, para sempre, sendo que a segunda cópia mora num
arquivo que ninguém executa, ninguém joga e ninguém buildar. O procedimento existe e já foi
usado uma vez de propósito, em 2026-07-29 (o Brutamontes: espelhar o vanilla **antes**,
regerar depois — ver [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]]). Ele funcionou porque
a mudança era de três constantes. Não escala para um subsistema, e escala menos ainda para
cinco.

E — o ponto que decide — **o benefício já foi colhido**. O vanilla era oracle para provar uma
coisa específica: que a migração de JavaScript vanilla para React 19 + TypeScript não mudou o
jogo. Essa prova foi dada, e foi dada com força: 12 sementes, 200 comandos, duas passadas,
hash a cada comando, log em pt-BR linha a linha. Uma prova dada não precisa ser dada de novo
todo dia; precisa ser **arquivada**.

## Decisão

**O oracle passa a ser derivado do próprio engine, e muda de papel.**

De *prova de paridade da migração* para **baseline de regressão caracterizada**: uma
fotografia detalhada de como o jogo se comporta hoje, contra a qual toda mudança futura é
medida.

O que isso significa, concretamente:

| Antes | Agora |
|---|---|
| `tools/gen-golden.mjs` roda o vanilla em `node:vm` | `tools/gen-golden-engine.mjs` roda o engine pelo módulo runner do Vite |
| `test/golden/snapshots.json` | `test/golden/engine-snapshots.json` |
| extratores duplicados à mão nos dois lados | `test/golden/protocolo.ts`, importado pelo gerador **e** pelo teste |
| pergunta: "o port é fiel ao vanilla?" | pergunta: "o engine de hoje é o engine de ontem, exceto onde eu quis mudar?" |

O **protocolo não afrouxou em nada** — é o mesmo §7.1 do `docs/ARQUITETURA-REACT.md`: 12
sementes `GOLD-0001..GOLD-0012`, profundidades 1..3 em ciclo, 200 comandos por caso saídos do
LCG de semente 20260728, `snapshot()` completo a cada 10 turnos, hash FNV-1a após **cada**
comando, duas passadas por caso (canônica e resistente), 4 descidas forçadas, log inteiro,
mapa por hash de tiles e decor, FOV e explorados por hash.

Ele **apertou**, porque o oracle novo enxerga o que o vanilla não enxergava: a bolsa entra
(normalizada na ordem de `ITEM_KINDS`, nunca na ordem de inserção do objeto), o `kind` de cada
item entra, `rngLoot` entra, `proxItemId` entra, e `causeKind` — o arquétipo do golpe fatal —
entra de carona.

O vanilla e o `snapshots.json` de 1,4 MB **permanecem no repositório**. `legacy/` continua
sendo o que [[ADR-003-golden-test-como-oracle-da-migracao]] disse que era: instrumento de
medição, não código morto. Só que agora é instrumento de medição **histórica**.

### O gerador, e como ele executa TypeScript

`tools/gen-golden-engine.mjs` carrega `test/golden/protocolo.ts` pelo
`createServerModuleRunner` do Vite — o **mesmo** mecanismo que o Vitest 4 usa por baixo para
carregar `test/**` e `src/**`.

Isso é correção, não conveniência. Um oracle derivado do engine só vale se codificar o
comportamento do **exato programa que o teste executa**. Transpilar o engine por outra via
(strip-types do Node, um bundle avulso, um `tsc` intermediário) colocaria um segundo
compilador entre o oracle e o teste — pequeno, provavelmente inócuo, e exatamente o tipo de
diferença de que ninguém se lembra quando o golden fica vermelho às três da manhã.

Foi medido antes de decidir: `node --experimental-strip-types` **morre** em
`export const enum Tile` (`src/engine/types.ts`), que não é sintaxe apagável;
`--experimental-transform-types` funciona, mas é flag experimental e é o tal segundo
compilador; esbuild não existe no projeto (o Vite 8 roda sobre Rolldown — o mesmo motivo já
registrado em `vite.preview.config.ts`); disparar `vitest run` num arquivo gerador funciona,
mas exige um arquivo de configuração só para tirar o gerador do `include` dos testes e obriga
a vestir o gerador de `it(...)`.

Foi criado um script **novo** em vez de um modo `--engine` no gerador antigo por duas razões.
A prática: 85% das 1.184 linhas de `gen-golden.mjs` são o sandbox do vanilla — `node:vm`, um
DOM de mentira, um contexto 2D de mentira —, tudo inútil no caminho do engine. A que importa:
os dois passaram a ter **ciclos de vida opostos**. O gerador vanilla é peça congelada; este é
ferramenta viva. Enfiar os dois no mesmo arquivo torna mutável uma coisa cujo valor é estar
parada.

O arquivo gerado é **determinístico**: rodar duas vezes produz bytes idênticos (verificado —
`sha256` igual em duas invocações separadas, e `--verificar` gera duas vezes no mesmo processo
para pegar estado mutável de módulo vazando entre partidas). Não existe campo `geradoEm`: um
carimbo de tempo quebraria essa promessa. A proveniência é `fonteSha256`, o SHA-256 do
conteúdo de `src/engine/**` — gravado como **informação, nunca como gate**, porque um gate ali
deixaria o golden vermelho por edição de comentário e treinaria todo mundo a regenerar o
oracle por reflexo.

## O que passa a ser o gate

`npm run check` continua sendo o portão, e dentro dele:

1. **`test/golden.test.ts`** — o engine contra `engine-snapshots.json`, na ordem cronológica
   do jogo: mapa → população → estado inicial → comando a comando → marcos de 10 turnos →
   níveis → morte → estado final com log → progressão. 50 casos.
2. **`test/golden-vanilla.test.ts`** — o engine contra o oracle vanilla, com os despojos
   projetados para fora. 50 casos. Ver a seção seguinte.
3. **`test/engine.test.ts`** — os invariantes T1..T10, que nunca dependeram de oracle nenhum:
   60 sementes de conectividade, 40×25 de simetria de FOV, 400 comandos de determinismo.
4. Um caso novo dentro do golden: as 200 sequências gravadas têm de ser **as que o LCG produz
   hoje**. Sem isso, mexer no pool de comandos passaria despercebido — o teste continuaria
   verde executando comandos que o gerador atual nunca produziria.

**A regra de ouro nova:**

> **Divergência é regressão do engine até prova em contrário.** Regenerar o oracle é **ato
> deliberado**, feito com o dono junto e registrado em `obsidian/07 - Changelog`. Nunca se
> regenera para consertar um teste vermelho, nunca se afrouxa uma comparação, nunca se pula
> caso.

## O que se perde — dito por extenso, porque é real

**1. A checagem cruzada entre duas implementações independentes acabou.**

Era essa a joia do arranjo anterior: dois programas escritos separadamente, um em JS de
concatenação e outro em TypeScript em camadas, tinham de concordar bit a bit. Erro que exige
que as duas implementações errem *da mesma forma* é raro; erro que exige que **uma**
implementação seja consistente consigo mesma é o caso trivial. O oracle novo pega a segunda
classe e é cego para a primeira.

**2. O baseline é tautológico no instante em que nasce.**

`gerar` e `comparar` rodam o mesmo código. No minuto zero de cada regeneração, o teste não
pode falhar — por construção. Todo o valor dele está no **tempo decorrido** entre a geração e
a mudança seguinte. Um oracle regenerado toda semana não vale nada; um regenerado três vezes
por ano vale muito. A frequência de regeneração passa a ser, ela mesma, uma métrica de
qualidade do projeto.

**3. O atrito que protegia a regeneração sumiu.**

Antes, regenerar exigia **editar outro programa primeiro**. Esse trabalho chato era metade da
garantia: ninguém regenera o oracle por engano quando isso custa uma hora de espelhamento
manual. Agora custa um `npm run golden:engine` — três segundos. A passagem obrigatória pelo
changelog não é burocracia: **é o atrito que sobrou**, e é a única coisa entre uma regressão
real e um diff que a apaga sem deixar rastro.

**4. Bug congelado agora é bug invisível.**

O ADR-003 já registrava que os bugs do vanilla foram portados junto. A diferença é que antes
existia uma segunda fonte para consultar; agora o baseline é o único depoente, e ele repete
qualquer erro que estivesse no engine no dia da geração — com a mesma convicção com que
reporta o comportamento correto.

## O que se ganha

- **Fase nova não paga pedágio.** Economia, alquimia e missões entram com um
  `npm run golden:engine` deliberado no fim, em vez de uma reimplementação no HTML legado.
- **O oracle enxerga o jogo inteiro.** Bolsa, `rngLoot`, `proxItemId`, `kind` de item: o que o
  vanilla não tinha, o baseline cobre. Antes, todo campo novo tinha de provar que era
  invisível ao oracle (foi o problema que [[ADR-005-facing-cosmetico-invisivel-ao-oracle]]
  teve de resolver). Agora só o **cosmético** fica de fora, e por escolha, não por limitação.
- **Um extrator só.** Gerador e teste importam `test/golden/protocolo.ts`. Some a classe de
  erro "as duas cópias do extrator divergiram e a comparação estreitou em silêncio" — o pior
  modo de falha possível num teste de regressão. E não abre buraco: o JSON gravado é imutável
  entre regenerações, então tirar um campo do extrator faz o campo sumir só de um lado e o
  `toEqual` reprova na hora.
- **O relatório de falha continua o mesmo**, que era o melhor pedaço do arranjo antigo:
  número e texto do comando, aceito/recusado dos dois lados, hashes, snapshot anterior e
  obtido, coluna exata do primeiro caractere diferente, último marco de 10 turnos em que ainda
  concordavam e a linha de reprodução pronta.

## A prova da migração continua viva — e tem data de validade

Perder a checagem cruzada de uma vez seria pagar caro sem necessidade. Foi **medido** quanto
dela dá para salvar, em vez de supor: projetando para fora exatamente o que os despojos
acrescentaram, o engine de hoje reproduz o oracle vanilla em **12/12 casos, em todos os
eixos** — hash por comando nas duas passadas, marcos de 10 turnos, string de aceitos, níveis
visitados, morte, `rngCombat`, stats, inimigos, FOV, explorados, mapa, as 4 descidas forçadas
e o log em pt-BR linha por linha.

Ou seja: **os despojos não mexeram em nada que já existia.** Isso é afirmação forte e agora
está sob teste, em `test/golden-vanilla.test.ts`, por 0,8 s de suíte.

A projeção é pequena e é toda a licença que o teste tem:

1. `rebaixarSnapshot()` leva o `snapshot()` v2 de volta ao v1 — `v2|`→`v1|`,
   `I[id:kind:x:y]`→`I[id:x:y]` guardando só as poções, fora `B[...]`, fora `rngL=`. Ela
   **lança** se a gramática não for exatamente a que ela conhece: um formato v3 tem de
   derrubar o teste dizendo "o formato mudou", não passar meia string adiante.
2. `ocultarDespojos()` tira do registro as duas famílias de linha que a fase criou — "… larga
   …" e "Você recolhe *material* …". A poção recolhida continua sendo comparada: aquela frase
   é do vanilla.

E há um caso que confere que a projeção **está viva** — que ela de fato escondeu itens e
linhas —, para o teste não ficar verde por vacuidade no dia em que os drops pararem de cair.

**A data de validade está escrita no cabeçalho do arquivo.** Ele vive enquanto a projeção
couber nas ~40 linhas que ocupa hoje. No dia em que a economia exigir esconder um preço, e a
alquimia uma receita, e as missões um contador, este teste terá virado uma reimplementação do
vanilla por procuração — que é precisamente o custo que este ADR recusou pagar. A ação correta
nesse dia é **aposentá-lo**: apagar, registrar no changelog, e deixar `legacy/` como o
documento histórico que é. Não é derrota; é o teste terminando de responder a pergunta para a
qual foi feito. O que **não** se faz é inchar a projeção para manter o verde — uma projeção
que cresce sem critério esconde regressão em vez de contexto, e teste que esconde regressão é
pior que teste nenhum, porque ainda dá confiança.

### Adendo de 2026-07-30 (mesmo dia): a data de validade venceu

O teste projetado viveu **algumas horas**, e cumpriu exatamente o que prometeu: na fase 1
(despojos) ele passou **12/12 em todos os eixos** — hash por comando nas duas passadas,
marcos, aceitos, níveis, morte, `rngCombat`, stats, inimigos, FOV, explorados, mapa, as
quatro descidas e o log linha por linha. Ou seja, provou que o sistema de despojos **não
tocou em nada que já existia**. Essa era a pergunta, e ela foi respondida.

A fase 2 (economia, alquimia, refino) chegou no mesmo dia e pediu a **terceira projeção**:
rebaixar `snapshot()` de v3 para v2 além de v1, esconder duas linhas novas de registro
('Você chega ao mercador…', 'Uma bancada de alquimia…') e omitir dois campos do jogador
(`moedas`, `armaNivel`). É a condição escrita acima, ao pé da letra.

**Aposentado**, então, e não inchado: `test/golden-vanilla.test.ts` foi apagado. O que fica:

- `legacy/isorogue-vanilla.html` e `tools/gen-golden.mjs` — a implementação e o gerador
  originais, congelados, executáveis por quem quiser reconstruir a régua de 2026-07-28;
- `test/golden/snapshots.json` — o oracle vanilla como ele era. Nenhum teste o lê hoje; ele
  é documento, e está no repositório pelo mesmo motivo que um ADR revogado continua no
  repositório;
- `test/golden.test.ts` sobre `engine-snapshots.json` — a régua viva, agora de regressão.

Quem no futuro quiser reabrir a pergunta "o port ainda é fiel ao vanilla de 2026-07-28?" tem
tudo o que precisa para responder — só não vai encontrar a resposta pronta e verde a cada
`npm run check`, porque manter essa resposta pronta custava mais do que ela vale.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Implementar os despojos no vanilla congelado e regerar `snapshots.json` | É o procedimento correto do ADR-003 e funciona — uma vez. Aqui significaria escrever tabela de drops, bolsa, `rngLoot` e `snapshot()` v2 num HTML que ninguém executa, e repetir a dose a cada fase. Custo permanente, benefício encerrado. |
| Deixar o golden vermelho e seguir | Suíte vermelha por motivo conhecido é suíte desligada. Em duas semanas ninguém lê mais a saída e a 49ª falha, a de verdade, passa junto com as 48 esperadas. |
| Marcar os 12 casos como `skip` até "depois" | Mesma coisa da linha acima, com aparência de organização. "Depois" não tem data e teste pulado não reprova nada. |
| Afrouxar o golden: comparar só o que o vanilla conhecia, para sempre | Congela a cobertura no estado de 2026-07-28. Todo sistema novo nasceria fora do oracle — despojos hoje, economia amanhã — e o teste mais importante do projeto viraria uma medida do passado. |
| Manter os dois oracles como iguais, ambos obrigatórios e ambos completos | É a alternativa cara em roupa de rigor: obriga a manter o vanilla vivo, que é o custo que se está recusando. O que se manteve foi a versão **projetada e com data de validade**, que custa 0,8 s e não pede uma linha de vanilla novo. |
| Gerar o oracle com `node --experimental-transform-types` | Funciona (foi testado), mas põe um segundo compilador entre o oracle e o teste, e prende o projeto a uma flag experimental. O módulo runner do Vite é o mesmo caminho do Vitest, sem flag. |
| Um modo `--engine` dentro de `tools/gen-golden.mjs` | Carregaria o sandbox inteiro do vanilla num caminho que não pode tocá-lo, e tornaria mutável um arquivo cujo valor passou a ser estar congelado junto com `legacy/`. |
| Deletar `legacy/` e o `snapshots.json` de uma vez | O arquivo histórico é o que torna esta decisão reversível e auditável. Apagar a régua velha no mesmo dia em que se troca de régua é destruir a única evidência de que a troca foi honesta. |

## Relação com o ADR-003

[[ADR-003-golden-test-como-oracle-da-migracao]] continua **de pé no que ele é**: a decisão de
não apagar o vanilla, o protocolo de 12×200×2, a ordem cronológica de comparação, a exclusão
do que é animação, e a exigência de que o teste seja testado por mutação
([[golden-test-precisa-ser-testado]]). Este ADR troca **uma frase** daquele: a de que o oracle
é o vanilla.

Também herda a lição do ADR-007: quando o comportamento muda de propósito, o oracle é
regenerado de propósito, com o dono sabendo. O que muda é que o "de propósito" ficou barato de
executar — e por isso precisou ficar caro de **esconder**, que é o papel do changelog.

Relacionadas: [[golden-test]] · [[determinismo]] · [[rodar-os-testes]] ·
[[ADR-003-golden-test-como-oracle-da-migracao]] ·
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]] ·
[[ADR-007-monstro-e-aparencia-nao-arquetipo]] ·
[[2026-07-29-brutamontes-e-a-masmorra-de-slimes]]
