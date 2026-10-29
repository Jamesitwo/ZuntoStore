// Cuentas: un negocio con una o varias tiendas de LucidSales. Cada cuenta
// tiene sus datos y su configuracion aparte, y nadie ve los de otra.
//
// La cuenta 1 (ZuntoStore) usa los archivos de siempre y los secretos del
// .env / Railway. Las demas viven en DATA_DIR/cuentas/<id>/ y arrancan sin
// ningun secreto: cada una conecta lo suyo desde Ajustes (su LucidSales, su
// Dropi, su Lucid Bot, su sheet y sus claves de IA y Google Maps).
//
// Registro en CUENTAS (JSON):
//   { "cuentas": [ { "id": 1, "nombre": "ZuntoStore", "tiendas": ["3682"], "creada": "..." } ] }
import fs from "node:fs";
import path from "node:path";

/** Rutas de archivo de una cuenta que van a su carpeta. */
const RUTAS = {
  HISTORIAL: "historial.jsonl",
  CONVERSACION: "conversacion.jsonl",
  SUBIDA_AUTO: "subidaAutomatica.json",
  ASIGNACION: "asignacion.json",
  CREDENCIALES: "credenciales.json",
  ENVIOS: "envios.json",
  INTENTOS: "intentos.jsonl",
  PROGRAMADOS: "programados.json",
  ETIQUETAS: "etiquetas.json",
  AUDITORIA: "auditoria.jsonl",
  LUCIDBOT_PEDIDOS: "lucidbot-pedidos.json",
  LUCIDBOT_CONTACTOS_CONFIG: "config/lucidbot-contactos.json",
  LLM_CONFIG: "config/llm.json",
  MAPAS_CONFIG: "config/mapas.json",
  DROPI_PRODUCTOS_CONFIG: "config/productosDropi.json",
  APIKEY_CONFIG: "config/apikey.json",
  DROPI_PERFIL: "dropi-profile",
};

/** Secretos y datos del .env que SOLO son de la cuenta 1. */
const SOLO_CUENTA_1 = {
  API_KEY: "",
  LUCID_EMAIL: "",
  LUCID_PASSWORD: "",
  LLM_API_KEY: "",
  LLM_PROMPT: "",
  GOOGLE_MAPS_KEY: "",
  DROPI_TOKEN: "",
  DROPI_CAPTCHA_TOKEN: "",
  DROPI_USER_ID: 0,
  DROPI_SUPPLIER_ID: 0,
  DROPI_SHOP_ID: "",
  DROPI_WAREHOUSE_ID: "",
  DROPI_PRODUCTOS_CSV: "",
  REPARTO_AUTOMATICO: false,
};

const textoTienda = (t) => String(t ?? "").trim();
const tiendaValida = (t) => /^\d{1,12}$/.test(textoTienda(t));

/** Carpeta de datos de una cuenta (la 1 no tiene: usa las rutas de siempre). */
export function carpetaCuenta(config, id) {
  return Number(id) === 1 ? null : path.join(config.DATA_DIR, "cuentas", String(Number(id)));
}

/**
 * Configuracion de UNA cuenta. La 1 es la configuracion base tal cual (mismo
 * objeto: el panel la sigue cambiando en memoria). Las demas son una copia con
 * sus rutas en su carpeta y sin los secretos de la cuenta 1.
 */
export function configDeCuenta(base, cuenta) {
  if (Number(cuenta.id) === 1) return base;
  const carpeta = carpetaCuenta(base, cuenta.id);
  const c = { ...base, ...SOLO_CUENTA_1 };
  for (const [clave, rel] of Object.entries(RUTAS)) c[clave] = path.join(carpeta, rel);
  c.LUCID_TIENDA = textoTienda(cuenta.tiendas?.[0] ?? "");
  c.CUENTA_ID = Number(cuenta.id);
  fs.mkdirSync(path.join(carpeta, "config"), { recursive: true });
  return c;
}

/**
 * semilla: tiendas que ya usa ZuntoStore (para crear la cuenta 1 la primera vez)
 */
