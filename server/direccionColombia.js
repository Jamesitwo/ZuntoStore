// Validacion y normalizacion de direcciones urbanas de Colombia.
//
// Formato (nomenclatura urbana): TIPO DE VIA + numero de la via
//   # numero de la via que cruza - placa (numero de la puerta)
//   [, complemento (apto, torre, interior...)] [, barrio]
//   Ej.: "Cra 40 # 23-23, Centro"   "Calle 8 Sur # 2A-15 Apto 301"
//   Letras pegadas al numero (29A), "Bis" separado, "Sur"/"Este" al final.
//
// Reparto de responsabilidades (igual que el resto del agente):
//   1) Reglas fijas: si la direccion del pedido ya tiene el formato, vale TAL CUAL.
//   2) Si no, la IA la descompone en partes y propone una correccion.
//   3) El CODIGO acepta la correccion solo si usa EXACTAMENTE los mismos
//      numeros, en el mismo orden, que escribio el cliente ("cra 21 #1212"
//      -> "Cra 21 # 12-12" si; inventar o quitar un numero, no).
// Tambien el formato de MANZANA (comun en la costa, Villavicencio, etc.):
//   [Supermanzana X] Manzana Y Casa Z | Lote Z  + barrio/urbanizacion
//   Abreviado: Smz/SM, Mz/Mza/Manz, Cs/Csa, Lt/Lte.  "Mz B Cs 12, Los Almendros"
//   Sin barrio no se acepta: una manzana sola no le sirve a la transportadora.
// Lo descriptivo ("casa verde al lado de la panaderia") y lo rural (vereda,
// finca, km) no es una direccion de nomenclatura: no se sube.

export function normalizarTextoDir(t) {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tipos de via -> forma con la que se escribe en la direccion final. */
const TIPOS = [
  // el orden importa: los compuestos primero
  [/^(avenida\s+carrera|av\.?\s*(cra|carrera|kr|kra)|ak)\b/, "Av. Carrera"],
  [/^(avenida\s+calle|av\.?\s*(cl|cll|calle)|ac)\b/, "Av. Calle"],
  [/^(carrera|cra|kra|kr|cr|carr|crr|car)\b/, "Cra"],
  [/^(calle|cll|cl|call)\b/, "Calle"],
  [/^(diagonal|diag|dg)\b/, "Diagonal"],
  [/^(transversal|transv|trans|tv|tr)\b/, "Transversal"],
  [/^(circular|circ|cq|cir)\b/, "Circular"],
  [/^(autopista|autop)\b/, "Autopista"],
  [/^(avenida|av)\b/, "Avenida"],
];

/** Nombre canonico de un tipo de via escrito de cualquier forma, o null. */
export function tipoViaCanonico(texto) {
  const t = normalizarTextoDir(texto).replace(/\.(?=\s|$)/g, "");
  for (const [re, nombre] of TIPOS) if (re.test(t)) return nombre;
  return null;
}

// numero de via: 1-3 digitos + letra opcional + Bis opcional + letra + Sur/Este
const NUM = String.raw`(\d{1,3})\s*([a-z])?(?:\s*(bis))?(?:\s*([a-z]))?(?:\s+(sur|este))?`;
const SEP_NUM = String.raw`\s*(?:#|no\.?|n[°º]|nro\.?|numero|num\.?)\s*`;
const RE_DIR = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + SEP_NUM + NUM + String.raw`\s*[-–]\s*(\d{1,3})(?:\s+(sur|este))?\b\s*[,.]?\s*(.*)$`,
);
// lo mismo SIN guion entre cruce y placa ("Cra 91a # 128 f 14", "Cl 10 # 5 20"):
// muy comun; la placa son 1-3 digitos sueltos despues del cruce
// Sin "#" ("Car 5, 4-98", "Cra 5 4-98"): coma o espacio entre via y cruce,
// pero SOLO con guion en la placa (si no, los numeros serian ambiguos)
const RE_DIR_SIN_NUMERAL = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + String.raw`\s*(?:,\s*|\s+)` + NUM + String.raw`\s*[-–]\s*(\d{1,3})(?:\s+(sur|este))?\b\s*[,.]?\s*(.*)$`,
);
const RE_DIR_SIN_GUION = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + SEP_NUM + NUM + String.raw`\s+(\d{1,3})(?:\s+(sur|este))?\b(?![a-z\d])\s*[,.]?\s*(.*)$`,
);

