# ISOROGUE — Bestiário (personagens dos inimigos)

> Extensão de `docs/PERSONAGEM.md`: **mesmo método, mesmo pipeline, mesmas regras**.
> Método adaptado do [img2threejs](https://github.com/img2threejs/img2threejs) — reconstrução
> por código a partir de uma spec derivada da imagem, revisada visualmente contra a referência.
> Leia `docs/PERSONAGEM.md` inteiro antes desta página: §3 (escala), §4 (pipeline), §5 (facing),
> §6 (animação), §7 (sprite forge) e §10 (gates) valem aqui sem alteração.

Primeiro monstro: **Goblin**. Referência: `docs/ref/goblin-referencia.jpg`.
**Olhe para ela antes de escrever qualquer linha.**

---

## 0. As duas regras que protegem o jogo

### 0.1 Monstro novo é APARÊNCIA, não arquétipo novo

O jogo tem exatamente três arquétipos — `chaser`, `sentinel`, `linker` — e o golden test
congela **quantos e quais inimigos nascem em cada semente**. Acrescentar um arquétipo mudaria
`populate()` e invalidaria os 12 casos do oracle de uma vez.

Portanto: **o Goblin é o rosto do `chaser`.** Zero mudança em `src/engine/entities.ts`,
zero mudança de hp/atk/range/IA, zero mudança em `ARCHETYPES`. Se ao final desta fase
`npx vitest run` não estiver 100% verde, alguma coisa foi feita errada — não relaxe o teste,
desfaça a mudança.

Quando quisermos um monstro que **se comporta** diferente, aí sim é conversa de arquétipo
novo — e ela começa por regenerar o oracle deliberadamente, com o usuário sabendo. Não é
esta fase.

### 0.2 O `facing` do inimigo NÃO entra no engine

O jogador ganhou `player.facing` porque o comando dele carrega a direção. O inimigo não
precisa disso: o renderer já guarda estado por entidade em `vfxOf('e' + id, x, y, hp)`
(`src/render/IsoRenderer.ts`), então a direção sai de **observar a mudança de posição entre
turnos** — puramente na camada de apresentação.

Regra de derivação, nesta ordem:

1. o inimigo mudou de tile neste turno → `facing` = índice do delta em `DIRS8`;
2. não mudou, mas está adjacente ao jogador (Chebyshev 1) → encara o jogador;
3. nenhum dos dois → mantém o último `facing` conhecido;
4. entidade nunca vista antes → `facing = 2` (sul), o mesmo padrão do jogador.

**Não adicione campo em `Enemy`.** Nada de novo em `snapshot()`, em `extrairInimigo()` do
golden ou em `save.ts`. Esta é a diferença central em relação ao que foi feito para o jogador,
e ela existe porque aqui dá para derivar sem custo.

---

## 1. Modulação por luz (a dívida que agora vence)

`src/render/IsoRenderer.ts` tem um `TODO(inimigos-no-atlas)` registrando exatamente isto: o
jogador é a fonte de luz e sai com brilho pleno (§7.1 do PERSONAGEM.md), mas **um inimigo no
limite do campo de visão não pode sair com o mesmo brilho** — ficaria chapado, colado na
frente do cenário, e destruiria a leitura de profundidade que o fog of war constrói.

Implementação exigida:

- O atlas continua sendo forjado **uma vez, com brilho pleno**. Não forje um atlas por nível
  de luz: multiplicaria a memória por nada.
- Na hora de desenhar, escureça o quadro reusando o mecanismo que já existe —
  `tingirQuadro(atlas, sx, sy, cor)` com `source-atop`, que respeita o alfa do sprite —
  passando uma cor de sombra com alfa proporcional a `1 - lvl`.
- Quantize `lvl` em no máximo 8 degraus e **guarde em cache por (quadro, degrau)**: sem cache,
  cada inimigo visível refaz o tingimento a cada frame.
- Custo alvo: nenhuma alocação nova por frame depois do cache quente.

### 1.1 Os olhos não escurecem

A cor `olhoBrasa` da paleta (§3) é **emissiva**: ela ignora a modulação de luz e é desenhada
com brilho pleno em qualquer nível. É o que faz um goblin no escuro virar dois pontos
vermelhos encarando você — barato de implementar e é o tipo de detalhe que dá alma ao jogo.
Marque essa cor na paleta e trate-a no caminho de tingimento.

---

## 2. Intake — leitura da referência do Goblin

Humanoide pequeno, atarracado e cartunesco, com cabeça desproporcionalmente grande.

| # | Traço | Observação na referência |
|---|---|---|
| I1 | Pele verde | dominante; 4 tons, do claro amarelado ao verde-musgo escuro |
| I2 | **Orelhas enormes e pontudas** | o traço mais distintivo — saem para os lados, maiores que metade da cabeça |
| I3 | Elmo de couro com espinhos | calota marrom costurada, 3 espinhos de metal no topo |
| I4 | Olhos vermelhos brilhantes | pequenos, intensos, sob o elmo |
| I5 | Sorriso de dentes afiados | boca larga, dentes claros e irregulares |
| I6 | Cimitarra larga apoiada no ombro | lâmina de aço larga e curva, cabo enfaixado |
| I7 | Trapos de couro e bandagens | colete e tanga esfarrapados, faixas em braços e pernas |
| I8 | Proporção de ~2,5 cabeças | cabeça enorme, corpo curto, pernas curtas e arqueadas |

Perder I2 é perder o goblin — ele vira um anão verde. Perder I6 ou I4 tira a ameaça.
Ele **precisa ler como menor e mais baixo que o Guerreiro** quando os dois estiverem na
mesma tela: é a leitura de perigo do jogador.

---

## 3. Paleta canônica do Goblin

```ts
export const PALETA_GOBLIN = {
  peleLuz:    '#9ecb63',  // topo da cabeça, orelhas contra a luz
  peleBase:   '#6f9e3e',  // pele em geral
  peleMeio:   '#517a2b',  // faces laterais
  peleSombra: '#35521c',  // faces afastadas, vãos
  couroLuz:   '#8d6a3c',  // topo do elmo
  couroBase:  '#6b4f2a',  // elmo, colete, cabo
  couroSombra:'#45311a',  // cinto, sombra do couro
  trapo:      '#7d7660',  // bandagens e tanga puída
  acoLuz:     '#e2e8f0',  // fio da cimitarra
  acoBase:    '#a9b4c1',  // corpo da lâmina, espinhos
  acoSombra:  '#77828f',  // face escura da lâmina
  dente:      '#efe7cf',  // dentes
  olhoBrasa:  '#ff4a32',  // EMISSIVA — não recebe modulação de luz (§1.1)
  vazio:      '#1b2410',  // boca, vãos, sombra interna
  contorno:   '#121a0b'   // outline
} as const;
```

---

## 4. Escala

```
ALTURA_MODELO_GOBLIN = 13u     (contra 18u do Guerreiro)
LARGURA_ORELHAS      = 9u      (ponta a ponta — quase a largura do corpo)
```

Mesma constante `ART_POR_U` do Guerreiro: a diferença de tamanho na tela tem de vir da
**altura real do modelo**, nunca de um fator de escala aplicado no sprite. Assim os dois
ficam na mesma perspectiva e o goblin bate na altura do peito do guerreiro.

---

## 5. Rig do Goblin (`src/render/characters/goblin.ts`)

Blockout obrigatório. Dimensões em `u`, `cz` a partir do chão. Ajuste fino é esperado na
revisão visual; a **estrutura e as proporções** não.

```
raiz (0,0,0)
├─ quadril            pivô (0, 0, 4.4)
│  ├─ pelve           4.2 × 2.8 × 1.8   couroBase
│  └─ tanga           4.6 × 3.2 × 2.4   trapo        cz −1.4      ← I7 (esfarrapada)
├─ torso              pivô (0, 0, 5.9)
│  ├─ peito           4.6 × 3.2 × 3.2   peleBase
│  ├─ colete          4.9 × 3.5 × 2.2   couroBase    cz −0.3      ← I7
│  ├─ cinto           4.7 × 3.6 × 0.7   couroSombra  cz −1.6
│  ├─ ombro.esq       2.0 × 2.4 × 1.6   peleBase     cx −2.8, cz +1.1
│  └─ ombro.dir       2.0 × 2.4 × 1.6   peleBase     cx +2.8, cz +1.1
├─ cabeca             pivô (0, 0, 8.6)        ← ENORME (I8)
│  ├─ cranio          4.4 × 4.0 × 3.4   peleBase
│  ├─ focinho         2.6 × 1.0 × 1.4   peleBase     cy +2.2, cz −0.6
│  ├─ elmo            4.7 × 4.3 × 1.7   couroBase    cz +1.7      ← I3
│  ├─ espinho.meio    0.5 × 0.5 × 1.5   acoBase      cz +3.1      ← I3
│  ├─ espinho.esq     0.4 × 0.4 × 1.1   acoBase      cx −1.3, cz +2.9
│  ├─ espinho.dir     0.4 × 0.4 × 1.1   acoBase      cx +1.3, cz +2.9
│  ├─ orelha.esq      0.6 × 3.2 × 2.4   peleLuz      cx −3.1, cz +0.5   ← I2 (inclinar ~25° para fora e para cima)
│  ├─ orelha.dir      0.6 × 3.2 × 2.4   peleLuz      cx +3.1, cz +0.5   ← I2
│  ├─ olho.esq        0.8 × 0.5 × 0.6   olhoBrasa    cx −0.9, cy +1.9, cz +0.2   ← I4 emissivo
│  ├─ olho.dir        0.8 × 0.5 × 0.6   olhoBrasa    cx +0.9, cy +1.9, cz +0.2   ← I4
│  └─ dentes          2.4 × 0.4 × 0.6   dente        cy +2.0, cz −1.1            ← I5
├─ bracoDir           pivô (+2.9, 0, 7.9)     ← apoia a cimitarra no ombro
│  ├─ braco           1.5 × 1.5 × 2.2   peleBase     cz −1.1
│  ├─ antebraco       1.4 × 1.4 × 1.8   trapo        cz −3.0      ← I7 (bandagem)
│  ├─ mao             1.5 × 1.5 × 0.9   peleBase     cz −4.2
│  └─ cimitarra       (declare por ÚLTIMO — §4.4 do PERSONAGEM.md)   ← I6
│     ├─ punho        0.7 × 0.7 × 1.8   couroBase    cz −5.2
│     ├─ guarda       1.8 × 0.8 × 0.5   acoSombra    cz −6.2
│     ├─ lamina.base  0.8 × 1.6 × 3.0   acoBase      cz −8.0
│     └─ lamina.ponta 0.7 × 2.4 × 2.6   acoBase      cz −10.6, cy +0.6   (a curva da cimitarra sai do escalonamento das duas caixas)
├─ bracoEsq           pivô (−2.9, 0, 7.9)
│  ├─ braco           1.5 × 1.5 × 2.2   peleBase     cz −1.1
│  ├─ antebraco       1.4 × 1.4 × 1.8   trapo        cz −3.0
│  └─ mao             1.5 × 1.5 × 0.9   peleBase     cz −4.2
├─ pernaDir           pivô (+1.3, 0, 4.2)
│  ├─ coxa            1.9 × 1.9 × 1.9   peleBase     cz −0.9
│  ├─ canela          1.7 × 1.7 × 1.7   trapo        cz −2.6      ← I7
│  └─ pe              1.9 × 2.6 × 0.8   peleBase     cz −3.8, cy +0.5
└─ pernaEsq           pivô (−1.3, 0, 4.2)   (espelho de pernaDir)
```

**Pose de repouso:** `bracoDir` rotacionado para trás de modo que a cimitarra fique **apoiada
sobre o ombro**, como na referência — não com a arma pendurada ao lado. É essa pose que faz
a silhueta ler como "goblin encrenqueiro" à distância.

As orelhas (I2) precisam sobreviver em **todas as 8 direções**: de frente elas se projetam
para os lados; de perfil, uma some atrás da cabeça e a outra fica bem visível. Se em alguma
direção as duas desaparecerem, o rig está errado.

---

## 6. Animação

Os mesmos três estados e a mesma contagem de quadros do Guerreiro (§6 do PERSONAGEM.md), com
o tempero do bicho:

| Estado | Quadros | Diferença em relação ao Guerreiro |
|---|---|---|
| `parado` | 2 | respiração mais rápida e um leve balanço das orelhas |
| `andando` | 4 | passo curto e saltitante; torso inclina ~6° para a frente |
| `atacando` | 3 | golpe descendente da cimitarra, do ombro para baixo |

Nada disso toca o engine. A fase da animação vive na camada de render (R54).

---

## 7. Integração

1. `src/render/characters/goblin.ts` exporta `MODELO_GOBLIN`, `PALETA_GOBLIN`,
   `RAMPAS_GOBLIN`, `RAMPA_DA_COR_GOBLIN` e `POSE_PARADA_GOBLIN`, no mesmo formato do
   Guerreiro — o sprite forge não pode precisar saber qual personagem está forjando.
2. `IsoRenderer` forja o atlas do Goblin sob demanda, como já faz com o do Guerreiro, e
   `drawEnemy` passa a desenhar `kind === 'chaser'` com `drawImage` do quadro certo.
3. `sentinel` e `linker` **continuam em formas geométricas** nesta fase. O código dos dois
   caminhos convive: quem tem atlas usa sprite, quem não tem cai no desenho geométrico.
   Deixe isso explícito e legível — os próximos dois monstros vão entrar por aí.
4. Mantenha a sombra elíptica, a barra de vida e o clarão de dano funcionando para o goblin,
   agora sobre o sprite (o clarão já tem caminho de `source-atop`, reuse).
5. `imageSmoothingEnabled = false` antes de desenhar, restaurado depois.

---

## 8. Gates de revisão (§10 do PERSONAGEM.md, adaptados)

`npm run preview:personagem` deve passar a aceitar qual personagem renderizar
(ex.: `npm run preview:personagem -- goblin`), gerando `docs/ref/preview-goblin.png` sem
quebrar a bancada do guerreiro.

- **G1** A silhueta lê como **este** goblin? (I1–I8, com atenção especial a I2 e I6)
- **G2** As 8 direções têm mesma altura e volume, sem "pular" entre elas?
- **G3** A direção 0 (leste do grid) olha para baixo-direita na tela?
- **G4** O contorno está contínuo?
- **G5** A paleta é a do §3, sem cor inventada nem gradiente contínuo?
- **G6** As orelhas e a cimitarra são legíveis em todas as direções?
- **G7** **Novo:** ao lado do Guerreiro, o goblin lê claramente como **menor**?
- **G8** **Novo:** com pouca luz, o corpo escurece e os **olhos continuam acesos**?

Para G7 e G8 a bancada precisa mostrar os dois personagens lado a lado e uma tira do goblin
em 4 níveis de luz. Sem isso, os dois gates não são julgáveis.

---

## 9. O que NÃO fazer nesta fase

- Criar arquétipo novo, mexer em `ARCHETYPES`, em `populate()` ou em qualquer IA.
- Adicionar campo em `Enemy`, em `snapshot()` ou no oracle.
- Migrar `sentinel` e `linker`.
- Alterar balanceamento, dano, alcance ou quantidade de inimigos.
- Forjar um atlas por nível de luz.
- Usar imagem, sprite externo ou data-URI. O goblin nasce de código, como o guerreiro.

---

# Monstros 2 e 3 — Slime e Ogro

Mesmo método, mesmo pipeline, mesmas regras do §0. O que muda é só o rig e a paleta.
Referências: `docs/ref/slime-referencia.jpg` e `docs/ref/ogro-referencia.png`.
**Olhe as duas antes de escrever qualquer linha.**

## 10. O encaixe nos arquétipos (e a honestidade sobre ele)

O jogo tem **três** arquétipos e agora três monstros. O mapeamento:

| Arquétipo | Comportamento | Monstro | Qualidade do encaixe |
|---|---|---|---|
| `chaser` (range 1, ideal 1, peso 5) | avança sempre, corpo a corpo | **Goblin** | natural |
| `linker` (range 1, ideal 3, peso 1) | só ataca com aliado adjacente | **Slime** | natural — a própria referência mostra três juntos |
| `sentinel` (range 6, ideal 4, peso 2) | mantém distância, ataca à distância | **Ogro** | **forçado** — ver abaixo |

O Ogro é o encaixe fraco: a referência é um brutamontes de marreta, e `sentinel` ataca a
6 tiles. A solução visual é dar a ele um **arremesso**: a marreta fica na mão esquerda,
apoiada, e a mão direita arremessa pedra/entulho. A animação de ataque é o arremesso, não a
martelada. Funciona e é comum no gênero, mas é adaptação — não finja que a referência pedia isso.

**Isto não se resolve criando arquétipo novo agora**: `populate()` decide quantos e quais
inimigos nascem por semente, e mexer ali invalida os 12 casos do oracle. O momento certo é a
fase de **balanceamento de níveis e dificuldade**, que é o próximo passo combinado com o dono
— lá os arquétipos serão revistos com o oracle regenerado de propósito.

Uma consequência de produto que vale notar: com peso 5/2/1, o jogador vê **Goblin 62%,
Ogro 25%, Slime 13%** no nível 1. O Slime é o mais raro justamente por ser o de encaixe mais
natural; o balanceamento também vai querer olhar isso.

> **Emenda 2026-07-29:** o encaixe forçado acabou e a distribuição virou. O `sentinel` foi
> redefinido como **Brutamontes** — range 1, ideal 1, IA corpo a corpo no molde do `chaser`
> — e os pesos passaram de 5/2/1 para **10/1/100** (chaser/sentinel/linker): no nível 1,
> Slime ~90%, Goblin ~9%, Ogro ~1%. O oracle foi regenerado de propósito no mesmo dia
> (vanilla espelhado → `tools/gen-golden.mjs` → 73/73). Todo o §10 fica como registro do
> estado de 2026-07-28. Pendência nova: a animação de ataque do Ogro continua sendo um
> arremesso, concebida para um ataque à distância que não existe mais.

## 11. Slime — o arquétipo `linker`

### 11.1 Intake

Gota gelatinosa verde-esmeralda, achatada e larga, com superfície brilhante e translúcida.
Rosto minimalista e simpático: olhos em `+` amarelos luminosos e boca pequena. Uma antena
fina sai do topo com uma bolinha luminosa na ponta, tipo isca de tamboril.

> **É UM slime, não três.** A referência mostra três indivíduos lado a lado, mas isso é só
> composição da arte — a imagem existe para mostrar o bicho de ângulos diferentes. O
> entregável é **um único rig** (`MODELO_SLIME`), um único atlas, uma única criatura, como
> Goblin e Ogro. A quantidade que aparece na masmorra quem decide é o `populate()` do engine,
> que já sorteia vários inimigos por sala — não o modelo.
>
> O fato de a referência ter três só foi usado para justificar o **arquétipo**: `linker`
> ("só ataca quando outro aliado está adjacente ao jogador") é o comportamento de bicho que
> anda em bando, e é por isso que ele coube ali. Nada além disso.

| # | Traço | Observação |
|---|---|---|
| S1 | Corpo em domo/gota, mais largo que alto | a silhueta inteira; não é uma esfera |
| S2 | Verde-esmeralda com 4 tons | translucidez sugerida por camadas, não por alfa |
| S3 | Brilho branco no topo-esquerdo | o ponto especular que diz "gelatina molhada" |
| S4 | Olhos em `+` amarelos | **emissivos** (§1.1), como os do Goblin |
| S5 | Antena com bolinha luminosa | **emissiva**; é o que impede o slime de ser um borrão verde |
| S6 | Base achatada, quase colada no chão | ele não tem pernas: assenta no losango |

Perder S5 e S4 transforma o slime numa pedra verde. Eles são a leitura à distância.

### 11.2 Paleta

```ts
export const PALETA_SLIME = {
  gosmaLuz:    '#7ee89a',
  gosmaBase:   '#4fd07a',
  gosmaMeio:   '#2fa85e',
  gosmaSombra: '#1d7a45',
  gosmaFundo:  '#145c34',
  brilho:      '#d8fbe6',   // o especular do topo (S3)
  antena:      '#14201a',
  luzAmbar:    '#ffd94a',   // EMISSIVA — olhos e bolinha (S4, S5)
  vazio:       '#0f2a1c',
  contorno:    '#0a1a10'
} as const;
```

### 11.3 Escala e rig

```
ALTURA_MASSA_SLIME    = 7u     (a GOTA, do chão à coroa — contra 13u do Goblin e 18u do Guerreiro)
ALTURA_SILHUETA_SLIME = ~11u   (com o ápice do arco da antena; a bolinha centra em ~10u)
LARGURA_SLIME         = 11u    (mais largo que alto — é a identidade S1)
```

**As duas alturas são medidas diferentes e as duas precisam existir.** A tabela de
rig abaixo lista uma antena que sobe a 10,25u num modelo declarado de 7u — os dois
números não podem ser verdade juntos, e a rodada 1 dos monstros resolveu isso
encurtando a antena. Foi a decisão errada: com o arco baixo a bolinha encostava no
domo e as duas máscaras fundiam, então S5 tinha área medida e **contribuição zero
para a silhueta**. Área não é legibilidade.

O alvo de **G10 se mede pela MASSA**, não pela silhueta — é o que a bancada já faz
no painel 7 (`alturaAcimaDaAncora`). E o critério de aceite da antena não é área
por direção: é **contribuição de máscara** (quantos pixels da silhueta somem quando
a peça é removida) e **fundo livre** entre a bolinha e o domo. Uma medição que só
olha área não enxerga fusão de silhueta — vale para qualquer apêndice de qualquer
bicho futuro.

```
raiz (0,0,0)
├─ corpo              pivô (0, 0, 0)      ← o domo, montado em camadas empilhadas
│  ├─ base            10.4 × 9.0 × 1.4   gosmaMeio     cz +0.7   (a que toca o chão)
│  ├─ meio            9.0 × 7.6 × 1.8    gosmaBase     cz +2.3
│  ├─ alto            6.8 × 5.8 × 1.6    gosmaBase     cz +3.9
│  ├─ topo            4.4 × 3.8 × 1.2    gosmaLuz      cz +5.2
│  ├─ cume            2.2 × 2.0 × 0.8    gosmaLuz      cz +6.0
│  ├─ especular       1.6 × 1.2 × 0.5    brilho        cx −1.8, cy −1.4, cz +5.6   ← S3
│  ├─ olho.esq        1.0 × 0.5 × 1.0    luzAmbar      cx −1.9, cy +3.0, cz +3.2   ← S4 emissivo
│  ├─ olho.dir        1.0 × 0.5 × 1.0    luzAmbar      cx +1.9, cy +3.0, cz +3.2   ← S4 emissivo
│  └─ boca            1.0 × 0.4 × 0.5    vazio         cy +3.1, cz +2.2
└─ antena             pivô (0.8, 0, 6.4)                                            ← S5
   ├─ haste.a         0.35 × 0.35 × 1.6  antena        cz +0.8
   ├─ haste.b         0.35 × 0.35 × 1.4  antena        cx +0.7, cz +2.1  (curva por escalonamento)
   └─ bolha           1.3 × 1.3 × 1.3    luzAmbar      cx +1.4, cz +3.2  ← emissiva
```

Os olhos em `+` são sugeridos por **duas caixas cruzadas** por olho (uma vertical, uma
horizontal), não por uma caixa só — é o que dá a forma de cruz da referência.

### 11.4 Animação

O slime não tem pernas: o ciclo de caminhada é **pulsação e salto**, não passada.

| Estado | Quadros | Descrição |
|---|---|---|
| `parado` | 2 | respiração gelatinosa: achata 8% e alarga 6%, alternando |
| `andando` | 4 | comprime → estica para cima → sobe 1.5u → assenta; a antena atrasa meio quadro |
| `atacando` | 3 | recolhe, infla e projeta o corpo para a frente (bote), a antena chicoteia |

O **atraso da antena** em relação ao corpo é o que faz a gelatina parecer gelatina. É o
detalhe barato de maior retorno deste monstro — não corte.

### 11.5 Facing

Um domo é quase simétrico, então o giro se lê pelo **rosto e pela antena**, não pelo corpo.
Garanta que olhos, boca e antena girem juntos e que em nenhuma das 8 direções o rosto fique
ambíguo. Nas direções de costas, o rosto some e só a antena aparece — isso é correto e
desejável, desde que a antena continue legível.

## 12. Ogro — o arquétipo `sentinel`

### 12.1 Intake

Brutamontes enorme, curvado para a frente, com massa muscular desproporcional e assimétrica.

| # | Traço | Observação |
|---|---|---|
| O1 | **Tamanho** — maior que o Guerreiro | a primeira coisa que o jogador percebe |
| O2 | **Corcunda assimétrica** | o ombro esquerdo sobe ACIMA da cabeça; define a silhueta |
| O3 | Máscara de metal com chifres de carneiro | chifres curvos, grossos, para os lados |
| O4 | Ombreira com espinhos claros | no ombro alto, 3 a 4 espinhos grandes |
| O5 | Marreta enorme | madeira escura com cabeça metálica |
| O6 | Pele verde-acinzentada pálida | contrasta com o verde saturado do Goblin e do Slime |
| O7 | Saiote de pele com fivela de caveira | quebra o volume do tronco |
| O8 | Braços longos, pernas curtas e grossas, pés enormes | postura de gorila |

O2 é o traço que faz um ogro parecer ogro e não um humano grande. Se a silhueta ficar
simétrica, está errada.

### 12.2 Paleta

```ts
export const PALETA_OGRO = {
  peleLuz:     '#c6dcbb',
  peleBase:    '#a3c096',
  peleMeio:    '#7d9a72',
  peleSombra:  '#576d50',
  metalLuz:    '#dccfa6',   // a máscara
  metalBase:   '#ab9668',
  metalSombra: '#6e5c3e',
  couroBase:   '#6b4a35',   // saiote, braçadeira
  couroSombra: '#43301f',
  madeira:     '#5c4530',   // cabo da marreta
  osso:        '#e8e0cc',   // espinhos, chifres, caveira
  ossoSombra:  '#9c9078',
  vazio:       '#1a2416',
  contorno:    '#111a0e'
} as const;
```

Note que a pele do Ogro é **dessaturada** de propósito: os três monstros são esverdeados, e é
a saturação que os separa à distância — Slime vibrante, Goblin médio, Ogro pálido.

### 12.3 Escala e rig

```
ALTURA_MODELO_OGRO = 24u     (contra 18u do Guerreiro — ele INTIMIDA)
LARGURA_OMBROS     = 16u     (com a corcunda)
```

```
raiz (0,0,0)
├─ quadril            pivô (0, 0, 8.0)
│  ├─ pelve           7.6 × 5.4 × 3.0    peleMeio
│  ├─ saiote          8.4 × 6.2 × 4.4    couroBase     cz −2.2      ← O7
│  └─ caveira         2.0 × 1.0 × 1.8    osso          cy +3.2, cz −0.6   ← O7
├─ torso              pivô (0, 0, 11.4)   (inclinado ~14° para a frente — postura O8)
│  ├─ peito           9.0 × 6.0 × 6.4    peleBase
│  ├─ ventre          7.6 × 5.6 × 2.6    peleMeio      cz −3.6
│  ├─ corcunda        6.2 × 5.6 × 4.6    peleLuz       cx −3.4, cz +4.2   ← O2 (assimétrica!)
│  ├─ ombreira.esq    5.0 × 5.0 × 3.0    couroSombra   cx −5.6, cz +3.4   ← O4
│  ├─ espinho.a       1.2 × 1.2 × 2.6    osso          cx −6.4, cz +5.6   ← O4
│  ├─ espinho.b       1.0 × 1.0 × 2.0    osso          cx −4.6, cy −1.4, cz +5.4
│  └─ ombro.dir       4.2 × 4.4 × 2.6    peleBase      cx +5.0, cz +2.6
├─ cabeca             pivô (0.6, 0, 16.2)  (baixa e à frente, entre os ombros — O2/O8)
│  ├─ cranio          4.6 × 4.4 × 3.8    peleBase
│  ├─ mascara         4.4 × 1.2 × 3.4    metalBase     cy +2.0            ← O3
│  ├─ testeira        4.6 × 3.0 × 1.0    metalLuz      cz +2.2
│  ├─ chifre.esq      1.2 × 3.4 × 1.2    chifre?osso   cx −3.0, cz +0.8   ← O3 (curvar por 2 caixas)
│  ├─ chifre.dir      1.2 × 3.4 × 1.2    osso          cx +3.0, cz +0.8   ← O3
│  └─ olhos           2.6 × 0.4 × 0.5    vazio         cy +2.4, cz +0.6
├─ bracoEsq           pivô (−5.6, 0, 14.6)   ← segura a marreta
│  ├─ braco           3.0 × 3.0 × 5.0    peleBase      cz −2.5
│  ├─ antebraco       3.4 × 3.4 × 4.6    peleMeio      cz −7.4
│  ├─ mao             3.2 × 3.4 × 2.2    peleBase      cz −10.4
│  └─ marreta         (declare por ÚLTIMO)                               ← O5
│     ├─ cabo         1.2 × 1.2 × 7.0    madeira       cz −13.0
│     └─ cabeca       3.4 × 3.0 × 3.6    madeira       cz −17.4
├─ bracoDir           pivô (+5.0, 0, 13.8)   ← ARREMESSA (§10)
│  ├─ braco           2.8 × 2.8 × 4.8    peleBase      cz −2.4
│  ├─ bracadeira      3.0 × 3.0 × 2.2    couroBase     cz −5.6            ← rebites
│  ├─ antebraco       3.0 × 3.0 × 4.2    peleMeio      cz −8.2
│  └─ mao             3.0 × 3.2 × 2.0    peleBase      cz −11.0
├─ pernaEsq           pivô (−2.8, 0, 7.6)
│  ├─ coxa            3.6 × 3.6 × 4.0    peleMeio      cz −2.0
│  ├─ canela          3.2 × 3.2 × 3.4    peleBase      cz −5.6
│  └─ pe              3.6 × 5.4 × 1.8    peleBase      cz −8.2, cy +1.2   ← O8 (pés enormes)
└─ pernaDir           pivô (+2.8, 0, 7.6)   (espelho)
```

**A corcunda é assimétrica de propósito** — só do lado esquerdo. Não espelhe.

### 12.4 Animação

| Estado | Quadros | Descrição |
|---|---|---|
| `parado` | 2 | respiração pesada e lenta: o peito infla 0.5u, a corcunda acompanha |
| `andando` | 4 | passada larga e lenta, torso balança lateralmente ~5° (gingado de peso) |
| `atacando` | 3 | **arremesso**: recolhe o braço direito, gira o torso ~20° e projeta |

O ogro é **lento**: a mesma contagem de quadros, porém a leitura tem de ser de peso. Amplitude
maior e pose mais aberta do que o Goblin, jamais movimento nervoso.

### 12.5 Oclusão — a armadilha deste monstro

Com 24u ele é o maior sprite do jogo e vai invadir tiles vizinhos mais do que o Guerreiro já
invade (pendência conhecida: ~12 px na mesma antidiagonal, sem z-buffer). **Meça** quanto o
quadro do Ogro ocupa e reporte. Se ficar grotesco, a saída barata é reduzir para ~22u e
compensar com largura — não é implementar z-buffer nesta fase.

**Meça separando `artX` de `artY`.** Comparar largura de QUADRO com a do Guerreiro é
enganoso e já produziu uma conclusão errada na rodada 1: a largura do Guerreiro vem da
espada **erguida**, que ocupa `artY` acima do tile, enquanto a do Ogro vinha da marreta
**deitada ao lado**, que ocupa `artX` e invade o tile vizinho no plano do chão — exatamente
onde a ordem do pintor por antidiagonal erra sem z-buffer. São os mesmos pixels em lugares
que doem de forma diferente.

O número a publicar é o **extremo em `artX` contra os 32px de meio tile**, peça a peça.

## 13. Gates (valem para os dois)

Os mesmos G1–G8 do §8, mais:

- **G9** Os **três** monstros lado a lado leem como espécies diferentes — silhueta e saturação
  distintas, não três manchas verdes? A bancada precisa mostrar os três juntos, com o
  Guerreiro, para este gate ser julgável.
- **G10** O tamanho relativo conta a história certa? Slime < Goblin < Guerreiro < Ogro.

---

# As mortes do bestiário (cinemáticas de abate)

> Extensão desta página e da cinemática de morte do Guerreiro: **mesmo método, mesmo
> pipeline, mesmas regras** — §0 vale aqui inteiro (nada de campo em `Enemy`, nada de
> `snapshot()`, nada de oracle; o `npm run check` tem de terminar 100% verde).

## 14. A sequência de abate e o rastro persistente

Quando o golpe do jogador mata um monstro, ele merece mais do que sumir entre um quadro e
outro. Esta fase dá a cada um dos três uma sequência de morte própria e — o pedido central —
um **rastro que fica no tile** pelo resto do andar: quem passar depois sabe QUEM morreu ali
sem ter visto o abate.

### 14.1 O gatilho é observação, como tudo nesta página

`atacarInimigo` (`src/engine/game.ts`) remove o inimigo de `game.enemies` no golpe fatal, e
essa é a **única** via de saída da lista dentro de um mapa. O renderer já guarda um `Vfx`
por id; o abate é detectado pelo **diff entre o conjunto de ids do quadro anterior e o
deste** (double-buffer de `Set`s — a diferença não pode custar uma alocação por frame).
`syncRun` zera os conjuntos na troca de mapa, então descida e retomada de save não geram
abates fantasmas.

O registro captura tile, `facing` (o último conhecido — o corpo cai olhando para onde
olhava) e `kind`. O relógio avança por `dt` em `update`, tile visto ou não (R54: a morte não
congela quando o jogador vira o corredor), e para na duração da sequência — a partir daí o
desenho é o estado final, o rastro. `prefers-reduced-motion` pula direto para ele, como
`pularCinematica` faz com o Guerreiro. Os rastros vivem até a troca de mapa e são desenhados
sob a mesma regra de visão dos itens (R31: só dentro do FOV), **antes** de itens, inimigos e
jogador no passe do tile — qualquer coisa viva pisa POR CIMA deles.

### 14.2 A técnica é a do Guerreiro, com um desvio

Sangue e geleia são **decalques de chão** em primitivas de canvas (a poça de
`desenharSangue` generalizada: elipse com ease-out + respingos de LCG semeado pelo tile,
modulada pela luz do tile — os monstros não são fonte de luz, §1). Corpos e armas são
**atlases secundários** lidos na coluna `('parado', 0)`, modulados por `quadroModulado()`
(as emissivas atravessam acesas, §1.1). A queda da arma é **rotação de tela**
(`ctx.rotate`, o giro pixelado é desejado) em torno da âncora do mini-rig.

O desvio é o Slime: um repouso só **rotaciona** nós, e derreter é **deformar geometria**.
Os três estágios dele são variantes de MODELO (`criarModeloSlimeDerretido`), no molde de
`criarModeloGuerreiroSemEspada` — a "variante de equipamento" em vez da "pose de repouso".

### 14.3 As três sequências

| Monstro | Duração | Sequência | RASTRO (persistente) |
|---|---|---|---|
| **Goblin** | 1,1 s | sangue cresce → cimitarra cai girando e **some** → corpo desaba (parado → agachado → caído de costas, face para cima) | **o CORPO** sobre a poça de sangue |
| **Ogro** | 1,7 s | sangue cresce maior → marreta cai girando e **pousa na poça** → corpo desaba (parado → agachado → caído) e **esmaece até sumir** | **a MARRETA** sobre a poça de sangue |
| **Slime** | 1,0 s | geleia verde cresce sob ele → o domo derrete em três estágios (achatou 62% → desabou 34%, olhos afogando → poça 16%) | **a GELEIA** no chão, com a bolinha âmbar afogada — **emissiva**, acesa até no escuro |

Os contrastes são deliberados e didáticos: corpo (goblin) ≠ arma (ogro) ≠ geleia (slime).
O Goblin morre como o Guerreiro — arma caindo, sangue, corpo no chão. O Ogro é o irmão
dessa morte com a assinatura trocada: a carcaça some, o que denuncia o abate é o montante
abandonado no sangue. O Slime não tem sangue nem ossos: vira a poça do que ele era, e a
bolinha da antena afoga por último — é o adeus do bicho, e o ponto luminoso que o jogador
encontra no escuro antes de ler a poça.

### 14.4 Gates desta fase

A bancada (`npm run preview:personagem -- <bicho>`) ganhou a faixa "cinemática de morte —
as fases congeladas", dirigida pela tabela `MORTE_PREVIEW` de `tools/preview-entry.ts`:
cada fase é o atlas secundário em `parado/0`, como o renderer desenha. Os gates G1–G10
valem para ela, mais:

- **G11** A sequência CONTA a morte certa? Goblin desaba e fica; Ogro desaba e some,
  sobra a marreta; Slime derrete até a poça. Sem trocar fase, sem pose viva no meio.
- **G12** Os três rastros são distinguíveis à distância um do outro — corpo verde caído,
  marreta no sangue, geleia brilhando? (É o G9 dos mortos.)

Rodada 1: aprovados visualmente nas quatro folhas (a do Guerreiro, que a generalização da
seção tinha de preservar, saiu idêntica — ajoelhada e caída nas mesmas poses).

---

# Balanceamento (a fase que a §10 anunciava)

## 15. Níveis de monstro, XP em escala e spawn por nível do herói

> **Emenda 2026-07-30.** Esta é a fase de "balanceamento de níveis e dificuldade" que a
> §10 reservava — feita com o dono, com o oracle **regenerado de propósito** pelo mesmo
> processo da emenda de 2026-07-29: mudança espelhada no vanilla congelado
> (`legacy/isorogue-vanilla.html`) → `npm run golden` → `npm run check` verde (49/49 no
> oracle; T11 novo cobre a escala). O que a §10 e a emenda anterior dizem sobre pesos de
> spawn e XP por arquétipo fica como registro do estado anterior — esta seção manda.

### 15.1 Os níveis dos monstros

| Monstro | Arquétipo | `nivel` |
|---|---|---|
| Slime | `linker` | **1** |
| Goblin | `chaser` | **2** |
| Ogro | `sentinel` | **3** |

`nivel` substitui os campos `xp` e `peso` de `ARCHETYPES`, abolidos. É um dado do
ARQUÉTIPO, não da entidade — `Enemy` continua com os mesmos campos de sempre.

### 15.2 O XP do abate, na escala do dono

```
xp = 100 × 2^(nivelMonstro − nivelHeroi)     — zero quando nivelHeroi ≥ nivelMonstro + 3
```

| herói \ monstro | slime (1) | goblin (2) | ogro (3) |
|---|---|---|---|
| 1 | 100 | **200** | **400** |
| 2 | 50 | 100 | 200 |
| 3 | 25 | 50 | 100 |
| 4 | **0** | 25 | 50 |
| 5 | 0 | **0** | 25 |
| 6 | 0 | 0 | **0** |

Dobra por nível ACIMA (matar bicho mais forte recompensa o risco — decisão do dono) e
cai pela metade por nível abaixo, até parar de render. O registro do abate mostra o XP
(`+100 xp`, ou `sem xp — monstro muito abaixo do seu nível`): é o único feedback da
escala enquanto a UI não tem barra de XP.

### 15.3 Nível do herói: 100 XP plano, excedente carrega

`XP_POR_NIVEL = 100` para QUALQUER nível (antes: `level × 10`). Ao cruzar 100 o herói
sobe e o **excedente é carregado** — as duas decisões são do dono: um ogro de 400 xp
com 0 acumulado rende 4 níveis de uma vez. Os bônus por nível (+4 maxHp/+4 hp/+1 atk)
ficaram INALTERADOS nesta fase: o que cada nível dá em status é a próxima conversa.

### 15.4 A mistura de spawn, pelo nível do herói

`populate(map, depth, heroLevel)` — a mistura sai da linha do herói em `PESOS_SPAWN`
(colunas em `KINDS`: chaser/sentinel/linker). A profundidade segue endurecendo
**contagem** e **hp/atk** (intocados); ela não mexe mais na mistura.

| herói | goblin | ogro | slime | leitura |
|---|---|---|---|---|
| 1 | 10 | 1 | 100 | a cada 10 slimes, 1 goblin; a cada 10 goblins, 1 ogro |
| 2 | 100 | 10 | 30 | goblins dominam; ogros aparecem; slimes recuam |
| 3 | 40 | 100 | 10 | ogros dominam; slimes raros |
| 4+ | 15 | 100 | 3 | ogros comuns, goblins em minoria, slimes raríssimos |

A linha 4 é a régua de todos os níveis seguintes (com XP plano o herói pode subir
indefinidamente; a mistura estabiliza no estado final descrito pelo dono).

### 15.5 O que NÃO se fez nesta fase

- Bônus de status por nível do herói (+4 maxHp, +1 atk) — **próxima conversa**, como o
  dono marcou ("depois vamos abordar o que cada nível vai dar").
- Escalonamento de hp/atk dos monstros por profundidade — intocado.
- Barra/número de XP na UI — o registro do abate carrega o XP por ora.
- `stats.xp` acumulado na run — as estatísticas de morte continuam as mesmas.

---

## 16. O XP visível: texto flutuante 3D e o nível do herói na HUD

> **Emenda 2026-07-30 (noite).** A escala de §15 nasceu cega: o XP só aparecia no
> registro textual, e o "NÍVEL" do cabeçalho — que sempre foi a PROFUNDIDADE da
> masmorra (`game.depth`) — era lido como o nível do herói ("matei vários e o nível
> continuou em 1"). Esta fase torna a progressão visível nos dois lugares em que o
> jogador procura: o mundo (o texto que sobe do abate) e o painel (nível e XP do
> herói).

### 16.1 A fila `game.abatesRecentes` (o canal, e por que ele existe)

O texto precisa do XP **com o nível do herói de ANTES do golpe** — e o level-up
acontece dentro do mesmo comando que mata. O renderer, que só observa o estado DEPOIS,
não tem como recomputar o valor certo. A solução é uma fila VISUAL escrita pelo engine
em `atacarInimigo` (o único lugar onde o XP é conhecido na hora certa) e drenada pelo
renderer a cada quadro: `AbateVisual { x, y, kind, xp }`.

Mesmo estatuto do `bump` dos inimigos e do `facing` do jogador: **apenas animação** —
não entra em `snapshot()`, não entra no save, não chega ao oracle (o golden 49/49 verde
com a fila prova as três coisas). Teto de 32 entradas para o jogo headless, onde
ninguém drena. Abate com `xp: 0` (a escala cortou) não solta texto — o "sem xp" fica
no registro.

### 16.2 O texto como rig de caixas (a técnica dos monstros, e a armadilha)

`src/render/characters/xpTexto.ts`: cada pixel de uma fonte 3×5 vira um **cubo de ouro**
de 0,7u, rasterizado pelo mesmo pipeline de §4 (projeção, quantização, snap de paleta,
contorno por máscara) e lido na coluna ('parado', 0) da linha `dir 2` — estático; quem
se move é a posição de tela (sobe 38px·zoom com ease-out, esmaece no último terço,
~1,1 s, brilho pleno por cima do mundo porque é feedback, não cenário; some fora do FOV,
R31).

A **armadilha** (rodada 1 reprovada na bancada): glifos deitados no plano X-Z ficam
ilegíveis — a projeção cisalha a grade da fonte ~26° e o bitmap vira um emaranhado. A
cura é a **pré-distorção de outdoors**: da álgebra de §4.2 saem os dois passos-modelo
`(e, −e, 0)` e `(−f, −f, 2f)` que, projetados, formam uma grade QUADRADA na tela. O
bitmap lê perfeito e cada pixel continua um cubo isométrico — a leitura vem do bitmap,
o volume vem do cubo. Fica registrado para o próximo texto do jogo.

O conjunto de valores é FECHADO (25/50/100/200/400, da fórmula de §15): um atlas por
valor, forjado sob demanda. Valor fora do conjunto não desenha nada (degradar sem
lançar) — uma escala futura que gere outro valor só precisa de um modelo a mais em
`MODELO_XP`.

### 16.3 O painel: ANDAR × NÍVEL × XP

O cabeçalho agora diz o que cada número é:

- **ANDAR** — a profundidade (`game.depth`), com o `id="hud-nivel"` de sempre (o
  contrato §9 do CONTRACTS.md intacto);
- **TURNO** — inalterado;
- **NÍVEL** — o nível REAL do herói (`player.level`), `id="hud-heroi-nivel"`;
- **XP** — `player.xp`/100 na régua plana de §15, `id="hud-xp"`, com a barra âmbar
  de progresso (`id="hud-xp-barra"`, o mesmo idioma visual da barra de vida).

Os testes de UI cobrem os três ids novos junto dos antigos (`test/ui.test.tsx`).

### 16.4 O que NÃO se fez nesta fase

- O texto flutuante é só XP: dano recebido/causado, cura e level-up não ganham
  flutuantes (o level-up já tem o registro; os demais são a próxima conversa de juice).
- Nenhuma mudança de balanceamento: §15 continua mandando nos números.
- A pré-distorção de outdoors não virou utilitário do forge: ela vive em
  `xpTexto.ts` até um segundo texto precisar dela.

### 14.5 O que NÃO se fez nesta fase

- Nenhum campo em `Enemy`, em `snapshot()`, no save ou no oracle — o gatilho é o diff de
  ids por observação, na camada de render.
- Nenhuma mudança de balanceamento, dano, alcance ou quantidade de inimigos.
- Os rastros não persistem ENTRE andares (o sangue do Guerreiro também não persiste entre
  expedições) e não viram obstáculo: são decalques cosméticos, e qualquer vivo pisa por cima.
- O tempero de animação dos vivos (`ANIMACAO_GOBLIN`/`SLIME`/`OGRO` sem consumidor,
  `TODO(tempero-goblin)`) continua de pé — é outra fase, e ela abre canais em
  `OpcoesForja`, não aqui.
