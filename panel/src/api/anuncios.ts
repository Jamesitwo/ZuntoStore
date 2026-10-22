// Rentabilidad de las campanas de Meta Ads: tipos, llamadas al backend
// propio (/api/anuncios) y formatos de presentacion.
import { backend, backendArchivo } from "./backend";

export type Clase = "RENTABLE" | "AJUSTADA" | "RIESGO" | "PERDIDA" | "SINDATO";
export type VistaCsv = "campanas" | "alertas" | "productos";

export const CLASES: Clase[] = ["RENTABLE", "AJUSTADA", "RIESGO", "PERDIDA", "SINDATO"];

export const ETIQUETAS: Record<Clase, string> = {
  RENTABLE: "Rentable",
  AJUSTADA: "Ajustada",
  RIESGO: "Por vigilar",
  PERDIDA: "Pérdida",
  SINDATO: "Sin dato",
};

/** Clase a la que pertenece una fila de la tabla (para colorear). */
export const CLASE_CLS: Record<Clase, string> = {
  RENTABLE: "clase-rentable",
  AJUSTADA: "clase-ajustada",
  RIESGO: "clase-riesgo",
  PERDIDA: "clase-perdida",
  SINDATO: "clase-sindato",
};

export interface Accion {
  titulo: string;
  detalle: string;
  prioridad: number;
}

export interface Campana {
  id: string;
  nombre: string;
  cuenta: string;
  estado: "ACTIVE" | "PAUSED" | "DELETED" | string;
  creada: string;
  diasActivos: number | null;
  diasMedidos: number;
  gasto: number;
  gasto7: number;
  compras: number;
  compras7: number;
  roas: number;
  impresiones: number;
  clics: number;
  unidad: number;
  /** null = producto sin ganancia promedio cargada (SINDATO). */
  margen: number | null;
  neto: number | null;
  roi: number | null;
  cpa: number | null;
  clase: Clase;
  /** Meta la reporta encendida (status ACTIVE). */
  activa: boolean;
  /**
   * ¿Está en alerta hoy? Solo vale para las clases prioritarias que siguen
   * ACTIVAS y con al menos `minDiasAlerta` días de datos: una pausada ya fue
   * decidida y una de 1–2 días todavía no dice nada.
   */
  alerta: boolean;
  /** Por qué NO está en alerta (si lo estaría): "" | "pausada" | "nueva". */
  alertaMotivo: "" | "pausada" | "nueva";
  productos: string[];
  compartida: boolean;
  accion: Accion;
}

export interface ProductoFila {
  nombre: string;
  precio: number;
  unidad: number;
  campanas: number;
  gasto: number;
  compras: number;
  margen: number | null;
  neto: number | null;
  roi: number | null;
  compartida: boolean;
  clase: Clase;
  /**
   * Promedio que salio de los PEDIDOS de LucidSales: la ganancia NETA real por
   * pedido (`utilidaData.gananciaEsperada`, ya con envio y costo del proveedor
   * descontados) dividida entre los pedidos del producto en la ventana. No
   * entra en el calculo: esta a la vista para compararlo con `unidad` y
   * adoptarlo con un clic.
   */
  pedidosProm: number | null;
  pedidosN: number;
  /**
   * Total de pedidos en la ventana (incluye los "Sin Envio" / "Cancelado",
   * que no entran al promedio porque todavia no tienen flete ni costo).
   */
  pedidosNTotal: number;
  pedidosDesde: string | null;
  pedidosHasta: string | null;
  /** "pedidos" si el valor actual salio del traedor, "manual" si lo escribieron. */
  origenGanancia: "pedidos" | "manual" | null;
}

export interface CuentaFila {
  nombre: string;
  moneda: string;
  campanas: number;
  gasto: number;
  compras: number;
  cpa: number | null;
  margen: number;
  neto: number;
  roi: number;
  perdidas: number;
  conteos: Record<Clase, number>;
}

export interface Totales {
  gasto: number;
  compras: number;
  cpa: number;
  margen: number;
  neto: number;
  roi: number;
  campanas: number;
  gasto7: number;
  compras7: number;
  perdidas: number;
  perdidasDia: number;
}

