// Archivos con claves (LucidSales, IA, Google Maps, Lucid Bot, Meta) cifrados
// en disco con AES-256-GCM. La clave sale de la variable CLAVE_MAESTRA (solo
// en Railway / .env, nunca en el repositorio ni en el volumen).
//
// En disco queda {"cifrado":"zs-v1","iv":"…","tag":"…","datos":"…"}. Sin
// CLAVE_MAESTRA se sigue leyendo y escribiendo en claro (como antes). Si la
// clave cambia o se pierde, esos archivos no se pueden leer: cada cuenta tiene
// que volver a guardar sus claves en Ajustes (nada mas se pierde).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "zs-v1";
let clave = null;

/** Se llama al arrancar con config.CLAVE_MAESTRA (o vacio para no cifrar). */
export function configurarClaveMaestra(texto) {
  const t = String(texto ?? "").trim();
  clave = t ? crypto.createHash("sha256").update(t).digest() : null;
}

export const cifradoActivo = () => Boolean(clave);

/** El objeto tal cual (sin clave) o su sobre cifrado. */
export function cifrarJson(obj) {
  if (!clave) return obj;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return { cifrado: VERSION, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), datos: datos.toString("base64") };
}

/** Abre el sobre (o devuelve el objeto si estaba en claro). */
export function descifrarJson(obj) {
  if (!obj || obj.cifrado !== VERSION) return obj;
  if (!clave) throw new Error("el archivo está cifrado y falta CLAVE_MAESTRA");
  const d = crypto.createDecipheriv("aes-256-gcm", clave, Buffer.from(obj.iv, "base64"));
  d.setAuthTag(Buffer.from(obj.tag, "base64"));
  const txt = Buffer.concat([d.update(Buffer.from(obj.datos, "base64")), d.final()]).toString("utf8");
  return JSON.parse(txt);
}

/** Lee un JSON (cifrado o no). Lanza si no existe o no se puede abrir. */
export function leerJsonSeguro(ruta) {
  return descifrarJson(JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, "")));
}

/** Texto a escribir en disco (cifrado si hay CLAVE_MAESTRA). */
export function textoJsonSeguro(obj, espacios = 2) {
  return JSON.stringify(cifrarJson(obj), null, espacios);
}

/** Escribe un JSON con claves: atomico, permisos 600, cifrado si se puede. */
export function escribirJsonSeguro(ruta, obj) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp`;
  fs.writeFileSync(tmp, textoJsonSeguro(obj), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, ruta);
  try {
    fs.chmodSync(ruta, 0o600);
  } catch {
    /* en Windows no aplica */
  }
}

/**
 * Cifra los archivos que sigan en claro (al arrancar con CLAVE_MAESTRA).
 * Devuelve cuantos cifro.
 */
export function cifrarArchivosEnClaro(rutas = []) {
  if (!clave) return 0;
  let n = 0;
  for (const r of rutas) {
    try {
      const j = JSON.parse(fs.readFileSync(r, "utf8").replace(/^﻿/, ""));
      if (j && typeof j === "object" && j.cifrado !== VERSION) {
        escribirJsonSeguro(r, j);
        n++;
      }
    } catch {
      /* no existe o no es JSON: nada que cifrar */
    }
  }
  return n;
}
