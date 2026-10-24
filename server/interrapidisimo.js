// Cliente de la API publica de Inter Rapidisisimo (oficinas por municipio).
//
//   GET  Ciudad_CV/ObtenerCiudades                       -> 1117 municipios (366 KB)
//   GET  CentroServicio_CV/ObtenerOficinaPrincipalCiudad -> oficina del municipio  (~2 s)
//   GET  CentroServicio_CV/ObtenerBodegaPrincipalPorCiudad -> bodega o null        (~0,5 s)
//   GET  DiaSemana_CV/ObtenerDiaSemanaActual             -> dia de hoy             (~0,05 s)
//   POST CentroServicio_CV/ObtenerCentrosServicioHorarios?lat=&lng=&idCiudad=
//        -> horarios / listado de oficinas del municipio   (LENTO: 13-25 s medidos)
//
// No lleva autenticacion y su CORS es "*" (medido 2026-10-04); su servidor
// responde "no-store", asi que TODO se cachea de este lado.
//
// Tiempos medidos 2026-10-04 (por eso la division en rapido / segundo plano):
//   oficina principal 1,2-2,3 s | bodega 0,1-0,5 s | dia 0,05 s
//   POST horarios      13,5-22,9 s  -> se dispara en segundo plano y se cachea 1 h
//
// El municipio del pedido viene de LucidSales como id numerico, asi que aqui
// tambien resolvemos ids -> nombres con los endpoints publicos:
//   GET /tools/getCountryState?country=47   GET /tools/getStateCity?state=2
import { ErrorApi } from "./errores.js";

/** TTL (ms). El catalogo casi no cambia; las oficinas y horarios si. */
const TTL_CATALOGO = 24 * 60 * 60 * 1000;
const TTL_OFICINA = 60 * 60 * 1000;
const TTL_DIA = 5 * 60 * 1000;
/** Cuanto tiempo no se vuelve a intentar algo que acaba de fallar. */
const TTL_FALLO = 5 * 60 * 1000;
/** Inter a veces devuelve el listado vacio: se cachea poco para poder repetir. */
const TTL_VACIO = 60 * 1000;
/** Coordenadas de referencia para pedir el listado (solo afectan "Distancia"). */
const CENTRO_PAIS = { lat: 4.5709, lng: -74.2973 };

const DIAS = {
  1: "LUNES",
  2: "MARTES",
  3: "MIERCOLES",
  4: "JUEVES",
  5: "VIERNES",
  6: "SABADO",
  7: "DOMINGO",
};

