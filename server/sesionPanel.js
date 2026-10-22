// Acceso del PANEL al backend: verifica la sesion real de LucidSales.
//
// El panel manda su token de LucidSales (x-token, el de /auth/addShopId) y la
// tienda activa (x-tienda). El servidor NO cree lo que dice el navegador: le
// pregunta a LucidSales con POST /auth/addShopId {id: tienda}. LucidSales solo
// responde ok si el token es valido Y el usuario tiene esa tienda, y devuelve
// su `rol` (permisos) real. El resultado se cachea unos minutos.
//
// Permisos (los mismos numeros que LucidSales, ver panel/src/auth/permisos.ts):
//   2 Pedidos · 3 Clientes · 4 Metricas · 5 Catalogo · 7 Usuarios · 8 Ajustes
//   rol null / "all" / "admin" = acceso total.
import crypto from "node:crypto";
import { ErrorApi } from "./errores.js";

/** Payload de un JWT sin verificar la firma (eso lo hace LucidSales). */
export function payloadJWT(token) {
  try {
    const parte = String(token ?? "").split(".")[1];
    if (!parte) return {};
    return JSON.parse(Buffer.from(parte.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) ?? {};
  } catch {
    return {};
  }
}

/** "2,5" | '["2","5"]' | "all" | null -> {total, numeros[]} */
export function leerRol(rol) {
  if (rol === null || rol === undefined) return { total: true, numeros: [] };
  const t = String(rol).trim().toLowerCase();
  if (t === "all" || t === "admin") return { total: true, numeros: [] };
  let numeros = [];
  if (t.startsWith("[")) {
    try {
      numeros = JSON.parse(t).map((x) => String(x).trim());
    } catch {
      numeros = [];
    }
  }
  if (!numeros.length) numeros = t.split(",").map((x) => x.replace(/["'[\]\s]/g, "")).filter(Boolean);
  return { total: false, numeros };
}

export function tienePermiso(sesion, numero) {
  if (!numero) return true;
  if (!sesion) return false;
  if (sesion.interna || sesion.rol?.total) return true;
  return sesion.rol?.numeros?.includes(String(numero)) ?? false;
}

/** El usuario tiene acceso a esa tienda (las que devolvio LucidSales). */
export function tieneTienda(sesion, tienda) {
  if (sesion?.interna) return true;
  const t = String(tienda ?? "").trim();
  if (!t) return true;
  return (sesion?.idEmpresa ?? []).map(String).includes(t);
}

export function crearVerificadorSesion({
  base,
  fetcher = fetch,
  ttlMs = 5 * 60 * 1000,
  timeoutMs = 15000,
  log = console,
} = {}) {
  const raiz = String(base ?? "https://panel.lucidsales.co/b").replace(/\/+$/, "");
  const cache = new Map(); // hash(token|tienda) -> {expira, sesion}

  function clave(token, tienda) {
    return crypto.createHash("sha256").update(`${token}|${tienda}`).digest("hex");
  }

  function limpiarCache() {
    const ahora = Date.now();
    for (const [k, v] of cache) if (v.expira <= ahora) cache.delete(k);
  }

  /**
   * Devuelve la sesion verificada o lanza ErrorApi 401/403/503.
   *   { usuario: {id, email, nombre}, rol: {total, numeros}, idEmpresa: [], tienda }
   */
  async function verificar(token, tienda) {
    const tk = String(token ?? "").trim();
    if (!tk) throw new ErrorApi(401, "Falta la sesión de LucidSales (inicia sesión en el panel)");
    // LucidSales guarda al usuario DENTRO de `uid` ({id, email, name, rol,
    // tiendaActiva, ...}); algunos tokens viejos lo traen plano.
    const crudo = payloadJWT(tk);
    const payload = crudo?.uid && typeof crudo.uid === "object" ? { ...crudo, ...crudo.uid } : crudo;
    const tiendaPedida = String(tienda || payload?.tiendaActiva || "").trim();
    if (!/^\d{1,12}$/.test(tiendaPedida)) {
      throw new ErrorApi(401, "La sesión no tiene una tienda activa: vuelve a elegir la tienda en el panel");
    }

    const k = clave(tk, tiendaPedida);
    const enCache = cache.get(k);
    if (enCache && enCache.expira > Date.now()) return enCache.sesion;

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      r = await fetcher(`${raiz}/auth/addShopId`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-token": tk },
        body: JSON.stringify({ id: Number(tiendaPedida) }),
      });
    } catch (e) {
      throw new ErrorApi(
        503,
        e?.name === "AbortError"
          ? "LucidSales no respondió a tiempo al verificar la sesión"
          : `No se pudo verificar la sesión con LucidSales: ${e?.message ?? e}`,
      );
    } finally {
      clearTimeout(t);
    }
    const datos = await r.json().catch(() => null);
    if (r.status === 401) throw new ErrorApi(401, "Sesión de LucidSales vencida o inválida: vuelve a iniciar sesión");
    if (!r.ok || !datos?.ok) {
      // token valido pero sin acceso a esa tienda (o error de LucidSales)
      throw new ErrorApi(
        r.status >= 500 ? 503 : 403,
        `LucidSales no autorizó la tienda ${tiendaPedida}${datos?.msg ? `: ${datos.msg}` : ""}`,
      );
    }

    const idEmpresa = (Array.isArray(datos.idEmpresa)
      ? datos.idEmpresa
      : String(datos.idEmpresa ?? "").split(",")
    )
      .map((x) => String(x).trim())
      .filter(Boolean);
    const email = String(payload.email ?? payload.correo ?? payload.usuario ?? "").trim().toLowerCase();
    const sesion = {
      usuario: {
        id: payload.id ?? (typeof payload.uid === "object" ? null : payload.uid) ?? payload.sub ?? null,
        email: email || null,
        nombre: payload.name ?? payload.nombre ?? null,
      },
      rol: leerRol(datos.rol ?? payload.rol ?? null),
      idEmpresa: idEmpresa.length ? idEmpresa : [tiendaPedida],
      tienda: tiendaPedida,
    };
    // LucidSales acepto el token para esa tienda: la tienda es suya
    if (!sesion.idEmpresa.includes(tiendaPedida)) sesion.idEmpresa.push(tiendaPedida);

    if (cache.size > 500) limpiarCache();
    cache.set(k, { expira: Date.now() + ttlMs, sesion });
    log.log?.(`[acceso] sesión verificada: ${sesion.usuario.email ?? `id ${sesion.usuario.id ?? "?"}`} · tienda ${tiendaPedida}`);
    return sesion;
  }

  return { verificar, limpiar: () => cache.clear() };
}
