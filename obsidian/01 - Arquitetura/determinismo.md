---
tipo: nota
atualizado: 2026-07-28
tags: [arquitetura, determinismo, rng, semente, promessa]
---

# 🎲 Determinismo

O pilar. Tire o determinismo e o jogo continua funcionando — mas o [[golden-test]] deixa de
existir, a semente vira enfeite, o save quebra e metade dos testes de `test/engine.test.ts`
perde o sentido.

A promessa, em uma frase: **mesma semente + mesma sequência de comandos ⇒ exatamente o mesmo
resultado** (R19, R53).

## Por que isso é promessa ao jogador, e não detalhe interno

O campo de semente está na interface, com um botão `Copiar` ao lado (R18, R21). Quando alguém
copia `K7QX-3M9P` e manda para outra pessoa, está afirmando: *"você vai ver esta masmorra"*.
Não uma parecida — esta. Mesma escada no mesmo canto, mesmo perseguidor na mesma sala, mesma
trinca no mesmo ladrilho, porque até `map.decor` sai da semente.

E vai além do mapa: repetir a mesma sequência de teclas reproduz a mesma partida, com os mesmos
rolamentos de dano e a mesma morte no mesmo turno. É isso que permite gravar 200 comandos num
JSON e cobrar do código, um ano depois, o mesmo resultado.

## O gerador: mulberry32 com estado exposto

`src/engine/rng.ts`. Um PRNG de 32 bits cujo estado inteiro é **uma propriedade**: `rng.s`.

```ts
u32(): number {
  const a = (this.s + 0x6d2b79f5) >>> 0;
  this.s = a;
  let t = imul(a ^ (a >>> 15), 1 | a);
  t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
```

`src/engine/rng.ts:55-63`. Salvar o RNG é copiar um número; restaurar é `makeRng(s)`. É por
isso que o save do jogo não serializa o mapa: guarda semente, profundidade e `rngCombat.s`, e o
mapa é **regerado** na volta.

Três detalhes contratuais que parecem estilo e não são:

- **Todo fechamento com `>>> 0`.** Nunca vaza inteiro negativo. Reescrever "mais limpo" muda o
  número.
- **`int(a, b)` usa rejection sampling** (`src/engine/rng.ts:78-88`): descarta a franja superior
  do espaço uint32 que não é múltipla do intervalo, eliminando viés de módulo. Sem isso os
  primeiros valores do intervalo sairiam com probabilidade maior.
- **`chance(p)` consome exatamente um `u32()` sempre**, inclusive para `p=0` e `p=1`
  (`src/engine/rng.ts:124-126`). Se o consumo dependesse de `p`, mudar uma probabilidade de
  balanceamento deslocaria toda a sequência posterior.

## Streams derivados por `fork`

Um gerador único e global seria frágil: qualquer chamada nova em qualquer módulo deslocaria
tudo que vem depois. A saída é derivar sub-streams por tag.

```ts
fork(tag: string): Rng {
  const seed = (hash32(tag) ^ this.s) >>> 0;
  this.u32();            // avanço fixo do pai
  return makeRng(seed);
}
```

`src/engine/rng.ts:139-143`. A regra que faz isso funcionar: **o pai avança exatamente um
`u32()`, independentemente de quanto o filho for usado**. Consumir o filho nunca perturba a
sequência do pai. Então adicionar um sorteio dentro do stream de decoração não muda um único
tile de parede.

Os streams em uso:

| Stream | Origem | Onde |
|---|---|---|
| `fork('bsp')` | divisão do retângulo | `src/engine/mapgen.ts:503` |
| `fork('rooms')` | forma e escultura das salas | `src/engine/mapgen.ts:505` |
| `fork('corr')` | corredores em L | `src/engine/mapgen.ts:507` |
| `fork('decor')` | variação visual do piso | `src/engine/mapgen.ts:509` |
| `rngCombat` | dano, e só dano | `src/engine/game.ts:318` |
| população | inimigos e itens | `src/engine/entities.ts:575` |

A raiz de cada um é sempre `hash32` de uma string derivada da semente: `hash32(seed + '#' + d)`
para o mapa (`src/engine/mapgen.ts:676`), `hash32(map.seed + '#pop#' + d)` para a população,
`hash32(seed + '#combat' + d)` para o combate. Profundidade entra na string — nível 2 não é uma
continuação do stream do nível 1, é um mundo próprio.

