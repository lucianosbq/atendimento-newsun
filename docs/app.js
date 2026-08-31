(() => {
  "use strict";

  const config = window.NEWSUN_CHAT_CONFIG || {};

  const DEPARTMENTS = Object.freeze([
    {
      id: "comercial",
      label: "Comercial",
      icon: "↗",
      description: "Novos clientes, elegibilidade, análise inicial e contratação",
      greeting: "Olá. Posso explicar como funciona a energia limpa por assinatura, critérios gerais de elegibilidade e próximos passos comerciais.",
      suggestions: ["Como funciona a energia por assinatura?", "Precisa instalar painéis?", "Quem pode contratar?"]
    },
    {
      id: "atendimento",
      label: "Clientes e CS",
      icon: "◉",
      description: "Clientes atuais, experiência, suporte e acompanhamento",
      greeting: "Olá. Vou tentar resolver sua dúvida de atendimento. Para consultar uma conta, contrato ou ocorrência específica, encaminharei você com protocolo.",
      suggestions: ["Tenho uma dúvida sobre minha fatura", "Como acompanho meus créditos?", "Preciso atualizar meus dados"]
    },
    {
      id: "financeiro",
      label: "Financeiro",
      icon: "R$",
      description: "Faturas, pagamentos, cobranças e documentos financeiros",
      greeting: "Olá. Posso orientar sobre o fluxo geral de faturas e pagamentos. Valores, boletos e dados de uma conta específica exigem validação do Financeiro.",
      suggestions: ["Não reconheço uma cobrança", "Preciso da segunda via", "Como funciona o faturamento?"]
    },
    {
      id: "juridico",
      label: "Jurídico e contratos",
      icon: "§",
      description: "Termos, contratos, privacidade e assuntos regulatórios",
      greeting: "Olá. Posso explicar conceitos gerais e o caminho correto. Não emito parecer jurídico nem interpreto cláusulas particulares sem análise humana.",
      suggestions: ["Quero entender meu contrato", "Como meus dados são protegidos?", "Onde envio um documento?"]
    },
    {
      id: "operacoes",
      label: "Operações técnicas",
      icon: "⚙",
      description: "Implantação, créditos de energia e questões operacionais",
      greeting: "Olá. Posso esclarecer o funcionamento geral da operação. Ocorrências técnicas, prazos individuais e status de créditos precisam ser verificados pela equipe responsável.",
      suggestions: ["Como os créditos aparecem na conta?", "Quanto tempo leva para iniciar?", "Tenho um problema operacional"]
    },
    {
      id: "parcerias",
      label: "Parcerias",
      icon: "◇",
      description: "Administradoras, NewSun Partner, Affiliated e canais",
      greeting: "Olá. Posso apresentar os caminhos gerais de parceria e identificar qual programa faz sentido para seu perfil.",
      suggestions: ["Sou administradora de condomínios", "Quero ser parceiro", "Quero conhecer o NewSun Affiliated"]
    },
    {
      id: "imprensa",
      label: "Institucional e imprensa",
      icon: "✦",
      description: "Imprensa, eventos, marca e solicitações institucionais",
      greeting: "Olá. Posso ajudar com informações institucionais públicas. Solicitações de imprensa ou posicionamentos oficiais serão encaminhados à Comunicação.",
      suggestions: ["Preciso falar com a imprensa", "Quero convidar a NewSun para um evento", "Quem é a NewSun?"]
    },
    {
      id: "pessoas",
      label: "Pessoas e fornecedores",
      icon: "＋",
      description: "Carreiras, fornecedores e assuntos administrativos",
      greeting: "Olá. Posso indicar o canal correto para oportunidades, fornecedores e assuntos administrativos, sem expor dados pessoais de colaboradores.",
      suggestions: ["Quero trabalhar na NewSun", "Quero ser fornecedor", "Preciso falar com o RH"]
    }
  ]);

  // Nomes de atendente ligados ao sol/luz — sorteado uma vez por conversa,
  // só para dar acolhimento humano ao chat; não representa uma pessoa real.
  const ATTENDANT_NAMES = Object.freeze(["Aurora", "Helena", "Solange", "Clarice", "Sol"]);

  function pickAttendantName() {
    return ATTENDANT_NAMES[Math.floor(Math.random() * ATTENDANT_NAMES.length)];
  }

  const state = {
    sessionId: crypto.randomUUID(),
    department: null,
    history: [],
    busy: false,
    handoffReason: "Solicitação do visitante",
    turnstileWidgetId: null,
    turnstileToken: "",
    startWidgetId: null,
    startToken: "",
    pendingStartFile: null,
    handoffRequestId: "",
    statusPollGeneration: 0,
    session: null,
    profile: null,
    flowData: {},
    flowAwaiting: null,
    hotLeadPrompted: false,
    handoffDone: false,
    abandonSent: false,
    hiddenTimer: null,
    attendantName: pickAttendantName()
  };

  const CONSENT_TEXT = "Autorizo a NewSun a usar estes dados para registrar o atendimento e entrar em contato comigo pelo WhatsApp sobre esta solicitação.";

  const HOT_LEAD_PATTERN = /(quanto vou economizar|qual (a |é a |seria a )?(minha )?economia|qual (o |é o )?desconto|percentual de desconto|prazo contratual|quero uma liga[çc][ãa]o|me liguem|enviar (a |minha )?conta|mandar (a |minha )?conta)/i;

  // Fluxos guiados por departamento. Cada passo tem texto e botões; passos com
  // expectInput capturam a próxima mensagem digitada em vez de enviá-la à IA.
  const FLOWS = Object.freeze({
    comercial: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Seja bem-vindo à NewSun Energy, ${firstName(p)}. Somos uma das empresas de energia limpa que mais crescem no Brasil. Quer fazer uma análise gratuita da sua conta de energia?`,
          options: [
            { label: "Sim, vamos lá", next: "empresa" },
            { label: "Quero entender primeiro", next: "entender" }
          ]
        },
        entender: {
          text: () => "Claro. Como referência nacional no fornecimento de energia limpa para condomínios e PMEs, a NewSun acredita que, além da sustentabilidade, você pode economizar até 30% ao ano. Para isso temos o programa de Energia Limpa por Assinatura: sem obras, sem manutenção, sem investimento — é tudo por nossa conta. A elegibilidade depende do perfil da unidade consumidora. Quer verificar se sua conta está apta?",
          options: [
            { label: "Sim, verificar", next: "empresa" },
            { label: "Falar com alguém", action: "handoff", reason: "Visitante pediu contato humano logo no início do fluxo comercial" }
          ]
        },
        empresa: {
          text: () => "Perfeito. Qual é o nome da sua empresa?",
          expectInput: "empresa",
          next: "cidade"
        },
        cidade: {
          text: (d) => `Obrigado. E em qual cidade e estado fica a unidade da ${d.empresa || "empresa"} que vamos analisar?`,
          expectInput: "cidade",
          next: "cargo"
        },
        cargo: {
          text: () => "Só para eu direcionar corretamente: qual é a sua função na empresa?",
          options: [
            { label: "Sócio / Diretor", set: { key: "cargo", value: "Sócio/Diretor" }, hot: true, next: "conta" },
            { label: "Financeiro / Administrativo", set: { key: "cargo", value: "Financeiro/Administrativo" }, next: "conta" },
            { label: "Comercial", set: { key: "cargo", value: "Comercial" }, next: "conta" },
            { label: "Outro", set: { key: "cargo", value: "Outro" }, next: "influencia" }
          ]
        },
        influencia: {
          text: () => "Sem problema. Você participa ou influencia decisões relacionadas a custos de energia ou fornecedores?",
          options: [
            { label: "Sim", set: { key: "influencia", value: "sim" }, next: "conta" },
            { label: "Não", set: { key: "influencia", value: "não" }, next: "responsavel" }
          ]
        },
        responsavel: {
          text: () => "Tudo certo. Quem normalmente cuida desse tipo de decisão aí? Se quiser, escreva o nome e eu preparo o atendimento para essa pessoa.",
          expectInput: "responsavel",
          next: "conta"
        },
        conta: {
          text: () => "Agora uma informação importante para estimarmos o potencial: hoje, aproximadamente quanto vocês pagam por mês em energia elétrica?",
          options: [
            { label: "Até R$ 1.000", set: { key: "faixaConta", value: "até R$ 1.000" }, next: "sem_fit" },
            { label: "R$ 1.000 a R$ 3.000", set: { key: "faixaConta", value: "R$ 1.000 a R$ 3.000" }, next: "nutricao" },
            { label: "R$ 3.000 a R$ 10.000", set: { key: "faixaConta", value: "R$ 3.000 a R$ 10.000" }, hot: true, next: "lead_quente" },
            { label: "Acima de R$ 10.000", set: { key: "faixaConta", value: "acima de R$ 10.000" }, hot: true, next: "lead_quente" }
          ]
        },
        nutricao: {
          text: () => "Ótimo. Pelo perfil informado, vale a pena avançarmos para a análise. A condição da NewSun foi estruturada para reduzir o custo de energia sem exigir nenhuma mudança física na empresa: a energia continua chegando pela rede da distribuidora e fazemos a compensação de créditos das nossas mais de 40 usinas de energia limpa em 18 estados. Quer que a gente calcule o potencial de economia anual?",
          options: [
            { label: "Sim, calcular", next: "conta_energia" },
            { label: "Como funciona?", next: "como_funciona" }
          ]
        },
        como_funciona: {
          text: () => "Funciona de forma simples: a NewSun gera energia limpa em suas usinas, essa energia é injetada na rede elétrica e compensada na unidade consumidora elegível. Você continua usando a infraestrutura da distribuidora, sem placas e sem investimento. A partir da sua conta atual conseguimos estimar a economia e verificar as condições disponíveis. Posso fazer essa análise agora?",
          options: [
            { label: "Sim, analisar", next: "conta_energia" },
            { label: "Tenho outra dúvida", action: "free" }
          ]
        },
        conta_energia: {
          text: () => "Perfeito, chegamos à etapa mais importante. Para calcular a economia real e confirmar a elegibilidade, preciso de uma conta recente de energia — use o clipe 📎 aqui embaixo para enviar em PDF, JPG ou PNG. A equipe usa a conta exclusivamente para analisar perfil de consumo, distribuidora e tarifa. Se não estiver com ela agora, posso fazer uma simulação rápida só com o valor mensal.",
          options: [
            { label: "📎 Enviar a conta agora (PDF, JPG ou PNG)", action: "clip" },
            { label: "Informar o valor mensal da conta", next: "valor_conta" },
            { label: "Falar direto com o especialista", action: "handoff", reason: "Lead qualificado no fluxo comercial pronto para enviar a conta de energia" }
          ]
        },
        valor_conta: {
          text: () => "Combinado. Qual é o valor médio mensal da conta de luz — da área comum do seu condomínio ou, se for empresa, da conta mensal da unidade? Pode escrever só o número, por exemplo: 4500.",
          expectInput: "valorConta",
          next: "simulacao"
        },
        simulacao: {
          text: (d, p) => buildSimulationText(d, p),
          options: [
            { label: "Quero essa economia — falar com o especialista", action: "handoff", reason: "Simulação de economia apresentada — visitante quer avançar" },
            { label: "📎 Enviar a conta para o cálculo exato", action: "clip" },
            { label: "Tenho outra dúvida", action: "free" }
          ]
        },
        sem_conta: {
          text: (d, p) => `Sem problema, ${firstName(p)}. Sua análise já ficou pré-cadastrada com o seu protocolo. Se quiser, faço agora uma simulação só com o valor mensal da conta — ou aciono o time e você envia a conta depois pelo WhatsApp, sem repetir o cadastro.`,
          options: [
            { label: "Informar o valor mensal da conta", next: "valor_conta" },
            { label: "Sim, acionar o especialista", action: "handoff", reason: "Pré-cadastro comercial sem conta de energia — visitante pediu contato" },
            { label: "Tenho outra dúvida", action: "free" }
          ]
        },
        lead_quente: {
          text: (d, p) => `${firstName(p)}, pelo seu perfil não faz sentido te deixar passando por mais etapas automáticas. Vou encaminhar você diretamente para um especialista da NewSun agora mesmo. Se estiver com uma conta recente em mãos, já deixe por perto — isso permite que ele assuma a conversa com a simulação em andamento.`,
          options: [
            { label: "Falar com o especialista", action: "handoff", reason: "LEAD QUENTE do fluxo comercial — prioridade de atendimento" },
            { label: "Continuar perguntando", action: "free" }
          ]
        },
        sem_fit: {
          text: () => "Obrigado pelas informações. Neste momento ainda precisamos confirmar se a região e o perfil da unidade estão contemplados pelo programa. Com uma conta recente de energia conseguimos fazer uma validação definitiva, sem concluir nada só pelas informações iniciais. Quer falar com o time para essa validação?",
          options: [
            { label: "Quero validar com o time", action: "handoff", reason: "Perfil com elegibilidade a confirmar no fluxo comercial" },
            { label: "Tenho outra dúvida", action: "free" }
          ]
        }
      }
    },
    atendimento: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Já sou capaz de resolver muita coisa por aqui. O que você precisa hoje?`,
          options: [
            { label: "Dúvida sobre minha fatura ou créditos", set: { key: "assunto", value: "fatura/créditos" }, next: "conta_pessoal" },
            { label: "Atualizar meus dados", set: { key: "assunto", value: "atualização cadastral" }, action: "handoff", reason: "Cliente precisa atualizar dados cadastrais (exige validação humana)" },
            { label: "Entender como funciona o atendimento", action: "ask", question: "Como funciona a jornada de atendimento ao cliente NewSun?" },
            { label: "Outra dúvida", action: "free" }
          ]
        },
        conta_pessoal: {
          text: () => "Posso explicar o processo geral de faturas e créditos, mas dados da sua conta específica exigem uma pessoa autorizada, para proteger suas informações. Quer a explicação geral ou já prefere o atendimento humano com protocolo?",
          options: [
            { label: "Explicação geral primeiro", action: "ask", question: "Como funciona o faturamento e a compensação de créditos na conta?" },
            { label: "Atendimento humano", action: "handoff", reason: "Cliente com dúvida sobre fatura/créditos da própria conta" }
          ]
        }
      }
    },
    financeiro: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Sobre o que é sua dúvida financeira?`,
          options: [
            { label: "Segunda via de boleto", set: { key: "assunto", value: "segunda via" }, action: "handoff", reason: "Solicitação de segunda via de boleto (dado individual)" },
            { label: "Cobrança que não reconheço", set: { key: "assunto", value: "cobrança não reconhecida" }, action: "handoff", reason: "PRIORIDADE: cobrança não reconhecida pelo cliente" },
            { label: "Como funciona o faturamento", action: "ask", question: "Como funciona o fluxo geral de faturas e pagamentos da NewSun?" },
            { label: "Outra dúvida", action: "free" }
          ]
        }
      }
    },
    juridico: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Posso explicar conceitos gerais; análise de documento específico vai para o time Jurídico. O que você precisa?`,
          options: [
            { label: "Entender meu contrato", action: "ask", question: "Quero entender os conceitos gerais do contrato de energia por assinatura." },
            { label: "Enviar um documento ou notificação", set: { key: "assunto", value: "documento jurídico" }, action: "handoff", reason: "Envio de documento/notificação para análise do Jurídico" },
            { label: "Privacidade e LGPD", action: "ask", question: "Como a NewSun protege meus dados pessoais?" },
            { label: "Falar com o Jurídico", action: "handoff", reason: "Visitante pediu contato direto com o Jurídico" }
          ]
        }
      }
    },
    operacoes: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Sobre a operação, o que você quer resolver?`,
          options: [
            { label: "Como os créditos aparecem na conta", action: "ask", question: "Como os créditos de energia aparecem na conta de luz?" },
            { label: "Prazo de implantação", action: "ask", question: "Quanto tempo leva para a energia por assinatura começar a valer?" },
            { label: "Tenho um problema operacional", set: { key: "assunto", value: "ocorrência operacional" }, action: "handoff", reason: "Ocorrência operacional relatada pelo visitante" },
            { label: "Outra dúvida", action: "free" }
          ]
        }
      }
    },
    parcerias: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Que tipo de parceria você tem em mente?`,
          options: [
            { label: "Sou administradora de condomínios", set: { key: "perfil", value: "administradora" }, hot: true, next: "administradora" },
            { label: "Quero ser parceiro comercial", set: { key: "perfil", value: "parceiro comercial" }, next: "parceiro" },
            { label: "Conhecer o NewSun Affiliated", action: "ask", question: "O que é o programa NewSun Affiliated e como participar?" },
            { label: "Outra dúvida", action: "free" }
          ]
        },
        administradora: {
          text: () => "Excelente. Administradoras têm condição estruturada na NewSun. Qual é o nome da administradora?",
          expectInput: "empresa",
          next: "administradora_handoff"
        },
        administradora_handoff: {
          text: (d) => `Perfeito. Vou acionar o time de Parcerias com o contexto da ${d.empresa || "administradora"} para apresentarem a condição disponível.`,
          options: [
            { label: "Acionar o time de Parcerias", action: "handoff", reason: "LEAD QUENTE de Parcerias — administradora de condomínios" },
            { label: "Antes, tenho uma dúvida", action: "free" }
          ]
        },
        parceiro: {
          text: () => "Ótimo. O time de Parcerias apresenta o modelo, comissionamento e requisitos direto com você. Quer que eu acione o time agora?",
          options: [
            { label: "Sim, acionar Parcerias", action: "handoff", reason: "Interessado em parceria comercial" },
            { label: "Antes, tenho uma dúvida", action: "free" }
          ]
        }
      }
    },
    imprensa: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. Como posso ajudar no institucional?`,
          options: [
            { label: "Sou jornalista / imprensa", set: { key: "perfil", value: "imprensa" }, action: "handoff", reason: "URGENTE: solicitação de imprensa — encaminhar à Comunicação sem especulação" },
            { label: "Convidar a NewSun para um evento", set: { key: "assunto", value: "evento" }, action: "handoff", reason: "Convite de evento para avaliação da Comunicação" },
            { label: "Quem é a NewSun?", action: "ask", question: "Quem é a NewSun Energy?" },
            { label: "Outra dúvida", action: "free" }
          ]
        }
      }
    },
    pessoas: {
      start: "entrada",
      steps: {
        entrada: {
          text: (d, p) => `Olá, ${firstName(p)}. O que você procura?`,
          options: [
            { label: "Quero trabalhar na NewSun", action: "ask", question: "Como me candidato a uma vaga na NewSun?" },
            { label: "Quero ser fornecedor", set: { key: "perfil", value: "fornecedor" }, action: "handoff", reason: "Fornecedor interessado em cadastro" },
            { label: "Preciso falar com o RH", action: "handoff", reason: "Visitante pediu contato com RH" },
            { label: "Outra dúvida", action: "free" }
          ]
        }
      }
    }
  });

  function makeAvatar() {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.src = "./assets/simbolo-newsun.png";
    img.alt = "";
    img.className = "avatar-img";
    avatar.append(img);
    return avatar;
  }

  function firstName(profile) {
    return String(profile?.name || "").trim().split(/\s+/)[0] || "olá";
  }

  const els = {
    welcomeView: byId("welcome-view"),
    departmentPickerView: byId("department-picker-view"),
    chatView: byId("chat-view"),
    successView: byId("success-view"),
    departmentGrid: byId("department-grid"),
    messages: byId("messages"),
    suggestions: byId("suggestions"),
    form: byId("chat-form"),
    input: byId("message-input"),
    attach: byId("attach-button"),
    fileInput: byId("file-input"),
    send: byId("send-button"),
    human: byId("human-button"),
    back: byId("back-button"),
    changeDepartment: byId("change-department-button"),
    chatTitle: byId("chat-title"),
    attendantName: byId("attendant-name"),
    departmentIcon: byId("department-icon"),
    demoBanner: byId("demo-banner"),
    serviceStatus: byId("service-status-text"),
    handoffDialog: byId("handoff-dialog"),
    handoffForm: byId("handoff-form"),
    closeHandoff: byId("close-handoff-button"),
    handoffContext: byId("handoff-context"),
    handoffName: byId("handoff-name"),
    handoffPhone: byId("handoff-phone"),
    handoffEmail: byId("handoff-email"),
    handoffOrganization: byId("handoff-organization"),
    protocolChip: byId("protocol-chip"),
    startForm: byId("start-form"),
    startName: byId("start-name"),
    startPhone: byId("start-phone"),
    startEmail: byId("start-email"),
    startDepartment: byId("start-department"),
    startConsent: byId("start-consent"),
    startSubmit: byId("start-submit"),
    startError: byId("start-error"),
    startTurnstileContainer: byId("start-turnstile-container"),
    startMessage: byId("start-message"),
    startAttach: byId("start-attach-button"),
    startFileInput: byId("start-file-input"),
    startFileChip: byId("start-file-chip"),
    handoffConsent: byId("handoff-consent"),
    handoffSubmit: byId("handoff-submit"),
    handoffError: byId("handoff-error"),
    turnstileContainer: byId("turnstile-container"),
    successViewIcon: byId("success-icon"),
    successEyebrow: byId("success-eyebrow"),
    successTitle: byId("success-title"),
    successMessage: byId("success-message"),
    successFootnote: byId("success-footnote"),
    protocolNumber: byId("protocol-number"),
    newConversation: byId("new-conversation-button"),
    privacyDialog: byId("privacy-dialog"),
    privacyButton: byId("privacy-button"),
    closePrivacy: byId("close-privacy-button"),
    privacyOk: byId("privacy-ok-button")
  };

  initialize();

  function initialize() {
    renderDepartments();
    renderDepartmentSelect();
    bindEvents();
    renderStartTurnstileIfNeeded();
    els.demoBanner.hidden = !Boolean(config.demoMode);
    if (config.demoMode) {
      els.serviceStatus.textContent = "Demonstração ativa";
    }
  }

  function bindEvents() {
    els.form.addEventListener("submit", handleChatSubmit);
    els.input.addEventListener("input", autoResizeInput);
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.form.requestSubmit();
      }
    });

    els.human.addEventListener("click", () => openHandoff("Atendimento humano solicitado pelo visitante"));
    els.back.addEventListener("click", showWelcome);
    els.changeDepartment.addEventListener("click", showWelcome);
    els.closeHandoff.addEventListener("click", closeHandoff);
    els.handoffForm.addEventListener("submit", handleHandoffSubmit);
    els.handoffPhone.addEventListener("input", maskPhoneInput);
    els.newConversation.addEventListener("click", resetConversation);

    els.startForm.addEventListener("submit", handleStartSubmit);
    els.startPhone.addEventListener("input", () => maskPhoneField(els.startPhone));
    els.startMessage.addEventListener("input", () => autoResizeField(els.startMessage));
    els.startAttach.addEventListener("click", () => els.startFileInput.click());
    els.startFileInput.addEventListener("change", () => {
      const file = els.startFileInput.files?.[0];
      els.startFileInput.value = "";
      if (file) attachStartFile(file);
    });

    els.attach.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", () => {
      const file = els.fileInput.files?.[0];
      els.fileInput.value = "";
      if (file) void uploadAccountFile(file);
    });

    // Abandono da tela: ao sair da página (ou ficar 3 minutos com a aba
    // escondida), avisa o backend para registrar no card do Bitrix que o
    // contato agora só é possível por WhatsApp ou e-mail.
    window.addEventListener("pagehide", sendAbandonBeacon);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        state.hiddenTimer = setTimeout(sendAbandonBeacon, 180000);
      } else if (state.hiddenTimer) {
        clearTimeout(state.hiddenTimer);
        state.hiddenTimer = null;
      }
    });

    els.privacyButton.addEventListener("click", () => els.privacyDialog.showModal());
    els.closePrivacy.addEventListener("click", () => els.privacyDialog.close());
    els.privacyOk.addEventListener("click", () => els.privacyDialog.close());

    for (const dialog of [els.handoffDialog, els.privacyDialog]) {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }

  function renderDepartments() {
    els.departmentGrid.replaceChildren();
    for (const department of DEPARTMENTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "department-card";
      button.setAttribute("role", "listitem");
      button.dataset.department = department.id;

      const content = document.createElement("div");
      const icon = document.createElement("span");
      icon.className = "department-icon";
      icon.textContent = department.icon;
      const title = document.createElement("strong");
      title.textContent = department.label;
      const description = document.createElement("p");
      description.textContent = department.description;
      content.append(icon, title, description);

      const arrow = document.createElement("span");
      arrow.className = "card-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");

      button.append(content, arrow);
      button.addEventListener("click", () => selectDepartment(department.id));
      els.departmentGrid.append(button);
    }
  }

  function renderDepartmentSelect() {
    els.startDepartment.replaceChildren(els.startDepartment.firstElementChild);
    for (const department of DEPARTMENTS) {
      const option = document.createElement("option");
      option.value = department.id;
      option.textContent = department.label;
      els.startDepartment.append(option);
    }
  }

  // Usado pela grade de departamentos (só aparece depois do cadastro feito,
  // para trocar de assunto sem repetir nome/e-mail/WhatsApp).
  function selectDepartment(id) {
    const department = getDepartment(id);
    if (!department) return;
    enterChat(id);
  }

  function enterChat(id) {
    const department = getDepartment(id);
    if (!department) return;

    state.department = department;
    state.history = [];
    state.handoffReason = "Solicitação do visitante";
    state.flowData = {};
    state.flowAwaiting = null;
    state.hotLeadPrompted = false;

    els.chatTitle.textContent = department.label;
    els.attendantName.textContent = state.attendantName;
    els.departmentIcon.textContent = department.icon;
    els.messages.replaceChildren();
    els.suggestions.replaceChildren();

    if (state.session?.protocol) {
      els.protocolChip.textContent = `Protocolo ${state.session.protocol}`;
      els.protocolChip.hidden = false;
    }

    if (state.session && state.session.withinBusinessHours === false) {
      const aviso = "Estamos fora do horário de atendimento humano (segunda a sexta, das 8h às 18h). Posso responder suas dúvidas agora mesmo; se precisar de uma pessoa, o setor recebe sua solicitação com protocolo e retorna no próximo expediente.";
      addMessage("assistant", aviso);
      state.history.push({ role: "assistant", content: aviso });
    }

    const flow = FLOWS[department.id];
    if (flow) {
      runFlowStep(flow.steps[flow.start]);
    } else {
      addMessage("assistant", department.greeting, { sources: ["Central de Ajuda NewSun"] });
      state.history.push({ role: "assistant", content: department.greeting });
      renderSuggestions(department.suggestions);
    }

    showOnly(els.chatView);
    requestAnimationFrame(() => els.input.focus());
  }

  // ---- Motor do fluxo guiado ----

  function runFlowStep(step) {
    if (!step) return;
    const text = typeof step.text === "function" ? step.text(state.flowData, state.profile) : String(step.text || "");
    if (text) {
      addMessage("assistant", text);
      state.history.push({ role: "assistant", content: text });
      trimHistory();
    }
    state.flowAwaiting = null;
    els.suggestions.replaceChildren();

    if (step.expectInput) {
      state.flowAwaiting = { key: step.expectInput, next: step.next };
      requestAnimationFrame(() => els.input.focus());
      return;
    }
    if (Array.isArray(step.options)) renderFlowOptions(step.options);
  }

  function renderFlowOptions(options) {
    els.suggestions.replaceChildren();
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flow-option-button";
      button.textContent = option.label;
      button.addEventListener("click", () => handleFlowOption(option));
      els.suggestions.append(button);
    }
  }

  function handleFlowOption(option) {
    if (state.busy || !state.department) return;
    addMessage("user", option.label);
    state.history.push({ role: "user", content: option.label });
    trimHistory();
    els.suggestions.replaceChildren();

    if (option.set) state.flowData[option.set.key] = option.set.value || option.label;
    if (option.hot) state.flowData.leadQuente = true;

    const flow = FLOWS[state.department.id];
    if (option.next && flow?.steps[option.next]) {
      runFlowStep(flow.steps[option.next]);
      return;
    }
    if (option.action === "handoff") {
      openHandoff(buildFlowReason(option.reason));
      return;
    }
    if (option.action === "clip") {
      els.fileInput.click();
      return;
    }
    if (option.action === "ask") {
      els.input.value = option.question || option.label;
      autoResizeInput();
      els.form.requestSubmit();
      return;
    }
    // action "free": libera o campo de texto para a IA
    const prompt = "Pode escrever sua dúvida — vou responder com as informações públicas aprovadas.";
    addMessage("assistant", prompt);
    state.history.push({ role: "assistant", content: prompt });
    requestAnimationFrame(() => els.input.focus());
  }

  function buildFlowReason(base) {
    const d = state.flowData;
    const parts = [];
    if (d.leadQuente) parts.push("LEAD QUENTE");
    if (d.empresa) parts.push(`Empresa: ${d.empresa}`);
    if (d.cidade) parts.push(`Cidade/UF: ${d.cidade}`);
    if (d.cargo) parts.push(`Função: ${d.cargo}`);
    if (d.faixaConta) parts.push(`Conta mensal: ${d.faixaConta}`);
    if (d.responsavel) parts.push(`Responsável indicado: ${d.responsavel}`);
    if (d.perfil) parts.push(`Perfil: ${d.perfil}`);
    if (d.assunto) parts.push(`Assunto: ${d.assunto}`);
    const suffix = parts.length ? ` | ${parts.join(" · ")}` : "";
    return `${base || "Solicitação do visitante"}${suffix}`.slice(0, 380);
  }

  // ---- Cadastro inicial: uma só tela (nome, WhatsApp, e-mail, departamento,
  // caixa de mensagem e clipe) — mobile-first, sem etapa intermediária ----

  function attachStartFile(file) {
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      return showStartError("Formato não aceito. Envie a conta em PDF, JPG ou PNG.");
    }
    if (file.size > 8 * 1024 * 1024) {
      return showStartError("O arquivo passa de 8 MB. Envie uma foto menor ou o PDF original da conta.");
    }
    state.pendingStartFile = file;
    els.startFileChip.textContent = `📎 ${file.name}`;
    els.startFileChip.hidden = false;
    els.startError.hidden = true;
  }

  async function handleStartSubmit(event) {
    event.preventDefault();

    const name = els.startName.value.trim().replace(/\s+/g, " ");
    const email = els.startEmail.value.trim();
    const phoneDisplay = els.startPhone.value;
    const phone = normalizeBrazilianPhone(phoneDisplay);
    const department = els.startDepartment.value;
    const consent = els.startConsent.checked;
    const message = els.startMessage.value.trim();

    if (name.length < 5 || !name.includes(" ")) return showStartError("Informe seu nome completo (nome e sobrenome).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showStartError("Informe um e-mail válido.");
    if (!phone) return showStartError("Informe um número de WhatsApp válido com DDD.");
    if (!getDepartment(department)) return showStartError("Selecione o departamento.");
    if (!consent) return showStartError("É necessário autorizar o contato para iniciar o atendimento.");
    if (!config.demoMode && config.turnstileSiteKey && !state.startToken) {
      return showStartError("Conclua a verificação de segurança.");
    }

    els.startSubmit.disabled = true;
    els.startSubmit.querySelector("span:first-child").textContent = "Gerando protocolo…";
    els.startError.hidden = true;

    try {
      const payload = {
        department,
        name,
        email,
        phone,
        consent: true,
        consentText: CONSENT_TEXT,
        requestId: crypto.randomUUID(),
        turnstileToken: state.startToken
      };
      const response = config.demoMode
        ? await demoSessionResponse(payload)
        : await callApi("/v1/session", payload, 30000);

      if (!response.ok) throw new Error(response.error || "Não foi possível iniciar o atendimento.");

      state.session = {
        token: response.sessionToken,
        protocol: response.protocol,
        withinBusinessHours: response.withinBusinessHours !== false
      };
      state.profile = { name, email, phone, phoneDisplay };
      state.abandonSent = false;
      state.handoffDone = false;

      const pendingFile = state.pendingStartFile;
      state.pendingStartFile = null;
      enterChat(department);

      if (pendingFile) await uploadAccountFile(pendingFile);
      if (message) {
        els.input.value = message;
        autoResizeInput();
        els.form.requestSubmit();
      }

      els.startForm.reset();
      els.startFileChip.hidden = true;
      resetStartTurnstile();
    } catch (error) {
      console.error(error);
      showStartError(error.message || "Não foi possível concluir o cadastro. Tente novamente.");
      resetStartTurnstile();
    } finally {
      els.startSubmit.disabled = false;
      els.startSubmit.querySelector("span:first-child").textContent = "Iniciar";
    }
  }

  function buildSimulationText(flowData, profile) {
    const raw = String(flowData.valorConta || "")
      .replace(/[Rr]\$\s*/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.]/g, "");
    const valor = Number.parseFloat(raw);
    if (!Number.isFinite(valor) || valor < 100 || valor > 10000000) {
      return "Não consegui interpretar o valor informado. De todo modo, com a conta de energia em mãos o cálculo sai exato — e o especialista confirma a elegibilidade da sua unidade.";
    }
    const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    const mensal = valor * 0.3;
    const anual = mensal * 12;
    return `${firstName(profile)}, com uma conta média de ${brl(valor)} por mês, sua economia pode chegar a ${brl(mensal)} por mês — até ${brl(anual)} por ano, considerando o teto de 30% do programa. É uma estimativa inicial: o número exato depende da análise da conta, da distribuidora e da elegibilidade da unidade. Chega de deixar dinheiro na mesa todos os meses — quer avançar?`;
  }

  async function uploadAccountFile(file) {
    if (!state.department || state.busy) return;
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      addMessage("assistant", "Formato não aceito. Envie a conta em PDF, JPG ou PNG.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      addMessage("assistant", "O arquivo passa de 8 MB. Envie uma foto menor ou o PDF original da conta.");
      return;
    }
    if (!state.session) {
      addMessage("assistant", "Conclua o cadastro inicial para anexar a conta ao seu protocolo.");
      return;
    }

    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    addMessage("user", `📎 ${file.name} (${sizeKb} KB)`);
    state.history.push({ role: "user", content: `Enviei minha conta de energia em anexo (${file.name}).` });
    trimHistory();
    els.suggestions.replaceChildren();
    const typing = addTypingMessage();

    try {
      let response;
      if (config.demoMode) {
        await delay(900);
        response = { ok: true, message: "Conta recebida com sucesso (simulação — nenhum arquivo real foi transmitido). Ela ficaria anexada ao seu protocolo para a análise de consumo, distribuidora e tarifa." };
      } else {
        const base = String(config.apiBaseUrl || "").replace(/\/$/, "");
        if (!base || base.includes("SEU-SUBDOMINIO")) throw new Error("A URL da API ainda não foi configurada.");
        const formData = new FormData();
        formData.set("sessionToken", state.session.token);
        formData.set("file", file, file.name);
        const res = await fetch(`${base}/v1/upload`, { method: "POST", body: formData, credentials: "omit" });
        response = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(response.error || `Falha no envio do arquivo (${res.status}).`);
      }

      typing.remove();
      state.flowData.contaEnviada = true;
      const confirmation = `${response.message || "Conta recebida com sucesso."} Posso acionar o especialista agora para concluir a análise?`;
      addMessage("assistant", confirmation);
      state.history.push({ role: "assistant", content: confirmation });
      trimHistory();
      renderFlowOptions([
        { label: "Sim, falar com o especialista", action: "handoff", reason: "Conta de energia enviada pelo site — pronta para análise e proposta" },
        { label: "Tenho outra dúvida antes", action: "free" }
      ]);
    } catch (error) {
      typing.remove();
      console.error(error);
      addMessage("assistant", error.message || "Não foi possível enviar o arquivo. Tente novamente ou peça o atendimento humano.");
    }
  }

  function sendAbandonBeacon() {
    if (!state.session || state.handoffDone || state.abandonSent || config.demoMode) return;
    const base = String(config.apiBaseUrl || "").replace(/\/$/, "");
    if (!base || base.includes("SEU-SUBDOMINIO")) return;
    state.abandonSent = true;
    try {
      // text/plain evita preflight; sendBeacon sobrevive ao fechamento da aba.
      const body = new Blob([JSON.stringify({ sessionToken: state.session.token })], { type: "text/plain" });
      navigator.sendBeacon(`${base}/v1/session/abandon`, body);
    } catch (_) { /* melhor esforço */ }
  }

  function showStartError(message) {
    els.startError.textContent = message;
    els.startError.hidden = false;
  }

  async function demoSessionResponse(payload) {
    await delay(700);
    const ymd = new Date(Date.now() - 180 * 60000).toISOString().slice(0, 10).replaceAll("-", "");
    const numero = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    return {
      ok: true,
      protocol: `NS-${ymd}-${numero}`,
      sessionToken: "demo-session-token",
      departmentLabel: getDepartment(payload.department)?.label || "",
      bitrixCardCreated: false,
      withinBusinessHours: (() => {
        const agora = new Date();
        const dia = agora.getDay();
        const hora = agora.getHours();
        return dia >= 1 && dia <= 5 && hora >= 8 && hora < 18;
      })()
    };
  }

  function renderStartTurnstileIfNeeded() {
    if (config.demoMode || !config.turnstileSiteKey) {
      els.startTurnstileContainer.replaceChildren();
      state.startToken = config.demoMode ? "demo-token" : "";
      return;
    }
    const tryRender = () => {
      if (!window.turnstile) {
        setTimeout(tryRender, 150);
        return;
      }
      if (state.startWidgetId !== null) {
        window.turnstile.reset(state.startWidgetId);
        return;
      }
      state.startWidgetId = window.turnstile.render(els.startTurnstileContainer, {
        sitekey: config.turnstileSiteKey,
        theme: "dark",
        language: "pt-BR",
        callback: (token) => { state.startToken = token; },
        "expired-callback": () => { state.startToken = ""; },
        "error-callback": () => { state.startToken = ""; }
      });
    };
    tryRender();
  }

  function resetStartTurnstile() {
    state.startToken = "";
    if (window.turnstile && state.startWidgetId !== null) {
      try { window.turnstile.reset(state.startWidgetId); } catch (_) { /* noop */ }
    }
  }

  function showWelcome() {
    // Com cadastro já feito, "voltar"/"mudar área" mostra só a grade de
    // departamentos — não repete nome, e-mail e WhatsApp.
    showOnly(state.session ? els.departmentPickerView : els.welcomeView);
    state.department = null;
    state.history = [];
    els.messages.replaceChildren();
    els.suggestions.replaceChildren();
  }

  async function handleChatSubmit(event) {
    event.preventDefault();
    if (state.busy || !state.department) return;

    const message = els.input.value.trim();
    if (!message) return;

    // Passo de campo livre do fluxo guiado: captura a resposta sem chamar a IA.
    if (state.flowAwaiting) {
      const awaiting = state.flowAwaiting;
      state.flowAwaiting = null;
      addMessage("user", message);
      state.history.push({ role: "user", content: message });
      trimHistory();
      state.flowData[awaiting.key] = message.slice(0, 140);
      els.input.value = "";
      autoResizeInput();
      const flow = FLOWS[state.department.id];
      if (awaiting.next && flow?.steps[awaiting.next]) runFlowStep(flow.steps[awaiting.next]);
      return;
    }

    setBusy(true);
    addMessage("user", message);
    state.history.push({ role: "user", content: message });
    trimHistory();
    els.input.value = "";
    autoResizeInput();
    renderSuggestions([]);

    const typing = addTypingMessage();

    try {
      const response = config.demoMode
        ? await demoChatResponse(message, state.department)
        : await callApi("/v1/chat", {
            sessionId: state.sessionId,
            department: state.department.id,
            message,
            history: state.history.slice(0, -1)
          });

      typing.remove();

      const answer = typeof response.answer === "string" && response.answer.trim()
        ? response.answer.trim()
        : "Não consegui concluir essa resposta com segurança. Posso encaminhar sua solicitação ao time responsável.";

      addMessage("assistant", answer, {
        sources: Array.isArray(response.sources) ? response.sources : [],
        confidence: response.confidence
      });
      state.history.push({ role: "assistant", content: answer });
      trimHistory();

      if (response.suggestedDepartment && response.suggestedDepartment !== state.department.id) {
        const suggested = getDepartment(response.suggestedDepartment);
        if (suggested) {
          const suggestedQuestions = Array.isArray(response.suggestedQuestions) ? response.suggestedQuestions : [];
          renderSuggestions([`Mudar para ${suggested.label}`, ...suggestedQuestions], suggested.id);
        } else {
          renderSuggestions(response.suggestedQuestions || []);
        }
      } else {
        renderSuggestions(response.suggestedQuestions || []);
      }

      if (response.needsHuman) {
        state.handoffReason = response.humanReason || "A dúvida requer validação humana";
        addHandoffPrompt(state.handoffReason);
      } else if (!state.hotLeadPrompted && HOT_LEAD_PATTERN.test(message)) {
        // Gatilho de lead quente: interrompe a cadência automática (seção 14 do fluxo).
        state.hotLeadPrompted = true;
        state.flowData.leadQuente = true;
        state.handoffReason = buildFlowReason("LEAD QUENTE — gatilho detectado na conversa");
        addHandoffPrompt(state.handoffReason);
      }
    } catch (error) {
      typing.remove();
      console.error(error);
      addMessage(
        "assistant",
        "O atendimento automático ficou temporariamente indisponível. Não vou inventar uma resposta. Você pode tentar novamente ou pedir o encaminhamento ao departamento.",
        { confidence: "low" }
      );
      state.handoffReason = "Falha temporária do atendimento automático";
      addHandoffPrompt(state.handoffReason);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => els.input.focus());
    }
  }

  function addMessage(role, text, options = {}) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${role}`;

    if (role === "assistant") {
      const avatar = makeAvatar();
      wrapper.append(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const content = document.createElement("div");
    if (role === "assistant" && options.typewriter !== false && text) {
      void typeWords(content, text);
    } else {
      content.textContent = text;
    }
    bubble.append(content);

    if (options.sources?.length) {
      const sourceList = document.createElement("div");
      sourceList.className = "source-list";
      for (const source of [...new Set(options.sources)].slice(0, 4)) {
        const chip = document.createElement("span");
        chip.className = "source-chip";
        chip.textContent = String(source).slice(0, 90);
        sourceList.append(chip);
      }
      bubble.append(sourceList);
    }

    if (role === "assistant" && options.confidence) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.textContent = confidenceLabel(options.confidence);
      bubble.append(meta);
    }

    wrapper.append(bubble);
    els.messages.append(wrapper);
    scrollMessages();
    return wrapper;
  }

  // Revela o texto palavra por palavra, como se estivesse sendo digitado.
  // O intervalo por palavra é calculado para a mensagem inteira aparecer em
  // cerca de 1 segundo, independente do tamanho — mensagens curtas "digitam"
  // mais devagar, mensagens longas mais rápido, sem travar o chat.
  function typeWords(el, text) {
    const words = text.split(/(\s+)/).filter((part) => part !== "");
    const targetTotalMs = 1000;
    const wordDelay = Math.max(18, Math.min(90, targetTotalMs / Math.max(1, words.length)));
    let index = 0;
    return new Promise((resolve) => {
      function step() {
        if (index >= words.length) { resolve(); return; }
        el.textContent += words[index];
        index += 1;
        scrollMessages();
        setTimeout(step, wordDelay);
      }
      step();
    });
  }

  function addTypingMessage() {
    const wrapper = document.createElement("article");
    wrapper.className = "message assistant";

    const avatar = makeAvatar();

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.setAttribute("aria-label", `${state.attendantName} está digitando`);

    const row = document.createElement("div");
    row.className = "typing-row";
    const label = document.createElement("span");
    label.className = "typing-label";
    label.textContent = `${state.attendantName} está digitando`;
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    row.append(label, dots);
    bubble.append(row);
    wrapper.append(avatar, bubble);
    els.messages.append(wrapper);
    scrollMessages();
    return wrapper;
  }

  function addHandoffPrompt(reason) {
    const wrapper = document.createElement("article");
    wrapper.className = "message assistant";

    const avatar = makeAvatar();

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const text = document.createElement("div");
    text.textContent = "Esta etapa precisa de uma pessoa autorizada. Posso registrar o protocolo e avisar o setor agora.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.style.marginTop = "12px";
    button.textContent = "Encaminhar para uma pessoa";
    button.addEventListener("click", () => openHandoff(reason));

    bubble.append(text, button);
    wrapper.append(avatar, bubble);
    els.messages.append(wrapper);
    scrollMessages();
  }

  function renderSuggestions(suggestions, switchDepartmentId = "") {
    els.suggestions.replaceChildren();
    const normalized = Array.isArray(suggestions) ? suggestions.slice(0, 5) : [];

    for (const suggestion of normalized) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-button";
      button.textContent = suggestion;
      button.addEventListener("click", () => {
        if (switchDepartmentId && suggestion.startsWith("Mudar para ")) {
          selectDepartment(switchDepartmentId);
          return;
        }
        els.input.value = suggestion;
        autoResizeInput();
        els.form.requestSubmit();
      });
      els.suggestions.append(button);
    }
  }

  function openHandoff(reason) {
    if (!state.department) return;
    state.handoffReason = reason || state.handoffReason;
    if (!state.handoffRequestId) state.handoffRequestId = crypto.randomUUID();
    els.handoffContext.textContent = `Vamos enviar um resumo ao departamento ${state.department.label}. Depois da confirmação, você poderá fechar o site; o time entrará em contato pelo WhatsApp informado.`;
    if (state.profile) {
      if (!els.handoffName.value) els.handoffName.value = state.profile.name;
      if (!els.handoffPhone.value) els.handoffPhone.value = state.profile.phoneDisplay || "";
      if (!els.handoffEmail.value) els.handoffEmail.value = state.profile.email || "";
    }
    els.handoffError.hidden = true;
    els.handoffError.textContent = "";
    els.handoffSubmit.disabled = false;
    els.handoffSubmit.textContent = "Enviar para o departamento";
    els.handoffDialog.showModal();
    renderTurnstileIfNeeded();
    requestAnimationFrame(() => els.handoffName.focus());
  }

  function closeHandoff() {
    els.handoffDialog.close();
  }

  async function handleHandoffSubmit(event) {
    event.preventDefault();
    if (!state.department) return;

    const name = els.handoffName.value.trim();
    const phone = normalizeBrazilianPhone(els.handoffPhone.value);
    const email = els.handoffEmail.value.trim();
    const organization = els.handoffOrganization.value.trim();
    const consent = els.handoffConsent.checked;

    if (name.length < 2) return showHandoffError("Informe seu nome.");
    if (!phone) return showHandoffError("Informe um número de WhatsApp válido com DDD.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showHandoffError("Informe um e-mail válido ou deixe o campo vazio.");
    if (!consent) return showHandoffError("É necessário autorizar o contato para concluir o encaminhamento.");
    if (!config.demoMode && config.turnstileSiteKey && !state.turnstileToken && !state.session) {
      return showHandoffError("Conclua a verificação de segurança.");
    }

    els.handoffSubmit.disabled = true;
    els.handoffSubmit.textContent = "Registrando atendimento…";
    els.handoffError.hidden = true;

    try {
      const payload = {
        sessionId: state.sessionId,
        department: state.department.id,
        name,
        phone,
        email,
        organization,
        consent: true,
        consentText: CONSENT_TEXT,
        sessionToken: state.session?.token || "",
        reason: state.handoffReason,
        history: state.history.slice(-(Number(config.maxHistoryMessages) || 12)),
        turnstileToken: state.turnstileToken,
        requestId: state.handoffRequestId
      };

      const response = config.demoMode
        ? await demoHandoffResponse(payload)
        : await callApi("/v1/handoff", payload, 45000);

      if (!response.ok) throw new Error(response.error || "Não foi possível registrar o atendimento.");

      state.handoffDone = true;
      els.handoffDialog.close();
      els.protocolNumber.textContent = response.ticketId || "PROTOCOLO PENDENTE";
      showOnly(els.successView);
      state.handoffRequestId = "";
      resetTurnstile();

      if (response.employeeNotified) {
        renderHandoffConfirmed(response.message);
      } else {
        renderHandoffPending(response.message);
        void pollHandoffStatus({
          ticketId: response.ticketId,
          statusToken: response.statusToken,
          demo: Boolean(config.demoMode)
        });
      }
    } catch (error) {
      console.error(error);
      showHandoffError(error.message || "Não foi possível concluir. Verifique os dados e tente novamente.");
      els.handoffSubmit.disabled = false;
      els.handoffSubmit.textContent = "Tentar novamente";
      resetTurnstile();
    }
  }

  function renderHandoffPending(message) {
    els.successView.classList.add("is-pending");
    els.successView.classList.remove("is-failed");
    els.successViewIcon.textContent = "…";
    els.successEyebrow.textContent = "Confirmando entrega";
    els.successTitle.textContent = "Aguarde antes de fechar";
    els.successMessage.textContent = message || "A notificação foi enviada e estamos confirmando a entrega ao setor responsável.";
    els.successFootnote.textContent = "Só exibiremos a liberação para fechar esta página após confirmação de entrega da notificação. A leitura pelo funcionário pode ocorrer depois.";
  }

  function renderHandoffConfirmed(message) {
    state.statusPollGeneration += 1;
    els.successView.classList.remove("is-pending", "is-failed");
    els.successViewIcon.textContent = "✓";
    els.successEyebrow.textContent = "Encaminhamento confirmado";
    els.successTitle.textContent = "Você pode fechar esta página";
    els.successMessage.textContent = message || "O departamento confirmou o recebimento da notificação e do seu contato para iniciar o atendimento pelo WhatsApp.";
    els.successFootnote.textContent = "O contato será realizado pelo WhatsApp informado. Desconfie de pedidos de senha, código de verificação ou pagamento fora dos canais oficiais.";
  }

  function renderHandoffFailed(message) {
    state.statusPollGeneration += 1;
    els.successView.classList.remove("is-pending");
    els.successView.classList.add("is-failed");
    els.successViewIcon.textContent = "!";
    els.successEyebrow.textContent = "Entrega não confirmada";
    els.successTitle.textContent = "Não feche por confirmação presumida";
    els.successMessage.textContent = message || "O protocolo foi preservado, mas não confirmamos a entrega da notificação. Tente o encaminhamento novamente.";
    els.successFootnote.textContent = "A NewSun não informa que um funcionário recebeu a solicitação sem evidência de entrega. Guarde o protocolo para suporte.";
  }

  async function pollHandoffStatus({ ticketId, statusToken, demo }) {
    if (!ticketId || !statusToken) {
      renderHandoffFailed("O atendimento foi registrado, mas faltou o token seguro de confirmação. Guarde o protocolo e tente novamente.");
      return;
    }

    const generation = ++state.statusPollGeneration;
    const maxAttempts = demo ? 4 : 40;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (generation !== state.statusPollGeneration) return;
      await delay(demo ? 650 : 1500);
      try {
        const status = demo
          ? {
              ok: true,
              employeeNotified: attempt >= 3,
              failed: false,
              message: attempt >= 3
                ? `O departamento ${state.department?.label || "responsável"} confirmou o recebimento da notificação. Você pode fechar esta página.`
                : "A notificação de demonstração ainda está em trânsito."
            }
          : await getApi(`/v1/handoff/status?ticket=${encodeURIComponent(ticketId)}&token=${encodeURIComponent(statusToken)}`);

        if (status.employeeNotified) {
          renderHandoffConfirmed(status.message);
          return;
        }
        if (status.failed) {
          renderHandoffFailed(status.message);
          return;
        }
        els.successMessage.textContent = status.message || "Aguardando confirmação de entrega ao setor responsável.";
      } catch (error) {
        if (attempt === maxAttempts) {
          renderHandoffFailed("Não foi possível confirmar a entrega da notificação dentro do tempo de verificação. O protocolo foi preservado; tente novamente ou use um canal oficial.");
          return;
        }
      }
    }

    renderHandoffFailed("A confirmação de entrega não chegou dentro de 60 segundos. O protocolo foi preservado, mas esta página não afirmará que o setor recebeu a solicitação.");
  }

  function renderTurnstileIfNeeded() {
    if (state.session) {
      // A sessão já passou pela verificação de segurança no cadastro inicial.
      els.turnstileContainer.replaceChildren();
      return;
    }
    if (config.demoMode || !config.turnstileSiteKey) {
      els.turnstileContainer.replaceChildren();
      state.turnstileToken = config.demoMode ? "demo-token" : "";
      return;
    }

    const tryRender = () => {
      if (!window.turnstile) {
        setTimeout(tryRender, 150);
        return;
      }

      if (state.turnstileWidgetId !== null) {
        window.turnstile.reset(state.turnstileWidgetId);
        return;
      }

      state.turnstileWidgetId = window.turnstile.render(els.turnstileContainer, {
        sitekey: config.turnstileSiteKey,
        theme: "dark",
        language: "pt-BR",
        callback: (token) => { state.turnstileToken = token; },
        "expired-callback": () => { state.turnstileToken = ""; },
        "error-callback": () => { state.turnstileToken = ""; }
      });
    };

    tryRender();
  }

  function resetTurnstile() {
    state.turnstileToken = "";
    if (window.turnstile && state.turnstileWidgetId !== null) {
      try { window.turnstile.reset(state.turnstileWidgetId); } catch (_) { /* noop */ }
    }
  }

  function resetConversation() {
    state.sessionId = crypto.randomUUID();
    state.department = null;
    state.history = [];
    state.handoffReason = "Solicitação do visitante";
    state.handoffRequestId = "";
    state.statusPollGeneration += 1;
    state.session = null;
    state.profile = null;
    state.flowData = {};
    state.flowAwaiting = null;
    state.hotLeadPrompted = false;
    state.handoffDone = false;
    state.abandonSent = false;
    state.pendingStartFile = null;
    state.attendantName = pickAttendantName();
    els.protocolChip.hidden = true;
    els.protocolChip.textContent = "";
    els.startForm.reset();
    els.startFileChip.hidden = true;
    resetStartTurnstile();
    els.handoffForm.reset();
    els.messages.replaceChildren();
    els.suggestions.replaceChildren();
    showOnly(els.welcomeView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function getApi(path, timeoutOverride) {
    const base = String(config.apiBaseUrl || "").replace(/\/$/, "");
    if (!base || base.includes("SEU-SUBDOMINIO")) {
      throw new Error("A URL da API ainda não foi configurada.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutOverride || 12000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { "X-Client-Version": "1.0.0" },
        signal: controller.signal,
        credentials: "omit"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Falha ao verificar o status (${response.status}).`);
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function callApi(path, body, timeoutOverride) {
    const base = String(config.apiBaseUrl || "").replace(/\/$/, "");
    if (!base || base.includes("SEU-SUBDOMINIO")) {
      throw new Error("A URL da API ainda não foi configurada.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutOverride || Number(config.requestTimeoutMs) || 30000
    );

    try {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Version": "1.0.0",
          ...(body.requestId ? { "Idempotency-Key": body.requestId } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit"
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `Falha no atendimento (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O atendimento demorou mais que o esperado. Tente novamente.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function demoChatResponse(message, department) {
    await delay(650 + Math.random() * 550);
    const text = message.toLocaleLowerCase("pt-BR");

    if (/senha|token|chave de api|credencial|dados internos|estrat[eé]gia confidencial|sal[aá]rio|lista de clientes/.test(text)) {
      return {
        answer: "Não posso acessar nem compartilhar credenciais, dados pessoais, documentos internos ou informações estratégicas. Posso explicar apenas informações públicas e encaminhar uma solicitação legítima ao setor autorizado.",
        confidence: "high",
        needsHuman: true,
        humanReason: "Solicitação envolve informação protegida ou precisa de validação de acesso",
        suggestedQuestions: ["Quais informações são públicas?", "Como falar com o setor responsável?"],
        sources: ["Política de segurança do atendimento"]
      };
    }

    if (/pain[eé]is|placas|obra|instala/.test(text)) {
      return {
        answer: "Na modalidade de energia limpa por assinatura, a geração ocorre em usinas remotas. Em regra, o cliente não precisa instalar painéis no condomínio ou na empresa, fazer obra local nem comprar uma usina. A elegibilidade e as condições dependem da unidade consumidora, da distribuidora e da análise comercial.",
        confidence: "high",
        needsHuman: false,
        suggestedQuestions: ["Como os créditos chegam à conta?", "Quem pode contratar?", "Como pedir uma análise?"],
        sources: ["Central de Ajuda NewSun", "Comunicação institucional aprovada"]
      };
    }

    if (/como funciona|assinatura|cr[eé]ditos/.test(text)) {
      return {
        answer: "A NewSun gera energia limpa em usinas remotas. A energia é convertida em créditos dentro das regras aplicáveis e esses créditos são considerados na fatura da unidade consumidora. O cliente continua conectado à distribuidora e recebe a solução sem obra local. Prazos, disponibilidade e benefício econômico precisam ser confirmados para cada unidade.",
        confidence: "high",
        needsHuman: false,
        suggestedQuestions: ["Precisa trocar de distribuidora?", "Quanto tempo leva?", "Como solicitar uma análise?"],
        sources: ["Central de Ajuda NewSun"]
      };
    }

    if (/economia|desconto|quanto vou economizar|porcent/.test(text)) {
      return {
        answer: "O benefício econômico não deve ser prometido sem analisar a unidade consumidora, a distribuidora, os tributos e a modalidade contratual aplicável. A proposta da NewSun combina previsibilidade, transparência e economia progressiva. Para calcular seu caso, o time precisa receber a conta de energia por um canal seguro.",
        confidence: "high",
        needsHuman: true,
        humanReason: "Cálculo individual exige análise da conta de energia e validação comercial",
        suggestedQuestions: ["Quais dados são necessários para a análise?", "A análise tem custo?"],
        sources: ["Diretrizes de comunicação NewSun"]
      };
    }

    if (/fatura|boleto|pagamento|cobrança|segunda via|cr[eé]dito.*atras/.test(text) || ["financeiro", "atendimento", "operacoes"].includes(department.id)) {
      return {
        answer: "Consigo explicar o processo geral, mas não tenho acesso à sua conta, boleto, contrato, histórico de pagamento ou status operacional. Para proteger seus dados e evitar uma resposta errada, essa verificação precisa ser feita por uma pessoa autorizada com protocolo.",
        confidence: "high",
        needsHuman: true,
        humanReason: `Consulta individual para o departamento ${department.label}`,
        suggestedQuestions: ["Quais dados serão solicitados?", "Posso fechar o site depois do encaminhamento?"],
        sources: ["Política de privacidade do atendimento"]
      };
    }

    if (/contrato|cl[aá]usula|jur[ií]dic|rescis/.test(text)) {
      return {
        answer: "Posso explicar termos gerais, mas não devo interpretar uma cláusula nem afirmar direitos e obrigações sem ler a versão vigente e confirmar o contexto. O Jurídico ou o Comercial autorizado deve analisar o documento específico.",
        confidence: "high",
        needsHuman: true,
        humanReason: "Análise contratual específica",
        suggestedDepartment: "juridico",
        suggestedQuestions: ["Como envio o contrato com segurança?", "Quem fará a análise?"],
        sources: ["Governança de comunicação NewSun"]
      };
    }

    if (/quem [eé] a newsun|o que [eé] a newsun/.test(text)) {
      return {
        answer: "A NewSun é um ecossistema de energia limpa, tecnologia e experiência voltado a simplificar a relação de condomínios e empresas com energia. O posicionamento combina previsibilidade, transparência, sustentabilidade real e suporte humano — sem reduzir a solução a uma simples disputa de preço.",
        confidence: "high",
        needsHuman: false,
        suggestedQuestions: ["Como funciona a energia por assinatura?", "A NewSun atende condomínios?", "Como falar com o Comercial?"],
        sources: ["Comunicação institucional aprovada"]
      };
    }

    return {
      answer: `Entendi sua dúvida sobre ${department.label}. Com as informações públicas disponíveis, consigo orientar o conceito e os próximos passos, mas não vou presumir dados da sua conta nem prometer condições específicas. Explique um pouco mais o que você precisa resolver, sem enviar documentos, senhas ou dados bancários.`,
      confidence: "medium",
      needsHuman: false,
      suggestedQuestions: department.suggestions,
      sources: ["Central de Ajuda NewSun"]
    };
  }

  async function demoHandoffResponse(payload) {
    await delay(900);
    const suffix = String(Math.floor(100000 + Math.random() * 900000));
    return {
      ok: true,
      ticketId: state.session?.protocol || `DEMO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${suffix}`,
      statusToken: "demo-status-token",
      employeeNotified: false,
      notificationAccepted: true,
      notificationState: "accepted_by_whatsapp",
      message: `Simulação registrada para ${payload.name}. Estamos demonstrando a etapa de confirmação antes de liberar o fechamento da página; nenhuma mensagem real foi enviada.`
    };
  }

  function showOnly(view) {
    for (const element of [els.welcomeView, els.departmentPickerView, els.chatView, els.successView]) {
      element.hidden = element !== view;
    }
  }

  function setBusy(value) {
    state.busy = value;
    els.send.disabled = value;
    els.input.disabled = value;
    els.send.querySelector("span:first-child").textContent = value ? "Pensando" : "Enviar";
  }

  function trimHistory() {
    const limit = Math.max(4, Number(config.maxHistoryMessages) || 12);
    if (state.history.length > limit) state.history = state.history.slice(-limit);
  }

  function scrollMessages() {
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function autoResizeInput() {
    autoResizeField(els.input);
  }

  function autoResizeField(field) {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 130)}px`;
  }

  function maskPhoneInput() {
    maskPhoneField(els.handoffPhone);
  }

  function maskPhoneField(field) {
    let digits = field.value.replace(/\D/g, "").slice(0, 13);
    if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
    if (digits.length <= 2) {
      field.value = digits ? `(${digits}` : "";
    } else if (digits.length <= 6) {
      field.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    } else if (digits.length <= 10) {
      field.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    } else {
      field.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
    }
  }

  function normalizeBrazilianPhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
    if (!/^\d{10,11}$/.test(digits)) return "";
    const ddd = Number(digits.slice(0, 2));
    if (ddd < 11 || ddd > 99) return "";
    return `55${digits}`;
  }

  function showHandoffError(message) {
    els.handoffError.textContent = message;
    els.handoffError.hidden = false;
  }

  function confidenceLabel(value) {
    const normalized = String(value).toLowerCase();
    if (normalized === "high") return "Resposta baseada em conteúdo público aprovado";
    if (normalized === "medium") return "Orientação geral — confirme condições específicas";
    return "Baixa confiança — validação humana recomendada";
  }

  function getDepartment(id) {
    return DEPARTMENTS.find((item) => item.id === id) || null;
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Elemento obrigatório ausente: #${id}`);
    return element;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
