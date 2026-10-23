// Validador de direcciones PROPIO en el detalle del pedido: formato
// colombiano (reglas fijas) + Google Maps en la ciudad del pedido. Si la
// direccion se puede escribir mejor, la propone y permite guardarla en
// LucidSales con un clic.
import { useState } from "react";
import { backend } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

type Veredicto = "valida" | "revisar" | "invalida" | "oficina";

interface Resultado {
  veredicto: Veredicto;
  original: string;
  resumen: string;
  sugerida: string | null;
  avisos: string[];
  ciudad?: string;
  departamento?: string;
  formato: { ok: boolean; detalle: string; normalizada?: string };
  calificacion: null | { puntos: number; verificada: boolean; partes: Array<{ concepto: string; puntos: number; max: number }> };
  mapa: null | {
    veredicto: "exacta" | "aproximada" | "otra-ciudad" | "no-encontrada" | "error";
    detalle: string;
    formateada?: string;
    mapa?: string | null;
    consultada?: string;
  };
}

const ETIQUETA: Record<Veredicto, { texto: string; tono: string }> = {
  valida: { texto: "Dirección válida", tono: "ok" },
  revisar: { texto: "Revisar", tono: "warn" },
  invalida: { texto: "Dirección no válida", tono: "error" },
  oficina: { texto: "Recoge en oficina", tono: "info" },
};

const MAPA: Record<string, string> = {
  exacta: "Existe en el mapa",
  aproximada: "Ubicación aproximada",
  "otra-ciudad": "En otra ciudad",
  "no-encontrada": "No aparece en el mapa",
  error: "No se pudo consultar",
};

export function ValidarDireccion({
  id,
  direccion,
  onUsar,
  onGuardada,
}: {
  id: string | number;
  /** lo que esta escrito ahora en el formulario */
  direccion: string;
  /** pone la sugerida en el formulario (sin guardar) */
  onUsar: (dir: string) => void;
  /** ya quedo guardada en LucidSales */
  onGuardada: (dir: string) => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [r, setR] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validar = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await backend<Resultado>(`/api/pedidos/${encodeURIComponent(String(id))}/direccion/validar`, {
        method: "POST",
        body: { direccion },
      });
      setR(res);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCargando(false);
    }
  };

  const guardar = async (dir: string) => {
    setGuardando(true);
    try {
      const res: any = await backend(`/api/pedidos/${encodeURIComponent(String(id))}/direccion`, {
        method: "POST",
        body: { direccion: dir },
      });
      onGuardada(dir);
      toast.success(res?.msg || "Dirección guardada en el pedido");
      setR((x) => (x ? { ...x, original: dir, sugerida: null } : x));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGuardando(false);
    }
  };

  const et = r ? ETIQUETA[r.veredicto] : null;
  const cambioDesdeValidacion = r && r.original.trim() !== direccion.trim();

  return (
    <div className="validar-direccion">
      <div className="row gap" style={{ marginBottom: 0 }}>
        <button type="button" className="btn sm" onClick={() => void validar()} disabled={cargando || !direccion.trim()}>
          {cargando ? "Validando…" : "Validar dirección"}
        </button>
        {et ? <span className={`chip ${et.tono === "ok" ? "ok" : et.tono === "error" || et.tono === "warn" ? "alerta" : ""}`}>{et.texto}</span> : null}
        {r?.calificacion ? (
          <span
            className="chip"
            title={`${r.calificacion.partes.map((p) => `${p.concepto} ${p.puntos}/${p.max}`).join(" · ")}${r.calificacion.verificada ? "" : " · sin verificar en el mapa"}`}
          >
            Calificación {r.calificacion.puntos}/100
          </span>
        ) : null}
        {cambioDesdeValidacion ? <span className="muted small">La dirección cambió: vuelve a validar.</span> : null}
      </div>

      {error ? <div className="banner error" style={{ marginTop: 8 }}>{error}</div> : null}

      {r ? (
        <div className={`validar-direccion-resultado tono-${et?.tono}`}>
          <p style={{ margin: 0 }}>
            <strong>{r.resumen}</strong>
          </p>
          <ul className="validar-direccion-checks">
            <li>
              <span aria-hidden="true">{r.formato.ok ? "✓" : "✗"}</span> Formato: {r.formato.detalle}
            </li>
            {r.mapa ? (
              <li>
                <span aria-hidden="true">{r.mapa.veredicto === "exacta" ? "✓" : r.mapa.veredicto === "aproximada" ? "~" : "✗"}</span>{" "}
                Mapa ({MAPA[r.mapa.veredicto] ?? r.mapa.veredicto}
                {r.ciudad ? ` · ${[r.ciudad, r.departamento].filter(Boolean).join(", ")}` : ""}): {r.mapa.detalle}
                {r.mapa.mapa ? (
                  <>
                    {" "}
                    <a href={r.mapa.mapa} target="_blank" rel="noreferrer">
                      Ver en Google Maps
                    </a>
                  </>
                ) : null}
              </li>
            ) : null}
            {r.avisos.map((a) => (
              <li key={a}>
                <span aria-hidden="true">!</span> {a}
              </li>
            ))}
          </ul>
          {r.sugerida ? (
            <div className="validar-direccion-sugerida">
              <span className="muted small">Se escribe mejor así:</span>
              <code>{r.sugerida}</code>
              <span className="row gap" style={{ marginBottom: 0 }}>
                <button type="button" className="btn sm" onClick={() => onUsar(r.sugerida!)}>
                  Usar en el formulario
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={guardando}
                  onClick={() => void guardar(r.sugerida!)}
                >
                  {guardando ? "Guardando…" : "Guardar en el pedido"}
                </button>
              </span>
            </div>
          ) : null}
          <p className="muted small" style={{ margin: 0 }}>
            Se valida con la ciudad guardada en el pedido.
          </p>
        </div>
      ) : null}
    </div>
  );
}
