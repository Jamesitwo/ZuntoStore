// Cliente HTTP para NUESTRO backend (server/), que no es el de LucidSales.
//
// Mismo origen (/api, el proxy de Vite lo manda a localhost:8787). El panel
// entra con la SESION DE LUCIDSALES del usuario (x-token + x-tienda): el
// servidor la verifica con LucidSales y aplica sus permisos. Ya no hay ninguna
// clave fija dentro del JavaScript.
import { loadSession } from "./client";

const API_PROPIA = (import.meta.env.VITE_API_PROPIA as string | undefined) ?? "";

/** Cabeceras de acceso a nuestro backend: la sesion de LucidSales del usuario. */
export function cabecerasBackend(): Record<string, string> {
  const sesion = loadSession();
  return {
    ...(sesion?.token ? { "x-token": sesion.token } : {}),
    ...(sesion?.tiendaActiva ? { "x-tienda": String(sesion.tiendaActiva) } : {}),
  };
}

export interface RespuestaBackend {
  ok?: boolean;
  msg?: string;
  [k: string]: unknown;
}

export async function backend<T = RespuestaBackend>(
  path: string,
  opciones: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const { method = "GET", body } = opciones;

  let res: Response;
  try {
    res = await fetch(`${API_PROPIA}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...cabecerasBackend(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("No se pudo conectar con el backend propio (¿esta arrancado?)");
  }

  const datos = (await res.json().catch(() => null)) as RespuestaBackend | null;
  if (!res.ok) {
    throw new Error(
      (datos && typeof datos.msg === "string" && datos.msg) || `Error ${res.status} del backend propio`,
    );
  }
  return datos as T;
}

/** GET de comodin: devuelve null si el backend no esta disponible (no rompe la UI). */
export async function backendSuave<T = RespuestaBackend>(path: string): Promise<T | null> {
  try {
    return await backend<T>(path);
  } catch {
    return null;
  }
}

/**
 * Descarga de un archivo del backend propio (CSV): pide el blob con las
 * mismas cabeceras y lo guarda con el nombre que manda el servidor.
 */
export async function backendArchivo(path: string): Promise<void> {

  let res: Response;
  try {
    res = await fetch(`${API_PROPIA}${path}`, {
      headers: cabecerasBackend(),
    });
  } catch {
    throw new Error("No se pudo conectar con el backend propio (¿esta arrancado?)");
  }

  if (!res.ok) {
    const datos = (await res.json().catch(() => null)) as RespuestaBackend | null;
    throw new Error(
      (datos && typeof datos.msg === "string" && datos.msg) || `Error ${res.status} del backend propio`,
    );
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const nombre = disposition.match(/filename="([^"]+)"/)?.[1] || "descarga";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
