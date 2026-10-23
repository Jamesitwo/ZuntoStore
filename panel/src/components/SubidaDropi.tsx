import { useEffect, useRef, useState } from "react";
import { errMsg } from "../api/client";
import { backend, backendSuave } from "../api/backend";
import { ESTADOS_PEDIDO } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useEtiquetaTienda } from "../lib/tiendas";
import { useInboxBot } from "../lib/botInbox";
import { AnalisisPedido } from "./AnalisisPedido";
import { ReglasEnvio, type ConfigEnvio, type ReglaProducto } from "./ReglasEnvio";
import { SheetProductos } from "./SheetProductos";
import { useToast } from "./Toast";
import { Campo, ErrorBanner, Spinner } from "./ui";

/**
 * Subida AUTOMATICA de pedidos a Dropi (con el seguro antidevoluciones).
 *
 * Es el motor que vive en server/subidaAutomatica.js: cada N segundos mira los
 * pedidos recientes de las tiendas marcadas, lee el chat que mando el bot, lo
 * pasa por el agente (producto/precio/direccion/confirmacion) y SOLO si todo
 * calza lo sube a Dropi por el navegador, con el seguro activado.
 *
 *   GET  /api/subida          -> config + ultimos pedidos tratados
 *   PUT  /api/subida/config   -> encender/apagar y configurar
 *   POST /api/subida/probar   -> ejecuta una vuelta ahora mismo
 *
 * Si el backend no esta arrancado, la tarjeta lo dice y queda deshabilitada.
 */

/** Cada cuánto revisa: de 30 segundos a 12 horas. */
const MAX_SEGUNDOS = 12 * 3600;

/** Resultados que se pueden reintentar desde el panel. */
const REINTENTABLES = ["requiere-revision", "direccion-invalida", "envio-caro", "sin-transportadora"];
const EN_ALERTA = [...REINTENTABLES, "resultado-incierto"];

