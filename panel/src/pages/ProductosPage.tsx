import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg, pickArray } from "../api/client";
import { productos } from "../api/endpoints";
import { ErrorBanner, JsonTable, JsonView, PageHeader, Spinner } from "../components/ui";
import { JsonPost as JsonPostEditor } from "../components/JsonPost";
import { ListaProductos } from "../components/ListaProductos";
import { ImportarDropi } from "../components/ImportarDropi";
import { useEtiquetaTienda } from "../lib/tiendas";

type Origen = "local" | "shopify" | "dropi";

export function ProductosPage() {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();

  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "local" (por defecto) se lista y edita con ListaProductos; las otras
  // fuentes son solo lectura (JSON de Shopify / Dropi).
  const [origen, setOrigen] = useState<Origen>("local");
  const [importarDropi, setImportarDropi] = useState(false);
  // /productos?editar=<id> -> abre la ficha (viene de una linea de pedido)
  const [params, setParams] = useSearchParams();
  const editarId = params.get("editar") ?? "";

  const cargar = async (modo: "shopify" | "dropi") => {
    setLoading(true);
    setError(null);
    setOrigen(modo);
    try {
      const res = modo === "shopify" ? await productos.listShopify() : await productos.listDropi();
      setRaw(res);
      setRows(pickArray(res, ["productos", "products", "data", "items", "catalogo_de_productos"]));
    } catch (err) {
      setError(errMsg(err));
      setRows([]);
      setRaw(null);
    } finally {
      setLoading(false);
    }
  };

  // al cambiar de tienda se vuelve al catalogo editable
  useEffect(() => {
    setOrigen("local");
    setRows([]);
    setRaw(null);
    setError(null);
  }, [idEmpresa]);

  return (
    <div className="productos-page">
      <PageHeader
        title="Productos"
        subtitle={`Catálogo de ${etiqueta(idEmpresa)}`}
        actions={
          <div className="productos-origen" role="tablist" aria-label="Origen del catálogo">
            <button
              type="button"
              role="tab"
              aria-selected={origen === "local"}
              className={origen === "local" ? "btn primary" : "btn"}
              onClick={() => {
                setOrigen("local");
                setRows([]);
                setRaw(null);
                setError(null);
              }}
            >
              Mi catálogo
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={origen === "shopify"}
              className={origen === "shopify" ? "btn primary" : "btn"}
              onClick={() => void cargar("shopify")}
              disabled={loading}
            >
              Shopify
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={origen === "dropi"}
              className={origen === "dropi" ? "btn primary" : "btn"}
              onClick={() => void cargar("dropi")}
              disabled={loading}
            >
              Dropi
            </button>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {origen === "local" ? (
        // catalogo editable: tabla con crear / editar / eliminar
        <ListaProductos
          key={idEmpresa}
          idEmpresa={idEmpresa}
          editarId={editarId}
          onEditado={() => setParams({}, { replace: true })}
        />
      ) : (
        <section className="card productos-fuente-card">
          <header className="productos-fuente-header">
            <div>
              <h2>{origen === "shopify" ? "Productos de Shopify" : "Productos de Dropi"}</h2>
              <p>
                {origen === "dropi"
                  ? "Explora el catálogo de Dropi y añade productos a tu tienda cuando los necesites."
                  : "Consulta los productos disponibles en tu tienda de Shopify."}
              </p>
            </div>
            {origen === "dropi" ? (
              <button type="button" className="btn primary" onClick={() => setImportarDropi(true)}>
                Importar desde Dropi
              </button>
            ) : null}
          </header>
          {loading ? (
            <Spinner />
          ) : rows.length > 0 ? (
            <JsonTable rows={rows} />
          ) : (
            <div className="productos-empty">
              <span className="productos-empty-mark" aria-hidden="true">↗</span>
              <strong>No hay productos para mostrar</strong>
              <p className="muted">Pulsa Shopify o Dropi arriba para cargar el catálogo externo.</p>
            </div>
          )}
        </section>
      )}

      <ImportarDropi
        open={importarDropi}
        onClose={() => setImportarDropi(false)}
        onImportado={() => void cargar("dropi")}
      />

      <details className="card productos-avanzado">
        <summary>Herramientas avanzadas</summary>
        <p className="muted small">
          Importación técnica por API y respuestas completas del servidor. Para el uso diario,
          utiliza el catálogo y las opciones de importación.
        </p>
        <JsonPostEditor
          path="/productos/import-external-products"
          initialBody={JSON.stringify(
            { platform: "shopify", products: [] },
            null,
            2,
          )}
          label="Importar productos externos"
        />
        <details className="productos-respuesta">
          <summary>Ver respuesta completa del servidor</summary>
          <JsonView data={raw} />
        </details>
      </details>
    </div>
  );
}
