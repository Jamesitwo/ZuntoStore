// Rentabilidad de las campanas de Meta Ads de las cuentas que conecta cada usuario.
//
//   ganancia por compra = ganancia por pedido ENTREGADO x efectividad de entrega
//   margen  = compras que atribuye Meta (omni_purchase) x ganancia por compra
//   neto    = margen - gasto de la campana en la ventana
//   ROI     = margen / gasto      CPA = gasto / compras
//
// Clasificacion: RENTABLE ROI >= 3 · AJUSTADA 1.5-3 · RIESGO < 1.5 con neto
// positivo · PERDIDA neto negativo · SINDATO producto sin ganancia promedio.
//
// Los datos crudos de Meta se cachean por dia en `dir` (una sola consulta al
// Graph API por ventana y por dia); las ganancias promedio viven en
// `dir/productos.json` y se pueden editar desde el panel sin tocar la cache.
import fs from "node:fs";
import path from "node:path";

const CLAVES_COMPRA = [
  "omni_purchase",
  "onsite_conversion.purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_purchase_cross_device",
];

export const CLASES = ["RENTABLE", "AJUSTADA", "RIESGO", "PERDIDA", "SINDATO"];
// Las unicas clases que disparan ALERTA (algo hay que decidir hoy). Las otras
// dos (RENTABLE / AJUSTADA) son informativas y no piden accion.
export const CLASES_ALERTA = ["PERDIDA", "RIESGO", "SINDATO"];
// Minimo de dias de datos de la campana antes de juzgarla: con 1 o 2 dias no
// hay muestra (y una campana pausada ya fue juzgada, tampoco alerta).
export const MIN_DIAS_ALERTA = 3;

/** Dinero en pesos, sin decimales ("$1.234.567"). */
export function dinero(v) {
  const n = Math.round(Math.abs(Number(v) || 0));
  return "$" + n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

export function leerJson(ruta, defecto) {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return typeof defecto === "function" ? defecto() : defecto;
  }
}

export function escribirJson(ruta, datos) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 1), "utf8");
}

// Las fechas van en hora de Colombia (no en la del servidor: en Railway el
// reloj es UTC y desde las 7 p. m. "hoy" ya seria manana).
const ZONA = process.env.TZ_ANUNCIOS || process.env.TZ_ASIGNACION || "America/Bogota";

export function hoy(ahora = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ahora);
  } catch {
    const p = (n) => String(n).padStart(2, "0");
    return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
  }
}

/** "2026-10-21" - 14 dias -> "2026-10-07" (aritmetica de calendario, sin zonas). */
export function restarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Tipo de un estado de envio para la efectividad de entrega:
 *   entregado · fallido (cancelado, devolucion, rechazado, guia anulada) · curso
 */
export function tipoEstadoEnvio(nombre) {
  const k = String(nombre ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (k === "entregado") return "entregado";
  if (/cancel|devoluc|devuelt|rechaz|anulad/.test(k)) return "fallido";
  return "curso";
}

const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "las", "el", "los", "y", "para", "con", "por", "en", "un", "una",
  "copia", "nuevo", "nueva", "campana", "replicante", "act", "test", "prueba",
]);

/** Producto que mas se parece al nombre de una campana (o null). */
export function sugerirProducto(nombreCampana, nombres) {
  const enCampana = new Set(normalizar(nombreCampana).split(" ").filter(Boolean));
  let mejor = null;
  let mejorPuntaje = 0;
  for (const nombre of nombres) {
    const fichas = normalizar(nombre)
      .split(" ")
      .filter((t) => t.length >= 3 && !PALABRAS_VACIAS.has(t));
    if (!fichas.length) continue;
    const comunes = fichas.filter((t) => enCampana.has(t));
    if (!comunes.some((t) => t.length >= 4)) continue;
    const puntaje = comunes.length / fichas.length + comunes.length * 0.01;
    if (puntaje > mejorPuntaje) {
      mejor = nombre;
      mejorPuntaje = puntaje;
    }
  }
  return mejorPuntaje >= 0.5 ? mejor : null;
}

/** "2026-09-23" + hoy -> dias incluyendo ambos extremos (15). */
function diasEntre(iso, hasta) {
  try {
    const a = new Date(`${iso}T00:00:00`);
    const b = new Date(`${hasta}T00:00:00`);
    return Math.round((b - a) / 86400000) + 1;
  } catch {
    return 1;
  }
}

