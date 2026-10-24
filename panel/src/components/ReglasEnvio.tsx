// Reglas de envío de la subida a Dropi: transportadoras en orden de
// preferencia, tope del flete (pesos y/o % del valor del pedido), reglas por
// producto y oficina de Interrapidísimo cuando Dropi ofrece una sola.
//
// El servidor elige la PRIMERA transportadora de la lista que esté disponible
// para la ciudad y cuyo envío no pase el tope. Si ninguna sirve, el pedido no
// se sube y queda marcado («envio-caro» o «sin-transportadora»).
import { useEffect, useMemo, useState } from "react";
import { productos as apiProductos } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Campo } from "./ui";

/** Transportadoras de Dropi (id de Dropi -> nombre). */
export const TRANSPORTADORAS: Array<[number, string]> = [
  [5, "Coordinadora"],
  [3, "Interrapidísimo"],
  [2, "Envía"],
  [4, "Domina"],
  [10, "TCC"],
  [6, "Veloces"],
  [7, "99minutos"],
  [13, "Jamv-drive"],
  [14, "Derocha-express"],
  [17, "Wiilog"],
];
const nombreDe = (id: number) => TRANSPORTADORAS.find(([i]) => i === id)?.[1] ?? `#${id}`;

export interface ReglaProducto {
  nombre: string;
  transportadoras: number[];
  maxPesos: number | null;
  maxPorcentaje: number | null;
}

export interface ConfigEnvio {
  transportadoras: number[];
  envio: { maxPesos: number | null; maxPorcentaje: number | null };
  reglasProducto: Record<string, ReglaProducto>;
  oficinaInter: boolean;
  detectarOficinaInter: boolean;
}

