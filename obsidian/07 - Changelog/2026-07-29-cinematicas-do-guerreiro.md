---
tipo: changelog
atualizado: 2026-07-29
tags: [changelog, cinematicas, guerreiro, render, ui]
---

# 📆 29/07/2026 — Cinemáticas do guerreiro (intro e morte)

Segunda fase do dia, e a primeira de CINEMÁTICA do projeto: o guerreiro agora **desce
as escadas** ao entrar num andar e **morre em cena** — poça de sangue, espada solta,
joelhos, queda e fade para preto — antes do resumo da expedição abrir. Tudo cosmético,
observado por `dt`, fora de `snapshot()` e do oracle: **nem uma linha de engine** (R54).

---

## O que mudou

**Intro: descendo as escadas (~1,3 s).** Dispara quando a masmorra começa (run nova,
`game.turn === 0`) e a cada **descida** de nível (`game.depth` maior que a última
observada pelo renderer — rastreada em campo próprio). A retomada de save (primeira
observação do mapa com `turn > 0`) **não** toca: a escada não aconteceu na tela. O
jogador nasce em `map.start`, que não é escada — durante a intro o glifo de
`drawStairs` é desenhado no tile dele como **prop**, esmaecendo nos últimos ~0,3 s,
enquanto o sprite entra de ~48px·zoom acima da âncora em ciclo de marcha (ease-out
simples) e fecha em `parado`. Input bloqueado enquanto dura.

**Morte (~3,4 s).** Dispara na borda de subida de `game.over`, detectada em
`IsoRenderer.update`. A sequência, ancorada no tile (sem o deslize do passo):

1. **Sangue** (0,0→0,9 s): elipse vermelho-escura (`#6e1414`/`#4a0d0d`) no plano do
   piso, raio 0→26px·zoom, desenhada **antes** do sprite (decalque de chão), com 8
   respingos de um **LCG próprio semeado por (x, y)** — determinísticos, e sem
   `Math.random` (o render é proibido de tê-lo). Persiste até o fim.
2. **Espada** (0,15→0,9 s): mini-rig próprio (`criarModeloEspada`, as mesmas caixas de
   `criarEspada` em pé a partir da origem) sai da altura da mão e cai ao lado
   (+14px, +6px de tela), girando 0→~75° com `ctx.rotate` e suavização desligada — o
   giro pixelado é desejado. Ao pousar, decalque estático.
3. **Joelhos** (~0,9 s): troca dura para o atlas **AJOELHADO** (sem espada).
4. **Caído** (~1,7 s): troca dura para o atlas **CAÍDO** (sem espada, deitado).
5. **Fade** (2,2→3,4 s): `fillRect` preto, alpha 0→0,9, última operação do `draw()`.
   Ao completar: fase `'concluida'`, e o véu fica fechado sob o modal.

Durante a sequência a barra de vida do jogador não desenha; os inimigos seguem seu
idle normal (`game.over` já trava os comandos no engine).

**Gate do modal e trava de input.** Novo `src/ui/cinematics.ts`: micro-store no padrão
de `engine/store.ts` (`subscribe`/`getSnapshot`), alimentada uma vez por quadro pelo
laço de rAF de `GameCanvas.tsx` (`sincronizar(renderer.faseCinematica())`) e emitindo
**só quando a fase muda**. O `DeathOverlay` agora abre com
`hidden={!over || fase !== 'concluida'}` — o resumo só aparece depois do fade
completo. `inputBloqueado()` (true em `'intro'` e `'morte'`) dá early-return no topo de
`handleKey` (`useKeyboard.ts`) e de `onMouseDown` (`usePointer.ts`). Nem o store nem o
engine foram tocados.

**Reduced motion.** Se `matchMedia('(prefers-reduced-motion: reduce)')` casa no
instante do gatilho (guardado por `typeof`, jsdom-safe), a cinemática pula ao estado
final: intro some; morte fecha caído + fade instantâneo → `'concluida'`. O mesmo
caminho do `pularCinematica()` público, usado pelos testes.

## Como foi feito — a arquitetura

- **Poses via repouso do forge, não animação.** `POSE_AJOELHADA` e `POSE_CAIDA` vivem
  em `src/render/characters/warrior.ts` e são passadas como `opts.repouso` a atlases
  secundários (`FORJA_MORTE_AJOELHADO`/`FORJA_MORTE_CAIDO`/`FORJA_ESPADA`, spreads de
  `FORJA_GUERREIRO` — a chave de cache do forge já inclui o repouso). O renderer lê
  sempre a coluna `('parado', 0)` — que `poseDoQuadro` devolve como o repouso EXATO —
  na direção `normalizeFacing(p.facing)`. Sinais na convenção de `POSE_PARADA`: o
  `ESPELHO` do forge multiplica só os deltas da animação genérica, nunca o repouso
  (`clonarPose` copia verbatim). A pose caída é um giro de +85° na `raiz`: o corpo
  tomba na direção do olhar e se estende da âncora — o cadáver no tile.
- **Modelos novos sem duplicar rig.** `criarModeloGuerreiroSemEspada()` poda o filho
  `espada` de `bracoDir` de uma árvore NOVA (campos readonly → os nós do caminho são
  reconstruídos); `criarModeloEspada()` reusa `caixasDaEspada()`, extraída de
  `criarEspada` — uma fonte só para a espada na mão e a espada solta.
- **A máquina vive no renderer**, no padrão `anim`/`vfx`: campos `cin` (fase +
  relógio de `dt`), gatilhos em `syncRun` (intro) e na borda de `game.over` (morte),
  avanço em `update`, leitura em `draw`/`drawPlayer`. Getters públicos
  `faseCinematica()` e `pularCinematica()`. Em jsdom (sem canvas) os atlases faltam e
  os sprites simplesmente não desenham — relógio, fases, sangue-via-primitivas e fade
  seguem funcionando, que é o que o gate do overlay consome.
- **Bancada:** a folha do guerreiro ganhou a fileira "cinemática de morte — poses
  ajoelhada e caída (dir 2)", presente só quando o módulo exporta as peças. Para ela
  existir, `resolverRig` aprendeu a preferir nomes canônicos (`nomes.modelo`): com
  TRÊS rigs exportados pelo warrior, a busca por forma pegava `MODELO_ESPADA` primeiro
  (ordem alfabética dos exports) e a folha inteira saía forjada da espada — pego na
  revisão do PNG.

## O que NÃO mudou

- **`src/engine/` byte a byte** — sem campo novo, sem canal novo, oracle intacto.
- A máquina de animação de §6 (parado/andando/atacando) e o atlas principal do
  guerreiro: as cinemáticas são caminhos à parte em `drawPlayer`.
- Os 73 testes, com o de UI ajustado ao comportamento pretendido: o teste do overlay
  agora **dirige a cinemática** (um quadro para a borda de `over`, `pularCinematica()`,
  um quadro para a república da fase) em vez de esperar os 3,4 s — nenhuma assertiva
  afrouxada.

## Verificação

- `npm run check` verde: fronteiras, typecheck (src e tools), 73/73.
- `docs/ref/preview-atlas.png` revisado em duas rodadas: a primeira expôs o bug do
  `resolverRig` (folha forjada da espada); a segunda confirmou guerreiro correto e as
  duas poses legíveis — ajoelhada (joelho no chão, tronco à frente, cabeça caída) e
  caída (corpo deitado a partir da âncora, elmo tombado de lado).

---

Ver [[personagem-rig-3d]], [[sprite-forge]], [[2026-07-28-nascimento-migracao-e-guerreiro]]
e [[estado-atual-e-proximos-passos]].
