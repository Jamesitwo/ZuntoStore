// Foto diaria del catalogo de Dropi (base del agente de productos ganadores).
//
// Cada noche (2 a.m. por defecto) recorre TODO el catalogo publico de Dropi
// por su API (la misma que usa app.dropi.co al buscar productos), guarda el
// stock y el precio de cada producto y, comparando dias, despues se estiman
// las ventas (caidas de stock). Aqui NO se usa IA: solo se descarga y guarda.
//
//   POST https://api-v2.dropi.co/bff/catalog/products/v4/index
//     cabeceras: X-Authorization: Bearer <DROPI_token>, X-Host: co
//     cuerpo: { pageSize<=100, startData (offset), order_by:"created_at",
//               order_type:"asc", ... }  -> data.objects[]
//   Con orden por fecha de creacion ascendente las paginas son estables (los
//   productos nuevos quedan al final). El filtro "with_orders" de Dropi se cae
//   (tarda >29 s), por eso se filtra por stock aqui.
//
// Archivos (en dir):
//   config.json                 { activo, hora, todo, diasGuardar }
//   estado.json                 { ultimoDia, corridas: [...] }
//   dias/AAAA-MM-DD.json.gz     { fecha, inicio, fin, filas: [[id, stock, precio, sugerido]] }
//   productos.json.gz           { actualizado, productos: { id: [nombre, tipo, proveedor, categorias, imagen, primeraVez] } }
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { actividad } from "./vigia.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const URL_CATALOGO = "https://api-v2.dropi.co/bff/catalog/products/v4/index";
const TAM_PAGINA = 100; // Dropi responde 400 con mas
const MAX_PAGINAS = 8000; // tope de seguridad (800 mil productos)
const MAX_CORRIDAS = 30;

const DEFECTO = { activo: false, hora: 2, todo: false, diasGuardar: 35 };

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/** Stock disponible para dropshipper, como lo calcula app.dropi.co. */
export function stockDe(p = {}) {
  if (p.type === "COMBO") return Math.max(0, parseInt(p.combo_combinations?.[0]?.stock, 10) || 0);
  if (p.type === "VARIABLE") {
    const vars = Array.isArray(p.variations) ? p.variations : [];
    if (!vars.length) return Math.max(0, num(p.variation_stock));
    let s = 0;
    for (const v of vars) {
      const w = v?.warehouse_product_variation;
      s += Array.isArray(w) && w.length ? w.reduce((a, x) => a + num(x?.stock), 0) : num(v?.stock);
    }
    return Math.max(0, s);
  }
  const w = p.warehouse_product;
  if (Array.isArray(w) && w.length) return Math.max(0, w.reduce((a, x) => a + num(x?.stock), 0));
  return Math.max(0, num(p.stock_simple));
}

