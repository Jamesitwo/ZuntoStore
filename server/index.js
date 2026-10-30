// Punto de entrada del backend propio de ZuntoStore.
//   npm start        -> escucha en PORT (8787 por defecto)
//   npm run dev      -> igual, con recarga automatica (node --watch)
//   npm test         -> pruebas contra un LucidSales falso
import fs from "node:fs";
import path from "node:path";
import { cifradoActivo, cifrarArchivosEnClaro, configurarClaveMaestra } from "./secretos.js";
import { cargarConfig, faltantesDeConfig } from "./config.js";
import { crearClienteInter } from "./interrapidisimo.js";
import { crearRegistroAnuncios } from "./anunciosTenant.js";
import { crearPanelEstatico } from "./panelEstatico.js";
import { crearCreadorCampanas } from "./creadorCampanas.js";
import { configDeCuenta, crearRegistroCuentas } from "./cuentas.js";
import { crearServiciosCuenta, crearTurnoDropi } from "./serviciosCuenta.js";
import { crearServidorCuentas } from "./servidorCuentas.js";

const config = cargarConfig();
config.CUENTA_ID = 1;
// las claves guardadas (LucidSales, IA, Maps, Lucid Bot, Meta) van cifradas
configurarClaveMaestra(config.CLAVE_MAESTRA);
if (!cifradoActivo() && config.NODE_ENV === "production") {
  console.warn("[cifrado] sin CLAVE_MAESTRA: las claves guardadas quedan en claro en el volumen");
}
{
  // el token de Meta de cada usuario (anuncios) tambien
  const ajustes = [config.ANUNCIOS_CONFIG];
  try {
    const dirUsuarios = path.join(config.ANUNCIOS_DIR, "usuarios");
    for (const u of fs.readdirSync(dirUsuarios)) ajustes.push(path.join(dirUsuarios, u, "config.json"));
  } catch {
    /* sin usuarios de anuncios */
  }
  const n = cifrarArchivosEnClaro(ajustes);
  if (n) console.log(`[cifrado] anuncios: ${n} ajuste(s) con token de Meta quedaron cifrados`);
}
// compartido por todas las cuentas: oficinas de Inter (datos publicos)
const inter = crearClienteInter(config);

// cuentas: ZuntoStore es la 1 (archivos de siempre); las demas, en su carpeta
const semillaTiendas = (() => {
  const t = [config.LUCID_TIENDA];
  try {
    const sub = JSON.parse(fs.readFileSync(config.SUBIDA_AUTO, "utf8"));
    t.push(...(sub?.tiendas ?? []), ...Object.keys(sub?.tiendasDropi ?? {}));
  } catch {
    /* sin config de subida */
  }
  try {
    const asig = JSON.parse(fs.readFileSync(config.ASIGNACION, "utf8"));
    t.push(...(asig?.config?.tiendas ?? asig?.tiendas ?? []));
  } catch {
    /* sin reparto */
  }
  return t.map(String).filter(Boolean);
})();
const registro = crearRegistroCuentas({ ruta: config.CUENTAS, semilla: semillaTiendas });
const turnoDropi = crearTurnoDropi();

// rentabilidad de las campanas de Meta: UN espacio por usuario del panel
// (cada quien conecta su token, sus cuentas, sus productos y sus vinculos)
const anuncios = crearRegistroAnuncios({
  baseDir: config.ANUNCIOS_DIR,
  rutaCompartida: config.ANUNCIOS_CONFIG,
  lucid: null,
});
// creador de campanas IA: TopView + Meta, por usuario (usa su token de Anuncios)
const creador = crearCreadorCampanas({
  baseDir: config.ANUNCIOS_DIR,
  credencialMeta: (usuario) => anuncios.credencial(usuario),
});
creador.arrancar();
// el panel (build de Vite) en el mismo servicio, si PANEL_DIR lo trae
const panel = crearPanelEstatico({
  dir: config.PANEL_DIR,
  lucidOrigen: new URL(config.LUCID_BASE).origin,
  // /privacidad y /eliminar-datos (las pide Meta para la app en modo publico)
  legales: { nombre: config.LEGAL_NOMBRE, email: config.LEGAL_EMAIL },
});
if (panel) console.log(`[panel] sirviendo el panel desde ${panel.dir}`);

const multi = crearServidorCuentas({
  config,
  registro,
  crearServicios: (cuenta) =>
    crearServiciosCuenta({ cuenta, config: configDeCuenta(config, cuenta), inter, turnoDropi }),
  comunes: { inter, anuncios, panel, creador },
});
const server = multi.server;
const principal = multi.de(registro.get(1)).servicios;

if (config.NODE_ENV === "production") {
  // API_KEY es opcional (solo integraciones); si esta, que sea fuerte
  if (config.API_KEY && config.API_KEY.length < 32) {
    throw new Error("En produccion, API_KEY (si se usa) debe tener al menos 32 caracteres aleatorios");
  }
  // con el panel en el mismo servicio no hace falta CORS (mismo dominio)
  if (!panel && (!config.CORS_ORIGIN || config.CORS_ORIGIN === "*")) {
    throw new Error("En produccion, define CORS_ORIGIN con el origen HTTPS exacto del panel");
  }
}

server.listen(config.PORT, config.HOST, () => {
  const faltan = faltantesDeConfig(config);
  const lista = registro.lista();
  console.log(`  cuentas: ${lista.map((x) => `${x.id} ${x.nombre} [${x.tiendas.join(",")}]${x.activa ? "" : " (inactiva)"}`).join(" · ")}`);
  const c = principal.asignacion.getConfig();
  console.log(`ZuntoStore API -> http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`);
  console.log(`  upstream: ${config.LUCID_BASE}`);
  console.log(`  oficinas: ${config.INTER_BASE}`);
  console.log(
    `  reparto automatico: ${c.automatico ? "ACTIVO" : "apagado"}` +
      ` (cada ${c.cadaSegundos}s, modo ${c.modo}, estados [${c.estados.join(",")}])`,
  );
  const s = principal.subidaAuto.config();
  console.log(
    `  subida a Dropi: ${s.automatico ? "ACTIVA" : "apagada"}` +
      ` (cada ${s.cadaSegundos}s, dryRun=${s.dryRun}, transportadora=${s.transportadoraId})`,
  );
  if (faltan.length) {
    console.warn(`  !! incompleto, falta: ${faltan.join(" | ")}`);
    console.warn("     (los cambios de estado devolveran 503 hasta configurarlo)");
  } else {
    console.log("  configuracion: completa");
  }
  const aj = anuncios.para(null).estado();
  console.log(
    `  anuncios meta: ${aj.conectada ? "compartida (token ok)" : "sin espacio compartido"}` +
      ` · ${aj.cuentas.map((c) => c.nombre).join(" + ") || "sin cuentas"}` +
      ` · trm ${aj.trm}` +
      (aj.compartidaDisponible ? "" : " · cada usuario debe conectar la suya"),
  );
});

// los trabajos automaticos de cada cuenta arrancan aunque esten apagados:
// cada tick consulta su config y no hace nada hasta que lo enciendan
multi.arrancar();

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    multi.detener();
    server.close(() => process.exit(0));
  });
}
