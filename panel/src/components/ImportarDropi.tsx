import { useEffect, useMemo, useState } from "react";
import { errMsg } from "../api/client";
import { productos } from "../api/endpoints";
import {
  armarImportacionDropi,
  normalizarDropi,
  type ItemDropi,
} from "../lib/dropi";
import { useToast } from "./Toast";
import { Modal } from "./Modal";
import { ErrorBanner, Spinner, money } from "./ui";

/**
 * Modal «Importar productos de Dropi» (flujo del panel oficial):
 *
 *   POST /productos/listProducts/dropi
 *     -> catalogo_de_productos (se pinta y se reutiliza como payload crudo)
 *        importedDropiIds (los marca «Ya importado» y no se pueden volver a elegir)
 *   POST /productos/import-external-products {products, platform:"dropi"}
 *
 * La seleccion es por producto (igual que el modal oficial al marcar la fila:
 * si tiene variantes se eligen todas). `onImportado` avisa al padre para que
 * refresque su lista.
 */
export function ImportarDropi({
  open,
  onClose,
  onImportado,
}: {
  open: boolean;
  onClose: () => void;
  onImportado: () => void;
}) {
  const toast = useToast();

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState<ItemDropi[]>([]);
  const [crudos, setCrudos] = useState<any[]>([]);
  const [importados, setImportados] = useState<Set<string>>(new Set());
  const [texto, setTexto] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importando, setImportando] = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    setSel(new Set());
    try {
      const r: any = await productos.listDropi();
      if (r?.ok === false) throw new Error(r.msg || "No se pudieron cargar los productos de Dropi");
      setLista(normalizarDropi(r));
      setCrudos(Array.isArray(r?.catalogo_de_productos) ? r.catalogo_de_productos : []);
      setImportados(new Set((r?.importedDropiIds ?? []).map((x: unknown) => String(x))));
    } catch (e) {
      setLista([]);
      setCrudos([]);
      setError(errMsg(e));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (open) void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // solo se listan los productos padre (los hijos van dentro de `variants`)
  const padres = useMemo(() => lista.filter((p) => p.id === p.productId), [lista]);

  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase();
    if (!q) return padres;
    return padres.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.variants ?? []).some(
          (v) =>
            v.name.toLowerCase().includes(q) || (v.sku ?? "").toLowerCase().includes(q),
        ),
    );
  }, [padres, texto]);

  const alterna = (id: string) => {
    // los ya importados no se pueden elegir (el input viene deshabilitado,
    // pero aqui no dependemos de eso)
    if (importados.has(id)) return;
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const marcarTodo = () =>
    setSel((prev) => {
      const n = new Set(prev);
      for (const p of visibles) if (!importados.has(p.id)) n.add(p.id);
      return n;
    });

  const importar = async () => {
    const elegidos: ItemDropi[] = [];
    for (const p of padres) {
      if (!sel.has(p.id)) continue;
      if (p.variants?.length) elegidos.push(...p.variants);
      else elegidos.push(p);
    }
    const products = armarImportacionDropi(crudos, elegidos);
    if (!products.length) {
      setError("Selecciona al menos un producto");
      return;
    }
    setImportando(true);
    setError(null);
    try {
      const r: any = await productos.importExternal({ products, platform: "dropi" });
      if (r?.ok === false) throw new Error(r.msg || "Error al importar");
      toast.success(r?.msg || `Se han importado ${products.length} productos correctamente.`);
      onImportado();
      onClose();
    } catch (e) {
      const m = errMsg(e);
      setError(m);
      toast.error(m);
    } finally {
      setImportando(false);
    }
  };

  const nSel = visibles.filter((p) => sel.has(p.id)).length;

  return (
    <Modal
      open={open}
      title="Importar productos de Dropi"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small" style={{ marginRight: "auto" }}>
            {cargando
              ? "Consultando productos..."
              : `${sel.size} seleccionados de ${padres.length}`}
          </span>
          <button className="btn ghost" onClick={onClose} disabled={importando}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => void importar()}
            disabled={importando || cargando || sel.size === 0}
          >
            {importando ? "Importando..." : `Importar${sel.size ? ` ${sel.size}` : ""}`}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <code>POST /productos/listProducts/dropi</code> → seleccionas →{" "}
        <code>import-external-products &#123;platform: "dropi"&#125;</code>. Los que ya están
        importados salen marcados y no se pueden volver a elegir.
      </p>

      <div className="row gap" style={{ marginBottom: 10 }}>
        <input
          id="dropi-buscar"
          placeholder="Buscar por nombre o sku (también variantes)"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          aria-label="Buscar productos de Dropi"
        />
        <button
          type="button"
          className="btn sm"
          onClick={marcarTodo}
          disabled={cargando || nSel === 0}
        >
          Seleccionar lo visible
        </button>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => setSel(new Set())}
          disabled={sel.size === 0}
        >
          Limpiar
        </button>
      </div>

      <ErrorBanner error={error} />

      {cargando ? (
        <Spinner label="Consultando los productos de Dropi..." />
      ) : lista.length === 0 ? (
        <p className="muted">
          {error ? "No se pudo cargar el catálogo." : "Dropi no devolvió productos."}
        </p>
      ) : visibles.length === 0 ? (
        <p className="muted">Sin resultados para “{texto}”.</p>
      ) : (
        <ul className="dropi-lista">
          {visibles.map((p) => {
            const ya = importados.has(p.id);
            return (
              <li key={p.id} className={`dropi-fila${sel.has(p.id) ? " elegida" : ""}`}>
                <input
                  type="checkbox"
                  checked={sel.has(p.id)}
                  disabled={ya}
                  onChange={() => alterna(p.id)}
                  aria-label={`Seleccionar ${p.name}`}
                />
                {p.thumbnail ? (
                  <img
                    className="prod-mini"
                    src={p.thumbnail}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="prod-mini dropi-sin-img" aria-hidden="true">
                    📦
                  </span>
                )}
                <span className="dropi-info">
                  <span className="dropi-nombre">
                    <strong>{p.name}</strong>
                    {ya ? <span className="badge ok">Ya importado</span> : null}
                  </span>
                  <span className="muted small">
                    {p.price ? money(p.price) : "—"} ·{" "}
                    {p.variants?.length
                      ? `${p.variants.length} variantes`
                      : "producto simple"}
                  </span>
                  {p.variants?.length ? (
                    <span className="muted small dropi-variantes">
                      {p.variants.map((v) => v.name).join(" · ")}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
