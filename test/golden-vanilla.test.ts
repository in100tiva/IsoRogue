/*
 * ISOROGUE — test/golden-vanilla.test.ts
 * ==================================================================
 * A ÚLTIMA PROVA VIVA DA MIGRAÇÃO.
 *
 * O ADR-008 mudou a procedência do oracle: `test/golden.test.ts` passou a medir
 * o engine contra um baseline derivado do PRÓPRIO engine. Isso é o certo para
 * detectar regressão, mas custa uma coisa real — a partir de agora ninguém mais
 * compara duas implementações INDEPENDENTES do mesmo jogo, e é a comparação
 * cruzada que pega a classe de erro em que port e oracle "concordam" porque são
 * o mesmo código.
 *
 * Este arquivo é o que sobrou dessa comparação, e ele custa 0,8 s.
 *
 * ------------------------------------------------------------------
 * O QUE ELE AFIRMA
 * ------------------------------------------------------------------
 * Que o engine de HOJE, com o sistema de despojos dentro, continua reproduzindo
 * o vanilla congelado (`test/golden/snapshots.json`, gerado de
 * `legacy/isorogue-vanilla.html` por `tools/gen-golden.mjs`) em TUDO que existia
 * antes dos despojos — mapa, população de inimigos, FOV, Dijkstra, ordem de
 * consumo do `rngCombat`, dano, morte, estatísticas, e o registro em pt-BR
 * linha por linha —, nos mesmos 12 casos, com os mesmos 200 comandos, nas duas
 * passadas e nas 4 descidas forçadas.
 *
 * A granularidade é a mesma do golden: hash do `snapshot()` APÓS CADA COMANDO,
 * não só no fim.
 *
 * ------------------------------------------------------------------
 * A PROJEÇÃO — o que é escondido, e só isso
 * ------------------------------------------------------------------
 * Duas transformações, e elas são a totalidade do que este teste ignora:
 *
 *  1. `rebaixarSnapshot()` — leva o `snapshot()` v2 de volta ao v1:
 *       · `v2|` → `v1|`
 *       · `I[id:kind:x:y]` → `I[id:x:y]`, mantendo SÓ as poções (os materiais
 *         largados por abate não existem no vanilla)
 *       · remove o bloco `B[...]` (a bolsa)
 *       · remove `rngL=` (o stream de despojos)
 *  2. `ocultarDespojos()` — tira do registro as duas famílias de mensagem que a
 *     fase dos despojos criou: "… larga …" e "Você recolhe <material> …".
 *     As poções recolhidas CONTINUAM sendo comparadas: aquela frase é do
 *     vanilla e não pode mudar.
 *
 * Além disso ficam de fora, por não existirem no vanilla: `player.bag`,
 * `game.rngLoot`, `game.proxItemId`, `game.causeKind` e os itens que não são
 * poção. Nada mais. Posição, hp, xp, nível, inimigo, mapa, FOV, explorados,
 * `rngCombat`, stats e turno são comparados crus.
 *
 * `rebaixarSnapshot` LANÇA se o snapshot não tiver exatamente a gramática v2 que
 * ela conhece. É de propósito: um formato v3 tem de derrubar este teste com uma
 * mensagem que diz "o formato mudou", e não passar despercebido projetando meia
 * string.
 *
 * ------------------------------------------------------------------
 * COMO TRIAR UMA FALHA AQUI
 * ------------------------------------------------------------------
 *  a) `rebaixarSnapshot` lançou → o formato do `snapshot()` mudou. NÃO é
 *     regressão; é decisão a tomar (ver "data de validade" abaixo).
 *  b) A comparação falhou em algo que a projeção NÃO esconde — posição, hp,
 *     inimigo, `rngCombat`, mapa, FOV, log — → este é o achado mais grave que
 *     este repositório sabe produzir. Significa que o engine se afastou do
 *     vanilla num ponto em que ele nunca teve licença para se afastar, e que
 *     `test/golden.test.ts` pode estar verde por estar medindo o engine contra
 *     ele mesmo. Pare e investigue.
 *
 * ------------------------------------------------------------------
 * DATA DE VALIDADE — dita por extenso, porque ela chega
 * ------------------------------------------------------------------
 * Este teste vive enquanto a projeção couber nas ~40 linhas que ela ocupa hoje.
 *
 * No dia em que uma fase nova (economia, alquimia, missões) exigir uma terceira
 * e uma quarta projeção — esconder um preço, uma receita, um contador de
 * missão — este arquivo terá virado uma reimplementação do vanilla por
 * procuração, que é EXATAMENTE o custo permanente que o ADR-008 recusou pagar.
 * A ação correta nesse dia é APOSENTAR este arquivo: apagar, registrar no
 * changelog, e deixar `legacy/` e `snapshots.json` no repositório como o
 * documento histórico que eles são. Não é derrota; é o teste terminando de
 * responder a pergunta para a qual foi feito.
 *
 * O que NÃO se faz é afrouxar a projeção para manter o verde. Uma projeção que
 * cresce sem critério esconde regressão em vez de contexto, e um teste que
 * esconde regressão é pior do que teste nenhum, porque ainda dá confiança.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LogEntry, Stats } from '../src/engine/types';
import {
  N_CASOS,
  N_COMANDOS,
  N_DESCIDAS,
  fnv1aStr,
  profundidadeDoCaso,
  rodarPartida,
  rodarProgressao,
  sementeDoCaso
} from './golden/protocolo';
import type {
  JogadorOracle,
  OConjunto,
  OFinal,
  OInicial,
  OItem,
  OMapa,
  OMorte,
  ONivelProgressao,
  OInimigo,
  Passada
} from './golden/protocolo';

/* ------------------------------------------------------------------ *
 * 1. O oracle VANILLA, como ele é (formato de 2026-07-28, sem despojos)
 * ------------------------------------------------------------------ */

