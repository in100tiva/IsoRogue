// Guarda a regra §0 da docs/ARQUITETURA-REACT.md: o engine é puro.
// Falha o build se a camada de domínio encostar em React, DOM ou entropia não determinística.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;

const REGRAS = [
  {
    dir: 'src/engine',
    nome: 'engine (lógica pura)',
    proibido: [
      { re: /\bfrom\s+['"]react/, msg: 'import de react' },
      // `(?:\.\.\/)+` cobre subpastas ('../../ui/x'), não só um nível acima.
      { re: /\bfrom\s+['"](?:\.\.\/)+(ui|render)\//, msg: 'import de camada superior (ui/render)' },
      { re: /\bimport\s*\(\s*['"](?:\.\.\/)+(ui|render)\//, msg: 'import dinâmico de camada superior' },
      { re: /\bdocument\./, msg: 'acesso a document' },
      { re: /\bwindow\./, msg: 'acesso a window' },
      { re: /\bMath\.random\b/, msg: 'Math.random' },
      { re: /\bDate\.now\b|new Date\(/, msg: 'relógio real na lógica' },
      { re: /\bperformance\.now\b/, msg: 'performance.now na lógica' }
    ],
    // save.ts recebe o Storage por injeção; core.ts isola crypto atrás de newSeedString.
    // A chave é o CAMINHO relativo, nunca o basename: por basename um futuro
    // src/engine/<subpasta>/core.ts herdaria a isenção em silêncio.
    isentos: {
      'src/engine/save.ts': [/\bwindow\./],
      'src/engine/core.ts': [/\bwindow\./]
    }
  },
  {
    dir: 'src/render',
    nome: 'render (canvas imperativo)',
    proibido: [
      { re: /\bfrom\s+['"]react/, msg: 'import de react' },
      { re: /\bfrom\s+['"](?:\.\.\/)+ui\//, msg: 'import da camada de UI' },
      { re: /\bimport\s*\(\s*['"](?:\.\.\/)+ui\//, msg: 'import dinâmico da camada de UI' },
      { re: /\bMath\.random\b/, msg: 'Math.random' }
    ],
    isentos: {}
  }
];

function arquivos(dir) {
  const abs = join(RAIZ, dir);
  if (!existsSync(abs)) return [];
  const saida = [];
  for (const nome of readdirSync(abs)) {
    const p = join(abs, nome);
    if (statSync(p).isDirectory()) saida.push(...arquivos(join(dir, nome)));
    else if (/\.tsx?$/.test(nome)) saida.push(p);
  }
  return saida;
}

let falhas = 0;
let verificados = 0;

for (const regra of REGRAS) {
  for (const arquivo of arquivos(regra.dir)) {
    const rel = relative(RAIZ, arquivo);
    const isentos = regra.isentos[rel] || [];
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    verificados++;
    linhas.forEach((linha, i) => {
      // Ignora comentários de linha inteira — a regra vale para código.
      if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
      for (const { re, msg } of regra.proibido) {
        if (isentos.some((iso) => iso.source === re.source)) continue;
        if (re.test(linha)) {
          console.error(`  ${rel}:${i + 1} — ${msg}\n      ${linha.trim().slice(0, 100)}`);
          falhas++;
        }
      }
    });
  }
}

if (falhas > 0) {
  console.error(`\nFRONTEIRAS VIOLADAS: ${falhas} ocorrência(s) em ${verificados} arquivo(s).`);
  console.error('Ver docs/ARQUITETURA-REACT.md §0 — o engine não conhece React, DOM nem relógio.');
  process.exit(1);
}
console.log(`Fronteiras de camada OK (${verificados} arquivos verificados).`);
