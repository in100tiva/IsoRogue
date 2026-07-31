# ISOROGUE — Voxel2Pixel, spotvox e o contorno por MODO

> Registro escrito da rodada que introduziu `OpcoesForja.modoContorno`
> (`src/render/spriteForge.ts:977`). Esta página existe porque a rodada começou
> como uma pergunta de PORTE — "dá para trazer o Voxel2Pixel para cá?" — e
> terminou como uma decisão de NÃO PORTAR, com uma ideia de terceiro aproveitada
> e reimplementada do zero. Uma decisão de não fazer não deixa diff; se não
> ficar escrita, ela volta a ser proposta daqui a três meses e alguém gasta a
> rodada de novo.
>
> Leia antes: `docs/PERSONAGEM.md` §4 (pipeline), §7 (sprite forge) e §10
> (gates); `docs/BESTIARIO.md` §1 e §1.1 (modulação por luz e emissivas). Esta
> página **não** redefine nada daquelas duas — ela justifica uma opção nova e
> registra o estado da verificação em torno dela.

---

## 0. O resultado, em cinco linhas

1. **Nenhuma linha e nenhuma constante** foi copiada do Voxel2Pixel ou do
   spotvox. O que veio de fora foi UMA ideia — contorno em modos — e ideia não é
   expressão.
2. O contorno de silhueta ganhou dois modos: `'fixo'` (o de sempre, padrão) e
   `'local'` (`src/render/spriteForge.ts:580`).
3. O modo `'local'` é ligado em UM lugar: a forja do terreno
   (`src/render/IsoRenderer.ts:986`). Personagem, monstro, item e despojo
   continuam em `'fixo'` — é o traço duro que os faz saltar do cenário.
4. A escolha da cor da borda é uma **escada de cinco degraus**
   (`spriteForge.ts:778-826`), não a regra ingênua de "use a cor mais escura".
   O §4.3 abaixo mostra, com números das paletas reais, por que a regra ingênua
   pinta um halo CLARO exatamente onde deveria pintar contorno.
5. As quatro bandeiras do Voxel2Pixel já existem neste repositório, três delas
   em versão melhor. Portar seria regressão — §2.

---

## 1. As fontes, as licenças e a procedência do que está escrito aqui

| Projeto | Licença | O que se aproveitou | Código copiado |
|---|---|---|---|
| **Voxel2Pixel** — © 2024 Benjamin McLean | MIT | nada; serviu de contraprova (§2) | **nenhum** |
| **spotvox** | Apache-2.0 | a IDEIA de contorno em MODOS (§3) | **nenhum** |

Declaração explícita, porque a ausência de atribuição só é defensável se for
verdadeira: **nenhuma linha, nenhuma constante, nenhuma tabela e nenhum nome de
símbolo** dos dois projetos foi transcrito para `src/`. Não há arquivo `NOTICE`
a preservar porque não há obra derivada. Todo o código citado nesta página é
deste repositório e tem `arquivo:linha` ao lado.

**Procedência das afirmações sobre os projetos de terceiros.** O §2 e o §3
descrevem o Voxel2Pixel e o spotvox como eles foram lidos na revisão que
motivou esta decisão. Essa leitura **não foi refeita contra um checkout** ao
escrever esta página — ela fica aqui como registro do que fundamentou a
decisão, não como documentação daqueles projetos. Se alguém quiser reabrir a
conversa de porte, o caminho honesto é reler o código de lá primeiro; §2.5
explica por que reler o README **não** conta.

---

## 2. Por que NÃO portamos o Voxel2Pixel

O Voxel2Pixel se apresenta com quatro bandeiras: 8 direções, *dimmer*,
limitação de paleta e contorno. As quatro já existem aqui. Três estão em versão
melhor, e a quarta está numa versão **deliberadamente oposta**.

### 2.1 "8 direções" — aqui há rotação de verdade, e uma projeção só

O rasterizador de lá obtém as oito vistas alternando entre duas projeções
(`IsoEight` / `IsoEightUnderneath`) e girando o volume de 90 em 90 graus. Isso é
**contorno de quem não tem rotação real**: sem interpolar a grade de voxels, os
únicos giros baratos são os múltiplos de 90°, e as direções diagonais precisam
de uma segunda projeção para existirem.

Aqui o problema não existe porque o modelo não é uma grade de voxels — é um rig
de caixas com vértices em ponto flutuante (§4.1 do PERSONAGEM.md). O giro é
contínuo e real:

- `giroParaFrente(dx, dy)` (`src/render/model3d.ts:673`) converte o índice de
  `DIRS8` no ângulo de yaw;
- `giroDaDirecao(dir)` (`src/render/spriteForge.ts:442-445`) normaliza o índice
  e delega a conta — e delega de propósito: ter duas versões da fórmula em dois
  arquivos é como o gate G3 falha em silêncio;
