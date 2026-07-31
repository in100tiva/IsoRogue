#!/usr/bin/env node
/**
 * ISOROGUE — capturador da bancada de revisão dos personagens.
 *
 *   node tools/preview-personagem.mjs                → docs/ref/preview-atlas.png  (guerreiro)
 *   npm run preview:personagem                       → idem
 *   npm run preview:personagem -- goblin             → docs/ref/preview-goblin.png
 *   npm run preview:personagem -- slime              → docs/ref/preview-slime.png
 *   npm run preview:personagem -- ogro               → docs/ref/preview-ogro.png
 *   npm run preview:personagem -- elenco             → docs/ref/preview-elenco.png
 *   npm run preview:personagem -- terreno            → docs/ref/preview-terreno.png
 *   node tools/preview-personagem.mjs --personagem=goblin --sem-build
 *
 * Sem argumento nada muda em relação a antes desta fase: mesma página, mesmo
 * PNG, mesmo nome de arquivo. O personagem é escolhido pelo FRAGMENTO da URL
 * (`#personagem=goblin`), que tools/preview-entry.ts lê — uma página buildada
 * serve a todos os personagens, sem um build por bicho.
 *
 * O que ele faz, em ordem:
 *   0. confere que os módulos daquele personagem existem (erro legível se a fase
 *      ainda não os escreveu — melhor que um stack trace do bundler);
 *   1. builda tools/preview.html com vite.preview.config.ts → .preview/preview.html,
 *      um HTML auto-contido (vite-plugin-singlefile);
 *   2. abre esse HTML no Chrome headless com --dump-dom, SEM relógio virtual, para
 *      ler três coisas que só a página sabe: o tamanho exato do conteúdo, o tempo
 *      real de forja do atlas e qual personagem ela de fato desenhou;
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
const HTML_BUILDADO = join(RAIZ, '.preview', 'preview.html');

/** Módulos da bancada em si. Sem eles o build falha com erro obscuro. */
const FONTES_COMUNS = [
  'src/render/model3d.ts',
  'src/render/spriteForge.ts',
  'tools/preview.html',
  'tools/preview-entry.ts',
  'vite.preview.config.ts'
];

/**
 * Os quatro rigs que as tiras de G7, G9 e G10 precisam ter no disco.
 *
 * Toda folha de monstro exige os quatro, e não só o seu: G9 ("leem como
 * espécies diferentes?") e G10 ("Slime < Goblin < Guerreiro < Ogro?") só são
 * julgáveis com o elenco inteiro na imagem. Faltando um, a página degrada com
 * aviso — mas é melhor descobrir isso aqui, com um erro legível, do que numa
 * folha em que a tira aparece com três bonecos e ninguém repara.
 */
const ELENCO = [
  'src/render/characters/slime.ts',
  'src/render/characters/goblin.ts',
  'src/render/characters/warrior.ts',
  'src/render/characters/ogre.ts'
];

/**
 * O tileset que a folha de TERRENO fotografa. O registro entra junto do arquivo
 * do nível porque a bancada pega o material por `tilesetDoNivel` — sem
 * `index.ts` ela não teria paleta nem rampas, e o erro sairia como stack trace
 * do bundler em vez de uma linha legível.
 */
const TERRENO = ['src/render/tilesets/index.ts', 'src/render/tilesets/nivel1.ts'];

/**
 * Os personagens que a bancada sabe fotografar. `chave` é o que se passa na
 * linha de comando e no fragmento da URL — tem de bater com a ficha de mesmo
 * nome em tools/preview-entry.ts, senão a página desenha o guerreiro e a
 * conferência da passada 1 acusa (ver `medirPagina`).
 *
 * O guerreiro mantém `preview-atlas.png` de propósito: é o nome que a §10 do
 * PERSONAGEM.md documenta e que a revisão anterior já usou.
 */
