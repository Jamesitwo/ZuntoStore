// Link del Google Sheets con el mapa producto -> link de Dropi (columnas
// idProductoDropi y dropiLink). Se pega el link normal del navegador; el
// servidor lo convierte a CSV, lo prueba y lo guarda.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

interface Estado {
  configurado: boolean;
  link: string;
  origen: "panel" | ".env" | null;
}

export function SheetProductos() {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [link, setLink] = useState("");
  const [ocupado, setOcupado] = useState<"" | "probar" | "guardar">("");
  const [prueba, setPrueba] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void backendSuave<any>("/api/dropi/productos").then((r) => {
      if (r?.ok) {
        setEstado(r);
        setLink(r.link ?? "");
      }
    });
  }, []);

  const textoPrueba = (r: any) =>
    `${r.filas} producto(s) en el sheet${r.sinLink ? ` · ${r.sinLink} sin dropiLink` : ""}${
      r.ejemplos?.length ? ` · ej.: ${r.ejemplos.join(", ")}` : ""
    }`;

  const probar = async () => {
    setOcupado("probar");
    setPrueba(null);
    try {
      const r: any = await backend("/api/dropi/productos/probar", { method: "POST", body: { link: link.trim() } });
      setPrueba({ ok: true, msg: textoPrueba(r) });
    } catch (e) {
      setPrueba({ ok: false, msg: errMsg(e) });
    } finally {
      setOcupado("");
    }
  };

  const guardar = async () => {
    setOcupado("guardar");
    setPrueba(null);
    try {
      const r: any = await backend("/api/dropi/productos", { method: "PUT", body: { link: link.trim() } });
      setEstado(r);
      setLink(r.link ?? "");
      if (r.filas !== undefined) setPrueba({ ok: true, msg: `Guardado · ${textoPrueba(r)}` });
      toast.success(link.trim() ? "Google Sheets de productos guardado" : "Se volvió al sheet del .env");
    } catch (e) {
      setPrueba({ ok: false, msg: errMsg(e) });
      toast.error(errMsg(e));
    } finally {
      setOcupado("");
    }
  };

  if (!estado) return null;
  return (
    <div className="field">
      <label htmlFor="sheet-productos">Google Sheets de productos (link de Dropi)</label>
      <div className="row gap" style={{ marginBottom: 0 }}>
        <input
          id="sheet-productos"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          style={{ flex: "1 1 320px", minWidth: 0 }}
        />
        <button type="button" className="btn" disabled={!link.trim() || !!ocupado} onClick={() => void probar()}>
          {ocupado === "probar" ? "Probando…" : "Probar"}
        </button>
        <button type="button" className="btn primary" disabled={!!ocupado} onClick={() => void guardar()}>
          {ocupado === "guardar" ? "Guardando…" : "Guardar"}
        </button>
        {estado.configurado && link.trim() ? (
          <a className="btn" href={link.trim()} target="_blank" rel="noreferrer">
            Abrir
          </a>
        ) : null}
      </div>
      <p className="campo-ayuda">
        Pega el link normal del sheet. Debe estar compartido como «Cualquier persona con el enlace puede ver» y
        tener las columnas <strong>idProductoDropi</strong> y <strong>dropiLink</strong>. De ahí sale la ficha de
        Dropi de cada producto al subir.{" "}
        {estado.origen === ".env" ? "Ahora se usa el del archivo .env del servidor." : null}
        {!estado.configurado ? <strong> Sin sheet no se puede subir ningún pedido.</strong> : null}
      </p>
      {prueba ? <div className={`banner ${prueba.ok ? "ok" : "error"}`}>{prueba.msg}</div> : null}
      {estado.configurado ? <EscrituraSheet /> : null}
    </div>
  );
}

/**
 * Conexion para ESCRIBIR en el sheet: un Apps Script pegado a la hoja. Asi,
 * al crear un producto desde un enlace de Dropi (Creador IA), Zunto agrega su
 * fila sola.
 */
