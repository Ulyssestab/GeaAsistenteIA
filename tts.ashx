<%@ WebHandler Language="C#" Class="TtsProxy" %>

using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public class TtsProxy : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        // ✅ GET para prueba rápida en navegador
        if (context.Request.HttpMethod == "GET")
        {
            context.Response.ContentType = "text/plain; charset=utf-8";
            context.Response.Write("OK - TTS proxy activo. Usa POST JSON.");
            return;
        }

        // ✅ Solo POST
        if (context.Request.HttpMethod != "POST")
        {
            context.Response.StatusCode = 405;
            context.Response.End();
            return;
        }

        // ✅ TLS 1.2 (útil en servidores viejos)
        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        }
        catch { }

        // Leer JSON
        string body;
        using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
            body = reader.ReadToEnd();

        Dictionary<string, object> req;
        try
        {
            req = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(body);
        }
        catch
        {
            WriteJsonError(context, 400, "Invalid JSON", "El body debe ser JSON válido.");
            return;
        }

        string text = GetStr(req, "text");
        string provider = (GetStr(req, "provider") ?? "").Trim().ToLowerInvariant();
        string lang = (GetStr(req, "lang") ?? "es-MX").Trim();
        string voice = (GetStr(req, "voice") ?? "").Trim();

        if (string.IsNullOrWhiteSpace(text))
        {
            WriteJsonError(context, 400, "Missing text", "Falta el campo 'text'.");
            return;
        }

        // Limitar tamaño para evitar abuso
        if (text.Length > 4000) text = text.Substring(0, 4000);

        if (string.IsNullOrWhiteSpace(provider))
            provider = (ConfigurationManager.AppSettings["TtsDefaultProvider"] ?? "azure").Trim().ToLowerInvariant();

        // "browser" se maneja en el cliente (speechSynthesis)
        if (provider == "browser")
        {
            WriteJsonError(context, 400, "Provider browser", "El proveedor 'browser' se ejecuta en el cliente. Usa 'azure' o 'elevenlabs'.");
            return;
        }

        try
        {
            if (provider == "azure")
            {
                ProxyAzure(context, text, lang, voice);
                return;
            }

            if (provider == "elevenlabs")
            {
                ProxyElevenLabs(context, text, lang, voice);
                return;
            }

            WriteJsonError(context, 400, "Unknown provider", "Provider soportados: azure | elevenlabs | browser.");
        }
        catch (WebException wex)
        {
            string upstream = ReadWebExceptionBody(wex);
            WriteJsonError(context, 502, "Upstream error", wex.Message + (string.IsNullOrWhiteSpace(upstream) ? "" : " | " + upstream));
        }
        catch (Exception ex)
        {
            WriteJsonError(context, 500, "Server error", ex.Message);
        }
    }

    // ---------------------------
    // Azure Speech TTS (REST)
    // ---------------------------
    private static void ProxyAzure(HttpContext context, string text, string lang, string voiceOverride)
    {
        string region = (ConfigurationManager.AppSettings["AzureSpeechRegion"] ?? "").Trim();
        string key = (ConfigurationManager.AppSettings["AzureSpeechKey"] ?? "").Trim();
        string voice = !string.IsNullOrWhiteSpace(voiceOverride)
            ? voiceOverride
            : (ConfigurationManager.AppSettings["AzureVoice"] ?? "es-MX-DaliaNeural").Trim();

        if (string.IsNullOrWhiteSpace(region) || string.IsNullOrWhiteSpace(key))
            throw new Exception("AzureSpeechRegion/AzureSpeechKey no configurados en web.config.");

        string url = "https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1";

        // SSML mínimo
        string ssml =
            "<speak version='1.0' xml:lang='" + HttpUtility.HtmlAttributeEncode(lang) + "'>" +
            "<voice xml:lang='" + HttpUtility.HtmlAttributeEncode(lang) + "' name='" + HttpUtility.HtmlAttributeEncode(voice) + "'>" +
            HttpUtility.HtmlEncode(text) +
            "</voice></speak>";

        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/ssml+xml; charset=utf-8";
        req.Accept = "audio/mpeg";
        req.Headers["Ocp-Apim-Subscription-Key"] = key;

        // MP3 mono 16khz (balance calidad/peso)
        req.Headers["X-Microsoft-OutputFormat"] = "audio-16khz-32kbitrate-mono-mp3";

        using (var sw = new StreamWriter(req.GetRequestStream(), Encoding.UTF8))
            sw.Write(ssml);

        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var rs = resp.GetResponseStream())
        {
            context.Response.StatusCode = (int)resp.StatusCode;
            context.Response.ContentType = "audio/mpeg";
            rs.CopyTo(context.Response.OutputStream);
        }
    }

    // ---------------------------
    // ElevenLabs TTS (REST)
    // ---------------------------
    private static void ProxyElevenLabs(HttpContext context, string text, string lang, string voiceOverride)
    {
        string apiKey = (ConfigurationManager.AppSettings["ElevenLabsApiKey"] ?? "").Trim();
        string voiceId = !string.IsNullOrWhiteSpace(voiceOverride)
            ? voiceOverride
            : (ConfigurationManager.AppSettings["ElevenLabsVoiceId"] ?? "").Trim();

        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(voiceId))
            throw new Exception("ElevenLabsApiKey/ElevenLabsVoiceId no configurados en web.config.");

        // Puedes ajustar output_format según tu gusto (mp3_44100_128 es buena calidad/peso)
        string url = "https://api.elevenlabs.io/v1/text-to-speech/" + Uri.EscapeDataString(voiceId) + "?output_format=mp3_44100_128";

        // Modelo recomendado multilenguaje
        var payload = new Dictionary<string, object>
        {
            { "text", text },
            { "model_id", (ConfigurationManager.AppSettings["ElevenLabsModelId"] ?? "eleven_multilingual_v2").Trim() }
        };

        string json = new JavaScriptSerializer().Serialize(payload);

        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Accept = "audio/mpeg";
        req.Headers["xi-api-key"] = apiKey;

        using (var sw = new StreamWriter(req.GetRequestStream(), Encoding.UTF8))
            sw.Write(json);

        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var rs = resp.GetResponseStream())
        {
            context.Response.StatusCode = (int)resp.StatusCode;
            context.Response.ContentType = "audio/mpeg";
            rs.CopyTo(context.Response.OutputStream);
        }
    }

    // ---------------------------
    // Helpers
    // ---------------------------
    private static string GetStr(Dictionary<string, object> d, string key)
    {
        if (d == null || string.IsNullOrWhiteSpace(key)) return null;
        object v;
        if (!d.TryGetValue(key, out v) || v == null) return null;
        return v.ToString();
    }

    private static void WriteJsonError(HttpContext context, int status, string error, string detail)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";

        string safeError = (error ?? "").Replace("\"", "\\\"");
        string safeDetail = (detail ?? "").Replace("\"", "\\\"");

        context.Response.Write("{\"error\":\"" + safeError + "\",\"detail\":\"" + safeDetail + "\"}");
    }

    private static string ReadWebExceptionBody(WebException wex)
    {
        try
        {
            var resp = wex.Response as HttpWebResponse;
            if (resp == null) return null;

            using (var s = resp.GetResponseStream())
            using (var sr = new StreamReader(s))
                return sr.ReadToEnd();
        }
        catch { return null; }
    }

    public bool IsReusable { get { return true; } }
}
