import { useEffect, useState } from "react";
import { errMsg } from "../api/client";
import { backend, backendSuave, cabecerasBackend } from "../api/backend";
import { AnalisisPedido } from "./AnalisisPedido";
import { IntentosSubida } from "./IntentosSubida";
import { useToast } from "./Toast";
import { ErrorBanner, Spinner } from "./ui";

/**
 * Agente de Dropi en el detalle del pedido: valida el chat del pedido contra
 * lo que pide Dropi (producto, precio, direccion y confirmacion) y SOLO si
 * todo calza lo sube a Dropi por el navegador, con el seguro antidevoluciones.
 *
 *   GET  /api/pedidos/:id/conversacion  -> consulta la conversación actual en LucidBot
 *   POST /api/pedidos/:id/validar       -> agente: decide subir/frenar (sin subir)
 *   POST /api/pedidos/:id/subir         -> valida y sube (via:"navegador")
 *
 * La subida responde 409 con los motivos cuando el agente frena, 401 si la
 * sesion de Dropi vencio y 409 si aparece captcha: cada caso se muestra aparte.
 */

/** POST a nuestro backend devolviendo {status, datos} sin lanzar en errores. */
async function postAgente(path: string, body: unknown): Promise<{ status: number; datos: any }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...cabecerasBackend(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, datos: { msg: "No se pudo conectar con el servidor (¿está encendido?)" } };
  }
  const datos = await res.json().catch(() => null);
  return { status: res.status, datos };
}

/** Como se lee cada resultado de la subida automatica en el detalle. */
const VEREDICTOS: Record<string, { texto: string; tono: "ok" | "warn" | "alerta" | "" }> = {
  subido: { texto: "SUBIR ✓ — se subió a Dropi", tono: "ok" },
  preparado: { texto: "SUBIR ✓ — formulario preparado (modo prueba, no se creó)", tono: "ok" },
  "subido-pendiente-confirmacion": { texto: "Subido a Dropi; falta pasar a Confirmado en LucidSales", tono: "warn" },
  frenado: { texto: "FRENAR ✕ — algo del chat no coincide con el pedido", tono: "warn" },
  "requiere-revision": { texto: "EN REVISIÓN — agotó los intentos y ya no se reintenta solo", tono: "alerta" },
  "direccion-invalida": { texto: "DIRECCIÓN INVÁLIDA — no tiene el formato de Colombia; no se subió", tono: "alerta" },
  "resultado-incierto": { texto: "INCIERTO — verifica en Dropi si la orden quedó creada", tono: "alerta" },
  "requiere-humano": { texto: "Lo sube una persona (prepago o recoge en oficina de Inter/Coordinadora)", tono: "warn" },
  "sin-conversacion": { texto: "Sin veredicto — no se pudo leer la conversación", tono: "warn" },
  "sin-tienda-dropi": { texto: "Sin veredicto — la tienda no tiene tienda de Dropi configurada", tono: "warn" },
  error: { texto: "Error al subir a Dropi", tono: "warn" },
  "requiere-login": { texto: "En espera — la sesión de Dropi venció", tono: "warn" },
  "requiere-captcha": { texto: "En espera — Dropi pidió captcha", tono: "warn" },
  "estado-incompatible": { texto: "No aplica — el estado del pedido no se sube", tono: "" },
  "posible-duplicado": { texto: "POSIBLE REPETIDO — el cliente ya tiene otro pedido reciente; revísalo", tono: "alerta" },
  "envio-caro": { texto: "Envío muy caro — no se subió", tono: "warn" },
  "sin-transportadora": { texto: "Sin transportadora disponible", tono: "warn" },
  "pedido-antiguo": { texto: "PEDIDO ANTIGUO — pasó el límite de días; no se sube solo (súbelo desde aquí si hay que enviarlo)", tono: "warn" },
  "entrega-programada": { texto: "PROGRAMADO — el cliente lo pidió para otra fecha; se envía cuando se acerque", tono: "warn" },
  "resuelto-a-mano": { texto: "RESUELTO — una persona lo subió a mano o lo movió en LucidSales; no se reintenta", tono: "ok" },
};

/**
 * Ultimo veredicto de la SUBIDA AUTOMATICA para este pedido (lo que decidio
 * sola, sin que nadie pulsara nada), con el analisis de la IA.
 */
