---
tipo: nota
atualizado: 2026-07-28
tags: [rng, semente, determinismo, mulberry32, engine]
---

# 🎲 Semente e RNG

Duas peças: `src/engine/rng.ts` (o gerador) e a seção 4 de `src/engine/core.ts` (a
semente). Regra que atravessa o projeto inteiro: **`Math.random` é proibido**, e a única
entropia real do jogo é `crypto.getRandomValues` dentro de `newSeedString`
(`src/engine/core.ts:226`). O teste T9 (`test/engine.test.ts:705`) faz grep nas fontes e
no bundle para garantir isso.

## Como a semente vira mundo

```
'k7qx-3m9p'
  └─ normalizeSeed        → 'K7QX-3M9P'          core.ts:244
      └─ hash32(seed + '#' + depth)              FNV-1a 32 bits, core.ts:70
          └─ makeRng(seedNum)                    mulberry32, rng.ts:151
              └─ fork('bsp') / ('rooms') / ('corr') / ('decor')
```

`normalizeSeed` é a **fronteira do determinismo**: trim, maiúsculas, espaços internos
colapsados. `'k7qx-3m9p'` e `' K7QX-3M9P '` têm de gerar o mesmo mundo, e geram porque a
normalização acontece antes do hash. Entrada vazia devolve uma semente nova.

`hash32` é FNV-1a de 32 bits sobre as *code units* UTF-16 (`src/engine/core.ts:70-79`) —
estável entre plataformas, independente de locale, sem dependência.

O gerador é **mulberry32** com estado uint32 exposto em `rng.s`
(`src/engine/rng.ts:44-63`). Estado serializável em um número é o que permite salvar e
restaurar uma partida sem serializar o mapa: `snapshot` grava `rng=…`
(`src/engine/game.ts:762`) e `restore` reinstala o `s`
(`src/engine/game.ts:977`).

Dois detalhes do contrato numérico que parecem cosméticos e não são:

- `rng.int(a, b)` é **inclusivo nos dois extremos** e usa *rejection sampling*
  (`src/engine/rng.ts:78-88`): descarta a franja superior do espaço uint32 que não é
  múltipla do intervalo, eliminando o viés de módulo. Um `% range` cru enviesaria salas,
  spawn e dano.
- `rng.chance(p)` consome **exatamente um** `u32()` sempre, inclusive para `p = 0` e
  `p = 1` (`src/engine/rng.ts:124-126`). Assim a sequência não depende do *valor* de `p` —
  ajustar uma probabilidade não desalinha tudo que vem depois.

## Os streams derivados

`fork(tag)` (`src/engine/rng.ts:139`) cria um sub-stream com semente
`hash32(tag) ^ estado_atual_do_pai` e faz o pai avançar **exatamente um `u32()`**,
independentemente de quanto o filho for consumido. É essa regra que torna o fork
reprodutível: gastar o filho nunca perturba a sequência do pai.

Streams em uso:

| Stream | Origem | Onde |
|---|---|---|
| `bsp` | `fork` do rng do mapa | cortes da árvore |
| `rooms` | idem | tamanho, posição, formato e recorte das salas |
| `corr` | idem | corredores em L e túneis de reparo |
| `decor` | idem | variação visual determinística por tile |
| população | `hash32(map.seed + '#pop#' + depth)` | inimigos e itens (`src/engine/entities.ts:575`) |
| combate | `hash32(seed + '#combat' + depth)` | todo dano do jogo (`src/engine/game.ts:318`) |

Em `buildLayout` (`src/engine/mapgen.ts:502-511`) a ordem literal é `fork('bsp')`,
`u32()`, `fork('rooms')`, `u32()`, `fork('corr')`, `u32()`, `fork('decor')`, `u32()`, e só
então `decorSeed = rngDecor.u32()`. **Cada uma dessas oito linhas é contrato.** Remover um
`u32()` "redundante" reescreve todos os mapas de todas as sementes.

