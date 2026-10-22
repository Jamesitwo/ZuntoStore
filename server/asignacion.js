// Horarios de los usuarios y reparto equitativo de pedidos.
//
// Todo vive en un archivo JSON (server/asignacion.json por defecto):
//   horarios:     { "<usuario>": {nombre, activo, dias:[1..7], desde, hasta} }
//   asignaciones: { "<pedido>": {usuario, nombre, idEmpresa, ts} }
//
// Sin base de datos: se lee una vez, se mantiene en memoria y se vuelveca
// entero al disco (escritura atomica: archivo temporal + rename).
//
// Dias: 1 = lunes ... 7 = domingo (el mismo criterio que pinta el panel).
// "Equitativo" = siempre se le da el pedido al que MENOS pedidos tiene (cuenta
// los que ya estan asignados), con desempate por nombre para que el orden sea
// estable entre ejecuciones.
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";

export const ZONA_DEFECTO = "America/Bogota";

/** Configuracion del reparto automatico (la semilla viene del .env). */
export const CONFIG_DEFECTO = {
  /** ¿Reparte solo cuando llegan pedidos nuevos? */
  automatico: false,
  /** Cada cuantos segundos mira (10..3600). */
  cadaSegundos: 60,
  /** "horario" solo reparte a quien esta en turno; "todos" a cualquiera. */
  modo: "horario",
  /** Tiendas que revisa (vacias => LUCID_TIENDA). */
  tiendas: [],
  /** Estados que considera "por atender" (0 = Por confirmar). Vacio = todos. */
  estados: [0],
  /**
   * Quienes participan: lista de correos (los de fuera quedan fuera).
   * `null` = sin restriccion (todos los activos); `[]` = nadie.
   */
  usuarios: null,
};

