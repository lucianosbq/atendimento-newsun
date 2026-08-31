# Arquitetura e decisões técnicas

## Objetivo

Responder primeiro com conhecimento público aprovado e encaminhar apenas o que exige pessoa,
autenticação, decisão, documento particular ou risco. O visitante informa o WhatsApp uma única vez,
recebe protocolo e pode fechar o site depois que o setor é acionado.

## Componentes

```text
GitHub Pages
  └─ HTML/CSS/JS estático, sem secrets e sem dados de funcionários
        │ CORS + HTTPS
        ▼
Cloudflare Worker
  ├─ validação, rate limit, guardrails e roteamento
  ├─ Workers AI — Llama 3.3 70B
  ├─ Workers AI — BGE-M3 embeddings
  ├─ Vectorize — busca semântica em namespace público
  ├─ D1 — chunks aprovados, protocolos, eventos e retenção
  ├─ Turnstile — antiabuso no handoff
  ├─ WhatsApp Cloud API — funcionário e confirmação do visitante
  ├─ Bitrix24 — CRM/ticket
  └─ n8n — orquestração opcional
```

## Por que Llama 3.3 70B

Foram comparadas duas opções viáveis:

- **Llama 3.3 70B:** melhor escolha para o MVP por consistência em português, capacidade de seguir
  instruções complexas, JSON Mode e disponibilidade madura no Workers AI.
- **Gemma:** opção válida para testes de custo/latência, mas não foi escolhida como modelo principal
  porque o atendimento institucional exige maior margem de segurança em conversas ambíguas e
  multilíngues.

A escolha não é irreversível. `MODEL_CHAT` é variável de ambiente e permite teste controlado sem
reescrever a aplicação.

## Por que GitHub Pages + Worker

O GitHub Pages serve apenas arquivos públicos estáticos. Essa limitação é uma vantagem de segurança:
tokens Meta, telefones de funcionários, chaves, prompts e rotas privadas permanecem no Worker. Toda
operação sensível ocorre no backend.

## RAG com allowlist, não com acervo inteiro

O erro mais perigoso seria carregar todos os PDFs internos num vetor e tentar resolver a segurança só
com prompt. Este projeto faz o oposto:

1. o conteúdo passa por curadoria humana;
2. recebe `visibility: public`;
3. recebe aprovador e data;
4. só então é fragmentado e vetorizado;
5. a consulta busca exclusivamente no namespace público;
6. o modelo pode citar apenas IDs recuperados;
7. sem evidência, a resposta vira limite + handoff.

## Sequência de chat

```text
Visitante pergunta
  → valida formato e origem
  → rate limit
  → guardrail determinístico
  → remove PII do contexto
  → busca Vectorize
  → recupera chunks ativos no D1
  → Llama responde em JSON Schema
  → valida claims e fontes
  → mostra resposta ou recomenda humano
```

## Sequência de handoff

```text
Visitante autoriza contato
  → Turnstile server-side
  → valida telefone/consentimento
  → gera protocolo
  → criptografa PII com AES-256-GCM
  → grava D1
  → procura lead existente por telefone/e-mail (crm.duplicate.findbycomm); achou, reaproveita o card
  → WhatsApp do setor + Bitrix (lead novo ou comentário no card reaproveitado) + n8n
  → pelo menos um canal precisa aceitar
  → confirma ao visitante
  → webhook Meta atualiza entrega/leitura
  → cleanup exclui os dados ao fim da retenção
```

## Estados principais do protocolo

- `created` — persistido e ainda não notificado;
- `notified` — ao menos um canal aceitou;
- `notification_failed` — nenhum canal aceitou;
- `sent`, `delivered`, `read` — retorno do webhook Meta;
- `failed` — falha de entrega reportada pela Meta.

## Evolução recomendada depois do MVP

1. usar Cloudflare Queues para retries e dead-letter queue;
2. substituir rate limit D1 por WAF/Rate Limiting nativo;
3. criar console interno autenticado para curadoria e auditoria;
4. sincronizar status e SLA do Bitrix de volta ao protocolo;
5. adicionar avaliação de qualidade, resolução e CES sem armazenar conteúdo desnecessário;
6. executar evals automáticos de segurança, grounding e aderência de marca a cada mudança da base.
