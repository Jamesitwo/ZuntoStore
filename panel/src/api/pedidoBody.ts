import { num } from "../lib/format";

/** Convierte los campos JSON-string del pedido en arreglos utiles. */
export function parseArray(v: unknown): any[] {
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

/**
 * Construye el body exacto de POST /pedidos/update a partir de un pedido
 * crudo (el mismo shape que devuelve get-pedido-by-id), aplicando overrides.
 * Usado por las acciones rapidas de la lista y por el detalle.
 */
export function buildUpdateBody(
  p: any,
  overrides: {
    EstadoPedido?: number;
    motivo?: string;
    Observaciones?: any[];
    Json?: any[];
    extra?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const obs = overrides.Observaciones ?? parseArray(p.Observaciones);
  const lineas = overrides.Json ?? parseArray(p.Json);

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
    EstadoPedido: overrides.EstadoPedido ?? num(p.EstadoPedido),
    Json: JSON.stringify(lineas),
    SubTotal: p.SubTotal ?? "0.00",
    CostoEnvio: p.CostoEnvio ?? "0.00",
    Total: p.Total ?? "0.00",
    TipoPago: num(p.TipoPago),
    EstadoPago: num(p.EstadoPago),
    logistic: String(p.logistic ?? ""),
    Referencias: String(p.Referencias ?? ""),
    ...(overrides.motivo ? { motivo: overrides.motivo } : {}),
    ...(overrides.extra ?? {}),
  };
}
