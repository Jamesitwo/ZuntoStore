import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { NOMBRES_PERMISO, puede, type Seccion } from "../auth/permisos";
import { errMsg, pickArray } from "../api/client";
import { auth, negocio, tools, usuarios } from "../api/endpoints";
import { Campo, CheckPermiso, ErrorBanner, JsonView, PageHeader } from "../components/ui";
import { ListaUsuarios } from "../components/ListaUsuarios";
import { SubidaDropi } from "../components/SubidaDropi";
import { MapasConfig } from "../components/MapasConfig";
import { EditorMensajeInicial } from "../components/MensajeInicial";
import { EditorTestimonios } from "../components/Testimonios";
import {
  parsearMensajeInicial,
  parsearTestimonios,
  serializarMensajeInicial,
  serializarTestimonios,
  type PasoInicial,
} from "../lib/productos";
import { useToast } from "../components/Toast";
import { useEtiquetaTienda } from "../lib/tiendas";
import { CODIGOS_PAIS, juntaTelefono } from "../lib/paises";

/* ------------------------------------------------------------------ */
/*  Piezas reutilizadas                                                */
/* ------------------------------------------------------------------ */

/** Interruptor (integraciones, boton flotante de WhatsApp). */
function Interruptor({
  id,
  activo,
  onChange,
  texto,
}: {
  id: string;
  activo: boolean;
  onChange: (v: boolean) => void;
  texto: string;
}) {
  return (
    <label className="switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={activo}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-pista" aria-hidden="true" />
      <span className="switch-texto">{texto}</span>
    </label>
  );
}

