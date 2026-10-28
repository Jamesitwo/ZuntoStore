// Variantes (color, talla...) de un producto de LucidSales, para elegirlas en
// las lineas de un pedido. El catalogo no las trae: se pide la ficha del
// producto (una vez por producto) y se guarda en memoria.
//
// Combinacion = `mixedvariantes[i]` ({items: ["Blanca","150 cm"], sku}); su
// `sku` es el `variation_id` que va en la linea del pedido. Los nombres de los
// atributos estan en `variantes[].nombre` y el precio/stock/variante de Dropi
// de cada combinacion en `bundleVariantes[].variantes[]`.
import { useEffect, useState } from "react";
import { productos } from "../api/endpoints";
import { num } from "./format";

export interface OpcionVariante {
  sku: string; // = variation_id de la linea
  nombre: string; // "Copa: Blanca; Tamaño: 150 cm"
  corto: string; // "Blanca / 150 cm"
  precio: number | null; // precio sugerido de esa combinacion (si lo tiene)
  stock: number | null;
  idVarianteDropi: string | null;
}

const arreglo = (v: unknown): any[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};
const igual = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Ficha del producto -> combinaciones que se pueden elegir. */
export function opcionesVariantes(prod: any): OpcionVariante[] {
  const atributos = arreglo(prod?.variantes).map((v) => String(v?.nombre ?? "").trim());
  const bundle = arreglo(prod?.bundleVariantes).flatMap((b) => arreglo(b?.variantes));
  return arreglo(prod?.mixedvariantes)
    .filter((m) => m?.sku)
    .map((m) => {
      const items = arreglo(m.items).map((x) => String(x ?? "").trim());
      const b = bundle.find((v) => {
        const its = arreglo(v?.items);
        return its.length === items.length && its.every((x, i) => igual(x, items[i]));
      });
      const precio = num(b?.precioSugerido) || num(m?.precioSugerido) || null;
      const idDropi = b?.idVarianteDropi;
      return {
        sku: String(m.sku),
        nombre: items.map((x, i) => (atributos[i] ? `${atributos[i]}: ${x}` : x)).join("; "),
        corto: items.join(" / "),
        precio,
        stock: b?.stock !== undefined && b?.stock !== null && !Number.isNaN(Number(b.stock)) ? Number(b.stock) : null,
        idVarianteDropi: idDropi !== null && idDropi !== undefined && String(idDropi).trim() !== "" ? String(idDropi) : null,
      };
    });
}

const cache = new Map<string, Promise<OpcionVariante[]>>();

function cargar(id: string): Promise<OpcionVariante[]> {
  let p = cache.get(id);
  if (!p) {
    p = productos
      .get(id)
      .then((r: any) => opcionesVariantes(r?.producto ?? r?.product ?? r))
      .catch(() => {
        cache.delete(id); // se reintenta la proxima vez
        return [];
      });
    cache.set(id, p);
  }
  return p;
}

/** Variantes de varios productos a la vez: { [product_id]: opciones } */
export function useVariantesProductos(ids: string[]) {
  const clave = [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))].sort().join(",");
  const [mapa, setMapa] = useState<Record<string, OpcionVariante[]>>({});
  useEffect(() => {
    let cancel = false;
    for (const id of clave ? clave.split(",") : []) {
      void cargar(id).then((ops) => {
        if (!cancel) setMapa((m) => (m[id] === ops ? m : { ...m, [id]: ops }));
      });
    }
    return () => {
      cancel = true;
    };
  }, [clave]);
  return mapa;
}

/** Texto de una opcion para el desplegable. */
export function etiquetaVariante(o: OpcionVariante) {
  const extra = [
    o.stock !== null ? `stock ${o.stock}` : null,
    o.idVarianteDropi ? null : "sin variante en Dropi",
  ].filter(Boolean);
  return `${o.corto}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}