- o laço de forja (`spriteForge.ts:1381-1429`) aplica esse giro às 8 linhas ×
  9 colunas com **uma única** projeção isométrica, a de §4.2 do PERSONAGEM.md.

Trocar isto pelo esquema de duas projeções alternadas seria **regressão**:
perderíamos a liberdade de mudar `DIRECOES` sem reescrever a projeção, e
introduziríamos uma segunda matemática de câmera num pipeline que hoje tem uma
só. O `docs/PERSONAGEM.md` §4.2 é explícito — "não invente outra projeção".

### 2.2 "dimmer" — aqui há DOIS, e os dois são melhores

O `NaiveDimmer` de lá produz 5 níveis por interpolação linear em sRGB cru,
mexendo no alfa, com um mapeamento face→nível **fixo**. Duas fraquezas: o
escurecimento é uma conta genérica sobre a cor (nenhum artista escolheu o
resultado) e o nível da face não acompanha uma rotação contínua.

Aqui há dois mecanismos, e eles resolvem coisas diferentes:

**(a) Sombreamento por material, na hora de montar o modelo** — `model3d.ts`:

- `fatorLuz(nx, ny, nz)` (`model3d.ts:493-501`) é a média ponderada pelos
  cossenos dos três eixos, **contínua em toda a esfera visível**. O comentário
  na linha 489 diz por que não se escolhe o eixo mais próximo: isso cria degraus
  ao girar — exatamente o defeito do mapeamento fixo.
- `quantizar(tom, fator, ganho)` (`model3d.ts:509-525`) não interpola cor
  nenhuma: ele escolhe, por luminância, o degrau mais próximo da **rampa autorada
  do material**. Quem decide como o ouro do Guerreiro escurece é
  `RAMPAS_GUERREIRO` (`src/render/characters/warrior.ts:62-67`), não uma fórmula.
- `RAMPA_DERIVADA = [0.42, 0.66, 1, 1.34]` (`model3d.ts:238`) é só o **fallback**
  para material que não declarou rampa; `rampaEfetiva` (`model3d.ts:424`) é quem
  resolve as duas vias.

Ou seja: onde o `NaiveDimmer` interpola, aqui se **quantiza para uma rampa que
alguém desenhou**. É a diferença entre "3D com iluminação contínua" e pixel art
— o próprio §4.3 do PERSONAGEM.md põe isso como requisito.

**(b) Modulação por luz de tile, sobre o atlas PRONTO** — `spriteForge.ts`:

`quadroModulado(atlas, dir, estado, frame, nivelLuz)` (`spriteForge.ts:1652`)
escurece o quadro já forjado com `source-atop` sobre uma cópia, em
`DEGRAUS_LUZ = 8` degraus (`spriteForge.ts:1475`), com cache LRU de 64 slots
(`spriteForge.ts:1523-1524`) e recolagem da camada emissiva em brilho pleno
(`spriteForge.ts:1434`, `AtlasPersonagem.emissivo` em `:1046`). Isso é uma
categoria que o Voxel2Pixel não tem: escurecimento por POSIÇÃO NO MUNDO, não
por orientação de face, com as cores emissivas atravessando acesas (§1.1 do
BESTIARIO).

Portar o dimmer de lá substituiria dois mecanismos especializados por um
mecanismo genérico pior que qualquer um dos dois.

### 2.3 "limitação de paleta" — lá não há quantizador; aqui há

O Voxel2Pixel casa cor por **igualdade exata** com a paleta do modelo de voxels:
a cor já vem de uma paleta indexada, então não há o que quantizar. É uma
premissa do formato de entrada, não um recurso.

Aqui a entrada é o resultado de `ctx.fill()` de polígono, **com antialias**, e o
problema é real: medido na rodada 1 do sprite forge, 86,6% dos pixels estavam
fora da paleta (o registro está no cabeçalho de §2.1,
`spriteForge.ts:526-553`). A resposta é `maisProximo(pal, r, g, b)`
(`spriteForge.ts:716-731`), distância euclidiana **ponderada**
(`PESO_R = 2`, `PESO_G = 4`, `PESO_B = 3`, `spriteForge.ts:576-578`), memoizada
por RGB empacotado ao longo dos 72 quadros (`spriteForge.ts:872-877`) — sem a
memoização a busca linear rodaria ~140k vezes em vez de ~1,4k, e a forja
estouraria o orçamento de §7.

Não há nada a importar: o quantizador daqui resolve um problema que lá não
existe.

### 2.4 Contorno — lá dilata para FORA; aqui come para DENTRO

Esta é a única das quatro em que a diferença não é "melhor/pior", e sim
**incompatível por decisão**.

