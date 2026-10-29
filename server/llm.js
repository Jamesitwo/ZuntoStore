// Cliente LLM minimo (API compatible con OpenAI: /chat/completions).
//
// SOLO se usa para EXTRAER datos del chat en lenguaje natural. La decision de
// si el pedido esta bien la toma el codigo en agente.js, nunca el modelo.
//
// Habla con el estandar "OpenAI-compatible", asi que sirve con OpenAI, Groq,
// DeepSeek, Together, OpenRouter o el endpoint compatible de Gemini: solo
// cambia LLM_BASE y LLM_MODELO en server/.env.

import { hoyColombia } from "./fechaEntrega.js";

const DEFECTO_BASE = "https://api.openai.com/v1";

/** Prompt de extraccion: corto y explicito para forzar JSON limpio. */
export const PROMPT_DEFECTO = `Eres un extractor de datos de chats de WhatsApp de una tienda.
Lees la conversacion entre un cliente y un bot y devuelves SOLO un JSON, sin texto.

Campos exactos:
- "producto": nombre del producto que el cliente quiere (string, "" si no se menciona)
- "cantidad": unidades (numero entero, 1 si no se dice)
- "precioAcordado": precio que quedo acordado, en pesos colombianos, como numero entero sin puntos ni comas (ej: 84900). null si no se menciona o no queda claro.
- "direccion": direccion que dio el cliente (string, "" si no dio)
- "clienteConfirmo": true solo si el cliente acepto/claramente confirmo el pedido. false si solo pregunto o quedo a medias.
- "entregaFutura": true si el cliente pidió que se entregue/reciba en una fecha posterior a hoy o pidió aplazarla; false si no pidió una fecha futura; null si no se puede determinar.
- "fechaEntregaSolicitada": fecha o expresión de fecha solicitada por el cliente (string; "" si no existe).
- "fechaEntregaISO": si entregaFutura es true, la fecha concreta pedida como "AAAA-MM-DD", calculada con la fecha de hoy que se te da y los timestamps del chat ("" si no se puede saber el dia exacto).
- "productos": arreglo con CADA producto que el cliente pidió: [{"producto": "nombre", "cantidad": entero, "precio": precio de ese producto en pesos (numero entero; null si no se dijo)}]. Si pidió uno solo, un arreglo de un elemento. Usa los productos del pedido que te paso aparte como referencia de nombres.
- "corregimiento": si el cliente dice que vive en un corregimiento, inspección o centro poblado (un pueblo que pertenece a otro municipio, p. ej. "Rozo" de Palmira o "San Antonio de Prado" de Medellín), su nombre solo, sin la palabra "corregimiento" (string). "" si vive en la ciudad o municipio (un barrio NO es un corregimiento).
- "incertidumbre": arreglo de strings con lo que no quedo claro.
- "razonamiento": 2 o 3 frases en español que expliquen lo que entendiste del chat (que pidio el cliente, a que precio, si confirmo y por que lo crees). Solo lo que dice el chat.
- "direccionEnvio": analisis de la DIRECCION DEL PEDIDO (la que te paso aparte, no la del chat). Es un objeto:
  {"esNomenclatura": true|false, "formato": "via"|"manzana", "tipoVia": "", "via": "", "cruce": "", "placa": "", "supermanzana": "", "manzana": "", "casa": "", "lote": "", "complemento": "", "barrio": "", "motivo": ""}
  Hay DOS formatos validos en Colombia:
  (a) formato "via" (el mas comun):
  Las direcciones urbanas de Colombia son: TIPO DE VIA + numero de la via # numero de la via que cruza - placa (numero de la puerta), y opcionalmente complemento y barrio.
  Ej.: "Cra 40 # 23-23, Centro" -> tipoVia "Carrera", via "40", cruce "23", placa "23", barrio "Centro".
  Tipos de via: Calle (Cl, Cll), Carrera (Cra, Kr, Cr), Avenida (Av), Avenida Calle (Ac), Avenida Carrera (Ak), Diagonal (Dg), Transversal (Tv, Tr), Circular (Cq), Autopista.
  "via" y "cruce" pueden llevar letra pegada y Bis/Sur/Este ("29A", "4 Bis B", "8 Sur"); "placa" son 1 a 3 digitos (y puede llevar Sur/Este).
  Si al cliente le faltan los separadores, propón la division mas natural SIN cambiar, agregar ni quitar ningun digito y en el mismo orden: "cra 21 #1212" -> via "21", cruce "12", placa "12"; "calle 5 numero 3 20" -> via "5", cruce "3", placa "20".
  complemento: apto, torre, interior, bloque, casa, local, etc. (con sus numeros tal cual).
  (b) formato "manzana" (usado en muchas ciudades, sobre todo en urbanizaciones): [Supermanzana X] Manzana Y + Casa Z o Lote Z, mas el barrio/urbanizacion/conjunto.
  Abreviaturas: Supermanzana = Smz/SM, Manzana = Mz/Mza/Manz, Casa = Cs/Csa, Lote = Lt/Lte. El identificador puede ser numero o letra ("Mz B", "Mz 12A").
  Ej.: "mz b cs 12 los almendros" -> formato "manzana", manzana "B", casa "12", barrio "Los Almendros". En este formato deja tipoVia/via/cruce/placa vacios.
  El barrio es obligatorio en el formato manzana: si no lo hay, esNomenclatura=false y motivo "falta el barrio".
  esNomenclatura=false si la direccion es solo descriptiva ("casa verde al lado de la panaderia", "frente al parque"), rural (vereda, finca, km) o le faltan partes que no se pueden deducir sin inventar; en ese caso explica en "motivo".
- "evidencia": objeto con las claves "producto", "cantidad", "precioAcordado", "direccion", "clienteConfirmo", "entregaFutura" y "corregimiento". En cada una, copia TEXTUALMENTE la frase corta del chat (maximo 120 caracteres) de la que sacaste ese dato, empezando por quien la dijo, por ejemplo "CLIENTE: confirmo, a la Carrera 92 #78b-02". Usa "" si no hay frase que lo respalde.

Reglas:
- No inventes. Si algo no esta en el chat, usa "" o null.
- Revisa especialmente si el cliente dice algo como "lo quiero para el 30", "entregar mañana", "después del viernes" o "la próxima semana". En esos casos entregaFutura=true aunque haya confirmado el resto. Usa los timestamps de la conversación para decidir si la fecha ya pasó; si no es claro, usa null.
- No marques entregaFutura=true por frases sin fecha de entrega futura (por ejemplo, "para confirmar" o "para regalo" sin fecha).
- Los precios van como numero entero en pesos (84900, no "84.900").
- La evidencia debe ser una cita real del chat, no un resumen ni una deduccion.
- Responde SOLO el JSON, sin marcas de codigo ni explicacion.`;

