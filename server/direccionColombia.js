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
  // tambien como lo escriben los clientes: "Krra", "Karrera", "Carera"...
  [/^(carrera|cra|kra|kr|cr|carr|crr|car|krra|krr|crra|karrera|karera|carera|carreara|carrrera|krera|kerera|kerrera|crera|carrea|carrra|karrea)\b/, "Cra"],
  [/^(calle|cll|cl|call|clle|cale|kalle|kll)\b/, "Calle"],
  [/^(diagonal|diag|dg|dgl|diagnal)\b/, "Diagonal"],
  [/^(transversal|transv|trans|tv|tr|tranv|tranversal|trv)\b/, "Transversal"],
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
const NUM = String.raw`(\d{1,3})\s*([a-z])?(?:\s*(bis))?(?:\s*([a-z]))?(?:\s+(sur|este|oeste|norte))?`;
const SEP_NUM = String.raw`\s*(?:#|no\.?|n[°º]|nro\.?|numero|num\.?)\s*`;
const RE_DIR = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + SEP_NUM + NUM + String.raw`\s*[-–]\s*(\d{1,3}(?:[a-z](?![a-z\d]))?)(?:\s+(sur|este|oeste|norte))?\b\s*[,.]?\s*(.*)$`,
);
// lo mismo SIN guion entre cruce y placa ("Cra 91a # 128 f 14", "Cl 10 # 5 20"):
// muy comun; la placa son 1-3 digitos sueltos despues del cruce
// Sin "#" ("Car 5, 4-98", "Cra 5 4-98"): coma o espacio entre via y cruce,
// pero SOLO con guion en la placa (si no, los numeros serian ambiguos)
const RE_DIR_SIN_NUMERAL = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + String.raw`\s*(?:,\s*|\s+)` + NUM + String.raw`\s*[-–]\s*(\d{1,3}(?:[a-z](?![a-z\d]))?)(?:\s+(sur|este|oeste|norte))?\b\s*[,.]?\s*(.*)$`,
);
// Solo espacios ("Calle 40 AA Sur 36 30"): TRES grupos de numeros despues
// del tipo de via = via, cruce y placa (con dos grupos seria ambiguo)
const RE_DIR_ESPACIOS = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + String.raw`\s+` + NUM + String.raw`\s+(\d{1,3})(?:\s+(sur|este|oeste|norte))?\b(?![a-z\d])\s*[,.]?\s*(.*)$`,
);
const RE_DIR_SIN_GUION = new RegExp(
  String.raw`^(.+?)\.?\s*` + NUM + SEP_NUM + NUM + String.raw`\s+(\d{1,3})(?:\s+(sur|este|oeste|norte))?\b(?![a-z\d])\s*[,.]?\s*(.*)$`,
);

function armarNumero(n, letra, bis, letra2, cardinal) {
  let s = String(n);
  if (letra) s += letra.toUpperCase();
  if (bis) s += " Bis";
  // "4 Bis B" lleva espacio; dos letras seguidas ("40 AA") van juntas
  if (letra2) s += bis ? ` ${letra2.toUpperCase()}` : letra2.toUpperCase();
  if (cardinal) s += ` ${cardinal[0].toUpperCase()}${cardinal.slice(1)}`;
  return s;
}

