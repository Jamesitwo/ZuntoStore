// ¿La direccion del cliente es una OFICINA de Interrapidisimo?
//
// Hay clientes que dan la direccion de una oficina de Inter sin decir
// "oficina": si se manda por Coordinadora a esa direccion, se devuelve. Aqui
// se compara la direccion con las oficinas del municipio (listado de Inter o
// la lista que muestra Dropi) por TIPO DE VIA + NUMEROS, sin importar como
// esten escritas:
//
//   cliente  "Calle 30A # 65B-59, Centro"         -> calle|30a|65b|59
//   Inter    "OF. PRINC CL 30 A 65 B 59"           -> calle|30a|65b|59
//   Dropi    "PTO/MEDELLIN/ANT/COL/CL 30 A 65 B 59 R.O" -> calle|30a|65b|59
import { normalizarTextoDir, parsearDireccion, tipoViaCanonico } from "./direccionColombia.js";

/** Tipo de via para comparar: las avenidas-calle/carrera cuentan como calle/carrera. */
function tipoComparable(t) {
  const c = tipoViaCanonico(t);
  if (!c) return null;
  if (c === "Av. Calle") return "calle";
  if (c === "Av. Carrera") return "cra";
  return c.toLowerCase();
}

// abreviaturas que usan Inter y Dropi y que tipoViaCanonico no trae
const TIPO_EXTRA = { cll: "calle", cl: "calle", kr: "cra", kra: "cra", ak: "cra", ac: "calle", tv: "transversal", dg: "diagonal" };
const IGNORAR = new Set(["sur", "este", "norte", "oeste", "r", "o", "ro", "lc", "local", "of", "ofi", "princ", "pto", "no", "n"]);

/**
 * Clave de comparacion "tipo|via|cruce|placa" de un texto de direccion
 * cualquiera (o null si no se puede leer).
 */
export function claveDireccion(texto) {
  let t = String(texto ?? "");
  // formato de Dropi/Inter "PTO/MEDELLIN/ANT/COL/CL 30 A 65 B 59 R.O"
  if (t.includes("/")) t = t.split("/").pop();
  t = normalizarTextoDir(t)
    .replace(/[#\-.,:;()]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = t.split(" ");
  // el tipo de via: el primer token que lo sea (asi "oficina inter cl 30..." sirve)
  let i = tokens.findIndex((tok, k) => TIPO_EXTRA[tok] || (tipoComparable(tok) && /^\d/.test(tokens[k + 1] ?? "")));
  if (i < 0) return null;
  const tipo = TIPO_EXTRA[tokens[i]] ?? tipoComparable(tokens[i]);
  const grupos = [];
  for (i = i + 1; i < tokens.length && grupos.length <= 3; i++) {
    const tok = tokens[i];
    if (/^\d+$/.test(tok)) {
      if (grupos.length === 3) break;
      grupos.push(tok.replace(/^0+(?=\d)/, ""));
    } else if (grupos.length && (/^[a-z]{1,2}$/.test(tok) || tok === "bis") && !IGNORAR.has(tok)) {
      grupos[grupos.length - 1] += tok;
    } else if (!IGNORAR.has(tok) && grupos.length === 3) {
      break;
    }
  }
  if (grupos.length < 3) return null;
  return `${tipo}|${grupos.join("|")}`;
}

/** Clave de la direccion del cliente (con las reglas de formato si se puede). */
export function claveCliente(direccion) {
  const p = parsearDireccion(direccion);
  if (p) {
    const tipo = tipoComparable(p.tipoVia);
    const limpio = (x) => normalizarTextoDir(x).replace(/\b(sur|este)\b/g, "").replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
    if (tipo) return `${tipo}|${limpio(p.via)}|${limpio(p.cruce)}|${limpio(p.placa)}`;
  }
  return claveDireccion(direccion);
}

/**
 * La oficina cuya direccion es la del cliente (o null).
 * `oficinas`: [{ nombre, direccion }] (Inter) o textos de Dropi.
 */
export function oficinaQueCoincide(direccion, oficinas = []) {
  const clave = claveCliente(direccion);
  if (!clave) return null;
  for (const o of oficinas) {
    const textos = typeof o === "string" ? [o] : [o?.direccion, o?.nombre];
    if (textos.some((x) => x && claveDireccion(x) === clave)) return o;
  }
  return null;
}
