// Transportadora con tope de envio y oficina de Interrapidisimo, probadas en
// un Chromium real contra una pagina que imita el formulario Crear Orden de
// Dropi (mismos data-cy). Si no hay Chromium en la maquina, se saltan.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { crearDropiNavegador, direccionOficinaInter, precioDeTarjeta } from "../dropiNavegador.js";

const RUTAS = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
let navegador = null;
let motivoSalto = null;

before(async () => {
  try {
    const { chromium } = await import("playwright-core");
    const ruta = RUTAS.find((r) => fs.existsSync(r));
    if (!ruta) throw new Error("sin Chromium");
    navegador = await chromium.launch({ executablePath: ruta, args: ["--no-sandbox"] });
  } catch (e) {
    motivoSalto = `no hay Chromium para probar el formulario (${e?.message ?? e})`;
  }
});
after(async () => {
  await navegador?.close().catch(() => {});
});

const nav = crearDropiNavegador({ DROPI_NAVEGADOR_MS: 3000 });

/** Tarjetas de transportadora: precio que llega tarde y radio que marca. */
function paginaTransportadoras({ coordinadora = "$ 25.000", inter = "$ 12.300", interDisponible = true } = {}) {
  return `<!doctype html><html><head><style>
    .card-logistic { display: block; padding: 10px; border: 1px solid #ccc; margin: 6px; }
    .radio { display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #999; }
  </style></head><body>
  <div data-cy="order-create-carrier-option-5" class="card-logistic disabled">Coordinadora
    <span class="precio">$ - -</span> 2-3 días
    <div class="checker"><div class="radio"></div></div></div>
  <div data-cy="order-create-carrier-option-3" class="card-logistic ${interDisponible ? "" : "disabled"}">Interrapidisimo
    <div class="price" data-cy="order-create-carrier-option-price-3"><currency>${interDisponible ? inter.replace(" ", "&nbsp;") : "$ - -"}</currency></div>
    <div class="checker"><div class="radio"></div></div></div>
  <script>
    setTimeout(() => {
      const c = document.querySelector('[data-cy="order-create-carrier-option-5"]');
      c.classList.remove("disabled");
      c.querySelector(".precio").textContent = ${JSON.stringify(coordinadora)};
    }, 400);
    document.querySelectorAll(".card-logistic").forEach((card) => {
      card.querySelector(".radio").addEventListener("click", () => {
        if (card.classList.contains("disabled")) return;
        document.querySelectorAll(".card-logistic").forEach((x) => x.classList.remove("selected"));
        card.classList.add("selected");
      });
    });
  </script></body></html>`;
}

/** Selector de oficinas de Inter (dropi-select) con N oficinas. */
function paginaOficinas(oficinas) {
  return `<!doctype html><html><body>
  <dropi-select data-cy="centro-servicio-interrapidisimo"><div class="custom-select"><div class="dropdown-container">
    <button type="button" class="select-button" data-cy="centro-servicio-interrapidisimo-field">
      <div class="button-content"><div class="elipsis"> Selecciona la oficina Interrapidísimo </div></div>
    </button>
  </div></div></dropi-select>
  <script>
    const host = document.querySelector("dropi-select");
    const boton = host.querySelector("button");
    // como Dropi: <ul class="select-dropdown-overlay"> con <li><button
    // class="option" data-cy="centro-servicio-interrapidisimo-option-…">,
    // que se va llenando durante la animacion de apertura
    const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    boton.addEventListener("click", () => {
      if (document.querySelector("ul.select-dropdown-overlay")) return;
      const ul = document.createElement("ul");
      ul.className = "select-dropdown-overlay";
      document.body.appendChild(ul);
      ${JSON.stringify(oficinas)}.forEach((nombre, i) => {
        setTimeout(() => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.className = "option";
          b.setAttribute("data-cy", "centro-servicio-interrapidisimo-option-" + slug(nombre));
          b.innerHTML = "<span>" + nombre + " </span>";
          b.addEventListener("click", () => {
            boton.querySelector(".elipsis").textContent = " " + nombre + " ";
            ul.remove();
          });
          li.appendChild(b);
          ul.appendChild(li);
        }, 150 + i * 120);
      });
    });
  </script></body></html>`;
}

async function pagina(html) {
  const p = await navegador.newPage();
  await p.setContent(html);
  return p;
}

test("precioDeTarjeta lee el flete de la tarjeta", () => {
  assert.equal(precioDeTarjeta("Coordinadora\n$ 18.500\n2-3 días"), 18500);
  assert.equal(precioDeTarjeta("$18.500,00"), 18500);
  assert.equal(precioDeTarjeta("Inter $ 12,300"), 12300);
  assert.equal(precioDeTarjeta("$ - -"), null);
  // tal cual lo pinta Dropi: <currency>$&nbsp;27.870</currency>
  assert.equal(precioDeTarjeta("$\u00a027.870"), 27870);
  assert.equal(precioDeTarjeta("Interrapidisimo\n$\u00a027.870"), 27870);
});