/** O jogador do vanilla: os oito campos lógicos, sem bolsa. */
type VJogador = Omit<JogadorOracle, 'bolsa'>;

interface VInicial {
  snapshot: string;
  jogador: VJogador;
  inimigos: OInimigo[];
  itens: OItem[];
  stats: Stats;
  visiveis: OConjunto;
  explorados: OConjunto;
  log: LogEntry[];
}

interface VFinal {
  snapshot: string;
  depth: number;
  turn: number;
  over: boolean;
  cause: string;
  jogador: VJogador;
  inimigos: OInimigo[];
  inimigosVivos: number;
  itens: OItem[];
  stats: Stats;
  explorePct: number;
  visiveis: OConjunto;
  explorados: OConjunto;
  rngCombat: number;
  mapa: OMapa;
  log: LogEntry[];
}

interface VMorte {
  turno: number;
  comandoIndice: number;
  comando: string;
  causa: string;
  snapshot: string;
  jogador: VJogador;
}

interface VPassada {
  aceitos: string;
  aceitosTotal: number;
  hashesPorComando: string[];
  snapshots: Record<string, string>;
  niveis: OMapa[];
  morte: VMorte | null;
  final: VFinal;
}

interface VNivelProgressao {
  depth: number;
  snapshot: string;
  jogador: VJogador;
  stats: Stats;
  mapa: OMapa;
  inimigos: OInimigo[];
  itens: OItem[];
  rngCombat: number;
}

interface VCaso extends VPassada {
  id: number;
  seed: string;
  depth: number;
  mapa: OMapa;
  populacao: { inimigos: OInimigo[]; itens: OItem[] };
  progressao: { protocolo: string; niveis: VNivelProgressao[]; log: LogEntry[] };
  inicial: VInicial;
  comandos: string[];
  resistente: VPassada & { snapshotInicial: string };
}

interface VArquivo {
  geradoEm: string;
  fonte: string;
  fonteSha256: string;
  gerador: { casos: number; comandosPorCaso: number; intervaloSnapshot: number };
  casos: VCaso[];
}

const vanilla: VArquivo = JSON.parse(
  readFileSync(new URL('./golden/snapshots.json', import.meta.url), 'utf8')
) as VArquivo;

/* ------------------------------------------------------------------ *
 * 2. A PROJEÇÃO
 * ------------------------------------------------------------------ */

/** Quantas linhas de registro a projeção escondeu na suíte inteira. */
let linhasOcultadas = 0;
/** Quantos itens não-poção a projeção escondeu na suíte inteira. */
let itensOcultados = 0;

