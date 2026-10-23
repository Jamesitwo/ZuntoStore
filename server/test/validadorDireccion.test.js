// Validador de direcciones propio: formato + Google Maps (fetch falso).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  candidatosNumeroPegado,
  crearValidadorDireccion,
  evaluarGeocodificacion,
  mismoLugar,
} from "../validadorDireccion.js";

const comp = (municipio, depto) => [
  { long_name: municipio, types: ["locality", "political"] },
  { long_name: depto, types: ["administrative_area_level_1", "political"] },
  { long_name: "Colombia", types: ["country", "political"] },
];
const ok = ({ tipo = "street_address", precision = "ROOFTOP", municipio = "Medellín", depto = "Antioquia", parcial = false, texto = "Cra. 40 #23-23, Medellín, Antioquia, Colombia" } = {}) => ({
  status: "OK",
  results: [
    {
      formatted_address: texto,
      types: [tipo],
      partial_match: parcial || undefined,
      geometry: { location: { lat: 6.24, lng: -75.57 }, location_type: precision },
      address_components: comp(municipio, depto),
    },
  ],
});

/** Google falso: responde segun la direccion pedida (o una funcion). */
function armar(respuestas, { conKey = true } = {}) {
  const pedidas = [];
  const fetcher = async (url) => {
    const q = new URL(url).searchParams;
    pedidas.push(q.get("address"));
    const dir = q.get("address");
    const r = typeof respuestas === "function" ? respuestas(dir) : respuestas;
    return { json: async () => r };
  };
  const ruta = path.join(os.tmpdir(), `mapas-${Date.now()}-${Math.random()}.json`);
  const v = crearValidadorDireccion({
    ruta,
    config: conKey ? { GOOGLE_MAPS_KEY: "AIza-clave-de-prueba-123456" } : {},
    fetcher,
    log: { warn() {} },
  });
  return { v, pedidas, ruta };
}

test("mismoLugar tolera tildes y «D.C.»", () => {
  assert.equal(mismoLugar("Bogota D.C.", "Bogotá"), true);
  assert.equal(mismoLugar("Cartagena de Indias", "Cartagena"), true);
  assert.equal(mismoLugar("Bello", "Medellín"), false);
});

test("numero pegado: arma los candidatos posibles", () => {
  assert.deepEqual(candidatosNumeroPegado("cr 21 #1212, centro"), ["Cra 21 # 12-12, Centro"]);
  assert.deepEqual(candidatosNumeroPegado("Calle 5 #123"), ["Calle 5 # 1-23", "Calle 5 # 12-3"]);
  assert.deepEqual(candidatosNumeroPegado("Cra 40 # 23-23"), []);
});

test("Google: placa exacta en la ciudad del pedido", () => {
  const r = evaluarGeocodificacion(ok(), { ciudad: "Medellin", departamento: "Antioquia" });
  assert.equal(r.veredicto, "exacta");
  assert.match(r.mapa, /google\.com\/maps/);
});

test("Google: solo la calle o coincidencia parcial = aproximada", () => {
  assert.equal(evaluarGeocodificacion(ok({ tipo: "route", precision: "GEOMETRIC_CENTER" }), { ciudad: "Medellín" }).veredicto, "aproximada");
  const parcial = evaluarGeocodificacion(ok({ parcial: true }), { ciudad: "Medellín" });
  assert.equal(parcial.veredicto, "aproximada");
  assert.match(parcial.detalle, /parcial/);
});

test("Google: la encuentra en otra ciudad = otra-ciudad", () => {
  const r = evaluarGeocodificacion(ok({ municipio: "Bello" }), { ciudad: "Medellín", departamento: "Antioquia" });
  assert.equal(r.veredicto, "otra-ciudad");
  assert.match(r.detalle, /Bello/);
});

