#!/usr/bin/env node
/**
 * ISOROGUE — capturador da bancada de revisão do guerreiro (docs/PERSONAGEM.md §10).
 *
 *   node tools/preview-personagem.mjs        → docs/ref/preview-atlas.png
 *   npm run preview:personagem               → idem
 *
 * O que ele faz, em ordem:
 *   0. confere que os módulos do personagem existem (erro legível se a fase ainda
 *      não os escreveu — melhor que um stack trace do bundler);
 *   1. builda tools/preview.html com vite.preview.config.ts → .preview/preview.html,
 *      um HTML auto-contido (vite-plugin-singlefile);
 *   2. abre esse HTML no Chrome headless com --dump-dom, SEM relógio virtual, para
 *      ler dois números que só a página sabe: o tamanho exato do conteúdo e o tempo
 *      real de forja do atlas;
 *   3. reabre com --screenshot usando exatamente aquele tamanho de janela, passando
 *      o tempo de forja pelo fragmento da URL.
 *
 * Duas passadas parecem exagero, mas é o que evita os dois defeitos clássicos desta
 * captura: imagem cortada (janela menor que o conteúdo) ou com tarja preta (janela
 * maior), e "0,0 ms" de forja — sob --virtual-time-budget o relógio do Chrome é
 * virtual e um trecho síncrono mede zero.
 *
 * Nenhuma dependência nova: só node:child_process e o Vite que já está no projeto.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SAIDA_PADRAO = join(RAIZ, 'docs', 'ref', 'preview-atlas.png');
const HTML_BUILDADO = join(RAIZ, '.preview', 'preview.html');

/** Módulos que a bancada importa. Sem eles o build falha com erro obscuro. */
const FONTES_EXIGIDAS = [
  'src/render/model3d.ts',
  'src/render/spriteForge.ts',
  'src/render/characters/warrior.ts',
  'tools/preview.html',
  'tools/preview-entry.ts',
  'vite.preview.config.ts'
];

const CANDIDATOS_CHROME = [
  process.env['CHROME_BIN'],
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium'
].filter(Boolean);

/** Caminho curto quando está dentro do repo; absoluto quando escapa dele. */
function curto(caminho) {
  const rel = relative(RAIZ, caminho);
  return rel.startsWith('..') ? caminho : rel;
}

const TAMANHO_RESERVA = { largura: 1800, altura: 1200 };
const LIMITES = { larguraMin: 320, larguraMax: 8000, alturaMin: 240, alturaMax: 12000 };

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

const cor = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  erro: (s) => `\x1b[31m${s}\x1b[0m`,
  aviso: (s) => `\x1b[33m${s}\x1b[0m`,
  fraco: (s) => `\x1b[90m${s}\x1b[0m`
};

function morrer(msg, dica) {
  console.error(`\n${cor.erro('✗')} ${msg}`);
  if (dica) console.error(`  ${cor.fraco(dica)}`);
  process.exit(1);
}

function lerArgs(argv) {
  const opcoes = { saida: SAIDA_PADRAO, build: true };
  for (const arg of argv) {
    if (arg === '--sem-build') opcoes.build = false;
    else if (arg.startsWith('--saida=')) opcoes.saida = resolve(RAIZ, arg.slice('--saida='.length));
    else if (arg === '--ajuda' || arg === '-h') {
      console.log(
        'uso: node tools/preview-personagem.mjs [--sem-build] [--saida=caminho.png]\n' +
          '  --sem-build   reaproveita .preview/preview.html (iteração rápida na página)\n' +
          `  --saida=      destino do PNG (padrão: ${curto(SAIDA_PADRAO)})`
      );
      process.exit(0);
    } else morrer(`argumento desconhecido: ${arg}`, 'use --ajuda');
  }
  return opcoes;
}

