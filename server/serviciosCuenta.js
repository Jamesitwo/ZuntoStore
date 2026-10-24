// Los servicios de UNA cuenta: su cliente de LucidSales, su subida a Dropi
// (con su propio perfil de navegador), su reparto, su Lucid Bot, su sheet de
// productos, su IA, su validador de direcciones, sus historiales y su clave
// de API. Todos leen y escriben solo en los archivos de esa cuenta.
import { crearClienteLucid } from "./lucidsales.js";
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
import { crearEstadosEnvio } from "./estadosEnvio.js";
import { crearApiKeys } from "./apiKeys.js";
import { crearPedidosLucidBot } from "./pedidosLucidBot.js";
import { crearRegistroIntentos } from "./registroIntentos.js";
import { crearProductosDropi } from "./productosDropi.js";
import { crearLucidBotContactos } from "./lucidbotContactos.js";
import { cifrarArchivosEnClaro } from "./secretos.js";
import { crearAuditoria } from "./auditoria.js";

/**
 * Turno del navegador de Dropi, compartido por TODAS las cuentas: un solo
 * Chromium trabaja a la vez. Si la siguiente subida es de otra cuenta, se
 * cierra el navegador de la anterior (el perfil y la sesion quedan en disco).
 */
export function crearTurnoDropi({ log = console } = {}) {
  let cola = Promise.resolve();
  let ultimo = null; // { cuenta, nav }
  return function conTurno(cuenta, nav, trabajo) {
    const paso = cola.then(async () => {
      if (ultimo && ultimo.cuenta !== cuenta) {
        await ultimo.nav.cerrar?.().catch((e) => log.warn?.("[dropi] no se pudo cerrar el navegador:", e?.message ?? e));
      }
      ultimo = { cuenta, nav };
      return trabajo();
    });
    // la cola sigue aunque un trabajo falle
    cola = paso.catch(() => {});
    return paso;
  };
}

/**
 * config: la configuracion de la cuenta (configDeCuenta)
 * inter: cliente de Interrapidisimo (compartido: son datos publicos)
 * turnoDropi: crearTurnoDropi() compartido
 */
export function crearServiciosCuenta({ cuenta, config, inter, turnoDropi = null }) {
  // con CLAVE_MAESTRA, las claves que sigan en claro quedan cifradas
  const cifrados = cifrarArchivosEnClaro([config.CREDENCIALES, config.LLM_CONFIG, config.MAPAS_CONFIG, config.LUCIDBOT_CONTACTOS_CONFIG]);
  if (cifrados) console.log(`[cifrado] cuenta ${cuenta.id}: ${cifrados} archivo(s) con claves quedaron cifrados`);
  const cliente = crearClienteLucid(config);
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
  const dropi = crearClienteDropi(config);
  // navegador real con la sesion de Dropi de ESTA cuenta (su propio perfil)
  const navPropio = crearDropiNavegador(config);
  const dropiNavegador = turnoDropi
    ? {
        ...navPropio,
        subirPedido: (datos) => turnoDropi(cuenta.id, navPropio, () => navPropio.subirPedido(datos)),
      }
    : navPropio;
  // mapa producto -> link de Dropi, mantenido en un Google Sheets (CSV)
  const productosDropi = crearProductosDropi({ url: config.DROPI_PRODUCTOS_CSV, ruta: config.DROPI_PRODUCTOS_CONFIG });
  const lucidBotContactos = crearLucidBotContactos({ ruta: config.LUCIDBOT_CONTACTOS_CONFIG });
  // id de producto de LucidSales -> idProductoDropi -> dropiLink (del sheet).
  // Si falla, el error dice en QUE eslabon (para que el aviso sea accionable).
  const resolverProductoDropi = async (idProducto) => {
    const prod = await cliente.obtenerProducto(idProducto);
    const nombre = prod?.Nombre ?? prod?.nombre ?? `id ${idProducto}`;
    const idDropi = prod?.idProductoDropi ? String(prod.idProductoDropi).trim() : "";
    if (!idDropi || idDropi === "0") {
      throw new Error(`el producto «${nombre}» (id ${idProducto}) no tiene idProductoDropi en LucidSales: vincúlalo a Dropi en el catálogo`);
    }
    if (!productosDropi.listo) throw new Error("no está configurado el Google Sheets de productos (Ajustes → Subida a Dropi → Google Sheets de productos)");
    const filas = await productosDropi.cargar();
    if (!filas) throw new Error("no se pudo descargar el Google Sheets de productos (¿sigue compartido como CSV?)");
    const fila = filas.get(idDropi);
    if (!fila) throw new Error(`el idProductoDropi ${idDropi} de «${nombre}» no está en el Google Sheets (columna idProductoDropi)`);
    if (!fila.dropiLink) throw new Error(`en el Google Sheets la fila de ${idDropi} («${nombre}») no tiene dropiLink`);
    return fila.dropiLink;
  };
  const extraerLLM = crearExtractorLLM(config);
  // historial de intentos de subida por pedido (automaticos y manuales)
  const registroIntentos = crearRegistroIntentos({ ruta: config.INTENTOS });
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
    resolverProductoDropi,
    validadorDireccion,
    // oficinas de Inter del municipio: si la direccion del cliente es una,
    // el pedido va a esa oficina (por Coordinadora se devolveria)
    buscarOficinasInter: ({ ciudad, departamento }) => inter.oficinasCompletas({ municipio: ciudad, departamento }),
    intentos: registroIntentos,
  });
  // clave de la API de ESTA cuenta (la variable API_KEY solo vale para la 1)
  const apiKeys = crearApiKeys({ ruta: config.APIKEY_CONFIG, claveEnv: config.API_KEY });
  // cuando llega un pedido, su id se guarda en el contacto de Lucid Bot
  const pedidosLucidBot = crearPedidosLucidBot({
    cliente,
    lucidBot: lucidBotContactos,
    tiendas: () => subidaAuto.tiendasARevisar(),
    ruta: config.LUCIDBOT_PEDIDOS,
  });
  const estadosEnvio = crearEstadosEnvio({ ruta: config.ENVIOS });
  // quien cambio que en la configuracion de esta cuenta
  const auditoria = crearAuditoria({ ruta: config.AUDITORIA });

  return {
    cuenta,
    config,
    cliente,
    historial,
    conversacion,
    credenciales,
    llmConfig,
    validadorDireccion,
    asignacion,
    reparto,
    dropiCliente: dropi,
    dropiNavegador,
    productosDropi,
    lucidBotContactos,
    resolverProductoDropi,
    registroIntentos,
    subidaAuto,
    apiKeys,
    pedidosLucidBot,
    estadosEnvio,
    auditoria,
    /** Arranca los trabajos automaticos (cada uno mira si esta encendido). */
    arrancar() {
      reparto.arrancar();
      subidaAuto.arrancar();
      pedidosLucidBot.iniciar();
    },
    detener() {
      reparto.detener();
      subidaAuto.detener();
      pedidosLucidBot.detener();
    },
  };
}
