import { useState } from "react";
import { errMsg } from "../api/client";
import { pedidos, TIPOS_PAGO, TRANSPORTADORES } from "../api/endpoints";
import { ErrorBanner, JsonView, money } from "./ui";
import { useToast } from "./Toast";

/**
 * Cotizador embebible: recibe el pedido ya cargado y ejecuta
 * POST /pedidos/quote/{transportador} sobre el. Lo usa el detalle de
 * cada pedido.
 */

interface Quote {
  transportadora_id: number | string;
  transportadora?: string;
  transportadora_minuscula?: string;
  transportadora_service?: string;
  distributionCompany?: { id?: number; name?: string; color?: string | null; [k: string]: any };
  objects?: {
    precioEnvio?: number;
    seguroEnvio?: number | null;
    trayecto?: string;
    [k: string]: any;
  };
  error?: any;
  [k: string]: any;
}

/** Nombre visible de la transportadora (la respuesta trae id y nombre). */
function nombreTransportadora(q: Quote): string {
  return (
    q.transportadora ||
    q.distributionCompany?.name ||
    String(q.transportadora_id ?? "—")
  );
}

/** Precio o "-" si no viene. */
const precio = (v: unknown) =>
  v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v);

/** De menor a mayor precio; las que fallaron quedan al final. */
function ordenaPorPrecio(arr: Quote[]): Quote[] {
  return [...arr].sort((a, b) => {
    const pa = precio(a.objects?.precioEnvio) ?? Infinity;
    const pb = precio(b.objects?.precioEnvio) ?? Infinity;
    return pa - pb;
  });
}

function cuerpoBase(p: any) {
  return {
    id: p.id,
    direccion: p.Direccion,
    tipoPago: p.TipoPago,
    ciudad: p.Ciudad,
    departamento: p.Departamento,
    referencias: p.Referencias || "",
  };
}

