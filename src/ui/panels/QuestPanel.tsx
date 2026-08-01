/*
 * ISOROGUE — bloco Missões (fase 3 do sistema de itens).
 *
 * O quadro de caçadas do andar: o que o mercador pediu, quanto falta e onde
 * se entrega. Lê `game.missoes` (types.ts §6.5) — 1 a 3 missões por andar,
 * geradas por `populate` — e despacha `{ kind: 'entregar' }`, a quarta ação
 * do balcão, aceita pelo engine AO LADO do mercador (a mesma régua `aoLadoDa`
 * da fase 2.2, Chebyshev ≤ 1).
 *
 * ─────────────── PRONTA É PREDICADO DERIVADO, NÃO CAMPO ───────────────
 * A tentação é ler a prontidão de `m.completa`. Ela NÃO está lá: no modelo do
 * engine, `completa` e `entregue` nascem JUNTOS no comando `entregar` —
 * fechou as duas partes, recebeu a recompensa (types.ts, docblock de
 * `Missao`). Uma caçada com o abate feito e os despojos na bolsa, ainda não
 * entregue, tem `completa: false`.
 *
 * Por isso este painel calcula a prontidão com o MESMO predicado do engine
 * (`missaoPronta`, game.ts):
 *
 *     !m.completa && progressoMatar >= matar && despojosDaMissaoNaBolsa >= entregar
 *
 * A conta da bolsa soma os tipos de `m.itens`, como `totalDaEntregaNaBolsa`
 * faz. Usar o mesmo predicado é o que garante que o botão Entregar nunca
 * promete uma entrega que o engine recusaria — a interface não é a
 * autoridade, é o teclado bonito, mas não pode mentir.
 *
 * ──────────────────────── OS ESTADOS VISUAIS ────────────────────────
 * O desenho pede quatro estados; o modelo resolve em TRÊS linhas, porque
 * `completa` e `entregue` são gêmeas (ver acima) — "completa" e "entregue" é
 * uma coisa só na tela:
 *
 *   · A FAZER — a linha comum: nome, progresso de abate X/Y, progresso de
 *     entrega e a recompensa anunciada;
 *   · PRONTA (predicado acima) — a marca âmbar de "ponto quente" (a mesma
 *     borda esquerda do cabeçalho e do balcão), o aviso 'Pronta! Vá ao
 *     mercador.' e o botão Entregar — habilitado só AO LADO do mercador,
 *     desabilitado com a dica 'Vá até o mercador' quando longe;
 *   · ENTREGUE (`m.entregue`) — a linha esmaecida, com o nome riscado e o
 *     selo discreto '✓ Entregue' no lugar do botão. Ela NÃO some da lista:
 *     a linha que acabou de pagar é a confirmação de que pagou.
 *
 * ─────────────────── O QUE O PAINEL NÃO FAZ ───────────────────
 * Nenhuma regra de jogo. Quem decide se a entrega vale, paga a recompensa e
 * narra é o engine; aqui só se LÊ `game.missoes` e se DESPACHA o comando. O
 * ALVO sai em texto (`ARCHETYPES[alvo].nome`), sem retrato: o sprite do
 * monstro vive no atlas de canvas do `IsoRenderer`, e trazê-lo para a barra
 * seria um `<canvas>` por linha — a mesma omissão deliberada da Bolsa.
 *
 * A contagem MOSTRADA é cortada no exigido (o predicado usa o valor cru):
 * carregar 5 orelhas para uma entrega de 2 lê '2 de 2', não '5 de 2' — o que
 * interessa é o que falta, e nada falta. O progresso de abate recebe o mesmo
 * corte.
 *
 * Padrão de leitura: `useGameVersion()` + leitura direta de `store.getGame()`,
 * o caminho 2 autorizado pela §4 da docs/ARQUITETURA-REACT.md (a REGRA DURA
 * DO SELETOR em hooks/useGameStore.ts proíbe um seletor que monte estas
 * linhas — devolveria um array novo a cada render).
 */

