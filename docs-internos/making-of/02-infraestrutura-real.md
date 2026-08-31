# Infraestrutura real (não um template)

Diferente de `DEPLOY.md` (que ensina a montar isso do zero em qualquer conta), esta página registra
o que está **de fato no ar** hoje, com os valores reais.

## Cloudflare

- **Conta**: `lucianosbq@gmail.com`, account ID `76cd9685874f28bcd100eca5294f1f03`
- **Worker**: `newsun-atendimento-api` — `https://newsun-atendimento-api.lucianosbq.workers.dev`
- **D1**: `newsun-atendimento`, database ID `8a3eff25-2c5f-4a49-ba08-af8f78a0b483`
- **Vectorize**: `newsun-public-knowledge`, 1024 dimensões (compatível com o modelo de embedding
  `@cf/baai/bge-m3`), métrica cosseno
- **Turnstile**: widget "NewSun Atendimento IA", site key `0x4AAAAAAEjAspbfdd5vPf1J`, hostname
  `lucianosbq.github.io`, modo Managed
- **R2**: não ativado — a Cloudflare exige cartão cadastrado mesmo no plano gratuito; upload de
  conta de luz pelo clipe do chat fica indisponível até isso ser resolvido (ver
  [05-estado-atual-e-pendencias.md](05-estado-atual-e-pendencias.md))
- **Plano**: gratuito em toda a stack usada hoje

## GitHub

- **Repositório**: `lucianosbq/atendimento-newsun`
- **Pages**: publicado via GitHub Actions (não pelo branch clássico), servindo a pasta `docs/`
- **URL pública**: `https://lucianosbq.github.io/atendimento-newsun/`

## Bitrix24

- **Portal**: `newsun.bitrix24.com.br`
- **Webhook**: reaproveita o webhook já existente da NewSun OS (não um escopado só para o
  atendimento) — decisão consciente do Luciano, feita no início do projeto
- **Entidade usada**: Lead (`crm.lead.add`), com deduplicação por telefone/e-mail
  (`crm.duplicate.findbycomm`) antes de criar um card novo
- **Notificação**: mensageria interna do Bitrix (`im.notify.system.add`), não WhatsApp — funciona
  sem depender de nenhuma configuração de Meta

## Variáveis e secrets do Worker

Cadastradas em Cloudflare → Workers & Pages → `newsun-atendimento-api` → Settings → Runtime
variables and secrets. Os secrets (tipo "Secret") nunca são visíveis de novo depois de salvos —
só sobrescrevíveis.

| Nome | Tipo | Papel |
|---|---|---|
| `ADMIN_INGEST_TOKEN` | Secret | autoriza `POST /v1/admin/knowledge` (ingestão da base) |
| `BITRIX_WEBHOOK_URL` | Secret | URL base do webhook do Bitrix |
| `DEPARTMENT_ROUTES_JSON` | Secret | mapa departamento → pessoa responsável (ver tabela em `DEPLOY.md`) |
| `PII_ENCRYPTION_KEY` | Secret | chave AES-256-GCM para criptografar dado pessoal no D1 |
| `RATE_LIMIT_SALT` | Secret | sal HMAC para chaves de rate limit e idempotência |
| `TURNSTILE_SECRET` | Secret | valida o token do Turnstile no servidor |
| `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Secret | WhatsApp Cloud API — **ainda não preenchidos** |
| `N8N_HANDOFF_URL`, `N8N_SHARED_SECRET` | Secret | integração opcional com n8n — não usada hoje |
| `ALLOWED_ORIGINS` | Text | `https://lucianosbq.github.io` |
| `RAG_TOP_K`, `RAG_MIN_SCORE`, `PUBLIC_KB_NAMESPACE` | Text | parâmetros de busca do RAG |
| `BUSINESS_HOURS_START/END/DAYS/TZ_OFFSET_MINUTES` | Text | janela de expediente para notificações |

## Frontend (`docs/config.js`)

```js
window.NEWSUN_CHAT_CONFIG = Object.freeze({
  apiBaseUrl: "https://newsun-atendimento-api.lucianosbq.workers.dev",
  turnstileSiteKey: "0x4AAAAAAEjAspbfdd5vPf1J",
  demoMode: false
});
```

Só a URL pública do Worker e a site key do Turnstile ficam no frontend — nada mais sensível entra
em código servido ao navegador.
