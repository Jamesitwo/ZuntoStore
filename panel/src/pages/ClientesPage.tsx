import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg, pickArray } from "../api/client";
import { clientes, INTEGRACIONES, pedidos } from "../api/endpoints";
import { ErrorBanner, JsonView, PageHeader, Spinner } from "../components/ui";
import { JsonPost as JsonPostEditor } from "../components/JsonPost";
import { useEtiquetaTienda } from "../lib/tiendas";
import { claveTelefono, telefono } from "../lib/format";

/**
 * Clientes e integraciones.
 *
 * La pestaña "Clientes" usa la misma variante paginada que el panel oficial
 * (`GET /clientes/getclientes?page=&itemsPerPage=&search=&filters=[]`) y
 * añade la columna **Pedidos**: cuantos pedidos tiene cada cliente.
 *
 * LucidSales no guarda ese numero en el cliente y su filtro `customer` busca
 * **por nombre**, asi que con dos clientes del mismo nombre (homónimos) el
 * recuento se dispara: un cliente con 87 pedidos "por compartir nombre". Tampoco
 * existe filtro por telefono, asi que el listado de pedidos se **indexa una vez
 * por tienda** (paginas de 500, ordenadas por fecha) y se cuenta **por telefono**
 * (`Movil` del pedido contra `TelCliente` del cliente).
 *
 *   - Con telefono y cobertura suficiente -> numero exacto.
 *   - Sin telefono (o tiendas con casi ninguno) -> numero por nombre con la
 *     marca `≈`, nunca presentado como exacto.
 *
 * El numero es un enlace: `/pedidos?cliente=<nombre>` (y `&tel=<10 digitos>`
 * cuando el recuento es por telefono, para que la lista muestre solo esos).
 */

/** Sin acentos, minusculas y solo letras/numeros (para comparar nombres). */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Nombre visible: `Nombre` y, si viene aparte, `Apellido`. */
function nombreDe(c: any): string {
  const n = String(c?.Nombre ?? c?.nombre ?? c?.name ?? "").trim();
  const a = String(c?.Apellido ?? "").trim();
  if (a && n.toLowerCase().split(/\s+/).pop() !== a.toLowerCase()) return `${n} ${a}`.trim();
  return n;
}

// ---------------- Recuento de pedidos (por telefono, no por nombre) ----------------
//
// El filtro `customer` de la API es de **texto sobre el nombre** y con homónimos
// mezcla pedidos de personas distintas. Como ademas no hay filtro por telefono,
// el listado de pedidos se indexa una sola vez por tienda y se cuenta localmente.

const PEDIDOS_POR_PAGINA = 500;
/** Paginas maximas (40000 pedidos); si hay mas, se avisa en la interfaz. */
const MAX_PAGINAS = 80;
const MAX_PEDIDOS = 40000;
/** Mismo orden que usa el panel oficial (fecha descendente). */
const FILTRO_ORDEN = JSON.stringify([{ name: "date", searchValues: [], sortOrder: "desc" }]);
/** Con menos cobertura de telefono que esta, el recuento pasa a nombre (≈). */
const COBERTURA_MINIMA = 0.2;

interface IndicePedidos {
  porTelefono: Map<string, number>;
  porNombre: Map<string, number>;
  pedidos: number;
  conTelefono: number;
  total: number;
  paginas: number;
  paginasTotales: number;
  completo: boolean;
  estado: "escaneando" | "listo" | "error";
}

/** Indice por tienda (memoria): se reutiliza al navegar y se reconstruye con Recalcular. */
const INDICES = new Map<number, IndicePedidos>();
const ESCANEANDO = new Set<number>();

function nuevoIndice(): IndicePedidos {
  return {
    porTelefono: new Map(),
    porNombre: new Map(),
    pedidos: 0,
    conTelefono: 0,
    total: 0,
    paginas: 0,
    paginasTotales: 1,
    completo: false,
    estado: "escaneando",
  };
}

