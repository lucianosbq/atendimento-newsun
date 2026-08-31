# Cronologia da construção

Registro na ordem real dos acontecimentos, agrupado por fase. Cada bug real traz **sintoma → causa
raiz → correção**, porque o sintoma sozinho engana — vários problemas diferentes desta lista
pareciam a mesma coisa à primeira vista.

## Fase 1 — Infraestrutura do zero

O projeto saiu do modo demo (respostas fixas, sem backend real) para infraestrutura de produção,
tudo guiado pelo Claude via `claude-in-chrome`, com o Luciano digitando pessoalmente cada
credencial nos formulários oficiais.

- Conta Cloudflare nova, plano gratuito (recusado explicitamente o plano pago nesta fase).
- Worker, D1, Vectorize e Turnstile criados sem pedir cartão.
- R2 (upload de conta de luz) ficou de fora — Cloudflare exige cartão mesmo no grátis.
- Repositório GitHub criado, Pages publicado via GitHub Actions.
- Webhook do Bitrix reaproveitado do já existente na NewSun OS (decisão consciente: webhook amplo,
  não um escopado só para o atendimento).
- 7 secrets cadastrados no Worker.

**Regra seguida à risca durante toda a sessão**: o Claude nunca digitou um secret, mesmo quando o
Luciano colou o valor direto no chat pedindo para copiar e colar. A resposta foi sempre a mesma:
abrir a tela certa do Cloudflare e pedir para ele mesmo colar. Isso se provou necessário na prática
— ver os bugs de secret abaixo, todos originados de erro humano de digitação/cópia, nunca do
Claude inventando ou adulterando um valor.

## Fase 2 — Primeiro teste ponta a ponta e o bug do Turnstile (nº 1)

**Sintoma**: cadastro falhava na segunda tentativa depois de um erro.
**Causa raiz**: `handleStartSubmit` em `docs/app.js` não chamava `resetStartTurnstile()` no `catch`
— igual já acontecia em `handleHandoffSubmit`, só que faltava aqui. Sem isso, a segunda tentativa
reenviava um token já consumido, e o Cloudflare sempre recusa token repetido.
**Correção**: adicionada a chamada faltante. Confirmado com um lead real criado no Bitrix
(protocolo `NS-20260831-613287`).

## Fase 3 — Roteamento por departamento e a notificação de card criado

Pedido do Luciano: ao criar o card, o responsável do departamento recebe notificação pela
mensageria do Bitrix, com prazo de 24h para chamar o visitante no WhatsApp. Implementado em
`worker/src/session.js` e `worker/src/integrations.js`, com uma decisão técnica relevante: essa
notificação **ignora o gate de horário de expediente** (`requireBusinessHours: false`), porque o
prazo de 24h conta da criação do card, não da leitura da notificação.

Os 8 (depois 9) departamentos e responsáveis foram definidos por rodadas de pergunta e resposta com
o Luciano, resolvendo ambiguidades reais: Marketing e Imprensa foram unificados sob a Bruna Anielle
numa primeira rodada (decisão que seria revertida depois, ver Fase 8).

## Fase 4 — Teste de persona e o bug do Turnstile (nº 2)

Pedido: testar o atendimento como um síndico fazendo 10 perguntas e pedindo reunião no final.

**Sintoma**: cadastro voltou a falhar, agora com `invalid-input-secret` no `siteverify` do
Cloudflare, mesmo o widget mostrando "Sucesso!" na tela.
**Causa raiz**: a secret do Turnstile salva no Worker (`TURNSTILE_SECRET`) estava desalinhada com a
do widget — provavelmente um erro de digitação/cópia numa rodada anterior de configuração.
**Correção**: rotacionada a secret no painel do Turnstile, o Luciano colou o valor novo no Worker.
Esse mesmo bug, com o mesmo sintoma ("Sucesso!" na tela, 403 no servidor), voltaria a acontecer numa
sessão seguinte — ver Fase 6.

## Fase 5 — Base de conhecimento: FAQ, blog e curadoria

Pedido: trazer o FAQ oficial do site, todo o conhecimento relevante do projeto NewSun, e o
conhecimento do blog para dentro do RAG.

