/*
 * ISOROGUE — bloco Troca: o BALCÃO do mercador e a ESTAÇÃO DE ALQUIMIA
 * (fase 2 do sistema de itens).
 *
 * ─────────────────────────── QUANDO APARECE ───────────────────────────
 * Só quando o jogador está EXATAMENTE sobre `game.mercador` ou sobre
 * `game.bancada`. Fora disso o componente devolve `null` e a barra lateral
 * volta a ter os blocos de sempre — não há painel vazio, não há aba, não há
 * botão de abrir.
 *
 * A razão é de regra, não de estética: o engine recusa `vender`, `comprar` e
 * `criar` fora do tile certo (`sobreOPonto` em src/engine/game.ts), e cada
 * recusa custa uma linha de registro em 'aviso'. Um painel que estivesse
 * sempre na tela seria um painel cujos botões, na maior parte do tempo, só
 * sabem escrever "Não há mercador aqui." — e a interface estaria ensinando o
 * jogador a ignorar um bloco inteiro. Aparecer é a mensagem: você CHEGOU.
 *
 * ───────────── O QUE `game.bancada` É, DESDE A FASE 2.1 ─────────────
 * O CALDEIRÃO — o tile de interação de uma instalação de até três tiles
 * (caldeirão, estante e mesa; ver `Game.alquimiaExtras` em types.ts e o rig em
 * src/render/characters/alquimia.ts). Os outros dois tiles são CENÁRIO: não
 * abrem painel nenhum, porque não há comando nenhum sobre eles.
 *
 * O nome do campo continua `bancada` de propósito — ele é contrato de
 * `snapshot()`, do save, do render e desta interface. O que mudou aqui foi só o
 * TEXTO que o jogador lê: quem chega vê um caldeirão fumegando ao lado de uma
 * estante de frascos, e chamar aquilo de "bancada" seria a tela discordando da
 * imagem. Os dois ofícios (alquimia no caldeirão, refino na bigorna que o
 * engine narra) continuam exatamente os mesmos, no mesmo tile.
 *
 * ────────────────────── COMO ESCOLHE ENTRE OS DOIS ─────────────────────
 * `modoDaParada()` compara `player.x/y` com os dois pontos e devolve
 * `'mercador'`, `'bancada'` ou `null`. A ordem é um desempate que nunca
 * acontece: `populate` reserva o tile do mercador ANTES de sortear o caldeirão
 * (ver `escolherParada`, src/engine/entities.ts), então os dois pontos não
 * coincidem — e é justamente por isso que declarar a precedência custa nada e
 * torna o painel uma função pura do estado, sem "e se os dois?".
 *
 * ──────────────────────────── O QUE NÃO FAZ ────────────────────────────
 * Nenhuma regra de jogo. Este arquivo não sabe quanto vale uma clava, não sabe
 * que três gosmas viram uma poção e não escreve UM byte no `Game`:
 *
 *   - preço, nome e plural saem de `ITENS[kind]`;
 *   - as receitas, o custo e o texto do que produzem saem de `RECEITAS`;
 *   - o que FALTA para uma receita sai de `faltasDaReceita(bag, custo)` — a
 *     mesma função que o engine usa para escrever a linha de recusa, então a
 *     tela e o registro nunca podem discordar;
 *   - o teto do refino sai de `ARMA_NIVEL_MAX`;
 *   - toda ação é um `store.dispatch(...)`. É o engine que valida, consome o
 *     turno e narra. Se o botão estava errado, a recusa aparece no registro —
 *     a interface não é a autoridade, é o teclado bonito.
 *
 * "VENDER TUDO" é o único lugar onde a interface pensa: o protocolo NÃO aceita
 * `'vender:gosma,tudo'` (ver `Command` em types.ts — quem sabe quanto há na
 * bolsa na hora do clique é a tela). Então o botão manda o NÚMERO exato,
 * limitado por `QUANTIDADE_MAX` como manda o contrato.
 *
 * Padrão de leitura: `useGameVersion()` + leitura direta de `store.getGame()`,
 * o caminho 2 autorizado pela §4 da docs/ARQUITETURA-REACT.md. Um seletor que
 * montasse a lista de linhas devolveria um array novo a cada render e
 * derrubaria a aplicação em laço (a REGRA DURA DO SELETOR em
 * hooks/useGameStore.ts).
 */

import { QUANTIDADE_MAX } from '../../engine/core';
import {
  ARMA_NIVEL_MAX,
  ITENS,
  ITEM_KINDS,
  POTION_HEAL,
  PRECO_POCAO,
  RECEITAS,
  RECEITA_KINDS,
  ehMaterial,
  faltasDaReceita
} from '../../engine/entities';
import type { ItemDef } from '../../engine/entities';
import { store } from '../../engine/store';
import type { CustoReceita, Game, MaterialKind, Point } from '../../engine/types';
import { useGameVersion } from '../hooks/useGameStore';

