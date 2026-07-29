---
tipo: runbook
atualizado: 2026-07-28
tags: [testes, golden, vitest, lint]
---

# ✅ Rodar os testes

Um comando fecha o portão:

```bash
npm run check
```

que é literalmente `npm run lint && npm run typecheck && npm run test`
(`package.json`). Nessa ordem de propósito: o lint é o mais barato e o que pega o
erro mais estrutural.

## O que cada etapa faz

### 1. `npm run lint` — fronteiras de camada

Não é ESLint. É `tools/check-boundaries.mjs`, 84 linhas, que varre `src/engine/`
e `src/render/` atrás das construções proibidas pela regra §0 de
`docs/ARQUITETURA-REACT.md`: `import` de react, import de camada superior,
`document.`, `window.`, `Math.random`, `Date.now`/`new Date(`, `performance.now`.

Saída esperada:

```
Fronteiras de camada OK (15 arquivos verificados).
```

Falhou, imprime `arquivo:linha — motivo` e a própria linha, e sai com status 1.
Duas isenções nomeadas por **caminho relativo** (nunca por basename, para que uma
subpasta futura não herde a isenção em silêncio): `src/engine/save.ts` e
`src/engine/core.ts` podem tocar `window.` — o primeiro recebe o `Storage` por
injeção, o segundo isola `crypto` atrás de `newSeedString`. Ver [[camadas-e-fronteiras]]
e [[determinismo]].

### 2. `npm run typecheck` — `tsc --noEmit`

Roda em frações de segundo. Não emite nada; é gate, não build. O build do Vite
**não** typechecka, então pular esta etapa deixa erro de tipo chegar no `dist`.

### 3. `npm run test` — `vitest run`

Saída esperada hoje:

```
 Test Files  3 passed (3)
      Tests  73 passed (73)
   Duration  1.75s
```

| Arquivo | Cobre | Casos |
|---|---|---|
| `test/engine.test.ts` | T1..T10 do harness vanilla: conectividade (60 sementes × prof. 1–3), determinismo de mapa e de população, simetria de FOV (40×25), vazamento de FOV, determinismo de partida (400 comandos), invariantes de turno (300), Dijkstra, construções proibidas (3 casos), progressão de 5 níveis | 12 |
| `test/golden.test.ts` | paridade do engine novo com o oracle vanilla — integridade do oracle + 12 sementes × 4 verificações | 49 |
| `test/ui.test.tsx` | smoke da casca React em jsdom — painéis, campo de semente, registro, overlay de morte, laço de rAF sob `StrictMode` | 12 |

Ruído normal e **não** é falha: dezenas de linhas
`Not implemented: HTMLCanvasElement's getContext() method` vindas do jsdom. O
`IsoRenderer` degrada sem lançar quando `getContext('2d')` devolve `null`, e um dos
casos de `ui.test.tsx` existe justamente para provar isso.

`T9` builda `dist/index.html` se ele não existir, então a primeira execução numa
árvore limpa demora mais que 1,75 s.

## Como ler uma falha do golden

O golden não diz "algo divergiu". Ele diz **qual comando**, de qual semente, em qual
passada. `conferirSequencia` (`test/golden.test.ts:497`) acha o primeiro índice em que
a string de aceitos ou o hash por comando divergem e monta um bloco assim:

Este é o relatório real produzido ao mudar `WOUNDED_RATIO` de `0.3` para `0.31` em
`src/engine/entities.ts:110` — um ponto percentual no limiar de fuga dos feridos:

```
  PRIMEIRA DIVERGÊNCIA — GOLD-0008 (nível 2, passada resistente)
    comando nº         : 94 de 200
    comando            : "move:1,-1"
    aceito (oracle)    : true
    aceito (port)      : true
    hash esperado      : 63148357
    hash obtido        : 196ecd74
    snapshot anterior  : v1|seed=GOLD-0008|d=2|t=84|…|E[…|5:chaser:13:7:6|…]|S=84,3,51,289,0,2,12|rng=810957507|…
    snapshot obtido    : v1|seed=GOLD-0008|d=2|t=85|…|E[…|5:chaser:4:8:7|…]|S=85,3,60,294,0,2,12|rng=2010687650|…
    último marco igual : turno 80
    reprodução         : createState('GOLD-0008', 2) + 95 comandos de casos[7].comandos
                         (com hp reposto antes de cada comando)
```

Leia de baixo para cima:

1. **reprodução** é uma receita executável — copie os `comandos` do caso no
   `snapshots.json` e reproduza no REPL ou num teste temporário. Note o parêntese:
   quem falhou foi a passada *resistente* (jogador curado antes de cada comando), não a
   canônica; reproduzir sem esse detalhe não reproduz nada.
2. **último marco igual** delimita a janela: entre o turno 80 e o comando 94 está a
   causa.
3. **snapshot anterior × obtido** nomeia o culpado. Aqui o inimigo `5:chaser` está em
   `13:7:6` no oracle e em `4:8:7` no port — hp 13 → 4 e posição diferente: o
   perseguidor levou dano e, com o limiar mexido, decidiu fugir em vez de continuar
   avançando. O formato do `snapshot()` está em [[determinismo]].

Este relatório não é decoração — é a única razão pela qual uma diferença de 1% num
único número vira um diagnóstico em vez de um "12 testes falharam". A história de por
que a mutação foi feita está em [[golden-test-precisa-ser-testado]].

## O que NÃO fazer

**Nunca rode `npm run golden` para "consertar" um teste vermelho.**

`npm run golden` executa `tools/gen-golden.mjs`, que carrega
`legacy/isorogue-vanilla.html` em `node:vm` e **reescreve**
`test/golden/snapshots.json`. Isso não conserta nada: apaga a evidência. O oracle é a
medida; regenerá-lo para acomodar o código é serrar a régua até o móvel caber.

A regra está escrita no topo do próprio arquivo de teste
(`test/golden.test.ts:22`): *se algo divergir, o errado é o PORT, nunca o oracle. Não
regere o snapshots.json, não afrouxe a comparação, não pule caso.*

Regerar o oracle só é legítimo quando `legacy/isorogue-vanilla.html` mudar — e ele
está congelado. O JSON traz `fonteSha256` para provar de qual fonte veio, e
`geradoEm` é o **mtime da fonte**, não o relógio da máquina, para que duas execuções
produzam o mesmo arquivo byte a byte.

Também não vale:

- baixar os números do contrato em `test/engine.test.ts:42` (60 sementes, 400 comandos, …);
- afrouxar `toEqual` para `toMatchObject`;
- pôr `.skip` num caso "que sempre falha".

## Ver também

[[golden-test]] · [[ADR-003-golden-test-como-oracle-da-migracao]] ·
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]] · [[rodar-e-buildar]]
