// Estado del envio que manda Lucid Bot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearEstadosEnvio, normalizarEvento } from "../estadosEnvio.js";

test("normaliza lo que manda Lucid Bot (con nombres variados)", () => {
  const ev = normalizarEvento({ status: "EN REPARTO", phone: "+57 300 123 4567", numero_guia: "2400 1234", carrier: "COORDINADORA" });
  assert.equal(ev.estado, "EN REPARTO");
  assert.equal(ev.telefono, "3001234567");
  assert.equal(ev.guia, "24001234");
  assert.equal(ev.transportadora, "COORDINADORA");
});

test("variables vacias de Lucid Bot ({{guia}}) no cuentan", () => {
  const ev = normalizarEvento({ estado: "ENTREGADO", telefono: "3001234567", guia: "{{guia}}", pedido: "{{pedido}}" });
  assert.equal(ev.guia, "");
  assert.equal(ev.pedido, "");
});

test("sin estado o sin como identificar el pedido: error claro", () => {
  assert.throws(() => normalizarEvento({ telefono: "3001234567" }), /Falta 'estado'/);
  assert.throws(() => normalizarEvento({ estado: "ENTREGADO" }), /telefono', 'guia' o 'pedido'/);
});

test("cada pedido recibe su ultimo estado: por pedido, por guia o por telefono", () => {
  const e = crearEstadosEnvio();
  e.registrar({ estado: "Creado", telefono: "3001112222", fecha: "2026-10-10T10:00:00Z" });
  e.registrar({ estado: "EN REPARTO", telefono: "3001112222", fecha: "2026-10-12T10:00:00Z" });
  e.registrar({ estado: "ENTREGADO", guia: "999", fecha: "2026-10-12T11:00:00Z" });
  e.registrar({ estado: "DEVOLUCION", pedido: "#6106", telefono: "3009998888", fecha: "2026-10-12T12:00:00Z" });
  const r = e.consultar([
    { id: 1, idPedido: 501, telefono: "+573001112222", fecha: "2026-10-09" },
    { id: 2, idPedido: 502, telefono: "3005550000", guia: "999" },
    { id: 3, idPedido: 6106, telefono: "3009998888" },
    { id: 4, idPedido: 504, telefono: "3007770000" },
  ]);
  assert.equal(r[1].estado, "EN REPARTO");
  assert.equal(r[1].por, "telefono");
  assert.equal(r[2].estado, "ENTREGADO");
  assert.equal(r[2].por, "guia");
  assert.equal(r[3].estado, "DEVOLUCION");
  assert.equal(r[3].por, "pedido");
  assert.equal(r[4], undefined);
});

test("por telefono no se le pega a un pedido creado DESPUES del aviso", () => {
  const e = crearEstadosEnvio();
  e.registrar({ estado: "ENTREGADO", telefono: "3001112222", fecha: "2026-09-01T10:00:00Z" });
  const r = e.consultar([{ id: 7, telefono: "3001112222", fecha: "2026-10-20T10:00:00Z" }]);
  assert.equal(r[7], undefined);
});

test("se guarda en disco y se lee al reiniciar", () => {
  const ruta = path.join(os.tmpdir(), `envios-${Date.now()}.json`);
  crearEstadosEnvio({ ruta }).registrar({ estado: "EN TRANSITO", telefono: "3001112222" });
  const otra = crearEstadosEnvio({ ruta });
  assert.equal(otra.consultar([{ id: 1, telefono: "3001112222" }])[1].estado, "EN TRANSITO");
  assert.equal(otra.ultimos(5).length, 1);
  fs.rmSync(ruta, { force: true });
});

test("historial: linea de tiempo del pedido, sin repeticiones seguidas", () => {
  const e = crearEstadosEnvio();
  e.registrar({ estado: "Creado", pedido: "6106", guia: "G1", fecha: "2026-10-10T10:00:00Z" });
  e.registrar({ estado: "EN TRANSITO", guia: "G1", fecha: "2026-10-11T10:00:00Z" });
  e.registrar({ estado: "EN TRANSITO", guia: "G1", fecha: "2026-10-11T18:00:00Z" });
  e.registrar({ estado: "EN REPARTO", pedido: "6106", fecha: "2026-10-12T09:00:00Z" });
  e.registrar({ estado: "ENTREGADO", telefono: "3001112222", pedido: "999", fecha: "2026-10-12T10:00:00Z" }); // otro pedido
  const h = e.historial({ id: 3256175, idPedido: 6106, telefono: "3001112222" });
  assert.deepEqual(h.map((x) => x.estado), ["Creado", "EN TRANSITO", "EN REPARTO"]);
  assert.equal(h[1].repeticiones, 2);
  assert.equal(h[0].ts, "2026-10-10T10:00:00.000Z");
});

test("historial por telefono cuando Lucid Bot no manda el pedido", () => {
  const e = crearEstadosEnvio();
  e.registrar({ estado: "Creado", telefono: "3001112222", fecha: "2026-10-10T10:00:00Z" });
  e.registrar({ estado: "ENTREGADO", telefono: "3001112222", fecha: "2026-10-13T10:00:00Z" });
  const h = e.historial({ id: 1, telefono: "+573001112222", fecha: "2026-10-09" });
  assert.deepEqual(h.map((x) => x.estado), ["Creado", "ENTREGADO"]);
});

test("estadosConocidos agrupa sin importar tildes ni mayusculas", () => {
  const e = crearEstadosEnvio();
  e.registrar({ estado: "En Tránsito", telefono: "3001112222" });
  e.registrar({ estado: "EN TRANSITO", telefono: "3001112223" });
  e.registrar({ estado: "ENTREGADO", telefono: "3001112224" });
  const r = e.estadosConocidos();
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => /tr/i.test(x.estado)).avisos, 2);
});