Lá o contorno nasce de dilatar a máscara da silhueta para fora: o sprite ganha
uma orla de 1px e fica maior que o volume que o gerou.

Aqui o contorno **consome** o pixel de borda: no passe 2 de `snaparBuffer`
(`spriteForge.ts:884-932`), todo pixel opaco com um vizinho-4 transparente é
REPINTADO — a silhueta não cresce um pixel sequer. O critério está em
`spriteForge.ts:905-913`.

A decisão é deliberada e tem dois donos declarados:

- **I6** do `docs/PERSONAGEM.md:33` — "contorno escuro contínuo, outline de 1px
  de arte em toda a silhueta". Contínuo, não maior.
- **G4** do `docs/PERSONAGEM.md:328` — "o contorno está contínuo, sem furos?".
  O gate julga fechamento, não espessura.

E há a consequência prática, que é o argumento que encerra a conversa: as
âncoras de enquadramento do atlas — `larguraArte`/`alturaArte`, `ancoraX`,
`ancoraY` (`spriteForge.ts:1298-1311`) — saem da união das 72 caixas MEDIDAS.
Um contorno que dilata para fora tornaria a silhueta 2px mais larga e 2px mais
alta que a caixa medida, e ou o sprite passa a ser cortado na margem
(`MARGEM_PADRAO = 2`, `spriteForge.ts:1096`), ou todo o enquadramento e todas as
âncoras do elenco inteiro mudam. **Trocar o sentido do contorno mudaria a
silhueta de tudo o que já foi aprovado na bancada** — Guerreiro, Goblin, Slime,
Ogro, itens, despojos e agora o terreno.

### 2.5 O README do Voxel2Pixel não descreve o código do Voxel2Pixel

Registro de método, e é o achado mais barato desta rodada: o README daquele
projeto documenta `Iso8()`, um símbolo que **não existe** no código — no master
os nomes são `IsoEight` e `IsoEightUnderneath`. Um README que erra o nome da
função principal não é fonte confiável para uma decisão de arquitetura.

A regra que fica: **decisão de porte se toma lendo o código do outro projeto,
nunca a documentação dele.** É a mesma disciplina que este repositório aplica a
si mesmo — o cabeçalho de `docs/PERSONAGEM.md` §8 e o de `spriteForge.ts` mandam
ler o código antes de confiar na prosa, inclusive na prosa deles próprios.

---

## 3. Por que NÃO portamos código do spotvox

### 3.1 A licença

O spotvox é **Apache-2.0**. Copiar código de lá criaria obra derivada com
obrigação de atribuição e de preservação de `NOTICE`. O `package.json` deste
projeto declara **ISC**. Não é um conflito insuperável — Apache-2.0 e ISC
convivem —, mas resolvê-lo direito custa: arquivo de `NOTICE`, cabeçalho de
atribuição nos arquivos derivados e a obrigação de manter os dois em dia. Para
o que se ganharia (uma função de escolher cor de borda, ~30 linhas), o preço é
alto e permanente.

### 3.2 O que se aproveitou, e por que isso é legítimo

Aproveitou-se **a ideia**: ter o contorno em MODOS, com um modo em que a borda
usa uma versão escurecida da cor LOCAL em vez de uma cor única. E, junto com a
ideia, o julgamento de onde ela serve — **leve no terreno, pesado no
personagem**, que é exatamente o que está escrito em `spriteForge.ts:971-972` e
no comentário da forja do terreno (`IsoRenderer.ts:979-985`).

Ideia não é expressão, e é por isso que não há nada a atribuir. A implementação
daqui é própria e faz coisas que o spotvox não faz:

- decide por **luminância na mesma métrica do quantizador** (`lumSnap`,
  `spriteForge.ts:600-602`) — ver §4.1;
- **nunca inventa cor**: o alvo é sempre um degrau declarado, o que mantém o
  gate G5 verde por construção;
- **nunca escurece pixel emissivo** (degrau 0 da escada);
- tem a **escada de cinco degraus** com o caso "não escreve" (degrau 4), que é o
  que impede o halo de §4.3;
- é uma **tabela** calculada uma vez por forja, não uma conta por pixel (§4.4).

---

## 4. A escada de decisão, degrau a degrau

Local: `tabelaBordaLocal(pal, fator)` — `src/render/spriteForge.ts:778-826`.
Privada de propósito: ela não é API, é o miolo de uma opção.

### 4.1 O predicado, e por que ele é de LUMINÂNCIA

```
aceita(j, k) ⟺ j ≥ 0 ∧ j ≠ k ∧ ¬emissiva[j] ∧ lum[j] < lum[k]
```

(`spriteForge.ts:784-785`, com `lum` preenchido em `:782`.)

Duas escolhas que não são detalhe:

