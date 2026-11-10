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
import { varianteDeProducto } from "./variantes.js";
import { cambiarEstado, construirBody } from "./estado.js";
import { direccionConReferencias, recogeEnOficina, validarDireccion } from "./direccionColombia.js";
import { oficinaQueCoincide } from "./oficinasInter.js";
import { DIRECCION_OFICINA_INTER } from "./dropiNavegador.js";
import { actividad } from "./vigia.js";

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
const RESOLUBLES = new Set(["esperando-direccion", "requiere-revision", "direccion-invalida", "envio-caro", "sin-transportadora", "posible-duplicado", "entrega-programada"]);
/**
 * Lo que tarda un envio normal (dias). Una fecha pedida dentro de ese margen
 * no es entrega futura; una mas lejana se programa y se sube cuando faltan
 * esos dias.
 */
const DIAS_ENTREGA = 5;
/**
 * Con varios productos LucidSales no manda el nombre de cada linea (solo el
 * product_id): se completa con el nombre del producto para compararlo con el chat.
 */
export async function completarNombres(cliente, resumen) {
  const prods = resumen?.productos ?? [];
  if (prods.length < 2) return;
  const cache = new Map();
  for (const x of prods) {
    if (x.nombre || !x.id) continue;
    try {
      if (!cache.has(x.id)) cache.set(x.id, await cliente.obtenerProducto(x.id));
      const p = cache.get(x.id);
      x.nombre = String(p?.Nombre ?? p?.nombre ?? "").trim();
    } catch {
      /* sin nombre: el agente no lo podra emparejar y frena */
    }
  }
}

/**
 * Productos del pedido con la variacion de Dropi de cada variante
 * (varianteDropi). -> { ok, productos } | { ok: false, detalle }
 */
export async function variantesParaDropi(cliente, resumen) {
  const productos = [];
  for (const x of resumen?.productos ?? []) {
    if (!x.variante) {
      productos.push(x);
      continue;
    }
    let prod;
    try {
      prod = await cliente.obtenerProducto(x.id);
    } catch (e) {
      return { ok: false, detalle: `no se pudo leer el producto ${x.id} en LucidSales (${e?.message ?? e})` };
    }
    const v = varianteDeProducto(prod, x.variante.id);
    if (!v) return { ok: false, detalle: `la variante ${x.variante.id} ya no existe en el producto` };
    if (!v.idVarianteDropi) return { ok: false, detalle: `la variante «${v.nombre}» no está vinculada a una variación de Dropi` };
    // el nombre de esa variacion en Dropi ("BLANCO"): con el se elige en el formulario
    let nombreDropi = "";
    if (prod?.idProductoDropi && cliente.variantesDropi) {
      try {
        const vs = await cliente.variantesDropi(prod.idProductoDropi);
        nombreDropi = vs.find((y) => y.id === String(v.idVarianteDropi))?.name ?? "";
        if (vs.length && !nombreDropi) {
          return { ok: false, detalle: `la variante «${v.nombre}» apunta a la variación ${v.idVarianteDropi}, que ya no está en el producto de Dropi` };
        }
      } catch {
        /* sin la lista, el formulario la busca con lo que diga la API de Dropi */
      }
    }
    productos.push({
      ...x,
      variante: { ...x.variante, nombre: v.nombre },
      varianteDropi: v.idVarianteDropi,
      ...(nombreDropi ? { varianteDropiNombre: nombreDropi } : {}),
    });
  }
  return { ok: true, productos };
}

