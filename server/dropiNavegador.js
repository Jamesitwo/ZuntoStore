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
import { ErrorApi } from "./errores.js";

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
    navegador = await chromium.launchPersistentContext(perfil, {
      headless,
      executablePath: chrome,
      viewport: { width: 1440, height: 950 },
      locale: "es-CO",
      timezoneId: "America/Bogota",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    pagina = navegador.pages()[0] ?? (await navegador.newPage());
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
  async function autocompletar(p, cy, texto) {
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

    const objetivo = String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const candidatas = await opciones.all().catch(() => []);
    let opcionExacta = null;
    let elegido = "";
    for (const opcion of candidatas) {
      const textoOpcion = (await opcion.innerText().catch(() => "")).trim();
      const normalizada = textoOpcion.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (normalizada === objetivo) {
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
      await opcion.click().catch(() => {});
      await opcion.evaluate((el) => el.removeAttribute("data-zs-opcion")).catch(() => {});
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

  /**
   * Interruptor del seguro antidevoluciones: dropi-switch
   * [data-cy="order-create-carrier-insurance"] > label.toggle-switch >
   * input[type=checkbox][data-cy="order-create-carrier-insurance-field"].
   * Aparece (div.insurances.active) al elegir Coordinadora. Lo deja en
   * `exigido` y lo CONFIRMA leyendo el checkbox; si no, no se crea nada.
   */
  async function activarSeguro(p, exigido = true) {
    const campo = p.locator(SELECTOR_SEGURO).first();
    let encontrado = false;
    for (let i = 0; i < 20; i++) {
      if (await campo.count().catch(() => 0)) {
        encontrado = true;
        break;
      }
      await p.waitForTimeout(1000);
    }
    if (!encontrado) {
      if (!exigido) return { ok: true, seguro: null, seguroEncontrado: false };
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
      const carrierId = Number(datos.transportadoraId ?? 5);
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
      if (datos.seguro !== false && carrierId !== 5) faltantes.push("Coordinadora (única transportadora configurada con seguro)");
      if (faltantes.length) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: faltan o no son válidos ${faltantes.join(", ")}.` };
      }

      const p = await asegurar();

      // 1) navegar directo a la ficha del producto (el dropiLink ya trae el
      //    slug: product-details/{id}/{slug})
      if (datos.productoUrl) {
        await p.goto(datos.productoUrl, { waitUntil: "domcontentloaded" });
      } else {
        throw new ErrorApi(400, "Falta productoUrl (el link de Dropi del producto)");
      }

      if (await enLogin(p)) {
        return {
          ok: false,
          requiereLogin: true,
          detalle: "la sesion de Dropi vencio: actualízala desde el panel (Sesión de Dropi)",
        };
      }
      if (await hayCaptcha(p)) return { ok: false, requiereCaptcha: true, detalle: "captcha en la pagina" };

      // 2) "Enviar al cliente" de la ficha -> abre el formulario Crear Orden
      const btnAbrir = p.locator('[data-cy="send-to-client-button"]');
      await btnAbrir.waitFor({ state: "visible", timeout: lento });
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
      await p.locator('[data-cy="client-address"]').fill(String(datos.direccion ?? ""));
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
      ubicacion.ciudad = datos.ciudad ? await autocompletar(p, "client-city", datos.ciudad) : null;
      if (!ubicacion.ciudad?.ok) {
        return { ok: false, creado: false, detalle: `No se envió a Dropi: no se confirmó la ciudad exacta (${ubicacion.ciudad?.solicitado ?? datos.ciudad}).` };
      }
      // dejar que la ciudad quede registrada antes de tocar la transportadora
      await p.waitForTimeout(1000);

      // 6) transportadora Coordinadora: el seguro solo aparece con ella, y hay
      //    que esperar a que la cotizacion cargue (precio != "-")
      const selCarrier = await seleccionarTransportadora(p, carrierId, datos.ciudad);
      if (!selCarrier.ok) return { ok: false, creado: false, detalle: selCarrier.detalle };
      await p.waitForTimeout(2500);

      // 7) EL SEGURO ANTIDEVOLUCIONES (aparece al elegir Coordinadora)
      const rSeguro = await activarSeguro(p, seguroExigido);
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

      // modo preparacion: todo listo pero NO se pulsa crear
      if (datos.soloPreparar) {
        return {
          ok: true,
          preparado: true,
          seguro: seguroActivado,
          seguroEncontrado,
          ubicacion,
          tienda: tiendaSel.elegido,
          detalle: `formulario preparado en la tienda ${tiendaSel.elegido} con «Enviar al cliente» habilitado; no se pulsó (modo prueba)`,
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
