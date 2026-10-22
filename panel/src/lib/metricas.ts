// Rangos de fecha para la seccion de Metricas.
//
// Replican los helpers del chunk oficial `MetricasLucidSalesScreen`:
//   Mi(d)   -> primer instante del dia   (00:00:00.000 local)
//   oh(d)   -> ultimo instante del dia   (23:59:59.999 local)
//   xr(d,n) -> fecha +/- n dias
//   ah(fin, ini) -> dias de diferencia entre los dos dias
//
// El oficial manda al endpoint DOS periodos: el seleccionado y el anterior
// inmediato de la misma duracion, para poder pintar la serie "actual" contra
// la "anterior" y el % de variacion:
//   compareEnd   = diaAnteriorAlInicio
//   compareStart = compareEnd - (diasDelRango - 1)
//
// Fechas en hora LOCAL del navegador (no UTC): eso es lo que espera el
// servidor, que las recorta a dia en America/Bogota.

export interface Rango {
  desde: Date;
  hasta: Date;
}

export interface ConsultaMetricas {
  startDate: string;
  endDate: string;
  compareStartDate: string;
  compareEndDate: string;
  productId?: string;
  source?: string;
  dropshippingProvider?: string;
}

const DIA_MS = 86_400_000;

/** 00:00:00.000 del dia (local). */
export function inicioDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 23:59:59.999 del dia (local). */
export function finDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Fecha +/- n dias (conserva la hora). */
export function sumaDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Dias naturales que hay de `inicio` a `fin` (0 si son el mismo dia). */
export function diasEntre(fin: Date, inicio: Date): number {
  return Math.round((inicioDia(fin).getTime() - inicioDia(inicio).getTime()) / DIA_MS);
}

export function mismoDia(a: Date, b: Date): boolean {
  return inicioDia(a).getTime() === inicioDia(b).getTime();
}

/** Rango de un solo dia. */
export function rangoDia(d: Date): Rango {
  return { desde: inicioDia(d), hasta: finDia(d) };
}

export function hoy(): Rango {
  return rangoDia(new Date());
}

export function ayer(): Rango {
  return rangoDia(sumaDias(new Date(), -1));
}

/** Los ultimos `n` dias incluyendo hoy. */
export function ultimosDias(n: number): Rango {
  const hasta = finDia(new Date());
  const desde = inicioDia(sumaDias(new Date(), -(n - 1)));
  return { desde, hasta };
}

/** Del dia 1 del mes hasta hoy. */
export function mesActual(): Rango {
  const ahora = new Date();
  return { desde: inicioDia(new Date(ahora.getFullYear(), ahora.getMonth(), 1)), hasta: finDia(ahora) };
}

/** Todo el mes anterior. */
export function mesAnterior(): Rango {
  const ahora = new Date();
  const primero = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const ultimo = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
  return { desde: inicioDia(primero), hasta: finDia(ultimo) };
}

