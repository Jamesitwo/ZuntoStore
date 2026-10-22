// Pruebas de los avisos a Lucid Bot (sin red: fetch inyectado).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearLucidBotContactos } from "../lucidbotContactos.js";

function armar() {
  const ruta = path.join(os.tmpdir(), `lucidbot-${Date.now()}-${Math.random()}.json`);
  const llamadas = [];
  const fetcher = async (url, opciones) => {
    llamadas.push({ url, opciones, body: opciones?.body ? JSON.parse(opciones.body) : null });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const lb = crearLucidBotContactos({ ruta, fetcher });
  return { lb, ruta, llamadas };
}

const PEDIDO = { idPedido: 555, Nombre: "Ana", Apellido: "Gomez", Movil: "3009998877", Correo: "ana@cliente.co" };

test("no deja activar los avisos sin telefono del admin", () => {
  const { lb, ruta } = armar();
  assert.throws(() => lb.configurar({ token: "tok", activo: true }), /teléfono del admin/);
  fs.rmSync(ruta, { force: true });
});

test("rechaza un telefono del admin invalido", () => {
  const { lb, ruta } = armar();
  assert.throws(() => lb.configurar({ adminPhone: "123" }), /no es válido/);
  fs.rmSync(ruta, { force: true });
});

test("normaliza el telefono del admin colombiano", () => {
  const { lb, ruta } = armar();
  const e = lb.configurar({ token: "tok", adminPhone: "300 123 4567", activo: true });
  assert.equal(e.adminPhone, "+573001234567");
  fs.rmSync(ruta, { force: true });
});

test("el aviso va al admin y los datos del cliente solo en los campos", async () => {
  const { lb, ruta, llamadas } = armar();
  lb.configurar({
    token: "tok",
    adminPhone: "+573001234567",
    activo: true,
    flowId: "777",
    tagName: "dropi_resultado",
    fields: [{ field_name: "cliente_dropi", value: "{{cliente}} {{phone}} #{{pedido}}" }],
  });
  const r = await lb.notificar({ pedido: PEDIDO, resultado: "fallido", detalle: "sin stock" });
  assert.equal(r.ok, true);
  assert.equal(llamadas.length, 1);
  const body = llamadas[0].body;
  // destinatario: el admin, sin nombre ni correo del cliente que lo pisen
  assert.deepEqual(Object.keys(body).sort(), ["actions", "phone"]);
  assert.equal(body.phone, "+573001234567");
  const resumen = body.actions.find((a) => a.field_name === "resumen_dropi");
  assert.match(resumen.value, /FALLIDO/);
  assert.match(resumen.value, /Pedido #555/);
  assert.match(resumen.value, /Ana Gomez/);
  assert.match(resumen.value, /\+573009998877/);
  const extra = body.actions.find((a) => a.field_name === "cliente_dropi");
  assert.equal(extra.value, "Ana Gomez +573009998877 #555");
  assert.deepEqual(body.actions.find((a) => a.action === "send_flow"), { action: "send_flow", flow_id: 777 });
  fs.rmSync(ruta, { force: true });
});

test("avisa aunque el pedido no traiga telefono del cliente", async () => {
  const { lb, ruta, llamadas } = armar();
  lb.configurar({ token: "tok", adminPhone: "+573001234567", activo: true });
  const r = await lb.notificar({ pedido: { idPedido: 9 }, resultado: "exitoso" });
  assert.equal(r.ok, true);
  assert.equal(llamadas[0].body.phone, "+573001234567");
  fs.rmSync(ruta, { force: true });
});

test("apagado no envia nada", async () => {
  const { lb, ruta, llamadas } = armar();
  lb.configurar({ token: "tok", adminPhone: "+573001234567", activo: false });
  const r = await lb.notificar({ pedido: PEDIDO, resultado: "fallido" });
  assert.equal(r.omitido, true);
  assert.equal(llamadas.length, 0);
  fs.rmSync(ruta, { force: true });
});

function armarConRespuesta(body) {
  const ruta = path.join(os.tmpdir(), `lucidbot-${Date.now()}-${Math.random()}.json`);
  const fetcher = async () => ({ ok: true, status: 200, json: async () => body });
  const lb = crearLucidBotContactos({ ruta, fetcher });
  lb.configurar({ token: "tok", conversationFieldId: "920789" });
  return { lb, ruta };
}

test("conversacion vacia: el detalle dice que el campo esta vacio", async () => {
  const { lb, ruta } = armarConRespuesta({ success: true, data: { value: "" } });
  const r = await lb.obtenerConversacion({ pedido: { Movil: "3009998877" } });
  assert.equal(r.ok, false);
  assert.match(r.detalle, /está vacío/);
  assert.match(r.detalle, /573009998877/);
  fs.rmSync(ruta, { force: true });
});

test("conversacion con texto raro: el detalle muestra como empieza", async () => {
  const { lb, ruta } = armarConRespuesta({ value: "hola esto no es un chat" });
  const r = await lb.obtenerConversacion({ pedido: { Movil: "3009998877" } });
  assert.match(r.detalle, /empieza: "hola esto no es un chat"/);
  fs.rmSync(ruta, { force: true });
});

test("respuesta sin el valor: el detalle lista las claves recibidas", async () => {
  const { lb, ruta } = armarConRespuesta({ success: true, otra: 1 });
  const r = await lb.obtenerConversacion({ pedido: { Movil: "3009998877" } });
  assert.match(r.detalle, /claves recibidas: success, otra/);
  fs.rmSync(ruta, { force: true });
});

test("campo con value null: dice que el bot no guardo la conversacion", async () => {
  const { lb, ruta } = armarConRespuesta({ id: 920789, name: "conversacion", type: "text", value: null });
  const r = await lb.obtenerConversacion({ pedido: { Movil: "3009998877" } });
  assert.match(r.detalle, /920789 \(«conversacion»\) está vacío \(null\)/);
  fs.rmSync(ruta, { force: true });
});
