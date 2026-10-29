// Creador de campanas IA: de un producto a una campana de Meta a WhatsApp.
//
//   1. proyecto   el usuario elige el producto, sus fotos y el presupuesto
//   2. plan       la IA escribe angulos, prompts de cada creativo, copys,
//                 ficha y mensaje de bienvenida (todo editable en el panel)
//   3. creativos  TopView genera imagenes (GPT Image) y videos (Seedance);
//                 se consultan en segundo plano hasta que estan listos
//   4. campana    se suben a Meta y se crea campana + conjunto + un anuncio
//                 por creativo, TODO PAUSADO
//   5. activar    solo cuando la persona lo pide
//
// Cada usuario del panel tiene lo suyo (como en Anuncios):
//   <ANUNCIOS_DIR>/creador/<slug>/ajustes.json      TopView, cuenta, pagina (cifrado)
//   <ANUNCIOS_DIR>/creador/<slug>/proyectos/<id>.json
import fs from "node:fs";
import path from "node:path";
import { slugDe } from "./anunciosTenant.js";
import { EXCLUSIONES_ZUNTO, crearMetaCampanas, mensajeBienvenida } from "./metaCampanas.js";
import { escribirJsonSeguro, leerJsonSeguro } from "./secretos.js";
import { crearClienteTopView, DEFECTOS_TOPVIEW } from "./topview.js";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Costo aproximado en creditos de TopView (para avisar antes de generar). */
export const COSTO_CREDITOS = { imagen: 0.2, video: 6.7 };
export const PRESUPUESTO_DEFECTO = 25000;
const MAX_FOTOS = 6;
const MAX_IMAGENES = 6;
const MAX_VIDEOS = 4;

const ahora = () => new Date().toISOString();
const nuevoId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const enmascarar = (k) => (k ? (k.length <= 10 ? `…${k.slice(-2)}` : `${k.slice(0, 4)}…${k.slice(-4)}`) : "");
export const precioTexto = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO").replace(/,/g, ".")}`;

function fechaCorta(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// ----------------------------------------------------------------- la IA

/** Reglas para la IA (las mismas de la skill zunto-meta-creativos). */
export function promptSistema({ marca = "ZUNTO", contraEntrega = false } = {}) {
  return `Eres el director creativo de ${marca}, una tienda online colombiana que vende por Meta Ads con destino WhatsApp.
Escribes en español colombiano, tono directo y práctico. Devuelves SOLO un JSON.

REGLAS DE MARCA (en TODOS los creativos publicitarios):
- Debe verse "${marca}" (en amarillo) y el precio en formato $199.900 (punto de miles, sin decimales).
- CTA siempre a WhatsApp: "Escríbenos por WhatsApp", botón verde con ícono de WhatsApp en las imágenes de oferta.
- "Envío GRATIS" y "Garantía" cuando apliquen.${contraEntrega ? ' Puedes decir "Pago contra entrega".' : ' NO digas "pago contra entrega".'}
- Nunca inventes especificaciones (RPM, medidas, tiempos, cifras): usa solo lo que dan los datos del producto.
- Si algo no viene en el kit pero aparece en uso, nunca lo listes como incluido.

PROMPTS DE IMAGEN (TopView, GPT Image, formato 4:5): las fotos reales del producto llegan como Image1, Image2...
Estructura: Estilo → Escena → Producto (fidelidad estricta a Image1..., anatomía pieza por pieza con colores y tamaño real; "no deformar el logo, no cambiar colores, no agregar piezas, no copiar textos de las imágenes de referencia") → Composición (dónde va el producto, espacio para el título) → Texto sobre la imagen (título, subtítulo, badge de precio, ${marca}, franja/botón de WhatsApp) → Look (tipografía Montserrat Black, foto real).
Ángulos por defecto, en este orden: 1) problema → solución / lifestyle de uso; 2) kit "Todo esto por $X" (valor percibido); 3) infografía de 4–5 beneficios; 4) oferta directa de alto contraste con botón de WhatsApp y urgencia. Si piden más, varía escenas.

PROMPTS DE VIDEO (TopView, Seedance, 12 s, 9:16): las fotos se nombran <<<Image1>>>, <<<Image2>>>...
Estructura: ESCENA → GUION con tiempos (0–3 s gancho, 3–9 s demostración/beneficios, 9–12 s precio + CTA WhatsApp) → TEXTOS EN PANTALLA con segundo exacto (el último: "$PRECIO · ENVÍO GRATIS" amarillo grande + "ESCRÍBENOS POR WHATSAPP" y "${marca}") → AUDIO.
Una sola acción de cámara por plano, movimientos lentos, sin giros rápidos del producto. Diálogo corto.
VOZ: español colombiano con acento de Bogotá, dulce y seguro; no paisa, no costeño, no argentino, no mexicano, no de España. Trata de "tú" (nunca voseo). Números siempre en palabras.
Si hay PERSONAJE (la última foto), descríbelo: "PERSONAJE <<<ImageN>>>: la misma mujer de la foto: mismo rostro, ojos, sonrisa, tono de piel y cabello" y ropa de cuello cerrado (Meta frena anuncios con escote).
Seguridad cuando aplique (herramientas con las dos manos, gafas y guantes). Si el producto se pliega o se arma, describe el movimiento paso a paso ("no aparece de golpe").
Ángulos de video por defecto: 1) UGC recomendación (la persona presenta y demuestra); 2) demostración satisfactoria / problema-solución; 3) unboxing "Esto es lo que te llega".

COPY (uno por creativo, repite el ángulo del creativo):
- texto: gancho con emoji → beneficio → bullets con emojis → "💰 $PRECIO · 🚚 Envío GRATIS" → "👉 Escríbenos por WhatsApp...".
- titulo: máximo 40 caracteres.
- descripcion: corta.

FICHA: descripcion (beneficios + para quién + qué incluye + variantes), modoUso (pasos numerados + seguridad), caracteristicas ("• Campo: valor", solo datos confirmados), contenido ("1 X + 2 Y" y "Z no incluido" si aplica).

BIENVENIDA de WhatsApp (para responderle al cliente):
"¡Hola! 👋 Bienvenido(a) a ${marca} [emoji]\\n\\nGracias por escribirnos por [producto]\\n\\n✅ beneficio 1\\n✅ beneficio 2\\n✅ beneficio 3\\n📦 Incluye: ...\\n\\n💰 Precio: $X\\n🚚 Envío GRATIS a toda Colombia\\n🛡️ Garantía incluida\\n\\n[pregunta abierta]"

JSON de salida:
{"creativos":[{"tipo":"imagen"|"video","angulo":"nombre corto","prompt":"...","copy":{"texto":"...","titulo":"...","descripcion":"..."}}],
 "ficha":{"descripcion":"...","modoUso":"...","caracteristicas":"...","contenido":"..."},
 "bienvenida":"...",
 "mensajePredefinido":"¡Hola! Quiero más información del [producto].",
 "faltan":["datos del producto que harían falta, sin inventarlos"]}`;
}

export function promptUsuario(p, { conPersonaje = false } = {}) {
  const pr = p.producto ?? {};
  const fotos = p.fotos?.length ?? 0;
  return [
    `Producto: ${pr.nombre}`,
    `Precio: ${precioTexto(pr.precio)}`,
    pr.descripcion ? `Descripción: ${pr.descripcion}` : "",
    pr.contenido ? `Contenido del paquete: ${pr.contenido}` : "",
    pr.variantes ? `Variantes: ${pr.variantes}` : "",
    p.notas ? `Indicaciones del usuario: ${p.notas}` : "",
    `Fotos del producto: ${fotos} (Image1 a Image${fotos}).`,
    conPersonaje
      ? `En los videos hay personaje: es la foto Image${fotos + 1} (en el prompt de video: <<<Image${fotos + 1}>>>).`
      : "Sin personaje: los videos muestran solo el producto (manos si hace falta).",
    `Genera ${p.cantidades.imagenes} creativos de imagen y ${p.cantidades.videos} de video, en ese orden.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Modelos de Claude que se pueden elegir (el primero es el de por defecto). */
export const MODELOS_CLAUDE = [
  { id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5 · recomendado" },
  { id: "claude-opus-5-5", nombre: "Claude Opus 5.5 · el más fino" },
  { id: "claude-haiku-5-5", nombre: "Claude Haiku 5.5 · económico" },
];

/** Saca el JSON de la respuesta (aunque venga envuelto en ```json). */
export function jsonDeTexto(c) {
  const t = String(c ?? "");
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* sigue */
      }
    }
  }
  throw new Error("La IA no devolvió un JSON válido");
}