**(a) O teste é de luminância, não de identidade.** `j !== k` sozinho só pegaria
a colisão total e deixaria passar uma matiz vizinha de luminância **igual ou
maior** — que na tela lê como borda clara, não como contorno.

**(b) A luminância é `lumSnap`** (`spriteForge.ts:600-602`), que usa os MESMOS
pesos de `maisProximo` (`PESO_R = 2`, `PESO_G = 4`, `PESO_B = 3`,
`spriteForge.ts:576-578`), e não a luma de vídeo (0.299/0.587/0.114). Usar duas
réguas seria o erro clássico: o passe de contorno decidiria "mais escuro" por
uma métrica e a busca de cor por outra, e **o desacordo entre as duas é
exatamente onde nasce um halo claro**. A divisão por `PESO_R + PESO_G + PESO_B`
existe só para manter a escala em 0..255; como a comparação é relativa, o
divisor não muda nenhuma decisão.

### 4.2 Os cinco degraus

Para cada degrau `k` da paleta, com `Q = (r_k·F, g_k·F, b_k·F)` e
`F = fatorContorno ?? FATOR_CONTORNO_LOCAL` (`= 0.5`, `spriteForge.ts:589`):

| # | Condição | Ação | Linha |
|---|---|---|---|
| 0 | `emissiva[k]` | `-1` — **não escreve** | `:791-794` |
| 1 | — | `alvo = maisProximo(Q)` | `:796-800` |
| 2 | `!aceita(alvo, k)` | `alvo = pal.contorno` | `:802` |
| 3 | `!aceita(alvo, k)` | varredura: o mais próximo de `Q` **entre os aceitáveis** | `:804-818` |
| 4 | nada aceitável | `-1` — **não escreve** | `:805` + `:819-820` |

**Degrau 0 — o pixel de olho não pode ser escurecido.** `extrairEmissivo` roda
DEPOIS, sobre o atlas pronto (`spriteForge.ts:1434`): um pixel emissivo comido
pelo contorno some da camada emissiva **em silêncio**, e o goblin no escuro
perde os olhos. Vale registrar que o modo `'fixo'` tem esse defeito hoje e
continua tendo — consertá-lo lá mudaria a aparência de personagens já aprovados
na bancada. Aqui é comportamento novo, então nasce certo
(`spriteForge.ts:751-755`).

**Degrau 1 — é o que dá o ponto ao modo.** A borda fica na FAMÍLIA da cor local
em vez de um preto único para tudo. É a razão de o modo existir.

**Degrau 2 — porque `maisProximo` não sabe o que é "mais escuro".** Ele minimiza
distância; o mais próximo de `k·F` pode perfeitamente ser o próprio `k`. Com `F`
alto isso acontece na maioria das cores de uma paleta esparsa — e é por isso que
`bordaLocalFallback` existe (§4.5).

**Degrau 3 — perto, não mínimo global.** A varredura pega o mais próximo de `Q`
**entre os aceitáveis**, não a cor mais escura da paleta: manter a matiz é o
ponto do modo, e a cor mais escura costuma ser de outra família. `<` estrito, a
mesma regra de desempate de `maisProximo` (`:813`) — determinismo, que é
requisito de §7 do PERSONAGEM.md.

**Degrau 4 — não escrever é uma resposta.** É o degrau que este documento
existe para justificar. Ver §4.3.

### 4.3 O degrau 4 e o HALO CLARO (a razão de a versão ingênua estar errada)

A tentativa óbvia, e que quase entrou: *"na falta de opção aceitável, use a cor
mais escura da paleta com índice diferente de `k`"*.

Ela produz um **halo claro** em volta das regiões mais escuras. A conta é
trivial: quando a cor local `k` **já é o piso da paleta**, a "segunda mais
escura" é, por definição, mais CLARA que ela. O modo pintaria uma auréola em
volta justamente das regiões onde deveria pintar contorno.

**Este caso não é hipotético — as duas paletas de produção mandam faces reais
para a cor do contorno.**

**Guerreiro** (`src/render/characters/warrior.ts`):

- `RAMPAS_GUERREIRO.vazio = ['vazio', 'vazio', 'contorno', 'contorno']`
  (`warrior.ts:66`) — os dois degraus mais escuros do material `vazio` **são a
  própria cor de contorno**;
- `RAMPA_DA_COR.contorno = 'vazio'` (`warrior.ts:80`) — a cor `contorno` é ela
  mesma um material legítimo de peça;
- e há peças reais nesse material: a **viseira** do elmo
  (`detalhe('vazio', …)`, `warrior.ts:460`, o traço I2) e a **sola** da bota
  (`warrior.ts:711`).

**Nível 1** (`src/render/tilesets/nivel1.ts`):

