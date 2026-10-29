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

import { diasHasta, fechaDeExtraccion } from "./fechaEntrega.js";
import { candidatosNumeroPegado } from "./validadorDireccion.js";
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
  // acepta ["Taladro"] o [{nombre:"Taladro", variante?:{nombre}}] (como viene en resumen.productos)
  const items = (Array.isArray(catalogo) ? catalogo : [catalogo])
    .map((x) =>
      x && typeof x === "object"
        ? { nombre: String(x.nombre ?? x.name ?? x.producto ?? ""), variante: String(x.variante?.nombre ?? "") }
        : { nombre: String(x ?? ""), variante: "" },
    )
    .filter((x) => x.nombre);
  if (!tokens(chat).length) {
    return { ok: false, razon: "no se entendio el producto del chat", nombre: "" };
  }
  if (!items.length) {
    return { ok: false, razon: "el pedido no trae productos para comparar", nombre: "" };
  }

  let mejor = null;
  for (const { nombre, variante } of items) {
    // con variante, sus valores tambien cuentan ("Arbol ... (Copa: Blanca - Tamaño: 150 cm)")
    const completo = variante ? `${nombre} ${variante}` : nombre;
    const c = cobertura(chat, completo);
    // y al reves: todo el nombre del catalogo esta en el chat (el chat trae de mas)
    const alReves = cobertura(nombre, chat);
    if (c.valor >= 0.5 || (alReves.valor >= 0.99 && alReves.tokens >= 2)) {
      const v = varianteDistinta(chat, variante);
      if (v) return { ok: false, razon: v, nombre };
      return { ok: true, razon: "", nombre: completo };
    }
    if (!mejor || c.valor > mejor.valor) {
      mejor = { ok: false, razon: `sin coincidencia con "${nombre}"`, nombre, valor: c.valor };
    }
  }
  return mejor;
}

/**
 * ¿El chat pide OTRA variante? Si menciona algun valor de la variante del
 * pedido ("blanca") pero no todos ("90 cm" en vez de "150 cm"), no es la misma.
 * Si no menciona ninguno, no se puede saber: no frena.
 */
function varianteDistinta(chat, variante) {
  if (!variante) return null;
  const valores = variante
    .split(";")
    .map((x) => x.split(":").slice(1).join(":") || x)
    .map((x) => normalizarTexto(x).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!valores.length) return null;
  const t = ` ${normalizarTexto(chat).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  const estan = valores.filter((v) => t.includes(` ${v} `));
  if (!estan.length || estan.length === valores.length) return null;
  return `variante: en el chat no coincide con la del pedido (${variante})`;
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
export function coincideDireccion(chat, pedido, { referencias = "" } = {}) {
  if (!tokens(chat).length) {
    return { ok: false, razon: "no se entendio la direccion del chat" };
  }
  if (!tokens(pedido).length) {
    return { ok: false, razon: "el pedido no tiene direccion para comparar" };
  }
  // misma calle y numeros (aunque una traiga ciudad o barrio de mas): coincide
  const kChat = claveCalle(chat);
  if (kChat && kChat === claveCalle(pedido)) return { ok: true, razon: "" };
  // el pedido con sus referencias (barrio, conjunto...) es lo que se envia
  const objetivo = `${pedido} ${referencias ?? ""}`;
  // el chat suele traer de mas (nombre, ciudad, telefono): se mira tambien al
  // reves, si TODO lo del pedido esta en el chat
  const c = cobertura(chat, objetivo);
  const alReves = cobertura(objetivo, chat);
  // numeros de la direccion (no telefonos ni cedulas)
  // (con los de un digito: "casa 9")
  const numeros = (v) => new Set(normalizarTexto(v).match(/\b\d{1,5}[a-z]?\b/g) ?? []);
  const numerosChat = numeros(chat);
  const numerosPedido = numeros(objetivo);
  const numerosCoinciden =
    numerosChat.size > 0 &&
    numerosChat.size === numerosPedido.size &&
    [...numerosChat].every((n) => numerosPedido.has(n));
  // letras de manzana, bloque, torre... ("Manzana B" no es "Manzana C")
  const letras = (v) => {
    const m = new Map();
    for (const [, k, l] of normalizarTexto(v).matchAll(/\b(manzana|manz|mza|mz|bloque|bl|torre|tr|interior|int|etapa)\.?\s+([a-z])\b/g)) {
      const g = /^m/.test(k) ? "mz" : /^b/.test(k) ? "bl" : /^t/.test(k) ? "tr" : /^i/.test(k) ? "int" : "et";
      m.set(g, l);
    }
    return m;
  };
  const lChat = letras(chat);
  const lPedido = letras(objetivo);
  const letrasCoinciden = [...lChat].every(([g, l]) => !lPedido.has(g) || lPedido.get(g) === l);
  return numerosCoinciden && letrasCoinciden && (c.valor >= 0.75 || alReves.valor >= 0.9)
    ? { ok: true, razon: "" }
    : {
        ok: false,
        razon: `chat "${chat}" vs pedido "${[pedido, referencias].filter(Boolean).join(", ")}" (coincidencia ${Math.round(Math.max(c.valor, alReves.valor) * 100)}%)`,
      };
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
  // numero pegado ("Cra 110AA #3021"): no se adivina aqui; el mapa decide
  // como se separa en el paso siguiente (si no lo confirma, no se sube)
  if (!oficina && !dirEnvio.ok) {
    const cands = candidatosNumeroPegado(resumen?.direccion);
    if (cands.length) {
      dirEnvio.ok = true;
      dirEnvio.numeroPegado = true;
      dirEnvio.normalizada = null;
      dirEnvio.detalle = `el número viene pegado: el mapa decide cómo se separa (se prueba ${cands.map((c) => `«${c}»`).join(" y ")})`;
    }
  }

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
    : coincideDireccion(extraido?.direccion, resumen?.direccion, { referencias: resumen?.referencias ?? "" });
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

/**
 * Otros pedidos recientes del mismo cliente, en texto para la IA.
 * otros: [{ idPedido, producto, Total, fecha, estado, subido }]
 */
export function textoOtrosPedidos(otros = []) {
  return otros
    .map(
      (o) =>
        `- Pedido #${o.idPedido ?? o.id}: ${o.producto || "producto sin nombre"} · total ${o.Total ?? "?"}` +
        `${o.fecha ? ` · creado ${String(o.fecha).slice(0, 16).replace("T", " ")}` : ""}` +
        `${o.subido ? " · YA se subio a Dropi" : ""}`,
    )
    .join("\n");
}

