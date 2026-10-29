// TopView por su conector MCP (https://mcp.topview.ai/mcp) en vez de la API.
//
// ¿Por que? La API de TopView cobra creditos aparte; el conector MCP usa los
// creditos del PLAN de la cuenta (el mismo que se conecta en Claude). Zunto se
// conecta como cualquier cliente MCP:
//
//   1. OAuth 2.1 con PKCE (como Claude o Cursor): la persona inicia sesion en
//      TopView y autoriza a Zunto. Se descubre el servidor de autorizacion
//      (RFC 9728 / RFC 8414) y Zunto se registra solo (RFC 7591).
//   2. JSON-RPC sobre HTTP (Streamable HTTP de MCP): initialize -> tools/call.
//
// El cliente expone lo mismo que crearClienteTopView (topview.js): creditos,
// subir, imagen, video y consultar.
import crypto from "node:crypto";
import { DEFECTOS_TOPVIEW } from "./topview.js";

export const MCP_TOPVIEW = "https://mcp.topview.ai/mcp";
const VERSION_MCP = "2025-06-18";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function jsonDe(fetcher, url, opciones = {}) {
  try {
    const r = await fetcher(url, { ...opciones, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Descubre donde se autoriza el conector: metadatos del recurso protegido
 * (cabecera WWW-Authenticate o /.well-known) y del servidor de autorizacion.
 */
export async function descubrirOAuth({ mcpUrl = MCP_TOPVIEW, fetcher = globalThis.fetch } = {}) {
  const u = new URL(mcpUrl);
  const candidatosPRM = [];
  try {
    const r = await fetcher(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: VERSION_MCP, capabilities: {}, clientInfo: { name: "zunto", version: "1" } } }),
      signal: AbortSignal.timeout(20000),
    });
    const m = String(r.headers?.get?.("www-authenticate") ?? "").match(/resource_metadata="([^"]+)"/i);
    if (m) candidatosPRM.push(m[1]);
  } catch {
    /* sin cabecera: se prueban las rutas conocidas */
  }
  const ruta = u.pathname.replace(/\/+$/, "");
  candidatosPRM.push(`${u.origin}/.well-known/oauth-protected-resource${ruta}`, `${u.origin}/.well-known/oauth-protected-resource`);
  let prm = null;
  for (const c of candidatosPRM) {
    prm = await jsonDe(fetcher, c);
    if (prm?.authorization_servers?.length) break;
    prm = null;
  }
  const issuer = String(prm?.authorization_servers?.[0] ?? u.origin).replace(/\/+$/, "");
  const iu = new URL(issuer);
  const ip = iu.pathname.replace(/\/+$/, "");
  const candidatosAS = [
    `${iu.origin}/.well-known/oauth-authorization-server${ip}`,
    `${iu.origin}/.well-known/openid-configuration${ip}`,
    ...(ip ? [`${issuer}/.well-known/openid-configuration`, `${issuer}/.well-known/oauth-authorization-server`] : []),
  ];
  let meta = null;
  for (const c of candidatosAS) {
    meta = await jsonDe(fetcher, c);
    if (meta?.authorization_endpoint && meta?.token_endpoint) break;
    meta = null;
  }
  // MCP 2025-03: sin metadatos, rutas por defecto en el origen
  meta = meta ?? {
    authorization_endpoint: `${iu.origin}/authorize`,
    token_endpoint: `${iu.origin}/token`,
    registration_endpoint: `${iu.origin}/register`,
  };
  return {
    issuer,
    recurso: prm?.resource ?? mcpUrl,
    scopes: Array.isArray(prm?.scopes_supported) ? prm.scopes_supported : Array.isArray(meta.scopes_supported) ? meta.scopes_supported : [],
    autorizar: meta.authorization_endpoint,
    token: meta.token_endpoint,
    registro: meta.registration_endpoint ?? null,
    pkce: meta.code_challenge_methods_supported ?? ["S256"],
  };
}

/** Registro dinamico del cliente (RFC 7591). */
export async function registrarCliente({ registro, redirect, fetcher = globalThis.fetch }) {
  if (!registro) throw new Error("TopView no permite registrar aplicaciones nuevas en su conector (no tiene registro dinámico)");
  let r;
  try {
    r = await fetcher(registro, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Zunto Store",
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(`No se pudo registrar Zunto en TopView: ${e?.message ?? e}`);
  }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.client_id) {
    throw new Error(`TopView no aceptó registrar a Zunto (HTTP ${r.status}${d?.error ? `: ${d.error_description ?? d.error}` : ""})`);
  }
  return { clientId: String(d.client_id), clientSecret: d.client_secret ? String(d.client_secret) : null };
}

