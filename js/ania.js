let socket = null;

let wsReady = false;
let conversationReady = false;
let isProcessing = false;

let reconnecting = false;
let reconnectAttempts = 0;

let jwtToken = null;

let audioPlayer = new Audio(); 
let isSpeaking = false; 

let initialized = false;
let isConnecting = false;
let intentionalClose = false;

let lastResponseId = null;

let tokenRefreshTimeout = null;
let responseTimeout = null;
let initializationTimeout = null;

let conversationId = localStorage.getItem("conversationId");
let conversationHistory = JSON.parse(localStorage.getItem("conversationHistory") || "[]");

const WS_URL = "eservicios2.aguascalientes.gob.mx/AgentesAI/api";

// Referencias del DOM
const chatWidget = document.getElementById("chatWidget");
const chatLauncher = document.getElementById("chatLauncher");
const chatLauncherClose = document.getElementById("chatLauncherClose");
const chatClose = document.getElementById("chatClose");
const chatDockClose = document.getElementById("chatDockClose");
const termsDialog = document.getElementById("termsDialog");
const termsAccept = document.getElementById("termsAccept");
const termsCancel = document.getElementById("termsCancel");
const sideAvatar = document.getElementById("sideAvatar");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

// Referencias para los botones de audio
const btnToggleVoice = document.getElementById("btnToggleVoice");
const btnStopVoice = document.getElementById("btnStopVoice");

// Variable de estado para saber si la voz esta permitida
let voiceEnabled = true;

// ==========================================
// UTILIDADES DE TEXTO Y VOZ 
// ==========================================

