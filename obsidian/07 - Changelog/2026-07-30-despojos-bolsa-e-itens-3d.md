---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, despojos, loot, bolsa, itens, oracle]
---

# 📆 30/07/2026 — Despojos, bolsa e os itens em 3D

**Fase 1 de 3** do sistema de itens pedido pelo dono. Esta entrega o que se vê e se pega;
a economia (mercador), a alquimia/refino (bancada) e as missões vêm nas fases 2 e 3, e o
terreno para elas já está preparado.

---

## O que mudou

**Monstros largam despojos.** Cada abate rola a tabela `DROPS`: Slime → frasco de gosma
(70%), Goblin → orelha (50%) e cimitarra (15%), Ogro → pé (45%) e clava (20%). Sorteios
independentes, ordem fixa, item no **tile onde o bicho morreu**, empilhando quando cai mais
de um. Ver [[despojos-e-bolsa]].

**O herói recolhe pisando.** `pegarItem` deixou de assumir poção: recolhe a pilha inteira num
passo, poção vai para o contador de sempre, material para a **bolsa** (`player.bag`), com
uma linha de registro por tipo, no plural certo.

**Os cinco itens têm modelo 3D.** Três rigs novos no método de sempre — `itemGosma.ts`
(4,0u), `itemOrelhaGoblin.ts` (3,2u), `itemPeOgro.ts` (4,9u) — e dois reaproveitados:
`MODELO_CIMITARRA` e `MODELO_MARRETA`, que já existiam para a cinemática de abate. No chão
eles são sprite forjado sob demanda, escurecem com a luz do tile como qualquer entidade, e
caem no desenho geométrico de reserva onde não há canvas.

**Bolsa na barra lateral.** `BagPanel` lista o que o herói carrega, com nome, quantidade e o
valor unitário em moedas — o preço aparece antes de existir mercador de propósito: item sem
preço visível não vira decisão.

**Feedback de coleta.** Brilho âmbar no losango e o sprite dando um pop para cima enquanto
esmaece (0,35 s), tudo derivado por observação do estado — nem uma linha de engine no render
(R54), e com `prefers-reduced-motion` sobra só o brilho.

## O preço: o oracle mudou de dono

O `snapshot()` subiu para **v2** (itens publicam `kind`, a bolsa e o `rngLoot` entram), e com
isso o golden test caiu inteiro. A saída **não** foi reimplementar despojos dentro do HTML
vanilla congelado: foi o [[ADR-008-oracle-derivado-do-engine]] — o oracle passa a ser gerado
do próprio engine (`npm run golden:engine`), e muda de papel, de prova de paridade da
migração para baseline de regressão.

O que se perde está registrado no ADR. O que **não** se perdeu: um teste novo
(`golden-vanilla.test.ts`) continua comparando o engine com o oracle vanilla projetando os
despojos para fora — e passa **12/12 em todos os eixos**, o que prova que o sistema novo não
tocou em nada que já existia. Ele tem data de validade declarada: quando a fase 2 exigir a
terceira projeção, o certo é aposentá-lo, não inchá-lo.

## O determinismo, preservado

Stream próprio: `rngLoot = makeRng(hash32(seed + '#loot' + depth))`. Loot **nunca** consome
`rngCombat` — se consumisse, a sorte do despojo mudaria o dano do turno seguinte. Cada abate
gasta um número fixo de valores, então a posição do stream depende de quais monstros
morreram, nunca do que caiu. Coberto por teste que perturba só o loot e compara o combate
comando a comando.

## Três rodadas de bancada

O frasco de gosma reprovou duas vezes antes de passar, e as duas causas viraram
[[o-frasco-que-nao-tinha-gosma]]: **caixa opaca não guarda conteúdo** (o líquido modelado
"dentro" do vidro simplesmente não existe na imagem — o conteúdo tem de ser a superfície) e
**abaixo de ~0,5u a peça não rasteriza** (o ombro fino furou o sprite e deixou o fundo
vazar). A bancada ganhou uma faixa nova, "despojos — o que este bicho larga ao morrer", nas
folhas do Slime, do Goblin e do Ogro.

## Verificação

- `npm run check` verde: fronteiras + typecheck (src e tools) + **140 testes** (eram 77).
- Novos: 7 de engine (tabelas, determinismo, independência de streams, empilhamento,
  save/restore, formato do snapshot), 4 de render, 1 de bolsa, e os 50 do oracle novo mais
  50 do oracle vanilla projetado.
- Gerador do oracle rodado duas vezes em processos separados: mesmo sha256.

## O que fica para a fase 2

Mercador que nasce na masmorra (vender), bancada de alquimia e refino (gosma → poção, ferro
da cimitarra → arma melhor). A fase 3 traz as missões. Pendência de arte anotada: cimitarra e
clava ficam **em pé** no chão, diferente do rastro deitado da cinemática de morte — decisão a
confirmar com o dono.

---

Vizinhos: [[despojos-e-bolsa]] · [[ADR-008-oracle-derivado-do-engine]] ·
[[o-frasco-que-nao-tinha-gosma]] · [[golden-test]]
