// Pruebas de la configuracion de la IA desde el panel (sin red).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearConfigLLM, PROVEEDORES_LLM } from "../llmConfig.js";
import { crearExtractorLLM, probarLLM } from "../llm.js";

const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";
const tmp = () => path.join(os.tmpdir(), `llm-${Date.now()}-${Math.random()}.json`);

test("sin archivo usa lo del .env y enmascara la key", () => {
  const config = { LLM_API_KEY: KEY, LLM_MODELO: "gpt-5-mini" };
  const c = crearConfigLLM({ ruta: tmp(), config });
  const e = c.estado();
  assert.equal(e.configurada, true);
  assert.equal(e.origen, ".env");
  assert.equal(e.apiKeyVista, "sk-p…0123");
  assert.equal(e.proveedor, "openai");
  assert.ok(!JSON.stringify(e).includes(KEY)); // nunca sale completa
});

test("guardar desde el panel aplica al instante y persiste", () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: "" };
  const c = crearConfigLLM({ ruta, config });
  const e = c.guardar({ apiKey: KEY, proveedor: "groq", modelo: "llama-3.3-70b-versatile" });
  assert.equal(config.LLM_API_KEY, KEY);
  assert.equal(config.LLM_BASE, PROVEEDORES_LLM.groq.base);
  assert.equal(e.proveedor, "groq");
  assert.equal(e.origen, "panel");
  // al reiniciar se carga del archivo y manda sobre el .env
  const config2 = { LLM_API_KEY: "otra-del-env-xxxxxxxxxxxxxxxx" };
  crearConfigLLM({ ruta, config: config2 });
  assert.equal(config2.LLM_API_KEY, KEY);
  assert.equal(config2.LLM_MODELO, "llama-3.3-70b-versatile");
  fs.rmSync(ruta, { force: true });
});

test("guardar sin apiKey conserva la actual (cambia solo el modelo)", () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: KEY };
  const c = crearConfigLLM({ ruta, config });
  c.guardar({ modelo: "gpt-5" });
  assert.equal(config.LLM_API_KEY, KEY);
  assert.equal(config.LLM_MODELO, "gpt-5");
  fs.rmSync(ruta, { force: true });
});

test("rechaza datos invalidos", () => {
  const c = crearConfigLLM({ ruta: tmp(), config: { LLM_API_KEY: KEY } });
  assert.throws(() => c.guardar({ apiKey: "corta" }), /no parece válida/);
  assert.throws(() => c.guardar({ base: "http://inseguro.com" }), /https/);
  assert.throws(() => c.guardar({ proveedor: "inventado" }), /desconocido/);
  assert.throws(() => c.guardar({ modelo: "con espacios" }), /modelo válido/);
});

test("borrar vuelve a lo del .env", () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: "sk-del-env-0000000000000000000", LLM_MODELO: "gpt-5-mini" };
  const c = crearConfigLLM({ ruta, config });
  c.guardar({ apiKey: KEY, modelo: "gpt-5" });
  const e = c.borrar();
  assert.equal(config.LLM_API_KEY, "sk-del-env-0000000000000000000");
  assert.equal(config.LLM_MODELO, "gpt-5-mini");
  assert.equal(e.origen, ".env");
  assert.equal(fs.existsSync(ruta), false);
});

test("el extractor usa la key nueva sin recrearlo", async () => {
  const config = { LLM_API_KEY: "" };
  const extraer = crearExtractorLLM(config);
  const sinKey = await extraer([{ de: "cliente", texto: "hola" }]);
  assert.match(sinKey.incertidumbre[0], /no hay API key/);
  assert.ok(sinKey.falloTecnico);
  const llamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    llamadas.push({ url, auth: op.headers.authorization });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"producto":"x"}' } }] }) };
  };
  try {
    crearConfigLLM({ ruta: null, config }).guardar({ apiKey: KEY, proveedor: "deepseek" });
    await extraer([{ de: "cliente", texto: "hola" }]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(llamadas[0].url, `${PROVEEDORES_LLM.deepseek.base}/chat/completions`);
  assert.equal(llamadas[0].auth, `Bearer ${KEY}`);
});

test("probarLLM explica un 401 y confirma un ok", async () => {
  const mal = await probarLLM({
    apiKey: KEY,
    fetcher: async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"Incorrect API key"}}' }),
  });
  assert.equal(mal.ok, false);
  assert.match(mal.detalle, /401 \(la API key no es válida\): Incorrect API key/);
  const bien = await probarLLM({
    apiKey: KEY,
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }),
  });
  assert.equal(bien.ok, true);
  assert.match(bien.detalle, /Funciona/);
});

test("la IA recibe la direccion del pedido y su analisis se normaliza", async () => {
  const config = { LLM_API_KEY: KEY };
  const extraer = crearExtractorLLM(config);
  let enviado = "";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_url, op) => {
    enviado = JSON.parse(op.body).messages[1].content;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          direccionEnvio: { esNomenclatura: true, tipoVia: "Carrera", via: 21, cruce: "12", placa: "12", extra: "x" },
        }) } }],
      }),
    };
  };
  let r;
  try {
    r = await extraer([{ de: "cliente", texto: "hola" }], { direccionPedido: "cra 21 #1212" });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.match(enviado, /Direccion del pedido \(la que se enviara a la transportadora\): cra 21 #1212/);
  assert.equal(r.direccionEnvio.esNomenclatura, true);
  assert.equal(r.direccionEnvio.via, "21");
  assert.equal(r.direccionEnvio.extra, undefined);
});

