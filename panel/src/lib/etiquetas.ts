// Etiquetas de pedidos — funcion PROPIA (no existe en la API de LucidSales).
//
// Se guardan en localStorage, separadas por tienda activa:
//   zunto.etiquetas.v1 -> { [idTienda]: { etiquetas: [...], asignaciones: { [idPedido]: [ids] } } }
//
// Es un store externo (useSyncExternalStore): cualquiera que cambie etiquetas
// (lista, detalle, modales) refresca al instante al resto.

import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthContext";

export interface Etiqueta {
  id: string;
  nombre: string;
  color: string; // hex #rrggbb
}

export interface AlmacenTienda {
  etiquetas: Etiqueta[];
  /** id del pedido (p.id ?? p.idPedido) -> ids de etiquetas */
  asignaciones: Record<string, string[]>;
}

/** Paleta fija: colores legibles sobre fondo claro. */
export const PALETA = [
  "#dc2626", // rojo
  "#ea580c", // naranja
  "#d97706", // ambar
  "#16a34a", // verde
  "#0891b2", // cian
  "#2f5bea", // azul
  "#7c3aed", // morado
  "#db2777", // rosa
  "#475569", // gris azulado
];

const KEY = "zunto.etiquetas.v1";
const COLOR_POR_DEFECTO = PALETA[5];

const oyentes = new Set<() => void>();
let memoria: Record<string, AlmacenTienda> | null = null;

function cargar(): Record<string, AlmacenTienda> {
  if (memoria) return memoria;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    memoria = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    memoria = {};
  }
  return memoria!;
}

function notificar(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memoria ?? {}));
  } catch {
    /* localStorage no disponible: siguen en memoria */
  }
  oyentes.forEach((fn) => fn());
}

function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

function almacen(tienda: string): AlmacenTienda {
  const todos = cargar();
  if (!todos[tienda] || typeof todos[tienda] !== "object") {
    todos[tienda] = { etiquetas: [], asignaciones: {} };
  }
  const a = todos[tienda];
  if (!Array.isArray(a.etiquetas)) a.etiquetas = [];
  if (!a.asignaciones || typeof a.asignaciones !== "object") a.asignaciones = {};
  return a;
}

function mutar(tienda: string, fn: (a: AlmacenTienda) => AlmacenTienda): void {
  const actual = almacen(tienda);
  const copia: AlmacenTienda = {
    etiquetas: [...actual.etiquetas],
    asignaciones: { ...actual.asignaciones },
  };
  cargar()[tienda] = fn(copia);
  notificar();
}

