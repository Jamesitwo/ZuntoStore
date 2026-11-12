// Selector "¿para qué tienda es este producto?" (Zunto o la segunda tienda de
// Lucid Bot). Solo aparece si la segunda tienda está configurada.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";

export type TiendaBot = "zunto" | "nueva";

let cache: { nombre: string; lista: boolean } | null = null;

/** Nombre de la segunda tienda ("" si no está configurada). */
export function useSegundaTienda() {
  const [t, setT] = useState(cache);
  useEffect(() => {
    if (cache) return;
    void backendSuave<any>("/api/bots-tienda").then((x) => {
      cache = { nombre: String(x?.nombre ?? "").trim(), lista: Boolean(x?.ok && x?.tokenConfigurado && x?.camposNueva) };
      setT(cache);
    });
  }, []);
  return t?.lista ? t.nombre || "Segunda tienda" : "";
}

/** Asigna el producto recién creado a la tienda elegida (no hace nada para Zunto). */
export async function asignarTiendaBot(producto: string, tienda: TiendaBot) {
  if (tienda !== "nueva") return;
  await backend("/api/bots-tienda/asignar", { method: "POST", body: { producto, tienda } });
}

export function ElegirTiendaBot({ valor, onChange, disabled }: { valor: TiendaBot; onChange: (t: TiendaBot) => void; disabled?: boolean }) {
  const nombre = useSegundaTienda();
  if (!nombre) return null;
  return (
    <div className="elegir-tienda" role="group" aria-label="Tienda del producto">
      <span className="muted small">Tienda:</span>
      <button type="button" className={`btn sm${valor === "zunto" ? " primary" : ""}`} aria-pressed={valor === "zunto"} disabled={disabled} onClick={() => onChange("zunto")}>
        Zunto
      </button>
      <button type="button" className={`btn sm${valor === "nueva" ? " primary" : ""}`} aria-pressed={valor === "nueva"} disabled={disabled} onClick={() => onChange("nueva")}>
        {nombre}
      </button>
    </div>
  );
}
