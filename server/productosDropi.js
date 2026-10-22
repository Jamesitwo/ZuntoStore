// Mapa producto -> link de Dropi, mantenido en un Google Sheets publicado como
// CSV (Archivo -> Compartir -> Publicar en la web -> CSV).
//
// Columnas del sheet: par, Nombre, idProductoDropi, nameProductoDropi, dropiLink, transportadora
//
// La clave de union es `idProductoDropi`: es el id con el que Dropi conoce el
// producto, y es el MISMO que trae LucidSales en `obtenerProducto(id).idProductoDropi`.
// De ahi se saca el `dropiLink` (URL navegable con el slug) y la transportadora.
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

export function crearProductosDropi({
  url,
  ttl = 10 * 60 * 1000,
  fetchImpl = globalThis.fetch,
  log = console,
}) {
  let cache = null; // { hasta, filas: Map<idDropi, fila> }

  async function cargar() {
    if (!url) return null;
    if (cache && cache.hasta > Date.now()) return cache.filas;

    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
      if (r.status >= 400) {
        throw new ErrorApi(502, `El sheet de productos respondio HTTP ${r.status}`);
      }
      const texto = await r.text();
      const crudas = parsearCsv(texto);
      const cab = crudas[0] ?? [];
      const col = (nombre) => {
        const i = cab.findIndex((c) => String(c).trim().toLowerCase() === nombre);
        return i;
      };
      const iDropi = col("idproductodropi");
      const iLink = col("dropilink");
      const iTransportadora = col("transportadora");

      const filas = new Map();
      for (const fila of crudas.slice(1)) {
        const idDropi = String(fila[iDropi] ?? "").trim();
        if (!idDropi || iDropi < 0) continue;
        filas.set(idDropi, {
          idProductoDropi: idDropi,
          dropiLink: String(fila[iLink] ?? "").trim(),
          transportadora: String(fila[iTransportadora] ?? "").trim(),
        });
      }
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

  return {
    cargar,
    buscar,
    listo: Boolean(url),
  };
}
