/*
 * ISOROGUE — tipos mínimos dos módulos de Node usados SÓ pelos testes.
 *
 * Por que este arquivo existe: `@types/node` não está nas dependências do
 * projeto e o `tsconfig.json` (que esta fase não pode alterar) declara
 * `"types": ["vitest/globals"]`. Sem isto, `import { readFileSync } from
 * 'node:fs'` reprova o `tsc --noEmit` — e a alternativa seria espalhar `any`
 * pelos testes, coisa que o §8.1 do docs/ARQUITETURA-REACT.md proíbe.
 *
 * Escopo deliberadamente mínimo: apenas as assinaturas que test/*.test.ts usa,
 * nada além. Não emite runtime, não entra no bundle, não toca no engine.
 * Quando o projeto adotar `@types/node`, este arquivo pode ser apagado.
 */

declare module 'node:fs' {
  export function readFileSync(caminho: string | URL, codificacao: 'utf8'): string;
  export function existsSync(caminho: string | URL): boolean;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** Só o que o teste T9 precisa para repassar o ambiente ao build. */
declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'node:child_process' {
  export interface ExecFileSyncOptions {
    cwd?: string;
    encoding?: 'utf8';
    stdio?: 'pipe' | 'inherit' | 'ignore';
    timeout?: number;
    env?: Record<string, string | undefined>;
  }
  export function execFileSync(
    arquivo: string,
    args?: readonly string[],
    opcoes?: ExecFileSyncOptions
  ): string;
}
