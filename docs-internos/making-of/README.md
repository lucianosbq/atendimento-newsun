# Confecção do Atendimento NewSun IA — índice

Esta pasta registra **como** o MVP do atendimento com IA foi construído: infraestrutura real
provisionada, decisões tomadas, bugs reais encontrados e corrigidos, e o estado exato em que o
projeto ficou. Complementa (não substitui) os documentos de referência técnica que já existiam em
`docs-internos/` (`ARCHITECTURE.md`, `API.md`, `SECURITY.md`, `APPROVAL-KB.md`,
`WHATSAPP-TEMPLATES.md`, `DEPLOY.md`).

| Arquivo | Conteúdo |
|---|---|
| [01-visao-geral.md](01-visao-geral.md) | O que é o projeto, para quem, e o que ele resolve |
| [02-infraestrutura-real.md](02-infraestrutura-real.md) | Contas, URLs, IDs e recursos de verdade no ar (não um template) |
| [03-cronologia-da-construcao.md](03-cronologia-da-construcao.md) | A história: o que foi feito, na ordem, com cada bug real e sua causa raiz |
| [04-base-de-conhecimento.md](04-base-de-conhecimento.md) | Como o RAG foi populado — os 24 documentos, o processo de aprovação, o bug do token |
| [05-estado-atual-e-pendencias.md](05-estado-atual-e-pendencias.md) | Checklist do que está pronto e do que falta, com o motivo de cada pendência |

Também existe um painel visual consolidado, pensado para leitura rápida em vez de navegar pelos
`.md`: https://claude.ai/code/artifact/19efa7ff-f0bd-4124-b8bb-35cf2d7c489d

## Como este material foi produzido

Toda a construção — provisionamento de infraestrutura, correção de bugs, testes — foi feita numa
sessão guiada do Claude Code via `claude-in-chrome` (o navegador real do Luciano), com o Luciano
sempre digitando pessoalmente qualquer credencial ou secret nos formulários oficiais (Cloudflare,
GitHub, Bitrix). O Claude nunca teve acesso ao valor de nenhum segredo — só orientou onde clicar e
o que colar, e testou o resultado depois.
