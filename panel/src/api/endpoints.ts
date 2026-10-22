import { cabecerasBackend } from "./backend";
import { api, qs, QueryValue } from "./client";
import { buildUpdateBody } from "./pedidoBody";

// Wrappers sobre los endpoints de lucidsales_api_doc.md
// Rutas relativas: el prefijo (/b) lo resuelve el cliente + proxy.

export interface LoginResponse {
  ok: boolean;
  token: string;
  id: number;
  name: string;
  rol: string;
  idEmpresa: string[];
  email: string;
  email_verified?: boolean;
}

export interface ActivateResponse {
  ok: boolean;
  token: string;
  tiendaActiva: number;
  rol: string;
  idEmpresa: string[];
}

export const auth = {
  login: (email: string, password: string) =>
    api<LoginResponse>("/auth/login", { method: "POST", body: { email, password }, token: null }),

  addShopId: (id: number, loginToken: string) =>
    api<ActivateResponse>("/auth/addShopId", { method: "POST", body: { id }, token: loginToken }),

  refresh: () => api("/auth/token/refresh", { method: "POST", body: {} }),

  /**
   * Nombres de las tiendas del usuario: {id: [...]} -> {ok, shopName: [{id, Nombre, ...}]}
   * (el panel la usa en el selector de tienda y en el paso addShopId).
   */
  shopNames: (id: Array<string | number>, token?: string) =>
    api("/auth/getshopname", {
      method: "POST",
      body: { id },
      ...(token ? { token } : {}),
      // auxiliar: si falla solo no se muestra el nombre, nunca desloguea
      ignoreAuth: true,
    }),
};

// ---------------- Pedidos ----------------

export interface Filtro {
  name: string;
  searchValues: string[];
  sortOrder: "asc" | "desc" | null;
}

export interface PedidosQuery {
  idEmpresa: number;
  page: number;
  itemsPerPage: number;
  search: string;
  filters: string;
}

export const pedidos = {
  list: (q: PedidosQuery) =>
    api("/pedidos/get-pedidos-light-data", { query: q as unknown as Record<string, QueryValue> }),

  filtersData: (idEmpresa: number, page = 1, itemsPerPage = 50) =>
    api("/pedidos/get-filters-data", { query: { idEmpresa, page, itemsPerPage } }),

  byId: (id: number | string) => api(`/pedidos/get-pedido-by-id/${id}`),

  update: (body: unknown) => api("/pedidos/update", { method: "POST", body }),

  create: (body: unknown) => api("/pedidos/create", { method: "POST", body }),

  validateAddress: (body: unknown) =>
    api("/pedidos/validate-address", { method: "POST", body }),

  checkUpload: (id: number | string) =>
    api("/pedidos/checkIfOrderCanBeUploaded", { method: "POST", body: { id } }),

  uploadHoko: (body: { id: number; stocks: any[]; courier_id: number | string }) =>
    api("/pedidos/upload/hoko", { method: "POST", body }),

  /**
   * Subir el pedido a Dropi:
   *   POST /pedidos/upload/dropi  {id, transportadora_id?}
   * -> {ok, feedback|msg}
   * Sin transportadora solo manda {id} y Dropi resuelve la suya (el oficial
   * lo hace igual: añade transportadora_id solo si se selecciono una).
   */
  uploadDropi: (body: { id: number | string; transportadora_id?: number | string }) =>
    api("/pedidos/upload/dropi", { method: "POST", body }),

  quote: (transporter: string, body: unknown) =>
    api(`/pedidos/quote/${transporter}`, { method: "POST", body }),

  confirm: (transporter: string, body: unknown) =>
    api(`/pedidos/integrations/confirm/${transporter}`, { method: "POST", body }),
};

// ---------------- Cambio de estado via NUESTRO backend ----------------

/** URL base de nuestro backend (server/). Vacio = mismo origen (/api). */
const API_PROPIA = (import.meta.env.VITE_API_PROPIA as string | undefined) ?? "";

