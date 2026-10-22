// Tabla completa de campanas con filtros, busqueda y orden por columna.
import { useMemo, useState } from "react";
import type { Clase, Datos, PlanMap } from "../../api/anuncios";
import { CLASES, CLASE_CLS, ETIQUETAS, dinero, fechaCorta, veces } from "../../api/anuncios";
import { VinculoCampana } from "./VinculoCampana";

type Campo = "nombre" | "creada" | "gasto" | "compras" | "cpa" | "margen" | "neto" | "roi";

const CABECERAS: Array<{ campo: Campo; label: string; num?: boolean }> = [
  { campo: "nombre", label: "Campaña" },
  { campo: "creada", label: "Creada" },
  { campo: "gasto", label: "Gasto", num: true },
  { campo: "compras", label: "Compras", num: true },
  { campo: "cpa", label: "CPA", num: true },
  { campo: "margen", label: "Margen", num: true },
  { campo: "neto", label: "Neto", num: true },
  { campo: "roi", label: "ROI", num: true },
];

function valor(c: { [k in Campo]: unknown }, campo: Campo): number | string {
  const v = c[campo];
  if (v === null || v === undefined) return campo === "nombre" || campo === "creada" ? "" : -Infinity;
  return typeof v === "number" ? v : String(v);
}

