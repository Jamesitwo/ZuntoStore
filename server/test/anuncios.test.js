// Pruebas del modulo de rentabilidad de anuncios (Meta Ads).
//   node --test   (o npm test dentro de server/)
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearServidor } from "../servidor.js";
import { crearClienteLucid } from "../lucidsales.js";
import { crearHistorial } from "../historial.js";
import { comprasDe, normalizar } from "../anunciosMeta.js";
import { crearRegistroAnuncios } from "../anunciosTenant.js";

// ---------- Graph API falso (solo /campaigns y /insights) ----------
const CAMpanas = {
  act_111: [
    { id: "c1", name: "Taladro Pro", status: "ACTIVE", created_time: "2026-09-01T10:00:00.000+0000" },
    { id: "c2", name: "Campana Sin Producto", status: "PAUSED", created_time: "2026-09-01T10:00:00.000+0000" },
  ],
  act_222: [
    { id: "c3", name: "Perfume Eclaire", status: "ACTIVE", created_time: "2026-09-20T10:00:00.000+0000" },
  ],
};

// Pizdo opera en USD: 5 y 10 USD. Orenar en COP: 50000.
const INSIGHTS = {
  act_111: [
    {
      campaign_id: "c1",
      spend: "5",
      purchase_roas: [{ action_type: "omni_purchase", value: "6.6" }],
      // Meta repite la compra en varios tipos: hay que contarla UNA sola vez
      actions: [
        { action_type: "omni_purchase", value: "5" },
        { action_type: "onsite_app_purchase", value: "5" },
        { action_type: "onsite_conversion.purchase", value: "5" },
        { action_type: "link_click", value: "100" },
      ],
    },
    {
      campaign_id: "c2",
      spend: "10",
      actions: [
        { action_type: "omni_purchase", value: "2" },
        { action_type: "link_click", value: "40" },
      ],
    },
  ],
  act_222: [
    {
      campaign_id: "c3",
      spend: "50000",
      actions: [{ action_type: "omni_purchase", value: "4" }],
    },
  ],
};

function fetcherFalso({ caido = false } = {}) {
  const llamadas = [];
  const fn = async (url) => {
    const u = new URL(url);
    llamadas.push(u.pathname);
    const responder = (datos) => ({ json: async () => datos });
    if (caido) throw new Error("ECONNREFUSED graph.facebook.com");
    const cuenta = (u.pathname.match(/act_\d+/) ?? [])[0];
    if (u.pathname.endsWith("/campaigns")) {
      return responder({ data: CAMpanas[cuenta] ?? [] });
    }
    if (u.pathname.endsWith("/insights")) {
      const rango = u.searchParams.get("time_range") ?? "{}";
      const { since, until } = JSON.parse(rango);
      const filas = (INSIGHTS[cuenta] ?? []).filter(
        (f) => since <= until, // la ventana siempre es valida en las pruebas
      );
      return responder({ data: filas });
    }
    throw new Error(`Ruta inesperada del Graph falso: ${u.pathname}`);
  };
  fn.llamadas = llamadas;
  return fn;
}

// ---------- montaje ----------
let tmpId = 0;
function carpetaTemporal() {
  return path.join(
    os.tmpdir(),
    `zunto-anuncios-${Date.now()}-${(tmpId++).toString(36)}`,
  );
}

