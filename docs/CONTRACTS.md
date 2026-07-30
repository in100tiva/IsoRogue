# ISOROGUE — Contrato de Arquitetura (fonte da verdade)

> Roguelike 3D isométrico por turnos, **um único arquivo HTML**, sem bibliotecas,
> sem imagens, sem rede, sem recursos externos. Canvas 2D puro.
> Este documento é o CONTRATO. Qualquer módulo que divergir dele quebra a integração.
> **Não altere este arquivo.** Se algo estiver ambíguo, escolha a opção mais simples
> e registre em `notes` do seu retorno.

---

## 0. Regras invioláveis (valem para TODOS os módulos)

1. **`Math.random()` é PROIBIDO em todo o projeto.** Sem exceção, nem em código visual.
   Aleatoriedade de seed nova vem de `crypto.getRandomValues` (só em `R.newSeedString()`).
2. **Sem `import` / `export` / `require` / `fetch` / `XMLHttpRequest` / `WebSocket`.**
   Sem `eval`, sem `new Function`. Sem URLs externas de qualquer tipo.
3. **Nenhum acesso a DOM no top-level de um módulo.** DOM só dentro de funções `init*`
   chamadas por `R.Game.boot()`. Motivo: o harness headless carrega os módulos sem DOM.
4. Cada módulo é uma IIFE:
   ```js
   (function (R) {
     'use strict';
     // ...
   })(window.R = window.R || {});
   ```
   Em ambiente headless `window` é fornecido pelo sandbox — não referencie `document`
   fora de funções de init.
5. **Zero erros e zero warnings no console** em uso normal.
6. Determinismo é requisito de produto: **mesma seed + mesma sequência de comandos ⇒
   estado final byte-a-byte idêntico**. Nunca use `Date.now()`, `performance.now()`,
   ordem de iteração de `Set`/`Map` populados de forma não determinística, nem
   `Object.keys` de objeto montado com ordem variável dentro da lógica de jogo.
   Tempo (`dt`) só pode influenciar **animação/câmera**, jamais estado lógico.
7. Idioma: **toda string visível ao usuário em português (pt-BR) com acentuação correta**.
   Identificadores e comentários de código em inglês técnico é aceitável; comentários
   podem ser em português. Sem emojis na UI do jogo.
8. Estilo JS: ES2020, `'use strict'`, aspas simples, ponto-e-vírgula, 2 espaços de indentação.
9. Performance: mapa 45×45, alvo 60 FPS. Sem alocação por frame em laço quente
   (reutilize buffers). `ctx.save()/restore()` com parcimônia.

---

## 1. Layout de arquivos

| Arquivo | Responsável | Conteúdo |
|---|---|---|
| `src/00-core.js` | agente **core** | constantes, helpers, RNG determinístico |
| `src/10-mapgen.js` | agente **mapgen** | BSP, salas, corredores, BFS de conectividade |
| `src/20-fov.js` | agente **fov** | shadowcasting recursivo simétrico |
| `src/30-dijkstra.js` | agente **dijkstra** | mapa de Dijkstra + gradiente de fuga |
| `src/40-entities.js` | agente **entities** | arquétipos, IA, combate, itens, spawn |
| `src/50-render.js` | agente **render** | projeção isométrica, câmera, luz, sombra |
| `src/60-ui.js` + `src/ui.css` + `src/shell.html` | agente **ui** | HUD, log, debug, tooltip, morte, save |
| `src/70-game.js` | agente **game** | estado, turnos, input, progressão |
| `tools/build.mjs`, `tools/harness.mjs` | agente **tooling** | build do HTML único + testes headless |
| `index.html` | gerado por `node tools/build.mjs` | **o entregável** |

Ordem de concatenação no build: `00 → 10 → 20 → 30 → 40 → 50 → 60 → 70`.

---

## 2. Namespace e constantes (`src/00-core.js`)

