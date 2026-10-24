// Claves cifradas en disco.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cifrarArchivosEnClaro, configurarClaveMaestra, escribirJsonSeguro, leerJsonSeguro } from "../secretos.js";
import { crearCredenciales } from "../credenciales.js";
import { crearLucidBotContactos } from "../lucidbotContactos.js";

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sec-")), n);

test("con CLAVE_MAESTRA las claves no quedan legibles en disco y se leen igual", () => {
  configurarClaveMaestra("una-clave-maestra-de-prueba");
  try {
    const ruta = tmp("credenciales.json");
    const config = {};
    crearCredenciales({ ruta, config }).guardar("dueno@zunto.co", "secreto-123");
    const crudo = fs.readFileSync(ruta, "utf8");
    assert.doesNotMatch(crudo, /secreto-123|dueno@zunto/);
    assert.match(crudo, /"cifrado": "zs-v1"/);
    const otra = {};
    crearCredenciales({ ruta, config: otra });
    assert.equal(otra.LUCID_PASSWORD, "secreto-123");

    const rutaLb = tmp("lucidbot.json");
    crearLucidBotContactos({ ruta: rutaLb }).configurar({ token: "tok-lucid-bot-123" });
    assert.doesNotMatch(fs.readFileSync(rutaLb, "utf8"), /tok-lucid-bot-123/);
    assert.equal(crearLucidBotContactos({ ruta: rutaLb }).estado().tokenConfigurado, true);
  } finally {
    configurarClaveMaestra("");
  }
});

test("los archivos que estaban en claro se cifran al arrancar", () => {
  const ruta = tmp("llm.json");
  fs.writeFileSync(ruta, JSON.stringify({ apiKey: "sk-en-claro-1234567890" }));
  configurarClaveMaestra("otra-clave");
  try {
    assert.equal(cifrarArchivosEnClaro([ruta, tmp("no-existe.json")]), 1);
    assert.doesNotMatch(fs.readFileSync(ruta, "utf8"), /sk-en-claro/);
    assert.equal(leerJsonSeguro(ruta).apiKey, "sk-en-claro-1234567890");
    assert.equal(cifrarArchivosEnClaro([ruta]), 0, "no se cifra dos veces");
  } finally {
    configurarClaveMaestra("");
  }
});

test("con otra clave el archivo no se abre (y sin clave tampoco)", () => {
  const ruta = tmp("mapas.json");
  configurarClaveMaestra("clave-a");
  escribirJsonSeguro(ruta, { apiKey: "AIza-x" });
  configurarClaveMaestra("clave-b");
  assert.throws(() => leerJsonSeguro(ruta));
  configurarClaveMaestra("");
  assert.throws(() => leerJsonSeguro(ruta), /falta CLAVE_MAESTRA/);
});

test("sin CLAVE_MAESTRA todo sigue en claro como antes", () => {
  configurarClaveMaestra("");
  const ruta = tmp("x.json");
  escribirJsonSeguro(ruta, { token: "abc" });
  assert.equal(JSON.parse(fs.readFileSync(ruta, "utf8")).token, "abc");
});
