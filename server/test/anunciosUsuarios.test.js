// Pruebas del espacio multiusuario de rentabilidad de anuncios:
// cada usuario del panel conecta SU token de Meta (cabecera x-usuario) y
// sus datos (productos, plan, caches) viven en anuncios/usuarios/<email>/.
// Quien no conecta nada no ve datos de nadie (el compartido es solo para
// integraciones sin usuario).
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

const MI_TOKEN = "tok-usuario-a-0123456789";
const TOKEN_MALO = "tok-malo-0123456789abcdef";
const USUARIO = "ana@zunto.test";

// ---------- Graph API falso ----------
// /me y /me/adaccounts dependen del token; campaigns/insights, de la cuenta.
const IDENTIDAD = {
  [MI_TOKEN]: { id: "9001", name: "Ana Panel" },
  [TOKEN_MALO]: null,
};
const CUENTAS = {
  [MI_TOKEN]: [
    { account_id: "333", name: "Cuenta Personal", currency: "COP", account_status: 1 },
    { account_id: "444", name: "Cuenta USD", currency: "USD", account_status: 1 },
  ],
};
const CAMpanas = {
  act_111: [
    { id: "c1", name: "Taladro Pro", status: "ACTIVE", created_time: "2026-09-01T10:00:00.000+0000" },
    { id: "c2", name: "Otra Sin Producto", status: "PAUSED", created_time: "2026-09-01T10:00:00.000+0000" },
  ],
  act_222: [
    { id: "c3", name: "Perfume Eclaire", status: "ACTIVE", created_time: "2026-09-20T10:00:00.000+0000" },
  ],
  act_333: [
    { id: "c9", name: "Campana Personal", status: "ACTIVE", created_time: "2026-09-10T10:00:00.000+0000" },
  ],
  act_444: [
    { id: "c8", name: "Campana USD", status: "ACTIVE", created_time: "2026-09-10T10:00:00.000+0000" },
  ],
};
const INSIGHTS = {
  act_111: [
    {
      campaign_id: "c1",
      spend: "5", // USD
      purchase_roas: [{ action_type: "omni_purchase", value: "6.6" }],
      actions: [{ action_type: "omni_purchase", value: "5" }],
    },
    { campaign_id: "c2", spend: "10", actions: [{ action_type: "omni_purchase", value: "1" }] },
  ],
  act_222: [
    { campaign_id: "c3", spend: "50000", actions: [{ action_type: "omni_purchase", value: "4" }] },
  ],
  act_333: [
    { campaign_id: "c9", spend: "20000", actions: [{ action_type: "omni_purchase", value: "2" }] },
  ],
  act_444: [
    { campaign_id: "c8", spend: "100", actions: [{ action_type: "omni_purchase", value: "4" }] },
  ],
};

function fetcherFalso() {
  const llamadas = [];
  const fn = async (url) => {
    const u = new URL(url);
    llamadas.push(u.pathname);
    const responder = (datos) => ({ json: async () => datos });
    const token = u.searchParams.get("access_token");

    if (u.pathname.endsWith("/me/adaccounts")) {
      const cuentas = CUENTAS[token];
      if (!cuentas) return responder({ error: { message: "Invalid OAuth access token", code: 190 } });
      return responder({ data: cuentas });
    }
    if (u.pathname.endsWith("/me")) {
      const yo = IDENTIDAD[token];
      if (!yo) return responder({ error: { message: "Invalid OAuth access token", code: 190 } });
      return responder(yo);
    }
    const cuenta = (u.pathname.match(/act_\d+/) ?? [])[0];
    if (u.pathname.endsWith("/campaigns")) {
      return responder({ data: CAMpanas[cuenta] ?? [] });
    }
    if (u.pathname.endsWith("/insights")) {
      return responder({ data: INSIGHTS[cuenta] ?? [] });
    }
    throw new Error(`Ruta inesperada del Graph falso: ${u.pathname}`);
  };
  fn.llamadas = llamadas;
  return fn;
}