const numeroONull = (v: string): number | null => {
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Lista ordenada: principal, segunda y tercera opción (sin repetir). */
function OrdenTransportadoras({ id, valor, onChange, permitirVacia = false }: {
  id: string;
  valor: number[];
  onChange: (v: number[]) => void;
  permitirVacia?: boolean;
}) {
  const etiquetas = ["Principal", "Segunda opción", "Tercera opción"];
  const cambiar = (i: number, nuevo: number) => {
    const lista = [...valor];
    if (nuevo) lista[i] = nuevo;
    else lista.splice(i);
    onChange(lista.filter((x, j, a) => x && a.indexOf(x) === j));
  };
  return (
    <div className="envio-orden">
      {etiquetas.map((et, i) => {
        if (i > valor.length) return null;
        const usados = valor.filter((_, j) => j !== i);
        return (
          <label key={i} className="envio-orden-item" htmlFor={`${id}-${i}`}>
            <span className="muted small">{et}</span>
            <select
              id={`${id}-${i}`}
              value={valor[i] ?? 0}
              onChange={(e) => cambiar(i, Number(e.target.value))}
            >
              {i > 0 || permitirVacia ? <option value={0}>{i === 0 ? "Usar la general" : "—"}</option> : null}
              {TRANSPORTADORAS.filter(([t]) => !usados.includes(t)).map(([t, n]) => (
                <option key={t} value={t}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

export function ReglasEnvio({ valor, onChange }: { valor: ConfigEnvio; onChange: (v: ConfigEnvio) => void }) {
  const { session } = useAuth();
  const [catalogo, setCatalogo] = useState<Array<{ id: string; nombre: string }>>([]);
  const [nuevo, setNuevo] = useState("");
  const tienda = Number(session?.tiendaActiva ?? session?.idEmpresa?.[0] ?? 0);

  useEffect(() => {
    if (!tienda) return;
    let cancel = false;
    apiProductos
      .list(tienda)
      .then((r: any) => {
        if (cancel) return;
        const lista = (r?.productos ?? r?.data ?? []) as any[];
        setCatalogo(
          lista
            .map((p) => ({ id: String(p?.id ?? ""), nombre: String(p?.Nombre ?? p?.nombre ?? "").trim() }))
            .filter((p) => p.id && p.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        );
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [tienda]);

  const reglas = valor.reglasProducto ?? {};
  const disponibles = useMemo(() => catalogo.filter((p) => !reglas[p.id]), [catalogo, reglas]);

  const setRegla = (id: string, cambio: Partial<ReglaProducto> | null) => {
    const prox = { ...reglas };
    if (cambio === null) delete prox[id];
    else prox[id] = { ...prox[id], ...cambio } as ReglaProducto;
    onChange({ ...valor, reglasProducto: prox });
  };

  const agregar = () => {
    const p = catalogo.find((x) => x.id === nuevo);
    if (!p) return;
    setRegla(p.id, { nombre: p.nombre, transportadoras: [], maxPesos: null, maxPorcentaje: null });
    setNuevo("");
  };

  return (
    <div className="reglas-envio">
      <div className="card-title" style={{ marginTop: 12 }}>Envío</div>
      <p className="muted small">
        Se usa la primera transportadora de la lista que esté disponible para la ciudad y cuyo envío
        no pase el tope. Si ninguna sirve, el pedido no se sube y te llega el aviso. El seguro
        antidevoluciones es obligatorio con Coordinadora; con otra transportadora se activa si Dropi
        lo ofrece.
      </p>

      <div className="form-grid">
        <Campo id="env-orden" label="Transportadoras (en orden)" ayuda="Para los productos sin regla propia.">
          <OrdenTransportadoras
            id="env-orden"
            valor={valor.transportadoras}
            onChange={(t) => onChange({ ...valor, transportadoras: t.length ? t : [5] })}
          />
        </Campo>
        <Campo id="env-max-pesos" label="Envío máximo (pesos)" ayuda="Vacío = sin tope en pesos.">
          <input
            id="env-max-pesos"
            inputMode="numeric"
            placeholder="Ej. 20000"
            value={valor.envio.maxPesos ?? ""}
            onChange={(e) => onChange({ ...valor, envio: { ...valor.envio, maxPesos: numeroONull(e.target.value) } })}
          />
        </Campo>
        <Campo
          id="env-max-pct"
          label="Envío máximo (% del valor del pedido)"
          ayuda="Vacío = sin tope en %. Si pones los dos, manda el más bajo."
        >
          <input
            id="env-max-pct"
            inputMode="decimal"
            placeholder="Ej. 25"
            value={valor.envio.maxPorcentaje ?? ""}
            onChange={(e) =>
              onChange({ ...valor, envio: { ...valor.envio, maxPorcentaje: numeroONull(e.target.value) } })
            }
          />
        </Campo>
        <div className="field">
          <label htmlFor="env-ofi">Oficina de Interrapidísimo</label>
          <label className="switch" htmlFor="env-ofi">
            <input
              id="env-ofi"
              type="checkbox"
              checked={valor.oficinaInter}
              onChange={(e) => onChange({ ...valor, oficinaInter: e.target.checked })}
            />
            <span className="switch-pista" aria-hidden="true" />
            <span className="switch-texto">
              {valor.oficinaInter ? "Subir si hay una sola oficina" : "Siempre a mano"}
            </span>
          </label>
          <p className="campo-ayuda">
            Si la dirección dice «oficina Interrapidísimo» y Dropi muestra una sola oficina en esa
            ciudad, se elige y se sube. Con varias (o ninguna) lo sube una persona. Las oficinas de
            Coordinadora siempre van a mano.
          </p>
        </div>
        <div className="field">
          <label htmlFor="env-ofi-detectar">Detectar oficinas de Interrapidísimo</label>
          <label className="switch" htmlFor="env-ofi-detectar">
            <input
              id="env-ofi-detectar"
              type="checkbox"
              checked={valor.detectarOficinaInter}
              onChange={(e) => onChange({ ...valor, detectarOficinaInter: e.target.checked })}
            />
            <span className="switch-pista" aria-hidden="true" />
            <span className="switch-texto">{valor.detectarOficinaInter ? "Activado" : "Apagado"}</span>
          </label>
          <p className="campo-ayuda">
            Hay clientes que dan la dirección de una oficina de Inter sin decir «oficina». Antes de subir
            se compara con las oficinas de Inter de esa ciudad: si coincide, va por Interrapidísimo a esa
            oficina; si no, sigue por la transportadora normal (con seguro).
          </p>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 12 }}>Reglas por producto</div>
      <p className="muted small">
        Para productos que no pueden ir por la transportadora general o que necesitan otro tope. Lo
        que dejes vacío usa lo general.
      </p>
      {Object.keys(reglas).length ? (
        <div className="table-wrap">
          <table className="table tabla-compacta reglas-envio-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Transportadoras</th>
                <th>Máx. pesos</th>
                <th>Máx. %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(reglas).map(([id, r]) => (
                <tr key={id}>
                  <td className="wrap">
                    <strong>{r.nombre || `Producto ${id}`}</strong>
                    <div className="muted small">
                      {r.transportadoras?.length
                        ? r.transportadoras.map(nombreDe).join(" → ")
                        : `General: ${valor.transportadoras.map(nombreDe).join(" → ")}`}
                    </div>
                  </td>
                  <td>
                    <OrdenTransportadoras
                      id={`regla-${id}`}
                      valor={r.transportadoras ?? []}
                      permitirVacia
                      onChange={(t) => setRegla(id, { transportadoras: t })}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
                      placeholder="General"
                      value={r.maxPesos ?? ""}
                      aria-label={`Envío máximo en pesos de ${r.nombre}`}
                      onChange={(e) => setRegla(id, { maxPesos: numeroONull(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      placeholder="General"
                      value={r.maxPorcentaje ?? ""}
                      aria-label={`Envío máximo en % de ${r.nombre}`}
                      onChange={(e) => setRegla(id, { maxPorcentaje: numeroONull(e.target.value) })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn sm danger" onClick={() => setRegla(id, null)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">Ningún producto tiene regla propia.</p>
      )}
      <div className="row gap" style={{ marginTop: 8 }}>
        <select value={nuevo} onChange={(e) => setNuevo(e.target.value)} aria-label="Producto para agregar regla">
          <option value="">{catalogo.length ? "Elegir producto…" : "Cargando productos…"}</option>
          {disponibles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <button type="button" className="btn sm" disabled={!nuevo} onClick={agregar}>
          + Agregar regla
        </button>
      </div>
      <p className="muted small">
        Las reglas por producto, los topes y la oficina se aplican al pulsar «Guardar configuración».
      </p>
    </div>
  );
}
