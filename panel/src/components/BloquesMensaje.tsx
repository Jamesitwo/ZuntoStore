// Editor de bloques de un mensaje del bot (como el de LucidSales): texto,
// imagen, video, audio, archivo y espera. Se guarda como lo guarda LucidSales
// en el campo del bot:
//   {"messages":[{"message":{"text":"..."}}, 5,
//                {"message":{"attachment":{"type":"image","payload":{"url":"..."}}}}, ...]}
// (un numero solo = segundos de espera). Lo que no se reconoce se conserva.
import { useEffect, useState } from "react";

export type Bloque =
  | { tipo: "texto"; texto: string }
  | { tipo: "image" | "video" | "audio" | "file"; url: string }
  | { tipo: "espera"; seg: number }
  | { tipo: "otro"; crudo: unknown };

const NOMBRE: Record<string, string> = { texto: "Texto", image: "Imagen", video: "Video", audio: "Audio", file: "Archivo", espera: "Espera" };
const ICONO: Record<string, string> = { texto: "🔤", image: "🖼️", video: "🎬", audio: "🎵", file: "📄", espera: "⏱️", otro: "🧩" };

/** Valor del campo -> bloques. Un texto simple (como queda cuando solo hay texto) es un bloque de texto. */
export function leerBloques(valor: string | undefined): Bloque[] {
  const t = String(valor ?? "");
  if (!t.trim()) return [];
  let j: any;
  try {
    j = JSON.parse(t);
  } catch {
    return [{ tipo: "texto", texto: t }];
  }
  if (!j || !Array.isArray(j.messages)) return typeof j === "string" ? [{ tipo: "texto", texto: j }] : [{ tipo: "texto", texto: t }];
  return j.messages.map((m: any): Bloque => {
    if (typeof m === "number" || (typeof m === "string" && /^\d+$/.test(m))) return { tipo: "espera", seg: Number(m) };
    const msg = m?.message;
    if (typeof msg?.text === "string") return { tipo: "texto", texto: msg.text };
    const a = msg?.attachment;
    if (a && ["image", "video", "audio", "file"].includes(a.type) && typeof a.payload?.url === "string") return { tipo: a.type, url: a.payload.url };
    return { tipo: "otro", crudo: m };
  });
}

/** Bloques -> valor del campo ("" si no queda nada). */
export function escribirBloques(bloques: Bloque[]): string {
  const messages = bloques
    .map((b) => {
      if (b.tipo === "texto") return b.texto.trim() ? { message: { text: b.texto } } : null;
      if (b.tipo === "espera") return Number.isFinite(b.seg) && b.seg > 0 ? Math.round(b.seg) : null;
      if (b.tipo === "otro") return b.crudo;
      return b.url.trim() ? { message: { attachment: { type: b.tipo, payload: { url: b.url.trim() } } } } : null;
    })
    .filter((x) => x !== null);
  return messages.length ? JSON.stringify({ messages }) : "";
}

const FORMATOS: Record<string, string> = { image: ".jpg, .png, .webp", video: ".mp4", audio: ".mp3, .ogg", file: ".pdf" };

