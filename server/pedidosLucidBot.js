// Cuando llega un pedido nuevo a LucidSales, su id se guarda en un campo
// personalizado del contacto del cliente en Lucid Bot. Asi el bot puede
// mandar despues el estado del envio (POST /api/envios/estado) diciendo de
// que pedido es, o usar el id en sus flujos.
//
// Revisa la primera pagina de pedidos de cada tienda cada `cadaMs`. La primera
// vez que mira una tienda solo toma nota de lo que ya habia (no le escribe a
// los pedidos viejos); desde ahi, cada pedido nuevo se envia una vez.
import fs from "node:fs";
import path from "node:path";

const MAX_GUARDADOS = 5000;
const MAX_INTENTOS = 3;

export function crearPedidosLucidBot({
  cliente,
  lucidBot,
  tiendas = () => [],
  ruta = null,
  cadaMs = 60_000,
  log = console,
} = {}) {
  let estado = { tiendas: {}, pedidos: {} };
  if (ruta) {
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
      estado = { tiendas: j?.tiendas ?? {}, pedidos: j?.pedidos ?? {} };
    } catch {
      /* primera vez */
    }
  }
  let timer = null;
  let corriendo = false;

  function guardar() {
    const ids = Object.keys(estado.pedidos);
    if (ids.length > MAX_GUARDADOS) {
      ids
        .sort((a, b) => String(estado.pedidos[a].ts).localeCompare(String(estado.pedidos[b].ts)))
        .slice(0, ids.length - MAX_GUARDADOS)
        .forEach((id) => delete estado.pedidos[id]);
    }
    if (!ruta) return;
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(estado));
      fs.renameSync(tmp, ruta);
    } catch (e) {
      log.warn?.("[lucidbot-pedidos] no se pudo guardar:", e?.message ?? e);
    }
  }

  async function tick() {
    if (corriendo) return { ok: false, detalle: "ya hay una revisión en curso" };
    if (!lucidBot?.pedidoActivo?.()) return { ok: true, omitido: true, enviados: 0 };
    corriendo = true;
    let enviados = 0;
    let fallidos = 0;
    try {
      for (const t of tiendas().map(String).filter(Boolean)) {
        let pedidos;
        try {
          const r = await cliente.listarPedidos({
            idEmpresa: t,
            page: 1,
            itemsPerPage: 50,
            filtros: [{ name: "date", searchValues: [], sortOrder: "desc" }],
          });
          pedidos = Array.isArray(r?.pedidos) ? r.pedidos : [];
        } catch (e) {
          log.warn?.(`[lucidbot-pedidos] no se pudieron leer los pedidos de la tienda ${t}:`, e?.message ?? e);
          continue;
        }
        // primera vez con esta tienda: lo que ya estaba no se envia
        if (!estado.tiendas[t]) {
          const ahora = new Date().toISOString();
          for (const p of pedidos) {
            const id = String(p?.id ?? p?.idPedido ?? "");
            if (id && !estado.pedidos[id]) estado.pedidos[id] = { ts: ahora, previo: true };
          }
          estado.tiendas[t] = { desde: ahora };
          guardar();
          continue;
        }
        // de los mas viejos a los mas nuevos
        for (const p of [...pedidos].reverse()) {
          const id = String(p?.id ?? p?.idPedido ?? "");
          if (!id) continue;
          const previo = estado.pedidos[id];
          if (previo?.ok || previo?.previo || (previo?.intentos ?? 0) >= MAX_INTENTOS) continue;
          const r = await lucidBot.guardarIdPedido(p);
          if (r.omitido) break;
          estado.pedidos[id] = {
            ts: new Date().toISOString(),
            ok: r.ok,
            numero: p?.idPedido ?? null,
            tienda: t,
            intentos: (previo?.intentos ?? 0) + 1,
            detalle: r.detalle,
          };
          if (r.ok) enviados++;
          else {
            fallidos++;
            log.warn?.(`[lucidbot-pedidos] pedido #${p?.idPedido ?? id}: ${r.detalle}`);
          }
          guardar();
        }
      }
      if (enviados) log.log?.(`[lucidbot-pedidos] id enviado a Lucid Bot en ${enviados} pedido(s) nuevo(s)`);
      return { ok: true, enviados, fallidos };
    } finally {
      corriendo = false;
    }
  }

  return {
    tick,
    iniciar() {
      if (timer) return;
      timer = setInterval(() => void tick().catch((e) => log.warn?.("[lucidbot-pedidos]", e?.message ?? e)), cadaMs);
      timer.unref?.();
      void tick().catch(() => {});
    },
    detener() {
      clearInterval(timer);
      timer = null;
    },
    /** Los ultimos pedidos tratados (para el panel). */
    ultimos(n = 20) {
      return Object.entries(estado.pedidos)
        .filter(([, v]) => !v.previo)
        .sort(([, a], [, b]) => String(b.ts).localeCompare(String(a.ts)))
        .slice(0, Math.max(1, Math.min(Number(n) || 20, 100)))
        .map(([id, v]) => ({ id, ...v }));
    },
  };
}
