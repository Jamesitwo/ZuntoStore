// Campos de la tienda del bot nuevo, ordenados como los Ajustes de LucidSales
// (Agente IA, Voz y modelo, Metodos de pago, Conocimiento, Reglas,
// Notificaciones, Mensajes). Cada campo vacio = no se toca en el bot nuevo.
import { useState } from "react";

type Campos = Record<string, string>;
interface Props {
  disponibles: string[]; // campos del bot nuevo que no son por producto
  campos: Campos;
  setCampos: (f: (c: Campos) => Campos) => void;
  ocupado: boolean;
  nombreTienda: string;
  onCopiar: () => void;
  onGuardar: () => void;
}

const VOCES = ["Lucid Voice", "Eleven Labs", "Open AI", "Texto"];
const MODELOS = ["OpenAI GPT Basico", "OpenAI GPT Avanzado", "Deepseek Basico", "Deepseek Avanzado", "X.AI GROK Avanzado", "Gemini Basico", "Gemini Avanzado"];
const EVENTOS: Record<string, string> = { confirmacion_compra: "Confirmación de compra", errorIa: "Error IA" };

// campos que tienen su propio control (el resto va a "Otros campos")
const CON_CONTROL = new Set([
  "Nombre_asistente_LucidSales",
  "Nombre_empresa_LucidSales",
  "Descripcion_empresa_LucidSales",
  "Politicas_empresa_LucidSales",
  "Tipo_voz_LucidSales",
  "Modelo_OpenAI_LucidSales",
  "Dividir_texto_LucidSales",
  "Agrupar_mensajes_LucidSales",
  "Tiempo_recepcion_mensajes_LucidSales",
  "Enviar saludo en audio personalizado",
  "Cuentas_bancarias_LucidSales",
  "Preguntas_frecuentes_LucidSales",
  "Preguntas_frecuentes_posventa_LucidSales",
  "Reglas_adicionales2_LucidSales",
  "Reglas_adicionales_Postventa",
  "Notificaciones_admin_LucidSales",
  "Mensaje_Organico_LucidSales",
  "Con_Recaudo_LucidSales",
  "Sin_Recaudo_LucidSales",
]);

function json<T>(t: string | undefined, def: T): T {
  try {
    const v = JSON.parse(String(t ?? ""));
    return v ?? def;
  } catch {
    return def;
  }
}

/** {messages:[{message:{text}}]} <-> texto (se conservan los mensajes que no son texto). */
function textoDeMensajes(v?: string) {
  const j = json<any>(v, null);
  if (!j || !Array.isArray(j.messages)) return String(v ?? "");
  return j.messages.map((m: any) => m?.message?.text).filter((t: any) => typeof t === "string").join("\n\n");
}
function mensajesDeTexto(texto: string, anterior?: string) {
  const j = json<any>(anterior, null);
  const otros = Array.isArray(j?.messages) ? j.messages.filter((m: any) => typeof m?.message?.text !== "string") : [];
  if (!texto.trim() && !otros.length) return "";
  return JSON.stringify({ ...(j ?? {}), messages: [...(texto.trim() ? [{ message: { text: texto } }] : []), ...otros] });
}

