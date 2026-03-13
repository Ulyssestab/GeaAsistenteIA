<%@ WebHandler Language="C#" Class="AgenteMcpProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Web.SessionState;

/// <summary>
/// Proxy para ws/agentemcp (conversación con "session").
/// - Recibe desde el front un JSON con { session, input }.
/// - Si llega texto plano o {message:"..."}, lo convierte a { session, input } usando SessionID del servidor como fallback.
/// - Agrega Authorization Basic usando credenciales desde web.config.
/// </summary>
public class AgenteMcpProxy : IHttpHandler, IRequiresSessionState
{
    public void ProcessRequest(HttpContext context)
    {
        if (context.Request.HttpMethod == "GET")
        {
            context.Response.ContentType = "text/plain";
            context.Response.Write("OK - Proxy MCP activo. Usa POST.");
            return;
        }

        if (context.Request.HttpMethod != "POST")
        {
            context.Response.StatusCode = 405;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Method Not Allowed\"}");
            return;
        }

        // TLS 1.2
        try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }

        bool isLocal = context.Request.IsLocal ||
                       context.Request.Url.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                       context.Request.Url.Host.StartsWith("127.");

        // Permite llaves dedicadas para MCP; si no existen, cae a las llaves actuales.
        string remoteUrl = PickSetting(isLocal ? "RemoteUrlMcp.Local" : "RemoteUrlMcp.Prod",
                                       isLocal ? "RemoteUrl.Local"    : "RemoteUrl.Prod");

        string user      = PickSetting(isLocal ? "ApiUserMcp.Local" : "ApiUserMcp.Prod",
                                       isLocal ? "ApiUser.Local"    : "ApiUser.Prod");

        string pass      = PickSetting(isLocal ? "ApiPassMcp.Local" : "ApiPassMcp.Prod",
                                       isLocal ? "ApiPass.Local"    : "ApiPass.Prod");

        if (string.IsNullOrWhiteSpace(remoteUrl))
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Configuración faltante: RemoteUrlMcp/RemoteUrl\"}");
            return;
        }

        string body;
        using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
            body = reader.ReadToEnd();

        string normalizedBody = NormalizeToMcp(body, context);

        var req = (HttpWebRequest)WebRequest.Create(remoteUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Timeout = 30000;

        if (!string.IsNullOrWhiteSpace(user))
        {
            string basic = Convert.ToBase64String(Encoding.ASCII.GetBytes(user + ":" + (pass ?? "")));
            req.Headers["Authorization"] = "Basic " + basic;
        }

        using (var sw = new StreamWriter(req.GetRequestStream()))
            sw.Write(normalizedBody);

        try
        {
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream()))
            {
                string responseBody = sr.ReadToEnd();
                context.Response.StatusCode = (int)resp.StatusCode;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.Write(responseBody);
            }
        }
        catch (WebException ex)
        {
            string detail = ex.Message;
            if (ex.Response != null)
            {
                try
                {
                    using (var rs = ex.Response.GetResponseStream())
                    using (var r = new StreamReader(rs))
                        detail = r.ReadToEnd();
                }
                catch { }
            }

            context.Response.StatusCode = 502;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Proxy error\",\"detail\":" + Json(detail) + "}");
        }
    }

    private static string PickSetting(string keyPreferred, string keyFallback)
    {
        string v = ConfigurationManager.AppSettings[keyPreferred];
        if (!string.IsNullOrWhiteSpace(v)) return v;
        return ConfigurationManager.AppSettings[keyFallback] ?? "";
    }

    private static string NormalizeToMcp(string body, HttpContext ctx)
    {
        string t = (body ?? "").Trim();
        var js = new JavaScriptSerializer();

        // Session fallback (misma sesión http del navegador)
        string fallbackSession = null;
        try { fallbackSession = ctx.Session != null ? ctx.Session.SessionID : null; } catch { }
        if (string.IsNullOrWhiteSpace(fallbackSession))
            fallbackSession = Guid.NewGuid().ToString("N");

        string session = null;
        string input = null;

        if (string.IsNullOrWhiteSpace(t))
        {
            session = fallbackSession;
            input = "";
            return js.Serialize(new Dictionary<string, object> { { "session", session }, { "input", input } });
        }

        // 1) Si ya es JSON, intentamos interpretar
        try
        {
            var obj = js.DeserializeObject(t);

            // "hola" (JSON string)
            if (obj is string)
            {
                session = fallbackSession;
                input = (string)obj;
            }
            else
            {
                var dict = obj as Dictionary<string, object>;
                if (dict != null)
                {
                    // session
                    if (dict.ContainsKey("session")) session = Convert.ToString(dict["session"] ?? "");
                    if (string.IsNullOrWhiteSpace(session)) session = fallbackSession;

                    // input (prioridad)
                    if (dict.ContainsKey("input")) input = Convert.ToString(dict["input"] ?? "");

                    // compatibilidad con front viejo
                    if (string.IsNullOrWhiteSpace(input) && dict.ContainsKey("message")) input = Convert.ToString(dict["message"] ?? "");
                    if (string.IsNullOrWhiteSpace(input) && dict.ContainsKey("text")) input = Convert.ToString(dict["text"] ?? "");
                    if (string.IsNullOrWhiteSpace(input) && dict.ContainsKey("query")) input = Convert.ToString(dict["query"] ?? "");
                }
            }
        }
        catch
        {
            // 2) Texto plano no-JSON
            session = fallbackSession;
            input = t;
        }

        session = session ?? fallbackSession;
        input = input ?? "";

        var payload = new Dictionary<string, object> {
            { "session", session },
            { "input", input }
        };

        return js.Serialize(payload);
    }

    private static string Json(string s)
    {
        return new JavaScriptSerializer().Serialize(s ?? "");
    }

    public bool IsReusable { get { return true; } }
}
