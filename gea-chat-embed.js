(() => {
  // Encuentra ESTE script y lee atributos data-*
  const me = document.currentScript || (() => {
    const scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  const base = (me.getAttribute("data-base") || "").replace(/\/$/, "");
  const title = me.getAttribute("data-title") || "Asistente";
  const position = (me.getAttribute("data-position") || "right").toLowerCase(); // right | left
  const avatar = me.getAttribute("data-avatar") || "";
  const zIndex = parseInt(me.getAttribute("data-z") || "999999", 10);

  if (!base) {
    console.error("[GEA-CHAT] Falta data-base");
    return;
  }

  // Evita doble carga
  if (window.__GEA_CHAT_WIDGET_LOADED__) return;
  window.__GEA_CHAT_WIDGET_LOADED__ = true;

  // CSS
  const style = document.createElement("style");
  style.textContent = `
    .gea-chat-btn{
      position:fixed;
      bottom:22px;
      ${position === "left" ? "left:22px;" : "right:22px;"}
      --gea-chat-btn-size: clamp(64px, 7vw, 88px);
      width:var(--gea-chat-btn-size);
      height:var(--gea-chat-btn-size);
      border-radius:999px;
      border:none;
      cursor:pointer;
      box-shadow:0 10px 25px rgba(0,0,0,.25);
      background:#0b5cff;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:${zIndex};
      overflow:hidden;
      animation: gea-chat-bob 2.4s ease-in-out infinite;
    }
    .gea-chat-btn img{
      width:100%;
      height:100%;
      object-fit:cover;
    }
    .gea-chat-btn .gea-chat-icon{
      font-size:calc(var(--gea-chat-btn-size) * 0.45);
      color:#fff;
      font-family:Arial, sans-serif;
    }
    .gea-chat-greeting{
      position:fixed;
      bottom: calc(22px + (var(--gea-chat-btn-size) / 2) - 18px);
      ${position === "left" ? "left:calc(22px + var(--gea-chat-btn-size) + 10px);" : "right:calc(22px + var(--gea-chat-btn-size) + 10px);"}
      background:#ffffff;
      color:#1a1a1a;
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
      background:#ffffff;
      transform:translateY(-50%) rotate(45deg);
      box-shadow:0 12px 30px rgba(0,0,0,.12);
    }

    .gea-chat-frame{
      position:fixed;
      bottom:95px;
      ${position === "left" ? "left:22px;" : "right:22px;"}
      width:360px;
      max-width: calc(100vw - 44px);
      height:520px;
      max-height: calc(100vh - 140px);
      border:none;
      border-radius:18px;
      box-shadow:0 18px 60px rgba(0,0,0,.35);
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
        --gea-chat-btn-size: clamp(60px, 18vw, 80px);
      }
      .gea-chat-greeting{
        ${position === "left" ? "left:calc(15px + var(--gea-chat-btn-size) + 10px);" : "right:calc(15px + var(--gea-chat-btn-size) + 10px);"}
        bottom: calc(22px + (var(--gea-chat-btn-size) / 2) - 18px);
        font-size:13px;
      }
    }
    @keyframes gea-chat-bob{
      0%, 100%{ transform:translateY(0); box-shadow:0 10px 25px rgba(0,0,0,.25); }
      50%{ transform:translateY(-6px); box-shadow:0 16px 30px rgba(0,0,0,.2); }
    }
    @keyframes gea-chat-greeting{
      0%{ opacity:0; transform:translateY(6px); }
      15%{ opacity:1; transform:translateY(0); }
      70%{ opacity:1; transform:translateY(0); }
      100%{ opacity:0; transform:translateY(6px); }
    }
  `;
  document.head.appendChild(style);

  // Botón flotante
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

  // Iframe del chat (UI completa)
  const frame = document.createElement("iframe");
  frame.className = "gea-chat-frame";
  frame.title = title;

  // Puedes pasar el origen del sitio donde se incrusta + ruta actual
  const hostSite = encodeURIComponent(location.origin);
  const pageUrl = encodeURIComponent(location.href);

  // Página del widget dentro de TU dominio
  frame.src = `${base}/avatar/widget.html?site=${hostSite}&page=${pageUrl}&title=${encodeURIComponent(title)}`;

  function toggle(open) {
    const shouldOpen = typeof open === "boolean" ? open : frame.style.display === "none";
    frame.style.display = shouldOpen ? "block" : "none";

    // Opcional: avisar al iframe para enfocar input
    if (shouldOpen) {
      frame.contentWindow?.postMessage({ type: "GEA_CHAT_OPEN" }, base);
    }
  }

  btn.addEventListener("click", () => toggle());

  document.body.appendChild(btn);
  document.body.appendChild(frame);

  const greeting = document.createElement("div");
  greeting.className = "gea-chat-greeting";
  greeting.textContent = "¡Hola! ¿Necesitas ayuda?";
  document.body.appendChild(greeting);

  const dismissGreeting = () => {
    greeting.style.opacity = "0";
    greeting.style.transform = "translateY(6px)";
  };

  btn.addEventListener("click", dismissGreeting);

  // Cerrar con ESC (opcional)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggle(false);
  });

})();
