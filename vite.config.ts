// `vitest/config` reexporta o `defineConfig` do Vite com a chave `test` tipada.
// Importar de 'vite' deixava `npm run typecheck` vermelho (TS2769) e derrubava
// o gate `npm run check` — o build gerado é exatamente o mesmo.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// O entregável continua sendo UM arquivo HTML auto-contido (docs/BRIEF.md R01/R02/R56).
// viteSingleFile inlina JS e CSS no dist/index.html — nenhuma requisição de rede em runtime.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false
  },
  // `environmentMatchGlobs` foi REMOVIDO no Vitest 4 e era ignorado em silêncio:
  // configuração morta que dava falsa sensação de cobertura. O mecanismo real —
  // e único — é o docblock `// @vitest-environment jsdom` no topo do arquivo de
  // teste (test/ui.test.tsx:1). Não o remova de lá.
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx']
  }
});
