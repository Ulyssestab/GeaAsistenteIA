/**
 * Lógica del Asistente Virtual - Gobierno de Aguascalientes
 * Maneja: WebSpeech API (Continuo), Voz Local (Streaming/Precarga) y Agente Dinámico.
 */
class AsistenteAnia {
    constructor() {
        this.apiIA = 'api/agente_dinamico.ashx';
        this.apiTTS = 'api/tts.ashx';

        this.avatarBasePath = 'assets/avatares/ania';

        this.isListening = false;
        this.isSpeaking = false;
        this.currentIAAbortController = null;
        this.shouldStopListeningAfterSpeech = false;

        this.imgAvatar = document.getElementById('sideAvatar');
        this.btnAction = document.getElementById('btnAction');
        this.statusTxt = document.getElementById('assistantStatus');
        this.chatHistory = document.getElementById('chatHistory');
        this.userInput = document.getElementById('userInput');

        this.audioPlayer = new Audio();
        this.recognition = null;
        
        // Variables para el sistema de Chunking y Precarga
        this.audioQueue = [];
        this.isAudioPlaying = false;
        this.isFetchingAudio = false; // <-- Controla que la tarjeta grafica no se satura
        this.ttsBuffer = "";
        this.isIAGenerationDone = true; 
        this.isIAGenerationDone = true;

        // Variables para el temporizador de aburrimiento
        this.tiempoAburrimiento = 5 * 60 * 1000; // 5 minutos en milisegundos
        this.timerInactividad = null;

        this.init();
    }

    init() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.statusTxt.innerText = "Error: el navegador no soporta reconocimiento de voz.";
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-MX';
        this.recognition.continuous = true;
        this.recognition.interimResults = false;

        this.recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript?.trim() || "";

            if (!transcript || transcript.length < 2) return;

            // Si el usuario interrumpe mientras Ania habla
            if (this.isSpeaking && transcript.length > 3) {
                console.log("Interrupción detectada");
                this.audioPlayer.pause();
                this.audioPlayer.currentTime = 0;
                this.isSpeaking = false;
                this.isAudioPlaying = false;
                this.audioQueue = []; // Vaciamos la cola para que calle al instante
                this.shouldStopListeningAfterSpeech = false;
            }

            // Si había una petición de IA en curso, abortarla
            if (this.currentIAAbortController) {
                this.currentIAAbortController.abort();
                this.currentIAAbortController = null;
            }