export interface Datos {
  ok: boolean;
  generado: string;
  fuente: "live" | "snapshot";
  aviso: string | null;
  ventana: { desde: string; hasta: string; dias: number };
  /** Días mínimos de datos de la campaña antes de poder juzgarla. */
  minDiasAlerta: number;
  trm: number;
  totales: Totales;
  conteos: Record<Clase, number>;
  campanas: Campana[];
  productos: ProductoFila[];
  cuentas: CuentaFila[];
}

/** id de campana -> {hecho, nota} */
export interface PlanMap {
  [id: string]: { hecho?: boolean; nota?: string };
}

/** Cuenta publicitaria visible con el token de un usuario. */
export interface CuentaMeta {
  id: string;
  nombre: string;
  moneda: string;
  activa: boolean;
  seleccionada: boolean;
}

/**
 * Estado de la cuenta de Meta del usuario que pide:
 *   enUso "propia"      -> conecto su token y analiza sus cuentas
 *   enUso "compartida"  -> trabaja sobre el espacio compartido (Pizdo + Orenar)
 *   enUso "ninguna"     -> sin token y sin espacio compartido: hay que conectar
 */
export interface EstadoCuenta {
  usuario: string | null;
  enUso: "propia" | "compartida" | "ninguna";
  conectada: boolean;
  compartidaDisponible: boolean;
  nombre: string | null;
  trm: number;
  /** fecha (YYYY-MM-DD) en que vence el token; null si Meta no la da */
  expira: string | null;
  conectado: string | null;
  cuentas: CuentaMeta[];
}

/** Ajustes del traedor de ganancias (viven en el config del espacio). */
export interface AjustesGanancias {
  /** recalcula solo, una vez al dia, cuando se piden datos frescos */
  auto: boolean;
  /** pedidos minimos en la ventana para confiar en un promedio */
  minPedidos: number;
  /** tienda de LucidSales de la que salen los pedidos */
  tienda: number;
  /** ventana usada para promediar: 7 | 15 | 30 dias */
  dias: number;
  /**
   * Estados de envio que CUENTAN para el promedio: la muestra son solo los
   * pedidos que traen ganancia (Dropi calcula el flete y el costo al
   * entregar; los demas entran con 0 y hundirian el promedio).
   */
  incluirEstados: string[];
}

/** Un estado de envio visto en el calculo, con cuantos pedidos hay de él. */
export interface EstadoPedidos {
  nombre: string;
  /** pedidos de la ventana en ese estado (todos los productos) */
  n: number;
  /** true = no cuenta para el promedio */
  excluido: boolean;
}

export interface GananciasUltimo {
  fecha: string | null;
  ejecutado: string | null;
  dias: number | null;
  desde: string | null;
  hasta: string | null;
  tienda: number | null;
  minPedidos: number | null;
  estado: "enCurso" | "listo" | "error" | null;
  error: string | null;
  productos: number;
  conPedidos: number;
  conPromedio: number;
  rellenados: number;
  sinMatch: number;
  errores: number;
  /** promedio ponderado COP por pedido (null si nadie tiene ganancia) */
  promedioGlobal: number | null;
}

/** Estado del traedor: ajustes + corrida en curso + ultimo resultado. */
export interface EstadoGanancias {
  /** false = el servidor no tiene credenciales de LucidSales */
  disponible: boolean;
  ajustes: AjustesGanancias;
  /** estados vistos en el ultimo calculo, para armar el selector de la UI */
  estados: EstadoPedidos[];
  enCurso: boolean;
  progreso: { total: number; listos: number; dias: number; inicio: string } | null;
  ultimo: GananciasUltimo | null;
  /** el automatico encontro la corrida de hoy y no repitio */
  yaActualizado?: boolean;
}

