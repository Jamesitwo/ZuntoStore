// Etiquetas de pedidos — funcion PROPIA (no existe en la API de LucidSales).
//
// Las guarda NUESTRO servidor (por tienda), asi todos ven las mismas y la
// subida a Dropi puede etiquetar sola los pedidos que no pudo subir
// ("Dropi · Dirección inválida", ...). Antes vivian en el localStorage de
// cada navegador: lo que haya ahi se sube una vez al servidor.
//
// Es un store externo (useSyncExternalStore): cualquiera que cambie etiquetas
// (lista, detalle, modales) refresca al instante al resto.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { backend, backendSuave } from "../api/backend";
import { useAuth } from "../auth/AuthContext";

export interface Etiqueta {
  id: string;
  nombre: string;
  color: string; // hex #rrggbb
  /** la pone la subida a Dropi (una por motivo) */
  auto?: boolean;
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

/** Donde estaban antes (navegador): se migran al servidor una vez. */
const KEY_LOCAL = "zunto.etiquetas.v1";
const KEY_MIGRADAS = "zunto.etiquetas.migradas.v1";
const COLOR_POR_DEFECTO = PALETA[5];

const oyentes = new Set<() => void>();
const memoria: Record<string, AlmacenTienda> = {};
const vacio: AlmacenTienda = { etiquetas: [], asignaciones: {} };
const cargando = new Map<string, Promise<void>>();

function notificar(): void {
  oyentes.forEach((fn) => fn());
}

function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

function almacen(tienda: string): AlmacenTienda {
  return memoria[tienda] ?? vacio;
}

function leerLocal(): Record<string, AlmacenTienda> {
  try {
    const raw = localStorage.getItem(KEY_LOCAL);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

function migradas(): string[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY_MIGRADAS) ?? "[]");
    return Array.isArray(d) ? d.map(String) : [];
  } catch {
    return [];
  }
}

/** Trae (o vuelve a traer) las etiquetas de la tienda desde el servidor. */
function cargarServidor(tienda: string): Promise<void> {
  if (!tienda) return Promise.resolve();
  const enCurso = cargando.get(tienda);
  if (enCurso) return enCurso;
  const p = (async () => {
    let r = await backendSuave<{ ok: boolean } & AlmacenTienda>(`/api/etiquetas?tienda=${encodeURIComponent(tienda)}`);
    if (!r?.ok) return;
    // las que este navegador tenia guardadas se suben una vez
    const local = leerLocal()[tienda];
    if (local && !migradas().includes(tienda) && (local.etiquetas?.length || Object.keys(local.asignaciones ?? {}).length)) {
      try {
        const m = await backend<{ ok: boolean } & AlmacenTienda>("/api/etiquetas/importar", {
          method: "POST",
          body: { tienda, etiquetas: local.etiquetas ?? [], asignaciones: local.asignaciones ?? {} },
        });
        if (m?.ok) r = m;
        localStorage.setItem(KEY_MIGRADAS, JSON.stringify([...migradas(), tienda]));
      } catch {
        /* se intenta la proxima vez */
      }
    }
    memoria[tienda] = { etiquetas: r.etiquetas ?? [], asignaciones: r.asignaciones ?? {} };
    notificar();
  })().finally(() => cargando.delete(tienda));
  cargando.set(tienda, p);
  return p;
}

/** Cambio local inmediato + llamada al servidor (si falla, se recarga). */
function mutar(tienda: string, fn: (a: AlmacenTienda) => AlmacenTienda, servidor: () => Promise<unknown>): void {
  const actual = almacen(tienda);
  memoria[tienda] = fn({ etiquetas: [...actual.etiquetas], asignaciones: { ...actual.asignaciones } });
  notificar();
  servidor().catch((e) => {
    console.warn("[etiquetas] no se pudo guardar:", e);
    void cargarServidor(tienda);
  });
}

