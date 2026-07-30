/*
 * ISOROGUE — painel lateral (<aside class="painel">).
 *
 * Ordem dos blocos fixada pela §9 do docs/CONTRACTS.md e por
 * legacy/src-vanilla/shell.html: cabeçalho, vitais, semente, estado do mapa,
 * registro, ajuda. Nada aqui lê o jogo — cada bloco assina o que precisa.
 *
 * A BOLSA (fase 1 dos despojos) é o único bloco que não vem daquela lista: ela
 * entra logo depois dos Vitais porque é a mesma natureza de dado — o que o
 * JOGADOR é e o que o jogador CARREGA ficam juntos, antes de qualquer coisa
 * sobre o andar. Acrescentar um bloco à barra é mudança de contrato de UI, e
 * está declarada aqui e no teste que fixa a ordem (test/ui.test.tsx).
 *
 * A TROCA (fase 2 da economia) é o segundo, e é CONDICIONAL: `TradePanel`
 * devolve `null` a menos que o jogador esteja sobre o mercador ou sobre o
 * caldeirão da estação de alquimia (`game.bancada`). Ele entra logo DEPOIS da
 * bolsa por leitura: quem chega ao balcão lê de cima para baixo "isto é o que
 * eu carrego / isto é o que posso fazer com ele". Como o bloco não existe na
 * maior parte do tempo, a ordem fixada pelo teste é a de sempre — e há um caso
 * próprio para a ordem COM o painel aberto.
 *
 * As MISSÕES (fase 3) são o terceiro bloco fora da lista do §9, e entram
 * ENTRE a bolsa e a troca: a missão é o porquê de carregar, a bolsa é o que se
 * carrega e o balcão é onde isso vira moeda — nessa ordem de leitura. Ao
 * contrário da troca, o `QuestPanel` NUNCA devolve `null`: andar sem contrato
 * mostra a linha "Sem missões neste andar.", porque um quadro de avisos vazio
 * ainda é um quadro de avisos (e um painel que some daria ao jogador um bloco
 * a menos para procurar). A ordem está fixada no teste (test/ui.test.tsx).
 *
 * A única peça de estado desta casca é `forcarAtualizacao`: o painel de semente
 * escreve no registro (mesmas mensagens do vanilla, `registrarCopia` de
 * 70-game.js) sem passar por um comando de jogo, e o `store` — por contrato do
 * §4 — só emite versão em mutação de jogo. Um re-render da barra faz o
 * `LogPanel` reler `store.getGame().log` no mesmo instante, como o
 * `R.UI.pushLog` fazia. Sem isso a linha "Semente copiada: …" só apareceria na
 * próxima ação do jogador.
 */

import { useReducer } from 'react';

import { BagPanel } from './panels/BagPanel';
import { Header } from './panels/Header';
import { HelpPanel } from './panels/HelpPanel';
import { LogPanel } from './panels/LogPanel';
import { MapStats } from './panels/MapStats';
import { QuestPanel } from './panels/QuestPanel';
import { SeedPanel } from './panels/SeedPanel';
import { TradePanel } from './panels/TradePanel';
import { Vitals } from './panels/Vitals';

export function Sidebar() {
  const [, forcarAtualizacao] = useReducer((n: number) => n + 1, 0);

  return (
    <aside className="painel">
      <Header />
      <Vitals />
      <BagPanel />
      <QuestPanel />
      <TradePanel />
      <SeedPanel aoRegistrar={forcarAtualizacao} />
      <MapStats />
      <LogPanel />
      <HelpPanel />
    </aside>
  );
}
