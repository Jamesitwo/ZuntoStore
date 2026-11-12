import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearBotsTienda, filtrarProductos, idsDeExportacion, listaDeProductos } from "../botsTienda.js";

const silencio = { log() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bots-tienda-"));

const prod = (n, extra = {}) => ({ nombre_del_producto: n, ...extra });
const catalogo = (...nombres) => JSON.stringify({ catalogo_de_productos: nombres.map((n) => prod(n, { descripcion_del_producto: `desc ${n}` })) });
const multimedia = (...nombres) => JSON.stringify({ catalogo_multimedia: nombres.map((n) => prod(n, { imagenes: [`${n}.jpg`] })) });

/** Lucid Bot falso: un mapa de campos por token. */
function lucidBotFalso(campos) {
  const llamadas = [];
  const fetcher = async (url, op) => {
    const id = decodeURIComponent(url.split("/").pop());
    const token = op.headers["X-ACCESS-TOKEN"];
    llamadas.push({ metodo: op.method, token, id });
    const bot = campos[token];
    if (!bot) return { ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) };
    if (op.method === "POST") {
      bot[id] = new URLSearchParams(op.body).get("value");
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ id, value: bot[id] ?? null }) };
  };
  return { fetcher, llamadas };
}

const EXPORT_ZUNTO = { campos: [{ id: "1", name: "Catalogo_productos_LucidSales", valor: "SECRETO" }, { id: "2", name: "Multimedia_productos_LucidSales" }, { id: "3", name: "Nombre_empresa_LucidSales" }] };
const EXPORT_NUEVA = { campos: [{ id: "11", name: "Catalogo_productos_LucidSales" }, { id: "12", name: "Multimedia_productos_LucidSales" }, { id: "13", name: "Nombre_empresa_LucidSales" }] };

function armar(campos) {
  const dir = tmp();
  const lb = lucidBotFalso(campos);
  const bt = crearBotsTienda({
    ruta: path.join(dir, "config.json"),
    rutaCache: path.join(dir, "cache.json"),
    tokenZunto: () => "tz",
    fetcher: lb.fetcher,
    log: silencio,
  });
  return { bt, lb, dir };
}

test("exportación: solo id y nombre, nunca los valores", () => {
  const ids = idsDeExportacion(JSON.stringify(EXPORT_ZUNTO));
  assert.deepEqual(ids, { Catalogo_productos_LucidSales: "1", Multimedia_productos_LucidSales: "2", Nombre_empresa_LucidSales: "3" });
  assert.throws(() => idsDeExportacion("no es json"), /JSON/);
  assert.throws(() => idsDeExportacion({ campos: [{ name: "x" }] }), /id y nombre/);
});

test("campos por producto: se reconocen y se filtran", () => {
  assert.equal(listaDeProductos("SI"), null);
  assert.equal(listaDeProductos(JSON.stringify({ messages: [{ message: "x" }] })), null);
  const l = listaDeProductos(catalogo("A", "B"));
  assert.equal(l.clave, "catalogo_de_productos");
  assert.equal(l.items.length, 2);
  const f = JSON.parse(filtrarProductos(catalogo("A", "B", "C"), (n) => n !== "B"));
  assert.deepEqual(f.catalogo_de_productos.map((x) => x.nombre_del_producto), ["A", "C"]);
});

test("leer: trae los productos del bot de Zunto sin escribir nada", async () => {
  const campos = { tz: { 1: catalogo("Taladro", "Árbol De Navidad"), 2: multimedia("Taladro") }, tn: {} };
  const { bt, lb } = armar(campos);
  bt.configurar({ exportZunto: EXPORT_ZUNTO, exportNueva: EXPORT_NUEVA });
  const r = await bt.sincronizar({ soloLeer: true });
  assert.equal(r.ok, true, r.errores?.join("; "));
  assert.deepEqual(bt.estado().productos, ["Árbol De Navidad", "Taladro"]);
  assert.equal(lb.llamadas.filter((x) => x.metodo === "POST").length, 0);
});

test("sincronizar: el nuevo bot recibe solo sus productos y el de Zunto queda sin ellos", async () => {
  const campos = { tz: { 1: catalogo("Taladro", "Arbol de Navidad", "Escurridor"), 2: multimedia("Taladro", "Arbol de Navidad"), 3: "Zunto" }, tn: {} };
  const { bt } = armar(campos);
  bt.configurar({
    exportZunto: EXPORT_ZUNTO,
    exportNueva: EXPORT_NUEVA,
    token: "tn",
    productosNueva: ["árbol de navidad", "Escurridor"],
    camposTienda: { Nombre_empresa_LucidSales: "Pizdo", Otro_que_no_existe: "x" },
    activo: true,
  });
  const r = await bt.sincronizar();
  const nombres = (v, k) => JSON.parse(v)[k].map((x) => x.nombre_del_producto);
  assert.deepEqual(nombres(campos.tn[11], "catalogo_de_productos"), ["Arbol de Navidad", "Escurridor"]);
  assert.deepEqual(nombres(campos.tn[12], "catalogo_multimedia"), ["Arbol de Navidad"]);
  assert.equal(campos.tn[13], "Pizdo");
  assert.deepEqual(nombres(campos.tz[1], "catalogo_de_productos"), ["Taladro"]);
  assert.deepEqual(nombres(campos.tz[2], "catalogo_multimedia"), ["Taladro"]);
  assert.equal(campos.tz[3], "Zunto", "los campos de tienda del bot de Zunto no se tocan");
  assert.match(r.errores.join(), /Otro_que_no_existe/);

  // 2a vuelta sin cambios: no escribe de nuevo; el nuevo bot conserva sus
  // productos aunque el bot de Zunto ya no los tenga
  const r2 = await bt.sincronizar();
  assert.deepEqual(r2.escritosNueva, []);
  assert.deepEqual(r2.escritosZunto, []);
  assert.deepEqual(nombres(campos.tn[11], "catalogo_de_productos"), ["Arbol de Navidad", "Escurridor"]);

  // LucidSales vuelve a llenar el bot de Zunto (con un cambio): se copia el
  // cambio al nuevo bot y se filtra otra vez
  campos.tz[1] = JSON.stringify({ catalogo_de_productos: [prod("Taladro"), prod("Arbol de Navidad", { descripcion_del_producto: "nueva" }), prod("Escurridor")] });
  await bt.sincronizar();
  assert.equal(JSON.parse(campos.tn[11]).catalogo_de_productos[0].descripcion_del_producto, "nueva");
  assert.deepEqual(nombres(campos.tz[1], "catalogo_de_productos"), ["Taladro"]);

  // se quita el Escurridor de la nueva tienda: vuelve al bot de Zunto
  bt.configurar({ productosNueva: ["Arbol de Navidad"] });
  await bt.sincronizar();
  assert.deepEqual(nombres(campos.tz[1], "catalogo_de_productos"), ["Taladro", "Escurridor"]);
  assert.deepEqual(nombres(campos.tn[11], "catalogo_de_productos"), ["Arbol de Navidad"]);
});

