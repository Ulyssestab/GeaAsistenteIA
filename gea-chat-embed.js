(() => {
  const me = document.currentScript || (() => {
    const scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  const base = (me.getAttribute("data-base") || "").replace(/\/$/, "");
  const title = me.getAttribute("data-title") || "Asistente Gobierno";
  const position = (me.getAttribute("data-position") || "right").toLowerCase();
  const avatar = me.getAttribute("data-avatar") || "";
  const avatarTalk = me.getAttribute("data-avatar-talking") || "";
  const zIndex = parseInt(me.getAttribute("data-z") || "999999", 10);
  const tts = (me.getAttribute("data-tts") || "browser").toLowerCase();
  const greetingText = me.getAttribute("data-greeting") || "HOLA SOY ANIA, EN QUE PUEDO AYUDARTE";

  if (!base) {
    console.error("[GEA-CHAT] Falta data-base");
    return;
  }

  if (window.__GEA_CHAT_WIDGET_LOADED__) return;
  window.__GEA_CHAT_WIDGET_LOADED__ = true;

  const style = document.createElement("style");
  style.textContent = `
    .gea-chat-btn{
      position:fixed;
      bottom:24px;
      ${position === "left" ? "left:22px;" : "right:22px;"}
      width:88px;
      height:88px;
      border-radius:0;
      border:none;
      cursor:pointer;
      background:transparent;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:${zIndex};
      overflow:visible;
      transition:transform .2s ease;
      animation: gea-chat-float 3s ease-in-out infinite;
    }
    .gea-chat-btn:hover{
      transform:translateY(-6px);
    }
    .gea-chat-btn img{
      width:100%;
      height:100%;
      object-fit:contain;
      background:transparent;
      border:0;
      border-radius:0;
      box-shadow:none;
      filter:none;
    }
    .gea-chat-btn .gea-chat-icon{
      font-size:30px;
      color:#1e6bff;
      font-family:Arial, sans-serif;
    }
    .gea-chat-greeting{
      position:fixed;
      bottom: calc(24px + 39px - 18px);
      ${position === "left" ? "left:110px;" : "right:110px;"}
      background:#ffe064;
      color:#2b2b2b;
      padding:10px 14px;
      border-radius:999px;
      box-shadow:0 12px 30px rgba(0,0,0,.18);
      font-family:Arial, sans-serif;
      font-size:14px;
      z-index:${zIndex};
      opacity:0;
      transform:translateY(6px);
      animation: gea-chat-greeting 6s ease-out 0.4s forwards;
      pointer-events:none;
      white-space:nowrap;
    }
    .gea-chat-greeting::after{
      content:"";
      position:absolute;
      top:50%;
      ${position === "left" ? "left:-6px;" : "right:-6px;"}
      width:10px;
      height:10px;
      background:#ffe064;
      transform:translateY(-50%) rotate(45deg);
      box-shadow:0 12px 30px rgba(0,0,0,.12);
    }

    .gea-chat-frame{
      position:fixed;
      bottom:115px;
      ${position === "left" ? "left:22px;" : "right:22px;"}
      width:360px;
      max-width: calc(100vw - 44px);
      height:560px;
      max-height: calc(100vh - 160px);
      border:none;
      border-radius:22px;
      box-shadow:0 18px 60px rgba(0,0,0,.3);
      z-index:${zIndex};
      overflow:hidden;
      display:none;
      background:#fff;
    }

    @media (max-width: 420px){
      .gea-chat-frame{
        width: calc(100vw - 30px);
        ${position === "left" ? "left:15px;" : "right:15px;"}
        height: 70vh;
      }
      .gea-chat-btn{
        ${position === "left" ? "left:15px;" : "right:15px;"}
        width:72px;
        height:72px;
      }
      .gea-chat-greeting{
        ${position === "left" ? "left:100px;" : "right:100px;"}
        bottom: calc(24px + 35px - 18px);
        font-size:13px;
      }
    }
    @keyframes gea-chat-greeting{
      0%{ opacity:0; transform:translateY(6px); }
      15%{ opacity:1; transform:translateY(0); }
      70%{ opacity:1; transform:translateY(0); }
      100%{ opacity:0; transform:translateY(6px); }
    }
    @keyframes gea-chat-float{
      0%{ transform:translateY(0); }
      50%{ transform:translateY(-6px); }
      100%{ transform:translateY(0); }
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "gea-chat-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Abrir chat");

  if (avatar) {
    const img = document.createElement("img");
    img.src = avatar;
    img.alt = "Avatar";
    btn.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.className = "gea-chat-icon";
    span.textContent = "💬";
    btn.appendChild(span);
  }

  const frame = document.createElement("iframe");
  frame.className = "gea-chat-frame";
  frame.title = title;

  const hostSite = encodeURIComponent(location.origin);
  const pageUrl = encodeURIComponent(location.href);
  const avatarParam = encodeURIComponent(avatar || "");
  const avatarTalkParam = encodeURIComponent(avatarTalk || "");

  frame.src = `${base}/GeaAsistenteHub/widget.html?site=${hostSite}&page=${pageUrl}&title=${encodeURIComponent(title)}&tts=${encodeURIComponent(tts)}&avatar=${avatarParam}&avatarTalk=${avatarTalkParam}`;

  function toggle(open) {
    const shouldOpen = typeof open === "boolean" ? open : frame.style.display === "none";
    frame.style.display = shouldOpen ? "block" : "none";

    if (shouldOpen) {
      frame.contentWindow?.postMessage({ type: "GEA_CHAT_OPEN" }, base);
    }
  }

  btn.addEventListener("click", () => toggle());

  document.body.appendChild(btn);
  document.body.appendChild(frame);

  const greeting = document.createElement("div");
  greeting.className = "gea-chat-greeting";
  greeting.textContent = greetingText;
  document.body.appendChild(greeting);

  const dismissGreeting = () => {
    greeting.style.opacity = "0";
    greeting.style.transform = "translateY(6px)";
  };

  btn.addEventListener("click", dismissGreeting);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggle(false);
  });

  window.addEventListener("message", (e) => {
    if (e.data?.type === "GEA_CHAT_CLOSE") {
      toggle(false);
    }
  });

})();
