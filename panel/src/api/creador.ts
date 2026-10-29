// Creador de campañas IA (server/creadorCampanas.js): producto -> plan de la
// IA -> creativos en TopView -> campaña de Meta a WhatsApp (pausada).
import { backend } from "./backend";

export type EstadoCreativo = "borrador" | "generando" | "listo" | "fallo";

export interface Creativo {
  id: string;
  tipo: "imagen" | "video";
  angulo: string;
  /** estilo visual o formato que eligio la IA */
  estilo?: string;
  /** por que funciona para este producto */
  porque?: string;
  prompt: string;
  copy: { texto: string; titulo: string; descripcion: string };
  incluir: boolean;
  estado: EstadoCreativo;
  error?: string;
  tarea?: { tipo: string; taskId: string; desde: string };
  resultado?: { url: string; portada?: string | null; creditos?: number | null; listo?: string };
}

export type Creatividad = "segura" | "equilibrada" | "atrevida";

export const CREATIVIDADES: Array<{ id: Creatividad; nombre: string; ayuda: string }> = [
  { id: "segura", nombre: "Segura", ayuda: "Formatos probados de e-commerce, con variedad de escenas" },
  { id: "equilibrada", nombre: "Equilibrada", ayuda: "Mezcla lo que funciona con ideas frescas" },
  { id: "atrevida", nombre: "Atrevida", ayuda: "Conceptos poco vistos y ganchos audaces" },
];

export interface PasoCampana {
  texto: string;
  ok: boolean;
  en: string;
}

export interface Proyecto {
  id: string;
  estado: "nuevo" | "plan" | "creativos" | "campana";
  creado: string;
  actualizado: string;
  producto: { id: string | null; nombre: string; precio: number; descripcion: string; contenido: string; variantes: string };
  fotos: string[];
  conPersonaje: boolean;
  cantidades: { imagenes: number; videos: number };
  notas: string;
  creatividad?: Creatividad;
  /** la gran idea de la campaña */
  concepto?: string;
  presupuesto: number;
  meta: { cuentaId: string; paginaId: string };
  creativos: Creativo[];
  ficha?: { descripcion: string; modoUso: string; caracteristicas: string; contenido: string };
  bienvenida?: string;
  mensajePredefinido?: string;
  faltan?: string[];
  planeando?: string;
  /** IA que escribio el plan */
  ia?: string;
  errorPlan?: string;
  ocupado?: boolean;
  campana: null | {
    estado: "creando" | "creada" | "activa" | "error";
    pasos: PasoCampana[];
    error?: string;
    enlace?: string;
    cuenta?: { id: string; nombre: string; moneda: string };
    revision?: { nombre: string; estado: string; presupuestoDiario: number | null; problemas: string[] } | null;
    ids?: { campana?: string; conjunto?: string };
  };
}

export interface ResumenProyecto {
  id: string;
  producto: string;
  estado: Proyecto["estado"];
  creado: string;
  actualizado: string;
  portada: string | null;
  creativos: number;
  listos: number;
  campana: string | null;
}

export interface AjustesCreador {
  topview: { configurada: boolean; key: string; uid: string };
  cuentaId: string;
  paginaId: string;
  paginaNombre: string;
  presupuesto: number;
  fotoModelo: string;
  marca: string;
  contraEntrega: boolean;
  meta: { conectada: boolean; cuentas: Array<{ id: string; nombre: string; moneda: string; activa: boolean }> };
  costos: { imagen: number; video: number };
  modelos: { imagen: string; video: string };
  ia: {
    proveedor: "claude" | "zunto";
    claude: { configurada: boolean; key: string; modelo: string };
    modelosClaude: Array<{ id: string; nombre: string }>;
    zunto: { configurada: boolean; modelo: string };
  };
}

const P = "/api/creador";

export const creador = {
  ajustes: () => backend<AjustesCreador & { ok: boolean }>(`${P}/ajustes`),
  guardarAjustes: (cambios: Record<string, unknown>) =>
    backend<AjustesCreador & { ok: boolean }>(`${P}/ajustes`, { method: "POST", body: cambios }),
  probarIA: () => backend<{ ok: boolean; msg: string }>(`${P}/probar-ia`, { method: "POST", body: {} }),
  creditos: () => backend<{ ok: boolean; creditos: number | null }>(`${P}/creditos`),
  paginas: () => backend<{ ok: boolean; paginas: Array<{ id: string; nombre: string }> }>(`${P}/paginas`),
  lista: () => backend<{ ok: boolean; proyectos: ResumenProyecto[] }>(`${P}/proyectos`),
  crear: (datos: Record<string, unknown>) =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos`, { method: "POST", body: datos }),
  get: (id: string) => backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}`),
  editar: (id: string, cambios: Record<string, unknown>) =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}`, { method: "POST", body: cambios }),
  planear: (id: string) => backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}/planear`, { method: "POST", body: {} }),
  agregarCreativo: (id: string, tipo: "imagen" | "video") =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}/creativos`, { method: "POST", body: { tipo } }),
  generar: (id: string, ids?: string[]) =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}/generar`, { method: "POST", body: ids ? { ids } : {} }),
  crearCampana: (id: string) =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}/campana`, { method: "POST", body: {} }),
  activar: (id: string, pausar = false) =>
    backend<{ ok: boolean; proyecto: Proyecto }>(`${P}/proyectos/${id}/activar`, { method: "POST", body: { pausar } }),
  borrar: (id: string) => backend<{ ok: boolean }>(`${P}/proyectos/${id}`, { method: "DELETE" }),
};

export const pesos = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO").replace(/,/g, ".")}`;
