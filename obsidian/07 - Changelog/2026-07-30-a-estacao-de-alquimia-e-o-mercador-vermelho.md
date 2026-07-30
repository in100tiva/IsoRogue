---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, mercador, alquimia, arte, referencia, oracle]
---

# 📆 30/07/2026 — A estação de alquimia e o mercador vermelho (fase 2.1)

Correção de rota depois do teste do dono na fase 2: **"o comerciante não apareceu e o balcão
de alquimia não está como eu esperava"**. Ele mandou duas referências e um requisito de
lugar. Esta entrada registra o que mudou por causa disso.

---

## 1. Eles nascem onde o herói nasce

Antes: mercador a 2–4 tiles da **escada** (que é o fim do andar) e bancada numa sala
qualquer. Resultado previsível em jogo: ninguém encontra. Agora **os dois nascem na sala
inicial**, a 2–4 tiles do ponto de partida — o mercador visível ao abrir os olhos, a estação
de alquimia logo na entrada do cômodo.

Medido: 600 andares, **0 sem mercador, 0 sem caldeirão**; 579/600 com a estação completa de
três peças (os 21 restantes são cômodos em cruz de braço estreito, que degradam para duas
peças ou uma).

Detalhe de determinismo que valeu uma frase no código: as paradas só se candidatam a tiles
**já livres** — `taken` carrega inimigos e itens quando esta seção começa —, e por isso nada
aqui move item nenhum. O consumo do rng de inimigos e itens fica intocado, e a fase 1
continua byte a byte igual (conferido: `E[...]`, `I[...]`, `rng=` e `rngL=` idênticos ao
oracle anterior; o diff é só a versão e os campos novos).

## 2. A alquimia virou uma instalação de três tiles

A referência do dono é uma **sala** de alquimia. O mundo é um grid isométrico, e um móvel de
três tiles de largura invadiria os vizinhos e romperia a ordem do pintor — a pendência que o
cofre já registra. A tradução honesta foi **três rigs, três tiles, três âncoras**:

| Peça | Papel | Tile |
|---|---|---|
| Caldeirão (caldo roxo aceso, colher, língua de fogo) | **interação** — criar e refinar | `game.bancada` |
| Estante de frascos coloridos | cenário | `game.alquimiaExtras[0]` |
| Mesa com livro aberto e vela acesa | cenário | `game.alquimiaExtras[1]` |

O engine reserva os três tiles (nada nasce embaixo), e cômodo apertado perde a **mesa
primeiro**, depois a estante; o caldeirão nunca cai. O móvel único `bancada.ts` foi apagado.

## 3. O mercador refeito sobre a referência

Saiu o vulto encapuzado genérico; entrou a criatura da ilustração: **pele vermelha** com
cauda, capuz esfarrapado, **duas lentes redondas amarelas acesas** ocupando o rosto (é por
elas que ele é reconhecido, e são emissivas: no escuro, é o que se vê primeiro), e nas costas
a **barraca de madeira com toldo de lona clara, lanterna dourada acesa no mastro**,
bugigangas penduradas e a placa com runas.

O que foi simplificado, e por quê: a ilustração tem dezenas de miudezas e runas legíveis; em
40px isso vira serrilha. Bugigangas viraram três volumes, runas viraram uma faixa clara,
dedos viraram caixa vermelha com ponta escura. É a armadilha nº 1 do método
([[legibilidade-em-40px]]).

## 4. Duas rodadas de bancada, dois erros do mesmo parente

- **Caldeirão**: as brasas nasceram tão largas e altas quanto a panela e viraram uma
  plataforma laranja que roubava a leitura do caldo. Ficou só a língua de fogo escapando pela
  frente.
- **Estante**: os frascos existiam no modelo e **não existiam na imagem** — o painel de fundo
  estava em `+Y`, que é a FRENTE do rig, e tapava as três prateleiras. Fundo movido para
  `−Y`, frascos avançados para a boca da prateleira.

Os dois são a mesma família de erro do [[o-frasco-que-nao-tinha-gosma]]: **em caixas opacas, o
que não está na superfície não está na imagem** — e a bancada de revisão é o único lugar onde
isso aparece antes do jogador.

## 5. Oracle

`snapshot()` subiu para **v4** (`alq=` com os tiles da estação, logo depois de `banc=`) e o
oracle de regressão foi **regenerado deliberadamente** com `npm run golden:engine`.

## Verificação

`npm run check` verde: **125 testes** (eram 114; +8 de engine, +2 de render, +1 de UI). Os
quatro rigs novos revisados na folha de preview, com a fileira "despojos e paradas".

---

Vizinhos: [[despojos-e-bolsa]] · [[2026-07-30-economia-alquimia-e-refino]] ·
[[o-frasco-que-nao-tinha-gosma]] · [[legibilidade-em-40px]]

---

## Adendo (mesma data) — a fase 2.2: móvel e NPC são sólidos

O teste do dono continuou: *"faltou colisão na parte de alquimia e na do mercador, para que
ao colidir com eles abra o menu"*. Fazia sentido e era barato — móvel e NPC não se atravessa.

- **Colisão**: os quatro tiles de parada (mercador, caldeirão, estante, mesa) passam a
  recusar o passo do jogador, como parede — sem consumir turno. Inimigos idem, somando os
  tiles ao `Set occupied` de `makeContext` (o Dijkstra continua `{ blocked: null }`; o
  bloqueio é só na escolha do passo, que é o mecanismo que já impede dois inimigos no mesmo
  tile).
- **Interação por adjacência**: vender, comprar e criar passam a exigir **Chebyshev ≤ 1** —
  encostar. E a estação é uma coisa só: criar funciona a partir de qualquer uma das três
  peças, porque exigir o caldeirão exato faria o jogador adivinhar o tile.
- **O esbarrão anuncia uma vez**: a mensagem mora num campo transitório não serializado —
  sem ela, martelar a direção do mercador encheria o registro de "O mercador ergue os olhos".
- **Nada de estado novo**: a abertura do painel é derivada da posição; o snapshot não ganhou
  campo. O que mudou foi a simulação (ninguém anda por cima de móvel), então o oracle foi
  **regenerado deliberadamente**.

A pegadinha que o processo pegou: os testes da fase 2 punham o jogador EM CIMA do tile — uma
posição que o jogo nunca mais produz. Teste que começa em estado impossível não prova
comportamento, prova cenário. Os helpers passaram a colocar **ao lado**, no primeiro vizinho
caminhável, e o critério "cada balcão só aceita o seu ofício" teve de aprender que mercador
e estação dividem a sala inicial.
