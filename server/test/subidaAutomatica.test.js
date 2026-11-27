import test from "node:test";
import assert from "node:assert/strict";
test("lista de productos agotados: agrupa los pedidos sin-stock por producto de Dropi", async () => {
  const { agruparAgotados } = await import("../subidaAutomatica.js");
  const r = agruparAgotados({
    1: { accion: "sin-stock", ts: "2026-11-21T10:00:00Z", producto: { nombre: "Parlante Gts 1248", url: "https://app.dropi.co/dashboard/product-details/930615/x", pedido: 501 }, cliente: { nombre: "Ana" } },
    2: { accion: "sin-stock", ts: "2026-11-21T12:00:00Z", producto: { nombre: "Parlante Gts 1248", url: "https://app.dropi.co/dashboard/product-details/930615/x", pedido: 502 }, cliente: { nombre: "Luis" } },
    3: { accion: "sin-stock", ts: "2026-11-20T09:00:00Z", detalle: "agotado. Link: https://app.dropi.co/dashboard/product-details/777/y", cliente: { nombre: "Eva" } },
    4: { accion: "subido", ts: "2026-11-21T09:00:00Z" },
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].idDropi, "930615");
  assert.equal(r[0].nombre, "Parlante Gts 1248");
  assert.deepEqual(r[0].pedidos.map((x) => x.numero), [502, 501]);
  assert.equal(r[0].desde, "2026-11-21T10:00:00Z");
  assert.equal(r[1].idDropi, "777");
});

test("subidas repetidas: mismo pedido subido dos veces y mismo cliente con el mismo producto", async () => {
  const { revisarDuplicados } = await import("../subidaAutomatica.js");
  const r = revisarDuplicados({
    intentos: [
      { pedido: "1", numero: 501, clave: "v1:1", accion: "subido", ts: "2026-11-20T10:00:00Z", dropi: { id: 9001 } },
      { pedido: "1", numero: 501, clave: "manual:1", accion: "subido", origen: "manual", ts: "2026-11-20T12:00:00Z", dropi: { id: 9002 } },
      { pedido: "2", clave: "v1:2", accion: "subido", ts: "2026-11-20T10:00:00Z", dropi: { id: 9003 } },
      { pedido: "2", clave: "v1:2", accion: "subido", ts: "2026-11-20T10:00:00Z", dropi: { id: 9003 } },
      { pedido: "3", clave: "v1:3", accion: "error", ts: "2026-11-20T10:00:00Z" },
    ],
    procesados: {
      10: { accion: "subido", ts: "2026-11-20T10:00:00Z", cliente: { telefono: "+57 300 111 2233", nombre: "Ana" }, analisis: { extraido: { producto: "Taladro" } } },
      11: { accion: "subido", ts: "2026-11-22T10:00:00Z", cliente: { telefono: "3001112233", nombre: "Ana" }, analisis: { extraido: { producto: "taladro" } } },
      12: { accion: "subido", ts: "2026-11-22T10:00:00Z", cliente: { telefono: "3001112233" }, analisis: { extraido: { producto: "Pulidora" } } },
      13: { accion: "subido", ts: "2026-10-01T10:00:00Z", cliente: { telefono: "3009998877" }, analisis: { extraido: { producto: "Árbol" } } },
      14: { accion: "subido", ts: "2026-11-25T10:00:00Z", cliente: { telefono: "3009998877" }, analisis: { extraido: { producto: "Arbol" } } },
    },
  });
  assert.deepEqual(r.mismoPedido.map((x) => x.id), ["1"]);
  assert.deepEqual(r.mismoPedido[0].ordenesDropi, ["9001", "9002"]);
  assert.equal(r.mismoCliente.length, 1);
  assert.deepEqual(r.mismoCliente[0].pedidos.map((x) => x.id), ["10", "11"]);
});
