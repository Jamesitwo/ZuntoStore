// Acceso del panel con la sesion REAL de LucidSales (x-token + x-tienda).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { crearServidor } from "../servidor.js";
import { crearVerificadorSesion, leerRol, payloadJWT } from "../sesionPanel.js";

// JWT de prueba (la firma no importa: la valida "LucidSales")
const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma`;
const USUARIOS = {
  admin: { token: jwt({ id: 1, email: "dueno@tienda.co", tiendaActiva: 6881 }), rol: "1,2,3,4,5,6,7,8", tiendas: ["6881", "3682"] },
  vendedor: { token: jwt({ id: 2, email: "vende@tienda.co", tiendaActiva: 6881 }), rol: "2", tiendas: ["6881"] },
};
let llamadasLucid = 0;
// LucidSales falso: /auth/addShopId valida el token y la tienda
const fetcherLucid = async (url, op) => {
  llamadasLucid++;
  const token = op.headers["x-token"];
  const u = Object.values(USUARIOS).find((x) => x.token === token);
  const { id } = JSON.parse(op.body);
  if (!u) return { ok: false, status: 401, json: async () => ({ ok: false, msg: "token invalido" }) };
  if (!u.tiendas.includes(String(id))) return { ok: false, status: 400, json: async () => ({ ok: false, msg: "No autorizado para acceder a esta tienda" }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, token: "nuevo", tiendaActiva: id, rol: u.rol, idEmpresa: u.tiendas }) };
};

const API_KEY = "k".repeat(40);
const config = { API_KEY, CORS_ORIGIN: "*", LUCID_EMAIL: "a@b.co", LUCID_PASSWORD: "x", CONVERSACION: "/tmp/acceso-conv.jsonl" };
const llmCfg = { estado: () => ({ configurada: true }), guardar: () => ({}), borrar: () => ({}), vistaPrevia: () => ({}) };
const server = crearServidor({
  config,
  cliente: {},
  historial: { registrar() {}, listar: () => [] },
  inter: {},
  llmConfig: llmCfg,
  asignacion: { estado: (id) => ({ idEmpresa: id }), getConfig: () => ({}) },
  subidaAuto: { estadoPedido: () => null, config: () => ({ maxIntentos: 2 }), ultimos: () => [] },
  verificarSesion: crearVerificadorSesion({ fetcher: fetcherLucid, log: { log() {} } }),
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const pedir = (ruta, { quien, tienda = "6881", clave, metodo = "GET" } = {}) =>
  fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(quien ? { "x-token": USUARIOS[quien].token } : {}),
      ...(tienda ? { "x-tienda": tienda } : {}),
      ...(clave ? { "x-api-key": clave } : {}),
    },
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

test("sin sesion: 401", async () => {
  const r = await pedir("/api/llm/config");
  assert.equal(r.status, 401);
});

test("token falso: 401", async () => {
  const r = await fetch(base + "/api/llm/config", { headers: { "x-token": jwt({ id: 9 }), "x-tienda": "6881" } });
  assert.equal(r.status, 401);
});

test("admin (permiso 8) entra a la configuracion", async () => {
  const r = await pedir("/api/llm/config", { quien: "admin" });
  assert.equal(r.status, 200);
});

test("vendedor (solo permiso 2) NO entra a la configuracion, pero si a sus pedidos", async () => {
  const r = await pedir("/api/llm/config", { quien: "vendedor" });
  assert.equal(r.status, 403);
  assert.match(r.json.msg, /Ajustes Tienda/);
  const p = await pedir("/api/subida/pedido/123", { quien: "vendedor" });
  assert.equal(p.status, 200);
});

test("una tienda que no es del usuario: 403", async () => {
  const r = await pedir("/api/subida/pedido/123", { quien: "vendedor", tienda: "3682" });
  assert.equal(r.status, 403);
  assert.match(r.json.msg, /No autorizado/);
});

test("pedir datos de otra tienda por parametro: 403", async () => {
  const r = await pedir("/api/asignacion?idEmpresa=9999", { quien: "admin" });
  assert.equal(r.status, 403);
  const ok = await pedir("/api/asignacion?idEmpresa=3682", { quien: "admin" });
  assert.equal(ok.status, 200);
});

test("la verificacion se cachea (no se llama a LucidSales en cada peticion)", async () => {
  const antes = llamadasLucid;
  await pedir("/api/llm/config", { quien: "admin" });
  await pedir("/api/llm/config", { quien: "admin" });
  assert.equal(llamadasLucid, antes); // ya estaba verificado
});

test("integracion interna con x-api-key sigue funcionando", async () => {
  const r = await pedir("/api/llm/config", { clave: API_KEY, tienda: "" });
  assert.equal(r.status, 200);
});

test("rutas publicas no piden sesion", async () => {
  const r = await pedir("/api/salud", { tienda: "" });
  assert.equal(r.status, 200);
});

test("el usuario sale de uid (asi firma LucidSales sus tokens)", async () => {
  const token = jwt({ uid: { id: 77, email: "Vende@Tienda.co", name: "Ana", rol: "2", tiendaActiva: 6881 }, iat: 1, exp: 2 });
  const v = crearVerificadorSesion({
    log: { log() {} },
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rol: "2", idEmpresa: "6881" }) }),
  });
  const s = await v.verificar(token, "6881");
  assert.equal(s.usuario.email, "vende@tienda.co");
  assert.equal(s.usuario.id, 77);
  assert.equal(s.usuario.nombre, "Ana");
  assert.deepEqual(s.rol, { total: false, numeros: ["2"] });
});

test("leerRol y payloadJWT", () => {
  assert.deepEqual(leerRol("all"), { total: true, numeros: [] });
  assert.deepEqual(leerRol(null), { total: true, numeros: [] });
  assert.deepEqual(leerRol("2,5").numeros, ["2", "5"]);
  assert.deepEqual(leerRol('["2","8"]').numeros, ["2", "8"]);
  assert.equal(payloadJWT(USUARIOS.admin.token).email, "dueno@tienda.co");
  assert.deepEqual(payloadJWT("basura"), {});
});
