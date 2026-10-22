// Reparto automatico de pedidos (round robin).
//
// Mira cada N segundos los pedidos recientes de las tiendas configuradas y se
// los reparte entre los usuarios activos, con la misma regla equitativa que el
// reparto manual (el que MENOS pedidos tiene). Se enciende y se apaga desde el
// panel (PUT /api/asignacion/config) y la configuracion vive en el mismo JSON
// que los horarios: si esta apagado no hace absolutamente nada.
//
// Un fallo (de LucidSales, de configuracion o de red) nunca rompe el
// intervalo: se queda registrado en `ultimo` y se reintenta en la siguiente.
import { ErrorApi } from "./errores.js";

export function crearRepartoAutomatico({ asignacion, cliente, config, log = console }) {
  let timer = null;
  let corriendo = false;
  /** Para no repetir el mismo aviso de error cada 60 segundos. */
  let ultimoAviso = null;

  /**
   * Una vuelta del reparto. `ahora` ({dia, minutos}) fuerza la hora y
   * `forzar:true` la ejecuta aunque el reparto este apagado (botón «Probar»).
   */
  async function tick(ahora, opciones = {}) {
    const c = asignacion.getConfig();
    if (!c.automatico && !opciones.forzar) return { ok: true, saltado: "desactivado" };
    if (corriendo) return { ok: true, saltado: "en curso" };
    corriendo = true;
    try {
      const tiendas = (
        Array.isArray(c.tiendas) && c.tiendas.length ? c.tiendas : [config.LUCID_TIENDA]
      )
        .map((t) => String(t ?? "").trim())
        .filter(Boolean);
      if (!tiendas.length) {
        throw new ErrorApi(
          400,
          "No hay tienda que revisar: configura LUCID_TIENDA o marca una tienda en el panel",
        );
      }

      const usuarios =
        (await cliente.listarUsuarios({ page: 1, itemsPerPage: 100 })).usuarios ?? [];
      const activos = usuarios.filter(
        (u) => u?.Usuario && u.activo !== false && u.activo !== 0 && u.activo !== "0",
      );

      // Quienes participan: la lista guardada (los de fuera quedan fuera);
      // sin lista (null) participan todos los activos.
      const dentro = Array.isArray(c.usuarios)
        ? activos.filter((u) =>
            c.usuarios.includes(String(u.Usuario).trim().toLowerCase()),
          )
        : activos;
      if (!dentro.length) {
        throw new ErrorApi(
          400,
          Array.isArray(c.usuarios) && c.usuarios.length === 0
            ? "Ningun usuario participa: la lista de participantes esta vacia"
            : "No hay usuarios activos entre los que repartir",
        );
      }

      const estados = (Array.isArray(c.estados) ? c.estados : [])
        .map(Number)
        .filter((n) => Number.isInteger(n));

      let repartidos = 0;
      let omitidos = 0;
      const porTienda = {};

      for (const idEmpresa of tiendas) {
        const estado = asignacion.estado(idEmpresa);
        const rPedidos = await cliente.listarPedidos({
          idEmpresa,
          page: 1,
          itemsPerPage: 100,
          filtros: [{ name: "date", searchValues: [], sortOrder: "desc" }],
        });
        const pedidos = Array.isArray(rPedidos?.pedidos) ? rPedidos.pedidos : [];

        const candidatos = pedidos
          .filter((p) => {
            const id = String(p?.id ?? p?.idPedido ?? "");
            if (!id || estado.asignaciones[id]) return false; // ya tiene dueno
            if (estados.length) return estados.includes(Number(p?.EstadoPedido));
            return true;
          })
          .map((p) => p?.id ?? p?.idPedido)
          .filter((v) => v !== undefined && v !== null);
        if (!candidatos.length) continue;

        const r = asignacion.repartir({
          usuarios: dentro.map((u) => ({
            usuario: String(u.Usuario).toLowerCase(),
            nombre: u.Nombre || u.Usuario,
          })),
          pedidos: candidatos,
          modo: c.modo === "horario" ? "horario" : "todos",
          reasignar: false,
          idEmpresa,
          ahora,
        });
        repartidos += r.reparto.length;
        omitidos += r.omitidos.length;
        porTienda[String(idEmpresa)] = r.reparto.length;
      }

      const resumen = {
        ok: true,
        ts: new Date().toISOString(),
        repartidos,
        omitidos,
        porTienda,
      };
      asignacion.marcarUltimoReparto(resumen);
      ultimoAviso = null;
      if (repartidos) log.log(`[reparto] ${repartidos} pedido(s) repartidos`);
      return resumen;
    } catch (err) {
      const resumen = {
        ok: false,
        ts: new Date().toISOString(),
        msg: err?.message ?? String(err),
      };
      asignacion.marcarUltimoReparto(resumen);
      // solo avisa si el fallo es distinto al anterior (no spamear cada vuelta)
      if (resumen.msg !== ultimoAviso) {
        log.warn("[reparto]", resumen.msg);
        ultimoAviso = resumen.msg;
      }
      return resumen;
    } finally {
      corriendo = false;
    }
  }

  return {
    tick,

    /** Arranca el intervalo; relee la configuracion en cada vuelta. */
    arrancar() {
      if (timer) return;
      const encender = () => {
        if (timer) clearInterval(timer);
        const cada = Math.max(10, Number(asignacion.getConfig().cadaSegundos) || 60);
        timer = setInterval(() => {
          void tick();
          encender(); // por si el panel cambio el intervalo
        }, cada * 1000);
        timer.unref?.();
      };
      encender();
    },

    detener() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    /** Para las pruebas: si hay un tick en curso. */
    ocupado() {
      return corriendo;
    },
  };
}
