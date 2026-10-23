// Punto de entrada del backend propio de ZuntoStore.
//   npm start        -> escucha en PORT (8787 por defecto)
//   npm run dev      -> igual, con recarga automatica (node --watch)
//   npm test         -> pruebas contra un LucidSales falso
import { cargarConfig, faltantesDeConfig } from "./config.js";
import { crearClienteLucid } from "./lucidsales.js";
import { crearClienteInter } from "./interrapidisimo.js";
import { crearHistorial } from "./historial.js";
import { crearConversaciones } from "./conversacion.js";
import { crearClienteDropi } from "./dropi.js";
import { crearDropiNavegador } from "./dropiNavegador.js";
import { crearSubidaAutomatica } from "./subidaAutomatica.js";
import { crearExtractorLLM } from "./llm.js";
import { crearAsignacion } from "./asignacion.js";
import { crearCredenciales } from "./credenciales.js";
import { crearConfigLLM } from "./llmConfig.js";
import { crearValidadorDireccion } from "./validadorDireccion.js";
import { crearRepartoAutomatico } from "./repartoAutomatico.js";
import { crearRegistroAnuncios } from "./anunciosTenant.js";
import { crearProductosDropi } from "./productosDropi.js";
import { crearLucidBotContactos } from "./lucidbotContactos.js";
import { crearServidor } from "./servidor.js";

const config = cargarConfig();
const cliente = crearClienteLucid(config);
const inter = crearClienteInter(config);
const historial = crearHistorial(config.HISTORIAL);
// chat de cada pedido: lo manda el bot y lo lee el agente de Dropi
const conversacion = crearConversaciones(config.CONVERSACION);
// credenciales que pueda haber guardado el panel (sino, las del .env)
const credenciales = crearCredenciales({ ruta: config.CREDENCIALES, config });
// clave/proveedor/modelo de la IA guardados desde el panel (sino, los del .env)
const llmConfig = crearConfigLLM({ ruta: config.LLM_CONFIG, config });
// validador de direcciones propio (formato + Google Maps)
const validadorDireccion = crearValidadorDireccion({ ruta: config.MAPAS_CONFIG, config });
const asignacion = crearAsignacion(config.ASIGNACION, {
  zona: config.TZ_ASIGNACION,
  // semilla de la configuracion del reparto (luego manda el panel/JSON)
  defecto: {
    automatico: config.REPARTO_AUTOMATICO,
    cadaSegundos: config.REPARTO_CADA,
    modo: "horario",
    tiendas: [],
    estados: [0],
  },
});
const reparto = crearRepartoAutomatico({ asignacion, cliente, config });
// Dropi: subida de pedidos con el seguro antidevoluciones
const dropi = crearClienteDropi(config);
// la via que funciona: navegador real con la sesion del usuario
const dropiNavegador = crearDropiNavegador(config);
// mapa producto -> link de Dropi, mantenido en un Google Sheets (CSV)
const productosDropi = crearProductosDropi({ url: config.DROPI_PRODUCTOS_CSV });
const lucidBotContactos = crearLucidBotContactos({ ruta: config.LUCIDBOT_CONTACTOS_CONFIG });
// resuelve el link navegable de Dropi de un producto de LucidSales:
//   id de LucidSales -> idProductoDropi -> dropiLink (del sheet)
const resolverProductoDropi = async (idProducto) => {
  const prod = await cliente.obtenerProducto(idProducto);
  const idDropi = prod?.idProductoDropi ? String(prod.idProductoDropi) : null;
  if (!idDropi) return null;
  const fila = await productosDropi.buscar(idDropi);
  return fila?.dropiLink || null;
};
// subida automatica: revisa pedidos nuevos y los sube solo si todo calza
const extraerLLM = crearExtractorLLM(config);
const subidaAuto = crearSubidaAutomatica({
  cliente,
  conversacion,
  extraer: extraerLLM,
  dropiNav: dropiNavegador,
  asignacion,
  config,
  lucidBotContactos,
  ruta: config.SUBIDA_AUTO,
  // ciudad/depto de LucidSales (ids) -> nombres para el formulario de Dropi
  resolverUbicacion: async ({ pais, idDepartamento, idCiudad }) => {
    const ub = await inter.nombresDeIds({ pais, idDepartamento, idCiudad });
    return { departamento: ub.departamento, ciudad: ub.municipio ?? "" };
  },
  // id de producto de LucidSales -> link navegable de Dropi
  resolverProductoDropi,
  // calificacion de la direccion en el mapa antes de subir
  validadorDireccion,
});
// rentabilidad de las campanas de Meta: UN espacio por usuario del panel
// (cada quien conecta su token, sus cuentas, sus productos y sus vinculos)
const anuncios = crearRegistroAnuncios({
  baseDir: config.ANUNCIOS_DIR,
  rutaCompartida: config.ANUNCIOS_CONFIG,
  // solo para integraciones sin sesion (x-api-key): los usuarios del panel
  // leen su catalogo y sus pedidos con SU propia sesion de LucidSales
  lucid: cliente,
});
const server = crearServidor({
  config,
  cliente,
  historial,
  inter,
  asignacion,
  reparto,
  credenciales,
  llmConfig,
  validadorDireccion,
  anuncios,
  conversacion,
  dropiCliente: dropi,
  dropiNavegador,
  subidaAuto,
  lucidBotContactos,
  resolverProductoDropi,
});

if (config.NODE_ENV === "production") {
  // API_KEY es opcional (solo integraciones); si esta, que sea fuerte
  if (config.API_KEY && config.API_KEY.length < 32) {
    throw new Error("En produccion, API_KEY (si se usa) debe tener al menos 32 caracteres aleatorios");
  }
  if (!config.CORS_ORIGIN || config.CORS_ORIGIN === "*") {
    throw new Error("En produccion, define CORS_ORIGIN con el origen HTTPS exacto del panel");
  }
}

server.listen(config.PORT, config.HOST, () => {
  const faltan = faltantesDeConfig(config);
  const c = asignacion.getConfig();
  console.log(`ZuntoStore API -> http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`);
  console.log(`  upstream: ${config.LUCID_BASE}`);
  console.log(`  oficinas: ${config.INTER_BASE}`);
  console.log(
    `  reparto automatico: ${c.automatico ? "ACTIVO" : "apagado"}` +
      ` (cada ${c.cadaSegundos}s, modo ${c.modo}, estados [${c.estados.join(",")}])`,
  );
  const s = subidaAuto.config();
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

// el intervalo arranca aunque este apagado: el propio tick lo consulta y no
// hace nada hasta que lo enciendan desde el panel
reparto.arrancar();
// idem con la subida automatica a Dropi
subidaAuto.arrancar();

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    reparto.detener();
    subidaAuto.detener();
    server.close(() => process.exit(0));
  });
}
