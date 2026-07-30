#!/usr/bin/env node
/*
 * ISOROGUE — gerador do ORACLE DE REGRESSÃO, derivado do PRÓPRIO ENGINE
 * =====================================================================
 * Grava `test/golden/engine-snapshots.json`, o baseline que
 * `test/golden.test.ts` consome.
 *
 * ---------------------------------------------------------------------
 * POR QUE UM SCRIPT NOVO, E NÃO UM `--engine` EM tools/gen-golden.mjs
 * ---------------------------------------------------------------------
 * `tools/gen-golden.mjs` tem 1.184 linhas e ~85% delas são o sandbox do
 * vanilla: `node:vm`, um DOM inteiro de mentira, contexto 2D de mentira,
 * localStorage, extração do `<script>` do HTML congelado. Nada disso é usado
 * quando a fonte é o engine — um modo `--engine` carregaria toda essa
 * maquinaria (e o HTML de `legacy/`) num caminho que, por definição, não pode
 * tocá-los.
 *
 * Há uma razão mais forte: os dois geradores passaram a ter CICLOS DE VIDA
 * OPOSTOS. `gen-golden.mjs` é peça histórica — ele e o `snapshots.json` que
 * produziu ficam congelados junto com `legacy/`, como registro de que a
 * migração vanilla→React/TS foi provada. Este aqui é ferramenta viva, que
 * acompanha cada fase nova do engine. Enfiar os dois no mesmo arquivo tornaria
 * mutável uma coisa cujo valor é justamente estar parada.
 *
 * ---------------------------------------------------------------------
 * COMO ELE EXECUTA TYPESCRIPT SEM DEPENDÊNCIA NOVA
 * ---------------------------------------------------------------------
 * Pelo MESMO pipeline que roda os testes: o módulo runner do Vite
 * (`createServerModuleRunner`), que é literalmente o que o Vitest 4 usa por
 * baixo para carregar `test/**` e `src/**`.
 *
 * Isso não é conveniência, é correção. Um oracle derivado do engine só vale se
 * codificar o comportamento do EXATO programa que o teste executa. Transpilar
 * o engine por outra via (strip-types do Node, um bundle avulso, um `tsc`
 * intermediário) introduziria um segundo compilador entre o oracle e o teste —
 * pequeno, provavelmente inócuo, e exatamente o tipo de diferença que ninguém
 * lembra de considerar quando o golden fica vermelho às três da manhã.
 *
 * Alternativas medidas e descartadas:
 *   · `node --experimental-strip-types`: morre em `export const enum Tile`
 *     (src/engine/types.ts), que não é sintaxe apagável;
 *   · `node --experimental-transform-types`: funciona, mas é flag experimental
 *     e é um segundo compilador — ver acima;
 *   · esbuild: o projeto está no Vite 8, que roda sobre Rolldown e NÃO expõe
 *     esbuild (o mesmo motivo já registrado em vite.preview.config.ts);
 *   · disparar `vitest run` num arquivo gerador: funciona, mas exige um arquivo
 *     de configuração só para tirar o gerador do `include` dos testes e obriga
 *     a vestir o gerador de `it(...)`. Mesmo pipeline, mais cerimônia.
 *
 * O protocolo em si (extratores, `rodarPartida`, `rodarProgressao`, LCG) mora em
 * `test/golden/protocolo.ts`, importado TAMBÉM pelo teste. Este arquivo é só a
 * casca de linha de comando: proveniência, escrita, resumo.
 *
 * Node >= 20, ESM, zero dependências novas (só o Vite que já está no projeto).
 *
 * Uso:
 *   node tools/gen-golden-engine.mjs               gera o oracle
 *   npm run golden:engine                          idem
 *   node tools/gen-golden-engine.mjs --resumo      só imprime, não grava
 *   node tools/gen-golden-engine.mjs --verificar   gera DUAS vezes e prova que
 *                                                  o resultado é idêntico
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const DIR_ENGINE = join(RAIZ, 'src', 'engine');
const DIR_SAIDA = join(RAIZ, 'test', 'golden');
const ARQ_SAIDA = join(DIR_SAIDA, 'engine-snapshots.json');
const MOD_PROTOCOLO = '/test/golden/protocolo.ts';

const argv = process.argv.slice(2);
const SO_RESUMO = argv.includes('--resumo') || argv.includes('--dry-run');
const VERIFICAR = argv.includes('--verificar');

/* ------------------------------------------------------------------ */
/* utilitários                                                         */
/* ------------------------------------------------------------------ */