```js
R.C = {
  VERSION: '1.0.0',
  MAP_W: 45,
  MAP_H: 45,
  TILE: { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3 },
  TW: 64,          // largura do losango do piso
  TH: 32,          // altura do losango do piso
  WALL_H: 36,      // altura vertical da parede em px
  FOV_RADIUS: 9,
  SAFE_RADIUS: 6,  // raio livre de inimigos ao redor do início
  MAX_REGEN: 8,    // tentativas de regeneração de mapa
  MAX_LOG: 400,
  STORAGE_KEY: 'isorogue.save.v1',
  HISTORY_KEY: 'isorogue.history.v1',
  ZOOM_MIN: 0.45,
  ZOOM_MAX: 2.4
};
```

### RNG

```js
R.hash32(str) -> uint32              // FNV-1a 32 bits, determinístico
R.makeRNG(seedUint32) -> rng
```

`rng` (mulberry32, estado `rng.s` uint32 exposto para snapshot):

| Método | Contrato |
|---|---|
| `rng.u32()` | próximo uint32 |
| `rng.next()` | float em `[0,1)` |
| `rng.int(a, b)` | inteiro em `[a, b]` **inclusive** nos dois lados |
| `rng.float(a, b)` | float em `[a, b)` |
| `rng.pick(arr)` | elemento; `undefined` se vazio |
| `rng.shuffle(arr)` | Fisher–Yates **in place**, retorna o próprio array |
| `rng.chance(p)` | `true` com probabilidade `p` (0..1) |
| `rng.fork(tag)` | novo `rng` derivado de `hash32(tag) ^ estado atual`; **não** altera o pai de forma dependente de uso futuro (chame `u32()` uma vez no pai para avançar) |

### Helpers obrigatórios

```js
R.idx(w, x, y)            // y * w + x
R.DIRS8                   // ORDEM FIXA — nunca reordene:
// [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]
R.DIRS4                   // [[1,0],[0,1],[-1,0],[0,-1]]
R.cheb(ax, ay, bx, by)    // distância de Chebyshev
R.euclid(ax, ay, bx, by)  // distância euclidiana
R.clamp(v, lo, hi)
R.lerp(a, b, t)
R.newSeedString()         // ex.: 'K7QX-3M9P' — usa crypto.getRandomValues; ÚNICO ponto de entropia real
R.normalizeSeed(str)      // trim, uppercase, colapsa espaços; string vazia -> R.newSeedString()
```

---

## 3. Mapa (`src/10-mapgen.js`)

```js
R.MapGen.generate(seedStr, depth) -> map
```

Objeto `map` (formato fechado — outros módulos dependem dele):

```js
{
  seed: String,            // seed normalizada
  depth: Number,           // 1-based
  w: Number, h: Number,
  tiles: Uint8Array,       // w*h, valores de R.C.TILE
  decor: Uint8Array,       // w*h, 0..255 — variação visual determinística (trincas, ladrilho)
  rooms: [ { id, x, y, w, h, cx, cy, area, shape } ],  // shape: 'rect'|'cross'|'round'|'pillared'|'notched'
  start: { x, y },         // posição inicial do jogador
  stairs: { x, y },        // escada para o próximo nível (tile STAIRS)
  connectivity: Number,    // 0..1 — fração de tiles caminháveis alcançáveis a partir de start
  walkable: Number,        // total de tiles caminháveis
  regenerations: Number,   // quantas vezes o mapa foi descartado e refeito
  repairs: Number,         // quantos túneis de reparo foram cavados
  notes: [String]          // mensagens para o log (em pt-BR)
}
```

### Algoritmo exigido

1. RNG: `R.makeRNG(R.hash32(seedStr + '#' + depth))`. Derive sub-streams com
   `fork('bsp')`, `fork('rooms')`, `fork('corr')`, `fork('decor')`.
2. **BSP**: divide recursivamente o retângulo do mapa. Corte alternado/escolhido por
   proporção; folha mínima 7×7; profundidade máxima 5. Split ratio entre 0.35 e 0.65.
3. **Salas variadas**: uma sala por folha, com margem ≥1 do limite da folha, largura e
   altura ≥4. Sortear `shape` entre os 5 valores listados; cada shape esculpe o piso de
   forma distinta (`cross` = duas faixas cruzadas, `round` = cantos removidos,
   `pillared` = colunas internas em grade, `notched` = um canto recortado).
4. **Corredores entre folhas irmãs**: ao voltar da recursão, conecte o centro da sala
   representativa da sub-árvore esquerda ao da direita, em L (ordem H→V ou V→H sorteada).
   Corredores têm 1 tile de largura; podem alargar para 2 com 15% de chance.
