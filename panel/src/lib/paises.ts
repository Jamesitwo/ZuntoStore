/**
 * Prefijos de pais que usa el panel oficial en el formulario de usuarios
 * (el chunk AjustesUsuariosScreen trae exactamente estos tres).
 */
export const CODIGOS_PAIS: Array<[string, string, string]> = [
  ["CO", "57", "Colombia"],
  ["PA", "507", "Panamá"],
  ["MX", "52", "México"],
];

/** "573001234567" -> { codigo: "CO", digitos: "3001234567" } (prefijo mas largo que aplique). */
export function separaTelefono(valor: unknown, porDefecto = "CO") {
  const d = String(valor ?? "").replace(/\D/g, "");
  let prefijo = "";
  let codigo = porDefecto;
  for (const [c, p] of CODIGOS_PAIS) {
    if (p.length > prefijo.length && d.startsWith(p)) {
      prefijo = p;
      codigo = c;
    }
  }
  return { codigo, digitos: prefijo ? d.slice(prefijo.length) : d };
}

/** "CO" + "3001234567" -> "573001234567": prefijo del pais SIN "+", igual que LucidSales. */
export function juntaTelefono(codigo: string, digitos: string): string {
  const p = CODIGOS_PAIS.find(([c]) => c === codigo)?.[1] ?? "";
  return `${p}${String(digitos ?? "").replace(/\D/g, "")}`;
}

/** Agrupa el numero local: CO/MX 10 digitos 3-3-4, PA 8 digitos 4-4. */
function agrupa(d: string): string {
  if (d.length === 8) return d.replace(/(\d{4})(\d{4})/, "$1 $2");
  if (d.length >= 10) return d.replace(/(\d{3})(\d{3})(\d+)$/, "$1 $2 $3");
  return d;
}

/**
 * "573002220002" -> "+57 300 222 0002".
 * A diferencia de `telefono()` (de lib/format), aqui el prefijo se detecta por
 * longitud asi que funciona tambien con Panama (+507, 3 digitos).
 */
export function verTelefonoPrefijo(v: unknown): string {
  const { codigo, digitos } = separaTelefono(v);
  if (!digitos) return "";
  const pref = CODIGOS_PAIS.find(([c]) => c === codigo)?.[1] ?? "";
  return pref ? `+${pref} ${agrupa(digitos)}` : agrupa(digitos);
}
