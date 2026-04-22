<%@ WebHandler Language="C#" Class="TtsProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Text.RegularExpressions;
using System.Globalization;

public class TtsProxy : IHttpHandler
{
    private static readonly JavaScriptSerializer Js = new JavaScriptSerializer();

    public void ProcessRequest(HttpContext context)
    {
        try { context.Response.TrySkipIisCustomErrors = true; } catch { }
        try { context.Response.BufferOutput = true; } catch { }

        // TLS 1.2 para ElevenLabs en .NET Framework
        try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }

        ApplyCors(context);

        if (context.Request.HttpMethod.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 204;
            context.Response.SuppressContent = true;
            return;
        }

        if (context.Request.HttpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.ContentType = "text/plain; charset=utf-8";
            context.Response.ContentEncoding = Encoding.UTF8;
            context.Response.Write("OK - TTS proxy activo (ElevenLabs). Usa POST.");
            return;
        }

        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            WriteJson(context, 405, new
            {
                error = "Method Not Allowed",
                detail = "Use POST."
            });
            return;
        }

        try
        {
            bool isLocal = IsLocalRequest(context);

            string body = ReadBody(context.Request);
            var payload = ParseJsonToDict(body);

            string text = FirstNonEmpty(
                GetString(payload, "text"),
                GetString(payload, "message"),
                GetString(payload, "input"),
                GetString(payload, "prompt")
            );

            string provider = FirstNonEmpty(
                GetString(payload, "provider"),
                GetString(payload, "voiceProvider"),
                context.Request["provider"],
                context.Request["voiceProvider"]
            );
            provider = (provider ?? "").Trim().ToLowerInvariant();

            string lang = FirstNonEmpty(
                GetString(payload, "lang"),
                GetString(payload, "locale"),
                context.Request["lang"],
                context.Request["locale"]
            );

            string elevenVoiceFromBody = FirstNonEmpty(
                GetString(payload, "elevenVoiceId"),
                GetString(payload, "elevenVoice"),
                GetString(payload, "voice"),
                context.Request["elevenVoiceId"],
                context.Request["elevenVoice"],
                context.Request["voice"]
            );

            if (string.IsNullOrWhiteSpace(text))
            {
                WriteJson(context, 400, new
                {
                    error = "Texto vacío",
                    detail = "Envia { text: \"...\" }"
                });
                return;
            }

            if (string.IsNullOrWhiteSpace(provider))
                provider = "elevenlabs";

            if (provider == "eleven")
                provider = "elevenlabs";

            if (provider == "browser")
            {
                WriteJson(context, 200, new
                {
                    ok = true,
                    provider = "browser",
                    detail = "Para browser TTS el audio se genera en el cliente."
                });
                return;
            }

            if (provider != "elevenlabs" && provider != "local")
            {
                WriteJson(context, 400, new
                {
                    error = "Proveedor no soportado",
                    detail = "Este endpoint soporta provider: elevenlabs | browser | local"
                });
                return;
            }

            string apiKey = GetSetting(isLocal ? "ElevenLabsApiKey.Local" : "ElevenLabsApiKey.Prod");
            string defaultVoiceId = GetSetting(isLocal ? "ElevenVoiceId.Local" : "ElevenVoiceId.Prod");
            string modelId = GetSetting(isLocal ? "ElevenModelId.Local" : "ElevenModelId.Prod");
            if (string.IsNullOrWhiteSpace(modelId))
                modelId = "eleven_multilingual_v2";

            string voiceId = !string.IsNullOrWhiteSpace(elevenVoiceFromBody)
                ? elevenVoiceFromBody
                : defaultVoiceId;

            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(voiceId))
            {
                WriteJson(context, 500, new
                {
                    error = "Configuración faltante ElevenLabs",
                    detail = "Faltan ElevenLabsApiKey.* y/o ElevenVoiceId.*",
                    provider = provider,
                    isLocal = isLocal
                });
                return;
            }

            byte[] audioBytes;
            if (provider == "local")
            {

                SynthesizeWithLocalTtsStream(context, text, lang);
                return; 
            }
            else
            {
                
                string textForTts = NormalizeTextForElevenLabs(text);
                audioBytes = SynthesizeWithElevenLabs(textForTts, apiKey, voiceId, modelId, lang);
                WriteAudio(context, audioBytes, "audio/mpeg");
            }
        } 
        catch (WebException ex)
        {
            string detail = ReadWebException(ex);
            WriteJson(context, 500, new
            {
                error = "Error llamando proveedor TTS",
                detail = detail,
                hint = "Revisa salida a api.elevenlabs.io, API key, Voice ID y firewall/proxy del servidor."
            });
        }
    }

    public bool IsReusable { get { return true; } }

    // ----------------- ElevenLabs -----------------

    private static byte[] SynthesizeWithElevenLabs(string text, string apiKey, string voiceId, string modelId, string lang)
    {
        string url = "https://api.elevenlabs.io/v1/text-to-speech/" +
                     HttpUtility.UrlEncode(voiceId) +
                     "?output_format=mp3_44100_128";

        var payload = new Dictionary<string, object>
        {
            { "text", text },
            { "model_id", modelId },
            { "voice_settings", new Dictionary<string, object>
                {
                    { "stability", 0.50 },
                    { "similarity_boost", 0.75 }
                }
            }
        };

        if (!string.IsNullOrWhiteSpace(lang))
            payload["language_code"] = lang;

        string json = Js.Serialize(payload);

        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Accept = "audio/mpeg";
        req.Headers["xi-api-key"] = apiKey;
        req.UserAgent = "GeaAsistenteHub-TTS";
        req.Timeout = 60000;
        req.ReadWriteTimeout = 60000;

        byte[] data = Encoding.UTF8.GetBytes(json);
        using (var rs = req.GetRequestStream())
        {
            rs.Write(data, 0, data.Length);
        }

        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var stream = resp.GetResponseStream())
        {
            return ReadAllBytes(stream);
        }
    }

    // ----------------- Normalización TTS -----------------

    private static string NormalizeTextForElevenLabs(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return "";

        string t = text;

        // Decodifica entidades HTML
        t = HttpUtility.HtmlDecode(t);

        // Convierte algo de HTML básico a texto legible
        t = Regex.Replace(t, "<br\\s*/?>", "\n", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, "</p>|</div>|</li>|</ul>|</ol>", "\n", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, "<li[^>]*>", "• ", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, "<[^>]+>", " ");

        // Quita URLs
        t = Regex.Replace(t, @"\bhttps?:\/\/[^\s]+", " ", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bwww\.[^\s]+", " ", RegexOptions.IgnoreCase);

        // Expande abreviaturas antes de números
        t = ExpandCommonAbbreviationsForTts(t);

        // Código Postal 20180 -> Código Postal 2 0 1 8 0
        t = Regex.Replace(t, @"\bCódigo Postal\s*(\d{5})\b", delegate (Match m)
        {
            return "Código Postal " + DigitsSpaced(m.Groups[1].Value);
        }, RegexOptions.IgnoreCase);

        // número 102 -> número ciento dos
        t = Regex.Replace(t, @"\b(número|Exterior|Interior)\s*#?\s*(\d{1,5})\b", delegate (Match m)
        {
            string label = m.Groups[1].Value;
            string num = NumberToWordsEs(m.Groups[2].Value);
            return label + " " + num;
        }, RegexOptions.IgnoreCase);

        // # 102 -> número ciento dos
        t = Regex.Replace(t, @"#\s*(\d{1,5})\b", delegate (Match m)
        {
            return "número " + NumberToWordsEs(m.Groups[1].Value);
        });

        // número A-12 -> número A guion 1 2
        t = Regex.Replace(t, @"\b(número|Exterior|Interior)\s*#?\s*([A-Za-z0-9\-]+)\b", delegate (Match m)
        {
            return m.Groups[1].Value + " " + SpeakMixedToken(m.Groups[2].Value);
        }, RegexOptions.IgnoreCase);

        // #A-12 -> número A guion 1 2
        t = Regex.Replace(t, @"#\s*([A-Za-z][A-Za-z0-9\-]*)\b", delegate (Match m)
        {
            return "número " + SpeakMixedToken(m.Groups[1].Value);
        });

        // Teléfono 4491234567 -> Teléfono 4 4 9 1 2 3 4 5 6 7
        t = Regex.Replace(t, @"\b(Teléfono|Celular)\s*:?\s*([0-9\-\s\(\)]{7,})", delegate (Match m)
        {
            string label = m.Groups[1].Value;
            string digits = OnlyDigits(m.Groups[2].Value);
            if (digits.Length >= 7)
                return label + " " + DigitsSpaced(digits);
            return m.Value;
        }, RegexOptions.IgnoreCase);

        // RFC/CURP/Folio/etc
        t = Regex.Replace(t, @"\b(Folio|Expediente|Clave|Referencia|Trámite|Tramite|Cuenta|C U R P|R F C)\s*:?\s*([A-Za-z0-9\-]{6,})\b", delegate (Match m)
        {
            return m.Groups[1].Value + " " + SpeakMixedToken(m.Groups[2].Value);
        }, RegexOptions.IgnoreCase);

        // Cualquier número largo aislado de 6+ dígitos -> por dígitos
        t = Regex.Replace(t, @"\b\d{6,}\b", delegate (Match m)
        {
            return DigitsSpaced(m.Value);
        });

        // Limpieza final
        t = Regex.Replace(t, @"[ \t]{2,}", " ");
        t = Regex.Replace(t, @"\n{3,}", "\n\n");
        t = t.Trim();

        return t;
    }

    private static string ExpandCommonAbbreviationsForTts(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return "";

        string t = text;

        // Vialidades
        t = Regex.Replace(t, @"\bAvda\.?\b", "Avenida", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bAv\.?\b", "Avenida", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bBlvd\.?\b", "Bulevar", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bBoulevard\.?\b", "Bulevar", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCalz\.?\b", "Calzada", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCarr\.?\b", "Carretera", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCto\.?\b", "Circuito", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCirc\.?\b", "Circuito", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bProl\.?\b", "Prolongación", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bLibram\.?\b", "Libramiento", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCam\.?\b", "Camino", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPriv\.?\b", "Privada", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bAnd\.?\b", "Andador", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bRet\.?\b", "Retorno", RegexOptions.IgnoreCase);

        // Orientaciones
        t = Regex.Replace(t, @"\bOte\.?\b", "Oriente", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPte\.?\b", "Poniente", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNte\.?\b", "Norte", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bSur\.?\b", "Sur", RegexOptions.IgnoreCase);

        // Asentamientos
        t = Regex.Replace(t, @"\bCol\.?\b", "Colonia", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bFracc\.?\b", "Fraccionamiento", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bFrac\.?\b", "Fraccionamiento", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bBarr\.?\b", "Barrio", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bRes\.?\b", "Residencial", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bResid\.?\b", "Residencial", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bU\.?\s*Hab\.?\b", "Unidad Habitacional", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bEj\.?\b", "Ejido", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPbo\.?\b", "Poblado", RegexOptions.IgnoreCase);

        // Números e interiores
        t = Regex.Replace(t, @"\bNo\.?\s*Int\.?\b", "número interior", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNum\.?\s*Int\.?\b", "número interior", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNúm\.?\s*Int\.?\b", "número interior", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bInt\.?\b", "Interior", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bExt\.?\b", "Exterior", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNo\.?\b", "número", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNum\.?\b", "número", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bNúm\.?\b", "número", RegexOptions.IgnoreCase);

        // Datos territoriales y postales
        t = Regex.Replace(t, @"\bC\.?\s*P\.?\b", "Código Postal", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bMpio\.?\b", "Municipio", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bMun\.?\b", "Municipio", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bEdo\.?\b", "Estado", RegexOptions.IgnoreCase);

        // Inmuebles / oficinas
        t = Regex.Replace(t, @"\bOfna\.?\b", "Oficina", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bOf\.?\b", "Oficina", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bDepto\.?\b", "Departamento", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bDep\.?\b", "Departamento", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bDesp\.?\b", "Despacho", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bEdif\.?\b", "Edificio", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bTorre\.?\b", "Torre", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPiso\.?\b", "Piso", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPlta\.?\b", "Planta", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bPB\b", "planta baja", RegexOptions.IgnoreCase);

        // Identificadores comunes
        t = Regex.Replace(t, @"\bTel\.?\b", "Teléfono", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCel\.?\b", "Celular", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bRFC\b", "R F C", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bCURP\b", "C U R P", RegexOptions.IgnoreCase);

        // Títulos frecuentes
        t = Regex.Replace(t, @"\bLic\.?\b", "Licenciado", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bIng\.?\b", "Ingeniero", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bArq\.?\b", "Arquitecto", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bDr\.?\b", "Doctor", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\bDra\.?\b", "Doctora", RegexOptions.IgnoreCase);

        t = Regex.Replace(t, @"[ \t]{2,}", " ").Trim();

        return t;
    }

    private static string OnlyDigits(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return "";
        return Regex.Replace(input, @"\D", "");
    }

    private static string DigitsSpaced(string digits)
    {
        if (string.IsNullOrWhiteSpace(digits))
            return "";

        var sb = new StringBuilder();
        for (int i = 0; i < digits.Length; i++)
        {
            if (i > 0) sb.Append(" ");
            sb.Append(digits[i]);
        }
        return sb.ToString();
    }

    private static string SpeakMixedToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return "";

        if (Regex.IsMatch(token, @"^\d+$"))
            return DigitsSpaced(token);

        var parts = Regex.Matches(token, @"[A-Za-z]+|\d+|-");
        var sb = new StringBuilder();

        foreach (Match part in parts)
        {
            string p = part.Value;
            if (sb.Length > 0) sb.Append(" ");

            if (Regex.IsMatch(p, @"^\d+$"))
                sb.Append(DigitsSpaced(p));
            else if (p == "-")
                sb.Append("guion");
            else
                sb.Append(p);
        }

        return sb.ToString();
    }

    private static string NumberToWordsEs(string value)
    {
        int number;
        if (!Int32.TryParse(value, out number))
            return value;

        if (number == 0) return "cero";
        if (number < 0) return "menos " + NumberToWordsEs((-number).ToString());

        return IntToSpanish(number).Trim();
    }

    private static string IntToSpanish(int number)
    {
        if (number == 0) return "cero";
        if (number < 0) return "menos " + IntToSpanish(Math.Abs(number));

        if (number <= 15)
        {
            string[] units = {
                "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
                "diez", "once", "doce", "trece", "catorce", "quince"
            };
            return units[number];
        }

        if (number < 20) return "dieci" + IntToSpanish(number - 10);
        if (number == 20) return "veinte";
        if (number < 30) return "veinti" + IntToSpanish(number - 20);

        if (number < 100)
        {
            string[] tens = {
                "", "", "veinte", "treinta", "cuarenta", "cincuenta",
                "sesenta", "setenta", "ochenta", "noventa"
            };

            int ten = number / 10;
            int unit = number % 10;

            if (unit == 0) return tens[ten];
            return tens[ten] + " y " + IntToSpanish(unit);
        }

        if (number == 100) return "cien";
        if (number < 200) return "ciento " + IntToSpanish(number - 100);

        if (number < 1000)
        {
            string[] hundreds = {
                "", "ciento", "doscientos", "trescientos", "cuatrocientos",
                "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"
            };

            int hundred = number / 100;
            int rest = number % 100;

            if (rest == 0) return hundreds[hundred];
            return hundreds[hundred] + " " + IntToSpanish(rest);
        }

        if (number == 1000) return "mil";
        if (number < 2000) return "mil " + IntToSpanish(number % 1000);

        if (number < 1000000)
        {
            int thousands = number / 1000;
            int rest = number % 1000;

            string prefix = IntToSpanish(thousands) + " mil";
            if (rest == 0) return prefix;
            return prefix + " " + IntToSpanish(rest);
        }

        return number.ToString(CultureInfo.InvariantCulture);
    }

    // ----------------- CORS -----------------

    private static void ApplyCors(HttpContext context)
    {
        string origin = context.Request.Headers["Origin"];
        if (string.IsNullOrWhiteSpace(origin)) return;

        string configured = GetSetting("CorsAllowedOrigins");
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(configured))
        {
            string[] parts = configured.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
                allowed.Add(parts[i].Trim());
        }

        allowed.Add("http://localhost");
        allowed.Add("http://localhost:8084");
        allowed.Add("http://127.0.0.1");
        allowed.Add("http://127.0.0.1:8084");
        allowed.Add("https://desarrolloweb.aguascalientes.gob.mx");

        if (!allowed.Contains(origin)) return;

        context.Response.Headers["Access-Control-Allow-Origin"] = origin;
        context.Response.Headers["Vary"] = "Origin";
        context.Response.Headers["Access-Control-Allow-Credentials"] = "true";
        context.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, X-Api-Key";
        context.Response.Headers["Access-Control-Max-Age"] = "86400";
    }

    // ----------------- Helpers -----------------

    private static bool IsLocalRequest(HttpContext context)
    {
        if (context.Request.IsLocal) return true;

        string host = (context.Request.Url != null ? context.Request.Url.Host : "") ?? "";
        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.StartsWith("127.", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetSetting(string key)
    {
        return ConfigurationManager.AppSettings[key] ?? "";
    }

    private static string FirstNonEmpty(params string[] vals)
    {
        if (vals == null) return "";
        for (int i = 0; i < vals.Length; i++)
        {
            string v = vals[i];
            if (!string.IsNullOrWhiteSpace(v)) return v;
        }
        return "";
    }

    private static string ReadBody(HttpRequest request)
    {
        if (request == null || request.InputStream == null) return "";

        if (request.InputStream.CanSeek)
            request.InputStream.Position = 0;

        using (var sr = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8))
        {
            return sr.ReadToEnd();
        }
    }

    private static Dictionary<string, object> ParseJsonToDict(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var dict = Js.Deserialize<Dictionary<string, object>>(body);
            if (dict == null)
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            var ci = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in dict)
                ci[kv.Key] = kv.Value;

            return ci;
        }
        catch
        {
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string GetString(Dictionary<string, object> dict, string key)
    {
        if (dict == null || string.IsNullOrWhiteSpace(key)) return "";

        object val;
        if (!dict.TryGetValue(key, out val) || val == null) return "";

        return Convert.ToString(val) ?? "";
    }

    private static byte[] ReadAllBytes(Stream stream)
    {
        if (stream == null) return new byte[0];

        using (var ms = new MemoryStream())
        {
            byte[] buffer = new byte[81920];
            int read;
            while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                ms.Write(buffer, 0, read);

            return ms.ToArray();
        }
    }

    private static string ReadWebException(WebException ex)
    {
        if (ex == null) return "WebException desconocida.";
        if (ex.Response == null) return ex.Message;

        try
        {
            var http = ex.Response as HttpWebResponse;
            string status = http != null
                ? ((int)http.StatusCode).ToString() + " " + http.StatusCode.ToString()
                : "Sin HTTP status";

            using (var rs = ex.Response.GetResponseStream())
            using (var sr = new StreamReader(rs))
            {
                string body = sr.ReadToEnd();
                if (string.IsNullOrWhiteSpace(body)) return status;
                return status + " | " + body;
            }
        }
        catch
        {
            return ex.Message;
        }
    }

    private static void WriteAudio(HttpContext context, byte[] audioBytes, string mimeType)
    {
        if (audioBytes == null) audioBytes = new byte[0];

        context.Response.Clear();
        try { context.Response.TrySkipIisCustomErrors = true; } catch { }
        context.Response.StatusCode = 200;
        context.Response.ContentType = string.IsNullOrWhiteSpace(mimeType) ? "audio/mpeg" : mimeType;
        context.Response.BinaryWrite(audioBytes);
        context.Response.Flush();
    }

    private static void WriteJson(HttpContext context, int statusCode, object payload)
    {
        context.Response.Clear();
        try { context.Response.TrySkipIisCustomErrors = true; } catch { }
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentEncoding = Encoding.UTF8;
        context.Response.Write(Js.Serialize(payload));
        context.Response.Flush();
    }

    private static void SynthesizeWithLocalTtsStream(HttpContext context, string text, string lang)
    {
        string baseUrl = "http://localhost:8020/tts_stream";
        string langParam = string.IsNullOrWhiteSpace(lang) ? "es" : lang;
        string url = baseUrl + "?text=" + HttpUtility.UrlEncode(text) + "&language=" + langParam + "&speaker_wav=ania_referencia.wav";

        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "GET";
        req.Timeout = 120000;

        try
        {
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                context.Response.Clear();
                context.Response.StatusCode = 200;
                context.Response.ContentType = "audio/wav";
                context.Response.BufferOutput = false;

                using (var remoteStream = resp.GetResponseStream())
                {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while (remoteStream != null && (bytesRead = remoteStream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        if (!context.Response.IsClientConnected) break;
                        context.Response.OutputStream.Write(buffer, 0, bytesRead);
                        context.Response.OutputStream.Flush();
                    }
                }
            }
        }
        catch (System.Net.WebException wex)
        {
            context.Response.Clear();
            context.Response.StatusCode = 500;
            context.Response.ContentType = "text/plain";
            if (wex.Response != null)
            {
                using (var sr = new System.IO.StreamReader(wex.Response.GetResponseStream()))
                {
                    context.Response.Write("Error desde Python: " + sr.ReadToEnd());
                }
            }
            else
            {
                context.Response.Write("No hay conexión con Python: " + wex.Message);
            }
        }
        catch (Exception ex)
        {
            context.Response.Clear();
            context.Response.StatusCode = 500;
            context.Response.ContentType = "text/plain";
            context.Response.Write("Error interno C#: " + ex.Message);
        }
    }
}