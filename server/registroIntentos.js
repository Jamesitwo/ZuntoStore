// Historial de intentos de subida a Dropi, por pedido: cada vez que la subida
// automatica o una persona (subida manual) intenta subir un pedido queda aqui
// el resultado, el razonamiento de la IA, la validacion de la direccion, la
// oficina detectada y la transportadora. Es para TRANSPARENCIA: el panel lo
// muestra en el detalle del pedido.
//
// Archivo JSONL (una linea por intento). Si la misma vuelta vuelve a marcar el
// pedido (p. ej. "subido" antes y despues de actualizar LucidSales) se
// actualiza ese intento; si un intento nuevo da exactamente el mismo
// resultado que el anterior (un pedido frenado que se revisa cada vuelta), se
// cuenta como repeticion en vez de llenar la lista.
import fs from "node:fs";
import path from "node:path";

const MAX_POR_PEDIDO = 30;
const MAX_LINEAS = 30000;

export function crearRegistroIntentos({ ruta = null, log = console } = {}) {
  /** id de pedido -> [intentos, del mas viejo al mas nuevo] */
  const porPedido = new Map();

  function agregar(it) {
    const id = String(it.pedido);
    const lista = porPedido.get(id) ?? [];
    const i = lista.findIndex((x) => x.clave === it.clave);
    if (i >= 0) lista[i] = it;
    else lista.push(it);
    if (lista.length > MAX_POR_PEDIDO) lista.splice(0, lista.length - MAX_POR_PEDIDO);
    porPedido.set(id, lista);
  }

  if (ruta) {
    try {
      const lineas = fs.readFileSync(ruta, "utf8").split(/\r?\n/).filter(Boolean);
      for (const l of lineas) {
        try {
          agregar(JSON.parse(l));
        } catch {
          /* linea rota */
        }
      }
      // se compacta al arrancar: solo lo vigente de cada pedido
      if (lineas.length > MAX_LINEAS) {
        const todo = [...porPedido.values()].flat().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        const quedan = todo.slice(-Math.floor(MAX_LINEAS / 2));
        porPedido.clear();
        quedan.forEach(agregar);
        fs.writeFileSync(ruta, quedan.map((x) => JSON.stringify(x)).join("\n") + "\n");
      }
    } catch {
      /* primera vez */
    }
  }

  function volcar(it) {
    if (!ruta) return;
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      fs.appendFileSync(ruta, `${JSON.stringify(it)}\n`, "utf8");
    } catch (e) {
      log.warn?.("[intentos] no se pudo guardar:", e?.message ?? e);
    }
  }

  return {
    /**
     * Guarda (o actualiza) un intento.
     * it: { pedido, clave, origen, usuario?, accion, detalle, analisis?, direccion?, oficina?, envio?, dropi?, dryRun? }
     */
    registrar(it) {
      if (!it?.pedido) return null;
      const ahora = new Date().toISOString();
      const id = String(it.pedido);
      const lista = porPedido.get(id) ?? [];
      const mismaVuelta = lista.find((x) => x.clave === it.clave);
      const ultimo = lista.at(-1);
      let nuevo;
      if (mismaVuelta) {
        nuevo = { ...mismaVuelta, ...it, ts: mismaVuelta.ts, actualizado: ahora };
      } else if (ultimo && ultimo.accion === it.accion && ultimo.detalle === it.detalle && ultimo.origen === it.origen) {
        // mismo resultado que el anterior: se cuenta, no se repite
        nuevo = { ...ultimo, ...it, clave: ultimo.clave, ts: ultimo.ts, actualizado: ahora, repeticiones: (ultimo.repeticiones ?? 1) + 1 };
      } else {
        nuevo = { ...it, ts: ahora };
      }
      agregar(nuevo);
      volcar(nuevo);
      return nuevo;
    },

    /** Intentos de un pedido, del mas nuevo al mas viejo. */
    dePedido(id) {
      return [...(porPedido.get(String(id)) ?? [])].reverse();
    },
  };
}
