// Pruebas del backend propio contra un LucidSales falso.
//   node --test   (o npm test dentro de server/)
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearServidor } from "../servidor.js";
import { crearClienteLucid } from "../lucidsales.js";
import { crearClienteInter } from "../interrapidisimo.js";
import { crearHistorial } from "../historial.js";
import { crearAsignacion } from "../asignacion.js";
import { crearCredenciales } from "../credenciales.js";
import { faltantesDeConfig } from "../config.js";
import { crearRepartoAutomatico } from "../repartoAutomatico.js";

// ---------- Inter Rapidisisimo falso (API publica de oficinas) ----------
function crearInterFalso() {
  const llamadas = [];
  const modos = { caido: false, sinHorarios: false, listadoVacio: false };

  const CIUDADES = [
    // registro con nombre vacio: asi era como se colaba en el emparejamiento
    // ("" empieza con cualquier cosa) y robaba la cabecera del departamento
    { IdCiudad: "19050006", Descripcion: "", Departamento: "CAUCA" },
    { IdCiudad: "05001000", Descripcion: "MEDELLIN", Departamento: "ANTIOQUIA" },
    { IdCiudad: "05002000", Descripcion: "ABEJORRAL", Departamento: "ANTIOQUIA" },
    { IdCiudad: "11001000", Descripcion: "BOGOTA", Departamento: "CUNDINAMARCA" },
    { IdCiudad: "13001000", Descripcion: "CARTAGENA BOLIVAR", Departamento: "BOLIVAR" },
    { IdCiudad: "76001000", Descripcion: "CALI", Departamento: "VALLE DEL CAUCA" },
    { IdCiudad: "76147000", Descripcion: "CARTAGO", Departamento: "VALLE DEL CAUCA" },
  ];

  const oficinas = {
    "05001000": {
      IdCentroServicio: 4777,
      Tipo: "PTO",
      Nombre: "PTO/MEDELLIN/ANT/COL/CL 30 A 65 B 59",
      Direccion: "CL 30 A 65 B 59",
      Barrio: "LA AMERICA",
      IdCiudad: "05001000",
      Estado: "ACT",
      Telefono1: "6044445555",
      Telefono2: "3101112222",
      Latitud: 6.2479,
      Longitud: -75.5657,
      RecibeGiros: true,
      PagaGiros: true,
      PesoMaximo: 150,
      VolumenMaximo: 150,
      ReclamaOficina: true,
      Recaudoo: false,
      Transacciones: false,
      Distancia: 1.2,
      HorariosCentroServio: null,
      Ciudad: { IdCiudad: "05001000", Descripcion: "MEDELLIN", Departamento: "ANTIOQUIA" },
    },
    "11001000": {
      IdCentroServicio: 3691,
      Tipo: "PTO",
      Nombre: "PTO/BOGOTA/CUND/COL/CL 18 65 A 03",
      Direccion: "CL 18 65 A 03",
      Barrio: "PUENTE ARANDA",
      IdCiudad: "11001000",
      Estado: "ACT",
      Telefono1: "7456000",
      Telefono2: "3102308172",
      Latitud: 4.6385,
      Longitud: -74.112,
      RecibeGiros: true,
      PagaGiros: true,
      HorariosCentroServio: null,
      Ciudad: { IdCiudad: "11001000", Descripcion: "BOGOTA", Departamento: "CUNDINAMARCA" },
    },
    "13001000": {
      IdCentroServicio: 9111,
      Tipo: "AGE",
      Nombre: "AGE/CARTAGENA/BOL/COL/CL 30 45 60",
      Direccion: "CL 30 45 60",
      Barrio: "CENTRO",
      IdCiudad: "13001000",
      Estado: "ACT",
      Telefono1: "6056647788",
      Telefono2: "3012223333",
      Latitud: 10.4239,
      Longitud: -75.5111,
      RecibeGiros: true,
      PagaGiros: false,
      HorariosCentroServio: null,
      Ciudad: { IdCiudad: "13001000", Descripcion: "CARTAGENA BOLIVAR", Departamento: "BOLIVAR" },
    },
  };

  // Municipios sin "oficina principal" en Inter (le pasa a Cartagena,
  // Barranquilla...): el backend tiene que bajar el listado completo.
  const listados = {
    "76001000": [
      {
        IdCentroServicio: 9300,
        Tipo: "PTO",
        Nombre: "PTO/CALI/VAL/COL/CL 15 6 42",
        Direccion: "CL 15 6 42",
        Barrio: "GRANADA",
        IdCiudad: "76001000",
        Estado: "ACT",
        Telefono1: "75123456",
        Telefono2: "3201112233",
        Latitud: 3.4372,
        Longitud: -76.5227,
        RecibeGiros: true,
        PagaGiros: true,
        ReclamaOficina: true,
        HorariosCentroServio: [
          {
            DiaSemana: { Id: 1, Descripcion: "LUNES" },
            Franjas: [
              {
                TipoHorario: { IdTipoHorario: 1, Descripcion: "NORMAL" },
                HoraInicio: "2018-01-08T08:00:00",
                HoraFin: "2018-01-08T17:00:00",
              },
            ],
          },
        ],
        Ciudad: { IdCiudad: "76001000", Descripcion: "CALI", Departamento: "VALLE DEL CAUCA" },
      },
      {
        IdCentroServicio: 9301,
        Tipo: "PTO",
        Nombre: "PTO/CALI/VAL/COL/AV 6N 34 51",
        Direccion: "AV 6N 34 51",
        Barrio: "EL PEDEL",
        IdCiudad: "76001000",
        Estado: "ACT",
        Telefono1: "75999888",
        Telefono2: null,
        Latitud: 3.3712,
        Longitud: -76.5351,
        RecibeGiros: true,
        PagaGiros: true,
        HorariosCentroServio: [],
        Ciudad: { IdCiudad: "76001000", Descripcion: "CALI", Departamento: "VALLE DEL CAUCA" },
      },
    ],
  };

  const HORARIOS = {
    4777: [
      {
        DiaSemana: { Id: 3, Descripcion: "MIERCOLES" },
        Franjas: [
          {
            IdFranja: 1,
            IdTipoHorario: 1,
            TipoHorario: { IdTipoHorario: 1, Descripcion: "NORMAL" },
            HoraInicio: "2018-01-08T08:00:00",
            HoraFin: "2018-01-08T18:00:00",
          },
        ],
      },
    ],
    3691: [
      {
        DiaSemana: { Id: 3, Descripcion: "MIERCOLES" },
        Franjas: [
          {
            IdFranja: 2,
            IdTipoHorario: 2,
            TipoHorario: { IdTipoHorario: 2, Descripcion: "CONTINUO" },
            HoraInicio: "2018-01-08T06:00:00",
            HoraFin: "2018-01-08T20:00:00",
          },
        ],
      },
    ],
  };

  const server = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      llamadas.push({ metodo: req.method, ruta: u.pathname, query: u.search, cuerpo });
      const enviar = (status, datos) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(datos));
      };

      if (modos.caido) return enviar(500, { Message: "An error has occurred." });
      const p = u.pathname.replace(/^\/inter/, "");

      if (p === "/Ciudad_CV/ObtenerCiudades") return enviar(200, CIUDADES);
      if (p === "/DiaSemana_CV/ObtenerDiaSemanaActual") return enviar(200, { Id: 3, Descripcion: null });

      if (p === "/CentroServicio_CV/ObtenerOficinaPrincipalCiudad") {
        const id = u.searchParams.get("idCiudad");
        const of = oficinas[id];
        return enviar(200, of ? [of] : []);
      }

      if (p === "/CentroServicio_CV/ObtenerBodegaPrincipalPorCiudad") {
        const id = u.searchParams.get("idCiudad");
        if (id === "11001000") {
          return enviar(200, { IdCentroServicio: 1287, Nombre: "COL/BOGOTA/OF. PRINC", Direccion: "CL 18 65 A 03", Barrio: "MONTEVIDEO", Telefono1: "018000942777", Latitud: 4.6385, Longitud: -74.112 });
        }
        return enviar(200, null);
      }

      if (p === "/CentroServicio_CV/ObtenerCentrosServicioHorarios") {
        if (modos.sinHorarios) return enviar(500, { Message: "An error has occurred." });
        // cuerpo = [{NombreTabla:"CentroServicio", Llaves:["IdCentroServicio"], Valores:[4777], ...}]
        let filtros = [];
        try {
          const parsed = JSON.parse(cuerpo || "[]");
          filtros = Array.isArray(parsed) ? parsed : [];
        } catch {
          filtros = [];
        }
        const conFiltro = filtros.find(
          (x) => x && x.NombreTabla === "CentroServicio" && Array.isArray(x.Valores),
        );
        const idCiudad = u.searchParams.get("idCiudad");
        const of = oficinas[idCiudad];

        if (conFiltro) {
          const idBuscado = conFiltro.Valores[0];
          if (!of || Number(idBuscado) !== Number(of.IdCentroServicio)) return enviar(200, []);
          return enviar(200, [{ ...of, HorariosCentroServio: HORARIOS[of.IdCentroServicio] ?? [] }]);
        }

        // sin filtro -> listado completo del municipio (lo usa el fallback)
        if (modos.listadoVacio) return enviar(200, []);
        const listado = listados[idCiudad] ?? (of ? [{ ...of, HorariosCentroServio: HORARIOS[of.IdCentroServicio] ?? [] }] : []);
        return enviar(200, listado);
      }

      enviar(404, { Message: `Ruta inter faltante: ${p}` });
    });
  });

  return {
    server,
    llamadas,
    modos,
    contar: (parte) => llamadas.filter((l) => l.ruta.includes(parte)).length,
    limpiar() {
      llamadas.length = 0;
      modos.caido = false;
      modos.sinHorarios = false;
      modos.listadoVacio = false;
    },
  };
}

