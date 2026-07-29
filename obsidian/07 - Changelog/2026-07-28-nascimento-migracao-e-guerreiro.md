---
tipo: changelog
atualizado: 2026-07-28
tags: [changelog, migracao, react, personagem, golden]
---

# 📆 28/07/2026 — nascimento, migração e o guerreiro

Três atos num dia só. O jogo nasceu em JavaScript vanilla, foi migrado para React 19 +
TypeScript sob a proteção de um oracle construído a partir da própria versão vanilla, e
ganhou um personagem 3D reconstruído por código. Cada ato entregou algo e deixou dívida
nomeada.

---

## Ato 1 — o jogo em vanilla

Roguelike 3D isométrico por turnos em **um único arquivo HTML**, sem biblioteca, sem
imagem, sem requisição de rede: os 58 requisitos de `docs/BRIEF.md` (R01..R58). O fonte
era um conjunto de módulos concatenados — `legacy/src-vanilla/00-core.js`, `10-mapgen`,
`20-fov`, `30-dijkstra`, `40-entities`, `50-render`, `60-ui`, `70-game`, mais `shell.html`
e `ui.css` — montados num HTML só.

Entregou o jogo inteiro: masmorra BSP com conectividade garantida por BFS, shadowcasting
recursivo por octantes com FOV simétrico, um único mapa de Dijkstra recalculado a partir
do jogador, três arquétipos de inimigo, turnos, progressão, morte permanente,
determinismo por semente e salvamento local. Trazia também um harness próprio
(`legacy/harness-vanilla.mjs`) com as baterias T1..T10 rodando o HTML em `node:vm`.

**Essa versão não virou lixo — virou instrumento.** Está congelada em `legacy/` e é o
oracle do ato 2. Não se edita.

## Ato 2 — a migração para React 19 + TypeScript

Mesmo dia, mesmo comportamento, arquitetura nova: React 19, TypeScript, Vite 8 (sobre
Rolldown), entregue ainda como arquivo único via `vite-plugin-singlefile`. As únicas
dependências de runtime continuam sendo `react` e `react-dom`.

A regra que sustenta a arquitetura: **o engine não conhece React, DOM nem Canvas**.
`src/engine/**` só importa de si mesmo; `src/render/**` fala com Canvas 2D e lê o engine;
`src/ui/**` é a única camada com JSX. A fronteira é verificada por script no `npm run
lint` (`tools/check-boundaries.mjs`), não por disciplina. O estado do jogo é um objeto
mutável de vida longa que **nunca** entra em `useState` — React o observa por assinatura
de versão.

A prova de que nada quebrou é o golden test:

- `tools/gen-golden.mjs` roda o HTML vanilla em `node:vm` e grava
  `test/golden/snapshots.json` (~1,4 MB);
- 12 sementes `GOLD-0001`..`GOLD-0012`, profundidades 1..3, **200 comandos por caso**;
- duas passadas por caso (canônica e "resistente", com vida reposta antes de cada
  comando) e 4 descidas forçadas para exercitar a progressão;
- comparação em ordem cronológica, de modo que a primeira falha apontada seja sempre a
  primeira divergência real.

E o golden foi **testado por mutação**: `WOUNDED_RATIO` de 0.3 para 0.31, um ponto
percentual no limiar de fuga dos feridos. Ele pegou — `GOLD-0008`, comando 94 de 200, com
snapshot antes e depois. Ver [[golden-test-precisa-ser-testado]].

## Ato 3 — o guerreiro

Com o golden verde, entrou a primeira feature de verdade: substituir o boneco geométrico
do jogador por um personagem 3D. O método vem do **img2threejs**
(<https://github.com/img2threejs/img2threejs>), que apesar do nome não voxeliza nem
extruda imagem: reconstrói o objeto **como código** — primitivas determinísticas — a
partir de uma especificação derivada da referência, em passes revisados visualmente contra
ela. Three.js não entrou: o projeto não tem dependências, e o rig próprio é projetado no
Canvas 2D.

Três módulos novos: `src/render/model3d.ts` (pipeline de caixas, pose, projeção,
iluminação por face), `src/render/spriteForge.ts` (poses, snap de paleta, atlas) e
`src/render/characters/warrior.ts` (o rig do guerreiro). O atlas tem **72 quadros** —
8 direções × 9 colunas (2 parado + 4 andando + 3 atacando) — forjado em runtime, sem
imagem embutida.

Ganhos de percurso registrados como aprendizado: [[armadilha-do-yaw-isometrico]] (a
fórmula da spec girava o modelo 90°) e [[pixel-art-nasce-da-rasterizacao]] (a ordem
rasterizar → snapar → ampliar *é* o estilo visual). A bancada de revisão
(`npm run preview:personagem`) reusa o próprio Vite, porque o Vite 8 roda sobre Rolldown e
não expõe esbuild — bundlar por fora exigiria dependência nova, que é proibida.

O `player.facing` nasceu no engine mas é **cosmético**: não entra em `snapshot()`, não
entra em `extrairJogador()` do golden, nenhuma regra o lê. Foi assim que a feature entrou
sem invalidar o oracle, seguindo o precedente do `bump` dos inimigos. Ver
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

---

## O que ficou pendente

**Do personagem (revisão visual, gates G1..G6):**

- silhueta ainda mais atarracada que a referência — pernas curtas;
- a direção 7 (nordeste) fica estreita demais; a rodada 3 atacou o problema trocando
  largura por fundo nas caixas do tronco, mas não o fechou;
- o sprite de 88 px invade cerca de 12 px do tile vizinho na mesma antidiagonal e passa
  por cima de paredes. Corrigir exigiria z-buffer — a ordem do pintor por antidiagonal
  sozinha não resolve.

**De escopo:**

- os inimigos **continuam em formas geométricas simples**: não migraram para o sistema de
  sprites. O `TODO(inimigos-no-atlas)` (`src/render/IsoRenderer.ts:922-929`) registra o
  que faltaria: modulação do quadro pela luz do tile — coisa que o jogador não precisa
  porque *é* a fonte de luz, e que não deve ser implementada por antecipação, sem
  consumidor e sem revisão visual.

**De balanceamento:**

- a curva foi calibrada contra bot, nunca contra humano. Num teste de 3.000 comandos o
  jogador tomou **1.144** de dano e causou **90**. O número vale como medida do agente
  aleatório, não como medida de dificuldade percebida — falta jogar.

---

Ver [[visao-geral]], [[camadas-e-fronteiras]], [[golden-test]], [[personagem-rig-3d]],
[[sprite-forge]] e [[como-usar-este-cofre]].
