// Conversación local de compatibilidad para pedidos.
// La subida preferentemente trae el último chat directamente desde el campo
// personalizado del contacto en LucidBot. Este archivo conserva el formato
// local antiguo como alternativa mientras se configura la lectura por API.
//
// Se guarda en JSONL (una linea por envio) igual que historial.jsonl: el envio
// mas reciente de un pedido ES "su" conversacion; los anteriores quedan como
// auditoria. Cada POST reemplaza la conversacion del pedido.
import fs from "node:fs";
import path from "node:path";

const LIMITE_MENSAJES = 500;
const LIMITE_TEXTO = 2000;

/** Emisores que reconocemos; todo lo demas cuenta como "cliente". */
const EMISORES = new Set(["cliente", "bot", "agente", "asesor"]);

/** Mensaje crudo -> {de, texto, ts}; null si no sirve. */
export function normalizarMensaje(m) {
  if (!m || typeof m !== "object") return null;
  const texto = String(m.texto ?? m.text ?? m.mensaje ?? "").trim();
  if (!texto) return null;
  const crudo = String(m.de ?? m.from ?? m.autor ?? "cliente").toLowerCase().trim();
  return {
    de: EMISORES.has(crudo) ? crudo : "cliente",
    texto: texto.slice(0, LIMITE_TEXTO),
    ts: String(m.ts ?? m.fecha ?? m.timestamp ?? ""),
  };
}

/** Arreglo de mensajes crudos -> solo los validos, en orden, tope 500. */
export function normalizarMensajes(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(normalizarMensaje)
    .filter(Boolean)
    .slice(-LIMITE_MENSAJES);
}

/**
 * Transcripcion de WhatsApp (el formato con el que la app del bot vuelca el
 * chat) -> mensajes ya normalizados ({de, ts, texto}).
 *
 * Cada mensaje empieza con una linea "Emisor (fecha): texto" y las lineas que
 * siguen SIN emisor son continuacion del mismo mensaje (el bot escribe en
 * varios parrafos). Ej:
 *
 *   Usuario (2026-10-4 5:24am): Hola
 *   Bot (2026-10-4 5:24am): primera linea
 *   segunda linea del mismo mensaje
 *   Usuario (2026-10-4 5:27am): ok
 */
const MARCA_TRANSCRIPCION = /^(Usuario|Bot|Cliente|Agente|Asesor)\s*\(([^)]*)\)\s*:\s*(.*)$/i;

function emisorDe(quien) {
  const q = String(quien ?? "").toLowerCase();
  if (q === "bot") return "bot";
  if (q === "agente" || q === "asesor") return "asesor";
  return "cliente";
}

export function parsearTranscripcion(texto) {
  const mensajes = [];
  let actual = null;
  for (const linea of String(texto ?? "").split(/\r?\n/)) {
    const m = linea.match(MARCA_TRANSCRIPCION);
    if (m) {
      actual = { de: emisorDe(m[1]), ts: m[2].trim(), texto: m[3].trim() };
      mensajes.push(actual);
    } else if (actual && linea.trim()) {
      actual.texto = actual.texto ? `${actual.texto}\n${linea.trim()}` : linea.trim();
    }
  }
  return mensajes;
}

export function crearConversaciones(ruta) {
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  } catch {
    /* ya existe o no hace falta */
  }

  /** Un registro entero por linea (append). false si no se pudo escribir. */
  function volcar(registro) {
    try {
      fs.appendFileSync(ruta, `${JSON.stringify(registro)}\n`, "utf8");
      return true;
    } catch (err) {
      console.warn("[conversacion] no se pudo escribir:", err?.message ?? err);
      return false;
    }
  }

  function leerTodo() {
    try {
      return fs
        .readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return []; // aun no hay archivo
    }
  }

  return {
    /**
     * Guarda (reemplaza) la conversacion de un pedido.
     * Devuelve {ok, guardados, ts}.
     *
     * Acepta dos formas:
     *   { mensajes: [{de, texto, ts}] }   -> la forma estructurada
     *   { texto: "Usuario (...)..." }     -> la transcripcion que vuelca el bot
     */
    guardar(id, datos = {}) {
      let mensajes;
      if (Array.isArray(datos.mensajes)) {
        mensajes = normalizarMensajes(datos.mensajes);
      } else if (typeof datos.texto === "string" && datos.texto.trim()) {
        mensajes = normalizarMensajes(parsearTranscripcion(datos.texto));
      } else {
        mensajes = [];
      }
      const registro = {
        ts: new Date().toISOString(),
        id: String(id),
        telefono: String(datos.telefono ?? "").slice(0, 40),
        mensajes,
        meta: datos.meta && typeof datos.meta === "object" ? datos.meta : {},
      };
      const ok = volcar(registro);
      return { ok, guardados: mensajes.length, ts: registro.ts };
    },

    /** Conversacion mas reciente de un pedido; null si no hay. */
    porPedido(id) {
      const clave = String(id);
      const todo = leerTodo();
      for (let i = todo.length - 1; i >= 0; i--) {
        if (String(todo[i].id) === clave) return todo[i];
      }
      return null;
    },

    /** Cuantos envios tiene cada pedido (para la lista). */
    resumen() {
      const porId = new Map();
      for (const r of leerTodo()) {
        const k = String(r.id);
        const prev = porId.get(k);
        if (!prev || String(r.ts) > String(prev.ts)) porId.set(k, r);
      }
      return [...porId.values()].map((r) => ({
        id: r.id,
        telefono: r.telefono,
        ts: r.ts,
        mensajes: Array.isArray(r.mensajes) ? r.mensajes.length : 0,
      }));
    },
  };
}
