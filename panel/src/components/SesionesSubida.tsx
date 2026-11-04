// Resumen de cada sesion de subida a Dropi (una ronda a hora fija o una
// vuelta del intervalo): cuantos pedidos subio, cuantos no y por que.
import { useState } from "react";

export interface SesionSubida {
  clave: string;
  desde: string;
  hasta: string;
  vueltas: number;
  dryRun: boolean;
  subidos: number;
  noSubidos: number;
  motivos: Array<{ motivo: string; n: number }>;
  pedidos: Record<string, string>;
  detenido?: string;
}

const fecha = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const hora = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });

function cuando(s: SesionSubida) {
  try {
    const a = new Date(s.desde);
    const b = s.hasta ? new Date(s.hasta) : null;
    return `${fecha.format(a)}${b && b.getTime() - a.getTime() > 60000 ? ` – ${hora.format(b)}` : ""}`;
  } catch {
    return s.desde;
  }
}

function Sesion({ s, abierta }: { s: SesionSubida; abierta: boolean }) {
  const [verPedidos, setVerPedidos] = useState<string | null>(null);
  const total = s.subidos + s.noSubidos;
  const pct = total ? Math.round((s.subidos / total) * 100) : 0;
  const deMotivo = (m: string) => Object.entries(s.pedidos ?? {}).filter(([, x]) => x === m).map(([id]) => id);
  return (
    <details className="sesion-subida" open={abierta}>
      <summary>
        <span className="sesion-cuando">{cuando(s)}</span>
        <span className="sesion-cifras">
          <span className="sesion-ok">
            {s.subidos} {s.dryRun ? "preparados" : "subidos"}
          </span>
          <span className="sesion-no">{s.noSubidos} no</span>
          <span className="muted small">de {total}</span>
        </span>
      </summary>
      <div className="sesion-barra" title={`${pct}% ${s.dryRun ? "preparados" : "subidos"}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {s.detenido ? <p className="small banner warn">Se detuvo: {s.detenido}</p> : null}
      {s.motivos.length ? (
        <ul className="sesion-motivos">
          {s.motivos.map((m) => (
            <li key={m.motivo}>
              <button
                type="button"
                className="sesion-motivo"
                onClick={() => setVerPedidos((v) => (v === m.motivo ? null : m.motivo))}
                title="Ver los pedidos"
              >
                <strong>{m.n}</strong>
                <span>{m.motivo}</span>
              </button>
              {verPedidos === m.motivo ? (
                <div className="sesion-pedidos small muted">
                  {deMotivo(m.motivo)
                    .map((id) => `#${id}`)
                    .join(" · ")}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Todos los pedidos de esta sesión se subieron.</p>
      )}
      {s.vueltas > 1 ? <p className="small muted">{s.vueltas} vueltas en esta sesión.</p> : null}
    </details>
  );
}

export function SesionesSubida({ sesiones }: { sesiones?: SesionSubida[] }) {
  const [todas, setTodas] = useState(false);
  const lista = Array.isArray(sesiones) ? sesiones : [];
  if (!lista.length) return null;
  const visibles = todas ? lista : lista.slice(0, 5);
  return (
    <div className="card sesiones-subida">
      <div className="card-title">Sesiones de subida</div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Cuántos pedidos subió cada sesión y por qué no subió los demás. Toca un motivo para ver sus pedidos.
      </p>
      {visibles.map((s, i) => (
        <Sesion key={s.clave} s={s} abierta={i === 0} />
      ))}
      {lista.length > 5 ? (
        <button type="button" className="btn sm" onClick={() => setTodas((x) => !x)}>
          {todas ? "Ver menos" : `Ver las ${lista.length} sesiones`}
        </button>
      ) : null}
    </div>
  );
}
