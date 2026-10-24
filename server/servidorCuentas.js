// Servidor con VARIAS cuentas: cada peticion va a la cuenta dueña de la
// tienda (panel) o de la clave de API (Lucid Bot y otras integraciones), y
// esa cuenta la atiende con SUS servicios y SUS archivos. Una tienda que no
// es de ninguna cuenta no entra.
//
//   /api/cuentas   -> administrar cuentas (solo superadmin)
//   /api/cuenta    -> la cuenta de quien pregunta (nombre y tiendas)
import http from "node:http";
import { ErrorApi } from "./errores.js";
import { mensajeDeError } from "./estado.js";
import { crearManejador } from "./servidor.js";
import { crearVerificadorSesion, tiendaDePeticion, tienePermiso } from "./sesionPanel.js";

const RUTAS_PUBLICAS = [/^\/api\/salud$/, /^\/api\/interrapidisimo\//];
const LIMITE = 64 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on("data", (t) => {
      total += t.length;
      if (total > LIMITE) {
        reject(new ErrorApi(413, "Cuerpo demasiado grande"));
        req.destroy();
      } else trozos.push(t);
    });
    req.on("end", () => {
      const txt = Buffer.concat(trozos).toString("utf8");
      if (!txt) return resolve({});
      try {
        resolve(JSON.parse(txt));
      } catch {
        reject(new ErrorApi(400, "JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, datos) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(datos));
}

/**
 * registro: crearRegistroCuentas()
 * crearServicios(cuenta) -> servicios de la cuenta (crearServiciosCuenta)
 * comunes: lo que comparten todas (inter, anuncios, panel)
 */
export function crearServidorCuentas({ config, registro, crearServicios, comunes = {}, verificarSesion = null, log = console }) {
  const sesiones = verificarSesion ?? crearVerificadorSesion({ base: config.LUCID_BASE });
  /** id de cuenta -> { servicios, manejador } (se crean al usarse o al crear la cuenta) */
  const activas = new Map();
  const unaSola = () => registro.lista().length === 1;

  function de(cuenta) {
    let x = activas.get(cuenta.id);
    if (x) return x;
    const servicios = crearServicios(cuenta);
    const manejador = crearManejador({
      ...comunes,
      config: servicios.config,
      cliente: servicios.cliente,
      historial: servicios.historial,
      asignacion: servicios.asignacion,
      reparto: servicios.reparto,
      credenciales: servicios.credenciales,
      llmConfig: servicios.llmConfig,
      validadorDireccion: servicios.validadorDireccion,
      conversacion: servicios.conversacion,
      dropiCliente: servicios.dropiCliente,
      dropiNavegador: servicios.dropiNavegador,
      subidaAuto: servicios.subidaAuto,
      lucidBotContactos: servicios.lucidBotContactos,
      resolverProductoDropi: servicios.resolverProductoDropi,
      productosDropi: servicios.productosDropi,
      estadosEnvio: servicios.estadosEnvio,
      apiKeys: servicios.apiKeys,
      pedidosLucidBot: servicios.pedidosLucidBot,
      registroIntentos: servicios.registroIntentos,
      verificarSesion: sesiones,
      // con una sola cuenta todo funciona como antes; con varias, cada una
      // solo admite sus tiendas
      tiendasCuenta: () => (unaSola() ? null : registro.get(cuenta.id)?.tiendas ?? []),
    });
    x = { servicios, manejador };
    activas.set(cuenta.id, x);
    return x;
  }

  /** Arranca los trabajos automaticos de todas las cuentas activas. */
  function arrancar() {
    for (const c of registro.lista()) {
      if (!c.activa) continue;
      de(c).servicios.arrancar();
    }
  }

  function detener() {
    for (const { servicios } of activas.values()) servicios.detener();
  }

  /** ¿Quien pide puede administrar cuentas? */
  async function superadmin(req) {
    const token = String(req.headers["x-token"] ?? "").trim();
    if (!token) throw new ErrorApi(401, "Inicia sesión en el panel");
    const sesion = await sesiones.verificar(token, req.headers["x-tienda"]);
    const email = String(sesion.usuario?.email ?? "").toLowerCase();
    const principal = registro.get(1)?.tiendas ?? [];
    const ok =
      (email && config.SUPERADMINS.includes(email)) ||
      // mientras solo exista ZuntoStore, su admin (Ajustes Tienda) administra
      ((principal.includes(String(sesion.tienda)) || unaSola()) && tienePermiso(sesion, "8"));
    if (!ok) throw new ErrorApi(403, "Solo quien administra ZuntoStore puede ver y crear cuentas");
    return sesion;
  }

  /** Lo que el panel ve de una cuenta (nada secreto). */
  function vista(c) {
    const x = activas.get(c.id);
    const s = x?.servicios;
    let subida = null;
    try {
      const sc = s?.subidaAuto?.config?.();
      subida = sc ? { automatico: Boolean(sc.automatico), dryRun: sc.dryRun !== false } : null;
    } catch {
      /* sin datos */
    }
    return {
      ...c,
      lucidsales: s ? Boolean(s.config.LUCID_EMAIL && s.config.LUCID_PASSWORD) : null,
      subida,
      sesionDropi: s?.subidaAuto?.sesion?.()?.estado ?? null,
    };
  }

  async function administrar(req, res, ruta) {
    if (ruta === "/api/cuenta" && req.method === "GET") {
      const tienda = tiendaDePeticion(req.headers);
      const c = tienda ? registro.deTienda(tienda) : null;
      json(res, 200, { ok: true, cuenta: c ? { id: c.id, nombre: c.nombre, tiendas: c.tiendas } : null });
      return;
    }
    const sesionAdmin = await superadmin(req);
    if (ruta === "/api/cuentas" && req.method === "GET") {
      json(res, 200, { ok: true, cuentas: registro.lista().map(vista) });
      return;
    }
    if (ruta === "/api/cuentas" && req.method === "POST") {
      const b = await leerCuerpo(req);
      const nuevas = (Array.isArray(b?.tiendas) ? b.tiendas : []).map(String);
      let c;
      try {
        // la segunda cuenta activa la separacion: la tienda con la que entra
        // quien administra queda en ZuntoStore para no quedarse por fuera
        const t = String(sesionAdmin?.tienda ?? "");
        const c1 = registro.get(1);
        if (unaSola() && /^\d+$/.test(t) && !nuevas.includes(t) && !c1.tiendas.includes(t)) {
          registro.actualizar(1, { tiendas: [...c1.tiendas, t] });
        }
        c = registro.crear({ nombre: b?.nombre, tiendas: nuevas });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      de(c).servicios.arrancar();
      log.log?.(`[cuentas] cuenta ${c.id} «${c.nombre}» creada (tiendas ${c.tiendas.join(", ") || "ninguna"})`);
      json(res, 200, { ok: true, cuenta: vista(c) });
      return;
    }
    const m = ruta.match(/^\/api\/cuentas\/(\d+)$/);
    if (m && req.method === "PUT") {
      const b = await leerCuerpo(req);
      let c;
      try {
        c = registro.actualizar(Number(m[1]), {
          nombre: b?.nombre,
          tiendas: Array.isArray(b?.tiendas) ? b.tiendas : undefined,
          activa: typeof b?.activa === "boolean" ? b.activa : undefined,
        });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      if (!c.activa) activas.get(c.id)?.servicios.detener();
      else de(c).servicios.arrancar();
      log.log?.(`[cuentas] cuenta ${c.id} «${c.nombre}» actualizada`);
      json(res, 200, { ok: true, cuenta: vista(c) });
      return;
    }
    throw new ErrorApi(404, `Ruta no encontrada: ${req.method} ${ruta}`);
  }

  /** ¿A que cuenta va esta peticion? */
  function cuentaDe(req, ruta) {
    const clave = req.headers["x-api-key"];
    if (clave) {
      for (const c of registro.lista()) {
        if (!c.activa) continue;
        if (de(c).servicios.apiKeys.valida(clave)) return c;
      }
      return registro.get(1); // clave que no es de nadie: la cuenta 1 responde 401
    }
    const tienda = tiendaDePeticion(req.headers);
    if (tienda) {
      const c = registro.deTienda(tienda);
      if (c) return c;
      // una sola cuenta: todo va a ZuntoStore, como antes de las cuentas
      if (unaSola() || RUTAS_PUBLICAS.some((re) => re.test(ruta))) return registro.get(1);
      throw new ErrorApi(
        403,
        `La tienda ${tienda} no tiene cuenta en ZuntoStore. Pídele a quien administra ZuntoStore que la agregue.`,
      );
    }
    return registro.get(1);
  }

  async function atender(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const ruta = url.pathname;
      // el panel (archivos y /b) no es de ninguna cuenta
      if (comunes.panel && (await comunes.panel.manejar(req, res, url))) return;
      if (req.method === "OPTIONS") return de(registro.get(1)).manejador.atender(req, res);
      if (ruta === "/api/cuenta" || ruta === "/api/cuentas" || ruta.startsWith("/api/cuentas/")) {
        await administrar(req, res, ruta);
        return;
      }
      const c = cuentaDe(req, ruta);
      await de(c).manejador.atender(req, res);
    } catch (err) {
      const e = mensajeDeError(err);
      if (res.headersSent) return void res.end();
      json(res, e.status ?? 500, { ok: false, msg: e.message });
      if ((e.status ?? 500) >= 500) log.error?.("[error]", e.status, e.message);
    }
  }

  const server = http.createServer((req, res) => void atender(req, res));
  return { server, arrancar, detener, de, atender };
}