- `RAMPAS_NIVEL1.vazio = ['contorno', 'contorno', 'contorno', 'contorno']`
  (`nivel1.ts:149`) — os QUATRO degraus;
- `RAMPAS_NIVEL1.agua[3] = 'contorno'` (`nivel1.ts:132`) e
  `RAMPAS_NIVEL1.argamassa[3] = 'contorno'` (`nivel1.ts:139`) — o degrau mais
  escuro da água e da argamassa cai na cor do contorno;
- `RAMPA_DA_COR_NIVEL1.contorno = 'vazio'` (`nivel1.ts:166`);
- e há blocos reais nesses materiais: a água (`nivel1.ts:448-452`) e as juntas de
  argamassa da parede e do piso de tijolo (`nivel1.ts:496`, `:503`, `:506-507`,
  `:512`).

**Os números.** Replicando a escada sobre as duas paletas com `F = 0.5` e a
métrica de `lumSnap` (`PESO_R/G/B = 2/4/3`):

| Paleta | Degraus | Cor mais escura (`lumSnap`) | Segunda mais escura | Salto do halo |
|---|---|---|---|---|
| `PALETA_GUERREIRO` (`warrior.ts:41-52`) | 10 | `contorno` `#191008` — **15,33** | `vazio` `#241a12` — 25,56 | **+66,7%** |
| `PALETA_NIVEL1` (`nivel1.ts:59-118`) | 46 | `contorno` `#2a1b12` — **27,33** | `terraSombra` `#40201a` — 37,11 | **+35,8%** |

Ou seja: a viseira do Guerreiro ganharia uma orla 67% mais clara que ela mesma,
e a linha d'água / a junta de argamassa do nível 1 ganhariam uma orla 36% mais
clara. Numa peça que tem 3 ou 4 pixels de arte de travessia, isso não é um
detalhe de acabamento — é a peça inteira virando uma moldura clara.

**As alternativas descartadas, e por quê:**

| Alternativa | Por que não |
|---|---|
| segunda cor mais escura da paleta | o halo acima — mede-se em +67% de luminância na paleta do Guerreiro |
| multiplicar `k` por `F` e usar o RGB cru | inventa cor fora da paleta; **reprova o G5 por construção**, que é o gate que o passe de snap existe para garantir |
| acrescentar um degrau "piso" à paleta | muda a paleta canônica de §2 do PERSONAGEM.md e de §3 do BESTIARIO — decisão de arte, não de render, e passaria por G5 e pela bancada |
| cair no `'fixo'` quando não houver alvo | é o que o degrau 2 já faz; quando `k` **é** o `contorno`, `'fixo'` também não tem resposta — pintar `contorno` sobre `contorno` é um no-op caro |
| **não escrever** (escolhido) | a cor local já está no piso da paleta: contra o fundo ela **já lê como contorno**. Zero pixel, zero cor nova, zero halo |

**O sensor.** `bordaLocalMudos` (`AtlasPersonagem`, `spriteForge.ts:1079`) conta
os degraus que não pintam borda — emissivos (degrau 0) ou já no piso (degrau 4).
Nas duas paletas, com `F = 0.5`: Guerreiro `mudos = 1` (só `contorno`), nível 1
`mudos = 2` (`frutoLaranja`, emissiva por `CORES_EMISSIVAS_NIVEL1`,
`nivel1.ts:170`; e `contorno`). Nas duas, `fallback = 0` — nenhum degrau
precisou do caminho 2/3.

> **Procedência destes números:** eles vêm de replicar a escada de
> `tabelaBordaLocal` sobre as duas paletas fora do jogo, não de ler
> `atlas.bordaLocalFallback` num atlas forjado. O Guerreiro, aliás, **não é
> forjado em `'local'`** hoje (§5) — o número dele está aqui para mostrar que a
> escada não foi ajustada em cima de uma paleta só.

### 4.4 Por que TABELA e não conta por pixel

A decisão depende **só da cor do pixel**, e depois do passe 1 de `snaparBuffer`
(`spriteForge.ts:863-882`) só existem `n` cores possíveis — 10 no Guerreiro, 46
no nível 1. Então a escada roda O(n²) **uma vez por forja**
(`spriteForge.ts:1366-1373`, fora do laço dos 72 quadros) e o passe de pixels
vira uma indexação: `pal.indicePorRgb.get(rgb)` → `bordaLocal[k]`
(`spriteForge.ts:915-926`). Os 72 quadros custam o mesmo que no modo `'fixo'`.

Dois detalhes de implementação que valem a linha:

- `PaletaSnap.indicePorRgb` (`spriteForge.ts:622`, montado em `:697-703`) existe
  para recuperar o índice por **igualdade exata** em vez de repetir a busca por
  proximidade. Ele só é correto porque o passe 1 deixou todo pixel opaco
  exatamente numa cor declarada — o `undefined` em `:919` é cinto de segurança,
  não caminho previsto.
