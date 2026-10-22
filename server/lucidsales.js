// Cliente minimo de la API de LucidSales para el backend propio.
//
// Flujo (igual que el panel oficial):
//   POST /auth/login  ->  token de cuenta
//   POST /auth/addShopId {id}  ->  token con tienda activa  ->  usar SIEMPRE ese
// Si alguna llamada responde 401, se invalidan los tokens y se reintenta una vez.
import { ErrorApi } from "./errores.js";

export function crearClienteLucid(config, fetchImpl = globalThis.fetch) {
  /** tienda -> token vigente */
  const tokens = new Map();
  let tokenLogin = null;
  let datosLogin = null;

  async function llamar(ruta, opciones = {}) {
    const url = `${config.LUCID_BASE}${ruta}`;
    let res;
    try {
      res = await fetchImpl(url, {
        ...opciones,
        signal: AbortSignal.timeout(config.TIMEOUT_MS),
      });
    } catch (err) {
      throw new ErrorApi(504, `Sin respuesta de LucidSales (${ruta}): ${err?.message ?? err}`);
    }
    const texto = await res.text().catch(() => "");
    let datos = null;
    if (texto) {
      try {
        datos = JSON.parse(texto);
      } catch {
        datos = { msg: String(texto).slice(0, 300) };
      }
    }
    return { status: res.status, datos };
  }

  async function login() {
    // sin credenciales ni siquiera se molesta en llamar (el 400 de la API
    // no dice nada y confunde al que lo lee en el panel)
    if (!config.LUCID_EMAIL || !config.LUCID_PASSWORD) {
      throw new ErrorApi(
        503,
        "Faltan LUCID_EMAIL / LUCID_PASSWORD en server/.env: no se puede consultar LucidSales",
      );
    }
    const { status, datos } = await llamar("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.LUCID_EMAIL, password: config.LUCID_PASSWORD }),
    });
    if (status !== 200 || !datos?.ok || !datos.token) {
      const detalle = datos?.msg ? String(datos.msg) : `HTTP ${status}`;
      throw new ErrorApi(
        502,
        `LucidSales rechazo el login: ${detalle} (revisa LUCID_EMAIL / LUCID_PASSWORD en server/.env)`,
      );
    }
    tokenLogin = datos.token;
    datosLogin = datos;
    return datos;
  }

  async function activarTienda(tienda, reintento = true) {
    if (!tokenLogin) await login();
    const { status, datos } = await llamar("/auth/addShopId", {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": tokenLogin },
      body: JSON.stringify({ id: Number(tienda) }),
    });
    if (status === 401 && reintento) {
      // el token del login vencio: login otra vez y reintenta
      tokenLogin = null;
      datosLogin = null;
      return activarTienda(tienda, false);
    }
    if (status !== 200 || !datos?.ok || !datos.token) {
      throw new ErrorApi(
        502,
        `No se pudo activar la tienda ${tienda}: ${datos?.msg ?? `HTTP ${status}`}`,
      );
    }
    return datos.token;
  }

  function tiendaEfectiva(tienda) {
    return String(tienda || config.LUCID_TIENDA || datosLogin?.idEmpresa?.[0] || "");
  }

  async function tokenPara(tienda) {
    let efectiva = tiendaEfectiva(tienda);
    if (!efectiva && !datosLogin) {
      // sin LUCID_TIENDA: primero logueate para conocer las tiendas de la cuenta
      await login();
      efectiva = tiendaEfectiva(tienda);
    }
    if (!efectiva) {
      throw new ErrorApi(503, "No hay tienda disponible: define LUCID_TIENDA en el .env");
    }
    if (!tokens.has(efectiva)) {
      tokens.set(efectiva, await activarTienda(efectiva));
    }
    return { token: tokens.get(efectiva), tienda: efectiva };
  }

  /** Ejecuta fn(token); si la API responde 401 invalida y reintenta una vez. */
  async function conAuth(tienda, fn, reintento = true) {
    const { token, tienda: efectiva } = await tokenPara(tienda);
    const r = await fn(token);
    if (r.status === 401 && reintento) {
      tokens.clear();
      tokenLogin = null;
      datosLogin = null;
      return conAuth(efectiva, fn, false);
    }
    return r;
  }

  return {
    /** GET /pedidos/get-pedido-by-id/:id -> pedido completo (el shape del update). */
    /** `tienda` opcional: la del pedido; sin ella se usa la tienda por defecto. */
    async obtenerPedido(id, tienda) {
      const limpio = String(id ?? "").replace(/[^\dA-Za-z_-]/g, "");
      if (!limpio) throw new ErrorApi(400, "id de pedido invalido");

      const r = await conAuth(tienda ? String(tienda) : undefined, (token) =>
        llamar(`/pedidos/get-pedido-by-id/${limpio}`, {
          method: "GET",
          headers: { "x-token": token },
        }),
      );

      const p = r.datos?.pedido ?? r.datos?.data?.pedido ?? r.datos?.data ?? r.datos;
      if (r.status === 404 || !p || typeof p !== "object" || !p.id) {
        throw new ErrorApi(
          404,
          `No se encontro el pedido ${id}${r.datos?.msg ? `: ${r.datos.msg}` : ""}`,
        );
      }
      return p;
    },

    /**
     * GET /productos/getproducto/{id} -> producto completo (trae el enlace a
     * Dropi: `idProductoDropi` / `nameProductoDropi`). Sirve para mapear el
     * id de producto de LucidSales al id con el que Dropi lo conoce.
     */
    async obtenerProducto(id) {
      const limpio = String(id ?? "").replace(/[^\dA-Za-z_-]/g, "");
      if (!limpio) throw new ErrorApi(400, "id de producto invalido");

      const r = await conAuth(undefined, (token) =>
        llamar(`/productos/getproducto/${limpio}`, {
          method: "GET",
          headers: { "x-token": token },
        }),
      );

      const p =
        r.datos?.product ?? r.datos?.producto ?? r.datos?.data?.product ?? r.datos?.data ?? r.datos;
      if (r.status === 404 || !p || typeof p !== "object") {
        throw new ErrorApi(404, `No se encontro el producto ${id}`);
      }
      return p;
    },

    /** POST /pedidos/update -> {ok, msg}. El body lo construye estado.js. */
    async actualizarPedido(body, idEmpresa) {
      const r = await conAuth(idEmpresa, (token) =>
        llamar("/pedidos/update", {
          method: "POST",
          headers: { "content-type": "application/json", "x-token": token },
          body: JSON.stringify(body),
        }),
      );
      if (r.status >= 400 || r.datos?.ok === false) {
        throw new ErrorApi(
          502,
          `LucidSales rechazo la actualizacion: ${r.datos?.msg ?? `HTTP ${r.status}`}`,
        );
      }
      return r.datos ?? { ok: true };
    },

    /** Para GET /api/salud. */
    estadoInterno() {
      return {
        base: config.LUCID_BASE,
        tiendas: [...tokens.keys()],
        credenciales: Boolean(config.LUCID_EMAIL && config.LUCID_PASSWORD),
      };
    },

    /** Olvida los tokens: se usa cuando cambian las credenciales. */
    reiniciar() {
      tokens.clear();
      tokenLogin = null;
      datosLogin = null;
    },

    /**
     * GET /pedidos/get-pedidos-light-data -> {pedidos, totalRecords, numPages}.
     * Lo usa el reparto automatico para mirar los pedidos recientes.
     */
    async listarPedidos({ idEmpresa, page = 1, itemsPerPage = 100, search = "", filtros = [] }) {
      const q =
        `?idEmpresa=${encodeURIComponent(String(idEmpresa ?? ""))}` +
        `&page=${page}` +
        `&itemsPerPage=${itemsPerPage}` +
        `&search=${encodeURIComponent(search)}` +
        `&filters=${encodeURIComponent(JSON.stringify(filtros))}`;

      const r = await conAuth(idEmpresa, (token) =>
        llamar(`/pedidos/get-pedidos-light-data${q}`, {
          method: "GET",
          headers: { "x-token": token },
        }),
      );
      if (r.status >= 400 || r.datos?.ok === false) {
        throw new ErrorApi(
          502,
          `LucidSales no devolvio pedidos: ${r.datos?.msg ?? `HTTP ${r.status}`}`,
        );
      }
      return r.datos ?? { pedidos: [] };
    },

    /**
     * POST /productos/getproductos {idEmpresa} -> catalogo de la tienda.
     * Lo usa la rentabilidad para casar sus productos con los de LucidSales
     * (por ahi salen el id y el nombre reales con los que se pide la
     * analitica).
     */
    async productosTienda(idEmpresa) {
      const id = Number(idEmpresa);
      const pedir = () =>
        conAuth(id, (token) =>
          llamar("/productos/getproductos", {
            method: "POST",
            headers: { "content-type": "application/json", "x-token": token },
            body: JSON.stringify({ idEmpresa: id }),
          }),
        );
      let r = await pedir();
      const cuenta = (x) =>
        Array.isArray(x?.productos) ? x.productos.length : Array.isArray(x?.data) ? x.data.length : 0;
      // Un catalogo VACIO con token cacheado paso en la practica: la API
      // responde 200 con la lista en vez de 401, asi que el reintento
      // automatico de conAuth no se activa y la corrida salia con todos los
      // productos «sin match». Se invalida el token y se reintenta una vez.
      if (r.status < 400 && cuenta(r.datos) === 0) {
        tokens.delete(String(id));
        r = await pedir();
      }
      if (r.status >= 400 || r.datos?.ok === false) {
        throw new ErrorApi(
          502,
          `LucidSales no devolvio el catalogo: ${r.datos?.msg ?? `HTTP ${r.status}`}`,
        );
      }
      const lista = r.datos?.productos ?? r.datos?.data ?? [];
      if (!Array.isArray(lista)) throw new ErrorApi(502, "El catalogo de LucidSales vino ilegible");
      return lista;
    },

    /**
     * GET /analitica/get-analytics-data -> utilidaData.gananciaEsperada (la
     * ganancia NETA REAL de esos pedidos: ya viene descontando el flete y el
     * costo del proveedor; ej. Total 84.900 - flete 20.790,5 - costo 40.000
     * = 24.109,5) y pedidosTotales de UN producto en un rango de dias.
     *
     * Sin compare*: la ventana de comparacion multiplica el tiempo por ~15
     * (de 0,6 s a 10 s) y los numeros del periodo actual salen IDENTICOS.
     *
     * Las fechas van a medianoche de Colombia (05:00Z) igual que el panel
     * oficial; `hasta` se manda tal cual, o sea que los pedidos de HOY no
     * entran: todavia no tienen flete ni costo sincronizados de Dropi y
     * entrarian con ganancia 0, hundiendo el promedio.
     */
    async analitica({ idShop, desde, hasta, productId }) {
      const id = Number(idShop);
      const q = new URLSearchParams({
        startDate: `${desde}T05:00:00.000Z`,
        endDate: `${hasta}T05:00:00.000Z`,
        idShop: String(id),
      });
      if (productId !== undefined && productId !== null && String(productId) !== "") {
        q.set("productId", String(productId));
      }
      const r = await conAuth(id, (token) =>
        llamar(`/analitica/get-analytics-data?${q.toString()}`, {
          method: "GET",
          headers: { "x-token": token },
        }),
      );
      if (r.status >= 400 || r.datos?.ok === false) {
        throw new ErrorApi(
          502,
          `LucidSales no devolvio la analitica: ${r.datos?.msg ?? `HTTP ${r.status}`}`,
        );
      }
      return r.datos ?? {};
    },

    /**
     * GET /users/list -> {usuarios, totalRecords} (usuarios de la cuenta).
     * Lo usa el reparto automatico para saber entre quienes repartir.
     */
    async listarUsuarios({ page = 1, itemsPerPage = 100 } = {}) {
      const q = `?page=${page}&itemsPerPage=${itemsPerPage}&search=&filters=${encodeURIComponent("[]")}`;
      const r = await conAuth(undefined, (token) =>
        llamar(`/users/list${q}`, { method: "GET", headers: { "x-token": token } }),
      );
      if (r.status >= 400 || r.datos?.ok === false) {
        throw new ErrorApi(
          502,
          `LucidSales no devolvio usuarios: ${r.datos?.msg ?? `HTTP ${r.status}`}`,
        );
      }
      return r.datos ?? { usuarios: [] };
    },
  };
}

