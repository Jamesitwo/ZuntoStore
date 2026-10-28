// Subida AUTOMATICA de pedidos a Dropi (con el seguro antidevoluciones).
//
// Cada N segundos mira los pedidos recientes de las tiendas configuradas, les
// lee la conversacion al bot, los pasa por el agente y SOLO si todo calza los
// sube a Dropi. Si algo no calza, NO lo sube: lo deja como "pendiente de
// revision" y lo registra.
//
// Se enciende y se apaga con PUT /api/subida/config (o desde el panel). La
// configuracion y el registro de lo ya procesado viven en un JSON:
//
//   { "automatico": false, "cadaSegundos": 120, "estados": [0], "tiendas": [],
//     "dryRun": true, "procesados": { "<id>": {ts, accion, detalle} } }
//
// Un fallo nunca rompe el intervalo: se queda registrado y se reintenta en la
// siguiente vuelta. Nunca sube un pedido sin seguro (dropiNavegador lo exige).
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";
import { ejecutarAgente, parsearPrecio, resumenDePedido, textoVariantes } from "./agente.js";
import { cambiarEstado } from "./estado.js";
import { direccionConReferencias, recogeEnOficina } from "./direccionColombia.js";
import { oficinaQueCoincide } from "./oficinasInter.js";
import { DIRECCION_OFICINA_INTER } from "./dropiNavegador.js";

const MAX_PROCESADOS = 3000;
/**
 * Resultados que cuentan como un intento fallido DEL PEDIDO. Al llegar a
 * `maxIntentos` el pedido pasa a "requiere-revision" y no se vuelve a intentar
 * hasta que alguien lo rearme desde el panel. No cuentan los problemas que no
 * son del pedido (sesion de Dropi, captcha, navegador ocupado, tienda de Dropi
 * sin configurar): esos se reintentan sin limite y se avisan aparte.
 */
const FALLOS_QUE_CUENTAN = new Set(["error", "frenado", "sin-conversacion"]);
/** Mas de esta cantidad de pedidos a revision en una vuelta = un solo aviso resumen. */
const MAX_AVISOS_SUELTOS = 3;
/** Resultados finales: la subida automatica ya no vuelve a tocar el pedido. */
const FINALES = new Set([
  "subido",
  "resultado-incierto",
  "requiere-revision",
  "requiere-humano",
  "direccion-invalida",
  "envio-caro",
  "sin-transportadora",
  // otro pedido reciente del mismo cliente y el chat no muestra otra compra
  "posible-duplicado",
  // una persona ya lo resolvio (lo subio a mano o lo confirmo en LucidSales)
  "resuelto-a-mano",
]);
/** Resultados en revision que se dan por resueltos si una persona mueve el pedido. */
const RESOLUBLES = new Set(["requiere-revision", "direccion-invalida", "envio-caro", "sin-transportadora", "posible-duplicado", "entrega-programada"]);
/**
 * Lo que tarda un envio normal (dias). Una fecha pedida dentro de ese margen
 * no es entrega futura; una mas lejana se programa y se sube cuando faltan
 * esos dias.
 */
const DIAS_ENTREGA = 5;
/** Pedidos mas recientes que mira cada vuelta, por tienda (en paginas de 100). */
const MAX_PEDIDOS_VUELTA = 200;
const POR_PAGINA = 100;
/** Dias hacia atras en que otro pedido del mismo telefono cuenta como posible repetido. */
const DIAS_DUPLICADO = 7;

/** Ultimos 10 digitos del telefono (+57 300... = 300...). */
const claveTel = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : "";
};

/**
 * Otros pedidos del mismo cliente, ANTERIORES a este (el primero se sube; el
 * que llega despues es el que puede estar repetido), de los ultimos dias y
 * no cancelados.
 */
export function otrosPedidosDelCliente(p, lista = [], { procesados = {}, ahora = Date.now() } = {}) {
  const tel = claveTel(p?.Movil);
  const id = Number(p?.id ?? p?.idPedido);
  if (!tel || !Number.isFinite(id)) return [];
  const desde = ahora - DIAS_DUPLICADO * 86_400_000;
  return lista
    .filter((x) => {
      const otro = Number(x?.id ?? x?.idPedido);
      if (!Number.isFinite(otro) || otro >= id) return false;
      if (claveTel(x?.Movil) !== tel) return false;
      if (Number(x?.EstadoPedido) === 1) return false; // cancelado
      const f = Date.parse(x?.Fecha ?? x?.CreatedAt ?? "");
      return !Number.isFinite(f) || f >= desde;
    })
    .map((x) => ({
      id: x.id,
      idPedido: x.idPedido,
      producto: x.producto ?? "",
      Total: x.Total ?? null,
      fecha: x.Fecha ?? x.CreatedAt ?? null,
      subido: ["subido", "subido-pendiente-confirmacion"].includes(procesados?.[String(x.id ?? x.idPedido)]?.accion),
    }));
}
/** Finales que se pueden volver a intentar desde el panel sin mas confirmacion. */
const REARMABLES = new Set(["requiere-revision", "direccion-invalida", "envio-caro", "sin-transportadora"]);
/** Cada cuanto se revisa: de 30 s a 12 h. */
export const MIN_SEGUNDOS = 30;
export const MAX_SEGUNDOS = 12 * 3600;
const segundosValidos = (v) => Math.max(MIN_SEGUNDOS, Math.min(Number(v) || 120, MAX_SEGUNDOS));
/** Transportadoras que se pueden configurar (id de Dropi). */
export const TRANSPORTADORAS_VALIDAS = [5, 3, 2, 4, 10, 6, 7, 13, 14, 17];
const INTER = 3;

/** Lista de transportadoras limpia: ids conocidos, sin repetir, maximo 4. */
function listaTransportadoras(v) {
  return (Array.isArray(v) ? v : [])
    .map(Number)
    .filter((x, i, a) => TRANSPORTADORAS_VALIDAS.includes(x) && a.indexOf(x) === i)
    .slice(0, 4);
}

/** Tope en pesos (> 0) o null; porcentaje entre 1 y 100 o null. */
const topePesos = (v) => (v === null || v === undefined || v === "" ? null : Number(v) > 0 ? Math.round(Number(v)) : null);
const topePct = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v) > 0 && Number(v) <= 100 ? Number(v) : null;

/** Calificacion minima por defecto para subir (0 = no se mira el mapa). */
export const MIN_CALIFICACION_DEFECTO = 70;

/**
 * Calificacion de la direccion para decidir la subida: el validador propio
 * (formato + Google Maps) da una nota de 0 a 100 y el CODIGO decide con el
 * minimo configurado. Si el mapa no se pudo consultar (sin key o error) no se
 * frena: la nota solo cubriria el formato, que ya exige el agente.
 * -> null (no se evalua) | {ok, check, direccion, calificacion}
 */
export async function evaluarDireccion({ validador, minimo, direccion, referencias = "", ciudad = "", departamento = "" }) {
  const min = Number(minimo);
  if (!validador?.validar || !(min > 0)) return null;
  const r = await validador.validar({ direccion, referencias, ciudad, departamento });
  const nota = r?.calificacion;
  if (!nota) return null; // oficina: no aplica
  const validacion = resumirValidacion(r, min);
  const enlace = r.mapa?.mapa ? ` · ${r.mapa.mapa}` : "";
  if (!nota.verificada) {
    return {
      ok: true,
      calificacion: nota.puntos,
      direccion,
      validacion,
      check: {
        campo: "direccionMapa",
        ok: true,
        detalle: `calificación ${nota.puntos}/100 sin verificar en el mapa (${r.mapa?.detalle ?? "sin API key de Google"}): se sube solo con el formato`,
      },
    };
  }
  const ok = nota.puntos >= min;
  // la direccion que Google confirmo (p. ej. numero pegado ya separado)
  const final = ok && r.sugerida && r.mapa?.veredicto === "exacta" ? r.sugerida : direccion;
  return {
    ok,
    calificacion: nota.puntos,
    direccion: final,
    validacion,
    check: {
      campo: "direccionMapa",
      ok,
      detalle: `calificación ${nota.puntos}/100 (mínimo ${min}): ${r.resumen}${r.avisos?.length ? ` ${r.avisos.join(" ")}` : ""}`,
      ...(enlace ? { evidencia: `Google Maps: ${r.mapa.formateada || ""}${enlace}` } : {}),
    },
  };
}

/**
 * ¿La direccion del cliente es la de una oficina de Interrapidisimo del
 * municipio? Devuelve la oficina o null. Si Inter no responde, null (se sigue
 * con el envio normal: no se frena un pedido por eso).
 */
