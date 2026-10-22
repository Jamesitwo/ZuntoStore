import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg } from "../api/client";
import { analitica, ESTADOS_PEDIDO, FILTROS_META, INTEGRACIONES, metaMetricas, pedidos, productos } from "../api/endpoints";
import { ErrorBanner, JsonView, PageHeader, Spinner } from "../components/ui";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { fmtFechaCorta } from "../lib/format";
import {
  aDia,
  acumulaMeta,
  agrupaCampanas,
  agrupaGuias,
  armarConsulta,
  ayer,
  diasEntre,
  etiquetaCampana,
  etiquetaRango,
  finDia,
  hoy,
  inicioDia,
  mesActual,
  mesAnterior,
  periodoAnterior,
  tasaEntrega,
  ultimosDias,
  type DatosMetricas,
  type FilaEstado,
  type FilaMeta,
  type Rango,
  type ResumenCampana,
} from "../lib/metricas";
import { useEtiquetaTienda } from "../lib/tiendas";

/** $31.843.929 (sin decimales: las ventas salen en pesos enteros). */
const cop = (v: unknown) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CO");
const entero = (v: unknown) => Math.round(Number(v) || 0).toLocaleString("es-CO");

/** "2026-10-06" en hora LOCAL (toISOString se iria a UTC y correria un dia). */
const aInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const deInput = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const PRESETS: Array<{ id: string; label: string; rango: () => Rango }> = [
  { id: "hoy", label: "Hoy", rango: hoy },
  { id: "ayer", label: "Ayer", rango: ayer },
  { id: "7", label: "Ultimos 7 dias", rango: () => ultimosDias(7) },
  { id: "30", label: "Ultimos 30 dias", rango: () => ultimosDias(30) },
  { id: "mes", label: "Mes actual", rango: mesActual },
  { id: "mesant", label: "Mes anterior", rango: mesAnterior },
];

interface ProductoCorto {
  id: string;
  nombre: string;
}

/**
 * Seccion "Metricas" (rol 4 / `metricas-lucidsales` del panel oficial).
 *
 * Todo sale del UNICO endpoint que usa el oficial:
 *   GET /analitica/get-analytics-data?startDate=...&compareStartDate=...&idShop=...
 * (ver lib/metricas.ts para como se arman los dos periodos).
 */