5. **Escada e início**: `start` no centro da sala de menor id; `stairs` no centro da sala
   mais distante de `start` em distância de grafo (BFS). Ambos em tile caminhável.
6. **BFS de conectividade** a partir de `start` sobre tiles caminháveis (4-vizinhança).
   `connectivity = alcançáveis / walkable`.
7. **Reparo**: se `connectivity < 1`, para cada região isolada encontre o par de tiles
   (região isolada, região principal) de menor distância de Manhattan e cave um túnel em L
   entre eles; incremente `repairs`; recompute o BFS. Repita até 100% ou até 3 reparos por
   tentativa.
8. **Regeneração**: se ainda `< 1`, descarte e refaça com seed derivada
   (`R.hash32(seedStr + '#' + depth + '#retry' + n)`), incrementando `regenerations`,
   até `R.C.MAX_REGEN`. Registre em `notes` cada evento
   (ex.: `'Conectividade 97,4% — 2 áreas isoladas religadas por túnel.'`).
9. `notes` sempre termina com a mensagem final de conectividade.

### API auxiliar

```js
R.MapGen.isWalkable(map, x, y)   // FLOOR, DOOR ou STAIRS, dentro dos limites
R.MapGen.blocksLight(map, x, y)  // WALL ou fora dos limites
R.MapGen.regions(map)            // { labels: Int32Array (-1 = parede), count, sizes: [] }
R.MapGen.inBounds(map, x, y)
```

---

## 4. Campo de visão (`src/20-fov.js`)

**Shadowcasting recursivo por octantes. Proibido raycasting por amostragem.**
Implemente a variante *symmetric shadowcasting* (varredura por quadrantes com recursão em
linhas, slopes racionais/float com regras de arredondamento simétricas), de modo que para
quaisquer dois tiles **caminháveis** A e B dentro do raio: `vê(A→B) ⇔ vê(B→A)`.

```js
R.FOV.compute(map, ox, oy, radius) -> Set<Number>   // índices y*w+x visíveis, inclui a origem
R.FOV.isVisibleFrom(map, ox, oy, tx, ty, radius) -> Boolean
R.FOV.checkSymmetry(map, ox, oy, radius) -> { tested, broken: [{x,y}], ok }
```

- Raio circular: descarte tiles com `euclid > radius + 0.5`.
- Paredes visíveis são incluídas no Set (necessárias para desenhar), mas
  `checkSymmetry` avalia **apenas pares de tiles caminháveis** — documente isso em comentário.
- Reuso: `compute` pode receber um `Set` interno reciclado, mas a API pública devolve um `Set`.

---

## 5. Dijkstra (`src/30-dijkstra.js`)

Um único mapa por turno, recalculado a partir do jogador. **A\* individual é proibido.**

```js
R.Dijkstra.INF = 99999;
R.Dijkstra.compute(map, sources, opts) -> Int32Array   // w*h
//   sources: [{ x, y, v }]  (v padrão 0)
//   opts: { blocked: Set<Number>|null }  — índices intransponíveis (ex.: outros inimigos NÃO entram aqui)
//   BFS com fila (custo uniforme 1, 8 direções, sem corte de canto em diagonal por paredes)
R.Dijkstra.flee(dmap, map, factor) -> Int32Array
//   factor padrão -1.2; multiplica valores finitos e faz re-scan até estabilizar
R.Dijkstra.bestStep(dmap, x, y, isBlockedFn) -> {x, y, v} | null
//   menor valor entre os 8 vizinhos; empate resolvido pela ORDEM DE R.DIRS8 (determinístico)
//   retorna null se nenhum vizinho tem valor menor que o do tile atual
```

Sem corte de canto: mover na diagonal `(dx,dy)` só é permitido se `(dx,0)` e `(0,dy)`
também forem caminháveis.

---

## 6. Entidades, IA e itens (`src/40-entities.js`)

### Arquétipos

```js
R.Ent.ARCH = {
  chaser:   { key:'chaser',   nome:'Perseguidor', hp:12, atk:4, range:1, cor:'#d9534f', ... },
  sentinel: { key:'sentinel', nome:'Sentinela',   hp: 9, atk:3, range:6, ideal:4, cor:'#4a90d9', ... },
  linker:   { key:'linker',   nome:'Vinculador',  hp:14, atk:5, range:1, cor:'#b06fd0', ... }
}
```

