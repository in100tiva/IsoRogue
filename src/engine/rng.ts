/*
 * ISOROGUE — src/engine/rng.ts
 *
 * Porte 1:1 do bloco "3. RNG — mulberry32" de legacy/src-vanilla/00-core.js.
 * Este arquivo é a BASE DE TODO O DETERMINISMO DO JOGO. Invariantes herdadas:
 *
 *  I1. `Math.random` é proibido em todo o projeto.
 *  I3. Todo valor produzido é função pura do estado uint32 `rng.s`.
 *      Snapshot/restauração de save = copiar `rng.s`.
 *  I5. Toda aritmética de 32 bits fecha com `>>> 0` — nunca vaza negativo.
 *
 * NÃO reescreva as expressões abaixo em forma "mais limpa": a ordem das
 * operações, os deslocamentos e os `>>> 0` são o contrato numérico. Qualquer
 * alteração muda todas as partidas já salvas e reprova o golden test.
 *
 * Ciclo de import com core.ts (rng -> hash32, core -> makeRng) é intencional e
 * seguro: ninguém chama o outro lado durante a avaliação do módulo, e ambas as
 * pontas são declarações de função (içadas na instanciação do módulo ESM).
 */

import { hash32 } from './core';
import type { Rng } from './types';

/*
 * Builtins içados para o escopo do módulo.
 * PERF (medido no vanilla, dentro de `node:vm`): ler `imul` de uma variável de
 * escopo em vez de `Math.imul` derruba 3M chamadas de u32() de 631ms para 33ms,
 * porque cada leitura de um global atravessa o proxy do contexto. No navegador
 * o ganho é neutro. Não remova estas linhas.
 */
const imul = Math.imul;
const floor = Math.floor;

/** 2^32 */
const UINT32_COUNT = 4294967296;

/**
 * mulberry32 com estado uint32 exposto em `s`.
 *
 * Os métodos vivem no protótipo (era `Object.create(rngProto)` no vanilla):
 * `fork` é frequente e o objeto precisa ser barato de criar, e o estado
 * serializável precisa ser exatamente uma propriedade.
 */
class Mulberry32 implements Rng {
  s: number;

  constructor(seedUint32?: number | null) {
    this.s = (seedUint32 === null || seedUint32 === undefined ? 0 : seedUint32) >>> 0;
  }

  /**
   * Próximo uint32 da sequência mulberry32.
   * Avança o estado `s` (uint32) exatamente um passo.
   */
  u32(): number {
    // s = (s + 0x6D2B79F5) mod 2^32
    const a = (this.s + 0x6d2b79f5) >>> 0;
    this.s = a;
    let t = imul(a ^ (a >>> 15), 1 | a);
    // O `^ t` final faz a truncagem para int32 do somatório (ToInt32).
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float em [0, 1). Divisão por 2^32 — nunca alcança 1. */
  next(): number {
    return this.u32() / UINT32_COUNT;
  }

  /**
   * Inteiro em [a, b] — INCLUSIVO nos dois extremos.
   *
   * Uniformidade: rejection sampling (modulo rejection). Descartamos a franja
   * superior do espaço uint32 que não é múltipla exata do intervalo, eliminando
   * o viés de módulo. O laço termina com probabilidade 1 e, na prática, quase
   * sempre na primeira iteração.
   */
  int(a: number, b: number): number {
    const lo = floor(a);
    const hi = floor(b);
    if (!(hi > lo)) return lo; // intervalo degenerado ou invertido
    const range = hi - lo + 1;
    if (range >= UINT32_COUNT) return lo + this.u32();
    const limit = UINT32_COUNT - (UINT32_COUNT % range);
    let v = this.u32();
    while (v >= limit) v = this.u32();
    return lo + (v % range);
  }

  /** Float em [a, b). */
  float(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** Elemento aleatório do array; `undefined` se vazio/inválido. */
  pick<T>(arr: readonly T[] | null | undefined): T | undefined {
    if (!arr || arr.length === 0) return undefined;
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Fisher–Yates in place (varredura do fim para o início).
   * Retorna o PRÓPRIO array (contrato).
   */
  shuffle<T>(arr: T[]): T[] {
    if (!arr) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      if (j !== i) {
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
    return arr;
  }

  /**
   * `true` com probabilidade p (0..1).
   * Consome exatamente um u32 sempre — inclusive para p=0 e p=1 — para que a
   * sequência não dependa do valor de p (determinismo estável a refactor).
   * next() ∈ [0,1): chance(0) é sempre false, chance(1) é sempre true.
   */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Sub-stream derivado e independente.
   *
   * Semente do filho = hash32(tag) ^ estado atual do pai (antes de avançar).
   * O pai avança EXATAMENTE um u32(), independentemente de quanto o filho for
   * usado depois — é isso que torna `fork` reprodutível: consumir o filho nunca
   * perturba a sequência do pai.
   *
   * Tags distintas a partir do mesmo estado produzem streams distintos (hash32
   * espalha o tag por todos os 32 bits antes do XOR).
   */
  fork(tag: string): Rng {
    const seed = (hash32(tag) ^ this.s) >>> 0;
    this.u32(); // avanço fixo do pai
    return makeRng(seed);
  }
}

/**
 * Cria um RNG mulberry32 com estado uint32 exposto em `rng.s`.
 * Para snapshot/save basta guardar `rng.s`; para restaurar, `makeRng(saved.s)`
 * reproduz a sequência exatamente.
 */
export function makeRng(seedUint32?: number | null): Rng {
  return new Mulberry32(seedUint32);
}