test("sin filtrar el bot de Zunto: queda con todos", async () => {
  const campos = { tz: { 1: catalogo("Taladro", "Arbol") }, tn: {} };
  const { bt } = armar(campos);
  bt.configurar({ exportZunto: EXPORT_ZUNTO, exportNueva: EXPORT_NUEVA, token: "tn", productosNueva: ["Arbol"], filtrarZunto: false });
  await bt.sincronizar();
  assert.equal(JSON.parse(campos.tz[1]).catalogo_de_productos.length, 2);
  assert.equal(JSON.parse(campos.tn[11]).catalogo_de_productos.length, 1);
});

test("el token no sale en el estado y activar exige token y exportaciones", () => {
  const { bt } = armar({});
  assert.throws(() => bt.configurar({ activo: true }), /X-ACCESS-TOKEN/);
  assert.throws(() => bt.configurar({ token: "secreto-largo-123", activo: true }), /exportaciones/);
  bt.configurar({ token: "secreto-largo-123" });
  const e = bt.estado();
  assert.equal(e.token, undefined);
  assert.equal(e.tokenConfigurado, true);
  assert.equal(JSON.stringify(e).includes("secreto-largo-123"), false);
});

test("errores de Lucid Bot quedan en el historial", async () => {
  const campos = { tz: { 1: catalogo("Arbol") } }; // el token del bot nuevo no existe -> 401
  const { bt } = armar(campos);
  bt.configurar({ exportZunto: EXPORT_ZUNTO, exportNueva: EXPORT_NUEVA, token: "malo", productosNueva: ["Arbol"] });
  const r = await bt.sincronizar();
  assert.equal(r.ok, false);
  assert.match(r.errores[0], /401/);
  assert.equal(bt.estado().historial[0].ok, false);
});

test("copiar del bot de Zunto: valores de los campos de la tienda (sin los de producto ni tokens)", async () => {
  const campos = { tz: { 1: catalogo("Taladro"), 3: "Zunto", 9: "secreto" }, tn: {} };
  const { bt } = armar(campos);
  bt.configurar({
    exportZunto: { campos: [...EXPORT_ZUNTO.campos, { id: "9", name: "LucidVoice_Token" }] },
    exportNueva: { campos: [...EXPORT_NUEVA.campos, { id: "19", name: "LucidVoice_Token" }] },
  });
  const r = await bt.valoresZunto();
  assert.deepEqual(r.valores, { Nombre_empresa_LucidSales: "Zunto" });
});

test("guardar los campos de la tienda los escribe ya en el bot nuevo (aunque no hayan cambiado), sin tocar productos", async () => {
  const campos = { tz: { 1: catalogo("Taladro", "Arbol") }, tn: {} };
  const { bt, lb } = armar(campos);
  bt.configurar({ exportZunto: EXPORT_ZUNTO, exportNueva: EXPORT_NUEVA, token: "tn", productosNueva: ["Arbol"], camposTienda: { Nombre_empresa_LucidSales: "Pizdo" } });
  let r = await bt.sincronizar({ soloTienda: true });
  assert.equal(r.ok, true, r.errores.join());
  assert.equal(campos.tn[13], "Pizdo");
  assert.equal(campos.tn[11], undefined, "los productos no se tocan");
  assert.equal(lb.llamadas.some((x) => x.token === "tz"), false, "no lee ni filtra el bot de Zunto");
  // alguien lo cambio en Lucid Bot: al guardar de nuevo se vuelve a escribir
  campos.tn[13] = "otro";
  r = await bt.sincronizar({ soloTienda: true });
  assert.equal(campos.tn[13], "Pizdo");
});

test("asignar un producto a una tienda (p. ej. desde el Creador IA)", () => {
  const { bt } = armar({});
  assert.deepEqual(bt.asignar("Lampara Solar", "nueva").productosNueva, ["Lampara Solar"]);
  assert.deepEqual(bt.asignar("lámpara solar", "nueva").productosNueva, ["lámpara solar"], "sin duplicar");
  assert.deepEqual(bt.asignar("Lampara Solar", "zunto").productosNueva, []);
  assert.throws(() => bt.asignar("", "nueva"), /nombre/);
  assert.throws(() => bt.asignar("x", "otra"), /Tienda/);
});
