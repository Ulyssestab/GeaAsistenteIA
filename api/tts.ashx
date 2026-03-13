<%@ WebHandler Language="C#" Class="TtsProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Collections.Generic;
using System.Web.Script.Serialization;

public class TtsProxy : IHttpHandler
{
    private static readonly JavaScriptSerializer Js = new JavaScriptSerializer();

    public void ProcessRequest(HttpContext context)
    {
        // Evita que IIS reemplace nuestro JSON con páginas HTML 5xx/4xx
        try { context.Response.TrySkipIisCustomErrors = true; } catch { }
        try { context.Response.BufferOutput = true; } catch { }

        // TLS 1.2 (importante para ElevenLabs en .NET Framework)
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
                WriteJson(context, 400, new { error = "Texto vacío", detail = "Envia { text: \"...\" }" });
                return;
            }

            // Default cambiado a ElevenLabs
            if (string.IsNullOrWhiteSpace(provider))
                provider = "elevenlabs";

            // Alias útiles
            if (provider == "eleven") provider = "elevenlabs";

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

            if (provider != "elevenlabs")
            {
                WriteJson(context, 400, new
                {
                    error = "Proveedor no soportado",
                    detail = "Este endpoint soporta provider: elevenlabs | browser"
                });
                return;
            }

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
                    detail = "Faltan ElevenLabsApiKey.* y/o ElevenVoiceId.*",
                    provider = provider,
                    isLocal = isLocal
                });
                return;
            }

            byte[] audioBytes = SynthesizeWithElevenLabs(text, apiKey, voiceId, modelId);
            WriteAudio(context, audioBytes, "audio/mpeg");
        }
        catch (WebException ex)
        {
            // OJO: si devolvemos 502, IIS/ARR suele mostrar página HTML genérica.
            // Por eso mantenemos 500 para depuración y detalle JSON.
            string detail = ReadWebException(ex);
            WriteJson(context, 500, new
            {
                error = "Error llamando proveedor TTS",
                detail = detail,
                hint = "Revisa salida a api.elevenlabs.io, API key, Voice ID y firewall/proxy del servidor."
            });
        }
        catch (Exception ex)
        {
            WriteJson(context, 500, new { error = "Error interno", detail = ex.Message });
        }
    }

    public bool IsReusable { get { return true; } }

    // ----------------- TTS Providers -----------------

    private static byte[] SynthesizeWithElevenLabs(string text, string apiKey, string voiceId, string modelId)
    {
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
        req.UserAgent = "GeaAsistenteHub-TTS";
        req.Timeout = 60000;
        req.ReadWriteTimeout = 60000;

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
            return sr.ReadToEnd();
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

            // Normaliza a case-insensitive por seguridad
            var ci = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in dict) ci[kv.Key] = kv.Value;
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
            string status = http != null ? ((int)http.StatusCode).ToString() + " " + http.StatusCode.ToString() : "Sin HTTP status";

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
}
