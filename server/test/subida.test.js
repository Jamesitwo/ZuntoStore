// Pruebas del motor de subida automatica a Dropi.
//   node --test   (o npm test dentro de server/)
//
// Sin red ni navegador: cliente, conversacion y navegador van inyectados.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearRegistroIntentos } from "../registroIntentos.js";
import { crearSubidaAutomatica, otrosPedidosDelCliente } from "../subidaAutomatica.js";

/** Cliente de LucidSales falso. */
function clienteFalso(pedidos) {
  return {
    async listarPedidos() {
      return { pedidos };
    },
    async obtenerPedido(id) {
      const p = pedidos.find((x) => String(x.id) === String(id));
      if (!p) throw new Error("no existe");
      return p.completo;
    },
  };
}

function armar(overrides = {}) {
  const ruta = path.join(os.tmpdir(), `subida-${Date.now()}-${Math.random()}.json`);
  const subidos = [];
  const conv = {
    porPedido(id) {
      return overrides.sinConversacion
        ? null
        : {
            mensajes: [
              { de: "cliente", texto: "quiero el taladro de 68v", ts: "2026-10-20T10:00:00" },
              { de: "bot", texto: "queda en 105.690 con envio", ts: "2026-10-20T10:01:00" },
              { de: "cliente", texto: "confirmo, a la Carrera 92 #78b-02", ts: "2026-10-20T10:02:00" },
            ],
          };
    },
  };
  const dropiNav = {
    async subirPedido(datos) {
      subidos.push(datos);
      if (overrides.respuestaDropi) return overrides.respuestaDropi(datos);
      return { ok: true, creado: !datos.soloPreparar, preparado: !!datos.soloPreparar, seguro: true };
    },
  };
  const s = crearSubidaAutomatica({
    cliente: overrides.cliente ?? clienteFalso(overrides.pedidos ?? []),
    conversacion: conv,
    extraer: async () => overrides.extraerFalla ? { incertidumbre: ["x"], falloTecnico: "la IA no respondió en 90 s" } : (overrides.alExtraer?.(), overrides.extraido ?? {
      producto: "Taladro Inalambrico 68V",
      cantidad: 1,
      precioAcordado: 105690,
      direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true,
      entregaFutura: false,
      incertidumbre: [],
    }),
    dropiNav,
    lucidBotContactos: overrides.lucidBotContactos,
    config: { LUCID_TIENDA: "3682" },
    ruta,
    log: { log() {}, warn() {} },
    resolverUbicacion: overrides.resolverUbicacion,
    // por defecto devuelve un link falso (asi los tests que no lo definen no
    // se frenan por falta de producto)
    resolverProductoDropi:
      overrides.resolverProductoDropi ?? (async (id) => `https://dropi.test/${id}`),
    validadorDireccion: overrides.validadorDireccion,
    buscarOficinasInter: overrides.buscarOficinasInter,
    intentos: overrides.intentos,
    programados: overrides.programados,
  });
  // tienda de Dropi configurada por defecto (salvo que la prueba la quite)
  if (overrides.tiendasDropi !== null) {
    s.configurar({ tiendasDropi: overrides.tiendasDropi ?? { 3682: "Pizdo Store" } });
    s.detener();
  }
  return { s, ruta, subidos };
}

const COMPLETO = {
  id: 1,
  idPedido: 111,
  EstadoPedido: 0,
  Nombre: "Ana",
  Apellido: "Gomez",
  Movil: "+573009998877",
  Direccion: "Carrera 92 #78b-02",
  Departamento: "Antioquia",
  Ciudad: "Medellin",
  Total: "105.690",
  SubTotal: "84.900",
  CostoEnvio: "20.790,5",
  Json: JSON.stringify([{ product_id: "2291039", name: "Taladro Inalambrico 68V", price: "84.900", quantity: 1 }]),
};

test("configurar guarda y se lee de vuelta", () => {
  const { s, ruta } = armar();
  const c = s.configurar({ automatico: true, cadaSegundos: 60, dryRun: false, transportadoraId: 5 });
  assert.equal(c.automatico, true);
  assert.equal(c.cadaSegundos, 60);
  assert.equal(c.dryRun, false);
  assert.equal(s.config().transportadoraId, 5);
  fs.rmSync(ruta, { force: true });
});

test("tick no hace nada si esta apagado", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  const r = await s.tick();
  assert.equal(r.saltado, "desactivado");
  assert.equal(subidos.length, 0);
  fs.rmSync(ruta, { force: true });
});

test("tick con forzar lo ejecuta aunque este apagado", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  s.configurar({ automatico: true, dryRun: true });
  const r = await s.tick({ forzar: true });
  assert.equal(r.ok, true);
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].seguro, true);
  fs.rmSync(ruta, { force: true });
});

test("oficina de Inter Rapidísimo: queda para un humano, sin chat ni IA ni reintentos", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 12, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Oficina Inter Rapidísimo, Medellín" } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "requiere-humano");
  assert.match(s.ultimos(5)[0].detalle, /recoge en oficina de Inter Rapidísimo/i);
  fs.rmSync(ruta, { force: true });
});

test("oficina de Coordinadora: queda para un humano, sin chat ni IA ni reintentos", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 13, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "RECOGER EN OFICINA COORDINADORA" } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "requiere-humano");
  assert.match(s.ultimos(5)[0].detalle, /recoge en oficina de Coordinadora/i);
  fs.rmSync(ruta, { force: true });
});

test("tick no repite un pedido ya subido", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 2, completo: { ...COMPLETO, EstadoPedido: 2 } }],
  });
  s.configurar({ automatico: true, dryRun: false, estados: [2] });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(s.estadoPedido(1).accion, "subido");
  fs.rmSync(ruta, { force: true });
});

test("tick vuelve a revisar los pedidos solo preparados en dryRun", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 2);
  assert.equal(s.estadoPedido(1).accion, "preparado");
  fs.rmSync(ruta, { force: true });
});

test("tick avisa el fallo a Lucid Bot una sola vez aunque reintente", async () => {
  const avisos = [];
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "Dropi rechazo el formulario" }),
    lucidBotContactos: { async notificar(a) { avisos.push(a.resultado); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "error");
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 2); // 2 intentos y se detiene
  // el fallo se avisa una vez y luego que quedo para revision
  assert.deepEqual(avisos, ["fallido", "requiere-revision"]);
  assert.equal(s.estadoPedido(1).accion, "requiere-revision");
  fs.rmSync(ruta, { force: true });
});

test("tick avisa el exito aunque antes se haya avisado un fallo", async () => {
  const avisos = [];
  let intento = 0;
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 2, completo: { ...COMPLETO, EstadoPedido: 2 } }],
    respuestaDropi: () =>
      ++intento === 1
        ? { ok: false, creado: false, detalle: "fallo temporal" }
        : { ok: true, creado: true, seguro: true, idDropi: 99 },
    lucidBotContactos: { async notificar(a) { avisos.push(a.resultado); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: false, estados: [2] });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.deepEqual(avisos, ["fallido", "exitoso"]);
  assert.equal(s.estadoPedido(1).accion, "subido");
  fs.rmSync(ruta, { force: true });
});

