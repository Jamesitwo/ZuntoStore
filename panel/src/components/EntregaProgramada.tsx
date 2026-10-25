// Entregas programadas: pedidos que el cliente pidió para otra fecha ("lo
// quiero para el 30"). Los marca la IA al leer el chat o una persona a mano.
// La lista de pedidos los resalta cuando se acerca la fecha.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

export interface Programado {
  id: string;
  fecha: string; // AAAA-MM-DD
  nota?: string;
  origen: "ia" | "manual";
  por?: string;
  texto?: string;
  numero?: string | number | null;
  cliente?: { nombre?: string; telefono?: string };
  faltan: number;
  estado: "en-espera" | "toca" | "vencido" | "enviado" | "enviar-ya";
  enviado?: string;
  anulado?: string;
}
export interface ConfigProgramados {
  diasAntes: number;
  subirSolo: boolean;
}

/** "vie 30 oct" (la fecha es un día: sin zona horaria). */
export function fechaCorta(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
}

export function textoFaltan(n: number) {
  if (n < -1) return `hace ${-n} días`;
  if (n === -1) return "ayer";
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  return `en ${n} días`;
}

/** Todas las entregas programadas de la cuenta, por id de pedido. */
export function useProgramados() {
  const [lista, setLista] = useState<Programado[]>([]);
  const [config, setConfig] = useState<ConfigProgramados | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancel = false;
    void backendSuave<{ ok: boolean; programados?: Programado[]; config?: ConfigProgramados }>("/api/programados").then((r) => {
      if (cancel || !r?.ok) return;
      setLista(r.programados ?? []);
      setConfig(r.config ?? null);
    });
    return () => {
      cancel = true;
    };
  }, [n]);
  const porId: Record<string, Programado> = {};
  for (const p of lista) porId[String(p.id)] = p;
  return { lista, porId, config, recargar: useCallback(() => setN((x) => x + 1), []) };
}

/** Clase de la fila según qué tan cerca está la fecha. */
export function claseProgramado(p?: Programado | null) {
  if (!p || p.enviado) return "";
  return p.estado === "toca" || p.estado === "vencido" ? " fila-programada-toca" : " fila-programada";
}

/** Etiqueta para la lista de pedidos. */
export function ChipEntrega({ p }: { p?: Programado | null }) {
  if (!p || p.enviado) return null;
  const toca = p.estado === "toca" || p.estado === "vencido";
  return (
    <span
      className={`chip-entrega${toca ? " toca" : ""}`}
      title={`Entrega programada para el ${fechaCorta(p.fecha)}${p.nota ? ` · ${p.nota}` : ""}${
        p.origen === "ia" ? " · la detectó la IA en el chat" : p.por ? ` · la puso ${p.por}` : ""
      }`}
    >
      📅 {fechaCorta(p.fecha)}
      {toca ? <strong> · {p.estado === "vencido" ? `venció ${textoFaltan(p.faltan)}` : `enviar ${p.faltan <= 0 ? "hoy" : textoFaltan(p.faltan)}`}</strong> : <span className="muted"> · {textoFaltan(p.faltan)}</span>}
    </span>
  );
}

