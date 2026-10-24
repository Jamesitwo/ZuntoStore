// Nucleo del agente de Dropi: decide si un pedido se puede subir.
//
// Division de responsabilidades (acordada):
//   * El LLM SOLO extrae datos del chat ({producto, precioAcordado, cantidad,
//     direccion, clienteConfirmo}). Ver `extraerConversacion`.
//   * La COMPARACION es determinista, aca en codigo: numero contra numero,
//     texto contra texto. Si el modelo se equivoca extrayendo, el pedido se
//     frena; nunca sube uno con precio malo porque el modelo "penso" que iba bien.
//
// Todo lo de comparacion es puro y sin red: se puede probar sin LLM ni APIs.

import { claveCalle, recogeEnOficina, validarDireccion } from "./direccionColombia.js";

/** Separa los acentos y baja a minusculas: "Medellin" == "medellín". */
export function normalizarTexto(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * "84.900" -> 84900   |   "84.900,50" -> 84900.5   |   "$ 84,900.50" -> 84900.5
 *
 * En Colombia el punto es de miles y la coma de decimal. Si solo hay un
 * separador y le siguen 3 digitos, se trata como miles (84.900 = 84900).
 */
export function parsearPrecio(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!t || !/\d/.test(t)) return null;

  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  const sep = Math.max(coma, punto);
  if (sep === -1) return Number(t.replace(/-/g, "")) || 0;

  const decimales = t.length - sep - 1;
  const hayAmbos = coma > -1 && punto > -1;

  // solo un separador + 3 digitos detras => miles ("84.900")
  if (!hayAmbos && decimales === 3) {
    const n = Number(t.replace(/[.,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (!hayAmbos && decimales !== 3) {
    // separador decimal simple: "84.5" -> 84.5
    const limpio = t.replace(/[.,]/g, (c, i) => (i === sep ? "." : ""));
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }
  // hay punto y coma: el de mas a la derecha es el decimal
  const enteros = t.slice(0, sep).replace(/[.,]/g, "");
  const decimal = t.slice(sep + 1).replace(/[.,]/g, "");
  const n = Number(`${enteros}.${decimal}`);
  return Number.isFinite(n) ? n : null;
}

/** Palabras que no aportan al emparejamiento ("el", "de", "ese"...). */
const VACIAS = new Set([
  "el", "la", "los", "las", "de", "del", "que", "un", "una", "unos", "unas", "y", "o",
  "a", "en", "por", "para", "con", "ese", "esa", "eso", "este", "esta", "esto", "mi",
  "su", "tu", "me", "lo", "al", "se", "es", "como", "mas", "muy", "hay", "tiene",
  "quiero", "dame", "favor", "porfa",
]);

/** Tokens sin acentos ni simbolos y sin palabras vacias. */
function tokens(v) {
  return normalizarTexto(v)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !VACIAS.has(t));
}

/**
 * ¿El token del chat corresponde a alguno del producto?
 * Tolera sufijos y variaciones: "68" casa con "68v", "cra" con "carrera".
 */
function tokenCasa(t, conjunto) {
  for (const p of conjunto) {
    if (p === t) return true;
    if (p.startsWith(t) || t.startsWith(p)) return true;
    if (t.length >= 4 && p.includes(t)) return true;
  }
  return false;
}

/** Cuanto del chat aparece en el objetivo: 0..1. */
function cobertura(chat, objetivo) {
  const a = tokens(chat);
  if (!a.length) return { valor: 0, tokens: 0 };
  const conjunto = new Set(tokens(objetivo));
  if (!conjunto.size) return { valor: 0, tokens: a.length };
  const casa = a.filter((t) => tokenCasa(t, conjunto)).length;
  return { valor: casa / a.length, tokens: a.length };
}

/**
 * ¿El producto del chat se parece al del pedido?
 * Compara por solapamiento de palabras, no por igualdad exacta: la gente
 * escribe "el taladro ese" y el catalogo dice "Taladro Inalambrico 68V".
 */
export function coincideProducto(chat, catalogo) {
  // acepta ["Taladro"] o [{nombre:"Taladro", ...}] (como viene en resumen.productos)
  const nombres = (Array.isArray(catalogo) ? catalogo : [catalogo])
    .map((x) => (x && typeof x === "object" ? (x.nombre ?? x.name ?? x.producto ?? "") : x))
    .filter(Boolean);
  if (!tokens(chat).length) {
    return { ok: false, razon: "no se entendio el producto del chat", nombre: "" };
  }
  if (!nombres.length) {
    return { ok: false, razon: "el pedido no trae productos para comparar", nombre: "" };
  }

  let mejor = null;
  for (const nombre of nombres) {
    const c = cobertura(chat, nombre);
    if (c.valor >= 0.5) return { ok: true, razon: "", nombre: String(nombre) };
    if (!mejor || c.valor > mejor.valor) {
      mejor = {
        ok: false,
        razon: `sin coincidencia con "${nombre}"`,
        nombre: String(nombre),
        valor: c.valor,
      };
    }
  }
  return mejor;
}

/**
 * ¿El precio del chat calza con el pedido?
 * Se acepta que el cliente haya citado el total (con envio) o solo el producto.
 */
export function coincidePrecio(precioChat, resumen, tolerancia = 0.01) {
  const p = parsearPrecio(precioChat);
  if (p === null) return { ok: false, razon: "no se entendio el precio del chat", valor: null };

  const candidatos = [
    ["Total", parsearPrecio(resumen?.total)],
    ["SubTotal", parsearPrecio(resumen?.subtotal)],
  ];
  for (const [campo, v] of candidatos) {
    if (v === null || v === 0) continue;
    const dif = Math.abs(p - v) / v;
    if (dif <= tolerancia) return { ok: true, razon: `coincide con ${campo}`, valor: p };
  }
  const detalle = candidatos
    .filter(([, v]) => v !== null)
    .map(([c, v]) => `${c}=${v}`)
    .join(" / ");
  return { ok: false, razon: `el chat dice ${p} y el pedido ${detalle || "sin totales"}`, valor: p };
}

/** ¿La direccion del chat se parece a la del pedido? (contencion de palabras) */
export function coincideDireccion(chat, pedido) {
  if (!tokens(chat).length) {
    return { ok: false, razon: "no se entendio la direccion del chat" };
  }
  if (!tokens(pedido).length) {
    return { ok: false, razon: "el pedido no tiene direccion para comparar" };
  }
  // misma calle y numeros (aunque una traiga ciudad o barrio de mas): coincide
  const kChat = claveCalle(chat);
  if (kChat && kChat === claveCalle(pedido)) return { ok: true, razon: "" };
  const c = cobertura(chat, pedido);
  const numerosChat = tokens(chat).filter((t) => /^\d+[a-z]?$/.test(t));
  const numerosPedido = tokens(pedido).filter((t) => /^\d+[a-z]?$/.test(t));
  const numerosCoinciden =
    numerosChat.length > 0 &&
    numerosChat.length === numerosPedido.length &&
    numerosChat.every((n) => numerosPedido.includes(n));
  return c.valor >= 0.75 && numerosCoinciden
    ? { ok: true, razon: "" }
    : { ok: false, razon: `chat "${chat}" vs pedido "${pedido}" (coincidencia ${Math.round(c.valor * 100)}%)` };
}

/**
 * Valida el pedido contra lo extraido del chat.
 * Devuelve {ok, checks:[{campo, ok, detalle}]} con TODO evaluado (no corta en
 * el primer fallo) para que el usuario vea el cuadro completo de una mirada.
 */
export function validarPedido(resumen, extraido, { oficina = null } = {}) {
  const checks = [];
  // direccion de ENVIO (la del pedido): formato colombiano; la IA solo la
  // descompone, las reglas y la verificacion de numeros son del codigo.
  // Si recoge en oficina no hay calle que validar: la oficina la elige Dropi.
  const dirEnvio = oficina
    ? { ok: true, detalle: `recoge en oficina de ${oficina}: no lleva calle, la oficina se elige en Dropi`, normalizada: null }
    : validarDireccion(resumen?.direccion, extraido?.direccionEnvio ?? null, { referencias: resumen?.referencias ?? "" });

  const lineas = Array.isArray(resumen?.productos) ? resumen.productos : [];
  const unaLinea = lineas.length === 1;
  checks.push({
    campo: "productos",
    ok: unaLinea,
    detalle: unaLinea
      ? "el flujo del navegador admite una sola línea de producto"
      : `el flujo del navegador admite una línea; el pedido trae ${lineas.length}`,
  });

  const prod = coincideProducto(extraido?.producto, resumen?.productos ?? []);
  checks.push({
    campo: "producto",
    ok: prod.ok,
    detalle: prod.ok
      ? `chat "${extraido?.producto}" -> pedido "${prod.nombre}"`
      : prod.razon,
  });

  const cantidadPedido = unaLinea ? Number(lineas[0]?.cantidad) : NaN;
  const cantidadChat = Number(extraido?.cantidad);
  const cantidadOk =
    unaLinea && Number.isInteger(cantidadPedido) && cantidadPedido > 0 &&
    Number.isInteger(cantidadChat) && cantidadChat === cantidadPedido;
  checks.push({
    campo: "cantidad",
    ok: cantidadOk,
    detalle: cantidadOk
      ? `coincide: ${cantidadPedido} unidad(es)`
      : `chat: ${Number.isFinite(cantidadChat) ? cantidadChat : "sin dato"}; pedido: ${Number.isFinite(cantidadPedido) ? cantidadPedido : "sin dato"}`,
  });

  const precio = coincidePrecio(extraido?.precioAcordado, resumen);
  checks.push({
    campo: "precio",
    ok: precio.ok,
    detalle: precio.ok ? precio.razon : precio.razon,
  });

  // en oficina no hay numeros que comparar: basta con que el chat tambien
  // diga que recoge en la oficina de la misma transportadora
  const dir = oficina
    ? recogeEnOficina(extraido?.direccion) === oficina
      ? { ok: true, razon: "" }
      : { ok: false, razon: `el pedido dice recoger en oficina de ${oficina} pero en el chat la dirección es "${extraido?.direccion ?? "sin dato"}"` }
    : coincideDireccion(extraido?.direccion, resumen?.direccion);
  checks.push({
    campo: "direccion",
    ok: dir.ok,
    detalle: dir.ok ? (oficina ? `el cliente pidió recoger en oficina de ${oficina}` : "coincide") : dir.razon,
  });

  checks.push({
    campo: "direccionValida",
    ok: dirEnvio.ok,
    detalle: dirEnvio.detalle,
    ...(dirEnvio.ok ? { normalizada: dirEnvio.normalizada, corregida: dirEnvio.corregida } : {}),
  });

  const confirmo = extraido?.clienteConfirmo === true;
  checks.push({
    campo: "confirmacion",
    ok: confirmo,
    detalle: confirmo ? "el cliente confirmo el pedido en el chat" : "el cliente NO confirmo el pedido",
  });

  const entregaEnFechaActual = extraido?.entregaFutura === false;
  checks.push({
    campo: "entregaFutura",
    ok: entregaEnFechaActual,
    detalle: extraido?.entregaFutura === true
      ? `el cliente pidió entrega futura${extraido?.fechaEntregaSolicitada ? ` (${extraido.fechaEntregaSolicitada})` : ""}`
      : extraido?.entregaFutura === false
        ? "el cliente no pidió aplazar la entrega"
        : "no se pudo determinar con certeza si pidió una entrega futura",
  });

  // cita del chat en la que se apoyo la IA para cada verificacion (solo para
  // que una persona lo revise: no cambia la decision)
  const CLAVE = { producto: "producto", cantidad: "cantidad", precio: "precioAcordado", direccion: "direccion", confirmacion: "clienteConfirmo", entregaFutura: "entregaFutura" };
  for (const c of checks) {
    const cita = extraido?.evidencia?.[CLAVE[c.campo]];
    if (typeof cita === "string" && cita.trim()) c.evidencia = cita.trim();
  }

  return { ok: checks.every((c) => c.ok), checks, direccionEnvio: dirEnvio };
}

/**
 * Decision final: solo se sube si todo calza. Si algo falla se frena y se
 * avisa (regla acordada: nada sube sin visto bueno).
 */
export function decidir(validacion) {
  const problemas = (validacion?.checks ?? []).filter((c) => !c.ok);
  return {
    ok: problemas.length === 0,
    accion: problemas.length === 0 ? "subir" : "frenar",
    problemas,
  };
}

/**
 * Ejecuta el agente sobre un pedido y su conversacion.
 * `extraer` es una funcion async (mensajes) => datos extraidos; se inyecta para
 * poder probar la logica sin LLM (ver llm.js para la implementacion real).
 */
const FECHA_FUTURA_EN_CHAT = /\b(?:para\s+(?:(?:el\s+)?(?:dia\s+)?)|el\s+dia\s+|lo\s+(?:quiero|quieres|quiere|necesito|necesita)\s+(?:para\s+)?(?:el\s+)?|entregar(?:lo)?\s+(?:para\s+)?(?:el\s+)?|recibir(?:lo)?\s+(?:para\s+)?(?:el\s+)?)(?:\d{1,2}(?:\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))?|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|proxima semana|proximo mes)\b/;

export async function ejecutarAgente({ resumen, mensajes, extraer, oficina = null }) {
  // la IA tambien descompone la direccion del pedido (la que se envia)
  const extraido = await extraer(mensajes, { direccionPedido: resumen?.direccion ?? "" });
  const fechaSolicitadaEnChat = (Array.isArray(mensajes) ? mensajes : [])
    .filter((m) => m?.de === "cliente")
    .map((m) => normalizarTexto(m?.texto))
    .map((t) => t.match(FECHA_FUTURA_EN_CHAT)?.[0])
    .find(Boolean);
  const extraidoSeguro = {
    ...extraido,
    entregaFutura: fechaSolicitadaEnChat ? true : extraido?.entregaFutura,
    fechaEntregaSolicitada: fechaSolicitadaEnChat ?? extraido?.fechaEntregaSolicitada,
    // si la regla del codigo detecto la fecha, la evidencia lo dice
    ...(fechaSolicitadaEnChat
      ? { evidencia: { ...(extraido?.evidencia ?? {}), entregaFutura: `regla del sistema: el cliente escribió "${fechaSolicitadaEnChat}"` } }
      : {}),
  };
  const validacion = validarPedido(resumen, extraidoSeguro, { oficina });
  const decision = decidir(validacion);
  return {
    extraido: extraidoSeguro,
    validacion,
    ...decision,
    // direccion lista para Dropi (normalizada/corregida) si es valida
    direccionEnvio: validacion.direccionEnvio,
    direccionInvalida: decision.problemas.some((p) => p.campo === "direccionValida"),
    // la IA no respondio: no es que el chat este mal
    falloIA: extraido?.falloTecnico || null,
  };
}

/** `Json` del pedido viene como string JSON o como arreglo. */
function aArreglo(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Nombre de producto de una linea. En LucidSales el `Json` de cada linea suele
 * traer solo `product_id` (sin nombre), por eso el nombre legible puede venir
 * en el campo top-level `producto` del pedido; el `product_id` NO es un nombre
 * util para comparar (es un numero: "55772").
 */
function nombreDeLinea(it) {
  return String(
    it?.name ?? it?.nombre ?? it?.product_name ?? it?.productName ?? it?.title ?? "",
  ).trim();
}

/**
 * Pedido crudo de LucidSales (get-pedido-by-id) -> resumen para el agente.
 * Los nombres de campo son los del update de LucidSales (ver
 * panel/src/api/pedidoBody.ts): Nombre, Movil, Direccion, Total, Json, etc.
 */
export function resumenDePedido(p) {
  const lineas = aArreglo(p?.Json);
  const productoTop = String(p?.producto ?? "").trim();
  return {
    id: String(p?.id ?? p?.idPedido ?? ""),
    idPedido: String(p?.idPedido ?? ""),
    // tienda de LucidSales: decide en que tienda de Dropi se crea la orden
    idEmpresa: String(p?.idEmpresa ?? ""),
    cliente: [p?.Nombre, p?.Apellido].filter(Boolean).join(" ").trim(),
    telefono: String(p?.Movil ?? ""),
    direccion: String(p?.Direccion ?? "").trim(),
    referencias: String(p?.Referencias ?? "").trim(),
    ciudad: String(p?.Ciudad ?? ""),
    departamento: String(p?.Departamento ?? ""),
    // Pais de LucidSales (47 = Colombia). Sirve para resolver ciudad/depto a
    // nombres cuando se sube a Dropi (los ids no le dicen nada al formulario).
    pais: Number(p?.Pais) || 47,
    // TipoPago: 1 = CON RECAUDO (contra entrega), 2 = SIN RECAUDO (prepago).
    // El tipo de recaudo depende del pedido; los "sin recaudo" los sube un humano.
    tipoPago: [1, 2].includes(Number(p?.TipoPago)) ? Number(p.TipoPago) : null,
    estadoPedido: Number(p?.EstadoPedido),
    total: p?.Total,
    subtotal: p?.SubTotal,
    costoEnvio: p?.CostoEnvio,
    productos: lineas.map((it) => ({
      id: String(it?.product_id ?? it?.id ?? ""),
      // el nombre de la linea manda; si no viene, el `producto` del pedido
      // (en un pedido de una sola linea es el nombre real del producto)
      nombre: nombreDeLinea(it) || (lineas.length === 1 ? productoTop : ""),
      cantidad: Number(it?.quantity ?? it?.cantidad ?? 1) || 1,
      precio: parsearPrecio(it?.price ?? it?.precio ?? 0),
    })),
  };
}
