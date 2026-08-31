window.NEWSUN_CHAT_CONFIG = Object.freeze({
  // Troque pela URL do Cloudflare Worker depois do deploy.
  apiBaseUrl: "https://newsun-atendimento-api.lucianosbq.workers.dev",

  // Cole a Site Key do Cloudflare Turnstile. O secret fica somente no Worker.
  turnstileSiteKey: "0x4AAAAAAEjAspbfdd5vPf1J",

  // true mantém uma demonstração navegável sem chamar serviços externos.
  // Mude para false em produção.
  demoMode: false,

  // Usado apenas para exibir a política ao visitante.
  privacyUrl: "",

  maxHistoryMessages: 12,
  requestTimeoutMs: 30000
});
