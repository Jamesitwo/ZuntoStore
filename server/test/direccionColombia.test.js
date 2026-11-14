// Direcciones de Colombia: reglas fijas, correccion de la IA y su verificacion.
import test from "node:test";
import assert from "node:assert/strict";
import { claveCalle, validarDireccion, parsearDireccion, tipoViaCanonico, recogeEnOficina } from "../direccionColombia.js";

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
  // sin "#" ni guion: tres numeros se leen como via, cruce y placa
  assert.equal(validarDireccion("Calle 45 12 30").normalizada, "Calle 45 # 12-30");
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

test("letra del cruce pegada a la placa: «#82 C19» = cruce 82C, placa 19", () => {
  assert.equal(parsearDireccion("Calle 51B Sur #82 C19, urbanización de casas").normalizada, "Calle 51B Sur # 82C-19, Urbanización de casas");
  assert.equal(parsearDireccion("Calle 51B Sur # 82c19").normalizada, "Calle 51B Sur # 82C-19");
});

test("claveCalle encuentra la calle aunque el texto traiga ciudad y barrio antes", () => {
  assert.equal(
    claveCalle("Cundinamarca Bogotá Villa Andrea Kennedy Calle 51B Sur #82 C19 urbanización de casas"),
    claveCalle("Calle 51B Sur #82 C19, urbanización de casas"),
  );
  assert.notEqual(claveCalle("Kennedy Calle 51B Sur #82 C18"), claveCalle("Calle 51B Sur #82 C19"));
  assert.equal(claveCalle("casa verde frente al parque"), null);
});

test("la calle no tiene que ir al principio y con dos tipos seguidos vale el segundo", () => {
  assert.equal(validarDireccion("Etapa Tres, Calle KR 5 No. 19-105").normalizada, "Cra 5 # 19-105, Etapa Tres");
  assert.equal(validarDireccion("Calle KR 5 No. 19-105").normalizada, "Cra 5 # 19-105");
  assert.equal(validarDireccion("Barrio Calle Real, Cra 5 # 3-20").normalizada, "Cra 5 # 3-20, Barrio Calle Real");
  // compuestos de verdad se respetan
  assert.equal(validarDireccion("Av Calle 80 # 20-10").normalizada, "Av. Calle 80 # 20-10");
  // una referencia no es la direccion
  assert.equal(validarDireccion("Cerca de la Cra 5 # 3-20").ok, false);
});

test("solo espacios con tres numeros: via, cruce y placa", () => {
  assert.equal(validarDireccion("Calle 40 AA Sur 36 30, Apto 806").normalizada, "Calle 40AA Sur # 36-30, Apto 806");
  assert.equal(validarDireccion("Cra 5 4 98 barrio centro").normalizada, "Cra 5 # 4-98, Barrio centro");
  // con dos numeros sigue siendo ambiguo
  assert.equal(validarDireccion("cra 21 1212").ok, false);
  assert.equal(claveCalle("calle 40 AA sur 36 30 apto806"), claveCalle("Calle 40 AA Sur 36 30, Apto 806"));
  // Bis con letra conserva el espacio
  assert.equal(validarDireccion("Calle 4 Bis B # 10-20").normalizada, "Calle 4 Bis B # 10-20");
});

test("pegados: «78Asur» y «número 50f34»", () => {
  assert.equal(
    validarDireccion("Calle 78Asur número 50f34 (a 7 minutos caminando de la estación del metro)").normalizada,
    "Calle 78A Sur # 50F-34, (a 7 minutos caminando de la estación del metro)",
  );
  assert.equal(claveCalle("Calle 78Asur número 50f34"), claveCalle("Calle 78A Sur # 50F-34"));
});

test("tipos de vía como los escriben los clientes: Krra, Karrera, Cale...", async () => {
  const { tipoViaCanonico, validarDireccion } = await import("../direccionColombia.js");
  for (const t of ["Krra", "krr", "Karrera", "Carera", "Crra"]) assert.equal(tipoViaCanonico(t), "Cra", t);
  for (const t of ["Cale", "Kalle", "Clle"]) assert.equal(tipoViaCanonico(t), "Calle", t);
  assert.equal(tipoViaCanonico("Tranv"), "Transversal");
  const r = validarDireccion("Krra 63 #18-49 Sur, Almacén de dotaciones");
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.normalizada, /^Cra 63 # 18-49 Sur/);
});

test("números en letras: Manzana G, lote uno = Mz G Lt 1 (sigue pidiendo barrio)", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  assert.equal(validarDireccion("Manzana G, lote uno, barrio Las Flores").normalizada, "Mz G Lt 1, Barrio Las Flores");
  assert.equal(validarDireccion("manzana dos casa veintidós barrio Centro").normalizada, "Mz 2 Cs 22, Barrio Centro");
  const r = validarDireccion("Manzana G, lote uno");
  assert.equal(r.ok, false);
  assert.match(r.detalle, /falta el barrio/);
});

