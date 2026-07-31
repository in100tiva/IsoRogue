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
  /**
   * Só a forma com `withFileTypes: true`, que é a que T9 usa para varrer `src/`
   * sem depender do utilitário Unix `find`. A sobrecarga sem opções devolveria
   * `string[]` e convidaria a um `statSync` por entrada — mais chamadas e mais
   * superfície de shim para o mesmo resultado.
   */
  export function readdirSync(
    caminho: string,
    opcoes: { withFileTypes: true }
  ): readonly { name: string; isDirectory(): boolean }[];
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:path' {
  export function join(...partes: readonly string[]): string;
}

/** Só o que o teste T9 precisa para repassar o ambiente e achar o Node. */
declare const process: {
  env: Record<string, string | undefined>;
  /** Caminho do executável do Node — usado para invocar o vite sem passar por `npx`. */
  execPath: string;
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
