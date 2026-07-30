/*
 * ISOROGUE — src/engine/vocab.ts
 *
 * O VOCABULÁRIO DE CONTRATO: as listas de nomes que viajam em TEXTO. Elas
 * aparecem no save, no `snapshot()` e na forma textual dos comandos
 * ('vender:gosma,3', 'criar:pocao'), então são nomes de protocolo — renomear
 * qualquer um aqui invalida saves e o oracle do golden.
 *
 * POR QUE UM MÓDULO SÓ PARA ISTO (a pergunta óbvia, respondida uma vez):
 * as tabelas de domínio — `ITENS`, `DROPS`, `RECEITAS` — moram em entities.ts,
 * e entities.ts depende de core.ts. Mas quem faz o parse do comando textual é
 * core.ts, e o parse precisa saber quais nomes existem para recusar
 * 'vender:banana,3' na porta. Importar entities de dentro de core fecharia o
 * ciclo `core → entities → mapgen → core`, e mapgen lê `CONFIG` no TOPO do
 * módulo (mapgen.ts:13): o primeiro import da cadeia pegaria `CONFIG` na zona
 * morta e o engine não subiria. Não é um risco teórico — é o que acontece
 * assim que alguém importa core.ts primeiro, que é o caso do teste do engine.
 *
 * Este módulo desata o nó porque não importa NADA além de tipos. Ele é a fonte
 * única das listas; entities.ts as reexporta para quem já as conhece de lá
 * (game.ts, save.ts, src/ui/panels/BagPanel.tsx, os testes).
 *
 * Sem regra de jogo aqui dentro: nomes, ordem e normalização, mais nada.
 */

import type { ItemKind, MaterialKind, ReceitaKind } from './types';

/* ------------------------------------------------------------------ *
 * Itens
 * ------------------------------------------------------------------ */

/**
 * Ordem canônica de iteração dos itens — ESPELHO EXATO da ordem de declaração
 * de `ITENS` (entities.ts) e contrato de saída: é ela que ordena a bolsa no
 * `snapshot()`, no save e nas linhas de registro da coleta.
 *
 * Nunca leia a bolsa por `Object.keys`: a ordem de um objeto aberto é
 * acidental, e o oracle não perdoa acidente.
 */
export const ITEM_KINDS: readonly ItemKind[] = [
  'potion',
  'gosma',
  'orelhaGoblin',
  'espadaGoblin',
  'peOgro',
  'clavaOgro'
];

/**
 * Normaliza um `kind` vindo de fora (save antigo, JSON de terceiro).
 * Desconhecido ou ausente vira `'potion'`: antes da fase dos despojos TODO
 * item era poção, então essa é a leitura correta de um save legado — e
 * degradar é sempre melhor do que recusar a run (mesmo espírito de
 * `normalizeFacing`).
 */
export function normalizeItemKind(v: unknown): ItemKind {
  if (typeof v !== 'string') return 'potion';
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    if (ITEM_KINDS[i] === v) return ITEM_KINDS[i];
  }
  return 'potion';
}

/**
 * Normaliza um MATERIAL vindo de fora. Devolve `null` para nome desconhecido e
 * também para `'potion'` — que é item, mas não é material (contrato antigo R7:
 * poção é contador, não vai para a bolsa e não se vende ao mercador).
 *
 * Aqui NÃO há degradação para poção, ao contrário de `normalizeItemKind`: um
 * material desconhecido chega por comando do jogador ('vender:banana,3'), e
 * transformar um erro de digitação numa venda de outra coisa seria roubo. Item
 * desconhecido num SAVE é outra história — lá degradar é o certo.
 *
 * "Material é tudo que não é poção" é a mesma definição do tipo
 * `MaterialKind = Exclude<ItemKind, 'potion'>` (types.ts) e da coluna
 * `material` da tabela `ITENS`; T12.0 prova que as três concordam.
 */
export function normalizeMaterialKind(v: unknown): MaterialKind | null {
  if (typeof v !== 'string') return null;
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const kind = ITEM_KINDS[i];
    if (kind !== v) continue;
    return kind === 'potion' ? null : kind;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Receitas
 * ------------------------------------------------------------------ */

/** Ordem canônica de iteração das receitas — o análogo de `ITEM_KINDS`. */
export const RECEITA_KINDS: readonly ReceitaKind[] = ['pocao', 'refino'];

/**
 * Normaliza uma receita vinda de fora (comando textual, JSON de terceiro).
 * Desconhecida vira `null`, pela mesma razão de `normalizeMaterialKind`: chutar
 * uma receita gastaria material do jogador por causa de um nome errado.
 */
export function normalizeReceita(v: unknown): ReceitaKind | null {
  if (typeof v !== 'string') return null;
  for (let i = 0; i < RECEITA_KINDS.length; i++) {
    if (RECEITA_KINDS[i] === v) return RECEITA_KINDS[i];
  }
  return null;
}
