---
tipo: runbook
atualizado: 2026-07-28
tags: [personagem, revisao, sprite, gates]
---

# 🛡️ Revisar o personagem

O guerreiro não tem teste automático de aparência — **não existe assert para
"parece o desenho"**. O que existe é uma bancada que fotografa tudo o que há para
ver, e seis perguntas que um humano responde por escrito. Este runbook é sobre
produzir a foto; o julgamento continua sendo seu.

```bash
npm run preview:personagem
```

## Saída esperada

```
· buildando a bancada (vite.preview.config.ts)…
✓ 11 modules transformed.
.preview/preview.html  114.91 kB
· Google Chrome 149.0.7827.200

✓ docs/ref/preview-atlas.png (4702×1777px, 319 KB)
  forja do atlas: 50.7 ms (alvo < 40 ms — estourou)
  quadros no atlas: 72

Abra lado a lado com docs/ref/guerreiro-referencia.png e responda G1..G6.
```

`72 quadros` é o número certo: 8 direções × (2 parado + 4 andando + 3 atacando).
Se vier outro, alguém mexeu na tabela de estados de `docs/PERSONAGEM.md` §6.

O aviso de forja acima de 40 ms é **real e pendente** nesta máquina, não um erro de
medição — a passada 1 do capturador roda de propósito sem relógio virtual para que o
número signifique alguma coisa. Ver [[sprite-forge]].

## O que o script faz, e por que em duas passadas

`tools/preview-personagem.mjs`:

0. confere que `src/render/model3d.ts`, `src/render/spriteForge.ts` e
   `src/render/characters/warrior.ts` existem — erro legível em vez de stack trace do
   bundler;
1. builda `tools/preview.html` com `vite.preview.config.ts` → `.preview/preview.html`,
   auto-contido (a bancada reusa o próprio Vite porque o Vite 8 roda sobre Rolldown e
   **não expõe esbuild** — bundlar por fora exigiria uma dependência nova, que é proibida);
2. abre no Chrome com `--dump-dom`, **sem** `--virtual-time-budget`, e lê da página
   `data-bancada="LxA"`, `data-forja`, `data-quadros`, `data-erro`;
3. reabre com `--screenshot` usando exatamente aquele tamanho de janela, passando o
   tempo de forja pelo fragmento `#forja=`.

As duas passadas evitam os dois defeitos clássicos: janela menor que o conteúdo
(imagem cortada) ou maior (tarja preta), e "0,0 ms" de forja — sob relógio virtual um
trecho síncrono mede zero. É o mesmo fenômeno descrito em
[[virtual-time-congela-animacao]], aqui domado em vez de sofrido.

### Bandeiras úteis

```bash
node tools/preview-personagem.mjs --sem-build          # reaproveita .preview/preview.html
node tools/preview-personagem.mjs --saida=/tmp/x.png   # não sobrescreve o de referência
CHROME_BIN=/caminho/do/chrome npm run preview:personagem
```

## O que a bancada mostra

`docs/ref/preview-atlas.png`, 4702×1777 px, sete painéis:

1. **as 8 direções paradas**, ampliadas 4×, cada cartão rotulado com o índice, o delta
   do grid e para onde aquilo aponta **na tela** — `0 (1,0) leste / na tela:
   baixo-direita`. É o painel que responde G3 sozinho, e é onde a
   [[armadilha-do-yaw-isometrico]] apareceria de novo se voltasse;
2. os 4 quadros de **andando** na direção 2 (sul);
3. os 3 quadros de **atacando** na direção 2;
4. os 8 sprites no tamanho do jogo (1× e 2×), sentados em losangos de 64×32, para
   julgar legibilidade real;
5. a paleta **efetivamente exportada** pelo módulo, não a que a spec promete (G5);
6. a lista dos gates, para responder olhando;
7. o atlas inteiro com cada quadro demarcado — quadro vazio salta aos olhos (G2).

A bancada resolve os módulos do personagem **por forma**, não por nome de export: um
rename em `warrior.ts` não a apaga, no pior caso ela desenha um painel de erro
legível. Quando isso acontece, o script sai com status 1 e diz
`a bancada registrou um erro: …` — o PNG é gerado mesmo assim e mostra o painel, para
que a ferramenta não minta dizendo "ok".

## Os gates (docs/PERSONAGEM.md §10)

Abra `docs/ref/preview-atlas.png` **ao lado** de `docs/ref/guerreiro-referencia.png` e
responda por escrito:

- **G1** — a silhueta é reconhecível como *este* guerreiro? (traços I1–I8: armadura
  dourada, elmo com viseira escura, ombreiras volumosas, espada erguida, escudo
  redondo, contorno contínuo, paleta curta, proporção heroica)
- **G2** — as 8 direções são coerentes entre si: mesma altura, mesmo volume, sem "pular"?
- **G3** — a direção 0 (leste do grid) olha mesmo para baixo-direita na tela?
- **G4** — o contorno está contínuo, sem furos?
- **G5** — a paleta é a de §2, sem cor inventada nem gradiente contínuo?
- **G6** — espada e escudo estão nos lados certos e legíveis em todas as direções?

Reprovou em qualquer um: corrige e roda de novo. A spec avisa que **2 a 3 rodadas são
o normal**, não um sintoma de incompetência — o método por código existe justamente
porque acertar de primeira não é realista. Ver [[personagem-rig-3d]] e
[[ADR-004-personagem-por-codigo]].

## Reprovações conhecidas em aberto (28/07)

Registradas para que ninguém "descubra" de novo:

- silhueta ainda mais atarracada que a referência — pernas curtas demais (G1 parcial);
- direção 7 (nordeste) fica estreita demais (G2 parcial);
- o sprite de 88 px invade ~12 px do tile vizinho na mesma antidiagonal e passa por
  cima de paredes; corrigir exige z-buffer, que o pipeline não tem (§4.4 usa ordem do
  pintor por `depth = wx + wy + wz`);
- forja em ~50 ms contra o alvo de < 40 ms.

## O que quebra se mudar

- Inverter a ordem "rasteriza em baixa resolução → amplia com
  `imageSmoothingEnabled = false`" transforma o guerreiro em 3D liso. A ordem **é** o
  estilo — [[pixel-art-nasce-da-rasterizacao]].
- Apagar o desenho geométrico dos inimigos "porque agora todo mundo tem sprite". Ele deixou
  de ser o caminho normal e virou a rede de segurança de quem não consegue forjar atlas
  (jsdom, Node, qualquer ambiente sem contexto 2D) — ver [[bestiario-monstros]].
- Fazer o turno esperar animação. A animação é ilustração; o estado já mudou.

---

Vizinhos: [[sprite-forge]] · [[projecao-isometrica]] · [[paleta-e-estilo]] ·
[[inspecao-visual-headless]] · [[_moc-render-e-arte]]
