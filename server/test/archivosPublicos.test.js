import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { crearArchivosPublicos } from "../archivosPublicos.js";

function servidor(archivos) {
  const s = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (archivos.manejar(req, res, url)) return;
    try {
      const r = await archivos.subir(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(e.status ?? 500);
      res.end(e.message);
    }
  });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(s)));
}

test("subir y descargar un archivo público", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archivos-"));
  const s = await servidor(crearArchivosPublicos({ dir, maxBytes: 1024 }));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const r = await (await fetch(`${base}/api/archivos`, { method: "POST", headers: { "content-type": "image/png", "x-nombre": encodeURIComponent("foto ñ.png") }, body: png })).json();
    assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/archivos\/[a-f0-9]{32}\.png$/);
    assert.equal(r.nombre, "foto ñ.png");
    const g = await fetch(r.url);
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await g.arrayBuffer()), png);
    // tipo no admitido, muy grande, inexistente o ruta rara
    assert.equal((await fetch(`${base}/api/archivos`, { method: "POST", headers: { "content-type": "text/html" }, body: "<b>x</b>" })).status, 415);
    assert.equal((await fetch(`${base}/api/archivos`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.alloc(2048) })).status, 413);
    assert.equal((await fetch(`${base}/archivos/${"0".repeat(32)}.png`)).status, 404);
    assert.notEqual((await fetch(`${base}/archivos/../config.json`)).headers.get("content-type"), "image/png");
  } finally {
    s.close();
  }
});
