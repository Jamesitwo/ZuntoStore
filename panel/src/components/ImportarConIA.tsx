// Importacion masiva de productos de Dropi a LucidSales: se pegan los links
// (o IDs) de Dropi, Zunto lee cada ficha, la IA escribe SOLO los campos de
// LucidSales (nombre, descripcion, modo de uso, caracteristicas, contenido y
// bienvenida) y se crea el producto. Va uno por uno: deja la pagina abierta.
import { useState } from "react";
import { backend } from "../api/backend";
import { creador, type FichaDropi } from "../api/creador";
import { useAuth } from "../auth/AuthContext";
import { agregarAlSheet, crearProductoLucid, guardarMensajeInicialLucid } from "../lib/crearProducto";
import { ElegirTiendaBot, asignarTiendaBot, type TiendaBot } from "./ElegirTiendaBot";
import { Modal } from "./Modal";
import { money } from "./ui";

interface Fila {
  /** id de Dropi */
  entrada: string;
  /** link completo (o el id si se pego solo el id) */
  url: string;
  estado: "pendiente" | "leyendo" | "leido" | "creando" | "listo" | "error";
  ficha?: FichaDropi;
  precio?: string;
  nombre?: string;
  idLucid?: string;
  faltan?: string[];
  fuentes?: { url: string; titulo: string }[];
  error?: string;
  avisos?: string[];
}

interface FichaIA {
  nombre: string;
  descripcion: string;
  modoUso: string;
  caracteristicas: string;
  contenido: string;
  bienvenida: string;
  faltan: string[];
  fuentes?: { url: string; titulo: string }[];
}

/**
 * Links o IDs de Dropi, uno por linea (o separados por coma/espacio). El link
 * se guarda COMPLETO: Dropi necesita el nombre del final
 * (/product-details/2350401/combo-taladro...) para abrir la ficha.
 */