/** Lista etiqueta/valor (ficha de usuario, datos de la cuenta del bot). */
function Ficha({ datos }: { datos: Array<[string, unknown]> }) {
  const filas = datos.filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  if (!filas.length) return null;
  return (
    <dl className="ficha">
      {filas.map(([k, v]) => (
        <div className="ficha-fila" key={k}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** La respuesta cruda existe, pero a eleccion del usuario (no a la fuerza). */
function VerJson({ datos, titulo }: { datos: unknown; titulo?: string }) {
  if (datos === undefined || datos === null) return null;
  return (
    <details className="ver-json">
      <summary>{titulo ?? "Ver JSON"}</summary>
      <JsonView data={datos} />
    </details>
  );
}

/** Seccion con formulario propio. */
function Seccion({
  titulo,
  nota,
  boton,
  cargando,
  onEnviar,
  err,
  ok,
  extra,
  children,
}: {
  titulo: string;
  nota?: string;
  boton: string;
  cargando?: boolean;
  onEnviar: () => void;
  err?: string | null;
  ok?: unknown;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-title">{titulo}</div>
      {nota ? <p className="muted small">{nota}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onEnviar();
        }}
      >
        <div className="form-grid">{children}</div>
        <div className="acciones-form">
          <button className="btn primary" type="submit" disabled={!!cargando}>
            {cargando ? "Enviando..." : boton}
          </button>
        </div>
        <ErrorBanner error={err ?? null} />
        {extra}
        <VerJson datos={ok} titulo="Ver JSON de la respuesta" />
      </form>
    </section>
  );
}

/** Mensaje de exito del endpoint (usa el `msg` de LucidSales si trae uno). */
function Ok({ respuesta, porDefecto }: { respuesta: unknown; porDefecto: string }) {
  if (!respuesta || typeof respuesta !== "object") return null;
  const msg = (respuesta as Record<string, unknown>).msg;
  return (
    <p className="linea-ok">
      <span aria-hidden="true">✓</span> {typeof msg === "string" && msg ? msg : porDefecto}
    </p>
  );
}

/** 1 / true / "1" / "true" -> true (igual que el panel oficial). */
function aBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "si" || s === "sí";
  }
  if (typeof v === "number") return v > 0;
  return false;
}

function aTexto(o: unknown, ...claves: string[]): string {
  const obj = (o ?? {}) as Record<string, unknown>;
  for (const k of claves) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

/* ------------------------------------------------------------------ */
/*  Tab 1 — Negocio: la ficha de la tienda, en campos de verdad        */
/* ------------------------------------------------------------------ */

/** Integraciones con interruptor: [clave, etiqueta]. */
const INTEGRACIONES: Array<[string, string]> = [
  ["statusDropi", "Dropi (dropshipping)"],
  ["statusShopify", "Shopify"],
  ["status99envios", "99envios"],
  ["statusHoko", "Hoko"],
  ["statusBoxful", "Boxful"],
  ["statusGoogleAPI", "Google API (direcciones)"],
  ["statusGoogleAI", "Google AI (asistente)"],
  ["statusWhatsAppMetaConversions", "WhatsApp Meta Conversions"],
  ["statusEffi", "Effi"],
  ["statusAveonline", "Aveonline"],
  ["statusMastershop", "Mastershop"],
  ["statusEasyecommerce", "EasyEcommerce"],
  ["statusRocket", "Rocket"],
  ["statusSwayp", "SwayP"],
  ["statusVenndelo", "Venndelo"],
  ["statusEnvia", "Envía.com"],
  ["statusAliclik", "Aliclik"],
  ["statusDropanas", "Dropanas"],
  ["statusMeta", "Facebook / Meta"],
  ["statusGoogleGeocoding", "Google Geocoding"],
  ["statusBold", "Bold (pagos)"],
  ["statusEpayco", "Epayco (pagos)"],
];

/** Si la ficha no carga, al menos estas se muestran igual. */
const NUCLEO = new Set([
  "statusDropi",
  "statusShopify",
  "status99envios",
  "statusHoko",
  "statusBoxful",
  "statusGoogleAPI",
]);

/** Claves que el objeto de getshopname trae en mayusculas (o con otro nombre). */
const RENOMBRADAS = new Set([
  "id",
  "_id",
  "Nombre",
  "Correo",
  "Telefono",
  "Direccion",
  "WhatsappNum",
  "WhatsappMessage",
  "WhatsappButton",
  "selCountryId",
  "selCountryCode",
  "selCurrency",
]);

type Campos = {
  nombre: string;
  correo: string;
  telefono: string;
  direccion: string;
  paisCode: string;
  logo: string;
  whatsappNum: string;
  whatsappMessage: string;
  whatsappButton: boolean;
  apiKey: string;
  botApiKey: string;
  botFlow: string;
};

const CAMPOS_VACIOS: Campos = {
  nombre: "",
  correo: "",
  telefono: "",
  direccion: "",
  paisCode: "CO",
  logo: "",
  whatsappNum: "",
  whatsappMessage: "",
  whatsappButton: false,
  apiKey: "",
  botApiKey: "",
  botFlow: "",
};

/** Objeto de getshopname -> campos del formulario. */
function aCampos(o: Record<string, unknown> | null): Campos {
  return {
    nombre: aTexto(o, "Nombre", "nombre"),
    correo: aTexto(o, "Correo", "correo"),
    telefono: aTexto(o, "Telefono", "telefono"),
    direccion: aTexto(o, "Direccion", "direccion"),
    paisCode: aTexto(o, "selCountryCode", "paisCode") || "CO",
    logo: aTexto(o, "logo"),
    whatsappNum: aTexto(o, "WhatsappNum", "whatsappNum"),
    whatsappMessage: aTexto(o, "WhatsappMessage", "whatsappMessage"),
    whatsappButton: aBool(o?.WhatsappButton ?? o?.whatsappButton),
    apiKey: aTexto(o, "apiKey"),
    botApiKey: aTexto(o, "botApiKey"),
    botFlow: aTexto(o, "botFlow"),
  };
}

function aFlags(
  o: Record<string, unknown> | null,
  visibles: Array<[string, string]>,
): Record<string, boolean> {
  const f: Record<string, boolean> = {};
  for (const [k] of visibles) f[k] = aBool(o?.[k]);
  return f;
}

/**
 * Cuerpo de `POST /business/update`.
 *
 * Se parte de la ficha que trajo `/auth/getshopname` (así no se borra nada de
 * lo que el formulario no expone) y se traduce a las claves en minusculas que
 * espera el endpoint, tal como arma el panel oficial su `shopInfo`.
 * `parcial` = no se pudo leer la ficha: solo se manda lo que el usuario escribio.
 */
function armarCuerpo(
  origen: Record<string, unknown> | null,
  f: Campos,
  flags: Record<string, boolean>,
  visibles: Array<[string, string]>,
  parcial: boolean,
): Record<string, unknown> {
  const c: Record<string, unknown> = {};

  if (origen) {
    for (const [k, v] of Object.entries(origen)) if (!RENOMBRADAS.has(k)) c[k] = v;
    if ("selCountryId" in origen) c.pais = origen.selCountryId;
    if ("selCountryCode" in origen) c.paisCode = origen.selCountryCode;
    if ("selCurrency" in origen) c.moneda = origen.selCurrency;
  }

  if (parcial) {
    const texto: Array<[string, string]> = [
      ["nombre", f.nombre],
      ["correo", f.correo],
      ["telefono", f.telefono],
      ["direccion", f.direccion],
      ["paisCode", f.paisCode],
      ["logo", f.logo],
      ["whatsappNum", f.whatsappNum],
      ["whatsappMessage", f.whatsappMessage],
      ["apiKey", f.apiKey],
      ["botApiKey", f.botApiKey],
      ["botFlow", f.botFlow],
    ];
    for (const [k, v] of texto) if (v.trim()) c[k] = v;
    if (f.whatsappButton) c.whatsappButton = 1;
    for (const [k] of visibles) if (flags[k]) c[k] = 1;
    return c;
  }

  c.nombre = f.nombre;
  c.correo = f.correo;
  c.telefono = f.telefono;
  c.direccion = f.direccion;
  c.paisCode = f.paisCode;
  c.logo = f.logo;
  c.whatsappNum = f.whatsappNum;
  c.whatsappMessage = f.whatsappMessage;
  c.whatsappButton = f.whatsappButton ? 1 : 0;
  c.apiKey = f.apiKey;
  c.botApiKey = f.botApiKey;
  c.botFlow = f.botFlow;
  for (const [k] of visibles) c[k] = flags[k] ? 1 : 0;
  return c;
}

function NegocioTab({ idEmpresa }: { idEmpresa: number }) {
  const toast = useToast();
  const [origen, setOrigen] = useState<Record<string, unknown> | null>(null);
  const [f, setF] = useState<Campos>(CAMPOS_VACIOS);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [paises, setPaises] = useState<Array<{ code: string; nombre: string }>>([]);
  const [verClaves, setVerClaves] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState<unknown>(null);

  // la ficha sale de getshopname: trae la tienda completa (numero 135 de la doc)
  const cargar = async () => {
    setCargando(true);
    setErr(null);
    try {
      const res: any = await auth.shopNames([idEmpresa]);
      const arr = Array.isArray(res?.shopName) ? res.shopName : [];
      const obj =
        arr.find((s: any) => String(s?.id) === String(idEmpresa)) ?? arr[0] ?? null;
      if (!obj) throw new Error(`getshopname no devolvio la ficha de la tienda ${idEmpresa}`);
      const vis = INTEGRACIONES.filter(([k]) => k in obj || NUCLEO.has(k));
      setOrigen(obj as Record<string, unknown>);
      setF(aCampos(obj as Record<string, unknown>));
      setFlags(aFlags(obj as Record<string, unknown>, vis));
    } catch (e) {
      setOrigen(null);
      setF(CAMPOS_VACIOS);
      setFlags(aFlags(null, INTEGRACIONES));
      setErr(errMsg(e));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEmpresa]);

  // catalogo de paises para el select (publico, sin token)
  useEffect(() => {
    tools
      .countries()
      .then((res) => {
        const arr = pickArray(res, ["countries", "paises", "data"]);
        const ops = arr
          .map((p: any) => ({
            code: String(p?.sortname ?? p?.code ?? ""),
            nombre: String(p?.name ?? p?.nombre ?? ""),
          }))
          .filter((p) => p.code);
        if (ops.length) setPaises(ops);
      })
      .catch(() => setPaises([])); // se queda con el valor actual
  }, []);

  const visibles = useMemo(
    () => INTEGRACIONES.filter(([k]) => (origen ? k in origen || NUCLEO.has(k) : NUCLEO.has(k))),
    [origen],
  );

  // el select nunca debe dejar fuera el codigo actual de la tienda
  const opcionesPaises = useMemo(() => {
    const base = paises.length
      ? paises
      : [
          { code: "CO", nombre: "Colombia" },
          { code: "PA", nombre: "Panamá" },
          { code: "MX", nombre: "México" },
        ];
    return base.some((p) => p.code === f.paisCode)
      ? base
      : [{ code: f.paisCode, nombre: f.paisCode || "—" }, ...base];
  }, [paises, f.paisCode]);

  const cuerpo = useMemo(
    () => armarCuerpo(origen, f, flags, visibles, origen === null),
    [origen, f, flags, visibles],
  );

  const guardar = async () => {
    setGuardando(true);
    setErr(null);
    try {
      const res: any = await negocio.update(cuerpo);
      setRespuesta(res);
      if (res && res.ok === false) throw new Error(res.msg || "LucidSales rechazo el cambio");
      toast.success("Configuracion guardada");
      await cargar(); // relee la ficha para confirmar que quedo
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setGuardando(false);
    }
  };

  const campo = (k: keyof Campos) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Estos son los datos actuales de tu tienda. Al guardar se conserva todo lo que no aparece aquí.
      </p>

      {origen === null && !cargando ? (
        <div className="banner warn">
          No pude leer la ficha actual de la tienda. Al guardar{" "}
          <strong>solo se enviaran los campos con texto</strong> (los demas se conservan como
          estan). Puedes reintentar con <em>Recargar ficha</em>.
        </div>
      ) : null}

      <ErrorBanner error={err} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >
        <section className="card">
          <div className="card-title">Datos de la tienda</div>
          {cargando ? <p className="muted small">Cargando la ficha...</p> : null}
          <div className="form-grid">
            <Campo id="aj-nombre" label="Nombre">
              <input id="aj-nombre" value={f.nombre} onChange={campo("nombre")} placeholder="Mi tienda" />
            </Campo>
            <Campo id="aj-correo" label="Correo">
              <input id="aj-correo" type="email" value={f.correo} onChange={campo("correo")} placeholder="tienda@email.com" />
            </Campo>
            <Campo id="aj-telefono" label="Teléfono">
              <input id="aj-telefono" value={f.telefono} onChange={campo("telefono")} placeholder="+573001234567" />
            </Campo>
            <Campo id="aj-direccion" label="Dirección">
              <input id="aj-direccion" value={f.direccion} onChange={campo("direccion")} placeholder="Cra 92 #78b-02" />
            </Campo>
            <Campo id="aj-pais" label="País">
              <select id="aj-pais" value={f.paisCode} onChange={campo("paisCode")}>
                {opcionesPaises.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.nombre} ({p.code})
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="aj-logo" label="Logo (URL)">
              <input id="aj-logo" value={f.logo} onChange={campo("logo")} placeholder="https://..." />
            </Campo>
          </div>
          {f.logo.startsWith("http") ? (
            <p className="logo-vista">
              <img src={f.logo} alt="Logo de la tienda" onError={(e) => (e.currentTarget.style.display = "none")} />
            </p>
          ) : null}
        </section>

        <section className="card">
          <div className="card-title">WhatsApp</div>
          <div className="form-grid">
            <Campo id="aj-wa-num" label="Número de WhatsApp">
              <input id="aj-wa-num" value={f.whatsappNum} onChange={campo("whatsappNum")} placeholder="+573001234567" />
            </Campo>
            <Campo id="aj-wa-msg" label="Mensaje inicial">
              <input id="aj-wa-msg" value={f.whatsappMessage} onChange={campo("whatsappMessage")} placeholder="Hola!" />
            </Campo>
          </div>
          <Interruptor
            id="aj-wa-btn"
            activo={f.whatsappButton}
            onChange={(v) => setF((s) => ({ ...s, whatsappButton: v }))}
            texto="Mostrar el botón flotante de WhatsApp"
          />
        </section>

        <section className="card">
          <div className="card-title">Integraciones</div>
          <p className="muted small">
            Cada interruptor es un <code>status*</code> de la tienda (0 = apagado, 1 = encendido).
          </p>
          <div className="switchs">
            {visibles.map(([k, label]) => (
              <Interruptor
                key={k}
                id={`aj-${k}`}
                activo={!!flags[k]}
                onChange={(v) => setFlags((s) => ({ ...s, [k]: v }))}
                texto={label}
              />
            ))}
          </div>
        </section>

        <section className="card">
          <details className="avanzado">
            <summary>Claves de API y bot (avanzado)</summary>
            <div className="form-grid">
              <Campo id="aj-apikey" label="API key">
                <input
                  id="aj-apikey"
                  type={verClaves ? "text" : "password"}
                  value={f.apiKey}
                  onChange={campo("apiKey")}
                  autoComplete="off"
                />
              </Campo>
              <Campo id="aj-botkey" label="Bot API key">
                <input
                  id="aj-botkey"
                  type={verClaves ? "text" : "password"}
                  value={f.botApiKey}
                  onChange={campo("botApiKey")}
                  autoComplete="off"
                />
              </Campo>
              <Campo id="aj-botflow" label="Bot flow (id)">
                <input id="aj-botflow" value={f.botFlow} onChange={campo("botFlow")} />
              </Campo>
            </div>
            <Interruptor
              id="aj-verclaves"
              activo={verClaves}
              onChange={setVerClaves}
              texto="Mostrar las claves"
            />
          </details>
        </section>

        <section className="card">
          <div className="acciones-form">
            <button className="btn primary" type="submit" disabled={cargando || guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
            <button className="btn" type="button" onClick={cargar} disabled={cargando || guardando}>
              Recargar ficha
            </button>
            {guardando ? null : (
              <span className="muted small">
                {origen ? "Se envia la ficha completa" : "Solo se enviara lo escrito"}
              </span>
            )}
          </div>
          <Ok respuesta={respuesta} porDefecto="Configuracion actualizada" />
          <VerJson datos={respuesta} titulo="Ver JSON de la respuesta" />
          <VerJson datos={cuerpo} titulo="Ver JSON que se enviara" />
        </section>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2 — Bot: toda la configuración del asistente                  */
/* ------------------------------------------------------------------ */

/** La API real manda `data: {"0": {...}}` (objeto); el mock viejo usaba array. */
function leerConfigBot(r: any): {
  cfg: Record<string, unknown>;
  script: string;
  scriptSettings: Record<string, unknown> | null;
  isAdmin: boolean;
} {
  const d = r?.data;
  let cfg: any = null;
  if (Array.isArray(d)) cfg = d[0];
  else if (d && typeof d === "object") cfg = d["0"] ?? (d.nombreBot !== undefined ? d : null);
  return {
    cfg: cfg && typeof cfg === "object" ? cfg : {},
    script: typeof d?.script === "string" ? d.script : "",
    scriptSettings:
      d?.scriptSettings && typeof d.scriptSettings === "object" ? d.scriptSettings : null,
    isAdmin: aBool(d?.isAdmin),
  };
}

/** La config guarda las listas como JSON en string ("[]", "[{...}]"). */
function aLista(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function aObjeto(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) return p;
    } catch {
      /* no era JSON */
    }
  }
  return {};
}

function aEntero(v: unknown, porDefecto = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
}

type Fila = Record<string, string>;

interface FormBot {
  nombreAsistente: string;
  nombreBot: string;
  descripcionEmpresa: string;
  politicasEmpresa: string;
  tipoDeVoz: string;
  modeloOpenAI: string;
  tiempo: string;
  dividirTexto: boolean;
  agruparTexto: boolean;
  saludoAudio: boolean;
  botFlow: string;
  script: string;
  scriptEnabled: boolean;
  runScriptOnLogin: boolean;
  pagos: Fila[];
  faq: Fila[];
  faqPost: Fila[];
  notifs: Array<{ evento: string; original: Record<string, unknown>; telefonos: Fila[] }>;
  /** listas de texto libre (reglas, agradecimientos...) */
  listas: Record<string, string[]>;
  /** mensaje inicial: los MISMOS pasos que en el editor de productos */
  inicial: PasoInicial[];
  /** testimonios: pasos {type, content, id}, hasta 20 (LIMITE_TESTIMONIOS) */
  testimonios: PasoInicial[];
  personaliza: Record<string, boolean>;
  calls: Record<string, boolean>;
  agentes: Record<string, string>;
  llamada: Record<string, string>;
}

/**
 * Listas que la API guarda como JSON y que se editan como texto libre
 * (reglas y los dos agradecimientos). `mensajeInicial` va aparte: se edita
 * con el editor de pasos de Productos.
 */
const CLAVES_LISTA = [
  "reglas",
  "reglasPostVenta",
  "reglasUpsell",
  "agradecimientoConRecaudo",
  "agradecimientoSinRecaudo",
] as const;

const ETIQUETAS_LISTA: Record<string, string> = {
  reglas: "Reglas del bot",
  reglasPostVenta: "Reglas de post-venta",
  reglasUpsell: "Reglas de upsell",
  agradecimientoConRecaudo: "Agradecimiento con recaudo",
  agradecimientoSinRecaudo: "Agradecimiento sin recaudo",
};

const FLAGS_PERSONALIZAR: Array<[string, string]> = [
  ["personalizarMensajeInicial", "Usar mensaje inicial personalizado"],
  ["personalizarAgradecimientoConRecaudo", "Usar agradecimiento con recaudo"],
  ["personalizarAgradecimientoSinRecaudo", "Usar agradecimiento sin recaudo"],
];

/** Los dos agradecimientos (el de mensaje inicial tiene tarjeta propia). */
const FLAGS_AGRADE: Array<[string, string]> = FLAGS_PERSONALIZAR.filter(
  ([k]) => k !== "personalizarMensajeInicial",
);

/** Interruptores que la API guarda como 1/0 (como en el payload oficial). */
const FLAGS_NUM: Array<[string, string]> = [
  ["dividirTexto", "Dividir texto largo"],
  ["agruparTexto", "Agrupar mensajes"],
  ["saludoAudioPersonalizado", "Saludo en audio personalizado"],
];

const CALLS_SWITCH: Array<[string, string]> = [
  ["callsCarritosAbandonados", "Carrito abandonado"],
  ["callsConfirmacionPedidoLanding", "Confirmación de pedido (landing)"],
  ["callsDireccionErronea", "Dirección errónea"],
  ["callsRecogidaOficina1", "Recogida en oficina · día 1"],
  ["callsRecogidaOficina2", "Recogida en oficina · día 2"],
  ["callsRecogidaOficina3", "Recogida en oficina · día 3"],
  ["callsRecogidaOficina4", "Recogida en oficina · día 4"],
  ["callsRecogidaOficina5", "Recogida en oficina · día 5"],
  ["callsReparto", "Reparto"],
];

const CALLS_AGENTES: Array<[string, string]> = [
  ["nombreAgenteCallsCarritoAbandonado", "Agente: carrito abandonado"],
  ["nombreAgenteCallsConfirmacionPedidoLanding", "Agente: confirmación de pedido"],
  ["nombreAgenteCallsDireccionErronea", "Agente: dirección errónea"],
  ["nombreAgenteCallsRecogidaOficina", "Agente: recogida en oficina"],
  ["nombreAgenteCallsReparto", "Agente: reparto"],
];

const CALLS_NUM: Array<[string, string]> = [
  ["numeroReintentosCalls", "Reintentos"],
  ["tiempoReintentoLlamada", "Minutos entre reintentos"],
];

const CALLS_TEXTO: Array<[string, string]> = [
  ["horarioLlamadasInicio", "Horario de llamadas · desde"],
  ["horarioLlamadasFin", "Horario de llamadas · hasta"],
];

const CALLS_REGLAS: Array<[string, string]> = [
  ["reglasAdicionalesCallsCarritoAbandonado", "Reglas: carrito abandonado"],
  ["reglasAdicionalesCallsConfirmacionPedido", "Reglas: confirmación de pedido"],
  ["reglasAdicionalesCallsDireccionErronea", "Reglas: dirección errónea"],
  ["reglasAdicionalesCallsRecogidaOficina", "Reglas: recogida en oficina"],
  ["reglasAdicionalesCallsReparto", "Reglas: reparto"],
];

/** config de `GET /business/bot` -> estado del formulario. */
function formDesdeBot(
  cfg: Record<string, unknown>,
  script: string,
  scriptSettings: Record<string, unknown> | null,
  botFlowTienda = "",
): FormBot {
  const telefonosDe = (v: unknown): Fila[] =>
    aLista(aObjeto(v).telefonos).map((t) => ({
      nombre: aTexto(t, "nombre"),
      numero: aTexto(t, "numero"),
    }));

  return {
    nombreAsistente: aTexto(cfg, "nombreAsistente"),
    nombreBot: aTexto(cfg, "nombreBot"),
    descripcionEmpresa: aTexto(cfg, "descripcionEmpresa"),
    politicasEmpresa: aTexto(cfg, "politicasEmpresa"),
    tipoDeVoz: aTexto(cfg, "tipoDeVoz"),
    modeloOpenAI: aTexto(cfg, "modeloOpenAI"),
    tiempo: aTexto(cfg, "tiempoRecepcionMensajes"),
    dividirTexto: aBool(cfg.dividirTexto),
    agruparTexto: aBool(cfg.agruparTexto),
    saludoAudio: aBool(cfg.saludoAudioPersonalizado),
    // OJO: en la API real `botFlow` NO viene en la config del bot sino en la
    // ficha de la tienda; sin este respaldo, al guardar se mandaria vacio y se
    // desvincularia el flujo.
    botFlow: aTexto(cfg, "botFlow") || botFlowTienda,
    script,
    scriptEnabled: scriptSettings ? aBool(scriptSettings.enabled) : true,
    runScriptOnLogin: scriptSettings ? aBool(scriptSettings.requiresLogin) : true,
    pagos: aLista(cfg.metodosDePago).map((p) => ({
      nombreBanco: aTexto(p, "nombreBanco"),
      numeroCuenta: aTexto(p, "numeroCuenta"),
    })),
    faq: aLista(cfg.preguntasFrecuentes).map((p) => ({
      pregunta: aTexto(p, "pregunta"),
      respuesta: aTexto(p, "respuesta"),
    })),
    faqPost: aLista(cfg.preguntasFrecuentesPostVenta).map((p) => ({
      pregunta: aTexto(p, "pregunta"),
      respuesta: aTexto(p, "respuesta"),
    })),
    notifs: Object.entries(aObjeto(cfg.notificaciones)).map(([evento, v]) => ({
      evento,
      original: (v && typeof v === "object" ? v : {}) as Record<string, unknown>,
      telefonos: telefonosDe(v),
    })),
    listas: Object.fromEntries(
      CLAVES_LISTA.map((k) => [
        k,
        aLista(cfg[k]).map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))),
      ]),
    ),
    // mismo parser que el editor de productos (el GET lo trae como JSON string)
    inicial: parsearMensajeInicial(cfg.mensajeInicial),
    // testimonios: el producto los llama `Testimonios`, por si el bot usa el
    // otro nombre se miran las dos claves
    testimonios: parsearTestimonios(cfg.testimonios ?? cfg.Testimonios),
    personaliza: Object.fromEntries(FLAGS_PERSONALIZAR.map(([k]) => [k, aBool(cfg[k])])),
    calls: Object.fromEntries(CALLS_SWITCH.map(([k]) => [k, aBool(cfg[k])])),
    agentes: Object.fromEntries(CALLS_AGENTES.map(([k]) => [k, aTexto(cfg, k)])),
    llamada: Object.fromEntries(
      [...CALLS_NUM, ...CALLS_TEXTO, ...CALLS_REGLAS].map(([k]) => [k, aTexto(cfg, k)]),
    ),
  };
}

