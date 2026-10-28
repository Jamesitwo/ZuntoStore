import { useEffect, useState } from "react";
import { SubirMedia } from "./SubirMedia";
import { errMsg, pickArray } from "../api/client";
import { auth, meta, productos } from "../api/endpoints";
import { prodImg, prodImgs, prodPrice } from "../lib/catalogo";
import {
  armarCuerpoProducto,
  arreglo,
  campanasGuardadas,
  CLAVES_UPDATE,
  combinaciones,
  contenidoInicialPaso,
  formaDePaso,
  LIMITE_COMBINACIONES,
  normalizarCampanas,
  parsearMensajeInicial,
  parsearTestimonios,
  serializarMensajeInicial,
  serializarTestimonios,
  TIPOS_INICIAL,
  tipoArchivo,
  type CampanaMeta,
  type PasoInicial,
} from "../lib/productos";
import { ConfirmDialog, Modal } from "./Modal";
import { EditorTestimonios } from "./Testimonios";
import { skuAleatorio } from "../lib/dropi";
import { Campo, ErrorBanner, Spinner, money } from "./ui";
import { useToast } from "./Toast";

/**
 * Lista de productos de la tienda con crear / editar / eliminar.
 *
 * Endpoints (screen oficial ProductosListScreen + ProductoScreen):
 *   GET  /productos/getProductos?page&itemsPerPage&search&filters
 *   GET  /productos/getproducto/{id}
 *   POST /productos/addproducto/      {nombre, valor, pais, sku, bundle}
 *   POST /productos/updateproducto    (cuerpo completo, ver doc §3.5)
 *   POST /productos/deleteproducto    {idProducto}
 *
 * Si la lista paginada no responde, se respalda con el catalogo
 * POST /productos/getproductos y se pagina/filtra en cliente.
 */
const PAGINAS = [10, 20, 50];

/** El oficial manda `pais: shopInfo.pais`; lo leemos de getshopname (o 47). */
async function paisTienda(idEmpresa: number): Promise<number> {
  try {
    const r: any = await auth.shopNames([idEmpresa]);
    const arr = Array.isArray(r?.shopName) ? r.shopName : [];
    const fila =
      arr.find((s: any) => String(s?.id) === String(idEmpresa)) ?? arr[0] ?? null;
    const v = Number(fila?.selCountryId ?? fila?.Pais ?? fila?.pais ?? fila?.country);
    return Number.isFinite(v) && v > 0 ? v : 47;
  } catch {
    return 47;
  }
}

/** sku aleatorio de 12 caracteres (el oficial genera uno por variante). */
function sku12(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/** "null" (string) y undefined -> "" para pintar en los inputs. */
function texto(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return s === "null" ? "" : s;
}

/** `AdsMetaTags` (array o JSON string) -> string[] de adId. */
function listaDe(v: unknown): string[] {
  let datos: unknown = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "null") return [];
    try {
      datos = JSON.parse(t);
    } catch {
      return [t]; // un id suelto escrito a mano
    }
  }
  if (!Array.isArray(datos)) return [];
  return datos.map((x) => String(x)).filter(Boolean);
}

/** Fila de preguntas frecuentes (con o sin acentos en las claves). */
function normalizaPregunta(x: any): { pregunta: string; respuesta: string } {
  return {
    pregunta: String(x?.pregunta ?? x?.question ?? ""),
    respuesta: String(x?.respuesta ?? x?.answer ?? ""),
  };
}

/** Set de las claves que updateproducto acepta (para marcar el resto). */
const ES_OFICIAL = new Set<string>(CLAVES_UPDATE);

/** 1 / "1" / true -> true (interruptores). */
function aBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true" || v === "si";
}

/** Interruptores editables: todas son flags 1/0 dentro de las 87 claves. */
const OPS: Array<[string, string]> = [
  ["disponibilidadProductoLucidBot", "Visible en Lucid Bot"],
  ["disponibilidadProductoLandingPage", "Visible en la landing"],
  ["optLanding", "Landing page"],
  ["optEcommerce", "Ecommerce"],
  ["optMayoristas", "Precios mayoristas"],
  ["optAppMovil", "App móvil"],
  ["optSuperBodega", "Superbodega"],
  ["optSuperBodegaPrivado", "Superbodega privada"],
  ["optCombVariantes", "Combinar variantes"],
  ["manageFormEmail", "Pedir email en el formulario"],
  ["manageFormDocument", "Pedir documento en el formulario"],
  ["personalizarMensajeInicial", "Mensaje inicial personalizado"],
  ["personalizarUpSell", "Upsell personalizado"],
];

/** Valor legible para la tabla de "todos los campos" (JSON indentado si lo es). */
function valorLegible(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  const s = String(v);
  if (/^[[{]/.test(s.trim())) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      /* no es JSON */
    }
  }
  return s;
}

