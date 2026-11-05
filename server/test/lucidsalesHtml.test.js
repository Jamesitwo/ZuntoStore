// LucidSales caido o bloqueado (pagina HTML de Cloudflare en vez de JSON).
import test from "node:test";
import assert from "node:assert/strict";
import { crearClienteLucid } from "../lucidsales.js";

const HTML = `<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<html><head><title>Attention Required! | Cloudflare</title></head><body>bloqueado</body></html>`;

function armar(respuestas) {
  const llamadas = [];
  const fetchImpl = async (url, op) => {
    llamadas.push(`${op?.method ?? "GET"} ${url.replace("https://api.test", "")}`);
    if (/\/auth\/login/.test(url)) return new Response(JSON.stringify({ ok: true, token: "t", idEmpresa: [1] }), { status: 200 });
    if (/\/auth\/addShopId/.test(url)) return new Response(JSON.stringify({ ok: true, token: "tt" }), { status: 200 });
    const r = respuestas.shift();
    return new Response(r.body, { status: r.status });
  };
  const cliente = crearClienteLucid(
    { LUCID_BASE: "https://api.test", TIMEOUT_MS: 5000, LUCID_EMAIL: "a@b.co", LUCID_PASSWORD: "x", LUCID_TIENDA: "1", LUCID_REINTENTO_MS: 0 },
    fetchImpl,
  );
  return { cliente, llamadas };
}

test("LucidSales responde HTML una vez: se reintenta la consulta y sale bien", async () => {
  const { cliente, llamadas } = armar([
    { status: 403, body: HTML },
    { status: 200, body: JSON.stringify({ pedido: { id: 7409642, EstadoPedido: 0 } }) },
  ]);
  const p = await cliente.obtenerPedido(7409642, 1);
  assert.equal(p.id, 7409642);
  assert.equal(llamadas.filter((x) => x.includes("get-pedido-by-id")).length, 2);
});

test("LucidSales sigue con HTML: mensaje corto y claro, sin el HTML ni «no se encontró»", async () => {
  const { cliente } = armar([
    { status: 403, body: HTML },
    { status: 403, body: HTML },
  ]);
  await assert.rejects(cliente.obtenerPedido(7409642, 1), (e) => {
    assert.doesNotMatch(e.message, /DOCTYPE|<html|No se encontro/);
    assert.match(e.message, /página de error \(HTTP 403: «Attention Required! \| Cloudflare»\)/);
    return true;
  });
});
