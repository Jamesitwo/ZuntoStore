// Direcciones de Colombia: reglas fijas, correccion de la IA y su verificacion.
import test from "node:test";
import assert from "node:assert/strict";
import { validarDireccion, parsearDireccion, tipoViaCanonico, recogeEnOficina } from "../direccionColombia.js";

const validas = [
  ["cra 40#23-23, centro", "Cra 40 # 23-23, Centro"],
  ["Cra 40 # 23-23 Centro", "Cra 40 # 23-23, Centro"],
  ["calle 8 sur # 2a-15 apto 301", "Calle 8 Sur # 2A-15, Apto 301"],
  ["CL 45 No. 12 - 30 barrio La Floresta", "Calle 45 # 12-30, Barrio La Floresta"],
  ["Carrera 29A Bis B # 10-5 Este", "Cra 29A Bis B # 10-5 Este"],
  ["av cra 30 # 45-03", "Av. Carrera 30 # 45-03"],
  ["Diagonal 40 sur #78b-02 torre 2 apto 503", "Diagonal 40 Sur # 78B-02, Torre 2 apto 503"],
  ["Tv 5 n° 12-34", "Transversal 5 # 12-34"],
  ["Calle 10 # 5 - 20 Sur, Santa Fe", "Calle 10 # 5-20 Sur, Santa Fe"],
  ["Kr 7 #45-10", "Cra 7 # 45-10"],
];
for (const [entrada, esperada] of validas) {
  test(`válida por reglas: ${entrada}`, () => {
    const r = validarDireccion(entrada);
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.normalizada, esperada);
    assert.equal(r.origen, "reglas");
  });
}

const invalidas = [
  "casa verde al lado de panaderia pedro",
  "frente al parque principal",
  "frente a la cra 5 casa azul",
  "vereda el placer finca los pinos",
  "",
];
for (const entrada of invalidas) {
  test(`inválida sin IA: "${entrada}"`, () => {
    assert.equal(validarDireccion(entrada).ok, false);
  });
}

test("la IA corrige separadores sin cambiar numeros: cra 21 #1212 -> Cra 21 # 12-12", () => {
  const r = validarDireccion("cra 21 #1212", { esNomenclatura: true, tipoVia: "Carrera", via: "21", cruce: "12", placa: "12" });
  assert.equal(r.ok, true);
  assert.equal(r.normalizada, "Cra 21 # 12-12");
  assert.equal(r.corregida, true);
  assert.equal(r.origen, "ia");
});

test("con barrio y complemento: se agregan al final", () => {
  const r = validarDireccion("calle 5 numero 3 20 apto 2 centro", {
    esNomenclatura: true, tipoVia: "Calle", via: "5", cruce: "3", placa: "20", complemento: "apto 2", barrio: "Centro",
  });
  assert.equal(r.normalizada, "Calle 5 # 3-20, Apto 2, Centro");
});

test("si la IA cambia un numero, el codigo la rechaza", () => {
  const r = validarDireccion("cra 21 #1212", { esNomenclatura: true, tipoVia: "Carrera", via: "21", cruce: "12", placa: "13" });
  assert.equal(r.ok, false);
  assert.match(r.detalle, /no conserva los números/);
});

test("si la IA se inventa una direccion para un texto descriptivo, se rechaza", () => {
  const r = validarDireccion("casa verde al lado de panaderia pedro", { esNomenclatura: true, tipoVia: "Calle", via: "1", cruce: "2", placa: "3" });
  assert.equal(r.ok, false);
});

test("si la IA dice que no es nomenclatura, el motivo queda en el detalle", () => {
  const r = validarDireccion("casa verde", { esNomenclatura: false, motivo: "es una descripción" });
  assert.equal(r.ok, false);
  assert.match(r.detalle, /es una descripción/);
});

test("rural: no se acepta aunque la IA proponga partes", () => {
  const r = validarDireccion("vereda la palma km 5", { esNomenclatura: true, tipoVia: "Calle", via: "5", cruce: "1", placa: "1" });
  assert.equal(r.ok, false);
  assert.match(r.detalle, /rural/);
});

test("tipos de via con sus abreviaturas", () => {
  assert.equal(tipoViaCanonico("Cll"), "Calle");
  assert.equal(tipoViaCanonico("KR"), "Cra");
  assert.equal(tipoViaCanonico("dg."), "Diagonal");
  assert.equal(tipoViaCanonico("AK"), "Av. Carrera");
  assert.equal(tipoViaCanonico("panaderia"), null);
  assert.equal(parsearDireccion("frente a la cra 5 # 3-2"), null);
});

// ---- formato manzana ----
const manzanas = [
  ["Mz B Cs 12 barrio Los Almendros", "Mz B Cs 12, Barrio Los Almendros"],
  ["Manzana 12 Casa 4, Urbanización El Bosque", "Mz 12 Cs 4, Urbanización El Bosque"],
  ["Barrio Villa Olímpica Mz 7 Lt 3", "Mz 7 Lt 3, Barrio Villa Olímpica"],
  ["SMZ 7 Mz 3 Cs 10 Ciudadela Real", "Smz 7 Mz 3 Cs 10, Ciudadela Real"],
  ["mza 3 lote 8 sector la esperanza", "Mz 3 Lt 8, Sector la esperanza"],
  ["Casa 12 Mz F, Los Robles", "Mz F Cs 12, Los Robles"],
  ["Mz. 4 Cs. 2 - Conjunto Los Pinos", "Mz 4 Cs 2, Conjunto Los Pinos"],
  ["Urb. El Prado mz c casa 7", "Mz C Cs 7, Urb. El Prado"],
];
for (const [entrada, esperada] of manzanas) {
  test(`manzana válida por reglas: ${entrada}`, () => {
    const r = validarDireccion(entrada);
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.normalizada, esperada);
  });
}