function normalizarTexto(texto) {
    return (texto || "")
        .replace(/([.,:;!?"])([A-ZÁÉÍÓÚÑ¿¡])/g, '$1 $2')
        .replace(/([a-záéíóúñ])([¿¡])/g, '$1 $2')
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

function prepararNumerosParaEleven(texto) {
    if (!texto) return "";

    return texto
        // --- 0. NÚMEROS ROMANOS EN UBICACIONES ---
        .replace(/\b([A-Za-zñÑáéíóúÁÉÍÓÚ]+)\s+I\b/g, "$1 uno")
        .replace(/\b([A-Za-zñÑáéíóúÁÉÍÓÚ]+)\s+II\b/g, "$1 dos")
        .replace(/\b([A-Za-zñÑáéíóúÁÉÍÓÚ]+)\s+III\b/g, "$1 tres")

        // --- 1. ABREVIATURAS COMUNES DE DIRECCIÓN ---
        .replace(/\bAv\./gi, "Avenida")
        .replace(/\bOte\b\.?/gi, "Oriente")
        .replace(/\bNte\b\.?/gi, "Norte")
        .replace(/\bBlvd\b\.?/gi, "Bulevar")
        .replace(/\bCol\b\.?/gi, "Colonia") 
        .replace(/\bNo\.\s*(\d+)/gi, "número $1")
        .replace(/\bN[°º]\s*(\d+)/gi, "número $1") 

        // --- 2. HORARIOS Y PAUSAS INTELIGENTES ---
        .replace(/\b(\d{1,2}):00\s*a\s*(\d{1,2}):00(?:\s*horas|\s*hrs\.?)?\b/gi, "de las $1 a las $2 horas")
        .replace(/\b(\d{1,2}):00(?:\s*horas|\s*hrs\.?)?\b/g, "$1 horas") 
        .replace(/horas\s+D[ií]as/gi, "horas. Días")

        // --- 3. MONTOS Y MONEDAS ---
        // Primero atrapa los que sí tienen decimales (ej. $435.50 o $435.00)
        .replace(/\$\s*(\d+(?:,\d{3})*)\.(\d{2})\s*(?:mxn|m\.n\.)?/gi, (match, enteros, centavos) => {
            if (centavos === "00") return `${enteros} pesos`;
            return `${enteros} pesos con ${centavos} centavos`;
        })
        // Luego atrapa los números enteros sin decimales (ej. $435 o $585)
        .replace(/\$\s*(\d+(?:,\d{3})*)\s*(?:mxn|m\.n\.)?/gi, "$1 pesos")
        // Limpieza extra por si quedó un mxn suelto
        .replace(/\bmxn\b/gi, "pesos")

        // --- 4. CÓDIGOS POSTALES ---
        .replace(/\b(C\.?\s*P\.?|Código\s+Postal)\s*(\d{5})\b/gi, (_, prefijo, cp) => `Código Postal ${cp.split('').join(', ')}`)

        // --- 5. NÚMEROS DE TELÉFONO ---
        .replace(/\b(?:\d[\s\-\.]*){9}\d\b/g, (match) => {
            const digitsOnly = match.replace(/[\s\-\.]/g, '');
            return digitsOnly.split('').join(', ');
        })

        // --- 6. DIRECCIONES CON NUMERAL (#) ---
        .replace(/#\s*(\d+[A-Za-z\-]*)/g, (_, num) => `número ${num}`)

        // --- 7. EXTENSIONES DE TELÉFONO ---
        .replace(/\b(\d{4})\b/g, (match) => {
            const num = parseInt(match);
            if (num >= 1900 && num <= 2050) return match; 
            return match.split('').join(', ');
        })

        // --- 8. CLAVES LARGAS O FOLIOS RESTANTES (6+ dígitos) ---
        .replace(/\b(\d{6,})\b/g, (_, num) => num.split('').join(', '));


}

function renderizarRespuesta(texto) {
    if (!texto) return "";
    
    // Mejoras de espaciado y formato antes de pasarlo a Marked
    let textoLimpio = texto.replace(/([^\s])\s*(Si quieres|¿Te gustaría|¿Hay algo|¿En qué puedo|¡Pregúntame)/gi, '$1\n\n$2');
    textoLimpio = textoLimpio.replace(/(?<!#)#\s*(\d+)/g, 'No. $1');
    textoLimpio = textoLimpio.replace(/([^\n])(#{1,6}\s)/g, '$1\n\n$2');
    textoLimpio = textoLimpio.replace(/([a-zA-ZáéíóúñÁÉÍÓÚÑ0-9\)])\s*-\s+(\**)\s*([A-ZÁÉÍÓÚÑ])/g, '$1\n- $2$3');
    textoLimpio = textoLimpio.replace(/:\s*-/g, ':\n- ');
    textoLimpio = textoLimpio.replace(/\.\s*-/g, '.\n- ');

    // Convertir a HTML usando Marked.js y sanitizar con DOMPurify
    let html = marked.parse(textoLimpio);
    return DOMPurify.sanitize(html);
}

function htmlATextoParaTTS(html) {
    if (!html) return "";

    let tempText = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/ul>/gi, "\n")
        .replace(/<\/ol>/gi, "\n");

    const temp = document.createElement("div");
    temp.innerHTML = tempText;

    let texto = temp.textContent || temp.innerText || "";

    texto = texto
        .replace(/\bhttps?:\/\/[^\s]+/gi, " ")
        .replace(/\bwww\.[^\s]+/gi, " ")
        .replace(/enlace del trámite[:]?/gi, "")
        .replace(/enlace[:]?/gi, "");

    texto = normalizarTexto(texto);
    texto = prepararNumerosParaEleven(texto);

    return texto;
}

function esDespedida(texto) {
    if (!texto) return false;

    const temp = document.createElement("div");
    temp.innerHTML = texto;
    const limpio = (temp.textContent || temp.innerText || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const patronesDespedida = [
        "hasta luego", "hasta pronto", "adios", "que tengas un gran dia", 
        "que tengas un excelente dia", "que tenga un gran dia", 
        "que tenga un excelente dia", "fue un gusto ayudarte", 
        "si necesitas ayuda en el futuro aqui estare", "estare aqui", 
        "gracias por comunicarte", "gracias por contactarnos", 
        "que tengas un buen dia", "que tenga un buen dia", 
        "hasta la proxima", "nos vemos"
    ];

    return patronesDespedida.some(p => limpio.includes(p));
}

// ==========================================
// CORE DEL CHAT Y WEBSOCKETS
// ==========================================

function hasAcceptedTerms() {
    return localStorage.getItem("termsAccepted") === "true";
}

async function init() {
    if (initialized) return;
    initialized = true;

    try {
        //restoreConversation();
        await getToken();
        await connectSocket();
    } catch (err) {
        initialized = false;
        console.error("❌ Init error:", err);
        updateStatus("Error inicializando");
    }
}

async function getToken() {
    try {
        const response = await fetch(`https://${WS_URL}/ChatProxy/get-chat-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            agente: "tramites-cesarulises-prompt_elevenlabs"
          })
        });

        if (!response.ok) {
            if (response.status === 429) throw new Error("Demasiadas solicitudes");
            if (response.status === 403) throw new Error("Acceso denegado");
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        jwtToken = data.token;
        scheduleTokenRefresh();
        return jwtToken;
    } catch (err) {
        console.error("❌ Token error:", err);
        updateStatus("Error obteniendo token");
        throw err;
    }
}

function scheduleTokenRefresh() {
    stopTokenRefresh();
    tokenRefreshTimeout = setTimeout(async () => {
        try {
            console.log("🔄 Renovando token");
            intentionalClose = true;
            if (socket) socket.close(1000);
            await getToken();
            await connectSocket();
        } catch (err) {
            console.error("❌ Refresh error:", err);
            initialized = false;
            updateStatus("Error renovando sesión");
            setTimeout(() => init(), 5000);
        }
    }, 55 * 60 * 1000);
}

function stopTokenRefresh() {
    if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = null;
    }
}

async function connectSocket() {
    if (isConnecting || !jwtToken) return;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    isConnecting = true;
    wsReady = false;
    conversationReady = false;
    updateSendButton();
    updateStatus("Conectando...");

    try {
        let url = `wss://${WS_URL}/chat/agente-dinamico?t=${encodeURIComponent(jwtToken)}`;
        if (conversationId) url += `&c=${conversationId}`;

        socket = new WebSocket(url);

        initializationTimeout = setTimeout(() => {
            if (!conversationReady) {
                console.warn("⚠️ Init timeout");
                wsReady = false;
                isConnecting = false;
                if (socket) {
                    intentionalClose = false;
                    socket.close();
                }
                setTimeout(() => autoReconnect(), 1000);
            }
        }, 15000);

        socket.onopen = () => {
            console.log("✅ WS conectado");
            wsReady = true;
            reconnecting = false;
            reconnectAttempts = 0;
            isConnecting = false;
            updateStatus("Inicializando conversación...");
            updateSendButton();
        };

        socket.onmessage = handleSocketMessage;

        socket.onerror = (err) => console.error("❌ WS error:", err);

        socket.onclose = async (event) => {
            console.warn("🔌 WS cerrado:", event.code);
            clearInitializationTimeout();
            clearResponseTimeout();
            
            wsReady = false;
            conversationReady = false;
            socket = null;
            isConnecting = false;
            updateSendButton();

            if (intentionalClose) {
                intentionalClose = false;
                return;
            }

            removeLoadingIndicator();
            isProcessing = false;
            updateSendButton();

            if (document.visibilityState === "hidden" || reconnecting) return;
            setTimeout(() => autoReconnect(), 1500);
        };

    } catch (err) {
        console.error("❌ Connect error:", err);
        wsReady = false;
        conversationReady = false;
        isConnecting = false;
        updateSendButton();
        updateStatus("Error conectando");
    }
}

function handleSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);

        if (data.type === "ping") {
            const eventId = data.ping_event?.event_id;
            const pingMs = data.ping_event?.ping_ms || 0;
            setTimeout(() => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "pong", event_id: eventId }));
                }
            }, pingMs);
            return;
        }

        if (data.type === "server_debug") return;

        if (data.type === "conversation_initiation_metadata") {
            clearInitializationTimeout();
            const serverConversationId = data.conversation_initiation_metadata_event?.conversation_id;

            if (serverConversationId) {
                if (!conversationId || conversationId !== serverConversationId) {
                    conversationId = serverConversationId;
                    localStorage.setItem("conversationId", conversationId);
                }
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
                    conversationReady = true;
                    updateStatus("Conectado");
                    updateSendButton();
                }
            }
            return;
        }

        if (data.type === "agent_response") {
            clearResponseTimeout();
            removeLoadingIndicator();
            isProcessing = false;
            updateSendButton();

            const responseId = data.agent_response_event?.response_id;
            if (responseId && responseId === lastResponseId) return;
            lastResponseId = responseId;

            const response = data.agent_response_event?.agent_response || "Sin respuesta";

            const messageElement = addMessage(response, "bot");
            saveMessage(response, "bot");
            scrollToBottom();

            setTimeout(() => {
                if (messageElement) messageElement.focus();
            }, 100);

            reproducirVoz(response);
            return;
        }

        if (data.type === "error") {
            clearResponseTimeout();
            removeLoadingIndicator();
            isProcessing = false;
            updateSendButton();
            addMessage(data.message || "Error del servidor", "bot");
        }

    } catch (err) {
        console.error("❌ Parse error:", err);
    }
}

