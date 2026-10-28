import type { ReactNode } from "react";
import { SubirMedia } from "./SubirMedia";
import {
  contenidoInicialPaso,
  formaDePaso,
  TIPOS_INICIAL,
  type PasoInicial,
} from "../lib/productos";

/**
 * Editor genérico de pasos: lo usan el **mensaje inicial** (tipos
 * `mensaje_inicial_*`) y los **testimonios** (tipos `testimonio_*`), que
 * tienen la misma estructura `{type, content, id}`.
 *
 * Cada paso es una tarjeta numerada con su selector de tipo, ↑/↓ para
 * reordenar, ✕, y el contenido según la forma: textarea (texto), urls con
 * vista previa (imágenes/videos/audios/documentos) o segundos (espera).
 */
export function EditorPasos({
  prefijo,
  pasos,
  tipos,
  onChange,
  nota,
  textoVacio,
  contenedor,
  fila,
  limite,
  botonAnadir,
  etiquetaUrl,
}: {
  prefijo: string;
  pasos: PasoInicial[];
  /** Lista de tipos del selector (mismo formato que TIPOS_INICIAL). */
  tipos: Array<{ id: string; label: string; forma: "texto" | "lista" | "espera" }>;
  onChange: (p: PasoInicial[]) => void;
  nota?: ReactNode;
  textoVacio?: string;
  /** Clases del contenedor y de cada tarjeta. */
  contenedor?: string;
  fila?: string;
  /** Tope de pasos: si se llega, los botones de añadir se desactivan. */
  limite?: number;
  /**
   * Añadir: "porTipo" = un botón por cada tipo (mensaje inicial);
   * "unico" = un solo botón que crea un paso concreto (testimonios).
   */
  botonAnadir:
    | { modo: "porTipo" }
    | { modo: "unico"; etiqueta: string; tipo: string; contenido: unknown };
  /** aria-label de cada url: (paso, url, contador global). */
  etiquetaUrl?: (paso: number, url: number, global: number) => string;
}) {
  const cambiaPaso = (i: number, patch: Partial<PasoInicial>) =>
    onChange(pasos.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const quitaPaso = (i: number) => onChange(pasos.filter((_, k) => k !== i));

  const muevePaso = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= pasos.length) return;
    const arr = [...pasos];
    const [movido] = arr.splice(i, 1);
    arr.splice(j, 0, movido);
    onChange(arr);
  };

  const agregaPaso = (tipo: string, contenido?: unknown) =>
    onChange([
      ...pasos,
      {
        type: tipo,
        content: contenido !== undefined ? contenido : contenidoInicialPaso(tipo),
        id: Date.now(),
      },
    ]);

  const contenidoDe = (p: PasoInicial): string[] =>
    Array.isArray(p.content) ? p.content.map((u) => String(u ?? "")) : [];

  const cambiaUrl = (i: number, j: number, url: string) =>
    onChange(
      pasos.map((p, k) =>
        k === i && Array.isArray(p.content)
          ? { ...p, content: p.content.map((u, x) => (x === j ? url : u)) }
          : p,
      ),
    );

  const agregaUrl = (i: number) =>
    onChange(
      pasos.map((p, k) => (k === i ? { ...p, content: [...contenidoDe(p), ""] } : p)),
    );

  /** Urls recien subidas a la biblioteca -> al final del paso (sin los vacios). */
  const agregaUrls = (i: number, nuevas: string[]) =>
    onChange(
      pasos.map((p, k) => (k === i ? { ...p, content: [...contenidoDe(p).filter((u) => u.trim()), ...nuevas] } : p)),
    );

  const quitaUrl = (i: number, j: number) =>
    onChange(
      pasos.map((p, k) =>
        k === i && Array.isArray(p.content)
          ? { ...p, content: p.content.filter((_, x) => x !== j) }
          : p,
      ),
    );

  // contador global de urls (para el aria-label de los testimonios)
  let urlGlobal = 0;

  return (
    <>
      {nota}

      {pasos.length === 0 ? (
        <p className="muted">{textoVacio ?? "Sin pasos todavía: añade el primero."}</p>
      ) : (
        <div className={contenedor ?? "pasos-inicial"}>
          {pasos.map((p, i) => {
            const forma = formaDePaso(p.type);
            const urls = contenidoDe(p);
            return (
              <div className={fila ?? "paso-inicial"} key={`${String(p.id)}-${i}`}>
                <div className="row between wrap">
                  <span className="row gap" style={{ marginBottom: 0 }}>
                    <span className="paso-num">{i + 1}</span>
                    <select
                      aria-label={`Tipo del paso ${i + 1}`}
                      value={p.type}
                      onChange={(e) =>
                        cambiaPaso(i, {
                          type: e.target.value,
                          content: contenidoInicialPaso(e.target.value),
                        })
                      }
                    >
                      {tipos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="row gap" style={{ marginBottom: 0 }}>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Subir paso ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => muevePaso(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Bajar paso ${i + 1}`}
                      disabled={i === pasos.length - 1}
                      onClick={() => muevePaso(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={`Eliminar paso ${i + 1} del ${prefijo}`}
                      onClick={() => quitaPaso(i)}
                    >
                      Eliminar
                    </button>
                  </span>
                </div>

                {forma === "texto" ? (
                  <textarea
                    rows={4}
                    value={String(p.content ?? "")}
                    onChange={(e) => cambiaPaso(i, { content: e.target.value })}
                    placeholder="Escribe aquí…"
                    aria-label={`Texto del paso ${i + 1}`}
                  />
                ) : null}

                {forma === "espera" ? (
                  <div className="row gap" style={{ marginBottom: 0 }}>
                    <input
                      type="number"
                      min={0}
                      style={{ maxWidth: 130 }}
                      aria-label={`Espera del paso ${i + 1} en segundos`}
                      value={String(p.content ?? "1")}
                      onChange={(e) => cambiaPaso(i, { content: e.target.value })}
                    />
                    <span className="muted small">segundos antes del siguiente paso</span>
                  </div>
                ) : null}

                {forma === "lista" ? (
                  <div
                    className={`pasos-urls${
                      p.type.includes("imagen") ? " galeria" : ""
                    }`}
                  >
                    {urls.length > 0 ? (
                      urls.map((url, j) => {
                        urlGlobal++;
                        const esImagen = p.type.includes("imagen");
                        const esVideo = p.type.includes("video");
                        const esAudio = p.type.includes("audio");
                        const esDoc = p.type.includes("documento");
                        const aria = etiquetaUrl
                          ? etiquetaUrl(i, j, urlGlobal)
                          : `Url ${j + 1} del paso ${i + 1}`;
                        return (
                          <div className="url-fila" key={j}>
                            {esImagen && url ? (
                              <a
                                className="url-fila-media"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                title="Abrir a tamaño completo"
                              >
                                {/* key=url: si se edita el enlace se reintenta */}
                                <img
                                  key={url}
                                  src={url}
                                  alt=""
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              </a>
                            ) : null}
                            {esVideo && url ? (
                              <video
                                className="url-fila-media video"
                                src={url}
                                controls
                                preload="metadata"
                              />
                            ) : null}
                            {esAudio && url ? (
                              <audio className="url-audio" src={url} controls preload="metadata" />
                            ) : null}
                            {esDoc && url ? <span className="chip">📄 {url.split("/").pop()}</span> : null}
                            <div className="row gap" style={{ marginBottom: 0 }}>
                              <input
                                className="url-input"
                                value={url}
                                aria-label={aria}
                                onChange={(e) => cambiaUrl(i, j, e.target.value)}
                                placeholder="https://…"
                              />
                              <button
                                type="button"
                                className="btn sm danger"
                                aria-label={`Quitar url ${j + 1}`}
                                onClick={() => quitaUrl(i, j)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="muted small" style={{ margin: 0 }}>
                        Sin urls todavía.
                      </p>
                    )}
                    <div className="row gap" style={{ marginBottom: 0 }}>
                      <SubirMedia
                        accept={
                          p.type.includes("video")
                            ? "video/*"
                            : p.type.includes("audio")
                              ? "audio/*"
                              : p.type.includes("documento")
                                ? ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                                : "image/*"
                        }
                        texto={
                          p.type.includes("video")
                            ? "⬆ Subir video"
                            : p.type.includes("audio")
                              ? "⬆ Subir audio"
                              : p.type.includes("documento")
                                ? "⬆ Subir documento"
                                : "⬆ Subir imagen"
                        }
                        onSubido={(nuevas) => agregaUrls(i, nuevas)}
                      />
                      <button type="button" className="btn sm" onClick={() => agregaUrl(i)}>
                        + Añadir url
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {botonAnadir.modo === "porTipo" ? (
        <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {tipos.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn sm"
              disabled={limite !== undefined && pasos.length >= limite}
              onClick={() => agregaPaso(t.id)}
            >
              + {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="row gap" style={{ marginTop: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn sm"
            disabled={limite !== undefined && pasos.length >= limite}
            onClick={() =>
              agregaPaso(botonAnadir.tipo, (botonAnadir as { contenido?: unknown }).contenido)
            }
          >
            {botonAnadir.etiqueta}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Editor del mensaje inicial (bienvenida del bot / del producto):
 * los 5 tipos oficiales `mensaje_inicial_*` y un botón por tipo.
 */
export function EditorMensajeInicial({
  prefijo,
  pasos,
  onChange,
  nota,
  textoVacio,
}: {
  prefijo: string;
  pasos: PasoInicial[];
  onChange: (p: PasoInicial[]) => void;
  nota?: ReactNode;
  textoVacio?: string;
}) {
  return (
    <EditorPasos
      prefijo={prefijo}
      pasos={pasos}
      tipos={TIPOS_INICIAL}
      onChange={onChange}
      nota={nota}
      textoVacio={textoVacio}
      contenedor="pasos-inicial"
      fila="paso-inicial"
      botonAnadir={{ modo: "porTipo" }}
    />
  );
}