const CLAVES_EVIDENCIA = ["producto", "cantidad", "precioAcordado", "direccion", "clienteConfirmo", "entregaFutura", "segundaCompra", "corregimiento"];

/** gpt-5*, o1/o3/o4 en OpenAI (u OpenRouter con prefijo openai/) aceptan reasoning_effort. */
export function esModeloRazonamiento(modelo, base = "") {
  const m = String(modelo ?? "").toLowerCase().replace(/^openai\//, "");
  const b = String(base ?? "");
  return /^(gpt-5|o1|o3|o4)/.test(m) && (/openai\.com/.test(b) || /openrouter\.ai/.test(b) || !b);
}

/** Salida cuando la IA no respondio (timeout, HTTP, JSON roto): no es el chat. */
function falloIA(motivo) {
  return { ...normalizarSalida({ incertidumbre: [motivo] }), falloTecnico: motivo };
}

/** Une los mensajes del chat en un texto plano con emisor y hora. */
function aTexto(mensajes) {
  return (Array.isArray(mensajes) ? mensajes : [])
    .map((m) => {
      const quien = m?.de === "bot" ? "BOT" : m?.de === "agente" || m?.de === "asesor" ? "ASESOR" : "CLIENTE";
      const hora = m?.ts ? ` (${m.ts})` : "";
      return `${quien}${hora}: ${m?.texto ?? ""}`;
    })
    .join("\n")
    .trim();
}

/** Garantiza que la salida tenga SIEMPRE la forma esperada. */
function normalizarSalida(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    producto: typeof o.producto === "string" ? o.producto.trim() : "",
    cantidad: Number.isInteger(o.cantidad) && o.cantidad > 0 ? o.cantidad : 1,
    precioAcordado:
      typeof o.precioAcordado === "number" && Number.isFinite(o.precioAcordado) ? o.precioAcordado : null,
    direccion: typeof o.direccion === "string" ? o.direccion.trim() : "",
    clienteConfirmo: o.clienteConfirmo === true,
    entregaFutura: typeof o.entregaFutura === "boolean" ? o.entregaFutura : null,
    fechaEntregaSolicitada: typeof o.fechaEntregaSolicitada === "string" ? o.fechaEntregaSolicitada.trim() : "",
    fechaEntregaISO: typeof o.fechaEntregaISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.fechaEntregaISO.trim()) ? o.fechaEntregaISO.trim() : "",
    productos: Array.isArray(o.productos)
      ? o.productos
          .filter((x) => x && typeof x === "object" && String(x.producto ?? "").trim())
          .slice(0, 10)
          .map((x) => ({
            producto: String(x.producto).trim().slice(0, 160),
            cantidad: Number.isInteger(Number(x.cantidad)) && Number(x.cantidad) > 0 ? Number(x.cantidad) : 1,
            precio: Number.isFinite(Number(x.precio)) && x.precio !== null && x.precio !== "" ? Number(x.precio) : null,
          }))
      : [],
    corregimiento: typeof o.corregimiento === "string" ? o.corregimiento.replace(/^\s*(corregimiento|vereda|inspecci[oó]n|centro poblado)\s+(de\s+)?/i, "").trim().slice(0, 80) : "",
    incertidumbre: Array.isArray(o.incertidumbre) ? o.incertidumbre.map(String) : [],
    razonamiento: typeof o.razonamiento === "string" ? o.razonamiento.trim().slice(0, 800) : "",
    // solo cuando se le mostraron otros pedidos del mismo cliente
    segundaCompra: typeof o.segundaCompra === "boolean" ? o.segundaCompra : null,
    // la IA solo descompone la direccion: la valida el codigo (direccionColombia.js)
    direccionEnvio:
      o.direccionEnvio && typeof o.direccionEnvio === "object"
        ? Object.fromEntries(
            ["formato", "tipoVia", "via", "cruce", "placa", "supermanzana", "manzana", "casa", "lote", "complemento", "barrio", "motivo"].map((k) => [
              k,
              typeof o.direccionEnvio[k] === "string" || typeof o.direccionEnvio[k] === "number"
                ? String(o.direccionEnvio[k]).trim().slice(0, 120)
                : "",
            ]).concat([["esNomenclatura", o.direccionEnvio.esNomenclatura === true]]),
          )
        : null,
    // cita del chat que respalda cada dato (para revisar, no para decidir)
    evidencia: Object.fromEntries(
      CLAVES_EVIDENCIA.map((k) => [
        k,
        typeof o.evidencia?.[k] === "string" ? o.evidencia[k].trim().slice(0, 200) : "",
      ]),
    ),
  };
}

