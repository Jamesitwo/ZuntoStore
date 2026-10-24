// Servidor HTTP del backend propio (sin dependencias: solo node:http).
//
//   GET    /api/salud                       -> estado del servicio (publico)
//   GET    /api/historial?limite=50         -> ultimos cambios (x-api-key)
//   POST   /api/pedidos/:id/estado          -> cambiar estado (x-api-key)
//   POST   /api/pedidos/:id/conversacion    -> guardar el chat del pedido (x-api-key)
//   GET    /api/pedidos/:id/conversacion    -> leer el chat del pedido (x-api-key)
//   POST   /api/pedidos/:id/validar         -> agente: valida y dice subir/frenar (x-api-key)
//   POST   /api/pedidos/:id/subir           -> valida y sube a Dropi con seguro
//                                              (body.via:"navegador" = por la UI)
//   GET    /api/subida                       -> estado de la subida automatica
//   PUT    /api/subida/config                -> encender/apagar/configurar
//   POST   /api/subida/probar                -> ejecuta una vuelta ahora mismo
//   GET    /api/interrapidisimo/oficina     -> oficina por municipio (publico)
//   GET    /api/interrapidisimo/oficinas    -> TODAS las oficinas del municipio (publico)
//   GET    /api/interrapidisimo/municipios  -> buscar municipios de Inter (publico)
//   GET    /api/asignacion?idEmpresa=       -> horarios + asignaciones (x-api-key)
//   PUT    /api/asignacion/horario          -> guardar/borrar el horario de un usuario
//   PUT    /api/asignacion/config           -> encender/apagar el reparto automatico
//   POST   /api/asignacion/probar           -> ejecuta una vuelta ahora mismo
//   GET    /api/credenciales                -> si hay credenciales (correo enmascarado)
//   PUT    /api/credenciales                -> guarda email/clave sin reiniciar
//   DELETE /api/credenciales                -> las borra
//   POST   /api/asignacion/repartir         -> repartir pedidos equitativamente
//   DELETE /api/asignacion/pedido/:id       -> desasignar un pedido
//   POST   /api/asignacion/limpiar          -> borrar asignaciones de una tienda
//   GET    /api/anuncios?dias=7|15|30       -> rentabilidad de campanas Meta (x-api-key)
//   POST   /api/anuncios/actualizar         -> baja datos frescos de Meta (forzar)
//   POST   /api/anuncios/ganancia           -> {nombre, ganancia} recalcula todo
//   GET    /api/anuncios/plan               -> seguimiento de las acciones marcadas
//   POST   /api/anuncios/plan               -> {id, hecho?, nota?}
//   GET    /api/anuncios/csv?dias=&vista=   -> descarga CSV (campanas|alertas|productos)
//   GET    /api/anuncios/ganancias          -> ajustes, progreso y ultimo traido
//   POST   /api/anuncios/ganancias          -> {dias?, forzar?, esperar?} trae las
//                                              ganancias reales de los pedidos
//   POST   /api/anuncios/ganancias/ajustes  -> {auto?, minPedidos?, tienda?, dias?,
//                                              incluirEstados?}
//   GET    /api/anuncios/cuenta             -> estado de la cuenta Meta del usuario
//   POST   /api/anuncios/conectar           -> {token} valida el token y lista /me/adaccounts
//   POST   /api/anuncios/cuentas            -> {cuentas[], trm?} que cuentas entran al analisis
//   POST   /api/anuncios/desconectar        -> {borrar?} quita el token (y sus datos)
//
// Cuerpo del cambio: { "estado": 2, "motivo": "opcional" }
// Cuerpo del reparto: { usuarios:[{usuario,nombre}], pedidos:[id...],
//                       modo:"todos"|"horario", idEmpresa, reasignar, ahora }
// Cuerpo de config:   { automatico, cadaSegundos, modo, tiendas[], estados[] }
import http from "node:http";
import crypto from "node:crypto";
import { ErrorApi } from "./errores.js";
import { cambiarEstado, construirBody, mensajeDeError, ESTADOS_PEDIDO } from "./estado.js";
import { crearValidadorDireccion } from "./validadorDireccion.js";
import { crearClienteInter, normalizar } from "./interrapidisimo.js";
import { crearLucidDeSesion } from "./lucidsales.js";
import { crearAsignacion } from "./asignacion.js";
import { crearCredenciales } from "./credenciales.js";
import { crearConversaciones } from "./conversacion.js";
import { crearExtractorLLM, probarLLM } from "./llm.js";
import { crearConfigLLM } from "./llmConfig.js";
import { ejecutarAgente, resumenDePedido } from "./agente.js";
import { crearClienteDropi, armarPedidoDropi } from "./dropi.js";
import { crearDropiNavegador } from "./dropiNavegador.js";
import { crearSubidaAutomatica } from "./subidaAutomatica.js";
import { faltantesDeConfig } from "./config.js";
import { crearEstadosEnvio } from "./estadosEnvio.js";
import { crearPedidosPorEnvio } from "./pedidosPorEnvio.js";
import { crearApiKeys } from "./apiKeys.js";
import { crearVerificadorSesion, tienePermiso, tieneTienda } from "./sesionPanel.js";
import { direccionConReferencias, recogeEnOficina } from "./direccionColombia.js";

const LIMITE_CUERPO = 256 * 1024; // 256 KB
const VERSION = "1.0.0";

function leerCuerpo(req, limite = LIMITE_CUERPO) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    let excedido = false;
    req.on("data", (c) => {
      if (excedido) return; // se descarta el resto sin cortar la conexion
      total += c.length;
      if (total > limite) {
        // no se destruye la conexion: asi el navegador recibe el 413 con su
        // mensaje en vez de un "no se pudo conectar"
        excedido = true;
        trozos.length = 0;
        return;
      }
      trozos.push(c);
    });
    req.on("end", () => {
      if (excedido) {
        reject(new ErrorApi(413, `El cuerpo de la peticion es demasiado grande (maximo ${Math.round(limite / 1024)} KB)`));
        return;
      }
      const texto = Buffer.concat(trozos).toString("utf8");
      if (!texto) return resolve({});
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new ErrorApi(400, "El cuerpo no es JSON valido"));
      }
    });
    req.on("error", reject);
  });
}

