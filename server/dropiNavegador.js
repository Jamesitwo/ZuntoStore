// Automatizacion de Dropi por el NAVEGADOR, con la sesion real del usuario.
//
// Por que navegador y no API: la API de Dropi rechaza clientes que no sean su
// propio frontend (401/403 desde cualquier IP), asi que el camino es ejecutar
// en un navegador real los mismos pasos que hace el usuario a mano.
//
// FLUJO (verificado en la app real):
//   1. ficha del producto
//   2. [data-cy=open-calculator]          -> abre la calculadora de flete
//   3. #shippingType-1                    -> "Con recaudo"
//   4. #state / #city  (p-dropdown)       -> departamento y ciudad de destino
//   5. espera la cotizacion
//   6. div.carrier (texto "Coordinadora") -> elige transportadora
//      (SOLO Coordinadora ofrece el seguro antidevoluciones)
//   7. [data-cy=send-button]              -> "Enviar al cliente" -> abre Crear Orden
//   8. rellena el cliente
//   9. [data-cy=order-create-carrier-insurance-field]  -> EL SEGURO
//      etiqueta "Pedido asegurado, en caso de devolucion $ 1.200"
//      confirma en [data-cy=order-create-summary-insured]
//  10. [data-cy=order-create-footer-create-field]      -> crear el pedido
//
// LIMITE: si aparece un captcha el flujo SE DETIENE y devuelve
// { requiereCaptcha: true }. No se resuelve, no se evade, no se falsea la
// huella del dispositivo: eso lo tiene que hacer una persona.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ErrorApi } from "./errores.js";
import { claveCliente, oficinaQueCoincide } from "./oficinasInter.js";

const DEFECTO_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** Seguro ANTIDEVOLUCIONES: esta en el dialogo "Crear Orden". */
const SELECTOR_SEGURO = '[data-cy="order-create-carrier-insurance-field"]';
const SELECTOR_SEGURO_HOST = '[data-cy="order-create-carrier-insurance"]';
const SELECTOR_CONFIRMA_SEGURO = '[data-cy="order-create-summary-insured"]';

/** Texto con el que se identifica la transportadora en la calculadora. */
const NOMBRES_CARRIER = {
  2: "Envia",
  3: "Interrapidisimo",
  4: "Domina",
  5: "Coordinadora",
  6: "Veloces",
  7: "99minutos",
  10: "Tcc",
  13: "Jamv-drive",
  14: "Derocha-express",
  17: "Wiilog",
};

/** Nombre legible de una transportadora de Dropi. */
export function nombreTransportadora(id) {
  return NOMBRES_CARRIER[Number(id)] ?? `transportadora ${id}`;
}

/**
 * Valor del envio que muestra la tarjeta de una transportadora
 * ("Coordinadora\n$ 18.500\n2-3 dias" -> 18500). null si no hay precio.
 */