/** Pedidos mas recientes que mira cada vuelta, por tienda (en paginas de 100). */
const MAX_PEDIDOS_VUELTA = 700;
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
  // numero pegado que ni el mapa pudo separar: no se sube con el numero mal
  if (r.formato && r.formato.ok === false) {
    return {
      ok: false,
      calificacion: nota.puntos,
      direccion,
      validacion,
      check: { campo: "direccionMapa", ok: false, detalle: `calificación ${nota.puntos}/100: ${r.resumen ?? r.formato?.detalle ?? "la dirección no tiene un formato válido"}` },
    };
  }
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
  const separada = ok && r.formato?.ok && r.formato.normalizada && !validarDireccion(direccion).ok ? r.formato.normalizada : null;
  const final = separada ?? (ok && r.sugerida && r.mapa?.veredicto === "exacta" ? r.sugerida : direccion);
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
  // ganancia minima (del producto o la general): permite pasar el tope si la
  // ganancia que muestra Dropi con ese envio no baja de este valor
  const gananciaMin = topePesos(regla?.gananciaMin) ?? topePesos(c?.envio?.gananciaMin);
  return {
    transportadoras,
    maxEnvio: tope?.valor ?? null,
    gananciaMin: tope ? gananciaMin : null,
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
      ...(e.envioAcordado != null ? { envioAcordado: e.envioAcordado } : {}),
      ...(e.totalAcordado != null ? { totalAcordado: e.totalAcordado } : {}),
      direccion: corto(e.direccion, 160),
      clienteConfirmo: e.clienteConfirmo ?? null,
      entregaFutura: e.entregaFutura ?? null,
      fechaEntregaSolicitada: corto(e.fechaEntregaSolicitada, 60),
      fechaEntregaISO: e.fechaEntregaISO || null,
      ...(Array.isArray(e.productos) && e.productos.length > 1 ? { productos: e.productos.slice(0, 10) } : {}),
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
/**
 * Resultados finales en los que el bot no subio el pedido y se le puede
 * asignar a una persona para que lo resuelva (en el orden del panel).
 */
export const MOTIVOS_ASIGNABLES = [
  "direccion-invalida",
  "requiere-revision",
  "requiere-humano",
  "envio-caro",
  "sin-transportadora",
  "posible-duplicado",
  "resultado-incierto",
];

/** Configuracion de "asignar los que no se suben" (con valores por defecto). */
export function asignarFallidosDe(c) {
  const a = c?.asignarFallidos ?? {};
  const motivos = Array.isArray(a.motivos)
    ? a.motivos.filter((m) => MOTIVOS_ASIGNABLES.includes(m))
    : [...MOTIVOS_ASIGNABLES];
  return { activo: a.activo === true, motivos, soloEnTurno: a.soloEnTurno === true };
}

/** Mensaje por defecto para pedirle al cliente que corrija la direccion. */
export const MENSAJE_CORREGIR_DIRECCION =
  "Hola {nombre} 👋 La dirección que nos diste («{direccion}») no es válida para la transportadora.\n\n" +
  "¿Nos puedes dar otra dirección completa? Por ejemplo: *Calle 10 # 5-20, Barrio Centro* (tipo de vía, número # número-número y barrio).\n\n" +
  "O, si prefieres, te lo enviamos a una *oficina de Interrapidísimo* cerca de ti y lo recoges allá 📦";

/** Configuracion de "pedir que corrija la direccion" (con valores por defecto). */
export function corregirDireccionDe(c) {
  const a = c?.corregirDireccion ?? {};
  const n = (v, d, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d));
  return {
    activo: a.activo === true,
    mensaje: String(a.mensaje ?? "").trim() || MENSAJE_CORREGIR_DIRECCION,
    // cuanto esperar antes de volver a leer el chat
    esperarMin: Math.round(n(a.esperarMin, 30, 5, 720)),
    // si no corrige en este plazo, queda como direccion invalida
    maxHoras: Math.round(n(a.maxHoras, 24, 1, 168)),
    // flujo de Lucid Bot que se ejecuta despues del mensaje (p. ej. apagar
    // el bot de ventas para que no le conteste al cliente)
    flujoDespues: String(a.flujoDespues ?? "").trim().replace(/[^\w-]/g, "").slice(0, 60),
  };
}