export function crearServidor({
  config,
  cliente,
  historial,
  inter,
  asignacion,
  reparto,
  credenciales,
  llmConfig,
  validadorDireccion,
  anuncios,
  conversacion,
  dropiCliente,
  dropiNavegador,
  subidaAuto,
  lucidBotContactos,
  resolverProductoDropi,
  productosDropi = null,
  verificarSesion,
  panel = null,
  estadosEnvio = null,
  apiKeys = null,
  pedidosLucidBot = null,
}) {
  // clave de integraciones: la de la variable API_KEY y/o la generada en el panel
  const claves = apiKeys ?? crearApiKeys({ claveEnv: config.API_KEY });
  // estado del envio que manda Lucid Bot (sin instancia: solo memoria)
  const envios = estadosEnvio ?? crearEstadosEnvio({ ruta: null });
  const buscadorEnvios = crearPedidosPorEnvio({ envios });
  // acceso del panel: sesion real de LucidSales (x-token + x-tienda)
  const sesiones = verificarSesion ?? crearVerificadorSesion({ base: config.LUCID_BASE });
  const interCliente = inter ?? crearClienteInter(config);
  const asig =
    asignacion ?? crearAsignacion(config.ASIGNACION ?? "./asignacion.json", { zona: config.TZ_ASIGNACION });
  // sin instancia (pruebas aisladas): solo memoria, no toca disco
  const cred = credenciales ?? crearCredenciales({ ruta: null, config });
  const llmCfg = llmConfig ?? crearConfigLLM({ ruta: null, config });

  // conversacion del pedido (chat) + extractor LLM que la lee
  const conv = conversacion ?? crearConversaciones(config.CONVERSACION ?? "./conversacion.jsonl");
  const extraer = crearExtractorLLM(config);
  // Dropi: subida de pedidos con el seguro antidevoluciones
  const dropi = dropiCliente ?? crearClienteDropi(config);
  // ...y por navegador, que es la via que funciona (la API no acepta externos)
  const dropiNav = dropiNavegador ?? crearDropiNavegador(config);
  // subida automatica: revisa pedidos nuevos y los sube solo si todo calza
  // validador de direcciones propio (formato + Google Maps)
  const validador = validadorDireccion ?? crearValidadorDireccion({ ruta: null, config });
  const subida =
    subidaAuto ??
    crearSubidaAutomatica({
      cliente,
      conversacion: conv,
      extraer,
      dropiNav,
      asignacion: asig,
      config,
      lucidBotContactos,
      ruta: config.SUBIDA_AUTO,
      validadorDireccion: validador,
      buscarOficinasInter: ({ ciudad, departamento }) =>
        interCliente.oficinasCompletas?.({ municipio: ciudad, departamento }) ?? { oficinas: [] },
    });
  const CORS = {
    "Access-Control-Allow-Origin": config.CORS_ORIGIN,
    "Access-Control-Allow-Headers": "content-type, x-api-key, x-token, x-origen, x-usuario, x-tienda",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  const SEGURIDAD = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
  };

  function json(res, status, datos) {
    const contexto = res.__notificacionLucidBot;
    if (contexto && lucidBotContactos?.notificar) {
      delete res.__notificacionLucidBot;
      // La notificación no puede impedir ni cambiar el resultado de Dropi.
      void (async () => {
        let pedido = contexto.pedido ?? null;
        if (!pedido) {
          try { pedido = await cliente.obtenerPedido(contexto.id, contexto.tienda); } catch { /* se envía sin datos si upstream falla */ }
        }
        const resultado = datos?.resultadoIncierto
          ? "incierto"
          : datos?.subido === true
            ? "exitoso"
            : datos?.dryRun || datos?.subido === false && datos?.preparado
              ? "preparado"
              : status >= 400 || datos?.ok === false
                ? "fallido"
                : null;
        if (!resultado || resultado === "preparado") return escribirJson(res, status, datos);
        const aviso = await lucidBotContactos.notificar({
          pedido,
          resultado,
          detalle: datos?.avisoEstado || datos?.detalle || datos?.msg || datos?.motivos?.map((m) => m?.detalle ?? m).join("; ") || "",
          idDropi: datos?.idDropi,
          motivos: datos?.motivos,
          via: contexto.via ?? "Dropi",
        });
        return escribirJson(res, status, {
          ...datos,
          notificacionLucidBot: aviso,
        });
      })().catch((e) => {
        escribirJson(res, status, { ...datos, notificacionLucidBot: { ok: false, detalle: e?.message ?? String(e) } });
      });
      return;
    }
    return escribirJson(res, status, datos);
  }

  function escribirJson(res, status, datos) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      ...SEGURIDAD,
      ...CORS,
    });
    res.end(JSON.stringify(datos));
  }

  async function conversacionActual(id, pedido = null, tienda) {
    const guardada = conv.porPedido(id);
    const fuente = pedido ?? await cliente.obtenerPedido(id, tienda);
    if (lucidBotContactos?.obtenerConversacion) {
      const actual = await lucidBotContactos.obtenerConversacion({
        pedido: fuente,
        chatUrl: guardada?.meta?.chatUrl ?? guardada?.meta?.chat_url ?? guardada?.meta?.inboxUrl ?? "",
      });
      if (actual.configurado) return actual;
    }
    return guardada
      ? { ok: true, contactId: null, mensajes: guardada.mensajes ?? [], total: guardada.mensajes?.length ?? 0, fuente: "local" }
      : { ok: false, configurado: false, mensajes: [], total: 0, detalle: "No hay conversación disponible" };
  }

  /** Descarga de archivo (CSV con BOM, se abre directo en Excel). */
  function descarga(res, nombre, contenido) {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      ...SEGURIDAD,
      "content-disposition": `attachment; filename="${nombre}"`,
      ...CORS,
    });
    res.end(contenido);
  }

  /** Tienda activa del panel (x-tienda): con ella se consultan sus pedidos. */
  function tiendaDe(req) {
    // panel: la tienda VERIFICADA con LucidSales; integracion interna: cabecera
    if (req.__acceso && !req.__acceso.interna) return req.__acceso.tienda;
    const t = String(req.headers["x-tienda"] ?? "").trim();
    return /^\d{1,12}$/.test(t) ? t : undefined;
  }

  /** Quien hace la peticion: el email del panel (x-usuario). */
  function usuarioDe(req) {
    // panel: el usuario VERIFICADO (no se cree a la cabecera)
    if (req.__acceso && !req.__acceso.interna) {
      const u = req.__acceso.usuario;
      const id = u?.id;
      // nunca "[object Object]": si no hay email ni id simple, no hay usuario
      const idSimple = typeof id === "string" || typeof id === "number" ? String(id) : null;
      return u?.email ?? (idSimple ? `id:${idSimple}` : null);
    }
    const u = req.headers["x-usuario"];
    const v = typeof u === "string" ? u.trim() : "";
    return v ? v.slice(0, 120) : null;
  }

  /**
   * Espacio de trabajo de anuncios del usuario que pide: cada usuario del
   * panel tiene el suyo (si no conecto su cuenta, no ve datos de nadie). Va
   * con SU tienda activa y SU sesion de LucidSales para leer catalogo y
   * pedidos. Sin modulo montado no hay endpoint; tambien se acepta un modulo
   * suelto, que es como montan las pruebas aisladas.
   */
  function analisis(req) {
    if (!anuncios) {
      throw new ErrorApi(503, "El modulo de anuncios no esta montado en este servidor");
    }
    if (typeof anuncios.para !== "function") return anuncios;
    const acceso = req.__acceso;
    const delPanel = acceso && !acceso.interna;
    const tiendaCabecera = Number(String(req.headers["x-tienda"] ?? "").trim()) || null;
    const contexto = delPanel
      ? {
          tienda: Number(acceso.tienda) || null,
          lucid: crearLucidDeSesion(config, req.headers["x-token"]),
        }
      : { tienda: tiendaCabecera, lucid: null };
    return anuncios.para(usuarioDe(req), contexto);
  }

  /**
   * Mismo espacio, pero exigiendo que haya algo que mostrar: si el usuario no
   * conecto ninguna cuenta (y no hay espacio compartido) los datos no existen.
   */
  function analisisDatos(req) {
    const a = analisis(req);
    if (a.estado().enUso === "ninguna") {
      throw new ErrorApi(
        409,
        "Este usuario no tiene cuenta de Meta conectada: pega tu token para analizar tus campanas",
      );
    }
    return a;
  }

  /** ¿x-api-key valida? (integraciones servidor-a-servidor, p. ej. el bot) */
  function apiKeyValida(req) {
    return claves.valida(req.headers["x-api-key"]);
  }

  /**
   * Permiso que exige cada ruta (numeros de LucidSales). null = publica.
   * El orden importa: la primera regla que coincide manda.
   */
  const REGLAS_ACCESO = [
    [/^\/api\/salud$/, null],
    [/^\/api\/interrapidisimo\//, null],
    [/^\/api\/pedidos\/[^/]+\/(estado|conversacion|validar|subir)$/, "2"],
    [/^\/api\/pedidos\/[^/]+\/direccion(\/validar)?$/, "2"],
    [/^\/api\/subida\/pedido\/[^/]+$/, "2"],
    [/^\/api\/historial$/, "2"],
    [/^\/api\/envios\/ultimos$/, "8"],
    [/^\/api\/envios\//, "2"],
    [/^\/api\/asignacion\/horario$/, "7"],
    [/^\/api\/asignacion\/(config|probar)$/, "8"],
    [/^\/api\/asignacion(\/|$)/, "2"],
    [/^\/api\/anuncios(\/|$)/, "4"],
    // configuracion sensible: subida, IA, Lucid Bot, sesion de Dropi, credenciales
    [/^\/api\/(subida|llm|lucidbot|dropi|credenciales|mapas|apikey)(\/|$)/, "8"],
  ];
  const NOMBRE_PERMISO = { 2: "Pedidos", 4: "Métricas", 7: "Usuarios y Permisos", 8: "Ajustes Tienda" };

  function permisoDeRuta(ruta) {
    for (const [re, permiso] of REGLAS_ACCESO) if (re.test(ruta)) return { publica: permiso === null, permiso };
    // cualquier otra ruta de la API: solo administradores
    return { publica: false, permiso: "8" };
  }

  /**
   * Control central de acceso. Deja en req.__acceso quien es:
   *  - integracion interna con x-api-key (acceso total, sin usuario de panel)
   *  - usuario del panel verificado con LucidSales (x-token + x-tienda)
   */
  async function controlarAcceso(req, ruta) {
    const { publica, permiso } = permisoDeRuta(ruta);
    if (publica) return;
    if (apiKeyValida(req)) {
      req.__acceso = { interna: true, usuario: null };
      return;
    }
    const token = String(req.headers["x-token"] ?? "").trim();
    if (!token) {
      throw new ErrorApi(401, "Inicia sesión en el panel: falta la sesión de LucidSales");
    }
    const sesion = await sesiones.verificar(token, req.headers["x-tienda"]);
    if (!tienePermiso(sesion, permiso)) {
      throw new ErrorApi(
        403,
        `Tu usuario no tiene el permiso «${NOMBRE_PERMISO[permiso] ?? permiso}» (${permiso}) de LucidSales para esto`,
      );
    }
    req.__acceso = sesion;
  }

  /** Las rutas protegidas ya pasaron por controlarAcceso; esto lo asegura. */
  function autorizar(req) {
    if (!req.__acceso) throw new ErrorApi(401, "Acceso no verificado");
  }

  /** Una tienda pedida por parametro tiene que ser del usuario. */
  function exigirTienda(req, tienda) {
    if (!tieneTienda(req.__acceso, tienda)) {
      throw new ErrorApi(403, `No tienes acceso a la tienda ${tienda}`);
    }
  }

  /** El panel servido por este mismo servidor (mismo dominio): siempre permitido. */
  function mismoOrigen(req, origen) {
    if (!panel) return false;
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
    if (!host) return false;
    try {
      return new URL(origen).host === host;
    } catch {
      return false;
    }
  }

  async function manejar(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ruta = url.pathname;

    const origen = req.headers.origin;
    if (origen && config.CORS_ORIGIN !== "*" && origen !== config.CORS_ORIGIN && !mismoOrigen(req, origen)) {
      throw new ErrorApi(403, "Origen no permitido por CORS");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    // quien pide y si puede (antes de cualquier ruta)
    await controlarAcceso(req, ruta);

    if (req.method === "GET" && ruta === "/api/lucidbot/config") {
      autorizar(req);
      json(res, 200, { ok: true, config: lucidBotContactos?.estado?.() ?? null });
      return;
    }
    if (req.method === "PUT" && ruta === "/api/lucidbot/config") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const configuracion = lucidBotContactos?.configurar?.(cuerpo ?? {});
      json(res, 200, { ok: true, config: configuracion });
      return;
    }

    // ---- GET /api/salud (publico) ----
    if (req.method === "GET" && ruta === "/api/salud") {
      const faltan = faltantesDeConfig(config);
      json(res, 200, {
        ok: true,
        servicio: "zuntostore-api",
        version: VERSION,
        listo: faltan.length === 0,
        faltantes: faltan,
        upstream: config.LUCID_BASE,
      });
      return;
    }

    // ---- GET /api/interrapidisimo/oficina (publico) ----
    // ?municipio=Medellin&departamento=Antioquia  |  ?municipio=71&departamento=2&pais=47
    // ?idCiudad=05001000                          |  ?departamento=Antioquia (cabecera)
    if (req.method === "GET" && ruta === "/api/interrapidisimo/oficina") {
      const params = Object.fromEntries(url.searchParams.entries());
      const r = await interCliente.resolverOficina(params);
      json(res, 200, { ok: true, ...r });
      return;
    }

    // ---- GET /api/interrapidisimo/oficinas?municipio=...&departamento=... ----
    // Todas las oficinas del municipio (con horarios). Mismos parametros que
    // /oficina; lo lento (el POST de Inter) va en segundo plano con
    // pendiente="listado" y reintentar=1 vuelve a bajarlo.
    if (req.method === "GET" && ruta === "/api/interrapidisimo/oficinas") {
      const params = Object.fromEntries(url.searchParams.entries());
      const r = await interCliente.listarOficinas(params);
      json(res, 200, { ok: true, ...r });
      return;
    }

    // ---- GET /api/interrapidisimo/municipios?buscar=... (publico) ----
    if (req.method === "GET" && ruta === "/api/interrapidisimo/municipios") {
      const buscar = normalizar(url.searchParams.get("buscar") ?? "");
      const limite = Math.min(Math.max(Number(url.searchParams.get("limite") ?? 20) || 20, 1), 100);
      const ciudades = await interCliente.ciudades();
      const coincidencias = buscar
        ? ciudades.filter(
            (c) =>
              normalizar(c.Descripcion).includes(buscar) ||
              normalizar(c.Departamento).includes(buscar) ||
              String(c.IdCiudad).includes(buscar),
          )
        : ciudades;
      json(res, 200, {
        ok: true,
        total: ciudades.length,
        encontradas: coincidencias.length,
        municipios: coincidencias.slice(0, limite).map((c) => ({
          idCiudad: c.IdCiudad,
          municipio: c.Descripcion,
          departamento: c.Departamento,
        })),
      });
      return;
    }

    // ---- GET /api/historial ----
    if (req.method === "GET" && ruta === "/api/historial") {
      autorizar(req);
      const limite = url.searchParams.get("limite") ?? 50;
      json(res, 200, { ok: true, entradas: historial.listar(limite) });
      return;
    }

    // ---- POST /api/pedidos/:id/estado ----
    const cambio = ruta.match(/^\/api\/pedidos\/([^/]+)\/estado$/);
    if (req.method === "POST" && cambio) {
      autorizar(req);
      const faltan = faltantesDeConfig(config);
      if (faltan.length) {
        throw new ErrorApi(503, `El backend no esta listo: falta ${faltan.join(", ")}`);
      }

      const cuerpo = await leerCuerpo(req);
      const id = decodeURIComponent(cambio[1]);
      const r = await cambiarEstado({
        cliente,
        id,
        tienda: tiendaDe(req),
        estado: cuerpo?.estado,
        motivo: cuerpo?.motivo,
      });

      historial.registrar({
        ts: new Date().toISOString(),
        id: r.id,
        idPedido: r.idPedido,
        idEmpresa: r.idEmpresa,
        de: r.estadoAnterior,
        a: r.estadoNuevo,
        motivo: cuerpo?.motivo ?? null,
        origen: String(req.headers["x-origen"] ?? "api"),
        usuario: usuarioDe(req),
        sinCambios: r.sinCambios,
        ok: true,
      });

      console.log(
        `[cambio] pedido #${r.idPedido} (${r.id}): ` +
          `${ESTADOS_PEDIDO[r.estadoAnterior] ?? r.estadoAnterior} -> ` +
          `${ESTADOS_PEDIDO[r.estadoNuevo] ?? r.estadoNuevo}` +
          `${r.sinCambios ? " (sin cambios)" : ""}`,
      );

      json(res, 200, {
        ok: true,
        ...r,
        nombreAnterior: ESTADOS_PEDIDO[r.estadoAnterior],
      });
      return;
    }

    // ---- /api/apikey: la clave de integraciones, desde Ajustes ----
    // Solo personas del panel (una integracion no se cambia su propia clave).
    if (ruta === "/api/apikey" || ruta === "/api/apikey/generar") {
      autorizar(req);
      if (req.__acceso?.interna) throw new ErrorApi(403, "La clave de la API solo se administra desde el panel");
      if (req.method === "GET" && ruta === "/api/apikey") {
        json(res, 200, { ok: true, ...claves.estado() });
        return;
      }
      if (req.method === "POST" && ruta === "/api/apikey/generar") {
        const r = claves.generar({ usuario: usuarioDe(req) });
        console.log(`[apikey] clave nueva ${r.vista} generada (por ${usuarioDe(req) ?? "?"})`);
        json(res, 200, { ok: true, ...r });
        return;
      }
      if (req.method === "DELETE" && ruta === "/api/apikey") {
        console.log(`[apikey] clave del panel revocada (por ${usuarioDe(req) ?? "?"})`);
        json(res, 200, { ok: true, ...claves.revocar() });
        return;
      }
    }

    // ---- id del pedido -> Lucid Bot ----
    if (req.method === "GET" && ruta === "/api/lucidbot/pedidos") {
      autorizar(req);
      json(res, 200, { ok: true, activo: lucidBotContactos?.pedidoActivo?.() ?? false, pedidos: pedidosLucidBot?.ultimos?.(20) ?? [] });
      return;
    }
    if (req.method === "POST" && ruta === "/api/lucidbot/pedido/probar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const id = String(cuerpo?.id ?? "").trim();
      if (!id) throw new ErrorApi(400, "Indica el id del pedido para probar");
      if (!lucidBotContactos?.guardarIdPedido) throw new ErrorApi(503, "Lucid Bot no está montado en este servidor");
      const pedido = await cliente.obtenerPedido(id, tiendaDe(req));
      const r = await lucidBotContactos.guardarIdPedido(pedido, {
        forzar: true,
        fieldId: cuerpo?.pedidoFieldId ?? null,
        valorTipo: cuerpo?.pedidoValor ?? null,
      });
      json(res, r.ok ? 200 : 502, { ok: r.ok, msg: r.detalle, ...r });
      return;
    }

    // ---- POST /api/envios/estado  (Lucid Bot -> aqui) ----
    // Solo integraciones con x-api-key: un usuario del panel no inventa estados.
    if (req.method === "POST" && ruta === "/api/envios/estado") {
      autorizar(req);
      if (!req.__acceso?.interna) throw new ErrorApi(403, "Solo Lucid Bot (con x-api-key) puede mandar estados de envío");
      const cuerpo = await leerCuerpo(req);
      let ev;
      try {
        ev = envios.registrar(cuerpo ?? {});
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      console.log(
        `[envios] ${ev.estado}${ev.guia ? ` · guía ${ev.guia}` : ""}${ev.pedido ? ` · pedido ${ev.pedido}` : ""}${ev.telefono ? ` · tel …${ev.telefono.slice(-4)}` : ""}`,
      );
      json(res, 200, { ok: true, recibido: { estado: ev.estado, guia: ev.guia, pedido: ev.pedido, transportadora: ev.transportadora, ts: ev.ts } });
      return;
    }

    // ---- POST /api/envios/consultar  {pedidos:[{id,idPedido,telefono,fecha,guia}]} ----
    if (req.method === "POST" && ruta === "/api/envios/consultar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      json(res, 200, { ok: true, estados: envios.consultar(cuerpo?.pedidos ?? []) });
      return;
    }

    // ---- POST /api/envios/historial  {id,idPedido,telefono,fecha,guia} ----
    if (req.method === "POST" && ruta === "/api/envios/historial") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      json(res, 200, { ok: true, eventos: envios.historial(cuerpo ?? {}) });
      return;
    }

    // ---- GET /api/envios/pedidos?estado=&page=&porPagina=&actualizar=1 ----
    // Filtro del panel sobre TODOS los pedidos recientes de la tienda activa
    // (con la sesion de LucidSales del usuario, nunca la del servidor).
    if (req.method === "GET" && ruta === "/api/envios/pedidos") {
      autorizar(req);
      const acceso = req.__acceso;
      const tienda = tiendaDe(req) ?? config.LUCID_TIENDA;
      if (!tienda) throw new ErrorApi(400, "Falta la tienda (x-tienda)");
      const lucid = acceso?.interna ? cliente : crearLucidDeSesion(config, req.headers["x-token"]);
      const estado = String(url.searchParams.get("estado") ?? "").trim();
      if (!estado) throw new ErrorApi(400, "Falta el estado a filtrar");
      const r = await buscadorEnvios.buscar({
        lucid,
        tienda,
        filtro: estado,
        page: url.searchParams.get("page"),
        porPagina: url.searchParams.get("porPagina"),
        forzar: url.searchParams.get("actualizar") === "1",
      });
      json(res, 200, { ok: true, ...r });
      return;
    }

    // ---- GET /api/envios/estados (opciones del filtro del panel) ----
    if (req.method === "GET" && ruta === "/api/envios/estados") {
      autorizar(req);
      json(res, 200, { ok: true, estados: envios.estadosConocidos() });
      return;
    }

    // ---- GET /api/envios/ultimos ----
    if (req.method === "GET" && ruta === "/api/envios/ultimos") {
      autorizar(req);
      json(res, 200, { ok: true, avisos: envios.ultimos(url.searchParams.get("n")) });
      return;
    }

    // ---- POST /api/pedidos/:id/conversacion ----
    // El bot manda el chat del pedido; cada envio reemplaza la conversacion.
    const convPost = ruta.match(/^\/api\/pedidos\/([^/]+)\/conversacion$/);
    if (req.method === "POST" && convPost) {
      autorizar(req);
      const id = decodeURIComponent(convPost[1]);
      const cuerpo = await leerCuerpo(req);
      const r = conv.guardar(id, cuerpo);
      if (!r.ok) throw new ErrorApi(500, "No se pudo guardar la conversacion");
      json(res, 200, { ok: true, id, ...r });
      return;
    }

    // ---- GET /api/pedidos/:id/conversacion ----
    if (req.method === "GET" && convPost) {
      autorizar(req);
      const id = decodeURIComponent(convPost[1]);
      const r = await conversacionActual(id, null, tiendaDe(req));
      if (!r.ok) {
        json(res, r.configurado ? 502 : 404, { ok: false, msg: r.detalle, detalle: r.detalle, mensajes: [] });
        return;
      }
      json(res, 200, { ok: true, id, ...r });
      return;
    }

    // ---- POST /api/pedidos/:id/validar ----
    // El agente: lee el chat, extrae datos y decide si el pedido se puede subir
    // a Dropi. NO sube nada: devuelve {accion:"subir"|"frenar", problemas}.
    //
    // Body opcional:
    //   { resumen: {...} }     -> usa ese resumen en vez de bajar el pedido
    //   { mensajes: [...] }    -> usa esa conversacion en vez de la guardada
    const validar = ruta.match(/^\/api\/pedidos\/([^/]+)\/validar$/);
    if (req.method === "POST" && validar) {
      autorizar(req);
      const id = decodeURIComponent(validar[1]);
      const cuerpo = await leerCuerpo(req);

      let resumen = cuerpo?.resumen;
      let pedidoFuente = null;
      if (!resumen || typeof resumen !== "object") {
        pedidoFuente = await cliente.obtenerPedido(id, tiendaDe(req));
        resumen = resumenDePedido(pedidoFuente);
      }
      const chat = await conversacionActual(id, pedidoFuente, tiendaDe(req));
      if (!chat.ok && chat.configurado) {
        json(res, 502, { ok: false, id, msg: chat.detalle, detalle: chat.detalle, accion: "sin-conversacion" });
        return;
      }
      const mensajes = Array.isArray(cuerpo?.mensajes) ? cuerpo.mensajes : (chat.mensajes ?? []);
      const oficinaVal = recogeEnOficina(resumen?.direccion, resumen?.referencias);
      const oficinaValAuto = oficinaVal === "Inter Rapidísimo" && subida.oficinaInterActiva?.() === true;

      const r = await ejecutarAgente({ resumen, mensajes, extraer, oficina: oficinaValAuto ? oficinaVal : null });
      console.log(
        `[agente] pedido #${resumen.idPedido || id}: ${r.accion.toUpperCase()}` +
          (r.problemas.length ? ` (${r.problemas.map((p) => p.campo).join(", ")})` : ""),
      );
      json(res, 200, {
        ok: true,
        id,
        resumen,
        enConversacion: mensajes.length,
        ...r,
      });
      return;
    }

    // ---- POST /api/pedidos/:id/subir ----
    // El circuito completo: lee el chat, lo valida con el agente y SOLO si todo
    // calza lo sube a Dropi con el seguro antidevoluciones (insurance:true).
    //
    // Si algo no calza NO sube nada: devuelve 409 con los problemas.
    //
    // Body opcional:
    //   { productos: [{idDropi, name, ...}] }  -> mapeo a los ids de Dropi
    //   { insurance: true|false }              -> pisa el defecto (DROPI_SEGURO)
    //   { distributionCompany, typeService, warehouseId, shippingAmount, ... }
    //   { dryRun: true }                       -> arma el payload pero no lo envia
    const subir = ruta.match(/^\/api\/pedidos\/([^/]+)\/subir$/);
    if (req.method === "POST" && subir) {
      autorizar(req);
      const id = decodeURIComponent(subir[1]);
      res.__notificacionLucidBot = { id, via: "Dropi", tienda: tiendaDe(req) };
      const cuerpo = await leerCuerpo(req);
      const previoDropi = subida.estadoPedido?.(id);
      if (["subido", "subido-pendiente-confirmacion", "resultado-incierto"].includes(previoDropi?.accion)) {
        // Esta petición solo consulta/recupera una operación anterior; no es
        // un nuevo intento de envío que deba disparar otro flujo al contacto.
        delete res.__notificacionLucidBot;
        if (previoDropi.accion === "subido-pendiente-confirmacion") {
          let confirmado = false;
          let avisoEstado = null;
          let pendienteConfirmacion = false;
          let detalle = previoDropi.detalle;
          try {
            const cambio = await cambiarEstado({ cliente, id, estado: 2, soloDesde: [0, 3], tienda: tiendaDe(req) });
            confirmado = !cambio.noActualizado;
            if (!confirmado && Number(cambio.estadoNuevo) === 2) confirmado = true;
            avisoEstado = confirmado ? null : cambio.msg;
            detalle = `${detalle}; ${confirmado ? "LucidSales actualizado a Confirmado" : cambio.msg}`;
          } catch (e) {
            pendienteConfirmacion = true;
            avisoEstado = `Dropi ya creó la orden; no se pudo actualizar LucidSales a Confirmado: ${e?.message ?? e}`;
            detalle = `${detalle}; ${avisoEstado}`;
          }
          subida.registrarResultado?.(id, pendienteConfirmacion ? "subido-pendiente-confirmacion" : "subido", detalle);
          json(res, 200, {
            ok: true,
            id,
            subido: true,
            idDropi: null,
            insurance: null,
            estadoLucidSales: confirmado ? "Confirmado" : null,
            avisoEstado,
            detalle,
            msg: "La orden ya existía en Dropi; no se volvió a crear.",
          });
          return;
        }
        json(res, previoDropi.accion === "resultado-incierto" ? 202 : 409, {
          ok: false,
          id,
          subido: previoDropi.accion === "subido" || previoDropi.accion === "subido-pendiente-confirmacion",
          resultadoIncierto: previoDropi.accion === "resultado-incierto",
          detalle: previoDropi.detalle,
          msg: previoDropi.accion === "subido"
            ? "Este pedido ya figura confirmado por Dropi; no se enviará otra vez."
            : "El resultado anterior sigue incierto. Verifica Dropi antes de autorizar otro intento.",
        });
        return;
      }

      const pedidoLucid = await cliente.obtenerPedido(id, tiendaDe(req));
      res.__notificacionLucidBot.pedido = pedidoLucid;
      const resumen = resumenDePedido(pedidoLucid);
      // recoge en oficina: Coordinadora siempre a mano; Inter solo si esta
      // encendida la opcion (y Dropi ofrece UNA oficina)
      const oficina = recogeEnOficina(resumen?.direccion, resumen?.referencias);
      const oficinaAuto = oficina === "Inter Rapidísimo" && subida.oficinaInterActiva?.() === true;
      if (oficina && !oficinaAuto) {
        delete res.__notificacionLucidBot;
        json(res, 409, {
          ok: false,
          id,
          accion: "frenar",
          msg: `El cliente recoge en oficina de ${oficina}: súbelo directamente en Dropi eligiendo la oficina.`,
          motivos: [{ campo: "oficina", detalle: `recoge en oficina de ${oficina}; lo sube una persona en Dropi` }],
          subido: false,
        });
        return;
      }
      // La conversación se consulta en LucidBot al momento de subir; solo se
      // usa el registro local antiguo si aún no está configurado el campo API.
      const chat = await conversacionActual(id, pedidoLucid);
      if (!chat.ok && chat.configurado) {
        json(res, 502, { ok: false, id, msg: chat.detalle, detalle: chat.detalle, accion: "sin-conversacion", subido: false });
        return;
      }
      const mensajes = chat.mensajes ?? [];
      if (![0, 2, 3].includes(Number(resumen.estadoPedido))) {
        json(res, 409, {
          ok: false,
          id,
          accion: "frenar",
          motivos: [{ campo: "estado", detalle: `No se suben pedidos en estado ${resumen.estadoPedido} (${ESTADOS_PEDIDO[resumen.estadoPedido] ?? "desconocido"}). Solo se permiten Por confirmar, Confirmado o Modificado.` }],
          subido: false,
        });
        return;
      }

      // 1) el agente decide
      const r = await ejecutarAgente({ resumen, mensajes, extraer, oficina: oficinaAuto ? oficina : null });

      // 2) si frena, NO se sube nada
      if (r.accion !== "subir") {
        if (r.falloIA) {
          json(res, 502, { ok: false, id, accion: "frenar", msg: `La IA no pudo leer el chat: ${r.falloIA}`, motivos: [{ campo: "ia", detalle: r.falloIA }], subido: false });
          return;
        }
        if (r.direccionInvalida) {
          // queda marcada igual que en la subida automatica
          subida.registrarResultado?.(id, "direccion-invalida", r.problemas.map((x) => `${x.campo}: ${x.detalle}`).join("; "));
        }
        console.log(`[dropi] pedido #${resumen.idPedido || id}: FRENADO, no se sube`);
        json(res, 409, {
          ok: false,
          id,
          accion: r.accion,
          motivos: r.problemas,
          extraido: r.extraido,
          validacion: r.validacion,
          subido: false,
        });
        return;
      }

      // la direccion que se envia es la validada (normalizada/corregida)
      if (r.direccionEnvio?.normalizada && !oficinaAuto) resumen.direccion = r.direccionEnvio.normalizada;

      // 3a) via navegador: los mismos pasos que hace el usuario a mano
      if (cuerpo?.via === "navegador") {
        // la ciudad/depto van por NOMBRE (el autocomplete de Dropi no entiende
        // los ids de LucidSales). Resolver con el catalogo publico de LucidSales.
        let depto = String(resumen?.departamento ?? "");
        let ciudad = String(resumen?.ciudad ?? "");
        if (depto && ciudad) {
          try {
            const ub = await interCliente.nombresDeIds({
              pais: resumen?.pais ?? 47,
              idDepartamento: depto,
              idCiudad: ciudad,
            });
            depto = ub?.departamento ?? depto;
            ciudad = ub?.municipio ?? ciudad;
          } catch (e) {
            json(res, 409, {
              ok: false,
              id,
              accion: "frenar",
              motivos: [{ campo: "ubicacion", detalle: `No se pudo resolver la ciudad y el departamento: ${e?.message ?? e}` }],
              subido: false,
            });
            return;
          }
          if (!String(depto).trim() || !String(ciudad).trim() || /^\d+$/.test(String(depto).trim()) || /^\d+$/.test(String(ciudad).trim())) {
            json(res, 409, {
              ok: false,
              id,
              accion: "frenar",
              motivos: [{ campo: "ubicacion", detalle: "La ciudad y el departamento no se resolvieron a nombres válidos." }],
              subido: false,
            });
            return;
          }
        }

        // el link navegable del producto en Dropi: si el cuerpo trae productoUrl
        // se respeta; si no, se resuelve (id de LucidSales -> idProductoDropi ->
        // dropiLink del Google Sheets)
        // tienda de Dropi: la del cuerpo o la configurada para esta tienda de
        // LucidSales. Sin ella no se sube (es configuracion, no un fallo del
        // pedido: no se avisa a Lucid Bot).
        const tiendaDropi = String(cuerpo?.tiendaDropi ?? subida.tiendaDropiPara?.(resumen?.idEmpresa) ?? "").trim();
        if (!tiendaDropi) {
          delete res.__notificacionLucidBot;
          json(res, 409, {
            ok: false,
            id,
            accion: "frenar",
            motivos: [{ campo: "tienda", detalle: `La tienda ${resumen?.idEmpresa || ""} no tiene tienda de Dropi configurada (Ajustes > Subida automática a Dropi).` }],
            subido: false,
          });
          return;
        }

        let productoUrl = cuerpo?.productoUrl ?? null;
        let motivoProducto = "el producto no tiene link de Dropi (revisa el Google Sheets)";
        if (!productoUrl && resumen?.productos?.[0]?.id) {
          if (resolverProductoDropi) {
            try {
              productoUrl = await resolverProductoDropi(resumen.productos[0].id);
            } catch (e) {
              motivoProducto = `sin link de Dropi: ${e?.message ?? e}`;
              console.warn("[dropi] no se pudo resolver el producto en Dropi:", e?.message ?? e);
            }
          } else {
            // sin resolver montado: se intenta por el idProductoDropi directo
            try {
              const prod = await cliente.obtenerProducto(resumen.productos[0].id);
              productoUrl = prod?.idProductoDropi || null;
            } catch (e) {
              console.warn("[dropi] no se pudo resolver el id de Dropi del producto:", e?.message ?? e);
            }
          }
        }
        if (!productoUrl) {
          json(res, 409, {
            ok: false,
            id,
            accion: "frenar",
            motivos: [{ campo: "producto", detalle: motivoProducto }],
            subido: false,
          });
          return;
        }

        // calificacion de la direccion en el mapa (mismo minimo que la automatica)
        if (!oficinaAuto) {
          let ev = null;
          try {
            ev = await subida.evaluarDireccion?.({
              direccion: resumen?.direccion,
              referencias: resumen?.referencias ?? "",
              ciudad,
              departamento: depto,
            });
          } catch (e) {
            console.warn("[direccion] no se pudo calificar:", e?.message ?? e);
          }
          if (ev && !ev.ok) {
            if (cuerpo?.dryRun !== true) subida.registrarResultado?.(id, "direccion-invalida", ev.check.detalle);
            json(res, 409, {
              ok: false,
              id,
              accion: "frenar",
              motivos: [ev.check],
              calificacion: ev.calificacion,
              validacion: { ...r.validacion, checks: [...(r.validacion?.checks ?? []), ev.check] },
              subido: false,
            });
            return;
          }
          if (ev) {
            resumen.direccion = ev.direccion;
            r.validacion = { ...r.validacion, checks: [...(r.validacion?.checks ?? []), ev.check] };
          }
        }

        const partes = String(resumen?.cliente ?? "").trim().split(/\s+/);
        // la linea del pedido: cantidad y precio de venta (lo que pago el cliente)
        const linea = resumen?.productos?.[0] ?? {};
        // ¿la direccion es una oficina de Inter aunque no diga "oficina"?
        const oficinaDetectada = oficinaAuto
          ? null
          : await subida.oficinaInterDeDireccion?.({ direccion: resumen?.direccion, ciudad, departamento: depto }).catch(() => null);
        const aOficina = oficinaAuto || Boolean(oficinaDetectada);
        // transportadoras en orden y tope de flete (reglas del producto o
        // generales); si el cuerpo trae una transportadora fija, manda esa
        const plan = subida.planEnvio?.(resumen, { oficina: aOficina ? "Inter Rapidísimo" : null }) ?? {
          transportadoras: [5],
          maxEnvio: null,
          oficinaInter: false,
        };
        const transportadoras =
          cuerpo?.transportadoraId && !plan.oficinaInter ? [Number(cuerpo.transportadoraId)] : plan.transportadoras;
        const rNav = await dropiNav.subirPedido({
          productoUrl,
          nombre: partes[0] ?? "",
          apellido: partes.slice(1).join(" "),
          telefono: resumen?.telefono,
          email: cuerpo?.email,
          // direccion, coma y las referencias del pedido (barrio, puntos de referencia)
          direccion: aOficina ? resumen?.direccion : direccionConReferencias(resumen?.direccion, resumen?.referencias),
          departamento: depto,
          ciudad,
          transportadoras,
          maxEnvio: plan.maxEnvio,
          oficinaInter: plan.oficinaInter,
          oficinaObjetivo: oficinaDetectada ? oficinaDetectada.direccion || oficinaDetectada.nombre : oficinaAuto ? resumen?.direccion : null,
          tienda: tiendaDropi,
          conRecaudo: cuerpo?.conRecaudo,
          seguro: cuerpo?.insurance ?? config.DROPI_SEGURO,
          tipoPago: resumen?.tipoPago,
          productos: cuerpo?.productos?.length
            ? cuerpo.productos
            : [{ id: linea.id, cantidad: linea.cantidad, precio: linea.precio }],
          soloPreparar: cuerpo?.dryRun === true,
        });

        // el navegador esta ocupado con otra subida: no es un fallo del pedido,
        // asi que no se avisa a Lucid Bot ni se registra nada
        if (rNav?.ocupado) {
          delete res.__notificacionLucidBot;
          json(res, 409, {
            ok: false,
            id,
            ocupado: true,
            motivo: rNav.detalle,
            msg: rNav.detalle,
            subido: false,
          });
          return;
        }

        // sesion de Dropi vencida: hay que entrar otra vez (una sola vez, no por pedido)
        if (rNav?.requiereLogin) {
          delete res.__notificacionLucidBot; // problema de la sesion, no del pedido
          await subida.reportarSesion?.("requiere-login", rNav.detalle).catch(() => {});
          console.log(`[dropi] pedido #${resumen.idPedido || id}: SESION VENCIDA`);
          json(res, 401, {
            ok: false,
            id,
            requiereLogin: true,
            motivo: "La sesión de Dropi venció. Actualízala en Ajustes > Subida a Dropi > Sesión de Dropi y vuelve a intentarlo.",
            subido: false,
          });
          return;
        }

        // si Dropi exige captcha, se para: eso lo resuelve una persona
        if (rNav?.requiereCaptcha) {
          delete res.__notificacionLucidBot; // problema de la sesion, no del pedido
          await subida.reportarSesion?.("requiere-captcha", rNav.detalle).catch(() => {});
          console.log(`[dropi] pedido #${resumen.idPedido || id}: CAPTCHA, se detiene`);
          json(res, 409, {
            ok: false,
            id,
            requiereCaptcha: true,
            motivo: "Dropi exige captcha: resuelvelo a mano en el navegador",
            subido: false,
          });
          return;
        }

        // envio caro / sin transportadora / varias oficinas: el pedido no se
        // sube; queda marcado igual que en la subida automatica
        if (rNav?.envioCaro || rNav?.sinTransportadora || rNav?.oficinaHumano) {
          const accion = rNav.envioCaro ? "envio-caro" : rNav.sinTransportadora ? "sin-transportadora" : "requiere-humano";
          const det = `${rNav.detalle}${rNav.envioCaro && plan.motivoTope ? ` (tope: ${plan.motivoTope})` : ""}`;
          if (cuerpo?.dryRun !== true) subida.registrarResultado?.(id, accion, det);
          json(res, 409, {
            ok: false,
            id,
            accion: "frenar",
            motivos: [{ campo: rNav.oficinaHumano ? "oficina" : "envio", detalle: det }],
            intentos: rNav.intentos,
            oficinas: rNav.oficinas,
            subido: false,
          });
          return;
        }

        console.log(
          `[dropi] pedido #${resumen.idPedido || id}: ` +
            `${rNav.creado ? "CREADO" : rNav.preparado ? "PREPARADO (dryRun)" : "NO CREADO"}` +
            ` por navegador (seguro=${rNav.seguro}, encontrado=${rNav.seguroEncontrado})`,
        );
        // llego al formulario: si la sesion figuraba caida, ya sirve
        if ((rNav?.ok || rNav?.creado || rNav?.preparado) && subida.sesion?.()?.estado && subida.sesion().estado !== "ok") {
          subida.sesionRestablecida?.("subida manual");
        }
        const textoEnvio = rNav.envio
          ? `; ${rNav.envio.transportadora} $${Math.round(rNav.envio.precio ?? 0).toLocaleString("es-CO")}${rNav.envio.oficina ? ` (oficina ${rNav.envio.oficina})` : ""}`
          : "";
        let detalleRegistro = `Dropi #${rNav.idDropi ?? "confirmado"}${textoEnvio}; seguro=${rNav.seguro}`;
        if (rNav?.resultadoIncierto) {
          subida.registrarResultado?.(id, "resultado-incierto", rNav.detalle);
        } else if (rNav?.creado) {
          subida.registrarResultado?.(id, "subido", detalleRegistro);
        }
        let estadoLucidSales = Number(resumen?.estadoPedido) === 2;
        let avisoEstado = null;
        if (rNav?.creado && !estadoLucidSales) {
          const estadoActual = Number(resumen?.estadoPedido);
          if ([0, 3].includes(estadoActual)) {
            try {
              const cambio = await cambiarEstado({ cliente, id, estado: 2, soloDesde: [0, 3], tienda: tiendaDe(req) });
              estadoLucidSales = !cambio.noActualizado;
              avisoEstado = cambio.noActualizado ? cambio.msg : null;
              historial.registrar({
                ts: new Date().toISOString(),
                id: cambio.id,
                idPedido: cambio.idPedido,
                idEmpresa: cambio.idEmpresa,
                de: cambio.estadoAnterior,
                a: cambio.estadoNuevo,
                motivo: "Pedido creado en Dropi",
                origen: "dropi",
                usuario: usuarioDe(req),
                sinCambios: cambio.sinCambios,
                ok: true,
              });
              if (cambio.noActualizado) detalleRegistro += `; ${cambio.msg}`;
            } catch (e) {
              avisoEstado = `Dropi confirmó la orden, pero LucidSales no pudo actualizarse a Confirmado: ${e?.message ?? e}`;
              detalleRegistro += `; pendiente Confirmado en LucidSales: ${e?.message ?? e}`;
            }
          } else {
            avisoEstado = `Dropi confirmó la orden; se conservó el estado ${Number.isFinite(estadoActual) ? estadoActual : "desconocido"} de LucidSales para no retroceder el pedido.`;
            detalleRegistro += `; ${avisoEstado}`;
          }
        }
        if (rNav?.creado && avisoEstado) {
          subida.registrarResultado?.(id, "subido", detalleRegistro);
        } else if (rNav?.creado && estadoLucidSales) {
          subida.registrarResultado?.(id, "subido", `${detalleRegistro}; LucidSales Confirmado`);
        }
        json(res, rNav.resultadoIncierto ? 202 : rNav.ok ? 200 : 502, {
          ok: rNav.ok,
          id,
          via: "navegador",
          subido: Boolean(rNav.creado),
          resultadoIncierto: Boolean(rNav.resultadoIncierto),
          idDropi: rNav.idDropi ?? null,
          insurance: rNav.seguro,
          envio: rNav.envio ?? null,
          estadoLucidSales: estadoLucidSales ? "Confirmado" : null,
          avisoEstado,
          detalle: rNav.detalle ?? null,
          validacion: r.validacion,
        });
        return;
      }

      // 3b) se arma el payload de Dropi (via API, solo si Dropi habilita el acceso)
      const payload = armarPedidoDropi(resumen, {
        userId: config.DROPI_USER_ID,
        supplierId: cuerpo?.supplierId ?? config.DROPI_SUPPLIER_ID,
        shopId: cuerpo?.shopId ?? (config.DROPI_SHOP_ID || null),
        warehouseId: cuerpo?.warehouseId ?? (config.DROPI_WAREHOUSE_ID || null),
        rateType: cuerpo?.rateType ?? "CON RECAUDO",
        insurance: cuerpo?.insurance ?? config.DROPI_SEGURO,
        // crudo: dropi.js lo parsea con parsearPrecio ("20.790,5" -> 20790.5)
        shippingAmount: cuerpo?.shippingAmount,
        distributionCompany: cuerpo?.distributionCompany ?? null,
        typeService: cuerpo?.typeService ?? "normal",
        productos: cuerpo?.productos ?? [],
        notes: cuerpo?.notes ?? "",
      });

      // 4) dryRun: se muestra sin enviar
      if (cuerpo?.dryRun) {
        json(res, 200, { ok: true, id, dryRun: true, accion: r.accion, payload, validacion: r.validacion });
        return;
      }

      const respuesta = await dropi.crearPedido(payload);
      const idDropi = respuesta?.objects?.id ?? respuesta?.objects?.order_id ?? null;
      let estadoLucidSales = Number(resumen?.estadoPedido) === 2;
      let avisoEstado = null;
      let detalleRegistro = `Dropi #${idDropi ?? "confirmado"}; seguro=${payload.insurance}`;
      subida.registrarResultado?.(id, "subido", detalleRegistro);
      if (!estadoLucidSales) {
        const estadoActual = Number(resumen?.estadoPedido);
        if ([0, 3].includes(estadoActual)) {
          try {
            const cambio = await cambiarEstado({ cliente, id, estado: 2, soloDesde: [0, 3], tienda: tiendaDe(req) });
            estadoLucidSales = !cambio.noActualizado;
            avisoEstado = cambio.noActualizado ? cambio.msg : null;
            historial.registrar({
              ts: new Date().toISOString(),
              id: cambio.id,
              idPedido: cambio.idPedido,
              idEmpresa: cambio.idEmpresa,
              de: cambio.estadoAnterior,
              a: cambio.estadoNuevo,
              motivo: "Pedido creado en Dropi",
              origen: "dropi",
              usuario: usuarioDe(req),
              sinCambios: cambio.sinCambios,
              ok: true,
            });
          } catch (e) {
            avisoEstado = `Dropi confirmó la orden, pero LucidSales no pudo actualizarse a Confirmado: ${e?.message ?? e}`;
          }
        } else {
          avisoEstado = `Dropi confirmó la orden; se conservó el estado ${Number.isFinite(estadoActual) ? estadoActual : "desconocido"} de LucidSales para no retroceder el pedido.`;
        }
      }
      if (avisoEstado) detalleRegistro += `; ${avisoEstado}`;
      else if (estadoLucidSales) detalleRegistro += "; LucidSales Confirmado";
      subida.registrarResultado?.(id, "subido", detalleRegistro);
      console.log(
        `[dropi] pedido #${resumen.idPedido || id}: SUBIDO -> ` +
          `${idDropi ?? "?"} (insurance=${payload.insurance})`,
      );
      json(res, 200, {
        ok: true,
        id,
        subido: true,
        idDropi,
        insurance: payload.insurance,
        estadoLucidSales: estadoLucidSales ? "Confirmado" : null,
        avisoEstado,
        respuesta,
        validacion: r.validacion,
      });
      return;
    }

    // ---- GET /api/dropi/sesion ----
    // Estado de la sesion de Dropi que ve la subida (ok / requiere-login /
    // requiere-captcha), desde cuando y si ya se aviso al admin.
    if (req.method === "GET" && ruta === "/api/dropi/sesion") {
      autorizar(req);
      json(res, 200, { ok: true, sesion: subida.sesion?.() ?? { estado: "desconocido" } });
      return;
    }

    // ---- POST /api/dropi/sesion  {localStorage:{...}} ----
    // El admin entra a Dropi en SU navegador, copia el localStorage de
    // app.dropi.co y lo pega en el panel: el servidor lo carga en su perfil y
    // comprueba que Dropi lo acepte. Contiene el token de sesion: no se guarda
    // en el historial ni se devuelve.
    if (req.method === "POST" && ruta === "/api/dropi/sesion") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req, 4 * 1024 * 1024);
      let datos = cuerpo?.localStorage ?? cuerpo;
      if (typeof datos === "string") {
        try {
          datos = JSON.parse(datos);
        } catch {
          throw new ErrorApi(400, "La sesión pegada no es JSON válido");
        }
      }
      if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
        throw new ErrorApi(400, "La sesión pegada no tiene el formato esperado");
      }
      const r = await dropiNav.inyectarSesion(datos);
      if (r.ok) {
        subida.sesionRestablecida?.("panel");
        console.log(`[dropi] sesion actualizada desde el panel (${r.claves} claves) por ${usuarioDe(req) ?? "?"}`);
        json(res, 200, { ok: true, msg: r.detalle, sesion: subida.sesion?.() });
        return;
      }
      json(res, r.ocupado ? 409 : 400, { ok: false, msg: r.detalle, detalle: r.detalle, requiereCaptcha: Boolean(r.requiereCaptcha) });
      return;
    }

    // ---- GET /api/subida ----
    // Estado de la subida automatica: configuracion + ultimos pedidos tratados.
    if (req.method === "GET" && ruta === "/api/subida") {
      autorizar(req);
      const limite = url.searchParams.get("limite") ?? 30;
      json(res, 200, { ok: true, config: subida.config(), ultimos: subida.ultimos(limite) });
      return;
    }

    // ---- GET /api/subida/pedido/:id ----
    // Ultimo veredicto de la subida automatica para un pedido: resultado,
    // intentos, detalle y el analisis de la IA (si paso por ella).
    const subidaPedido = ruta.match(/^\/api\/subida\/pedido\/([^/]+)$/);
    if (req.method === "GET" && subidaPedido) {
      autorizar(req);
      const id = decodeURIComponent(subidaPedido[1]);
      const registro = subida.estadoPedido?.(id) ?? null;
      json(res, 200, { ok: true, id, registro, maxIntentos: subida.config?.()?.maxIntentos ?? 2 });
      return;
    }

    // ---- PUT /api/subida/config ----
    // { automatico, cadaSegundos, estados[], tiendas[], dryRun, transportadoraId }
    if (req.method === "PUT" && ruta === "/api/subida/config") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const c = subida.configurar(cuerpo ?? {});
      console.log(
        `[subida] config -> automatico=${c.automatico} cada=${c.cadaSegundos}s ` +
          `dryRun=${c.dryRun} transportadora=${c.transportadoraId} estados=[${(c.estados ?? []).join(",")}]`,
      );
      json(res, 200, { ok: true, config: c });
      return;
    }

    // ---- POST /api/subida/probar ----
    // Ejecuta una vuelta ahora mismo aunque este apagado.
    if (req.method === "POST" && ruta === "/api/subida/probar") {
      autorizar(req);
      const r = await subida.tick({ forzar: true });
      json(res, 200, { ok: r.ok, ...r });
      return;
    }

    // Solo reintenta un resultado incierto cuando un operador confirmó que
    // revisó Dropi y la orden no existe.
    if (req.method === "POST" && ruta === "/api/subida/reintentar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      if (cuerpo?.todos === true) {
        json(res, 200, subida.rearmarRevision());
        return;
      }
      json(res, 200, subida.rearmar(cuerpo?.id, cuerpo?.confirmarNoCreado));
      return;
    }

    // ---- GET/PUT/DELETE /api/credenciales ----
    // El admin guarda el correo y la contraseña de LucidSales desde el panel
    // (sin tocar el .env): quedan en memoria ya y en credenciales.json para
    // cuando se reinicie. La respuesta NUNCA trae la contraseña.
    if (req.method === "GET" && ruta === "/api/credenciales") {
      autorizar(req);
      json(res, 200, { ok: true, ...cred.estado() });
      return;
    }

    if (req.method === "PUT" && ruta === "/api/credenciales") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const error = cred.validar(cuerpo?.email, cuerpo?.password);
      if (error) throw new ErrorApi(400, error);
      const estado = cred.guardar(cuerpo?.email, cuerpo?.password);
      cliente.reiniciar?.(); // que no siga con el token de antes
      console.log(`[credenciales] guardadas para ${estado.email}`);
      json(res, 200, { ok: true, ...estado });
      return;
    }

    if (req.method === "DELETE" && ruta === "/api/credenciales") {
      autorizar(req);
      cliente.reiniciar?.();
      json(res, 200, { ok: true, ...cred.borrar() });
      return;
    }

    // ---- GET/PUT/DELETE /api/llm/config  y  POST /api/llm/probar ----
    // La IA que lee los chats: API key, proveedor y modelo. La key nunca se
    // devuelve (solo enmascarada). PUT sin apiKey conserva la actual.
    if (req.method === "GET" && ruta === "/api/llm/config") {
      autorizar(req);
      json(res, 200, { ok: true, ...llmCfg.estado() });
      return;
    }
    if (req.method === "PUT" && ruta === "/api/llm/config") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const estado = llmCfg.guardar(cuerpo ?? {});
      console.log(`[llm] configuración guardada desde el panel: ${estado.proveedor} · ${estado.modelo} · ${estado.apiKeyVista} (por ${usuarioDe(req) ?? "?"})`);
      json(res, 200, { ok: true, ...estado });
      return;
    }
    if (req.method === "DELETE" && ruta === "/api/llm/config") {
      autorizar(req);
      json(res, 200, { ok: true, ...llmCfg.borrar() });
      return;
    }
    if (req.method === "POST" && ruta === "/api/llm/probar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const datos = llmCfg.vistaPrevia(cuerpo ?? {});
      const r = await probarLLM({ ...datos, timeoutMs: config.LLM_TIMEOUT_MS ?? 30000 });
      json(res, 200, { ok: r.ok, msg: r.detalle, ...r });
      return;
    }

    // ---- GET/PUT /api/dropi/productos  y  POST /api/dropi/productos/probar ----
    // Link del Google Sheets con el mapa producto -> link de Dropi.
    if (ruta === "/api/dropi/productos" || ruta === "/api/dropi/productos/probar") {
      autorizar(req);
      if (!productosDropi?.estado) throw new ErrorApi(503, "El sheet de productos no está montado en este servidor");
      if (req.method === "GET" && ruta === "/api/dropi/productos") {
        json(res, 200, { ok: true, ...productosDropi.estado() });
        return;
      }
      if (req.method === "PUT" && ruta === "/api/dropi/productos") {
        const cuerpo = await leerCuerpo(req);
        const e = await productosDropi.guardar(cuerpo?.link ?? "");
        console.log(`[productosDropi] sheet ${e.origen === "panel" ? "guardado desde el panel" : "vuelve al .env"} (por ${usuarioDe(req) ?? "?"})`);
        json(res, 200, { ok: true, ...e });
        return;
      }
      if (req.method === "POST" && ruta === "/api/dropi/productos/probar") {
        const cuerpo = await leerCuerpo(req);
        json(res, 200, await productosDropi.probar(cuerpo?.link));
        return;
      }
    }

    // ---- GET/PUT/DELETE /api/mapas/config  y  POST /api/mapas/probar ----
    // API key de Google Maps para el validador de direcciones (enmascarada).
    if (ruta === "/api/mapas/config") {
      autorizar(req);
      if (req.method === "GET") {
        json(res, 200, { ok: true, ...validador.estado() });
        return;
      }
      if (req.method === "PUT") {
        const cuerpo = await leerCuerpo(req);
        const estado = validador.guardar(cuerpo ?? {});
        console.log(`[mapas] API key guardada desde el panel: ${estado.apiKeyVista} (por ${usuarioDe(req) ?? "?"})`);
        json(res, 200, { ok: true, ...estado });
        return;
      }
      if (req.method === "DELETE") {
        json(res, 200, { ok: true, ...validador.borrar() });
        return;
      }
    }
    if (req.method === "POST" && ruta === "/api/mapas/probar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      json(res, 200, await validador.probar(cuerpo?.apiKey));
      return;
    }

    // ---- POST /api/pedidos/:id/direccion/validar  {direccion?} ----
    // Validador propio: formato colombiano + Google Maps en la ciudad del
    // pedido. `direccion` permite validar un texto editado antes de guardarlo.
    const validarDir = ruta.match(/^\/api\/pedidos\/([^/]+)\/direccion\/validar$/);
    if (req.method === "POST" && validarDir) {
      autorizar(req);
      const id = decodeURIComponent(validarDir[1]);
      const cuerpo = await leerCuerpo(req);
      const pedido = await cliente.obtenerPedido(id, tiendaDe(req));
      const resumen = resumenDePedido(pedido);
      let ciudad = "";
      let departamento = "";
      try {
        const ub = await interCliente.nombresDeIds({
          pais: resumen?.pais ?? 47,
          idDepartamento: resumen?.departamento,
          idCiudad: resumen?.ciudad,
        });
        ciudad = String(ub?.municipio ?? "");
        departamento = String(ub?.departamento ?? "");
      } catch (e) {
        console.warn("[direccion] no se pudo resolver la ciudad:", e?.message ?? e);
      }
      const direccion = typeof cuerpo?.direccion === "string" && cuerpo.direccion.trim() ? cuerpo.direccion : resumen?.direccion;
      const r = await validador.validar({ direccion, referencias: resumen?.referencias ?? "", ciudad, departamento });
      json(res, 200, { ok: true, id, ciudad, departamento, ...r });
      return;
    }

    // ---- POST /api/pedidos/:id/direccion  {direccion} ----
    // Guarda la direccion (p. ej. la corregida por el validador) en LucidSales.
    const guardarDir = ruta.match(/^\/api\/pedidos\/([^/]+)\/direccion$/);
    if (req.method === "POST" && guardarDir) {
      autorizar(req);
      const id = decodeURIComponent(guardarDir[1]);
      const cuerpo = await leerCuerpo(req);
      const nueva = String(cuerpo?.direccion ?? "").replace(/\s+/g, " ").trim();
      if (nueva.length < 5 || nueva.length > 250) {
        throw new ErrorApi(400, "La dirección debe tener entre 5 y 250 caracteres");
      }
      const pedido = await cliente.obtenerPedido(id, tiendaDe(req));
      const anterior = String(pedido?.Direccion ?? "");
      if (anterior.trim() === nueva) {
        json(res, 200, { ok: true, id, sinCambios: true, direccion: nueva, msg: "La dirección ya era esa" });
        return;
      }
      const body = construirBody(pedido);
      body.Direccion = nueva;
      const r = await cliente.actualizarPedido(body, Number(pedido?.idEmpresa) || undefined);
      console.log(`[direccion] pedido #${pedido?.idPedido ?? id}: dirección actualizada (por ${usuarioDe(req) ?? "?"})`);
      json(res, 200, { ok: true, id, direccion: nueva, anterior, msg: r?.msg || "Dirección actualizada" });
      return;
    }

    // ---- GET /api/asignacion?idEmpresa=... ----
    // Horarios de los usuarios, asignaciones de la tienda, quien esta en
    // turno ahora mismo y la hora del servidor (zona configurada).
    if (req.method === "GET" && ruta === "/api/asignacion") {
      autorizar(req);
      const idEmpresa = url.searchParams.get("idEmpresa") ?? "";
      exigirTienda(req, idEmpresa);
      json(res, 200, { ok: true, ...asig.estado(idEmpresa) });
      return;
    }

    // ---- PUT /api/asignacion/horario ----
    // {usuario, nombre?, horario:{activo,dias:[1..7],desde,hasta}}
    // horario null lo borra.
    if (req.method === "PUT" && ruta === "/api/asignacion/horario") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const usuario = String(cuerpo?.usuario ?? "").trim();
      const r = asig.ponerHorario(usuario, cuerpo?.horario ?? null, { nombre: cuerpo?.nombre });
      json(res, 200, { ok: true, usuario, ...r });
      return;
    }

    // ---- POST /api/asignacion/repartir ----
    // Reparte equitativamente: se le da cada pedido al usuario con menos
    // asignaciones (contando las que ya tiene).
    if (req.method === "POST" && ruta === "/api/asignacion/repartir") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      exigirTienda(req, cuerpo?.idEmpresa);
      const r = asig.repartir({
        usuarios: cuerpo?.usuarios,
        pedidos: cuerpo?.pedidos,
        // "manual" = asignacion explicita (no mira horarios)
        modo:
          cuerpo?.modo === "horario" || cuerpo?.modo === "manual" ? cuerpo.modo : "todos",
        reasignar: Boolean(cuerpo?.reasignar),
        idEmpresa: cuerpo?.idEmpresa,
        ahora: cuerpo?.ahora,
      });
      json(res, 200, { ok: true, ...r });
      return;
    }

    // ---- PUT /api/asignacion/config ----
    // Enciende/apaga el reparto automatico y ajusta modo, intervalo, tiendas
    // y estados. Se valida campo a campo; lo desconocido se ignora.
    if (req.method === "PUT" && ruta === "/api/asignacion/config") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const c = asig.setConfig(cuerpo ?? {});
      json(res, 200, { ok: true, config: c });
      return;
    }

    // ---- POST /api/asignacion/probar ----
    // Ejecuta UNA vuelta del reparto ahora mismo (aunque este apagado): sirve
    // para comprobar credenciales, horarios y cantidades sin esperar al
    // intervalo.
    if (req.method === "POST" && ruta === "/api/asignacion/probar") {
      autorizar(req);
      if (!reparto) throw new ErrorApi(503, "El reparto automatico no esta arrancado en este proceso");
      const r = await reparto.tick(undefined, { forzar: true });
      json(res, 200, {
        ok: r?.ok !== false,
        ...(r?.msg ? { msg: r.msg } : {}),
        resultado: r,
        config: asig.getConfig(),
        ultimo: asig.getUltimo(),
      });
      return;
    }

    // ---- DELETE /api/asignacion/pedido/:id ----
    const sinAsignar = ruta.match(/^\/api\/asignacion\/pedido\/([^/]+)$/);
    if (req.method === "DELETE" && sinAsignar) {
      autorizar(req);
      const r = asig.desasignar(decodeURIComponent(sinAsignar[1]));
      json(res, 200, { ok: true, ...r });
      return;
    }

    // ---- POST /api/asignacion/limpiar  {idEmpresa?} ----
    if (req.method === "POST" && ruta === "/api/asignacion/limpiar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      // un usuario del panel solo limpia SU tienda (sin id limpiaria todas)
      if (!req.__acceso?.interna && !cuerpo?.idEmpresa) throw new ErrorApi(400, "Indica la tienda (idEmpresa) a limpiar");
      exigirTienda(req, cuerpo?.idEmpresa);
      json(res, 200, { ok: true, ...asig.limpiar(cuerpo?.idEmpresa) });
      return;
    }

    // ---- GET /api/anuncios?dias=15&actualizar=1 ----
    // Rentabilidad de las campanas de Meta: gasto, compras, margen, ROI y la
    // accion sugerida por campana. Se cachea por dia (actualizar=1 lo fuerza).
    if (req.method === "GET" && ruta === "/api/anuncios") {
      autorizar(req);
      const a = analisisDatos(req);
      const dias = Number(url.searchParams.get("dias") ?? 15);
      const forzar = ["1", "true", "si"].includes(
        String(url.searchParams.get("actualizar") ?? "").toLowerCase(),
      );
      const datos = await a.datos({ dias, forzar });
      // de paso: si esta encendido el automatico, el traedor de ganancias de
      // pedidos corre una vez al dia (en segundo plano, sin frenar esto)
      try {
        a.gananciasAuto?.();
      } catch {
        /* el traedor es opcional: si falla, los datos del analisis sirven */
      }
      json(res, 200, { ok: true, ...datos });
      return;
    }

    // ---- POST /api/anuncios/actualizar  {dias?} ----
    if (req.method === "POST" && ruta === "/api/anuncios/actualizar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const a = analisisDatos(req);
      const datos = await a.datos({ dias: Number(cuerpo?.dias ?? 15), forzar: true });
      try {
        a.gananciasAuto?.();
      } catch {
        /* opcional */
      }
      json(res, 200, {
        ok: true,
        msg: "Datos actualizados desde Meta",
        generado: datos.generado,
        campanas: datos.totales.campanas,
      });
      return;
    }

    // ---- POST /api/anuncios/ganancia  {nombre, ganancia} ----
    // Corrige la ganancia promedio de un producto: no toca la cache de Meta,
    // el recalculo se hace al instante con los datos ya descargados.
    if (req.method === "POST" && ruta === "/api/anuncios/ganancia") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        json(res, 200, { ok: true, ...analisisDatos(req).guardarGanancia(cuerpo ?? {}) });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- GET /api/anuncios/plan ----
    if (req.method === "GET" && ruta === "/api/anuncios/plan") {
      autorizar(req);
      json(res, 200, { ok: true, plan: analisisDatos(req).plan() });
      return;
    }

    // ---- POST /api/anuncios/plan  {id, hecho?, nota?} ----
    if (req.method === "POST" && ruta === "/api/anuncios/plan") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        json(res, 200, { ok: true, entrada: analisisDatos(req).marcarPlan(cuerpo ?? {}) });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- GET /api/anuncios/csv?dias=15&vista=campanas ----
    if (req.method === "GET" && ruta === "/api/anuncios/csv") {
      autorizar(req);
      const dias = Number(url.searchParams.get("dias") ?? 15);
      const vista = String(url.searchParams.get("vista") ?? "campanas");
      if (!["campanas", "alertas", "productos"].includes(vista)) {
        throw new ErrorApi(400, `Vista invalida: ${vista} (campanas | alertas | productos)`);
      }
      const archivo = await analisisDatos(req).csv({ dias, vista });
      descarga(res, archivo.nombre, archivo.contenido);
      return;
    }

    // ---- GET /api/anuncios/ganancias ----
    // Traedor de ganancias desde los PEDIDOS de LucidSales: ajustes, si hay
    // una corrida en curso (el panel la sondea para pintar la barra) y el
    // ultimo resultado guardado.
    if (req.method === "GET" && ruta === "/api/anuncios/ganancias") {
      autorizar(req);
      json(res, 200, { ok: true, ...analisisDatos(req).estadoGanancias() });
      return;
    }

    // ---- POST /api/anuncios/ganancias  {dias?, forzar?, esperar?} ----
    // Pide la analitica de cada producto (ganancia esperada / pedidos) y la
    // deja en productos.json: nunca pisa la ganancia escrita a mano, solo
    // rellena las que estan en 0 con muestra suficiente. Responde enseguida
    // y el trabajo sigue en segundo plano (con `esperar` sale terminado).
    if (req.method === "POST" && ruta === "/api/anuncios/ganancias") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const a = analisisDatos(req);
      if (!a.estadoGanancias().disponible) {
        throw new ErrorApi(
          503,
          "Este servidor no tiene credenciales de LucidSales: no se pueden traer las ganancias de los pedidos",
        );
      }
      try {
        const estado = await a.traerGanancias({
          dias: cuerpo?.dias,
          forzar: cuerpo?.forzar !== false,
          esperar: Boolean(cuerpo?.esperar),
        });
        json(res, 200, { ok: true, ...estado });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- POST /api/anuncios/ganancias/ajustes ----
    // {auto?, minPedidos?, tienda?, dias?} -> se guardan en el config del
    // espacio (compartido o del usuario, segun donde este trabajando).
    if (req.method === "POST" && ruta === "/api/anuncios/ganancias/ajustes") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        const ajustesGan = analisisDatos(req).gananciasAjustes(cuerpo ?? {});
        json(res, 200, { ok: true, ajustes: ajustesGan });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- GET /api/anuncios/cuenta ----
    // Estado de la conexion de Meta de ESTE usuario: si tiene token propio,
    // que cuentas ve, la TRM y cuando vence. `enUso` es "propia" (conecto la
    // suya) o "ninguna"; "compartida" solo para integraciones sin usuario.
    if (req.method === "GET" && ruta === "/api/anuncios/cuenta") {
      autorizar(req);
      json(res, 200, { ok: true, ...analisis(req).estado() });
      return;
    }

    // ---- POST /api/anuncios/conectar  {token} ----
    // Valida el token contra /me, baja /me/adaccounts y lo guarda para el
    // usuario (sin elegir cuentas todavia: eso va en /cuentas).
    if (req.method === "POST" && ruta === "/api/anuncios/conectar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        const r = await analisis(req).conectar(cuerpo?.token);
        json(res, 200, { ok: true, msg: "Token validado", ...r });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- POST /api/anuncios/cuentas  {cuentas[], trm?} ----
    if (req.method === "POST" && ruta === "/api/anuncios/cuentas") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        const r = analisis(req).guardarCuentas(cuerpo ?? {});
        json(res, 200, { ok: true, msg: "Cuentas guardadas", ...r });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- POST /api/anuncios/desconectar  {borrar?} ----
    if (req.method === "POST" && ruta === "/api/anuncios/desconectar") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      const r = analisis(req).desconectar({ borrar: Boolean(cuerpo?.borrar) });
      json(res, 200, r);
      return;
    }

    // ---- POST /api/anuncios/productos/importar ----
    // Agrega al espacio los productos del catalogo de la tienda activa que
    // falten (con ganancia 0). No toca los que ya estaban.
    if (req.method === "POST" && ruta === "/api/anuncios/productos/importar") {
      autorizar(req);
      try {
        json(res, 200, { ok: true, ...(await analisisDatos(req).importarProductos()) });
      } catch (e) {
        if (e instanceof ErrorApi) throw e;
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- POST /api/anuncios/vincular  {campana, productos[]} ----
    if (req.method === "POST" && ruta === "/api/anuncios/vincular") {
      autorizar(req);
      const cuerpo = await leerCuerpo(req);
      try {
        json(res, 200, { ok: true, ...analisisDatos(req).vincular(cuerpo ?? {}) });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    // ---- GET|POST /api/anuncios/entrega  {modo?, tasa?, contarSinEnvio?} ----
    if (ruta === "/api/anuncios/entrega" && (req.method === "GET" || req.method === "POST")) {
      autorizar(req);
      const a = analisisDatos(req);
      if (req.method === "GET") {
        json(res, 200, { ok: true, entrega: a.efectividad() });
        return;
      }
      const cuerpo = await leerCuerpo(req);
      try {
        json(res, 200, { ok: true, entrega: a.guardarEntrega(cuerpo ?? {}) });
      } catch (e) {
        throw new ErrorApi(400, e.message);
      }
      return;
    }

    json(res, 404, { ok: false, msg: `Ruta no encontrada: ${req.method} ${ruta}` });
  }

  return http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    const atender = async () => {
      if (panel && (await panel.manejar(req, res, new URL(req.url ?? "/", "http://localhost")))) return;
      await manejar(req, res);
    };
    atender().catch((err) => {
      const e = mensajeDeError(err);
      if (res.headersSent) return res.end();
      try {
        json(res, e.status ?? 500, {
          ok: false,
          msg: e.message,
          ...(e.detalle ? { detalle: e.detalle } : {}),
        });
      } catch {
        /* respuesta ya enviada */
      }
      if ((e.status ?? 500) >= 500) {
        console.error("[error]", e.status, e.message);
      }
    });
  });
}