export function ListaProductos({
  idEmpresa,
  editarId,
  onEditado,
}: {
  idEmpresa: number;
  /** id de producto a abrir directamente (/productos?editar=…) */
  editarId?: string;
  /** avisa para limpiar la url y que un refresh no lo reabra */
  onEditado?: () => void;
}) {
  const toast = useToast();

  const [filas, setFilas] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [textoBuscar, setTextoBuscar] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [respaldo, setRespaldo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // crear
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", valor: "0" });
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [errNuevo, setErrNuevo] = useState<string | null>(null);

  // editar
  const [editando, setEditando] = useState<{ id: string | number } | null>(null);
  const [ficha, setFicha] = useState<any>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [form, setForm] = useState({
    nombre: "",
    precio: "",
    precioBodega: "",
    precioSugerido: "",
    stock: "",
    ciudad: "",
    descCorta: "",
    descripcion: "",
    modoDeUso: "",
    caracteristicas: "",
    contenido: "",
    linkAudioVisual: "",
    fbPixel: "",
    tiktokPixel: "",
    googlePixel: "",
    pregVideos: "",
    pregImagenes: "",
    pregTestimonios: "",
    idDropi: "",
    nameDropi: "",
  });
  const [ops, setOps] = useState<Record<string, boolean>>({});
  // validacion del id de Dropi (se escribe y se valida antes de aplicarlo)
  const [dropiTexto, setDropiTexto] = useState("");
  const [dropiCargando, setDropiCargando] = useState(false);
  const [dropiRes, setDropiRes] = useState<{ ok: boolean; msg: string; product?: any } | null>(null);
  // mensaje inicial (secuencia de bienvenida del bot)
  const [inicial, setInicial] = useState<PasoInicial[]>([]);
  /**
   * Mensajes iniciales "nuevos" de LucidSales (initialMessages: versiones A,
   * B... con sus ventas). Se muestran, pero se guardan con otro endpoint que
   * aun no esta conectado: mientras tanto el MensajeInicial viejo no se toca.
   */
  const [inicialNuevo, setInicialNuevo] = useState<{
    legado: unknown;
    /** initialMessages tal como llegaron (para saber que cambio) */
    original: any[];
    /** versiones de trabajo: letter, enabled, id, sales, views... (message se arma al guardar) */
    versiones: any[];
    /** pasos de cada version (la que se edita vive en `inicial`) */
    pasos: PasoInicial[][];
    actual: number;
    max: number;
  } | null>(null);
  /** Pasos de todas las versiones con lo que se esta editando incluido. */
  const pasosVersiones = () =>
    inicialNuevo ? inicialNuevo.pasos.map((x, i) => (i === inicialNuevo.actual ? inicial : x)) : [];
  /** Cambia la version (A, B...) que se edita, guardando lo editado de la otra. */
  const verVersion = (k: number) => {
    if (!inicialNuevo || k === inicialNuevo.actual) return;
    const pasos = pasosVersiones();
    setInicialNuevo({ ...inicialNuevo, pasos, actual: k });
    setInicial(pasos[k] ?? []);
  };
  /** Nueva version: copia de la que se esta viendo, con la siguiente letra libre. */
  const nuevaVersion = () => {
    if (!inicialNuevo || inicialNuevo.versiones.length >= inicialNuevo.max) return;
    const usadas = new Set(inicialNuevo.versiones.map((v) => String(v.letter)));
    const letra = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !usadas.has(l)) ?? String(inicialNuevo.versiones.length + 1);
    const pasos = [...pasosVersiones(), inicial.map((x, i) => ({ ...x, id: Date.now() + i }))];
    const versiones = [...inicialNuevo.versiones, { letter: letra, sales: 0, views: 0, enabled: true }];
    setInicialNuevo({ ...inicialNuevo, versiones, pasos, actual: versiones.length - 1 });
    setInicial(pasos[pasos.length - 1]);
  };
  const activarVersion = (k: number, enabled: boolean) => {
    if (!inicialNuevo) return;
    setInicialNuevo({ ...inicialNuevo, versiones: inicialNuevo.versiones.map((v, i) => (i === k ? { ...v, enabled } : v)) });
  };
  const borrarVersion = (k: number) => {
    if (!inicialNuevo || inicialNuevo.versiones.length <= 1) return;
    const v = inicialNuevo.versiones[k];
    if (!window.confirm(`¿Borrar la versión ${v?.letter ?? ""}${v?.sales ? ` (lleva ${v.sales} venta(s))` : ""}? Se borra al guardar el producto.`)) return;
    const pasos = pasosVersiones().filter((_, i) => i !== k);
    const versiones = inicialNuevo.versiones.filter((_, i) => i !== k);
    const actual = Math.min(inicialNuevo.actual === k ? 0 : inicialNuevo.actual > k ? inicialNuevo.actual - 1 : inicialNuevo.actual, versiones.length - 1);
    setInicialNuevo({ ...inicialNuevo, versiones, pasos, actual });
    setInicial(pasos[actual] ?? []);
  };

  // campanas de Meta (ads)
  const [cargandoCamp, setCargandoCamp] = useState(false);
  const [campCargadas, setCampCargadas] = useState(false);
  const [campanas, setCampanas] = useState<CampanaMeta[]>([]);
  const [campSel, setCampSel] = useState<CampanaMeta[]>([]);
  const [textoCamp, setTextoCamp] = useState("");
  const [errCamp, setErrCamp] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [nuevoTag, setNuevoTag] = useState("");
  // variantes: atributos/opciones + precio por combinacion
  const [variantes, setVariantes] = useState<any[]>([]);
  const [mixed, setMixed] = useState<any[]>([]);
  // reglas y preguntas frecuentes
  const [reglas, setReglas] = useState<string[]>([]);
  const [faq, setFaq] = useState<Array<{ pregunta: string; respuesta: string }>>([]);
  const [faqPost, setFaqPost] = useState<Array<{ pregunta: string; respuesta: string }>>([]);
  // testimonios: pasos {type, content, id} (mismo formato que el mensaje inicial)
  const [testi, setTesti] = useState<PasoInicial[]>([]);
  // bundles (se guardan aparte: POST /productos/updatebundle)
  const [bundles, setBundles] = useState<any[]>([]);
  const [bundleVar, setBundleVar] = useState<any[]>([]);
  // variaciones del producto en Dropi (para vincular cada combinacion)
  const [varDropi, setVarDropi] = useState<{ id: string; name: string; stock: number | null }[]>([]);
  const idProdDropi = String(ficha?.idProductoDropi ?? "").replace(/\D/g, "");
  useEffect(() => {
    setVarDropi([]);
    if (!idProdDropi || idProdDropi === "0") return;
    let cancel = false;
    productos
      .variantesDropi(idProdDropi)
      .then((r: any) => {
        if (cancel) return;
        const lista = (Array.isArray(r?.variantes) ? r.variantes : [])
          .filter((v: any) => Number(v?.id) > 0)
          .map((v: any) => ({ id: String(v.id), name: String(v.name ?? "").trim(), stock: v.stock ?? null }));
        setVarDropi(lista);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [idProdDropi]);
  const [bundlesSucios, setBundlesSucios] = useState(false);
  const [guardandoBundles, setGuardandoBundles] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errEdit, setErrEdit] = useState<string | null>(null);

  // eliminar
  const [borrando, setBorrando] = useState<any | null>(null);
  const [borrandoOk, setBorrandoOk] = useState(false);

  const refrescar = () => setRecarga((r) => r + 1);

  /* ---------------- carga ---------------- */
  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r: any = await productos.listPage({
          page: pagina,
          itemsPerPage: porPagina,
          search: busqueda,
        });
        if (cancel) return;
        if (!Array.isArray(r?.productos)) throw new Error(r?.msg || "Respuesta inesperada");
        setFilas(r.productos);
        setTotal(Number(r.totalRecords ?? r.productos.length));
        setRespaldo(false);
      } catch (e1) {
        if (cancel) return;
        // respaldo: catalogo completo y se pagina/filtra aqui mismo
        try {
          const c: any = await productos.list(idEmpresa);
          if (cancel) return;
          const todas = pickArray(c, ["productos", "products", "data"]);
          const q = busqueda.trim().toLowerCase();
          const f = q
            ? todas.filter((p: any) =>
                [p?.Nombre, p?.nombre, p?.name, p?.sku, p?.SKU]
                  .filter(Boolean)
                  .some((x: any) => String(x).toLowerCase().includes(q)),
              )
            : todas;
          if (cancel) return;
          const ini = (pagina - 1) * porPagina;
          setFilas(f.slice(ini, ini + porPagina));
          setTotal(f.length);
          setRespaldo(true);
        } catch (e2) {
          if (cancel) return;
          setFilas([]);
          setTotal(0);
          setError(errMsg(e2));
        }
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [pagina, porPagina, busqueda, recarga, idEmpresa]);

  // apertura directa desde un pedido: /productos?editar=<id>
  useEffect(() => {
    if (!editarId) return;
    void abrir(editarId);
    onEditado?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editarId]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  const buscar = () => {
    const s = textoBuscar.trim();
    if (s === busqueda && pagina === 1) refrescar();
    else {
      setPagina(1);
      setBusqueda(s);
    }
  };

  /* ---------------- crear ---------------- */
  const crear = async () => {
    const nombre = nuevo.nombre.trim();
    const valor = String(nuevo.valor ?? "").trim();
    if (!nombre) {
      setErrNuevo("Escribe el nombre del producto");
      return;
    }
    if (!valor || Number.isNaN(Number(valor))) {
      setErrNuevo("Escribe un valor numerico");
      return;
    }
    setGuardandoNuevo(true);
    setErrNuevo(null);
    try {
      const pais = await paisTienda(idEmpresa);
      const r: any = await productos.add({
        nombre,
        valor,
        pais,
        sku: "",
        // primera variante, igual que el modal oficial
        bundle: [
          {
            cant: 1,
            default: true,
            hide: false,
            name: "1 Unidad",
            precio: valor,
            resaltar: false,
            sku: sku12(),
            texto: "",
            imagenes: [],
          },
        ],
      });
      if (r?.ok === false || r?.error) throw new Error(r?.msg || r?.error || "No se pudo crear");
      toast.success(r?.msg || "Producto creado");
      setCreando(false);
      setNuevo({ nombre: "", valor: "0" });
      refrescar();
      // como el oficial: tras crear te lleva a la edicion
      if (r?.insertID) void abrir(r.insertID);
    } catch (e) {
      const m = errMsg(e);
      setErrNuevo(m);
      toast.error(m);
    } finally {
      setGuardandoNuevo(false);
    }
  };

  /* ---------------- editar ---------------- */
  const abrir = async (id: string | number) => {
    setEditando({ id });
    setFicha(null);
    setErrEdit(null);
    setCargandoFicha(true);
    try {
      const r: any = await productos.get(id);
      if (r?.ok === false) throw new Error(r?.msg || "No se pudo cargar el producto");
      const p = r?.product ?? r?.producto ?? r?.data ?? r;
      setFicha(p);
      const precioRaw = p?.Precio ?? p?.precio ?? prodPrice(p);
      setForm({
        nombre: texto(p?.Nombre),
        precio: precioRaw === undefined || precioRaw === null ? "" : String(precioRaw),
        precioBodega: texto(p?.precioBodega),
        precioSugerido: texto(p?.precioSugerido),
        stock: p?.stock === undefined || p?.stock === null ? "" : String(p.stock),
        ciudad: p?.Ciudad === undefined || p?.Ciudad === null ? "" : String(p.Ciudad),
        descCorta: texto(p?.DescripcionCorta),
        descripcion: texto(p?.Descripcion),
        modoDeUso: texto(p?.ModoDeUso),
        caracteristicas: texto(p?.CaracteristicasTecnicas),
        contenido: texto(p?.ContenidoPaquete),
        linkAudioVisual: texto(p?.linkAudioVisual),
        fbPixel: texto(p?.fbPixel),
        tiktokPixel: texto(p?.tiktokPixel),
        googlePixel: texto(p?.googlePixel),
        pregVideos: texto(p?.preguntaSeguimientoVideos),
        pregImagenes: texto(p?.preguntaSeguimientoImagenes),
        pregTestimonios: texto(p?.preguntaSeguimientoTestimonios),
        idDropi: texto(p?.idProductoDropi),
        nameDropi: texto(p?.nameProductoDropi),
      });
      setOps(Object.fromEntries(OPS.map(([k]) => [k, aBool(p?.[k])])));
      setDropiTexto(texto(p?.idProductoDropi));
      setDropiRes(null);
      // el GET lo trae como MensajeInicial (mayuscula); si no trae nada, []
      const legado = p?.MensajeInicial ?? p?.mensajeInicial;
      const versiones = (Array.isArray(p?.initialMessages) ? p.initialMessages : []).filter((m: any) => m && m.message);
      if (!parsearMensajeInicial(legado).length && versiones.length) {
        // version nueva: se edita la primera activa (o la A)
        const pasos = versiones.map((m: any) => parsearMensajeInicial(m.message));
        const k = Math.max(0, versiones.findIndex((m: any) => m.enabled !== false));
        setInicial(pasos[k] ?? []);
        setInicialNuevo({
          legado: legado ?? null,
          original: versiones,
          versiones: versiones.map(({ message: _m, ...resto }: any) => resto),
          pasos,
          actual: k,
          max: Number(p?.initialMessagesMax) > 0 ? Number(p.initialMessagesMax) : 20,
        });
      } else if (!parsearMensajeInicial(legado).length && p?.initialMessage) {
        setInicial(parsearMensajeInicial(p.initialMessage));
        setInicialNuevo(null);
      } else {
        setInicial(parsearMensajeInicial(legado));
        setInicialNuevo(null);
      }
      // campanas de Meta: lo guardado se muestra ya; el catalogo se pide al
      // abrir el desplegable (como el oficial, que lo carga al abrir la seccion)
      setCampSel(campanasGuardadas(p?.AdsMetaCampaigns));
      setTags(listaDe(p?.AdsMetaTags));
      setTextoCamp("");
      setErrCamp(null);
      setNuevoTag("");
      // el catalogo de campanas se pide ya, para que la seccion se vea llena
      // (se cachea: no se limpia al reabrir otro producto)
      void cargarCampanas();
      // variantes, reglas, preguntas y testimonios
      setVariantes(arreglo(p?.variantes));
      setMixed(arreglo(p?.mixedvariantes));
      setReglas(arreglo(p?.Reglas).map((r: unknown) => String(r ?? "")));
      setFaq(arreglo(p?.PreguntasFrecuentes).map(normalizaPregunta));
      setFaqPost(arreglo(p?.preguntasFrecuentesPostVenta).map(normalizaPregunta));
      setTesti(parsearTestimonios(p?.Testimonios));
      // bundles: llegan como JSON string (bundle) y array (bundleVariantes)
      setBundles(arreglo(p?.bundle));
      setBundleVar(arreglo(p?.bundleVariantes));
      setBundlesSucios(false);
    } catch (e) {
      setErrEdit(errMsg(e));
    } finally {
      setCargandoFicha(false);
    }
  };

  const guardar = async () => {
    if (!editando) return;
    const nombre = form.nombre.trim();
    if (!nombre) {
      setErrEdit("Escribe el nombre del producto");
      return;
    }
    setGuardando(true);
    setErrEdit(null);
    try {
      // 87 claves oficiales, rellenas con la ficha real + lo editado aqui
      // (ver src/lib/productos.ts: alias MensajeInicial->mensajeInicial, etc.)
      const stockNum = Number(form.stock);
      const ciudadNum = Number(form.ciudad);
      const edicion: Record<string, unknown> = {
        idProducto: editando.id,
        Nombre: nombre,
        Precio: form.precio.trim(),
        precioBodega: form.precioBodega.trim() || "0",
        precioSugerido: form.precioSugerido.trim() || "0",
        stock: form.stock.trim() === "" ? 0 : Number.isNaN(stockNum) ? form.stock : stockNum,
        Ciudad:
          form.ciudad.trim() === "" || Number.isNaN(ciudadNum) ? undefined : ciudadNum,
        DescripcionCorta: form.descCorta,
        Descripcion: form.descripcion,
        ModoDeUso: form.modoDeUso,
        CaracteristicasTecnicas: form.caracteristicas,
        ContenidoPaquete: form.contenido,
        linkAudioVisual: form.linkAudioVisual,
        fbPixel: form.fbPixel,
        tiktokPixel: form.tiktokPixel,
        googlePixel: form.googlePixel,
        preguntaSeguimientoVideos: form.pregVideos,
        preguntaSeguimientoImagenes: form.pregImagenes,
        preguntaSeguimientoTestimonios: form.pregTestimonios,
        idProductoDropi: form.idDropi.trim() === "" ? 0 : Number(form.idDropi) || 0,
        nameProductoDropi: form.nameDropi,
        // el GET lo trae como MensajeInicial; el alias lo manda como mensajeInicial
        // con los mensajes nuevos (A/B) el viejo se deja como estaba
        MensajeInicial: inicialNuevo ? (inicialNuevo.legado ?? "") : serializarMensajeInicial(inicial),
        // campanas de Meta y sus anuncios (los dos van serializados a JSON)
        AdsMetaCampaigns: campSel,
        AdsMetaTags: tags,
        // variantes, reglas, preguntas frecuentes y testimonios
        variantes,
        mixedvariantes: mixed,
        Reglas: reglas,
        PreguntasFrecuentes: faq,
        preguntasFrecuentesPostVenta: faqPost,
        Testimonios: serializarTestimonios(testi),
      };
      for (const [k] of OPS) edicion[k] = ops[k] ? 1 : 0;
      const cuerpo = armarCuerpoProducto(ficha, edicion);
      // mensajes iniciales nuevos (A/B): van en initialMessages, cada version
      // con su `message` (JSON string, igual que llega en el GET)
      let enviadas: any[] | null = null;
      if (inicialNuevo) {
        const pasos = pasosVersiones();
        const versiones = inicialNuevo.versiones.map((v, i) => ({ ...v, message: serializarMensajeInicial(pasos[i] ?? []) }));
        // solo se mandan si algo cambio (texto, activa/apagada, nuevas o borradas)
        const huella = (arr: any[]) =>
          JSON.stringify(arr.map((v) => [String(v.letter), v.enabled !== false, serializarMensajeInicial(parsearMensajeInicial(v.message))]));
        if (huella(versiones) !== huella(inicialNuevo.original)) {
          cuerpo.initialMessages = versiones;
          enviadas = versiones;
        }
      }

      const r: any = await productos.update(cuerpo);
      if (r?.ok === false || r?.error)
        throw new Error(r?.msg || (typeof r?.error === "string" ? r.error : "No se pudo guardar"));
      toast.success("Producto actualizado");
      // ¿LucidSales guardo los mensajes iniciales? se vuelve a leer y se compara
      if (enviadas) {
        try {
          const g: any = await productos.get(editando.id);
          const prod = g?.producto ?? g?.product ?? g;
          const ahora = Array.isArray(prod?.initialMessages) ? prod.initialMessages : [];
          const clave = (v: any) => `${String(v.letter)}|${v.enabled !== false}|${serializarMensajeInicial(parsearMensajeInicial(v.message))}`;
          const quedo = ahora.length === enviadas.length && enviadas.every((v) => ahora.some((x: any) => clave(x) === clave(v)));
          if (quedo) toast.success("Mensajes iniciales guardados");
          else
            toast.error(
              "LucidSales guardó el producto pero los mensajes iniciales no quedaron igual (versiones nuevas, apagadas o borradas). Pásale a Claude la Carga útil de updateproducto del panel oficial.",
            );
        } catch {
          /* no se pudo comprobar */
        }
      }
      // si se tocaron los bundles, se guardan tambien (otro endpoint)
      if (bundlesSucios) await guardarBundles();
      setEditando(null);
      setFicha(null);
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErrEdit(m);
      toast.error(m);
    } finally {
      setGuardando(false);
    }
  };

  /* ---------------- eliminar ---------------- */
  const eliminar = async () => {
    if (!borrando) return;
    setBorrandoOk(true);
    try {
      const r: any = await productos.remove(borrando.id ?? borrando.idProducto);
      if (r?.error) throw new Error(typeof r.error === "string" ? r.error : "No se pudo eliminar");
      if (r?.ok === false) throw new Error(r?.msg || "No se pudo eliminar");
      toast.success("Producto eliminado");
      setBorrando(null);
      if (filas.length === 1 && pagina > 1) setPagina(pagina - 1);
      else refrescar();
    } catch (e) {
      const m = errMsg(e);
      toast.error(m);
      setBorrando(null);
    } finally {
      setBorrandoOk(false);
    }
  };

  /* ---------------- Dropi ---------------- */
  /**
   * GET /productos/validateDropiId/{id} -> {ok, msg,
   * product:{id,name,stock,cod_dane,private_product}}.
   *
   * Ademas de validar, **vincula de verdad**: en cuanto responde ok se guarda
   * el enlace con updateproducto (solo el id y el nombre vienen de lo escrito;
   * el resto del cuerpo sale de la ficha, asi no se cuela ninguna edicion
   * pendiente). El id escrito y sin validar no se llega a guardar nunca.
   */
  const validarDropi = async () => {
    const id = dropiTexto.trim().replace(/\D/g, "");
    if (!id) {
      setDropiRes({ ok: false, msg: "Escribe el id del producto en Dropi" });
      return;
    }
    if (!ficha) return;
    setDropiCargando(true);
    setDropiRes(null);
    try {
      const r: any = await productos.validateDropiId(id);
      if (!r?.ok || !r?.product) {
        setDropiRes({ ok: false, msg: r?.msg || "No fue posible validar el producto en Dropi." });
        return;
      }
      const p = r.product;
      const nuevoId = Number(p.id ?? id) || 0;
      const nombre = texto(p.name);

      // 1) guardar el enlace (cuerpo de 87 claves montado desde la ficha)
      const cuerpo = armarCuerpoProducto(ficha, {
        idProductoDropi: nuevoId,
        nameProductoDropi: nombre,
      });
      const g: any = await productos.update(cuerpo);
      if (g?.ok === false || g?.error) {
        throw new Error(
          g?.msg || (typeof g?.error === "string" ? g.error : "No se pudo guardar el enlace"),
        );
      }

      // 2) reflejarlo en la ficha y en el formulario
      setFicha((f: any) => (f ? { ...f, idProductoDropi: nuevoId, nameProductoDropi: nombre } : f));
      setForm((f) => ({ ...f, idDropi: String(nuevoId), nameDropi: nombre }));
      setDropiRes({
        ok: true,
        msg: `${r.msg || "El producto fue encontrado"} · vinculado y guardado`,
        product: p,
      });
      toast.success("Producto vinculado en Dropi");
    } catch (e) {
      const m = errMsg(e);
      setDropiRes({ ok: false, msg: m });
      toast.error(m);
    } finally {
      setDropiCargando(false);
    }
  };

  /**
   * El oficial copia `cod_dane` a `Ciudad` al enlazar; aqui lo dejamos como
   * sugerencia (un clic) para no cambiar la ciudad de despacho sin querer.
   */
  const aplicarCiudadDropi = () => {
    const c = dropiRes?.product?.cod_dane;
    if (c === undefined || c === null || c === "") return;
    setForm((f) => ({ ...f, ciudad: String(c) }));
  };

  /* ---------------- mensaje inicial ---------------- */
  const cambiaPaso = (i: number, patch: Partial<PasoInicial>) =>
    setInicial((arr) => arr.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const quitaPaso = (i: number) => setInicial((arr) => arr.filter((_, k) => k !== i));

  const muevePaso = (i: number, d: number) =>
    setInicial((arr) => {
      const j = i + d;
      if (j < 0 || j >= arr.length) return arr;
      const n = [...arr];
      const t = n[i];
      n[i] = n[j];
      n[j] = t;
      return n;
    });

  const agregaPaso = (tipo: string) =>
    setInicial((arr) => [
      ...arr,
      { type: tipo, content: contenidoInicialPaso(tipo), id: Date.now() },
    ]);

  const cambiaUrl = (i: number, j: number, v: string) =>
    setInicial((arr) =>
      arr.map((p, k) =>
        k === i && Array.isArray(p.content)
          ? { ...p, content: p.content.map((u, m) => (m === j ? v : u)) }
          : p,
      ),
    );

  /** Urls recien subidas a la biblioteca -> al final del paso (reemplaza los vacios). */
  const agregaUrls = (i: number, urls: string[]) =>
    setInicial((arr) =>
      arr.map((p, k) =>
        k === i && Array.isArray(p.content)
          ? { ...p, content: [...p.content.filter((u) => String(u).trim()), ...urls] }
          : p,
      ),
    );

  const agregaUrl = (i: number) =>
    setInicial((arr) =>
      arr.map((p, k) =>
        k === i && Array.isArray(p.content) ? { ...p, content: [...p.content, ""] } : p,
      ),
    );

  const quitaUrl = (i: number, j: number) =>
    setInicial((arr) =>
      arr.map((p, k) =>
        k === i && Array.isArray(p.content)
          ? { ...p, content: p.content.filter((_, m) => m !== j) }
          : p,
      ),
    );

  /* ---------------- campanas de Meta ---------------- */
  /** GET /meta/campaigns (solo la primera vez que se abre la seccion). */
  const cargarCampanas = async () => {
    if (campCargadas || cargandoCamp) return;
    setCargandoCamp(true);
    setErrCamp(null);
    try {
      const r: any = await meta.campaigns();
      if (r?.ok === false) throw new Error(r.msg || "No se pudieron cargar las campañas de Meta");
      setCampanas(normalizarCampanas(r));
      setCampCargadas(true);
    } catch (e) {
      setErrCamp(errMsg(e));
    } finally {
      setCargandoCamp(false);
    }
  };

  const alternaCampana = (c: CampanaMeta) =>
    setCampSel((prev) =>
      prev.some((x) => x.value === c.value)
        ? prev.filter((x) => x.value !== c.value)
        : [...prev, c],
    );

  /**
   * POST /meta/campaigns/ads/sync: trae los adId de las campanas marcadas y
   * añade a AdsMetaTags los que falten (igual que el oficial).
   */
  const sincronizarAds = async () => {
    if (!campSel.length) {
      toast.info("Selecciona al menos una campaña");
      return;
    }
    setSincronizando(true);
    try {
      const r: any = await meta.adsSync(campSel.map((c) => c.value));
      if (r?.ok === false) throw new Error(r.msg || "No se pudo obtener anuncios de Meta.");
      const nuevos: string[] = (Array.isArray(r?.ads) ? (r.ads as any[]) : [])
        .map((a) => String(a?.adId ?? a?.id ?? ""))
        .filter(Boolean);
      const faltan = nuevos.filter((id) => !tags.includes(id));
      if (faltan.length) {
        setTags((prev) => [...prev, ...faltan]);
        toast.success(`${faltan.length} anuncio(s) nuevos agregados.`);
      } else {
        toast.info("No se encontraron anuncios nuevos en las campañas seleccionadas.");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSincronizando(false);
    }
  };

  const addTag = () => {
    const v = nuevoTag.trim();
    if (!v) return;
    if (!tags.includes(v)) setTags((prev) => [...prev, v]);
    setNuevoTag("");
  };

  const quitaTag = (v: string) => setTags((prev) => prev.filter((x) => x !== v));

  /* ---------------- variantes ---------------- */
  /** El oficial lo hace igual: al tocar la estructura se apaga «Combinar variantes». */
  const tocaEstructura = (nuevas: any[]) => {
    setVariantes(nuevas);
    setOps((o) => ({ ...o, optCombVariantes: false }));
  };

  const agregaAtributo = () => {
    if (variantes.some((v) => !String(v?.nombre ?? "").trim())) {
      toast.error("Debes llenar el nombre de la variante antes de agregar una nueva");
      return;
    }
    const nuevas = [...variantes, { sku: skuAleatorio(10), nombre: "", opciones: [] }];
    if (combinaciones(nuevas) > LIMITE_COMBINACIONES) {
      toast.error(`No puedes agregar más variantes: superarías las ${LIMITE_COMBINACIONES} combinaciones`);
      return;
    }
    tocaEstructura(nuevas);
  };

  const quitaAtributo = (i: number) => tocaEstructura(variantes.filter((_, k) => k !== i));

  const agregaOpcion = (i: number) => {
    const attr = variantes[i];
    if (!String(attr?.nombre ?? "").trim()) {
      toast.error("Debes llenar el nombre de la variante antes de agregar una nueva");
      return;
    }
    if ((attr?.opciones ?? []).some((o: any) => !String(o?.nombre ?? "").trim())) {
      toast.error("Debes llenar el nombre de la opción antes de agregar una nueva");
      return;
    }
    const nuevas = variantes.map((x, k) =>
      k === i ? { ...x, opciones: [...(x?.opciones ?? []), { sku: skuAleatorio(10), nombre: "" }] } : x,
    );
    if (combinaciones(nuevas) > LIMITE_COMBINACIONES) {
      toast.error(`No puedes agregar más opciones: superarías las ${LIMITE_COMBINACIONES} combinaciones`);
      return;
    }
    tocaEstructura(nuevas);
  };

  const quitaOpcion = (i: number, j: number) =>
    tocaEstructura(
      variantes.map((x, k) =>
        k === i ? { ...x, opciones: (x?.opciones ?? []).filter((_: any, m: number) => m !== j) } : x,
      ),
    );

  const nombraItems = (i: number, v: string) =>
    setMixed((a) =>
      a.map((x, k) =>
        k === i
          ? { ...x, items: v.split(",").map((s) => s.trim()).filter(Boolean) }
          : x,
      ),
    );

  const nombraPrecio = (i: number, campo: "precioSugerido" | "precioBodega", v: string) =>
    setMixed((a) => a.map((x, k) => (k === i ? { ...x, [campo]: v } : x)));

  const agregaMixed = () =>
    setMixed((a) => [
      ...a,
      { items: [], precioBodega: "0", precioSugerido: "0", sku: skuAleatorio(12), realSku: "" },
    ]);

  const quitaMixed = (i: number) => setMixed((a) => a.filter((_, k) => k !== i));

  /* ---------------- reglas / preguntas / testimonios ---------------- */
  const addFaq = (set: typeof setFaq) => set((a) => [...a, { pregunta: "", respuesta: "" }]);

  const cambiaFaq = (
    set: typeof setFaq,
    i: number,
    campo: "pregunta" | "respuesta",
    v: string,
  ) => set((a) => a.map((x, k) => (k === i ? { ...x, [campo]: v } : x)));

  /* ---------------- bundles ---------------- */
  const cambiaBundle = (i: number, patch: Record<string, unknown>) => {
    setBundles((a) => a.map((b, k) => (k === i ? { ...b, ...patch } : b)));
    setBundlesSucios(true);
  };

  const cambiaBundleUrl = (i: number, j: number, v: string) => {
    setBundles((a) =>
      a.map((b, k) =>
        k === i
          ? { ...b, imagenes: (Array.isArray(b?.imagenes) ? b.imagenes : []).map((u: any, m: number) => (m === j ? v : u)) }
          : b,
      ),
    );
    setBundlesSucios(true);
  };

  const agregaBundleUrls = (i: number, urls: string[]) => {
    setBundles((a) =>
      a.map((b, k) =>
        k === i
          ? { ...b, imagenes: [...(Array.isArray(b?.imagenes) ? b.imagenes : []).filter((u: any) => String(u ?? "").trim()), ...urls] }
          : b,
      ),
    );
    setBundlesSucios(true);
  };

  const agregaBundleUrl = (i: number) => {
    setBundles((a) =>
      a.map((b, k) =>
        k === i ? { ...b, imagenes: [...(Array.isArray(b?.imagenes) ? b.imagenes : []), ""] } : b,
      ),
    );
    setBundlesSucios(true);
  };

  const quitaBundleUrl = (i: number, j: number) => {
    setBundles((a) =>
      a.map((b, k) =>
        k === i
          ? { ...b, imagenes: (Array.isArray(b?.imagenes) ? b.imagenes : []).filter((_: any, m: number) => m !== j) }
          : b,
      ),
    );
    setBundlesSucios(true);
  };

  /** Como el oficial: las variantes del primer bundle, o las del producto. */
  const agregaBundle = () => {
    const precio = bundles[0]?.precio ?? form.precio ?? "0";
    const nuevo = {
      sku: skuAleatorio(12),
      name: "Nuevo bundle",
      cant: 1,
      precio: String(precio),
      default: false,
      hide: false,
      resaltar: false,
      texto: "",
      imagenes: [],
      index: bundles.length,
    };
    const base = bundleVar[0]?.variantes?.length
      ? bundleVar[0].variantes
      : arreglo(ficha?.mixedvariantes);
    setBundles((a) => [...a, nuevo]);
    setBundleVar((a) => [...a, { sku: nuevo.sku, name: nuevo.name, variantes: base }]);
    setBundlesSucios(true);
  };

  /** Precio o variante de Dropi de una combinacion dentro de un bundle. */
  const cambiaBundleVariante = (i: number, k: number, patch: Record<string, unknown>) => {
    setBundleVar((a) =>
      a.map((bv, x) =>
        x === i
          ? { ...bv, variantes: (Array.isArray(bv?.variantes) ? bv.variantes : []).map((v: any, y: number) => (y === k ? { ...v, ...patch } : v)) }
          : bv,
      ),
    );
    setBundlesSucios(true);
  };

  const quitaBundle = (i: number) => {
    setBundles((a) => a.filter((_, k) => k !== i));
    setBundleVar((a) => a.filter((_, k) => k !== i));
    setBundlesSucios(true);
  };

  /**
   * POST /productos/updatebundle: `bundle` y `bundleVariantes` NO son de las 87
   * claves de updateproducto, asi que se guardan aqui (mismo aviso que el
   * oficial: «Bundle actualizado correctamente»).
   */
  const guardarBundles = async (): Promise<boolean> => {
    if (!editando) return false;
    setGuardandoBundles(true);
    try {
      const r: any = await productos.updateBundles({
        idProducto: editando.id,
        bundles: JSON.stringify(bundles),
        bundleVariantes: JSON.stringify(bundleVar),
      });
      if (r?.ok === false || r?.error) {
        throw new Error(
          r?.msg || (typeof r?.error === "string" ? r.error : "Error al guardar el bundle"),
        );
      }
      toast.success("Bundle actualizado correctamente");
      setBundlesSucios(false);
      setFicha((f: any) =>
        f ? { ...f, bundle: JSON.stringify(bundles), bundleVariantes: bundleVar } : f,
      );
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      setGuardandoBundles(false);
    }
  };

  /* ---------------- pintado ---------------- */
  const estado = (p: any) => {
    const v = p?.disponibilidadProductoLucidBot;
    if (v === undefined || v === null || v === "") return null;
    const on = !(v === 0 || v === "0" || v === false);
    return on ? "Activo" : "Inactivo";
  };

  return (
    <>
      <section className="card productos-catalogo">
        <header className="productos-list-header">
          <div>
            <h2>Mi catálogo</h2>
            <p>Administra tus productos, precios y disponibilidad.</p>
          </div>
          <div className="productos-list-actions">
            <div className="productos-search">
              <input
                id="pr-buscar"
                placeholder="Buscar por nombre o SKU"
                value={textoBuscar}
                onChange={(e) => setTextoBuscar(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buscar()}
                autoComplete="off"
                aria-label="Buscar producto"
              />
              <button type="button" className="btn" onClick={buscar} disabled={cargando}>
                Buscar
              </button>
            </div>
            {(textoBuscar || busqueda) ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setTextoBuscar("");
                  setPagina(1);
                  setBusqueda("");
                }}
              >
                Limpiar
              </button>
            ) : null}
            <button type="button" className="btn" onClick={refrescar} disabled={cargando}>
              Actualizar
            </button>
            <button type="button" className="btn primary" onClick={() => setCreando(true)}>
              + Crear producto
            </button>
          </div>
        </header>

        <div className="productos-meta">
          <span>
            <strong>{total.toLocaleString("es-CO")}</strong> productos
            {busqueda ? ` para «${busqueda}»` : " en el catálogo"}
          </span>
          {respaldo ? <span className="productos-respaldo">Vista completa de respaldo</span> : null}
        </div>

        <ErrorBanner error={error} />

        {cargando ? (
          <Spinner label="Cargando productos..." />
        ) : filas.length === 0 ? (
          <div className="productos-empty">
            <span className="productos-empty-mark" aria-hidden="true">⌕</span>
            <strong>
              {error
                ? "No se pudo cargar la lista."
                : busqueda
                  ? `Ningún producto coincide con «${busqueda}»`
                  : "Todavía no hay productos en esta tienda."}
            </strong>
            {!error && !busqueda ? (
              <>
                <p className="muted">Crea un producto o impórtalo desde Dropi para comenzar.</p>
                <button type="button" className="btn primary" onClick={() => setCreando(true)}>
                  Crear producto
                </button>
              </>
            ) : null}
            {!error && busqueda ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setTextoBuscar("");
                  setPagina(1);
                  setBusqueda("");
                }}
              >
                Limpiar búsqueda
              </button>
            ) : null}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table productos-tabla">
              <thead>
                <tr>
                  <th>Imagen</th>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th className="hide-sm">Estado</th>
                  <th className="hide-sm">Visitas</th>
                  <th className="hide-sm">Órdenes</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p, i) => {
                  const img = prodImg(p);
                  const precio = prodPrice(p);
                  const est = estado(p);
                  const clave = String(p?.id ?? p?.idProducto ?? p?.product_id ?? "");
                  const conv =
                    Number(p?.VisitasUnicas) > 0 && Number(p?.VentasTotales) > 0
                      ? (Number(p?.VentasTotales) / Number(p?.VisitasUnicas)) * 100
                      : null;
                  return (
                    <tr key={clave ? `${clave}-${i}` : `p${i}`}>
                      <td>
                        {img ? (
                          <img
                            className="prod-mini"
                            src={img}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="wrap">
                        <strong>{p?.Nombre || p?.name || "—"}</strong>
                        {p?.sku ? <span className="muted small"> · {String(p.sku)}</span> : null}
                        {conv !== null ? (
                          <span className="muted small"> · {conv.toFixed(2)} % conv.</span>
                        ) : null}
                      </td>
                      <td>{precio ? money(precio) : "—"}</td>
                      <td className="hide-sm">
                        {est ? (
                          <span className={`badge${est === "Activo" ? " ok" : ""}`}>{est}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="hide-sm">{p?.Visitas ?? "—"}</td>
                      <td className="hide-sm">{p?.VentasTotales ?? "—"}</td>
                      <td>
                        <span className="row gap productos-row-actions">
                          <button type="button" className="btn sm" onClick={() => void abrir(p?.id ?? p?.idProducto)}>
                            Editar
                          </button>
                          <button type="button" className="btn sm danger" onClick={() => setBorrando(p)}>
                            Eliminar
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <div className="pages productos-pagina-resumen">
            <span>
              {total ? `${desde}–${hasta} de ${total}` : "0 productos"} · por página
            </span>
            <select
              aria-label="Productos por página"
              value={porPagina}
              onChange={(e) => {
                setPorPagina(Number(e.target.value));
                setPagina(1);
              }}
            >
              {PAGINAS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="pages">
            <button
              className="btn sm"
              disabled={pagina <= 1 || cargando}
              onClick={() => setPagina((x) => Math.max(1, x - 1))}
            >
              ← Anterior
            </button>
            <span>
              Página {Math.min(pagina, paginas)} de {paginas}
            </span>
            <button
              className="btn sm"
              disabled={pagina >= paginas || cargando}
              onClick={() => setPagina((x) => x + 1)}
            >
              Siguiente →
            </button>
          </div>
        </div>
      </section>

      {/* -------- crear -------- */}
      <Modal
        open={creando}
        title="Crear producto"
        onClose={() => setCreando(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setCreando(false)} disabled={guardandoNuevo}>
              Cancelar
            </button>
            <button className="btn primary" onClick={crear} disabled={guardandoNuevo}>
              {guardandoNuevo ? "Creando..." : "Crear producto"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Igual que el modal oficial: nombre + valor. Después puedes completar
            descripción, stock e imágenes desde <strong>Editar</strong>.
          </p>
          <div className="form-grid">
            <Campo id="pr-nombre" label="Nombre del producto">
              <input
                id="pr-nombre"
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                autoFocus
              />
            </Campo>
            <Campo id="pr-valor" label="Valor" ayuda="Precio de venta de la primera variante (1 Unidad).">
              <input
                id="pr-valor"
                type="number"
                step="0.01"
                min="0"
                value={nuevo.valor}
                onChange={(e) => setNuevo({ ...nuevo, valor: e.target.value })}
              />
            </Campo>
          </div>
          <ErrorBanner error={errNuevo} />
        </form>
      </Modal>

      {/* -------- editar -------- */}
      <Modal
        open={!!editando}
        title={ficha?.Nombre ? `Editar: ${ficha.Nombre}` : "Editar producto"}
        onClose={() => {
          setEditando(null);
          setFicha(null);
        }}
        wide
        footer={
          <>
            <button
              className="btn ghost"
              onClick={() => {
                setEditando(null);
                setFicha(null);
              }}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              className="btn primary"
              onClick={guardar}
              disabled={guardando || cargandoFicha || !ficha}
            >
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </>
        }
      >
        {cargandoFicha ? (
          <Spinner label="Cargando producto..." />
        ) : !ficha && errEdit ? (
          <ErrorBanner error={errEdit} />
        ) : ficha ? (
          <form
            className="producto-editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              void guardar();
            }}
          >
            <div className="row gap" style={{ marginBottom: 12, alignItems: "flex-start" }}>
              <span className="chips" style={{ flex: "none" }}>
                {prodImgs(ficha).map((u, i) => (
                  <img
                    key={u + i}
                    className="prod-mini"
                    src={u}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ))}
              </span>
              <p className="muted small" style={{ margin: 0 }}>
                id <code>{String(ficha.id ?? ficha.idProducto ?? editando?.id)}</code>
                {ficha.sku || ficha.SKU ? (
                  <>
                    {" "}
                    · sku <code>{String(ficha.sku ?? ficha.SKU)}</code>
                  </>
                ) : null}
                {ficha.url ? (
                  <>
                    {" "}
                    · slug <code>{String(ficha.url)}</code>
                  </>
                ) : null}
                <br />
                {ficha.activeIntegration && ficha.activeIntegration !== "none" ? (
                  <>
                    integración <strong>{String(ficha.activeIntegration)}</strong>
                    {ficha.idProductoDropi ? ` (#${ficha.idProductoDropi})` : ""} ·{" "}
                  </>
                ) : null}
                {Number(ficha.VentasTotales) || 0} ventas · {Number(ficha.Visitas) || 0} visitas
                {Number(ficha.EnvioGratis) ? " · envío gratis" : ""}
                {Number(ficha.Visible) ? "" : " · oculto"}
                <br />
                Se envían las <strong>87 claves</strong> que pide el oficial en{" "}
                <code>updateproducto</code>; lo que no se edita se manda tal cual vino (las
                listas como <code>variantes</code> o <code>imagenes</code> se serializan a JSON,
                igual que él).
              </p>
            </div>

            <h4 className="subtitulo-form">Nombre y precio</h4>
            <div className="form-grid">
              <Campo id="ed-nombre" label="Nombre">
                <input
                  id="ed-nombre"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
              </Campo>
              <Campo id="ed-precio" label="Precio">
                <input
                  id="ed-precio"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.precio}
                  onChange={(e) => setForm({ ...form, precio: e.target.value })}
                />
              </Campo>
              <Campo id="ed-precio-bodega" label="Precio bodega">
                <input
                  id="ed-precio-bodega"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.precioBodega}
                  onChange={(e) => setForm({ ...form, precioBodega: e.target.value })}
                />
              </Campo>
              <Campo id="ed-precio-sugerido" label="Precio sugerido">
                <input
                  id="ed-precio-sugerido"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.precioSugerido}
                  onChange={(e) => setForm({ ...form, precioSugerido: e.target.value })}
                />
              </Campo>
              <Campo id="ed-stock" label="Stock">
                <input
                  id="ed-stock"
                  type="number"
                  step="1"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </Campo>
              <Campo id="ed-ciudad" label="Ciudad (id)" ayuda="Ciudad de despacho (columna Ciudad).">
                <input
                  id="ed-ciudad"
                  type="number"
                  step="1"
                  value={form.ciudad}
                  onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                />
              </Campo>
            </div>

            <h4 className="subtitulo-form">Descripciones</h4>
            <div className="form-grid">
              <Campo id="ed-desc-corta" label="Descripción corta">
                <input
                  id="ed-desc-corta"
                  value={form.descCorta}
                  onChange={(e) => setForm({ ...form, descCorta: e.target.value })}
                />
              </Campo>
              <Campo id="ed-desc" label="Descripción">
                <textarea
                  id="ed-desc"
                  rows={5}
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
              </Campo>
              <Campo id="ed-modo-uso" label="Modo de uso">
                <textarea
                  id="ed-modo-uso"
                  rows={3}
                  value={form.modoDeUso}
                  onChange={(e) => setForm({ ...form, modoDeUso: e.target.value })}
                />
              </Campo>
              <Campo id="ed-caract" label="Características técnicas">
                <textarea
                  id="ed-caract"
                  rows={3}
                  value={form.caracteristicas}
                  onChange={(e) => setForm({ ...form, caracteristicas: e.target.value })}
                />
              </Campo>
              <Campo id="ed-contenido" label="Contenido del paquete">
                <textarea
                  id="ed-contenido"
                  rows={3}
                  value={form.contenido}
                  onChange={(e) => setForm({ ...form, contenido: e.target.value })}
                />
              </Campo>
            </div>

            <h4 className="subtitulo-form">Variantes</h4>
            <p className="muted small">
              <code>variantes</code> = atributos y opciones (Color → Negro);{" "}
              <code>mixedvariantes</code> = precio de cada combinación. Límite del
              oficial: {LIMITE_COMBINACIONES} combinaciones (llevas{" "}
              {combinaciones(variantes)}). Al tocar la estructura se apaga el
              interruptor «Combinar variantes».
            </p>
            {variantes.length === 0 ? (
              <p className="muted">Sin variantes: el producto se vende simple.</p>
            ) : null}
            {variantes.map((v, i) => (
              <div className="variante-atributo" key={`v${i}`}>
                <div className="row gap wrap">
                  <input
                    className="variante-nombre"
                    aria-label={`Atributo ${i + 1}`}
                    placeholder="Nombre del atributo (Color)"
                    value={String(v?.nombre ?? "")}
                    onChange={(e) =>
                      setVariantes((a) =>
                        a.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={() => quitaAtributo(i)}
                  >
                    Quitar atributo
                  </button>
                </div>
                <div className="opciones-lista">
                  {(Array.isArray(v?.opciones) ? v.opciones : []).map((op: any, j: number) => (
                    <div className="row gap" key={`o${j}`} style={{ marginBottom: 0 }}>
                      <input
                        aria-label={`Opción ${j + 1} del atributo ${i + 1}`}
                        placeholder="Opción (Negro)"
                        value={String(op?.nombre ?? "")}
                        onChange={(e) =>
                          setVariantes((a) =>
                            a.map((x, k) =>
                              k === i
                                ? {
                                    ...x,
                                    opciones: (x?.opciones ?? []).map((y: any, m: number) =>
                                      m === j ? { ...y, nombre: e.target.value } : y,
                                    ),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label="Quitar opción"
                        onClick={() => quitaOpcion(i, j)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn sm" onClick={() => agregaOpcion(i)}>
                    + Opción
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={agregaAtributo}>
              + Atributo
            </button>

            <h5 className="subtitulo-form">Precio por variante</h5>
            {mixed.length === 0 ? (
              <p className="muted">Sin combinaciones con precio todavía.</p>
            ) : null}
            {mixed.map((m, i) => (
              <div className="mixed-fila" key={`m${i}`}>
                <input
                  aria-label={`Combinación ${i + 1}`}
                  placeholder="Combinación (Negro)"
                  value={(Array.isArray(m?.items) ? m.items : []).join(", ")}
                  onChange={(e) => nombraItems(i, e.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`Precio sugerido de la variante ${i + 1}`}
                  placeholder="Precio sugerido"
                  value={String(m?.precioSugerido ?? "")}
                  onChange={(e) => nombraPrecio(i, "precioSugerido", e.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`Precio bodega de la variante ${i + 1}`}
                  placeholder="Precio bodega"
                  value={String(m?.precioBodega ?? "")}
                  onChange={(e) => nombraPrecio(i, "precioBodega", e.target.value)}
                />
                {(() => {
                  // el precio que se cobra esta en el bundle ("1 Unidad")
                  const its = (Array.isArray(m?.items) ? m.items : []).map((x: any) => String(x).trim().toLowerCase());
                  const enBundle = (Array.isArray(bundleVar[0]?.variantes) ? bundleVar[0].variantes : []).find((v: any) => {
                    const b = (Array.isArray(v?.items) ? v.items : []).map((x: any) => String(x).trim().toLowerCase());
                    return b.length === its.length && b.every((x: string, k: number) => x === its[k]);
                  });
                  const pr = Number(enBundle?.precioSugerido);
                  return enBundle ? (
                    <span className="chip" title={`Precio de venta en el bundle «${bundles[0]?.name ?? "1"}» (se edita abajo, en Bundles)`}>
                      {pr > 0 ? `venta ${money(pr)}` : "sin precio en el bundle"}
                    </span>
                  ) : null;
                })()}
                <span className="chip" title="sku de la variante">
                  {String(m?.sku ?? "")}
                </span>
                <button
                  type="button"
                  className="btn sm danger"
                  aria-label="Quitar variante"
                  onClick={() => quitaMixed(i)}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={agregaMixed}>
              + Variante
            </button>

            <h4 className="subtitulo-form">Bundles</h4>
            <p className="muted small">
              Paquetes de venta («1 Unidad», «2 Unidades»…). Con variantes, el precio de cada
              combinación y la variante de Dropi a la que corresponde van en cada bundle (es lo que
              usan los pedidos y la subida a Dropi). Tienen su propio botón de guardar.
            </p>
            {bundles.length === 0 ? <p className="muted">Sin bundles todavía.</p> : null}
            {bundles.map((b, i) => {
              const nVar = bundleVar[i]?.variantes?.length ?? 0;
              const imgs = Array.isArray(b?.imagenes) ? b.imagenes : [];
              return (
                <div className="bundle-fila" key={`b${String(b?.sku ?? i)}`}>
                  <div className="row gap wrap">
                    <input
                      className="bundle-nombre"
                      aria-label={`Nombre del bundle ${i + 1}`}
                      placeholder="Nombre (1 Unidad)"
                      value={String(b?.name ?? "")}
                      onChange={(e) => cambiaBundle(i, { name: e.target.value })}
                    />
                    <input
                      type="number"
                      min={1}
                      aria-label={`Cantidad del bundle ${i + 1}`}
                      title="Unidades que incluye"
                      value={String(b?.cant ?? 1)}
                      onChange={(e) =>
                        cambiaBundle(i, { cant: Math.max(1, Number(e.target.value) || 1) })
                      }
                      style={{ maxWidth: 110 }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      aria-label={`Precio del bundle ${i + 1}`}
                      disabled={variantes.length > 0}
                      title={
                        variantes.length > 0
                          ? "Con variantes, el precio viene de cada variante"
                          : "Precio del paquete"
                      }
                      value={String(b?.precio ?? "")}
                      onChange={(e) => cambiaBundle(i, { precio: e.target.value })}
                      style={{ maxWidth: 150 }}
                    />
                    <span className="chip" title="sku del bundle">
                      {String(b?.sku ?? "")}
                    </span>
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={`Quitar bundle ${i + 1}`}
                      onClick={() => quitaBundle(i)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="row gap wrap">
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label={`Por defecto (bundle ${i + 1})`}
                        checked={!!b?.default}
                        onChange={(e) => cambiaBundle(i, { default: e.target.checked })}
                      />
                      <span className="switch-pista" aria-hidden="true" />
                      <span className="switch-texto">Por defecto</span>
                    </label>
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label={`Oculto (bundle ${i + 1})`}
                        checked={!!b?.hide}
                        onChange={(e) => cambiaBundle(i, { hide: e.target.checked })}
                      />
                      <span className="switch-pista" aria-hidden="true" />
                      <span className="switch-texto">Oculto</span>
                    </label>
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label={`Resaltar (bundle ${i + 1})`}
                        checked={!!b?.resaltar}
                        onChange={(e) => cambiaBundle(i, { resaltar: e.target.checked })}
                      />
                      <span className="switch-pista" aria-hidden="true" />
                      <span className="switch-texto">Resaltar</span>
                    </label>
                    <span className="muted small">
                      {nVar} variante(s) en <code>bundleVariantes</code>
                    </span>
                  </div>

                  {nVar > 0 ? (
                    <div className="table-wrap" style={{ marginTop: 6 }}>
                      <table className="table compact">
                        <thead>
                          <tr>
                            <th>Variante</th>
                            <th>Precio</th>
                            <th title="id de la variación en Dropi (la que se elige al subir el pedido)">Variante en Dropi</th>
                            <th>Stock Dropi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bundleVar[i].variantes.map((v: any, k: number) => {
                            const idDropi = String(v?.idVarianteDropi ?? "").trim();
                            return (
                              <tr key={k}>
                                <td>{(Array.isArray(v?.items) ? v.items : []).map((x: any) => String(x).trim()).join(" / ") || "—"}</td>
                                <td>
                                  <input
                                    type="number"
                                    min={0}
                                    aria-label={`Precio de la variante ${k + 1} del bundle ${i + 1}`}
                                    value={String(v?.precioSugerido ?? "")}
                                    onChange={(e) => cambiaBundleVariante(i, k, { precioSugerido: e.target.value })}
                                    style={{ maxWidth: 130 }}
                                  />
                                </td>
                                <td>
                                  {varDropi.length ? (
                                    <select
                                      aria-label={`Variante de Dropi de la variante ${k + 1} del bundle ${i + 1}`}
                                      className={idDropi ? "" : "variante-select variante-falta"}
                                      value={idDropi}
                                      onChange={(e) => {
                                        const vd = varDropi.find((x) => x.id === e.target.value);
                                        cambiaBundleVariante(i, k, {
                                          idVarianteDropi: e.target.value || null,
                                          ...(vd && vd.stock !== null ? { stock: vd.stock } : {}),
                                        });
                                      }}
                                    >
                                      <option value="">— sin vincular —</option>
                                      {idDropi && !varDropi.some((x) => x.id === idDropi) ? (
                                        <option value={idDropi}>{idDropi} (ya no está en Dropi)</option>
                                      ) : null}
                                      {varDropi.map((x) => (
                                        <option key={x.id} value={x.id}>
                                          {x.name} · {x.id}
                                          {x.stock !== null ? ` · stock ${x.stock}` : ""}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                  <input
                                    inputMode="numeric"
                                    aria-label={`Variante de Dropi de la variante ${k + 1} del bundle ${i + 1}`}
                                    placeholder="sin vincular"
                                    className={idDropi ? "" : "variante-falta"}
                                    value={idDropi}
                                    onChange={(e) =>
                                      cambiaBundleVariante(i, k, { idVarianteDropi: e.target.value.replace(/\D/g, "") || null })
                                    }
                                    style={{ maxWidth: 130 }}
                                  />
                                  )}
                                </td>
                                <td className="muted small">
                                  {(varDropi.find((x) => x.id === idDropi)?.stock ?? v?.stock) ?? (idDropi ? "—" : "no está en Dropi")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <input
                    aria-label={`Texto del bundle ${i + 1}`}
                    placeholder="Texto que ve el cliente"
                    value={String(b?.texto ?? "")}
                    onChange={(e) => cambiaBundle(i, { texto: e.target.value })}
                  />

                  <div className="pasos-urls">
                    {imgs.map((u: any, j: number) => {
                      const url = String(u ?? "");
                      const tipo = url ? tipoArchivo(url) : "file";
                      return (
                        <div className="url-fila" key={`bi${j}`}>
                          {url && tipo === "image" ? (
                            <a
                              className="url-fila-media"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir a tamaño completo"
                            >
                              <img
                                key={url}
                                src={url}
                                alt=""
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </a>
                          ) : null}
                          {url && tipo === "video" ? (
                            <video
                              className="url-fila-media video"
                              src={url}
                              controls
                              preload="metadata"
                            />
                          ) : null}
                          {url && tipo === "audio" ? (
                            <audio className="url-audio" src={url} controls preload="metadata" />
                          ) : null}
                          <div className="row gap" style={{ marginBottom: 0 }}>
                            <input
                              className="url-input"
                              aria-label={`Imagen ${j + 1} del bundle ${i + 1}`}
                              value={url}
                              placeholder="https://…"
                              onChange={(e) => cambiaBundleUrl(i, j, e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn sm danger"
                              aria-label="Quitar imagen del bundle"
                              onClick={() => quitaBundleUrl(i, j)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="row gap" style={{ marginBottom: 0 }}>
                      <SubirMedia texto="⬆ Subir imagen" onSubido={(urls) => agregaBundleUrls(i, urls)} />
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => agregaBundleUrl(i)}
                      >
                        + Imagen (url)
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="row gap wrap" style={{ marginTop: 8 }}>
              <button type="button" className="btn sm" onClick={agregaBundle}>
                + Añadir bundle
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => void guardarBundles()}
                disabled={guardandoBundles || !editando}
              >
                {guardandoBundles ? "Guardando..." : "Guardar bundles"}
              </button>
              {bundlesSucios ? (
                <span className="muted small">Cambios de bundle sin guardar.</span>
              ) : null}
            </div>

            <h4 className="subtitulo-form">Opciones del producto</h4>
            <p className="muted small">
              Se guardan como flag <code>1</code>/<code>0</code>, igual que el oficial.
            </p>
            <div className="ops-grid">
              {OPS.map(([k, label]) => (
                <label className="switch" key={k} htmlFor={`op-${k}`}>
                  <input
                    id={`op-${k}`}
                    type="checkbox"
                    checked={!!ops[k]}
                    onChange={(e) => setOps({ ...ops, [k]: e.target.checked })}
                  />
                  <span className="switch-pista" aria-hidden="true" />
                  <span className="switch-texto">{label}</span>
                </label>
              ))}
            </div>

            <h4 className="subtitulo-form">Píxeles y audiovisual</h4>
            <div className="form-grid">
              <Campo id="ed-link-av" label="Link audiovisual">
                <input
                  id="ed-link-av"
                  value={form.linkAudioVisual}
                  onChange={(e) => setForm({ ...form, linkAudioVisual: e.target.value })}
                />
              </Campo>
              <Campo id="ed-fb-pixel" label="Facebook pixel">
                <input
                  id="ed-fb-pixel"
                  value={form.fbPixel}
                  onChange={(e) => setForm({ ...form, fbPixel: e.target.value })}
                />
              </Campo>
              <Campo id="ed-tt-pixel" label="TikTok pixel">
                <input
                  id="ed-tt-pixel"
                  value={form.tiktokPixel}
                  onChange={(e) => setForm({ ...form, tiktokPixel: e.target.value })}
                />
              </Campo>
              <Campo id="ed-gg-pixel" label="Google pixel">
                <input
                  id="ed-gg-pixel"
                  value={form.googlePixel}
                  onChange={(e) => setForm({ ...form, googlePixel: e.target.value })}
                />
              </Campo>
            </div>

            <details
              className="meta-detalle"
              open
              onToggle={(e) => {
                if ((e.currentTarget as HTMLDetailsElement).open) void cargarCampanas();
              }}
            >
              <summary className="subtitulo-form">
                Campañas de Meta
                {campSel.length ? ` · ${campSel.length} seleccionada(s)` : ""}
              </summary>
              <p className="muted small">
                Identifica la campaña de origen y optimiza ventas y métricas asociadas. Se guarda en{" "}
                <code>AdsMetaCampaigns</code>; los anuncios que traiga la sincronización van a{" "}
                <code>AdsMetaTags</code>.
              </p>
              <ErrorBanner error={errCamp} />
              {cargandoCamp ? (
                <Spinner label="Cargando campañas de Meta..." />
              ) : campCargadas && campanas.length === 0 ? (
                <p className="muted">
                  No devolvió campañas (¿la integración de Meta está activa en Ajustes?).
                </p>
              ) : campCargadas ? (
                <>
                  <div className="row gap wrap" style={{ marginBottom: 8 }}>
                    <input
                      id="camp-buscar"
                      placeholder="Buscar campaña"
                      value={textoCamp}
                      onChange={(e) => setTextoCamp(e.target.value)}
                      autoComplete="off"
                      aria-label="Buscar campaña"
                    />
                    <span className="muted small">
                      {campSel.length} de {campanas.length} seleccionadas
                    </span>
                  </div>
                  <div className="camp-lista">
                    {(textoCamp.trim()
                      ? campanas.filter(
                          (c) =>
                            c.label.toLowerCase().includes(textoCamp.trim().toLowerCase()) ||
                            c.value.includes(textoCamp.trim()),
                        )
                      : campanas
                    ).map((c) => (
                      <label className="camp-fila" key={c.value} htmlFor={`camp-${c.value}`}>
                        <input
                          id={`camp-${c.value}`}
                          type="checkbox"
                          checked={campSel.some((x) => x.value === c.value)}
                          onChange={() => alternaCampana(c)}
                        />
                        <span className="camp-nombre">{c.label}</span>
                        <span className="muted small">{c.value}</span>
                      </label>
                    ))}
                    {campanas.length > 0 &&
                    (textoCamp.trim()
                      ? campanas.filter(
                          (c) =>
                            c.label.toLowerCase().includes(textoCamp.trim().toLowerCase()) ||
                            c.value.includes(textoCamp.trim()),
                        )
                      : campanas
                    ).length === 0 ? (
                      <p className="muted small" style={{ margin: 8 }}>
                        Sin resultados para “{textoCamp}”.
                      </p>
                    ) : null}
                  </div>
                  <div className="row gap" style={{ marginTop: 8, marginBottom: 0 }}>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={sincronizando || campSel.length === 0}
                      onClick={() => void sincronizarAds()}
                    >
                      {sincronizando ? "Actualizando..." : "Actualizar anuncios"}
                    </button>
                    <span className="muted small">
                      Trae los <code>adId</code> de las campañas marcadas y añade los que falten.
                    </span>
                  </div>
                </>
              ) : null}

              <h5 className="subtitulo-form">Identificadores de anuncios de Meta</h5>
              <p className="muted small">
                <code>AdsMetaTags</code>: se rellenan solos con <strong>Actualizar anuncios</strong>{" "}
                o se pueden escribir a mano.
              </p>
              <div className="chips">
                {tags.length ? (
                  tags.map((t) => (
                    <span className="chip" key={t}>
                      {t}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`Quitar ${t}`}
                        onClick={() => quitaTag(t)}
                      >
                        ✕
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="muted small">Sin identificadores todavía.</span>
                )}
              </div>
              <div className="row gap" style={{ marginTop: 8 }}>
                <input
                  id="camp-tag"
                  value={nuevoTag}
                  onChange={(e) => setNuevoTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="ID de la publicación (adId)"
                  autoComplete="off"
                />
                <button type="button" className="btn sm" onClick={addTag}>
                  Añadir
                </button>
              </div>
            </details>

            <h4 className="subtitulo-form">Seguimiento post-venta</h4>
            <div className="form-grid">
              <Campo id="ed-preg-videos" label="Texto con videos de seguimiento">
                <textarea
                  id="ed-preg-videos"
                  rows={3}
                  value={form.pregVideos}
                  onChange={(e) => setForm({ ...form, pregVideos: e.target.value })}
                />
              </Campo>
              <Campo id="ed-preg-imagenes" label="Texto con imágenes de seguimiento">
                <textarea
                  id="ed-preg-imagenes"
                  rows={3}
                  value={form.pregImagenes}
                  onChange={(e) => setForm({ ...form, pregImagenes: e.target.value })}
                />
              </Campo>
              <Campo id="ed-preg-test" label="Texto con testimonios de seguimiento">
                <textarea
                  id="ed-preg-test"
                  rows={3}
                  value={form.pregTestimonios}
                  onChange={(e) => setForm({ ...form, pregTestimonios: e.target.value })}
                />
              </Campo>
            </div>

            <h4 className="subtitulo-form">Mensaje inicial (bienvenida del bot)</h4>
            <p className="muted small">
              Secuencia que envía el bot cuando entra un cliente. Se guarda en{" "}
              <code>mensajeInicial</code> (el <code>getproducto</code> lo trae como{" "}
              <code>MensajeInicial</code>).{" "}
              {ops.personalizarMensajeInicial
                ? "El interruptor «Mensaje inicial personalizado» está activo."
                : "⚠ El interruptor «Mensaje inicial personalizado» está apagado (en Opciones): el mensaje no se usará."}
            </p>

            {inicialNuevo ? (
              <div className="banner info">
                Este producto usa los <strong>mensajes iniciales nuevos</strong> de LucidSales (versiones A, B… que el
                bot reparte entre los clientes). Elige la versión a editar; al guardar el producto se mandan todas y
                Zunto comprueba que LucidSales las haya guardado.
                <div className="row gap" style={{ marginTop: 6, marginBottom: 0, flexWrap: "wrap" }}>
                  {inicialNuevo.versiones.map((v, k) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn sm${k === inicialNuevo.actual ? " primary" : ""}`}
                      onClick={() => verVersion(k)}
                      title={`${v.sales ?? 0} venta(s) · ${v.views ?? 0} vista(s)`}
                    >
                      Versión {String(v.letter ?? k + 1)}
                      {v.enabled === false ? " (apagada)" : ""}
                      {v.id === undefined ? " · nueva" : ` · ${v.sales ?? 0} venta(s)`}
                    </button>
                  ))}
                  {inicialNuevo.versiones.length < inicialNuevo.max ? (
                    <button type="button" className="btn sm" onClick={nuevaVersion} title="Copia de la versión que estás viendo">
                      + Nueva versión
                    </button>
                  ) : null}
                </div>
                {inicialNuevo.versiones[inicialNuevo.actual] ? (
                  <div className="row gap" style={{ marginTop: 6, marginBottom: 0 }}>
                    <label className="check-linea">
                      <input
                        type="checkbox"
                        checked={inicialNuevo.versiones[inicialNuevo.actual].enabled !== false}
                        onChange={(e) => activarVersion(inicialNuevo.actual, e.target.checked)}
                      />
                      <span>Versión {String(inicialNuevo.versiones[inicialNuevo.actual].letter)} activa</span>
                    </label>
                    {inicialNuevo.versiones.length > 1 ? (
                      <button type="button" className="btn sm danger" onClick={() => borrarVersion(inicialNuevo.actual)}>
                        Borrar esta versión
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {inicial.length === 0 ? (
              <p className="muted">Sin mensaje inicial todavía: añade el primer paso.</p>
            ) : (
              <div className="pasos-inicial">
                {inicial.map((p, i) => {
                  const forma = formaDePaso(p.type);
                  return (
                    <div className="paso-inicial" key={`${String(p.id)}-${i}`}>
                      <div className="row between wrap">
                        <span className="row gap" style={{ marginBottom: 0 }}>
                          <span className="paso-num">{i + 1}</span>
                          <select
                            aria-label={`Tipo del paso ${i + 1}`}
                            value={p.type}
                            onChange={(e) =>
                              cambiaPaso(i, {
                                type: e.target.value,
                                content: contenidoInicialPaso(e.target.value),
                              })
                            }
                          >
                            {TIPOS_INICIAL.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span className="row gap" style={{ marginBottom: 0 }}>
                          <button
                            type="button"
                            className="btn sm"
                            aria-label="Subir paso"
                            disabled={i === 0}
                            onClick={() => muevePaso(i, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            aria-label="Bajar paso"
                            disabled={i === inicial.length - 1}
                            onClick={() => muevePaso(i, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() => quitaPaso(i)}
                          >
                            Eliminar
                          </button>
                        </span>
                      </div>

                      {forma === "texto" ? (
                        <textarea
                          rows={4}
                          value={String(p.content ?? "")}
                          onChange={(e) => cambiaPaso(i, { content: e.target.value })}
                          placeholder="Mensaje de bienvenida…"
                        />
                      ) : null}

                      {forma === "espera" ? (
                        <div className="row gap" style={{ marginBottom: 0 }}>
                          <input
                            type="number"
                            min={0}
                            style={{ maxWidth: 130 }}
                            aria-label={`Espera del paso ${i + 1} en segundos`}
                            value={String(p.content ?? "1")}
                            onChange={(e) => cambiaPaso(i, { content: e.target.value })}
                          />
                          <span className="muted small">
                            segundos antes del siguiente paso
                          </span>
                        </div>
                      ) : null}

                      {forma === "lista" ? (
                        <div
                          className={`pasos-urls${
                            p.type === "mensaje_inicial_imagenes" ? " galeria" : ""
                          }`}
                        >
                          {Array.isArray(p.content) && p.content.length > 0 ? (
                            p.content.map((u, j) => {
                              const url = String(u);
                              const esImagen = p.type === "mensaje_inicial_imagenes";
                              const esVideo = p.type === "mensaje_inicial_videos";
                              const esAudio = p.type === "mensaje_inicial_audios";
                              return (
                                <div className="url-fila" key={j}>
                                  {esImagen && url ? (
                                    <a
                                      className="url-fila-media"
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Abrir a tamaño completo"
                                    >
                                      {/* key=url: si se edita el enlace se reintenta */}
                                      <img
                                        key={url}
                                        src={url}
                                        alt=""
                                        onError={(e) => {
                                          e.currentTarget.style.display = "none";
                                        }}
                                      />
                                    </a>
                                  ) : null}
                                  {esVideo && url ? (
                                    <video
                                      className="url-fila-media video"
                                      src={url}
                                      controls
                                      preload="metadata"
                                    />
                                  ) : null}
                                  {esAudio && url ? (
                                    <audio className="url-audio" src={url} controls preload="metadata" />
                                  ) : null}
                                  <div className="row gap" style={{ marginBottom: 0 }}>
                                    <input
                                      className="url-input"
                                      value={url}
                                      aria-label={`Url ${j + 1} del paso ${i + 1}`}
                                      onChange={(e) => cambiaUrl(i, j, e.target.value)}
                                      placeholder="https://…"
                                    />
                                    <button
                                      type="button"
                                      className="btn sm danger"
                                      aria-label="Quitar url"
                                      onClick={() => quitaUrl(i, j)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="muted small" style={{ margin: 0 }}>
                              Sin urls todavía.
                            </p>
                          )}
                          <div className="row gap" style={{ marginBottom: 0 }}>
                            {p.type === "mensaje_inicial_imagenes" || p.type === "mensaje_inicial_videos" || p.type === "mensaje_inicial_audios" ? (
                              <SubirMedia
                                accept={p.type === "mensaje_inicial_videos" ? "video/*" : p.type === "mensaje_inicial_audios" ? "audio/*" : "image/*"}
                                texto={p.type === "mensaje_inicial_videos" ? "⬆ Subir video" : p.type === "mensaje_inicial_audios" ? "⬆ Subir audio" : "⬆ Subir imagen"}
                                onSubido={(urls) => agregaUrls(i, urls)}
                              />
                            ) : null}
                            <button type="button" className="btn sm" onClick={() => agregaUrl(i)}>
                              + Añadir url
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {TIPOS_INICIAL.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn sm"
                  onClick={() => agregaPaso(t.id)}
                >
                  + {t.label}
                </button>
              ))}
            </div>

            <h4 className="subtitulo-form">Reglas y preguntas frecuentes</h4>
            <h5 className="subtitulo-form">Reglas del producto</h5>
            <p className="muted small">
              Reglas específicas que el bot aplica con este producto ({" "}
              <code>Reglas</code> ).
            </p>
            {reglas.map((r, i) => (
              <div className="row gap faq-fila" key={`regla${i}`}>
                <textarea
                  rows={2}
                  aria-label={`Regla ${i + 1}`}
                  value={r}
                  onChange={(e) =>
                    setReglas((a) => a.map((x, k) => (k === i ? e.target.value : x)))
                  }
                />
                <button
                  type="button"
                  className="btn sm danger"
                  aria-label="Quitar regla"
                  onClick={() => setReglas((a) => a.filter((_, k) => k !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {reglas.length === 0 ? (
              <p className="muted">Sin reglas todavía.</p>
            ) : null}
            <button
              type="button"
              className="btn sm"
              onClick={() => setReglas((a) => [...a, ""])}
            >
              + Agregar regla
            </button>

            <h5 className="subtitulo-form">Preguntas frecuentes</h5>
            {faq.map((f, i) => (
              <div className="faq-fila" key={`faq${i}`}>
                <input
                  placeholder="Pregunta"
                  aria-label={`Pregunta ${i + 1}`}
                  value={f.pregunta}
                  onChange={(e) => cambiaFaq(setFaq, i, "pregunta", e.target.value)}
                />
                <input
                  placeholder="Respuesta"
                  aria-label={`Respuesta ${i + 1}`}
                  value={f.respuesta}
                  onChange={(e) => cambiaFaq(setFaq, i, "respuesta", e.target.value)}
                />
                <button
                  type="button"
                  className="btn sm danger"
                  aria-label="Quitar pregunta"
                  onClick={() => setFaq((a) => a.filter((_, k) => k !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {faq.length === 0 ? <p className="muted">Sin preguntas todavía.</p> : null}
            <button type="button" className="btn sm" onClick={() => addFaq(setFaq)}>
              + Agregar nueva pregunta frecuente
            </button>

            <h5 className="subtitulo-form">Preguntas frecuentes post-venta</h5>
            <p className="muted small">
              Aplicables después de comprar (<code>preguntasFrecuentesPostVenta</code>).
            </p>
            {faqPost.map((f, i) => (
              <div className="faq-fila" key={`post${i}`}>
                <input
                  placeholder="Pregunta"
                  aria-label={`Pregunta post-venta ${i + 1}`}
                  value={f.pregunta}
                  onChange={(e) => cambiaFaq(setFaqPost, i, "pregunta", e.target.value)}
                />
                <input
                  placeholder="Respuesta"
                  aria-label={`Respuesta post-venta ${i + 1}`}
                  value={f.respuesta}
                  onChange={(e) => cambiaFaq(setFaqPost, i, "respuesta", e.target.value)}
                />
                <button
                  type="button"
                  className="btn sm danger"
                  aria-label="Quitar pregunta post-venta"
                  onClick={() => setFaqPost((a) => a.filter((_, k) => k !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {faqPost.length === 0 ? <p className="muted">Sin preguntas post-venta.</p> : null}
            <button type="button" className="btn sm" onClick={() => addFaq(setFaqPost)}>
              + Agregar nueva pregunta post-venta
            </button>

            <EditorTestimonios
              titulo="Testimonios del producto"
              prefijo="del producto"
              nota={
                <>
                  <code>Testimonios</code>: hasta 20 archivos (imagen, vídeo, audio o documento) del
                  tipo <code>{"{image|video|audio|file: url}"}</code>. Aquí no subimos archivos, así
                  que se pegan sus urls y se ve la vista previa. Cada testimonio es una tarjeta
                  numerada como un paso del mensaje inicial, con su tipo y ↑/↓ para reordenar.
                </>
              }
              testimonios={testi}
              onChange={setTesti}
            />

            <h4 className="subtitulo-form">Integración Dropi</h4>
            <p className="muted small">
              El id es el id del producto en Dropi (p. ej. <code>1870895</code>). El botón lo{" "}
              <strong>valida y vincula en el acto</strong>: si responde ok guarda ya{" "}
              <code>idProductoDropi</code> + <code>nameProductoDropi</code> con{" "}
              <code>updateproducto</code> (el resto del cuerpo sale de la ficha, así que no se
              cuela ninguna edición pendiente). Si no responde ok, no se guarda nada.
            </p>
            <div className="row gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <Campo
                id="ed-dropi-id"
                label="ID en Dropi"
                ayuda={
                  form.nameDropi
                    ? `Vinculado a: ${form.nameDropi}`
                    : "Sin vincular (se rellena al validar)"
                }
              >
                <input
                  id="ed-dropi-id"
                  inputMode="numeric"
                  value={dropiTexto}
                  onChange={(e) => {
                    setDropiTexto(e.target.value);
                    setDropiRes(null);
                  }}
                />
              </Campo>
              <button
                type="button"
                className="btn"
                onClick={() => void validarDropi()}
                disabled={dropiCargando}
                style={{ marginBottom: 12 }}
              >
                {dropiCargando ? "Vinculando..." : "Validar y vincular"}
              </button>
            </div>
            {dropiRes ? (
              dropiRes.ok ? (
                <div className="banner ok">
                  <strong>{dropiRes.msg}</strong> · {texto(dropiRes.product?.name)} · stock{" "}
                  {String(dropiRes.product?.stock ?? "—")} · cod_dane{" "}
                  {String(dropiRes.product?.cod_dane ?? "—")}
                  {dropiRes.product?.private_product ? " · producto privado" : ""}
                  {dropiRes.product?.cod_dane !== undefined &&
                  dropiRes.product?.cod_dane !== null &&
                  String(dropiRes.product.cod_dane) !== form.ciudad ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="btn sm"
                        onClick={aplicarCiudadDropi}
                        title="El panel oficial copia cod_dane a Ciudad"
                      >
                        Usar {String(dropiRes.product.cod_dane)} como ciudad
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <ErrorBanner error={dropiRes.msg} />
              )
            ) : null}

            <h4 className="subtitulo-form">Integraciones vinculadas</h4>
            {(() => {
              const vacios = [null, undefined, "", "0", 0, "none", false];
              const inte = Object.entries(ficha).filter(
                ([k, v]) =>
                  /^(idProducto|nameProducto|eanProducto|byId|byEan|codigoSucursal|referencia|idVariante|activeIntegration)/.test(
                    k,
                  ) && !vacios.includes(v as any),
              );
              return inte.length ? (
                <div className="chips">
                  {inte.map(([k, v]) => (
                    <span key={k} className="chip" title={k}>
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted small">Sin integraciones vinculadas.</p>
              );
            })()}

            <details className="avanzado">
              <summary className="subtitulo-form">
                Todos los campos ({Object.keys(ficha).length})
              </summary>
              <p className="muted small">
                Lo marcado <span className="chip ok">sí</span> está entre las 87 claves de{" "}
                <code>updateproducto</code> y se guarda con este formulario;{" "}
                <span className="chip">no</span> significa que LucidSales no lo acepta (se queda
                como está en la base de datos).
              </p>
              <div className="table-wrap">
                <table className="table campo-detalle">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Valor</th>
                      <th>¿Se guarda?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ficha).map(([k, v]) => (
                      <tr key={k}>
                        <td>
                          <code>{k}</code>
                        </td>
                        <td>
                          <div className="valor-campo">{valorLegible(v)}</div>
                        </td>
                        <td>
                          {ES_OFICIAL.has(k) ? (
                            <span className="chip ok">sí</span>
                          ) : (
                            <span className="chip">no</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <ErrorBanner error={errEdit} />
          </form>
        ) : null}
      </Modal>

      {/* -------- eliminar -------- */}
      <ConfirmDialog
        open={!!borrando}
        title="Eliminar producto"
        danger
        loading={borrandoOk}
        confirmLabel="Eliminar"
        message={
          <>
            Se eliminará <strong>{borrando?.Nombre || borrando?.name || borrando?.id}</strong> de la
            tienda. Esta acción no se puede deshacer.
          </>
        }
        onConfirm={eliminar}
        onCancel={() => setBorrando(null)}
      />
    </>
  );
}
