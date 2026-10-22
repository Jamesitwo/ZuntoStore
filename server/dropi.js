// Cliente de la API de Dropi (la que usa su propio panel en app.dropi.co).
//
// Descubierta analizando los bundles de app.dropi.co. Endpoints usados:
//   POST /orders/myorders                    -> crear pedido (saveOrderV2)
//   POST /orders/cotizaEnvioTransportadoraV2 -> cotizar envio (lleva el seguro)
//
// Auth: header  x-authorization: Bearer <token>
//
// El "seguro antidevoluciones" es el campo `insurance: boolean`. Viaja en la
// cotizacion Y en la creacion del pedido. Tiene precio propio (insurancePrice)
// que descuenta de la ganancia.
//
// Captura real (pedido #93818988, 2026-10-20) confirmo:
//   POST /api/orders/myorders -> {"isSuccess":true,"message":"El registro ha
//   sido creado con exito!.","objects":{...,"status":"PENDIENTE"}}
import { ErrorApi, validacion } from "./errores.js";
import { parsearPrecio } from "./agente.js";

/** Campos que Dropi exige en saveOrderV2 (copiados de su validacion). */
export const CAMPOS_OBLIGATORIOS = [
  "name",
  "surname",
  "dir",
  "country",
  "state",
  "city",
  "phone",
  "user_id",
  "supplier_id",
  "type",
  "rate_type",
  "products",
  "distributionCompany",
  "type_service",
  "warehouses_selected_id",
];

/**
 * Arma el payload de POST /orders/myorders a partir de nuestro resumen de
 * pedido (ver resumenDePedido en agente.js) + los ids que solo existen en Dropi.
 *
 *   resumen  -> {cliente, telefono, direccion, referencias, ciudad, departamento,
 *                total, subtotal, costoEnvio, productos:[{id,nombre,cantidad,precio}]}
 *   opciones -> {userId, supplierId, shopId, warehouseId, rateType, insurance,
 *                shippingAmount, paymentMethodId, notes,
 *                distributionCompany:{id,name}, typeService,
 *                productos:[{idDropi, name, weight, stock, userId,
 *                            salePrice, suggestedPrice, variationId}]}
 */
export function armarPedidoDropi(resumen, opciones = {}) {
  const productos = (opciones.productos ?? []).map((p) => ({
    id: Number(p.idDropi),
    name: String(p.name ?? ""),
    weight: String(p.weight ?? "0"),
    stock: Number(p.stock ?? 0),
    variation_id: p.variationId ?? null,
    quantity: Number(p.quantity ?? 1),
    price: parsearPrecio(p.price) ?? 0,
    suggested_price: (parsearPrecio(p.suggestedPrice) ?? 0).toFixed(2),
    sale_price: (parsearPrecio(p.salePrice) ?? 0).toFixed(2),
    variations: Array.isArray(p.variations) ? p.variations : [],
    type: p.type ?? "SIMPLE",
    user_id: Number(p.userId ?? opciones.supplierId ?? 0),
  }));

  const nombre = String(resumen?.cliente ?? "").trim().split(/\s+/);
  const payload = {
    // parsearPrecio: en Colombia el punto es de miles ("105.690" = 105690)
    total_order: parsearPrecio(resumen?.total) ?? 0,
    notes: String(opciones.notes ?? ""),
    name: nombre[0] ?? "",
    surname: nombre.slice(1).join(" ") || (nombre[0] ?? ""),
    dir: String(resumen?.direccion ?? ""),
    country: String(opciones.country ?? "COLOMBIA"),
    state: String(resumen?.departamento ?? ""),
    city: String(resumen?.ciudad ?? ""),
    phone: String(resumen?.telefono ?? ""),
    client_email: String(opciones.clientEmail ?? ""),
    payment_method_id: Number(opciones.paymentMethodId ?? 1),
    user_id: Number(opciones.userId ?? 0),
    supplier_id: Number(opciones.supplierId ?? 0),
    type: String(opciones.type ?? "FINAL_ORDER"),
    rate_type: String(opciones.rateType ?? ""),
    products: productos,
    distributionCompany: opciones.distributionCompany
      ? {
          id: Number(opciones.distributionCompany.id),
          name: String(opciones.distributionCompany.name ?? ""),
        }
      : null,
    type_service: String(opciones.typeService ?? "normal"),
    zip_code: opciones.zipCode ?? null,
    colonia: String(opciones.colonia ?? ""),
    shop_id: opciones.shopId ?? null,
    dni: String(opciones.dni ?? ""),
    dni_type: String(opciones.dniType ?? ""),
    // EL SEGURO ANTIDEVOLUCIONES
    insurance: opciones.insurance === true,
    shalom_data: opciones.shalomData ?? null,
    warehouses_selected_id: opciones.warehouseId ?? null,
    shipping_amount: parsearPrecio(opciones.shippingAmount ?? resumen?.costoEnvio) ?? 0,
  };
  return payload;
}

