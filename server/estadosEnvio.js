// Estado del envio que llega desde Lucid Bot.
//
// Cuando el pedido se sube a Dropi a mano (o con nuestra subida), LucidSales
// no se entera del estado de la guia y se queda en "Sin Envio". Lucid Bot si
// lo recibe, asi que un flujo de Lucid Bot lo manda aqui (Solicitud externa):
//
//   POST /api/envios/estado   (x-api-key)
//   { "telefono": "+573001234567", "estado": "EN REPARTO",
//     "guia": "240012345678", "transportadora": "COORDINADORA",
//     "pedido": "6106", "novedad": "" }
//
// Solo `estado` y `telefono` (o `guia`/`pedido`) son obligatorios; los nombres
// de los campos aceptan variantes (status, phone, numero_guia, ...).
//
// El panel pregunta por sus pedidos y a cada uno le toca el ultimo estado:
//  1. del mismo pedido (si Lucid Bot mando el numero o el id), o
//  2. de la misma guia, o
//  3. del mismo telefono, recibido DESPUES de crear el pedido.
import fs from "node:fs";
import path from "node:path";

const MAX_POR_CLAVE = 30; // eventos guardados por telefono
const MAX_TELEFONOS = 20000;

/** Ultimos 10 digitos (igual que el panel): +57 300... = 300... */
export function claveTelefono(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : "";
}

const texto = (v, max = 200) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

/** El primero de esos campos que venga con algo. */
function campo(cuerpo, nombres, max) {
  for (const n of nombres) {
    const v = texto(cuerpo?.[n], max);
    // Lucid Bot deja la variable tal cual si esta vacia: "{{guia}}"
    if (v && !/^\{\{.*\}\}$/.test(v)) return v;
  }
  return "";
}

