// Etiquetas de pedidos (propias de Zunto: LucidSales no las tiene).
//
// Antes vivian en el navegador de cada persona; ahora las guarda el servidor
// para que todos vean las mismas y para que la subida a Dropi pueda etiquetar
// sola los pedidos que no pudo subir (una etiqueta por motivo).
//
// Archivo JSON: { "<tienda>": { etiquetas: [{id, nombre, color, auto?}],
//                               asignaciones: { "<pedido>": ["<id>", ...] } } }
import fs from "node:fs";
import path from "node:path";

const COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_DEFECTO = "#2f5bea";

/**
 * Etiquetas automaticas de la subida a Dropi: motivo (accion) -> nombre y
 * color. Su id es fijo ("auto_<motivo>") para reconocerlas.
 */
export const ETIQUETAS_SUBIDA = {
  "direccion-invalida": ["Dropi · Dirección inválida", "#dc2626"],
  "requiere-revision": ["Dropi · En revisión", "#dc2626"],
  "envio-caro": ["Dropi · Envío caro", "#ea580c"],
  "sin-transportadora": ["Dropi · Sin transportadora", "#ea580c"],
  "requiere-humano": ["Dropi · Lo sube una persona", "#d97706"],
  "posible-duplicado": ["Dropi · Posible repetido", "#db2777"],
  "resultado-incierto": ["Dropi · Resultado incierto", "#7c3aed"],
  frenado: ["Dropi · Frenado", "#d97706"],
  "sin-conversacion": ["Dropi · Sin conversación", "#475569"],
  error: ["Dropi · Error", "#475569"],
  "pedido-antiguo": ["Dropi · Pedido antiguo", "#475569"],
  "entrega-programada": ["Dropi · Entrega programada", "#0891b2"],
  "sin-tienda-dropi": ["Dropi · Sin tienda de Dropi", "#475569"],
};
/** Con estos resultados el pedido ya salio: se le quitan las automaticas. */
const RESUELTOS = new Set(["subido", "subido-pendiente-confirmacion", "preparado", "resuelto-a-mano"]);