export function BloquesMensaje({
  id,
  valor,
  onCambio,
  deshabilitado,
  palabrasClave = false,
}: {
  id: string;
  valor: string;
  onCambio: (v: string) => void;
  deshabilitado?: boolean;
  palabrasClave?: boolean;
}) {
  // estado propio: un bloque recien agregado (aun vacio) no se guarda pero debe verse
  const [lista, setLista] = useState<Bloque[]>(() => leerBloques(valor));
  useEffect(() => {
    // el valor cambio desde fuera (p. ej. «Copiar del bot de Zunto»)
    if (escribirBloques(lista) !== String(valor ?? "") && !(valor === "" && lista.every(esVacio))) setLista(leerBloques(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  const poner = (l: Bloque[]) => {
    setLista(l);
    onCambio(escribirBloques(l));
  };
  const cambiar = (i: number, b: Bloque) => poner(lista.map((x, j) => (j === i ? b : x)));
  const mover = (i: number, d: -1 | 1) => {
    const l = [...lista];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    poner(l);
  };
  const agregar = (tipo: string) => {
    const nuevo: Bloque = tipo === "texto" ? { tipo: "texto", texto: "" } : tipo === "espera" ? { tipo: "espera", seg: 5 } : { tipo: tipo as "image", url: "" };
    poner([...lista, nuevo]);
    setTimeout(() => document.getElementById(`${id}-b${lista.length}`)?.focus(), 0);
  };
  const archivos = lista.filter((b) => "url" in b).length;

  return (
    <div className="bloques">
      {lista.length ? null : <div className="ct-vacio">Sin mensaje. Agrega un bloque.</div>}
      {lista.map((b, i) => (
        <div className="bloque" key={i}>
          <div className="bloque-cabeza">
            <span>
              {ICONO[b.tipo]} {b.tipo === "otro" ? "Otro (se conserva)" : NOMBRE[b.tipo]}
            </span>
            <span className="bloque-acciones">
              <button type="button" className="btn sm" aria-label="Subir" disabled={deshabilitado || i === 0} onClick={() => mover(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn sm" aria-label="Bajar" disabled={deshabilitado || i === lista.length - 1} onClick={() => mover(i, 1)}>
                ↓
              </button>
              <button type="button" className="btn sm" aria-label="Quitar bloque" disabled={deshabilitado} onClick={() => poner(lista.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          </div>
          {b.tipo === "texto" ? (
            <>
              <textarea
                id={`${id}-b${i}`}
                rows={Math.min(10, Math.max(3, b.texto.split("\n").length + 1))}
                value={b.texto}
                disabled={deshabilitado}
                onChange={(x) => cambiar(i, { tipo: "texto", texto: x.target.value })}
              />
              {palabrasClave ? (
                <span className="campo-ayuda">
                  Palabras clave: {"{{first_name}}"} {"{{last_name}}"} {"{{full_name}}"} {"{{Ciudad}}"} {"{{Total a pagar}}"} {"{{Producto_Ordenados}}"}
                </span>
              ) : null}
            </>
          ) : b.tipo === "espera" ? (
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <input id={`${id}-b${i}`} type="number" min={1} max={60} style={{ width: 90 }} value={b.seg} disabled={deshabilitado} onChange={(x) => cambiar(i, { tipo: "espera", seg: Number(x.target.value) })} />
              <span className="muted small">segundos antes del siguiente mensaje</span>
            </div>
          ) : b.tipo === "otro" ? (
            <code className="small">{JSON.stringify(b.crudo).slice(0, 160)}</code>
          ) : (
            <>
              <input
                id={`${id}-b${i}`}
                type="url"
                placeholder={`Enlace (https://…) — ${FORMATOS[b.tipo]}`}
                value={b.url}
                disabled={deshabilitado}
                onChange={(x) => cambiar(i, { tipo: b.tipo, url: x.target.value })}
              />
              {b.tipo === "image" && /^https?:\/\//.test(b.url) ? <img className="bloque-vista" src={b.url} alt="" loading="lazy" /> : null}
              {b.tipo === "video" && /^https?:\/\//.test(b.url) ? <video className="bloque-vista" src={b.url} controls preload="metadata" /> : null}
              {b.tipo === "audio" && /^https?:\/\//.test(b.url) ? <audio src={b.url} controls preload="none" /> : null}
              {b.tipo === "file" && /^https?:\/\//.test(b.url) ? (
                <a className="small" href={b.url} target="_blank" rel="noreferrer">
                  Abrir archivo
                </a>
              ) : null}
            </>
          )}
        </div>
      ))}
      <div className="bloques-agregar">
        <span className="muted small">Agregar:</span>
        {["texto", "image", "video", "audio", "file", "espera"].map((t) => (
          <button key={t} type="button" className="btn sm" disabled={deshabilitado || ("texto espera".includes(t) ? false : archivos >= 20)} onClick={() => agregar(t)}>
            {ICONO[t]} {NOMBRE[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

function esVacio(b: Bloque) {
  return (b.tipo === "texto" && !b.texto.trim()) || ("url" in b && !b.url.trim());
}
