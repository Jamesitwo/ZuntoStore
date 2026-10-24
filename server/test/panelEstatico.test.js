// El panel servido por el mismo servidor (un solo servicio en Railway).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { crearPanelEstatico } from "../panelEstatico.js";

function armarDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><div id=root></div>");
  fs.writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");
  return dir;
}

async function levantar(panel) {
  const srv = http.createServer(async (req, res) => {
    if (await panel.manejar(req, res, new URL(req.url, "http://x"))) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"api":true}');
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test("sin index.html no se activa", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-vacio-"));
  assert.equal(crearPanelEstatico({ dir, log: { warn() {} } }), null);
  assert.equal(crearPanelEstatico({ dir: "" }), null);
});

test("sirve archivos, rutas del panel -> index.html, /api pasa de largo", async () => {
  const dir = armarDist();
  const { srv, base } = await levantar(crearPanelEstatico({ dir }));
  try {
    let r = await fetch(`${base}/assets/app-abc.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /javascript/);
    assert.match(r.headers.get("cache-control"), /immutable/);
    r = await fetch(`${base}/anuncios`);
    assert.match(await r.text(), /id=root/);
    assert.equal(r.headers.get("cache-control"), "no-cache");
    r = await fetch(`${base}/`);
    assert.match(await r.text(), /id=root/);
    r = await fetch(`${base}/api/salud`);
    assert.deepEqual(await r.json(), { api: true });
    r = await fetch(`${base}/assets/no-existe.js`);
    assert.equal(r.status, 404);
    r = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    assert.doesNotMatch(await r.text(), /root:/);
  } finally {
    srv.close();
  }
});

test("/b se reenvia a LucidSales con metodo, cabeceras y cuerpo", async () => {
  const dir = armarDist();
  const vistas = [];
  const fetchImpl = async (url, o) => {
    let cuerpo = "";
    if (o.body) for await (const t of o.body) cuerpo += t;
    vistas.push({ url, metodo: o.method, token: o.headers["x-token"], cookie: o.headers.cookie, cuerpo });
    return new Response('{"ok":1}', { status: 201, headers: { "content-type": "application/json", "set-cookie": "a=b" } });
  };
  const { srv, base } = await levantar(crearPanelEstatico({ dir, lucidOrigen: "https://panel.lucidsales.co", fetchImpl }));
  try {
    const r = await fetch(`${base}/b/auth/addShopId?x=1`, {
      method: "POST",
      headers: { "x-token": "t1", cookie: "s=1", "content-type": "application/json" },
      body: '{"a":1}',
    });
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { ok: 1 });
    assert.equal(r.headers.get("set-cookie"), null);
    assert.deepEqual(vistas[0], {
      url: "https://panel.lucidsales.co/b/auth/addShopId?x=1",
      metodo: "POST",
      token: "t1",
      cookie: undefined,
      cuerpo: '{"a":1}',
    });
  } finally {
    srv.close();
  }
});