test("tick corta la vuelta y no avisa al contacto si la sesion de Dropi vencio", async () => {
  const avisos = [];
  const { s, ruta, subidos } = armar({
    pedidos: [
      { id: 1, EstadoPedido: 0, completo: COMPLETO },
      { id: 2, EstadoPedido: 0, completo: { ...COMPLETO, id: 2, idPedido: 222 } },
    ],
    respuestaDropi: () => ({ ok: false, creado: false, requiereLogin: true, detalle: "sesion vencida" }),
    lucidBotContactos: { async notificar(a) { avisos.push(a.resultado); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: false });
  const r = await s.tick({ forzar: true });
  assert.equal(subidos.length, 1); // el segundo pedido ni se intenta
  // ningun aviso de pedido ("fallido"): solo el aviso de sesion al admin
  assert.deepEqual(avisos, ["sesion-vencida"]);
  assert.match(r.detenido, /sesion/i);
  fs.rmSync(ruta, { force: true });
});

test("tick no marca error ni avisa si el navegador esta ocupado", async () => {
  const avisos = [];
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, ocupado: true, detalle: "Ya hay otra subida" }),
    lucidBotContactos: { async notificar(a) { avisos.push(a.resultado); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: false });
  const r = await s.tick({ forzar: true });
  assert.deepEqual(avisos, []);
  assert.equal(s.estadoPedido(1), null);
  assert.match(r.detenido, /ocupado/i);
  fs.rmSync(ruta, { force: true });
});

test("tick marca como pendiente si el bot no mando la conversacion", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 2, EstadoPedido: 0, completo: COMPLETO }],
    sinConversacion: true,
  });
  s.configurar({ automatico: true, dryRun: true });
  const r = await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  const u = s.ultimos(5);
  assert.equal(u[0].accion, "sin-conversacion");
  fs.rmSync(ruta, { force: true });
});

test("tick frena y no sube si la validacion no calza", async () => {
  const { s, ruta, subidos } = armar({
    // el precio del chat no coincide con el Total del pedido
    cliente: clienteFalso([
      { id: 3, EstadoPedido: 0, completo: { ...COMPLETO, Total: "999.999", SubTotal: "999.999" } },
    ]),
  });
  s.configurar({ automatico: true, dryRun: true });
  const r = await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(r.frenados, 1);
  assert.equal(s.ultimos(5)[0].accion, "frenado");
  fs.rmSync(ruta, { force: true });
});

test("tick filtra por los estados configurados", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 4, EstadoPedido: 5, completo: COMPLETO }],
  });
  s.configurar({ automatico: true, dryRun: true, estados: [0] });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  fs.rmSync(ruta, { force: true });
});

test("tick resuelve ciudad/depto a nombres antes de subir", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 5, EstadoPedido: 0, completo: { ...COMPLETO, Departamento: "2", Ciudad: "36", Pais: 47 } }],
    resolverUbicacion: async ({ idDepartamento, idCiudad }) => ({
      departamento: `dep-${idDepartamento}`,
      ciudad: `ciu-${idCiudad}`,
    }),
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].departamento, "dep-2");
  assert.equal(subidos[0].ciudad, "ciu-36");
  fs.rmSync(ruta, { force: true });
});

test("tick frena la subida si no se puede resolver la ubicacion", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 6, EstadoPedido: 0, completo: { ...COMPLETO, Departamento: "2", Ciudad: "36", Pais: 47 } }],
    resolverUbicacion: async () => {
      throw new Error("catalogo caido");
    },
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "error");
  assert.match(s.ultimos(5)[0].detalle, /catalogo caido/);
  fs.rmSync(ruta, { force: true });
});

test("tick resuelve el link de Dropi del producto antes de subir", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 7, EstadoPedido: 0, completo: COMPLETO }],
    resolverProductoDropi: async (idProducto) => `https://dropi.test/producto/${idProducto}`,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  // COMPLETO trae Json con product_id "2291039"
  assert.equal(subidos[0].productoUrl, "https://dropi.test/producto/2291039");
  fs.rmSync(ruta, { force: true });
});

test("tick marca error si el producto no tiene id de Dropi", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 8, EstadoPedido: 0, completo: COMPLETO }],
    resolverProductoDropi: async () => null,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "error");
  fs.rmSync(ruta, { force: true });
});

test("tick frena el pedido sin recaudo (prepago) para que lo suba un humano", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 9, EstadoPedido: 0, completo: { ...COMPLETO, TipoPago: 2 } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "requiere-humano");
  fs.rmSync(ruta, { force: true });
});

test("tick manda cantidad, precio y tipo de pago a la subida", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 10, EstadoPedido: 0, completo: { ...COMPLETO, TipoPago: 1 } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].tipoPago, 1);
  assert.equal(subidos[0].productos[0].cantidad, 1);
  assert.equal(subidos[0].productos[0].precio, 84900); // price "84.900"
  fs.rmSync(ruta, { force: true });
});

test("tick no sube ni gasta el LLM si la tienda no tiene tienda de Dropi", async () => {
  let llamadasLLM = 0;
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    tiendasDropi: null,
    alExtraer: () => llamadasLLM++,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(llamadasLLM, 0);
  assert.equal(s.estadoPedido(1).accion, "sin-tienda-dropi");
  fs.rmSync(ruta, { force: true });
});

test("tick manda la tienda de Dropi configurada para la tienda revisada", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos[0].tienda, "Pizdo Store");
  fs.rmSync(ruta, { force: true });
});

test("tick usa la tienda del propio pedido si trae idEmpresa", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, idEmpresa: 9999 } }],
    tiendasDropi: { 3682: "Pizdo Store", 9999: "Orenar" },
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos[0].tienda, "Orenar");
  fs.rmSync(ruta, { force: true });
});

test("configurar guarda el mapa de tiendas de Dropi y descarta vacias", () => {
  const { s, ruta } = armar({ tiendasDropi: null });
  const c = s.configurar({ tiendasDropi: { 3682: "  Pizdo Store ", 1: "" } });
  s.detener();
  assert.deepEqual(c.tiendasDropi, { 3682: "Pizdo Store" });
  assert.equal(s.tiendaDropiPara(3682), "Pizdo Store");
  assert.equal(s.tiendaDropiPara(1), "");
  fs.rmSync(ruta, { force: true });
});

function armarSesion(respuesta) {
  const avisos = [];
  const estado = { r: respuesta };
  const { s, ruta, subidos } = armar({
    pedidos: [
      { id: 1, EstadoPedido: 0, completo: COMPLETO },
      { id: 2, EstadoPedido: 0, completo: { ...COMPLETO, id: 2, idPedido: 222 } },
    ],
    respuestaDropi: (d) => estado.r(d),
    lucidBotContactos: {
      async notificar(a) {
        avisos.push(a);
        return { ok: true };
      },
    },
  });
  return { s, ruta, subidos, avisos, estado };
}
const VENCIDA = () => ({ ok: false, creado: false, requiereLogin: true, detalle: "sesion vencida" });

