# API do Cloudflare Worker

## `GET /health`

Retorna status e capacidades configuradas sem expor secrets.

## `GET /v1/departments`

Lista IDs e escopos públicos dos departamentos.

## `POST /v1/session`

Abre a conversa: valida o cadastro do visitante (nome completo, e-mail e WhatsApp), verifica o
Turnstile, gera o **número de protocolo**, grava a sessão com PII criptografada e **cria o card
(lead) no Bitrix24** imediatamente. Dentro do horário de expediente, também notifica o funcionário
do setor pelo **mensageiro do Bitrix** (`im.notify.system.add`).

```json
{
  "department": "comercial",
  "name": "Maria da Silva",
  "email": "maria@empresa.com.br",
  "phone": "5511988887777",
  "consent": true,
  "consentText": "Autorizo a NewSun a usar estes dados...",
  "requestId": "uuid",
  "turnstileToken": "token"
}
```

Resposta HTTP 201:

```json
{
  "ok": true,
  "protocol": "NS-20260830-482913",
  "sessionToken": "sess_uuid_secreto",
  "department": "comercial",
  "departmentLabel": "Comercial",
  "bitrixCardCreated": true,
  "withinBusinessHours": true,
  "message": "Cadastro registrado..."
}
```

O `sessionToken` volta no `/v1/handoff`: com ele o Worker reaproveita o protocolo, dispensa um
segundo Turnstile e registra o encaminhamento como comentário na linha do tempo do mesmo lead —
sem duplicar card.

## `POST /v1/chat`

Requer `Origin` presente na allowlist.

```json
{
  "sessionId": "uuid",
  "department": "comercial",
  "message": "Como funciona a energia por assinatura?",
  "history": [
    { "role": "assistant", "content": "Olá..." }
  ]
}
```

Resposta:

```json
{
  "answer": "...",
  "confidence": "high",
  "needsHuman": false,
  "humanReason": "",
  "suggestedDepartment": "",
  "suggestedQuestions": ["..."],
  "sources": ["Como funciona a energia limpa por assinatura"],
  "priority": "normal"
}
```

## `POST /v1/handoff`

Requer Origin permitido, consentimento explícito, telefone válido e Turnstile — **ou** um
`sessionToken` válido de `/v1/session`, que substitui o Turnstile e reaproveita protocolo e card.

```json
{
  "requestId": "uuid-estável-durante-retry",
  "sessionId": "uuid",
  "sessionToken": "sess_uuid_secreto",
  "email": "maria@empresa.com.br",
  "department": "financeiro",
  "name": "Nome do visitante",
  "phone": "5511999999999",
  "organization": "Condomínio Exemplo",
  "consent": true,
  "consentText": "Autorizo a NewSun a usar estes dados para registrar o atendimento e entrar em contato comigo pelo WhatsApp sobre esta solicitação.",
  "reason": "Segunda via",
  "history": [],
  "turnstileToken": "token"
}
```

Resposta HTTP 201:

```json
{
  "ok": true,
  "ticketId": "NS-20260830-482913",
  "statusToken": "status_uuid_secreto",
  "employeeNotified": false,
  "notificationAccepted": true,
  "notificationState": "accepted_by_whatsapp",
  "customerConfirmationAccepted": true,
  "message": "Seu atendimento foi registrado..."
}
```


## `POST /v1/upload`

`multipart/form-data` com `sessionToken` e `file` (PDF, JPG ou PNG, até 8 MB). Guarda o arquivo no
R2, anexa o link seguro na linha do tempo do card do Bitrix e notifica o funcionário pelo
mensageiro, quando dentro do expediente.

Resposta HTTP 201:

```json
{
  "ok": true,
  "fileId": "up_...",
  "filename": "conta-luz-agosto.pdf",
  "message": "Conta recebida com sucesso..."
}
```

## `GET /v1/file/:id?t=<token>`

Download do arquivo pelo funcionário, a partir do link gravado no card. Protegido por token HMAC
(não por Origin — é aberto direto no navegador). Expira junto com a retenção do atendimento.

## `POST /v1/session/abandon`

Enviado por `navigator.sendBeacon` quando o visitante fecha a aba ou some por mais de 3 minutos sem
concluir o handoff. Registra no card do Bitrix que a interação bidirecional pela tela não é mais
possível e que o contato deve seguir por WhatsApp ou e-mail. Idempotente; sempre responde `{"ok":
true}`, mesmo com token inválido, para não revelar se a sessão existe.

```json
{ "sessionToken": "sess_uuid_secreto" }
```

## `GET /v1/handoff/status?ticket=...&token=...`

Consulta somente o estado de entrega da notificação, sem retornar PII. O frontend faz polling e só libera a mensagem **“Você pode fechar esta página”** quando o webhook Meta indicar `delivered`/`read` ou quando o n8n responder `notified: true` após concluir a notificação humana.

```json
{
  "ok": true,
  "ticketId": "NS-20260830-482913",
  "employeeNotified": true,
  "failed": false,
  "notificationState": "delivered",
  "message": "O departamento confirmou o recebimento..."
}
```

## `POST /v1/admin/knowledge`

Requer `Authorization: Bearer <ADMIN_INGEST_TOKEN>`. Não é acessível pelo frontend.

```json
{
  "sourceId": "faq-publica-v1",
  "title": "FAQ pública",
  "sourceUrl": "https://...",
  "department": "geral",
  "visibility": "public",
  "approvedBy": "Nome e área",
  "approvedAt": "2026-08-30T12:00:00-03:00",
  "content": "Texto aprovado..."
}
```

Qualquer visibilidade diferente de `public` é rejeitada.

## `GET /webhooks/whatsapp`

Verificação Meta com `hub.mode`, `hub.verify_token` e `hub.challenge`.

## `POST /webhooks/whatsapp`

Recebe status Meta. Exige assinatura `X-Hub-Signature-256` válida.

## Erros

```json
{
  "error": "Mensagem legível",
  "code": "invalid_phone",
  "details": null
}
```

Códigos comuns: `origin_not_allowed`, `rate_limited`, `turnstile_failed`, `consent_required`,
`invalid_phone`, `notification_failed`, `non_public_rejected` e `unauthorized`.