function entradas(texto: string): { id: string; url: string }[] {
  const out: { id: string; url: string }[] = [];
  for (const t of texto.split(/[\s,;]+/)) {
    const x = t.trim();
    if (!x) continue;
    const id = x.match(/product-details\/(\d+)/)?.[1] ?? (/^\d{3,9}$/.test(x) ? x : null);
    if (id && !out.some((o) => o.id === id)) out.push({ id, url: /^https?:\/\//i.test(x) ? x : id });
  }
  return out.slice(0, 50);
}

export function ImportarConIA({ open, onClose, onListo }: { open: boolean; onClose: () => void; onListo: () => void }) {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [tienda, setTienda] = useState<TiendaBot>("zunto");
  const [conBienvenida, setConBienvenida] = useState(true);
  const [alSheet, setAlSheet] = useState(true);
  // buscar mas informacion del producto en internet
  const [buscarWeb, setBuscarWeb] = useState<"no" | "corta" | "siempre">("corta");
  const [trabajando, setTrabajando] = useState<"" | "leyendo" | "creando">("");

  const poner = (i: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, ...cambio } : f)));

  const leer = async () => {
    const ids = entradas(texto);
    if (!ids.length) return;
    const nuevas: Fila[] = ids.map((e) => ({ entrada: e.id, url: e.url, estado: "pendiente" }));
    setFilas(nuevas);
    setTrabajando("leyendo");
    for (let i = 0; i < nuevas.length; i++) {
      poner(i, { estado: "leyendo" });
      let ok = false;
      // Dropi puede estar ocupado subiendo un pedido: se espera y se reintenta
      for (let intento = 0; intento < 4 && !ok; intento++) {
        try {
          const { producto } = await creador.fichaDropi(nuevas[i].url);
          poner(i, {
            estado: "leido",
            ficha: producto,
            precio: producto.precioSugerido ? String(producto.precioSugerido) : "",
            nombre: producto.nombre,
          });
          ok = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/ocupado/i.test(msg) && intento < 3) {
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }
          poner(i, { estado: "error", error: msg });
          break;
        }
      }
    }
    setTrabajando("");
  };

  const crear = async () => {
    setTrabajando("creando");
    let creados = 0;
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      if (f.estado !== "leido" || !f.ficha) continue;
      const precio = Number(String(f.precio ?? "").replace(/\D/g, ""));
      if (!(precio > 0)) {
        poner(i, { estado: "error", error: "Falta el precio de venta" });
        continue;
      }
      poner(i, { estado: "creando", error: undefined });
      const avisos: string[] = [];
      try {
        const { ficha } = await backend<{ ok: boolean; ficha: FichaIA }>("/api/creador/ficha-ia", {
          method: "POST",
          body: {
            producto: { id: f.ficha.idDropi, nombre: f.ficha.nombre, descripcion: f.ficha.descripcion, imagenes: f.ficha.imagenes },
            precio,
            tienda,
            buscarWeb,
          },
        });
        const nombre = (ficha.nombre || f.nombre || f.ficha.nombre).trim();
        const id = await crearProductoLucid({
          idEmpresa,
          nombre,
          precio,
          descripcion: ficha.descripcion,
          contenido: ficha.contenido,
          caracteristicas: ficha.caracteristicas,
          modoUso: ficha.modoUso,
          imagenes: f.ficha.imagenes.slice(0, 6),
          idDropi: f.ficha.idDropi,
          precioProveedor: f.ficha.precioProveedor,
          precioSugerido: f.ficha.precioSugerido,
        });
        if (conBienvenida && ficha.bienvenida) {
          try {
            await guardarMensajeInicialLucid(id, ficha.bienvenida, f.ficha.imagenes.slice(0, 2));
          } catch (e) {
            avisos.push(`bienvenida no guardada: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        try {
          await asignarTiendaBot(nombre, tienda);
        } catch (e) {
          avisos.push(`no se asignó a la segunda tienda: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (alSheet && f.ficha.idDropi) {
          try {
            const r = await agregarAlSheet({ nombre, idDropi: f.ficha.idDropi, nombreDropi: f.ficha.nombre, dropiLink: f.ficha.url });
            if (r === "sin-script") avisos.push("no se agregó al Google Sheets (conecta el script en Ajustes)");
          } catch (e) {
            avisos.push(`no se agregó al Google Sheets: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        poner(i, { estado: "listo", idLucid: id, nombre, faltan: ficha.faltan, fuentes: ficha.fuentes ?? [], avisos });
        creados++;
      } catch (e) {
        poner(i, { estado: "error", error: e instanceof Error ? e.message : String(e), avisos });
      }
    }
    setTrabajando("");
    if (creados) onListo();
  };

  const leidos = filas.filter((f) => f.estado === "leido").length;

  return (
    <Modal
      open={open}
      title="Importar productos de Dropi con IA"
      onClose={() => (trabajando ? undefined : onClose())}
      footer={
        <>
          <button type="button" className="btn ghost" disabled={Boolean(trabajando)} onClick={onClose}>
            Cerrar
          </button>
          {leidos ? (
            <button type="button" className="btn primary" disabled={Boolean(trabajando)} onClick={() => void crear()}>
              {trabajando === "creando" ? "Creando…" : `✨ Crear ${leidos} producto(s) en LucidSales`}
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={Boolean(trabajando) || !entradas(texto).length} onClick={() => void leer()}>
              {trabajando === "leyendo" ? "Leyendo de Dropi…" : `Leer ${entradas(texto).length || ""} producto(s) de Dropi`}
            </button>
          )}
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Pega los links (o los IDs) de los productos de Dropi, uno por línea (máximo 50). Zunto lee cada ficha, la IA escribe solo los campos
        de LucidSales (nombre, descripción, modo de uso, características, contenido y mensaje de bienvenida) y crea el producto con las fotos
        y el precio que pongas. Si la descripción de Dropi se queda corta, la IA puede buscar el producto en internet (solo usa lo que sea de ese
        mismo modelo). No genera creativos. Deja esta ventana abierta mientras trabaja.
      </p>
      {!filas.length ? (
        <textarea
          rows={6}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"https://app.dropi.co/dashboard/product-details/930615/...\n838390\n2232418"}
          style={{ width: "100%" }}
        />
      ) : null}
      <div className="row gap wrap" style={{ margin: "10px 0" }}>
        <ElegirTiendaBot valor={tienda} onChange={setTienda} disabled={Boolean(trabajando)} />
        <label className="check-linea">
          <input type="checkbox" checked={conBienvenida} onChange={(e) => setConBienvenida(e.target.checked)} />
          Mensaje de bienvenida del bot
        </label>
        <label className="check-linea">
          <input type="checkbox" checked={alSheet} onChange={(e) => setAlSheet(e.target.checked)} />
          Agregar al Google Sheets
        </label>
        <label className="small">
          Buscar más información en internet{" "}
          <select value={buscarWeb} disabled={Boolean(trabajando)} onChange={(e) => setBuscarWeb(e.target.value as "no" | "corta" | "siempre")}>
            <option value="corta">Solo si la descripción de Dropi es corta o no trae datos</option>
            <option value="siempre">Siempre</option>
            <option value="no">No buscar</option>
          </select>
        </label>
      </div>
      {filas.length ? (
        <div className="importar-ia-lista">
          {filas.map((f, i) => (
            <div key={f.entrada} className={`importar-ia-fila ${f.estado}`}>
              {f.ficha?.imagenes?.[0] ? <img src={f.ficha.imagenes[0]} alt="" /> : <div className="importar-ia-img" />}
              <div className="importar-ia-info">
                <strong>{f.nombre || f.ficha?.nombre || `Dropi ${f.entrada}`}</strong>
                <span className="muted small">
                  ID {f.entrada}
                  {f.ficha ? ` · proveedor ${money(f.ficha.precioProveedor ?? 0)} · sugerido ${money(f.ficha.precioSugerido ?? 0)} · stock ${f.ficha.stock}` : ""}
                </span>
                {f.estado === "error" ? <span className="small" style={{ color: "#b42318" }}>⚠ {f.error}</span> : null}
                {f.estado === "listo" ? (
                  <span className="small" style={{ color: "#146c3a" }}>
                    ✅ Creado en LucidSales (id {f.idLucid}){f.faltan?.length ? ` · revisa: ${f.faltan.join(", ")}` : ""}
                  </span>
                ) : null}
                {f.fuentes?.length ? (
                  <span className="muted small">
                    🌐 Completado con:{" "}
                    {f.fuentes.map((x, k) => (
                      <a key={k} href={x.url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                        {x.titulo || new URL(x.url).hostname}
                      </a>
                    ))}
                  </span>
                ) : null}
                {f.avisos?.length ? <span className="muted small">{f.avisos.join(" · ")}</span> : null}
              </div>
              <div className="importar-ia-precio">
                {f.estado === "leido" ? (
                  <label className="small">
                    Precio de venta
                    <input value={f.precio ?? ""} inputMode="numeric" onChange={(e) => poner(i, { precio: e.target.value })} />
                  </label>
                ) : (
                  <span className="small muted">
                    {{ pendiente: "En cola", leyendo: "Leyendo…", leido: "", creando: "La IA escribe y se crea…", listo: "", error: "" }[f.estado]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {filas.length && !trabajando ? (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setFilas([]);
            setTexto("");
          }}
        >
          Empezar otra importación
        </button>
      ) : null}
    </Modal>
  );
}
