---
tipo: changelog
atualizado: 2026-07-28
tags: [changelog, bestiario, monstros, render, sprite]
---

# 📆 28/07/2026 — o bestiário: Goblin, Slime e Ogro

Quarto ato do mesmo dia. Continuação de
[[2026-07-28-nascimento-migracao-e-guerreiro]], que fecha com "os inimigos continuam em
formas geométricas" na lista de pendências. Esta entrada é o fechamento dessa pendência.

Os três arquétipos do jogo ganharam rosto sem que uma linha de `src/engine/` fosse tocada.

---

## O que entrou

**Três rigs novos**, no mesmo pipeline do Guerreiro — caixas orientadas, culling por normal,
sombreamento interpolado, snap de paleta, atlas de 72 quadros forjado em runtime
([[personagem-rig-3d]], [[sprite-forge]], [[ADR-006-atlas-forjado-em-runtime]]):

| Arquétipo | Monstro | Arquivo | Altura | Forja |
|---|---|---|---|---|
| `chaser` | Goblin | `src/render/characters/goblin.ts` | 13u | 33 ms |
| `linker` | Slime | `src/render/characters/slime.ts` | 7u | 32 ms |
| `sentinel` | Ogro | `src/render/characters/ogre.ts` | 24u | 53 ms |

**A tabela `RETRATOS`** (`src/render/IsoRenderer.ts:262`) como ponto de extensão: arquétipo →
ficha do personagem, uma linha por bicho. Quem tem ficha vira sprite; quem não tem cai no
desenho geométrico, que deixou de ser o caminho normal de dois arquétipos e virou a rede de
segurança de quem não consegue forjar atlas (jsdom, Node, qualquer ambiente sem contexto 2D).
Depois do Goblin, o Slime e o Ogro entraram com **duas linhas cada** nessa tabela e zero
mudança em `drawEnemy`. Como se acrescenta o próximo: [[bestiario-monstros]].

**A dívida `TODO(inimigos-no-atlas)` foi paga.** O quadro do inimigo agora é modulado pela luz
do tile em `quadroModulado()` (`src/render/spriteForge.ts:1423`): o atlas continua sendo
forjado uma vez em brilho pleno, `lvl` é quantizado em 8 degraus e o par (quadro, degrau) vive
num cache LRU de 64 slots — memória fixa em ~1,4 MiB por personagem, independentemente do
tamanho do bestiário.

**Cores emissivas.** Uma cor da paleta pode ser declarada emissiva e ignora a modulação: a
camada é extraída **uma vez** na forja e recolada por cima do quadro escurecido. No escuro, o
Goblin vira dois pontos vermelhos (`olhoBrasa`) e o Slime vira dois `+` âmbar com um ponto
flutuante acima (`luzAmbar`, olhos e a bolinha da antena). O Ogro declara lista **vazia** de
propósito — a paleta dele não tem cor emissiva e inventar uma reprovaria o gate G5.

**O `facing` do inimigo**, derivado inteiramente na camada de render por observação da mudança
de tile entre turnos (`orientarInimigo`, `src/render/IsoRenderer.ts:762`). Nenhum campo novo em
`Enemy`, em `snapshot()`, no save ou no oracle — mesmo princípio de
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]], agora sem sequer precisar do engine.

**A bancada ganhou o elenco.** `npm run preview:goblin`, `preview:slime`, `preview:ogro` e
`preview:elenco`, cada um gerando sua folha em `docs/ref/`. Os painéis novos existem porque os
gates novos precisavam ser julgáveis: o bicho ao lado do Guerreiro em escala (G7), o mesmo
quadro em 5 níveis de luz com as emissivas preservadas (G8) e os quatro personagens lado a
lado (G9 e G10). Ver [[revisar-o-personagem]].

## A decisão que atravessa tudo

**Monstro é aparência de arquétipo, nunca comportamento novo** —
[[ADR-007-monstro-e-aparencia-nao-arquetipo]]. Zero mudança em `ARCHETYPES`, em `populate()`,
em hp, atk, alcance ou IA; o [[golden-test]] segue em 12/12 e a fase de arte pôde ser julgada
por gates visuais em vez de por regressão de comportamento.

O preço está dito por extenso naquele ADR: o Ogro é um encaixe **forçado** em `sentinel`. Um
brutamontes de marreta que ataca a 6 tiles não se defende, e a saída foi visual — a animação
de ataque é um **arremesso**, com a marreta apoiada na mão esquerda. A correção real está
marcada para a fase de balanceamento, com o oracle regenerado de propósito.

## O que a fase ensinou

A cimitarra do Goblin foi construída fiel à referência — apoiada no ombro, passando atrás da
cabeça — e **reprovada pelo dono**: o que funciona numa ilustração de 700 px vira uma tábua
cinza atravessada em 40 px. A lição, com as duas repetições do mesmo erro em outros dois
bichos (a antena do Slime medida por área, a marreta do Ogro medida por largura de quadro),
está em [[legibilidade-em-40px]].

## O que ficou pendente

- **O tempero da animação.** Os três monstros andam e respiram com o ciclo **genérico** do
  forge, o mesmo do Guerreiro. Só o **golpe** é de cada um (`arcoGolpe`). O resto — respiração
  1,4× mais rápida e balanço das orelhas no Goblin, atraso da antena no Slime, gingado de peso
  no Ogro — está escrito nas constantes de animação de cada personagem e **sem consumidor**.
  Plugá-los abre canais novos em `OpcoesForja`; é fase de animação, e ela mexe em
  `spriteForge.ts`.
- **A empunhadura do Goblin** ainda estava em revisão quando esta entrada foi escrita — a
  rodada 3 abriu o braço e mediu, mas o veredito final é do dono, no tamanho do jogo.
- **A oclusão sem z-buffer** continua sendo a pendência estrutural do render. O Ogro foi medido
  separando `artX` de `artY` e cabe no meio tile com a marreta erguida, mas a pendência de
  ~12 px na mesma antidiagonal, herdada do Guerreiro, segue aberta.
- **`RETRATOS` está cheia.** Os três arquétipos têm rosto; um quarto monstro não é uma linha de
  tabela, é conversa de arquétipo.

---

Ver [[bestiario-monstros]], [[ADR-007-monstro-e-aparencia-nao-arquetipo]],
[[legibilidade-em-40px]], [[arquetipos-de-inimigo]], [[fog-of-war-e-iluminacao]] e
[[_moc-render-e-arte]].
