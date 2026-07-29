---
tipo: changelog
atualizado: 2026-07-29
tags: [changelog, parede, transparencia, isometria, render]
---

# 📆 29/07/2026 — Paredes translúcidas no canto frontal

Terceira fase do dia, pequena e cirúrgica. O relato do dono, com duas fotos: **o herói
some atrás da parede** ao passar ao norte dela — na segunda foto o corpo caído da
cinemática de morte ficava quase inteiro coberto pela fileira de blocos ao sul. É o
problema clássico da projeção isométrica: as tiles do "canto frontal" do jogador são
desenhadas **depois** dele no passe das paredes.

---

## O que mudou

A parede que encobre o herói fica **translúcida** (`alpha 0,35`), nunca invisível:
abaixo de ~0,3 o bloco some contra o fundo escuro e o buraco lê como erro de desenho.

**Quais tiles.** Exatamente três podem cobrir o sprite do guerreiro (48px acima da
âncora ≈ 1,5 fileira): `(p.x+1, p.y)`, `(p.x, p.y+1)` e `(p.x+1, p.y+1)` — as que
têm antidiagonal maior que a dele e sobreposição horizontal de tela. Duas fileiras à
frente cobrem no máximo ~8px da sola; deslocadas ±1 em `(x−y)` erram o sprite por 64px.
Só parede (`Tile.Wall`) entra; piso, porta e escada nunca.

**Como.** Um `Map<índice, alpha>` no `IsoRenderer`, no mesmo padrão `vfx`/`anim`:
`update(game, dt)` calcula o trio frontal e desliza cada entrada para o alvo
(`0,35` se está no trio e é parede, `1` caso contrário, `k = min(1, dt·9)` — cobre
~0,2 s de transição), podando quem volta a ~1. O passe das paredes em `draw()` lê o
mapa e envolve o `drawWall` com `save`/`globalAlpha`/`restore` só nas tiles afetadas.
`syncRun` limpa o mapa na troca de andar (índices são por mapa). Tudo cosmético:
nem uma linha de engine, e o alpha não depende de zoom.

**Só o herói.** Inimigo atrás de parede continua escondido — é a leitura roguelike
normal, e o pedido foi explícito para o herói.

## Verificação

- Teste funcional em Node (arquivo temporário, apagado): `update` sem canvas convergiu
  as três tiles para ~0,35, ignorou a parede **atrás** do herói, esvaziou o mapa ao
  afastar e na troca de mapa — o primeiro rascunho do teste caiu na armadilha de que
  o `update` **repovoa na mesma chamada** que o `syncRun` limpa (o mapa novo tem suas
  próprias paredes frontais).
- Foto headless em tempo real (sem `--virtual-time-budget`, que congela animações por
  `dt` — ver [[virtual-time-congela-animacao]]), com semente fixa: `s`×2 (meio da
  sala) mostra **todas as paredes opacas**; `s`×8 (colado na fileira sul) mostra o
  trio frontal **fantasmagórico** e a continuação da mesma fileira sólida.
- `npm run check` verde: fronteiras + typecheck ×2 + 73/73.

## O que quebra se mudar

- **Aumentar o conjunto além das três tiles** — fileiras extras piscam translúcidas sem
  cobrir sprite nenhum, e a sala inteira vira vidro perto de qualquer parede.
- **Baixar o alpha-alvo para perto de 0** — o bloco some e o mapa parece furado;
  translúcida ≠ invisível é decisão, não falta de coragem.
- **Ler o alpha direto de `p.x/p.y` no `draw` sem o deslize do `update`** — funciona,
  mas a transição seca de 1 → 0,35 num quadro pisca a cada passo do herói.

---

Vizinhos: [[projecao-isometrica]] · [[fog-of-war-e-iluminacao]] ·
[[2026-07-29-cinematicas-do-guerreiro]] · [[inspecao-visual-headless]]
