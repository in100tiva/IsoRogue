# ISOROGUE — Sistema de Personagem 3D (spec do Guerreiro)

> Método adaptado do **img2threejs** (https://github.com/img2threejs/img2threejs):
> reconstrução **por código**, a partir de uma spec derivada da imagem de referência,
> em passes revisados visualmente contra ela. Sem fotogrametria, sem malha importada,
> sem pacote de arte baixado — o que casa com a restrição do projeto (R02: nenhum
> recurso externo) e com o R08 ("personagens feitos com formas geométricas").
>
> Diferença em relação ao original: **não usamos Three.js**. O projeto é Canvas 2D sem
> dependências. Trocamos `THREE.Group` por um rig próprio de caixas orientadas,
> projetado isometricamente e rasterizado em sprites gerados em runtime.

Referência: `docs/ref/guerreiro-referencia.png` (151×151, pixel art).
**Olhe para ela antes de escrever qualquer linha.**

---

## 1. Intake — leitura da referência

Guerreiro humanoide em armadura completa, pose 3/4, sobre um bloco de terra com grama
(o bloco é o "tile" — nós já temos o nosso, então **o bloco não faz parte do modelo**).

Inventário de identidade (o que faz ele ser *este* guerreiro, e não um boneco qualquer):

| # | Traço | Observação na referência |
|---|---|---|
| I1 | Armadura dourada/bronze integral | domina a silhueta; 4 níveis de tom |
| I2 | Elmo fechado com viseira escura | sem rosto visível — só a fenda escura |
| I3 | Ombreiras volumosas e arredondadas | mais largas que o tórax; definem a silhueta |
| I4 | Espada longa erguida na diagonal | lâmina clara fria contrastando com o ouro |
| I5 | Escudo redondo grande | ocupa quase metade da altura do torso |
| I6 | Contorno escuro contínuo | outline de 1px de arte em toda a silhueta |
| I7 | Paleta curta e saturada | ~8 cores úteis, sem gradiente contínuo |
| I8 | Proporção heroica | cabeça grande, pernas curtas, tronco largo (≈4 cabeças) |

Perder I3, I4 ou I5 descaracteriza o personagem. Perder I6 mata o estilo pixel art.

---

## 2. Paleta canônica (amostrada da referência)

```ts
export const PALETA_GUERREIRO = {
  ouroLuz:    '#f2d693',  // topo de ombreira, brilho do elmo
  ouroBase:   '#d9a441',  // placas em geral
  ouroMeio:   '#a8702c',  // faces laterais
  ouroSombra: '#6d4418',  // faces afastadas, vãos
  couro:      '#6b4526',  // correias, cabo da espada
  acoLuz:     '#eef2f8',  // fio da lâmina
  acoBase:    '#c2ccda',  // corpo da lâmina
  acoSombra:  '#8b96a8',  // face escura da lâmina
  vazio:      '#241a12',  // viseira, juntas, sombra interna
  contorno:   '#191008'   // outline
} as const;
```

Regra de material: **toda face recebe a cor da peça modulada pela orientação**, nunca uma
cor arbitrária. Ver §4.3.

---

## 3. Sistema de coordenadas e escala

Espaço local do modelo (destro, unidades "u"):

- **+X** = direita do personagem
- **+Y** = frente do personagem (para onde ele olha)
- **+Z** = para cima
- Origem `(0,0,0)` = centro dos pés, no chão.

Escala canônica:

```
ALTURA_MODELO   = 18u   (pés ao topo do elmo)
LARGURA_OMBROS  = 11u   (com ombreiras)
ART_POR_U       = 1.25  px de arte por unidade  -> ~22px de arte de altura
PIXEL           = 2     px de tela por px de arte, em zoom 1
```

Ou seja: o sprite final tem ~45px de altura em zoom 1 — um pouco mais alto que uma parede
(`WALL_H = 36`), coerente com a referência, onde o guerreiro é maior que o bloco.

**O pixel art nasce da rasterização**: o modelo 3D é desenhado num buffer de *arte* (baixa
resolução), e só depois ampliado ×`PIXEL` com `imageSmoothingEnabled = false`. É isso que
produz blocos quadrados nítidos em vez de 3D liso. Não inverta essa ordem.

---

## 4. Pipeline de render (`src/render/model3d.ts`)

### 4.1 Estruturas

```ts
export interface Caixa {
  cx: number; cy: number; cz: number;      // centro, em u, no espaço do NÓ
  sx: number; sy: number; sz: number;      // dimensões (largura, profundidade, altura)
  cor: keyof typeof PALETA_GUERREIRO;      // cor base da peça
  contorno?: boolean;                      // desenha outline nas arestas visíveis (padrão true)
}

export interface No {
  nome: string;
  pivo: [number, number, number];          // posição do pivô no espaço do PAI
  caixas: Caixa[];
  filhos?: No[];
}

export interface Pose { [nomeDoNo: string]: { rx?: number; ry?: number; rz?: number } }
```

Rotação de nó em radianos, ordem **Z → Y → X** (yaw, pitch, roll), aplicada no pivô.

### 4.2 Projeção

Para um vértice `v` no espaço do modelo, já rotacionado pelo `facing` (§5):

```
artX =  (v.x - v.y) * (ART_POR_U * COS_ISO)      // COS_ISO = 1.0
artY =  (v.x + v.y) * (ART_POR_U * 0.5) - v.z * ART_POR_U
```

A razão 2:1 no eixo horizontal e o fator 0.5 no vertical reproduzem a mesma projeção
isométrica do mundo (`TW/TH = 64/32 = 2`), então o personagem "senta" no losango do tile
com a mesma perspectiva das paredes. **Não invente outra projeção** — se divergir, o
personagem parece colado num plano diferente do chão.

### 4.3 Faces e sombreamento

Cada caixa gera 6 faces. Descarte por back-face culling: a face é visível se sua normal,
depois de todas as rotações, tiver produto escalar positivo com a direção de visão
`(1, 1, 1)` normalizada (o observador está no "alto do nordeste" do modelo).

Fator de luz por face, coerente com as paredes do jogo (§8 do CONTRACTS.md):

| Face | Normal | Fator |
|---|---|---|
| topo | +Z | 1.00 |
| frente/esquerda visual | +Y | 0.82 |
| lado/direita visual | +X | 0.68 |
| demais | — | descartadas |

Para faces rotacionadas (a maioria, por causa do facing), interpole o fator pelo ângulo
entre a normal e cada eixo — nunca "escolha o mais próximo", isso cria degraus feios ao
girar. Aplique o fator multiplicando o RGB da cor da peça e **quantize o resultado para a
paleta de 4 tons daquele material** (ouroLuz/ouroBase/ouroMeio/ouroSombra). A quantização é
o que mantém a cara de pixel art em vez de 3D com iluminação contínua.

### 4.4 Ordem de pintura

Sem z-buffer: ordene as faces por profundidade do centro, `depth = wx + wy + wz`,
desenhando da **menor para a maior**. Empate resolvido pela ordem de declaração das caixas
(determinístico). Um rig humanoide com partes que não se interpenetram fica correto; a
espada é o caso limite — declare-a por último dentro do braço direito.

### 4.5 Contorno

Depois de pintar todas as faces de uma peça, trace as arestas de silhueta em `contorno`
com 1px de arte. Barato e é o que dá o acabamento da referência (I6).

---

## 5. Facing — 8 direções (o pedido central)

O modelo é rotacionado em torno de **Z** antes de projetar:

```ts
// dir é o índice em R.DIRS8 do engine (ORDEM FIXA — não reordene):
// 0:(1,0) 1:(1,1) 2:(0,1) 3:(-1,1) 4:(-1,0) 5:(-1,-1) 6:(0,-1) 7:(1,-1)
const yaw = Math.atan2(DIRS8[dir][1], DIRS8[dir][0]);
```

A frente do modelo (+Y) deve apontar para a direção do grid em que o personagem se moveu.
Verificação obrigatória: andando para **leste do grid** (tecla `D`, delta `(1,0)`), na tela
ele caminha para **baixo-direita** e o rosto/escudo têm de estar voltados para lá — não para
o observador.

### 5.1 Onde mora o `facing`

`player.facing: number` (0..7), no engine, atualizado em `applyCommand`:

- comando `move` **aceito** → `facing = índice do delta`;
- comando `move` que virou **ataque** → `facing = índice do delta` (ele encara o alvo);
- comando `move` **bloqueado por parede** → `facing` atualiza mesmo assim (ele se vira);
- `wait`, `use`, `descend` → inalterado.

**`facing` é cosmético e NÃO pode vazar para o oracle.** Ele não entra em `snapshot()` e não
entra em `extrairJogador()` do golden — mesmo tratamento que o `bump` dos inimigos já recebe.
Ajuste necessário e permitido em `test/golden.test.ts`: a assinatura
`extrairJogador(p: Player): Player` passa a devolver `Omit<Player, 'facing'>`. Isso é
correção de **tipo**, não afrouxamento de teste: os valores comparados continuam os mesmos.
Se o golden ficar vermelho por qualquer outro motivo, **pare** — você quebrou comportamento.

Valor inicial: `facing = 2` (sul do grid, `(0,1)`), que na tela olha para baixo-esquerda,
a pose mais próxima da referência.

---

## 6. Animação (visual, jamais lógica — R54)

Estados e frames, todos gerados por pose paramétrica:

| Estado | Frames | Descrição |
|---|---|---|
| `parado` | 2 | respiração: torso ±0.25u em Z, ciclo lento |
| `andando` | 4 | pernas ±22°, braços contrapostos ±14°, torso oscila 3° em Z, quique de 0.4u |
| `atacando` | 3 | braço direito: −40° → +55° em X, torso acompanha 8° |

Regras invioláveis:

- Nada disso toca o estado do engine. A fase da animação vive na camada de render,
  alimentada por `dt`.
- O turno **não espera** a animação: o estado lógico já mudou; a animação só ilustra.
- Ao trocar de tile, o sprite interpola a posição entre o tile antigo e o novo em ~120ms
  (isso já é o comportamento da câmera; agora vale para o personagem).
- `atacando` dispara quando o jogador causa dano; dura o tempo da animação e volta a
  `parado`/`andando`.

---

## 7. Sprite forge (`src/render/spriteForge.ts`)

Renderizar o rig 3D a cada frame para cada personagem é desperdício: o modelo só tem
8 direções × poucos frames. **Pré-renderize um atlas em runtime**, uma vez, e depois só
`drawImage`.

```ts
export interface AtlasPersonagem {
  canvas: HTMLCanvasElement;    // atlas completo
  larguraFrame: number; alturaFrame: number;
  ancoraX: number; ancoraY: number;   // ponto do sprite que assenta no centro do tile
  quadro(dir: number, estado: Estado, frame: number): { sx: number; sy: number };
}
export function forjarAtlas(modelo: No, opts): AtlasPersonagem
```

- 8 direções × (2 parado + 4 andando + 3 atacando) = **72 quadros**.
- Cada quadro: rasteriza o rig num buffer de arte, amplia ×`PIXEL` com
  `imageSmoothingEnabled = false`, cola no atlas.
- Geração **determinística**: sem `Math.random`. Se quiser desgaste/arranhões na armadura,
  use um RNG do engine com semente fixa do modelo.
- Custo alvo: < 40ms na inicialização. Faça sob demanda (na primeira vez que o personagem
  for desenhado) e guarde em cache por modelo.
- O atlas é `HTMLCanvasElement`, criado via `document.createElement('canvas')` — portanto
  vive em `src/render/`, **nunca** no engine. Degrade sem lançar quando não houver
  `getContext('2d')` (jsdom).

### 7.1 Iluminação

O jogador **é a fonte de luz** do jogo, então desenhe-o com brilho pleno — não module o
sprite pela luz do tile. Quando os inimigos migrarem para este sistema (fase futura), aí sim
será preciso um caminho de modulação; deixe um `TODO` nomeado, não implemente por antecipação.

---

## 8. O rig do Guerreiro (`src/render/characters/warrior.ts`)

Blockout obrigatório — dimensões em `u`, `cz` medido a partir do chão. Ajuste fino é
esperado na revisão visual; a **estrutura** e as proporções não.

```
raiz (0,0,0)
├─ quadril           pivô (0, 0, 6.6)
│  └─ pelve          6.0 × 3.8 × 2.6   cor ouroBase
├─ torso             pivô (0, 0, 8.8)
│  ├─ peitoral       7.2 × 4.4 × 5.0   ouroBase      (placa central)
│  ├─ gorjal         4.0 × 3.6 × 1.2   ouroMeio      cz +2.8  (pescoço/colar)
│  ├─ cinto          6.4 × 4.0 × 1.0   couro         cz −2.4
│  ├─ ombreira.esq   3.6 × 4.2 × 2.8   ouroLuz       cx −4.6, cz +2.2   ← I3
│  └─ ombreira.dir   3.6 × 4.2 × 2.8   ouroLuz       cx +4.6, cz +2.2   ← I3
├─ cabeca            pivô (0, 0, 14.4)
│  ├─ elmo           4.6 × 4.6 × 4.0   ouroBase                        ← I2
│  ├─ viseira        4.7 × 0.8 × 1.4   vazio         cy +2.2, cz +0.2  ← I2
│  └─ crista         0.9 × 3.6 × 1.2   ouroLuz       cz +2.4
├─ bracoDir          pivô (+5.0, 0, 12.9)     ← empunha a espada
│  ├─ umero          2.2 × 2.2 × 3.6   ouroMeio      cz −1.8
│  ├─ antebraco      2.0 × 2.0 × 3.2   ouroBase      cz −5.0
│  ├─ manopla        2.4 × 2.4 × 1.2   ouroLuz       cz −6.8
│  └─ espada         (declare por último — §4.4)                        ← I4
│     ├─ punho       0.9 × 0.9 × 2.6   couro         cz −8.4
│     ├─ guarda      4.2 × 1.0 × 0.8   ouroLuz       cz −9.8
│     └─ lamina      1.3 × 0.7 × 9.5   acoBase       cz −15.0
├─ bracoEsq          pivô (−5.0, 0, 12.9)     ← carrega o escudo
│  ├─ umero          2.2 × 2.2 × 3.6   ouroMeio      cz −1.8
│  ├─ antebraco      2.0 × 2.0 × 3.2   ouroBase      cz −5.0
│  └─ escudo         (aproxime o disco por 3 caixas concêntricas)       ← I5
│     ├─ face        6.2 × 1.0 × 6.2   ouroBase      cy +1.6
│     ├─ aro         5.0 × 1.2 × 7.0   ouroMeio      cy +1.5   (cruzado, chanfra o círculo)
│     └─ umbo        1.8 × 1.4 × 1.8   ouroLuz       cy +2.2
├─ pernaDir          pivô (+1.9, 0, 6.4)
│  ├─ coxa           2.6 × 2.6 × 3.4   ouroMeio      cz −1.7
│  ├─ canela         2.3 × 2.3 × 3.0   ouroBase      cz −4.9
│  └─ bota           2.8 × 4.0 × 1.4   vazio         cz −6.9, cy +0.6
└─ pernaEsq          pivô (−1.9, 0, 6.4)   (espelho de pernaDir)
```

A espada aponta para **cima e para fora** na pose parada (rotação do `bracoDir` de −35° em X),
como na referência — não deixe o guerreiro com a espada baixada.

---

## 9. Integração no jogo (`IsoRenderer`)

1. Onde hoje o jogador é desenhado com formas geométricas soltas, passe a `drawImage` do
   quadro correto do atlas, ancorado no centro do losango do tile.
2. Mantenha a **sombra elíptica** existente sob o personagem — ela cola o boneco no chão.
3. `imageSmoothingEnabled = false` antes de desenhar o sprite; restaure depois.
4. A ordem do pintor por antidiagonal não muda: o personagem é desenhado no passo do tile dele.
5. Nada muda para os inimigos nesta fase. O sistema tem de ficar pronto para eles, mas
   **não** migre os inimigos agora.

---

## 10. Gates de qualidade (o loop do img2threejs)

Nenhum passe é dado por concluído sem **revisão visual contra a referência**:

```bash
node tools/preview-personagem.mjs        # gera docs/ref/preview-atlas.png com as 8 direções
```

O revisor abre `docs/ref/preview-atlas.png` e `docs/ref/guerreiro-referencia.png` lado a lado
e responde, por escrito:

- G1 A silhueta é reconhecível como **este** guerreiro? (I1–I8)
- G2 As 8 direções são coerentes entre si — mesma altura, mesmo volume, sem "pular"?
- G3 A direção 0 (leste do grid) olha mesmo para baixo-direita na tela?
- G4 O contorno está contínuo, sem furos?
- G5 A paleta é a de §2, sem cor inventada nem gradiente contínuo?
- G6 A espada e o escudo estão nos lados certos e legíveis em todas as direções?

Reprovou em qualquer gate: corrige e roda de novo. **É esperado precisar de 2 a 3 rodadas** —
o img2threejs existe justamente porque acertar de primeira não é realista.

---

## 11. O que NÃO fazer nesta fase

- Migrar inimigos para o sistema novo.
- Alterar qualquer regra de jogo, balanceamento ou o `snapshot()`.
- Adicionar biblioteca (nem para matemática 3D — são 40 linhas de matriz).
- Usar imagem, sprite sheet externo, data-URI de PNG ou fonte externa.
- Fazer o turno esperar animação.
- Tornar `facing` visível ao oracle.