export const anuncios = {
  /** Datos de la ventana (7 | 15 | 30 dias). `actualizar` salta el cache del dia. */
  datos: (dias: number, actualizar = false) =>
    backend<Datos>(`/api/anuncios?dias=${dias}${actualizar ? "&actualizar=1" : ""}`),
  /** Vuelve a bajar los datos de Meta aunque haya cache. */
  actualizar: (dias: number) =>
    backend<{ ok: boolean; msg: string; campanas: number }>(`/api/anuncios/actualizar`, {
      method: "POST",
      body: { dias },
    }),

  /** Cambia la ganancia promedio de un producto y recalcula todo al vuelo. */
  guardarGanancia: (nombre: string, ganancia: number) =>
    backend<{ ok: boolean; nombre: string; ganancia: number }>(`/api/anuncios/ganancia`, {
      method: "POST",
      body: { nombre, ganancia },
    }),

  plan: () => backend<{ ok: boolean; plan: PlanMap }>(`/api/anuncios/plan`),

  marcar: (id: string, entrada: { hecho?: boolean; nota?: string }) =>
    backend<{ ok: boolean; entrada: { hecho?: boolean; nota?: string } }>(`/api/anuncios/plan`, {
      method: "POST",
      body: { id, ...entrada },
    }),

  /** Descarga el CSV en Excel (; y BOM). */
  csv: (dias: number, vista: VistaCsv) =>
    backendArchivo(`/api/anuncios/csv?dias=${dias}&vista=${vista}`),

  /** Estado de la conexion de Meta del usuario actual (x-usuario). */
  estado: () => backend<EstadoCuenta>(`/api/anuncios/cuenta`),

  /** Valida el token pegado contra /me y guarda sus cuentas candidatas. */
  conectar: (token: string) =>
    backend<{
      ok: boolean;
      msg: string;
      usuario: { id: string; nombre: string };
      expira: string | null;
      seleccionadas: number;
      cuentas: CuentaMeta[];
    }>(`/api/anuncios/conectar`, { method: "POST", body: { token } }),

  /** Elige que cuentas entran al analisis (y opcionalmente la TRM). */
  guardarCuentas: (cuentas: string[], trm?: number) =>
    backend<{
      ok: boolean;
      msg: string;
      trm: number;
      cuentas: Array<{ id: string; nombre: string; moneda: string }>;
    }>(`/api/anuncios/cuentas`, { method: "POST", body: { cuentas, trm } }),

  /** Deja de usar el token propio (borrar=true elimina tambien sus datos). */
  desconectar: (borrar = false) =>
    backend<{ ok: boolean; msg: string }>(`/api/anuncios/desconectar`, {
      method: "POST",
      body: { borrar },
    }),

  // ---------------------------------------------- ganancias de los pedidos

  /** Ajustes, progreso de la corrida en curso y el ultimo resultado. */
  ganancias: () => backend<EstadoGanancias>(`/api/anuncios/ganancias`),

  /**
   * Pide la ganancia NETA real de cada pedido a LucidSales (gananciaEsperada,
   * ya con envio y costo del proveedor descontados) y la promedia por
   * producto. Responde enseguida (el trabajo sigue en segundo plano): hay que
   * sondear `ganancias()` hasta que `enCurso` sea false.
   */
  traerGanancias: (opts: { dias?: number; forzar?: boolean } = {}) =>
    backend<EstadoGanancias>(`/api/anuncios/ganancias`, {
      method: "POST",
      body: opts,
    }),

  /** Guarda {auto, minPedidos, tienda, dias} en el config del espacio. */
  ajustesGanancias: (ajustes: Partial<AjustesGanancias>) =>
    backend<{ ok: boolean; ajustes: AjustesGanancias }>(`/api/anuncios/ganancias/ajustes`, {
      method: "POST",
      body: ajustes,
    }),
};

// ------------------------------------------------------------------ formatos

/** Pesos colombianos sin decimales: $53.881.605 */
export function dinero(v: number | null | undefined, decimales = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = Math.abs(v);
  const texto = n.toLocaleString("es-CO", { maximumFractionDigits: decimales });
  return `${v < 0 ? "−" : ""}$${texto}`;
}

/** Multiplicador: 2.76x (una cifra si es chico). */
export function veces(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(2).replace(".", ",")}x`;
}

/** Porcentaje entero. */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

/** Fecha corta "23 sep" a partir de "2026-09-23". */
export function fechaCorta(iso: string): string {
  if (!iso) return "—";
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [a, m, d] = iso.slice(0, 10).split("-");
  if (!a) return iso;
  return `${Number(d)} ${meses[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

/** Hace cuantos dias ocurrio (para "generado hace 5 min"). */
export function haceCuanto(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const seg = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seg < 60) return "hace unos segundos";
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
