# ISOROGUE — Arquitetura React + TypeScript (fonte da verdade da migração)

> Migração da versão vanilla (`legacy/isorogue-vanilla.html`) para React 19 + TypeScript + Vite.
> **Esta fase é migração pura: ZERO features novas, ZERO mudanças de balanceamento,
> ZERO "melhorias" de comportamento.** O jogo resultante deve ser indistinguível do atual —
> e isso é provado por teste, não por opinião (§7).
> Este documento é o CONTRATO. Não o altere.

O `docs/CONTRACTS.md` continua valendo para **regras de domínio** (algoritmos, formatos,
arquétipos, determinismo). Onde este documento e o CONTRACTS.md divergirem em matéria de
*estrutura de código*, este manda; em matéria de *comportamento de jogo*, o CONTRACTS.md manda.

---

## 0. A regra que sustenta tudo

**O engine não conhece React, não conhece DOM, não conhece Canvas.**

```
src/engine/**   →  pode importar apenas de src/engine/**. Nada de react, nada de document,
                   nada de window (exceto crypto em newSeedString, via wrapper injetável).
src/render/**   →  pode importar de src/engine/** (tipos e leitura). Fala com Canvas 2D
                   imperativamente. NÃO importa react.
src/ui/**       →  pode importar de tudo. É a única camada com JSX.
```

Um `import` de `react` dentro de `src/engine/` é falha de build (regra de lint, §8).
Motivo: o determinismo, os 11 testes e a possibilidade de rodar o jogo headless dependem de
o núcleo ser puro. React entra pela casca, jamais pelo miolo.

**Corolário que não pode ser violado:** o estado do jogo (`Game`) é um objeto **mutável**,
grande (`Uint8Array`, `Int32Array`, `Set<number>`) e de vida longa. Ele **nunca** entra em
`useState`, nunca é clonado por spread, nunca é congelado. React observa esse estado por
assinatura de versão (§4), não por posse.

---

## 1. Estrutura de arquivos

```
isorogue/
  package.json
  tsconfig.json
  vite.config.ts
  index.html                    entrada do Vite (não é mais o entregável gerado)
  dist/index.html               ENTREGÁVEL: single-file auto-contido (vite-plugin-singlefile)
  src/
    main.tsx                    createRoot + <App/>
    engine/
      types.ts                  todos os tipos e enums do domínio
      core.ts                   R.C -> CONFIG, hash32, makeRng, dirs, helpers
      rng.ts                    Rng (classe/factory) — mulberry32
      mapgen.ts                 generate(seed, depth) -> GameMap
      fov.ts                    computeFov, isVisibleFrom, checkSymmetry
      dijkstra.ts               computeDijkstra, fleeMap, bestStep
      entities.ts               ARCHETYPES, populate, rollDamage, processEnemies
      game.ts                   createState, applyCommand, endTurn, snapshot, descend, restore
      save.ts                   read/write/clear/history (localStorage injetável)
      store.ts                  GameStore — a ponte com React (§4)
    render/
      IsoRenderer.ts            classe: init(canvas), resize(), update(dt), draw(game)
      palette.ts                cores e constantes visuais (§12 do CONTRACTS.md)
    ui/
      App.tsx
      GameCanvas.tsx
      Sidebar.tsx
      panels/  Header.tsx Vitals.tsx SeedPanel.tsx MapStats.tsx LogPanel.tsx HelpPanel.tsx
      overlays/ DeathOverlay.tsx Tooltip.tsx DebugPanel.tsx
      hooks/   useGameStore.ts useKeyboard.ts usePointer.ts useFps.ts
    styles/
      global.css  ui.css        (CSS puro com variáveis; sem framework)
  test/
    golden/snapshots.json       ORACLE gerado da versão vanilla (§7)
    golden.test.ts              paridade engine novo × vanilla
    engine.test.ts              T1..T10 portados
    ui.test.tsx                 smoke dos componentes (Testing Library)
  tools/
    gen-golden.mjs              gera test/golden/snapshots.json a partir do legacy
  legacy/                       versão vanilla congelada — NÃO EDITAR, é o oracle
```

`src/00-core.js` … `src/70-game.js`, `src/shell.html`, `src/ui.css`, `tools/build.mjs`,
`tools/harness.mjs` e o `index.html` gerado **são removidos ao final da migração** — o
equivalente deles vive em `legacy/`. Só remova depois que o golden passar.

