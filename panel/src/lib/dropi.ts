// Importar productos de Dropi a LucidSales.
//
// Endpoints del flujo oficial (bundle principal):
//   POST /productos/listProducts/dropi
//     -> {catalogo_de_productos:[...], importedDropiIds:["9003", ...]}
//   POST /productos/import-external-products {products:[...], platform:"dropi"}
//     -> {ok, msg}
//
// Aqui esta la logica del panel oficial (normalizador `At1` + constructor del
// payload) traducida a nuestro codigo: mismas claves, mismo orden de trabajo.
// Lo unico que cambia es el generador de sku (aleatorio de 12 caracteres,
// como en "Crear producto").

/** sku aleatorio (el oficial usa nanoid con alfabeto distinto; misma idea). */
export function skuAleatorio(n = 12): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/** Item normalizado del catalogo Dropi (lo que pinta el modal). */
export interface ItemDropi {
  id: string;
  productId: string;
  name: string;
  price: number;
  thumbnail: string;
  images?: string[];
  description: string;
  variantTitle: string;
  productTitle: string;
  optionValues?: string[];
  sku?: string;
  /** variantes del producto (solo en el padre) */
  variants?: ItemDropi[];
}

function urlDe(v: unknown): string {
  if (!v) return "";
  return typeof v === "string" ? v : String((v as any)?.url ?? "");
}

/**
 * `catalogo_de_productos` -> lista para el modal (clon de `At1`):
 * producto con variantes -> padre con `variants[]`; SIMPLE -> item suelto con
 * `variantTitle: "Default Title"`.
 */
export function normalizarDropi(respuesta: any): ItemDropi[] {
  const out: ItemDropi[] = [];
  const lista = Array.isArray(respuesta?.catalogo_de_productos)
    ? respuesta.catalogo_de_productos
    : [];

  for (const a of lista) {
    const thumb = a.image ? urlDe(a.image) : urlDe(Array.isArray(a.images) ? a.images[0] : "");
    const images: string[] = [];
    if (Array.isArray(a.images)) {
      for (const x of a.images) {
        const u = urlDe(x);
        if (u) images.push(u);
      }
    } else if (thumb) {
      images.push(thumb);
    }
    const price =
      a.sale_price !== undefined && a.sale_price !== null
        ? Number(a.sale_price)
        : Number(a.price || 0);
    const descripcion = a.description || "";

    if (Array.isArray(a.variations) && a.variations.length > 0 && a.type !== "SIMPLE") {
      const variants: ItemDropi[] = a.variations.map((u: any) => {
        const vals: string[] = Array.isArray(u?.attribute_values)
          ? u.attribute_values.map((m: any) => m?.value)
          : [];
        const nombre = vals.join(" / ") || `Variante ${u.id}`;
        return {
          id: String(u.id),
          productId: String(a.id),
          name: nombre,
          thumbnail: thumb,
          price: Number(u.price ?? price),
          sku: u?.sku || undefined,
          variantTitle: nombre,
          productTitle: a.name,
          optionValues: vals,
          description: descripcion,
        };
      });
      out.push({
        id: String(a.id),
        productId: String(a.id),
        name: a.name,
        thumbnail: thumb,
        price,
        images,
        description: descripcion,
        variantTitle: "",
        productTitle: a.name,
        variants,
      });
    } else {
      out.push({
        id: String(a.id),
        productId: String(a.id),
        name: a.name,
        thumbnail: thumb,
        price,
        images,
        description: descripcion,
        variantTitle: "Default Title",
        productTitle: a.name,
        optionValues: [],
      });
    }
  }
  return out;
}

/**
 * Payload de `import-external-products` para `platform:"dropi"`, identico al
 * oficial: agrupa los items elegidos por producto, monta
 * `variantes` (opciones), `mixedvariantes` (una fila por variante),
 * `bundle`/`bundleVariantes` con una variante "1 Unidad" y las imágenes.
 */
export function armarImportacionDropi(crudos: any[], seleccionados: ItemDropi[]): any[] {
  const porProducto = new Map<string, ItemDropi[]>();
  for (const it of seleccionados) {
    const k = it.productId;
    if (!porProducto.has(k)) porProducto.set(k, []);
    porProducto.get(k)!.push(it);
  }

  const products: any[] = [];
  for (const [pid, items] of porProducto) {
    const E1 = crudos.find((e) => String(e?.id) === pid);
    if (!E1) continue;

    // una fila de mixedvariantes por item elegido
    const mixedvariantes = items.map((it) => {
      let valores: string[] = [];
      if (Array.isArray(it.optionValues) && it.optionValues.length) valores = it.optionValues;
      else if (it.variantTitle === "Default Title") valores = [];
      else valores = String(it.variantTitle).split(" / ");
      return {
        items: valores,
        precioBodega: 0,
        precioSugerido: it.price,
        sku: String(it.id),
        realSku: it.sku || "",
      };
    });

    // nombres de los atributos (del primer producto con variationes)
    const nombresAtributo: string[] = [];
    if (Array.isArray(E1.variations) && E1.variations.length > 0) {
      const v0 = E1.variations[0];
      if (Array.isArray(v0?.attribute_values)) {
        v0.attribute_values.forEach((av: any, i: number) =>
          nombresAtributo.push(av?.attribute?.name || av?.attribute_name || `Opción ${i + 1}`),
        );
      }
    }

    const agrupado: Record<string, Set<string>> = {};
    for (const mv of mixedvariantes) {
      mv.items.forEach((valor, i) => {
        const nombre = nombresAtributo[i] || `Opción ${i + 1}`;
        if (!agrupado[nombre]) agrupado[nombre] = new Set();
        agrupado[nombre].add(valor);
      });
    }
    const variantes = Object.keys(agrupado).map((nombre) => ({
      sku: skuAleatorio(10),
      nombre,
      opciones: Array.from(agrupado[nombre]).map((v) => ({
        sku: skuAleatorio(10),
        nombre: v,
        archivo: "",
      })),
    }));

    const precio = items[0]?.price || 0;
    const skuBundle = skuAleatorio(12);
    const bundle = [
      {
        cant: 1,
        default: true,
        hide: false,
        index: 0,
        name: "1 Unidad",
        precio: String(precio),
        resaltar: false,
        sku: skuBundle,
        texto: "",
        imagenes: [],
      },
    ];
    const bundleVariantes = [
      {
        sku: skuBundle,
        name: "1 Unidad",
        variantes: mixedvariantes.map((mv) => ({
          ...mv,
          precioBodega: 0,
          precioSugerido: mv.precioSugerido,
          idVarianteDropi: mv.sku,
          imagenes: [],
        })),
      },
    ];

    let images: Array<{ image: string; star: boolean }> = [];
    if (Array.isArray(E1.images)) {
      images = E1.images
        .map((im: any, i: number) => ({ image: urlDe(im), star: i === 0 }))
        .filter((x: { image: string }) => x.image);
    } else if (E1.image) {
      const u = urlDe(E1.image);
      if (u) images = [{ image: u, star: true }];
    }

    products.push({
      id: E1.id,
      title: E1.name,
      description: E1.description || "",
      body_html: E1.description || "",
      videos: [],
      variantes,
      mixedvariantes,
      bundle,
      bundleVariantes,
      optCombVariantes: variantes.length > 0 ? 1 : 0,
      disponibilidadProductoLucidBot: 1,
      images,
    });
  }
  return products;
}