import { ARCHETYPES, ITENS } from '../../engine/entities';
import { store } from '../../engine/store';
import type { Bag, MaterialKind, Missao, Point } from '../../engine/types';
import { useGameVersion } from '../hooks/useGameStore';

/** `inteiro()` de legacy/src-vanilla/60-ui.js: não-finito vira 0. */
function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * O jogador está AO LADO (Chebyshev ≤ 1) do ponto? Mesma regra `aoLadoDa` do
 * TradePanel (fase 2.2) e do engine na conferência do `entregar`, repetida
 * aqui como o projeto repete `inteiro()` entre os painéis — ajuda de seis
 * linhas não vira módulo.
 */
function aoLadoDa(p: Point, ponto: Point | null): boolean {
  if (!ponto) return false;
  const dx = Math.abs(p.x - ponto.x);
  const dy = Math.abs(p.y - ponto.y);
  return (dx > dy ? dx : dy) <= 1;
}

/**
 * Quantos dos itens pedidos a bolsa tem, SOMANDO os tipos da missão — a mesma
 * conta de `totalDaEntregaNaBolsa` (game.ts): a entrega é um total ('2
 * despojos de goblin'), não uma linha por tipo.
 */
function contarNaBolsa(bag: Bag, itens: MaterialKind[]): number {
  let n = 0;
  for (let i = 0; i < itens.length; i++) {
    n += Math.max(0, inteiro(bag[itens[i]] || 0));
  }
  return n;
}

/**
 * '20 moedas' · '20 moedas + 1 cimitarra de goblin' — a recompensa anunciada
 * ANTES da entrega: caçada que não diz o que paga é favor, não contrato. O
 * nome e o plural saem de `ITENS`, a mesma fonte da Bolsa e do balcão.
 */
function recompensaEmTexto(m: Missao): string {
  const partes: string[] = [];
  const moedas = Math.max(0, inteiro(m.recompensaMoedas));
  if (moedas > 0) partes.push(moedas === 1 ? '1 moeda' : moedas + ' moedas');
  const item = m.recompensaItem;
  if (item && item.n > 0) {
    const def = ITENS[item.kind];
    if (def) partes.push(item.n === 1 ? '1 ' + def.nome : item.n + ' ' + def.plural);
  }
  return partes.length > 0 ? partes.join(' + ') : '—';
}

function LinhaMissao({ m, bag, perto }: { m: Missao; bag: Bag; perto: boolean }) {
  const exigidoAbates = Math.max(0, inteiro(m.matar));
  const exigidoItens = Math.max(0, inteiro(m.entregar));
  const abatesFeitos = Math.max(0, inteiro(m.progressoMatar));
  const naBolsa = contarNaBolsa(bag, m.itens);

  /* O predicado da prontidão, igual ao `missaoPronta` do engine (ver o
   * cabeçalho) — NÃO ler de `m.completa`, que só nasce na entrega. */
  const pronta = !m.completa && abatesFeitos >= exigidoAbates && naBolsa >= exigidoItens;

  /* Cortados no exigido para MOSTRAR (o predicado usou os valores crus): o
   * que passa da meta não é mérito, é bolsa cheia. */
  const abates = Math.min(abatesFeitos, exigidoAbates);
  const temNaBolsa = Math.min(naBolsa, exigidoItens);
  const idAviso = 'missao-aviso-' + m.key;

  let classe = 'tabela-linha';
  if (pronta) classe += ' missao-pronta';
  if (m.entregue) classe += ' missao-entregue';

  return (
    <div className={classe} id={'missao-' + m.key}>
      <dt>
        <span className="bolsa-nome">{m.nome}</span>
        {/* Caçada só de coleta (`matar` no piso 0) não tem linha de abate —
            mostrar '0/0 abates' seria ruído. A geração atual impõe piso 1,
            mas o painel não depende disso. */}
        {exigidoAbates > 0 ? (
          <span className="bolsa-preco" id={'missao-abates-' + m.key}>
            {abates + '/' + exigidoAbates + ' abates · ' + ARCHETYPES[m.alvo].nome}
          </span>
        ) : null}
        {exigidoItens > 0 ? (
          <span className="bolsa-preco" id={'missao-bolsa-' + m.key}>
            {'bolsa: ' + temNaBolsa + ' de ' + exigidoItens + ' itens'}
          </span>
        ) : null}
        <span className="bolsa-preco" id={'missao-recompensa-' + m.key}>
          {'Recompensa: ' + recompensaEmTexto(m)}
        </span>
        {pronta ? (
          <span className="troca-falta" id={idAviso}>Pronta! Vá ao mercador.</span>
        ) : null}
      </dt>
      {pronta ? (
        <dd className="troca-acoes">
          <button
            type="button"
            id={'entregar-' + m.key}
            className="botao botao-mini botao-primario"
            disabled={!perto}
            title={perto ? undefined : 'Vá até o mercador'}
            aria-describedby={perto ? undefined : idAviso}
            aria-label={'Entregar a caçada ' + m.nome + ' ao mercador'}
            onClick={() => {
              /* Sem carga — não existe 'entregar:abate-chaser': o comando
               * varre TODAS as caçadas prontas na ordem de geração (ver
               * `Command` em types.ts e `entregar` em game.ts). */
              store.dispatch({ kind: 'entregar' });
            }}
          >
            Entregar
          </button>
        </dd>
      ) : null}
      {m.entregue ? (
        <dd>
          <span className="missao-selo" id={'missao-selo-' + m.key}>✓ Entregue</span>
        </dd>
      ) : null}
    </div>
  );
}

