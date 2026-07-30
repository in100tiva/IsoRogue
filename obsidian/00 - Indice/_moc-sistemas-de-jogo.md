---
tipo: indice
atualizado: 2026-07-30
tags: [indice, engine, jogo, moc]
---

# 🎲 MOC — Sistemas de jogo

Tudo o que mora em `src/engine/` — a lógica pura, sem React, sem Canvas, sem relógio. Cada
nota daqui termina com uma seção "o que quebra se mudar", porque estes módulos são acoplados
por número, não por interface: um limiar alterado aqui reprova o golden lá.

## O mundo, antes do primeiro turno

- [[semente-e-rng]] — de `'k7qx-3m9p'` até o mundo: normalização, FNV-1a, mulberry32 e os
  streams derivados por `fork`. Comece por aqui: é o módulo do qual todos os outros dependem
  para serem reprodutíveis.
- [[geracao-de-masmorra-bsp]] — a árvore BSP, os cinco formatos de sala, os corredores entre
  folhas irmãs e por que **100% de conectividade** é requisito e não meta. Explica também por
  que o centro da sala é forçado a piso no fim do recorte.

## O que o jogador enxerga e o que os inimigos sabem

- [[campo-de-visao-shadowcasting]] — shadowcasting recursivo por quadrantes com slopes
  racionais. Traz o argumento que proibiu raycasting por amostragem: assimetria não é
  artefato gráfico, é regra de jogo injusta — o inimigo atira de onde você não o vê.
- [[dijkstra-e-comportamento]] — **um** campo escalar por turno, recalculado do jogador, lido
  por todos os inimigos. Custo, determinismo e comportamento emergente saem da mesma decisão;
  A* individual é proibido pelo contrato.

## Quem se move e como

- [[despojos-e-bolsa]] — o que cai quando o monstro morre, com que chance, em que tile, e
  onde fica guardado. O stream próprio de RNG que impede a sorte do despojo de mexer no
  dano do turno seguinte, e a bolsa que atravessa a descida.
- [[arquetipos-de-inimigo]] — Perseguidor, Brutamontes e Vinculador numa tabela, sem herança.
  Tem a resolução determinística de conflito de movimento e o spawn proporcional à área por
  *largest remainder*.
- [[turnos-e-progressao]] — o que consome turno (e o que só escreve no registro sem
  consumir), a ordem rígida do `endTurn`, morte permanente, descida de nível e o formato do
  `snapshot()`.
- [[niveis-xp-e-spawn]] — os níveis dos monstros (Slime 1, Goblin 2, Ogro 3), o XP em
  escala (100 × 2^Δ, cortado a zero), os 100 XP planos por nível com excedente carregado e
  a mistura de spawn dirigida pelo nível do herói. **Mexeu? Regenera o oracle** — o rito
  está documentado aqui.

## Transversais

- [[determinismo]] — a promessa que atravessa todos os módulos acima e o que é proibido para
  mantê-la de pé.
- [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] — `player.facing` vive no engine mas
  nenhuma regra de jogo o lê. O padrão para adicionar estado cosmético sem quebrar o oracle.
- [[golden-test]] — a rede de segurança de tudo o que está nesta pasta. Mexeu num número
  daqui? É ele que vai reprovar, apontando comando e snapshot.

## Onde isso vira imagem

O engine só produz estado; quem transforma em pixel está em [[_moc-render-e-arte]] — em
particular [[fog-of-war-e-iluminacao]], que consome `visible` e `explored` produzidos aqui, e
[[projecao-isometrica]], que consome as posições.

---

Vizinhos: [[_moc-arquitetura]] · [[_moc-render-e-arte]] · [[rodar-os-testes]]