/**
 * Formulario -> cuerpo del bot para `POST /business/update`.
 *
 * **Clave**: aqui la API recibe arrays y objetos, no los strings JSON que
 * devuelve `GET /business/bot` (metodosDePago, preguntasFrecuentes,
 * notificaciones...), y los `personalizar*` como booleanos: es el mismo formato
 * que manda el panel oficial.
 */
function cuerpoBot(f: FormBot, cfg: Record<string, unknown>): Record<string, unknown> {
  const originales = Object.fromEntries(CLAVES_LISTA.map((k) => [k, aLista(cfg[k])]));

  // texto -> valor: si el original era objeto se respeta (JSON), si no, texto
  const lista = (k: string) =>
    (f.listas[k] ?? []).map((texto, i) => {
      const orig = originales[k][i];
      if (typeof orig === "object" && orig !== null) {
        try {
          return JSON.parse(texto);
        } catch {
          return orig;
        }
      }
      const t = texto.trim();
      if (orig === undefined || orig === null) {
        if (!t) return t;
        try {
          return JSON.parse(t);
        } catch {
          return texto;
        }
      }
      return texto;
    });

  const notificaciones: Record<string, unknown> = {};
  for (const n of f.notifs) {
    const k = n.evento.trim();
    if (!k) continue;
    notificaciones[k] = {
      ...n.original,
      telefonos: n.telefonos.filter((t) => t.nombre.trim() || t.numero.trim()),
    };
  }

  const c: Record<string, unknown> = {
    nombreAsistente: f.nombreAsistente,
    nombreBot: f.nombreBot,
    descripcionEmpresa: f.descripcionEmpresa,
    politicasEmpresa: f.politicasEmpresa,
    tipoDeVoz: f.tipoDeVoz,
    modeloOpenAI: f.modeloOpenAI,
    tiempoRecepcionMensajes: aEntero(f.tiempo, 0),
    dividirTexto: f.dividirTexto ? 1 : 0,
    agruparTexto: f.agruparTexto ? 1 : 0,
    saludoAudioPersonalizado: f.saludoAudio ? 1 : 0,
    botFlow: f.botFlow,
    metodosDePago: f.pagos.filter((p) => p.nombreBanco.trim() || p.numeroCuenta.trim()),
    preguntasFrecuentes: f.faq.filter((p) => p.pregunta.trim() || p.respuesta.trim()),
    preguntasFrecuentesPostVenta: f.faqPost.filter((p) => p.pregunta.trim() || p.respuesta.trim()),
    notificaciones,
    reglas: lista("reglas"),
    reglasPostVenta: lista("reglasPostVenta"),
    reglasUpsell: lista("reglasUpsell"),
    // el mensaje inicial va como ARRAY de pasos (asi lo manda el oficial),
    // serializado con la misma funcion que usa la ficha de producto
    mensajeInicial: JSON.parse(serializarMensajeInicial(f.inicial)),
    // testimonios: `[{image:url}, {video:url}, ...]` (una entrada por archivo,
    // con la clave del tipo). Se mandan las DOS claves posibles porque no esta
    // documentado cual lee el backend del bot.
    testimonios: serializarTestimonios(f.testimonios),
    Testimonios: serializarTestimonios(f.testimonios),
    agradecimientoConRecaudo: lista("agradecimientoConRecaudo"),
    agradecimientoSinRecaudo: lista("agradecimientoSinRecaudo"),
    isAdmin: false,
    script: f.script,
    scriptEnabled: f.scriptEnabled,
    runScriptOnLogin: f.runScriptOnLogin,
  };

  for (const [k] of FLAGS_PERSONALIZAR) c[k] = Boolean(f.personaliza[k]);
  for (const [k] of CALLS_SWITCH) c[k] = f.calls[k] ? 1 : 0;
  for (const [k] of CALLS_AGENTES) c[k] = f.agentes[k] ?? "";
  for (const [k] of CALLS_NUM) {
    const v = (f.llamada[k] ?? "").trim();
    c[k] = v === "" ? null : aEntero(v, 0);
  }
  for (const [k] of [...CALLS_TEXTO, ...CALLS_REGLAS]) {
    const v = (f.llamada[k] ?? "").trim();
    c[k] = v === "" ? null : v;
  }
  return c;
}

