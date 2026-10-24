// Lo que le falta a esta cuenta para subir pedidos sola: una lista de pasos
// con su estado y dónde se configura cada uno. Arriba de Ajustes.
import { useEffect, useState } from "react";
import { backendSuave } from "../api/backend";

interface Paso {
  id: string;
  titulo: string;
  ok: boolean;
  opcional?: boolean;
  detalle: string;
  donde: string;
}

export function ChecklistCuenta() {
  const [datos, setDatos] = useState<{ listos: number; total: number; pasos: Paso[] } | null>(null);
  const [cuenta, setCuenta] = useState<string | null>(null);

  useEffect(() => {
    void backendSuave<any>("/api/configuracion/estado").then((r) => {
      if (r?.ok) setDatos(r);
    });
    void backendSuave<any>("/api/cuenta").then((r) => {
      if (r?.ok && r.cuenta) setCuenta(r.cuenta.nombre);
    });
  }, []);

  if (!datos) return null;
  const completo = datos.listos === datos.total;
  return (
    <details className="card checklist-cuenta" open={!completo}>
      <summary className="row between wrap" style={{ cursor: "pointer" }}>
        <span className="card-title" style={{ marginBottom: 0 }}>
          Configuración {cuenta ? `de ${cuenta}` : "de tu cuenta"}
        </span>
        <span className={`chip${completo ? " ok" : " alerta"}`}>
          {completo ? "Todo listo" : `${datos.listos} de ${datos.total} pasos listos`}
        </span>
      </summary>
      <ol className="checklist-pasos">
        {datos.pasos.map((p) => (
          <li key={p.id} className={p.ok ? "ok" : p.opcional ? "opcional" : "falta"}>
            <span className="checklist-marca" aria-hidden="true">
              {p.ok ? "✓" : p.opcional ? "○" : "!"}
            </span>
            <div>
              <strong>{p.titulo}</strong>
              {p.opcional ? <span className="muted small"> · opcional</span> : null}
              <div className="small">{p.detalle}</div>
              {!p.ok ? <div className="muted small">Dónde: {p.donde}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
