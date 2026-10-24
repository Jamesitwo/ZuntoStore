// Historial de intentos de subida por pedido.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearRegistroIntentos } from "../registroIntentos.js";

test("la misma vuelta actualiza el intento; una vuelta nueva distinta agrega otro", () => {
  const r = crearRegistroIntentos();
  r.registrar({ pedido: "7", clave: "a", origen: "automatica", accion: "subido", detalle: "Dropi #1" });
  r.registrar({ pedido: "7", clave: "a", origen: "automatica", accion: "subido", detalle: "Dropi #1; LucidSales Confirmado" });
  assert.equal(r.dePedido("7").length, 1);
  assert.match(r.dePedido("7")[0].detalle, /Confirmado/);
  r.registrar({ pedido: "7", clave: "b", origen: "manual", usuario: "a@b.co", accion: "frenado", detalle: "x" });
  const lista = r.dePedido("7");
  assert.equal(lista.length, 2);
  assert.equal(lista[0].origen, "manual"); // el mas nuevo primero
});

test("se guarda en disco y se lee al reiniciar", () => {
  const ruta = path.join(os.tmpdir(), `intentos-${Date.now()}.jsonl`);
  const r = crearRegistroIntentos({ ruta });
  r.registrar({ pedido: "9", clave: "a", origen: "automatica", accion: "error", detalle: "uno" });
  r.registrar({ pedido: "9", clave: "a", origen: "automatica", accion: "subido", detalle: "dos" });
  r.registrar({ pedido: "9", clave: "b", origen: "automatica", accion: "frenado", detalle: "tres" });
  const otro = crearRegistroIntentos({ ruta });
  assert.deepEqual(otro.dePedido("9").map((x) => x.detalle), ["tres", "dos"]);
  fs.rmSync(ruta, { force: true });
});
