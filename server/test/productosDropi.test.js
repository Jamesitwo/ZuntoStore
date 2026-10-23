// Google Sheets de productos -> link de Dropi (fetch falso).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearProductosDropi, urlCsvDeSheet } from "../productosDropi.js";

const CSV = [
  "par,Nombre,idProductoDropi,nameProductoDropi,dropiLink,transportadora",
  '1,"Taladro, 68V",111,Taladro,https://app.dropi.co/dashboard/product-details/111/taladro,',
  "2,Perfume,222,Perfume,,",
].join("\n");

function armar({ texto = CSV, status = 200, ruta = null, url = "" } = {}) {
  const pedidas = [];
  const fetchImpl = async (u) => {
    pedidas.push(u);
    return { status, text: async () => texto };
  };
  return { p: crearProductosDropi({ url, ruta, fetchImpl, log: { warn() {} } }), pedidas };
}

test("urlCsvDeSheet: el link normal del navegador se vuelve CSV", () => {
  assert.equal(
    urlCsvDeSheet("https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/edit#gid=0"),
    "https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/export?format=csv&gid=0",
  );
  assert.equal(urlCsvDeSheet("https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pubhtml"), "https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pub?output=csv");
  assert.equal(urlCsvDeSheet("https://otro.com/sheet"), null);
  assert.equal(urlCsvDeSheet("no es un link"), null);
});

test("probar cuenta filas y las que no tienen dropiLink", async () => {
  const { p } = armar();
  const r = await p.probar("https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/edit");
  assert.equal(r.filas, 2);
  assert.equal(r.sinLink, 1);
  assert.deepEqual(r.ejemplos, ["Taladro, 68V", "Perfume"]);
});

test("probar: si Google devuelve una pagina (sheet privado) lo dice claro", async () => {
  const { p } = armar({ texto: "<!DOCTYPE html><html>login</html>" });
  await assert.rejects(p.probar("https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/edit"), /Cualquier persona con el enlace/);
});

test("probar: sin las columnas necesarias, dice cuales vio", async () => {
  const { p } = armar({ texto: "a,b,c\n1,2,3" });
  await assert.rejects(p.probar("https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/edit"), /columnas vistas: a, b, c/);
});

test("guardar desde el panel manda sobre el .env y se puede volver", async () => {
  const ruta = path.join(os.tmpdir(), `prod-dropi-${Date.now()}.json`);
  const { p, pedidas } = armar({ ruta, url: "https://docs.google.com/spreadsheets/d/DEL-ENV-xxxxxxxxxxxxxxxxxx/export?format=csv" });
  assert.equal(p.estado().origen, ".env");
  const e = await p.guardar("https://docs.google.com/spreadsheets/d/1I6w0diNVM00Ch08MvH24Gh_QkDv-mRmfCrcpFDz6AZM/edit#gid=5");
  assert.equal(e.origen, "panel");
  assert.equal(e.filas, 2);
  assert.match(e.csv, /export\?format=csv&gid=5$/);
  assert.equal((await p.buscar("111")).dropiLink, "https://app.dropi.co/dashboard/product-details/111/taladro");
  assert.match(pedidas.at(-1), /gid=5/);

  // al reiniciar se lee lo guardado
  const otra = crearProductosDropi({ url: "https://docs.google.com/x", ruta, fetchImpl: async () => ({ status: 200, text: async () => CSV }) });
  assert.equal(otra.estado().origen, "panel");

  const v = await p.guardar("");
  assert.equal(v.origen, ".env");
  fs.rmSync(ruta, { force: true });
});

test("guardar rechaza links que no son de Google Sheets", async () => {
  const ruta = path.join(os.tmpdir(), `prod-dropi-${Date.now()}-b.json`);
  const { p } = armar({ ruta });
  await assert.rejects(p.guardar("https://example.com/hoja"), /Google Sheets/);
  assert.equal(fs.existsSync(ruta), false);
});
