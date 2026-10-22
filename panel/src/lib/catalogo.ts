// Catalogo de productos de la tienda (LucidSales) compartido por
// PedidoCrearPage y PedidoDetallePage para los desplegables de producto.

import { useEffect, useState } from "react";
import { errMsg, pickArray } from "../api/client";
import { productos } from "../api/endpoints";

export function prodId(p: any): string {
  return String(p?.product_id ?? p?.id ?? p?.ID ?? p?.Id ?? "");
}

export function prodName(p: any): string {
  return String(p?.Nombre ?? p?.name ?? p?.title ?? p?.product_name ?? prodId(p));
}

export function prodPrice(p: any): number {
  const direct = p?.price ?? p?.precio ?? p?.Precio ?? p?.valor;
  if (direct !== undefined && direct !== null && !Number.isNaN(Number(direct))) return Number(direct);
  const variant = p?.variants?.[0]?.price;
  if (variant !== undefined && !Number.isNaN(Number(variant))) return Number(variant);
  return 0;
}

/**
 * Imagen del producto. El catalogo llega en varios shapes y el panel oficial
 * los mezcla:
 *  - nativo LucidSales: `imagenes: [{image: "https://…"}]`
 *    (el oficial hace `e.imagenes[0].image`; la respuesta real trae ademas
 *    `star`, `type`, `chosen`, `selected` en cada entrada)
 *  - con nombre de archivo suelto: `images: ["abc.jpg"]` y el oficial arma
 *    `https://tendyc.com/upload/productos/{idEmpresa}/{id}/{archivo}`
 *  - shopify/dropi: `image: {url}` | `images: [{url}]` | `featured_image`
 * Devuelve "" si no hay imagen utilizable (el combo no pinta nada).
 */
function candidatosImagen(p: any): any[] {
  const lista: any[] = [];
  if (Array.isArray(p?.imagenes)) lista.push(...p.imagenes);
  if (Array.isArray(p?.images)) lista.push(...p.images);
  for (const k of ["image", "imagen", "Imagen", "featured_image", "thumbnail", "Thumbnail"]) {
    if (p && p[k] != null) lista.push(p[k]);
  }
  return lista;
}

function urlImagen(c: any, p: any): string {
  const v = typeof c === "string" ? c : (c?.image ?? c?.url ?? c?.src ?? "");
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t || t === "null" || t === "undefined" || t === "[object Object]") return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//")) return `https:${t}`;
  if (t.startsWith("/")) return t; // relativa al origen
  if (/^data:image\//i.test(t)) return t;
  if (/^[\w.\- ()]+$/.test(t)) {
    const idEmp = p?.idEmpresa ?? p?.IdEmpresa;
    const id = prodId(p);
    if (idEmp && id) return `https://tendyc.com/upload/productos/${idEmp}/${id}/${t}`;
  }
  return "";
}

export function prodImg(p: any): string {
  for (const c of candidatosImagen(p)) {
    const u = urlImagen(c, p);
    if (u) return u;
  }
  return "";
}

/** Todas las imagenes utilizables (el producto real puede traer varias). */
export function prodImgs(p: any): string[] {
  const out: string[] = [];
  for (const c of candidatosImagen(p)) {
    const u = urlImagen(c, p);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** Carga POST /productos/getproductos de la tienda activa. */
export function useCatalogo(idEmpresa: number) {
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    productos
      .list(idEmpresa)
      .then((res) => {
        if (!cancel) setCatalogo(pickArray(res, ["productos", "products", "data"]));
      })
      .catch((err) => {
        if (!cancel) setError(`Catalogo no disponible: ${errMsg(err)}`);
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [idEmpresa]);

  return { catalogo, cargando, error };
}

/* ------------------------------------------------------------------ */
/*  Stock real (Dropi) del producto seleccionado en un pedido          */
/* ------------------------------------------------------------------ */

export interface StockProducto {
  cargando: boolean;
  /** id del producto EN Dropi (null si no esta vinculado). */
  idDropi: string | null;
  /** stock real en Dropi; null = sin dato. */
  stock: number | null;
}

const SIN_DATO: StockProducto = { cargando: false, idDropi: null, stock: null };
const cacheStock = new Map<string, StockProducto>();
const enCurso = new Map<string, Promise<StockProducto>>();

/**
 * Stock real del producto: el campo `stock` de LucidSales no es el de
 * verdad (en el producto real vale 0 mientras Dropi marca 948), asi que
 * se lee de Dropi:
 *
 *   1. `idProductoDropi` de la fila del catalogo (si la trae)
 *   2. si no, `GET /productos/getproducto/{id}` (una vez por producto)
 *   3. `GET /productos/validateDropiId/{id}` -> product.stock
 *
 * Todo se cachea en memoria (una llamada por producto, tambien entre
 * paginas y entre lineas del mismo pedido).
 */
export function useStockProducto(productId: string, fila?: any): StockProducto {
  const idDropiFila =
    fila && fila.idProductoDropi && String(fila.idProductoDropi) !== "0"
      ? String(fila.idProductoDropi)
      : "";
  const clave = String(productId ?? "").trim();

  const [estado, setEstado] = useState<StockProducto>(
    () => cacheStock.get(clave) ?? { cargando: !!clave, idDropi: null, stock: null },
  );

  useEffect(() => {
    if (!clave) {
      setEstado(SIN_DATO);
      return;
    }
    const guardado = cacheStock.get(clave);
    if (guardado) {
      setEstado(guardado);
      return;
    }

    let cancel = false;
    setEstado({ cargando: true, idDropi: null, stock: null });

    const promesa = (enCurso.get(clave) ??
      (async (): Promise<StockProducto> => {
        try {
          let idDropi = idDropiFila;
          if (!idDropi) {
            const f: any = await productos.get(clave);
            const p = f?.product ?? f?.producto ?? f?.data;
            idDropi = p?.idProductoDropi && String(p.idProductoDropi) !== "0"
              ? String(p.idProductoDropi)
              : "";
          }
          if (!idDropi) {
            cacheStock.set(clave, SIN_DATO);
            return SIN_DATO;
          }
          const d: any = await productos.validateDropiId(idDropi);
          const n = d?.ok && d?.product ? Number(d.product.stock) : NaN;
          const r: StockProducto = {
            cargando: false,
            idDropi,
            stock: Number.isNaN(n) ? null : n,
          };
          cacheStock.set(clave, r);
          return r;
        } catch {
          // sin dato y sin reintentar en cada montaje
          cacheStock.set(clave, SIN_DATO);
          return SIN_DATO;
        }
      })());

    enCurso.set(clave, promesa);
    promesa.then((r) => {
      enCurso.delete(clave);
      if (!cancel) setEstado(r);
    });
    return () => {
      cancel = true;
    };
  }, [clave, idDropiFila]);

  return estado;
}
