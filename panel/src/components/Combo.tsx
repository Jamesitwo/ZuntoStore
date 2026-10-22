import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface OpcionCombo {
  id: string;
  nombre: string;
  /** Dato extra a la derecha (precio, conteo…); si falta se pinta el `id`. */
  nota?: string;
  /** Miniatura (se oculta sola si la imagen no carga). */
  img?: string;
}

/** Mayusculas, tildes y espacios fuera: "bogota" encuentra "Bogotá". */
const clave = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Maximo de filas pintadas (hay departamentos con +1000 municipios). */
const MAX_FILAS = 60;

/** Coincide con el `max-height` de `.combo-lista` (para saber si cabe abajo). */
const ALTO_MAX = 264;

/**
 * Combobox con busqueda: escribes y la lista se filtra por nombre o por id.
 *
 * El `<select>` no deja buscar y con una lista larga es insoportable, asi que
 * donde el panel oficial despliega departamento/ciudad (y ahora producto) nos
 * ponemos esto.
 *
 * Teclado: `Flechas` recorren, `Enter` elige (sin enviar el formulario),
 * `Escape` cierra. Al hacer clic fuera se cierra y se descarta lo escrito.
 * Pasa el valor como **string**: `null` al limpiar.
 *
 * La lista se posiciona **fija en el viewport**: si el combo vive dentro de
 * algo con scroll (la tabla de lineas del pedido) un `absolute` quedaria
 * recortado.
 */
export function Combo({
  label,
  opciones,
  valor,
  onChange,
  placeholder = "Escribe para buscar...",
  cargando,
  ayuda,
  className,
}: {
  /** Si falta, no se pinta etiqueta (combos dentro de una fila). */
  label?: string;
  opciones: OpcionCombo[];
  valor: string;
  onChange: (id: string | null) => void;
  placeholder?: string;
  cargando?: boolean;
  ayuda?: string;
  /** Clase extra del contenedor (p. ej. `combo-inline`). */
  className?: string;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [destacado, setDestacado] = useState(0);
  const [pos, setPos] = useState<{ t: number; l: number; w: number } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const uid = useId();

  const elegida = opciones.find((o) => o.id === valor) ?? null;

  const filtradas = useMemo(() => {
    const q = clave(texto);
    if (!q) return opciones;
    // clave() tambien en el id: "p-200" debe encontrar "P-200"
    return opciones.filter((o) => clave(o.nombre).includes(q) || clave(o.id).includes(q));
  }, [opciones, texto]);

  // con la lista cerrada, el input siempre muestra la seleccion (o vacio)
  useEffect(() => {
    if (abierto) return;
    setTexto(elegida ? elegida.nombre : "");
  }, [abierto, elegida]);

  // posicion de la lista (fija) + reajuste al hacer scroll o cambiar el tamano
  useLayoutEffect(() => {
    if (!abierto) {
      setPos(null);
      return;
    }
    const medir = () => {
      const r = entrada.current?.getBoundingClientRect();
      if (!r) return;
      const cabeAbajo = r.bottom + 4 + ALTO_MAX <= window.innerHeight;
      setPos({
        t: Math.round(cabeAbajo ? r.bottom + 4 : Math.max(4, r.top - 4 - ALTO_MAX)),
        l: Math.round(r.left),
        w: Math.round(Math.max(r.width, 260)),
      });
    };
    medir();
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [abierto]);

  // clic fuera -> cerrar
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegir = (o: OpcionCombo) => {
    onChange(o.id);
    setTexto(o.nombre);
    setAbierto(false);
    setDestacado(0);
  };

  const quitar = () => {
    onChange(null);
    setTexto("");
    setAbierto(false);
    setDestacado(0);
  };

  const visibles = filtradas.slice(0, MAX_FILAS);
  const idx = Math.min(destacado, Math.max(0, visibles.length - 1));

  const alTeclear = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (!visibles.length) return;
      const n = destacado + (ev.key === "ArrowDown" ? 1 : -1);
      setDestacado(Math.max(0, Math.min(visibles.length - 1, n)));
    } else if (ev.key === "Enter") {
      ev.preventDefault(); // que no envie el formulario
      if (abierto && visibles[idx]) elegir(visibles[idx]);
    } else if (ev.key === "Escape") {
      if (abierto) {
        ev.preventDefault();
        setAbierto(false);
      }
    }
  };

  return (
    <div className={`field combo${className ? ` ${className}` : ""}`} ref={raiz}>
      {label ? <label htmlFor={`${uid}-entrada`}>{label}</label> : null}

      <div className="combo-caja">
        {!abierto && elegida?.img ? (
          <img
            className="combo-img combo-img-caja"
            src={elegida.img}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <input
          id={`${uid}-entrada`}
          ref={entrada}
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={`${uid}-lista`}
          aria-autocomplete="list"
          aria-label={label || placeholder}
          autoComplete="off"
          spellCheck={false}
          placeholder={cargando ? "Cargando..." : placeholder}
          value={texto}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            setDestacado(0);
          }}
          onKeyDown={alTeclear}
        />
        {valor !== "" && (
          <button
            type="button"
            className="combo-x"
            title="Quitar seleccion"
            aria-label="Quitar seleccion"
            onClick={quitar}
          >
            ×
          </button>
        )}
      </div>

      {abierto && (
        <ul
          className="combo-lista combo-lista-fija"
          id={`${uid}-lista`}
          role="listbox"
          style={
            pos
              ? { position: "fixed", top: pos.t, left: pos.l, right: "auto", width: pos.w }
              : { position: "fixed", visibility: "hidden" }
          }
        >
          <li className="combo-nota" aria-hidden="true">
            {texto
              ? `${filtradas.length} ${filtradas.length === 1 ? "coincidencia" : "coincidencias"} de ${opciones.length}`
              : `${opciones.length} ${opciones.length === 1 ? "opcion" : "opciones"} · escribe para buscar`}
          </li>

          {visibles.length === 0 ? (
            <li className="combo-vacio">Sin resultados para “{texto}”</li>
          ) : (
            visibles.map((o, i) => (
              <li
                key={`${o.id}-${i}`}
                role="option"
                aria-selected={o.id === valor}
                className={
                  "combo-op" + (i === idx ? " activo" : "") + (o.id === valor ? " elegida" : "")
                }
                onMouseEnter={() => setDestacado(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // que no pierda el foco antes de elegir
                  elegir(o);
                }}
              >
                <span className="combo-izq">
                  {o.img ? (
                    <img
                      className="combo-img"
                      src={o.img}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="combo-nombre">{o.nombre}</span>
                </span>
                <span className="combo-der">
                  {o.nota ? <span className="combo-precio">{o.nota}</span> : null}
                  <span className="combo-id">{o.id}</span>
                </span>
              </li>
            ))
          )}

          {filtradas.length > MAX_FILAS && (
            <li className="combo-nota">
              y {filtradas.length - MAX_FILAS} mas… acota la busqueda
            </li>
          )}
        </ul>
      )}

      {ayuda && <p className="combo-ayuda">{ayuda}</p>}
    </div>
  );
}
