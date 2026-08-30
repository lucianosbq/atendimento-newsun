# Handoff por WhatsApp

## O que é possível

A aplicação notifica um número corporativo do setor com protocolo, resumo e link para iniciar conversa
com o visitante. O visitante recebe confirmação no próprio WhatsApp e pode fechar o site.

## O que não é possível nem recomendável

Não existe uma conexão invisível entre dois números pessoais que transforme o chat web numa conversa
WhatsApp sem consentimento, template, número de negócio e regras da plataforma. Também não se deve
expor telefone pessoal do funcionário no código público.

## Fluxo recomendado

1. visitante escolhe o departamento;
2. IA tenta resolver a dúvida;
3. visitante autoriza contato e informa WhatsApp;
4. Worker gera protocolo e solicita o envio da notificação ao setor;
5. frontend aguarda o webhook Meta confirmar `delivered`/`read` — ou o n8n retornar `notified: true`;
6. somente após essa confirmação aparece “Você pode fechar esta página”;
7. funcionário toca no `wa.me` recebido e inicia a conversa pelo número corporativo;
8. Bitrix registra owner, SLA e status;
9. webhook Meta continua atualizando entrega/leitura.

## Regra de horário e ausência

O JSON de rota não resolve escala de plantão. Para produção, use n8n ou Bitrix para:

- horário comercial;
- round-robin;
- férias e ausência;
- fallback do funcionário para líder;
- reenvio após falha;
- escalonamento por prioridade;
- SLA e alertas.

## Mensagem ao visitante

Use linguagem verdadeira. A aplicação só afirma que o setor recebeu a notificação quando houver evidência técnica de entrega (`delivered` ou `read`) ou confirmação síncrona do workflow n8n (`notified: true`).

Ela não deve confundir **entrega** com **leitura humana**. O texto correto é:

> O departamento confirmou o recebimento da notificação. Você pode fechar esta página

Ela não deve afirmar:

> O funcionário leu sua mensagem e vai responder imediatamente

A leitura só é conhecida quando o webhook reporta `read`; o prazo de resposta depende da operação real.
