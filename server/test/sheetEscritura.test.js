// Agregar productos al Google Sheets con el Apps Script de la hoja.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { crearProductosDropi, textoScript } from "../productosDropi.js";

/** Ejecuta el Apps Script sobre una hoja falsa (como lo haria Google). */
function hojaConScript(codigo, cabecera, filas = []) {
  const datos = [cabecera, ...filas];
  const hoja = {
    getSheetId: () => 123,
    getName: () => "Productos",
    getLastColumn: () => cabecera.length,
    getLastRow: () => datos.length,
    getRange: (f, c, nf, nc) => ({ getValues: () => datos.slice(f - 1, f - 1 + nf).map((r) => r.slice(c - 1, c - 1 + nc)) }),
    appendRow: (r) => datos.push(r),
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [hoja] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => t }) },
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return { datos, doPost: (cuerpo) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } })) };
}

test("el Apps Script agrega la fila en el orden de las columnas y no duplica", () => {
  const cab = ["par", "Nombre", "idProductoDropi", "nameProductoDropi", "dropiLink", "transportadora"];
  const { datos, doPost } = hojaConScript(textoScript("s3cr3to", "123"), cab, [["", "Taladro", "111", "Taladro X", "https://app.dropi.co/x", ""]]);
  assert.equal(doPost({ secreto: "mal", probar: true }).ok, false);
  assert.deepEqual(doPost({ secreto: "s3cr3to", probar: true }).columnas, cab);
  const fila = { Nombre: "Cargador 12V", idProductoDropi: "222", nameProductoDropi: "Cargador PRO", dropiLink: "https://app.dropi.co/y", transportadora: "", par: "" };
  assert.equal(doPost({ secreto: "s3cr3to", fila }).ok, true);
  assert.deepEqual(datos.at(-1), ["", "Cargador 12V", "222", "Cargador PRO", "https://app.dropi.co/y", ""]);
  assert.equal(doPost({ secreto: "s3cr3to", fila }).yaEstaba, true);
  assert.equal(datos.length, 3);
});

test("Zunto: conectar el script, agregar el producto y avisar si ya estaba", async () => {
  const ruta = path.join(os.tmpdir(), `pd-${Date.now()}.json`);
  const cab = ["Nombre", "idProductoDropi", "nameProductoDropi", "dropiLink"];
  let hoja = null;
  const fetchImpl = async (url, op) => {
    if (url.startsWith("https://script.google.com/")) return new Response(JSON.stringify(hoja.doPost(JSON.parse(op.body))));
    return new Response("idProductoDropi,dropiLink\n1,x");
  };
  const pd = crearProductosDropi({ url: "", ruta, fetchImpl, log: { log() {}, warn() {} } });
  const codigo = pd.codigoScript();
  assert.match(codigo, /const SECRETO = "[0-9a-f]{36}"/);
  hoja = hojaConScript(codigo, cab);
  await assert.rejects(pd.agregar({ idProductoDropi: "5" }), /Conecta primero/);
  await assert.rejects(pd.guardarEscritura("https://otra.cosa/exec"), /URL de la implementación/);
  const e = await pd.guardarEscritura("https://script.google.com/macros/s/AKfyc_abc-123/exec");
  assert.equal(e.escritura.configurada, true);
  const r = await pd.agregar({ Nombre: "Cargador", idProductoDropi: "2246501", nameProductoDropi: "Cargador 12V PRO", dropiLink: "https://app.dropi.co/dashboard/product-details/2246501" });
  assert.equal(r.yaEstaba, false);
  assert.deepEqual(hoja.datos.at(-1), ["Cargador", "2246501", "Cargador 12V PRO", "https://app.dropi.co/dashboard/product-details/2246501"]);
  assert.equal((await pd.agregar({ idProductoDropi: "2246501" })).yaEstaba, true);
  // sigue conectado al recargar
  const pd2 = crearProductosDropi({ url: "", ruta, fetchImpl, log: { log() {}, warn() {} } });
  assert.equal(pd2.estado().escritura.configurada, true);
  fs.rmSync(ruta, { force: true });
});
