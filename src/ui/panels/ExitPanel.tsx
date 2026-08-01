/*
 * ISOROGUE — bloco Saída do andar (a bússola da escada).
 *
 * POR QUE ESTE BLOCO EXISTE. A descida sempre funcionou — `>` / Enter sobre o
 * tile de escada, ou o clique nele (usePointer) — e a escada é sempre
 * alcançável a pé: o portão de R15/R16 vive em `generate()` e o filtro de
 * articulação de `populate()` impede que mercador, caldeirão ou decoração
 * tranquem o andar. Medido em 200 andares do primeiro nível: ZERO escadas
 * presas. O que faltava não era a mecânica, era o JOGADOR SABER PARA ONDE IR:
 * o mapa tem 45×45, o campo de visão tem raio 9 e a escada nasce a 30 tiles do
 * início em média (máximo medido: 36). Sem nada apontando, achar a saída era
 * varrer a masmorra tile a tile — e o dono, jogando, não achava.
 *
 * É o mesmo defeito que criou a fase 2.1 dos pontos de parada, com as mesmas
 * palavras: conteúdo que não se descobre é conteúdo que não existe.
 *
 * ONDE ELE FICA, e por que não junto do "Estado do mapa". A ordem do painel é
 * contrato (§9 do docs/CONTRACTS.md, fixada em test/ui.test.tsx), e o lugar
 * "temático" deste bloco seria colado no Estado do mapa — no rodapé da barra,
 * abaixo do balcão e da bolsa. Seria enterrar a cura do problema no mesmo lugar
 * onde o problema mora. Ele entra logo depois dos VITAIS, que é o primeiro
 * bloco que o jogador lê: para onde eu vou é da mesma natureza de quanto de
 * vida eu tenho — decisão do turno, não estatística do andar.
 *
 * O QUE ELE MOSTRA:
 *   · DIREÇÃO — o octante da grade em que a escada está, com a TECLA daquela
 *     direção ao lado ('sudeste (C)'). A tecla é o que desfaz a única
 *     ambiguidade real da bússola: o mundo é desenhado em isométrico, então o
 *     'norte' da grade não é o topo da tela. Quem lê a tecla não precisa
 *     traduzir nada — segura a tecla e anda.
 *   · PASSOS — o valor do campo de Dijkstra do jogador no tile da escada, que é
 *     o número REAL de passos pelo caminho mais curto (contornando parede, água
 *     e vazio), não a distância em linha reta. É o mesmo número que o balão de
 *     criatura já mostra na linha 'Dijkstra' — nenhuma informação nova entra no
 *     jogo por este bloco, ela só deixa de estar escondida.
 *
 * Nada aqui é estado de React: o bloco assina a versão do store e lê o jogo
 * direto, que é o caminho 2 da REGRA DURA DO SELETOR (useGameStore.ts) — são
 * quatro leituras derivadas do mesmo par (jogador, escada), e quatro
 * `useGameValue` fariam a mesma conta quatro vezes.
 */

import { store } from '../../engine/store';
import { dirIndex, idx } from '../../engine/core';
import { DIJKSTRA_INF } from '../../engine/dijkstra';
import { Tile } from '../../engine/types';
import { useGameVersion } from '../hooks/useGameStore';

/**
 * Nome e tecla de cada direção, na ORDEM DE `DIRS8` (core.ts): leste, sudeste,
 * sul, sudoeste, oeste, noroeste, norte, nordeste.
 *
 * As teclas são as de `MOVE_KEY` (useKeyboard.ts) e a correspondência é exata
 * porque as duas tabelas falam da mesma grade: `w` é `[0, -1]`, que é o norte
 * de `DIRS8`. Se um dia o mapa de teclas mudar, esta coluna muda junto — ela é
 * uma legenda do teclado, não uma verdade do domínio.
 */