/** Mayusculas, sin tildes, sin puntuacion, espacios simples. */
export function normalizar(v) {
  return String(v ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const esNumero = (v) => /^\d+$/.test(String(v ?? "").trim());
const horaCorta = (iso) => (typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) : iso ?? null);

/**
 * Empareja un municipio (y opcionalmente su departamento) contra el listado
 * de Inter. Inter desambigua homonimos agregando el departamento al nombre
 * ("CARTAGENA BOLIVAR", "ARMENIA QUINDIO"), por eso el desempate por dep.
 *
 * 1. nombre exacto  2. empieza/contiene (>=4 letras)  3. cabecera del
 *    departamento (IdCiudad terminado en 001000).
 *
 * Ojo con los registros de Inter que vienen con Descripcion vacia (p. ej.
 * 19050006): "" empieza con cualquier cosa, asi que se ignoran siempre.
 */
export function emparejar(ciudades, municipio, departamento) {
  const nom = normalizar(municipio);
  const dep = normalizar(departamento);
  const delDep = (c) => dep !== "" && normalizar(c.Departamento) === dep;

  if (nom) {
    const exactos = ciudades.filter((c) => normalizar(c.Descripcion) === nom);
    if (exactos.length) {
      const porDep = exactos.filter(delDep);
      return { ciudad: porDep[0] || exactos[0], coincidencia: "exacta" };
    }
    if (nom.length >= 4) {
      const difusos = ciudades.filter((c) => {
        const n = normalizar(c.Descripcion);
        if (n.length < 4) return false;
        return n.startsWith(nom) || nom.startsWith(n) || n.includes(nom) || nom.includes(n);
      });
      if (difusos.length) {
        const porDep = difusos.filter(delDep);
        return { ciudad: porDep[0] || difusos[0], coincidencia: "difusa" };
      }
    }
  }

  if (dep) {
    const cabecera = ciudades.find((c) => /001000$/.test(String(c.IdCiudad)) && delDep(c));
    if (cabecera) return { ciudad: cabecera, coincidencia: "cabecera" };
  }

  return null;
}

/** Horarios crudos de Inter -> shape plano. */
export function mapearHorarios(brutas) {
  return (brutas ?? []).map((h) => ({
    idDia: h?.DiaSemana?.Id ?? null,
    dia: h?.DiaSemana?.Descripcion ?? DIAS[h?.DiaSemana?.Id] ?? null,
    franjas: (h?.Franjas ?? []).map((f) => ({
      tipo: f?.TipoHorario?.Descripcion ?? null,
      inicio: horaCorta(f?.HoraInicio),
      fin: horaCorta(f?.HoraFin),
    })),
  }));
}

/** Oficina -> shape plano que consume el panel. */
export function mapearOficina(o) {
  return {
    id: o.IdCentroServicio ?? null,
    tipo: o.Tipo ?? null,
    nombre: o.Nombre ?? null,
    direccion: o.Direccion ?? null,
    barrio: o.Barrio ?? null,
    ciudad: o.Ciudad?.Descripcion ?? null,
    departamento: o.Ciudad?.Departamento ?? null,
    idCiudad: o.IdCiudad ?? null,
    estado: o.Estado ?? null,
    telefono1: o.Telefono1 ?? null,
    telefono2: o.Telefono2 ?? null,
    lat: o.Latitud ?? null,
    lng: o.Longitud ?? null,
    /** km respecto a las coordenadas de referencia (null si no vino). */
    distancia: typeof o.Distancia === "number" ? Math.round(o.Distancia * 10) / 10 : null,
    recibeGiros: Boolean(o.RecibeGiros),
    pagaGiros: Boolean(o.PagaGiros),
    reclamaOficina: Boolean(o.ReclamaOficina),
    recaudo: Boolean(o.Recaudo),
    transacciones: Boolean(o.Transacciones),
    pesoMaximo: o.PesoMaximo ?? null,
    volumenMaximo: o.VolumenMaximo ?? null,
  };
}

export function crearClienteInter(config, fetchImpl = globalThis.fetch) {
  /** clave -> { hasta, valor } */
  const cache = new Map();
  /** clave -> true (tarea en vuelo) */
  const enCaliente = new Map();
  /** clave -> { hasta, msg } (fallo reciente: no reintenta solo) */
  const fallos = new Map();

  const leer = (clave) => {
    const e = cache.get(clave);
    return e && e.hasta > Date.now() ? e.valor : undefined;
  };
  const escribir = (clave, valor, ttl) => {
    cache.set(clave, { hasta: Date.now() + ttl, valor });
    return valor;
  };

  /** Lanza fn sin esperarla; solo una a la vez por clave. */
  function enSegundoPlano(clave, fn) {
    if (enCaliente.has(clave)) return;
    enCaliente.set(clave, true);
    Promise.resolve()
      .then(fn)
      .then(() => fallos.delete(clave))
      .catch((err) => fallos.set(clave, { hasta: Date.now() + TTL_FALLO, msg: err?.message ?? String(err) }))
      .finally(() => enCaliente.delete(clave));
  }

  function falloReciente(clave) {
    const f = fallos.get(clave);
    if (!f) return null;
    if (f.hasta < Date.now()) {
      fallos.delete(clave);
      return null;
    }
    return f.msg;
  }

  async function pedir(ruta, opciones = {}, timeoutMs) {
    const url = `${config.INTER_BASE}/${ruta.replace(/^\/+/, "")}`;
    let res;
    try {
      res = await fetchImpl(url, {
        ...opciones,
        signal: AbortSignal.timeout(timeoutMs ?? config.TIMEOUT_MS ?? 15000),
      });
    } catch (err) {
      throw new ErrorApi(504, `Sin respuesta de Inter Rapidisisimo: ${err?.message ?? err}`);
    }
    const texto = await res.text().catch(() => "");
    if (res.status >= 400) {
      throw new ErrorApi(502, `Inter Rapidisisimo respondio HTTP ${res.status} (${ruta.split("?")[0]})`);
    }
    let datos;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      throw new ErrorApi(502, `Inter Rapidisisimo devolvio algo que no es JSON (${ruta.split("?")[0]})`);
    }
    return datos;
  }

  /** Llamada publica a LucidSales (sin token) con su propia cache. */
  async function pedirLucid(ruta) {
    const clave = `lucid:${ruta}`;
    const enCache = leer(clave);
    if (enCache !== undefined) return enCache;

    const url = `${config.LUCID_BASE}${ruta}`;
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(config.TIMEOUT_MS ?? 15000) });
    } catch (err) {
      throw new ErrorApi(504, `Sin respuesta de LucidSales (${ruta}): ${err?.message ?? err}`);
    }
    const texto = await res.text().catch(() => "");
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = null;
    }
    if (res.status >= 400 || !datos) {
      throw new ErrorApi(502, `LucidSales no respondio bien en ${ruta} (HTTP ${res.status})`);
    }
    return escribir(clave, datos, TTL_CATALOGO);
  }

  const timeoutLento = () => config.TIMEOUT_INTER_LENTO_MS ?? 45000;

  return {
    /** 1117 municipios de Inter (cacheados 24 h). */
    async ciudades() {
      const clave = "inter:ciudades";
      const enCache = leer(clave);
      if (enCache !== undefined) return enCache;
      const datos = await pedir("Ciudad_CV/ObtenerCiudades");
      if (!Array.isArray(datos)) throw new ErrorApi(502, "El catalogo de municipios vino raro");
      return escribir(clave, datos, TTL_CATALOGO);
    },

    /** municipio/departamento -> { ciudad, coincidencia } | null */
    async buscar(municipio, departamento) {
      const ciudades = await this.ciudades();
      return emparejar(ciudades, municipio, departamento);
    },

    /** Oficina principal del municipio, o null si Inter no tiene (rapido). */
    async oficinaPrincipal(idCiudad) {
      const clave = `inter:principal:${idCiudad}`;
      const enCache = leer(clave);
      if (enCache !== undefined) return enCache;
      const datos = await pedir(
        `CentroServicio_CV/ObtenerOficinaPrincipalCiudad?idCiudad=${encodeURIComponent(idCiudad)}`,
      );
      const of = Array.isArray(datos) && datos.length ? datos[0] : null;
      return escribir(clave, of, TTL_OFICINA);
    },

    /** Bodega principal del municipio, o null (rapido). */
    async bodega(idCiudad) {
      const clave = `inter:bodega:${idCiudad}`;
      const enCache = leer(clave);
      if (enCache !== undefined) return enCache;
      const datos = await pedir(
        `CentroServicio_CV/ObtenerBodegaPrincipalPorCiudad?idCiudad=${encodeURIComponent(idCiudad)}`,
      );
      return escribir(clave, datos && datos.IdCentroServicio ? datos : null, TTL_OFICINA);
    },

    /** Dia de la semana actual (id 1=lunes .. 7=domingo), muy rapido. */
    async diaActual() {
      const clave = "inter:dia-actual";
      const enCache = leer(clave);
      if (enCache !== undefined) return enCache;
      const datos = await pedir("DiaSemana_CV/ObtenerDiaSemanaActual");
      const id = Number(datos?.Id) || null;
      return escribir(clave, { id, nombre: DIAS[id] ?? null }, TTL_DIA);
    },

    /**
     * LENTO (13-25 s): horarios de UNA oficina, cuerpo filtrado por
     * IdCentroServicio. Se llama desde segundo plano.
     */
    async horarios(idCiudad, oficina) {
      if (!oficina?.IdCentroServicio || !oficina.Latitud || !oficina.Longitud) return [];
      const ruta =
        `CentroServicio_CV/ObtenerCentrosServicioHorarios` +
        `?lat=${encodeURIComponent(oficina.Latitud)}&lng=${encodeURIComponent(oficina.Longitud)}` +
        `&idCiudad=${encodeURIComponent(idCiudad)}`;
      const datos = await pedir(
        ruta,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            {
              Id: 0,
              NombreTabla: "CentroServicio",
              Llaves: ["IdCentroServicio"],
              Valores: [oficina.IdCentroServicio],
              Operador: ["="],
            },
          ]),
        },
        timeoutLento(),
      );
      const lista = Array.isArray(datos) ? datos : [];
      const completa = lista.find((o) => o.IdCentroServicio === oficina.IdCentroServicio) || lista[0] || null;
      return mapearHorarios(completa?.HorariosCentroServio);
    },

    /**
     * Coordenadas de referencia para pedir un listado. Lo mas precisas que se
     * puedan: oficina principal -> bodega -> centro del pais. Ademas hacen
     * que el campo "Distancia" sirva para ordenar de mas cercana a mas lejana.
     */
    async referenciaCoords(idCiudad) {
      try {
        const principal = await this.oficinaPrincipal(idCiudad);
        if (principal?.Latitud && principal?.Longitud) {
          return { lat: principal.Latitud, lng: principal.Longitud };
        }
      } catch {
        /* sin principal seguimos con lo que haya */
      }
      try {
        const bodega = await this.bodega(idCiudad);
        if (bodega?.Latitud && bodega?.Longitud) return { lat: bodega.Latitud, lng: bodega.Longitud };
      } catch {
        /* ... */
      }
      return { ...CENTRO_PAIS };
    },

    /**
     * LENTO (13-25 s): TODAS las oficinas del municipio con sus horarios.
     *
     * Inter contesta [] de vez en cuando sin mas (medido el 2026-10-04 con
     * Cartagena, cuatro veces seguidas), por eso:
     *   1. se baja con las coordenadas de referencia + idCiudad
     *   2. si viene vacio, se reintenta una vez
     *   3. si aun asi viene vacio, se usa la oficina principal (GET rapido)
     *   4. si no hay nada, se devuelve vacio con "aviso" (cache corto)
     *
     * Devuelve { oficinas, oficina, horarios, total, origen, aviso? }; los dos
     * primeros campos enriquecen tambien a resolverOficina (mismo cache).
     */
    async oficinasPorListado(idCiudad) {
      const ref = await this.referenciaCoords(idCiudad);
      const ruta =
        `CentroServicio_CV/ObtenerCentrosServicioHorarios` +
        `?lat=${ref.lat}&lng=${ref.lng}&idCiudad=${encodeURIComponent(idCiudad)}`;
      const opciones = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      };

      const bajar = async () => {
        const datos = await pedir(ruta, opciones, timeoutLento());
        return Array.isArray(datos) ? datos : [];
      };

      let crudas = await bajar();
      if (!crudas.length) {
        await new Promise((res) => setTimeout(res, 1500));
        crudas = await bajar();
      }

      const orden = (a, b) => {
        if (typeof a.distancia === "number" && typeof b.distancia === "number") {
          return a.distancia - b.distancia;
        }
        return String(a.nombre ?? "").localeCompare(String(b.nombre ?? ""));
      };

      const oficinas = crudas
        .map((o) => ({ ...mapearOficina(o), horarios: mapearHorarios(o.HorariosCentroServio) }))
        .sort(orden);
      const conHorario = oficinas.find((o) => o.horarios.length) || oficinas[0] || null;

      if (oficinas.length) {
        return {
          oficinas,
          oficina: conHorario,
          horarios: conHorario?.horarios ?? [],
          total: oficinas.length,
          origen: "listado",
        };
      }

      // 3) respaldo: al menos la oficina principal del municipio
      try {
        const principal = await this.oficinaPrincipal(idCiudad);
        if (principal) {
          const of = { ...mapearOficina(principal), horarios: mapearHorarios(principal.HorariosCentroServio) };
          return {
            oficinas: [of],
            oficina: of,
            horarios: of.horarios,
            total: null,
            origen: "principal",
            aviso: "Inter no devolvio el listado de oficinas: se muestra solo la oficina principal.",
          };
        }
      } catch {
        /* sin principal nos quedamos en vacio */
      }

      return {
        oficinas: [],
        oficina: null,
        horarios: [],
        total: 0,
        origen: "vacio",
        aviso: "Inter no devolvio las oficinas de este municipio ahora mismo; pulsa Reintentar en unos segundos.",
      };
    },

    /** ids de LucidSales -> nombres. idCiudad opcional (solo departamento). */
    async nombresDeIds({ pais = 47, idDepartamento, idCiudad }) {
      const estados = await pedirLucid(`/tools/getCountryState?country=${encodeURIComponent(pais)}`);
      const listaDep = Array.isArray(estados?.states) ? estados.states : [];
      const dep = listaDep.find((s) => String(s.id) === String(idDepartamento));
      if (!dep) {
        throw new ErrorApi(400, `LucidSales no conoce el departamento ${idDepartamento} (pais ${pais})`);
      }

      if (idCiudad === undefined || idCiudad === null || idCiudad === "") {
        return { pais, departamento: dep.name, municipio: null, idDepartamento: dep.id, idCiudadLucid: null };
      }

      const ciudades = await pedirLucid(`/tools/getStateCity?state=${encodeURIComponent(dep.id)}`);
      const lista = Array.isArray(ciudades?.cities) ? ciudades.cities : [];
      const ciu = lista.find((c) => String(c.id) === String(idCiudad));
      if (!ciu) {
        throw new ErrorApi(400, `LucidSales no conoce la ciudad ${idCiudad} del departamento ${dep.name}`);
      }
      return {
        pais,
        departamento: dep.name,
        municipio: ciu.name,
        idDepartamento: dep.id,
        idCiudadLucid: ciu.id,
      };
    },

    /**
     * Orquestador usado por el servidor (respuesta rapida):
     *   ?idCiudad=05001000            (id de Inter)
     *   ?municipio=Medellin&departamento=Antioquia
     *   ?municipio=71&departamento=2&pais=47   (ids de LucidSales)
     *   ?departamento=Antioquia        -> cabecera del departamento
     *
     * "pendiente" indica que algo (oficina por listado / horarios) se esta
     * cargando en segundo plano: el cliente vuelve a consultar y ya lo trae.
     * "reintentar=1" borra el ultimo fallo y lanza la tarea otra vez.
     */
    /**
     * Resuelve los parametros comunes de /oficina y /oficinas a un municipio
     * de Inter (ver resolverOficina para la lista de formas de llamar).
     *
     * Devuelve { idCiudad, consultado, reintentar } o, si el municipio no esta
     * catalogado, { idCiudad: null, consultado, reintentar, msg }.
     */
    async resolverMunicipio(params = {}) {
      const pais = params.pais !== undefined && params.pais !== "" ? params.pais : 47;
      const reintentar = params.reintentar !== undefined && params.reintentar !== "" && params.reintentar !== "0";
      let municipio = params.municipio ?? params.ciudad ?? "";
      let departamento = params.departamento ?? "";
      const idCiudad = params.idCiudad ?? "";

      if (idCiudad) {
        if (!/^\d{5,8}$/.test(String(idCiudad))) {
          throw new ErrorApi(400, `idCiudad invalido: ${idCiudad} (se espera algo como 05001000)`);
        }
        return {
          idCiudad,
          reintentar,
          consultado: { origen: "idCiudad", idCiudad, coincidencia: "directa" },
        };
      }

      const municipioEsId = esNumero(municipio);
      const departamentoEsId = esNumero(departamento);
      let consultado;

      if (municipioEsId || departamentoEsId) {
        if (!departamentoEsId) {
          throw new ErrorApi(
            400,
            "Si municipio viene como id de LucidSales, departamento debe venir tambien como id",
          );
        }
        const nombres = await this.nombresDeIds({
          pais,
          idDepartamento: departamento,
          idCiudad: municipioEsId ? municipio : undefined,
        });
        municipio = nombres.municipio ?? "";
        departamento = nombres.departamento;
        consultado = { origen: "ids lucidsales", ...nombres };
      } else {
        consultado = { origen: "nombres" };
      }

      if (!municipio && !departamento) {
        throw new ErrorApi(
          400,
          "Falta el municipio: usa ?municipio=...&departamento=..., ?municipio=<id>&departamento=<id> o ?idCiudad=...",
        );
      }

      const r = await this.buscar(municipio, departamento);
      if (!r) {
        return {
          idCiudad: null,
          reintentar,
          consultado: {
            ...consultado,
            municipio: municipio || null,
            departamento: departamento || null,
            pais,
            idCiudad: null,
            coincidencia: "ninguna",
          },
          msg: `Inter Rapidisisimo no tiene catalogado "${municipio || departamento}"`,
        };
      }

      return {
        idCiudad: r.ciudad.IdCiudad,
        reintentar,
        consultado: {
          ...consultado,
          municipio: municipio || r.ciudad.Descripcion,
          departamento: departamento || r.ciudad.Departamento,
          pais,
          idCiudad: r.ciudad.IdCiudad,
          coincidencia: r.coincidencia,
          listado: r.ciudad.Descripcion,
          depListado: r.ciudad.Departamento,
        },
      };
    },

    /**
     * Orquestador de la tarjeta del panel (respuesta rapida). Ver
     * resolverMunicipio para las formas de llamar.
     *
     * "pendiente" indica que algo (oficina por listado / horarios) se esta
     * cargando en segundo plano: el cliente vuelve a consultar y ya lo trae.
     * "reintentar=1" borra el ultimo fallo y lanza la tarea otra vez.
     */
    async resolverOficina(params = {}) {
      const resuelto = await this.resolverMunicipio(params);
      const { consultado, reintentar } = resuelto;
      const idCiudad = resuelto.idCiudad;

      if (!idCiudad) {
        return {
          consultado,
          oficina: null,
          horarios: [],
          bodega: null,
          diaActual: null,
          pendiente: null,
          msg: resuelto.msg ?? "Sin municipio",
        };
      }

      if (reintentar) {
        fallos.delete(`inter:listado:${idCiudad}`);
        fallos.delete(`inter:horarios:${idCiudad}`);
      }

      // ---- ruta rapida: oficina principal, bodega y dia ----
      const principal = await this.oficinaPrincipal(idCiudad);

      let oficina = principal ? mapearOficina(principal) : null;
      let horarios = [];
      let totalOficinas = null;
      let pendiente = null;
      let aviso = null;

      if (principal) {
        const clave = `inter:horarios:${idCiudad}`;
        const guardados = leer(clave);
        if (guardados !== undefined) {
          horarios = guardados;
        } else {
          const fallo = falloReciente(clave);
          if (fallo) aviso = `Sin horarios: ${fallo}`;
          else {
            pendiente = "horarios";
            const of = principal;
            enSegundoPlano(clave, async () => {
              const h = await this.horarios(idCiudad, of);
              escribir(clave, h, TTL_OFICINA);
              return h;
            });
          }
        }
      } else {
        // Inter no expone "oficina principal" para este municipio: hay que
        // bajar el listado completo (lento). Se hace en segundo plano.
        const clave = `inter:listado:${idCiudad}`;
        const guardado = leer(clave);
        if (guardado !== undefined) {
          oficina = guardado.oficina;
          horarios = guardado.horarios;
          totalOficinas = guardado.total;
        } else {
          const fallo = falloReciente(clave);
          if (fallo) aviso = `Sin oficina: ${fallo}`;
          else {
            pendiente = "oficina";
            enSegundoPlano(clave, async () => {
              const r = await this.oficinasPorListado(idCiudad);
              escribir(clave, r, TTL_OFICINA);
              return r;
            });
          }
        }
      }

      let bodega = null;
      let diaActual = null;
      try {
        bodega = await this.bodega(idCiudad);
        diaActual = await this.diaActual();
      } catch (err) {
        // la bodega y el dia son decorativos: no rompen la respuesta
        if (!pendiente && !aviso) aviso = `Datos extra no disponibles: ${err?.message ?? err}`;
      }

      return {
        consultado,
        oficina,
        horarios,
        bodega: bodega
          ? {
              nombre: bodega.Nombre ?? null,
              direccion: bodega.Direccion ?? null,
              barrio: bodega.Barrio ?? null,
              telefono1: bodega.Telefono1 ?? null,
              lat: bodega.Latitud ?? null,
              lng: bodega.Longitud ?? null,
            }
          : null,
        diaActual,
        totalOficinas,
        pendiente,
        ...(aviso ? { aviso } : {}),
        ...(!oficina && !pendiente ? { msg: `El municipio ${idCiudad} no tiene oficina registrada en Inter Rapidisisimo` } : {}),
      };
    },

    /**
     * TODAS las oficinas del municipio (GET /api/interrapidisimo/oficinas).
     * Mismo circuito que resolverOficina: respuesta rapida y lo lento
     * (el POST de Inter) en segundo plano con "pendiente: listado".
     */
    async listarOficinas(params = {}) {
      const r = await this.resolverMunicipio(params);
      const base = {
        consultado: r.consultado,
        idCiudad: r.idCiudad ?? null,
        origen: null,
        oficinas: [],
        total: 0,
        enInter: null,
        diaActual: null,
        bodega: null,
      };

      if (!r.idCiudad) {
        return { ...base, pendiente: null, msg: r.msg ?? "Sin municipio" };
      }

      const idCiudad = r.idCiudad;
      const clave = `inter:listado:${idCiudad}`;
      if (r.reintentar) {
        // reintentar=1 borra fallo y cache: la proxima vuelve a bajarse
        fallos.delete(clave);
        cache.delete(clave);
      }

      const guardado = leer(clave);
      if (guardado !== undefined) return this.armarListado(r.consultado, idCiudad, guardado);

      const fallo = falloReciente(clave);
      if (fallo) return { ...base, pendiente: null, aviso: `Sin listado de oficinas: ${fallo}` };

      enSegundoPlano(clave, async () => {
        const x = await this.oficinasPorListado(idCiudad);
        // vacio = Inter contesto raro: cache corto para poder repetir pronto
        escribir(clave, x, x.oficinas.length ? TTL_OFICINA : TTL_VACIO);
        return x;
      });

      return { ...base, pendiente: "listado" };
    },

    /**
     * TODAS las oficinas del municipio, esperando el listado (13-25 s la
     * primera vez; luego sale de la misma cache de 1 h que /oficinas). Lo usa
     * la subida para saber si la direccion del cliente es una oficina.
     * -> { idCiudad, oficinas: [{id, nombre, direccion, barrio}] } o
     *    { idCiudad: null, oficinas: [], msg }
     */
    async oficinasCompletas(params = {}) {
      const r = await this.resolverMunicipio(params);
      if (!r.idCiudad) return { idCiudad: null, oficinas: [], msg: r.msg ?? "municipio no encontrado en Inter" };
      const clave = `inter:listado:${r.idCiudad}`;
      let x = leer(clave);
      if (x === undefined) {
        x = await this.oficinasPorListado(r.idCiudad);
        escribir(clave, x, x.oficinas?.length ? TTL_OFICINA : TTL_VACIO);
      }
      const oficinas = (x.oficinas ?? (x.oficina ? [x.oficina] : [])).map((o) => ({
        id: o.id ?? null,
        nombre: o.nombre ?? "",
        direccion: o.direccion ?? "",
        barrio: o.barrio ?? "",
      }));
      return { idCiudad: r.idCiudad, oficinas };
    },

    /** El listado cacheado convertido en respuesta (mas dia y bodega). */
    async armarListado(consultado, idCiudad, guardado) {
      const [diaActual, bodega] = await Promise.all([
        this.diaActual().catch(() => null),
        this.bodega(idCiudad).catch(() => null),
      ]);
      const oficinas = (guardado.oficinas ?? (guardado.oficina ? [guardado.oficina] : [])).map((o) => ({
        ...o,
        horarioHoy:
          diaActual?.id != null
            ? (o.horarios ?? []).find((h) => h.idDia === diaActual.id)?.franjas ?? []
            : [],
      }));

      return {
        consultado,
        idCiudad,
        origen: guardado.origen ?? "listado",
        oficinas,
        total: oficinas.length,
        enInter: guardado.total ?? null,
        diaActual,
        bodega: bodega
          ? {
              nombre: bodega.Nombre ?? null,
              direccion: bodega.Direccion ?? null,
              barrio: bodega.Barrio ?? null,
              telefono1: bodega.Telefono1 ?? null,
              lat: bodega.Latitud ?? null,
              lng: bodega.Longitud ?? null,
            }
          : null,
        pendiente: null,
        ...(guardado.aviso ? { aviso: guardado.aviso } : {}),
        ...(oficinas.length
          ? {}
          : {
              msg: `Inter no devolvio oficinas de ${consultado.municipio ?? consultado.listado ?? idCiudad}`,
            }),
      };
    },

    /** Solo para las pruebas. */
    _cache: cache,
    _fallos: fallos,
  };
}
