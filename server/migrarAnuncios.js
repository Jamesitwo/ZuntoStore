// Pasa el espacio COMPARTIDO de anuncios (el de antes, con su token, sus
// cuentas, productos, vinculos y plan) a la carpeta personal de UN usuario
// del panel, y deja el compartido sin token ni cuentas. Despues de esto
// nadie mas ve esos datos por defecto: cada usuario configura lo suyo.
//
//   node migrarAnuncios.js correo@del-usuario.com
//
// Hace copia del ajuste compartido (anuncios.json.bak) y no pisa nada que
// el usuario ya tenga en su carpeta.
import fs from "node:fs";
import path from "node:path";
import { cargarConfig } from "./config.js";
import { escribirJson, hoy, leerJson } from "./anunciosMeta.js";
import { slugDe } from "./anunciosTenant.js";

const usuario = process.argv[2];
const slug = slugDe(usuario);
if (!slug || !String(usuario).includes("@")) {
  console.error("Uso: node migrarAnuncios.js correo@del-usuario.com");
  process.exit(1);
}

const config = cargarConfig();
const base = config.ANUNCIOS_DIR;
const rutaCompartida = config.ANUNCIOS_CONFIG;
const destino = path.join(base, "usuarios", slug);
const rutaPersonal = path.join(destino, "config.json");

const comp = leerJson(rutaCompartida, null);
if (!comp) {
  console.error(`No existe el ajuste compartido (${rutaCompartida}): nada que migrar.`);
  process.exit(1);
}
if (fs.existsSync(rutaPersonal) && leerJson(rutaPersonal, {})?.token) {
  console.error(`${usuario} ya tiene su propia cuenta conectada: no se toca nada.`);
  process.exit(1);
}

fs.mkdirSync(destino, { recursive: true });
let copiados = 0;
for (const archivo of ["productos.json", "manual.json", "plan.json", "ganancias.json", "snapshot.json"]) {
  const origen = path.join(base, archivo);
  const final = path.join(destino, archivo);
  if (fs.existsSync(origen) && !fs.existsSync(final)) {
    fs.copyFileSync(origen, final);
    copiados++;
  }
}

const cuentas = (comp.cuentas ?? []).map((c) => ({
  id: String(c.id),
  nombre: c.nombre ?? String(c.id),
  moneda: c.moneda ?? "COP",
}));
const ganancias = comp.ganancias ? { ...comp.ganancias } : undefined;
if (ganancias) delete ganancias.tienda; // ahora manda la tienda activa del panel

escribirJson(rutaPersonal, {
  token: comp.token ?? "",
  version: comp.version || "v25.0",
  trm: Number(comp.trm) || 1,
  trmFecha: comp.trmFecha ?? null,
  usuario: slug,
  nombre: comp.nombreEspacio ?? null,
  conectado: hoy(),
  expira: null,
  cuentas,
  candidatas: cuentas.map((c) => ({ ...c, activa: true })),
  ...(ganancias ? { ganancias } : {}),
  ...(comp.entrega ? { entrega: comp.entrega } : {}),
  ...(comp.minDiasAlerta ? { minDiasAlerta: comp.minDiasAlerta } : {}),
});

// el compartido queda solo con los datos de la APP de Meta
fs.copyFileSync(rutaCompartida, `${rutaCompartida}.bak`);
const limpio = { ...comp, compartida: false };
for (const k of ["token", "cuentas", "ganancias", "nombreEspacio", "entrega"]) delete limpio[k];
escribirJson(rutaCompartida, limpio);

console.log(
  `Listo: ${copiados} archivo(s) y ${cuentas.length} cuenta(s) pasaron a la carpeta de ${usuario}. ` +
    `Copia del ajuste anterior en ${path.basename(rutaCompartida)}.bak`,
);
