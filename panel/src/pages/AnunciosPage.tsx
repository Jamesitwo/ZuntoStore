// Rentabilidad de las campañas de Meta Ads de CADA usuario del panel: conecta
// su token, elige sus cuentas, importa sus productos, vincula sus campañas y
// trae la ganancia real de sus pedidos. Nadie ve los datos de otro.
//
// Todo el calculo vive en el backend (server/anunciosMeta.js): aqui solo se
// piden los datos, se pintan y se guarda lo editable.
import { useCallback, useEffect, useState } from "react";
import {
  anuncios,
  CLASES,
  CLASE_CLS,
  ETIQUETAS,
  dinero,
  haceCuanto,
  veces,
  type AjustesGanancias,
  type Datos,
  type EstadoCuenta,
  type EstadoGanancias,
  type PlanMap,
  type VistaCsv,
} from "../api/anuncios";
import { errMsg } from "../api/client";
import { ErrorBanner, PageHeader, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { Alertas } from "../components/anuncios/Alertas";
import { Campanas } from "../components/anuncios/Campanas";
import { ConectarCuenta } from "../components/anuncios/ConectarCuenta";
import { Productos } from "../components/anuncios/Productos";
import { Reporte } from "../components/anuncios/Reporte";
import { Resumen } from "../components/anuncios/Resumen";

const PERIODOS = [7, 15, 30];
const CSV_VISTAS: Array<{ id: VistaCsv; label: string }> = [
  { id: "campanas", label: "Campañas" },
  { id: "alertas", label: "Alertas" },
  { id: "productos", label: "Productos" },
];

type Pestana = "resumen" | "alertas" | "campanas" | "productos" | "cuentas" | "reporte";

export function AnunciosPage() {
  const [dias, setDias] = useState(15);
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);
  const [plan, setPlan] = useState<PlanMap>({});
  const [ganancias, setGanancias] = useState<EstadoGanancias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<VistaCsv>("campanas");
  const [modalCuenta, setModalCuenta] = useState(false);
  const toast = useToast();

  /** Estado del traedor de ganancias (ajustes + progreso + ultimo resultado). */
  const refrescarGanancias = useCallback(async (): Promise<EstadoGanancias | null> => {
    try {
      const g = await anuncios.ganancias();
      setGanancias(g);
      return g;
    } catch {
      return null;
    }
  }, []);

  const cargar = useCallback(async (d: number, forzar = false) => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await anuncios.datos(d, forzar));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCargando(false);
    }
    // pedir datos dispara el traedor automatico de ganancias: hay que mirar
    // si quedo corriendo para sondear el progreso
    void refrescarGanancias();
  }, [refrescarGanancias]);

  /** Primero: si este usuario ya conecto su cuenta (propia | ninguna). */
  const cargarEstado = useCallback(async () => {
    try {
      const e = await anuncios.estado();
      setCuenta(e);
      return e;
    } catch (e) {
      setError(errMsg(e));
      setCargando(false);
      return null;
    }
  }, []);

  useEffect(() => {
    void cargarEstado();
  }, [cargarEstado]);

  // los datos (y el plan) salen del espacio del usuario: si cambio la cuenta,
  // se recargan solos
  useEffect(() => {
    if (!cuenta) return;
    if (cuenta.enUso === "ninguna") {
      setDatos(null);
      setPlan({});
      setGanancias(null);
      setCargando(false);
      return;
    }
    void cargar(dias);
    anuncios
      .plan()
      .then((r) => setPlan(r.plan ?? {}))
      .catch(() => undefined);
  }, [cuenta, dias, cargar]);

  // el traedor de ganancias tarda (una llamada por producto): se sondea cada
  // 2 s y, cuando termina, se recargan los datos con los promedios frescos
  useEffect(() => {
    if (!ganancias?.enCurso) return;
    const id = window.setInterval(() => {
      void (async () => {
        const g = await refrescarGanancias();
        if (!g || g.enCurso) return;
        window.clearInterval(id);
        if (g.ultimo?.estado === "error") toast.error(g.ultimo.error ?? "Falló el traedor");
        else toast.success("Ganancias de pedidos actualizadas");
        await cargar(dias);
      })();
    }, 2000);
    return () => window.clearInterval(id);
  }, [ganancias?.enCurso, refrescarGanancias, cargar, dias, toast]);

  const refrescar = async () => {
    setActualizando(true);
    setError(null);
    try {
      const r = await anuncios.actualizar(dias);
      toast.success(r.msg ?? "Datos actualizados");
      await cargar(dias);
    } catch (e) {
      setError(errMsg(e));
      toast.error(errMsg(e));
    } finally {
      setActualizando(false);
    }
  };

  const guardarGanancia = async (nombre: string, ganancia: number) => {
    setGuardando(true);
    try {
      await anuncios.guardarGanancia(nombre, ganancia);
      toast.success(`Ganancia de ${nombre}: ${dinero(ganancia)}`);
      await cargar(dias);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGuardando(false);
    }
  };

  /** Pide las ganancias reales de los pedidos (corre en el servidor). */
  const traerGanancias = async () => {
    try {
      const g = await anuncios.traerGanancias({ forzar: true });
      setGanancias(g);
      toast.success(
        g.enCurso
          ? "Trayendo las ganancias de tus pedidos…"
          : g.ultimo?.estado === "error"
            ? g.ultimo.error ?? "No se pudieron traer"
            : "Ganancias de pedidos al día",
      );
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Enciende/apaga el recalculo automatico (una vez al día). */
  const ajustarGanancias = async (a: Partial<AjustesGanancias>) => {
    try {
      const r = await anuncios.ajustesGanancias(a);
      setGanancias((g) => (g ? { ...g, ajustes: r.ajustes } : g));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Agrega los productos de la tienda activa que falten. */
  const importarProductos = async () => {
    try {
      const r = await anuncios.importarProductos();
      toast.success(
        r.nuevos
          ? `${r.nuevos} producto(s) nuevos de la tienda #${r.tienda}`
          : `Ya tenías todos los productos de la tienda #${r.tienda}`,
      );
      await cargar(dias);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Vincula una campaña a su producto (o la desvincula). */
  const vincular = async (campana: string, productos: string[]) => {
    try {
      await anuncios.vincular(campana, productos);
      toast.success(productos.length ? `Vinculada a ${productos.join(" + ")}` : "Vínculo quitado");
      await cargar(dias);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** Efectividad de entrega (automatica o a mano). */
  const guardarEntrega = async (v: { modo?: "auto" | "manual"; tasa?: number; contarSinEnvio?: boolean }) => {
    try {
      await anuncios.guardarEntrega(v);
      await cargar(dias);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const marcarPlan = async (id: string, hecho: boolean) => {
    const anterior = plan;
    setPlan({ ...anterior, [id]: { ...anterior[id], hecho } }); // optimista
    try {
      await anuncios.marcar(id, { hecho });
    } catch (e) {
      setPlan(anterior);
      toast.error(errMsg(e));
    }
  };

  const exportar = async () => {
    try {
      await anuncios.csv(dias, csv);
      toast.success("CSV descargado");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /** El PDF sale del navegador: primero muestra el Reporte y luego imprime. */
  const imprimir = () => {
    setPestana("reporte");
    setTimeout(() => window.print(), 150);
  };

  // las pestañas solo cuentan lo que esta en alerta REAL: campana encendida y
  // con dias suficientes (las pausadas o de 1 dia no se juzgan)
  const alertas = datos ? datos.campanas.filter((c) => c.alerta).length : 0;
  const pendientes = datos
    ? datos.campanas.filter((c) => c.alerta && !plan[c.id]?.hecho).length
    : 0;

  const pestanas: Array<{ id: Pestana; label: string; badge?: number }> = [
    { id: "resumen", label: "Resumen" },
    { id: "alertas", label: "Alertas", badge: alertas },
    { id: "campanas", label: "Campañas", badge: datos?.totales.campanas },
    { id: "productos", label: "Productos", badge: datos?.productos.length },
    { id: "cuentas", label: "Cuentas", badge: datos?.cuentas.length },
    { id: "reporte", label: "Reporte" },
  ];
  const descripcionPestana: Record<Pestana, string> = {
    resumen: "Mira de un vistazo cuánto inviertes y qué resultado estimado generan tus campañas.",
    alertas: "Empieza por las campañas activas que necesitan una decisión; marca cada tarea al resolverla.",
    campanas: "Busca, filtra y ordena tus campañas para revisar su rendimiento en detalle.",
    productos: "Ajusta la ganancia por pedido. El promedio real de LucidSales es una sugerencia que puedes adoptar.",
    cuentas: "Compara inversión y rentabilidad entre las cuentas incluidas en este análisis.",
    reporte: "Consulta las cifras y recomendaciones de esta ventana en un formato listo para imprimir.",
  };

  return (
    <div className="anuncios-page">
      <PageHeader
        title="Rentabilidad de anuncios"
        subtitle={
          datos
            ? `Meta atribuye ${datos.totales.compras} compras a ${dinero(datos.totales.gasto)} de anuncios en ${datos.ventana.dias} días · ${haceCuanto(datos.generado)}`
            : "Compras de Meta × ganancia promedio por producto"
        }
        actions={
          <div className="ads-acciones">
            <button
              type="button"
              className="btn sm ads-account-button"
              onClick={() => setModalCuenta(true)}
              title="Conectar o cambiar mi cuenta de Meta"
            >
              {cuenta?.enUso === "propia" ? "Mi cuenta Meta" : "Conectar Meta"}
            </button>
            <div className="ads-actions-group">
              <div className="ads-periodo" role="group" aria-label="Ventana de días">
                {PERIODOS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`btn sm${dias === p ? " primary" : ""}`}
                    onClick={() => setDias(p)}
                  >
                    {p} días
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn sm"
                onClick={() => void refrescar()}
                disabled={actualizando}
              >
                {actualizando ? "Actualizando…" : "↻ Actualizar"}
              </button>
            </div>
            <div className="ads-actions-group ads-export-group">
              <select
                className="field ads-csv-select"
                value={csv}
                onChange={(e) => setCsv(e.target.value as VistaCsv)}
                aria-label="Vista del CSV"
              >
                {CSV_VISTAS.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <button type="button" className="btn sm" onClick={() => void exportar()}>
                Descargar CSV
              </button>
              <button type="button" className="btn sm" onClick={imprimir}>
                Imprimir PDF
              </button>
            </div>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {cuenta?.enUso === "propia" && datos ? (
        <PasosConfiguracion
          datos={datos}
          ganancias={ganancias}
          onCuentas={() => setModalCuenta(true)}
          onIr={(p) => setPestana(p)}
          onImportar={importarProductos}
          onTraer={traerGanancias}
        />
      ) : null}

      {cuenta?.enUso === "propia" && !cuenta.cuentas.some((c) => c.seleccionada) ? (
        <div className="banner warn">
          Conectaste tu cuenta pero todavía no elegiste qué cuentas entran al análisis.{" "}
          <button type="button" className="btn sm" onClick={() => setModalCuenta(true)}>
            Elegir cuentas
          </button>
        </div>
      ) : null}

      {datos?.aviso ? <div className="banner warn">{datos.aviso}</div> : null}

      <section className="ads-workspace">
        {cuenta && cuenta.enUso !== "ninguna" && datos ? (
          <header className="ads-view-heading">
            <div>
              <h2>{pestanas.find((p) => p.id === pestana)?.label}</h2>
              <p>{descripcionPestana[pestana]}</p>
            </div>
            <span className="ads-data-source">{datos.fuente === "snapshot" ? "Datos de respaldo" : "Meta Ads"}</span>
          </header>
        ) : null}
        {cuenta && cuenta.enUso !== "ninguna" ? (
          <div className="tabs" role="tablist" aria-label="Secciones de rentabilidad">
            {pestanas.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pestana === p.id}
                className={`tab${pestana === p.id ? " active" : ""}`}
                onClick={() => setPestana(p.id)}
              >
                {p.label}
                {p.badge !== undefined && p.badge > 0 ? <span className="ads-tab-badge">{p.badge}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {cuenta && cuenta.enUso === "ninguna" ? (
          <div className="ads-vacio">
            <h3>Conecta tu cuenta de Meta</h3>
            <p className="muted">
              Para ver la rentabilidad de tus campañas: 1) conecta tu token de Meta y elige tus
              cuentas publicitarias, 2) importa los productos de tu tienda, 3) trae la ganancia real
              de tus pedidos y 4) vincula cada campaña a su producto. Todo queda en tu espacio,
              separado de los demás usuarios del panel.
            </p>
            <button type="button" className="btn primary" onClick={() => setModalCuenta(true)}>
              Conectar mi cuenta
            </button>
          </div>
        ) : null}

        {cargando && !datos ? <Spinner label="Consultando Meta…" /> : null}
        {cargando && datos ? <p className="muted small">Actualizando…</p> : null}

        {!cargando && datos && pestana === "resumen" ? <Resumen datos={datos} /> : null}

        {!cargando && datos && pestana === "alertas" ? (
          <>
            {pendientes ? (
              <div className="banner warn">
                <strong>{pendientes} acción(es) pendientes.</strong> Marcá “Hecho” cuando la
                ejecutes: queda guardado en el servidor.
              </div>
            ) : (
              <div className="banner ok">Todas las alertas están marcadas como hechas.</div>
            )}
            <Alertas datos={datos} plan={plan} onMarcar={(id, hecho) => void marcarPlan(id, hecho)} />
          </>
        ) : null}

        {!cargando && datos && pestana === "campanas" ? (
          <Campanas
            datos={datos}
            plan={plan}
            onMarcar={(id, hecho) => void marcarPlan(id, hecho)}
            onVincular={vincular}
          />
        ) : null}

        {!cargando && datos && pestana === "productos" ? (
          <Productos
            datos={datos}
            onGuardar={guardarGanancia}
            guardando={guardando}
            ganancias={ganancias}
            onTraer={traerGanancias}
            onAjustes={ajustarGanancias}
            onImportar={importarProductos}
            onEntrega={guardarEntrega}
          />
        ) : null}

        {!cargando && datos && pestana === "cuentas" ? (
          <div className="ads-cuentas">
            {datos.cuentas.map((c) => (
              <section key={c.nombre} className="card">
                <h3 className="card-title">
                  {c.nombre} <span className="muted small">({c.moneda})</span>
                </h3>
                <div className="stat-grid ads-kpis">
                  <div className="stat-card">
                    <span className="stat-label">Gasto</span>
                    <span className="stat-value">{dinero(c.gasto)}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Compras</span>
                    <span className="stat-value">{c.compras}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">CPA</span>
                    <span className="stat-value">{c.cpa === null ? "—" : dinero(c.cpa)}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Margen</span>
                    <span className="stat-value">{dinero(c.margen)}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Neto</span>
                    <span className={`stat-value${c.neto < 0 ? " ads-malo" : " ads-bueno"}`}>
                      {dinero(c.neto)}
                    </span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">ROI</span>
                    <span className="stat-value">{veces(c.roi)}</span>
                  </div>
                </div>
                <div className="ads-chips">
                  {CLASES.map((k) => (
                    <span key={k} className={`ads-chip ${CLASE_CLS[k]}`}>
                      {ETIQUETAS[k]} <strong>{c.conteos[k] ?? 0}</strong>
                    </span>
                  ))}
                </div>
                <p className="muted small">
                  {c.campanas} campaña(s) · pérdida acumulada{" "}
                  <strong className={c.perdidas < 0 ? "ads-malo" : ""}>{dinero(c.perdidas)}</strong>
                </p>
              </section>
            ))}
          </div>
        ) : null}

        {!cargando && datos && pestana === "reporte" ? <Reporte datos={datos} /> : null}
      </section>

      <p className="muted small ads-pie">
        <strong>Cómo se calcula:</strong> margen = compras de Meta (omni_purchase, sin duplicar) ×
        ganancia por pedido entregado × efectividad de entrega · neto = margen − gasto · ROI =
        margen / gasto · CPA = gasto / compras. Una campaña de varios productos reparte su gasto y
        sus compras entre ellos. Rentable ≥ 3x · Ajustada 1,5–3x · Por vigilar &lt; 1,5x con neto
        positivo · Pérdida con neto negativo · Sin dato cuando la campaña no tiene producto o el
        producto no tiene ganancia (ese gasto no entra en el neto).
        {datos ? (
          <>
            {" "}
            · Ventana {datos.ventana.desde} → {datos.ventana.hasta} · efectividad{" "}
            {Math.round(datos.entrega.tasa * 100)}% · TRM {datos.trm.toLocaleString("es-CO")}
            {datos.fuente === "snapshot" ? " · respaldo local (Meta no respondió)" : ""} ·{" "}
            {haceCuanto(datos.generado)}
          </>
        ) : null}
      </p>

      <ConectarCuenta
        open={modalCuenta}
        estado={cuenta}
        onClose={() => setModalCuenta(false)}
        onCambio={() => void cargarEstado()}
      />
    </div>
  );
}

type PasoId = "cuentas" | "productos" | "ganancias" | "vincular";

/**
 * Lo que le falta a este usuario para que los numeros sean confiables. Se
 * esconde solo cuando todo esta listo.
 */
function PasosConfiguracion({ datos, ganancias, onCuentas, onIr, onImportar, onTraer }: {
  datos: Datos;
  ganancias: EstadoGanancias | null;
  onCuentas: () => void;
  onIr: (p: Pestana) => void;
  onImportar: () => Promise<void>;
  onTraer: () => Promise<void>;
}) {
  const productos = datos.productos.length + datos.productosSinCampana.length;
  const pasos: Array<{ id: PasoId; listo: boolean; titulo: string; detalle: string; boton: string; accion: () => void }> = [
    {
      id: "cuentas",
      listo: datos.cuentas.length > 0,
      titulo: "Elige tus cuentas publicitarias",
      detalle: "Las cuentas de Meta que entran al análisis.",
      boton: "Elegir cuentas",
      accion: onCuentas,
    },
    {
      id: "productos",
      listo: productos > 0,
      titulo: "Importa tus productos",
      detalle: "Del catálogo de la tienda que tienes activa en el panel.",
      boton: "Importar",
      accion: () => void onImportar(),
    },
    {
      id: "ganancias",
      listo: datos.entrega.origen !== "sin datos" && !datos.totales.campanasSinGanancia,
      titulo: "Trae la ganancia de tus pedidos",
      detalle: "Ganancia real por pedido entregado y efectividad de entrega.",
      boton: ganancias?.enCurso ? "Calculando…" : "Traer ganancias",
      accion: () => {
        onIr("productos");
        if (!ganancias?.enCurso) void onTraer();
      },
    },
    {
      id: "vincular",
      listo: datos.totales.campanasSinProducto === 0,
      titulo: "Vincula tus campañas",
      detalle: datos.totales.campanasSinProducto
        ? `${datos.totales.campanasSinProducto} campaña(s) sin producto.`
        : "Cada campaña con su producto.",
      boton: "Vincular",
      accion: () => onIr("campanas"),
    },
  ];
  if (pasos.every((p) => p.listo)) return null;
  return (
    <section className="card ads-pasos">
      <h3 className="card-title">Termina de configurar tu análisis</h3>
      <ol>
        {pasos.map((p) => (
          <li key={p.id} className={p.listo ? "listo" : ""}>
            <span className="ads-paso-marca" aria-hidden="true">{p.listo ? "✓" : ""}</span>
            <span className="ads-paso-texto">
              <strong>{p.titulo}</strong>
              <span className="muted small">{p.detalle}</span>
            </span>
            {!p.listo ? (
              <button type="button" className="btn sm" onClick={p.accion} disabled={p.id === "ganancias" && ganancias?.enCurso}>
                {p.boton}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
