// UI de etiquetas de pedidos (funcion propia,almacen local por tienda).
import { useRef, useState, type CSSProperties } from "react";
import { Modal, ConfirmDialog } from "./Modal";
import { useToast } from "./Toast";
import { errMsg } from "../api/client";
import {
  PALETA,
  exportarEtiquetas,
  importarEtiquetas,
  useEtiquetas,
  type Etiqueta,
} from "../lib/etiquetas";

/** Fondo tenue + borde del color de la etiqueta. */
export const chipStyle = (color: string): CSSProperties => ({
  background: `${color}26`,
  borderColor: `${color}66`,
});

export function ChipsDeEtiquetas({
  etiquetas,
  onQuitar,
}: {
  etiquetas: Etiqueta[];
  onQuitar?: (e: Etiqueta) => void;
}) {
  if (!etiquetas.length) return null;
  return (
    <span className="etiqueta-fila">
      {etiquetas.map((e) => (
        <span key={e.id} className="etiqueta-chip" style={chipStyle(e.color)} title={e.nombre}>
          <span className="punto" style={{ background: e.color }} />
          {e.nombre}
          {onQuitar && (
            <button
              type="button"
              className="quitar"
              aria-label={`Quitar ${e.nombre}`}
              onClick={() => onQuitar(e)}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

function NuevaEtiqueta({
  etiquetaPorDefecto,
  onCrear,
}: {
  etiquetaPorDefecto?: string;
  onCrear: (nombre: string, color: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState(PALETA[5]);

  const crear = () => {
    if (!nombre.trim()) return;
    onCrear(nombre.trim(), color);
    setNombre("");
  };

  return (
    <div className="field">
      <label htmlFor="et-nombre">{etiquetaPorDefecto ?? "Nueva etiqueta"}</label>
      <div className="row gap">
        <input
          id="et-nombre"
          placeholder="ej. Urgente, VIP, seguimiento…"
          value={nombre}
          maxLength={40}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && crear()}
        />
        <button className="btn" disabled={!nombre.trim()} onClick={crear}>
          Crear
        </button>
      </div>
      <div className="swatches" style={{ marginTop: 8 }}>
        {PALETA.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c === color ? " on" : ""}`}
            style={{ background: c }}
            title={c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </div>
  );
}

/** Modal para aplicar/quitar etiquetas de UN pedido (con creacion rapida). */
export function PickerEtiquetas({
  open,
  onClose,
  idPedido,
  numero,
}: {
  open: boolean;
  onClose: () => void;
  idPedido: string | number;
  numero?: string | number;
}) {
  const et = useEtiquetas();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Etiquetas del pedido #${numero ?? idPedido}`}
      footer={
        <button className="btn primary" onClick={onClose}>
          Listo
        </button>
      }
    >
      {et.etiquetas.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Aun no tienes etiquetas creadas. Crea la primera aqui abajo y se
          aplicara a este pedido.
        </p>
      ) : (
        <div className="etiqueta-fila" style={{ marginBottom: 14 }}>
          {et.etiquetas.map((e) => {
            const on = et.tiene(idPedido, e.id);
            return (
              <button
                key={e.id}
                type="button"
                className={`etiqueta-op${on ? " on" : ""}`}
                style={chipStyle(e.color)}
                onClick={() => et.alternar(idPedido, e.id)}
                title={on ? "Quitar de este pedido" : "Aplicar a este pedido"}
              >
                <span className="punto" style={{ background: e.color }} />
                {e.nombre}
                <span className="marca">{on ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      )}

      <NuevaEtiqueta onCrear={(nombre, color) => {
        const creada = et.crear(nombre, color);
        if (creada) et.aplicar(idPedido, creada.id);
      }} />

      <p className="muted small" style={{ marginBottom: 0 }}>
        Las etiquetas son una funcion propia del panel: no existen en
        LucidSales y se guardan en este navegador, por tienda.
      </p>
    </Modal>
  );
}

/** Alta / edicion / eliminacion de etiquetas + backup JSON. */
export function GestorEtiquetas({ open, onClose }: { open: boolean; onClose: () => void }) {
  const et = useEtiquetas();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editarId, setEditarId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editColor, setEditColor] = useState(PALETA[5]);
  const [aBorrar, setABorrar] = useState<Etiqueta | null>(null);

  const empezarEdicion = (e: Etiqueta) => {
    setEditarId(e.id);
    setEditNombre(e.nombre);
    setEditColor(e.color);
  };

  const guardarEdicion = () => {
    if (!editarId || !editNombre.trim()) return;
    et.actualizar(editarId, { nombre: editNombre.trim(), color: editColor });
    setEditarId(null);
    toast.success("Etiqueta actualizada");
  };

  const exportar = () => {
    try {
      const blob = new Blob([exportarEtiquetas()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "etiquetas-zuntostore.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup descargado");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const importar = async (file: File) => {
    try {
      const texto = await file.text();
      const total = await importarEtiquetas(texto);
      toast.success(`${total} etiquetas importadas`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Gestionar etiquetas"
        wide
        footer={
          <>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              Importar backup
            </button>
            <button className="btn ghost" onClick={exportar}>
              Exportar backup
            </button>
            <button className="btn primary" onClick={onClose}>
              Listo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importar(f);
                e.target.value = "";
              }}
            />
          </>
        }
      >
        <NuevaEtiqueta
          etiquetaPorDefecto="Crear etiqueta"
          onCrear={(nombre, color) => {
            const creada = et.crear(nombre, color);
            if (creada) toast.success(`Etiqueta "${creada.nombre}" lista para usar`);
          }}
        />

        {et.etiquetas.length === 0 ? (
          <p className="muted">Todavia no has creado etiquetas.</p>
        ) : (
          <div className="etiqueta-lista">
            {et.etiquetas.map((e) => (
              <div className="etiqueta-fila-item" key={e.id}>
                {editarId === e.id ? (
                  <>
                    <div className="row gap" style={{ flex: 1, minWidth: 220 }}>
                      <input
                        value={editNombre}
                        maxLength={40}
                        onChange={(ev) => setEditNombre(ev.target.value)}
                        onKeyDown={(ev) => ev.key === "Enter" && guardarEdicion()}
                      />
                      <div className="swatches">
                        {PALETA.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`swatch${c === editColor ? " on" : ""}`}
                            style={{ background: c }}
                            aria-label={`Color ${c}`}
                            onClick={() => setEditColor(c)}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="row gap">
                      <button className="btn sm primary" onClick={guardarEdicion}>
                        Guardar
                      </button>
                      <button className="btn sm ghost" onClick={() => setEditarId(null)}>
                        Cancelar
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="etiqueta-chip" style={chipStyle(e.color)}>
                      <span className="punto" style={{ background: e.color }} />
                      {e.nombre}
                    </span>
                    <span className="muted small">
                      {et.usos(e.id)} {et.usos(e.id) === 1 ? "pedido" : "pedidos"}
                    </span>
                    <span className="row gap">
                      <button className="btn sm" onClick={() => empezarEdicion(e)}>
                        Editar
                      </button>
                      <button className="btn sm danger" onClick={() => setABorrar(e)}>
                        Eliminar
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="muted small" style={{ marginBottom: 0 }}>
          El backup descarga un JSON con todas las etiquetas y sus pedidos;
          importarlo en otro navegador las copia. Los pedidos se guardan por su
          id, asi que sirve para mover las etiquetas entre equipos.
        </p>
      </Modal>

      <ConfirmDialog
        open={aBorrar !== null}
        title="Eliminar etiqueta"
        message={
          <>
            Se eliminara la etiqueta <strong>{aBorrar?.nombre}</strong> y se
            quitara de los {aBorrar ? et.usos(aBorrar.id) : 0} pedidos que la
            tengan. Esto no se puede deshacer.
          </>
        }
        confirmLabel="Eliminar"
        danger
        onConfirm={() => {
          if (aBorrar) {
            et.eliminar(aBorrar.id);
            toast.success(`Etiqueta "${aBorrar.nombre}" eliminada`);
          }
          setABorrar(null);
        }}
        onCancel={() => setABorrar(null)}
      />
    </>
  );
}

/** Tarjeta de etiquetas para el detalle del pedido. */
export function BloqueEtiquetas({
  idPedido,
  numero,
}: {
  idPedido: string | number;
  numero?: string | number;
}) {
  const et = useEtiquetas();
  const [modal, setModal] = useState<null | "picker" | "gestor">(null);
  const mias = et.etiquetasDe(idPedido);

  return (
    <section className="card">
      <div className="card-title">Etiquetas</div>
      <div className="etiqueta-fila">
        {mias.length === 0 ? (
          <span className="muted small">
            Sin etiquetas. Aplica una para marcarlo (VIP, urgente, seguimiento,
            reincidencia…).
          </span>
        ) : (
          <ChipsDeEtiquetas etiquetas={mias} onQuitar={(e) => et.quitar(idPedido, e.id)} />
        )}
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setModal("picker")}>
          + Aplicar
        </button>
        <button className="btn sm ghost" onClick={() => setModal("gestor")}>
          Gestionar
        </button>
      </div>

      <PickerEtiquetas
        open={modal === "picker"}
        onClose={() => setModal(null)}
        idPedido={idPedido}
        numero={numero}
      />
      <GestorEtiquetas open={modal === "gestor"} onClose={() => setModal(null)} />
    </section>
  );
}
