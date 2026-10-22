// Reporte imprimible: lo que sale al tocar "PDF" (se imprime con el CSS de
// impresion del panel, sin menús ni filtros).
import type { Datos } from "../../api/anuncios";
import { CLASES, ETIQUETAS, dinero, fechaCorta, veces } from "../../api/anuncios";

export function Reporte({ datos }: { datos: Datos }) {
  const t = datos.totales;
  // solo las que estan en alerta real (encendidas y con dias suficientes)
  const alertas = datos.campanas.filter((c) => c.alerta);

  return (
    <article className="ads-reporte">
      <header className="ads-reporte-cab">
        <div>
          <h2>Reporte de rentabilidad de anuncios</h2>
          <p className="muted">
            {datos.cuentas.map((c) => c.nombre).join(" + ") || "Cuentas seleccionadas"} ·{" "}
            {datos.ventana.dias} días ({fechaCorta(datos.ventana.desde)} →{" "}
            {fechaCorta(datos.ventana.hasta)}) · generado {new Date(datos.generado).toLocaleString("es-CO")}
          </p>
        </div>
        <div className="ads-reporte-sello">
          Neto estimado
          <strong className={t.neto < 0 ? "ads-malo" : "ads-bueno"}>{dinero(t.neto)}</strong>
        </div>
      </header>

      <div className="stat-grid ads-kpis">
        <div className="stat-card">
          <span className="stat-label">Gasto</span>
          <span className="stat-value">{dinero(t.gasto)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Compras (Meta)</span>
          <span className="stat-value">{t.compras.toLocaleString("es-CO")}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">CPA</span>
          <span className="stat-value">{dinero(t.cpa)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Margen estimado</span>
          <span className="stat-value">{dinero(t.margen)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">ROI</span>
          <span className="stat-value">{veces(t.roi)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pérdida acumulada</span>
          <span className="stat-value ads-malo">{dinero(t.perdidas)}</span>
        </div>
      </div>

      <h3>Cómo se clasifica</h3>
      <ul className="ads-reporte-lista">
        {CLASES.map((c) => (
          <li key={c}>
            <strong>{ETIQUETAS[c]}:</strong> {datos.conteos[c]} campaña(s)
            {c === "RENTABLE" ? " (ROI ≥ 3x)" : ""}
            {c === "AJUSTADA" ? " (ROI entre 1,5x y 3x)" : ""}
            {c === "RIESGO" ? " (ROI < 1,5x pero el neto sigue positivo)" : ""}
            {c === "PERDIDA" ? " (gasta más de lo que deja)" : ""}
            {c === "SINDATO" ? " (sin ganancia promedio cargada)" : ""}
          </li>
        ))}
      </ul>

      <h3>Campañas con acción pendiente ({alertas.length})</h3>
      <div className="table-wrap">
        <table className="table tabla-anuncios">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Cuenta</th>
              <th>Estado</th>
              <th className="meta-num">Gasto</th>
              <th className="meta-num">Compras</th>
              <th className="meta-num">Neto</th>
              <th className="meta-num">ROI</th>
              <th>Clasificación</th>
              <th className="wrap">Acción sugerida</th>
            </tr>
          </thead>
          <tbody>
            {alertas.map((c) => (
              <tr key={c.id}>
                <td className="wrap">{c.nombre}</td>
                <td>{c.cuenta}</td>
                <td>{c.estado === "ACTIVE" ? "Encendida" : c.estado === "PAUSED" ? "Pausada" : c.estado}</td>
                <td className="meta-num">{dinero(c.gasto)}</td>
                <td className="meta-num">{c.compras}</td>
                <td className={`meta-num${(c.neto ?? 0) < 0 ? " ads-malo" : ""}`}>
                  {c.neto === null ? "—" : dinero(c.neto)}
                </td>
                <td className="meta-num">{veces(c.roi)}</td>
                <td>{ETIQUETAS[c.clase]}</td>
                <td className="wrap">
                  <strong>{c.accion.titulo}</strong> — {c.accion.detalle}
                </td>
              </tr>
            ))}
            {!alertas.length ? (
              <tr>
                <td colSpan={9}>Sin alertas en esta ventana.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Por cuenta</h3>
      <div className="table-wrap">
        <table className="table tabla-anuncios">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th className="meta-num">Campañas</th>
              <th className="meta-num">Gasto</th>
              <th className="meta-num">Compras</th>
              <th className="meta-num">CPA</th>
              <th className="meta-num">Margen</th>
              <th className="meta-num">Neto</th>
              <th className="meta-num">ROI</th>
              <th className="meta-num">En pérdida</th>
            </tr>
          </thead>
          <tbody>
            {datos.cuentas.map((c) => (
              <tr key={c.nombre}>
                <td>
                  {c.nombre} <span className="muted small">({c.moneda})</span>
                </td>
                <td className="meta-num">{c.campanas}</td>
                <td className="meta-num">{dinero(c.gasto)}</td>
                <td className="meta-num">{c.compras}</td>
                <td className="meta-num">{c.cpa === null ? "—" : dinero(c.cpa)}</td>
                <td className="meta-num">{dinero(c.margen)}</td>
                <td className={`meta-num${c.neto < 0 ? " ads-malo" : ""}`}>{dinero(c.neto)}</td>
                <td className="meta-num">{veces(c.roi)}</td>
                <td className={`meta-num${c.perdidas < 0 ? " ads-malo" : ""}`}>
                  {dinero(c.perdidas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="ads-reporte-pie">
        <p>
          <strong>Método:</strong> margen = compras que atribuye Meta (omni_purchase, sin duplicar)
          × ganancia promedio del producto; neto = margen − gasto; ROI = margen / gasto;
          CPA = gasto / compras. Se ignora el número de pedidos del tablero.
        </p>
        <p>
          Los importes de Pizdo (USD) se convierten a COP con TRM {datos.trm.toLocaleString("es-CO", {
            minimumFractionDigits: 2,
          })}
          {datos.fuente === "snapshot" ? " · datos de respaldo (Meta no respondió)" : ""}.
        </p>
      </footer>
    </article>
  );
}