// ---------- LucidSales falso ----------
function crearUpstream() {
  const llamadas = [];
  const modos = { loginFallido: false, pedidoInexistente: false, update401UnaVez: false, updateRechazado: false };
  let update401Hecho = false;

  const pedido = {
    id: 10,
    idPedido: 10,
    idEmpresa: 3682,
    Nombre: "Ana",
    Apellido: "Perez",
    Movil: "+573001234567",
    EstadoPedido: 0,
    Observaciones: "[]",
    Json: '[{"product_id":"40242","price":169900,"variations":[],"quantity":1}]',
    SubTotal: "169900.00",
    CostoEnvio: "0.00",
    Total: "169900.00",
    TipoPago: 1,
    EstadoPago: 0,
    logistic: "",
    Referencias: "Robledo",
  };

  const server = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      llamadas.push({
        metodo: req.method,
        ruta: u.pathname,
        cuerpo,
        token: req.headers["x-token"] ?? null,
      });
      const enviar = (status, datos) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(datos));
      };
      const p = u.pathname;

      if (p === "/b/auth/login") {
        if (modos.loginFallido) return enviar(200, { ok: false, msg: "Credenciales invalidas" });
        return enviar(200, { ok: true, token: "tok-login", idEmpresa: ["3682", "3234"] });
      }
      if (p === "/b/auth/addShopId") {
        if (req.headers["x-token"] !== "tok-login") return enviar(401, { ok: false, msg: "Vencido" });
        return enviar(200, { ok: true, token: "tok-tienda", tiendaActiva: 3682 });
      }
      if (p.startsWith("/b/pedidos/get-pedido-by-id/")) {
        if (modos.pedidoInexistente) return enviar(404, { ok: false, msg: "Pedido no encontrado" });
        if (req.headers["x-token"] !== "tok-tienda") return enviar(401, { ok: false, msg: "Vencido" });
        return enviar(200, { ok: true, pedido: { ...pedido } });
      }
      if (p === "/b/pedidos/update") {
        if (modos.update401UnaVez && !update401Hecho) {
          update401Hecho = true;
          return enviar(401, { ok: false, msg: "Token expirado" });
        }
        if (modos.updateRechazado) return enviar(200, { ok: false, msg: "No autorizado para este pedido" });
        if (req.headers["x-token"] !== "tok-tienda") return enviar(401, { ok: false, msg: "Vencido" });
        return enviar(200, { ok: true, msg: "Pedido actualizado" });
      }
      // geografia publica (sin token): ids de LucidSales -> nombres
      if (p === "/b/tools/getCountryState") {
        return enviar(200, {
          ok: true,
          states: [
            { id: 1, name: "Bogota D.C." },
            { id: 2, name: "Antioquia" },
            { id: 6, name: "Bolívar" },
            { id: 35, name: "Cundinamarca" },
          ],
        });
      }
      if (p === "/b/tools/getStateCity") {
        const state = u.searchParams.get("state");
        const ciudades = {
          "1": [{ id: 1, name: "Bogota" }],
          "2": [
            { id: 71, name: "Medellín" },
            { id: 3, name: "Abejorral" },
            { id: 1114, name: "Bolombolo" },
          ],
          "6": [{ id: 300, name: "Cartagena" }],
        };
        return enviar(200, { ok: true, cities: ciudades[state] ?? [] });
      }
      enviar(404, { ok: false, msg: `Ruta faltante: ${p}` });
    });
  });

  return {
    server,
    llamadas,
    modos,
    limpiar() {
      llamadas.length = 0;
      update401Hecho = false;
      modos.loginFallido = false;
      modos.pedidoInexistente = false;
      modos.update401UnaVez = false;
      modos.updateRechazado = false;
    },
    contar: (ruta) => llamadas.filter((l) => l.ruta === ruta).length,
    ultimo: (ruta) => [...llamadas].reverse().find((l) => l.ruta === ruta),
  };
}

// ---------- montaje ----------
const upstream = crearUpstream();
await new Promise((r) => upstream.server.listen(0, "127.0.0.1", r));
const puertoUp = upstream.server.address().port;

const interFalso = crearInterFalso();
await new Promise((r) => interFalso.server.listen(0, "127.0.0.1", r));
const puertoInter = interFalso.server.address().port;

const RUTA_HISTORIAL = path.join(os.tmpdir(), `zunto-historial-${Date.now()}.jsonl`);
const RUTA_ASIGNACION = path.join(os.tmpdir(), `zunto-asignacion-${Date.now()}.json`);
const config = {
  PORT: 0,
  API_KEY: "clave-secreta",
  LUCID_EMAIL: "servicio@zunto.test",
  LUCID_PASSWORD: "s3creta",
  LUCID_TIENDA: "3682",
  LUCID_BASE: `http://127.0.0.1:${puertoUp}/b`,
  INTER_BASE: `http://127.0.0.1:${puertoInter}/inter`,
  CORS_ORIGIN: "*",
  HISTORIAL: RUTA_HISTORIAL,
  ASIGNACION: RUTA_ASIGNACION,
  TZ_ASIGNACION: "America/Bogota",
  TIMEOUT_MS: 5000,
};

const historial = crearHistorial(config.HISTORIAL);
const cliente = crearClienteLucid(config);
const inter = crearClienteInter(config);
const server = crearServidor({ config, cliente, historial, inter });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const puerto = server.address().port;

// servidor sin API_KEY configurada (para el test de 503)
const configSinClave = { ...config, API_KEY: "" };
const serverSinClave = crearServidor({
  config: configSinClave,
  cliente: crearClienteLucid(configSinClave),
  historial: crearHistorial(path.join(os.tmpdir(), `zunto-historial-sin-clave-${Date.now()}.jsonl`)),
});
await new Promise((r) => serverSinClave.listen(0, "127.0.0.1", r));
const puertoSinClave = serverSinClave.address().port;

after(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => serverSinClave.close(r)),
    new Promise((r) => upstream.server.close(r)),
    new Promise((r) => interFalso.server.close(r)),
  ]);
  for (const f of [RUTA_HISTORIAL, RUTA_ASIGNACION, configSinClave.HISTORIAL]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* no existia */
    }
  }
});