/**
 * Crea el extractor con la config del server.
 *   extraerConversacion(mensajes) -> datos extraidos (forma normalizada)
 */
export function crearExtractorLLM(config = {}) {
  return async function extraerConversacion(mensajes, contexto = {}) {
    // se leen en cada llamada: la clave, el proveedor y el modelo se pueden
    // cambiar desde el panel sin reiniciar el servidor
    const base = String(config.LLM_BASE || DEFECTO_BASE).replace(/\/+$/, "");
    const modelo = String(config.LLM_MODELO || "gpt-5-mini");
    const apiKey = String(config.LLM_API_KEY ?? "");
    const timeout = Number(config.LLM_TIMEOUT_MS ?? 90000) || 90000;
    if (!apiKey) {
      // sin llave no hay extraccion: que lo sepa quien decide (agente frena)
      return falloIA("no hay API key de la IA configurada (Ajustes > Subida a Dropi > IA que lee los chats)");
    }
    const texto = aTexto(mensajes);
    if (!texto) {
      return normalizarSalida({ incertidumbre: ["la conversacion esta vacia"] });
    }

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelo,
          // sin `temperature`: los modelos de razonamiento (gpt-5*) solo aceptan
          // el valor por defecto y devuelven 400 si se les manda otro
          response_format: { type: "json_object" },
          // es extraccion de datos, no un problema dificil: con los modelos
          // de razonamiento de OpenAI se pide poco razonamiento (mas rapido)
          ...(esModeloRazonamiento(modelo, base) ? { reasoning_effort: "low" } : {}),
          messages: [
            // el prompt guardado desde el panel; si no hay, el predeterminado
            { role: "system", content: String(config.LLM_PROMPT || "").trim() || PROMPT_DEFECTO },
            {
              role: "user",
              content:
                `Conversacion:\n${texto}\n\n` +
                `Direccion del pedido (la que se enviara a la transportadora): ${String(contexto?.direccionPedido ?? "").trim() || "(vacia)"}\n\n` +
                (contexto?.otrosPedidos
                  ? `Este cliente ya tiene OTRO pedido reciente:\n${contexto.otrosPedidos}\n` +
                    "Puede ser el mismo pedido repetido por error del bot. Agrega al JSON el campo " +
                    '"segundaCompra": true SOLO si en el chat el cliente pidio claramente una compra NUEVA ademas de esa ' +
                    "(otra unidad, otro producto, volvio a pedir despues de confirmar el primero); false si el chat solo muestra " +
                    "una compra; y en evidencia.segundaCompra la frase del cliente que lo muestra.\n\n"
                  : "") +
                (contexto?.productosPedido
                  ? `Productos del pedido: ${contexto.productosPedido}\n` +
                    'Agrega al JSON "productos": [{"producto", "cantidad", "precio"}] con CADA producto que el cliente pidió en el chat (precio de ese producto en pesos, null si no se dijo).\n'
                  : "") +
                'Si el cliente dice que vive en un corregimiento o centro poblado (no un barrio), agrega "corregimiento" con su nombre solo ("" si no).\n' +
                `Hoy es ${hoyColombia()} (hora de Colombia). Si el cliente pidió la entrega para una fecha futura, agrega al JSON ` +
                '"fechaEntregaISO" con esa fecha como "AAAA-MM-DD" ("" si no se puede saber el día exacto).\n\n' +
                "Devuelve el JSON.",
            },
          ],
        }),
      });
      if (!r.ok) {
        const detalle = await r.text().catch(() => "");
        console.warn(`[llm] ${r.status}: ${detalle.slice(0, 200)}`);
        return falloIA(`la IA respondió HTTP ${r.status}${r.status === 401 ? " (API key inválida)" : r.status === 429 ? " (sin saldo o límite de uso)" : ""}`);
      }
      const data = await r.json();
      const contenido = data?.choices?.[0]?.message?.content ?? "";
      let parsed = null;
      try {
        parsed = JSON.parse(contenido);
      } catch {
        // a veces el modelo envuelve el JSON en ```json ... ```
        const m = String(contenido).match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            parsed = null;
          }
        }
      }
      if (!parsed) return falloIA("la IA no devolvió un JSON válido");
      return normalizarSalida(parsed);
    } catch (err) {
      const msg = err?.name === "AbortError" ? `la IA no respondió en ${Math.round(timeout / 1000)} s` : `error al llamar a la IA: ${err?.message ?? err}`;
      console.warn("[llm]", msg);
      return falloIA(msg);
    } finally {
      clearTimeout(t);
    }
  };
}

