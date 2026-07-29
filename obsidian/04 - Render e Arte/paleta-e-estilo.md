---
tipo: nota
atualizado: 2026-07-28
tags: [render, paleta, cor, estilo, ui]
---

# 🎨 Paleta e estilo

Duas paletas convivem no projeto, e elas não se misturam: a do **mundo** (piso, parede,
inimigos, HUD) e a do **personagem** (a armadura do Guerreiro). As duas são curtas de
propósito.

## A paleta do mundo

Fica em `src/render/palette.ts:23`, em RGB, e vem do contrato de arte do projeto:

| papel | cor |
|---|---|
| fundo | `#0d1014` |
| piso base | `#3a4250` |
| parede topo | `#525d6e` |
| âmbar (destaque, luz) | `#e0a43c` |
| verde / vermelho / azul / roxo | `#5fb36a` `#d9534f` `#4a90d9` `#b06fd0` |
| ciano (sonda) / magenta (inconsistência) | `#3fd0d8` `#e04fa0` |
| texto / texto fraco | `#c9d3de` `#7d8899` |

Os mesmos valores aparecem como tokens CSS em `src/styles/global.css:10` — uma cor, dois
consumidores, escritos duas vezes porque canvas e CSS não compartilham variável. Mudar um
sem o outro produz um HUD que não casa com o mundo.

Nada é calculado durante o desenho: `buildLuts()` (`src/render/palette.ts:183`) monta todas
as strings de cor uma vez por instância de renderer. `LEVELS = 17` degraus de luz,
8 baldes de variação vindos de `map.decor` (±6% de luminosidade, `decorFactor`, `:142`),
3 faces de parede com fatores `[1, 0.82, 0.68]` (`:212`), rampas de HP, de clarão, de
Dijkstra e até `NUMSTR` com os números de 0 a 999 já em string — nenhuma alocação no laço
quente.

## A paleta do Guerreiro

`src/render/characters/warrior.ts:41`: 4 tons de ouro, 1 de couro, 3 de aço, mais `vazio` e
`contorno`. Dez cores, amostradas da imagem de referência `docs/ref/guerreiro-referencia.png`
(151×151). É a paleta **inteira** do personagem — o sombreamento não inventa cor nova.

As rampas por material (`RAMPAS_GUERREIRO`, `:62`) e o mapa cor → material
(`RAMPA_DA_COR`, `:70`) existem porque a quantização precisa saber para onde uma face pode
descer. Note o truque em `couro: ['couro', 'couro', 'ouroSombra', 'vazio']`: a repetição
alarga o degrau claro do material.

## Duas quantizações, não uma

1. **Por face**, em `src/render/model3d.ts:484`: multiplica o RGB do tom pelo fator de luz e
   escolhe o degrau da rampa mais próximo por luminância. Empate fica com o tom mais escuro —
   determinístico.
2. **Por pixel**, em `src/render/spriteForge.ts:577`: depois de rasterizar, cada pixel do
   buffer de arte é forçado para dentro da paleta, com alpha binário.

A segunda existe porque a primeira não basta. `montarModelo` decide a cor certa, mas quem põe
pixel na tela é `ctx.fill()` de polígono, e o Canvas antialiasa toda borda. Em px de arte,
onde uma peça inteira tem 3 ou 4 pixels de travessia, **a borda é a peça**: medido na
primeira rodada, 86,6% dos pixels do sprite estavam fora da paleta — 1426 tons quentes
distintos onde a spec permite 10. Sem o snap, o sprite lê como "3D liso", que é exatamente o
que o estilo evita.

Regra prática: **não acrescente cor à paleta do personagem** sem revisão visual contra a
referência (gate G5 de [[revisar-o-personagem]]). Uma cor a mais não aparece como erro de
compilação; aparece como gradiente.

## Anti-padrões de UI que o projeto evita

O visual foi escrito para não parecer interface genérica. O que está proibido, e o que o
código de fato faz:

- **Sem gradiente decorativo.** `grep gradient src/styles/` não devolve nada.
- **Sem sombra colorida difusa.** As únicas sombras são a elipse achatada sob a entidade
  (`COL_SHADOW_ENT`) e o losango escuro que a parede projeta no tile a sudeste
  (`src/render/IsoRenderer.ts:810`) — ambas cinza-azuladas e semitransparentes.
- **Raio de borda pequeno.** Máximo declarado 6px; o maior valor real em
  `src/styles/ui.css` é 4px, e o padrão é 2px.
- **Sem emoji na UI do jogo** e todo texto visível em pt-BR com acentuação.
- **Escala de espaçamento base-4** (4/8/12/16/24/32) e alvos de clique ≥ 32px.
- Duas famílias tipográficas, e só duas: mono para números e log, sans do sistema para texto
  corrido (`src/styles/global.css:28`).

Detalhes de leitura do mundo — como o mesmo tom muda entre tile visível e explorado — estão
em [[fog-of-war-e-iluminacao]].

Ver também: [[personagem-rig-3d]], [[sprite-forge]], [[projecao-isometrica]],
[[_moc-render-e-arte]].
