---
tipo: aprendizado
atualizado: 2026-07-28
tags: [headless, chrome, animacao, armadilha, render]
---

# ⏱️ O relógio virtual congela a animação

## O sintoma

Captura headless do jogo, e o guerreiro sai **inteiro tingido de creme** — cor uniforme
por cima do sprite, cobrindo armadura, escudo e espada. Parece bug de paleta, de blend
mode ou de ordem de composição. Não é nenhum dos três: o personagem está mostrado no
instante exato em que levou dano, e ficou preso lá.

## A causa

O clarão de dano é uma animação **por decaimento em `dt`**:

```ts
// src/render/IsoRenderer.ts:725-731
if (hp < v.hp) v.flash = 1;
...
if (v.flash > 0) { v.flash -= dt * 3; if (v.flash < 0) v.flash = 0; }
```

`flash` cai de 1 a 0 em 1/3 de segundo — cerca de **333 ms**. Enquanto está em 1, o
renderer pinta o quadro inteiro do sprite com `FLASH_COL`, que é
`rgba(255, 236, 222, 0.8·t)` (`src/render/palette.ts:244`): o creme.

O Chrome headless com `--virtual-time-budget` não roda um relógio real. Ele avança tempo
virtual, e um trecho síncrono pode medir **0 ms**. Quando `dt` chega ao renderer como zero
(ou perto disso), `flash -= dt*3` não subtrai nada. A animação não decai — congela no
primeiro quadro, o de intensidade máxima, que é exatamente o pior quadro para fotografar.

A mesma armadilha já tinha mordido a bancada de revisão do personagem por outro caminho:
sob relógio virtual a forja do atlas cronometrava "0,0 ms". A cura lá foi separar as duas
coisas — a primeira passada roda **sem** `--virtual-time-budget` só para medir o tempo
real, e a segunda, com o relógio virtual, recebe o número medido pelo fragmento da URL
(`tools/preview-personagem.mjs:180-190` e `:227`; `tools/preview-entry.ts:759-770`).

## A lição

`--virtual-time-budget` serve para **esperar trabalho terminar**, não para deixar o tempo
passar. Ele é ótimo para "carregue tudo, resolva as promessas, depois fotografe"; é
péssimo para qualquer coisa que dependa de duração. Toda animação baseada em `dt` fica
parada no primeiro quadro sob relógio virtual — e o primeiro quadro de um efeito de
impacto é, por design, o mais berrante.

Na prática, ao inspecionar visualmente:

- **Fotografe o jogador sem dano recente.** Se acabou de trocar golpes, espere turnos ou
  reposicione antes de capturar.
- Antes de abrir bug de cor numa captura headless, pergunte se aquilo é um estado
  transitório legítimo preso no tempo.
- Se precisar de um quadro estável de verdade, prefira desligar a animação na origem a
  tentar acertar o timing do relógio virtual.

## O que quebra se mudar

- Aumentar `--virtual-time-budget` **não** resolve: o problema não é tempo insuficiente,
  é `dt` que não avança.
- Trocar o decaimento por número de quadros em vez de `dt` faria a animação depender do
  FPS e violaria a regra de que animação não interfere na lógica — não é o caminho.

Ver [[inspecao-visual-headless]], [[revisar-o-personagem]], [[mouse-no-vertice-do-losango]]
e [[fog-of-war-e-iluminacao]].