function rel(caminho) {
  const r = relative(RAIZ, caminho);
  return r === '' ? '.' : r.split('\\').join('/');
}

function abortar(mensagem, dicas) {
  console.error('');
  console.error('[gen-golden-engine] ERRO FATAL: ' + mensagem);
  if (dicas && dicas.length) {
    console.error('');
    for (const d of dicas) console.error('                    · ' + d);
  }
  console.error('');
  process.exit(1);
}

function ms(n) {
  return n < 1000 ? n.toFixed(0) + ' ms' : (n / 1000).toFixed(2).replace('.', ',') + ' s';
}

function pad(n, largura) {
  return String(n).padStart(largura, '0');
}

function col(v, n) {
  return String(v).padStart(n);
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */
/* 1. proveniência: o SHA-256 do engine que produziu este oracle       */
/* ------------------------------------------------------------------ */

/*
 * Hash de CONTEÚDO, não mtime: mtime não sobrevive a um `git clone` e mudaria a
 * cada `touch`. A varredura é rasa e ordenada por caminho — `src/engine/` é
 * plano hoje, e uma subpasta futura entra aqui de graça pela recursão.
 *
 * Este hash é PROVENIÊNCIA, não gate: o teste NÃO o confere contra o engine
 * atual. Se conferisse, editar um comentário no engine deixaria o golden
 * vermelho — o que treinaria todo mundo a regenerar o oracle por reflexo, que é
 * precisamente o hábito que a regra de ouro proíbe. Quem detecta mudança de
 * comportamento é a comparação; este número só responde "a partir de qual
 * engine este arquivo foi escrito?".
 */
function listarFontesDoEngine(dir) {
  const saida = [];
  for (const nome of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, nome.name);
    if (nome.isDirectory()) saida.push(...listarFontesDoEngine(p));
    else if (/\.tsx?$/.test(nome.name)) saida.push(p);
  }
  return saida.sort();
}

if (!existsSync(DIR_ENGINE)) {
  abortar('não encontrei ' + rel(DIR_ENGINE) + '.', [
    'O oracle desta fase é derivado do engine, não mais do vanilla congelado.'
  ]);
}

const fontes = listarFontesDoEngine(DIR_ENGINE);
if (fontes.length === 0) abortar('nenhum .ts em ' + rel(DIR_ENGINE) + '.');

const hEngine = createHash('sha256');
for (const f of fontes) {
  hEngine.update(rel(f), 'utf8');
  hEngine.update('\0', 'utf8');
  hEngine.update(readFileSync(f));
  hEngine.update('\0', 'utf8');
}
const ENGINE_SHA256 = hEngine.digest('hex');
const PROVENIENCIA = { fonteSha256: ENGINE_SHA256, fonteArquivos: fontes.map(rel) };

/* ------------------------------------------------------------------ */
/* 2. carregar o protocolo (TypeScript) pelo módulo runner do Vite     */
/* ------------------------------------------------------------------ */

let vite;
try {
  vite = await import('vite');
} catch (err) {
  abortar('não consegui carregar o Vite: ' + (err && err.message), [
    'Rode `npm install` — o Vite é devDependency do projeto e é ele que transpila o engine.'
  ]);
}

const t0 = process.hrtime.bigint();