test("manzana abreviada M45 L30 (= Mz 45 Lt 30)", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("M45 L30 barrio Plan Parejo, al lado de la ferretería la 45");
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.normalizada, /^Mz 45 Lt 30, /);
  // igual que "Mz 45 Lt 30, Turbaco...": lo demas se toma como barrio/referencia
  r = validarDireccion("Turbaco, M45 L30 al lado de la ferretería la 45");
  assert.equal(r.normalizada, "Mz 45 Lt 30, Turbaco, al lado de la ferretería la 45");
  // una manzana sola, sin nada mas, sigue sin servir
  assert.equal(validarDireccion("M45 L30").ok, false);
  // una "M" sin lote ni casa no es manzana
  assert.equal(validarDireccion("M45 barrio Centro").ok, false);
});

test("letra de la vía separada con punto: Calle 9.a No. 14-47 = Calle 9A # 14-47", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  const r = validarDireccion("Calle 9.a No. 14-47, Piso 2");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 9A # 14-47, Piso 2");
});

test("vía con doble letra y cruce con su tipo: Calle 100 BB Carrera 30 C 25", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Calle 100 BB Carrera 30 C 25 Interior 201");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 100BB # 30C-25, Interior 201");
  // "y" / "x" entre las vías son conectores, no letras
  assert.equal(validarDireccion("Cra 12 y calle 12-12").normalizada, "Cra 12 # 12-12");
  assert.equal(validarDireccion("Cra 12 x calle 12-12").normalizada, "Cra 12 # 12-12");
  assert.equal(validarDireccion("Cra 12 B calle 12-12").normalizada, "Cra 12B # 12-12");
});

test("esquina + número de la casa: Calle 43 con Carrera 17, casa 17-15 = Calle 43 # 17-15", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Calle 43 con Carrera 17, casa 17-15");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 43 # 17-15");
  r = validarDireccion("Calle 43 con Carrera 17, número de la casa 17-15");
  assert.equal(r.normalizada, "Calle 43 # 17-15");
  r = validarDireccion("Calle 43 con Carrera 17 #17-15 barrio x");
  assert.equal(r.normalizada, "Calle 43 # 17-15, Barrio x");
  // si la casa no empieza por el número de la vía que cruza, no se adivina
  assert.equal(validarDireccion("Calle 43 con Carrera 18, casa 17-15").ok, false);
  // lo de antes sigue igual
  assert.equal(validarDireccion("Cra 12 con calle 12 - 12").normalizada, "Cra 12 # 12-12");
});

test("placa con letra pegada: Calle 10 No. 10-11B = Calle 10 # 10-11B", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Calle 10 No. 10-11B, Centro");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 10 # 10-11B, Centro");
  r = validarDireccion("Cra 5 # 3-20b apto 2");
  assert.equal(r.normalizada, "Cra 5 # 3-20B, Apto 2");
  // la palabra que sigue no se toma como letra
  r = validarDireccion("Calle 10 # 10-11 Barrio Centro");
  assert.equal(r.normalizada, "Calle 10 # 10-11, Barrio Centro");
});

test("tipo de vía mal escrito (Ce 10#10-27): vale el de la dirección confirmada en el chat con los mismos números", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  const ia = { esNomenclatura: true, formato: "via", tipoVia: "Calle", via: "10", cruce: "10", placa: "27" };
  let r = validarDireccion("Ce 10#10-27", ia, { confirmadaEnChat: "Calle 10 # 10-27" });
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 10 # 10-27");
  assert.match(r.detalle, /confirmó en el chat/);
  // sin el chat, o con otros numeros u otro tipo, sigue para revision
  assert.equal(validarDireccion("Ce 10#10-27", ia).ok, false);
  assert.equal(validarDireccion("Ce 10#10-27", ia, { confirmadaEnChat: "Calle 10 # 10-28" }).ok, false);
  assert.equal(validarDireccion("Ce 10#10-27", { ...ia, tipoVia: "Carrera" }, { confirmadaEnChat: "Calle 10 # 10-27" }).ok, false);
});

test("letra de la vía separada con guion: Carrera 3-D #50-130 = Cra 3D # 50-130", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Carrera 3-D #50-130");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Cra 3D # 50-130");
  r = validarDireccion("Calle 12 - b No. 4-20 barrio Centro");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 12B # 4-20, Barrio Centro");
});

test("orientación Oeste y Norte (Cali): Calle 4B Oeste 71A-03", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Calle 4B Oeste 71A-03, Casa");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 4B Oeste # 71A-03, Casa");
  r = validarDireccion("Cra 4 Oeste # 3-20");
  assert.equal(r.normalizada, "Cra 4 Oeste # 3-20");
  r = validarDireccion("Calle 4B Norte # 71A-03");
  assert.equal(r.normalizada, "Calle 4B Norte # 71A-03");
  r = validarDireccion("Carrera 28 No. 4 Norte-35");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Cra 28 # 4 Norte-35");
  r = validarDireccion("Cra 5 # 10-20 Oeste");
  assert.equal(r.normalizada, "Cra 5 # 10-20 Oeste");
  // sigue igual lo de siempre
  r = validarDireccion("Calle 78Asur # 5-10");
  assert.equal(r.normalizada, "Calle 78A Sur # 5-10");
});