/**
 * Plan con Claude (API de Anthropic). Claude VE las fotos del producto: asi
 * describe la anatomia real pieza por pieza en los prompts (lo que mas evita
 * que TopView lo deforme). Si Anthropic no puede abrir las fotos, se repite
 * sin ellas.
 */
export async function pedirPlanClaude({ apiKey, modelo, sistema, usuario, fotos = [], fetcher = globalThis.fetch, timeoutMs = 300000 }) {
  if (!apiKey) throw new Error("No hay API key de Claude (Creador IA > Ajustes)");
  const llamar = async (conFotos) => {
    const contenido = [
      ...(conFotos
        ? fotos.slice(0, 7).flatMap((url, i) => [
            { type: "text", text: `Foto Image${i + 1}:` },
            { type: "image", source: { type: "url", url } },
          ])
        : []),
      {
        type: "text",
        text: `${usuario}\n\n${conFotos && fotos.length ? "Mira las fotos con cuidado: describe el producto tal como se ve (piezas, colores, textos, tamaño). " : ""}Responde SOLO con el JSON, sin texto antes ni después.`,
      },
    ];
    let r;
    try {
      r = await fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: modelo || MODELOS_CLAUDE[0].id,
          max_tokens: 16000,
          system: sistema,
          messages: [{ role: "user", content: contenido }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(e?.name === "TimeoutError" ? "Claude tardó demasiado en responder" : `No se pudo llamar a Claude: ${e?.message ?? e}`);
    }
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = d?.error?.message ?? `HTTP ${r.status}`;
      const err = new Error(
        `Claude respondió ${r.status}${r.status === 401 ? " (API key inválida)" : r.status === 429 ? " (límite de uso)" : r.status === 400 && /credit/i.test(msg) ? " (sin saldo)" : ""}: ${String(msg).slice(0, 200)}`,
      );
      err.status = r.status;
      err.porFoto = r.status === 400 && /image|url|media/i.test(msg);
      throw err;
    }
    if (d?.stop_reason === "max_tokens") throw new Error("Claude se quedó sin espacio para responder: pide menos creativos");
    return jsonDeTexto((d?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join(""));
  };
  try {
    return await llamar(fotos.length > 0);
  } catch (e) {
    if (e?.porFoto) return llamar(false);
    throw e;
  }
}

/** Prueba la llave de Claude con una peticion minima. */
export async function probarClaude({ apiKey, modelo, fetcher = globalThis.fetch }) {
  const r = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: modelo || MODELOS_CLAUDE[0].id, max_tokens: 16, messages: [{ role: "user", content: "Responde: ok" }] }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Claude respondió ${r.status}: ${String(d?.error?.message ?? "").slice(0, 200)}`);
  return true;
}

/** Llama a la IA (API compatible con OpenAI) y devuelve el JSON. */
export async function pedirPlanIA({ base, modelo, apiKey, sistema, usuario, fetcher = globalThis.fetch, timeoutMs = 180000 }) {
  if (!apiKey) throw new Error("No hay API key de la IA (Ajustes > Subida a Dropi > IA que lee los chats)");
  const url = `${String(base || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  let r;
  try {
    r = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelo || "gpt-5-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(e?.name === "TimeoutError" ? "La IA tardó demasiado en responder" : `No se pudo llamar a la IA: ${e?.message ?? e}`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`La IA respondió ${r.status}${r.status === 401 ? " (API key inválida)" : r.status === 429 ? " (sin saldo o límite)" : ""}: ${t.slice(0, 160)}`);
  }
  const d = await r.json().catch(() => null);
  return jsonDeTexto(d?.choices?.[0]?.message?.content ?? "");
}

const txt = (v, max = 4000) => String(v ?? "").trim().slice(0, max);

/** Normaliza lo que devolvio la IA a la forma del proyecto. */
export function normalizarPlan(crudo, cantidades) {
  const lista = Array.isArray(crudo?.creativos) ? crudo.creativos : [];
  const tomar = (tipo, n) =>
    lista
      .filter((c) => String(c?.tipo ?? "").toLowerCase().startsWith(tipo === "imagen" ? "imag" : "vid"))
      .slice(0, n)
      .map((c, i) => ({
        id: `${tipo === "imagen" ? "img" : "vid"}${i + 1}`,
        tipo,
        angulo: txt(c?.angulo, 80) || `${tipo === "imagen" ? "Imagen" : "Video"} ${i + 1}`,
        prompt: txt(c?.prompt, 7000),
        copy: {
          texto: txt(c?.copy?.texto, 2000),
          titulo: txt(c?.copy?.titulo, 40),
          descripcion: txt(c?.copy?.descripcion, 120),
        },
        incluir: true,
        estado: "borrador",
      }));
  const creativos = [...tomar("imagen", cantidades.imagenes), ...tomar("video", cantidades.videos)].filter((c) => c.prompt);
  if (!creativos.length) throw new Error("La IA no devolvió creativos");
  const f = crudo?.ficha ?? {};
  return {
    creativos,
    ficha: {
      descripcion: txt(f.descripcion),
      modoUso: txt(f.modoUso),
      caracteristicas: txt(f.caracteristicas),
      contenido: txt(f.contenido, 500),
    },
    bienvenida: txt(crudo?.bienvenida, 1500),
    mensajePredefinido: txt(crudo?.mensajePredefinido, 300),
    faltan: (Array.isArray(crudo?.faltan) ? crudo.faltan : []).map((x) => txt(x, 200)).filter(Boolean).slice(0, 10),
  };
}

// ------------------------------------------------------------- el modulo

/**
 * @param {object} o
 * @param {string} o.baseDir                 ANUNCIOS_DIR
 * @param {(usuario) => ({token, version, cuentas}|null)} o.credencialMeta
 * @param {typeof fetch} [o.fetcher]
 * @param {number} [o.cadaMs]                consulta de tareas de TopView
 */
/** Que IA escribe el plan: Claude si hay llave (salvo que elijan la de Zunto). */
const iaDe = (a) => (a.iaProveedor === "zunto" ? "zunto" : a.claudeKey ? "claude" : a.iaProveedor === "claude" ? "claude" : "zunto");

export function crearCreadorCampanas({ baseDir, credencialMeta, fetcher = globalThis.fetch, cadaMs = 15000, log = console, esperaVideoMs = 5000 }) {
  const raiz = path.join(baseDir, "creador");
  const dirDe = (slug) => path.join(raiz, slug);
  const rutaAjustes = (slug) => path.join(dirDe(slug), "ajustes.json");
  const dirProyectos = (slug) => path.join(dirDe(slug), "proyectos");
  const rutaProyecto = (slug, id) => path.join(dirProyectos(slug), `${String(id).replace(/[^a-z0-9_]/gi, "")}.json`);
  /** proyectos con algo corriendo en este proceso (no se pisan) */
  const ocupados = new Set();
  let reloj = null;

  function slugOError(usuario) {
    const s = slugDe(usuario);
    if (!s) throw new Error("Falta el usuario del panel");
    return s;
  }

  function leerAjustes(slug) {
    try {
      return leerJsonSeguro(rutaAjustes(slug)) ?? {};
    } catch {
      return {};
    }
  }

  function leerP(slug, id) {
    try {
      return JSON.parse(fs.readFileSync(rutaProyecto(slug, id), "utf8"));
    } catch {
      return null;
    }
  }

  function guardarP(slug, p) {
    p.actualizado = ahora();
    fs.mkdirSync(dirProyectos(slug), { recursive: true });
    const r = rutaProyecto(slug, p.id);
    fs.writeFileSync(`${r}.tmp`, JSON.stringify(p, null, 1));
    fs.renameSync(`${r}.tmp`, r);
    return p;
  }

  function topviewDe(slug) {
    const a = leerAjustes(slug);
    return crearClienteTopView({ apiKey: a.topviewKey, uid: a.topviewUid, fetcher });
  }

  function metaDe(usuario) {
    const c = credencialMeta?.(usuario);
    if (!c?.token) throw new Error("Conecta tu cuenta de Meta en Anuncios (con permiso ads_management) para crear campañas");
    return { meta: crearMetaCampanas({ token: c.token, version: c.version, fetcher }), cred: c };
  }

  /** Baja una URL (foto del producto o creativo) -> {bytes, tipo}. */
  async function bajar(url) {
    const r = await fetcher(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`No se pudo bajar ${String(url).slice(0, 80)} (HTTP ${r.status})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const tipo = String(r.headers?.get?.("content-type") ?? "").split(";")[0] || (/\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg");
    return { bytes, tipo };
  }

  /** fileId de TopView de cada foto (se sube una sola vez por proyecto). */
  async function referencias(slug, p, tv, conPersonaje) {
    p.referencias = p.referencias ?? {};
    const urls = [...p.fotos];
    const modelo = conPersonaje ? leerAjustes(slug).fotoModelo : null;
    if (modelo) urls.push(modelo);
    const ids = [];
    for (const u of urls) {
      if (!p.referencias[u]) {
        const { bytes, tipo } = await bajar(u);
        p.referencias[u] = await tv.subir(bytes, tipo);
        guardarP(slug, p);
      }
      ids.push(p.referencias[u]);
    }
    return { producto: ids.slice(0, p.fotos.length), todas: ids };
  }

  // ------------------------------------------------ consulta en segundo plano

  async function revisarTareas() {
    let usuarios = [];
    try {
      usuarios = fs.readdirSync(raiz);
    } catch {
      return;
    }
    for (const slug of usuarios) {
      let archivos = [];
      try {
        archivos = fs.readdirSync(dirProyectos(slug)).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }
      for (const f of archivos) {
        const id = f.replace(/\.json$/, "");
        if (ocupados.has(`${slug}/${id}`)) continue;
        const p = leerP(slug, id);
        const pendientes = (p?.creativos ?? []).filter((c) => c.estado === "generando" && c.tarea?.taskId);
        if (!pendientes.length) continue;
        let tv;
        try {
          tv = topviewDe(slug);
        } catch {
          continue;
        }
        let cambio = false;
        for (const c of pendientes) {
          try {
            const r = await tv.consultar(c.tarea.tipo, c.tarea.taskId);
            if (r.estado === "listo") {
              c.estado = "listo";
              c.resultado = { url: r.url, portada: r.portada, creditos: r.creditos, listo: ahora() };
              delete c.error;
              cambio = true;
            } else if (r.estado === "fallo") {
              c.estado = "fallo";
              c.error = r.error;
              cambio = true;
            } else if (Date.now() - Date.parse(c.tarea.desde) > 30 * 60 * 1000) {
              c.estado = "fallo";
              c.error = "TopView no terminó en 30 minutos";
              cambio = true;
            }
          } catch (e) {
            log.warn?.("[creador] no se pudo consultar TopView:", e?.message ?? e);
          }
        }
        if (cambio) {
          // se relee por si el usuario edito mientras tanto: solo se pisan estos creativos
          const fresco = leerP(slug, id) ?? p;
          for (const c of pendientes) {
            const k = fresco.creativos.findIndex((x) => x.id === c.id);
            if (k >= 0 && fresco.creativos[k].tarea?.taskId === c.tarea.taskId) fresco.creativos[k] = { ...fresco.creativos[k], ...c, prompt: fresco.creativos[k].prompt, copy: fresco.creativos[k].copy };
          }
          guardarP(slug, fresco);
        }
      }
    }
  }

  function arrancar() {
    if (reloj) return;
    reloj = setInterval(() => void revisarTareas().catch((e) => log.warn?.("[creador]", e?.message ?? e)), cadaMs);
    reloj.unref?.();
  }
  function detener() {
    if (reloj) clearInterval(reloj);
    reloj = null;
  }

  // --------------------------------------------------------- crear campana

  async function montarCampana(usuario, slug, id) {
    const clave = `${slug}/${id}`;
    ocupados.add(clave);
    const p = leerP(slug, id);
    const paso = (texto, ok = true) => {
      p.campana.pasos.push({ texto, ok, en: ahora() });
      guardarP(slug, p);
    };
    try {
      const a = leerAjustes(slug);
      const { meta } = metaDe(usuario);
      const cuentaId = p.meta?.cuentaId || a.cuentaId;
      const paginaId = p.meta?.paginaId || a.paginaId;
      if (!cuentaId || !paginaId) throw new Error("Elige la cuenta publicitaria y la página de Facebook");
      const cuenta = await meta.cuenta(cuentaId);
      if (!cuenta.activa) throw new Error(`La cuenta publicitaria ${cuenta.nombre} no está activa en Meta`);
      const presupuesto = Number(p.presupuesto) || PRESUPUESTO_DEFECTO;
      if (cuenta.minimoDiario && presupuesto < cuenta.minimoDiario) {
        throw new Error(`El presupuesto mínimo diario de esa cuenta es ${precioTexto(cuenta.minimoDiario)} ${cuenta.moneda}`);
      }
      const ids = (p.campana.ids = p.campana.ids ?? { anuncios: {} });
      ids.anuncios = ids.anuncios ?? {};
      const elegidos = p.creativos.filter((c) => c.incluir && c.estado === "listo" && c.resultado?.url);
      if (!elegidos.length) throw new Error("No hay creativos listos marcados para la campaña");

      // 1. medios
      for (const c of elegidos) {
        if (ids.anuncios[c.id]?.medio) continue;
        if (c.tipo === "imagen") {
          const { bytes } = await bajar(c.resultado.url);
          const img = await meta.subirImagen(cuentaId, bytes, `${p.producto.nombre} ${c.id}.jpg`);
          ids.anuncios[c.id] = { ...(ids.anuncios[c.id] ?? {}), medio: { tipo: "imagen", hash: img.hash } };
        } else {
          const vid = await meta.subirVideo(cuentaId, c.resultado.url, `${p.producto.nombre} ${c.id}.mp4`);
          ids.anuncios[c.id] = { ...(ids.anuncios[c.id] ?? {}), medio: { tipo: "video", videoId: vid, portada: c.resultado.portada ?? null } };
        }
        paso(`${c.tipo === "imagen" ? "Imagen" : "Video"} "${c.angulo}" subido a Meta`);
      }
      // los videos tienen que quedar procesados antes del anuncio
      for (const c of elegidos.filter((x) => x.tipo === "video")) {
        const m = ids.anuncios[c.id].medio;
        if (m.listo) continue;
        let est = "processing";
        for (let i = 0; i < 60 && est !== "ready"; i++) {
          est = await meta.estadoVideo(m.videoId).catch(() => "processing");
          if (est === "error") throw new Error(`Meta no pudo procesar el video "${c.angulo}"`);
          if (est !== "ready") await dormir(esperaVideoMs);
        }
        if (est !== "ready") throw new Error(`Meta sigue procesando el video "${c.angulo}": intenta de nuevo en unos minutos`);
        m.listo = true;
        guardarP(slug, p);
      }

      // 2. campana
      const marca = a.marca || "ZUNTO";
      if (!ids.campana) {
        ids.campana = await meta.crearCampana(cuentaId, {
          nombre: `${marca} · ${p.producto.nombre} · WhatsApp · ${fechaCorta()}`,
          presupuestoDiario: presupuesto,
          moneda: cuenta.moneda,
        });
        ids.moneda = cuenta.moneda;
        paso(`Campaña creada (pausada) con ${precioTexto(presupuesto)} ${cuenta.moneda} diarios`);
      }

      // 3. conjunto
      if (!ids.conjunto) {
        const excl = await meta.exclusiones(EXCLUSIONES_ZUNTO);
        ids.conjunto = await meta.crearConjunto(cuentaId, {
          campana: ids.campana,
          nombre: `${p.producto.nombre} · Colombia · WhatsApp`,
          paginaId,
          exclusiones: excl,
        });
        paso(
          excl.faltan.length
            ? `Conjunto creado; faltan exclusiones: ${excl.faltan.join(", ")} (agrégalas en Ads Manager)`
            : "Conjunto creado: Colombia sin San Andrés, Amazonas ni Mitú",
          !excl.faltan.length,
        );
      }

      // 4. un anuncio por creativo
      const bienvenida = p.mensajePredefinido ? mensajeBienvenida({ predefinido: p.mensajePredefinido }) : null;
      for (const c of elegidos) {
        const reg = ids.anuncios[c.id];
        if (reg.anuncio) continue;
        if (!reg.creativo) {
          const cr = await meta.crearCreativo(cuentaId, {
            nombre: `${p.producto.nombre} · ${c.angulo}`,
            paginaId,
            medio: reg.medio,
            texto: c.copy.texto,
            titulo: c.copy.titulo,
            descripcion: c.copy.descripcion,
            bienvenida,
          });
          reg.creativo = cr.id;
          if (cr.sinBienvenida) {
            reg.sinBienvenida = true;
            paso(`"${c.angulo}": Meta no aceptó el mensaje predefinido; ponlo a mano en Ads Manager`, false);
          }
          guardarP(slug, p);
        }
        reg.anuncio = await meta.crearAnuncio(cuentaId, { nombre: `${c.angulo}`, conjunto: ids.conjunto, creativo: reg.creativo });
        paso(`Anuncio "${c.angulo}" creado (pausado)`);
      }

      const rev = await meta.revisarCampana(ids.campana, cuenta.moneda).catch(() => null);
      p.campana.estado = "creada";
      p.campana.revision = rev;
      p.campana.cuenta = { id: cuenta.id, nombre: cuenta.nombre, moneda: cuenta.moneda };
      p.campana.enlace = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cuenta.id}&selected_campaign_ids=${ids.campana}`;
      p.estado = "campana";
      delete p.campana.error;
      paso("Listo: todo quedó PAUSADO. Revísalo y actívalo cuando quieras.");
    } catch (e) {
      p.campana.estado = "error";
      p.campana.error = e?.message ?? String(e);
      paso(`Error: ${p.campana.error}`, false);
      log.warn?.("[creador] campaña:", p.campana.error);
    } finally {
      ocupados.delete(clave);
    }
  }

  // ------------------------------------------------------------ fachada

  function para(usuario, { llm = null } = {}) {
    const slug = slugOError(usuario);

    function proyecto(id) {
      const p = leerP(slug, id);
      if (!p) throw new Error("Ese proyecto no existe");
      return p;
    }

    return {
      /** Ajustes del usuario (sin la API key: solo enmascarada). */
      ajustes() {
        const a = leerAjustes(slug);
        const c = credencialMeta?.(usuario) ?? null;
        return {
          topview: { configurada: Boolean(a.topviewKey && a.topviewUid), key: enmascarar(a.topviewKey ?? ""), uid: a.topviewUid ?? "" },
          cuentaId: a.cuentaId ?? "",
          paginaId: a.paginaId ?? "",
          paginaNombre: a.paginaNombre ?? "",
          presupuesto: Number(a.presupuesto) || PRESUPUESTO_DEFECTO,
          fotoModelo: a.fotoModelo ?? "",
          marca: a.marca || "ZUNTO",
          contraEntrega: Boolean(a.contraEntrega),
          meta: { conectada: Boolean(c?.token), cuentas: c?.cuentas ?? [] },
          costos: COSTO_CREDITOS,
          modelos: { imagen: DEFECTOS_TOPVIEW.imagen.model, video: DEFECTOS_TOPVIEW.video.model },
          ia: {
            proveedor: iaDe(a),
            claude: { configurada: Boolean(a.claudeKey), key: enmascarar(a.claudeKey ?? ""), modelo: a.claudeModelo || MODELOS_CLAUDE[0].id },
            modelosClaude: MODELOS_CLAUDE,
            zunto: { configurada: Boolean(llm?.apiKey), modelo: llm?.modelo ?? "" },
          },
        };
      },

      guardarAjustes(cambios = {}) {
        const a = leerAjustes(slug);
        if (typeof cambios.topviewKey === "string" && cambios.topviewKey.trim()) a.topviewKey = cambios.topviewKey.trim();
        if (typeof cambios.topviewUid === "string" && cambios.topviewUid.trim()) a.topviewUid = cambios.topviewUid.trim();
        if (cambios.borrarTopview) {
          delete a.topviewKey;
          delete a.topviewUid;
        }
        for (const k of ["cuentaId", "paginaId", "paginaNombre", "fotoModelo", "marca"]) {
          if (typeof cambios[k] === "string") a[k] = cambios[k].trim().slice(0, 500);
        }
        if (cambios.presupuesto !== undefined) {
          const n = Number(cambios.presupuesto);
          if (!Number.isFinite(n) || n <= 0) throw new Error("El presupuesto debe ser un número mayor que 0");
          a.presupuesto = Math.round(n);
        }
        if (cambios.contraEntrega !== undefined) a.contraEntrega = Boolean(cambios.contraEntrega);
        if (typeof cambios.claudeKey === "string" && cambios.claudeKey.trim()) a.claudeKey = cambios.claudeKey.trim();
        if (cambios.borrarClaude) delete a.claudeKey;
        if (typeof cambios.claudeModelo === "string" && MODELOS_CLAUDE.some((m) => m.id === cambios.claudeModelo)) a.claudeModelo = cambios.claudeModelo;
        if (cambios.iaProveedor === "claude" || cambios.iaProveedor === "zunto") a.iaProveedor = cambios.iaProveedor;
        escribirJsonSeguro(rutaAjustes(slug), a);
        return this.ajustes();
      },

      /** Prueba la llave de Claude. */
      async probarIA() {
        const a = leerAjustes(slug);
        if (!a.claudeKey) throw new Error("Primero guarda la API key de Claude");
        await probarClaude({ apiKey: a.claudeKey, modelo: a.claudeModelo, fetcher });
        return { msg: "Claude responde bien" };
      },

      /** Prueba la llave de TopView y devuelve los creditos. */
      async creditos() {
        return { creditos: await topviewDe(slug).creditos() };
      },

      /** Paginas de Facebook del token del usuario. */
      async paginas() {
        const { meta } = metaDe(usuario);
        return { paginas: await meta.paginas() };
      },

      lista() {
        let archivos = [];
        try {
          archivos = fs.readdirSync(dirProyectos(slug)).filter((f) => f.endsWith(".json"));
        } catch {
          /* ninguno */
        }
        return archivos
          .map((f) => leerP(slug, f.replace(/\.json$/, "")))
          .filter(Boolean)
          .map((p) => ({
            id: p.id,
            producto: p.producto?.nombre ?? "",
            estado: p.estado,
            creado: p.creado,
            actualizado: p.actualizado,
            portada: p.creativos?.find((c) => c.estado === "listo" && c.tipo === "imagen")?.resultado?.url ?? p.fotos?.[0] ?? null,
            creativos: p.creativos?.length ?? 0,
            listos: p.creativos?.filter((c) => c.estado === "listo").length ?? 0,
            campana: p.campana?.estado ?? null,
          }))
          .sort((x, y) => String(y.actualizado).localeCompare(String(x.actualizado)));
      },

      get(id) {
        const p = proyecto(id);
        return { ...p, ocupado: ocupados.has(`${slug}/${id}`) };
      },

      crear(datos = {}) {
        const pr = datos.producto ?? {};
        const nombre = txt(pr.nombre, 120);
        if (!nombre) throw new Error("Falta el nombre del producto");
        // pesos colombianos: "199.900" o 199900 (sin centavos)
        const precio = typeof pr.precio === "number" ? Math.round(pr.precio) : Number(String(pr.precio ?? "").split(",")[0].replace(/\D/g, ""));
        if (!Number.isFinite(precio) || precio <= 0) throw new Error("Falta el precio del producto");
        const fotos = (Array.isArray(datos.fotos) ? datos.fotos : [])
          .map((u) => String(u ?? "").trim())
          .filter((u) => /^https:\/\//i.test(u))
          .slice(0, MAX_FOTOS);
        if (!fotos.length) throw new Error("Agrega al menos una foto real del producto (TopView genera a partir de ellas)");
        const a = leerAjustes(slug);
        const p = {
          id: nuevoId(),
          estado: "nuevo",
          creado: ahora(),
          producto: {
            id: pr.id ? String(pr.id) : null,
            nombre,
            precio,
            descripcion: txt(pr.descripcion, 3000),
            contenido: txt(pr.contenido, 500),
            variantes: txt(pr.variantes, 500),
          },
          fotos,
          conPersonaje: datos.conPersonaje !== false && Boolean(a.fotoModelo),
          cantidades: {
            imagenes: Math.max(0, Math.min(MAX_IMAGENES, Number(datos.imagenes ?? 4) || 0)),
            videos: Math.max(0, Math.min(MAX_VIDEOS, Number(datos.videos ?? 3) || 0)),
          },
          notas: txt(datos.notas, 1000),
          presupuesto: Number(datos.presupuesto) > 0 ? Math.round(Number(datos.presupuesto)) : Number(a.presupuesto) || PRESUPUESTO_DEFECTO,
          meta: { cuentaId: datos.cuentaId || a.cuentaId || "", paginaId: datos.paginaId || a.paginaId || "" },
          creativos: [],
          campana: null,
        };
        if (!p.cantidades.imagenes && !p.cantidades.videos) throw new Error("Pide al menos un creativo");
        return guardarP(slug, p);
      },

      /**
       * La IA escribe prompts, copys, ficha y bienvenida. Sigue en segundo
       * plano (puede tardar 1-2 min): el panel consulta el proyecto.
       */
      planear(id) {
        const clave = `${slug}/${id}`;
        if (ocupados.has(clave)) throw new Error("Este proyecto ya está trabajando: espera un momento");
        const p = proyecto(id);
        if (p.creativos?.some((c) => c.estado === "generando")) throw new Error("Hay creativos generándose: espera a que terminen");
        const a = leerAjustes(slug);
        const conClaude = iaDe(a) === "claude";
        if (conClaude && !a.claudeKey) throw new Error("Falta la API key de Claude (Creador IA > Ajustes)");
        if (!conClaude && !llm?.apiKey) throw new Error("No hay API key de la IA (Ajustes > Subida a Dropi > IA que lee los chats)");
        p.planeando = ahora();
        delete p.errorPlan;
        guardarP(slug, p);
        ocupados.add(clave);
        void (async () => {
          try {
            const conPersonaje = p.conPersonaje && Boolean(a.fotoModelo);
            const sistema = promptSistema({ marca: a.marca || "ZUNTO", contraEntrega: Boolean(a.contraEntrega) });
            const usuarioIA = promptUsuario(p, { conPersonaje });
            const crudo = conClaude
              ? await pedirPlanClaude({
                  apiKey: a.claudeKey,
                  modelo: a.claudeModelo,
                  fetcher,
                  sistema,
                  usuario: usuarioIA,
                  fotos: [...p.fotos, ...(conPersonaje ? [a.fotoModelo] : [])],
                })
              : await pedirPlanIA({ ...llm, fetcher, sistema, usuario: usuarioIA });
            const plan = normalizarPlan(crudo, p.cantidades);
            const fresco = proyecto(id);
            Object.assign(fresco, plan, {
              estado: "plan",
              ia: conClaude ? (MODELOS_CLAUDE.find((m) => m.id === (a.claudeModelo || MODELOS_CLAUDE[0].id))?.nombre.split(" · ")[0] ?? "Claude") : `IA de Zunto (${llm?.modelo ?? ""})`,
            });
            delete fresco.planeando;
            guardarP(slug, fresco);
          } catch (e) {
            const fresco = leerP(slug, id);
            if (fresco) {
              delete fresco.planeando;
              fresco.errorPlan = e?.message ?? String(e);
              guardarP(slug, fresco);
            }
            log.warn?.("[creador] plan:", e?.message ?? e);
          } finally {
            ocupados.delete(clave);
          }
        })();
        return p;
      },

      /** Cambios del usuario: prompts, copys, incluir, ficha, presupuesto... */
      editar(id, cambios = {}) {
        const p = proyecto(id);
        for (const c of Array.isArray(cambios.creativos) ? cambios.creativos : []) {
          const x = p.creativos.find((y) => y.id === c?.id);
          if (!x) continue;
          if (typeof c.prompt === "string") x.prompt = txt(c.prompt, 7000);
          if (typeof c.angulo === "string") x.angulo = txt(c.angulo, 80);
          if (c.copy && typeof c.copy === "object") {
            x.copy = {
              texto: typeof c.copy.texto === "string" ? txt(c.copy.texto, 2000) : x.copy.texto,
              titulo: typeof c.copy.titulo === "string" ? txt(c.copy.titulo, 40) : x.copy.titulo,
              descripcion: typeof c.copy.descripcion === "string" ? txt(c.copy.descripcion, 120) : x.copy.descripcion,
            };
          }
          if (typeof c.incluir === "boolean") x.incluir = c.incluir;
        }
        if (cambios.ficha && typeof cambios.ficha === "object") {
          for (const k of ["descripcion", "modoUso", "caracteristicas", "contenido"]) {
            if (typeof cambios.ficha[k] === "string") p.ficha = { ...(p.ficha ?? {}), [k]: txt(cambios.ficha[k]) };
          }
        }
        if (typeof cambios.bienvenida === "string") p.bienvenida = txt(cambios.bienvenida, 1500);
        if (typeof cambios.mensajePredefinido === "string") p.mensajePredefinido = txt(cambios.mensajePredefinido, 300);
        if (cambios.presupuesto !== undefined) {
          const n = Number(cambios.presupuesto);
          if (!Number.isFinite(n) || n <= 0) throw new Error("El presupuesto debe ser mayor que 0");
          p.presupuesto = Math.round(n);
        }
        if (typeof cambios.cuentaId === "string") p.meta = { ...(p.meta ?? {}), cuentaId: cambios.cuentaId };
        if (typeof cambios.paginaId === "string") p.meta = { ...(p.meta ?? {}), paginaId: cambios.paginaId };
        return guardarP(slug, p);
      },

      /** Agrega un creativo vacio (imagen o video) para escribirlo a mano. */
      agregarCreativo(id, tipo) {
        const p = proyecto(id);
        const t = tipo === "video" ? "video" : "imagen";
        const pref = t === "imagen" ? "img" : "vid";
        let n = 1;
        while (p.creativos.some((c) => c.id === `${pref}${n}`)) n++;
        p.creativos.push({
          id: `${pref}${n}`,
          tipo: t,
          angulo: `${t === "imagen" ? "Imagen" : "Video"} ${n}`,
          prompt: "",
          copy: { texto: "", titulo: "", descripcion: "" },
          incluir: true,
          estado: "borrador",
        });
        return guardarP(slug, p);
      },

      /**
       * Manda a TopView los creativos pedidos (o todos los que no estan
       * listos ni generando). Devuelve el proyecto con sus tareas.
       */
      async generar(id, { ids = null } = {}) {
        const clave = `${slug}/${id}`;
        if (ocupados.has(clave)) throw new Error("Este proyecto ya está trabajando: espera un momento");
        ocupados.add(clave);
        try {
          const p = proyecto(id);
          const objetivo = p.creativos.filter((c) =>
            Array.isArray(ids) && ids.length ? ids.includes(c.id) : c.incluir && c.estado !== "listo" && c.estado !== "generando",
          );
          if (!objetivo.length) throw new Error("No hay creativos para generar");
          const sinPrompt = objetivo.find((c) => !c.prompt);
          if (sinPrompt) throw new Error(`"${sinPrompt.angulo}" no tiene prompt`);
          const tv = topviewDe(slug);
          const refs = await referencias(slug, p, tv, p.conPersonaje);
          for (const c of objetivo) {
            try {
              const t =
                c.tipo === "video"
                  ? await tv.video({ prompt: c.prompt, fileIds: refs.todas })
                  : await tv.imagen({ prompt: c.prompt, fileIds: refs.producto });
              if (c.estado === "listo" && c.resultado) c.anteriores = [...(c.anteriores ?? []), c.resultado].slice(-5);
              c.tarea = { ...t, desde: ahora() };
              c.estado = "generando";
              delete c.error;
            } catch (e) {
              c.estado = "fallo";
              c.error = e?.message ?? String(e);
            }
          }
          if (p.estado === "plan" || p.estado === "nuevo") p.estado = "creativos";
          guardarP(slug, p);
          return p;
        } finally {
          ocupados.delete(clave);
        }
      },

      /** Arranca la creacion de la campana en Meta (sigue en segundo plano). */
      crearCampana(id) {
        const clave = `${slug}/${id}`;
        if (ocupados.has(clave)) throw new Error("Este proyecto ya está trabajando: espera un momento");
        const p = proyecto(id);
        if (p.campana?.estado === "creada" || p.campana?.estado === "activa") throw new Error("La campaña ya está creada");
        metaDe(usuario); // sin token: error ya
        const listos = p.creativos.filter((c) => c.incluir && c.estado === "listo");
        if (!listos.length) throw new Error("Primero genera y aprueba los creativos");
        if (p.creativos.some((c) => c.incluir && c.estado === "generando")) throw new Error("Hay creativos generándose: espera a que terminen o desmárcalos");
        p.campana = { ...(p.campana ?? {}), estado: "creando", pasos: [], desde: ahora() };
        guardarP(slug, p);
        void montarCampana(usuario, slug, id);
        return p;
      },

      /** Enciende (o pausa) campana, conjunto y anuncios. */
      async activar(id, { pausar = false } = {}) {
        const p = proyecto(id);
        const ids = p.campana?.ids;
        if (!ids?.campana || p.campana.estado === "creando") throw new Error("La campaña todavía no está creada");
        const { meta } = metaDe(usuario);
        const est = pausar ? "PAUSED" : "ACTIVE";
        for (const r of Object.values(ids.anuncios ?? {})) if (r.anuncio) await meta.cambiarEstado(r.anuncio, est);
        if (ids.conjunto) await meta.cambiarEstado(ids.conjunto, est);
        await meta.cambiarEstado(ids.campana, est);
        p.campana.estado = pausar ? "creada" : "activa";
        p.campana.pasos.push({ texto: pausar ? "Campaña pausada" : "Campaña ACTIVADA", ok: true, en: ahora() });
        p.campana.revision = await meta.revisarCampana(ids.campana, ids.moneda).catch(() => p.campana.revision);
        return guardarP(slug, p);
      },

      borrar(id) {
        const p = proyecto(id);
        if (p.campana?.estado === "activa") throw new Error("La campaña está activa: páusala primero");
        fs.rmSync(rutaProyecto(slug, id), { force: true });
        return { ok: true };
      },
    };
  }

  return { para, arrancar, detener, revisarTareas, _montarCampana: montarCampana };
}