function nuevoId(): string {
  return `et_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanearEtiquetas(v: unknown): Etiqueta[] {
  if (!Array.isArray(v)) return [];
  const salida: Etiqueta[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const nombre = String(e.nombre ?? e.name ?? "").trim().slice(0, 40);
    if (!nombre) continue;
    const color =
      typeof e.color === "string" && /^#[0-9a-fA-F]{6}$/.test(e.color)
        ? e.color
        : COLOR_POR_DEFECTO;
    salida.push({ id: String(e.id ?? nuevoId()), nombre, color });
  }
  return salida;
}

/**
 * Hook principal. Todo lo que devuelve aplica a la tienda activa.
 */
export function useEtiquetas() {
  const { session } = useAuth();
  const tienda = String(session?.tiendaActiva ?? "");
  const datos = useSyncExternalStore(suscribir, () => almacen(tienda));
  const { etiquetas, asignaciones } = datos;

  return useMemo(() => {
    const idsDe = (idPedido: unknown): string[] => asignaciones[String(idPedido)] ?? [];

    return {
      etiquetas,
      asignaciones,

      /** Crea (o devuelve la existente si ya hay una con ese nombre). */
      crear: (nombre: string, color: string): Etiqueta | null => {
        const limpia = String(nombre ?? "").trim().slice(0, 40);
        if (!limpia) return null;
        const existente = etiquetas.find(
          (e) => e.nombre.toLowerCase() === limpia.toLowerCase(),
        );
        if (existente) return existente;
        const nueva: Etiqueta = {
          id: nuevoId(),
          nombre: limpia,
          color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : COLOR_POR_DEFECTO,
        };
        mutar(tienda, (a) => ({ ...a, etiquetas: [...a.etiquetas, nueva] }));
        return nueva;
      },

      actualizar: (id: string, cambios: Partial<Omit<Etiqueta, "id">>) => {
        mutar(tienda, (a) => ({
          ...a,
          etiquetas: a.etiquetas.map((e) =>
            e.id === id
              ? {
                  ...e,
                  ...cambios,
                  nombre: (cambios.nombre ?? e.nombre).trim().slice(0, 40) || e.nombre,
                  color:
                    cambios.color && /^#[0-9a-fA-F]{6}$/.test(cambios.color)
                      ? cambios.color
                      : e.color,
                }
              : e,
          ),
        }));
      },

      /** Elimina la etiqueta y la quita de todos los pedidos. */
      eliminar: (id: string) => {
        mutar(tienda, (a) => {
          const asignaciones2: Record<string, string[]> = {};
          for (const [pedido, ids] of Object.entries(a.asignaciones)) {
            const resto = ids.filter((x) => x !== id);
            if (resto.length) asignaciones2[pedido] = resto;
          }
          return {
            etiquetas: a.etiquetas.filter((e) => e.id !== id),
            asignaciones: asignaciones2,
          };
        });
      },

      aplicar: (idPedido: unknown, etiquetaId: string) => {
        mutar(tienda, (a) => {
          const k = String(idPedido);
          const actuales = a.asignaciones[k] ?? [];
          if (actuales.includes(etiquetaId)) return a;
          return { ...a, asignaciones: { ...a.asignaciones, [k]: [...actuales, etiquetaId] } };
        });
      },

      quitar: (idPedido: unknown, etiquetaId: string) => {
        mutar(tienda, (a) => {
          const k = String(idPedido);
          const actuales = a.asignaciones[k] ?? [];
          const resto = actuales.filter((x) => x !== etiquetaId);
          const asignaciones = { ...a.asignaciones };
          if (resto.length) asignaciones[k] = resto;
          else delete asignaciones[k];
          return { ...a, asignaciones };
        });
      },

      /** Agrega o quita en un clic. */
      alternar: (idPedido: unknown, etiquetaId: string) => {
        if (idsDe(idPedido).includes(etiquetaId)) {
          const k = String(idPedido);
          mutar(tienda, (a) => {
            const resto = (a.asignaciones[k] ?? []).filter((x) => x !== etiquetaId);
            const asignaciones = { ...a.asignaciones };
            if (resto.length) asignaciones[k] = resto;
            else delete asignaciones[k];
            return { ...a, asignaciones };
          });
        } else {
          mutar(tienda, (a) => {
            const k = String(idPedido);
            const actuales = a.asignaciones[k] ?? [];
            if (actuales.includes(etiquetaId)) return a;
            return { ...a, asignaciones: { ...a.asignaciones, [k]: [...actuales, etiquetaId] } };
          });
        }
      },

      tiene: (idPedido: unknown, etiquetaId: string): boolean =>
        idsDe(idPedido).includes(etiquetaId),

      /** Etiquetas resueltas de un pedido (en el orden de la lista). */
      etiquetasDe: (idPedido: unknown): Etiqueta[] => {
        const ids = idsDe(idPedido);
        if (!ids.length) return [];
        return ids
          .map((id) => etiquetas.find((e) => e.id === id))
          .filter((e): e is Etiqueta => Boolean(e));
      },

      /** Cuantos pedidos usan esta etiqueta. */
      usos: (etiquetaId: string): number =>
        Object.values(asignaciones).filter((ids) => ids.includes(etiquetaId)).length,
    };
  }, [tienda, etiquetas, asignaciones]);
}

/** Backup manual (etiquetas de TODAS las tiendas de este navegador). */
export function exportarEtiquetas(): string {
  return JSON.stringify(cargar(), null, 2);
}

/** Fusiona un backup; devuelve la cantidad de etiquetas importadas. */
export function importarEtiquetas(json: string): number {
  const datos = JSON.parse(json);
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    throw new Error("El archivo no parece un backup de etiquetas");
  }
  const todos = cargar();
  let total = 0;
  for (const [tienda, valor] of Object.entries(datos as Record<string, unknown>)) {
    const v = valor as Partial<AlmacenTienda> | null;
    if (!v || typeof v !== "object") continue;
    const etiquetas = sanearEtiquetas(v.etiquetas);
    total += etiquetas.length;
    const asignaciones: Record<string, string[]> = {};
    if (v.asignaciones && typeof v.asignaciones === "object") {
      for (const [pedido, ids] of Object.entries(v.asignaciones as Record<string, unknown>)) {
        if (Array.isArray(ids) && ids.length) asignaciones[String(pedido)] = ids.map(String);
      }
    }
    const previo = todos[tienda] ?? { etiquetas: [], asignaciones: {} };
    // fusiona por id (no duplica)
    const conocidos = new Set(previo.etiquetas.map((e) => e.id));
    todos[tienda] = {
      etiquetas: [...previo.etiquetas, ...etiquetas.filter((e) => !conocidos.has(e.id))],
      asignaciones: { ...asignaciones, ...previo.asignaciones },
    };
  }
  notificar();
  return total;
}
