// Pedido con varios productos: una orden de Dropi por producto, en orden.
import test from "node:test";
import assert from "node:assert/strict";
import { crearDropiNavegador } from "../dropiNavegador.js";

function nav(respuestas) {
  const n = crearDropiNavegador({});
  const llamadas = [];
  n.subirUna = async (d) => {
    llamadas.push(d);
    return respuestas[llamadas.length - 1];
  };
  return { n, llamadas };
}
const L = [
  { id: "a", cantidad: 1, precio: 50000, productoUrl: "u/a" },
  { id: "b", cantidad: 2, precio: 30000, productoUrl: "u/b" },
];

test("dos productos: dos ordenes, cada una con su producto y link", async () => {
  const { n, llamadas } = nav([
    { ok: true, creado: true, seguro: true, idDropi: "10", resumenDropi: { ganancia: 5000, envio: 12000 }, detalle: "ok" },
    { ok: true, creado: true, seguro: true, idDropi: "11", resumenDropi: { ganancia: 7000, envio: 13000 }, detalle: "ok" },
  ]);
  const r = await n.subirPedido({ productoUrl: "u/a", productos: L });
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas.map((d) => [d.productoUrl, d.productos.length, d.productos[0].id]), [["u/a", 1, "a"], ["u/b", 1, "b"]]);
  assert.equal(r.ok, true);
  assert.equal(r.idDropi, "10, 11");
  assert.deepEqual(r.resumenDropi, { ganancia: 12000, envio: 25000 });
});

test("falla el segundo: para y dice cual ya quedo", async () => {
  const { n } = nav([
    { ok: true, creado: true, idDropi: "10", detalle: "ok" },
    { ok: false, detalle: "envío caro" },
  ]);
  const r = await n.subirPedido({ productos: L });
  assert.equal(r.ok, false);
  assert.equal(r.parcial, true);
  assert.match(r.detalle, /producto 2 de 2.*Ya quedaron en Dropi: producto 1 \(orden 10\)/);
});

test("reintento: salta los que ya quedaron", async () => {
  const { n, llamadas } = nav([{ ok: true, creado: true, idDropi: "11", detalle: "ok" }]);
  const r = await n.subirPedido({ productos: L, yaSubidas: { 0: "10" } });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].productos[0].id, "b");
  assert.equal(r.ok, true);
  assert.equal(r.idDropi, "10, 11");
});

test("un solo producto: igual que antes", async () => {
  const { n, llamadas } = nav([{ ok: true, creado: true, idDropi: "9" }]);
  const r = await n.subirPedido({ productos: [L[0]] });
  assert.equal(llamadas.length, 1);
  assert.equal(r.idDropi, "9");
  assert.equal(r.ordenes, undefined);
});