---

## 2. Stack e versões

- **React 19** (`react`, `react-dom`) — `createRoot`, sem `StrictMode` duplicando efeitos em
  produção; **com** `StrictMode` em dev (o loop de rAF precisa ser resiliente a montagem dupla —
  isso é requisito, não acidente: escreva o cleanup correto).
- **TypeScript 5.x** — `strict: true`, `noUncheckedIndexedAccess: false` (arrays tipados
  ficariam insuportáveis), `noImplicitAny: true`, `exactOptionalPropertyTypes: false`.
- **Vite** (última estável) + `@vitejs/plugin-react`.
- **vite-plugin-singlefile** — preserva o entregável de arquivo único.
- **Vitest** + `@testing-library/react` + `jsdom` para os testes de UI.
- Nada além disso. Sem UI kit, sem state manager, sem lodash, sem imutabilidade estrutural.
  Se sentir falta de uma lib, a resposta é não.

`npm run dev` (Vite), `npm run build` (gera `dist/index.html` single-file),
`npm run test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint`.

---

## 3. Tipos do domínio (`src/engine/types.ts`)

Portados 1:1 do CONTRACTS.md. Assinaturas obrigatórias:

```ts
export const enum Tile { Wall = 0, Floor = 1, Door = 2, Stairs = 3 }

export type ArchetypeKey = 'chaser' | 'sentinel' | 'linker';
export type EnemyState = 'idle' | 'hunt' | 'flee' | 'attack' | 'wait';
export type LogClass = 'info' | 'bom' | 'ruim' | 'aviso' | 'sistema';

export interface Room { id: number; x: number; y: number; w: number; h: number;
  cx: number; cy: number; area: number; shape: RoomShape }
export type RoomShape = 'rect' | 'cross' | 'round' | 'pillared' | 'notched';

export interface GameMap {
  seed: string; depth: number; w: number; h: number;
  tiles: Uint8Array; decor: Uint8Array; rooms: Room[];
  start: Point; stairs: Point;
  connectivity: number; walkable: number;
  regenerations: number; repairs: number; notes: string[];
}

export interface Enemy { id: number; kind: ArchetypeKey; x: number; y: number;
  hp: number; maxHp: number; atk: number; range: number;
  state: EnemyState; plan: string; lastDmg: number; bump: number }

export interface Item { id: number; kind: 'potion'; x: number; y: number; heal: number }

export interface Player { x: number; y: number; hp: number; maxHp: number;
  atk: number; potions: number; level: number; xp: number }

export interface Stats { turns: number; kills: number; dmgDealt: number; dmgTaken: number;
  itemsUsed: number; deepest: number; explorePct: number }

export interface LogEntry { turn: number; text: string; cls: LogClass }

export interface Game {
  seedStr: string; depth: number; turn: number; over: boolean; cause: string;
  map: GameMap; player: Player; enemies: Enemy[]; items: Item[];
  dmap: Int32Array; fleeMap: Int32Array | null;
  visible: Set<number>; explored: Uint8Array;
  rngCombat: Rng; log: LogEntry[]; stats: Stats;
  ui: { hover: Point | null; debug: boolean; fovProbe: boolean; follow: boolean };
}

export type Command =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'wait' } | { kind: 'use' } | { kind: 'descend' };
```

**Mudança deliberada e única em relação ao vanilla:** `Command` deixa de ser a string
`'move:1,-1'` e vira união discriminada. `parseCommand(s: string): Command | null` continua
existindo para o golden test conseguir replicar as sequências gravadas. O comportamento
resultante é idêntico — só a representação muda.

Nenhum outro contrato de dado pode mudar. Em especial: nomes de campos, ordem de `DIRS8`,
fórmulas, textos de log em pt-BR e o formato de `snapshot()` ficam **byte a byte iguais**.

---

## 4. A ponte com React (`src/engine/store.ts`)

O único ponto onde os dois mundos se tocam. Implementação obrigatória:

