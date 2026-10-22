import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { puede } from "../auth/permisos";
import { errMsg } from "../api/client";
import { pedidos } from "../api/endpoints";
import { ErrorBanner, EstadoBadge, PageHeader, Spinner, money } from "../components/ui";
import { fmtFecha, haceCuanto, telefono } from "../lib/format";
import { useEtiquetaTienda } from "../lib/tiendas";

interface PedidoLight {
  id: number;
  idPedido: number;
  Nombre?: string;
  Apellido?: string;
  Movil?: string;
  EstadoPedido?: number;
  Total?: string;
  Fecha?: string;
  CreatedAt?: string;
}

const filtrosEstado = (estado: string) =>
  JSON.stringify([
    { name: "date", searchValues: [], sortOrder: "desc" as const },
    { name: "orderStatus", searchValues: [estado], sortOrder: null },
  ]);

/** Estados que se muestran como tarjetas (los mismos del filtro del panel). */
const CONTEOS: { label: string; code: number }[] = [
  { label: "Por confirmar", code: 0 },
  { label: "Cancelado", code: 1 },
  { label: "Confirmado", code: 2 },
  { label: "Modificado", code: 3 },
];

/**
 * Pantalla de entrada: numeros clave del negocio + ultimos pedidos.
 * Los conteos por estado usan get-filters-data-like (itemsPerPage=1) para
 * leer solo totalRecords: es exacto sin descargar listas.
 */
export function DashboardPage() {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();

  // permisos de LucidSales: sin el 2 no se piden (ni se pintan) pedidos
  const verPedidos = puede(session?.rol ?? null, "pedidos");

  const [totales, setTotales] = useState<Record<string, number>>({});
  const [recientes, setRecientes] = useState<PedidoLight[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);

    if (!verPedidos) {
      // sin permiso no se hace ninguna llamada de pedidos
      setTotales({});
      setRecientes([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    Promise.allSettled([
      pedidos.list({
        idEmpresa,
        page: 1,
        itemsPerPage: 8,
        search: "",
        filters: JSON.stringify([{ name: "date", searchValues: [], sortOrder: "desc" }]),
      }),
      ...CONTEOS.map(({ label }) =>
        pedidos
          .list({
            idEmpresa,
            page: 1,
            itemsPerPage: 1,
            search: "",
            filters: filtrosEstado(label),
          })
          .then((r: any) => ({ estado: label, total: r?.totalRecords ?? 0 })),
      ),
    ])
      .then((res) => {
        if (cancel) return;
        const primero = res[0];
        if (primero.status === "fulfilled") {
          const r: any = primero.value;
          setRecientes(Array.isArray(r?.pedidos) ? r.pedidos : []);
          setTotal(r?.totalRecords ?? 0);
        } else {
          setError(errMsg(primero.reason));
        }
        const conteos: Record<string, number> = {};
        res.slice(1).forEach((r) => {
          if (r.status === "fulfilled") conteos[r.value.estado] = r.value.total;
        });
        setTotales(conteos);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [idEmpresa, verPedidos]);

  const tarjetas: {
    label: string;
    value: number;
    href: string;
    destacado: boolean;
    estado?: number;
  }[] = [
    { label: "Pedidos totales", value: total, href: "/pedidos", destacado: true },
    ...CONTEOS.map(({ label, code }) => ({
      label,
      value: totales[label] ?? 0,
      href: `/pedidos?estado=${encodeURIComponent(label)}`,
      destacado: false,
      estado: code,
    })),
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${session?.user.name?.split(" ")[0] || "bienvenido"}`}
        subtitle={`Resumen de ${etiqueta(idEmpresa)}`}
        actions={
          <>
            {verPedidos && (
              <Link className="btn primary" to="/pedidos/nuevo">
                + Nuevo pedido
              </Link>
            )}
          </>
        }
      />

      <ErrorBanner error={error} />

      {loading ? (
        <Spinner label="Cargando resumen..." />
      ) : !verPedidos ? (
        <div className="banner info">
          Tu usuario de LucidSales no tiene el módulo <strong>Pedidos</strong> (permiso{" "}
          <code>2</code>), así que aquí no hay resumen de pedidos.
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {tarjetas.map((t) => (
              <Link key={t.label} to={t.href} className={`stat-card${t.destacado ? " hero" : ""}`}>
                <span className="stat-label">{t.label}</span>
                <span className="stat-value">{t.value.toLocaleString("es-CO")}</span>
                {t.estado !== undefined && <EstadoBadge value={t.estado} />}
              </Link>
            ))}
          </div>

          <section className="card">
            <div className="row between">
              <div className="card-title" style={{ marginBottom: 0 }}>
                Ultimos pedidos
              </div>
              <Link className="btn sm" to="/pedidos">
                Ver todos
              </Link>
            </div>

            {recientes.length === 0 ? (
              <p className="muted">Todavia no hay pedidos en esta tienda.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Cliente</th>
                      <th className="hide-sm">Telefono</th>
                      <th>Estado</th>
                      <th className="hide-sm">Total</th>
                      <th className="hide-sm">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recientes.map((p) => {
                      const tel = telefono(p.Movil);
                      return (
                        <tr key={p.id ?? p.idPedido}>
                          <td>
                            <Link to={`/pedidos/${p.id ?? p.idPedido}`}>
                              <strong>#{p.idPedido ?? p.id}</strong>
                            </Link>
                          </td>
                          <td className="wrap">
                            {[p.Nombre, p.Apellido].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="hide-sm">{tel ? tel.visible : "—"}</td>
                          <td>
                            <EstadoBadge value={p.EstadoPedido} />
                          </td>
                          <td className="hide-sm">{money(p.Total)}</td>
                          <td className="hide-sm" title={fmtFecha(p.Fecha ?? p.CreatedAt)}>
                            {haceCuanto(p.Fecha ?? p.CreatedAt) || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