/** Normaliza lo que manda Lucid Bot. Lanza Error si no sirve. */
export function normalizarEvento(cuerpo, ahora = new Date()) {
  const estado = campo(cuerpo, ["estado", "status", "estado_envio", "estadoEnvio", "estado_guia", "shipping_status"], 80);
  if (!estado) throw new Error("Falta 'estado' (el estado del envio)");
  const telefono = claveTelefono(campo(cuerpo, ["telefono", "phone", "celular", "movil", "whatsapp", "Movil"], 40));
  const guia = campo(cuerpo, ["guia", "numero_guia", "numeroGuia", "tracking", "guide"], 60).replace(/\s+/g, "");
  const pedido = campo(cuerpo, ["pedido", "idPedido", "id_pedido", "order_id", "orden", "numero_pedido"], 40).replace(/^#/, "");
  if (!telefono && !guia && !pedido) {
    throw new Error("Falta con que identificar el pedido: 'telefono', 'guia' o 'pedido'");
  }
  let ts = ahora.toISOString();
  const fecha = campo(cuerpo, ["fecha", "date", "updated_at"], 40);
  if (fecha && Number.isFinite(Date.parse(fecha))) {
    const f = new Date(Date.parse(fecha));
    // una fecha "del futuro" o absurda no manda: se usa la de llegada
    if (f.getTime() <= ahora.getTime() + 5 * 60_000 && f.getFullYear() >= 2020) ts = f.toISOString();
  }
  return {
    ts,
    recibido: ahora.toISOString(),
    estado,
    telefono,
    guia,
    pedido,
    transportadora: campo(cuerpo, ["transportadora", "carrier", "courier"], 60),
    novedad: campo(cuerpo, ["novedad", "detalle", "observacion", "comentario"], 300),
  };
}

/** Para comparar estados: sin tildes, mayusculas y espacios de mas. */
export function normalizarEstado(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function crearEstadosEnvio({ ruta = null, log = console } = {}) {
  /** { porTelefono: {clave: [eventos]}, sinTelefono: [eventos] } */
  let datos = { porTelefono: {}, sinTelefono: [] };
  if (ruta) {
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
      datos = { porTelefono: j?.porTelefono ?? {}, sinTelefono: Array.isArray(j?.sinTelefono) ? j.sinTelefono : [] };
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
      log.warn?.("[envios] no se pudo guardar:", e?.message ?? e);
    }
  }

  function recortar() {
    const claves = Object.keys(datos.porTelefono);
    if (claves.length <= MAX_TELEFONOS) return;
    const ultimo = (k) => datos.porTelefono[k].at(-1)?.recibido ?? "";
    claves.sort((a, b) => ultimo(a).localeCompare(ultimo(b)));
    for (const k of claves.slice(0, claves.length - MAX_TELEFONOS)) delete datos.porTelefono[k];
  }

  function todos() {
    return [...Object.values(datos.porTelefono).flat(), ...datos.sinTelefono];
  }

  return {
    /** Guarda un aviso de Lucid Bot. Devuelve el evento normalizado. */
    registrar(cuerpo) {
      const ev = normalizarEvento(cuerpo);
      if (ev.telefono) {
        const lista = (datos.porTelefono[ev.telefono] ??= []);
        lista.push(ev);
        lista.sort((a, b) => a.ts.localeCompare(b.ts));
        if (lista.length > MAX_POR_CLAVE) lista.splice(0, lista.length - MAX_POR_CLAVE);
        recortar();
      } else {
        datos.sinTelefono.push(ev);
        if (datos.sinTelefono.length > 2000) datos.sinTelefono.splice(0, datos.sinTelefono.length - 2000);
      }
      guardar();
      return ev;
    },

    /**
     * Ultimo estado de cada pedido.
     * pedidos: [{ id, idPedido, telefono, fecha, guia? }]
     * -> { "<id>": { estado, transportadora, guia, novedad, ts, por } }
     */
    consultar(pedidos = []) {
      const salida = {};
      const lista = todos();
      for (const p of Array.isArray(pedidos) ? pedidos.slice(0, 500) : []) {
        const id = texto(p?.id, 40);
        if (!id) continue;
        const numeros = new Set([id, texto(p?.idPedido, 40)].filter(Boolean));
        const guia = texto(p?.guia, 60).replace(/\s+/g, "");
        const tel = claveTelefono(p?.telefono);
        const creado = Date.parse(p?.fecha ?? "");
        // un dia de margen: la fecha de LucidSales puede venir sin zona horaria
        const desde = Number.isFinite(creado) ? creado - 24 * 3600_000 : null;

        const ultimo = (evs) => evs.reduce((a, b) => (!a || b.ts > a.ts ? b : a), null);
        let ev = ultimo(lista.filter((e) => e.pedido && numeros.has(e.pedido)));
        let por = "pedido";
        if (!ev && guia) {
          ev = ultimo(lista.filter((e) => e.guia && e.guia === guia));
          por = "guia";
        }
        if (!ev && tel) {
          // del telefono, pero sin robar los que ya dicen ser de OTRO pedido
          const delTel = (datos.porTelefono[tel] ?? []).filter(
            (e) => !e.pedido && (desde === null || Date.parse(e.ts) >= desde),
          );
          ev = ultimo(delTel);
          por = "telefono";
        }
        if (ev) {
          salida[id] = {
            estado: ev.estado,
            transportadora: ev.transportadora,
            guia: ev.guia,
            novedad: ev.novedad,
            ts: ev.ts,
            por,
          };
        }
      }
      return salida;
    },

    /**
     * Todos los avisos de UN pedido, del mas viejo al mas nuevo (linea de
     * tiempo). Mismo criterio que `consultar`: los que dicen ser del pedido,
     * los de su guia y, si no hay de esos, los del telefono desde que se creo.
     * Repeticiones seguidas del mismo estado se juntan (Lucid Bot reenvia).
     */
    historial(p = {}) {
      const id = texto(p?.id, 40);
      const numeros = new Set([id, texto(p?.idPedido, 40)].filter(Boolean));
      const lista = todos();
      let evs = lista.filter((e) => e.pedido && numeros.has(e.pedido));
      const guias = new Set([texto(p?.guia, 60).replace(/\s+/g, ""), ...evs.map((e) => e.guia)].filter(Boolean));
      if (guias.size) evs = [...evs, ...lista.filter((e) => e.guia && guias.has(e.guia) && !evs.includes(e))];
      if (!evs.length) {
        const tel = claveTelefono(p?.telefono);
        const creado = Date.parse(p?.fecha ?? "");
        const desde = Number.isFinite(creado) ? creado - 24 * 3600_000 : null;
        evs = (datos.porTelefono[tel] ?? []).filter((e) => !e.pedido && (desde === null || Date.parse(e.ts) >= desde));
      }
      evs.sort((a, b) => a.ts.localeCompare(b.ts));
      const salida = [];
      for (const e of evs) {
        const previo = salida.at(-1);
        const igual = previo && previo.estado.toLowerCase() === e.estado.toLowerCase() && (previo.novedad ?? "") === (e.novedad ?? "");
        if (igual) {
          previo.repeticiones = (previo.repeticiones ?? 1) + 1;
          continue;
        }
        salida.push({ ts: e.ts, estado: e.estado, transportadora: e.transportadora, guia: e.guia, novedad: e.novedad });
      }
      return salida;
    },

    /** Los estados distintos que ha mandado Lucid Bot, con cuantos avisos (para el filtro). */
    estadosConocidos() {
      const mapa = new Map();
      for (const e of todos()) {
        const k = normalizarEstado(e.estado);
        if (!k) continue;
        const x = mapa.get(k) ?? { estado: e.estado, avisos: 0 };
        x.avisos++;
        mapa.set(k, x);
      }
      return [...mapa.values()].sort((a, b) => a.estado.localeCompare(b.estado, "es"));
    },

    /** Los ultimos avisos recibidos (para revisar que Lucid Bot si manda). */
    ultimos(n = 20) {
      return todos()
        .sort((a, b) => b.recibido.localeCompare(a.recibido))
        .slice(0, Math.max(1, Math.min(Number(n) || 20, 100)));
    },
  };
}
