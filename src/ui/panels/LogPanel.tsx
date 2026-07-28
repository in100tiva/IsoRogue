/*
 * ISOROGUE — bloco Registro.
 *
 * O vanilla anexava uma <div> por entrada e aparava o excesso (`R.UI.pushLog` /
 * `rebuildLog`). Aqui a lista é declarativa: assinamos a versão do estado e
 * lemos `store.getGame().log` no corpo — o padrão autorizado pelo §4 da
 * docs/ARQUITETURA-REACT.md para dados que não cabem num primitivo.
 *
 * Regras herdadas, sem mudança de comportamento visível:
 *   - no máximo as ÚLTIMAS 200 entradas vão ao DOM (§6 da arquitetura);
 *   - `key` é o índice da entrada NO ARRAY (`inicio + i`), nunca o índice do
 *     recorte — com o índice do recorte, cada linha nova trocaria a identidade
 *     de TODAS as 200. Dito com honestidade: enquanto o registro cresce livre,
 *     esse índice é também o índice absoluto e a identidade é estável; a partir
 *     de `CONFIG.MAX_LOG` (400) o `logMsg` apara o topo, as entradas deslizam
 *     uma posição por linha nova e a chave volta a ser instável. Aceitamos: o
 *     custo é o React atualizar texto e classe nos mesmos <li> (nenhuma
 *     remontagem), e dar identidade real à entrada mudaria o formato de
 *     `LogEntry` — o que esta fase de migração pura proíbe;
 *   - auto-scroll só quando o jogador já estava colado no fim (tolerância de
 *     24 px, como `coladoNoFim`); se ele rolou para trás, o registro não pula.
 */

import { useLayoutEffect, useRef } from 'react';

import type { LogClass } from '../../engine/types';
import { store } from '../../engine/store';
import { useGameVersion } from '../hooks/useGameStore';

/** Teto de linhas no DOM. O registro em memória continua com CONFIG.MAX_LOG. */
const MAX_LINHAS = 200;

const CLASSES_LOG: Record<string, 1> = {
  info: 1, bom: 1, ruim: 1, aviso: 1, sistema: 1
};

/** `classeLog` do vanilla: classe desconhecida cai em 'info'. */
function classeLog(cls: LogClass): string {
  return CLASSES_LOG[cls] ? cls : 'info';
}

function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

export function LogPanel() {
  // Assinatura da versão: qualquer mutação do jogo re-renderiza este bloco.
  useGameVersion();

  const registro = store.getGame().log;
  const inicio = Math.max(0, registro.length - MAX_LINHAS);
  const visiveis = registro.slice(inicio);

  const refCaixa = useRef<HTMLUListElement>(null);
  const refColado = useRef(true);

  // `irParaOFim` do vanilla — depois do DOM pronto e antes da pintura, para
  // não piscar a linha nova no meio da lista.
  useLayoutEffect(() => {
    const caixa = refCaixa.current;
    if (!caixa) return;
    if (refColado.current) caixa.scrollTop = caixa.scrollHeight;
  });

  return (
    <section className="bloco bloco-registro">
      <h2 className="titulo">Registro</h2>
      <ul
        ref={refCaixa}
        id="log"
        className="log"
        role="log"
        aria-live="polite"
        aria-label="Registro da expedição"
        tabIndex={0}
        onScroll={() => {
          const caixa = refCaixa.current;
          if (!caixa) return;
          const alturaTotal = caixa.scrollHeight;
          refColado.current = alturaTotal <= 0
            ? true
            : (alturaTotal - caixa.scrollTop - caixa.clientHeight) <= 24;
        }}
      >
        {visiveis.map((entrada, i) => (
          <li key={inicio + i} className={'log-linha log-' + classeLog(entrada.cls)}>
            <span className="log-turno">{inteiro(entrada.turn)}</span>
            <span className="log-texto">{entrada.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