> **Emenda 2026-07-29:** `sentinel` passa a `nome:'Brutamontes', range:1, ideal:1, fem:false`
> e peso de spawn 1 (`chaser` 10, `linker` 100). hp/atk/xp inalterados. O texto acima é o
> contrato original, preservado como registro.
>
> **Emenda 2026-07-30 (balanceamento, §15 do BESTIARIO):** os campos `xp` e `peso` dos
> arquétipos foram abolidos e substituídos por `nivel` — Slime (`linker`) 1, Goblin
> (`chaser`) 2, Ogro (`sentinel`) 3. O XP do abate deixou de ser um valor por arquétipo e
> virou escala contra o nível do herói (ver §15), e os pesos de spawn saíram do arquétipo
> para a tabela por nível do herói (`PESOS_SPAWN`). A emenda de 2026-07-29 acima fica
> como registro do estado anterior.

Comportamento (todos usam **o mesmo `game.dmap`**):

- **Perseguidor** — avança sempre pelo gradiente descendente; ataca corpo a corpo quando
  adjacente (Chebyshev 1).
- **Sentinela** — mantém distância ideal 4: se `dist < 3` recua pelo gradiente de fuga;
  se `dist > 5` aproxima; ataca à distância quando tem linha de visão para o jogador e
  `dist <= range`. Sem LOS, aproxima.

> **Emenda 2026-07-29:** o comportamento acima foi abolido. O **Brutamontes** tem a mesma
> estrutura do Perseguidor: desce o gradiente e ataca corpo a corpo (alcance 1). Não há
> mais recuo tático, faixa morta, tiro à distância nem teste de LOS na IA — nenhum
> arquétipo atual tem `range > 1`.
- **Vinculador** — só ataca (e só avança para o corpo a corpo) se **outro** inimigo vivo
  estiver adjacente ao jogador neste instante; caso contrário circula mantendo distância 2–3
  aguardando um aliado.
- **Fuga por ferimento** — qualquer arquétipo com `hp <= 30% do maxHp` entra em `state:'flee'`
  e segue o gradiente **invertido** (`R.Dijkstra.flee`), buscando valores maiores.
  Volta a `hunt` se `hp > 50%` (cura não existe; na prática só sai de flee ao morrer — ok).

Estados: `'idle' | 'hunt' | 'flee' | 'attack' | 'wait'`. `ent.plan` é uma string curta em
pt-BR descrevendo a ação planejada (mostrada no tooltip): ex. `'avança para (12,7)'`,
`'ataca à distância'`, `'recua'`, `'aguarda aliado'`.

### Entidade

```js
{ id, kind:'chaser'|'sentinel'|'linker', x, y, hp, maxHp, atk, range,
  state, plan, lastDmg, bump }   // bump: 0..1, apenas animação
```

`id` é inteiro sequencial atribuído na criação, em ordem determinística.

### Spawn proporcional

```js
R.Ent.populate(map, depth) -> { enemies: [], items: [] }
```

> **Emenda 2026-07-30 (balanceamento, §15 do BESTIARIO):** a assinatura passou a
> `R.Ent.populate(map, depth, heroLevel)`. A **mistura** de arquétipos deixou de ser
> peso base + reforço por profundidade e passou a ser a linha de `PESOS_SPAWN`
> indexada pelo nível do herói (10/1/100 no herói 1 → 15/100/3 no herói 4+,
> na ordem `chaser/sentinel/linker`). Contagem, restrições, escalonamento de
> hp/atk por profundidade e a RNG `#pop#` continuam exatamente como descritos
> abaixo.

- RNG: `R.makeRNG(R.hash32(map.seed + '#pop#' + depth))`.
- Total de inimigos: `Math.min(22, 4 + depth * 2)`.
- Total de itens (poções): `Math.max(1, 3 + ((depth * 7) % 3) - Math.floor(depth / 4))`.
- **Distribuição proporcional à área das salas** usando *largest remainder method*
  (cota = área da sala / área total × N; distribui as sobras pelas maiores frações;
  empate de fração desempata pelo menor `room.id`).