const BUSSOLA: readonly { nome: string; tecla: string }[] = [
  { nome: 'leste', tecla: 'D' },
  { nome: 'sudeste', tecla: 'C' },
  { nome: 'sul', tecla: 'S' },
  { nome: 'sudoeste', tecla: 'Z' },
  { nome: 'oeste', tecla: 'A' },
  { nome: 'noroeste', tecla: 'Q' },
  { nome: 'norte', tecla: 'W' },
  { nome: 'nordeste', tecla: 'E' }
];

/**
 * Cotangente de 22,5° — a fronteira entre "reto" e "diagonal".
 *
 * O octante é escolhido por comparação de proporção, e não por ângulo: um eixo
 * só apaga o outro quando é mais de `COT_225` vezes maior, o que é exatamente
 * dizer "o vetor está a menos de 22,5° daquele eixo". Sem isso, um alvo a
 * (30, 1) sairia como 'sudeste' — tecnicamente verdade, e inútil para quem tem
 * de andar trinta tiles para leste.
 */
const COT_225 = 2.414213562373095;

/** O índice de `DIRS8` do octante em que (dx, dy) cai; −1 quando é o próprio tile. */
function octante(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return -1;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let ex = Math.sign(dx);
  let ey = Math.sign(dy);
  if (ax > ay * COT_225) ey = 0;
  else if (ay > ax * COT_225) ex = 0;
  return dirIndex(ex, ey);
}

export function ExitPanel() {
  useGameVersion();
  const g = store.getGame();
  const escada = g.map.stairs;

  const dx = escada.x - g.player.x;
  const dy = escada.y - g.player.y;
  const naEscada = dx === 0 && dy === 0;
  const dir = octante(dx, dy);
  const bussola = dir >= 0 && dir < BUSSOLA.length ? BUSSOLA[dir] : null;

  /* Os passos saem do campo de Dijkstra do jogador (o mesmo `g.dmap` do balão de
   * criatura). `DIJKSTRA_INF` é o "não cheguei lá" do campo — não acontece com o
   * gerador de hoje, mas um mapa carregado de fora pode trazê-lo, e um número de
   * cinco dígitos na tela seria pior do que uma palavra honesta. */
  const bruto = g.dmap ? g.dmap[idx(g.map.w, escada.x, escada.y)] : DIJKSTRA_INF;
  const alcancavel = typeof bruto === 'number' && bruto >= 0 && bruto < DIJKSTRA_INF;

  /* A escada é o único tile de escada do andar, então `map.stairs` já bastaria;
   * a conferência contra o tile é a mesma disciplina de `tentarDescer` (game.ts),
   * que também não confia na coordenada e sim no terreno. */
  const temEscada = g.map.tiles[idx(g.map.w, escada.x, escada.y)] === Tile.Stairs;

  let direcao: string;
  if (!temEscada) direcao = '—';
  else if (naEscada) direcao = 'você está nela';
  else if (bussola) direcao = bussola.nome + ' (' + bussola.tecla + ')';
  else direcao = '—';

  let passos: string;
  if (!temEscada) passos = '—';
  else if (naEscada) passos = '0';
  else if (alcancavel) passos = String(bruto);
  else passos = 'sem rota';

  return (
    <section className="bloco">
      <h2 className="titulo">Saída do andar</h2>
      <dl className="tabela">
        <div className="tabela-linha">
          <dt>Direção</dt>
          <dd id="saida-direcao" className={naEscada ? 'valor-otimo' : undefined}>
            {direcao}
          </dd>
        </div>
        <div className="tabela-linha">
          <dt>Passos</dt>
          <dd id="saida-passos" className={naEscada ? 'valor-otimo' : undefined}>
            {passos}
          </dd>
        </div>
      </dl>
      <p className="saida-dica" id="saida-dica">
        {naEscada
          ? 'Pressione > ou Enter para descer ao andar ' + (g.depth + 1) + '.'
          : 'A escada leva ao andar ' + (g.depth + 1) + ', com monstros um nível acima.'}
      </p>
    </section>
  );
}