test("sesion vencida: avisa al admin una sola vez aunque sigan las vueltas", async () => {
  const { s, ruta, avisos } = armarSesion(VENCIDA);
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].resultado, "sesion-vencida");
  assert.equal(avisos[0].pedido, null); // no es aviso de un pedido
  assert.match(avisos[0].detalle, /al menos 2 pedido/);
  assert.equal(s.sesion().estado, "requiere-login");
  assert.equal(s.sesion().avisado, true);
  fs.rmSync(ruta, { force: true });
});

test("sesion vencida: tambien avisa en modo preparacion", async () => {
  const { s, ruta, avisos } = armarSesion(VENCIDA);
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.deepEqual(avisos.map((a) => a.resultado), ["sesion-vencida"]);
  fs.rmSync(ruta, { force: true });
});

test("sesion vencida: los pedidos quedan pendientes y se suben al volver la sesion", async () => {
  const { s, ruta, subidos, estado } = armarSesion(VENCIDA);
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  estado.r = (d) => ({ ok: true, preparado: !!d.soloPreparar, seguro: true });
  const r = await s.tick({ forzar: true });
  assert.equal(r.subidos, 2); // los dos pendientes
  assert.equal(s.sesion().estado, "ok");
  fs.rmSync(ruta, { force: true });
});

test("sesion vencida: tras restablecerla, una nueva caida vuelve a avisar", async () => {
  const { s, ruta, avisos } = armarSesion(VENCIDA);
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  s.sesionRestablecida("panel");
  await s.tick({ forzar: true });
  assert.equal(avisos.length, 2);
  fs.rmSync(ruta, { force: true });
});

test("captcha: avisa con su propio tipo", async () => {
  const { s, ruta, avisos } = armarSesion(() => ({ ok: false, requiereCaptcha: true, detalle: "captcha" }));
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.deepEqual(avisos.map((a) => a.resultado), ["captcha"]);
  assert.match(avisos[0].detalle, /captcha/i);
  fs.rmSync(ruta, { force: true });
});

test("si el aviso de sesion falla, se reintenta en la siguiente vuelta", async () => {
  const avisos = [];
  let intento = 0;
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: VENCIDA,
    lucidBotContactos: {
      async notificar(a) {
        avisos.push(a.resultado);
        return ++intento === 1 ? { ok: false, detalle: "HTTP 500" } : { ok: true };
      },
    },
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.deepEqual(avisos, ["sesion-vencida", "sesion-vencida"]);
  fs.rmSync(ruta, { force: true });
});

test("sin tiendas marcadas revisa las que tienen tienda de Dropi y consulta con su tienda", async () => {
  const listadas = [];
  const consultas = [];
  const cliente = {
    async listarPedidos({ idEmpresa }) {
      listadas.push(String(idEmpresa));
      return { pedidos: [{ id: 1, EstadoPedido: 0 }] };
    },
    async obtenerPedido(id, tienda) {
      consultas.push(String(tienda));
      return COMPLETO;
    },
  };
  const { s, ruta } = armar({ cliente, tiendasDropi: { 6881: "1928380" } });
  s.configurar({ automatico: true, dryRun: true, tiendas: [] });
  await s.tick({ forzar: true });
  assert.deepEqual(listadas, ["6881"]); // no la 3682 de LUCID_TIENDA
  assert.ok(consultas.length && consultas.every((t) => t === "6881"));
  fs.rmSync(ruta, { force: true });
});

test("el registro guarda telefono, nombre y el analisis con la evidencia del chat", async () => {
  const { s, ruta } = armar({
    cliente: clienteFalso([
      { id: 3, EstadoPedido: 0, Movil: "+573009998877", completo: { ...COMPLETO, Total: "999.999", SubTotal: "999.999" } },
    ]),
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  const u = s.ultimos(5)[0];
  assert.equal(u.accion, "frenado");
  assert.match(u.detalle, /^\[intento 1 de 2\] precio: /); // explica, no solo nombra el campo
  assert.equal(u.cliente.telefono, "+573009998877");
  assert.equal(u.cliente.nombre, "Ana Gomez");
  const precio = u.analisis.checks.find((c) => c.campo === "precio");
  assert.equal(precio.ok, false);
  assert.equal(u.analisis.extraido.precioAcordado, 105690);
  assert.equal(u.analisis.checks.length, 8);
  fs.rmSync(ruta, { force: true });
});

test("sin conversacion igual guarda el telefono para abrir el chat", async () => {
  const { s, ruta } = armar({
    pedidos: [{ id: 2, EstadoPedido: 0, completo: COMPLETO }],
    sinConversacion: true,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  const u = s.ultimos(5)[0];
  assert.equal(u.accion, "sin-conversacion");
  assert.equal(u.cliente.telefono, "+573009998877");
  assert.equal(u.analisis, undefined);
  fs.rmSync(ruta, { force: true });
});

test("tras 2 intentos fallidos pasa a revision, explica el motivo y ya no se toca", async () => {
  let llamadasLLM = 0;
  const { s, ruta } = armar({
    cliente: clienteFalso([
      { id: 3, EstadoPedido: 0, completo: { ...COMPLETO, Total: "999.999", SubTotal: "999.999" } },
    ]),
    alExtraer: () => llamadasLLM++,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(3).accion, "frenado");
  const r2 = await s.tick({ forzar: true });
  assert.equal(r2.revision, 1);
  const u = s.estadoPedido(3);
  assert.equal(u.accion, "requiere-revision");
  assert.equal(u.intentos, 2);
  assert.match(u.detalle, /No se subió tras 2 intento\(s\).*\(frenado\): precio/);
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(llamadasLLM, 2); // ni una llamada mas a la IA
  fs.rmSync(ruta, { force: true });
});

test("los problemas de sesion no gastan intentos del pedido", async () => {
  let n = 0;
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => (++n <= 3 ? { ok: false, requiereLogin: true, detalle: "vencida" } : { ok: false, creado: false, detalle: "error real" }),
  });
  s.configurar({ automatico: true, dryRun: false });
  for (let i = 0; i < 3; i++) await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "requiere-login");
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "error"); // primer intento real
  assert.equal(s.estadoPedido(1).intentos, 1);
  fs.rmSync(ruta, { force: true });
});

test("el limite se puede configurar", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false, maxIntentos: 1 });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(s.estadoPedido(1).accion, "requiere-revision");
  fs.rmSync(ruta, { force: true });
});

test("reintentar un pedido en revision lo vuelve a intentar desde cero", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "requiere-revision");
  assert.deepEqual(s.rearmar(1), { ok: true, id: "1" }); // sin confirmacion extra
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 3);
  assert.equal(s.estadoPedido(1).intentos, 1);
  fs.rmSync(ruta, { force: true });
});