export function crearRegistroCuentas({ ruta, semilla = [] } = {}) {
  let datos = null;

  function leer() {
    if (datos) return datos;
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
      if (Array.isArray(j?.cuentas) && j.cuentas.length) {
        datos = { cuentas: j.cuentas.map(normalizar) };
        return datos;
      }
    } catch {
      /* primera vez */
    }
    // primera vez: ZuntoStore es la cuenta 1 con las tiendas que ya usa
    datos = {
      cuentas: [
        normalizar({
          id: 1,
          nombre: "ZuntoStore",
          tiendas: [...new Set(semilla.map(textoTienda).filter(tiendaValida))],
          creada: new Date().toISOString(),
        }),
      ],
    };
    guardar();
    return datos;
  }

  function normalizar(c) {
    return {
      id: Number(c.id),
      nombre: String(c.nombre ?? `Cuenta ${c.id}`).trim().slice(0, 80) || `Cuenta ${c.id}`,
      tiendas: [...new Set((c.tiendas ?? []).map(textoTienda).filter(tiendaValida))],
      creada: c.creada ?? null,
      activa: c.activa !== false,
    };
  }

  function guardar() {
    if (!ruta) return;
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
    fs.renameSync(tmp, ruta);
  }

  /** Una tienda pertenece a una sola cuenta. */
  function revisarTiendas(tiendas, idPropio) {
    for (const t of tiendas) {
      const otra = leer().cuentas.find((c) => c.id !== idPropio && c.tiendas.includes(t));
      if (otra) throw new Error(`la tienda ${t} ya es de la cuenta «${otra.nombre}»`);
    }
  }

  return {
    lista() {
      return leer().cuentas.map((c) => ({ ...c, tiendas: [...c.tiendas] }));
    },
    get(id) {
      const c = leer().cuentas.find((x) => x.id === Number(id));
      return c ? { ...c, tiendas: [...c.tiendas] } : null;
    },
    /** La cuenta dueña de una tienda de LucidSales (o null). */
    deTienda(tienda) {
      const t = textoTienda(tienda);
      const c = leer().cuentas.find((x) => x.activa && x.tiendas.includes(t));
      return c ? { ...c, tiendas: [...c.tiendas] } : null;
    },
    crear({ nombre, tiendas = [] } = {}) {
      const ts = [...new Set(tiendas.map(textoTienda))];
      if (!String(nombre ?? "").trim()) throw new Error("ponle un nombre a la cuenta");
      if (ts.some((t) => !tiendaValida(t))) throw new Error("los ids de tienda son números (ej. 3682)");
      revisarTiendas(ts, null);
      const id = Math.max(0, ...leer().cuentas.map((c) => c.id)) + 1;
      const c = normalizar({ id, nombre, tiendas: ts, creada: new Date().toISOString() });
      datos.cuentas.push(c);
      guardar();
      return { ...c };
    },
    /** Quita la cuenta del registro (sus archivos los borra quien llama). */
    borrar(id) {
      const n = Number(id);
      if (n === 1) throw new Error("la cuenta 1 no se puede borrar");
      const c = leer().cuentas.find((x) => x.id === n);
      if (!c) throw new Error("esa cuenta no existe");
      if (c.activa) throw new Error("primero desactiva la cuenta");
      datos.cuentas = datos.cuentas.filter((x) => x.id !== n);
      guardar();
      return { ...c };
    },
    actualizar(id, { nombre, tiendas, activa } = {}) {
      const c = leer().cuentas.find((x) => x.id === Number(id));
      if (!c) throw new Error("esa cuenta no existe");
      if (tiendas !== undefined) {
        const ts = [...new Set(tiendas.map(textoTienda))];
        if (ts.some((t) => !tiendaValida(t))) throw new Error("los ids de tienda son números (ej. 3682)");
        revisarTiendas(ts, c.id);
        c.tiendas = ts;
      }
      if (nombre !== undefined && String(nombre).trim()) c.nombre = String(nombre).trim().slice(0, 80);
      if (typeof activa === "boolean") {
        if (c.id === 1 && !activa) throw new Error("la cuenta 1 no se puede desactivar");
        c.activa = activa;
      }
      guardar();
      return { ...c, tiendas: [...c.tiendas] };
    },
  };
}