export function QuestPanel() {
  // Assinatura da versão: abater, recolher e entregar mutam o jogo, e o painel
  // inteiro relê `store.getGame()` no mesmo instante.
  useGameVersion();

  const g = store.getGame();
  /* `missoes` é `Missao[]` por contrato (createState/restore sempre o
   * preenchem); o `|| []` é a mesma defesa que o próprio `entregar` do engine
   * faz — custa nada e não depende de save velho. */
  const missoes = g.missoes || [];
  const p = g.player;
  const bag = p.bag || {};
  /* Calculado uma vez para a lista inteira: a distância é do JOGADOR ao
   * mercador, não da missão — dois botões prontos obedecem à mesma régua. */
  const pertoDoMercador = aoLadoDa(p, g.mercador);

  return (
    <section
      className="bloco"
      id="missoes"
      onKeyDown={(ev) => {
        /* A mesma barreira do balcão: Enter e Espaço ativam o botão em foco
         * (nativo) e, sem isto, subiriam ao ouvinte global onde Enter é
         * 'descer' e Espaço é 'esperar' — dois turnos por clique. */
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.stopPropagation();
        }
      }}
    >
      <h2 className="titulo">Missões</h2>
      {missoes.length === 0 ? (
        /* Nunca um painel em branco: andar sem contrato também é informação. */
        <p className="nota" id="missoes-vazia">Sem missões neste andar.</p>
      ) : (
        <dl className="tabela" id="lista-missoes">
          {/*
            A CHAVE É O ÍNDICE, e de propósito — `m.key` NÃO serve.

            `MissaoKey` não é única por partida (está escrito no tipo, em
            types.ts): as caçadas são geradas POR ANDAR e ATRAVESSAM a descida,
            então uma 'abate-chaser' do andar 1 convive com a do andar 2 na
            mesma lista. Com `key={m.key}` o React reclamava de chave duplicada
            no primeiro andar que repetisse um arquétipo — e como a lista é
            APPEND-ONLY na ordem de geração (`descend` concatena, nunca reordena
            nem remove), o índice é estável: a missão de posição 3 continua
            sendo a mesma missão para sempre. É o caso raro em que o índice não
            é preguiça, e sim a identidade real do item.
          */}
          {missoes.map((m, i) => (
            <LinhaMissao key={i} m={m} bag={bag} perto={pertoDoMercador} />
          ))}
        </dl>
      )}
    </section>
  );
}