function armarNumero(n, letra, bis, letra2, cardinal) {
  let s = String(n);
  if (letra) s += letra.toUpperCase();
  if (bis) s += " Bis";
  if (letra2) s += ` ${letra2.toUpperCase()}`;
  if (cardinal) s += ` ${cardinal[0].toUpperCase()}${cardinal.slice(1)}`;
  return s;
}

function capitalizarResto(r) {
  const t = String(r ?? "").trim().replace(/^[,.\s]+/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/**
 * Reconoce la direccion con reglas fijas. Devuelve {tipoVia, via, cruce,
 * placa, resto, normalizada} o null si no tiene el formato.
 */
export function parsearDireccion(direccion) {
  // La calle puede no estar al principio ("Etapa Tres, Calle KR 5 No. 19-105"):
  // se busca desde cada tipo de via y lo que va antes pasa al final (barrio,
  // etapa...). Con dos tipos seguidos que no forman uno compuesto ("Calle KR
  // 5") vale el segundo, que es la abreviatura que escribio el cliente.
  const palabras = String(direccion ?? "").replace(/\s+/g, " ").trim().split(" ");
  for (let i = 0; i < palabras.length; i++) {
    const tipo = tipoViaCanonico(palabras[i]);
    if (!tipo) continue;
    let desde = i;
    const sig = palabras[i + 1];
    if (sig && tipoViaCanonico(sig) && tipoViaCanonico(`${palabras[i]} ${sig}`) === tipo) desde = i + 1;
    const p = parsearDesdeElInicio(palabras.slice(desde).join(" "));
    if (!p) continue;
    const antes = palabras.slice(0, i).join(" ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
    if (!antes) return p;
    // "frente a la cra 5 # 3-2" no es esa direccion: es una referencia
    if (/\b(frente|lado|cerca|junto|detras|diagonal|enseguida|despues|antes|cruzando|vuelta)\b(\s+(a|al|de|del))?(\s+(la|el|los|las))?$/.test(normalizarTextoDir(antes))) continue;
    const resto = [p.resto, antes].filter(Boolean).join(", ");
    return { ...p, resto, normalizada: `${p.tipoVia} ${p.via} # ${p.cruce}-${p.placa}${resto ? `, ${resto}` : ""}` };
  }
  return null;
}

function parsearDesdeElInicio(direccion) {
  const t = normalizarTextoDir(direccion)
    .replace(/\s*#\s*/g, " # ")
    // letra del cruce pegada a la placa: "# 82 C19" / "# 82c19" = cruce 82C, placa 19
    .replace(/(#\s*\d{1,3}\s*[a-z])(\d{1,3})\b/, "$1 $2");
  let m = t.match(RE_DIR);
  const sinGuion = !m;
  if (!m) m = t.match(RE_DIR_SIN_GUION);
  // sin "#": ultimo recurso (y el resto sale del texto normalizado)
  const sinNumeral = !m;
  if (!m) m = t.match(RE_DIR_SIN_NUMERAL);
  if (!m) return null;
  const tipoVia = tipoViaCanonico(m[1]);
  if (!tipoVia) return null;
  // el "tipo" no puede traer texto de mas ("frente a la cra" no es un tipo)
  if (normalizarTextoDir(m[1]).split(" ").length > 3) return null;
  // ni otra frase antes de una coma ("Calle Real, Cra 5": la via es la Cra)
  if (/,/.test(m[1])) return null;
  const via = armarNumero(m[2], m[3], m[4], m[5], m[6]);
  const cruce = armarNumero(m[7], m[8], m[9], m[10], m[11]);
  const placa = String(m[12]) + (m[13] ? ` ${m[13][0].toUpperCase()}${m[13].slice(1)}` : "");
  // el resto (complemento/barrio) se conserva con su texto original (sin
  // guion no hay donde cortar el original: se usa el del texto normalizado)
  const resto = capitalizarResto(
    sinGuion || sinNumeral
      ? restoConMismaRegla(String(direccion ?? ""), sinNumeral ? RE_DIR_SIN_NUMERAL : RE_DIR_SIN_GUION) ?? m[14]
      : restoOriginal(String(direccion ?? "")),
  );
  const normalizada = `${tipoVia} ${via} # ${cruce}-${placa}${resto ? `, ${resto}` : ""}`;
  return { tipoVia, via, cruce, placa, resto, normalizada, sinGuion };
}

/**
 * El resto con su texto ORIGINAL (tildes y mayusculas): se aplica la misma
 * regla sobre el original en minusculas (mismo largo) y se corta ahi.
 */
function restoConMismaRegla(original, re) {
  const orig = original
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*#\s*/g, " # ")
    .replace(/(#\s*\d{1,3}\s*[a-zA-Z])(\d{1,3})\b/, "$1 $2");
  const bajo = orig.toLowerCase();
  if (bajo.length !== orig.length) return null;
  const m = bajo.match(re);
  if (!m) return null;
  return orig.slice(orig.length - m[14].length);
}

/** Lo que va despues de la placa ("- 23 Sur, apto 2, Centro" -> "apto 2, Centro"). */
function restoOriginal(original) {
  const t = String(original ?? "").replace(/\s+/g, " ").trim();
  const desde = t.search(/(#|\bn[o°º]\.?|\bnro\.?|\bnumero\b|\bnum\.?)/i);
  if (desde < 0) return "";
  const m = t.slice(desde).match(/[-–]\s*\d{1,3}(\s+(sur|este)\b)?/i);
  if (!m) return "";
  return t.slice(desde + m.index + m[0].length);
}

/**
 * Clave "tipo|via|cruce|placa" de la calle que aparezca en un texto, aunque
 * tenga cosas antes ("Bogotá Kennedy Calle 51B Sur #82 C19 ...") o despues.
 * Sirve para comparar dos direcciones escritas distinto. null si no hay.
 */
export function claveCalle(texto) {
  const palabras = String(texto ?? "").replace(/\s+/g, " ").trim().split(" ");
  for (let i = 0; i < palabras.length; i++) {
    if (!tipoViaCanonico(palabras[i])) continue;
    const p = parsearDireccion(palabras.slice(i).join(" "));
    if (!p) continue;
    const limpio = (x) => normalizarTextoDir(x).replace(/\b(sur|este)\b/g, "").replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
    return `${p.tipoVia}|${limpio(p.via)}|${limpio(p.cruce)}|${limpio(p.placa)}`;
  }
  return null;
}

/** Digitos de la parte numerica (via, cruce, placa) en orden, sin letras. */
export function digitosDireccion(texto) {
  return (String(texto ?? "").match(/\d+/g) ?? []).join("");
}

const SIN_NOMENCLATURA = /\b(vereda|finca|corregimiento|km|kilometro|sector rural|parcela|hacienda)\b/;

// ---- formato manzana ----
const ID = String.raw`(\d{1,4}[a-z]?|[a-z]{1,2}\d{0,2})`;
const PARTES_MZ = {
  supermanzana: new RegExp(String.raw`\b(?:supermanzana|super manzana|supermz|smz|sm)\.?\s*(?:n[o°º]\.?\s*)?` + ID + String.raw`\b`),
  manzana: new RegExp(String.raw`\b(?:manzana|manz|mza|mz)\.?\s*(?:n[o°º]\.?\s*)?` + ID + String.raw`\b`),
  casa: new RegExp(String.raw`\b(?:casa|csa|cs)\.?\s*(?:n[o°º]\.?\s*)?` + ID + String.raw`\b`),
  lote: new RegExp(String.raw`\b(?:lote|lte|lt)\.?\s*(?:n[o°º]\.?\s*)?` + ID + String.raw`\b`),
};
const ETIQUETA_MZ = { supermanzana: "Smz", manzana: "Mz", casa: "Cs", lote: "Lt" };

function idMz(v) {
  return String(v ?? "").trim().toUpperCase();
}

/** Arma "Smz 7 Mz B Cs 12" con las partes presentes. */
function armarManzana(p) {
  return ["supermanzana", "manzana", "casa", "lote"]
    .filter((k) => p[k])
    .map((k) => `${ETIQUETA_MZ[k]} ${idMz(p[k])}`)
    .join(" ");
}

/** Lo que queda de barrio/urbanizacion: con letras de verdad, no solo separadores. */
function limpiarBarrio(t) {
  const r = String(t ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:\-–#]+|[\s,.;:\-–#]+$/g, "")
    .replace(/\s*[,;]\s*[,;]+\s*/g, ", ")
    .trim();
  return (r.match(/[a-záéíóúñ]/gi) ?? []).length >= 3 ? r : "";
}

/**
 * Reconoce el formato manzana con reglas fijas. Devuelve
 * {partes, barrio, normalizada} o null si no lo es (necesita manzana y casa o lote).
 */
export function parsearManzana(direccion) {
  const original = String(direccion ?? "").replace(/\s+/g, " ").trim();
  const t = normalizarTextoDir(original);
  const partes = {};
  let resto = original.normalize("NFC");
  for (const k of ["supermanzana", "manzana", "casa", "lote"]) {
    const m = t.match(PARTES_MZ[k]);
    if (!m) continue;
    partes[k] = m[1];
    // se quita del texto original la misma porcion (mismo largo: NFD no cambia
    // la longitud de letras sin tilde; con tildes se usa el texto normalizado)
    const desde = normalizarTextoDir(resto).indexOf(m[0]);
    if (desde >= 0) {
      // se colapsan los espacios en cada paso para que las posiciones del
      // texto original y del normalizado sigan alineadas
      resto = `${resto.slice(0, desde)} ${resto.slice(desde + m[0].length)}`.replace(/\s+/g, " ").trim();
    }
  }
  if (!partes.manzana || !(partes.casa || partes.lote)) return null;
  const barrio = limpiarBarrio(capitalizarResto(resto));
  const base = armarManzana(partes);
  return { partes, barrio, normalizada: barrio ? `${base}, ${barrio}` : base };
}

/**
 * Valida la direccion del pedido. `ia` es lo que propuso la IA (puede faltar):
 *   { esNomenclatura, tipoVia, via, cruce, placa, complemento, barrio, motivo }
 * Devuelve { ok, normalizada, corregida, origen, detalle }.
 */
export function validarDireccion(direccion, ia = null, { referencias = "" } = {}) {
  const r = validarDireccionInterna(direccion, ia, true, referencias);
  // si se prefirio la IA para una direccion sin guion y no paso, vale la
  // lectura de las reglas (que ya era valida)
  if (!r.ok && ia && parsearDireccion(direccion)?.sinGuion) return validarDireccionInterna(direccion, null, false, referencias);
  return r;
}

function validarDireccionInterna(direccion, ia, preferirIA, referencias = "") {
  const original = String(direccion ?? "").trim();
  if (!original) return { ok: false, normalizada: "", corregida: false, origen: "reglas", detalle: "el pedido no tiene dirección" };

  // 1) reglas fijas: ya tiene el formato. Sin guion ("# 128 f 14") vale
  //    igual, pero si la IA la descompuso se prefiere la suya (separa mejor
  //    complemento y barrio; sus numeros se verifican mas abajo)
  const p = parsearDireccion(original);
  if (p && !(preferirIA && p.sinGuion && ia?.esNomenclatura === true && String(ia?.formato ?? "").toLowerCase() !== "manzana")) {
    const corregida = normalizarTextoDir(p.normalizada) !== normalizarTextoDir(original);
    return {
      ok: true,
      normalizada: p.normalizada,
      corregida,
      origen: "reglas",
      detalle: corregida ? `formato válido; se escribe como "${p.normalizada}"` : "formato válido",
    };
  }

  // 1b) formato manzana (Mz/Cs/Lt) con reglas fijas
  const mz = parsearManzana(original);
  if (mz) {
    // el barrio puede venir aparte, en las Referencias del pedido
    const barrioRef = mz.barrio ? "" : limpiarBarrio(referencias);
    if (!mz.barrio && barrioRef) {
      const normalizada = `${mz.normalizada}, ${barrioRef.charAt(0).toUpperCase()}${barrioRef.slice(1)}`;
      return {
        ok: true,
        normalizada,
        corregida: true,
        origen: "reglas",
        detalle: `formato manzana válido con el barrio de las referencias del pedido; se escribe como "${normalizada}"`,
      };
    }
    if (!mz.barrio) {
      return {
        ok: false,
        normalizada: "",
        corregida: false,
        origen: "reglas",
        detalle: `formato manzana sin barrio/urbanización ("${original}"): falta el barrio para que la transportadora la ubique`,
      };
    }
    const corregida = normalizarTextoDir(mz.normalizada) !== normalizarTextoDir(original);
    return {
      ok: true,
      normalizada: mz.normalizada,
      corregida,
      origen: "reglas",
      detalle: corregida ? `formato manzana válido; se escribe como "${mz.normalizada}"` : "formato manzana válido",
    };
  }

  const motivoIA = String(ia?.motivo ?? "").trim();
  if (SIN_NOMENCLATURA.test(normalizarTextoDir(original))) {
    return { ok: false, normalizada: "", corregida: false, origen: "reglas", detalle: `dirección rural o sin nomenclatura urbana ("${original}")` };
  }

  // 2) propuesta de la IA
  if (!ia || ia.esNomenclatura !== true) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: ia ? "ia" : "reglas",
      detalle: `no es una dirección con nomenclatura (tipo de vía, número # cruce - placa): "${original}"${motivoIA ? ` — ${motivoIA}` : ""}`,
    };
  }
  if (String(ia.formato ?? "").toLowerCase() === "manzana") return validarManzanaIA(original, ia, motivoIA);

  const tipoVia = tipoViaCanonico(ia.tipoVia);
  const via = String(ia.via ?? "").trim();
  const cruce = String(ia.cruce ?? "").trim();
  const placa = String(ia.placa ?? "").trim();
  const parteNum = /^\d{1,3}[A-Za-z]?( Bis)?( [A-Za-z])?( (Sur|Este))?$/i;
  if (!tipoVia || !parteNum.test(via) || !parteNum.test(cruce) || !/^\d{1,3}( (Sur|Este))?$/i.test(placa)) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `la dirección no tiene todas sus partes (tipo de vía, número, cruce y placa): "${original}"${motivoIA ? ` — ${motivoIA}` : ""}`,
    };
  }

  // el tipo de via propuesto tiene que estar escrito por el cliente (la IA
  // no puede "decidir" que algo es una carrera)
  const palabras = normalizarTextoDir(original).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const tipoEscrito = palabras.some((w, i) =>
    tipoViaCanonico(`${w} ${palabras[i + 1] ?? ""}`) === tipoVia || tipoViaCanonico(w.replace(/\d+.*$/, "")) === tipoVia,
  );
  if (!tipoEscrito) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `el tipo de vía propuesto (${tipoVia}) no aparece en la dirección escrita ("${original}"); se deja para revisión`,
    };
  }

  // 3) el codigo solo acepta la correccion si usa EXACTAMENTE los mismos
  //    numeros, en el mismo orden (incluidos los del complemento: apto 301...)
  const numOriginal = digitosDireccion(original);
  const numPropuesta = digitosDireccion(`${via} ${cruce} ${placa} ${ia.complemento ?? ""} ${ia.barrio ?? ""}`);
  if (numOriginal !== numPropuesta) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `la corrección propuesta no conserva los números escritos ("${original}" → ${tipoVia} ${via} # ${cruce}-${placa}); se deja para revisión`,
    };
  }
  const extras = [ia.complemento, ia.barrio].map((x) => capitalizarResto(x)).filter(Boolean);
  const normalizada = `${tipoVia} ${via} # ${cruce}-${placa}${extras.length ? `, ${extras.join(", ")}` : ""}`;
  return {
    ok: true,
    normalizada,
    corregida: true,
    origen: "ia",
    detalle: `corregida: "${original}" → "${normalizada}"`,
  };
}

/** Propuesta de la IA en formato manzana: mismas garantias que la de calle/carrera. */
function validarManzanaIA(original, ia, motivoIA) {
  // el cliente tiene que haber escrito manzana (o su abreviatura)
  if (!/(manzana|manz|mza|mz|supermanzana|smz)/.test(normalizarTextoDir(original))) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `no es una dirección con nomenclatura: no menciona manzana ni tipo de vía ("${original}")${motivoIA ? ` — ${motivoIA}` : ""}`,
    };
  }
  const partes = {};
  for (const k of ["supermanzana", "manzana", "casa", "lote"]) {
    const v = String(ia[k] ?? "").trim();
    if (v) partes[k] = v;
  }
  const idOk = (v) => /^[0-9a-z]{1,4}$/i.test(v);
  if (!partes.manzana || !(partes.casa || partes.lote) || !Object.values(partes).every(idOk)) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `la dirección no tiene manzana y casa o lote ("${original}")${motivoIA ? ` — ${motivoIA}` : ""}`,
    };
  }
  const barrio = limpiarBarrio([ia.complemento, ia.barrio].filter(Boolean).join(", "));
  if (!barrio) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `formato manzana sin barrio/urbanización ("${original}"): falta el barrio para que la transportadora la ubique`,
    };
  }
  const numOriginal = digitosDireccion(original);
  const numPropuesta = digitosDireccion(`${Object.values(partes).join(" ")} ${barrio}`);
  // el orden de las partes puede variar (Cs antes que Mz): se comparan los
  // mismos digitos agrupados por numero, sin importar el orden de las partes
  const grupos = (t) => (String(t).match(/\d+/g) ?? []).sort().join(",");
  const gruposProp = `${Object.values(partes).join(" ")} ${barrio}`;
  if (grupos(original) !== grupos(gruposProp) || numOriginal.length !== numPropuesta.length) {
    return {
      ok: false,
      normalizada: "",
      corregida: false,
      origen: "ia",
      detalle: `la corrección propuesta no conserva los números escritos ("${original}" → ${armarManzana(partes)}); se deja para revisión`,
    };
  }
  const normalizada = `${armarManzana(partes)}, ${capitalizarResto(barrio)}`;
  return { ok: true, normalizada, corregida: true, origen: "ia", detalle: `corregida: "${original}" → "${normalizada}"` };
}

