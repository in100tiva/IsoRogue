/**
 * Build da BANCADA DE REVISÃO do personagem (docs/PERSONAGEM.md §10).
 * Não tem relação com o entregável do jogo: `vite.config.ts` continua sendo a
 * única configuração que produz `dist/index.html`. Este arquivo produz
 * `.preview/preview.html`, um HTML auto-contido que existe só para ser
 * fotografado por `tools/preview-personagem.mjs`.
 *
 * Por que reusar o Vite em vez de um bundler avulso: o projeto está no Vite 8,
 * que roda sobre Rolldown e NÃO expõe esbuild. Não há como transpilar o
 * `preview-entry.ts` "na mão" sem inventar uma dependência — e dependência nova
 * é proibida. O Vite já está aqui, já resolve TS e já sabe inlinar tudo.
 *
 * `root` é a pasta `tools/` para que a saída seja `.preview/preview.html` e não
 * `.preview/tools/preview.html`; imports relativos a `../src/**` continuam
 * funcionando normalmente no build.
 */
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const DIR_TOOLS = fileURLToPath(new URL('tools', import.meta.url));
const DIR_SAIDA = fileURLToPath(new URL('.preview', import.meta.url));

export default defineConfig({
  root: DIR_TOOLS,
  // O HTML é aberto por file://, então nada pode virar caminho absoluto.
  base: './',
  // Sem o plugin de React: a bancada é DOM + Canvas 2D puro, sem JSX.
  plugins: [viteSingleFile()],
  build: {
    outDir: DIR_SAIDA,
    // outDir fora do root — declarar explicitamente evita o aviso e a recusa de limpar.
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
    // Bancada é ferramenta de diagnóstico: bundle legível vale mais que bundle pequeno.
    minify: false,
    rollupOptions: {
      input: fileURLToPath(new URL('tools/preview.html', import.meta.url))
    }
  }
});
