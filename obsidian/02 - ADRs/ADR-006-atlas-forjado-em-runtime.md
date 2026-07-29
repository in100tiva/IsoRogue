---
tipo: adr
atualizado: 2026-07-28
tags: [render, performance, personagem, cache]
---

# 🔥 ADR-006 — Atlas de 72 quadros forjado em runtime

**Status:** aceita · ~37 ms no boot, alvo era < 40 ms

## Contexto

O rig do Guerreiro ([[ADR-004-personagem-por-codigo]]) é caro de rasterizar: dezenas de
caixas, seis faces cada, back-face culling, sombreamento interpolado por normal, quantização
para a rampa do material e traçado de contorno. Fazer isso a 60 fps, todo frame, para
desenhar **um** personagem seria desperdício grotesco.

E o desperdício seria de trabalho repetido: o modelo só tem **8 direções × 9 quadros de
animação** (2 parado + 4 andando + 3 atacando). Nada mais. Cada frame do jogo redesenharia
uma das 72 combinações que já foram desenhadas antes.

Não dá para pré-gerar isso num PNG e embutir: [[ADR-001-arquivo-unico-sem-dependencias]]
proíbe recurso externo, e um data-URI de sprite sheet congelaria a arte.

## Decisão

Forjar um **atlas de 72 quadros em runtime**, uma única vez, e depois só `drawImage`.

`forjarAtlas(modelo, opts)` (`src/render/spriteForge.ts`) monta um canvas com 8 linhas
(direções de `DIRS8`) × 9 colunas (`ORDEM_ESTADOS = ['parado','andando','atacando']`,
`QUADROS_POR_ESTADO = {2,4,3}`), e devolve `quadro(dir, estado, frame) → {sx, sy}` mais a
âncora e o diagnóstico.

**Forja sob demanda, no primeiro desenho do jogador**, nunca no import
(`src/render/IsoRenderer.ts:1129-1138`). O flag `atlasTentado` garante que uma forja
malsucedida não seja retentada a cada frame.

Três decisões dentro da forja que não são detalhe de implementação:

**1. Uma silhueta só para os 72 quadros.** O passe 1 mede a **união** de todas as
combinações e daí sai um único `larguraArte × alturaArte`
(`src/render/spriteForge.ts:906-940`). É isso que impede o boneco de "pular" de tamanho ao
mudar de direção — o gate G2 da revisão visual.

**2. A ampliação mora num lugar só.** O rig é rasterizado num buffer de *arte* em baixa
resolução e a passagem para a tela é um `drawImage` com `imageSmoothingEnabled = false`
(`src/render/spriteForge.ts:995-999` e, no desenho final, `IsoRenderer.ts:1197-1205`, que
restaura o flag depois para não estragar os outros `drawImage` do mesmo contexto). Inverter
essa ordem produz 3D liso — ver [[pixel-art-nasce-da-rasterizacao]].

Nota de escala: a rodada 3 trocou `ART_POR_U` 1.25 → **2.5** e `PIXEL` 2 → **1**
(`src/render/model3d.ts:60,71`). O invariante é o **produto** — 2,5 px de tela por `u` —
que não mudou. O aspecto "chunky" nunca veio do `PIXEL = 2`: vem do snap de 10 cores com
alpha binário. Efeito colateral desejado: o personagem parou de ser mais grosso que o
cenário, que já é desenhado em 1 px de tela.

**3. Cache por modelo, com chave de opções.** `WeakMap<No, Map<string, AtlasPersonagem>>`
(`src/render/spriteForge.ts:756`): a identidade é a raiz do rig, e dentro dela uma chave
textual estável das opções — dois zooms ou duas paletas do mesmo rig são atlas diferentes e
não podem se atropelar. Como `WeakMap` não itera, o "clear" possível é invalidar as chaves,
e é o que `limparCacheAtlas()` faz, para o preview e os testes.

## Custo medido

**~37 ms** de forja no boot, contra o alvo de 40 ms de `docs/PERSONAGEM.md:241`. O número é
exposto pelo próprio atlas em `msForja` (`src/render/spriteForge.ts:732`, arredondado a uma
casa) e aparece no painel de depuração e na bancada de revisão.

