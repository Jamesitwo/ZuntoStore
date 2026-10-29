import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearEtiquetas } from "../etiquetas.js";

test("etiquetas: crear, asignar, persistir y borrar", () => {
  const ruta = path.join(os.tmpdir(), `etiq-${Date.now()}.json`);
  const e = crearEtiquetas({ ruta });
  const vip = e.crear("6881", { id: "et_vip", nombre: "VIP", color: "#16a34a" });
  assert.equal(e.crear("6881", { nombre: "vip" }).id, "et_vip"); // mismo nombre: la misma
  e.asignar("6881", 10, ["et_vip", "no-existe"]);
  assert.deepEqual(e.almacen("6881").asignaciones, { 10: ["et_vip"] });
  assert.deepEqual(crearEtiquetas({ ruta }).pedidosCon("6881", vip.id), ["10"]);
  e.eliminar("6881", "et_vip");
  assert.deepEqual(e.almacen("6881"), { etiquetas: [], asignaciones: {} });
  fs.rmSync(ruta, { force: true });
});

test("etiquetas de la subida: una por motivo, se cambian y se quitan al subir; las manuales se respetan", () => {
  const e = crearEtiquetas({ ruta: null });
  e.crear("6881", { id: "et_vip", nombre: "VIP" });
  e.asignar("6881", 7, ["et_vip"]);
  e.porMotivo("6881", 7, "frenado");
  assert.deepEqual(e.almacen("6881").asignaciones[7], ["et_vip", "auto_frenado"]);
  e.porMotivo("6881", 7, "direccion-invalida");
  assert.deepEqual(e.almacen("6881").asignaciones[7], ["et_vip", "auto_direccion-invalida"]);
  assert.equal(e.almacen("6881").etiquetas.find((x) => x.id === "auto_direccion-invalida").nombre, "Dropi · Dirección inválida");
  e.porMotivo("6881", 7, "requiere-login"); // problema de sesion: no cambia nada
  assert.deepEqual(e.almacen("6881").asignaciones[7], ["et_vip", "auto_direccion-invalida"]);
  e.porMotivo("6881", 7, "subido");
  assert.deepEqual(e.almacen("6881").asignaciones[7], ["et_vip"]);
});

test("importar lo que habia en el navegador sin duplicar", () => {
  const e = crearEtiquetas({ ruta: null });
  e.crear("6881", { id: "a", nombre: "A" });
  const n = e.importar("6881", { etiquetas: [{ id: "a", nombre: "A" }, { id: "b", nombre: "B", color: "#dc2626" }], asignaciones: { 5: ["a", "b"] } });
  assert.equal(n, 1);
  assert.deepEqual(e.almacen("6881").asignaciones[5], ["a", "b"]);
});
