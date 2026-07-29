---
tipo: runbook
atualizado: 2026-07-28
tags: [headless, chrome, screenshot, depuracao]
---

# 📸 Inspeção visual headless

Como olhar para o jogo rodando quando não há tela — e por que o caminho óbvio não
funciona nesta máquina.

## O que NÃO funciona

A extensão de automação de navegador **não alcança o jogo**:

- ela não abre `file://` — e o entregável é um arquivo local;
- ela não alcança **nenhum** `localhost`: `ERR_CONNECTION_REFUSED` mesmo com o
  servidor vivo, respondendo por `curl`, e no mesmo *network namespace*.

Não gaste tempo tentando de novo, e não conclua daí que o servidor está morto. Suba
`npm run dev`, confirme por `curl` se quiser, e vá pelo caminho abaixo.

## O que funciona

Chrome headless invocado direto, tirando uma foto de um arquivo local:

```bash
npm run build

google-chrome-stable \
  --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1280,800 \
  --virtual-time-budget=8000 \
  --screenshot=/tmp/isorogue.png \
  "file://$PWD/dist/index.html"
```

Saída esperada: uma linha `NNNNN bytes written to file /tmp/isorogue.png` (~70–75 KB
para a janela acima) e nada mais. É exatamente o
mecanismo que [[revisar-o-personagem]] já usa em produção — só que ali a página é a
bancada, e aqui é o jogo.

`--force-device-scale-factor=1` importa: sem ele o PNG sai em escala de dispositivo e
a arte em pixel — que depende de `imageSmoothingEnabled = false` — vira mingau na
foto sem que nada esteja errado no jogo.

## Dirigir o jogo pelo teclado (não cutuque o estado)

Uma foto do turno 0 mostra pouco. A tentação é chamar `store.dispatch` ou mexer no
`Game` direto pelo console; **não faça** — assim você fotografa um estado que nenhum
jogador alcançaria e a foto deixa de ser evidência. Dirija pelas mesmas teclas do
`docs/CONTRACTS.md` §10: o ouvinte está em `window`, `keydown`
(`src/ui/hooks/useKeyboard.ts:235`), e um `KeyboardEvent` sintético percorre o mesmo
caminho de um dedo humano.

Receita completa, verificada:

```bash
cd /tmp
cp "$OLDPWD/dist/index.html" sonda.html
cat >> sonda.html <<'EOF'
<script>
(function () {
  var TECLAS = ['s', 's', 'd', 'd', 'c', 'c', '.'];
  var i = 0;
  function tecla(k) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }
  function esperarMontagem() {
    var campo = document.getElementById('seed');
    if (!campo) { setTimeout(esperarMontagem, 50); return; }   // <- ver armadilha 3
    campo.value = 'RUNBOOK-01';                                 // semente fixa
    tecla('n');                                                 // N = nova expedição
    var t = setInterval(function () {
      if (i >= TECLAS.length) { clearInterval(t); return; }
      tecla(TECLAS[i++]);
    }, 100);
  }
  esperarMontagem();
})();
</script>
EOF

google-chrome-stable --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1280,800 --virtual-time-budget=8000 \
  --screenshot=/tmp/isorogue.png "file://$PWD/sonda.html"
```

A foto sai com `SEMENTE: RUNBOOK-01`, `TURNO: 5`, `SALAS: 23` — reprodutível, porque a
semente manda em tudo ([[semente-e-rng]]). Sem fixar a semente, cada execução gera uma
masmorra diferente e comparar duas fotos não prova nada.

A sonda mora em `/tmp`, nunca no repositório: é `dist/index.html` **adulterado**, e um
entregável adulterado no repo é uma armadilha esperando alguém.

Teclas úteis: `W A S D` / `Q E Z C` movem, `.` espera, `H` usa poção, `>` desce,
`Shift+D` abre o painel de depuração, `V` liga a sonda de campo de visão,
`+`/`-` dão zoom.

## Armadilha 1 — o relógio virtual congela o clarão de dano

`--virtual-time-budget` faz o Chrome adiantar o relógio para não esperar por
`setTimeout`/`rAF`. O efeito colateral: **animações que decaem por `dt` não decaem**.

O clarão de dano é `v.flash -= dt * 3` em `src/render/IsoRenderer.ts:729` — de 1 a 0 em
~333 ms de tempo real. Sob relógio virtual ele fica preso em 1, e o personagem sai da
foto inteiro tingido de creme, porque `FLASH_COL` é aplicado sobre o sprite todo.

**Isso parece bug de cor e não é.** Antes de abrir investigação sobre a paleta
([[paleta-e-estilo]]), confirme: o jogador tomou dano nos últimos instantes da
captura? Se sim, a foto está mentindo.

Contorno: fotografe o jogador **sem dano recente**. Termine a sequência de teclas com
alguns `.` (esperar) longe de inimigos, ou monte a cena em outro canto do mapa. Se
precisar do decaimento real, tire o `--virtual-time-budget` e aceite a espera — foi
essa a escolha da passada 1 de `tools/preview-personagem.mjs`, justamente para o
número de forja não sair zerado.

Detalhe em [[virtual-time-congela-animacao]].

## Armadilha 2 — mouse no vértice do losango

`MouseEvent.clientX` **trunca para inteiro**. Um losango isométrico de 64×32 tem quatro
tiles se encontrando em cada vértice, e `screenToTile` fecha a conta com
`Math.floor` (`src/render/IsoRenderer.ts:458`). Mirar num vértice, portanto, é apostar
em qual dos quatro tiles o arredondamento vai cair — e quando cai no vizinho, parece
bug de conversão de coordenadas.

Não é. A projeção é exata e o round-trip está coberto por teste.

**Mire sempre no CENTRO da célula.** `tileToScreen` devolve o canto **norte** do
losango (`src/render/IsoRenderer.ts:436`), então o centro do tile `(x, y)` é
`tileToScreen(game, x + 0.5, y + 0.5)`. Meio tile de folga em cada direção absorve a
truncagem inteira com sobra.

Detalhe em [[mouse-no-vertice-do-losango]] e a matemática em [[projecao-isometrica]].

## Armadilha 3 — `load` dispara antes da montagem do React

Verificado da pior maneira: um driver que fazia
`document.getElementById('seed').value = …` dentro de `window.addEventListener('load', …)`
morria com `Cannot set properties of null`, silenciosamente abortava o resto do script,
e produzia uma foto do turno 0 com uma semente aleatória — indistinguível, à primeira
vista, de "as teclas não funcionam".

Por isso a receita acima **espera o `#seed` aparecer** em vez de confiar no `load`. Se
a sua sonda não parece fazer nada, é o primeiro suspeito.

## Diagnosticar sem foto

Quando o problema é "o que a página sabe", `--dump-dom` é melhor que `--screenshot`:
imprime o HTML depois de tudo rodar, e você pode fazer a página publicar o que quiser
num atributo.

```bash
google-chrome-stable --headless=new --no-sandbox --disable-gpu \
  --virtual-time-budget=6000 --dump-dom "file://$PWD/sonda.html" \
  | grep -o 'data-diag="[^"]*"'
```

É o mesmo truque da passada 1 de `tools/preview-personagem.mjs`, que lê
`data-bancada`, `data-forja`, `data-quadros` e `data-erro` do DOM. Página que publica
o próprio diagnóstico é página que dá para depurar de fora.

---

Vizinhos: [[rodar-e-buildar]] · [[revisar-o-personagem]] ·
[[fog-of-war-e-iluminacao]] · [[_moc-render-e-arte]]
