// Campos de la tienda del bot nuevo, ordenados como los Ajustes de LucidSales
// (Agente IA, Voz y modelo, Metodos de pago, Conocimiento, Reglas,
// Notificaciones, Mensajes). Cada campo vacio = no se toca en el bot nuevo.
import { useState } from "react";
import { BloquesMensaje } from "./BloquesMensaje";

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
// eventos de notificacion, con los mismos valores que usa LucidSales
const EVENTOS: Record<string, string> = {
  confirmacion_compra: "Confirmación de compra",
  cancelacion: "Cancelación",
  cambio_datos: "Cambio de datos",
  comprobante_pago: "Comprobante de pago",
  errorIa: "Error IA",
  novedad_pedido: "Novedad en el pedido",
  otra_compra: "Otra compra",
  solicitud_asesor: "Solicitud de asesor",
  garantia: "Garantía",
};

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
  // preguntas frecuentes: [{pregunta, respuesta}] (como LucidSales). Si el bot ya
  // trae otra forma, se respetan sus claves.
  const Preguntas = ({ n, label }: { n: string; label: string }) => {
    const lista = json<any[]>(v(n), []);
    const items = Array.isArray(lista) ? lista : [];
    const claves = items[0] && typeof items[0] === "object" ? Object.keys(items[0]) : ["pregunta", "respuesta"];
    const [kp, kr] = [claves.find((k) => /preg|question/i.test(k)) ?? claves[0] ?? "pregunta", claves.find((k) => /resp|answer/i.test(k)) ?? claves[1] ?? "respuesta"];
    const ponerLista = (l: any[]) => poner(n, l.length ? JSON.stringify(l) : "[]");
    return (
      <div className="field">
        <label>
          {label} {Falta({ n })}
        </label>
        {items.length ? null : <div className="ct-vacio">Aún no hay preguntas.</div>}
        {items.map((it, i) => (
          <div className="ct-pregunta" key={i}>
            <input aria-label="Pregunta" placeholder="Pregunta (ej.: ¿Hacen envíos a todo el país?)" value={String(it?.[kp] ?? "")} disabled={!hay.has(n)} onChange={(x) => ponerLista(items.map((y, j) => (j === i ? { ...y, [kp]: x.target.value } : y)))} />
            <textarea aria-label="Respuesta" rows={2} placeholder="Respuesta" value={String(it?.[kr] ?? "")} disabled={!hay.has(n)} onChange={(x) => ponerLista(items.map((y, j) => (j === i ? { ...y, [kr]: x.target.value } : y)))} />
            <button type="button" className="btn sm" aria-label="Quitar pregunta" disabled={!hay.has(n)} onClick={() => ponerLista(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" disabled={!hay.has(n)} onClick={() => ponerLista([...items, { [kp]: "", [kr]: "" }])}>
          + Agregar pregunta
        </button>
      </div>
    );
  };
  // reglas: lista de textos (como LucidSales)
  const Reglas = ({ n, label, ejemplo }: { n: string; label: string; ejemplo: string }) => {
    const lista = json<any[]>(v(n), []);
    const items = (Array.isArray(lista) ? lista : []).map((x) => (typeof x === "string" ? x : String(x?.regla ?? x?.texto ?? JSON.stringify(x))));
    const ponerLista = (l: string[]) => poner(n, JSON.stringify(l));
    return (
      <div className="field">
        <label>
          {label} {Falta({ n })}
        </label>
        {items.length ? null : <div className="ct-vacio">No hay reglas.</div>}
        {items.map((r, i) => (
          <div className="ct-regla" key={i}>
            <span className="ct-regla-num">{i + 1}</span>
            <textarea aria-label={`Regla ${i + 1}`} rows={2} placeholder={ejemplo} value={r} disabled={!hay.has(n)} onChange={(x) => ponerLista(items.map((y, j) => (j === i ? x.target.value : y)))} />
            <button type="button" className="btn sm" aria-label="Quitar regla" disabled={!hay.has(n)} onClick={() => ponerLista(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" disabled={!hay.has(n)} onClick={() => ponerLista([...items, ""])}>
          + Agregar regla
        </button>
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
        {Preguntas({ n: "Preguntas_frecuentes_LucidSales", label: "Preguntas frecuentes" })}
        {Preguntas({ n: "Preguntas_frecuentes_posventa_LucidSales", label: "Preguntas frecuentes post-venta" })}
      </Seccion>

      <Seccion n="05" titulo="Reglas" desc="Condiciones bajo las cuales el bot hace o no hace algo.">
        {Reglas({ n: "Reglas_adicionales2_LucidSales", label: "Reglas de venta", ejemplo: "Ej.: No vender en zonas sin cobertura" })}
        {Reglas({ n: "Reglas_adicionales_Postventa", label: "Reglas post-venta", ejemplo: "Ej.: Si el cliente pide la guía, compártela con el enlace de seguimiento" })}
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
        {(
          [
            ["Mensaje_Organico_LucidSales", "Mensaje inicial orgánico", "Se envía cuando el bot saluda y aún no sabe qué producto le interesa al cliente.", false],
            ["Con_Recaudo_LucidSales", "Agradecimiento con recaudo (contra entrega)", "Se envía al confirmar una orden que se paga al recibir.", true],
            ["Sin_Recaudo_LucidSales", "Agradecimiento sin recaudo (pago anticipado)", "Se envía al confirmar una orden ya pagada.", true],
          ] as const
        ).map(([n, label, ayuda, claves]) => (
          <div className="field" key={n}>
            <label>
              {label} {Falta({ n })}
            </label>
            <span className="campo-ayuda" style={{ marginTop: 0, marginBottom: 6 }}>
              {ayuda}
            </span>
            <BloquesMensaje id={`ct-${n}`} valor={v(n)} onCambio={(x) => poner(n, x)} deshabilitado={!hay.has(n)} palabrasClave={claves} />
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