async function autoReconnect() {
    if (reconnecting) return;
    reconnecting = true;
    reconnectAttempts++;

    const delay = Math.min(reconnectAttempts * 3000, 15000);
    updateStatus("Reconectando...");
    
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
        if (!jwtToken) await getToken();
        await connectSocket();
    } catch (err) {
        console.error("❌ Reconnect error:", err);
    } finally {
        reconnecting = false;
    }
}

async function sendMessage() {
    // Interrupción de voz si Ania estaba hablando
    if (isSpeaking) {
        detenerAudio(); 
        updateAvatar("pensando");
    }

    const text = messageInput.value.trim();
    if (!text || isProcessing) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        updateStatus("Reconectando...");
        await autoReconnect();
        return;
    }

    if (!conversationReady) {
        updateStatus("Inicializando conversación...");
        return;
    }

    messageInput.value = "";
    messageInput.style.height = "auto";

    addMessage(text, "user");
    saveMessage(text, "user");
    addLoadingIndicator();
    updateAvatar("pensando");

    isProcessing = true;
    lastResponseId = null;
    updateSendButton();
    startResponseTimeout();

    try {
        socket.send(JSON.stringify({ type: "user_message", text }));
    } catch (err) {
        console.error("❌ Send error:", err);
        clearResponseTimeout();
        removeLoadingIndicator();
        isProcessing = false;
        updateSendButton();
        updateStatus("Error enviando mensaje");
    }
}

