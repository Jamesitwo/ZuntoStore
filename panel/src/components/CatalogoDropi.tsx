// Revisión nocturna del catálogo de Dropi: guarda cada día el stock y el
// precio de los productos para estimar ventas (caídas de stock) y, después,
// encontrar productos ganadores. Este paso no usa IA.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

interface Corrida {
  dia: string;
  desde: string;
  hasta?: string;
  motivo?: string;
  ok?: boolean;
  seg?: number;
  paginas?: number;
  productos?: number;
  conStock?: number;
  guardados?: number;
  fallidas?: number;
  error?: string;
}
interface Resumen {
  config: { activo: boolean; hora: number; todo: boolean; diasGuardar: number };
  enCurso: { desde: string; paginas: number; productos: number; conStock: number; fallidas: number } | null;
  corridas: Corrida[];
  dias: number;
  primerDia: string | null;
  ultimoDiaGuardado: string | null;
}

const miles = new Intl.NumberFormat("es-CO");
const fecha = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const horaTexto = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`;
const duracion = (s?: number) => (s == null ? "" : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function CatalogoDropi() {
  const toast = useToast();
  const [r, setR] = useState<Resumen | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = () =>
    backendSuave<any>("/api/catalogo").then((x) => {
      if (x?.ok) setR(x);
    });
  useEffect(() => {
    void cargar();
  }, []);
  // mientras revisa, refresca el avance
  useEffect(() => {
    if (!r?.enCurso) return;
    const t = setInterval(() => void cargar(), 5000);
    return () => clearInterval(t);
  }, [r?.enCurso]);

  const guardar = async (cambio: Partial<Resumen["config"]>) => {
    setOcupado(true);
    try {
      setR(await backend<any>("/api/catalogo/config", { method: "PUT", body: cambio }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };
  const accion = async (ruta: "ejecutar" | "parar") => {
    setOcupado(true);
    try {
      setR(await backend<any>(`/api/catalogo/${ruta}`, { method: "POST" }));
      toast.success(ruta === "ejecutar" ? "Revisando el catálogo en segundo plano" : "Se detendrá en unos segundos");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  if (!r) return null;
  const c = r.config;
  return (
    <section className="card">
      <div className="card-title">Catálogo de Dropi (productos ganadores)</div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Cada noche Zunto revisa el catálogo completo de Dropi y guarda el stock y el precio de cada producto. Comparando días
        se estiman las ventas (lo que baja el stock) para encontrar productos ganadores. No usa IA. Usa la sesión de Dropi
        cargada para la subida.
      </p>

      <label className="switch" htmlFor="cat-activo">
        <input id="cat-activo" type="checkbox" checked={c.activo} disabled={ocupado} onChange={(e) => void guardar({ activo: e.target.checked })} />
        <span className="switch-pista" aria-hidden="true" />
        <span className="switch-texto">{c.activo ? `Activa: todos los días a las ${horaTexto(c.hora)}` : "Apagada"}</span>
      </label>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="cat-hora">Hora (Colombia)</label>
          <select id="cat-hora" value={c.hora} disabled={ocupado} onChange={(e) => void guardar({ hora: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {horaTexto(h)}
              </option>
            ))}
          </select>
          <span className="campo-ayuda">Mejor de madrugada: la revisión tarda 1–2 horas.</span>
        </div>
        <div className="field">
          <label htmlFor="cat-dias">Días que se guardan</label>
          <select id="cat-dias" value={c.diasGuardar} disabled={ocupado} onChange={(e) => void guardar({ diasGuardar: Number(e.target.value) })}>
            {[14, 35, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
          <span className="campo-ayuda">Con 35 se pueden comparar ventas de 7 y 30 días.</span>
        </div>
      </div>

      <label className="switch" htmlFor="cat-todo" style={{ marginTop: 4 }}>
        <input id="cat-todo" type="checkbox" checked={c.todo} disabled={ocupado} onChange={(e) => void guardar({ todo: e.target.checked })} />
        <span className="switch-pista" aria-hidden="true" />
        <span className="switch-texto small">{c.todo ? "Guarda todo el catálogo (también los agotados)" : "Guarda solo los productos con stock"}</span>
      </label>

      {r.enCurso ? (
        <div className="banner info" style={{ marginTop: 12 }}>
          Revisando ahora: {miles.format(r.enCurso.productos)} productos ({miles.format(r.enCurso.conStock)} con stock) en{" "}
          {miles.format(r.enCurso.paginas)} páginas
          {r.enCurso.fallidas ? ` · ${r.enCurso.fallidas} páginas fallidas` : ""}.
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        {r.enCurso ? (
          <button type="button" className="btn danger sm" disabled={ocupado} onClick={() => void accion("parar")}>
            ⏹ Parar revisión
          </button>
        ) : (
          <button type="button" className="btn sm" disabled={ocupado} onClick={() => void accion("ejecutar")}>
            Revisar ahora
          </button>
        )}
        <span className="muted small">
          {r.dias
            ? `${r.dias} día(s) guardado(s): del ${r.primerDia} al ${r.ultimoDiaGuardado}.`
            : "Todavía no hay días guardados."}
        </span>
      </div>

      {r.corridas.length ? (
        <ul className="small catalogo-corridas">
          {r.corridas.slice(0, 7).map((x) => (
            <li key={x.desde}>
              <strong>{fecha.format(new Date(x.desde))}</strong>{" "}
              {x.ok ? (
                <>
                  ✅ {miles.format(x.productos ?? 0)} productos · {miles.format(x.conStock ?? 0)} con stock · {duracion(x.seg)}
                  {x.fallidas ? ` · ${x.fallidas} páginas fallidas` : ""}
                </>
              ) : (
                <span style={{ color: "#b91c1c" }}>❌ {x.error}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
