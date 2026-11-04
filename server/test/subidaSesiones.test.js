import { test } from "node:test";
import assert from "node:assert/strict";
test("resumen de la sesión de subida: subidos, no subidos y motivos con su número", async () => {
  const { sumarSesion, motivoDeResultado } = await import("../subidaAutomatica.js");
  assert.equal(motivoDeResultado({ accion: "subido" }), null);
  assert.equal(motivoDeResultado({ accion: "direccion-invalida" }), "Dirección inválida");
  assert.equal(motivoDeResultado({ accion: "frenar", motivos: ["precio", "cantidad"] }), "Frenado por el agente: precio, cantidad");
  // los errores de distintos pedidos con el mismo motivo se juntan
  const e1 = motivoDeResultado({ accion: "error", detalle: "el idProductoDropi 1642571 de «Nivel Laser» no está en el Google Sheets" });
  const e2 = motivoDeResultado({ accion: "error", detalle: "el idProductoDropi 2246501 de «Combo Taladro» no está en el Google Sheets" });
  assert.equal(e1, e2);

  // ronda de dos vueltas = una sola sesion; cada pedido cuenta una vez
  let s = sumarSesion([], {
    clave: "ronda A", desde: "2026-11-04T04:00:00Z", hasta: "2026-11-04T05:00:00Z", dryRun: false,
    detalle: [
      { id: "1", accion: "subido" },
      { id: "2", accion: "direccion-invalida" },
      { id: "3", accion: "direccion-invalida" },
      { id: "4", accion: "error", detalle: "el idProductoDropi 1 de «X» no está en el Google Sheets" },
    ],
  });
  s = sumarSesion(s, {
    clave: "ronda A", desde: "2026-11-04T05:01:30Z", hasta: "2026-11-04T05:30:00Z", dryRun: false,
    detalle: [{ id: "4", accion: "subido" }, { id: "5", accion: "posible-duplicado" }],
  });
  assert.equal(s.length, 1);
  const [x] = s;
  assert.equal(x.desde, "2026-11-04T04:00:00Z");
  assert.equal(x.vueltas, 2);
  assert.equal(x.subidos, 2);
  assert.equal(x.noSubidos, 3);
  assert.deepEqual(x.motivos, [
    { motivo: "Dirección inválida", n: 2 },
    { motivo: "Posible pedido duplicado", n: 1 },
  ]);
  // otra sesion va primero y se guardan como maximo 20
  for (let i = 0; i < 25; i++) {
    s = sumarSesion(s, { clave: `v${i}`, desde: `2026-11-05T00:${String(i).padStart(2, "0")}:00Z`, hasta: "", detalle: [{ id: "9", accion: "subido" }] });
  }
  assert.equal(s.length, 20);
  assert.equal(s[0].clave, "v24");
});
