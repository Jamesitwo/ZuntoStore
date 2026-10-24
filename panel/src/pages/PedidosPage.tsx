import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg, pickArray } from "../api/client";
import { backend, backendSuave } from "../api/backend";
import {
  ESTADOS_PEDIDO,
  ESTADOS_PEDIDO_FILTRO,
  cambiarEstadoPedido,
  pedidos,
  usuarios,
  type Filtro,
} from "../api/endpoints";
import { claseEstado, LeyendaEstados, ErrorBanner, JsonTable, PageHeader, Spinner, money } from "../components/ui";
import { ConfirmDialog, Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { claveTelefono, fmtFecha, haceCuanto, telefono } from "../lib/format";
import { EnvioConBot, normalizarEstado, useEstadosEnvioBot } from "../components/EnvioLucidBot";
import { useEtiquetaTienda } from "../lib/tiendas";
import { useInboxBot } from "../lib/botInbox";
import { useEtiquetas } from "../lib/etiquetas";
import {
  ChipsDeEtiquetas,
  GestorEtiquetas,
  PickerEtiquetas,
} from "../components/Etiquetas";

interface PedidoLight {
  id: number;
  idPedido: number;
  Nombre?: string;
  Apellido?: string;
  Movil?: string;
  Correo?: string;
  EstadoPedido?: number;
  /** Estado del envio (asi lo llama el API, con esa grafia) */
  EstadoFullfilment?: string | null;
  /** Producto(s) del pedido, tal como lo trae la lista (campo `producto`) */
  producto?: string | null;
  transportadora?: string | null;
  Total?: string;
  Fecha?: string;
  CreatedAt?: string;
}

interface FiltrosUI {
  estado: string;
  estadoEnvio: string;
  origen: string;
  cliente: string;
  producto: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: FiltrosUI = {
  estado: "",
  estadoEnvio: "",
  origen: "",
  cliente: "",
  producto: "",
  desde: "",
  hasta: "",
};

/** El correo es el identificador que usa el backend para horarios y reparto. */
const claveUsuario = (u: any) => String(u?.Usuario ?? u?.Correo ?? "").trim().toLowerCase();

export function PedidosPage() {
  const { session } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  // Acceso directo: /pedidos?estado=... o /pedidos?cliente=<nombre>
  // (el segundo enlace viene de la lista de Clientes, ver ClientesPage).
  // Con `&tel=` ademas se recorta la lista a ese telefono: la API no filtra
  // por telefono, asi que el filtro `customer` (por nombre) trae tambien
  // homónimos y aqui se dejan fuera.
  const estadoDeUrl = searchParams.get("estado") ?? "";
  const clienteDeUrl = searchParams.get("cliente") ?? "";
  const telDeUrl = searchParams.get("tel") ?? "";
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();
  const inbox = useInboxBot();
  const et = useEtiquetas();

  const [rows, setRows] = useState<PedidoLight[]>([]);
  // estado del envio que manda Lucid Bot (pedidos que en LucidSales siguen "Sin Envio")
  const enviosBot = useEstadosEnvioBot(rows);
  const [total, setTotal] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(telDeUrl ? 200 : 50);

  /**
   * Paginas reales: no todas las respuestas traen `numPages` (o vienen en 0),
   * y si pasa eso el boton "Siguiente" se queda pinchado aunque haya mas
   * registros. Se calcula tambien con totalRecords / por_pagina y se toma el
   * mayor de los dos; y si no viene ninguno de los dos pero la pagina vino
   * llena, se permite avanzar una mas (la siguiente respuesta ya dira si hay).
   */
  const paginasTotal = Math.max(
    numPages,
    itemsPerPage > 0 && total > 0 ? Math.ceil(total / itemsPerPage) : 0,
    rows.length >= itemsPerPage && itemsPerPage > 0 ? page + 1 : 0,
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filtros, setFiltros] = useState<FiltrosUI>({
    ...FILTROS_VACIOS,
    estado: estadoDeUrl,
    cliente: clienteDeUrl,
  });
  const [abrirFiltros, setAbrirFiltros] = useState(Boolean(estadoDeUrl || clienteDeUrl));
  const [opciones, setOpciones] = useState<{
    fulfillmentStatuses: string[];
    sources: string[];
    customers: string[];
  }>({ fulfillmentStatuses: [], sources: [], customers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Accion rapida: pedido y estado destino del modal de cambio
  const [cambio, setCambio] = useState<{ pedido: PedidoLight; nuevo: number } | null>(null);
  const [guardandoId, setGuardandoId] = useState<number | null>(null);

  // Etiquetas (funcion propia, local): filtro + modales
  const [filtroEtiqueta, setFiltroEtiqueta] = useState("");
  const [gestorAbierto, setGestorAbierto] = useState(false);
  const [pickerPara, setPickerPara] = useState<{
    id: string | number;
    numero: string | number;
  } | null>(null);

  // Asignaciones de pedidos (backend propio): quién le toca cada uno
  const [asig, setAsig] = useState<Record<string, { usuario: string; nombre?: string }>>({});
  const [notaAsig, setNotaAsig] = useState<string | null>(null);
  const [recargaAsig, setRecargaAsig] = useState(0);

  // Reparto manual desde la lista
  const [repartoAbierto, setRepartoAbierto] = useState(false);
  const [modoReparto, setModoReparto] = useState<"todos" | "horario">("todos");
  const [soloSin, setSoloSin] = useState(true);
  const [usuariosReparto, setUsuariosReparto] = useState<any[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(false);
  const [errReparto, setErrReparto] = useState<string | null>(null);
  const [repartiendo, setRepartiendo] = useState(false);

  // asignacion individual: asignar o cambiar UN pedido de mano a mano
  const [asignando, setAsignando] = useState<PedidoLight | null>(null);
  const [usuariosAsig, setUsuariosAsig] = useState<any[]>([]);
  const [selAsig, setSelAsig] = useState("");
  const [buscaUs, setBuscaUs] = useState("");
  const [cargandoUsAsig, setCargandoUsAsig] = useState(false);
  const [asignandoOk, setAsignandoOk] = useState(false);
  const [errAsig, setErrAsig] = useState<string | null>(null);

  /**
   * Filtro LOCAL de asignacion (la API no sabe quien le toca cada pedido):
   *   "" = todos · "_sin" = sin asignar · "_mi" = asignados a mi ·
   *   o el correo de un usuario concreto.
   */
  const [filtroAsign, setFiltroAsign] = useState("");
  // estado del envio que manda Lucid Bot (filtro local, como el de etiqueta)
  const [filtroEnvio, setFiltroEnvio] = useState("");
  const [estadosBot, setEstadosBot] = useState<Array<{ estado: string; avisos: number }>>([]);
  useEffect(() => {
    void backendSuave<{ ok: boolean; estados?: Array<{ estado: string; avisos: number }> }>("/api/envios/estados").then(
      (r) => {
        if (r?.ok) setEstadosBot(r.estados ?? []);
      },
    );
  }, []);

  // Busqueda instantanea (sin pulsar Boton)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch((s) => (s === searchInput.trim() ? s : searchInput.trim()));
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Valores de los filtros select vienen de get-filters-data
  useEffect(() => {
    pedidos
      .filtersData(idEmpresa)
      .then((res: any) => {
        const fd = res?.filtersData ?? {};
        setOpciones({
          fulfillmentStatuses: fd.fulfillmentStatuses ?? [],
          sources: fd.sources ?? [],
          customers: fd.customers ?? [],
        });
      })
      .catch(() => {
        /* los filtros select quedan vacios; el resto funciona igual */
      });
  }, [idEmpresa]);

  // Construccion del array `filters` segun el formato real de la API
  const filtersJson = useMemo(() => {
    const arr: Filtro[] = [
      {
        name: "date",
        searchValues:
          filtros.desde && filtros.hasta
            ? [`${new Date(filtros.desde).toISOString()}|${new Date(filtros.hasta).toISOString()}`]
            : [],
        sortOrder,
      },
    ];
    const add = (name: string, value: string) => {
      if (value) arr.push({ name, searchValues: [value], sortOrder: null });
    };
    add("orderStatus", filtros.estado);
    add("fulfillmentStatus", filtros.estadoEnvio);
    add("source", filtros.origen);
    add("customer", filtros.cliente);
    add("product", filtros.producto);
    return JSON.stringify(arr);
  }, [filtros, sortOrder]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);

    // `&tel=` (viene del recuento de Clientes) solo recorta mientras el filtro
    // de cliente sigue siendo el que trajo ese telefono; si el usuario lo cambia
    // o lo limpia, la lista vuelve a ser la del filtro Cliente tal cual.
    pedidos
      .list({ idEmpresa, page, itemsPerPage, search, filters: filtersJson })
      .then((res: any) => {
        if (cancel) return;
        let filas = Array.isArray(res?.pedidos) ? res.pedidos : [];
        if (telActivo) filas = filas.filter((p: any) => claveTelefono(p?.Movil) === telDeUrl);
        setRows(filas);
        setTotal(Number(res?.totalRecords) || 0);
        setNumPages(Number(res?.numPages) || 0);
        // deja la lista a mano para moverse entre pedidos desde el detalle
        try {
          const ids = filas
            .map((p: any) => p.id ?? p.idPedido)
            .filter((v: any) => v !== undefined && v !== null);
          sessionStorage.setItem("pedidosNav", JSON.stringify(ids));
        } catch {
          /* sessionStorage no disponible */
        }
      })
      .catch((err) => {
        if (!cancel) setError(errMsg(err));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [idEmpresa, page, itemsPerPage, search, filtersJson]);

  // Asignaciones de esta tienda (backend propio; si no responde, la lista
  // funciona igual y solo no se muestra la columna Asignado).
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const r = await backendSuave<any>(`/api/asignacion?idEmpresa=${idEmpresa}`);
      if (cancel) return;
      if (!r || r.ok === false) {
        setAsig({});
        setNotaAsig(
          (r && typeof r.msg === "string" && r.msg) ||
            "Backend propio no disponible: aqui no se veran las asignaciones (arranca server/ con npm start).",
        );
        return;
      }
      setAsig((r.asignaciones ?? {}) as any);
      setNotaAsig(null);
    })();
    return () => {
      cancel = true;
    };
  }, [idEmpresa, recargaAsig]);

  // Usuarios de la tienda: rellenan el filtro "Asignacion" (y el modal de
  // asignar, que si hace falta vuelve a pedirlos).
  useEffect(() => {
    let cancel = false;
    usuarios
      .list({ page: 1, itemsPerPage: 100, search: "" })
      .then((r: any) => {
        if (cancel) return;
        const filas = Array.isArray(r?.usuarios) ? r.usuarios : pickArray(r, ["usuarios"]);
        setUsuariosAsig(filas);
      })
      .catch(() => {
        /* sin usuarios el filtro solo ofrece Todos / Sin asignar / Mi */
      });
    return () => {
      cancel = true;
    };
  }, []);

  /** Mi correo (el backend guarda las asignaciones en minusculas). */
  const miCorreo = String(session?.user?.email ?? "").trim().toLowerCase();

  const setFiltro = (key: keyof FiltrosUI, value: string) => {
    setPage(1);
    setFiltros((f) => ({ ...f, [key]: value }));
  };

  const limpiarFiltros = () => {
    setPage(1);
    setFiltros(FILTROS_VACIOS);
    setFiltroAsign("");
    setFiltroEnvio("");
    setSearchInput("");
    setSearch("");
  };

  const hayFiltros =
    Object.values(filtros).some(Boolean) || search || Boolean(filtroAsign) || Boolean(filtroEnvio);
  /** El recorte por telefono solo vale mientras el filtro de cliente esta intacto. */
  const telActivo = Boolean(telDeUrl) && filtros.cliente.trim() === clienteDeUrl.trim();

  // Filtro por etiqueta: es local (la API no conoce estas etiquetas),
  // por eso se aplica sobre los pedidos ya cargados en esta pagina.
  // El de asignacion tambien: las asignaciones las guarda NUESTRO backend,
  // la API de LucidSales no sabe nada de ellas.
  const rowsVisibles = useMemo(() => {
    let out = filtroEtiqueta
      ? rows.filter((p) => et.tiene(p.id ?? p.idPedido, filtroEtiqueta))
      : rows;
    if (filtroAsign) {
      out = out.filter((p) => {
        const a = asig[String(p.id ?? p.idPedido)];
        const quien = String(a?.usuario ?? "").toLowerCase();
        if (filtroAsign === "_sin") return !a;
        if (filtroAsign === "_mi") return Boolean(a) && quien === miCorreo;
        return Boolean(a) && quien === filtroAsign;
      });
    }
    if (filtroEnvio) {
      out = out.filter((p) => {
        const e = enviosBot[String(p.id ?? p.idPedido)];
        if (filtroEnvio === "_sin") return !e;
        if (filtroEnvio === "_con") return Boolean(e);
        return Boolean(e) && normalizarEstado(e.estado) === filtroEnvio;
      });
    }
    return out;
  }, [rows, filtroEtiqueta, et, filtroAsign, asig, miCorreo, filtroEnvio, enviosBot]);

  /** Texto del filtro de asignacion para avisos ("asignados a Ana", ...). */
  const etiquetaFiltroAsign =
    filtroAsign === "_sin"
      ? "sin asignación"
      : filtroAsign === "_mi"
        ? "asignados a ti"
        : filtroAsign
          ? `asignados a ${
              usuariosAsig.find((u) => claveUsuario(u) === filtroAsign)?.Nombre || filtroAsign
            }`
          : "";

  /** Mensaje cuando el filtro deja la pagina vacia. */
  const mensajeVacioAsign =
    filtroAsign === "_sin"
      ? "Todos los pedidos de esta página ya tienen asignación."
      : filtroAsign === "_mi"
        ? "Ningún pedido de esta página está asignado a ti."
        : filtroAsign
          ? `Ningún pedido de esta página está asignado a ${
              usuariosAsig.find((u) => claveUsuario(u) === filtroAsign)?.Nombre || filtroAsign
            }.`
          : filtroEnvio
            ? "Ningún pedido de esta página tiene ese estado de envío en Lucid Bot."
            : "Ningun pedido de esta pagina tiene la etiqueta seleccionada.";

  /**
   * Cambio de estado desde la tabla: la API exige el cuerpo completo,
   * asi que primero se carga el pedido y se reenvia con el override.
   */
  const aplicarCambio = async (motivo?: string) => {
    if (!cambio) return;
    const { pedido, nuevo } = cambio;
    setGuardandoId(pedido.id);
    try {
      // viaja por NUESTRO backend (server/); si no responde usa la API directa
      const r = await cambiarEstadoPedido(pedido.id, nuevo, nuevo === 1 ? motivo : undefined, {
        quien: session?.user?.name ?? session?.user?.email ?? undefined,
      });

      setRows((arr) =>
        arr.map((row) => (row.id === pedido.id ? { ...row, EstadoPedido: nuevo } : row)),
      );
      toast.success(
        `#${pedido.idPedido}: ${ESTADOS_PEDIDO[nuevo]}${r.directo ? " · API directa" : ""}`,
      );
      setCambio(null);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setGuardandoId(null);
    }
  };

  /* -------- reparto de pedidos (backend propio) -------- */
  const abrirReparto = async () => {
    setErrReparto(null);
    setRepartoAbierto(true);
    setCargandoUsuarios(true);
    try {
      const r: any = await usuarios.list({ page: 1, itemsPerPage: 50, search: "" });
      const filas = pickArray(r, ["usuarios"]);
      setUsuariosReparto(filas);
      // por defecto: los activos
      setSeleccion(
        filas
          .filter((u) => u.activo !== false && u.activo !== 0 && u.activo !== "0")
          .map((u) => claveUsuario(u)),
      );
    } catch (e) {
      setErrReparto(errMsg(e));
    } finally {
      setCargandoUsuarios(false);
    }
  };

  const ejecutarReparto = async () => {
    const ids = rowsVisibles
      .map((p) => p.id ?? p.idPedido)
      .filter((v) => v !== undefined && v !== null);
    const elegidos = usuariosReparto.filter((u) => seleccion.includes(claveUsuario(u)));
    if (!elegidos.length) {
      setErrReparto("Marca al menos un usuario participante");
      return;
    }
    if (!ids.length) {
      setErrReparto("No hay pedidos en esta pagina para repartir");
      return;
    }
    setRepartiendo(true);
    setErrReparto(null);
    try {
      const r: any = await backend("/api/asignacion/repartir", {
        method: "POST",
        body: {
          idEmpresa,
          modo: modoReparto,
          reasignar: !soloSin,
          usuarios: elegidos.map((u) => ({
            usuario: claveUsuario(u),
            nombre: u.Nombre || u.Usuario,
          })),
          pedidos: ids,
        },
      });
      const n = Array.isArray(r?.reparto) ? r.reparto.length : 0;
      const omit = Array.isArray(r?.omitidos) ? r.omitidos.length : 0;
      const totales = Object.entries((r?.totales ?? {}) as Record<string, number>)
        .map(([k, v]) => `${String(k).split("@")[0]}: ${v}`)
        .join(" · ");
      toast.success(
        n
          ? `${n} pedido(s) repartidos${totales ? ` (${totales})` : ""}${
              omit ? ` · ${omit} omitidos` : ""
            }`
          : `No se repartio ninguno${omit ? ` (${omit} omitidos: ya asignados)` : ""}`,
      );
      setRepartoAbierto(false);
      setRecargaAsig((x) => x + 1);
    } catch (e) {
      const m = errMsg(e);
      setErrReparto(m);
      toast.error(m);
    } finally {
      setRepartiendo(false);
    }
  };

  const desasignar = async (id: string | number) => {
    try {
      await backend(`/api/asignacion/pedido/${encodeURIComponent(String(id))}`, {
        method: "DELETE",
      });
      setRecargaAsig((x) => x + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  /**
   * Asignar (o cambiar) UN pedido a UN usuario: mismo endpoint del reparto pero
   * en modo "manual", que respeta la eleccion aunque el horario este pausado o
   * el usuario este fuera de turno.
   */
  const abrirAsignacion = async (p: PedidoLight) => {
    const actual = asig[String(p.id ?? p.idPedido)];
    setAsignando(p);
    setErrAsig(null);
    setBuscaUs("");
    setSelAsig(actual?.usuario ?? "");
    setCargandoUsAsig(true);
    try {
      const r: any = await usuarios.list({ page: 1, itemsPerPage: 100, search: "" });
      const filas = pickArray(r, ["usuarios"]);
      setUsuariosAsig(filas);
      if (!actual && filas.length) {
        const primero = filas.find(
          (u: any) => u.activo !== false && u.activo !== 0 && u.activo !== "0",
        );
        setSelAsig(primero ? claveUsuario(primero) : "");
      }
    } catch (e) {
      setErrAsig(errMsg(e));
    } finally {
      setCargandoUsAsig(false);
    }
  };

  const asignarIndividual = async () => {
    const p = asignando;
    if (!p || !selAsig) {
      setErrAsig("Elige un usuario");
      return;
    }
    const u = usuariosAsig.find((x) => claveUsuario(x) === selAsig);
    const nombre = u?.Nombre || u?.Usuario || selAsig;
    setAsignandoOk(true);
    setErrAsig(null);
    try {
      await backend("/api/asignacion/repartir", {
        method: "POST",
        body: {
          idEmpresa,
          modo: "manual",
          reasignar: true,
          usuarios: [{ usuario: selAsig, nombre }],
          pedidos: [p.id ?? p.idPedido],
        },
      });
      toast.success(`Pedido #${p.idPedido ?? p.id} asignado a ${nombre}`);
      setAsignando(null);
      setRecargaAsig((x) => x + 1);
    } catch (e) {
      const m = errMsg(e);
      setErrAsig(m);
      toast.error(m);
    } finally {
      setAsignandoOk(false);
    }
  };

  function selectorEstado(p: (typeof rowsVisibles)[number]) {
    return (
      <select
        className={`estado-select ${claseEstado(p.EstadoPedido ?? 0)}`}
        value={p.EstadoPedido ?? 0}
        disabled={guardandoId === p.id}
        onChange={(e) => {
          const nuevo = Number(e.target.value);
          if (nuevo === p.EstadoPedido) return;
          if (nuevo === 1) {
            // cancelar siempre pide motivo
            setCambio({ pedido: p, nuevo });
            e.target.value = String(p.EstadoPedido ?? 0);
          } else {
            setCambio({ pedido: p, nuevo });
          }
        }}
      >
        {Object.entries(ESTADOS_PEDIDO).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={`${total.toLocaleString("es-CO")} pedidos · ${etiqueta(idEmpresa)}`}
        actions={
          <>
            <button className="btn" onClick={() => setGestorAbierto(true)}>
              🏷 Etiquetas
            </button>
            <button className="btn" onClick={() => setAbrirFiltros((v) => !v)}>
              Filtros {hayFiltros ? "· activos" : ""}
            </button>
            <button
              className="btn"
              onClick={() => void abrirReparto()}
              title="Repartir los pedidos de esta pagina entre los usuarios"
            >
              ♻ Asignar pedidos
            </button>
            <Link className="btn primary" to="/pedidos/nuevo">
              + Nuevo pedido
            </Link>
          </>
        }
      />

      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor="search">Buscar</label>
          <input
            id="search"
            placeholder="Escribe para buscar…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="orden">Orden fecha</label>
          <select
            id="orden"
            value={sortOrder}
            onChange={(e) => {
              setPage(1);
              setSortOrder(e.target.value as "asc" | "desc");
            }}
          >
            <option value="desc">Mas recientes</option>
            <option value="asc">Mas antiguos</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="porpagina">Por pagina</label>
          <select
            id="porpagina"
            value={itemsPerPage}
            onChange={(e) => {
              setPage(1);
              setItemsPerPage(Number(e.target.value));
            }}
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-etiqueta" title="Filtro local: aplica a los pedidos de esta pagina">
            Etiqueta
          </label>
          <select
            id="f-etiqueta"
            value={filtroEtiqueta}
            onChange={(e) => {
              setPage(1);
              setFiltroEtiqueta(e.target.value);
            }}
          >
            <option value="">Todas</option>
            {et.etiquetas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label
            htmlFor="f-asignado"
            title="Filtro local: las asignaciones las guarda nuestro backend, la API no las conoce"
          >
            Asignación
          </label>
          <select
            id="f-asignado"
            value={filtroAsign}
            onChange={(e) => {
              setPage(1);
              setFiltroAsign(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="_sin">Sin asignar</option>
            <option value="_mi">Asignados a mí</option>
            {usuariosAsig.map((u) => {
              const k = claveUsuario(u);
              if (!k) return null;
              return (
                <option key={k} value={k}>
                  {u.Nombre || k}
                </option>
              );
            })}
          </select>
        </div>
        <div className="field">
          <label
            htmlFor="f-envio-bot"
            title="Filtro local: los estados de envío que manda Lucid Bot los guarda nuestro backend"
          >
            Envío (Lucid Bot)
          </label>
          <select
            id="f-envio-bot"
            value={filtroEnvio}
            onChange={(e) => {
              setPage(1);
              setFiltroEnvio(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="_con">Con estado de Lucid Bot</option>
            <option value="_sin">Sin estado de Lucid Bot</option>
            {estadosBot.map((x) => (
              <option key={normalizarEstado(x.estado)} value={normalizarEstado(x.estado)}>
                {x.estado}
              </option>
            ))}
          </select>
        </div>
        {hayFiltros && (
          <button className="btn ghost" type="button" onClick={limpiarFiltros}>
            Limpiar
          </button>
        )}
      </form>

      {abrirFiltros && (
        <div className="card">
          <div className="card-title">Filtros de columna</div>
          <div className="form-grid">
            <div className="field">
              <label>Estado del pedido</label>
              <select
                value={filtros.estado}
                onChange={(e) => setFiltro("estado", e.target.value)}
              >
                <option value="">Todos</option>
                {ESTADOS_PEDIDO_FILTRO.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Estado del envio</label>
              <select
                value={filtros.estadoEnvio}
                onChange={(e) => setFiltro("estadoEnvio", e.target.value)}
              >
                <option value="">Todos</option>
                {opciones.fulfillmentStatuses.filter(Boolean).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Origen</label>
              <select
                value={filtros.origen}
                onChange={(e) => setFiltro("origen", e.target.value)}
              >
                <option value="">Todos</option>
                {opciones.sources.filter(Boolean).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Cliente</label>
              <input
                list="clientes-opciones"
                placeholder="Nombre..."
                value={filtros.cliente}
                onChange={(e) => setFiltro("cliente", e.target.value)}
              />
              <datalist id="clientes-opciones">
                {opciones.customers.slice(0, 100).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <label>Producto</label>
              <input
                placeholder="Nombre o ID..."
                value={filtros.producto}
                onChange={(e) => setFiltro("producto", e.target.value)}
              />
            </div>

            <div className="field">
              <label>Desde</label>
              <input
                type="date"
                value={filtros.desde}
                onChange={(e) => setFiltro("desde", e.target.value)}
              />
            </div>

            <div className="field">
              <label>Hasta</label>
              <input
                type="date"
                value={filtros.hasta}
                onChange={(e) => setFiltro("hasta", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <ErrorBanner error={error} />
      {notaAsig ? <p className="muted small">{notaAsig}</p> : null}

      <div className="card">
        {loading ? (
          <Spinner label="Cargando pedidos..." />
        ) : rowsVisibles.length === 0 ? (
          <p className="muted">{rows.length === 0 ? "No se encontraron pedidos con esos filtros." : mensajeVacioAsign}</p>
        ) : (
          <>
            {filtroEtiqueta && (
              <p className="muted small" style={{ marginTop: 0 }}>
                Etiqueta aplicada: {rowsVisibles.length} de {rows.length} pedidos
                de esta pagina.
              </p>
            )}
            {filtroEnvio && (
              <p className="muted small" style={{ marginTop: 0 }}>
                Envío (Lucid Bot) aplicado: {rowsVisibles.length} de {rows.length} pedidos de esta página. Es un
                filtro local: LucidSales no conoce estos estados, así que se filtra lo que trajo esta página (sube
                «Por página» para ver más).
              </p>
            )}
            {filtroAsign && (
              <p className="muted small" style={{ marginTop: 0 }}>
                Asignación aplicada: {rowsVisibles.length} de {rows.length} pedidos de esta página (
                {etiquetaFiltroAsign}). Es un filtro local: las asignaciones las guarda nuestro
                backend, la API de LucidSales no las conoce (la paginación sigue siendo la de
                siempre).
              </p>
            )}
            {telActivo && (
              <p className="muted small" style={{ marginTop: 0 }}>
                Telefono {telDeUrl}: la API no filtra por telefono, asi que de los
                pedidos que trae el filtro Cliente se muestran solo los que tienen
                este numero (los demas suelen ser homónimos).
              </p>
            )}
            <LeyendaEstados />
            <div className="table-wrap pedidos-tabla">
              <table className="table">
                <thead>
                  <tr>
                    <th># Pedido</th>
                    <th>Cliente</th>
                    <th className="wrap">Producto</th>
                    <th className="hide-sm">Telefono</th>
                    <th>Estado</th>
                    <th className="hide-sm">Envío</th>
                    <th className="hide-sm">Asignado</th>
                    <th className="wrap hide-sm">Total</th>
                    <th className="hide-sm">Fecha</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rowsVisibles.map((p) => {
                    const tel = telefono(p.Movil);
                    const fecha = p.Fecha ?? p.CreatedAt;
                    const mias = et.etiquetasDe(p.id ?? p.idPedido);
                    const asignado = asig[String(p.id ?? p.idPedido)];
                    return (
                      <tr key={p.id ?? p.idPedido} className={`fila-estado ${claseEstado(p.EstadoPedido ?? 0)}`}>
                        <td>
                          <Link to={`/pedidos/${p.id ?? p.idPedido}`}>
                            <strong>#{p.idPedido ?? p.id}</strong>
                          </Link>
                        </td>
                        <td className="wrap">
                          <Link to={`/pedidos/${p.id ?? p.idPedido}`} className="link-plain">
                            {[p.Nombre, p.Apellido].filter(Boolean).join(" ") || "—"}
                          </Link>
                          {mias.length > 0 && (
                            <div className="etiqueta-fila" style={{ marginTop: 3 }}>
                              <ChipsDeEtiquetas etiquetas={mias} />
                            </div>
                          )}
                        </td>
                        <td className="wrap prod-celda" title={p.producto || ""}>
                          {p.producto || "—"}
                        </td>
                        <td className="hide-sm">
                          {tel ? (
                            <span className="tel-links">
                              <a href={`tel:${tel.tel}`} title="Llamar">
                                {tel.visible}
                              </a>
                              <a
                                href={`https://wa.me/${tel.wa}`}
                                target="_blank"
                                rel="noreferrer"
                                title="WhatsApp"
                              >
                                WhatsApp
                              </a>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {selectorEstado(p)}
                        </td>
                        <td
                          className="hide-sm"
                          title={
                            p.transportadora
                              ? `Transportadora: ${p.transportadora}`
                              : "Estado del envio"
                          }
                        >
                          <EnvioConBot valor={p.EstadoFullfilment} bot={enviosBot[String(p.id ?? p.idPedido)]} />
                        </td>
                        <td className="hide-sm">
                          {asignado ? (
                            <span className="row gap" style={{ marginBottom: 0 }}>
                              <span
                                className="chip"
                                title={`Asignado a ${asignado.usuario}`}
                              >
                                {asignado.nombre || asignado.usuario}
                              </span>
                              <button
                                type="button"
                                className="btn sm"
                                title="Cambiarlo a otro usuario"
                                onClick={() => void abrirAsignacion(p)}
                              >
                                Cambiar
                              </button>
                              <button
                                type="button"
                                className="btn sm"
                                title="Quitar la asignacion"
                                aria-label="Quitar la asignacion"
                                onClick={() => void desasignar(p.id ?? p.idPedido)}
                              >
                                ×
                              </button>
                            </span>
                          ) : (
                            <span className="row gap" style={{ marginBottom: 0 }}>
                              <span className="muted small">—</span>
                              <button
                                type="button"
                                className="btn sm"
                                title="Asignar este pedido a alguien"
                                onClick={() => void abrirAsignacion(p)}
                              >
                                Asignar
                              </button>
                            </span>
                          )}
                        </td>
                        <td className="wrap hide-sm">{money(p.Total)}</td>
                        <td className="hide-sm" title={fmtFecha(fecha)}>
                          {haceCuanto(fecha) || "—"}
                        </td>
                        <td>
                          <button
                            className="btn sm"
                            title="Etiquetas de este pedido"
                            onClick={() =>
                              setPickerPara({
                                id: p.id ?? p.idPedido,
                                numero: p.idPedido ?? p.id,
                              })
                            }
                          >
                            🏷
                          </button>{" "}
                          {inbox(p.Movil) && (
                            <a
                              className="btn sm"
                              href={inbox(p.Movil)!}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir el chat del bot (inbox LucidBot)"
                            >
                              💬
                            </a>
                          )}{" "}
                          <Link className="btn sm" to={`/pedidos/${p.id ?? p.idPedido}`}>
                            Ver
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="pedidos-cards">
              {rowsVisibles.map((p) => {
                const id = p.id ?? p.idPedido;
                const tel = telefono(p.Movil);
                const fecha = p.Fecha ?? p.CreatedAt;
                const mias = et.etiquetasDe(id);
                const asignado = asig[String(id)];
                const nombre = [p.Nombre, p.Apellido].filter(Boolean).join(" ") || "Sin nombre";
                return (
                  <li key={id} className={`pedido-movil fila-estado ${claseEstado(p.EstadoPedido ?? 0)}`}>
                    <div className="pedido-movil-top">
                      <Link to={`/pedidos/${id}`} className="link-plain pedido-movil-cliente">
                        <strong>{nombre}</strong>
                        <span className="muted small">#{p.idPedido ?? p.id}</span>
                      </Link>
                      <Link to={`/pedidos/${id}`} className="link-plain pedido-movil-total">
                        {money(p.Total)} <span aria-hidden="true">›</span>
                      </Link>
                    </div>
                    {p.producto && <div className="pedido-movil-producto">{p.producto}</div>}
                    {mias.length > 0 && (
                      <div className="etiqueta-fila">
                        <ChipsDeEtiquetas etiquetas={mias} />
                      </div>
                    )}
                    <div className="pedido-movil-estado">
                      {selectorEstado(p)}
                      <EnvioConBot valor={p.EstadoFullfilment} bot={enviosBot[String(p.id ?? p.idPedido)]} />
                    </div>
                    <div className="pedido-movil-meta muted small">
                      <span title={fmtFecha(fecha)}>{haceCuanto(fecha) || "—"}</span>
                      {asignado && <span>· {asignado.nombre || asignado.usuario}</span>}
                    </div>
                    <div className="pedido-movil-acciones">
                      {tel && (
                        <a className="btn sm" href={`tel:${tel.tel}`} title="Llamar">
                          📞
                        </a>
                      )}
                      {tel && (
                        <a className="btn sm" href={`https://wa.me/${tel.wa}`} target="_blank" rel="noreferrer" title="WhatsApp">
                          WhatsApp
                        </a>
                      )}
                      {inbox(p.Movil) && (
                        <a className="btn sm" href={inbox(p.Movil)!} target="_blank" rel="noreferrer" title="Chat del bot">
                          💬
                        </a>
                      )}
                      <button
                        className="btn sm"
                        title="Etiquetas"
                        onClick={() => setPickerPara({ id, numero: p.idPedido ?? p.id })}
                      >
                        🏷
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        title={asignado ? `Asignado a ${asignado.usuario}` : "Asignar este pedido"}
                        onClick={() => void abrirAsignacion(p)}
                      >
                        {asignado ? "Reasignar" : "Asignar"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="pagination">
              <span className="muted small">
                Pagina {page} de {Math.max(paginasTotal, page)} ·{" "}
                {telActivo
                  ? `${rows.length} con este telefono`
                  : `${total.toLocaleString("es-CO")} registros`}
              </span>
              <div className="pages">
                <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ← Anterior
                </button>
                <button
                  className="btn sm"
                  disabled={page >= paginasTotal}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {!loading && rows.length > 0 && rows.length <= 5 && (
        <details className="card">
          <summary className="card-title">Respuesta cruda</summary>
          <JsonTable rows={rows} />
        </details>
      )}

      {/* Confirmacion de cambio de estado (reemplaza al confirm/prompt del navegador) */}
      <ConfirmDialog
        open={cambio !== null}
        title={
          cambio?.nuevo === 1
            ? "Cancelar pedido"
            : `Cambiar estado a "${cambio ? ESTADOS_PEDIDO[cambio.nuevo] : ""}"`
        }
        message={
          cambio ? (
            <>
              Pedido <strong>#{cambio.pedido.idPedido}</strong> de{" "}
              {[cambio.pedido.Nombre, cambio.pedido.Apellido].filter(Boolean).join(" ")} pasará a{" "}
              <strong>{ESTADOS_PEDIDO[cambio.nuevo]}</strong>.
            </>
          ) : (
            ""
          )
        }
        inputLabel={cambio?.nuevo === 1 ? "Motivo de la cancelacion" : undefined}
        inputPlaceholder="ej. Cliente pide anular"
        confirmLabel={cambio?.nuevo === 1 ? "Cancelar pedido" : "Cambiar estado"}
        danger={cambio?.nuevo === 1}
        loading={guardandoId !== null}
        onConfirm={(motivo) => aplicarCambio(motivo || undefined)}
        onCancel={() => setCambio(null)}
      />

      {/* Asignar / cambiar UN pedido (modo manual) */}
      <Modal
        open={!!asignando}
        title={
          asignando
            ? asig[String(asignando.id ?? asignando.idPedido)]
              ? `Cambiar asignación del pedido #${asignando.idPedido ?? asignando.id}`
              : `Asignar el pedido #${asignando.idPedido ?? asignando.id}`
            : "Asignar pedido"
        }
        onClose={() => setAsignando(null)}
        footer={
          <>
            <span className="muted small" style={{ marginRight: "auto" }}>
              {selAsig ? "1 usuario seleccionado" : "ninguno seleccionado"}
            </span>
            <button
              className="btn ghost"
              onClick={() => setAsignando(null)}
              disabled={asignandoOk}
            >
              Cancelar
            </button>
            <button
              className="btn primary"
              onClick={() => void asignarIndividual()}
              disabled={asignandoOk || cargandoUsAsig || !selAsig}
            >
              {asignandoOk ? "Asignando..." : "Asignar"}
            </button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          La asignación <strong>manual</strong> respeta tu elección aunque el usuario esté fuera de
          horario o con el horario pausado (el reparto automático sí mira los horarios).
        </p>

        <div className="row gap" style={{ marginBottom: 8 }}>
          <input
            placeholder="Buscar usuario"
            value={buscaUs}
            onChange={(e) => setBuscaUs(e.target.value)}
            autoComplete="off"
            aria-label="Buscar usuario"
          />
        </div>

        {cargandoUsAsig ? (
          <Spinner label="Cargando usuarios..." />
        ) : usuariosAsig.length === 0 ? (
          <p className="muted">No se pudieron cargar los usuarios.</p>
        ) : (
          <div className="permisos-grid">
            {usuariosAsig
              .filter((u) => {
                const q = buscaUs.trim().toLowerCase();
                if (!q) return true;
                return (
                  String(u.Nombre ?? "").toLowerCase().includes(q) ||
                  String(u.Usuario ?? "").toLowerCase().includes(q)
                );
              })
              .map((u) => {
                const k = claveUsuario(u);
                const carga = Object.values(asig).filter((a) => a?.usuario === k).length;
                const actual = asignando
                  ? asig[String(asignando.id ?? asignando.idPedido)]
                  : null;
                return (
                  <label className="check-permiso" key={k} htmlFor={`asig-${k}`}>
                    <input
                      id={`asig-${k}`}
                      type="radio"
                      name="asig-usuario"
                      checked={selAsig === k}
                      onChange={() => setSelAsig(k)}
                    />
                    <span>
                      <strong>{u.Nombre || k}</strong>{" "}
                      <span className="muted small">
                        {u.Usuario} · {carga} asignado(s)
                        {actual?.usuario === k ? " · actual" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
          </div>
        )}
        <ErrorBanner error={errAsig} />
      </Modal>

      {/* Reparto equitativo de pedidos (backend propio) */}
      <Modal
        open={repartoAbierto}
        title="Asignar pedidos de esta página"
        onClose={() => setRepartoAbierto(false)}
        wide
        footer={
          <>
            <span className="muted small" style={{ marginRight: "auto" }}>
              {rowsVisibles.length} pedido(s) en esta página
            </span>
            <button
              className="btn ghost"
              onClick={() => setRepartoAbierto(false)}
              disabled={repartiendo}
            >
              Cancelar
            </button>
            <button
              className="btn primary"
              onClick={() => void ejecutarReparto()}
              disabled={repartiendo || cargandoUsuarios}
            >
              {repartiendo ? "Repartiendo..." : "Repartir equitativo"}
            </button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Cada pedido se le da al usuario con <strong>menos asignaciones</strong> (las que ya
          tiene cuentan), por eso el reparto queda parejo.
        </p>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="rep-modo">Cómo repartir</label>
            <select
              id="rep-modo"
              value={modoReparto}
              onChange={(e) => setModoReparto(e.target.value as "todos" | "horario")}
            >
              <option value="todos">Entre todos los usuarios</option>
              <option value="horario">Solo los que están en horario ahora</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-solo">Alcance</label>
            <label className="switch" htmlFor="rep-solo" style={{ marginTop: 6 }}>
              <input
                id="rep-solo"
                type="checkbox"
                checked={soloSin}
                onChange={(e) => setSoloSin(e.target.checked)}
              />
              <span className="switch-pista" aria-hidden="true" />
              <span className="switch-texto">
                {soloSin ? "Solo pedidos sin asignar" : "Reasignar también los ya asignados"}
              </span>
            </label>
          </div>
        </div>

        <div className="field">
          <label>Usuarios participantes</label>
          {cargandoUsuarios ? (
            <Spinner label="Cargando usuarios..." />
          ) : usuariosReparto.length === 0 ? (
            <p className="muted">No se pudieron cargar los usuarios.</p>
          ) : (
            <div className="permisos-grid">
              {usuariosReparto.map((u) => {
                const k = claveUsuario(u);
                const carga = Object.values(asig).filter((a) => a?.usuario === k).length;
                return (
                  <label className="check-permiso" key={k} htmlFor={`rep-${k}`}>
                    <input
                      id={`rep-${k}`}
                      type="checkbox"
                      checked={seleccion.includes(k)}
                      onChange={() =>
                        setSeleccion((s) =>
                          s.includes(k) ? s.filter((x) => x !== k) : [...s, k],
                        )
                      }
                    />
                    <span>
                      <strong>{u.Nombre || k}</strong>{" "}
                      <span className="muted small">
                        {u.Usuario} · {carga} asignado(s)
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <ErrorBanner error={errReparto} />
      </Modal>

      {/* Etiquetas (funcion propia): gestor + selector por pedido */}
      <GestorEtiquetas open={gestorAbierto} onClose={() => setGestorAbierto(false)} />
      <PickerEtiquetas
        open={pickerPara !== null}
        onClose={() => setPickerPara(null)}
        idPedido={pickerPara?.id ?? ""}
        numero={pickerPara?.numero}
      />
    </>
  );
}