async function llamar(puertoDestino, metodo, ruta, { cuerpo, clave } = {}) {
  const res = await fetch(`http://127.0.0.1:${puertoDestino}${ruta}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      ...(clave === undefined ? { "x-api-key": "clave-secreta" } : clave ? { "x-api-key": clave } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => null);
  return { status: res.status, datos };
}

const post = (ruta, cuerpo, opts) => llamar(puerto, "POST", ruta, { cuerpo, ...opts });

// ---------- pruebas ----------

test("salud: responde y dice si esta listo", async () => {
  upstream.limpiar();
  const r = await llamar(puerto, "GET", "/api/salud");
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.listo, true);
  assert.deepEqual(r.datos.faltantes, []);
});

test("cambia el estado a Confirmado (2) con el cuerpo exacto del update", async () => {
  upstream.limpiar();
  const r = await post("/api/pedidos/10/estado", { estado: 2 });

  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.estadoAnterior, 0);
  assert.equal(r.datos.estadoNuevo, 2);
  assert.equal(r.datos.nombreEstado, "Confirmado");
  assert.equal(r.datos.idPedido, 10);

  // el cuerpo enviado a LucidSales lleva el estado y conserva los demas campos
  const update = upstream.ultimo("/b/pedidos/update");
  assert.ok(update, "se deberia haber llamado a /pedidos/update");
  const cuerpo = JSON.parse(update.cuerpo);
  assert.equal(cuerpo.EstadoPedido, 2);
  assert.equal(cuerpo.id, 10);
  assert.equal(cuerpo.idEmpresa, 3682);
  assert.equal(cuerpo.Movil, "+573001234567");
  assert.equal(cuerpo.Total, "169900.00");
  assert.equal("motivo" in cuerpo, false, "sin motivo si no es cancelacion");

  // flujo de auth completo
  assert.equal(upstream.contar("/b/auth/login"), 1);
  assert.equal(upstream.contar("/b/auth/addShopId"), 1);
});

test("cancelar (1) exige motivo y lo envia junto al estado", async () => {
  upstream.limpiar();

  const sinMotivo = await post("/api/pedidos/10/estado", { estado: 1 });
  assert.equal(sinMotivo.status, 400);
  assert.match(sinMotivo.datos.msg, /motivo/i);
  assert.equal(upstream.contar("/b/pedidos/update"), 0, "no debe tocar LucidSales");

  const conMotivo = await post("/api/pedidos/10/estado", { estado: 1, motivo: "cliente lo solicito" });
  assert.equal(conMotivo.status, 200);
  const cuerpo = JSON.parse(upstream.ultimo("/b/pedidos/update").cuerpo);
  assert.equal(cuerpo.EstadoPedido, 1);
  assert.equal(cuerpo.motivo, "cliente lo solicito");
});

test("rechaza estados invalidos", async () => {
  upstream.limpiar();
  for (const estado of [10, -1, "abc", null, 2.5]) {
    const r = await post("/api/pedidos/10/estado", { estado });
    assert.equal(r.status, 400, `estado ${JSON.stringify(estado)} deberia dar 400`);
  }
  assert.equal(upstream.contar("/b/pedidos/update"), 0);
});

test("rechaza x-api-key incorrecta", async () => {
  upstream.limpiar();
  const r = await post("/api/pedidos/10/estado", { estado: 2 }, { clave: "otra-clave" });
  assert.equal(r.status, 401);
  assert.equal(upstream.contar("/b/auth/login"), 0, "ni siquiera debe loguearse");
});

test("sin API_KEY en el servidor y sin sesion del panel: 401 (hay que iniciar sesion)", async () => {
  upstream.limpiar();
  const r = await llamar(puertoSinClave, "POST", "/api/pedidos/10/estado", {
    cuerpo: { estado: 2 },
    clave: "",
  });
  assert.equal(r.status, 401);
  assert.match(r.datos.msg, /sesión de LucidSales/);
});

test("se recupera si LucidSales devuelve 401 (token vencido)", async () => {
  upstream.limpiar();
  upstream.modos.update401UnaVez = true;

  const r = await post("/api/pedidos/10/estado", { estado: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estadoNuevo, 3);
  // la caché de tokens del cliente puede estar tibia; lo importante es que
  // haya vuelto a loguearse y reintentado el update
  assert.ok(upstream.contar("/b/auth/login") >= 1, "re-login tras el 401");
  assert.equal(upstream.contar("/b/pedidos/update"), 2, "segundo intento de update");
  assert.ok(upstream.contar("/b/auth/addShopId") >= 1, "re-activa la tienda tras el 401");
});

test("404 si el pedido no existe", async () => {
  upstream.limpiar();
  upstream.modos.pedidoInexistente = true;
  const r = await post("/api/pedidos/99999/estado", { estado: 2 });
  assert.equal(r.status, 404);
  assert.equal(upstream.contar("/b/pedidos/update"), 0);
});

test("no reenvia el update si el estado no cambio", async () => {
  upstream.limpiar();
  const r = await post("/api/pedidos/10/estado", { estado: 0 }); // el pedido ya esta en 0
  assert.equal(r.status, 200);
  assert.equal(r.datos.sinCambios, true);
  assert.equal(upstream.contar("/b/pedidos/update"), 0);
});

test("502 si LucidSales rechaza la actualizacion", async () => {
  upstream.limpiar();
  upstream.modos.updateRechazado = true;
  const r = await post("/api/pedidos/10/estado", { estado: 2 });
  assert.equal(r.status, 502);
  assert.match(r.datos.msg, /rechazo/i);
});

test("registra el cambio en el historial y lo expone por GET", async () => {
  upstream.limpiar();
  await post("/api/pedidos/10/estado", { estado: 4, motivo: "logistica" });

  const r = await llamar(puerto, "GET", "/api/historial?limite=10");
  assert.equal(r.status, 200);
  assert.ok(r.datos.entradas.length >= 1);
  const ultima = r.datos.entradas[0];
  assert.equal(ultima.id, 10);
  assert.equal(ultima.a, 4);
  assert.equal(ultima.origen, "api");
  assert.ok(ultima.ts);
});

test("el historial exige API key", async () => {
  const r = await llamar(puerto, "GET", "/api/historial", { clave: "mala" });
  assert.equal(r.status, 401);
});

test("404 en rutas desconocidas", async () => {
  const r = await llamar(puerto, "GET", "/api/no-existe");
  assert.equal(r.status, 404);
});

test("si no hay LUCID_TIENDA usa la primera tienda de la cuenta", async () => {
  const rutaHist = path.join(os.tmpdir(), `zunto-historial-sin-tienda-${Date.now()}.jsonl`);
  const cfg = { ...config, LUCID_TIENDA: "", API_KEY: "clave-b", HISTORIAL: rutaHist };
  const s = crearServidor({
    config: cfg,
    cliente: crearClienteLucid(cfg),
    historial: crearHistorial(rutaHist),
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;

  try {
    upstream.limpiar();
    const r = await llamar(p, "POST", "/api/pedidos/10/estado", {
      cuerpo: { estado: 2 },
      clave: "clave-b",
    });
    assert.equal(r.status, 200, `esperaba 200 y llego ${r.status}: ${r.datos?.msg}`);
    assert.equal(r.datos.estadoNuevo, 2);

    // el login debe haberse hecho y addShopId con la primera tienda (3682)
    assert.equal(upstream.contar("/b/auth/login"), 1);
    const add = upstream.ultimo("/b/auth/addShopId");
    assert.ok(add, "debio activar una tienda");
    assert.equal(JSON.parse(add.cuerpo).id, 3682);
  } finally {
    await new Promise((r) => s.close(r));
    try {
      fs.unlinkSync(rutaHist);
    } catch {
      /* no existia */
    }
  }
});

// ---------- oficinas de Inter Rapidisisimo (API publica de terceros) ----------

const oficina = (qs) => llamar(puerto, "GET", `/api/interrapidisimo/oficina${qs}`);

/**
 * Consulta hasta que no quede nada "pendiente": lo lento (horarios y listado
 * de oficinas) se resuelve en segundo plano y la siguiente llamada ya lo trae.
 */
async function oficinaLista(qs, intentos = 20) {
  let r = await oficina(qs);
  for (let i = 0; i < intentos && r.status === 200 && r.datos?.pendiente; i++) {
    await new Promise((res) => setTimeout(res, 20));
    r = await oficina(qs);
  }
  return r;
}

/** Servidor con cache de Inter recien creada (para los casos de fallo). */
async function servidorConInterNuevo() {
  const rutaHist = path.join(os.tmpdir(), `zunto-historial-inter-${Date.now()}.jsonl`);
  const cfg = { ...config, HISTORIAL: rutaHist };
  const s = crearServidor({
    config: cfg,
    cliente: crearClienteLucid(cfg),
    historial: crearHistorial(rutaHist),
    inter: crearClienteInter(cfg),
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    puerto: s.address().port,
    async cerrar() {
      await new Promise((r) => s.close(r));
      try {
        fs.unlinkSync(rutaHist);
      } catch {
        /* no existia */
      }
    },
  };
}

test("la primera consulta deja los horarios en segundo plano", async () => {
  interFalso.limpiar();
  const r = await oficina("?municipio=Medellin&departamento=Antioquia");

  // la oficina llega ya (GET rapido); los horarios van aparte (POST lento)
  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.oficina.id, 4777, "oficina en la primera respuesta");
  assert.equal(r.datos.pendiente, "horarios");
  assert.deepEqual(r.datos.horarios, []);

  await new Promise((res) => setTimeout(res, 60));
  const r2 = await oficina("?municipio=Medellin&departamento=Antioquia");
  assert.equal(r2.datos.pendiente, null, "ya no esta pendiente");
  assert.equal(r2.datos.horarios.length, 1, "ahora si vienen los horarios");
});

test("oficina por municipio y departamento escritos a mano", async () => {
  interFalso.limpiar();
  const r = await oficinaLista("?municipio=Medellin&departamento=Antioquia");

  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.consultado.idCiudad, "05001000");
  assert.equal(r.datos.consultado.coincidencia, "exacta");
  assert.equal(r.datos.consultado.origen, "nombres");
  assert.equal(r.datos.oficina.id, 4777);
  assert.equal(r.datos.oficina.direccion, "CL 30 A 65 B 59");
  assert.equal(r.datos.oficina.telefono1, "6044445555");
  assert.deepEqual(
    r.datos.horarios[0].franjas[0],
    { tipo: "NORMAL", inicio: "08:00", fin: "18:00" },
  );
  assert.equal(r.datos.horarios[0].dia, "MIERCOLES");
  assert.equal(r.datos.diaActual.id, 3);
  assert.equal(r.datos.bodega, null, "Medellin no tiene bodega en el falso");
});

test("oficina con los ids de LucidSales del pedido (municipio=71&departamento=2)", async () => {
  upstream.limpiar();
  const r = await oficina("?municipio=71&departamento=2&pais=47");

  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.consultado.origen, "ids lucidsales");
  assert.equal(r.datos.consultado.municipio, "Medellín");
  assert.equal(r.datos.consultado.departamento, "Antioquia");
  assert.equal(r.datos.consultado.idCiudad, "05001000");
  assert.equal(r.datos.oficina.id, 4777);
  assert.equal(upstream.contar("/b/tools/getCountryState"), 1);
  assert.equal(upstream.contar("/b/tools/getStateCity"), 1);
});

test("homónimo: 'Cartagena' se resuelve por el departamento", async () => {
  const r = await oficina("?municipio=Cartagena&departamento=Bolívar");

  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.consultado.idCiudad, "13001000");
  assert.equal(r.datos.consultado.listado, "CARTAGENA BOLIVAR");
  assert.equal(r.datos.consultado.coincidencia, "difusa");
  assert.equal(r.datos.oficina.id, 9111);
});

test("municipio no catalogado cae en la cabecera del departamento", async () => {
  const r = await oficina("?municipio=1114&departamento=2"); // Bolombolo (Antioquia)

  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.consultado.municipio, "Bolombolo");
  assert.equal(r.datos.consultado.idCiudad, "05001000");
  assert.equal(r.datos.consultado.coincidencia, "cabecera");
  assert.equal(r.datos.oficina.id, 4777, "devuelve la oficina de Medellin");
});

test("solo departamento -> oficina de la cabecera", async () => {
  const r = await oficina("?departamento=Antioquia");
  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.consultado.idCiudad, "05001000");
  assert.equal(r.datos.consultado.coincidencia, "cabecera");
});

test("idCiudad directo no resuelve nombres de LucidSales", async () => {
  upstream.limpiar();
  const r = await oficina("?idCiudad=11001000");

  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.consultado.origen, "idCiudad");
  assert.equal(r.datos.oficina.id, 3691);
  assert.equal(r.datos.bodega?.nombre, "COL/BOGOTA/OF. PRINC");
  assert.equal(upstream.contar("/b/tools/getCountryState"), 0);
  assert.equal(upstream.contar("/b/tools/getStateCity"), 0);
});

test("municipio sin 'oficina principal': la saca del listado (en 2 consultas)", async () => {
  // Cali: Inter devuelve [] en ObtenerOficinaPrincipalCiudad
  const primero = await oficina("?municipio=Cali&departamento=Valle del Cauca");
  assert.equal(primero.status, 200, primero.datos?.msg);
  assert.equal(primero.datos.oficina, null);
  assert.equal(primero.datos.pendiente, "oficina", "tiene que avisar que esta buscando");

  await new Promise((res) => setTimeout(res, 60));
  const segundo = await oficinaLista("?municipio=Cali&departamento=Valle del Cauca");
  assert.equal(segundo.datos.pendiente, null);
  assert.equal(segundo.datos.oficina.id, 9300, "elige la oficina que si tiene horarios");
  assert.equal(segundo.datos.oficina.direccion, "CL 15 6 42");
  assert.equal(segundo.datos.horarios[0].dia, "LUNES");
  assert.equal(segundo.datos.totalOficinas, 2, "dice cuantas oficinas hay en el municipio");
});

test("el endpoint de oficinas es publico (no pide x-api-key)", async () => {
  const r = await oficina("?municipio=Cali&departamento=Valle del Cauca");
  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.ok, true);
});

test("sin parametros -> 400 con mensaje accionable", async () => {
  const r = await oficina("");
  assert.equal(r.status, 400);
  assert.match(r.datos.msg, /municipio/i);
});

test("municipio y departamento desconocidos -> 200 con oficina null", async () => {
  const r = await oficina("?municipio=La Pradera&departamento=Atlantida");
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.oficina, null);
  assert.equal(r.datos.consultado.coincidencia, "ninguna");
  assert.match(r.datos.msg, /no tiene catalogado/i);
});

test("el catalogo de municipios se descarga una sola vez (cache 24 h)", async () => {
  const antes = interFalso.contar("ObtenerCiudades");
  await oficina("?municipio=Cali&departamento=Valle del Cauca");
  await oficina("?municipio=Cartago&departamento=Valle del Cauca");
  await oficina("?idCiudad=05001000");
  assert.equal(interFalso.contar("ObtenerCiudades"), antes, "no debe volver a bajar los 1117 municipios");
});

test("buscador de municipios (?buscar=...)", async () => {
  const r = await llamar(puerto, "GET", "/api/interrapidisimo/municipios?buscar=cartag");
  assert.equal(r.status, 200);
  assert.equal(r.datos.total, 7);
  assert.equal(r.datos.encontradas, 2, "CARTAGENA BOLIVAR y CARTAGO");
  assert.equal(r.datos.municipios[0].idCiudad, "13001000");

  const general = await llamar(puerto, "GET", "/api/interrapidisimo/municipios?limite=3");
  assert.equal(general.datos.municipios.length, 3);
  assert.equal(general.datos.encontradas, 7);
});

test("si Inter Rapidisisimo esta caido responde 502 (no rompe el panel)", async () => {
  const s = await servidorConInterNuevo();
  interFalso.modos.caido = true;
  try {
    const r = await llamar(s.puerto, "GET", "/api/interrapidisimo/oficina?municipio=Medellin&departamento=Antioquia");
    assert.equal(r.status, 502);
    assert.match(r.datos.msg, /Inter Rapidisisimo/i);
    assert.equal(r.datos.ok, false);
  } finally {
    interFalso.modos.caido = false;
    await s.cerrar();
  }
});

test("si fallan los horarios la oficina igual se responde (con aviso)", async () => {
  const s = await servidorConInterNuevo();
  interFalso.modos.sinHorarios = true;
  try {
    const primera = await llamar(s.puerto, "GET", "/api/interrapidisimo/oficina?idCiudad=05001000");
    assert.equal(primera.status, 200, primera.datos?.msg);
    assert.equal(primera.datos.oficina.id, 4777, "la oficina llega aunque no haya horarios");
    assert.equal(primera.datos.pendiente, "horarios");

    await new Promise((res) => setTimeout(res, 60));
    const r = await llamar(s.puerto, "GET", "/api/interrapidisimo/oficina?idCiudad=05001000");
    assert.equal(r.status, 200, r.datos?.msg);
    assert.equal(r.datos.oficina.id, 4777, "la oficina sigue ahi");
    assert.deepEqual(r.datos.horarios, []);
    assert.equal(r.datos.pendiente, null, "no queda en bucle reintentando");
    assert.match(r.datos.aviso, /Sin horarios/i);

    // reintentar=1 borra el fallo y vuelve a lanzar la tarea
    const otra = await llamar(s.puerto, "GET", "/api/interrapidisimo/oficina?idCiudad=05001000&reintentar=1");
    assert.equal(otra.status, 200);
    assert.equal(otra.datos.pendiente, "horarios", "el reintento relanza la tarea");
    assert.equal(otra.datos.aviso, undefined);
  } finally {
    interFalso.modos.sinHorarios = false;
    await s.cerrar();
  }
});

// ---------- listado de TODAS las oficinas (GET /api/interrapidisimo/oficinas) ----------

const oficinas = (qs, puertoDestino = puerto) =>
  llamar(puertoDestino, "GET", `/api/interrapidisimo/oficinas${qs}`);

/** Consulta hasta que deje de estar pendiente el listado (hay un reintento lento). */
async function oficinasLista(qs, puertoDestino = puerto, intentos = 80) {
  let r = await oficinas(qs, puertoDestino);
  for (let i = 0; i < intentos && r.status === 200 && r.datos?.pendiente; i++) {
    await new Promise((res) => setTimeout(res, 50));
    r = await oficinas(qs, puertoDestino);
  }
  return r;
}

test("listado: la primera consulta baja las oficinas en segundo plano", async () => {
  interFalso.limpiar();
  const primero = await oficinas("?municipio=Medellin&departamento=Antioquia");
  assert.equal(primero.status, 200, primero.datos?.msg);
  assert.equal(primero.datos.ok, true);
  assert.equal(primero.datos.pendiente, "listado", "lo lento va detras");
  assert.deepEqual(primero.datos.oficinas, []);

  const r = await oficinasLista("?municipio=Medellin&departamento=Antioquia");
  assert.equal(r.datos.pendiente, null);
  assert.equal(r.datos.origen, "listado");
  assert.equal(r.datos.total, 1, "el falso solo tiene una oficina en Medellin");
  assert.equal(r.datos.enInter, 1);
  assert.equal(r.datos.consultado.idCiudad, "05001000");
  assert.equal(r.datos.consultado.coincidencia, "exacta");

  const of = r.datos.oficinas[0];
  assert.equal(of.id, 4777);
  assert.equal(of.direccion, "CL 30 A 65 B 59");
  assert.equal(of.distancia, 1.2, "la distancia a las coordenadas de referencia (para ordenar)");
  assert.deepEqual(of.horarioHoy, [
    { tipo: "NORMAL", inicio: "08:00", fin: "18:00" },
  ], "el horario de hoy sale del dia de la semana actual");
  assert.equal(r.datos.diaActual.id, 3);
  assert.equal(r.datos.bodega, null);
});

test("listado: trae todas las oficinas del municipio y cachea el POST lento", async () => {
  const qs = "?municipio=Cali&departamento=Valle del Cauca";
  const r = await oficinasLista(qs);
  assert.equal(r.status, 200, r.datos?.msg);
  assert.equal(r.datos.total, 2, "las dos oficinas del falso");
  assert.deepEqual(r.datos.oficinas.map((o) => o.id).sort((a, b) => a - b), [9300, 9301]);
  assert.equal(r.datos.consultado.idCiudad, "76001000");

  // segunda consulta: sirve de cache y no vuelve a pegarle al POST lento
  const antes = interFalso.contar("ObtenerCentrosServicioHorarios");
  const otra = await oficinas(qs);
  assert.equal(otra.datos.pendiente, null);
  assert.equal(otra.datos.total, 2);
  assert.equal(interFalso.contar("ObtenerCentrosServicioHorarios"), antes, "sin nueva llamada lenta");

  // reintentar=1 borra la cache y vuelve a bajarlo
  const relanzada = await oficinas(`${qs}&reintentar=1`);
  assert.equal(relanzada.datos.pendiente, "listado");
  const lista = await oficinasLista(qs);
  assert.equal(lista.datos.total, 2);
  assert.ok(
    interFalso.contar("ObtenerCentrosServicioHorarios") > antes,
    "reintentar=1 si volvio a llamar",
  );
});

test("listado: municipio no catalogado -> 200 con aviso y sin oficinas", async () => {
  const r = await oficinas("?municipio=La Pradera&departamento=Atlantida");
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.consultado.coincidencia, "ninguna");
  assert.deepEqual(r.datos.oficinas, []);
  assert.match(r.datos.msg, /no tiene catalogado/i);
});

test("listado: sin parametros -> 400 con mensaje accionable", async () => {
  const r = await oficinas("");
  assert.equal(r.status, 400);
  assert.match(r.datos.msg, /municipio/i);
});

test("listado: es publico (no pide x-api-key)", async () => {
  const r = await llamar(
    puerto,
    "GET",
    "/api/interrapidisimo/oficinas?municipio=Cali&departamento=Valle del Cauca",
    { clave: false },
  );
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
});

test("listado: si Inter devuelve la lista vacia, se apoya en la oficina principal", async () => {
  interFalso.limpiar();
  interFalso.modos.listadoVacio = true;
  const s = await servidorConInterNuevo();
  try {
    const primero = await oficinas("?municipio=Medellin&departamento=Antioquia", s.puerto);
    assert.equal(primero.status, 200, primero.datos?.msg);
    assert.equal(primero.datos.pendiente, "listado");

    const r = await oficinasLista("?municipio=Medellin&departamento=Antioquia", s.puerto);
    assert.equal(r.datos.pendiente, null);
    assert.equal(r.datos.origen, "principal", "respaldo con la oficina principal");
    assert.equal(r.datos.total, 1);
    assert.equal(r.datos.oficinas[0].id, 4777);
    assert.match(r.datos.aviso, /solo la oficina principal/i);
  } finally {
    interFalso.limpiar();
    await s.cerrar();
  }
});

test("listado: si Inter esta caido responde con aviso y reintentar=1 lo relanza", async () => {
  interFalso.limpiar();
  const s = await servidorConInterNuevo();
  try {
    const qs = "?municipio=Cali&departamento=Valle del Cauca";
    // el catalogo se cachea antes del apagon (si no, ni siquiera resuelve el municipio)
    const cat = await llamar(s.puerto, "GET", "/api/interrapidisimo/municipios?buscar=cali");
    assert.equal(cat.status, 200);

    interFalso.modos.caido = true;
    const primero = await oficinas(qs, s.puerto);
    assert.equal(primero.status, 200, "responde rapido aunque el listado vaya en segundo plano");
    assert.equal(primero.datos.pendiente, "listado");

    await new Promise((res) => setTimeout(res, 80));
    const segundo = await oficinas(qs, s.puerto);
    assert.equal(segundo.status, 200, "un fallo de Inter no tumba el endpoint");
    assert.deepEqual(segundo.datos.oficinas, []);
    assert.match(segundo.datos.aviso, /Sin listado de oficinas/i);

    // vuelve Inter y se pide reintentar
    interFalso.modos.caido = false;
    const tercero = await oficinas(`${qs}&reintentar=1`, s.puerto);
    assert.equal(tercero.datos.pendiente, "listado", "el reintento borra el fallo");
    const listo = await oficinasLista(qs, s.puerto);
    assert.equal(listo.datos.total, 2);
    assert.equal(listo.datos.aviso, undefined);
  } finally {
    interFalso.limpiar();
    await s.cerrar();
  }
});

// ---------- horarios de usuarios y reparto equitativo de pedidos ----------
async function servidorDeAsignacion() {
  const rutaAsig = path.join(
    os.tmpdir(),
    `zunto-asignacion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  const rutaHist = path.join(os.tmpdir(), `zunto-hist-asig-${Date.now()}.jsonl`);
  const cfg = { ...config, ASIGNACION: rutaAsig, TZ_ASIGNACION: "America/Bogota" };
  const s = crearServidor({
    config: cfg,
    cliente: crearClienteLucid(cfg),
    historial: crearHistorial(rutaHist),
    inter: crearClienteInter(cfg),
    asignacion: crearAsignacion(rutaAsig, { zona: cfg.TZ_ASIGNACION }),
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    puerto: s.address().port,
    ruta: rutaAsig,
    async cerrar() {
      await new Promise((r) => s.close(r));
      for (const f of [rutaAsig, rutaHist]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* no existia */
        }
      }
    },
  };
}

test("asignacion: sin api key responde 401", async () => {
  const s = await servidorDeAsignacion();
  try {
    const r = await llamar(s.puerto, "GET", "/api/asignacion", { clave: "" });
    assert.equal(r.status, 401);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: guarda el horario, lo persiste y lo borra", async () => {
  const s = await servidorDeAsignacion();
  try {
    const vacio = await llamar(s.puerto, "GET", "/api/asignacion");
    assert.equal(vacio.status, 200);
    assert.deepEqual(vacio.datos.horarios, {});
    assert.equal(vacio.datos.ahora.dia >= 1 && vacio.datos.ahora.dia <= 7, true);

    const guardar = await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: {
        usuario: "ana@demo.com",
        nombre: "Ana",
        horario: { activo: true, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "17:00" },
      },
    });
    assert.equal(guardar.status, 200);
    assert.equal(guardar.datos.horario.desde, "08:00");

    const conHorario = await llamar(s.puerto, "GET", "/api/asignacion");
    assert.deepEqual(conHorario.datos.horarios["ana@demo.com"].dias, [1, 2, 3, 4, 5]);
    assert.equal(conHorario.datos.horarios["ana@demo.com"].activo, true);
    assert.equal(typeof conHorario.datos.enHorario["ana@demo.com"], "boolean");

    // quedo escrito en disco
    const disco = JSON.parse(fs.readFileSync(s.ruta, "utf8"));
    assert.equal(disco.horarios["ana@demo.com"].nombre, "Ana");

    const borrar = await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: { usuario: "ana@demo.com", horario: null },
    });
    assert.equal(borrar.status, 200);
    const trasBorrar = await llamar(s.puerto, "GET", "/api/asignacion");
    assert.equal(trasBorrar.datos.horarios["ana@demo.com"], undefined);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: rechaza horarios con formato invalido", async () => {
  const s = await servidorDeAsignacion();
  try {
    const horas = await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: { usuario: "ana@demo.com", horario: { desde: "25:99", hasta: "17:00", dias: [1] } },
    });
    assert.equal(horas.status, 400);
    assert.match(horas.datos.msg, /HH:MM/);

    const dias = await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: { usuario: "ana@demo.com", horario: { desde: "08:00", hasta: "17:00", dias: [0, 9] } },
    });
    assert.equal(dias.status, 400);
    assert.match(dias.datos.msg, /dias/i);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: reparte equitativamente y sigue equilibrando", async () => {
  const s = await servidorDeAsignacion();
  try {
    const usuarios = [
      { usuario: "ana@demo.com", nombre: "Ana" },
      { usuario: "luis@demo.com", nombre: "Luis" },
      { usuario: "maria@demo.com", nombre: "Maria" },
    ];
    const primero = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: { idEmpresa: 3682, modo: "todos", usuarios, pedidos: [1, 2, 3, 4, 5] },
    });
    assert.equal(primero.status, 200);
    assert.equal(primero.datos.reparto.length, 5);
    const t1 = Object.values(primero.datos.totales);
    assert.equal(t1.reduce((a, b) => a + b, 0), 5);
    assert.equal(
      Math.max(...t1) - Math.min(...t1) <= 1,
      true,
      `reparto desigual: ${JSON.stringify(t1)}`,
    );

    // otros 5: cuenta los anteriores y sigue parejo
    const segundo = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: { idEmpresa: 3682, modo: "todos", usuarios, pedidos: [6, 7, 8, 9, 10] },
    });
    assert.equal(segundo.status, 200);
    const t2 = Object.values(segundo.datos.totales);
    assert.equal(t2.reduce((a, b) => a + b, 0), 10);
    assert.equal(Math.max(...t2) - Math.min(...t2) <= 1, true);

    // las asignaciones quedan ligadas a la tienda indicada
    const estado = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=3682");
    assert.equal(Object.keys(estado.datos.asignaciones).length, 10);
    const otra = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=9999");
    assert.equal(Object.keys(otra.datos.asignaciones).length, 0);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: no reasigna los ya asignados salvo que se pida", async () => {
  const s = await servidorDeAsignacion();
  try {
    const usuarios = [{ usuario: "ana@demo.com", nombre: "Ana" }];
    const base = { idEmpresa: 3682, modo: "todos", usuarios, pedidos: [20, 21] };
    const primero = await llamar(s.puerto, "POST", "/api/asignacion/repartir", { cuerpo: base });
    assert.equal(primero.datos.reparto.length, 2);

    const segundo = await llamar(s.puerto, "POST", "/api/asignacion/repartir", { cuerpo: base });
    assert.equal(segundo.datos.reparto.length, 0);
    assert.equal(segundo.datos.omitidos.length, 2);
    assert.equal(segundo.datos.omitidos[0].motivo, "ya asignado");

    const forzado = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: { ...base, reasignar: true },
    });
    assert.equal(forzado.datos.reparto.length, 2);
    assert.equal(forzado.datos.omitidos.length, 0);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: modo horario solo reparte a quien esta en turno", async () => {
  const s = await servidorDeAsignacion();
  try {
    await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: {
        usuario: "ana@demo.com",
        nombre: "Ana",
        horario: { activo: true, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "17:00" },
      },
    });
    const usuarios = [
      { usuario: "ana@demo.com", nombre: "Ana" },
      { usuario: "luis@demo.com", nombre: "Luis" }, // sin horario
    ];

    // dia 1 (lunes) a las 10:00 -> Ana esta en turno
    const enTurno = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "horario",
        usuarios,
        pedidos: [30, 31],
        ahora: { dia: 1, minutos: 600 },
      },
    });
    assert.equal(enTurno.status, 200);
    assert.equal(enTurno.datos.reparto.length, 2);
    assert.equal(
      new Set(enTurno.datos.reparto.map((r) => r.usuario)).size,
      1,
      "solo la que esta en turno",
    );
    assert.equal(enTurno.datos.reparto[0].usuario, "ana@demo.com");

    // dia 1 a las 20:00 -> nadie en turno
    const fueraTurno = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "horario",
        usuarios,
        pedidos: [32],
        ahora: { dia: 1, minutos: 1200 },
      },
    });
    assert.equal(fueraTurno.status, 409);
    assert.match(fueraTurno.datos.msg, /horario/i);

    // domingo (dia 7) tampoco, porque sus dias son 1..5
    const domingo = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "horario",
        usuarios,
        pedidos: [33],
        ahora: { dia: 7, minutos: 600 },
      },
    });
    assert.equal(domingo.status, 409);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: desasigna un pedido", async () => {
  const s = await servidorDeAsignacion();
  try {
    await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "todos",
        usuarios: [{ usuario: "ana@demo.com", nombre: "Ana" }],
        pedidos: [40],
      },
    });
    const antes = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=3682");
    assert.equal(antes.datos.asignaciones["40"].usuario, "ana@demo.com");

    const borra = await llamar(s.puerto, "DELETE", "/api/asignacion/pedido/40");
    assert.equal(borra.status, 200);
    assert.equal(borra.datos.existia, true);

    const despues = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=3682");
    assert.equal(despues.datos.asignaciones["40"], undefined);

    // limpiar por tienda
    await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 777,
        modo: "todos",
        usuarios: [{ usuario: "ana@demo.com", nombre: "Ana" }],
        pedidos: [41, 42],
      },
    });
    const limpio = await llamar(s.puerto, "POST", "/api/asignacion/limpiar", {
      cuerpo: { idEmpresa: 777 },
    });
    assert.equal(limpio.datos.quitadas, 2);
    const final = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=777");
    assert.equal(Object.keys(final.datos.asignaciones).length, 0);
  } finally {
    await s.cerrar();
  }
});

