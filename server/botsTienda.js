// Segunda tienda en otro Lucid Bot, con LucidSales como unico origen.
//
// LucidSales solo se conecta a UN Lucid Bot (el de Zunto) y llena sus "campos
// del bot" (catalogo, multimedia, mensajes iniciales, ad_ids, integracion,
// posventa...: listas con un objeto por producto, "nombre_del_producto").
// Zunto hace de intermediario:
//   - lee esos campos del bot de Zunto,
//   - escribe en el bot de la nueva tienda solo los productos asignados a ella,
//   - (opcional) deja en el bot de Zunto solo los productos de Zunto,
//   - escribe en el nuevo bot los campos de la tienda que se definan en Zunto
//     (nombre de la empresa, politicas, cuentas bancarias...).
//
// Lucid Bot no lista los campos del bot: los ID salen de una exportacion
// (JSON con campos [{id, name, ...}]) que se pega en el panel; de ella solo se
// guarda id y nombre, nunca los valores.
//
//   GET  https://panel.lucidbot.co/api/accounts/bot_fields/{id}        -> {id, name, type, value}
//   POST https://panel.lucidbot.co/api/accounts/bot_fields/{id}  value= (x-www-form-urlencoded)
//
// Como despues de filtrar el bot de Zunto ya no trae los productos de la nueva
// tienda, se guarda una copia de lo ultimo que LucidSales escribio de cada
// producto (cache) y se usa mientras LucidSales no lo vuelva a escribir.
import crypto from "node:crypto";
import { ErrorApi } from "./errores.js";
import { escribirJsonSeguro, leerJsonSeguro } from "./secretos.js";
import { actividad } from "./vigia.js";

const API = "https://panel.lucidbot.co/api";
const DEFECTO = {
  activo: false,
  nombre: "",
  token: "", // X-ACCESS-TOKEN del bot de la nueva tienda
  cadaMin: 30,
  filtrarZunto: true,
  productosNueva: [], // nombres de producto (como en LucidSales) de la nueva tienda
  idsZunto: {}, // nombre de campo -> id en el bot de Zunto
  idsNueva: {}, // nombre de campo -> id en el bot nuevo
  camposTienda: {}, // nombre de campo -> valor para el bot nuevo ("" = no se toca)
};
const MAX_HISTORIAL = 20;
// campos que LucidSales llena con un objeto por producto (tambien se detectan
// por su contenido; esta lista cubre los que esten vacios)
export const CAMPOS_POR_PRODUCTO = [
  "ad_id_lucidsales",
  "Catalogo_productos_LucidSales",
  "Integracion_LucidSales",
  "mensajes_iniciales_lucidsales",
  "Multimedia_productos_LucidSales",
  "Preguntas_Postventa_Productos_LucidSales",
];

const clave = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const huella = (t) => crypto.createHash("sha1").update(String(t ?? "")).digest("hex");

/** Lista de {id, name} de una exportacion de campos del bot (ignora los valores). */
export function idsDeExportacion(texto) {
  let j = texto;
  if (typeof texto === "string") {
    try {
      j = JSON.parse(texto);
    } catch {
      throw new ErrorApi(400, "El texto no es un JSON válido");
    }
  }
  const lista = Array.isArray(j) ? j : Array.isArray(j?.campos) ? j.campos : Array.isArray(j?.data) ? j.data : null;
  if (!lista) throw new ErrorApi(400, "No encontré la lista de campos (se espera {campos:[{id, name}]} o una lista)");
  const ids = {};
  for (const c of lista) {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? c?.nombre ?? "").trim();
    if (/^\d+$/.test(id) && name) ids[name] = id;
  }
  if (!Object.keys(ids).length) throw new ErrorApi(400, "La exportación no trae campos con id y nombre");
  return ids;
}

/**
 * Si el valor es un campo "por producto": {clave, items} con la lista cuyos
 * objetos traen nombre_del_producto. null si no lo es.
 */
export function listaDeProductos(valor) {
  let j = valor;
  if (typeof valor === "string") {
    try {
      j = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  for (const [k, v] of Object.entries(j)) {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && "nombre_del_producto" in x)) {
      return { clave: k, items: v, resto: j };
    }
  }
  return null;
}

/** El mismo JSON con solo los productos que cumplen `quedar`. */
export function filtrarProductos(valor, quedar) {
  const l = listaDeProductos(valor);
  if (!l) return null;
  return JSON.stringify({ ...l.resto, [l.clave]: l.items.filter((x) => quedar(x.nombre_del_producto)) });
}