function falhaDeFormato(motivo: string, snap: string): Error {
  return new Error(
    'rebaixarSnapshot: ' + motivo + '.\n' +
    '  O formato de snapshot() mudou e esta projeção não o reconhece mais.\n' +
    '  Isto NÃO é regressão de comportamento — é decisão a tomar: estender a\n' +
    '  projeção ou APOSENTAR test/golden-vanilla.test.ts (ver o cabeçalho do\n' +
    '  arquivo e o ADR-008).\n' +
    '  snapshot recebido: ' + snap.slice(0, 160)
  );
}

/**
 * Leva um `snapshot()` v2 de volta à gramática v1 do vanilla.
 *
 * Estrita por decisão: qualquer desvio da gramática esperada lança. É o que
 * transforma "formato novo" em falha legível em vez de comparação silenciosa
 * sobre uma string meio projetada.
 */
function rebaixarSnapshot(snap: string): string {
  if (snap.slice(0, 3) !== 'v2|') throw falhaDeFormato('esperava um snapshot v2', snap);

  const mI = /\|I\[([^\]]*)\]/.exec(snap);
  if (!mI) throw falhaDeFormato('não achei o bloco I[...] dos itens', snap);
  const mB = /\|B\[([^\]]*)\]/.exec(snap);
  if (!mB) throw falhaDeFormato('não achei o bloco B[...] da bolsa', snap);
  if (!/\|rngL=\d+\|/.test(snap)) throw falhaDeFormato('não achei o campo rngL=', snap);

  /* Só as poções sobrevivem, e sem o `kind` — que o v1 não tinha. */
  const bruto = mI[1];
  const entradas = bruto === '' ? [] : bruto.split('|');
  const potions: string[] = [];
  for (const e of entradas) {
    const p = e.split(':');
    if (p.length !== 4) throw falhaDeFormato('item com ' + p.length + ' campos (esperava 4)', snap);
    if (p[1] === 'potion') potions.push(p[0] + ':' + p[2] + ':' + p[3]);
    else itensOcultados++;
  }

  const saida = snap
    .replace(/^v2\|/, 'v1|')
    .replace(/\|I\[[^\]]*\]/, '|I[' + potions.join('|') + ']')
    .replace(/\|B\[[^\]]*\]/, '')
    .replace(/\|rngL=\d+/, '');

  /* Blindagem: o resultado tem de ser v1 puro. Se sobrou qualquer resquício da
   * fase dos despojos, a projeção falhou e é melhor saber agora. */
  if (!/^v1\|seed=/.test(saida) || saida.includes('B[') || saida.includes('rngL=')) {
    throw falhaDeFormato('a projeção não produziu um v1 limpo', saida);
  }
  return saida;
}

/** "O Goblin larga a orelha de goblin." — mensagem que o vanilla não tem. */
const RE_LARGA = / larga /;
/** "Você recolhe duas gosmas (5 no total)." — idem, MAS a poção é do vanilla. */
const RE_RECOLHE = /^Você recolhe /;
const RE_POCAO = /poç/;

/**
 * Tira do registro as duas famílias de linha que os despojos criaram.
 *
 * O acoplamento é textual e a fragilidade é conhecida: mudar a redação dessas
 * frases quebra o filtro. Isso é aceitável porque o texto do registro JÁ é
 * comportamento congelado pelo golden — mudá-lo é evento raro e deliberado, e
 * quando acontecer as duas coisas quebram juntas, no mesmo commit.
 */
function ocultarDespojos(log: LogEntry[]): LogEntry[] {
  const saida: LogEntry[] = [];
  for (const e of log) {
    const ehDrop = RE_LARGA.test(e.text);
    const ehRecolhaDeMaterial = RE_RECOLHE.test(e.text) && !RE_POCAO.test(e.text);
    if (ehDrop || ehRecolhaDeMaterial) {
      linhasOcultadas++;
      continue;
    }
    saida.push(e);
  }
  return saida;
}

function projetarJogador(j: JogadorOracle): VJogador {
  return {
    x: j.x, y: j.y, hp: j.hp, maxHp: j.maxHp,
    atk: j.atk, potions: j.potions, level: j.level, xp: j.xp
  };
}

function projetarItens(itens: OItem[]): OItem[] {
  return itens.filter((it) => it.kind === 'potion');
}

function projetarInicial(i: OInicial): VInicial {
  return {
    snapshot: rebaixarSnapshot(i.snapshot),
    jogador: projetarJogador(i.jogador),
    inimigos: i.inimigos,
    itens: projetarItens(i.itens),
    stats: i.stats,
    visiveis: i.visiveis,
    explorados: i.explorados,
    log: ocultarDespojos(i.log)
  };
}

