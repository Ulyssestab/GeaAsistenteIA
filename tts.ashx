<%@ WebHandler Language="C#" Class="TtsProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Security;

public class TtsProxy : IHttpHandler
{
    private static readonly JavaScriptSerializer Js = new JavaScriptSerializer();

    public void ProcessRequest(HttpContext context)
    {
        // TLS 1.2
        try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }

        ApplyCors(context);

        // Preflight CORS
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
            context.Response.Write("OK - TTS proxy activo. Usa POST.");
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

            string text = GetString(payload, "text");
            string provider = (GetString(payload, "provider") ?? "").Trim().ToLowerInvariant();
            string lang = GetString(payload, "lang");
            string azureVoiceFromBody = GetString(payload, "azureVoice");
            string elevenVoiceFromBody = GetString(payload, "elevenVoiceId");

            // Permite provider por querystring también
            if (string.IsNullOrWhiteSpace(provider))
                provider = (context.Request["provider"] ?? "").Trim().ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(text))
            {
                WriteJson(context, 400, new { error = "Texto vacío", detail = "Envia { text: \"...\" }" });
                return;
            }

            if (string.IsNullOrWhiteSpace(provider))
                provider = "azure"; // default server-side (puedes cambiarlo)

            byte[] audioBytes;

            switch (provider)
            {
                case "azure":
                    {
                        string key = GetSetting(isLocal ? "AzureSpeechKey.Local" : "AzureSpeechKey.Prod");
                        string region = GetSetting(isLocal ? "AzureSpeechRegion.Local" : "AzureSpeechRegion.Prod");
                        string defaultVoice = GetSetting(isLocal ? "AzureVoice.Local" : "AzureVoice.Prod");
                        string voice = !string.IsNullOrWhiteSpace(azureVoiceFromBody) ? azureVoiceFromBody :
                                       (!string.IsNullOrWhiteSpace(defaultVoice) ? defaultVoice : "es-MX-DaliaNeural");

                        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(region))
                        {
                            WriteJson(context, 500, new
                            {
                                error = "Configuración faltante Azure",
                                detail = "Faltan AzureSpeechKey.* y/o AzureSpeechRegion.*"
                            });
                            return;
                        }

                        audioBytes = SynthesizeWithAzure(text, key, region, voice, string.IsNullOrWhiteSpace(lang) ? "es-MX" : lang);
                        WriteAudio(context, audioBytes, "audio/mpeg");
                        return;
                    }

                case "elevenlabs":
                case "eleven":
                    {
                        string apiKey = GetSetting(isLocal ? "ElevenLabsApiKey.Local" : "ElevenLabsApiKey.Prod");
                        string defaultVoiceId = GetSetting(isLocal ? "ElevenVoiceId.Local" : "ElevenVoiceId.Prod");
                        string modelId = GetSetting(isLocal ? "ElevenModelId.Local" : "ElevenModelId.Prod");
                        if (string.IsNullOrWhiteSpace(modelId)) modelId = "eleven_multilingual_v2";

                        string voiceId = !string.IsNullOrWhiteSpace(elevenVoiceFromBody) ? elevenVoiceFromBody : defaultVoiceId;

                        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(voiceId))
                        {
                            WriteJson(context, 500, new
                            {
                                error = "Configuración faltante ElevenLabs",
                                detail = "Faltan ElevenLabsApiKey.* y/o ElevenVoiceId.*"
                            });
                            return;
                        }

                        audioBytes = SynthesizeWithElevenLabs(text, apiKey, voiceId, modelId);
                        WriteAudio(context, audioBytes, "audio/mpeg");
                        return;
                    }

                case "browser":
                    // Normalmente el browser TTS no pega a este endpoint.
                    WriteJson(context, 200, new
                    {
                        ok = true,
                        provider = "browser",
                        detail = "Para browser TTS el audio se genera en el cliente."
                    });
                    return;

                default:
                    WriteJson(context, 400, new
                    {
                        error = "Proveedor no soportado",
                        detail = "Usa provider: azure | elevenlabs | browser"
                    });
                    return;
            }
        }
        catch (WebException ex)
        {
            string detail = ReadWebException(ex);
            WriteJson(context, 502, new { error = "Error llamando proveedor TTS", detail = detail });
        }
        catch (Exception ex)
        {
            WriteJson(context, 500, new { error = "Error interno", detail = ex.Message });
        }
    }

    public bool IsReusable { get { return true; } }

    // ----------------- TTS Providers -----------------

    private static byte[] SynthesizeWithAzure(string text, string key, string region, string voice, string lang)
    {
        string url = "https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1";

        string safeText = SecurityElement.Escape(text) ?? "";
        string safeLang = SecurityElement.Escape(lang) ?? "es-MX";
        string safeVoice = SecurityElement.Escape(voice) ?? "es-MX-DaliaNeural";

        string ssml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                    + "<speak version=\"1.0\" xml:lang=\"" + safeLang + "\">"
                    +   "<voice xml:lang=\"" + safeLang + "\" name=\"" + safeVoice + "\">"
                    +      safeText
                    +   "</voice>"
                    + "</speak>";

        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/ssml+xml";
        req.Headers["Ocp-Apim-Subscription-Key"] = key;
        req.Headers["X-Microsoft-OutputFormat"] = "audio-24khz-48kbitrate-mono-mp3";
        req.UserAgent = "GeaAsistenteHub-TTS";   // <-- CORRECTO
        req.Timeout = 60000;

        byte[] bytes = Encoding.UTF8.GetBytes(ssml);
        using (var rs = req.GetRequestStream())
            rs.Write(bytes, 0, bytes.Length);

        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var stream = resp.GetResponseStream())
            return ReadAllBytes(stream);
    }

    private static byte[] SynthesizeWithElevenLabs(string text, string apiKey, string voiceId, string modelId)
    {
        // Puedes ajustar output_format si quieres otro bitrate
        string url = "https://api.elevenlabs.io/v1/text-to-speech/" + HttpUtility.UrlEncode(voiceId) + "?output_format=mp3_44100_128";

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

        string json = Js.Serialize(payload);

        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Accept = "audio/mpeg";
        req.Headers["xi-api-key"] = apiKey;
        req.Timeout = 60000;

        byte[] data = Encoding.UTF8.GetBytes(json);
        using (var rs = req.GetRequestStream())
            rs.Write(data, 0, data.Length);

        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var stream = resp.GetResponseStream())
            return ReadAllBytes(stream);
    }

    // ----------------- CORS -----------------

    private static void ApplyCors(HttpContext context)
    {
        string origin = context.Request.Headers["Origin"];
        if (string.IsNullOrWhiteSpace(origin)) return;

        // Lista desde config: "http://localhost:8084,https://desarrolloweb.aguascalientes.gob.mx"
        string configured = GetSetting("CorsAllowedOrigins");
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(configured))
        {
            string[] parts = configured.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
                allowed.Add(parts[i].Trim());
        }

        // Defaults útiles para local/prod
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

    private static string ReadBody(HttpRequest request)
    {
        request.InputStream.Position = 0;
        using (var sr = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8))
            return sr.ReadToEnd();
    }

    private static Dictionary<string, object> ParseJsonToDict(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var dict = Js.Deserialize<Dictionary<string, object>>(body);
            return dict ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
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
            stream.CopyTo(ms);
            return ms.ToArray();
        }
    }

    private static string ReadWebException(WebException ex)
    {
        if (ex == null) return "WebException desconocida.";
        if (ex.Response == null) return ex.Message;

        try
        {
            using (var rs = ex.Response.GetResponseStream())
            using (var sr = new StreamReader(rs))
                return sr.ReadToEnd();
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
        context.Response.StatusCode = 200;
        context.Response.ContentType = string.IsNullOrWhiteSpace(mimeType) ? "audio/mpeg" : mimeType;
        context.Response.BinaryWrite(audioBytes);
        context.Response.Flush();
    }

    private static void WriteJson(HttpContext context, int statusCode, object payload)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentEncoding = Encoding.UTF8;
        context.Response.Write(Js.Serialize(payload));
    }
}

