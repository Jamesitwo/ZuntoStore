// Productos ganadores: ranking de lo que más se vende en el catálogo de Dropi,
// estimado con las fotos diarias de stock (lo que baja de un día a otro).
import { useEffect, useState } from "react";
import { backend } from "../api/backend";
import { errMsg } from "../api/client";
import { ErrorBanner, PageHeader, Spinner } from "../components/ui";

interface Fila {
  id: number;
  nombre: string;
  proveedor: string;
  categorias: string;
  imagen: string;
  tipo: string;
  desde: string;
  unidades: number;
  diasConVenta: number;
  porDia: number;
  maxDia: number;
  ajustes: number;
  agotado: boolean;
  stock: number;
  precio: number;
  sugerido: number;
  ingreso: number;
  serie: Array<[string, number]>;
}
interface Respuesta {
  ok: boolean;
  fotos: number;
  desde: string | null;
  hasta: string | null;
  total: number;
  unidades?: number;
  faltan?: number;
  productos: Fila[];
  categorias: Array<{ nombre: string; unidades: number; productos: number }>;
}

const miles = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-CO");
const cop = (n: number) => "$" + miles(n);
const diaCorto = (d: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function GanadoresPage() {
  const [dias, setDias] = useState(7);
  const [orden, setOrden] = useState("unidades");
  const [minDias, setMinDias] = useState(1);
  const [categoria, setCategoria] = useState("");
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState("");
  const [r, setR] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setBuscar(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const params = new URLSearchParams({ dias: String(dias), orden, minDias: String(minDias), categoria, q: buscar, limite: "150" });
    backend<Respuesta>(`/api/catalogo/ganadores?${params}`)
      .then((x) => {
        if (!vivo) return;
        setR(x);
        setError("");
      })
      .catch((e) => vivo && setError(errMsg(e)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [dias, orden, minDias, categoria, buscar]);

  const pares = r ? Math.max(1, r.fotos - 1) : 1;

  return (
    <div className="page ganadores">
      <PageHeader
        title="Productos ganadores"
        subtitle={
          r?.desde && r.fotos >= 2
            ? `Ventas estimadas en Dropi del ${diaCorto(r.desde)} al ${diaCorto(r.hasta!)} (${pares} día${pares === 1 ? "" : "s"} comparados)`
            : "Ventas estimadas en el catálogo de Dropi"
        }
      />
      <p className="muted small">
        Es una estimación: cada noche se guarda el stock de todo el catálogo y lo que baja de un día a otro se cuenta como
        vendido (por todos los dropshippers, no solo tú). Las reposiciones no cuentan, y una caída enorme de un solo día se toma
        como ajuste de inventario del proveedor.
      </p>

      <div className="card ganadores-filtros">
        <label>
          <span className="muted small">Periodo</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={1}>Último día</option>
            <option value={3}>Últimos 3 días</option>
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
          </select>
        </label>
        <label>
          <span className="muted small">Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value)}>
            <option value="unidades">Más unidades vendidas</option>
            <option value="constancia">Vende todos los días</option>
            <option value="ingreso">Más dinero movido</option>
          </select>
        </label>
        <label>
          <span className="muted small">Días con venta (mínimo)</span>
          <select value={minDias} onChange={(e) => setMinDias(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 7].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Cualquiera" : `${n} o más`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted small">Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {categoria && !r?.categorias.some((c) => c.nombre === categoria) ? <option value={categoria}>{categoria}</option> : null}
            {(r?.categorias ?? []).map((c) => (
              <option key={c.nombre} value={c.nombre}>
                {c.nombre} ({miles(c.unidades)} u.)
              </option>
            ))}
          </select>
        </label>
        <label className="ganadores-buscar">
          <span className="muted small">Buscar</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, proveedor o ID" />
        </label>
      </div>

      {error ? <ErrorBanner error={error} /> : null}
      {cargando && !r ? <Spinner /> : null}

      {r && r.fotos < 2 ? (
        <div className="card">
          <p>
            Todavía no hay suficientes fotos del catálogo para comparar ({r.fotos} guardada{r.fotos === 1 ? "" : "s"}). Se
            necesitan al menos dos noches. Revisa en Ajustes → Subida a Dropi que la revisión nocturna esté activa.
          </p>
        </div>
      ) : null}

      {r && r.fotos >= 2 ? (
        <>
          <p className="muted small">
            {miles(r.total)} productos con ventas · {miles(r.unidades ?? 0)} unidades en total
            {r.total > r.productos.length ? ` · se muestran los primeros ${r.productos.length}` : ""}
            {cargando ? " · actualizando…" : ""}
          </p>
          <div className="ganadores-lista">
            {r.productos.map((p, i) => (
              <article key={p.id} className="card ganador">
                <div className="ganador-puesto">{i + 1}</div>
                {p.imagen ? <img src={p.imagen} alt="" loading="lazy" className="ganador-img" /> : <div className="ganador-img" />}
                <div className="ganador-info">
                  <a href={`https://app.dropi.co/dashboard/product-details/${p.id}`} target="_blank" rel="noreferrer" className="ganador-nombre">
                    {p.nombre}
                  </a>
                  <div className="muted small">
                    ID {p.id} · {p.proveedor || "proveedor sin nombre"}
                    {p.categorias ? ` · ${p.categorias}` : ""}
                  </div>
                  <div className="small">
                    Proveedor {cop(p.precio)} · sugerido {cop(p.sugerido)} · stock {miles(p.stock)}
                    {p.agotado ? " · se agotó" : ""}
                  </div>
                  <Barras serie={p.serie} />
                </div>
                <div className="ganador-numeros">
                  <strong>{miles(p.unidades)}</strong>
                  <span className="muted small">unidades</span>
                  <span className="small">
                    {p.porDia}/día · {p.diasConVenta} de {pares} días
                  </span>
                  <span className="muted small">{cop(p.ingreso)} movidos</span>
                  {p.ajustes ? <span className="muted small">{p.ajustes} ajuste(s) ignorado(s)</span> : null}
                </div>
              </article>
            ))}
            {!r.productos.length ? <p className="muted">Nada con esos filtros.</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Mini gráfico: unidades por día. */
function Barras({ serie }: { serie: Array<[string, number]> }) {
  if (!serie.length) return null;
  const max = Math.max(...serie.map((x) => x[1]), 1);
  return (
    <div className="ganador-barras" title={serie.map(([d, n]) => `${diaCorto(d)}: ${n}`).join(" · ")}>
      {serie.map(([d, n]) => (
        <span key={d} style={{ height: `${Math.max(8, (n / max) * 100)}%` }} />
      ))}
    </div>
  );
}
