import test from "node:test";
import assert from "node:assert/strict";
import { crearMetaCampanas } from "../metaCampanas.js";

function falso(respuestas) {
  const llamadas = [];
  const fetcher = async (url, op = {}) => {
    const u = new URL(url);
    const cuerpo = op.body ? Object.fromEntries(new URLSearchParams(String(op.body))) : Object.fromEntries(u.searchParams);
    llamadas.push({ ruta: u.pathname, metodo: op.method ?? "GET", cuerpo });
    const r = respuestas.find(([re]) => re.test(u.pathname));
    return { json: async () => (r ? r[1] : {}) };
  };
  return { fetcher, llamadas };
}

test("publicar en la página: imagen como foto con el token de la página", async () => {
  const f = falso([
    [/\/123$/, { access_token: "TOKEN_PAGINA" }],
    [/\/123\/photos$/, { id: "9", post_id: "123_9" }],
  ]);
  const meta = crearMetaCampanas({ token: "TOKEN_USUARIO", fetcher: f.fetcher });
  const r = await meta.publicarEnPagina("123", { tipo: "imagen", url: "https://x/a.jpg", texto: "Hola" });
  assert.equal(r.enlace, "https://www.facebook.com/123_9");
  const post = f.llamadas.find((l) => l.ruta.endsWith("/photos"));
  assert.equal(post.cuerpo.access_token, "TOKEN_PAGINA");
  assert.equal(post.cuerpo.url, "https://x/a.jpg");
  assert.equal(post.cuerpo.caption, "Hola");
});

test("publicar en la página: video por URL y error claro sin permiso", async () => {
  const f = falso([
    [/\/123$/, { access_token: "TP" }],
    [/\/123\/videos$/, { id: "77" }],
  ]);
  const meta = crearMetaCampanas({ token: "T", fetcher: f.fetcher });
  const r = await meta.publicarEnPagina("123", { tipo: "video", url: "https://x/v.mp4", texto: "Mira" });
  assert.equal(r.enlace, "https://www.facebook.com/123/videos/77");
  assert.equal(f.llamadas.find((l) => l.ruta.endsWith("/videos")).cuerpo.file_url, "https://x/v.mp4");

  const sin = crearMetaCampanas({ token: "T", fetcher: falso([[/\/123$/, {}]]).fetcher });
  await assert.rejects(sin.publicarEnPagina("123", { tipo: "imagen", url: "u" }), /pages_manage_posts/);
});