// ---------- montaje ----------
let tmpId = 0;
function montar({ compartida = true } = {}) {
  const dir = path.join(os.tmpdir(), `zunto-espacios-${Date.now()}-${(tmpId++).toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  const rutaAjustes = path.join(dir, "ajustes.json");
  fs.writeFileSync(
    rutaAjustes,
    JSON.stringify({
      token: "tok-compartido",
      version: "v25.0",
      trm: 3000,
      compartida,
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

  const registro = crearRegistroAnuncios({ baseDir: dir, rutaCompartida: rutaAjustes, fetcher: fetcherFalso() });

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

async function llamar(puerto, metodo, ruta, { cuerpo, usuario } = {}) {
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      "x-api-key": "clave-secreta",
      ...(usuario ? { "x-usuario": usuario } : {}),
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
  return { status: res.status, datos, texto };
}

/** Conecta el token del usuario y le deja 333 + 444 con trm 4000. */
async function conectarYSeleccionar(puerto) {
  const c = await llamar(puerto, "POST", "/api/anuncios/conectar", {
    cuerpo: { token: MI_TOKEN },
    usuario: USUARIO,
  });
  const s = await llamar(puerto, "POST", "/api/anuncios/cuentas", {
    cuerpo: { cuentas: ["333", "444"], trm: 4000 },
    usuario: USUARIO,
  });
  return { c, s };
}

// ---------- pruebas ----------

test("anuncios usuarios: sin x-usuario se trabaja en el espacio compartido", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const e = await llamar(puerto, "GET", "/api/anuncios/cuenta");
    assert.equal(e.status, 200);
    assert.equal(e.datos.enUso, "compartida");
    assert.equal(e.datos.conectada, true);
    assert.equal(e.datos.compartidaDisponible, true);
    assert.equal(e.datos.cuentas.length, 2);

    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(d.status, 200);
    assert.deepEqual(
      d.datos.campanas.map((c) => c.nombre).sort(),
      ["Otra Sin Producto", "Perfume Eclaire", "Taladro Pro"],
    );
    // Pizdo en USD se convierte con la trm compartida (3000)
    assert.equal(d.datos.totales.gasto, (15 * 3000) + 50000);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: un usuario sin conexion NO ve el espacio compartido", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const e = await llamar(puerto, "GET", "/api/anuncios/cuenta", { usuario: USUARIO });
    assert.equal(e.status, 200);
    assert.equal(e.datos.enUso, "ninguna");
    assert.equal(e.datos.conectada, false);
    assert.equal(e.datos.compartidaDisponible, false);

    // ni datos, ni productos, ni plan de otro: tiene que conectar su cuenta
    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(d.status, 409);
    const p = await llamar(puerto, "GET", "/api/anuncios/plan", { usuario: USUARIO });
    assert.equal(p.status, 409);
    assert.equal(fs.existsSync(path.join(m.dir, "usuarios", USUARIO, "config.json")), false);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: conectar con un token invalido devuelve 400", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const r = await llamar(puerto, "POST", "/api/anuncios/conectar", {
      cuerpo: { token: TOKEN_MALO },
      usuario: USUARIO,
    });
    assert.equal(r.status, 400);
    assert.match(String(r.datos.msg), /token|Meta/i);

    const e = await llamar(puerto, "GET", "/api/anuncios/cuenta", { usuario: USUARIO });
    assert.equal(e.datos.enUso, "ninguna"); // nada se guardo
    assert.equal(fs.existsSync(path.join(m.dir, "usuarios", USUARIO, "config.json")), false);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: el token valido guarda sus cuentas (aun sin elegir)", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const c = await llamar(puerto, "POST", "/api/anuncios/conectar", {
      cuerpo: { token: MI_TOKEN },
      usuario: USUARIO,
    });
    assert.equal(c.status, 200);
    assert.equal(c.datos.usuario.nombre, "Ana Panel");
    assert.deepEqual(c.datos.cuentas.map((x) => x.id), ["333", "444"]);
    assert.equal(c.datos.seleccionadas, 0);

    assert.equal(
      fs.existsSync(path.join(m.dir, "usuarios", USUARIO, "config.json")),
      true,
      "el token debe guardarse en su propia carpeta",
    );

    const e = await llamar(puerto, "GET", "/api/anuncios/cuenta", { usuario: USUARIO });
    assert.equal(e.datos.enUso, "propia");
    assert.equal(e.datos.conectada, true);
    assert.equal(e.datos.nombre, "Ana Panel");
    assert.equal(e.datos.cuentas.every((x) => !x.seleccionada), true);

    // sin cuentas elegidas todavia no hay nada que analizar
    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(d.status, 200);
    assert.equal(d.datos.totales.campanas, 0);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: cada quien analiza SUS cuentas con SU trm", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    const { c, s } = await conectarYSeleccionar(puerto);
    assert.equal(c.status, 200);
    assert.equal(s.status, 200);
    assert.equal(s.datos.trm, 4000);

    const mio = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(mio.status, 200);
    assert.deepEqual(
      mio.datos.campanas.map((x) => x.nombre).sort(),
      ["Campana Personal", "Campana USD"],
      "solo sus cuentas: nada de Pizdo/Orenar",
    );
    // 20000 COP + 100 USD x 4000
    assert.equal(mio.datos.totales.gasto, 20000 + 100 * 4000);

    // el compartido sigue intacto: mismas cuentas, otra trm
    const compartido = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    assert.equal(compartido.status, 200);
    assert.deepEqual(
      compartido.datos.campanas.map((x) => x.nombre).sort(),
      ["Otra Sin Producto", "Perfume Eclaire", "Taladro Pro"],
    );
    assert.equal(compartido.datos.totales.gasto, 15 * 3000 + 50000);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: las ganancias que guarda un usuario no se mezclan", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    await conectarYSeleccionar(puerto);

    const g = await llamar(puerto, "POST", "/api/anuncios/ganancia", {
      cuerpo: { nombre: "Taladro Pro", ganancia: 30000 },
    });
    assert.equal(g.status, 200);

    const mio = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(mio.datos.productos.length, 0, "el no tiene catalogo");
    assert.equal(
      fs.existsSync(path.join(m.dir, "usuarios", USUARIO, "productos.json")),
      false,
      "no debe heredar los productos del compartido",
    );

    const comp = await llamar(puerto, "GET", "/api/anuncios?dias=15");
    const taladro = comp.datos.productos.find((p) => p.nombre === "Taladro Pro");
    assert.equal(taladro.unidad, 30000);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: desconectar deja al usuario sin datos y borrar limpia su carpeta", async () => {
  const m = montar();
  const puerto = await m.abrir();
  try {
    await conectarYSeleccionar(puerto);
    const carpeta = path.join(m.dir, "usuarios", USUARIO);
    assert.equal(fs.existsSync(path.join(carpeta, "config.json")), true);

    const d1 = await llamar(puerto, "POST", "/api/anuncios/desconectar", {
      cuerpo: {},
      usuario: USUARIO,
    });
    assert.equal(d1.status, 200);
    const e1 = await llamar(puerto, "GET", "/api/anuncios/cuenta", { usuario: USUARIO });
    assert.equal(e1.datos.enUso, "ninguna");
    const comp = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(comp.status, 409, "no debe caer en los datos de otro");
    // su carpeta sigue ahi: productos/plan/caches son suyos
    assert.equal(fs.existsSync(carpeta), true);

    // reconecta y ahora si borra todo
    await conectarYSeleccionar(puerto);
    const d2 = await llamar(puerto, "POST", "/api/anuncios/desconectar", {
      cuerpo: { borrar: true },
      usuario: USUARIO,
    });
    assert.equal(d2.status, 200);
    assert.equal(fs.existsSync(carpeta), false);
  } finally {
    await m.cerrar();
  }
});

test("anuncios usuarios: con compartida:false, sin token no hay datos (409)", async () => {
  const m = montar({ compartida: false });
  const puerto = await m.abrir();
  try {
    const e = await llamar(puerto, "GET", "/api/anuncios/cuenta", { usuario: USUARIO });
    assert.equal(e.datos.enUso, "ninguna");
    assert.equal(e.datos.compartidaDisponible, false);

    const d = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(d.status, 409);

    const { c, s } = await conectarYSeleccionar(puerto);
    assert.equal(c.status, 200);
    assert.equal(s.status, 200);
    const d2 = await llamar(puerto, "GET", "/api/anuncios?dias=15", { usuario: USUARIO });
    assert.equal(d2.status, 200);
    assert.equal(d2.datos.totales.campanas, 2);
  } finally {
    await m.cerrar();
  }
});