const PERSONAGENS = [
  {
    chave: 'guerreiro',
    apelidos: ['warrior'],
    saida: join('docs', 'ref', 'preview-atlas.png'),
    fonte: 'src/render/characters/warrior.ts',
    referencia: 'docs/ref/guerreiro-referencia.png',
    gates: 'G1..G6',
    doc: 'docs/PERSONAGEM.md §10',
    dicaFalta: 'esta fase ainda não terminou de escrever o personagem — veja docs/PERSONAGEM.md §4, §7 e §8.'
  },
  {
    chave: 'goblin',
    apelidos: ['gob'],
    saida: join('docs', 'ref', 'preview-goblin.png'),
    fonte: 'src/render/characters/goblin.ts',
    referencia: 'docs/ref/goblin-referencia.jpg',
    gates: 'G1..G10',
    doc: 'docs/BESTIARIO.md §8 e §13',
    // G7 põe o guerreiro ao lado do goblin e G9/G10 põem o elenco inteiro: sem
    // os rigs deles a folha sai com um aviso vermelho no lugar das tiras.
    exigeTambem: ELENCO,
    dicaFalta: 'o rig do goblin ainda não foi escrito — veja docs/BESTIARIO.md §5 e §7.'
  },
  {
    chave: 'slime',
    apelidos: ['gosma'],
    saida: join('docs', 'ref', 'preview-slime.png'),
    fonte: 'src/render/characters/slime.ts',
    referencia: 'docs/ref/slime-referencia.jpg',
    gates: 'G1..G10',
    doc: 'docs/BESTIARIO.md §11 e §13',
    exigeTambem: ELENCO,
    dicaFalta: 'o rig do slime ainda não foi escrito — veja docs/BESTIARIO.md §11.3.'
  },
  {
    chave: 'ogro',
    apelidos: ['ogre'],
    saida: join('docs', 'ref', 'preview-ogro.png'),
    fonte: 'src/render/characters/ogre.ts',
    referencia: 'docs/ref/ogro-referencia.png',
    gates: 'G1..G11',
    doc: 'docs/BESTIARIO.md §12 e §13',
    exigeTambem: ELENCO,
    dicaFalta: 'o rig do ogro ainda não foi escrito — veja docs/BESTIARIO.md §12.3.'
  },
  {
    /*
     * A folha do elenco: só a tira dos quatro juntos, grande e nas 8 direções.
     *
     * Ela é a única entrada sem personagem próprio, e é de propósito. G9 ("leem
     * como espécies diferentes?") e G10 ("Slime < Goblin < Guerreiro < Ogro?")
     * são as duas perguntas de PRODUTO desta fase, e quem as responde é o dono
     * do jogo olhando UMA imagem — não caçando uma faixa pequena no rodapé de
     * três folhas densas de 72 quadros cada. A mesma tira continua embutida em
     * cada folha de monstro, menor, para o escultor não trocar de arquivo a cada
     * ajuste; esta aqui é a que se manda para o dono.
     */
    chave: 'elenco',
    apelidos: ['todos', 'cast'],
    saida: join('docs', 'ref', 'preview-elenco.png'),
    // Sem "o" personagem: a folha exige os quatro, e `exigeTambem` cobre todos.
    fonte: 'src/render/characters/warrior.ts',
    referencia: 'docs/ref/ (as quatro referências)',
    gates: 'G9 e G10',
    doc: 'docs/BESTIARIO.md §13',
    exigeTambem: ELENCO,
    // Esta folha forja QUATRO atlas: o número que ela publica é a SOMA, e o
    // alvo de < 40 ms de §7 é por atlas. Sem esta marca o relatório acusaria um
    // estouro que não existe — ver onde `somaForja` é lido, mais abaixo.
    somaForja: true,
    dicaFalta:
      'algum rig do elenco ainda não foi escrito — a folha do elenco precisa dos quatro.'
  },
  {
    /*
     * A folha do TERRENO — a única de AMBIENTE, e a única que é uma COMPARAÇÃO.
     *
     * Ela nasceu com `OpcoesForja.modoContorno`: o modo `'local'` tem um
     * consumidor só, `forjaDoTileset` em src/render/IsoRenderer.ts, que o passa
     * para o terreno. Ou seja, a mudança visual daquela rodada acontece no chão
     * e nas paredes — e a bancada, até então, só sabia fotografar personagem.
     * Uma mudança de aparência sem gate visual é uma mudança sem revisão, e é
     * esse buraco que este alvo fecha.
     *
     * `fonte` é o arquivo do nível; o registro e o guerreiro entram em
     * `exigeTambem` porque a folha precisa do material (via `tilesetDoNivel`) e
     * põe o guerreiro na cena como régua de T5.
     */
    chave: 'terreno',
    apelidos: ['tileset', 'chao'],
    saida: join('docs', 'ref', 'preview-terreno.png'),
    fonte: TERRENO[1],
    exigeTambem: [TERRENO[0], 'src/render/characters/warrior.ts'],
    referencia: 'as duas metades da própria folha (fixo × local)',
    gates: 'T1..T5',
    doc: 'docs/PERSONAGEM.md §10 · §2.1 de src/render/spriteForge.ts',
    // Cada bloco é forjado DUAS vezes (um modo em cada metade), e o alvo de §7 é
    // por atlas: medir a soma contra 40 ms acusaria um estouro que não existe.
    somaForja: true,
    rotulosSoma: {
      forja: 'forja do terreno (todos os blocos, nos dois modos)',
      nota: '(soma — o alvo de < 40 ms de §7 é POR ATLAS; o tempo de cada bloco está na folha)',
      quadros: 'quadros forjados (72 por atlas)'
    },
    dicaFalta: 'o tileset do nível 1 não está no lugar — veja src/render/tilesets/.'
  }
];

