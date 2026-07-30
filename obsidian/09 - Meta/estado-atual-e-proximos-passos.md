---
tipo: indice
atualizado: 2026-07-30
tags: [estado, handoff, roadmap, meta]
---

# 📍 Onde o projeto está e o que vem a seguir

Ponto de retomada. Quem chegar aqui sem contexto nenhum lê esta página e sabe continuar.

## O que existe hoje

Roguelike 3D isométrico por turnos, jogável, entregue como **um único `dist/index.html`**
auto-contido (zero dependência em runtime, zero requisição de rede, salvamento em
localStorage). Repositório: <https://github.com/in100tiva/IsoRogue>.

| Camada | Estado |
|---|---|
| Engine (masmorra, FOV, Dijkstra, IA, turnos) | completo e determinístico |
| Casca React + TypeScript | completa |
| Personagem do jogador | Guerreiro, 8 direções, animado, com cinemáticas de intro (descida) e morte |
| Bestiário | Goblin (Perseguidor), Slime (Vinculador), Ogro (Brutamontes), **cada um com cinemática de abate e rastro persistente no tile** |
| Balanceamento | níveis de monstro (1/2/3), XP em escala (100×2^Δ), 100 XP plano por nível, spawn por nível do herói |
| Progressão visível | texto de XP flutuante 3D nos abates; HUD com Andar × Nível do herói × XP |
| Render | paredes do canto frontal ficam translúcidas para não esconder o herói |
| Despojos | fase 1: monstros largam itens, herói recolhe pisando, bolsa na barra lateral |
| Economia | fase 2: mercador compra/vende, bancada faz alquimia e refino, moedas e nível de arma |
| Testes | 114, todos verdes nesta máquina (`npm run check`), com oracle de regressão derivado do engine (o teste vanilla projetado foi aposentado — ver ADR-008) |
| Cofre | esta documentação |

Marcos, em ordem: nasceu em JavaScript vanilla → migrado para React 19 + TypeScript com
golden test provando fidelidade → Guerreiro → Goblin → Slime e Ogro → cinemáticas →
**balanceamento com regeneração deliberada do oracle** → XP visível.

## Comandos que importam

```bash
npm run dev                            # Vite
npm run check                          # fronteiras + typecheck (src e tools) + testes
npm run build                          # gera dist/index.html
npm run golden                         # regenera o oracle (SÓ de propósito, com o vanilla espelhado)
npm run preview:personagem -- elenco   # a folha dos 4 personagens + mortes + texto de XP
```

`npm run check` verde é o gate de qualquer commit. Ver [[rodar-os-testes]].

## O próximo passo combinado

**O que cada nível dá em status** — a conversa marcada pelo dono ("depois vamos abordar o
que cada nível vai dar em termos de status de dano e etc"). Hoje: +4 maxHp/+4 hp/+1 atk
por nível, intocado desde o vanilla. A escala de XP e a mistura de spawn JÁ são do nível
do herói ([[niveis-xp-e-spawn]]), então esta conversa decide a outra metada da progressão.

Insumos já levantados para essa conversa:

- **O jogo é agressivo demais.** Num teste de 3.000 comandos aleatórios o jogador tomou 1.144
  de dano e causou 90. Numa partida real observada, morreu no turno 28 com 45 recebidos
  contra 24 causados. As constantes ficam no topo de `src/engine/game.ts`
  (`PLAYER_BASE 42/7/3`) e em `POTION_HEAL`. Qualquer um deles regenera o oracle de novo —
  decisão explícita, nunca acidente (o rito já foi feito duas vezes e está em
  [[niveis-xp-e-spawn]]).

**Resolvido em 2026-07-30:** as três fases do dia — cinemáticas de abate com rastro
(corpo do goblin, marreta do ogro, geleia do slime), balanceamento por nível do herói e
XP visível (texto flutuante + HUD). Detalhes em
[[2026-07-30-abates-balanceamento-e-xp-visivel]].

**Resolvido em 2026-07-29:** o `sentinel` deixou de ser a Sentinela atiradora (alcance 6,
recuo tático) e virou o **Brutamontes** corpo a corpo — alcance 1, ideal 1, `aiSentinel`
reescrita no molde de `aiChaser`; o encaixe forçado do Ogro acabou. E a distribuição de
spawn passou de 5/2/1 para **10/1/100** ("a cada 10 slimes 1 goblin, a cada 10 goblins 1
ogro"): o Slime agora responde por ~90% dos encontros no nível 1, com o reforço por
profundidade mantido. O vanilla legacy recebeu as mesmas edições e o oracle foi
**regenerado deliberadamente** — vanilla espelhado → `node tools/gen-golden.mjs` → 73/73
verde. Detalhes em [[2026-07-29-brutamontes-e-a-masmorra-de-slimes]].

**Também em 2026-07-29 (fase de render/UI, sem tocar o engine):** o guerreiro ganhou
**cinemáticas** — intro de descida (~1,3 s: glifo de escada como prop + sprite entrando
de cima em marcha) na run nova e a cada descida, e sequência de morte (~3,4 s: poça de
sangue, espada solta girando, joelhos, queda, fade para preto) antes do resumo abrir.
Poses `POSE_AJOELHADA`/`POSE_CAIDA` forjadas como **repouso** em atlases secundários
(coluna `parado/0`), gate do modal via micro-store `src/ui/cinematics.ts`, trava de
input no teclado e no ponteiro, `prefers-reduced-motion` respeitado. Detalhes em
[[2026-07-29-cinematicas-do-guerreiro]].

## Pendências conhecidas

| Pendência | Onde | Gravidade |
|---|---|---|
| Sprites invadem o tile vizinho (Ogro 20px, Guerreiro 17px) sem z-buffer | render | cosmética |
| Direção 4 (oeste) do Goblin mostra a arma mas não a mão — causa geométrica documentada | render | cosmética |
| Animações próprias do Goblin e do Slime escritas mas não plugadas (o forge é agnóstico de personagem) | render | funcional |
| `combatRng` tem fallback com semente `'#combate'` divergente do canônico `'#combat' + depth` | engine | latente |
| Não há CI: `npm run check` é manual | infra | processo |
| `check-boundaries` cobre `engine` e `render`, mas nada impede a UI de pôr o `Game` num `useState` | infra | latente |
| Testes T9 falham no Windows (`find`/`npx` ausentes no spawn do teste) | infra | ambiente |

## Por onde começar a ler

- Entender o jogo: [[visao-geral]]
- Mexer no engine: [[camadas-e-fronteiras]] e [[determinismo]] — leia **antes** de tocar
- Mexer na arte: [[como-construir-um-personagem]] — o passo a passo completo
- Não quebrar nada: [[golden-test]] — a regra é "se divergiu, o errado é o código"
