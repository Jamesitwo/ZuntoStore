// Cuerpo de POST /productos/updateproducto.
//
// El panel oficial manda 87 claves fijas (chunk ProductoScreen); aqui estan
// listadas tal cual y se rellenan con lo que devolvio GET /productos/getproducto/{id}.
// ¿Por que SOLO esas? porque el backend hace un UPDATE con esa lista: mandar
// de mas es ruido, y mandar de menos (p. ej. `mensajeInicial`) puede dejar la
// columna en NULL.
//
// Diferencias GET vs PUT descubiertas comparando una respuesta real con el
// cuerpo oficial:
//   - el GET trae `MensajeInicial` (con mayuscula) y el PUT pide `mensajeInicial`
//   - el GET trae `activeIntegrations` como JSON string ('["dropi"]') y el PUT
//     manda el array (el oficial lo parsea al cargar)
//   - `variantes`, `mixedvariantes`, `imagenes` llegan como array y el PUT los
//     manda con JSON.stringify
//   - `byIdDropanas` no viene en el GET: el oficial lo manda como flag 1/0

export const CLAVES_UPDATE = [
  "idProducto",
  "Nombre",
  "linkAudioVisual",
  "Precio",
  "precioBodega",
  "precioSugerido",
  "fbPixel",
  "tiktokPixel",
  "googlePixel",
  "DescripcionCorta",
  "Descripcion",
  "ModoDeUso",
  "CaracteristicasTecnicas",
  "optLanding",
  "optEcommerce",
  "optSuperBodega",
  "optSuperBodegaPrivado",
  "superbodegaEmails",
  "optMayoristas",
  "optAppMovil",
  "variantes",
  "mixedvariantes",
  "imagenes",
  "Testimonios",
  "preguntaSeguimientoImagenes",
  "preguntaSeguimientoTestimonios",
  "preguntaSeguimientoVideos",
  "videos",
  "optCombVariantes",
  "manageFormEmail",
  "manageFormDocument",
  "idProductoDropi",
  "nameProductoDropi",
  "stock",
  "Reglas",
  "ContenidoPaquete",
  "personalizarMensajeInicial",
  "mensajeInicial",
  "upSell",
  "idProductoUpsell",
  "idVarianteUpsell",
  "discountPercentUpsell",
  "discountValueUpsell",
  "quantityUpsell",
  "personalizarUpSell",
  "PreguntasFrecuentes",
  "preguntasFrecuentesPostVenta",
  "AdsMetaTags",
  "AdsMetaCampaigns",
  "disponibilidadProductoLandingPage",
  "disponibilidadProductoLucidBot",
  "activeIntegration",
  "activeIntegrations",
  "idProductoAveonline",
  "referenciaAveonline",
  "nameProductoAveonline",
  "idProductoMastershop",
  "nameProductoMastershop",
  "idProductoEasyecommerce",
  "nameProductoEasyecommerce",
  "idProductoHoko",
  "nameProductoHoko",
  "idProductoShopify",
  "nameProductoShopify",
  "idProductoEasydrop",
  "nameProductoEasydrop",
  "idProductoVenndelo",
  "idVarianteVenndelo",
  "nameProductoVenndelo",
  "idProducto99envios",
  "idVariante99envios",
  "nameProducto99envios",
  "codigoSucursal99envios",
  "idProductoRocket",
  "nameProductoRocket",
  "idProductoEdrop",
  "nameProductoEdrop",
  "idProductoBoxful",
  "nameProductoBoxful",
  "Ciudad",
  "byIdDropi",
  "eanProductoAliclik",
  "nameProductoAliclik",
  "byEanAliclik",
  "idProductoDropanas",
  "nameProductoDropanas",
  "byIdDropanas",
] as const;