test("asignacion: modo manual asigna aunque el horario este pausado", async () => {
  const s = await servidorDeAsignacion();
  try {
    // horario pausado: en modo "todos" no participaria
    await llamar(s.puerto, "PUT", "/api/asignacion/horario", {
      cuerpo: {
        usuario: "ana@demo.com",
        nombre: "Ana",
        horario: { activo: false, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "17:00" },
      },
    });

    const manual = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "manual",
        reasignar: true,
        usuarios: [{ usuario: "ana@demo.com", nombre: "Ana" }],
        pedidos: [50],
      },
    });
    assert.equal(manual.status, 200, manual.datos?.msg);
    assert.equal(manual.datos.reparto.length, 1);
    assert.equal(manual.datos.reparto[0].usuario, "ana@demo.com");

    // y se puede cambiar a otro (reasignar)
    const cambio = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: {
        idEmpresa: 3682,
        modo: "manual",
        reasignar: true,
        usuarios: [{ usuario: "luis@demo.com", nombre: "Luis" }],
        pedidos: [50],
      },
    });
    assert.equal(cambio.datos.reparto[0].usuario, "luis@demo.com");
    const estado = await llamar(s.puerto, "GET", "/api/asignacion?idEmpresa=3682");
    assert.equal(estado.datos.asignaciones["50"].usuario, "luis@demo.com", "quedo cambiado");
    assert.equal(Object.keys(estado.datos.asignaciones).length, 1, "no duplica");

    // sin usuarios: no se puede
    const vacio = await llamar(s.puerto, "POST", "/api/asignacion/repartir", {
      cuerpo: { idEmpresa: 3682, modo: "manual", reasignar: true, usuarios: [], pedidos: [51] },
    });
    assert.equal(vacio.status, 400);
  } finally {
    await s.cerrar();
  }
});

