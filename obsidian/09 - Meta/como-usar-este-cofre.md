---
tipo: nota
atualizado: 2026-07-28
tags: [meta, convencao, cofre, escrita]
---

# 🧭 Como usar este cofre

Este cofre documenta o **ISOROGUE**: um roguelike 3D isométrico por turnos entregue como um
único arquivo HTML, em React 19 + TypeScript. Ele não substitui o código nem os contratos em
`docs/` — ele explica **por que** o código é assim e **o que quebra** quando alguém mexe.

## Por onde começar, conforme o que você quer

**Quero entender o jogo.**
[[visao-geral]] → [[_moc-sistemas-de-jogo]]. Em vinte minutos você sabe o que é gerado, o que
é visível, quem decide o movimento dos inimigos e o que consome um turno.

**Vou mexer no engine.**
[[camadas-e-fronteiras]] → [[determinismo]] → [[golden-test]], nessa ordem, **antes** de abrir
`src/engine/`. As três dizem o que é proibido e por quê; a terceira é quem vai te reprovar.
Depois, a nota do sistema específico pelo [[_moc-sistemas-de-jogo]].

**Vou mexer na arte ou no personagem.**
[[_moc-render-e-arte]] → [[ADR-004-personagem-por-codigo]] → [[personagem-rig-3d]] →
[[sprite-forge]]. Antes de reportar qualquer coisa como bug visual, passe pelas quatro
armadilhas listadas no MOC: três dos sintomas mais convincentes já se revelaram não-bugs.

**Só quero rodar e testar.**
[[rodar-e-buildar]] → [[rodar-os-testes]]. Para olhar o resultado: [[revisar-o-personagem]] e
[[inspecao-visual-headless]].

**Quero saber por que a decisão X foi tomada.**
A pasta `02 - ADRs/`, indexada em [[_moc-arquitetura]]. ADR não descreve o código: descreve o
contexto, a alternativa descartada e o preço.

## As pastas

| Pasta | O que entra | Tipo no frontmatter |
|---|---|---|
| `00 - Indice/` | os três MOCs; nada mais | `indice` |
| `01 - Arquitetura/` | estrutura, fronteiras, build, determinismo, o oracle | `nota` |
| `02 - ADRs/` | decisões com contexto e consequência, numeradas e imutáveis | `adr` |
| `03 - Sistemas de Jogo/` | um módulo de `src/engine/` por nota | `nota` |
| `04 - Render e Arte/` | um módulo de `src/render/` por nota | `nota` |
| `05 - Runbooks/` | procedimento executável, com a saída esperada | `runbook` |
| `06 - Aprendizados/` | erro real: sintoma → causa → lição | `aprendizado` |
| `07 - Changelog/` | uma nota por data, `AAAA-MM-DD-assunto` | `changelog` |
| `09 - Meta/` | como o cofre funciona | `nota` |

## Convenções de escrita

**Frontmatter em toda nota**, sem exceção:

```yaml
---
tipo: nota            # nota | adr | indice | runbook | aprendizado | changelog
atualizado: 2026-07-28
tags: [3 a 5 tags, minusculas]
---
```

**Um H1 com emoji**, curto, logo abaixo do frontmatter. É ele que aparece na busca.

**Cite `arquivo:linha` ao afirmar algo sobre o código** — `src/engine/fov.ts:141`, não "no
FOV". Linha citada é linha que alguém consegue conferir; afirmação sem endereço envelhece sem
aviso.

**Trecho de código curto, e só quando esclarece.** Cinco linhas que mostram a regra valem mais
que a função inteira, que já está no repositório e não precisa de cópia.

**Toda nota responde "por que" e "o que quebra se mudar".** Se a nota só descreve o que o
código faz, ela é redundante com o código e vai apodrecer primeiro. As notas de
`03 -` e `04 -` fecham com uma seção explícita de "o que quebra"; siga o padrão.

**Escreva o que dá para verificar.** Onde faltou medição, diga que faltou. O cofre já tem
pendências assumidas — a silhueta atarracada do guerreiro, o balanceamento nunca jogado por
humano — e é isso que o torna confiável.

## Regra do MOC

**Nota nova entra num MOC no mesmo momento em que é criada.** Nota órfã não é encontrada:
ninguém navega este cofre pelo explorador de arquivos, navega pelos três índices de
`00 - Indice/`. Escolha o MOC pelo tema, não pela pasta — um ADR de arte é indexado em
[[_moc-render-e-arte]], mesmo morando em `02 - ADRs/`.

E entre com **uma linha de contexto**, não só o nome: o MOC existe para responder "por que eu
clicaria aqui".

## Nomes e links

Nome de arquivo em minúsculas, sem acento, palavras separadas por hífen —
`campo-de-visao-shadowcasting.md`. Link sempre pelo nome do arquivo sem extensão entre
colchetes duplos — [[campo-de-visao-shadowcasting]] — nunca por caminho com pasta: o nome é
único no cofre inteiro, e mover a nota de pasta não deve quebrar nada.

---

Índices: [[_moc-arquitetura]] · [[_moc-sistemas-de-jogo]] · [[_moc-render-e-arte]]
