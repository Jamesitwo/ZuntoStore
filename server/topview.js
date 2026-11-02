// Cliente de la API de TopView (https://api.topview.ai): imagenes con
// GPT Image (image_edit) y videos con Seedance (omni_reference).
//
// Cabeceras: Authorization: Bearer <apiKey> y Topview-Uid: <uid>.
// Las fotos de referencia se suben asi:
//   1. GET /v1/upload/credential?format=png      -> {fileId, uploadUrl}
//   2. PUT <uploadUrl> con los bytes (URL firmada de S3)
//   3. GET /v1/upload/check?fileId=...           -> true
// Cada tarea devuelve un taskId; se consulta con .../task/query?taskId= hasta
// status "success" | "fail" (init y running = sigue).
const BASE = "https://api.topview.ai";

/** Ajustes por defecto de Zunto (los mismos de la skill de creativos). */
export const DEFECTOS_TOPVIEW = {
  imagen: { model: "GPT Image 2.5 Flare", resolution: "1K", aspectRatio: "4:5", quality: "medium" },
  video: { model: "Seedance 2.5", resolution: 480, duration: 12, aspectRatio: "9:16" },
};

/** Tipos de tarea -> rutas de submit y query. */
const RUTAS = {
  image_edit: "/v1/common_task/image_edit/task",
  text2image: "/v1/common_task/text2image/task",
  omni_reference: "/v1/common_task/omni_reference/task",
};

/**
 * Seedance (omni_reference) rechaza fotos que el prompt no nombra ("Image3 is
 * not referenced in prompt"). Se mandan solo las que el prompt menciona y se
 * renumeran en orden (Image1, Image2...) cambiando tambien el prompt. Si no
 * nombra ninguna, se usa la primera foto del producto y se agrega al prompt.
 */
export function prepararReferencias(prompt, fileIds = []) {
  let texto = String(prompt ?? "");
  const usadas = [];
  for (const m of texto.matchAll(/image\s*(\d+)/gi)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= fileIds.length && !usadas.includes(n)) usadas.push(n);
  }
  usadas.sort((a, b) => a - b);
  if (!usadas.length) {
    if (!fileIds.length) return { prompt: texto, inputImages: [] };
    return {
      prompt: `${texto}\n\nProducto de referencia (fidelidad estricta a su forma, colores y logo): <<<Image1>>>`,
      inputImages: [{ fileId: fileIds[0], name: "Image1" }],
    };
  }
  const nuevo = new Map(usadas.map((n, i) => [n, i + 1]));
  texto = texto.replace(/(image\s*)(\d+)/gi, (todo, pre, num) => (nuevo.has(Number(num)) ? `${pre}${nuevo.get(Number(num))}` : todo));
  return { prompt: texto, inputImages: usadas.map((n, i) => ({ fileId: fileIds[n - 1], name: `Image${i + 1}` })) };
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