Chegar lá exigiu duas otimizações registradas no código:

- **Retângulo sujo por quadro.** Cada frame só limpa e varre a *própria* caixa medida no
  passe 1, não o buffer inteiro. Com `ART_POR_U = 2.5` o buffer tem 4× a área da rodada
  anterior e a silhueta ocupa ~1/3 dele — *"varrer tudo 72 vezes é o que estourava o alvo de
  40 ms"* (`src/render/spriteForge.ts:912-916`).
- **Memo do snap de cor** compartilhado pelos 72 quadros: "cor borrada → degrau da paleta"
  é calculado uma vez por cor, não uma vez por pixel (`src/render/spriteForge.ts:569-572`).

## Consequências

**Boas**

- No jogo, desenhar o personagem é um `drawImage` de região do atlas. O custo por frame
  independe da complexidade do rig.
- 37 ms pagos uma vez, num boot que já está carregando o mapa. Imperceptível.
- Zero bytes de arte no entregável.
- O zoom **não** reforja nada: o `drawImage` final escala por `z` com suavização desligada
  (`IsoRenderer.ts:1192-1199`). O atlas é resolução de arte, não resolução de tela.
- Deslocamento vertical por coluna é arredondado para px de arte inteiros — meio pixel tira
  o sprite da grade e desfia o pixel art (`src/render/spriteForge.ts:900-904`). Foi por isso
  que a amplitude da respiração precisou subir: na escala antiga ela valia 0,31 px de arte e
  quantizava para zero.

**Ruins**

- **Degradação obrigatória.** Em jsdom e em Node não há `getContext('2d')`. O atlas nasce
  com `disponivel: false`, responde a `quadro()` e simplesmente não tem pixels
  (`src/render/spriteForge.ts:975-980`); o `IsoRenderer` cai no desenho geométrico do
  vanilla, intacto (`IsoRenderer.ts:1214`, acionado em `IsoRenderer.ts:1289`). Ou seja: existe um segundo caminho de
  desenho do jogador que precisa continuar funcionando e que quase ninguém olha.
- Mudar a escala, a paleta ou qualquer proporção do rig **invalida o atlas inteiro** — não há
  forja parcial. Na prática isso é bom (é uma reforja de 37 ms), mas significa que não existe
  "atualizar só a espada".
- O atlas ocupa memória de vídeo proporcional a `larguraFrame × 9 × alturaFrame × 8`. Com um
  rig doente isso explodiria, daí a trava `MAX_ART = 256` px de arte por eixo
  (`src/render/spriteForge.ts:747`).
- Quando os inimigos migrarem, a conta multiplica por arquétipo — e ainda faltará o caminho
  de modulação do quadro pela luz do tile, que o jogador não precisa por ser a fonte de luz
  (`IsoRenderer.ts:923`, `TODO(inimigos-no-atlas)`). Ver [[fog-of-war-e-iluminacao]].

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Rasterizar o rig 3D a cada frame | 72 combinações redesenhadas eternamente. O custo por frame passa a depender da complexidade do rig — exatamente o que o atlas elimina. |
| PNG pré-gerado e embutido em base64 | Viola R02/[[ADR-001-arquivo-unico-sem-dependencias]], infla o arquivo e congela paleta e proporção fora do código. |
| Forjar no `import` do módulo | Custo pago mesmo em teste headless e em qualquer ambiente sem Canvas, e um `throw` no import derrubaria o jogo inteiro. Sob demanda + `atlasTentado` resolve os dois. |
| Um atlas por zoom | O `drawImage` já escala com suavização desligada. Multiplicaria memória e tempo de forja por nada. |
| Cache global por nome do personagem | Colidiria entre variações do mesmo rig. A identidade correta é a **referência** do modelo + as opções, e é o que o `WeakMap` + chave estável dá. |

Relacionadas: [[sprite-forge]] · [[personagem-rig-3d]] · [[paleta-e-estilo]] · [[revisar-o-personagem]]