/** URL para que la persona autorice + lo que hay que recordar hasta la vuelta. */
export function urlAutorizacion({ descubierto, cliente, redirect }) {
  const verificador = b64url(crypto.randomBytes(48));
  const reto = b64url(crypto.createHash("sha256").update(verificador).digest());
  const estado = b64url(crypto.randomBytes(24));
  const u = new URL(descubierto.autorizar);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cliente.clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("code_challenge", reto);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", estado);
  u.searchParams.set("resource", descubierto.recurso);
  if (descubierto.scopes.length) u.searchParams.set("scope", descubierto.scopes.join(" "));
  return { url: u.toString(), estado, verificador };
}

/** Cambia el codigo (o el refresh token) por tokens. */
export async function pedirToken({ tokenUrl, params, cliente, fetcher = globalThis.fetch }) {
  const cuerpo = new URLSearchParams({ ...params, client_id: cliente.clientId, ...(cliente.clientSecret ? { client_secret: cliente.clientSecret } : {}) });
  let r;
  try {
    r = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: cuerpo,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(`TopView no respondió al pedir el acceso: ${e?.message ?? e}`);
  }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.access_token) {
    throw new Error(`TopView no entregó el acceso (HTTP ${r.status}${d?.error ? `: ${d.error_description ?? d.error}` : ""})`);
  }
  return {
    access: String(d.access_token),
    refresh: d.refresh_token ? String(d.refresh_token) : (params.refresh_token ?? null),
    expira: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null,
  };
}

// ------------------------------------------------------------ cliente MCP

/** Lee una respuesta JSON o SSE (text/event-stream) y devuelve el mensaje con ese id. */
async function leerRespuesta(r, id) {
  const tipo = String(r.headers?.get?.("content-type") ?? "");
  const texto = await r.text();
  if (tipo.includes("text/event-stream") || /^(event|data):/m.test(texto)) {
    for (const bloque of texto.split(/\r?\n\r?\n/)) {
      const datos = bloque
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!datos) continue;
      try {
        const m = JSON.parse(datos);
        if (m?.id === id) return m;
      } catch {
        /* evento que no es JSON */
      }
    }
    return null;
  }
  try {
    const m = JSON.parse(texto);
    return Array.isArray(m) ? m.find((x) => x?.id === id) ?? null : m;
  } catch {
    return null;
  }
}

/** Resultado de una herramienta de TopView -> objeto (lanza si fallo). */
export function resultadoHerramienta(res) {
  if (res?.error) throw new Error(`TopView: ${res.error.message ?? "error del conector"}`);
  const r = res?.result ?? {};
  let datos = r.structuredContent ?? null;
  if (!datos) {
    const texto = (r.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("");
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = { message: texto };
    }
  }
  if (r.isError) throw new Error(`TopView: ${datos?.message ?? datos?.msg ?? JSON.stringify(datos).slice(0, 200)}`);
  if (datos?.code !== undefined && String(datos.code) !== "200") {
    throw new Error(`TopView: ${datos.message ?? datos.msg ?? `código ${datos.code}`}`);
  }
  return datos?.result ?? datos;
}

/**
 * Cliente con la misma forma que crearClienteTopView, pero por el conector.
 * @param {() => Promise<string>} obtenerToken  access token vigente
 */