/** Baja el listado de pedidos de la tienda y lo indexa por telefono y por nombre. */
async function indexarPedidos(idEmpresa: number, alAvanzar: () => void): Promise<void> {
  const idx = nuevoIndice();
  INDICES.set(idEmpresa, idx);
  ESCANEANDO.add(idEmpresa);

  const vistos = new Set<string>();
  const meter = (p: any): boolean => {
    const hayId = p?.id !== undefined && p?.id !== null && p?.id !== "";
    const clave = hayId ? `${p.id}/${p.idPedido ?? ""}` : null;
    if (clave !== null) {
      if (vistos.has(clave)) return false; // pagina repetida (la API ignora `page`)
      vistos.add(clave);
    }
    if (idx.pedidos >= MAX_PEDIDOS) return false;
    idx.pedidos++;
    const tel = claveTelefono(p?.Movil);
    if (tel) {
      idx.conTelefono++;
      idx.porTelefono.set(tel, (idx.porTelefono.get(tel) ?? 0) + 1);
    }
    const nom = norm(`${p?.Nombre ?? ""} ${p?.Apellido ?? ""}`);
    if (nom) idx.porNombre.set(nom, (idx.porNombre.get(nom) ?? 0) + 1);
    return true;
  };

  const pedir = (page: number, itemsPerPage: number) =>
    pedidos.list({ idEmpresa, page, itemsPerPage, search: "", filters: FILTRO_ORDEN });
  const filasDe = (res: any): any[] => (Array.isArray(res?.pedidos) ? res.pedidos : []);

  try {
    let res: any = await pedir(1, PEDIDOS_POR_PAGINA).catch(() => null);
    let filas = filasDe(res);
    if (!filas.length) {
      // por si el servidor no admite paginas tan grandes (o fallo la primera)
      res = await pedir(1, 100).catch(() => null);
      filas = filasDe(res);
    }
    if (!res) {
      idx.estado = "error"; // nada se pudo leer: no se pinta "0 pedidos"
      return;
    }
    idx.total = Number(res?.totalRecords) || 0;
    if (!filas.length) {
      idx.estado = idx.total > 0 ? "error" : "listo"; // con total pero sin filas: algo va mal
      idx.completo = idx.total === 0;
      return;
    }

    const numPag = Number(res?.numPages) || Math.ceil(idx.total / filas.length);
    idx.paginasTotales = Math.max(1, Math.min(numPag, MAX_PAGINAS));
    filas.forEach(meter);
    idx.paginas = 1;
    alAvanzar();

    const faltan: number[] = [];
    for (let p = 2; p <= idx.paginasTotales && idx.pedidos < MAX_PEDIDOS; p++) faltan.push(p);

    let i = 0;
    let cortar = false;
    const trabajador = async () => {
      while (!cortar && i < faltan.length) {
        const pagina = faltan[i++];
        const r = await pedir(pagina, PEDIDOS_POR_PAGINA).catch(() => null);
        if (!r) continue; // fallo puntual de una pagina: se sigue con las demas
        const fs = filasDe(r);
        if (!fs.length) break;
        const antes = idx.pedidos;
        fs.forEach(meter);
        idx.paginas++;
        if (idx.pedidos === antes) cortar = true; // todas repetidas: no avanza
        alAvanzar();
      }
    };
    await Promise.all([0, 1, 2, 3].map(() => trabajador()));

    idx.completo = idx.total === 0 || idx.pedidos >= idx.total;
    idx.estado = "listo";
  } catch {
    idx.estado = idx.pedidos > 0 ? "listo" : "error";
    idx.completo = idx.total > 0 && idx.pedidos >= idx.total;
  } finally {
    ESCANEANDO.delete(idEmpresa);
    if (INDICES.get(idEmpresa) !== idx) INDICES.set(idEmpresa, idx); // nada se pierde
    alAvanzar();
  }
}