function nombreFlujo(fl: any): string {
  const n = fl?.name ?? fl?.Nombre ?? fl?.nombre ?? fl?.title ?? fl?.titulo ?? fl?.flowName;
  return n ? String(n) : "Flujo sin nombre";
}

function BotTab({ idEmpresa }: { idEmpresa: number }) {
  const toast = useToast();
  const [tienda, setTienda] = useState<Record<string, unknown> | null>(null);
  const [f, setF] = useState<FormBot>(() => formDesdeBot({}, "", null));
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [prompt, setPrompt] = useState<any>(null);
  /** Aviso si el backend no conserva los testimonios (no existen en su config). */
  const [avisoPersistencia, setAvisoPersistencia] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const [bot, setBot] = useState<any>(null);
  const [cargandoBot, setCargandoBot] = useState(true);
  const [cargandoFlujos, setCargandoFlujos] = useState(false);
  const [flujos, setFlujos] = useState<any[] | null>(null);
  const [cuenta, setCuenta] = useState<any>(null);
  const [usada, setUsada] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState<unknown>(null);

  /**
   * Carga los tres pedazos: la ficha de la tienda (para no borrar nada al
   * guardar), la config del bot (`data["0"]` en la API real) y el prompt.
   */
  const cargar = async () => {
    setCargandoBot(true);
    setErr(null);
    const [shop, cfgRes] = await Promise.allSettled([
      auth.shopNames([idEmpresa]),
      negocio.bot(),
    ]);
    // el flujo activo vive en la ficha de la tienda, no en la config del bot
    let flowTienda = "";

    if (shop.status === "fulfilled") {
      const arr = Array.isArray((shop.value as any)?.shopName)
        ? (shop.value as any).shopName
        : [];
      const obj =
        arr.find((s: any) => String(s?.id) === String(idEmpresa)) ?? arr[0] ?? null;
      setTienda((obj as Record<string, unknown>) ?? null);
      const k = String((obj as any)?.botApiKey ?? "");
      flowTienda = String((obj as any)?.botFlow ?? "");
      if (k) {
        setClave((c) => c || k);
        // lista de flujos sin tener que pegar la clave a mano
        await consultar(k, true);
      }
    } else {
      setTienda(null);
      setErr(errMsg(shop.reason));
    }

    if (cfgRes.status === "fulfilled") {
      const { cfg, script, scriptSettings } = leerConfigBot(cfgRes.value);
      setBot(cfg);
      setF(formDesdeBot(cfg, script, scriptSettings, flowTienda));
      setSucio(false);
      if (cfg.botApiKey) setClave(String(cfg.botApiKey));
      setCargandoBot(false);
      return cfg as Record<string, unknown>;
    }
    setBot(null);
    setErr((e) => e ?? errMsg(cfgRes.reason));
    setCargandoBot(false);
    return null;
  };

  useEffect(() => {
    void cargar();
    tools
      .botTemplate()
      .then((r: any) => setPrompt(r?.data ?? null))
      .catch(() => setPrompt(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEmpresa]);

  const consultar = async (k?: string, silencio = false) => {
    const key = (k ?? clave).trim();
    setErr(null);
    setAviso(null);
    setCargandoFlujos(true);
    try {
      const r: any = await tools.botFlows(key);
      setRespuesta(r);
      if (r?.status !== undefined && Number(r.status) !== 200) {
        setFlujos(null);
        setCuenta(null);
        setErr(r.msg || "No ha sido posible vincular la API KEY indicada");
        return;
      }
      const d = r?.data;
      if (!Array.isArray(d)) {
        setErr("Respuesta inesperada de /tools/bot/flows");
        return;
      }
      setFlujos(d);
      setCuenta(r.accountData ?? null);
      setUsada(aBool(r.usedKey));
      if (aBool(r.usedKey))
        setAviso(
          "Esta API KEY está en uso por otra tienda: si la guardas, se desvinculará de la otra.",
        );
      if (!d.length) setAviso("La API KEY no tiene flujos asociados.");
      if (!silencio)
        toast.success(`${d.length} flujo${d.length === 1 ? "" : "s"} encontrado${d.length === 1 ? "" : "s"}`);
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setCargandoFlujos(false);
    }
  };

  // ---- cambios del formulario ----
  const muta = (fn: (s: any) => any) => {
    setF((s) => fn({ ...s }) as FormBot);
    setSucio(true);
  };

  const cambiaTexto = (k: string) => (e: { target: { value: string } }) =>
    muta((s) => ({ ...s, [k]: e.target.value }));

  const cambiaBool = (k: string) => (v: boolean) => muta((s) => ({ ...s, [k]: v }));

  const cambiaMapa = (
    grupo: "personaliza" | "calls" | "agentes" | "llamada",
    k: string,
    v: boolean | string,
  ) => muta((s) => ({ ...s, [grupo]: { ...s[grupo], [k]: v } }));

  const cambiaListaTexto = (k: string, i: number, texto: string) =>
    muta((s) => ({
      ...s,
      listas: {
        ...s.listas,
        [k]: ((s.listas[k] ?? []) as string[]).map((t: string, j: number) =>
          j === i ? texto : t,
        ),
      },
    }));

  const anadeListaTexto = (k: string) =>
    muta((s) => ({ ...s, listas: { ...s.listas, [k]: [...(s.listas[k] ?? []), ""] } }));

  const quitaListaTexto = (k: string, i: number) =>
    muta((s) => ({
      ...s,
      listas: {
        ...s.listas,
        [k]: ((s.listas[k] ?? []) as string[]).filter((_: string, j: number) => j !== i),
      },
    }));

  const cambiaFila = (grupo: "pagos" | "faq" | "faqPost", i: number, cf: string, valor: string) =>
    muta((s) => ({
      ...s,
      [grupo]: (s[grupo] as Fila[]).map((fl, j) => (j === i ? { ...fl, [cf]: valor } : fl)),
    }));

  const anadeFila = (grupo: "pagos" | "faq" | "faqPost", plantilla: Fila) =>
    muta((s) => ({ ...s, [grupo]: [...(s[grupo] as Fila[]), plantilla] }));

  const quitaFila = (grupo: "pagos" | "faq" | "faqPost", i: number) =>
    muta((s) => ({ ...s, [grupo]: (s[grupo] as Fila[]).filter((_, j) => j !== i) }));

  const cambiaNotif = (i: number, cambio: Partial<{ evento: string; telefonos: Fila[] }>) =>
    muta((s) => ({
      ...s,
      notifs: (s.notifs as FormBot["notifs"]).map((n, j) =>
        j === i ? { ...n, ...cambio } : n,
      ),
    }));

  const cambiaTel = (i: number, j: number, ct: string, valor: string) =>
    muta((s) => ({
      ...s,
      notifs: (s.notifs as FormBot["notifs"]).map((n, k) =>
        k === i
          ? {
              ...n,
              telefonos: (n.telefonos as Fila[]).map((t: Fila, m: number) =>
                m === j ? { ...t, [ct]: valor } : t,
              ),
            }
          : n,
      ),
    }));

  const anadeTel = (i: number) =>
    muta((s) => ({
      ...s,
      notifs: (s.notifs as FormBot["notifs"]).map((n, k) =>
        k === i
          ? { ...n, telefonos: [...(n.telefonos as Fila[]), { nombre: "", numero: "" }] }
          : n,
      ),
    }));

  const quitaTel = (i: number, j: number) =>
    muta((s) => ({
      ...s,
      notifs: (s.notifs as FormBot["notifs"]).map((n, k) =>
        k === i
          ? {
              ...n,
              telefonos: (n.telefonos as Fila[]).filter((_: Fila, m: number) => m !== j),
            }
          : n,
      ),
    }));

  const anadeNotif = () =>
    muta((s) => ({
      ...s,
      notifs: [
        ...((s.notifs as FormBot["notifs"]) ?? []),
        { evento: "", original: {}, telefonos: [{ nombre: "", numero: "" }] },
      ],
    }));

  const quitaNotif = (i: number) =>
    muta((s) => ({
      ...s,
      notifs: ((s.notifs as FormBot["notifs"]) ?? []).filter((_, j: number) => j !== i),
    }));

  /**
   * Guardar: se manda la **ficha completa de la tienda** (igual que la pestaña
   * Negocio, así no se borra lo que no se ve) **+** la config del bot ya
   * traducida a arrays/objetos/booleans.
   */
  const guardar = async () => {
    setGuardando(true);
    setErr(null);
    try {
      const base = armarCuerpo(tienda, aCampos(tienda ?? {}), {}, [], tienda === null);
      const cuerpo = { ...base, ...cuerpoBot(f, bot ?? {}) };
      const enviados = f.testimonios.length;
      const res: any = await negocio.update(cuerpo);
      setRespuesta(res);
      if (res && res.ok === false) throw new Error(res.msg || "LucidSales rechazo el cambio");
      toast.success("Configuración del bot guardada");
      setSucio(false);
      const cfg2 = await cargar();
      // los testimonios NO estan en la config oficial del bot: si el backend
      // los ignora, se avisa en vez de perderlos en silencio
      const volvieron = parsearTestimonios(cfg2?.testimonios ?? cfg2?.Testimonios).length;
      setAvisoPersistencia(
        enviados > 0 && volvieron < enviados
          ? `El backend no conservó los testimonios (han vuelto ${volvieron} de ${enviados}): la configuración oficial del bot no tiene este campo, así que puede haberlo ignorado.`
          : null,
      );
    } catch (e) {
      const m = errMsg(e);
      setErr(m);
      toast.error(m);
    } finally {
      setGuardando(false);
    }
  };

  // el flujo GUARDADO (no el que se este editando) para marcarlo en la lista
  const activo = aTexto(bot, "botFlow") || String(tienda?.botFlow ?? "");

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Esta es la configuración actual de tu asistente. Al guardar se conserva todo lo que no
        aparece aquí.
      </p>

      <div className="acciones-form" style={{ marginTop: 0 }}>
        <button
          className="btn primary"
          onClick={() => void guardar()}
          disabled={guardando || cargandoBot}
        >
          {guardando ? "Guardando..." : "💾 Guardar configuración del bot"}
        </button>
        <button className="btn" onClick={() => void cargar()} disabled={guardando || cargandoBot}>
          Recargar
        </button>
        <span className="muted small">
          {sucio ? "Cambios sin guardar" : "Todo al día"}
          {prompt?.name ? ` · ${prompt.name}` : ""}
        </span>
      </div>

      <ErrorBanner error={err} />
      <Ok respuesta={respuesta} porDefecto="Configuración guardada" />

      <section className="card">
        <div className="card-title">Bot vinculado a la tienda</div>
        {cargandoBot ? <p className="muted small">Consultando...</p> : null}
        <Ficha
          datos={[
            ["Bot ID", bot?.botId],
            ["Flujo activo", f.botFlow || bot?.botFlow],
            ["API key guardada", bot?.botApiKey ? "••••" + String(bot.botApiKey).slice(-4) : null],
            ["En uso por otra tienda", bot?.isApiKeyLinked === undefined ? null : aBool(bot.isApiKeyLinked) ? "Sí" : "No"],
          ]}
        />
        {!cargandoBot && !bot ? <p className="muted small">Esta tienda no tiene bot configurado.</p> : null}
      </section>

      {/* ---------- cuenta y flujos: la lista es un desplegable ---------- */}
      <section className="card">
        <div className="card-title">Cuenta del bot y flujos</div>
        <p className="muted small">
          {flujos
            ? `${flujos.length} flujo${flujos.length === 1 ? "" : "s"} en la cuenta${
                cargandoFlujos ? " (actualizando…)" : ""
              }: se elige en el desplegable «Flujo activo» de arriba.`
            : cargandoFlujos
              ? "Cargando los flujos de la cuenta…"
              : "Todavía no se han cargado los flujos."}
        </p>

        {cuenta ? (
          <Ficha
            datos={Object.entries(cuenta).filter(
              ([, v]) => v !== null && v !== undefined && typeof v !== "object",
            )}
          />
        ) : null}

        {aviso ? (
          <div className={`banner ${usada ? "warn" : "info"}`}>{aviso}</div>
        ) : null}

        <details className="avanzado">
          <summary>Probar otra API key</summary>
          <Campo id="bot-key" label="API KEY del bot">
            <input
              id="bot-key"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="API KEY de LucidBot"
              autoComplete="off"
            />
          </Campo>
          <div className="acciones-form">
            <button
              className="btn"
              type="button"
              onClick={() => void consultar()}
              disabled={cargandoFlujos}
            >
              {cargandoFlujos ? "Consultando..." : "Consultar flujos"}
            </button>
          </div>
        </details>

        <VerJson datos={respuesta} titulo="Ver JSON de la respuesta" />
      </section>

      {/* ---------------- identidad ---------------- */}
      <section className="card">
        <div className="card-title">Identidad del asistente</div>
        <div className="form-grid">
          <Campo id="bot-asistente" label="Nombre del asistente">
            <input
              id="bot-asistente"
              value={f.nombreAsistente}
              onChange={cambiaTexto("nombreAsistente")}
            />
          </Campo>
          <Campo id="bot-nombre" label="Nombre del bot">
            <input id="bot-nombre" value={f.nombreBot} onChange={cambiaTexto("nombreBot")} />
          </Campo>
        </div>
        <Campo
          id="bot-descripcion"
          label="Descripción de la empresa"
          ayuda="Lo que el bot cuenta sobre la tienda cuando el cliente pregunta."
        >
          <textarea
            id="bot-descripcion"
            rows={4}
            value={f.descripcionEmpresa}
            onChange={cambiaTexto("descripcionEmpresa")}
          />
        </Campo>
      </section>

      {/* ---------------- conversación ---------------- */}
      <section className="card">
        <div className="card-title">Conversación</div>
        <div className="form-grid">
          <Campo id="bot-voz" label="Tipo de voz">
            <>
              <input
                id="bot-voz"
                list="bot-voz-op"
                value={f.tipoDeVoz}
                onChange={cambiaTexto("tipoDeVoz")}
              />
              <datalist id="bot-voz-op">
                <option value="Texto" />
                <option value="Audio" />
              </datalist>
            </>
          </Campo>
          <Campo id="bot-modelo" label="Modelo de IA">
            <>
              <input
                id="bot-modelo"
                list="bot-modelo-op"
                value={f.modeloOpenAI}
                onChange={cambiaTexto("modeloOpenAI")}
              />
              <datalist id="bot-modelo-op">
                <option value="Deepseek Basico" />
                <option value="GPT" />
                <option value="Claude" />
              </datalist>
            </>
          </Campo>
          <Campo
            id="bot-tiempo"
            label="Segundos para recibir mensajes"
            ayuda="tiempoRecepcionMensajes"
          >
            <input
              id="bot-tiempo"
              type="number"
              min={0}
              value={f.tiempo}
              onChange={cambiaTexto("tiempo")}
            />
          </Campo>
        </div>
        <div className="switchs" style={{ display: "grid", gap: 8 }}>
          {FLAGS_NUM.map(([k, txt]) => (
            <Interruptor
              key={k}
              id={`bot-${k}`}
              activo={Boolean((f as any)[k])}
              onChange={cambiaBool(k)}
              texto={txt}
            />
          ))}
        </div>
      </section>

      {/* ---------------- flujo activo ---------------- */}
      <section className="card">
        <div className="card-title">Flujo activo</div>
        <p className="muted small">
          El flujo de Lucid Bot que atiende a tus clientes.
        </p>
        <Campo id="bot-flujo" label="Flujo">
          <select id="bot-flujo" value={f.botFlow} onChange={cambiaTexto("botFlow")}>
            <option value="">(sin flujo)</option>
            {(flujos ?? []).map((fl, i) => {
              const id = String(fl?.id ?? fl?.flowId ?? i);
              return (
                <option key={id} value={id}>
                  {nombreFlujo(fl)} · {id}
                  {id === String(activo) ? " · activo" : ""}
                </option>
              );
            })}
            {flujos && f.botFlow ? (
              (flujos ?? []).every(
                (fl, i) => String(fl?.id ?? fl?.flowId ?? i) !== String(f.botFlow),
              ) ? (
                <option value={f.botFlow}>{f.botFlow} (no está en la lista)</option>
              ) : null
            ) : null}
          </select>
        </Campo>
      </section>

      {/* ---------------- métodos de pago ---------------- */}
      <section className="card">
        <div className="card-title">Métodos de pago</div>
        <p className="muted small">Lo que el bot ofrece al cerrar el pedido.</p>
        {f.pagos.length === 0 ? <p className="muted">Sin métodos de pago.</p> : null}
        {f.pagos.map((p, i) => (
          <div className="row gap" key={`pago-${i}`} style={{ marginBottom: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Medio / banco</label>
              <input
                value={p.nombreBanco}
                onChange={(e) => cambiaFila("pagos", i, "nombreBanco", e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Número de cuenta</label>
              <input
                value={p.numeroCuenta}
                onChange={(e) => cambiaFila("pagos", i, "numeroCuenta", e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn sm"
              title="Quitar método"
              onClick={() => quitaFila("pagos", i)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn sm"
          onClick={() => anadeFila("pagos", { nombreBanco: "", numeroCuenta: "" })}
        >
          + Añadir método de pago
        </button>
      </section>

      {/* ---------------- preguntas frecuentes ---------------- */}
      <section className="card">
        <div className="card-title">Preguntas frecuentes</div>
        {f.faq.length === 0 ? <p className="muted">Sin preguntas frecuentes.</p> : null}
        {f.faq.map((p, i) => (
          <div key={`faq-${i}`} style={{ marginBottom: 10 }}>
            <div className="row gap">
              <div className="field" style={{ flex: 1 }}>
                <label>Pregunta</label>
                <input
                  value={p.pregunta}
                  onChange={(e) => cambiaFila("faq", i, "pregunta", e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn sm"
                title="Quitar pregunta"
                onClick={() => quitaFila("faq", i)}
              >
                ×
              </button>
            </div>
            <div className="field">
              <label>Respuesta</label>
              <textarea
                rows={2}
                value={p.respuesta}
                onChange={(e) => cambiaFila("faq", i, "respuesta", e.target.value)}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn sm"
          onClick={() => anadeFila("faq", { pregunta: "", respuesta: "" })}
        >
          + Añadir pregunta
        </button>

        <details className="avanzado" style={{ marginTop: 12 }}>
          <summary>Preguntas frecuentes de post-venta ({f.faqPost.length})</summary>
          {f.faqPost.map((p, i) => (
            <div key={`faqpost-${i}`} style={{ marginBottom: 10 }}>
              <div className="row gap">
                <div className="field" style={{ flex: 1 }}>
                  <label>Pregunta</label>
                  <input
                    value={p.pregunta}
                    onChange={(e) => cambiaFila("faqPost", i, "pregunta", e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn sm"
                  title="Quitar pregunta"
                  onClick={() => quitaFila("faqPost", i)}
                >
                  ×
                </button>
              </div>
              <div className="field">
                <label>Respuesta</label>
                <textarea
                  rows={2}
                  value={p.respuesta}
                  onChange={(e) => cambiaFila("faqPost", i, "respuesta", e.target.value)}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn sm"
            onClick={() => anadeFila("faqPost", { pregunta: "", respuesta: "" })}
          >
            + Añadir pregunta de post-venta
          </button>
        </details>
      </section>

      {/* ---------------- politicas ---------------- */}
      <section className="card">
        <div className="card-title">Políticas de la empresa</div>
        <p className="muted small">
          Envíos, devoluciones y privacidad: el bot las usa cuando el cliente pregunta.
        </p>
        <textarea
          id="bot-politicas"
          rows={10}
          value={f.politicasEmpresa}
          onChange={cambiaTexto("politicasEmpresa")}
        />
      </section>

      {/* ---------------- notificaciones ---------------- */}
      <section className="card">
        <div className="card-title">Notificaciones</div>
        <p className="muted small">
          A quién se le avisa por WhatsApp cada evento (<code>notificaciones</code>).
        </p>
        {f.notifs.length === 0 ? <p className="muted">Sin eventos configurados.</p> : null}
        {f.notifs.map((n, i) => (
          <div key={`notif-${i}`} style={{ marginBottom: 12 }}>
            <div className="row gap">
              <div className="field" style={{ flex: 1 }}>
                <label>Evento</label>
                <input
                  list="bot-eventos"
                  value={n.evento}
                  onChange={(e) => cambiaNotif(i, { evento: e.target.value })}
                />
                <datalist id="bot-eventos">
                  <option value="confirmacion_compra" />
                  <option value="garantia" />
                </datalist>
              </div>
              <button
                type="button"
                className="btn sm"
                title="Quitar evento"
                onClick={() => quitaNotif(i)}
              >
                ×
              </button>
            </div>
            {n.telefonos.map((t, j) => (
              <div className="row gap" key={`tel-${i}-${j}`}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Nombre</label>
                  <input
                    value={t.nombre}
                    onChange={(e) => cambiaTel(i, j, "nombre", e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>WhatsApp</label>
                  <input
                    value={t.numero}
                    placeholder="+573001234567"
                    onChange={(e) => cambiaTel(i, j, "numero", e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn sm"
                  title="Quitar contacto"
                  onClick={() => quitaTel(i, j)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => anadeTel(i)}>
              + Añadir contacto
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={anadeNotif}>
          + Añadir evento
        </button>
      </section>

      {/* ---------------- mensaje inicial (mismo editor que productos) ---------------- */}
      <section className="card">
        <div className="card-title">Mensaje inicial (bienvenida del bot)</div>
        <p className="muted small">
          Secuencia que envía el bot cuando entra un cliente. Es el <strong>mismo editor</strong>{" "}
          que la ficha de producto y se guarda igual: <code>mensajeInicial</code> como array de{" "}
          <code>{"{type, content, id}"}</code>.
        </p>
        <Interruptor
          id="bot-personalizarMensajeInicial"
          activo={Boolean(f.personaliza.personalizarMensajeInicial)}
          onChange={(v) => cambiaMapa("personaliza", "personalizarMensajeInicial", v)}
          texto="Mensaje inicial personalizado"
        />
        {!f.personaliza.personalizarMensajeInicial ? (
          <div className="banner warn">
            El interruptor está apagado: aunque edites el mensaje, el bot no lo usará.
          </div>
        ) : null}
        <EditorMensajeInicial
          prefijo="del bot"
          pasos={f.inicial}
          onChange={(p) => muta((s) => ({ ...s, inicial: p }))}
          textoVacio="Sin mensaje inicial todavía: añade el primer paso (o activa el interruptor)."
        />
      </section>

      {/* ---------------- testimonios (igual que en el producto) ---------------- */}
      <section className="card">
        <EditorTestimonios
          titulo="Testimonios"
          prefijo="del bot"
          nota={
            <>
              Hasta <strong>20</strong> imágenes, vídeos, audios o documentos. Pega el enlace de
              cada archivo y verás la vista previa.
            </>
          }
          testimonios={f.testimonios}
          onChange={(t) => muta((s) => ({ ...s, testimonios: t }))}
        />
        <p className="muted small">
          Se envía como <code>testimonios</code> y <code>Testimonios</code> (las dos claves
          posibles) dentro de <code>business/update</code>.
        </p>
        {avisoPersistencia ? <div className="banner warn">{avisoPersistencia}</div> : null}
      </section>

      {/* ---------------- reglas y agradecimientos ---------------- */}
      <details className="avanzado">
        <summary>Reglas y agradecimientos</summary>
        <p className="muted small">
          Cada línea se guarda tal cual; si el valor original era un objeto se respeta como JSON.
        </p>
        <div className="switchs" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          {FLAGS_AGRADE.map(([k, txt]) => (
            <Interruptor
              key={k}
              id={`bot-${k}`}
              activo={Boolean(f.personaliza[k])}
              onChange={(v) => cambiaMapa("personaliza", k, v)}
              texto={txt}
            />
          ))}
        </div>
        {CLAVES_LISTA.map((k) => (
          <div key={k} style={{ marginBottom: 14 }}>
            <strong>{ETIQUETAS_LISTA[k]}</strong>
            {(f.listas[k] ?? []).length === 0 ? <p className="muted small">Sin elementos.</p> : null}
            {(f.listas[k] ?? []).map((texto, i) => (
              <div className="row gap" key={`${k}-${i}`} style={{ marginBottom: 6 }}>
                <textarea
                  rows={2}
                  style={{ flex: 1 }}
                  value={texto}
                  onChange={(e) => cambiaListaTexto(k, i, e.target.value)}
                />
                <button
                  type="button"
                  className="btn sm"
                  title="Quitar"
                  onClick={() => quitaListaTexto(k, i)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => anadeListaTexto(k)}>
              + Añadir
            </button>
          </div>
        ))}
      </details>

      {/* ---------------- llamadas ---------------- */}
      <details className="avanzado">
        <summary>Llamadas automáticas (Calls)</summary>
        <div className="switchs" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          {CALLS_SWITCH.map(([k, txt]) => (
            <Interruptor
              key={k}
              id={`bot-${k}`}
              activo={Boolean(f.calls[k])}
              onChange={(v) => cambiaMapa("calls", k, v)}
              texto={txt}
            />
          ))}
        </div>
        <div className="form-grid">
          {CALLS_AGENTES.map(([k, txt]) => (
            <Campo key={k} id={`bot-${k}`} label={txt}>
              <input
                value={f.agentes[k] ?? ""}
                onChange={(e) => cambiaMapa("agentes", k, e.target.value)}
              />
            </Campo>
          ))}
          {CALLS_NUM.map(([k, txt]) => (
            <Campo key={k} id={`bot-${k}`} label={txt}>
              <input
                type="number"
                value={f.llamada[k] ?? ""}
                onChange={(e) => cambiaMapa("llamada", k, e.target.value)}
              />
            </Campo>
          ))}
          {CALLS_TEXTO.map(([k, txt]) => (
            <Campo key={k} id={`bot-${k}`} label={txt}>
              <input
                type="time"
                value={(f.llamada[k] ?? "").slice(0, 5)}
                onChange={(e) => cambiaMapa("llamada", k, e.target.value)}
              />
            </Campo>
          ))}
        </div>
        {CALLS_REGLAS.map(([k, txt]) => (
          <Campo key={k} id={`bot-${k}`} label={txt}>
            <textarea
              rows={2}
              value={f.llamada[k] ?? ""}
              onChange={(e) => cambiaMapa("llamada", k, e.target.value)}
            />
          </Campo>
        ))}
      </details>

      {/* ---------------- script ---------------- */}
      <section className="card">
        <div className="card-title">Script</div>
        <p className="muted small">
          <code>script</code> se guarda con <code>scriptEnabled</code> y{" "}
          <code>runScriptOnLogin</code>.
        </p>
        <textarea
          rows={6}
          value={f.script}
          onChange={cambiaTexto("script")}
          placeholder="// javascript"
        />
        <div className="switchs" style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <Interruptor
            id="bot-scriptEnabled"
            activo={f.scriptEnabled}
            onChange={cambiaBool("scriptEnabled")}
            texto="Script activado"
          />
          <Interruptor
            id="bot-runScript"
            activo={f.runScriptOnLogin}
            onChange={cambiaBool("runScriptOnLogin")}
            texto="Ejecutar al iniciar sesión"
          />
        </div>
      </section>

      {/* ---------------- prompt (solo lectura) ---------------- */}
      {prompt?.value ? (
        <section className="card">
          <div className="card-title">{prompt.name || "Plantilla del bot"}</div>
          <p className="muted small">
            Solo lectura: es la plantilla que usa el bot.
          </p>
          <pre className="json-view">{String(prompt.value)}</pre>
        </section>
      ) : null}

      <VerJson datos={bot} titulo="Ver la config del bot en bruto" />

      <div className="acciones-form">
        <button
          className="btn primary"
          onClick={() => void guardar()}
          disabled={guardando || cargandoBot}
        >
          {guardando ? "Guardando..." : "💾 Guardar configuración del bot"}
        </button>
        <span className="muted small">{sucio ? "Cambios sin guardar" : "Todo al día"}</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3 — Usuarios: formularios con su resultado legible             */
/* ------------------------------------------------------------------ */

function UsuariosTab() {
  const toast = useToast();

  // la lista de arriba se refresca al crear (tick)
  const [tick, setTick] = useState(0);

  // buscar por token
  const [token, setToken] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errBuscar, setErrBuscar] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<any>(null);

  // crear usuario
  const [nuevo, setNuevo] = useState({
    nombre: "",
    usuario: "",
    codigo: "CO",
    digitos: "",
    direccion: "",
    permisos: [] as string[],
  });
  const [creando, setCreando] = useState(false);
  const [errCrear, setErrCrear] = useState<string | null>(null);
  const [okCrear, setOkCrear] = useState<unknown>(null);

  // crear contrasena
  const [pw, setPw] = useState({
    token: "",
    nombre: "",
    usuario: "",
    codigo: "CO",
    telefono: "",
    direccion: "",
    password: "",
  });
  const [creandoPw, setCreandoPw] = useState(false);
  const [errPw, setErrPw] = useState<string | null>(null);
  const [okPw, setOkPw] = useState<unknown>(null);

  // restablecer
  const [reset, setReset] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errReset, setErrReset] = useState<string | null>(null);
  const [okReset, setOkReset] = useState<unknown>(null);

  const buscar = async () => {
    setBuscando(true);
    setErrBuscar(null);
    setUsuario(null);
    try {
      const r: any = await usuarios.show(token.trim());
      if (r && r.ok === false) throw new Error(r.msg || "Token no valido");
      setUsuario(r);
      toast.success("Usuario encontrado");
    } catch (e) {
      const m = errMsg(e);
      setErrBuscar(m);
      toast.error(m);
    } finally {
      setBuscando(false);
    }
  };

  const crear = async () => {
    setCreando(true);
    setErrCrear(null);
    setOkCrear(null);
    try {
      if (!nuevo.nombre.trim()) throw new Error("Escribe el nombre completo");
      if (!nuevo.usuario.trim()) throw new Error("Escribe el correo electrónico");
      if (!nuevo.permisos.length) throw new Error("Marca al menos un permiso");
      const usuario = nuevo.usuario.trim().toLowerCase();
      const telefono = juntaTelefono(nuevo.codigo, nuevo.digitos);
      const nombre = nuevo.nombre.trim();
      const r: any = await usuarios.create({
        // cuerpo del formulario oficial (chunk AjustesUsuariosScreen)
        nombre,
        usuario,
        telefono,
        direccion: nuevo.direccion.trim(),
        permisos: JSON.stringify(nuevo.permisos),
        // claves antiguas por compatibilidad (si el backend espera name/email/rol)
        name: nombre,
        email: usuario,
        rol: nuevo.permisos.join(","),
      });
      if (r && r.ok === false) throw new Error(r.msg || "No se pudo crear el usuario");
      setOkCrear(r);
      toast.success("Usuario creado");
      setNuevo({
        nombre: "",
        usuario: "",
        codigo: "CO",
        digitos: "",
        direccion: "",
        permisos: [],
      });
      setTick((t) => t + 1); // refresca la lista de arriba
    } catch (e) {
      const m = errMsg(e);
      setErrCrear(m);
      toast.error(m);
    } finally {
      setCreando(false);
    }
  };

  const crearPassword = async () => {
    setCreandoPw(true);
    setErrPw(null);
    setOkPw(null);
    try {
      if (!pw.token.trim() || !pw.password) throw new Error("Faltan el token y la contraseña");
      const prefijo = CODIGOS_PAIS.find(([c]) => c === pw.codigo)?.[1] ?? "";
      const r: any = await usuarios.createPassword({
        token: pw.token.trim(),
        nombre: pw.nombre.trim(),
        usuario: pw.usuario.trim().toLowerCase(),
        telefono: `${prefijo}${pw.telefono.replace(/\D/g, "")}`,
        direccion: pw.direccion.trim(),
        password: pw.password,
      });
      if (r && r.ok === false) throw new Error(r.msg || "No se pudo crear la contraseña");
      setOkPw(r);
      toast.success("Contraseña creada");
    } catch (e) {
      const m = errMsg(e);
      setErrPw(m);
      toast.error(m);
    } finally {
      setCreandoPw(false);
    }
  };

  const restablecer = async () => {
    setEnviando(true);
    setErrReset(null);
    setOkReset(null);
    try {
      const v = reset.trim().toLowerCase();
      if (!v) throw new Error("Escribe el correo o usuario");
      // el panel oficial manda {usuario}; {email} queda por compatibilidad
      const r: any = await usuarios.resetPassword({ usuario: v, email: v });
      if (r && r.ok === false)
        throw new Error(r.msg || "La información proporcionada es incorrecta o no registrada.");
      setOkReset(r);
      toast.success("Correo de recuperación enviado");
    } catch (e) {
      const m = errMsg(e);
      setErrReset(m);
      toast.error(m);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {/* la lista primero: aqui se ve quien tiene acceso */}
      <ListaUsuarios tick={tick} />

      {/* subida automatica a Dropi: mismo patrón que el reparto automatico */}
      <SubidaDropi />

      {/* validador de direcciones propio: API key de Google Maps */}
      <MapasConfig />

      <Seccion
        titulo="Buscar usuario por token"
        nota="Pega el código que recibió el usuario para crear su contraseña."
        boton={buscando ? "Buscando..." : "Buscar"}
        cargando={buscando}
        onEnviar={buscar}
        err={errBuscar}
        ok={usuario}
        extra={
          usuario ? (
            <Ficha
              datos={[
                ["Nombre", usuario.nombre],
                ["Usuario", usuario.usuario],
                ["Teléfono", usuario.telefono],
                ["Dirección", usuario.direccion],
              ]}
            />
          ) : null
        }
      >
        <Campo id="us-token" label="Token del usuario">
          <input id="us-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token" autoComplete="off" />
        </Campo>
      </Seccion>

      <Seccion
        titulo="Crear usuario"
        nota="El usuario queda pendiente de crear su contraseña (siguiente tarjeta)."
        boton={creando ? "Creando..." : "Crear usuario"}
        cargando={creando}
        onEnviar={crear}
        err={errCrear}
        ok={okCrear}
        extra={<Ok respuesta={okCrear} porDefecto="Usuario creado" />}
      >
        <Campo id="us-nombre" label="Nombre completo">
          <input
            id="us-nombre"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
          />
        </Campo>
        <Campo id="us-email" label="Correo electrónico">
          <input
            id="us-email"
            type="email"
            value={nuevo.usuario}
            onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value })}
            autoComplete="off"
          />
        </Campo>
        <Campo
          id="us-tel"
          label="Teléfono"
          ayuda="Se guarda con el prefijo del país y sin + (ej. 573001234567), como lo hace el panel oficial."
        >
          <div className="row gap">
            <select
              id="us-pais"
              aria-label="Prefijo del país"
              value={nuevo.codigo}
              onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
              style={{ maxWidth: 150 }}
            >
              {CODIGOS_PAIS.map(([c, prefijo, n]) => (
                <option key={c} value={c}>
                  +{prefijo} {n}
                </option>
              ))}
            </select>
            <input
              id="us-tel"
              value={nuevo.digitos}
              onChange={(e) => setNuevo({ ...nuevo, digitos: e.target.value })}
              placeholder="3001234567"
              inputMode="numeric"
            />
          </div>
        </Campo>
        <Campo id="us-dir" label="Dirección">
          <input
            id="us-dir"
            value={nuevo.direccion}
            onChange={(e) => setNuevo({ ...nuevo, direccion: e.target.value })}
          />
        </Campo>
        <Campo
          id="us-perm"
          label="Permisos"
          ayuda={`Que podrá ver este usuario en LucidSales (nombres oficiales del panel). En el cuerpo viaja como JSON serializado (permisos = ["2","5"]); el numero 1 no tiene casilla.`}
        >
          <div className="permisos-grid">
            {Object.entries(NOMBRES_PERMISO)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([numero, nombre]) => (
                <CheckPermiso
                  key={numero}
                  id={`us-perm-${numero}`}
                  numero={numero}
                  nombre={nombre}
                  marcado={nuevo.permisos.includes(numero)}
                  onChange={(v) =>
                    setNuevo((n) => ({
                      ...n,
                      permisos: v
                        ? [...new Set([...n.permisos, numero])]
                        : n.permisos.filter((x) => x !== numero),
                    }))
                  }
                />
              ))}
          </div>
        </Campo>
      </Seccion>

      <Seccion
        titulo="Crear contraseña"
        nota="Define la contraseña de un usuario nuevo."
        boton={creandoPw ? "Creando..." : "Crear contraseña"}
        cargando={creandoPw}
        onEnviar={crearPassword}
        err={errPw}
        ok={okPw}
        extra={<Ok respuesta={okPw} porDefecto="Contraseña creada" />}
      >
        <Campo id="pw-token" label="Token del usuario">
          <input id="pw-token" value={pw.token} onChange={(e) => setPw({ ...pw, token: e.target.value })} autoComplete="off" />
        </Campo>
        <Campo id="pw-nombre" label="Nombre">
          <input id="pw-nombre" value={pw.nombre} onChange={(e) => setPw({ ...pw, nombre: e.target.value })} />
        </Campo>
        <Campo id="pw-usuario" label="Usuario">
          <input id="pw-usuario" value={pw.usuario} onChange={(e) => setPw({ ...pw, usuario: e.target.value })} />
        </Campo>
        <Campo id="pw-tel" label="Teléfono">
          <div className="row gap">
            <select
              id="pw-pais"
              aria-label="Prefijo del país"
              value={pw.codigo}
              onChange={(e) => setPw({ ...pw, codigo: e.target.value })}
              style={{ maxWidth: 150 }}
            >
              {CODIGOS_PAIS.map(([c, prefijo, n]) => (
                <option key={c} value={c}>
                  +{prefijo} {n}
                </option>
              ))}
            </select>
            <input id="pw-tel" value={pw.telefono} onChange={(e) => setPw({ ...pw, telefono: e.target.value })} placeholder="3001234567" />
          </div>
        </Campo>
        <Campo id="pw-dir" label="Dirección">
          <input id="pw-dir" value={pw.direccion} onChange={(e) => setPw({ ...pw, direccion: e.target.value })} />
        </Campo>
        <Campo id="pw-pass" label="Contraseña">
          <input id="pw-pass" type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" />
        </Campo>
      </Seccion>

      <Seccion
        titulo="Restablecer contraseña"
        nota="Le llega al usuario un correo para recuperar su contraseña."
        boton={enviando ? "Enviando..." : "Enviar correo"}
        cargando={enviando}
        onEnviar={restablecer}
        err={errReset}
        ok={okReset}
        extra={
          <Ok
            respuesta={okReset}
            porDefecto="Revise su correo electrónico, se le ha enviado un enlace para restablecer la contraseña"
          />
        }
      >
        <Campo id="rs-email" label="Correo o usuario">
          <input id="rs-email" value={reset} onChange={(e) => setReset(e.target.value)} placeholder="usuario@email.com" />
        </Campo>
      </Seccion>
    </>
  );
}

/* ------------------------------------------------------------------ */

type Tab = "negocio" | "bot" | "usuarios";

/**
 * Pestañas y el permiso de LucidSales que pide cada una:
 * 8 = ajustes/general (negocio y bot), 7 = ajustes/usuarios.
 * Mismo criterio que el panel oficial (que ademas registra rutas aparte).
 */
const TABS: Array<{ id: Tab; label: string; permiso: Seccion }> = [
  { id: "negocio", label: "Negocio", permiso: "ajustesGeneral" },
  { id: "bot", label: "Bot", permiso: "ajustesGeneral" },
  { id: "usuarios", label: "Usuarios", permiso: "ajustesUsuarios" },
];

export function AjustesPage() {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const etiqueta = useEtiquetaTienda();
  const [tab, setTab] = useState<Tab>("negocio");

  const abiertas = TABS.filter((t) => puede(session?.rol ?? null, t.permiso));

  if (!abiertas.length) {
    return (
      <div className="ajustes-page">
        <PageHeader title="Ajustes" subtitle={`Configuracion de ${etiqueta(idEmpresa)}`} />
        <div className="banner warn">
          <strong>Sin acceso a Ajustes.</strong> Se necesita el permiso <code>7</code> (Usuarios) u{" "}
          <code>8</code> (Negocio); tu rol es <code>{session?.rol || "—"}</code>.
        </div>
      </div>
    );
  }

  const activa: Tab = abiertas.some((t) => t.id === tab) ? tab : abiertas[0].id;

  return (
    <div className="ajustes-page">
      <PageHeader title="Ajustes" subtitle={`Configuracion de ${etiqueta(idEmpresa)}`} />

      {abiertas.length > 1 ? (
        <div className="ajustes-intro">
          <span className="ajustes-intro-icon" aria-hidden="true">⚙</span>
          <span>Administra los datos de tu tienda, el asistente y el acceso de tu equipo.</span>
        </div>
      ) : null}

      <div className="tabs ajustes-tabs" role="tablist" aria-label="Secciones de ajustes">
        {abiertas.map((t) => (
          <button
            key={t.id}
            className={`tab${activa === t.id ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activa === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activa === "negocio" && <NegocioTab idEmpresa={idEmpresa} />}
      {activa === "bot" && <BotTab idEmpresa={idEmpresa} />}
      {activa === "usuarios" && <UsuariosTab />}
    </div>
  );
}
