<%@ WebHandler Language="C#" Class="AgenteProxy" %>

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Web;

public class AgenteProxy : IHttpHandler
{
    private const string RemoteUrl = "https://eservicios2.aguascalientes.gob.mx/geawsns/api/gea/ptl/ws/agente";
    private const string User = "apipgea";
    private const string Pass = "7BD%k8u9@=";

    public void ProcessRequest(HttpContext context)
    {
        // ✅ Para probar en navegador (GET)
        if (context.Request.HttpMethod == "GET")
        {
            context.Response.ContentType = "text/plain";
            context.Response.Write("OK - Proxy activo. Usa POST.");
            return;
        }

        // ✅ Solo POST para el widget
        if (context.Request.HttpMethod != "POST")
        {
            context.Response.StatusCode = 405;
            context.Response.End();
            return;
        }

        // ✅ TLS 1.2 compatible con servidores viejos
        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        }
        catch { }

        string body = "";
        using (StreamReader reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
        {
            body = reader.ReadToEnd();
        }

        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(RemoteUrl);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";

        string basic = Convert.ToBase64String(Encoding.ASCII.GetBytes(string.Format("{0}:{1}", User, Pass)));
        req.Headers["Authorization"] = "Basic " + basic;

        using (StreamWriter sw = new StreamWriter(req.GetRequestStream()))
        {
            sw.Write(body);
        }

        try
        {
            HttpWebResponse resp = (HttpWebResponse)req.GetResponse();
            string responseBody = "";

            using (StreamReader sr = new StreamReader(resp.GetResponseStream()))
            {
                responseBody = sr.ReadToEnd();
            }

            context.Response.StatusCode = (int)resp.StatusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write(responseBody);
        }
        catch (WebException ex)
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Write("{\"error\":\"Proxy error\",\"detail\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}");
        }
    }

    public bool IsReusable
    {
        get { return true; }
    }
}