const PADRAO = PERSONAGENS[0];

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
/**
 * Os limites existem para o caso de a página publicar um número absurdo — não
 * para "caber". Subiram na fase dos três monstros, depois de o teto anterior de
 * 8000 cortar a folha do Ogro (8453px na época) EM SILÊNCIO, bem na coluna da
 * folha de contato: um PNG com um pedaço faltando e um "✓" verde ao lado.
 *
 * A largura em si foi resolvida onde devia — as legendas longas passaram a
 * quebrar (`.sub { max-width }` em tools/preview.html) e o Ogro voltou para
 * ~6300px. O que ficou daqui é a lição: o teto agora é o do próprio Chrome, que
 * não aloca framebuffer acima de ~16384px por eixo, e `medirPagina` AVISA
 * quando corta. Um limite que corta calado é pior que folha grande.
 */
const LIMITES = { larguraMin: 320, larguraMax: 16000, alturaMin: 240, alturaMax: 16000 };

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

function acharPersonagem(nome) {
  const alvo = String(nome).trim().toLowerCase();
  return (
    PERSONAGENS.find((p) => p.chave === alvo || p.apelidos.includes(alvo)) ?? null
  );
}

function listaDePersonagens() {
  return PERSONAGENS.map((p) => p.chave).join(' | ');
}

function ajuda() {
  console.log(
    `uso: node tools/preview-personagem.mjs [personagem] [--sem-build] [--saida=caminho.png]\n` +
      `  personagem    ${listaDePersonagens()} (padrão: ${PADRAO.chave})\n` +
      '  --sem-build   reaproveita .preview/preview.html (iteração rápida na página)\n' +
      '  --saida=      destino do PNG (padrão: o da ficha do personagem)\n\n' +
      'exemplos:\n' +
      '  npm run preview:personagem              → ' +
      PADRAO.saida +
      '\n' +
      PERSONAGENS.filter((p) => p !== PADRAO)
        .map((p) => `  npm run preview:personagem -- ${p.chave.padEnd(9)} → ${p.saida}`)
        .join('\n')
  );
}

