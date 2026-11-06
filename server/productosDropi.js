// Mapa producto -> link de Dropi, mantenido en un Google Sheets publicado como
// CSV (Archivo -> Compartir -> Publicar en la web -> CSV).
//
// Columnas del sheet: par, Nombre, idProductoDropi, nameProductoDropi, dropiLink, transportadora
//
// La clave de union es `idProductoDropi`: es el id con el que Dropi conoce el
// producto, y es el MISMO que trae LucidSales en `obtenerProducto(id).idProductoDropi`.
// De ahi se saca el `dropiLink` (URL navegable con el slug) y la transportadora.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";

/**
 * Parser CSV (RFC 4180): soporta campos entre comillas, comillas escapadas
 * (""), y comas/saltos de linea dentro de un campo. Devuelve arreglo de
 * arreglos (sin la cabecera, que se devuelve como primera fila igual que viene).
 */
export function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let enComillas = false;
  const s = String(texto ?? "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++; // \r\n
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => String(c).trim() !== ""));
}

/**
 * Link de Google Sheets -> URL de exportacion CSV. Acepta:
 *   - el link normal del navegador (.../spreadsheets/d/<ID>/edit#gid=123)
 *   - el de exportacion (.../d/<ID>/export?format=csv[&gid=])
 *   - el publicado en la web (.../d/e/<ID>/pub?output=csv)
 * Devuelve null si no es un Google Sheets.
 */
export function urlCsvDeSheet(link) {
  const t = String(link ?? "").trim();
  if (!t) return null;
  let u;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  // publicado en la web: se fuerza el CSV
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\/pub/);
  if (pub) {
    const gid = u.searchParams.get("gid");
    return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  }
  const m = u.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})/);
  if (!m) return null;
  const gid = u.searchParams.get("gid") ?? (u.hash.match(/gid=(\d+)/)?.[1] ?? null);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

