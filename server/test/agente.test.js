// Pruebas del nucleo del agente de Dropi: la parte determinista.
//   node --test   (o npm test dentro de server/)
//
// Aqui NO hay LLM ni red: se prueba la comparacion (producto, precio,
// direccion, confirmacion) y la decision de subir/frenar. La extraccion del
// chat se inyecta como funcion, que es exactamente como la usa el servidor.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parsearPrecio,
  normalizarTexto,
  coincideProducto,
  coincidePrecio,
  coincideDireccion,
  validarPedido,
  decidir,
  ejecutarAgente,
  resumenDePedido,
} from "../agente.js";

// ---------- parsearPrecio: formato colombiano ----------
test("parsearPrecio entiende el punto de miles colombiano", () => {
  assert.equal(parsearPrecio("84.900"), 84900);
  assert.equal(parsearPrecio("$ 84.900"), 84900);
  assert.equal(parsearPrecio("1.250.000"), 1250000);
});

test("parsearPrecio entiende decimales con coma", () => {
  assert.equal(parsearPrecio("84.900,50"), 84900.5);
  assert.equal(parsearPrecio("20790,5"), 20790.5);
});

test("parsearPrecio con formato ingles y numeros crudos", () => {
  assert.equal(parsearPrecio("84,900.50"), 84900.5);
  assert.equal(parsearPrecio("84900"), 84900);
  assert.equal(parsearPrecio(84900), 84900);
});

test("parsearPrecio devuelve null cuando no hay precio", () => {
  assert.equal(parsearPrecio(""), null);
  assert.equal(parsearPrecio("no se"), null);
  assert.equal(parsearPrecio(null), null);
});

// ---------- normalizarTexto ----------
test("normalizarTexto quita acentos y baja minusculas", () => {
  assert.equal(normalizarTexto("Medellín"), "medellin");
  assert.equal(normalizarTexto("  Cra. 92  "), "cra. 92");
});

// ---------- coincideProducto ----------
test("coincideProducto acepta la descripcion informal del chat", () => {
  const catalogo = ["Taladro Inalambrico 68V", "Perfume Eclaire 100ml"];
  assert.equal(coincideProducto("el taladro de 68", catalogo).ok, true);
  assert.equal(coincideProducto("el perfume ese", catalogo).ok, true);
});

test("coincideProducto rechaza otro producto", () => {
  const catalogo = ["Taladro Inalambrico 68V"];
  assert.equal(coincideProducto("una bicicleta roja", catalogo).ok, false);
});

test("coincideProducto sin nada en el chat no pasa", () => {
  assert.equal(coincideProducto("", ["Taladro"]).ok, false);
});

// ---------- coincidePrecio ----------
const RESUMEN = {
  total: "105.690",
  subtotal: "84.900",
  costoEnvio: "20.790,5",
  productos: [{ id: "1", nombre: "Taladro Inalambrico 68V", cantidad: 1, precio: 84900 }],
  direccion: "Carrera 92 #78b-02",
};

test("coincidePrecio acepta el total citado en el chat", () => {
  assert.equal(coincidePrecio("105.690", RESUMEN).ok, true);
});

test("coincidePrecio acepta el precio del producto sin envio", () => {
  assert.equal(coincidePrecio("84.900", RESUMEN).ok, true);
});

test("coincidePrecio rechaza un precio distinto", () => {
  const r = coincidePrecio("50.000", RESUMEN);
  assert.equal(r.ok, false);
  assert.match(r.razon, /el chat dice 50000/);
});

test("coincidePrecio sin precio en el chat no pasa", () => {
  assert.equal(coincidePrecio(null, RESUMEN).ok, false);
});

// ---------- coincideDireccion ----------
test("coincideDireccion acepta la misma direccion escrita distinto", () => {
  assert.equal(coincideDireccion("cra 92 #78b-02", "Carrera 92 #78b-02").ok, true);
});

test("coincideDireccion rechaza otra direccion", () => {
  assert.equal(coincideDireccion("calle 5 #1-2", "Carrera 92 #78b-02").ok, false);
});

// ---------- validarPedido / decidir ----------
test("validarPedido pasa cuando todo calza", () => {
  const v = validarPedido(RESUMEN, {
    producto: "el taladro de 68",
    cantidad: 1,
    precioAcordado: 105690,
    direccion: "cra 92 #78b-02",
    clienteConfirmo: true,
    entregaFutura: false,
  });
  assert.equal(v.ok, true);
  assert.equal(v.checks.length, 8);
  assert.equal(decidir(v).accion, "subir");
});