export function MetricasPage() {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();

  const [rango, setRango] = useState<Rango>(() => hoy());
  const [preset, setPreset] = useState("hoy");
  const [desde, setDesde] = useState(() => aInput(new Date()));
  const [hasta, setHasta] = useState(() => aInput(new Date()));

  const [producto, setProducto] = useState("");
  const [origen, setOrigen] = useState("");
  const [proveedor, setProveedor] = useState("");

  const [datos, setDatos] = useState<DatosMetricas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const [fuentes, setFuentes] = useState<string[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoCorto[]>([]);

  const [serie, setSerie] = useState<"ventas" | "pedidos">("ventas");

  // pestana "resumen" = analitica; "meta" = Ventas LucidBot (campañas)
  const toast = useToast();
  const [pestana, setPestana] = useState<"resumen" | "meta">("resumen");
  const [filasMeta, setFilasMeta] = useState<FilaMeta[] | null>(null);
  const [msgMeta, setMsgMeta] = useState<string | null>(null);
  const [cargandoMeta, setCargandoMeta] = useState(false);
  const [errMeta, setErrMeta] = useState<string | null>(null);
  const [busqMeta, setBusqMeta] = useState("");
  const [busqAplicada, setBusqAplicada] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [proximoIntento, setProximoIntento] = useState<Date | null>(null);
  const [metaSel, setMetaSel] = useState<FilaMeta | null>(null);

  // vista de Meta: resumen por campana (estilo Ads Manager) o detalle por anuncio
  const [vista, setVista] = useState<"campanas" | "anuncios">("campanas");
  const [campanaSel, setCampanaSel] = useState<string | null>(null);
  const [ordenCampanas, setOrdenCampanas] = useState<{
    campo: keyof ResumenCampana | "campana";
    desc: boolean;
  }>({ campo: "spend", desc: true });
  // tipo de cambio opcional (la inversion viene en la moneda de la cuenta
  // publicitaria, normalmente USD, y las ventas en COP)
  const [fx, setFx] = useState<string>(() => {
    try {
      return localStorage.getItem("zunto.meta.fx") || "";
    } catch {
      return "";
    }
  });

  // consulta exacta que se manda (para el detalle de abajo)
  const consulta = useMemo(
    () => armarConsulta(rango, { productId: producto, source: origen, dropshippingProvider: proveedor }),
    [rango, producto, origen, proveedor],
  );

  useEffect(() => {
    let cancel = false;
    pedidos
      .filtersData(idEmpresa)
      .then((r: any) => {
        if (!cancel) setFuentes(Array.isArray(r?.filtersData?.sources) ? r.filtersData.sources : []);
      })
      .catch(() => {
        /* sin fuentes se queda el desplegable "Todas" */
      });
    productos
      .list(idEmpresa)
      .then((r: any) => {
        if (cancel) return;
        const filas = Array.isArray(r?.productos) ? r.productos : [];
        setCatalogo(
          filas
            .map((p: any) => ({
              // el oficial usa `id`; algunas respuestas traen `product_id`
              id: String(p?.id ?? p?.product_id ?? ""),
              nombre: String(p?.Nombre ?? p?.name ?? ""),
            }))
            .filter((p: ProductoCorto) => p.id && p.nombre),
        );
      })
      .catch(() => {
        /* el selector de producto queda vacio pero las metricas siguen */
      });
    return () => {
      cancel = true;
    };
  }, [idEmpresa]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    analitica
      .get({ ...consulta, idShop: idEmpresa })
      .then((r) => {
        if (!cancel) setDatos(r as DatosMetricas);
      })
      .catch((e) => {
        if (!cancel) {
          setDatos(null);
          setError(errMsg(e));
        }
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [idEmpresa, consulta, recarga]);

  // Ventas LucidBot (metricas de Meta): solo se pide si estas en su pestana
  useEffect(() => {
    if (pestana !== "meta") return;
    let cancel = false;
    setCargandoMeta(true);
    setErrMeta(null);
    metaMetricas
      .list({
        startDate: aDia(rango.desde),
        endDate: aDia(rango.hasta),
        search: busqAplicada,
        filters: FILTROS_META,
      })
      .then((r: any) => {
        if (cancel) return;
        const filas = Array.isArray(r?.insights) ? r.insights : [];
        setFilasMeta(filas);
        setMsgMeta(filas.length ? null : r?.msg || "No hay insights registrados");
      })
      .catch((e) => {
        if (!cancel) {
          setFilasMeta(null);
          setErrMeta(errMsg(e));
        }
      })
      .finally(() => {
        if (!cancel) setCargandoMeta(false);
      });
    return () => {
      cancel = true;
    };
  }, [pestana, rango, busqAplicada, recarga]);

  // limite de sincronizacion: el oficial desactiva el boton hasta que toque
  useEffect(() => {
    if (pestana !== "meta") return;
    let cancel = false;
    metaMetricas
      .ultimaSync()
      .then((r: any) => {
        if (cancel) return;
        const d = r?.nextAttempt ? new Date(r.nextAttempt) : null;
        setProximoIntento(d && d.getTime() > Date.now() ? d : null);
      })
      .catch(() => {
        if (!cancel) setProximoIntento(null);
      });
    return () => {
      cancel = true;
    };
  }, [pestana, recarga]);

  /** Fuerza la sincronizacion con Meta (el oficial la limita a cada 3 h). */
  const sincronizarInsights = async () => {
    setSincronizando(true);
    try {
      const r: any = await metaMetricas.sincronizar();
      const prox = r?.nextAttempt ? new Date(r.nextAttempt) : null;
      setProximoIntento(prox && prox.getTime() > Date.now() ? prox : null);
      if (prox && prox.getTime() > Date.now()) {
        toast.info(
          `Sincronizacion limitada a cada 3 horas. Proximo intento: ${prox.toLocaleString("es-CO")}`,
        );
      } else {
        toast.success("Insights sincronizados");
      }
      setRecarga((x) => x + 1);
    } catch (e: any) {
      const prox = e?.body?.nextAttempt ? new Date(e.body.nextAttempt) : null;
      if (Number(e?.status) === 429 && prox) {
        setProximoIntento(prox);
        toast.error(`Demasiado pronto. Proximo intento: ${prox.toLocaleString("es-CO")}`);
      } else {
        toast.error(errMsg(e));
      }
    } finally {
      setSincronizando(false);
    }
  };

  /** "Descargar Reporte" del oficial, en CSV (sin librerias). */
  const descargarCsv = () => {
    const filas = filasMeta ?? [];
    if (!filas.length) return;
    const columnas: Array<[string, (f: FilaMeta) => string]> = [
      ["Campaña", (f) => String(f.campaignTitle ?? "")],
      ["Conjunto de Anuncios", (f) => String(f.adSetTitle ?? "")],
      ["Anuncio", (f) => String(f.adTitle ?? "")],
      ["Producto", (f) => String(f.Producto ?? "")],
      ["Mensajes", (f) => String(f.messages ?? 0)],
      ["Costo por Mensaje", (f) => String(f.costPerMessage ?? "")],
      ["Cantidad Ventas", (f) => String(f.sells ?? 0)],
      ["Total Ventas", (f) => String(f.total ?? 0)],
      ["Costo por Venta", (f) => String(f.costPerSale ?? "")],
      ["% Cierre", (f) => String(f.cierre ?? "")],
      ["Click", (f) => String(f.clicks ?? 0)],
      ["Inversión", (f) => String(f.spend ?? "")],
    ];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [
      columnas.map(([t]) => esc(t)).join(";"),
      ...filas.map((f) => columnas.map(([, g]) => esc(g(f))).join(";")),
    ].join("\r\n");
    // data URI: lo puede abrir cualquier navegador (y no hace falta Blob)
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + csv);
    a.download = `ventas-lucidbot-${aDia(rango.desde)}_${aDia(rango.hasta)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`${filas.length} filas descargadas`);
  };

  const aplicarPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const r = p.rango();
    setPreset(id);
    setRango(r);
    setDesde(aInput(r.desde));
    setHasta(aInput(r.hasta));
  };

  const [errRango, setErrRango] = useState<string | null>(null);
  const aplicarPersonalizado = () => {
    const a = deInput(desde);
    const b = deInput(hasta);
    if (!a || !b) {
      setErrRango("Fechas incompletas");
      return;
    }
    if (inicioDia(a).getTime() > inicioDia(b).getTime()) {
      setErrRango("El inicio no puede ser posterior al fin");
      return;
    }
    setErrRango(null);
    setPreset("custom");
    setRango({ desde: inicioDia(a), hasta: finDia(b) });
  };

  const entrega = tasaEntrega(datos?.statusData);
  const utilidad = datos?.utilidaData;
  const ant = periodoAnterior(rango);
  const dias = diasEntre(rango.hasta, rango.desde) + 1;

  // filas que se estan viendo: el detalle puede venir filtrado por campana
  const filasDetalle = campanaSel
    ? (filasMeta ?? []).filter((f) => etiquetaCampana(f) === campanaSel)
    : (filasMeta ?? []);
  const filasActuales = vista === "anuncios" ? filasDetalle : (filasMeta ?? []);
  const totalesMeta = acumulaMeta(filasActuales);
  const campanas = agrupaCampanas(filasMeta ?? []);

  const campanasOrdenadas = [...campanas].sort((a, b) => {
    const c = ordenCampanas.campo;
    const va = c === "campana" ? a.campana : (a[c] as number);
    const vb = c === "campana" ? b.campana : (b[c] as number);
    let r: number;
    if (c === "campana") r = String(va).localeCompare(String(vb), "es");
    else r = Number(va) - Number(vb);
    return ordenCampanas.desc ? -r : r;
  });

  // tipo de cambio opcional (COP por 1 USD). Vacio = valores crudos, como el
  // oficial: la inversion viene en la moneda de la cuenta de Meta y las
  // ventas en COP, asi que sin convertir el ROAS no significa nada.
  const tasa = Number(String(fx).replace(",", ".")) > 0 ? Number(String(fx).replace(",", ".")) : 0;
  const inversionCop = tasa ? totalesMeta.spend * tasa : null;
  const roasReal = tasa && totalesMeta.spend ? totalesMeta.total / (totalesMeta.spend * tasa) : null;
  const costoVentaCop =
    tasa && totalesMeta.sells ? (totalesMeta.spend * tasa) / totalesMeta.sells : null;
  const cpmCop =
    tasa && totalesMeta.impressions ? ((totalesMeta.spend * tasa) / totalesMeta.impressions) * 1000 : null;

  const cambiarFx = (v: string) => {
    setFx(v);
    try {
      localStorage.setItem("zunto.meta.fx", v);
    } catch {
      /* sin almacenamiento: el valor solo vive en esta sesion */
    }
  };

  /** Cambia el orden de la tabla de campanas. */
  const ordenarCampana = (campo: keyof ResumenCampana | "campana") =>
    setOrdenCampanas((o) =>
      o.campo === campo ? { campo, desc: !o.desc } : { campo, desc: campo !== "campana" },
    );

  /** Cabecera ordenable de la tabla de campanas (con la flecha del orden). */
  const celdaOrden = (campo: keyof ResumenCampana | "campana", etiqueta: string) => (
    <button
      type="button"
      className="orden-cab"
      onClick={() => ordenarCampana(campo)}
      title="Ordenar por esta columna"
    >
      {etiqueta}
      {ordenCampanas.campo === campo ? (ordenCampanas.desc ? " ▼" : " ▲") : ""}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Métricas"
        subtitle={`${etiquetaRango(rango.desde, rango.hasta)} · ${fmtFechaCorta(rango.desde)}${
          dias > 1 ? " – " + fmtFechaCorta(rango.hasta) : ""
        } · ${etiqueta(idEmpresa)}`}
        actions={
          <>
            <Link className="btn" to="/pedidos">
              Ver pedidos
            </Link>
            <button className="btn primary" onClick={() => setRecarga((x) => x + 1)} disabled={cargando}>
              🔄 Actualizar
            </button>
          </>
        }
      />

      <ErrorBanner error={error} />

      {/* -------- pestana de seccion + filtros -------- */}
      <section className="card metricas-filtros">
        <div className="tabs metricas-pestanas" role="tablist" aria-label="Secciones de métricas">
          <button
            type="button"
            role="tab"
            aria-selected={pestana === "resumen"}
            className={`tab${pestana === "resumen" ? " active" : ""}`}
            onClick={() => setPestana("resumen")}
          >
            Resumen
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pestana === "meta"}
            className={`tab${pestana === "meta" ? " active" : ""}`}
            onClick={() => setPestana("meta")}
          >
            Ventas LucidBot (Meta)
          </button>
        </div>

        <div className="metricas-presets" role="group" aria-label="Rango de fechas">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn sm${preset === p.id ? " primary" : ""}`}
              onClick={() => aplicarPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`btn sm${preset === "custom" ? " primary" : ""}`}
            onClick={() => setPreset("custom")}
          >
            Personalizado
          </button>
        </div>

        <div className="toolbar metricas-toolbar">
          <div className="field">
            <label htmlFor="m-desde">Desde</label>
            <input
              id="m-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-hasta">Hasta</label>
            <input
              id="m-hasta"
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <button className="btn primary" onClick={aplicarPersonalizado}>
            Aplicar
          </button>

          {pestana === "resumen" ? (
            <>
              <div className="field">
                <label htmlFor="m-producto">Producto</label>
                <select id="m-producto" value={producto} onChange={(e) => setProducto(e.target.value)}>
                  <option value="">Todos</option>
                  {catalogo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {catalogo.length === 0 && <p className="campo-ayuda">Sin catalogo cargado.</p>}
              </div>

              <div className="field">
                <label htmlFor="m-origen">Fuente</label>
                <select id="m-origen" value={origen} onChange={(e) => setOrigen(e.target.value)}>
                  <option value="">Todas</option>
                  {fuentes.filter(Boolean).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="m-proveedor">Proveedor dropshipping</label>
                <select
                  id="m-proveedor"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                >
                  <option value="">Todos</option>
                  {INTEGRACIONES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <form
              className="field metricas-busca"
              onSubmit={(e) => {
                e.preventDefault();
                setBusqAplicada(busqMeta.trim());
              }}
            >
              <label htmlFor="m-buscar">Buscar</label>
              <div className="row gap">
                <input
                  id="m-buscar"
                  placeholder="Producto, campaña, anuncio..."
                  value={busqMeta}
                  onChange={(e) => setBusqMeta(e.target.value)}
                />
                <button className="btn" type="submit">
                  Buscar
                </button>
                {busqAplicada && (
                  <button
                    className="btn ghost"
                    type="button"
                    title="Quitar la busqueda"
                    onClick={() => {
                      setBusqMeta("");
                      setBusqAplicada("");
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
        {errRango && <div className="banner error">{errRango}</div>}
      </section>

      {pestana === "meta" ? (
        <>
          <section className="card">
            <div className="row between" style={{ alignItems: "center" }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Ventas LucidBot · Reporte de Métricas
              </div>
              <div className="row gap">
                <button
                  className="btn sm"
                  onClick={() => void sincronizarInsights()}
                  disabled={sincronizando || Boolean(proximoIntento)}
                  title={
                    proximoIntento
                      ? `Sincronización limitada a cada 3 horas. Próximo intento: ${proximoIntento.toLocaleString("es-CO")}`
                      : "Pide a Meta que vuelva a leer los insights (máx. 1 cada 3 horas)"
                  }
                >
                  {sincronizando ? "Sincronizando..." : "🔄 Sincronizar Insights"}
                </button>
                <button
                  className="btn sm"
                  onClick={descargarCsv}
                  disabled={!(filasMeta ?? []).length}
                >
                  ⬇ Descargar Reporte
                </button>
              </div>
            </div>

            <p className="muted small" style={{ marginTop: 6 }}>
              <code>GET /meta/metrics/1</code> · del {aDia(rango.desde)} al {aDia(rango.hasta)} ·{" "}
              {filasMeta ? `${filasMeta.length} registros` : "…"}
              {busqAplicada ? ` · búsqueda: «${busqAplicada}»` : ""}
            </p>

            {cargandoMeta ? (
              <Spinner label="Cargando métricas de Meta..." />
            ) : errMeta ? (
              <ErrorBanner error={errMeta} />
            ) : (filasMeta ?? []).length === 0 ? (
              <div className="banner info">{msgMeta || "No hay insights en este rango."}</div>
            ) : (
              <>
                <div className="row between meta-barra">
                  <div className="tabs" role="tablist" aria-label="Vista de las métricas de Meta">
                    <button
                      type="button"
                      className={`tab${vista === "campanas" ? " active" : ""}`}
                      onClick={() => setVista("campanas")}
                    >
                      Por campaña
                    </button>
                    <button
                      type="button"
                      className={`tab${vista === "anuncios" ? " active" : ""}`}
                      onClick={() => setVista("anuncios")}
                    >
                      Detalle (anuncio)
                    </button>
                  </div>

                  <div className="row gap meta-fx">
                    <label htmlFor="m-fx">COP por 1 USD</label>
                    <input
                      id="m-fx"
                      inputMode="decimal"
                      placeholder="sin convertir"
                      value={fx}
                      onChange={(e) => cambiarFx(e.target.value)}
                      title="La inversión viene en la moneda de la cuenta publicitaria de Meta (normalmente USD) y las ventas en COP. Con el tipo de cambio se convierte todo a COP."
                    />
                    {tasa > 0 && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        title="Quitar la conversión"
                        onClick={() => cambiarFx("")}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="meta-destacados">
                  <div className="meta-destacado rojo">
                    <span className="meta-destacado-titulo">Total Inversión</span>
                    <span className="meta-destacado-valor">{cop(totalesMeta.spend)}</span>
                    {inversionCop !== null && (
                      <span className="meta-destacado-sub">≈ {cop(inversionCop)} COP</span>
                    )}
                  </div>
                  <div className="meta-destacado verde">
                    <span className="meta-destacado-titulo">Ventas</span>
                    <span className="meta-destacado-valor">{entero(totalesMeta.sells)}</span>
                    <span className="meta-destacado-sub">{cop(totalesMeta.total)}</span>
                  </div>
                </div>

                <div className="stat-grid meta-kpis">
                  <Kpi label="Impresiones" valor={entero(totalesMeta.impressions)} />
                  <Kpi label="Alcance" valor={entero(totalesMeta.reach)} />
                  <Kpi label="CTR" valor={`${totalesMeta.ctr.toFixed(2)} %`} />
                  <Kpi label="CPM" valor={cop(cpmCop ?? totalesMeta.cpm)} />
                  <Kpi label="Click" valor={entero(totalesMeta.clicks)} />
                  <Kpi label="# Mensajes" valor={entero(totalesMeta.messages)} />
                  <Kpi label="% Cierre" valor={`${totalesMeta.cierre.toFixed(2)} %`} />
                  <Kpi
                    label="Costo por venta"
                    valor={cop(costoVentaCop ?? totalesMeta.costPerSale)}
                  />
                  <Kpi label="Costo mensaje" valor={cop(totalesMeta.costPerMessage)} />
                  <Kpi label="ROAS" valor={(roasReal ?? totalesMeta.roas).toFixed(2)} />
                </div>

                {tasa === 0 ? (
                  <p className="muted small">
                    La inversión viene en la moneda de la cuenta publicitaria de Meta (normalmente
                    USD) y las ventas en COP: sin tipo de cambio, <strong>ROAS</strong>,{" "}
                    <strong>Costo por venta</strong> y <strong>CPM</strong> no son comparables.
                    Ponlo en <em>COP por 1 USD</em> y se convierten.
                  </p>
                ) : (
                  <p className="muted small">
                    Todo convertido a COP con 1 USD = {tasa.toLocaleString("es-CO")} · el botón ×
                    devuelve los valores crudos de Meta.
                  </p>
                )}

                {vista === "campanas" ? (
                  <>
                    <div className="table-wrap">
                      <table className="table tabla-meta tabla-campanas">
                        <thead>
                          <tr>
                            <th>{celdaOrden("campana", "Campaña")}</th>
                            <th className="meta-num">{celdaOrden("spend", "Inversión")}</th>
                            <th className="meta-num">{celdaOrden("impressions", "Impresiones")}</th>
                            <th className="meta-num">{celdaOrden("reach", "Alcance")}</th>
                            <th className="meta-num">{celdaOrden("clicks", "Clics")}</th>
                            <th className="meta-num">{celdaOrden("ctr", "CTR")}</th>
                            <th className="meta-num">{celdaOrden("cpm", "CPM")}</th>
                            <th className="meta-num">{celdaOrden("messages", "Mensajes")}</th>
                            <th className="meta-num">{celdaOrden("sells", "Ventas")}</th>
                            <th className="meta-num">{celdaOrden("total", "Total Ventas")}</th>
                            <th className="meta-num">{celdaOrden("costPerSale", "Costo por Venta")}</th>
                            <th className="meta-num">{celdaOrden("roas", "ROAS")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campanasOrdenadas.map((c) => {
                            const cpmMostrar = tasa ? c.cpm * tasa : c.cpm;
                            const costoMostrar =
                              tasa && c.spend && c.sells ? (c.spend * tasa) / c.sells : c.costPerSale;
                            const roasMostrar =
                              tasa && c.spend ? c.total / (c.spend * tasa) : c.roas;
                            return (
                              <tr
                                key={c.campana}
                                className="fila-meta"
                                title="Ver los anuncios de esta campaña"
                                onClick={() => {
                                  setCampanaSel(c.campana);
                                  setVista("anuncios");
                                }}
                              >
                                <td className="wrap">
                                  <strong>{c.campana}</strong>{" "}
                                  <span className="muted small">{c.anuncios} anuncios</span>
                                </td>
                                <td className="meta-num">{c.spend ? cop(c.spend) : "—"}</td>
                                <td className="meta-num">{entero(c.impressions)}</td>
                                <td className="meta-num">{entero(c.reach)}</td>
                                <td className="meta-num">{entero(c.clicks)}</td>
                                <td className="meta-num">
                                  {c.impressions ? `${c.ctr.toFixed(2)} %` : "—"}
                                </td>
                                <td className="meta-num">{c.impressions ? cop(cpmMostrar) : "—"}</td>
                                <td className="meta-num">{entero(c.messages)}</td>
                                <td className="meta-num">{entero(c.sells)}</td>
                                <td className="meta-num">{c.total ? cop(c.total) : "—"}</td>
                                <td className="meta-num">
                                  {c.sells && costoMostrar ? cop(costoMostrar) : "—"}
                                </td>
                                <td className="meta-num">{roasMostrar > 0 ? roasMostrar.toFixed(2) : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <p className="muted small">
                      {campanasOrdenadas.length} campañas, de mayor a menor inversión · pulsa una
                      para ver sus anuncios.
                    </p>
                  </>
                ) : (
                  <>
                    {campanaSel && (
                      <div className="chips" style={{ marginBottom: 10 }}>
                        <span className="chip">
                          Campaña: {campanaSel}
                          <button
                            type="button"
                            className="chip-x"
                            title="Quitar el filtro de campaña"
                            onClick={() => setCampanaSel(null)}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    )}

                    <div className="table-wrap">
                      <table className="table tabla-meta">
                        <thead>
                          <tr>
                            <th>Campaña</th>
                            <th>Conjunto de Anuncios</th>
                            <th>Anuncio</th>
                            <th>Producto</th>
                            <th className="meta-num">Mensajes</th>
                            <th className="meta-num">Costo por Mensaje</th>
                            <th className="meta-num">Cantidad Ventas</th>
                            <th className="meta-num">Total Ventas</th>
                            <th className="meta-num">Costo por Venta</th>
                            <th className="meta-num">% Cierre</th>
                            <th className="meta-num">Click</th>
                            <th className="meta-num">Inversión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filasDetalle.map((f, i) => {
                            const organico = String(f.adId ?? "") === "organico";
                            const ventas = Number(f.sells) || 0;
                            const mensajes = Number(f.messages) || 0;
                            const inversion = Number(f.spend) || 0;
                            const cierre =
                              f.cierre !== null && f.cierre !== undefined
                                ? Number(f.cierre)
                                : mensajes
                                  ? (ventas / mensajes) * 100
                                  : null;
                            const costoVenta =
                              f.costPerSale !== null && f.costPerSale !== undefined
                                ? Number(f.costPerSale)
                                : inversion && ventas
                                  ? inversion / ventas
                                  : null;
                            return (
                              <tr
                                key={`${f.adId}-${i}`}
                                className="fila-meta"
                                title="Ver el detalle de la fila"
                                onClick={() => setMetaSel(f)}
                              >
                                <td className="wrap">
                                  {f.campaignTitle || (organico ? "Orgánico" : "—")}
                                </td>
                                <td className="wrap">{f.adSetTitle || "—"}</td>
                                <td className="wrap">
                                  {f.adTitle || (organico ? "Tráfico orgánico" : "—")}
                                </td>
                                <td className="wrap">{f.Producto || "—"}</td>
                                <td className="meta-num">{entero(f.messages)}</td>
                                <td className="meta-num">
                                  {f.costPerMessage === null || f.costPerMessage === undefined
                                    ? "—"
                                    : cop(f.costPerMessage)}
                                </td>
                                <td className="meta-num">{entero(f.sells)}</td>
                                <td className="meta-num">{cop(f.total)}</td>
                                <td className="meta-num">
                                  {costoVenta === null ? "—" : cop(costoVenta)}
                                </td>
                                <td className="meta-num">
                                  {cierre === null ? "—" : `${cierre.toFixed(2)} %`}
                                </td>
                                <td className="meta-num">{entero(f.clicks)}</td>
                                <td className="meta-num">
                                  {f.spend === null || f.spend === undefined ? "—" : cop(f.spend)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <p className="muted small">
                      {campanaSel
                        ? `${filasDetalle.length} anuncios de «${campanaSel}».`
                        : "Pulsa una fila para ver el detalle."}{" "}
                      Los campos de Meta (inversión, clics, impresiones) salen «—» mientras no haya
                      insights sincronizados.
                    </p>
                  </>
                )}
              </>
            )}
          </section>

          <Modal
            open={!!metaSel}
            title={metaSel ? String(metaSel.Producto || metaSel.adTitle || "Detalle") : "Detalle"}
            onClose={() => setMetaSel(null)}
            footer={
              <button className="btn" onClick={() => setMetaSel(null)}>
                Cerrar
              </button>
            }
          >
            {metaSel && (
              <>
                <dl className="metricas-detalle meta-detalle-lista">
                  <dt>Campaña</dt>
                  <dd>{metaSel.campaignTitle || "—"}</dd>
                  <dt>Conjunto de anuncios</dt>
                  <dd>{metaSel.adSetTitle || "—"}</dd>
                  <dt>Anuncio</dt>
                  <dd>{metaSel.adTitle || (String(metaSel.adId) === "organico" ? "Tráfico orgánico" : "—")}</dd>
                  <dt>Id de anuncio</dt>
                  <dd>{metaSel.adId || "—"}</dd>
                  <dt>Cuenta publicitaria</dt>
                  <dd>{metaSel.accountTitle || "—"}</dd>
                  <dt>Producto</dt>
                  <dd>{metaSel.Producto || "—"}</dd>
                  <dt>Ventas</dt>
                  <dd>{entero(metaSel.sells)}</dd>
                  <dt>Total ventas</dt>
                  <dd>{cop(metaSel.total)}</dd>
                  <dt>Mensajes</dt>
                  <dd>{entero(metaSel.messages)}</dd>
                  <dt>Inversión</dt>
                  <dd>{metaSel.spend === null || metaSel.spend === undefined ? "—" : cop(metaSel.spend)}</dd>
                  <dt>Estado del pedido</dt>
                  <dd>
                    {metaSel.orderStatus === null || metaSel.orderStatus === undefined
                      ? "—"
                      : ESTADOS_PEDIDO[Number(metaSel.orderStatus)] || String(metaSel.orderStatus)}
                  </dd>
                  <dt>Estado de envío</dt>
                  <dd>{metaSel.fulfillmentStatus || "—"}</dd>
                </dl>
                <details className="ver-json">
                  <summary>Ver la fila en bruto</summary>
                  <JsonView data={metaSel} />
                </details>
              </>
            )}
          </Modal>
        </>
      ) : cargando && !datos ? (
        <Spinner label="Cargando metricas..." />
      ) : datos ? (
        <>
          {/* ---------------- tarjetas clave ---------------- */}
          <div className="stat-grid">
            <Tarjeta
              label="Ventas totales"
              valor={cop(datos.ventasTotales.value)}
              change={datos.ventasTotales.change}
              ayuda="Crecimiento de ventas comparado con el periodo anterior"
            />
            <Tarjeta
              label="Pedidos totales"
              valor={entero(datos.pedidosTotales.value)}
              change={datos.pedidosTotales.change}
              ayuda="Crecimiento de pedidos comparado con el periodo anterior"
            />
            <Tarjeta
              label="Utilidad"
              valor={cop(utilidad?.value ?? 0)}
              change={Number(utilidad?.change) || 0}
              ayuda="Ganancia menos publicidad y devoluciones"
              detalle={
                <dl className="metricas-detalle">
                  <dt>Ganancia esperada</dt>
                  <dd>{cop(utilidad?.gananciaEsperada ?? 0)}</dd>
                  <dt>Costo de publicidad</dt>
                  <dd>{cop(utilidad?.costoPublicidad ?? 0)}</dd>
                  <dt>Costo de devolucion</dt>
                  <dd>{cop(utilidad?.costoDevolucion ?? 0)}</dd>
                </dl>
              }
            />
            <Tarjeta
              label="Tasa de entrega"
              valor={`${entrega.value}%`}
              change={entrega.change}
              ayuda="Crecimiento de la tasa de entrega comparado con el periodo anterior"
            />
          </div>

          {/* ---------------- serie temporal ---------------- */}
          <section className="card">
            <div className="row between" style={{ alignItems: "center" }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                {serie === "ventas" ? "Ventas a lo largo del tiempo" : "Pedidos a lo largo del tiempo"}
              </div>
              <div className="tabs" role="tablist">
                <button
                  type="button"
                  className={`tab${serie === "ventas" ? " active" : ""}`}
                  onClick={() => setSerie("ventas")}
                >
                  Ventas
                </button>
                <button
                  type="button"
                  className={`tab${serie === "pedidos" ? " active" : ""}`}
                  onClick={() => setSerie("pedidos")}
                >
                  Pedidos
                </button>
              </div>
            </div>

            <p className="muted small" style={{ marginTop: 6 }}>
              Linea sólida: periodo actual ({fmtFechaCorta(rango.desde)}
              {dias > 1 ? " – " + fmtFechaCorta(rango.hasta) : ""}). Linea punteada: periodo anterior (
              {fmtFechaCorta(ant.desde)}
              {diasEntre(ant.hasta, ant.desde) + 1 > 1 ? " – " + fmtFechaCorta(ant.hasta) : ""}).
            </p>

            <Grafica
              puntos={(datos.lineChartData ?? []).map((p) => ({
                name: p.name,
                actual: serie === "ventas" ? p.current : p.orders_current,
                anterior: serie === "ventas" ? p.previous : p.orders_previous,
              }))}
              moneda={serie === "ventas"}
            />
          </section>

          {/* ---------------- confirmacion + guias ---------------- */}
          <div className="grid-2">
            <section className="card">
              <div className="card-title">Confirmación de pedidos</div>
              <ListaEstados filas={datos.confirmationData ?? []} conMonto />
            </section>

            <section className="card">
              <div className="card-title">Estados de las guías</div>
              <Guias filas={datos.shippingStatusData ?? []} />
            </section>
          </div>

          {/* ---------------- estados de pedido ---------------- */}
          <section className="card">
            <div className="row between" style={{ alignItems: "center" }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Estado de pedidos
              </div>
              <span className="muted small">{(datos.statusData ?? []).length} estados</span>
            </div>
            <ListaEstados filas={datos.statusData ?? []} conMonto />
          </section>

          {/* ---------------- como se calcula ---------------- */}
          <details className="ver-json">
            <summary>Ver la consulta y los totales en bruto</summary>
            <p className="muted small">
              <code>
                GET /analitica/get-analytics-data?{new URLSearchParams(consulta as any).toString()}
                &amp;idShop={idEmpresa}
              </code>
            </p>
            <pre className="json-view">{JSON.stringify(datos.rawMetrics ?? {}, null, 2)}</pre>
          </details>
        </>
      ) : (
        <div className="banner info">
          No hay metricas que mostrar para este rango. Pulsa <strong>Actualizar</strong> o elige otro
          periodo.
        </div>
      )}
    </>
  );
}

// ---------------- piezas ----------------

function Tarjeta({
  label,
  valor,
  change,
  ayuda,
  detalle,
}: {
  label: string;
  valor: string;
  change: number;
  ayuda?: string;
  detalle?: ReactNode;
}) {
  return (
    <div className="stat-card" title={ayuda}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{valor}</span>
      <Variacion v={change} />
      {detalle ? (
        <details className="metricas-detalles">
          <summary>Desglose</summary>
          {detalle}
        </details>
      ) : null}
    </div>
  );
}

function Variacion({ v, titulo }: { v: number; titulo?: string }) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) {
    return (
      <span className="variacion cero" title={titulo}>
        sin cambio
      </span>
    );
  }
  const sube = n > 0;
  return (
    <span className={`variacion ${sube ? "up" : "down"}`} title={titulo}>
      {sube ? "▲" : "▼"} {sube ? "+" : ""}
      {n}%
    </span>
  );
}

function ListaEstados({ filas, conMonto }: { filas: FilaEstado[]; conMonto?: boolean }) {
  if (!filas.length) return <p className="muted">Sin datos en este rango.</p>;
  return (
    <ul className="metricas-lista">
      {filas.map((f, i) => (
        <li key={`${f.name}-${i}`}>
          <div className="metricas-top">
            <span className="metricas-nombre">{f.name}</span>
            <span className="metricas-nums">
              {entero(f.value)}
              {conMonto ? ` · ${cop(f.amount)}` : ""}
            </span>
            <span className="metricas-pct">{Number(f.percentage) || 0}%</span>
            <Variacion v={f.change} />
          </div>
          <div className="barra">
            <span style={{ width: `${Math.min(100, Math.max(0, Number(f.percentage) || 0))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Dona con los 4 grupos oficiales + el listado completo. */
function Guias({ filas }: { filas: FilaEstado[] }) {
  const grupos = agrupaGuias(filas);
  const total = grupos.reduce((s, g) => s + g.value, 0);
  const COLORES: Record<string, string> = {
    Entregado: "#16a34a",
    "En Transito": "#2f5bea",
    "En Novedad": "#d97706",
    Devuelto: "#dc2626",
  };

  if (!total) return <p className="muted">Sin guias en este rango.</p>;

  const R = 62;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="guias">
      <svg className="donut" viewBox="0 0 160 160" role="img" aria-label="Reparto de guias por estado">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--border)" strokeWidth="20" />
        {grupos.map((g) => {
          const frac = total ? g.value / total : 0;
          const trazo = frac * C;
          const offset = -acc * C;
          acc += frac;
          if (!g.value) return null;
          return (
            <circle
              key={g.name}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={COLORES[g.name] ?? "#6b7688"}
              strokeWidth="20"
              strokeDasharray={`${trazo} ${C - trazo}`}
              strokeDashoffset={offset}
              transform="rotate(-90 80 80)"
            >
              <title>{`${g.name}: ${entero(g.value)} (${Math.round(frac * 100)}%)`}</title>
            </circle>
          );
        })}
        <text x="80" y="76" textAnchor="middle" className="donut-total">
          {entero(total)}
        </text>
        <text x="80" y="94" textAnchor="middle" className="donut-sub">
          guias
        </text>
      </svg>

      <ul className="guias-leyenda">
        {grupos.map((g) => (
          <li key={g.name}>
            <span className="punto" style={{ background: COLORES[g.name] ?? "#6b7688" }} />
            <span className="guias-nombre">{g.name}</span>
            <span className="muted small">{entero(g.value)}</span>
            <span className="metricas-pct">{total ? Math.round((g.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>

      <details className="ver-json">
        <summary>Ver el detalle ({filas.length} estados)</summary>
        <ul className="metricas-lista">
          {filas.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <div className="metricas-top">
                <span className="metricas-nombre">{f.name}</span>
                <span className="metricas-nums">
                  {entero(f.value)} · {cop(f.amount)}
                </span>
                <span className="metricas-pct">{Number(f.percentage) || 0}%</span>
                <Variacion v={f.change} />
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Serie actual vs periodo anterior, en SVG (sin libreria de graficas).
 * `preserveAspectRatio="none"` + `vector-effect` mantiene el trazo recto
 * aunque la tarjeta cambie de ancho.
 */
function Grafica({
  puntos,
  moneda,
}: {
  puntos: Array<{ name: string; actual: number; anterior: number }>;
  moneda: boolean;
}) {
  const W = 720;
  const H = 220;
  const PAD = 10;

  if (!puntos.length) return <p className="muted">Sin datos que graficar.</p>;

  const max = Math.max(1, ...puntos.map((p) => Math.max(p.actual, p.anterior)));
  const n = puntos.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i * (W - 2 * PAD)) / (n - 1) + PAD);
  const y = (v: number) => H - PAD - ((Number(v) || 0) / max) * (H - 2 * PAD);

  const trazo = (clave: "actual" | "anterior") =>
    puntos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[clave]).toFixed(1)}`).join(" ");

  const area = n > 1 ? `${trazo("actual")} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z` : "";

  const paso = Math.max(1, Math.ceil(n / 8));
  const marcas: number[] = [];
  for (let i = 0; i < n; i += paso) marcas.push(i);
  if (marcas[marcas.length - 1] !== n - 1) marcas.push(n - 1);

  const fmt = (v: number) => (moneda ? cop(v) : entero(v));

  return (
    <div className="grafica">
      <div className="grafica-ejes">
        <span>Máx {fmt(max)}</span>
        <span className="muted">
          ● Actual: {fmt(puntos.reduce((s, p) => s + (p.actual || 0), 0))} · ○ Anterior:{" "}
          {fmt(puntos.reduce((s, p) => s + (p.anterior || 0), 0))}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="grafica-svg"
        role="img"
        aria-label="Serie de valores del periodo actual contra el anterior"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={W - PAD}
            y1={PAD + (H - 2 * PAD) * f}
            y2={PAD + (H - 2 * PAD) * f}
            className="grid"
          />
        ))}
        {area ? <path d={area} className="grafica-area" /> : null}
        <path d={trazo("anterior")} className="grafica-ante" />
        <path d={trazo("actual")} className="grafica-act" />
        {puntos.map((p, i) => (
          <g key={`${p.name}-${i}`}>
            <circle cx={x(i)} cy={y(p.actual)} r="4" className="punto-act">
              <title>{`${p.name}: ${fmt(p.actual)} (antes ${fmt(p.anterior)})`}</title>
            </circle>
            <circle cx={x(i)} cy={y(p.anterior)} r="3" className="punto-ante">
              <title>{`${p.name} (anterior): ${fmt(p.anterior)}`}</title>
            </circle>
          </g>
        ))}
      </svg>

      <div className="grafica-labels">
        {marcas.map((i) => (
          <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>
            {puntos[i].name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Chip de KPI (los 10 que pinta el oficial en Ventas LucidBot). */
function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="stat-card kpi-meta">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{valor}</span>
    </div>
  );
}
