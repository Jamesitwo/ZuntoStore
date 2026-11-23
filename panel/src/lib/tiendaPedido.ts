// ¿De que tienda es una venta? Zunto o la segunda tienda (Día Uno): sale de
// los productos asignados a la segunda tienda (Ajustes > Segunda tienda).
import { useEffect, useState } from "react";
import { backendSuave } from "../api/backend";

const norm = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

let cache: { nombre: string; productos: string[] } | null = null;

export function useTiendaDePedido() {
  const [d, setD] = useState(cache);
  useEffect(() => {
    if (cache) return;
    void backendSuave<any>("/api/bots-tienda").then((x) => {
      const productos = (Array.isArray(x?.productosNueva) ? x.productosNueva : []).map(norm).filter(Boolean);
      cache = { nombre: String(x?.nombre ?? "").trim() || "Segunda tienda", productos };
      setD(cache);
    });
  }, []);
  const productos = d?.productos ?? [];
  return {
    /** nombre de la segunda tienda; "" si no tiene productos asignados */
    segunda: productos.length ? d!.nombre : "",
    /** "nueva" si algun producto del pedido es de la segunda tienda */
    tiendaDe(textoProducto: unknown): "zunto" | "nueva" {
      const t = norm(textoProducto);
      return t && productos.some((n) => t.includes(n)) ? "nueva" : "zunto";
    },
  };
}