```ts
export class GameStore {
  private game: Game | null = null;
  private version = 0;                       // incrementa a CADA mutação observável
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => { ... };
  getVersion = (): number => this.version;   // snapshot estável para useSyncExternalStore
  getGame = (): Game => { ... };             // acesso direto, sem cópia
  private emit(): void { this.version++; this.listeners.forEach(l => l()); }

  newRun(seed: string): void
  dispatch(cmd: Command): boolean            // applyCommand + endTurn + emit
  descend(): void
  setHover(p: Point | null): void            // emite só se mudou de tile
  toggleDebug(): void; toggleFovProbe(): void; toggleFollow(): void
  restoreOrNew(): void
}
export const store = new GameStore();
```

Hooks (`src/ui/hooks/useGameStore.ts`):

```ts
export function useGameVersion(): number
export function useGameValue<T>(select: (g: Game) => T): T
```

`useGameValue` é `useSyncExternalStore(store.subscribe, () => select(store.getGame()))`.
**Regra dura:** o seletor DEVE devolver primitivo (number/string/boolean) ou uma referência
estável que só muda quando o dado muda. Devolver `{hp, maxHp}` cria objeto novo a cada
chamada e derruba a aplicação em loop infinito de render. Para ler várias coisas, use vários
`useGameValue`, ou `useGameVersion()` + leitura direta de `store.getGame()` no corpo do
componente (aceitável: a versão já garante a re-renderização).

Componente que só desenha (o canvas) **não usa hook nenhum** — lê `store.getGame()` dentro
do rAF.

---

## 5. Canvas fora do React (`src/ui/GameCanvas.tsx`)

```tsx
export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const renderer = new IsoRenderer(cv);
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const g = store.getGame();
      renderer.update(g, dt);     // SÓ animação (R54)
      renderer.draw(g);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(cv.parentElement!);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); };
  }, []);
  return <canvas ref={ref} className="game-canvas" />;
}
```

- O array de dependências é `[]` **de propósito**: o loop nunca deve reiniciar por re-render.
- `StrictMode` monta/desmonta duas vezes em dev: o cleanup acima tem de ser exato, senão
  ficam dois loops de rAF desenhando (sintoma: FPS dobrado, animação com o dobro da velocidade).
  Isso é testável e será testado.
- `performance.now()` aqui é legítimo: alimenta só animação. Nunca chegue com ele ao engine.
- `ResizeObserver` substitui o listener de `resize` do vanilla; respeite `devicePixelRatio`.

---

## 6. Componentes e paridade de UI

A UI React deve reproduzir **exatamente** a interface atual: mesmos painéis, mesma ordem,
mesmos textos em pt-BR, mesma paleta, mesmo comportamento responsivo (< 900px vira faixa
inferior). Use `legacy/isorogue-vanilla.html` e `legacy/src-vanilla/ui.css` como referência
visual — copie o CSS e adapte só o necessário para CSS Modules ou classes globais.

Mapa de origem → destino:

| Vanilla | React |
|---|---|
| `#hud-*`, cabeçalho | `Header.tsx`, `Vitals.tsx` |
| `#seed` + 3 botões | `SeedPanel.tsx` (input controlado; `Copiar` com `navigator.clipboard` + fallback, sempre com `.catch`) |
| `#map-*` | `MapStats.tsx` |
| `#log` | `LogPanel.tsx` — `<ul>` com auto-scroll via `useLayoutEffect`; renderiza no máximo os últimos 200; `key` = índice absoluto da entrada, nunca o índice do slice |
| ajuda | `HelpPanel.tsx` |
| `#tooltip` | `Tooltip.tsx` — posicionado por estado do ponteiro, `pointer-events: none` |
| `#morte` | `DeathOverlay.tsx` — os 9 campos do R48 |
| `#debug` | `DebugPanel.tsx` — os 8 campos do R51 |

Teclado em `useKeyboard.ts`: mesmo mapa de teclas do §10 do CONTRACTS.md, incluindo
**Shift+D** para debug, `preventDefault` em setas/espaço, e ignorar quando o foco está num
`input`. O hook registra em `window` e limpa no unmount.

---

## 7. Prova de que a migração não quebrou nada (obrigatório)

### 7.1 Oracle (`tools/gen-golden.mjs`)

Roda `legacy/isorogue-vanilla.html` em `node:vm` (reaproveite o sandbox de
`legacy/harness-vanilla.mjs`) e grava `test/golden/snapshots.json`:

```jsonc
{
  "geradoEm": "<ISO>", "fonte": "legacy/isorogue-vanilla.html",
  "casos": [
    { "seed": "GOLD-0001", "depth": 1,
      "mapa": { "tilesHash": "...", "decorHash": "...", "start": {...}, "stairs": {...},
                "rooms": 21, "connectivity": 1, "walkable": 868 },
      "populacao": [ { "id":1,"kind":"chaser","x":..,"y":..,"hp":.. }, ... ],
      "comandos": ["move:1,0", "wait", ...],           // 200 comandos determinísticos
      "snapshots": { "10": "<snapshot()>", "20": "...", ... },  // a cada 10 turnos
      "final": { "snapshot": "...", "log": ["..."], "stats": {...}, "over": false } }
  ]
}
```

12 sementes fixas (`GOLD-0001`..`GOLD-0012`), profundidades 1..3, 200 comandos cada,
gerados por LCG do próprio script (semente 20260728) para serem reprodutíveis.

### 7.2 Teste de paridade (`test/golden.test.ts`)

Para cada caso: roda o **engine novo** com a mesma seed e a mesma sequência e compara
`snapshot()` a cada marco, o log completo, as stats finais e os hashes de mapa.
Divergência = falha, com diff legível apontando o primeiro turno que divergiu.

Este é o teste mais importante do projeto nesta fase. Se ele passar, a migração é fiel por
construção. Se algum caso for genuinamente impossível de reproduzir, **pare e reporte** —
não ajuste o golden para acomodar o código novo.

### 7.3 Testes portados (`test/engine.test.ts`)

T1..T10 do `legacy/harness-vanilla.mjs`, agora importando o engine direto (sem `vm`, sem
stubs de DOM — muito mais rápido e claro). Mesmos números: 60 sementes de conectividade,
40×25 de simetria de FOV, 400 comandos de determinismo, 300 de invariantes.
T9 (construções proibidas) passa a varrer `dist/index.html` após o build.

### 7.4 Smoke de UI (`test/ui.test.tsx`)

Renderiza `<App/>` em jsdom: painéis presentes, campo de semente aceita digitação, botão
Gerar dispara nova run, log recebe entradas, overlay de morte aparece com `over: true`.
Canvas em jsdom não tem contexto 2D: `IsoRenderer` deve degradar sem lançar quando
`getContext('2d')` devolver `null` (defensivo, não gambiarra).

---

## 8. Regras de qualidade verificáveis

1. `npm run typecheck` limpo. Zero `any` explícito no engine; `unknown` + narrowing quando
   preciso. `@ts-ignore` proibido; `@ts-expect-error` só com comentário justificando.
2. Nenhum arquivo de `src/engine/**` pode conter `react`, `document`, `window.` ou `Math.random`.
   Adicione ao `npm run lint` uma checagem simples (script node com grep) que falha o build.
3. `crypto.getRandomValues` continua sendo a única entropia real, isolada em
   `engine/core.ts` atrás de `newSeedString()`; o engine recebe a implementação por parâmetro
   opcional para os testes poderem injetar determinismo.
4. `localStorage` só em `engine/save.ts`, atrás de try/catch, com a interface injetável
   (`Storage | null`) para os testes.
5. Zero erros e zero warnings no console em uso normal — inclusive os avisos do React
   (`key` faltando, `getSnapshot` instável, atualização de estado durante render).
6. `dist/index.html` continua auto-contido: sem `http://`, sem `https://`, sem `import ` de
   rede, sem fonte externa. O build inlina tudo.

---

## 9. Ordem de trabalho e o que NÃO fazer

1. Scaffold + golden **antes** de portar qualquer linha de lógica.
2. Portar o engine módulo a módulo, rodando `test/golden.test.ts` a cada módulo.
3. Portar render, depois UI.
4. Só quando tudo passar: remover os arquivos vanilla de `src/` e `tools/`.

**Não faça nesta fase**, por mais tentador: renomear conceitos do domínio, "limpar" a IA,
trocar o algoritmo de FOV, mexer em balanceamento, adicionar animação nova, adicionar
feature nova, trocar o esquema de cores, introduzir i18n. Tudo isso vem depois, com o golden
já protegendo. Uma migração que muda comportamento é uma migração que ninguém consegue revisar.
