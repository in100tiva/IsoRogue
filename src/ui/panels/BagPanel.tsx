/*
 * ISOROGUE — bloco Bolsa (fase 1 dos despojos).
 *
 * O que o jogador CARREGA, que até esta fase não tinha onde ser visto: o
 * registro anunciava "Você recolhe 2 orelhas de goblin (5 no total)" e o total
 * sumia da tela na linha seguinte. Um item que só existe no registro é um item
 * que o jogador esquece que tem.
 *
 * DE ONDE VEM O DADO — e por que não há um único número escrito aqui:
 *   - a lista e a ORDEM saem de `ITEM_KINDS` (src/engine/entities.ts), a mesma
 *     tabela que ordena o `snapshot()`, o save e as linhas de coleta. Ler a
 *     bolsa por `Object.keys` daria uma ordem acidental que mudaria entre
 *     partidas — o objeto é aberto de propósito (ver `Bag` em types.ts);
 *   - nome, plural e preço saem de `ITENS[kind]`. Este arquivo não sabe que
 *     uma clava vale 40 moedas, e é assim que rebalancear preço não passa por
 *     aqui;
 *   - as QUANTIDADES saem de `player.bag` (materiais) e de `player.potions`
 *     (a poção, contrato antigo R7 — ela nunca entrou na bolsa).
 *
 * O `valor` unitário aparece embora NADA nesta fase compre ou venda: é a fase 2
 * que traz o mercador. Está na tela porque é o que responde "por que eu
 * carregaria isto?" — sem o preço, um pé de ogro é lixo com nome bonito.
 *
 * Sem ÍCONE, e a omissão é deliberada: o sprite do despojo vive num atlas de
 * canvas forjado pelo `IsoRenderer` (src/render/spriteForge.ts), e trazê-lo
 * para cá significaria um `<canvas>` por linha na barra lateral, com forja,
 * ciclo de vida e degradação sem contexto 2D — arquitetura nova para um
 * enfeite. Fica para a fase 2, junto com o mercador, se ainda fizer falta.
 *
 * Padrão de leitura: `useGameVersion()` + leitura direta de `store.getGame()`,
 * o caminho 2 autorizado pela §4 da docs/ARQUITETURA-REACT.md. Um seletor por
 * item devolveria uma lista nova a cada render e derrubaria a aplicação em laço
 * (a REGRA DURA DO SELETOR, em hooks/useGameStore.ts).
 */

import { ITENS, ITEM_KINDS, ehMaterial } from '../../engine/entities';
import { store } from '../../engine/store';
import type { ItemKind } from '../../engine/types';
import { useGameVersion } from '../hooks/useGameStore';

/** `inteiro()` de legacy/src-vanilla/60-ui.js: não-finito vira 0. */
function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Os nomes de `ITENS` são minúsculos porque nasceram para compor FRASE ('Você
 * recolhe uma orelha de goblin'). Numa tabela eles são RÓTULO, e rótulo desta
 * barra começa em maiúscula ('Conectividade', 'Salas'). A capitalização é de
 * apresentação e mora aqui — a tabela do engine continua sendo a fonte do nome.
 */
function comoRotulo(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Uma linha pronta da bolsa. Montada no corpo do componente, nunca memoizada. */
interface LinhaBolsa {
  kind: ItemKind;
  nome: string;
  quantidade: number;
  /** Preço unitário em moedas; 0 = não precificado (a poção). */
  valor: number;
}

export function BagPanel() {
  // Assinatura da versão: qualquer mutação do jogo re-renderiza este bloco.
  useGameVersion();

  const p = store.getGame().player;
  const linhas: LinhaBolsa[] = [];

  /* A varredura é por `ITEM_KINDS`, que abre com 'potion' — é dela que sai, de
   * graça, o "poções primeiro" do desenho, sem uma linha de ordenação aqui. */
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    const def = ITENS[kind];
    if (!def) continue;
    const n = ehMaterial(kind)
      ? Math.max(0, inteiro(p.bag ? p.bag[kind] || 0 : 0))
      : Math.max(0, inteiro(p.potions));
    /* Só o que ele TEM. Uma linha "0 clavas de ogro" seria ruído permanente:
     * a bolsa mostra o espólio, não o catálogo. */
    if (n <= 0) continue;
    linhas.push({
      kind: kind,
      nome: comoRotulo(n > 1 ? def.plural : def.nome),
      quantidade: n,
      valor: def.valor
    });
  }

  return (
    <section className="bloco">
      <h2 className="titulo">Bolsa</h2>
      {linhas.length === 0 ? (
        /* Nunca um painel em branco: o vazio também é informação, e dito assim
         * ele ensina que existe uma bolsa para encher. */
        <p className="nota" id="bolsa-vazia">A bolsa está vazia.</p>
      ) : (
        <dl className="tabela" id="bolsa">
          {linhas.map((l) => (
            <div className="tabela-linha" key={l.kind}>
              <dt>
                <span className="bolsa-nome">{l.nome}</span>
                {/* Preço unitário — reservado à venda da fase 2. Sem preço
                    declarado (a poção), o traço diz "não precificado", que é
                    diferente de "de graça". */}
                <span className="bolsa-preco">
                  {l.valor > 0 ? l.valor + ' moedas cada' : '—'}
                </span>
              </dt>
              <dd id={'bolsa-' + l.kind}>{l.quantidade}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
