// Formato legible para el usuario final.

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3 oct 2026, 10:12" (hora local) */
export function fmtFecha(v: unknown): string {
  const d = toDate(v);
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Solo fecha "3 oct 2026" */
export function fmtFechaCorta(v: unknown): string {
  const d = toDate(v);
  if (!d) return "—";
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** "hace 2 dias" / "en 3 horas" */
export function haceCuanto(v: unknown): string {
  const d = toDate(v);
  if (!d) return "";
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (abs < min) return "ahora mismo";
  if (abs < hour) return rtf.format(Math.round(diffMs / min), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  if (abs < 365 * day) return rtf.format(Math.round(diffMs / (30 * day)), "month");
  return rtf.format(Math.round(diffMs / (365 * day)), "year");
}

/** "+573001112233" -> {tel: "+573001112233", wa: "573001112233", visible: "300 111 2233" } */
export function telefono(v: unknown): { tel: string; wa: string; visible: string } | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  const wa = digits.replace(/\+/g, "");
  const visible = digits.replace(/^\+?(\d{2})?(\d{3})(\d{3})(\d+)$/, (_m, _cc, a, b, c) =>
    [a, b, c].join(" "),
  );
  return { tel: digits, wa, visible };
}

/**
 * Clave de comparacion entre el telefono del cliente y el `Movil` del pedido:
 * "+57 (300) 123-4567" / "3001234567" / "00573001234567" -> "3001234567".
 * Devuelve "" si el dato no tiene suficientes digitos para ser un telefono.
 */
export function claveTelefono(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : "";
}

/** Numero con separadores de miles y 2 decimales max. */
export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}
