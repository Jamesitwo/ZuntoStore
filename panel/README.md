# ZuntoStore · Panel (front-end para la API LucidSales)

Interfaz propia (React + Vite + TypeScript) sobre la API de LucidSales
documentada en `../lucidsales_api_doc.md`.

- **Robustez / pantalla en blanco**:
  - `ErrorBoundary` en `main.tsx`: si algo revienta al renderizar, se muestra
    una tarjeta con el error real y botones *Recargar* / *Reintentar* en vez
    de una pagina en blanco.
  - Los endpoints **auxiliares** (`POST /auth/getshopname` y
    `POST /business/bot`, los dos nuevos que usan la seccion de Pedidos) van
    con `ignoreAuth: true`: si responden 401 **no** se borra la sesion; solo
    se omite el nombre de la tienda / el enlace al inbox del bot.
  - Si la sesion cae de verdad (401 en datos), el login ahora muestra el
    aviso *"Tu sesion expiro…"* en vez de dejarlo sin explicacion.
  - Respuestas de la API fuera de formato (`pedidos` que no es arreglo,
    `totalRecords` raro) y `idEmpresa` recibido como texto `"1,2,3"` quedan
    normalizados: no rompen el render.

Panel de administracion construido sobre la API documentada en
`../lucidsales_api_doc.md`: pedidos (listado, detalle, edicion, creacion),
productos, clientes/integraciones, cotizador de envios y ajustes.

## Requisitos

- Node.js 18+ (probado con Node 24)

## Arrancar

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>, inicia sesion con tu correo/contraseña y elige la
tienda (paso `addShopId`, obligatorio). **No hay credenciales guardadas en el
código**: cada usuario entra con las suyas.

## Build de produccion

```bash
npm run build      # genera dist/
npm run preview    # sirve dist/ con proxy incluido
```

## Proxy / CORS

En desarrollo, Vite hace de proxy: las llamadas a `/b/...` se reenvian a
`https://panel.lucidsales.co/b/...`, evitando CORS. Para produccion hay dos
opciones:

1. Servir `dist/` detras de un reverse proxy (nginx/Caddy) que haga lo mismo
   con la ruta `/b`.
2. Definir `VITE_API_BASE=https://panel.lucidsales.co/b` en `.env` (solo si la
   API permite CORS desde tu dominio).

Ver `.env.example`.

## Backend propio (cambio de estado)

El cambio de estado (desplegable de la lista y **Confirmar / Cancelar** del
detalle) viaja por **nuestro backend** `../server/`: el, valida, busca el
pedido y hace el `POST /pedidos/update` con credenciales de servidor y deja
el cambio en `server/historial.jsonl`.

```bash
# terminal 1 (tambien desde aqui: npm run api)
cd ../server
cp .env.example .env     # API_KEY, LUCID_EMAIL, LUCID_PASSWORD, LUCID_TIENDA
npm start                # http://localhost:8787

# terminal 2
npm run dev
```

- Vite hace de proxy: `/api` -> `http://localhost:8787` (ver `vite.config.ts`).
- `VITE_API_KEY` en `panel/.env` debe ser el **mismo valor** que `API_KEY` en
  `server/.env` (ver `.env.example`).
- **Si el backend no esta levantado el panel no se queda sin nada**: reintenta
  por la API directa (`get-pedido-by-id` + `update`) y el toast anota
  `· API directa`. Los errores reales (estado invalido, API key) si se muestran.
- Endpoints, errores y flujo interno: `../lucidsales_api_doc.md` seccion 16 y
  `../server/README.md`.
- El mismo backend expone `GET /api/interrapidisimo/oficina` y
  `GET /api/interrapidisimo/oficinas` (oficina principal y **listado** de
  oficinas por municipio) que **no exigen `x-api-key`**: la tarjeta *Oficina
  Inter Rapidísimo* funciona aunque `VITE_API_KEY` no este configurado, mientras
  el backend este levantado.

## Experiencia de usuario

Pensado para quien no conoce la API:

- **Inicio (dashboard)** con los numeros clave: total de pedidos y conteo por
  estado (consultado con `itemsPerPage=1`, solo se lee `totalRecords`), ultimos
  pedidos y accesos rápidos.
- **Métricas (nueva sección, rol `4`)**: la ruta **`/metricas`** replica la
  pantalla oficial `metricas-lucidsales` usando su **único endpoint**
  (`GET /analitica/get-analytics-data`, ver doc §17): tarjetas **Ventas
  totales · Pedidos totales · Utilidad · Tasa de entrega** con su % de
  variación respecto del periodo anterior, gráfica de la serie **actual vs.
  periodo anterior** con pestañas *Ventas* / *Pedidos*, **Confirmación de
  pedidos**, **Estado de pedidos** y **Estados de las guías** (dona con los 4
  grupos que arma el oficial). Filtros: rango (Hoy, Ayer, últimos 7/30 días,
  mes actual/anterior o fechas a mano), **producto**, **fuente** y **proveedor
  dropshipping**. Las fechas se mandan igual que el oficial (día recortado en
  hora local + periodo de comparación anterior), la gráfica es **SVG propio**
  (sin librería) y sin el permiso `4` la ruta no hace ninguna llamada.
