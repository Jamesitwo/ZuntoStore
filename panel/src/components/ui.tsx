import type { ReactNode } from "react";
import { ESTADOS_PEDIDO } from "../api/endpoints";

export function EstadoBadge({ value }: { value: number | undefined | null }) {
  if (value === undefined || value === null) return <span className="badge">—</span>;
  const label = ESTADOS_PEDIDO[value] ?? `Estado ${value}`;
  const cls =
    value === 1
      ? "badge danger" // Cancelado / Devuelto
      : value === 7
        ? "badge danger"
        : value === 0 || value === 3 || value === 8
          ? "badge warn" // Por confirmar / Modificado / En Novedad
          : value === 2 || value === 6 || value === 9
            ? "badge ok" // Confirmado / Entregado / Novedad Solucionada
            : "badge"; // 4,5 logistica en curso
  return <span className={cls}>{label}</span>;
}

/**
 * Badge de "Estado del envio": lee `EstadoFullfilment` (asi lo llama la API,
 * con esa grafia) y replica la logica del panel oficial:
 *   gris   -> "Sin Envio" / "CANCELADO" (aun sin logistica)
 *   verde  -> "ENTREGADO" / "Entregada a destino"
 *   rojo   -> "DEVOLUCION" / "Devolucion a origen"
 *   violeta-> cualquier otro estado (Creado, ENVIADO, EN TRANSITO...)
 */
export function EnvioBadge({ value }: { value: unknown }) {
  const texto =
    value === null || value === undefined
      ? ""
      : String(value).trim();
  if (!texto) return <span className="badge">—</span>;
  const n = texto.toLowerCase();
  const cls =
    n === "sin envio" || n === "sin envío" || n === "cancelado"
      ? "badge" // gris
      : n === "entregado" || n === "entregada a destino"
        ? "badge ok"
        : n === "devolucion" || n === "devolución a origen" || n === "devolucion a origen"
          ? "badge danger"
          : "badge envio";
  return <span className={cls}>{texto}</span>;
}

export function money(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value ?? "");
  return n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="banner error">{error}</div>;
}

export function Notice({ text, kind = "info" }: { text: string | null; kind?: "info" | "ok" }) {
  if (!text) return null;
  return <div className={`banner ${kind}`}>{text}</div>;
}

export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Spinner({ label = "Cargando..." }: { label?: string }) {
  return (
    <div className="spinner">
      <span className="dot" /> {label}
    </div>
  );
}

/**
 * Tabla generica para respuestas cuyo shape no esta documentado:
 * toma las columnas de las primeras filas.
 */
export function JsonTable({ rows, maxCols = 12 }: { rows: any[]; maxCols?: number }) {
  if (!rows.length) return <p className="muted">Sin resultados.</p>;

  const cols: string[] = [];
  for (const row of rows.slice(0, 25)) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!cols.includes(key)) cols.push(key);
      }
    }
  }
  const visible = cols.slice(0, maxCols);

  if (typeof rows[0] !== "object" || rows[0] === null) {
    return (
      <ul className="list">
        {rows.map((r, i) => (
          <li key={i}>{String(r)}</li>
        ))}
      </ul>
    );
  }

  const render = (v: unknown): ReactNode => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") {
      const s = JSON.stringify(v);
      return <code>{s.length > 80 ? s.slice(0, 80) + "…" : s}</code>;
    }
    if (typeof v === "boolean") return v ? "si" : "no";
    return String(v);
  };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {visible.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {visible.map((c) => (
                <td key={c}>{render(row?.[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {cols.length > visible.length ? (
        <p className="muted small">
          Columnas ocultas: {cols.slice(visible.length).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/** Visor de respuesta JSON crudo (para endpoints sin documentacion). */
export function JsonView({ data }: { data: unknown }) {
  if (data === undefined || data === null) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return <pre className="json-view">{text}</pre>;
}

/** Etiqueta + control + ayuda, al estilo del resto del panel. */
export function Campo({
  id,
  label,
  ayuda,
  children,
}: {
  id: string;
  label: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {ayuda ? <p className="campo-ayuda">{ayuda}</p> : null}
    </div>
  );
}

/** Check de permiso (nombre oficial del numero, del formulario del panel oficial). */
export function CheckPermiso({
  id,
  numero,
  nombre,
  marcado,
  onChange,
}: {
  id: string;
  numero: string;
  nombre: string;
  marcado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-permiso" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        value={numero}
        checked={marcado}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{nombre}</strong> <span className="muted">({numero})</span>
      </span>
    </label>
  );
}
