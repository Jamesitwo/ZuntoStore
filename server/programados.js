// Entregas programadas: pedidos que el cliente pidió para una fecha futura
// ("lo quiero para el 30"). Los marca la IA al leer el chat o una persona a
// mano desde el panel. Mientras no llegue la fecha, la subida automática no
// los sube; cuando se acerca, el panel los resalta para enviarlos.
//
// Archivo JSON: { "<id del pedido>": { fecha, nota, origen, ... } }
import fs from "node:fs";
import path from "node:path";
import { diasHasta, fechaValida, hoyColombia } from "./fechaEntrega.js";

/** Con cuantos dias de anticipacion se resalta (y se sube) por defecto. */
export const DIAS_ANTES_DEFECTO = 1;

export function crearProgramados({ ruta = null, log = console } = {}) {
  let datos = {};
  if (ruta) {
    try {
      const d = JSON.parse(fs.readFileSync(ruta, "utf8"));
      if (d && typeof d === "object") datos = d;
    } catch {
      /* primera vez */
    }
  }

  function guardar() {
    if (!ruta) return;
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
      fs.renameSync(tmp, ruta);
    } catch (e) {
      log.warn?.("[programados] no se pudo guardar:", e?.message ?? e);
    }
  }

  /** Lo que ve el panel: con los dias que faltan calculados hoy. */
  function vista(id, p, hoy = hoyColombia(), diasAntes = DIAS_ANTES_DEFECTO) {
    const faltan = diasHasta(p.fecha, hoy);
    return {
      id,
      ...p,
      faltan,
      // "vencido": la fecha ya paso y nadie lo envio
      estado: p.enviado ? "enviado" : p.anulado ? "enviar-ya" : faltan < 0 ? "vencido" : faltan <= diasAntes ? "toca" : "en-espera",
    };
  }

  return {
    /**
     * Marca (o cambia) la fecha de entrega de un pedido.
     * origen: "ia" | "manual". Una marca manual no la pisa la IA.
     */
    poner(id, { fecha, nota = "", origen = "manual", por = "", texto = "", numero = null, tienda = null, cliente = null } = {}) {
      const clave = String(id ?? "").trim();
      if (!clave) throw new Error("Falta el id del pedido");
      const f = fechaValida(fecha, hoyColombia());
      if (!f) throw new Error("La fecha no es válida: usa una fecha de hoy en adelante (máximo 6 meses)");
      const previo = datos[clave];
      // la IA no pisa lo que decidio una persona (una fecha, o "enviar ya")
      if (previo && (previo.origen === "manual" || previo.anulado) && origen === "ia") return vista(clave, previo);
      const ahora = new Date().toISOString();
      datos[clave] = {
        fecha: f,
        nota: String(nota ?? "").trim().slice(0, 300),
        origen: origen === "ia" ? "ia" : "manual",
        ...(por ? { por: String(por).slice(0, 120) } : {}),
        ...(texto ? { texto: String(texto).slice(0, 200) } : {}),
        numero: numero ?? previo?.numero ?? null,
        tienda: tienda ?? previo?.tienda ?? null,
        ...(cliente || previo?.cliente ? { cliente: cliente ?? previo.cliente } : {}),
        creado: previo?.creado ?? ahora,
        actualizado: ahora,
      };
      guardar();
      return vista(clave, datos[clave]);
    },

    /**
     * Quita la marca: el pedido se envía ya. Queda anotado ("anulado") para
     * que la IA no lo vuelva a programar al releer el chat.
     */
    quitar(id, por = "") {
      const clave = String(id ?? "").trim();
      const p = datos[clave];
      if (!p || p.anulado) return false;
      datos[clave] = { ...p, anulado: new Date().toISOString(), ...(por ? { anuladoPor: String(por).slice(0, 120) } : {}) };
      guardar();
      return true;
    },

    /** Se subio a Dropi: queda en el historial como enviado. */
    marcarEnviado(id) {
      const clave = String(id ?? "").trim();
      if (!datos[clave] || datos[clave].enviado) return;
      datos[clave] = { ...datos[clave], enviado: new Date().toISOString() };
      guardar();
    },

    get(id, opciones = {}) {
      const p = datos[String(id ?? "").trim()];
      return p ? vista(String(id).trim(), p, opciones.hoy, opciones.diasAntes) : null;
    },

    /** ¿Ya toca enviarlo? (faltan diasAntes o menos). Sin marca: true. */
    toca(id, diasAntes = DIAS_ANTES_DEFECTO, hoy = hoyColombia()) {
      const p = datos[String(id ?? "").trim()];
      return !p || p.enviado || p.anulado ? true : diasHasta(p.fecha, hoy) <= diasAntes;
    },

    /** Todos, los mas proximos primero. Los enviados de hace mas de 30 dias se omiten. */
    lista({ diasAntes = DIAS_ANTES_DEFECTO, hoy = hoyColombia(), incluirEnviados = false } = {}) {
      return Object.entries(datos)
        .map(([id, p]) => vista(id, p, hoy, diasAntes))
        .filter((p) => !p.anulado)
        .filter((p) => incluirEnviados || !p.enviado)
        .filter((p) => !p.enviado || diasHasta(p.fecha, hoy) > -30)
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
    },
  };
}
