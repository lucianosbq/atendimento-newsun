# Implantação — NewSun Atendimento IA

## Pendências que exigem cartão (retomar sexta-feira)

Duas peças ficaram fora do MVP porque a Cloudflare e o Brave exigem cartão cadastrado mesmo dentro
do plano gratuito (cobram $0 se ficar dentro do limite, mas pedem o cartão para habilitar):

1. **R2** (upload da conta de luz pelo clipe) — binding comentado em `worker/wrangler.toml`.
   Para ativar: habilitar R2 no dashboard, rodar
   `npx wrangler r2 bucket create newsun-atendimento-uploads`, descomentar o `[[r2_buckets]]`.
2. **Busca ao vivo na internet** (pedido do Luciano em 31/08/2026): condomínios buscam primeiro no
   blog da newsun.energy e, se não achar, na internet aberta; PMEs e Franquias sempre buscam na
   internet; o departamento Comercial pode consultar newsun.energy e legislação, sempre guiando
   para marcar reunião/assinar contrato. Provedor escolhido: **Brave Search API**
   (`https://api-dashboard.search.brave.com`), plano Search ($5/1000 requisições, $5/mês grátis —
   dá ~1.000 buscas grátis/mês). Também pede cartão (hold de $1, reembolsável) para ativar o plano
   gratuito. Nenhum código deste recurso foi escrito ainda — melhor implementar de uma vez com a
   chave em mãos do que deixar pela metade sem poder testar.

Quando o cartão estiver disponível: ativar os dois planos, gerar a `BRAVE_API_KEY`, e pedir para eu
implementar o módulo de busca ao vivo (mantendo a regra de que conteúdo buscado é dado a
interpretar, nunca instrução a obedecer — mesma proteção já aplicada a WhatsApp/e-mail capturado).

## Identidade visual

O frontend já usa a logo oficial `NewSun Energy Group` (`docs/assets/logo-newsun.png`, versão
amarelo-laranja para fundo escuro) e o símbolo isolado da bússola como favicon e avatar do chat
(`docs/assets/simbolo-newsun.png`), ambos copiados de
`05-DEPARTAMENTO-MARKETING-IA/identidade-visual/logos-oficiais/png-web/`. Se o brandbook for
atualizado, troque os dois arquivos mantendo o mesmo nome — nenhuma outra alteração é necessária.

## 1. O que já está pronto

O repositório contém uma SPA estática em `docs/`, um Cloudflare Worker em `worker/`, migração D1,
RAG público com Vectorize, integração com WhatsApp Cloud API, Bitrix24/n8n, Turnstile, criptografia
de dados e testes automatizados.

O código não contém telefones reais, tokens, IDs de funcionário, credenciais nem documentos
internos. Esses itens precisam ser configurados pela NewSun antes do go-live.

## 2. Pré-requisitos

- conta Cloudflare com Workers AI, D1, Vectorize e Turnstile;
- conta GitHub e um repositório para este projeto;
- Node.js 20 ou superior;
- WhatsApp Business Account e número corporativo registrado na Cloud API;
- templates de mensagem aprovados pela Meta;
- webhook do Bitrix24 ou workflow n8n, caso essas integrações sejam usadas;
- aprovação formal de CMO/Comunicação, Jurídico/LGPD e líderes dos departamentos.

