// Filtro por estado de envio de Lucid Bot sobre TODOS los pedidos recientes.
import test from "node:test";
import assert from "node:assert/strict";
import { crearEstadosEnvio } from "../estadosEnvio.js";
import { crearPedidosPorEnvio } from "../pedidosPorEnvio.js";

function tienda(n) {
  // n pedidos, del mas nuevo (id n) al mas viejo (id 1)
  const todos = Array.from({ length: n }, (_, i) => ({ id: n - i, idPedido: 5000 + n - i, Movil: `+57300000${String(n - i).padStart(4, "0")}` }));
  let llamadas = 0;
  const lucid = {
    async listarPedidos({ page, itemsPerPage }) {
      llamadas++;
      return { pedidos: todos.slice((page - 1) * itemsPerPage, page * itemsPerPage), totalRecords: n };
    },
  };
  return { lucid, llamadas: () => llamadas };
}

test("encuentra los pedidos de un estado aunque esten en paginas lejanas", async () => {
  const envios = crearEstadosEnvio();
  envios.registrar({ estado: "EN NOVEDAD", pedido: "3" }); // pedido viejo (pagina 3 de 100)
  envios.registrar({ estado: "En Novedad", telefono: "3000000250" });
  envios.registrar({ estado: "ENTREGADO", pedido: "260" });
  const t = tienda(260);
  const b = crearPedidosPorEnvio({ envios });
  const r = await b.buscar({ lucid: t.lucid, tienda: "1", filtro: "EN NOVEDAD", porPagina: 50 });
  assert.deepEqual(r.pedidos.map((p) => p.id), [250, 3]);
  assert.equal(r.total, 2);
  assert.equal(r.revisados, 260);
  assert.equal(r.conteo["ENTREGADO"], 1);
  assert.equal(r.estadosEnvio["3"].estado, "EN NOVEDAD");
  assert.equal(t.llamadas(), 3);
  // la segunda busqueda usa la lista guardada
  const con = await b.buscar({ lucid: t.lucid, tienda: "1", filtro: "_con" });
  assert.equal(con.total, 3);
  assert.equal(t.llamadas(), 3);
  // actualizar vuelve a pedirla
  await b.buscar({ lucid: t.lucid, tienda: "1", filtro: "_con", forzar: true });
  assert.equal(t.llamadas(), 6);
});

test("pagina los resultados y respeta el tope de pedidos revisados", async () => {
  const envios = crearEstadosEnvio();
  for (let i = 1; i <= 30; i++) envios.registrar({ estado: "EN REPARTO", pedido: String(i) });
  const t = tienda(500);
  const b = crearPedidosPorEnvio({ envios, maxPedidos: 200 });
  const r = await b.buscar({ lucid: t.lucid, tienda: "1", filtro: "_sin", page: 2, porPagina: 100 });
  assert.equal(r.revisados, 200);
  assert.equal(r.total, 200); // los 30 con estado son viejos (ids 1..30), fuera de los 200 revisados
  assert.equal(r.page, 2);
  assert.equal(r.numPages, 2);
  assert.equal(r.totalTienda, 500);
});
