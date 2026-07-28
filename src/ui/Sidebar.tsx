/*
 * ISOROGUE — painel lateral (<aside class="painel">).
 *
 * Ordem dos blocos fixada pela §9 do docs/CONTRACTS.md e por
 * legacy/src-vanilla/shell.html: cabeçalho, vitais, semente, estado do mapa,
 * registro, ajuda. Nada aqui lê o jogo — cada bloco assina o que precisa.
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

import { Header } from './panels/Header';
import { HelpPanel } from './panels/HelpPanel';
import { LogPanel } from './panels/LogPanel';
import { MapStats } from './panels/MapStats';
import { SeedPanel } from './panels/SeedPanel';
import { Vitals } from './panels/Vitals';

export function Sidebar() {
  const [, forcarAtualizacao] = useReducer((n: number) => n + 1, 0);

  return (
    <aside className="painel">
      <Header />
      <Vitals />
      <SeedPanel aoRegistrar={forcarAtualizacao} />
      <MapStats />
      <LogPanel />
      <HelpPanel />
    </aside>
  );
}
