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

## Regra brutalmente simples

Se houver dúvida sobre ser público, é interno. Não ingira.
