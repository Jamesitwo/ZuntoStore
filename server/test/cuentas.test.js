// Varias cuentas: cada una con sus datos; nadie ve los de otra.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cargarConfig } from "../config.js";
import { configDeCuenta, crearRegistroCuentas } from "../cuentas.js";
import { ErrorApi } from "../errores.js";
import { crearServiciosCuenta } from "../serviciosCuenta.js";
import { crearServidorCuentas } from "../servidorCuentas.js";
import { leerRol } from "../sesionPanel.js";

const USUARIOS = {
  james: { email: "james@zunto.co", rol: "all", tiendas: ["6881"] },
  amigo: { email: "amigo@tienda.co", rol: "all", tiendas: ["7000"] },
  vendedor: { email: "v@zunto.co", rol: "[2]", tiendas: ["6881"] },
  extrano: { email: "x@otra.co", rol: "all", tiendas: ["9999"] },
};

const verificarSesion = {
  async verificar(token, tienda) {
    const u = USUARIOS[token];
    if (!u) throw new ErrorApi(401, "token malo");
    const t = String(tienda || u.tiendas[0]);
    if (!u.tiendas.includes(t)) throw new ErrorApi(403, `LucidSales no autorizó la tienda ${t}`);
    return { usuario: { email: u.email }, rol: leerRol(u.rol), idEmpresa: u.tiendas, tienda: t };
  },
};

function armar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuentas-"));
  const base = cargarConfig({});
  // la cuenta 1 en su propia carpeta temporal (sin tocar los archivos reales)
  for (const k of ["HISTORIAL", "CONVERSACION", "SUBIDA_AUTO", "ASIGNACION", "CREDENCIALES", "ENVIOS", "INTENTOS", "LUCIDBOT_PEDIDOS", "LUCIDBOT_CONTACTOS_CONFIG", "LLM_CONFIG", "MAPAS_CONFIG", "DROPI_PRODUCTOS_CONFIG", "APIKEY_CONFIG", "DROPI_PERFIL", "AUDITORIA"]) {
    base[k] = path.join(dir, "c1", path.basename(base[k]));
  }
  Object.assign(base, { DATA_DIR: dir, CUENTAS: path.join(dir, "cuentas.json"), LUCID_EMAIL: "dueno@zunto.co", LUCID_PASSWORD: "x", LLM_API_KEY: "sk-de-james", API_KEY: "clave-env-de-james-1234567890123456" });
  const registro = crearRegistroCuentas({ ruta: base.CUENTAS, semilla: ["6881"] });
  const multi = crearServidorCuentas({
    config: base,
    registro,
    crearServicios: (cuenta) => crearServiciosCuenta({ cuenta, config: configDeCuenta(base, cuenta), inter: {} }),
    verificarSesion,
    log: { log() {}, warn() {}, error() {} },
  });
  return { multi, registro, dir, base };
}

