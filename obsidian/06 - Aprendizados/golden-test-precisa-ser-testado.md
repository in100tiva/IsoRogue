---
tipo: aprendizado
atualizado: 2026-07-28
tags: [testes, golden, mutacao, migracao, oracle]
---

# 🧪 Um golden que nunca reprovou é hipótese, não garantia

## O sintoma (que não existia)

O golden test passou de primeira em todos os 12 casos. Isso deveria ser bom notícia, e é
— mas é também a situação em que você **não sabe nada** sobre o teste. Um oracle de 1,4 MB
comparando 12 sementes × 200 comandos × 2 passadas pode estar comparando string vazia com
string vazia e reportar verde do mesmo jeito. Verde por acerto e verde por indiferença
têm exatamente a mesma cor.

## O experimento

Mutação deliberada no engine, num único ponto e no menor delta possível:

```ts
// src/engine/entities.ts:110
export const WOUNDED_RATIO = 0.3;   // → 0.31 na mutação
```

Um ponto percentual no limiar em que o inimigo ferido entra em fuga
(`isWounded`, `src/engine/entities.ts:313-315`). É a mudança de balanceamento mais
discreta que se consegue fazer: só afeta um inimigo que esteja com HP na faixa estreita
entre 30% e 31% do máximo, num turno em que ele decida se persegue ou foge.

**O golden pegou.** Falhou em `GOLD-0008`, **comando 94 de 200**, com o bloco de
"PRIMEIRA DIVERGÊNCIA" completo (`test/golden.test.ts:543-566`): o comando exato, se o
oracle e o port o aceitaram, os hashes divergentes, o snapshot anterior, o snapshot
obtido, o caractere onde as strings passam a diferir, o último marco de 10 turnos ainda
igual, e a linha de reprodução — `createState('GOLD-0008', depth)` mais 95 comandos.

Ou seja: além de detectar, ele **localizou**. O relatório é ordenado cronologicamente de
propósito (mapa → população → estado inicial → comando a comando → marcos → progressão),
para que a primeira falha apontada seja sempre a primeira divergência real, não a mais
barulhenta.

## A lição

**Um teste de regressão que nunca falhou é uma hipótese sobre segurança, não uma
medição.** O valor dele só é conhecido quando você o vê reprovar de propósito. O custo do
experimento é ridículo — trocar um dígito, rodar, reverter — e o que ele compra é a
diferença entre "o golden protege a migração" e "acho que o golden protege a migração".

Duas propriedades que a mutação confirmou de graça:

1. **Sensibilidade.** Uma mudança de comportamento que nenhum humano notaria jogando
   aparece no comando 94. A cobertura não é "os 200 comandos rodam", é "os 200 comandos
   comparam estado".
2. **Diagnóstico.** O teste não diz apenas "falhou": diz onde, com o que, e como
   reproduzir em duas linhas.

Vale registrar o corolário: `player.facing` foi acrescentado ao engine no mesmo dia e o
golden **não** reprovou. Isso não é falha de sensibilidade, é o desenho funcionando —
`facing` é cosmético e nunca entra em `snapshot()` nem em `extrairJogador()`
(`test/golden.test.ts:118` e `:233-238`). Ver
[[ADR-005-facing-cosmetico-invisivel-ao-oracle]].

## O que quebra se mudar

- Regerar `test/golden/snapshots.json` para acomodar código novo destrói o oracle. A
  regra de ouro está escrita no topo do teste: se algo divergir, **o errado é o port**.
- Afrouxar a comparação (comparar só o snapshot final, ou só os hashes) mata a
  localização: você fica sabendo que quebrou, não onde.
- Mexer em qualquer constante de balanceamento durante a migração é, por construção,
  falha do golden. Isso é intencional.

Ver [[golden-test]], [[ADR-003-golden-test-como-oracle-da-migracao]], [[rodar-os-testes]]
e [[determinismo]].
