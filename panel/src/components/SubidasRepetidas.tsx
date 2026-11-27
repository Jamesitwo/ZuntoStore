// Revision de subidas repetidas a Dropi: mismo pedido subido dos veces, o el
// mismo cliente con el mismo producto subido en pedidos distintos.
import { useState } from "react";
import { Link } from "react-router-dom";
import { backend } from "../api/backend";
import { errMsg } from "../api/client";
import { fmtFecha } from "../lib/format";

interface MismoPedido {
  id: string;
  numero: number | string | null;
  ordenesDropi: string[];
  subidas: number;
  inciertos: number;
  intentos: { ts: string; accion: string; origen: string; usuario: string | null; dropi: string | number | null }[];
}
interface MismoCliente {
  telefono: string;
  cliente: string;
  producto: string;
  pedidos: { id: string; ts: string; dropi: string | number | null }[];
}
interface Resultado {
  mismoPedido: MismoPedido[];
  mismoCliente: MismoCliente[];
  revisados: { pedidosSubidos: number; intentos: number };
}

export function SubidasRepetidas() {
  const [r, setR] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [dias, setDias] = useState(7);

  const revisar = async () => {
    setCargando(true);
    setError("");
    try {
      setR(await backend<Resultado>(`/api/subida/duplicados?dias=${dias}`));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <section className="card">
      <div className="card-title row between wrap">
        <span>🔁 ¿Se subió algo dos veces a Dropi?</span>
        <span className="row gap">
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Ventana de días">
            <option value={3}>3 días</option>
            <option value={7}>7 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
          </select>
          <button type="button" className="btn sm primary" disabled={cargando} onClick={() => void revisar()}>
            {cargando ? "Revisando…" : "Revisar"}
          </button>
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Revisa lo que subió Zunto (automática y manual). Lo que se creó directo en Dropi por fuera de Zunto no aparece aquí.
      </p>
      {error ? <p className="small" style={{ color: "#b42318" }}>{error}</p> : null}
      {r ? (
        <>
          <h4 style={{ margin: "10px 0 6px" }}>Mismo pedido subido más de una vez {r.mismoPedido.length ? `(${r.mismoPedido.length})` : ""}</h4>
          {r.mismoPedido.length ? (
            <div className="duplicados-lista">
              {r.mismoPedido.map((x) => (
                <div key={x.id} className="duplicado alerta">
                  <div className="row between wrap">
                    <Link to={`/pedidos/${x.id}`}>
                      <strong>Pedido #{x.numero ?? x.id}</strong>
                    </Link>
                    <span className="small">
                      {x.ordenesDropi.length > 1
                        ? `⚠ ${x.ordenesDropi.length} órdenes en Dropi: ${x.ordenesDropi.map((o) => `#${o}`).join(", ")} — anula las que sobren`
                        : x.inciertos
                          ? "⚠ subido y además un resultado incierto: revisa en Dropi si hay dos órdenes"
                          : `⚠ se marcó como subido ${x.subidas} veces: revisa en Dropi`}
                    </span>
                  </div>
                  <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {x.intentos.map((i, k) => (
                      <li key={k}>
                        {fmtFecha(i.ts)} · {i.accion}
                        {i.dropi ? ` · Dropi #${i.dropi}` : ""} · {i.origen}
                        {i.usuario ? ` (${i.usuario})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="small">✅ Ningún pedido subido dos veces.</p>
          )}

          <h4 style={{ margin: "14px 0 6px" }}>
            Mismo cliente y mismo producto en pedidos distintos ({dias} días) {r.mismoCliente.length ? `(${r.mismoCliente.length})` : ""}
          </h4>
          {r.mismoCliente.length ? (
            <div className="duplicados-lista">
              {r.mismoCliente.map((g, k) => (
                <div key={k} className="duplicado">
                  <div className="small">
                    <strong>{g.cliente || g.telefono}</strong> · {g.telefono} · {g.producto || "producto"}
                  </div>
                  <div className="row gap wrap small" style={{ marginTop: 4 }}>
                    {g.pedidos.map((p) => (
                      <Link key={p.id} to={`/pedidos/${p.id}`} className="chip">
                        #{p.id} · {fmtFecha(p.ts)}
                        {p.dropi ? ` · Dropi #${p.dropi}` : ""}
                      </Link>
                    ))}
                  </div>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>Puede ser una compra repetida de verdad: confirma con el cliente antes de anular.</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="small">✅ Ningún cliente con el mismo producto subido dos veces.</p>
          )}
          <p className="muted small">
            Se revisaron {r.revisados.pedidosSubidos} pedido(s) subidos y {r.revisados.intentos} intento(s).
          </p>
        </>
      ) : null}
    </section>
  );
}
