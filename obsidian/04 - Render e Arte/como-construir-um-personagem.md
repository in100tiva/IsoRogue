---
tipo: runbook
atualizado: 2026-07-29
tags: [personagem, render, metodo, pixel-art, img2threejs]
---

# 🛠️ Como construir um personagem 3D pixel art, do zero

Passo a passo reproduzível do método usado para o Guerreiro, o Goblin, o Slime e o Ogro.
Adaptado do [img2threejs](https://github.com/img2threejs/img2threejs). Quem for fazer o
quinto personagem deve conseguir seguir esta página sem precisar perguntar nada.

> **O que o img2threejs realmente faz** — e não é o que o nome sugere. Ele **não** voxeliza,
> não extruda e não faz fotogrametria. Ele reconstrói o objeto da imagem como **código**:
> analisa a referência, gera uma spec estruturada, e emite primitivas determinísticas
> (caixas, cilindros, cones) em passes revisados visualmente contra a imagem original.
> "Reconstruction by code — not photogrammetry, not mesh extraction, not downloaded art packs."
>
> Nós tiramos a metodologia e trocamos a saída: nada de Three.js (o projeto não tem
> dependências), então em vez de um `THREE.Group` montamos um rig próprio de caixas
> orientadas, projetado na mesma isometria das paredes e rasterizado em sprites.

---

## O pulo do gato: onde o pixel art nasce

Esta é a parte que quase ninguém acerta de primeira, e que decide se o resultado parece
**pixel art** ou **3D liso**:

1. o rig 3D é rasterizado num buffer de **baixa resolução** (o "buffer de arte");
2. só **depois** esse buffer é ampliado com `imageSmoothingEnabled = false`.

Rasterizar direto em alta resolução produz um boneco 3D suave com bordas serrilhadas — não
pixel art. **A ordem das duas operações É o estilo visual.** Ver [[pixel-art-nasce-da-rasterizacao]].

O segundo ingrediente é a **quantização**: o fator de luz de cada face não vira uma cor
contínua, e sim o tom mais próximo dentro de uma rampa de 4 cores daquele material. É o que
mantém a paleta curta e a cara de arte desenhada à mão.

---

## Os 8 passos

### 1. Intake — ler a referência antes de escrever qualquer linha

Abra a imagem e escreva um **inventário de identidade**: a lista dos traços que fazem aquele
personagem ser *aquele* personagem, e não um boneco genérico. Numere-os (I1, I2, …).

Depois faça a pergunta que organiza tudo: **qual traço, se sumir, descaracteriza?**

- Goblin: as **orelhas**. Sem elas vira um anão verde.
- Ogro: a **corcunda assimétrica**. Sem ela é um humano grande.
- Slime: os **olhos em cruz e a antena**. Sem eles é uma pedra verde.
- Guerreiro: as **ombreiras**. São elas que dão a silhueta heroica.

Esses viram requisitos duros, e os gates de revisão cobram um a um.

### 2. Spec — a decisão que não se delega

Escreva a spec **antes** de programar: paleta amostrada da referência, escala em unidades
(`u`), e o **blockout** — a árvore de nós com pivôs e cada caixa com dimensão, posição e cor.

Isso mora em `docs/PERSONAGEM.md` (Guerreiro) e `docs/BESTIARIO.md` (monstros).

Duas regras de escala aprendidas na prática:

- A diferença de tamanho entre personagens vem da **altura real do modelo em `u`**, nunca de
  um fator de escala no sprite. Escalar o sprite quebra a perspectiva e o boneco descola do chão.
- Altura declarada é do **corpo**; crista, orelha, antena e espinho ficam por fora dela. Por
  isso os monstros medem alguns pontos acima do alvo na bancada — é construção, não erro.

Escalas em uso: Slime 7u · Goblin 13u · Guerreiro 18u · Ogro 24u.

### 3. Rig — `src/render/characters/<bicho>.ts`

Copie o molde de um existente. O arquivo exporta, no formato que o forge espera:

```ts
export const PALETA_<BICHO>      // as cores, com as emissivas marcadas
export const RAMPAS_<BICHO>      // as rampas de 4 tons por material
export const RAMPA_DA_COR_<BICHO>
export const MODELO_<BICHO>      // a árvore de nós, criada por uma função
export const POSE_PARADA_<BICHO> // os ângulos do repouso
```

O rig é **só dados**: não projeta, não rasteriza, não anima, não conhece Canvas.

Truques de modelagem com caixas:

- **curva** (chifre, cimitarra, antena): duas ou três caixas escalonadas, não uma;
- **disco** (escudo): três caixas concêntricas de larguras decrescentes;
- **domo** (slime): camadas horizontais empilhadas com larguras decrescentes;
- **cruz** (olho do slime): duas caixas cruzadas, uma vertical e uma horizontal.

### 4. Facing — as 8 direções

O modelo gira em torno de Z antes de projetar. **A fórmula é `atan2(-dx, dy)`**, não
`atan2(dy, dx)` — a segunda alinha o eixo +X com a direção, mas a frente do personagem é +Y,
e o erro dá exatamente 90° em todas as direções. Ver [[armadilha-do-yaw-isometrico]].

Onde o `facing` mora depende de quem é:

- **jogador**: campo no engine, porque o comando dele carrega a direção;
- **inimigo**: derivado 100% no render, observando a mudança de posição entre turnos.

Nos dois casos é **cosmético**: não entra em `snapshot()` nem no oracle.
Ver [[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

### 5. Forja do atlas

`spriteForge` pré-renderiza 8 direções × 9 poses = **72 quadros** num atlas, uma única vez,
sob demanda, e cacheia. Desenhar o rig 3D a cada frame seria desperdício: o modelo só tem
essas combinações. Ver [[sprite-forge]] e [[ADR-006-atlas-forjado-em-runtime]].

Custo medido: 33 ms (slime) a 54 ms (ogro) por atlas.

### 6. Luz e emissivas

O atlas é forjado com **brilho pleno**. O escurecimento conforme a luz do tile é aplicado na
hora de desenhar, por tingimento com `source-atop` (respeita o alfa do sprite), quantizado em
8 degraus e cacheado por (quadro, degrau).

**Cores emissivas ignoram a modulação**: os olhos do goblin e a antena do slime continuam
acesos no escuro. É barato e é o detalhe que dá alma ao bicho.
Ver [[fog-of-war-e-iluminacao]].

### 7. Integração — três passos e uma linha

O ponto de extensão é a tabela `RETRATOS` em `src/render/IsoRenderer.ts`:

1. escreva `src/render/characters/<bicho>.ts`;
2. declare `FORJA_<BICHO>` ao lado das outras;
3. acrescente **uma linha** em `RETRATOS`, indexada pelo arquétipo.

Quem tem ficha é desenhado por sprite; quem não tem cai no desenho geométrico, que continua
existindo como rede de segurança. Ver [[bestiario-monstros]].

### 8. Gates — a parte que não dá para pular

Nenhum personagem está pronto sem **revisão visual contra a referência**:

```bash
npm run preview:personagem            # guerreiro
npm run preview:personagem -- goblin  # ou slime, ogro, elenco
```

A bancada gera uma folha com as 8 direções ampliadas, os quadros de caminhada e ataque, a
tira em tamanho real, a paleta e os níveis de luz. Abra ela **e a referência** lado a lado e
responda os gates por escrito (G1–G10, em `docs/BESTIARIO.md` §13).

Ver [[revisar-o-personagem]].

---

## As quatro armadilhas que já custaram caro

**1. Fidelidade à referência perde para legibilidade.**
A cimitarra do Goblin foi construída fiel à imagem — apoiada no ombro, atrás da cabeça. O
dono reprovou: em 40 px, sem braço e mão visíveis à frente, aquilo lê como tábua atravessada.
O que funciona numa ilustração de 700 px não funciona num sprite.
Ver [[legibilidade-em-40px]].

**2. Julgar só na bancada ampliada.**
A bancada mostra 4×. O jogo mostra 1×. Sempre confira **no tamanho do jogo** antes de dar
por pronto.

**3. Sinal de rotação invertido enfia a arma no corpo.**
`cimitarraRy` positivo levava a ponta para o ombro oposto — atravessando o tronco. Com o
sinal certo, a lâmina só se afasta. Prefira garantir **separação geométrica** (folga em `u`)
a depender da ordem de desenho: a primeira vale nos 72 quadros, a segunda não.

**4. Medir a coisa errada.**
A métrica de escala da bancada media a silhueta inteira, mas a projeção isométrica soma a
profundidade do modelo nessa altura. Para dois humanoides isso se cancela; para o Slime, que
é largo e raso, não — o gate reprovava por 21 pontos sem defeito no rig. Hoje mede altura
acima da âncora. **Quando um gate reprovar, desconfie do instrumento antes do trabalho.**

---

## Checklist do próximo personagem

- [ ] Inventário de identidade escrito, com o traço que não pode sumir marcado
- [ ] Paleta amostrada da referência, emissivas marcadas
- [ ] Escala em `u` decidida e coerente com o elenco
- [ ] Blockout na spec antes de programar
- [ ] Rig exportando no formato do forge
- [ ] Uma linha em `RETRATOS`
- [ ] `npm run check` verde — 73 testes, golden 12/12
- [ ] Gates G1–G10 respondidos por escrito, olhando a referência
- [ ] Conferido **no tamanho do jogo**, não só na bancada

Ver também [[personagem-rig-3d]], [[projecao-isometrica]], [[paleta-e-estilo]],
[[ADR-004-personagem-por-codigo]].