export function crearProductosDropi({
  url,
  ruta = null,
  ttl = 10 * 60 * 1000,
  fetchImpl = globalThis.fetch,
  log = console,
}) {
  let cache = null; // { hasta, filas: Map<idDropi, fila> }
  const delEnv = String(url ?? "").trim();
  // el link guardado desde el panel (config/productosDropi.json) manda
  let enPanel = "";
  // escritura: Apps Script pegado a la hoja que agrega filas (opcional)
  let escritura = { scriptUrl: "", secreto: "" };
  const leerArchivo = () => {
    if (!ruta) return {};
    try {
      return JSON.parse(fs.readFileSync(ruta, "utf8")) ?? {};
    } catch {
      return {};
    }
  };
  const escribirArchivo = (cambios) => {
    if (!ruta) throw new ErrorApi(500, "No hay dónde guardar la configuración del sheet");
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify({ ...leerArchivo(), ...cambios, actualizado: new Date().toISOString() }, null, 2), "utf8");
  };
  {
    const a = leerArchivo();
    enPanel = String(a?.link ?? "").trim();
    escritura = {
      scriptUrl: String(a?.escritura?.scriptUrl ?? "").trim(),
      secreto: String(a?.escritura?.secreto ?? "").trim(),
    };
  }
  url = enPanel ? urlCsvDeSheet(enPanel) ?? enPanel : delEnv;

  /** Descarga y lee el CSV de una URL (sin tocar la cache). */
  async function leer(destino) {
    const r = await fetchImpl(destino, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (r.status >= 400) {
      throw new ErrorApi(502, `El sheet de productos respondió HTTP ${r.status} (¿está compartido como «cualquiera con el enlace»?)`);
    }
    const texto = await r.text();
    if (/^\s*<(!doctype|html)/i.test(texto)) {
      throw new ErrorApi(502, "Google devolvió una página en vez del CSV: comparte el sheet como «Cualquier persona con el enlace puede ver»");
    }
    const crudas = parsearCsv(texto);
    const cab = (crudas[0] ?? []).map((c) => String(c).trim().toLowerCase());
    const iDropi = cab.indexOf("idproductodropi");
    const iLink = cab.indexOf("dropilink");
    const iTransportadora = cab.indexOf("transportadora");
    const iNombre = cab.indexOf("nombre");
    if (iDropi < 0 || iLink < 0) {
      throw new ErrorApi(
        400,
        `El sheet no tiene las columnas idProductoDropi y dropiLink (columnas vistas: ${(crudas[0] ?? []).slice(0, 8).join(", ") || "ninguna"})`,
      );
    }
    const filas = new Map();
    let sinLink = 0;
    for (const fila of crudas.slice(1)) {
      const idDropi = String(fila[iDropi] ?? "").trim();
      if (!idDropi) continue;
      const dropiLink = String(fila[iLink] ?? "").trim();
      if (!dropiLink) sinLink++;
      filas.set(idDropi, {
        idProductoDropi: idDropi,
        nombre: iNombre >= 0 ? String(fila[iNombre] ?? "").trim() : "",
        dropiLink,
        transportadora: iTransportadora >= 0 ? String(fila[iTransportadora] ?? "").trim() : "",
      });
    }
    return { filas, sinLink };
  }

  async function cargar() {
    if (!url) return null;
    if (cache && cache.hasta > Date.now()) return cache.filas;

    try {
      const { filas } = await leer(url);
      cache = { hasta: Date.now() + ttl, filas };
      return filas;
    } catch (e) {
      log.warn?.("[productosDropi] no se pudo bajar el sheet:", e?.message ?? e);
      return cache ? cache.filas : null;
    }
  }

  async function buscar(idDropi) {
    const filas = await cargar();
    if (!filas) return null;
    return filas.get(String(idDropi)) ?? null;
  }

  function estado() {
    return {
      configurado: Boolean(url),
      link: enPanel || delEnv,
      csv: url,
      origen: enPanel ? "panel" : delEnv ? ".env" : null,
      escritura: { configurada: Boolean(escritura.scriptUrl && escritura.secreto), scriptUrl: escritura.scriptUrl },
    };
  }

  /** gid de la pestaña del sheet (del link) para que el script escriba en esa. */
  function gidDelLink() {
    const l = enPanel || delEnv;
    try {
      const u = new URL(l);
      return u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Secreto compartido con el Apps Script (se crea la primera vez). */
  function secretoEscritura() {
    if (escritura.secreto) return escritura.secreto;
    escritura = { ...escritura, secreto: crypto.randomBytes(18).toString("hex") };
    escribirArchivo({ escritura });
    return escritura.secreto;
  }

  /** Codigo del Apps Script para pegar en la hoja (Extensiones -> Apps Script). */
  function codigoScript() {
    return textoScript(secretoEscritura(), gidDelLink());
  }

  async function llamarScript(scriptUrl, cuerpo) {
    let r;
    try {
      r = await fetchImpl(scriptUrl, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify(cuerpo),
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) {
      throw new ErrorApi(504, `El script del sheet no respondió: ${e?.message ?? e}`);
    }
    const texto = await r.text().catch(() => "");
    let datos = null;
    try {
      datos = JSON.parse(texto);
    } catch {
      const html = /^\s*<(!doctype|html)/i.test(texto);
      throw new ErrorApi(
        502,
        html
          ? "El script respondió una página en vez de datos: en la implementación, «Quién tiene acceso» debe ser «Cualquier usuario»"
          : `El script respondió algo inesperado (HTTP ${r.status})`,
      );
    }
    if (!datos?.ok) throw new ErrorApi(400, `El script del sheet dijo: ${datos?.msg ?? "error"}`);
    return datos;
  }

  const URL_SCRIPT = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

  /** Prueba la URL del script (o la guardada). */
  async function probarEscritura(scriptUrl) {
    const u = String(scriptUrl ?? escritura.scriptUrl ?? "").trim();
    if (!URL_SCRIPT.test(u)) throw new ErrorApi(400, "Pega la URL de la implementación del script (https://script.google.com/macros/s/…/exec)");
    const r = await llamarScript(u, { secreto: secretoEscritura(), probar: true });
    const cab = (r.columnas ?? []).map((c) => String(c).trim().toLowerCase());
    if (!cab.includes("idproductodropi")) {
      throw new ErrorApi(400, `La pestaña «${r.hoja ?? "?"}» no tiene la columna idProductoDropi (columnas: ${(r.columnas ?? []).join(", ")})`);
    }
    return { ok: true, hoja: r.hoja ?? "", columnas: r.columnas ?? [] };
  }

  /** Guarda la URL del script (la prueba antes). "" = desconectar. */
  async function guardarEscritura(scriptUrl) {
    const u = String(scriptUrl ?? "").trim();
    if (!u) {
      escritura = { ...escritura, scriptUrl: "" };
      escribirArchivo({ escritura });
      return estado();
    }
    const prueba = await probarEscritura(u);
    escritura = { ...escritura, scriptUrl: u };
    escribirArchivo({ escritura });
    return { ...estado(), prueba };
  }

  /**
   * Agrega el producto como fila nueva (si su idProductoDropi no esta ya).
   * fila: { Nombre, idProductoDropi, nameProductoDropi, dropiLink, transportadora, par }
   */
  async function agregar(fila) {
    if (!escritura.scriptUrl) throw new ErrorApi(409, "Conecta primero el script del Google Sheets (Ajustes → Sheet de productos)");
    const id = String(fila?.idProductoDropi ?? "").trim();
    if (!/^\d{1,12}$/.test(id)) throw new ErrorApi(400, "Falta el id del producto en Dropi");
    const limpia = {};
    for (const k of ["par", "Nombre", "idProductoDropi", "nameProductoDropi", "dropiLink", "transportadora"]) {
      const v = k === "idProductoDropi" ? id : String(fila?.[k] ?? "").trim().slice(0, 500);
      limpia[k] = v;
    }
    const r = await llamarScript(escritura.scriptUrl, { secreto: secretoEscritura(), fila: limpia });
    cache = null;
    log.log?.(`[productosDropi] ${r.yaEstaba ? "ya estaba en el sheet" : "agregado al sheet"}: ${limpia.Nombre || id} (Dropi ${id})`);
    return { ok: true, yaEstaba: Boolean(r.yaEstaba), fila: r.fila ?? null };
  }

  /** Prueba un link (o el actual): cuantas filas trae y si tienen link. */
  async function probar(link) {
    const destino = link ? urlCsvDeSheet(link) : url;
    if (!destino) throw new ErrorApi(400, "Pega el link de un Google Sheets (docs.google.com/spreadsheets/...)");
    const { filas, sinLink } = await leer(destino);
    const ejemplos = [...filas.values()].slice(0, 3).map((f) => f.nombre || f.idProductoDropi);
    return { ok: true, csv: destino, filas: filas.size, sinLink, ejemplos };
  }

  /** Guarda el link desde el panel (lo prueba antes). null/"" = volver al .env. */
  async function guardar(link) {
    if (!ruta) throw new ErrorApi(500, "No hay dónde guardar el link del sheet");
    const t = String(link ?? "").trim();
    if (!t) {
      const { link: _l, ...resto } = leerArchivo();
      if (Object.keys(resto).filter((k) => k !== "actualizado").length) escribirArchivo({ link: "" });
      else fs.rmSync(ruta, { force: true });
      enPanel = "";
      url = delEnv;
      cache = null;
      return estado();
    }
    const destino = urlCsvDeSheet(t);
    if (!destino) throw new ErrorApi(400, "Pega el link de un Google Sheets (docs.google.com/spreadsheets/...)");
    const prueba = await probar(t);
    escribirArchivo({ link: t });
    enPanel = t;
    url = destino;
    cache = null;
    return { ...estado(), filas: prueba.filas, sinLink: prueba.sinLink };
  }

  return {
    cargar,
    buscar,
    estado,
    probar,
    guardar,
    codigoScript,
    probarEscritura,
    guardarEscritura,
    agregar,
    get listo() {
      return Boolean(url);
    },
  };
}

/**
 * Apps Script que se pega en la hoja: recibe la fila de Zunto y la agrega
 * debajo, con las columnas en el orden que tenga la hoja. No duplica: si el
 * idProductoDropi ya esta, no hace nada.
 */
export function textoScript(secreto, gid = null) {
  return `// Zunto: agrega al sheet los productos creados desde un enlace de Dropi.
// Extensiones -> Apps Script -> pega esto -> Implementar -> Nueva implementación
// -> Aplicación web (Ejecutar como: yo · Quién tiene acceso: Cualquier usuario).
const SECRETO = ${JSON.stringify(secreto)};
const GID = ${gid === null ? "null" : JSON.stringify(String(gid))}; // pestaña del link guardado en Zunto

function doPost(e) {
  const datos = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  if (datos.secreto !== SECRETO) return salida({ ok: false, msg: "secreto incorrecto" });
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = (GID !== null && libro.getSheets().find((h) => String(h.getSheetId()) === GID)) || libro.getSheets()[0];
  const cab = hoja.getRange(1, 1, 1, Math.max(1, hoja.getLastColumn())).getValues()[0].map((c) => String(c).trim());
  if (datos.probar) return salida({ ok: true, hoja: hoja.getName(), columnas: cab });
  const bajas = cab.map((c) => c.toLowerCase());
  const iId = bajas.indexOf("idproductodropi");
  if (iId < 0) return salida({ ok: false, msg: "la hoja no tiene la columna idProductoDropi" });
  const f = datos.fila || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const n = hoja.getLastRow() - 1;
    const ids = n > 0 ? hoja.getRange(2, iId + 1, n, 1).getValues().map((r) => String(r[0]).trim()) : [];
    if (ids.indexOf(String(f.idProductoDropi)) >= 0) return salida({ ok: true, yaEstaba: true });
    const valor = (c) => {
      const k = Object.keys(f).find((x) => x.toLowerCase() === c);
      return k ? f[k] : "";
    };
    hoja.appendRow(bajas.map(valor));
    return salida({ ok: true, fila: hoja.getLastRow() });
  } finally {
    lock.releaseLock();
  }
}

function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