- O passe 2 reescreve a cor **in place** no mesmo varrimento, e isso continua
  válido no modo `'local'` **por um fio**: a cor da borda sai da cor do PRÓPRIO
  pixel, nunca do vizinho. O aviso está em `spriteForge.ts:891-894` — no dia em
  que a decisão passar a depender do vizinho (média, dithering), este laço deixa
  de poder escrever in place.

### 4.5 A degeneração, e o número que a denuncia

Conforme `F` sobe, mais cores têm a **si mesmas** como alvo mais próximo, a
escada cai no degrau 2/3 e o modo degenera para o `'fixo'` — sem erro, sem
exceção, sem teste vermelho. Acima de `F ≈ 0,7` isso vale para a maioria dos
degraus de uma paleta esparsa. `bordaLocalFallback` (`spriteForge.ts:1077`)
expõe a contagem para o painel de debug, porque um número visível é mais barato
que descobrir a degeneração na bancada. Faixa útil documentada:
~0,35 a 0,65 (`spriteForge.ts:979-983`).

---

## 5. Onde o modo é ligado — e onde não é

`grep -rn 'modoContorno' src/` devolve exatamente **um** consumidor:

- `src/render/IsoRenderer.ts:986` — `forjaDoTileset` monta as opções de forja do
  terreno com `modoContorno: 'local'`. O comentário em `:979-985` diz por quê:
  um traço duro por bloco desenharia uma grade sobre o piso inteiro, que é
  ruído — o terreno é fundo, e fundo não disputa a leitura com quem anda em cima
  dele.

Todo o resto do elenco (Guerreiro, Goblin, Slime, Ogro, itens, despojos, texto
de XP) continua no padrão `'fixo'`, que é byte a byte o comportamento de sempre.
`'fixo'` é o default de `OpcoesForja.modoContorno` (`spriteForge.ts:977`, campo
opcional), então **nada precisou ser tocado** nos rigs existentes — o que era o
requisito de compatibilidade desta rodada.

**A chave do cache.** `modoContorno` e `fatorContorno` entraram na chave de
memoização de `forjarAtlas` (`spriteForge.ts:1231` e `:1233`) no mesmo commit
que os criou. Sem isso, duas forjas do MESMO rig diferindo só no modo colidiriam
e a segunda receberia o atlas da primeira — sem erro de tipo, sem exceção, e
nenhum teste de unidade pegaria. O comentário em `:1227-1230` deixa a regra
escrita: **todo campo novo de `OpcoesForja` que mude pixel entra na chave, no
mesmo commit que o cria.**

---

## 6. O estado da verificação — com honestidade

Esta seção existe para que ninguém leia o §4 e conclua que a escada está
travada por teste. Ela não está.

### 6.1 NÃO existe golden de render neste repositório

Dito com as duas evidências:

- `test/golden.test.ts:101` lê **um** arquivo:
  `test/golden/engine-snapshots.json`. Não há folha de pixels, não há hash de
  atlas, não há PNG de referência.
- `test/golden/protocolo.ts:56-72` importa **apenas** de `src/engine/**`
  (`core`, `entities`, `game`, `save`, `types`). O oracle não sabe que
  `src/render/` existe.

Consequência direta: **nenhuma mudança de aparência reprova o golden.** O que
protege o render são as três âncoras de §6.3 e a revisão visual na bancada
(§10 do PERSONAGEM.md).

### 6.2 Até esta rodada, `snaparBuffer` NUNCA tinha executado em teste

`test/render.test.ts` monta um `document` de mentira cujo contexto
(`contextoMudo`, `test/render.test.ts:504`) **omite `getImageData` e
`putImageData` de propósito** — o comentário em `:498-503` declara isso e diz
por quê (o atlas continua com o tamanho e a âncora certos, que é tudo o que
aqueles casos medem, e a forja fica barata).

O efeito colateral é que `snaparBuffer` saía na **primeira linha**
(`spriteForge.ts:848`, a guarda `typeof ctx.getImageData !== 'function'`). Ou
seja: o passe 1 (snap de paleta e alpha binário) e o passe 2 (contorno por
máscara) — **o acabamento inteiro do sprite, os gates G4 e G5** — nunca haviam
rodado sob teste.

Isso mudou nesta rodada: `test/forjaPixel.test.ts` instala um canvas de
**software** completo (`instalarDomDeForjaPixel`, `test/forjaPixel.test.ts:350`;
`removerDomDeForjaPixel`, `:366`) que implementa exatamente — e só — a
superfície que a forja consome. Agora `snaparBuffer` executa de verdade e os
bytes da folha são medidos.

