// Pruebas del traedor de GANANCIAS desde los pedidos de LucidSales:
// por producto pide la analitica (ganancia esperada / pedidos) y deja el
// promedio a la vista sin pisar la ganancia escrita a mano.
//   node --test   (o npm test dentro de server/)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearServidor } from "../servidor.js";
import { crearClienteLucid } from "../lucidsales.js";
import { crearHistorial } from "../historial.js";
import { crearRegistroAnuncios } from "../anunciosTenant.js";

// ---------- Graph API falso (solo hace falta para que /api/anuncios responda)
function fetcherFalso() {
  return async (url) => {
    const u = new URL(url);
    const responder = (datos) => ({ json: async () => datos });
    if (u.pathname.endsWith("/me")) return responder({ id: "1", name: "Prueba" });
    if (u.pathname.endsWith("/me/adaccounts")) return responder({ data: [] });
    const cuenta = (u.pathname.match(/act_\d+/) ?? [])[0];
    if (u.pathname.endsWith("/campaigns")) return responder({ data: CAMpanas[cuenta] ?? [] });
    if (u.pathname.endsWith("/insights")) return responder({ data: INSIGHTS[cuenta] ?? [] });
    throw new Error(`Ruta inesperada del Graph falso: ${u.pathname}`);
  };
}
const CAMpanas = {
  act_111: [
    { id: "c1", name: "Taladro Pro", status: "ACTIVE", created_time: "2026-09-01T10:00:00.000+0000" },
    { id: "c2", name: "Perfume Eclaire", status: "ACTIVE", created_time: "2026-09-01T10:00:00.000+0000" },
  ],
};
const INSIGHTS = {
  act_111: [
    { campaign_id: "c1", spend: "50000", actions: [{ action_type: "omni_purchase", value: "3" }] },
    { campaign_id: "c2", spend: "30000", actions: [{ action_type: "omni_purchase", value: "2" }] },
  ],
};

// ---------- LucidSales falso (catalogo + analitica por producto) ----------
const CATALOGO = [
  { id: 11, Nombre: "Taladro Pro" },
  { id: 22, Nombre: "Perfume Eclaire" },
  { id: 33, Nombre: "Nivel Laser 16 Lineas Profesional" },
];
/** producto de la tienda -> {pedidos, ganancia} en la ventana */
const ANALITICA = {
  11: { pedidos: 118, ganancia: 118 * 2425 },
  22: { pedidos: 45, ganancia: 45 * 6000 },
  33: { pedidos: 10, ganancia: 10 * 9000 },
};

function lucidFalso({ analitica = ANALITICA, catalogo = CATALOGO } = {}) {
  const llamadas = [];
  return {
    llamadas,
    async productosTienda(id) {
      llamadas.push(`catalogo:${id}`);
      return catalogo;
    },
    async analitica({ productId }) {
      llamadas.push(`analitica:${productId}`);
      const a = analitica[productId] ?? { pedidos: 0, ganancia: 0 };
      return {
        pedidosTotales: { value: a.pedidos },
        utilidaData: { value: a.ganancia - 1000, gananciaEsperada: a.ganancia },
        // desglose por estado de envio: solo viene si la prueba lo pide
        ...(a.estados ? { statusData: a.estados } : {}),
      };
    },
  };
}