const idAuto = (accion) => `auto_${accion}`;
const nuevoId = () => `et_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function sanear(etiqueta) {
  const nombre = String(etiqueta?.nombre ?? "").trim().slice(0, 40);
  if (!nombre) return null;
  return {
    id: String(etiqueta?.id ?? "").trim().slice(0, 60) || nuevoId(),
    nombre,
    color: COLOR.test(String(etiqueta?.color ?? "")) ? etiqueta.color : COLOR_DEFECTO,
    ...(etiqueta?.auto ? { auto: true } : {}),
  };
}

export function crearEtiquetas({ ruta = null, log = console } = {}) {
  let datos = {};
  if (ruta) {
    try {
      const d = JSON.parse(fs.readFileSync(ruta, "utf8"));
      if (d && typeof d === "object" && !Array.isArray(d)) datos = d;
    } catch {
      /* primera vez */
    }
  }

  function guardar() {
    if (!ruta) return;
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(datos));
      fs.renameSync(tmp, ruta);
    } catch (e) {
      log.warn?.("[etiquetas] no se pudo guardar:", e?.message ?? e);
    }
  }

  function de(tienda) {
    const k = String(tienda ?? "").trim() || "_";
    const a = datos[k] && typeof datos[k] === "object" ? datos[k] : (datos[k] = {});
    if (!Array.isArray(a.etiquetas)) a.etiquetas = [];
    if (!a.asignaciones || typeof a.asignaciones !== "object") a.asignaciones = {};
    return a;
  }

  function ponerEn(a, pedido, ids) {
    const k = String(pedido);
    const validos = [...new Set(ids.map(String))].filter((x) => a.etiquetas.some((e) => e.id === x));
    if (validos.length) a.asignaciones[k] = validos;
    else delete a.asignaciones[k];
  }

  return {
    /** Etiquetas y asignaciones de una tienda (copia). */
    almacen(tienda) {
      const a = de(tienda);
      return { etiquetas: a.etiquetas.map((e) => ({ ...e })), asignaciones: { ...a.asignaciones } };
    },

    /** Crea una etiqueta (con el id que mande el panel, o uno nuevo). Si ya hay una con ese nombre, la devuelve. */
    crear(tienda, etiqueta) {
      const a = de(tienda);
      const e = sanear(etiqueta);
      if (!e) throw new Error("La etiqueta necesita un nombre");
      const igual = a.etiquetas.find((x) => x.id === e.id || x.nombre.toLowerCase() === e.nombre.toLowerCase());
      if (igual) return igual;
      a.etiquetas.push(e);
      guardar();
      return e;
    },

    actualizar(tienda, id, cambios = {}) {
      const a = de(tienda);
      const e = a.etiquetas.find((x) => x.id === String(id));
      if (!e) throw new Error("Esa etiqueta no existe");
      const nombre = String(cambios.nombre ?? e.nombre).trim().slice(0, 40);
      if (nombre) e.nombre = nombre;
      if (COLOR.test(String(cambios.color ?? ""))) e.color = cambios.color;
      guardar();
      return e;
    },

    /** Borra la etiqueta y la quita de todos los pedidos. */
    eliminar(tienda, id) {
      const a = de(tienda);
      const k = String(id);
      a.etiquetas = a.etiquetas.filter((x) => x.id !== k);
      for (const [pedido, ids] of Object.entries(a.asignaciones)) {
        const resto = ids.filter((x) => x !== k);
        if (resto.length) a.asignaciones[pedido] = resto;
        else delete a.asignaciones[pedido];
      }
      guardar();
    },

    /** Etiquetas de un pedido (reemplaza las que tenia). */
    asignar(tienda, pedido, ids = []) {
      const a = de(tienda);
      ponerEn(a, pedido, Array.isArray(ids) ? ids : []);
      guardar();
      return a.asignaciones[String(pedido)] ?? [];
    },

    /** Mezcla lo que traiga el navegador (migracion de las etiquetas locales). */
    importar(tienda, { etiquetas = [], asignaciones = {} } = {}) {
      const a = de(tienda);
      let nuevas = 0;
      for (const raw of Array.isArray(etiquetas) ? etiquetas : []) {
        const e = sanear(raw);
        if (!e || a.etiquetas.some((x) => x.id === e.id)) continue;
        a.etiquetas.push(e);
        nuevas++;
      }
      for (const [pedido, ids] of Object.entries(asignaciones && typeof asignaciones === "object" ? asignaciones : {})) {
        if (!Array.isArray(ids)) continue;
        ponerEn(a, pedido, [...(a.asignaciones[String(pedido)] ?? []), ...ids]);
      }
      guardar();
      return nuevas;
    },

    /** Pedidos que tienen una etiqueta. */
    pedidosCon(tienda, id) {
      const a = de(tienda);
      return Object.entries(a.asignaciones)
        .filter(([, ids]) => ids.includes(String(id)))
        .map(([pedido]) => pedido);
    },

    /**
     * La subida a Dropi termino con `accion`: el pedido queda con la etiqueta
     * de ese motivo (y sin las automaticas de antes). Si se subio, sin ninguna.
     * Las etiquetas que puso una persona no se tocan.
     */
    porMotivo(tienda, pedido, accion) {
      if (!tienda || !pedido) return;
      const def = ETIQUETAS_SUBIDA[accion];
      if (!def && !RESUELTOS.has(accion)) return; // p. ej. sesion vencida: no es del pedido
      const a = de(tienda);
      const k = String(pedido);
      const actuales = a.asignaciones[k] ?? [];
      let ids = actuales.filter((x) => !x.startsWith("auto_"));
      if (def) {
        const id = idAuto(accion);
        if (!a.etiquetas.some((e) => e.id === id)) a.etiquetas.push({ id, nombre: def[0], color: def[1], auto: true });
        ids = [...ids, id];
      }
      if (ids.length === actuales.length && ids.every((x, i) => x === actuales[i])) return;
      ponerEn(a, k, ids);
      guardar();
    },
  };
}
