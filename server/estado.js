// Logica del cambio de estado: validacion, cuerpo del update y orquestacion.
// El cuerpo es una copia fiel de panel/src/api/pedidoBody.ts (el mismo que
// envia el panel oficial), solo que aqui se aplica el override de estado.
import { ErrorApi, validacion } from "./errores.js";

/** Espejo de ESTADOS_PEDIDO (doc 2.5). */
export const ESTADOS_PEDIDO = {
  0: "Por confirmar",
  1: "Cancelado",
  2: "Confirmado",
  3: "Modificado",
  4: "En Transito",
  5: "En Reparto",
  6: "Entregado",
  7: "Devuelto",
  8: "En Novedad",
  9: "Novedad Solucionada",
};

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** Convierte los campos JSON-string del pedido en arreglos utiles. */
export function parseArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Valida la peticion; lanza ErrorApi(400) si algo no cuadra. */
export function validarCambio({ estado, motivo } = {}) {
  // ojo: Number("") y Number(null) dan 0, hay que descartarlos a mano
  let crudo;
  if (typeof estado === "number") {
    crudo = estado;
  } else if (typeof estado === "string" && estado.trim() !== "") {
    crudo = Number(estado.trim());
  } else {
    crudo = NaN;
  }
  if (!Number.isInteger(crudo) || crudo < 0 || crudo > 9) {
    throw validacion(
      `Estado invalido: ${JSON.stringify(estado)}. Debe ser un entero entre 0 y 9 (ver doc 2.5).`,
    );
  }
  const motivoLimpio = motivo === undefined || motivo === null ? "" : String(motivo).trim();
  if (crudo === 1 && !motivoLimpio) {
    throw validacion("Al cancelar un pedido el campo 'motivo' es obligatorio.");
  }
  if (motivoLimpio.length > 400) {
    throw validacion("El 'motivo' no puede superar los 400 caracteres.");
  }
  return { estado: crudo, motivo: motivoLimpio };
}

/** Cuerpo exacto de POST /pedidos/update (doc 2.7) con el estado aplicado. */
export function construirBody(p, { estado, motivo } = {}) {
  const obs = parseArray(p.Observaciones);
  const lineas = parseArray(p.Json);

  return {
    id: num(p.id),
    idPedido: num(p.idPedido),
    idEmpresa: num(p.idEmpresa),
    Nombre: String(p.Nombre ?? ""),
    Apellido: String(p.Apellido ?? ""),
    NIT: String(p.NIT ?? ""),
    Correo: String(p.Correo ?? ""),
    Movil: String(p.Movil ?? ""),
    Direccion: String(p.Direccion ?? ""),
    verifiedAddress: String(p.verifiedAddress ?? ""),
    Pais: num(p.Pais),
    codigoPostal: String(p.codigoPostal ?? ""),
    Departamento: num(p.Departamento),
    Ciudad: num(p.Ciudad),
    Observaciones: JSON.stringify(obs),
    EstadoPedido: estado === undefined ? num(p.EstadoPedido) : estado,
    Json: JSON.stringify(lineas),
    SubTotal: p.SubTotal ?? "0.00",
    CostoEnvio: p.CostoEnvio ?? "0.00",
    Total: p.Total ?? "0.00",
    TipoPago: num(p.TipoPago),
    EstadoPago: num(p.EstadoPago),
    logistic: String(p.logistic ?? ""),
    Referencias: String(p.Referencias ?? ""),
    ...(motivo ? { motivo } : {}),
  };
}

/**
 * Cambia el estado de un pedido en LucidSales.
 * Devuelve el resumen para responder y registrar.
 */
export async function cambiarEstado({ cliente, id, estado, motivo, soloDesde, tienda }) {
  const { estado: nuevo, motivo: motivoLimpio } = validarCambio({ estado, motivo });

  const pedido = await cliente.obtenerPedido(id, tienda);
  const anterior = num(pedido.EstadoPedido);

  if (anterior === nuevo) {
    return {
      sinCambios: true,
      id: num(pedido.id),
      idPedido: num(pedido.idPedido),
      idEmpresa: num(pedido.idEmpresa),
      estadoAnterior: anterior,
      estadoNuevo: nuevo,
      nombreEstado: ESTADOS_PEDIDO[nuevo],
      msg: `El pedido ya estaba en "${ESTADOS_PEDIDO[nuevo]}"`,
    };
  }

  if (Array.isArray(soloDesde) && !soloDesde.map(Number).includes(anterior)) {
    return {
      sinCambios: true,
      noActualizado: true,
      id: num(pedido.id),
      idPedido: num(pedido.idPedido),
      idEmpresa: num(pedido.idEmpresa),
      estadoAnterior: anterior,
      estadoNuevo: anterior,
      nombreEstado: ESTADOS_PEDIDO[anterior],
      msg: `El pedido cambió a "${ESTADOS_PEDIDO[anterior] ?? anterior}"; se conservó ese estado para no retrocederlo.`,
    };
  }

  const body = construirBody(pedido, { estado: nuevo, motivo: motivoLimpio });
  const res = await cliente.actualizarPedido(body, num(pedido.idEmpresa) || undefined);

  return {
    sinCambios: false,
    id: num(pedido.id),
    idPedido: num(pedido.idPedido),
    idEmpresa: num(pedido.idEmpresa),
    estadoAnterior: anterior,
    estadoNuevo: nuevo,
    nombreEstado: ESTADOS_PEDIDO[nuevo],
    msg: res?.msg || "Pedido actualizado",
  };
}

/** Mensaje corto para errores de LucidSales. */
export function mensajeDeError(err) {
  if (err instanceof ErrorApi) return err;
  return new ErrorApi(500, err?.message ?? "Error interno");
}