/**
 * entregaProgramada: { fecha: "AAAA-MM-DD", toca: boolean } si el pedido tiene
 * una entrega programada (por la IA o a mano). Cuando ya toca enviarlo, que
 * el cliente haya pedido una fecha futura deja de frenar la subida.
 */
export async function ejecutarAgente({ resumen, mensajes, extraer, oficina = null, otrosPedidos = [], entregaProgramada = null, diasEntrega = null }) {
  // la IA tambien descompone la direccion del pedido (la que se envia) y, si
  // el cliente tiene otro pedido reciente, dice si el chat muestra una
  // segunda compra (el codigo decide)
  const hayOtros = Array.isArray(otrosPedidos) && otrosPedidos.length > 0;
  const extraido = await extraer(mensajes, {
    direccionPedido: resumen?.direccion ?? "",
    ...(hayOtros ? { otrosPedidos: textoOtrosPedidos(otrosPedidos) } : {}),
  });
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
  // ¿vive en un corregimiento? En Dropi algunos son municipio aparte; si no
  // lo es, no se sube (lo decide el formulario de Dropi). Si el cliente lo
  // dijo pero la IA no supo cual, frena.
  const dijoCorregimiento = (Array.isArray(mensajes) ? mensajes : [])
    .filter((m) => m?.de === "cliente")
    .map((m) => normalizarTexto(m?.texto))
    .find((t) => /\bcorregimiento\b/.test(t));
  extraidoSeguro.corregimiento = String(extraidoSeguro.corregimiento ?? "").trim();
  // fecha concreta de la entrega (la de la IA si es valida; si no, la del texto)
  const fechaEntrega = extraidoSeguro.entregaFutura === true ? fechaDeExtraccion(extraidoSeguro) : null;
  extraidoSeguro.fechaEntregaISO = fechaEntrega ?? "";
  const validacion = validarPedido(resumen, extraidoSeguro, { oficina });
  if (extraidoSeguro.corregimiento || dijoCorregimiento) {
    const nombre = extraidoSeguro.corregimiento;
    validacion.checks.push({
      campo: "corregimiento",
      ok: Boolean(nombre),
      detalle: nombre
        ? `el cliente vive en el corregimiento ${nombre}: en Dropi se busca como municipio y si no existe no se sube`
        : "el cliente dijo que vive en un corregimiento pero no se pudo saber cuál",
      ...(extraidoSeguro.evidencia?.corregimiento ? { evidencia: extraidoSeguro.evidencia.corregimiento } : dijoCorregimiento ? { evidencia: `CLIENTE: …${dijoCorregimiento.slice(0, 100)}` } : {}),
    });
    validacion.ok = validacion.checks.every((c) => c.ok);
  }
  // Pidio una fecha que cae dentro de lo que tarda un envio normal: no es una
  // entrega futura, se sube ya (llega mas o menos para ese dia).
  let dentroDelPlazo = false;
  if (fechaEntrega && Number.isFinite(Number(diasEntrega)) && Number(diasEntrega) >= 0 && !entregaProgramada?.toca) {
    const faltan = diasHasta(fechaEntrega);
    const ch = validacion.checks.find((c) => c.campo === "entregaFutura");
    if (ch && !ch.ok && faltan <= Number(diasEntrega)) {
      dentroDelPlazo = true;
      ch.ok = true;
      ch.detalle = `pidió la entrega para el ${fechaEntrega} (${faltan <= 0 ? "hoy" : faltan === 1 ? "mañana" : `en ${faltan} días`}): está dentro del tiempo normal de envío (hasta ${Number(diasEntrega)} días), se sube ya`;
      validacion.ok = validacion.checks.every((c) => c.ok);
    }
  }
  if (entregaProgramada?.toca) {
    const ch = validacion.checks.find((c) => c.campo === "entregaFutura");
    if (ch && !ch.ok) {
      ch.ok = true;
      ch.detalle = `entrega programada para el ${entregaProgramada.fecha}: ya toca enviarlo`;
      validacion.ok = validacion.checks.every((c) => c.ok);
    }
  }
  // ¿pedido repetido? Solo pasa si la IA vio en el chat una compra nueva
  if (hayOtros && !extraido?.falloTecnico) {
    const nuevo = extraidoSeguro.segundaCompra === true;
    const lista = otrosPedidos.map((o) => `#${o.idPedido ?? o.id}`).join(", ");
    validacion.checks = [
      ...(validacion.checks ?? []),
      {
        campo: "duplicado",
        ok: nuevo,
        detalle: nuevo
          ? `el cliente ya tenía el pedido ${lista}, pero en el chat pidió una compra nueva`
          : `posible pedido repetido: el cliente ya tiene el pedido ${lista} y en el chat no se ve una segunda compra`,
        ...(extraidoSeguro.evidencia?.segundaCompra ? { evidencia: extraidoSeguro.evidencia.segundaCompra } : {}),
      },
    ];
    validacion.ok = validacion.checks.every((c) => c.ok);
  }
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
    // el cliente pidio otra fecha: { fecha: "AAAA-MM-DD" | null, texto }
    entrega:
      extraidoSeguro.entregaFutura === true && !dentroDelPlazo
        ? { fecha: fechaEntrega, texto: String(extraidoSeguro.fechaEntregaSolicitada ?? "").slice(0, 120) }
        : null,
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

/** "2 x Copa: Blanca; Tamaño: 150 cm" si el pedido trae productos con variantes; "" si no. */
export function textoVariantes(resumen) {
  return (resumen?.productos ?? [])
    .filter((x) => x.variante)
    .map((x) => `${x.cantidad} x ${x.variante.nombre || `variante ${x.variante.id}`}`)
    .join(", ");
}

/** ¿La linea trae precio y cantidad en sus variantes? (la linea va en null) */
function conVariantes(it) {
  return (
    Array.isArray(it?.variations) &&
    it.variations.length > 0 &&
    it.variations.some((v) => v && (v.price !== undefined || v.quantity !== undefined))
  );
}

/**
 * Lineas del pedido -> productos. Un producto con variantes da un producto
 * por variante (precio y cantidad de la variante) con su nombre, que sale de
 * las observaciones de LucidSales ("2 x Arbol ... - Copa: Blanca; Tamaño: 150 cm").
 */
function productosDeLineas(lineas, productoTop, observaciones = []) {
  const nombresVar = observaciones
    .map((o) => String(o?.desc ?? "").match(/^\s*\d+\s*x\s+.+?\s+-\s+(.+:.+)$/i)?.[1]?.trim())
    .filter(Boolean);
  let k = 0;
  const out = [];
  for (const it of lineas) {
    const base = {
      id: String(it?.product_id ?? it?.id ?? ""),
      // el nombre de la linea manda; si no viene, el `producto` del pedido
      // (en un pedido de una sola linea es el nombre real del producto)
      nombre: nombreDeLinea(it) || (lineas.length === 1 ? productoTop : ""),
    };
    if (conVariantes(it)) {
      for (const v of it.variations) {
        out.push({
          ...base,
          cantidad: Number(v?.quantity ?? 1) || 1,
          precio: parsearPrecio(v?.price ?? it?.price ?? 0),
          variante: { id: String(v?.variation_id ?? ""), nombre: nombresVar[k] ?? "" },
        });
        k++;
      }
      continue;
    }
    out.push({
      ...base,
      cantidad: Number(it?.quantity ?? it?.cantidad ?? 1) || 1,
      precio: parsearPrecio(it?.price ?? it?.precio ?? 0),
    });
  }
  return out;
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
    productos: productosDeLineas(lineas, productoTop, aArreglo(p?.Observaciones)),
  };
}
