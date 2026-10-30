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
import { crearClienteTopViewMcp, descubrirOAuth, MCP_TOPVIEW, pedirToken, registrarCliente, urlAutorizacion } from "./topviewMcp.js";

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

/** Cuanto se arriesga la IA con las ideas. */
export const CREATIVIDAD = {
  segura: "SEGURA: prioriza formatos probados de e-commerce; varía escenas y estilos, pero sin experimentos raros.",
  equilibrada: "EQUILIBRADA: mezcla 1–2 formatos probados con ideas frescas y diferentes.",
  atrevida: "ATREVIDA: sorpréndeme. Conceptos poco vistos, ganchos audaces, estéticas distintas a lo típico de dropshipping (sin romper las reglas fijas).",
};

/**
 * Instrucciones de la IA: unas REGLAS FIJAS (marca, precio, WhatsApp,
 * fidelidad del producto, Meta) y LIBERTAD CREATIVA para todo lo demas.
 */
export function promptSistema({ marca = "ZUNTO", contraEntrega = false, creatividad = "equilibrada" } = {}) {
  return `Eres el director creativo de ${marca}, una tienda online colombiana que vende por Meta Ads con destino WhatsApp.
Actúas como un diseñador y estratega creativo de verdad: piensas en quién compra, por qué lo compra y qué lo haría detenerse a mirar en el feed. Escribes en español colombiano. Devuelves SOLO un JSON.

══════ REGLAS FIJAS (no se negocian) ══════
1. Marca y precio: en cada creativo publicitario se ve "${marca}" (amarillo o en un color de alto contraste con el fondo) y el precio en formato $199.900 (punto de miles, sin decimales). Tú decides dónde y cómo (badge, sello, etiqueta, texto en pantalla…), pero que se lea.
2. WhatsApp: el llamado a la acción siempre lleva a WhatsApp ("Escríbenos por WhatsApp", "Pídelo por WhatsApp"…). Tú eliges la forma (botón, sticker, franja, burbuja de chat…).
3. "Envío GRATIS" y "Garantía" cuando apliquen.${contraEntrega ? ' Puedes decir "Pago contra entrega".' : ' NO digas "pago contra entrega".'}
4. Nada inventado: ni especificaciones (RPM, medidas, tiempos, cifras), ni accesorios que no vienen, ni premios, ni testimonios con nombre real. Si algo aparece en uso pero no viene en el kit, nunca lo muestres como incluido.
5. Fidelidad del producto (lo más importante): en cada prompt describe el producto pieza por pieza tal como se ve en las fotos (formas, colores, textos legibles, tamaño real comparado con algo cotidiano). Escribe siempre: "no deformar el producto ni el logo, no cambiar colores, no agregar piezas, botones ni pantallas, no copiar textos de las imágenes de referencia". Si es eléctrico con cable o inalámbrico, dilo. Si se pliega o se arma, describe el movimiento paso a paso ("no aparece de golpe").
6. Meta: nada de escotes ni ropa reveladora (cuello cerrado), nada de antes/después de cuerpos, nada de promesas de salud, nada que imite noticias reales, marcas ajenas o famosos.
7. Seguridad cuando aplique: herramientas con las dos manos, guarda puesta, gafas y guantes.
8. Referencias de fotos: en prompts de IMAGEN las fotos son Image1, Image2…; en prompts de VIDEO son <<<Image1>>>, <<<Image2>>>…
9. Voz de los videos: español colombiano con acento de Bogotá, cálido y seguro; nada de acento paisa, costeño, argentino, mexicano o de España; trato de "tú" (nunca voseo); números siempre en palabras ("ciento noventa y nueve mil novecientos"). Las marcas extranjeras se pronuncian como se dicen en Colombia (DeWalt = "DiWolt") pero se escriben bien en pantalla.
10. Videos de 12 s en 9:16 (gancho en los primeros 2–3 s, cierre con precio + WhatsApp + ${marca}); imágenes en 4:5.

══════ LIBERTAD CREATIVA ══════
Antes de escribir, analiza el producto: categoría, quién lo compra en Colombia (y quién lo regala), qué problema resuelve, qué deseo despierta, dónde se usa, si es de temporada, qué objeciones tiene el comprador (¿funciona?, ¿es frágil?, ¿llega bien?). Con eso define un CONCEPTO de campaña y elige, para ESTE producto, los formatos y estilos que mejor lo venden. No hay plantilla fija.

Cada creativo debe ser distinto de los demás en al menos 3 de estas cosas: idea/ángulo, tipo de gancho, estilo visual, escena/locación, paleta de color, composición/encuadre, tono. Nada de 4 imágenes iguales con otro fondo.

Repertorio para inspirarte (no es obligatorio usarlo, inventa otros):
• Ángulos: problema → solución, antes/después del espacio u objeto, comparación con lo que usan hoy, "lo que nadie te cuenta", regalo perfecto, ahorro de tiempo/dinero, prueba de resistencia, un día con el producto, error común, curiosidad, lista "3 razones", urgencia real de temporada, estatus/orgullo de tenerlo, humor cotidiano colombiano.
• Estilos de imagen: foto editorial de revista, flat lay cenital ordenado, macro de detalles y texturas, lifestyle en un lugar real colombiano (obra, taller, cocina de apartamento en Bogotá, finca, carro, oficina), split-screen comparativo, collage tipo historia de Instagram, captura de chat de WhatsApp, estilo póster minimalista con mucho aire, fondo de color sólido vibrante, bodegón con luz dramática, infografía limpia con llamadas, kit desplegado "todo esto por…", render 3D tipo producto premium, estilo "meme" respetuoso, nota adhesiva / escrito a mano.
• Formatos de video: UGC a cámara, POV ("POV: por fin…"), ASMR / satisfactorio, tutorial de 3 pasos, prueba o reto, comparación lado a lado, mini historia con giro, unboxing, reacción, transformación del espacio, cámara lenta de detalles, "3 cosas que hace", cliente que escribe por WhatsApp.
• Personaje (cuando hay foto de modelo): úsalo solo donde sume; descríbelo como "la misma persona de <<<ImageN>>>: mismo rostro, ojos, sonrisa, tono de piel y cabello" y viste acorde al producto y siempre de cuello cerrado (herramientas: polo negra con "${marca}" bordado en amarillo, gafas y guantes; hogar/temporada: ropa casual o navideña; belleza/moda: sobria). No uses la ropa de la foto de referencia.

Nivel de riesgo creativo pedido: ${CREATIVIDAD[creatividad] ?? CREATIVIDAD.equilibrada}

══════ CÓMO ESCRIBIR CADA PROMPT ══════
Imagen: Estilo → Escena/locación → Producto (bloque de fidelidad, regla 5) → Composición (dónde va el producto, jerarquía, espacio para textos) → Textos sobre la imagen (exactos, entre comillas, cortos y legibles: titular, apoyo, precio, ${marca}, WhatsApp) → Look (luz, paleta, tipografía, acabado fotográfico realista).
Video: CONCEPTO → ESCENA → GUION con tiempos (0–3 s gancho, desarrollo, últimos 3 s precio + WhatsApp + ${marca}) → TEXTOS EN PANTALLA con el segundo exacto → AUDIO (voz, música, sonidos) → reglas de cámara (una acción por plano, movimientos suaves, el producto sin giros bruscos).

══════ COPY (uno por creativo) ══════
Debe continuar la idea de su creativo (mismo gancho y tono). Varía la estructura entre creativos: pregunta, historia corta, lista, dato curioso, diálogo… Siempre termina con precio, envío gratis y la invitación a escribir por WhatsApp. "titulo" máximo 40 caracteres. "descripcion" corta.

══════ ADEMÁS ══════
FICHA: descripcion (beneficios + para quién + qué incluye + variantes), modoUso (pasos numerados + seguridad), caracteristicas ("• Campo: valor", solo datos confirmados), contenido ("1 X + 2 Y" y "Z no incluido" si aplica).
BIENVENIDA de WhatsApp para responder al cliente: saludo de ${marca} con emoji del producto, 3 beneficios con ✅, 📦 qué incluye, 💰 precio, 🚚 envío gratis, 🛡️ garantía y una pregunta abierta que invite a seguir la conversación.

JSON de salida:
{"concepto":"la gran idea de la campaña en 1–2 frases",
 "creativos":[{"tipo":"imagen"|"video","angulo":"nombre corto","estilo":"estilo visual o formato en pocas palabras","porque":"por qué funciona para este producto (1 frase)","prompt":"...","copy":{"texto":"...","titulo":"...","descripcion":"..."}}],
 "ficha":{"descripcion":"...","modoUso":"...","caracteristicas":"...","contenido":"..."},
 "bienvenida":"...",
 "mensajePredefinido":"¡Hola! Quiero más información del [producto].",
 "faltan":["datos del producto que harían falta, sin inventarlos"]}`;
}

