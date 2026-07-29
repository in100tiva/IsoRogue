---
tipo: indice
atualizado: 2026-07-28
tags: [indice, arquitetura, adr, moc]
---

# 🏗️ MOC — Arquitetura

Como o ISOROGUE está montado, por que foi montado assim e o que reprova o build quando
alguém desmonta. Se você chegou agora, leia na ordem desta primeira seção.

## Comece por aqui

- [[visao-geral]] — o jogo em uma página e as **quatro restrições** que decidem a forma de
  todo módulo: arquivo único, zero dependência de conteúdo, zero rede, determinismo. Tem a
  tabela de números de referência (grid 45×45, FOV 9, 296.019 bytes de entregável).
- [[camadas-e-fronteiras]] — as três camadas (`engine` → `render` → `ui`), a dependência de
  mão única e o script de 84 linhas que falha o build quando alguém atravessa. Leia antes de
  abrir qualquer arquivo de `src/`.
- [[determinismo]] — o pilar. Mesma semente + mesmos comandos ⇒ mesmo resultado. Explica por
  que `Math.random`, `Date.now` e `performance.now` são proibidos no engine — e o que morre
  junto se a regra cair.

## O que prova que está certo

- [[golden-test]] — a versão vanilla congelada em `legacy/` compara-se com a nova, comando a
  comando: 12 sementes × 200 comandos × 2 passadas, 1,4 MB de snapshot. É este teste que
  autoriza dizer que a migração não mudou o jogo.
- [[golden-test-precisa-ser-testado]] — e por que ele só passou a valer alguma coisa no dia
  em que foi **feito reprovar de propósito**, mutando `WOUNDED_RATIO` de 0.3 para 0.31.
- [[rodar-os-testes]] — `npm run check`, o que cada etapa pega, e como ler uma falha do
  golden sem sair consertando a coisa errada.

## Do fonte ao arquivo que se joga

- [[build-e-entregavel]] — a cadeia Vite + `vite-plugin-singlefile` até `dist/index.html`,
  a configuração que impede qualquer asset de escapar, e o censo de tokens de rede que o
  teste faz no bundle já buildado.
- [[rodar-e-buildar]] — os comandos, na ordem, com a saída esperada de cada um.

## As decisões registradas

Um ADR aqui não descreve o código: descreve a alternativa que foi descartada e o preço que
se paga por isso.

- [[ADR-001-arquivo-unico-sem-dependencias]] — a restrição-mãe. Tudo é escrito à mão porque
  não há `npm i`; a arte tem de nascer em runtime porque não há PNG para carregar.
- [[ADR-002-engine-puro-fora-do-react]] — por que o `Game` mutável nunca entra em `useState`,
  como o React o observa por assinatura de versão, e a armadilha do seletor que derruba a
  aplicação em loop de render.
- [[ADR-003-golden-test-como-oracle-da-migracao]] — congelar o vanilla em vez de apagá-lo.
  `legacy/` não é código morto: é a régua.
- [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] — o precedente que permite adicionar
  feature cosmética ao engine sem invalidar o oracle. Leia antes de propor o próximo campo
  novo no `Player`.

Os ADRs de arte — [[ADR-004-personagem-por-codigo]] e [[ADR-006-atlas-forjado-em-runtime]] —
estão indexados em [[_moc-render-e-arte]], mas são consequência direta do ADR-001.

## Histórico

- [[2026-07-28-nascimento-migracao-e-guerreiro]] — o dia inteiro em três atos: nasceu em
  vanilla, migrou para React 19 + TypeScript, ganhou o guerreiro. Termina com a lista honesta
  do que ficou pendente.

---

Vizinhos: [[_moc-sistemas-de-jogo]] · [[_moc-render-e-arte]] · [[como-usar-este-cofre]]
