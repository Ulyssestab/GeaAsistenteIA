<%@ WebHandler Language="C#" Class="AgenteProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Configuration;
using System.Collections.Generic;
using System.Web.Script.Serialization;

public class AgenteProxy : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (context.Request.HttpMethod == "GET")
        {
            context.Response.ContentType = "text/plain";
            context.Response.Write("OK - Proxy activo. Usa POST.");
            return;
        }

        if (context.Request.HttpMethod != "POST")
        {
            context.Response.StatusCode = 405;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Method Not Allowed\"}");
            return;
        }

        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        }
        catch { }

        bool isLocal = context.Request.IsLocal ||
                       context.Request.Url.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                       context.Request.Url.Host.StartsWith("127.");

        string remoteUrl = GetSetting(isLocal ? "RemoteUrl.Local" : "RemoteUrl.Prod");
        string user      = GetSetting(isLocal ? "ApiUser.Local" : "ApiUser.Prod");
        string pass      = GetSetting(isLocal ? "ApiPass.Local" : "ApiPass.Prod");

        if (string.IsNullOrWhiteSpace(remoteUrl))
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Configuración faltante: RemoteUrl\"}");
            return;
        }

        string body;
        using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
            body = reader.ReadToEnd();

        // Acepta:
        // 1) "hola"
        // 2) {"message":"hola"}
        string normalizedBody = NormalizeBody(body);

        var req = (HttpWebRequest)WebRequest.Create(remoteUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.Timeout = 30000;

        if (!string.IsNullOrWhiteSpace(user))
        {
            string basic = Convert.ToBase64String(Encoding.ASCII.GetBytes(user + ":" + pass));
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
                context.Response.Write(responseBody); // ejemplo: {"output":"..."}
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

    private static string GetSetting(string key)
    {
        return ConfigurationManager.AppSettings[key] ?? "";
    }

    private static string NormalizeBody(string body)
    {
        string t = (body ?? "").Trim();
        if (string.IsNullOrEmpty(t)) return "\"\"";

        // Si ya es string JSON: "hola"
        if (t.StartsWith("\"")) return t;

        // Si viene objeto con message
        try
        {
            var js = new JavaScriptSerializer();
            var dict = js.Deserialize<Dictionary<string, object>>(t);
            if (dict != null && dict.ContainsKey("message"))
            {
                string msg = Convert.ToString(dict["message"] ?? "");
                return js.Serialize(msg);
            }
        }
        catch { }

        // fallback: manda lo que llegó
        return t;
    }

    private static string Json(string s)
    {
        return new JavaScriptSerializer().Serialize(s ?? "");
    }

    public bool IsReusable { get { return true; } }
}