/**
 * ¿El cliente recoge en una OFICINA de Inter Rapidisimo o Coordinadora?
 * Esos pedidos los sube una persona (se elige la oficina en Dropi), asi que
 * la subida automatica no los toca. Se mira la direccion y las referencias.
 * Devuelve el nombre de la transportadora o null.
 */
export function recogeEnOficina(...textos) {
  const t = textos
    .map((x) => normalizarTextoDir(x).replace(/[^a-z0-9]+/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  // nombres inequivocos: con solo aparecer ya es oficina
  const interLargo = /\binter ?rapidisimos?\b|\binter ?rapidismo\b|\binterrapidisimo\b/;
  const coord = /\bcoordinadora\b/;
  // "inter" corto: solo junto a una palabra de oficina/recogida (no "interior")
  const palabraOficina = String.raw`(oficina|ofic|ofi|of|sede|punto|agencia|recoger|recoge|recogida|reclamar|reclama|retirar|retira|retiro|reclamo)`;
  const interCorto = new RegExp(String.raw`\b${palabraOficina}\b(?: \w+){0,3} \binter\b|\binter\b(?: \w+){0,2} \b${palabraOficina}\b`);
  if (interLargo.test(t) || interCorto.test(t)) return "Inter Rapidísimo";
  if (coord.test(t)) return "Coordinadora";
  return null;
}

/**
 * Direccion que se manda a Dropi: la direccion, coma y las referencias del
 * pedido (ahi suelen venir el barrio y los puntos de referencia). No repite
 * las referencias si ya estan dentro de la direccion.
 */
export function direccionConReferencias(direccion, referencias, max = 250) {
  const dir = String(direccion ?? "").replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "");
  const ref = String(referencias ?? "").replace(/\s+/g, " ").trim().replace(/^[,.\s-]+|[,.\s-]+$/g, "");
  if (!ref || !/[a-z0-9]/i.test(normalizarTextoDir(ref))) return dir;
  const n = (t) => normalizarTextoDir(t).replace(/[^a-z0-9]+/g, " ").trim();
  if (n(dir).includes(n(ref))) return dir;
  return `${dir}, ${ref}`.slice(0, max).trim();
}