/** Aviso arriba de la lista: los que ya toca enviar. */
export function AvisoEntregas({ lista }: { lista: Programado[] }) {
  const tocan = lista.filter((p) => !p.enviado && (p.estado === "toca" || p.estado === "vencido"));
  const proximos = lista.filter((p) => !p.enviado && p.estado === "en-espera");
  if (!tocan.length && !proximos.length) return null;
  return (
    <div className={`aviso-entregas${tocan.length ? " toca" : ""}`}>
      <div>
        <strong>📅 Entregas programadas</strong>
        {tocan.length ? (
          <span>
            {" "}
            · {tocan.length} para enviar ya
          </span>
        ) : null}
        {proximos.length ? <span className="muted"> · {proximos.length} en espera</span> : null}
      </div>
      {tocan.length ? (
        <ul>
          {tocan.slice(0, 8).map((p) => (
            <li key={p.id}>
              <Link to={`/pedidos/${p.id}`}>
                #{p.numero ?? p.id}
                {p.cliente?.nombre ? ` · ${p.cliente.nombre}` : ""}
              </Link>{" "}
              — {p.estado === "vencido" ? `era para el ${fechaCorta(p.fecha)}` : `para el ${fechaCorta(p.fecha)} (${textoFaltan(p.faltan)})`}
              {p.nota ? <span className="muted"> · {p.nota}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const hoyLocal = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

/** Tarjeta del detalle del pedido: ver, poner, cambiar o quitar la fecha. */
export function EntregaProgramadaCard({ id, numero, cliente, tienda }: { id: string; numero?: string | number | null; cliente?: { nombre?: string; telefono?: string }; tienda?: string | number | null }) {
  const toast = useToast();
  const [p, setP] = useState<Programado | null>(null);
  const [config, setConfig] = useState<ConfigProgramados | null>(null);
  const [cargado, setCargado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [version, setVersion] = useState(0);
  // otra parte del panel (p. ej. «Subir a Dropi») programó este pedido
  useEffect(() => {
    const oir = (e: Event) => {
      if (String((e as CustomEvent).detail) === String(id)) setVersion((v) => v + 1);
    };
    window.addEventListener("zunto:programado", oir);
    return () => window.removeEventListener("zunto:programado", oir);
  }, [id]);

  useEffect(() => {
    let cancel = false;
    void backendSuave<{ ok: boolean; programado?: Programado | null; config?: ConfigProgramados }>(`/api/programados/${encodeURIComponent(id)}`).then((r) => {
      if (cancel) return;
      setCargado(Boolean(r?.ok));
      const v = r?.programado && !r.programado.anulado ? r.programado : null;
      setP(v);
      setConfig(r?.config ?? null);
      setFecha(v?.fecha ?? "");
      setNota(v?.nota ?? "");
    });
    return () => {
      cancel = true;
    };
  }, [id, version]);

  if (!cargado) return null;

  const guardar = async () => {
    setOcupado(true);
    try {
      const r: any = await backend(`/api/programados/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: { fecha, nota, numero: numero ?? null, tienda: tienda ?? null, cliente: cliente ?? null },
      });
      setP(r.programado);
      setEditando(false);
      toast.success(`Entrega programada para el ${fechaCorta(r.programado.fecha)}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async () => {
    if (!window.confirm("¿Quitar la fecha? El pedido se trata como uno normal y se puede enviar ya.")) return;
    setOcupado(true);
    try {
      await backend(`/api/programados/${encodeURIComponent(id)}`, { method: "DELETE" });
      setP(null);
      setFecha("");
      setNota("");
      toast.success("Se quitó la fecha programada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const toca = p && !p.enviado && (p.estado === "toca" || p.estado === "vencido");
  const formulario = (
    <div className="row gap" style={{ marginTop: 8, flexWrap: "wrap" }}>
      <label className="small">
        Fecha de entrega
        <input type="date" value={fecha} min={hoyLocal()} onChange={(e) => setFecha(e.target.value)} style={{ display: "block" }} />
      </label>
      <label className="small" style={{ flex: "1 1 200px" }}>
        Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: cobra la quincena" maxLength={300} style={{ display: "block", width: "100%" }} />
      </label>
      <div className="row gap" style={{ alignSelf: "flex-end", marginBottom: 0 }}>
        <button type="button" className="btn primary sm" disabled={!fecha || ocupado} onClick={() => void guardar()}>
          Guardar fecha
        </button>
        {editando ? (
          <button type="button" className="btn sm" onClick={() => setEditando(false)}>
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <section className={`card pedido-card entrega-programada-card${toca ? " toca" : ""}`}>
      <div className="card-title">📅 Entrega programada</div>
      {p ? (
        <>
          <p style={{ margin: 0 }}>
            {p.enviado ? "Era" : "El cliente lo quiere"} para el <strong>{fechaCorta(p.fecha)}</strong> ({textoFaltan(p.faltan)})
            {p.nota ? <> · {p.nota}</> : null}
          </p>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {p.origen === "ia" ? (
              <>La detectó la IA en el chat{p.texto ? <> («{p.texto}»)</> : null}.</>
            ) : (
              <>La puso {p.por || "una persona"} a mano.</>
            )}{" "}
            {p.enviado
              ? "Ya se envió."
              : toca
                ? config?.subirSolo
                  ? "Ya toca enviarlo: la subida automática lo sube en la próxima revisión."
                  : "Ya toca enviarlo: súbelo a Dropi."
                : config
                  ? `Se resalta ${config.diasAntes ? `${config.diasAntes} día(s) antes` : "ese día"}${config.subirSolo ? " y la subida automática lo sube sola" : ""}.`
                  : null}
          </p>
          {!p.enviado ? (
            editando ? (
              formulario
            ) : (
              <div className="row gap" style={{ marginTop: 8, marginBottom: 0 }}>
                <button type="button" className="btn sm" disabled={ocupado} onClick={() => setEditando(true)}>
                  Cambiar fecha
                </button>
                <button type="button" className="btn sm" disabled={ocupado} onClick={() => void quitar()}>
                  Quitar fecha (enviar ya)
                </button>
              </div>
            )
          ) : null}
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Si el cliente pidió que se lo entreguen otro día, ponle la fecha: la subida automática lo espera y la lista de
            pedidos lo resalta cuando se acerque.
          </p>
          {formulario}
        </>
      )}
    </section>
  );
}
