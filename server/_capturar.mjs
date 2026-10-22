// Receptor local de una sola tirada: recibe el localStorage del navegador del
// usuario y lo guarda en disco, para pasarlo al perfil de automatizacion SIN
// que los tokens pase por la conversacion.
//
//   node _capturar.mjs
//
// Se cierra solo en cuanto recibe el POST.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(dir, ".dropi-localstorage.json");
const PUERTO = Number(process.argv[2] ?? 8791);

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  });
  if (req.method === "OPTIONS") return res.end("{}");

  const trozos = [];
  req.on("data", (c) => trozos.push(c));
  req.on("end", () => {
    try {
      const texto = Buffer.concat(trozos).toString("utf8");
      const datos = JSON.parse(texto || "{}");
      fs.writeFileSync(salida, JSON.stringify(datos, null, 2), "utf8");
      const claves = Object.keys(datos).length;
      res.end(JSON.stringify({ ok: true, claves }));
      console.log(`Recibido: ${claves} claves -> ${salida}`);
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
      console.log("Error:", e.message);
    }
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 300);
  });
});

server.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Escuchando en http://127.0.0.1:${PUERTO} (una sola tirada)`);
});