- Restrições: nunca sobre `start`, `stairs`, outro inimigo/item, nem dentro de
  `R.C.SAFE_RADIUS` (Chebyshev) do `start`. Só em tiles caminháveis.
  Se a sala não tiver posição livre, a cota sobra migra para a próxima sala por id.
- Escalonamento por profundidade: `hp = base + Math.floor(base * 0.15 * (depth-1))`,
  `atk = base + Math.floor((depth-1) / 2)`.

### Combate

```js
R.Ent.rollDamage(rng, atk) -> Number   // atk + rng.int(-1, 1), mínimo 1
```

Todo dano do jogo consome **`game.rngCombat`** (stream único e sequencial) — é o que garante
que a mesma sequência de comandos produza o mesmo resultado.

```js
R.Ent.processEnemies(game)  // executa o turno de TODOS os inimigos
```

Ordem de processamento: **`id` crescente**. Resolução de conflito de movimento:
mantenha um `Set` de índices ocupados (inimigos vivos + jogador); um inimigo só entra em
tile livre e o reserva imediatamente. Se o destino preferido estiver ocupado, tenta o
segundo melhor vizinho (mesma ordem `R.DIRS8`); se nada servir, `state:'wait'`.

---

## 7. Estado do jogo (`src/70-game.js`)

```js
game = {
  seedStr, depth, turn, over, cause,          // cause: string pt-BR da causa da morte
  map, player, enemies: [], items: [],
  dmap: Int32Array, fleeMap: Int32Array|null,
  visible: Set<Number>, explored: Uint8Array,  // 1 = já visto alguma vez
  rngCombat,                                   // rng dedicado ao combate
  log: [ { turn, text, cls } ],                // cls: 'info'|'bom'|'ruim'|'aviso'|'sistema'
  stats: { turns, kills, dmgDealt, dmgTaken, itemsUsed, deepest, explorePct },
  ui: { hover: {x,y}|null, debug: false, fovProbe: false, follow: true }
}

player = { x, y, hp, maxHp, atk, potions, level, xp }
item   = { id, kind: 'potion', x, y, heal }
```

### API pura (usada pelo harness — **não pode tocar DOM**)

```js
R.Game.createState(seedStr, depth = 1) -> game
R.Game.applyCommand(game, cmd) -> Boolean   // true se consumiu turno
//   cmd: 'move:dx,dy' | 'wait' | 'use' | 'descend' | 'pickup' (pickup é automático ao pisar)
R.Game.endTurn(game)                        // dmap -> inimigos -> FOV -> stats -> autosave
R.Game.snapshot(game) -> String             // resumo determinístico do estado (hash textual)
R.Game.descend(game)                        // próximo nível, mantém hp/poções/stats
R.Game.logMsg(game, text, cls)
```

`snapshot` deve incluir: seed, depth, turn, hp, posição do jogador, hp+pos de cada inimigo
por id, itens restantes, e um checksum do `tiles`. Formato livre, mas estável.

### API com DOM

```js
R.Game.boot()            // chamada no fim do arquivo, dentro de DOMContentLoaded
R.Game.newRun(seedStr)   // cria estado, liga UI e render, autosave
```

### Regras de turno

- Um comando válido do jogador = 1 turno. Depois: recalcula `dmap` a partir do jogador →
  `R.Ent.processEnemies` → recalcula FOV → marca `explored` → atualiza stats/UI.
- Mover para tile com inimigo = atacar (não consome movimento extra).
- Andar sobre item = pega automaticamente e loga.
- Andar sobre a escada não desce sozinho: exige o comando `descend` (tecla `>` ou Enter).
- **Morte permanente**: `hp <= 0` ⇒ `over = true`, apaga o autosave, grava no histórico,
  UI mostra o resumo. Nenhum comando é aceito depois disso além de iniciar nova run.
- Dificuldade crescente por `depth` (ver §6) + jogador ganha `maxHp += 2` ao descer.

---

## 8. Render isométrico (`src/50-render.js`)

