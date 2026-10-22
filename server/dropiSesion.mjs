// Inyecta el localStorage de Dropi (capturado del navegador del usuario con
// _capturar.mjs) dentro del perfil de automatizacion, para no tener que iniciar
// sesion a mano.
//
//   node dropiSesion.mjs
//
// Lee server/.dropi-localstorage.json y lo vuelca tal cual. Comprueba despues
// que la sesion queda viva.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearDropiNavegador } from "./dropiNavegador.js";
import { cargarConfig } from "./config.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = path.join(dir, ".dropi-localstorage.json");

if (!fs.existsSync(ORIGEN)) {
  console.error("No existe", ORIGEN);
  console.error("Capturalo primero con `node _capturar.mjs` y el navegador.");
  process.exit(1);
}

const datos = JSON.parse(fs.readFileSync(ORIGEN, "utf8"));
const claves = Object.keys(datos);
console.log("Inyectando sesion de Dropi:", claves.length, "claves");
console.log("  perfil:", cargarConfig().DROPI_PERFIL);

const config = cargarConfig();
const nav = crearDropiNavegador(config);

await nav.iniciar("https://app.dropi.co/dashboard/home");
const pagina = await nav.pagina();
if (!pagina) {
  console.error("No se pudo abrir el navegador.");
  process.exit(1);
}

await pagina.evaluate((d) => {
  for (const [k, v] of Object.entries(d)) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* sin espacio o clave invalida */
    }
  }
}, datos);

await pagina.reload({ waitUntil: "domcontentloaded" });

// doy tiempo a que Angular arranque
let renderizo = false;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const n = await pagina.evaluate(() => document.querySelectorAll("[data-cy]").length).catch(() => 0);
  if (n > 3) {
    renderizo = true;
    break;
  }
}

const url = pagina.url();
const enLogin = /\/auth\/(login|forgot)/i.test(url);

console.log("");
console.log("URL tras recargar:", url);
console.log("Renderizo:", renderizo ? "si" : "no");

if (enLogin) {
  console.log("");
  console.log("AVISO: Dropi devolvio al login. El token vencio o no sirve.");
  console.log("Vuelve a capturar la sesion desde tu navegador.");
  process.exitCode = 1;
} else {
  console.log("");
  console.log("Sesion inyectada. El agente ya puede operar.");
  console.log("(el token JWT dura ~12h: pasado ese tiempo hay que recapturarlo)");
}

await nav.cerrar();
process.exit(enLogin ? 1 : 0);
