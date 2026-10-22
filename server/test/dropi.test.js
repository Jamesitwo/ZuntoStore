// Pruebas del cliente de Dropi: armado del payload y sus validaciones.
//   node --test   (o npm test dentro de server/)
//
// No hay red: se prueba que el payload sale con el formato exacto que exige
// Dropi (saveOrderV2) y con `insurance` = el seguro antidevoluciones.
import test from "node:test";
import assert from "node:assert/strict";
import { armarPedidoDropi, validarPayloadDropi, CAMPOS_OBLIGATORIOS } from "../dropi.js";

const RESUMEN = {
  id: "3256175",
  idPedido: "88103337",
  cliente: "Ana Gomez",
  telefono: "573009998877",
  direccion: "Carrera 92 #78b-02",
  referencias: "Porton azul",
  ciudad: "Medellin",
  departamento: "Antioquia",
  total: "105.690",
  subtotal: "84.900",
  costoEnvio: "20.790,5",
  productos: [{ id: "40242", nombre: "Taladro 68V", cantidad: 1, precio: 84900 }],
};

const OPCIONES = {
  userId: 111111,
  supplierId: 222222,
  shopId: 333333,
  warehouseId: 444444,
  rateType: "CON RECAUDO",
  insurance: true,
  shippingAmount: 25756.335,
  distributionCompany: { id: 5, name: "COORDINADORA" },
  typeService: "normal",
  productos: [
    {
      idDropi: 2291039,
      name: "OIL OF OREGANO",
      weight: "10.00",
      stock: 345,
      userId: 222222,
      salePrice: "13990.00",
      suggestedPrice: "13990.00",
      price: 139900,
      quantity: 1,
    },
  ],
};

test("armarPedidoDropi manda insurance:true (seguro antidevoluciones)", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  assert.equal(p.insurance, true);
  assert.equal(p.type, "FINAL_ORDER");
  assert.equal(p.user_id, 111111);
  assert.equal(p.supplier_id, 222222);
  assert.equal(p.distributionCompany.id, 5);
  assert.equal(p.type_service, "normal");
});

test("armarPedidoDropi separa nombre y apellido", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  assert.equal(p.name, "Ana");
  assert.equal(p.surname, "Gomez");
  assert.equal(p.dir, "Carrera 92 #78b-02");
  assert.equal(p.city, "Medellin");
  assert.equal(p.state, "Antioquia");
  assert.equal(p.phone, "573009998877");
});

test("armarPedidoDropi arma los productos con los ids de Dropi", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  assert.equal(p.products.length, 1);
  assert.equal(p.products[0].id, 2291039);
  assert.equal(p.products[0].quantity, 1);
  assert.equal(p.products[0].price, 139900);
  assert.equal(p.products[0].type, "SIMPLE");
});

test("armarPedidoDropi sin opciones deja insurance en false", () => {
  const p = armarPedidoDropi(RESUMEN, { ...OPCIONES, insurance: undefined });
  assert.equal(p.insurance, false);
});

test("armarPedidoDropi entiende el punto de miles colombiano", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  assert.equal(p.total_order, 105690);
  assert.equal(p.shipping_amount, 25756.335);
  assert.equal(p.products[0].price, 139900);
  assert.equal(p.products[0].sale_price, "13990.00");
});

test("validarPayloadDropi pasa con un payload completo", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  assert.equal(validarPayloadDropi(p), null);
});

test("validarPayloadDropi senala el campo que falta", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  delete p.phone;
  const err = validarPayloadDropi(p);
  assert.match(err, /"phone" es obligatorio/);
});

test("validarPayloadDropi exige al menos un producto", () => {
  const p = armarPedidoDropi(RESUMEN, { ...OPCIONES, productos: [] });
  p.products = [];
  assert.match(validarPayloadDropi(p), /al menos un producto/);
});

test("todos los campos obligatorios de Dropi estan en el mapa", () => {
  const p = armarPedidoDropi(RESUMEN, OPCIONES);
  for (const campo of CAMPOS_OBLIGATORIOS) {
    assert.ok(campo in p, `falta el campo ${campo} en el payload`);
    assert.ok(p[campo], `el campo ${campo} quedo vacio`);
  }
});
