// Productos agotados en Dropi: los que frenaron pedidos en la subida
// automatica (veredicto "sin-stock"), con sus pedidos y si ya repusieron
// segun la foto del catalogo de anoche.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { fmtFecha, haceCuanto } from "../lib/format";
import { useToast } from "./Toast";

interface PedidoAgotado {
  id: string;
  numero: number | string | null;
  cliente: string;
  telefono: string;
  ts: string;
}
interface Agotado {
  clave: string;
  idDropi: string | null;
  nombre: string | null;
  url: string | null;
  stock: string | null;
  stockCatalogo: number | null;
  pedidos: PedidoAgotado[];
  desde: string;
  hasta: string;
}

export function ProductosAgotados({ compacto = false }: { compacto?: boolean }) {
  const toast = useToast();
  const [lista, setLista] = useState<Agotado[] | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => {
    void backendSuave<{ ok: boolean; productos?: Agotado[]; fotoCatalogo?: string | null }>("/api/subida/agotados").then((r) => {
      setLista(r?.ok ? r.productos ?? [] : []);
      setFoto(r?.fotoCatalogo ?? null);
    });
  }, []);
  useEffect(cargar, [cargar]);

  const reintentar = async (g: Agotado) => {
    setOcupado(g.clave);
    try {
      for (const p of g.pedidos) await backend("/api/subida/reintentar", { method: "POST", body: { id: String(p.id) } });
      toast.success(`${g.pedidos.length} pedido(s) se vuelven a intentar en la próxima vuelta de la subida`);
      cargar();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(null);
    }
  };

  if (!lista || (!lista.length && compacto)) return null;
  const totalPedidos = lista.reduce((a, g) => a + g.pedidos.length, 0);

  return (
    <section className="card agotados">
      <div className="card-title row between wrap">
        <span>⛔ Productos agotados en Dropi</span>
        {lista.length ? (
          <span className="muted small">
            {lista.length} producto(s) · {totalPedidos} pedido(s) frenados
          </span>
        ) : null}
      </div>
      {!lista.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          Ningún pedido frenado por falta de stock. Cuando la subida encuentre un producto agotado en Dropi, aparece aquí.
        </p>
      ) : (
        <div className="agotados-lista">
          {lista.map((g) => {
            const repuso = typeof g.stockCatalogo === "number" && g.stockCatalogo > 0;
            return (
              <div key={g.clave} className={`agotado${repuso ? " repuso" : ""}`}>
                <div className="agotado-head">
                  <div className="agotado-info">
                    <strong>{g.nombre || `Producto ${g.idDropi ?? ""}`}</strong>
                    <span className="muted small">
                      {g.idDropi ? `ID Dropi ${g.idDropi} · ` : ""}
                      agotado desde {haceCuanto(g.desde) || fmtFecha(g.desde)}
                      {g.stock ? ` · Dropi decía «${g.stock}»` : ""}
                    </span>
                    {repuso ? (
                      <span className="agotado-repuso">
                        ✅ Ya tiene stock ({g.stockCatalogo} u. en la revisión del catálogo{foto ? ` del ${foto}` : ""}): reintenta sus pedidos
                      </span>
                    ) : g.stockCatalogo === 0 ? (
                      <span className="muted small">Sigue sin stock en la revisión del catálogo{foto ? ` del ${foto}` : ""}</span>
                    ) : null}
                  </div>
                  <div className="row gap agotado-acciones">
                    <button type="button" className="btn sm" onClick={() => setAbierto(abierto === g.clave ? null : g.clave)}>
                      {g.pedidos.length} pedido(s) {abierto === g.clave ? "▴" : "▾"}
                    </button>
                    {g.url ? (
                      <a className="btn sm" href={g.url} target="_blank" rel="noreferrer">
                        Ver en Dropi
                      </a>
                    ) : null}
                    <button type="button" className={`btn sm${repuso ? " primary" : ""}`} disabled={ocupado === g.clave} onClick={() => void reintentar(g)}>
                      {ocupado === g.clave ? "…" : "Reintentar pedidos"}
                    </button>
                  </div>
                </div>
                {abierto === g.clave ? (
                  <div className="agotado-pedidos">
                    {g.pedidos.map((p) => (
                      <Link key={p.id} to={`/pedidos/${p.id}`} className="agotado-pedido">
                        <strong>#{p.numero ?? p.id}</strong>
                        <span>{p.cliente || "Sin nombre"}</span>
                        <span className="muted small">{haceCuanto(p.ts) || fmtFecha(p.ts)}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