/** "6 oct" (sin anio, como pinta el oficial). */
export function corta(d: Date): string {
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/**
 * Nombre del rango, con la misma logica que el oficial:
 * "Hoy" · "Ayer" · "Semana anterior" · "Mes anterior" · "6 oct - 12 oct".
 */
export function etiquetaRango(desde: Date, hasta: Date): string {
  const dias = diasEntre(hasta, desde) + 1;
  if (dias === 1) {
    if (mismoDia(desde, new Date())) return "Hoy";
    if (mismoDia(desde, sumaDias(new Date(), -1))) return "Ayer";
    return corta(desde);
  }
  if (dias === 7) return "Semana anterior";
  if (dias >= 28 && dias <= 31) return "Mes anterior";
  return `${corta(desde)} - ${corta(hasta)}`;
}

/** El periodo inmediatamente anterior, de la misma duracion. */
export function periodoAnterior(r: Rango): Rango {
  const dias = diasEntre(r.hasta, r.desde); // 0 en un solo dia
  const fin = sumaDias(inicioDia(r.desde), -1);
  return { desde: sumaDias(fin, -dias), hasta: finDia(fin) };
}

/**
 * Query del `GET /analitica/get-analytics-data` tal y como la arma el oficial.
 * Los opcionales vacios no se mandan (el cliente los omite igual).
 */
export function armarConsulta(r: Rango, filtros: {
  productId?: string;
  source?: string;
  dropshippingProvider?: string;
} = {}): ConsultaMetricas {
  const anterior = periodoAnterior(r);

  return {
    startDate: inicioDia(r.desde).toISOString(),
    endDate: finDia(r.hasta).toISOString(),
    compareStartDate: inicioDia(anterior.desde).toISOString(),
    compareEndDate: finDia(anterior.hasta).toISOString(),
    ...(filtros.productId ? { productId: filtros.productId } : {}),
    ...(filtros.source ? { source: filtros.source } : {}),
    ...(filtros.dropshippingProvider ? { dropshippingProvider: filtros.dropshippingProvider } : {}),
  };
}

// ---------------- Formas de la respuesta ----------------

/** Una hora (o un dia, si el rango pasa de un dia) de la serie. */
export interface PuntoSerie {
  name: string;
  current: number;
  previous: number;
  orders_current: number;
  orders_previous: number;
}

/** Una fila de los tres bloques de estados. */
export interface FilaEstado {
  name: string;
  value: number;
  amount: number;
  percentage: number;
  change: number;
}

export interface DatosMetricas {
  ok: boolean;
  ventasTotales: { value: number; change: number };
  pedidosTotales: { value: number; change: number };
  utilidaData: {
    value: number;
    change: string | number;
    gananciaEsperada: number;
    costoPublicidad: number;
    costoDevolucion: number;
  };
  lineChartData: PuntoSerie[];
  confirmationData: FilaEstado[];
  statusData: FilaEstado[];
  shippingStatusData: FilaEstado[];
  rawMetrics?: {
    main?: Record<string, unknown>;
    comparison?: Record<string, unknown>;
  };
}

/**
 * Los estados de guia agrupados en 4 como hace el oficial:
 * Entregado (contiene "entregad") · Devuelto (contiene "devoluci") ·
 * En Novedad (contiene "novedad") · el resto, En Transito.
 */
export function agrupaGuias(filas: FilaEstado[] | undefined): Array<{ name: string; value: number }> {
  const salida = { Entregado: 0, Devuelto: 0, "En Novedad": 0, "En Transito": 0 };
  for (const f of filas ?? []) {
    const n = String(f.name ?? "").toLowerCase();
    const v = Number(f.value) || 0;
    if (n.includes("entregad")) salida.Entregado += v;
    else if (n.includes("devoluci")) salida.Devuelto += v;
    else if (n.includes("novedad")) salida["En Novedad"] += v;
    else salida["En Transito"] += v;
  }
  return Object.entries(salida).map(([name, value]) => ({ name, value }));
}

/** % de entregados (la "tasa de entrega" del oficial). */
export function tasaEntrega(filas: FilaEstado[] | undefined): { value: number; change: number } {
  const f = (filas ?? []).find(
    (x) => String(x.name).toUpperCase() === "ENTREGADO" || String(x.name).toLowerCase() === "entregado",
  );
  return { value: Number(f?.percentage) || 0, change: Number(f?.change) || 0 };
}

// ---------------- Metricas de Meta (pantalla "Ventas LucidBot") ----------------

/** Una fila de `GET /meta/metrics/{id}`: cualquier campo puede venir null. */
export interface FilaMeta {
  adTitle?: string | null;
  Test?: number | null;
  Producto?: string | null;
  idProducto?: number | null;
  adSetTitle?: string | null;
  campaignTitle?: string | null;
  accountTitle?: string | null;
  adId?: string | null;
  messages?: number | null;
  costPerMessage?: number | null;
  sells?: number | null;
  total?: string | number | null;
  costPerSale?: number | null;
  cierre?: number | null;
  clicks?: number | null;
  spend?: number | null;
  impressions?: number | null;
  reach?: number | null;
  ctr?: number | null;
  cpm?: number | null;
  orderStatus?: number | null;
  fulfillmentStatus?: string | null;
}

/**
 * "2026-10-06" en hora LOCAL. Este endpoint no quiere hora ni Z: el oficial
 * manda `startDate`/`endDate` en plano (2026-10-06T05:00Z seria "ayer" para
 * el servidor).
 */
export function aDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TotalesMeta {
  impressions: number;
  reach: number;
  ctr: number;
  cpm: number;
  clicks: number;
  messages: number;
  sells: number;
  total: number;
  spend: number;
  costPerMessage: number;
  costPerSale: number;
  cierre: number;
  roas: number;
}

const soloNumero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Totales de la tabla, igual que los calcula el oficial sobre las filas:
 * **suma** para impressions, reach, clicks, messages, sells, total y spend;
 * **promedio** para ctr, cpm y costPerMessage (contando solo las filas que
 * traen valor); y aparte `costPerSale = inversion / ventas`,
 * `cierre = ventas / mensajes` y `roas = total / inversion`.
 */
export function acumulaMeta(filas: FilaMeta[]): TotalesMeta {
  const t = { impressions: 0, reach: 0, clicks: 0, messages: 0, sells: 0, total: 0, spend: 0 };
  let ctr = 0,
    ctrN = 0,
    cpm = 0,
    cpmN = 0,
    msg = 0,
    msgN = 0;

  for (const f of filas) {
    t.impressions += soloNumero(f.impressions);
    t.reach += soloNumero(f.reach);
    t.clicks += soloNumero(f.clicks);
    t.messages += soloNumero(f.messages);
    t.sells += soloNumero(f.sells);
    t.total += soloNumero(f.total);
    t.spend += soloNumero(f.spend);
    if (f.ctr !== null && f.ctr !== undefined) {
      ctr += soloNumero(f.ctr);
      ctrN++;
    }
    if (f.cpm !== null && f.cpm !== undefined) {
      cpm += soloNumero(f.cpm);
      cpmN++;
    }
    if (f.costPerMessage !== null && f.costPerMessage !== undefined) {
      msg += soloNumero(f.costPerMessage);
      msgN++;
    }
  }

  return {
    ...t,
    ctr: ctrN ? ctr / ctrN : 0,
    cpm: cpmN ? cpm / cpmN : 0,
    costPerMessage: msgN ? msg / msgN : 0,
    costPerSale: t.sells ? t.spend / t.sells : 0,
    cierre: t.messages ? (t.sells / t.messages) * 100 : 0,
    roas: t.spend ? t.total / t.spend : 0,
  };
}

/** Nombre de campaña de una fila ("Orgánico" si no viene de una campaña). */
export function etiquetaCampana(f: FilaMeta): string {
  return f.campaignTitle || (String(f.adId ?? "") === "organico" ? "Orgánico" : "Sin campaña");
}

/** Un renglón de la vista "por campaña" (estilo Ads Manager). */
export interface ResumenCampana {
  campana: string;
  anuncios: number;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  messages: number;
  costPerMessage: number;
  ctr: number;
  cpm: number;
  sells: number;
  total: number;
  costPerSale: number;
  roas: number;
  cierre: number;
}

/**
 * Agrupa las filas por campaña como hace Ads Manager: sumas para lo
 * acumulable y ratios recalculados sobre el conjunto (CTR = clics/impresiones,
 * CPM = inversion/impresiones x 1000, costo por venta = inversion/ventas,
 * ROAS = total/inversion). Ordena por inversion y deja lo organico al final.
 */
export function agrupaCampanas(filas: FilaMeta[]): ResumenCampana[] {
  const grupos = new Map<string, FilaMeta[]>();
  for (const f of filas) {
    const k = etiquetaCampana(f);
    const lista = grupos.get(k);
    if (lista) lista.push(f);
    else grupos.set(k, [f]);
  }

  const salida: ResumenCampana[] = [];
  for (const [campana, filasGrupo] of grupos) {
    const t = acumulaMeta(filasGrupo);
    const impressions = t.impressions;
    const spend = t.spend;
    salida.push({
      campana,
      anuncios: filasGrupo.length,
      spend,
      impressions,
      reach: t.reach,
      clicks: t.clicks,
      messages: t.messages,
      costPerMessage: t.costPerMessage,
      ctr: impressions ? (t.clicks / impressions) * 100 : t.ctr,
      cpm: impressions ? (spend / impressions) * 1000 : t.cpm,
      sells: t.sells,
      total: t.total,
      costPerSale: t.costPerSale,
      roas: t.roas,
      cierre: t.cierre,
    });
  }

  const esOrganico = (n: string) => n === "Orgánico" || n === "Sin campaña";
  return salida.sort((a, b) => {
    if (esOrganico(a.campana) !== esOrganico(b.campana)) return esOrganico(a.campana) ? 1 : -1;
    if (b.spend !== a.spend) return b.spend - a.spend;
    if (b.total !== a.total) return b.total - a.total;
    return a.campana.localeCompare(b.campana, "es");
  });
}
