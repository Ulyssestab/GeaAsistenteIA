(() => {
  "use strict";

  const script =
    document.currentScript ||
    Array.from(document.getElementsByTagName("script"))
      .reverse()
      .find((s) => (s.src || "").includes("embed-ia-chat.js"));

  if (!script) return;
  if (script.dataset.geaLoaded === "1") return;
  script.dataset.geaLoaded = "1";

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));

  const ds = script.dataset;

  const cfg = {
    base: ds.base || window.location.origin,
    title: ds.title || "Asistente IA",
    position: (ds.position || "right").toLowerCase() === "left" ? "left" : "right",
    avatar: ds.avatar || "",
    hint: ds.hint || "¡Hola! 👋",
    welcome: ds.welcome || "¡Hola! ¿En qué te ayudo hoy?",
    lang: ds.lang || "es-MX",

    // IA
    aiEndpoint: ds.aiEndpoint || `${ds.base || window.location.origin}/GeaAsistenteHub/api/agente.ashx`,
    aiProvider: ds.aiProvider || "gea", // ej: gea | openai | azure | custom
    aiPayload: (ds.aiPayload || "string").toLowerCase(), // "string" (compatible agente.ashx) u "object"
    aiKey: ds.aiKey || "",

    // Voz (salida TTS)
    voiceProvider: (ds.voiceProvider || ds.tts || "browser").toLowerCase(), // browser|azure|elevenlabs
    ttsEndpoint: ds.ttsEndpoint || `${ds.base || window.location.origin}/GeaAsistenteHub/api/tts.ashx`,
    ttsKey: ds.ttsKey || "",
    azureVoice: ds.azureVoice || "es-MX-DaliaNeural",
    elevenVoiceId: ds.elevenVoiceId || script.getAttribute("data-eleven-voice-id") || "",
    ttsEnabled: (ds.ttsEnabled || "true").toLowerCase() !== "false",

    // UI
    avatarScale: Number(ds.avatarScale || 1.8),
    zIndex: Number(ds.zIndex || 2147483000),
  };

  const sessionId = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const root = document.createElement("div");
  root.className = "gea-widget-root";
  root.setAttribute("data-gea-widget", "1");
  root.style.position = "fixed";
  root.style.bottom = "16px";
  root.style[cfg.position] = "16px";
  root.style.zIndex = String(cfg.zIndex);

  root.innerHTML = `
    <style>
      .gea-wrap { font-family: "Segoe UI", Roboto, Arial, sans-serif; color:#111827; user-select:none; }
      .gea-avatar-zone { position:relative; transition:opacity .2s ease, transform .2s ease; }
      .gea-avatar-zone.hidden { opacity:0; transform:translateY(8px); pointer-events:none; }
      .gea-launcher {
        border:0; background:transparent; padding:0; cursor:pointer; display:block;
        width:${Math.round(140 * cfg.avatarScale)}px; height:${Math.round(210 * cfg.avatarScale)}px;
        filter: drop-shadow(0 8px 20px rgba(0,0,0,.25));
      }
      .gea-launcher img { width:100%; height:100%; object-fit:contain; object-position:bottom right; display:block; }
      .gea-hint {
        position:absolute; max-width:220px; min-width:140px;
        ${cfg.position === "right" ? "right" : "left"}:${Math.round(90 * cfg.avatarScale)}px;
        bottom:${Math.round(120 * cfg.avatarScale)}px;
        background:#e8d34f; color:#fff; font-weight:700; line-height:1.1;
        border-radius:14px; padding:10px 12px; box-shadow:0 10px 30px rgba(0,0,0,.18);
        cursor:pointer;
      }
      .gea-hint::after{
        content:""; position:absolute; ${cfg.position === "right" ? "right:-10px; border-left:12px solid #e8d34f;" : "left:-10px; border-right:12px solid #e8d34f;"}
        bottom:14px; width:0; height:0; border-top:8px solid transparent; border-bottom:8px solid transparent;
      }

      .gea-panel{
        position:absolute;
        ${cfg.position === "right" ? "right:0" : "left:0"};
        bottom:0;
        width:min(390px, calc(100vw - 20px)); height:min(640px, calc(100vh - 90px));
        background:#fff; border:1px solid #e5e7eb; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.18);
        display:grid; grid-template-rows:auto auto 1fr auto auto;
        overflow:hidden; opacity:0; transform:translateY(14px) scale(.98); pointer-events:none; transition:all .22s ease;
        width:min(390px, calc(100vw - 20px));
        height:min(640px, calc(100vh - 32px));
        max-height:calc(100vh - 32px);
      }
      .gea-panel.open { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }

      .gea-header{
        background:linear-gradient(135deg,#1d4ed8,#2563eb); color:#fff;
        padding:12px 14px; display:flex; align-items:center; justify-content:space-between;
      }
      .gea-title{ display:flex; align-items:center; gap:10px; font-weight:700; }
      .gea-dot{ width:10px; height:10px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 4px rgba(255,255,255,.2); }
      .gea-close{ border:0; width:34px; height:34px; border-radius:10px; cursor:pointer; color:#fff; background:rgba(255,255,255,.18); }

      .gea-tabs{ display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:10px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
      .gea-tab{ border:1px solid #e5e7eb; background:#fff; color:#111827; border-radius:10px; padding:8px 10px; font-weight:600; cursor:pointer; }
      .gea-tab.active{ border-color:#1d4ed8; color:#1d4ed8; background:#eff6ff; }

      .gea-messages{ padding:12px; overflow-y:auto; background:#fff; }
      .gea-msg{ display:flex; margin:8px 0; }
      .gea-msg.user{ justify-content:flex-end; }
      .gea-msg.assistant{ justify-content:flex-start; }
      .gea-bubble{
        max-width:84%; padding:10px 12px; border-radius:12px; line-height:1.35; font-size:14px;
        white-space:pre-wrap; word-break:break-word; border:1px solid transparent;
      }
      .gea-msg.user .gea-bubble{ background:#1d4ed8; color:#fff; border-bottom-right-radius:4px; }
      .gea-msg.assistant .gea-bubble{ background:#f3f4f6; color:#111827; border-color:#e5e7eb; border-bottom-left-radius:4px; }

      .gea-typing{ display:none; align-items:center; gap:8px; color:#6b7280; font-size:13px; padding:0 12px 10px; }
      .gea-typing.show{ display:flex; }
      .gea-dots{ display:flex; gap:4px; }
      .gea-dots span{ width:6px; height:6px; border-radius:50%; background:#9ca3af; animation:geaBlink 1s infinite; }
      .gea-dots span:nth-child(2){ animation-delay:.2s; } .gea-dots span:nth-child(3){ animation-delay:.4s; }
      @keyframes geaBlink{ 0%,80%,100%{opacity:.25; transform:translateY(0)} 40%{opacity:1; transform:translateY(-2px)} }

      .gea-controls{ border-top:1px solid #e5e7eb; background:#fff; padding:10px; }
      .gea-text-controls{ display:grid; grid-template-columns:1fr auto; gap:8px; }
      .gea-input{ border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; }
      .gea-send{ border:0; border-radius:10px; background:#1d4ed8; color:#fff; padding:0 14px; font-weight:700; cursor:pointer; }

      .gea-voice-controls{ display:none; gap:8px; align-items:center; justify-content:space-between; }
      .gea-voice-controls.active{ display:flex; }
      .gea-voice-status{ color:#6b7280; font-size:13px; min-height:18px; flex:1; padding-right:8px; }
      .gea-mic{ border:1px solid #e5e7eb; background:#fff; color:#111827; padding:10px 12px; border-radius:10px; cursor:pointer; min-width:116px; font-weight:700; }
      .gea-mic.listening{ border-color:#ef4444; color:#ef4444; animation:geaPulse 1s infinite; }
      @keyframes geaPulse{ 0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)} 70%{box-shadow:0 0 0 14px rgba(239,68,68,0)} 100%{box-shadow:0 0 0 0 rgba(239,68,68,0)} }

      .gea-settings{ border-top:1px solid #e5e7eb; padding:8px 10px; display:flex; align-items:center; gap:8px; color:#6b7280; font-size:12px; background:#f8fafc; }

      .gea-speaking .gea-launcher{ animation:geaTalk .55s infinite ease-in-out; }
      @keyframes geaTalk{ 0%,100%{ transform:translateY(0);} 50%{ transform:translateY(-5px);} }

      @media (max-width:520px){
        .gea-panel{ width:calc(100vw - 20px); height:calc(100vh - 88px); }
      }
    </style>

    <div class="gea-wrap">
      <div class="gea-panel" aria-hidden="true">
        <div class="gea-header">
          <div class="gea-title"><span class="gea-dot"></span><span>${esc(cfg.title)}</span></div>
          <button class="gea-close" type="button" aria-label="Cerrar">✕</button>
        </div>

        <div class="gea-tabs">
          <button class="gea-tab gea-tab-text active" type="button">Texto</button>
          <button class="gea-tab gea-tab-voice" type="button">Voz</button>
        </div>

        <div class="gea-messages"></div>

        <div class="gea-typing">
          <div class="gea-dots"><span></span><span></span><span></span></div>
          <span>Escribiendo…</span>
        </div>

        <div class="gea-controls">
          <div class="gea-text-controls">
            <input class="gea-input" type="text" placeholder="Escribe tu mensaje…" />
            <button class="gea-send" type="button">Enviar</button>
          </div>

          <div class="gea-voice-controls">
            <div class="gea-voice-status">Pulsa “Hablar” para dictar tu mensaje.</div>
            <button class="gea-mic" type="button">🎤 Hablar</button>
          </div>
        </div>

        <div class="gea-settings">
          <label><input class="gea-tts-toggle" type="checkbox" ${cfg.ttsEnabled ? "checked" : ""} /> Responder con voz</label>
        </div>
      </div>

      <div class="gea-avatar-zone">
        <button class="gea-launcher" type="button" aria-label="Abrir chat">
          <img src="${esc(cfg.avatar)}" alt="avatar asistente" />
        </button>
        <div class="gea-hint">${esc(cfg.hint)}</div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // refs
  const panel = root.querySelector(".gea-panel");
  const avatarZone = root.querySelector(".gea-avatar-zone");
  const launcher = root.querySelector(".gea-launcher");
  const hint = root.querySelector(".gea-hint");
  const closeBtn = root.querySelector(".gea-close");

  const tabText = root.querySelector(".gea-tab-text");
  const tabVoice = root.querySelector(".gea-tab-voice");
  const messages = root.querySelector(".gea-messages");
  const typing = root.querySelector(".gea-typing");

  const textControls = root.querySelector(".gea-text-controls");
  const voiceControls = root.querySelector(".gea-voice-controls");
  const input = root.querySelector(".gea-input");
  const sendBtn = root.querySelector(".gea-send");

  const micBtn = root.querySelector(".gea-mic");
  const voiceStatus = root.querySelector(".gea-voice-status");
  const ttsToggle = root.querySelector(".gea-tts-toggle");

  let mode = "text";
  let isListening = false;
  let externalAudio = null;
  let currentBlobUrl = null;

  function stopTTS() {
    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch {}
    try {
      if (externalAudio) {
        externalAudio.pause();
        externalAudio.currentTime = 0;
      }
    } catch {}
    externalAudio = null;
    if (currentBlobUrl) {
      try { URL.revokeObjectURL(currentBlobUrl); } catch {}
      currentBlobUrl = null;
    }
    root.classList.remove("gea-speaking");
  }

  function openChat() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    avatarZone.classList.add("hidden");   // oculta avatar al abrir chat
    hint.style.display = "none";
    if (mode === "text") input.focus();
  }

  function closeChat() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    avatarZone.classList.remove("hidden"); // muestra avatar al cerrar chat
    if (!messages.children.length) hint.style.display = "block";
  }

  function setMode(next) {
    mode = next;
    const isText = next === "text";
    tabText.classList.toggle("active", isText);
    tabVoice.classList.toggle("active", !isText);
    textControls.style.display = isText ? "grid" : "none";
    voiceControls.classList.toggle("active", !isText);
    if (isText) input.focus();
  }

  function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = `gea-msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "gea-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function setTyping(show) {
    typing.classList.toggle("show", show);
    if (show) messages.scrollTop = messages.scrollHeight;
  }

  function aiUrlWithProvider() {
    const u = new URL(cfg.aiEndpoint, window.location.href);
    if (cfg.aiProvider) u.searchParams.set("provider", cfg.aiProvider);
    return u.toString();
  }

  async function askAI(message, source = "text") {
    if (!cfg.aiEndpoint) return "No configuraste data-ai-endpoint.";

    const headers = { "Content-Type": "application/json" };
    if (cfg.aiKey) headers["Authorization"] = `Bearer ${cfg.aiKey}`;

    let body;
    if (cfg.aiPayload === "object") {
      body = JSON.stringify({
        message: (message || "").trim(),
        sessionId,
        source,
        lang: cfg.lang,
        provider: cfg.aiProvider,
      });
    } else {
      // Compatible con agente.ashx que recibe string JSON ("hola")
      body = JSON.stringify((message || "").trim());
    }

    const res = await fetch(aiUrlWithProvider(), {
      method: "POST",
      headers,
      body,
      credentials: "include",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`IA ${res.status}: ${errText || "sin detalle"}`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      return data.output || data.reply || data.response || data.message || "Sin respuesta del servicio IA.";
    }

    const txt = await res.text().catch(() => "");
    try {
      const data = JSON.parse(txt);
      return data.output || data.reply || data.response || data.message || txt || "Sin respuesta del servicio IA.";
    } catch {
      return txt || "Sin respuesta del servicio IA.";
    }
  }

  function chooseSpanishVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return (
      voices.find((v) => /^es(-|_)?MX$/i.test(v.lang)) ||
      voices.find((v) => /^es/i.test(v.lang)) ||
      null
    );
  }

  async function speak(text) {
    if (!text) return;
    stopTTS();

    if (cfg.voiceProvider === "browser") {
      if (!("speechSynthesis" in window)) return;
      const utter = new SpeechSynthesisUtterance(text);
      const voice = chooseSpanishVoice();
      if (voice) utter.voice = voice;
      utter.lang = voice?.lang || cfg.lang || "es-MX";
      utter.rate = 1;
      utter.pitch = 1;

      root.classList.add("gea-speaking");
      utter.onend = () => root.classList.remove("gea-speaking");
      utter.onerror = () => root.classList.remove("gea-speaking");
      window.speechSynthesis.speak(utter);
      return;
    }

    // azure / elevenlabs (vía backend proxy tts.ashx)
    const headers = { "Content-Type": "application/json" };
    if (cfg.ttsKey) headers["X-Api-Key"] = cfg.ttsKey;

    const res = await fetch(new URL(cfg.ttsEndpoint, window.location.href).toString(), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        text,
        provider: cfg.voiceProvider,     // azure | elevenlabs
        lang: cfg.lang,
        azureVoice: cfg.azureVoice,
        elevenVoiceId: cfg.elevenVoiceId
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`TTS ${res.status}: ${t || "sin detalle"}`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let src = null;

    if (ct.startsWith("audio/")) {
      const blob = await res.blob();
      currentBlobUrl = URL.createObjectURL(blob);
      src = currentBlobUrl;
    } else {
      const data = await res.json().catch(() => ({}));
      if (data.audioUrl) src = data.audioUrl;
      else if (data.audioBase64) src = `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`;
    }

    if (!src) return;

    externalAudio = new Audio(src);
    root.classList.add("gea-speaking");
    externalAudio.onended = () => {
      root.classList.remove("gea-speaking");
      if (currentBlobUrl) {
        try { URL.revokeObjectURL(currentBlobUrl); } catch {}
        currentBlobUrl = null;
      }
    };
    externalAudio.onerror = () => {
      root.classList.remove("gea-speaking");
    };
    await externalAudio.play();
  }

  async function handleSend(raw, source = "text") {
    const text = (raw || "").trim();
    if (!text) return;

    addMessage("user", text);
    setTyping(true);

    try {
      const reply = await askAI(text, source);
      setTyping(false);
      addMessage("assistant", reply);

      if (ttsToggle.checked || source === "voice") {
        await speak(reply);
      }
    } catch (e) {
      setTyping(false);
      addMessage("assistant", "Ocurrió un error al consultar la IA/TTS.");
      console.error("[GEA-CHAT]", e);
    }
  }

  // Eventos UI
  launcher.addEventListener("click", openChat);
  hint.addEventListener("click", openChat);
  closeBtn.addEventListener("click", closeChat);

  tabText.addEventListener("click", () => setMode("text"));
  tabVoice.addEventListener("click", () => setMode("voice"));

  sendBtn.addEventListener("click", () => {
    handleSend(input.value, "text");
    input.value = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // Reconocimiento de voz (entrada)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;

  if (SR) {
    recognition = new SR();
    recognition.lang = cfg.lang || "es-MX";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = "";

    recognition.onstart = () => {
      isListening = true;
      stopTTS(); // barge-in
      micBtn.classList.add("listening");
      micBtn.textContent = "⏹ Detener";
      voiceStatus.textContent = "Escuchando…";
      finalText = "";
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      voiceStatus.textContent = interim
        ? `Transcribiendo: "${interim}"`
        : (finalText ? `Detectado: "${finalText.trim()}"` : "Escuchando…");
    };

    recognition.onerror = (event) => {
      voiceStatus.textContent = "No se pudo usar el micrófono.";
      console.warn("[GEA-CHAT] SpeechRecognition:", event.error);
    };

    recognition.onend = async () => {
      isListening = false;
      micBtn.classList.remove("listening");
      micBtn.textContent = "🎤 Hablar";

      const text = finalText.trim();
      if (text) {
        voiceStatus.textContent = `Enviado: "${text}"`;
        await handleSend(text, "voice");
      } else {
        voiceStatus.textContent = "No detecté voz. Intenta de nuevo.";
      }
    };

    micBtn.addEventListener("click", () => {
      if (!isListening) recognition.start();
      else recognition.stop();
    });
  } else {
    micBtn.disabled = true;
    voiceStatus.textContent = "Tu navegador no soporta reconocimiento de voz.";
  }

  // mensaje inicial
  addMessage("assistant", cfg.welcome);

  // API opcional por si quieres abrir/cerrar desde código
  window.GeaChatWidget = window.GeaChatWidget || {};
  window.GeaChatWidget.open = openChat;
  window.GeaChatWidget.close = closeChat;
  window.GeaChatWidget.send = (msg) => handleSend(msg, "text");
})();