`rngCombat` merece nota à parte: é um stream **sequencial único** para todo dano do jogo. É ele
que aparece em `snapshot()` como `rng=<s>` e no oracle como `rngCombat`. Se dois caminhos de
código diferentes consumirem esse stream em ordem diferente, o golden acusa — o estado do RNG é
uma assinatura da história inteira da partida.

Ver também [[semente-e-rng]].

## O que é proibido

`Math.random`, `Date.now`, `new Date(`, `performance.now`. No engine isso não é convenção: é
regra de lint que reprova o build (`tools/check-boundaries.mjs:19-21`), depois é T9 sobre o
`src/` e sobre o bundle. Ver [[camadas-e-fronteiras]].

A **única** entropia real do projeto inteiro é `crypto.getRandomValues`, isolada em
`newSeedString()` (`src/engine/core.ts:226-234`) — e injetável, para o teste passar bytes fixos.
Se `crypto` não existir no ambiente, o fallback não recorre ao relógio nem ao gerador nativo:
usa um contador e o próprio mulberry32 (`src/engine/core.ts:204-217`). Degrada a entropia, nunca
o determinismo.

Também proibida: qualquer dependência em ordem de iteração não determinística. `Set`/`Map`
podem ser usados, mas quando o conteúdo vira comparação — como o conjunto de tiles visíveis — a
extração percorre índices em ordem ascendente, não a ordem de inserção
(`test/golden.test.ts:303-310`).

## `DIRS8`: a ordem que decide empates

```ts
export const DIRS8: readonly Dir[] = [
  [1,0], [1,1], [0,1], [-1,1], [-1,0], [-1,-1], [0,-1], [1,-1]
];
```

`src/engine/core.ts:97-106`. Leste, sudeste, sul, sudoeste, oeste, noroeste, norte, nordeste.

Não é uma lista qualquer: é o **critério de desempate** de todo o jogo. Quando dois vizinhos
têm o mesmo valor de Dijkstra, vence o primeiro na ordem de `DIRS8`, com comparação estrita
(`src/engine/dijkstra.ts:423`). Quando o destino preferido de um inimigo está ocupado, o
segundo melhor é buscado na mesma ordem. Reordenar essa tabela — mesmo mantendo as oito
direções — muda o movimento de todos os inimigos em todas as partidas já salvas.

`dirIndex(dx, dy)` faz varredura linear sobre os oito pares (`src/engine/core.ts:129-135`) em
vez de calcular o índice por fórmula, justamente para que o índice acompanhe a tabela se alguém
um dia a reordenar. Ver [[dijkstra-e-comportamento]].

## O que quebra se você mexer

| Mudança | Consequência |
|---|---|
| Reordenar `DIRS8` | todo movimento de inimigo muda; golden reprova em massa |
| Trocar a expressão do `u32()` | todo mundo gerado muda; nenhum save antigo abre |
| Fazer `chance(p)` sair cedo em `p=0` | a sequência inteira desloca a partir dali |
| Consumir `rngCombat` num caminho novo | golden acusa no primeiro comando afetado |
| `Date.now()` em qualquer regra | lint reprova; se passasse, partidas divergiriam sem padrão |
| Mudar a string de seed (`'#combat'` → `'#combate'`) | outro mundo, mesma semente |

Essa última não é hipotética: `src/engine/entities.ts:321` tem um fallback que usa `'#combate'`,
com `e` no fim, e é diferente do `'#combat'` de `createState`. É defensivo — só dispara se
alguém chamar `processEnemies` com `rngCombat` ausente, o que o contrato não permite —, mas
serve de lembrete de como a promessa é frágil: uma letra separa dois universos.

## Ligações

- [[semente-e-rng]] — formato da semente, normalização, alfabeto.
- [[golden-test]] — a prova de que o determinismo continua valendo.
- [[camadas-e-fronteiras]] — o lint que protege isto.
- [[turnos-e-progressao]] — onde o `rngCombat` é consumido.
- [[ADR-005-facing-cosmetico-invisivel-ao-oracle]] — como adicionar estado sem quebrar a promessa.