/** El oficial las manda con JSON.stringify (en el GET llegan como string o array). */
const CLAVES_JSON = new Set<string>([
  "variantes",
  "mixedvariantes",
  "imagenes",
  "Testimonios",
  "videos",
  "Reglas",
  "mensajeInicial",
  "upSell",
  "PreguntasFrecuentes",
  "preguntasFrecuentesPostVenta",
  "AdsMetaTags",
  "AdsMetaCampaigns",
]);

/** El oficial las manda como array (no string). */
const CLAVES_ARRAY = new Set<string>(["superbodegaEmails", "activeIntegrations"]);

/** El oficial aplica `?1:0`. */
const CLAVES_FLAG = new Set<string>([
  "optLanding",
  "optEcommerce",
  "optSuperBodega",
  "optSuperBodegaPrivado",
  "optMayoristas",
  "optAppMovil",
  "optCombVariantes",
  "manageFormEmail",
  "manageFormDocument",
  "personalizarMensajeInicial",
  "personalizarUpSell",
  "disponibilidadProductoLandingPage",
  "disponibilidadProductoLucidBot",
  "byEanAliclik",
  "byIdDropanas",
]);

/** clave del PUT -> clave del GET */
const ALIAS: Record<string, string> = {
  mensajeInicial: "MensajeInicial",
};

function parseSiJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/* ------------------------------------------------------------------ */
/*  Mensaje inicial (secuencia de bienvenida del bot)                  */
/* ------------------------------------------------------------------ */

/** Como se edita cada tipo de paso. */
export type FormaPaso = "texto" | "lista" | "espera";

export interface PasoInicial {
  type: string;
  content: unknown;
  id: number | string;
}

/** Tipos que usa el panel oficial en `MensajeInicial`. */
export const TIPOS_INICIAL: Array<{ id: string; label: string; forma: FormaPaso }> = [
  { id: "mensaje_inicial_texto", label: "Texto", forma: "texto" },
  { id: "mensaje_inicial_imagenes", label: "Imágenes", forma: "lista" },
  { id: "mensaje_inicial_videos", label: "Videos", forma: "lista" },
  { id: "mensaje_inicial_audios", label: "Audios", forma: "lista" },
  { id: "mensaje_inicial_espera", label: "Espera", forma: "espera" },
];

/**
 * Tipos de la secuencia de testimonios: MISMA estructura que el mensaje
 * inicial (`{type, content, id}`), con un tipo por medio.
 *
 * OJO: el formato oficial de `Testimonios` es `[{image:url}, {video:url}…]`
 * (un archivo por entrada). Aquí se guardan como pasos por decisión del
 * usuario; `parsearTestimonios` sigue leyendo el formato oficial para no
 * perder lo que ya había.
 */
export const TIPOS_TESTIMONIO: Array<{ id: string; label: string; forma: FormaPaso }> = [
  { id: "testimonio_texto", label: "Texto", forma: "texto" },
  { id: "testimonio_imagenes", label: "Imágenes", forma: "lista" },
  { id: "testimonio_videos", label: "Videos", forma: "lista" },
  { id: "testimonio_audios", label: "Audios", forma: "lista" },
  { id: "testimonio_documento", label: "Documentos", forma: "lista" },
  { id: "testimonio_espera", label: "Espera", forma: "espera" },
];

export function formaDePaso(tipo: string): FormaPaso {
  return (
    TIPOS_INICIAL.find((t) => t.id === tipo)?.forma ??
    TIPOS_TESTIMONIO.find((t) => t.id === tipo)?.forma ??
    "texto"
  );
}

function normalizaContenido(c: unknown, forma: FormaPaso): unknown {
  if (forma === "lista") {
    const arr = Array.isArray(c)
      ? c
      : c === undefined || c === null || c === ""
        ? []
        : [c];
    return arr
      .map((x) => (typeof x === "string" ? x : String((x as any)?.url ?? (x as any)?.src ?? "")))
      .filter(Boolean);
  }
  if (forma === "espera") return c === undefined || c === null ? "1" : String(c);
  return c === undefined || c === null ? "" : String(c);
}

