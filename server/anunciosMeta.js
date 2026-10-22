// Rentabilidad de las campanas de Meta Ads (cuentas Pizdo y Orenar).
//
//   margen  = compras que atribuye Meta (omni_purchase) x ganancia promedio
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

export function hoy() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  } else if (f.clase === "SINDATO") {
    titulo = "Completar la ganancia promedio del producto";
    detalle = `Meta le atribuye ${f.compras} compras pero la ganancia promedio esta en 0; sin ese dato no se puede medir.`;
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
  const desde = new Date(`${hoy()}T00:00:00`);
  desde.setDate(desde.getDate() - ventanaDias);
  const creada = f.creada ? new Date(`${f.creada}T00:00:00`) : null;
  if (!nuevaDemasiado && creada && creada >= desde) {
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

  function productos() {
    return leerJson(rutas.productos, []);
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
      throw new Error("Falta el token de Meta en config/anuncios.json");
    }
    if (!forzar) {
      const cache = leerJson(rutas.cache(dias), null);
      if (cache && Array.isArray(cache.cuentas)) return cache;
    }
    const llave = String(dias);
    if (enCurso.has(llave)) return enCurso.get(llave);

    const promesa = (async () => {
      const desde = (() => {
        const d = new Date();
        d.setDate(d.getDate() - (dias - 1));
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      })();
      const hasta = hoy();

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
                    time_range: JSON.stringify({
                      since: (() => {
                        const d = new Date();
                        d.setDate(d.getDate() - 6);
                        const p = (n) => String(n).padStart(2, "0");
                        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
                      })(),
                      until: hasta,
                    }),
                    fields: campos,
                  }),
                )
              : insights;

          cuentas.push({
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
        const respaldo = conSnapshot(error, dias);
        // se guarda tambien para que la siguiente consulta sea inmediata;
        // "Actualizar" (forzar) vuelve a intentarlo contra Meta
        escribirJson(rutas.cache(dias), respaldo);
        return respaldo;
      }

      const datos = { ventana: [desde, hasta], obtenido: new Date().toISOString(), fuente: "live", cuentas };
      escribirJson(rutas.cache(dias), datos);
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
      const nombre = c.account ?? "Pizdo";
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

  /** Dataset completo (lo que consume el panel). */
  function calcular(datos) {
    const cfg = ajustes();
    const trm = Number(cfg.trm) || 1;
    const lista = productos();
    const manual = leerJson(rutas.manual, []);
    const indice = indiceProductos(lista, manual);
    const [desde, hasta] = datos.ventana;
    const ventanaDias = diasEntre(desde, hasta);
    // dias minimos de datos de la campana para poder opinar sobre ella
    const minDiasAlerta = Math.max(1, Math.round(Number(cfg.minDiasAlerta) || MIN_DIAS_ALERTA));

    const filas = [];
    for (const cuenta of datos.cuentas) {
      const fx = cuenta.moneda === "USD" ? trm : 1;
      for (const c of cuenta.campanas) {
        const ins = cuenta.insights?.[c.id];
        if (!ins?.gasto) continue; // sin gasto en la ventana
        const gasto = ins.gasto * fx;
        const compras = ins.compras ?? 0;
        const coincidencias = indice.get(normalizar(c.nombre)) ?? [];
        const vinculados = coincidencias.map((i) => lista[i]).filter(Boolean);
        const unidad = vinculados.length
          ? vinculados.reduce((a, p) => a + (Number(p.ganancia ?? p.unit ?? 0) || 0), 0) /
            vinculados.length
          : 0;
        // sin ganancia promedio no hay margen medible -> cuenta como SINDATO
        const margen = unidad ? compras * unidad : null;
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
          margen,
          neto,
          roi,
          cpa: compras ? gasto / compras : null,
          clase: clasificar(margen, neto, roi),
          productos: vinculados.map((p) => p.nombre ?? p.name),
          compartida: vinculados.length > 1,
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

    const productosFila = lista
      .map((p) => {
        const mias = filas.filter((f) => f.productos.includes(p.nombre ?? p.name));
        if (!mias.length) return null;
        const gasto = mias.reduce((a, f) => a + f.gasto, 0);
        const compras = mias.reduce((a, f) => a + f.compras, 0);
        const unidad = Number(p.ganancia ?? p.unit ?? 0) || 0;
        const margen = unidad ? compras * unidad : null;
        const neto = margen === null ? null : margen - gasto;
        const roi = margen === null || !gasto ? null : margen / gasto;
        const ped = p.pedidos ?? null;
        return {
          nombre: p.nombre ?? p.name,
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
          compras,
          margen,
          neto,
          roi,
          compartida: mias.some((f) => f.compartida),
          clase: clasificar(margen, neto, roi ?? 0),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.neto ?? -Infinity) - (a.neto ?? -Infinity));

    const cuentasFila = datos.cuentas.map((c) => {
      const mias = filas.filter((f) => f.cuenta === c.nombre);
      const gasto = mias.reduce((a, f) => a + f.gasto, 0);
      const compras = mias.reduce((a, f) => a + f.compras, 0);
      const conDatos = mias.filter((f) => f.margen !== null);
      const margen = conDatos.reduce((a, f) => a + f.margen, 0);
      const gastoConDatos = conDatos.reduce((a, f) => a + f.gasto, 0);
      return {
        nombre: c.nombre,
        moneda: c.moneda,
        campanas: mias.length,
        gasto: Math.round(gasto * 100) / 100,
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

    return {
      generado: new Date().toISOString(),
      fuente: datos.fuente,
      aviso: datos.aviso ?? null,
      ventana: { desde, hasta, dias: ventanaDias },
      minDiasAlerta,
      trm,
      totales: {
        gasto: Math.round(gastoTotal * 100) / 100,
        compras: comprasTotal,
        cpa: comprasTotal ? gastoTotal / comprasTotal : 0,
        margen: margenTotal,
        neto: margenTotal - gastoCon,
        roi: gastoCon ? margenTotal / gastoCon : 0,
        campanas: filas.length,
        gasto7: Math.round(filas.reduce((a, f) => a + f.gasto7, 0) * 100) / 100,
        compras7: filas.reduce((a, f) => a + f.compras7, 0),
        perdidas,
        perdidasDia,
      },
      conteos,
      campanas: filas,
      productos: productosFila,
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
    tienda: 3682,
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
      tienda: Math.round(n(g.tienda, AJUSTES_GANANCIAS.tienda)),
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
    if (v.tienda !== undefined) {
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
    cfg.ganancias = prox;
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
    const d = new Date();
    d.setDate(d.getDate() - (dias - 1));
    const p = (n) => String(n).padStart(2, "0");
    return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hoy()];
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
      disponible: Boolean(lucid),
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
      if (!lucid) throw new Error("Este servidor no tiene credenciales de LucidSales");
      const local = productos();
      if (!local.length) throw new Error("Este espacio no tiene productos cargados");

      const catalogo = await lucid.productosTienda(aj.tienda);
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
        const a = await lucid.analitica({
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
    if (!lucid) {
      throw new Error(
        "Este servidor no tiene credenciales de LucidSales: no se pueden traer las ganancias de los pedidos",
      );
    }
    const d = [7, 15, 30].includes(Number(dias)) ? Number(dias) : ajustesGanancias().dias;
    if (trabajos.has(TRABAJO)) return estadoGanancias();
    if (!forzar) {
      const u = leerJson(rutas.ganancias, null);
      const [desde] = ventanaPedidos(d);
      if (u?.estado === "listo" && u?.fecha === hoy() && u?.dias === d && u?.desde === desde) {
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
    if (!lucid) return { ok: false, motivo: "sin credenciales de LucidSales" };
    if (!aj.auto) return { ok: false, motivo: "automatico apagado" };
    if (trabajos.has(TRABAJO)) return { ok: false, enCurso: true };
    const u = leerJson(rutas.ganancias, null);
    const [desde] = ventanaPedidos(aj.dias);
    if (u?.estado === "listo" && u?.fecha === hoy() && u?.dias === aj.dias && u?.desde === desde) {
      return { ok: false, motivo: "ya se ejecuto hoy" };
    }
    const intento = u?.intentado ? Date.parse(u.intentado) : 0;
    if (Number.isFinite(intento) && Date.now() - intento < 10 * 60000) {
      return { ok: false, motivo: "intento reciente" };
    }
    traerGanancias({ dias: aj.dias, forzar: true }).catch(() => {});
    return { ok: true };
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
          "Producto", "Precio", "Ganancia promedio", "Promedio pedidos", "Pedidos (n)",
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
          "CPA", "Ganancia prom.", "Margen", "Neto", "ROI", "Clasificacion", "Accion sugerida",
        ]);
        for (const f of campanas) {
          filas.push([
            f.nombre, f.productos.join(" + "), f.cuenta, f.estado, f.creada, f.diasMedidos,
            f.gasto, f.compras,
            f.cpa === null ? "" : Math.round(f.cpa),
            f.unidad,
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
    /** para pruebas: recalcular sin volver a Meta */
    _calcular: calcular,
  };
}

function campoCsv(v) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
