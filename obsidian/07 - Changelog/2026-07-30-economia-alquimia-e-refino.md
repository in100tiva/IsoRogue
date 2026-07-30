---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, economia, alquimia, refino, mercador, bancada, oracle]
---

# 📆 30/07/2026 — Economia, alquimia e refino (fase 2)

**Fase 2 de 3** do sistema de itens. A fase 1 deu ao despojo um corpo e um lugar na bolsa;
esta dá a ele **destino**: vender por moedas, virar poção no caldeirão ou virar ataque na
bigorna. As missões fecham o ciclo na fase 3.

---

## O que mudou

**Dois pontos de parada por andar.** O **mercador** nasce a 2–4 tiles da escada (medido em
800 andares: 0 sem mercador, 0 sem bancada); a **bancada** nasce noutra sala. Ambos são
`Point` no `Game`, não tile novo — o mapa é regerado pela semente no restore e o `map=` do
snapshot é checksum de tiles: um tile novo confundiria "o andar é outro" com "o mercador
mudou de lugar".

Colocação **depois** de inimigos e itens no stream de população, de propósito: pôr antes
deslocaria o sorteio e mudaria a posição de todo inimigo de todo andar.

**Moedas e nível de arma.** `player.moedas` e `player.armaNivel` (0..5, cada nível vale +1
de ataque permanente), ambos atravessando a descida e o save.

**Três comandos novos**, com forma textual viva para o protocolo do oracle:
`vender:gosma,3` · `comprar:potion,1` · `criar:pocao`. Todos exigem o herói **sobre** o tile
certo, recusam com registro quando inválidos (sem consumir turno) e **consomem turno** quando
válidos — negociar numa masmorra custa tempo, e é isso que dá peso à decisão de atravessar a
sala carregado de loot.

**As receitas** (tabela `RECEITAS`, fonte única que a UI lê — receita não pode existir em
dois lugares):

| Ofício | Custo | Produz |
|---|---|---|
| Alquimia | 3 frascos de gosma | 1 poção |
| Refino | 2 cimitarras | +1 de ataque (teto no nível 5) |

Poção comprada no mercador custa 15 moedas; material vendido paga o `valor` da tabela `ITENS`
(gosma 3 · orelha 5 · cimitarra 18 · pé 12 · clava 40).

**Arte nova.** Dois rigs: o **Mercador** (15u, encapuzado, fardo nas costas, olhos verdes
emissivos — no escuro o que se vê primeiro são os dois pontos) e a **Bancada** (mobília de um
tile: caldeirão de caldo verde, bigorna e brasas emissivas). Ambos entraram na folha de
revisão, e a bancada precisou de duas rodadas: as brasas ficavam **debaixo** do caldeirão e a
barriga da panela as engolia. Mesma lição do frasco ([[o-frasco-que-nao-tinha-gosma]]) por
outro caminho: numa pilha de caixas opacas, **o que está embaixo só existe se sobrar para
fora**.

**UI.** Painel de troca que aparece só quando o herói está sobre um dos pontos, em dois
modos (mercador: vender por unidade ou tudo, comprar poção; bancada: receitas com o que falta
e botão desabilitado quando falta). Moedas e nível da arma no painel de vitais. Um brilho
âmbar pulsando no tile do mercador e no da bancada convida à travessia e apaga quando o herói
chega.

## O oracle regenerado — e o teste vanilla aposentado

`snapshot()` subiu para **v3** (moedas, `armaNivel` e os dois pontos). O oracle de regressão
foi **regenerado deliberadamente** com `npm run golden:engine`.

E venceu a data de validade que o [[ADR-008-oracle-derivado-do-engine]] tinha escrito: o
`golden-vanilla.test.ts` — que comparava o engine com o oracle vanilla projetando os despojos
para fora — precisaria agora da **terceira projeção** (rebaixar v3→v2→v1, esconder duas linhas
de registro e omitir dois campos do jogador). O ADR dizia o que fazer nesse dia: **aposentar,
não inchar**. Foi apagado, e o adendo no ADR registra o que ele provou enquanto viveu (12/12
em todos os eixos na fase 1: os despojos não tocaram em nada que já existia).

Ficam no repositório, como documento: `legacy/isorogue-vanilla.html`, `tools/gen-golden.mjs` e
`test/golden/snapshots.json`.

## Verificação

- `npm run check` verde: **114 testes** (eram 140 com os 50 do vanilla projetado; a fase 2
  acrescentou 24 — 13 de engine, 5 de render, 6 de UI).
- Oracle regenerado e conferido; gerador determinístico.
- Rigs novos revisados na bancada, com correção de uma rodada na bancada de alquimia.

Achado de brinde: `test/ui.test.tsx` tinha **vazamento entre casos** — a fase da cinemática
mora em estado de módulo e ficava em `'intro'`, que trava o teclado; testes de tecla depois
disso passavam provando nada. Corrigido com reset no `beforeEach`.

## O que fica para a fase 3

As missões: matar X de um tipo **e** entregar Y itens dropados, geradas por andar, com painel
na barra lateral e recompensa em moedas/itens. Toda a matéria-prima já existe — tabela de
itens com valor, bolsa, moedas e os dois pontos de parada.

---

Vizinhos: [[despojos-e-bolsa]] · [[ADR-008-oracle-derivado-do-engine]] ·
[[2026-07-30-despojos-bolsa-e-itens-3d]] · [[o-frasco-que-nao-tinha-gosma]]
