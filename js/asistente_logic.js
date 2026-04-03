/**
 * Lógica del Asistente Virtual - Gobierno de Aguascalientes
 * Maneja: WebSpeech API (Continuo), ElevenLabs TTS y Agente Dinámico con streaming.
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

    toggleEscucha() {
        if (!this.recognition) return;

        if (!this.isListening) {
            try {
                this.shouldStopListeningAfterSpeech = false;
                this.recognition.start();
                this.isListening = true;
                this.btnAction.innerText = "🛑 Detener";
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
            this.btnAction.innerText = "🎤 Iniciar Voz";
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
                this.finalizarRespuestaIA(respuestaAcumulada);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // Procesar por líneas
                const lineas = buffer.split(/\r?\n/);
                buffer = lineas.pop() || "";

                for (const linea of lineas) {
                    const textoChunk = this.extraerTextoDeChunk(linea);
                    if (!textoChunk) continue;

                    respuestaAcumulada = this.unirChunks(respuestaAcumulada, textoChunk);
                    this.actualizarMensajeBot(botMessageEl, respuestaAcumulada);
                }
            }

            // Procesar remanente
            if (buffer.trim()) {
                const textoFinal = this.extraerTextoDeChunk(buffer);
                if (textoFinal) {
                    respuestaAcumulada = this.unirChunks(respuestaAcumulada, textoFinal);
                    this.actualizarMensajeBot(botMessageEl, respuestaAcumulada);
                }
            }

            respuestaAcumulada = this.normalizarTexto(respuestaAcumulada);

            if (!respuestaAcumulada) {
                respuestaAcumulada = "No recibí una respuesta válida del agente.";
                this.actualizarMensajeBot(botMessageEl, respuestaAcumulada);
            }

            this.finalizarRespuestaIA(respuestaAcumulada);
        } catch (error) {
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

    extraerTextoDeChunk(rawLine) {
        if (rawLine == null) return "";

        let line = String(rawLine);

        // Solo para validar si la línea viene vacía o es control
        const lineTrim = line.trim();
        if (!lineTrim) return "";

        if (lineTrim.startsWith("data:")) {
            // Quita solo el prefijo SSE, pero NO hagas trim() al contenido restante
            line = line.replace(/^data:\s?/, "");
        }

        const control = line.trim().toLowerCase();
        if (!control || control === "[done]") return "";

        if (
            control.includes("connected to ") ||
            control === "(empty)" ||
            control === "empty"
        ) {
            return "";
        }

        const posibleJson = line.trim();
        if (posibleJson.startsWith("{") && posibleJson.endsWith("}")) {
            try {
                const obj = JSON.parse(posibleJson);
                return (
                    obj.output ??
                    obj.respuesta ??
                    obj.text ??
                    obj.chunk ??
                    obj.data ??
                    ""
                );
            } catch {
                // sigue abajo
            }
        }

        // Regresar el texto tal cual, preservando espacios reales del stream
        return line;
    }

    stripHtml(html) {
        if (!html) return "";

        const temp = document.createElement("div");
        temp.innerHTML = html;

        let text = temp.textContent || temp.innerText || "";

        // Si no pudo convertir nada y venía solo texto plano, usarlo tal cual
        if (!text.trim()) {
            text = html
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/p>/gi, "\n")
                .replace(/<\/div>/gi, "\n")
                .replace(/<[^>]*>/g, "");
        }

        return text;
    }

    normalizarTexto(texto) {
        return (texto || "")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]{2,}/g, " ")
            .trim();
    }

    actualizarMensajeBot(elemento, texto) {
        elemento.innerHTML = this.renderizarRespuestaComoHtml(texto || "...");
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    esDespedida(texto) {
        if (!texto) return false;

        const limpio = this.stripHtml(texto)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim();

        const patronesDespedida = [
            "hasta luego",
            "hasta pronto",
            "adios",
            "que tengas un gran dia",
            "que tengas un excelente dia",
            "que tenga un gran dia",
            "que tenga un excelente dia",
            "fue un gusto ayudarte",
            "si necesitas ayuda en el futuro aqui estare",
            "estare aqui",
            "gracias por comunicarte",
            "gracias por contactarnos",
            "que tengas un buen dia",
            "que tenga un buen dia",
            "hasta la proxima",
            "nos vemos"
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

        this.btnAction.innerText = "🎤 Iniciar Voz";
        this.btnAction.classList.remove('btn-danger');
        this.btnAction.classList.add('btn-primary');

        this.setAvatar('saludando');
        this.statusTxt.innerText = "Conversación finalizada. Micrófono apagado.";
    }

    finalizarRespuestaIA(respuestaTexto) {
        const textoTTS = this.htmlATextoParaTTS(respuestaTexto);

        this.shouldStopListeningAfterSpeech =
            this.esDespedida(respuestaTexto) || this.esDespedida(textoTTS);

        this.setAvatar('hablando');
        this.statusTxt.innerText = "Ania respondiendo...";
        this.hablarConElevenLabs(textoTTS);
    }

    async hablarConElevenLabs(texto) {
        if (!texto || !texto.trim()) {
            this.isSpeaking = false;

            if (this.shouldStopListeningAfterSpeech) {
                this.detenerEscuchaAutomatica();
                return;
            }

            this.setAvatar(this.isListening ? 'escuchando' : 'saludando');
            return;
        }

        this.audioPlayer.pause();
        this.audioPlayer.src = "";

        this.isSpeaking = true;
        this.setAvatar('hablando');
        this.statusTxt.innerText = "Ania respondiendo...";

        try {
            const res = await fetch(this.apiTTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: texto,
                    provider: 'elevenlabs',
                    elevenVoiceId: 'cAvMBIZ0VNTU8XdsUpEq'
                })
            });

            if (!res.ok) {
                throw new Error(`Error en TTS. HTTP ${res.status}`);
            }

            const blob = await res.blob();
            this.audioPlayer.src = URL.createObjectURL(blob);

            await this.audioPlayer.play();

            this.audioPlayer.onended = () => {
                this.isSpeaking = false;

                if (this.shouldStopListeningAfterSpeech) {
                    this.detenerEscuchaAutomatica();
                    return;
                }

                if (this.isListening) {
                    this.setAvatar('escuchando');
                    this.statusTxt.innerText = "Te escucho...";
                } else {
                    this.setAvatar('saludando');
                    this.statusTxt.innerText = "Lista para ayudarte.";
                }
            };
        } catch (e) {
            console.error("Error TTS:", e);
            this.isSpeaking = false;

            if (this.shouldStopListeningAfterSpeech) {
                this.detenerEscuchaAutomatica();
                return;
            }

            if (this.isListening) {
                this.setAvatar('escuchando');
                this.statusTxt.innerText = "Te escucho...";
            } else {
                this.setAvatar('saludando');
                this.statusTxt.innerText = "Lista para ayudarte.";
            }
        }
    }

    setAvatar(estado) {
        this.imgAvatar.classList.toggle(
            'active-anim',
            estado === 'escuchando' || estado === 'hablando'
        );

        const path = `${this.avatarBasePath}/ania_${estado}.png`;

        this.imgAvatar.onerror = () => {
            this.imgAvatar.onerror = null;
            this.imgAvatar.src = `${this.avatarBasePath}/ania_saludando.png`;
        };

        this.imgAvatar.src = path;
    }

    addMessage(texto, emisor) {
        const div = document.createElement('div');
        div.className = `message ${emisor}-msg mb-2 p-2 rounded ${
            emisor === 'user'
                ? 'bg-light text-end'
                : 'bg-primary text-white text-start'
        }`;
        div.innerText = texto || "";
        this.chatHistory.appendChild(div);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        return div;
    }

    escaparHtml(texto) {
        return (texto || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
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

        // Si no parece HTML, escapar primero
        const pareceHtml = /<\/?[a-z][\s\S]*>/i.test(html);
        if (!pareceHtml) {
            html = this.escaparHtml(html);
        }

        // Convertir Markdown [texto](url) a <a>
        html = html.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (match, textoLink, url) => {
                const href = this.normalizarUrl(url.replace(/\s+/g, ''));
                return `<a href="${href}" target="_blank" rel="noopener noreferrer">${this.escaparHtml(textoLink)}</a>`;
            }
        );

        // Convertir URLs sueltas en enlaces clicables
        // Evita tocar las que ya quedaron dentro de href=""
        html = html.replace(
            /(^|[\s>])((https?:\/\/|www\.)[^\s<]+)/gi,
            (match, prefijo, url) => {
                const href = this.normalizarUrl(url);
                const textoVisible = this.escaparHtml(url);
                return `${prefijo}<a href="${href}" target="_blank" rel="noopener noreferrer">${textoVisible}</a>`;
            }
        );

        // Limpiar etiquetas peligrosas, dejando algunas útiles
        html = this.sanitizarHtmlPermitido(html);

        return html;
    }

    sanitizarHtmlPermitido(html) {
        const temp = document.createElement("div");
        temp.innerHTML = html;

        const permitidas = new Set([
            "DIV", "P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "A"
        ]);

        const limpiarNodo = (node) => {
            const hijos = Array.from(node.childNodes);

            for (const hijo of hijos) {
                if (hijo.nodeType === Node.ELEMENT_NODE) {
                    const tag = hijo.tagName.toUpperCase();

                    if (!permitidas.has(tag)) {
                        const fragment = document.createDocumentFragment();
                        while (hijo.firstChild) {
                            fragment.appendChild(hijo.firstChild);
                        }
                        hijo.replaceWith(fragment);
                        continue;
                    }

                    // Limpiar atributos peligrosos
                    const attrs = Array.from(hijo.attributes);
                    for (const attr of attrs) {
                        const nombre = attr.name.toLowerCase();

                        if (tag === "A" && (nombre === "href" || nombre === "target" || nombre === "rel")) {
                            continue;
                        }

                        hijo.removeAttribute(attr.name);
                    }

                    if (tag === "A") {
                        let href = hijo.getAttribute("href") || "";
                        href = this.normalizarUrl(href);

                        // Bloquear javascript:
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

        let tempText = html;

        tempText = tempText
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

        texto = this.normalizarTexto(texto);
        texto = this.prepararNumerosParaEleven(texto);

        return texto;
    }

    unirChunks(actual, nuevo) {
        return (actual || "") + (nuevo || "");
    }

    prepararNumerosParaEleven(texto) {
        if (!texto) return "";

        return texto
            // C.P. 20180 -> Código Postal 2 0 1 8 0
            .replace(/\bC\.?\s*P\.?\s*(\d{5})\b/gi, (_, cp) => {
                return `Código Postal ${cp.split('').join(' ')}`;
            })

            // # 102 -> número 102
            .replace(/#\s*(\d+[A-Za-z\-]*)/g, (_, num) => {
                return `número ${num}`;
            })

            // teléfonos de 10 dígitos -> separados
            .replace(/\b(\d{10})\b/g, (_, num) => {
                return num.split('').join(' ');
            })

            // folios o claves largas de 6+ dígitos
            .replace(/\b(\d{6,})\b/g, (_, num) => {
                return num.split('').join(' ');
            });
    }
}

const ania = new AsistenteAnia();