/**
 * `MensajeInicial` (JSON string del GET) -> pasos editables.
 * Si viene vacío o ilegible, devuelve [] (se puede crear desde cero).
 */
export function parsearMensajeInicial(v: unknown): PasoInicial[] {
  let datos: unknown = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "null") return [];
    try {
      datos = JSON.parse(t);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !!(x as any).type)
    .map((x, i) => {
      const tipo = String(x.type);
      return {
        type: tipo,
        content: normalizaContenido(x.content, formaDePaso(tipo)),
        id: (x.id as number | string) ?? Date.now() + i,
      };
    });
}

/** Pasos -> JSON string para `mensajeInicial` (mismo orden de claves que el oficial). */
export function serializarMensajeInicial(pasos: PasoInicial[]): string {
  return JSON.stringify(
    pasos.map((p) => {
      const forma = formaDePaso(p.type);
      const content =
        forma === "lista" && Array.isArray(p.content)
          ? p.content.filter((u) => String(u ?? "").trim())
          : normalizaContenido(p.content, forma);
      return { type: p.type, content, id: p.id };
    }),
  );
}

/** Contenido de arranque para un paso nuevo. */
export function contenidoInicialPaso(tipo: string): unknown {
  const forma = formaDePaso(tipo);
  if (forma === "lista") return [];
  if (forma === "espera") return "1";
  return "";
}

/* ------------------------------------------------------------------ */
/*  Campanas de Meta (Ads)                                             */
/* ------------------------------------------------------------------ */

export interface CampanaMeta {
  value: string;
  label: string;
}

/**
 * Respuesta de `GET /meta/campaigns` (o el valor ya guardado en
 * `AdsMetaCampaigns`) -> [{value, label}]. Tolera id/name por si vienen
 * con otras claves.
 */
export function normalizarCampanas(v: unknown): CampanaMeta[] {
  const lista: any[] = Array.isArray(v)
    ? v
    : v && typeof v === "object" && Array.isArray((v as any).campaigns)
      ? (v as any).campaigns
      : [];
  return lista
    .map((c: any) => ({
      value: String(c?.value ?? c?.id ?? c?.campaign_id ?? c?.campaignId ?? ""),
      label: String(c?.label ?? c?.name ?? c?.nombre ?? c?.title ?? ""),
    }))
    .filter((c) => c.value)
    .map((c) => (c.label ? c : { ...c, label: c.value }));
}

