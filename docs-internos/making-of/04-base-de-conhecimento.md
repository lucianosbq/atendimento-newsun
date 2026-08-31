# Base de conhecimento (RAG)

## Como funciona

`knowledge/public/seed-public.json` é a fonte única do que a IA pode citar. Cada documento precisa
de `visibility: "public"`, `approvedBy` e `approvedAt` reais — o script de ingestão
(`scripts/ingest-public.mjs`) valida **o lote inteiro** antes de mandar qualquer coisa: um único
documento pendente trava a ingestão de todos os outros.

```bash
$env:NEWSUN_API_URL = "https://newsun-atendimento-api.lucianosbq.workers.dev"
$env:NEWSUN_ADMIN_INGEST_TOKEN = "<token real, nunca um placeholder>"
npm run ingest
```

Depois de rodar, **aguarde 60-90 segundos** antes de testar no chat — o Vectorize é assíncrono e o
delay real é maior do que o "alguns segundos" que a documentação da Cloudflare sugere.

## Os 24 documentos ativos hoje

| Bloco | Quantidade | Origem |
|---|---|---|
| Governança do assistente (identidade, como funciona a assinatura, limites por área) | 10 | Conteúdo original do projeto, aprovado em sessão em 31/08/2026 |
| FAQ oficial do site (`newsun.energy/faq`) | 5 | 15 perguntas oficiais, agrupadas por tema |
| Institucional (expansão/nova sede) | 1 | Fato extraído de imprensa, reescrito para evitar reprodução de texto de terceiro |
| Conceitos gerais (bandeiras tarifárias, consumo sazonal) | 2 | Reescritos com palavras próprias — o `/blog` do site é clipping de imprensa, não posts próprios |
| Tratamento de objeção comercial | 6 | Padrões generalizados de `_base-unica/recuperacao-gravacoes/`, sem citar concorrente ou dado identificável |

## O que fica de fora, sempre

Transcrição de ligação real, e-mail, comentário de Bitrix, conversa de WhatsApp — qualquer coisa
com nome, telefone, valor de conta ou dado que identifique uma pessoa específica. Ver
[`../APPROVAL-KB.md`](../APPROVAL-KB.md) para o checklist completo de aprovação e
[`../SECURITY.md`](../SECURITY.md) para a classificação de dados.

## O bug do token de ingestão

Documentado em detalhe em
[03-cronologia-da-construcao.md](03-cronologia-da-construcao.md#fase-6--descoberta-do-rag-vazio-o-bug-mais-longo-da-sessão).
Resumo prático para não repetir: **confira que o valor colado no comando de ingestão é
exatamente o mesmo valor salvo no Cloudflare** — nunca um placeholder de exemplo, nunca um valor
gerado e esquecido de atualizar em um dos dois lugares. O log do Worker (`wrangler tail`) mostra
"Ok" mesmo quando a resposta HTTP real é 401 — não confie nele para confirmar autorização, olhe a
saída do próprio `npm run ingest` no terminal.