export function CotizadorPedido({
  pedido,
  compacto,
  antesDeSubir,
  onSubido,
}: {
  pedido: any;
  /** true = sin tabla resumen (ya se esta viendo el pedido) */
  compacto?: boolean;
  /** se ejecuta antes de subir (el oficial guarda el pedido primero). */
  antesDeSubir?: () => Promise<boolean>;
  /** aviso al padre tras subirla (para marcar el estado en el panel). */
  onSubido?: () => void;
}) {
  const toast = useToast();
  const [transportista, setTransportista] = useState<string>(TRANSPORTADORES[0]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [sugerida, setSugerida] = useState<number | string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [stocks, setStocks] = useState<any[] | null>(null);
  const [courierId, setCourierId] = useState("");
  const [resultado, setResultado] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cotizar = async () => {
    if (!pedido) return;
    setLoading(true);
    setError(null);
    setQuotes([]);
    setSugerida(null);
    setFeedback(null);
    setResultado(null);
    try {
      let body: unknown;
      if (transportista === "hoko") {
        if (!stocks) throw new Error("Primero verifica el stock (botón inferior)");
        body = { id: pedido.id, stocks };
      } else {
        body = cuerpoBase(pedido);
        if (transportista === "dropi") body = { ...(body as object), total: pedido.Total };
        if (transportista === "enviapuntocom") body = { ...(body as object), pais: pedido.Pais };
      }

      const res: any = await pedidos.quote(transportista, body);
      setResultado(res);
      const validas = Array.isArray(res?.quotes)
        ? res.quotes
            .filter((q: Quote) => !q.error && q.objects)
            .sort(
              (a: Quote, b: Quote) =>
                (a.objects?.precioEnvio ?? Infinity) - (b.objects?.precioEnvio ?? Infinity),
            )
        : [];
      if (res?.ok && Array.isArray(res.quotes)) {
        setQuotes(res.quotes);
        if (res.quotes.length) toast.success(`${res.quotes.length} cotizaciones recibidas`);
        else toast.info("La API respondio sin cotizaciones");
        if (res.suggestedTransportadoraId) {
          setSugerida(res.suggestedTransportadoraId);
        } else if (validas[0]) {
          setSugerida(validas[0].transportadora_id);
        }
        // Dropi: como hace el oficial, preselecciona la sugerida (o la mas barata)
        if (transportista === "dropi" && (res.suggestedTransportadoraId || validas[0])) {
          const sugeridaQuote = res.suggestedTransportadoraId
            ? res.quotes.find(
                (q: Quote) =>
                  String(q.transportadora_id) === String(res.suggestedTransportadoraId) &&
                  !q.error,
              )
            : null;
          const objetivo = sugeridaQuote ?? validas[0];
          if (objetivo) setCourierId(String(objetivo.transportadora_id));
        }
      } else {
        const fb = res?.feedback ?? "La API no devolvio cotizaciones";
        setFeedback(fb);
        toast.error(fb);
      }
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const verificarStock = async () => {
    if (!pedido) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await pedidos.checkUpload(pedido.id);
      if (res?.ok) {
        setStocks(res.stocks ?? []);
        toast.success("Inventario verificado");
      } else {
        const msg = res?.msg ?? "No se pudo verificar el inventario";
        setError(msg);
        toast.error(msg);
      }
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const subirHoko = async () => {
    if (!pedido || !stocks || !courierId) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await pedidos.uploadHoko({
        id: pedido.id,
        stocks,
        courier_id: Number(courierId),
      });
      setResultado(res);
      if (res?.ok) {
        toast.success("Subida a Hoko confirmada");
      } else {
        const msg = res?.feedback ?? res?.msg ?? "Hoko rechazo la subida";
        setError(msg);
        toast.error(msg);
      }
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * POST /pedidos/upload/dropi {id, transportadora_id?}.
   * Como el oficial: guarda primero el pedido (antesDeSubir) y, si hay
   * transportadora elegida, la manda; si no, Dropi resuelve la suya.
   */
  const subirDropi = async () => {
    if (!pedido) return;
    setLoading(true);
    setError(null);
    try {
      if (antesDeSubir) {
        const ok = await antesDeSubir();
        if (!ok) return; // no se guardo: no se sube nada
      }
      const res: any = await pedidos.uploadDropi({
        id: pedido.id,
        // el id de la transportadora viaja como numero (como en el oficial)
        ...(courierId
          ? { transportadora_id: /^\d+$/.test(courierId) ? Number(courierId) : courierId }
          : {}),
      });
      setResultado(res);
      if (res?.ok) {
        toast.success(res.feedback || res.msg || "Pedido subido a Dropi");
        onSubido?.();
      } else {
        const msg = res?.feedback ?? res?.msg ?? "Dropi rechazo la subida";
        setError(msg);
        toast.error(msg);
      }
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const validarDireccion = async () => {
    if (!pedido) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await pedidos.validateAddress({
        direccion: pedido.Direccion,
        ciudad: pedido.Ciudad,
        departamento: pedido.Departamento,
        pais: pedido.Pais,
      });
      setResultado(res);
      toast.success("Direccion validada (ver respuesta abajo)");
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  if (!pedido) return null;

  const idDropiActual = String(pedido.idPedidoDropi ?? "");
  const yaEnDropi = Boolean(idDropiActual) && idDropiActual !== "0" && idDropiActual !== "null";
  const cotizada = quotes.find((q) => String(q.transportadora_id) === courierId);

  return (
    <>
      {!compacto && (
        <table className="table" style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <td>Direccion</td>
              <td className="wrap">{pedido.Direccion}</td>
            </tr>
            <tr>
              <td>Ciudad / Depto / Pais</td>
              <td>
                {pedido.Ciudad} / {pedido.Departamento} / {pedido.Pais}
              </td>
            </tr>
            <tr>
              <td>Tipo de pago</td>
              <td>
                {pedido.TipoPago} · {TIPOS_PAGO[pedido.TipoPago] ?? "desconocido"}
              </td>
            </tr>
            <tr>
              <td>Total</td>
              <td>{money(pedido.Total)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="row gap" style={{ flexWrap: "wrap" }}>
        <select
          value={transportista}
          onChange={(e) => setTransportista(e.target.value)}
          style={{ maxWidth: 240 }}
          aria-label="Transportador"
        >
          {TRANSPORTADORES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={cotizar} disabled={loading}>
          {loading ? "Cotizando..." : "Cotizar este pedido"}
        </button>
        <button className="btn" onClick={validarDireccion} disabled={loading}>
          Validar direccion
        </button>
        <button className="btn" onClick={verificarStock} disabled={loading}>
          Verificar stock (hoko)
        </button>
      </div>

      {transportista === "hoko" && (
        <p className="muted small">
          Hoko necesita <code>{"{id, stocks}"}</code>: usa "Verificar stock" primero y despues
          elige transportadora para subir el pedido.
        </p>
      )}

      <ErrorBanner error={error} />
      {feedback && <div className="banner error">{feedback}</div>}

      {quotes.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Envio</th>
                <th className="hide-sm">Seguro</th>
                <th className="hide-sm">Trayecto</th>
                <th>Error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordenaPorPrecio(quotes).map((q) => {
                const id = String(q.transportadora_id);
                const envio = precio(q.objects?.precioEnvio);
                const seguro = precio(q.objects?.seguroEnvio);
                const color = String(q.distributionCompany?.color ?? "").trim();
                return (
                  <tr key={id}>
                    <td className="wrap">
                      <span className="transportadora">
                        <span
                          className="color-dot"
                          style={{ background: color || "#94a3b8" }}
                          aria-hidden
                        />
                        <strong>{nombreTransportadora(q)}</strong>
                      </span>
                      <span className="muted small"> · id {id}</span>
                      {q.transportadora_id === sugerida && (
                        <span className="badge ok" style={{ marginLeft: 8 }}>
                          sugerida por la API
                        </span>
                      )}
                    </td>
                    <td>{envio !== null ? <strong>{money(envio)}</strong> : "—"}</td>
                    <td className="hide-sm">{seguro !== null ? money(seguro) : "—"}</td>
                    <td className="hide-sm">{q.objects?.trayecto || "—"}</td>
                    <td className="wrap">{q.error ? String(q.error) : "—"}</td>
                    <td>
                      {!q.error && (
                        <button
                          className={`btn sm${
                            courierId === id ? " primary" : ""
                          }`}
                          onClick={() => setCourierId(id)}
                        >
                          {courierId === id ? "Elegida ✓" : "Elegir"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(() => {
        const conPrecio = ordenaPorPrecio(quotes).filter(
          (q) => !q.error && precio(q.objects?.precioEnvio) !== null,
        );
        const mejor = conPrecio[0];
        const elegida = conPrecio.find((q) => String(q.transportadora_id) === courierId);
        if (!mejor) return null;
        return (
          <p className="muted small" style={{ marginBottom: 0, marginTop: 6 }}>
            Mas economica: <strong>{nombreTransportadora(mejor)}</strong> con{" "}
            {money(precio(mejor.objects?.precioEnvio)!)}
            {elegida && elegida !== mejor ? (
              <>
                {" · "}Elegida: <strong>{nombreTransportadora(elegida)}</strong>
              </>
            ) : null}
          </p>
        );
      })()}

      {transportista === "hoko" && stocks && (
        <div className="row gap" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={subirHoko} disabled={!courierId || loading}>
            Subir pedido a hoko
          </button>
          {!courierId && <span className="muted small">Elige una transportadora</span>}
        </div>
      )}

      {transportista === "dropi" &&
        (yaEnDropi ? (
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
            Este pedido ya está en Dropi: id <code>{idDropiActual}</code>.
          </p>
        ) : (
          <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={subirDropi} disabled={loading}>
              {loading ? "Subiendo..." : "Subir pedido a Dropi"}
            </button>
            <span className="muted small">
              {cotizada ? (
                <>
                  con <strong>{nombreTransportadora(cotizada)}</strong>
                </>
              ) : quotes.length > 0 ? (
                "sin transportadora elegida: cotiza y pulsa «Elegir»"
              ) : (
                "sin cotización: Dropi asignará la suya"
              )}
            </span>
          </div>
        ))}

      {resultado !== null && (
        <details className="card" style={{ marginTop: 12 }}>
          <summary className="card-title">Respuesta cruda</summary>
          <JsonView data={resultado} />
        </details>
      )}
    </>
  );
}
