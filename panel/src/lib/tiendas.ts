// Nombres de las tiendas del usuario.
// Fuente: POST /auth/getshopname  {id: [...ids]}  ->  {ok, shopName: [{id, Nombre, ...}]}
// El mapa se cachea en memoria y en sessionStorage: una sola peticion por sesion.

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { auth } from "../api/endpoints";
import { normaIds } from "../api/client";

const CACHE_KEY = "zunto.tiendas";

const memoria = new Map<string, Record<string, string>>();
let enCurso: Promise<void> | null = null;

function leerPersistido(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function persistir(mapa: Record<string, string>): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(mapa));
  } catch {
    /* sessionStorage no disponible */
  }
}

async function cargar(
  firma: string,
  ids: (string | number)[],
  token?: string,
): Promise<Record<string, string>> {
  const res: any = await auth.shopNames(ids, token);
  const arr = Array.isArray(res?.shopName) ? res.shopName : [];
  const mapa: Record<string, string> = {};
  for (const s of arr) {
    const nombre = s?.Nombre ?? s?.nombre ?? s?.name;
    if (s?.id !== undefined && s?.id !== null && nombre) {
      mapa[String(s.id)] = String(nombre);
    }
  }
  memoria.set(firma, mapa);
  persistir(mapa);
  return mapa;
}

/**
 * Mapa {idTienda -> nombre}.
 * `token` opcional: para el paso de login (aun no hay sesion activa).
 */
export function useNombresTiendas(ids: (string | number)[], token?: string) {
  // por si acaso llega un string "1,2,3" en vez de array
  const lista = Array.isArray(ids) ? ids : normaIds(ids);
  const firma = lista.join(",");
  const [mapa, setMapa] = useState<Record<string, string>>(() =>
    memoria.get(firma) ?? leerPersistido(),
  );

  useEffect(() => {
    if (!firma) return;
    const guardado = memoria.get(firma);
    if (guardado) {
      setMapa(guardado);
      return;
    }
    if (enCurso) {
      enCurso.then(() => setMapa(memoria.get(firma) ?? leerPersistido()));
      return;
    }

    let cancel = false;
    enCurso = cargar(firma, lista, token)
      .then((m) => {
        if (!cancel) setMapa(m);
      })
      .catch(() => undefined) // sin nombre se sigue mostrando "Tienda #id"
      .finally(() => {
        enCurso = null;
      });

    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, token]);

  return mapa;
}

/** "Pizdo Store (#321)" si hay nombre, si no "Tienda #321". */
export function etiquetaTienda(
  id: string | number,
  mapa: Record<string, string>,
): string {
  const nombre = mapa[String(id)];
  return nombre ? `${nombre} (#${id})` : `Tienda #${id}`;
}

/** Solo el nombre, o null si no se conoce. */
export function nombreTienda(
  id: string | number,
  mapa: Record<string, string>,
): string | null {
  return mapa[String(id)] ?? null;
}

/**
 * Atajo para paginas autenticadas:
 *   const etiqueta = useEtiquetaTienda();
 *   subtitle={etiqueta(idEmpresa)}  ->  "Pizdo Store (#321)"
 */
export function useEtiquetaTienda() {
  const { session } = useAuth();
  const mapa = useNombresTiendas(session?.idEmpresa ?? []);
  return (id?: string | number | null) =>
    etiquetaTienda(id ?? session?.tiendaActiva ?? "", mapa);
}
