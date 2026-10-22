// Efectividad de entrega: de cada compra que cuenta Meta, que parte termina
// ENTREGADA. La ganancia que se carga es por pedido entregado, asi que sin
// este factor cada compra parece dejar mas plata de la que deja.
import { useState } from "react";
import type { Entrega } from "../../api/anuncios";
import { pct } from "../../api/anuncios";

export function Efectividad({ entrega, onGuardar }: {
  entrega: Entrega;
  onGuardar: (v: { modo?: "auto" | "manual"; tasa?: number; contarSinEnvio?: boolean }) => Promise<void>;
}) {
  const [manual, setManual] = useState(
    entrega.manual ? String(Math.round(entrega.manual * 100)) : "",
  );
  const [guardando, setGuardando] = useState(false);
  const cerrados = entrega.entregados + entrega.fallidos;

  const guardar = async (v: Parameters<typeof onGuardar>[0]) => {
    setGuardando(true);
    try {
      await onGuardar(v);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="card ads-efectividad">
      <div className="ads-efectividad-cab">
        <div>
          <h3 className="card-title">Efectividad de entrega: {pct(entrega.tasa)}</h3>
          <p className="muted small">
            La ganancia de cada producto es por pedido <strong>entregado</strong>. Como no todas las
            compras que cuenta Meta se entregan (cancelaciones, devoluciones, rechazos), cada
            compra deja en promedio la ganancia × este porcentaje.
          </p>
        </div>
      </div>

      {cerrados > 0 ? (
        <p className="small">
          De <strong>{cerrados.toLocaleString("es-CO")}</strong> pedidos ya cerrados se entregaron{" "}
          <strong>{entrega.entregados.toLocaleString("es-CO")}</strong> (
          {pct(entrega.tasaSinContarSinEnvio)}). Otros {entrega.enCamino.toLocaleString("es-CO")}{" "}
          siguen en camino y no cuentan todavía.
          {entrega.sinEnvio > 0 ? (
            <>
              {" "}
              Además hay <strong>{entrega.sinEnvio.toLocaleString("es-CO")}</strong> pedidos que
              nunca se enviaron (sin confirmar o cancelados antes de la guía): si los cuentas como
              no entregados, la efectividad baja a {pct(entrega.tasaContandoSinEnvio)}.
            </>
          ) : null}
        </p>
      ) : (
        <p className="small ads-malo">
          Todavía no hay datos de entregas: se supone que se entrega el 100%. Usa «Traer ganancias
          de pedidos» o fíjala a mano.
        </p>
      )}

      <div className="ads-efectividad-opciones">
        <label className="ads-switch">
          <input
            type="radio"
            name="modo-entrega"
            checked={entrega.modo === "auto"}
            disabled={guardando}
            onChange={() => void guardar({ modo: "auto" })}
          />
          Calcularla de mis pedidos
        </label>
        {entrega.modo === "auto" && entrega.sinEnvio > 0 ? (
          <label className="ads-switch">
            <input
              type="checkbox"
              checked={entrega.contarSinEnvio}
              disabled={guardando}
              onChange={(e) => void guardar({ contarSinEnvio: e.target.checked })}
            />
            Contar los que nunca se enviaron como no entregados
          </label>
        ) : null}
        <span className="ads-efectividad-manual">
          <label className="ads-switch">
            <input
              type="radio"
              name="modo-entrega"
              checked={entrega.modo === "manual"}
              disabled={guardando}
              onChange={() => {
                if (Number(manual) > 0) void guardar({ modo: "manual", tasa: Number(manual) });
                else setManual(String(Math.round(entrega.tasa * 100)));
              }}
            />
            Fijarla a mano
          </label>
          <input
            className="field"
            type="number"
            min={1}
            max={100}
            value={manual}
            placeholder="%"
            onChange={(e) => setManual(e.target.value)}
            aria-label="Efectividad de entrega en porcentaje"
          />
          <span className="muted small">%</span>
          <button
            type="button"
            className="btn sm"
            disabled={guardando || !(Number(manual) > 0 && Number(manual) <= 100)}
            onClick={() => void guardar({ modo: "manual", tasa: Number(manual) })}
          >
            Usar
          </button>
        </span>
      </div>
    </section>
  );
}
