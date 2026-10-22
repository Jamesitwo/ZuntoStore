// Enlace al inbox del bot (LucidBot) para el chat de WhatsApp del cliente.
//
// El panel oficial NO recibe este link de la API: lo arma el mismo con
//   POST /business/bot  ->  {ok, data: [{botId, ...}]}
//   https://panel.lucidbot.co/en/inbox?acc={botId}&id={Movil sin "+"}
// y lo muestra como "Inbox" en el detalle del pedido.

import { useEffect, useState } from "react";
import { negocio } from "../api/endpoints";

const CACHE_KEY = "zunto.botId";

let botId: string | null = null;
let listo = false;

function leerCache(): string | null {
  try {
    return sessionStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

/** URL del inbox para un pedido/cliente; null si no hay bot o telefono. */
export function urlInbox(movil: unknown, idBot?: string | null): string | null {
  const acc = idBot ?? botId;
  const telefono = String(movil ?? "").replace(/\s|\+/g, "");
  if (!acc || !telefono) return null;
  return `https://panel.lucidbot.co/en/inbox?acc=${encodeURIComponent(acc)}&id=${encodeURIComponent(telefono)}`;
}

/**
 * Devuelve una funcion `(movil) => urlInbox | null`.
 * Carga el botId una sola vez (cache en memoria + sessionStorage).
 */
export function useInboxBot() {
  const [idBot, setIdBot] = useState<string | null>(() => botId ?? leerCache());

  useEffect(() => {
    if (listo) {
      setIdBot(botId);
      return;
    }
    let cancel = false;
    negocio
      .bot()
      .then((res: any) => {
        const id = res?.data?.[0]?.botId;
        botId = id !== undefined && id !== null ? String(id) : "";
        listo = true;
        try {
          sessionStorage.setItem(CACHE_KEY, botId);
        } catch {
          /* sessionStorage no disponible */
        }
        if (!cancel) setIdBot(botId || null);
      })
      .catch(() => {
        // sin bot configurado: el enlace simplemente no se muestra
        if (!cancel) setIdBot(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (movil: unknown) => (idBot ? urlInbox(movil, idBot) : null);
}