A separação por stream é o que dá isolamento de mudança: mexer no gerador de corredores não
move o spawn, e o combate de um nível não conversa com o de outro (o `#combat` inclui a
profundidade, e `descend` recria o stream — `src/engine/game.ts:689`).

## O que o jogador vê

O bloco **Semente** do painel lateral (`src/ui/panels/SeedPanel.tsx`) tem um campo e três
botões, com os ids fixos do contrato (`#seed`, `#btn-gerar`, `#btn-aleatoria`,
`#btn-copiar`):

- **Gerar** — `store.newRun(texto do campo)` e o campo passa a mostrar a semente **já
  normalizada** (`adotarSementeDoJogo`, `src/ui/panels/SeedPanel.tsx:92-100`). O feedback de
  que `'k7qx'` virou `'K7QX'` é imediato.
- **Aleatória** — `newSeedString()` e nova expedição com ela
  (`src/ui/panels/SeedPanel.tsx:102-104`).
- **Copiar** — `navigator.clipboard.writeText` com plano B de seleção do campo +
  `execCommand` (`src/ui/panels/SeedPanel.tsx:144-164`). Nunca lança, sempre registra no
  log o resultado **real** e troca o rótulo do botão por 1400 ms (`Copiada` /
  `Selecionada`). A promessa é sempre tratada nos dois ramos — rejeição solta no console
  reprovaria o requisito de zero erros.
- **Enter** no campo faz o mesmo caminho do Gerar.

O campo é controlado e tem estado `sujo`: enquanto o jogador digita, o refresh não atropela
o texto (`src/ui/panels/SeedPanel.tsx:83-88`). Mas há duas vias de nova expedição que não
passam por este painel — a tecla `N` (`src/ui/hooks/useKeyboard.ts:176`, que lê o campo por
`getElementById('seed')`) e o botão *Nova expedição* do resumo de morte. Por isso o painel
também vigia a **troca de partida**: `createState` devolve um `Game` novo a cada `newRun`,
enquanto `descend` muta o mesmo objeto — logo a identidade do `Game` é o sinal exato de
"expedição trocou", inclusive quando a semente resultante é a mesma
(`src/ui/panels/SeedPanel.tsx:75-80`).

## O alfabeto da semente

`newSeedString` produz `XXXX-XXXX` (`src/engine/core.ts:183-186`) sobre um alfabeto de 32
símbolos: dígitos 2–9 e letras A–Z **sem I e sem O**. Dois motivos:

1. 8 + 24 = exatamente 32, então `byte & 31` é uniforme e sem viés de módulo — o mesmo
   cuidado do `rng.int`.
2. Sem `0`/`O` e sem `1`/`I`, a semente é ditável em voz alta e transcrevível sem
   ambiguidade. Semente compartilhada é uma feature do produto (R19); uma semente que o
   colega digita errado não reconstrói mundo nenhum.

Se `crypto.getRandomValues` não existir, o fallback é um contador determinístico
(`src/engine/core.ts:204-217`) — degrada a **entropia**, nunca o **determinismo**, e nunca
lança.

## O que quebra se mudar

- **Qualquer expressão de `Mulberry32.u32`** — o cabeçalho do arquivo pede explicitamente
  que não se reescreva "mais limpo". Muda todas as partidas salvas e reprova o
  [[golden-test]].
- **Trocar `int` por `% range`** — introduz viés; nenhum teste de tipo acusa.
- **Mexer na ordem dos forks** ou remover um `u32()` de avanço — ver acima.
- **Normalizar a semente em outro lugar que não `normalizeSeed`** — abre a porta para duas
  grafias da mesma semente gerarem mapas diferentes.

Ver também: [[determinismo]], [[geracao-de-masmorra-bsp]], [[turnos-e-progressao]],
[[_moc-sistemas-de-jogo]].
