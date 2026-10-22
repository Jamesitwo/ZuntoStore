import { useStockProducto } from "../lib/catalogo";

/**
 * Chip con el **stock real** del producto elegido en la linea del pedido.
 *
 * El `stock` de LucidSales no es el de verdad (producto real con `stock: 0`
 * mientras Dropi marcaba 948), asi que se lee de Dropi:
 * `idProductoDropi` (fila del catalogo o `getproducto/{id}`) ->
 * `validateDropiId/{id}` -> `product.stock`. Cacheado: una llamada por
 * producto, compartida entre lineas y paginas.
 */
export function StockDropi({ productId, fila }: { productId: string; fila?: any }) {
  const { cargando, idDropi, stock } = useStockProducto(productId, fila);
  if (!productId) return null;

  if (cargando) {
    return (
      <span className="stock-dropi cargando" title="Leyendo el stock en Dropi">
        Stock Dropi…
      </span>
    );
  }

  if (!idDropi) {
    return (
      <span className="stock-dropi" title="Este producto no está vinculado a Dropi">
        Sin Dropi
      </span>
    );
  }

  if (stock === null) {
    return (
      <span className="stock-dropi" title={`Dropi ${idDropi}: sin dato de stock`}>
        Stock Dropi: —
      </span>
    );
  }

  return (
    <span
      className={`stock-dropi ${stock > 0 ? "ok" : "no"}`}
      title={`Producto ${idDropi} en Dropi`}
    >
      Stock Dropi: {stock.toLocaleString("es-CO")}
      {stock > 0 ? "" : " · agotado"}
    </span>
  );
}