test("la direccion de oficina siempre dice «Oficina Interrapidisimo»", () => {
  assert.equal(direccionOficinaInter("Oficina Interrapidísimo Sincelejo"), "Oficina Interrapidísimo Sincelejo");
  assert.equal(direccionOficinaInter("recoger en la de inter"), "Oficina Interrapidisimo - recoger en la de inter");
});

test("elige la primera transportadora si el envio no pasa el tope", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaTransportadoras());
  try {
    const r = await nav.elegirTransportadora(p, [5, 3], { maxEnvio: 30000 });
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.id, 5);
    assert.equal(r.precio, 25000);
    assert.equal(await p.locator('[data-cy="order-create-carrier-option-5"]').evaluate((el) => el.classList.contains("selected")), true);
  } finally {
    await p.close();
  }
});

test("si la primera es muy cara pasa a la segunda opcion", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaTransportadoras());
  try {
    const r = await nav.elegirTransportadora(p, [5, 3], { maxEnvio: 20000 });
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.id, 3);
    assert.equal(r.precio, 12300);
    assert.match(r.intentos[0].motivo, /supera el tope/);
  } finally {
    await p.close();
  }
});

test("si todas pasan el tope: envio caro y no se elige ninguna", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaTransportadoras());
  try {
    const r = await nav.elegirTransportadora(p, [5, 3], { maxEnvio: 10000 });
    assert.equal(r.ok, false);
    assert.equal(r.envioCaro, true);
    assert.match(r.detalle, /Coordinadora.*\$25\.000.*Interrapidisimo.*\$12\.300/);
    assert.equal(await p.locator(".selected").count(), 0);
  } finally {
    await p.close();
  }
});

test("si la segunda no esta disponible y la primera es cara: envio caro", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaTransportadoras({ interDisponible: false }));
  try {
    const r = await nav.elegirTransportadora(p, [5, 3], { maxEnvio: 20000 });
    assert.equal(r.ok, false);
    assert.equal(r.envioCaro, true);
    assert.match(r.intentos[1].motivo, /no está disponible/);
  } finally {
    await p.close();
  }
});