/**
 * Os dois ofícios do balcão. Nada mais entra nesta união sem entrar no engine.
 *
 * `'bancada'` é o nome do CAMPO (`game.bancada`), não o do móvel: a peça que o
 * jogador vê nesse tile é o caldeirão da estação de alquimia. Ver o cabeçalho.
 */
type ModoTroca = 'mercador' | 'bancada';

/** `inteiro()` de legacy/src-vanilla/60-ui.js: não-finito vira 0. */
function inteiro(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Capitalização de RÓTULO. Os nomes de `ITENS` são minúsculos porque nasceram
 * para compor frase ('Você recolhe uma orelha de goblin'); numa tabela desta
 * barra eles são rótulo, e rótulo começa em maiúscula. Mesma decisão (e mesma
 * função) do BagPanel — a tabela do engine continua sendo a fonte do nome.
 */
function comoRotulo(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** 'uma poção' / '3 frascos de gosma' — a concordância vem da ficha do item. */
function quantiaDeItem(def: ItemDef, n: number): string {
  if (n === 1) return (def.fem ? 'uma ' : 'um ') + def.nome;
  return n + ' ' + def.plural;
}

/** Moedas por extenso, com o plural concordando ('1 moeda', '15 moedas'). */
function moedasEmTexto(n: number): string {
  return n === 1 ? '1 moeda' : n + ' moedas';
}

/**
 * O custo de uma receita em pt-BR, varrido pela ordem de `ITEM_KINDS` — jamais
 * por `Object.keys`, que numa `CustoReceita` (objeto aberto) daria ordem
 * acidental. É a mesma varredura de `custoEmTexto` no engine.
 */
function custoEmTexto(custo: CustoReceita): string {
  const partes: string[] = [];
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const n = custo[kind] || 0;
    if (n > 0) partes.push(quantiaDeItem(ITENS[kind], n));
  }
  return listaEmTexto(partes);
}

/** 'a', 'a e b', 'a, b e c' — o mesmo conector do registro. */
function listaEmTexto(partes: string[]): string {
  if (partes.length === 0) return 'nada';
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
}

/**
 * 'Falta uma cimitarra de goblin.' × 'Faltam 2 cimitarras de goblin.'
 *
 * O verbo concorda com a QUANTIA que falta, não com o número de linhas da
 * falta — 'Falta 2 cimitarras' é erro de português num texto que o jogador lê
 * toda hora. É a mesma regra (e a mesma frase) que o engine escreve no registro
 * quando recusa a receita; as duas não podem divergir.
 */
function faltaEmTexto(partes: string[], plural: boolean): string {
  return 'Falta' + (plural ? 'm' : '') + ' ' + listaEmTexto(partes) + '.';
}

/**
 * O jogador está AO LADO (Chebyshev ≤ 1) do ponto? Móvel e NPC são sólidos
 * desde a fase 2.2, então interagir é encostar, nunca pisar.
 */
function aoLadoDa(p: Point, ponto: Point | null): boolean {
  if (!ponto) return false;
  const dx = Math.abs(p.x - ponto.x);
  const dy = Math.abs(p.y - ponto.y);
  return (dx > dy ? dx : dy) <= 1;
}

/**
 * O jogador está ao lado de ALGUMA peça da estação de alquimia? Ela é uma
 * coisa só de três tiles — o painel abre a partir de qualquer uma.
 */
function aoLadoDaEstacao(g: Game): boolean {
  const p = g.player;
  if (aoLadoDa(p, g.bancada)) return true;
  const extras = g.alquimiaExtras;
  if (extras) {
    for (let i = 0; i < extras.length; i++) {
      if (aoLadoDa(p, extras[i])) return true;
    }
  }
  return false;
}

/**
 * Em que balcão o jogador está — a única decisão de estado deste arquivo.
 * Se por acaso ele estiver ao lado dos dois, o mercador tem precedência: a
 * regra é declarada, determinística, e na prática inofensiva porque o
 * populate reserva os tiles de forma que eles não se tocam.
 */
function modoDaParada(g: Game): ModoTroca | null {
  const p = g.player;
  if (!p) return null;
  if (aoLadoDa(p, g.mercador)) return 'mercador';
  if (aoLadoDaEstacao(g)) return 'bancada';
  return null;
}

/* ------------------------------------------------------------------ *
 * O balcão do MERCADOR
 * ------------------------------------------------------------------ */

/** Uma linha vendável: o que há na bolsa, com o preço que ele paga. */
interface LinhaVenda {
  kind: MaterialKind;
  nome: string;
  quantidade: number;
  /** Preço UNITÁRIO em moedas (`ITENS[kind].valor`). */
  valor: number;
  /** Quanto o botão "tudo" manda — a bolsa inteira, limitada pelo contrato. */
  lote: number;
}

function BlocoMercador({ game }: { game: Game }) {
  const p = game.player;
  const moedas = Math.max(0, inteiro(p.moedas));
  const linhas: LinhaVenda[] = [];

  /* Varredura por `ITEM_KINDS`: a ordem da bolsa é a mesma do `snapshot()`, do
   * save e do BagPanel. A poção fica de fora sozinha — `ehMaterial` a recusa, e
   * é o mesmo motivo pelo qual o mercador não a compra (ela é o que ele VENDE). */
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (!ehMaterial(kind)) continue;
    const def = ITENS[kind];
    if (!def) continue;
    const n = Math.max(0, inteiro(p.bag ? p.bag[kind] || 0 : 0));
    if (n <= 0) continue;
    linhas.push({
      kind: kind,
      nome: comoRotulo(n > 1 ? def.plural : def.nome),
      quantidade: n,
      valor: def.valor,
      /* O contrato limita a 99 por comando (`QUANTIDADE_MAX`). Uma bolsa maior
       * que isso vende em duas idas ao balcão — e paga dois turnos, que é
       * exatamente o que o limite quer dizer. */
      lote: Math.min(n, QUANTIDADE_MAX)
    });
  }

  const podeComprar = moedas >= PRECO_POCAO;
  const faltaMoeda = Math.max(0, PRECO_POCAO - moedas);
  const motivoCompra = podeComprar ? '' : faltaEmTexto([moedasEmTexto(faltaMoeda)], faltaMoeda > 1);

  return (
    <>
      <p className="nota" id="troca-nota">
        Ele avalia a bolsa e paga em moedas. Cada negócio custa um turno.
      </p>

      {linhas.length === 0 ? (
        <p className="nota" id="troca-sem-material">
          Você não carrega nada que o mercador compre.
        </p>
      ) : (
        <dl className="tabela" id="troca-venda">
          {linhas.map((l) => (
            <div className="tabela-linha" key={l.kind}>
              <dt>
                <span className="bolsa-nome">{l.nome}</span>
                <span className="bolsa-preco">
                  {l.valor} {l.valor === 1 ? 'moeda' : 'moedas'} cada · {l.quantidade} na bolsa
                </span>
              </dt>
              <dd className="troca-acoes">
                <button
                  type="button"
                  id={'vender-' + l.kind}
                  className="botao botao-mini"
                  aria-label={
                    'Vender ' + quantiaDeItem(ITENS[l.kind], 1) +
                    ' por ' + moedasEmTexto(l.valor)
                  }
                  onClick={() => {
                    store.dispatch({ kind: 'vender', item: l.kind, quantidade: 1 });
                  }}
                >
                  Vender 1
                </button>
                {/* "Tudo" só existe quando há mais de um: com uma unidade na
                    bolsa ele seria um segundo botão que faz a mesma coisa. */}
                {l.lote > 1 ? (
                  <button
                    type="button"
                    id={'vender-tudo-' + l.kind}
                    className="botao botao-mini"
                    aria-label={
                      'Vender ' + quantiaDeItem(ITENS[l.kind], l.lote) +
                      ' por ' + moedasEmTexto(l.valor * l.lote)
                    }
                    onClick={() => {
                      /* O NÚMERO exato, nunca a palavra: o engine não aceita
                       * 'tudo' (ver o cabeçalho e `Command` em types.ts). */
                      store.dispatch({ kind: 'vender', item: l.kind, quantidade: l.lote });
                    }}
                  >
                    Tudo ({l.lote})
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <dl className="tabela" id="troca-compra">
        <div className="tabela-linha">
          <dt>
            <span className="bolsa-nome">{comoRotulo(ITENS.potion.nome)}</span>
            <span className="bolsa-preco">
              {PRECO_POCAO} moedas · devolve {POTION_HEAL} de vida na hora
            </span>
            {/* O motivo, escrito, no mesmo idioma da oficina: um botão apagado
                sem explicação manda o jogador procurar o que ele não tem. */}
            {motivoCompra ? (
              <span className="troca-falta" id="troca-motivo-potion">{motivoCompra}</span>
            ) : null}
          </dt>
          <dd className="troca-acoes">
            <button
              type="button"
              id="comprar-potion"
              className="botao botao-mini botao-primario"
              disabled={!podeComprar}
              aria-describedby={motivoCompra ? 'troca-motivo-potion' : undefined}
              aria-label={'Comprar uma poção por ' + moedasEmTexto(PRECO_POCAO)}
              onClick={() => {
                store.dispatch({ kind: 'comprar', item: 'potion', quantidade: 1 });
              }}
            >
              Comprar
            </button>
          </dd>
        </div>
      </dl>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * A oficina da ESTAÇÃO DE ALQUIMIA (o tile do caldeirão)
 * ------------------------------------------------------------------ */

function BlocoAlquimia({ game }: { game: Game }) {
  const p = game.player;
  const bag = p.bag || {};
  const armaNivel = Math.max(0, inteiro(p.armaNivel));

  return (
    <>
      {/* O texto descreve o que está NA TELA: o caldeirão fumegando, a estante
          de frascos ao lado e a mesa com o livro aberto (os três rigs de
          src/render/characters/alquimia.ts). A bigorna do refino continua
          existindo na narração do engine — ela é o ofício, não a mobília. */}
      <p className="nota" id="troca-nota">
        O caldeirão ferve entre a estante de frascos e a mesa de trabalho.
        Trabalhar aqui custa um turno.
      </p>

      <dl className="tabela" id="troca-receitas">
        {RECEITA_KINDS.map((key) => {
          const receita = RECEITAS[key];
          const faltas = faltasDaReceita(bag, receita.custo);
          /* O teto vem ANTES do material, na mesma ordem do engine (`criar` em
           * src/engine/game.ts): dizer "faltam cimitarras" a quem já está no
           * refino máximo seria mandar o jogador atrás de material que não
           * mudaria nada. */
          const noTeto = key === 'refino' && armaNivel >= ARMA_NIVEL_MAX;
          const impedido = noTeto || faltas.length > 0;
          const idMotivo = 'troca-motivo-' + key;

          let motivo = '';
          if (noTeto) {
            motivo = 'Refino máximo atingido (' + ARMA_NIVEL_MAX + ').';
          } else if (faltas.length > 0) {
            const partes: string[] = [];
            for (let i = 0; i < faltas.length; i++) {
              partes.push(quantiaDeItem(ITENS[faltas[i].item], faltas[i].falta));
            }
            motivo = faltaEmTexto(partes, faltas.length > 1 || faltas[0].falta > 1);
          }

          return (
            <div className="tabela-linha" key={key}>
              <dt>
                <span className="bolsa-nome">{receita.nome}</span>
                <span className="bolsa-preco">
                  {comoRotulo(custoEmTexto(receita.custo))} → {receita.produz}
                </span>
                {key === 'refino' ? (
                  <span className="bolsa-preco" id="troca-arma-nivel">
                    Sua arma: refino {armaNivel} de {ARMA_NIVEL_MAX}
                  </span>
                ) : null}
                {motivo ? (
                  <span className="troca-falta" id={idMotivo}>{motivo}</span>
                ) : null}
              </dt>
              <dd className="troca-acoes">
                <button
                  type="button"
                  id={'criar-' + key}
                  className="botao botao-mini botao-primario"
                  disabled={impedido}
                  aria-describedby={motivo ? idMotivo : undefined}
                  aria-label={
                    'Criar ' + receita.nome + ' — custa ' + custoEmTexto(receita.custo)
                  }
                  onClick={() => {
                    store.dispatch({ kind: 'criar', receita: key });
                  }}
                >
                  Criar
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * O bloco
 * ------------------------------------------------------------------ */

export function TradePanel() {
  // Assinatura da versão: vender, comprar e criar mutam o jogo, e o painel
  // inteiro relê `store.getGame()` no mesmo instante — inclusive a linha de
  // moedas e o que sobrou na bolsa.
  useGameVersion();

  const game = store.getGame();
  const modo = modoDaParada(game);
  if (!modo) return null;

  const moedas = Math.max(0, inteiro(game.player.moedas));

  return (
    <section
      className="bloco bloco-troca"
      id="troca"
      aria-label={modo === 'mercador' ? 'Balcão do mercador' : 'Estação de alquimia e refino'}
      onKeyDown={(ev) => {
        /*
         * Enter e Espaço ATIVAM o botão em foco (comportamento nativo) e, sem
         * isto, continuariam subindo até o ouvinte global de `window`, onde
         * Enter é 'descer' e Espaço é 'esperar' (useKeyboard.ts). O jogador de
         * teclado gastaria DOIS turnos por clique. As demais teclas passam de
         * propósito: quem está com o foco num botão do balcão continua podendo
         * andar com WASD.
         */
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.stopPropagation();
        }
      }}
    >
      <h2 className="titulo">{modo === 'mercador' ? 'Mercador' : 'Alquimia'}</h2>

      <div className="vida-cabeca">
        <span className="rotulo">Moedas</span>
        <span className="valor valor-moedas" id="troca-moedas">{moedas}</span>
      </div>

      {modo === 'mercador' ? <BlocoMercador game={game} /> : <BlocoAlquimia game={game} />}
    </section>
  );
}
