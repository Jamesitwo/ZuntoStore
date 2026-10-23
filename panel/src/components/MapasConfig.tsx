// API key de Google Maps para el validador de direcciones propio.
// La key nunca vuelve completa: el servidor solo muestra una vista enmascarada.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

interface Estado {
  configurada: boolean;
  apiKeyVista: string;
  origen: "panel" | ".env" | null;
}

export function MapasConfig() {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [key, setKey] = useState("");
  const [ocupado, setOcupado] = useState<"" | "guardar" | "probar" | "borrar">("");
  const [prueba, setPrueba] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void backendSuave<any>("/api/mapas/config").then((r) => {
      if (r?.ok) setEstado(r);
    });
  }, []);

  const guardar = async () => {
    setOcupado("guardar");
    try {
      const r: any = await backend("/api/mapas/config", { method: "PUT", body: { apiKey: key.trim() } });
      setEstado(r);
      setKey("");
      toast.success("API key de Google Maps guardada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado("");
    }
  };

  const probar = async () => {
    setOcupado("probar");
    setPrueba(null);
    try {
      const r: any = await backend("/api/mapas/probar", { method: "POST", body: key.trim() ? { apiKey: key.trim() } : {} });
      setPrueba({ ok: !!r?.ok, msg: String(r?.msg ?? "") });
    } catch (e) {
      setPrueba({ ok: false, msg: errMsg(e) });
    } finally {
      setOcupado("");
    }
  };

  const borrar = async () => {
    if (!window.confirm("¿Borrar la API key de Google Maps? El validador solo revisará el formato.")) return;
    setOcupado("borrar");
    try {
      setEstado(await backend<any>("/api/mapas/config", { method: "DELETE" }));
      toast.success("API key borrada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado("");
    }
  };

  if (!estado) return null;
  return (
    <section className="card">
      <div className="card-title">Verificación de direcciones (Google Maps)</div>
      <p className="muted small">
        El botón «Validar dirección» del pedido revisa el formato y, con esta key, confirma en Google
        Maps que la dirección existe en la ciudad del pedido. Google da 10.000 consultas gratis al mes.
        En Google Cloud habilita la «Geocoding API» y crea una API key.
      </p>
      <p className="small">
        Estado:{" "}
        {estado.configurada ? (
          <span className="chip ok">
            Configurada · {estado.apiKeyVista}
            {estado.origen === ".env" ? " (del servidor)" : ""}
          </span>
        ) : (
          <span className="chip alerta">Sin key: solo se revisa el formato</span>
        )}
      </p>
      <div className="row gap">
        <input
          type="password"
          autoComplete="off"
          placeholder={estado.configurada ? "Pega una key nueva para reemplazarla" : "AIza…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="API key de Google Maps"
          style={{ minWidth: 260 }}
        />
        <button className="btn primary" disabled={!key.trim() || !!ocupado} onClick={() => void guardar()}>
          {ocupado === "guardar" ? "Guardando…" : "Guardar"}
        </button>
        <button className="btn" disabled={(!key.trim() && !estado.configurada) || !!ocupado} onClick={() => void probar()}>
          {ocupado === "probar" ? "Probando…" : "Probar"}
        </button>
        {estado.origen === "panel" ? (
          <button className="btn danger" disabled={!!ocupado} onClick={() => void borrar()}>
            Borrar
          </button>
        ) : null}
      </div>
      {prueba ? <div className={`banner ${prueba.ok ? "ok" : "error"}`}>{prueba.msg}</div> : null}
    </section>
  );
}