function VeredictoAutomatico({ id, recarga }: { id: number | string; recarga: number }) {
  const toast = useToast();
  const [datos, setDatos] = useState<any>(undefined);
  const [otra, setOtra] = useState(0);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const r = await backendSuave<any>(`/api/subida/pedido/${encodeURIComponent(String(id))}`);
      if (!cancel) setDatos(r?.ok ? r : null);
    })();
    return () => {
      cancel = true;
    };
  }, [id, recarga, otra]);

  if (datos === undefined) return null;
  if (datos === null) return null; // backend sin este endpoint o caido: no estorba
  const reg = datos.registro;
  if (!reg) {
    return (
      <p className="muted small" style={{ marginTop: 0 }}>
        Subida automática: este pedido todavía no ha sido revisado.
      </p>
    );
  }
  const v = VEREDICTOS[reg.accion] ?? { texto: reg.accion, tono: "" };
  const aprobarDuplicado = async () => {
    if (!window.confirm("¿Revisaste el chat y es una compra NUEVA (no el mismo pedido repetido)? Se subirá en la próxima vuelta.")) return;
    try {
      await backend(`/api/subida/pedido/${encodeURIComponent(String(id))}/aprobar-duplicado`, { method: "POST", body: {} });
      toast.info("Se subirá en la próxima vuelta de la subida automática");
      setOtra((x) => x + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const reintentar = async () => {
    try {
      await backend("/api/subida/reintentar", { method: "POST", body: { id: String(id) } });
      toast.info("Se volverá a intentar en la próxima vuelta de la subida automática");
      setOtra((x) => x + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className={`veredicto-auto ${v.tono}`}>
      <div className="row between wrap">
        <strong>Veredicto de la subida automática: {v.texto}</strong>
        <span className="muted small">
          {reg.ts ? new Date(reg.ts).toLocaleString("es-CO") : ""}
          {reg.intentos ? ` · intento(s): ${reg.intentos} de ${datos.maxIntentos ?? 2}` : ""}
        </span>
      </div>
      {reg.dropi && (reg.dropi.ganancia !== null || reg.dropi.envio !== null || reg.dropi.id) ? (
        <div className="dropi-resumen">
          {reg.dropi.id ? (
            <span>
              Orden Dropi <strong>#{reg.dropi.id}</strong>
            </span>
          ) : null}
          {typeof reg.dropi.ganancia === "number" ? (
            <span className={reg.dropi.ganancia < 0 ? "dropi-perdida" : "dropi-ganancia"}>
              Ganancia <strong>${Math.round(reg.dropi.ganancia).toLocaleString("es-CO")}</strong>
            </span>
          ) : null}
          {typeof reg.dropi.envio === "number" ? (
            <span>
              Envío <strong>${Math.round(reg.dropi.envio).toLocaleString("es-CO")}</strong>
            </span>
          ) : null}
          {reg.accion === "preparado" ? <span className="muted small">(modo prueba: no se creó)</span> : null}
        </div>
      ) : null}
      {reg.detalle ? <p className="small" style={{ margin: "6px 0 0" }}>{reg.detalle}</p> : null}
      {reg.analisis ? <AnalisisPedido analisis={reg.analisis} abierto /> : null}
      {reg.accion === "posible-duplicado" ? (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void aprobarDuplicado()}>
          Es una compra nueva: subirlo
        </button>
      ) : null}
      {reg.accion === "requiere-revision" || reg.accion === "direccion-invalida" ? (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void reintentar()}>
          Reintentar en la subida automática
        </button>
      ) : null}
    </div>
  );
}

const NOMBRES_CHECK: Record<string, string> = {
  productos: "Cantidad de líneas",
  producto: "Producto",
  cantidad: "Cantidad",
  precio: "Precio",
  direccion: "Dirección (chat vs pedido)",
  direccionValida: "Dirección válida (Colombia)",
  direccionMapa: "Dirección en el mapa",
  ubicacion: "Ciudad/departamento",
  entregaFutura: "Fecha de entrega",
  corregimiento: "Corregimiento",
  variante: "Variante",
  forzado: "Sin validar",
  estado: "Estado del pedido",
  confirmacion: "Confirmación",
  duplicado: "Pedido repetido",
};

export function SubirPedidoDropi({
  id,
  onConfirmado,
}: {
  id: number | string;
  onConfirmado?: () => void;
}) {
  const toast = useToast();

  const [conv, setConv] = useState<any>(null);
  const [verChat, setVerChat] = useState(false);
  const [validando, setValidando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [subida, setSubida] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recargaVeredicto, setRecargaVeredicto] = useState(0);

  const url = `/api/pedidos/${encodeURIComponent(String(id))}`;

  // muestra la conversación más reciente consultada desde LucidBot
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const r = await backendSuave<any>(`${url}/conversacion`);
      if (cancel) return;
      setConv(r && r.ok !== false ? r : null);
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const validar = async () => {
    setValidando(true);
    setErr(null);
    setResultado(null);
    try {
      const { status, datos } = await postAgente(`${url}/validar`, {});
      if (status === 0) throw new Error(datos?.msg || "No se pudo conectar con el servidor");
      // OJO: /validar responde 200 con `ok:false` cuando el agente frena (el
      // campo `ok` es el veredicto del agente, no el estado del HTTP). Solo un
      // 4xx/5xx es un error real.
      if (status >= 400) throw new Error(datos?.msg || `La validación falló (HTTP ${status})`);
      setResultado(datos);
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setValidando(false);
    }
  };

  const subir = async (aceptarDuplicado = false, forzar = false) => {
    setSubiendo(true);
    setErr(null);
    setSubida(null);
    try {
      const { status, datos } = await postAgente(`${url}/subir`, {
        via: "navegador",
        ...(aceptarDuplicado ? { aceptarDuplicado: true } : {}),
        ...(forzar ? { forzar: true } : {}),
      });

      if (status === 0) throw new Error(datos?.msg || "No se pudo conectar con el servidor");

      if (status === 401 && datos?.requiereLogin) {
        setSubida({ tipo: "login", msg: datos.motivo || "La sesión de Dropi venció", notificacionLucidBot: datos?.notificacionLucidBot });
        toast.error("Sesión de Dropi vencida: vuelve a entrar con node dropiLogin.mjs");
        return;
      }
      if (status === 409 && datos?.requiereCaptcha) {
        setSubida({ tipo: "captcha", msg: datos.motivo || "Dropi exige captcha", notificacionLucidBot: datos?.notificacionLucidBot });
        toast.error("Dropi exige captcha: resuélvelo a mano en el navegador");
        return;
      }
      if (status === 202 && datos?.resultadoIncierto) {
        setSubida({
          tipo: "incierto",
          msg: datos.detalle || "Dropi no confirmó el resultado. Verifica el pedido en Dropi antes de reintentar.",
          notificacionLucidBot: datos?.notificacionLucidBot,
        });
        toast.error("Resultado incierto: verifica Dropi antes de reintentar");
        return;
      }
      if (status === 409) {
        // el agente frenó: no se subió nada
        setSubida({ tipo: "frenado", motivos: datos?.motivos ?? [], validacion: datos?.validacion, msg: datos?.msg, notificacionLucidBot: datos?.notificacionLucidBot, entrega: datos?.entrega ?? null });
        toast.error(datos?.msg || "El agente frenó el pedido: no se subió a Dropi");
        return;
      }
      if (!datos?.ok) {
        if (datos?.notificacionLucidBot) setSubida({ tipo: "fallido", notificacionLucidBot: datos.notificacionLucidBot });
        throw new Error(datos?.msg || datos?.detalle || `La subida falló (HTTP ${status})`);
      }

      setSubida({
        tipo: datos.subido ? "subido" : "preparado",
        detalle: datos.detalle ?? null,
        seguro: datos.insurance ?? true,
        idDropi: datos.idDropi ?? null,
        estadoLucidSales: datos.estadoLucidSales,
        avisoEstado: datos.avisoEstado,
        notificacionLucidBot: datos.notificacionLucidBot,
      });
      if (datos.subido && datos.estadoLucidSales === "Confirmado") onConfirmado?.();
      if (datos.avisoEstado) toast.error(datos.avisoEstado);
      else toast.success(datos.subido ? `Pedido confirmado por Dropi${datos.idDropi ? ` (#${datos.idDropi})` : ""}` : "Pedido preparado en Dropi");
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setRecargaVeredicto((x) => x + 1);
      setSubiendo(false);
    }
  };

  const checks = resultado?.validacion?.checks ?? null;
  const extraido = resultado?.extraido ?? null;

  return (
    <section className="card">
      <div className="row between wrap">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Agente de Dropi · subida con seguro
        </div>
        <span className={`chip${conv?.mensajes?.length ? " ok" : ""}`}>
          {conv === null
            ? "sin chat del bot"
            : `${conv.mensajes?.length ?? 0} mensaje(s) del bot`}
        </span>
      </div>

      <p className="muted small" style={{ marginTop: 8 }}>
        Consulta la conversación más reciente de LucidBot y valida <strong>producto</strong>, <strong>cantidad</strong>, <strong>precio</strong>,{" "}
        <strong>dirección</strong>, <strong>confirmación</strong> y si el cliente pidió una fecha futura contra el pedido. Solo admite una línea de producto en esta versión.
        La subida va por el navegador de Dropi con el <strong>seguro antidevoluciones</strong> y{" "}
        <strong>solo ocurre si todo calza</strong>: si algo falla, no se sube nada.
      </p>

      <VeredictoAutomatico id={id} recarga={recargaVeredicto} />

      <IntentosSubida id={id} recarga={recargaVeredicto} />

      {conv === null ? (
        <p className="muted small">
          No se pudo cargar la conversación actual desde LucidBot. Revisa que el contacto tenga el campo configurado y que el pedido tenga un teléfono o enlace de chat válido.
        </p>
      ) : (
        <div className="row gap" style={{ marginBottom: 8 }}>
          <button className="btn sm ghost" onClick={() => setVerChat((v) => !v)}>
            {verChat ? "Ocultar chat" : `Ver chat (${conv.mensajes?.length ?? 0})`}
          </button>
          {conv.telefono ? <span className="muted small">tel. {conv.telefono}</span> : null}
        </div>
      )}

      {verChat && conv?.mensajes?.length ? (
        <ul className="chat-list" style={{ margin: "0 0 12px" }}>
          {conv.mensajes.map((m: any, i: number) => (
            <li key={i} className={`chat-fila ${m.de === "cliente" ? "cliente" : "bot"}`}>
              <span className="chat-de">{m.de}</span>
              <span className="chat-texto">{m.texto}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="acciones-form">
        <button className="btn" onClick={() => void validar()} disabled={validando}>
          {validando ? "Validando..." : "Validar pedido"}
        </button>
        <button className="btn primary" onClick={() => void subir()} disabled={subiendo}>
          {subiendo ? "Subiendo..." : "Subir a Dropi (seguro)"}
        </button>
        <button
          className="btn"
          disabled={subiendo}
          title="Ya revisaste y corregiste el pedido: se sube tal cual, sin la IA ni las validaciones"
          onClick={() => {
            if (
              window.confirm(
                "Subir SIN VALIDAR\n\nSe sube a Dropi tal como está el pedido ahora (producto, cantidad, precio, dirección, ciudad), con seguro.\n\nNO se revisa: el chat con la IA, la dirección en el mapa, si es un pedido repetido ni la fecha de entrega. El tope del flete SÍ se respeta.\n\nQueda registrado con tu usuario. ¿Ya lo revisaste y lo quieres subir?",
              )
            ) {
              void subir(false, true);
            }
          }}
        >
          ⚡ Subir sin validar
        </button>
      </div>
      <p className="campo-ayuda" style={{ marginTop: 4 }}>
        «Subir sin validar» es para cuando ya corregiste el pedido: lo sube tal cual (con seguro) sin pasar por la IA ni las
        validaciones. Queda registrado quién lo hizo.
      </p>

      {validando ? <Spinner label="El agente está leyendo el chat..." /> : null}

      {resultado && (
        <div className="banner info" style={{ marginTop: 12 }}>
          <strong>
            {resultado.accion === "subir"
              ? "El agente dice: SUBIR ✓"
              : "El agente dice: FRENAR ✕"}
          </strong>
          {resultado.enConversacion != null ? (
            <span className="muted"> · {resultado.enConversacion} mensajes leídos</span>
          ) : null}
        </div>
      )}

      {checks ? (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Chequeo</th>
                <th>Resultado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c: any) => (
                <tr key={c.campo}>
                  <td>
                    <strong>{NOMBRES_CHECK[c.campo] ?? c.campo}</strong>
                  </td>
                  <td>
                    <span className={`badge${c.ok ? " ok" : " danger"}`}>
                      {c.ok ? "✓ pasa" : "✕ falla"}
                    </span>
                  </td>
                  <td className="muted small wrap">
                    {c.detalle}
                    {c.evidencia ? (
                      <div className="evidencia-chat" title="Frase del chat en la que se apoyó la IA">
                        «{c.evidencia}»
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {extraido && resultado ? (
        <details className="card" style={{ marginTop: 8 }}>
          <summary>Lo que el agente entendió del chat</summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
            {(["producto", "cantidad", "precioAcordado", "direccion", "clienteConfirmo", "entregaFutura", "fechaEntregaSolicitada"] as const).map(
              (k) => {
                const v = extraido[k];
                const texto =
                  v === true
                    ? "sí"
                    : v === false || v === null || v === undefined || v === ""
                      ? "—"
                      : String(v);
                return (
                  <div className="field" key={k}>
                    <label>{k}</label>
                    <div className="valor-solo">{texto}</div>
                  </div>
                );
              },
            )}
          </div>
          {extraido.incertidumbre?.length ? (
            <p className="muted small">Incógnitas: {extraido.incertidumbre.join(" · ")}</p>
          ) : null}
        </details>
      ) : null}

      {subida?.tipo === "frenado" ? (
        <div className="banner warn" style={{ marginTop: 12 }}>
          <strong>Frenado: no se envió otra vez.</strong>{" "}{subida.msg ? `${subida.msg} ` : ""}
          {subida.motivos?.length ? (
            <>Problemas: {subida.motivos.map((m: any) => `${NOMBRES_CHECK[m?.campo] ?? m?.campo ?? "Validación"}${m?.detalle ? `: ${m.detalle}` : ""}`).join(" · ")}.</>
          ) : null}
          {subida.motivos?.length && subida.motivos.every((m: any) => m?.campo === "duplicado") ? (
            <div style={{ marginTop: 8 }}>
              <button
                className="btn sm"
                disabled={subiendo}
                onClick={() => {
                  if (window.confirm("¿Revisaste el chat y es una compra NUEVA? Se subirá aunque el cliente tenga otro pedido reciente.")) {
                    void subir(true);
                  }
                }}
              >
                Subir de todas formas
              </button>
            </div>
          ) : null}
          {subida.entrega && subida.motivos?.some((m: any) => m?.campo === "entregaFutura") ? (
            <div style={{ marginTop: 8 }}>
              {subida.entrega.fecha ? (
                <button
                  className="btn sm"
                  disabled={subiendo}
                  onClick={() => {
                    void backend(`/api/programados/${encodeURIComponent(String(id))}`, {
                      method: "PUT",
                      body: { fecha: subida.entrega.fecha, nota: subida.entrega.texto ? `el cliente dijo: ${subida.entrega.texto}` : "" },
                    })
                      .then(() => {
                        toast.success("Entrega programada");
                        window.dispatchEvent(new CustomEvent("zunto:programado", { detail: String(id) }));
                      })
                      .catch((e) => toast.error(errMsg(e)));
                  }}
                >
                  📅 Programar para el {subida.entrega.fecha}
                </button>
              ) : (
                <span className="small">El cliente pidió otra fecha ({subida.entrega.texto || "sin día exacto"}): ponla en «Entrega programada».</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {subida?.tipo === "login" || subida?.tipo === "captcha" ? (
        <div className="banner warn" style={{ marginTop: 12 }}>{subida.msg}</div>
      ) : null}

      {subida?.tipo === "subido" ? (
        <div className="banner ok" style={{ marginTop: 12 }}>
          Pedido confirmado por Dropi{subida.idDropi ? ` (#${subida.idDropi})` : ""}{subida.seguro ? " con seguro antidevoluciones" : ""}.
          {subida.estadoLucidSales ? " LucidSales quedó en Confirmado." : ""}
          {subida.detalle ? ` ${subida.detalle}` : ""}
        </div>
      ) : null}

      {subida?.avisoEstado ? (
        <div className="banner warn" style={{ marginTop: 12 }}>
          {subida.avisoEstado}
        </div>
      ) : null}

      {subida?.notificacionLucidBot && !subida.notificacionLucidBot.omitido ? (
        <div className={`banner ${subida.notificacionLucidBot.ok ? "info" : "warn"}`} style={{ marginTop: 12 }}>
          {subida.notificacionLucidBot.ok ? "Resultado enviado a Lucid Bot." : `No se pudo notificar a Lucid Bot: ${subida.notificacionLucidBot.detalle}`}
        </div>
      ) : null}

      {subida?.tipo === "incierto" ? (
        <div className="banner warn" style={{ marginTop: 12 }}>
          <strong>Resultado incierto. No reintentes todavía.</strong> {subida.msg}
        </div>
      ) : null}

      {subida?.tipo === "preparado" ? (
        <div className="banner info" style={{ marginTop: 12 }}>
          Formulario preparado; Dropi todavía no creó el pedido. {subida.detalle}
        </div>
      ) : null}

      <ErrorBanner error={err} />
    </section>
  );
}
