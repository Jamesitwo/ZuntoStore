// Abre el navegador de automatizacion con el perfil persistente para que
// inicies sesion en Dropi UNA sola vez. La sesion queda guardada en
// server/.dropi-perfil/ y de ahi en adelante la usa el agente solo.
//
//   node dropiLogin.mjs
//
// Se cierra solo cuando detecta que ya entraste (sales de /auth/login).
// Si Dropi pide captcha, lo resuelves TU: el agente no toca captchas.
import { crearDropiNavegador } from "./dropiNavegador.js";
import { cargarConfig } from "./config.js";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const config = cargarConfig();
const nav = crearDropiNavegador(config);

console.log("Abriendo Dropi en el navegador de automatizacion...");
console.log("  perfil:", config.DROPI_PERFIL);
console.log("  chrome :", config.DROPI_CHROME);
console.log("");
console.log(">> INICIA SESION ahi dentro. Este script se cierra solo cuando entres.");
console.log(">> Si te piden captcha, resuelvelo tu.");

await nav.iniciar("https://app.dropi.co/auth/login");

const limite = Date.now() + 5 * 60 * 1000; // 5 minutos
let entrado = false;
while (Date.now() < limite) {
  await esperar(2000);
  const url = nav.urlActual();
  if (url && !/\/auth\/login/i.test(url)) {
    entrado = true;
    console.log("");
    console.log("Sesion iniciada en:", url);
    break;
  }
}

if (!entrado) {
  console.log("");
  console.log("Tiempo agotado sin iniciar sesion. Vuelve a correr el script.");
} else {
  console.log("");
  console.log("Listo. La sesion queda en el perfil y el agente ya puede subir pedidos.");
  console.log("Puedes cerrar la ventana del navegador.");
}

await nav.cerrar();
process.exit(entrado ? 0 : 1);