- FAQ oficial (`newsun.energy/faq`, 15 perguntas) trazido e dividido em 5 documentos temáticos.
- Descoberta: o `/blog` do site não é blog próprio — é uma seção de clipping de imprensa,
  reproduzindo texto de terceiros. Reproduzir aquele texto seria violação de direito autoral; os
  dois documentos sobre "blog" foram reescritos com palavras próprias (bandeiras tarifárias,
  consumo sazonal), extraindo só o fato institucional (expansão/nova sede).
- Descoberta separada: os **10 documentos originais do projeto** (identidade da marca, como
  funciona a assinatura, limites por área) estavam com `approvedBy=PENDENTE_APROVACAO_CMO_JURIDICO`
  desde a criação do MVP — nunca tinham sido aprovados de verdade. O script de ingestão valida
  **o lote inteiro** antes de mandar qualquer coisa, então isso travava a ingestão de tudo, não só
  desses 10.
- Aprovados em sessão pelo Luciano (conteúdo de governança do assistente — o que ele pode/não pode
  dizer —, sem número, promessa ou alegação jurídica que exigisse revisão formal externa).
- Objeções comerciais reais extraídas de `_base-unica/recuperacao-gravacoes/`, uma síntese já
  pronta de milhares de ligações do CRM transcritas, generalizadas em 6 documentos sem citar
  concorrente, ticket mínimo exato nem alegação superlativa não confirmada.

Total no `seed-public.json` ao final desta fase: 24 documentos.

## Fase 6 — Descoberta do RAG vazio (o bug mais longo da sessão)

**Sintoma**: mesmo depois da "ingestão" reportar "OK" para os 24 documentos, o chat recusava
responder qualquer pergunta — inclusive a mais básica, cujo título batia exatamente com um
documento existente há semanas.

A investigação passou por várias hipóteses até a real, na ordem em que foram descartadas:

1. **RAG_MIN_SCORE alto demais?** Não — o log mostrava `totalMatches: 0` mesmo sem filtro de nota.
2. **Vectorize genuinamente vazio?** Uma rota de diagnóstico temporária (`env.VECTORIZE.describe()`)
   confirmou `vectorCount: 0`.
3. **Delay de propagação do Vectorize?** Real, mas não a causa principal: um vetor de teste
   escrito na hora levou ~60-90 segundos para aparecer nas buscas — bem mais que o "alguns
   segundos" que o comentário no código sugeria. Vale saber, mas não explicava o "sempre zero".
4. **`upsert()` falhando silenciosamente?** Não — o `mutationId` sempre voltava válido.
5. **Turnstile de novo, atrapalhando o teste** — não relacionado à ingestão, mas consumiu um bom
   tempo da investigação porque quebrava os testes manuais no meio.
6. **A causa real, achada só quando o Luciano colou o comando de terminal completo**: o
   `NEWSUN_ADMIN_INGEST_TOKEN` usado no `npm run ingest` **nunca foi o valor real** — primeiro foi
   literalmente o placeholder `<cole aqui o valor do ADMIN_INGEST_TOKEN>` (com os sinais de maior/
   menor incluídos), depois um valor gerado mas nunca atualizado no Cloudflare. O script imprimia
   "ERRO ... Não autorizado" no terminal do Luciano — só que o log do Worker (`wrangler tail`)
   mostrava "Ok" para as mesmas chamadas, porque esse "Ok" só confirma que o servidor respondeu,
   não que autorizou. Isso mascarou um HTTP 401 repetidas vezes, em várias rodadas de teste.

**Correção**: gerado um token novo, colado no Cloudflare e no comando de ingestão (com valores
efetivamente iguais desta vez), rodado `npm run ingest` de novo. Resultado: `vectorCount: 24`,
confirmado por uma pergunta que antes falhava sempre ("preciso instalar placas solares?") agora
respondendo certo, com fonte citada.

**Lição prática registrada por isso**: `wrangler tail` mostra "Ok"/"Error" pelo status de execução
do Worker (não travou), não pelo HTTP status da resposta. Um 401, 403 ou 500 tratado (sem lançar
exceção) sempre aparece como "Ok" no log — para ver o status HTTP real é preciso olhar o campo
`response.status` dentro do payload JSON do evento, não a palavra "Ok"/"Error" da linha.

As rotas de diagnóstico temporárias (`/v1/admin/debug-vectorize*`) e os `console.log` de depuração
adicionados durante essa investigação foram todos removidos depois de confirmar a causa raiz.

## Fase 7 — Descoberta do roteamento quebrado (achado em paralelo)