export function crearClienteTopView({ apiKey, uid, fetcher = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const clave = String(apiKey ?? "").trim();
  const usuario = String(uid ?? "").trim();

  async function llamar(ruta, { method = "GET", body, query } = {}) {
    if (!clave || !usuario) throw new Error("Falta la API key o el UID de TopView (Creador IA > Ajustes)");
    const url = new URL(BASE + ruta);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetcher(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${clave}`,
          "Topview-Uid": usuario,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`TopView no respondió: ${e?.message ?? e}`);
    }
    const datos = await res.json().catch(() => null);
    const codigo = String(datos?.code ?? res.status);
    if (!res.ok || (datos && codigo !== "200")) {
      const msg = datos?.message || datos?.msg || `HTTP ${res.status}`;
      const pista = res.status === 401 || codigo === "401" ? " (revisa la API key y el UID)" : "";
      throw new Error(`TopView: ${msg}${pista}`);
    }
    return datos?.result ?? datos;
  }

  return {
    /** Creditos disponibles (para avisar antes de generar videos). */
    async creditos() {
      const r = await llamar("/user/credit/detail");
      const n = Number(r?.remainCredit);
      return Number.isFinite(n) ? n : null;
    },

    /**
     * Sube una imagen (bytes) y devuelve su fileId.
     * @param {Buffer|Uint8Array} bytes
     * @param {string} tipo  content-type (image/png, image/jpeg...)
     */
    async subir(bytes, tipo = "image/jpeg") {
      const formato = EXT[String(tipo).toLowerCase()] ?? "jpg";
      const cred = await llamar("/v1/upload/credential", { query: { format: formato } });
      if (!cred?.fileId || !cred?.uploadUrl) throw new Error("TopView no devolvió a dónde subir la foto");
      let put;
      try {
        put = await fetcher(cred.uploadUrl, { method: "PUT", body: bytes, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new Error(`No se pudo subir la foto a TopView: ${e?.message ?? e}`);
      }
      if (!put.ok) throw new Error(`No se pudo subir la foto a TopView (HTTP ${put.status})`);
      const ok = await llamar("/v1/upload/check", { query: { fileId: cred.fileId } });
      if (ok === false) throw new Error("TopView no confirmó la foto subida");
      return String(cred.fileId);
    },

    /**
     * Imagen a partir de fotos de referencia (las fotos van como Image1,
     * Image2... en el prompt). Devuelve el taskId.
     */
    async imagen({ prompt, fileIds = [], ...opciones }) {
      const p = { ...DEFECTOS_TOPVIEW.imagen, ...opciones };
      const tipo = fileIds.length ? "image_edit" : "text2image";
      const r = await llamar(`${RUTAS[tipo]}/submit`, {
        method: "POST",
        body: {
          model: p.model,
          prompt: String(prompt ?? "").slice(0, 8000),
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          quality: p.quality,
          generateCount: 1,
          ...(fileIds.length ? { inputImageFileIds: fileIds } : {}),
        },
      });
      if (!r?.taskId) throw new Error("TopView no devolvió el id de la tarea");
      return { tipo, taskId: String(r.taskId) };
    },

    /**
     * Video con referencias (omni_reference). En el prompt las fotos se
     * nombran <<<Image1>>>, <<<Image2>>>...
     */
    async video({ prompt, fileIds = [], ...opciones }) {
      const p = { ...DEFECTOS_TOPVIEW.video, ...opciones };
      const refs = prepararReferencias(prompt, fileIds);
      const r = await llamar(`${RUTAS.omni_reference}/submit`, {
        method: "POST",
        body: {
          model: p.model,
          prompt: refs.prompt.slice(0, 8000),
          inputImages: refs.inputImages,
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          duration: p.duration,
          generatingCount: 1,
        },
      });
      if (!r?.taskId) throw new Error("TopView no devolvió el id de la tarea");
      return { tipo: "omni_reference", taskId: String(r.taskId) };
    },

    /**
     * Estado de una tarea: {estado: "en-curso"|"listo"|"fallo", url, portada,
     * creditos, error}.
     */
    async consultar(tipo, taskId) {
      const ruta = RUTAS[tipo];
      if (!ruta) throw new Error(`Tipo de tarea desconocido: ${tipo}`);
      const r = await llamar(`${ruta}/query`, { query: { taskId, needCloudFrontUrl: true } });
      const st = String(r?.status ?? "").toLowerCase();
      const item = (Array.isArray(r?.images) ? r.images : Array.isArray(r?.videos) ? r.videos : []).find(
        (x) => String(x?.status ?? "success").toLowerCase() === "success" && x?.filePath,
      );
      if (st === "success" && item) {
        return {
          estado: "listo",
          url: item.filePath,
          portada: item.coverPath ?? null,
          ancho: item.width ?? null,
          alto: item.height ?? null,
          creditos: Number(r?.costCredit) || null,
        };
      }
      if (st === "fail" || st === "success") {
        const err = r?.errorMsg || (Array.isArray(r?.images ?? r?.videos) ? (r.images ?? r.videos)[0]?.errorMsg : "") || "TopView no pudo generarlo";
        return { estado: "fallo", error: String(err) };
      }
      return { estado: "en-curso" };
    },
  };
}
