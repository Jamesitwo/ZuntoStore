// Analisis de la IA de un pedido (lo guarda la subida automatica): cada
// verificacion del sistema con la cita del chat en la que se apoyo la IA, y
// lo que la IA leyo. Se usa en la tabla de la subida y en el detalle del pedido.

export const NOMBRES_CHEQUEO: Record<string, string> = {
  productos: "Líneas del pedido",
  producto: "Producto",
  cantidad: "Cantidad",
  precio: "Precio",
  direccion: "Dirección (chat vs pedido)",
  direccionValida: "Dirección válida (Colombia)",
  direccionMapa: "Dirección en el mapa",
  confirmacion: "Confirmó",
  entregaFutura: "Entrega futura",
};

/** Lo que la IA leyó del chat y cada verificación del código, con su cita. */
export function AnalisisPedido({ analisis, abierto = false }: { analisis: any; abierto?: boolean }) {
  const checks: any[] = Array.isArray(analisis?.checks) ? analisis.checks : [];
  const e = analisis?.extraido ?? {};
  const v = (x: unknown) => (x === true ? "sí" : x === false ? "no" : x === null || x === undefined || x === "" ? "—" : String(x));
  return (
    <details className="analisis-pedido" open={abierto}>
      <summary>Ver análisis</summary>
      <ul className="analisis-lista">
        {checks.map((c) => (
          <li key={c.campo}>
            <span className={`badge${c.ok ? " ok" : " danger"}`}>{c.ok ? "✓" : "✕"}</span>{" "}
            <strong>{NOMBRES_CHEQUEO[c.campo] ?? c.campo}:</strong> {c.detalle}
            {c.evidencia ? <div className="evidencia-chat">«{c.evidencia}»</div> : null}
          </li>
        ))}
      </ul>
      <p className="muted small">
        La IA leyó: producto {v(e.producto)} · cantidad {v(e.cantidad)} · precio {v(e.precioAcordado)} ·
        dirección {v(e.direccion)} · confirmó {v(e.clienteConfirmo)} · entrega futura {v(e.entregaFutura)}
        {e.fechaEntregaSolicitada ? ` (${e.fechaEntregaSolicitada})` : ""}
      </p>
      {Array.isArray(e.incertidumbre) && e.incertidumbre.length ? (
        <p className="muted small">Incógnitas: {e.incertidumbre.join(" · ")}</p>
      ) : null}
    </details>
  );
}
