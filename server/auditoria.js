// Registro de cambios de configuracion de una cuenta: quien cambio que y
// cuando. Solo se anota QUE se cambio (la ruta), nunca los valores (pueden ser
// claves). JSONL; se leen los ultimos.
import fs from "node:fs";
import path from "node:path";

/** Cambios que se anotan (metodo + ruta) y como se leen en el panel. */
export const CAMBIOS = [
  [/^PUT \/api\/subida\/config$/, "Cambió la configuración de la subida a Dropi"],
  [/^POST \/api\/subida\/reintentar$/, "Pidió reintentar un pedido en la subida automática"],
  [/^POST \/api\/subida\/pedido\/[^/]+\/aprobar-duplicado$/, "Confirmó que un pedido marcado como repetido es una compra nueva"],
  [/^POST \/api\/dropi\/sesion$/, "Cargó una sesión de Dropi"],
  [/^PUT \/api\/dropi\/productos$/, "Cambió el Google Sheets de productos"],
  [/^PUT \/api\/credenciales$/, "Guardó el usuario de LucidSales del servidor"],
  [/^DELETE \/api\/credenciales$/, "Borró el usuario de LucidSales del servidor"],
  [/^PUT \/api\/llm\/config$/, "Cambió la configuración de la IA"],
  [/^DELETE \/api\/llm\/config$/, "Borró la clave de la IA"],
  [/^PUT \/api\/mapas\/config$/, "Guardó la clave de Google Maps"],
  [/^DELETE \/api\/mapas\/config$/, "Borró la clave de Google Maps"],
  [/^PUT \/api\/lucidbot\/config$/, "Cambió la configuración de Lucid Bot"],
  [/^POST \/api\/apikey\/generar$/, "Generó una clave de API nueva"],
  [/^DELETE \/api\/apikey$/, "Revocó la clave de API"],
  [/^PUT \/api\/asignacion\/config$/, "Cambió el reparto automático"],
  [/^POST \/api\/pedidos\/[^/]+\/subir$/, "Subió un pedido a Dropi a mano"],
  [/^POST \/api\/pedidos\/[^/]+\/direccion$/, "Corrigió la dirección de un pedido"],
];

export function queCambio(metodo, ruta) {
  const k = `${metodo} ${ruta}`;
  for (const [re, texto] of CAMBIOS) if (re.test(k)) return texto;
  return null;
}

export function crearAuditoria({ ruta = null, log = console } = {}) {
  const memoria = [];
  return {
    anotar({ usuario, metodo, ruta: rutaApi, estado }) {
      const texto = queCambio(metodo, rutaApi);
      if (!texto) return null;
      const e = {
        ts: new Date().toISOString(),
        usuario: usuario ?? "integración",
        accion: texto,
        ruta: `${metodo} ${rutaApi}`,
        ok: estado < 400,
      };
      if (!ruta) {
        memoria.push(e);
        return e;
      }
      try {
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        fs.appendFileSync(ruta, `${JSON.stringify(e)}\n`, "utf8");
      } catch (err) {
        log.warn?.("[auditoria] no se pudo anotar:", err?.message ?? err);
      }
      return e;
    },
    /** Los ultimos n cambios, del mas nuevo al mas viejo. */
    ultimos(n = 100) {
      let lista = memoria;
      if (ruta) {
        try {
          lista = fs
            .readFileSync(ruta, "utf8")
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-Math.max(1, Math.min(Number(n) || 100, 500)))
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        } catch {
          lista = [];
        }
      }
      return lista.slice(-n).reverse();
    },
  };
}