export interface ResultadoEstado {
  ok: boolean;
  /** true = no hubo backend y se uso la API de LucidSales directamente. */
  directo: boolean;
  msg: string;
  estadoNuevo?: number;
  nombreEstado?: string;
}

/**
 * Cambia el estado de un pedido usando NUESTRO backend:
 *   POST /api/pedidos/:id/estado  { estado, motivo }
 *
 * El backend valida, busca el pedido y hace el POST /pedidos/update con sus
 * propias credenciales, y deja el cambio en su historial.
 *
 * Si el backend no esta disponible (sin servidor, sin API key, timeout) se
 * vuelve al flujo directo contra LucidSales (byId + update) para que la
 * accion nunca se quede sin funcionar.
 */
export async function cambiarEstadoPedido(
  id: number | string,
  estado: number,
  motivo?: string,
  _extra?: { quien?: string }, // ya no se usa: el servidor sabe quien es por la sesion
): Promise<ResultadoEstado> {
  const url = `${API_PROPIA}/api/pedidos/${encodeURIComponent(String(id))}/estado`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // sesion de LucidSales: el servidor sabe quien es (no se manda x-usuario)
        ...cabecerasBackend(),
        "x-origen": "panel",
      },
      body: JSON.stringify({ estado, ...(motivo ? { motivo } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const datos: any = await res.json().catch(() => null);

    // Fallo de infraestructura: backend caido o mal montado -> flujo directo.
    if (res.status === 404 || res.status === 503 || res.status === 504) {
      console.warn("[api propia] no disponible (" + res.status + "), usando API directa");
      return directo(id, estado, motivo, datos?.msg);
    }

    if (!res.ok) {
      // 400/401/402: error real (validacion o API key) -> se muestra al usuario
      throw new Error(datos?.msg || `El backend respondio ${res.status}`);
    }

    return {
      ok: true,
      directo: false,
      msg: datos?.msg ?? "Pedido actualizado",
      estadoNuevo: datos?.estadoNuevo,
      nombreEstado: datos?.nombreEstado,
    };
  } catch (err: any) {
    // Red, timeout o 502/503 del propio LucidSales: reintenta directo.
    const mensaje = err?.message ?? String(err);
    const esFallaDeServicio =
      err?.name === "TimeoutError" ||
      err?.name === "AbortError" ||
      err instanceof TypeError ||
      /network|fetch|failed|ECONNREFUSED|timed? ?out/i.test(mensaje);

    if (esFallaDeServicio) {
      console.warn("[api propia] sin respuesta, usando API directa:", mensaje);
      return directo(id, estado, motivo, mensaje);
    }
    throw err;
  }

  /** Respaldo: mismo flujo que usaba el panel antes del backend. */
  async function directo(
    idPed: number | string,
    nuevo: number,
    motivoPed?: string,
    nota?: string,
  ): Promise<ResultadoEstado> {
    const completo: any = await pedidos.byId(idPed);
    const p = completo?.pedido ?? completo?.data ?? completo;
    if (!p || !p.id) throw new Error("No se pudo cargar el pedido");

    await pedidos.update(
      buildUpdateBody(p, {
        EstadoPedido: nuevo,
        ...(nuevo === 1 && motivoPed ? { motivo: motivoPed } : {}),
      }),
    );

    return {
      ok: true,
      directo: true,
      msg: nota ? `Cambio aplicado por la API directa (${nota})` : "Cambio aplicado por la API directa",
      estadoNuevo: nuevo,
    };
  }
}

// ---------------- Oficinas de Inter Rapidisisimo (via NUESTRO backend) ----------------

export interface HorarioFranja {
  tipo: string | null;
  inicio: string | null;
  fin: string | null;
}
export interface HorarioDia {
  idDia: number | null;
  dia: string | null;
  franjas: HorarioFranja[];
}
export interface OficinaInter {
  consultado: {
    origen?: string;
    municipio?: string | null;
    departamento?: string | null;
    pais?: number;
    idCiudad?: string | null;
    coincidencia?: string;
    listado?: string;
    depListado?: string;
  };
  oficina: {
    id: number | null;
    tipo: string | null;
    nombre: string | null;
    direccion: string | null;
    barrio: string | null;
    ciudad: string | null;
    departamento: string | null;
    idCiudad: string | null;
    estado: string | null;
    telefono1: string | null;
    telefono2: string | null;
    lat: number | null;
    lng: number | null;
    recibeGiros: boolean;
    pagaGiros: boolean;
    reclamaOficina: boolean;
    recaudo: boolean;
    transacciones: boolean;
    pesoMaximo: number | null;
    volumenMaximo: number | null;
  } | null;
  horarios: HorarioDia[];
  bodega: {
    nombre: string | null;
    direccion: string | null;
    barrio: string | null;
    telefono1: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  diaActual: { id: number | null; nombre: string | null } | null;
  /** Cuantas oficinas hay en el municipio (solo si vino por listado). */
  totalOficinas: number | null;
  /**
   * Algo se esta cargando en segundo plano: "oficina" (Inter no publica la
   * oficina principal y hay que bajar el listado) u "horarios" (el POST de
   * horarios tarda 13-25 s). Mientras haya valor, conviene volver a consultar.
   */
  pendiente: string | null;
  /** Solo si algo fallo pero la oficina igual se pudo responder. */
  aviso?: string;
  /** Solo si no hay oficina para ese municipio. */
  msg?: string;
}

/**
 * Oficina de Inter Rapidisisimo segun el municipio del pedido.
 *   GET /api/interrapidisimo/oficina?municipio=...&departamento=...
 *   GET /api/interrapidisimo/oficina?municipio=71&departamento=2   (ids LucidSales)
 *   GET /api/interrapidisimo/oficina?idCiudad=05001000
 *
 * Publica (no necesita sesion): es informacion que cachea nuestro backend.
 * La respuesta rapida trae la oficina; lo lento (horarios y el listado de
 * ciudades sin oficina principal) llega despues y se avisa con "pendiente",
 * momento en que conviene volver a consultar. "reintentar=1" borra el ultimo
 * fallo y relanza esa tarea.
 */
export async function oficinaInter(
  params: {
    municipio?: string | number;
    departamento?: string | number;
    pais?: string | number;
    idCiudad?: string | number;
    reintentar?: string | number;
  },
  timeoutMs = 12000,
): Promise<OficinaInter> {
  const query = qs(params as Record<string, QueryValue>);
  const url = `${API_PROPIA}/api/interrapidisimo/oficina${query}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-origen": "panel",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const motivo = err?.name === "TimeoutError" ? "tardo demasiado" : "no hay conexion con el servidor";
    throw new Error(`No se pudo consultar la oficina: ${motivo} (npm run api)`);
  }

  const datos: any = await res.json().catch(() => null);
  if (!res.ok) {
    const e: any = new Error(datos?.msg || `El backend respondio ${res.status}`);
    e.status = res.status;
    throw e;
  }
  if (!datos?.ok) throw new Error(datos?.msg || "Respuesta inesperada del backend");
  return datos as OficinaInter;
}

/** Una oficina dentro del listado completo del municipio. */
export interface OficinaEnListado extends NonNullable<OficinaInter["oficina"]> {
  /** km respecto a la referencia (oficina principal / bodega / centro del pais). */
  distancia: number | null;
  horarios: HorarioDia[];
  /** Solo las franjas de hoy (para no inflar la respuesta). */
  horarioHoy: { tipo: string | null; inicio: string | null; fin: string | null }[];
}

export interface OficinasInter {
  consultado: OficinaInter["consultado"];
  idCiudad: string | null;
  /** De donde salio la lista: "listado" | "principal" (respaldo) | "vacio". */
  origen: string | null;
  oficinas: OficinaEnListado[];
  total: number;
  /** Oficinas que Inter tiene en el municipio (null = desconocido). */
  enInter: number | null;
  diaActual: { id: number | null; nombre: string | null } | null;
  bodega: OficinaInter["bodega"];
  /**
   * "listado" mientras Inter sigue bajando las oficinas (13-25 s la primera
   * vez): conviene volver a consultar hasta que llegue la lista.
   */
  pendiente: string | null;
  /** Inter no devolvio algo (lista vacia, caido...) pero la llamada salio bien. */
  aviso?: string;
  /** El municipio no esta catalogado en Inter. */
  msg?: string;
}

/**
 * TODAS las oficinas del municipio del pedido (para elegir una como direccion).
 *   GET /api/interrapidisimo/oficinas?municipio=...&departamento=...
 *   GET /api/interrapidisimo/oficinas?municipio=71&departamento=2   (ids LucidSales)
 *   GET /api/interrapidisimo/oficinas?idCiudad=05001000
 *
 * Mismos parametros que oficinaInter(). La respuesta rapida viene casi vacia y
 * trae pendiente="listado": el backend baja el listado de Inter en segundo
 * plano (13-25 s la primera vez) y cachea 1 h. Mientras haya pendiente se
 * vuelve a consultar; "reintentar=1" fuerza una bajada nueva.
 */
export async function oficinasInter(
  params: {
    municipio?: string | number;
    departamento?: string | number;
    pais?: string | number;
    idCiudad?: string | number;
    reintentar?: string | number;
  },
  timeoutMs = 15000,
): Promise<OficinasInter> {
  const query = qs(params as Record<string, QueryValue>);
  const url = `${API_PROPIA}/api/interrapidisimo/oficinas${query}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-origen": "panel",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const motivo = err?.name === "TimeoutError" ? "tardo demasiado" : "no hay conexion con el servidor";
    throw new Error(`No se pudieron listar las oficinas: ${motivo} (npm run api)`);
  }

  const datos: any = await res.json().catch(() => null);
  if (!res.ok) {
    const e: any = new Error(datos?.msg || `El backend respondio ${res.status}`);
    e.status = res.status;
    throw e;
  }
  if (!datos?.ok) throw new Error(datos?.msg || "Respuesta inesperada del backend");
  return datos as OficinasInter;
}

// ---------------- Productos ----------------

export const productos = {
  list: (idEmpresa: number) =>
    api("/productos/getproductos", { method: "POST", body: { idEmpresa } }),

  /**
   * Lista paginada que usa el screen oficial (ProductosListScreen):
   *   GET /productos/getProductos?page=&itemsPerPage=&search=&filters=[]
   * -> {ok?, productos: [...], totalRecords}. La query se arma igualita que
   * la del oficial (filters = "[]").
   */
  listPage: (p: { page: number; itemsPerPage: number; search?: string; filters?: unknown[] }) => {
    const q =
      `?page=${p.page}` +
      `&itemsPerPage=${p.itemsPerPage}` +
      `&search=${encodeURIComponent(p.search ?? "")}` +
      `&filters=${encodeURIComponent(JSON.stringify(p.filters ?? []))}`;
    return api(`/productos/getProductos${q}`);
  },

  /** GET /productos/getproducto/{id} -> {ok, product|producto, ...} (pantalla de edicion) */
  get: (id: string | number) => api(`/productos/getproducto/${id}`),

  /**
   * Crear (modal "Agregar un nuevo producto" del oficial):
   *   {nombre, valor, pais, sku: "", bundle: [{cant:1, default, hide, name,
   *    precio, resaltar, sku, texto, imagenes}]}
   * -> {ok, msg, insertID}
   */
  add: (body: unknown) => api("/productos/addproducto/", { method: "POST", body }),

  /** Guardar edicion. El oficial manda un cuerpo enorme (ver doc §3.5). */
  update: (body: unknown) => api("/productos/updateproducto", { method: "POST", body }),

  /** Borrar: {idProducto} -> {ok} | {error: "..."} */
  remove: (idProducto: string | number) =>
    api("/productos/deleteproducto", { method: "POST", body: { idProducto } }),

  /**
   * Validar un id de producto en Dropi (el id de Dropi, no el nuestro):
   *   GET /productos/validateDropiId/{id}
   * -> {ok, msg:"El producto fue encontrado",
   *     product:{id,name,stock,cod_dane,private_product}}
   */
  validateDropiId: (id: string | number) => api(`/productos/validateDropiId/${id}`),

  /**
   * Guardar los bundles del producto. **No pasa por updateproducto**: `bundle`
   * y `bundleVariantes` no estan entre sus 87 claves, el oficial usa este
   * endpoint aparte con los dos como JSON string (el `Precio` opcional es del
   * precio dual de Dropanas y aqui no se manda).
   * -> {ok, msg} | {error}
   */
  updateBundles: (body: {
    idProducto: string | number;
    bundles: string;
    bundleVariantes: string;
  }) => api("/productos/updatebundle", { method: "POST", body }),

  listShopify: () => api("/productos/listProducts/shopify", { method: "POST", body: {} }),

  listDropi: () => api("/productos/listProducts/dropi", { method: "POST" }),

  importExternal: (body: { platform: string; products: any[] }) =>
    api("/productos/import-external-products", { method: "POST", body }),
};

// ---------------- Clientes ----------------

export const clientes = {
  /**
   * Clientes de la tienda (variante paginada, la que usa el panel oficial):
   *   GET /clientes/getclientes?page=1&itemsPerPage=25&search=&filters=[]
   * `totalRecords` (total de clientes) solo llega en esta variante.
   */
  list: (idEmpresa: number, opts?: { page?: number; itemsPerPage?: number; search?: string }) =>
    api("/clientes/getclientes", {
      query: {
        idEmpresa,
        page: opts?.page ?? 1,
        itemsPerPage: opts?.itemsPerPage ?? 25,
        search: opts?.search ?? "",
        filters: "[]",
      },
    }),

  integrations: (idEmpresa: number) =>
    api("/clientes/getIntegrations", { query: { idEmpresa } }),

  updateIntegration: (name: string, body: unknown) =>
    api(`/clientes/updateIntegration/${name}`, { method: "POST", body }),
};

// ---------------- Utilidades ----------------

export const tools = {
  currencies: () => api("/currencies"),
  countries: () => api("/tools/getCountries"),
  states: (country: string | number) => api("/tools/getCountryState", { query: { country } }),
  cities: (state: string | number) => api("/tools/getStateCity", { query: { state } }),
  // La documentación actual del panel confirma que /tools/quote devuelve 404.
  // Las tarifas se consultan por pedido en /pedidos/quote/{transportadora}.
  /**
   * Flujos de la cuenta del bot: `POST /tools/bot/flows {key}` (POST si o si:
   * GET da 404 y `key` vacio da 500; `key` = botApiKey de la tienda).
   * -> {ok, accountData:{page_id,name,active,created,total_users}, data:[{id,name}], usedKey}
   */
  botFlows: (key: string) => api("/tools/bot/flows", { method: "POST", body: { key } }),

  /**
   * Plantilla del prompt de reconocimiento de imagenes:
   *   GET /tools/bot/get-template[?type=5]  (solo GET; POST da 404 y el
   *   parametro type da igual: siempre devuelve la misma)
   * -> {ok, data:{id,name,type,value}, key}
   */
  botTemplate: (type?: number) =>
    api("/tools/bot/get-template", type ? { query: { type } } : {}),
};

// ---------------- Negocio / usuarios ----------------
// (la doc antigua decia /ajustes/*, esos endpoints no existen)

export const negocio = {
  // auxiliar (enlace al inbox del bot): un 401 no debe cerrar la sesion
  bot: () => api("/business/bot", { method: "POST", body: {}, ignoreAuth: true }),
  update: (body: unknown) => api("/business/update", { method: "POST", body }),
};
export const usuarios = {
  /**
   * GET /users/list?page=&itemsPerPage=&search=&filters=  (chunk oficial
   * AjustesUsuariosScreen) -> {ok, usuarios: [...], totalRecords}.
   * La query se arma igualita que la del panel oficial (filters = "[]").
   */
  list: (p: { page: number; itemsPerPage: number; search?: string; filters?: unknown[] }) => {
    const q =
      `?page=${p.page}` +
      `&itemsPerPage=${p.itemsPerPage}` +
      `&search=${encodeURIComponent(p.search ?? "")}` +
      `&filters=${encodeURIComponent(JSON.stringify(p.filters ?? []))}`;
    return api(`/users/list${q}`);
  },
  /** PUT /users/update/{id}: {nombre, telefono (prefijo pais), direccion, permisos} */
  update: (id: string | number, body: unknown) => api(`/users/update/${id}`, { method: "PUT", body }),
  /** DELETE /users/delete/{id} -> {ok, msg} */
  remove: (id: string | number) => api(`/users/delete/${id}`, { method: "DELETE" }),
  create: (body: unknown) => api("/users/create", { method: "POST", body }),
  createPassword: (body: unknown) => api("/users/create-password", { method: "POST", body }),
  resetPassword: (body: unknown) => api("/users/reset-password", { method: "POST", body }),
  submitReset: (body: unknown) => api("/users/submit-reset-password", { method: "POST", body }),
  show: (userToken: string) => api(`/users/show/${userToken}`, { method: "POST", body: {} }),
};

// ---------------- Catalogos / constantes ----------------

export const meta = {
  /**
   * Campanas de Meta (ads) para vincular al producto:
   *   GET /meta/campaigns -> {ok, campaigns:[{value, label}]}
   * (esta en el ProductoScreen, no en el bundle principal)
   */
  campaigns: () => api("/meta/campaigns"),

  /**
   * Anuncios de las campanas seleccionadas:
   *   POST /meta/campaigns/ads/sync {campaigns:["<value>", ...]}
   * -> {ok, ads:[{adId, ...}]}   (los adId van a AdsMetaTags)
   */
  adsSync: (campaigns: string[]) =>
    api("/meta/campaigns/ads/sync", { method: "POST", body: { campaigns } }),
};

// ---------------- Metricas (seccion oficial "metricas-lucidsales") ----------------

/**
 * Metricas del negocio:
 *   GET /analitica/get-analytics-data?startDate=...&endDate=...
 *                               &compareStartDate=...&compareEndDate=...
 *                               &idShop=3682
 *                               &productId=&source=&dropshippingProvider=  (opcionales)
 *
 * Es el UNICO endpoint que usa la pantalla oficial de Metricas (chunk
 * `MetricasLucidSalesScreen`); el resto de datos de esa pantalla sale de
 * `productos/getproductos` (selector de producto) y de `get-filters-data`
 * (las fuentes). Se manda en ISO con hora local del navegador recortada a
 * dia: 2026-10-06T05:00:00.000Z = 00:00 en Colombia (UTC-5).
 *
 * -> {ok, ventasTotales:{value,change}, pedidosTotales:{value,change},
 *     utilidaData:{value,change,gananciaEsperada,costoPublicidad,costoDevolucion},
 *     lineChartData:[{name,current,previous,orders_current,orders_previous}],
 *     confirmationData:[{name,value,amount,percentage,change}],
 *     statusData:[...], shippingStatusData:[...],
 *     rawMetrics:{main:{...},comparison:{...}}}
 */
export const analitica = {
  get: (q: {
    startDate: string;
    endDate: string;
    compareStartDate: string;
    compareEndDate: string;
    idShop: number | string;
    productId?: string;
    source?: string;
    dropshippingProvider?: string;
  }) => api("/analitica/get-analytics-data", { query: q as unknown as Record<string, QueryValue> }),
};

/**
 * Metricas de Meta / Ventas LucidBot (la OTRA pantalla de metricas del
 * oficial: ruta `metricas`, chunk `page-*.js`, titulo "Ventas LucidBot").
 *   GET /meta/metrics/{id}?page=&itemsPerPage=&search=&filters=
 *                    &startDate=AAAA-MM-DD&endDate=AAAA-MM-DD
 *
 * - El `{id}` del path por defecto es `1` (el oficial usa el `:id` de la ruta
 *   y si no viene manda "1"); no se ha visto que cambie la respuesta.
 * - `filters` es el mismo formato que la lista de pedidos; por defecto va
 *   `[{name:"costPerSale", searchValues:[], sortOrder:"asc"}]`.
 * - Fechas **sin hora**: `startDate=2026-10-06&endDate=2026-10-06`.
 * - `page`/`itemsPerPage` no parecen paginar: devuelve todo el rango
 *   (78 filas en 1 dia, 287 en 7).
 * - Sin coincidencias responde **sin** `insights`:
 *   `{ok:true, msg:"No hay insights registrados"}`.
 *
 * -> {ok, count, insights:[{adTitle, Test, Producto, idProducto, adSetTitle,
 *     campaignTitle, accountTitle, adId, messages, costPerMessage, sells,
 *     total, costPerSale, cierre, clicks, spend, impressions, reach, ctr, cpm,
 *     orderStatus, fulfillmentStatus}]}
 */
/** Orden por defecto de la tabla del oficial. */
export const FILTROS_META = [{ name: "costPerSale", searchValues: [], sortOrder: "asc" as const }];

export const metaMetricas = {
  list: (q: {
    startDate: string;
    endDate: string;
    page?: number;
    itemsPerPage?: number;
    search?: string;
    filters?: unknown[];
    id?: string;
  }) => {
    // Se arma la query a mano (no con `qs`) porque el oficial manda `search=`
    // TAMBIEN vacio y `qs` salta los strings vacios.
    const p = new URLSearchParams();
    p.set("page", String(q.page ?? 1));
    p.set("itemsPerPage", String(q.itemsPerPage ?? 100));
    p.set("search", q.search ?? "");
    p.set("filters", JSON.stringify(q.filters ?? FILTROS_META));
    p.set("startDate", q.startDate);
    p.set("endDate", q.endDate);
    return api(`/meta/metrics/${q.id ?? "1"}?${p.toString()}`);
  },

  /** GET /meta/insights/last -> {nextAttempt} (limite de sincronizacion). */
  ultimaSync: () => api("/meta/insights/last", { ignoreAuth: true }),

  /**
   * Fuerza la sincronizacion con Meta. El oficial lo hace con GET y devuelve
   * **429 + {nextAttempt}** si se pide antes de las 3 horas.
   */
  sincronizar: () => api("/meta/insights/sync", { ignoreAuth: true }),
};

/** Etiquetas reales del panel (0-9). */
export const ESTADOS_PEDIDO: Record<number, string> = {
  0: "Por confirmar",
  1: "Cancelado",
  2: "Confirmado",
  3: "Modificado",
  4: "En Transito",
  5: "En Reparto",
  6: "Entregado",
  7: "Devuelto",
  8: "En Novedad",
  9: "Novedad Solucionada",
};

/** Valores usados por el filtro de columna "orderStatus". */
export const ESTADOS_PEDIDO_FILTRO = [
  "Por confirmar",
  "Cancelado",
  "Confirmado",
  "Modificado",
];

/** 1 = CON RECAUDO (COD), 2 = SIN RECAUDO (prepago). */
export const TIPOS_PAGO: Record<number, string> = {
  1: "CON RECAUDO",
  2: "SIN RECAUDO",
};

/** Rutas reales de cotizacion (el nombre no siempre es el del transportador). */
export const TRANSPORTADORES = [
  "dropi",
  "enviapuntocom",
  "99envios",
  "boxful",
  "venndelo",
  "hoko",
  "aliclik",
  "dropanas",
  "swayp",
] as const;

/** Nombres de columna/filtro admitidos por get-pedidos-light-data. */
export const NOMBRES_FILTRO = [
  "date",
  "customer",
  "subtotal",
  "orderStatus",
  "fulfillmentStatus",
  "product",
  "source",
] as const;

export const INTEGRACIONES = [
  "venndelo",
  "dropi",
  "hoko",
  "rocket",
  "easydrop",
  "edrop",
  "mastershop",
  "aveonline",
  "effi",
  "boxful",
  "shopify",
  "swayp",
  "easyecommerce",
  "99envios",
  "envia",
  "aliclik",
  "dropanas",
] as const;
