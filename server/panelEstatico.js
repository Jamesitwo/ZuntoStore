// El panel (build de Vite) servido por el MISMO servidor, para publicar todo
// en un solo servicio (Railway): un dominio, sin CORS entre servicios.
//
//   /api/...  -> la API (servidor.js, no pasa por aqui)
//   /b/...    -> se reenvia a LucidSales (lo mismo que hace el proxy de Vite)
//   /assets/… -> archivos del build (cache larga: llevan hash en el nombre)
//   lo demas  -> index.html (rutas del panel: /pedidos, /anuncios, ...)
//
// Solo se activa si existe PANEL_DIR con un index.html.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

// cabeceras que no se reenvian (de salto a salto o que fetch maneja solo)
const SALTO = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection",
  "te", "trailer", "content-length", "accept-encoding", "origin", "referer", "cookie",
]);
const SALTO_RESPUESTA = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie"]);

/**
 * @param {{ dir: string, lucidOrigen?: string, fetchImpl?: typeof fetch, log?: Console }} opts
 * @returns {null | { manejar(req, res, ruta): Promise<boolean> }}
 */
export function crearPanelEstatico({ dir, lucidOrigen = "https://panel.lucidsales.co", fetchImpl = fetch, log = console } = {}) {
  if (!dir) return null;
  const raiz = path.resolve(dir);
  const indice = path.join(raiz, "index.html");
  if (!fs.existsSync(indice)) {
    log.warn?.(`[panel] PANEL_DIR=${dir} no tiene index.html: el panel no se sirve`);
    return null;
  }
  const origenLucid = String(lucidOrigen).replace(/\/+$/, "");

  function enviarArchivo(res, archivo, { cacheLarga = false, head = false } = {}) {
    const tipo = TIPOS[path.extname(archivo).toLowerCase()] ?? "application/octet-stream";
    const tam = fs.statSync(archivo).size;
    res.writeHead(200, {
      "content-type": tipo,
      "content-length": tam,
      "cache-control": cacheLarga ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (head) return res.end();
    fs.createReadStream(archivo).pipe(res);
  }

  async function reenviarLucid(req, res, url) {
    const destino = `${origenLucid}${url.pathname}${url.search}`;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!SALTO.has(k.toLowerCase()) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    const conCuerpo = !["GET", "HEAD"].includes(req.method ?? "GET");
    let r;
    try {
      r = await fetchImpl(destino, {
        method: req.method,
        headers,
        body: conCuerpo ? req : undefined,
        duplex: conCuerpo ? "half" : undefined,
        redirect: "manual",
        // subir archivos (videos) puede tardar mas que una llamada normal
        signal: AbortSignal.timeout(/multipart\/form-data/i.test(String(req.headers["content-type"] ?? "")) ? 300000 : 60000),
      });
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, msg: `No se pudo conectar con LucidSales: ${e?.message ?? e}` }));
      return;
    }
    const salida = {};
    r.headers.forEach((v, k) => {
      if (!SALTO_RESPUESTA.has(k.toLowerCase())) salida[k] = v;
    });
    res.writeHead(r.status, salida);
    if (!r.body || req.method === "HEAD") return res.end();
    Readable.fromWeb(r.body).pipe(res);
  }

  return {
    dir: raiz,
    /** true si la peticion era del panel (ya respondida); false si es de la API. */
    async manejar(req, res, url) {
      const ruta = url.pathname;
      if (ruta === "/api" || ruta.startsWith("/api/")) return false;
      if (ruta === "/b" || ruta.startsWith("/b/")) {
        await reenviarLucid(req, res, url);
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      const head = req.method === "HEAD";
      let rel;
      try {
        rel = decodeURIComponent(ruta);
      } catch {
        rel = ruta;
      }
      const archivo = path.resolve(raiz, "." + path.posix.normalize("/" + rel));
      if (archivo.startsWith(raiz + path.sep) && fs.existsSync(archivo) && fs.statSync(archivo).isFile()) {
        enviarArchivo(res, archivo, { cacheLarga: rel.startsWith("/assets/"), head });
        return true;
      }
      // un archivo con extension que no existe es un 404 de verdad; lo demas
      // es una ruta del panel (React Router)
      if (path.extname(rel) && rel !== "/") return false;
      enviarArchivo(res, indice, { head });
      return true;
    },
  };
}
