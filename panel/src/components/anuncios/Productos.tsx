// Productos: la base del calculo (ganancia promedio por unidad), editable en
// la propia tabla. Cambiarla recalcula todo al vuelo sin volver a Meta.
//
// Al lado va el PROMEDIO DE LOS PEDIDOS: la ganancia NETA real que trae
// LucidSales por pedido (gananciaEsperada, ya con envio y costo del proveedor
// descontados) dividida entre los pedidos de ese producto. No entra en el
// calculo salvo que se adopte con «Usar», y jamas pisa lo que se escribio a
// mano (el traedor solo rellena los que estan en 0 y con muestra suficiente).
import { useState } from "react";
import type { AjustesGanancias, Datos, EstadoGanancias } from "../../api/anuncios";
import { CLASE_CLS, ETIQUETAS, dinero, haceCuanto, veces } from "../../api/anuncios";
import { Efectividad } from "./Efectividad";

export function Productos({
  datos,
  onGuardar,
  guardando,
  ganancias,
  onTraer,
  onAjustes,
  onImportar,
  onEntrega,
}: {
  datos: Datos;
  onGuardar: (nombre: string, ganancia: number) => Promise<void>;
  guardando: boolean;
  ganancias: EstadoGanancias | null;
  onTraer: () => Promise<void>;
  onAjustes: (ajustes: Partial<AjustesGanancias>) => Promise<void>;
  onImportar: () => Promise<void>;
  onEntrega: Parameters<typeof Efectividad>[0]["onGuardar"];
}) {
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [verTodos, setVerTodos] = useState(false);
  const [importando, setImportando] = useState(false);
  const sinMapear = datos.campanas.filter((c) => c.sinProducto);
  const sinGanancia = datos.productos.filter((p) => p.unidad === 0);
  const totalProductos = datos.productos.length + datos.productosSinCampana.length;
  const filasTabla = verTodos ? [...datos.productos, ...datos.productosSinCampana] : datos.productos;

  const importar = async () => {
    setImportando(true);
    try {
      await onImportar();
    } finally {
      setImportando(false);
    }
  };
  const minimo = ganancias?.ajustes.minPedidos ?? 20;
  const progreso = ganancias?.progreso;

  const editar = (nombre: string, valor: string) =>
    setBorradores((b) => ({ ...b, [nombre]: valor }));

  const guardar = async (nombre: string) => {
    const texto = borradores[nombre];
    if (texto === undefined) return;
    const v = Number(texto.replace(",", "."));
    if (Number.isNaN(v) || v < 0) return;
    await onGuardar(nombre, v);
    setBorradores((b) => {
      const copia = { ...b };
      delete copia[nombre];
      return copia;
    });
  };

  /** Adopta el promedio de pedidos como ganancia manual de ese producto. */
  const adoptar = async (nombre: string, prom: number | null) => {
    if (prom === null) return;
    await onGuardar(nombre, Math.round(prom));
  };

  /**
   * Marca o desmarca un estado dentro de la muestra. Como el promedio viejo
   * ya no sirve con la regla nueva, recalcula apenas se toca.
   */
  const cuentanEstado = async (nombre: string, cuenta: boolean) => {
    const lista = ganancias?.estados ?? [];
    const incluirEstados = lista
      .filter((e) => (e.nombre === nombre ? cuenta : !e.excluido))
      .map((e) => e.nombre);
    await onAjustes({ incluirEstados });
    await onTraer();
  };

  return (
    <>
      {sinGanancia.length ? (
        <div className="banner warn">
          <strong>{sinGanancia.length} producto(s) sin ganancia promedio:</strong>{" "}
          {sinGanancia.map((p) => p.nombre).join(" · ")}. Mientras esté en 0, sus campañas salen
          como <em>Sin dato</em> y no se pueden medir. El botón “Traer ganancias de pedidos” los
          llena solos cuando alcanzan {minimo} pedidos entregados; si no, escríbela a mano.
        </div>
      ) : null}

      {sinMapear.length ? (
        <div className="banner info">
          <strong>{sinMapear.length} campaña(s) sin producto vinculado.</strong> No se pueden
          medir hasta que elijas su producto en la pestaña <em>Campañas</em>.
        </div>
      ) : null}

      {totalProductos === 0 ? (
        <section className="card ads-vacio">
          <h3>Carga tus productos</h3>
          <p className="muted">
            Trae el catálogo de la tienda que tienes activa en el panel. Después vincula cada
            campaña a su producto y trae la ganancia real de tus pedidos.
          </p>
          <button type="button" className="btn primary" disabled={importando} onClick={() => void importar()}>
            {importando ? "Importando…" : "Importar productos de mi tienda"}
          </button>
        </section>
      ) : null}

      <Efectividad entrega={datos.entrega} onGuardar={onEntrega} />

      <section className="card ads-productos-panel">
        {ganancias ? (
          <div className="ads-ganancias-barra">
            <div className="ads-ganancias-acciones">
              <button
                type="button"
                className="btn primary"
                onClick={() => void onTraer()}
                disabled={guardando || ganancias.enCurso || !ganancias.disponible}
                title="Ganancia neta real de cada pedido (ya con envío y costo del proveedor descontados) promediada por producto"
              >
                {ganancias.enCurso
                  ? `Calculando… ${progreso?.listos ?? 0}/${progreso?.total ?? "…"}`
                  : "Traer ganancias de pedidos"}
              </button>
              <label className="ads-switch" title="Se recalcula solo, una vez al día, al pedir datos frescos">
                <input
                  type="checkbox"
                  checked={ganancias.ajustes.auto}
                  onChange={(e) => void onAjustes({ auto: e.target.checked })}
                />
                Automático al actualizar
              </label>
              <span className="muted small">
                tienda #{ganancias.ajustes.tienda ?? "—"} · ventana {ganancias.ajustes.dias} días ·
                mínimo {minimo} pedidos
              </span>
              <button
                type="button"
                className="btn sm"
                disabled={importando}
                onClick={() => void importar()}
                title="Agrega los productos de tu tienda que todavía no están aquí (no toca los que ya tienes)"
              >
                {importando ? "Importando…" : "Importar productos de mi tienda"}
              </button>
            </div>

            {ganancias.enCurso ? (
              <div className="ads-progreso">
                <progress value={progreso?.listos ?? 0} max={Math.max(1, progreso?.total ?? 1)} />
                <span className="muted small">
                  {progreso?.listos ?? 0} / {progreso?.total ?? "?"} productos
                </span>
              </div>
            ) : ganancias.ultimo ? (
              <span className="muted small">
                Último cálculo {haceCuanto(ganancias.ultimo.ejecutado ?? "")}
                {ganancias.ultimo.estado === "listo"
                  ? ` · ${ganancias.ultimo.conPromedio} producto(s) con promedio · ${dinero(
                      ganancias.ultimo.promedioGlobal,
                    )} por pedido · rellenados ${ganancias.ultimo.rellenados}`
                  : ""}
                {ganancias.ultimo.estado === "error" ? (
                  <span className="ads-malo"> · {ganancias.ultimo.error}</span>
                ) : null}
              </span>
            ) : (
              <span className="muted small">Todavía no se trajeron las ganancias</span>
            )}
          </div>
        ) : null}

        {ganancias?.disponible ? (
          <details className="ads-help">
            <summary>¿Cómo se calcula el promedio de pedidos?</summary>
            <div>
              Es la ganancia <strong>neta real</strong> por pedido que devuelve LucidSales
              (<code>gananciaEsperada</code>), descontando envío y costo del proveedor. Por defecto
              solo cuenta pedidos entregados, porque en los demás todavía pueden faltar esos
              costos. Puedes cambiar los estados incluidos abajo. El promedio nunca reemplaza tu
              valor manual: solo completa productos sin ganancia y con al menos {minimo} pedidos.
              Usa <strong>Adoptar promedio</strong> si quieres aplicarlo a un producto.
            </div>
          </details>
        ) : null}

        {ganancias?.disponible && ganancias.estados.length ? (
          <div className="ads-estados">
            <span className="muted small">¿Qué estados cuentan para el promedio?</span>
            {ganancias.estados.map((e) => {
              const cuenta = !e.excluido;
              const esElUnico = cuenta && ganancias.estados.filter((x) => !x.excluido).length === 1;
              return (
                <label
                  key={e.nombre}
                  className="ads-estado"
                  title={
                    cuenta
                      ? `Los ${e.n.toLocaleString("es-CO")} pedidos de «${e.nombre}» cuentan para el promedio`
                      : `Los ${e.n.toLocaleString("es-CO")} pedidos de «${e.nombre}» quedan afuera: todavía no tienen flete ni costo`
                  }
                >
                  <input
                    type="checkbox"
                    checked={cuenta}
                    disabled={guardando || ganancias.enCurso || esElUnico}
                    onChange={(ev) => void cuentanEstado(e.nombre, ev.target.checked)}
                  />
                  {e.nombre}
                  <span className="muted small"> {e.n.toLocaleString("es-CO")}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        <div className="ads-product-summary">
          <span>
            <strong>{datos.productos.length}</strong> productos con campañas en esta ventana
            {datos.productosSinCampana.length ? ` · ${datos.productosSinCampana.length} sin campañas` : ""}
          </span>
          {datos.productosSinCampana.length ? (
            <label className="ads-switch">
              <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
              Ver también los que no tienen campañas
            </label>
          ) : null}
          <span className="muted small">Edita la ganancia y los resultados se recalculan al guardar.</span>
        </div>
        <div className="table-wrap">
          <table className="table tabla-anuncios">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="meta-num">Precio</th>
                <th className="meta-num" title="Lo que deja un pedido cuando se ENTREGA (ya sin envío ni costo del proveedor)">
                  Ganancia por entregado (COP)
                </th>
                <th className="meta-num">Promedio pedido (COP)</th>
                <th className="meta-num">Campañas</th>
                <th className="meta-num">Gasto</th>
                <th className="meta-num">Compras</th>
                <th className="meta-num">Margen</th>
                <th className="meta-num">Neto</th>
                <th className="meta-num">ROI</th>
                <th>Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {filasTabla.map((p) => {
                const borrado = borradores[p.nombre];
                const sucio = borrado !== undefined && Number(borrado.replace(",", ".")) !== p.unidad;
                const prom = p.pedidosProm;
                const conMuestra = prom !== null && p.pedidosN >= minimo;
                const adoptable = conMuestra && Math.round(prom!) !== p.unidad;
                return (
                  <tr key={p.nombre}>
                    <td className="wrap">
                      {p.nombre}
                      {p.compartida ? <span className="ads-compartida">compartida</span> : null}
                      {p.origenGanancia === "pedidos" ? (
                        <span className="ads-origen">de pedidos</span>
                      ) : null}
                    </td>
                    <td className="meta-num">{dinero(p.precio)}</td>
                    <td className="meta-num">
                      <span className="ads-input-ganancia">
                        <input
                          className="field"
                          type="number"
                          min={0}
                          step={100}
                          value={borrado ?? p.unidad}
                          onChange={(e) => editar(p.nombre, e.target.value)}
                          aria-label={`Ganancia promedio de ${p.nombre}`}
                        />
                        {sucio ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            disabled={guardando}
                            onClick={() => guardar(p.nombre)}
                          >
                            {guardando ? "…" : "Guardar"}
                          </button>
                        ) : null}
                      </span>
                      {p.unidad === 0 ? <span className="ads-malo small"> sin dato</span> : null}
                    </td>
                    <td className="meta-num">
                      {prom !== null ? (
                        <span className="ads-pedidos">
                          <strong>{dinero(prom)}</strong>
                          <span className="muted small">
                            n={p.pedidosN}
                            {p.pedidosNTotal > p.pedidosN ? ` de ${p.pedidosNTotal}` : ""}
                            {conMuestra ? "" : " · muestra baja"}
                          </span>
                          {adoptable ? (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={guardando}
                              title={`Usar ${dinero(prom)} como ganancia promedio de ${p.nombre}`}
                              onClick={() => void adoptar(p.nombre, prom)}
                            >
                              Adoptar
                            </button>
                          ) : null}
                        </span>
                      ) : p.pedidosN > 0 ? (
                        <span className="muted small">
                          n={p.pedidosN}
                          {p.pedidosNTotal > p.pedidosN ? ` de ${p.pedidosNTotal}` : ""} · sin costo
                        </span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td className="meta-num">{p.campanas}</td>
                    <td className="meta-num">{dinero(p.gasto)}</td>
                    <td className="meta-num">{p.compras.toLocaleString("es-CO")}</td>
                    <td className="meta-num">{p.margen === null ? "—" : dinero(p.margen)}</td>
                    <td className={`meta-num${(p.neto ?? 0) < 0 ? " ads-malo" : ""}`}>
                      {p.neto === null ? "—" : dinero(p.neto)}
                    </td>
                    <td className="meta-num">{veces(p.roi)}</td>
                    <td>
                      <span className={`ads-clase ${CLASE_CLS[p.clase]}`}>{ETIQUETAS[p.clase]}</span>
                    </td>
                  </tr>
                );
              })}
              {!filasTabla.length ? (
                <tr>
                  <td colSpan={11} className="muted">
                    Ningún producto tiene campaña con gasto en esta ventana. Vincula tus campañas en la
                    pestaña Campañas.
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
