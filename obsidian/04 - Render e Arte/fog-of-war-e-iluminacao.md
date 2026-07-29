---
tipo: nota
atualizado: 2026-07-28
tags: [render, fov, iluminacao, fog-of-war]
---

# 🔦 Névoa de guerra e iluminação

Todo tile do mapa está, a cada quadro, em exatamente um de três estados. A regra é curta e a
violação dela é sempre a mesma: vazar informação que o jogador não deveria ter.

| estado | teste no código | o que aparece |
|---|---|---|
| nunca visto | `!seen && !explored[i]` | **nada** — só o fundo `#0d1014` |
| explorado, fora do FOV | `explored[i] !== 0` | só estrutura estática: piso, parede, escada, porta — dessaturada e escura |
| visível agora | `game.visible.has(i)` | tudo, iluminado pela distância ao jogador |

O corte está em `src/render/IsoRenderer.ts:599` (pisos) e `:622` (paredes): `if (!known)
continue`. Para entidades o critério é mais apertado ainda — o laço só desenha item ou
inimigo quando `seen` é verdadeiro (`:639` e `:646`), nunca por estar explorado. Um inimigo
desenhado num corredor explorado seria um radar grátis.

A exceção é o jogador: ele é desenhado sempre que o laço passa pelo tile dele
(`:654`), mesmo que por algum motivo o índice não esteja em `visible`.

## De onde vêm os dois conjuntos

`game.visible` é um `Set<number>` recomputado a cada turno pelo shadowcasting; `game.explored`
é um `Uint8Array` acumulado, marcado logo depois (`src/engine/game.ts:223`):

```ts
const vis = computeFov(game.map, game.player.x, game.player.y, CONFIG.FOV_RADIUS);
game.visible = vis;
vis.forEach((i) => { if (i >= 0 && i < ex.length) ex[i] = 1; });
```

`FOV_RADIUS = 9`. O algoritmo e a garantia de simetria estão em
[[campo-de-visao-shadowcasting]]. O `explored` também alimenta a estatística de exploração
do painel e entra no save.

## As duas famílias de cor

O renderer nunca calcula cor durante o desenho — busca em LUT
(ver [[paleta-e-estilo]]). São duas famílias, e é a diferença entre elas que dá a leitura de
"lembrado" contra "visto agora" (`src/render/palette.ts:146`):

```ts
function litColor(base, level) {          // visível
  const b = level / (LEVELS - 1);
  let c = mul(base, 0.32 + 0.68 * b);     // escurece com a distância
  c = mix(c, RGB_COLD, 0.34 * (1 - b));   // névoa fria longe
  c = mix(c, RGB_WARM, 0.2 * b * b);      // âmbar quente perto
  return c;
}

function dimColor(base) {                 // explorado fora do FOV
  const c = mul(desat(base, 0.58), 0.4);  // 58% dessaturado, 40% de brilho
  return mix(c, RGB_COLD, 0.45);
}
```

`dimColor` não depende de nível nenhum: memória não tem gradiente de luz. O explorado é uma
cor só por (ladrilho, balde de decor).

## A iluminação radial

O brilho é `1 − (d / FOV_RADIUS)^1.6`, quantizado em 17 degraus e pré-calculado numa tabela
indexada por **d²** — assim o laço quente não tira raiz nem eleva a potência
(`src/render/palette.ts:186`):

```ts
const LIGHT_LEVEL = new Uint8Array((fovRadius + 2) ** 2 + 2);
```

No desenho, `lvl = LIGHT_LEVEL[dx*dx + dy*dy]` para tiles visíveis e `0` para explorados
(`src/render/IsoRenderer.ts:605`). O expoente 1,6 é o que dá a queda suave perto do jogador e
rápida na borda do FOV — trocá-lo muda a atmosfera inteira do jogo.

Duas variações somam textura sem gastar cor nova: o balde `decor[i] & 7` (±6% de
luminosidade) e o padrão de ladrilho a cada 4 tiles, `((x >> 2) + (y >> 2)) & 1`
(`:607`). Paredes ainda ganham três fatores de face (topo 1.00, esquerda 0.82, direita 0.68)
e projetam um losango escuro no tile a sudeste — sombra falsa e barata (`:810`).

## O jogador é a fonte de luz

Por isso o sprite dele sai com **brilho pleno**, sem modulação pelo `lvl` do tile: ele não
está iluminado, ele ilumina. Os inimigos, esses sim, têm cor modulada pelo nível — no desenho
geométrico via `sh.main[lvl]`, e no sprite via `quadroModulado()`.

Esse caminho de modulação era o buraco aberto enquanto os inimigos não tinham atlas
(`TODO(inimigos-no-atlas)`), e ele **está fechado**: o atlas continua sendo forjado uma vez em
brilho pleno e o escurecimento entra no desenho, com o `lvl` quantizado em 8 degraus e um
cache por (quadro, degrau). As cores emissivas — os olhos do goblin, os do slime e a bolinha
da antena — atravessam a modulação intactas, que é o que faz um inimigo no escuro continuar
sendo dois pontos acesos. Ver [[bestiario-monstros]].

**O que quebra se mudar:** desenhar entidade em tile apenas explorado entrega posição de
inimigo de graça; usar `explored` no lugar de `visible` no realce da sonda de FOV mascara
quebras de simetria; e mexer no expoente 1,6 ou em `LEVELS` sem refazer as LUTs deixa
índice fora de faixa (o código já se protege com `d2 < lightMax`).

Ver também: [[projecao-isometrica]], [[paleta-e-estilo]],
[[campo-de-visao-shadowcasting]], [[_moc-render-e-arte]].