test("reintentar todos los que estan en revision", async () => {
  const { s, ruta } = armar({
    pedidos: [
      { id: 1, EstadoPedido: 0, completo: COMPLETO },
      { id: 2, EstadoPedido: 0, completo: { ...COMPLETO, id: 2 } },
    ],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false, maxIntentos: 1 });
  await s.tick({ forzar: true });
  assert.equal(s.ultimos(5).filter((u) => u.accion === "requiere-revision").length, 2);
  assert.deepEqual(s.rearmarRevision(), { ok: true, rearmados: 2 });
  assert.equal(s.estadoPedido(1), null);
  fs.rmSync(ruta, { force: true });
});

test("prepago queda para un humano sin llamar a la IA ni reintentar", async () => {
  let llamadasLLM = 0;
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, TipoPago: 2 } }],
    alExtraer: () => llamadasLLM++,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(llamadasLLM, 0);
  assert.equal(subidos.length, 0);
  assert.equal(s.estadoPedido(1).accion, "requiere-humano");
  fs.rmSync(ruta, { force: true });
});

test("si muchos pasan a revision a la vez, llega un solo aviso resumen", async () => {
  const avisos = [];
  const pedidos = [1, 2, 3, 4, 5].map((n) => ({ id: n, EstadoPedido: 0, completo: { ...COMPLETO, id: n } }));
  const { s, ruta } = armar({
    pedidos,
    sinConversacion: true,
    lucidBotContactos: { async notificar(a) { avisos.push(a); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  const r = await s.tick({ forzar: true });
  assert.equal(r.revision, 5);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].pedido, null);
  assert.match(avisos[0].detalle, /5 pedidos pasaron a revisión.*sin-conversacion.*#1, #2/);
  await s.tick({ forzar: true });
  assert.equal(avisos.length, 1); // y no se repite
  fs.rmSync(ruta, { force: true });
});

test("direccion descriptiva: no se sube, queda marcada y se avisa", async () => {
  const avisos = [];
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "casa verde al lado de la panaderia pedro" } }],
    lucidBotContactos: { async notificar(a) { avisos.push(a.resultado); return { ok: true }; } },
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  const u = s.estadoPedido(1);
  assert.equal(u.accion, "direccion-invalida");
  assert.match(u.detalle, /direccionValida: no es una dirección con nomenclatura/);
  assert.deepEqual(avisos, ["direccion-invalida"]); // una vez, y ya no se reintenta
  assert.deepEqual(s.rearmarRevision(), { ok: true, rearmados: 1 }); // se puede reintentar
  fs.rmSync(ruta, { force: true });
});

test("a Dropi va la direccion normalizada", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "carrera 92#78b-02" } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(subidos[0].direccion, "Cra 92 # 78B-02");
  fs.rmSync(ruta, { force: true });
});

test("si la IA no responde, el pedido queda como error de la IA (no frenado)", async () => {
  const { s, ruta, subidos } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }] });
  // extractor que simula un timeout
  s.configurar({ automatico: true, dryRun: true });
  const original = armar;
  fs.rmSync(ruta, { force: true });
  const { s: s2, ruta: ruta2 } = original({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    extraerFalla: true,
  });
  s2.configurar({ automatico: true, dryRun: true });
  await s2.tick({ forzar: true });
  const u = s2.estadoPedido(1);
  assert.equal(u.accion, "error");
  assert.match(u.detalle, /la IA no pudo leer el chat: la IA no respondió/);
  assert.equal(subidos.length, 0);
  fs.rmSync(ruta2, { force: true });
});

test("oficina sin conversacion: igual queda para un humano (no 'sin-conversacion')", async () => {
  let llamadasLLM = 0;
  const { s, ruta } = armar({
    pedidos: [{ id: 5, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Calle 10", Referencias: "recoger en oficina inter" } }],
    sinConversacion: true,
    alExtraer: () => llamadasLLM++,
  });
  s.configurar({ automatico: true, dryRun: true });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(5).accion, "requiere-humano");
  assert.equal(llamadasLLM, 0);
  fs.rmSync(ruta, { force: true });
});

// ---------------------------------------------------------------------------
// Envio: transportadoras por producto, tope de flete y oficina de Inter

test("el intervalo se puede subir hasta 12 horas (y no mas)", () => {
  const { s, ruta } = armar();
  assert.equal(s.configurar({ cadaSegundos: 43200 }).cadaSegundos, 43200);
  assert.equal(s.configurar({ cadaSegundos: 99999 }).cadaSegundos, 43200);
  assert.equal(s.configurar({ cadaSegundos: 5 }).cadaSegundos, 30);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("se mandan las transportadoras en orden y el tope (el menor de pesos y %)", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  s.configurar({
    automatico: true,
    dryRun: true,
    transportadoras: [5, 3],
    envio: { maxPesos: 30000, maxPorcentaje: 20 },
  });
  s.detener();
  await s.tick({ forzar: true });
  assert.deepEqual(subidos[0].transportadoras, [5, 3]);
  // 20% de 105.690 = 21.138 (< 30.000)
  assert.equal(subidos[0].maxEnvio, 21138);
  assert.equal(subidos[0].oficinaInter, false);
  fs.rmSync(ruta, { force: true });
});

test("la regla del producto manda sobre la general", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
  });
  s.configurar({
    automatico: true,
    dryRun: true,
    transportadoras: [5],
    envio: { maxPesos: 30000, maxPorcentaje: null },
    reglasProducto: { 2291039: { nombre: "Taladro", transportadoras: [3, 5], maxPesos: 15000 } },
  });
  s.detener();
  await s.tick({ forzar: true });
  assert.deepEqual(subidos[0].transportadoras, [3, 5]);
  assert.equal(subidos[0].maxEnvio, 15000);
  fs.rmSync(ruta, { force: true });
});

test("reglas invalidas o vacias se descartan; transportadora vacia no se acepta", () => {
  const { s, ruta } = armar();
  const c = s.configurar({
    reglasProducto: {
      abc: { transportadoras: [5] },
      77: { transportadoras: [999] },
      88: { maxPorcentaje: 150 },
      99: { maxPorcentaje: 25, transportadoras: [3, 3, 5] },
    },
  });
  assert.deepEqual(Object.keys(c.reglasProducto), ["99"]);
  assert.deepEqual(c.reglasProducto["99"].transportadoras, [3, 5]);
  assert.throws(() => s.configurar({ transportadoras: [] }), /al menos una/);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("envio caro: no se sube, queda marcado, se avisa y se puede reintentar", async () => {
  const avisos = [];
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    lucidBotContactos: { notificar: async (x) => (avisos.push(x), { ok: true }) },
    respuestaDropi: () => ({
      ok: false,
      creado: false,
      envioCaro: true,
      detalle: "Envío demasiado caro, no se creó el pedido (Coordinadora: envío $25.000 supera el tope de $21.138).",
    }),
  });
  s.configurar({ automatico: true, dryRun: false, envio: { maxPorcentaje: 20 } });
  s.detener();
  await s.tick({ forzar: true });
  await s.tick({ forzar: true }); // final: no se vuelve a intentar
  const u = s.ultimos(5)[0];
  assert.equal(u.accion, "envio-caro");
  assert.match(u.detalle, /tope: 20% de \$105\.690/);
  assert.equal(avisos.length, 1);
  assert.equal(s.rearmarRevision().rearmados, 1);
  fs.rmSync(ruta, { force: true });
});

