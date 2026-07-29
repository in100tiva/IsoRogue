---
tipo: indice
atualizado: 2026-07-29
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
| Personagem do jogador | Guerreiro, 8 direções, animado |
| Bestiário | Goblin (Perseguidor), Slime (Vinculador), Ogro (Sentinela) |
| Testes | 73, com golden test de 12 sementes |
| Cofre | esta documentação |

Marcos, em ordem: nasceu em JavaScript vanilla → migrado para React 19 + TypeScript com
golden test provando fidelidade → Guerreiro → Goblin → Slime e Ogro.

## Comandos que importam

```bash
npm run dev                            # Vite
npm run check                          # fronteiras + typecheck (src e tools) + 73 testes
npm run build                          # gera dist/index.html
npm run preview:personagem -- elenco   # a folha dos 4 personagens (gates G9/G10)
```

`npm run check` verde é o gate de qualquer commit. Ver [[rodar-os-testes]].

## O próximo passo combinado

**Balanceamento de níveis e dificuldade.** É a fase em que os arquétipos podem ser revistos
de verdade — e a primeira desde a migração que provavelmente vai **regenerar o oracle de
propósito**, porque mexer em `populate()`, em pesos ou em atributos muda o que o golden test
congelou. Isso é legítimo desde que seja decisão explícita, nunca acidente.

Insumos já levantados para essa conversa:

- **O jogo é agressivo demais.** Num teste de 3.000 comandos aleatórios o jogador tomou 1.144
  de dano e causou 90. Numa partida real observada, morreu no turno 28 com 45 recebidos
  contra 24 causados. As constantes ficam no topo de `src/engine/game.ts`
  (`PLAYER_BASE 42/7/3`) e em `POTION_HEAL`.
- **A distribuição de monstros é desequilibrada.** Pesos 5/2/1 dão, no nível 1:
  Goblin 62% · Ogro 25% · Slime 13%. Medido em jogo: o Slime quase não aparece. O bicho de
  encaixe mais natural é o mais raro.
- **O encaixe do Ogro em Sentinela é forçado** (ataca a 6 tiles, mas é um brutamontes de
  marreta). Ver [[ADR-007-monstro-e-aparencia-nao-arquetipo]].

## Pendências conhecidas

| Pendência | Onde | Gravidade |
|---|---|---|
| Sprites invadem o tile vizinho (Ogro 20px, Guerreiro 17px) sem z-buffer | render | cosmética |
| Direção 4 (oeste) do Goblin mostra a arma mas não a mão — causa geométrica documentada | render | cosmética |
| Animações próprias do Goblin e do Slime escritas mas não plugadas (o forge é agnóstico de personagem) | render | funcional |
| `combatRng` tem fallback com semente `'#combate'` divergente do canônico `'#combat' + depth` | engine | latente |
| Não há CI: `npm run check` é manual | infra | processo |
| `check-boundaries` cobre `engine` e `render`, mas nada impede a UI de pôr o `Game` num `useState` | infra | latente |

## Por onde começar a ler

- Entender o jogo: [[visao-geral]]
- Mexer no engine: [[camadas-e-fronteiras]] e [[determinismo]] — leia **antes** de tocar
- Mexer na arte: [[como-construir-um-personagem]] — o passo a passo completo
- Não quebrar nada: [[golden-test]] — a regra é "se divergiu, o errado é o código"