async function reproducirVoz(textoOriginal) {
    if (!textoOriginal || !jwtToken) return;
    
    // Si la voz esta desactivada, salimos de la funcion sin hacer la peticion
    if (!voiceEnabled) return; 

    const htmlRenderizado = renderizarRespuesta(textoOriginal);
    const textoLimpioTTS = htmlATextoParaTTS(htmlRenderizado);

    if (!textoLimpioTTS.trim()) return;

    try {
        updateAvatar("hablando");
        isSpeaking = true;
        btnStopVoice.style.display = "block"; // Mostramos el boton de detener

        const response = await fetch(`https://${WS_URL}/chat/agente-voz`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
                "Authorization": `Bearer ${jwtToken}` 
            },
            body: JSON.stringify(textoLimpioTTS)
        });

        if (!response.ok) throw new Error(`Error en TTS HTTP ${response.status}`);

        const blob = await response.blob();
        audioPlayer.src = URL.createObjectURL(blob);
        await audioPlayer.play();

        audioPlayer.onended = () => {
            isSpeaking = false;
            updateAvatar("saludando");
            btnStopVoice.style.display = "none"; // Ocultamos el boton al terminar
        };

    } catch (err) {
        console.error("❌ Error reproduciendo voz:", err);
        isSpeaking = false;
        updateAvatar("saludando");
        btnStopVoice.style.display = "none"; // Ocultamos el boton si hay error
    }
}

function startResponseTimeout() {
    clearResponseTimeout();
    responseTimeout = setTimeout(() => {
        removeLoadingIndicator();
        isProcessing = false;
        updateSendButton();
        addMessage("La respuesta tardó demasiado.", "bot");
    }, 45000);
}

function clearResponseTimeout() {
    if (responseTimeout) {
        clearTimeout(responseTimeout);
        responseTimeout = null;
    }
}

function clearInitializationTimeout() {
    if (initializationTimeout) {
        clearTimeout(initializationTimeout);
        initializationTimeout = null;
    }
}

function addMessage(text, sender, scroll = true) {
    const messages = document.getElementById("messages");
    const row = document.createElement("div");
    row.className = `message-row ${sender}`;

    const bubble = document.createElement("div");
    bubble.className = `message ${sender}`;
    bubble.setAttribute("tabindex", "-1");

    if (sender === "bot") {
        // Usamos la nueva función de renderizado y limpieza de logic.js
        bubble.innerHTML = renderizarRespuesta(text);
    } else {
        bubble.textContent = text;
    }

    row.appendChild(bubble);
    messages.appendChild(row);
    if (scroll) scrollToBottom();

    return bubble;
}