export function crearClienteTopViewMcp({ obtenerToken, mcpUrl = MCP_TOPVIEW, fetcher = globalThis.fetch, timeoutMs = 90000 }) {
  let sesion = null;
  let siguiente = 1;

  async function enviar(mensaje, token) {
    return fetcher(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": VERSION_MCP,
        ...(sesion ? { "mcp-session-id": sesion } : {}),
      },
      body: JSON.stringify(mensaje),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function iniciar(token) {
    sesion = null;
    const id = siguiente++;
    const r = await enviar({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: VERSION_MCP, capabilities: {}, clientInfo: { name: "zunto-store", version: "1.0" } } }, token);
    if (r.status === 401) throw new Error("TopView cerró el acceso de Zunto: vuelve a conectar tu cuenta (Creador IA > Ajustes)");
    if (!r.ok) throw new Error(`El conector de TopView respondió HTTP ${r.status}`);
    sesion = r.headers?.get?.("mcp-session-id") ?? null;
    const m = await leerRespuesta(r, id);
    if (m?.error) throw new Error(`TopView: ${m.error.message}`);
    await enviar({ jsonrpc: "2.0", method: "notifications/initialized" }, token).catch(() => null);
  }

  async function herramienta(nombre, args, reintento = true) {
    const token = await obtenerToken();
    if (!sesion) await iniciar(token);
    const id = siguiente++;
    let r;
    try {
      r = await enviar({ jsonrpc: "2.0", id, method: "tools/call", params: { name: nombre, arguments: args } }, token);
    } catch (e) {
      throw new Error(`El conector de TopView no respondió: ${e?.message ?? e}`);
    }
    // sesion vencida: se inicia otra y se repite una vez
    if ((r.status === 404 || r.status === 400) && reintento) {
      sesion = null;
      return herramienta(nombre, args, false);
    }
    if (r.status === 401) throw new Error("TopView cerró el acceso de Zunto: vuelve a conectar tu cuenta (Creador IA > Ajustes)");
    if (!r.ok) throw new Error(`El conector de TopView respondió HTTP ${r.status}`);
    const m = await leerRespuesta(r, id);
    if (!m) throw new Error("El conector de TopView no devolvió respuesta");
    return resultadoHerramienta(m);
  }

  return {
    modo: "cuenta",
    herramienta,

    async creditos() {
      const r = await herramienta("topview_get_credit", { req: {} });
      const n = Number(r?.remainCredit);
      return Number.isFinite(n) ? n : null;
    },

    async subir(bytes, tipo = "image/jpeg") {
      const formato = /png/i.test(tipo) ? "png" : /webp/i.test(tipo) ? "webp" : /mp4/i.test(tipo) ? "mp4" : "jpg";
      const cred = await herramienta("ta_upload_credential", { format: formato });
      const fileId = cred?.fileId;
      const uploadUrl = cred?.uploadUrl ?? cred?.accelerateUrl;
      if (!fileId || !uploadUrl) throw new Error("TopView no devolvió a dónde subir la foto");
      let put;
      try {
        put = await fetcher(uploadUrl, { method: "PUT", body: bytes, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new Error(`No se pudo subir la foto a TopView: ${e?.message ?? e}`);
      }
      if (!put.ok) throw new Error(`No se pudo subir la foto a TopView (HTTP ${put.status})`);
      const ok = await herramienta("ta_upload_check_file", { fileId: String(fileId) });
      if (ok === false) throw new Error("TopView no confirmó la foto subida");
      return String(fileId);
    },

    async imagen({ prompt, fileIds = [], ...opciones }) {
      const p = { ...DEFECTOS_TOPVIEW.imagen, ...opciones };
      const tipo = fileIds.length ? "image_edit" : "text_to_image";
      const r = await herramienta("topview_generate_image", {
        req: {
          taskType: tipo,
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

    async video({ prompt, fileIds = [], ...opciones }) {
      const p = { ...DEFECTOS_TOPVIEW.video, ...opciones };
      const r = await herramienta("topview_generate_video", {
        req: {
          taskType: "omni_reference",
          model: p.model,
          prompt: String(prompt ?? "").slice(0, 8000),
          inputImages: fileIds.map((fileId, i) => ({ fileId, name: `Image${i + 1}` })),
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          duration: p.duration,
          generatingCount: 1,
        },
      });
      if (!r?.taskId) throw new Error("TopView no devolvió el id de la tarea");
      return { tipo: "omni_reference", taskId: String(r.taskId) };
    },

    async consultar(tipo, taskId) {
      // los nombres de la API (text2image) se pasan a los del conector
      const t = tipo === "text2image" ? "text_to_image" : tipo;
      const r = await herramienta("topview_query_task", { req: { taskType: t, taskId, needCloudFrontUrl: true, shortenUrls: false } });
      const st = String(r?.status ?? "").toLowerCase();
      const lista = Array.isArray(r?.images) ? r.images : Array.isArray(r?.videos) ? r.videos : [];
      const item = lista.find((x) => String(x?.status ?? "success").toLowerCase() === "success" && x?.filePath);
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
      if (st === "fail" || st === "failed" || st === "success") {
        return { estado: "fallo", error: String(r?.errorMsg || lista[0]?.errorMsg || "TopView no pudo generarlo") };
      }
      return { estado: "en-curso" };
    },
  };
}