export function crearBotsTienda({ ruta, rutaCache, tokenZunto, fetcher = fetch, timeoutMs = 20000, log = console, reloj = () => new Date() } = {}) {
  let timer = null;
  let corriendo = false;
  let ultimaVuelta = 0;

  const leer = () => {
    try {
      return { ...DEFECTO, ...leerJsonSeguro(ruta) };
    } catch {
      return { ...DEFECTO };
    }
  };
  const guardar = (c) => escribirJsonSeguro(ruta, c);
  const leerCache = () => {
    try {
      return { productos: {}, historial: [], escrito: {}, ...leerJsonSeguro(rutaCache) };
    } catch {
      return { productos: {}, historial: [], escrito: {} };
    }
  };
  const guardarCache = (c) => escribirJsonSeguro(rutaCache, c);

  async function llamar(token, metodo, id, valor) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetcher(`${API}/accounts/bot_fields/${encodeURIComponent(id)}`, {
        method: metodo,
        signal: ctl.signal,
        headers: {
          accept: "application/json",
          "X-ACCESS-TOKEN": token,
          ...(metodo === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(metodo === "POST" ? { body: new URLSearchParams({ value: String(valor ?? "") }).toString() } : {}),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || (metodo === "POST" && j?.success === false)) {
        throw new Error(`Lucid Bot respondió ${r.status}${j?.message ? `: ${j.message}` : ""} (campo ${id})`);
      }
      return j;
    } catch (e) {
      if (e?.name === "AbortError") throw new Error(`Lucid Bot no respondió a tiempo (campo ${id})`);
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
  const leerCampo = async (token, id) => {
    const j = await llamar(token, "GET", id);
    const v = j?.value ?? j?.data?.value ?? null;
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  };

  function publico(c = leer()) {
    const { token, ...resto } = c;
    const cache = leerCache();
    return {
      ...resto,
      tokenConfigurado: Boolean(token),
      tokenVista: token ? `${token.slice(0, 3)}…${token.slice(-3)}` : "",
      tokenZuntoConfigurado: Boolean(tokenZunto?.()),
      camposZunto: Object.keys(c.idsZunto).length,
      camposNueva: Object.keys(c.idsNueva).length,
      // productos vistos en LucidSales (para elegir cuales son de la nueva tienda)
      productos: Object.values(cache.productos?.__nombres ?? {}).sort((a, b) => a.localeCompare(b, "es")),
      camposPorProducto: [...new Set([...CAMPOS_POR_PRODUCTO, ...Object.keys(cache.productos ?? {}).filter((k) => k !== "__nombres")])],
      historial: (cache.historial ?? []).slice(0, 10),
      sincronizando: corriendo,
    };
  }

  function configurar(patch = {}) {
    const c = leer();
    const s = { ...c };
    if (typeof patch.activo === "boolean") s.activo = patch.activo;
    if (typeof patch.filtrarZunto === "boolean") s.filtrarZunto = patch.filtrarZunto;
    if (patch.nombre != null) s.nombre = String(patch.nombre).trim().slice(0, 80);
    if (patch.cadaMin != null) s.cadaMin = Math.min(1440, Math.max(5, Math.round(Number(patch.cadaMin) || 30)));
    if (typeof patch.token === "string" && patch.token.trim()) s.token = patch.token.trim();
    if (patch.borrarToken === true) s.token = "";
    if (Array.isArray(patch.productosNueva)) {
      s.productosNueva = [...new Set(patch.productosNueva.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 500);
    }
    if (patch.exportZunto != null) s.idsZunto = idsDeExportacion(patch.exportZunto);
    if (patch.exportNueva != null) s.idsNueva = idsDeExportacion(patch.exportNueva);
    if (patch.camposTienda && typeof patch.camposTienda === "object") {
      const ct = {};
      for (const [k, v] of Object.entries(patch.camposTienda)) {
        const t = String(v ?? "");
        if (t.trim()) ct[String(k).slice(0, 120)] = t.slice(0, 100_000);
      }
      s.camposTienda = ct;
    }
    if (s.activo && !s.token) throw new ErrorApi(400, "Guarda el X-ACCESS-TOKEN del bot de la nueva tienda antes de activar");
    if (s.activo && (!Object.keys(s.idsZunto).length || !Object.keys(s.idsNueva).length)) {
      throw new ErrorApi(400, "Pega primero las exportaciones de campos de los dos bots (para saber sus ID)");
    }
    guardar(s);
    return publico(s);
  }

  /** Una sincronizacion completa. */
  /**
   * soloLeer: solo trae los productos del bot de Zunto (para elegirlos), sin escribir nada.
   * soloTienda: solo escribe ya los campos de la tienda en el bot nuevo (al guardarlos), aunque no hayan cambiado.
   */
  async function sincronizar({ motivo = "manual", soloLeer = false, soloTienda = false } = {}) {
    if (corriendo) return { ok: false, ocupado: true, detalle: "Ya se está sincronizando" };
    const c = leer();
    const tz = tokenZunto?.();
    if (!tz) return { ok: false, detalle: "Falta el X-ACCESS-TOKEN del bot de Zunto (Ajustes → Lucid Bot)" };
    if (!soloTienda && !Object.keys(c.idsZunto).length) return { ok: false, detalle: "Pega primero la exportación de campos del bot de Zunto" };
    if (soloTienda && !Object.keys(c.idsNueva).length) return { ok: false, detalle: "Carga primero la exportación de campos del bot nuevo" };
    if (!soloLeer && !c.token) return { ok: false, detalle: "Falta el X-ACCESS-TOKEN del bot de la nueva tienda" };
    corriendo = true;
    const inicio = reloj();
    const res = { desde: inicio.toISOString(), motivo, escritosNueva: [], escritosZunto: [], sinCambios: 0, errores: [] };
    const cache = leerCache();
    cache.productos ??= {};
    cache.escrito ??= {};
    cache.quitados ??= {}; // campo -> [productos que Zunto quito de su bot]
    const nombres = (cache.productos.__nombres ??= {});
    const deNueva = new Set(c.productosNueva.map(clave));
    const esNueva = (n) => deNueva.has(clave(n));
    try {
      // 1) campos por producto: leer del bot de Zunto
      for (const [nombre, idZ] of soloTienda ? [] : Object.entries(c.idsZunto)) {
        actividad(`bots-tienda: ${nombre}`);
        let valor;
        try {
          valor = await leerCampo(tz, idZ);
        } catch (e) {
          res.errores.push(`leer ${nombre} (Zunto): ${e.message}`);
          continue;
        }
        const l = listaDeProductos(valor);
        if (!l) continue;
        // lo que LucidSales escribio de cada producto queda en la cache
        const porProducto = (cache.productos[nombre] ??= { clave: l.clave, items: {} });
        porProducto.clave = l.clave;
        for (const it of l.items) {
          const k = clave(it.nombre_del_producto);
          porProducto.items[k] = it;
          nombres[k] = String(it.nombre_del_producto).trim();
        }
        if (soloLeer) continue;
        // nuevo bot: los productos de la nueva tienda (de la cache: Zunto ya
        // pudo haberlos quitado de su bot)
        const idN = c.idsNueva[nombre];
        if (idN) {
          const itemsNueva = Object.entries(porProducto.items)
            .filter(([k]) => deNueva.has(k))
            .map(([, it]) => it);
          const nuevo = JSON.stringify({ ...l.resto, [l.clave]: itemsNueva });
          const marca = `nueva:${idN}`;
          if (cache.escrito[marca] !== huella(nuevo)) {
            try {
              await llamar(c.token, "POST", idN, nuevo);
              cache.escrito[marca] = huella(nuevo);
              res.escritosNueva.push(`${nombre} (${itemsNueva.length})`);
            } catch (e) {
              res.errores.push(`escribir ${nombre} (nueva tienda): ${e.message}`);
            }
          } else res.sinCambios++;
        }
        // bot de Zunto: sin los productos de la nueva tienda, y de vuelta los
        // que Zunto habia quitado y ya no son de la nueva tienda
        const quitados = new Set(c.filtrarZunto ? cache.quitados[nombre] ?? [] : []);
        const enBot = new Set(l.items.map((it) => clave(it.nombre_del_producto)));
        const devolver = [...quitados].filter((k) => !deNueva.has(k) && !enBot.has(k) && porProducto.items[k]);
        const sobran = c.filtrarZunto && l.items.some((it) => esNueva(it.nombre_del_producto));
        if (sobran || devolver.length) {
          const items = [...l.items.filter((it) => !c.filtrarZunto || !esNueva(it.nombre_del_producto)), ...devolver.map((k) => porProducto.items[k])];
          try {
            await llamar(tz, "POST", idZ, JSON.stringify({ ...l.resto, [l.clave]: items }));
            res.escritosZunto.push(nombre);
            const ahora = new Set([...quitados].filter((k) => !devolver.includes(k)));
            if (c.filtrarZunto) for (const it of l.items) if (esNueva(it.nombre_del_producto)) ahora.add(clave(it.nombre_del_producto));
            cache.quitados[nombre] = [...ahora];
          } catch (e) {
            res.errores.push(`filtrar ${nombre} (Zunto): ${e.message}`);
          }
        }
      }
      if (soloLeer) {
        res.ok = res.errores.length === 0;
        return res;
      }
      // 2) campos de la tienda en el nuevo bot
      for (const [nombre, valor] of Object.entries(c.camposTienda)) {
        const idN = c.idsNueva[nombre];
        if (!idN) {
          res.errores.push(`el campo «${nombre}» no está en la exportación del nuevo bot`);
          continue;
        }
        const marca = `nueva:${idN}`;
        if (!soloTienda && cache.escrito[marca] === huella(valor)) {
          res.sinCambios++;
          continue;
        }
        try {
          await llamar(c.token, "POST", idN, valor);
          cache.escrito[marca] = huella(valor);
          res.escritosNueva.push(nombre);
        } catch (e) {
          res.errores.push(`escribir ${nombre} (nueva tienda): ${e.message}`);
        }
      }
      res.ok = res.errores.length === 0;
      return res;
    } catch (e) {
      res.ok = false;
      res.errores.push(e?.message ?? String(e));
      return res;
    } finally {
      res.hasta = reloj().toISOString();
      cache.historial = [res, ...(cache.historial ?? [])].slice(0, MAX_HISTORIAL);
      try {
        guardarCache(cache);
      } catch (e) {
        log.warn?.("[bots-tienda] no se pudo guardar la cache:", e?.message ?? e);
      }
      corriendo = false;
      ultimaVuelta = Date.now();
      const linea = `[bots-tienda] ${motivo}: nueva tienda ${res.escritosNueva.length} campo(s), Zunto filtrado ${res.escritosZunto.length}, sin cambios ${res.sinCambios}${res.errores.length ? `, ${res.errores.length} error(es): ${res.errores[0]}` : ""}`;
      (res.errores.length ? log.warn : log.log)?.call(log, linea);
    }
  }

  /**
   * Valores actuales del bot de Zunto para los campos de la tienda (los que
   * estan en las dos exportaciones y no son por producto), para llenar el
   * formulario. No guarda nada. Los campos con "token" en el nombre no se leen.
   */
  async function valoresZunto() {
    const c = leer();
    const tz = tokenZunto?.();
    if (!tz) throw new ErrorApi(400, "Falta el X-ACCESS-TOKEN del bot de Zunto (Ajustes → Lucid Bot)");
    if (!Object.keys(c.idsZunto).length || !Object.keys(c.idsNueva).length) {
      throw new ErrorApi(400, "Carga primero las exportaciones de campos de los dos bots");
    }
    const porProducto = new Set([...CAMPOS_POR_PRODUCTO, ...Object.keys(leerCache().productos ?? {})]);
    const nombres = Object.keys(c.idsNueva).filter((n) => c.idsZunto[n] && !porProducto.has(n) && !/token/i.test(n));
    const valores = {};
    const errores = [];
    for (let i = 0; i < nombres.length; i += 5) {
      await Promise.all(
        nombres.slice(i, i + 5).map(async (n) => {
          try {
            const v = await leerCampo(tz, c.idsZunto[n]);
            if (listaDeProductos(v)) return; // por producto: lo maneja la sincronizacion
            valores[n] = v;
          } catch (e) {
            errores.push(`${n}: ${e.message}`);
          }
        }),
      );
    }
    return { valores, errores };
  }

  /** Asigna un producto (nombre como en LucidSales) a "nueva" o a "zunto". */
  function asignar(producto, tienda) {
    const n = String(producto ?? "").trim();
    if (!n) throw new ErrorApi(400, "Falta el nombre del producto");
    if (tienda !== "nueva" && tienda !== "zunto") throw new ErrorApi(400, "Tienda no válida");
    const c = leer();
    const k = clave(n);
    const sin = c.productosNueva.filter((x) => clave(x) !== k);
    c.productosNueva = tienda === "nueva" ? [...sin, n] : sin;
    guardar(c);
    return publico(c);
  }

  function tick() {
    const c = leer();
    if (!c.activo || corriendo) return false;
    if (Date.now() - ultimaVuelta < c.cadaMin * 60_000) return false;
    sincronizar({ motivo: "automática" }).catch(() => {});
    return true;
  }

  return {
    estado: publico,
    configurar,
    sincronizar,
    valoresZunto,
    asignar,
    tick,
    arrancar() {
      if (timer) return;
      timer = setInterval(tick, 60_000);
      timer.unref?.();
    },
    detener() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
