---
tipo: aprendizado
atualizado: 2026-07-30
tags: [render, isometrico, texto, armadilha, xp, billboard]
---

# 🔤 Texto deitado cisalha — a pré-distorção de outdoors

## O sintoma

O primeiro "+100" de XP saiu da forja como um **emaranhado de cubos dourados**. A fonte 3×5
existia, os cubos existiam, a cor estava certa — e nada lia "100". Na bancada de revisão
(`docs/ref/preview-elenco.png`), a rodada 1 foi reprovada à primeira olhada.

## A causa

Os glifos foram deitados no plano X-Z do modelo (cada pixel um cubo de 1u em `(c, 0, z)`),
como se o texto fosse uma placa fina. Mas a projeção isométrica de `docs/PERSONAGEM.md` §4.2
leva o passo +X para `(1, +0,5)` na tela e o passo +Z para `(0, −1)`: a grade da fonte
**cisalha ~26°** — cada linha do bitmap desce meio pixel por coluna. Um rig humanoide não
sofre com isso porque lê pelo VOLUME; um texto lê pelo BITMAP, e bitmap não sobrevive a
cisalhamento nenhum — em 3×5 pixels, a sheared grid é irreconhecível.

## A cura

Pré-distorcir as posições dos pixels para que, **depois da projeção**, caiam numa grade
quadrada na tela — o mesmo truque dos outdoors pintados no chão de estádios, que só leem
certo da câmera de TV. Da álgebra de §4.2 (com `A` = `ART_POR_U`):

```ts
// passo horizontal da fonte: anda 2eA em artX e ZERO em artY
(e, −e, 0)    →  ΔartX = 2eA,  ΔartY = 0
// passo vertical da fonte: anda ZERO em artX e −3fA em artY
(−f, −f, 2f)  →  ΔartX = 0,    ΔartY = −3fA
```

Com `e = 0,5` e `f = 1/3` os dois passos valem o mesmo pitch na tela e a fonte fica quadrada
e legível — `src/render/characters/xpTexto.ts`, rodada 2 aprovada. E cada pixel **continua
sendo um cubo isométrico** (topo/frente/lado, ouro quantizado por §4.3): a leitura vem do
bitmap, o volume vem do cubo. É o "3D pixel art" que o pedido queria — e não um `fillText`
liso de canvas, que quebraria o estilo por construção.

## A lição

**Em projeção fixa, o autor escreve no espaço da TELA, não no espaço do modelo.** A pergunta
certa não é "em que plano do modelo o texto fica de pé?" — é "que passos do modelo viram
`(1, 0)` e `(0, −1)` na tela?". Respondida a segunda, o primeiro ponto vira aritmética.

Vale para qualquer coisa que precise ler como imagem plana dentro do mundo isométrico:
números de dano futuros, ícones de status, letras de debug. Não virou utilitário do forge de
propósito — vive em `xpTexto.ts` até um segundo texto precisar dela (a regra dos três casos).

## O que quebra se mudar

- "Simplificar" os passos para inteiros (`(1, −1, 0)`, `(−1, −1, 2)`) — a fonte continua
  quadrada, mas cada cubo vira 2× o pitch e os pixels se fundem: a leitura morre de novo,
  agora por excesso de contato em vez de cisalhamento.
- Deitar o texto de volta no plano X-Z "porque agora a fonte é melhor" — o cisalhamento é
  geométrico, não depende da fonte. Qualquer bitmap no plano X-Z sai inclinado.
- Mudar `ART_POR_U` muda o pitch da tela sem mudar a grade: os passos `e`/`f` são em unidades
  do modelo e o pitch de tela sai de `A` dos dois lados — a fonte continua quadrada, só maior
  ou menor. É a propriedade que a conta acima foi feita para ter.

Ver também: [[projecao-isometrica]], [[pixel-art-nasce-da-rasterizacao]],
[[armadilha-do-yaw-isometrico]], [[legibilidade-em-40px]], [[bestiario-monstros]].