Enquanto testava o handoff, o Luciano notou no Bitrix: "aparece o número da pessoa 51 mas não
atribuiu de verdade" — o card mostrava "Pessoa responsável: Sem título".

**Causa raiz**: **todos os 8 IDs configurados em `DEPARTMENT_ROUTES_JSON` eram inválidos** — nenhum
correspondia a uma pessoa real na tabela `pessoas` da base única. Os números (51, 53, 49, 19, 6, 47,
41, 10) tinham cara de índice de posição numa lista, não de ID real do Bitrix (que para esses
colaboradores variava entre 123 e 6739).
**Correção**: consultada a tabela `pessoas` da base única para os 8 nomes reais, montado o JSON
correto, colado no Cloudflare. Confirmado criando um card novo (telefone de teste nunca usado
antes, para não reaproveitar um card antigo) e vendo "Pessoa responsável: Bruno Faustino" — nome
de verdade, não mais "Sem título".

## Fase 8 — Departamento Marketing separado de Imprensa

O Luciano esclareceu que a unificação da Fase 3 (Marketing e Imprensa sob a Bruna Anielle) não era
o que ele queria: "Marketing quem atende é Maria Helena e Imprensa e Institucional é Bruna
Anielle" — os dois deveriam ser departamentos separados desde o início.

**Implementado**: novo departamento `marketing` em `worker/src/constants.js` (rota, prompt,
sugestões de pergunta) e em `docs/app.js` (opção no formulário, fluxo guiado de conversa), roteado
para Maria Helena Silva (ID 667, achado na mesma consulta da Fase 7). Testado ponta a ponta:
card criado com "Pessoa responsável: Maria Helena Silva", departamento "Marketing" no título.

## Fase 9 — Timeline por turno no Bitrix

Pedido: "tudo que for perguntado e respondido tem que ficar registrado dentro do card... desde a
primeira pergunta". Até então só o início da conversa e o abandono da tela geravam comentário — o
miolo da conversa (as perguntas e respostas de verdade) não ficava registrado até o visitante pedir
atendimento humano.

**Implementado**: o frontend passou a mandar o `sessionToken` (que já existia, mas só era usado no
handoff) em toda chamada de `/v1/chat`; o Worker usa esse token para achar o card já aberto e grava
`Visitante: ... / Assistente: ...` na timeline, de forma assíncrona (`ctx.waitUntil`), sem atrasar a
resposta ao visitante. Função `appendSessionTimeline` já existia em `session.js`, pronta, mas nunca
tinha sido chamada de lugar nenhum — código morto até esse ponto.

## Fase 10 — Linguagem simples

Pedido: as respostas deveriam ser claras o bastante para uma criança de 10 anos entender, sem
infantilizar (o público é adulto). A primeira tentativa — só adicionar "escreva em linguagem
simples" ao prompt do sistema — não mudou o resultado na prática: o modelo manteve o mesmo grau de
tecnicismo do texto-fonte aprovado.

**Correção**: reforçado o prompt com uma lista de trocas obrigatórias de vocabulário técnico por
equivalente simples e um exemplo explícito lado a lado de "errado" vs. "certo" para a mesma
informação. Testado com a mesma pergunta antes/depois: de "Não é necessário instalar placas
solares... créditos de energia são considerados conforme as regras aplicáveis" para "Não, você não
precisa instalar nada no condomínio. A energia vem de uma usina em outro lugar."

## Fase 11 — Handoff sem depender do WhatsApp Business

**Sintoma**: pedir atendimento humano sempre mostrava "O departamento ainda não possui um canal de
notificação humana configurado" — mesmo quando o card no Bitrix já tinha sido criado e a
mensageria já tinha sido notificada com sucesso por trás.

**Causa raiz**: duas checagens diferentes só reconheciam WhatsApp Business (Meta) ou n8n como
canal válido de sucesso — nunca o Bitrix, mesmo ele funcionando perfeitamente sem nenhum dos dois.
Uma delas (`assertAtLeastOneHandoffRouteConfigured`) bloqueava a tentativa antes mesmo de chamar
qualquer integração.
**Correção**: as duas checagens passaram a aceitar o Bitrix (webhook configurado + card
criado/notificado) como confirmação suficiente por si só. Testado ponta a ponta: tela mostrando
"Encaminhamento confirmado — Você pode fechar esta página", com o comentário correspondente gravado
no card.
