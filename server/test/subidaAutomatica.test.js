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