- **Ventas LucidBot (campañas de Meta)**: la segunda pestaña de Métricas usa
  la otra pantalla oficial (ruta `metricas`) con
  `GET /meta/metrics/1?…&startDate=AAAA-MM-DD` y repite lo que pinta ella:
  los destacados **Total Inversión** (rojo) y **Ventas** (verde) y los **10
  KPI** (Impresiones, Alcance, CTR, CPM, Click, # Mensajes, % Cierre, Costo
  por venta, Costo mensaje, ROAS —calculados como el oficial: sumas y
  promedios por columna—), con buscador (manda `search`), detalle de fila en
  un modal, **Descargar Reporte** en CSV y **🔄 Sincronizar Insights**
  (deshabilitado mientras no toque, límite de 3 h). Además:
  - **Vista «Por campaña»** (la que se abre): agrupa las filas por campaña
    estilo **Ads Manager** —Campaña · Inversión · Impresiones · Alcance ·
    Clics · CTR · CPM · Mensajes · Ventas · Total Ventas · Costo por Venta ·
    ROAS— con **cabeceras ordenables**, de mayor a menor inversión, y
    **pulsar una campaña** lleva a su detalle (chip con × para quitarlo).
    La orgánica aparece como *Orgánico*.
  - **Vista «Detalle (anuncio)»**: la tabla de las **12 columnas** del
    oficial, con orden por defecto `costPerSale` ↑.
  - **COP por 1 USD**: la inversión de Meta viene en la moneda de la cuenta
    publicitaria (p. ej. USD) y las ventas en COP; ese campo convierte
    Inversión, CPM, Costo por venta y ROAS a COP (se guarda en el navegador).
    Sin él se ven los valores crudos, como en el oficial.
  - Los campos de Meta (`spend`, `clicks`…) salen «—» **hasta que hay una
    sincronización**; verificado en vivo: tras `insights/sync` se rellenaron
    107 de 142 filas (357,05 de inversión, 5.708 clics, 196.908 impresiones).
- **Anuncios (rentabilidad de Meta, sección `rentabilidad` = permiso `4`)**:
  la ruta **`/anuncios`** (`pages/AnunciosPage.tsx` +
  `components/anuncios/`) cruza las campañas de **Pizdo** y **Orenar** con
  la ganancia promedio de cada producto: `margen = compras (omni_purchase) ×
  ganancia`, `neto = margen − gasto`, `ROI = margen / gasto`, `CPA`. Seis
  pestañas: **Resumen** (KPIs, dona de clasificación y barras de pérdidas,
  gasto, campañas que gastan sin comprar y recién arrancadas), **Alertas**
  (pérdida / por vigilar / sin dato con la acción sugerida y casilla
  *Hecho*, pero **solo para campañas que se pueden juzgar**: encendidas
  —`alerta`— y con al menos `minDiasAlerta` (3) días de datos; el pie avisa
  cuántas quedaron fuera por estar pausadas o por ser demasiado nuevas),
  **Campañas** (buscador, filtro por cuenta, chips por
  clasificación y cabeceras ordenables), **Productos** (ganancia promedio
  editable en la propia tabla), **Cuentas** y **Reporte** (el que sale con
  **PDF**, con `@media print`). Además: selector **7 / 15 / 30 días**,
  **⟳ Actualizar** (salta el cache diario), **CSV** (campañas / alertas /
  productos) y cálculo en vivo — al guardar una ganancia se recalcula todo
  sin volver a consultar Meta. Todo va al backend propio `/api/anuncios`
  con `x-api-key` (`api/anuncios.ts` sobre `api/backend.ts`).
  **Cada usuario conecta su propia cuenta de Meta**: el botón **🔌 Cuenta**
  abre `components/anuncios/ConectarCuenta.tsx` (pegar token → se valida con
  `/me`, lista sus cuentas → marcar cuáles entran + TRM → guardar, con aviso
  de vencimiento y *Desconectar*). El backend resuelve el espacio por
  `x-usuario` (`GET /api/anuncios/cuenta`): `propia`, `compartida` (Pizdo +
  Orenar, con banner) o `ninguna` (pantalla de conexión). Productos, plan y
  caches viven separados por usuario en `server/anuncios/usuarios/<email>/`.
  En **Productos** también está el **traedor de ganancias**: el botón
  *«Traer ganancias de pedidos»* pide a LucidSales la ganancia **neta real**
  de cada pedido (el campo `gananciaEsperada`, que ya viene con envío y costo
  del proveedor descontados) y la promedia por producto **solo entre los que
  traen ganancia** (Dropi calcula el flete y el costo al entregar, así que la
  muestra por defecto son los «ENTREGADO»), con
  progreso (`Calculando… 6/73`) y estado *«Último cálculo · 50 productos con
  promedio · $6.396 por pedido»*; el checkbox **Automático al actualizar** lo
  corre solo una vez al día. Debajo, el selector **«¿Qué estados cuentan
  para el promedio?»** lista todos los estados vistos en la ventana con su
  cantidad de pedidos y una casilla cada uno (marcado = cuenta en la muestra):
  tocar una casilla guarda `incluirEstados` y **recalcula al instante** (solo
  «ENTREGADO» viene marcado por defecto; no se puede apagar el último que
  queda marcado). Columna **Promedio pedidos**
  (`pedidosProm` / `pedidosN` / `pedidosNTotal`, con «n=130 (de 670)» y
  *muestra baja* si no alcanza el mínimo) y
  botón **Usar** para adoptarlo como ganancia manual — nunca pisa el valor
  escrito a mano (solo rellena los que están en 0, con ≥ 20 pedidos con
  ganancia; lo que salga de ahí se marca con la etiqueta *de pedidos*).