### 6.3 As três âncoras, e o que cada uma cobre

| Âncora | Arquivo | Cobre | Não cobre |
|---|---|---|---|
| **1** | `test/forjaPixel.test.ts` (27 casos: 16 da forja + 11 do modo novo) | a FORJA sobre pixels reais: snap de paleta, alpha binário, contorno de silhueta pela máscara, o blit para a célula certa da folha 9×8, a ampliação ×`pixel`, a camada emissiva e a chave do cache | com `desenhar`/`medir` injetados, `desenharModelo` não roda: nada ali julga projeção, sombreamento, ordem do pintor ou contorno interno |
| **2** | `test/model3d-cor.test.ts`, `describe` em `:452` | a saída de `montarModelo`: `faces[].cor` por (peça, face), `corContorno`, `larguraContorno`, quais peças têm silhueta, a ordem do pintor e a geometria — três hashes separados, sem canvas | não toca a forja nem o atlas |
| **3** | `test/model3d-cor.test.ts`, `describe` em `:485` | o traço de `pintarModelo` sobre o mesmo `ModeloMontado`: `tracarContornoNitido` (Bresenham, `Math.floor`, a trava `limite`) e a ORDEM `fillStyle` → `fill` → `strokeStyle` → `stroke` → contorno | idem |

As âncoras 2 e 3 somam **27 casos**: `CASOS` tem 6 entradas
(`test/model3d-cor.test.ts:388-406`) × 3 `it` na âncora 2 (`:454`, `:457`,
`:460`) + 2 avulsos (`:465`, `:475`) + 1 `it` por caso na âncora 3 (`:487`) + 1
avulso (`:492`) = 4·6 + 3 = 27.

O caminho `'local'` é coberto no mesmo arquivo da âncora 1, sobre o mesmo canvas
de software: **dez casos**, sobre três forjas de opções idênticas salvo o modo —
**A** = `'fixo'` (o default), **B** = `'local'`, **C** = `corContorno: null`, a
referência de cor local pura.

| Caso | O que prende |
|---|---|
| **P0** | o alpha é o mesmo nas três corridas, pixel a pixel — se falhar, os outros não significam nada |
| **P1** | o passe 2 não vaza para dentro: todo miolo de B é a cor local de C |
| **P2** | G5 — nenhuma cor inventada; toda a folha de B está na paleta declarada |
| **P3** | **o halo**: cada borda de B ou ficou mais escura que a cor local, ou não foi repintada por já estar no piso |
| **P4** | a borda de B tem mais de uma cor, e B difere de A — pega a queda silenciosa para o `'fixo'` |
| **P5** | a camada emissiva de B é a de A: o brilho sobreviveu (degrau 0) |
| **P6** | `modoContorno` e `fatorContorno` estão mesmo na CHAVE do cache |
| **P7** | sensores zerados no `'fixo'`; no `'local'`, 2 mudos NOMEÁVEIS: a cor emissiva e a do piso |
| **P8** | fator alto degenera a escada — e a folha confirma, perdendo cores distintas na borda |
| `corContorno: null` | `null` desliga a silhueta **também** no `'local'`: folha byte a byte igual à de C |

**P3 é o caso que justifica a escada**, e foi verificado por mutação: trocando o
degrau 4 (o `-1`) pela alternativa ingênua — "a cor de menor luminância com
índice ≠ k" — ele reprova nomeando a auréola, com a cor local e a cor pintada:

```
(30,2) local=#0d0c10 (lum 13.6) borda=#33501f (lum 57.2)
```

A faixa do piso recebia borda **4× mais clara** que a própria cor. `P7` e `P8`
morderam junto, o que é bom sinal: os sensores de degeneração enxergam o mesmo
defeito que o teste de pixel.

**O buraco que fica, dito em voz alta:** nada disto julga APARÊNCIA. Os
predicados provam que a borda é mais escura, está na paleta declarada e não come
o brilho — não que o resultado seja bonito, nem que o terreno leia melhor do que
lia antes. Isso é da bancada, e continua sendo julgamento humano.

### 6.4 `npm run lint` verifica ZERO arquivos nesta máquina

`package.json:16` define `"lint": "node tools/check-boundaries.mjs"`, e o script
está no `npm run check` (`package.json:25`).

A saída real, rodada nesta máquina:

```
> node tools/check-boundaries.mjs
Fronteiras de camada OK (0 arquivos verificados).
EXIT=0
```

**Zero arquivos**, e sai verde. A causa é uma linha:

```js
// tools/check-boundaries.mjs:6
const RAIZ = new URL('..', import.meta.url).pathname;
```

