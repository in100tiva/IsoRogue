---
tipo: changelog
atualizado: 2026-07-30
tags: [changelog, morte, atlas, correcao, render]
---

# 📆 30/07/2026 — A espada dupla: correção da janela do meio

Correção de defeito visual reportado pelo dono na cinemática de morte do Guerreiro:
**duas espadas na tela ao mesmo tempo** — a que cai e a que continuava modelada na mão.

---

## O que mudou

O corpo do Guerreiro passa a usar um atlas **em pé SEM a espada** a partir do instante em
que a espada solta começa a cair (`MORTE_ESPADA_INICIO`, 0,15 s), em vez de continuar no
atlas normal até a troca para o ajoelhado (0,9 s). A janela de arma dupla era de **0,75 s**.

O mesmo defeito, mais curto, existia nos monstros do abate cinematográfico e foi curado
junto:

| Personagem | Arma se solta | Trocava sem arma em | Janela dupla (antes) |
|---|---|---|---|
| Guerreiro | 0,15 s | 0,90 s (ajoelhado) | 0,75 s |
| Goblin | 0,10 s | 0,30 s (agachado) | 0,20 s |
| Ogro | 0,20 s | 0,45 s (agachado) | 0,25 s |

Agora, nos três, a troca de rig acontece **no mesmo instante** em que o prop nasce.

## Como foi feito

- `FORJA_MORTE_PARADO` (`IsoRenderer.ts`): o repouso normal (`FORJA_GUERREIRO` já carrega
  `POSE_PARADA`) forjado sobre `MODELO_GUERREIRO_SEM_ESPADA` — o rig sem espada que os
  atlas de ajoelhado e caído já usavam. Nenhuma pose nova; nenhum modelo novo.
- `atlasDeMorte('parado')` e `atlasMorteDe(kind, 'parado')` — memoizados sob demanda no
  padrão de sempre (`undefined` = nunca tentado, `null` = sem canvas). Só forjam quando
  alguém morre.
- Escolha do corpo por fase ganhou um degrau em `desenharMorte`, `desenharMorteGoblin` e
  `desenharMorteOgro`. O Slime não tem arma e não muda.
- Bancada: `MORTE_PREVIEW` (`tools/preview-entry.ts`) ganhou a fileira **"em pé, JÁ SEM a
  arma"** para os três personagens armados — o quadro do meio, que antes não era revisável,
  agora aparece na folha. `docs/ref/preview-atlas.png` regenerado e conferido.

Nada de engine: tudo cosmético, dentro do relógio da cinemática (R54). Oracle intacto.

## Verificação

- Bancada do guerreiro: a fileira nova mostra o boneco em pé, com escudo, **sem espada** —
  o rig poda o nó certo e a pose lê bem sem a arma.
- `npm run check` verde: fronteiras + typecheck (src e tools) + **77/77**.

## O que ficou registrado

O aprendizado [[arma-que-cai-e-continua-na-mao]]: quando um objeto sai de um personagem, o
instante em que ele passa a existir sozinho é o mesmo em que tem de sumir do rig — e uma
folha de revisão que só congela as poses **finais** não prova a sequência.

---

Vizinhos: [[2026-07-29-cinematicas-do-guerreiro]] ·
[[2026-07-30-abates-balanceamento-e-xp-visivel]] · [[arma-que-cai-e-continua-na-mao]]
