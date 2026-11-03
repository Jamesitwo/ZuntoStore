// Crear en LucidSales un producto que viene de Dropi (desde el Creador IA),
// igual que lo hace el panel oficial: addproducto (nombre, valor y la primera
// variante) y luego updateproducto con la ficha completa.
import { auth, productos } from "../api/endpoints";
import { armarCuerpoProducto } from "./productos";

/** Pais de la tienda (47 = Colombia si no se sabe). */
export async function paisTienda(idEmpresa: number): Promise<number> {
  try {
    const r: any = await auth.shopNames([idEmpresa]);
    const arr = Array.isArray(r?.shopName) ? r.shopName : [];
    const fila = arr.find((s: any) => String(s?.id) === String(idEmpresa)) ?? arr[0] ?? null;
    const v = Number(fila?.selCountryId ?? fila?.Pais ?? fila?.pais ?? fila?.country);
    return Number.isFinite(v) && v > 0 ? v : 47;
  } catch {
    return 47;
  }
}

export function sku12(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

const fallo = (r: any, porDefecto: string) => {
  if (r?.ok === false || r?.error) throw new Error(r?.msg || (typeof r?.error === "string" ? r.error : porDefecto));
};

export interface DatosProductoNuevo {
  idEmpresa: number;
  nombre: string;
  precio: number;
  descripcion?: string;
  contenido?: string;
  caracteristicas?: string;
  modoUso?: string;
  imagenes?: string[];
  idDropi?: string | null;
  precioProveedor?: number | null;
  precioSugerido?: number | null;
}

/** Crea el producto y devuelve su id en LucidSales. */
export async function crearProductoLucid(d: DatosProductoNuevo): Promise<string> {
  const nombre = d.nombre.trim();
  if (!nombre) throw new Error("Falta el nombre del producto");
  if (!(d.precio > 0)) throw new Error("Falta el precio de venta");
  const imagenes = (d.imagenes ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 10);
  const pais = await paisTienda(d.idEmpresa);
  const r: any = await productos.add({
    nombre,
    valor: String(Math.round(d.precio)),
    pais,
    sku: "",
    bundle: [
      {
        cant: 1,
        default: true,
        hide: false,
        name: "1 Unidad",
        precio: String(Math.round(d.precio)),
        resaltar: false,
        sku: sku12(),
        texto: "",
        imagenes,
      },
    ],
  });
  fallo(r, "LucidSales no creó el producto");
  const id = r?.insertID ?? r?.insertId ?? r?.id;
  if (!id) throw new Error("LucidSales creó el producto pero no devolvió su id: búscalo en Productos");

  // segundo paso: la ficha (descripcion, contenido, fotos, link de Dropi)
  try {
    await guardarFichaLucid(id, {
      Descripcion: d.descripcion ?? "",
      ContenidoPaquete: d.contenido ?? "",
      CaracteristicasTecnicas: d.caracteristicas,
      ModoDeUso: d.modoUso,
      imagenes: imagenes.map((image, i) => ({ image, star: i === 0 })),
      idProductoDropi: Number(d.idDropi) || 0,
      nameProductoDropi: d.idDropi ? nombre : "",
      precioBodega: d.precioProveedor ? String(d.precioProveedor) : undefined,
      precioSugerido: d.precioSugerido ? String(d.precioSugerido) : undefined,
    });
  } catch (e) {
    throw new Error(
      `El producto quedó creado en LucidSales (id ${id}) pero no se pudo guardar su ficha: ${e instanceof Error ? e.message : String(e)}. Complétala en Productos.`,
    );
  }
  return String(id);
}

/** Actualiza campos de la ficha de un producto existente (el resto queda igual). */
export async function guardarFichaLucid(id: string | number, cambios: Record<string, unknown>) {
  const g: any = await productos.get(id);
  fallo(g, "No se pudo leer el producto en LucidSales");
  const ficha = g?.product ?? g?.producto ?? g?.data ?? g;
  const edicion: Record<string, unknown> = { idProducto: id };
  for (const [k, v] of Object.entries(cambios)) if (v !== undefined) edicion[k] = v;
  const r: any = await productos.update(armarCuerpoProducto(ficha, edicion));
  fallo(r, "LucidSales no guardó la ficha");
}
