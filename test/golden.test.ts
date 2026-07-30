/*
 * ISOROGUE — test/golden.test.ts
 * ==================================================================
 * BASELINE DE REGRESSÃO CARACTERIZADA DO ENGINE.
 *
 * Consome `test/golden/engine-snapshots.json`, gerado por
 * `tools/gen-golden-engine.mjs`, e reexecuta EXATAMENTE o mesmo protocolo
 * (docs/ARQUITETURA-REACT.md §7.1) contra o engine de `src/engine/**`:
 *
 *   · 12 sementes GOLD-0001..GOLD-0012, profundidades 1..3
 *   · 200 comandos por caso, na mesma ordem gravada
 *   · duas passadas por caso: canônica e "resistente" (vida reposta antes de
 *     cada comando — protocolo T6 do harness vanilla)
 *   · 4 descidas forçadas por `descend()` (a progressão que os comandos
 *     sorteados nunca alcançam)
 *
 * A comparação é feita na ORDEM CRONOLÓGICA do jogo, de modo que a primeira
 * falha apontada seja sempre a primeira divergência real:
 *   mapa → população → estado inicial → comando a comando → marcos de 10 turnos
 *   → níveis visitados → morte → estado final (log incluso) → progressão.
 *
 * ------------------------------------------------------------------
 * O QUE MUDOU: A PROCEDÊNCIA DO ORACLE (ADR-008)
 * ------------------------------------------------------------------
 * Até a fase dos despojos, o oracle vinha do VANILLA CONGELADO: `gen-golden.mjs`
 * rodava `legacy/isorogue-vanilla.html` em `node:vm` e este teste media a
 * paridade entre duas implementações independentes. Essa era a prova da
 * migração vanilla → React/TypeScript, e ela FOI DADA.
 *
 * Ela também acabou. Ao entrar o sistema de despojos — drop por abate, bolsa do
 * jogador, stream `rngLoot`, `snapshot()` v2 —, manter aquele oracle exigiria
 * reimplementar cada sistema novo dentro de um HTML legado que só existe como
 * peça de museu, para sempre, a cada fase. O custo é permanente; o benefício
 * terminou no dia em que a paridade foi provada.
 *
 * O oracle passou então a ser derivado do PRÓPRIO ENGINE. Ele deixou de ser
 * prova de paridade e virou **baseline de regressão caracterizada**: uma
 * fotografia detalhada de como o jogo se comporta HOJE, em 12 sementes, turno a
 * turno, contra a qual toda mudança futura é medida.
 *
 * O oracle vanilla continua no repositório (`test/golden/snapshots.json`) como
 * artefato histórico, junto de `legacy/` e de `tools/gen-golden.mjs`. Ele não é
 * mais executado por teste nenhum — o porquê está no ADR-008, seção "o que se
 * perde".
 *
 * ------------------------------------------------------------------
 * A REGRA DE OURO — nova, e mais exigente do que parece
 * ------------------------------------------------------------------
 *   1. DIVERGÊNCIA É REGRESSÃO DO ENGINE ATÉ PROVA EM CONTRÁRIO. O reflexo
 *      correto diante de vermelho continua sendo abrir o engine, não o oracle.
 *   2. REGENERAR O ORACLE É ATO DELIBERADO. Roda-se `npm run golden:engine`
 *      quando o comportamento mudou DE PROPÓSITO, com o dono junto, e a
 *      mudança é registrada em `obsidian/07 - Changelog` — o que mudou, por
 *      quê, e o que se conferiu antes de aceitar o novo baseline.
 *   3. NUNCA se regenera para "consertar" um teste vermelho, nunca se afrouxa
 *      uma comparação, nunca se pula caso.
 *
 * A regra 2 é mais frágil do que era: quando o oracle vinha do vanilla,
 * regenerá-lo exigia editar OUTRO programa antes, e esse atrito era metade da
 * garantia. Agora um `npm run golden:engine` distraído apaga a evidência de uma
 * regressão sem deixar rastro além do diff. É por isso que a passagem por
 * changelog não é burocracia: é o atrito que sobrou.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createState, snapshot } from '../src/engine/game';
import {
  INTERVALO_SNAPSHOT,
  N_CASOS,
  N_COMANDOS,
  N_DESCIDAS,
  extrairInimigos,
  extrairItens,
  extrairJogador,
  extrairLog,
  extrairMapa,
  extrairStats,
  extrairVisiveis,
  extrairExplorados,
  rodarPartida,
  rodarProgressao,
  sequenciasDeComando
} from './golden/protocolo';
import type { OArquivo, OCaso, OPassada, Passada } from './golden/protocolo';

/*
 * O engine é puro, mas `endTurn` chama o autosave. `test/golden/protocolo.ts`
 * desliga a persistência (`setStorage(null)`) no ato da importação, e o faz lá
 * justamente para que o gerador do oracle e este teste rodem sob a MESMA
 * condição de isolamento — nenhum resíduo de uma partida alcança a seguinte, e
 * a ordem de execução dos casos não pode mudar o resultado.
 */

