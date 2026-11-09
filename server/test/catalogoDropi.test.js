import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { ahoraBogota, compactar, crearCatalogoDropi, cuerpoPagina, stockDe, URL_CATALOGO } from "../catalogoDropi.js";

const silencio = { log() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "catalogo-"));

function prod(id, stock, extra = {}) {
  return {
    id,
    name: `Producto ${id}`,
    type: "SIMPLE",
    sale_price: 10000 + id,
    suggested_price: 30000,
    user: { store_name: "Prov" },
    categories: [{ name: "Hogar" }],
    gallery: [{ main: true, urlS3: `colombia/products/${id}/a.png` }],
    privated_product: false,
    warehouse_product: [{ stock }],
    ...extra,
  };
}

/** Dropi falso: n productos, 100 por pagina, orden estable. */
function dropiFalso(productos, { auth = () => true, fallar = () => false } = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opts) => {
    assert.equal(url, URL_CATALOGO);
    const cuerpo = JSON.parse(opts.body);
    llamadas.push({ cuerpo, headers: opts.headers });
    if (!auth(opts.headers["x-authorization"])) return new Response("{}", { status: 401 });
    if (fallar(cuerpo.startData)) return new Response("<html>", { status: 502 });
    const objetos = productos.slice(cuerpo.startData, cuerpo.startData + cuerpo.pageSize);
    return new Response(JSON.stringify({ is_successful: true, data: { isSuccess: true, objects: objetos } }), { status: 200 });
  };
  return { fetchImpl, llamadas };
}

const opciones = (dir, fetchImpl, extra = {}) => ({
  dir,
  fetchImpl,
  log: silencio,
  pausaMs: 0,
  esperaReintentoMs: [0, 0],
  obtenerSesion: async () => ({ ok: true, token: "tok", pais: "COLOMBIA" }),
  reloj: () => new Date("2026-11-08T07:05:00Z"), // 2:05 a.m. en Bogota
  ...extra,
});

test("stock: simple, variable y combo como en app.dropi.co", () => {
  assert.equal(stockDe(prod(1, 7)), 7);
  assert.equal(stockDe({ type: "SIMPLE", warehouse_product: [], stock_simple: 4 }), 4);
  assert.equal(stockDe({ type: "SIMPLE", warehouse_product: [{ stock: 3 }, { stock: null }, { stock: "5" }] }), 8);
  assert.equal(
    stockDe({
      type: "VARIABLE",
      variations: [{ warehouse_product_variation: [{ stock: 10 }, { stock: 2 }] }, { warehouse_product_variation: [{ stock: 1 }] }],
    }),
    13,
  );
  assert.equal(stockDe({ type: "VARIABLE", variations: [], variation_stock: 9 }), 9);
  assert.equal(stockDe({ type: "COMBO", combo_combinations: [{ stock: "6" }] }), 6);
});

test("compactar descarta privados y guarda lo minimo", () => {
  assert.equal(compactar(prod(5, 1, { privated_product: true })), null);
  assert.equal(compactar({ id: "x" }), null);
  const c = compactar(prod(5, 2));
  assert.deepEqual(
    { id: c.id, stock: c.stock, precio: c.precio, sugerido: c.sugerido, proveedor: c.proveedor, imagen: c.imagen },
    { id: 5, stock: 2, precio: 10005, sugerido: 30000, proveedor: "Prov", imagen: "colombia/products/5/a.png" },
  );
});

test("cuerpo de pagina: orden estable por fecha y 100 por pagina", () => {
  const b = cuerpoPagina(300);
  assert.equal(b.pageSize, 100);
  assert.equal(b.startData, 300);
  assert.equal(b.order_by, "created_at");
  assert.equal(b.order_type, "asc");
  assert.equal(b.privated_product, false);
});

test("hora de Bogota", () => {
  assert.deepEqual(ahoraBogota(new Date("2026-11-08T07:05:00Z")), { dia: "2026-11-08", hora: 2 });
  assert.deepEqual(ahoraBogota(new Date("2026-11-08T03:00:00Z")), { dia: "2026-11-07", hora: 22 });
});

test("recorre todo el catalogo, guarda solo los que tienen stock y las fichas", async () => {
  const dir = tmp();
  const productos = Array.from({ length: 250 }, (_, i) => prod(i + 1, i % 2));
  const { fetchImpl, llamadas } = dropiFalso(productos);
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl));
  const r = await cat.ejecutar();
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.corrida.productos, 250);
  assert.equal(r.corrida.conStock, 125);
  assert.equal(r.corrida.guardados, 125);
  // la sesion va en la cabecera de Dropi
  assert.equal(llamadas[0].headers["x-authorization"], "Bearer tok");
  assert.equal(llamadas[0].headers["x-host"], "co");
  const dia = await cat.dia("2026-11-08");
  assert.equal(dia.size, 125);
  assert.deepEqual(dia.get(2), [1, 10002, 30000]);
  assert.equal(dia.has(1), false);
  const fichas = await cat.fichas();
  assert.equal(fichas[2][0], "Producto 2");
  assert.equal(fichas[2][5], "2026-11-08");
  assert.equal(cat.resumen().corridas[0].ok, true);
  // archivo comprimido
  const crudo = fs.readFileSync(path.join(dir, "dias", "2026-11-08.json.gz"));
  assert.ok(JSON.parse(zlib.gunzipSync(crudo)).filas.length === 125);
});

