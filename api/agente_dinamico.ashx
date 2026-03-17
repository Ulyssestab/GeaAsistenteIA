<%@ WebHandler Language="C#" Class="AgenteDinamico" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Web.Script.Serialization;

public class AgenteDinamico : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.Buffer = false;
        context.Response.BufferOutput = false;
        context.Response.Charset = "utf-8";
        context.Response.ContentEncoding = Encoding.UTF8;

        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

            string remoteUrl = GetSettingByEnvironment("RemoteUrlAgenteDinamico");

            if (string.IsNullOrWhiteSpace(remoteUrl))
            {
                WriteError(context, 500, "No está configurada la URL del agente dinámico.");
                return;
            }

            string requestBody;
            using (var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
            {
                requestBody = reader.ReadToEnd();
            }

            if (string.IsNullOrWhiteSpace(requestBody))
            {
                WriteError(context, 400, "El body llegó vacío al handler.");
                return;
            }

            var serializer = new JavaScriptSerializer();
            object payloadEntrada;

            try
            {
                payloadEntrada = serializer.DeserializeObject(requestBody);
            }
            catch (Exception ex)
            {
                WriteError(context, 400, "JSON inválido en el handler: " + ex.Message);
                return;
            }

            string pregunta = "";
            string sessionId = "";

            var dict = payloadEntrada as System.Collections.Generic.Dictionary<string, object>;

            if (dict != null)
            {
                if (dict.ContainsKey("input"))
                    pregunta = Convert.ToString(dict["input"]);

                if (string.IsNullOrWhiteSpace(pregunta) && dict.ContainsKey("pregunta"))
                    pregunta = Convert.ToString(dict["pregunta"]);

                if (string.IsNullOrWhiteSpace(pregunta) && dict.ContainsKey("message"))
                    pregunta = Convert.ToString(dict["message"]);

                if (string.IsNullOrWhiteSpace(pregunta) && dict.ContainsKey("mensaje"))
                    pregunta = Convert.ToString(dict["mensaje"]);

                if (dict.ContainsKey("session"))
                    sessionId = Convert.ToString(dict["session"]);

                if (string.IsNullOrWhiteSpace(sessionId) && dict.ContainsKey("sessionId"))
                    sessionId = Convert.ToString(dict["sessionId"]);
            }
            else if (payloadEntrada is string)
            {
                pregunta = Convert.ToString(payloadEntrada);
                sessionId = "CHAT_" + Guid.NewGuid().ToString("N");
            }
            else
            {
                WriteError(context, 400, "No se pudo interpretar el body recibido.");
                return;
            }

            if (string.IsNullOrWhiteSpace(pregunta))
            {
                WriteError(context, 400, "No llegó el texto de la pregunta.");
                return;
            }

            if (string.IsNullOrWhiteSpace(sessionId))
            {
                sessionId = "CHAT_" + Guid.NewGuid().ToString("N");
            }

            var payloadRemoto = new
            {
                agente = "tramites",
                pregunta = pregunta,
                prompt = "tramites-prompt_produccion",
                tools = new string[] { "TramitesTool" },
                prompt_result = 30,
                sessionId = sessionId
            };

            ForwardStreamingRequest(context, remoteUrl, payloadRemoto);
        }
        catch (WebException ex)
        {
            WriteRemoteWebException(context, ex);
        }
        catch (Exception ex)
        {
            WriteError(context, 500, "Error interno: " + ex.Message);
        }
    }

    private static void ForwardStreamingRequest(HttpContext context, string remoteUrl, object payload)
    {
        HttpResponse response = context.Response;

        var serializer = new JavaScriptSerializer();
        string jsonPayload = serializer.Serialize(payload);
        byte[] payloadBytes = Encoding.UTF8.GetBytes(jsonPayload);

        var req = (HttpWebRequest)WebRequest.Create(remoteUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Accept = "text/plain, application/json, text/event-stream, */*";

        // Configuración para streaming
        req.AllowReadStreamBuffering = false;
        req.AllowWriteStreamBuffering = true;
        req.KeepAlive = true;
        req.ProtocolVersion = HttpVersion.Version11;
        req.SendChunked = false;

        req.Timeout = 1000 * 60 * 10;
        req.ReadWriteTimeout = 1000 * 60 * 10;
        req.Proxy = null;
        req.ContentLength = payloadBytes.Length;

        // AUTH BASIC
        string apiUser = GetSettingByEnvironment("ApiUserAgenteDinamico");
        string apiPass = GetSettingByEnvironment("ApiPassAgenteDinamico");

        if (!string.IsNullOrWhiteSpace(apiUser))
        {
            string basic = Convert.ToBase64String(Encoding.UTF8.GetBytes(apiUser + ":" + (apiPass ?? "")));
            req.Headers[HttpRequestHeader.Authorization] = "Basic " + basic;
        }

        using (Stream reqStream = req.GetRequestStream())
        {
            reqStream.Write(payloadBytes, 0, payloadBytes.Length);
            reqStream.Flush();
        }

        using (var remoteRes = (HttpWebResponse)req.GetResponse())
        using (Stream remoteStream = remoteRes.GetResponseStream())
        {
            response.Clear();
            response.StatusCode = (int)remoteRes.StatusCode;
            response.Buffer = false;
            response.BufferOutput = false;
            response.Charset = "utf-8";
            response.ContentEncoding = Encoding.UTF8;

            string remoteContentType = remoteRes.ContentType;
            if (string.IsNullOrWhiteSpace(remoteContentType))
                remoteContentType = "text/plain; charset=utf-8";

            response.ContentType = remoteContentType;
            response.Headers["Cache-Control"] = "no-cache";
            response.Headers["X-Accel-Buffering"] = "no";

            byte[] buffer = new byte[4096];
            int bytesRead;

            while (remoteStream != null && (bytesRead = remoteStream.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (!response.IsClientConnected)
                    break;

                response.OutputStream.Write(buffer, 0, bytesRead);
                response.OutputStream.Flush();

                try
                {
                    response.Flush();
                }
                catch
                {
                    break;
                }
            }
        }
    }

    private static string GetSettingByEnvironment(string key)
    {
        string host = (HttpContext.Current.Request.Url.Host ?? "").ToLowerInvariant();

        bool isLocal =
            host.Contains("localhost") ||
            host.Contains("127.0.0.1") ||
            host == "::1";

        string fullKey = key + (isLocal ? ".Local" : ".Prod");
        return ConfigurationManager.AppSettings[fullKey];
    }

    private static void WriteRemoteWebException(HttpContext context, WebException ex)
    {
        string remoteBody = "";
        int remoteStatus = 500;
        string remoteStatusText = "Error remoto";

        if (ex.Response != null)
        {
            try
            {
                var httpResp = (HttpWebResponse)ex.Response;
                remoteStatus = (int)httpResp.StatusCode;
                remoteStatusText = httpResp.StatusDescription;

                using (var sr = new StreamReader(httpResp.GetResponseStream(), Encoding.UTF8))
                {
                    remoteBody = sr.ReadToEnd();
                }
            }
            catch
            {
                remoteBody = ex.Message;
            }
        }
        else
        {
            remoteBody = ex.Message;
        }

        context.Response.Clear();
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json; charset=utf-8";

        string json = "{"
            + "\"error\":\"Error remoto\","
            + "\"statusRemoto\":" + remoteStatus + ","
            + "\"statusTexto\":\"" + JsonEscape(remoteStatusText) + "\","
            + "\"detalle\":\"" + JsonEscape(remoteBody) + "\""
            + "}";

        context.Response.Write(json);
    }

    private static void WriteError(HttpContext context, int statusCode, string message)
    {
        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Write("{\"error\":\"" + JsonEscape(message) + "\"}");
    }

    private static string JsonEscape(string value)
    {
        if (string.IsNullOrEmpty(value))
            return "";

        return value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }

    public bool IsReusable
    {
        get { return false; }
    }
}