test("oficina de Inter encendida pero el chat no dice oficina: se frena", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 12, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Oficina Interrapidisimo Sincelejo" } }],
  });
  s.configurar({ automatico: true, dryRun: true, oficinaInter: true, transportadoras: [5] });
  s.detener();
  await s.tick({ forzar: true });
  // el extractor falso devuelve "Carrera 92..." como direccion del chat: el
  // agente lo frena porque el chat no dice oficina
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "frenado");
  assert.match(s.ultimos(5)[0].detalle, /oficina de Inter Rapidísimo/);
  fs.rmSync(ruta, { force: true });
});

test("varias oficinas de Inter: queda para una persona", async () => {
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({
      ok: false,
      creado: false,
      oficinaHumano: true,
      oficinas: ["A", "B"],
      detalle: "Hay 2 oficinas de Interrapidísimo para esta ciudad (A | B): la elige una persona.",
    }),
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(s.ultimos(5)[0].accion, "requiere-humano");
  assert.match(s.ultimos(5)[0].detalle, /2 oficinas/);
  fs.rmSync(ruta, { force: true });
});

test("oficina de Inter con la opcion encendida: va por Inter y sin validar calle", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 12, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Oficina Interrapidisimo Sincelejo" } }],
    extraido: {
      producto: "Taladro Inalambrico 68V",
      cantidad: 1,
      precioAcordado: 105690,
      direccion: "la recojo en la oficina de interrapidisimo de Sincelejo",
      clienteConfirmo: true,
      entregaFutura: false,
      incertidumbre: [],
    },
  });
  s.configurar({ automatico: true, dryRun: true, oficinaInter: true, transportadoras: [5] });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1, s.ultimos(5)[0]?.detalle);
  assert.deepEqual(subidos[0].transportadoras, [3]);
  assert.equal(subidos[0].oficinaInter, true);
  assert.equal(subidos[0].direccion, "Oficina Interrapidisimo Sincelejo");
  fs.rmSync(ruta, { force: true });
});

test("oficina de Coordinadora sigue siendo siempre para una persona", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 13, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Oficina Coordinadora Monteria" } }],
  });
  s.configurar({ automatico: true, dryRun: true, oficinaInter: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.ultimos(5)[0].accion, "requiere-humano");
  fs.rmSync(ruta, { force: true });
});

// ---------------------------------------------------------------------------
// Calificacion de la direccion (validador propio) antes de subir

const validadorFalso = (resultado, llamadas = []) => ({
  async validar(x) {
    llamadas.push(x);
    return resultado;
  },
});
const nota = (puntos, verificada = true) => ({ puntos, verificada, partes: [] });

test("direccion con calificacion baja: no se sube y queda con la nota en el analisis", async () => {
  const llamadas = [];
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    validadorDireccion: validadorFalso(
      { veredicto: "revisar", resumen: "Formato válido, pero Google encontró solo la calle", avisos: [], calificacion: nota(65), mapa: { veredicto: "aproximada" } },
      llamadas,
    ),
  });
  s.configurar({ automatico: true, dryRun: true, minCalificacionDireccion: 70 });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  const u = s.ultimos(5)[0];
  assert.equal(u.accion, "direccion-invalida");
  assert.match(u.detalle, /calificación 65\/100 \(mínimo 70\)/);
  const check = u.analisis.checks.find((c) => c.campo === "direccionMapa");
  assert.equal(check.ok, false);
  assert.equal(llamadas[0].ciudad, "Medellin");
  fs.rmSync(ruta, { force: true });
});

test("direccion con buena calificacion: se sube con la direccion que confirmo el mapa", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    validadorDireccion: validadorFalso({
      veredicto: "valida",
      resumen: "La dirección tiene buen formato y existe en el mapa.",
      avisos: [],
      sugerida: "Cra 92 # 78B-02, Robledo",
      calificacion: nota(100),
      mapa: { veredicto: "exacta", mapa: "https://www.google.com/maps/search/?api=1&query=6,-75", formateada: "Cra. 92 #78b-02" },
    }),
  });
  s.configurar({ automatico: true, dryRun: true, minCalificacionDireccion: 70 });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].direccion, "Cra 92 # 78B-02, Robledo");
  const check = s.ultimos(5)[0].analisis.checks.find((c) => c.campo === "direccionMapa");
  assert.equal(check.ok, true);
  assert.match(check.evidencia, /google\.com\/maps/);
  fs.rmSync(ruta, { force: true });
});

test("sin verificar en el mapa (sin key): no frena, se sube con el formato", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    validadorDireccion: validadorFalso({ veredicto: "revisar", resumen: "x", avisos: [], calificacion: nota(50, false), mapa: null }),
  });
  s.configurar({ automatico: true, dryRun: true, minCalificacionDireccion: 70 });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.match(s.ultimos(5)[0].analisis.checks.find((c) => c.campo === "direccionMapa").detalle, /sin verificar/);
  fs.rmSync(ruta, { force: true });
});

test("minimo 0 apaga la calificacion (no se consulta el mapa)", async () => {
  const llamadas = [];
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    validadorDireccion: validadorFalso({ calificacion: nota(0) }, llamadas),
  });
  s.configurar({ automatico: true, dryRun: true, minCalificacionDireccion: 0 });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(llamadas.length, 0);
  fs.rmSync(ruta, { force: true });
});

test("a Dropi va la direccion, coma y las referencias del pedido", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, Referencias: "Barrio Robledo, casa de rejas blancas" } }],
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].direccion, "Cra 92 # 78B-02, Barrio Robledo, casa de rejas blancas");
  fs.rmSync(ruta, { force: true });
});

// ---------------------------------------------------------------------------
// Direccion que en realidad es una oficina de Interrapidisimo

test("la direccion es una oficina de Inter: va por Inter a ESA oficina", async () => {
  const consultas = [];
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: { ...COMPLETO, Direccion: "Calle 30A # 65B-59" } }],
    extraido: {
      producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690,
      direccion: "Calle 30A # 65B-59", clienteConfirmo: true, entregaFutura: false, incertidumbre: [],
    },
    buscarOficinasInter: async (x) => {
      consultas.push(x);
      return { oficinas: [{ nombre: "COL/MEDELLIN/ANT/COL/OF. PRINC CL 30 A 65 B 59", direccion: "OF. PRINC CL 30 A 65 B 59" }] };
    },
  });
  s.configurar({ automatico: true, dryRun: true, transportadoras: [5] });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1, s.ultimos(5)[0]?.detalle);
  assert.deepEqual(subidos[0].transportadoras, [3]);
  assert.equal(subidos[0].oficinaInter, true);
  assert.equal(subidos[0].oficinaObjetivo, "OF. PRINC CL 30 A 65 B 59");
  // en Dropi la direccion queda "Oficina Interrapidisimo" para que salga la lista
  assert.equal(subidos[0].direccion, "Oficina Interrapidisimo");
  assert.equal(consultas[0].ciudad, "Medellin");
  assert.match(s.ultimos(5)[0].detalle, /es una oficina de Interrapidísimo/);
  fs.rmSync(ruta, { force: true });
});

