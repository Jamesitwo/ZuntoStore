// Creador de campanas IA: plan con la IA, creativos en TopView y campana en
// Meta, todo con un fetch falso (sin red).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearCreadorCampanas, normalizarPlan, promptUsuario } from "../creadorCampanas.js";
import { aUnidadesMeta, mensajeBienvenida } from "../metaCampanas.js";

const espera = (cond, ms = 2000) =>
  new Promise((ok, mal) => {
    const t0 = Date.now();
    const v = () => (cond() ? ok() : Date.now() - t0 > ms ? mal(new Error("tiempo")) : setTimeout(v, 10));
    v();
  });

const PLAN = {
  creativos: [
    { tipo: "imagen", angulo: "Problema", prompt: "foto Image1", copy: { texto: "🔥 Hola", titulo: "Taladro", descripcion: "Envío gratis" } },
    { tipo: "video", angulo: "UGC", prompt: "video <<<Image1>>>", copy: { texto: "🎥 Mira", titulo: "Taladro", descripcion: "Ya" } },
  ],
  ficha: { descripcion: "d", modoUso: "1.", caracteristicas: "• x", contenido: "1 taladro" },
  bienvenida: "¡Hola! 👋",
  mensajePredefinido: "¡Hola! Quiero más información del Taladro.",
  faltan: [],
};