function acharChrome() {
  for (const bin of CANDIDATOS_CHROME) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
    if (r.status === 0) return { bin, versao: (r.stdout || '').trim() };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 1. Build da página
 * ------------------------------------------------------------------ */

function conferirFontes() {
  const faltando = FONTES_EXIGIDAS.filter((f) => !existsSync(join(RAIZ, f)));
  if (faltando.length > 0) {
    morrer(
      `a bancada depende de arquivo(s) que ainda não existem:\n    ${faltando.join('\n    ')}`,
      'esta fase ainda não terminou de escrever o personagem — veja docs/PERSONAGEM.md §4, §7 e §8.'
    );
  }
}

function buildar() {
  const viteBin = join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js');
  const usaLocal = existsSync(viteBin);
  const cmd = usaLocal ? process.execPath : 'npx';
  const args = usaLocal
    ? [viteBin, 'build', '--config', 'vite.preview.config.ts']
    : ['vite', 'build', '--config', 'vite.preview.config.ts'];

  console.log(cor.fraco('· buildando a bancada (vite.preview.config.ts)…'));
  const r = spawnSync(cmd, args, { cwd: RAIZ, stdio: 'inherit', timeout: 240_000 });
  if (r.status !== 0) {
    morrer(
      'o build da bancada falhou.',
      'a saída do Vite acima diz o motivo — normalmente um export que a bancada não achou.'
    );
  }
  if (!existsSync(HTML_BUILDADO)) {
    morrer(
      `o build terminou mas ${curto(HTML_BUILDADO)} não existe.`,
      'confira build.outDir / rollupOptions.input em vite.preview.config.ts.'
    );
  }
  conferirAutoContido();
}

/** R02: nada de recurso externo — o HTML tem de nascer inteiro do código. */
function conferirAutoContido() {
  const html = readFileSync(HTML_BUILDADO, 'utf8');
  const suspeitos = [];
  if (/\b(?:src|href)\s*=\s*["'](?!data:|#)[^"']*\.(?:js|css|png|jpg|svg|woff2?)/i.test(html)) {
    suspeitos.push('referência a arquivo externo (src/href para .js/.css/imagem/fonte)');
  }
  if (/https?:\/\//i.test(html)) suspeitos.push('URL http(s) embutida');
  if (suspeitos.length > 0) {
    console.warn(
      cor.aviso(`! ${curto(HTML_BUILDADO)} não parece auto-contido: ${suspeitos.join('; ')}`)
    );
    console.warn(cor.fraco('  a captura por file:// pode abrir uma página em branco.'));
  }
}

/* ------------------------------------------------------------------ *
 * 2 e 3. Chrome headless
 * ------------------------------------------------------------------ */

function flagsBase(perfil, largura, altura) {
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${perfil}`,
    `--window-size=${largura},${altura}`
  ];
}

/**
 * Passada 1 — mede. Sem --virtual-time-budget de propósito: o relógio precisa ser
 * real para o tempo de forja significar alguma coisa. A página é 100% síncrona
 * (o módulo roda antes do evento load), então o --dump-dom nunca chega adiantado.
 */
function medirPagina(chrome, perfil, urlBase) {
  const r = spawnSync(
    chrome,
    [...flagsBase(perfil, TAMANHO_RESERVA.largura, TAMANHO_RESERVA.altura), '--dump-dom', urlBase],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }
  );
  const dom = r.stdout || '';
  const tamanho = /data-bancada="(\d+)x(\d+)"/.exec(dom);
  const forja = /data-forja="([\d.]+)"/.exec(dom);
  const quadros = /data-quadros="(\d+)"/.exec(dom);
  const erro = /data-erro="([^"]*)"/.exec(dom);

  if (!tamanho) {
    return {
      medido: false,
      largura: TAMANHO_RESERVA.largura,
      altura: TAMANHO_RESERVA.altura,
      forjaMs: null,
      quadros: null,
      erroPagina: erro ? erro[1] : null,
      pista: dom.length === 0 ? '(o Chrome não devolveu DOM nenhum)' : null
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    medido: true,
    largura: clamp(Number(tamanho[1]), LIMITES.larguraMin, LIMITES.larguraMax),
    altura: clamp(Number(tamanho[2]), LIMITES.alturaMin, LIMITES.alturaMax),
    forjaMs: forja ? Number(forja[1]) : null,
    quadros: quadros ? Number(quadros[1]) : null,
    erroPagina: erro ? erro[1] : null,
    pista: null
  };
}

/** Passada 2 — fotografa, agora com a janela do tamanho exato do conteúdo. */
function fotografar(chrome, perfil, url, destino, largura, altura) {
  const r = spawnSync(
    chrome,
    [
      ...flagsBase(perfil, largura, altura),
      '--virtual-time-budget=8000',
      `--screenshot=${destino}`,
      url
    ],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }
  );
  if (!existsSync(destino)) {
    morrer(
      'o Chrome não gerou o PNG.',
      `status=${r.status} · stderr: ${(r.stderr || '').trim().slice(0, 400) || '(vazio)'}`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Fluxo
 * ------------------------------------------------------------------ */

function principal() {
  const opcoes = lerArgs(process.argv.slice(2));

  conferirFontes();
  if (opcoes.build) buildar();
  else if (!existsSync(HTML_BUILDADO)) morrer('--sem-build, mas .preview/preview.html não existe.');

  const chrome = acharChrome();
  if (!chrome) {
    morrer(
      'nenhum Chrome/Chromium encontrado.',
      `tentados: ${CANDIDATOS_CHROME.join(', ')} — aponte com CHROME_BIN=/caminho/do/chrome.`
    );
  }
  console.log(cor.fraco(`· ${chrome.versao}`));

  mkdirSync(dirname(opcoes.saida), { recursive: true });
  const perfil = mkdtempSync(join(tmpdir(), 'isorogue-preview-'));
  const urlBase = pathToFileURL(HTML_BUILDADO).href;

  try {
    const medida = medirPagina(chrome.bin, perfil, urlBase);
    if (!medida.medido) {
      console.warn(
        cor.aviso('! a página não publicou seu tamanho — usando janela de reserva.') +
          (medida.pista ? ` ${cor.fraco(medida.pista)}` : '')
      );
    }

    const url =
      medida.forjaMs !== null ? `${urlBase}#forja=${medida.forjaMs.toFixed(2)}` : urlBase;
    fotografar(chrome.bin, perfil, url, opcoes.saida, medida.largura, medida.altura);

    const bytes = statSync(opcoes.saida).size;
    console.log(
      `\n${cor.ok('✓')} ${curto(opcoes.saida)} ` +
        cor.fraco(`(${medida.largura}×${medida.altura}px, ${(bytes / 1024).toFixed(0)} KB)`)
    );
    // Com erro na página, forja e contagem de quadros são zeros sem sentido:
    // reportá-los como "ok" seria a ferramenta mentindo para o revisor.
    if (medida.erroPagina) {
      console.error(`\n${cor.erro('✗')} a bancada registrou um erro: ${medida.erroPagina}`);
      console.error(cor.fraco('  o PNG foi gerado mesmo assim e mostra o painel de erro.'));
      process.exitCode = 1;
      return;
    }

    if (medida.forjaMs !== null) {
      const dentro = medida.forjaMs <= 40;
      console.log(
        `  forja do atlas: ${medida.forjaMs.toFixed(1)} ms ` +
          (dentro ? cor.ok('(alvo < 40 ms — ok)') : cor.aviso('(alvo < 40 ms — estourou)'))
      );
    }
    if (medida.quadros !== null) console.log(`  quadros no atlas: ${medida.quadros}`);

    console.log(
      '\n' +
        cor.fraco(
          'Abra lado a lado com docs/ref/guerreiro-referencia.png e responda G1..G6 (§10 do PERSONAGEM.md).'
        )
    );
  } finally {
    rmSync(perfil, { recursive: true, force: true });
  }
}

principal();
