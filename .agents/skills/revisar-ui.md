---
disableModelInvocation: true
name: revisar-ui
description: Auditoria visual retroativa de 6 pilares do código frontend implementado
argument-hint: "[fase]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---
<objective>
Realiza uma auditoria visual retroativa de 6 pilares. Produz UI-REVIEW.md com
avaliação graduada (1-4 por pilar). Funciona em qualquer projeto.
Saída: {phase_num}-UI-REVIEW.md
</objective>

<execution_context>
@./.agents/framework/workflows/ui-review.md
@./.agents/framework/references/ui-brand.md
</execution_context>

<context>
Fase: $ARGUMENTS — opcional, padrão é a última fase concluída.
</context>

<process>
Execute @./.agents/framework/workflows/ui-review.md do início ao fim.
Preserve todos os gates do workflow.
</process>
