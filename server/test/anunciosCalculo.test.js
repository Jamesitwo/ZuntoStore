// Pruebas de los CALCULOS de rentabilidad y de la configuracion por usuario
// (efectividad de entrega, campanas compartidas, archivadas, monedas, cache,
// vincular campanas, importar productos y la tienda de la sesion).
//   node --test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  crearAnalisisAnuncios,
  hoy,
  restarDias,
  sugerirProducto,
  tipoEstadoEnvio,
} from "../anunciosMeta.js";

let n = 0;
function graphFalso(campanas, insights) {
  const llamadas = [];
  const fn = async (url) => {
    const u = new URL(url);
    llamadas.push(u.pathname);
    const cuenta = (u.pathname.match(/act_\d+/) ?? [])[0];
    const responder = (data) => ({ json: async () => ({ data }) });
    if (u.pathname.endsWith("/campaigns")) return responder(campanas[cuenta] ?? []);
    if (u.pathname.endsWith("/insights")) return responder(insights[cuenta] ?? []);
    throw new Error(`ruta inesperada ${u.pathname}`);
  };
  fn.llamadas = llamadas;
  return fn;
}

const compra = (v) => [{ action_type: "omni_purchase", value: String(v) }];

function montar({ cuentas, campanas, insights, productos, manual = [], ajustes = {} }) {
  const dir = path.join(os.tmpdir(), `zunto-calculo-${Date.now()}-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const rutaAjustes = path.join(dir, "config.json");
  fs.writeFileSync(
    rutaAjustes,
    JSON.stringify({ token: "tok", version: "v25.0", trm: 4000, cuentas, ...ajustes }),
  );
  fs.writeFileSync(path.join(dir, "productos.json"), JSON.stringify(productos));
  fs.writeFileSync(path.join(dir, "manual.json"), JSON.stringify(manual));
  const fetcher = graphFalso(campanas, insights);
  const a = crearAnalisisAnuncios({ dir, rutaAjustes, fetcher });
  return {
    a,
    fetcher,
    dir,
    rutaAjustes,
    limpiar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const COP = [{ id: "1", nombre: "Mia", moneda: "COP" }];

test("hoy() va en hora de Colombia aunque el servidor este en UTC", () => {
  // 22:00 en Bogota = 03:00Z del dia siguiente
  assert.equal(hoy(new Date("2026-10-22T03:00:00Z")), "2026-10-21");
  assert.equal(hoy(new Date("2026-10-22T05:30:00Z")), "2026-10-22");
  assert.equal(restarDias("2026-03-01", 1), "2026-02-28");
});

test("estados de envio: entregado, fallido o en camino", () => {
  assert.equal(tipoEstadoEnvio("ENTREGADO"), "entregado");
  assert.equal(tipoEstadoEnvio("Cancelado"), "fallido");
  assert.equal(tipoEstadoEnvio("DEVOLUCION"), "fallido");
  assert.equal(tipoEstadoEnvio("RECHAZADO"), "fallido");
  assert.equal(tipoEstadoEnvio("GUIA_ANULADA"), "fallido");
  assert.equal(tipoEstadoEnvio("ENTREGADA A CONEXIONES"), "curso");
  assert.equal(tipoEstadoEnvio("EN REPARTO"), "curso");
});

test("la ganancia por compra descuenta lo que no se entrega", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "Taladro", status: "ACTIVE", created_time: "2026-01-01" }] },
    insights: { act_1: [{ campaign_id: "c1", spend: "100000", actions: compra(10) }] },
    productos: [
      {
        nombre: "Taladro",
        ganancia: 30000,
        campanas: ["Taladro"],
        // 60 entregados, 40 no (30 cancelados + 10 devueltos), 50 en camino
        pedidos: {
          n: 60,
          nTotal: 200,
          estados: { ENTREGADO: 60, Cancelado: 30, DEVOLUCION: 10, "EN REPARTO": 50 },
        },
      },
    ],
  });
  try {
    const d = await m.a.datos({ dias: 15 });
    assert.equal(d.entrega.tasa, 0.6);
    assert.equal(d.entrega.origen, "pedidos");
    assert.equal(d.entrega.sinEnvio, 50);
    const c = d.campanas[0];
    // 10 compras x 30.000 x 60% = 180.000 de margen
    assert.equal(c.porCompra, 18000);
    assert.equal(c.margen, 180000);
    assert.equal(c.neto, 80000);
    assert.equal(c.roi, 1.8);
    assert.equal(c.clase, "AJUSTADA");

    // contando los que nunca se enviaron como no entregados: 60/150 = 40%
    const e = m.a.guardarEntrega({ contarSinEnvio: true });
    assert.equal(e.tasa, 0.4);
    const d2 = await m.a.datos({ dias: 15 });
    assert.equal(d2.campanas[0].margen, 120000);
    assert.equal(d2.campanas[0].clase, "RIESGO"); // 1,2x: apenas empata

    // fijada a mano (se acepta 70 o 0.7)
    assert.equal(m.a.guardarEntrega({ modo: "manual", tasa: 70 }).tasa, 0.7);
    const d3 = await m.a.datos({ dias: 15 });
    assert.equal(d3.campanas[0].margen, 210000);
    assert.throws(() => m.a.guardarEntrega({ modo: "manual", tasa: 0 }), /1% y 100%/);
  } finally {
    m.limpiar();
  }
});

test("sin datos de entregas se avisa que se supone el 100%", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "Taladro", status: "ACTIVE" }] },
    insights: { act_1: [{ campaign_id: "c1", spend: "1000", actions: compra(1) }] },
    productos: [{ nombre: "Taladro", ganancia: 5000, campanas: ["Taladro"] }],
  });
  try {
    const d = await m.a.datos({ dias: 7 });
    assert.equal(d.entrega.tasa, 1);
    assert.equal(d.entrega.origen, "sin datos");
    assert.match(d.aviso, /100%/);
  } finally {
    m.limpiar();
  }
});

test("una campana compartida reparte gasto y compras entre sus productos", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "Combo", status: "ACTIVE" }] },
    insights: { act_1: [{ campaign_id: "c1", spend: "60000", actions: compra(4) }] },
    productos: [
      { nombre: "A", ganancia: 10000, campanas: ["Combo"] },
      { nombre: "B", ganancia: 30000, campanas: ["Combo"] },
    ],
  });
  try {
    const d = await m.a.datos({ dias: 15 });
    const c = d.campanas[0];
    assert.equal(c.compartida, true);
    assert.equal(c.margen, 4 * 20000); // promedio de 10.000 y 30.000
    const a = d.productos.find((p) => p.nombre === "A");
    const b = d.productos.find((p) => p.nombre === "B");
    // cada uno se lleva la mitad: la suma da el total (no el doble)
    assert.equal(a.gasto + b.gasto, 60000);
    assert.equal(a.compras + b.compras, 4);
    assert.equal(a.margen + b.margen, c.margen);
  } finally {
    m.limpiar();
  }
});

test("si un producto vinculado no tiene ganancia, la campana queda sin dato", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "Combo", status: "ACTIVE" }] },
    insights: { act_1: [{ campaign_id: "c1", spend: "60000", actions: compra(4) }] },
    productos: [
      { nombre: "A", ganancia: 10000, campanas: ["Combo"] },
      { nombre: "B", ganancia: 0, campanas: ["Combo"] },
    ],
  });
  try {
    const d = await m.a.datos({ dias: 15 });
    const c = d.campanas[0];
    assert.equal(c.clase, "SINDATO");
    assert.deepEqual(c.faltaGanancia, ["B"]);
    assert.match(c.accion.detalle, /«B»/);
    assert.equal(d.totales.gastoSinDato, 60000);
    assert.equal(d.totales.campanasSinGanancia, 1);
  } finally {
    m.limpiar();
  }
});

test("las campanas archivadas que gastaron tambien cuentan", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "Viva", status: "ACTIVE" }] },
    insights: {
      act_1: [
        { campaign_id: "c1", campaign_name: "Viva", spend: "1000", actions: compra(1) },
        // ya no sale en /campaigns (archivada) pero gasto en la ventana
        { campaign_id: "c9", campaign_name: "Vieja", spend: "50000", actions: compra(0) },
      ],
    },
    productos: [{ nombre: "Viva", ganancia: 5000, campanas: ["Viva", "Vieja"] }],
  });
  try {
    const d = await m.a.datos({ dias: 15 });
    assert.equal(d.totales.gasto, 51000);
    const vieja = d.campanas.find((c) => c.id === "c9");
    assert.equal(vieja.nombre, "Vieja");
    assert.equal(vieja.estado, "ARCHIVED");
    assert.equal(vieja.clase, "PERDIDA");
    assert.equal(vieja.alerta, false, "archivada: no pide accion");
  } finally {
    m.limpiar();
  }
});

test("una cuenta en otra moneda queda fuera y se avisa", async () => {
  const m = montar({
    cuentas: [...COP, { id: "2", nombre: "Euro", moneda: "EUR" }],
    campanas: { act_1: [{ id: "c1", name: "X", status: "ACTIVE" }], act_2: [{ id: "e1", name: "Y", status: "ACTIVE" }] },
    insights: {
      act_1: [{ campaign_id: "c1", spend: "1000", actions: compra(1) }],
      act_2: [{ campaign_id: "e1", spend: "10", actions: compra(1) }],
    },
    productos: [],
  });
  try {
    const d = await m.a.datos({ dias: 15 });
    assert.equal(d.totales.gasto, 1000);
    assert.match(d.aviso, /EUR/);
    assert.equal(d.cuentas.length, 1);
  } finally {
    m.limpiar();
  }
});

test("si cambian las cuentas elegidas, la cache del dia no se reutiliza", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "X", status: "ACTIVE" }], act_2: [{ id: "c2", name: "Y", status: "ACTIVE" }] },
    insights: {
      act_1: [{ campaign_id: "c1", spend: "1000", actions: compra(1) }],
      act_2: [{ campaign_id: "c2", spend: "2000", actions: compra(1) }],
    },
    productos: [],
  });
  try {
    assert.equal((await m.a.datos({ dias: 15 })).totales.gasto, 1000);
    const cfg = JSON.parse(fs.readFileSync(m.rutaAjustes, "utf8"));
    cfg.cuentas = [{ id: "2", nombre: "Otra", moneda: "COP" }];
    fs.writeFileSync(m.rutaAjustes, JSON.stringify(cfg));
    assert.equal((await m.a.datos({ dias: 15 })).totales.gasto, 2000);
  } finally {
    m.limpiar();
  }
});

test("vincular una campana a un producto (y desvincularla)", async () => {
  const m = montar({
    cuentas: COP,
    campanas: { act_1: [{ id: "c1", name: "REPLICANTE Taladro Inalambrico 2", status: "ACTIVE" }] },
    insights: { act_1: [{ campaign_id: "c1", spend: "10000", actions: compra(2) }] },
    productos: [
      { nombre: "Taladro Inalambrico Dewalt", ganancia: 20000, campanas: [] },
      { nombre: "Perfume Eclaire", ganancia: 9000, campanas: [] },
    ],
  });
  try {
    let d = await m.a.datos({ dias: 15 });
    assert.equal(d.campanas[0].sinProducto, true);
    assert.equal(d.campanas[0].sugerido, "Taladro Inalambrico Dewalt");
    assert.equal(d.totales.campanasSinProducto, 1);

    m.a.vincular({ campana: "REPLICANTE Taladro Inalambrico 2", productos: ["Taladro Inalambrico Dewalt"] });
    d = await m.a.datos({ dias: 15 });
    assert.deepEqual(d.campanas[0].productos, ["Taladro Inalambrico Dewalt"]);
    assert.equal(d.campanas[0].margen, 40000);

    // cambiarla de producto reemplaza el vinculo anterior
    m.a.vincular({ campana: "REPLICANTE Taladro Inalambrico 2", productos: ["Perfume Eclaire"] });
    d = await m.a.datos({ dias: 15 });
    assert.deepEqual(d.campanas[0].productos, ["Perfume Eclaire"]);

    m.a.vincular({ campana: "REPLICANTE Taladro Inalambrico 2", productos: [] });
    d = await m.a.datos({ dias: 15 });
    assert.equal(d.campanas[0].sinProducto, true);
    assert.throws(() => m.a.vincular({ campana: "X", productos: ["No existe"] }), /no encontrado/);
  } finally {
    m.limpiar();
  }
});

test("importar productos usa la tienda y la sesion de quien pide", async () => {
  const m = montar({ cuentas: COP, campanas: {}, insights: {}, productos: [{ nombre: "Ya Estaba", ganancia: 7000 }] });
  const llamadas = [];
  const lucid = {
    async productosTienda(id) {
      llamadas.push(`catalogo:${id}`);
      return [
        { id: 1, Nombre: "Ya estaba", Precio: 1 },
        { id: 2, Nombre: "Nuevo Uno", Precio: "59900" },
      ];
    },
    async analitica({ idShop, productId }) {
      llamadas.push(`analitica:${idShop}:${productId}`);
      return { pedidosTotales: { value: 30 }, utilidaData: { gananciaEsperada: 30 * 8000 } };
    },
  };
  try {
    m.a.contexto({ lucid, tienda: 999 });
    const r = await m.a.importarProductos();
    assert.equal(r.nuevos, 1);
    assert.equal(r.tienda, 999);
    const lista = JSON.parse(fs.readFileSync(path.join(m.dir, "productos.json"), "utf8"));
    assert.equal(lista.length, 2);
    assert.equal(lista[0].ganancia, 7000, "no toca lo que ya estaba");
    assert.equal(lista[1].precio, 59900);

    // el traedor de ganancias tambien va contra la tienda de la sesion
    assert.equal(m.a.estadoGanancias().ajustes.tienda, 999);
    await m.a.traerGanancias({ esperar: true, forzar: true });
    assert.ok(llamadas.every((l) => l.includes("999")), llamadas.join(" "));
    const nuevo = JSON.parse(fs.readFileSync(path.join(m.dir, "productos.json"), "utf8"))[1];
    assert.equal(nuevo.ganancia, 8000, "relleno: 30 pedidos >= 20");
  } finally {
    m.limpiar();
  }
});

test("sugerirProducto: casa por palabras del nombre, no por casualidad", () => {
  const nombres = ["Taladro inhalambrico Americano DEWALT", "Sierra Dewalt 68 Voltios", "Perfume Eclaire"];
  assert.equal(sugerirProducto("[Taladro inhalambrico - Copia 2]", nombres), nombres[0]);
  assert.equal(sugerirProducto("Perfume Eclaire mujer", nombres), "Perfume Eclaire");
  assert.equal(sugerirProducto("SINTETICA DANA", nombres), null);
});
