import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg } from "../api/client";
import { cambiarEstadoPedido, ESTADOS_PEDIDO, pedidos, TIPOS_PAGO } from "../api/endpoints";
import { ErrorBanner, EstadoBadge, JsonView, PageHeader, Spinner, money } from "../components/ui";
import { LocationPicker, type Ubicacion } from "../components/LocationPicker";
import { Combo, type OpcionCombo } from "../components/Combo";
import { StockDropi } from "../components/StockDropi";
import { ConfirmDialog } from "../components/Modal";
import { CotizadorPedido } from "../components/CotizadorPedido";
import { BloqueOficinaInter } from "../components/OficinaInter";
import { SubirPedidoDropi } from "../components/SubirPedidoDropi";
import { ValidarDireccion } from "../components/ValidarDireccion";
import { BloqueEtiquetas } from "../components/Etiquetas";
import { useToast } from "../components/Toast";
import { claveTelefono, fmtFecha, haceCuanto, telefono } from "../lib/format";
import { EnvioConBot, useEstadosEnvioBot } from "../components/EnvioLucidBot";
import { prodId, prodImg, prodName, prodPrice, useCatalogo } from "../lib/catalogo";
import { useEtiquetaTienda } from "../lib/tiendas";
import { useInboxBot } from "../lib/botInbox";

function parseArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
};

/**
 * Seccion "Envio" del panel oficial (su acordeon "Envio" del detalle): la guia
 * que tomo el proveedor de dropshipping. Todo viene en get-pedido-by-id y es de
 * solo lectura; cada campo solo se pinta si trae valor (mismo criterio que
 * LucidSales: falsy o "0" no se muestra).
 */
function datosEnvio(p: any): Array<{ label: string; valor: string }> {
  const txt = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());
  const noCero = (v: unknown): string => {
    const s = txt(v);
    return s && s !== "0" ? s : "";
  };
  /** ISO o epoch -> fecha legible; cualquier otro texto, se muestra tal cual. */
  const fecha = (v: unknown): string => {
    const s = txt(v);
    if (!s) return "";
    let ms: number | null = null;
    if (/^\d{13}$/.test(s)) ms = Number(s);
    else if (/^\d{10}$/.test(s)) ms = Number(s) * 1000;
    else if (/^\d{4}-\d{2}-\d{2}/.test(s)) ms = Date.parse(s);
    if (ms === null || Number.isNaN(ms)) return s;
    const f = fmtFecha(ms);
    return f === "—" ? s : f;
  };
  /** Cifras -> plata con separadores; el resto, tal cual. */
  const dinero = (v: unknown): string => {
    const s = txt(v);
    if (!s) return "";
    return /^-?\d+(\.\d+)?$/.test(s) ? money(Number(s)) : s;
  };

  const filas: Array<{ label: string; valor: string }> = [];
  const agregar = (label: string, valor: string) => {
    if (valor) filas.push({ label, valor });
  };

  const proveedor = txt(p?.dropshippingProvider);
  agregar(
    "Proveedor de guías",
    proveedor && proveedor !== "none" ? proveedor.charAt(0).toUpperCase() + proveedor.slice(1) : "",
  );
  agregar("Fecha de creación", fecha(p?.fechaCreadoDropi));
  agregar("Fecha de actualización", fecha(p?.fechaActualizadoDropi));
  // igual que el oficial: idPedidoDropi y, si no, idPedidoExterno (nunca "0")
  agregar("ID de pedido", noCero(p?.idPedidoDropi) || noCero(p?.idPedidoExterno));
  agregar("Estado de envío", txt(p?.EstadoFullfilment));
  agregar("Transportadora", txt(p?.transportadora));
  agregar("ID Guia Transportadora", noCero(p?.idGuiaTransportadora));
  agregar("Costo de flete", dinero(p?.fleteDropi));
  agregar("Ganancia esperada", dinero(p?.gananciaEsperadaDropi));
  agregar("Valor de devolución", dinero(p?.valorFleteDevolucionDropi));
  agregar("Fecha de devolución", fecha(p?.fechaDevolucionDropi));
  return filas;
}