/** "08:30" -> 510 (minutos desde medianoche); NaN si no es valido. */
export function minutosDe(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/**
 * Hora actual en la zona configurada: {dia: 1..7 (lunes..domingo), minutos}.
 * Se hace con Intl para no depender de la zona del proceso.
 */
export function ahoraEn(zona = ZONA_DEFECTO) {
  const mapa = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  try {
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zona,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    return {
      dia: mapa[partes.weekday] ?? ((new Date().getDay() + 6) % 7) + 1,
      minutos: (Number(partes.hour) % 24) * 60 + Number(partes.minute),
      zona,
    };
  } catch {
    const d = new Date();
    return { dia: ((d.getDay() + 6) % 7) + 1, minutos: d.getHours() * 60 + d.getMinutes(), zona };
  }
}

/** ¿Esta dentro de su horario a esta hora? Sin horas validas -> se asume que si. */
export function dentroDeHorario(h, ahora) {
  if (!h) return false;
  const desde = minutosDe(h.desde);
  const hasta = minutosDe(h.hasta);
  const dias = Array.isArray(h.dias) ? h.dias.map(Number) : [];
  const diaOk = dias.length === 0 || dias.includes(ahora.dia);
  if (!diaOk) return false;
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return true;
  // horario que cruza la medianoche (22:00 -> 06:00)
  const dentro =
    desde <= hasta
      ? ahora.minutos >= desde && ahora.minutos <= hasta
      : ahora.minutos >= desde || ahora.minutos <= hasta;
  return dentro;
}

function validarHorario(h) {
  if (!h || typeof h !== "object") throw new ErrorApi(400, "El horario no es un objeto");
  if (Number.isNaN(minutosDe(h.desde)) || Number.isNaN(minutosDe(h.hasta))) {
    throw new ErrorApi(400, "El horario debe traer desde y hasta con formato HH:MM (p. ej. 08:00)");
  }
  const dias = Array.isArray(h.dias) ? h.dias.map(Number) : [];
  if (dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new ErrorApi(400, "Los dias van de 1 (lunes) a 7 (domingo)");
  }
}

export function crearAsignacion(ruta, opciones = {}) {
  const zona = opciones.zona || ZONA_DEFECTO;
  const semilla = { ...CONFIG_DEFECTO, ...(opciones.defecto ?? {}) };
  let datos = null;
  /** Ultima ejecucion del reparto automatico (en memoria). */
  let ultimo = null;

  function cargar() {
    if (datos) return datos;
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8"));
      datos = {
        horarios: j && typeof j.horarios === "object" && j.horarios ? j.horarios : {},
        asignaciones:
          j && typeof j.asignaciones === "object" && j.asignaciones ? j.asignaciones : {},
        config: { ...semilla, ...(j && typeof j.config === "object" && j.config ? j.config : {}) },
      };
    } catch {
      datos = { horarios: {}, asignaciones: {}, config: { ...semilla } };
    }
    return datos;
  }

  function guardar() {
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ ...datos, actualizado: new Date().toISOString() }, null, 2),
        "utf8",
      );
      fs.renameSync(tmp, ruta);
    } catch (err) {
      console.warn("[asignacion] no se pudo escribir:", err?.message ?? err);
    }
  }

  function leerConfig() {
    const d = cargar();
    return { ...(d.config ?? { ...semilla }) };
  }

  return {
    /** Estado completo (asignaciones filtradas por tienda si se indica). */
    estado(idEmpresa) {
      const d = cargar();
      const enAhora = ahoraEn(zona);
      const asignaciones = {};
      for (const [pedido, a] of Object.entries(d.asignaciones)) {
        if (idEmpresa === undefined || idEmpresa === null || String(idEmpresa) === "") {
          asignaciones[pedido] = a;
        } else if (String(a?.idEmpresa) === String(idEmpresa)) {
          asignaciones[pedido] = a;
        }
      }
      // quien esta en horario ahora mismo (para pintarlo en el panel)
      const enHorario = {};
      for (const [usuario, h] of Object.entries(d.horarios)) {
        enHorario[usuario] = h?.activo !== false && dentroDeHorario(h, enAhora);
      }
      return {
        horarios: d.horarios,
        asignaciones,
        enHorario,
        ahora: enAhora,
        config: leerConfig(),
        ultimo,
      };
    },

    /** Guarda (o borra con horario=null) el horario de un usuario. */
    ponerHorario(usuario, horario, extra = {}) {
      const d = cargar();
      const u = String(usuario ?? "").trim();
      if (!u) throw new ErrorApi(400, "Falta el usuario");
      if (horario === null || horario === undefined) {
        delete d.horarios[u];
        guardar();
        return { horario: null };
      }
      validarHorario(horario);
      const anterior = d.horarios[u];
      const guardado = {
        nombre: extra.nombre ?? anterior?.nombre ?? "",
        activo: horario.activo !== false,
        dias: Array.isArray(horario.dias) && horario.dias.length ? horario.dias.map(Number) : [1, 2, 3, 4, 5],
        desde: String(horario.desde),
        hasta: String(horario.hasta),
      };
      d.horarios[u] = guardado;
      guardar();
      return { horario: guardado };
    },

    /** ¿Tiene horario configurado? */
    horarioDe(usuario) {
      return cargar().horarios[String(usuario ?? "")] ?? null;
    },

    /**
     * Reparto equitativo.
     *   usuarios: [{usuario, nombre}]  (los que participan)
     *   pedidos:  [id, ...]
     *   modo:     "todos" (cualquier usuario activo) | "horario" (solo los que
     *             esten en turno a esta hora) | "manual" (asignacion explicita:
     *             se respeta aunque el horario este pausado o fuera de turno)
     *   reasignar: si false, los pedidos ya asignados se omiten
     *   ahora:    {dia, minutos} para forzar la hora (pruebas/automatizacion)
     */
    repartir({ usuarios = [], pedidos = [], modo = "todos", reasignar = false, idEmpresa, ahora }) {
      const d = cargar();
      const enAhora =
        ahora && Number.isFinite(Number(ahora.dia)) && Number.isFinite(Number(ahora.minutos))
          ? { dia: Number(ahora.dia), minutos: Number(ahora.minutos), zona }
          : ahoraEn(zona);

      const lista = usuarios
        .map((u) => ({ usuario: String(u?.usuario ?? "").trim(), nombre: u?.nombre ?? "" }))
        .filter((u) => u.usuario);
      if (!lista.length) throw new ErrorApi(400, "Falta la lista de usuarios participantes");
      if (!Array.isArray(pedidos) || pedidos.length === 0) {
        throw new ErrorApi(400, "No hay pedidos para repartir");
      }

      const elegibles = lista.filter((u) => {
        // "manual": asignacion explicita a quien se indique, sin mirar horarios
        if (modo === "manual") return true;
        const h = d.horarios[u.usuario];
        if (h && h.activo === false) return false;
        if (modo === "horario") return Boolean(h) && dentroDeHorario(h, enAhora);
        return true;
      });
      if (!elegibles.length) {
        throw new ErrorApi(
          modo === "horario" ? 409 : 400,
          modo === "horario"
            ? "Ningun usuario esta en horario ahora mismo (revisa dias y horas)"
            : "Ningun usuario participa del reparto",
        );
      }

      // carga actual: lo que ya tienen asignado (para que siga equilibrando)
      const carga = new Map(elegibles.map((u) => [u.usuario, 0]));
      for (const a of Object.values(d.asignaciones)) {
        if (a?.usuario && carga.has(a.usuario)) carga.set(a.usuario, carga.get(a.usuario) + 1);
      }

      const reparto = [];
      const omitidos = [];
      for (const id of pedidos) {
        const clave = String(id);
        const previa = d.asignaciones[clave];
        if (previa && !reasignar) {
          omitidos.push({ pedido: clave, motivo: "ya asignado", usuario: previa.usuario });
          continue;
        }
        let mejor = elegibles[0];
        for (const u of elegibles) {
          const cu = carga.get(u.usuario) ?? 0;
          const cm = carga.get(mejor.usuario) ?? 0;
          const empate =
            cu === cm &&
            String(u.nombre || u.usuario).localeCompare(String(mejor.nombre || mejor.usuario)) < 0;
          if (cu < cm || empate) mejor = u;
        }
        carga.set(mejor.usuario, (carga.get(mejor.usuario) ?? 0) + 1);
        d.asignaciones[clave] = {
          usuario: mejor.usuario,
          nombre: mejor.nombre || mejor.usuario,
          idEmpresa: idEmpresa === undefined || idEmpresa === null ? null : idEmpresa,
          ts: new Date().toISOString(),
        };
        reparto.push({
          pedido: clave,
          usuario: mejor.usuario,
          nombre: mejor.nombre || mejor.usuario,
        });
      }
      guardar();
      const totales = {};
      for (const [usuario, n] of carga) totales[usuario] = n;
      return { reparto, omitidos, totales, ahora: enAhora, modo };
    },

    /** Quita la asignacion de un pedido. */
    desasignar(pedido) {
      const d = cargar();
      const clave = String(pedido);
      const existia = Boolean(d.asignaciones[clave]);
      delete d.asignaciones[clave];
      if (existia) guardar();
      return { existia };
    },

    /** Vaciar todas las asignaciones de una tienda (o de todas). */
    limpiar(idEmpresa) {
      const d = cargar();
      let quitadas = 0;
      for (const [k, v] of Object.entries(d.asignaciones)) {
        if (!idEmpresa || String(v?.idEmpresa) === String(idEmpresa)) {
          delete d.asignaciones[k];
          quitadas += 1;
        }
      }
      if (quitadas) guardar();
      return { quitadas };
    },

    /** Configuracion del reparto automatico (semilla del .env + lo guardado). */
    getConfig() {
      return leerConfig();
    },

    /** Actualiza solo las claves que vengan validadas. */
    setConfig(parcial = {}) {
      const d = cargar();
      const actual = { ...leerConfig() };
      if (typeof parcial.automatico === "boolean") actual.automatico = parcial.automatico;
      if (parcial.cadaSegundos !== undefined && parcial.cadaSegundos !== null) {
        const n = Number(parcial.cadaSegundos);
        if (Number.isFinite(n)) actual.cadaSegundos = Math.max(10, Math.min(n, 3600));
      }
      if (parcial.modo === "todos" || parcial.modo === "horario") actual.modo = parcial.modo;
      if (Array.isArray(parcial.tiendas)) {
        actual.tiendas = parcial.tiendas.map((t) => String(t ?? "").trim()).filter(Boolean);
      }
      if (Array.isArray(parcial.estados)) {
        actual.estados = parcial.estados
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
      }
      if (Array.isArray(parcial.usuarios)) {
        // [] significa "nadie participa" (null = sin restriccion)
        actual.usuarios = parcial.usuarios
          .map((u) => String(u ?? "").trim().toLowerCase())
          .filter(Boolean);
      } else if (parcial.usuarios === null) {
        // volver a "sin restriccion": participan todos los activos
        actual.usuarios = null;
      }
      d.config = actual;
      guardar();
      return { ...actual };
    },

    /** De memoria: que hizo la ultima vuelta del reparto automatico. */
    marcarUltimoReparto(resumen) {
      ultimo = resumen ?? null;
    },

    getUltimo() {
      return ultimo;
    },
  };
}