/** Producto de la API -> lo poco que se guarda. null si no sirve. */
export function compactar(p = {}) {
  const id = Number(p?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (p.privated_product === true || p.private_product === true) return null;
  const img = p.gallery?.find?.((g) => g?.main) ?? p.gallery?.[0];
  return {
    id,
    stock: stockDe(p),
    precio: num(p.sale_price),
    sugerido: num(p.suggested_price),
    nombre: String(p.name ?? "").trim().slice(0, 160),
    tipo: String(p.type ?? ""),
    proveedor: String(p.user?.store_name ?? p.user?.name ?? "").trim().slice(0, 80),
    categorias: (Array.isArray(p.categories) ? p.categories : [])
      .map((c) => String(c?.name ?? "").trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(", "),
    imagen: String(img?.urlS3 ?? img?.url ?? p.image ?? "").slice(0, 300),
  };
}

/** Cuerpo de la peticion de una pagina. */
export function cuerpoPagina(startData, pais = "COLOMBIA") {
  return {
    pageSize: TAM_PAGINA,
    startData,
    country: pais,
    privated_product: false,
    userVerified: false,
    favorite: false,
    with_collection: true,
    get_stock: false,
    no_count: true,
    search_type: "simple",
    order_by: "created_at",
    order_type: "asc",
  };
}

/** Fecha (AAAA-MM-DD) y hora en Bogota. */
export function ahoraBogota(d = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { dia: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) };
}

function normalizarConfig(c = {}) {
  const hora = Math.round(num(c.hora));
  const dias = Math.round(num(c.diasGuardar));
  return {
    activo: c.activo === true,
    hora: hora >= 0 && hora <= 23 ? hora : DEFECTO.hora,
    todo: c.todo === true,
    diasGuardar: dias >= 7 && dias <= 120 ? dias : DEFECTO.diasGuardar,
  };
}

/**
 * dir: carpeta de datos del catalogo
 * obtenerSesion: async () => { ok, token, pais } (lee la sesion de Dropi del servidor)
 */
export function crearCatalogoDropi({
  dir,
  obtenerSesion,
  fetchImpl = (...a) => fetch(...a),
  log = console,
  concurrencia = 2,
  pausaMs = 400,
  esperaReintentoMs = [2000, 5000, 10000, 20000],
  timeoutMs = 45000,
  reloj = () => new Date(),
} = {}) {
  const rutaConfig = path.join(dir, "config.json");
  const rutaEstado = path.join(dir, "estado.json");
  const dirDias = path.join(dir, "dias");
  const rutaProductos = path.join(dir, "productos.json.gz");

  let cfg = null;
  let est = null;
  let enCurso = null; // { desde, paginas, productos, conStock, fallidas, motivo }
  let parar = false;
  let timer = null;

  const leerJson = (r, d) => {
    try {
      return JSON.parse(fs.readFileSync(r, "utf8"));
    } catch {
      return d;
    }
  };
  const escribirJson = (r, v) => {
    fs.mkdirSync(path.dirname(r), { recursive: true });
    const tmp = `${r}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
    fs.renameSync(tmp, r);
  };
  const config = () => (cfg ??= normalizarConfig({ ...DEFECTO, ...leerJson(rutaConfig, {}) }));
  const estado = () => (est ??= { ultimoDia: "", corridas: [], ...leerJson(rutaEstado, {}) });
  const guardarEstado = () => escribirJson(rutaEstado, estado());
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  async function escribirGz(r, v) {
    fs.mkdirSync(path.dirname(r), { recursive: true });
    const tmp = `${r}.tmp`;
    fs.writeFileSync(tmp, await gzip(Buffer.from(JSON.stringify(v))));
    fs.renameSync(tmp, r);
  }
  async function leerGz(r) {
    try {
      return JSON.parse((await gunzip(fs.readFileSync(r))).toString("utf8"));
    } catch {
      return null;
    }
  }

  /** Dias guardados (AAAA-MM-DD), del mas viejo al mas nuevo. */
  function dias() {
    try {
      return fs
        .readdirSync(dirDias)
        .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.json\.gz$/)?.[1])
        .filter(Boolean)
        .sort();
    } catch {
      return [];
    }
  }

  function podar(hoy) {
    const limite = new Date(`${hoy}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() - config().diasGuardar);
    const corte = limite.toISOString().slice(0, 10);
    let n = 0;
    for (const d of dias()) {
      if (d < corte) {
        fs.rmSync(path.join(dirDias, `${d}.json.gz`), { force: true });
        n++;
      }
    }
    return n;
  }

  /** Una pagina, con reintentos. -> { objetos } | { auth } | { error } */
  async function pagina(offset, sesion) {
    let ultimo = "";
    for (let i = 0; i <= esperaReintentoMs.length; i++) {
      if (parar) return { error: "detenido" };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(URL_CATALOGO, {
          method: "POST",
          signal: ctl.signal,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-authorization": `Bearer ${sesion.token}`,
            "x-host": "co",
            origin: "https://app.dropi.co",
            referer: "https://app.dropi.co/",
          },
          body: JSON.stringify(cuerpoPagina(offset, sesion.pais)),
        });
        if (r.status === 401 || r.status === 403) return { auth: true };
        const texto = await r.text();
        let j = null;
        try {
          j = JSON.parse(texto);
        } catch {
          /* html o vacio */
        }
        if (r.ok && j) {
          const objetos = j?.data?.objects ?? j?.objects ?? j?.data?.products ?? [];
          if (Array.isArray(objetos)) return { objetos };
        }
        ultimo = `HTTP ${r.status}${j?.status_reason ? ` ${j.status_reason}` : ""}`;
      } catch (e) {
        ultimo = e?.name === "AbortError" ? "Dropi tardó demasiado" : (e?.message ?? "error de red");
      } finally {
        clearTimeout(t);
      }
      if (i < esperaReintentoMs.length) await espera(esperaReintentoMs[i]);
    }
    return { error: ultimo || "sin respuesta" };
  }

  /** Recorre el catalogo completo y guarda la foto del dia. */
  async function ejecutar({ motivo = "manual" } = {}) {
    if (enCurso) return { ok: false, ocupado: true, detalle: "Ya se está revisando el catálogo." };
    const { dia } = ahoraBogota(reloj());
    const inicio = reloj();
    parar = false;
    enCurso = { desde: inicio.toISOString(), paginas: 0, productos: 0, conStock: 0, fallidas: 0, motivo };
    estado().ultimoDia = dia;
    guardarEstado();
    const corrida = { dia, desde: inicio.toISOString(), motivo };
    try {
      let sesion = await obtenerSesion();
      if (!sesion?.ok || !sesion.token) throw new Error(sesion?.detalle || "No hay sesión de Dropi en el servidor");
      let renovada = false;
      const todo = config().todo;
      const vistos = new Map(); // id -> compacto
      let siguiente = 0;
      let vacias = 0;
      let fin = false;
      while (!fin && !parar && siguiente < MAX_PAGINAS) {
        const lote = [];
        for (let k = 0; k < concurrencia; k++) lote.push((siguiente + k) * TAM_PAGINA);
        siguiente += concurrencia;
        actividad(`catalogo: offset ${lote[0]}`);
        let rs = await Promise.all(lote.map((o) => pagina(o, sesion)));
        if (rs.some((r) => r.auth)) {
          if (renovada) throw new Error("Dropi rechazó la sesión (vencida). Vuelve a cargar la sesión de Dropi.");
          renovada = true;
          sesion = await obtenerSesion();
          if (!sesion?.ok || !sesion.token) throw new Error("Dropi rechazó la sesión y no se pudo renovar");
          rs = await Promise.all(lote.map((o) => pagina(o, sesion)));
          if (rs.some((r) => r.auth)) throw new Error("Dropi rechazó la sesión (vencida). Vuelve a cargar la sesión de Dropi.");
        }
        for (const r of rs) {
          if (r.error) {
            if (r.error === "detenido") break;
            enCurso.fallidas++;
            continue;
          }
          enCurso.paginas++;
          if (!r.objetos.length) {
            vacias++;
            continue;
          }
          vacias = 0;
          for (const o of r.objetos) {
            const c = compactar(o);
            if (!c) continue;
            enCurso.productos++;
            if (c.stock > 0) enCurso.conStock++;
            if (todo || c.stock > 0) vistos.set(c.id, c);
          }
        }
        // varias paginas vacias seguidas = fin del catalogo
        if (vacias >= 3) fin = true;
        if (enCurso.fallidas > 25) throw new Error(`Dropi falló en ${enCurso.fallidas} páginas; se suspende la revisión`);
        if (!fin && pausaMs > 0) await espera(pausaMs);
      }
      if (parar) throw new Error("Detenido desde el panel");
      if (!vistos.size) throw new Error("Dropi no devolvió productos");

      const filas = [];
      for (const c of vistos.values()) filas.push([c.id, c.stock, c.precio, c.sugerido]);
      filas.sort((a, b) => a[0] - b[0]);
      const finIso = reloj().toISOString();
      await escribirGz(path.join(dirDias, `${dia}.json.gz`), { fecha: dia, inicio: inicio.toISOString(), fin: finIso, filas });

      // fichas: la ultima version de cada producto (y desde cuando se ve)
      const previo = (await leerGz(rutaProductos))?.productos ?? {};
      const productos = {};
      for (const c of vistos.values()) {
        const antes = previo[c.id];
        productos[c.id] = [c.nombre, c.tipo, c.proveedor, c.categorias, c.imagen, antes?.[5] || dia];
      }
      await escribirGz(rutaProductos, { actualizado: finIso, productos });
      const borrados = podar(dia);

      const seg = Math.round((Date.parse(finIso) - inicio.getTime()) / 1000);
      Object.assign(corrida, {
        ok: true,
        hasta: finIso,
        seg,
        paginas: enCurso.paginas,
        productos: enCurso.productos,
        conStock: enCurso.conStock,
        guardados: vistos.size,
        fallidas: enCurso.fallidas,
      });
      log.log?.(
        `[catalogo] ${dia}: ${enCurso.productos} productos revisados (${enCurso.conStock} con stock, ${vistos.size} guardados) ` +
          `en ${Math.round(seg / 60)} min · ${enCurso.paginas} páginas` +
          (enCurso.fallidas ? ` · ${enCurso.fallidas} fallidas` : "") +
          (borrados ? ` · ${borrados} día(s) viejo(s) borrados` : ""),
      );
      return { ok: true, corrida };
    } catch (e) {
      Object.assign(corrida, {
        ok: false,
        hasta: reloj().toISOString(),
        error: String(e?.message ?? e),
        paginas: enCurso?.paginas ?? 0,
        productos: enCurso?.productos ?? 0,
      });
      log.warn?.(`[catalogo] ${dia}: no se completó: ${corrida.error}`);
      return { ok: false, corrida, detalle: corrida.error };
    } finally {
      const e = estado();
      e.corridas = [corrida, ...(e.corridas ?? [])].slice(0, MAX_CORRIDAS);
      guardarEstado();
      enCurso = null;
      parar = false;
    }
  }

  /** Cada minuto: si esta activo y es la hora, la foto de hoy. */
  function tick() {
    const c = config();
    if (!c.activo || enCurso) return false;
    const { dia, hora } = ahoraBogota(reloj());
    if (hora !== c.hora || estado().ultimoDia === dia) return false;
    ejecutar({ motivo: "programada" }).catch((e) => log.warn?.("[catalogo] error:", e?.message ?? e));
    return true;
  }

  return {
    config,
    configurar(nueva = {}) {
      cfg = normalizarConfig({ ...config(), ...nueva });
      escribirJson(rutaConfig, cfg);
      return cfg;
    },
    resumen() {
      const ds = dias();
      return {
        config: config(),
        enCurso: enCurso ? { ...enCurso } : null,
        corridas: (estado().corridas ?? []).slice(0, 15),
        dias: ds.length,
        primerDia: ds[0] ?? null,
        ultimoDiaGuardado: ds.at(-1) ?? null,
      };
    },
    dias,
    /** Foto de un dia: Map id -> [stock, precio, sugerido] (o null). */
    async dia(fecha) {
      const j = await leerGz(path.join(dirDias, `${fecha}.json.gz`));
      if (!j?.filas) return null;
      return new Map(j.filas.map(([id, ...resto]) => [id, resto]));
    },
    async fichas() {
      return (await leerGz(rutaProductos))?.productos ?? {};
    },
    ejecutar,
    parar() {
      if (!enCurso) return false;
      parar = true;
      return true;
    },
    tick,
    arrancar() {
      if (timer) return;
      timer = setInterval(tick, 60_000);
      timer.unref?.();
    },
    detener() {
      if (timer) clearInterval(timer);
      timer = null;
      parar = true;
    },
  };
}
