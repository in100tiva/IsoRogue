# AGENTS.md — base Kimi Code

## Framework kit-mcp (Kimi Code)

Este repositório contém a projeção do kit-mcp v1.46.0 para Kimi Code em `.agents/` (fonte canônica: pacote npm `@luanpdd/kit-mcp`). O Kimi Code descobre agents e skills automaticamente no início da sessão.

- `.agents/agents/` — 86 subagentes (auditoria, Supabase, SRE, legacy, UI). Delegação automática ou explícita: "use o subagente `debugger` para X".
- `.agents/skills/<nome>/` — 103 skills de conhecimento, invocadas automaticamente conforme a tarefa.
- `.agents/skills/<nome>.md` — 99 comandos do framework; invoque com `/nome` (ex.: `/planejar-fase 12`, `/fazer "descrição"`).
- `.agents/framework/` — workflows e references internos dos comandos.

Notas para o agente Kimi:
- Referências `@./.agents/...` em comandos/skills NÃO são auto-expandidas: use a ferramenta Read no caminho indicado e siga o conteúdo.
- Hooks e `*.workflow.js` do Claude Code não existem no Kimi; ignore menções a eles.
- Comandos `/custo-*` dependem de MCP do Claude Code — não funcionam; use `/usage`.
- Ferramentas MCP (`mcp__supabase__*` etc.) só funcionam se configuradas via `/mcp-config`; sem elas, adapte com ferramentas nativas.
- Respostas e artefatos em pt-BR. Comandos de fase operam sobre `.planning/` do projeto.
