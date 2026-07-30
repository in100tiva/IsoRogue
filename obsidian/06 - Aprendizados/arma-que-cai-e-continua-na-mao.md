---
tipo: aprendizado
atualizado: 2026-07-30
tags: [aprendizado, morte, atlas, animacao, render, armadilha]
---

# ⚔️ A arma que cai e continua na mão

## O sintoma

Relato do dono sobre a cinemática de morte do Guerreiro: *"ele solta a espada e cai no
chão, mas parece que a espada continua na mão dele mesmo mostrando a espada sendo
derrubada, como se tivessem 2 espadas"*.

E tinham mesmo — duas, na tela, ao mesmo tempo, por **0,75 s**.

## A causa

A sequência de morte tem duas linhas do tempo independentes, e elas não se falavam:

| Quando | A espada solta | O corpo |
|---|---|---|
| 0,00 s | na mão (não desenhada à parte) | atlas normal — **com espada** |
| 0,15 s | **começa a cair** (`MORTE_ESPADA_INICIO`) | atlas normal — **ainda com espada** |
| 0,90 s | pousa (`MORTE_ESPADA_FIM`) | troca para AJOELHADO — sem espada |

Entre 0,15 e 0,90 o corpo continuava sendo `atlasDoGuerreiro()`, que é o rig completo,
com a espada modelada na mão. A espada solta é um **rig próprio** desenhado por cima. Duas
espadas.

O detalhe que faz isso escapar da revisão: os atlas de **ajoelhado** e **caído** já eram
forjados sobre `MODELO_GUERREIRO_SEM_ESPADA` — ou seja, o problema estava resolvido para o
fim da sequência e só existia na janela do meio, que é justamente a que ninguém congela
numa bancada. A folha de revisão mostrava as poses finais, todas corretas.

Pior: a decisão foi **consciente e registrada**. O relatório da fase dizia "há sobreposição
breve espada-na-mão/espada-caindo, que lê como 'soltando da mão'. Um 3º atlas foi avaliado e
recusado por fugir da spec". A hipótese era que 0,75 s de sobreposição leria como transição.
Não lê. Lê como duas espadas.

## A cura

Um terceiro atlas: **em pé, sem a arma** (`FORJA_MORTE_PARADO`, o mesmo repouso do atlas
normal sobre `MODELO_GUERREIRO_SEM_ESPADA`), usado a partir do **mesmo instante** em que a
arma solta começa a cair:

```ts
if (t >= MORTE_CAIDO) corpo = this.atlasDeMorte('caido');
else if (t >= MORTE_AJOELHADO) corpo = this.atlasDeMorte('ajoelhado');
else if (t >= MORTE_ESPADA_INICIO) corpo = this.atlasDeMorte('parado'); // ← a cura
else corpo = this.atlasDoGuerreiro();
```

O mesmo defeito existia — mais curto, e por isso ainda não notado — nos monstros que o
[[2026-07-30-abates-balanceamento-e-xp-visivel|abate cinematográfico]] trouxe: Goblin com a
cimitarra caindo em 0,1 s contra o agachado em 0,3 s (0,2 s de arma dupla) e Ogro com a
marreta em 0,2 s contra o agachado em 0,45 s (0,25 s). Curados do mesmo jeito, com
`atlasMorteDe(kind, 'parado')` sobre os rigs sem arma que já existiam.

## A lição

**Quando um objeto sai de um personagem, o instante em que ele começa a existir sozinho é o
mesmo em que ele tem de sumir do rig.** Não há janela aceitável de sobreposição: o olho lê
duas cópias, não uma transferência.

Generalizando para a próxima cinemática de despojo: a troca de rig e o nascimento do prop
são **um evento só** e devem depender da MESMA constante de tempo. Se o código tem duas
comparações contra constantes diferentes para a mesma transição, o bug já está escrito.

E a lição de processo: uma folha de revisão que congela **só as poses finais** não prova a
sequência. As janelas intermediárias — as que existem entre duas trocas — são onde mora este
tipo de artefato. Por isso a bancada agora tem a fileira "em pé, JÁ SEM a arma" para os três
personagens armados: o quadro do meio virou revisável.

## O que quebra se mudar

- **Adiantar `MORTE_ESPADA_INICIO` sem adiantar a troca de atlas** (ou vice-versa) — o
  defeito volta, e volta silencioso: nenhum teste falha, porque a diferença é de pixels
  numa janela de menos de um segundo.
- **Forjar o atlas "parado sem arma" com repouso diferente do normal** — a troca deixa de
  ser invisível e vira um solavanco no meio da queda.

---

Vizinhos: [[2026-07-29-cinematicas-do-guerreiro]] · [[bestiario-monstros]] ·
[[sprite-forge]] · [[revisar-o-personagem]] · [[legibilidade-em-40px]]
