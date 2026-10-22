// Cliente HTTP para NUESTRO backend (server/), que no es el de LucidSales.
//
// Mismo origen (/api, el proxy de Vite lo manda a localhost:8787) pero con la
// cabecera x-api-key (VITE_API_KEY, el mismo valor que API_KEY del servidor)
// y x-usuario (para poder auditar quien hizo cada cosa).
import { loadSession } from "./client";

const API_PROPIA = (import.meta.env.VITE_API_PROPIA as string | undefined) ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

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
  const sesion = loadSession();

  let res: Response;
  try {
    res = await fetch(`${API_PROPIA}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
        ...(sesion?.user?.email ? { "x-usuario": sesion.user.email } : {}),
        ...(sesion?.tiendaActiva ? { "x-tienda": String(sesion.tiendaActiva) } : {}),
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
  const sesion = loadSession();

  let res: Response;
  try {
    res = await fetch(`${API_PROPIA}${path}`, {
      headers: {
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
        ...(sesion?.user?.email ? { "x-usuario": sesion.user.email } : {}),
        ...(sesion?.tiendaActiva ? { "x-tienda": String(sesion.tiendaActiva) } : {}),
      },
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