function projetarFinal(f: OFinal): VFinal {
  return {
    snapshot: rebaixarSnapshot(f.snapshot),
    depth: f.depth,
    turn: f.turn,
    over: f.over,
    cause: f.cause,
    jogador: projetarJogador(f.jogador),
    inimigos: f.inimigos,
    inimigosVivos: f.inimigosVivos,
    itens: projetarItens(f.itens),
    stats: f.stats,
    explorePct: f.explorePct,
    visiveis: f.visiveis,
    explorados: f.explorados,
    rngCombat: f.rngCombat,
    mapa: f.mapa,
    log: ocultarDespojos(f.log)
  };
}

function projetarMorte(m: OMorte | null): VMorte | null {
  if (!m) return null;
  return {
    turno: m.turno,
    comandoIndice: m.comandoIndice,
    comando: m.comando,
    causa: m.causa,
    snapshot: rebaixarSnapshot(m.snapshot),
    jogador: projetarJogador(m.jogador)
  };
}

function projetarNivelProgressao(n: ONivelProgressao): VNivelProgressao {
  return {
    depth: n.depth,
    snapshot: rebaixarSnapshot(n.snapshot),
    jogador: projetarJogador(n.jogador),
    stats: n.stats,
    mapa: n.mapa,
    inimigos: n.inimigos,
    itens: projetarItens(n.itens),
    rngCombat: n.rngCombat
  };
}

/* ------------------------------------------------------------------ *
 * 3. Comparação
 * ------------------------------------------------------------------ */

