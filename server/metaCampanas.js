// Escritura en Meta Ads (Graph API) para el Creador de campanas IA: sube
// imagenes y videos, crea campana, conjunto, creativos y anuncios.
//
// Todo se crea PAUSADO. Activar es un paso aparte que pide la persona.
// El token es el que el usuario conecto en Anuncios (necesita ads_management
// ademas de ads_read).
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Monedas sin centavos en la API de Meta (el presupuesto va en la unidad):
 * en el resto, 25.000 se manda como 2.500.000.
 */
const SIN_CENTAVOS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export const aUnidadesMeta = (valor, moneda = "COP") =>
  Math.round(Number(valor) * (SIN_CENTAVOS.has(String(moneda).toUpperCase()) ? 1 : 100));
export const deUnidadesMeta = (valor, moneda = "COP") =>
  Number(valor) / (SIN_CENTAVOS.has(String(moneda).toUpperCase()) ? 1 : 100);

/** Exclusiones fijas de Zunto: a donde no llegan las transportadoras. */
export const EXCLUSIONES_ZUNTO = [
  { tipo: "region", q: "San Andrés", nombre: "San Andrés y Providencia" },
  { tipo: "region", q: "Amazonas", nombre: "Amazonas" },
  { tipo: "city", q: "Mitú", nombre: "Mitú (Vaupés)" },
];

/** Mensaje con el que llega el cliente por WhatsApp (plantilla de conversacion). */
export function mensajeBienvenida({ saludo = "¡Hola! ¿Cómo podemos ayudarte?", predefinido }) {
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: { autofill_message: { content: String(predefinido ?? "").slice(0, 300) }, text: String(saludo).slice(0, 300) },
    },
    user_edit: false,
    surface: "visual_editor_new",
  });
}

const actDe = (cuenta) => (String(cuenta).startsWith("act_") ? String(cuenta) : `act_${cuenta}`);

