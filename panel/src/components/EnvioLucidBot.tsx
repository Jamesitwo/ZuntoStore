// Estado del envio que manda Lucid Bot, para los pedidos que en LucidSales
// siguen en "Sin Envio" (los que se suben a Dropi por fuera de LucidSales).
import { useEffect, useMemo, useState } from "react";
import { backend } from "../api/backend";
import { fmtFecha } from "../lib/format";
import { EnvioBadge } from "./ui";

export interface EstadoEnvioBot {
  estado: string;
  transportadora?: string;
  guia?: string;
  novedad?: string;
  ts: string;
  por: "pedido" | "guia" | "telefono";
}

/** Para comparar estados: sin tildes, mayusculas y espacios de mas (igual que el servidor). */
export const normalizarEstado = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** LucidSales no sabe nada del envio todavia. */
export const sinEnvioEnLucid = (v: unknown) => {
  const t = String(v ?? "").trim().toLowerCase();
  return !t || t === "sin envio" || t === "sin envío";
};

interface PedidoConsulta {
  id?: number | string;
  idPedido?: number | string;
  Movil?: string;
  Fecha?: string;
  CreatedAt?: string;
  EstadoFullfilment?: string | null;
}

/** Pide a nuestro servidor el estado de Lucid Bot de los pedidos "Sin Envio". */
export function useEstadosEnvioBot(pedidos: PedidoConsulta[] | null | undefined) {
  const [estados, setEstados] = useState<Record<string, EstadoEnvioBot>>({});
  const consulta = useMemo(
    () =>
      (pedidos ?? [])
        .filter((p) => (p?.id ?? p?.idPedido) != null && sinEnvioEnLucid(p?.EstadoFullfilment))
        .map((p) => ({
          id: String(p.id ?? p.idPedido),
          idPedido: p.idPedido,
          telefono: p.Movil ?? "",
          fecha: p.Fecha ?? p.CreatedAt ?? "",
        })),
    [pedidos],
  );
  const clave = consulta.map((c) => c.id).join(",");
  useEffect(() => {
    if (!consulta.length) {
      setEstados({});
      return;
    }
    let cancel = false;
    backend<{ ok: boolean; estados?: Record<string, EstadoEnvioBot> }>("/api/envios/consultar", {
      method: "POST",
      body: { pedidos: consulta },
    })
      .then((r) => {
        if (!cancel && r?.ok) setEstados(r.estados ?? {});
      })
      .catch(() => {
        /* sin permiso o servidor apagado: se ve solo lo de LucidSales */
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return estados;
}

/** Badge del envio: el de LucidSales y, si no tiene, el de Lucid Bot. */
export function EnvioConBot({ valor, bot }: { valor: unknown; bot?: EstadoEnvioBot | null }) {
  if (!bot || !sinEnvioEnLucid(valor)) return <EnvioBadge value={valor} />;
  const detalle = [
    `Estado recibido de Lucid Bot · ${fmtFecha(bot.ts)}`,
    bot.transportadora ? `Transportadora: ${bot.transportadora}` : "",
    bot.guia ? `Guía: ${bot.guia}` : "",
    bot.novedad ? `Novedad: ${bot.novedad}` : "",
    bot.por === "telefono" ? "Asociado por el teléfono del cliente" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="envio-bot" title={detalle}>
      <EnvioBadge value={bot.estado} />
      <span className="muted small"> · Lucid Bot</span>
    </span>
  );
}