function primeiraDivergencia<T>(a: readonly T[], b: readonly T[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function bloco(titulo: string, campos: Array<[string, unknown]>): string {
  const larg = campos.reduce((m, c) => Math.max(m, c[0].length), 0);
  const linhas = campos.map(([k, v]) => '    ' + k.padEnd(larg) + ' : ' + String(v));
  return '\n  ' + titulo + '\n' + linhas.join('\n') + '\n';
}

/** Confere uma passada projetada contra a passada correspondente do vanilla. */
function conferirPassada(rotulo: string, caso: VCaso, esperado: VPassada, obtido: Passada): void {
  const onde = caso.seed + ' [' + rotulo + ']';

  /* Hash por comando: o v1 é recalculado a partir do v2 rebaixado, então o
   * primeiro turno divergente aparece com a mesma precisão do golden. */
  const hashes = obtido.snapshotsPorComando.map((s) => fnv1aStr(rebaixarSnapshot(s)));
  const k = primeiraDivergencia(esperado.hashesPorComando, hashes);
  if (k !== -1) {
    const detalhe = bloco(
      'DIVERGÊNCIA ENGINE × VANILLA — ' + caso.seed + ' (nível ' + caso.depth +
      ', passada ' + rotulo + ')',
      [
        ['comando nº', k + ' de ' + caso.comandos.length],
        ['comando', JSON.stringify(caso.comandos[k])],
        ['hash vanilla', esperado.hashesPorComando[k] || '(fim da lista)'],
        ['hash engine (v1)', hashes[k] || '(fim da lista)'],
        ['engine v2', obtido.snapshotsPorComando[k] || '(ausente)'],
        ['engine v1', obtido.snapshotsPorComando[k]
          ? rebaixarSnapshot(obtido.snapshotsPorComando[k]) : '(ausente)'],
        ['leitura', 'o engine se afastou do vanilla FORA da projeção dos despojos — ' +
          'ver "como triar uma falha" no cabeçalho deste arquivo']
      ]
    );
    expect(hashes[k], detalhe).toBe(esperado.hashesPorComando[k]);
  }
  expect(hashes, onde + ': hashes por comando (v1)').toEqual(esperado.hashesPorComando);

  expect(obtido.aceitos, onde + ': string de comandos aceitos').toBe(esperado.aceitos);
  expect(obtido.aceitosTotal, onde + ': total de comandos aceitos').toBe(esperado.aceitosTotal);

  const marcos: Record<string, string> = {};
  for (const t of Object.keys(obtido.snapshots)) marcos[t] = rebaixarSnapshot(obtido.snapshots[t]);
  expect(Object.keys(marcos).sort(), onde + ': marcos de snapshot').toEqual(
    Object.keys(esperado.snapshots).sort()
  );
  for (const t of Object.keys(esperado.snapshots)) {
    expect(marcos[t], onde + ': snapshot no turno ' + t).toBe(esperado.snapshots[t]);
  }

  expect(obtido.niveis, onde + ': níveis visitados').toEqual(esperado.niveis);
  expect(projetarMorte(obtido.morte), onde + ': morte').toEqual(esperado.morte);
  expect(projetarFinal(obtido.final), onde + ': estado final projetado').toEqual(esperado.final);
}

/* ------------------------------------------------------------------ *
 * 4. Os 12 casos
 * ------------------------------------------------------------------ */

describe('golden vanilla — a paridade da migração continua valendo fora dos despojos', () => {
  it('o oracle vanilla está íntegro e é o de sempre', () => {
    expect(vanilla.fonte).toBe('legacy/isorogue-vanilla.html');
    expect(vanilla.casos.length).toBe(N_CASOS);
    expect(vanilla.gerador.comandosPorCaso).toBe(N_COMANDOS);
  });

  for (const caso of vanilla.casos) {
    describe(caso.seed + ' (nível ' + caso.depth + ')', () => {
      it('nasce com o mesmo mapa, os mesmos inimigos e as mesmas poções', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, false);
        expect(obtido.mapaCompleto, caso.seed + ': mapa de abertura').toEqual(caso.mapa);
        expect(obtido.inicial.inimigos, caso.seed + ': inimigos do spawn').toEqual(
          caso.populacao.inimigos
        );
        expect(projetarItens(obtido.inicial.itens), caso.seed + ': poções do spawn').toEqual(
          caso.populacao.itens
        );
        expect(projetarInicial(obtido.inicial), caso.seed + ': estado inicial projetado').toEqual(
          caso.inicial
        );
      });

      it('reproduz os ' + N_COMANDOS + ' comandos da partida canônica', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, false);
        conferirPassada('canônica', caso, caso, obtido);
      });

      it('reproduz os ' + N_COMANDOS + ' comandos da partida resistente', () => {
        const obtido = rodarPartida(caso.seed, caso.depth, caso.comandos, true);
        expect(rebaixarSnapshot(obtido.inicial.snapshot), caso.seed + ': snapshot inicial').toBe(
          caso.resistente.snapshotInicial
        );
        conferirPassada('resistente', caso, caso.resistente, obtido);
      });

      it('reproduz as ' + N_DESCIDAS + ' descidas forçadas da progressão', () => {
        const obtido = rodarProgressao(caso.seed, caso.depth);
        expect(obtido.niveis.map(projetarNivelProgressao), caso.seed + ': progressão').toEqual(
          caso.progressao.niveis
        );
        expect(ocultarDespojos(obtido.log), caso.seed + ': registro da progressão').toEqual(
          caso.progressao.log
        );
      });
    });
  }

  /*
   * A projeção tem de estar VIVA. Se um refactor futuro fizer os despojos
   * pararem de cair — ou fizer o filtro parar de casar —, tudo aqui ficaria
   * verde por vacuidade: a projeção não esconderia nada e o teste voltaria a
   * ser uma comparação crua, que já não é o que ele afirma ser.
   *
   * Ele faz a própria medição em vez de ler o que os casos acima acumularam:
   * assim continua correto quando alguém roda a suíte filtrada por `-t`.
   */
  it('a projeção dos despojos escondeu alguma coisa (não é verde por vacuidade)', () => {
    itensOcultados = 0;
    linhasOcultadas = 0;

    /* GOLD-0001 na passada resistente abate monstros — logo, larga despojos. */
    const caso = vanilla.casos[0];
    expect(caso.seed).toBe(sementeDoCaso(0));
    const p = rodarPartida(caso.seed, profundidadeDoCaso(0), caso.comandos, true);

    /* Varrer os 200 snapshots, e não só o final: o material pode ter sido
     * recolhido antes do fim, e aí ele só aparece no meio da partida. */
    for (const s of p.snapshotsPorComando) rebaixarSnapshot(s);
    ocultarDespojos(p.final.log);

    expect(itensOcultados, 'itens não-poção escondidos pela projeção').toBeGreaterThan(0);
    expect(linhasOcultadas, 'linhas de registro escondidas pela projeção').toBeGreaterThan(0);
  });
});
