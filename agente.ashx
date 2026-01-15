<%@ WebHandler Language="C#" Class="AgenteProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;

public class AgenteProxy : IHttpHandler
{
    // ✅ Servicio real (eservicios2)
    private const string RemoteUrl = "https://eservicios2.aguascalientes.gob.mx/geawsns/api/gea/ptl/ws/agente";

    // ✅ Credenciales (ya NO estarán en tu widget)
    private const string User = "apipgea";
    private const string Pass = "7BD%k8u9@=";

    public void ProcessRequest(HttpContext context)
    {
        // ✅ Solo POST
        if (context.Request.HttpMethod != "POST")
        {
            context.Response.StatusCode = 405;
            context.Response.End();
            return;
        }

        // ✅ Opcional: Forzar TLS 1.2 por compatibilidad
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

        // Leer el JSON que manda el widget
        string body;
        using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
            body = reader.ReadToEnd();

        var req = (HttpWebRequest)WebRequest.Create(RemoteUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";

        // Basic Auth hacia el servicio real
        var token = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{User}:{Pass}"));
        req.Headers["Authorization"] = "Basic " + token;

        using (var sw = new StreamWriter(req.GetRequestStream()))
            sw.Write(body);

        try
        {
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream()))
            {
                var responseBody = sr.ReadToEnd();
                context.Response.StatusCode = (int)resp.StatusCode;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.Write(responseBody);
            }
        }
        catch (WebException ex)
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Proxy error\",\"detail\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}");
        }
    }

    public bool IsReusable => true;
}