/** El mensaje con los datos del pedido ({nombre}, {direccion}, {ciudad}, {producto}). */
export function mensajeCorregirDireccion(plantilla, { nombre = "", direccion = "", ciudad = "", producto = "" } = {}) {
  const primer = String(nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return String(plantilla ?? MENSAJE_CORREGIR_DIRECCION)
    .replace(/\{nombre\}/g, primer)
    .replace(/\{direccion\}/g, String(direccion ?? "").trim() || "(sin dirección)")
    .replace(/\{ciudad\}/g, String(ciudad ?? "").trim())
    .replace(/\{producto\}/g, String(producto ?? "").trim())
    .replace(/Hola\s+👋/, "Hola 👋");
}

/**
 * La direccion que el cliente dio en el chat despues de pedirsela: vale si es
 * distinta de la del pedido y es valida (o es una oficina de transportadora).
 * Devuelve la direccion lista (normalizada) o null.
 */
export function direccionCorregidaDelChat(delChat, delPedido, referencias = "") {
  const nueva = String(delChat ?? "").replace(/\s+/g, " ").trim();
  if (!nueva) return null;
  const igual = (a, b) => String(a ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === String(b ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (igual(nueva, delPedido)) return null;
  if (recogeEnOficina(nueva, "")) return nueva.slice(0, 200);
  const v = validarDireccion(nueva, null, { referencias });
  if (!v.ok) return null;
  if (igual(v.normalizada, delPedido)) return null;
  return v.normalizada;
}

/** Sesiones de subida que se guardan (las mas recientes). */
const MAX_SESIONES = 20;

const NOMBRE_MOTIVO = {
  "direccion-invalida": "Dirección inválida",
  "sin-conversacion": "Sin conversación con el cliente",
  "sin-tienda-dropi": "Tienda sin cuenta de Dropi",
  "estado-incompatible": "El estado del pedido no permite subirlo",
  "posible-duplicado": "Posible pedido duplicado",
  "entrega-programada": "Entrega programada para otro día",
  "envio-caro": "Envío demasiado caro",
  "sin-transportadora": "Sin transportadora disponible",
  "requiere-login": "Dropi pidió iniciar sesión",
  "requiere-captcha": "Dropi pidió captcha",
  "resultado-incierto": "Resultado incierto (verificar en Dropi)",
  "requiere-revision": "Revisión manual (intentos agotados)",
  "esperando-direccion": "Esperando que el cliente corrija la dirección",
};

/** Texto de un motivo sin datos de un pedido (numeros, nombres entre comillas). */
function motivoGeneral(t) {
  return String(t ?? "")
    .replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, "«…»")
    .replace(/\d[\d.,-]*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

/** Motivo legible de un resultado de la vuelta; null si se subio. */
export function motivoDeResultado(d) {
  const a = d?.accion;
  if (!a || a === "subido" || a === "preparado") return null;
  if (NOMBRE_MOTIVO[a]) return NOMBRE_MOTIVO[a];
  if (a === "frenar") {
    const campos = [...new Set((d.motivos ?? []).map(String).filter(Boolean))];
    return campos.length ? `Frenado por el agente: ${campos.join(", ")}` : "Frenado por el agente";
  }
  if (a === "requiere-humano") return d.detalle ? `Revisión manual: ${motivoGeneral(d.detalle)}` : "Revisión manual";
  if (a === "error") return d.detalle ? `Error: ${motivoGeneral(d.detalle)}` : "Error";
  return a;
}

/**
 * Suma los resultados de una vuelta a su sesion (las vueltas de una misma
 * ronda a hora fija son una sola sesion). Cada pedido cuenta una vez, con su
 * ultimo resultado. Devuelve la lista de sesiones actualizada.
 */
export function sumarSesion(sesiones, { clave, desde, hasta, dryRun, detalle, detenido, asignados = [] }) {
  const lista = Array.isArray(sesiones) ? sesiones.filter((x) => x && x.clave !== clave) : [];
  const previa = (Array.isArray(sesiones) ? sesiones : []).find((x) => x?.clave === clave);
  const pedidos = { ...(previa?.pedidos ?? {}) };
  for (const d of detalle ?? []) {
    if (!d?.id) continue;
    pedidos[d.id] = motivoDeResultado(d) ?? "";
  }
  const cuenta = new Map();
  let subidos = 0;
  for (const m of Object.values(pedidos)) {
    if (!m) subidos++;
    else cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  const motivos = [...cuenta].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n }));
  const asignadosA = { ...(previa?.asignadosA ?? {}) };
  for (const x of asignados ?? []) if (x?.nombre) asignadosA[x.nombre] = (asignadosA[x.nombre] ?? 0) + 1;
  const sesion = {
    clave,
    desde: previa?.desde ?? desde,
    hasta,
    vueltas: (previa?.vueltas ?? 0) + 1,
    dryRun: Boolean(dryRun),
    subidos,
    noSubidos: Object.keys(pedidos).length - subidos,
    motivos,
    pedidos,
    ...(Object.keys(asignadosA).length ? { asignadosA } : {}),
    ...(detenido ? { detenido } : {}),
  };
  return [sesion, ...lista].sort((a, b) => String(b.desde).localeCompare(String(a.desde))).slice(0, MAX_SESIONES);
}

/** Agrega a cada sesion { telefonos: { idPedido: telefono } } desde lo procesado. */
export function conTelefonos(sesiones, procesados) {
  if (!Array.isArray(sesiones)) return sesiones;
  return sesiones.map((s) => {
    const telefonos = {};
    for (const id of Object.keys(s?.pedidos ?? {})) {
      const t = String(procesados?.[id]?.cliente?.telefono ?? "").trim();
      if (t) telefonos[id] = t;
    }
    return { ...s, telefonos };
  });
}

/** Pausa entre vueltas seguidas de una ronda a hora fija. */
const ESPERA_ENTRE_VUELTAS_MS = 90 * 1000;
const ZONA_COLOMBIA_MIN = -5 * 60; // Colombia no tiene horario de verano

/**
 * Cuando corre la subida: "intervalo" (cada cadaSegundos, como siempre) u
 * "horas" (a horas fijas de Colombia, p. ej. ["23:00"]: sube todos los del dia).
 */
export function horarioDe(c) {
  const h = c?.horario ?? {};
  const horas = [
    ...new Set(
      (Array.isArray(h.horas) ? h.horas : [])
        .map((x) => String(x ?? "").trim().match(/^(\d{1,2}):(\d{2})$/))
        .filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60)
        .map((m) => `${m[1].padStart(2, "0")}:${m[2]}`),
    ),
  ]
    .sort()
    .slice(0, 6);
  return {
    modo: h.modo === "horas" ? "horas" : "intervalo",
    horas: horas.length ? horas : h.modo === "horas" ? [] : ["23:00"],
    vueltas: Math.max(1, Math.min(Number(h.vueltas) || 4, 10)),
  };
}

/** Proximo momento (ms) en que toca alguna de las horas (hora de Colombia). */
export function proximaHora(horas, ahora = Date.now()) {
  let mejor = null;
  const local = new Date(ahora + ZONA_COLOMBIA_MIN * 60000); // reloj de Colombia leido en UTC
  for (const hhmm of horas ?? []) {
    const [hh, mm] = hhmm.split(":").map(Number);
    let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - ZONA_COLOMBIA_MIN * 60000;
    if (t <= ahora + 1000) t += 24 * 3600 * 1000;
    if (mejor === null || t < mejor) mejor = t;
  }
  return mejor;
}

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
  // etiquetas de pedidos (crearEtiquetas): la del motivo cuando no se sube
  etiquetas = null,
}) {
  let numeroVuelta = 0;
  let timer = null;
  /** modo "horas": el setTimeout de la proxima ronda */
  let timerHora = null;
  let corriendo = false;
  /** Parada pedida desde el panel: la vuelta termina el pedido actual y no sigue. */
  let parar = false;
  /** Hay una ronda a hora fija en marcha (tambien en la pausa entre vueltas). */
  let enRonda = false;
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
    envio: { maxPesos: null, maxPorcentaje: null, gananciaMin: null },
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
    // pedidos con mas de estos dias no se suben solos (0 = sin limite)
    maxDiasPedido: 5,
    // direccion invalida: pedirle al cliente que la corrija por WhatsApp y
    // volver a leer el chat despues (apagado por defecto)
    corregirDireccion: { activo: false },
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
    // etiqueta del motivo en el pedido (o ninguna si ya salio)
    try {
      etiquetas?.porMotivo?.(c.procesados[String(id)]?.tienda, id, accionFinal);
    } catch (e) {
      log.warn?.("[subida] no se pudo etiquetar el pedido:", e?.message ?? e);
    }
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
  /**
   * Los pedidos que el bot no pudo subir en esta vuelta se le asignan a una
   * persona (mismo reparto equitativo y mismos participantes del reparto
   * automatico). Los que ya tienen dueno no se tocan. Nunca rompe la vuelta.
   */
  async function asignarNoSubidos(c, detalle) {
    const conf = asignarFallidosDe(c);
    if (!conf.activo || c.dryRun || !asignacion?.repartir || !conf.motivos.length) return [];
    const ultimo = new Map();
    for (const d of detalle) if (d?.id) ultimo.set(String(d.id), d.accion);
    const porTienda = new Map();
    for (const [id, accion] of ultimo) {
      if (!conf.motivos.includes(accion)) continue;
      const tienda = c.procesados?.[id]?.tienda ?? null;
      const k = tienda === null ? "" : String(tienda);
      if (!porTienda.has(k)) porTienda.set(k, []);
      porTienda.get(k).push(id);
    }
    if (!porTienda.size) return [];
    const hechos = [];
    try {
      const usuarios = (await cliente.listarUsuarios({ page: 1, itemsPerPage: 100 })).usuarios ?? [];
      const activos = usuarios.filter((u) => u?.Usuario && u.activo !== false && u.activo !== 0 && u.activo !== "0");
      const participantes = asignacion.getConfig?.()?.usuarios;
      const dentro = (Array.isArray(participantes)
        ? activos.filter((u) => participantes.includes(String(u.Usuario).trim().toLowerCase()))
        : activos
      ).map((u) => ({ usuario: String(u.Usuario).toLowerCase(), nombre: u.Nombre || u.Usuario }));
      if (!dentro.length) throw new Error("no hay usuarios activos que participen del reparto");
      for (const [tienda, pedidos] of porTienda) {
        const args = { usuarios: dentro, pedidos, reasignar: false, idEmpresa: tienda === "" ? null : Number(tienda) };
        let r;
        try {
          r = asignacion.repartir({ ...args, modo: conf.soloEnTurno ? "horario" : "todos" });
        } catch (e) {
          // nadie en turno (p. ej. la ronda de la noche): se reparte entre todos
          if (!conf.soloEnTurno) throw e;
          r = asignacion.repartir({ ...args, modo: "todos" });
        }
        for (const x of r.reparto) {
          hechos.push(x);
          const e = c.procesados?.[x.pedido];
          if (e) e.asignado = { usuario: x.usuario, nombre: x.nombre, ts: new Date().toISOString() };
        }
      }
      if (hechos.length) {
        guardar(c);
        const por = {};
        for (const x of hechos) por[x.nombre] = (por[x.nombre] ?? 0) + 1;
        log.log(
          `[subida] ${hechos.length} pedido(s) sin subir asignados: ${Object.entries(por).map(([n, k]) => `${n} ${k}`).join(", ")}`,
        );
      }
    } catch (e) {
      log.warn?.("[subida] no se pudieron asignar los pedidos sin subir:", e?.message ?? e);
    }
    return hechos;
  }

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
        // los mas recientes de la tienda, en paginas de 100 (hasta 700)
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
          actividad(`subida: pedido ${id}`);
          if (parar) {
            detenido = "detenida a mano desde el panel";
            break vueltaTiendas;
          }
          // datos del cliente para la tabla del panel (telefono -> chat)
          const contacto = {
            telefono: String(p?.Movil ?? "").trim(),
            nombre: [p?.Nombre, p?.Apellido].filter(Boolean).join(" ").trim(),
          };
          let analisisActual = null;
          let dropiActual = null; // { id, ganancia, envio } cuando Dropi la muestra
          // lo que se va sabiendo de este intento (para el historial)
          const intento = { origen: "automatica", dryRun: c.dryRun === true };
          const marcarP = (accion, det, extra = {}) => {
            const e = marcar(c, id, accion, det, {
              ...extra,
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
          // se le pidio al cliente corregir la direccion: se vuelve a leer el
          // chat cuando pase el tiempo de espera
          let esperandoDir = null;
          if (anterior?.accion === "esperando-direccion") {
            const confCD = corregirDireccionDe(c);
            const desde = Date.parse(anterior.pidio ?? anterior.ts ?? "");
            if (Number.isFinite(desde) && Date.now() - desde < confCD.esperarMin * 60_000) continue;
            esperandoDir = anterior;
          }
          // pedido viejo: no se sube solo (salvo una entrega programada, que
          // es vieja a proposito). Si se sube el limite, se vuelve a mirar.
          const maxDias = Number(c.maxDiasPedido ?? DEFECTO.maxDiasPedido) || 0;
          const creado = Date.parse(p?.Fecha ?? p?.CreatedAt ?? "");
          if (maxDias > 0 && !entregaProgramada && Number.isFinite(creado)) {
            const dias = Math.floor((Date.now() - creado) / 86400_000);
            if (dias > maxDias) {
              if (anterior?.accion !== "pedido-antiguo") {
                marcarP("pedido-antiguo", `el pedido tiene ${dias} días (el límite es ${maxDias}): no se sube solo; si hay que enviarlo, súbelo desde el pedido`);
              }
              continue;
            }
          }
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
          let oficina = recogeEnOficina(resumen?.direccion, resumen?.referencias);
          // Inter con la opcion encendida sigue el flujo normal (y solo se
          // sube si Dropi ofrece UNA oficina); Coordinadora siempre a mano
          let oficinaAuto = oficina === "Inter Rapidísimo" && c.oficinaInter === true;
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
          // producto con variantes: se busca la variacion de Dropi que le
          // corresponde (la vincula el producto de LucidSales); sin ella, a mano
          const conVariante = textoVariantes(resumen);
          if (conVariante) {
            const rv = await variantesParaDropi(cliente, resumen);
            if (!rv.ok) {
              marcarP("requiere-humano", `producto con variantes (${conVariante}): ${rv.detalle}; lo sube una persona eligiendo la variante en Dropi`);
              detalle.push({ id, accion: "requiere-humano", detalle: "producto con variantes" });
              continue;
            }
            resumen.productos = rv.productos;
          }

          const conv = conversacion.porPedido(id);
          let mensajes = conv?.mensajes ?? [];
          const chatUrl = conv?.meta?.chatUrl ?? conv?.meta?.chat_url ?? conv?.meta?.inboxUrl ?? "";
          if (lucidBotContactos?.obtenerConversacion) {
            const chat = await lucidBotContactos.obtenerConversacion({ pedido: pedidoCompleto, chatUrl, origen: "subida" });
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

          // direccion invalida: pedirle al cliente que la corrija (si esta
          // activado) y esperar su respuesta. true = ya se manejo el pedido.
          const pedirCorreccion = async (motivo) => {
            const conf = corregirDireccionDe(c);
            if (!conf.activo || c.dryRun || !lucidBotContactos?.enviarTexto) return false;
            if (esperandoDir) {
              const desde = Date.parse(esperandoDir.pidio ?? "");
              if (Number.isFinite(desde) && Date.now() - desde < conf.maxHoras * 3600_000) {
                marcarP("esperando-direccion", `esperando que el cliente corrija la dirección (se le pidió por WhatsApp); ${motivo}`, {
                  pidio: esperandoDir.pidio,
                  direccionAnterior: esperandoDir.direccionAnterior ?? resumen?.direccion ?? "",
                });
                detalle.push({ id, accion: "esperando-direccion" });
                return true;
              }
              return false; // vencio: queda como direccion invalida
            }
            const texto = mensajeCorregirDireccion(conf.mensaje, {
              nombre: resumen?.cliente,
              direccion: resumen?.direccion,
              ciudad: resumen?.ciudad,
              producto: resumen?.productos?.[0]?.nombre,
            });
            const env = await lucidBotContactos
              .enviarTexto({ pedido: pedidoCompleto, chatUrl, texto, flujoDespues: conf.flujoDespues })
              .catch((e) => ({ ok: false, detalle: e?.message ?? String(e) }));
            if (!env.ok) {
              log.warn?.(`[subida] no se pudo pedir la corrección de la dirección del pedido ${id}: ${env.detalle}`);
              return false;
            }
            if (env.flujo && !env.flujo.ok) log.warn?.(`[subida] pedido ${id}: se envió el mensaje pero ${env.flujo.detalle}`);
            const notaFlujo = !env.flujo ? "" : env.flujo.ok ? " (y se ejecutó el flujo de Lucid Bot)" : ` (el flujo de Lucid Bot falló: ${env.flujo.detalle})`;
            marcarP("esperando-direccion", `se le pidió al cliente corregir la dirección por WhatsApp${notaFlujo}; ${motivo}`, {
              pidio: new Date().toISOString(),
              direccionAnterior: resumen?.direccion ?? "",
            });
            log.log(`[subida] pedido ${id}: se le pidió al cliente corregir la dirección`);
            detalle.push({ id, accion: "esperando-direccion" });
            return true;
          };
          const vencioCorreccion = () =>
            esperandoDir ? ` (se le pidió corregirla por WhatsApp y no respondió con una dirección válida en ${corregirDireccionDe(c).maxHoras} h)` : "";

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
          await completarNombres(cliente, resumen);
          let r2 = await ejecutarAgente({ resumen, mensajes, extraer, oficina: oficinaAuto ? oficina : null, otrosPedidos, entregaProgramada, diasEntrega: confProg(c).diasAntes });
          analisisActual = resumirAnalisis(r2);
          // se le habia pedido corregir la direccion: ¿respondio con una valida
          // (o pidio oficina)? Se corrige el pedido en LucidSales y sigue.
          let notaCorreccion = "";
          if (esperandoDir && !r2.falloIA) {
            const nueva = direccionCorregidaDelChat(r2?.extraido?.direccion, resumen?.direccion, resumen?.referencias);
            if (nueva) {
              try {
                await cliente.actualizarPedido(construirBody({ ...pedidoCompleto, Direccion: nueva }), idEmpresa);
              } catch (e) {
                marcarP("error", `el cliente corrigió la dirección («${nueva}») pero LucidSales no la guardó: ${e?.message ?? e}`);
                detalle.push({ id, accion: "error" });
                continue;
              }
              notaCorreccion = `el cliente corrigió la dirección en el chat: «${resumen?.direccion ?? ""}» → «${nueva}»`;
              log.log(`[subida] pedido ${id}: ${notaCorreccion}`);
              pedidoCompleto = { ...pedidoCompleto, Direccion: nueva };
              resumen.direccion = nueva;
              oficina = recogeEnOficina(nueva, resumen?.referencias);
              oficinaAuto = oficina === "Inter Rapidísimo" && c.oficinaInter === true;
              if (oficina && !oficinaAuto) {
                marcarP("requiere-humano", `${notaCorreccion}; recoge en oficina de ${oficina}: lo sube una persona eligiendo la oficina en Dropi`);
                detalle.push({ id, accion: "requiere-humano", detalle: `oficina de ${oficina}` });
                continue;
              }
              r2 = await ejecutarAgente({ resumen, mensajes, extraer, oficina: oficinaAuto ? oficina : null, otrosPedidos, entregaProgramada, diasEntrega: confProg(c).diasAntes });
              analisisActual = resumirAnalisis(r2);
            }
          }
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
            const det0 = r2.problemas.map((x) => `${x.campo}: ${x.detalle}`).join("; ");
            if (await pedirCorreccion(det0)) continue;
            const det = det0 + vencioCorreccion();
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
                if (await pedirCorreccion(ev.check.detalle)) continue;
                marcarP("direccion-invalida", ev.check.detalle + vencioCorreccion());
                invalidas.push({ id, detalle: ev.check.detalle, contacto: { ...contacto } });
                frenados++;
                detalle.push({ id, accion: "direccion-invalida", calificacion: ev.calificacion });
                continue;
              }
              direccionEnvio = ev.direccion;
            }
            // numero pegado: si el mapa no lo separo (o no se miro), no se sube
            if (r2.direccionEnvio?.numeroPegado && !validarDireccion(direccionEnvio).ok) {
              const det = `el número de la dirección viene pegado («${direccionEnvio}») y el mapa no confirmó cómo se separa: corrígela en el pedido (p. ej. «# 30-21»)`;
              if (await pedirCorreccion(det)) continue;
              marcarP("direccion-invalida", det + vencioCorreccion());
              invalidas.push({ id, detalle: det, contacto: { ...contacto } });
              frenados++;
              detalle.push({ id, accion: "direccion-invalida" });
              continue;
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
          //   (con varios productos, el de cada uno)
          let productoUrl = null;
          let motivoProducto = "producto sin link de Dropi en el sheet";
          const urls = [];
          for (const [i, linea] of (resumen?.productos ?? []).entries()) {
            let u = null;
            if (resolverProductoDropi && linea?.id) {
              try {
                u = await resolverProductoDropi(linea.id);
              } catch (e) {
                motivoProducto = `sin link de Dropi${(resumen?.productos ?? []).length > 1 ? ` (producto ${i + 1}: ${linea.nombre || linea.id})` : ""}: ${e?.message ?? e}`;
                log.warn?.("[subida] no se pudo resolver el producto en Dropi:", e?.message ?? e);
              }
            }
            if (!u) {
              urls.length = 0;
              break;
            }
            urls.push(u);
          }
          productoUrl = urls[0] ?? null;
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
            gananciaMin: plan.gananciaMin ?? null,
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
              gananciaMin: plan.gananciaMin,
              oficinaInter: plan.oficinaInter,
              // la oficina a elegir: la detectada, o la direccion que escribio
              // junto a "oficina inter" (sin direccion: regla de una sola)
              oficinaObjetivo: oficinaDetectada ? oficinaDetectada.direccion || oficinaDetectada.nombre : oficinaAuto ? resumen?.direccion : null,
              tienda: tiendaDropi,
              seguro: true,
              tipoPago: resumen?.tipoPago,
              // con varios productos: una orden por producto; las que ya
              // quedaron en un intento anterior no se vuelven a crear
              ...(!c.dryRun && c.lineasSubidas?.[id] ? { yaSubidas: c.lineasSubidas[id] } : {}),
              productos: (resumen?.productos ?? []).map((x, i) => ({
                id: x.id,
                cantidad: x.cantidad,
                precio: x.precio,
                productoUrl: urls[i] ?? productoUrl,
                // variacion de Dropi a elegir en el formulario (productos con variantes)
                ...(x.varianteDropi ? { varianteDropi: x.varianteDropi, varianteDropiNombre: x.varianteDropiNombre ?? "" } : {}),
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

          // varios productos: se anotan las ordenes que si quedaron creadas
          if (!c.dryRun && Array.isArray(rNav?.ordenes)) {
            const nuevas = rNav.ordenes.filter((o) => o.creado && !o.previa);
            if (nuevas.length) {
              c.lineasSubidas = c.lineasSubidas ?? {};
              c.lineasSubidas[id] = { ...(c.lineasSubidas[id] ?? {}) };
              for (const o of nuevas) c.lineasSubidas[id][String(o.indice)] = o.idDropi ?? "sin-id";
              guardar(c);
            }
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
          if (rNav?.envioCaro || rNav?.sinTransportadora || rNav?.oficinaHumano || rNav?.corregimientoHumano || rNav?.varianteHumano) {
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
              ? `; ${rNav.envio.transportadora} $${Math.round(rNav.envio.precio ?? 0).toLocaleString("es-CO")}${rNav.envio.oficina ? ` (oficina ${rNav.envio.oficina})` : ""}` +
                (rNav.envio.sobreTope
                  ? ` (supera el tope de $${Math.round(rNav.envio.tope ?? 0).toLocaleString("es-CO")}, pero la ganancia $${Math.round(rNav.envio.ganancia ?? 0).toLocaleString("es-CO")} cumple el mínimo de $${Math.round(rNav.envio.gananciaMin ?? 0).toLocaleString("es-CO")})`
                  : "")
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
          if (!c.dryRun && c.lineasSubidas?.[id]) {
            delete c.lineasSubidas[id];
            guardar(c);
          }
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
      // los que no se pudieron subir: a una persona (si esta activado)
      const asignados = await asignarNoSubidos(c, detalle);

      // resumen de la sesion para el panel (solo si paso algo)
      if (detalle.length) {
        try {
          const sesionClave = opciones.ronda ?? claveVuelta;
          c.sesiones = sumarSesion(c.sesiones, {
            clave: sesionClave,
            desde: vueltaDesde,
            hasta: new Date().toISOString(),
            dryRun: c.dryRun,
            detalle,
            detenido,
            asignados,
          });
          guardar(c);
        } catch (e) {
          log.warn?.("[subida] no se pudo guardar el resumen de la sesión:", e?.message ?? e);
        }
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
      if (!enRonda) parar = false;
    }
  }

  /**
   * Ronda de la hora programada: una vuelta y, si hizo algo (hay mas de 700
   * pedidos o reintentos pendientes), otras seguidas hasta `vueltas`.
   */
  async function ronda() {
    const c = leer();
    const h = horarioDe(c);
    const clave = `ronda ${new Date().toISOString()}`;
    enRonda = true;
    parar = false;
    try {
      for (let i = 0; i < h.vueltas; i++) {
        const r = await tick({ ronda: clave }).catch((e) => ({ ok: false, error: e?.message }));
        const hizo = r?.ok && !r.saltado && !r.detenido && (r.detalle?.length ?? 0) > 0;
        if (!hizo || parar || i === h.vueltas - 1) break;
        await new Promise((ok) => {
          const t = setTimeout(ok, ESPERA_ENTRE_VUELTAS_MS);
          t.unref?.();
        });
        if (parar) break;
      }
    } finally {
      enRonda = false;
      parar = false;
    }
  }

  function programarHora() {
    const c = leer();
    const h = horarioDe(c);
    const prox = proximaHora(h.horas);
    if (!prox) return;
    proximaMs = prox;
    timerHora = setTimeout(() => {
      timerHora = null;
      ronda()
        .catch(() => {})
        .finally(() => {
          if (timer) programarHora();
        });
    }, Math.max(1000, prox - Date.now()));
    timerHora.unref?.();
  }

  return {
    /** Arranca el intervalo (o la hora fija). Si esta apagado el tick no hace nada. */
    arrancar() {
      if (timer) return;
      const c = leer();
      const h = horarioDe(c);
      if (h.modo === "horas") {
        // marcador para saber que esta arrancado; las rondas van por programarHora
        timer = { horas: true, unref() {} };
        programarHora();
        log.log(`[subida] automatica ${c.automatico ? "ACTIVA" : "apagada"} (a las ${h.horas.join(", ")} hora Colombia, dryRun=${c.dryRun})`);
        return;
      }
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

    /**
     * Para la subida en curso: termina el pedido que esta subiendo (no se
     * corta a mitad del formulario de Dropi) y no sigue con los demas ni con
     * las otras vueltas de la ronda. El horario sigue: la proxima vez corre.
     */
    parar() {
      if (!corriendo && !enRonda) return { ok: false, msg: "No hay ninguna subida en curso" };
      parar = true;
      log.log("[subida] parada pedida desde el panel: termina el pedido actual y se detiene");
      return { ok: true, msg: "Se detiene al terminar el pedido actual" };
    },

    detener() {
      if (timer && !timer.horas) clearInterval(timer);
      if (timerHora) clearTimeout(timerHora);
      timer = null;
      timerHora = null;
      proximaMs = null;
    },

    tick,

    /** Ordenes de Dropi ya creadas de un pedido con varios productos: { indice: idDropi } */
    lineasSubidas(id) {
      return leer().lineasSubidas?.[String(id)] ?? null;
    },
    /** Anota (se suman) o borra (null) las ordenes ya creadas de un pedido. */
    guardarLineasSubidas(id, mapa) {
      const c = leer();
      const k = String(id);
      c.lineasSubidas = c.lineasSubidas ?? {};
      if (!mapa) {
        if (!c.lineasSubidas[k]) return;
        delete c.lineasSubidas[k];
      } else c.lineasSubidas[k] = { ...(c.lineasSubidas[k] ?? {}), ...mapa };
      guardar(c);
    },

    /** Configuracion actual (sin el registro de procesados). */
    config() {
      const c = leer();
      const { procesados, lineasSubidas, ...resto } = c;
      return {
        ...resto,
        procesados: Object.keys(procesados ?? {}).length,
        // cada pedido de las sesiones con el telefono del cliente (para el panel)
        sesiones: conTelefonos(resto.sesiones, procesados),
        horario: horarioDe(c),
        asignarFallidos: asignarFallidosDe(c),
        corregirDireccion: corregirDireccionDe(c),
        // para el temporizador del panel (no se guarda)
        reloj: {
          ahora: new Date().toISOString(),
          proxima: timer && c.automatico && proximaMs ? new Date(proximaMs).toISOString() : null,
          enCurso: corriendo,
          ronda: enRonda,
          parando: parar,
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
      if ("horario" in patch && patch.horario && typeof patch.horario === "object") {
        const h = horarioDe({ horario: { ...horarioDe(c), ...patch.horario } });
        if (h.modo === "horas" && !h.horas.length) throw new ErrorApi(400, "Pon al menos una hora (por ejemplo 23:00)");
        c.horario = h;
      }
      if ("transportadoras" in patch) {
        const lista = listaTransportadoras(patch.transportadoras);
        if (!lista.length) throw new ErrorApi(400, "Elige al menos una transportadora");
        c.transportadoras = lista;
        c.transportadoraId = lista[0];
      }
      if ("envio" in patch && patch.envio && typeof patch.envio === "object") {
        c.envio = {
          maxPesos: topePesos(patch.envio.maxPesos),
          maxPorcentaje: topePct(patch.envio.maxPorcentaje),
          gananciaMin: topePesos(patch.envio.gananciaMin),
        };
      }
      if ("corregirDireccion" in patch && patch.corregirDireccion && typeof patch.corregirDireccion === "object") {
        const x = { ...corregirDireccionDe(c), ...patch.corregirDireccion };
        const limpio = corregirDireccionDe({ corregirDireccion: x });
        // se guarda el mensaje solo si es distinto del de por defecto
        c.corregirDireccion = { ...limpio, mensaje: limpio.mensaje === MENSAJE_CORREGIR_DIRECCION ? "" : limpio.mensaje.slice(0, 1500) };
      }
      if ("asignarFallidos" in patch && patch.asignarFallidos && typeof patch.asignarFallidos === "object") {
        c.asignarFallidos = asignarFallidosDe({ asignarFallidos: { ...asignarFallidosDe(c), ...patch.asignarFallidos } });
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
            gananciaMin: topePesos(v.gananciaMin),
          };
          // una regla vacia no sirve: se descarta
          if (regla.transportadoras.length || regla.maxPesos || regla.maxPorcentaje || regla.gananciaMin) limpio[clave] = regla;
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
      if ("maxDiasPedido" in patch) c.maxDiasPedido = Math.max(0, Math.min(Math.floor(Number(patch.maxDiasPedido) || 0), 365));
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
      // en revision: se vuelve a intentar desde cero (otros N intentos).
      // Tambien el que espera que el cliente corrija la direccion (p. ej. la
      // regla ya la acepta): solo uno a uno, «Reintentar todos» no lo toca.
      if (REARMABLES.has(accion) || accion === "esperando-direccion") {
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