function Seccion({ n, titulo, desc, children }: { n: string; titulo: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="ct-seccion">
      <div className="ct-cabeza">
        <span className="ct-num">{n}</span>
        <div>
          <div className="ct-titulo">{titulo}</div>
          <div className="muted small">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function CamposTienda({ disponibles, campos, setCampos, ocupado, nombreTienda, onCopiar, onGuardar }: Props) {
  const hay = new Set(disponibles);
  const v = (n: string) => campos[n] ?? "";
  const poner = (n: string, valor: string) => setCampos((c) => ({ ...c, [n]: valor }));
  const [otrosAbiertos, setOtrosAbiertos] = useState(false);

  // controles
  const Falta = ({ n }: { n: string }) => (hay.has(n) ? null : <span className="ct-falta">no está en el bot nuevo</span>);
  const Texto = ({ n, label, filas = 0, ph = "" }: { n: string; label: string; filas?: number; ph?: string }) => (
    <div className="field">
      <label htmlFor={`ct-${n}`}>
        {label} {Falta({ n: n })}
      </label>
      {filas ? (
        <textarea id={`ct-${n}`} rows={filas} value={v(n)} placeholder={ph} disabled={!hay.has(n)} onChange={(x) => poner(n, x.target.value)} />
      ) : (
        <input id={`ct-${n}`} value={v(n)} placeholder={ph} disabled={!hay.has(n)} onChange={(x) => poner(n, x.target.value)} />
      )}
    </div>
  );
  const Opciones = ({ n, label, opciones }: { n: string; label: string; opciones: string[] }) => (
    <div className="field">
      <label htmlFor={`ct-${n}`}>
        {label} {Falta({ n: n })}
      </label>
      <select id={`ct-${n}`} value={v(n)} disabled={!hay.has(n)} onChange={(x) => poner(n, x.target.value)}>
        <option value="">— no cambiar —</option>
        {[...new Set([...opciones, ...(v(n) && !opciones.includes(v(n)) ? [v(n)] : [])])].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
  const SiNo = ({ n, label, desc }: { n: string; label: string; desc: string }) => (
    <div className="ct-opcion">
      <div>
        <div className="ct-opcion-titulo">
          {label} {Falta({ n: n })}
        </div>
        <div className="muted small">{desc}</div>
      </div>
      <select aria-label={label} value={v(n)} disabled={!hay.has(n)} onChange={(x) => poner(n, x.target.value)}>
        <option value="">— no cambiar —</option>
        <option value="SI">Sí</option>
        <option value="NO">No</option>
      </select>
    </div>
  );
  const JsonLibre = ({ n, label }: { n: string; label: string }) => {
    let error = "";
    if (v(n).trim()) {
      try {
        JSON.parse(v(n));
      } catch {
        error = "No es un JSON válido";
      }
    }
    return (
      <div className="field">
        <label htmlFor={`ct-${n}`}>
          {label} {Falta({ n: n })}
        </label>
        <textarea id={`ct-${n}`} className="mono" rows={3} value={v(n)} placeholder="[]" disabled={!hay.has(n)} onChange={(x) => poner(n, x.target.value)} />
        <span className="campo-ayuda" style={error ? { color: "#b91c1c" } : undefined}>
          {error || "Mismo formato que guarda LucidSales (lista JSON). Usa «Copiar del bot de Zunto» para partir de lo de Zunto."}
        </span>
      </div>
    );
  };

  // metodos de pago: [{nombreBanco, numeroCuenta}]
  const CUENTAS = "Cuentas_bancarias_LucidSales";
  const cuentas = json<Array<{ nombreBanco: string; numeroCuenta: string }>>(v(CUENTAS), []);
  const ponerCuentas = (l: typeof cuentas) => poner(CUENTAS, l.length ? JSON.stringify(l) : "");

  // notificaciones: {evento: {telefonos:[{nombre, numero}]}}
  const NOTI = "Notificaciones_admin_LucidSales";
  const noti = json<Record<string, { telefonos: Array<{ nombre: string; numero: string }> }>>(v(NOTI), {});
  const eventos = [...new Set([...Object.keys(EVENTOS), ...Object.keys(noti)])];
  const ponerNoti = (ev: string, tels: Array<{ nombre: string; numero: string }>) => {
    const sig = { ...noti, [ev]: { ...(noti[ev] ?? {}), telefonos: tels } };
    poner(NOTI, JSON.stringify(sig));
  };

  const otros = disponibles.filter((n) => !CON_CONTROL.has(n));
  const conValor = Object.values(campos).filter((x) => String(x ?? "").trim()).length;

  return (
    <div className="campos-tienda">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <div className="card-subtitle" style={{ margin: 0 }}>
          Configuración del bot de {nombreTienda || "la nueva tienda"} ({conValor} campos con valor)
        </div>
        <button type="button" className="btn sm" disabled={ocupado} onClick={onCopiar} title="Llena los campos vacíos con los valores actuales del bot de Zunto">
          Copiar del bot de Zunto
        </button>
      </div>
      <p className="muted small">Lo que dejes vacío o en «no cambiar» no se toca en el bot nuevo.</p>

      <Seccion n="01" titulo="Agente IA" desc="Cómo se presenta el bot y qué información usa para responder.">
        <div className="grid-2">
          {Texto({ n: "Nombre_asistente_LucidSales", label: "Nombre del agente", ph: "Ej.: Isabella" })}
          {Texto({ n: "Nombre_empresa_LucidSales", label: "Nombre de la empresa", ph: nombreTienda || "Nombre de la tienda" })}
        </div>
        {Texto({ n: "Descripcion_empresa_LucidSales", label: "Descripción de la empresa", filas: 3 })}
        {Texto({ n: "Politicas_empresa_LucidSales", label: "Políticas de la empresa", filas: 6 })}
      </Seccion>

      <Seccion n="02" titulo="Voz y modelo" desc="Configuración técnica del agente de IA.">
        <div className="grid-2">
          {Opciones({ n: "Tipo_voz_LucidSales", label: "Tipo de voz", opciones: VOCES })}
          {Opciones({ n: "Modelo_OpenAI_LucidSales", label: "Modelo IA", opciones: MODELOS })}
        </div>
        {SiNo({ n: "Dividir_texto_LucidSales", label: "Dividir texto", desc: "Manda varios mensajes cortos en vez de uno largo" })}
        {SiNo({ n: "Agrupar_mensajes_LucidSales", label: "Agrupar texto", desc: "Espera mensajes seguidos antes de responder" })}
        <div className="ct-opcion">
          <div>
            <div className="ct-opcion-titulo">
              Tiempo de recepción {Falta({ n: "Tiempo_recepcion_mensajes_LucidSales" })}
            </div>
            <div className="muted small">Segundos durante los que se agrupan los mensajes del cliente</div>
          </div>
          <input
            type="number"
            min={0}
            style={{ width: 90 }}
            aria-label="Tiempo de recepción (segundos)"
            value={v("Tiempo_recepcion_mensajes_LucidSales")}
            disabled={!hay.has("Tiempo_recepcion_mensajes_LucidSales")}
            onChange={(x) => poner("Tiempo_recepcion_mensajes_LucidSales", x.target.value)}
          />
        </div>
        {SiNo({ n: "Enviar saludo en audio personalizado", label: "Saludo en audio", desc: "Nota de voz personalizada al saludar" })}
      </Seccion>

      <Seccion n="03" titulo="Métodos de pago" desc="Opciones que el bot ofrece al cliente al cerrar la compra.">
        {Falta({ n: CUENTAS })}
        {cuentas.map((c, i) => (
          <div className="ct-fila" key={i}>
            <input aria-label="Nombre del banco o método" placeholder="Nombre del banco (o «Contra Entrega»)" value={c.nombreBanco ?? ""} disabled={!hay.has(CUENTAS)} onChange={(x) => ponerCuentas(cuentas.map((y, j) => (j === i ? { ...y, nombreBanco: x.target.value } : y)))} />
            <input aria-label="Número de cuenta" placeholder="Número de cuenta" value={c.numeroCuenta ?? ""} disabled={!hay.has(CUENTAS)} onChange={(x) => ponerCuentas(cuentas.map((y, j) => (j === i ? { ...y, numeroCuenta: x.target.value } : y)))} />
            <button type="button" className="btn sm" aria-label="Quitar" disabled={!hay.has(CUENTAS)} onClick={() => ponerCuentas(cuentas.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" disabled={!hay.has(CUENTAS)} onClick={() => ponerCuentas([...cuentas, { nombreBanco: "", numeroCuenta: "" }])}>
            + Agregar método
          </button>
          {!cuentas.some((c) => /contra\s*entrega/i.test(c.nombreBanco ?? "")) ? (
            <button type="button" className="btn sm" disabled={!hay.has(CUENTAS)} onClick={() => ponerCuentas([...cuentas, { nombreBanco: "Contra Entrega", numeroCuenta: "" }])}>
              + Contra entrega
            </button>
          ) : null}
        </div>
      </Seccion>

      <Seccion n="04" titulo="Conocimiento" desc="Lo que el bot sabe responder.">
        {JsonLibre({ n: "Preguntas_frecuentes_LucidSales", label: "Preguntas frecuentes" })}
        {JsonLibre({ n: "Preguntas_frecuentes_posventa_LucidSales", label: "Preguntas frecuentes post-venta" })}
      </Seccion>

      <Seccion n="05" titulo="Reglas" desc="Condiciones bajo las cuales el bot hace o no hace algo.">
        {JsonLibre({ n: "Reglas_adicionales2_LucidSales", label: "Reglas de venta" })}
        {JsonLibre({ n: "Reglas_adicionales_Postventa", label: "Reglas post-venta" })}
      </Seccion>

      <Seccion n="06" titulo="Notificaciones" desc="Quién recibe aviso por WhatsApp de cada evento.">
        {Falta({ n: NOTI })}
        {eventos.map((ev) => {
          const tels = noti[ev]?.telefonos ?? [];
          return (
            <div key={ev} className="ct-evento">
              <div className="ct-opcion-titulo">{EVENTOS[ev] ?? ev}</div>
              {tels.map((t, i) => (
                <div className="ct-fila" key={i}>
                  <input aria-label="Nombre" placeholder="Nombre" value={t.nombre ?? ""} disabled={!hay.has(NOTI)} onChange={(x) => ponerNoti(ev, tels.map((y, j) => (j === i ? { ...y, nombre: x.target.value } : y)))} />
                  <input aria-label="WhatsApp" placeholder="+573001234567" inputMode="tel" value={t.numero ?? ""} disabled={!hay.has(NOTI)} onChange={(x) => ponerNoti(ev, tels.map((y, j) => (j === i ? { ...y, numero: x.target.value.trim() } : y)))} />
                  <button type="button" className="btn sm" aria-label="Quitar" disabled={!hay.has(NOTI)} onClick={() => ponerNoti(ev, tels.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="btn sm" disabled={!hay.has(NOTI)} onClick={() => ponerNoti(ev, [...tels, { nombre: "", numero: "" }])}>
                + Agregar contacto
              </button>
            </div>
          );
        })}
      </Seccion>

      <Seccion n="07" titulo="Mensajes automáticos" desc="Lo que el bot envía en momentos clave.">
        {Texto({ n: "Mensaje_Organico_LucidSales", label: "Mensaje inicial orgánico", filas: 4, ph: "Cuando el bot saluda y aún no sabe qué producto le interesa al cliente" })}
        {(["Con_Recaudo_LucidSales", "Sin_Recaudo_LucidSales"] as const).map((n) => (
          <div className="field" key={n}>
            <label htmlFor={`ct-${n}`}>
              {n.startsWith("Con") ? "Agradecimiento con recaudo (contra entrega)" : "Agradecimiento sin recaudo (pago anticipado)"} {Falta({ n: n })}
            </label>
            <textarea id={`ct-${n}`} rows={5} value={textoDeMensajes(v(n))} disabled={!hay.has(n)} onChange={(x) => poner(n, mensajesDeTexto(x.target.value, v(n)))} />
            <span className="campo-ayuda">Palabras clave: {"{{first_name}}"}, {"{{last_name}}"}, {"{{full_name}}"}, {"{{Ciudad}}"}, {"{{Total a pagar}}"}, {"{{Producto_Ordenados}}"}</span>
          </div>
        ))}
      </Seccion>

      {otros.length ? (
        <details className="ct-seccion" open={otrosAbiertos} onToggle={(x) => setOtrosAbiertos((x.target as HTMLDetailsElement).open)}>
          <summary className="ct-titulo" style={{ cursor: "pointer" }}>
            Otros campos del bot ({otros.length})
          </summary>
          <p className="muted small">Tiempos, país, llamadas, integraciones… tal como los guarda LucidSales.</p>
          {otros.map((n) => (
            <div className="field" key={n}>
              <label htmlFor={`ct-${n}`}>{n}</label>
              <textarea id={`ct-${n}`} rows={(v(n).length > 120 ? 4 : 1)} value={v(n)} onChange={(x) => poner(n, x.target.value)} />
            </div>
          ))}
        </details>
      ) : null}

      <div className="ct-guardar">
        <button type="button" className="btn primary" disabled={ocupado} onClick={onGuardar}>
          💾 Guardar configuración de {nombreTienda || "la nueva tienda"}
        </button>
        <span className="muted small">Se guarda y se escribe de una vez en el bot nuevo.</span>
      </div>
    </div>
  );
}
