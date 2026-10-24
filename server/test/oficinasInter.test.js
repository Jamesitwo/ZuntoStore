// ¿La direccion del cliente es una oficina de Interrapidisimo?
import test from "node:test";
import assert from "node:assert/strict";
import { claveCliente, claveDireccion, oficinaQueCoincide } from "../oficinasInter.js";

// tal cual las muestra Dropi en Medellin (lista real)
const DROPI = [
  "COL/MEDELLIN/ANT/COL/OF. PRINC CL 30 A 65 B 59",
  "PTO/MEDELLIN/ANT/COL/CALLE 96 #67-18",
  "PTO/MEDELLIN/ANT/COL/CL 48 CC 102 B 13 SAN JAVIER EL SOCORRO",
  "PTO/MEDELLIN/ANT/COL/KR 129 # 61 - 06",
  "PTO/MEDELLIN/ANT/COL/KR 50 NO 39 67 R.O",
  "PTO/MEDELLIN/ANT/COL/KR 53 EE 11 B SUR 17 R O",
];

test("claveDireccion entiende los formatos de Inter y Dropi", () => {
  assert.equal(claveDireccion("OF. PRINC CL 30 A 65 B 59"), "calle|30a|65b|59");
  assert.equal(claveDireccion("PTO/MEDELLIN/ANT/COL/CL 30 A 65 B 59 R.O"), "calle|30a|65b|59");
  assert.equal(claveDireccion("PTO/MEDELLIN/ANT/COL/KR 50 NO 39 67 R.O"), "cra|50|39|67");
  assert.equal(claveDireccion("PTO/MEDELLIN/ANT/COL/KR 129 # 61 - 06"), "cra|129|61|6");
  assert.equal(claveDireccion("Oficina Interrapidisimo calle 96 # 67-18"), "calle|96|67|18");
  assert.equal(claveDireccion("Oficina Interrapidisimo Sincelejo"), null);
});

test("la direccion del cliente, como sea que la escriba, encuentra su oficina", () => {
  assert.equal(oficinaQueCoincide("Calle 30A # 65B-59, Centro", DROPI), DROPI[0]);
  assert.equal(oficinaQueCoincide("Cl 96 67 18", DROPI), DROPI[1]);
  assert.equal(oficinaQueCoincide("Calle 48CC # 102B-13 San Javier", DROPI), DROPI[2]);
  assert.equal(oficinaQueCoincide("Cra 129 # 61-06", DROPI), DROPI[3]);
  assert.equal(oficinaQueCoincide("Carrera 50 # 39-67", DROPI), DROPI[4]);
  assert.equal(oficinaQueCoincide("Cra 53EE # 11B Sur-17", DROPI), DROPI[5]);
});

test("direcciones parecidas que NO son la oficina no coinciden", () => {
  assert.equal(oficinaQueCoincide("Calle 30A # 65B-58", DROPI), null); // otra placa
  assert.equal(oficinaQueCoincide("Cra 30A # 65B-59", DROPI), null); // carrera, no calle
  assert.equal(oficinaQueCoincide("Calle 96 # 67-81", DROPI), null);
  assert.equal(oficinaQueCoincide("casa verde", DROPI), null);
});

test("oficinas de Inter (objetos con direccion y nombre)", () => {
  const inter = [{ nombre: "PTO/MEDELLIN/ANT/COL/CLL 45 53 50", direccion: "CLL 45 53 50" }];
  assert.equal(oficinaQueCoincide("Calle 45 # 53-50, Barrio Centro", inter), inter[0]);
  assert.equal(claveCliente("Calle 45 # 53-50, Barrio Centro"), "calle|45|53|50");
});
