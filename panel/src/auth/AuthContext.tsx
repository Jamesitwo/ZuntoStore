import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { auth, type LoginResponse } from "../api/endpoints";
import { clearSession, loadSession, normaIds, saveSession, type Session } from "../api/client";
import { errMsg } from "../api/client";

/** login hecho, pendiente de elegir/activar tienda */
export interface PendingLogin {
  token: string;
  idEmpresa: string[];
  user: { id: number; name: string; email: string; rol: string };
}

interface AuthContextValue {
  session: Session | null;
  pending: PendingLogin | null;
  /** true si la sesion se cayo por un 401 de la API (para avisar en el login) */
  expirada: boolean;
  login: (email: string, password: string) => Promise<void>;
  activarTienda: (id: number) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [expirada, setExpirada] = useState(false);

  // Si la API responde 401 el cliente dispara este evento.
  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      setPending(null);
      setExpirada(true);
    };
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res: LoginResponse = await auth.login(email, password);
    if (!res?.ok || !res.token) {
      throw new Error("Respuesta invalida del login");
    }
    setExpirada(false);
    setPending({
      token: res.token,
      idEmpresa: normaIds(res.idEmpresa),
      user: { id: res.id, name: res.name, email: res.email, rol: res.rol },
    });
  }, []);

  const activarTienda = useCallback(
    async (id: number) => {
      // token vigente: se cambia de tienda con el actual; o el del login pendiente
      const token = session?.token ?? pending?.token;
      if (!token) throw new Error("No hay token disponible");

      const res = await auth.addShopId(id, token);
      if (!res?.ok || !res.token) {
        throw new Error("No se pudo activar la tienda");
      }

      const user = session?.user ?? pending?.user;
      const nueva: Session = {
        token: res.token,
        tiendaActiva: Number(res.tiendaActiva ?? id),
        rol: res.rol ?? "",
        idEmpresa: normaIds(res.idEmpresa ?? pending?.idEmpresa ?? session?.idEmpresa ?? []),
        user: user ?? { id: 0, name: "", email: "", rol: "" },
      };
      saveSession(nueva);
      setSession(nueva);
      setPending(null);
      setExpirada(false);
    },
    [session, pending],
  );

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setPending(null);
  }, []);

  const value = useMemo(
    () => ({ session, pending, expirada, login, activarTienda, logout }),
    [session, pending, expirada, login, activarTienda, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

export { errMsg };
