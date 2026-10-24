// Quién cambió qué en la configuración de esta cuenta (sin valores).
import { useEffect, useState } from "react";
import { backendSuave } from "../api/backend";
import { fmtFecha } from "../lib/format";

interface Cambio {
  ts: string;
  usuario: string;
  accion: string;
  ok: boolean;
}

export function RegistroCambios() {
  const [cambios, setCambios] = useState<Cambio[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto || cambios) return;
    void backendSuave<{ ok: boolean; cambios?: Cambio[] }>("/api/auditoria?n=100").then((r) => {
      setCambios(r?.ok ? r.cambios ?? [] : []);
    });
  }, [abierto, cambios]);

  return (
    <details className="card" onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}>
      <summary className="card-title" style={{ cursor: "pointer", marginBottom: 0 }}>
        Registro de cambios
      </summary>
      <p className="muted small">
        Quién cambió la configuración de esta cuenta y cuándo. Solo se anota qué se cambió, nunca las claves.
      </p>
      {cambios === null ? (
        <p className="muted small">Cargando…</p>
      ) : !cambios.length ? (
        <p className="muted small">Todavía no hay cambios anotados.</p>
      ) : (
        <div className="table-wrap">
          <table className="table tabla-compacta">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Quién</th>
                <th>Qué</th>
              </tr>
            </thead>
            <tbody>
              {cambios.map((c, i) => (
                <tr key={`${c.ts}-${i}`}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtFecha(c.ts)}</td>
                  <td className="small">{c.usuario}</td>
                  <td className="small">
                    {c.accion}
                    {c.ok ? "" : <span className="muted"> (no se aplicó)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