/* ------------------------------------------------------------------ *
 * 1. O oracle
 * ------------------------------------------------------------------ */

const oracle: OArquivo = JSON.parse(
  readFileSync(new URL('./golden/engine-snapshots.json', import.meta.url), 'utf8')
) as OArquivo;

/* ------------------------------------------------------------------ *
 * 2. Relatório de divergência
 * ------------------------------------------------------------------ */

function primeiraDivergencia<T>(a: readonly T[], b: readonly T[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function recorta(texto: string, max: number): string {
  const t = String(texto);
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/** Bloco legível "campo: valor" para a mensagem de falha. */
function bloco(titulo: string, campos: Array<[string, unknown]>): string {
  const larg = campos.reduce((m, c) => Math.max(m, c[0].length), 0);
  const linhas = campos.map(([k, v]) => '    ' + k.padEnd(larg) + ' : ' + String(v));
  return '\n  ' + titulo + '\n' + linhas.join('\n') + '\n';
}

/**
 * Compara a sequência comando a comando e ACUSA O PRIMEIRO TURNO DIVERGENTE,
 * com o comando, o turno, o snapshot obtido e o último ponto de concordância.
 */
function conferirSequencia(
  rotulo: string,
  caso: OCaso,
  esperado: OPassada,
  obtido: Passada
): void {
  const kAceitos = primeiraDivergencia(esperado.aceitos.split(''), obtido.aceitos.split(''));
  const kHashes = primeiraDivergencia(esperado.hashesPorComando, obtido.hashesPorComando);

  const k = (kAceitos === -1) ? kHashes : (kHashes === -1 ? kAceitos : Math.min(kAceitos, kHashes));
  if (k === -1) return;

  const anterior = k > 0 ? obtido.snapshotsPorComando[k - 1] : caso.inicial.snapshot;
  const snapObtido = obtido.snapshotsPorComando[k];

  /* Último marco de 10 turnos em que baseline e engine ainda concordavam — é o
   * ponto de partida para investigar o que aconteceu entre ele e o comando k. */
  const marcosIguais = Object.keys(esperado.snapshots)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((t) => esperado.snapshots[String(t)] === obtido.snapshots[String(t)]);
  const marcoAnterior = marcosIguais.pop();

  /*
   * O oracle guarda o snapshot COMPLETO só nos marcos de 10 turnos, na morte e
   * no fim; nos demais comandos guarda o hash. Quando o completo existe para
   * este ponto, mostramos os dois lado a lado e o caractere onde se separam —
   * é o que diz de imediato se a divergência é de posição, hp, inimigo, item,
   * bolsa, rng ou mapa.
   */
  const snapEsperado =
    (esperado.morte && esperado.morte.comandoIndice === k) ? esperado.morte.snapshot :
      (k === caso.comandos.length - 1 ? esperado.final.snapshot : undefined);
  let coluna = -1;
  if (snapEsperado && snapObtido) {
    const n = Math.min(snapEsperado.length, snapObtido.length);
    for (let j = 0; j < n; j++) {
      if (snapEsperado[j] !== snapObtido[j]) {
        coluna = j;
        break;
      }
    }
    if (coluna === -1 && snapEsperado.length !== snapObtido.length) coluna = n;
  }

  const detalhe = bloco(
    'PRIMEIRA DIVERGÊNCIA — ' + caso.seed + ' (nível ' + caso.depth + ', passada ' + rotulo + ')',
    [
      ['comando nº', k + ' de ' + caso.comandos.length],
      ['comando', JSON.stringify(caso.comandos[k])],
      ['aceito (baseline)', esperado.aceitos.charAt(k) === '1'],
      ['aceito (engine)', obtido.aceitos.charAt(k) === '1'],
      ['hash esperado', esperado.hashesPorComando[k] || '(fim da lista)'],
      ['hash obtido', obtido.hashesPorComando[k] || '(fim da lista)'],
      ['snapshot anterior', recorta(anterior, 240)],
      ['snapshot obtido', recorta(snapObtido || '(ausente)', 240)],
      ['snapshot esperado', snapEsperado ? recorta(snapEsperado, 240)
        : '(o oracle só guarda o hash neste ponto)'],
      ['1ª diferença', coluna === -1 ? '(não comparável aqui)' : 'caractere ' + coluna],
      ['último marco igual', marcoAnterior === undefined ? '(nenhum)' : 'turno ' + marcoAnterior],
      ['reprodução', 'createState(\'' + caso.seed + '\', ' + caso.depth + ') + ' +
        (k + 1) + ' comandos de casos[' + (caso.id - 1) + '].comandos' +
        (rotulo === 'resistente' ? ' (com hp reposto antes de cada comando)' : '')],
      ['leitura', 'até prova em contrário isto é REGRESSÃO do engine, não oracle velho']
    ]
  );

  expect(
    { comando: k, aceito: obtido.aceitos.charAt(k) === '1', hash: obtido.hashesPorComando[k] },
    detalhe
  ).toEqual(
    { comando: k, aceito: esperado.aceitos.charAt(k) === '1', hash: esperado.hashesPorComando[k] }
  );
}

/** Confere uma passada inteira, do mapa ao log final, em ordem cronológica. */
function conferirPassada(rotulo: string, caso: OCaso, esperado: OPassada, obtido: Passada): void {
  const onde = caso.seed + ' [' + rotulo + ']';

  // 1) o jogo, comando a comando — é aqui que a primeira divergência aparece
  conferirSequencia(rotulo, caso, esperado, obtido);
  expect(obtido.aceitos, onde + ': string de comandos aceitos').toBe(esperado.aceitos);
  expect(obtido.aceitosTotal, onde + ': total de comandos aceitos').toBe(esperado.aceitosTotal);
  expect(obtido.hashesPorComando, onde + ': hashes por comando').toEqual(esperado.hashesPorComando);

  // 2) marcos de 10 turnos — snapshot() completo, string com string
  expect(Object.keys(obtido.snapshots).sort(), onde + ': marcos de snapshot').toEqual(
    Object.keys(esperado.snapshots).sort()
  );
  for (const turno of Object.keys(esperado.snapshots)) {
    expect(obtido.snapshots[turno], onde + ': snapshot no turno ' + turno).toBe(
      esperado.snapshots[turno]
    );
  }

  // 3) níveis visitados durante a sequência
  expect(obtido.niveis.length, onde + ': quantidade de níveis visitados').toBe(esperado.niveis.length);
  for (let i = 0; i < esperado.niveis.length; i++) {
    expect(obtido.niveis[i], onde + ': mapa do nível visitado nº ' + i).toEqual(esperado.niveis[i]);
  }

  // 4) morte (turno, comando, causa em pt-BR e arquétipo do golpe fatal)
  expect(obtido.morte, onde + ': morte').toEqual(esperado.morte);

  // 5) estado final completo, log incluído
  expect(obtido.final.snapshot, onde + ': snapshot final').toBe(esperado.final.snapshot);
  expect(obtido.final.turn, onde + ': turno final').toBe(esperado.final.turn);
  expect(obtido.final.depth, onde + ': nível final').toBe(esperado.final.depth);
  expect(obtido.final.over, onde + ': over final').toBe(esperado.final.over);
  expect(obtido.final.cause, onde + ': causa da morte').toBe(esperado.final.cause);
  expect(obtido.final.causeKind, onde + ': arquétipo do golpe fatal').toBe(esperado.final.causeKind);
  expect(obtido.final.jogador, onde + ': jogador final (bolsa inclusa)').toEqual(
    esperado.final.jogador
  );
  expect(obtido.final.inimigos, onde + ': inimigos finais').toEqual(esperado.final.inimigos);
  expect(obtido.final.itens, onde + ': itens no chão ao final').toEqual(esperado.final.itens);
  expect(obtido.final.proxItemId, onde + ': contador de id de item').toBe(
    esperado.final.proxItemId
  );
  expect(obtido.final.stats, onde + ': estatísticas finais').toEqual(esperado.final.stats);
  expect(obtido.final.visiveis, onde + ': tiles visíveis').toEqual(esperado.final.visiveis);
  expect(obtido.final.explorados, onde + ': tiles explorados').toEqual(esperado.final.explorados);
  expect(obtido.final.rngCombat, onde + ': estado do rngCombat').toBe(esperado.final.rngCombat);
  expect(obtido.final.rngLoot, onde + ': estado do rngLoot').toBe(esperado.final.rngLoot);
  expect(obtido.final.mapa, onde + ': mapa final').toEqual(esperado.final.mapa);

  const kLog = primeiraDivergencia(
    esperado.final.log.map((e) => e.turn + '|' + e.cls + '|' + e.text),
    obtido.final.log.map((e) => e.turn + '|' + e.cls + '|' + e.text)
  );
  if (kLog !== -1) {
    const detalhe = bloco('REGISTRO DIVERGENTE — ' + onde, [
      ['linha nº', kLog],
      ['tamanho baseline', esperado.final.log.length],
      ['tamanho engine', obtido.final.log.length],
      ['baseline', JSON.stringify(esperado.final.log[kLog] || null)],
      ['engine', JSON.stringify(obtido.final.log[kLog] || null)]
    ]);
    expect(obtido.final.log[kLog], detalhe).toEqual(esperado.final.log[kLog]);
  }
  expect(obtido.final.log, onde + ': registro completo').toEqual(esperado.final.log);
}

/* ------------------------------------------------------------------ *
 * 3. Os 12 casos
 * ------------------------------------------------------------------ */

describe('golden — baseline de regressão do engine', () => {
  it('o oracle está íntegro e no formato do contrato §7.1', () => {
    expect(oracle.formato, 'versão do formato do arquivo').toBe(2);
    expect(oracle.oracle, 'procedência do oracle (ADR-008)').toBe('engine');
    expect(oracle.fonte).toBe('src/engine/**');
    expect(oracle.fonteSha256, 'sha256 do engine que gerou o baseline').toMatch(/^[0-9a-f]{64}$/);
    expect(oracle.casos.length).toBe(N_CASOS);
    expect(oracle.gerador.comandosPorCaso).toBe(N_COMANDOS);
    expect(oracle.gerador.intervaloSnapshot).toBe(INTERVALO_SNAPSHOT);
    expect(oracle.gerador.descidasForcadas).toBe(N_DESCIDAS);
    for (const caso of oracle.casos) {
      expect(caso.comandos.length, caso.seed + ': comandos gravados').toBe(N_COMANDOS);
      expect(caso.hashesPorComando.length, caso.seed + ': hashes gravados').toBe(N_COMANDOS);
      expect(caso.aceitos.length, caso.seed + ': dígitos de aceitação').toBe(N_COMANDOS);
      expect(caso.resistente.hashesPorComando.length, caso.seed + ': hashes resistentes')
        .toBe(N_COMANDOS);
    }
  });

  /*
   * O teste EXECUTA as sequências gravadas no arquivo, não as que ele mesmo
   * sortearia. Este caso confere que as duas coincidem — ou seja, que ninguém
   * mexeu no pool de comandos, na semente do LCG ou na ordem de consumo sem
   * regerar o baseline. Sem ele, alterar o pool passaria despercebido: o teste
   * continuaria verde rodando comandos que o gerador atual nunca produziria.
   */
  it('as sequências gravadas são as que o LCG de semente 20260728 produz hoje', () => {
    const esperadas = sequenciasDeComando();
    expect(esperadas.length).toBe(oracle.casos.length);
    for (let i = 0; i < oracle.casos.length; i++) {
      const caso = oracle.casos[i];
      const k = primeiraDivergencia(esperadas[i], caso.comandos);
      expect(k, caso.seed + ': sequência de comandos diverge no índice ' + k).toBe(-1);
    }
  });

  for (const caso of oracle.casos) {
    describe(caso.seed + ' (nível ' + caso.depth + ')', () => {
      it('gera o mesmo mapa e a mesma população', () => {
        const game = createState(caso.seed, caso.depth);

        expect(extrairMapa(game.map, true), caso.seed + ': mapa de abertura').toEqual(caso.mapa);
        expect(extrairInimigos(game.enemies), caso.seed + ': inimigos do spawn').toEqual(
          caso.populacao.inimigos
        );
        expect(extrairItens(game.items), caso.seed + ': itens do spawn').toEqual(
          caso.populacao.itens
        );

        expect(String(snapshot(game)), caso.seed + ': snapshot inicial').toBe(caso.inicial.snapshot);
        expect(extrairJogador(game.player), caso.seed + ': jogador inicial').toEqual(
          caso.inicial.jogador
        );
        expect(game.proxItemId, caso.seed + ': contador inicial de id de item').toBe(
          caso.inicial.proxItemId
        );
        expect(extrairStats(game.stats), caso.seed + ': estatísticas iniciais').toEqual(
          caso.inicial.stats
        );
        expect(extrairVisiveis(game), caso.seed + ': FOV inicial').toEqual(caso.inicial.visiveis);
        expect(extrairExplorados(game), caso.seed + ': explorados iniciais').toEqual(
          caso.inicial.explorados
        );
        expect(extrairLog(game.log), caso.seed + ': registro de abertura').toEqual(
          caso.inicial.log
        );
      });

      it('reproduz os ' + N_COMANDOS + ' comandos da partida canônica', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, false);
        expect(obtido.mapaCompleto, caso.seed + ': mapa').toEqual(caso.mapa);
        expect(obtido.inicial, caso.seed + ': estado inicial').toEqual(caso.inicial);
        conferirPassada('canônica', caso, caso, obtido);
      });

      it('reproduz os ' + N_COMANDOS + ' comandos da partida resistente (vida reposta)', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, true);
        expect(obtido.inicial.snapshot, caso.seed + ': snapshot inicial resistente').toBe(
          caso.resistente.snapshotInicial
        );
        conferirPassada('resistente', caso, caso.resistente, obtido);
      });

      it('reproduz as ' + N_DESCIDAS + ' descidas forçadas da progressão', () => {
        const obtido = rodarProgressao(caso.seed, caso.depth);
        expect(obtido.niveis.length, caso.seed + ': níveis da progressão').toBe(
          caso.progressao.niveis.length
        );
        for (let i = 0; i < caso.progressao.niveis.length; i++) {
          const esperado = caso.progressao.niveis[i];
          const atual = obtido.niveis[i];
          const onde = caso.seed + ': progressão nível ' + esperado.depth;
          expect(atual.snapshot, onde + ' — snapshot').toBe(esperado.snapshot);
          expect(atual.depth, onde + ' — profundidade').toBe(esperado.depth);
          expect(atual.jogador, onde + ' — jogador (bolsa inclusa)').toEqual(esperado.jogador);
          expect(atual.stats, onde + ' — estatísticas').toEqual(esperado.stats);
          expect(atual.mapa, onde + ' — mapa').toEqual(esperado.mapa);
          expect(atual.inimigos, onde + ' — inimigos').toEqual(esperado.inimigos);
          expect(atual.itens, onde + ' — itens').toEqual(esperado.itens);
          expect(atual.rngCombat, onde + ' — rngCombat').toBe(esperado.rngCombat);
          expect(atual.rngLoot, onde + ' — rngLoot').toBe(esperado.rngLoot);
          expect(atual.proxItemId, onde + ' — contador de id de item').toBe(esperado.proxItemId);
        }
        expect(obtido.log, caso.seed + ': registro da progressão').toEqual(caso.progressao.log);
      });
    });
  }
});
