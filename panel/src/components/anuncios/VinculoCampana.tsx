// Vinculo campana -> producto, editable en la propia tabla de campanas.
// Sin vinculo la campana no se puede medir (no se sabe que ganancia deja).
import { useState } from "react";
import type { Campana } from "../../api/anuncios";

export function VinculoCampana({ campana, opciones, onVincular }: {
  campana: Campana;
  /** nombres de todos los productos cargados */
  opciones: string[];
  onVincular: (campana: string, productos: string[]) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [elegido, setElegido] = useState(campana.sugerido ?? "");
  const [guardando, setGuardando] = useState(false);

  const guardar = async (productos: string[]) => {
    setGuardando(true);
    try {
      await onVincular(campana.nombre, productos);
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  };

  if (!editando && !campana.sinProducto) {
    return (
      <span className="ads-vinculo">
        <span className="muted small">
          {campana.productos.slice(0, 2).join(" + ")}
          {campana.productos.length > 2 ? ` +${campana.productos.length - 2}` : ""}
        </span>
        {campana.compartida ? <span className="ads-compartida">compartida</span> : null}
        {campana.faltaGanancia.length ? (
          <span className="ads-malo small"> · sin ganancia</span>
        ) : null}
        <button type="button" className="btn-link small" onClick={() => setEditando(true)}>
          cambiar
        </button>
      </span>
    );
  }

  if (!opciones.length) {
    return (
      <span className="ads-malo small">
        Sin producto · primero importa tus productos (pestaña Productos)
      </span>
    );
  }

  const resto = opciones.filter((o) => o !== campana.sugerido);
  return (
    <span className="ads-vinculo editando">
      {campana.sinProducto ? <span className="ads-malo small">Sin producto</span> : null}
      <select
        className="field"
        value={elegido}
        onChange={(e) => setElegido(e.target.value)}
        aria-label={`Producto de la campaña ${campana.nombre}`}
      >
        <option value="">Elegir producto…</option>
        {campana.sugerido ? <option value={campana.sugerido}>{campana.sugerido} (sugerido)</option> : null}
        {resto.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <span className="ads-vinculo-botones">
        <button
          type="button"
          className="btn sm primary"
          disabled={!elegido || guardando}
          onClick={() => void guardar([elegido])}
        >
          {guardando ? "…" : "Vincular"}
        </button>
        {!campana.sinProducto ? (
          <>
            <button type="button" className="btn sm" disabled={guardando} onClick={() => void guardar([])}>
              Quitar
            </button>
            <button type="button" className="btn sm" disabled={guardando} onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </>
        ) : null}
      </span>
    </span>
  );
}
