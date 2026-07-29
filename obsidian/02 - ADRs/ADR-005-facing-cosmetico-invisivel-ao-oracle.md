---
tipo: adr
atualizado: 2026-07-28
tags: [testes, oracle, personagem, estado]
---

# 🧭 ADR-005 — `facing` mora no engine, mas é invisível ao oracle

**Status:** aceita · precedente para toda feature cosmética futura

## Contexto

O Guerreiro tem 8 direções ([[ADR-004-personagem-por-codigo]]). Para escolher a linha certa
do atlas, alguém precisa saber para onde ele está olhando — e essa informação só existe no
momento em que o comando de movimento é interpretado.

O problema: o oracle da migração é a versão vanilla congelada, que **não tem esse campo**
([[ADR-003-golden-test-como-oracle-da-migracao]]). Adicionar um campo ao `Player` e deixá-lo
vazar para a comparação deixaria os 12 casos vermelhos por motivo legítimo — e a partir daí
ninguém consegue distinguir "feature nova" de "regressão".

Poderia-se guardar o `facing` na camada de render. Não daria certo: o render vê a **posição**
do jogador depois do turno, não a **intenção** do comando. Um passo barrado por parede não
muda posição nenhuma, mas o personagem deve se virar assim mesmo.

## Decisão

`player.facing: number` (0..7) mora no **engine** (`src/engine/types.ts:260`), e é **cosmético**.

Atualizado só no comando `move`, pela **intenção**, não pelo resultado
(`src/engine/game.ts:505-518`):

```ts
// passo aceito, passo que virou ataque e passo barrado por parede: o olhar acompanha.
// (0,0) não é direção nenhuma. `wait`, `use` e `descend` nunca chegam aqui.
const dir = dirIndex(dx, dy);
if (dir >= 0) g.player.facing = dir;
consumiu = mover(g, dx, dy);
```

Valor inicial `DEFAULT_FACING = 2` — sul do grid, na tela olhando para baixo-esquerda, a pose
mais próxima da referência (`src/engine/core.ts:121`).

**E é invisível ao oracle.** As três travas:

1. **Não entra em `snapshot()`.** A string continua `v1|seed|d|t|over|p=x,y,hp/maxHp,atk,poc,lv:xp|E[...]|I[...]` — nenhum campo novo (`src/engine/game.ts:730-741`).
2. **Não entra em `extrairJogador()`** do golden: continua copiando os mesmos oito valores
   de antes (`test/golden.test.ts:233-238`).
3. Não é lido por **nenhuma regra de jogo**. Não afeta dano, alcance, FOV, Dijkstra nem
   ordem de consumo do RNG.

### O precedente do `bump`

Isso não é invenção nova: o `bump` dos inimigos já era excluído pelo mesmo motivo, e o
extrator diz por quê — *"é float de animação, não estado lógico"*
(`test/golden.test.ts:207-208`). O `facing` recebe o **mesmo estatuto**, e por ele já haver
um caso análogo aprovado a decisão foi trivial de justificar.

### O ajuste de TIPO, e por que não é afrouxar teste

Uma linha mudou em `test/golden.test.ts`:

```ts
// test/golden.test.ts:118
type JogadorOracle = Omit<Player, 'facing'>;
```

Antes, `extrairJogador` declarava devolver `Player`. Depois de o `Player` ganhar `facing`,
essa assinatura passou a **mentir**: a função nunca copiou o campo novo. `Omit<Player,'facing'>`
faz o tipo dizer a verdade sobre o que a função já devolvia.

Os **valores comparados continuam exatamente os mesmos** — oito campos, mesma ordem, mesmo
extrator. Nenhum `expect` foi relaxado, nenhum caso foi pulado, nenhum snapshot foi regerado.
É correção de tipo, não afrouxamento de teste. O comentário no arquivo registra isso para o
próximo leitor não confundir as duas coisas (`test/golden.test.ts:109-117`).

Regra de parada, escrita junto: *se o golden ficar vermelho por qualquer outro motivo, **pare** — você quebrou comportamento* (`docs/PERSONAGEM.md:191`).

## Consequências

**Boas**

- A feature entrou com o oracle **intacto**: nenhum dos 12 casos precisou ser regerado.
- Fica o **protocolo** para toda feature cosmética futura: para nascer invisível ao oracle,
  o campo tem de (a) ficar fora de `snapshot()`, (b) ficar fora dos extratores do golden,
  (c) não ser lido por nenhuma regra e (d) não tocar o RNG. Quatro perguntas, resposta
  binária.
- A intenção vive onde ela existe. O render só consulta.

**Ruins**

- **Não há guarda automática.** Se alguém amanhã fizer o dano depender do `facing` — um bônus
  de flanco, por exemplo — o campo deixa de ser cosmético e o oracle **para de cobrir essa
  regra em silêncio**. O golden continuaria verde e a comparação estaria cega justamente
  onde interessa. Nenhum lint pega isso; é disciplina.
- O `facing` **é** gravado no save (`src/engine/save.ts:212-215`), com o comentário de que
  gravá-lo evita o guerreiro girar para o sul ao retomar a partida. Ou seja: o campo é
  invisível ao oracle mas visível ao formato de persistência. Save antigo sem o campo é
  tolerado por `normalizeFacing` (`src/engine/game.ts:916-918`).
- Um leitor apressado do golden pode ler `Omit<Player,'facing'>` como "aqui alguém tirou uma
  comparação para o teste passar". Daí o comentário longo no arquivo — a nota existe para
  não perder essa distinção.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Guardar o `facing` na camada de render | O render vê o resultado do turno, não a intenção. Passo barrado por parede não muda posição e mesmo assim tem de virar o personagem. |
| Derivar o `facing` da diferença entre posição anterior e atual | Perde os dois casos que não movem: ataque e parede. E exigiria estado extra no render, só que com informação pior. |
| Incluir `facing` no `snapshot()` e regerar o oracle | Regerar o snapshot para acomodar código novo é exatamente o que a regra de ouro do golden proíbe. Perde-se a única prova de fidelidade que existe. |
| Deixar o golden vermelho e ignorar | Um teste que se ignora é um teste que não existe. |

Relacionadas: [[golden-test]] · [[personagem-rig-3d]] · [[armadilha-do-yaw-isometrico]] · [[turnos-e-progressao]]
