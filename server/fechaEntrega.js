// Fechas de entrega pedidas por el cliente ("lo quiero para el 30").
// Todo en hora de Colombia y como "AAAA-MM-DD" (sin horas: es un dia).

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
/** Mas alla de esto no es una fecha de entrega creible (o se leyo mal). */
export const MAX_DIAS = 180;

const sinTildes = (t) =>
  String(t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Hoy en Colombia (UTC-5, sin horario de verano). */
export function hoyColombia(ahora = Date.now()) {
  return new Date(ahora - 5 * 3600_000).toISOString().slice(0, 10);
}

const aDia = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const deDia = (ms) => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (iso, n) => deDia(aDia(iso) + n * 86400_000);

/** Dias que faltan de `hoy` a `fecha` (negativo si ya paso). */
export function diasHasta(fecha, hoy = hoyColombia()) {
  return Math.round((aDia(fecha) - aDia(hoy)) / 86400_000);
}

/** "2026-10-30" valida, de hoy en adelante y no absurda; si no, null. */
export function fechaValida(v, hoy = hoyColombia(), { permitirPasada = false } = {}) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || deDia(d.getTime()) !== s) return null;
  const n = diasHasta(s, hoy);
  if ((!permitirPasada && n < 0) || n > MAX_DIAS) return null;
  return s;
}

function construir(anio, mes, dia) {
  const ms = Date.UTC(anio, mes, dia);
  const iso = deDia(ms);
  // 31 de febrero -> no existe
  return Number(iso.slice(8, 10)) === dia ? iso : null;
}

/**
 * Texto del cliente -> fecha concreta, o null si no hay forma segura de saberla.
 * Entiende: "mañana", "pasado mañana", "el viernes", "el 30", "30 de octubre",
 * "30/10" y "30/10/2026". "La próxima semana" no es un dia: null.
 */
export function interpretarFecha(texto, hoy = hoyColombia()) {
  const t = sinTildes(texto);
  if (!t.trim()) return null;
  const [a, m] = hoy.split("-").map(Number);
  if (/\bpasado\s+manana\b/.test(t)) return sumarDias(hoy, 2);
  if (/\bmanana\b/.test(t)) return sumarDias(hoy, 1);
  // 30/10 o 30-10(-2026)
  let x = t.match(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/);
  if (x) {
    const dia = +x[1];
    const mes = +x[2] - 1;
    let anio = x[3] ? +x[3] : a;
    if (anio < 100) anio += 2000;
    let f = mes >= 0 && mes < 12 ? construir(anio, mes, dia) : null;
    if (f && !x[3] && diasHasta(f, hoy) < 0) f = construir(anio + 1, mes, dia);
    return fechaValida(f, hoy);
  }
  // 30 de octubre
  x = t.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MESES.join("|")})\\b`));
  if (x) {
    const mes = MESES.indexOf(x[2]);
    let f = construir(a, mes, +x[1]);
    if (f && diasHasta(f, hoy) < 0) f = construir(a + 1, mes, +x[1]);
    return fechaValida(f, hoy);
  }
  // el viernes / el proximo viernes: el siguiente (nunca hoy)
  x = t.match(new RegExp(`\\b(${DIAS.join("|")})\\b`));
  if (x) {
    const hoyDia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
    let n = (DIAS.indexOf(x[1]) - hoyDia + 7) % 7;
    if (n === 0) n = 7;
    return sumarDias(hoy, n);
  }
  // "para el 30", "el dia 5": este mes, o el siguiente si ya paso
  x = t.match(/\b(?:el|dia)\s+(?:dia\s+)?(\d{1,2})\b/);
  if (x) {
    const dia = +x[1];
    let f = construir(a, m - 1, dia);
    if (!f || diasHasta(f, hoy) < 0) {
      const sig = m === 12 ? [a + 1, 0] : [a, m];
      f = construir(sig[0], sig[1], dia);
    }
    return fechaValida(f, hoy);
  }
  return null;
}

/** Fecha de entrega de lo que leyo la IA: la concreta si es valida, si no la del texto. */
export function fechaDeExtraccion(extraido, hoy = hoyColombia()) {
  return fechaValida(extraido?.fechaEntregaISO, hoy) ?? interpretarFecha(extraido?.fechaEntregaSolicitada, hoy);
}