/** Nombre de campana comparable (sin acentos ni signos). */
export function normalizar(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compras de un listado `actions` de Meta. Meta repite el mismo numero en
 * omni_purchase / onsite_app_purchase / onsite_conversion.purchase: por eso
 * se toma el PRIMERO de la lista y nunca se suma.
 */
export function comprasDe(actions) {
  if (!Array.isArray(actions)) return 0;
  const tipos = {};
  for (const a of actions) {
    const v = Number(a?.value);
    if (a?.action_type && !Number.isNaN(v)) tipos[a.action_type] = v;
  }
  for (const clave of CLAVES_COMPRA) {
    if (tipos[clave]) return Math.round(tipos[clave]);
  }
  const candidatos = Object.entries(tipos)
    .filter(([k]) => k.includes("purchase") && !k.includes("post_purchase"))
    .map(([, v]) => v);
  return candidatos.length ? Math.round(Math.max(...candidatos)) : 0;
}

export function roasDe(lista) {
  if (!Array.isArray(lista) || !lista.length) return 0;
  const propio = lista.find((x) => ["omni_purchase", "purchase"].includes(x?.action_type));
  const v = Number((propio ?? lista[0])?.value);
  return Number.isNaN(v) ? 0 : v;
}

function clasificar(margen, neto, roi) {
  if (margen === null || margen === undefined) return "SINDATO";
  if (neto < 0) return "PERDIDA";
  if (roi < 1.5) return "RIESGO";
  if (roi < 3) return "AJUSTADA";
  return "RENTABLE";
}

/** Accion sugerida concreta (misma redaccion que el dashboard original). */
function sugerir(f, ventanaDias, minDiasAlerta = MIN_DIAS_ALERTA) {
  const activa = f.estado === "ACTIVE";
  const perdidaDia = f.neto < 0 && f.diasMedidos ? Math.abs(f.neto) / f.diasMedidos : 0;
  // con menos dias de datos que el minimo no hay muestra: no se juzga nada
  // todavia (el alerta se enciende recien cuando alcanza el minimo)
  const nuevaDemasiado = activa && f.diasMedidos < minDiasAlerta;
  let titulo;
  let detalle;
  let prioridad;

  if (nuevaDemasiado) {
    titulo = "Esperar: todavia no se puede juzgar";
    detalle = `Lleva ${f.diasMedidos} dia(s) con datos (minimo ${minDiasAlerta} para opinar). Recien el dia ${minDiasAlerta} empieza a medirse.`;
    prioridad = 5;
  } else if (f.sinProducto) {
    titulo = "Vincular a un producto";
    detalle = `Gasto ${dinero(f.gasto)} y Meta le atribuye ${f.compras} compras, pero la campana no esta vinculada a ningun producto: no se puede medir.${f.sugerido ? ` Parece ser «${f.sugerido}».` : ""}`;
    prioridad = 1;
  } else if (f.clase === "SINDATO") {
    titulo = "Completar la ganancia del producto";
    detalle = `Meta le atribuye ${f.compras} compras pero ${f.faltaGanancia?.length ? `«${f.faltaGanancia.join("», «")}» no tiene` : "el producto no tiene"} ganancia cargada; sin ese dato no se puede medir.`;
    prioridad = 1;
  } else if (f.clase === "PERDIDA") {
    if (activa) {
      titulo = "Pausar hoy";
      detalle = `Deja de perder ~${dinero(perdidaDia)} por dia (${f.compras} compras no cubren ${dinero(f.gasto)} de anuncio).`;
      prioridad = 1;
    } else {
      titulo = "No reactivar todavia";
      detalle = `Sigue en rojo: gasto ${dinero(f.gasto)} por ${f.compras} compras. Cambia el anuncio antes de volver a prenderla.`;
      prioridad = 2;
    }
  } else if (f.clase === "RIESGO") {
    titulo = activa ? "Bajar presupuesto 30% y vigilar 3 dias" : "Mantener pausada";
    detalle = `ROI ${f.roi.toFixed(2)}x: apenas empatan, cualquier subida de CPA las deja en perdida.`;
    prioridad = 2;
  } else if (f.clase === "AJUSTADA") {
    titulo = activa ? "Mantener y vigilar" : "Revisar antes de reactivar";
    detalle = `ROI ${f.roi.toFixed(2)}x. Si baja de 1.5x en 7 dias, pausar.`;
    prioridad = 3;
  } else if (activa) {
    titulo = "Escalar: subir presupuesto +20%";
    detalle = `ROI ${f.roi.toFixed(2)}x y neto de ${dinero(f.neto)}; escalar aqui es donde mas plata entra.`;
    prioridad = 4;
  } else {
    titulo = "Reactivar (estaba funcionando)";
    detalle = `ROI ${f.roi.toFixed(2)}x con ${f.compras} compras antes de pausarla.`;
    prioridad = 3;
  }

  const extras = [];
  const desde = restarDias(hoy(), ventanaDias);
  if (!nuevaDemasiado && f.creada && f.creada >= desde) {
    extras.push(`campana nueva (${f.creada}, ${f.diasActivos} dias)`);
  }
  if (f.compartida) extras.push(`compartida entre ${f.productos.length} productos`);
  if (ventanaDias > 7 && activa && f.gasto > 0 && f.gasto7 === 0) {
    extras.push("sin gasto en los ultimos 7 dias");
  }
  if (extras.length) detalle = `${detalle} · ${extras.join(", ")}`;

  return { titulo, detalle, prioridad };
}

// ---------------------------------------------------------------- Meta (Graph)

function crearGraph({ ajustes, fetcher }) {
  async function get(ruta, params = {}, intentos = 3) {
    const cfg = ajustes();
    const token = String(cfg.token || "");
    const url = new URL(`https://graph.facebook.com/${cfg.version || "v25.0"}/${ruta}`);
    for (const [k, v] of Object.entries({ ...params, access_token: token })) {
      url.searchParams.set(k, String(v));
    }
    let ultimo = "";
    for (let i = 0; i < intentos; i++) {
      let datos;
      try {
        const res = await fetcher(url.toString(), { signal: AbortSignal.timeout(40000) });
        datos = await res.json();
      } catch (e) {
        ultimo = `error de red: ${e?.message ?? e}`;
        await dormir(400 * (i + 1));
        continue;
      }
      if (datos?.error) {
        ultimo = `API ${datos.error.code}: ${datos.error.message}`;
        // 1 pedidos, 4 desconectado, 17 demasiadas llamadas, 32 rate limit
        if ([1, 4, 17, 32, 613].includes(datos.error.code)) {
          await dormir(500 * (i + 1));
          continue;
        }
        throw new Error(ultimo);
      }
      return datos;
    }
    throw new Error(ultimo || "fallo la peticion a Meta");
  }

  async function paginar(ruta, params = {}) {
    const primero = await get(ruta, { ...params, limit: 100 });
    const salida = [...(primero.data ?? [])];
    let siguiente = primero.paging?.next;
    let vueltas = 0;
    while (siguiente && vueltas < 30) {
      let datos;
      try {
        const res = await fetcher(siguiente, { signal: AbortSignal.timeout(40000) });
        datos = await res.json();
      } catch (e) {
        throw new Error(`error de red: ${e?.message ?? e}`);
      }
      if (datos?.error) {
        throw new Error(`API ${datos.error.code}: ${datos.error.message}`);
      }
      salida.push(...(datos.data ?? []));
      siguiente = datos.paging?.next;
      vueltas++;
    }
    return salida;
  }

  return { get, paginar };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- modulo

/**
 * Analisis de rentabilidad de UN espacio (compartido o de un usuario).
 *
 * `lucid` es el cliente de LucidSales opcional: si viene, el espacio puede
 * traer la ganancia REAL de sus pedidos (ver «ganancias» mas abajo); sin el,
 * se sigue funcionando igual y esos endpoints responden 503.
 */
export function crearAnalisisAnuncios({ dir, rutaAjustes, fetcher = globalThis.fetch, lucid = null }) {
  fs.mkdirSync(dir, { recursive: true });

  const rutas = {
    productos: path.join(dir, "productos.json"),
    manual: path.join(dir, "manual.json"),
    snapshot: path.join(dir, "snapshot.json"),
    plan: path.join(dir, "plan.json"),
    ganancias: path.join(dir, "ganancias.json"),
    cache: (dias) => path.join(dir, `datos_${dias}d_${hoy()}.json`),
  };

  const ajustes = () =>
    leerJson(rutaAjustes, {
      token: "",
      trm: 1,
      cuentas: [],
      version: "v25.0",
      minDiasAlerta: MIN_DIAS_ALERTA,
    });
  const graph = crearGraph({ ajustes, fetcher });
  const enCurso = new Map();

  // Contexto de quien pide: su tienda activa y un cliente de LucidSales con
  // SU sesion. Sin contexto (pruebas, integraciones) se usa `lucid`.
  let ctx = { lucid: null, tienda: null };
  function contexto(c = {}) {
    ctx = { lucid: c.lucid ?? null, tienda: Number(c.tienda) || null };
  }
  const lucidActual = () => ctx.lucid ?? lucid;

  function productos() {
    return leerJson(rutas.productos, []);
  }
  const nombreDe = (p) => p?.nombre ?? p?.name ?? "";
  const gananciaDe = (p) => Number(p?.ganancia ?? p?.unit ?? 0) || 0;

  /** Ids de las cuentas elegidas, para saber si la cache sigue valiendo. */
  const idsCuentas = (cfg) =>
    (cfg.cuentas ?? []).map((c) => String(c.id)).sort().join(",");

  /** Borra las caches de dias viejos (una por ventana y por dia). */
  function limpiarCaches() {
    const limite = restarDias(hoy(), 3);
    try {
      for (const f of fs.readdirSync(dir)) {
        const m = /^datos_\d+d_(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
        if (m && m[1] < limite) fs.rmSync(path.join(dir, f), { force: true });
      }
    } catch {
      /* limpiar es opcional */
    }
  }

  function indiceProductos(lista, manual) {
    const indice = new Map();
    const porNombre = new Map(lista.map((p, i) => [p.nombre ?? p.name, i]));
    const agregar = (clave, i) => {
      if (!indice.has(clave)) indice.set(clave, []);
      if (!indice.get(clave).includes(i)) indice.get(clave).push(i);
    };
    const p = lista;
    p.forEach((prod, i) => {
      for (const c of prod.campanas ?? prod.campaigns ?? []) agregar(normalizar(c), i);
    });
    for (const m of manual) {
      const i = porNombre.get(m.producto ?? m.product);
      if (i !== undefined) agregar(normalizar(m.campana ?? m.campaign), i);
    }
    return indice;
  }

  /** Descarga (o reutiliza del cache de hoy) los datos crudos de Meta. */
  async function crudo(dias, { forzar = false } = {}) {
    const cfg = ajustes();
    if (!cfg.token) {
      throw new Error("Conecta tu cuenta de Meta para ver tus campanas");
    }
    if (!forzar) {
      const cache = leerJson(rutas.cache(dias), null);
      // si cambiaron las cuentas elegidas, la cache de hoy ya no sirve
      const mismas =
        cache?.cuentasIds === undefined
          ? cache?.cuentas?.length === (cfg.cuentas ?? []).length
          : cache.cuentasIds === idsCuentas(cfg);
      if (cache && Array.isArray(cache.cuentas) && mismas) return cache;
    }
    const llave = String(dias);
    if (enCurso.has(llave)) return enCurso.get(llave);

    const promesa = (async () => {
      const hasta = hoy();
      const desde = restarDias(hasta, dias - 1);

      const cuentas = [];
      let error = null;
      for (const cuenta of cfg.cuentas ?? []) {
        try {
          const campanas = (await graph.paginar(`act_${cuenta.id}/campaigns`, {
            fields: "id,name,status,created_time",
          })).map((c) => ({
            id: c.id,
            nombre: c.name ?? "",
            estado: c.status ?? "UNKNOWN",
            creada: (c.created_time ?? "").slice(0, 10),
          }));

          const mapear = (filas) => {
            const salida = {};
            for (const f of filas) {
              if (!f.campaign_id) continue;
              salida[f.campaign_id] = {
                // el nombre sirve para las campanas archivadas o borradas, que
                // ya no salen en /campaigns pero si gastaron en la ventana
                nombre: f.campaign_name ?? "",
                gasto: Number(f.spend ?? 0) || 0,
                compras: comprasDe(f.actions),
                roas: roasDe(f.purchase_roas),
                impresiones: Number(f.impressions ?? 0) || 0,
                clics: Number(f.clicks ?? 0) || 0,
              };
            }
            return salida;
          };

          const campos =
            "campaign_id,campaign_name,spend,actions,action_values,purchase_roas,impressions,clicks";
          const insights = mapear(
            await graph.paginar(`act_${cuenta.id}/insights`, {
              level: "campaign",
              time_range: JSON.stringify({ since: desde, until: hasta }),
              fields: campos,
            }),
          );
          const insights7 =
            dias > 7
              ? mapear(
                  await graph.paginar(`act_${cuenta.id}/insights`, {
                    level: "campaign",
                    time_range: JSON.stringify({ since: restarDias(hasta, 6), until: hasta }),
                    fields: campos,
                  }),
                )
              : insights;

          cuentas.push({
            id: String(cuenta.id),
            nombre: cuenta.nombre,
            moneda: cuenta.moneda ?? "COP",
            campanas,
            insights,
            insights7,
          });
        } catch (e) {
          error = e.message;
          break;
        }
      }

      if (error || cuentas.length !== (cfg.cuentas ?? []).length) {
        const respaldo = { ...conSnapshot(error, dias), cuentasIds: idsCuentas(cfg) };
        // se guarda tambien para que la siguiente consulta sea inmediata;
        // "Actualizar" (forzar) vuelve a intentarlo contra Meta
        escribirJson(rutas.cache(dias), respaldo);
        return respaldo;
      }

      const datos = {
        ventana: [desde, hasta],
        obtenido: new Date().toISOString(),
        fuente: "live",
        cuentasIds: idsCuentas(cfg),
        cuentas,
      };
      escribirJson(rutas.cache(dias), datos);
      limpiarCaches();
      return datos;
    })();

    enCurso.set(llave, promesa);
    try {
      return await promesa;
    } finally {
      enCurso.delete(llave);
    }
  }

  /** Si Meta no responde, se sirve el ultimo corte guardado (23 sep - 7 oct). */
  function conSnapshot(error, dias) {
    const snap = leerJson(rutas.snapshot, null);
    if (!snap?.cuentas && !snap?.campaigns) {
      throw new Error(error || "no hay datos disponibles");
    }
    const cfg = ajustes();
    const trm = Number(cfg.trm) || 1;
    const porCuenta = new Map();
    for (const c of snap.campaigns ?? []) {
      const nombre = c.account ?? cfg.cuentas?.[0]?.nombre ?? "Cuenta";
      const cuentaCfg = (cfg.cuentas ?? []).find((x) => x.nombre === nombre) ?? { moneda: "USD" };
      const gasto = cuentaCfg.moneda === "USD" ? (c.spend_cop ?? 0) / trm : (c.spend_cop ?? 0);
      if (!porCuenta.has(nombre)) {
        porCuenta.set(nombre, {
          nombre,
          moneda: cuentaCfg.moneda ?? "COP",
          campanas: [],
          insights: {},
          insights7: {},
        });
      }
      const e = porCuenta.get(nombre);
      const id = c.id ?? c.name;
      e.campanas.push({
        id,
        nombre: c.name,
        estado: c.status ?? "ACTIVE",
        creada: c.created ?? "",
      });
      e.insights[id] = {
        gasto,
        compras: c.purchases ?? 0,
        roas: c.roas ?? 0,
        impresiones: 0,
        clics: 0,
      };
    }
    return {
      ventana: snap.window ?? [hoy(), hoy()],
      obtenido: new Date().toISOString(),
      fuente: "snapshot",
      aviso: `No se pudo consultar Meta (${error}). Se muestran los datos guardados del ${snap.window?.[0]} al ${snap.window?.[1]}.`,
      cuentas: [...porCuenta.values()],
      diasSnapshot: dias,
    };
  }

  /**
   * Efectividad de entrega: de cada compra que Meta cuenta, que parte termina
   * ENTREGADA (y deja ganancia). Sale de los estados de envio de los pedidos
   * que trajo el traedor de ganancias:
   *
   *   efectividad = entregados / (entregados + cancelados, devoluciones,
   *                 rechazados y guias anuladas)
   *
   * Los que siguen en camino no cuentan (todavia no se sabe como terminan).
   * Los pedidos SIN envio (nunca se confirmaron) solo cuentan como no
   * entregados si el usuario lo pide (`contarSinEnvio`). Tambien se puede
   * fijar a mano.
   */
  function efectividad() {
    const cfg = ajustes().entrega ?? {};
    const contarSinEnvio = Boolean(cfg.contarSinEnvio);
    let entregados = 0;
    let fallidos = 0;
    let enCamino = 0;
    let sinEnvio = 0;
    for (const p of productos()) {
      const e = p?.pedidos?.estados;
      if (!e || typeof e !== "object") continue;
      let suma = 0;
      for (const [nombre, n] of Object.entries(e)) {
        const v = Number(n) || 0;
        suma += v;
        const tipo = tipoEstadoEnvio(nombre);
        if (tipo === "entregado") entregados += v;
        else if (tipo === "fallido") fallidos += v;
        else enCamino += v;
      }
      sinEnvio += Math.max(0, (Number(p.pedidos.nTotal) || 0) - suma);
    }
    const tasaDe = (base) => (base >= 20 ? entregados / base : null);
    const tasaSinContar = tasaDe(entregados + fallidos);
    const tasaContando = tasaDe(entregados + fallidos + sinEnvio);
    const delPedidos = contarSinEnvio ? tasaContando : tasaSinContar;
    const manual = Number(cfg.tasa);
    let tasa;
    let origen;
    if (cfg.modo === "manual" && manual > 0 && manual <= 1) {
      tasa = manual;
      origen = "manual";
    } else if (delPedidos !== null) {
      tasa = delPedidos;
      origen = "pedidos";
    } else {
      tasa = 1;
      origen = "sin datos";
    }
    return {
      tasa: Math.round(tasa * 10000) / 10000,
      origen,
      modo: cfg.modo === "manual" ? "manual" : "auto",
      manual: manual > 0 && manual <= 1 ? manual : null,
      contarSinEnvio,
      entregados,
      fallidos,
      enCamino,
      sinEnvio,
      tasaSinContarSinEnvio: tasaSinContar,
      tasaContandoSinEnvio: tasaContando,
    };
  }

  /** {modo: "auto"|"manual", tasa? (0-1 o 1-100), contarSinEnvio?} */
  function guardarEntrega(v = {}) {
    const cfg = leerJson(rutaAjustes, {});
    const actual = cfg.entrega ?? {};
    const prox = { ...actual };
    if (v.modo !== undefined) {
      if (!["auto", "manual"].includes(v.modo)) throw new Error("El modo debe ser auto o manual");
      prox.modo = v.modo;
    }
    if (v.tasa !== undefined && v.tasa !== null && String(v.tasa).trim() !== "") {
      let t = Number(v.tasa);
      if (t > 1) t = t / 100; // aceptan 65 o 0.65
      if (!Number.isFinite(t) || t <= 0 || t > 1) {
        throw new Error("La efectividad debe estar entre 1% y 100%");
      }
      prox.tasa = Math.round(t * 10000) / 10000;
    }
    if (v.contarSinEnvio !== undefined) prox.contarSinEnvio = Boolean(v.contarSinEnvio);
    if (prox.modo === "manual" && !(prox.tasa > 0)) {
      throw new Error("Para fijarla a mano escribe el porcentaje de entrega");
    }
    cfg.entrega = prox;
    escribirJson(rutaAjustes, cfg);
    return efectividad();
  }

  /** Dataset completo (lo que consume el panel). */
  function calcular(datos) {
    const cfg = ajustes();
    const trm = Number(cfg.trm) || 1;
    const lista = productos();
    const manual = leerJson(rutas.manual, []);
    const indice = indiceProductos(lista, manual);
    const nombres = lista.map(nombreDe).filter(Boolean);
    const [desde, hasta] = datos.ventana;
    const ventanaDias = diasEntre(desde, hasta);
    // dias minimos de datos de la campana para poder opinar sobre ella
    const minDiasAlerta = Math.max(1, Math.round(Number(cfg.minDiasAlerta) || MIN_DIAS_ALERTA));
    const entrega = efectividad();
    const avisos = datos.aviso ? [datos.aviso] : [];

    const filas = [];
    for (const cuenta of datos.cuentas) {
      // pesos: COP tal cual, USD con la TRM; otra moneda no se puede convertir
      const moneda = cuenta.moneda ?? "COP";
      const fx = moneda === "COP" ? 1 : moneda === "USD" ? trm : null;
      if (fx === null) {
        avisos.push(
          `La cuenta ${cuenta.nombre} esta en ${moneda}: solo se convierten COP y USD, asi que quedo fuera del analisis.`,
        );
        continue;
      }
      // las archivadas o borradas no salen en /campaigns pero si gastaron
      const conocidas = new Set(cuenta.campanas.map((c) => c.id));
      const extra = Object.entries(cuenta.insights ?? {})
        .filter(([id]) => !conocidas.has(id))
        .map(([id, ins]) => ({ id, nombre: ins?.nombre || id, estado: "ARCHIVED", creada: "" }));

      for (const c of [...cuenta.campanas, ...extra]) {
        const ins = cuenta.insights?.[c.id];
        if (!ins?.gasto) continue; // sin gasto en la ventana
        const gasto = ins.gasto * fx;
        const compras = ins.compras ?? 0;
        const coincidencias = indice.get(normalizar(c.nombre)) ?? [];
        const vinculados = coincidencias.map((i) => lista[i]).filter(Boolean);
        const faltaGanancia = vinculados.filter((p) => gananciaDe(p) <= 0).map(nombreDe);
        // con un solo producto sin ganancia la cuenta ya no es confiable
        const completo = vinculados.length > 0 && faltaGanancia.length === 0;
        // ganancia por pedido ENTREGADO (promedio de los productos vinculados)
        const unidad = completo
          ? vinculados.reduce((a, p) => a + gananciaDe(p), 0) / vinculados.length
          : 0;
        // lo que deja en promedio CADA compra que cuenta Meta
        const porCompra = unidad * entrega.tasa;
        const margen = completo ? compras * porCompra : null;
        const neto = margen === null ? null : margen - gasto;
        const roi = margen === null || !gasto ? null : margen / gasto;
        const ins7 = cuenta.insights7?.[c.id];

        const f = {
          id: c.id,
          nombre: c.nombre,
          cuenta: cuenta.nombre,
          estado: c.estado,
          creada: c.creada,
          diasActivos: c.creada ? Math.max(1, diasEntre(c.creada, hasta)) : null,
          diasMedidos: c.creada
            ? Math.min(ventanaDias, Math.max(1, diasEntre(c.creada, hasta)))
            : ventanaDias,
          gasto: Math.round(gasto * 100) / 100,
          gasto7: Math.round((ins7?.gasto ?? 0) * fx * 100) / 100,
          compras,
          compras7: ins7?.compras ?? 0,
          roas: ins.roas ?? 0,
          impresiones: ins.impresiones ?? 0,
          clics: ins.clics ?? 0,
          unidad,
          porCompra: Math.round(porCompra * 100) / 100,
          margen,
          neto,
          roi,
          cpa: compras ? gasto / compras : null,
          clase: clasificar(margen, neto, roi),
          productos: vinculados.map(nombreDe),
          compartida: vinculados.length > 1,
          sinProducto: vinculados.length === 0,
          faltaGanancia,
          sugerido: vinculados.length ? null : sugerirProducto(c.nombre, nombres),
        };
        const activa = f.estado === "ACTIVE";
        const suficiente = f.diasMedidos >= minDiasAlerta;
        const prioridadAlerta = CLASES_ALERTA.includes(f.clase);
        f.activa = activa;
        // La alerta solo sirve para campanas ENCENDIDAS y con tiempo suficiente
        // para juzgarlas: una pausada ya fue decidida (no hace falta volver a
        // decir "pausala") y una de 1 o 2 dias todavia no dice nada.
        f.alerta = prioridadAlerta && activa && suficiente;
        f.alertaMotivo = !prioridadAlerta
          ? ""
          : !activa
            ? "pausada"
            : !suficiente
              ? "nueva"
              : "";
        f.accion = sugerir(f, ventanaDias, minDiasAlerta);
        filas.push(f);
      }
    }

    filas.sort((a, b) => b.gasto - a.gasto);

    const conMargen = filas.filter((f) => f.margen !== null);
    const sinDato = filas.filter((f) => f.margen === null);
    const gastoCon = conMargen.reduce((a, f) => a + f.gasto, 0);
    const margenTotal = conMargen.reduce((a, f) => a + f.margen, 0);
    const gastoTotal = filas.reduce((a, f) => a + f.gasto, 0);
    const comprasTotal = filas.reduce((a, f) => a + f.compras, 0);

    const conteos = {};
    for (const k of CLASES) conteos[k] = filas.filter((f) => f.clase === k).length;
    const perdidas = filas
      .filter((f) => f.clase === "PERDIDA")
      .reduce((a, f) => a + f.neto, 0);
    const perdidasDia = filas
      .filter((f) => f.clase === "PERDIDA")
      .reduce((a, f) => a + Math.abs(f.neto) / (f.diasMedidos || 1), 0);

    // Por producto: una campana compartida entre N productos reparte su gasto
    // y sus compras en N partes iguales (si no, se contaria N veces).
    const filaProducto = (p) => {
      const nombre = nombreDe(p);
      const mias = filas.filter((f) => f.productos.includes(nombre));
      const parte = (f) => 1 / Math.max(1, f.productos.length);
      const gasto = mias.reduce((a, f) => a + f.gasto * parte(f), 0);
      const compras = mias.reduce((a, f) => a + f.compras * parte(f), 0);
      const unidad = gananciaDe(p);
      const margen = unidad ? compras * unidad * entrega.tasa : null;
      const neto = margen === null ? null : margen - gasto;
      const roi = margen === null || !gasto ? null : margen / gasto;
      const ped = p.pedidos ?? null;
      return {
        nombre,
        precio: p.precio ?? p.price ?? 0,
        unidad,
        // promedio que salio de los PEDIDOS (no se usa en el calculo salvo
        // que se adopte a mano): esta a la vista para compararlo
        pedidosProm: ped && ped.n > 0 && ped.prom > 0 ? ped.prom : null,
        pedidosN: ped?.n ?? 0,
        // total de pedidos en la ventana (incluye los sin envio, que no
        // entran al promedio): sirve para enseñar «n=746 (de 834)»
        pedidosNTotal: ped?.nTotal ?? ped?.n ?? 0,
        pedidosDesde: ped?.desde ?? null,
        pedidosHasta: ped?.hasta ?? null,
        origenGanancia: p.origenGanancia ?? null,
        campanas: mias.length,
        gasto: Math.round(gasto * 100) / 100,
        compras: Math.round(compras * 10) / 10,
        margen,
        neto,
        roi,
        compartida: mias.some((f) => f.compartida),
        clase: clasificar(margen, neto, roi ?? 0),
      };
    };
    const todas = lista.filter((p) => nombreDe(p)).map(filaProducto);
    const productosFila = todas
      .filter((p) => p.campanas > 0)
      .sort((a, b) => (b.neto ?? -Infinity) - (a.neto ?? -Infinity));
    const productosSinCampana = todas
      .filter((p) => p.campanas === 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const cuentasFila = datos.cuentas
      .filter((c) => ["COP", "USD", undefined].includes(c.moneda))
      .map((c) => {
        const mias = filas.filter((f) => f.cuenta === c.nombre);
        const gasto = mias.reduce((a, f) => a + f.gasto, 0);
        const compras = mias.reduce((a, f) => a + f.compras, 0);
        const conDatos = mias.filter((f) => f.margen !== null);
        const margen = conDatos.reduce((a, f) => a + f.margen, 0);
        const gastoConDatos = conDatos.reduce((a, f) => a + f.gasto, 0);
        return {
          nombre: c.nombre,
          moneda: c.moneda ?? "COP",
          campanas: mias.length,
          gasto: Math.round(gasto * 100) / 100,
          gastoSinDato: Math.round((gasto - gastoConDatos) * 100) / 100,
          compras,
          cpa: compras ? gasto / compras : null,
          margen,
          neto: margen - gastoConDatos,
          roi: gastoConDatos ? margen / gastoConDatos : 0,
          perdidas: mias.filter((f) => f.clase === "PERDIDA").reduce((a, f) => a + f.neto, 0),
          conteos: Object.fromEntries(
            CLASES.map((k) => [k, mias.filter((f) => f.clase === k).length]),
          ),
        };
      });

    if (entrega.origen === "sin datos" && filas.length) {
      avisos.push(
        "Todavía no hay datos de entregas: se supone que el 100% de las compras se entrega. Trae las ganancias de los pedidos (pestaña Productos) o fija la efectividad a mano.",
      );
    }

    return {
      generado: new Date().toISOString(),
      fuente: datos.fuente,
      aviso: avisos.length ? avisos.join(" ") : null,
      ventana: { desde, hasta, dias: ventanaDias },
      minDiasAlerta,
      trm,
      entrega,
      totales: {
        gasto: Math.round(gastoTotal * 100) / 100,
        compras: comprasTotal,
        cpa: comprasTotal ? gastoTotal / comprasTotal : 0,
        margen: margenTotal,
        // neto y ROI solo de lo que se puede medir; el gasto sin dato va aparte
        neto: margenTotal - gastoCon,
        roi: gastoCon ? margenTotal / gastoCon : 0,
        gastoMedido: Math.round(gastoCon * 100) / 100,
        gastoSinDato: Math.round(sinDato.reduce((a, f) => a + f.gasto, 0) * 100) / 100,
        campanasSinProducto: filas.filter((f) => f.sinProducto).length,
        campanasSinGanancia: filas.filter((f) => !f.sinProducto && f.margen === null).length,
        campanas: filas.length,
        gasto7: Math.round(filas.reduce((a, f) => a + f.gasto7, 0) * 100) / 100,
        compras7: filas.reduce((a, f) => a + f.compras7, 0),
        perdidas,
        perdidasDia,
      },
      conteos,
      campanas: filas,
      productos: productosFila,
      productosSinCampana,
      cuentas: cuentasFila,
    };
  }

  async function datos({ dias = 15, forzar = false } = {}) {
    const d = [7, 15, 30].includes(Number(dias)) ? Number(dias) : 15;
    return calcular(await crudo(d, { forzar }));
  }

  // ------------------------------------------------------------ persistencia

  function guardarGanancia({ nombre, ganancia }) {
    const lista = productos();
    const i = lista.findIndex((p) => (p.nombre ?? p.name) === nombre);
    if (i < 0) throw new Error(`Producto no encontrado: ${nombre}`);
    const v = Number(ganancia);
    if (Number.isNaN(v) || v < 0) throw new Error("La ganancia promedio debe ser un numero >= 0");
    const obj = lista[i];
    if ("ganancia" in obj || !("unit" in obj)) obj.ganancia = Math.round(v * 100) / 100;
    else obj.unit = Math.round(v * 100) / 100;
    // quien lo escribio a mano manda: el traedor de ganancias no lo toca mas
    obj.origenGanancia = "manual";
    escribirJson(rutas.productos, lista);
    return { nombre, ganancia: Math.round(v * 100) / 100 };
  }

  // ------------------------------------------------------------ ganancias
  //
  // «Traer las ganancias de los pedidos»: por cada producto se le pide a
  // LucidSales la analitica de su ventana y sale
  //
  //     promedio = gananciaEsperada / pedidosTotales
  //
  // donde `gananciaEsperada` es la ganancia NETA REAL por pedido: ya viene
  // descontando el flete y el costo del proveedor (LucidSales la calcula
  // pedido por pedido con los datos de Dropi). Ese promedio:
  //
  //   * SIEMPRE se guarda y se enseña (`p.pedidos`), para poder compararlo
  //     con el valor manual y adoptarlo con un clic desde el panel.
  //   * NO pisa la ganancia escrita a mano: solo la RELLENA si esta en 0 y
  //     hay muestra suficiente (minPedidos, 20 por defecto).
  //
  // El trabajo tarda (una llamada por producto, ~1 s c/u) asi que corre en
  // segundo plano y el panel consulta el progreso con GET /ganancias.
  const TRABAJO = "ganancias";
  const AJUSTES_GANANCIAS = {
    auto: true,
    minPedidos: 20,
    // sin tienda fija: se usa la tienda activa del panel de quien pide
    tienda: null,
    dias: 15,
    // estados que CUENTAN para el promedio: la muestra son solo los pedidos
    // que traen ganancia. Dropi calcula el flete y el costo del proveedor al
    // entregar, asi que el resto entra con ganancia 0 y, si se dividen entre
    // ellos, hunden el promedio de los que si dejaron plata.
    incluirEstados: ["ENTREGADO"],
  };
  const trabajos = new Map();

  /** Limpia una lista de estados: textos no vacios y sin repetir. */
  function listaEstados(v, defecto) {
    if (!Array.isArray(v)) return defecto;
    const out = [];
    for (const e of v) {
      const s = String(e ?? "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out.length ? out : defecto;
  }

  function ajustesGanancias() {
    const g = ajustes().ganancias ?? {};
    const n = (v, defecto) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : defecto);
    return {
      auto: g.auto === undefined ? AJUSTES_GANANCIAS.auto : Boolean(g.auto),
      minPedidos: Math.round(n(g.minPedidos, AJUSTES_GANANCIAS.minPedidos)),
      // la tienda activa del panel manda; el ajuste guardado queda para las
      // integraciones sin sesion (x-api-key)
      tienda: Number(ctx.tienda) || (Number(g.tienda) > 0 ? Math.round(Number(g.tienda)) : null),
      dias: [7, 15, 30].includes(Number(g.dias)) ? Number(g.dias) : AJUSTES_GANANCIAS.dias,
      incluirEstados: listaEstados(g.incluirEstados, AJUSTES_GANANCIAS.incluirEstados),
    };
  }

  /** Guarda los ajustes del traedor (van en el config del espacio). */
  function gananciasAjustes(v = {}) {
    const prox = { ...ajustesGanancias() };
    if (v.auto !== undefined) prox.auto = Boolean(v.auto);
    if (v.minPedidos !== undefined) {
      const m = Number(v.minPedidos);
      if (!Number.isFinite(m) || m < 1 || m > 1000) {
        throw new Error("La muestra minima debe estar entre 1 y 1000 pedidos");
      }
      prox.minPedidos = Math.round(m);
    }
    // la tienda no se elige aqui: es la que esta activa en el panel
    if (v.tienda !== undefined && !ctx.tienda) {
      const t = Number(v.tienda);
      if (!Number.isFinite(t) || t <= 0) throw new Error("La tienda de LucidSales no es un id valido");
      prox.tienda = Math.round(t);
    }
    if (v.dias !== undefined) {
      const d = Number(v.dias);
      if (![7, 15, 30].includes(d)) throw new Error("La ventana de pedidos debe ser 7, 15 o 30 dias");
      prox.dias = d;
    }
    if (v.incluirEstados !== undefined) {
      prox.incluirEstados = listaEstados(v.incluirEstados, []);
      if (!prox.incluirEstados.length) {
        throw new Error("La lista de estados que cuentan no puede quedar vacia");
      }
    }
    const cfg = leerJson(rutaAjustes, {});
    const guardar = { ...prox };
    if (ctx.tienda) guardar.tienda = cfg.ganancias?.tienda ?? null;
    cfg.ganancias = guardar;
    escribirJson(rutaAjustes, cfg);
    return prox;
  }

  /**
   * Cuantos pedidos de la respuesta TRAEN GANANCIA.
   *
   * `statusData` viene con un renglon por estado y su cantidad. Solo los
   * ENTREGADOS tienen flete y costo del proveedor sincronizados en Dropi
   * (la ganancia neta se calcula al entregar): los demas entran con
   * ganancia 0 y, si se dividen entre ellos, hunden el promedio de los que
   * si dejaron plata. Por eso la muestra son SOLO los estados de `incluir`
   * (por defecto, ENTREGADO).
   *
   * Devuelve `conGanancia: null` si la respuesta no trae el desglose (ahi el
   * llamador reparte entre todos los pedidos, como siempre) y `0` cuando hay
   * desglose pero ninguna entrega en la ventana: no se inventa promedio
   * dividiendo entre pedidos que no dejaron plata.
   */
  function pedidosConGanancia(a, incluir) {
    const filas =
      Array.isArray(a?.statusData) && a.statusData.length
        ? a.statusData
        : Array.isArray(a?.shippingStatusData)
          ? a.shippingStatusData
          : null;
    if (!filas?.length) return { conGanancia: null, estados: {} };

    const llave = (s) =>
      String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    const dentro = new Set((incluir ?? []).map(llave));

    const estados = {};
    let conGanancia = 0;
    for (const f of filas) {
      const nombre = String(f?.name ?? "").trim();
      const cant = Number(f?.value ?? 0) || 0;
      if (!nombre || cant <= 0) continue;
      estados[nombre] = (estados[nombre] ?? 0) + cant;
      if (dentro.has(llave(nombre))) conGanancia += cant;
    }
    return { conGanancia, estados };
  }

  /** [desde, hasta] de la ventana de pedidos (mismos dias que el analisis). */
  function ventanaPedidos(dias) {
    const h = hoy();
    return [restarDias(h, dias - 1), h];
  }

  /** Casa el producto del espacio con el de la tienda (nombre normalizado). */
  function casarProductos(local, catalogo) {
    const porNombre = new Map();
    for (const p of catalogo) {
      const n = normalizar(p.Nombre ?? p.nombre);
      if (!n) continue;
      if (!porNombre.has(n)) porNombre.set(n, p);
    }
    const pareja = new Map(); // indice local -> producto de la tienda
    local.forEach((prod, i) => {
      const mio = normalizar(prod.nombre ?? prod.name);
      if (!mio) return;
      const exacto = porNombre.get(mio);
      if (exacto) {
        pareja.set(i, exacto);
        return;
      }
      if (mio.length < 5) return;
      // el de la tienda suele llevar detalle de mas («Nivel Laser 16 Lineas
      // Profesional»): nos quedamos con el que menos se desvia del nuestro
      let mejor = null;
      let mejorDistancia = Infinity;
      for (const [n, p] of porNombre) {
        if (!n.includes(mio) && !mio.includes(n)) continue;
        const distancia = Math.abs(n.length - mio.length);
        if (distancia < mejorDistancia) {
          mejor = p;
          mejorDistancia = distancia;
        }
      }
      if (mejor) pareja.set(i, mejor);
    });
    return pareja;
  }

  /**
   * Estados de envio que aparecieron en el calculo, con cuantos pedidos hay
   * de cada uno y si cuentan para el promedio (traen ganancia). Es lo que
   * pinta el panel para dejar elegir la muestra.
   */
  function estadosGanancias() {
    const aj = ajustesGanancias();
    const q = (s) =>
      String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    const dentro = new Set(aj.incluirEstados.map(q));

    const acumulado = new Map(); // estado visto -> pedidos en la ventana
    for (const p of productos()) {
      const e = p?.pedidos?.estados;
      if (!e || typeof e !== "object") continue;
      for (const [nombre, n] of Object.entries(e)) {
        if (!nombre) continue;
        acumulado.set(nombre, (acumulado.get(nombre) ?? 0) + (Number(n) || 0));
      }
    }

    const lista = [...acumulado.entries()].map(([nombre, n]) => ({
      nombre,
      n,
      excluido: !dentro.has(q(nombre)),
    }));
    // los que cuentan aunque no hayan aparecido, para poder desactivarlos
    for (const e of aj.incluirEstados) {
      if (!lista.some((x) => q(x.nombre) === q(e))) lista.push({ nombre: e, n: 0, excluido: false });
    }
    lista.sort((a, b) => b.n - a.n);
    return lista;
  }

  /** Estado del traedor para el panel (ajustes + progreso + ultimo resultado). */
  function estadoGanancias() {
    const vivo = trabajos.get(TRABAJO) ?? null;
    const u = leerJson(rutas.ganancias, null);
    return {
      disponible: Boolean(lucidActual()),
      ajustes: ajustesGanancias(),
      estados: estadosGanancias(),
      enCurso: Boolean(vivo),
      progreso: vivo
        ? { total: vivo.total, listos: vivo.listos, dias: vivo.dias, inicio: vivo.inicio }
        : null,
      ultimo: u
        ? {
            fecha: u.fecha ?? null,
            ejecutado: u.ejecutado ?? null,
            dias: u.dias ?? null,
            desde: u.desde ?? null,
            hasta: u.hasta ?? null,
            tienda: u.tienda ?? null,
            minPedidos: u.minPedidos ?? null,
            estado: u.estado ?? null,
            error: u.error ?? null,
            productos: u.productos ?? 0,
            conPedidos: u.conPedidos ?? 0,
            conPromedio: u.conPromedio ?? 0,
            rellenados: u.rellenados ?? 0,
            sinMatch: u.sinMatch ?? 0,
            errores: u.errores ?? 0,
            promedioGlobal: u.promedioGlobal ?? null,
          }
        : null,
    };
  }

  /** Un producto por vez: pide su analitica y anota el promedio en productos.json. */
  async function gananciasEjecutar(dias) {
    const aj = ajustesGanancias();
    // se fija al arrancar: la corrida sigue con la sesion de quien la pidio
    const cli = lucidActual();
    const [desde, hasta] = ventanaPedidos(dias);
    const registro = {
      estado: "enCurso",
      fecha: hoy(),
      ejecutado: new Date().toISOString(),
      intentado: new Date().toISOString(),
      dias,
      desde,
      hasta,
      tienda: aj.tienda,
      minPedidos: aj.minPedidos,
    };
    escribirJson(rutas.ganancias, registro);

    const vivo = { total: 0, listos: 0, dias, inicio: registro.ejecutado };
    trabajos.set(TRABAJO, vivo);
    try {
      if (!cli) throw new Error("No hay sesion de LucidSales para leer los pedidos");
      if (!aj.tienda) throw new Error("Elige una tienda en el panel para traer sus pedidos");
      const local = productos();
      if (!local.length) {
        throw new Error("Todavia no tienes productos: usa «Importar productos de mi tienda»");
      }

      const catalogo = await cli.productosTienda(aj.tienda);
      const pareja = casarProductos(local, catalogo);
      // Un catalogo vacio (o en el que ni un producto casa) NO se guarda:
      // borraria todos los promedios que ya se tenian. Paso en la practica
      // un dia que LucidSales estuvo devolviendo listas vacias, y la
      // corrida quedo con los 73 productos en «sin producto en la tienda».
      if (!catalogo?.length || pareja.size === 0) {
        throw new Error(
          `LucidSales no devolvio productos utilizables de la tienda ${aj.tienda} ` +
            `(${catalogo?.length ?? 0} en el catalogo, ${pareja.size} que casaran)`,
        );
      }
      vivo.total = local.length;

      const fallos = [];
      let conPedidos = 0;
      let conPromedio = 0;
      let rellenados = 0;
      let sinMatch = 0;
      let sumaGanancia = 0;
      let sumaPedidos = 0;

      const analizar = async (i) => {
        const p = local[i];
        const enTienda = pareja.get(i);
        if (!enTienda) {
          sinMatch++;
          p.pedidos = {
            n: 0,
            prom: 0,
            desde,
            hasta,
            fecha: hoy(),
            tienda: aj.tienda,
            nota: "sin producto en la tienda",
          };
          return;
        }
        const a = await cli.analitica({
          idShop: aj.tienda,
          desde,
          hasta,
          productId: enTienda.id,
        });
        const n = Number(a?.pedidosTotales?.value ?? 0) || 0;
        const ganancia = Number(a?.utilidaData?.gananciaEsperada ?? 0) || 0;
        // la muestra son SOLO los pedidos que traen ganancia (los ENTREGADO:
        // Dropi calcula flete y costo al entregar, el resto entra en 0 y
        // hundiria el promedio). Si la respuesta no trae el desglose se
        // reparte entre todos, como siempre; si trae desglose pero no hubo
        // ninguna entrega, no hay muestra y el promedio queda en 0.
        const { conGanancia, estados } = pedidosConGanancia(a, aj.incluirEstados);
        const cuenta = conGanancia === null ? n : Math.min(conGanancia, n);
        const prom = cuenta > 0 ? Math.round((ganancia / cuenta) * 100) / 100 : 0;
        p.pedidos = {
          n: cuenta,
          nTotal: n,
          estados,
          prom,
          ganancia: Math.round(ganancia),
          desde,
          hasta,
          fecha: hoy(),
          tienda: aj.tienda,
        };
        if (cuenta > 0) conPedidos++;
        if (cuenta > 0 && ganancia > 0) {
          conPromedio++;
          sumaGanancia += ganancia;
          sumaPedidos += cuenta;
        }
        // lo manual no se pisa: solo se rellena un vacio y con muestra
        const actual = Number(p.ganancia ?? p.unit ?? 0) || 0;
        if (actual <= 0 && cuenta >= aj.minPedidos && prom > 0) {
          const v = Math.round(prom);
          if ("ganancia" in p || !("unit" in p)) p.ganancia = v;
          else p.unit = v;
          p.origenGanancia = "pedidos";
          rellenados++;
        }
      };

      // 6 en paralelo: la analitica pesa y no hay que saturarla
      let cursor = 0;
      const trabajador = async () => {
        while (cursor < local.length) {
          const i = cursor++;
          try {
            await analizar(i);
          } catch (e) {
            fallos.push(e.message ?? String(e));
          } finally {
            vivo.listos++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, local.length) }, trabajador));

      // si casi todo fallo es un problema de fondo (credenciales, tienda):
      // no se guarda nada y se reintenta en el proximo intento
      if (fallos.length >= Math.max(3, Math.ceil(local.length / 2))) {
        throw new Error(fallos[0]);
      }

      escribirJson(rutas.productos, local);
      Object.assign(registro, {
        estado: "listo",
        productos: local.length,
        conPedidos,
        conPromedio,
        rellenados,
        sinMatch,
        errores: fallos.length,
        promedioGlobal: sumaPedidos ? Math.round(sumaGanancia / sumaPedidos) : null,
      });
      escribirJson(rutas.ganancias, registro);
    } catch (e) {
      registro.estado = "error";
      registro.error = e.message ?? String(e);
      escribirJson(rutas.ganancias, registro);
    } finally {
      trabajos.delete(TRABAJO);
    }
  }

  /**
   * Lanza el traedor (o devuelve el que ya corre). Con `esperar` resuelve
   * cuando termine; sin el, el panel consulta el progreso con GET.
   */
  async function traerGanancias({ dias, forzar = false, esperar = false } = {}) {
    if (!lucidActual()) {
      throw new Error(
        "No hay sesion de LucidSales: no se pueden traer las ganancias de los pedidos",
      );
    }
    const d = [7, 15, 30].includes(Number(dias)) ? Number(dias) : ajustesGanancias().dias;
    if (trabajos.has(TRABAJO)) return estadoGanancias();
    if (!forzar) {
      const u = leerJson(rutas.ganancias, null);
      const [desde] = ventanaPedidos(d);
      if (
        u?.estado === "listo" &&
        u?.fecha === hoy() &&
        u?.dias === d &&
        u?.desde === desde &&
        Number(u?.tienda) === Number(ajustesGanancias().tienda)
      ) {
        return { ...estadoGanancias(), yaActualizado: true };
      }
    }
    const corrida = gananciasEjecutar(d);
    if (esperar) await corrida;
    return estadoGanancias();
  }

  /**
   * Gatillo automatico: se llama cuando se piden datos frescos. Solo corre
   * una vez al dia y nunca encima de una corrida ni de un fallo reciente.
   */
  function gananciasAuto() {
    const aj = ajustesGanancias();
    if (!lucidActual()) return { ok: false, motivo: "sin sesion de LucidSales" };
    if (!aj.auto) return { ok: false, motivo: "automatico apagado" };
    if (!aj.tienda) return { ok: false, motivo: "sin tienda" };
    if (!productos().length) return { ok: false, motivo: "sin productos" };
    if (trabajos.has(TRABAJO)) return { ok: false, enCurso: true };
    const u = leerJson(rutas.ganancias, null);
    const [desde] = ventanaPedidos(aj.dias);
    if (
      u?.estado === "listo" &&
      u?.fecha === hoy() &&
      u?.dias === aj.dias &&
      u?.desde === desde &&
      Number(u?.tienda) === Number(aj.tienda)
    ) {
      return { ok: false, motivo: "ya se ejecuto hoy" };
    }
    const intento = u?.intentado ? Date.parse(u.intentado) : 0;
    if (Number.isFinite(intento) && Date.now() - intento < 10 * 60000) {
      return { ok: false, motivo: "intento reciente" };
    }
    traerGanancias({ dias: aj.dias, forzar: true }).catch(() => {});
    return { ok: true };
  }

  // ------------------------------------------------------------ productos

  /**
   * Trae el catalogo de la tienda activa y agrega los productos que falten
   * (con ganancia 0: la llena el traedor de ganancias o el usuario a mano).
   * No toca los que ya estaban.
   */
  async function importarProductos() {
    const cli = lucidActual();
    const tienda = ajustesGanancias().tienda;
    if (!cli) throw new Error("No hay sesion de LucidSales para leer tu catalogo");
    if (!tienda) throw new Error("Elige una tienda en el panel");
    const catalogo = await cli.productosTienda(tienda);
    if (!Array.isArray(catalogo) || !catalogo.length) {
      throw new Error(`La tienda ${tienda} no devolvio productos`);
    }
    const lista = productos();
    const vistos = new Set(lista.map((p) => normalizar(nombreDe(p))));
    let nuevos = 0;
    for (const p of catalogo) {
      const nombre = String(p?.Nombre ?? p?.nombre ?? "").trim();
      const k = normalizar(nombre);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      lista.push({
        nombre,
        precio: Number(p?.Precio ?? p?.precio ?? 0) || 0,
        ganancia: 0,
        campanas: [],
      });
      nuevos++;
    }
    escribirJson(rutas.productos, lista);
    return { nuevos, total: lista.length, enTienda: catalogo.length, tienda };
  }

  /**
   * Vincula una campana a uno o varios productos (lista vacia = desvincular).
   * Reemplaza cualquier vinculo anterior de esa campana.
   */
  function vincular({ campana, productos: elegidos } = {}) {
    const nombreCampana = String(campana ?? "").trim();
    if (!nombreCampana) throw new Error("Falta el nombre de la campana");
    const k = normalizar(nombreCampana);
    const lista = productos();
    const porNombre = new Map(lista.map((p) => [nombreDe(p), p]));
    const nuevos = Array.isArray(elegidos) ? [...new Set(elegidos.map(String))] : [];
    for (const n of nuevos) {
      if (!porNombre.has(n)) throw new Error(`Producto no encontrado: ${n}`);
    }
    // fuera los vinculos viejos (en la lista del producto o en el manual)
    for (const p of lista) {
      for (const campo of ["campanas", "campaigns"]) {
        if (Array.isArray(p[campo])) p[campo] = p[campo].filter((c) => normalizar(c) !== k);
      }
    }
    const manual = leerJson(rutas.manual, []).filter(
      (m) => normalizar(m.campana ?? m.campaign) !== k,
    );
    for (const n of nuevos) manual.push({ campana: nombreCampana, producto: n });
    escribirJson(rutas.productos, lista);
    escribirJson(rutas.manual, manual);
    return { campana: nombreCampana, productos: nuevos };
  }

  const plan = () => leerJson(rutas.plan, {});

  function marcarPlan({ id, hecho, nota }) {
    if (!id) throw new Error("Falta el id de la campana");
    const p = plan();
    const entrada = p[id] ?? {};
    if (hecho !== undefined) entrada.hecho = Boolean(hecho);
    if (nota !== undefined) entrada.nota = String(nota);
    p[id] = entrada;
    escribirJson(rutas.plan, p);
    return { id, ...entrada };
  }

  // ------------------------------------------------------------------ CSV

  function csv({ dias = 15, vista = "campanas" } = {}) {
    return datos({ dias }).then((d) => {
      const filas = [];
      const red = (v) => (v === null || v === undefined ? "" : Math.round(v));

      if (vista === "productos") {
        filas.push([
          "Producto", "Precio", "Ganancia por entregado", "Promedio pedidos", "Pedidos (n)",
          "Campanas", "Gasto", "Compras", "Margen", "Neto", "ROI", "Clasificacion",
        ]);
        for (const p of d.productos) {
          filas.push([
            p.nombre, p.precio, p.unidad,
            p.pedidosProm === null || p.pedidosProm === undefined ? "" : Math.round(p.pedidosProm),
            p.pedidosN || "",
            p.campanas, p.gasto, p.compras,
            red(p.margen), red(p.neto),
            p.roi === null || p.roi === undefined ? "" : p.roi.toFixed(2), p.clase,
          ]);
        }
      } else {
        let campanas = d.campanas;
        if (vista === "alertas") {
          // lo mismo que el tab de alertas: solo las que siguen encendidas y
          // con dias suficientes (la bandera `alerta` la calcula calcular())
          campanas = campanas.filter((f) => f.alerta);
        }
        filas.push([
          "Campana", "Producto(s)", "Cuenta", "Estado", "Creada", "Dias", "Gasto", "Compras",
          "CPA", "Ganancia por entregado", "Ganancia por compra", "Margen", "Neto", "ROI",
          "Clasificacion", "Accion sugerida",
        ]);
        for (const f of campanas) {
          filas.push([
            f.nombre, f.productos.join(" + "), f.cuenta, f.estado, f.creada, f.diasMedidos,
            f.gasto, f.compras,
            f.cpa === null ? "" : Math.round(f.cpa),
            red(f.unidad),
            red(f.porCompra),
            red(f.margen),
            red(f.neto),
            f.roi === null || f.roi === undefined ? "" : f.roi.toFixed(2),
            f.clase,
            f.accion.titulo,
          ]);
        }
      }

      const cuerpo = filas
        .map((fila) => fila.map(campoCsv).join(";"))
        .join("\r\n");
      return {
        nombre: `reporte_${vista}_${d.ventana.dias}dias.csv`,
        contenido: "\ufeff" + cuerpo,
      };
    });
  }

  return {
    datos,
    crudo,
    guardarGanancia,
    plan,
    marcarPlan,
    csv,
    ajustes,
    rutas,
    // traedor de ganancias desde los pedidos de LucidSales
    estadoGanancias,
    traerGanancias,
    gananciasAjustes,
    gananciasAuto,
    contexto,
    importarProductos,
    vincular,
    efectividad,
    guardarEntrega,
    /** para pruebas: recalcular sin volver a Meta */
    _calcular: calcular,
  };
}

function campoCsv(v) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