/**
 * Prueba la clave/proveedor/modelo con una peticion minima (sin datos de
 * clientes). Devuelve {ok, status, detalle, ms}.
 */
export async function probarLLM({ base, modelo, apiKey, timeoutMs = 30000, fetcher = fetch } = {}) {
  const url = `${String(base || DEFECTO_BASE).replace(/\/+$/, "")}/chat/completions`;
  if (!apiKey) return { ok: false, detalle: "No hay API key para probar" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const inicio = Date.now();
  try {
    const r = await fetcher(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelo || "gpt-5-mini",
        response_format: { type: "json_object" },
        ...(esModeloRazonamiento(modelo || "gpt-5-mini", base) ? { reasoning_effort: "low" } : {}),
        messages: [{ role: "user", content: 'Responde solo este JSON: {"ok": true}' }],
      }),
    });
    const ms = Date.now() - inicio;
    if (!r.ok) {
      const texto = await r.text().catch(() => "");
      let msg = texto.slice(0, 200);
      try {
        msg = JSON.parse(texto)?.error?.message ?? msg;
      } catch {
        /* no era JSON */
      }
      const pista =
        r.status === 401 ? " (la API key no es válida)" :
        r.status === 404 ? " (el modelo o la URL del proveedor no existe)" :
        r.status === 429 ? " (sin saldo o límite de uso alcanzado)" : "";
      return { ok: false, status: r.status, ms, detalle: `El proveedor respondió ${r.status}${pista}: ${String(msg).slice(0, 200)}` };
    }
    const data = await r.json().catch(() => null);
    const contenido = String(data?.choices?.[0]?.message?.content ?? "");
    return contenido
      ? { ok: true, status: r.status, ms, detalle: `Funciona: el modelo respondió en ${(ms / 1000).toFixed(1)} s` }
      : { ok: false, status: r.status, ms, detalle: "El proveedor respondió sin contenido" };
  } catch (e) {
    return { ok: false, detalle: e?.name === "AbortError" ? "El proveedor no respondió a tiempo" : `No se pudo conectar: ${e?.message ?? e}` };
  } finally {
    clearTimeout(t);
  }
}
