// Validador de direcciones PROPIO (no el de LucidSales).
//
//   1) Formato colombiano con reglas fijas (direccionColombia.js): via,
//      manzana, oficinas de transportadora, rural / sin nomenclatura.
//      Si el numero viene pegado ("Cra 21 #1212") se arman candidatos
//      ("Cra 21 # 12-12") y el mapa decide cual existe.
//   2) Mapa: Google Geocoding confirma que la direccion existe EN ESA CIUDAD
//      y con que precision (placa exacta, solo la calle, solo el barrio...).
//
// La API key de Google se guarda desde el panel en config/mapas.json (600) o
// sale de GOOGLE_MAPS_KEY. Nunca se devuelve completa. Las consultas se
// cachean en memoria para no gastar cuota con el mismo pedido.
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";
import { normalizarTextoDir, parsearDireccion, recogeEnOficina, validarDireccion } from "./direccionColombia.js";
import { escribirJsonSeguro, leerJsonSeguro } from "./secretos.js";

const GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
const MAX_CACHE = 500;

const sinTildes = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(d c|dc|distrito capital|distrito turistico y cultural|distrito especial)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** "Bogota D.C." ~ "Bogotá", "Cartagena de Indias" ~ "Cartagena". */
export function mismoLugar(a, b) {
  const x = sinTildes(a);
  const y = sinTildes(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/**
 * Departamentos con nombres distintos entre Google y LucidSales:
 *   Google trata Bogota D.C. como departamento propio ("Bogotá"); LucidSales
 *   la tiene en Cundinamarca. San Andres: "Archipiélago de San Andrés,
 *   Providencia y Santa Catalina" vs "San Andrés y Providencia".
 */
function canonDepartamento(d) {
  const t = sinTildes(d).replace(/^archipielago de /, "");
  if (/^bogota\b/.test(t)) return "cundinamarca";
  if (/^san andres\b/.test(t)) return "san andres";
  return t;
}

export function mismoDepartamento(a, b) {
  const x = canonDepartamento(a);
  const y = canonDepartamento(b);
  if (!x || !y) return false;
  return x === y || mismoLugar(x, y);
}

function enmascarar(k) {
  const s = String(k ?? "");
  if (!s) return "";
  return s.length <= 10 ? `…${s.slice(-2)}` : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Candidatos cuando el numero viene pegado: "Cra 21 #1212" -> 12-12;
 * "Cl 5 #123" -> 1-23 y 12-3 (el mapa decide). Solo si las reglas no la
 * entienden tal cual.
 */
export function candidatosNumeroPegado(direccion) {
  const t = String(direccion ?? "").trim();
  // con "#" ("Cra 21 #1212") o sin el ("Calle 7A 1375": via y luego 3-4 digitos)
  let m = /^(.*?#\s*)(\d{3,4})([a-z]?)\b(.*)$/i.exec(t);
  if (!m) {
    const s = /^(.*?\b\d{1,3}\s*[a-z]?(?:\s+bis)?)\s+(\d{3,4})([a-z]?)\b(.*)$/i.exec(t);
    if (s) m = [s[0], `${s[1]} # `, s[2], s[3], s[4]];
  }
  if (!m) return [];
  const [, antes, num, letra, resto] = m;
  // 4 digitos: lo normal es 2-2 (13-75); 1-3 (1-375) tambien existe
  const partes =
    num.length === 4
      ? [[num.slice(0, 2), num.slice(2)], [num.slice(0, 1), num.slice(1)]]
      : [[num.slice(0, 1), num.slice(1)], [num.slice(0, 2), num.slice(2)]];
  const salida = [];
  for (const [a, b] of partes) {
    const p = parsearDireccion(`${antes}${a}${letra}-${b}${resto}`);
    if (p) salida.push(p.normalizada);
  }
  return [...new Set(salida)];
}

/** Solo la calle y el numero ("Calle 7A # 13-75, Sobre la avenida" -> "Calle 7A # 13-75"). */
function soloCalle(dir) {
  const p = parsearDireccion(dir);
  return p ? `${p.tipoVia} ${p.via} # ${p.cruce}-${p.placa}` : String(dir ?? "");
}

/** "Calle 7A # 13-75" -> "7A#13-75" (para comparar lecturas). */
function claveNumeros(dir) {
  // Google escribe la letra de la via como volada: "Cl. 7ª" = Calle 7A
  const p = parsearDireccion(String(dir ?? "").replace(/ª/g, "a").replace(/[º°]/g, ""));
  return p ? `${p.via}#${p.cruce}-${p.placa}`.toLowerCase().replace(/\s+/g, "") : null;
}

/**
 * ¿Google leyo la direccion igual que este candidato? Su direccion formateada
 * empieza con la calle ("Cl. 7ª # 13-75, Puerto Lleras, Meta"): si los numeros
 * coinciden, Google confirma como se separa el numero pegado aunque no tenga
 * la placa en el mapa.
 */
export function googleLeyoIgual(formateada, candidato) {
  const calle = String(formateada ?? "").split(",")[0];
  const a = claveNumeros(calle);
  const b = claveNumeros(candidato);
  return Boolean(a && b && a === b);
}

/**
 * Lee la respuesta de Google y da un veredicto:
 *   exacta       la placa existe (ROOFTOP / interpolada) en la ciudad
 *   aproximada   Google solo ubica la calle, el barrio o el centro
 *   otra-ciudad  la encuentra pero en otro municipio/departamento
 *   no-encontrada
 */
export function evaluarGeocodificacion(respuesta, { ciudad = "", departamento = "" } = {}) {
  const estado = respuesta?.status;
  if (estado === "ZERO_RESULTS") return { veredicto: "no-encontrada", detalle: "Google no encontró esa dirección" };
  if (estado !== "OK") {
    const msg = respuesta?.error_message ? `: ${respuesta.error_message}` : "";
    throw new ErrorApi(
      estado === "REQUEST_DENIED" ? 400 : 502,
      estado === "REQUEST_DENIED"
        ? `Google rechazó la API key (habilita «Geocoding API» y revisa las restricciones)${msg}`
        : estado === "OVER_QUERY_LIMIT"
          ? "Se agotó la cuota de Google Maps por ahora"
          : `Google Maps respondió ${estado ?? "sin estado"}${msg}`,
    );
  }
  const r = respuesta.results?.[0];
  if (!r) return { veredicto: "no-encontrada", detalle: "Google no encontró esa dirección" };

  const comp = (tipo) => r.address_components?.find((c) => c.types?.includes(tipo))?.long_name ?? "";
  const municipio = comp("locality") || comp("administrative_area_level_2");
  const depto = comp("administrative_area_level_1");
  const tipos = r.types ?? [];
  const precisa = ["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry?.location_type);
  const esPlaca = tipos.some((t) => ["street_address", "premise", "subpremise"].includes(t));
  const base = {
    formateada: r.formatted_address ?? "",
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null,
    municipio,
    departamento: depto,
    precision: r.geometry?.location_type ?? null,
    tipos,
    parcial: Boolean(r.partial_match),
  };
  base.mapa = base.lat !== null ? `https://www.google.com/maps/search/?api=1&query=${base.lat},${base.lng}` : null;

  // la ciudad del pedido manda: si Google la ubica en otra, no sirve
  const ciudadOk = !ciudad || mismoLugar(municipio, ciudad) || mismoLugar(depto, ciudad);
  const deptoOk =
    !departamento || !depto || mismoDepartamento(depto, departamento) || mismoDepartamento(municipio, departamento);
  if (!ciudadOk || !deptoOk) {
    return {
      ...base,
      veredicto: "otra-ciudad",
      detalle: `Google la ubica en ${[municipio, depto].filter(Boolean).join(", ") || "otro lugar"}, no en ${[ciudad, departamento].filter(Boolean).join(", ")}`,
    };
  }
  if (precisa && esPlaca && !base.parcial) {
    return { ...base, veredicto: "exacta", detalle: `existe: ${base.formateada}` };
  }
  const que = tipos.includes("route")
    ? "solo la calle, no la placa"
    : tipos.some((t) => t.startsWith("sublocality") || t === "neighborhood")
      ? "solo el barrio"
      : tipos.includes("locality")
        ? "solo la ciudad"
        : "una ubicación aproximada";
  return { ...base, veredicto: "aproximada", detalle: `Google encontró ${que}${base.parcial ? " (coincidencia parcial)" : ""}: ${base.formateada}` };
}

const PESO = { exacta: 3, aproximada: 2, "otra-ciudad": 1, "no-encontrada": 0 };

/**
 * Ciudades donde Google Maps tiene las placas con detalle (capitales y areas
 * metropolitanas). En el resto (pueblos, municipios pequenos) el mapa suele
 * ubicar solo el pueblo, una calle o el barrio: ahi no se frena por el mapa.
 */
export const CIUDADES_PRINCIPALES = [
  "Bogota", "Medellin", "Cali", "Barranquilla", "Cartagena", "Cucuta", "Bucaramanga", "Pereira",
  "Santa Marta", "Ibague", "Villavicencio", "Manizales", "Pasto", "Neiva", "Armenia", "Monteria",
  "Valledupar", "Sincelejo", "Popayan", "Tunja", "Riohacha", "Florencia", "Quibdo", "Yopal",
  "Arauca", "San Andres", "Mocoa", "Leticia", "Inirida", "San Jose del Guaviare", "Mitu", "Puerto Carreno",
  // areas metropolitanas y ciudades grandes que no son capital
  "Soacha", "Bello", "Itagui", "Envigado", "Sabaneta", "La Estrella", "Rionegro", "Soledad", "Malambo",
  "Palmira", "Jamundi", "Yumbo", "Buenaventura", "Tulua", "Cartago", "Floridablanca", "Giron",
  "Piedecuesta", "Dosquebradas", "Barrancabermeja", "Chia", "Zipaquira", "Facatativa", "Fusagasuga",
  "Mosquera", "Madrid", "Funza", "Girardot", "Apartado", "Turbo", "Maicao", "Ipiales", "Duitama",
  "Sogamoso", "Cienaga", "Magangue", "Los Patios", "Villa del Rosario",
];

export function esCiudadPrincipal(ciudad) {
  return CIUDADES_PRINCIPALES.some((c) => mismoLugar(ciudad, c));
}

/**
 * ¿Lo que va despues de la placa es un barrio/complemento de verdad? No
 * cuentan el nombre de la ciudad o el departamento ni palabras sueltas como
 * "calle" o "Colombia" ("Cra 5 # 4-98, calle Bogotá" no trae barrio).
 */
export function restoEsBarrio(resto, lugares = []) {
  let t = sinTildes(resto);
  for (const l of lugares) {
    const x = sinTildes(l);
    if (x) t = t.replace(new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  }
  t = t.replace(/\b(calle|carrera|cra|cl|colombia|ciudad|municipio|barrio)\b/g, " ").replace(/\s+/g, " ").trim();
  return (t.match(/[a-z]/g) ?? []).length >= 3;
}

/**
 * Calificacion de 0 a 100 de una direccion ya validada:
 *   formato  hasta 40  (nomenclatura valida)
 *   mapa     hasta 50  (placa exacta 50 · calle 25 · barrio 10 · ciudad 0;
 *                       coincidencia parcial -10; otra ciudad o no
 *                       encontrada 0)
 *   barrio   hasta 10  (trae barrio o referencia)
 * `verificada` = se pudo preguntar al mapa (sin key o con error, la nota
 * solo cubre formato y barrio).
 */
export function calificar({ formato, mapa, tieneBarrio }) {
  const partes = [];
  const fmt = formato?.ok ? 40 : 0;
  partes.push({ concepto: "formato", puntos: fmt, max: 40 });
  // sin cobertura (pueblo sin placas en el mapa) cuenta como no verificada
  const verificada = Boolean(mapa && mapa.veredicto !== "error" && !mapa.sinCobertura);
  let m = 0;
  if (verificada && formato?.ok) {
    if (mapa.veredicto === "exacta") m = 50;
    else if (mapa.veredicto === "aproximada") {
      const t = mapa.tipos ?? [];
      m = t.includes("route") ? 25 : t.some((x) => x.startsWith("sublocality") || x === "neighborhood") ? 10 : 0;
      if (mapa.parcial) m = Math.max(0, m - 10);
    }
  }
  partes.push({ concepto: "mapa", puntos: m, max: 50 });
  const b = formato?.ok && tieneBarrio ? 10 : 0;
  partes.push({ concepto: "barrio", puntos: b, max: 10 });
  // en otra ciudad no sirve aunque el formato este bien
  const total = verificada && mapa?.veredicto === "otra-ciudad" ? Math.min(10, fmt + b) : fmt + m + b;
  return { puntos: total, verificada, partes };
}

export function crearValidadorDireccion({ ruta, config = {}, fetcher = globalThis.fetch, log = console } = {}) {
  const delEnv = String(config.GOOGLE_MAPS_KEY ?? "");
  let apiKey = delEnv;
  const cache = new Map();

  function leerDisco() {
    if (!ruta) return null;
    try {
      return leerJsonSeguro(ruta);
    } catch {
      return null;
    }
  }
  const enDisco = leerDisco();
  if (enDisco?.apiKey) apiKey = enDisco.apiKey;

  function escribir(datos) {
    escribirJsonSeguro(ruta, { ...datos, actualizado: new Date().toISOString() });
    try {
      fs.chmodSync(ruta, 0o600);
    } catch {
      /* Windows */
    }
  }

  function estado() {
    return {
      configurada: Boolean(apiKey),
      apiKeyVista: enmascarar(apiKey),
      origen: apiKey ? (leerDisco()?.apiKey ? "panel" : ".env") : null,
      proveedor: "google",
    };
  }

  function guardar({ apiKey: nueva } = {}) {
    const k = String(nueva ?? "").trim();
    if (k.length < 20 || /\s/.test(k)) throw new ErrorApi(400, "La API key de Google no parece válida");
    if (!ruta) throw new ErrorApi(500, "No hay dónde guardar la configuración de mapas");
    escribir({ apiKey: k });
    apiKey = k;
    cache.clear();
    return estado();
  }

  function borrar() {
    if (ruta) fs.rmSync(ruta, { force: true });
    apiKey = delEnv;
    cache.clear();
    return estado();
  }

  async function geocodificar(texto, { ciudad, departamento }) {
    if (!apiKey) throw new ErrorApi(400, "Falta la API key de Google Maps (Ajustes → Verificación de direcciones)");
    const clave = sinTildes(`${texto}|${ciudad}|${departamento}`);
    if (cache.has(clave)) return cache.get(clave);
    const q = new URLSearchParams({
      address: [texto, ciudad, departamento, "Colombia"].filter(Boolean).join(", "),
      components: "country:CO",
      region: "co",
      language: "es",
      key: apiKey,
    });
    let datos;
    try {
      const r = await fetcher(`${GEOCODE}?${q}`, { signal: AbortSignal.timeout(15000) });
      datos = await r.json();
    } catch (e) {
      throw new ErrorApi(504, `Google Maps no respondió: ${e?.message ?? e}`);
    }
    const ev = evaluarGeocodificacion(datos, { ciudad, departamento });
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(clave, ev);
    return ev;
  }

  /** Prueba la key con una direccion conocida. */
  async function probar(nueva) {
    const anterior = apiKey;
    if (nueva) apiKey = String(nueva).trim();
    try {
      const r = await geocodificar("Cra 7 # 11-10", { ciudad: "Bogotá", departamento: "Cundinamarca" });
      return { ok: true, msg: `La API key funciona (${r.formateada || r.veredicto})` };
    } catch (e) {
      return { ok: false, msg: e?.message ?? String(e) };
    } finally {
      apiKey = anterior;
      cache.clear();
    }
  }

  /**
   * Valida la direccion de un pedido.
   * -> { veredicto: "valida"|"revisar"|"invalida"|"oficina", formato, mapa, sugerida, avisos[] }
   */
  async function validar({ direccion, referencias = "", ciudad = "", departamento = "" } = {}) {
    const original = String(direccion ?? "").trim();
    const avisos = [];
    const oficina = recogeEnOficina(original, referencias);
    if (oficina) {
      return {
        veredicto: "oficina",
        original,
        formato: { ok: true, detalle: `recoge en oficina de ${oficina}: no lleva calle` },
        mapa: null,
        sugerida: null,
        avisos,
        resumen: `Recoge en oficina de ${oficina}: la oficina se elige en Dropi.`,
        calificacion: null,
      };
    }

    let formato = validarDireccion(original, null, { referencias });
    let candidatos = formato.ok ? [formato.normalizada] : candidatosNumeroPegado(original);
    if (!formato.ok && candidatos.length) {
      formato = {
        ...formato,
        detalle: `${formato.detalle}. El número parece pegado: se prueba ${candidatos.map((c) => `«${c}»`).join(" y ")}`,
      };
    }

    let mapa = null;
    let elegida = formato.ok ? formato.normalizada : null;
    let leido = null; // candidato cuyos numeros leyo Google igual
    if (apiKey) {
      // A Google se le pregunta SOLO la calle y el numero: referencias como
      // "sobre la avenida central" lo confunden y devuelve solo el pueblo.
      // Con numero pegado tambien va el texto original: asi se ve como lo
      // lee Google ("Calle 7A 1375" -> "Cl. 7ª # 13-75").
      const consultas = candidatos.length
        ? [...candidatos.map((c) => ({ texto: soloCalle(c), candidato: c })), { texto: original, candidato: null }]
        : [{ texto: soloCalle(formato.ok ? formato.normalizada : original), candidato: null }];
      const vistas = new Set();
      for (const q of consultas) {
        if (vistas.has(q.texto)) continue;
        vistas.add(q.texto);
        try {
          const r = await geocodificar(q.texto, { ciudad, departamento });
          if (!leido && candidatos.length && r.veredicto !== "otra-ciudad") {
            leido = candidatos.find((c) => googleLeyoIgual(r.formateada, c)) ?? null;
          }
          if (!mapa || PESO[r.veredicto] > PESO[mapa.veredicto]) {
            mapa = { ...r, consultada: q.texto };
            if (q.candidato) elegida = q.candidato;
          }
          if (r.veredicto === "exacta" && (!candidatos.length || leido || q.candidato)) break;
        } catch (e) {
          mapa = { veredicto: "error", detalle: e?.message ?? String(e) };
          log.warn?.("[direccion] Google Maps:", e?.message ?? e);
          break;
        }
      }
    } else {
      avisos.push("Sin API key de Google: solo se revisó el formato.");
    }

    // Numero pegado: vale el candidato que confirma Google (placa exacta o
    // misma lectura). Si Google no ayuda y son 4 cifras ("1375"), se toma la
    // lectura habitual 2-2 ("13-75") en pueblos; con 3 cifras no se adivina.
    if (!formato.ok && candidatos.length && mapa?.veredicto !== "error" && mapa?.veredicto !== "otra-ciudad") {
      const exacta = mapa?.veredicto === "exacta" && candidatos.includes(elegida) ? elegida : null;
      const numero = /(\d{3,4})[a-z]?\b/i.exec(original.split(/#/).pop() ?? "")?.[1] ?? /\b\d{1,3}\s*[a-z]?\s+(\d{4})\b/i.exec(original)?.[1];
      // solo en pueblos: en una ciudad principal Google si lo resuelve, y si no
      // lo hace es sospechoso
      const habitual =
        !exacta && !leido && String(numero ?? "").length === 4 && ciudad && !esCiudadPrincipal(ciudad) ? candidatos[0] : null;
      const final = exacta ?? leido ?? habitual;
      if (final) {
        elegida = final;
        formato = {
          ok: true,
          normalizada: final,
          corregida: true,
          origen: habitual ? "reglas" : "reglas+mapa",
          detalle: `número separado: se escribe como "${final}" (${
            exacta ? "Google confirma la placa" : leido ? "así la lee Google" : "lectura habitual de 4 cifras; confírmala si puedes"
          })`,
        };
        if (habitual) avisos.push(`El número venía pegado y se separó como ${final.split(",")[0]}: confírmalo si es posible.`);
      }
    }
    if (!formato.ok) {
      elegida = null;
    }

    // barrio: sin barrio ni referencia la transportadora la ubica peor
    const p = formato.ok ? parsearDireccion(formato.normalizada) : null;
    // manzana: el formato ya exige barrio; via: lo que va despues de la placa
    const tieneBarrio =
      formato.ok && (!p || restoEsBarrio(p.resto, [ciudad, departamento]) || Boolean(String(referencias ?? "").trim()));
    if (formato.ok && !tieneBarrio) {
      avisos.push("No trae barrio ni referencia: conviene pedírselo al cliente.");
    }
    // En un pueblo, que Google no tenga la placa no dice nada de la direccion,
    // y si la "encuentra" en otro municipio suele ser una direccion parecida
    // de otro lado (adivina): solo la placa exacta en el pueblo suma. Nada
    // de eso frena; se decide por el formato.
    if (
      mapa &&
      ciudad &&
      !esCiudadPrincipal(ciudad) &&
      ["aproximada", "no-encontrada", "otra-ciudad"].includes(mapa.veredicto)
    ) {
      mapa = {
        ...mapa,
        sinCobertura: true,
        detalle: `${mapa.detalle}. En ${ciudad} el mapa no tiene las calles con detalle: se valida por el formato`,
      };
    }
    const calificacion = calificar({ formato, mapa, tieneBarrio });

    let veredicto;
    if (!formato.ok) veredicto = "invalida";
    else if (!mapa || mapa.veredicto === "error") veredicto = "revisar";
    else if (mapa.sinCobertura) veredicto = "revisar";
    else if (mapa.veredicto === "exacta") veredicto = "valida";
    else if (mapa.veredicto === "otra-ciudad" || mapa.veredicto === "no-encontrada") veredicto = "invalida";
    else veredicto = "revisar";

    const sugerida =
      formato.ok && formato.normalizada && normalizarTextoDir(formato.normalizada) !== normalizarTextoDir(original)
        ? formato.normalizada
        : null;

    const resumen =
      veredicto === "valida"
        ? "La dirección tiene buen formato y existe en el mapa."
        : veredicto === "invalida"
          ? !formato.ok
            ? `Formato no válido: ${formato.detalle}`
            : `No se ubica en ${ciudad || "la ciudad del pedido"}: ${mapa?.detalle ?? ""}`
          : mapa?.sinCobertura
            ? `Formato válido. En ${ciudad} Google Maps no tiene las calles con detalle, así que el mapa no la puede confirmar; se acepta por el formato.`
            : mapa?.veredicto === "error"
            ? `Formato válido, pero no se pudo consultar el mapa: ${mapa.detalle}`
            : !mapa
              ? "Formato válido (sin verificar en el mapa)."
              : `Formato válido, pero ${mapa.detalle}. Revísala antes de enviar.`;

    return { veredicto, original, formato, mapa, sugerida, avisos, resumen, calificacion };
  }

  return { estado, guardar, borrar, probar, validar };
}