function addLoadingIndicator() {
    removeLoadingIndicator();
    const messages = document.getElementById("messages");
    const row = document.createElement("div");
    row.className = "message-row bot";
    row.id = "loadingIndicator";
    row.innerHTML = `
    <div class="message bot">
      <div class="loading">
        <div class="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;
    messages.appendChild(row);
    scrollToBottom();
}

function removeLoadingIndicator() {
    const loading = document.getElementById("loadingIndicator");
    if (loading) loading.remove();
}

function scrollToBottom() {
    const messages = document.getElementById("messages");
    messages.scrollTop = messages.scrollHeight;
}

function saveMessage(text, sender) {
    conversationHistory.push({ text, sender });
    if (conversationHistory.length > 50) {
        conversationHistory = conversationHistory.slice(-50);
    }
    localStorage.setItem("conversationHistory", JSON.stringify(conversationHistory));
}

function restoreConversation() {
    conversationHistory.forEach(msg => addMessage(msg.text, msg.sender, false));
    scrollToBottom();
}

function clearConversation() {
    stopTokenRefresh();
    intentionalClose = true;
    if (socket) socket.close(1000);
    localStorage.removeItem("conversationId");
    localStorage.removeItem("conversationHistory");
    location.reload();
}

function updateStatus(text) {
    document.getElementById("status").textContent = text;
}

function updateSendButton() {
    sendBtn.disabled = !wsReady || !conversationReady || isProcessing;
    sendBtn.textContent = isProcessing ? "Pensando..." : "Enviar";
}

// ==========================================
// CONTROL DE UI Y EVENTOS
// ==========================================

function openChat() {
    chatWidget.classList.add("open");
    chatLauncher.classList.add("is-hidden");
    chatLauncherClose.classList.add("is-hidden");

    if (sideAvatar) {
        sideAvatar.classList.add("active-anim");
        updateAvatar("saludando");
    }
    setTimeout(scrollToBottom, 100);
}

function closeChat() {
    chatWidget.classList.remove("open");
    chatLauncher.classList.remove("is-hidden");
    chatLauncherClose.classList.remove("is-hidden");
    if (sideAvatar) sideAvatar.classList.remove("active-anim");
}

function updateAvatar(state) {
    const avatarPaths = {
        saludando: "./assets/avatares/ania/ania_saludando.PNG",
        hablando: "./assets/avatares/ania/ania_hablando.png",
        pensando: "./assets/avatares/ania/ania_pensando.png",
        leyendo: "./assets/avatares/ania/ania_leyendo.png"
    };

    if (sideAvatar && avatarPaths[state]) {
        sideAvatar.src = avatarPaths[state];
    }
}

chatLauncher.addEventListener("click", async () => {
    if (!hasAcceptedTerms()) {
        termsDialog.removeAttribute("hidden");
        return;
    }
    openChat();
    await init();
});

chatLauncherClose.addEventListener("click", () => {
    chatLauncher.classList.add("is-hidden");
    chatLauncherClose.classList.add("is-hidden");
    setTimeout(() => {
        chatLauncher.classList.remove("is-hidden");
        chatLauncherClose.classList.remove("is-hidden");
    }, 30000);
});

chatClose.addEventListener("click", closeChat);
chatDockClose.addEventListener("click", closeChat);

termsAccept.addEventListener("click", async () => {
    localStorage.setItem("termsAccepted", "true");
    termsDialog.setAttribute("hidden", "");
    openChat();
    await init();
});

termsCancel.addEventListener("click", () => termsDialog.setAttribute("hidden", ""));

messageInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
});

messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
        setTimeout(() => { this.style.height = "auto"; }, 0);
    }
});

document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        if (!socket || socket.readyState === WebSocket.CLOSED) {
            await connectSocket();
        }
    }
});

window.addEventListener("beforeunload", () => {
    stopTokenRefresh();
    intentionalClose = true;
    if (socket) socket.close(1000);
});

// --- CONTROL DE AUDIO ---
btnToggleVoice.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    btnToggleVoice.textContent = voiceEnabled ? "🔊" : "🔇";
    btnToggleVoice.title = voiceEnabled ? "Desactivar voz" : "Activar voz";
    
    // Si el usuario silencia mientras Ania esta hablando, detenemos el audio
    if (!voiceEnabled && isSpeaking) {
        detenerAudio();
    }
});

btnStopVoice.addEventListener("click", detenerAudio);

function detenerAudio() {
    if (isSpeaking) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        isSpeaking = false;
        updateAvatar("saludando");
        btnStopVoice.style.display = "none";
    }
}

updateSendButton();