// ---------- montaje ----------
let tmpId = 0;
function montar({ lucid = lucidFalso(), productos = null } = {}) {
  const dir = path.join(os.tmpdir(), `zunto-ganancias-${Date.now()}-${(tmpId++).toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  const rutaAjustes = path.join(dir, "ajustes.json");
  fs.writeFileSync(
    rutaAjustes,
    JSON.stringify({
      token: "tok-compartido",
      version: "v25.0",
      trm: 3000,
      compartida: true,
      cuentas: [{ id: "111", nombre: "Pizdo", moneda: "COP" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "productos.json"),
    JSON.stringify(
      productos ?? [
        // manual: NO debe ser reemplazado aunque los pedidos digan otra cosa
        { name: "Taladro Pro", price: 199900, unit: 20000, campaigns: ["Taladro Pro"] },
        // vacio: se rellena (45 pedidos >= 20)
        { name: "Perfume Eclaire", price: 120000, unit: 0, campaigns: ["Perfume Eclaire"] },
        // el de la tienda lleva detalle de mas: se casa por nombre contenido
        { name: "Nivel Laser 16 Lineas", price: 59900, unit: 0, campaigns: [] },
        // no existe en la tienda
        { name: "Producto Raro", price: 10000, unit: 0, campaigns: [] },
      ],
    ),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "manual.json"), JSON.stringify([]), "utf8");

  const registro = crearRegistroAnuncios({
    baseDir: dir,
    rutaCompartida: rutaAjustes,
    fetcher: fetcherFalso(),
    lucid,
  });

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
    anuncios: registro,
  });

  return {
    dir,
    registro,
    lucid,
    productos: () => JSON.parse(fs.readFileSync(path.join(dir, "productos.json"), "utf8")),
    ajustes: () => JSON.parse(fs.readFileSync(rutaAjustes, "utf8")),
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

async function llamar(puerto, metodo, ruta, { cuerpo } = {}) {
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
    method: metodo,
    headers: { "content-type": "application/json", "x-api-key": "clave-secreta" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { status: res.status, datos, texto };
}

/** GET hasta que el traedor deje de correr (o se canse). */
async function esperarTermino(puerto, limite = 200) {
  let e = null;
  for (let i = 0; i < limite; i++) {
    e = await llamar(puerto, "GET", "/api/anuncios/ganancias");
    if (!e.datos.enCurso && e.datos.ultimo) return e.datos;
    await new Promise((r) => setTimeout(r, 10));
  }
  return e?.datos;
}

// ---------- pruebas ----------

test("ganancias: trae el promedio de pedidos y no pisa la ganancia manual", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.datos.ultimo.estado, "listo");
    assert.equal(r.datos.enCurso, false);
    // 3 de 4 casaron con la tienda (el Producto Raro no existe alla)
    assert.equal(r.datos.ultimo.productos, 4);
    assert.equal(r.datos.ultimo.sinMatch, 1);
    assert.equal(r.datos.ultimo.conPedidos, 3);
    assert.equal(r.datos.ultimo.errores, 0);
    // promedio global ponderado de los que tienen pedidos con ganancia
    const n = 118 + 45 + 10;
    const ganancia = 118 * 2425 + 45 * 6000 + 10 * 9000;
    assert.equal(r.datos.ultimo.promedioGlobal, Math.round(ganancia / n));

    const lista = m.productos();
    const taladro = lista.find((p) => p.name === "Taladro Pro");
    assert.equal(taladro.unit, 20000, "la ganancia escrita a mano NO se toca");
    assert.equal(taladro.pedidos.n, 118);
    assert.equal(Math.round(taladro.pedidos.prom), 2425);
    assert.equal(taladro.origenGanancia, undefined);

    const perfume = lista.find((p) => p.name === "Perfume Eclaire");
    assert.equal(perfume.unit, 6000, "un vacio se rellena con el promedio de pedidos");
    assert.equal(perfume.origenGanancia, "pedidos");
    assert.equal(perfume.pedidos.n, 45);

    const laser = lista.find((p) => p.name === "Nivel Laser 16 Lineas");
    assert.equal(laser.unit, 0, "con 10 pedidos no alcanza la muestra minima (20)");
    assert.equal(Math.round(laser.pedidos.prom), 9000, "pero el promedio si queda guardado");
    assert.match(laser.pedidos.hasta, /^\d{4}-\d{2}-\d{2}$/);

    const raro = lista.find((p) => p.name === "Producto Raro");
    assert.equal(raro.pedidos.nota, "sin producto en la tienda");
  } finally {
    await m.cerrar();
  }
});

test("ganancias: el analisis expone el promedio al lado del valor manual", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    await llamar(puerto, "POST", "/api/anuncios/ganancias", { cuerpo: { esperar: true } });
    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(d.status, 200);

    const taladro = d.datos.productos.find((p) => p.nombre === "Taladro Pro");
    assert.equal(taladro.unidad, 20000, "el calculo sigue usando el valor manual");
    assert.equal(Math.round(taladro.pedidosProm), 2425);
    assert.equal(taladro.pedidosN, 118);
    assert.equal(taladro.origenGanancia, null);

    const perfume = d.datos.productos.find((p) => p.nombre === "Perfume Eclaire");
    assert.equal(perfume.unidad, 6000, "el vacio rellenado ya entra en el calculo");
    assert.equal(perfume.origenGanancia, "pedidos");
    assert.notEqual(perfume.clase, "SINDATO", "deja de ser «Sin dato»");

    // el CSV de productos lleva las dos columnas
    const csv = await llamar(puerto, "GET", "/api/anuncios/csv?dias=15&vista=productos");
    assert.equal(csv.status, 200);
    const cabecera = csv.texto.split("\r\n")[0];
    assert.match(cabecera, /Ganancia promedio/);
    assert.match(cabecera, /Promedio pedidos/);
    assert.match(cabecera, /Pedidos \(n\)/);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: el automatico corre una vez al dia cuando se piden datos", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(d.status, 200);

    const termino = await esperarTermino(puerto);
    assert.equal(termino.ultimo.estado, "listo");
    assert.equal(termino.ultimo.rellenados, 1);
    assert.equal(termino.ajustes.auto, true);
    const ejecutado = termino.ultimo.ejecutado;

    // ya corrio hoy: pedir datos otra vez no lo vuelve a lanzar
    await llamar(puerto, "GET", "/api/anuncios?dias=15");
    await new Promise((r) => setTimeout(r, 30));
    const otra = await llamar(puerto, "GET", "/api/anuncios/ganancias");
    assert.equal(otra.datos.ultimo.ejecutado, ejecutado, "no debe repetir la corrida del dia");

    // con el automatico apagado tampoco corre
    const aj = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { auto: false },
    });
    assert.equal(aj.status, 200);
    assert.equal(aj.datos.ajustes.auto, false);
    assert.equal(m.ajustes().ganancias.auto, false);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: la muestra minima se puede bajar y ahi si se rellena", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const aj = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { minPedidos: 5, dias: 7 },
    });
    assert.equal(aj.status, 200);
    assert.equal(aj.datos.ajustes.minPedidos, 5);
    assert.equal(aj.datos.ajustes.dias, 7);

    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true },
    });
    assert.equal(r.datos.ultimo.minPedidos, 5);
    assert.equal(r.datos.ultimo.dias, 7);
    assert.equal(r.datos.ultimo.rellenados, 2, "Perfume y el Nivel Laser con 10 pedidos");

    const laser = m.productos().find((p) => p.name === "Nivel Laser 16 Lineas");
    assert.equal(laser.unit, 9000);

    // ajustes invalidos
    const malo = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { minPedidos: 0 },
    });
    assert.equal(malo.status, 400);
    const ventanaMala = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { dias: 11 },
    });
    assert.equal(ventanaMala.status, 400);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: guardar la ganancia a mano marca el origen como manual", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    await llamar(puerto, "POST", "/api/anuncios/ganancias", { cuerpo: { esperar: true } });
    assert.equal(m.productos().find((p) => p.name === "Perfume Eclaire").origenGanancia, "pedidos");

    const g = await llamar(puerto, "POST", "/api/anuncios/ganancia", {
      cuerpo: { nombre: "Perfume Eclaire", ganancia: 7500 },
    });
    assert.equal(g.status, 200);
    const p = m.productos().find((x) => x.name === "Perfume Eclaire");
    assert.equal(p.unit, 7500);
    assert.equal(p.origenGanancia, "manual");
  } finally {
    await m.cerrar();
  }
});

test("ganancias: sin credenciales de LucidSales el endpoint responde 503", async () => {
  const m = montar({ lucid: null });
  const puerto = await m.abrir();
  try {
    const e = await llamar(puerto, "GET", "/api/anuncios/ganancias");
    assert.equal(e.status, 200);
    assert.equal(e.datos.disponible, false);
    assert.equal(e.datos.ultimo, null);

    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", { cuerpo: {} });
    assert.equal(r.status, 503);
    assert.match(String(r.datos.msg ?? r.datos), /LucidSales/i);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: si la analitica falla casi toda no se guarda nada", async () => {
  const lucid = lucidFalso();
  lucid.analitica = async () => {
    throw new Error("LucidSales no devolvio la analitica: HTTP 502");
  };
  const m = montar({ lucid });
  const puerto = await m.abrir();
  try {
    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.datos.ultimo.estado, "error");
    assert.match(r.datos.ultimo.error, /HTTP 502/);
    // los productos quedan como estaban (sin campo pedidos)
    assert.equal(m.productos().every((p) => p.pedidos === undefined), true);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: el promedio solo cuenta los pedidos con ganancia (los entregados)", async () => {
  // 140 pedidos, pero solo los ENTREGADOS traen flete y costo ya
  // sincronizados en Dropi: los demas (en distribucion, sin envio,
  // cancelados) entran con ganancia 0 y, si se dividen entre ellos, hunden
  // el promedio de los que si dejaron plata
  const lucid = lucidFalso({
    analitica: {
      11: {
        pedidos: 140,
        ganancia: 70 * 5000,
        estados: [
          { name: "ENTREGADO", value: 70 },
          { name: "EN DISTRIBUCION", value: 30 },
          { name: "Sin Envio", value: 30 },
          { name: "Cancelado", value: 10 },
        ],
      },
      // ninguno entregado: hay ganancia pero no hay muestra
      22: {
        pedidos: 45,
        ganancia: 45 * 6000,
        estados: [{ name: "EN DISTRIBUCION", value: 45 }],
      },
      33: { pedidos: 10, ganancia: 10 * 9000 },
    },
  });
  const m = montar({ lucid });
  const puerto = await m.abrir();
  try {
    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.datos.ultimo.estado, "listo");

    const taladro = m.productos().find((p) => p.name === "Taladro Pro");
    assert.equal(taladro.pedidos.n, 70, "solo los entregados: los que traen ganancia");
    assert.equal(taladro.pedidos.nTotal, 140, "el total queda a la vista");
    assert.equal(taladro.pedidos.prom, 5000, "350.000 / 70, no / 140");
    assert.equal(taladro.pedidos.estados["Sin Envio"], 30, "el desglose se guarda");
    assert.equal(taladro.unit, 20000, "lo manual sigue intacto");

    const perfume = m.productos().find((p) => p.name === "Perfume Eclaire");
    assert.equal(perfume.pedidos.n, 0, "sin ninguna entrega no hay muestra");
    assert.equal(perfume.pedidos.prom, 0, "no se inventa promedio entre pedidos sin plata");
    assert.equal(perfume.unit, 0, "tampoco se rellena el vacio");
  } finally {
    await m.cerrar();
  }
});

test("ganancias: que estados cuentan se puede configurar y el panel ve el total", async () => {
  const lucid = lucidFalso({
    analitica: {
      11: {
        pedidos: 60,
        ganancia: 50 * 4000,
        estados: [
          { name: "entregado", value: 50 }, // mayusculas o no, se compara igual
          { name: "RECLAME EN OFICINA", value: 8 },
          { name: "sin envio", value: 2 },
        ],
      },
      22: { pedidos: 45, ganancia: 45 * 6000 },
      33: { pedidos: 10, ganancia: 10 * 9000 },
    },
  });
  const m = montar({ lucid });
  const puerto = await m.abrir();
  try {
    const a = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(a.status, 200);
    assert.equal(a.datos.ajustes.incluirEstados.includes("ENTREGADO"), true);
    let taladro = m.productos().find((p) => p.name === "Taladro Pro");
    assert.equal(taladro.pedidos.n, 50, "por defecto solo cuentan los entregados");

    // el estado trae el desglose por estado para armar el selector del panel
    const e = await llamar(puerto, "GET", "/api/anuncios/ganancias");
    assert.equal(e.status, 200);
    assert.deepEqual(
      e.datos.estados.map((x) => `${x.nombre}:${x.n}:${x.excluido}`),
      [
        "entregado:50:false",
        "RECLAME EN OFICINA:8:true",
        "sin envio:2:true",
      ],
    );

    // ahora la muestra tambien incluye «RECLAME EN OFICINA» (y un estado
    // que no aparecio, para poder apagarlo despues desde el panel)
    const aj = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { incluirEstados: ["ENTREGADO", "RECLAME EN OFICINA", "ESTADO FUTURO"] },
    });
    assert.equal(aj.status, 200);
    assert.deepEqual(aj.datos.ajustes.incluirEstados, [
      "ENTREGADO",
      "RECLAME EN OFICINA",
      "ESTADO FUTURO",
    ]);

    const b = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(b.status, 200);
    taladro = m.productos().find((p) => p.name === "Taladro Pro");
    assert.equal(taladro.pedidos.n, 58, "50 entregados + 8 en reclamo");
    assert.equal(Math.round(taladro.pedidos.prom), 3448, "200.000 / 58");

    const e2 = await llamar(puerto, "GET", "/api/anuncios/ganancias");
    assert.equal(
      e2.datos.estados.some((x) => x.nombre === "ESTADO FUTURO" && x.n === 0 && x.excluido === false),
      true,
      "un estado que cuenta pero no aparecio se lista para poder apagarlo",
    );

    // la lista del panel expone n y total (para «n=58 (de 60)»)
    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(d.status, 200);
    const fila = d.datos.productos.find((p) => p.nombre === "Taladro Pro");
    assert.equal(fila.pedidosN, 58);
    assert.equal(fila.pedidosNTotal, 60);

    // lista vacia o invalida
    const vacia = await llamar(puerto, "POST", "/api/anuncios/ganancias/ajustes", {
      cuerpo: { incluirEstados: [] },
    });
    assert.equal(vacia.status, 400);
  } finally {
    await m.cerrar();
  }
});

test("ganancias: un catalogo vacio no borra los promedios que ya se tenian", async () => {
  // paso en la practica: LucidSales devolvio la lista de productos vacia y
  // la corrida dejo los 73 productos como «sin producto en la tienda»
  const lucid = lucidFalso({ catalogo: [] });
  const m = montar({ lucid });
  const puerto = await m.abrir();
  try {
    const r = await llamar(puerto, "POST", "/api/anuncios/ganancias", {
      cuerpo: { esperar: true, forzar: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.datos.ultimo.estado, "error");
    assert.match(r.datos.ultimo.error, /catalogo/i);
    assert.equal(
      m.productos().every((p) => p.pedidos === undefined),
      true,
      "no se guarda nada: los promedios anteriores siguen intactos",
    );

    // con productos que no casan tampoco se guarda
    const lucid2 = lucidFalso({ catalogo: [{ id: 99, Nombre: "Otra Cosa Totalmente" }] });
    const m2 = montar({ lucid: lucid2 });
    const p2 = await m2.abrir();
    try {
      const r2 = await llamar(p2, "POST", "/api/anuncios/ganancias", {
        cuerpo: { esperar: true, forzar: true },
      });
      assert.equal(r2.datos.ultimo.estado, "error");
      assert.equal(m2.productos().every((p) => p.pedidos === undefined), true);
    } finally {
      await m2.cerrar();
    }
  } finally {
    await m.cerrar();
  }
});