export function PedidoDetallePage() {
  const { id } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const etiqueta = useEtiquetaTienda();
  const inbox = useInboxBot();

  const [original, setOriginal] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [obs, setObs] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [ubicacion, setUbicacion] = useState<Ubicacion>({ pais: null, departamento: null, ciudad: null });
  const [nuevaObs, setNuevaObs] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dialogo abierto: confirmar / cancelar (con motivo) / salir sin guardar
  const [dialogo, setDialogo] = useState<null | "confirmar" | "cancelar" | "salir">(null);
  // copia del estado recien cargado, para detectar cambios sin guardar
  const [snapshot, setSnapshot] = useState("");
  // a donde ir al confirmar "salir sin guardar"
  const [destino, setDestino] = useState("/pedidos");
  // catalogo de productos de la tienda (para el desplegable de lineas)
  const { catalogo, cargando: catalogoCargando } = useCatalogo(session?.tiendaActiva ?? 0);
  // pedido anterior / siguiente dentro de la lista que venia viendo el usuario
  const [vecinos, setVecinos] = useState<{ anterior: number | null; siguiente: number | null }>({
    anterior: null,
    siguiente: null,
  });

  // Navegacion entre pedidos + scroll arriba al cambiar de pedido
  useEffect(() => {
    let cancel = false;
    window.scrollTo({ top: 0 });

    const calcular = (ids: any[]) => {
      const i = ids.findIndex((v) => String(v) === String(id));
      setVecinos(
        i < 0
          ? { anterior: null, siguiente: null }
          : {
              anterior: i > 0 ? ids[i - 1] : null,
              siguiente: i < ids.length - 1 ? ids[i + 1] : null,
            },
      );
    };

    let encontrado = false;
    try {
      const guardado = sessionStorage.getItem("pedidosNav");
      if (guardado) {
        const ids = JSON.parse(guardado);
        if (Array.isArray(ids) && ids.some((v: any) => String(v) === String(id))) {
          calcular(ids);
          encontrado = true;
        }
      }
    } catch {
      /* sessionStorage no disponible */
    }

    if (!encontrado) {
      // si no esta en la lista guardada, toma los 200 mas recientes
      pedidos
        .list({
          idEmpresa: session?.tiendaActiva ?? 0,
          page: 1,
          itemsPerPage: 200,
          search: "",
          filters: JSON.stringify([{ name: "date", searchValues: [], sortOrder: "desc" }]),
        })
        .then((res: any) => {
          if (!cancel) {
            calcular(
              (Array.isArray(res?.pedidos) ? res.pedidos : []).map((p: any) => p.id ?? p.idPedido),
            );
          }
        })
        .catch(() => undefined);
    }

    return () => {
      cancel = true;
    };
  }, [id, session?.tiendaActiva]);

  const cargar = () => {
    setLoading(true);
    setError(null);
    pedidos
      .byId(id!)
      .then((res: any) => {
        // la respuesta puede venir aplanada o como { pedido: {...} }
        const p = res?.pedido ?? res?.data?.pedido ?? res?.data ?? res;
        setOriginal(p);
        const formInicial = {
          id: p.id,
          idPedido: p.idPedido,
          idEmpresa: p.idEmpresa ?? session?.tiendaActiva,
          Nombre: p.Nombre ?? "",
          Apellido: p.Apellido ?? "",
          NIT: p.NIT ?? "",
          Correo: p.Correo ?? p.Email ?? "",
          Movil: p.Movil ?? "",
          Direccion: p.Direccion ?? "",
          verifiedAddress: p.verifiedAddress ?? "",
          codigoPostal: p.codigoPostal ?? "",
          Observaciones: p.Observaciones ?? "",
          EstadoPedido: num(p.EstadoPedido),
          Json: p.Json ?? "",
          SubTotal: p.SubTotal ?? "0.00",
          CostoEnvio: p.CostoEnvio ?? "0.00",
          Total: p.Total ?? "0.00",
          TipoPago: num(p.TipoPago),
          EstadoPago: num(p.EstadoPago),
          logistic: p.logistic ?? "",
          Referencias: p.Referencias ?? "",
        };
        const obsInicial = parseArray(p.Observaciones);
        const itemsInicial = parseArray(p.Json);
        const ubiInicial: Ubicacion = {
          pais: p.Pais !== undefined && p.Pais !== null ? num(p.Pais) : null,
          departamento:
            p.Departamento !== undefined && p.Departamento !== null ? num(p.Departamento) : null,
          ciudad: p.Ciudad !== undefined && p.Ciudad !== null ? num(p.Ciudad) : null,
        };
        setForm(formInicial);
        setObs(obsInicial);
        setItems(itemsInicial);
        setUbicacion(ubiInicial);
        setSnapshot(
          JSON.stringify({
            form: formInicial,
            obs: obsInicial,
            items: itemsInicial,
            ubicacion: ubiInicial,
          }),
        );
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, [id]);

  /* ---------------- otros pedidos del mismo cliente ---------------- */
  const [otros, setOtros] = useState<any[]>([]);
  // estado del envio que manda Lucid Bot (este pedido y los otros del cliente)
  const enviosBot = useEstadosEnvioBot(original ? [original, ...otros] : otros);
  const [totalOtros, setTotalOtros] = useState(0);
  const [cargandoOtros, setCargandoOtros] = useState(false);
  const [errorOtros, setErrorOtros] = useState<string | null>(null);

  const nombreCliente = [original?.Nombre, original?.Apellido].filter(Boolean).join(" ").trim();
  const telCliente = claveTelefono(original?.Movil);

  /**
   * La API solo sabe buscar por nombre (`filter customer`) y con eso entran
   * homónimos, así que se coteja el teléfono y se quita el pedido actual.
   */
  useEffect(() => {
    let cancel = false;
    if (!nombreCliente) {
      setOtros([]);
      setTotalOtros(0);
      setCargandoOtros(false);
      return;
    }
    setCargandoOtros(true);
    setErrorOtros(null);
    pedidos
      .list({
        idEmpresa: session?.tiendaActiva ?? 0,
        page: 1,
        itemsPerPage: 20,
        search: "",
        filters: JSON.stringify([
          { name: "date", searchValues: [], sortOrder: "desc" },
          { name: "customer", searchValues: [nombreCliente], sortOrder: null },
        ]),
      })
      .then((res: any) => {
        if (cancel) return;
        if (res?.ok === false) throw new Error(res.msg || "No se pudieron cargar los pedidos");
        let filas = Array.isArray(res?.pedidos) ? res.pedidos : [];
        // homónimos: mismo nombre con otro teléfono se quedan fuera
        if (telCliente) {
          filas = filas.filter(
            (p: any) => !claveTelefono(p?.Movil) || claveTelefono(p?.Movil) === telCliente,
          );
        }
        // y fuera el pedido que estamos viendo
        filas = filas.filter((p: any) => String(p?.id ?? p?.idPedido) !== String(id));
        setOtros(filas.slice(0, 10));
        setTotalOtros(Number(res?.totalRecords) || 0);
      })
      .catch((e) => {
        if (!cancel) setErrorOtros(errMsg(e));
      })
      .finally(() => {
        if (!cancel) setCargandoOtros(false);
      });
    return () => {
      cancel = true;
    };
  }, [id, nombreCliente, telCliente, session?.tiendaActiva]);

  const sucio =
    snapshot !== "" &&
    JSON.stringify({ form, obs, items, ubicacion }) !== snapshot;

  // aviso del navegador si cierran la pestana con cambios pendientes
  useEffect(() => {
    if (!sucio) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sucio]);

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  // totales derivados de las lineas
  const totales = useMemo(() => {
    const sub = items.reduce((acc, it) => acc + num(it.price) * num(it.quantity, 1), 0);
    const envio = num(form.CostoEnvio);
    return { sub, envio, total: sub + envio };
  }, [items, form.CostoEnvio]);

  // datos de la guia (seccion "Envio" del panel oficial); solo lectura
  const envio = datosEnvio(original);

  const actualizarLinea = (i: number, patch: Record<string, any>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  /** Desplegable de producto: al elegirlo rellena el precio del catalogo */
  const seleccionarProducto = (i: number, clave: string) => {
    const p = catalogo.find((c) => prodId(c) === clave);
    actualizarLinea(i, p ? { product_id: clave, price: prodPrice(p) } : { product_id: clave });
  };

  /** Opciones del combo: catalogo + precio a la derecha, y el id actual si no esta. */
  const opcionesProducto = (valorActual: string) => {
    const base: OpcionCombo[] = catalogo.map((p) => {
      const precio = prodPrice(p);
      return {
        id: prodId(p),
        nombre: prodName(p),
        nota: precio ? money(precio) : undefined,
        img: prodImg(p) || undefined,
      };
    });
    if (valorActual && !base.some((o) => o.id === valorActual)) {
      base.unshift({ id: valorActual, nombre: `${valorActual} (id actual)` });
    }
    return base;
  };

  const agregarObservacion = () => {
    const texto = nuevaObs.trim();
    if (!texto) return;
    setObs((arr) => [
      ...arr,
      {
        desc: texto,
        update: new Date().toISOString().slice(0, 19),
        user: session?.user?.name || session?.user?.email || "System",
      },
    ]);
    setNuevaObs("");
  };

  const guardar = async (
    overrides: { EstadoPedido?: number; motivo?: string } = {},
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        id: num(form.id),
        idPedido: num(form.idPedido),
        idEmpresa: num(form.idEmpresa, session?.tiendaActiva ?? 0),
        Nombre: String(form.Nombre ?? ""),
        Apellido: String(form.Apellido ?? ""),
        NIT: String(form.NIT ?? ""),
        Correo: String(form.Correo ?? ""),
        Movil: String(form.Movil ?? ""),
        Direccion: String(form.Direccion ?? ""),
        verifiedAddress: String(form.verifiedAddress ?? ""),
        Pais: num(ubicacion.pais),
        codigoPostal: String(form.codigoPostal ?? ""),
        Departamento: num(ubicacion.departamento),
        Ciudad: num(ubicacion.ciudad),
        Observaciones: JSON.stringify(obs),
        EstadoPedido: overrides.EstadoPedido ?? num(form.EstadoPedido),
        Json: JSON.stringify(items),
        SubTotal: String(totales.sub.toFixed(2)),
        CostoEnvio: String(totales.envio.toFixed(2)),
        Total: String(totales.total.toFixed(2)),
        TipoPago: num(form.TipoPago),
        EstadoPago: num(form.EstadoPago),
        logistic: String(form.logistic ?? ""),
        Referencias: String(form.Referencias ?? ""),
        // el backend acepta el motivo solo al cancelar
        ...(overrides.motivo ? { motivo: overrides.motivo } : {}),
      };
      const res: any = await pedidos.update(body);
      toast.success(res?.msg ?? "Pedido actualizado");

      if (overrides.EstadoPedido === 2) await sincronizarIntegracion("CONFIRMED");
      if (overrides.EstadoPedido === 1) await sincronizarIntegracion("REJECTED");

      cargar();
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // venndelo usa {id, confirmation_status}; rocket usa {orderId, confirmation_status}
  const sincronizarIntegracion = async (status: "CONFIRMED" | "REJECTED") => {
    const p = original ?? {};
    try {
      if (p.dropshippingProvider === "venndelo" && p.idPedidoExterno) {
        await pedidos.confirm("venndelo", { id: p.id, confirmation_status: status });
      } else if (p.dropshippingProvider === "rocket" && p.idPedidoDropi) {
        await pedidos.confirm("rocket", { orderId: p.idPedidoDropi, confirmation_status: status });
      }
    } catch {
      /* la sincronizacion con el proveedor es best-effort */
    }
  };

  /**
   * Tras subirlo a Dropi: el panel oficial marca el pedido como «Creado»
   * (EstadoFullfilment) y lo pasa a Confirmado. El snapshot se recalcula
   * para no dejar el aviso de "cambios sin guardar".
   */
  const subidoEnDropi = () => {
    const nuevoForm = { ...form, EstadoFullfilment: "Creado", EstadoPedido: 2 };
    setOriginal((o: any) => (o ? { ...o, EstadoFullfilment: "Creado", EstadoPedido: 2 } : o));
    setForm(nuevoForm);
    setSnapshot(JSON.stringify({ form: nuevoForm, obs, items, ubicacion }));
  };

  /**
   * Cambio de estado via NUESTRO backend: POST /api/pedidos/:id/estado.
   * Si hay ediciones sin guardar se guardan primero para no perderlas.
   */
  const aplicarEstado = async (estado: number, motivo?: string) => {
    setSaving(true);
    try {
      if (sucio) {
        const guardado = await guardar();
        if (!guardado) return;
      }

      const idPedido = Number(id) || num(form.id);
      const r = await cambiarEstadoPedido(idPedido, estado, motivo, {
        quien: session?.user?.name ?? session?.user?.email ?? undefined,
      });

      toast.success(
        `#${form.idPedido ?? idPedido}: ${ESTADOS_PEDIDO[estado]}${r.directo ? " · API directa" : ""}`,
      );

      if (estado === 2) await sincronizarIntegracion("CONFIRMED");
      if (estado === 1) await sincronizarIntegracion("REJECTED");

      cargar();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  /** Manejo centralizado de los dialogs (confirmar / cancelar con motivo / salir) */
  const resolverDialogo = async (motivo: string) => {
    const tipo = dialogo;
    setDialogo(null);
    if (tipo === "confirmar") await aplicarEstado(2);
    else if (tipo === "cancelar") await aplicarEstado(1, motivo);
    else if (tipo === "salir") navigate(destino);
  };

  const confirmarPedido = () => setDialogo("confirmar");
  const cancelarPedido = () => setDialogo("cancelar");

  /** Volver atras avisando si hay cambios sin guardar */
  const volver = () => {
    if (sucio) {
      setDestino("/pedidos");
      setDialogo("salir");
    } else {
      navigate("/pedidos");
    }
  };

  /** Ir al pedido anterior / siguiente de la lista */
  const irA = (vid: number | null) => {
    if (vid === null) return;
    const url = `/pedidos/${vid}`;
    if (sucio) {
      setDestino(url);
      setDialogo("salir");
    } else {
      navigate(url);
    }
  };

  const descartarCambios = () => {
    cargar();
    toast.info("Cambios descartados");
  };

  if (loading) return <Spinner label="Cargando pedido..." />;

  if (!original) {
    return (
      <>
        <ErrorBanner error={error} />
        <button className="btn" onClick={() => navigate("/pedidos")}>
          ← Volver
        </button>
      </>
    );
  }

  return (
    <div className="pedido-detalle-page">
      <PageHeader
        title={`Pedido #${form.idPedido ?? id}`}
        subtitle={[
          [form.Nombre, form.Apellido].filter(Boolean).join(" ") || "Sin nombre",
          etiqueta(form.idEmpresa ?? session?.tiendaActiva),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <EstadoBadge value={num(form.EstadoPedido)} />
            <span className="nav-pedidos" title="Moverte por la lista de pedidos">
              <button
                className="btn sm"
                onClick={() => irA(vecinos.anterior)}
                disabled={vecinos.anterior === null}
              >
                ‹ Anterior
              </button>
              <button
                className="btn sm"
                onClick={() => irA(vecinos.siguiente)}
                disabled={vecinos.siguiente === null}
              >
                Siguiente ›
              </button>
            </span>
            <button className="btn" onClick={volver}>
              ← Volver
            </button>
            <button
              className="btn danger"
              onClick={cancelarPedido}
              disabled={saving || num(form.EstadoPedido) === 1}
            >
              Cancelar pedido
            </button>
            <button
              className="btn"
              onClick={confirmarPedido}
              disabled={saving || num(form.EstadoPedido) === 2}
            >
              Confirmar
            </button>
            <button className="btn primary" onClick={() => guardar()} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </>
        }
      />

      <ErrorBanner error={error} />

      <BloqueEtiquetas idPedido={form.id ?? id} numero={form.idPedido ?? id} />

      <div className="grid-2 pedido-resumen-grid">
        <section className="card pedido-card pedido-cliente-card">
          <div className="card-title">Cliente</div>
          <div className="form-grid">
            <div className="field">
              <label>Nombre</label>
              <input value={form.Nombre} onChange={(e) => set("Nombre", e.target.value)} />
            </div>
            <div className="field">
              <label>Apellido</label>
              <input value={form.Apellido} onChange={(e) => set("Apellido", e.target.value)} />
            </div>
            <div className="field">
              <label>Movil</label>
              <input value={form.Movil} onChange={(e) => set("Movil", e.target.value)} />
              {(() => {
                const tel = telefono(form.Movil);
                const url = inbox(form.Movil);
                if (!tel && !url) return null;
                return (
                  <div className="tel-links" style={{ marginTop: 4 }}>
                    {tel && (
                      <a href={`tel:${tel.tel}`} title="Llamar">
                        📞 Llamar
                      </a>
                    )}
                    {tel && (
                      <a
                        href={`https://wa.me/${tel.wa}`}
                        target="_blank"
                        rel="noreferrer"
                        title="WhatsApp"
                      >
                        WhatsApp
                      </a>
                    )}
                    {url && (
                      <a
                        className="inbox-link"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir la conversacion en el inbox de LucidBot"
                      >
                        💬 Chat del bot
                      </a>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="field">
              <label>Correo</label>
              <input value={form.Correo} onChange={(e) => set("Correo", e.target.value)} />
            </div>
            <div className="field">
              <label>NIT</label>
              <input value={form.NIT} onChange={(e) => set("NIT", e.target.value)} />
            </div>
            <div className="field">
              <label>Referencias</label>
              <input value={form.Referencias} onChange={(e) => set("Referencias", e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Direccion</label>
            <input value={form.Direccion} onChange={(e) => set("Direccion", e.target.value)} />
            <ValidarDireccion
              id={form.id ?? id!}
              direccion={String(form.Direccion ?? "")}
              onUsar={(dir) => {
                set("Direccion", dir);
                toast.success("Dirección puesta en el formulario (no olvides guardar)");
              }}
              onGuardada={(dir) => {
                set("Direccion", dir);
                setOriginal((o: any) => (o ? { ...o, Direccion: dir } : o));
              }}
            />
          </div>

          <div className="form-grid">
            <LocationPicker value={ubicacion} onChange={setUbicacion} />
            <div className="field">
              <label>Codigo postal</label>
              <input
                value={form.codigoPostal}
                onChange={(e) => set("codigoPostal", e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card pedido-card pedido-estado-card">
          <div className="card-title">Estado y pago</div>
          <div className="form-grid">
            <div className="field">
              <label title="Campo EstadoFullfilment del pedido">
                Estado de envío
              </label>
              <div className="valor-solo">
                <EnvioConBot
                  valor={original?.EstadoFullfilment}
                  bot={enviosBot[String(original?.id ?? original?.idPedido ?? "")]}
                />
                {!original?.EstadoFullfilment && !enviosBot[String(original?.id ?? original?.idPedido ?? "")] && (
                  <span className="muted small">Aun sin envio asignado</span>
                )}
              </div>
            </div>
            <div className="field">
              <label>Transportadora</label>
              <div className="valor-solo">
                {original?.transportadora ? (
                  <strong>{original.transportadora}</strong>
                ) : (
                  <span className="muted">Sin transportadora</span>
                )}
              </div>
            </div>
            <div className="field">
              <label>Estado del pedido</label>
              <select
                value={form.EstadoPedido}
                onChange={(e) => set("EstadoPedido", Number(e.target.value))}
              >
                {Object.entries(ESTADOS_PEDIDO).map(([v, label]) => (
                  <option key={v} value={Number(v)}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tipo de pago</label>
              <select
                value={form.TipoPago}
                onChange={(e) => set("TipoPago", Number(e.target.value))}
              >
                {Object.entries(TIPOS_PAGO).map(([valor, label]) => (
                  <option key={valor} value={valor}>
                    {valor} · {label}
                  </option>
                ))}
                {![1, 2].includes(Number(form.TipoPago)) && (
                  <option value={form.TipoPago}>
                    {form.TipoPago} · (valor actual)
                  </option>
                )}
              </select>
            </div>
            <div className="field">
              <label>Estado de pago</label>
              <input
                type="number"
                value={form.EstadoPago}
                onChange={(e) => set("EstadoPago", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Logistica</label>
              <input value={form.logistic} onChange={(e) => set("logistic", e.target.value)} />
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 8 }}>
            Totales
          </div>
          <table className="table tabla-compacta">
            <tbody>
              <tr>
                <td>Subtotal (calculado)</td>
                <td>{money(totales.sub)}</td>
              </tr>
              <tr>
                <td>Costo de envio</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={form.CostoEnvio}
                    onChange={(e) => set("CostoEnvio", e.target.value)}
                    style={{ maxWidth: 160 }}
                  />
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>{money(totales.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="card pedido-card pedido-otros-card">
        <div className="row between wrap">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Otros pedidos{nombreCliente ? ` de ${nombreCliente}` : ""}
          </div>
          {nombreCliente ? (
            <Link
              className="btn sm"
              to={`/pedidos?cliente=${encodeURIComponent(nombreCliente)}${
                telCliente ? `&tel=${telCliente}` : ""
              }`}
            >
              Ver todos →
            </Link>
          ) : null}
        </div>

        {cargandoOtros ? (
          <Spinner label="Buscando los pedidos de este cliente..." />
        ) : errorOtros ? (
          <ErrorBanner error={errorOtros} />
        ) : otros.length === 0 ? (
          <p className="muted">Sin más pedidos de este cliente en esta tienda.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 8 }}>
              {totalOtros} pedido(s) con ese nombre · se muestran {otros.length} y se descartan
              los homónimos con otro teléfono.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th className="hide-sm">Teléfono</th>
                    <th>Estado</th>
                    <th>Envío</th>
                    <th className="hide-sm">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {otros.map((p) => {
                    const pid = p?.id ?? p?.idPedido;
                    const tel = telefono(p?.Movil);
                    return (
                      <tr key={String(pid)}>
                        <td>
                          <Link to={`/pedidos/${pid}`}>
                            <strong>#{p?.idPedido ?? pid}</strong>
                          </Link>
                        </td>
                        <td>{haceCuanto(p?.Fecha) || fmtFecha(p?.Fecha) || "—"}</td>
                        <td className="hide-sm">{tel ? tel.visible : "—"}</td>
                        <td>
                          <EstadoBadge value={p?.EstadoPedido} />
                        </td>
                        <td>
                          <EnvioConBot valor={p?.EstadoFullfilment} bot={enviosBot[String(pid)]} />
                        </td>
                        <td className="hide-sm">{money(p?.Total)}</td>
                        <td>
                          <Link className="btn sm" to={`/pedidos/${pid}`}>
                            Abrir →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card pedido-card pedido-envio-card">
        <div className="card-title">Envío y guías</div>
        {envio.length > 0 ? (
          <>
            <div className="form-grid">
              {envio.map((d) => (
                <div className="field" key={d.label}>
                  <label title={`Campo ${d.label} del pedido (solo lectura)`}>{d.label}</label>
                  <div className="valor-solo">{d.valor}</div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Datos de solo lectura que devuelve <code>get-pedido-by-id</code>, tal como los
              pinta el panel oficial en su sección «Envío»: aqui no se pueden editar.
            </p>
          </>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Este pedido todavia no tiene guia: todavia no lo ha tomado ningun proveedor de
            envios (Dropi, Rocket, Hoko...).
          </p>
        )}
      </section>

      <SubirPedidoDropi
        id={form.id ?? id}
        onConfirmado={() => {
          setForm((f) => ({ ...f, EstadoPedido: 2, EstadoFullfilment: "Creado" }));
          setOriginal((o: any) => (o ? { ...o, EstadoPedido: 2, EstadoFullfilment: "Creado" } : o));
        }}
      />

      <BloqueOficinaInter
        departamento={
          ubicacion.pais !== null && ubicacion.pais !== 47 ? null : ubicacion.departamento
        }
        ciudad={ubicacion.ciudad}
        resaltar={/interrap/i.test(String(original?.transportadora ?? ""))}
        direccionActual={String(form.Direccion ?? "")}
        onUsarDireccion={(dir) => {
          set("Direccion", dir);
          toast.success("Dirección cambiada por la oficina de Inter (no olvides guardar)");
        }}
      />

      <section className="card pedido-card pedido-productos-card">
        <div className="card-title">Productos del pedido</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Cant.</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>
                    {catalogo.length > 0 ? (
                      <Combo
                        className="combo-inline"
                        placeholder="-- Seleccionar producto --"
                        opciones={opcionesProducto(String(it.product_id ?? ""))}
                        valor={String(it.product_id ?? "")}
                        onChange={(id) => seleccionarProducto(i, id ?? "")}
                      />
                    ) : (
                      <input
                        value={it.product_id ?? ""}
                        onChange={(e) => actualizarLinea(i, { product_id: e.target.value })}
                        style={{ minWidth: 150 }}
                        placeholder={catalogoCargando ? "Cargando catalogo..." : "product_id"}
                      />
                    )}
                    <div className="row gap" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <StockDropi
                        productId={String(it.product_id ?? "")}
                        fila={catalogo.find((p) => prodId(p) === String(it.product_id))}
                      />
                      {String(it.product_id ?? "").trim() ? (
                        <Link
                          className="link-plain"
                          title="Abrir este producto"
                          to={`/productos?editar=${encodeURIComponent(String(it.product_id))}`}
                        >
                          → Ver producto
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={it.price ?? 0}
                      onChange={(e) => actualizarLinea(i, { price: Number(e.target.value) })}
                      style={{ minWidth: 130 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={it.quantity ?? 1}
                      onChange={(e) => actualizarLinea(i, { quantity: Number(e.target.value) })}
                      style={{ minWidth: 80 }}
                    />
                  </td>
                  <td>{money(num(it.price) * num(it.quantity, 1))}</td>
                  <td>
                    <button
                      className="btn sm danger"
                      onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Sin lineas de producto
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          className="btn sm"
          style={{ marginTop: 10 }}
          onClick={() =>
            setItems((arr) => [...arr, { product_id: "", price: 0, variations: [], quantity: 1 }])
          }
        >
          + Agregar linea
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {catalogoCargando
            ? "Cargando catalogo de productos..."
            : catalogo.length > 0
              ? `${catalogo.length} productos disponibles en el catalogo (POST /productos/getproductos).`
              : "Catalogo no disponible: se puede escribir el product_id a mano."}
        </p>
      </section>

      <details className="card pedido-card pedido-cotizador-card">
        <summary className="card-title">Cotizador de envios (este pedido)</summary>
        <p className="muted small">
          Elige transportador y pulsa <strong>Cotizar</strong> para ver el precio del envío de{" "}
          <strong>este</strong> pedido.
        </p>
        <CotizadorPedido
          pedido={original}
          compacto
          antesDeSubir={async () => (sucio ? guardar() : true)}
          onSubido={subidoEnDropi}
        />
      </details>

      <section className="card pedido-card pedido-historial-card">
        <div className="card-title">Historial y observaciones</div>
        {obs.length === 0 && <p className="muted">Sin observaciones todavia.</p>}
        <div className="timeline">
          {obs.map((o, i) => (
            <div className="observacion" key={i}>
              <span className="obs-avatar">{String(o?.user ?? "S").charAt(0).toUpperCase()}</span>
              <div className="obs-body">
                <div className="obs-head">
                  <strong>{o?.user ?? "Sistema"}</strong>
                  <span className="meta" title={fmtFecha(o?.update)}>
                    {haceCuanto(o?.update) || fmtFecha(o?.update)}
                  </span>
                </div>
                <div>{o?.desc ?? String(o)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="row gap" style={{ marginTop: 8 }}>
          <input
            placeholder="Nueva observacion..."
            value={nuevaObs}
            onChange={(e) => setNuevaObs(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && agregarObservacion()}
          />
          <button className="btn" onClick={agregarObservacion} disabled={!nuevaObs.trim()}>
            Agregar
          </button>
        </div>
      </section>

      <details className="card pedido-card pedido-json-card">
        <summary className="card-title">Datos técnicos del pedido</summary>
        <JsonView data={original} />
      </details>

      {/* Barra fija mientras haya cambios sin guardar */}
      {sucio && (
        <div className="dirty-bar">
          <span>
            <span className="dot" /> Tienes cambios sin guardar
          </span>
          <div className="row gap">
            <button className="btn ghost" onClick={descartarCambios} disabled={saving}>
              Descartar
            </button>
            <button className="btn primary" onClick={() => guardar()} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={dialogo === "confirmar"}
        title="Confirmar pedido"
        message={
          <>
            El pedido <strong>#{form.idPedido}</strong> pasará a{" "}
            <strong>{ESTADOS_PEDIDO[2]}</strong>. Si hay integracion activa se sincronizara con el
            proveedor.
          </>
        }
        confirmLabel="Confirmar pedido"
        loading={saving}
        onConfirm={resolverDialogo}
        onCancel={() => setDialogo(null)}
      />

      <ConfirmDialog
        open={dialogo === "cancelar"}
        title="Cancelar pedido"
        message={
          <>
            Vas a cancelar el pedido <strong>#{form.idPedido}</strong>. Esta accion se sincroniza
            con el proveedor si hay integracion activa.
          </>
        }
        inputLabel="Motivo de la cancelacion"
        inputPlaceholder="ej. Cliente pide anular la compra"
        confirmLabel="Cancelar pedido"
        danger
        loading={saving}
        onConfirm={resolverDialogo}
        onCancel={() => setDialogo(null)}
      />

      <ConfirmDialog
        open={dialogo === "salir"}
        title="Salir sin guardar"
        message="Tienes cambios sin guardar en este pedido. Si sales ahora se perderan."
        confirmLabel="Salir y descartar"
        danger
        loading={saving}
        onConfirm={resolverDialogo}
        onCancel={() => setDialogo(null)}
      />
    </div>
  );
}
