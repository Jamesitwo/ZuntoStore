// Linea de tiempo del envio: cada cambio de estado que mando Lucid Bot, con
// su fecha, para ver que dia se movio el pedido.
import { useEffect, useState } from "react";
import { backend } from "../api/backend";
import { fmtFecha, haceCuanto } from "../lib/format";
import { EnvioBadge } from "./ui";

interface Evento {
  ts: string;
  estado: string;
  transportadora?: string;
  guia?: string;
  novedad?: string;
  repeticiones?: number;
}

interface Pedido {
  id?: number | string;
  idPedido?: number | string;
  Movil?: string;
  Fecha?: string;
  CreatedAt?: string;
}

/** Dias entre dos fechas, en palabras cortas ("2 días después"). */
function despues(a: string, b: string) {
  const dias = Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
  if (!Number.isFinite(dias) || dias < 0) return "";
  if (dias === 0) return "el mismo día";
  return dias === 1 ? "1 día después" : `${dias} días después`;
}

export function LineaTiempoEnvio({ pedido }: { pedido: Pedido | null }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const clave = String(pedido?.id ?? pedido?.idPedido ?? "");

  useEffect(() => {
    if (!clave || !pedido) return;
    let cancel = false;
    backend<{ ok: boolean; eventos?: Evento[] }>("/api/envios/historial", {
      method: "POST",
      body: {
        id: pedido.id,
        idPedido: pedido.idPedido,
        telefono: pedido.Movil ?? "",
        fecha: pedido.Fecha ?? pedido.CreatedAt ?? "",
      },
    })
      .then((r) => {
        if (!cancel) setEventos(r?.eventos ?? []);
      })
      .catch(() => {
        if (!cancel) setEventos([]);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  if (!eventos?.length) return null;
  const ultimo = eventos[eventos.length - 1];
  const guia = [...eventos].reverse().find((e) => e.guia)?.guia;
  const transp = [...eventos].reverse().find((e) => e.transportadora)?.transportadora;

  return (
    <div className="envio-timeline">
      <div className="card-title" style={{ marginTop: 8 }}>
        Seguimiento del envío <span className="muted small">· desde Lucid Bot</span>
      </div>
      {guia || transp ? (
        <p className="muted small" style={{ margin: "0 0 8px" }}>
          {transp ? <strong>{transp}</strong> : null}
          {transp && guia ? " · " : ""}
          {guia ? `Guía ${guia}` : ""}
        </p>
      ) : null}
      <ol className="timeline">
        {[...eventos].reverse().map((e, i, arr) => {
          const anterior = arr[i + 1];
          return (
            <li key={`${e.ts}-${i}`} className={e === ultimo ? "actual" : ""}>
              <span className="timeline-punto" aria-hidden="true" />
              <div className="timeline-cuerpo">
                <div className="timeline-linea">
                  <EnvioBadge value={e.estado} />
                  <span className="small" title={fmtFecha(e.ts)}>
                    {fmtFecha(e.ts)}
                  </span>
                </div>
                <div className="muted small">
                  {e === ultimo ? haceCuanto(e.ts) : ""}
                  {anterior ? `${e === ultimo ? " · " : ""}${despues(anterior.ts, e.ts)} del anterior` : ""}
                  {e.repeticiones && e.repeticiones > 1 ? ` · avisado ${e.repeticiones} veces` : ""}
                </div>
                {e.novedad ? <div className="small">Novedad: {e.novedad}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
