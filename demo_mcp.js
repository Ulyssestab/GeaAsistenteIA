/*! 
 * demo.js
 * Lanzador que abre ventana-demo(_sin-azure).html en otra pestaña (_blank)
 * Corregido para tomar SIEMPRE el Eleven Voice ID actual y usar ElevenLabs por defecto.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const ui = {
    title: $("title"),
    provider: $("provider"),
    lang: $("lang"),
    windowUrl: $("windowUrl"),
    apiUrl: $("apiUrl"),
    ttsUrl: $("ttsUrl"),
    azureVoice: $("azureVoice"),
    elevenVoice: $("elevenVoice"),

    avatarIdle: $("avatarIdle"),
    avatarListen: $("avatarListen"),
    avatarRead: $("avatarRead"),
    avatarThink: $("avatarThink"),
    avatarTalk: $("avatarTalk"),
    stickerWidth: $("stickerWidth"),

    azureField: $("azureField"),
    elevenField: $("elevenField"),

    btnOpen: $("btnOpen"),
    btnSticker: $("btnSticker"),
    btnHideSticker: $("btnHideSticker"),
    status: $("status"),

    stickerBtn: $("stickerBtn"),
    stickerImg: $("stickerImg")
  };

  if (!ui.btnOpen) return;

  function setStatus(msg) {
    if (ui.status) ui.status.textContent = msg;
  }

  function pick(v, fallback) {
    const s = (v ?? "").toString().trim();
    return s !== "" ? s : (fallback ?? "");
  }

  function val(el, fallback) {
    return pick(el && "value" in el ? el.value : "", fallback);
  }

  function safeDisplay(el, show) {
    if (!el || !el.style) return;
    el.style.display = show ? "flex" : "none";
  }

  function getProvider() {
    // En archivos _sin-azure conviene usar ElevenLabs como fallback.
    return val(ui.provider, "elevenlabs").toLowerCase();
  }

  function updateProviderFields() {
    const p = getProvider();
    safeDisplay(ui.azureField, p === "azure");
    safeDisplay(ui.elevenField, p === "elevenlabs");
  }

  function buildConfig() {
    const provider = getProvider();
    const elevenVoiceId = provider === "elevenlabs" ? val(ui.elevenVoice, "") : "";

    return {
      // Si el input está vacío, usar la versión sin-azure por defecto.
      windowUrl: val(ui.windowUrl, "./ventana-demo_sin-azure.html"),
      title: val(ui.title, "Asistente"),

      avatar: val(ui.avatarIdle, ""),
      avatarIdle: val(ui.avatarIdle, ""),
      avatarListen: val(ui.avatarListen, ""),
      avatarRead: val(ui.avatarRead, ""),
      avatarThink: val(ui.avatarThink, ""),
      avatarTalk: val(ui.avatarTalk, ""),

      apiUrl: val(ui.apiUrl, ""),
      tts: "1",
      ttsUrl: val(ui.ttsUrl, "/GeaAsistenteHub/api/tts.ashx"),
      ttsProvider: provider,
      azureVoice: provider === "azure" ? val(ui.azureVoice, "") : "",
      elevenVoiceId: elevenVoiceId,
      lang: val(ui.lang, "es-MX"),

      stickerWidth: parseInt(val(ui.stickerWidth, "180"), 10) || 180,

      // MCP: se genera al abrir (nuevo cada lanzamiento)
      session: ""
    };
  }

  function toQuery(cfg) {
    const params = new URLSearchParams();

    params.set("title", cfg.title);
    params.set("avatar", cfg.avatar);
    params.set("avatarIdle", cfg.avatarIdle);
    params.set("avatarListen", cfg.avatarListen);
    params.set("avatarRead", cfg.avatarRead);
    params.set("avatarThink", cfg.avatarThink);
    params.set("avatarTalk", cfg.avatarTalk);

    params.set("apiUrl", cfg.apiUrl);
    params.set("tts", cfg.tts);
    params.set("ttsUrl", cfg.ttsUrl);
    params.set("ttsProvider", cfg.ttsProvider);
    params.set("lang", cfg.lang);

    // MCP: sesión de conversación
    if (cfg.session) params.set("session", cfg.session);

    if (cfg.azureVoice) params.set("azureVoice", cfg.azureVoice);
    if (cfg.elevenVoiceId) params.set("elevenVoiceId", cfg.elevenVoiceId);

    // aliases por compatibilidad
    params.set("aiEndpoint", cfg.apiUrl);
    params.set("ttsEndpoint", cfg.ttsUrl);
    params.set("voiceProvider", cfg.ttsProvider);
    if (cfg.elevenVoiceId) params.set("elevenVoice", cfg.elevenVoiceId);

    return params.toString();
  }

  function buildUrl(cfg) {
    const q = toQuery(cfg) + "&v=" + Date.now(); // cache-buster
    const sep = cfg.windowUrl.includes("?") ? "&" : "?";
    return cfg.windowUrl + sep + q;
  }


// ===== MCP: Generar Session ID =====
function uuidV4() {
  // crypto.randomUUID() existe en navegadores modernos
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // Fallback RFC4122 v4
  const rnd = (len) => {
    const a = new Uint8Array(len);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i=0;i<len;i++) a[i] = Math.floor(Math.random()*256);
    return a;
  };
  const b = rnd(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(b, x => x.toString(16).padStart(2,"0")).join("");
  return (
    hex.slice(0,8) + "-" +
    hex.slice(8,12) + "-" +
    hex.slice(12,16) + "-" +
    hex.slice(16,20) + "-" +
    hex.slice(20)
  );
}

function newChatSessionId() {
  return "CHAT_" + uuidV4();
}

  /**
   * IMPORTANTE:
   * Abre SIEMPRE en pestaña nueva (no popup)
   */
  function openAssistantInTab() {
    const cfg = buildConfig();

    // MCP: cada vez que se abre, iniciar una sesión nueva (hila contexto dentro de esa pestaña)
    cfg.session = newChatSessionId();

    if (cfg.ttsProvider === "elevenlabs" && !cfg.elevenVoiceId) {
      setStatus("Falta capturar el Eleven Voice ID");
      try { ui.elevenVoice && ui.elevenVoice.focus(); } catch (_) {}
      return;
    }

    const url = buildUrl(cfg);

    // Diagnóstico útil para validar que sí está tomando el ID actual.
    try {
      console.debug("[demo.js] opening assistant", {
        ttsProvider: cfg.ttsProvider,
        elevenVoiceId: cfg.elevenVoiceId,
        session: cfg.session,
        windowUrl: cfg.windowUrl,
        url: url
      });
    } catch (_) {}

    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win) {
        try { win.focus(); } catch (_) {}
        const extra = (cfg.ttsProvider === "elevenlabs" && cfg.elevenVoiceId)
          ? (" | voiceId=" + cfg.elevenVoiceId)
          : "";
        setStatus("Asistente abierto en otra pestaña (" + cfg.ttsProvider + ")" + extra);
        return;
      }
    } catch (_) {}

    // Fallback si navegador bloquea
    location.href = url;
    setStatus("No se pudo abrir pestaña nueva, redirigiendo…");
  }

  function showSticker() {
    if (!ui.stickerImg || !ui.stickerBtn) return;

    const cfg = buildConfig();

    // MCP: cada vez que se abre, iniciar una sesión nueva (hila contexto dentro de esa pestaña)
    cfg.session = newChatSessionId();
    ui.stickerImg.src = cfg.avatarIdle || cfg.avatar || "";
    ui.stickerImg.style.width = (cfg.stickerWidth > 0 ? cfg.stickerWidth : 180) + "px";
    ui.stickerBtn.style.display = "block";
    setStatus("Sticker visible");
  }

  function hideSticker() {
    if (!ui.stickerBtn) return;
    ui.stickerBtn.style.display = "none";
    setStatus("Sticker oculto");
  }

  if (ui.provider) {
    ui.provider.addEventListener("change", () => {
      updateProviderFields();
      setStatus("Proveedor: " + getProvider());
    });
  }

  // Si cambia el ID de ElevenLabs, reflejarlo en el status para confirmar lectura.
  if (ui.elevenVoice) {
    const onVoiceChange = () => {
      if (getProvider() === "elevenlabs") {
        const v = val(ui.elevenVoice, "");
        setStatus(v ? ("Eleven Voice ID actualizado: " + v) : "Eleven Voice ID vacío");
      }
    };
    ui.elevenVoice.addEventListener("change", onVoiceChange);
    ui.elevenVoice.addEventListener("input", onVoiceChange);
  }

  ui.btnOpen.addEventListener("click", openAssistantInTab);
  if (ui.btnSticker) ui.btnSticker.addEventListener("click", showSticker);
  if (ui.btnHideSticker) ui.btnHideSticker.addEventListener("click", hideSticker);
  if (ui.stickerBtn) ui.stickerBtn.addEventListener("click", openAssistantInTab);

  updateProviderFields();
  showSticker();
})();
