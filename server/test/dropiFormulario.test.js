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
    <span class="precio">${interDisponible ? inter : "$ - -"}</span> 1-2 días
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
    boton.addEventListener("click", () => {
      if (host.querySelector("ul")) return;
      const ul = document.createElement("ul");
      for (const nombre of ${JSON.stringify(oficinas)}) {
        const li = document.createElement("li");
        li.innerHTML = "<span>" + nombre + "</span>";
        li.addEventListener("click", () => {
          boton.querySelector(".elipsis").textContent = " " + nombre + " ";
          ul.remove();
        });
        ul.appendChild(li);
      }
      host.querySelector(".dropdown-container").appendChild(ul);
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
  const p = await pagina(paginaOficinas(["INTER SINCELEJO CENTRO - CRA 20 # 22-15"]));
  try {
    const r = await nav.elegirOficinaInter(p);
    assert.equal(r.ok, true, r.detalle);
    assert.equal(r.oficina, "INTER SINCELEJO CENTRO - CRA 20 # 22-15");
    assert.match(await p.locator(".elipsis").innerText(), /SINCELEJO CENTRO/);
  } finally {
    await p.close();
  }
});

test("oficina de Inter: con VARIAS no elige ninguna (la hace una persona)", async (t) => {
  if (motivoSalto) return t.skip(motivoSalto);
  const p = await pagina(paginaOficinas(["INTER MEDELLIN CENTRO", "INTER MEDELLIN POBLADO", "INTER BELLO"]));
  try {
    const r = await nav.elegirOficinaInter(p);
    assert.equal(r.ok, false);
    assert.equal(r.varias, true);
    assert.equal(r.oficinas.length, 3);
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
