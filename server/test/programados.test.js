import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearProgramados } from "../programados.js";
import { diasHasta, fechaDeExtraccion, fechaValida, interpretarFecha, sumarDias } from "../fechaEntrega.js";

const HOY = "2026-10-25"; // domingo

test("interpretar fechas que dicen los clientes", () => {
  assert.equal(interpretarFecha("mañana", HOY), "2026-10-26");
  assert.equal(interpretarFecha("pasado mañana", HOY), "2026-10-27");
  assert.equal(interpretarFecha("lo quiero para el viernes", HOY), "2026-10-30");
  assert.equal(interpretarFecha("el domingo", HOY), "2026-11-01"); // nunca hoy
  assert.equal(interpretarFecha("para el 30", HOY), "2026-10-30");
  assert.equal(interpretarFecha("para el 5", HOY), "2026-11-05"); // ya paso este mes
  assert.equal(interpretarFecha("el 3 de noviembre", HOY), "2026-11-03");
  assert.equal(interpretarFecha("2 de enero", HOY), "2027-01-02");
  assert.equal(interpretarFecha("30/10", HOY), "2026-10-30");
  assert.equal(interpretarFecha("15/11/2026", HOY), "2026-11-15");
  assert.equal(interpretarFecha("la próxima semana", HOY), null);
  assert.equal(interpretarFecha("", HOY), null);
});

test("fechas validas y dias que faltan", () => {
  assert.equal(fechaValida("2026-10-24", HOY), null); // pasada
  assert.equal(fechaValida("2026-02-30", HOY), null);
  assert.equal(fechaValida("2027-12-01", HOY), null); // muy lejos
  assert.equal(fechaValida("2026-10-25", HOY), "2026-10-25");
  assert.equal(diasHasta("2026-10-30", HOY), 5);
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(fechaDeExtraccion({ fechaEntregaISO: "2026-11-02", fechaEntregaSolicitada: "el 30" }, HOY), "2026-11-02");
  assert.equal(fechaDeExtraccion({ fechaEntregaISO: "", fechaEntregaSolicitada: "el 30" }, HOY), "2026-10-30");
});

test("programados: la IA no pisa una marca manual y quitar no deja que la IA reprograme", () => {
  const ruta = path.join(os.tmpdir(), `prog-${Date.now()}.json`);
  const p = crearProgramados({ ruta });
  const f1 = sumarDias(new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10), 3);
  const f2 = sumarDias(f1, 2);
  p.poner(7, { fecha: f1, origen: "manual", nota: "quincena", por: "ana@x.co" });
  p.poner(7, { fecha: f2, origen: "ia" });
  assert.equal(p.get(7).fecha, f1);
  assert.equal(p.get(7, { diasAntes: 1 }).estado, "en-espera");
  assert.equal(p.toca(7, 3), true);
  assert.equal(p.toca(7, 1), false);
  // persiste
  assert.equal(crearProgramados({ ruta }).get(7).nota, "quincena");
  assert.equal(p.quitar(7), true);
  assert.equal(p.get(7).estado, "enviar-ya");
  p.poner(7, { fecha: f2, origen: "ia" });
  assert.ok(p.get(7).anulado);
  assert.equal(p.lista().length, 0);
  assert.throws(() => p.poner(8, { fecha: "2020-01-01" }), /no es válida/);
  fs.rmSync(ruta, { force: true });
});
