// Cliente HTTP basico para la API de LucidSales.
// - Adjunta el header x-token de la sesion activa.
// - En 401 limpia la sesion y avisa a la UI para volver al login.

const API_BASE = (import.meta.env.VITE_API_BASE || "/b").replace(/\/$/, "");

export interface Session {
  token: string;
  tiendaActiva: number;
  rol: string;
  idEmpresa: string[];
  user: { id: number; name: string; email: string; rol: string };
}

const SESSION_KEY = "zuntostore.session";

/**
 * idEmpresa puede llegar de la API como array o como "1,2,3".
 * Siempre se maneja como array de strings (un string romperia .map/.join).
 */
export function normaIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed || !parsed.token) return null;
    parsed.idEmpresa = normaIds(parsed.idEmpresa);
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** token explicito; null = no enviar (login publico) */
  token?: string | null;
  /**
   * true: un 401 NO borra la sesion ni dispara "session-expired".
   * Para endpoints auxiliares (nombres de tienda, bot/inbox) donde un fallo
   * no deberia deslogear al usuario: simplemente no se muestra ese dato.
   */
  ignoreAuth?: boolean;
}

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, token, ignoreAuth } = options;
  const session = loadSession();
  const useToken = token !== undefined ? token : session?.token;

  const url = API_BASE + path + (query ? qs(query) : "");
  const headers: Record<string, string> = {};
  if (useToken) headers["x-token"] = useToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, "No se pudo conectar con la API (red o CORS)", err);
  }

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (res.status === 401) {
    if (!ignoreAuth) {
      clearSession();
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiError(
      401,
      ignoreAuth
        ? "Endpoint auxiliar respondio 401 (se omite el dato)"
        : "Sesion expirada o token invalido. Vuelve a iniciar sesion.",
      data,
    );
  }

  if (!res.ok) {
    const msg =
      (data && (data.msg || data.message || data.error)) || `Error ${res.status} del servidor`;
    throw new ApiError(res.status, String(msg), data);
  }

  return data as T;
}

/** Extrae el primer arreglo util de una respuesta de forma defensiva. */
export function pickArray(data: any, keys: string[] = []): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/** Traduce un error a mensaje legible. */
export function errMsg(err: unknown): string {
  if (err instanceof ApiError) return `[${err.status}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