export function Campanas({ datos, plan, onMarcar, onVincular }: {
  datos: Datos;
  plan: PlanMap;
  onMarcar: (id: string, hecho: boolean) => void;
  onVincular: (campana: string, productos: string[]) => Promise<void>;
}) {
  const [clase, setClase] = useState<Clase | "TODAS">("TODAS");
  const [soloSinProducto, setSoloSinProducto] = useState(false);
  const opciones = useMemo(
    () =>
      [...datos.productos, ...datos.productosSinCampana]
        .map((p) => p.nombre)
        .sort((a, b) => a.localeCompare(b, "es")),
    [datos.productos, datos.productosSinCampana],
  );
  const sinProducto = datos.campanas.filter((c) => c.sinProducto).length;
  const [cuenta, setCuenta] = useState("TODAS");
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<{ campo: Campo; dir: 1 | -1 }>({ campo: "gasto", dir: -1 });

  const cuentas = useMemo(
    () => [...new Set(datos.campanas.map((c) => c.cuenta))],
    [datos.campanas],
  );

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const salida = datos.campanas.filter((c) => {
      if (clase !== "TODAS" && c.clase !== clase) return false;
      if (cuenta !== "TODAS" && c.cuenta !== cuenta) return false;
      if (soloSinProducto && !c.sinProducto) return false;
      if (q) {
        const enTexto = `${c.nombre} ${c.productos.join(" ")}`.toLowerCase();
        if (!enTexto.includes(q)) return false;
      }
      return true;
    });
    salida.sort((a, b) => {
      const va = valor(a, orden.campo);
      const vb = valor(b, orden.campo);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "es") * orden.dir;
      }
      return (va - vb) * orden.dir;
    });
    return salida;
  }, [datos.campanas, clase, cuenta, busqueda, orden, soloSinProducto]);

  const cambiarOrden = (campo: Campo) =>
    setOrden((o) => (o.campo === campo ? { campo, dir: (o.dir * -1) as 1 | -1 } : { campo, dir: -1 }));

  const gastoFiltrado = filas.reduce((a, c) => a + c.gasto, 0);
  const netoFiltrado = filas.reduce((a, c) => a + (c.neto ?? 0), 0);
  const hayFiltros = Boolean(busqueda) || clase !== "TODAS" || cuenta !== "TODAS" || soloSinProducto;

  return (
    <>
      {sinProducto ? (
        <div className="banner warn">
          <strong>{sinProducto} campaña(s) sin producto vinculado.</strong> Sin vínculo no se sabe
          qué ganancia deja cada compra. Elige el producto en la columna <em>Producto</em> (si el
          nombre se parece a uno, ya viene sugerido).{" "}
          <button type="button" className="btn sm" onClick={() => setSoloSinProducto(!soloSinProducto)}>
            {soloSinProducto ? "Ver todas" : "Ver solo esas"}
          </button>
        </div>
      ) : null}
      <section className="card">
        <div className="toolbar ads-filtros">
          <input
            className="field"
            placeholder="Buscar campaña o producto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar campaña"
          />
          <select
            className="field"
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
            aria-label="Cuenta"
          >
            <option value="TODAS">Todas las cuentas</option>
            {cuentas.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="ads-chips" role="group" aria-label="Filtrar por clasificación">
            <button
              type="button"
              className={`ads-chip${clase === "TODAS" ? " on" : ""}`}
              onClick={() => setClase("TODAS")}
            >
              Todas <strong>{filas.length}</strong>
            </button>
            {CLASES.map((c) => (
              <button
                key={c}
                type="button"
                className={`ads-chip ${CLASE_CLS[c]}${clase === c ? " on" : ""}`}
                onClick={() => setClase(clase === c ? "TODAS" : c)}
              >
                {ETIQUETAS[c]} <strong>{datos.conteos[c]}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="ads-table-caption">
          <span>
            Mostrando <strong>{filas.length}</strong> de {datos.campanas.length} campañas
          </span>
          <span>Gasto <strong>{dinero(gastoFiltrado)}</strong></span>
          <span>Neto estimado <strong>{dinero(netoFiltrado)}</strong></span>
          {hayFiltros ? (
            <button
              type="button"
              className="btn sm ads-clear-filters"
              onClick={() => {
                setBusqueda("");
                setClase("TODAS");
                setCuenta("TODAS");
                setSoloSinProducto(false);
              }}
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>

        <div className="table-wrap">
          <table className="table tabla-anuncios">
            <thead>
              <tr>
                {CABECERAS.map((h) => (
                  <th key={h.campo} className={h.num ? "meta-num" : ""}>
                    <button type="button" className="orden-cab" onClick={() => cambiarOrden(h.campo)}>
                      {h.label}
                      {orden.campo === h.campo ? (orden.dir === -1 ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
                <th>Producto</th>
                <th>Clasificación</th>
                <th className="wrap">Acción sugerida</th>
                <th>Hecho</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="ads-campana">
                      <span
                        className={`ads-punto ${c.estado === "ACTIVE" ? "encendida" : "apagada"}`}
                        title={c.estado === "ACTIVE" ? "Encendida" : c.estado === "PAUSED" ? "Pausada" : c.estado}
                      />
                      <span title={c.nombre}>{c.nombre}</span>
                    </div>
                    <span className="muted small">{c.cuenta}</span>
                  </td>
                  <td className="meta-num">{fechaCorta(c.creada)}</td>
                  <td className="meta-num">{dinero(c.gasto)}</td>
                  <td className="meta-num">
                    {c.compras}
                    <span className="muted small"> ({c.compras7} en 7d)</span>
                  </td>
                  <td className="meta-num">{c.cpa === null ? "—" : dinero(c.cpa)}</td>
                  <td className="meta-num">
                    {c.margen === null ? <span className="muted">sin dato</span> : dinero(c.margen)}
                  </td>
                  <td className={`meta-num${(c.neto ?? 0) < 0 ? " ads-malo" : ""}`}>
                    {c.neto === null ? "—" : dinero(c.neto)}
                  </td>
                  <td className="meta-num">{veces(c.roi)}</td>
                  <td className="wrap">
                    <VinculoCampana
                      key={`${c.id}:${c.productos.join("|")}`}
                      campana={c}
                      opciones={opciones}
                      onVincular={onVincular}
                    />
                  </td>
                  <td>
                    <span className={`ads-clase ${CLASE_CLS[c.clase]}`}>{ETIQUETAS[c.clase]}</span>
                  </td>
                  <td className="wrap">
                    <strong className="ads-accion-titulo">{c.accion.titulo}</strong>
                    <div className="muted small">{c.accion.detalle}</div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!plan[c.id]?.hecho}
                      onChange={(e) => onMarcar(c.id, e.target.checked)}
                      aria-label={`Marcar ${c.nombre} como hecho`}
                    />
                  </td>
                </tr>
              ))}
              {!filas.length ? (
                <tr>
                  <td colSpan={12} className="muted">
                    Ninguna campaña coincide con los filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