test("direccion normal (no es oficina): Coordinadora con seguro", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    buscarOficinasInter: async () => ({ oficinas: [{ nombre: "X", direccion: "OF. PRINC CL 30 A 65 B 59" }] }),
  });
  s.configurar({ automatico: true, dryRun: true, transportadoras: [5] });
  s.detener();
  await s.tick({ forzar: true });
  assert.deepEqual(subidos[0].transportadoras, [5]);
  assert.equal(subidos[0].oficinaInter, false);
  assert.equal(subidos[0].seguro, true);
  fs.rmSync(ruta, { force: true });
});

test("si Inter no responde, se sigue con el envio normal (no se frena)", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    buscarOficinasInter: async () => {
      throw new Error("Inter tardó demasiado");
    },
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.deepEqual(subidos[0].transportadoras, [5]);
  fs.rmSync(ruta, { force: true });
});

test("con la deteccion apagada no se consultan las oficinas", async () => {
  let consultas = 0;
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    buscarOficinasInter: async () => (consultas++, { oficinas: [] }),
  });
  s.configurar({ automatico: true, dryRun: true, detectarOficinaInter: false });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(consultas, 0);
  fs.rmSync(ruta, { force: true });
});

test("cada pedido tratado queda marcado con su tienda de LucidSales", async () => {
  const { s, ruta } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }] });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  const reg = JSON.parse(fs.readFileSync(ruta, "utf8")).procesados["1"];
  assert.ok(Number.isFinite(reg.tienda) && reg.tienda > 0, JSON.stringify(reg).slice(0, 200));
  fs.rmSync(ruta, { force: true });
});


// ---------------------------------------------------------------------------
// Historial de intentos (transparencia)

test("cada intento queda con el razonamiento de la IA y la validacion de la direccion", async () => {
  const intentos = crearRegistroIntentos();
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    extraido: {
      producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true, entregaFutura: false, incertidumbre: [],
      razonamiento: "El cliente pidió un taladro a 105.690 y confirmó con un sí.",
    },
    validadorDireccion: validadorFalso({
      veredicto: "valida", resumen: "Existe en el mapa.", avisos: [], original: "Carrera 92 #78b-02",
      calificacion: { puntos: 100, verificada: true, partes: [{ concepto: "Formato", puntos: 40, max: 40 }] },
      formato: { ok: true, detalle: "Carrera 92 # 78B-02" },
      mapa: { veredicto: "exacta", detalle: "Google la ubica", mapa: "https://maps.google.com/?q=1", formateada: "Cra. 92 #78b-02" },
    }),
    intentos,
  });
  s.configurar({ automatico: true, dryRun: true, minCalificacionDireccion: 70 });
  s.detener();
  await s.tick({ forzar: true });
  const [it] = intentos.dePedido("1");
  assert.equal(it.origen, "automatica");
  assert.equal(it.accion, "preparado");
  assert.equal(it.dryRun, true);
  assert.match(it.analisis.extraido.razonamiento, /taladro/);
  assert.equal(it.analisis.accion, "subir");
  assert.ok(it.analisis.checks.some((c) => c.campo === "direccionMapa"));
  assert.equal(it.direccion.puntos, 100);
  assert.equal(it.direccion.minimo, 70);
  assert.equal(it.direccion.mapa.enlace, "https://maps.google.com/?q=1");
  assert.deepEqual(it.envio.transportadoras, [5]);
  fs.rmSync(ruta, { force: true });
});

test("un pedido frenado que se revisa cada vuelta no llena el historial", async () => {
  const intentos = crearRegistroIntentos();
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    extraido: { producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02", clienteConfirmo: false, entregaFutura: false, incertidumbre: [] },
    intentos,
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  for (let i = 0; i < 5; i++) await s.tick({ forzar: true });
  // intento 1 frenado, intento 2 agota -> revision; despues ya no se mira
  const lista = intentos.dePedido("1");
  assert.deepEqual(lista.map((x) => x.accion), ["requiere-revision", "frenado"]);
  assert.match(lista[1].detalle, /intento 1 de 2/);
  fs.rmSync(ruta, { force: true });
});

test("consumo: pedidos subidos por mes", async () => {
  const { s, ruta } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }] });
  s.configurar({ automatico: true, dryRun: false });
  s.detener();
  await s.tick({ forzar: true });
  const mes = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7);
  assert.equal(s.consumo()[mes], 1);
  fs.rmSync(ruta, { force: true });
});

// ---------------------------------------------------------------------------
// Pedido repetido (el bot lo creo dos veces)

const repetidos = () => [
  // la lista viene del mas nuevo al mas viejo, como en LucidSales
  { id: 2, idPedido: 112, EstadoPedido: 0, Movil: "+573009998877", producto: "Taladro", Total: "105.690", completo: { ...COMPLETO, id: 2, idPedido: 112 } },
  { id: 1, idPedido: 111, EstadoPedido: 0, Movil: "+573009998877", producto: "Taladro", Total: "105.690", completo: COMPLETO },
];

test("otrosPedidosDelCliente: solo los ANTERIORES del mismo telefono y no cancelados", () => {
  const lista = [
    { id: 5, Movil: "3009998877" },
    { id: 4, Movil: "+57 300 999 8877", idPedido: 104, producto: "X" },
    { id: 3, Movil: "3001112222" },
    { id: 2, Movil: "3009998877", EstadoPedido: 1 },
  ];
  const r = otrosPedidosDelCliente({ id: 5, Movil: "3009998877" }, lista);
  assert.deepEqual(r.map((x) => x.id), [4]);
  assert.deepEqual(otrosPedidosDelCliente({ id: 4, Movil: "3009998877" }, lista), []);
});

test("pedido repetido: el primero se sube y el segundo queda para revisar", async () => {
  const contextos = [];
  const { s, ruta, subidos } = armar({ pedidos: repetidos(), alExtraer: () => {} });
  // la IA ve el otro pedido y no encuentra una segunda compra
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(s.estadoPedido(1).accion, "preparado");
  const e2 = s.estadoPedido(2);
  assert.equal(e2.accion, "posible-duplicado");
  assert.match(e2.detalle, /#111/);
  // una persona confirma que es una compra nueva: se sube en la siguiente vuelta
  s.aprobarDuplicado(2);
  await s.tick({ forzar: true });
  // (en modo prueba el 1 se vuelve a preparar; lo que importa es el 2)
  assert.equal(s.estadoPedido(2).accion, "preparado");
  assert.throws(() => s.aprobarDuplicado(2), /no está marcado/);
  void contextos;
  fs.rmSync(ruta, { force: true });
});

test("pedido repetido: si el chat muestra una compra nueva, se sube", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: repetidos(),
    extraido: {
      producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true, entregaFutura: false, incertidumbre: [],
      segundaCompra: true, evidencia: { segundaCompra: "quiero otro igual para mi hermano" },
    },
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 2);
  fs.rmSync(ruta, { force: true });
});

