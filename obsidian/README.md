---
tipo: indice
atualizado: 2026-07-28
tags: [cofre, obsidian, indice, isorogue]
---

# 📓 Cofre do ISOROGUE

Esta pasta é o **cofre Obsidian** do projeto ISOROGUE — um roguelike 3D isométrico por turnos,
entregue como um único arquivo HTML, em React 19 + TypeScript + Vite.

O cofre não duplica o repositório. O código está em `../src/`, os contratos congelados em
`../docs/` (`BRIEF.md` com os 58 requisitos, `CONTRACTS.md`, `ARQUITETURA-REACT.md`,
`PERSONAGEM.md`). Aqui ficam as **razões**: por que cada peça é assim, que alternativa foi
descartada e o que quebra quando alguém mexe.

## Como abrir

No Obsidian: *Abrir pasta como cofre* → selecione `isorogue/obsidian`. Não aponte para a raiz
do repositório — o cofre é só esta pasta.

Fora do Obsidian também se lê bem: é Markdown puro, sem plugin, sem template dinâmico. A única
sintaxe própria são os links por nome de arquivo entre colchetes duplos, como
[[visao-geral]] logo abaixo.

## Índice de primeiro nível

| Pasta | O que tem |
|---|---|
| [`00 - Indice/`](<00 - Indice>) | os três MOCs — é por aqui que se navega |
| [`01 - Arquitetura/`](<01 - Arquitetura>) | camadas, determinismo, build, o golden test |
| [`02 - ADRs/`](<02 - ADRs>) | seis decisões registradas, com contexto e preço |
| [`03 - Sistemas de Jogo/`](<03 - Sistemas de Jogo>) | masmorra, FOV, Dijkstra, inimigos, turnos, RNG |
| [`04 - Render e Arte/`](<04 - Render e Arte>) | projeção isométrica, rig 3D, sprite forge, paleta, névoa |
| [`05 - Runbooks/`](<05 - Runbooks>) | rodar, buildar, testar, revisar o personagem, fotografar headless |
| [`06 - Aprendizados/`](<06 - Aprendizados>) | cinco erros reais, com sintoma, causa e lição |
| [`07 - Changelog/`](<07 - Changelog>) | o histórico, por data |
| [`09 - Meta/`](<09 - Meta>) | as convenções deste cofre |

## Os três mapas

- [[_moc-arquitetura]] — estrutura, fronteiras, build e as decisões registradas.
- [[_moc-sistemas-de-jogo]] — tudo o que mora em `src/engine/`.
- [[_moc-render-e-arte]] — tudo o que vira pixel, do losango ao guerreiro.

## Atalhos

- [[estado-atual-e-proximos-passos]] — **ponto de retomada**: onde o projeto está, o que vem
  a seguir e as pendências conhecidas. Leia primeiro se voltou depois de um tempo.
- [[como-construir-um-personagem]] — o passo a passo para fazer um personagem novo.
- [[visao-geral]] — o jogo e suas quatro restrições, em uma página.
- [[rodar-e-buildar]] — do `npm ci` ao `dist/index.html`.
- [[golden-test]] — o teste que autoriza dizer que a migração não mudou o jogo.
- [[2026-07-28-nascimento-migracao-e-guerreiro]] — o que aconteceu, e o que ficou pendente.
- [[como-usar-este-cofre]] — por onde começar conforme o que você quer, e como escrever nota
  nova sem deixá-la órfã.