test("Google: key rechazada da un error claro", () => {
  assert.throws(
    () => evaluarGeocodificacion({ status: "REQUEST_DENIED", error_message: "API key not valid" }),
    /rechazó la API key/,
  );
});

test("valida: buen formato y existe -> valida, con la direccion escrita bien", async () => {
  const { v, pedidas, ruta } = armar(ok());
  const r = await v.validar({ direccion: "cra 40#23-23, centro", ciudad: "Medellín", departamento: "Antioquia" });
  assert.equal(r.veredicto, "valida");
  assert.equal(r.sugerida, "Cra 40 # 23-23, Centro");
  assert.match(pedidas[0], /Cra 40 # 23-23, Centro, Medellín, Antioquia, Colombia/);
  // segunda vez: sale de la cache, no gasta otra consulta
  await v.validar({ direccion: "cra 40#23-23, centro", ciudad: "Medellín", departamento: "Antioquia" });
  assert.equal(pedidas.length, 1);
  fs.rmSync(ruta, { force: true });
});

test("valida: formato bien pero Google solo ubica la calle -> revisar", async () => {
  const { v, ruta } = armar(ok({ tipo: "route", precision: "GEOMETRIC_CENTER" }));
  const r = await v.validar({ direccion: "Calle 10 # 5-20, Laureles", ciudad: "Medellín" });
  assert.equal(r.veredicto, "revisar");
  assert.match(r.resumen, /solo la calle/);
  fs.rmSync(ruta, { force: true });
});

test("valida: en otra ciudad -> invalida", async () => {
  const { v, ruta } = armar(ok({ municipio: "Envigado" }));
  const r = await v.validar({ direccion: "Calle 10 # 5-20, Laureles", ciudad: "Medellín" });
  assert.equal(r.veredicto, "invalida");
  fs.rmSync(ruta, { force: true });
});

test("valida: sin nomenclatura -> invalida sin preguntarle a Google", async () => {
  const { v, pedidas, ruta } = armar(ok());
  const r = await v.validar({ direccion: "casa verde al lado de la panaderia", ciudad: "Medellín" });
  assert.equal(r.veredicto, "invalida");
  assert.equal(r.sugerida, null);
  assert.equal(pedidas.length, 1, "consulta el texto tal cual solo para informar");
  fs.rmSync(ruta, { force: true });
});

test("valida: numero pegado -> el mapa elige el candidato que existe", async () => {
  // solo "Calle 5 # 12-3" existe como placa
  const { v, ruta } = armar((dir) =>
    dir.startsWith("Calle 5 # 12-3") ? ok() : ok({ tipo: "route", precision: "GEOMETRIC_CENTER" }),
  );
  const r = await v.validar({ direccion: "Calle 5 #123, Centro", ciudad: "Medellín" });
  assert.equal(r.veredicto, "valida");
  assert.equal(r.sugerida, "Calle 5 # 12-3, Centro");
  assert.equal(r.formato.origen, "reglas+mapa");
  fs.rmSync(ruta, { force: true });
});

test("valida: numero pegado que el mapa no confirma -> invalida", async () => {
  const { v, ruta } = armar({ status: "ZERO_RESULTS", results: [] });
  const r = await v.validar({ direccion: "cr 21 #1212, centro", ciudad: "Medellín" });
  assert.equal(r.veredicto, "invalida");
  assert.equal(r.sugerida, null);
  fs.rmSync(ruta, { force: true });
});

test("valida: oficina de transportadora no se busca en el mapa", async () => {
  const { v, pedidas, ruta } = armar(ok());
  const r = await v.validar({ direccion: "Oficina Interrapidisimo Sincelejo", ciudad: "Sincelejo" });
  assert.equal(r.veredicto, "oficina");
  assert.equal(pedidas.length, 0);
  fs.rmSync(ruta, { force: true });
});

test("sin barrio ni referencia: avisa", async () => {
  const { v, ruta } = armar(ok());
  const r = await v.validar({ direccion: "Cra 40 # 23-23", ciudad: "Medellín" });
  assert.match(r.avisos.join(" "), /barrio/);
  fs.rmSync(ruta, { force: true });
});

test("sin API key: solo formato, queda en revisar", async () => {
  const { v, pedidas, ruta } = armar(ok(), { conKey: false });
  const r = await v.validar({ direccion: "Cra 40 # 23-23, Centro", ciudad: "Medellín" });
  assert.equal(r.veredicto, "revisar");
  assert.equal(pedidas.length, 0);
  assert.match(r.avisos.join(" "), /API key/);
  fs.rmSync(ruta, { force: true });
});

test("la key se guarda enmascarada y se puede borrar", () => {
  const { v, ruta } = armar(ok(), { conKey: false });
  assert.throws(() => v.guardar({ apiKey: "corta" }), /no parece válida/);
  const e = v.guardar({ apiKey: "AIzaSyD-una-clave-larga-de-prueba" });
  assert.equal(e.configurada, true);
  assert.equal(e.origen, "panel");
  assert.equal(e.apiKeyVista, "AIza…ueba");
  assert.equal(v.borrar().configurada, false);
  fs.rmSync(ruta, { force: true });
});

// --------------------------------------------------------- endpoints
import { crearServidor } from "../servidor.js";

test("endpoints: validar usa la ciudad del pedido y guardar actualiza LucidSales", async () => {
  const API_KEY = "k".repeat(40);
  const pedido = {
    id: 7, idPedido: 70, idEmpresa: 6881, Nombre: "Ana", Movil: "3001112233",
    Direccion: "cra 40#23-23, centro", Pais: 47, Departamento: 2, Ciudad: 71,
    EstadoPedido: 0, Json: "[]", Observaciones: "[]",
  };
  const actualizados = [];
  const cliente = {
    async obtenerPedido() { return { ...pedido }; },
    async actualizarPedido(body) { actualizados.push(body); return { ok: true, msg: "ok" }; },
  };
  const llamadas = [];
  const validadorDireccion = {
    async validar(x) { llamadas.push(x); return { veredicto: "valida", sugerida: "Cra 40 # 23-23, Centro", resumen: "ok" }; },
    estado: () => ({}), guardar: () => ({}), borrar: () => ({}), probar: async () => ({ ok: true }),
  };
  const inter = { async nombresDeIds() { return { departamento: "Antioquia", municipio: "Medellín" }; } };
  const server = crearServidor({
    config: { API_KEY, CORS_ORIGIN: "*", CONVERSACION: path.join(os.tmpdir(), `conv-${Date.now()}.jsonl`) },
    cliente, inter, validadorDireccion,
    historial: { registrar() {}, listar: () => [] },
    subidaAuto: { estadoPedido: () => null, config: () => ({}), ultimos: () => [] },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (ruta, cuerpo) =>
    fetch(base + ruta, { method: "POST", headers: { "x-api-key": API_KEY, "content-type": "application/json" }, body: JSON.stringify(cuerpo) })
      .then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    const v = await post("/api/pedidos/7/direccion/validar", {});
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.veredicto, "valida");
    assert.deepEqual(
      { direccion: llamadas[0].direccion, ciudad: llamadas[0].ciudad, departamento: llamadas[0].departamento },
      { direccion: "cra 40#23-23, centro", ciudad: "Medellín", departamento: "Antioquia" },
    );

    const g = await post("/api/pedidos/7/direccion", { direccion: "Cra 40 # 23-23, Centro" });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.equal(actualizados.length, 1);
    assert.equal(actualizados[0].Direccion, "Cra 40 # 23-23, Centro");
    assert.equal(actualizados[0].EstadoPedido, 0, "no toca el estado");
    assert.equal(actualizados[0].Ciudad, 71, "conserva la ciudad");

    const corta = await post("/api/pedidos/7/direccion", { direccion: "x" });
    assert.equal(corta.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