function montar({ fetcher, conModulo = true, snapshot = false } = {}) {
  const dir = carpetaTemporal();
  fs.mkdirSync(dir, { recursive: true });
  const rutaAjustes = path.join(dir, "ajustes.json");
  fs.writeFileSync(
    rutaAjustes,
    JSON.stringify({
      token: "tok-de-prueba",
      version: "v25.0",
      trm: 3000,
      cuentas: [
        { id: "111", nombre: "Pizdo", moneda: "USD" },
        { id: "222", nombre: "Orenar", moneda: "COP" },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "productos.json"),
    JSON.stringify([
      { name: "Taladro Pro", price: 199900, unit: 20000, campaigns: ["Taladro Pro"] },
      { name: "Perfume Eclaire", price: 120000, unit: 5000, campaigns: ["Perfume Eclaire"] },
    ]),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "manual.json"), JSON.stringify([]), "utf8");
  if (snapshot) {
    fs.writeFileSync(
      path.join(dir, "snapshot.json"),
      JSON.stringify({
        window: ["2026-09-23", "2026-10-07"],
        campaigns: [
          {
            name: "Guardada",
            status: "ACTIVE",
            created: "2026-09-24",
            spend_cop: 300000, // 100 USD al estar en Pizdo (USD)
            purchases: 6,
            roas: 2,
            account: "Pizdo",
          },
        ],
      }),
      "utf8",
    );
  }

  const registro = conModulo
    ? crearRegistroAnuncios({
        baseDir: dir,
        rutaCompartida: rutaAjustes,
        fetcher: fetcher ?? fetcherFalso(),
      })
    : null;
  const analisis = registro ? registro.para(null) : null;

  const config = {
    PORT: 0,
    API_KEY: "clave-secreta",
    LUCID_EMAIL: "x@y.z",
    LUCID_PASSWORD: "p",
    LUCID_BASE: "http://127.0.0.1:1/b",
    INTER_BASE: "http://127.0.0.1:1/i",
    CORS_ORIGIN: "*",
    HISTORIAL: path.join(dir, "historial.jsonl"),
    TZ_ASIGNACION: "America/Bogota",
    TIMEOUT_MS: 1000,
  };
  const server = crearServidor({
    config,
    cliente: crearClienteLucid(config),
    historial: crearHistorial(config.HISTORIAL),
    anuncios: analisis ?? undefined,
  });

  return {
    dir,
    analisis,
    registro,
    async abrir() {
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      this.puerto = server.address().port;
      return this.puerto;
    },
    async cerrar() {
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function llamar(puerto, metodo, ruta, { cuerpo, clave, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      ...(clave === undefined ? { "x-api-key": "clave-secreta" } : clave ? { "x-api-key": clave } : {}),
      ...headers,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { status: res.status, datos, texto, headers: res.headers };
}

after(() => {
  /* cada prueba limpia su propia carpeta */
});

// ---------- pruebas ----------

test("anuncios: exige x-api-key", async () => {
  const m = montar({});
  await m.abrir();
  try {
    const sin = await llamar(m.puerto, "GET", "/api/anuncios", { clave: "" });
    assert.equal(sin.status, 401);
    const mala = await llamar(m.puerto, "GET", "/api/anuncios", { clave: "otra" });
    assert.equal(mala.status, 401);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: 503 si el servidor no tiene el modulo montado", async () => {
  const m = montar({ conModulo: false });
  await m.abrir();
  try {
    const r = await llamar(m.puerto, "GET", "/api/anuncios");
    assert.equal(r.status, 503);
    assert.match(r.datos.msg, /modulo de anuncios/i);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: calcula gasto en COP, compras sin duplicar y clasifica", async () => {
  const m = montar({});
  await m.abrir();
  try {
    const r = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(r.status, 200, r.datos?.msg);
    assert.equal(r.datos.ok, true);
    assert.equal(r.datos.fuente, "live");
    assert.equal(r.datos.ventana.dias, 15);
    assert.equal(r.datos.totales.campanas, 3, "las tres campanas con gasto");

    const porId = Object.fromEntries(r.datos.campanas.map((c) => [c.id, c]));

    // Pizdo: 5 USD x trm 3000 = 15000 COP, 5 compras (no 15)
    assert.equal(porId.c1.gasto, 15000);
    assert.equal(porId.c1.compras, 5, "una compra repetida en 3 tipos cuenta 1 vez");
    assert.equal(porId.c1.clase, "RENTABLE", "margen 100000 sobre 15000 -> ROI 6.7x");
    assert.equal(porId.c1.cuenta, "Pizdo");
    assert.equal(porId.c1.estado, "ACTIVE");
    assert.equal(porId.c1.accion.titulo, "Escalar: subir presupuesto +20%");

    // Sin producto vinculado -> SINDATO (margen null) y la accion es vincularla
    assert.equal(porId.c2.clase, "SINDATO");
    assert.equal(porId.c2.margen, null);
    assert.equal(porId.c2.estado, "PAUSED");
    assert.equal(porId.c2.sinProducto, true);
    assert.match(porId.c2.accion.titulo, /vincular/i);

    // Orenar opera en COP: 50000 de gasto con 40000 de margen -> perdida
    assert.equal(porId.c3.gasto, 50000, "Orenar NO se multiplica por la trm");
    assert.equal(porId.c3.neto, -30000);
    assert.equal(porId.c3.clase, "PERDIDA");
    assert.equal(porId.c3.accion.titulo, "Pausar hoy");

    // totales
    assert.equal(r.datos.conteos.RENTABLE, 1);
    assert.equal(r.datos.conteos.PERDIDA, 1);
    assert.equal(r.datos.conteos.SINDATO, 1);
    assert.equal(r.datos.totales.gasto, 15000 + 30000 + 50000);
    assert.equal(r.datos.totales.perdidas, -30000);
    assert.ok(r.datos.totales.perdidasDia > 0, "el ritmo diario de perdida");

    // roll-up por producto
    const taladro = r.datos.productos.find((p) => p.nombre === "Taladro Pro");
    assert.equal(taladro.unidad, 20000);
    assert.equal(taladro.clase, "RENTABLE");

    // roll-up por cuenta
    assert.equal(r.datos.cuentas.length, 2);
    const orenar = r.datos.cuentas.find((c) => c.nombre === "Orenar");
    assert.equal(orenar.neto, -30000);
    assert.equal(orenar.perdidas, -30000);
    assert.equal(r.datos.trm, 3000);

    // el cache del dia: la segunda consulta no vuelve a pegarle a Meta
    const otra = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(otra.status, 200);
    assert.equal(otra.datos.totales.campanas, 3);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: la ventana de 7 dias usa su propio cache", async () => {
  const fetcher = fetcherFalso();
  const m = montar({ fetcher });
  await m.abrir();
  try {
    await llamar(m.puerto, "GET", "/api/anuncios?dias=7");
    await llamar(m.puerto, "GET", "/api/anuncios?dias=30");
    const archivos = fs.readdirSync(m.dir).filter((f) => f.startsWith("datos_"));
    assert.equal(archivos.length, 2, "una cache por ventana: 7d y 30d");
    assert.ok(archivos.some((f) => f.includes("_7d_")), archivos.join(", "));
    assert.ok(archivos.some((f) => f.includes("_30d_")), archivos.join(", "));
  } finally {
    await m.cerrar();
  }
});

test("anuncios: guardar ganancia recalcula neto, clase y accion", async () => {
  const m = montar({});
  await m.abrir();
  try {
    const antes = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(antes.datos.campanas.find((c) => c.id === "c1").clase, "RENTABLE");

    const malo = await llamar(m.puerto, "POST", "/api/anuncios/ganancia", {
      cuerpo: { nombre: "Producto Fantasma", ganancia: 100 },
    });
    assert.equal(malo.status, 400);
    assert.match(malo.datos.msg, /no encontrado/i);

    const negativo = await llamar(m.puerto, "POST", "/api/anuncios/ganancia", {
      cuerpo: { nombre: "Taladro Pro", ganancia: -5 },
    });
    assert.equal(negativo.status, 400);

    const ok = await llamar(m.puerto, "POST", "/api/anuncios/ganancia", {
      cuerpo: { nombre: "Taladro Pro", ganancia: 1000 },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.datos.ganancia, 1000);

    const despues = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    const c1 = despues.datos.campanas.find((c) => c.id === "c1");
    assert.equal(c1.unidad, 1000);
    assert.equal(c1.margen, 5000, "5 compras x 1000");
    assert.equal(c1.neto, -10000, "5000 - 15000");
    assert.equal(c1.clase, "PERDIDA");
    assert.equal(c1.accion.titulo, "Pausar hoy");

    // quedo escrito en disco
    const disco = JSON.parse(fs.readFileSync(path.join(m.dir, "productos.json"), "utf8"));
    assert.equal(disco.find((p) => p.name === "Taladro Pro").unit, 1000);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: el plan de acciones se guarda y se lee", async () => {
  const m = montar({});
  await m.abrir();
  try {
    const vacio = await llamar(m.puerto, "GET", "/api/anuncios/plan");
    assert.equal(vacio.status, 200);
    assert.deepEqual(vacio.datos.plan, {});

    const marca = await llamar(m.puerto, "POST", "/api/anuncios/plan", {
      cuerpo: { id: "c3", hecho: true },
    });
    assert.equal(marca.status, 200);
    assert.equal(marca.datos.entrada.hecho, true);

    const conNota = await llamar(m.puerto, "POST", "/api/anuncios/plan", {
      cuerpo: { id: "c3", nota: "pausada el 7/10" },
    });
    assert.equal(conNota.datos.entrada.nota, "pausada el 7/10");
    assert.equal(conNota.datos.entrada.hecho, true, "la nota no borra el hecho");

    const luego = await llamar(m.puerto, "GET", "/api/anuncios/plan");
    assert.equal(luego.datos.plan.c3.hecho, true);
    assert.equal(luego.datos.plan.c3.nota, "pausada el 7/10");

    const sinId = await llamar(m.puerto, "POST", "/api/anuncios/plan", { cuerpo: {} });
    assert.equal(sinId.status, 400);
    assert.match(sinId.datos.msg, /id/i);

    const disco = JSON.parse(fs.readFileSync(path.join(m.dir, "plan.json"), "utf8"));
    assert.equal(disco.c3.hecho, true);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: exporta CSV de campanas, alertas y productos", async () => {
  const m = montar({});
  await m.abrir();
  try {
    const campanas = await llamar(m.puerto, "GET", "/api/anuncios/csv?dias=15&vista=campanas");
    assert.equal(campanas.status, 200);
    assert.match(campanas.headers.get("content-type"), /text\/csv/);
    assert.match(campanas.headers.get("content-disposition"), /reporte_campanas_15dias\.csv/);
    const lineas = campanas.texto.replace(/^\ufeff/, "").split(/\r?\n/);
    assert.match(lineas[0], /^Campana;Producto\(s\);Cuenta/);
    assert.equal(lineas.length, 4, "cabecera + 3 campanas");

    const alertas = await llamar(m.puerto, "GET", "/api/anuncios/csv?dias=15&vista=alertas");
    const fila = alertas.texto.replace(/^\ufeff/, "").split(/\r?\n/);
    assert.equal(
      fila.length,
      2,
      "cabecera + solo la problematica ENCENDIDA (la pausada no alerta)",
    );
    assert.match(fila[1], /PERDIDA/);

    const productos = await llamar(m.puerto, "GET", "/api/anuncios/csv?dias=15&vista=productos");
    assert.match(productos.texto.replace(/^\ufeff/, "").split(/\r?\n/)[0], /^Producto;Precio/);

    const mala = await llamar(m.puerto, "GET", "/api/anuncios/csv?dias=15&vista=zip");
    assert.equal(mala.status, 400);
    assert.match(mala.datos.msg, /vista/i);

    // el BOM va en el archivo (fetch/Response lo descarta al decodificar)
    const crudo = await m.analisis.csv({ dias: 15, vista: "campanas" });
    assert.ok(crudo.contenido.startsWith("\ufeff"), "BOM para que Excel lea los acentos");
  } finally {
    await m.cerrar();
  }
});

test("anuncios: la alerta solo sirve para campanas encendidas y con tiempo", async () => {
  // las tres campanas gastan igual (y las tres perderian): lo que las separa
  // es si estan encendidas y si llevan dias suficientes para juzgarlas.
  // n1 se crea HOY: 1 dia de datos, la campana del ejemplo que no se juzga
  const dos = (n) => String(n).padStart(2, "0");
  const ahora = new Date();
  const hoyStr = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const campanas = {
    act_111: [
      { id: "n1", name: "Taladro Pro", status: "ACTIVE", created_time: `${hoyStr}T10:00:00.000+0000` },
      { id: "p1", name: "Taladro Pro", status: "ACTIVE", created_time: `${hace30}T10:00:00.000+0000` },
      { id: "q1", name: "Taladro Pro", status: "PAUSED", created_time: `${hace30}T10:00:00.000+0000` },
    ],
  };
  const gasta = (id) => ({
    campaign_id: id,
    spend: "500", // USD -> 1.500.000 COP contra un margen de 20.000
    actions: [{ action_type: "omni_purchase", value: "1" }],
  });
  const insights = { act_111: [gasta("n1"), gasta("p1"), gasta("q1")] };
  const fetcher = async (url) => {
    const u = new URL(url);
    const responder = (d) => ({ json: async () => d });
    const cuenta = (u.pathname.match(/act_\d+/) ?? [])[0];
    if (u.pathname.endsWith("/campaigns")) return responder({ data: campanas[cuenta] ?? [] });
    if (u.pathname.endsWith("/insights")) return responder({ data: insights[cuenta] ?? [] });
    throw new Error(`Ruta inesperada del Graph falso: ${u.pathname}`);
  };

  const m = montar({ fetcher });
  await m.abrir();
  try {
    const r = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(r.status, 200, r.datos?.msg);
    assert.equal(r.datos.minDiasAlerta, 3, "recien a los 3 dias se opina");

    const porId = Object.fromEntries(r.datos.campanas.map((c) => [c.id, c]));
    const nueva = porId.n1;
    const perdida = porId.p1;
    const pausada = porId.q1;
    assert.ok(nueva && perdida && pausada, "las tres campanas entran al analisis");

    // la clase (informativa) no cambia, pero la alerta si
    assert.equal(nueva.clase, "PERDIDA", "sigue perdiendo, eso no se niega");
    assert.equal(nueva.activa, true);
    assert.equal(nueva.alerta, false, "con 1 dia todavia no se juzga");
    assert.equal(nueva.alertaMotivo, "nueva");
    assert.match(nueva.accion.titulo, /Esperar/);
    assert.match(nueva.accion.detalle, /1 dia\(s\) con datos \(minimo 3/);

    assert.equal(perdida.alerta, true, "encendida y con dias suficientes: si alerta");
    assert.equal(perdida.alertaMotivo, "");
    assert.match(perdida.accion.titulo, /Pausar/);

    assert.equal(pausada.activa, false);
    assert.equal(pausada.alerta, false, "ya pausada no vuelve a pedir que la pausen");
    assert.equal(pausada.alertaMotivo, "pausada");

    // el CSV de alertas sigue exactamente la misma regla
    const csv = await llamar(m.puerto, "GET", "/api/anuncios/csv?dias=15&vista=alertas");
    const lineas = csv.texto.split(/\r?\n/).filter(Boolean);
    assert.equal(lineas.length, 2, "cabecera + solo la encendida y vieja");
    assert.match(lineas[1], /^Taladro Pro/);
    assert.match(lineas[1], /PERDIDA/);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: si Meta cae, responde con el snapshot guardado", async () => {
  const m = montar({ fetcher: fetcherFalso({ caido: true }), snapshot: true });
  await m.abrir();
  try {
    const r = await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(r.status, 200, r.datos?.msg);
    assert.equal(r.datos.fuente, "snapshot");
    assert.match(r.datos.aviso, /No se pudo consultar Meta/);
    assert.equal(r.datos.ventana.desde, "2026-09-23");
    assert.equal(r.datos.ventana.hasta, "2026-10-07");
    assert.equal(r.datos.ventana.dias, 15);
    // el snapshot viene en COP: 300000 (Pizdo, USD, se vuelve a convertir con la trm)
    const guardada = r.datos.campanas[0];
    assert.equal(guardada.gasto, 300000);
    assert.equal(guardada.compras, 6);
  } finally {
    await m.cerrar();
  }
});

test("anuncios: actualizar fuerza una consulta nueva (aunque haya cache)", async () => {
  const fetcher = fetcherFalso();
  const m = montar({ fetcher });
  await m.abrir();
  try {
    await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    const despuesCache = fetcher.llamadas.length;
    assert.ok(despuesCache > 0);

    await llamar(m.puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(fetcher.llamadas.length, despuesCache, "la segunda sirve de cache");

    const r = await llamar(m.puerto, "POST", "/api/anuncios/actualizar", { cuerpo: { dias: 15 } });
    assert.equal(r.status, 200);
    assert.equal(r.datos.ok, true);
    assert.ok(
      fetcher.llamadas.length > despuesCache,
      "actualizar si vuelve a llamar a Meta",
    );
  } finally {
    await m.cerrar();
  }
});

// ---------- utilidades puras ----------

test("comprasDe: prioriza omni_purchase y nunca suma duplicados", () => {
  assert.equal(
    comprasDe([
      { action_type: "omni_purchase", value: "7" },
      { action_type: "onsite_app_purchase", value: "7" },
      { action_type: "link_click", value: "99" },
    ]),
    7,
  );
  // sin omni_purchase se apoya en el pixel
  assert.equal(
    comprasDe([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }]),
    3,
  );
  // compra normal de la nueva API
  assert.equal(comprasDe([{ action_type: "purchase", value: "4" }]), 4);
  assert.equal(comprasDe([]), 0);
  assert.equal(comprasDe(undefined), 0);
  // nunca suma (7 + 7 != 14)
  assert.equal(
    comprasDe([
      { action_type: "omni_purchase", value: "7" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "7" },
    ]),
    7,
  );
});

test("normalizar: iguala acentos y signos para emparejar campanas", () => {
  assert.equal(normalizar("Motosierra DEWALT – USA!"), "motosierra dewalt usa");
  assert.equal(normalizar("[⚡️Soldador]"), "soldador");
  assert.equal(normalizar(null), "");
  assert.equal(normalizar("SINTETICO XI ECLAIRE 1 - Copia"), normalizar("sintetico xi eclaire 1 copia"));
});
