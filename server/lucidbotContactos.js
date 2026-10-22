// Notifica a Lucid Bot el resultado de cada intento de subida a Dropi.
//
// El aviso va al contacto del ADMIN (adminPhone), nunca al cliente: los datos
// del pedido y del cliente viajan solo dentro de los campos personalizados
// (set_field_value) para dar contexto al flujo que le escribe al admin.
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";
import { normalizarMensajes, parsearTranscripcion } from "./conversacion.js";

const DEFECTO = {
  activo: false,
  token: "",
  adminPhone: "",
  summaryField: "resumen_dropi",
  conversationFieldId: "",
  tagName: "",
  flowId: "",
  fields: [],
};

function normalizarTelefono(valor) {
  const original = String(valor ?? "").trim();
  const digitos = original.replace(/\D/g, "");
  if (!digitos) return "";
  if (original.startsWith("+")) return `+${digitos}`;
  if (digitos.startsWith("57") && digitos.length >= 12) return `+${digitos}`;
  if (digitos.length === 10) return `+57${digitos}`;
  return `+${digitos}`;
}

function textoSeguro(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}

function idContactoDesdeEnlace(enlace) {
  const texto = textoSeguro(enlace, 2000);
  if (!texto) return "";
  try {
    const url = new URL(texto);
    return textoSeguro(url.searchParams.get("id"), 80).replace(/[^\d]/g, "");
  } catch {
    const coincidencia = texto.match(/[?&]id=([^&#]+)/i);
    if (!coincidencia) return "";
    try {
      return decodeURIComponent(coincidencia[1]).replace(/[^\d]/g, "");
    } catch {
      return "";
    }
  }
}

export function crearLucidBotContactos({ ruta, fetcher = fetch, timeoutMs = 12000 } = {}) {
  const archivo = ruta ?? path.join(process.cwd(), "config", "lucidbot-contactos.json");

  function leer() {
    try {
      const v = JSON.parse(fs.readFileSync(archivo, "utf8"));
      return {
        ...DEFECTO,
        ...v,
        conversationFieldId: v?.conversationFieldId ?? v?.summaryFieldId ?? "",
        fields: Array.isArray(v?.fields) ? v.fields : [],
      };
    } catch {
      return { ...DEFECTO };
    }
  }

  function guardar(c) {
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      const tmp = `${archivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, archivo);
      return true;
    } catch (e) {
      throw new ErrorApi(500, `No se pudo guardar la configuración de Lucid Bot: ${e?.message ?? e}`);
    }
  }

  function estado() {
    const c = leer();
    const { token, ...publico } = c;
    return {
      ...publico,
      tokenConfigurado: Boolean(token),
      tokenVista: token ? `${token.slice(0, 3)}…${token.slice(-3)}` : "",
    };
  }

  function configurar(patch = {}) {
    const actual = leer();
    const siguiente = { ...actual };
    if (typeof patch.activo === "boolean") siguiente.activo = patch.activo;
    if (typeof patch.token === "string" && patch.token.trim()) siguiente.token = patch.token.trim();
    if (patch.borrarToken === true) siguiente.token = "";
    if (patch.adminPhone !== undefined) {
      const crudo = String(patch.adminPhone ?? "").trim();
      const tel = normalizarTelefono(crudo);
      if (crudo && !/^\+\d{10,15}$/.test(tel)) {
        throw new ErrorApi(400, "El teléfono del admin no es válido (usa el formato +573001234567)");
      }
      siguiente.adminPhone = tel;
    }
    if (patch.summaryField !== undefined) siguiente.summaryField = textoSeguro(patch.summaryField, 120);
    if (patch.conversationFieldId !== undefined) {
      const id = String(patch.conversationFieldId ?? "").trim();
      if (id && !/^\d+$/.test(id)) throw new ErrorApi(400, "El ID del campo con la conversación debe ser numérico");
      siguiente.conversationFieldId = id;
    }
    if (patch.tagName !== undefined) siguiente.tagName = textoSeguro(patch.tagName, 120);
    if (patch.flowId !== undefined) {
      const flow = String(patch.flowId ?? "").trim();
      if (flow && !/^\d+$/.test(flow)) throw new ErrorApi(400, "El ID del flujo debe ser numérico");
      siguiente.flowId = flow;
    }
    if (patch.fields !== undefined) {
      if (!Array.isArray(patch.fields) || patch.fields.length > 20) {
        throw new ErrorApi(400, "Configura como máximo 20 campos personalizados");
      }
      siguiente.fields = patch.fields
        .map((x) => ({ field_name: textoSeguro(x?.field_name, 120), value: textoSeguro(x?.value, 1000) }))
        .filter((x) => x.field_name);
    }
    if (siguiente.activo && !siguiente.token) throw new ErrorApi(400, "Guarda el X-ACCESS-TOKEN antes de activar las notificaciones");
    if (siguiente.activo && !siguiente.adminPhone) throw new ErrorApi(400, "Indica el teléfono del admin que recibirá los avisos");
    if (siguiente.activo && !siguiente.summaryField) throw new ErrorApi(400, "Indica el campo personalizado donde se guardará el resumen");
    guardar(siguiente);
    return estado();
  }

  async function obtenerConversacion({ pedido, chatUrl } = {}) {
    const c = leer();
    if (!c.conversationFieldId) return { ok: false, configurado: false, detalle: "No hay un ID configurado para el campo de conversación" };
    if (!c.token) return { ok: false, configurado: true, detalle: "Falta X-ACCESS-TOKEN de Lucid Bot" };
    const fuente = pedido && typeof pedido === "object" ? pedido : {};
    const phone = normalizarTelefono(fuente.Movil ?? fuente.phone ?? fuente.telefono);
    const contactId = idContactoDesdeEnlace(
      chatUrl ?? fuente.chatUrl ?? fuente.chat_url ?? fuente.inboxUrl ?? fuente.linkChat,
    ) || phone.replace(/\D/g, "");
    if (!contactId) return { ok: false, configurado: true, detalle: "No se pudo identificar el contacto desde el enlace del chat ni el teléfono" };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const response = await fetcher(
        `https://panel.lucidbot.co/api/contacts/${encodeURIComponent(contactId)}/custom_fields/${encodeURIComponent(c.conversationFieldId)}`,
        { method: "GET", signal: ctl.signal, headers: { accept: "application/json", "X-ACCESS-TOKEN": c.token } },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false || body?.isSuccess === false) {
        const reason = textoSeguro(body?.message ?? body?.msg ?? body?.detail, 300);
        return { ok: false, configurado: true, detalle: `Lucid Bot respondió HTTP ${response.status}${reason ? `: ${reason}` : ""}` };
      }

      const campos = [body, body?.data, body?.custom_field, body?.data?.custom_field];
      let valor = campos.map((x) => x?.value).find((x) => x !== undefined && x !== null);
      if (valor === undefined) {
        const listas = [body?.custom_fields, body?.data?.custom_fields, body?.data];
        for (const lista of listas) {
          if (!Array.isArray(lista)) continue;
          const campo = lista.find((x) => String(x?.id) === String(c.conversationFieldId));
          if (campo?.value !== undefined) { valor = campo.value; break; }
        }
      }
      let mensajes = [];
      if (Array.isArray(valor)) mensajes = normalizarMensajes(valor);
      else if (valor && typeof valor === "object") {
        mensajes = normalizarMensajes(valor.mensajes ?? valor.messages ?? valor.conversation ?? []);
      } else if (typeof valor === "string" && valor.trim()) {
        let decodificado = valor;
        try { decodificado = JSON.parse(valor); } catch { /* texto transcrito */ }
        if (Array.isArray(decodificado)) mensajes = normalizarMensajes(decodificado);
        else if (decodificado && typeof decodificado === "object") {
          mensajes = normalizarMensajes(decodificado.mensajes ?? decodificado.messages ?? decodificado.conversation ?? []);
        } else {
          mensajes = normalizarMensajes(parsearTranscripcion(valor));
          if (!mensajes.length) {
            const lineaConEmisor = /^(Usuario|Cliente|Bot|Agente|Asesor)(?:\s*\([^)]*\))?\s*:\s*(.*)$/i;
            const parseados = [];
            let actual = null;
            for (const linea of valor.split(/\r?\n/)) {
              const marca = linea.match(lineaConEmisor);
              if (marca) {
                actual = { de: marca[1].toLowerCase() === "bot" ? "bot" : /agente|asesor/i.test(marca[1]) ? "asesor" : "cliente", texto: marca[2].trim() };
                parseados.push(actual);
              } else if (actual && linea.trim()) {
                actual.texto += `\n${linea.trim()}`;
              }
            }
            mensajes = normalizarMensajes(parseados);
          }
        }
      }
      if (!mensajes.length) {
        // decir QUE llego, para poder corregir el formato o el campo
        let que;
        if (valor == null && body && typeof body === "object" && "value" in body && body.value == null) {
          que = `el campo ${c.conversationFieldId}${body.name ? ` («${body.name}»)` : ""} está vacío (null) para este contacto: el bot no ha guardado ahí la conversación`;
        } else if (valor === undefined || valor === null) {
          const claves = body && typeof body === "object" ? Object.keys(body).slice(0, 8).join(", ") : typeof body;
          que = `la respuesta no trae el valor del campo ${c.conversationFieldId} (claves recibidas: ${claves || "ninguna"})`;
        } else if (typeof valor === "string" && !valor.trim()) {
          que = `el campo ${c.conversationFieldId} está vacío para este contacto`;
        } else if (typeof valor === "string") {
          que = `el campo trae texto (${valor.length} caracteres) sin formato de chat reconocible; empieza: "${valor.trim().slice(0, 60)}"`;
        } else {
          que = `el campo trae un ${Array.isArray(valor) ? "arreglo" : "objeto"} sin mensajes reconocibles` +
            (Array.isArray(valor) ? ` (${valor.length} elementos)` : ` (claves: ${Object.keys(valor).slice(0, 8).join(", ")})`);
        }
        return { ok: false, configurado: true, contactId, detalle: `Conversación no legible del contacto ${contactId}: ${que}` };
      }
      return { ok: true, configurado: true, contactId, mensajes, total: mensajes.length };
    } catch (e) {
      return { ok: false, configurado: true, detalle: e?.name === "AbortError" ? "Lucid Bot no respondió antes del timeout" : `No se pudo traer la conversación: ${e?.message ?? e}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function notificar({ pedido, resultado, detalle, idDropi, motivos, via = "Dropi" } = {}) {
    const c = leer();
    if (!c.activo || !c.token) return { ok: false, omitido: true, detalle: "Notificaciones de Lucid Bot desactivadas o sin token" };

    // destinatario: el admin. El cliente solo aparece en los valores.
    const adminPhone = normalizarTelefono(c.adminPhone);
    if (!adminPhone) return { ok: false, omitido: true, detalle: "Falta el teléfono del admin para enviar el aviso" };

    const fuente = pedido && typeof pedido === "object" ? pedido : {};
    const phone = normalizarTelefono(fuente.Movil ?? fuente.phone ?? fuente.telefono);
    const firstName = textoSeguro(fuente.Nombre ?? fuente.first_name, 120);
    const lastName = textoSeguro(fuente.Apellido ?? fuente.last_name, 120);
    const email = textoSeguro(fuente.Correo ?? fuente.email, 200);
    const idPedido = textoSeguro(fuente.idPedido ?? fuente.id, 80);

    const estado = textoSeguro(resultado || "fallido", 80);
    const resumen = [
      `${via}: ${estado.toUpperCase()}`,
      idPedido ? `Pedido #${idPedido}` : "",
      idDropi ? `ID Dropi #${idDropi}` : "",
      firstName || lastName ? `Cliente: ${[firstName, lastName].filter(Boolean).join(" ")}` : "",
      phone ? `Tel. cliente: ${phone}` : "",
      detalle ? `Detalle: ${textoSeguro(detalle, 900)}` : "",
      Array.isArray(motivos) && motivos.length ? `Motivos: ${motivos.map((m) => typeof m === "string" ? m : `${m?.campo ?? ""}: ${m?.detalle ?? ""}`).join("; ").slice(0, 900)}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1800);

    const sustituir = (v) => textoSeguro(v, 1000)
      .replaceAll("{{resumen}}", resumen)
      .replaceAll("{{resultado}}", estado)
      .replaceAll("{{pedido}}", idPedido)
      .replaceAll("{{idDropi}}", String(idDropi ?? ""))
      .replaceAll("{{phone}}", phone)
      .replaceAll("{{first_name}}", firstName)
      .replaceAll("{{last_name}}", lastName)
      .replaceAll("{{email}}", email)
      .replaceAll("{{cliente}}", [firstName, lastName].filter(Boolean).join(" "));

    const actions = [];
    if (c.summaryField) actions.push({ action: "set_field_value", field_name: c.summaryField, value: resumen });
    for (const f of c.fields) {
      if (f?.field_name) actions.push({ action: "set_field_value", field_name: f.field_name, value: sustituir(f.value) });
    }
    if (c.tagName) actions.push({ action: "add_tag", tag_name: c.tagName });
    if (c.flowId) actions.push({ action: "send_flow", flow_id: Number(c.flowId) });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const response = await fetcher("https://panel.lucidbot.co/api/contacts", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "X-ACCESS-TOKEN": c.token },
        // solo el telefono del admin: mandar nombre o correo del cliente aqui
        // sobrescribiria los datos del contacto del admin en Lucid Bot
        body: JSON.stringify({ phone: adminPhone, actions }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false || body?.isSuccess === false) {
        const reason = textoSeguro(body?.message ?? body?.msg ?? body?.detail, 300);
        return { ok: false, detalle: `Lucid Bot respondió HTTP ${response.status}${reason ? `: ${reason}` : ""}` };
      }
      return { ok: true, detalle: "Aviso enviado al admin por Lucid Bot", respuesta: body };
    } catch (e) {
      return { ok: false, detalle: e?.name === "AbortError" ? "Lucid Bot no respondió antes del timeout" : `No se pudo contactar Lucid Bot: ${e?.message ?? e}` };
    } finally {
      clearTimeout(timer);
    }
  }

  return { estado, configurar, notificar, obtenerConversacion };
}
