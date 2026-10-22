// Espacios de trabajo de rentabilidad: UNO POR USUARIO del panel.
//
//   usuario (cabecera x-usuario)  ->  server/anuncios/usuarios/<slug>/
//                                       config.json   token, cuentas, trm
//                                       productos.json / manual.json / plan.json
//                                       ganancias.json  ultimo traido de pedidos
//                                       datos_<N>d_<fecha>.json  (cache)
//
// Quien NO conecto su cuenta trabaja sobre el espacio COMPARTIDO (los
// archivos de la raiz de `ANUNCIOS_DIR` + `ANUNCIOS_CONFIG`), que es como
// funcionaba antes: Pizdo + Orenar. Si `compartida: false` en el ajuste
// compartido, cada usuario debe conectar la suya para ver algo.
//
// La conexion es con el token que pega el usuario (Graph API Explorer, 60
// dias): aqui solo se valida contra `/me`, se listan sus cuentas con
// `/me/adaccounts` y se guarda. El intercambio OAuth (boton "Conectar con
// Facebook") queda para cuando la app este en modo Produccion.
import fs from "node:fs";
import path from "node:path";
import { crearAnalisisAnuncios, escribirJson, hoy, leerJson } from "./anunciosMeta.js";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clave de carpeta a partir del email (minusculas, sin caracteres raros). */
export function slugDe(usuario) {
  if (!usuario) return null;
  const s = String(usuario)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@+-]+/g, "_")
    .slice(0, 80);
  return s || null;
}