export function crearMetaCampanas({ token, version = "v25.0", fetcher = globalThis.fetch } = {}) {
  if (!token) throw new Error("No hay token de Meta: conéctalo en Anuncios > Cuenta");

  async function pedir(ruta, { method = "GET", params = {}, intentos = 2 } = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${ruta}`);
    const cuerpo = new URLSearchParams();
    const todos = { ...params, access_token: token };
    for (const [k, v] of Object.entries(todos)) {
      if (v === undefined || v === null) continue;
      const val = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (method === "GET") url.searchParams.set(k, val);
      else cuerpo.set(k, val);
    }
    let ultimo = "";
    for (let i = 0; i < intentos; i++) {
      let datos;
      try {
        const res = await fetcher(url.toString(), {
          method,
          ...(method === "GET" ? {} : { body: cuerpo, headers: { "content-type": "application/x-www-form-urlencoded" } }),
          signal: AbortSignal.timeout(120000),
        });
        datos = await res.json();
      } catch (e) {
        ultimo = `error de red con Meta: ${e?.message ?? e}`;
        await dormir(500 * (i + 1));
        continue;
      }
      if (datos?.error) {
        const e = datos.error;
        ultimo = (e.error_user_msg || e.message || "error de Meta") + (e.code ? ` (código ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : "");
        if (e.code === 200 || e.code === 10 || /permission/i.test(e.message ?? "")) {
          ultimo += " — el token necesita el permiso ads_management (y pages_read_engagement para la página)";
        }
        // limites de uso: se reintenta
        if ([1, 2, 4, 17, 32, 613].includes(e.code) && method === "GET") {
          await dormir(800 * (i + 1));
          continue;
        }
        const err = new Error(ultimo);
        err.meta = e;
        throw err;
      }
      return datos;
    }
    throw new Error(ultimo || "Meta no respondió");
  }

  return {
    pedir,

    /** Moneda, nombre y presupuesto minimo diario de la cuenta. */
    async cuenta(cuenta) {
      const r = await pedir(actDe(cuenta), { params: { fields: "name,currency,account_status,min_daily_budget" } });
      return {
        id: String(cuenta).replace(/^act_/, ""),
        nombre: r.name,
        moneda: r.currency ?? "COP",
        activa: Number(r.account_status) === 1,
        minimoDiario: r.min_daily_budget ? deUnidadesMeta(r.min_daily_budget, r.currency) : null,
      };
    },

    /** Paginas de Facebook que maneja el usuario (para el anuncio a WhatsApp). */
    async paginas() {
      const r = await pedir("me/accounts", { params: { fields: "id,name", limit: 100 } });
      return (r?.data ?? []).map((p) => ({ id: String(p.id), nombre: p.name }));
    },

    /** Claves de Meta de las exclusiones geograficas (regiones y ciudades de Colombia). */
    async exclusiones(lista = EXCLUSIONES_ZUNTO) {
      const regiones = [];
      const ciudades = [];
      const faltan = [];
      for (const x of lista) {
        let r;
        try {
          r = await pedir("search", {
            params: { type: "adgeolocation", q: x.q, location_types: [x.tipo], country_code: "CO", limit: 5 },
          });
        } catch {
          faltan.push(x.nombre);
          continue;
        }
        const enCO = (r?.data ?? []).filter((d) => !d.country_code || d.country_code === "CO");
        const d = enCO[0];
        if (!d?.key) {
          faltan.push(x.nombre);
          continue;
        }
        if (x.tipo === "region") regiones.push({ key: String(d.key), name: d.name });
        else ciudades.push({ key: String(d.key), name: d.name });
      }
      return { regiones, ciudades, faltan };
    },

    /** Sube una imagen (bytes) a la biblioteca de la cuenta; devuelve su hash. */
    async subirImagen(cuenta, bytes, nombre = "creativo.jpg") {
      const r = await pedir(`${actDe(cuenta)}/adimages`, {
        method: "POST",
        params: { bytes: Buffer.from(bytes).toString("base64"), name: nombre },
        intentos: 1,
      });
      const img = Object.values(r?.images ?? {})[0];
      if (!img?.hash) throw new Error("Meta no devolvió el hash de la imagen");
      return { hash: String(img.hash), url: img.url ?? null };
    },

    /** Sube un video desde una URL publica; devuelve su id. */
    async subirVideo(cuenta, fileUrl, nombre = "creativo.mp4") {
      const r = await pedir(`${actDe(cuenta)}/advideos`, {
        method: "POST",
        params: { file_url: fileUrl, name: nombre },
        intentos: 1,
      });
      if (!r?.id) throw new Error("Meta no devolvió el id del video");
      return String(r.id);
    },

    /** "ready" | "processing" | "error" */
    async estadoVideo(id) {
      const r = await pedir(String(id), { params: { fields: "status" } });
      return String(r?.status?.video_status ?? "processing");
    },

    /** Campana de ventas con presupuesto de campana (CBO), pausada. */
    async crearCampana(cuenta, { nombre, presupuestoDiario, moneda }) {
      const r = await pedir(`${actDe(cuenta)}/campaigns`, {
        method: "POST",
        intentos: 1,
        params: {
          name: nombre,
          objective: "OUTCOME_SALES",
          status: "PAUSED",
          special_ad_categories: [],
          daily_budget: aUnidadesMeta(presupuestoDiario, moneda),
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        },
      });
      return String(r.id);
    },

    /** Un conjunto: destino WhatsApp, maximizar conversaciones, Colombia con exclusiones. */
    async crearConjunto(cuenta, { campana, nombre, paginaId, exclusiones }) {
      const excl = {};
      if (exclusiones?.regiones?.length) excl.regions = exclusiones.regiones.map((x) => ({ key: x.key }));
      if (exclusiones?.ciudades?.length) excl.cities = exclusiones.ciudades.map((x) => ({ key: x.key }));
      const r = await pedir(`${actDe(cuenta)}/adsets`, {
        method: "POST",
        intentos: 1,
        params: {
          name: nombre,
          campaign_id: campana,
          status: "PAUSED",
          destination_type: "WHATSAPP",
          optimization_goal: "CONVERSATIONS",
          billing_event: "IMPRESSIONS",
          promoted_object: { page_id: paginaId },
          targeting: {
            geo_locations: { countries: ["CO"], location_types: ["home", "recent"] },
            ...(Object.keys(excl).length ? { excluded_geo_locations: excl } : {}),
            targeting_automation: { advantage_audience: 1 },
          },
        },
      });
      return String(r.id);
    },

    /**
     * Creativo con boton de WhatsApp. `medio`: {tipo:"imagen", hash} o
     * {tipo:"video", videoId, portada}. Si Meta rechaza el mensaje de
     * bienvenida, se crea sin el y se avisa.
     */
    async crearCreativo(cuenta, { nombre, paginaId, medio, texto, titulo, descripcion, bienvenida }) {
      const cta = { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
      const armar = (conBienvenida) => {
        const extra = conBienvenida && bienvenida ? { page_welcome_message: bienvenida } : {};
        if (medio.tipo === "video") {
          return {
            page_id: paginaId,
            video_data: {
              video_id: medio.videoId,
              ...(medio.portada ? { image_url: medio.portada } : {}),
              message: texto,
              title: titulo,
              link_description: descripcion,
              call_to_action: { ...cta, value: { ...cta.value, link: "https://api.whatsapp.com/send" } },
              ...extra,
            },
          };
        }
        return {
          page_id: paginaId,
          link_data: {
            image_hash: medio.hash,
            link: "https://api.whatsapp.com/send",
            message: texto,
            name: titulo,
            description: descripcion,
            call_to_action: cta,
            ...extra,
          },
        };
      };
      try {
        const r = await pedir(`${actDe(cuenta)}/adcreatives`, {
          method: "POST",
          intentos: 1,
          params: { name: nombre, object_story_spec: armar(true) },
        });
        return { id: String(r.id), sinBienvenida: false };
      } catch (e) {
        if (!bienvenida) throw e;
        const r = await pedir(`${actDe(cuenta)}/adcreatives`, {
          method: "POST",
          intentos: 1,
          params: { name: nombre, object_story_spec: armar(false) },
        });
        return { id: String(r.id), sinBienvenida: true, aviso: e.message };
      }
    },

    async crearAnuncio(cuenta, { nombre, conjunto, creativo }) {
      const r = await pedir(`${actDe(cuenta)}/ads`, {
        method: "POST",
        intentos: 1,
        params: { name: nombre, adset_id: conjunto, creative: { creative_id: creativo }, status: "PAUSED" },
      });
      return String(r.id);
    },

    /** ACTIVE | PAUSED */
    async cambiarEstado(id, estado) {
      await pedir(String(id), { method: "POST", intentos: 1, params: { status: estado } });
    },

    /** Lo que quedo en Meta (para verificar presupuesto y errores). */
    async revisarCampana(id, moneda) {
      const c = await pedir(String(id), { params: { fields: "name,status,effective_status,daily_budget,issues_info" } });
      return {
        nombre: c.name,
        estado: c.effective_status ?? c.status,
        presupuestoDiario: c.daily_budget ? deUnidadesMeta(c.daily_budget, moneda) : null,
        problemas: (c.issues_info ?? []).map((x) => x.error_message ?? x.error_summary).filter(Boolean),
      };
    },
  };
}