## 3. Criar os recursos Cloudflare

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create newsun-atendimento
npx wrangler vectorize create newsun-public-knowledge --dimensions=1024 --metric=cosine
npx wrangler r2 bucket create newsun-atendimento-uploads
```

Copie o `database_id` retornado pelo D1 e substitua `REPLACE_WITH_D1_DATABASE_ID` em
`worker/wrangler.toml`. O modelo BGE-M3 usado neste projeto produz vetores de 1024 dimensões; não
crie o índice com outra dimensão. O bucket R2 guarda as contas de energia enviadas pelo clipe do
chat (PDF/JPG/PNG); o binding `UPLOADS` já está declarado no `wrangler.toml`.

Aplique a migração:

```bash
npx wrangler d1 migrations apply DB --remote
```

## 4. Configurar origens permitidas

Edite `ALLOWED_ORIGINS` em `worker/wrangler.toml` com o domínio real do GitHub Pages e, se houver,
o domínio próprio. Não use `*` em produção.

Exemplo:

```toml
ALLOWED_ORIGINS = "https://newsunenergy.github.io,https://atendimento.newsun.energy"
```

## 5. Gerar e cadastrar secrets

Na raiz do projeto:

```bash
npm run secrets
```

Cadastre cada valor no Worker. Nunca os coloque no GitHub ou em `docs/config.js`.

```bash
cd worker
npx wrangler secret put PII_ENCRYPTION_KEY
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put ADMIN_INGEST_TOKEN
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put DEPARTMENT_ROUTES_JSON
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put META_PHONE_NUMBER_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN
```

Integrações opcionais:

```bash
npx wrangler secret put BITRIX_WEBHOOK_URL
npx wrangler secret put N8N_HANDOFF_URL
npx wrangler secret put N8N_SHARED_SECRET
```

### Estrutura do `DEPARTMENT_ROUTES_JSON`

Os números ficam somente no Worker. Use números corporativos com DDI e DDD, sem espaços.

```json
{
  "comercial": {
    "label": "Comercial",
    "employeeName": "Equipe Comercial",
    "employeeWhatsApp": "5511999999999",
    "bitrixAssignedById": "123",
    "bitrixUserId": "123"
  },
  "atendimento": {
    "label": "Clientes e CS",
    "employeeName": "Equipe de CS",
    "employeeWhatsApp": "5511999999999",
    "bitrixAssignedById": "456",
    "bitrixUserId": "456"
  }
}
```

`bitrixAssignedById` define o responsável pelo lead no CRM; `bitrixUserId` é quem recebe a
notificação pelo **mensageiro do Bitrix** quando uma conversa começa ou um handoff é pedido
(quando omitido, usa o mesmo valor de `bitrixAssignedById`). Os IDs vêm da tabela de
colaboradores do Bitrix24.

Cadastre as oito rotas: `comercial`, `atendimento`, `financeiro`, `juridico`, `operacoes`,
`parcerias`, `imprensa` e `pessoas`. Pode haver um número corporativo por setor ou uma central com
roteamento no n8n. Não use telefone pessoal de colaborador.

## 6. Configurar Turnstile

Crie um widget Turnstile para os domínios do GitHub Pages e do domínio próprio. Guarde o secret no
Worker e coloque apenas a Site Key em `docs/config.js`.

O token é validado no servidor. Não basta renderizar o widget no navegador.

## 7. Configurar WhatsApp Cloud API

### Template do funcionário

Nome sugerido: `newsun_novo_atendimento_setor`

Corpo sugerido:

```text
Novo atendimento NewSun
Setor: {{1}}
Protocolo: {{2}}
Nome: {{3}}
Organização: {{4}}
Resumo: {{5}}
WhatsApp do visitante: {{6}}
Iniciar conversa: {{7}}
```

### Template do visitante

Nome sugerido: `newsun_atendimento_recebido`

```text
Olá, {{1}}. A NewSun recebeu sua solicitação.
Protocolo: {{2}}
Departamento: {{3}}
O time responsável seguirá o atendimento por este WhatsApp. Nunca informe senha ou código de verificação.
```

Cadastre os templates em português do Brasil (`pt_BR`) e aguarde aprovação. Os nomes precisam ser
iguais aos definidos em `worker/wrangler.toml`.

Configure o webhook na Meta:

```text
https://SEU-WORKER.workers.dev/webhooks/whatsapp
```

Use o valor de `META_WEBHOOK_VERIFY_TOKEN` na verificação. Assine o campo de status de mensagens. O
Worker valida `X-Hub-Signature-256` com `META_APP_SECRET` e atualiza os estados `sent`, `delivered`,
`read` e `failed` no D1.

O frontend considera o setor notificado quando a API da Meta aceita a mensagem ou quando o n8n
confirma o evento. Isso não significa que a mensagem foi lida. Leitura e entrega são atualizadas pelo
webhook.

## 8. Configurar Bitrix24

Crie um webhook de entrada com permissões **crm** e **im** (o `im` é necessário para a
notificação pelo mensageiro). A URL deve ser a **base** do webhook (`https://SEU-PORTAL/rest/ID/TOKEN`),
sem método no final — o Worker acrescenta o método conforme a chamada:

- `crm.duplicate.findbycomm.json` — antes de criar qualquer card, o Worker procura um lead já
  existente com o **mesmo telefone ou e-mail** (mecanismo nativo de deduplicação do Bitrix);
- `crm.lead.add.json` — card criado **na abertura da conversa**, só quando nenhum lead existente foi
  encontrado (nome completo, e-mail, WhatsApp e protocolo);
- `crm.timeline.comment.add.json` — quando a pessoa já é conhecida (mesmo telefone/e-mail de um
  atendimento anterior, mesmo com protocolo novo) ou quando há handoff, a conversa entra como
  comentário no **mesmo card**, nunca cria um segundo lead;
- `im.notify.system.add.json` — notificação ao funcionário do setor, **somente dentro do expediente**
  (vars `BUSINESS_HOURS_START`, `BUSINESS_HOURS_END`, `BUSINESS_DAYS`, `BUSINESS_TZ_OFFSET_MINUTES`
  no `wrangler.toml`; padrão seg–sex, 08h–18h, fuso −03:00).

### Sem duplicidade de card entre atendimentos