- **Pedidos**: busqueda instantanea (350 ms, sin pulsar Buscar), **columna
  Producto** (el campo `producto` que ya trae la respuesta de la lista, con
  el texto completo en el tooltip), cambio de
  estado desde la tabla (pide confirmacion y motivo si es cancelacion), telefono
  con `tel:`/WhatsApp, fechas legibles ("hace 2 dias") y filtros de columna.
- **Paginación de la lista**: **«← Anterior / Siguiente →»** con *«Página X
  de Y · N registros»*. El número de páginas sale de `numPages` de la API o se
  calcula con `totalRecords ÷ por página` (el mayor de los dos), y si no viene
  ninguno de los dos pero la página vino **llena** deja avanzar una más: así el
  botón no se queda pinchado por una respuesta sin contadores.
- **Asignación de pedidos**: la lista de Pedidos tiene la columna **Asignado**
  (con la × para quitarlo) y el botón **«Asignar pedidos»**, que reparte los
  pedidos de esa página **equitativamente** —cada uno va al usuario con menos
  asignaciones, contando las que ya tiene— entre los usuarios que marques, en
  modo *Entre todos* o *Solo los que están en horario ahora*. Todo se guarda en
  el backend propio (`POST /api/asignacion/repartir`); si el backend no está
  arrancado la lista sigue funcionando y solo se avisa bajo la cabecera.
- **Asignación individual**: cada fila de la columna **Asignado** tiene su
  propio botón: **Asignar** (si no tiene dueño) o **Cambiar** (para pasarlo a
  otro usuario) y la **×** lo deja sin asignar. El modal muestra los usuarios
  con su carga actual, buscador y el actual marcado como *· actual*; va al
  mismo endpoint pero en **modo `manual`**, que respeta tu elección aunque el
  usuario esté fuera de turno o con el horario pausado (el reparto automático
  sí los respeta).
- **Filtrar por asignación**: el toolbar de Pedidos tiene el desplegable
  **Asignación** con *Todos · Sin asignar · Asignados a mí* y un ítem por cada
  usuario de la tienda. Es un **filtro local** (la API de LucidSales no sabe
  quién tiene cada pedido): recorta los pedidos ya cargados en la página y
  avisa encima con *«Asignación aplicada: N de M pedidos de esta página»*, o
  con un mensaje claro si la página queda vacía. **Limpiar** lo quita junto al
  resto de filtros.
- **Detalle**: secciones claras, **navegacion `‹ Anterior` / `Siguiente ›`
  entre pedidos** (usa la lista que tenias en pantalla o los 200 mas
  recientes), **selector de productos con búsqueda** (escribes y filtra el
  catálogo de LucidSales por nombre o por id, con **miniatura** y precio; la
  imagen del elegido queda junto al campo y rellena el precio de la línea),
  **cotizador integrado** (seccion
  "Cotizador de envios" que cotiza ese mismo pedido), historial como linea de
  tiempo, enlaces de llamar/WhatsApp, aviso persistente de "cambios sin
  guardar" (con Descartar/Guardar y confirmacion al salir) y bloqueo de la
  pestana si se cierra con cambios pendientes.
- **Escribir para buscar: departamento, ciudad y producto**: en el detalle y al
  crear un pedido, **Departamento / Estado**, **Ciudad / Municipio** y el
  **selector de producto** son comboboxes buscables: escribes y la lista se
  filtra por nombre o por id, sin distinguir
  tildes ni mayúsculas (`medellin` → *Medellín*, `p-200` → *P-200*), con teclado (flechas,
  `Enter` para elegir, `Escape` para cerrar), contador de coincidencias, hasta
  60 filas visibles, fila resaltada y botón **×** para quitar la selección.
  En producto la fila muestra el **precio** a la derecha y una **miniatura del
  producto** (con la imagen del producto elegido junto al campo), la lista se
  posiciona **fija en el viewport**, porque dentro de la tabla de líneas (que tiene
  scroll horizontal) un desplegable normal quedaría recortado. Si una imagen no
  carga se oculta sola (`prodImg()` entiende `imagenes[].image`, `image.url` y
  nombres de archivo sueltos). Mejora sobre el
  `<select>` del panel oficial, que con +1.000 municipios
  obliga a buscar a ojo. Mientras no haya país/departamento el campo lo indica
  deshabilitado y, si un catálogo no carga, se puede escribir el id a mano.
  Componente: `src/components/Combo.tsx`; lo usa
  `src/components/LocationPicker.tsx` y las páginas de pedido.
