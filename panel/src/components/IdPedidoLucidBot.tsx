// Cuando llega un pedido, su id se guarda en un campo personalizado del
// contacto del cliente en Lucid Bot (POST /contacts/{id}/custom_fields/{id}).
// Se guarda con el boton de la tarjeta de Lucid Bot (mismo formulario).
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { fmtFecha } from "../lib/format";

interface Form {
  pedidoFieldId: string;
  pedidoValor: "id" | "numero";
  pedidoActivo: boolean;
}

interface Tratado {
  id: string;
  numero?: number | null;
  ok?: boolean;
  ts: string;
  detalle?: string;
}

export function IdPedidoLucidBot({ form, onChange }: { form: Form; onChange: (patch: Partial<Form>) => void }) {
  const [prueba, setPrueba] = useState("");
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ultimos, setUltimos] = useState<Tratado[]>([]);

  useEffect(() => {
    void backendSuave<{ ok: boolean; pedidos?: Tratado[] }>("/api/lucidbot/pedidos").then((r) => {
      if (r?.ok) setUltimos(r.pedidos ?? []);
    });
  }, []);

  const probar = async () => {
    setProbando(true);
    setResultado(null);
    try {
      const r: any = await backend("/api/lucidbot/pedido/probar", {
        method: "POST",
        body: { id: prueba.trim(), pedidoFieldId: form.pedidoFieldId.trim(), pedidoValor: form.pedidoValor },
      });
      setResultado({ ok: true, msg: r?.msg ?? "Guardado en Lucid Bot" });
    } catch (e) {
      setResultado({ ok: false, msg: errMsg(e) });
    } finally {
      setProbando(false);
    }
  };

  return (
    <>
      <div className="card-title" style={{ marginTop: 12 }}>Id del pedido en el contacto</div>
      <p className="muted small">
        Cuando llega un pedido nuevo, su id se guarda en un campo personalizado del contacto del cliente en Lucid Bot.
        Así el bot sabe de qué pedido es (por ejemplo, para mandar el estado del envío). Los pedidos que ya existían
        al encenderlo no se tocan. Guarda con el botón de esta tarjeta.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="lb-pedido-field">ID del campo personalizado</label>
          <input
            id="lb-pedido-field"
            value={form.pedidoFieldId}
            onChange={(e) => onChange({ pedidoFieldId: e.target.value })}
            placeholder="Ej. 123456"
          />
          <span className="campo-ayuda">
            Se escribe con POST /contacts/<em>teléfono</em>/custom_fields/<em>este ID</em>.
          </span>
        </div>
        <div className="field">
          <label htmlFor="lb-pedido-valor">Qué id guardar</label>
          <select
            id="lb-pedido-valor"
            value={form.pedidoValor}
            onChange={(e) => onChange({ pedidoValor: e.target.value === "numero" ? "numero" : "id" })}
          >
            <option value="id">Id interno de LucidSales (ej. 3256175)</option>
            <option value="numero">Número del pedido (ej. #6106)</option>
          </select>
          <span className="campo-ayuda">El id interno es el que usan nuestras APIs (estado, envíos).</span>
        </div>
        <div className="field">
          <label htmlFor="lb-pedido-on">Enviar el id</label>
          <label className="switch" htmlFor="lb-pedido-on">
            <input
              id="lb-pedido-on"
              type="checkbox"
              checked={form.pedidoActivo}
              onChange={(e) => onChange({ pedidoActivo: e.target.checked })}
            />
            <span className="switch-pista" aria-hidden="true" />
            <span className="switch-texto">{form.pedidoActivo ? "Activado (revisa cada minuto)" : "Apagado"}</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="lb-pedido-probar">Probar con un pedido</label>
          <div className="row gap" style={{ marginBottom: 0 }}>
            <input
              id="lb-pedido-probar"
              inputMode="numeric"
              value={prueba}
              onChange={(e) => setPrueba(e.target.value)}
              placeholder="Id interno del pedido"
              style={{ flex: "1 1 140px", minWidth: 0 }}
            />
            <button
              type="button"
              className="btn"
              disabled={!prueba.trim() || !form.pedidoFieldId.trim() || probando}
              onClick={() => void probar()}
            >
              {probando ? "Probando…" : "Probar"}
            </button>
          </div>
          <span className="campo-ayuda">
            Prueba con el ID del campo escrito arriba. Para que se haga solo con cada pedido nuevo, enciende «Enviar el
            id» y guarda la tarjeta.
          </span>
        </div>
      </div>
      {resultado ? <div className={`banner ${resultado.ok ? "ok" : "error"}`}>{resultado.msg}</div> : null}
      {ultimos.length ? (
        <details style={{ marginTop: 8 }}>
          <summary className="muted small">Últimos pedidos enviados ({ultimos.length})</summary>
          <ul className="muted small">
            {ultimos.map((u) => (
              <li key={u.id}>
                {u.ok ? "✓" : "✗"} #{u.numero ?? u.id} · {fmtFecha(u.ts)}
                {u.ok ? "" : ` · ${u.detalle ?? ""}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