function capitalizarResto(r) {
  const t = String(r ?? "").trim().replace(/^[,.\s]+/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

// Palabras de tipo de via (las mismas de TIPOS) para reconocer dos vias seguidas
const TIPO_PALABRA = String.raw`(?:avenida\s+carrera|avenida\s+calle|carrera|cra|kra|kr|cr|carr|crr|car|krra|krr|crra|karrera|karera|carera|carreara|carrrera|krera|kerera|kerrera|crera|carrea|carrra|karrea|calle|cll|cl|call|clle|cale|kalle|kll|diagonal|diag|dg|dgl|diagnal|transversal|transv|trans|tv|tr|tranv|tranversal|trv|circular|circ|cq|cir|avenida|av|ak|ac)`;
// numero de via simple: 12, 12A, 12 A, 12 BB, 12 Bis, 12A Bis B, 12 Sur
const NUM_SIMPLE = String.raw`\d{1,3}(?:\s?(?!(?:con|de|del|el|la|no|esq|x|y)\b)[a-z]{1,2}(?![a-z]))?(?:\s?bis)?(?:\s?(?![xy]\b)[a-z](?![a-z]))?(?:\s+(?:sur|este|oeste|norte)\b)?`;

/**
 * Esquina + placa: "Calle 43 con Carrera 17, casa 17-15" = "Calle 43 # 17-15".
 * Solo si el numero de la casa empieza por el de la via que cruza (17 y 17-15).
 */
export function reescribirEsquinaConPlaca(direccion) {
  return String(direccion ?? "").trim().replace(
    /^([a-zA-Z.]+(?:\s+[a-zA-Z.]+)?\s+\d{1,3}\s*[a-zA-Z]?(?:\s+(?:bis|sur|este|oeste|norte))?)\s+(?:con|x|y)\s+([a-zA-Z.]+)\s+(\d{1,3}\s*[a-zA-Z]?)\s*[,.]?\s*(?:(?:(?:el\s+)?n[uú]mero\s+(?:de\s+(?:la\s+)?)?)?casa|cs|placa)?\s*(?:#|n[o°º]\.?)?\s*(\d{1,3}\s*[a-zA-Z]?)\s*[-–]\s*(?=\d)/i,
    (todo, via, tipoCruce, numCruce, numCasa) =>
      tipoViaCanonico(tipoCruce) && numCruce.replace(/\s+/g, "").toLowerCase() === numCasa.replace(/\s+/g, "").toLowerCase()
        ? `${via} # ${numCasa}-`
        : todo,
  );
}

/**
 * "Cra 12 calle 12-12" / "Cra 12 con calle 12 - 12" / "Cra 12 con Cl 12 # 12":
 * la via que cruza escrita con su tipo en vez de "#". Se reescribe como
 * "Cra 12 # 12-12". Los numeros no cambian.
 */
export function reescribirCruceConVia(direccion) {
  const re = new RegExp(
    String.raw`(^|[\s,])(` + TIPO_PALABRA + String.raw`)\.?\s*(` + NUM_SIMPLE + String.raw`)\s*(?:,\s*)?(?:(?:con|y|x|esquina|esq\.?)\s+)?` +
      TIPO_PALABRA + String.raw`\.?\s*(?:#|no\.?|n[°º]|nro\.?|numero)?\s*(` + NUM_SIMPLE + String.raw`)\s*(?:[-–]|#|\bno\.?\s*|\s)\s*(\d{1,3})(?![\d])`,
    "i",
  );
  return String(direccion ?? "").replace(re, (_m, pre, tipo, via, cruce, placa) => `${pre}${tipo} ${via.trim()} # ${cruce.trim()}-${placa}`);
}

/**
 * Reconoce la direccion con reglas fijas. Devuelve {tipoVia, via, cruce,
 * placa, resto, normalizada} o null si no tiene el formato.
 */
export function parsearDireccion(direccion) {
  direccion = reescribirCruceConVia(reescribirEsquinaConPlaca(direccion));
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

function parsearDesdeElInicio(original) {
  const direccion = String(original ?? "")
    // "78Asur" = 78A Sur ("4 Oeste" no es la letra O + "este")
    .replace(/(\d\s*[a-zA-Z]??)(oeste|norte|sur|este)\b/gi, "$1 $2")
    // letra del cruce pegada a la placa tambien despues de "No"/"número":
    // "número 50f34" = número 50F 34
    .replace(/((?:\bn[o°º]\.?|\bnro\.?|\bn[uú]mero|\bnum\.?)\s*\d{1,3}\s*[a-zA-Z])(\d{1,3})\b/i, "$1 $2")
    // letra de la via separada con punto: "Calle 9.a No. 14-47" = Calle 9A # 14-47
    .replace(/^([a-zA-Z.]+(?:\s+[a-zA-Z.]+)?\s+\d{1,3})\s*\.\s*([a-zA-Z])(?![a-zA-Z\d])/i, "$1$2")
    // letra de la via separada con guion: "Carrera 3-D #50-130" = Cra 3D # 50-130
    .replace(/^([a-zA-Z.]+(?:\s+[a-zA-Z.]+)?\s+\d{1,3})\s*[-–]\s*([a-zA-Z])(?![a-zA-Z\d])(?=\s*(?:#|\bn[o°º]\.?|\bnro\.?|\bn[uú]mero|\bnum\.?))/i, "$1$2")
    // "casa" en lugar del numeral: "Carrera 1 Casa 8-59" = Cra 1 # 8-59
    .replace(/^([a-zA-Z.]+(?:\s+[a-zA-Z.]+)?\s+\d{1,3}\s*[a-zA-Z]?(?:\s+(?:bis|sur|este|oeste|norte))?)\s+(?:casa|csa|cs)\.?\s*(?:n[o°º]\.?\s*)?(?=\d{1,3}\s*[a-zA-Z]?\s*[-–]\s*\d)/i, "$1 # ")
    // letra del cruce separada con guion: "# 11-B-13" / "# 11 - b - 13" = # 11B-13
    .replace(/((?:#|\bn[o°º]\.?|\bnro\.?|\bn[uú]mero|\bnum\.?)\s*\d{1,3})\s*[-–]\s*([a-zA-Z])\s*[-–]\s*(\d{1,3})\b/i, "$1$2-$3")
    // punto en vez de guion entre cruce y placa: "# 23.47" = # 23-47
    .replace(/((?:#|\bn[o°º]\.?|\bnro\.?|\bn[uú]mero|\bnum\.?)\s*\d{1,3}\s*[a-zA-Z]?)\s*\.\s*(\d{1,3})\b/i, "$1-$2")
    // la placa escrita como "casa": "Cra 12 # 21 casa 21" = Cra 12 # 21-21
    .replace(/((?:#|\bn[o°º]\.?|\bnro\.?|\bn[uú]mero|\bnum\.?)\s*\d{1,3}\s*[a-zA-Z]?)\s+(?:casa|csa|cs)\.?\s*(?:n[o°º]\.?\s*)?(\d{1,3})\b(?!\s*[-–]\s*\d)/i, "$1-$2");
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
  const soloEspacios = !m;
  if (!m) m = t.match(RE_DIR_ESPACIOS);
  if (!m) return viaConNombre(direccion);
  const tipoVia = tipoViaCanonico(m[1]);
  if (!tipoVia) return null;
  // el "tipo" no puede traer texto de mas ("frente a la cra" no es un tipo)
  if (normalizarTextoDir(m[1]).split(" ").length > 3) return null;
  // ni otra frase antes de una coma ("Calle Real, Cra 5": la via es la Cra)
  if (/,/.test(m[1])) return null;
  const via = armarNumero(m[2], m[3], m[4], m[5], m[6]);
  const cruce = armarNumero(m[7], m[8], m[9], m[10], m[11]);
  const placa = String(m[12]).toUpperCase() + (m[13] ? ` ${m[13][0].toUpperCase()}${m[13].slice(1)}` : "");
  // el resto (complemento/barrio) se conserva con su texto original (sin
  // guion no hay donde cortar el original: se usa el del texto normalizado)
  const resto = capitalizarResto(
    sinGuion || sinNumeral
      ? restoConMismaRegla(String(direccion ?? ""), soloEspacios ? RE_DIR_ESPACIOS : sinNumeral ? RE_DIR_SIN_NUMERAL : RE_DIR_SIN_GUION) ?? m[14]
      : restoOriginal(String(direccion ?? "")),
  );
  const normalizada = `${tipoVia} ${via} # ${cruce}-${placa}${resto ? `, ${resto}` : ""}`;
  return { tipoVia, via, cruce, placa, resto, normalizada, sinGuion };
}

/**
 * Via con NOMBRE en vez de numero: "Calle Colombia # 12-34", "Avenida Boyacá
 * # 12-34". Exige "#" (o No.) y guion: el nombre son 1 a 4 palabras sin
 * numeros y sin otro tipo de via.
 */
const RE_VIA_NOMBRE = new RegExp(
  String.raw`^(` + TIPO_PALABRA + String.raw`)\.?\s+([a-zñ][a-zñ ]{1,40}?)\s*(?:#|\bno\.?|n[°º]|\bnro\.?|\bnumero\b)\s*(\d{1,3})\s*([a-z])?(?:\s*(bis))?\s*[-–]\s*(\d{1,3})(?:\s+(sur|este|oeste|norte))?\b\s*[,.]?\s*(.*)$`,
);
function viaConNombre(original) {
  const texto = String(original ?? "").replace(/\s+/g, " ").trim();
  const t = normalizarTextoDir(texto);
  const m = t.match(RE_VIA_NOMBRE);
  if (!m) return null;
  const tipoVia = tipoViaCanonico(m[1]);
  const nombreBajo = m[2].trim();
  if (!tipoVia || nombreBajo.split(" ").length > 4) return null;
  if (new RegExp(String.raw`\b` + TIPO_PALABRA + String.raw`\b|\b(con|frente|lado|cerca|barrio|casa|apto|manzana)\b`).test(nombreBajo)) return null;
  // el nombre con sus tildes y mayusculas del original (mismo largo en minusculas)
  const desde = t.indexOf(nombreBajo, m[1].length);
  const nombre = texto
    .slice(desde, desde + nombreBajo.length)
    .split(" ")
    .map((w) => (w.length > 3 || /^(san|sur)$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
  const via = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const cruce = armarNumero(m[3], m[4], m[5]);
  const placa = String(m[6]) + (m[7] ? ` ${m[7][0].toUpperCase()}${m[7].slice(1)}` : "");
  const resto = capitalizarResto(texto.slice(texto.length - m[8].length));
  const normalizada = `${tipoVia} ${via} # ${cruce}-${placa}${resto ? `, ${resto}` : ""}`;
  return { tipoVia, via, cruce, placa, resto, normalizada, sinGuion: false, viaNombre: true };
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
  // minusculas y sin tildes, letra por letra (mismo largo que el original)
  const SIN = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n", à: "a", è: "e", ì: "i", ò: "o", ù: "u" };
  const bajo = orig.toLowerCase().replace(/[áéíóúüñàèìòù]/g, (c) => SIN[c] ?? c);
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
  const m = t.slice(desde).match(/[-–]\s*\d{1,3}(?:[a-z](?![a-z\d]))?(\s+(sur|este|oeste|norte)\b)?/i);
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
    const limpio = (x) => normalizarTextoDir(x).replace(/\b(sur|este|oeste|norte)\b/g, "").replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
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
/** Palabras de conjunto/urbanizacion (para "Casa 12" sin manzana). */
const CONJUNTO = /\b(conjunto|conj|urbanizacion|urb|villas?|condominio|residencial|residencias|ciudadela|parcelacion|agrupacion|multifamiliar|unidad|etapa|portal|reserva|altos|jardines)\b/;
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

/** Arma "Smz 7 Mz B Cs 12" con las partes presentes (casa y lote en el orden del cliente). */
function armarManzana(p, orden = null) {
  const claves = ["supermanzana", "manzana", "casa", "lote"];
  if (orden && p.casa && p.lote && orden.lote < orden.casa) claves.splice(2, 2, "lote", "casa");
  return claves
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
  const orden = {};
  let resto = original.normalize("NFC");
  for (const k of ["supermanzana", "manzana", "casa", "lote"]) {
    const m = t.match(PARTES_MZ[k]);
    if (!m) continue;
    partes[k] = m[1];
    orden[k] = m.index;
    // se quita del texto original la misma porcion (mismo largo: NFD no cambia
    // la longitud de letras sin tilde; con tildes se usa el texto normalizado)
    const desde = normalizarTextoDir(resto).indexOf(m[0]);
    if (desde >= 0) {
      // se colapsan los espacios en cada paso para que las posiciones del
      // texto original y del normalizado sigan alineadas
      resto = `${resto.slice(0, desde)} ${resto.slice(desde + m[0].length)}`.replace(/\s+/g, " ").trim();
    }
  }
  if (!(partes.casa || partes.lote)) return null;
  const barrio = limpiarBarrio(capitalizarResto(resto));
  // sin manzana: casa/lote dentro de un conjunto o urbanizacion con nombre
  // ("Villas de Vizcaya, Lote 5 Casa 49"). Hace falta el nombre del sitio y
  // numeros de verdad; con solo "casa" el nombre debe ser de un conjunto.
  if (!partes.manzana) {
    const numerico = (v) => /^\d{1,4}[a-z]?$/i.test(String(v ?? ""));
    if (!barrio) return null;
    if (SIN_NOMENCLATURA.test(normalizarTextoDir(barrio))) return null;
    const conLote = partes.lote && numerico(partes.lote) && (!partes.casa || numerico(partes.casa));
    const soloCasa = !partes.lote && numerico(partes.casa) && CONJUNTO.test(normalizarTextoDir(barrio));
    if (!conLote && !soloCasa) return null;
  }
  const base = armarManzana(partes, orden);
  return { partes, barrio, normalizada: barrio ? `${base}, ${barrio}` : base };
}

/**
 * Valida la direccion del pedido. `ia` es lo que propuso la IA (puede faltar):
 *   { esNomenclatura, tipoVia, via, cruce, placa, complemento, barrio, motivo }
 * Devuelve { ok, normalizada, corregida, origen, detalle }.
 */
export function validarDireccion(direccion, ia = null, { referencias = "", confirmadaEnChat = "" } = {}) {
  const r = validarDireccionInterna(direccion, ia, true, referencias, confirmadaEnChat);
  // si se prefirio la IA para una direccion sin guion y no paso, vale la
  // lectura de las reglas (que ya era valida)
  if (!r.ok && ia && parsearDireccion(direccion)?.sinGuion) return validarDireccionInterna(direccion, null, false, referencias, confirmadaEnChat);
  return r;
}

function validarDireccionInterna(direccion, ia, preferirIA, referencias = "", confirmadaEnChat = "") {
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
  const parteNum = /^\d{1,3}[A-Za-z]?( Bis)?( [A-Za-z])?( (Sur|Este|Oeste|Norte))?$/i;
  if (!tipoVia || !parteNum.test(via) || !parteNum.test(cruce) || !/^\d{1,3}[A-Za-z]?( (Sur|Este|Oeste|Norte))?$/i.test(placa)) {
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
  // ...o estar en la direccion que el cliente confirmo en el chat (el resumen
  // dice "Calle 10 # 10-27" y el pedido quedo "Ce 10#10-27"), con los mismos
  // numeros de via, cruce y placa
  const delChat = !tipoEscrito && confirmadaEnChat ? parsearDireccion(confirmadaEnChat) : null;
  const tipoDelChat =
    delChat?.tipoVia === tipoVia &&
    digitosDireccion(`${delChat.via} ${delChat.cruce} ${delChat.placa}`) === digitosDireccion(`${via} ${cruce} ${placa}`);
  if (!tipoEscrito && !tipoDelChat) {
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
    detalle: `corregida: "${original}" → "${normalizada}"${tipoDelChat ? " (tipo de vía según la dirección que el cliente confirmó en el chat)" : ""}`,
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