- **Stock real de Dropi en el pedido**: el campo `stock` de LucidSales **no**
  es el de verdad (un producto real lo traía en `0` mientras Dropi marcaba
  `948`), así que en la línea de producto de **crear pedido** y del
  **detalle** aparece el chip **«Stock Dropi: 948»** (verde con stock, rojo si
  está en 0 y *«Sin Dropi»* si no está vinculado). Se resuelve con
  `idProductoDropi` → `validateDropiId/{id}` y queda **cacheado por producto**
  (una sola llamada aunque se repita el producto en varias líneas o páginas).
- **Otros pedidos del cliente**: el detalle de un pedido abre la tarjeta
  **«Otros pedidos de <cliente>»** con los demás pedidos de esa persona:
  número (enlace), fecha, teléfono, estado, **envío** (columna nueva con
  `EnvioBadge` de `EstadoFullfilment`: Creado, ENVIADO, ENTREGADO…) y total,
  botón **Abrir →** y
  **«Ver todos →»** que lleva a `/pedidos?cliente=<nombre>&tel=<tel>`. Como la
  API solo sabe buscar por nombre (`filter customer`), los resultados se
  **cotejan por teléfono** (se descartan los homónimos) y se quita el pedido
  que estás viendo.
- **Del pedido al producto**: cada línea de producto lleva el enlace
  **«→ Ver producto»** a `/productos?editar=<id>`, que abre la ficha del
  producto directamente en Productos (y limpia la URL para que un refresque no
  la reabra). Vale también en *Nuevo pedido*.
- **Subir a Dropi con transportadora**: en el detalle, dentro de *Cotizador de
  envíos (este pedido)* con el transportador **dropi**, el botón **Cotizar este
  pedido** trae las cotizaciones (preselecciona la sugerida de la API o, si no
  hay, la más barata) y **Subir pedido a Dropi** manda
  `POST /pedidos/upload/dropi {id, transportadora_id}`. Antes de subirlo guarda
  los cambios del pedido si los hay (igual que el oficial), y al confirmarlo
  marca el pedido como **Creado**. Si el pedido ya está en Dropi, se muestra su
  id y no se ofrece subirlo de nuevo.
- **Estado de envío**: columna **Envío** en la lista y fila **"Estado de
  envío"** + **"Transportadora"** en la tarjeta *Estado y pago* del detalle.
  Sale de `EstadoFullfilment` (grafía real del API, campo de solo lectura: no
  hay endpoint para cambiarlo). Badge igual que el panel oficial: gris =
  `Sin Envio`/`CANCELADO`, violeta = en curso (`Creado`, ENVIADO…), verde =
  `ENTREGADO`, rojo = `DEVOLUCION`; vacío = `—`. El filtro "Estado envío" de
  la lista usa `fulfillmentStatus` con los valores de
  `filtersData.fulfillmentStatuses`.
