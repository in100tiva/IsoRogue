---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, missoes, tileset, terreno, oracle]
---

# 📆 30/07/2026 — Missões (fase 3) e o terreno em 3D

Duas entregas: o **fecho do sistema de itens** (as missões, fase 3 de 3) e a primeira
**substituição do terreno** por rigs 3D, com o módulo de tilesets isolado por nível.

---

## Fase 3 — missões

Cada andar gera **1 a 3 caçadas**, uma por arquétipo, determinísticas pela semente. Cada uma
pede as DUAS coisas: **matar X** de um tipo **e entregar Y despojos** dele.

- `matar` 2..4, `entregar` 1..3 no total somando os tipos da tabela de drops do alvo.
- Recompensa: `matar × 4 + entregar × valor(item principal)` moedas, mais 50% de chance de um
  item bônus do alvo. Faixas: Slime 11–24, Goblin 13–31, Ogro 20–52 (contra 15 da poção).
- Comando novo `entregar` (texto `'entregar'`), **ao lado do mercador** — a regra de
  adjacência da fase 2.2. Consome turno, como toda negociação.
- O abate conta em silêncio; o registro só fala quando a caçada inteira fecha. O lembrete de
  "pronta para entregar" sai uma vez por encontro, sem spam.
- As missões **atravessam a descida**: o andar novo soma as suas às pendentes.
- Painel na barra lateral com progresso de abate (`2/3 abates`), progresso de entrega
  (`bolsa: 1 de 2 itens`), a recompensa antes de entregar e o botão que só acende ao lado do
  mercador.

Detalhe de modelagem: "pronta" é **predicado derivado** (`progressoMatar >= matar` + despojos
na bolsa), não campo. `completa` e `entregue` nascem juntas na entrega — dois campos porque
dizem coisas diferentes ("fechou" × "pagou"). A UI calcula a prontidão com o **mesmo
predicado do engine**; se calculasse com outro, o botão acenderia na hora errada.

`snapshot()` subiu para **v5** (bloco `M[...]` com a receita inteira de cada missão) e o
oracle foi regenerado deliberadamente.

## O terreno em 3D — tilesets por nível

O chão era losango pintado à mão e a parede eram três faces em LUT. Agora é **rig forjado em
sprite**, na mesma técnica do elenco, e mora em `src/render/tilesets/` — a única casa do
terreno, **um arquivo por nível**, com registro `TILESETS[depth]`. Ver [[tilesets-por-nivel]].

O nível 1, "Ruínas Verdes", saiu das referências do dono: blocos de **grama** com tufos
transbordando a quina, **terra** batida com pedriscos, **areia** com marcas onduladas,
**água** (modelada, ver abaixo), a **parede como barranco** de topo verde e laterais
estratificadas, e cinco adereços — tufo, pedra, moita, flores brancas e a flor laranja
**emissiva**, que acende no escuro como as brasas da alquimia.

**A calibração é o coração da coisa**: `5S = TW` ⇒ lado do tile = **12,8u**. A conta está no
cabeçalho do arquivo e na nota, porque errá-la por pouco produz costura branca entre tiles ou
serrilha de sobreposição — e nenhum dos dois se conserta depois.

**A transparência de parede continua**: quem decide o alfa é o renderer, e o `globalAlpha` que
envolvia o losango envolve o `drawImage` igual. Coberto por teste nos dois caminhos.

**Água: modelada e não usada.** `map.decor` é hash por tile, sem correlação espacial — qualquer
predicado dá sal-e-pimenta, e poça é região *conexa*. O rig fica pronto (custo zero, não é
forjado); o caminho certo é uma região marcada no mapgen. Decisão registrada no código.

**Custo medido**: ~82 ms de forja a frio, uma vez por sessão; em regime o terreno ficou **mais
barato** que o desenho antigo (0,32 ms/quadro contra 0,48). Dívida anotada: o atlas é 8×9 e o
terreno usa 1 quadro de 72 — o forge não expõe canal para forjar menos.

## Verificação

`npm run check` verde: **142 testes** (eram 125; +8 de missões no engine, +4 de UI, +5 de
render). Oracle regenerado. Terreno conferido em foto do jogo rodando.

---

Vizinhos: [[tilesets-por-nivel]] · [[despojos-e-bolsa]] ·
[[2026-07-30-economia-alquimia-e-refino]] · [[ADR-008-oracle-derivado-do-engine]]