/** GET al Graph API con reintentos; lanza Error con el mensaje de Meta. */
async function pedir(ruta, { params = {}, token, version = "v25.0", fetcher, intentos = 2 }) {
  const url = new URL(`https://graph.facebook.com/${version}/${ruta}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token })) {
    url.searchParams.set(k, String(v));
  }
  let ultimo = "";
  for (let i = 0; i < intentos; i++) {
    let datos;
    try {
      const res = await fetcher(url.toString(), { signal: AbortSignal.timeout(30000) });
      datos = await res.json();
    } catch (e) {
      ultimo = `error de red: ${e?.message ?? e}`;
      await dormir(300 * (i + 1));
      continue;
    }
    if (datos?.error) {
      ultimo = datos.error.message + (datos.error.code ? ` (codigo ${datos.error.code})` : "");
      if ([1, 4, 17, 32].includes(datos.error.code)) {
        await dormir(400 * (i + 1));
        continue;
      }
      throw new Error(ultimo);
    }
    return datos;
  }
  throw new Error(ultimo || "fallo la peticion a Meta");
}

/**
 * Valida el token y devuelve quien es, sus cuentas publicitarias y, si hay
 * credenciales de app, cuando vence.
 */
export async function identidadMeta({ token, appToken, version = "v25.0", fetcher }) {
  const me = await pedir("me", { params: { fields: "id,name" }, token, version, fetcher });
  if (!me?.id) throw new Error("Meta no devolvio el usuario del token");

  const cuentas = [];
  const campos = "account_id,name,currency,account_status";
  let datos = await pedir("me/adaccounts", {
    params: { fields: campos, limit: 100 },
    token,
    version,
    fetcher,
  });
  for (const a of datos?.data ?? []) {
    if (!a?.account_id) continue;
    cuentas.push({
      id: String(a.account_id),
      nombre: a.name ?? a.account_id,
      moneda: a.currency ?? "USD",
      activa: Number(a.account_status) === 1,
    });
  }
  // la app puede devolver mas de 100 cuentas: seguimos el paging
  let siguiente = datos?.paging?.next;
  let vueltas = 0;
  while (siguiente && vueltas < 10) {
    try {
      const res = await fetcher(siguiente, { signal: AbortSignal.timeout(30000) });
      datos = await res.json();
    } catch {
      break;
    }
    if (datos?.error) break;
    for (const a of datos?.data ?? []) {
      if (!a?.account_id) continue;
      if (!cuentas.some((c) => c.id === String(a.account_id))) {
        cuentas.push({
          id: String(a.account_id),
          nombre: a.name ?? a.account_id,
          moneda: a.currency ?? "USD",
          activa: Number(a.account_status) === 1,
        });
      }
    }
    siguiente = datos.paging?.next;
    vueltas++;
  }

  let expira = null;
  if (appToken) {
    try {
      const dbg = await pedir("debug_token", {
        params: { input_token: token },
        token: appToken,
        version,
        fetcher,
        intentos: 1,
      });
      const ms = Number(dbg?.data?.expires_at);
      if (Number.isFinite(ms) && ms > 0) expira = new Date(ms * 1000).toISOString().slice(0, 10);
    } catch {
      /* debug_token es opcional: sin el no se muestra la fecha de caducidad */
    }
  }

  return { usuario: { id: String(me.id), nombre: me.name ?? "" }, cuentas, expira };
}

// --------------------------------------------------------------- registro

/**
 * @param {object} o
 * @param {string} o.baseDir         ANUNCIOS_DIR (raiz compartida + usuarios/)
 * @param {string} o.rutaCompartida  ANUNCIOS_CONFIG (ajustes compartidos)
 * @param {typeof fetch} [o.fetcher]
 * @param {object} [o.lucid]         cliente de LucidSales (para traer las
 *                                   ganancias de los pedidos; opcional)
 */
export function crearRegistroAnuncios({
  baseDir,
  rutaCompartida,
  fetcher = globalThis.fetch,
  lucid = null,
}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const instancias = new Map();

  const dirUsuarios = path.join(baseDir, "usuarios");
  const dirPersonal = (slug) => path.join(dirUsuarios, slug);
  const rutaPersonal = (slug) => path.join(dirPersonal(slug), "config.json");
  const compartido = () =>
    leerJson(rutaCompartida, { token: "", trm: 1, cuentas: [], version: "v25.0" });

  /** Instancia del espacio donde trabaja este usuario. */
  function instancia(usuario) {
    const slug = slugDe(usuario);
    const propio = Boolean(slug && fs.existsSync(rutaPersonal(slug)));
    const dir = propio ? dirPersonal(slug) : baseDir;
    const rutaAjustes = propio ? rutaPersonal(slug) : rutaCompartida;
    if (!instancias.has(dir)) {
      instancias.set(dir, crearAnalisisAnuncios({ dir, rutaAjustes, fetcher, lucid }));
    }
    return { slug, propio, tenant: instancias.get(dir) };
  }

  /** Estado de la conexion de este usuario (para el panel). */
  function estado(usuario) {
    const slug = slugDe(usuario);
    const cfg = slug && fs.existsSync(rutaPersonal(slug)) ? leerJson(rutaPersonal(slug), null) : null;
    const comp = compartido();
    const compartidaDisponible = comp.compartida !== false;
    const base = { usuario: usuario ?? null, compartidaDisponible };

    if (cfg?.token) {
      const candidatas = Array.isArray(cfg.candidatas) ? cfg.candidatas : [];
      const elegidas = Array.isArray(cfg.cuentas) ? cfg.cuentas : [];
      return {
        ...base,
        enUso: "propia",
        conectada: true,
        nombre: cfg.nombre ?? null,
        trm: Number(cfg.trm) || Number(comp.trm) || 1,
        expira: cfg.expira ?? null,
        conectado: cfg.conectado ?? null,
        cuentas: (candidatas.length ? candidatas : elegidas).map((c) => ({
          id: String(c.id),
          nombre: c.nombre ?? String(c.id),
          moneda: c.moneda ?? "USD",
          activa: c.activa !== false,
          seleccionada: elegidas.some((e) => String(e.id) === String(c.id)),
        })),
      };
    }

    if (compartidaDisponible) {
      return {
        ...base,
        enUso: "compartida",
        // "conectada" es del espacio EN USO: aqui, del token compartido
        conectada: Boolean(comp.token),
        nombre: comp.nombreEspacio ?? null,
        trm: Number(comp.trm) || 1,
        expira: null,
        conectado: null,
        cuentas: (comp.cuentas ?? []).map((c) => ({
          id: String(c.id),
          nombre: c.nombre ?? String(c.id),
          moneda: c.moneda ?? "COP",
          activa: true,
          seleccionada: true,
        })),
      };
    }

    return {
      ...base,
      enUso: "ninguna",
      conectada: false,
      nombre: null,
      trm: Number(comp.trm) || 1,
      expira: null,
      conectado: null,
      cuentas: [],
    };
  }

  /** Valida el token pegado, lo guarda y devuelve las cuentas candidatas. */
  async function conectar(usuario, token) {
    const slug = slugDe(usuario);
    if (!slug) {
      throw new Error("Falta el usuario (cabecera x-usuario): no se a quien guardarle la cuenta");
    }
    const t = String(token ?? "").trim();
    if (t.length < 20) throw new Error("El token de Meta parece incompleto");

    const comp = compartido();
    const appToken = comp.appId && comp.appSecret ? `${comp.appId}|${comp.appSecret}` : null;
    const id = await identidadMeta({
      token: t,
      appToken,
      version: comp.version || "v25.0",
      fetcher,
    });
    if (!id.cuentas.length) {
      throw new Error(
        `El token es valido (${id.usuario.nombre || id.usuario.id}) pero no tiene cuentas publicitarias visibles: pide un token con el permiso ads_read de una cuenta que administres.`,
      );
    }

    const previo = fs.existsSync(rutaPersonal(slug)) ? leerJson(rutaPersonal(slug), {}) : {};
    escribirJson(rutaPersonal(slug), {
      token: t,
      version: comp.version || "v25.0",
      trm: Number(previo.trm) || Number(comp.trm) || 1,
      trmFecha: previo.trmFecha ?? comp.trmFecha ?? null,
      usuario: slug,
      nombre: id.usuario.nombre,
      metaId: id.usuario.id,
      conectado: hoy(),
      expira: id.expira,
      // lo que ya tenia elegido se mantiene si sigue en la lista nueva
      cuentas: (previo.cuentas ?? []).filter((e) =>
        id.cuentas.some((c) => c.id === String(e.id)),
      ),
      candidatas: id.cuentas,
    });

    const cfg = leerJson(rutaPersonal(slug), {});
    return {
      usuario: id.usuario,
      expira: id.expira,
      seleccionadas: (cfg.cuentas ?? []).length,
      cuentas: id.cuentas.map((c) => ({
        ...c,
        seleccionada: (cfg.cuentas ?? []).some((e) => e.id === c.id),
      })),
    };
  }

  /** Elige que cuentas entran al analisis (y opcionalmente la TRM). */
  function guardarCuentas(usuario, { cuentas, trm } = {}) {
    const slug = slugDe(usuario);
    if (!slug || !fs.existsSync(rutaPersonal(slug))) {
      throw new Error("Primero hay que conectar una cuenta de Meta");
    }
    const cfg = leerJson(rutaPersonal(slug), {});
    const candidatas = cfg.candidatas ?? [];
    const ids = Array.isArray(cuentas) ? cuentas.map(String) : [];
    if (!ids.length) throw new Error("Elige al menos una cuenta publicitaria");

    const elegidas = ids.map((id) => {
      const c = candidatas.find((x) => String(x.id) === id);
      if (!c) throw new Error(`La cuenta ${id} no esta en la lista que devolvio Meta`);
      return { id: String(c.id), nombre: c.nombre, moneda: c.moneda };
    });

    cfg.cuentas = elegidas;
    if (trm !== undefined && trm !== null && String(trm).trim() !== "") {
      const v = Number(trm);
      if (Number.isNaN(v) || v <= 0) throw new Error("La TRM debe ser un numero mayor que 0");
      cfg.trm = v;
      cfg.trmFecha = hoy();
    }
    escribirJson(rutaPersonal(slug), cfg);
    return { cuentas: elegidas, trm: cfg.trm };
  }

  /** Borra el token (y opcionalmente todos los datos del usuario). */
  function desconectar(usuario, { borrar } = {}) {
    const slug = slugDe(usuario);
    if (!slug) throw new Error("Falta el usuario (cabecera x-usuario)");
    const dir = dirPersonal(slug);
    if (!fs.existsSync(rutaPersonal(slug))) {
      return { ok: true, msg: "No tenias ninguna cuenta conectada" };
    }
    if (borrar) {
      fs.rmSync(dir, { recursive: true, force: true });
      instancias.delete(dir);
      return { ok: true, msg: "Cuenta desconectada y datos borrados" };
    }
    fs.rmSync(rutaPersonal(slug), { force: true });
    instancias.delete(dir);
    return {
      ok: true,
      msg: "Cuenta desconectada. Vuelves a ver la cuenta compartida; tus productos y tu plan se guardan por si reconectas.",
    };
  }

  /**
   * Fachada del espacio del usuario: la misma API del modulo de analisis mas
   * los metodos de conexion.
   */
  function para(usuario) {
    const { slug, propio, tenant } = instancia(usuario);
    return {
      usuario: slug,
      propio,
      datos: tenant.datos,
      crudo: tenant.crudo,
      guardarGanancia: tenant.guardarGanancia,
      plan: tenant.plan,
      marcarPlan: tenant.marcarPlan,
      csv: tenant.csv,
      ajustes: tenant.ajustes,
      rutas: tenant.rutas,
      estadoGanancias: tenant.estadoGanancias,
      traerGanancias: (v) => tenant.traerGanancias(v),
      gananciasAjustes: (v) => tenant.gananciasAjustes(v),
      gananciasAuto: (v) => tenant.gananciasAuto(v),
      estado: () => estado(usuario),
      conectar: (token) => conectar(usuario, token),
      guardarCuentas: (v) => guardarCuentas(usuario, v),
      desconectar: (v) => desconectar(usuario, v),
    };
  }

  return { para, estado, conectar, guardarCuentas, desconectar, slugDe, _instancias: instancias };
}