```js
R.Render.init(canvas)
R.Render.resize()
R.Render.update(game, dt)          // SOMENTE animação: lerp de câmera, bump, flashes
R.Render.draw(game)
R.Render.screenToTile(game, sx, sy) -> { x, y }   // inversa exata da projeção
R.Render.tileToScreen(game, x, y) -> { sx, sy }
R.Render.cam = { x, y, zoom, tx, ty, tzoom }
R.Render.setZoom(z)
```

### Projeção

```
isoX = (x - y) * (TW / 2)
isoY = (x + y) * (TH / 2)
screenX = (isoX - cam.x) * zoom + canvasW / 2
screenY = (isoY - cam.y) * zoom + canvasH / 2
```

Inversa: resolva o sistema para `x` e `y` e aplique `Math.floor` (ajuste o offset de meio
tile para que o highlight case exatamente com o losango sob o cursor — teste os 4 cantos).

### Ordem de desenho

Pintor por profundidade: laço `for (s = 0; s <= (w-1)+(h-1); s++)` sobre as antidiagonais
`x + y === s`, e dentro dela por `x` crescente. Pisos, depois paredes daquela diagonal,
depois entidades daquele tile. Isso garante oclusão correta das paredes sobre personagens.

### Aparência (evite o visual genérico de IA)

- Piso: losango preenchido + aresta 1px mais clara no topo-esquerdo. Cor base derivada de
  `map.decor[i]` (variação sutil de luminosidade ±6%), com padrão de ladrilho a cada 4 tiles.
- Parede: prisma — face superior (losango) + face esquerda e direita (paralelogramos),
  esquerda ~18% mais escura, direita ~32% mais escura. Contorno sutil.
- Sombra: elipse achatada escura semitransparente sob cada entidade; paredes projetam
  um losango escuro no tile adjacente sudeste (fake, barato).
- Iluminação: brilho por `1 - (dist / FOV_RADIUS)^1.6` a partir do jogador, aplicado como
  overlay de luz quente âmbar nos tiles visíveis. Névoa fria nos explorados-não-visíveis.
- Personagens em formas geométricas: jogador = losango/cone claro + esfera (cabeça) + arma;
  perseguidor = triângulo agressivo; sentinela = hexágono achatado com "olho";
  vinculador = dois losangos concêntricos. Todos com barra de vida fina quando feridos.
- Nunca vistos: **não desenha nada** (fundo). Explorados fora do FOV: apenas estrutura
  estática (piso/parede/escada) dessaturada e escurecida. **Inimigos, itens e efeitos só
  aparecem se o índice estiver em `game.visible`.**
- Highlight do tile sob o mouse: contorno âmbar de 2px no losango + leve preenchimento.
- Câmera segue o jogador com `lerp(cam, alvo, 1 - Math.pow(0.001, dt))` — puramente visual.
- Zoom por roda do mouse (respeitar `ZOOM_MIN/MAX`), suavizado.
- `devicePixelRatio` respeitado no resize; canvas ocupa o container e é responsivo.

### Camadas de debug (desenhadas por `draw` quando ligadas)

- `game.ui.debug`: escreve `dmap[i]` centralizado no losango de cada piso visível+explorado
  (fonte 10px mono, cor conforme magnitude), e sobrepõe grade fina.
- `game.ui.fovProbe`: computa `R.FOV.compute(map, hover.x, hover.y, FOV_RADIUS)` e pinta
  esses tiles em ciano translúcido; roda `R.FOV.checkSymmetry` e pinta em magenta com um
  "X" cada tile inconsistente.

---

## 9. UI (`src/60-ui.js`, `src/ui.css`, `src/shell.html`)

`src/shell.html` é o esqueleto do documento com um marcador `<!--INJECT_CSS-->` dentro de
`<style>` e `<!--INJECT_JS-->` dentro de `<script>`. Deve conter `<!doctype html>`,
`<html lang="pt-BR">`, `<meta charset="utf-8">`, `<meta name="viewport" ...>`, `<title>`.

### Layout

Duas colunas: canvas à esquerda (flex-1), painel lateral à direita (largura 320px).
Abaixo de 900px de largura, o painel vira uma faixa inferior rolável (responsivo real).

Painel lateral contém, nesta ordem:
1. **Cabeçalho**: título, nível (profundidade), turno.
2. **Vitais**: barra de vida com número, ataque, poções.
3. **Semente**: `<input id="seed">` + botões `Gerar`, `Aleatória`, `Copiar`.
   `Copiar` usa `navigator.clipboard` com fallback para seleção do input; nunca lança.
