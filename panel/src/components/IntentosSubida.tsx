// Historial de intentos de subida a Dropi de un pedido: cada intento
// (automatico o manual, exitoso o fallido) con el razonamiento de la IA, la
// validacion de la direccion, la oficina detectada y la transportadora.
import { useEffect, useState } from "react";
import { backendSuave } from "../api/backend";
import { fmtFecha, haceCuanto } from "../lib/format";
import { NOMBRES_CHEQUEO } from "./AnalisisPedido";

interface Intento {
  ts: string;
  actualizado?: string;
  repeticiones?: number;
  origen: "automatica" | "manual";
  usuario?: string | null;
  dryRun?: boolean;
  accion: string;
  detalle: string;
  analisis?: any;
  direccion?: any;
  oficina?: { como: "detectada" | "cliente"; nombre?: string | null; direccion?: string | null } | null;
  envio?: { transportadoras?: number[]; tope?: number | null; motivoTope?: string | null; elegida?: any } | null;
  dropi?: { id?: string | number | null; ganancia?: number | null; envio?: number | null } | null;
}

const NOMBRE_TRANSPORTADORA: Record<number, string> = {
  5: "Coordinadora",
  3: "Interrapidísimo",
  2: "Envía",
  4: "Domina",
  10: "TCC",
};

/** Resultado en palabras + tono del chip. */
const RESULTADO: Record<string, { texto: string; tono: "ok" | "warn" | "mal" }> = {
  subido: { texto: "Subido a Dropi", tono: "ok" },
  preparado: { texto: "Preparado (modo prueba)", tono: "ok" },
  "subido-pendiente-confirmacion": { texto: "Subido; falta Confirmado en LucidSales", tono: "warn" },
  frenado: { texto: "Frenado", tono: "warn" },
  "requiere-revision": { texto: "En revisión (agotó intentos)", tono: "mal" },
  "direccion-invalida": { texto: "Dirección no válida", tono: "mal" },
  "resultado-incierto": { texto: "Incierto: revisar Dropi", tono: "mal" },
  "requiere-humano": { texto: "Lo sube una persona", tono: "warn" },
  "envio-caro": { texto: "Envío muy caro", tono: "warn" },
  "sin-transportadora": { texto: "Sin transportadora", tono: "warn" },
  "requiere-login": { texto: "Sesión de Dropi vencida", tono: "warn" },
  "requiere-captcha": { texto: "Captcha en Dropi", tono: "warn" },
  "estado-incompatible": { texto: "Estado que no se sube", tono: "warn" },
  error: { texto: "Error", tono: "mal" },
  "posible-duplicado": { texto: "Posible pedido repetido", tono: "mal" },
};

const peso = (n: unknown) =>
  typeof n === "number" ? `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("es-CO")}` : "—";
const v = (x: unknown) =>
  x === true ? "sí" : x === false ? "no" : x === null || x === undefined || x === "" ? "—" : String(x);

const MAPA: Record<string, string> = {
  exacta: "existe en el mapa",
  aproximada: "ubicación aproximada",
  "otra-ciudad": "en otra ciudad",
  "no-encontrada": "no aparece en el mapa",
  error: "no se pudo consultar",
};

