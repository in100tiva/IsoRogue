# ISOROGUE — MÉTODO

> **Leia isto ANTES de criar qualquer coisa nova neste projeto**: um monstro, um bioma,
> uma animação, um item, um adereço. Não é um tutorial de "como fazer pixel art"; é o
> registro de **como este projeto faz** — as convenções, as medições que produziram cada
> número, e as alternativas que foram tentadas e reprovadas. Um método que só diz "faça
> assim" é inútil: quem chega depois refaz o erro já pago.
>
> Toda afirmação sobre o código carrega `arquivo:linha`. Se um número aparece aqui, ele
> foi **medido** — em rasterização, em varredura de sementes ou em foto da bancada.
> Nenhum é estimativa.

---

## Sumário

0. [Como usar este documento](#0-como-usar-este-documento)
1. [Os invariantes que não se negociam](#1-os-invariantes-que-não-se-negociam)
2. [MODELOS — da imagem de referência ao rig](#2-modelos--da-imagem-de-referência-ao-rig)
3. [TERRENO — anatomia de um tileset e o relevo que protege a conectividade](#3-terreno--anatomia-de-um-tileset-e-o-relevo-que-protege-a-conectividade)
4. [MONSTROS — arquétipo, stats, aparência e a fronteira engine/render](#4-monstros--arquétipo-stats-aparência-e-a-fronteira-enginerender)
5. [ANIMAÇÃO — o atlas de 72 e o que o personagem declara](#5-animação--o-atlas-de-72-e-o-que-o-personagem-declara)
6. [ALGORITMOS canônicos, e por que estes](#6-algoritmos-canônicos-e-por-que-estes)
7. [VERIFICAÇÃO — as camadas, o que cada uma pega, o que não é coberto](#7-verificação--as-camadas-o-que-cada-uma-pega-o-que-não-é-coberto)
8. [O que aprendemos de outros repositórios](#8-o-que-aprendemos-de-outros-repositórios)
9. [CASOS — os erros reais desta jornada](#9-casos--os-erros-reais-desta-jornada)
10. [CHECKLIST — antes de dizer que acabou](#10-checklist--antes-de-dizer-que-acabou)

---

## 0. Como usar este documento

Este arquivo é o **método**. Ele não substitui as especificações; ele diz como executá-las.

| Vou criar… | Leia, nesta ordem |
|---|---|
| **um monstro** | §1, §4, §2, §5, §9 · depois `docs/BESTIARIO.md` §0 e o molde `src/render/characters/goblin.ts` |
| **um bioma / andar** | §1, §3, §2 · depois `src/render/tilesets/index.ts:17-29` (o contrato) e `src/render/tilesets/nivel1.ts:15-50` (a calibração) |
| **uma animação** | §1, §5 · depois `src/render/spriteForge.ts:447-461` (convenção de sinal) e `:462-524` (`poseDoQuadro`) |
| **um item / despojo / texto** | §1, §2 · depois `src/render/characters/xpTexto.ts` para o caso de bitmap |
| **uma regra de jogo** | §1, §6, §7 · depois `docs/BRIEF.md` (R01–R58) e `test/golden.test.ts:46-62` |
| **uma fase de geração de mapa** | §3, §6, §9-A · depois `src/engine/mapgen.ts:14-30` e `:979-999` |

Três leituras obrigatórias, sempre: **§1** (os invariantes), **§9** (os erros já pagos)
e **§10** (o que rodar antes de fechar). A §9 é a mais importante do documento — cada
caso ali custou uma rodada, uma varredura de milhares de andares ou uma captura de tela
do dono.

**Uma regra de método antes de tudo.** Comentário neste projeto não descreve o que a
linha faz — o código já faz. Ele registra **por que esta solução e não a outra**, com o
número medido ao lado, e o nome de quem quebra se alguém mexer. Ver, como padrão:
`src/engine/entities.ts:1108-1132` ("POR QUE TARJAN, e não uma BFS por candidato" —
0,676 ms contra 7,687 ms por andar), `src/render/spriteForge.ts:342-346` ("a alternativa
considerada e recusada: um `if` por personagem aqui dentro") e
`src/render/model3d.ts:409-422` (por que a derivação de rampa é exportada em vez de
duplicada). Quando você escrever código novo, escreva comentário no mesmo formato.

---

## 1. Os invariantes que não se negociam

Estes decorrem de R01, R02, R19, R20, R53 e R54 do `docs/BRIEF.md`. Nenhum é negociável
sem o dono junto.

**Origem e determinismo.**

1. **Nada de recurso externo.** Nenhuma imagem, sprite sheet, data-URI de PNG, fonte
   externa ou biblioteca — nem para matemática 3D (`docs/BRIEF.md:7`;
   `docs/PERSONAGEM.md:340-341`). Todo personagem, item e bloco de terreno nasce de
   **código**.
2. **`Math.random` é proibido** em `src/engine` **e** em `src/render`, e o gate reprova o
   build (`tools/check-boundaries.mjs:25` e `:44`). A única entropia real do projeto é
   `crypto.getRandomValues` dentro de `newSeedString()` (`src/engine/core.ts:9-13`).
   No render seria pior que proibido: o tufo mudaria de lugar a cada quadro.
3. **A ordem é contrato.** `DIRS8`/`DIRS4` (`src/engine/core.ts:96-122` — "ORDEM FIXA —
   NUNCA REORDENE"), `KINDS` (`src/engine/entities.ts:125-126` — "nunca use `Object.keys`
   na lógica"), as linhas de `DROPS` (`:250-258`), `ORDEM_ESTADOS` do atlas
   (`src/render/spriteForge.ts:137-138`). Reordenar qualquer uma muda todas as partidas
   salvas.
4. **A ordem de consumo do RNG é contrato** (`src/engine/mapgen.ts:24-29`). Um `u32()` a
   mais ou a menos muda todos os mapas. Fase nova entra em **stream próprio**, criado
   depois do layout, e depois das fases que já mexem em `isWalkable` (`:1474-1481`).
5. **Determinismo total no render**: zero `Math.random`, zero relógio, zero DOM em
   `model3d` e nos personagens; mesmos argumentos ⇒ mesmos pixels
   (`src/render/model3d.ts:15-19`). Todo desempate usa `<` estrito e a ordem de
   declaração (`model3d.ts:518`, `:977-981`; `spriteForge.ts:724-725`).

**Geometria e escala.**

6. **Espaço do modelo, destro**: +X direita, +Y frente (para onde olha), +Z cima, origem
   `(0,0,0)` no **centro dos pés, no chão**; unidade `u`; rotação em radianos, ordem
   Z→Y→X, aplicada no pivô (`src/render/model3d.ts:28-30`, `:177-182`, `:550-562`).
7. **A projeção é UMA só**: `artX = (x − y)·escala`, `artY = (x + y)·escala·0,5 − z·escala`
   (`model3d.ts:655-661`). "Não invente outra projeção" (`docs/PERSONAGEM.md:122-126`):
   divergir descola o personagem do plano do chão.
8. **O invariante de escala é o PRODUTO** `ART_POR_U × PIXEL = 2,5` px de tela por `u`
   (`model3d.ts:40-71`). Os dois fatores podem ser renegociados juntos (foram: 1,25/2 →
   2,5/1); o produto, não.
9. **Tamanho relativo vem da ALTURA REAL do modelo em `u`**, jamais de um fator de escala
   no sprite (`docs/BESTIARIO.md:130-132`): Slime 7u < Goblin 13u < Guerreiro 18u <
   Ogro 24u.
10. **O rig é autorado ESPELHADO em X** — braço da arma em −X. Não é estética: a projeção
    inverte o sentido, provado pelo produto vetorial em
    `src/render/characters/warrior.ts:604-636`. Vale para o projeto inteiro, e a constante
    `ESPELHO = -1` (`spriteForge.ts:167-185`) acompanha na animação genérica.
11. **`ancoraX/ancoraY` é a projeção da origem do rig**, NUNCA o meio do quadro
    (`spriteForge.ts:1057-1069`). Terreno e elenco colam pelo mesmo critério — foi uma
    regressão nisso que produziu três sintomas de uma vez (§9, contexto em
    `test/render.test.ts:1287-1319`).

**Pixel art.**

12. **A ordem produz o pixel art**: rasterizar em px de ARTE → snapar para a paleta com
    alpha binário → ampliar `×PIXEL` com `imageSmoothingEnabled = false`
    (`spriteForge.ts:9-12`). O upscale mora em **um** lugar: `spriteForge.ts:1385-1388`.
13. **Paleta fechada e tipada** (`keyof typeof PALETA_*`). Toda face recebe a cor da peça
    modulada pela orientação e **quantizada para a rampa autorada** do material — nunca
    interpolação (`model3d.ts:509-525`).
14. **Alpha é binário** (limiar 128, `spriteForge.ts:555-556`). Meio-tom não existe em
    pixel art — e é o alpha binário que produz a máscara exata de silhueta de que o
    contorno externo depende.
15. **O contorno come para DENTRO**, nunca dilata para fora (`spriteForge.ts:884-938`):
    a silhueta não cresce um pixel, senão as âncoras e o enquadramento de todo o elenco
    já aprovado mudam (`docs/VOXEL2PIXEL.md:151-179`).
16. **Um atlas por personagem**, forjado uma vez em brilho pleno; o escurecimento é
    composição com cache LRU. **Nunca forje um atlas por nível de luz**
    (`spriteForge.ts:26-30`; `docs/BESTIARIO.md:60-61`).

**Fronteiras.**

17. **Animação é 100% cosmética (R54)**: vive no render, alimentada por `dt`, e não toca
    `snapshot()`, save nem oracle (`docs/BRIEF.md:82`).
18. **Monstro novo é APARÊNCIA, não arquétipo novo** (`docs/BESTIARIO.md:16-29`) — §4.
19. **Degradação sem lançar em toda a cadeia**: `ctx` nulo sai em silêncio
    (`model3d.ts:32-33`), atlas sem contexto 2D cai no desenho geométrico, que por isso
    continua vivo e testado (`src/render/IsoRenderer.ts:926-929`).
20. **Todo campo novo de `OpcoesForja` que mude pixel entra na CHAVE do cache, no mesmo
    commit que o cria** (`spriteForge.ts:1233-1236`).

---

## 2. MODELOS — da imagem de referência ao rig

O método é reconstrução **por código** em rodadas, adaptado do img2threejs (§8). Não há
fotogrametria, não há asset importado.

### 2.1 Intake — o inventário de identidade, antes de qualquer linha

Antes de modelar, a referência vira uma **tabela numerada de traços** (I1..I8 no Guerreiro
e no Goblin — `docs/PERSONAGEM.md:18-36`; S1..S6 no Slime e O1..O8 no Ogro —
`docs/BESTIARIO.md`), cada um com a observação **medida** na imagem, mais a nota de quais
traços, se perdidos, descaracterizam a criatura. Depois disso, todo comentário de código
cita o traço que a peça carrega (`← I2`, `← I6`).

Sem inventário escrito, a revisão vira gosto. Com ele, cada gate pergunta por um traço
nomeado — e é o que permite **desviar da referência conscientemente** sem perder a
identidade: a cimitarra do Goblin saiu do ombro porque em 40px "não sobra mão nenhuma na
frente do corpo" (`src/render/characters/goblin.ts:37-63`, com a medição das 8 direções).

### 2.2 Paleta, rampas, e a regra da fórmula única

Cada personagem exporta `PALETA_<BICHO>` (~10 a 15 hexes `as const`) amostrada da
referência — e essa é a paleta inteira. `RAMPAS_<BICHO>` declara a escada de 4 tons de
cada material; `RAMPA_DA_COR_<BICHO>` diz a que material cada cor pertence. A quantização
escolhe um degrau **dentro da rampa autorada**, nunca interpola
(`src/render/model3d.ts:509-525`). `RAMPA_DERIVADA = [0.42, 0.66, 1, 1.34]`
(`model3d.ts:238`) é só o fallback de quem não declarou rampa.

Regra de fonte única: a derivação existe **exportada** (`rampaEfetiva`, `model3d.ts:424`)
porque o forge precisa reconhecer os hexes emissivos depois da rasterização — "ter duas
cópias da derivação é exatamente como uma cor emissiva deixaria de ser reconhecida em
silêncio" (`model3d.ts:409-422`).

**Calibração do sombreamento, registrada.** `GANHO_SOMBRA = 1.15` e `REALCE_TOPO = 1.25`
(`model3d.ts:91-129`). Sem ganho, as três orientações caem no mesmo tom e o modelo fica
chapado; com ganho 1,6 (rodada 2) o tom declarado virava o **teto** e `ouroLuz` nunca
aparecia — o guerreiro lia marrom. Corolário autoral: **declare a peça no tom MÉDIO do
material** (`acoBase`, não `acoLuz`), senão topo e frente colapsam no mesmo branco
(`warrior.ts:506-509`).

### 2.3 O rig: caixas em árvore, três tipos e nada mais

`Caixa {cx,cy,cz, sx,sy,sz, cor, contorno?}` no espaço do nó; `No {nome, pivo, caixas,
filhos?}`; `Pose {[nome]: {rx,ry,rz}}` (`model3d.ts:154-190`). É o substituto próprio do
`THREE.Group` — o projeto não pode importar biblioteca nem para matriz. Caixa com
vértices em **ponto flutuante** (e não grade de voxels) é o que dá rotação contínua real
e permite as 8 direções com **uma** projeção só.

**Aproximar forma por união de caixas.** Não há círculo, cone nem curva: escudo =
travessa larga + travessa alta + chanfro diagonal + face + umbo (`warrior.ts:533-594`);
orelha = escada de 3 caixas menores e mais altas (`goblin.ts:795-876`); cimitarra =
1,6 → 2,4 → 1,4u de largura, a barriga que cresce e afina.
`Caixa` **não tem rotação** — quem gira é o nó —, e uma inclinação que morasse na `Pose`
seria "ângulo mágico escondido em tabela": some no primeiro `clonarPose` escrito errado.

**Regra geral: identidade mora na GEOMETRIA; expressão mora na POSE.** A espada nasce
erguida com rotação zero porque as peças foram espelhadas na declaração
(`warrior.ts:466-490` — "nenhum ângulo mágico fica escondido numa tabela de pose"); a
dobra em L do cotovelo do Goblin está nas coordenadas das caixas, não num nó de antebraço.

### 2.4 `peca` vs `detalhe` — o contorno é a exceção, não o padrão

Dois construtores locais por personagem: `peca()` traça contorno de silhueta própria,
`detalhe()` usa `contorno: false`. **Só desenha contorno próprio a peça que faz silhueta
externa.** No Guerreiro sobraram quatro (peitoral, duas ombreiras, elmo).

O achado que virou regra (`warrior.ts:299-317`): com 19 peças contornadas, **40%–52% dos
pixels do sprite eram a cor do outline**, contra os ~17% que o perímetro externo
justificaria — e nas quatro vistas 3/4 a figura virava mancha escura sem cabeça, sem
ombro e sem perna. A silhueta externa continua fechada porque quem a desenha é a máscara
de alpha do forge. Caso extra obrigatório: **caixa de cor emissiva sempre em
`contorno: false`**, senão o outline come o olho inteiro (`spriteForge.ts:77-79`).

### 2.5 Faces, luz e o snap de paleta

Cada caixa gera 6 faces; a face é visível quando a normal rotacionada tem produto escalar
positivo com `DIR_VISAO = (1,1,1)` (`model3d.ts:82`, culling em `:932-940`). O fator de
luz é a **média ponderada pelos cossenos** dos três eixos — topo 1,00, frente 0,82, lado
0,68 (`model3d.ts:85-89`, `:493-501`) —, contínua em toda a esfera visível: "escolher o
eixo mais próximo cria degraus ao girar". O degrau tem de vir da quantização, não do
sombreamento.

**Ordem do pintor, sem z-buffer**: faces ordenadas por `(wx+wy+wz)` do centro, desempate
por ordem de declaração e depois pelo índice da face (`model3d.ts:977-981`). Daí três
armadilhas de autoria que já custaram rodadas, e que valem para qualquer rig novo:

- **faces coplanares de cores diferentes** se intercalam pixel a pixel — o olho do Goblin
  precisou avançar 0,4u para sair da coplanaridade com o crânio (`goblin.ts:889-895`);
- **peça contida no volume de outra não desenha pixel nenhum** — a garganta do Goblin teve
  de avançar em +Y **e** ser mais larga que a fileira de dentes (`goblin.ts:918-929`);
- **peças da mesma bitola empatam** nas faces laterais — a faixa da canela é 0,1u mais
  larga de propósito (`goblin.ts:1149-1150`).

**O snap** (`spriteForge.ts:526-553`) é o passe que faz os gates G4 e G5 verdes por
construção. O achado que reprovou a rodada 1: **86,6% dos pixels do sprite estavam fora
da paleta** — 1426 tons onde a spec permite 10 —, porque `ctx.fill()` antialiasa toda
borda e, em px de arte, **a borda é a peça**. A cura: varrer o buffer, alpha < 128 vira
transparente puro e ≥ 128 vira 255, e o RGB é forçado ao degrau mais próximo por
distância euclidiana ponderada (`PESO_R 2, PESO_G 4, PESO_B 3`, `:573-577`), memoizada
por RGB empacotado ao longo dos 72 quadros (`:863-882`).

O contorno interno (aresta de peça contra peça) é traçado por Bresenham em px inteiros —
**não** `ctx.stroke()`, porque um traço de 1px em coordenada fracionária é antialiasado e
depois do snap vai para o degrau errado (`model3d.ts:1011-1014`). O contorno externo sai
da máscara de alpha, repintando o pixel de borda (`spriteForge.ts:884-938`).

### 2.6 As armadilhas de forma (todas medidas)

| Armadilha | O que acontece | Onde está registrada |
|---|---|---|
| **Peça fina demais** | abaixo de ~2px de arte de travessia a peça vira pontilhado e o contorno a mata. Com `ART_POR_U = 2,5` o piso prático é ~0,8u | `warrior.ts:492-504`; `goblin.ts:883-888` |
| **Tronco raso = placa** | planta muito mais larga que funda encolhe onde `artX` só enxerga Y — o Guerreiro perdia 39% da massa, silhueta de 34 para 14px | `warrior.ts:376-397` |
| **Vão entre as pernas < ~2px** | o contorno de 1px de cada lado o fecha e as pernas viram uma coluna só | `warrior.ts:125-137` |
| **Duas peças vizinhas da mesma cor** | viram um bloco só (a tanga e a canela do Goblin, ambas `trapo`) | `goblin.ts:1138-1147` |
| **Apêndice que não rompe o topo da silhueta** | não lê, mesmo com comprimento e ângulo certos — **área não é legibilidade** | `goblin.ts:820-843`; `docs/BESTIARIO.md:348-360` |
| **Arco plano colapsa em linha** | a antena do Slime virava espeto; a cura é a curva avançar em +Y | `slime.ts:873-881` |
| **Glifo deitado no plano X-Z** | a projeção cisalha a grade da fonte ~26°: rig lê pelo volume, texto lê pelo bitmap | `xpTexto.ts:77-126` |

**O critério de aceite de um apêndice não é área**: é **contribuição de máscara** (quantos
pixels da silhueta somem quando a peça é removida) e **fundo livre** entre a peça e o
corpo. Uma medição de área não enxerga fusão de silhueta.

### 2.7 Rodadas e gates

Nenhum passe é dado por concluído sem revisão visual contra a referência
(`docs/PERSONAGEM.md:313-332`). Gera-se a folha (`npm run preview:personagem -- <bicho>`),
abre-se ao lado da imagem, e responde-se **por escrito**: G1 silhueta reconhecível
(I1..In); G2 as 8 direções coerentes, sem "pular"; G3 direção 0 olha para baixo-direita;
G4 contorno contínuo, sem furos; G5 paleta declarada, sem cor inventada nem gradiente;
G6 apêndices e armas legíveis nas 8. O bestiário acrescenta G7 (tamanho relativo), G8
(escurece mas os olhos continuam acesos), G9 (os três monstros leem como espécies
diferentes), G10 (Slime < Goblin < Guerreiro < Ogro) e G11/G12 para as mortes
(`docs/BESTIARIO.md:225-241`, `:523-531`, `:592-602`).

"**É esperado precisar de 2 a 3 rodadas** — o img2threejs existe justamente porque acertar
de primeira não é realista" (`PERSONAGEM.md:331-332`). E o gate só é julgável se a bancada
mostrar o que ele pergunta: G7 e G8 exigiram painéis novos, "sem isso os dois gates não
são julgáveis" (`BESTIARIO.md:240-241`).

---

## 3. TERRENO — anatomia de um tileset e o relevo que protege a conectividade

### 3.1 O contrato

Todo terreno de um andar é **um** objeto `Tileset` congelado num arquivo `nivelN.ts` e
entregue ao renderer por uma tabela (`src/render/tilesets/index.ts:75-136`). O renderer
não conhece grama nem areia: pergunta `tilesetDoNivel(depth)` e desenha o que vier
(`:6-15`, `:204-212`, com fallback para o nível 1). É a mesma disciplina de `RETRATOS` no
bestiário — um ponto de extensão, nunca um `if (depth === 2)` espalhado pelo desenho.

**Um nível novo precisa de três coisas, e só** (`index.ts:17-29`): o arquivo `nivelN.ts`;
a calibração respeitando `ladoDoTile`; **uma** linha em `TILESETS`. Não toca no renderer,
no engine nem no oracle.

### 3.2 "A ordem é a distribuição"

`piso`, `paredesVariantes` e `aderecos` são **listas**, indexadas pelo bucket que o mapa
já produz (`map.decor[i] & 7`), fechadas com módulo (`index.ts:63-74`;
`IsoRenderer.ts:2841`). **Repetir a mesma variante é como se declara peso.** Não existe
campo de peso e não existe sorteio no desenho — "sortear no desenho é como um replay
deixa de bater" (`index.ts:96-97`).

Duas consequências que já morderam: o bucket só tem **8 slots**, então uma lista de piso
com mais de 8 entradas tem entradas inalcançáveis; e a contagem no comentário **precisa
ser refeita na mão** quando a lista muda — ver §9-H, o caso que essa nota existe para
prevenir (`index.ts:156-162`).

### 3.3 A calibração — o número que não se chuta

`5·S = CONFIG.TW` ⇒ **S = 12,8u** (`nivel1.ts:15-32`; `CONFIG.TW = 64`,
`CONFIG.TH = 32`, `CONFIG.WALL_H = 36` em `src/engine/core.ts:49-51`). Daí:
`ladoDoTile` 12,8; `alturaPiso` 4,0; `alturaParede` 14,4 (= 36 ÷ 2,5); `afundamentoAgua`
2,4 (= 6 px de tela); `detalheTopo` 0,6; `espessuraMinima` 0,5 (`nivel1.ts:176-209`).
Errar `ladoDoTile` por pouco produz **costura branca** (bloco menor) ou **serrilha**
(bloco maior), e nenhum dos dois se conserta depois no renderer.

O afundamento da água é número de **legibilidade de regra**, medido nos dois sentidos
(`nivel1.ts:183-203`): a 1,2u (3 px) a poça lia como laje azul rente ao chão e o jogador
batia numa parede invisível; a 8 px o bloco da frente escondia mais da metade da lâmina;
6 px é onde o degrau ainda se lê de relance. E `aguaAfundaPx` é **derivado**, nunca
digitado duas vezes (`index.ts:186-189`).

**A âncora e o teto.** `z = 0` é o chão (`nivel1.ts:34-43`). Nenhum bloco de piso,
adereço ou água pode subir acima do vértice N do próprio losango — `CONFIG.TH / 2` = 16 px
—, travado por teste (`test/render.test.ts:1468-1501`). A parede é a exceção declarada
(sobe 36 px por contrato) e a coroa vegetal tem teto próprio de 52 px
(`TETO_DA_COROA`, `nivel1.ts:592-597`). O motivo é a ordem do pintor: o passe de pisos de
uma antidiagonal roda **depois** das entidades da anterior.

### 3.4 O blockout de terreno

Três regras herdadas do método de personagem (`nivel1.ts:45-50`): caixa é **opaca** — o
conteúdo tem de ser a superfície; nada abaixo de ~0,5u; o que está embaixo só existe se
sobrar para fora. Mais duas de terreno: **só o corpo do bloco traça contorno**
(`nivel1.ts:236-240` — detalhe com contorno vira grade preta sobre o terreno inteiro) e o
corpo vegetal é **empilhado em faixas disjuntas**, nunca um paralelepípedo com listras
por cima (`nivel1.ts:577-589`).

A justificativa da segunda é medida: sem z-buffer, uma mancha rente a uma face grande, no
canto de baixo à esquerda, é pintada **antes** e some — foi assim que a fiada de baixo do
tijolo e duas das três faixas de `estratosDeTerra` viraram caixa que só custa forja.
**Ao autorar rig novo, valide que a peça APARECE, não só que ela existe.**

### 3.5 Escolher o que vira rig a partir de uma referência

A referência da muralha viva tinha oito blocos; quatro viraram rig e quatro foram
recusados, com o critério escrito (`nivel1.ts:534-557`): só entra o que ainda se distingue
com **64×36 px na tela**, e a distinção tem de vir de um **eixo diferente por variante** —
sebe (verde neutro de fundo), capim (o único claro e amarelado, e o único de textura
vertical), folhagem (o maior motivo), suculenta (a mais escura; numa tela pequena, valor
chega antes de forma). "Quatro rigs que o jogador SEPARA valem mais do que oito que ele
confunde."

E há um ponto em que a referência **não** pode ser obedecida ao pé da letra: folha
escapando da borda estoura o vértice N, então o volume fica dentro do prisma e a bagunça
vem de motivo grande, contraste alto e coroa em alturas diferentes (`nivel1.ts:832-844`).

**Parede e piso não competem em brilho na mesma tela** (`index.ts:143-147`): o barranco de
terra foi trocado por sebe justamente porque usava as mesmas cores do piso de grama e só
a altura separava chão de obstáculo.

### 3.6 A geração, e como cada fase de relevo protege a conectividade

`generate(seed, depth)` roda nesta ordem (`src/engine/mapgen.ts:1345-1500`): normaliza a
semente → `buildLayout` (BSP, salas, corredores) → início → **gate de conectividade** →
escada → vazio → poças → canais → recontagem → decor → notas.

**O gate fica ANTES do relevo**, e é o que faz a garantia das fases seguintes sair
provada e não esperada: BFS → reparo por túnel (até 3) → regeneração com semente derivada
(até `CONFIG.MAX_REGEN = 8`) → selagem como último recurso (`:1386-1423`).

As três fases de relevo usam **três mecanismos diferentes**, cada um o mais barato que
ainda prova o invariante — este é o padrão a imitar em qualquer fase nova:

| Fase | Escreve sobre | Como protege |
|---|---|---|
| **Vazio** (`carveVoid`, `:752-773`) | só `WALL` | não toca conectividade ⇒ **dispensa revalidação**. Régua: BFS de 8 direções, `VOID_CRUST = 1`, duas exceções duras (nada em retângulo de sala, nada na moldura) |
| **Poça** (`plantarAgua`, `:917-968`) | piso | refaz a BFS e **reverte a região por inteiro** se algo ficou inalcançável, até `AGUA_TENTATIVAS = 3`. **Não existe poça parcial** |
| **Canal** (`escavarCanais`, `:979-999`, `:1250-1267`) | só `WALL` | três travas: (1) só come parede; (2) todo canal tem margem; (3) a BFS é revalidada **mesmo assim**, comparando com o total **recontado agora** |

A trava 3 do canal **nunca dispara hoje** por causa da trava 1 — e é exatamente por isso
que ela fica: "no dia em que alguém deixar o canal morder piso, o gerador degrada sozinho
em vez de entregar um andar partido em silêncio" (`:995-999`).

**A água é bitmap paralelo, não um valor de `Tile`** (`:1285-1309`): poça e canal são
`Tile.Floor` com `map.agua[i] = 1`, e um único ponto (`isWalkable`) barra o passo para o
jogador, a IA, o Dijkstra, o `populate` e o restore. O vazio, ao contrário, é um valor de
`Tile` que simplesmente cai fora do trio caminhável — sem linha nova.

**As réguas são medidas, não chutadas.** `VOID_CRUST = 1` (a régua de 2 deixava 1 em 6
andares sem vazio nenhum, média de 8 tiles; com 1 anel, mínimo de 32 tiles em 72 andares —
`:51-60`). `AGUA_TENTATIVAS = 3` (uma tentativa vinga 44% das salas, três ~55%; o resto
fica seco, que é a degradação legítima — `:64-72`). Os `CANAL_*` medidos em **180 andares**
(60 sementes × profundidades 1..3): 100% dos andares ganham enseada, 1 a 3 corpos por
andar (média 1,9), 3 a 31 tiles (média 13,3) — `:74-111`. `ADERECO_EM_CADA = 6` (abaixo de
~4 o jogador confunde cenário com despojo; acima de ~10 o andar volta a parecer tabuleiro
vazio — `IsoRenderer.ts:1002-1011`).

**Relevo é região conexa e nasce no mapgen, não no renderer** (`IsoRenderer.ts:931-944`):
`map.decor` é hash por tile sem nenhuma correlação espacial, então qualquer predicado
sobre ele produz sal-e-pimenta. Um tile de água isolado não lê como água — lê como erro de
tileset.

### 3.7 A forja do terreno

`forjaDoTileset` é uma **constante derivada memoizada em `WeakMap`**
(`IsoRenderer.ts:964-990`): montar `{ paleta, rampas, … }` a cada chamada geraria chave
nova e **reforjaria o andar inteiro 60 vezes por segundo** (`:917-924`). O terreno lê
sempre a linha `DIR_TERRENO` do atlas — giro zero, o bloco exatamente como o tileset o
calibrou; qualquer outra linha giraria o quadrado do tile por dentro do losango
(`:992-1000`). O custo assumido: 72 quadros forjados e **um** lido, pago uma vez por
andar (`:946-954`).

**`modoContorno: 'local'` é ligado em um único lugar** (`IsoRenderer.ts:986`), e o terreno
é o único consumidor em todo o `src/`. O personagem fica no `'fixo'` porque precisa
**saltar** do cenário; um traço duro por bloco de terreno desenharia uma grade sobre o
piso inteiro, que é ruído (`:979-985`). Faixa útil do fator: ~0,35 a 0,65 — acima de ~0,7
o modo **degenera para o `'fixo'` sem erro e sem teste vermelho**, e
`bordaLocalFallback`/`bordaLocalMudos` são os sensores (`spriteForge.ts:984-990`).

---

## 4. MONSTROS — arquétipo, stats, aparência e a fronteira engine/render

### 4.1 A regra que protege o jogo

O jogo tem **exatamente três arquétipos** — `chaser`, `sentinel`, `linker`
(`src/engine/entities.ts:80-123`) — e um monstro novo entra como **rosto** de um deles
(`docs/BESTIARIO.md:16-29`). Zero mudança em `ARCHETYPES`, em `populate()`, em
hp/atk/range/IA. O golden congela quantos e quais inimigos nascem em cada semente:
acrescentar um arquétipo mudaria `pickKind` e invalidaria os 12 casos do oracle de uma
vez — e a partir daí ninguém distingue feature nova de regressão.

A prova de que o desacoplamento funciona: **Goblin, Slime e Ogro entraram inteiros** (rig,
paleta, animação, morte, rastro) sem uma linha de `entities.ts`.

Se ao final `npx vitest run` não estiver 100% verde, **desfaça a mudança — não relaxe o
teste**.

### 4.2 Onde mora cada peça

No engine, cinco lugares de **ordem congelada**: o arquétipo com stats/`nivel`/`fem`
(`entities.ts:80-123`); a tabela de itens; a tabela de despojos (`:259-274`, sorteios
**independentes**, chances que não somam 1, consumo de exatamente `DROPS[kind].length`
valores "dê no que der" — `:276-295`); o nome popular para as missões (`:309-313`); a
linha de pesos de spawn.

No render, **três edições** (`IsoRenderer.ts:384-417`): escrever
`src/render/characters/<bicho>.ts` no molde do goblin; declarar `FORJA_<BICHO>` ao lado de
`FORJA_GOBLIN`; acrescentar **uma** linha na tabela `RETRATOS` (`:418-425`). Quem tem
ficha é desenhado por sprite; quem não tem cai no desenho geométrico, que **continua vivo
como rede de segurança** (jsdom, sem contexto 2D).

O que **não** se faz por aqui: arquétipo novo. A tabela é indexada por `ArchetypeKey`, que
vem do engine (`:410-416`).

### 4.3 O `facing` do inimigo é derivado, nunca campo em `Enemy`

O jogador tem `player.facing` porque o **comando** carrega a intenção. O inimigo não: o
renderer guarda um `Vfx` por id e deduz a direção do diff de posição, nesta ordem
(`IsoRenderer.ts:1805-1835`; contrato em `docs/BESTIARIO.md:31-47`): (a) mudou de tile →
índice do delta em `DIRS8`; (b) parado e adjacente → encara o jogador; (c) nenhum →
mantém o último; (d) nunca visto → sul. "O parâmetro `e` é lido e nunca escrito."

Disso sai o **protocolo das quatro perguntas** para toda feature cosmética futura: para
nascer invisível ao oracle, o campo tem de (a) ficar fora de `snapshot()`, (b) ficar fora
dos extratores do golden, (c) não ser lido por regra nenhuma e (d) não tocar o RNG. Hoje
passam `enemy.bump`, `player.facing`, `game.abatesRecentes` e `game.ui`
(`test/golden/protocolo.ts:41-53`). **Não há guarda automática** — se um dia o dano
depender do facing, o golden fica cego em silêncio.

### 4.4 Cores emissivas — as três condições, ou o brilho se perde em silêncio

O contrato do autor está escrito em `src/render/characters/goblin.ts:196-235`:

1. **a lista de nomes** (`emissivas: ['olhoBrasa']`) — nomes de chave da paleta, nunca hex;
2. **rampa PRÓPRIA, de preferência de um tom só** — com 4 tons a máscara teria de casar 4
   vermelhos; com um tom "as seis faces do olho saem em `#ff4a32` cravado, e a máscara é
   uma comparação de igualdade". Se a cor dividir rampa com o couro, **o couro inteiro
   acende**;
3. **hex distante do resto da paleta** — o snap empurra todo pixel borrado para o degrau
   mais próximo; medido, a mistura olho+pele mais desfavorável cai em `couroLuz`, não em
   `olhoBrasa`.

E a quarta, do lado do rig: **caixas do olho com `contorno: false`**, senão o outline as
cobre e a camada emissiva sai vazia (`spriteForge.ts:71-79`).

---

## 5. ANIMAÇÃO — o atlas de 72 e o que o personagem declara

**Nove quadros × oito direções.** `parado` 2 + `andando` 4 + `atacando` 3 = 9 colunas
(`spriteForge.ts:131-138`); `DIRECOES = 8` linhas; `TOTAL_QUADROS = 72` (`:155-158`). A
silhueta é medida como **união das 72 combinações** — uma caixa só para todos os quadros,
que é o que impede o boneco de "pular" entre direções, o gate G2 (`:1275-1288`).

**Tudo é relativo ao repouso.** `poseDoQuadro(estado, quadro, repouso, arcoGolpe)` é pura:
clona o repouso e **soma** deltas por cima (`:462-524`). O repouso real é propriedade do
personagem — "duplicar aqui os ângulos seria criar uma segunda fonte da verdade que
diverge no primeiro ajuste visual" (`:290-302`). `PoseQuadro.alturaU` carrega a translação
(quique, respiração), porque `Pose` só tem canais de rotação (`:383-395`).

**O quadro de IMPACTO é sempre o 1** — o `IsoRenderer` sincroniza o clarão de dano com ele
(`:501-504`).

### 5.1 A convenção de sinal (que já custou uma rodada)

Membros se estendem em **−Z local**, então `rx > 0` leva a extremidade para +Y (a frente)
e `ry > 0` para −X. Para a abertura lateral vale a mesma conta, **com o fator `ESPELHO`**
(`:447-461`).

> **Corolário: `rz` num membro que se estende em −Z gira o membro em torno do PRÓPRIO
> eixo — a extremidade não sai do lugar. Abertura, adução e abdução são `ry`; nunca `rz`.**

### 5.2 As três armadilhas da projeção, todas medidas

1. **O plano Y-Z é achatado.** Movimento autorado só em `rx` some em metade das direções:
   o golpe viajava **2,8 px de arte** na direção 5 (`:316-321`). A cura é levar o
   movimento para o plano X-Z e somar uma componente em **quadratura** — o membro percorre
   um círculo em vez de uma reta (`:471-493`).
2. **Amplitude abaixo da grade vira zero.** `deslocY` arredonda `alturaU × ART_POR_U` para
   px de arte inteiros: o quique de 0,4u e a respiração de 0,25u da spec quantizavam para
   0 e "o topo da silhueta era o MESMO pixel nos quatro quadros" (`:259-273`). Hoje são
   1,6u e 0,8u. **Autore amplitude em `u`, não em pixel** — foi o que fez elas sobreviverem
   à troca de `ART_POR_U`.
3. **Amostrar o seno em 0/90/180/270 colapsa 4 quadros em 2.** Os quadros 0 e 2 caem os
   dois no cruzamento por zero e a marcha "pisca". `DEFASAGEM = π/8` resolve (`:277-288`).

### 5.3 `ArcoGolpe` — capacidade nova entra como canal declarado

Quando o arco genérico não serve ao jeito como a arma é empunhada, **o personagem declara
o seu** (`:331-367`). O Goblin apoia a cimitarra deitada no ombro: o vetor punho→ponta
ganha componente −Y e o sinal de `rx` se inverte; aplicado cru, o arco genérico fazia o
bicho "erguer a cimitarra e parar" — **2 px de arte de percurso** nos três quadros.

A alternativa recusada está escrita: "um `if` por personagem aqui dentro. O forge é
agnóstico de personagem por contrato… Quem sabe como a arma está empunhada é quem a
empunhou." Contrato: radianos, três valores, mesma convenção de sinal; **lista de tamanho
errado é ignorada em silêncio** e o arco genérico continua valendo; ausente, o atlas sai
byte a byte igual ao de antes do canal existir. **Esse é o padrão para toda capacidade
nova: canal declarado, com fallback que preserva o comportamento anterior byte a byte.**

### 5.4 Nós-adaptadores — o rig se dobra ao vocabulário do forge

O ciclo genérico procura **sete nomes fixos** (`NOS_HUMANOIDE`, `:187-205`), e **nome que
ele não conhece é SILENCIOSO** — o nó simplesmente não gira. O Slime, que tem `corpo` e
`antena`, pendura as duas peças em adaptadores chamados `torso` e `bracoDir`, sem caixa
nenhuma, custando uma matriz cada (`src/render/characters/slime.ts:567-613`). Sem isso ele
sairia do forge como **estátua**: 9 quadros idênticos deslocados em Z.

As três saídas possíveis estão enumeradas no próprio arquivo — (a) ensinar o forge quem é
o slime, proibido por contrato; (b) aceitar a estátua; (c) adaptadores — e a (c) "é
honesta **desde que fique escrita**". Renomear `bracoDir` lá quebra o chicote da antena em
silêncio (aviso replicado em `IsoRenderer.ts:337-342`).

### 5.5 Modulação por luz

Um atlas só, brilho pleno. O escurecimento é `source-atop` sobre uma cópia — o único
operador que respeita o alfa do sprite; um `fillRect` normal pintaria o retângulo inteiro
e o inimigo viraria um bloco (`spriteForge.ts:32-42`). A camada emissiva é extraída uma
vez, na forja, e recolada por cima em brilho pleno. `nivelLuz` é quantizado em
`DEGRAUS_LUZ = 8` (`:1478-1485`) e o par (quadro, degrau) é a chave de um cache de 64
slots com despejo LRU — 504 pares possíveis custariam ~12 MiB por personagem
(`:56-69`). O sensor está exposto: `estatisticasModulacao().despejos` — "se ele crescer a
cada frame, o conjunto de trabalho passou de 64 e é hora de subir a capacidade, não de
culpar o cache".

**Variantes de modelo: podar, não redeclarar.** Corpo sem arma, arma solta, slime
derretido saem de `criarModelo<Bicho>()` — árvore nova — com o filho podado pelo nome
(`warrior.ts:742-785`). "O corpo é o mesmo, e duas declarações do mesmo corpo divergem no
primeiro ajuste visual." Poses de morte são **repousos de forja** congelados na coluna
(`parado`, 0) de atlases secundários; deformação de verdade (o Slime derretendo) vira
**variante de modelo**, porque um repouso só rotaciona nós.

---

## 6. ALGORITMOS canônicos, e por que estes

| Problema | Algoritmo | Por que este, e não o óbvio |
|---|---|---|
| **Campo de visão** | Shadowcasting recursivo **simétrico** (variante de Albert Ford), 4 quadrantes, slopes racionais em aritmética inteira (`src/engine/fov.ts:1-30`) | Simetria é requisito (R27/R28): se eu vejo o monstro, o monstro me vê. Raycasting por amostragem é **proibido** (R26) — produz buracos e assimetria dependente do sentido. Preço aceito: "**NÃO reescreva de forma 'mais elegante'**" — a simetria depende das regras exatas de arredondamento, da ordem da recursão e da aritmética inteira |
| **Navegação da IA** | **Um** Dijkstra por turno a partir do jogador, custo uniforme 1 em 8 direções, sem corte de canto; toda a IA desce o mesmo campo (`src/engine/dijkstra.ts:1-18`) | A\* individual é **proibido** (R34). Um campo custa O(n) e serve N inimigos; N buscas A\* custam N × O(n log n) e ainda precisariam de desempate próprio |
| **Fuga** | O mesmo campo × −1,2, re-escaneado (re-scan iterativo do Brogue), no máximo **uma vez por turno**, compartilhado (`dijkstra.ts:345-355`) | R36. Recalcular por inimigo é o custo que a arquitetura evita |
| **Sólido não tranca o andar** | **Tarjan** iterativo com pilha explícita, recalculado **a cada peça** (`src/engine/entities.ts:1108-1132`, `:1207-1228`) | Medido: BFS por candidato custa 7,687 ms/andar contra 0,676 ms de um passe de Tarjan — 11×, mesma exatidão (0 falso positivo e 0 falso negativo em 14.100 candidatos de 600 andares). Pilha explícita porque 2025 tiles podem encostar no limite de recursão e "um engine puro não pede desculpa por `RangeError`" |
| **Ângulo determinístico** | `scaledAtan2Approx` — portado do GoRogue (MIT, © 2023 Christopher Ridley), com a cadeia de crédito preservada (`src/engine/core.ts:184-200`) | Não é velocidade: a ECMA-262 permite que `Math.atan2` seja aproximação **dependente de implementação**. A função usa só `+ − × ÷` e `Math.abs`, exatos por IEEE-754 ⇒ reprodutível bit a bit entre V8, JSC e SpiderMonkey, que é o que R53 exige |
| **Hash de semente** | FNV-1a 32 bits com `Math.imul` (`core.ts:78-87`); streams por `rng.fork(tag)` com avanço fixo do pai | O `fork` torna o stream reprodutível: consumir o filho nunca perturba a sequência do pai |

**Duas notas de manutenção do FOV.** O módulo **não é reentrante**: `cConeOn`, `cAng` e
`cMeioSpan` são escritos em toda chamada, inclusive nas sem cone — deixar um de fora faz a
próxima `computeFov` herdar o cone da anterior, "falha silenciosa que só aparece muito
depois, no golden" (`fov.ts:59-66`). E **não acrescente guarda de origem-em-parede**: o
renderizador depende do comportamento atual para desenhar de dentro de vãos de parede
(`fov.ts:253-260`).

O **cone de visão** (`fov.ts:326-356`) entrou sem consumidor, deliberadamente: dar cone a
inimigo exigiria `facing` em `Enemy` (proibido pelo ADR-005) e ler `player.facing`
violaria R54. "As duas ideias óbvias de consumidor são inexecutáveis por contrato, não
caras." O cone também **não é otimização** — a oclusão roda no círculo inteiro e o filtro
só decide quem acende: "um cone custa o mesmo que um FOV completo".

---

## 7. VERIFICAÇÃO — as camadas, o que cada uma pega, o que não é coberto

`npm run check` encadeia quatro (`package.json:26`), e se qualquer uma reprova, nada entra:

1. **Fronteiras** — `node tools/check-boundaries.mjs`: o engine não conhece React, DOM,
   `Math.random` nem relógio; o render não conhece React nem a UI
   (`tools/check-boundaries.mjs:14-48`). Isenções por **caminho relativo, nunca basename**
   — "por basename um futuro `src/engine/<subpasta>/core.ts` herdaria a isenção em
   silêncio" (`:29-35`).
2. **Typecheck**, duas vezes: o app e `tsconfig.tools.json`.
3. **Testes** — `vitest run`: T1..T21 em `test/engine.test.ts`, com testes de propriedade
   sobre centenas de sementes.
4. **Golden** — `test/golden.test.ts`: 12 sementes × profundidades 1..3, 200 comandos por
   caso, duas passadas e 4 descidas forçadas, comparados em **ordem cronológica** para que
   a primeira falha apontada seja a primeira divergência real (`:1-21`).

**A marca registrada dos testes deste projeto**: toda prova estatística carrega um
**contrapeso anti-vacuidade**. `"nenhum sólido foi plantado — a prova seria vazia"`
(`test/engine.test.ts:5069-5071`); `"nenhuma das 30 sementes ofereceu um ponto de
articulação"` (`:5591`); e T20.6 fecha a conta pelo outro lado, provando que toda omissão
de instalação foi **forçada**. Recusar tile é fácil; **recusar demais é o modo de falhar
do filtro**.

**A regra de ouro do golden** (`test/golden.test.ts:46-62`): divergência é regressão até
prova em contrário; regenerar é **ato deliberado**, com o dono, registrado em
`obsidian/07 - Changelog`; nunca se regenera para consertar vermelho, nunca se afrouxa
comparação, nunca se pula caso. "A passagem por changelog não é burocracia: é o atrito que
sobrou" — quando o oracle vinha do vanilla, regenerá-lo exigia editar outro programa
antes, e esse atrito era metade da garantia.

**E o extrator do golden é fonte ÚNICA** (`test/golden/protocolo.ts:20-38`): duas cópias
podem divergir, e "uma divergência que **estreita** o que é extraído afrouxa o teste em
silêncio — o pior modo de falha possível para um teste de regressão".

### O que NÃO é coberto

**Não existe golden de render.** Nenhuma mudança de aparência reprova a suíte; o oracle
importa apenas de `src/engine/**` (`docs/VOXEL2PIXEL.md:427-445`). `test/render.test.ts`
usa um contexto 2D **falso** que só anota o que foi pedido, e o próprio arquivo declara: "o
que este arquivo NÃO tenta ser: teste de pixel… A aparência dos rigs é julgada na bancada
de revisão" (`:36-41`).

O que protege a aparência são **três âncoras geométricas** — piso e peça do mesmo tile
assentam no centro do losango; nenhum sprite de terreno sai da grade; nenhum bloco sobe
acima do vértice N (`test/render.test.ts:1336-1501`) — mais a **revisão visual na
bancada**. As âncoras trocam "a imagem está certa" por "a geometria que produz a imagem
está certa": um invariante numérico, estável a repintura.

**Também não têm teste**: o orçamento de forja (< 40 ms, `spriteForge.ts:13-14`) e a
escada do contorno local. **Mudou aparência? Rode a bancada e responda os gates.** Uma
mudança de aparência sem gate visual é uma mudança sem revisão
(`tools/preview-personagem.mjs:164-172`).

A bancada de terreno (`npm run preview:terreno`, `package.json:25`) forja todos os blocos
**duas vezes** — um modo de contorno em cada metade da folha — e põe o guerreiro na cena
como régua. Gates T1..T5 em `tools/preview-entry.ts:586-618`: T1 silhueta fechada sem
furo; T2 o piso deixou de parecer grade **sem virar mancha só** (as duas reprovações são
reais e a pergunta pega as duas); T3 nenhum halo claro; T4 a flor laranja acesa até a
borda; T5 o terreno recuou em relação ao personagem.

---

## 8. O que aprendemos de outros repositórios

O registro completo da rodada de porte está em `docs/VOXEL2PIXEL.md`. O resumo, com o
veredito:

**Voxel2Pixel** (MIT, © 2024 Benjamin McLean) — **nada portado; serviu de contraprova.**
As quatro bandeiras dele já existiam aqui, três em versão melhor
(`docs/VOXEL2PIXEL.md:60-64`): (1) as 8 direções de lá vêm de **duas** projeções
alternadas + giros de 90°, contorno de quem não tem rotação real; aqui o rig tem vértices
em ponto flutuante e uma projeção só. (2) O `NaiveDimmer` interpola em sRGB cru com
mapeamento face→nível **fixo**; aqui há dois mecanismos e nenhum interpola — quantização
para rampa **autorada** e modulação por posição no mundo. (3) "Limitação de paleta" lá é
premissa do formato (cor já indexada), aqui é um quantizador de verdade, porque a entrada
é `ctx.fill()` **com antialias**. (4) O contorno de lá **dilata para fora**; aqui ele
**come para dentro**, e trocar o sentido mudaria a silhueta de tudo o que já foi aprovado
na bancada. Portar seria regressão.

> **Achado de método, e o mais barato da rodada**: o README daquele projeto documenta
> `Iso8()`, um símbolo que **não existe** no código (`docs/VOXEL2PIXEL.md:181-191`). A
> regra que fica: **decisão de porte se toma lendo o código do outro projeto, nunca a
> documentação dele.**

**spotvox** (Apache-2.0) — **aproveitou-se a IDEIA de contorno em MODOS; nenhuma linha
copiada** (`docs/VOXEL2PIXEL.md:39-48`, `:195-216`). A licença Apache-2.0 criaria obra
derivada com obrigação de `NOTICE`; a implementação daqui é própria e faz coisas que a de
lá não faz. Ideia não é expressão — mas a decisão precisa ficar escrita, com a tabela de
licenças ao lado.

**GoRogue** (MIT, © 2023 Christopher Ridley) — **portou-se `scaledAtan2Approx`, com
crédito e cadeia preservada** (`src/engine/core.ts:184-200`), e a **ideia** do cone de FOV.
**Não** se portou o shadowcasting de lá (assimétrico) nem o GoalMap.

**img2threejs** — **a metodologia**: reconstrução por código em passes, com revisão visual
a cada rodada. É o método que `docs/PERSONAGEM.md` já executava em "rodadas", e é de onde
vem a expectativa honesta de "2 a 3 rodadas" (`docs/PERSONAGEM.md:313-332`). Sem Three.js,
que é dependência e mataria o arquivo único.

**ozz-animation** (MIT) — **modelo conceitual de blending por camadas, ainda não
implementado.** Não há traço dele no código hoje; fica registrado para quem for atacar
transições de animação. *(Sem citação de arquivo porque não existe: é decisão da jornada,
registrada aqui pela primeira vez.)*

**FABRIK** (Aristidou & Lasenby) — **recusado.** O rig é plano (não há joelho nem cotovelo
como nós separados: a dobra em L do Goblin mora nas coordenadas das caixas do mesmo nó,
`goblin.ts:1031-1096`), e FABRIK numa cadeia de um elo é degenerado. *(Idem: decisão da
jornada, sem traço no código.)*

**A lição transversal**: em toda avaliação de porte, o entregável é a **decisão escrita**,
mesmo quando a decisão é "não". "Uma decisão de não fazer não deixa diff; se não ficar
escrita, ela volta a ser proposta daqui a três meses e alguém gasta a rodada de novo"
(`docs/VOXEL2PIXEL.md:6-9`).

---

## 9. CASOS — os erros reais desta jornada

> Cada caso: **SINTOMA** (o que se viu) → **CAUSA** (o que era de verdade) → **LIÇÃO** (a
> regra generalizável). São os erros que já custaram rodadas, varreduras de milhares de
> andares ou uma captura de tela do dono. Leia todos antes de escrever código novo.

### A. O NPC que trancava a masmorra

**SINTOMA.** Captura de tela do dono: o mercador plantado no **único tile de saída da sala
inicial**, o herói trancado no cômodo, a escada do outro lado, a partida acabada no turno
0. Medindo, não era azar de uma semente. Em **3000 andares** (500 sementes ×
profundidades 1, 2, 3, 5, 8, 12): **1041 (34,70%) com o mapa partido** e **425 (14,17%)
com a escada inalcançável**. Controle — os mesmos 3000 **sem os sólidos**: **0 partidos, 0
com escada presa**. Nos piores casos sobravam 24 de ~780 tiles: a sala inicial e nada mais
(`obsidian/07 - Changelog/2026-07-31-npc-nao-tranca-passagem.md`;
`src/engine/entities.ts:1046-1071`).

**CAUSA.** O gate de R15/R16 roda **dentro de `generate()`** (`mapgen.ts:1386-1423`) e os
sólidos permanentes — mercador, caldeirão, decoração da alquimia — nascem **depois**, em
`populate()`. `tileDaEntrada` validava seis coisas e **nenhuma delas era conectividade**. O
gerador cumpria o contrato; o povoador o desfazia. Dois agravantes: (1) a heurística de
estética **empurrava para o gargalo** — `escolherCaldeirao` premia `encostado`, o tile com
parede ortogonal ao lado, que é exatamente onde ficam portas e bocas de corredor
(`entities.ts:1690-1701`); (2) o maior ofensor **não era o mercador** (339 andares) — era a
**decoração** da alquimia (525): cenário sem interação nenhuma fechando a masmorra.

**LIÇÃO.** **Toda garantia estrutural do mapa tem de ser revalidada por quem coloca coisa
depois do gate.** Um gate que roda no meio do pipeline não protege o que entra depois dele.
Duas regras derivadas, as duas contraintuitivas:

- **filtre antes de pontuar.** Pontuar primeiro e filtrar depois é deixar a estética
  escolher e a segurança só reclamar;
- **filtre DEPOIS do `shuffle`.** Fisher–Yates consome um sorteio por posição: encolher a
  lista antes muda o consumo e desloca todo o stream de população — um conserto de
  conectividade acabaria mexendo nas missões da fase 3. Filtrar depois **custa zero u32 e
  dá exatamente a mesma distribuição** (`entities.ts:1441-1452`).

E uma armadilha à parte: calcular articulação **uma vez** no mapa intacto não basta — duas
peças que sozinhas não são gargalo podem, **em conjunto**, estrangular um corredor de
largura dois: **176 de 2400 andares (7,33%)** quebravam só pela combinação; refeito por
peça, **0 de 2400** (`entities.ts:1207-1228`). E o zero não é sorte medida, é **indução**.

### B. O restore que reabria o mesmo buraco

**SINTOMA.** Corrigido `populate`, um save gravado por build anterior retomava o andar
**35,07% partido** e **15,53% com a escada presa** — exatamente os números que a correção
tinha acabado de eliminar. E como a partida autossalva a cada turno, **a posição quebrada
se regravava**: o andar trancado não se conserta sozinho (`entities.ts:1293-1318`).

**CAUSA.** A correção morava só no gerador de conteúdo. `restore` aceitava as posições
gravadas conferindo apenas `isWalkable` — outra porta de entrada para o mesmo estado, sem
a mesma validação.

**LIÇÃO.** Correção no produtor não cobre o caminho de **desserialização**. E não é dívida
legada de uma vez só: **um save perfeito no mapa em que foi gravado quebra quando o mapa
muda debaixo dele — 12,19% dos saves sãos partem quando o `mapgen` muda**, e este projeto
mexeu em `mapgen` três vezes nos últimos quatro PRs. Por isso a validação mora no
`restore`, e **não numa migração de versão de save**.

O padrão que sai daí: extraia o gate para uma função (`validarInstalacao` /
`podarAtePassar`, `entities.ts:1316-1341`), chame-a em **toda** porta de entrada do estado,
e deixe o cinto de segurança que hoje nunca dispara — ele fica "porque a garantia depende
de TODO sólido novo passar pelo filtro: o dia em que alguém acrescentar um quarto móvel
sem lembrar disso, o andar degrada em vez de trancar".

### C. A poda que consertava destruindo

**SINTOMA.** A primeira versão da correção de B podava a instalação até o andar voltar a
passar — e levava a instalação **inteira** junto: **71 de 71 andares** voltavam sem
mercador, sem bancada e sem decoração (`test/engine.test.ts:5617-5638`).

**CAUSA.** A poda é cirúrgica na causa e **cega no efeito**: a ordem é extras → caldeirão →
mercador, e nenhuma dessas remoções destrava uma garganta que é **do** mercador. O andar
destravava, mas ficava mudo.

**LIÇÃO.** **Conserto que troca um bug por outro não é conserto.** Trocar um andar
**trancado** por um andar **vazio** reabre o bug de conteúdo invisível que criou a fase 2.1
— o dono jogou uma expedição inteira e não achou o vendedor. É preciso o **fallback**: o
`restore` recupera a peça podada para o ponto que `populate` acabou de calcular (seguro por
construção) e **revalida**. O número certo é **zero**.

Corolário de contabilidade, que hoje é código inalcançável e por isso mesmo tem de estar
certo agora: **podar sem devolver o tile a `taken`** custa o conteúdo duas vezes — a peça e
o que ocuparia a vaga, porque missões e despojos rodam depois e consultam `taken`
(`entities.ts:1375-1386`).

### D. O gate que verificava ZERO arquivos por meses

**SINTOMA.** `node tools/check-boundaries.mjs` saía com código 0 imprimindo "Fronteiras de
camada OK (0 arquivos verificados)". Verde, por meses, com o gate inteiro desligado.

**CAUSA.** `new URL('..', import.meta.url).pathname` devolve `/D:/projetos/...` no Windows
— com uma barra inicial espúria que `existsSync` rejeita. A varredura devolvia lista
**vazia** e o laço nunca rodava (`tools/check-boundaries.mjs:7-12`).

**LIÇÃO.** **Um gate que não prova que OLHOU é indistinguível de um gate que não existe.**
"Zero violações em zero arquivos é indistinguível de zero violações em duzentos — do lado
de fora, os dois imprimem sucesso. É o modo de falha mais perigoso que um gate pode ter,
porque ele **mente na direção tranquilizadora**. Um `exit 1` barulhento seria notado no
primeiro dia; um verde vazio sobrevive indefinidamente" (`:91-107`).

A cura é a **guarda de sanidade**: `if (verificados === 0) → GATE CEGO`, com diagnóstico do
caminho resolvido (`:108-119`). O piso é deliberadamente frouxo — não é meta de cobertura,
é **detector de varredura vazia**. Todo gate novo deste projeto nasce com uma.

### E. O teste que passava com o cone apontando para o lado errado

**SINTOMA.** Oito casos de propriedade cobrindo `computeFovCone`, todos verdes — e três
mutações de **um token**, todas plausíveis num refactor, sobreviviam. Medido, com a suíte
inteira em verde: trocar `<` por `>` na comparação do filtro transformava o cone no seu
**complemento** — um cone "leste" de 18° devolvia **223 de 225 tiles** de uma sala aberta,
incluindo oeste, norte e sul, em vez dos **13 corretos**; trocar `scaledAtan2Approx(dy,dx)`
por `(dx,dy)` **espelhava** o cone (o "leste" passava a apontar para o sul); e inverter a
convenção dentro de `scaledAtan2Approx` reprovava T18 inteiro e **nenhum** caso de T19
(`test/engine.test.ts:4355-4381`).

**CAUSA.** Todos os oito casos eram **relacionais**: subconjunto, igualdade de conjunto,
união, tamanho, não-vazio, aridade. **Nenhuma dessas propriedades sabe para onde o cone
aponta.** A convenção estava travada na função isolada (T18.4, monotonicidade ao longo de
`DIRS8`); nada travava como o **consumidor** a usava.

**LIÇÃO.** **Teste de propriedade relacional não prende direção.** É preciso ao menos uma
afirmação **posicional**, e ela tem de ser **dupla**: o alvo na direção pedida **está**
dentro (senão o cone aponta para outro lugar) **e** os alvos nas outras direções **estão**
fora (senão o filtro não filtra). Só a primeira metade passaria com o cone-complemento; só
a segunda, com um cone vazio.

Detalhe de método que vale copiar: o caso posicional roda numa **sala aberta sintética**, e
não num mapa gerado — "para julgar DIREÇÃO um mapa gerado é péssimo: um tile pode estar
fora do cone por oclusão em vez de por ângulo, e a asserção vira ambígua"
(`test/engine.test.ts:4327-4334`).

### F. O halo claro do contorno local

**SINTOMA.** A regra ingênua do contorno por cor local — *"na falta de opção aceitável, use
a cor mais escura da paleta com índice diferente de `k`"* — pintava, em volta das regiões
**mais escuras**, uma auréola **mais clara** que o miolo. Medido nas duas paletas de
produção: na viseira do Guerreiro a orla saía **+66,7%** de luminância (`contorno` `#191008`
lumSnap 15,33 → `vazio` `#241a12` 25,56); na linha d'água e na junta de argamassa do nível 1,
**+35,8%** (`docs/VOXEL2PIXEL.md:295-342`). Numa peça com 3 ou 4 px de arte de travessia,
isso não é acabamento — é a peça inteira virando moldura clara.

**CAUSA.** Quando a cor local **já é o piso da paleta**, a "segunda mais escura" é, por
definição, mais clara que ela. E o caso não é hipotético: as duas paletas mandam faces
reais para a cor do contorno (`RAMPAS_GUERREIRO.vazio` termina em `contorno`;
`RAMPAS_NIVEL1.vazio` são os **quatro** degraus).

**LIÇÃO, em duas partes.** (1) **Compare por LUMINÂNCIA, não por identidade** — e use a
**mesma métrica** dos dois lados. `lumSnap` usa os mesmos pesos de `maisProximo` de
propósito: "trocar por luma de vídeo (0.299/0.587/0.114) seria o erro clássico — o passe de
contorno decidiria 'mais escuro' por uma régua e a busca de cor por outra, e o desacordo
entre as duas é exatamente onde nasce um halo claro" (`spriteForge.ts:591-602`). (2)
**"Não escrever" é uma saída legítima**: onde a cor local já está no piso da paleta, ela já
lê como contorno contra o fundo. Zero pixel, zero cor nova, zero halo — é o degrau 4 da
escada de cinco.

As quatro alternativas descartadas estão tabeladas (`docs/VOXEL2PIXEL.md:344-352`), e vale
ler por que cada uma cai: inventar a cor por multiplicação **reprova o G5 por construção**;
acrescentar um degrau "piso" muda a paleta canônica, que é decisão de arte e passa pela
bancada.

### G. O golden que certificava o bug

**SINTOMA.** Corrigido o caso A, **doze casos** do oracle mudaram — e a leitura ingênua
seria "a correção quebrou o golden". A verdade era o inverso: o baseline vinha congelando
**andares partidos** havia meses. Verificado por força bruta caso a caso (bloqueando a
instalação **antiga** e medindo o alcance a partir de `map.start`): GOLD-0012 d=3 tinha
**740 tiles** atrás de um extra de decoração; GOLD-0006 d=5, **737** atrás do caldeirão;
GOLD-0003 d=4, **727** atrás de um extra
(`obsidian/07 - Changelog/2026-07-31-npc-nao-tranca-passagem.md`).

**CAUSA.** O oracle é **baseline de regressão caracterizada** (ADR-008): uma fotografia de
como o jogo se comporta **hoje**, não uma prova de que o comportamento está **certo**. Ele
prova **estabilidade**, nunca **correção** — e um defeito estável passa verde
indefinidamente.

**LIÇÃO.** Baseline não é oráculo de correção. Todo dia que aquele fixture passava verde
era um dia certificando o travamento. Daí a disciplina que sobrou
(`test/golden.test.ts:46-62`): regenerar é **ato deliberado**, aprovado pelo dono, em
**commit separado** da correção — "o diff do fixture tem 2491 inserções e ninguém revisa
isso misturado com lógica" — e registrado em `obsidian/07 - Changelog` com a tabela de
medições e a causa. **Nunca se regenera para consertar vermelho.**

Corolário: quando o vermelho for legítimo, o commit tem de dizer **o que se conferiu antes
de aceitar o novo baseline**. "Nenhuma mudança é gratuita."

### H. Números errados que se propagam

**SINTOMA.** O comentário de `piso` em `src/render/tilesets/index.ts` dizia **"grama em 5
dos 8"** buckets. Contando a lista: `MODELO_PISO_GRAMA` aparece **2 vezes** (slots 0 e 3).
O número **saiu dali para a bancada de terreno** antes de alguém conferir.

**CAUSA.** A afirmação foi lida no comentário, não no dado. E ela **se replicou**: a mesma
contagem errada sobrevive hoje em `src/render/IsoRenderer.ts:2824` ("a grama ocupa 5 dos 8
buckets") e uma variante dela em `:953-954` ("o nível 1 declara 8 entradas de piso mas só 3
modelos distintos" — são **6**).

**LIÇÃO.** **Confira a afirmação no dado, não no comentário** — e, quando corrigir uma,
**procure as outras cópias dela**. A correção em `index.ts:156-162` deixou a nota
explícita: "*se mexer na lista, refaça a conta na mão*".

**A mesma classe de defeito, em versão silenciosa: documentação que envelhece.** Hoje, em
pé, no repositório: (1) `index.ts:114-126` diz que `aguaAfundaPx` serve a **dois**
consumidores, "o brilho que corre pela poça e a cachoeira que escorre pela borda" — a
cachoeira foi removida e sobrou um bloco de doc **órfão** descrevendo-a logo acima de
`desenharBrilhoDaAgua` (`IsoRenderer.ts:2637-2648`); (2) os comentários de `mapgen.ts:52-59`
e `:1046-1053` justificam `VOID_CRUST` e a boca do canal "porque a cachoeira precisa da
borda" — a **decisão de geometria continua certa, a justificativa é que envelheceu**; (3)
`IsoRenderer.ts:931-944` abre com "NÃO HÁ ÁGUA NESTA RODADA", e há.

Nada disso é bug de execução, e é por isso que é perigoso: **nenhum teste pega, e o próximo
leitor decide com base nisso.** Ao mexer numa área, releia os comentários vizinhos e corrija
os que a sua mudança acabou de invalidar — no mesmo commit.

---

## 10. CHECKLIST — antes de dizer que acabou

**Sempre, para qualquer mudança.**

- [ ] `npm run check` verde — fronteiras, typecheck, typecheck:tools, vitest, nesta ordem
      (`package.json:26`). Vermelho ⇒ **desfaz a mudança, não relaxa o teste**.
- [ ] Nenhum `Math.random`, relógio, DOM ou import de camada superior no engine/render.
- [ ] Nenhuma imagem, fonte externa, data-URI ou biblioteca nova.
- [ ] Todo número novo no código vem acompanhado, no comentário, da **medição** que o
      produziu e do valor **reprovado** que ele substituiu.
- [ ] Os comentários vizinhos que a sua mudança invalidou foram corrigidos (§9-H).

**Se mexeu em RENDER (modelo, terreno, animação, item).**

- [ ] Bancada rodada e gates respondidos **por escrito**:
      `npm run preview:personagem -- <bicho>` (G1..G12) ou `npm run preview:terreno`
      (T1..T5). Reprovou em qualquer um ⇒ corrige e roda de novo.
- [ ] Paleta fechada, com `rampaDaCor` **total** sobre ela.
- [ ] `peca` só nas peças de silhueta externa; todo o resto `detalhe`.
- [ ] Cor emissiva: rampa própria de **um tom** + caixas com `contorno: false` + hex
      distante do resto da paleta.
- [ ] Nenhuma peça abaixo de ~0,8u de travessia; nenhum bloco de piso/adereço/água acima de
      16 px da âncora.
- [ ] Cada peça nova **aparece** de fato (a ordem do pintor engole caixa em silêncio) — e
      não apenas existe.
- [ ] Se acrescentou campo a `OpcoesForja` que muda pixel: ele entrou na **chave do cache**,
      neste commit.
- [ ] Amplitude de animação declarada em `u`, e ≥ ~0,4u.

**Se mexeu em ENGINE (regra, geração, povoamento).**

- [ ] Nenhum campo novo em `Enemy`, nenhuma linha em `ARCHETYPES`, `populate()` ou IA — a
      menos que arquétipo novo seja **o** objetivo, com o dono junto.
- [ ] Feature cosmética passa nas quatro perguntas do ADR-005 (fora de `snapshot()`, fora
      dos extratores, não lida por regra, não toca o RNG).
- [ ] Fase nova de geração: **stream próprio**, criado depois do layout, e depois das fases
      que já mexem em `isWalkable`.
- [ ] Toda garantia estrutural que a sua mudança pode desfazer foi **revalidada por quem
      escreve depois do gate** — inclusive o caminho de `restore` (§9-A, §9-B).
- [ ] Teste novo tem **contrapeso anti-vacuidade** e, se julga direção/posição, ao menos uma
      afirmação **posicional dupla** (§9-E).
- [ ] Golden vermelho ⇒ abra o **engine**, não o oracle. Se a regeneração for legítima:
      aprovação do dono, **commit separado** do fixture, e registro em
      `obsidian/07 - Changelog` com tabela de medições, causa e lição.

**A pergunta final, sempre.** *O que eu mediria para provar que isto está certo — e o que
eu mediria para provar que a minha própria medição não passou por vacuidade?* Se não houver
resposta para as duas, não acabou.
