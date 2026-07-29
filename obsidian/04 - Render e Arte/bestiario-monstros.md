---
tipo: nota
atualizado: 2026-07-28
tags: [render, bestiario, monstros, sprite, emissivo]
---

# 👺 O bestiário — três monstros, nenhum arquétipo novo

`docs/BESTIARIO.md` é o contrato desta pasta e ele começa por uma proibição, não por uma
receita. Vale a pena começar por ela também aqui, porque é o que separa "dar rosto a um
inimigo" de "acrescentar um inimigo ao jogo" — duas coisas que parecem a mesma e têm preços
opostos.

## O que é um monstro neste jogo

**Monstro é aparência de arquétipo. Nunca comportamento novo.**

O engine tem exatamente três arquétipos — `chaser`, `sentinel`, `linker`
(`src/engine/entities.ts:50-96`, ver [[arquetipos-de-inimigo]]) — e o [[golden-test]] congela
**quantos e quais** inimigos nascem em cada uma das 12 sementes. Um arquétipo a mais mudaria
`populate()` e invalidaria os 12 casos de uma vez.

Então o Goblin não é uma criatura: é o **rosto** do `chaser` que já existia. O Slime é o rosto
do `linker`, o Ogro é o do `sentinel`. Hp, atk, alcance, IA, peso de spawn e ordem de `KINDS`
continuam byte a byte o que eram antes da fase. A decisão e o preço dela estão em
[[ADR-007-monstro-e-aparencia-nao-arquetipo]].

A segunda proibição é gêmea: **o `facing` do inimigo não entra no engine**. Ele é derivado por
observação da mudança de tile entre turnos, em `orientarInimigo`
(`src/render/IsoRenderer.ts:762`, chamado de `:733`), e mora no `Vfx` do renderizador. Nenhum
campo novo em `Enemy`, em `snapshot()`, no save ou no oracle — o mesmo raciocínio de
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]], levado ao caso em que dá para derivar sem
custo nenhum.

## `RETRATOS` — o ponto de extensão

Uma tabela, no topo do `IsoRenderer` (`src/render/IsoRenderer.ts:262`):

```ts
const RETRATOS: Readonly<Partial<Record<ArchetypeKey, FichaDeSprite>>> = {
  chaser:   { modelo: MODELO_GOBLIN, forja: FORJA_GOBLIN },
  linker:   { modelo: MODELO_SLIME,  forja: FORJA_SLIME },
  sentinel: { modelo: MODELO_OGRO,   forja: FORJA_OGRO }
};
```

`FichaDeSprite` é o par (rig, opções de forja) e nada mais. `Partial<Record<...>>` é o que
sustenta a bifurcação: quem tem ficha vira sprite, quem não tem cai no desenho geométrico.
`drawEnemy` decide isso em uma linha (`src/render/IsoRenderer.ts:1226-1229`) e nenhum dos dois
caminhos sabe do outro — os dois só devolvem o Y de tela onde a barra de vida deve pendurar,
porque só eles sabem onde termina o desenho que fizeram.

O atlas é forjado **sob demanda**, no primeiro desenho daquele bicho, e cacheado por arquétipo
em `atlasDoInimigo` (`src/render/IsoRenderer.ts:1242`). A distinção `undefined` = nunca
perguntado / `null` = perguntado e não há atlas é o que impede uma forja malsucedida de ser
retentada a cada frame — mesmo padrão do `atlasTentado` do jogador
([[ADR-006-atlas-forjado-em-runtime]]).

### O caminho geométrico não é código morto

Com os três arquétipos em sprite, o desenho por formas — triângulo, hexágono, duplo-losango do
vanilla — deixou de ser o caminho normal de ninguém. Ele continua no arquivo
(`desenharInimigoGeometrico`, `src/render/IsoRenderer.ts:1337`) como **rede de segurança de
quem não conseguiu forjar**: em jsdom e em Node não existe `getContext('2d')`, o atlas nasce
com `disponivel: false` e sem esse caminho os inimigos sumiriam da tela em todo ambiente sem
Canvas — inclusive nos testes. Apagá-lo é a tentação óbvia desta pasta e está errada.

## Os três passos para o próximo bicho

1. escreva `src/render/characters/<bicho>.ts` no molde de `goblin.ts` — exporte `MODELO_*`,
   `PALETA_*`, `RAMPAS_*`, `RAMPA_DA_COR_*`, `POSE_PARADA_*` e, se ele tiver parte que brilha
   no escuro, `CORES_EMISSIVAS_*`. O sprite forge não pode precisar saber qual personagem está
   forjando ([[sprite-forge]]);
