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
    </div>
  );
}
