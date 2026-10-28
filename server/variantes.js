// Variantes de un producto de LucidSales (color, talla...).
//
// La linea del pedido trae `variation_id`, que es el `sku` de una combinacion
// en `mixedvariantes` (p. ej. ["Blanca", "150 cm"]). Los nombres de los
// atributos estan en `variantes` ("Copa", "Tamaño") y el id de esa misma
// combinacion en Dropi en `bundleVariantes[].variantes[].idVarianteDropi`.

const igual = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const mismosItems = (a = [], b = []) => a.length === b.length && a.every((x, i) => igual(x, b[i]));

/**
 * producto: el de LucidSales (get-producto). variationId: el de la linea.
 * -> { id, items, nombre: "Copa: Blanca; Tamaño: 150 cm", idVarianteDropi, stock } | null
 */
export function varianteDeProducto(producto, variationId) {
  const id = String(variationId ?? "").trim();
  if (!producto || !id) return null;
  const mixta = (Array.isArray(producto.mixedvariantes) ? producto.mixedvariantes : []).find((m) => String(m?.sku ?? "") === id);
  if (!mixta) return null;
  const items = (Array.isArray(mixta.items) ? mixta.items : []).map((x) => String(x ?? "").trim());
  const atributos = (Array.isArray(producto.variantes) ? producto.variantes : []).map((v) => String(v?.nombre ?? "").trim());
  const nombre = items.map((x, i) => (atributos[i] ? `${atributos[i]}: ${x}` : x)).join("; ");
  let enDropi = null;
  for (const b of Array.isArray(producto.bundleVariantes) ? producto.bundleVariantes : []) {
    enDropi = (Array.isArray(b?.variantes) ? b.variantes : []).find((v) => mismosItems(v?.items ?? [], items));
    if (enDropi) break;
  }
  const idDropi = enDropi?.idVarianteDropi;
  return {
    id,
    items,
    nombre,
    idVarianteDropi: idDropi !== null && idDropi !== undefined && String(idDropi).trim() !== "" ? String(idDropi) : null,
    stock: Number.isFinite(Number(enDropi?.stock)) ? Number(enDropi.stock) : null,
  };
}