// ---------- reparto automatico (round robin) ----------
function clienteAuto({ pedidos = [], usuarios = [], caer = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    /** la misma referencia: el test puede meter pedidos nuevos entre vueltas */
    pedidos,
    usuarios,
    async listarPedidos(q) {
      llamadas.push({ tipo: "pedidos", q });
      if (caer) throw new Error("LucidSales no responde");
      return { pedidos };
    },
    async listarUsuarios(q) {
      llamadas.push({ tipo: "usuarios", q });
      if (caer) throw new Error("LucidSales no responde");
      return { usuarios };
    },
  };
}

/** Motor con su archivo de asignacion aislado. */
function motorAsignacion(cliente) {
  const ruta = path.join(
    os.tmpdir(),
    `zunto-asig-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  const asig = crearAsignacion(ruta, { zona: "America/Bogota" });
  const auto = crearRepartoAutomatico({
    asignacion: asig,
    cliente,
    config: { LUCID_TIENDA: "3682" },
    log: { log() {}, warn() {} },
  });
  return {
    asig,
    auto,
    ruta,
    cerrar() {
      try {
        fs.unlinkSync(ruta);
      } catch {
        /* no existia */
      }
    },
  };
}

test("reparto automatico: apagado ni siquiera consulta la API", async () => {
  const cliente = clienteAuto({
    pedidos: [{ id: 1, EstadoPedido: 0 }],
    usuarios: [{ Usuario: "ana@x.com", Nombre: "Ana", activo: 1 }],
  });
  const m = motorAsignacion(cliente);
  try {
    const r = await m.auto.tick();
    assert.equal(r.saltado, "desactivado");
    assert.equal(cliente.llamadas.length, 0, "no toca LucidSales");
    assert.equal(Object.keys(m.asig.estado("3682").asignaciones).length, 0);
  } finally {
    m.cerrar();
  }
});

test("reparto automatico: reparte solo los por confirmar y no duplica", async () => {
  const cliente = clienteAuto({
    pedidos: [
      { id: 1, EstadoPedido: 0 },
      { id: 2, EstadoPedido: 6 }, // entregado: fuera (estados [0])
      { id: 3, EstadoPedido: 0 },
      { id: 4, EstadoPedido: 0 },
    ],
    usuarios: [
      { Usuario: "ana@x.com", Nombre: "Ana", activo: 1 },
      { Usuario: "luis@x.com", Nombre: "Luis", activo: 1 },
      { Usuario: "baja@x.com", Nombre: "Baja", activo: 0 }, // inactivo
    ],
  });
  const m = motorAsignacion(cliente);
  try {
    m.asig.setConfig({ automatico: true, modo: "todos", tiendas: ["3682"], estados: [0] });
    const r = await m.auto.tick();
    assert.equal(r.ok, true);
    assert.equal(r.repartidos, 3, "solo los por confirmar (1, 3 y 4)");
    assert.equal(r.porTienda["3682"], 3);

    const asig = m.asig.estado("3682").asignaciones;
    assert.equal(Object.keys(asig).length, 3);
    assert.equal(asig["2"], undefined, "el entregado no se toca");
    const duenos = [...new Set(Object.values(asig).map((a) => a.usuario))];
    assert.equal(duenos.includes("baja@x.com"), false, "el inactivo no recibe");
    const totales = duenos.map((u) => Object.values(asig).filter((a) => a.usuario === u).length);
    assert.equal(
      Math.max(...totales) - Math.min(...totales) <= 1,
      true,
      `reparto desigual: ${JSON.stringify(totales)}`,
    );
    assert.equal(m.asig.getUltimo().repartidos, 3);

    // segunda vuelta: todo ya tiene dueno
    const r2 = await m.auto.tick();
    assert.equal(r2.repartidos, 0);
    assert.equal(Object.keys(m.asig.estado("3682").asignaciones).length, 3, "no duplica");
  } finally {
    m.cerrar();
  }
});

test("reparto automatico: en modo horario sin nadie en turno no reparte", async () => {
  const pedidos = [{ id: 10, EstadoPedido: 0 }];
  const cliente = clienteAuto({
    pedidos,
    usuarios: [{ Usuario: "ana@x.com", Nombre: "Ana", activo: 1 }],
  });
  const m = motorAsignacion(cliente);
  try {
    m.asig.ponerHorario(
      "ana@x.com",
      { activo: true, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "17:00" },
      { nombre: "Ana" },
    );
    m.asig.setConfig({ automatico: true, modo: "horario", tiendas: ["3682"], estados: [0] });

    // dia 1 (lunes) a las 10:00 -> en turno
    const enTurno = await m.auto.tick({ dia: 1, minutos: 600 });
    assert.equal(enTurno.ok, true);
    assert.equal(enTurno.repartidos, 1);

    // llega otro pedido y ya es de noche
    pedidos.push({ id: 11, EstadoPedido: 0 });
    const fuera = await m.auto.tick({ dia: 1, minutos: 1200 });
    assert.equal(fuera.ok, false);
    assert.match(fuera.msg, /horario/i);
    assert.equal(
      Object.keys(m.asig.estado("3682").asignaciones).length,
      1,
      "no asigna si nadie esta en turno",
    );
  } finally {
    m.cerrar();
  }
});

test("reparto automatico: la lista de participantes mete y saca usuarios", async () => {
  const cliente = clienteAuto({
    pedidos: [{ id: 20, EstadoPedido: 0 }, { id: 21, EstadoPedido: 0 }, { id: 22, EstadoPedido: 0 }],
    usuarios: [
      { Usuario: "ana@x.com", Nombre: "Ana", activo: 1 },
      { Usuario: "luis@x.com", Nombre: "Luis", activo: 1 },
    ],
  });
  const m = motorAsignacion(cliente);
  try {
    // solo Ana esta "dentro"
    m.asig.setConfig({
      automatico: true,
      modo: "todos",
      tiendas: ["3682"],
      estados: [0],
      usuarios: ["ana@x.com"],
    });
    const r = await m.auto.tick();
    assert.equal(r.ok, true);
    assert.equal(r.repartidos, 3);
    const asig = m.asig.estado("3682").asignaciones;
    const duenos = [...new Set(Object.values(asig).map((a) => a.usuario))];
    assert.deepEqual(duenos, ["ana@x.com"], "los de fuera no reciben nada");

    // nadie dentro -> no reparte y lo explica
    cliente.pedidos.push({ id: 23, EstadoPedido: 0 });
    m.asig.setConfig({ usuarios: [] });
    const vacio = await m.auto.tick();
    assert.equal(vacio.ok, false);
    assert.match(vacio.msg, /participa/i);
    assert.equal(m.asig.estado("3682").asignaciones["23"], undefined, "no asigna a ciegas");

    // los dos participantes: el segundo pedido de la ultima vuelta reparte a los dos
    m.asig.setConfig({ usuarios: ["ana@x.com", "luis@x.com"] });
    const todos = await m.auto.tick();
    assert.equal(todos.ok, true);
    assert.equal(todos.repartidos, 1);
    const duenos2 = [...new Set(Object.values(m.asig.estado("3682").asignaciones).map((a) => a.usuario))];
    assert.equal(duenos2.length, 2, "los dos participantes terminan con pedidos");
  } finally {
    m.cerrar();
  }
});

test("reparto automatico: un fallo del upstream queda registrado", async () => {
  const cliente = clienteAuto({ caer: true });
  const m = motorAsignacion(cliente);
  try {
    m.asig.setConfig({ automatico: true, tiendas: ["3682"] });
    const r = await m.auto.tick();
    assert.equal(r.ok, false);
    assert.match(r.msg, /no responde/);
    assert.equal(m.asig.getUltimo().ok, false);
    assert.ok(m.asig.getUltimo().ts);
  } finally {
    m.cerrar();
  }
});

test("PUT /api/asignacion/config: valida, persiste y lo devuelve el GET", async () => {
  const guardar = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: {
      automatico: true,
      cadaSegundos: 30,
      modo: "todos",
      tiendas: ["3682", "3234"],
      estados: [0, 2],
      basura: "x",
    },
  });
  assert.equal(guardar.status, 200);
  assert.equal(guardar.datos.config.automatico, true);
  assert.equal(guardar.datos.config.cadaSegundos, 30);
  assert.equal(guardar.datos.config.modo, "todos");
  assert.deepEqual(guardar.datos.config.tiendas, ["3682", "3234"]);
  assert.deepEqual(guardar.datos.config.estados, [0, 2]);
  assert.equal("basura" in guardar.datos.config, false, "las claves raras se ignoran");

  // participantes: se normalizan (minusculas, sin vacios) y [] significa nadie
  const conUsuarios = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: { usuarios: ["Ana@Demo.COM", "  ", "luis@demo.com"] },
  });
  assert.deepEqual(conUsuarios.datos.config.usuarios, ["ana@demo.com", "luis@demo.com"]);
  const sinUsuarios = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: { usuarios: [] },
  });
  assert.deepEqual(sinUsuarios.datos.config.usuarios, []);

  // null = volver a sin restriccion (todos dentro)
  const libre = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: { usuarios: null },
  });
  assert.equal(libre.datos.config.usuarios, null);

  // valores invalidos: se corrigen, no rompen
  const malo = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: { cadaSegundos: 5, modo: "nada" },
  });
  assert.equal(malo.datos.config.cadaSegundos, 10, "se sube al minimo de 10 s");
  assert.equal(malo.datos.config.modo, "todos", "modo invalido se ignora");

  const get = await llamar(puerto, "GET", "/api/asignacion");
  assert.equal(get.datos.config.automatico, true);
  assert.equal(get.datos.config.cadaSegundos, 10);

  // se puede apagar y lo demas se conserva
  const off = await llamar(puerto, "PUT", "/api/asignacion/config", {
    cuerpo: { automatico: false },
  });
  assert.equal(off.datos.config.automatico, false);
  assert.equal(off.datos.config.modo, "todos");
  assert.equal(off.datos.config.cadaSegundos, 10);
});

// ---------- credenciales: el admin las guarda desde el panel ----------
async function servidorConCredenciales() {
  const ruta = path.join(
    os.tmpdir(),
    `zunto-cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  const rutaHist = path.join(os.tmpdir(), `zunto-hist-cred-${Date.now()}.jsonl`);
  const cfg = { ...config, HISTORIAL: rutaHist, CREDENCIALES: ruta };
  const cliente = crearClienteLucid(cfg);
  const s = crearServidor({
    config: cfg,
    cliente,
    historial: crearHistorial(rutaHist),
    inter: crearClienteInter(cfg),
    credenciales: crearCredenciales({ ruta, config: cfg }),
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    puerto: s.address().port,
    ruta,
    cfg,
    cliente,
    async cerrar() {
      await new Promise((r) => s.close(r));
      for (const f of [ruta, rutaHist]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* no existia */
        }
      }
    },
  };
}

test("credenciales: pide api key y nunca devuelve la contraseña", async () => {
  const s = await servidorConCredenciales();
  try {
    const sinClave = await llamar(s.puerto, "GET", "/api/credenciales", { clave: "" });
    assert.equal(sinClave.status, 401);

    const guardar = await llamar(s.puerto, "PUT", "/api/credenciales", {
      cuerpo: { email: "servicio@zunto.test", password: "s3creta-1234" },
    });
    assert.equal(guardar.status, 200);
    assert.equal(guardar.datos.guardadas, true);
    assert.match(guardar.datos.email, /^s\*+o@zunto\.test$/, "correo enmascarado");
    assert.equal("password" in guardar.datos, false, "la contraseña nunca sale");
    assert.equal(s.cfg.LUCID_PASSWORD, "s3creta-1234", "efectivas en memoria, sin reiniciar");

    // persistidas en disco para cuando se reinicie
    const disco = JSON.parse(fs.readFileSync(s.ruta, "utf8"));
    assert.equal(disco.email, "servicio@zunto.test");
    assert.equal(disco.password, "s3creta-1234");

    const get = await llamar(s.puerto, "GET", "/api/credenciales");
    assert.equal(get.datos.guardadas, true);
    assert.equal("password" in get.datos, false);
    assert.equal(faltantesDeConfig(s.cfg).length, 0, "dejan de estar en faltantes");
  } finally {
    await s.cerrar();
  }
});

test("credenciales: valida el formato y se pueden borrar", async () => {
  const s = await servidorConCredenciales();
  try {
    const malo = await llamar(s.puerto, "PUT", "/api/credenciales", {
      cuerpo: { email: "no-es-correo", password: "1234" },
    });
    assert.equal(malo.status, 400);
    assert.match(malo.datos.msg, /correo/i);

    const corta = await llamar(s.puerto, "PUT", "/api/credenciales", {
      cuerpo: { email: "a@b.co", password: "12" },
    });
    assert.equal(corta.status, 400);
    assert.match(corta.datos.msg, /contraseña/i);

    await llamar(s.puerto, "PUT", "/api/credenciales", {
      cuerpo: { email: "a@b.co", password: "1234" },
    });
    const borrar = await llamar(s.puerto, "DELETE", "/api/credenciales");
    assert.equal(borrar.datos.guardadas, false);
    assert.equal(s.cfg.LUCID_EMAIL, "", "fuera de memoria");
    assert.equal(fs.existsSync(s.ruta), false, "fuera de disco");
    assert.ok(faltantesDeConfig(s.cfg).length > 0, "vuelven a aparecer en faltantes");
  } finally {
    await s.cerrar();
  }
});

test("credenciales guardadas: el cliente de LucidSales las usa", async () => {
  const s = await servidorConCredenciales();
  try {
    await llamar(s.puerto, "PUT", "/api/credenciales", {
      cuerpo: { email: "servicio@zunto.test", password: "s3creta" },
    });
    const antes = upstream.contar("/b/auth/login");
    const pedido = await s.cliente.obtenerPedido(3256175);
    assert.ok(pedido && pedido.id, "el pedido se pudo leer con las credenciales guardadas");
    assert.ok(upstream.contar("/b/auth/login") > antes, "hizo login con las nuevas credenciales");
  } finally {
    await s.cerrar();
  }
});

test("envios: Lucid Bot manda el estado y el panel lo consulta", async () => {
  let r = await post("/api/envios/estado", { estado: "EN REPARTO", telefono: "+57 300 123 4567", guia: "{{guia}}" });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.recibido.estado, "EN REPARTO");
  r = await post("/api/envios/estado", { telefono: "3001234567" });
  assert.equal(r.status, 400);
  assert.match(r.datos.msg, /estado/);
  r = await post("/api/envios/estado", { estado: "ENTREGADO", telefono: "3001234567" }, { clave: null });
  assert.equal(r.status, 401);
  r = await post("/api/envios/consultar", { pedidos: [{ id: 10, idPedido: 10, telefono: "+573001234567" }] });
  assert.equal(r.datos.estados["10"].estado, "EN REPARTO");
});