/*
 * `configFile: false`: o gerador não precisa do plugin de React nem do
 * singlefile (são coisas de build de UI), e não carregá-los deixa o boot ~1 s
 * mais rápido. O que importa para a fidelidade é o RESOLVEDOR e o transformador
 * de TypeScript, e esses são do próprio Vite, idênticos com ou sem plugin.
 *
 * `watch: null` e `hmr: false`: sem isso o processo não termina — fica um
 * watcher de arquivo pendurado no event loop.
 */
const servidor = await vite.createServer({
  configFile: false,
  root: RAIZ,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true }
});

const runner = vite.createServerModuleRunner(servidor.environments.ssr, { hmr: false });

let protocolo;
try {
  protocolo = await runner.import(MOD_PROTOCOLO);
} catch (err) {
  await servidor.close();
  abortar('falhei ao carregar ' + MOD_PROTOCOLO + ': ' + (err && err.message), [
    ...String((err && err.stack) || '').split('\n').slice(0, 6).map((l) => '  ' + l.trim())
  ]);
}

if (typeof protocolo.montarOracle !== 'function') {
  await servidor.close();
  abortar(MOD_PROTOCOLO + ' não exporta montarOracle().');
}

/* ------------------------------------------------------------------ */
/* 3. gerar                                                            */
/* ------------------------------------------------------------------ */

function serializar(oracle) {
  /* Duas casas de indentação e newline final: mesmo formato do oracle vanilla,
   * para que um `diff` entre os dois arquivos continue legível. */
  return JSON.stringify(oracle, null, 2) + '\n';
}

const oracle = protocolo.montarOracle(PROVENIENCIA);
const json = serializar(oracle);
const JSON_SHA256 = sha256(json);
const msGeracao = Number(process.hrtime.bigint() - t0) / 1e6;

/*
 * `--verificar` gera uma SEGUNDA vez no mesmo processo. Duas execuções em
 * processos separados provam reprodutibilidade; esta prova algo diferente e
 * complementar: que o engine não guarda estado mutável de módulo entre
 * partidas. Um contador global de id, um buffer de scratch lido antes de ser
 * escrito, um cache que sobrevive ao `createState` — qualquer um deles passaria
 * despercebido em processos separados e apareceria aqui.
 */
let sha256Segunda = null;
let msSegunda = 0;
if (VERIFICAR) {
  const t1 = process.hrtime.bigint();
  sha256Segunda = sha256(serializar(protocolo.montarOracle(PROVENIENCIA)));
  msSegunda = Number(process.hrtime.bigint() - t1) / 1e6;
}

await servidor.close();

/* ------------------------------------------------------------------ */
/* 4. gravar                                                           */
/* ------------------------------------------------------------------ */

let sha256Anterior = null;
if (existsSync(ARQ_SAIDA)) {
  sha256Anterior = sha256(readFileSync(ARQ_SAIDA, 'utf8'));
}

if (!SO_RESUMO) {
  mkdirSync(DIR_SAIDA, { recursive: true });
  writeFileSync(ARQ_SAIDA, json, 'utf8');
}

/* ------------------------------------------------------------------ */
/* 5. resumo                                                           */
/* ------------------------------------------------------------------ */

const SEP = '─'.repeat(96);
const kb = Buffer.byteLength(json, 'utf8') / 1024;
const casos = oracle.casos;

console.log('');
console.log('ISOROGUE — oracle de regressão derivado do engine (ADR-008)');
console.log(SEP);
console.log('  fonte    : ' + oracle.fonte + '  (' + fontes.length + ' arquivos, sha256 ' +
  ENGINE_SHA256.slice(0, 12) + '…)');
console.log('  protocolo: ' + rel(join(RAIZ, 'test', 'golden', 'protocolo.ts')) +
  '  (o MESMO módulo que test/golden.test.ts importa)');
