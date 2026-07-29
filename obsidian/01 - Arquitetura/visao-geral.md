---
tipo: nota
atualizado: 2026-07-28
tags: [arquitetura, visao-geral, roguelike, restricoes]
---

# 🗺️ ISOROGUE — visão geral

Roguelike 3D isométrico por turnos que cabe em **um arquivo HTML**. Você abre o
`dist/index.html` com dois cliques, sem servidor, sem instalar nada, sem internet — e joga:
masmorra gerada por BSP num grid 45×45, campo de visão por shadowcasting, três arquétipos de
inimigo dirigidos por um único mapa de Dijkstra, poções, escada, morte permanente.

O pedido está congelado em 58 requisitos numerados (`docs/BRIEF.md`, R01..R58). Cada um é
verificável: ou existe no código e alguém consegue apontar onde, ou não foi entregue.

## As quatro restrições que moldam tudo

Não são preferências de estilo. São o que decide a forma de cada módulo.

**1. Um único arquivo (R01, R55).** O entregável não é uma pasta com `assets/`. É
`dist/index.html`, 296 KB, com JS e CSS inlinados. Isso mata de saída qualquer solução que
dependa de carregar recurso — e é por isso que o personagem é desenhado por código em vez de
importado como sprite sheet. Ver [[build-e-entregavel]] e
[[ADR-001-arquivo-unico-sem-dependencias]].

**2. Zero dependência de conteúdo (R02, R56).** Nenhuma imagem, nenhuma fonte, nenhuma
biblioteca de jogo. `package.json:26-28` lista exatamente duas dependências de runtime:
`react` e `react-dom`. Tudo mais é `devDependency`. Não há Three.js, não há motor de física,
não há UI kit. O que aparece na tela é Canvas 2D escrito à mão — ver [[projecao-isometrica]] e
[[personagem-rig-3d]].

**3. Zero rede.** Nenhum `fetch`, nenhuma URL externa, nenhum CDN. O teste T9 varre o
entregável recém-buildado atrás de qualquer referência que o navegador fosse buscar
(`test/engine.test.ts:739`) e ainda faz um censo dos tokens residuais: cada `http://` que
sobra no bundle tem de casar com um padrão conhecido do runtime do React
(`test/engine.test.ts:769`). Ocorrência nova reprova.

**4. Determinismo (R19, R20, R53).** Mesma semente + mesma sequência de comandos ⇒ mesmo
resultado, byte a byte. Isso não é detalhe de implementação: é uma promessa ao jogador, que
pode copiar `K7QX-3M9P` e mandar para um amigo sabendo que ele vai encontrar a mesma masmorra,
os mesmos inimigos e a mesma poção no mesmo canto. Ver [[determinismo]].

## Como o código está organizado

Três camadas, com dependência de mão única:

```
src/engine/**   lógica pura. Não conhece React, DOM, Canvas nem relógio.
src/render/**   Canvas 2D imperativo. Lê o engine. Não conhece React.
src/ui/**       React 19 + JSX. Conhece tudo.
```

A fronteira não é convenção: `tools/check-boundaries.mjs` a executa e falha o build. Os
detalhes — e o que quebra se alguém violar — estão em [[camadas-e-fronteiras]] e em
[[ADR-002-engine-puro-fora-do-react]].

## O que aconteceu em 28/07/2026

O jogo nasceu em JavaScript vanilla puro — oito arquivos concatenados por um script de build
num HTML só — e **no mesmo dia** foi migrado para React 19 + TypeScript + Vite. A versão
vanilla não foi apagada: está congelada em `legacy/` e virou o **oracle** contra o qual a
versão nova é medida, comando a comando. Ver [[golden-test]] e
[[ADR-003-golden-test-como-oracle-da-migracao]].

Ainda no mesmo dia entrou o guerreiro: um rig 3D próprio, projetado e rasterizado em sprites
gerados em runtime, no lugar da forma geométrica que representava o jogador. Ver
[[personagem-rig-3d]], [[sprite-forge]] e o [[2026-07-28-nascimento-migracao-e-guerreiro]].

## Números de referência

| O quê | Valor | Onde |
|---|---|---|
| Grid | 45×45 | `src/engine/core.ts:38` |
| Raio de FOV | 9 | `src/engine/core.ts:44` |
| Raio seguro no início | 6 (Chebyshev) | `src/engine/core.ts:45` |
| Tentativas de regeneração do mapa | 8 | `src/engine/core.ts:46` |
| Zoom | 0,45 a 2,4 | `src/engine/core.ts:50-51` |
| Entregável | 296.019 bytes | `dist/index.html` |
| Fontes TypeScript | 32 arquivos em `src/` | — |

## Por onde continuar

- [[_moc-arquitetura]] — o mapa desta pasta.
- [[_moc-sistemas-de-jogo]] — masmorra, FOV, Dijkstra, turnos.
- [[_moc-render-e-arte]] — projeção, personagem, paleta, iluminação.
- [[rodar-e-buildar]] — os comandos, na ordem certa.
- [[como-usar-este-cofre]] — convenções de escrita destas notas.