function falso() {
  const llamadas = [];
  const fetcher = async (url, op = {}) => {
    const u = String(url);
    const metodo = op.method ?? "GET";
    const cuerpo = op.body instanceof URLSearchParams ? Object.fromEntries(op.body) : op.body;
    llamadas.push({ u, metodo, cuerpo });
    const j = (d, status = 200) => ({
      ok: status < 400,
      status,
      headers: { get: () => "image/jpeg" },
      json: async () => d,
      text: async () => JSON.stringify(d),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    if (u.includes("/chat/completions")) return j({ choices: [{ message: { content: JSON.stringify(PLAN) } }] });
    if (u.startsWith("https://fotos.test/") || u.startsWith("https://res.topview/")) return j({});
    if (u.includes("/v1/upload/credential")) return j({ code: "200", result: { fileId: `f${llamadas.length}`, uploadUrl: "https://s3.test/put" } });
    if (u.startsWith("https://s3.test/")) return j({});
    if (u.includes("/v1/upload/check")) return j({ code: "200", result: true });
    if (u.includes("/task/submit")) return j({ code: "200", result: { taskId: u.includes("omni") ? "tv" : "ti", status: "init" } });
    if (u.includes("image_edit/task/query")) return j({ code: "200", result: { status: "success", images: [{ status: "success", filePath: "https://res.topview/i.jpg" }], costCredit: 0.2 } });
    if (u.includes("omni_reference/task/query")) return j({ code: "200", result: { status: "success", videos: [{ status: "success", filePath: "https://res.topview/v.mp4", coverPath: "https://res.topview/c.jpg" }] } });
    if (u.includes("graph.facebook.com")) {
      if (u.includes("/search")) return j({ data: [{ key: "123", name: "X", country_code: "CO" }] });
      if (u.includes("/adimages")) return j({ images: { a: { hash: "HASH1" } } });
      if (u.includes("/advideos")) return j({ id: "VID1" });
      if (u.includes("/VID1")) return j({ status: { video_status: "ready" } });
      if (u.includes("/campaigns")) return j({ id: "CAMP1" });
      if (u.includes("/adsets")) return j({ id: "SET1" });
      if (u.includes("/adcreatives")) return j({ id: `CR${llamadas.length}` });
      if (u.includes("/ads")) return j({ id: `AD${llamadas.length}` });
      if (u.match(/act_\d+\?/)) return j({ name: "Zunto", currency: "COP", account_status: 1, min_daily_budget: 4000 });
      if (u.includes("/CAMP1?")) return j({ name: "c", status: "PAUSED", daily_budget: "25000" });
      return j({ success: true });
    }
    return j({ error: "no esperado" }, 404);
  };
  return { fetcher, llamadas };
}

function armar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creador-"));
  const f = falso();
  const creador = crearCreadorCampanas({
    baseDir: dir,
    credencialMeta: () => ({ token: "tok", version: "v25.0", cuentas: [{ id: "111", nombre: "Zunto", moneda: "COP" }] }),
    fetcher: f.fetcher,
    log: { warn() {}, log() {} },
    esperaVideoMs: 1,
  });
  const c = creador.para("ana@zunto.co", { llm: { base: "https://ia.test/v1", modelo: "m", apiKey: "k" } });
  return { dir, creador, c, ...f };
}

test("de producto a campaña pausada en Meta", async () => {
  const { dir, creador, c, llamadas } = armar();
  c.guardarAjustes({ topviewKey: "clave-topview-123", topviewUid: "u1", cuentaId: "111", paginaId: "PAG1" });
  assert.equal(c.ajustes().topview.configurada, true);
  assert.ok(!JSON.stringify(c.ajustes()).includes("clave-topview-123"), "la key no se devuelve");

  const p = c.crear({ producto: { nombre: "Taladro", precio: "199.900" }, fotos: ["https://fotos.test/1.jpg"], imagenes: 1, videos: 1 });
  assert.equal(p.producto.precio, 199900);

  c.planear(p.id);
  await espera(() => c.get(p.id).estado === "plan");
  const conPlan = c.get(p.id);
  assert.equal(conPlan.creativos.length, 2);
  assert.equal(conPlan.mensajePredefinido, PLAN.mensajePredefinido);

  c.editar(p.id, { creativos: [{ id: "img1", copy: { titulo: "Nuevo título" } }] });
  assert.equal(c.get(p.id).creativos[0].copy.titulo, "Nuevo título");

  const gen = await c.generar(p.id);
  assert.deepEqual(gen.creativos.map((x) => x.estado), ["generando", "generando"]);
  const subida = llamadas.filter((l) => l.u.includes("/v1/upload/credential"));
  assert.equal(subida.length, 1, "la foto se sube una sola vez");
  const imgSubmit = llamadas.find((l) => l.u.includes("image_edit/task/submit"));
  const body = JSON.parse(imgSubmit.cuerpo);
  assert.equal(body.model, "GPT Image 2.5 Flare");
  assert.equal(body.aspectRatio, "4:5");
  assert.equal(body.inputImageFileIds.length, 1);
  const vidBody = JSON.parse(llamadas.find((l) => l.u.includes("omni_reference/task/submit")).cuerpo);
  assert.equal(vidBody.model, "Seedance 2.5");
  assert.equal(vidBody.inputImages[0].name, "Image1");

  await creador.revisarTareas();
  const listos = c.get(p.id);
  assert.deepEqual(listos.creativos.map((x) => x.estado), ["listo", "listo"]);
  assert.equal(listos.creativos[1].resultado.portada, "https://res.topview/c.jpg");

  c.crearCampana(p.id);
  await espera(() => ["creada", "error"].includes(c.get(p.id).campana?.estado));
  const fin = c.get(p.id);
  assert.equal(fin.campana.estado, "creada", fin.campana.error);
  assert.equal(fin.campana.ids.campana, "CAMP1");
  assert.equal(Object.values(fin.campana.ids.anuncios).filter((a) => a.anuncio).length, 2);

  const camp = llamadas.find((l) => l.u.includes("/campaigns")).cuerpo;
  assert.equal(camp.status, "PAUSED");
  assert.equal(camp.objective, "OUTCOME_SALES");
  assert.equal(camp.daily_budget, "25000", "COP va sin centavos");
  const set = llamadas.find((l) => l.u.includes("/adsets")).cuerpo;
  assert.equal(set.destination_type, "WHATSAPP");
  assert.equal(set.optimization_goal, "CONVERSATIONS");
  assert.ok(JSON.parse(set.targeting).excluded_geo_locations.regions.length === 2);
  assert.ok(llamadas.filter((l) => l.u.includes("/ads") && !l.u.includes("/adsets") && !l.u.includes("/adcreatives") && !l.u.includes("/adimages") && !l.u.includes("/advideos")).every((l) => l.cuerpo.status === "PAUSED"));
  const creativo = llamadas.find((l) => l.u.includes("/adcreatives")).cuerpo;
  const spec = JSON.parse(creativo.object_story_spec);
  assert.equal(spec.link_data.call_to_action.type, "WHATSAPP_MESSAGE");
  assert.equal(spec.link_data.name, "Nuevo título");
  assert.ok(spec.link_data.page_welcome_message.includes("Quiero más información del Taladro"));
  assert.ok(!llamadas.some((l) => l.cuerpo?.status === "ACTIVE"), "nada se activa solo");

  await c.activar(p.id);
  assert.equal(c.get(p.id).campana.estado, "activa");
  assert.ok(llamadas.filter((l) => l.cuerpo?.status === "ACTIVE").length >= 4);
  creador.detener();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sin fotos o sin precio no se crea el proyecto", () => {
  const { dir, c } = armar();
  assert.throws(() => c.crear({ producto: { nombre: "X", precio: 1000 }, fotos: [] }), /foto/);
  assert.throws(() => c.crear({ producto: { nombre: "X" }, fotos: ["https://a.b/c.jpg"] }), /precio/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cada usuario ve solo sus proyectos", () => {
  const { dir, creador, c } = armar();
  c.crear({ producto: { nombre: "X", precio: 1000 }, fotos: ["https://a.b/c.jpg"] });
  const otro = creador.para("luis@zunto.co", {});
  assert.equal(c.lista().length, 1);
  assert.equal(otro.lista().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("utilidades: presupuesto en unidades de Meta, plan y prompt", () => {
  assert.equal(aUnidadesMeta(25000, "COP"), 25000);
  assert.equal(aUnidadesMeta(10, "USD"), 1000);
  assert.match(mensajeBienvenida({ predefinido: "Hola X" }), /autofill_message/);
  const plan = normalizarPlan(PLAN, { imagenes: 4, videos: 0 });
  assert.equal(plan.creativos.length, 1);
  assert.throws(() => normalizarPlan({ creativos: [] }, { imagenes: 1, videos: 1 }), /no devolvió/);
  const pu = promptUsuario({ producto: { nombre: "T", precio: 199900 }, fotos: ["a", "b"], cantidades: { imagenes: 4, videos: 3 } }, { conPersonaje: true });
  assert.match(pu, /\$199\.900/);
  assert.match(pu, /<<<Image3>>>/);
});
