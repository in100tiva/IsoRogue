// Guarda a regra §0 da docs/ARQUITETURA-REACT.md: o engine é puro.
// Falha o build se a camada de domínio encostar em React, DOM ou entropia não determinística.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, NUNCA `.pathname`. No Windows, `new URL('..', import.meta.url).pathname`
// devolve `/D:/projetos/...` — com uma barra inicial espúria que `existsSync` rejeita.
// O efeito não era um erro: a varredura devolvia lista VAZIA e o script saía 0, imprimindo
// "Fronteiras de camada OK (0 arquivos verificados)". Verde por vacuidade, com o gate de
// fronteiras inteiro desligado em silêncio. Ver a guarda de sanidade no fim do arquivo.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

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

/*
 * GUARDA DE SANIDADE — o gate tem de provar que OLHOU.
 *
 * Este script passou meses saindo com código 0 sem verificar UM arquivo sequer: o
 * `RAIZ` não resolvia no Windows, `arquivos()` devolvia lista vazia, e o laço nunca
 * rodava. Zero violações em zero arquivos é indistinguível de zero violações em
 * duzentos — do lado de fora, os dois imprimem sucesso.
 *
 * É o modo de falha mais perigoso que um gate pode ter, porque ele mente na direção
 * tranquilizadora. Um `exit 1` barulhento seria notado no primeiro dia; um verde
 * vazio sobrevive indefinidamente.
 *
 * O piso é deliberadamente frouxo (uma regra, um arquivo): não é uma meta de
 * cobertura, é um detector de varredura vazia. Se um dia `src/engine` ou
 * `src/render` for legitimamente esvaziado, este erro é o lembrete de atualizar a
 * regra em vez de herdar um gate morto.
 */
if (verificados === 0) {
  console.error('GATE CEGO: nenhuma fonte foi verificada.');
  console.error(`  RAIZ resolvida: ${RAIZ}`);
  console.error(`  existe? ${existsSync(RAIZ)}`);
  console.error('  Diretórios das regras:');
  for (const regra of REGRAS) {
    const dir = join(RAIZ, regra.dir);
    console.error(`    ${regra.dir} → ${dir} (existe: ${existsSync(dir)})`);
  }
  console.error('\nO script saiu verde sem olhar nada — isso é falha, não sucesso.');
  process.exit(1);
}

console.log(`Fronteiras de camada OK (${verificados} arquivos verificados).`);
