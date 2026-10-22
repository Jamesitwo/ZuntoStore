// Registro de cambios de estado: archivo JSONL (una linea por evento).
// Sirve para auditar "quien cambio que y cuando"; si no se puede escribir
// solo avisa, nunca rompe el cambio.
import fs from "node:fs";
import path from "node:path";

export function crearHistorial(ruta) {
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  } catch {
    /* ya existe o no hace falta */
  }

  return {
    registrar(entrada) {
      try {
        fs.appendFileSync(ruta, `${JSON.stringify(entrada)}\n`, "utf8");
      } catch (err) {
        console.warn("[historial] no se pudo escribir:", err?.message ?? err);
      }
    },

    /** Ultimas entradas, la mas reciente primero. */
    listar(limite = 50) {
      const n = Math.max(1, Math.min(Number(limite) || 50, 500));
      try {
        const lineas = fs
          .readFileSync(ruta, "utf8")
          .split(/\r?\n/)
          .filter(Boolean);
        return lineas
          .slice(-n)
          .reverse()
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}
