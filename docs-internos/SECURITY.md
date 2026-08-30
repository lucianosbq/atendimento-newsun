# Segurança, privacidade e limites

## Princípio central

O assistente é público. Portanto, ele opera com uma base separada e explicitamente aprovada para
publicação. Documento interno não entra no RAG, mesmo que pareça inofensivo.

## Classificação de dados

### Permitido no RAG

- páginas institucionais públicas;
- FAQ aprovado;
- explicações gerais de produto;
- canais públicos;
- mensagens comerciais ou de atendimento homologadas;
- políticas publicadas.

### Proibido no RAG

- contratos de clientes;
- política de preços interna;
- números de funcionários;
- listas de clientes, leads ou parceiros;
- credenciais e configurações;
- atas, e-mails, Bitrix, WhatsApp interno e relatórios;
- incidentes, reclamações e crises não públicas;
- projeções, margens, valuation e estratégia;
- dados pessoais, financeiros ou de consumo individual.

## Controles implementados

- CORS com allowlist;
- headers de segurança;
- limite de tamanho de payload;
- rate limit por IP com chave HMAC;
- Turnstile validado no servidor;
- validação de esquema e comprimento;
- remoção de e-mail, telefone, CPF, CNPJ e padrão financeiro antes do contexto da IA;
- bloqueio determinístico de prompt injection e exfiltração;
- JSON Schema para saída do modelo;
- allowlist de IDs de fonte;
- detecção de claim arriscado;
- protocolo sem PII visível;
- AES-256-GCM para PII no D1;
- consentimento versionado;
- logs de evento sem conteúdo pessoal;
- assinatura HMAC do webhook Meta;
- secrets apenas no Cloudflare;
- retenção com exclusão automática.

## O que o sistema não faz

- não autentica cliente;
- não acessa conta, contrato, boleto ou consumo;
- não altera cadastro;
- não aprova proposta ou condição;
- não emite parecer jurídico;
- não toma decisão financeira;
- não envia documento interno;
- não conecta dois números pessoais diretamente;
- não afirma que a mensagem foi lida antes do webhook.

## Prompt injection

A proteção não depende apenas de prompt. Há quatro camadas:

1. filtro determinístico antes do modelo;
2. conteúdo recuperado marcado como dado, não comando;
3. fontes limitadas ao namespace público;
4. validação pós-modelo e bloqueio de claims.

Mesmo assim, nenhuma defesa de LLM é absoluta. Por isso o sistema não possui acesso a secrets, acervo
interno ou ferramentas administrativas de alto privilégio.

## Retenção

O padrão do exemplo é 90 dias, configurável em `HANDOFF_RETENTION_DAYS`. O prazo correto deve ser
homologado pelo Jurídico/DPO com base na finalidade, obrigações e política corporativa. Reduzir por
preferência; ampliar apenas com justificativa documentada.

## Logs e observabilidade

Não registrar mensagem completa, telefone, nome, organização ou payload Meta em logs. O código só
registra nomes de erro e estados técnicos. O conteúdo necessário ao handoff fica criptografado no D1 e
é enviado aos sistemas autorizados.

## Riscos residuais conhecidos

- D1 rate limit é suficiente para MVP, não substitui WAF em tráfego alto;
- notificações são síncronas; indisponibilidade externa aumenta latência;
- a API aceitar uma mensagem não garante leitura;
- template Meta pode ser reprovado ou pausado;
- Bitrix pode exigir entidade ou campos diferentes do exemplo;
- curadoria humana incorreta pode publicar conteúdo indevido;
- uma resposta baseada em fonte desatualizada ainda pode estar errada.

## Medidas para produção

- Cloudflare WAF e Rate Limiting;
- Queues com retries e DLQ;
- alertas de falha Meta/Bitrix/n8n;
- rotação de secrets;
- revisão trimestral da base;
- pentest do endpoint e do fluxo de webhook;
- DPA e avaliação de fornecedores;
- simulação de crise e vazamento;
- processo para direitos do titular e exclusão;
- dashboard de conteúdo vencido, não apenas conteúdo existente.