/**
 * Cliente de LucidSales con la sesion del USUARIO del panel (su x-token, ya
 * con la tienda activa). Lo usa la rentabilidad de anuncios: cada quien lee
 * el catalogo y la analitica de SU tienda, nunca con las credenciales del
 * servidor. Expone solo lo que necesita ese modulo.
 */
export function crearLucidDeSesion(config, token, fetchImpl = globalThis.fetch) {
  const tk = String(token ?? "").trim();
  async function llamar(ruta, opciones = {}) {
    let res;
    try {
      res = await fetchImpl(`${config.LUCID_BASE}${ruta}`, {
        ...opciones,
        headers: { ...(opciones.headers ?? {}), "x-token": tk },
        signal: AbortSignal.timeout(config.TIMEOUT_MS ?? 30000),
      });
    } catch (err) {
      throw new ErrorApi(504, `Sin respuesta de LucidSales (${ruta}): ${err?.message ?? err}`);
    }
    const datos = await res.json().catch(() => null);
    if (res.status === 401) {
      throw new ErrorApi(401, "Tu sesión de LucidSales venció: vuelve a iniciar sesión en el panel");
    }
    if (res.status >= 400 || datos?.ok === false) {
      throw new ErrorApi(502, `LucidSales respondió con error en ${ruta.split("?")[0]}: ${datos?.msg ?? `HTTP ${res.status}`}`);
    }
    return datos ?? {};
  }
  return {
    async productosTienda(idEmpresa) {
      const id = Number(idEmpresa);
      const datos = await llamar("/productos/getproductos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idEmpresa: id }),
      });
      const lista = datos?.productos ?? datos?.data ?? [];
      if (!Array.isArray(lista)) throw new ErrorApi(502, "El catálogo de LucidSales vino ilegible");
      return lista;
    },
    async analitica({ idShop, desde, hasta, productId }) {
      const q = new URLSearchParams({
        startDate: `${desde}T05:00:00.000Z`,
        endDate: `${hasta}T05:00:00.000Z`,
        idShop: String(Number(idShop)),
      });
      if (productId !== undefined && productId !== null && String(productId) !== "") {
        q.set("productId", String(productId));
      }
      return llamar(`/analitica/get-analytics-data?${q.toString()}`, { method: "GET" });
    },
  };
}