export async function detectarOficinaInter({ buscar, direccion, ciudad, departamento, log = console }) {
  if (!buscar || !direccion || !ciudad) return null;
  try {
    const r = await buscar({ ciudad, departamento });
    return oficinaQueCoincide(direccion, r?.oficinas ?? []);
  } catch (e) {
    log.warn?.("[subida] no se pudieron revisar las oficinas de Inter:", e?.message ?? e);
    return null;
  }
}

/**
 * Plan de envio de un pedido: en que orden probar las transportadoras y el
 * tope de flete. El tope es el MENOR de los que apliquen:
 *   pesos del producto (o el general) y porcentaje del producto (o el
 *   general) sobre el valor del pedido.
 */
export function planEnvio(c, resumen, { oficina = null } = {}) {
  const linea = resumen?.productos?.[0] ?? {};
  const regla = c?.reglasProducto?.[String(linea.id ?? "")] ?? null;
  const general = listaTransportadoras(c?.transportadoras);
  const propias = listaTransportadoras(regla?.transportadoras);
  const transportadoras =
    oficina === "Inter Rapidísimo"
      ? [INTER]
      : propias.length
        ? propias
        : general.length
          ? general
          : [Number(c?.transportadoraId) || 5];
  // el Total de LucidSales llega como texto ("105.690"): se parsea en pesos
  const total = parsearPrecio(resumen?.total);
  const valor =
    total > 0 ? total : (parsearPrecio(linea.precio) || 0) * (Number(linea.cantidad) || 1);
  const pesos = topePesos(regla?.maxPesos) ?? topePesos(c?.envio?.maxPesos);
  const pct = topePct(regla?.maxPorcentaje) ?? topePct(c?.envio?.maxPorcentaje);
  const topes = [];
  if (pesos) topes.push({ valor: pesos, motivo: `tope de $${pesos.toLocaleString("es-CO")}` });
  if (pct && valor > 0) {
    const v = Math.round((valor * pct) / 100);
    topes.push({ valor: v, motivo: `${pct}% de $${Math.round(valor).toLocaleString("es-CO")}` });
  }
  const tope = topes.sort((a, b) => a.valor - b.valor)[0] ?? null;
  return {
    transportadoras,
    maxEnvio: tope?.valor ?? null,
    motivoTope: tope?.motivo ?? null,
    oficinaInter: oficina === "Inter Rapidísimo",
    reglaProducto: Boolean(regla),
  };
}
/** Solo los N mas recientes guardan el analisis completo de la IA. */
const MAX_CON_ANALISIS = 300;

/** Analisis compacto para el registro: verificaciones + lo que leyo la IA. */
export function resumirAnalisis(r) {
  if (!r) return null;
  const corto = (v, n = 160) => String(v ?? "").slice(0, n);
  const e = r.extraido ?? {};
  return {
    checks: (r.validacion?.checks ?? []).map((c) => ({
      campo: c.campo,
      ok: Boolean(c.ok),
      detalle: corto(c.detalle),
      ...(c.evidencia ? { evidencia: corto(c.evidencia) } : {}),
    })),
    extraido: {
      producto: corto(e.producto, 120),
      cantidad: e.cantidad ?? null,
      precioAcordado: e.precioAcordado ?? null,
      direccion: corto(e.direccion, 160),
      clienteConfirmo: e.clienteConfirmo ?? null,
      entregaFutura: e.entregaFutura ?? null,
      fechaEntregaSolicitada: corto(e.fechaEntregaSolicitada, 60),
      fechaEntregaISO: e.fechaEntregaISO || null,
      incertidumbre: (e.incertidumbre ?? []).slice(0, 5).map((x) => corto(x, 160)),
      razonamiento: corto(e.razonamiento, 800),
    },
    // lo que el codigo decidio con lo que leyo la IA
    accion: r.accion ?? null,
  };
}

/** Todo lo que el validador dijo de la direccion (para el historial de intentos). */
export function resumirValidacion(r, minimo) {
  if (!r) return null;
  const n = r.calificacion ?? null;
  return {
    original: r.original ?? null,
    veredicto: r.veredicto ?? null,
    resumen: r.resumen ?? "",
    puntos: n?.puntos ?? null,
    minimo: Number(minimo) || null,
    verificada: n?.verificada ?? null,
    partes: (n?.partes ?? []).map((x) => ({ concepto: x.concepto, puntos: x.puntos, max: x.max })),
    formato: r.formato ? { ok: Boolean(r.formato.ok), detalle: String(r.formato.detalle ?? "").slice(0, 300) } : null,
    mapa: r.mapa
      ? {
          veredicto: r.mapa.veredicto ?? null,
          detalle: String(r.mapa.detalle ?? "").slice(0, 300),
          formateada: r.mapa.formateada ?? null,
          enlace: r.mapa.mapa ?? null,
          sinCobertura: Boolean(r.mapa.sinCobertura),
        }
      : null,
    sugerida: r.sugerida ?? null,
    avisos: (r.avisos ?? []).slice(0, 5),
  };
}