export function promptUsuario(p, { conPersonaje = false, recientes = [] } = {}) {
  const pr = p.producto ?? {};
  const fotos = p.fotos?.length ?? 0;
  return [
    `Producto: ${pr.nombre}`,
    `Precio: ${precioTexto(pr.precio)}`,
    pr.descripcion ? `Descripción: ${pr.descripcion}` : "",
    pr.contenido ? `Contenido del paquete: ${pr.contenido}` : "",
    pr.variantes ? `Variantes: ${pr.variantes}` : "",
    p.notas ? `Indicaciones del usuario (tienen prioridad sobre tu criterio, salvo las reglas fijas): ${p.notas}` : "",
    `Fotos del producto: ${fotos} (Image1 a Image${fotos}).`,
    conPersonaje
      ? `Hay foto de modelo: es Image${fotos + 1} (en video <<<Image${fotos + 1}>>>). Úsala en los videos donde sume.`
      : "No hay modelo: si un video necesita persona, que sean solo manos o una persona de espaldas/sin rostro definido.",
    recientes.length
      ? `Estilos que ya usamos en campañas recientes (no los repitas, busca otros): ${recientes.join(" · ")}`
      : "",
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
        estilo: txt(c?.estilo, 80),
        porque: txt(c?.porque, 240),
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
    concepto: txt(crudo?.concepto, 400),
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

  // --------------------------------------------- TopView: cuenta o API key

  /** Clientes OAuth registrados en TopView (uno por servidor + redirect). */
  const rutaClientes = path.join(raiz, "oauth-clientes.json");
  /** estado OAuth -> lo que hace falta a la vuelta (10 min, un solo uso) */
  const pendientes = new Map();
  const mcps = new Map();

  function leerClientes() {
    try {
      return leerJsonSeguro(rutaClientes) ?? {};
    } catch {
      return {};
    }
  }

  /** Token vigente de la cuenta de TopView (lo renueva si vencio). */
  async function tokenCuenta(slug) {
    const a = leerAjustes(slug);
    const c = a.topviewCuenta;
    if (!c?.access) throw new Error("Conecta tu cuenta de TopView (Creador IA > Ajustes)");
    if (!c.expira || c.expira - Date.now() > 60000 || !c.refresh) return c.access;
    const nuevo = await pedirToken({
      tokenUrl: c.tokenUrl,
      cliente: { clientId: c.clientId, clientSecret: c.clientSecret ?? null },
      params: { grant_type: "refresh_token", refresh_token: c.refresh, resource: c.recurso ?? MCP_TOPVIEW },
      fetcher,
    });
    const fresco = leerAjustes(slug);
    fresco.topviewCuenta = { ...c, ...nuevo };
    escribirJsonSeguro(rutaAjustes(slug), fresco);
    return nuevo.access;
  }

  /** Cliente de TopView del usuario: su cuenta (creditos del plan) o la API key. */
  function topviewDe(slug) {
    const a = leerAjustes(slug);
    if (a.topviewCuenta?.access && a.topviewModo !== "api") {
      let c = mcps.get(slug);
      if (!c) {
        c = crearClienteTopViewMcp({ obtenerToken: () => tokenCuenta(slug), fetcher });
        mcps.set(slug, c);
      }
      return c;
    }
    return crearClienteTopView({ apiKey: a.topviewKey, uid: a.topviewUid, fetcher });
  }

  /** Paso 1 de "Conectar TopView": registra a Zunto (una vez) y arma la URL. */
  /**
   * Si TopView no deja volver a zunto.store (solo acepta direcciones de
   * apps de escritorio), se usa una direccion local: el navegador no abre
   * nada ahi, pero la direccion trae el codigo y la persona la pega en Zunto.
   */
  const REGRESOS_LOCALES = ["http://localhost:33418/callback", "http://127.0.0.1:33418/callback", "http://localhost/callback"];

  async function iniciarTopView(slug, redirectWeb) {
    const d = await descubrirOAuth({ fetcher });
    const clientes = leerClientes();
    let elegido = null;
    let ultimo = null;
    for (const redirect of [redirectWeb, ...REGRESOS_LOCALES]) {
      const clave = `${d.issuer}|${redirect}`;
      if (clientes[clave]?.rechazado) continue;
      if (clientes[clave]?.clientId) {
        elegido = { redirect, cliente: clientes[clave] };
        break;
      }
      try {
        const cliente = await registrarCliente({ registro: d.registro, redirect, fetcher });
        clientes[clave] = cliente;
        elegido = { redirect, cliente };
        break;
      } catch (e) {
        ultimo = e;
        // solo se prueba otra direccion si el problema era la direccion
        if (!/redirect/i.test(String(e?.message))) throw e;
        clientes[clave] = { rechazado: true, en: ahora() };
      }
    }
    fs.mkdirSync(raiz, { recursive: true });
    escribirJsonSeguro(rutaClientes, clientes);
    if (!elegido) throw ultimo ?? new Error("TopView no aceptó ninguna dirección de regreso");
    const { redirect, cliente } = elegido;
    const { url, estado, verificador } = urlAutorizacion({ descubierto: d, cliente, redirect });
    for (const [k, v] of pendientes) if (Date.now() - v.desde > 10 * 60 * 1000) pendientes.delete(k);
    pendientes.set(estado, { slug, verificador, redirect, cliente, tokenUrl: d.token, recurso: d.recurso, desde: Date.now() });
    return { url, pegar: redirect !== redirectWeb };
  }

  /** Paso 2: TopView devuelve el codigo; se cambia por el acceso y se guarda. */
  async function completarTopView(estado, codigo, slugEsperado = null) {
    const p = pendientes.get(String(estado ?? ""));
    if (!p || Date.now() - p.desde > 10 * 60 * 1000) throw new Error("La conexión con TopView venció: inténtalo de nuevo");
    if (slugEsperado && p.slug !== slugEsperado) throw new Error("Esa autorización es de otro usuario");
    pendientes.delete(String(estado));
    if (!codigo) throw new Error("TopView no autorizó la conexión");
    const t = await pedirToken({
      tokenUrl: p.tokenUrl,
      cliente: p.cliente,
      params: { grant_type: "authorization_code", code: String(codigo), redirect_uri: p.redirect, code_verifier: p.verificador, resource: p.recurso },
      fetcher,
    });
    const a = leerAjustes(p.slug);
    a.topviewCuenta = { ...t, clientId: p.cliente.clientId, clientSecret: p.cliente.clientSecret ?? null, tokenUrl: p.tokenUrl, recurso: p.recurso, conectado: ahora() };
    a.topviewModo = "cuenta";
    escribirJsonSeguro(rutaAjustes(p.slug), a);
    mcps.delete(p.slug);
    // prueba: que el conector responda con esa cuenta
    let creditos = null;
    try {
      creditos = await topviewDe(p.slug).creditos();
    } catch (e) {
      log.warn?.("[creador] TopView conectado pero sin respuesta:", e?.message ?? e);
    }
    return { creditos };
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

    /** Estilos de los ultimos proyectos (incluido este si se vuelve a planear): la IA no los repite. */
    function estilosRecientes(max = 24) {
      let archivos = [];
      try {
        archivos = fs.readdirSync(dirProyectos(slug)).filter((f) => f.endsWith(".json"));
      } catch {
        return [];
      }
      const ps = archivos
        .map((f) => leerP(slug, f.replace(/\.json$/, "")))
        .filter((x) => x?.creativos?.length)
        .sort((x, y) => String(y.actualizado).localeCompare(String(x.actualizado)))
        .slice(0, 8);
      const out = [];
      for (const x of ps) for (const c of x.creativos) if (c.estilo && !out.includes(c.estilo)) out.push(c.estilo);
      return out.slice(0, max);
    }

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
          topview: {
            configurada: Boolean((a.topviewCuenta?.access && a.topviewModo !== "api") || (a.topviewKey && a.topviewUid)),
            modo: a.topviewCuenta?.access && a.topviewModo !== "api" ? "cuenta" : a.topviewKey && a.topviewUid ? "api" : null,
            cuenta: a.topviewCuenta?.access ? { conectado: a.topviewCuenta.conectado ?? null } : null,
            key: enmascarar(a.topviewKey ?? ""),
            uid: a.topviewUid ?? "",
          },
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
        if (cambios.desconectarTopview) {
          delete a.topviewCuenta;
          mcps.delete(slug);
        }
        if (cambios.topviewModo === "api" || cambios.topviewModo === "cuenta") a.topviewModo = cambios.topviewModo;
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

      /** "Conectar TopView": URL de autorizacion de TopView para este usuario. */
      conectarTopView(redirect) {
        if (!/^https?:\/\//.test(String(redirect ?? ""))) throw new Error("No se pudo armar la dirección de regreso");
        return iniciarTopView(slug, redirect);
      },

      /** Termina la conexion con la direccion que la persona pego (regreso local). */
      async completarTopViewPegado(texto) {
        const t = String(texto ?? "").trim();
        let u;
        try {
          u = new URL(t);
        } catch {
          throw new Error("Pega la dirección completa (empieza con http://localhost o http://127.0.0.1)");
        }
        const err = u.searchParams.get("error");
        if (err) throw new Error(u.searchParams.get("error_description") || `TopView respondió: ${err}`);
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        if (!code || !state) throw new Error("Esa dirección no trae el código de TopView: copia la de la barra del navegador después de autorizar");
        return completarTopView(state, code, slug);
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
          creatividad: CREATIVIDAD[datos.creatividad] ? datos.creatividad : "equilibrada",
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
        if (p.campana?.estado === "creada" || p.campana?.estado === "activa" || p.campana?.estado === "creando") {
          throw new Error("La campaña ya está en Meta: crea un proyecto nuevo para otras ideas");
        }
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
            const sistema = promptSistema({ marca: a.marca || "ZUNTO", contraEntrega: Boolean(a.contraEntrega), creatividad: p.creatividad });
            const usuarioIA = promptUsuario(p, { conPersonaje, recientes: estilosRecientes() });
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
        if (CREATIVIDAD[cambios.creatividad]) p.creatividad = cambios.creatividad;
        if (typeof cambios.notas === "string") p.notas = txt(cambios.notas, 1000);
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

  return { para, arrancar, detener, revisarTareas, completarTopView, _montarCampana: montarCampana };
}