            this.addMessage(transcript, 'user');
            this.procesarConIA(transcript);
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.warn("No se pudo reiniciar reconocimiento:", e);
                }
            }
        };

        this.recognition.onerror = (e) => {
            console.warn("Error reconocimiento:", e);
        };

        this.btnAction.onclick = () => this.toggleEscucha();

        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.enviarTexto();
            }
        });

        this.setAvatar('saludando');
    }

    iniciarTemporizador() {
        // Limpiamos cualquier temporizador previo por seguridad
        this.limpiarTemporizador();
        
        // Iniciamos la cuenta regresiva de 5 minutos
        this.timerInactividad = setTimeout(() => {
            this.mostrarEstadoAburrida();
        }, this.tiempoAburrimiento);
    }

    limpiarTemporizador() {
        if (this.timerInactividad) {
            clearTimeout(this.timerInactividad);
            this.timerInactividad = null;
        }
    }

    mostrarEstadoAburrida() {
        // Cambiamos la imagen del avatar a la versión aburrida
        if (this.imgAvatar) {
            this.imgAvatar.src = this.avatarBasePath + '/ania_aburrida.png';
        }
    }

    toggleEscucha() {
        if (!this.recognition) return;

        if (!this.isListening) {
            try {
                this.shouldStopListeningAfterSpeech = false;
                this.recognition.start();
                this.isListening = true;
                this.btnAction.innerText = "Detener";
                this.btnAction.classList.remove('btn-primary');
                this.btnAction.classList.add('btn-danger');
                this.setAvatar('escuchando');
                this.statusTxt.innerText = "Te escucho...";
            } catch (e) {
                console.error("No se pudo iniciar el micrófono:", e);
            }
        } else {
            this.recognition.stop();
            this.isListening = false;
            this.shouldStopListeningAfterSpeech = false;
            this.btnAction.innerText = "Iniciar Voz";
            this.btnAction.classList.remove('btn-danger');
            this.btnAction.classList.add('btn-primary');
            this.setAvatar('saludando');
            this.statusTxt.innerText = "Micrófono apagado.";
        }
    }

    enviarTexto() {
        const texto = (this.userInput.value || "").trim();
        if (!texto) return;

        this.userInput.value = "";
        this.addMessage(texto, 'user');

        if (this.currentIAAbortController) {
            this.currentIAAbortController.abort();
            this.currentIAAbortController = null;
        }

        this.procesarConIA(texto);
    }

    async procesarConIA(texto) {
        this.setAvatar('pensando');
        this.statusTxt.innerText = "Ania está pensando...";

        const botMessageEl = this.addMessage("", 'bot');
        let respuestaAcumulada = "";
        let buffer = "";
        
        // Reiniciamos todo para la nueva consulta
        this.isIAGenerationDone = false; 
        this.audioQueue = [];
        this.ttsBuffer = "";
        this.isFetchingAudio = false; 
        this.shouldStopListeningAfterSpeech = false;

        try {
            this.currentIAAbortController = new AbortController();

            const response = await fetch(this.apiIA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: texto }),
                signal: this.currentIAAbortController.signal
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            if (!response.body) {
                const raw = await response.text();
                respuestaAcumulada = this.extraerTextoDeChunk(raw);
                this.actualizarMensajeBot(botMessageEl, respuestaAcumulada);
                
                this.ttsBuffer = respuestaAcumulada;
                this.procesarBufferTTS();
                this.isIAGenerationDone = true;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    this.isIAGenerationDone = true;
                    this.procesarColaAudios(); // Última revisión
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const lineas = buffer.split(/\r?\n/);
                buffer = lineas.pop() || "";

                for (const linea of lineas) {
                    const textoChunk = this.extraerTextoDeChunk(linea);
                    if (!textoChunk) continue;

                    respuestaAcumulada = this.unirChunks(respuestaAcumulada, textoChunk);
                    this.actualizarMensajeBot(botMessageEl, respuestaAcumulada);

                    this.ttsBuffer += textoChunk;
                    this.procesarBufferTTS();
                }
            }

            // Procesar lo último que quedó en el buffer
            if (this.ttsBuffer.trim().length > 0) {
                const textoFinal = this.htmlATextoParaTTS(this.ttsBuffer);
                if (textoFinal.trim().length > 0) {
                    this.audioQueue.push({ texto: textoFinal, url: null });
                    this.procesarColaAudios();
                }
                this.ttsBuffer = "";
            }

            this.isIAGenerationDone = true;
            this.shouldStopListeningAfterSpeech = this.esDespedida(respuestaAcumulada);

            // Verificamos si todo terminó súper rápido
            if (this.audioQueue.length === 0 && !this.isAudioPlaying) {
                this.finalizarAudioChunk();
            }

        } catch (error) {
            this.isIAGenerationDone = true;
            if (error.name === 'AbortError') {
                console.log("Petición abortada.");
                return;
            }

            console.error("Error IA:", error);
            this.actualizarMensajeBot(botMessageEl, "Ocurrió un problema al consultar la IA.");
            this.setAvatar('saludando');
            this.statusTxt.innerText = "Error al consultar la IA.";
        } finally {
            this.currentIAAbortController = null;
        }
    }

    procesarBufferTTS() {
        // NUEVO REGEX MÁS AGRESIVO:
        // Corta en puntos, interrogaciones y saltos de línea clásicos
        // Y AHORA TAMBIÉN en etiquetas HTML que separan ideas (<br>, <li>, <p>)
        const regexPuntuacion = /([.?!:;\n]+(?:\s+|$)|<br\s*\/?>|<\/li>|<\/p>|<\/div>)/i;
        const partes = this.ttsBuffer.split(regexPuntuacion);

        // Si tenemos texto + puntuación/etiqueta + algo más, significa que hay un fragmento completo
        while (partes.length >= 3) {
            const oracion = partes[0] + (partes[1] || ""); // El texto + el signo o etiqueta
            const textoTTS = this.htmlATextoParaTTS(oracion).trim();

            // Solo metemos a la cola si realmente hay texto válido
            if (textoTTS.length > 2) {
                // Metemos a la cola con url en 'null' para que se precargue
                this.audioQueue.push({ texto: textoTTS, url: null });
                this.procesarColaAudios();
            }

            // Quitamos lo procesado y dejamos el resto en el buffer
            this.ttsBuffer = partes.slice(2).join("");
            partes.splice(0, 2);
        }
    }

    // --- NUEVO SISTEMA DE FLUJO Y PRECARGA --- //

    procesarColaAudios() {
        // 1. Intentamos reproducir si no hay nada sonando
        this.intentarReproducir();

        // 2. Intentamos precargar la siguiente oración en segundo plano
        this.intentarPrecargar();
    }

    async intentarPrecargar() {
        // Si ya está descargando un audio, esperamos para no saturar la RTX 5070
        if (this.isFetchingAudio) return;

        // Buscamos la primera oración que necesite ser descargada
        const itemToFetch = this.audioQueue.find(item => item.url === null);
        if (!itemToFetch) return; // Todo está descargado

        this.isFetchingAudio = true;

        try {
            const res = await fetch(this.apiTTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: itemToFetch.texto, provider: 'local' })
            });

            if (res.ok) {
                const blob = await res.blob();
                // Validamos que el usuario no haya interrumpido vaciando la cola
                if (this.audioQueue.includes(itemToFetch)) {
                    itemToFetch.url = URL.createObjectURL(blob);
                }
            }
        } catch (e) {
            console.error("Error en precarga TTS:", e);
        } finally {
            this.isFetchingAudio = false;
            // Al terminar de descargar, volvemos a evaluar la cola (reproducir o descargar la siguiente)
            this.procesarColaAudios();
        }
    }

    intentarReproducir() {
        // Si ya está sonando un audio o la cola está vacía, no hacemos nada
        if (this.isAudioPlaying || this.audioQueue.length === 0) return;

        const nextItem = this.audioQueue[0];

        // ¿El siguiente audio ya se descargó en segundo plano?
        if (nextItem.url) {
            // ¡Listo para sonar! Lo sacamos de la cola de espera
            this.audioQueue.shift();
            
            this.isAudioPlaying = true;
            this.isSpeaking = true;
            this.setAvatar('hablando');
            this.statusTxt.innerText = "Ania respondiendo...";

            this.audioPlayer.src = nextItem.url;
            this.audioPlayer.play().catch(e => {
                console.error("Error reproduciendo audio:", e);
                this.finalizarAudioChunk();
            });

            this.audioPlayer.onended = () => {
                // Liberamos memoria
                URL.revokeObjectURL(nextItem.url); 
                this.finalizarAudioChunk();
            };
        }
    }

    finalizarAudioChunk() {
        this.isAudioPlaying = false;

        if (this.audioQueue.length > 0) {
            // Si hay más audios pendientes, el ciclo continúa
            this.procesarColaAudios();
        } else if (this.isIAGenerationDone) {
            // Ya no hay audios y la IA terminó: Apagamos micrófonos y animaciones
            this.isSpeaking = false;
            
            if (this.shouldStopListeningAfterSpeech) {
                this.detenerEscuchaAutomatica();
            } else {
                this.setAvatar(this.isListening ? 'escuchando' : 'saludando');
                this.statusTxt.innerText = this.isListening ? "Te escucho..." : "Lista para ayudarte.";
            }
        }
    }

    // --- FUNCIONES DE LIMPIEZA DE TEXTO (Sin cambios) --- //

    extraerTextoDeChunk(rawLine) {
        if (rawLine == null) return "";
        let line = String(rawLine).trim();
        if (!line) return "";
        if (line.startsWith("data:")) line = line.replace(/^data:\s?/, "");

        const control = line.toLowerCase();
        if (!control || control === "[done]") return "";
        if (control.includes("connected to ") || control === "(empty)" || control === "empty") return "";

        if (line.startsWith("{") && line.endsWith("}")) {
            try {
                const obj = JSON.parse(line);
                return (obj.output ?? obj.respuesta ?? obj.text ?? obj.chunk ?? obj.data ?? "");
            } catch { }
        }
        return line;
    }

    stripHtml(html) {
        if (!html) return "";
        const temp = document.createElement("div");
        temp.innerHTML = html;
        let text = temp.textContent || temp.innerText || "";
        if (!text.trim()) {
            text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<[^>]*>/g, "");
        }
        return text;
    }

    normalizarTexto(texto) {
        return (texto || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    }

    actualizarMensajeBot(elemento, texto) {
        elemento.innerHTML = this.renderizarRespuestaComoHtml(texto || "...");
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    esDespedida(texto) {
        if (!texto) return false;
        const limpio = this.stripHtml(texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
        const patronesDespedida = [
            "hasta luego", "hasta pronto", "adios", "que tengas un gran dia", 
            "que tengas un excelente dia", "que tenga un gran dia", "que tenga un excelente dia", 
            "fue un gusto ayudarte", "si necesitas ayuda en el futuro aqui estare", "estare aqui", 
            "gracias por comunicarte", "gracias por contactarnos", "que tengas un buen dia", 
            "que tenga un buen dia", "hasta la proxima", "nos vemos"
        ];
        return patronesDespedida.some(p => limpio.includes(p));
    }

    detenerEscuchaAutomatica() {
        this.shouldStopListeningAfterSpeech = false;
        this.isListening = false;
        try {
            if (this.recognition) this.recognition.stop();
        } catch (e) {
            console.warn("No se pudo detener el reconocimiento:", e);
        }
        this.btnAction.innerText = "Iniciar Voz";
        this.btnAction.classList.remove('btn-danger');
        this.btnAction.classList.add('btn-primary');
        this.setAvatar('saludando');
        this.statusTxt.innerText = "Conversación finalizada. Micrófono apagado.";
    }

    setAvatar(estado) {
        this.imgAvatar.classList.toggle('active-anim', estado === 'escuchando' || estado === 'hablando');
        const path = `${this.avatarBasePath}/ania_${estado}.png`;
        this.imgAvatar.onerror = () => {
            this.imgAvatar.onerror = null;
            this.imgAvatar.src = `${this.avatarBasePath}/ania_saludando.png`;
        };
        this.imgAvatar.src = path;
    }

    addMessage(texto, emisor) {
        const div = document.createElement('div');
        div.className = `message ${emisor}-msg mb-2 p-2 rounded ${emisor === 'user' ? 'bg-light text-end' : 'bg-primary text-white text-start'}`;
        div.innerText = texto || "";
        this.chatHistory.appendChild(div);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        return div;
    }

    escaparHtml(texto) {
        return (texto || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    normalizarUrl(url) {
        if (!url) return "#";
        let limpia = url.replace(/\s+/g, '').trim();
        if (/^https?:\/\//i.test(limpia)) return limpia;
        if (/^www\./i.test(limpia)) return "https://" + limpia;
        return limpia;
    }

    renderizarRespuestaComoHtml(texto) {
        if (!texto) return "";
        let html = texto;
        const pareceHtml = /<\/?[a-z][\s\S]*>/i.test(html);
        if (!pareceHtml) html = this.escaparHtml(html);

        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, textoLink, url) => {
            const href = this.normalizarUrl(url.replace(/\s+/g, ''));
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${this.escaparHtml(textoLink)}</a>`;
        });

        html = html.replace(/(^|[\s>])((https?:\/\/|www\.)[^\s<]+)/gi, (match, prefijo, url) => {
            const href = this.normalizarUrl(url);
            const textoVisible = this.escaparHtml(url);
            return `${prefijo}<a href="${href}" target="_blank" rel="noopener noreferrer">${textoVisible}</a>`;
        });

        return this.sanitizarHtmlPermitido(html);
    }

    sanitizarHtmlPermitido(html) {
        const temp = document.createElement("div");
        temp.innerHTML = html;
        const permitidas = new Set(["DIV", "P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "A"]);

        const limpiarNodo = (node) => {
            const hijos = Array.from(node.childNodes);
            for (const hijo of hijos) {
                if (hijo.nodeType === Node.ELEMENT_NODE) {
                    const tag = hijo.tagName.toUpperCase();
                    if (!permitidas.has(tag)) {
                        const fragment = document.createDocumentFragment();
                        while (hijo.firstChild) fragment.appendChild(hijo.firstChild);
                        hijo.replaceWith(fragment);
                        continue;
                    }

                    const attrs = Array.from(hijo.attributes);
                    for (const attr of attrs) {
                        const nombre = attr.name.toLowerCase();
                        if (tag === "A" && (nombre === "href" || nombre === "target" || nombre === "rel")) continue;
                        hijo.removeAttribute(attr.name);
                    }

                    if (tag === "A") {
                        let href = hijo.getAttribute("href") || "";
                        href = this.normalizarUrl(href);
                        if (!/^https?:\/\//i.test(href)) {
                            hijo.removeAttribute("href");
                        } else {
                            hijo.setAttribute("href", href);
                            hijo.setAttribute("target", "_blank");
                            hijo.setAttribute("rel", "noopener noreferrer");
                        }
                    }
                    limpiarNodo(hijo);
                }
            }
        };

        limpiarNodo(temp);
        return temp.innerHTML;
    }

    htmlATextoParaTTS(html) {
        if (!html) return "";
        let tempText = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/ul>/gi, "\n").replace(/<\/ol>/gi, "\n");
        const temp = document.createElement("div");
        temp.innerHTML = tempText;
        let texto = temp.textContent || temp.innerText || "";
        texto = texto.replace(/\bhttps?:\/\/[^\s]+/gi, " ").replace(/\bwww\.[^\s]+/gi, " ").replace(/enlace del trámite[:]?/gi, "").replace(/enlace[:]?/gi, "");
        texto = this.normalizarTexto(texto);
        return this.prepararNumerosParaEleven(texto);
    }

    unirChunks(actual, nuevo) {
        return (actual || "") + (nuevo || "");
    }

    prepararNumerosParaEleven(texto) {
        if (!texto) return "";
        return texto
            // 0. LIMPIEZA FONÉTICA: Arreglamos las distorsiones del motor de voz
            .replace(/¡Hola!/gi, "Hola,") 
            .replace(/[¡!]/g, "") 
            .replace(/C[Ã³óo]digo Postal/gi, "Codigo Postal") 
            
            // 1. DINERO: Quitamos $, eliminamos ".00" y borramos las comas de los miles (1,380 -> 1380)
            .replace(/\$\s*([\d,]+)\.00\s*pesos/gi, (_, num) => `${num.replace(/,/g, '')} pesos`)
            .replace(/\$\s*([\d,]+)(?:\.\d+)?\s*pesos/gi, (_, num) => `${num.replace(/,/g, '')} pesos`)
            .replace(/\$\s*([\d,]+)\.00/g, (_, num) => `${num.replace(/,/g, '')} pesos`)
            .replace(/\$\s*([\d,]+)(?:\.\d+)?/g, (_, num) => `${num.replace(/,/g, '')} pesos`)
            
            // 1.5 EXTRA: Si hay números con coma perdidos por ahí (ej. "1,380"), quitamos la coma
            .replace(/\b(\d+),(\d{3})\b/g, "$1$2")
            
            // 2. ABREVIATURAS: Sin puntos para evitar pausas robóticas
            .replace(/\bAv\./gi, "Avenida")
            .replace(/\bCol\./gi, "Colonia")
            .replace(/\bBlvd\./gi, "Bulevar")
            .replace(/\bLic\./gi, "Licenciado")
            .replace(/\bIng\./gi, "Ingeniero")
            .replace(/\bDr\./gi, "Doctor")
            
            // 3. C.P. y NÚMEROS: 
            .replace(/\bC\.?\s*P\.?\s*(\d{5})\b/gi, (_, cp) => `Codigo Postal ${cp.split('').join(' ')}`)
            .replace(/#\s*(\d+[A-Za-z\-]*)/g, (_, num) => `numero ${num}`)
            
            // 4. TELÉFONOS:
            .replace(/\b(\d{10})\b/g, (_, num) => num.split('').join(' '))
            .replace(/\b(\d{6,})\b/g, (_, num) => num.split('').join(' '));
    }
}

const ania = new AsistenteAnia();