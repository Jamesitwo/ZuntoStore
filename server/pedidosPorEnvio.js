// Pedidos filtrados por el estado de envio que manda Lucid Bot, sobre TODOS
// los pedidos recientes de la tienda (no solo la pagina que muestra el panel).
//
// LucidSales no conoce estos estados, asi que aqui se recorren las ultimas
// paginas de pedidos de la tienda (hasta `maxPedidos`, del mas nuevo al mas
// viejo), a cada uno se le busca su estado de Lucid Bot (mismo criterio que
// el panel: pedido, guia o telefono) y se devuelven solo los que coinciden,
// paginados. La lista de la tienda se guarda unos minutos para no pedirla
// a LucidSales en cada cambio de pagina.
import { normalizarEstado } from "./estadosEnvio.js";

const POR_PAGINA_LUCID = 100;

export function crearPedidosPorEnvio({ envios, maxPedidos = 1000, cacheMs = 3 * 60_000, ahora = () => Date.now() } = {}) {
  const cache = new Map(); // tienda -> { ts, pedidos, total }

  async function pedidosDeTienda(lucid, tienda, { forzar = false } = {}) {
    const c = cache.get(String(tienda));
    if (c && !forzar && ahora() - c.ts < cacheMs) return c;
    const pedidos = [];
    let total = 0;
    const maxPaginas = Math.ceil(maxPedidos / POR_PAGINA_LUCID);
    for (let page = 1; page <= maxPaginas; page++) {
      const r = await lucid.listarPedidos({
        idEmpresa: tienda,
        page,
        itemsPerPage: POR_PAGINA_LUCID,
        filtros: [{ name: "date", searchValues: [], sortOrder: "desc" }],
      });
      const lote = Array.isArray(r?.pedidos) ? r.pedidos : [];
      total = Number(r?.totalRecords) || total;
      pedidos.push(...lote);
      if (lote.length < POR_PAGINA_LUCID) break;
    }
    const nuevo = { ts: ahora(), pedidos, total };
    cache.set(String(tienda), nuevo);
    return nuevo;
  }

  return {
    /**
     * filtro: "_con" | "_sin" | estado normalizado (ej. "EN TRANSITO")
     * -> { pedidos, total, revisados, totalTienda, page, numPages, estados }
     */
    async buscar({ lucid, tienda, filtro, page = 1, porPagina = 50, forzar = false }) {
      const { pedidos, total: totalTienda, ts } = await pedidosDeTienda(lucid, tienda, { forzar });
      const consulta = pedidos.map((p) => ({
        id: String(p?.id ?? p?.idPedido ?? ""),
        idPedido: p?.idPedido,
        telefono: p?.Movil ?? "",
        fecha: p?.Fecha ?? p?.CreatedAt ?? "",
      }));
      const estados = envios.consultar(consulta);
      const f = String(filtro ?? "");
      const coinciden = pedidos.filter((p) => {
        const e = estados[String(p?.id ?? p?.idPedido ?? "")];
        if (f === "_sin") return !e;
        if (f === "_con") return Boolean(e);
        return Boolean(e) && normalizarEstado(e.estado) === f;
      });
      // cuantos hay de cada estado entre los revisados (para el selector)
      const conteo = {};
      for (const e of Object.values(estados)) {
        const k = normalizarEstado(e.estado);
        conteo[k] = (conteo[k] ?? 0) + 1;
      }
      const tam = Math.max(1, Math.min(Number(porPagina) || 50, 500));
      const numPages = Math.max(1, Math.ceil(coinciden.length / tam));
      const pg = Math.max(1, Math.min(Number(page) || 1, numPages));
      const trozo = coinciden.slice((pg - 1) * tam, pg * tam);
      return {
        pedidos: trozo,
        estadosEnvio: Object.fromEntries(
          trozo.map((p) => [String(p?.id ?? p?.idPedido), estados[String(p?.id ?? p?.idPedido ?? "")] ?? null]),
        ),
        total: coinciden.length,
        page: pg,
        numPages,
        revisados: pedidos.length,
        totalTienda,
        conteo,
        actualizado: new Date(ts).toISOString(),
      };
    },
  };
}