test("la ganancia y el envio que muestra Dropi quedan con el pedido", async () => {
  const intentos = crearRegistroIntentos();
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: true, creado: false, preparado: true, seguro: true, resumenDropi: { ganancia: 14806, envio: 25295 } }),
    intentos,
  });
  s.configurar({ automatico: true, dryRun: true });
  s.detener();
  await s.tick({ forzar: true });
  assert.deepEqual(s.estadoPedido(1).dropi, { id: null, ganancia: 14806, envio: 25295, transportadora: null });
  assert.equal(intentos.dePedido("1")[0].dropi.ganancia, 14806);
  fs.rmSync(ruta, { force: true });
});

test("en revision y una persona lo confirma en LucidSales: queda resuelto y no se reintenta", async () => {
  const pedidos = [{ id: 1, EstadoPedido: 0, completo: COMPLETO }];
  const { s, ruta, subidos } = armar({
    pedidos,
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false, maxIntentos: 1, estados: [0, 2] });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "requiere-revision");
  pedidos[0].EstadoPedido = 2; // lo subio a mano y lo confirmo
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "resuelto-a-mano");
  assert.equal(s.rearmarRevision().rearmados, 0);
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  fs.rmSync(ruta, { force: true });
});

test("en revision sin cambios de estado: sigue en revision", async () => {
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 2, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false, maxIntentos: 1, estados: [0, 2] });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "requiere-revision");
  fs.rmSync(ruta, { force: true });
});

test("marcar a mano como ya subido lo saca de revision", async () => {
  const { s, ruta } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    respuestaDropi: () => ({ ok: false, creado: false, detalle: "error" }),
  });
  s.configurar({ automatico: true, dryRun: false, maxIntentos: 1 });
  await s.tick({ forzar: true });
  assert.deepEqual(s.resueltoAMano(1, "ana@x.co"), { ok: true, id: "1" });
  assert.equal(s.estadoPedido(1).accion, "resuelto-a-mano");
  assert.match(s.estadoPedido(1).detalle, /ana@x.co/);
  assert.equal(s.rearmarRevision().rearmados, 0);
  fs.rmSync(ruta, { force: true });
});

