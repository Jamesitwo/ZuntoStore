import { useState } from "react";
import { api, errMsg } from "../api/client";
import { useToast } from "./Toast";
import { ErrorBanner, JsonView } from "./ui";

/**
 * Editor JSON + POST para endpoints cuyo body no esta documentado
 * (secciones 6 y 7 de la API). Devuelve la respuesta cruda.
 */
export function JsonPost({
  path,
  initialBody = "{}",
  label = "Enviar",
}: {
  path: string;
  initialBody?: string;
  label?: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [res, setRes] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const send = async () => {
    setErr(null);
    setLoading(true);
    setRes(null);
    try {
      const parsed = JSON.parse(body);
      const out = await api(path, { method: "POST", body: parsed });
      setRes(out);
      toast.success(`POST ${path} respondio correctamente`);
    } catch (e) {
      const msg =
        body.trim().startsWith("{") || body.trim().startsWith("[")
          ? errMsg(e)
          : `JSON invalido: ${errMsg(e)}`;
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <code>POST {path}</code>
      </div>
      <textarea
        className="code-input"
        rows={8}
        spellCheck={false}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="row gap">
        <button className="btn primary" onClick={send} disabled={loading}>
          {loading ? "Enviando..." : label}
        </button>
        <button className="btn ghost" onClick={() => setBody("{}")}>
          Limpiar
        </button>
      </div>
      <ErrorBanner error={err} />
      <JsonView data={res} />
    </div>
  );
}