function EscrituraSheet() {
  const toast = useToast();
  const [info, setInfo] = useState<{ configurada: boolean; scriptUrl: string; codigo: string } | null>(null);
  const [url, setUrl] = useState("");
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState<"" | "probar" | "guardar">("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    void backendSuave<any>("/api/dropi/productos/escritura").then((r) => {
      if (r?.ok) {
        setInfo(r);
        setUrl(r.scriptUrl ?? "");
      }
    });
  }, []);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(info?.codigo ?? "");
      toast.success("Código copiado");
    } catch {
      toast.error("No se pudo copiar: selecciónalo y cópialo a mano");
    }
  };
  const probar = async () => {
    setOcupado("probar");
    setMsg(null);
    try {
      const r: any = await backend("/api/dropi/productos/escritura", { method: "POST", body: { scriptUrl: url.trim() } });
      setMsg({ ok: true, texto: `Funciona · pestaña «${r.hoja}» · columnas: ${(r.columnas ?? []).join(", ")}` });
    } catch (e) {
      setMsg({ ok: false, texto: errMsg(e) });
    } finally {
      setOcupado("");
    }
  };
  const guardar = async () => {
    setOcupado("guardar");
    setMsg(null);
    try {
      const r: any = await backend("/api/dropi/productos/escritura", { method: "PUT", body: { scriptUrl: url.trim() } });
      setInfo((i) => (i ? { ...i, configurada: !!r.escritura?.configurada, scriptUrl: r.escritura?.scriptUrl ?? "" } : i));
      toast.success(url.trim() ? "Script conectado: los productos nuevos se agregan solos" : "Script desconectado");
    } catch (e) {
      setMsg({ ok: false, texto: errMsg(e) });
    } finally {
      setOcupado("");
    }
  };

  if (!info) return null;
  return (
    <details className="sheet-escritura">
      <summary>
        Agregar al sheet los productos nuevos{" "}
        <span className={`chip ${info.configurada ? "ok" : ""}`}>{info.configurada ? "conectado" : "sin conectar"}</span>
      </summary>
      <p className="campo-ayuda">
        Cuando creas un producto en LucidSales desde un enlace de Dropi (Creador IA), Zunto agrega su fila al sheet
        (Nombre, idProductoDropi, nameProductoDropi y dropiLink). Si el id ya está, no la repite. Para poder escribir
        en tu hoja se usa un pequeño script de Google, una sola vez:
      </p>
      <ol className="pasos-script small">
        <li>
          Abre el sheet → <strong>Extensiones → Apps Script</strong>, borra lo que haya y pega este código{" "}
          <button type="button" className="btn sm" onClick={() => void copiar()}>
            Copiar código
          </button>{" "}
          <button type="button" className="btn sm" onClick={() => setVer((v) => !v)}>
            {ver ? "Ocultar" : "Ver"}
          </button>
        </li>
        <li>
          <strong>Implementar → Nueva implementación →</strong> tipo <strong>Aplicación web</strong> · Ejecutar como:{" "}
          <strong>yo</strong> · Quién tiene acceso: <strong>Cualquier usuario</strong> → Implementar (Google pide
          autorizar tu cuenta).
        </li>
        <li>Copia la <strong>URL de la aplicación web</strong> (termina en /exec), pégala aquí y guarda.</li>
      </ol>
      {ver ? <textarea className="codigo-script" readOnly value={info.codigo} rows={14} onFocus={(e) => e.target.select()} /> : null}
      <div className="row gap" style={{ marginTop: 8 }}>
        <input
          aria-label="URL de la aplicación web del script"
          placeholder="https://script.google.com/macros/s/…/exec"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: "1 1 320px", minWidth: 0 }}
        />
        <button type="button" className="btn" disabled={!url.trim() || !!ocupado} onClick={() => void probar()}>
          {ocupado === "probar" ? "Probando…" : "Probar"}
        </button>
        <button type="button" className="btn primary" disabled={!!ocupado} onClick={() => void guardar()}>
          {ocupado === "guardar" ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <p className="campo-ayuda">
        El código trae una clave propia: solo Zunto puede agregar filas con él. Si alguna vez la cambias, vuelve a
        copiar el código y crea una implementación nueva.
      </p>
      {msg ? <div className={`banner ${msg.ok ? "ok" : "error"}`}>{msg.texto}</div> : null}
    </details>
  );
}
