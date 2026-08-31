# NewSun Atendimento IA

Aplicação funcional de atendimento público com IA, triagem por departamento e handoff auditável
para WhatsApp, desenhada para **responder primeiro e encaminhar só quando necessário**.

## O que entrega

- frontend responsivo e acessível em **GitHub Pages**;
- backend em **Cloudflare Workers**;
- **Llama 3.3 70B** no Workers AI;
- RAG multilíngue com **BGE-M3 + Vectorize + D1**;
- base isolada que aceita apenas conteúdo `public` aprovado;
- proteção contra prompt injection, exfiltração e claims indevidos;
- redaction de PII antes do contexto da IA;
- oito departamentos, cada um com **fluxo guiado por botões** (o comercial segue o roteiro inbound completo de qualificação PME, com gatilhos de lead quente);
- **cadastro na abertura** (nome completo, e-mail e WhatsApp) com **protocolo gerado no início da conversa**;
- **card criado no Bitrix24 no momento em que a conversa começa**, atualizado na linha do tempo quando há handoff;
- **notificação ao funcionário pelo mensageiro do Bitrix**, apenas dentro do horário de expediente;
- protocolo, consentimento versionado e PII criptografada com AES-256-GCM;
- Cloudflare Turnstile no encaminhamento;
- WhatsApp Cloud API para notificar o setor e confirmar ao visitante;
- integração opcional com **Bitrix24 e n8n**;
- webhook Meta para `sent`, `delivered`, `read` e `failed`, com polling seguro no frontend;
- **envio da conta de energia pelo clipe do chat** (PDF, JPG ou PNG, até 8 MB), guardada no
  Cloudflare R2 e anexada como link seguro na linha do tempo do card no Bitrix;
- **simulação de economia por valor mensal informado**, para quem não tem a conta em mãos —
  sempre como estimativa declarada, nunca como promessa fechada;
- **detecção de abandono da tela** (fechar a aba ou ficar 3 minutos sem interagir): grava no card
  que a mensageria bidirecional pelo site não é mais possível e que o contato deve seguir por
  WhatsApp ou e-mail;
- **protocolo no formato `NS-AAAAMMDD-NNNNNN`** (6 dígitos), gerado já na abertura da conversa;
- **logo oficial NewSun Energy Group** (não é mais placeholder) no cabeçalho, favicon e avatar do chat;
- **expediente humano fixo em segunda a sexta, 8h às 18h** (fuso de Brasília) — fora dele a IA
  segue respondendo, mas avisa que o retorno humano só ocorre no próximo expediente;
- retenção e limpeza automática (inclui os arquivos enviados no R2);
- 24 testes automatizados.

## Jornada

```text
Visitante escolhe área
  → IA consulta apenas conhecimento público aprovado
  → tenta resolver a dúvida por completo
  → identifica limite, dado privado ou decisão humana
  → solicita consentimento + WhatsApp
  → gera protocolo e aciona o setor
  → aguarda confirmação técnica de entrega da notificação
  → só então informa que o visitante pode fechar o site
  → funcionário inicia o contato pelo WhatsApp corporativo
```

## Arquitetura

```text
GitHub Pages (docs/)
       │
       ▼
Cloudflare Worker (worker/)
  ├── Workers AI: Llama 3.3 70B
  ├── Workers AI: BGE-M3
  ├── Vectorize: busca pública
  ├── D1: conhecimento + protocolos
  ├── Turnstile
  ├── WhatsApp Cloud API
  ├── Bitrix24
  └── n8n
```

## Decisão de modelo

O modelo principal é `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Gemma é tecnicamente viável,
mas o Llama foi escolhido para o MVP pela maior capacidade do modelo, janela de contexto e suporte
a chamadas estruturadas na plataforma. A qualidade em português precisa ser acompanhada por testes
reais; o código não trata preferência de modelo como verdade permanente. O embedding é
`@cf/baai/bge-m3`, com índice Vectorize de 1024 dimensões.

## Demonstração local

O frontend nasce com `demoMode: true`, portanto pode ser aberto sem credenciais:

```bash
python -m http.server 8080 --directory docs
```

Acesse `http://localhost:8080`.

## Testes

```bash
npm test
npm run check
```

Resultado validado na entrega: **24/24 testes aprovados**.

## Implantação

Comece por:

- `docs-internos/DEPLOY.md` — passo a passo completo;
- `docs-internos/ARCHITECTURE.md` — decisões e fluxos;
- `docs-internos/SECURITY.md` — privacidade, controles e riscos;
- `docs-internos/APPROVAL-KB.md` — governança da base pública;
- `docs-internos/WHATSAPP-TEMPLATES.md` — templates e handoff;
- `docs-internos/API.md` — endpoints.

## Estrutura do projeto

```text
docs/                       Frontend publicado no GitHub Pages
worker/                     Cloudflare Worker
  migrations/               Schema D1
  src/                      API, RAG, segurança e integrações
  test/                     Testes Node
knowledge/public/           Conteúdo candidato à aprovação pública
scripts/                    Geração de secrets e ingestão
.github/workflows/          Pages, testes e deploy do Worker
docs-internos/              Operação, arquitetura e governança
```

## Limitação real do WhatsApp

A API não funde automaticamente dois números pessoais. O desenho seguro é: o visitante autoriza o
contato; o Worker notifica um número corporativo do setor com o protocolo e um link `wa.me`; o
funcionário inicia a conversa; o visitante pode fechar a página. O número pessoal do funcionário nunca
vai para o GitHub Pages.

## Bloqueios antes de produção

O software está pronto para configuração, mas não está implantado porque faltam dados e credenciais que
só a NewSun pode fornecer: conta Cloudflare, WABA/número Meta, templates aprovados, rotas reais dos
departamentos, webhook Bitrix/n8n, política de privacidade e aprovação da base pública.

## Regra de segurança

**Nunca ingira PDFs internos, contratos, política de preço, listas, números pessoais, credenciais,
incidentes, e-mails, WhatsApp, Bitrix ou estratégia na base pública.** O sistema recusa
`visibility != public`, mas a classificação humana continua sendo o controle mais importante.