export function ClientesPage() {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [texto, setTexto] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // sirve a la vez para repintar al llegar un recuento y para "Recalcular"
  const [cuentasTick, setCuentasTick] = useState(0);

  const [integraciones, setIntegraciones] = useState<unknown>(null);
  const [cargandoIntegraciones, setCargandoIntegraciones] = useState(true);
  const [tab, setTab] = useState<"clientes" | "integraciones">("clientes");
  const [integracion, setIntegracion] = useState<string>("rocket");

  // Si la API no informa totalRecords y devuelve todo de golpe, no hay paginas
  const completo = total === 0 && rows.length > 0;
  const numPages = completo ? 1 : Math.max(1, Math.ceil(total / itemsPerPage));
  const totalClientes = total || rows.length;

  // buscador con debounce (mismo criterio que Pedidos)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch((s) => (s === texto.trim() ? s : texto.trim()));
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [texto]);

  // integraciones (una vez por tienda)
  useEffect(() => {
    let cancel = false;
    setCargandoIntegraciones(true);
    clientes
      .integrations(idEmpresa)
      .then((res) => {
        if (!cancel) setIntegraciones(res);
      })
      .catch(() => {
        /* la pestana de integraciones queda vacia; el resto funciona */
      })
      .finally(() => {
        if (!cancel) setCargandoIntegraciones(false);
      });
    return () => {
      cancel = true;
    };
  }, [idEmpresa]);

  // pagina de clientes
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);

    clientes
      .list(idEmpresa, { page, itemsPerPage, search })
      .then((res: any) => {
        if (cancel) return;
        setRows(pickArray(res, ["clientes", "clients", "data"]));
        setTotal(Number(res?.totalRecords) || 0);
      })
      .catch((err) => {
        if (!cancel) setError(`Clientes: ${errMsg(err)}`);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [idEmpresa, page, itemsPerPage, search]);

  // indice de pedidos de la tienda: se construye una sola vez por tienda
  // ("Recalcular pedidos" lo borra para que se vuelva a bajar)
  useEffect(() => {
    if (INDICES.has(idEmpresa) || ESCANEANDO.has(idEmpresa)) return;
    void indexarPedidos(idEmpresa, () => setCuentasTick((t) => t + 1));
  }, [idEmpresa, cuentasTick]);

  const recalcular = () => {
    if (ESCANEANDO.has(idEmpresa)) return; // no se corta un indice a medias
    INDICES.delete(idEmpresa);
    setCuentasTick((t) => t + 1);
  };

  const indice = INDICES.get(idEmpresa);
  /** Si hay suficientes telefonos, el recuento es exacto; si no, es por nombre. */
  const porTelefono = Boolean(
    indice && indice.pedidos > 0 && indice.conTelefono / indice.pedidos >= COBERTURA_MINIMA,
  );

  return (
    <>
      <PageHeader title="Clientes e integraciones" subtitle={etiqueta(idEmpresa)} />

      <div className="tabs">
        <button
          className={`tab${tab === "clientes" ? " active" : ""}`}
          onClick={() => setTab("clientes")}
        >
          Clientes
        </button>
        <button
          className={`tab${tab === "integraciones" ? " active" : ""}`}
          onClick={() => setTab("integraciones")}
        >
          Integraciones
        </button>
      </div>

      <ErrorBanner error={error} />

      {tab === "clientes" && (
        <>
          <div className="card">
            <div className="card-title row between">
              <span>
                Clientes <code>GET /clientes/getclientes</code>
              </span>
              <span className="muted small">{totalClientes} en total</span>
            </div>

            <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
              <div className="field" style={{ minWidth: 240 }}>
                <label htmlFor="buscar-cliente">Buscar</label>
                <input
                  id="buscar-cliente"
                  placeholder="Nombre, correo o telefono..."
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: 140 }}>
                <label htmlFor="porpagina-clientes">Por pagina</label>
                <select
                  id="porpagina-clientes"
                  value={itemsPerPage}
                  onChange={(e) => {
                    setPage(1);
                    setItemsPerPage(Number(e.target.value));
                  }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn sm ghost"
                title="Vuelve a bajar el listado de pedidos y a contarlos"
                onClick={recalcular}
              >
                Recalcular pedidos
              </button>
            </form>

            {indice?.estado === "escaneando" && (
              <p className="muted small">
                Indexando pedidos para contar por telefono… {indice.paginas}/
                {indice.paginasTotales} paginas
              </p>
            )}
            {indice?.estado === "error" && (
              <p className="muted small">
                No se pudo leer el listado de pedidos. Pulsa “Recalcular pedidos”.
              </p>
            )}
            {indice?.estado === "listo" && !indice.completo && (
              <p className="muted small">
                Recuento sobre los {indice.pedidos.toLocaleString("es-CO")} pedidos mas
                recientes (de {indice.total.toLocaleString("es-CO")}).
              </p>
            )}
            {indice?.estado === "listo" && indice.pedidos > 0 && !porTelefono && (
              <p className="muted small">
                Pocos pedidos traen telefono: el recuento es aproximado (≈) por nombre.
              </p>
            )}

            {loading ? (
              <Spinner label="Cargando clientes..." />
            ) : rows.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table className="table tabla-clientes">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Correo</th>
                        <th>Telefono</th>
                        <th>Direccion</th>
                        <th
                          className="num"
                          title="Pedidos de este cliente (recuento por telefono)"
                        >
                          Pedidos
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c, i) => {
                        const nombre = nombreDe(c);
                        const tel = telefono(c.TelCliente ?? c.Telefono ?? c.Tel);
                        const correo = String(c.Correo ?? c.Email ?? "").trim();
                        const direccion = String(c.DirCliente ?? c.Direccion ?? "").trim();
                        const claveTel = tel ? claveTelefono(tel.tel) : "";
                        // recuento por telefono si hay cobertura; si no, por nombre (≈)
                        const cuenta = (() => {
                          if (!norm(nombre)) return { tipo: "sin-nombre" as const };
                          if (!indice || indice.estado === "escaneando")
                            return { tipo: "carga" as const };
                          if (indice.estado === "error") return { tipo: "error" as const };
                          const exacto = !!claveTel && porTelefono;
                          const n = exacto
                            ? indice.porTelefono.get(claveTel) ?? 0
                            : indice.porNombre.get(norm(nombre)) ?? 0;
                          return { tipo: exacto ? ("ok" as const) : ("aprox" as const), n, claveTel };
                        })();

                        return (
                          <tr key={String(c.idCliente ?? c.id ?? `${nombre}-${i}`)}>
                            <td>
                              <strong>{nombre || "Sin nombre"}</strong>
                            </td>
                            <td>
                              {correo ? (
                                <a href={`mailto:${correo}`}>{correo}</a>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              {tel ? (
                                <span className="row gap">
                                  <a href={`tel:${tel.tel}`} title="Llamar">
                                    {tel.visible}
                                  </a>
                                  <a
                                    href={`https://wa.me/${tel.wa}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Escribir por WhatsApp"
                                  >
                                    WhatsApp
                                  </a>
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className="dir">
                              {direccion || <span className="muted">—</span>}
                            </td>
                            <td className="num">
                              {cuenta.tipo === "sin-nombre" ? (
                                <span className="muted" title="Sin nombre para buscar pedidos">
                                  —
                                </span>
                              ) : cuenta.tipo === "carga" ? (
                                <span
                                  className="muted"
                                  title="Indexando los pedidos de la tienda para contar por telefono"
                                >
                                  …
                                </span>
                              ) : cuenta.tipo === "error" ? (
                                <span
                                  className="muted"
                                  title="No se pudo leer el listado de pedidos; pulsa Recalcular"
                                >
                                  —
                                </span>
                              ) : cuenta.n === 0 ? (
                                <span
                                  className="muted"
                                  title={
                                    cuenta.tipo === "aprox"
                                      ? "Sin pedidos con este nombre"
                                      : "Sin pedidos con este telefono"
                                  }
                                >
                                  0
                                </span>
                              ) : (
                                <Link
                                  className={`badge${cuenta.tipo === "ok" ? " ok" : ""}`}
                                  to={
                                    cuenta.tipo === "ok"
                                      ? `/pedidos?cliente=${encodeURIComponent(nombre)}&tel=${cuenta.claveTel}`
                                      : `/pedidos?cliente=${encodeURIComponent(nombre)}`
                                  }
                                  title={
                                    cuenta.tipo === "ok"
                                      ? `Ver los ${cuenta.n} pedidos con el telefono ${cuenta.claveTel}`
                                      : `Aproximado por nombre (puede mezclar homonimos): ${cuenta.n} pedidos`
                                  }
                                >
                                  {cuenta.tipo === "aprox" ? `≈${cuenta.n}` : cuenta.n}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="muted small">
                  Recuento <strong>por telefono</strong>: el <code>Movil</code> del pedido
                  contra el <code>TelCliente</code> del cliente, asi los homónimos no se
                  mezclan. Sin telefono (o con muy pocos en la tienda) se cuenta por nombre
                  con la marca <code>≈</code>. Pulsa el numero para abrir Pedidos de ese
                  cliente.
                </p>

                <div className="pagination">
                  <span className="muted small">
                    Pagina {page} de {numPages} · {totalClientes.toLocaleString("es-CO")} clientes
                  </span>
                  <div className="pages">
                    <button
                      className="btn sm"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      ← Anterior
                    </button>
                    <button
                      className="btn sm"
                      disabled={page >= numPages}
                      onClick={() => setPage(page + 1)}
                    >
                      Siguiente →
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">
                Sin clientes (o el endpoint no devolvio una lista reconocible).
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <details className="card">
              <summary className="card-title">Respuesta cruda</summary>
              <JsonView data={rows} />
            </details>
          )}
        </>
      )}

      {tab === "integraciones" && (
        <>
          <div className="card">
            <div className="card-title">
              <code>GET /clientes/getIntegrations</code>
            </div>
            {cargandoIntegraciones ? <Spinner /> : <JsonView data={integraciones} />}
          </div>

          <div className="card">
            <div className="card-title">
              Actualizar integracion · <code>POST /clientes/updateIntegration/{"{nombre}"}</code>
            </div>
            <div className="toolbar">
              {INTEGRACIONES.map((nombre) => (
                <button
                  key={nombre}
                  className={`btn sm${integracion === nombre ? " primary" : ""}`}
                  onClick={() => setIntegracion(nombre)}
                >
                  {nombre}
                </button>
              ))}
            </div>
            <JsonPostEditor
              key={integracion}
              path={`/clientes/updateIntegration/${integracion}`}
              initialBody={
                integracion === "rocket"
                  ? JSON.stringify({ autoUpload: false, status: 1 }, null, 2)
                  : "{\n  \n}"
              }
              label={`Actualizar ${integracion}`}
            />
            <p className="muted small">
              Body confirmado: <code>rocket {"{autoUpload: boolean, status: number}"}</code>. Las
              demas integraciones usan el mismo patron (confirmar contra la API).
            </p>
          </div>
        </>
      )}
    </>
  );
}
