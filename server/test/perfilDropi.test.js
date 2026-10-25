import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liberarPerfil } from "../dropiNavegador.js";

function perfilCon(destino) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "perfil-"));
  fs.symlinkSync(destino, path.join(d, "SingletonLock"));
  fs.writeFileSync(path.join(d, "SingletonCookie"), "x");
  return d;
}
const hay = (d) => fs.existsSync(path.join(d, "SingletonCookie"));

test("candado de otra maquina (despliegue anterior): se quita", { skip: process.platform === "win32" }, () => {
  const d = perfilCon("349fe8fc3f80-5484");
  assert.equal(liberarPerfil(d, { host: "nueva", vivo: () => true }), true);
  assert.equal(hay(d), false);
  assert.throws(() => fs.readlinkSync(path.join(d, "SingletonLock")));
});

test("candado de esta maquina con el proceso muerto: se quita", { skip: process.platform === "win32" }, () => {
  const d = perfilCon("yo-123");
  assert.equal(liberarPerfil(d, { host: "yo", vivo: () => false }), true);
  assert.equal(hay(d), false);
});

test("candado de un Chromium vivo en esta maquina: se respeta", { skip: process.platform === "win32" }, () => {
  const d = perfilCon("yo-123");
  assert.equal(liberarPerfil(d, { host: "yo", vivo: () => true }), false);
  assert.equal(hay(d), true);
});

test("sin candado no hace nada", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "perfil-"));
  assert.equal(liberarPerfil(d), false);
});