test("una transportadora que no existe se salta y se usa la siguiente", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaTransportadoras());
  try {
    const r = await nav.elegirTransportadora(p, [10, 3], {});
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.id, 3);
    assert.match(r.intentos[0].motivo, /no aparece/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: con UNA oficina la elige", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaOficinas(["PTO/SINCELEJO/SUC/COL/CRA 20 # 22-15"]));
  try {
    const r = await nav.elegirOficinaInter(p);
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.oficina, "PTO/SINCELEJO/SUC/COL/CRA 20 # 22-15");
    assert.match(await p.locator(".elipsis").innerText(), /SINCELEJO/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: con VARIAS no elige ninguna (la hace una persona)", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(
    paginaOficinas([
      "COL/MEDELLIN/ANT/COL/OF. PRINC CL 30 A 65 B 59",
      "PTO/MEDELLIN/ANT/COL/CALLE 96 #67-18",
      "PTO/MEDELLIN/ANT/COL/CL 104 65 43 R.O",
      "PTO/MEDELLIN/ANT/COL/KR 99D 49A 13",
    ]),
  );
  try {
    const r = await nav.elegirOficinaInter(p);
    assert.equal(r.ok, false);
    assert.equal(r.varias, true);
    assert.equal(r.oficinas.length, 4, "cuenta TODAS aunque lleguen de a poco");
    assert.match(r.detalle, /Hay 4 oficinas/);
    assert.match(await p.locator(".elipsis").innerText(), /Selecciona/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: si Dropi no muestra el selector, no se sube", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina("<!doctype html><html><body><p>sin selector</p></body></html>");
  try {
    const r = await nav.elegirOficinaInter(p);
    assert.equal(r.ok, false);
    assert.match(r.detalle, /no mostró el selector/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: con objetivo elige ESA entre varias", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(
    paginaOficinas([
      "COL/MEDELLIN/ANT/COL/OF. PRINC CL 30 A 65 B 59",
      "PTO/MEDELLIN/ANT/COL/CALLE 96 #67-18",
      "PTO/MEDELLIN/ANT/COL/KR 50 NO 39 67 R.O",
    ]),
  );
  try {
    const r = await nav.elegirOficinaInter(p, { objetivo: "Carrera 50 # 39-67" });
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.oficina, "PTO/MEDELLIN/ANT/COL/KR 50 NO 39 67 R.O");
    assert.match(await p.locator(".elipsis").innerText(), /KR 50 NO 39 67/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: objetivo que no esta en la lista -> una persona", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaOficinas(["PTO/MEDELLIN/ANT/COL/CALLE 96 #67-18", "PTO/MEDELLIN/ANT/COL/KR 50 NO 39 67 R.O"]));
  try {
    const r = await nav.elegirOficinaInter(p, { objetivo: "Calle 10 # 5-20" });
    assert.equal(r.ok, false);
    assert.match(r.detalle, /no coincide con ninguna de las 2 oficinas/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: objetivo sin direccion legible usa la regla de una sola", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaOficinas(["PTO/SINCELEJO/SUC/COL/CRA 20 # 22-15"]));
  try {
    const r = await nav.elegirOficinaInter(p, { objetivo: "Oficina Interrapidisimo Sincelejo" });
    assert.equal(r.ok, true, r.detalle);
  } finally {
    await p.close();
  }
});

test("ficha: el boton aparece tarde y se espera", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(`<!doctype html><body><script>setTimeout(() => { const b = document.createElement("button"); b.setAttribute("data-cy","send-to-client-button"); b.textContent = "Enviar al cliente"; document.body.appendChild(b); }, 800)</script></body>`);
  try {
    assert.deepEqual(await nav.esperarFicha(p, 3000), { ok: true });
  } finally {
    await p.close();
  }
});

test("ficha: captcha que aparece despues de cargar se reconoce", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(`<!doctype html><body><script>setTimeout(() => { document.body.innerHTML = '<div class="cf-turnstile">Verify you are human</div>'; }, 600)</script></body>`);
  try {
    assert.deepEqual(await nav.esperarFicha(p, 3000), { captcha: true });
  } finally {
    await p.close();
  }
});

test("ficha: sin boton dice por que y que se ve", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await navegador.newPage();
  await p.route("https://app.dropi.co/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Dropi</title><body>Este producto está agotado por ahora en el catálogo del proveedor</body>" }),
  );
  await p.goto("https://app.dropi.co/dashboard/product-details/1/taladro");
  try {
    const r = await nav.esperarFicha(p, 1200);
    assert.equal(r.ok, undefined);
    assert.match(r.motivo, /agotado/);
    assert.match(r.texto, /agotado/);
  } finally {
    await p.close();
  }
});

test("ficha: si Dropi redirige a otra pagina lo dice (no que el producto no existe)", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await navegador.newPage();
  await p.route("https://app.dropi.co/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Dropi</title><body>Miembro De: TIENDA Inicio Dashboard Productos No encontramos productos</body>" }),
  );
  await p.goto("https://app.dropi.co/dashboard/search");
  try {
    const r = await nav.esperarFicha(p, 1000);
    assert.match(r.motivo, /redirigió/);
  } finally {
    await p.close();
  }
});

/** Autocomplete de departamento como el de Dropi: filtra por lo que se escribe. */
function paginaDepartamentos(opciones) {
  return `<!doctype html><html><body>
  <div data-cy="client-state"><input type="text"></div>
  <ul class="p-autocomplete-panel"></ul>
  <script>
    const ops = ${JSON.stringify(opciones)};
    const caja = document.querySelector('[data-cy="client-state"] input');
    const panel = document.querySelector("ul");
    const norm = (t) => t.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
    caja.addEventListener("input", () => {
      panel.innerHTML = "";
      setTimeout(() => {
        for (const o of ops.filter((x) => norm(x).includes(norm(caja.value)))) {
          const li = document.createElement("li");
          li.textContent = o;
          li.addEventListener("click", () => { caja.value = o; panel.innerHTML = ""; });
          panel.appendChild(li);
        }
      }, 150);
    });
  </script></body></html>`;
}

test("departamento: «Valle del Cauca» se encuentra como «VALLE» en Dropi", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaDepartamentos(["VALLE", "VAUPES", "CAUCA"]));
  try {
    const r = await nav.autocompletar(p, "client-state", "Valle del Cauca");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.elegido, "VALLE");
    assert.equal(await p.locator('[data-cy="client-state"] input').inputValue(), "VALLE");
  } finally {
    await p.close();
  }
});

test("departamento: un nombre que no esta no elige uno parecido", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaDepartamentos(["SANTANDER", "NORTE DE SANTANDER"]));
  try {
    const r = await nav.autocompletar(p, "client-state", "Santander");
    assert.equal(r.elegido, "SANTANDER");
    const r2 = await nav.autocompletar(p, "client-state", "Antioquia");
    assert.equal(r2.ok, false);
  } finally {
    await p.close();
  }
});
