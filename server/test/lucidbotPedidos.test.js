// Clave de la API desde el panel + id del pedido a Lucid Bot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearApiKeys } from "../apiKeys.js";
import { crearLucidBotContactos } from "../lucidbotContactos.js";
import { crearPedidosLucidBot } from "../pedidosLucidBot.js";

test("apiKeys: genera, valida, no guarda la clave y se puede revocar", () => {
  const ruta = path.join(os.tmpdir(), `apikey-${Date.now()}.json`);
  const k = crearApiKeys({ ruta, claveEnv: "la-del-env-xxxxxxxxxxxxxxxxxxxxxxxx" });
  assert.equal(k.estado().generada, false);
  const { clave, vista } = k.generar({ usuario: "a@b.co" });
  assert.match(clave, /^zs_[\w-]{40,}$/);
  assert.ok(k.valida(clave));
  assert.ok(k.valida("la-del-env-xxxxxxxxxxxxxxxxxxxxxxxx"), "la del env sigue valiendo");
  assert.equal(k.valida("otra"), false);
  assert.equal(k.valida(""), false);
  assert.equal(fs.readFileSync(ruta, "utf8").includes(clave), false, "en disco no queda la clave");
  assert.equal(crearApiKeys({ ruta }).valida(clave), true, "sobrevive a un reinicio");
  assert.equal(k.estado().vista, vista);
  // generar otra invalida la anterior
  const otra = k.generar().clave;
  assert.equal(k.valida(clave), false);
  assert.ok(k.valida(otra));
  k.revocar();
  assert.equal(k.valida(otra), false);
  assert.equal(k.estado().generada, false);
  fs.rmSync(ruta, { force: true });
});

function lucidBotFalso() {
  const llamadas = [];
  const ruta = path.join(os.tmpdir(), `lb-${Date.now()}-${Math.random()}.json`);
  const fetcher = async (url, o) => {
    llamadas.push({ url, metodo: o.method, token: o.headers["X-ACCESS-TOKEN"], cuerpo: o.body });
    return new Response('{"success":true}', { status: 200 });
  };
  const lb = crearLucidBotContactos({ ruta, fetcher });
  return { lb, llamadas, ruta };
}

test("guardarIdPedido: POST al campo del contacto (telefono sin +)", async () => {
  const { lb, llamadas, ruta } = lucidBotFalso();
  lb.configurar({ token: "tok", pedidoFieldId: "123456", pedidoActivo: true });
  const r = await lb.guardarIdPedido({ id: 3256175, idPedido: 6106, Movil: "+573001112233" });
  assert.equal(r.ok, true, r.detalle);
  assert.equal(llamadas[0].url, "https://panel.lucidbot.co/api/contacts/573001112233/custom_fields/123456");
  assert.equal(llamadas[0].metodo, "POST");
  assert.equal(llamadas[0].token, "tok");
  assert.equal(llamadas[0].cuerpo, "value=3256175");
  lb.configurar({ pedidoValor: "numero" });
  await lb.guardarIdPedido({ id: 3256175, idPedido: 6106, Movil: "3001112233" });
  assert.equal(llamadas[1].cuerpo, "value=6106");
  assert.match(llamadas[1].url, /contacts\/573001112233\//);
  fs.rmSync(ruta, { force: true });
});

test("configurar: no se activa sin campo o sin token", () => {
  const { lb, ruta } = lucidBotFalso();
  assert.throws(() => lb.configurar({ pedidoActivo: true }), /ID del campo/);
  assert.throws(() => lb.configurar({ pedidoFieldId: "77", pedidoActivo: true }), /X-ACCESS-TOKEN/);
  assert.throws(() => lb.configurar({ pedidoFieldId: "a b" }), /letras, números/);
  fs.rmSync(ruta, { force: true });
});

test("solo los pedidos NUEVOS reciben el id, una vez cada uno", async () => {
  const { lb, llamadas, ruta } = lucidBotFalso();
  lb.configurar({ token: "tok", pedidoFieldId: "99", pedidoActivo: true });
  let lista = [
    { id: 2, idPedido: 502, Movil: "+573000000002" },
    { id: 1, idPedido: 501, Movil: "+573000000001" },
  ];
  const cliente = { listarPedidos: async () => ({ pedidos: lista }) };
  const rutaEstado = path.join(os.tmpdir(), `lbp-${Date.now()}.json`);
  const w = crearPedidosLucidBot({ cliente, lucidBot: lb, tiendas: () => ["3682"], ruta: rutaEstado, log: { log() {}, warn() {} } });
  await w.tick(); // primera vez: solo toma nota
  assert.equal(llamadas.length, 0);
  lista = [{ id: 4, idPedido: 504, Movil: "+573000000004" }, { id: 3, idPedido: 503, Movil: "+573000000003" }, ...lista];
  const r = await w.tick();
  assert.equal(r.enviados, 2);
  assert.deepEqual(llamadas.map((l) => l.cuerpo), ["value=3", "value=4"]); // del mas viejo al mas nuevo
  await w.tick();
  assert.equal(llamadas.length, 2, "no se repite");
  // al reiniciar recuerda lo enviado
  const w2 = crearPedidosLucidBot({ cliente, lucidBot: lb, tiendas: () => ["3682"], ruta: rutaEstado, log: { log() {}, warn() {} } });
  await w2.tick();
  assert.equal(llamadas.length, 2);
  assert.equal(w2.ultimos(5).length, 2);
  // apagado: no hace nada
  lb.configurar({ pedidoActivo: false });
  lista = [{ id: 5, idPedido: 505, Movil: "+573000000005" }, ...lista];
  await w2.tick();
  assert.equal(llamadas.length, 2);
  fs.rmSync(ruta, { force: true });
  fs.rmSync(rutaEstado, { force: true });
});

test("probar usa el ID del campo escrito aunque no este guardado", async () => {
  const { lb, llamadas, ruta } = lucidBotFalso();
  lb.configurar({ token: "tok" });
  const sin = await lb.guardarIdPedido({ id: 1, Movil: "3001112233" }, { forzar: true });
  assert.match(sin.detalle, /No hay ID de campo/);
  const r = await lb.guardarIdPedido({ id: 1, idPedido: 9, Movil: "3001112233" }, { forzar: true, fieldId: "555", valorTipo: "numero" });
  assert.equal(r.ok, true, r.detalle);
  assert.match(llamadas[0].url, /custom_fields\/555$/);
  assert.equal(llamadas[0].cuerpo, "value=9");
  fs.rmSync(ruta, { force: true });
});