console.log('  saída    : ' + rel(ARQ_SAIDA) + (SO_RESUMO ? '  (NÃO gravado — --resumo)' : ''));
console.log('  tamanho  : ' + kb.toFixed(1).replace('.', ',') + ' KB');
console.log('  sha256   : ' + JSON_SHA256);
console.log('  tempo    : ' + ms(msGeracao));
console.log(SEP);
console.log('                          ┌──── partida canônica ─────┐  ┌──── partida resistente ────┐');
console.log('  caso  semente     nív   turnos  aceit  morte  explor%   turnos  aceit  nív  kills  explor%');
console.log(SEP);
for (const c of casos) {
  const r = c.resistente;
  console.log([
    '  ' + pad(c.id, 2),
    '  ' + c.seed.padEnd(11),
    col(c.depth, 4),
    col(c.final.turn, 9),
    col(c.aceitosTotal, 7),
    col(c.morte ? 't' + c.morte.turno : '—', 7),
    col(c.final.explorePct + '%', 9),
    col(r.final.turn, 9),
    col(r.aceitosTotal, 7),
    col(r.final.depth, 5),
    col(r.final.stats.kills, 7),
    col(r.final.explorePct + '%', 9)
  ].join(''));
}
console.log(SEP);

const mortos = casos.filter((c) => c.morte).length;
console.log('  canônica  : ' + mortos + '/' + casos.length + ' terminam em morte; ' +
  (casos.length - mortos) + ' sobrevivem aos ' + oracle.gerador.comandosPorCaso + ' comandos.');
console.log('  resistente: ' + casos.filter((c) => c.resistente.morte).length + '/' + casos.length +
  ' mortes; níveis alcançados ' +
  Array.from(new Set(casos.map((c) => c.resistente.final.depth))).sort((a, b) => a - b).join(', ') +
  '; ' + casos.reduce((s, c) => s + c.resistente.niveis.length, 0) + ' mapas gerados no total.');

/* Os despojos são a razão de este oracle existir; o resumo tem de mostrá-los,
 * senão ninguém percebe o dia em que a tabela de drops parar de rolar. */
const totalDrops = casos.reduce((s, c) => s + (c.resistente.final.proxItemId - 1 -
  c.populacao.itens.length), 0);
const bolsas = casos.reduce((s, c) =>
  s + c.resistente.final.jogador.bolsa.reduce((t, m) => t + m.n, 0), 0);
const noChao = casos.reduce((s, c) => s + c.resistente.final.itens.length, 0);
console.log('  despojos  : ' + totalDrops + ' materiais largados por abate (resistente), ' +
  bolsas + ' na bolsa ao final; ' + noChao + ' itens no chão ao final (poções inclusas).');
console.log('  causas de morte (canônica):');
for (const c of casos) {
  if (c.morte) {
    console.log('    · ' + c.seed + ' — ' + c.morte.causa +
      ' (turno ' + c.morte.turno + ', ' + (c.morte.causaKind || 'sem autor') + ')');
  }
}

if (VERIFICAR) {
  console.log(SEP);
  console.log('  --verificar: segunda geração no mesmo processo em ' + ms(msSegunda));
  console.log('               1ª  sha256 ' + JSON_SHA256);
  console.log('               2ª  sha256 ' + sha256Segunda);
  if (sha256Segunda !== JSON_SHA256) {
    console.log('               ✗ DIFEREM — há estado mutável de módulo vazando entre partidas.');
    console.log('');
    process.exit(1);
  }
  console.log('               ✓ idênticos — geração determinística.');
}

if (sha256Anterior) {
  console.log(SEP);
  console.log('  arquivo anterior: sha256 ' + sha256Anterior);
  console.log('  ' + (sha256Anterior === JSON_SHA256
    ? '→ o oracle NÃO mudou. Nada a registrar.'
    : '→ o oracle MUDOU. Isto é uma regeneração deliberada: registre o motivo no ' +
      'changelog (obsidian/07 - Changelog) antes de commitar.'));
}
console.log('');