/** "2 h 30 min", "45 min", "90 s". */
function textoDuracion(seg: number): string {
  if (!Number.isFinite(seg) || seg <= 0) return "";
  if (seg < 120) return `${seg} s`;
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Se pega en la consola de app.dropi.co: copia su localStorage (la sesion). */
const COMANDO_SESION = "copy(JSON.stringify(localStorage))";

function textoEstadoSesion(s: any): { texto: string; ok: boolean } {
  const desde = s?.desde ? new Date(s.desde).toLocaleString("es-CO") : "";
  if (s?.estado === "ok") return { texto: `Activa${desde ? ` · última confirmación ${desde}` : ""}`, ok: true };
  if (s?.estado === "requiere-login") return { texto: `VENCIDA desde ${desde}: la subida está detenida`, ok: false };
  if (s?.estado === "requiere-captcha") return { texto: `Dropi pide CAPTCHA desde ${desde}: la subida está detenida`, ok: false };
  return { texto: "Sin datos todavía (se sabrá en el primer intento)", ok: true };
}

function normalizaConfig(c: any): {
  automatico: boolean;
  dryRun: boolean;
  cadaSegundos: number;
  transportadoraId: number;
  maxIntentos: number;
  tiendas: string[];
  estados: number[];
  tiendasDropi: Record<string, string>;
  minCalificacionDireccion: number;
} & ConfigEnvio {
  const lista = (v: any) => (Array.isArray(v) ? v.map(Number).filter((x: number) => x > 0) : []) as number[];
  const num = (v: any) => (Number(v) > 0 ? Number(v) : null);
  const reglas: Record<string, ReglaProducto> = {};
  for (const [k, r] of Object.entries((c?.reglasProducto ?? {}) as Record<string, any>)) {
    reglas[k] = {
      nombre: String(r?.nombre ?? ""),
      transportadoras: lista(r?.transportadoras),
      maxPesos: num(r?.maxPesos),
      maxPorcentaje: num(r?.maxPorcentaje),
    };
  }
  const generales = lista(c?.transportadoras);
  return {
    automatico: !!c?.automatico,
    dryRun: c?.dryRun !== false, // por defecto se prepara sin crear
    cadaSegundos: Math.max(30, Math.min(Number(c?.cadaSegundos) || 120, MAX_SEGUNDOS)),
    transportadoraId: Number(c?.transportadoraId) || 5,
    transportadoras: generales.length ? generales : [Number(c?.transportadoraId) || 5],
    envio: { maxPesos: num(c?.envio?.maxPesos), maxPorcentaje: num(c?.envio?.maxPorcentaje) },
    reglasProducto: reglas,
    oficinaInter: c?.oficinaInter === true,
    minCalificacionDireccion: Number.isFinite(Number(c?.minCalificacionDireccion))
      ? Math.max(0, Math.min(100, Number(c.minCalificacionDireccion)))
      : 70,
    maxIntentos: Math.max(1, Math.min(Number(c?.maxIntentos) || 2, 10)),
    tiendas: (Array.isArray(c?.tiendas) ? c.tiendas : []).map(String) as string[],
    estados: (Array.isArray(c?.estados) ? c.estados : []).map(Number) as number[],
    tiendasDropi:
      c?.tiendasDropi && typeof c.tiendasDropi === "object"
        ? Object.fromEntries(Object.entries(c.tiendasDropi).map(([k, v]) => [String(k), String(v ?? "")]))
        : {},
  };
}

export function SubidaDropi() {
  const { session } = useAuth();
  const toast = useToast();
  const etiqueta = useEtiquetaTienda();
  const inbox = useInboxBot();

  const [config, setConfig] = useState<any>(null);
  const [lucidBotConfig, setLucidBotConfig] = useState<any>(null);
  const [lucidBotForm, setLucidBotForm] = useState<any>({ activo: false, adminPhone: "", summaryField: "resumen_dropi", conversationFieldId: "", tagName: "", flowId: "", fields: [] });
  const [lucidBotToken, setLucidBotToken] = useState("");
  const [guardandoLucidBot, setGuardandoLucidBot] = useState(false);
  const [ultimos, setUltimos] = useState<any[]>([]);
  const [sesion, setSesion] = useState<any>(null);
  const [llm, setLlm] = useState<any>(null);
  const [llmForm, setLlmForm] = useState<{ proveedor: string; base: string; modelo: string }>({ proveedor: "openai", base: "", modelo: "" });
  const [llmKey, setLlmKey] = useState("");
  const [llmOcupado, setLlmOcupado] = useState<"" | "guardar" | "probar" | "borrar">("");
  const [llmPrueba, setLlmPrueba] = useState<{ ok: boolean; msg: string } | null>(null);
  const [promptTexto, setPromptTexto] = useState("");
  const [guardandoPrompt, setGuardandoPrompt] = useState(false);
  const [sesionTexto, setSesionTexto] = useState("");
  const [enviandoSesion, setEnviandoSesion] = useState(false);
  const [form, setForm] = useState(normalizaConfig({}));
  const [nota, setNota] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const cargado = useRef(false);

  const refrescar = () => setRecarga((x) => x + 1);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [r, rb, rs, rl] = await Promise.all([
        backendSuave<any>("/api/subida"),
        backendSuave<any>("/api/lucidbot/config"),
        backendSuave<any>("/api/dropi/sesion"),
        backendSuave<any>("/api/llm/config"),
      ]);
      if (cancel) return;
      setSesion(rs?.sesion ?? null);
      if (rl?.ok) {
        setLlm(rl);
        setLlmForm({ proveedor: rl.proveedor ?? "openai", base: rl.base ?? "", modelo: rl.modelo ?? "" });
        setPromptTexto(String(rl.prompt ?? ""));
      }
      if (rb?.config) {
        setLucidBotConfig(rb.config);
        setLucidBotForm({
          activo: !!rb.config.activo,
          adminPhone: rb.config.adminPhone ?? "",
          summaryField: rb.config.summaryField ?? "resumen_dropi",
          conversationFieldId: rb.config.conversationFieldId ?? rb.config.summaryFieldId ?? "",
          tagName: rb.config.tagName ?? "",
          flowId: rb.config.flowId ?? "",
          fields: Array.isArray(rb.config.fields) ? rb.config.fields : [],
        });
      }
      if (!r || r.ok === false) {
        setConfig(null);
        setNota(
          (r && typeof r.msg === "string" && r.msg) ||
            "Backend propio no disponible: arranca server/ con npm start para configurar la subida a Dropi.",
        );
        return;
      }
      setNota(null);
      setConfig(r.config ?? null);
      setUltimos(Array.isArray(r.ultimos) ? r.ultimos : []);
      if (!cargado.current && r.config) {
        cargado.current = true;
        setForm(normalizaConfig(r.config));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [recarga]);

  const enviarSesion = async () => {
    const texto = sesionTexto.trim();
    if (!texto) return;
    setEnviandoSesion(true);
    setErr(null);
    try {
      const r: any = await backend("/api/dropi/sesion", { method: "POST", body: { localStorage: texto } });
      setSesion(r?.sesion ?? null);
      setSesionTexto("");
      toast.success(r?.msg || "Sesión de Dropi actualizada");
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setEnviandoSesion(false);
    }
  };

  /** Cuerpo para guardar/probar: la key solo si se escribio una nueva. */
  const cuerpoLlm = () => ({
    proveedor: llmForm.proveedor,
    ...(llmForm.proveedor === "otro" ? { base: llmForm.base } : {}),
    modelo: llmForm.modelo,
    ...(llmKey.trim() ? { apiKey: llmKey.trim() } : {}),
  });

  const guardarLlm = async () => {
    setLlmOcupado("guardar");
    setErr(null);
    try {
      const r: any = await backend("/api/llm/config", { method: "PUT", body: cuerpoLlm() });
      setLlm(r);
      setLlmKey("");
      toast.success(r?.aviso || "Configuración de la IA guardada");
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setLlmOcupado("");
    }
  };

  const probarLlm = async () => {
    setLlmOcupado("probar");
    setLlmPrueba(null);
    try {
      const r: any = await backend("/api/llm/probar", { method: "POST", body: cuerpoLlm() }).catch((e) => ({ ok: false, msg: errMsg(e) }));
      setLlmPrueba({ ok: !!r?.ok, msg: String(r?.msg ?? "") });
    } finally {
      setLlmOcupado("");
    }
  };

  /** Guarda las instrucciones; `null` vuelve a las predeterminadas. */
  const guardarPrompt = async (texto: string | null) => {
    if (texto === null && !window.confirm("¿Volver a las instrucciones predeterminadas? Se perderán las que escribiste.")) return;
    setGuardandoPrompt(true);
    try {
      const r: any = await backend("/api/llm/config", { method: "PUT", body: { prompt: texto } });
      setLlm(r);
      setPromptTexto(String(r?.prompt ?? ""));
      toast.success(texto === null ? "Se restauraron las instrucciones predeterminadas" : "Instrucciones de la IA guardadas");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGuardandoPrompt(false);
    }
  };

  const borrarLlm = async () => {
    if (!window.confirm("¿Borrar la API key guardada desde el panel? Se volverá a usar la del archivo .env del servidor (si hay).")) return;
    setLlmOcupado("borrar");
    try {
      const r: any = await backend("/api/llm/config", { method: "DELETE" });
      setLlm(r);
      setLlmForm({ proveedor: r.proveedor ?? "openai", base: r.base ?? "", modelo: r.modelo ?? "" });
      toast.info("API key del panel borrada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLlmOcupado("");
    }
  };

  const copiarComando = async () => {
    try {
      await navigator.clipboard.writeText(COMANDO_SESION);
      toast.success("Comando copiado");
    } catch {
      toast.error("No se pudo copiar: selecciónalo y cópialo a mano");
    }
  };

  const guardarLucidBot = async (borrarToken = false) => {
    setGuardandoLucidBot(true);
    setErr(null);
    try {
      const r: any = await backend("/api/lucidbot/config", {
        method: "PUT",
        body: {
          ...lucidBotForm,
          ...(lucidBotToken.trim() ? { token: lucidBotToken.trim() } : {}),
          ...(borrarToken ? { borrarToken: true, activo: false } : {}),
        },
      });
      setLucidBotConfig(r?.config ?? null);
      setLucidBotToken("");
      toast.success(borrarToken ? "Token de Lucid Bot eliminado" : "Notificación a Lucid Bot guardada");
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setGuardandoLucidBot(false);
    }
  };

  const actualizarCampoLucidBot = (i: number, campo: "field_name" | "value", valor: string) => {
    setLucidBotForm((f: any) => ({
      ...f,
      fields: f.fields.map((x: any, j: number) => j === i ? { ...x, [campo]: valor } : x),
    }));
  };

  const guardar = async () => {
    setGuardando(true);
    setErr(null);
    try {
      const r: any = await backend("/api/subida/config", { method: "PUT", body: { ...form } });
      setConfig(r?.config ?? null);
      if (r?.config) setForm(normalizaConfig(r.config));
      toast.success("Configuración de la subida a Dropi guardada");
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    setErr(null);
    try {
      const r: any = await backend("/api/subida/probar", { method: "POST", body: {} });
      if (r?.ok === false) throw new Error(r.error || r.msg || "La subida no pudo ejecutarse");
      if (r?.saltado === "en curso") {
        toast.info("Ya hay una vuelta en curso");
        return;
      }
      const subidos = Number(r?.subidos ?? 0);
      const frenados = Number(r?.frenados ?? 0);
      const omitidos = Number(r?.omitidos ?? 0);
      const inciertos = Number(r?.inciertos ?? 0);
      if (inciertos) {
        toast.error(`${inciertos} resultado(s) incierto(s): verifica en Dropi antes de reintentar`);
        refrescar();
        return;
      }
      const resumen = r?.dryRun
        ? `${subidos} pedido(s) preparado(s)`
        : subidos
          ? `${subidos} pedido(s) creado(s) en Dropi`
          : "Vuelta ejecutada: no había nada que subir";
      const conteoAdicional = [
        frenados ? `${frenados} frenados` : "",
        omitidos ? `${omitidos} omitidos` : "",
        r?.revision ? `${r.revision} pasaron a revisión` : "",
      ].filter(Boolean).join(" · ");
      toast.success(`${resumen}${conteoAdicional ? ` · ${conteoAdicional}` : ""}`);
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setProbando(false);
    }
  };

  const reintentarRevision = async (id?: string) => {
    try {
      const r: any = await backend("/api/subida/reintentar", {
        method: "POST",
        body: id ? { id } : { todos: true },
      });
      toast.info(id ? `Pedido ${id}: se volverá a intentar en la próxima vuelta` : `${r?.rearmados ?? 0} pedido(s) se volverán a intentar`);
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    }
  };

  const reintentarIncierto = async (id: string) => {
    if (!window.confirm(`Confirma que buscaste el pedido ${id} en Dropi y verificaste que NO existe. Solo entonces se volverá a intentar.`)) return;
    try {
      await backend("/api/subida/reintentar", {
        method: "POST",
        body: { id, confirmarNoCreado: true },
      });
      toast.info(`Pedido ${id} habilitado para un nuevo intento`);
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    }
  };

  return (
    <section className="card">
      <div className="row between wrap">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Subida automática a Dropi
        </div>
        <span className={`chip${config?.automatico ? " ok" : ""}`}>
          {config === null
            ? "sin conectar"
            : config.automatico
              ? "ACTIVA"
              : "apagada"}
        </span>
      </div>

      <p className="muted small" style={{ marginTop: 8 }}>
        Con <strong>la subida encendida</strong>, el backend mira cada N segundos los pedidos
        recientes de las tiendas marcadas, lee el chat que envió el bot, lo valida con el agente
        (producto, cantidad, precio, dirección, confirmación y fecha de entrega futura) y <strong>solo si todo calza</strong>{" "}
        lo sube a Dropi por el navegador con el <strong>seguro antidevoluciones</strong> activado.
        Si algo no calza, <strong>no sube nada</strong>: lo deja registrado como pendiente de
        revisión. Con <em>Preparar sin crear</em> solo arma el formulario para revisarlo.
      </p>

      {nota ? <p className="muted small">{nota}</p> : null}

      {config !== null ? (
        <details className="card" open={sesion?.estado === "requiere-login" || sesion?.estado === "requiere-captcha"}>
          <summary className="card-title">
            Sesión de Dropi{" "}
            <span className={`chip${textoEstadoSesion(sesion).ok ? " ok" : ""}`}>
              {sesion?.estado === "ok" ? "activa" : sesion?.estado === "requiere-login" ? "vencida" : sesion?.estado === "requiere-captcha" ? "captcha" : "—"}
            </span>
          </summary>
          <p className="muted small">
            {textoEstadoSesion(sesion).texto}
            {sesion?.pendientes ? ` · al menos ${sesion.pendientes} pedido(s) esperando` : ""}
            {sesion?.aviso ? ` · aviso por Lucid Bot: ${sesion.aviso}` : ""}
          </p>
          <p className="muted small">
            El servidor sube los pedidos con una copia de tu sesión de Dropi. Cuando vence, la subida se
            detiene, te llega un aviso por Lucid Bot y los pedidos quedan pendientes: se suben solos en
            cuanto la actualizas así:
          </p>
          <ol className="small">
            <li>
              Abre <strong>app.dropi.co</strong> en tu navegador e inicia sesión (si hay captcha, lo resuelves ahí).
            </li>
            <li>
              Pulsa <strong>F12</strong> → pestaña <strong>Consola</strong>, pega este comando y pulsa Enter
              (la primera vez Chrome puede pedirte escribir <code>allow pasting</code>):{" "}
              <code>{COMANDO_SESION}</code>{" "}
              <button className="btn sm" onClick={() => void copiarComando()}>Copiar comando</button>
            </li>
            <li>Vuelve aquí, pega con Ctrl+V en el cuadro y pulsa «Actualizar sesión».</li>
          </ol>
          <div className="field">
            <label htmlFor="dropi-sesion">Sesión copiada de Dropi</label>
            <textarea
              id="dropi-sesion"
              rows={3}
              value={sesionTexto}
              onChange={(e) => setSesionTexto(e.target.value)}
              placeholder='{"..." : "..."}'
              spellCheck={false}
              autoComplete="off"
            />
            <span className="campo-ayuda">
              Es como tu contraseña de Dropi: no la compartas ni la pegues en otro sitio. El servidor la
              usa solo para subir pedidos y no la muestra.
            </span>
          </div>
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => void enviarSesion()} disabled={enviandoSesion || !sesionTexto.trim()}>
              {enviandoSesion ? "Comprobando en Dropi..." : "Actualizar sesión"}
            </button>
          </div>
        </details>
      ) : null}

      {llm ? (
        <details className="card" open={!llm.configurada}>
          <summary className="card-title">
            IA que lee los chats{" "}
            <span className={`chip${llm.configurada ? " ok" : ""}`}>{llm.configurada ? "configurada" : "sin API key"}</span>
          </summary>
          <p className="muted small">
            La IA solo extrae los datos del chat (producto, cantidad, precio, dirección, confirmación); la decisión
            de subir la toma el sistema. El consumo se cobra a la cuenta dueña de la API key.
            {llm.configurada
              ? ` Ahora: ${llm.proveedores?.[llm.proveedor]?.nombre ?? llm.base} · ${llm.modelo} · key ${llm.apiKeyVista} (guardada en ${llm.origen === "panel" ? "el panel" : "el .env del servidor"}).`
              : " Sin API key, todos los pedidos se frenan."}
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="llm-prov">Proveedor</label>
              <select
                id="llm-prov"
                value={llmForm.proveedor}
                onChange={(e) => {
                  const prov = e.target.value;
                  const p = llm.proveedores?.[prov];
                  setLlmForm((f) => ({ proveedor: prov, base: p?.base ?? f.base, modelo: p?.modelo ?? f.modelo }));
                  setLlmPrueba(null);
                }}
              >
                {Object.entries(llm.proveedores ?? {}).map(([id, p]: [string, any]) => (
                  <option key={id} value={id}>{p.nombre}</option>
                ))}
                <option value="otro">Otro (compatible con OpenAI)</option>
              </select>
            </div>
            {llmForm.proveedor === "otro" ? (
              <div className="field">
                <label htmlFor="llm-base">URL de la API</label>
                <input
                  id="llm-base"
                  value={llmForm.base}
                  onChange={(e) => setLlmForm((f) => ({ ...f, base: e.target.value }))}
                  placeholder="https://.../v1"
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="llm-modelo">Modelo</label>
              <input
                id="llm-modelo"
                value={llmForm.modelo}
                onChange={(e) => setLlmForm((f) => ({ ...f, modelo: e.target.value }))}
                placeholder="gpt-5-mini"
              />
            </div>
            <div className="field">
              <label htmlFor="llm-key">API key</label>
              <input
                id="llm-key"
                type="password"
                autoComplete="new-password"
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
                placeholder={llm.configurada ? `Guardada (${llm.apiKeyVista}); vacío conserva la actual` : "Pega tu API key"}
              />
            </div>
          </div>
          {llmPrueba ? (
            <div className={`banner ${llmPrueba.ok ? "info" : "warn"}`} style={{ marginTop: 8 }}>{llmPrueba.msg}</div>
          ) : null}
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => void probarLlm()} disabled={!!llmOcupado}>
              {llmOcupado === "probar" ? "Probando..." : "Probar"}
            </button>
            <button className="btn primary" onClick={() => void guardarLlm()} disabled={!!llmOcupado}>
              {llmOcupado === "guardar" ? "Guardando..." : "Guardar IA"}
            </button>
            {llm.origen === "panel" ? (
              <button className="btn danger" onClick={() => void borrarLlm()} disabled={!!llmOcupado}>
                Borrar key del panel
              </button>
            ) : null}
          </div>

          <details className="prompt-ia" style={{ marginTop: 12 }}>
            <summary>
              Instrucciones de la IA (prompt){" "}
              <span className={`chip${llm.promptPersonalizado ? " alerta" : " ok"}`}>
                {llm.promptPersonalizado ? "personalizadas" : "predeterminadas"}
              </span>
            </summary>
            <p className="muted small">
              Es lo que la IA recibe para leer cada chat. Puedes ajustar el lenguaje o agregar casos propios de tu
              tienda, pero <strong>conserva los nombres de los campos del JSON</strong> (producto, cantidad,
              precioAcordado, direccion, clienteConfirmo, entregaFutura, direccionEnvio, evidencia…): si la IA deja
              de devolver alguno, ese chequeo falla y los pedidos se frenan. La decisión de subir sigue siendo del
              sistema. Después de cambiarlas, prueba con <em>Validar pedido</em> en un pedido antes de dejarlo en
              automático.
            </p>
            <textarea
              className="prompt-ia-texto"
              rows={18}
              spellCheck={false}
              value={promptTexto}
              onChange={(e) => setPromptTexto(e.target.value)}
            />
            <div className="row gap" style={{ marginTop: 8 }}>
              <button
                className="btn primary"
                onClick={() => void guardarPrompt(promptTexto)}
                disabled={guardandoPrompt || promptTexto.trim() === String(llm.prompt ?? "").trim()}
              >
                {guardandoPrompt ? "Guardando..." : "Guardar instrucciones"}
              </button>
              {promptTexto.trim() !== String(llm.prompt ?? "").trim() ? (
                <button className="btn" onClick={() => setPromptTexto(String(llm.prompt ?? ""))} disabled={guardandoPrompt}>
                  Descartar cambios
                </button>
              ) : null}
              {llm.promptPersonalizado ? (
                <button className="btn danger" onClick={() => void guardarPrompt(null)} disabled={guardandoPrompt}>
                  Restaurar las predeterminadas
                </button>
              ) : null}
              <span className="muted small">{promptTexto.length.toLocaleString("es-CO")} caracteres</span>
            </div>
          </details>
        </details>
      ) : null}

      {lucidBotConfig ? (
        <details className="card" open>
          <summary className="card-title">Conversación y avisos de Lucid Bot</summary>
          <p className="muted small">
            Antes de validar el pedido, el servidor consulta en LucidBot la conversación más reciente del cliente. Después de un intento real, te avisa a ti (el teléfono del admin) por la API de contactos: los datos del pedido y del cliente van en los campos personalizados para que el flujo los use. Al cliente no se le envía nada. Las pruebas en modo preparación no envían avisos.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="lb-token">X-ACCESS-TOKEN</label>
              <input
                id="lb-token"
                type="password"
                autoComplete="new-password"
                value={lucidBotToken}
                onChange={(e) => setLucidBotToken(e.target.value)}
                placeholder={lucidBotConfig.tokenConfigurado ? "Guardado (" + lucidBotConfig.tokenVista + "); vacío conserva el actual" : "Token de Lucid Bot"}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-conversation-field-id">ID del campo que contiene la conversación</label>
              <input
                id="lb-conversation-field-id"
                inputMode="numeric"
                value={lucidBotForm.conversationFieldId}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, conversationFieldId: e.target.value }))}
                placeholder="Ej. 12345"
              />
              <span className="campo-ayuda">Se consulta con GET /contacts/ID/custom_fields/ID antes de subir. El ID del contacto sale del enlace del inbox.</span>
            </div>
            <div className="field">
              <label htmlFor="lb-admin-phone">Teléfono del admin que recibe los avisos</label>
              <input
                id="lb-admin-phone"
                type="tel"
                inputMode="tel"
                value={lucidBotForm.adminPhone}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, adminPhone: e.target.value }))}
                placeholder="+573001234567"
              />
              <span className="campo-ayuda">Va en el <code>phone</code> del POST /contacts. Debe ser un contacto que ya exista en Lucid Bot.</span>
            </div>
            <div className="field">
              <label htmlFor="lb-summary-field">Nombre del campo para el resumen de subida</label>
              <input
                id="lb-summary-field"
                value={lucidBotForm.summaryField}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, summaryField: e.target.value }))}
                placeholder="resumen_dropi"
              />
              <span className="campo-ayuda">Campo del contacto del admin donde se escribe el resumen de cada intento real (úsalo en el mensaje del flujo).</span>
            </div>
            <div className="field">
              <label htmlFor="lb-flow-id">ID del flujo que te notifica (opcional)</label>
              <input
                id="lb-flow-id"
                inputMode="numeric"
                value={lucidBotForm.flowId}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, flowId: e.target.value }))}
                placeholder="Ej. 54321"
              />
            </div>
            <div className="field">
              <label htmlFor="lb-tag">Etiqueta (opcional)</label>
              <input
                id="lb-tag"
                value={lucidBotForm.tagName}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, tagName: e.target.value }))}
                placeholder="dropi_resultado"
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label className="switch" htmlFor="lb-on">
              <input
                id="lb-on"
                type="checkbox"
                checked={lucidBotForm.activo}
                onChange={(e) => setLucidBotForm((f: any) => ({ ...f, activo: e.target.checked }))}
              />
              <span className="switch-pista" aria-hidden="true" />
              <span className="switch-texto">{lucidBotForm.activo ? "Notificaciones activas" : "Notificaciones apagadas"}</span>
            </label>
          </div>
          <div className="card-title" style={{ marginTop: 12 }}>Campos personalizados adicionales</div>
          <p className="muted small">
            Se guardan en el contacto del admin para dar contexto al aviso. Valores dinámicos: <code>{"{{resumen}}"}</code>, <code>{"{{resultado}}"}</code>, <code>{"{{pedido}}"}</code>, <code>{"{{idDropi}}"}</code> y, del cliente, <code>{"{{cliente}}"}</code>, <code>{"{{phone}}"}</code>, <code>{"{{first_name}}"}</code>, <code>{"{{last_name}}"}</code> y <code>{"{{email}}"}</code>.
          </p>
          {(lucidBotForm.fields ?? []).map((f: any, i: number) => (
            <div className="form-grid" key={i} style={{ marginBottom: 8 }}>
              <div className="field">
                <label>Nombre de campo</label>
                <input value={f.field_name ?? ""} onChange={(e) => actualizarCampoLucidBot(i, "field_name", e.target.value)} placeholder="campo_personalizado" />
              </div>
              <div className="field">
                <label>Valor</label>
                <input value={f.value ?? ""} onChange={(e) => actualizarCampoLucidBot(i, "value", e.target.value)} placeholder="{{resumen}}" />
              </div>
              <button className="btn sm danger" onClick={() => setLucidBotForm((v: any) => ({ ...v, fields: v.fields.filter((_: any, j: number) => j !== i) }))}>Quitar</button>
            </div>
          ))}
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setLucidBotForm((f: any) => ({ ...f, fields: [...(f.fields ?? []), { field_name: "", value: "" }] }))}>+ Añadir campo</button>
            <button className="btn primary" onClick={() => void guardarLucidBot()} disabled={guardandoLucidBot}>
              {guardandoLucidBot ? "Guardando..." : "Guardar Lucid Bot"}
            </button>
            {lucidBotConfig.tokenConfigurado ? <button className="btn danger" onClick={() => void guardarLucidBot(true)} disabled={guardandoLucidBot}>Borrar token</button> : null}
          </div>
        </details>
      ) : null}

      {config === null ? (
        nota ? null : (
          <Spinner label="Consultando la subida automática..." />
        )
      ) : (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sub-on">Subida automática</label>
              <label className="switch" htmlFor="sub-on">
                <input
                  id="sub-on"
                  type="checkbox"
                  checked={form.automatico}
                  onChange={(e) => setForm((f) => ({ ...f, automatico: e.target.checked }))}
                />
                <span className="switch-pista" aria-hidden="true" />
                <span className="switch-texto">{form.automatico ? "Encendida" : "Apagada"}</span>
              </label>
              <p className="campo-ayuda">
                Se hace efectiva al guardar. El chip de arriba refleja lo guardado ahora mismo.
              </p>
            </div>

            <div className="field">
              <label htmlFor="sub-dry">Modo de prueba</label>
              <label className="switch" htmlFor="sub-dry">
                <input
                  id="sub-dry"
                  type="checkbox"
                  checked={form.dryRun}
                  onChange={(e) => setForm((f) => ({ ...f, dryRun: e.target.checked }))}
                />
                <span className="switch-pista" aria-hidden="true" />
                <span className="switch-texto">
                  {form.dryRun ? "Preparar sin crear" : "Subir de verdad"}
                </span>
              </label>
              <p className="campo-ayuda">
                Con <em>Preparar sin crear</em> se rellena el formulario de Dropi pero no se pulsa
                crear. Apágalo para que los pedidos se suban de verdad.
              </p>
            </div>

            <Campo
              id="sub-cada"
              label="Cada cuánto revisa"
              ayuda={`De 30 segundos a 12 horas${form.cadaSegundos ? ` · ahora: cada ${textoDuracion(form.cadaSegundos)}` : ""}. Solo mira pedidos nuevos: nunca reenvía.`}
            >
              <span className="intervalo">
                <input
                  id="sub-cada"
                  type="number"
                  min={form.cadaSegundos >= 3600 ? 1 : form.cadaSegundos >= 60 ? 1 : 30}
                  value={
                    form.cadaSegundos >= 3600 && form.cadaSegundos % 3600 === 0
                      ? form.cadaSegundos / 3600
                      : form.cadaSegundos >= 60 && form.cadaSegundos % 60 === 0
                        ? form.cadaSegundos / 60
                        : form.cadaSegundos
                  }
                  onChange={(e) => {
                    const n = Number(e.target.value) || 0;
                    const unidad =
                      form.cadaSegundos >= 3600 && form.cadaSegundos % 3600 === 0
                        ? 3600
                        : form.cadaSegundos >= 60 && form.cadaSegundos % 60 === 0
                          ? 60
                          : 1;
                    setForm((f) => ({ ...f, cadaSegundos: Math.min(n * unidad, MAX_SEGUNDOS) }));
                  }}
                />
                <select
                  aria-label="Unidad"
                  value={
                    form.cadaSegundos >= 3600 && form.cadaSegundos % 3600 === 0
                      ? 3600
                      : form.cadaSegundos >= 60 && form.cadaSegundos % 60 === 0
                        ? 60
                        : 1
                  }
                  onChange={(e) => {
                    const unidad = Number(e.target.value);
                    // se conserva el numero y se cambia la unidad (2 min -> 2 h)
                    const actual =
                      form.cadaSegundos >= 3600 && form.cadaSegundos % 3600 === 0
                        ? form.cadaSegundos / 3600
                        : form.cadaSegundos >= 60 && form.cadaSegundos % 60 === 0
                          ? form.cadaSegundos / 60
                          : form.cadaSegundos;
                    setForm((f) => ({ ...f, cadaSegundos: Math.max(30, Math.min(actual * unidad, MAX_SEGUNDOS)) }));
                  }}
                >
                  <option value={1}>segundos</option>
                  <option value={60}>minutos</option>
                  <option value={3600}>horas</option>
                </select>
              </span>
            </Campo>

            <Campo
              id="sub-calif"
              label="Calificación mínima de la dirección"
              ayuda="De 0 a 100. El validador propio califica la dirección (formato 40 + mapa 50 + barrio 10) y por debajo de este número el pedido no se sube. 70 deja pasar placa exacta, o calle encontrada con barrio. 0 = no mirar el mapa. Sin API key de Google no frena."
            >
              <input
                id="sub-calif"
                type="number"
                min={0}
                max={100}
                value={form.minCalificacionDireccion}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minCalificacionDireccion: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))
                }
              />
            </Campo>

            <Campo
              id="sub-intentos"
              label="Intentos por pedido"
              ayuda="Si un pedido falla (error de Dropi, frenado o sin conversación) esta cantidad de veces, pasa a «requiere-revision» y deja de intentarse. La sesión de Dropi vencida no cuenta."
            >
              <input
                id="sub-intentos"
                type="number"
                min={1}
                max={10}
                value={form.maxIntentos}
                onChange={(e) => setForm((f) => ({ ...f, maxIntentos: Number(e.target.value) }))}
              />
            </Campo>

          </div>

          <Campo
            id="sub-tiendas"
            label="Tiendas que revisa"
            ayuda="Si no marcas ninguna, el backend usa su LUCID_TIENDA (o las del reparto automático)."
          >
            <div className="permisos-grid">
              {(session?.idEmpresa ?? []).map((t) => (
                <label className="check-permiso" key={t} htmlFor={`sub-t-${t}`}>
                  <input
                    id={`sub-t-${t}`}
                    type="checkbox"
                    checked={form.tiendas.includes(String(t))}
                    onChange={() =>
                      setForm((f) => ({
                        ...f,
                        tiendas: f.tiendas.includes(String(t))
                          ? f.tiendas.filter((x) => x !== String(t))
                          : [...f.tiendas, String(t)],
                      }))
                    }
                  />
                  <span>
                    <strong>{etiqueta(t)}</strong>
                  </span>
                </label>
              ))}
            </div>
          </Campo>

          <SheetProductos />

          <Campo
            id="sub-tiendas-dropi"
            label="Tienda en Dropi de cada tienda"
            ayuda="Nombre EXACTO como aparece en el selector «Tienda» del formulario Crear Orden de Dropi. Sin él, los pedidos de esa tienda no se suben (ni automática ni manualmente)."
          >
            <div className="form-grid">
              {(session?.idEmpresa ?? []).map((t) => (
                <div className="field" key={t}>
                  <label htmlFor={`sub-td-${t}`}>{etiqueta(t)}</label>
                  <input
                    id={`sub-td-${t}`}
                    value={form.tiendasDropi[String(t)] ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tiendasDropi: { ...f.tiendasDropi, [String(t)]: e.target.value },
                      }))
                    }
                    placeholder="Nombre de la tienda en Dropi"
                  />
                </div>
              ))}
            </div>
          </Campo>

          <Campo
            id="sub-estados"
            label="Estados que considera pendientes"
            ayuda="Por defecto solo «Por confirmar» (0). Si no marcas ninguno, revisa cualquiera."
          >
            <div className="permisos-grid">
              {Object.entries(ESTADOS_PEDIDO).map(([code, label]) => (
                <label className="check-permiso" key={code} htmlFor={`sub-e-${code}`}>
                  <input
                    id={`sub-e-${code}`}
                    type="checkbox"
                    checked={form.estados.includes(Number(code))}
                    onChange={() =>
                      setForm((f) => ({
                        ...f,
                        estados: f.estados.includes(Number(code))
                          ? f.estados.filter((x) => x !== Number(code))
                          : [...f.estados, Number(code)].sort((a, b) => a - b),
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </Campo>

          <ReglasEnvio
            valor={form}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                transportadoras: v.transportadoras,
                envio: v.envio,
                reglasProducto: v.reglasProducto,
                oficinaInter: v.oficinaInter,
              }))
            }
          />

          <p className="muted small">
            {Number(config.procesados ?? 0) > 0
              ? `${config.procesados} pedido(s) tratados en total.`
              : "Todavía no ha tratado ningún pedido."}
          </p>

          {ultimos.some((u) => REINTENTABLES.includes(u.accion)) ? (
            <div className="banner warn" style={{ marginTop: 4 }}>
              {[
                ["requiere-revision", "en revisión"],
                ["direccion-invalida", "con dirección inválida"],
                ["envio-caro", "con envío muy caro"],
                ["sin-transportadora", "sin transportadora disponible"],
              ]
                .map(([a, t]) => [ultimos.filter((u) => u.accion === a).length, t] as const)
                .filter(([n]) => n > 0)
                .map(([n, t]) => `${n} ${t}`)
                .join(", ")}
              : no se volverán a intentar solos. Revisa el motivo (o ajusta el pedido o los topes de
              envío) y cuando esté resuelto pulsa «Reintentar».{" "}
              <button className="btn sm" onClick={() => void reintentarRevision()}>
                Reintentar todos
              </button>
            </div>
          ) : null}

          {ultimos.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 4 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Chat</th>
                    <th>Resultado</th>
                    <th className="hide-sm">Cuándo</th>
                    <th>Detalle</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimos.map((u) => (
                    <tr key={String(u.id)}>
                      <td>
                        <strong>#{u.id}</strong>
                      </td>
                      <td className="small">
                        {u.cliente?.nombre ? <div>{u.cliente.nombre}</div> : null}
                        {u.cliente?.telefono ? (
                          <a className="muted" href={`tel:${u.cliente.telefono}`}>{u.cliente.telefono}</a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {u.cliente?.telefono && inbox(u.cliente.telefono) ? (
                          <a
                            className="btn sm"
                            href={inbox(u.cliente.telefono)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir el chat del cliente en Lucid Bot"
                          >
                            Abrir chat
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`chip${
                            u.accion === "subido" || u.accion === "preparado"
                              ? " ok"
                              : EN_ALERTA.includes(u.accion)
                                ? " alerta"
                                : ""
                          }`}
                        >
                          {u.accion}
                        </span>
                        {u.intentos && u.accion !== "requiere-revision" && u.accion !== "subido" && u.accion !== "preparado" ? (
                          <div className="muted small">intento {u.intentos} de {form.maxIntentos}</div>
                        ) : null}
                      </td>
                      <td className="hide-sm">
                        {u.ts ? new Date(u.ts).toLocaleString("es-CO") : "—"}
                      </td>
                      <td className="muted small wrap">
                        {u.detalle || "—"}
                        {u.analisis ? <AnalisisPedido analisis={u.analisis} /> : null}
                      </td>
                      <td>
                        {u.accion === "resultado-incierto" ? (
                          <button className="btn sm" onClick={() => void reintentarIncierto(String(u.id))}>
                            Verifiqué que no existe
                          </button>
                        ) : REINTENTABLES.includes(u.accion) ? (
                          <button className="btn sm" onClick={() => void reintentarRevision(String(u.id))}>
                            Reintentar
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="acciones-form">
            <button className="btn primary" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar configuración"}
            </button>
            <button
              className="btn"
              onClick={() => void probar()}
              disabled={probando}
              title="Ejecuta una vuelta ahora mismo, aunque la subida esté apagada"
            >
              {probando ? "Ejecutando..." : "Probar ahora"}
            </button>
          </div>
          <ErrorBanner error={err} />
        </>
      )}
    </section>
  );
}
