// Alertas: las campanas que necesitan una decision hoy, con la accion
// sugerida y la casilla de "hecho" (se guarda en plan.json del servidor).
// Solo entran las que siguen ENCENDIDAS y con dias suficientes para juzgarlas
// (la bandera `alerta` la calcula el servidor): una pausada ya fue decidida y
// una de 1-2 dias todavia no da muestra.
import type { Datos, PlanMap } from "../../api/anuncios";
import { CLASE_CLS, ETIQUETAS, dinero, veces } from "../../api/anuncios";

export function Alertas({ datos, plan, onMarcar }: {
  datos: Datos;
  plan: PlanMap;
  onMarcar: (id: string, hecho: boolean) => void;
}) {
  const filas = datos.campanas
    .filter((c) => c.alerta || plan[c.id])
    .sort((a, b) => {
      const pendiente = Number(!!plan[a.id]?.hecho) - Number(!!plan[b.id]?.hecho);
      if (pendiente !== 0) return pendiente;
      if (a.accion.prioridad !== b.accion.prioridad) return a.accion.prioridad - b.accion.prioridad;
      return (a.neto ?? 0) - (b.neto ?? 0);
    });

  const pendientes = filas.filter((c) => !plan[c.id]?.hecho).length;
  const alarma = (clase: string) => datos.campanas.filter((c) => c.alerta && c.clase === clase).length;
  // fuera de alerta por estar pausadas o por ser demasiado nuevas
  const fueraPausadas = datos.campanas.filter((c) => c.alertaMotivo === "pausada").length;
  const fueraNuevas = datos.campanas.filter((c) => c.alertaMotivo === "nueva").length;
  const fuera = [
    fueraPausadas ? `${fueraPausadas} pausada(s)` : "",
    fueraNuevas ? `${fueraNuevas} de menos de ${datos.minDiasAlerta} días` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (!filas.length) {
    return (
      <div className="banner ok">
        <strong>Sin alertas.</strong> Ninguna campaña encendida quedó en pérdida, con riesgo o sin
        dato en esta ventana.
        {fuera ? <> Fuera de alerta: {fuera}.</> : null}
      </div>
    );
  }

  return (
    <>
      <div className="ads-resumen-alertas">
        <span className="badge danger">{alarma("PERDIDA")} en pérdida</span>
        <span className="badge warn">{alarma("RIESGO")} por vigilar</span>
        <span className="badge">{alarma("SINDATO")} sin dato</span>
        <span className="muted small">
          {pendientes} pendiente(s) de {filas.length}
        </span>
        {fuera ? <span className="muted small">fuera de alerta: {fuera}</span> : null}
      </div>

      <div className="ads-alertas">
        {filas.map((c) => {
          const marcado = !!plan[c.id]?.hecho;
          return (
            <article key={c.id} className={`ads-alerta ${CLASE_CLS[c.clase]}`}>
              <header className="ads-alerta-cab">
                <div className="ads-alerta-titulo">
                  <span className="ads-clase">{ETIQUETAS[c.clase]}</span>
                  <strong title={c.nombre}>{c.nombre}</strong>
                  <span className="muted small">{c.cuenta}</span>
                </div>
                <label className="ads-hecho">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={(e) => onMarcar(c.id, e.target.checked)}
                  />
                  Hecho
                </label>
              </header>

              <p className="ads-alerta-accion">
                <strong>{c.accion.titulo}</strong>
              </p>
              <p className="muted small ads-alerta-detalle">{c.accion.detalle}</p>

              <div className="ads-alerta-numeros">
                <span>Gasto <strong>{dinero(c.gasto)}</strong></span>
                <span>Compras <strong>{c.compras}</strong></span>
                <span>CPA <strong>{c.cpa === null ? "—" : dinero(c.cpa)}</strong></span>
                <span>Margen <strong>{c.margen === null ? "sin dato" : dinero(c.margen)}</strong></span>
                <span className={c.neto !== null && c.neto < 0 ? "ads-malo" : ""}>
                  Neto <strong>{c.neto === null ? "—" : dinero(c.neto)}</strong>
                </span>
                <span>ROI <strong>{veces(c.roi)}</strong></span>
              </div>

              {c.creada ? (
                <p className="muted small">
                  Creada {c.creada} · {c.diasActivos} días ({c.diasMedidos} medidos) ·{" "}
                  {c.activa ? "encendida" : "pausada"}
                  {c.compartida ? " · compartida entre varios productos" : ""}
                </p>
              ) : null}

              {plan[c.id]?.nota ? (
                <p className="ads-alerta-nota">Nota: {plan[c.id].nota}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
