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
  textoVariantes,
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

test("pedido repetido: sin segunda compra en el chat se frena por duplicado", async () => {
  const base = { producto: "Taladro", cantidad: 1, precioAcordado: 100000, direccion: "Calle 10 # 5-20", clienteConfirmo: true, entregaFutura: false, incertidumbre: [] };
  const resumen = { productos: [{ id: "1", nombre: "Taladro", cantidad: 1, precio: 100000 }], total: "100000", direccion: "Calle 10 # 5-20", estadoPedido: 0 };
  let contexto = null;
  const r = await ejecutarAgente({
    resumen,
    mensajes: [{ de: "cliente", texto: "quiero el taladro" }],
    extraer: async (_m, ctx) => ((contexto = ctx), { ...base, segundaCompra: false }),
    otrosPedidos: [{ id: 9, idPedido: 6105, producto: "Taladro", Total: "100000", subido: true }],
  });
  assert.match(contexto.otrosPedidos, /#6105.*YA se subio/);
  const dup = r.validacion.checks.find((c) => c.campo === "duplicado");
  assert.equal(dup.ok, false);
  assert.match(dup.detalle, /#6105/);
  // sin otros pedidos no hay chequeo de duplicado
  const r2 = await ejecutarAgente({ resumen, mensajes: [], extraer: async () => base });
  assert.equal(r2.validacion.checks.some((c) => c.campo === "duplicado"), false);
});

// ---------- corregimientos ----------
const EXTRAIDO_BIEN = {
  producto: "Taladro Inalambrico 68V",
  cantidad: 1,
  precioAcordado: 84900,
  direccion: "Carrera 92 #78b-02",
  clienteConfirmo: true,
  entregaFutura: false,
  incertidumbre: [],
};

test("corregimiento con nombre: sube y deja el corregimiento para buscarlo en Dropi", async () => {
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [{ de: "cliente", texto: "vivo en el corregimiento de Rozo" }],
    extraer: async () => ({ ...EXTRAIDO_BIEN, corregimiento: "Rozo" }),
  });
  assert.equal(r.accion, "subir");
  assert.equal(r.extraido.corregimiento, "Rozo");
  const ch = r.validacion.checks.find((c) => c.campo === "corregimiento");
  assert.equal(ch.ok, true);
  assert.match(ch.detalle, /Rozo/);
});

test("dijo que vive en un corregimiento pero no se sabe cual: frena", async () => {
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [{ de: "cliente", texto: "es en un corregimiento cerca" }],
    extraer: async () => ({ ...EXTRAIDO_BIEN, corregimiento: "" }),
  });
  assert.equal(r.accion, "frenar");
  assert.deepEqual(r.problemas.map((p) => p.campo), ["corregimiento"]);
});

test("sin corregimiento no aparece la verificacion", async () => {
  const r = await ejecutarAgente({ resumen: RESUMEN, mensajes: [], extraer: async () => EXTRAIDO_BIEN });
  assert.equal(r.validacion.checks.some((c) => c.campo === "corregimiento"), false);
});

// ---------- entrega futura vs tiempo normal de envio ----------
test("fecha pedida dentro del tiempo de envio: no es entrega futura, se sube ya", async () => {
  const { hoyColombia, sumarDias } = await import("../fechaEntrega.js");
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [],
    diasEntrega: 5,
    extraer: async () => ({ ...EXTRAIDO_BIEN, entregaFutura: true, fechaEntregaSolicitada: "el jueves", fechaEntregaISO: sumarDias(hoyColombia(), 3) }),
  });
  assert.equal(r.accion, "subir");
  assert.equal(r.entrega, null);
  assert.match(r.validacion.checks.find((c) => c.campo === "entregaFutura").detalle, /dentro del tiempo normal de envío/);
});

test("fecha pedida mas alla del tiempo de envio: es entrega futura", async () => {
  const { hoyColombia, sumarDias } = await import("../fechaEntrega.js");
  const fecha = sumarDias(hoyColombia(), 9);
  const r = await ejecutarAgente({
    resumen: RESUMEN,
    mensajes: [],
    diasEntrega: 5,
    extraer: async () => ({ ...EXTRAIDO_BIEN, entregaFutura: true, fechaEntregaSolicitada: "en 9 dias", fechaEntregaISO: fecha }),
  });
  assert.equal(r.accion, "frenar");
  assert.equal(r.entrega.fecha, fecha);
});

test("producto con variantes: precio y cantidad salen de la variante", () => {
  const r = resumenDePedido({
    id: 7,
    Json: JSON.stringify([{ product_id: "87498", price: null, quantity: null, variations: [{ variation_id: "aDdr", price: 116900, quantity: 2 }] }]),
    producto: "Arbol De Navidad Plegable",
    Observaciones: JSON.stringify([{ desc: "Pedido creado por api" }, { desc: "2 x Árbol De Navidad Plegable - Copa: Blanca; Tamaño: 150 cm" }]),
    Total: "233800.00",
  });
  assert.deepEqual(r.productos, [
    { id: "87498", nombre: "Arbol De Navidad Plegable", cantidad: 2, precio: 116900, variante: { id: "aDdr", nombre: "Copa: Blanca; Tamaño: 150 cm" } },
  ]);
  assert.equal(textoVariantes(r), "2 x Copa: Blanca; Tamaño: 150 cm");
});

test("direccion: el chat trae nombre, barrio, ciudad y telefono de mas; el barrio esta en las referencias", () => {
  const chat = "Luis Arturo Arango manzana B casa 9 etapa 3 barrio el bunde Ibagué tolima, tel . 3151151258";
  assert.equal(coincideDireccion(chat, "Manzana B casa 9 etapa 3", { referencias: "El Bunde" }).ok, true);
  assert.equal(coincideDireccion(chat, "Manzana B casa 9 etapa 3").ok, true);
  // otro numero de casa no coincide
  assert.equal(coincideDireccion(chat, "Manzana B casa 8 etapa 3", { referencias: "El Bunde" }).ok, false);
  // otra manzana tampoco
  assert.equal(coincideDireccion(chat, "Manzana C casa 9 etapa 3", { referencias: "El Bunde" }).ok, false);
});

test("numero pegado («#3021»): no se frena aqui, el mapa decide como se separa", async () => {
  const r = await ejecutarAgente({
    resumen: { ...RESUMEN, direccion: "Carrera 110AA #3021, Primer piso, Barrio Nuevo" },
    mensajes: [],
    extraer: async () => ({ ...EXTRAIDO_BIEN, direccion: "Carrera 110AA #3021, Primer piso, Barrio Nuevo" }),
  });
  const ch = r.validacion.checks.find((c) => c.campo === "direccionValida");
  assert.equal(ch.ok, true);
  assert.match(ch.detalle, /número viene pegado.*Cra 110AA # 30-21/);
  assert.equal(r.direccionEnvio.numeroPegado, true);
  assert.equal(r.direccionInvalida, false);
});