No Windows, `URL.pathname` de um `file:` URL devolve `"/D:/projetos/..."` — com
uma **barra inicial espúria**. `join(RAIZ, 'src/engine')` produz um caminho
inválido, o `existsSync` de `:46` devolve `false`, `arquivos()` devolve `[]`, o
laço de `:59-77` não itera, `falhas` fica em 0 e o processo sai com código 0
imprimindo a mensagem de sucesso. É a pior forma de falha: **verde por não ter
olhado.**

Correção sugerida: `fileURLToPath` de `node:url`.

```js
import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
```

**NÃO corrigido nesta rodada — fora de escopo.** E o motivo de não ter sido
corrigido de passagem é substantivo: consertar o script faz ele varrer
`src/engine/**` e `src/render/**` pela primeira vez nesta máquina, e o que ele
encontrar (se encontrar) é uma rodada própria, não um efeito colateral de uma
rodada de contorno.

### 6.5 As três falhas T9 são pré-existentes e AMBIENTAIS

Baseline desta máquina, `npx vitest run`:

```
Test Files  1 failed | 5 passed (6)
     Tests  3 failed | 199 passed (202)
```

As três estão todas em `test/engine.test.ts`, no `describe('T9 — sem construções
proibidas')` (`:763`), e as três são do ambiente Windows, não do código:

| Caso | Linha do `it` | Causa |
|---|---|---|
| `nenhuma fonte de src/ usa Math.random, eval, new Function, rede ou URL externa` | `:770` | `fontesDoProjeto()` chama `execFileSync('find', …)` (`:755-759`) — o utilitário Unix `find` não existe aqui |
| `dist/index.html é auto-contido: nenhuma referência externa` | `:798` | `garantirBuild()` chama `execFileSync('npx', ['vite', 'build'])` (`:713-718`) — `spawnSync npx ENOENT` |
| `os tokens residuais do bundle são só do runtime React/Vite` | `:828` | idem |

**Estas três não se consertam nem se silenciam nesta rodada.** Elas são o
baseline: qualquer QUARTA falha é regressão desta rodada e tem de ser
investigada como tal. Consertar o T9 (trocar `find` por uma varredura em Node,
resolver o binário do `npx`) é uma rodada própria, com o mesmo argumento do
§6.4 — e vale notar que ela é PARENTE do §6.4: os dois problemas são a mesma
espécie de suposição de POSIX num repositório que roda em Windows.

### 6.6 O orçamento de forja não tem teste

`docs/PERSONAGEM.md:242` fixa o alvo: **"Custo alvo: < 40ms na inicialização"**,
repetido no cabeçalho do módulo (`spriteForge.ts:14`).

`AtlasPersonagem.msForja` existe (`spriteForge.ts:1067`) e é preenchido
(`spriteForge.ts:1437`). O único teste que o toca é
`test/forjaPixel.test.ts:851-852`, e ele assere apenas que o número é **finito e
não-negativo**. **Nenhum teste compara `msForja` com 40**, e nenhum compara com
coisa alguma.

Isso é decisão consciente, não esquecimento: um limite de tempo em CI é um teste
instável por natureza — ele reprova por máquina lenta e passa por máquina
rápida, e um teste que reprova por motivo alheio ao código treina a equipe a
ignorar vermelho. O orçamento é vigiado pelo **painel de debug** (que lê
`msForja`), não pela suíte. Quem quiser travá-lo de verdade precisa de uma
bancada de desempenho separada da suíte de correção — outra rodada.

Nota relacionada: esta rodada **não muda** o custo de forja no caminho `'local'`
(§4.4 — a escada é O(n²) uma vez, o passe de pixel é uma indexação), mas isso
também não está medido.

---

## 7. O que NÃO se fez nesta rodada

- **Não** se portou código de lugar nenhum. §1 e §3.1.
- **Não** se mudou o sentido do contorno (para dentro continua sendo para
  dentro). §2.4.
- **Não** se ligou `'local'` em personagem, monstro, item ou despojo — só no
  terreno. §5.
- **Não** se corrigiu o defeito do modo `'fixo'` com pixel emissivo
  (`spriteForge.ts:752-756`): corrigi-lo mudaria a aparência de personagens já
  aprovados na bancada, e isso passa por G5 e por revisão visual.
- **Não** se corrigiu `tools/check-boundaries.mjs`. §6.4.
- **Não** se consertou nem se silenciou nenhuma das três falhas T9. §6.5.
- **Não** se criou golden de render. §6.1. O caminho `'local'` é coberto por
  predicados sobre a folha (§6.3), não por bytes congelados — o que se prende é
  a REGRA (a borda é mais escura, está na paleta, não come o brilho), não uma
  captura que qualquer ajuste de arte invalidaria.
- **Não** se mediu aparência automaticamente, porque não dá: os predicados de
  §6.3 provam a regra, e a bancada julga o resto.
