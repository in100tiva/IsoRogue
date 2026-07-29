---
tipo: adr
atualizado: 2026-07-28
tags: [arquitetura, build, restricao, entregavel]
---

# 📦 ADR-001 — Arquivo único, sem dependências

**Status:** aceita · vale para todo o projeto

## Contexto

O briefing abre com duas linhas que não são preferência, são fronteira:

- **R01** — "Roguelike 3D isométrico por turnos, um único arquivo HTML." (`docs/BRIEF.md:6`)
- **R02** — "Sem bibliotecas, imagens ou recursos externos. Renderizado em Canvas." (`docs/BRIEF.md:7`)
- **R56** — "Sem dependências externas e sem requisições de rede." (`docs/BRIEF.md:81`)

O entregável é um `.html` que você abre por `file://` e joga. Sem servidor, sem CDN, sem
pasta de assets ao lado. Toda decisão do projeto passa por esse funil.

## Decisão

O artefato de produção é **um** `dist/index.html` auto-contido, gerado por Vite +
`vite-plugin-singlefile` (`vite.config.ts:11`), com `assetsInlineLimit: 100_000_000` e
`cssCodeSplit: false` para que nada escape como arquivo separado.

Dependências de runtime: **duas** — `react` e `react-dom` (`package.json:25-28`). Elas
entram no bundle e viram parte do arquivo. Tudo o mais é `devDependency`.

Nenhuma imagem, nenhuma fonte, nenhum sprite sheet, nenhum data-URI de PNG. Arte é
**código que desenha** (ver [[ADR-004-personagem-por-codigo]]).

A regra é verificada, não confiada: o teste T9 varre `dist/index.html` depois do build,
recusa referência externa e exige o `<!doctype html>` na primeira linha
(`test/engine.test.ts:739-759`). Ver [[build-e-entregavel]].

## Consequências

**Boas**

- O jogo é distribuível por anexo de e-mail. 296.019 bytes hoje (a versão vanilla
  congelada em `legacy/isorogue-vanilla.html` tem 215.761).
- Zero superfície de supply chain: não há transitivo para auditar.
- Determinismo fica barato de defender — não há relógio de rede, não há fetch, não há
  ordem de carregamento assíncrono para embaralhar nada. Ver [[determinismo]].
- Offline por construção. Nada degrada quando a rede cai porque nada depende dela.

**Ruins**

- **Tudo é escrito à mão.** Matemática de matriz 3D, quantização de paleta, projeção
  isométrica, FOV, Dijkstra: 40 linhas aqui, 200 ali, sem `npm i`.
- Arte precisa nascer em runtime. Daí o atlas do personagem ser forjado no boot
  ([[ADR-006-atlas-forjado-em-runtime]]) em vez de vir pronto num PNG.
- **Ferramentas de apoio também não podem inventar dependência.** O caso concreto: o
  projeto está no Vite 8, que roda sobre Rolldown e **não expõe esbuild**. Não havia como
  transpilar `tools/preview-entry.ts` "na mão" para montar a bancada de revisão do
  personagem — a saída foi reusar o próprio Vite numa segunda config
  (`vite.preview.config.ts:8-13`), que produz `.preview/preview.html`, também single-file.
  Ver [[revisar-o-personagem]].
- O bundle cresce monoliticamente. Não há code splitting possível; ganho de tamanho só
  vem de escrever menos.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| CDN + import map (`https://esm.sh/react`) | Mata R56 na primeira linha e o jogo deixa de rodar offline. |
| Three.js para o personagem 3D | Sozinha, maior que o jogo inteiro. Ver [[ADR-004-personagem-por-codigo]]. |
| Sprite sheet em base64 embutido no HTML | Continua sendo "recurso externo" empacotado, infla o arquivo e congela a arte: não dá para mudar paleta ou proporção sem reexportar por fora. |
| State manager (Redux/Zustand) | Desnecessário — ver [[ADR-002-engine-puro-fora-do-react]]. |
| Build por concatenação de `.js` (o que a versão vanilla fazia) | Funcionava, mas sem tipos e sem HMR. Trocado na migração; o script antigo sobrevive só em `legacy/`. |

## O que quebra se mudar

Adicionar uma dependência de runtime não quebra o build — quebra o **teste T9** e a
premissa de todas as outras ADRs. Se algum dia R02 for relaxado, o primeiro efeito é que
[[ADR-004-personagem-por-codigo]] e [[ADR-006-atlas-forjado-em-runtime]] perdem a razão de
existir e devem ser reabertas, não remendadas.

Relacionadas: [[visao-geral]] · [[camadas-e-fronteiras]] · [[rodar-e-buildar]]