/**
 * O personagem pode vir posicional (`-- goblin`, que é como o npm repassa) ou
 * nomeado (`--personagem=goblin`). Aceitar os dois evita a pegadinha clássica de
 * `npm run` engolir a flag.
 */
function lerArgs(argv) {
  const opcoes = { personagem: PADRAO, saida: null, build: true };
  for (const arg of argv) {
    if (arg === '--sem-build') opcoes.build = false;
    else if (arg.startsWith('--saida=')) opcoes.saida = resolve(RAIZ, arg.slice('--saida='.length));
    else if (arg.startsWith('--personagem=')) {
      const p = acharPersonagem(arg.slice('--personagem='.length));
      if (!p) morrer(`personagem desconhecido: ${arg}`, `conhecidos: ${listaDePersonagens()}`);
      opcoes.personagem = p;
    } else if (arg === '--ajuda' || arg === '-h') {
      ajuda();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      const p = acharPersonagem(arg);
      if (!p) morrer(`personagem desconhecido: ${arg}`, `conhecidos: ${listaDePersonagens()}`);
      opcoes.personagem = p;
    } else morrer(`argumento desconhecido: ${arg}`, 'use --ajuda');
  }
  if (!opcoes.saida) opcoes.saida = join(RAIZ, opcoes.personagem.saida);
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

function conferirFontes(personagem) {
  const exigidas = [
    ...FONTES_COMUNS,
    personagem.fonte,
    ...(personagem.exigeTambem ?? [])
  ];
  const faltando = exigidas.filter((f) => !existsSync(join(RAIZ, f)));
  if (faltando.length > 0) {
    morrer(
      `a bancada de "${personagem.chave}" depende de arquivo(s) que ainda não existem:\n    ${faltando.join('\n    ')}`,
      personagem.dicaFalta
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
function medirPagina(chrome, perfil, url) {
  const r = spawnSync(
    chrome,
    [...flagsBase(perfil, TAMANHO_RESERVA.largura, TAMANHO_RESERVA.altura), '--dump-dom', url],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }
  );
  const dom = r.stdout || '';
  const tamanho = /data-bancada="(\d+)x(\d+)"/.exec(dom);
  const forja = /data-forja="([\d.]+)"/.exec(dom);
  const quadros = /data-quadros="(\d+)"/.exec(dom);
  const erro = /data-erro="([^"]*)"/.exec(dom);
  const personagem = /data-personagem="([^"]*)"/.exec(dom);

  if (!tamanho) {
    return {
      medido: false,
      largura: TAMANHO_RESERVA.largura,
      altura: TAMANHO_RESERVA.altura,
      forjaMs: null,
      corte: null,
      quadros: null,
      personagem: personagem ? personagem[1] : null,
      erroPagina: erro ? erro[1] : null,
      pista: dom.length === 0 ? '(o Chrome não devolveu DOM nenhum)' : null
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pedidaL = Number(tamanho[1]);
  const pedidaA = Number(tamanho[2]);
  const largura = clamp(pedidaL, LIMITES.larguraMin, LIMITES.larguraMax);
  const altura = clamp(pedidaA, LIMITES.alturaMin, LIMITES.alturaMax);
  const cortes = [];
  if (largura !== pedidaL) cortes.push(`largura ${pedidaL} → ${largura}`);
  if (altura !== pedidaA) cortes.push(`altura ${pedidaA} → ${altura}`);
  return {
    medido: true,
    largura: largura,
    altura: altura,
    // Corte é achado, não detalhe: o PNG sai com um pedaço da folha faltando e
    // o revisor não tem como saber olhando a imagem.
    corte: cortes.length > 0 ? cortes.join(' · ') : null,
    forjaMs: forja ? Number(forja[1]) : null,
    quadros: quadros ? Number(quadros[1]) : null,
    personagem: personagem ? personagem[1] : null,
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
  const personagem = opcoes.personagem;

  conferirFontes(personagem);
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
  console.log(cor.fraco(`· personagem: ${personagem.chave} (${personagem.doc})`));

  mkdirSync(dirname(opcoes.saida), { recursive: true });
  const perfil = mkdtempSync(join(tmpdir(), 'isorogue-preview-'));
  const arquivo = pathToFileURL(HTML_BUILDADO).href;
  // O guerreiro continua sendo fotografado SEM fragmento nenhum: é o caminho de
  // antes desta fase, e ele não pode depender de código novo para funcionar.
  const urlBase =
    personagem === PADRAO ? arquivo : `${arquivo}#personagem=${personagem.chave}`;

  try {
    const medida = medirPagina(chrome.bin, perfil, urlBase);
    if (!medida.medido) {
      console.warn(
        cor.aviso('! a página não publicou seu tamanho — usando janela de reserva.') +
          (medida.pista ? ` ${cor.fraco(medida.pista)}` : '')
      );
    }
    if (medida.corte) {
      console.warn(
        cor.aviso(`! a folha não cabe no limite da captura e SAIU CORTADA: ${medida.corte}`) +
          `\n  ${cor.fraco('ajuste LIMITES em tools/preview-personagem.mjs ou enxugue a folha.')}`
      );
    }
    // A página diz qual ficha ela usou. Divergência aqui significa fragmento
    // ignorado ou chave sem ficha correspondente — fotografar assim mesmo
    // produziria um PNG do personagem errado com o nome do certo.
    if (medida.personagem && medida.personagem !== personagem.chave) {
      morrer(
        `a página desenhou "${medida.personagem}", não "${personagem.chave}".`,
        'a chave da ficha em tools/preview-entry.ts precisa bater com a daqui.'
      );
    }

    const sep = urlBase.includes('#') ? '&' : '#';
    const url =
      medida.forjaMs !== null ? `${urlBase}${sep}forja=${medida.forjaMs.toFixed(2)}` : urlBase;
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
      // O alvo de §7 é por ATLAS. A folha do elenco forja quatro deles, então
      // medir a soma contra 40 ms acusaria um estouro que não existe — e um
      // aviso amarelo que ninguém pode consertar é um aviso que se aprende a
      // ignorar, inclusive quando ele passar a ser verdade.
      if (personagem.somaForja) {
        // `rotulosSoma` existe porque a mensagem do elenco fala em "os 4 atlas",
        // e a folha de terreno forja outra coisa (dois modos por bloco). Um
        // rótulo herdado que conta atlas errado é a ferramenta mentindo baixinho.
        const rot = personagem.rotulosSoma;
        console.log(
          `  ${rot ? rot.forja : `forja dos ${ELENCO.length} atlas`}: ` +
            `${medida.forjaMs.toFixed(1)} ms ` +
            cor.fraco(
              rot
                ? rot.nota
                : '(soma — o alvo de < 40 ms de §7 é por atlas, ver as folhas individuais)'
            )
        );
      } else {
        const dentro = medida.forjaMs <= 40;
        console.log(
          `  forja do atlas: ${medida.forjaMs.toFixed(1)} ms ` +
            (dentro ? cor.ok('(alvo < 40 ms — ok)') : cor.aviso('(alvo < 40 ms — estourou)'))
        );
      }
    }
    if (medida.quadros !== null) {
      const rot = personagem.rotulosSoma;
      console.log(
        personagem.somaForja
          ? `  ${rot ? rot.quadros : `quadros nos ${ELENCO.length} atlas`}: ${medida.quadros}`
          : `  quadros no atlas: ${medida.quadros}`
      );
    }

    console.log(
      '\n' +
        cor.fraco(
          `Abra lado a lado com ${personagem.referencia} e responda ${personagem.gates} (${personagem.doc}).`
        )
    );
  } finally {
    rmSync(perfil, { recursive: true, force: true });
  }
}

principal();