/** Rechaza direcciones que en realidad indican recoger en oficina del carrier. */
export function crearSubidaAutomatica({
  cliente,
  conversacion,
  extraer,
  dropiNav,
  asignacion,
  config,
  ruta,
  lucidBotContactos,
  log = console,
  resolverUbicacion,
  resolverProductoDropi,
  validadorDireccion = null,
  // ({ciudad, departamento}) -> {oficinas:[{nombre, direccion}]} de Inter
  buscarOficinasInter = null,
  // historial de intentos por pedido (transparencia en el panel)
  intentos = null,
  // entregas programadas (crearProgramados): pedidos para una fecha futura
  programados = null,
}) {
  let numeroVuelta = 0;
  let timer = null;
  let corriendo = false;
  /** Reloj para el panel: cuando toca la proxima vuelta y desde cuando corre la actual. */
  let proximaMs = null;
  let vueltaDesde = null;
  let ultimoAviso = null;
  const resultadosTerminales = new Map();

  async function notificarResultado(pedido, resultado, detalle, idDropi) {
    try {
      const respuesta = await lucidBotContactos?.notificar?.({ pedido, resultado, detalle, idDropi, via: "Dropi automático" });
      if (respuesta && !respuesta.ok && !respuesta.omitido) log.warn?.("[subida] aviso a Lucid Bot falló:", respuesta.detalle);
      return respuesta;
    } catch (e) {
      log.warn?.("[subida] no se pudo notificar a Lucid Bot:", e?.message ?? e);
      return { ok: false, detalle: e?.message ?? String(e) };
    }
  }

  /** Configuracion de entregas programadas, siempre completa. */
  const confProg = (c) => ({
    diasAntes: Math.max(0, Math.min(Number.isFinite(Number(c?.programados?.diasAntes)) ? Number(c.programados.diasAntes) : DIAS_ENTREGA, 30)),
    subirSolo: c?.programados?.subirSolo !== false,
  });

  const archivo = ruta ?? path.join(process.cwd(), "subidaAutomatica.json");

  const DEFECTO = {
    automatico: false,
    cadaSegundos: 120,
    estados: [0],
    tiendas: [],
    dryRun: true,
    transportadoraId: 5,
    // orden de preferencia general (la primera que este disponible y no pase
    // el tope); cada producto puede tener la suya en reglasProducto
    transportadoras: [5],
    // tope del flete: en pesos y/o en % del valor del pedido (null = sin tope)
    envio: { maxPesos: null, maxPorcentaje: null },
    // id de producto de LucidSales -> {nombre, transportadoras[], maxPesos, maxPorcentaje}
    reglasProducto: {},
    // pedidos que recogen en oficina de Inter: se suben si Dropi ofrece UNA sola oficina
    oficinaInter: false,
    // nota minima (0-100) de la direccion en el mapa para subir; 0 = no se mira
    minCalificacionDireccion: MIN_CALIFICACION_DEFECTO,
    // si la direccion del cliente ES una oficina de Inter (aunque no lo diga),
    // se manda a esa oficina por Inter en vez de Coordinadora a domicilio
    detectarOficinaInter: true,
    // entregas programadas: con cuantos dias de anticipacion se envian y si
    // la subida automatica los sube sola cuando llega la fecha
    programados: { diasAntes: DIAS_ENTREGA, subirSolo: true },
    // intentos fallidos antes de dejar el pedido para revision manual
    maxIntentos: 2,
    // tienda de LucidSales (idEmpresa) -> nombre exacto de la tienda en Dropi
    tiendasDropi: {},
    procesados: {},
  };

  function leer() {
    try {
      return { ...DEFECTO, ...JSON.parse(fs.readFileSync(archivo, "utf8")) };
    } catch {
      return { ...DEFECTO };
    }
  }

  function guardar(c) {
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      // se recorta el registro para que el archivo no crezca sin limite
      const claves = Object.keys(c.procesados ?? {});
      if (claves.length > MAX_PROCESADOS) {
        const recientes = claves
          .sort((a, b) => String(c.procesados[b]?.ts ?? "").localeCompare(String(c.procesados[a]?.ts ?? "")))
          .slice(0, MAX_PROCESADOS);
        const nuevo = {};
        for (const k of recientes) nuevo[k] = c.procesados[k];
        c.procesados = nuevo;
      }
      const conAnalisis = Object.keys(c.procesados ?? {}).filter((k) => c.procesados[k]?.analisis);
      if (conAnalisis.length > MAX_CON_ANALISIS) {
        conAnalisis
          .sort((a, b) => String(c.procesados[b]?.ts ?? "").localeCompare(String(c.procesados[a]?.ts ?? "")))
          .slice(MAX_CON_ANALISIS)
          .forEach((k) => delete c.procesados[k].analisis);
      }
      // el estado de la sesion mas reciente gana: una vuelta que empezo antes
      // de actualizar la sesion desde el panel no debe pisarla con la vieja
      try {
        const enDisco = JSON.parse(fs.readFileSync(archivo, "utf8"))?.sesionDropi;
        if (enDisco?.desde && String(enDisco.desde) > String(c.sesionDropi?.desde ?? "")) {
          c.sesionDropi = enDisco;
        }
      } catch {
        /* primer guardado */
      }
      const tmp = `${archivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(c, null, 2), "utf8");
      fs.renameSync(tmp, archivo);
      return true;
    } catch (e) {
      log.warn?.("[subida] no se pudo guardar la config:", e?.message ?? e);
      return false;
    }
  }

  /**
   * Sesion de Dropi caida (login vencido o captcha): avisa al admin por Lucid
   * Bot UNA vez por caida, sin importar cuantos pedidos o vueltas choquen con
   * ella. Se rearma cuando la sesion vuelve a servir (subida/preparacion ok o
   * sesion actualizada desde el panel). Va aunque este en modo preparacion:
   * no es un aviso de un pedido sino de que la automatizacion esta parada.
   */
  async function alertarSesion(c, tipo, detalle, pendientes = null) {
    const previa = c.sesionDropi ?? {};
    const mismaCaida = previa.estado === tipo;
    c.sesionDropi = {
      estado: tipo,
      desde: mismaCaida && previa.desde ? previa.desde : new Date().toISOString(),
      detalle: String(detalle ?? "").slice(0, 300),
      avisado: mismaCaida ? Boolean(previa.avisado) : false,
      ...(pendientes !== null ? { pendientes } : {}),
    };
    if (!c.sesionDropi.avisado) {
      const texto =
        (tipo === "requiere-captcha"
          ? "Dropi está pidiendo captcha y la subida automática se detuvo."
          : "La sesión de Dropi venció y la subida automática se detuvo.") +
        (pendientes ? ` Hay al menos ${pendientes} pedido(s) esperando para subir.` : "") +
        " Entra a Dropi en tu navegador y actualiza la sesión desde el panel (Ajustes > Subida a Dropi > Sesión de Dropi)." +
        " Los pedidos pendientes se suben solos al actualizarla.";
      const r = await notificarResultado(null, tipo === "requiere-captcha" ? "captcha" : "sesion-vencida", texto);
      // si el envio fallo, se intenta de nuevo en la proxima vuelta
      if (r?.ok || r?.omitido) c.sesionDropi.avisado = true;
      c.sesionDropi.aviso = r?.ok ? "enviado" : r?.omitido ? `omitido: ${r.detalle ?? ""}` : `falló: ${r?.detalle ?? ""}`;
    }
    guardar(c);
    return c.sesionDropi;
  }

  /** La sesion vuelve a servir: se limpia la caida (la proxima avisa otra vez). */
  function sesionOk(c, origen = "subida") {
    if (c.sesionDropi?.estado && c.sesionDropi.estado !== "ok") {
      log.log?.(`[subida] sesion de Dropi restablecida (${origen})`);
    }
    c.sesionDropi = { estado: "ok", desde: new Date().toISOString(), origen };
    guardar(c);
  }

  /**
   * Avisa al admin de una tanda de pedidos que quedaron parados (revision o
   * direccion invalida): uno a uno si son pocos, un solo resumen si son muchos.
   */
  async function avisarLote(c, lista, resultado, textoResumen) {
    if (!lista.length) return;
    if (lista.length > MAX_AVISOS_SUELTOS) {
      const ids = lista.slice(0, 15).map((a) => `#${a.id}`).join(", ") + (lista.length > 15 ? "…" : "");
      const motivos = [...new Set(lista.map((a) => (a.detalle.match(/Último motivo \(([^)]+)\)/) ?? [])[1]).filter(Boolean))];
      const r = await notificarResultado(null, resultado, textoResumen(lista.length, ids, motivos));
      if (r?.ok || r?.omitido) {
        for (const a of lista) c.procesados[a.id] = { ...(c.procesados[a.id] ?? {}), notificado: resultado };
      }
      guardar(c);
      return;
    }
    for (const a of lista) {
      await notificarUnaVez(
        c,
        a.id,
        { id: a.id, idPedido: a.id, Nombre: a.contacto.nombre, Movil: a.contacto.telefono },
        resultado,
        a.detalle,
      );
      guardar(c);
    }
  }

  /** Tiendas a revisar: las de la subida; si no, las con Dropi; si no, las del reparto; si no, LUCID_TIENDA. */
  function tiendasARevisar(c) {
    const propias = Array.isArray(c.tiendas) ? c.tiendas.filter(Boolean) : [];
    const delReparto = Array.isArray(asignacion?.getConfig?.()?.tiendas) ? asignacion.getConfig().tiendas : [];
    // sin tiendas marcadas: las que tienen tienda de Dropi configurada (las
    // demas no se podrian subir de todos modos); luego las de siempre
    const conDropi = Object.keys(c.tiendasDropi ?? {}).filter((k) => String(c.tiendasDropi[k] ?? "").trim());
    return (propias.length ? propias : conDropi.length ? conDropi : delReparto.length ? delReparto : [config.LUCID_TIENDA])
      .map((t) => String(t ?? "").trim())
      .filter(Boolean);
  }

  function tiendaDropiDe(c, idEmpresa) {
    const mapa = c?.tiendasDropi && typeof c.tiendasDropi === "object" ? c.tiendasDropi : {};
    return String(mapa[String(idEmpresa ?? "")] ?? "").trim();
  }

  function marcar(c, id, accion, detalle, extra = {}) {
    c.procesados = c.procesados ?? {};
    const previo = c.procesados[String(id)] ?? {};
    // se conserva el ultimo aviso enviado a Lucid Bot (los reintentos no
    // vuelven a notificar) y los datos del cliente si esta vez no llegaron
    const notificado = previo.notificado;
    const clienteDatos = extra.cliente?.telefono || extra.cliente?.nombre ? extra.cliente : previo.cliente;
    // intentos fallidos del pedido: solo suben con los fallos que cuentan
    let intentos = Number(previo.intentos) || 0;
    if (FALLOS_QUE_CUENTAN.has(accion)) intentos++;
    const max = Math.max(1, Number(c.maxIntentos) || 2);
    let accionFinal = accion;
    let detalleFinal = String(detalle ?? "");
    if (FALLOS_QUE_CUENTAN.has(accion) && intentos >= max) {
      accionFinal = "requiere-revision";
      detalleFinal = `No se subió tras ${intentos} intento(s); ya no se reintenta. Último motivo (${accion}): ${detalleFinal}`;
    } else if (FALLOS_QUE_CUENTAN.has(accion)) {
      detalleFinal = `[intento ${intentos} de ${max}] ${detalleFinal}`;
    }
    c.procesados[String(id)] = {
      ts: new Date().toISOString(),
      accion: accionFinal,
      // amplio: los errores del navegador traen un diagnostico del formulario
      detalle: detalleFinal.slice(0, 1600),
      ...(intentos ? { intentos } : {}),
      ...(notificado ? { notificado } : {}),
      ...(clienteDatos ? { cliente: clienteDatos } : {}),
      ...(extra.analisis ? { analisis: extra.analisis } : {}),
      // lo que mostro Dropi al subir: id de la orden, ganancia y envio
      ...(extra.dropi ?? previo.dropi ? { dropi: extra.dropi ?? previo.dropi } : {}),
      // tienda de LucidSales del pedido (para separar por tienda despues)
      ...(extra.tienda ?? previo.tienda ? { tienda: extra.tienda ?? previo.tienda } : {}),
      // estado del pedido en LucidSales cuando se marco (para notar si una
      // persona lo movio despues)
      ...(Number.isInteger(extra.estadoPedido ?? previo.estadoPedido)
        ? { estadoPedido: extra.estadoPedido ?? previo.estadoPedido }
        : {}),
    };
    guardar(c);
    // la entrega programada ya salio (subida por Zunto o a mano)
    if (["subido", "subido-pendiente-confirmacion", "resuelto-a-mano"].includes(accionFinal)) {
      try {
        programados?.marcarEnviado?.(id);
      } catch {
        /* sin registro */
      }
    }
    return c.procesados[String(id)];
  }

  /**
   * Avisa a Lucid Bot UNA sola vez por pedido y resultado. Un pedido que se
   * reintenta en cada vuelta y vuelve a fallar no dispara el flujo otra vez.
   */
  async function notificarUnaVez(c, id, pedido, resultado, detalle, idDropi) {
    const clave = String(id);
    c.procesados = c.procesados ?? {};
    if (c.procesados[clave]?.notificado === resultado) return { ok: true, omitido: true, repetido: true };
    const respuesta = await notificarResultado(pedido, resultado, detalle, idDropi);
    // solo se recuerda si se envio (o Lucid Bot lo omitio a proposito);
    // si fallo el envio, la proxima vuelta lo intenta de nuevo
    if (respuesta?.ok || respuesta?.omitido) {
      c.procesados[clave] = { ...(c.procesados[clave] ?? {}), notificado: resultado };
    }
    return respuesta;
  }

  /**
   * Una vuelta. `forzar:true` la ejecuta aunque este apagado (boton Probar).
   */
  async function tick(opciones = {}) {
    const c = leer();
    if (!c.automatico && !opciones.forzar) return { ok: true, saltado: "desactivado" };
    if (corriendo) return { ok: true, saltado: "en curso" };
    corriendo = true;
    vueltaDesde = new Date().toISOString();

    try {
      // Tiendas que revisar: las de la config de subida; si no, las del reparto
      // (asignacion.json); si no, LUCID_TIENDA. Asi no hay que duplicarlas.
      const tiendas = tiendasARevisar(c);
      if (!tiendas.length) {
        throw new ErrorApi(
          400,
          "No hay tienda que revisar: marca una tienda en el panel o configura LUCID_TIENDA",
        );
      }

      const estados = (Array.isArray(c.estados) ? c.estados : []).map(Number).filter(Number.isInteger);
      let subidos = 0;
      let frenados = 0;
      let omitidos = 0;
      let inciertos = 0;
      const detalle = [];

      let detenido = null;
      const agotados = [];
      const invalidas = [];
      // unica por vuelta (dos vueltas en el mismo milisegundo no se juntan)
      const claveVuelta = `${new Date().toISOString()}#${++numeroVuelta}`;
      vueltaTiendas: for (const idEmpresa of tiendas) {
        // los mas recientes de la tienda, en paginas de 100 (hasta 200)
        const pedidos = [];
        const vistos = new Set();
        for (let pagina = 1; pagina * POR_PAGINA <= MAX_PEDIDOS_VUELTA; pagina++) {
          const r = await cliente.listarPedidos({
            idEmpresa,
            page: pagina,
            itemsPerPage: POR_PAGINA,
            filtros: [{ name: "date", searchValues: [], sortOrder: "desc" }],
          });
          const lote = Array.isArray(r?.pedidos) ? r.pedidos : [];
          for (const x of lote) {
            const k = String(x?.id ?? x?.idPedido ?? "");
            if (k && vistos.has(k)) continue;
            if (k) vistos.add(k);
            pedidos.push(x);
          }
          if (lote.length < POR_PAGINA) break; // no hay mas
        }
        // cuantos de esta tienda siguen esperando (para el aviso de sesion)
        const esperando = pedidos.filter((x) => {
          const acc = c.procesados?.[String(x?.id ?? x?.idPedido ?? "")]?.accion;
          if (FINALES.has(acc) || acc === "subido-pendiente-confirmacion") return false;
          return !estados.length || estados.includes(Number(x?.EstadoPedido));
        }).length;

        for (const p of pedidos) {
          const id = String(p?.id ?? p?.idPedido ?? "");
          if (!id) continue;
          // datos del cliente para la tabla del panel (telefono -> chat)
          const contacto = {
            telefono: String(p?.Movil ?? "").trim(),
            nombre: [p?.Nombre, p?.Apellido].filter(Boolean).join(" ").trim(),
          };
          let analisisActual = null;
          let dropiActual = null; // { id, ganancia, envio } cuando Dropi la muestra
          // lo que se va sabiendo de este intento (para el historial)
          const intento = { origen: "automatica", dryRun: c.dryRun === true };
          const marcarP = (accion, det) => {
            const e = marcar(c, id, accion, det, {
              tienda: Number(idEmpresa) || null,
              estadoPedido: Number.isInteger(Number(p?.EstadoPedido)) && p?.EstadoPedido !== undefined && p?.EstadoPedido !== null ? Number(p.EstadoPedido) : undefined,
              cliente: { ...contacto },
              ...(analisisActual ? { analisis: analisisActual } : {}),
              ...(dropiActual ? { dropi: dropiActual } : {}),
            });
            try {
              intentos?.registrar({
                pedido: id,
                numero: p?.idPedido ?? null,
                tienda: Number(idEmpresa) || null,
                clave: `${claveVuelta}:${id}`,
                ...intento,
                accion: e?.accion ?? accion,
                detalle: e?.detalle ?? String(det ?? ""),
                analisis: analisisActual,
              });
            } catch (err) {
              log.warn?.("[subida] no se pudo guardar el intento:", err?.message ?? err);
            }
            if (e?.accion === "requiere-revision" && accion !== "requiere-revision") {
              agotados.push({ id, detalle: e.detalle, contacto: { ...contacto } });
            }
            return e;
          };
          const anterior = c.procesados?.[id];
          // Dropi ya confirmó la creación. Si solo falló la actualización de
          // LucidSales, reintenta el estado sin volver a crear la orden.
          if (anterior?.accion === "subido-pendiente-confirmacion") {
            try {
              const pedidoActual = await cliente.obtenerPedido(id, idEmpresa);
              const estadoActual = Number(pedidoActual?.EstadoPedido);
              if (estadoActual === 2) {
                marcarP("subido", `${anterior.detalle}; LucidSales ya está Confirmado`);
              } else if ([0, 3].includes(estadoActual)) {
                const cambio = await cambiarEstado({ cliente, id, estado: 2, soloDesde: [0, 3], tienda: idEmpresa });
                if (cambio.noActualizado) {
                  marcarP("subido", `${anterior.detalle}; no se retrocedió el estado de LucidSales: ${cambio.msg}`);
                } else {
                  marcarP("subido", `${anterior.detalle}; LucidSales actualizado a Confirmado`);
                }
              } else {
                marcarP("subido", `${anterior.detalle}; se conservó el estado avanzado ${estadoActual}`);
              }
            } catch (e) {
              marcarP("subido-pendiente-confirmacion", `${anterior.detalle}; pendiente Confirmado en LucidSales: ${e?.message ?? e}`);
            }
            omitidos++;
            continue;
          }
          // Solo una creación confirmada (o un resultado incierto que requiere
          // conciliación humana) bloquea nuevos intentos. Errores, frenados,
          // chats que aún no llegaron y preparaciones dryRun se vuelven a mirar.
          // En revision y una persona ya movio el pedido en LucidSales (lo
          // subio a mano y lo confirmo, o lo cancelo): queda resuelto y sale
          // de las alertas; «Reintentar todos» ya no lo vuelve a subir.
          if (RESOLUBLES.has(anterior?.accion)) {
            const ahora = Number(p?.EstadoPedido);
            const antes = anterior.estadoPedido;
            const movido = Number.isInteger(antes)
              ? Number.isInteger(ahora) && ahora !== antes
              : Number.isInteger(ahora) && ![0, 3].includes(ahora) && (!estados.length || !estados.includes(ahora));
            if (movido) {
              marcar(c, id, "resuelto-a-mano", `una persona lo resolvió: en LucidSales pasó a estado ${ahora} (antes: ${anterior.detalle ?? anterior.accion})`, {
                estadoPedido: ahora,
              });
              continue;
            }
          }
          // Entrega programada (la IA vio que el cliente la pidió para otra
          // fecha, o una persona la marcó): espera hasta que se acerque.
          let entregaProgramada = null;
          const prog = FINALES.has(anterior?.accion) ? null : (programados?.get?.(id) ?? null);
          if (prog && !prog.enviado) {
            const { diasAntes, subirSolo } = confProg(c);
            const toca = Boolean(prog.anulado) || prog.faltan <= diasAntes;
            if (toca && subirSolo) {
              // ya toca: se analiza como cualquier pedido, sin frenar por la fecha
              entregaProgramada = { fecha: prog.fecha, toca: true };
              if (anterior?.accion === "entrega-programada") delete c.procesados[id];
            } else {
              const det = toca
                ? `entrega programada para el ${prog.fecha}: ya toca enviarlo (súbelo desde el pedido; la subida automática no sube los programados sola)`
                : `entrega programada para el ${prog.fecha}${prog.nota ? ` (${prog.nota})` : ""}: ${
                    subirSolo ? `se sube sola ${diasAntes ? `${diasAntes} día(s) antes` : "ese día"}` : "se resalta cuando se acerque"
                  }`;
              if ((!estados.length || estados.includes(Number(p?.EstadoPedido))) && (anterior?.accion !== "entrega-programada" || !String(anterior?.detalle ?? "").includes(prog.fecha) || (toca && !String(anterior?.detalle ?? "").includes("ya toca")))) {
                marcarP("entrega-programada", det);
              }
              continue;
            }
          } else if (anterior?.accion === "entrega-programada") {
            // ya no tiene marca: se vuelve a mirar como cualquier pedido
            delete c.procesados[id];
          }
          if (FINALES.has(anterior?.accion)) continue;
          if (estados.length && !estados.includes(Number(p?.EstadoPedido))) continue;
          omitidos++;

          // 1) pedido canónico y conversación más reciente en LucidBot.
          let pedidoCompleto;
          let resumen;
          try {
            pedidoCompleto = await cliente.obtenerPedido(id, idEmpresa);
            resumen = resumenDePedido(pedidoCompleto);
            contacto.telefono = resumen.telefono || contacto.telefono;
            contacto.nombre = resumen.cliente || contacto.nombre;
          } catch (e) {
            marcarP("error", e?.message ?? "no se pudo leer el pedido");
            continue;
          }
          // Pedidos que SIEMPRE sube una persona. Se miran apenas se lee el
          // pedido (sin consultar el chat ni la IA) y quedan finales.
          //  - recoge en oficina de Inter Rapidisimo / Coordinadora
          //  - "Sin Recaudo" (prepago)
          const oficina = recogeEnOficina(resumen?.direccion, resumen?.referencias);
          // Inter con la opcion encendida sigue el flujo normal (y solo se
          // sube si Dropi ofrece UNA oficina); Coordinadora siempre a mano
          const oficinaAuto = oficina === "Inter Rapidísimo" && c.oficinaInter === true;
          if (oficina && !oficinaAuto) {
            marcarP("requiere-humano", `recoge en oficina de ${oficina}: lo sube una persona eligiendo la oficina en Dropi`);
            detalle.push({ id, accion: "requiere-humano", detalle: `oficina de ${oficina}` });
            continue;
          }
          if (Number(resumen?.tipoPago) === 2) {
            marcarP("requiere-humano", "pedido sin recaudo (prepago): lo sube una persona");
            detalle.push({ id, accion: "requiere-humano", detalle: "pedido sin recaudo (prepago)" });
            continue;
          }
          // producto con variantes: en Dropi hay que elegir la variante (color,
          // talla...) y eso todavia lo hace una persona
          const conVariante = textoVariantes(resumen);
          if (conVariante) {
            marcarP("requiere-humano", `producto con variantes (${conVariante}): lo sube una persona eligiendo la variante en Dropi`);
            detalle.push({ id, accion: "requiere-humano", detalle: "producto con variantes" });
            continue;
          }

          const conv = conversacion.porPedido(id);
          let mensajes = conv?.mensajes ?? [];
          const chatUrl = conv?.meta?.chatUrl ?? conv?.meta?.chat_url ?? conv?.meta?.inboxUrl ?? "";
          if (lucidBotContactos?.obtenerConversacion) {
            const chat = await lucidBotContactos.obtenerConversacion({ pedido: pedidoCompleto, chatUrl });
            if (chat.configurado) {
              if (!chat.ok) {
                marcarP("sin-conversacion", `no se pudo traer la conversación actual de LucidBot: ${chat.detalle}`);
                detalle.push({ id, accion: "sin-conversacion", detalle: chat.detalle });
                continue;
              }
              mensajes = chat.mensajes;
            }
          }
          if (!mensajes.length) {
            marcarP("sin-conversacion", "no hay una conversación reciente disponible en LucidBot");
            continue;
          }

          // la tienda de Dropi sale de la configuracion; sin ella no se sube
          // (se mira antes del agente para no gastar el LLM en balde)
          const tiendaDropi = tiendaDropiDe(c, resumen?.idEmpresa || idEmpresa);
          if (!tiendaDropi) {
            marcarP("sin-tienda-dropi", `la tienda ${resumen?.idEmpresa || idEmpresa} no tiene tienda de Dropi configurada`);
            detalle.push({ id, accion: "sin-tienda-dropi" });
            continue;
          }

          // 2) validar el estado del pedido antes de ejecutar el agente.
          if (![0, 2, 3].includes(Number(resumen.estadoPedido))) {
            marcarP("estado-incompatible", `estado ${resumen.estadoPedido}: solo se suben pedidos Por confirmar, Confirmado o Modificado`);
            detalle.push({ id, accion: "estado-incompatible", detalle: `estado ${resumen.estadoPedido}` });
            continue;
          }

          // 3) el agente decide
          // ¿el mismo cliente tiene otro pedido reciente? (salvo que una persona
          // ya dijera que este es una compra nueva)
          const otrosPedidos = c.duplicadosAprobados?.[id]
            ? []
            : otrosPedidosDelCliente(p, pedidos, { procesados: c.procesados });
          const r2 = await ejecutarAgente({ resumen, mensajes, extraer, oficina: oficinaAuto ? oficina : null, otrosPedidos, entregaProgramada, diasEntrega: confProg(c).diasAntes });
          analisisActual = resumirAnalisis(r2);
          // la IA no respondio (timeout, saldo, clave): error tecnico, no un
          // pedido frenado por su contenido
          if (r2.falloIA) {
            marcarP("error", `la IA no pudo leer el chat: ${r2.falloIA}`);
            detalle.push({ id, accion: "error", detalle: r2.falloIA });
            continue;
          }
          // direccion que no es de nomenclatura colombiana: no se sube, queda
          // marcada (final) y se avisa al admin. Reintentar no la arregla sola.
          if (r2.direccionInvalida) {
            const det = r2.problemas.map((x) => `${x.campo}: ${x.detalle}`).join("; ");
            marcarP("direccion-invalida", det);
            invalidas.push({ id, detalle: det, contacto: { ...contacto } });
            frenados++;
            detalle.push({ id, accion: "direccion-invalida" });
            continue;
          }
          // solo falla lo de "repetido": lo revisa una persona (no se reintenta solo)
          if (r2.accion !== "subir" && r2.problemas.every((x) => x.campo === "duplicado")) {
            const det = r2.problemas[0].detalle;
            if (!c.dryRun) {
              await notificarUnaVez(c, id, { id: resumen?.id, idPedido: resumen?.idPedido, Movil: resumen?.telefono }, "fallido", det);
            }
            marcarP("posible-duplicado", det);
            frenados++;
            detalle.push({ id, accion: "posible-duplicado", detalle: det });
            continue;
          }
          // lo unico que frena es que el cliente pidio otra fecha y se sabe
          // cual: queda programado (sin gastar intentos) y espera su dia
          if (r2.accion !== "subir" && r2.entrega?.fecha && programados && r2.problemas.every((x) => x.campo === "entregaFutura")) {
            let prog2 = null;
            try {
              prog2 = programados.poner(id, {
                fecha: r2.entrega.fecha,
                origen: "ia",
                texto: r2.entrega.texto,
                numero: resumen?.idPedido ?? p?.idPedido ?? null,
                tienda: Number(idEmpresa) || null,
                cliente: { ...contacto },
              });
            } catch (e) {
              log.warn?.(`[subida] pedido ${id}: no se pudo programar la entrega:`, e?.message ?? e);
            }
            if (prog2) {
              marcarP("entrega-programada", `la IA vio que el cliente pidió la entrega para el ${prog2.fecha}${r2.entrega.texto ? ` («${r2.entrega.texto}»)` : ""}: queda programado`);
              frenados++;
              detalle.push({ id, accion: "entrega-programada", detalle: prog2.fecha });
              continue;
            }
          }
          if (r2.accion !== "subir") {
            marcarP("frenado", r2.problemas.map((x) => `${x.campo}: ${x.detalle}`).join("; "));
            frenados++;
            detalle.push({ id, accion: "frenar", motivos: r2.problemas.map((x) => x.campo) });
            continue;
          }

          // 4) se sube (o solo se prepara si dryRun)
          //    la ciudad/depto van por NOMBRE: los ids de LucidSales no le
          //    sirven al autocomplete del formulario de Dropi
          let depto = String(resumen?.departamento ?? "");
          let ciudad = String(resumen?.ciudad ?? "");
          if (resolverUbicacion && depto && ciudad) {
            let ub = null;
            try {
              ub = await resolverUbicacion({
                pais: resumen?.pais ?? 47,
                idDepartamento: depto,
                idCiudad: ciudad,
              });
              depto = ub?.departamento ?? depto;
              ciudad = ub?.ciudad ?? ciudad;
            } catch (e) {
              marcarP("error", `no se pudo resolver ciudad/departamento: ${e?.message ?? e}`);
              detalle.push({ id, accion: "error", detalle: "no se pudo resolver ciudad/departamento" });
              continue;
            }
            if (!ub?.departamento || !ub?.ciudad) {
              marcarP("error", "la ciudad/departamento no se resolvió a nombres válidos");
              detalle.push({ id, accion: "error", detalle: "ciudad/departamento no resueltos" });
              continue;
            }
          }

          // calificacion de la direccion en el mapa: el codigo decide con el
          // minimo configurado (no aplica a oficinas)
          let direccionEnvio = (oficinaAuto ? null : r2.direccionEnvio?.normalizada) || resumen?.direccion;
          if (!oficinaAuto) {
            let ev = null;
            try {
              ev = await evaluarDireccion({
                validador: validadorDireccion,
                minimo: c.minCalificacionDireccion ?? MIN_CALIFICACION_DEFECTO,
                direccion: direccionEnvio,
                referencias: resumen?.referencias ?? "",
                ciudad,
                departamento: depto,
              });
            } catch (e) {
              log.warn?.("[subida] no se pudo calificar la dirección:", e?.message ?? e);
            }
            if (ev) {
              intento.direccion = ev.validacion ?? null;
              if (analisisActual) analisisActual.checks = [...(analisisActual.checks ?? []), ev.check];
              if (!ev.ok) {
                marcarP("direccion-invalida", ev.check.detalle);
                invalidas.push({ id, detalle: ev.check.detalle, contacto: { ...contacto } });
                frenados++;
                detalle.push({ id, accion: "direccion-invalida", calificacion: ev.calificacion });
                continue;
              }
              direccionEnvio = ev.direccion;
            }
          }

          // ¿la direccion es una oficina de Inter aunque no diga "oficina"?
          // Por Coordinadora a esa direccion se devolveria: va a esa oficina.
          let oficinaDetectada = null;
          if (!oficinaAuto && c.detectarOficinaInter !== false) {
            oficinaDetectada = await detectarOficinaInter({
              buscar: buscarOficinasInter,
              direccion: direccionEnvio,
              ciudad,
              departamento: depto,
              log,
            });
          }
          const aOficina = oficinaAuto || Boolean(oficinaDetectada);
          if (oficinaDetectada) {
            intento.oficina = {
              como: "detectada",
              nombre: oficinaDetectada.nombre ?? null,
              direccion: oficinaDetectada.direccion ?? null,
            };
          } else if (oficinaAuto) {
            intento.oficina = { como: "cliente", direccion: resumen?.direccion ?? null };
          }

          // el link navegable del producto en Dropi (sale del Google Sheets):
          //   id de LucidSales -> idProductoDropi -> dropiLink
          const idProductoLucid = resumen?.productos?.[0]?.id;
          let productoUrl = null;
          let motivoProducto = "producto sin link de Dropi en el sheet";
          if (resolverProductoDropi && idProductoLucid) {
            try {
              productoUrl = await resolverProductoDropi(idProductoLucid);
            } catch (e) {
              motivoProducto = `sin link de Dropi: ${e?.message ?? e}`;
              log.warn?.("[subida] no se pudo resolver el producto en Dropi:", e?.message ?? e);
            }
          }
          if (!productoUrl) {
            marcarP("error", motivoProducto);
            detalle.push({ id, accion: "error", detalle: motivoProducto });
            continue;
          }

          const partes = String(resumen?.cliente ?? "").trim().split(/\s+/);
          const contactoPedido = {
            id: resumen?.id,
            idPedido: resumen?.idPedido,
            Nombre: partes[0] ?? "",
            Apellido: partes.slice(1).join(" "),
            Movil: resumen?.telefono,
            chatUrl: conv?.meta?.chatUrl ?? conv?.meta?.chat_url ?? conv?.meta?.inboxUrl ?? "",
          };
          const plan = planEnvio(c, resumen, { oficina: aOficina ? "Inter Rapidísimo" : null });
          intento.envio = {
            transportadoras: plan.transportadoras,
            tope: plan.maxEnvio ?? null,
            motivoTope: plan.motivoTope ?? null,
          };
          let rNav;
          try {
            rNav = await dropiNav.subirPedido({
              productoUrl,
              nombre: partes[0] ?? "",
              apellido: partes.slice(1).join(" "),
              telefono: resumen?.telefono,
              // la direccion validada (normalizada o corregida por formato),
              // coma y las referencias del pedido (barrio, puntos de referencia)
              // oficina detectada (el cliente no dijo "oficina"): en Dropi la
              // direccion queda "Oficina Interrapidisimo" (asi muestra la lista
              // de oficinas) y se elige la oficina que coincide con la del cliente
              direccion: oficinaDetectada
                ? DIRECCION_OFICINA_INTER
                : aOficina
                  ? direccionEnvio
                  : direccionConReferencias(direccionEnvio, resumen?.referencias),
              departamento: depto,
              ciudad,
              // si vive en un corregimiento, en Dropi se busca ese municipio
              corregimiento: r2.extraido?.corregimiento || "",
              transportadoras: plan.transportadoras,
              maxEnvio: plan.maxEnvio,
              oficinaInter: plan.oficinaInter,
              // la oficina a elegir: la detectada, o la direccion que escribio
              // junto a "oficina inter" (sin direccion: regla de una sola)
              oficinaObjetivo: oficinaDetectada ? oficinaDetectada.direccion || oficinaDetectada.nombre : oficinaAuto ? resumen?.direccion : null,
              tienda: tiendaDropi,
              seguro: true,
              tipoPago: resumen?.tipoPago,
              productos: (resumen?.productos ?? []).map((x) => ({
                id: x.id,
                cantidad: x.cantidad,
                precio: x.precio,
              })),
              soloPreparar: c.dryRun === true,
            });
          } catch (e) {
            const detalleError = e?.message ?? String(e);
            if (!c.dryRun) await notificarUnaVez(c, id, contactoPedido, "fallido", detalleError);
            marcarP("error", detalleError);
            detalle.push({ id, accion: "error", detalle: detalleError });
            continue;
          }

          // El navegador estaba ocupado con otra subida (p. ej. una manual):
          // no es un fallo del pedido. No se marca ni se avisa; la vuelta se
          // corta y el pedido se mira en la siguiente.
          if (rNav?.ocupado) {
            detenido = "navegador de Dropi ocupado con otra subida";
            break vueltaTiendas;
          }
          // Sesion vencida o captcha: es un problema de NUESTRA sesion, no del
          // pedido. No se avisa al contacto y se corta la vuelta entera (los
          // demas pedidos chocarian con lo mismo). Se reintenta al resolverlo.
          if (rNav?.requiereLogin || rNav?.requiereCaptcha) {
            marcarP(rNav.requiereLogin ? "requiere-login" : "requiere-captcha", rNav.detalle);
            detalle.push({ id, accion: rNav.requiereLogin ? "requiere-login" : "requiere-captcha" });
            detenido = rNav.requiereLogin ? "la sesion de Dropi vencio" : "Dropi exige captcha";
            await alertarSesion(
              c,
              rNav.requiereLogin ? "requiere-login" : "requiere-captcha",
              rNav.detalle,
              esperando,
            );
            break vueltaTiendas;
          }
          if (rNav?.envio) intento.envio = { ...intento.envio, elegida: rNav.envio };
          if (rNav?.idDropi || rNav?.resumenDropi) {
            dropiActual = {
              id: rNav.idDropi ?? null,
              ganancia: rNav.resumenDropi?.ganancia ?? null,
              envio: rNav.resumenDropi?.envio ?? null,
              transportadora: rNav.envio?.transportadora ?? null,
            };
            intento.dropi = dropiActual;
          }
          // llego al formulario: la sesion sirve
          if (c.sesionDropi?.estado && c.sesionDropi.estado !== "ok" && (rNav?.ok || rNav?.creado || rNav?.preparado)) {
            sesionOk(c, "subida");
          }
          if (rNav?.resultadoIncierto) {
            await notificarUnaVez(c, id, contactoPedido, "incierto", rNav.detalle, rNav?.idDropi);
            marcarP("resultado-incierto", rNav.detalle);
            detalle.push({ id, accion: "resultado-incierto", detalle: rNav.detalle });
            inciertos++;
            continue;
          }
          // envio caro, sin transportadora o varias oficinas: es un resultado
          // del PEDIDO (reintentar no lo cambia). Queda final y se avisa.
          if (rNav?.envioCaro || rNav?.sinTransportadora || rNav?.oficinaHumano || rNav?.corregimientoHumano) {
            const accion = rNav.envioCaro ? "envio-caro" : rNav.sinTransportadora ? "sin-transportadora" : "requiere-humano";
            const det = `${rNav.detalle}${plan.motivoTope && rNav.envioCaro ? ` (tope: ${plan.motivoTope})` : ""}`;
            if (!c.dryRun) await notificarUnaVez(c, id, contactoPedido, "fallido", det);
            marcarP(accion, det);
            detalle.push({ id, accion, detalle: det });
            frenados++;
            continue;
          }
          if (!rNav?.ok) {
            if (!c.dryRun) await notificarUnaVez(c, id, contactoPedido, "fallido", rNav?.detalle ?? "no se pudo subir");
            marcarP("error", rNav?.detalle ?? "no se pudo subir");
            detalle.push({ id, accion: "error", detalle: rNav?.detalle });
            continue;
          }

          if (!c.dryRun && !rNav?.creado) {
            await notificarUnaVez(c, id, contactoPedido, "fallido", rNav?.detalle ?? "Dropi no confirmó la creación");
            marcarP("error", rNav?.detalle ?? "Dropi no confirmó la creación");
            detalle.push({ id, accion: "error", detalle: rNav?.detalle ?? "Dropi no confirmó la creación" });
            continue;
          }
          const textoEnvio =
            (rNav.envio
              ? `; ${rNav.envio.transportadora} $${Math.round(rNav.envio.precio ?? 0).toLocaleString("es-CO")}${rNav.envio.oficina ? ` (oficina ${rNav.envio.oficina})` : ""}`
              : "") + (oficinaDetectada ? "; la dirección del cliente es una oficina de Interrapidísimo" : "");
          let detalleFinal = c.dryRun
            ? `formulario preparado${textoEnvio}; seguro=${rNav.seguro}`
            : `Dropi #${rNav.idDropi ?? "confirmado"}${textoEnvio}; seguro=${rNav.seguro}`;
          let pendienteConfirmacion = false;
          if (!c.dryRun && rNav.creado) {
            // Registrar el éxito de Dropi antes de llamar a LucidSales: si esa
            // actualización falla o el proceso cae, no se duplica la orden.
            marcarP("subido", detalleFinal);
          }
          if (!c.dryRun && rNav.creado) {
            const estadoActual = Number(resumen?.estadoPedido);
            if (estadoActual === 2) {
              detalleFinal += "; LucidSales ya estaba Confirmado";
            } else if ([0, 3].includes(estadoActual)) {
              try {
                const cambioEstado = await cambiarEstado({ cliente, id, estado: 2, soloDesde: [0, 3], tienda: idEmpresa });
                detalleFinal += cambioEstado.noActualizado
                  ? `; ${cambioEstado.msg}`
                  : "; LucidSales actualizado a Confirmado";
              } catch (e) {
                detalleFinal += `; pendiente actualizar LucidSales a Confirmado: ${e?.message ?? e}`;
                pendienteConfirmacion = true;
              }
            } else {
              detalleFinal += `; LucidSales conservó el estado ${Number.isFinite(estadoActual) ? estadoActual : "desconocido"} para no retroceder un pedido avanzado`;
            }
          }
          if (!c.dryRun && rNav.creado) {
            const avisoLucidBot = await notificarUnaVez(c, id, contactoPedido, "exitoso", detalleFinal, rNav.idDropi);
            if (avisoLucidBot && !avisoLucidBot.ok && !avisoLucidBot.omitido) {
              detalleFinal += `; aviso Lucid Bot falló: ${avisoLucidBot.detalle}`;
            }
          }
          marcarP(c.dryRun ? "preparado" : pendienteConfirmacion ? "subido-pendiente-confirmacion" : "subido", detalleFinal);
          subidos++;
          detalle.push({ id, accion: c.dryRun ? "preparado" : "subido", seguro: rNav.seguro });
        }
      }

      await avisarLote(c, agotados, "requiere-revision", (n, lista, motivos) =>
        `${n} pedidos pasaron a revisión manual tras agotar los intentos` +
          (motivos.length ? ` (motivo: ${motivos.join(", ")})` : "") +
          `: ${lista}. Puede ser un problema de configuración; revísalos en el panel (Subida a Dropi) y pulsa «Reintentar todos» cuando esté resuelto.`);
      for (const a of agotados) detalle.push({ id: a.id, accion: "requiere-revision" });
      await avisarLote(c, invalidas, "direccion-invalida", (n, lista) =>
        `${n} pedidos tienen una dirección que no es válida en Colombia y no se subieron: ${lista}. Pide al cliente la dirección con el formato «Cra 40 # 23-23, barrio», corrígela en el pedido y pulsa «Reintentar».`);
      if (invalidas.length) log.log(`[subida] ${invalidas.length} pedido(s) con dirección inválida`);
      if (agotados.length) log.log(`[subida] ${agotados.length} pedido(s) pasan a revisión manual`);

      if (subidos || frenados) {
        log.log(`[subida] ${c.dryRun ? "preparados" : "subidos"}: ${subidos}, frenados: ${frenados}`);
      }
      if (detenido) {
        if (detenido !== ultimoAviso) log.warn?.(`[subida] vuelta detenida: ${detenido}`);
        ultimoAviso = detenido;
      } else {
        ultimoAviso = null;
      }
      return {
        ok: true,
        subidos,
        frenados,
        revision: agotados.length,
        omitidos,
        inciertos,
        dryRun: c.dryRun,
        detalle,
        ...(detenido ? { detenido } : {}),
      };
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg !== ultimoAviso) {
        log.warn?.("[subida] error en la vuelta:", msg);
        ultimoAviso = msg;
      }
      return { ok: false, error: msg };
    } finally {
      corriendo = false;
      vueltaDesde = null;
    }
  }

  return {
    /** Arranca el intervalo. Si esta apagado el tick no hace nada. */
    arrancar() {
      if (timer) return;
      const c = leer();
      const seg = segundosValidos(c.cadaSegundos);
      proximaMs = Date.now() + seg * 1000;
      timer = setInterval(() => {
        proximaMs = Date.now() + seg * 1000;
        tick().catch(() => {});
      }, seg * 1000);
      // unref: el intervalo no debe mantener vivo el proceso por si solo
      // (en el server lo sostiene el listen, y en las pruebas no debe colgar)
      if (typeof timer.unref === "function") timer.unref();
      log.log(`[subida] automatica ${c.automatico ? "ACTIVA" : "apagada"} (cada ${seg}s, dryRun=${c.dryRun})`);
    },

    detener() {
      if (timer) clearInterval(timer);
      timer = null;
      proximaMs = null;
    },

    tick,

    /** Configuracion actual (sin el registro de procesados). */
    config() {
      const c = leer();
      const { procesados, ...resto } = c;
      return {
        ...resto,
        procesados: Object.keys(procesados ?? {}).length,
        // para el temporizador del panel (no se guarda)
        reloj: {
          ahora: new Date().toISOString(),
          proxima: timer && c.automatico && proximaMs ? new Date(proximaMs).toISOString() : null,
          enCurso: corriendo,
          desde: vueltaDesde,
          detenida: c.sesionDropi?.estado && c.sesionDropi.estado !== "ok" ? c.sesionDropi.estado : null,
        },
      };
    },

    /** Actualiza la configuracion. */
    configurar(patch = {}) {
      const c = leer();
      for (const k of ["automatico", "dryRun"]) {
        if (k in patch) c[k] = Boolean(patch[k]);
      }
      if ("cadaSegundos" in patch) c.cadaSegundos = segundosValidos(patch.cadaSegundos);
      if ("transportadoras" in patch) {
        const lista = listaTransportadoras(patch.transportadoras);
        if (!lista.length) throw new ErrorApi(400, "Elige al menos una transportadora");
        c.transportadoras = lista;
        c.transportadoraId = lista[0];
      }
      if ("envio" in patch && patch.envio && typeof patch.envio === "object") {
        c.envio = { maxPesos: topePesos(patch.envio.maxPesos), maxPorcentaje: topePct(patch.envio.maxPorcentaje) };
      }
      if ("oficinaInter" in patch) c.oficinaInter = Boolean(patch.oficinaInter);
      if ("detectarOficinaInter" in patch) c.detectarOficinaInter = Boolean(patch.detectarOficinaInter);
      if ("minCalificacionDireccion" in patch) {
        const n = Number(patch.minCalificacionDireccion);
        c.minCalificacionDireccion = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : MIN_CALIFICACION_DEFECTO;
      }
      if ("reglasProducto" in patch && patch.reglasProducto && typeof patch.reglasProducto === "object") {
        const limpio = {};
        for (const [k, v] of Object.entries(patch.reglasProducto)) {
          const clave = String(k).trim();
          if (!/^\d{1,12}$/.test(clave) || !v || typeof v !== "object") continue;
          const regla = {
            nombre: String(v.nombre ?? "").trim().slice(0, 160),
            transportadoras: listaTransportadoras(v.transportadoras),
            maxPesos: topePesos(v.maxPesos),
            maxPorcentaje: topePct(v.maxPorcentaje),
          };
          // una regla vacia no sirve: se descarta
          if (regla.transportadoras.length || regla.maxPesos || regla.maxPorcentaje) limpio[clave] = regla;
        }
        c.reglasProducto = limpio;
      }
      if ("estados" in patch && Array.isArray(patch.estados)) c.estados = patch.estados.map(Number).filter(Number.isInteger);
      if ("tiendas" in patch && Array.isArray(patch.tiendas)) c.tiendas = patch.tiendas.map(String);
      if ("transportadoraId" in patch && !("transportadoras" in patch)) {
        c.transportadoraId = Number(patch.transportadoraId) || 5;
      }
      if ("programados" in patch && patch.programados && typeof patch.programados === "object") {
        c.programados = confProg({ programados: { ...confProg(c), ...patch.programados } });
      }
            if ("maxIntentos" in patch) c.maxIntentos = Math.max(1, Math.min(Number(patch.maxIntentos) || 2, 10));
      if ("tiendasDropi" in patch && patch.tiendasDropi && typeof patch.tiendasDropi === "object") {
        const limpio = {};
        for (const [k, v] of Object.entries(patch.tiendasDropi)) {
          const clave = String(k).trim();
          const nombre = String(v ?? "").trim().slice(0, 120);
          if (clave && nombre) limpio[clave] = nombre;
        }
        c.tiendasDropi = limpio;
      }
      guardar(c);
      this.detener();
      this.arrancar();
      return this.config();
    },

    /** Ultimos pedidos tratados, mas recientes primero. */
    ultimos(limite = 30) {
      const c = leer();
      return Object.entries(c.procesados ?? {})
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
        .slice(0, Math.max(1, Math.min(Number(limite) || 30, 200)));
    },

    /** Estado de la sesion de Dropi visto por la subida. */
    sesion() {
      return leer().sesionDropi ?? { estado: "desconocido" };
    },

    /** La subida manual tambien reporta caidas de sesion (mismo aviso unico). */
    async reportarSesion(tipo, detalle) {
      return alertarSesion(leer(), tipo, detalle);
    },

    /** Sesion actualizada desde el panel o subida manual correcta. */
    sesionRestablecida(origen = "panel") {
      sesionOk(leer(), origen);
      return leer().sesionDropi;
    },

    /** Plan de envio (transportadoras y tope) para la subida manual. */
    planEnvio(resumen, opciones) {
      return planEnvio(leer(), resumen, opciones);
    },

    /** ¿La direccion es una oficina de Inter? (subida manual; respeta el ajuste) */
    async oficinaInterDeDireccion({ direccion, ciudad, departamento }) {
      if (leer().detectarOficinaInter === false) return null;
      return detectarOficinaInter({ buscar: buscarOficinasInter, direccion, ciudad, departamento, log });
    },

    /** Calificacion de la direccion con el minimo configurado (subida manual). */
    evaluarDireccion(datos) {
      return evaluarDireccion({
        validador: validadorDireccion,
        minimo: leer().minCalificacionDireccion ?? MIN_CALIFICACION_DEFECTO,
        ...datos,
      });
    },

    /** ¿Los pedidos de oficina de Inter se suben solos (si hay una sola oficina)? */
    oficinaInterActiva() {
      return leer().oficinaInter === true;
    },

    /** Nombre de la tienda de Dropi para una tienda de LucidSales ("" si no hay). */
    tiendasARevisar() {
      return tiendasARevisar(leer());
    },

    /**
     * Pedidos subidos a Dropi por mes (hora de Colombia), de lo que queda en
     * el registro: { "2026-10": 42, ... } (para la suscripcion futura).
     */
    consumo() {
      const c = leer();
      const meses = {};
      for (const r of Object.values(c.procesados ?? {})) {
        if (!["subido", "subido-pendiente-confirmacion"].includes(r?.accion) || !r?.ts) continue;
        const d = new Date(Date.parse(r.ts) - 5 * 3600_000); // Colombia (UTC-5, sin horario de verano)
        if (Number.isNaN(d.getTime())) continue;
        const mes = d.toISOString().slice(0, 7);
        meses[mes] = (meses[mes] ?? 0) + 1;
      }
      return meses;
    },
    tiendaDropiPara(idEmpresa) {
      return tiendaDropiDe(leer(), idEmpresa);
    },

    estadoPedido(id) {
      const clave = String(id ?? "");
      return resultadosTerminales.get(clave) ?? leer().procesados?.[clave] ?? null;
    },

    registrarResultado(id, accion, detalle, extra = {}) {
      const c = leer();
      marcar(c, id, accion, detalle, extra);
      const resultado = c.procesados?.[String(id)] ?? null;
      if (resultado && ["subido", "subido-pendiente-confirmacion", "resultado-incierto"].includes(accion)) {
        resultadosTerminales.set(String(id), resultado);
      }
      return resultado;
    },

    /**
     * Una persona revisó un "posible duplicado" y es una compra nueva: se
     * vuelve a mirar en la proxima vuelta sin la revision de repetidos.
     */
    aprobarDuplicado(id) {
      const c = leer();
      const k = String(id);
      if (c.procesados?.[k]?.accion !== "posible-duplicado") {
        throw new ErrorApi(409, "Este pedido no está marcado como posible duplicado");
      }
      c.duplicadosAprobados = { ...(c.duplicadosAprobados ?? {}), [k]: new Date().toISOString() };
      // se guardan los ultimos 500
      const claves = Object.keys(c.duplicadosAprobados);
      if (claves.length > 500) for (const x of claves.slice(0, claves.length - 500)) delete c.duplicadosAprobados[x];
      delete c.procesados[k];
      if (!guardar(c)) throw new ErrorApi(500, "No se pudo guardar la aprobación");
      return { ok: true };
    },

    /**
     * Una persona marcó (o cambió) la entrega programada de un pedido: si
     * estaba frenado o en revisión, pasa a esperar su fecha. Si le quitó la
     * marca, se vuelve a mirar en la próxima vuelta.
     */
    programacionCambiada(id) {
      const c = leer();
      const clave = String(id ?? "").trim();
      const accion = c.procesados?.[clave]?.accion;
      if (!accion || ["subido", "subido-pendiente-confirmacion", "resultado-incierto", "resuelto-a-mano"].includes(accion)) return false;
      delete c.procesados[clave];
      guardar(c);
      return true;
    },

    /** Configuracion de entregas programadas (para el panel). */
    programacion() {
      return confProg(leer());
    },

    /** Una persona dice que ya subio el pedido a mano: sale de revision y no se reintenta. */
    resueltoAMano(id, quien = "") {
      const c = leer();
      const clave = String(id ?? "").trim();
      const accion = c.procesados?.[clave]?.accion;
      if (!clave || !accion) throw new ErrorApi(404, "Ese pedido no tiene intentos de subida");
      if (accion === "subido") throw new ErrorApi(409, "Ese pedido ya lo subió Zunto");
      marcar(c, clave, "resuelto-a-mano", `marcado como subido a mano${quien ? ` por ${quien}` : ""} (antes: ${c.procesados[clave].detalle ?? accion})`);
      resultadosTerminales.delete(clave);
      return { ok: true, id: clave };
    },

    /** Vuelve a habilitar TODOS los pedidos en revisión (p. ej. tras arreglar la configuración). */
    rearmarRevision() {
      const c = leer();
      const ids = Object.keys(c.procesados ?? {}).filter((k) => REARMABLES.has(c.procesados[k]?.accion));
      for (const k of ids) delete c.procesados[k];
      if (ids.length && !guardar(c)) throw new ErrorApi(500, "No se pudo guardar el reintento");
      return { ok: true, rearmados: ids.length };
    },

    /** Libera un resultado incierto solo tras conciliación humana explícita. */
    rearmar(id, confirmarNoCreado = false) {
      const c = leer();
      const clave = String(id ?? "").trim();
      if (!clave) throw new ErrorApi(400, "Falta el id del pedido");
      const accion = c.procesados?.[clave]?.accion;
      // en revision: se vuelve a intentar desde cero (otros N intentos)
      if (REARMABLES.has(accion)) {
        delete c.procesados[clave];
        if (!guardar(c)) throw new ErrorApi(500, "No se pudo guardar el reintento");
        return { ok: true, id: clave };
      }
      if (confirmarNoCreado !== true) {
        throw new ErrorApi(400, "Confirma que verificaste en Dropi que la orden no existe");
      }
      if (accion !== "resultado-incierto") {
        throw new ErrorApi(409, "El pedido no está en revisión ni tiene un resultado incierto pendiente");
      }
      delete c.procesados[clave];
      if (!guardar(c)) throw new ErrorApi(500, "No se pudo guardar el reintento");
      resultadosTerminales.delete(clave);
      return { ok: true, id: clave };
    },
  };
}