const enviarPedido = (tienda: string, idPedido: string, ids: string[]) =>
  backend(`/api/etiquetas/pedido/${encodeURIComponent(idPedido)}`, { method: "PUT", body: { tienda, ids } });

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

  // se cargan del servidor y se refrescan (la subida a Dropi tambien etiqueta)
  useEffect(() => {
    if (!tienda) return;
    void cargarServidor(tienda);
    const t = setInterval(() => void cargarServidor(tienda), 60_000);
    const alVolver = () => void cargarServidor(tienda);
    window.addEventListener("focus", alVolver);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", alVolver);
    };
  }, [tienda]);

  return useMemo(() => {
    const idsDe = (idPedido: unknown): string[] => asignaciones[String(idPedido)] ?? [];
    const ponerEnPedido = (idPedido: unknown, nuevos: string[]) => {
      const k = String(idPedido);
      mutar(
        tienda,
        (a) => {
          const asign = { ...a.asignaciones };
          if (nuevos.length) asign[k] = nuevos;
          else delete asign[k];
          return { ...a, asignaciones: asign };
        },
        () => enviarPedido(tienda, k, nuevos),
      );
    };

    return {
      etiquetas,
      asignaciones,

      /** Crea (o devuelve la existente si ya hay una con ese nombre). */
      crear: (nombre: string, color: string): Etiqueta | null => {
        const limpia = String(nombre ?? "").trim().slice(0, 40);
        if (!limpia) return null;
        const existente = etiquetas.find((e) => e.nombre.toLowerCase() === limpia.toLowerCase());
        if (existente) return existente;
        const nueva: Etiqueta = {
          id: nuevoId(),
          nombre: limpia,
          color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : COLOR_POR_DEFECTO,
        };
        mutar(
          tienda,
          (a) => ({ ...a, etiquetas: [...a.etiquetas, nueva] }),
          () => backend("/api/etiquetas", { method: "POST", body: { tienda, ...nueva } }),
        );
        return nueva;
      },

      actualizar: (id: string, cambios: Partial<Omit<Etiqueta, "id">>) => {
        mutar(
          tienda,
          (a) => ({
            ...a,
            etiquetas: a.etiquetas.map((e) =>
              e.id === id
                ? {
                    ...e,
                    nombre: (cambios.nombre ?? e.nombre).trim().slice(0, 40) || e.nombre,
                    color: cambios.color && /^#[0-9a-fA-F]{6}$/.test(cambios.color) ? cambios.color : e.color,
                  }
                : e,
            ),
          }),
          () => backend(`/api/etiquetas/${encodeURIComponent(id)}`, { method: "PUT", body: { tienda, ...cambios } }),
        );
      },

      /** Elimina la etiqueta y la quita de todos los pedidos. */
      eliminar: (id: string) => {
        mutar(
          tienda,
          (a) => {
            const asignaciones2: Record<string, string[]> = {};
            for (const [pedido, ids] of Object.entries(a.asignaciones)) {
              const resto = ids.filter((x) => x !== id);
              if (resto.length) asignaciones2[pedido] = resto;
            }
            return { etiquetas: a.etiquetas.filter((e) => e.id !== id), asignaciones: asignaciones2 };
          },
          () => backend(`/api/etiquetas/${encodeURIComponent(id)}?tienda=${encodeURIComponent(tienda)}`, { method: "DELETE" }),
        );
      },

      aplicar: (idPedido: unknown, etiquetaId: string) => {
        const actuales = idsDe(idPedido);
        if (!actuales.includes(etiquetaId)) ponerEnPedido(idPedido, [...actuales, etiquetaId]);
      },

      quitar: (idPedido: unknown, etiquetaId: string) => {
        ponerEnPedido(
          idPedido,
          idsDe(idPedido).filter((x) => x !== etiquetaId),
        );
      },

      /** Agrega o quita en un clic. */
      alternar: (idPedido: unknown, etiquetaId: string) => {
        const actuales = idsDe(idPedido);
        ponerEnPedido(
          idPedido,
          actuales.includes(etiquetaId) ? actuales.filter((x) => x !== etiquetaId) : [...actuales, etiquetaId],
        );
      },

      tiene: (idPedido: unknown, etiquetaId: string): boolean => idsDe(idPedido).includes(etiquetaId),

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

/** Backup manual (etiquetas de las tiendas cargadas en esta sesion). */
export function exportarEtiquetas(): string {
  return JSON.stringify(memoria, null, 2);
}

/** Sube un backup al servidor (se mezcla); devuelve cuantas etiquetas traia. */
export async function importarEtiquetas(json: string): Promise<number> {
  const datos = JSON.parse(json);
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    throw new Error("El archivo no parece un backup de etiquetas");
  }
  let total = 0;
  for (const [tienda, valor] of Object.entries(datos as Record<string, unknown>)) {
    const v = valor as Partial<AlmacenTienda> | null;
    if (!v || typeof v !== "object") continue;
    const etiquetas = sanearEtiquetas(v.etiquetas);
    total += etiquetas.length;
    const r = await backend<{ ok: boolean } & AlmacenTienda>("/api/etiquetas/importar", {
      method: "POST",
      body: { tienda, etiquetas, asignaciones: v.asignaciones ?? {} },
    });
    if (r?.ok) memoria[tienda] = { etiquetas: r.etiquetas ?? [], asignaciones: r.asignaciones ?? {} };
  }
  notificar();
  return total;
}