/** `AdsMetaCampaigns` (array de la ficha, o JSON string) -> lista. */
export function campanasGuardadas(v: unknown): CampanaMeta[] {
  if (typeof v === "string") {
    try {
      return normalizarCampanas(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return normalizarCampanas(v);
}

/* ------------------------------------------------------------------ */
/*  Variantes, reglas, preguntas y testimonios                         */
/* ------------------------------------------------------------------ */

/** Limite de combinaciones que impone el panel oficial. */
export const LIMITE_COMBINACIONES = 100;
/** Limite de testimonios (el oficial avisa y trunca). */
export const LIMITE_TESTIMONIOS = 20;

/** Array desde JSON string o array (si no, []). */
export function arreglo(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "null") return [];
    try {
      const j = JSON.parse(t);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Combinaciones posibles = producto de las opciones de cada atributo. */
export function combinaciones(variantes: any[]): number {
  if (!Array.isArray(variantes) || variantes.length === 0) return 0;
  let total = 1;
  for (const v of variantes) {
    const n = (Array.isArray(v?.opciones) ? v.opciones : []).filter(
      (o: any) => o?.nombre && String(o.nombre).trim() !== "",
    ).length;
    if (n > 0) total *= n;
  }
  return total;
}

/** url -> tipo de archivo (el `ur` del oficial). */
export function tipoArchivo(url: string): "image" | "video" | "audio" | "file" {
  const ext = (url.split("?")[0].split(".").pop() ?? "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi", "mkv", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "file";
}

/** url -> paso de testimonio con el tipo que toque según la extensión. */
function pasoDesdeUrl(url: string, i: number): PasoInicial {
  const t = tipoArchivo(url);
  const tipo =
    t === "image"
      ? "testimonio_imagenes"
      : t === "video"
        ? "testimonio_videos"
        : t === "audio"
          ? "testimonio_audios"
          : "testimonio_documento";
  return { type: tipo, content: [url], id: Date.now() + i };
}

/**
 * `Testimonios` -> pasos, MISMA estructura que el mensaje inicial.
 *
 * Lee las DOS formas posibles, así que cambiar de formato no pierde nada:
 *  - la oficial: `[{image:url}, {video:url}, …]` (una entrada por archivo,
 *    hasta 20) o strings sueltos;
 *  - la nuestra: `[{type, content, id}]`.
 */
export function parsearTestimonios(v: unknown): PasoInicial[] {
  return arreglo(v)
    .map((x: any, i: number): PasoInicial | null => {
      if (x && typeof x === "object" && !Array.isArray(x) && typeof x.type === "string") {
        const tipo = TIPOS_TESTIMONIO.some((t) => t.id === x.type) ? x.type : "testimonio_texto";
        return {
          type: tipo,
          content: normalizaContenido(x.content, formaDePaso(tipo)),
          id: x.id ?? Date.now() + i,
        };
      }
      if (typeof x === "string" && x.trim()) return pasoDesdeUrl(x.trim(), i);
      if (x && typeof x === "object") {
        const url = x.image ?? x.video ?? x.audio ?? x.file ?? x.url ?? "";
        if (url) return pasoDesdeUrl(String(url), i);
      }
      return null;
    })
    .filter((p): p is PasoInicial => p !== null);
}

/**
 * Pasos -> valor de `Testimonios`: array de `{type, content, id}`, igualito
 * que `mensajeInicial` (misma serialización, mismas claves y orden).
 */
export function serializarTestimonios(pasos: PasoInicial[]): Array<Record<string, unknown>> {
  return JSON.parse(serializarMensajeInicial(pasos)) as Array<Record<string, unknown>>;
}

/**
 * Monta el cuerpo de updateproducto: las 87 claves oficiales tomadas del objeto
 * que devolvio `getproducto`, con `edicion` (los campos del formulario)
 * aplicado encima. Lo que no este en la lista no se manda (el backend no lo
 * pide), y las claves que falten van con el mismo default que el oficial
 * (flag -> 0, lista -> "[]", resto -> null).
 */
export function armarCuerpoProducto(
  ficha: any,
  edicion: Record<string, unknown>,
): Record<string, unknown> {
  const src: Record<string, unknown> = { ...(ficha ?? {}) };
  for (const [k, v] of Object.entries(edicion)) {
    if (v !== undefined) src[k] = v;
  }

  const idProducto = src.id ?? src.idProducto;
  const integraciones = parseSiJson(src.activeIntegrations);

  const cuerpo: Record<string, unknown> = {};
  for (const clave of CLAVES_UPDATE) {
    if (clave === "idProducto") continue; // se pone al final, con su id real
    let v = src[ALIAS[clave] ?? clave];

    if (clave === "activeIntegration") {
      v =
        Array.isArray(integraciones) && integraciones.length
          ? integraciones[0]
          : (src.activeIntegration ?? "none");
    } else if (CLAVES_FLAG.has(clave)) {
      v = v === true || v === false ? (v ? 1 : 0) : (v ?? 0);
    } else if (CLAVES_ARRAY.has(clave)) {
      const arr = parseSiJson(v);
      v = Array.isArray(arr) ? arr : [];
    } else if (CLAVES_JSON.has(clave)) {
      v = typeof v === "string" ? v : JSON.stringify(v ?? []);
    }

    cuerpo[clave] = v === undefined ? null : v;
  }

  cuerpo.idProducto = (idProducto ?? null) as unknown;
  return cuerpo;
}
