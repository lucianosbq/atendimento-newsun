# Governança da base pública de conhecimento

## Gate obrigatório

Nenhum texto entra na IA pública por conveniência operacional. Cada fonte precisa de:

1. owner da área;
2. classificação pública;
3. revisão de Marca/Comunicação;
4. revisão Jurídica/Compliance quando houver claim, contrato, preço, regulação, privacidade ou ESG;
5. aprovador nominal;
6. data de aprovação;
7. data de revisão futura;
8. URL pública quando existir.

## Checklist de aprovação

- O texto já poderia ser publicado no site sem constrangimento?
- Ele expõe pessoa, cliente, fornecedor ou operação?
- Traz percentual, prazo, preço ou garantia?
- Está condicionado à distribuidora, região, tributo ou contrato?
- Confunde energia por assinatura com instalação de painéis?
- Reduz a NewSun a desconto ou energia barata?
- Está alinhado a previsibilidade, transparência e suporte humano?
- Há contradição com política vigente?
- A fonte continua válida?
- O chatbot sabe quando parar e encaminhar?

## Revisão e expiração

Recomenda-se validade explícita:

- produto/contrato/preço/regulação: revisão mensal ou a cada alteração;
- processo de atendimento: trimestral;
- institucional estável: semestral;
- canais/contatos: mensal;
- crise: não entra como conhecimento público genérico; usa protocolo próprio.

## Processo de atualização

1. editar JSON aprovado;
2. manter o mesmo `sourceId` para substituição;
3. atualizar `approvedAt` e aprovador;
4. executar ingestão;
5. aguardar alguns segundos pela mutação Vectorize;
6. rodar perguntas de regressão;
7. registrar a mudança no Bitrix.

## Módulo comercial e transcrições de ligação

O departamento Comercial usa um módulo de venda consultiva (`COMMERCIAL_SALES_MODULE` em
`worker/src/constants.js`, adaptado do material interno "Prometheus Sales Titan") com técnicas de
tratamento de objeção (ACLARA), clareza de percepção e redução de pressão — sempre subordinado às
REGRAS INEGOCIÁVEIS do prompt principal: nunca inventa número, nunca promete condição, sempre
qualifica estimativa como estimativa.

**Transcrição de ligação real não entra na base pública.** Ela contém nome, telefone, e-mail,
valor de conta e às vezes dado bancário do cliente — o mesmo motivo pelo qual e-mail, WhatsApp e
comentário de tarefa do Bitrix nunca são ingeridos crus (regra permanente deste projeto, seção
acima). O caminho correto para aproveitar o que as ligações ensinam sobre fechamento é:

1. localizar os padrões recorrentes de objeção nas transcrições já existentes na base única
   (`node _base-unica/consultar.mjs buscar "objeção"` ou similar, fora deste repositório);
2. **generalizar**: extrair o padrão da objeção ("está caro", "preciso falar com o financeiro") sem
   nome, telefone, valor de conta ou qualquer dado que identifique quem ligou;
3. redigir a resposta correta em `knowledge/public/seed-public.json`, passando pelo mesmo checklist
   de aprovação desta página;
4. rodar `npm run ingest` normalmente.

A entrada `newsun-objecoes-comerciais-comuns-v1` já traz as cinco objeções mais comuns do roteiro
comercial (preço, timing, decisão compartilhada, experiência anterior ruim, dúvida sobre
mercado livre/GD) tratadas de forma genérica — sirva de modelo para as próximas.

## Regra brutalmente simples

Se houver dúvida sobre ser público, é interno. Não ingira.
