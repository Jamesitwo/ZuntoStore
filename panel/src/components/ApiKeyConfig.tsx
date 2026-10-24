// Clave de la API para integraciones (Lucid Bot, n8n…). Se genera aqui y se
// muestra UNA sola vez: el servidor solo guarda su huella.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { fmtFecha } from "../lib/format";
import { useToast } from "./Toast";

interface Estado {
  generada: boolean;
  vista: string;
  creada: string | null;
  creadaPor: string | null;
  variableServidor: boolean;
}

export function ApiKeyConfig() {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [nueva, setNueva] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void backendSuave<any>("/api/apikey").then((r) => {
      if (r?.ok) setEstado(r);
    });
  }, []);

  const generar = async () => {
    if (
      estado?.generada &&
      !window.confirm("¿Generar una clave nueva? La actual deja de funcionar y habrá que cambiarla en Lucid Bot.")
    )
      return;
    setOcupado(true);
    try {
      const r: any = await backend("/api/apikey/generar", { method: "POST", body: {} });
      setNueva(r.clave);
      setEstado(r);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const revocar = async () => {
    if (!window.confirm("¿Revocar la clave? Las integraciones que la usan dejarán de funcionar.")) return;
    setOcupado(true);
    try {
      setEstado(await backend<any>("/api/apikey", { method: "DELETE" }));
      setNueva(null);
      toast.success("Clave revocada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(nueva ?? "");
      toast.success("Clave copiada");
    } catch {
      toast.error("No se pudo copiar: selecciónala y cópiala a mano");
    }
  };

  if (!estado) return null;
  return (
    <section className="card">
      <div className="card-title">Clave de la API (integraciones)</div>
      <p className="muted small">
        Para que Lucid Bot u otro sistema le hable a este servidor (por ejemplo, para mandar el estado del envío). Va en la
        cabecera <code>x-api-key</code>. Se muestra una sola vez al generarla: guárdala en Lucid Bot en ese momento.
      </p>
      <p className="small">
        Estado:{" "}
        {estado.generada ? (
          <span className="chip ok">
            Activa · {estado.vista}
            {estado.creada ? ` · creada ${fmtFecha(estado.creada)}` : ""}
            {estado.creadaPor ? ` por ${estado.creadaPor}` : ""}
          </span>
        ) : (
          <span className="chip">Sin clave generada</span>
        )}
        {estado.variableServidor ? (
          <span className="muted small"> · también vale la de la variable API_KEY del servidor</span>
        ) : null}
      </p>
      {nueva ? (
        <div className="banner ok">
          <div>
            <strong>Copia esta clave ahora:</strong> no se volverá a mostrar.
          </div>
          <code style={{ wordBreak: "break-all", display: "block", margin: "8px 0" }}>{nueva}</code>
          <button type="button" className="btn sm" onClick={() => void copiar()}>
            Copiar
          </button>
        </div>
      ) : null}
      <div className="row gap">
        <button type="button" className="btn primary" disabled={ocupado} onClick={() => void generar()}>
          {ocupado ? "…" : estado.generada ? "Generar una nueva" : "Generar clave"}
        </button>
        {estado.generada ? (
          <button type="button" className="btn danger" disabled={ocupado} onClick={() => void revocar()}>
            Revocar
          </button>
        ) : null}
      </div>
    </section>
  );
}
