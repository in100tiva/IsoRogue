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
