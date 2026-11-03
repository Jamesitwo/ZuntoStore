// Confirmaciones bonitas en lugar del window.confirm del navegador.
//
//   const confirmar = useConfirmar();
//   if (!(await confirmar({ titulo: "¿Borrar?", mensaje: "No se puede deshacer", peligro: true }))) return;
//
// Devuelve una promesa que se resuelve en true (Confirmar) o false (Cancelar,
// Escape o clic fuera).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface OpcionesConfirmar {
  titulo: string;
  mensaje?: ReactNode;
  /** Texto del boton principal (por defecto "Confirmar"). */
  confirmar?: string;
  cancelar?: string;
  /** Rojo: para borrar, cancelar pedidos, etc. */
  peligro?: boolean;
  /** Emoji o simbolo del circulo (por defecto ? o ! si es peligro). */
  icono?: string;
}

type Pedir = (o: OpcionesConfirmar) => Promise<boolean>;

const Ctx = createContext<Pedir | null>(null);

export function ConfirmarProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState<OpcionesConfirmar | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const boton = useRef<HTMLButtonElement>(null);

  const pedir = useCallback<Pedir>(
    (o) =>
      new Promise<boolean>((res) => {
        resolver.current?.(false);
        resolver.current = res;
        setAbierto(o);
      }),
    [],
  );

  const cerrar = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setAbierto(null);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    boton.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar(false);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [abierto, cerrar]);

  return (
    <Ctx.Provider value={pedir}>
      {children}
      {abierto ? (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && cerrar(false)}>
          <div
            className={`modal confirmar${abierto.peligro ? " peligro" : ""}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmar-titulo"
          >
            <div className="confirmar-icono" aria-hidden="true">
              {abierto.icono ?? (abierto.peligro ? "!" : "?")}
            </div>
            <h3 id="confirmar-titulo">{abierto.titulo}</h3>
            {abierto.mensaje ? <div className="confirmar-mensaje">{abierto.mensaje}</div> : null}
            <div className="confirmar-botones">
              <button type="button" className="btn ghost" onClick={() => cerrar(false)}>
                {abierto.cancelar ?? "Cancelar"}
              </button>
              <button
                ref={boton}
                type="button"
                className={`btn ${abierto.peligro ? "danger-solido" : "primary"}`}
                onClick={() => cerrar(true)}
              >
                {abierto.confirmar ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

/** Pide confirmacion con un modal. Sin provider cae al confirm del navegador. */
export function useConfirmar(): Pedir {
  const ctx = useContext(Ctx);
  return ctx ?? (async (o) => window.confirm(typeof o.mensaje === "string" ? `${o.titulo}\n\n${o.mensaje}` : o.titulo));
}