test("manzana sin barrio no se acepta", () => {
  const r = validarDireccion("mz 5 cs 3");
  assert.equal(r.ok, false);
  assert.match(r.detalle, /falta el barrio/);
});

test("lote dentro de una direccion urbana no es rural", () => {
  assert.equal(validarDireccion("mza 3 lote 8 sector la esperanza").ok, true);
  assert.equal(validarDireccion("Calle 5 # 3-20 Lote 2").ok, true);
  assert.equal(validarDireccion("lote 5 vereda el carmen").ok, false);
});

test("la IA separa una manzana pegada si conserva los numeros", () => {
  const ia = { esNomenclatura: true, formato: "manzana", manzana: "3", casa: "15", barrio: "Villa Rosa" };
  assert.equal(validarDireccion("mz3cs15 villa rosa", ia).normalizada, "Mz 3 Cs 15, Villa Rosa");
  const mala = validarDireccion("mz3cs15 villa rosa", { ...ia, casa: "16" });
  assert.equal(mala.ok, false);
});

test("la IA no puede convertir un texto descriptivo en manzana o en calle", () => {
  const desc = "casa verde al lado de panaderia pedro";
  assert.equal(validarDireccion(desc, { esNomenclatura: true, formato: "manzana", manzana: "A", casa: "B", barrio: "Pedro" }).ok, false);
  assert.equal(validarDireccion("al lado del parque 5 2 3", { esNomenclatura: true, tipoVia: "Calle", via: "5", cruce: "2", placa: "3" }).ok, false);
});

test("detecta recogida en oficina de Inter o Coordinadora", () => {
  for (const t of ["RECOGER EN OFICINA COORDINADORA", "oficina inter rapidisimo centro", "Recoger en Inter, sede principal",
    "reclama en coordinadora", "Interrapidisimo calle 10", "punto inter barrio x", "sede interrapidísimo"]) {
    assert.ok(recogeEnOficina(t), t);
  }
  assert.equal(recogeEnOficina("Cra 1 # 2-3", "recoger en oficina inter"), "Inter Rapidísimo"); // en referencias
});

test("no confunde 'interior' ni direcciones normales con oficinas", () => {
  for (const t of ["Calle 5 # 3-20 interior 2", "Cra 40 # 23-23 inter 2", "Cra 40 # 23-23", "oficina de envia"]) {
    assert.equal(recogeEnOficina(t), null, t);
  }
});

test("sin guion entre cruce y placa tambien es valida (y se escribe con guion)", () => {
  const casos = [
    ["Carrera 91a # 128 f 14", "Cra 91A # 128F-14"],
    ["Cra 91A # 128F 14, Suba", "Cra 91A # 128F-14, Suba"],
    ["Calle 10 # 5 20", "Calle 10 # 5-20"],
    ["Cra 7 # 45 120", "Cra 7 # 45-120"],
  ];
  for (const [entrada, esperada] of casos) {
    const r = validarDireccion(entrada);
    assert.equal(r.ok, true, entrada);
    assert.equal(r.normalizada, esperada, entrada);
    assert.equal(r.corregida, true);
  }
  // el numero pegado sigue sin ser valido por reglas (lo decide el mapa)
  assert.equal(validarDireccion("Cra 21 #1212").ok, false);
});

test("sin guion: si la IA cambia un numero, vale la lectura de las reglas", () => {
  const r = validarDireccion("Carrera 91a # 128 f 14", {
    esNomenclatura: true, tipoVia: "Carrera", via: "91A", cruce: "128F", placa: "41",
  });
  assert.equal(r.ok, true);
  assert.equal(r.normalizada, "Cra 91A # 128F-14");
});

test("«Car» es Carrera y sin «#» vale con coma o espacio si la placa trae guion", () => {
  assert.equal(validarDireccion("Car 5, 4-98 calle Bogotá").normalizada, "Cra 5 # 4-98, Calle Bogotá");
  assert.equal(validarDireccion("Cra 5 4-98").normalizada, "Cra 5 # 4-98");
  assert.equal(validarDireccion("Calle 45 12-30 barrio Centro").normalizada, "Calle 45 # 12-30, Barrio Centro");
  // sin "#" y sin guion es ambiguo: no se acepta por reglas
  assert.equal(validarDireccion("Calle 45 12 30").ok, false);
  assert.equal(validarDireccion("Car 5").ok, false);
});

test("manzana sin barrio: vale si el barrio viene en las referencias del pedido", () => {
  assert.equal(validarDireccion("Manzana A, casa 14").ok, false);
  const r = validarDireccion("Manzana A, casa 14", null, { referencias: "Urbanización Los Pinos" });
  assert.equal(r.ok, true);
  assert.equal(r.normalizada, "Mz A Cs 14, Urbanización Los Pinos");
  // referencias vacias o sin letras no cuentan
  assert.equal(validarDireccion("Manzana A, casa 14", null, { referencias: " - " }).ok, false);
});

test("direccionConReferencias: direccion, coma y referencias sin repetir", async () => {
  const { direccionConReferencias } = await import("../direccionColombia.js");
  assert.equal(direccionConReferencias("Cra 40 # 23-23", "Barrio Centro"), "Cra 40 # 23-23, Barrio Centro");
  assert.equal(direccionConReferencias("Mz A Cs 14, Urbanización Los Pinos", "urbanizacion los pinos"), "Mz A Cs 14, Urbanización Los Pinos");
  assert.equal(direccionConReferencias("Cra 5 # 4-98", "   "), "Cra 5 # 4-98");
});