test("con 'todo el catalogo' guarda tambien los agotados", async () => {
  const dir = tmp();
  const { fetchImpl } = dropiFalso(Array.from({ length: 30 }, (_, i) => prod(i + 1, i % 2)));
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl));
  cat.configurar({ todo: true });
  const r = await cat.ejecutar();
  assert.equal(r.corrida.guardados, 30);
});

test("las fichas recuerdan desde cuando se ve cada producto", async () => {
  const dir = tmp();
  const { fetchImpl } = dropiFalso([prod(1, 5)]);
  let ahora = new Date("2026-11-07T07:05:00Z");
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl, { reloj: () => ahora }));
  await cat.ejecutar();
  ahora = new Date("2026-11-08T07:05:00Z");
  await cat.ejecutar();
  assert.equal((await cat.fichas())[1][5], "2026-11-07");
  assert.deepEqual(cat.dias(), ["2026-11-07", "2026-11-08"]);
});

test("borra los dias mas viejos que diasGuardar", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "dias"), { recursive: true });
  for (const d of ["2026-09-01", "2026-10-20"]) fs.writeFileSync(path.join(dir, "dias", `${d}.json.gz`), zlib.gzipSync("{}"));
  const { fetchImpl } = dropiFalso([prod(1, 5)]);
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl));
  await cat.ejecutar();
  assert.deepEqual(cat.dias(), ["2026-10-20", "2026-11-08"]);
});

test("sesion vencida: renueva el token una vez y sigue", async () => {
  const dir = tmp();
  let n = 0;
  const { fetchImpl } = dropiFalso([prod(1, 5)], { auth: (h) => h === "Bearer nuevo" });
  const cat = crearCatalogoDropi(
    opciones(dir, fetchImpl, { obtenerSesion: async () => ({ ok: true, token: n++ ? "nuevo" : "viejo" }) }),
  );
  const r = await cat.ejecutar();
  assert.equal(r.ok, true, r.detalle);
  assert.equal(n, 2);
});

test("sesion rechazada aun renovada: falla con un motivo claro", async () => {
  const dir = tmp();
  const { fetchImpl } = dropiFalso([prod(1, 5)], { auth: () => false });
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl));
  const r = await cat.ejecutar();
  assert.equal(r.ok, false);
  assert.match(r.detalle, /sesión/);
  assert.equal(cat.resumen().corridas[0].ok, false);
  assert.equal(cat.resumen().enCurso, null);
});

test("sin sesion en el servidor no llama a Dropi", async () => {
  const dir = tmp();
  const { fetchImpl, llamadas } = dropiFalso([prod(1, 5)]);
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl, { obtenerSesion: async () => ({ ok: false, detalle: "No hay sesión" }) }));
  const r = await cat.ejecutar();
  assert.equal(r.ok, false);
  assert.equal(llamadas.length, 0);
});

test("una pagina que falla se reintenta", async () => {
  const dir = tmp();
  let veces = 0;
  const { fetchImpl } = dropiFalso(
    Array.from({ length: 150 }, (_, i) => prod(i + 1, 1)),
    { fallar: (o) => o === 100 && veces++ < 2 },
  );
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl));
  const r = await cat.ejecutar();
  assert.equal(r.ok, true);
  assert.equal(r.corrida.guardados, 150);
  assert.equal(r.corrida.fallidas, 0);
});

test("tick: solo a la hora configurada, una vez al dia y si esta activo", async () => {
  const dir = tmp();
  const { fetchImpl, llamadas } = dropiFalso([prod(1, 5)]);
  let ahora = new Date("2026-11-08T07:05:00Z");
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl, { reloj: () => ahora }));
  assert.equal(cat.tick(), false); // apagado
  cat.configurar({ activo: true, hora: 3 });
  assert.equal(cat.tick(), false); // no es la hora
  cat.configurar({ hora: 2 });
  assert.equal(cat.tick(), true);
  while (cat.resumen().enCurso) await new Promise((r) => setTimeout(r, 5));
  assert.ok(llamadas.length > 0);
  assert.equal(cat.tick(), false); // ya se hizo hoy
  ahora = new Date("2026-11-09T07:10:00Z");
  assert.equal(cat.tick(), true);
  while (cat.resumen().enCurso) await new Promise((r) => setTimeout(r, 5));
});

test("configuracion: valores fuera de rango vuelven al defecto y se guardan", () => {
  const dir = tmp();
  const cat = crearCatalogoDropi(opciones(dir, async () => new Response("{}")));
  assert.deepEqual(cat.config(), { activo: false, hora: 2, todo: false, diasGuardar: 35 });
  cat.configurar({ hora: 40, diasGuardar: 2, activo: true });
  assert.deepEqual(cat.config(), { activo: true, hora: 2, todo: false, diasGuardar: 35 });
  const otro = crearCatalogoDropi(opciones(dir, async () => new Response("{}")));
  assert.equal(otro.config().activo, true);
});

test("parar detiene la revision en curso", async () => {
  const dir = tmp();
  const productos = Array.from({ length: 5000 }, (_, i) => prod(i + 1, 1));
  const { fetchImpl } = dropiFalso(productos);
  const cat = crearCatalogoDropi(opciones(dir, fetchImpl, { pausaMs: 5 }));
  const p = cat.ejecutar();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(cat.parar(), true);
  const r = await p;
  assert.equal(r.ok, false);
  assert.match(r.detalle, /Detenido/);
  assert.deepEqual(cat.dias(), []);
});