test("'#' pegado al tipo de vía y 'Casa #': Transversal #2 Casa #16-140 = Transversal 2 # 16-140", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Transversal #2 Casa #16-140");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Transversal 2 # 16-140");
  assert.equal(validarDireccion("Calle #5 # 3-20").normalizada, "Calle 5 # 3-20");
  assert.equal(validarDireccion("Transversal #2 #16-140, barrio x").normalizada, "Transversal 2 # 16-140, Barrio x");
});

test("'casa' tras coma en lugar del numeral: Calle 54, casa 28-34 = Calle 54 # 28-34", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  const r = validarDireccion("Calle 54, casa 28-34, sector Poso 7");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 54 # 28-34, Sector Poso 7");
  // la via despues de "con" es la que cruza: no se toma como la direccion
  assert.equal(validarDireccion("Calle 43 con Carrera 18, casa 17-15").ok, false);
});

test("'casa' en lugar del numeral: Carrera 1 Casa 8-59 = Cra 1 # 8-59", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Carrera 1 Casa 8-59");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Cra 1 # 8-59");
  r = validarDireccion("Calle 5A casa 3-20 barrio Centro");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Calle 5A # 3-20, Barrio Centro");
  // "casa" como complemento sigue igual
  r = validarDireccion("Calle 10 # 5-20 casa 3");
  assert.equal(r.normalizada, "Calle 10 # 5-20, Casa 3");
});

test("letra del cruce separada con guion: 11-B-13 = 11B-13", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Carrera 8 #11-B-13, Edificio Asis Apto 501");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Cra 8 # 11B-13, Edificio Asis Apto 501");
  r = validarDireccion("Cra 8 # 11 - b - 13");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Cra 8 # 11B-13");
});

test("punto en vez de guion entre cruce y placa: 23.47 = 23-47", async () => {
  const { validarDireccion } = await import("../direccionColombia.js");
  let r = validarDireccion("Cll 50 B # 23.47 B, Piso 1");
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.normalizada, /^Calle 50B # 23-47, B, Piso 1$/);
  r = validarDireccion("cll 50 b # 23.47.b Venecia");
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.normalizada, /^Calle 50B # 23-47/);
  r = validarDireccion("Calle 10 No. 5.20");
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.normalizada, /^Calle 10 # 5-20/);
  assert.equal(validarDireccion("Calle 10 No. 5-20").normalizada, "Calle 10 # 5-20");
});

test("casa/lote dentro de un conjunto o urbanización (sin manzana)", () => {
  const r = validarDireccion("Villas de Vizcaya, Lote 5 Casa 49");
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.normalizada, "Lt 5 Cs 49, Villas de Vizcaya");
  assert.equal(validarDireccion("Conjunto Los Pinos casa 12").normalizada, "Cs 12, Conjunto Los Pinos");
  // con manzana sigue igual
  assert.equal(validarDireccion("Mz B Cs 12, Los Almendros").normalizada, "Mz B Cs 12, Los Almendros");
  // sin nombre del sitio, descriptiva o rural: no
  assert.equal(validarDireccion("Lote 5").ok, false);
  assert.equal(validarDireccion("casa 3 al lado de la tienda").ok, false);
  assert.equal(validarDireccion("Lote 4, Vereda El Hato").ok, false);
});

test("vía con nombre, cruce escrito con su tipo y la placa como «casa»", () => {
  const casos = [
    ["Calle Colombia #12-34", "Calle Colombia # 12-34"],
    ["Avenida Boyacá # 12-34 Sur, Kennedy", "Avenida Boyacá # 12-34 Sur, Kennedy"],
    ["Cra 12 calle 12-12", "Cra 12 # 12-12"],
    ["cra 12 calle 12 - 12 barrio x", "Cra 12 # 12-12, Barrio x"],
    ["Carrera 12 con calle 12 # 12", "Cra 12 # 12-12"],
    ["Cra 12 con Cl 12 #12, Centro", "Cra 12 # 12-12, Centro"],
    ["cra 12 #21 casa 21", "Cra 12 # 21-21"],
    ["cra 12 # 21 casa 21, Barrio Centro", "Cra 12 # 21-21, Barrio Centro"],
    // con placa, la casa es complemento
    ["Cra 12 # 21-30 casa 21", "Cra 12 # 21-30, Casa 21"],
  ];
  for (const [d, esperada] of casos) {
    const r = validarDireccion(d);
    assert.equal(r.ok, true, `${d}: ${r.detalle}`);
    assert.equal(r.normalizada, esperada, d);
  }
  // sigue sin aceptar referencias
  assert.equal(validarDireccion("frente a la cra 5 # 3-2").ok, false);
});

test("«Krera», «Kerrera», «Crera»… también son Carrera", () => {
  for (const t of ["Krera", "Kerrera", "Kerera", "Crera", "Carrea"]) {
    assert.equal(validarDireccion(`${t} 27 A # 20-52, Mirador del Norte`).normalizada, "Cra 27A # 20-52, Mirador del Norte", t);
  }
});
