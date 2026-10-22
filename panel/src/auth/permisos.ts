// Permisos de LucidSales (el `rol` del login y el campo `Permisos` de cada
// usuario de la tienda).
//
// El rol es una lista de numeros separados por comas ("2,5"), o "all"/"admin".
// El panel OFICIAL lo comprueba en dos sitios:
//   1) el menu lateral (cada enlace se pinta solo si el rol incluye su numero)
//   2) el registro de rutas (las rutas se registran solo si hay permiso)
//
// Mapa oficial (bundle):
//   2 Pedidos (+ pedidos-crear)      3 Clientes        4 Metricas
//   5 Productos (+ producto-crear)   6 Bot + Llamadas  7 Ajustes -> Usuarios
//   8 Ajustes -> General e Integraciones
//   Sin numero (siempre): perfil, facturacion/media, wallets, salir.
//
// Los NOMBRES salen de los checkbox del formulario "Agregar empleado" del
// chunk oficial AjustesUsuariosScreen: 5=Catalogo, 2=Pedidos, 3=Clientes,
// 4=Metricas, 6=Lucid Bot, 8=Ajustes Tienda, 7=Usuarios y Permisos.
// El numero 1 aparece en los roles reales ("1,2,3,...") pero no tiene ni
// checkbox ni condicion de menu: lo tratamos como "Permiso 1".
//
// Nosotros: 6 Bot no existe; Inicio no tiene numero y **4 = Metricas si
// existe**: pagina propia `/metricas` (seccion oficial `metricas-lucidsales`
// con el endpoint `/analitica/get-analytics-data`).
//
// OJO: esto es ocultamiento de UI, exactamente lo que hace el panel oficial;
// no sustituye a la validacion del servidor (que no hemos podido verificar).

export const PERMISOS = {
  pedidos: "2",
  productos: "5",
  clientes: "3",
  /** Seccion "metricas" / "metricas-lucidsales" del panel oficial. */
  metricas: "4",
  /**
   * Seccion propia: rentabilidad de las campanas de Meta Ads (pagina
   * /anuncios). Es analitica, asi que se apoya en el mismo 4 que Metricas:
   * quien puede ver Metricas puede ver estas campanas.
   */
  rentabilidad: "4",
  ajustesGeneral: "8",
  ajustesUsuarios: "7",
} as const;

export type Seccion = keyof typeof PERMISOS;

/** Nombre oficial de cada numero (checkboxes del formulario del panel oficial). */
export const NOMBRES_PERMISO: Record<string, string> = {
  "2": "Pedidos",
  "3": "Clientes",
  "4": "Métricas",
  "5": "Catálogo",
  "6": "Lucid Bot",
  "7": "Usuarios y Permisos",
  "8": "Ajustes Tienda",
};

/**
 * Cualquier formato de permiso -> lista de numeros.
 * Acepta "2,5" · '["2","5"]' (como escribe el oficial en users/update) ·
 * "all" · null. Los numeros desconocidos se conservan ("1" no tiene nombre).
 */
export function normalizaPermisos(rol: unknown): string[] {
  if (typeof rol === "number") return [String(rol)];
  if (typeof rol !== "string") return [];
  const t = rol.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* formato raro: seguimos con el split de abajo */
    }
  }
  return t
    .split(",")
    .map((x) => x.trim().replace(/^["'[\]]+|["'[\]]+$/g, ""))
    .filter(Boolean);
}

/**
 * ¿Es acceso total? `null` / `undefined` / `""` / `all` / `admin`.
 * (El oficial trata `null` como acceso total; nosotros el `""` tambien para no
 * dejarlo todo cerrado si el login no trae rol.)
 */
export function esAccesoTotal(rol: unknown): boolean {
  if (rol === null || rol === undefined) return true;
  const r = String(rol).trim().toLowerCase();
  return !r || r === "all" || r === "admin";
}

/** ¿Tiene el `numero` indicado? */
export function tienePermiso(rol: string | null | undefined, numero: string): boolean {
  if (esAccesoTotal(rol)) return true;
  return normalizaPermisos(rol).includes(numero);
}

/** `seccion` o lista de secciones: basta con que cumpla una. */
export function puede(
  rol: string | null | undefined,
  seccion: Seccion | Seccion[],
): boolean {
  const lista = Array.isArray(seccion) ? seccion : [seccion];
  return lista.some((s) => tienePermiso(rol, PERMISOS[s]));
}

/** Numeros que pide cada seccion (para el mensaje de "sin acceso"). */
export function numerosDe(seccion: Seccion | Seccion[]): string {
  const lista = Array.isArray(seccion) ? seccion : [seccion];
  return [...new Set(lista.map((s) => PERMISOS[s]))].join(", ");
}

/** ¿Todos los numeros oficiales (o all/admin)? Para pintar "Acceso total". */
export function esAccesoCompleto(rol: unknown): boolean {
  if (esAccesoTotal(rol)) return true;
  const ns = normalizaPermisos(rol);
  return ns.length > 0 && Object.keys(NOMBRES_PERMISO).every((n) => ns.includes(n));
}

/**
 * Texto legible de los permisos de un usuario ("2,5" -> "Pedidos, Catálogo").
 * Ojo: aqui un valor vacio NO es acceso total: es "sin permisos registrados"
 * (el acceso total solo lo decide el `rol` de la sesion, ver esAccesoTotal).
 */
export function nombresDeRol(rol: unknown): string {
  const ns = normalizaPermisos(rol);
  if (!ns.length) {
    const r = rol === null || rol === undefined ? "" : String(rol).trim().toLowerCase();
    return r === "all" || r === "admin" ? "Acceso total" : "—";
  }
  if (esAccesoCompleto(rol)) return "Acceso total";
  return ns.map((n) => NOMBRES_PERMISO[n] ?? `Permiso ${n}`).join(", ");
}
