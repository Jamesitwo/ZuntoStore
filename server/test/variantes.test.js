import test from "node:test";
import assert from "node:assert/strict";
import { varianteDeProducto } from "../variantes.js";

const PRODUCTO = {
  variantes: [
    { nombre: "Copa", opciones: [{ nombre: "Verde" }, { nombre: "Blanca" }] },
    { nombre: "Tamaño", opciones: [{ nombre: "90 cm " }, { nombre: "150 cm" }] },
  ],
  mixedvariantes: [
    { items: ["Verde", "150 cm"], sku: "rYacS9KQpVTd" },
    { items: ["Blanca", "90 cm "], sku: "Y-zn02b2AkEM" },
    { items: ["Blanca", "150 cm"], sku: "aDdrTlqORRFZ" },
  ],
  bundleVariantes: [
    {
      variantes: [
        { items: ["Verde", "150 cm"], idVarianteDropi: "1837486", stock: 179 },
        { items: ["Blanca", "90 cm "], idVarianteDropi: null },
        { items: ["Blanca", "150 cm"], idVarianteDropi: "1837487", stock: 227 },
      ],
    },
  ],
};

test("variante de la linea -> nombre e id de Dropi", () => {
  assert.deepEqual(varianteDeProducto(PRODUCTO, "aDdrTlqORRFZ"), {
    id: "aDdrTlqORRFZ",
    items: ["Blanca", "150 cm"],
    nombre: "Copa: Blanca; Tamaño: 150 cm",
    idVarianteDropi: "1837487",
    stock: 227,
  });
});

test("variante sin vincular a Dropi y variante desconocida", () => {
  assert.equal(varianteDeProducto(PRODUCTO, "Y-zn02b2AkEM").idVarianteDropi, null);
  assert.equal(varianteDeProducto(PRODUCTO, "nada"), null);
});