2. declare a constante `FORJA_<BICHO>` ao lado de `FORJA_GOBLIN`
   (`src/render/IsoRenderer.ts:160`), em **constante de módulo** — o forge memoiza por
   (modelo, opções) e um objeto novo a cada chamada geraria uma chave nova;
3. acrescente **uma linha** em `RETRATOS`.

Nada mais muda: orientação, modulação por luz, sombra elíptica, barra de vida e clarão de dano
já são genéricos. O Slime e o Ogro comprovaram isso — entraram com dois imports, duas
constantes e duas linhas na tabela, e **zero** mudança em `drawEnemy`, em
`desenharSpriteInimigo`, em `quadroDoInimigo` ou na âncora.

O que os três passos **não** compram: um quarto monstro. `RETRATOS` é indexada por
`ArchetypeKey` e as três linhas de hoje esgotam a união. Bicho novo é bicho de comportamento
novo, e isso é mudança de `populate()` com regeneração deliberada do oracle — ver
[[ADR-007-monstro-e-aparencia-nao-arquetipo]].

## Modulação por luz

O jogador sai sempre em brilho pleno porque ele **é** a fonte de luz. Um inimigo no limite do
campo de visão não pode: sairia chapado, colado na frente do cenário, destruindo a leitura de
profundidade que o [[fog-of-war-e-iluminacao]] constrói. Era esta a dívida registrada como
`TODO(inimigos-no-atlas)` até a fase passada, e ela está paga.

A regra que evita a solução ingênua: **o atlas continua sendo forjado uma vez, em brilho
pleno**. Um atlas por nível de luz multiplicaria a memória por nada. O escurecimento é
aplicado no desenho, por `quadroModulado()` (`src/render/spriteForge.ts:1423`), e a chamada no
renderizador é uma linha só (`src/render/IsoRenderer.ts:1304`):

```ts
const f = quadroModulado(atlas, v.facing, q.estado, q.frame, lvl / (LEVELS - 1));
```

A divisão fica **visível na chamada**, e não escondida lá dentro, de propósito: `lvl` é o
índice inteiro das LUTs do renderizador e o forge quer fração 0..1. Escondê-la faria o forge
refém do número de níveis de `./palette`.

Quatro números carregam o mecanismo:

- **`DEGRAUS_LUZ = 8`** (`src/render/spriteForge.ts:1246`). O degrau 7 é brilho pleno e devolve
  o próprio atlas sem tingir; sobram 7 níveis de sombra, um a cada ~7,4% de alfa. Abaixo disso
  dois degraus vizinhos somem no ruído do pixel art; acima, o cache cresce sem ganho visível.
- **`ALFA_SOMBRA_MAX = 0.52`** (`src/render/spriteForge.ts:1279`), calibrado para reproduzir o
  que `litEntity` de `./palette` já fazia com os inimigos geométricos (meio brilho no nível 0).
  Isso importa justamente porque o caminho geométrico não saiu do jogo: se um ambiente cair
  para o losango, ele tem de escurecer igual, senão a leitura de profundidade muda conforme o
  ambiente. Medido nos quatro atlas do elenco, a queda de luminância do corpo entre brilho
  pleno e degrau 0 ficou em 45,5% (Guerreiro), 44,2% (Goblin), 44,9% (Slime) e 46,0% (Ogro).
- **Cache de 64 slots** (`src/render/spriteForge.ts:1294`). O universo de pares (quadro,
  degrau) é 72 × 7 = 504, o que daria ~12 MiB por personagem; o conjunto de trabalho real tem o
  tamanho do número de inimigos na tela. 64 slots numa folha 8×8 fixam a memória em ~1,4 MiB
  independentemente do tamanho do bestiário.
- **Despejo por LRU com relógio lógico em `Float64Array`**, não por ordem de inserção de `Map`:
  promover uma entrada num `Map` custa `delete` + `set` a cada desenho de cada inimigo, que é o
  caminho quente. Depois do cache quente, um quadro modulado custa um `Map.get` numérico e uma
  escrita em array tipado — nenhum canvas, nenhum `getImageData`, nenhum pixel novo.

O clarão de dano tinge o quadro **já escurecido** (`src/render/IsoRenderer.ts:1320`):
`FLASH_COL` tem alfa < 1, então a cor por baixo importa, e um clarão sobre o quadro cru
acenderia um inimigo que está no escuro.

## As cores emissivas

A parte que dá alma ao bestiário e custa quase nada: uma cor da paleta pode ser declarada
**emissiva** e então ignora a modulação. Um goblin no escuro vira dois pontos vermelhos
encarando você.

O contrato para o autor do personagem é passar o **nome da cor na paleta**:

| Bicho | `CORES_EMISSIVAS_*` | O que acende |
|---|---|---|
| Goblin | `['olhoBrasa']` (`src/render/characters/goblin.ts:235`) | os olhos (I4) |
| Slime | `['luzAmbar']` (`src/render/characters/slime.ts:180`) | os olhos em `+` (S4) **e** a bolinha da antena (S5) |
| Ogro | `[]` (`src/render/characters/ogre.ts:165`) | nada — a §12.2 não declara cor emissiva |

A lista vazia do Ogro é decisão, não omissão: inventar uma cor fora da paleta reprovaria o gate
G5 por construção. O forge trata vazio como ausente — nenhuma camada extra é alocada e
`quadroModulado()` cai no tingimento simples —, então passar a constante custa zero e evita um
`if` por personagem numa tabela que existe justamente para não ter nenhum. No escuro o Ogro não
acende: ele é grande demais para caber no tile, e é assim que se lê ogro a três tiles.

A implementação **não** é um caso especial no tingimento. Na forja, uma única varredura do
atlas pronto extrai uma **camada emissiva** — uma folha do mesmo tamanho onde só sobrevivem os
pixels cuja cor final é uma das emissivas (`src/render/spriteForge.ts:1205`). Depois, o
escurecimento é aplicado ao quadro inteiro e a camada é recolada por cima com `source-over`, em
brilho pleno. Uma varredura na forja, zero trabalho por frame, e nenhuma dependência da posição
das peças no rig — que é o que quebraria a cada ajuste visual.

Detalhe que morde: dê à cor emissiva uma rampa própria (ou nenhuma). Se ela cair na rampa de
outro material, o snap da paleta pode cobrir o pixel emissivo inteiro com um degrau vizinho — e
aí não sobra pixel emissivo nenhum para recolar.

## O elenco, medido

As quatro escalas são reais: a diferença de tamanho na tela vem da **altura do modelo em `u`**,
nunca de um fator de zoom aplicado no sprite. Da bancada `npm run preview:elenco`:

| Personagem | Altura declarada | Forja | Corpo acima do chão (px de arte, dir 2) |
|---|---|---|---|
| Slime | 7u | 32 ms | 24 px |
| Goblin | 13u | 33 ms | 38 px |
| Guerreiro | 18u | 28 ms | 48 px |
| Ogro | 24u | 53 ms | 73 px |

A cadeia de G10 — Slime < Goblin < Guerreiro < Ogro — fecha. O que **não** fecha, e a bancada
diz isso em vermelho, é a razão percentual contra o alvo: o medido é o pixel de corpo mais
alto, e isso inclui crista, orelha, antena e espinho, que nenhum dos quatro contratos conta na
altura declarada. O veredito de G10 é a **cadeia**, não a porcentagem; quem calibrar o quinto
bicho pela porcentagem vai achatá-lo sem motivo.

O Ogro é o mais caro de forjar (53 ms) porque é o maior rig e o buffer de arte cresce com o
quadrado da altura. Como a forja é sob demanda e por arquétipo, esse custo só é pago quando o
primeiro `sentinel` aparece na tela.

## O que quebra se mudar

- **Acrescentar arquétipo para acrescentar monstro** — 12 casos do oracle caem juntos. É a
  regra que a fase inteira existe para respeitar; ver
  [[ADR-007-monstro-e-aparencia-nao-arquetipo]].
- **Apagar `desenharInimigoGeometrico`** — os inimigos somem da tela em jsdom, em Node e em
  qualquer ambiente sem contexto 2D.
- **Forjar um atlas por nível de luz** — multiplica a memória do bestiário por 8 para produzir
  o que o tingimento cacheado já dá com 64 slots.
- **Tingir o clarão de dano antes da modulação** — inimigo no escuro acende ao levar dano.
- **Renomear um nó de rig sem ler o bloco de nomes do arquivo do bicho** — a `Pose` é indexada
  por string e um nó inexistente simplesmente não gira, **em silêncio**
  ([[personagem-rig-3d]]). No Slime isso é especialmente traiçoeiro: a antena está pendurada
  num nó chamado `bracoDir` de propósito, e é por esse canal que o chicote do bote entra.
- **Somar o `hop` do desenho geométrico ao sprite** — o quique da marcha e o peso do golpe já
  estão dentro dos quadros de animação; somados, o bicho salta duas vezes por passo.

Ver também: [[sprite-forge]], [[personagem-rig-3d]], [[paleta-e-estilo]],
[[fog-of-war-e-iluminacao]], [[arquetipos-de-inimigo]], [[legibilidade-em-40px]],
[[revisar-o-personagem]].
