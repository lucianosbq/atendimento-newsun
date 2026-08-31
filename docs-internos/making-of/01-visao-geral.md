# Visão geral

## O que é

Um assistente de atendimento com IA para o site da NewSun Energy, publicado em
`https://lucianosbq.github.io/atendimento-newsun/`. O visitante (síndico, empresário, jornalista,
candidato a fornecedor, etc.) escolhe um departamento, conversa com a IA, e — quando a dúvida exige
uma pessoa — é encaminhado ao setor certo, com tudo registrado automaticamente no Bitrix24.

## Objetivo

Responder o máximo possível com **conteúdo público já aprovado** (nunca inventar número, prazo ou
condição), e encaminhar rápido e sem fricção para um humano quando o assunto exigir — sem o
visitante precisar sair do site, digitar tudo de novo, ou esperar sem saber se alguém viu.

## Departamentos atendidos

Comercial, Clientes e CS, Financeiro, Jurídico e contratos, Operações técnicas, Parcerias,
Institucional e imprensa, **Marketing** e Pessoas e fornecedores — cada um com um responsável real
no Bitrix, que recebe notificação pela mensageria assim que um atendimento começa.

## Peças que compõem o sistema

- **Frontend**: página estática (`docs/`), publicada via GitHub Pages;
- **Backend**: Cloudflare Worker (`worker/`), que concentra toda a lógica e todos os segredos;
- **Busca semântica (RAG)**: Cloudflare Vectorize + D1, com conteúdo curado manualmente;
- **CRM**: Bitrix24 — cria/atualiza o lead, grava a conversa inteira na timeline, notifica o
  responsável;
- **Antiabuso**: Cloudflare Turnstile no cadastro;
- **IA**: Cloudflare Workers AI (Llama 3.3 70B para conversa, BGE-M3 para embeddings).

Detalhe técnico completo em [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## O que este assistente **não** faz

Não acessa conta, contrato, boleto ou histórico de consumo de ninguém; não aprova proposta, preço
ou condição comercial; não substitui parecer jurídico; não fala em nome da liderança em situação de
crise. Qualquer coisa nessa linha é encaminhada para um humano, sempre.
