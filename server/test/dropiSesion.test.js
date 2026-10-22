// Pruebas de la sesion de Dropi desde el panel: GET/POST /api/dropi/sesion.
// Sin navegador: el navegador de Dropi y la subida van simulados.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearServidor } from "../servidor.js";
import { crearSubidaAutomatica } from "../subidaAutomatica.js";

const API_KEY = "k".repeat(40);
const ruta = path.join(os.tmpdir(), `sesion-${Date.now()}-${Math.random()}.json`);
const recibidas = [];
const nav = {
  respuesta: { ok: true, claves: 2, detalle: "Sesión de Dropi activa en el servidor" },
  async inyectarSesion(datos) {
    recibidas.push(datos);
    return this.respuesta;
  },
  async subirPedido() {
    return { ok: false, requiereLogin: true, detalle: "vencida" };
  },
};
const avisos = [];
const lucidBotContactos = {
  async notificar(a) {
    avisos.push(a.resultado);
    return { ok: true };
  },
};
const config = {
  API_KEY,
  CORS_ORIGIN: "*",
  LUCID_EMAIL: "a@b.co",
  LUCID_PASSWORD: "x",
  LUCID_TIENDA: "1",
  CONVERSACION: path.join(os.tmpdir(), `conv-${Date.now()}.jsonl`),
};
const subida = crearSubidaAutomatica({
  cliente: { async listarPedidos() { return { pedidos: [] }; } },
  conversacion: { porPedido: () => null },
  extraer: async () => ({}),
  dropiNav: nav,
  config,
  ruta,
  lucidBotContactos,
  log: { log() {}, warn() {} },
});
const server = crearServidor({
  config,
  cliente: {},
  historial: { registrar() {}, listar: () => [] },
  inter: {},
  dropiNavegador: nav,
  subidaAuto: subida,
  lucidBotContactos,
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  fs.rmSync(ruta, { force: true });
});

const pedir = (metodo, ruta, body, clave = API_KEY) =>
  fetch(base + ruta, {
    method: metodo,
    headers: { "content-type": "application/json", "x-api-key": clave },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

test("POST /api/dropi/sesion exige la api key", async () => {
  const r = await pedir("POST", "/api/dropi/sesion", { localStorage: { a: "1" } }, "mala");
  assert.equal(r.status, 401);
});

test("una caida avisa una vez y la sesion pegada la restablece", async () => {
  await subida.reportarSesion("requiere-login", "vencida");
  await subida.reportarSesion("requiere-login", "vencida");
  assert.deepEqual(avisos, ["sesion-vencida"]);
  let r = await pedir("GET", "/api/dropi/sesion");
  assert.equal(r.json.sesion.estado, "requiere-login");

  r = await pedir("POST", "/api/dropi/sesion", { localStorage: { token: "abc", user: "{}" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.sesion.estado, "ok");
  assert.deepEqual(recibidas.at(-1), { token: "abc", user: "{}" });

  // nueva caida: avisa otra vez
  await subida.reportarSesion("requiere-login", "vencida");
  assert.deepEqual(avisos, ["sesion-vencida", "sesion-vencida"]);
});

test("acepta la sesion pegada como texto JSON", async () => {
  const r = await pedir("POST", "/api/dropi/sesion", { localStorage: JSON.stringify({ token: "xyz" }) });
  assert.equal(r.status, 200);
  assert.deepEqual(recibidas.at(-1), { token: "xyz" });
});

test("rechaza texto que no es JSON", async () => {
  const r = await pedir("POST", "/api/dropi/sesion", { localStorage: "esto no es json" });
  assert.equal(r.status, 400);
});

test("si Dropi no acepta la sesion, responde 400 y la caida sigue", async () => {
  await subida.reportarSesion("requiere-login", "vencida");
  nav.respuesta = { ok: false, requiereLogin: true, detalle: "Dropi no aceptó la sesión" };
  const r = await pedir("POST", "/api/dropi/sesion", { localStorage: { token: "viejo" } });
  assert.equal(r.status, 400);
  assert.match(r.json.msg, /no aceptó/);
  assert.equal(subida.sesion().estado, "requiere-login");
  nav.respuesta = { ok: true, claves: 1, detalle: "ok" };
});

test("GET /api/subida/pedido/:id devuelve el veredicto guardado", async () => {
  subida.registrarResultado("777", "frenado", "precio: no coincide");
  const r = await pedir("GET", "/api/subida/pedido/777");
  assert.equal(r.status, 200);
  assert.equal(r.json.registro.accion, "frenado");
  assert.equal(r.json.maxIntentos, 2);
  const nada = await pedir("GET", "/api/subida/pedido/999");
  assert.equal(nada.json.registro, null);
});
