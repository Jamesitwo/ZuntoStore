import type { ReactNode } from "react";
import { LIMITE_TESTIMONIOS, TIPOS_TESTIMONIO, type PasoInicial } from "../lib/productos";
import { EditorPasos } from "./MensajeInicial";

/**
 * Editor de testimonios: **misma estructura que un mensaje inicial**
 * (`[{type, content, id}]` con tipos `testimonio_*`), hasta 20 pasos.
 *
 * Cada testimonio es una tarjeta numerada con su tipo (Texto, Imágenes,
 * Videos, Audios, Documentos, Espera), ↑/↓ para reordenar y ✕; el contenido
 * puede ser texto escrito o urls con vista previa. Aquí no se suben archivos.
 *
 * Nota de compatibilidad: el formato oficial de `Testimonios` es
 * `[{image:url}, …]`; `parsearTestimonios` (lib/productos.ts) sigue leyendo
 * ese formato, así que los productos que traigan archivo se convierten en
 * pasos automáticamente.
 */
export function EditorTestimonios({
  titulo,
  nota,
  prefijo,
  testimonios,
  onChange,
}: {
  titulo: string;
  nota: ReactNode;
  /** Para los aria-label: "producto" | "bot". */
  prefijo: string;
  testimonios: PasoInicial[];
  onChange: (t: PasoInicial[]) => void;
}) {
  return (
    <>
      <div className="card-title">{titulo}</div>
      <p className="muted small">{nota}</p>

      <EditorPasos
        prefijo={prefijo}
        pasos={testimonios}
        tipos={TIPOS_TESTIMONIO}
        onChange={onChange}
        textoVacio="Sin testimonios todavía: añade el primero."
        contenedor="pasos-urls testimonios-lista"
        fila="testi-paso"
        limite={LIMITE_TESTIMONIOS}
        botonAnadir={{
          modo: "unico",
          etiqueta: "+ Añadir testimonio",
          tipo: "testimonio_imagenes",
          contenido: [""],
        }}
        etiquetaUrl={(_paso, _url, global) => `Url del testimonio ${global}`}
      />

      <p className="muted small" style={{ marginTop: 6 }}>
        {testimonios.length} de {LIMITE_TESTIMONIOS}
        {testimonios.length >= LIMITE_TESTIMONIOS ? " · límite alcanzado" : ""}
      </p>
    </>
  );
}