/** Faltantes del payload, con el mismo mensaje que usa Dropi. */
export function validarPayloadDropi(payload) {
  for (const campo of CAMPOS_OBLIGATORIOS) {
    if (!payload?.[campo]) return `El campo "${campo}" es obligatorio.`;
  }
  if (!Array.isArray(payload.products) || payload.products.length === 0) {
    return 'El campo "products" debe traer al menos un producto.';
  }
  if (payload.insurance === true && Number(payload.distributionCompany?.id) !== 5) {
    return "El seguro antidevoluciones solo se puede enviar con Coordinadora (id 5) seleccionada.";
  }
  return null;
}

/**
 * Cliente HTTP de Dropi.
 *   crearClienteDropi(config) -> { listo, crearPedido, cotizarEnvio }
 */
export function crearClienteDropi(config = {}) {
  const base = String(config.DROPI_BASE ?? "https://api.dropi.co/api").replace(/\/+$/, "");
  const token = String(config.DROPI_TOKEN ?? "");
  const timeout = Number(config.DROPI_TIMEOUT_MS ?? 20000) || 20000;

  async function llamar(ruta, cuerpo) {
    if (!token) {
      throw new ErrorApi(503, "DROPI_TOKEN no esta configurado en server/.env");
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`${base}${ruta}`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-authorization": `Bearer ${token}`,
          // Dropi manda esta cabecera; vacia cuando no exige captcha.
          "x-captcha-token": String(config.DROPI_CAPTCHA_TOKEN ?? ""),
          origin: "https://app.dropi.co",
          referer: "https://app.dropi.co/",
        },
        body: JSON.stringify(cuerpo),
      });
      const texto = await r.text();
      let datos = null;
      try {
        datos = texto ? JSON.parse(texto) : null;
      } catch {
        datos = { raw: texto.slice(0, 500) };
      }
      return { status: r.status, datos };
    } catch (err) {
      const msg = err?.name === "AbortError" ? "Dropi tardo demasiado" : (err?.message ?? "error de red");
      throw new ErrorApi(502, `No se pudo hablar con Dropi: ${msg}`);
    } finally {
      clearTimeout(t);
    }
  }

  return {
    /** Configuracion efectiva (sin el token). */
    listo: Boolean(token),
    base,

    /**
     * POST /orders/myorders -> {isSuccess, message, objects}.
     * Lanza ErrorApi si falta un campo obligatorio o Dropi responde error.
     */
    async crearPedido(payload) {
      const falta = validarPayloadDropi(payload);
      if (falta) throw validacion(falta);
      const { status, datos } = await llamar("/orders/myorders", payload);
      if (status >= 400) {
        throw new ErrorApi(
          502,
          `Dropi rechazo el pedido: ${datos?.message ?? datos?.msg ?? `HTTP ${status}`}`,
        );
      }
      if (datos?.isSuccess !== true) {
        throw new ErrorApi(502, `Dropi no confirmó la creación: ${datos?.message ?? datos?.msg ?? "respuesta sin isSuccess=true"}`);
      }
      return datos;
    },

    /** POST /orders/cotizaEnvioTransportadoraV2 -> {isSuccess, objects:[...]} */
    async cotizarEnvio(cuerpo) {
      const { status, datos } = await llamar("/orders/cotizaEnvioTransportadoraV2", cuerpo);
      if (status >= 400) {
        throw new ErrorApi(
          502,
          `Dropi no pudo cotizar: ${datos?.message ?? datos?.feedback ?? `HTTP ${status}`}`,
        );
      }
      return datos;
    },
  };
}