test("pide poco razonamiento a gpt-5 en OpenAI, no a otros proveedores", async () => {
  const cuerpos = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_u, op) => {
    cuerpos.push(JSON.parse(op.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
  };
  try {
    await crearExtractorLLM({ LLM_API_KEY: KEY, LLM_MODELO: "gpt-5-mini" })([{ de: "cliente", texto: "hola" }]);
    await crearExtractorLLM({ LLM_API_KEY: KEY, LLM_MODELO: "llama-3.3-70b-versatile", LLM_BASE: PROVEEDORES_LLM.groq.base })([{ de: "cliente", texto: "hola" }]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(cuerpos[0].reasoning_effort, "low");
  assert.equal(cuerpos[1].reasoning_effort, undefined);
});

test("si la IA no responde a tiempo, queda marcado como fallo tecnico", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (_u, op) =>
    new Promise((_, rechazar) => op.signal.addEventListener("abort", () => rechazar(Object.assign(new Error("x"), { name: "AbortError" }))));
  let r;
  try {
    r = await crearExtractorLLM({ LLM_API_KEY: KEY, LLM_TIMEOUT_MS: 50 })([{ de: "cliente", texto: "hola" }]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.match(r.falloTecnico, /no respondió en 0 s/);
});

// ---- instrucciones (prompt) editables ----
import { PROMPT_DEFECTO } from "../llm.js";
const PROMPT_MIO = "Eres un extractor de datos. Devuelve SOLO un JSON con producto, cantidad, precioAcordado y direccion.";

test("sin personalizar se usa el prompt predeterminado", () => {
  const c = crearConfigLLM({ ruta: tmp(), config: { LLM_API_KEY: KEY } });
  const e = c.estado();
  assert.equal(e.promptPersonalizado, false);
  assert.equal(e.prompt, PROMPT_DEFECTO);
  assert.equal(e.promptDefecto, PROMPT_DEFECTO);
});

test("guardar instrucciones propias: se aplican, persisten y la IA las recibe", async () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: KEY };
  const c = crearConfigLLM({ ruta, config });
  assert.equal(c.guardar({ prompt: PROMPT_MIO }).promptPersonalizado, true);
  // tras reiniciar
  const config2 = { LLM_API_KEY: KEY };
  crearConfigLLM({ ruta, config: config2 });
  assert.equal(config2.LLM_PROMPT, PROMPT_MIO);
  // la IA las recibe como instrucciones de sistema
  let sistema = "";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_u, op) => {
    sistema = JSON.parse(op.body).messages[0].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
  };
  try {
    await crearExtractorLLM(config2)([{ de: "cliente", texto: "hola" }]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(sistema, PROMPT_MIO);
  fs.rmSync(ruta, { force: true });
});

test("restaurar: vacio, null o igual al predeterminado vuelve al predeterminado", () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: KEY };
  const c = crearConfigLLM({ ruta, config });
  c.guardar({ prompt: PROMPT_MIO });
  assert.equal(c.guardar({ prompt: null }).promptPersonalizado, false);
  c.guardar({ prompt: PROMPT_MIO });
  assert.equal(c.guardar({ prompt: PROMPT_DEFECTO }).promptPersonalizado, false);
  assert.equal(c.estado().prompt, PROMPT_DEFECTO);
  fs.rmSync(ruta, { force: true });
});

test("rechaza instrucciones demasiado cortas", () => {
  const c = crearConfigLLM({ ruta: tmp(), config: { LLM_API_KEY: KEY } });
  assert.throws(() => c.guardar({ prompt: "hola" }), /demasiado cortas/);
});

test("borrar la key del panel conserva las instrucciones propias", () => {
  const ruta = tmp();
  const config = { LLM_API_KEY: "sk-del-env-0000000000000000000" };
  const c = crearConfigLLM({ ruta, config });
  c.guardar({ apiKey: KEY, prompt: PROMPT_MIO });
  assert.equal(c.estado().origen, "panel");
  const e = c.borrar();
  assert.equal(config.LLM_API_KEY, "sk-del-env-0000000000000000000");
  assert.equal(e.promptPersonalizado, true);
  assert.equal(e.origen, ".env");
  fs.rmSync(ruta, { force: true });
});

test("la key del .env no se copia al archivo al guardar solo el prompt", () => {
  const ruta = tmp();
  const c = crearConfigLLM({ ruta, config: { LLM_API_KEY: KEY } });
  c.guardar({ prompt: PROMPT_MIO });
  const enArchivo = JSON.parse(fs.readFileSync(ruta, "utf8"));
  assert.equal(enArchivo.apiKey, undefined);
  assert.equal(c.estado().origen, ".env");
  fs.rmSync(ruta, { force: true });
});