test("el reloj dice cuando es la proxima revision", async () => {
  const { s, ruta } = armar({ pedidos: [] });
  s.configurar({ automatico: true, dryRun: true, cadaSegundos: 300 });
  const r = s.config().reloj;
  const falta = (Date.parse(r.proxima) - Date.parse(r.ahora)) / 1000;
  assert.ok(falta > 295 && falta <= 300, `falta ${falta}`);
  assert.equal(r.enCurso, false);
  s.detener();
  assert.equal(s.config().reloj.proxima, null);
  s.configurar({ automatico: false });
  assert.equal(s.config().reloj.proxima, null); // apagada: sin reloj
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("entrega futura con fecha: queda programada sin gastar intentos y se sube cuando toca", async () => {
  const { crearProgramados } = await import("../programados.js");
  const { hoyColombia, sumarDias } = await import("../fechaEntrega.js");
  const programados = crearProgramados({ ruta: null });
  const fecha = sumarDias(hoyColombia(), 12);
  const extraido = {
    producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02",
    clienteConfirmo: true, entregaFutura: true, fechaEntregaSolicitada: "para el sábado", fechaEntregaISO: fecha, incertidumbre: [],
  };
  const { s, ruta, subidos } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }], extraido, programados });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  const e = s.estadoPedido(1);
  assert.equal(e.accion, "entrega-programada");
  assert.equal(e.intentos, undefined); // no gasta intentos
  assert.equal(programados.get(1).fecha, fecha);
  assert.equal(programados.get(1).origen, "ia");
  // si los envios tardan 12 dias ya toca: se sube aunque el chat pida otra fecha
  s.configurar({ programados: { diasAntes: 12 } });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.match(s.estadoPedido(1).accion, /^subido/);
  assert.ok(programados.get(1).enviado);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("entrega programada sin subida sola: espera y avisa que ya toca", async () => {
  const { crearProgramados } = await import("../programados.js");
  const { hoyColombia, sumarDias } = await import("../fechaEntrega.js");
  const programados = crearProgramados({ ruta: null });
  programados.poner(1, { fecha: sumarDias(hoyColombia(), 1), origen: "manual", nota: "quincena" });
  const { s, ruta, subidos } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }], programados });
  s.configurar({ automatico: true, dryRun: false, programados: { diasAntes: 1, subirSolo: false } });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.match(s.estadoPedido(1).detalle, /ya toca enviarlo/);
  // una persona le quita la marca: se envia ya
  programados.quitar(1);
  s.programacionCambiada(1);
  s.configurar({ programados: { subirSolo: true } });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("marca manual en un pedido frenado: pasa a esperar su fecha", async () => {
  const { crearProgramados } = await import("../programados.js");
  const { hoyColombia, sumarDias } = await import("../fechaEntrega.js");
  const programados = crearProgramados({ ruta: null });
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    programados,
    extraido: { producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02", clienteConfirmo: true, entregaFutura: null, incertidumbre: [] },
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "frenado");
  programados.poner(1, { fecha: sumarDias(hoyColombia(), 10), origen: "manual" });
  s.programacionCambiada(1);
  await s.tick({ forzar: true });
  assert.equal(s.estadoPedido(1).accion, "entrega-programada");
  assert.equal(subidos.length, 0);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("cada vuelta mira hasta 200 pedidos por tienda (2 paginas de 100)", async () => {
  const todos = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, EstadoPedido: 5, completo: { ...COMPLETO, id: i + 1 } }));
  const paginas = [];
  const cliente = {
    async listarPedidos({ page, itemsPerPage }) {
      paginas.push(page);
      return { pedidos: todos.slice((page - 1) * itemsPerPage, page * itemsPerPage) };
    },
    async obtenerPedido(id) {
      return todos.find((x) => String(x.id) === String(id)).completo;
    },
  };
  const { s, ruta } = armar({ cliente });
  s.configurar({ automatico: true, dryRun: true, estados: [0] });
  await s.tick({ forzar: true });
  assert.deepEqual(paginas, [1, 2]);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("corregimiento que Dropi no tiene como municipio: no se sube y lo revisa una persona", async () => {
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: COMPLETO }],
    extraido: {
      producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #78b-02",
      clienteConfirmo: true, entregaFutura: false, incertidumbre: [], corregimiento: "Rozo",
    },
    respuestaDropi: () => ({ ok: false, creado: false, corregimientoHumano: true, detalle: "No se envió a Dropi: el cliente vive en el corregimiento Rozo y en Dropi no aparece como municipio aparte" }),
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1); // no se reintenta
  assert.equal(subidos[0].corregimiento, "Rozo");
  assert.equal(s.estadoPedido(1).accion, "requiere-humano");
  assert.match(s.estadoPedido(1).detalle, /corregimiento Rozo/);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("producto con variantes: se sube con su variacion de Dropi", async () => {
  const conVar = {
    ...COMPLETO,
    producto: "Taladro Inalambrico 68V",
    Json: JSON.stringify([{ product_id: "87498", price: null, quantity: null, variations: [{ variation_id: "aDdr", price: 105690, quantity: 1 }] }]),
  };
  const cliente = clienteFalso([{ id: 1, EstadoPedido: 0, completo: conVar }]);
  cliente.obtenerProducto = async () => ({
    variantes: [{ nombre: "Copa" }, { nombre: "Tamaño" }],
    mixedvariantes: [{ items: ["Blanca", "150 cm"], sku: "aDdr" }],
    bundleVariantes: [{ variantes: [{ items: ["Blanca", "150 cm"], idVarianteDropi: "1837487" }] }],
    idProductoDropi: 1960650,
  });
  cliente.variantesDropi = async () => [
    { id: "1837486", name: "VERDE" },
    { id: "1837487", name: "BLANCO" },
  ];
  const { s, ruta, subidos } = armar({ cliente });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(subidos[0].productos[0].varianteDropi, "1837487");
  assert.equal(subidos[0].productos[0].varianteDropiNombre, "BLANCO");
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("variante sin vincular a Dropi: no se sube, lo sube una persona", async () => {
  let llamadasLLM = 0;
  const conVar = {
    ...COMPLETO,
    Json: JSON.stringify([{ product_id: "87498", price: null, quantity: null, variations: [{ variation_id: "Yzn", price: 105690, quantity: 1 }] }]),
  };
  const cliente = clienteFalso([{ id: 1, EstadoPedido: 0, completo: conVar }]);
  cliente.obtenerProducto = async () => ({
    variantes: [{ nombre: "Copa" }, { nombre: "Tamaño" }],
    mixedvariantes: [{ items: ["Blanca", "90 cm"], sku: "Yzn" }],
    bundleVariantes: [{ variantes: [{ items: ["Blanca", "90 cm"], idVarianteDropi: null }] }],
  });
  const { s, ruta, subidos } = armar({ cliente, alExtraer: () => llamadasLLM++ });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(llamadasLLM, 0);
  assert.equal(s.estadoPedido(1).accion, "requiere-humano");
  assert.match(s.estadoPedido(1).detalle, /Copa: Blanca; Tamaño: 90 cm» no está vinculada/);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("Dropi no deja elegir la variacion: lo sube una persona sin reintentar", async () => {
  const conVar = {
    ...COMPLETO,
    producto: "Taladro Inalambrico 68V",
    Json: JSON.stringify([{ product_id: "87498", price: null, quantity: null, variations: [{ variation_id: "aDdr", price: 105690, quantity: 1 }] }]),
  };
  const cliente = clienteFalso([{ id: 1, EstadoPedido: 0, completo: conVar }]);
  cliente.obtenerProducto = async () => ({
    mixedvariantes: [{ items: ["Blanca"], sku: "aDdr" }],
    bundleVariantes: [{ variantes: [{ items: ["Blanca"], idVarianteDropi: "1837487" }] }],
  });
  const { s, ruta, subidos } = armar({
    cliente,
    respuestaDropi: () => ({ ok: false, creado: false, varianteHumano: true, detalle: "No se envió a Dropi: ninguna opción coincide" }),
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  assert.equal(s.estadoPedido(1).accion, "requiere-humano");
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("pedido mas viejo que el limite de dias: no se sube solo; con mas dias si", async () => {
  let llamadasLLM = 0;
  const hace = (d) => new Date(Date.now() - d * 86400_000).toISOString();
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, Fecha: hace(30), completo: COMPLETO }],
    alExtraer: () => llamadasLLM++,
  });
  s.configurar({ automatico: true, dryRun: false, maxDiasPedido: 5 });
  await s.tick({ forzar: true });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(llamadasLLM, 0);
  assert.equal(s.estadoPedido(1).accion, "pedido-antiguo");
  assert.match(s.estadoPedido(1).detalle, /30 días \(el límite es 5\)/);
  s.configurar({ maxDiasPedido: 45 });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("limite de dias en 0: sin limite", async () => {
  const hace = (d) => new Date(Date.now() - d * 86400_000).toISOString();
  const { s, ruta, subidos } = armar({ pedidos: [{ id: 1, EstadoPedido: 0, Fecha: hace(90), completo: COMPLETO }] });
  s.configurar({ automatico: true, dryRun: false, maxDiasPedido: 0 });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 1);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("numero pegado sin mapa que lo confirme: no se sube", async () => {
  const conPegado = { ...COMPLETO, Direccion: "Carrera 92 #7802" };
  const { s, ruta, subidos } = armar({
    pedidos: [{ id: 1, EstadoPedido: 0, completo: conPegado }],
    extraido: { producto: "Taladro Inalambrico 68V", cantidad: 1, precioAcordado: 105690, direccion: "Carrera 92 #7802", clienteConfirmo: true, entregaFutura: false, incertidumbre: [] },
  });
  s.configurar({ automatico: true, dryRun: false });
  await s.tick({ forzar: true });
  assert.equal(subidos.length, 0);
  assert.equal(s.estadoPedido(1).accion, "direccion-invalida");
  assert.match(s.estadoPedido(1).detalle, /viene pegado/);
  s.detener();
  fs.rmSync(ruta, { force: true });
});

test("evaluarDireccion: numero pegado que el mapa separo se envia separado", async () => {
  const { evaluarDireccion } = await import("../subidaAutomatica.js");
  const validador = {
    async validar() {
      return {
        formato: { ok: true, normalizada: "Cra 110AA # 30-21, Barrio Nuevo" },
        mapa: { veredicto: "aproximada" },
        calificacion: { puntos: 75, verificada: true },
        resumen: "número separado",
        avisos: [],
      };
    },
  };
  const r = await evaluarDireccion({ validador, minimo: 50, direccion: "Carrera 110AA #3021, Barrio Nuevo", ciudad: "Bogotá" });
  assert.equal(r.ok, true);
  assert.equal(r.direccion, "Cra 110AA # 30-21, Barrio Nuevo");
  // sin poder separarlo: no
  const malo = { async validar() { return { formato: { ok: false, detalle: "número pegado" }, calificacion: { puntos: 10, verificada: false }, resumen: "no se pudo", avisos: [] }; } };
  assert.equal((await evaluarDireccion({ validador: malo, minimo: 50, direccion: "Carrera 110AA #3021" })).ok, false);
});