function Ia({ analisis }: { analisis: any }) {
  const e = analisis?.extraido ?? {};
  const checks: any[] = Array.isArray(analisis?.checks) ? analisis.checks : [];
  return (
    <section className="intento-seccion">
      <h4>Razonamiento de la IA</h4>
      {e.razonamiento ? <p className="intento-razonamiento">{e.razonamiento}</p> : null}
      <p className="muted small" style={{ margin: "0 0 6px" }}>
        Leyó del chat: producto {v(e.producto)} · cantidad {v(e.cantidad)} · precio{" "}
        {typeof e.precioAcordado === "number" ? peso(e.precioAcordado) : v(e.precioAcordado)} · dirección {v(e.direccion)} ·
        confirmó {v(e.clienteConfirmo)} · entrega futura {v(e.entregaFutura)}
        {e.fechaEntregaSolicitada ? ` (${e.fechaEntregaSolicitada})` : ""}
      </p>
      {checks.length ? (
        <ul className="analisis-lista">
          {checks.map((c, i) => (
            <li key={`${c.campo}-${i}`}>
              <span className={`badge${c.ok ? " ok" : " danger"}`}>{c.ok ? "✓" : "✕"}</span>{" "}
              <strong>{NOMBRES_CHEQUEO[c.campo] ?? c.campo}:</strong> {c.detalle}
              {c.evidencia ? <div className="evidencia-chat">«{c.evidencia}»</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {Array.isArray(e.incertidumbre) && e.incertidumbre.length ? (
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          No le quedó claro: {e.incertidumbre.join(" · ")}
        </p>
      ) : null}
      {analisis?.accion ? (
        <p className="small" style={{ margin: "6px 0 0" }}>
          Decisión del sistema con lo que leyó la IA: <strong>{analisis.accion === "subir" ? "subir" : "frenar"}</strong>
        </p>
      ) : null}
    </section>
  );
}

function Direccion({ d }: { d: any }) {
  const ok = d.puntos !== null && d.minimo !== null ? d.puntos >= d.minimo : null;
  return (
    <section className="intento-seccion">
      <h4>Validación de la dirección</h4>
      <p className="small" style={{ margin: "0 0 6px" }}>
        {d.original ? (
          <>
            «{d.original}» ·{" "}
          </>
        ) : null}
        <strong>
          Calificación {d.puntos ?? "—"}/100
          {d.minimo ? ` (mínimo ${d.minimo})` : ""}
        </strong>
        {ok === true ? " · pasa" : ok === false ? " · no pasa" : ""}
        {d.verificada === false ? " · sin verificar en el mapa (no frena)" : ""}
      </p>
      {Array.isArray(d.partes) && d.partes.length ? (
        <table className="table tabla-compacta intento-puntos">
          <tbody>
            {d.partes.map((p: any) => (
              <tr key={p.concepto}>
                <td>{p.concepto}</td>
                <td>
                  {p.puntos}/{p.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <ul className="analisis-lista">
        {d.formato ? (
          <li>
            <span className={`badge${d.formato.ok ? " ok" : " danger"}`}>{d.formato.ok ? "✓" : "✕"}</span>{" "}
            <strong>Formato:</strong> {d.formato.detalle}
          </li>
        ) : null}
        {d.mapa ? (
          <li>
            <span
              className={`badge${
                d.mapa.veredicto === "exacta" ? " ok" : d.mapa.sinCobertura || d.mapa.veredicto === "aproximada" ? "" : " danger"
              }`}
            >
              {d.mapa.veredicto === "exacta" ? "✓" : d.mapa.sinCobertura || d.mapa.veredicto === "aproximada" ? "~" : "✕"}
            </span>{" "}
            <strong>Mapa:</strong>{" "}
            {d.mapa.sinCobertura ? "sin calles en el mapa (no cuenta)" : MAPA[d.mapa.veredicto] ?? d.mapa.veredicto} ·{" "}
            {d.mapa.detalle}
            {d.mapa.formateada ? ` · Google: ${d.mapa.formateada}` : ""}
            {d.mapa.enlace ? (
              <>
                {" "}
                <a href={d.mapa.enlace} target="_blank" rel="noreferrer">
                  Ver en Google Maps
                </a>
              </>
            ) : null}
          </li>
        ) : null}
        {d.sugerida ? (
          <li>
            <strong>Se envió como:</strong> {d.sugerida}
          </li>
        ) : null}
        {(d.avisos ?? []).map((a: string) => (
          <li key={a}>! {a}</li>
        ))}
      </ul>
      {d.resumen ? <p className="muted small" style={{ margin: "4px 0 0" }}>{d.resumen}</p> : null}
    </section>
  );
}

function Envio({ it }: { it: Intento }) {
  const e = it.envio;
  const elegida = e?.elegida;
  if (!e && !it.oficina && !it.dropi) return null;
  return (
    <section className="intento-seccion">
      <h4>Envío</h4>
      <ul className="analisis-lista">
        {it.oficina ? (
          <li>
            <strong>Oficina:</strong>{" "}
            {it.oficina.como === "detectada"
              ? `la dirección del cliente es una oficina de Interrapidísimo (${it.oficina.nombre || it.oficina.direccion})`
              : `el cliente pidió recoger en oficina (${it.oficina.direccion ?? ""})`}
          </li>
        ) : null}
        {e?.transportadoras?.length ? (
          <li>
            <strong>Orden de transportadoras:</strong>{" "}
            {e.transportadoras.map((t) => NOMBRE_TRANSPORTADORA[t] ?? `#${t}`).join(" → ")}
            {e.tope ? ` · tope de flete ${peso(e.tope)}` : ""}
            {e.motivoTope ? ` (${e.motivoTope})` : ""}
          </li>
        ) : null}
        {elegida ? (
          <li>
            <strong>Elegida:</strong> {elegida.transportadora ?? elegida.nombre ?? ""} · flete {peso(elegida.precio)}
            {elegida.oficina ? ` · oficina ${elegida.oficina}` : ""}
          </li>
        ) : null}
        {it.dropi?.id ? (
          <li>
            <strong>Orden en Dropi:</strong> #{it.dropi.id}
          </li>
        ) : null}
        {typeof it.dropi?.ganancia === "number" || typeof it.dropi?.envio === "number" ? (
          <li>
            <strong>Resumen de Dropi:</strong>
            {typeof it.dropi?.ganancia === "number" ? ` ganancia ${peso(it.dropi.ganancia)}` : ""}
            {typeof it.dropi?.envio === "number" ? ` · precio de envío ${peso(it.dropi.envio)}` : ""}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function IntentosSubida({ id, recarga = 0 }: { id: number | string; recarga?: number }) {
  const [intentos, setIntentos] = useState<Intento[] | null>(null);

  useEffect(() => {
    let cancel = false;
    void backendSuave<{ ok: boolean; intentos?: Intento[] }>(
      `/api/subida/pedido/${encodeURIComponent(String(id))}/intentos`,
    ).then((r) => {
      if (!cancel) setIntentos(r?.ok ? r.intentos ?? [] : null);
    });
    return () => {
      cancel = true;
    };
  }, [id, recarga]);

  if (intentos === null) return null;
  return (
    <div className="intentos-subida">
      <div className="card-title" style={{ marginTop: 12 }}>
        Historial de intentos de subida {intentos.length ? <span className="muted small">· {intentos.length}</span> : null}
      </div>
      {!intentos.length ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          Este pedido todavía no se ha intentado subir a Dropi.
        </p>
      ) : (
        <ol className="intentos-lista">
          {intentos.map((it, i) => {
            const r = RESULTADO[it.accion] ?? { texto: it.accion, tono: "warn" as const };
            return (
              <li key={`${it.ts}-${i}`} className={`intento intento-${r.tono}`}>
                <details open={i === 0}>
                  <summary>
                    <span className={`chip intento-chip-${r.tono}`}>{r.texto}</span>
                    <span className="small">
                      {fmtFecha(it.ts)} · {it.origen === "manual" ? `manual${it.usuario ? ` (${it.usuario})` : ""}` : "subida automática"}
                      {it.dryRun ? " · modo prueba" : ""}
                    </span>
                    {it.repeticiones && it.repeticiones > 1 ? (
                      <span className="muted small">
                        · igual {it.repeticiones} veces, la última {haceCuanto(it.actualizado ?? it.ts)}
                      </span>
                    ) : null}
                  </summary>
                  {it.detalle ? <p className="small intento-detalle">{it.detalle}</p> : null}
                  {it.analisis ? <Ia analisis={it.analisis} /> : null}
                  {it.direccion ? <Direccion d={it.direccion} /> : null}
                  <Envio it={it} />
                  {!it.analisis && !it.direccion ? (
                    <p className="muted small" style={{ margin: "4px 0 0" }}>
                      Se decidió antes de consultar la IA y el mapa (por ejemplo, prepago, oficina de Coordinadora o un
                      dato del pedido que faltaba).
                    </p>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