test("validarPedido frena si el precio no calza, pero senala todo", () => {
  const v = validarPedido(RESUMEN, {
    producto: "el taladro de 68",
    cantidad: 1,
    precioAcordado: 50000, // malo
    direccion: "cra 92 #78b-02",
    clienteConfirmo: true,
    entregaFutura: false,
  });
  assert.equal(v.ok, false);
  const d = decidir(v);
  assert.equal(d.accion, "frenar");
  assert.deepEqual(
    d.problemas.map((p) => p.campo),
    ["precio"],
  );
});

test("validarPedido frena si el cliente no confirmo", () => {
  const v = validarPedido(RESUMEN, {
    producto: "el taladro de 68",
    cantidad: 1,
    precioAcordado: 105690,
    direccion: "cra 92 #78b-02",
    clienteConfirmo: false,
    entregaFutura: false,
  });
  assert.equal(v.ok, false);
  assert.equal(decidir(v).accion, "frenar");
});

// ---------- ejecutarAgente con extractor inyectado (sin LLM) ----------
test("ejecutarAgente decide subir con un extractor que devuelve todo bien", async () => {
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [],
    extraer: async () => ({
      producto: "Taladro Inalambrico 68V",
      cantidad: 1,
      precioAcordado: 84900,
      direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true,
      entregaFutura: false,
      incertidumbre: [],
    }),
  });
  assert.equal(r.accion, "subir");
  assert.equal(r.extraido.cantidad, 1);
});

test("ejecutarAgente frena si el extractor no pudo leer nada", async () => {
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [],
    extraer: async () => ({ incertidumbre: ["sin llave"] }),
  });
  assert.equal(r.accion, "frenar");
  assert.ok(r.problemas.length >= 3);
});

// ---------- resumenDePedido ----------
test("resumenDePedido lee los campos de LucidSales y las lineas de Json", () => {
  const p = {
    id: 3256175,
    idPedido: 88103337,
    Nombre: "Ana",
    Apellido: "Gomez",
    Movil: "+573001234567",
    Direccion: "Carrera 92 #78b-02",
    Referencias: "Porton azul",
    Total: "105.690",
    SubTotal: "84.900",
    CostoEnvio: "20.790,5",
    Json: JSON.stringify([{ product_id: "40242", name: "Taladro Inalambrico 68V", price: "84.900", quantity: 1 }]),
  };
  const r = resumenDePedido(p);
  assert.equal(r.cliente, "Ana Gomez");
  assert.equal(r.telefono, "+573001234567");
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].nombre, "Taladro Inalambrico 68V");
  assert.equal(r.productos[0].precio, 84900);
});

test("resumenDePedido tolera Json vacio o roto", () => {
  assert.deepEqual(resumenDePedido({ Total: "0" }).productos, []);
  assert.deepEqual(resumenDePedido({ Json: "no es json" }).productos, []);
});

test("cada verificacion lleva la cita del chat que dio la IA", async () => {
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [],
    extraer: async () => ({
      producto: "Taladro Inalambrico 68V",
      cantidad: 1,
      precioAcordado: 84900,
      direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true,
      entregaFutura: false,
      incertidumbre: [],
      evidencia: { precioAcordado: "BOT: queda en 84.900", clienteConfirmo: "CLIENTE: confirmo" },
    }),
  });
  const porCampo = Object.fromEntries(r.validacion.checks.map((c) => [c.campo, c]));
  assert.equal(porCampo.precio.evidencia, "BOT: queda en 84.900");
  assert.equal(porCampo.confirmacion.evidencia, "CLIENTE: confirmo");
  assert.equal(porCampo.direccion.evidencia, undefined);
  assert.equal(r.accion, "subir"); // la evidencia no cambia la decision
});

test("direccion del chat con ciudad y barrio antes coincide si la calle y los numeros son iguales", () => {
  assert.equal(
    coincideDireccion("Cundinamarca Bogotá Villa Andrea Kennedy Calle 51B Sur #82 C19 urbanización de casas", "Calle 51B Sur #82 C19, urbanización de casas").ok,
    true,
  );
  assert.equal(coincideDireccion("Kennedy Calle 51B Sur #82 C18", "Calle 51B Sur #82 C19").ok, false);
});