async function pedir(multi, metodo, ruta, { token, tienda, clave, cuerpo } = {}) {
  await new Promise((r) => (multi.server.listening ? r() : multi.server.listen(0, "127.0.0.1", r)));
  const res = await fetch(`http://127.0.0.1:${multi.server.address().port}${ruta}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-token": token } : {}),
      ...(tienda ? { "x-tienda": tienda } : {}),
      ...(clave ? { "x-api-key": clave } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: res.status, datos: await res.json().catch(() => null) };
}

test("con una sola cuenta todo funciona como antes", async () => {
  const { multi } = armar();
  try {
    const r = await pedir(multi, "GET", "/api/subida", { token: "extrano", tienda: "9999" });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
  } finally {
    multi.server.close();
  }
});

test("dos cuentas: cada una ve y cambia SOLO lo suyo", async () => {
  const { multi, registro } = armar();
  try {
    // solo el admin de ZuntoStore crea cuentas
    let r = await pedir(multi, "POST", "/api/cuentas", { token: "vendedor", tienda: "6881", cuerpo: { nombre: "Amigo", tiendas: ["7000"] } });
    assert.equal(r.status, 403);
    r = await pedir(multi, "POST", "/api/cuentas", { token: "james", tienda: "6881", cuerpo: { nombre: "Amigo", tiendas: ["7000"] } });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.cuenta.id, 2);
    assert.deepEqual(registro.get(1).tiendas, ["6881"]);

    // la tienda 7000 no puede ser de dos cuentas
    r = await pedir(multi, "POST", "/api/cuentas", { token: "james", tienda: "6881", cuerpo: { nombre: "Otra", tiendas: ["7000"] } });
    assert.equal(r.status, 400);

    // el amigo cambia SU subida; la de ZuntoStore no se mueve
    r = await pedir(multi, "PUT", "/api/subida/config", { token: "amigo", tienda: "7000", cuerpo: { cadaSegundos: 600 } });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    const s1 = multi.de(registro.get(1)).servicios.subidaAuto.config();
    const s2 = multi.de(registro.get(2)).servicios.subidaAuto.config();
    assert.equal(s2.cadaSegundos, 600);
    assert.notEqual(s1.cadaSegundos, 600);

    // la cuenta nueva NO hereda los secretos de ZuntoStore
    const c2 = multi.de(registro.get(2)).servicios.config;
    assert.equal(c2.LUCID_EMAIL, "");
    assert.equal(c2.LLM_API_KEY, "");
    assert.equal(c2.API_KEY, "");
    assert.match(c2.SUBIDA_AUTO, /cuentas[\\/]2[\\/]subidaAutomatica\.json$/);

    // una tienda sin cuenta ya no entra
    r = await pedir(multi, "GET", "/api/subida", { token: "extrano", tienda: "9999" });
    assert.equal(r.status, 403);
    assert.match(r.datos.msg, /no tiene cuenta/);

    // el amigo no ve las cuentas
    r = await pedir(multi, "GET", "/api/cuentas", { token: "amigo", tienda: "7000" });
    assert.equal(r.status, 403);
    r = await pedir(multi, "GET", "/api/cuenta", { token: "amigo", tienda: "7000" });
    assert.equal(r.datos.cuenta.nombre, "Amigo");
  } finally {
    multi.server.close();
  }
});

test("la clave de API dice de que cuenta es el aviso de Lucid Bot", async () => {
  const { multi, registro } = armar();
  try {
    registro.crear({ nombre: "Amigo", tiendas: ["7000"] });
    const s2 = multi.de(registro.get(2)).servicios;
    const s1 = multi.de(registro.get(1)).servicios;
    const { clave } = s2.apiKeys.generar();
    let r = await pedir(multi, "POST", "/api/envios/estado", { clave, cuerpo: { estado: "EN REPARTO", telefono: "3001112222" } });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(s2.estadosEnvio.ultimos(5).length, 1);
    assert.equal(s1.estadosEnvio.ultimos(5).length, 0);
    // la del .env es de ZuntoStore
    r = await pedir(multi, "POST", "/api/envios/estado", { clave: "clave-env-de-james-1234567890123456", cuerpo: { estado: "ENTREGADO", telefono: "3001112222" } });
    assert.equal(r.status, 200);
    assert.equal(s1.estadosEnvio.ultimos(5).length, 1);
    // una clave que no es de nadie
    r = await pedir(multi, "POST", "/api/envios/estado", { clave: "inventada", cuerpo: { estado: "x", telefono: "3001112222" } });
    assert.equal(r.status, 401);
  } finally {
    multi.server.close();
  }
});

test("la lista de configuracion dice que le falta a una cuenta nueva", async () => {
  const { multi, registro } = armar();
  try {
    registro.crear({ nombre: "Amigo", tiendas: ["7000"] });
    const r = await pedir(multi, "GET", "/api/configuracion/estado", { token: "amigo", tienda: "7000" });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    const paso = (id) => r.datos.pasos.find((p) => p.id === id);
    assert.equal(paso("lucidsales").ok, false);
    assert.equal(paso("ia").ok, false);
    assert.equal(paso("tienda-dropi").ok, false);
    assert.match(paso("tienda-dropi").detalle, /7000/);
    assert.equal(r.datos.listos, 0);
    // la de ZuntoStore si tiene LucidSales e IA (las del .env)
    const r1 = await pedir(multi, "GET", "/api/configuracion/estado", { token: "james", tienda: "6881" });
    assert.equal(r1.datos.pasos.find((p) => p.id === "lucidsales").ok, true);
    assert.equal(r1.datos.pasos.find((p) => p.id === "ia").ok, true);
  } finally {
    multi.server.close();
  }
});

test("borrar una cuenta: solo desactivada, con su nombre, y se van sus datos", async () => {
  const { multi, registro, base } = armar();
  try {
    registro.crear({ nombre: "Amigo", tiendas: ["7000"] });
    // usar la cuenta crea su carpeta y sus archivos
    let r = await pedir(multi, "PUT", "/api/subida/config", { token: "amigo", tienda: "7000", cuerpo: { cadaSegundos: 600 } });
    assert.equal(r.status, 200);
    const carpeta = path.join(base.DATA_DIR, "cuentas", "2");
    assert.ok(fs.existsSync(path.join(carpeta, "subidaAutomatica.json")));
    // el cambio quedo en su registro de cambios, con quien lo hizo
    r = await pedir(multi, "GET", "/api/auditoria", { token: "amigo", tienda: "7000" });
    assert.equal(r.datos.cambios[0].usuario, "amigo@tienda.co");
    assert.match(r.datos.cambios[0].accion, /subida/);

    r = await pedir(multi, "DELETE", "/api/cuentas/2", { token: "james", tienda: "6881", cuerpo: { confirmar: "Amigo" } });
    assert.equal(r.status, 400); // sigue activa
    await pedir(multi, "PUT", "/api/cuentas/2", { token: "james", tienda: "6881", cuerpo: { activa: false } });
    r = await pedir(multi, "DELETE", "/api/cuentas/2", { token: "james", tienda: "6881", cuerpo: { confirmar: "otro" } });
    assert.equal(r.status, 400); // nombre mal
    r = await pedir(multi, "DELETE", "/api/cuentas/2", { token: "james", tienda: "6881", cuerpo: { confirmar: "Amigo" } });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(fs.existsSync(carpeta), false);
    assert.equal(registro.get(2), null);
    r = await pedir(multi, "DELETE", "/api/cuentas/1", { token: "james", tienda: "6881", cuerpo: { confirmar: "ZuntoStore" } });
    assert.equal(r.status, 400);
  } finally {
    multi.server.close();
  }
});