4. **Estado do mapa**: conectividade em % (com destaque verde em 100%), salas, inimigos,
   itens, tiles visíveis.
5. **Registro**: `<div id="log">` rolável (altura fixa, `overflow-y:auto`), auto-scroll
   para o fim, entradas coloridas por `cls`, no máximo `R.C.MAX_LOG`.
6. **Ajuda**: lista compacta de teclas.

> **Emenda 2026-07-30 (§16 do BESTIARIO):** o cabeçalho passa a quatro números e uma
> barra — **Andar** (a profundidade, que o rótulo sempre chamou de "Nível"),
> **Turno**, **Nível** (o do HERÓI, `player.level`) e **XP** (`player.xp`/100) com a
> barra âmbar de progresso. Ids novos: `#hud-heroi-nivel`, `#hud-xp`,
> `#hud-xp-barra`. Os ids antigos e os valores que mostram não mudaram.

### Elementos com id fixo (o `game.js` e o `ui.js` dependem destes)

`#cv` (canvas), `#seed`, `#btn-gerar`, `#btn-aleatoria`, `#btn-copiar`, `#log`,
`#hud-vida`, `#hud-vida-barra`, `#hud-nivel`, `#hud-turno`, `#hud-atk`, `#hud-pocoes`,
`#map-conect`, `#map-salas`, `#map-inimigos`, `#map-itens`, `#map-visiveis`,
`#tooltip`, `#debug`, `#morte`, `#morte-corpo`, `#btn-nova`.

> **Emenda 2026-07-30 (§16 do BESTIARIO):** acrescentar à lista — `#hud-heroi-nivel`,
> `#hud-xp`, `#hud-xp-barra`.

### API

```js
R.UI.init(game, handlers)   // handlers: { onGerar(seed), onAleatoria(), onCopiar(), onNova() }
R.UI.refresh(game)          // HUD + estado do mapa
R.UI.pushLog(game, entry)   // renderiza uma entrada nova (não redesenha tudo)
R.UI.rebuildLog(game)
R.UI.showTooltip(html, sx, sy) / R.UI.hideTooltip()
R.UI.showDeath(game) / R.UI.hideDeath()
R.UI.setDebug(game)         // atualiza o painel #debug (seed, FPS, pos, tile sob cursor,
                            // conectividade, inimigos, itens, tiles visíveis)
```

### Tooltip de criatura

Ao passar o mouse sobre uma criatura **visível**: vida (`x/y`), arquétipo, distância
(Chebyshev), valor de Dijkstra do tile dela, estado e ação planejada (`ent.plan`).

### Tela de morte

Overlay com: semente, nível alcançado, turnos, inimigos derrotados, dano causado,
dano recebido, itens usados, exploração (% de tiles caminháveis já explorados do nível)
e causa da morte. Botão `Nova expedição`.

### Save local (`R.Save`)

```js
R.Save.write(game)   // serializa o essencial: seed, depth, turn, player, enemies, items,
                     // explored (base64 ou array), stats, rngCombat.s, log (últimas 80)
R.Save.read() -> obj|null
R.Save.clear()
R.Save.pushHistory(game)   // últimas 10 runs mortas
R.Save.readHistory() -> []
```

Tudo dentro de `try/catch` — `localStorage` indisponível não pode quebrar o jogo.
Ao carregar a página: se houver save válido e a run não estiver morta, retoma; senão nova run.
`R.Game.restore(obj)` reconstrói o estado (o mapa é **regerado pela seed+depth**, nunca
serializado — determinismo garante que é o mesmo mapa).

---

## 10. Teclas

| Tecla | Ação |
|---|---|
| `W A S D`, setas, numpad 8/4/2/6 | mover/atacar em 4 direções |
| `Q E Z C`, numpad 7/9/1/3 | diagonais |
| `.` `,` `5` `Espaço` | esperar (consome turno) |
| `H` ou `1` | usar poção |
| `>` `Enter` ou `Return` | descer escada (só sobre a escada) |
| `V` | alternar sonda de FOV sob o cursor |
| `D` | alternar painel de debug |
| `F` | alternar seguir jogador com a câmera |
| `+` `-` `roda` | zoom |
| `N` | nova expedição com a semente do campo |

