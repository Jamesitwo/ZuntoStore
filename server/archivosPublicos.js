// Archivos publicos (imagenes, videos, audios, PDF) que se suben desde el
// panel y que Lucid Bot / WhatsApp descargan por enlace, p. ej. los bloques
// de los mensajes del bot de la segunda tienda.
//
//   POST /api/archivos            (con sesion del panel) cuerpo = el archivo crudo
//        cabecera content-type = su tipo; x-nombre = nombre original (opcional)
//        -> { url, nombre, tipo, bytes }
//   GET  /archivos/<id>.<ext>     publico (sin sesion): el archivo
//
// El nombre publico es aleatorio (no se puede adivinar); solo se aceptan los
// tipos que admite WhatsApp y hasta 16 MB.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";

export const TIPOS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};
const TIPO_DE_EXT = Object.fromEntries(Object.entries(TIPOS).map(([t, e]) => [e, t]));
export const MAX_BYTES = 16 * 1024 * 1024;
const RE_PUBLICO = /^\/archivos\/([a-f0-9]{32}\.[a-z0-9]{2,4})$/;

function leerCrudo(req, limite) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limite) {
        reject(new ErrorApi(413, `El archivo pasa de ${Math.round(limite / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

export function crearArchivosPublicos({ dir, maxBytes = MAX_BYTES } = {}) {
  /** Guarda el archivo del cuerpo y devuelve su enlace publico. */
  async function subir(req) {
    const tipo = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const ext = TIPOS[tipo];
    if (!ext) throw new ErrorApi(415, "Tipo de archivo no admitido (usa JPG, PNG, WEBP, MP4, MP3, OGG, M4A o PDF)");
    const largo = Number(req.headers["content-length"] ?? 0);
    if (largo > maxBytes) throw new ErrorApi(413, `El archivo pasa de ${Math.round(maxBytes / 1024 / 1024)} MB`);
    const datos = await leerCrudo(req, maxBytes);
    if (!datos.length) throw new ErrorApi(400, "El archivo está vacío");
    const nombre = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, nombre), datos);
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
    const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() || (/^(localhost|127\.)/.test(host) ? "http" : "https");
    let original = "";
    try {
      original = decodeURIComponent(String(req.headers["x-nombre"] ?? "")).slice(0, 120);
    } catch {
      /* nombre raro */
    }
    return { url: `${proto}://${host}/archivos/${nombre}`, nombre: original || nombre, tipo, bytes: datos.length };
  }

  /** GET /archivos/<id>: true si lo atendio. */
  function manejar(req, res, url) {
    const m = RE_PUBLICO.exec(url.pathname);
    if (!m || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const archivo = path.join(dir, m[1]);
    let st;
    try {
      st = fs.statSync(archivo);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return true;
    }
    const tipo = TIPO_DE_EXT[m[1].split(".").pop()] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": tipo,
      "content-length": st.size,
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": "inline",
      "access-control-allow-origin": "*",
    });
    if (req.method === "HEAD") return void res.end(), true;
    fs.createReadStream(archivo).pipe(res);
    return true;
  }

  return { subir, manejar };
}
