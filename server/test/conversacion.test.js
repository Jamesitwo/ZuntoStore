// Pruebas del parser de transcripcion de WhatsApp del bot.
//   node --test   (o npm test dentro de server/)
import test from "node:test";
import assert from "node:assert/strict";
import { parsearTranscripcion, normalizarMensajes, normalizarMensaje } from "../conversacion.js";

const TRANSCRIPCION = `Usuario (2026-10-4 5:24am): ¡Hola! Quiero más información de cortador ceramica 3 en 1

Bot (2026-10-4 5:24am): Te muestro un video de como funciona

Bot (2026-10-4 5:25am): 👋 ¡Hola! Gracias por comunicarte 😊
Te presentamos el poderoso Cortador Manual Vidrio, Pisos y Cerámica PLUS
✅ Kit completo
¿Te gustaría conocer el precio? 👀

Usuario (2026-10-4 5:32am): Dos unidades

Bot (2026-10-4 5:33am): - 👤 *Nombre completo*
- 🏙️ *Ciudad*

Usuario (2026-10-4 5:35am): Pedro hinestroza bocanegra ciudad bahía Solano barrio el Carmen calle 2 carrera 3

Bot (2026-10-4 5:35am): ¡Gracias! 🙌

Usuario (2026-10-4 6:36am): Correcto los datos

Bot (2026-10-4 6:37am): ¡🎉 gracias por confirmar tu pedido!`;

test("parsearTranscripcion separa emisores y fechas", () => {
  const m = parsearTranscripcion(TRANSCRIPCION);
  assert.ok(m.length >= 9, `esperaba varios mensajes, obtuve ${m.length}`);
  assert.equal(m[0].de, "cliente");
  assert.equal(m[0].ts, "2026-10-4 5:24am");
  assert.equal(m[0].texto, "¡Hola! Quiero más información de cortador ceramica 3 en 1");
  assert.equal(m[1].de, "bot");
});

test("parsearTranscripcion une las lineas continuacion de un mensaje", () => {
  const m = parsearTranscripcion(TRANSCRIPCION);
  const botLargo = m.find((x) => x.de === "bot" && x.texto.includes("Cortador Manual"));
  assert.ok(botLargo, "deberia existir el mensaje largo del bot");
  assert.match(botLargo.texto, /Kit completo/);
  assert.match(botLargo.texto, /conocer el precio/);
});

test("parsearTranscripcion detecta la confirmacion del cliente", () => {
  const m = parsearTranscripcion(TRANSCRIPCION);
  const ok = m.find((x) => x.texto.includes("Correcto los datos"));
  assert.ok(ok, "deberia estar el 'Correcto los datos'");
  assert.equal(ok.de, "cliente");
});

test("parsearTranscripcion tolera texto vacio", () => {
  assert.deepEqual(parsearTranscripcion(""), []);
  assert.deepEqual(parsearTranscripcion(null), []);
  assert.deepEqual(parsearTranscripcion("esto no tiene formato de chat"), []);
});

test("normalizarMensajes descarta mensajes vacios y limita", () => {
  const crudos = [
    { de: "bot", texto: "hola" },
    { de: "cliente", texto: "   " }, // vacio -> fuera
    { de: "nadie", texto: "soy cliente" }, // emisor desconocido -> cliente
    "no es objeto", // fuera
  ];
  const m = normalizarMensajes(crudos);
  assert.equal(m.length, 2);
  assert.equal(m[1].de, "cliente");
});

test("normalizarMensaje acepta las claves alternativas text/mensaje", () => {
  const a = normalizarMensaje({ from: "BOT", mensaje: " hola ", fecha: "ayer" });
  assert.equal(a.de, "bot");
  assert.equal(a.texto, "hola");
  assert.equal(a.ts, "ayer");
});