Impedir scroll da página com setas/espaço (`preventDefault`). Ignorar teclas quando o foco
estiver no `<input id="seed">`.

---

## 11. Ferramentas (`tools/`)

### `tools/build.mjs`

Node ≥18, sem dependências. Lê `src/shell.html`, injeta `src/ui.css` no marcador
`<!--INJECT_CSS-->` e a concatenação dos `src/*.js` (ordem numérica do prefixo) no
`<!--INJECT_JS-->`, escreve `index.html` na raiz. Falha com mensagem clara se um marcador
ou arquivo estiver faltando. Imprime o tamanho final em KB.

### `tools/harness.mjs`

Carrega `index.html`, extrai o conteúdo do `<script>` e executa em `node:vm` com um sandbox
que fornece `window`, `globalThis`, `console`, `crypto`, `performance`, `localStorage` (mock
em memória), `requestAnimationFrame` (no-op), e um `document` mínimo cujo
`getElementById` devolve um stub encadeável (`style`, `classList`, `addEventListener`,
`appendChild`, `getContext()` devolvendo um stub de canvas 2D com todos os métodos usados).
**Qualquer `console.error`/`console.warn` durante os testes é falha.**

Testes obrigatórios (saída legível + `process.exit(1)` em falha):

1. **T1 Conectividade** — 60 seeds × profundidades 1..3: `map.connectivity === 1`.
2. **T2 Determinismo de mapa** — mesma seed gerada 2× ⇒ `tiles`, `decor`, `rooms`,
   `stairs`, `start` idênticos.
3. **T3 Determinismo de população** — mesma seed ⇒ mesmos inimigos e itens (pos, hp, kind).
4. **T4 Simetria de FOV** — 40 seeds, 25 origens caminháveis cada:
   `checkSymmetry(...).broken.length === 0`.
5. **T5 FOV não vaza** — nenhum tile visível fora do raio; origem sempre visível.
6. **T6 Determinismo de partida** — mesma seed + mesma sequência de 400 comandos
   (gerada por RNG determinístico do próprio harness) ⇒ `R.Game.snapshot` idêntico em
   dois runs independentes, comparado a cada turno.
7. **T7 Invariantes de turno** — em 300 turnos: nunca dois inimigos no mesmo tile; nenhum
   inimigo em parede; jogador nunca em parede; `turn` incrementa exatamente 1 por comando
   que retorna `true`; nenhum comando aceito após `over`.
8. **T8 Dijkstra** — valor no tile do jogador é 0; todo tile caminhável alcançável tem
   valor finito; vizinhos diferem no máximo 1.
9. **T9 Sem proibidos** — grep no `index.html` final: `Math.random`, `import `, `require(`,
   `fetch(`, `http://`, `https://`, `eval(`, `new Function` ⇒ falha (permitido `https://`
   apenas em comentário de licença? **não** — zero ocorrências).
10. **T10 Progressão** — `descend` em 5 níveis seguidos funciona, dificuldade sobe,
    stats acumulam.

O harness deve terminar com `TODOS OS TESTES PASSARAM` ou listar as falhas.

---

## 12. Paleta e tipografia (para o agente ui/render)

Fundo `#0d1014`; painel `#141920`; borda `#232b36`; texto `#c9d3de`; texto fraco `#7d8899`;
âmbar (destaque/luz) `#e0a43c`; verde `#5fb36a`; vermelho `#d9534f`; azul `#4a90d9`;
roxo `#b06fd0`; ciano (debug) `#3fd0d8`; magenta (inconsistência) `#e04fa0`.
Piso `#3a4250` base, parede topo `#525d6e`. Fonte: `ui-monospace, SFMono-Regular,
'JetBrains Mono', Consolas, monospace` para números/log; `system-ui, -apple-system, Segoe UI,
Roboto, sans-serif` para texto corrido. Escala de espaçamento base-4 (4/8/12/16/24/32).
Sem gradientes decorativos, sem sombras coloridas difusas, sem bordas arredondadas grandes
(máx 6px), sem emoji. Alvos de clique ≥ 32px de altura.