export function precioDeTarjeta(texto) {
  // solo el numero pegado al $ (en la misma linea: "18.500", "18,500", "18.500,00")
  // Dropi separa con espacio duro: "$&nbsp;27.870" (\u00a0 / \u202f)
  const m = /\$[ \t\u00a0\u202f]*(\d[\d.,]*)/.exec(String(texto ?? ""));
  if (!m) return null;
  // "18.500,00" -> sin decimales; los separadores de miles se quitan
  const crudo = m[1].replace(/[.,]$/, "").replace(/,\d{1,2}$/, "");
  const n = Number(crudo.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Un monto en pesos del resumen de Dropi, con signo y cero ("-$ 1.200", "$ 0"). */
export function montoDeTexto(texto) {
  const t = String(texto ?? "");
  const negativo = /-\s*\$|\$[ \t\u00a0\u202f]*-/.test(t);
  const limpio = t.replace(/-/g, "");
  if (/\$[ \t\u00a0\u202f]*0(?![\d.,]*[1-9])/.test(limpio)) return 0;
  const n = precioDeTarjeta(limpio);
  return n === null ? null : negativo ? -n : n;
}

const pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

/**
 * Texto de la direccion para un pedido que recoge en oficina de Inter: Dropi
 * solo muestra el selector de oficinas si la direccion lo dice.
 */
const normalizarUbicacion = (t) =>
  String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Nombres con los que Dropi (u otras fuentes) llaman al mismo departamento o
 * ciudad. Cada grupo son equivalentes; el primero de la lista es el que mas
 * usa Dropi y se prueba a escribir si el nombre completo no aparece.
 */
const EQUIVALENTES_UBICACION = [
  ["valle", "valle del cauca"],
  ["guajira", "la guajira"],
  ["san andres", "san andres y providencia", "archipielago de san andres", "san andres providencia y santa catalina", "archipielago de san andres providencia y santa catalina"],
  ["norte de santander", "n santander", "nte de santander"],
  ["bogota", "bogota d c", "bogota dc", "distrito capital", "bogota distrito capital", "santafe de bogota", "cundinamarca bogota"],
  ["cartagena", "cartagena de indias"],
  ["cucuta", "san jose de cucuta"],
  ["santa fe de antioquia", "santafe de antioquia"],
  ["el carmen de viboral", "carmen de viboral"],
  ["san andres de tumaco", "tumaco"],
  ["guadalajara de buga", "buga"],
  ["inirida", "puerto inirida"],
];

/** Todas las formas aceptadas para un nombre (normalizadas), la propia primero. */
export function variantesUbicacion(texto) {
  const n = normalizarUbicacion(texto);
  const grupo = EQUIVALENTES_UBICACION.find((g) => g.includes(n));
  return [...new Set([n, ...(grupo ?? [])])].filter(Boolean);
}

/** Iniciales de un nombre sin "de/del/la/y": "valle del cauca" -> "vc". */
const iniciales = (n) =>
  n
    .split(" ")
    .filter((w) => w && !["de", "del", "la", "las", "los", "y"].includes(w))
    .map((w) => w[0])
    .join("");

/**
 * ¿La opcion de Dropi es este lugar? Igual a alguna forma aceptada, o con la
 * marca del departamento que Dropi pone a las ciudades repetidas:
 * "Armenia (Q)" = Armenia del Quindio (no la de Antioquia).
 */
export function coincideUbicacion(opcion, aceptadas, departamento = "") {
  if (aceptadas.includes(normalizarUbicacion(opcion))) return true;
  const m = String(opcion ?? "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m || !aceptadas.includes(normalizarUbicacion(m[1]))) return false;
  const codigo = normalizarUbicacion(m[2]).replace(/ /g, "");
  if (!codigo || !departamento) return false;
  return variantesUbicacion(departamento).some(
    (d) => d.replace(/ /g, "").startsWith(codigo) || iniciales(d) === codigo,
  );
}

/** Direccion que se escribe en Dropi cuando la oficina la detecto el sistema. */
export const DIRECCION_OFICINA_INTER = "Oficina Interrapidisimo";

export function direccionOficinaInter(direccion) {
  const t = String(direccion ?? "").trim();
  const n = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/oficina/.test(n) && /inter ?rapidisimo/.test(n)) return t;
  return `Oficina Interrapidisimo${t ? ` - ${t}` : ""}`;
}

/**
 * Lo que se ve en la lista de transportadoras (para ajustar el selector si
 * Dropi cambia su formulario): data-cy, texto y si parece marcada.
 */
async function diagnosticoTransportadoras(p) {
  const d = await p
    .evaluate(() => {
      const ops = [...document.querySelectorAll('[data-cy^="order-create-carrier-option-"]')].map((el) => {
        const radio = el.querySelector('input[type="radio"]');
        return {
          cy: el.getAttribute("data-cy"),
          texto: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
          radio: radio ? radio.checked : null,
          clases: (typeof el.className === "string" ? el.className : "").slice(0, 60),
          radioClases: el.querySelector(".radio")?.className ?? null,
        };
      });
      const ciudad = document.querySelector('[data-cy="client-city"] input')?.value ?? "";
      const pideCiudad = Boolean(document.querySelector('[data-cy="order-create-carrier-city-required"]'));
      const otros = [...document.querySelectorAll("[data-cy]")]
        .map((e) => e.getAttribute("data-cy"))
        .filter((c) => /carrier|transport|insur|segur/i.test(c) && !/carrier-option-/.test(c));
      return { ciudad, pideCiudad, opciones: ops.slice(0, 12), otros: [...new Set(otros)].slice(0, 12) };
    })
    .catch(() => null);
  return d ? `Formulario: ${JSON.stringify(d)}`.slice(0, 1500) : "";
}

const CANDADOS = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

/**
 * Chromium deja un candado en el perfil ("SingletonLock" -> "maquina-pid").
 * Si el servidor se reinicia (cada despliegue en Railway es otra maquina), el
 * candado viejo queda en el volumen y el perfil "parece en uso por otro
 * equipo". Solo se quita cuando ese proceso ya no existe: otra maquina o un
 * pid muerto en esta.
 */
export function liberarPerfil(perfil, { host = os.hostname(), vivo = pidVivo } = {}) {
  let destino;
  try {
    destino = fs.readlinkSync(path.join(perfil, "SingletonLock"));
  } catch {
    try {
      // en algunos sistemas es un archivo normal, no un enlace
      destino = fs.readFileSync(path.join(perfil, "SingletonLock"), "utf8");
    } catch {
      return false; // no hay candado
    }
  }
  const m = String(destino).trim().match(/^(.*)-(\d+)$/);
  const ajeno = !m || m[1] !== host || !vivo(Number(m[2]));
  if (!ajeno) return false;
  for (const n of CANDADOS) {
    try {
      fs.rmSync(path.join(perfil, n), { force: true });
    } catch {
      /* sin permiso: Chromium avisara */
    }
  }
  return true;
}

function pidVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

export function crearDropiNavegador(config = {}) {
  const perfil = String(config.DROPI_PERFIL ?? "");
  const chrome = String(config.DROPI_CHROME ?? DEFECTO_CHROME);
  const lento = Number(config.DROPI_NAVEGADOR_MS ?? 30000) || 30000;
  // DROPI_HEADLESS llega ya como booleano desde config.js
  const headless = config.DROPI_HEADLESS === true;

  let navegador = null;
  let pagina = null;
  let subidaEnCurso = false;

  async function asegurar() {
    if (pagina && !pagina.isClosed()) return pagina;
    if (!perfil) {
      throw new ErrorApi(503, "DROPI_PERFIL no esta configurado (carpeta del perfil del navegador)");
    }
    const { chromium } = await import("playwright-core");
    const opciones = {
      headless,
      executablePath: chrome,
      viewport: { width: 1440, height: 950 },
      locale: "es-CO",
      timezoneId: "America/Bogota",
      args: ["--disable-blink-features=AutomationControlled"],
    };
    if (liberarPerfil(perfil)) console.log("[dropi] se quitó el candado viejo del perfil del navegador (reinicio o despliegue)");
    navegador = await chromium.launchPersistentContext(perfil, opciones);
    pagina = navegador.pages()[0] ?? (await navegador.newPage());
    // Sin pantalla (Railway) Chromium se presenta como "HeadlessChrome" y
    // Dropi puede negarse a mostrar productos: se relanza como Chrome normal
    // (misma version y sistema).
    if (headless) {
      const ua = await pagina.evaluate(() => navigator.userAgent).catch(() => "");
      if (/HeadlessChrome/i.test(ua)) {
        // solo se quita "Headless": el resto (Linux) coincide con la maquina
        const normal = ua.replace(/HeadlessChrome/g, "Chrome");
        await navegador.close().catch(() => {});
        navegador = await chromium.launchPersistentContext(perfil, { ...opciones, userAgent: normal });
        pagina = navegador.pages()[0] ?? (await navegador.newPage());
      }
    }
    pagina.setDefaultTimeout(lento);
    return pagina;
  }

  /** ¿Hay un captcha en pantalla? Se mira, no se toca. */
  async function hayCaptcha(p) {
    try {
      return await p.evaluate(() => {
        const t = document.body ? document.body.innerText.toLowerCase() : "";
        const hayWidget = !!document.querySelector(
          'iframe[src*="turnstile"], iframe[src*="captcha"], .cf-turnstile, [class*="captcha"]',
        );
        return hayWidget || /verify you are human|solving|captcha/i.test(t);
      });
    } catch {
      return false;
    }
  }

  /** ¿Dropi nos mando al login? (sesion vencida o nunca hubo) */
  async function enLogin(p) {
    return /\/auth\/(login|forgot)/i.test(p.url());
  }

  /**
   * Espera la ficha del producto: el boton "Enviar al cliente", o lo que
   * aparezca en su lugar. Dropi es una SPA: el salto al login (sesion vencida)
   * o un captcha pueden llegar segundos DESPUES de cargar la pagina.
   * -> { ok } | { login } | { captcha } | { motivo, url, titulo, texto }
   */
  async function esperarFicha(p, timeoutMs) {
    const boton = p.locator('[data-cy="send-to-client-button"]');
    const fin = Date.now() + timeoutMs;
    while (Date.now() < fin) {
      if (await boton.isVisible().catch(() => false)) return { ok: true };
      if (await enLogin(p)) return { login: true };
      if (await hayCaptcha(p)) return { captcha: true };
      await p.waitForTimeout(500);
    }
    const url = p.url();
    const titulo = await p.title().catch(() => "");
    const texto = await p
      .evaluate(() => (document.body ? document.body.innerText : ""))
      .catch(() => "");
    const plano = String(texto).replace(/\s+/g, " ").trim();
    let motivo = "el botón «Enviar al cliente» no apareció";
    // primero DONDE quedo: si Dropi redirigio, el texto es de otra pagina
    if (!/product-details/i.test(url)) motivo = "Dropi no abrió la ficha del producto y redirigió a otra página";
    else if (/agotad|sin stock|no disponible|sin existencias/i.test(plano)) motivo = "el producto aparece agotado o no disponible en Dropi";
    else if (/no (existe|encontr)|not found|404/i.test(plano)) motivo = "Dropi dice que el producto no existe (revisa el dropiLink del sheet)";
    else if (plano.length < 40) motivo = "la ficha de Dropi no terminó de cargar (página en blanco)";
    return { motivo, url, titulo, texto: plano.slice(0, 200) };
  }

  /**
   * Resumen del formulario Crear Orden con todo elegido: "Ganancias" y
   * "Precio de envío" (data-cy order-create-summary-*). null si no estan.
   */
  async function leerResumenDropi(p) {
    const leer = async (cy) => {
      const el = p.locator(`[data-cy="${cy}"]`).first();
      if (!(await el.count().catch(() => 0))) return null;
      return montoDeTexto(await el.innerText({ timeout: 2000 }).catch(() => ""));
    };
    const ganancia = await leer("order-create-summary-earnings");
    const envio = await leer("order-create-summary-shipping");
    return ganancia === null && envio === null ? null : { ganancia, envio };
  }

  /** Elige una opcion de un p-dropdown de PrimeNG con filtro (depto / ciudad). */
  async function dropdown(p, idSel, texto) {
    // #state existe como <p-dropdown> y como <div.p-dropdown> interno:
    // se apunta al host por etiqueta para no violar strict mode
    const host = p.locator(`p-dropdown${idSel}`);
    if (!(await host.count())) return { ok: false, paso: "sin dropdown" };

    const disparador = host.locator(".p-dropdown").first();
    if (await disparador.count()) await disparador.click();
    else await host.click();
    await p.waitForTimeout(700);

    // dropdown con filtro: se escribe para acortar la lista
    const filtro = p.locator(".p-dropdown-panel input, .p-dropdown-filter").first();
    if (await filtro.count()) {
      await filtro.fill("");
      await filtro.type(String(texto ?? ""), { delay: 40 });
      await p.waitForTimeout(700);
    }

    const op = p
      .locator(".p-dropdown-item, li[role='option'], .p-autocomplete-item")
      .filter({ hasText: String(texto ?? "").slice(0, 12) })
      .first();
    if (!(await op.count())) {
      const visibles = await p
        .locator(".p-dropdown-item, li[role='option']")
        .allInnerTexts()
        .catch(() => []);
      return { ok: false, paso: "sin opcion", visibles: visibles.slice(0, 8) };
    }
    const elegido = (await op.innerText().catch(() => "")).trim();
    await op.click();
    return { ok: true, elegido };
  }

  /**
   * Rellena un p-autocomplete de PrimeNG (los campos de departamento/ciudad del
   * formulario "Crear Orden"): escribe el texto, espera las opciones y elige la
   * primera. Devuelve {ok, elegido} sin lanzar (si falla, el boton crear
   * quedara deshabilitado y eso ya se avisa mas abajo).
   */
  async function autocompletar(p, cy, texto, { departamento = "" } = {}) {
    // se prueba con el nombre tal cual y luego con sus equivalentes ("Valle
    // del Cauca" -> "Valle"): Dropi acorta algunos nombres
    const aceptadas = variantesUbicacion(texto);
    let ultimo = null;
    for (const escrito of [String(texto ?? ""), ...aceptadas.slice(1)]) {
      const r = await autocompletarUna(p, cy, escrito, aceptadas, departamento);
      if (r.ok || r.paso === "sin campo") return { ...r, solicitado: String(texto ?? "") };
      ultimo = r;
    }
    return { ...ultimo, solicitado: String(texto ?? "") };
  }

  async function autocompletarUna(p, cy, texto, aceptadas, departamento = "") {
    const caja = p.locator(`[data-cy="${cy}"] input`).first();
    if (!(await caja.count().catch(() => 0))) {
      return { ok: false, paso: "sin campo", campo: cy };
    }
    await caja.click();
    await caja.fill("");
    await caja.type(String(texto ?? ""), { delay: 40 });

    // esperar a que aparezcan las opciones (hasta ~3s, es async)
    const opciones = p.locator(".p-autocomplete-panel li, li[role='option'], .p-autocomplete-item");
    let hay = false;
    for (let i = 0; i < 6; i++) {
      if (await opciones.first().count().catch(() => 0)) {
        hay = true;
        break;
      }
      await p.waitForTimeout(500);
    }
    if (!hay) return { ok: false, paso: "sin opcion", campo: cy, solicitado: String(texto ?? "") };

    const candidatas = await opciones.all().catch(() => []);
    let opcionExacta = null;
    let elegido = "";
    for (const opcion of candidatas) {
      const textoOpcion = (await opcion.innerText().catch(() => "")).trim();
      if (coincideUbicacion(textoOpcion, aceptadas, departamento)) {
        opcionExacta = opcion;
        elegido = textoOpcion;
        break;
      }
    }
    if (!opcionExacta) {
      return {
        ok: false,
        paso: "sin coincidencia exacta",
        campo: cy,
        solicitado: String(texto ?? ""),
        opciones: (await opciones.allInnerTexts().catch(() => [])).slice(0, 8),
      };
    }
    await opcionExacta.click();
    await p.waitForTimeout(500);
    return { ok: true, elegido };
  }

  const normalizarTexto = (t) =>
    String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /**
   * Elige la tienda en el selector "Tienda" del formulario Crear Orden.
   * No se conoce un data-cy fijo para ese campo, asi que se busca:
   *   1) un <select> nativo que tenga una opcion con ese nombre exacto
   *   2) un p-dropdown con data-cy de shop/store/tienda, o cuyo texto sea "Tienda"
   * Solo se da por buena si al final el campo MUESTRA la tienda pedida.
   */
  async function seleccionarTienda(p, nombre) {
    const objetivo = normalizarTexto(nombre);
    const dlg = p.locator('[data-cy="create-order"]').first();
    const raiz = (await dlg.count().catch(() => 0)) ? dlg : p;

    // 0) el selector real de Dropi: <dropi-select data-cy="order-create-client-store">
    //    con un boton (…-store-field) que muestra el valor en `.elipsis`.
    //    OJO: el pais del telefono tambien es un dropi-select; por eso se
    //    apunta al data-cy exacto de la tienda.
    const hostTienda = p.locator('dropi-select[data-cy="order-create-client-store"]').first();
    const botonTienda = p.locator('[data-cy="order-create-client-store-field"]').first();
    if (await botonTienda.count().catch(() => 0)) {
      const textoBoton = async () => (await botonTienda.locator(".elipsis").first().innerText().catch(() => "")).trim();
      const verificar = async () => normalizarTexto(await textoBoton()) === objetivo;
      // ya estaba elegida (p. ej. Dropi recuerda la ultima)
      if (await verificar()) return { ok: true, elegido: await textoBoton(), verificar };

      await botonTienda.click();
      await p.waitForTimeout(600);

      // si la lista trae buscador, se escribe para acortarla
      const buscador = hostTienda.locator('input:not([type="checkbox"]):not([type="radio"])').first();
      if ((await buscador.count().catch(() => 0)) && (await buscador.isVisible().catch(() => false))) {
        await buscador.fill("").catch(() => {});
        await buscador.type(String(nombre), { delay: 40 }).catch(() => {});
        await p.waitForTimeout(600);
      }

      // Se marca la opcion visible cuyo texto sea EXACTAMENTE la tienda (la
      // mas interna, fuera del boton). Se busca dentro del dropi-select y, si
      // la lista se pinta fuera (overlay), en toda la pagina.
      const marca = await p.evaluate(
        ({ objetivo }) => {
          const norm = (t) =>
            String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const host = document.querySelector('dropi-select[data-cy="order-create-client-store"]');
          const boton = document.querySelector('[data-cy="order-create-client-store-field"]');
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
          };
          const buscar = (raiz) => {
            const todos = [...raiz.querySelectorAll("*")].filter(
              (el) => !(boton && boton.contains(el)) && el !== boton && visible(el),
            );
            const iguales = todos.filter((el) => norm(el.innerText) === objetivo);
            // la mas interna: ninguna de sus hijas tambien coincide
            return iguales.filter((el) => !iguales.some((o) => o !== el && el.contains(o)));
          };
          let encontradas = host ? buscar(host) : [];
          if (!encontradas.length) encontradas = buscar(document.body);
          document.querySelectorAll("[data-zs-opcion]").forEach((e) => e.removeAttribute("data-zs-opcion"));
          if (encontradas.length) {
            encontradas[0].setAttribute("data-zs-opcion", "1");
            return { ok: true };
          }
          // diagnostico: textos cortos visibles de la lista abierta
          const textos = host
            ? [...host.querySelectorAll("li, [role='option'], button, div, span")]
                .filter((el) => !(boton && boton.contains(el)) && el !== boton && visible(el) && el.children.length === 0)
                .map((el) => el.innerText.trim())
                .filter((t) => t && t.length < 80)
            : [];
          return { ok: false, opciones: [...new Set(textos)].slice(0, 15) };
        },
        { objetivo },
      ).catch((e) => ({ ok: false, error: e?.message ?? String(e) }));

      if (!marca.ok) {
        await p.keyboard.press("Escape").catch(() => {});
        return { ok: false, paso: "sin coincidencia exacta", opciones: marca.opciones ?? [] };
      }
      const opcion = p.locator('[data-zs-opcion="1"]').first();
      await opcion.click({ timeout: 5000 }).catch(() => {});
      // la lista se cierra al elegir: se limpia la marca sin esperar al nodo
      await p.evaluate(() => document.querySelectorAll("[data-zs-opcion]").forEach((e) => e.removeAttribute("data-zs-opcion"))).catch(() => {});
      await p.waitForTimeout(500);
      if (await verificar()) return { ok: true, elegido: await textoBoton(), verificar };
      return { ok: false, paso: `no quedó seleccionada (el campo muestra "${await textoBoton()}")` };
    }

    // 1) select nativo
    const selects = await raiz.locator("select").all().catch(() => []);
    for (const sel of selects) {
      const opciones = await sel.locator("option").allInnerTexts().catch(() => []);
      const exacta = opciones.find((o) => normalizarTexto(o) === objetivo);
      if (!exacta) continue;
      await sel.selectOption({ label: exacta.trim() }).catch(() => {});
      const actual = await sel.evaluate((el) => el.options[el.selectedIndex]?.text ?? "").catch(() => "");
      if (normalizarTexto(actual) === objetivo) {
        return { ok: true, elegido: actual.trim(), verificar: async () => normalizarTexto(await sel.evaluate((el) => el.options[el.selectedIndex]?.text ?? "").catch(() => "")) === objetivo };
      }
    }

    // 2) p-dropdown de PrimeNG
    let host = raiz
      .locator('p-dropdown[data-cy*="shop" i], p-dropdown[data-cy*="store" i], p-dropdown[data-cy*="tienda" i], [data-cy*="shop" i] p-dropdown, [data-cy*="store" i] p-dropdown, [data-cy*="tienda" i] p-dropdown')
      .first();
    if (!(await host.count().catch(() => 0))) {
      host = raiz
        .locator("p-dropdown")
        .filter({ has: p.locator(".p-dropdown-label", { hasText: /^\s*tienda\s*$/i }) })
        .first();
    }
    if (await host.count().catch(() => 0)) {
      const disparador = host.locator(".p-dropdown").first();
      if (await disparador.count().catch(() => 0)) await disparador.click().catch(() => {});
      else await host.click().catch(() => {});
      await p.waitForTimeout(700);
      const filtro = p.locator(".p-dropdown-panel input, .p-dropdown-filter").first();
      if (await filtro.count().catch(() => 0)) {
        await filtro.fill("").catch(() => {});
        await filtro.type(String(nombre), { delay: 40 }).catch(() => {});
        await p.waitForTimeout(700);
      }
      const opciones = await p.locator(".p-dropdown-panel .p-dropdown-item, .p-dropdown-panel li[role='option']").all().catch(() => []);
      let elegida = null;
      for (const op of opciones) {
        if (normalizarTexto(await op.innerText().catch(() => "")) === objetivo) {
          elegida = op;
          break;
        }
      }
      if (!elegida) {
        const visibles = await p.locator(".p-dropdown-panel .p-dropdown-item, .p-dropdown-panel li[role='option']").allInnerTexts().catch(() => []);
        await p.keyboard.press("Escape").catch(() => {});
        return { ok: false, paso: "sin coincidencia exacta", opciones: visibles.slice(0, 10) };
      }
      await elegida.click();
      await p.waitForTimeout(500);
      const etiqueta = host.locator(".p-dropdown-label").first();
      const verificar = async () => normalizarTexto(await etiqueta.innerText().catch(() => "")) === objetivo;
      if (await verificar()) return { ok: true, elegido: (await etiqueta.innerText().catch(() => "")).trim(), verificar };
      return { ok: false, paso: "no quedo seleccionada" };
    }

    // 3) no se encontro el campo: diagnostico para ajustar el selector
    const diagnostico = await raiz
      .evaluate((el) => {
        const cys = [...el.querySelectorAll("[data-cy]")].map((e) => e.getAttribute("data-cy"));
        return {
          controles: cys.filter((c) => /shop|store|tienda/i.test(c)),
          selects: el.querySelectorAll("select").length,
          dropdowns: el.querySelectorAll("p-dropdown").length,
        };
      })
      .catch(() => ({}));
    return { ok: false, paso: "sin campo", diagnostico };
  }

  /**
   * Elige la transportadora en Crear Orden (tarjetas div.card-logistic con
   * data-cy="order-create-carrier-option-<id>"). Espera a que Dropi cotice
   * (la tarjeta pierde "disabled" y muestra precio) y confirma que quedo
   * marcada. Devuelve {ok} o {ok:false, detalle} con un diagnostico.
   */
  async function seleccionarTransportadora(p, idCarrier, ciudad = "") {
    const nombreCarrier = NOMBRES_CARRIER[idCarrier] ?? "la transportadora";
    // la opcion por su data-cy; si Dropi cambio el id, por el NOMBRE visible
    let car = p.locator(`[data-cy="order-create-carrier-option-${idCarrier}"]`).first();
    if (!(await car.count().catch(() => 0))) {
      car = p
        .locator('[data-cy^="order-create-carrier-option-"]')
        .filter({ hasText: new RegExp(`^\\s*${nombreCarrier}\\b`, "i") })
        .first();
    }
    try {
      await car.waitFor({ state: "visible", timeout: lento });
    } catch {
      return { ok: false, creado: false, detalle: `No apareció ${nombreCarrier} en la lista de transportadoras; no se creó el pedido. ${await diagnosticoTransportadoras(p)}` };
    }

    // La tarjeta (div.card-logistic) llega con la clase "disabled" y precio
    // "$ - -" hasta que Dropi cotiza con la ciudad elegida: un clic antes no
    // hace nada. Se espera a que se habilite y tenga precio (hasta ~25 s).
    let cotizada = false;
    for (let i = 0; i < 50; i++) {
      const { habilitada, texto } = await car
        .evaluate((el) => ({ habilitada: !el.classList.contains("disabled"), texto: el.innerText || "" }))
        .catch(() => ({ habilitada: false, texto: "" }));
      if (habilitada && /\$\s*\d/.test(texto)) {
        cotizada = true;
        break;
      }
      await p.waitForTimeout(500);
    }
    if (!cotizada) {
      // Dropi muestra este aviso cuando no tomo la ciudad de destino
      const pideCiudad = await p
        .locator('[data-cy="order-create-carrier-city-required"]')
        .isVisible()
        .catch(() => false);
      return {
        ok: false,
        creado: false,
        detalle: pideCiudad
          ? `Dropi no tomó la ciudad de destino ("${ciudad}"), así que no cotiza transportadoras; no se creó el pedido. ${await diagnosticoTransportadoras(p)}`
          : `${nombreCarrier} no se habilitó o no terminó de cotizar; no se creó el pedido. ${await diagnosticoTransportadoras(p)}`,
      };
    }

    const estaSeleccionada = () =>
      car
        .evaluate((el) => {
          const radio = el.querySelector('input[type="radio"]');
          if (radio && radio.checked) return true;
          const nodos = [el, ...el.querySelectorAll("*")];
          return nodos.some((n) => {
            const aria = [n.getAttribute("aria-checked"), n.getAttribute("aria-selected"), n.getAttribute("aria-pressed")];
            const clases = typeof n.className === "string" ? n.className : "";
            return aria.includes("true") || /(^|[ _-])(selected|active|checked|highlight|chosen|p-highlight)([ _-]|$)/i.test(clases);
          });
        })
        .catch(() => false);

    const elegir = async () => {
      // el "radio" de Dropi es un div (.checker .radio); si hubiera un input
      // real se marca ese. Si no, se hace clic en el circulo y luego en la tarjeta.
      const radioInput = car.locator('input[type="radio"]').first();
      if (await radioInput.count().catch(() => 0)) {
        await radioInput.check({ force: true, timeout: 2000 }).catch(() => {});
        if (await estaSeleccionada()) return;
      }
      const circulo = car.locator(".checker .radio, .radio").first();
      if (await circulo.count().catch(() => 0)) {
        // el circulo es un div pequeno: clic corto y forzado (sin esperar
        // a que Playwright lo considere "clicable")
        await circulo.click({ force: true, timeout: 2000 }).catch(() => {});
        await p.waitForTimeout(400);
        if (await estaSeleccionada()) return;
      }
      await car.click({ timeout: 2000 }).catch(() => car.click({ force: true, timeout: 2000 }).catch(() => {}));
    };

    let transportadoraSeleccionada = false;
    for (let intento = 0; intento < 2 && !transportadoraSeleccionada; intento++) {
      await car.scrollIntoViewIfNeeded().catch(() => {});
      await elegir();
      for (let i = 0; i < 10; i++) {
        transportadoraSeleccionada = await estaSeleccionada();
        if (transportadoraSeleccionada) break;
        await p.waitForTimeout(500);
      }
    }
    if (!transportadoraSeleccionada) {
      return {
        ok: false,
        creado: false,
        detalle: `Dropi no confirmó que ${nombreCarrier} quedó seleccionada; no se activó el seguro ni se creó el pedido. ${await diagnosticoTransportadoras(p)}`,
      };
    }
    return { ok: true };
  }

  /** Tarjeta de una transportadora (por data-cy o, si Dropi cambio el id, por nombre). */
  async function tarjetaTransportadora(p, idCarrier) {
    let car = p.locator(`[data-cy="order-create-carrier-option-${idCarrier}"]`).first();
    if (!(await car.count().catch(() => 0))) {
      car = p
        .locator('[data-cy^="order-create-carrier-option-"]')
        .filter({ hasText: new RegExp(`^\\s*${nombreTransportadora(idCarrier)}\\b`, "i") })
        .first();
    }
    return car;
  }

  /**
   * Cotizacion de UNA transportadora: espera a que su tarjeta este habilitada
   * y con precio. `esperaMs` es corto para las siguientes (Dropi cotiza todas
   * a la vez). Devuelve {ok, precio} o {ok:false, motivo}.
   */
  async function cotizar(p, idCarrier, esperaMs) {
    const car = await tarjetaTransportadora(p, idCarrier);
    const vueltas = Math.max(1, Math.round(esperaMs / 500));
    let visto = false;
    let ultimoTexto = "";
    for (let i = 0; i < vueltas; i++) {
      if (await car.count().catch(() => 0)) {
        visto = true;
        const { habilitada, texto, textoPrecio } = await car
          .evaluate((el) => ({
            habilitada: !el.classList.contains("disabled"),
            texto: el.innerText || "",
            // el precio tiene su propio data-cy: order-create-carrier-option-price-<id>
            textoPrecio: el.querySelector('[data-cy^="order-create-carrier-option-price"]')?.textContent || "",
          }))
          .catch(() => ({ habilitada: false, texto: "", textoPrecio: "" }));
        const precio = precioDeTarjeta(textoPrecio) ?? precioDeTarjeta(texto);
        ultimoTexto = (textoPrecio || texto).replace(/\s+/g, " ").trim().slice(0, 80);
        if (habilitada && precio) return { ok: true, precio };
      }
      await p.waitForTimeout(500);
    }
    return {
      ok: false,
      motivo: visto
        ? `no está disponible para esta ciudad${ultimoTexto ? ` (la tarjeta muestra «${ultimoTexto}»)` : ""}`
        : "no aparece en la lista de Dropi",
    };
  }

  /**
   * Elige la PRIMERA transportadora de la lista que este disponible y cuyo
   * envio no pase el tope. Devuelve {ok, id, nombre, precio, intentos} o
   * {ok:false, envioCaro, sinTransportadora, detalle, intentos}.
   */
  async function elegirTransportadora(p, ids, { maxEnvio = null, ciudad = "" } = {}) {
    const intentos = [];
    let primera = true;
    for (const id of ids) {
      const nombre = nombreTransportadora(id);
      const c = await cotizar(p, id, primera ? Math.min(25000, lento) : Math.min(6000, lento));
      primera = false;
      if (!c.ok) {
        // sin ciudad Dropi no cotiza ninguna: no tiene sentido seguir
        const pideCiudad = await p
          .locator('[data-cy="order-create-carrier-city-required"]')
          .isVisible()
          .catch(() => false);
        if (pideCiudad) {
          return {
            ok: false,
            detalle: `Dropi no tomó la ciudad de destino ("${ciudad}"), así que no cotiza transportadoras; no se creó el pedido. ${await diagnosticoTransportadoras(p)}`,
            intentos,
          };
        }
        intentos.push({ id, nombre, motivo: c.motivo });
        continue;
      }
      if (maxEnvio && c.precio > maxEnvio) {
        intentos.push({ id, nombre, precio: c.precio, caro: true, motivo: `envío ${pesos(c.precio)} supera el tope de ${pesos(maxEnvio)}` });
        continue;
      }
      const s = await seleccionarTransportadora(p, id, ciudad);
      if (!s.ok) {
        intentos.push({ id, nombre, precio: c.precio, motivo: "no se pudo seleccionar" });
        continue;
      }
      return { ok: true, id, nombre, precio: c.precio, intentos };
    }
    const resumen = intentos.map((i) => `${i.nombre}: ${i.motivo}`).join("; ");
    const envioCaro = intentos.some((i) => i.caro);
    return {
      ok: false,
      envioCaro,
      sinTransportadora: !envioCaro,
      intentos,
      detalle: envioCaro
        ? `Envío demasiado caro, no se creó el pedido (${resumen}).`
        : `Ninguna transportadora disponible para este pedido (${resumen}); no se creó.`,
    };
  }

  /**
   * Oficina de Interrapidisimo: con la direccion "Oficina Interrapidisimo" y
   * la transportadora Inter elegida, Dropi muestra
   * <dropi-select data-cy="centro-servicio-interrapidisimo">. Se elige SOLO si
   * la lista trae exactamente UNA oficina; con varias (o ninguna) lo hace una
   * persona.
   */
  async function elegirOficinaInter(p, { objetivo = null } = {}) {
    const boton = p.locator('[data-cy="centro-servicio-interrapidisimo-field"]').first();
    const sinCentros = p.locator('[data-cy="order-create-client-no-centers-alert-dialog"]').first();
    let aparecio = false;
    for (let i = 0; i < Math.round(Math.min(15000, lento) / 500); i++) {
      if (await boton.isVisible().catch(() => false)) {
        aparecio = true;
        break;
      }
      // el aviso "no hay oficinas" (si no existe no se espera por el)
      const textoAlerta = (await sinCentros.count().catch(() => 0))
        ? (await sinCentros.innerText({ timeout: 500 }).catch(() => "")).trim()
        : "";
      if (textoAlerta) {
        await p.keyboard.press("Escape").catch(() => {});
        return { ok: false, oficinas: [], detalle: `Dropi dice que no hay oficinas de Interrapidísimo para esta ciudad: ${textoAlerta.slice(0, 160)}` };
      }
      await p.waitForTimeout(500);
    }
    if (!aparecio) {
      // que habia en el formulario: para saber por que Dropi no lo mostro
      const visto = await p
        .evaluate(() => {
          const dir = document.querySelector('[data-cy="client-address"]');
          const marcada = [...document.querySelectorAll('[data-cy^="order-create-carrier-option-"]')]
            .filter((el) => /selected|active|checked/.test(el.className || "") || el.querySelector("input:checked"))
            .map((el) => el.getAttribute("data-cy").replace("order-create-carrier-option-", ""));
          const relacionados = [...document.querySelectorAll("[data-cy]")]
            .map((el) => el.getAttribute("data-cy"))
            .filter((c) => /centro|oficina|office|center/i.test(c))
            .slice(0, 8);
          const avisos = [...document.querySelectorAll('[role="dialog"], .p-toast-message, .alert, [class*="alert"]')]
            .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 3);
          return { direccion: dir ? dir.value : null, marcada, relacionados, avisos };
        })
        .catch(() => null);
      const extra = visto
        ? ` En el formulario: dirección «${String(visto.direccion ?? "").slice(0, 120)}»` +
          `, transportadora marcada: ${visto.marcada.length ? visto.marcada.join(", ") : "ninguna"}` +
          `, campos de oficina: ${visto.relacionados.length ? visto.relacionados.join(", ") : "ninguno"}` +
          (visto.avisos.length ? `, avisos: ${visto.avisos.join(" | ").slice(0, 200)}` : "") +
          "."
        : "";
      return {
        ok: false,
        oficinas: [],
        detalle: `Dropi no mostró el selector de oficinas de Interrapidísimo (la dirección debe decir «Oficina Interrapidísimo»).${extra}`,
      };
    }
    const textoBoton = async () =>
      (await boton.locator(".elipsis").first().innerText({ timeout: 2000 }).catch(() => "")).trim();
    await boton.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(900);

    // Cada oficina es <button class="option" data-cy="centro-servicio-
    // interrapidisimo-option-<slug>"><span>NOMBRE</span></button>, dentro de
    // un <ul class="select-dropdown-overlay"> que entra con animacion: se
    // espera a que la cantidad deje de cambiar. Si Dropi no trae esos data-cy
    // se cae al metodo generico (hojas con texto dentro del selector).
    const leerOpciones = () =>
      p
        .evaluate(() => {
          const texto = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          document.querySelectorAll("[data-zs-oficina]").forEach((e) => e.removeAttribute("data-zs-oficina"));
          let nodos = [...document.querySelectorAll('[data-cy^="centro-servicio-interrapidisimo-option-"]')];
          let metodo = "data-cy";
          if (!nodos.length) {
            metodo = "generico";
            const host = document.querySelector('dropi-select[data-cy="centro-servicio-interrapidisimo"]');
            const boton = document.querySelector('[data-cy="centro-servicio-interrapidisimo-field"]');
            const fuera = (el) => !(boton && (boton === el || boton.contains(el))) && el.tagName !== "INPUT";
            const raiz = host ?? document.body;
            nodos = [...raiz.querySelectorAll('li, [role="option"], .option, .dropdown-item')].filter(
              (el) => fuera(el) && texto(el),
            );
            nodos = nodos.filter((el) => !nodos.some((o) => o !== el && el.contains(o)));
          }
          const vistos = new Map();
          for (const el of nodos) {
            const t = texto(el);
            if (!t || /selecciona|buscar|sin resultados|no hay/i.test(t)) continue;
            if (!vistos.has(t)) vistos.set(t, el);
          }
          const opciones = [...vistos.keys()];
          if (opciones.length === 1) vistos.get(opciones[0]).setAttribute("data-zs-oficina", "1");
          return { opciones, metodo };
        })
        .catch((e) => ({ opciones: [], error: e?.message ?? String(e) }));

    let lista = { opciones: [] };
    let anterior = -1;
    for (let i = 0; i < 12; i++) {
      lista = await leerOpciones();
      const n = lista.opciones?.length ?? 0;
      if (n > 0 && n === anterior) break;
      anterior = n;
      await p.waitForTimeout(500);
    }
    const oficinas = lista.opciones ?? [];
    // 1) con objetivo (la direccion del cliente ES una oficina, o la escribio
    //    junto a "oficina inter"): la opcion con esa misma direccion
    // 2) sin objetivo: solo si la lista trae UNA oficina
    let elegida = null;
    // un objetivo sin direccion legible ("Oficina Inter Sincelejo") no sirve
    // para comparar: ahi manda la regla de una sola oficina
    if (objetivo && claveCliente(objetivo)) {
      elegida = oficinaQueCoincide(objetivo, oficinas);
      if (!elegida) {
        await p.keyboard.press("Escape").catch(() => {});
        return {
          ok: false,
          oficinas,
          detalle: `La dirección «${objetivo}» no coincide con ninguna de las ${oficinas.length} oficinas de Interrapidísimo que muestra Dropi: la elige una persona.`,
        };
      }
    } else if (oficinas.length === 1) {
      elegida = oficinas[0];
    } else {
      await p.keyboard.press("Escape").catch(() => {});
      return {
        ok: false,
        varias: oficinas.length > 1,
        oficinas,
        detalle: oficinas.length > 1
          ? `Hay ${oficinas.length} oficinas de Interrapidísimo para esta ciudad (${oficinas.slice(0, 6).join(" | ")}): la elige una persona.`
          : `No se pudo leer la lista de oficinas de Interrapidísimo${lista.error ? ` (${lista.error})` : ""}.`,
      };
    }
    // marca la opcion elegida (por su texto) y la pulsa
    await p
      .evaluate((texto) => {
        const t = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        document.querySelectorAll("[data-zs-oficina]").forEach((e) => e.removeAttribute("data-zs-oficina"));
        const nodos = [
          ...document.querySelectorAll('[data-cy^="centro-servicio-interrapidisimo-option-"]'),
          ...document.querySelectorAll('dropi-select[data-cy="centro-servicio-interrapidisimo"] li, dropi-select[data-cy="centro-servicio-interrapidisimo"] [role="option"]'),
        ];
        const el = nodos.find((n) => t(n) === texto);
        if (el) el.setAttribute("data-zs-oficina", "1");
      }, elegida)
      .catch(() => {});
    const opcion = p.locator('[data-zs-oficina="1"]').first();
    await opcion.click({ timeout: 5000 }).catch(() => {});
    await p.evaluate(() => document.querySelectorAll("[data-zs-oficina]").forEach((e) => e.removeAttribute("data-zs-oficina"))).catch(() => {});
    await p.waitForTimeout(700);
    const elegido = await textoBoton();
    const norm = (t) => String(t).replace(/\s+/g, " ").trim().toLowerCase();
    if (!elegido || /selecciona/i.test(elegido) || !norm(elegida).includes(norm(elegido).slice(0, 20))) {
      return { ok: false, oficinas, detalle: `Se intentó elegir la oficina «${elegida}» pero el campo muestra «${elegido || "vacío"}»; no se creó el pedido.` };
    }
    return { ok: true, oficina: elegida, oficinas };
  }

  /**
   * Interruptor del seguro antidevoluciones: dropi-switch
   * [data-cy="order-create-carrier-insurance"] > label.toggle-switch >
   * input[type=checkbox][data-cy="order-create-carrier-insurance-field"].
   * Aparece (div.insurances.active) al elegir Coordinadora. Lo deja en
   * `exigido` y lo CONFIRMA leyendo el checkbox; si no, no se crea nada.
   */
  async function activarSeguro(p, exigido = true, { opcional = false } = {}) {
    const campo = p.locator(SELECTOR_SEGURO).first();
    let encontrado = false;
    for (let i = 0; i < (opcional ? 6 : 20); i++) {
      if (await campo.count().catch(() => 0)) {
        encontrado = true;
        break;
      }
      await p.waitForTimeout(1000);
    }
    if (!encontrado) {
      if (!exigido || opcional) return { ok: true, seguro: null, seguroEncontrado: false };
      return {
        ok: false,
        seguro: null,
        seguroEncontrado: false,
        detalle: `No apareció el interruptor del seguro antidevoluciones; no se creó el pedido. ${await diagnosticoTransportadoras(p)}`,
      };
    }
    // un momento para que termine de cargar antes de tocarlo
    await p.waitForTimeout(800);
    const leer = async () =>
      campo.isChecked({ timeout: 2000 }).catch(() => campo.evaluate((el) => el.checked === true).catch(() => false));

    if ((await leer()) !== exigido) {
      // se prueba primero lo que pulsaria una persona (el interruptor visible)
      const intentos = [
        () => p.locator(`${SELECTOR_SEGURO_HOST} label.toggle-switch`).first().click({ timeout: 2000 }),
        () => p.locator(`${SELECTOR_SEGURO_HOST} .slider`).first().click({ force: true, timeout: 2000 }),
        () => campo.setChecked(exigido, { force: true, timeout: 2000 }),
      ];
      for (const intento of intentos) {
        await intento().catch(() => {});
        await p.waitForTimeout(500);
        if ((await leer()) === exigido) break;
      }
    }
    // se vuelve a leer tras un instante: Angular podria revertirlo
    await p.waitForTimeout(600);
    const final = await leer();
    if (final !== exigido) {
      return {
        ok: false,
        seguro: final,
        seguroEncontrado: true,
        detalle: `No se pudo ${exigido ? "activar" : "desactivar"} el seguro antidevoluciones (sigue ${final ? "activado" : "desactivado"}); no se creó el pedido.`,
      };
    }
    return { ok: true, seguro: final, seguroEncontrado: true };
  }

  /**
   * Boton "Enviar al cliente" (dropi-button > button[data-cy=
   * "order-create-footer-create-field"]). Dropi lo deja deshabilitado
   * mientras valida el formulario: se espera a que se habilite (~15 s). Si no,
   * se devuelve QUE campo marca Dropi como invalido.
   */
  async function esperarBotonCrear(p) {
    const crear = p.locator('[data-cy="order-create-footer-create-field"]').first();
    try {
      await crear.waitFor({ state: "visible", timeout: lento });
    } catch {
      return { ok: false, detalle: "No apareció el botón «Enviar al cliente»; no se creó el pedido." };
    }
    for (let i = 0; i < 30; i++) {
      const habilitado = await crear
        .evaluate((b) => !b.disabled && !b.classList.contains("disabled"))
        .catch(() => false);
      if (habilitado) return { ok: true, boton: crear };
      await p.waitForTimeout(500);
    }
    const invalidos = await p
      .evaluate(() => {
        const dlg = document.querySelector('[data-cy="create-order"]') ?? document;
        const campos = [...dlg.querySelectorAll("input, textarea, select")]
          .filter((el) => /ng-invalid|form-control-invalid/.test(el.className) && el.offsetParent !== null)
          .map((el) => el.getAttribute("data-cy") || el.getAttribute("placeholder") || el.name || el.type);
        const mensajes = [...dlg.querySelectorAll(".invalid-color, .form-control-helper, .alert-message")]
          .map((el) => (el.innerText || "").trim())
          .filter(Boolean);
        return { campos: [...new Set(campos)].slice(0, 10), mensajes: [...new Set(mensajes)].slice(0, 6) };
      })
      .catch(() => ({}));
    return {
      ok: false,
      detalle:
        "El botón «Enviar al cliente» siguió deshabilitado: Dropi considera que falta o está mal algún dato; no se creó el pedido." +
        (invalidos?.campos?.length ? ` Campos inválidos: ${invalidos.campos.join(", ")}.` : "") +
        (invalidos?.mensajes?.length ? ` Mensajes: ${invalidos.mensajes.join(" | ")}.` : ""),
    };
  }

  return {
    estado() {
      return { perfil: perfil || null, chrome, headless, abierto: Boolean(pagina && !pagina.isClosed()) };
    },

    urlActual() {
      try {
        return pagina && !pagina.isClosed() ? pagina.url() : null;
      } catch {
        return null;
      }
    },

    async pagina() {
      return asegurar();
    },

    /**
     * Carga en el perfil del servidor la sesion de Dropi copiada desde el
     * navegador del usuario (su localStorage de app.dropi.co) y comprueba que
     * Dropi la acepte. Asi el servidor no necesita pantalla para iniciar
     * sesion: el login (y cualquier captcha) lo hace la persona en su navegador.
     */
    async inyectarSesion(datos = {}) {
      if (subidaEnCurso) {
        return { ok: false, ocupado: true, detalle: "Hay una subida a Dropi en curso; inténtalo en unos segundos." };
      }
      const entradas = Object.entries(datos ?? {}).filter(
        ([k, v]) => typeof k === "string" && k && typeof v === "string",
      );
      if (!entradas.length) {
        return { ok: false, detalle: "La sesión pegada está vacía o no tiene el formato esperado." };
      }
      subidaEnCurso = true;
      try {
        await this.cerrar();
        const p = await asegurar();
        await p.goto("https://app.dropi.co/dashboard/home", { waitUntil: "domcontentloaded" });
        await p.evaluate((pares) => {
          // se reemplaza la sesion anterior completa (tokens viejos fuera)
          localStorage.clear();
          for (const [k, v] of pares) {
            try {
              localStorage.setItem(k, v);
            } catch {
              /* sin espacio o clave invalida */
            }
          }
        }, entradas);
        await p.goto("https://app.dropi.co/dashboard/home", { waitUntil: "domcontentloaded" });
        // que Angular arranque y, si la sesion no sirve, redirija al login
        let renderizo = false;
        for (let i = 0; i < 20; i++) {
          await p.waitForTimeout(1000);
          if (await enLogin(p)) break;
          const n = await p.evaluate(() => document.querySelectorAll("[data-cy]").length).catch(() => 0);
          if (n > 3) {
            renderizo = true;
            break;
          }
        }
        if (await hayCaptcha(p)) {
          return { ok: false, requiereCaptcha: true, detalle: "Dropi mostró un captcha al abrir la sesión en el servidor." };
        }
        if (await enLogin(p)) {
          return { ok: false, requiereLogin: true, detalle: "Dropi no aceptó la sesión (redirigió al login). Vuelve a entrar en tu navegador y cópiala de nuevo." };
        }
        return { ok: true, claves: entradas.length, renderizo, url: p.url(), detalle: "Sesión de Dropi activa en el servidor" };
      } finally {
        await this.cerrar().catch(() => {});
        subidaEnCurso = false;
      }
    },

    /** Espera a que se habilite «Enviar al cliente» (se usa en pruebas). */
    async esperarBotonCrear(p) {
      const r = await esperarBotonCrear(p);
      return { ok: r.ok, detalle: r.detalle };
    },

    /** Deja el seguro como se pide en un formulario ya abierto (se usa en pruebas). */
    activarSeguro(p, exigido) {
      return activarSeguro(p, exigido);
    },

    /** Elige la transportadora en un formulario ya abierto (se usa en pruebas). */
    seleccionarTransportadora(p, idCarrier, ciudad) {
      return seleccionarTransportadora(p, idCarrier, ciudad);
    },

    /** Elige transportadora con tope (se usa en pruebas). */
    elegirTransportadora(p, ids, opciones) {
      return elegirTransportadora(p, ids, opciones);
    },

    /** Espera la ficha del producto (se usa en pruebas). */
    esperarFicha(p, timeoutMs) {
      return esperarFicha(p, timeoutMs ?? lento);
    },

    /** Elige la oficina de Inter si hay una sola (se usa en pruebas). */
    elegirOficinaInter(p, opciones) {
      return elegirOficinaInter(p, opciones);
    },

    /** Ganancia y envio del resumen de Dropi (se usa en pruebas). */
    leerResumenDropi(p) {
      return leerResumenDropi(p);
    },

    /** Departamento / ciudad en un formulario ya abierto (se usa en pruebas). */
    autocompletar(p, cy, texto, opciones) {
      return autocompletar(p, cy, texto, opciones);
    },

    /** Elige la tienda en un formulario Crear Orden ya abierto (se usa en pruebas). */
    seleccionarTienda(p, nombre) {
      return seleccionarTienda(p, nombre);
    },

    async sesionActiva() {
      const u = this.urlActual();
      return Boolean(u && !/\/auth\/login/i.test(u));
    },

    async iniciar(url = "https://app.dropi.co/dashboard/home") {
      const p = await asegurar();
      await p.goto(url, { waitUntil: "domcontentloaded" });
      return { ok: true, url: p.url() };
    },

    /**
     * Sube un pedido por la interfaz.
     *   datos -> { productoUrl|productoId, nombre, apellido, telefono, email,
     *              direccion, departamento, ciudad, transportadoraId, seguro,
     *              tienda (nombre exacto de la tienda en Dropi), soloPreparar }
     */
    async subirPedido(datos = {}) {
      if (subidaEnCurso) {
        return { ok: false, creado: false, ocupado: true, detalle: "Ya hay otra subida a Dropi en curso en este servidor; espera su resultado antes de reintentar." };
      }
      subidaEnCurso = true;
      try {
      // cerrar el navegador de una vuelta anterior: cada subida arranca limpia
      // (los dialogos o estados viejos no ensucian el intento nuevo). La sesion
      // se conserva porque vive en el perfil, no en la instancia del navegador.
      await this.cerrar();

      const nombreCompleto = `${String(datos.nombre ?? "").trim()} ${String(datos.apellido ?? "").trim()}`.trim();
      const telefono = String(datos.telefono ?? "").replace(/\D/g, "").replace(/^57/, "");
      const lineas = Array.isArray(datos.productos) ? datos.productos : [];
      const tipoPago = Number(datos.tipoPago);
      // transportadoras en orden de preferencia (la primera que sirva)
      const candidatas = (Array.isArray(datos.transportadoras) && datos.transportadoras.length
        ? datos.transportadoras
        : [datos.transportadoraId ?? 5]
      )
        .map(Number)
        .filter((x, i, a) => Number.isInteger(x) && x > 0 && a.indexOf(x) === i);
      const maxEnvio = Number(datos.maxEnvio) > 0 ? Number(datos.maxEnvio) : null;
      const oficinaInter = datos.oficinaInter === true;
      // direccion de la oficina a elegir (si se sabe cual es)
      const oficinaObjetivo = String(datos.oficinaObjetivo ?? "").trim() || null;
      const faltantes = [];
      if (!nombreCompleto) faltantes.push("nombre");
      if (!/^\d{10}$/.test(telefono)) faltantes.push("teléfono colombiano de 10 dígitos");
      if (!String(datos.direccion ?? "").trim()) faltantes.push("dirección");
      if (!String(datos.departamento ?? "").trim()) faltantes.push("departamento resuelto");
      if (!String(datos.ciudad ?? "").trim()) faltantes.push("ciudad resuelta");
      if (lineas.length !== 1) faltantes.push("exactamente una línea de producto");
      const tienda = String(datos.tienda ?? "").trim();
      if (!tienda) faltantes.push("tienda de Dropi configurada");
      if (lineas.length === 1 && (!Number.isInteger(Number(lineas[0]?.cantidad)) || Number(lineas[0]?.cantidad) < 1 || !Number.isFinite(Number(lineas[0]?.precio)) || Number(lineas[0]?.precio) <= 0)) {
        faltantes.push("cantidad y precio válidos del producto");
      }
      if (![1, 2].includes(tipoPago)) faltantes.push("tipo de pago válido (1 o 2)");
      if (!candidatas.length) faltantes.push("al menos una transportadora");
      if (oficinaInter && !(candidatas.length === 1 && candidatas[0] === 3)) {
        faltantes.push("Interrapidísimo como única transportadora (entrega en oficina)");
      }
      if (faltantes.length) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: faltan o no son válidos ${faltantes.join(", ")}.` };
      }

      const p = await asegurar();

      // respuestas con error de la API de Dropi mientras se abre la ficha:
      // si Dropi saca de la ficha, esto dice por que
      const erroresApi = [];
      const verRespuesta = (r) => {
        try {
          const u = new URL(r.url());
          if (r.status() >= 400 && /dropi/i.test(u.hostname) && erroresApi.length < 5) {
            erroresApi.push(`${r.status()} ${u.hostname}${u.pathname.slice(0, 60)}`);
          }
        } catch {
          /* url rara */
        }
      };
      p.on("response", verRespuesta);

      // 1) navegar directo a la ficha del producto (el dropiLink ya trae el
      //    slug: product-details/{id}/{slug})
      if (datos.productoUrl) {
        await p.goto(datos.productoUrl, { waitUntil: "domcontentloaded" });
      } else {
        throw new ErrorApi(400, "Falta productoUrl (el link de Dropi del producto)");
      }

      if (await enLogin(p)) {
        p.off("response", verRespuesta);
        return {
          ok: false,
          requiereLogin: true,
          detalle: "la sesion de Dropi vencio: actualízala desde el panel (Sesión de Dropi)",
        };
      }
      if (await hayCaptcha(p)) {
        p.off("response", verRespuesta);
        return { ok: false, requiereCaptcha: true, detalle: "captcha en la pagina" };
      }

      // 2) "Enviar al cliente" de la ficha -> abre el formulario Crear Orden
      let ficha = await esperarFicha(p, lento);
      // Dropi a veces redirige al cargar (p. ej. a /dashboard/search con una
      // sesion recien restablecida): se intenta abrir el producto una vez mas
      if (!ficha.ok && !ficha.login && !ficha.captcha && !/product-details/i.test(p.url())) {
        await p.goto(datos.productoUrl, { waitUntil: "domcontentloaded" });
        ficha = await esperarFicha(p, lento);
      }
      p.off("response", verRespuesta);
      if (ficha.login) {
        return {
          ok: false,
          requiereLogin: true,
          detalle: "la sesion de Dropi vencio: actualízala desde el panel (Sesión de Dropi)",
        };
      }
      if (ficha.captcha) return { ok: false, requiereCaptcha: true, detalle: "captcha en la pagina" };
      if (!ficha.ok) {
        return {
          ok: false,
          creado: false,
          detalle:
            `No se envió a Dropi: ${ficha.motivo}. Link del producto (sheet): ${datos.productoUrl}. Quedó en: ${ficha.url}` +
            (ficha.titulo ? ` («${ficha.titulo}»)` : "") +
            (erroresApi.length ? `. La API de Dropi respondió: ${erroresApi.join(" · ")}` : ". La API de Dropi no devolvió errores") +
            (ficha.texto ? `. Se ve: "${ficha.texto.slice(0, 120)}"` : ""),
        };
      }
      const btnAbrir = p.locator('[data-cy="send-to-client-button"]');
      await btnAbrir.click();

      // 3) espera a que se abra el formulario Crear Orden
      await p.locator('[data-cy="client-name"]').waitFor({ state: "visible", timeout: lento });

      // 4) datos del cliente
      await p.locator('[data-cy="client-name"]').fill(String(datos.nombre ?? ""));
      await p.locator('[data-cy="client-last-name"]').fill(String(datos.apellido ?? ""));
      // el telefono llega con prefijo de pais (+573001112233); el formulario
      // espera el numero local (3001112233), el pais va en su propio selector
      const telefonoLocal = telefono;
      await p.locator('[data-cy="order-create-client-phone-number-field"]').fill(telefonoLocal);
      await p
        .locator('[data-cy="client-address"]')
        .fill(oficinaInter ? direccionOficinaInter(datos.direccion) : String(datos.direccion ?? ""));
      if (datos.email) await p.locator('[data-cy="client-email"]').fill(String(datos.email));
      // dejar que el formulario valide el cliente antes de tocar ciudad/depto
      await p.waitForTimeout(600);

      // 4.2) tienda en Dropi (la configurada para la tienda de LucidSales)
      const tiendaSel = await seleccionarTienda(p, tienda);
      if (!tiendaSel.ok) {
        return {
          ok: false,
          creado: false,
          detalle:
            `No se envió a Dropi: no se pudo seleccionar la tienda "${tienda}" (${tiendaSel.paso})` +
            (tiendaSel.opciones?.length ? `. Opciones vistas: ${tiendaSel.opciones.join(" | ")}` : "") +
            (tiendaSel.diagnostico ? `. Formulario: ${JSON.stringify(tiendaSel.diagnostico)}` : ""),
        };
      }

      // 4.5) cantidad y precio de venta de la linea del pedido (la fila de
      //      producto carga async: se espera a que aparezca el campo). Son
      //      p-inputnumber: se apunta al <input> interno.
      const qtySel = '[data-cy^="order-create-products-row-quantity-"] input';
      for (let i = 0; i < 15; i++) {
        if (await p.locator(qtySel).count().catch(() => 0)) break;
        await p.waitForTimeout(500);
      }
      const cantidad = Number(datos.productos?.[0]?.cantidad) || 1;
      const precioVenta = Number(datos.productos?.[0]?.precio) || 0;
      await p.locator(qtySel).first().fill(String(cantidad)).catch(() => {});
      if (precioVenta > 0) {
        await p
          .locator('[data-cy^="order-create-products-row-price-"] input')
          .first()
          .fill(precioVenta.toLocaleString("es-CO"))
          .catch(() => {});
      }

      // 5) departamento por NOMBRE (autocomplete)
      const ubicacion = {
        departamento: datos.departamento
          ? await autocompletar(p, "client-state", datos.departamento)
          : null,
      };
      if (!ubicacion.departamento?.ok) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: no se confirmó el departamento exacto (${ubicacion.departamento?.solicitado ?? datos.departamento}).` };
      }
      await p.waitForTimeout(1200);

      // 5.5) tipo de recaudo SEGUN EL PEDIDO (1 = Con Recaudo, 2 = Sin Recaudo).
      //      Hay que elegirlo ANTES de la ciudad, porque al cambiar el tipo se
      //      BORRA la ciudad. El seguro antidevoluciones funciona con AMBOS
      //      tipos de recaudo (solo necesita un poco de tiempo para cargar).
      const seguroExigido = datos.seguro !== false;
      const opcionRecaudo =
        tipoPago === 2
          ? "order-create-carrier-rate-type-option-2" // Sin Recaudo
          : "order-create-carrier-rate-type-option-1"; // Con Recaudo
      await p
        .locator(`[data-cy="${opcionRecaudo}"]`)
        .first()
        .click({ force: true })
        .catch(() => {});
      await p.waitForTimeout(1000);

      // 5.6) ciudad por NOMBRE (se habilita tras el departamento; se elige
      //      despues del tipo de recaudo para que no la borre)
      // la ciudad con su departamento: Dropi marca las repetidas ("Armenia (Q)")
      // Corregimiento: en Dropi algunos son un municipio aparte de la ciudad
      // ("Rozo" de Palmira). Si el cliente vive en uno, se busca ESE; si Dropi
      // no lo tiene, no se sube (a la ciudad principal llegaria mal).
      const corregimiento = String(datos.corregimiento ?? "").trim();
      const ciudadDropi =
        corregimiento && normalizarTexto(corregimiento) !== normalizarTexto(datos.ciudad) ? corregimiento : String(datos.ciudad ?? "");
      ubicacion.ciudad = ciudadDropi
        ? await autocompletar(p, "client-city", ciudadDropi, { departamento: datos.departamento })
        : null;
      if (!ubicacion.ciudad?.ok && ciudadDropi !== String(datos.ciudad ?? "") && ubicacion.ciudad?.paso !== "sin campo") {
        return {
          ok: false,
          creado: false,
          corregimientoHumano: true,
          detalle:
            `No se envió a Dropi: el cliente vive en el corregimiento ${corregimiento} (${datos.ciudad}) y en Dropi no aparece como municipio aparte` +
            `${ubicacion.ciudad?.opciones?.length ? ` (Dropi ofreció: ${ubicacion.ciudad.opciones.join(", ")})` : ""}. Lo revisa una persona.`,
        };
      }
      if (!ubicacion.ciudad?.ok) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: no se confirmó la ciudad exacta (${ubicacion.ciudad?.solicitado ?? ciudadDropi}).` };
      }
      if (ciudadDropi !== String(datos.ciudad ?? "")) ubicacion.corregimiento = { nombre: corregimiento, elegido: ubicacion.ciudad.elegido };
      // dejar que la ciudad quede registrada antes de tocar la transportadora
      await p.waitForTimeout(1000);

      // 6) transportadora: la primera de la lista que este disponible y cuyo
      //    envio no pase el tope (hay que esperar a que Dropi cotice)
      const selCarrier = await elegirTransportadora(p, candidatas, { maxEnvio, ciudad: ciudadDropi });
      if (!selCarrier.ok) {
        return {
          ok: false,
          creado: false,
          envioCaro: Boolean(selCarrier.envioCaro),
          sinTransportadora: Boolean(selCarrier.sinTransportadora),
          intentos: selCarrier.intentos,
          detalle: selCarrier.detalle,
        };
      }
      const envio = { id: selCarrier.id, transportadora: selCarrier.nombre, precio: selCarrier.precio, tope: maxEnvio };
      await p.waitForTimeout(2500);

      // 6.5) oficina de Interrapidisimo: solo si Dropi ofrece UNA
      let oficina = null;
      if (oficinaInter) {
        const rOf = await elegirOficinaInter(p, { objetivo: oficinaObjetivo });
        if (!rOf.ok) {
          return { ok: false, creado: false, oficinaHumano: true, oficinas: rOf.oficinas, envio, detalle: rOf.detalle };
        }
        oficina = rOf.oficina;
        envio.oficina = oficina;
      }

      // 7) EL SEGURO ANTIDEVOLUCIONES: obligatorio con Coordinadora; con otra
      //    transportadora se activa si Dropi lo ofrece
      const rSeguro = await activarSeguro(p, seguroExigido, { opcional: selCarrier.id !== 5 });
      if (!rSeguro.ok) return { ok: false, creado: false, seguro: rSeguro.seguro, seguroEncontrado: rSeguro.seguroEncontrado, detalle: rSeguro.detalle };
      const seguroActivado = rSeguro.seguro;
      const seguroEncontrado = rSeguro.seguroEncontrado;

      // la tienda tiene que seguir elegida al final (otro campo podria haberla
      // reiniciado); si no, no se prepara ni se crea nada
      if (!(await tiendaSel.verificar())) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: la tienda "${tienda}" dejó de estar seleccionada en el formulario.` };
      }

      // el boton tiene que habilitarse (tambien en preparacion: asi el modo
      // prueba confirma que el pedido se PODRIA crear)
      const rBoton = await esperarBotonCrear(p);
      if (!rBoton.ok) return { ok: false, creado: false, seguro: seguroActivado, detalle: rBoton.detalle };

      // resumen de Dropi con todo elegido: ganancia y precio del envio
      const resumenDropi = await leerResumenDropi(p);

      // modo preparacion: todo listo pero NO se pulsa crear
      if (datos.soloPreparar) {
        return {
          ok: true,
          preparado: true,
          seguro: seguroActivado,
          seguroEncontrado,
          ubicacion,
          envio,
          resumenDropi,
          tienda: tiendaSel.elegido,
          detalle: `formulario preparado en la tienda ${tiendaSel.elegido} con ${envio.transportadora} (${pesos(envio.precio)}${oficina ? `, oficina ${oficina}` : ""}) y «Enviar al cliente» habilitado; no se pulsó (modo prueba)`,
          url: p.url(),
        };
      }

      if (await hayCaptcha(p)) return { ok: false, requiereCaptcha: true, detalle: "captcha antes de crear" };

      // 8) CREAR: "Enviar al cliente" (ya se comprobo que esta habilitado)
      const crear = rBoton.boton;
      // Dropi crea la orden mediante este endpoint. Esperamos la respuesta
      // real y su id antes de afirmar éxito; ante timeout el resultado queda
      // incierto para impedir un reintento que duplique la orden.
      const respuestaDropi = p.waitForResponse(
        (r) => r.request().method() === "POST" && /\/orders\/myorders(?:\?|$)/i.test(r.url()),
        { timeout: lento },
      ).catch(() => null);
      try {
        await crear.click();
      } catch (e) {
        return {
          ok: false,
          creado: false,
          resultadoIncierto: true,
          seguro: seguroActivado,
          detalle: `No se pudo confirmar el clic de creación (${e?.message ?? e}). Verifica Dropi antes de reintentar.`,
          url: p.url(),
        };
      }
      const respuesta = await respuestaDropi;

      if (await hayCaptcha(p)) return { ok: false, requiereCaptcha: true, detalle: "captcha al enviar" };
      if (!respuesta) {
        return {
          ok: false,
          creado: false,
          resultadoIncierto: true,
          seguro: seguroActivado,
          detalle: "Dropi no confirmó la creación dentro del tiempo esperado. Verifica la orden en Dropi antes de reintentar.",
          url: p.url(),
        };
      }
      let resultado;
      try {
        resultado = await respuesta.json();
      } catch {
        resultado = null;
      }
      if (!respuesta.ok() || resultado?.isSuccess !== true) {
        return {
          ok: false,
          creado: false,
          seguro: seguroActivado,
          detalle: String(resultado?.message ?? resultado?.msg ?? `Dropi respondió HTTP ${respuesta.status()} sin confirmar la creación.`),
          url: p.url(),
        };
      }
      return {
        ok: true,
        creado: true,
        idDropi: resultado?.objects?.id ?? resultado?.objects?.order_id ?? null,
        envio,
        resumenDropi,
        tienda: tiendaSel.elegido,
        seguro: seguroActivado,
        seguroEncontrado,
        detalle: String(resultado?.message ?? "Orden confirmada por Dropi"),
        url: p.url(),
      };
      } finally {
        subidaEnCurso = false;
      }
    },

    async cerrar() {
      try {
        if (navegador) await navegador.close();
      } catch {
        /* ya estaba cerrado */
      }
      navegador = null;
      pagina = null;
    },
  };
}