- **Envío y guías**: tarjeta del detalle (debajo de *Cliente*/*Estado y pago*)
  con la sección **“Envío”** del panel oficial: **Proveedor de guías**, **Fecha
  de creación** y **de actualización**, **ID de pedido** (`idPedidoDropi` o, si
  es `"0"`, `idPedidoExterno`), **Estado de envío**, **Transportadora**, **ID
  Guia Transportadora**, **Costo de flete**, **Ganancia esperada** y, si hubo
  devolución, **Valor** y **Fecha de devolución**. Todo viene en
  `get-pedido-by-id` y es de **solo lectura**: cada campo solo se pinta si trae
  valor (vacío o `"0"` no aparece), las cifras salen en plata y las fechas en
  formato legible; si el pedido no tiene guía, una línea lo explica. Campos y
  ejemplo real en `../lucidsales_api_doc.md` §2.4.
- **Clientes**: lista paginada con buscador (misma variante paginada que el
  panel oficial: `?page=&itemsPerPage=&search=`) y columnas Cliente, Correo,
  Teléfono (enlace `tel:` y WhatsApp), Dirección y **Pedidos**. LucidSales no
  guarda el número de pedidos y su filtro `customer` es de texto sobre el
  **nombre**, así que con dos homónimos el recuento se dispara (cliente con 87
  pedidos "por compartir nombre"). Por eso se **baja el listado de pedidos una
  vez por tienda** (páginas de 500, fecha descendente, 4 en paralelo, caché en
  memoria y botón *Recalcular pedidos*) y se cuenta **por teléfono** (`Movil`
  del pedido contra `TelCliente`, últimos 10 dígitos): número exacto en badge
  verde. Sin teléfono (o tiendas con menos del 20 % de teléfonos) se cuenta por
  nombre con la marca **`≈`** en gris, nunca como exacto; si no se puede leer
  el listado, `—` (nunca un número inventado). **El número es un enlace** a
  `/pedidos?cliente=<nombre>` — con `&tel=<10 dígitos>` cuando el recuento es
  por teléfono, en cuyo caso la lista se recorta a ese número en el navegador
  (la API no filtra por teléfono y el filtro por nombre traería también a la
  otra persona). Detalle del endpoint: `../lucidsales_api_doc.md` §4.1.
- **Oficina Inter Rapidísimo**: tarjeta del detalle justo debajo de
  *Cliente*/*Estado y pago* que **no consulta nada hasta que se pulsa
  “Buscar oficinas de Inter”** (no hace falta en todos los pedidos). Al
  pulsarlo pide `GET /api/interrapidisimo/oficinas` de nuestro backend y lista
  **todas** las oficinas del municipio: dirección con **“Ver en el mapa”**,
  barrio, teléfonos (fijos y 01800 formateados aparte), **Hoy hh:mm–hh:mm**,
  desplegable de horarios de la semana, distancia y recuento (con filtro de
  texto si hay más de 6). Al pulsar **Usar esta dirección** de una fila, el
  campo `Direccion` del pedido queda como
  **`Oficina Interrapidisimo - <dirección de la oficina>`** (cambio pendiente de
  guardar) y sale un toast; la fila se resalta con *Dirección en el pedido*.
  El backend tarda (el `POST` de Inter mide 13-25 s) y responde con
  `pendiente: "listado"`: la tarjeta lo indica y **vuelve a consultar sola**
  con backoff de 4/6/9/13/18/25/35 s; si Inter contesta vacío o algo falla
  muestra el aviso con un botón *Reintentar* (botones de pie: **Actualizar** y
  **Ocultar**). Se oculta cuando el pedido no tiene departamento o
  `Pais ≠ 47`. Detalle: `../interrapidisimo_api_doc.md` §7.
- **Chat del bot (inbox)**: en el detalle del pedido, bajo *Movil*, aparece
  **💬 Chat del bot** que abre `panel.lucidbot.co/en/inbox?acc={botId}&id={tel}`.
  Ese link no lo da la API: se arma igual que el panel oficial, con `botId` de
  `POST /business/bot` + el telefono del pedido (ver §6 de la documentacion).
  En la lista de pedidos hay un boton 💬 por fila.
- **Nombres de tienda**: el id de la tienda activa se muestra con su nombre
  real vía `POST /auth/getshopname` (selector del topbar, subtítulos de todas
  las páginas y el paso de elección de tienda del login); si no hay nombre
  disponible se mantiene `Tienda #id`. El mapa se cachea por sesión.
- **Productos: crear y editar**: la pestaña **Productos** lista los de
  **LucidSales** con la lista paginada del oficial
  (`GET /productos/getProductos?page&itemsPerPage&search&filters`): imagen,
  nombre, precio, estado, visitas y órdenes, con **buscar**, paginación y las
  acciones **+ Nuevo producto** (`POST /productos/addproducto/`, con el mismo
  cuerpo que el modal oficial: nombre, valor, país y la variante "1 Unidad"),
  **Editar** (carga `GET /productos/getproducto/{id}` y abre **todos los
  campos**: nombre, precios de venta/bodega/sugerido, stock, ciudad, las 5
  descripciones, **13 interruptores** de opciones, píxeles, textos de
  seguimiento post-venta, las integraciones vinculadas y una tabla plegable
  **«Todos los campos (N)»** donde cada columna queda marcada como *se guarda*
  o *no* —estas últimas no las acepta `updateproducto`—, la secuencia de
  **mensaje inicial** (pasos de texto, imágenes, videos, audio o espera, con
  ↑/↓ para ordenar y botones para añadir: si el producto no trae nada se crea
  desde cero, y las urls se ven como **medio** —galería de imágenes, reproductor
  de vídeo o pista de audio—, no como enlace) y guarda con
  `POST /productos/updateproducto` mandando **exactamente las 87 claves**
  que pide el oficial: alias `MensajeInicial` → `mensajeInicial`,
  `activeIntegrations` de string a array y las listas serializadas a JSON)
  y **Eliminar** (confirmación → `POST /productos/deleteproducto {idProducto}`).
  El id de la integración **Dropi** se edita ahí mismo con el botón **Validar
  y vincular** (`GET /productos/validateDropiId/{id}`): si responde ok **guarda
  el enlace en el acto** (`idProductoDropi` + `nameProductoDropi`) y ofrece
  copiar `cod_dane` a la ciudad; si falla, no se guarda nada y se pinta el
  `msg` del servidor. Si la lista
  paginada no responde se respalda con `POST /productos/getproductos` y
  pagina/filtra en cliente (lo avisa en la tarjeta). Shopify y Dropi siguen
  siendo botones de solo lectura.
- **Importar productos de Dropi**: la fuente **Dropi** de Productos lleva el
  botón **⤓ Importar productos de Dropi**, que abre el modal oficial:
  `POST /productos/listProducts/dropi` → lista con imagen, precio, variantes
  (talla/color) y el badge **“Ya importado”** (los de `importedDropiIds` están
  deshabilitados, también en el código, no solo visual), búsqueda por nombre
  o sku —dentro de variantes—, “seleccionar lo visible” y **Importar**, que
  arma el cuerpo exacto del oficial (`variantes`, `mixedvariantes`,
  `bundle`/`bundleVariantes` con “1 Unidad”, `images` con `star`, …) y manda
  `POST /productos/import-external-products {platform:"dropi"}`. Todo el armado
  vive en `src/lib/dropi.ts` y el modal en `src/components/ImportarDropi.tsx`;
  el editor JSON de “Importar productos externos” queda como alternativa.
- **Campañas de Meta del producto**: en Editar hay un desplegable **«Campañas
  de Meta»** que pide `GET /meta/campaigns` **al abrirse** (como el oficial),
  con buscador y las que ya vienen del producto marcadas; el botón **Actualizar
  anuncios** llama a `POST /meta/campaigns/ads/sync` con los valores marcados y
  añade los `adId` nuevos a `AdsMetaTags` (avisando cuántos), que además se
  pueden quitar o escribir **a mano**. Se guarda todo en `updateproducto`
  (`AdsMetaCampaigns` + `AdsMetaTags`, ambas serializadas a JSON).
- **Bundles**: en el mismo modal, la sección **Bundles** edita `bundle`
  (nombre, unidades, precio, Por defecto / Oculto / Resaltar, texto e imágenes)
  con **+ Añadir bundle** y ✕. Como `bundle`/`bundleVariantes` **no** son de
  `updateproducto`, se guardan con **«Guardar bundles»** →
  `POST /productos/updatebundle` (y también solos al pulsar *Guardar cambios*
  si quedaron cambios). El precio sale deshabilitado si el producto tiene
  variantes, igual que el oficial.
- **Variantes, reglas y testimonios**: el mismo modal de Editar edita
  **variantes** (`variantes` = atributos/opciones con sku aleatorio y límite de
  100 combinaciones + `mixedvariantes` = combinación con precio sugerido y de
  bodega; al tocar la estructura apaga «Combinar variantes»), las **reglas**
  (`string[]`), las **preguntas frecuentes** y las de **post-venta**
  (`[{pregunta, respuesta}]`) y los **testimonios**, que se guardan **como
  pasos** —`[{type, content, id}]` con tipos `testimonio_texto/imagenes/
  videos/audios/documento/espera`—: **misma estructura que un mensaje inicial**,
  hasta 20, cada uno en una tarjeta numerada con **selector de tipo**, **↑/↓
  para reordenar** y ✕, con texto escrito o urls con vista previa (imagen /
  vídeo / audio / 📄) y contador «N de 20». Es el componente compartido
  `components/Testimonios.tsx` (el mismo que usa Ajustes → Bot) y
  `parsearTestimonios` **sigue leyendo el formato oficial** `[{image:url}, …]`
  y lo convierte en pasos, así que no se pierde lo que ya había (verificado:
  los 73 productos traen `Testimonios: []`; ⚠ ojo: el **panel oficial** espera
  archivos, si edita allí un producto con pasos los verá vacíos).
- **Etiquetas de pedidos (funcion propia)**: no existen en LucidSales. Se crean
  con nombre y color (paleta de 9) desde el boton **🏷 Etiquetas** de la lista o
  desde la tarjeta **Etiquetas** del detalle; se aplican/quitan con un clic
  (selector por pedido, tambien desde el boton 🏷 de cada fila) y aparecen como
  chips en la lista y en el detalle. Hay **filtro por etiqueta** en la lista
  (es local: se aplica sobre los pedidos cargados en la pagina, porque la API no
  conoce estas etiquetas). Se guardan en `localStorage`
  (`zunto.etiquetas.v1`), separadas por tienda, y el gestor incluye
  **exportar/importar backup JSON** para copiarlas a otro navegador u equipo.
- **Feedback**: avisos flotantes (toasts) y modales propios; no se usan
  `alert`/`confirm`/`prompt` del navegador.
- **Responsive**: en pantallas pequenas se ocultan las columnas secundarias
  (`.hide-sm`) y el sidebar pasa a barra horizontal.
- **Permisos por rol**: se respeta el `rol` de LucidSales igual que el panel
  oficial: el menú solo pinta los módulos permitidos (`2` Pedidos y Cotizador,
  `3` Clientes, `4` Métricas, `5` Productos, `7`/`8` Ajustes) y una ruta sin
  permiso muestra
  un aviso con el número que falta en vez de cargar la página (sin hacer
  llamadas). Inicio no pide permiso y un rol vacío/`all` cuenta como acceso
  total.
- **Lista de usuarios**: la pestaña **Usuarios** de Ajustes abre con la lista
  real (`GET /users/list`): nombre, correo, teléfono formateado, chips con el
  **nombre oficial** de cada permiso (`Catálogo`, `Pedidos`, `Lucid Bot`…),
  Activo/Inactivo, búsqueda, paginación y las acciones **Editar** (modal con
  casillas de permisos → `PUT /users/update/{id}`) y **Eliminar**
  (confirmación → `DELETE /users/delete/{id}`). Tu propia fila sale marcada y
  sin botones de borrado, y la lista se refresca al crear un usuario.
- **Reparto automático de pedidos**: arriba de la pestaña hay la tarjeta
  **«Reparto automático de pedidos»** con el **interruptor** (chip ACTIVO /
  apagado / sin conectar), el modo (*solo quien esté en horario* · *entre
  todos*), el intervalo en segundos, las **tiendas** y los **estados** que
  revisa (por defecto *Por confirmar*), la **última vuelta** ejecutada, y
  botón **Probar ahora** (ejecuta una vuelta en el
  acto aunque esté apagado). También elige los **usuarios que participan**:
  los marcados están *dentro* y los desmarcados *fuera* (si no marcas a
  ninguno, participan todos los activos; si desmarcas a todos, no se reparte
  nada). Si el backend no está arrancado, la tarjeta lo
  dice y los campos quedan deshabilitados.
- **Credenciales del backend (sin tocar el `.env`)**: la tarjeta **«Conexión
  del backend con LucidSales»** (Ajustes → Usuarios) deja escribir el correo y
  la contraseña que usa el backend: chip *guardadas · s\*\*\*\*\*\*o@dominio* o
  *sin credenciales*, botón **Guardar credenciales** (`PUT /api/credenciales`,
  efectivo en el momento, **sin reiniciar**) y **Quitar credenciales**. La
  contraseña nunca se vuelve a mostrar y el correo sale enmascarado; se guarda
  en `server/credenciales.json` (permisos 600 y en el `.gitignore`).
- **Horario de cada usuario**: la misma tabla tiene la columna **Horario** y
  el botón **Horario** en cada fila: activo/pausado, días (1 = lunes …
  7 = domingo) y franja horaria, guardados en el backend propio
  (`PUT /api/asignacion/horario`) y evaluados en su zona (`TZ_ASIGNACION`,
  defecto Bogotá). El chip sale **verde si está en turno ahora mismo** y ese
  es el filtro que usa el reparto «solo los que están en horario».

## Estructura

```
src/
  api/client.ts       fetch + x-token + manejo de 401 (cierra sesion)
  api/backend.ts      fetch de NUESTRO backend (x-api-key) + descarga de CSV
  api/anuncios.ts     tipos y llamadas de rentabilidad de campanas Meta
  api/endpoints.ts    wrappers documentados + cambiarEstadoPedido (backend propio)
  api/pedidoBody.ts   cuerpo de /pedidos/update montado desde un pedido crudo
  auth/AuthContext    login -> addShopId -> sesion en localStorage
  auth/permisos.ts    permisos por rol: que menu/rutas abre cada numero
                      (y su nombre oficial: Catalogo, Pedidos, ...)
  components/         Layout, Toast, Modal, Etiquetas, ListaUsuarios,
                      ListaProductos, ImportarDropi, StockDropi, tablas,
                      editor JSON, ubicacion, OficinaInter, ErrorBoundary
  components/anuncios/ Resumen, Alertas, Campanas, Productos, Reporte, ConectarCuenta
  lib/etiquetas.ts    etiquetas de pedidos: store local por tienda
  lib/tiendas.ts      nombres de tienda (getshopname) + etiqueta de tienda
  lib/botInbox.ts     url del inbox del bot (no es un campo de la API)
  lib/paises.ts       prefijos CO/PA/MX y telefono con/sin prefijo del pais
  lib/dropi.ts        importar de Dropi: normaliza el catalogo y arma el payload
  lib/productos.ts    las 87 claves de updateproducto (edicion de productos)
  lib/format.ts       fechas relativas, dinero y telefonos
  pages/              Inicio, Pedidos, Detalle, Crear, Productos, Clientes,
                      Cotizador, Metricas, Anuncios, Ajustes

../server/            backend propio (Node sin dependencias): cambio de estado,
                      API key, historial de cambios y oficinas de Inter.
                      Ver server/README.md
```

## Notas sobre endpoints sin documentar

Los datos de esta API no venian de un Swagger sino del bundle JS del panel
oficial. Lo que quedo confirmado ya esta documentado en `../lucidsales_api_doc.md`:

- **Enums reales**: `EstadoPedido` 0-9 (Por confirmar → Novedad Solucionada),
  `TipoPago` 1=CON RECAUDO / 2=SIN RECAUDO.
- **Cotizaciones**: 9 rutas (`dropi`, `enviapuntocom`, `99envios`, `boxful`,
  `venndelo`, `hoko`, `aliclik`, `dropanas`, `swayp`), siempre sobre un pedido
  existente, con body por transportador y respuesta `{ok, quotes[], suggestedTransportadoraId}`.
- **Filtros**: `{name, searchValues, sortOrder}` con nombres
  `date|customer|subtotal|orderStatus|fulfillmentStatus|product|source`.
- **Roles/permisos**: `rol` es una lista de números (`"1,2,3,4,5,6,7,8"`,
  `"all"`/`"admin"`, `null` = acceso total) y el oficial la comprueba **en el
  menú y en el registro de rutas** (tabla completa en
  `../lucidsales_api_doc.md` §1.4). Es ocultamiento de UI: no se pudo verificar
  si la API rechaza las llamadas de un rol sin permiso. En nuestro panel vive
  en `auth/permisos.ts` (`puede(rol, seccion)`).
- **Usuarios (lista)**: `GET /users/list`, `PUT /users/update/{id}` y
  `DELETE /users/delete/{id}` **no están en el bundle principal**: salen del
  chunk perezoso `assets/AjustesUsuariosScreen-*.js` (por eso la minería de
  rutas inicial no los vio). `list` es GET con
  `page/itemsPerPage/search/filters`; al escribir, `permisos` va como
  `JSON.stringify([...])` y el `users/create` real manda
  `{nombre, usuario, telefono, direccion, permisos}` (**no**
  `{name, email, rol}`) — por eso el formulario manda las dos formas. Nombres
  de cada número en `../lucidsales_api_doc.md` §1.4.
- **Ajustes**: `ajustes/*` no existe; se usa `business/*` + `users/*`. La
  pestaña **Negocio** carga la ficha real con `POST /auth/getshopname` y al
  guardar manda el objeto **completo** traducido a `business/update`
  (`Nombre`→`nombre`, `WhatsappNum`→`whatsappNum`, `selCountryCode`→`paisCode`,
  `selCurrency`→`moneda`, `status*` en `1`/`0`), así lo que no se muestra no
  se pierde; si la ficha no carga, lo avisa y solo envía lo escrito. **Bot**:
  (editor completo): lee `POST /business/bot` —**`data["0"]`, no array**: con
  la forma de array la pestaña no cargaba nada— y lo pone todo en campos:
  identidad (asistente, bot, descripción), conversación (tipo de voz, modelo,
  segundos de recepción e interruptores de *dividir texto* / *agrupar
  mensajes* / *saludo en audio*), **flujo activo en un desplegable** (antes
  era una lista con un `<li>` por flujo: con 127 flujos de tu cuenta era
  inmanejable) alimentado por `POST /tools/bot/flows` con la `botApiKey` de la
  tienda (sin pegarla a mano), y marcado con *· activo* el que está guardado;
  debajo, una tarjeta con los datos de la **cuenta** y un bloque plegado
  *Probar otra API key*. Siguen métodos de pago, preguntas frecuentes (+
  post-venta en un
  bloque plegado), políticas, **notificaciones** por evento y teléfono,
  script (+ sus dos interruptores), **mensaje inicial con el editor de pasos
  de Productos** (tipos Texto/Imágenes/Videos/Audios/Espera, previews de
  imagen, reproductores de vídeo y audio, subir/bajar/borrar pasos, y el
  aviso si el interruptor «Mensaje inicial personalizado» está apagado; se
  guarda como array de `{type, content, id}` igual que en el producto) y
  **Testimonios con el mismo editor de pasos** (tipos
  `testimonio_*`, hasta 20, texto o urls con vista previa); se envían como
  `testimonios` **y** `Testimonios` y, si el backend
  no los devuelve al recargar, se avisa en vez de perderlos en silencio),
  reglas y agradecimientos, además de las llamadas (Calls), en bloques
  plegados, y el prompt de imágenes de
  `GET /tools/bot/get-template` en solo lectura. Al guardar manda **la ficha
  de la tienda + la configuración del bot** a `business/update` con el
  formato exacto del oficial: **arrays** para las listas (`metodosDePago`,
  `preguntasFrecuentes`, `reglas`…), **objeto** para `notificaciones`,
  **booleanos** para los `personalizar*` y `1`/`0` para `dividirTexto`… y se
  respeta el valor original de cada lista (si era objeto sigue siendo
  objeto). Ojo: `botFlow` **no** viene en la config del bot sino en la ficha
  de la tienda, así que se rescata de ahí para no desvincular el flujo.
  **Usuarios**: buscar por token → ficha, crear usuario, crear contraseña
  (teléfono con prefijo `57`/`507`/`52` y usuario en minúsculas) y
  restablecer por correo (`{usuario, email}`). En ninguna parte hay un editor
  JSON a la vista: los JSON quedan detrás de «Ver JSON…» y si algo falla se
  ve el `msg` del servidor en un banner.
- **Respuestas con forma desconocida**: `JsonTable`/`pickArray` extraen la
  primera lista util y muestran las columnas que encuentren.

### Aun sin confirmar

- Valores de `EstadoPago` (el panel no lo expira en ninguna UI, solo lo preserva).
- Body exacto de `quote/aliclik`, `quote/dropanas` y `quote/swayp`
  (mismo patron base que el resto, pendiente de probar).
- Expiracion exacta del token (existe `/auth/token/refresh`, pero el panel no
  expone la duracion).

