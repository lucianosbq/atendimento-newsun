# Estado atual e pendências

## Funcionando de ponta a ponta, confirmado com teste real

- Cadastro do visitante (nome, e-mail, WhatsApp) com Turnstile validado no servidor
- Criação de lead no Bitrix, com deduplicação por telefone/e-mail (nunca duplica card da mesma pessoa)
- Roteamento correto para os 9 departamentos, cada um com responsável real (nome aparece certo no Bitrix, não mais "Sem título")
- Notificação pela mensageria do Bitrix ao criar o card, com prazo de 24h, ignorando o gate de expediente de propósito
- RAG respondendo com conteúdo real e fonte citada (24 documentos ativos)
- Linguagem simples nas respostas (frases curtas, sem jargão não explicado)
- Timeline completa no card do Bitrix: início, cada pergunta/resposta, abandono de tela, handoff
- Handoff formal confirmando ao visitante sem depender de WhatsApp Business ou n8n

## Pendente — aguardando cartão de crédito (sexta-feira, conforme combinado)

1. **R2** (upload da conta de luz pelo clipe do chat) — Cloudflare exige cartão mesmo no plano
   gratuito. Binding comentado em `worker/wrangler.toml`, pronto para descomentar.
2. **Brave Search API** (busca ao vivo na internet) — pedido do Luciano para dúvidas de PME/
   Franquia e enriquecimento de resposta comercial. Também exige cartão (hold de $1, reembolsável)
   para o plano Search. Nenhum código escrito ainda, de propósito, para não implementar pela metade
   sem poder testar com a chave em mãos.

## Pendente — depende de informação, não de dinheiro

3. **`employeeWhatsApp`** vazio para os 9 departamentos em `DEPARTMENT_ROUTES_JSON` — falta o
   número corporativo real de cada responsável. Sem isso, o handoff pela WhatsApp Cloud API
   continua bloqueado (mas o handoff pelo Bitrix já funciona sozinho, ver Fase 11 da cronologia).
4. **WhatsApp Business/Meta** — processo de verificação separado e mais longo, nem começado
   (`META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`,
   `META_WEBHOOK_VERIFY_TOKEN` continuam vazios).

## Pendente — desenho técnico ainda não feito

5. **Canais Abertos do Bitrix (Open Lines)** — pedido do Luciano: quando o responsável estiver
   online, chamar a pessoa na hora e continuar o atendimento pelo próprio site, ao vivo, conectado
   à mensageria do Bitrix. Hoje o que existe é notificação avulsa (fire-and-forget) — o recurso que
   faz o que foi pedido é o Open Lines de verdade, que exige registrar um "conector"
   (`imconnector.register`) e montar um relé de mensagens nos dois sentidos. É uma integração
   nova, não um ajuste no que já existe — ainda não desenhada tecnicamente.

## Teste de aceite antes de qualquer go-live real

A lista completa de 19 cenários que deveriam passar antes de expor isso a visitante de verdade
(não só teste interno) está em [`../DEPLOY.md`](../DEPLOY.md#14-teste-de-aceite-antes-do-go-live).
Nenhum teste formal de aceite foi rodado ainda — os testes desta sessão foram exploratórios, ponto
a ponto, cada um confirmando uma correção específica.