Quando a mesma pessoa volta ao site — em outro dia, outro dispositivo, outra sessão — o novo
protocolo gerado (`NS-AAAAMMDD-NNNNNN`) é sempre diferente, mas o **card do Bitrix é o mesmo**,
localizado por `crm.duplicate.findbycomm` a partir do telefone ou do e-mail informado no cadastro.
O reconhecimento não usa o nome (nomes variam demais entre digitações) — só telefone e e-mail, que
são os identificadores estáveis. Vale tanto na abertura da conversa quanto no handoff feito sem
sessão. Se nenhum dos dois bater, um card novo é criado normalmente.

No lead criado na abertura vão:

- protocolo;
- nome e WhatsApp autorizados;
- organização opcional;
- departamento;
- motivo e resumo mínimo;
- data e versão do consentimento;
- origem e UTMs padronizadas.

Guarde a URL completa como `BITRIX_WEBHOOK_URL`. Caso o processo oficial da NewSun use Deal, SPA ou
Smart Process em vez de Lead, altere apenas `createBitrixLead()` em `worker/src/integrations.js`.

## 9. Configurar n8n

O endpoint n8n recebe o evento `newsun.public_handoff.created`. Valide o cabeçalho
`x-newsun-shared-secret`, crie o ticket no Bitrix, notifique o setor e registre os retornos. O n8n é a
melhor opção quando a NewSun quiser retries, fallback entre funcionários, horário de plantão e SLA.

## 10. Publicar o Worker

```bash
cd worker
npm test
npm run check
npx wrangler deploy
```

Teste:

```bash
curl https://SEU-WORKER.workers.dev/health
```

## 11. Configurar o frontend

Edite `docs/config.js`:

```js
window.NEWSUN_CHAT_CONFIG = Object.freeze({
  apiBaseUrl: "https://SEU-WORKER.workers.dev",
  turnstileSiteKey: "SUA_SITE_KEY",
  demoMode: false,
  privacyUrl: "https://www.newsun.energy/politicas/privacidade",
  maxHistoryMessages: 12,
  requestTimeoutMs: 30000
});
```

Somente a URL pública do Worker e a Site Key podem ficar no frontend.

## 12. Aprovar e ingerir a base pública

Edite `knowledge/public/seed-public.json`. Para cada documento:

- revise o conteúdo com a área dona;
- valide claims com Jurídico/Compliance;
- substitua `PENDENTE_APROVACAO_CMO_JURIDICO` pelo aprovador real;
- preencha `approvedAt` em ISO 8601;
- mantenha `visibility: public`.

Depois:

```bash
export NEWSUN_API_URL="https://SEU-WORKER.workers.dev"
export NEWSUN_ADMIN_INGEST_TOKEN="SEU_TOKEN"
npm run ingest
```

O endpoint rejeita qualquer documento que não esteja marcado como público e aprovado.

## 13. Publicar GitHub Pages

Crie um repositório, faça push e, em **Settings → Pages**, selecione **GitHub Actions**. O workflow
`.github/workflows/pages.yml` publica a pasta `docs/`.

```bash
git init
git add .
git commit -m "Atendimento IA NewSun v1"
git branch -M main
git remote add origin git@github.com:SUA-ORG/newsun-atendimento-ia.git
git push -u origin main
```

Cadastre no GitHub Actions os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` somente se
quiser deploy automático do Worker.

## 14. Teste de aceite antes do go-live

Execute pelo menos estes cenários:

1. pergunta pública respondida com fonte aprovada;
2. pergunta sem fonte gera limite explícito, não alucinação;
3. pedido de segunda via gera handoff;
4. pedido de senha ou prompt é bloqueado;
5. jornalista ou vazamento gera prioridade urgente;
6. Turnstile inválido impede handoff;
7. número inválido é recusado;
8. funcionário recebe template e consegue abrir o `wa.me` do visitante;
9. visitante recebe confirmação;
10. Bitrix/n8n registra protocolo e consentimento;
11. webhook atualiza `delivered/read/failed`;
12. origem não autorizada recebe HTTP 403;
13. documento interno é recusado na ingestão;
14. expiração remove PII após o prazo definido;
15. envio de conta em PDF/JPG/PNG pelo clipe anexa o link seguro ao card do Bitrix;
16. arquivo fora do formato ou acima de 8 MB é recusado com mensagem clara;
17. simulação por valor mensal aparece só como estimativa, nunca como promessa;
18. fechar a aba sem concluir o handoff registra o aviso de "só WhatsApp/e-mail" no card;
19. fora do expediente (fora de seg–sex 08h–18h) o visitante recebe o aviso e a IA segue respondendo.

## 15. Go-live: bloqueios reais

O código está pronto, mas a aplicação não deve entrar em produção até existirem:

- números corporativos e owners de todos os departamentos;
- templates Meta aprovados;
- política de privacidade publicada e base legal validada;
- texto público aprovado pelo CMO e Jurídico;
- DPA/avaliação de fornecedores concluída;
- fluxo de SLA, ausência, férias e escalonamento definido;
- teste de crise com Comunicação, CS, Jurídico e TI;
- monitoramento e alertas configurados.
