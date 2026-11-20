// Buscador de pedidos dentro del detalle: por número, teléfono o nombre, sin
// tener que volver a la lista. Atajo: tecla "/".
import { useEffect, useRef, useState } from "react";
import { pedidos } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { haceCuanto, telefono } from "../lib/format";
import { EstadoBadge, money } from "./ui";

interface Resultado {
  id: number | string;
  numero: number | string;
  nombre: string;
  tel: string;
  fecha: string;
  estado: number;
  total: unknown;
}

export function BuscadorPedidos({ onIr, actual }: { onIr: (id: number | string) => void; actual?: number | string }) {
  const { session } = useAuth();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Resultado[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLInputElement>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // "/" enfoca el buscador (si no se esta escribiendo en otro campo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      caja.current?.focus();
    };
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", fuera);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", fuera);
    };
  }, []);

  useEffect(() => {
    const texto = q.trim().replace(/^#/, "");
    if (texto.length < 2) {
      setRes(null);
      return;
    }
    let vivo = true;
    setCargando(true);
    const t = setTimeout(() => {
      pedidos
        .list({
          idEmpresa: session?.tiendaActiva ?? 0,
          page: 1,
          itemsPerPage: 8,
          search: texto,
          filters: JSON.stringify([{ name: "date", searchValues: [], sortOrder: "desc" }]),
        })
        .then((r: any) => {
          if (!vivo) return;
          const filas = (Array.isArray(r?.pedidos) ? r.pedidos : []).map(
            (p: any): Resultado => ({
              id: p.id ?? p.idPedido,
              numero: p.idPedido ?? p.id,
              nombre: [p.Nombre, p.Apellido].filter(Boolean).join(" ").trim() || "Sin nombre",
              tel: telefono(p.Movil)?.visible ?? String(p.Movil ?? ""),
              fecha: p.Fecha ?? p.CreatedAt ?? "",
              estado: Number(p.EstadoPedido),
              total: p.Total,
            }),
          );
          setRes(filas);
          setActivo(0);
        })
        .catch(() => vivo && setRes([]))
        .finally(() => vivo && setCargando(false));
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q, session?.tiendaActiva]);

  const ir = (r: Resultado) => {
    setAbierto(false);
    setQ("");
    setRes(null);
    caja.current?.blur();
    onIr(r.id);
  };

  return (
    <div className="pd-buscador" ref={raiz}>
      <input
        ref={caja}
        type="search"
        value={q}
        placeholder="Buscar pedido: #, teléfono o nombre  ( / )"
        aria-label="Buscar pedido"
        onFocus={() => setAbierto(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setAbierto(true);
        }}
        onKeyDown={(e) => {
          if (!res?.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActivo((a) => Math.min(res.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActivo((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            ir(res[activo] ?? res[0]);
          } else if (e.key === "Escape") setAbierto(false);
        }}
      />
      {abierto && q.trim().replace(/^#/, "").length >= 2 ? (
        <div className="pd-buscador-lista" role="listbox">
          {cargando && !res ? <div className="muted small pd-buscador-vacio">Buscando…</div> : null}
          {res && !res.length ? <div className="muted small pd-buscador-vacio">Sin pedidos con «{q.trim()}»</div> : null}
          {(res ?? []).map((r, i) => (
            <button
              key={String(r.id)}
              type="button"
              role="option"
              aria-selected={i === activo}
              className={`pd-buscador-item${i === activo ? " activo" : ""}${String(r.id) === String(actual) ? " actual" : ""}`}
              onMouseEnter={() => setActivo(i)}
              onClick={() => ir(r)}
            >
              <strong>#{r.numero}</strong>
              <span className="pd-buscador-nombre">
                {r.nombre}
                <span className="muted small">
                  {r.tel ? ` · ${r.tel}` : ""}
                  {r.fecha ? ` · ${haceCuanto(r.fecha)}` : ""}
                </span>
              </span>
              <EstadoBadge value={r.estado} />
              <span className="small">{money(r.total)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
