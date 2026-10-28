// Lineas de producto de un pedido de LucidSales (campo `Json`).
//
// Un producto sin variantes trae precio y cantidad en la linea:
//   {product_id, price: 84900, quantity: 1, variations: []}
// Un producto CON variantes los trae en cada variante y la linea va en null:
//   {product_id, price: null, quantity: null,
//    variations: [{variation_id, price: 116900, quantity: 2}]}
import { num } from "./format";

export interface Variante {
  variation_id?: string;
  price?: number | string | null;
  quantity?: number | string | null;
  [k: string]: unknown;
}

/** ¿La linea lleva precio y cantidad en sus variantes? */
export function tieneVariantes(it: any): boolean {
  return (
    Array.isArray(it?.variations) &&
    it.variations.length > 0 &&
    it.variations.some((v: any) => v && (v.price !== undefined || v.quantity !== undefined))
  );
}

/** Unidades de la linea (suma de sus variantes si las tiene). */
export function cantidadLinea(it: any): number {
  if (tieneVariantes(it)) return it.variations.reduce((a: number, v: Variante) => a + num(v?.quantity, 1), 0);
  return num(it?.quantity, 1);
}

/** Valor de la linea (precio x cantidad, de cada variante si las tiene). */
export function totalLinea(it: any): number {
  if (tieneVariantes(it)) return it.variations.reduce((a: number, v: Variante) => a + num(v?.price) * num(v?.quantity, 1), 0);
  return num(it?.price) * num(it?.quantity, 1);
}

/**
 * Nombre de cada variante, sacado de las observaciones que pone LucidSales al
 * crear el pedido ("2 x Árbol De Navidad Plegable - Copa: Blanca; Tamaño: 150 cm").
 * Devuelve los nombres en el orden en que aparecen.
 */
export function nombresDeVariantes(obs: any[]): string[] {
  const out: string[] = [];
  for (const o of Array.isArray(obs) ? obs : []) {
    const m = String(o?.desc ?? "").match(/^\s*\d+\s*x\s+.+?\s+-\s+(.+:.+)$/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}
