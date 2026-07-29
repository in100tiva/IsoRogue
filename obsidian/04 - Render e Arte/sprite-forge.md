---
tipo: nota
atualizado: 2026-07-28
tags: [render, atlas, sprite, pixel-art, cache]
---

# 🔨 Sprite forge — o atlas de 72 quadros

Rasterizar o rig 3D a cada frame seria desperdício: o personagem só tem 8 direções e poucas
poses. `src/render/spriteForge.ts` pré-renderiza tudo **uma vez, em runtime**, e o laço de
desenho vira um `drawImage`. A decisão está em [[ADR-006-atlas-forjado-em-runtime]].

## 8 × 9 = 72

Estados e quadros (`src/render/spriteForge.ts:59`): `parado` 2, `andando` 4, `atacando` 3 —
9 colunas. Oito linhas, uma por direção de `DIRS8`. `TOTAL_QUADROS = 72`.

A coluna de cada estado é **derivada** de `ORDEM_ESTADOS` (`:72`), não escrita à mão: quem
reordenar os estados não precisa lembrar de mexer no localizador `quadro()` (`:1059`).
Direção e quadro chegam normalizados lá dentro — um `facing` fora de faixa devolve um quadro
válido em vez de um `NaN` que pintaria o atlas inteiro na tela.

As poses são função pura `(estado, quadro, repouso) -> PoseQuadro`
(`src/render/spriteForge.ts:352`), somadas **sobre** a pose de repouso do personagem. Para o
Guerreiro o repouso é `POSE_PARADA` (`src/render/characters/warrior.ts:756`), passado em
`opts.repouso` — o forge não conhece o rig e não pode ter uma segunda cópia dos ângulos.

## O pixel art nasce da rasterização

Esta é a regra que define o estilo visual inteiro, e ela é uma **ordem de operações**:

1. o rig é desenhado num buffer de arte de baixa resolução (118×97 px medidos);
2. o buffer é *snapado* para a paleta, ainda em baixa resolução;
3. só então é ampliado ×`PIXEL` com `imageSmoothingEnabled = false`
   (`src/render/spriteForge.ts:998` e `:1035`).

Rasterizar direto em alta resolução produz 3D liso, não pixel art. Inverter os passos 2 e 3
quadruplica o custo do snap e não conserta o antialias. Detalhe em
[[pixel-art-nasce-da-rasterizacao]].

O passe de snap (`snaparBuffer`, `:577`) faz duas coisas num varrimento: força alpha binário
(`LIMIAR_ALPHA = 128` — meio-tom não existe em pixel art) e leva cada pixel para a cor mais
próxima da paleta, com distância euclidiana ponderada 2/4/3 em RGB. O alpha binário produz
de graça uma **máscara de silhueta exata**, e é dela que sai o contorno externo: todo pixel
opaco com vizinho-4 transparente vira `contorno` (`:627`). Foi essa máscara que fechou o
gate G4 — um `stroke` de largura fracionária deixava o outline com furos.

Dois cuidados de custo moram aí: o `memo` de "cor borrada → degrau" é compartilhado pelos 72
quadros (o antialias gera ~1,4 mil cores distintas no atlas inteiro), e cada quadro só varre
o **próprio retângulo sujo**, medido antes com folga de 2px (`FOLGA_SUJO`, `:458`).

## Medida e âncora

Antes de desenhar qualquer coisa, o forge mede a união das 72 combinações
(`src/render/spriteForge.ts:918`) e usa **um** tamanho de quadro para todas — é o que impede
o boneco de "pular" de tamanho entre direções (gate G2).

Medido no rig atual (`ART_POR_U = 2.5`, `PIXEL = 1`, `margem = 2`):

| grandeza | valor |
|---|---|
| quadro | 118 × 97 px |
| âncora | (59, 82) |
| atlas | 1062 × 776 px (9 colunas × 8 linhas) |

A âncora **não é** a borda de baixo do quadro: é a projeção da origem do modelo, o centro
dos pés no plano `z = 0`. Como a bota afunda de propósito, há 15 px de arte abaixo dela.
Quem cola o sprite subtrai a âncora do centro do losango
(`src/render/IsoRenderer.ts:1192`), e a barra de vida sobe para `ancoraY − 6`, senão
cruzaria a lâmina erguida (`:1287`).

## Cache e custo

`forjarAtlas` (`:844`) memoiza num `WeakMap` pela raiz do rig e, dentro, por uma chave
textual estável das opções — dois zooms ou duas paletas do mesmo rig são atlas diferentes e
não podem se atropelar. `chaveEstavel` (`:777`) ordena as chaves, então a ordem em que o
objeto de opções foi escrito não gera cache miss. Injetar `desenhar`/`medir` ignora o cache
(é o caminho do preview e dos testes). `limparCacheAtlas()` invalida por geração, já que
`WeakMap` não itera.

Alvo declarado: **< 40 ms**, e `msForja` é medido e exposto para diagnóstico (`:1050`).
A forja acontece na primeira vez que o jogador é desenhado
(`IsoRenderer.atlasDoGuerreiro`, `src/render/IsoRenderer.ts:1129`), e é tentada **uma vez
por instância**: falhar não pode virar retentativa por quadro.

Sem DOM (jsdom, node) o atlas é devolvido com `canvas: null` e `disponivel: false`. O
renderer checa e cai no desenho geométrico antigo do jogador
(`src/render/IsoRenderer.ts:1214`) — o jogo nunca fica sem personagem por causa de um
ambiente pobre. É por isso que `canvas` é anulável no tipo: devolver um canvas que não
existe seria mentira de tipo.

## Animação: quem escolhe o quadro

O forge só produz quadros. A máquina de estados vive no renderer
(`src/render/IsoRenderer.ts:1042`) e é alimentada **por observação**: mudança de tile do
jogador vira deslize de 120 ms, crescimento de `stats.dmgDealt` vira golpe de 240 ms,
`player.facing` escolhe a linha do atlas. Nada disso escreve no engine, e o turno jamais
espera pela animação. O `facing` só pôde entrar por ser cosmético — ver
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

## Pendências visuais conhecidas

- A silhueta ainda está mais atarracada que a referência (pernas curtas).
- A direção 7 (nordeste) fica estreita demais.
- O quadro é bem mais largo que os 64 px do losango, então o sprite invade os tiles
  vizinhos na mesma antidiagonal e passa por cima de paredes já desenhadas. Corrigir exige
  z-buffer — ver [[projecao-isometrica]].
- ~~Os inimigos não migraram para o atlas.~~ **Fechada.** Os três arquétipos têm rig e atlas
  próprios, e a modulação do quadro pela luz do tile que faltava está em `quadroModulado()`
  (`src/render/spriteForge.ts:1423`). Ver [[bestiario-monstros]].

Ver também: [[personagem-rig-3d]], [[paleta-e-estilo]], [[revisar-o-personagem]],
[[inspecao-visual-headless]], [[bestiario-monstros]], [[_moc-render-e-arte]].
