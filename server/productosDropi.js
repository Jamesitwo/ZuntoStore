// Mapa producto -> link de Dropi, mantenido en un Google Sheets publicado como
// CSV (Archivo -> Compartir -> Publicar en la web -> CSV).
//
// Columnas del sheet: par, Nombre, idProductoDropi, nameProductoDropi, dropiLink, transportadora
//
// La clave de union es `idProductoDropi`: es el id con el que Dropi conoce el
// producto, y es el MISMO que trae LucidSales en `obtenerProducto(id).idProductoDropi`.
// De ahi se saca el `dropiLink` (URL navegable con el slug) y la transportadora.
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
  if (ruta) {
    try {
      enPanel = String(JSON.parse(fs.readFileSync(ruta, "utf8"))?.link ?? "").trim();
    } catch {
      enPanel = "";
    }
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
    };
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
      fs.rmSync(ruta, { force: true });
      enPanel = "";
      url = delEnv;
      cache = null;
      return estado();
    }
    const destino = urlCsvDeSheet(t);
    if (!destino) throw new ErrorApi(400, "Pega el link de un Google Sheets (docs.google.com/spreadsheets/...)");
    const prueba = await probar(t);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify({ link: t, actualizado: new Date().toISOString() }, null, 2), "utf8");
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
    get listo() {
      return Boolean(url);
    },
  };
}
