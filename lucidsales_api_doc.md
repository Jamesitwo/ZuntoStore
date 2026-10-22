# LucidSales API - Documentacion

**Base URL:** `https://panel.lucidsales.co/b/`

> **Fuente:** secciones 1-5 extraidas manualmente; el resto verificado/extraido
> del bundle JS del panel (`/assets/index-*.js`, cliente `axios` con
> `baseURL: "https://panel.lucidsales.co/b/"`). Fecha: 2026-10-03.

---

## 1. Autenticacion

El flujo de autenticacion tiene **2 pasos obligatorios**: login y activacion de tienda.

### 1.1 Login

```
POST /auth/login
Content-Type: application/json

{
    "email": "tu@email.com",     // se normaliza: trim + minusculas
    "password": "tu_contraseña"
}
```

**Respuesta exitosa:**
```json
{
    "ok": true,
    "token": "eyJhbGciOiJI...",
    "id": 3755,
    "name": "Alberto Castaño",
    "rol": "admin",
    "idEmpresa": ["3234", "3682"],
    "email": "tu@email.com",
    "email_verified": true
}
```

**Error:** `{"ok": false, "msg": "..."}` o HTTP 400.

> Guarda este `token` para el paso 2.

### 1.2 Activar Tienda (OBLIGATORIO)

El token del login tiene `tiendaActiva` vacio. Debes activar una tienda para obtener un token funcional.

```
POST /auth/addShopId
x-token: <token_del_login>

{
    "id": 3682
}
```

**Respuesta exitosa:**
```json
{
    "ok": true,
    "token": "eyJhbGciOiJI...",
    "tiendaActiva": 3682,
    "rol": "1,2,3,4,5,6,7,8",
    "idEmpresa": ["3234", "3682"]
}
```

> **IMPORTANTE:** Usa SIEMPRE el `token` devuelto por `addShopId`, NO el del
> login. El panel guarda ademas `token-date` (fecha de creacion) y refresca el
> token con `POST /auth/token/refresh`. Si recibes 401, vuelve a login + addShopId.

### 1.3 Headers para endpoints autenticados

```
Content-Type: application/json
x-token: <token_de_addShopId>
```

### 1.4 Roles (`rol`)

El `rol` es una **lista de numeros** separados por comas (`"1,2,3,4,5,6,7,8"`),
o `"all"` / `"admin"`. El panel oficial lo comprueba en **dos** sitios: el
menu lateral (cada enlace se pinta solo si el rol incluye su numero) y el
registro de rutas (la ruta se registra solo si hay permiso; si no, cae en `*`).

| Numero | Nombre oficial (checkbox del formulario) | Seccion |
|--------|------------------------------------------|---------|
| 2 | Pedidos | `pedidos`, `pedidos/:id`, `pedidos-crear` |
| 3 | Clientes | Clientes |
| 4 | Métricas | `metricas`, `metricas-lucidsales` |
| 5 | Catálogo | Productos (`producto`, `producto-crear`) |
| 6 | Lucid Bot | Bot + Llamadas |
| 7 | Usuarios y Permisos | Ajustes → Usuarios |
| 8 | Ajustes Tienda | Ajustes → General e Integraciones |

Los nombres salen de los checkbox del formulario "Agregar empleado" del chunk
`assets/AjustesUsuariosScreen-*.js`. El **1** aparece en los roles reales
(`"1,2,3,…"`) pero no tiene ni checkbox ni condición de menú: probablemente sea
Inicio/Dashboard.

Sin condicion (siempre visibles): `/media`, `/wallets/history`, `/billing`,
`/ajustes/perfil`, `salir` y superbodega (si el usuario lo tiene).

Reglas del oficial: `rol === null` o `rol === "all"` → acceso total; si no,
`rol.includes("<numero>")`. Ejemplo: `rol = "1,2,3,4,5,6,7,8"` → acceso total.

> **Es solo UI:** el gating es del lado del cliente (menu + rutas); no se ha
> podido verificar si la API rechaza las llamadas de un rol sin permiso.
>
> **Nuestro panel lo aplica** (`panel/src/auth/permisos.ts`):
> `2` → Pedidos **y** Cotizador, `3` → Clientes, `4` → **Métricas** (página
> `/metricas`, ver §17), `5` → Productos,
> `7`/`8` → pestañas de Ajustes (Usuarios / Negocio+Bot). El `6` (Lucid Bot)
> no existe aqui; Inicio no pide permiso; `""` se trata como acceso total (para no
> cerrarlo todo si el login no trae rol). La ruta bloqueada pinta un aviso con
> el numero que falta y `*` lleva a `/` (no a `/pedidos`) para que un usuario
> sin el permiso 2 no rebote.

### 1.5 Otros endpoints de autenticacion

```
POST /auth/token/refresh          -> {ok} (refresca el token vigente)
POST /auth/renew
POST /auth/getshopname   {id}     -> {ok, shopName}
POST /auth/register       {name, phone, country, email, title, password}
POST /auth/link-store     {name, phone, country, email, title, password}
POST /auth/send-verification-code
POST /auth/verify-email
```

#### `POST /auth/getshopname` — nombres de las tiendas

Sirve para mostrar el **nombre** de cada tienda en lugar del id. El panel la usa
en el selector del topbar y en el paso de eleccion de tienda.

```
POST /auth/getshopname
x-token: <token>

{
    "id": ["3234", "3682"]      // el array idEmpresa del usuario
}
```

**Respuesta:**
```json
{
    "ok": true,
    "shopName": [
        { "id": 3234, "Nombre": "Pizdo Store", "Correo": "...", "logo": "..." },
        { "id": 3682, "Nombre": "Otra tienda", "Correo": "...", "logo": "..." }
    ]
}
```

- `id` tambien acepta un solo id en arreglo, ej. `{id: [3682]}` (así lo llama el
  panel al restaurar sesion y toma `shopName[0]`).
- Cada elemento trae ademas los campos del negocio (`Nombre`, `Correo`,
  `Telefono`, `Direccion`, `logo`, `pais`, moneda e integraciones): con
  `{id:[<tienda_activa>]}` sirve para cargar la ficha completa de la tienda.
- La respuesta es publica por usuario, no por tienda activa: devuelve todas las
  tiendas asociadas al `idEmpresa` del login.

### 1.6 Manejo de sesion / suscripcion

- **401** → el panel hace `POST /ai-landing/sso-logout` y cierra sesion.
- **Suscripcion inactiva** → redirige a `/billing` (`GET /subscriptions/status`).
- Portal de facturacion: `POST /subscriptions/portal`, checkout: `POST /subscriptions/checkout`.

---

## 2. Pedidos

### 2.1 Listar Pedidos

```
GET /pedidos/get-pedidos-light-data?idEmpresa=3682&page=1&itemsPerPage=50&search=&filters=%5B%5D
```

**Query params:**

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `idEmpresa` | number | ID de la tienda |
| `page` | number | Pagina (empieza en 1) |
| `itemsPerPage` | number | Pedidos por pagina |
| `search` | string | Busqueda por texto |
| `filters` | string | JSON URL-encodeado de filtros |

**Respuesta:**
```json
{
    "ok": true,
    "pedidos": [
        {
            "id": 3256175,
            "idPedido": 6106,
            "idEmpresa": 3682,
            "Nombre": "Ana",
            "Apellido": "Gómez",
            "Movil": "+573001112233",
            "EstadoPedido": 0,
            "EstadoFullfilment": "Sin Envio",
            "producto": "Pulverizadora Raptor + kit de raches",
            "Total": "169900.00"
        }
    ],
    "totalRecords": 6126,
    "numPages": 62
}
```

> Campos de la fila usados por el panel oficial (extraidos del bundle):
> `id`, `idPedido`, `Total` (columna "Valor"), `EstadoPedido` (columna
> "Estado del pedido"), `EstadoFullfilment` (columna "Estado del envio",
> ver 2.5.1), `source` (columna "Origen") y los que alimentan las plantillas
> de Orden/Fecha/Cliente. **No confundir**: `EstadoFullfilment` es el campo de
> la fila, mientras que `fulfillmentStatus` es solo el **nombre del filtro**
> (ver 2.2).
>
> **`producto`** (minúscula) trae el nombre del producto del pedido y **sí
> está en la respuesta real** (verificado 2026-10-06 con `itemsPerPage=3`):
> es el que pinta la columna **Producto** de nuestra lista de Pedidos.

### 2.2 Filtros (`filters`)

Formato de cada filtro:

```json
{"name": "date", "searchValues": [], "sortOrder": "desc"}
```

| Campo | Tipo | Valores |
|-------|------|---------|
| `name` | string | ver tabla de columnas abajo |
| `searchValues` | string[] | segun tipo de filtro (abajo) |
| `sortOrder` | string \| null | `"asc"`, `"desc"` o `null` |

**Columnas / nombres de filtro reales:**

| `name` | Columna | `filterType` | `searchValues` |
|--------|---------|--------------|----------------|
| `date` | Fecha | `date` | `["<ISO inicio>|<ISO fin>"]` p.ej. `"2026-10-01T00:00:00.000Z|2026-10-03T23:59:59.000Z"` |
| `customer` | Cliente | `select` | `["valor"]` (valores de `filtersData.customers`) |
| `subtotal` | Valor | (texto/rango) | `["texto"]` |
| `orderStatus` | Estado del pedido | `select` | `["Por confirmar"]` etc. (ver 2.5) |
| `fulfillmentStatus` | Estado del envio | `select` | valores de `filtersData.fulfillmentStatuses` |
| `product` | Producto | texto | `["texto"]` |
| `source` | Origen | `select` | valores de `filtersData.sources` |

Ejemplo minimo (orden por fecha, como usa el panel):
```json
[{"name":"date","searchValues":[],"sortOrder":"desc"}]
```

Ejemplo combinado:
```json
[
  {"name":"date","searchValues":["2026-10-01T00:00:00.000Z|2026-10-03T23:59:59.000Z"],"sortOrder":"desc"},
  {"name":"orderStatus","searchValues":["Confirmado"],"sortOrder":null}
]
```

### 2.3 Datos de Filtros

```
GET /pedidos/get-filters-data?idEmpresa=3682&page=1&itemsPerPage=50&search=&filters=...
```

**Respuesta:**
```json
{
    "ok": true,
    "filtersData": {
        "customers": ["Ana", "Maria"],
        "fulfillmentStatuses": ["Pendiente", "Enviado"],
        "sources": ["Manual", "Shopify"]
    }
}
```

### 2.4 Obtener Pedido por ID

```
GET /pedidos/get-pedido-by-id/3256175
```

**Respuesta:**
```json
{ "ok": true, "pedido": { "id": 3256175, "idPedido": 6106, "...": "..." } }
```

- `Observaciones`: string JSON -> `[{"desc":"...","update":"2026-06-28T10:00:00","user":"System"}]`
  (si no es JSON valido, el panel lo trata como texto simple con `user:"System"`).
- `Json`: string JSON -> lineas del pedido. Con variaciones:
  `[{"product_id":"40242","price":null,"variations":[{"variation_id":77,"price":169900,"quantity":1}],"quantity":null}]`.
  Sin variaciones: `{"product_id":"40242","price":169900,"variations":[],"quantity":1}`.
  **Total** = `sum(price * quantity)` (+ variaciones anidadas).
- `EstadoFullfilment` + `transportadora`: estado del envio y transportadora
  asignada (ambos de solo lectura). El panel oficial los pinta como
  **"Estado de envio:"** y **"Transportadora:"** en el detalle. Ver 2.5.1.

**Campos de guia / dropshipping** — el panel oficial los muestra en el acordeon
**"Envío"** del detalle (`headingFour` del bundle). Llegan todos en
`get-pedido-by-id`, son de **solo lectura** y cada uno se pinta solo si trae
valor (vacio o `"0"` no se muestra):

| Campo | Etiqueta oficial | Notas |
|-------|------------------|-------|
| `dropshippingProvider` | Proveedor de guías | `"dropi"`, `"rocket"`, `"hoko"`… → capitalizado; `"none"` no se pinta |
| `fechaCreadoDropi` | Fecha de creación | `DD/MM/YYYY hh:mm A` en el oficial |
| `fechaActualizadoDropi` | Fecha de actualización | idem |
| `idPedidoDropi` | ID de pedido | si es `"0"`/vacio se usa `idPedidoExterno`; si los dos son `"0"` no se pinta |
| `idPedidoExterno` | (respaldo) | id del pedido en el proveedor (Venndelo, Rocket…) |
| `EstadoFullfilment` | Estado de envío | ver 2.5.1 |
| `transportadora` | Transportadora | |
| `idGuiaTransportadora` | ID Guia Transportadora | guia tracking en la transportadora |
| `fleteDropi` | Costo de flete | numerico (COP) |
| `gananciaEsperadaDropi` | Ganancia esperada | numerico (COP). Es la ganancia **neta real** del pedido: ya trae descontados el flete y el costo del proveedor (ej. Total 84.900 − flete 20.790,5 − costo 40.000 = 24.109,5) |
| `valorFleteDevolucionDropi` | Valor de devolución | solo si hubo devolucion |
| `fechaDevolucionDropi` | Fecha de devolución | solo si hubo devolucion |

Ejemplo real (pedido entregado, guia de Dropi con transportadora Interrapidisimo):

```
Proveedor de guías: Dropi        ID de pedido: 88103337
ID Guia Transportadora: 240060425660   Costo de flete: 20895
Ganancia esperada: 16105
```

Nuestro panel lo pinta en la tarjeta **"Envío y guías"** del detalle (mismo
contenido, en formato plata y fecha legible).

### 2.5 Estados de pedido (`EstadoPedido`)

| Valor | Estado |
|-------|--------|
| 0 | Por confirmar |
| 1 | Cancelado |
| 2 | Confirmado |
| 3 | Modificado |
| 4 | En Transito |
| 5 | En Reparto |
| 6 | Entregado |
| 7 | Devuelto |
| 8 | En Novedad |
| 9 | Novedad Solucionada |

> La version antigua de este documento decia `0 Pendiente / 1 Cancelado /
> 2 Completado`; la etiqueta real de `0` es "Por confirmar" y `2` es "Confirmado".

### 2.5.1 Estado del envio (`EstadoFullfilment`)

> **Grafia original del API: `EstadoFullfilment`** (una sola `l` en el medio).
> El nombre del *filtro* es otro: `fulfillmentStatus` (ver 2.2).

- **Campo de solo lectura**: en los 6.5 MB del bundle del panel oficial
  `EstadoFullfilment` **solo se lee**, nunca se envia en un body de
  `/pedidos/update`. Lo escriben las integraciones de courier (justo al subir
  un pedido el panel actualiza el estado local a
  `{EstadoFullfilment: "Creado", EstadoPedido: 2}`).
- **Donde lo muestra el panel oficial**:
  - Lista de pedidos: columna **"Estado del envio"** (badge, filtro
    `fulfillmentStatus` con los valores de `filtersData.fulfillmentStatuses`).
  - Detalle del pedido: bloque **"Estado de envio:"** (solo si el valor es
    truthy) y, al lado, **"Transportadora:"** (campo `transportadora`).
  - Los componentes de cada courier reciben `orderStatus={EstadoFullfilment}`
    y tratan `"Sin Envio"` como "aun no se ha asignado logistica"
    (`s1 = [0,2,3].includes(EstadoPedido) && EstadoFullfilment === "Sin Envio"`
    habilita el boton de subir).

**Valores observados** (todos son strings, no un enum numerico):

| Valor | Significado | Color oficial |
|-------|-------------|---------------|
| `Sin Envio` | sin logistica asignada | `gray` |
| `CANCELADO` | envio cancelado | `gray` |
| `Creado` | recien subido al courier | `#8500ff` (violeta) |
| `ENTREGADO` | entregado | `#548c2f` (verde) |
| `Entregada a destino` | entregado (texto largo) | `#548c2f` (verde) |
| `DEVOLUCION` | devuelto | `#dd1c1a` (rojo) |
| `Devolución a origen` | devuelto (texto largo) | `#dd1c1a` (rojo) |
| *cualquier otro* | en curso (ENVIADO, EN TRANSITO…) | `#8500ff` (violeta) |

Logica exacta del badge oficial (`function KK({status:e})`):

```js
if (e === "Sin Envio" || e === "CANCELADO")          // clase .estado-no-fullfilment
if (e === "ENTREGADO" || e === "Entregada a destino") // clase .estado-entregado
if (e === "DEVOLUCION" || e === "Devolución a origen")// clase .estado-cancelado
if (e !== "Sin Envio")                                // clase .estado-fullfilment (fallback)
```

CSS oficial:

```css
.estado-fullfilment    { color:#fff; background:#8500ff; ... }
.estado-no-fullfilment { color:#fff; background:gray;     ... }
.estado-entregado      { color:#fff; background:#548c2f;  ... }
.estado-cancelado      { color:#fff; background:#dd1c1a;  ... }
```

Este panel lo replica con `EnvioBadge` (`components/ui.tsx`) usando la paleta
clara de la tema: `.badge.envio` (violeta `#7c3aed`), `.badge` (gris),
`.badge ok` (verde) y `.badge danger` (rojo); si el campo viene vacio muestra
`—`. La columna se muestra en la lista y la fila "Estado de envio" +
"Transportadora" en la tarjeta *Estado y pago* del detalle.

### 2.6 Tipos de pago (`TipoPago`)

| Valor | Nombre | Equivalente |
|-------|--------|-------------|
| 1 | CON RECAUDO | COD (contraentrega) |
| 2 | SIN RECAUDO | PREPAID (prepago) |

`EstadoPago`: **no se expone en la UI**; el panel solo preserva el valor en
cada `update`. Su enumeracion no es inferible del cliente.

### 2.7 Actualizar Pedido

```
POST /pedidos/update
```

**Body (exacto como lo envia el panel):**
```json
{
    "id": 3256175,
    "idPedido": 6106,
    "idEmpresa": 3682,
    "Nombre": "Ana",
    "Apellido": "Gómez",
    "NIT": "",
    "Correo": "",
    "Movil": "+573001112233",
    "Direccion": "Carrera 92#78b-02, Centro",
    "verifiedAddress": "",
    "Pais": 47,
    "codigoPostal": "",
    "Departamento": 2,
    "Ciudad": 71,
    "Observaciones": "[{\"desc\":\"Pedido creado\",\"update\":\"2026-06-28T10:00:00\"}]",
    "EstadoPedido": 0,
    "Json": "[{\"product_id\":\"40242\",\"price\":169900,\"variations\":[],\"quantity\":1}]",
    "SubTotal": "169900.00",
    "CostoEnvio": "0.00",
    "Total": 169900,
    "TipoPago": 1,
    "EstadoPago": 0,
    "logistic": "",
    "Referencias": "Centro"
}
```

- Al **cancelar** se agrega el campo extra **`motivo`** (string) junto con
  `EstadoPedido: 1`.
- `Total` llega como string desde la API pero el panel lo reenvia como numero;
  el backend acepta ambos.
- **Tipos:**

| Campo | Tipo |
|-------|------|
| `id`, `idPedido`, `idEmpresa` | number (Int32) |
| `Pais`, `Departamento`, `Ciudad` | number (Int32) |
| `EstadoPedido`, `TipoPago`, `EstadoPago` | number (Int32) |
| `SubTotal`, `CostoEnvio`, `Total` | string o number |
| `Observaciones`, `Json` | string (JSON.stringify) |
| Resto de campos | string |

**Respuesta:** `{"ok": true, "msg": "Pedido actualizado"}`

### 2.8 Confirmar / Cancelar pedido

**Confirmar** = `update` con `EstadoPedido: 2` y, si hay integracion activa:

```
POST /pedidos/integrations/confirm/venndelo   {"id": <id>, "confirmation_status": "CONFIRMED"}
POST /pedidos/integrations/confirm/rocket     {"orderId": <idPedidoDropi>, "confirmation_status": "CONFIRMED"}
```

**Cancelar** = `update` con `EstadoPedido: 1` + `motivo` y
`confirmation_status: "REJECTED"` a la integracion.

Otros:
```
POST /pedidos/integrations/cancel/enviapuntocom
```

### 2.9 Crear Pedido

```
POST /pedidos/create
```

**Body:**
```json
{
    "idEmpresa": 3682,
    "nombreCliente": "Ana",
    "apellidoCliente": "Gómez",
    "emailCliente": "",
    "telefonoCliente": "+573001112233",
    "direccionCliente": "Carrera 92#78b-02",
    "ciudadCliente": 71,
    "departamentoCliente": 2,
    "paisCliente": 47,
    "codigoPostal": null,
    "nitCliente": "",
    "idCliente": 1234,
    "json": "[{\"product_id\":\"40242\",\"price\":169900,\"variations\":[],\"quantity\":1}]",
    "subTotal": 169900.00,
    "costoEnvio": 0,
    "total": 169900.00,
    "Referencias": "Centro"
}
```

- `idCliente` es **opcional** (cliente existente).
- Validaciones del servidor: debe haber departamento y ciudad (>0) y al menos
  una linea en `json`.
- `subTotal`/`total` son **numbers** (parseFloat con 2 decimales) y
  `costoEnvio` el panel lo envia en `0` (se recalcula luego con la cotizacion).

> **Nota:** `create` usa nombres de campo diferentes a `update` (ej: `nombreCliente` vs `Nombre`).

**Respuesta:** `{"ok": true, ...}` o `{"ok": false, "msg": "..."}`.

### 2.10 Cotizar Envio

Rutas reales (el nombre **no** es el del transportador en todos los casos):

```
POST /pedidos/quote/dropi
POST /pedidos/quote/enviapuntocom        <-- no existe /quote/envia
POST /pedidos/quote/99envios
POST /pedidos/quote/boxful
POST /pedidos/quote/venndelo
POST /pedidos/quote/hoko
POST /pedidos/quote/aliclik
POST /pedidos/quote/dropanas
POST /pedidos/quote/swayp
```

**Body** (`id` es el **id del pedido**; se cotiza siempre sobre un pedido existente):

| Transportador | Body |
|---------------|------|
| `dropi` | `{id, direccion, tipoPago, ciudad, departamento, referencias, total}` |
| `enviapuntocom` | `{id, direccion, tipoPago, ciudad, departamento, referencias, pais}` |
| `99envios`, `boxful`, `venndelo` | `{id, direccion, tipoPago, ciudad, departamento, referencias}` |
| `hoko` | `{id, stocks}` (salida de `checkIfOrderCanBeUploaded`, ver 2.12) |
| `aliclik`, `dropanas`, `swayp` | confirmar contra la API (mismo patron base) |

`direccion`, `ciudad`, `departamento`, `referencias`, `pais` y `total` salen
del pedido (`Direccion`, `Ciudad`, `Departamento`, `Referencias`, `Pais`, `Total`).

**Respuesta** (ejemplo real, recortado):
```json
{
    "ok": true,
    "quotes": [
        {
            "distributionCompany": { "id": 6, "name": "VELOCES", "color": "#DC2E76", "is_visible": true },
            "transportadora": "VELOCES",
            "transportadora_minuscula": "veloces",
            "transportadora_id": 6,
            "transportadora_service": "normal",
            "objects": {
                "precioEnvio": 17500,
                "seguroEnvio": null,
                "trayecto": "",
                "overload_was_applied": true
            }
        },
        {
            "distributionCompany": { "id": 2, "name": "ENVIA", "color": "#E7484E" },
            "transportadora": "ENVIA",
            "transportadora_id": 2,
            "transportadora_service": "normal",
            "objects": { "precioEnvio": 20460, "seguroEnvio": 0, "trayecto": "NACIONAL" }
        }
    ],
    "suggestedTransportadoraId": 6,
    "feedback": "solo si ok=false"
}
```

Campos de cada quote:

| Campo | Significado |
|-------|-------------|
| `transportadora_id` | id que se usa para `courier_id` (subida a hoko) y para comparar con `suggestedTransportadoraId` |
| `transportadora` / `transportadora_minuscula` | nombre visible de la transportadora (mostrar esto al usuario, no el id) |
| `distributionCompany.name` / `.color` | nombre y color de marca (ej. `#DC2E76`) para pintar la fila |
| `transportadora_service` | nivel de servicio (`normal`, etc.) |
| `objects.precioEnvio` | precio del envio (numero) |
| `objects.seguroEnvio` | seguro (`0`, `null` o importe, ej. TCC `1950`) |
| `objects.trayecto` | `NACIONAL` / `Nacional` / `""` |
| `objects.overload_was_applied` | si se aplico recargo por sobrepeso/volumen |
| `error` | presente cuando esa transportadora fallo |

Transportadoras observadas en respuestas reales: `VELOCES(6)`, `ENVIA(2)`,
`INTERRAPIDISIMO(3)`, `DOMINA(4)`, `COORDINADORA(5)`, `TCC(10)`, `JAMV-DRIVE(13)`.

- Si hay `suggestedTransportadoraId`, esa es la sugerida.
- Si no, el panel elige la mas barata: `quotes.filter(q => !q.error && q.objects).sort((a,b) => a.objects.precioEnvio - b.objects.precioEnvio)[0]`.
- En error: `{"ok": false, "feedback": "..."}`.

### 2.11 Validar Direccion

```
POST /pedidos/validate-address

{
    "direccion": "Carrera 92#78b-02",
    "ciudad": 71,
    "departamento": 2,
    "pais": 47
}
```

**Respuesta:** `{"ok": true, "data": {...}}` o `{"ok": false, "error": "..."}`.
El resultado verificado se guarda en el campo `verifiedAddress` del pedido
(JSON con `.response`).

Relacionado: `POST /pedidos/start-address-validation-flow`.

### 2.12 Verificar si se Puede Subir Pedido

```
POST /pedidos/checkIfOrderCanBeUploaded     {"id": 3256175}
```

**Respuesta:**
```json
{ "ok": true, "stocks": [ { "product_id": "40242", "stocks": [ { "...": "..." } ] } ] }
```

### 2.13 Subir pedido a Hoko

```
POST /pedidos/upload/hoko     {"id": 3256175, "stocks": [...], "courier_id": 5}
```

**Respuesta:** `{"ok": true, "feedback": "..."} | {"ok": false, "msg": "..."}`.

### 2.13b Subir pedido a Dropi (con la transportadora elegida)

```
POST /pedidos/upload/dropi    {"id": 3256175, "transportadora_id": 6}
```

- `transportadora_id` es **opcional** y sale de la cotización
  (`POST /pedidos/quote/dropi` → `quotes[].transportadora_id`; la respuesta
  trae `suggestedTransportadoraId` y el panel preselecciona la sugerida, o la
  más barata si no la hay). Sin transportadora solo va `{"id": ...}` y Dropi
  resuelve la suya.
- El patrón es genérico: `pedidos/upload/{integracion}` para `dropi`, `rocket`
  y `hoko`; para `shopify`, `venndelo`, `99envios`, `boxful`, `swayp`, `effi`,
  `easyecommerce`, `enviapuntocom`, `aliclik` y `dropanas` el oficial usa
  `pedidos/integrations/upload/{integracion}`.
- El oficial **guarda el pedido antes de subirlo** y, si la respuesta trae
  `ok:true`, marca en el panel `EstadoFullfilment: "Creado"` y
  `EstadoPedido: 2`. Nuestro panel hace lo mismo (en `PedidoDetallePage` →
  `subidoEnDropi`).
- Si el pedido ya está en Dropi (`idPedidoDropi` distinto de vacío/`"0"`), no
  se ofrece subirlo: se muestra su id.

**Respuesta:** `{"ok": true, "feedback": "…"} | {"ok": false, "feedback"|"msg": "…"}`.

```
POST /pedidos/venndelo/recipient-trust/batch    {"ids": [3256175, ...]}
POST /pedidos/dropi/fingerprint/batch           {"ids": [3256175, ...]}
```

**Respuesta:** `{"ok": true, "results": {"<id>": {...}}}`.

---

## 3. Productos

### 3.1 Listar Productos

```
POST /productos/getproductos     {"idEmpresa": 3682}    (tambien acepta sin body)
```
**Respuesta:** `{"ok": true, "productos": [ ... ]}`

> Variante paginada que usa la lista oficial: `GET /productos/getProductos?…`
> → §3.5 (crear / editar / borrar).

### 3.2 Listar Productos Shopify / Dropi (catálogo externo)

```
POST /productos/listProducts/shopify     (sin body)
POST /productos/listProducts/dropi       (sin body)
```

**Respuesta Dropi:**

```json
{
  "catalogo_de_productos": [
    { "id": 9002, "name": "Taladro Dropi 68v", "description": "…",
      "price": 150000, "type": "SIMPLE" | …,
      "image" | "images": [ … ],
      "variations": [ { "id": 9101, "attribute_values": [{"attribute":{"name":"Color"},"value":"Rojo"}],
                        "price": 150000, "sku": "DRO-ROJ",
                        "warehouse_product_variation": [ {"stock": 3} ] } ],
      "warehouse_product": [ {"stock": 12} ] }
  ],
  "importedDropiIds": ["9003"]
}
```

Respuesta Shopify (parcial): `catalogo_de_productos`, `importedShopifyIds`, `ok`.

> **Qué permite**: es el catálogo de **Dropi para importar productos**, no el de
> tu tienda. El flujo oficial es: pedir la lista → pintarla (normalizada con
> `name`, `price`, `images`, `variations[].attribute_values`) → marcar los que
> ya están en `importedDropiIds` («Ya importado», no se pueden volver a elegir)
> → seleccionar → `import-external-products` (§3.3). El stock por bodega viene
> en `warehouse_product[*].stock` / `warehouse_product_variation[*].stock`
> (el oficial lo calcula y **no lo pinta**). Nuestra implementación está en
> `panel/src/lib/dropi.ts` (`normalizarDropi` + `armarImportacionDropi`) y el
> modal en `panel/src/components/ImportarDropi.tsx`.

### 3.3 Importar Productos Externos

```
POST /productos/import-external-products

{
    "platform": "shopify",          // o "dropi"
    "products": [ { "id": "...", "title": "...", "variantes": [...], "images": [...] } ]
}
```
**Respuesta:** `{"ok": true, "msg": "..."} | {"ok": false, "msg": "..."}`

> **Cuerpo exacto que manda el oficial para `platform:"dropi"`** por producto
> (reproducido tal cual en `armarImportacionDropi`):
>
> ```js
> { id, title, description, body_html, videos: [],
>   variantes:      [{sku:<10 car>, nombre:"Color", opciones:[{sku,nombre,archivo:""}]}],
>   mixedvariantes: [{items:["Rojo"], precioBodega:0, precioSugerido:precio,
>                     sku:"<idVariante>", realSku:"<sku de dropi>"}],
>   bundle:         [{cant:1, default:true, hide:false, index:0, name:"1 Unidad",
>                     precio:String(precio), resaltar:false, sku:<12 car>, texto:"", imagenes:[]}],
>   bundleVariantes:[{sku:<el del bundle>, name:"1 Unidad",
>                     variantes:[{…mixedvariantes, idVarianteDropi: sku}]}],
>   optCombVariantes: variantes.length ? 1 : 0,
>   disponibilidadProductoLucidBot: 1,
>   images: [{image, star:true}] }
> ```
>
> El `sku` de variantes/opciones es aleatorio de 10 caracteres y el del bundle
> de 12. Los `sku` de `mixedvariantes` son los ids de Dropi (`realSku` lleva el
> sku real de Dropi).

### 3.4 Otros endpoints de productos

```
POST /productos/export/venndelo
GET  /productos/getAddressesBoxful
GET  /productos/getAddressesEnvia
GET  /productos/getAddressesSwayp
POST /productos/createAddressSwayp
GET  /productos/getCitiesSwayp
GET  /productos/getAgentsAveonline/{agentId}
GET  /productos/getAgentsAveonlineWithoutSave
GET  /productos/validateDropiId/{idProductoDropi}
POST /productos/products/integrations/dropanas
```

### 3.5 Crear, editar y borrar productos

Estos cuatro salen de los chunks oficiales `ProductosListScreen-*.js` (lista y
alta) y `ProductoScreen-*.js` (edición), que tampoco están en el bundle
principal.

```
GET  /productos/getProductos?page=&itemsPerPage=&search=&filters=[]
     -> {"ok":true,"productos":[...],"totalRecords":n}
GET  /b/productos/getproducto/{id}   (id = id del producto, p. ej. 55772)
     -> {"ok":true,"producto":{…150 campos…},"landings":[],"newLandings":[],
         "datosEmpresa":{…}}          (a veces la clave es "product")
POST /productos/addproducto/
     {nombre, valor, pais, sku:"",
      bundle:[{cant:1, default:true, hide:false, name:"1 Unidad", precio,
               resaltar:false, sku:"<12 caracteres aleatorios>", texto:"",
               imagenes:[]}]}
     -> {"ok":true,"msg":"...","insertID":991}
POST /productos/updateproducto   -> {"ok":true,"msg":"..."} | {"ok":false,...}
POST /productos/deleteproducto   {idProducto}
     -> {"ok":true,...} | {"error":"..."}   (el oficial comprueba `.error`)
POST /productos/duplicate-product
POST /productos/updatebundle     {bundles, idProducto, bundleVariantes, Precio?}
GET  /productos/validateDropiId/{id}    (id = id del producto EN Dropi)
     -> {"ok":true,"msg":"El producto fue encontrado",
         "product":{"id":1870895,"name":"COMBO TALADRO… | Stock: 948",
                    "stock":948,"cod_dane":1221,"private_product":false}}
     -> {"ok":false,"msg":"…"}  si no existe
```

> - **Columnas de la lista oficial**: imagen (`imagenes[0].image ??
>   imagenes[0]`), Nombre (con badges *Superbodega*/*Importado*), Estado
>   (`disponibilidadProductoLucidBot` → Activo/Inactivo), Visitas, Visitas
>   únicas, `VentasTotales` (órdenes) y % conversión
>   (`VentasTotales/VisitasUnicas`); al pulsar una fila entra a la edición.
> - **`pais`**: el modal de alta manda `shopInfo.pais`; nuestro panel lo lee de
>   `POST /auth/getshopname` (`selCountryId`) y si no lo encuentra manda `47`.
> - **`updateproducto`** manda **87 claves fijas** (lista completa en
>   `panel/src/lib/productos.ts` → `CLAVES_UPDATE`): `Nombre`, `Precio`,
>   `DescripcionCorta`, `Descripcion`, `ModoDeUso`, `CaracteristicasTecnicas`,
>   `ContenidoPaquete`, `stock`, las listas serializadas con `JSON.stringify`
>   (`variantes`, `mixedvariantes`, `imagenes`, `Testimonios`, `videos`,
>   `Reglas`, `mensajeInicial`, `upSell`, `PreguntasFrecuentes`,
>   `preguntasFrecuentesPostVenta`, `AdsMetaTags`, `AdsMetaCampaigns`), los
>   flags `opt*` en `1`/`0` y los ids de todas las integraciones (Dropi,
>   Shopify, Hoko, Venndelo, 99envios, Aveonline, Mastershop, Rocket, Boxful,
>   Aliclik, Dropanas, …).
>
> **Diferencias GET ↔ PUT descubiertas con una respuesta real**
> (`GET /b/productos/getproducto/55772`, 150 campos):
>
> | En el GET | En el PUT (oficial) |
> |---|---|
> | `MensajeInicial` (mayúscula, JSON string) | **`mensajeInicial`** ← alias obligatorio, si no se manda la bienvenida se pierde |
> | `activeIntegrations: "[\"dropi\"]"` (string) | `activeIntegrations: ["dropi"]` (**array**) y `activeIntegration: "dropi"` |
> | `variantes`, `mixedvariantes`, `imagenes` (array) | serializados con `JSON.stringify` |
> | `Testimonios`, `Reglas`, `videos`, … (JSON string) | idem: si ya son string se mandan tal cual |
> | no trae `byIdDropanas` | se manda como flag `0` |
>
> El resto de los 150 campos **no se envía** (`url`, `bundle`, `Visitas`,
> `FechaCreacion`, `EnvioGratis`, `Visible`, `tags`, …): el backend hace un
> `UPDATE` con esas 87 columnas, así que mandarlos de más solo es ruido y
> mandar alguno de menos puede dejar la columna en `NULL`. Nuestro panel manda
> **exactamente esas 87 claves** (misma regla que el oficial), rellenas con la
> ficha y con los campos editados encima.
>
> Campos editables desde el panel (todos oficiales): nombre, precio, precio
> bodega, precio sugerido, stock, ciudad, descripción corta, descripción, modo
> de uso, características técnicas, contenido del paquete, link audiovisual,
> los 3 píxeles, los 3 textos de seguimiento post-venta y **13 interruptores**
> (`disponibilidadProducto*`, `optLanding`, `optEcommerce`, `optMayoristas`,
> `optAppMovil`, `optSuperBodega*`, `optCombVariantes`, `manageForm*`,
> `personalizar*`). El modal además muestra las integraciones vinculadas y una
> tabla plegable **«Todos los campos (N)»** con la lista completa del objeto,
> marcando cuáles se guardan y cuáles **no** (fuera de las 87: `url`, `sku`,
> `bundle`, `Visitas`, `EnvioGratis`, `Visible`, `tags`, medidas…): esas no se
> envían, se quedan como están en la base de datos.
> - `getproducto` devuelve `product` **o** `producto` (el oficial lee
>   `k.product || k.producto`) y trae además `landings`, `bundleVariantes`, etc.
> - **Dropi**: el id de la integración **se puede cambiar** desde el modal de
>   edición con el botón **Validar y vincular**: llama a
>   `GET /productos/validateDropiId/{id}` y, **si responde `ok:true`, guarda el
>   enlace ahí mismo** (`updateproducto` con `idProductoDropi` +
>   `nameProductoDropi`; el resto del cuerpo sale de la ficha, así que no se
>   cuela ninguna edición pendiente) y refleja el cambio en la ficha y en el
>   formulario. Si responde `ok:false` **no se guarda nada** y se pinta el
>   `msg`. El oficial, al enlazar, copia además `product.cod_dane` → `Ciudad`;
>   aquí eso va en un botón aparte (*«Usar 1221 como ciudad»*) para no cambiar
>   la ciudad de despacho sin querer. Otras dos diferencias: el oficial
>   **sobrescribe `variantes`** con las del producto de Dropi (nosotros no las
>   tocamos) y **bloquea** el cambio si el producto está publicado en la
>   Superbodega (esa marca no se distingue en la ficha, así que aquí no se
>   bloquea).
> - **Stock real**: el campo `stock` de LucidSales **no** es el de verdad (el
>   producto real lo traía en `0` mientras Dropi marcaba `948`). El panel lo
>   lee de Dropi con la cadena `idProductoDropi` (fila del catálogo → si no,
>   `getproducto/{id}`) → `validateDropiId/{id}` → `product.stock`, **cacheada
>   por producto** (una llamada en total), y lo pinta como chip *«Stock Dropi:
>   948»* en la línea de producto de cada pedido (crear y detalle), en verde
>   con stock, rojo si está en 0 y *«Sin Dropi»* si el producto no está
>   vinculado.
> - **Mensaje inicial**: el modal de edición también deja **editar o crear la
>   secuencia de bienvenida** del bot. El `getproducto` la trae en
>   **`MensajeInicial`** (mayúscula, JSON string) y `updateproducto` la pide
>   como **`mensajeInicial`** (alias obligatorio). Cada paso es
>   `{type, content, id}` con `id` = timestamp en ms:
>
>   | `type` | `content` |
>   |---|---|
>   | `mensaje_inicial_texto` | string |
>   | `mensaje_inicial_espera` | segundos, en string (`"1"`) |
>   | `mensaje_inicial_imagenes` / `_videos` / `_audios` | array de urls |
>
>   Se serializa con el mismo orden de claves que el oficial (las urls vacías
>   se descartan) y solo se usa si `personalizarMensajeInicial = 1` (el modal
>   lo avisa si el interruptor está apagado). Si el producto no trae nada, el
>   editor arranca vacío y se puede crear desde cero. **Las urls se ven como
>   medio, no como texto**: las imágenes salen en galería (clic = tamaño
>   completo), los videos con reproductor y los audios con su pista; el enlace
>   sigue ahí debajo, en letra pequeña, para poder editarlo.
> - **Variantes**: el modal edita `variantes` (atributos → opciones, con
>   `sku` aleatorio de 10) y `mixedvariantes` (combinación + `precioSugerido` +
>   `precioBodega`, con `sku` de 12 y `realSku` de solo lectura). Respeta las
>   reglas del oficial: no añade atributos/opciones con nombre vacío, límite
>   de **100 combinaciones** (`combinaciones = producto de las opciones`) y al
>   tocar la estructura apaga el interruptor **Combinar variantes**
>   (`optCombVariantes: 0`).
> - **Reglas y preguntas**: `Reglas` es un `string[]` (una textarea por regla);
>   `PreguntasFrecuentes` y `preguntasFrecuentesPostVenta` son
>   `[{pregunta, respuesta}]` con los mismos botones del oficial
>   (*«+ Agregar nueva pregunta frecuente»* / *«…post-venta»*).
> - **Testimonios**: se guardan **como pasos** —`Testimonios` =
>   `[{type, content, id}]` con tipos `testimonio_texto` ·
>   `testimonio_imagenes` · `testimonio_videos` · `testimonio_audios` ·
>   `testimonio_documento` · `testimonio_espera`—, **misma estructura que el
>   mensaje inicial** (decisión del usuario; el formato del oficial es otro,
>   ver abajo). Hasta **20** pasos, que es el límite del oficial. Cada paso es
>   una tarjeta numerada con selector de tipo, ↑/↓ y ✕, y el contenido puede
>   ser texto o urls con vista previa (imagen/vídeo/audio/📄). El oficial no
>   tiene endpoint de subida: aquí se pegan urls ya subidas.
>
>   **Compatibilidad**: `parsearTestimonios()` sigue leyendo el formato
>   **oficial** (`[{image:url}]`, `[{video:url}]`, `[{audio:url}]`,
>   `[{file:url}]` o strings sueltos) y lo convierte en pasos, así que abrir y
>   guardar un producto no pierde lo que ya tenía. ⚠ Si se edita después en el
>   **panel oficial**, él espera archivos y dejará los pasos vacíos.
> - **Bundles**: `bundle` y `bundleVariantes` **no son de las 87 claves** de
>   `updateproducto`; el oficial los guarda con un endpoint aparte:
>
>   ```
>   POST /productos/updatebundle
>        {idProducto, bundles: JSON.stringify([...]), bundleVariantes: JSON.stringify([...])}
>        -> {ok, msg:"Bundle actualizado correctamente"} | {error}
>   ```
>
>   (el campo opcional `Precio` que a veces añade el oficial es el precio dual
>   de Dropanas y aquí no se manda). El modal los edita y los guarda con su
>   propio botón **«Guardar bundles»** —y también al pulsar *Guardar cambios*
>   si hay cambios pendientes—. Comportamientos copiados del oficial: un bundle
>   nuevo arranca como `{sku:<12>, name:"Nuevo bundle", cant:1, precio:<el del
>   primero>, default:false, hide:false, resaltar:false, texto:"", imagenes:[],
>   index}` y copia las variantes del primer bundle (o las del producto); al
>   borrar se quita de los dos arrays; el precio sale deshabilitado si el
>   producto tiene variantes (entonces manda el de cada variante);
>   `bundleVariantes` aquí se muestra solo como contador (los precios por
>   variante y paquete se tocan en *Precio por variante*).
> - Respaldo: si `getProductos` no responde, se usa `POST /productos/getproductos`
>   (§3.1) y se pagina/filtra en cliente (así lo hace nuestro panel).

### 3.6 Campañas de Meta (Ads)

```
GET  /meta/campaigns
     -> {"ok":true,"campaigns":[{"value":"120257357496240339",
          "label":"Prueba 02 - Milwaukee 68v 09/08/2026"}, …]}
POST /meta/campaigns/ads/sync    {campaigns:["<value>", …]}
     -> {"ok":true,"ads":[{"adId":777000111}, …]}
```

> Los dos viven en el chunk `ProductoScreen` (no en el bundle principal) y
> alimentan la sección **«Campañas de Meta»** del editor de producto:
>
> - `GET /meta/campaigns` se pide **al abrir** la sección (el oficial lo hace en
>   un `useEffect` cuando el acordeón se abre, no al cargar la ficha) y sus
>   `campaigns` son directamente las opciones del multiselect: mismo formato
>   `{value, label}` que lo guardado en `AdsMetaCampaigns`.
> - La selección se guarda como `AdsMetaCampaigns: [{value,label}]` (una de las
>   87 claves, serializada a JSON).
> - **Actualizar anuncios** → `ads/sync` con los `value` de lo seleccionado →
>   devuelve los `adId` y **se añaden a `AdsMetaTags`** los que falten. El
>   oficial avisa *«N anuncio(s) nuevos agregados.»* o *«Sin novedades»*.
> - Ojo con el nombre: **`AdsMetaTags` son identificadores de anuncios**
>   (`adId`), no audiencias. Se pueden quitar y **añadir a mano** («Ingresa
>   manualmente el ID de tus publicaciones»).
> - Nuestro editor: sección desplegable en
>   `panel/src/components/ListaProductos.tsx` y `meta` en
>   `panel/src/api/endpoints.ts`.

---

## 4. Clientes

### 4.1 Listar Clientes

```
GET /clientes/getclientes                                   (sin params)
GET /clientes/getclientes?page=1&itemsPerPage=50&search=&filters=%5B%5D
```
**Respuesta:** `{"ok": true, "clientes": [...], "totalRecords": 123}`
(`totalRecords` solo en la variante paginada; mismos `filters` que 2.2.)

**Campos de cada cliente** (extraidos de la tabla del panel oficial, en el
bundle):

| Campo | Columna oficial |
|-------|-----------------|
| `Nombre` | Nombre |
| `Correo` | Correo electrónico |
| `TelCliente` | Teléfono |
| `DirCliente` | Dirección |

**Numero de pedidos de un cliente**: no viene en el cliente, **no hay filtro por
telefono** y el filtro `customer` es de texto sobre el **nombre**, asi que con dos
clientes homónimos se mezclan (vimos un cliente con 87 pedidos "por compartir
nombre"). El panel lo resuelve **contando localmente**: baja el listado de pedidos
una vez por tienda y asocia cada pedido a su cliente por el telefono.

```bash
# 1) bajar el listado (paginas de 500, fecha descendente; varias en paralelo)
filters='[{"name":"date","searchValues":[],"sortOrder":"desc"}]'
curl -s -G "https://panel.lucidsales.co/b/pedidos/get-pedidos-light-data" \
  --data-urlencode "idEmpresa=3682" --data-urlencode "page=1" \
  --data-urlencode "itemsPerPage=500" --data-urlencode "filters=$filters" \
  -H "x-token: $TOKEN" \
  | jq '{totalRecords, numPages, moviles: [.pedidos[].Movil][0:3]}'
# 2) contar: Movil del pedido (ultimos 10 digitos) vs TelCliente del cliente
#    - con telefono y >=20% de cobertura -> recuento exacto
#    - sin telefono (o tiendas con casi ninguno) -> por nombre, marcado con ≈
```

> **Ojo con `filters=[{"name":"customer",...}]`**: sirve para navegar, no para
> contar. Devuelve todos los pedidos de cualquier persona con ese nombre:
>
> ```bash
> filters='[{"name":"customer","searchValues":["Ana Perez"],"sortOrder":null}]'
> curl -s -G "https://panel.lucidsales.co/b/pedidos/get-pedidos-light-data" \
>   --data-urlencode "idEmpresa=3682" --data-urlencode "itemsPerPage=5" \
>   --data-urlencode "filters=$filters" -H "x-token: $TOKEN" \
>   | jq '{totalRecords, filas: [.pedidos[] | "\(.Nombre) \(.Apellido) \(.Movil)"]}'
> ```

### 4.2 Obtener Integraciones

```
GET /clientes/getIntegrations
```

### 4.3 Actualizar Integracion

```
POST /clientes/updateIntegration/rocket      {"autoUpload": true, "status": 1}
POST /clientes/updateIntegration/swayp
POST /clientes/updateIntegration/{nombre}
POST /clientes/updateIntegrationPriority
```

Otros de integraciones:
```
POST /clientes/updateMetaToken
POST /clientes/logoutMeta
POST /clientes/reuseFacebookSession
GET  /clientes/reusableFacebookSessions
POST /clientes/rocket/callback
```

---

## 5. Utilidades (Publicos, sin auth)

### 5.1 Monedas

```
GET /currencies
```
```json
[
    {"name":"Dolares","code":"USD","symbol":"$","decimals":2},
    {"name":"Pesos","code":"COP","symbol":"$","decimals":0}
]
```

### 5.2 Ubicaciones

```
GET /tools/getCountries               -> {"ok":true,"countries":[{"id":47,"sortname":"CO","name":"Colombia",...}]}
GET /tools/getCountryState?country=47 -> {"ok":true,"states":[{"id":2,"name":"Antioquia"},...]}
GET /tools/getStateCity?state=2       -> {"ok":true,"cities":[{"id":71,"name":"Medellin"},...]}
```

> Estos tres catálogos (públicos, sin token) son los que alimentan el selector
> en cascada **país → departamento → ciudad** del pedido (detalle y creación).
> El panel oficial los pinta como `<select>`; el nuestro va con un **combobox
> con búsqueda** (`panel/src/components/Combo.tsx`): escribes y la lista se
> filtra por nombre o por id, sin distinguir tildes ni mayúsculas
> (`medellin` → *Medellín*), con teclado (flechas / `Enter` / `Escape`),
> contador de coincidencias y hasta 60 filas visibles. Mientras no haya
> país/departamento el campo lo indica deshabilitado y, si un catálogo no
> carga, se puede escribir el id a mano.
>
> El mismo componente se usa ahora para el **selector de producto** de las
> líneas del pedido (crear y detalle), alimentado por
> `POST /productos/getproductos`: cada fila muestra el precio a la derecha, se
> busca por nombre **o por id** sin respetar mayúsculas (`p-200` → *P-200*),
> elegirlo rellena el precio de la línea y la **×** lo limpia. Ahí la lista se
> posiciona **fija en el viewport** para que no quede recortada dentro de la
> tabla de líneas (que tiene scroll horizontal). Si el `product_id` de la línea
> no está en el catálogo se muestra igual, marcado como "(id actual)".
>
> **Imágenes**: cada fila lleva una miniatura (30 px) y, con el producto ya
> elegido, una imagen de 34 px junto al campo. `prodImg()` en
> `panel/src/lib/catalogo.ts` entiende los tres shapes que usa el oficial:
> `imagenes: [{image:"https://…"}]` (así lo lee él: `e.imagenes[0].image`),
> `image: {url}` / `images: [{url}]` (Shopify) y nombre de archivo suelto
> (`images: ["abc.jpg"]`), en cuyo caso arma
> `https://tendyc.com/upload/productos/{idEmpresa}/{id}/{archivo}` igual que el
> panel oficial. Si no hay imagen (o no carga) el `<img>` se oculta solo y la
> fila queda como antes.

### 5.3 Cotizar Envio (Publico - lista de transportadoras)

```
POST /tools/quote       (sin body; solo tiendas con paisCode = "CO")
```
**Respuesta:** `{"ok": true, "data": [ ...transportadoras... ]}`

### 5.4 Flujos de Bot

```
POST /tools/bot/flows     {"key": "<botApiKey>"}
```
**Respuesta:** `{"ok": true, "accountData": {...}, "data": [ ...flujos... ], "usedKey": false}`

> **Verificado (2026-10-06)**: solo acepta **POST** (`GET` → 404
> `Cannot GET /tools/bot/flows`) y **`key` es obligatorio** (`{}` → 500).
> `accountData` = `{page_id, name, active, created, total_users}` de la página
> de Facebook y `data` la lista de flujos `{id, name}`. Nuestro panel lo llama
> solo con la `botApiKey` de la ficha de la tienda (sin pegar nada a mano).

```
GET  /tools/bot/get-template      (opcional: ?type=5)
```
**Respuesta:** `{"ok": true, "data": {"id":740347, "name":"Prompt Reconocimiento de imagenes", "type":5, "value":"..."}, "key":"..."}`

> Solo **GET** (`POST` → 404) y el parámetro `type` da igual: siempre devuelve
> la misma plantilla (el prompt de reconocimiento de imágenes). Es de solo
> lectura: no se ha visto endpoint para guardarla.

---

## 6. Negocio / Ajustes

> **Correccion:** `POST /ajustes/general`, `/ajustes/usuarios` y
> `/ajustes/integraciones` **no existen** en el panel real. La configuracion
> pasa por `business/*` y `users/*`.

```
POST /business/bot        (sin body)
```
**Respuesta (verificada en vivo, 2026-10-06):**
```json
{
    "ok": true,
    "data": {
        "0": {
            "nombreAsistente": "Elizabeth",
            "nombreBot": "Pizdo",
            "metodosDePago": "[{\"nombreBanco\":\"Contra entrega\",\"numeroCuenta\":\"\"}]",
            "preguntasFrecuentes": "[{\"pregunta\":\"...\",\"respuesta\":\"...\"}]",
            "notificaciones": "{\"confirmacion_compra\":{\"telefonos\":[{\"nombre\":\"Diego\",\"numero\":\"+573...\"}]}}",
            "reglas": "[]",
            "tipoDeVoz": "Texto",
            "modeloOpenAI": "Deepseek Basico",
            "botId": "1234567",
            "isApiKeyLinked": 1
        },
        "isAdmin": false,
        "script": "",
        "scriptSettings": { "enabled": true, "requiresLogin": true }
    }
}
```

> **`data` es un OBJETO con la clave `"0"`, no un array** (el panel oficial lo
> lee como `data["0"]`; si viniera array también se acepta). Esto importa:
> con la forma antigua (`data[0]`) el editor no cargaba nada.
>
> Campos dentro de `"0"`: `botId`, `isApiKeyLinked` (0/1, `1` = la API KEY está
> en uso de otra tienda), `nombreBot`, `nombreAsistente`, `descripcionEmpresa`,
> `politicasEmpresa`, `tipoDeVoz`, `modeloOpenAI`, `tiempoRecepcionMensajes`,
> `dividirTexto`/`agruparTexto`/`saludoAudioPersonalizado` (0/1),
> `metodosDePago`, `preguntasFrecuentes`, `preguntasFrecuentesPostVenta`,
> `reglas`, `reglasPostVenta`, `reglasUpsell`, `notificaciones`,
> `personalizar*` + `mensajeInicial`/`agradecimiento*`, los `calls*` de
> llamadas y `botApiKey`.
>
> **Ojo con tres cosas:**
> - `script`, `scriptSettings` e `isAdmin` están en `data`, **no** dentro de `"0"`.
> - **`botFlow` NO viene aquí**: vive en la ficha de la tienda
>   (`POST /auth/getshopname`, §1.5). Si se guardara vacío se desvincularía el
>   flujo, así que hay que rescatarlo de la ficha.
> - Las listas vienen **como JSON en string** (`metodosDePago`, `reglas`,
>   `notificaciones`…) aunque al **guardar** se mandan como array/objeto (ver
>   `POST /business/update` más abajo).
>
> **Dato util (para el chat del bot):** el panel arma el enlace al inbox de
> LucidBot con esta respuesta, NO lo recibe de la API:
>
> ```
> https://panel.lucidbot.co/en/inbox?acc={data["0"].botId}&id={Movil sin "+"}
> ```
>
> Ejemplo real: `https://panel.lucidbot.co/en/inbox?acc=1234567&id=573001112233`
> → `acc` = `botId` de `business/bot`, `id` = telefono del pedido (`Movil`)
> sin el signo `+`. El panel lo muestra como boton "Inbox" en el detalle del
> pedido; si `botId` no existe (bot sin configurar) el enlace no aparece.


```
POST /business/update
```
Body = objeto de configuracion de la tienda (`shopInfo`):
```json
{
    "botApiKey": "...",
    "botFlow": "...",
    "paisCode": "CO",
    "nombre": "Mi tienda",
    "correo": "tienda@email.com",
    "telefono": "+573001234567",
    "direccion": "Cra 92 #78b-02",
    "whatsappNum": "+573001234567",
    "whatsappMessage": "Hola!",
    "whatsappButton": 1,
    "logo": "https://...",
    "apiKey": "...",
    "personalizarMensajeInicial": 0,
    "mensajeInicial": "...",
    "statusDropi": 1,
    "statusEffi": 0,
    "statusAveonline": 0,
    "statusMastershop": 0,
    "statusEasyecommerce": 0,
    "statusHoko": 0,
    "statusShopify": 1,
    "status99envios": 0,
    "statusBoxful": 0,
    "statusGoogleAPI": 0,
    "statusGoogleAI": 0,
    "statusWhatsAppMetaConversions": 0
}
```
**Respuesta:** `{"ok": true} | {"ok": false, "msg": "..."}`

> **De dónde salen los valores:** no existe un GET de configuración. El panel
> oficial arma su `shopInfo` con `POST /auth/getshopname` (§1.5 — cada
> elemento trae la tienda **entera**: `Nombre`, `Correo`, `Telefono`,
> `Direccion`, `WhatsappNum`, `logo`, `apiKey`, `botApiKey`, `botFlow`,
> `dominio`, `status*`, …) y al guardar manda **el objeto completo**
> traducido a estas claves en minúsculas:
>
> | `getshopname` trae | `business/update` espera |
> |---|---|
> | `Nombre`, `Correo`, `Telefono`, `Direccion` | `nombre`, `correo`, `telefono`, `direccion` |
> | `WhatsappNum`, `WhatsappMessage`, `WhatsappButton` | `whatsappNum`, `whatsappMessage`, `whatsappButton` (0/1) |
> | `selCountryId`, `selCountryCode`, `selCurrency` | `pais`, `paisCode`, `moneda` |
> | `status*` (booleanos o `1`/`0`) | las mismas claves; se leen con `!!` |
>
> Precaución: no está confirmado si el endpoint **reemplaza** el documento o
> solo **mezcla** lo que llega, así que lo seguro (y lo que hace el panel
> oficial) es mandar la ficha completa. Nuestro panel hace exactamente eso:
> `panel/src/pages/AjustesPage.tsx` → `armarCuerpo()` carga la ficha con
> `getshopname`, la traduce, encima aplica lo que el usuario editó y solo
> envía campos parciales si ni siquiera pudo leer la ficha (y lo avisa).

> **Los campos del bot van en este mismo `business/update`** (payload real del
> panel oficial) y **cambian de forma** respecto del GET — aquí están en
> array/objeto/booleano, no como string JSON:
>
> | Campo | `GET /business/bot` trae | `POST /business/update` espera |
> |---|---|---|
> | `metodosDePago`, `preguntasFrecuentes`, `preguntasFrecuentesPostVenta`, `reglas`, `reglasPostVenta`, `reglasUpsell`, `mensajeInicial`, `agradecimientoConRecaudo`, `agradecimientoSinRecaudo` | string `"[{...}]"` / `"[]"` | **array** `[{...}]` |
> | `notificaciones` | string `"{...}"` | **objeto** `{evento: {telefonos: [{nombre, numero}]}}` |
> | `personalizarMensajeInicial`, `personalizarAgradecimiento*` | `0` / `1` | **booleano** `false` / `true` |
> | `dividirTexto`, `agruparTexto`, `saludoAudioPersonalizado` | `0` / `1` | `0` / `1` |
> | `isAdmin`, `script`, `scriptEnabled`, `runScriptOnLogin` | viven en `data` (no en `"0"`) | `false`, `""`, `true`, `true` |
>
> **`mensajeInicial` es una secuencia de pasos**, con el mismo formato que en
> el producto: `[{type, content, id}]` donde `type` es
> `mensaje_inicial_texto` · `mensaje_inicial_imagenes` ·
> `mensaje_inicial_videos` · `mensaje_inicial_audios` ·
> `mensaje_inicial_espera`, y `content` es texto, lista de urls o segundos
> según el tipo. Se edita con el **mismo componente** que la ficha de producto
> (`panel/src/components/MensajeInicial.tsx`, usando
> `parsearMensajeInicial`/`serializarMensajeInicial` de `lib/productos.ts`).
>
> **Testimonios en el bot**: la config oficial **no** tiene este campo (solo
> existe en productos, `Testimonios`). Nuestro panel lo permite igual, con el
> **mismo editor de pasos** que el mensaje inicial (`components/Testimonios.tsx`
> con los tipos `testimonio_*`, hasta 20) y lo manda **con las dos claves**
> posibles, `testimonios` y `Testimonios`, por si el backend lee una u otra.
> Si al recargar no vuelven, el panel avisa: *«El backend no conservó los
> testimonios… puede haberlo ignorado»*.
>
> Y al final se añade **la ficha de la tienda entera** (`pais`, `moneda`,
> `status*`, `apiKey`, `botApiKey`, `botFlow`, …), igual que hace la pestaña
> Negocio. En nuestro panel: `AjustesPage.tsx` → `cuerpoBot()` traduce el
> formulario del bot y `armarCuerpo()` añade la ficha; `formDesdeBot()` hace
> lo contrario al leer (parsea esos strings).

---

## 7. Usuarios

```
GET  /users/list?page=&itemsPerPage=&search=&filters=[]
     -> {"ok":true,"usuarios":[{id,Nombre,Usuario,Telefono,Direccion,Permisos,activo}],"totalRecords":n}
PUT  /users/update/{id}   {nombre, telefono, direccion, permisos}
     -> {"ok":true,"msg":"Usuario actualizado correctamente"}
DEL  /users/delete/{id}   -> {"ok":true,"msg":"Usuario eliminado exitosamente"}

POST /users/create          {nombre, usuario, telefono, direccion, permisos}  (ver aviso)
POST /users/create-password {token,nombre,usuario,telefono,direccion,password}
POST /users/reset-password  {usuario, email}    -> mail de recuperacion
POST /users/submit-reset-password   {"token","password"}
POST /users/show/{token}            -> {"ok":true,"nombre","usuario","telefono","direccion"}
```

> - **De donde salen `users/list`, `update` y `delete`:** del chunk perezoso
>   `assets/AjustesUsuariosScreen-*.js`, que **no esta en el bundle principal**
>   (por eso las minas de rutas iniciales no los veian). La ruta
>   `/ajustes/usuarios` del oficial apunta a ese import diferido.
> - **`users/list` es GET** y la query se arma igualita que la del oficial:
>   `page`, `itemsPerPage`, `search` (texto libre, se busca en `Nombre` y
>   `Usuario`) y `filters` (`[]` si no hay filtros de columna).
> - Campos de cada fila: `Usuario` **es el correo** (la columna del oficial se
>   llama "Correo electrónico"), `Telefono` llega con prefijo de país
>   (`57300…`), `Permisos` es la lista de permisos y `activo` es un booleano.
> - `users/show` recibe el **token del usuario** (flujo de creacion de
>   contrasena), no un ID, y es **POST**, no GET.
> - **`permisos` al escribir**: el oficial manda `JSON.stringify([...])`, o sea
>   un **string** `'["2","5"]'`. Al **leer** (`Permisos`) la lista devuelve
>   casi seguro CSV (`"2,5"`) o `"all"`: lee ambos formatos.
> - **`users/create` — CORRECCION:** la unica llamada real del panel oficial es
>   `{nombre, usuario, telefono, direccion, permisos}` (el chunk de Usuarios,
>   con `usuario` en minusculas, teléfono con prefijo y `permisos` como JSON).
>   La forma `{name, email, rol}` que se documentó antes **no aparece en el
>   bundle actual**; nuestro panel manda **las dos** (oficial + `name`/`email`/
>   `rol`) por compatibilidad, y `rol` va en CSV (`"2,5"`).
> - **`users/update` no lleva `usuario`**: el oficial deshabilita el correo al
>   editar, así que solo cambia nombre/teléfono/dirección/permisos.
> - **`Permisos` (fila) vs `rol` (sesion):** casi seguro son el mismo valor
>   (`"1,2,…"` o `"all"`); esta inferido de la lectura de ambos lados, no de la
>   API. Los nombres oficiales de cada numero estan en la tabla §1.4.
> - Normalizaciones que aplica el panel oficial **antes** de enviar:
>   - `users/create`/`update`: `usuario` en minusculas; `telefono` **con el
>     prefijo del pais sin `+`** (`57…` CO, `507…` PA, `52…` MX).
>   - `users/create-password`: igual (minusculas + prefijo).
>   - `users/reset-password`: el panel manda **`{usuario}`** (el correo en
>     minusculas). Nuestro panel añade `email` por compatibilidad. Respuesta
>     `{ok}`; error tipico
>     `{ok:false, msg:"La información proporcionada es incorrecta o no registrada."}`.
> - El panel pinta primero la **lista de usuarios** (tabla con nombre, correo,
>   teléfono, chips de permisos, Activo/Inactivo y acciones Editar/Eliminar en
>   modal, búsqueda y paginación) y debajo los formularios; el JSON solo a
>   petición: `panel/src/components/ListaUsuarios.tsx` y
>   `panel/src/pages/AjustesPage.tsx` (pestaña **Usuarios**).

---

## 8. Registro

```
POST /auth/register

{
    "name": "Nombre Tienda",
    "phone": "+573001234567",
    "country": "CO",
    "email": "tienda@email.com",
    "title": "Nombre",
    "password": "Contraseña123"
}
```

Si el correo ya existe, la respuesta trae `ok:false` y el panel luego llama a
`POST /auth/link-store` con los mismos campos + `password` para vincular la
tienda a la cuenta existente.

---

## 9. Endpoints adicionales (fuera del flujo principal)

```
GET  /subscriptions/status
POST /subscriptions/checkout
POST /subscriptions/portal
POST /ai-landing/sso-auth
POST /ai-landing/sso-logout
POST /api/integration/lucidbot/shipping/quote   (headers: Authorization: <botApiKey>)
GET  /keys/getPublicKey?key=notification
GET  /superbodega/products
GET  /superbodega/product/{id}
GET  /superbodega/warehouses
POST /superbodega/getprods
POST /superbodega/getlanding
POST /superbodega/cloneproduct
GET  /wallets/wallet/swayp?shopId={id}
POST /wallets/business/swayp
GET  /biblioteca/listS3Files/{carpeta}
POST /biblioteca/uploadS3File
```

---

## 10. Errores Comunes

| Error | Causa | Solucion |
|-------|-------|----------|
| `No hay token` | Falta header `x-token` | Agrega el header |
| `No tienes permisos` | Tienda no activada | Ejecuta `addShopId` y usa el nuevo token |
| `Error inesperado` / 500 | Tipos de datos incorrectos | Revisa que `SubTotal` sea string/number y `Pais` sea numero |
| 401 Unauthorized | Token expirado | Vuelve a hacer login + addShopId (o `/auth/token/refresh`) |
| Redirect a `/billing` | Suscripcion inactiva | `GET /subscriptions/status` |
| `{"ok":false,"feedback"}` | Fallo de cotizacion | El `feedback` trae el motivo del transportador |

---

## 11. Codigo Ejemplo (PowerShell)

```powershell
# Configuracion (usa variables de entorno, NO credenciales hardcodeadas)
$email = $env:LUCIDSALES_EMAIL
$password = $env:LUCIDSALES_PASSWORD
$idTienda = 3682

# Paso 1: Login
$loginBody = @{ email = $email; password = $password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "https://panel.lucidsales.co/b/auth/login" `
    -Method POST -Body $loginBody -ContentType "application/json"

# Paso 2: Activar tienda (NUEVO TOKEN)
$shopBody = @{ id = $idTienda } | ConvertTo-Json
$shop = Invoke-RestMethod -Uri "https://panel.lucidsales.co/b/auth/addShopId" `
    -Method POST -Body $shopBody -ContentType "application/json" `
    -Headers @{"x-token" = $login.token}
$token = $shop.token  # USAR ESTE TOKEN

# Paso 3: Usar la API
$filters = [uri]::EscapeDataString('[{"name":"date","searchValues":[],"sortOrder":"desc"}]')
$pedidos = Invoke-RestMethod -Uri "https://panel.lucidsales.co/b/pedidos/get-pedidos-light-data?idEmpresa=$idTienda&page=1&itemsPerPage=10&search=&filters=$filters" `
    -ContentType "application/json" -Headers @{"x-token" = $token} -Method GET
$pedidos.pedidos | Select id, idPedido, Nombre, EstadoPedido
```

> En Windows PowerShell 5.1 no pongas `Content-Type` dentro de `-Headers`
> (header restringido): usa el parametro `-ContentType`.

---

## 12. Codigo Ejemplo (cURL)

```bash
# Paso 1: Login
TOKEN1=$(curl -s -X POST https://panel.lucidsales.co/b/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LUCIDSALES_EMAIL\",\"password\":\"$LUCIDSALES_PASSWORD\"}" | jq -r '.token')

# Paso 2: Activar tienda
TOKEN2=$(curl -s -X POST https://panel.lucidsales.co/b/auth/addShopId \
  -H "Content-Type: application/json" \
  -H "x-token: $TOKEN1" \
  -d '{"id":3682}' | jq -r '.token')

# Paso 3: Usar el TOKEN2 para todo
curl -s "https://panel.lucidsales.co/b/pedidos/get-pedidos-light-data?idEmpresa=3682&page=1&itemsPerPage=50" \
  -H "x-token: $TOKEN2" | jq .
```

---

## 13. Integraciones Soportadas

`venndelo`, `dropi`, `hoko`, `rocket`, `easydrop`, `edrop`, `mastershop`, `aveonline`, `effi`, `boxful`, `shopify`, `swayp`, `easyecommerce`, `99envios`, `envia`, `aliclik`, `dropanas`

Con endpoint de cotizacion propio: `dropi`, `enviapuntocom`, `99envios`,
`boxful`, `venndelo`, `hoko`, `aliclik`, `dropanas`, `swayp`.

---

## 14. Paises Soportados

| ID | Codigo | Nombre |
|----|--------|--------|
| 47 | CO | Colombia |
| 142 | MX | Mexico |
| 10 | AR | Argentina |
| 43 | CL | Chile |
| 172 | PE | Peru |
| 63 | EC | Ecuador |
| 90 | GT | Guatemala |
| 169 | PA | Panama |
| 52 | CR | Costa Rica |
| 61 | DO | Republica Dominicana |
| 171 | PY | Paraguay |
| 237 | VE | Venezuela |

> Confirmado contra `GET /tools/getCountries`.

---

## 15. Funcionalidades propias del panel (fuera de la API)

Estas funciones viven solo en el front-end (panel/); **no existen endpoints
para ellas** y no hay que buscarlos en la API.

### 15.1 Etiquetas de pedidos

- **Crear / editar / eliminar** etiquetas con nombre y color (paleta de 9).
- **Aplicar / quitar** etiquetas a un pedido (boton de la lista y tarjeta del
  detalle) y **filtrar** la lista por etiqueta.
- **Almacenamiento local** en localStorage bajo la clave
  zunto.etiquetas.v1, separado por tienda activa:

```json
{
  "3682": {
    "etiquetas": [{ "id": "et_xxx", "nombre": "VIP", "color": "#2f5bea" }],
    "asignaciones": { "10": ["et_xxx"] }
  }
}
```

  Las claves de asignaciones son el id del pedido (p.id ?? p.idPedido), asi
  que sobreviven a cambios de estado o de tienda. Si cambias de navegador se
  copian con **Exportar/Importar backup JSON** (gestor de etiquetas).

> El filtro por etiqueta es **local**: se aplica sobre los pedidos ya cargados
> en la pagina, porque la API no puede filtrar por algo que no conoce.


---

## 16. Backend propio: cambio de estado (`server/`)

Ademas de consumir la API de LucidSales, la plataforma tiene **su propio
backend** (Node, sin dependencias) en la carpeta `server/`. Cambia el estado de
un pedido de forma segura y auditable (para que el navegador no tenga que armar
el cuerpo del `update` y para que otras apps nuestras puedan llamarlo) y
resuelve la **oficina de Inter Rapidísimo** del municipio del pedido.

### 16.1 Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| `GET`  | `/api/salud`                 | -          | Estado del servicio (`listo`, `faltantes`, `upstream`) |
| `POST` | `/api/pedidos/:id/estado`    | `x-api-key`| Cambia el estado del pedido |
| `GET`  | `/api/historial?limite=50`   | `x-api-key`| Ultimos cambios registrados |
| `GET`  | `/api/interrapidisimo/oficina` | -        | Oficina de Inter por municipio (ver 16.7) |
| `GET`  | `/api/interrapidisimo/oficinas` | -       | **Todas** las oficinas del municipio (ver 16.7) |
| `GET`  | `/api/interrapidisimo/municipios` | -     | Buscador del catalogo de Inter |
| `GET`  | `/api/asignacion?idEmpresa=`  | `x-api-key`| Horarios + asignaciones + quien esta en turno ahora |
| `PUT`  | `/api/asignacion/horario`     | `x-api-key`| Guardar/borrar el horario de un usuario |
| `POST` | `/api/asignacion/repartir`    | `x-api-key`| Reparte pedidos **equitativamente** |
| `DELETE` | `/api/asignacion/pedido/:id`| `x-api-key`| Desasigna un pedido |
| `POST` | `/api/asignacion/limpiar`     | `x-api-key`| Borra las asignaciones de una tienda |
| `GET`  | `/api/credenciales`          | `x-api-key`| Si hay credenciales (correo enmascarado) |
| `PUT`  | `/api/credenciales`          | `x-api-key`| Guarda correo/contraseña **sin reiniciar** |
| `DELETE` | `/api/credenciales`        | `x-api-key`| Las borra |

### 16.2 `POST /api/pedidos/:id/estado`

```http
POST /api/pedidos/3256175/estado HTTP/1.1
content-type: application/json
x-api-key: <API_KEY>
x-origen: panel
x-usuario: Alberto Castano

{ "estado": 2, "motivo": "opcional" }
```

| Campo | Tipo | Reglas |
|-------|------|--------|
| `estado` | number | entero **0..9** (tabla 2.5). Si ya es el estado actual no se toca LucidSales y responde `sinCambios: true` |
| `motivo` | string | **obligatorio si `estado` es 1 (Cancelado)**, opcional en el resto, maximo 400 caracteres |

Respuesta `200`:

```json
{
  "ok": true,
  "id": 3256175,
  "idPedido": 6106,
  "idEmpresa": 3682,
  "estadoAnterior": 0,
  "estadoNuevo": 2,
  "nombreAnterior": "Por confirmar",
  "nombreEstado": "Confirmado",
  "msg": "Pedido actualizado",
  "sinCambios": false
}
```

Errores (siempre `{ "ok": false, "msg": "..." }`):

| HTTP | Causa |
|------|-------|
| 400 | `estado` invalido, `motivo` ausente al cancelar, cuerpo que no es JSON |
| 401 | `x-api-key` incorrecta |
| 404 | el pedido no existe en LucidSales |
| 413 | cuerpo mayor a 256 KB |
| 502 | LucidSales rechazo login, `addShopId` o `update` |
| 503 | el backend no esta configurado (`API_KEY` o `LUCID_EMAIL`/`LUCID_PASSWORD`) |
| 504 | timeout (15 s) o sin respuesta de LucidSales |

### 16.3 Flujo interno por cada cambio

1. `x-api-key` en constante tiempo (401 si no coincide; 503 si no hay `API_KEY`).
2. Validacion de `estado` / `motivo`.
3. `POST /auth/login` -> `POST /auth/addShopId {id}` (**token por tienda**, el
   de `LUCID_TIENDA` o la primera tienda de la cuenta; si el pedido pertenece
   a otra tienda se activa esa). Los tokens se cachean en memoria.
4. `GET /pedidos/get-pedido-by-id/:id` -> se copia el cuerpo completo tal cual.
5. `POST /pedidos/update` con `EstadoPedido` cambiado (y `motivo` si se cancela).
6. Se anota la linea en `server/historial.jsonl`.

Si en cualquier paso LucidSales responde **401**, se invalidan los tokens, se
vuelve a loguear y se reintenta **una sola vez** (mismo comportamiento que el
panel oficial).

### 16.4 Uso desde el panel

- `cambiarEstadoPedido(id, estado, motivo, { quien })` en
  `panel/src/api/endpoints.ts` llama a `/api/pedidos/:id/estado` con
  `x-api-key` (`VITE_API_KEY`), `x-origen: panel` y `x-usuario`.
- Lo usan el **desplegable de estado de la lista** y **Confirmar / Cancelar
  del detalle**. En el detalle, si hay ediciones sin guardar, se guardan
  primero para no perderlas.
- **Respaldo automatico**: si el backend no esta (404, 503, 504, timeout o
  error de red) se reintenta contra la API directa
  (`get-pedido-by-id` + `pedidos/update`) y el toast anota `· API directa`.
  Los errores reales (400 por estado invalido, 401 por API key) se muestran
  tal cual.
- El desplegable de `Estado pedido` del formulario del detalle se sigue
  guardando junto con el resto de los campos (`Guardar`), por eso sigue
  siendo un campo del formulario.

### 16.5 Historial de cambios

`server/historial.jsonl`, una linea JSON por evento:

```json
{"ts":"2026-10-03T18:20:11.482Z","id":3256175,"idPedido":6106,"idEmpresa":3682,"de":0,"a":2,"motivo":null,"origen":"panel","usuario":"Alberto Castano","sinCambios":false,"ok":true}
```

Se consulta con `GET /api/historial?limite=50` (misma `x-api-key`).

### 16.6 Configuracion y arranque

```bash
cd server
cp .env.example .env      # API_KEY, LUCID_EMAIL, LUCID_PASSWORD, LUCID_TIENDA
npm start                 # http://localhost:8787   (npm run dev = --watch)
npm test                  # 36 pruebas (LucidSales e Inter falsos)
```

El panel lo alcanza por el proxy de Vite (`/api` -> `http://localhost:8787`);
tambien puedes levantarlo con `npm run api` desde `panel/`. En produccion,
sirve el backend en el mismo dominio (reverse proxy) o define
`VITE_API_PROPIA` con su URL. Detalles y despliegue: `server/README.md`.

### 16.7 Oficinas de Inter Rapidísimo (`/oficina` y `/oficinas`)

Endpoints **publicos** (sin `x-api-key`, sin credenciales de LucidSales) que
traducen el municipio del pedido en la(s) oficina(s) de Inter:

```bash
# ids de LucidSales que ya trae el pedido (lo que usa el panel)
curl "http://localhost:8787/api/interrapidisimo/oficina?municipio=71&departamento=2"
# nombres (resuelve homonimos) o id de Inter directo
curl ".../oficina?municipio=Cartagena&departamento=Bolivar"
curl ".../oficina?idCiudad=05001000"

# TODAS las oficinas del municipio (mismos parametros)
curl ".../oficinas?municipio=71&departamento=2"
```

`/oficina` devuelve `consultado` (municipio/departamento resueltos, `idCiudad`
DANE y `coincidencia`: `exacta` | `difusa` | `cabecera` | `directa` |
`ninguna`), `oficina` (nombre, dirección, barrio, teléfonos, `lat`/`lng`,
servicios), `horarios`, `bodega`, `diaActual` y `totalOficinas`.

`/oficinas` devuelve el listado completo: `oficinas[]` con `horarios` (semana)
y `horarioHoy`, `total`, `enInter`, `bodega` y `origen`
(`listado` | `principal` cuando Inter devolvio el listado vacio y se apoyo en
la oficina principal | `vacio`), **ordenadas de mas cercana a mas lejana**
(`distancia` en km).

Como el `POST` de Inter tarda **13-25 s** (y ciudades como Cartagena no
publican oficina principal, ademas de que a veces contesta `[]`), la respuesta
rapida trae lo que haya y marca `pendiente: "horarios" | "oficina" |
"listado"` mientras la tarea corre en segundo plano; el panel vuelve a
consultar con backoff hasta que se complete. Si algo falla devuelve lo posible
con `aviso` y `?reintentar=1` borra fallo y caché para relanzar (el listado
vacio solo se cachea 60 s). Caché: catálogo 24 h, oficinas/listado 1 h,
dia 5 min.

Emparejamiento, cobertura medida, tiempos, comportamiento real de Inter y
decisiones de diseño: `interrapidisimo_api_doc.md` (§7). En el panel, la
tarjeta **Oficina Inter Rapidísimo** de `PedidoDetallePage`
(`panel/src/components/OficinaInter.tsx`) **no consulta nada hasta que se pulsa
"Buscar oficinas de Inter"**: lista las oficinas del municipio y, al elegir
"Usar esta dirección", el campo `Direccion` del pedido pasa a
`Oficina Interrapidisimo - <direccion de la oficina>` (pendiente de guardar).

### 16.8 Horarios de usuarios y reparto equitativo (`/api/asignacion`)

Todo vive en `server/asignacion.json` (ruta configurable con `ASIGNACION`),
sin base de datos: se lee una vez, se mantiene en memoria y se vuelveca entero
al disco (archivo temporal + rename, asi que un corte a medias no lo rompe).

```json
{
  "horarios": {
    "ana@demo.com": { "nombre": "Ana", "activo": true,
                      "dias": [1,2,3,4,5], "desde": "08:00", "hasta": "17:00" }
  },
  "asignaciones": {
    "3256175": { "usuario": "ana@demo.com", "nombre": "Ana", "idEmpresa": 3682, "ts": "2026-10-05T15:00:00Z" }
  }
}
```

- **Dias**: 1 = lunes ... 7 = domingo. La hora se evalua en `TZ_ASIGNACION`
  (defecto `America/Bogota`) con `Intl`, asi no depende de la zona del
  servidor; se admiten tambien horarios que cruzan la medianoche
  (22:00 -> 06:00).
- **Reparto equitativo**: a cada pedido se le da al usuario con **menos
  asignaciones** (contando las que ya tiene), con desempate por nombre para
  que el orden sea estable entre ejecuciones.

| Metodo | Ruta | Cuerpo | Respuesta |
|--------|------|--------|-----------|
| `GET`  | `/api/asignacion?idEmpresa=3682` | — | `{horarios, asignaciones, enHorario, ahora}` |
| `PUT`  | `/api/asignacion/horario` | `{usuario, nombre?, horario:{activo,dias,desde,hasta}}` (`horario:null` lo borra) | `{ok, usuario, horario}` |
| `PUT`  | `/api/asignacion/config` | `{automatico, cadaSegundos, modo, tiendas[], estados[]}` | `{ok, config}` |
| `POST` | `/api/asignacion/probar` | — | ejecuta **una vuelta ahora** (aunque este apagado) |
| `POST` | `/api/asignacion/repartir` | `{idEmpresa, modo, reasignar, usuarios:[{usuario,nombre}], pedidos:[id...], ahora?}` | `{ok, reparto, omitidos, totales, ahora}` |
| `DELETE` | `/api/asignacion/pedido/:id` | — | `{ok, existia}` |
| `POST` | `/api/asignacion/limpiar` | `{idEmpresa?}` | `{ok, quitadas}` |

- `modo: "todos"` reparte entre todos los usuarios participantes (los que
  tengan horario con `activo:false` quedan fuera); `modo: "horario"` solo
  entre los que estan **en turno a esa hora** y, si no hay nadie, devuelve
  **409** con el motivo; `modo: "manual"` es la **asignación explícita** de
  unos pedidos concretos a unos usuarios concretos (no mira horarios: es lo
  que usan los botones **Asignar** / **Cambiar** de la lista del panel).
- `repartir` omite los pedidos ya asignados salvo `reasignar: true` (motivo
  `"ya asignado"` en `omitidos`).
- `ahora` es opcional: `{dia: 1..7, minutos: 600}` fuerza la hora (pruebas y
  automatizaciones).
- **Reparto automatico** (`config.automatico`): con el interruptor encendido,
  el proceso (`server/repartoAutomatico.js`) despierta cada `cadaSegundos`
  (10..3600), baja los pedidos recientes de `tiendas` (vacias =>
  `LUCID_TIENDA`) con los `estados` marcados (defecto `[0]` = Por confirmar),
  filtra los que ya tienen dueno y los reparte con la misma regla equitativa.
  **Nunca reasigna** y un fallo (de LucidSales o de configuracion) no rompe el
  intervalo: queda en `ultimo`. La semilla viene de `REPARTO_AUTOMATICO` y
  `REPARTO_CADA` del `.env`; a partir de ahi manda lo que se guarde en el JSON
  (el panel). `POST /api/asignacion/probar` ejecuta una vuelta inmediata
  aunque este apagado, para comprobar credenciales y cantidades sin esperar.
- **Quienes participan** (`config.usuarios`): lista de correos que estan
  **dentro**; los que no estan quedan **fuera**. `null`/ausente = sin
  restriccion (todos los activos), `[]` = nadie (el reparto responde 400
  diciendolo). Los inactivos nunca reciben pedidos, ni aunque esten en la
  lista. En el panel se ven como casillas marcadas (dentro) y desmarcadas
  (fuera); al guardar se concreta la lista.
- En el panel: columna **Horario** en Ajustes -> Usuarios (chip verde cuando
  esta en turno), la tarjeta **Reparto automático de pedidos** (interruptor,
  modo, intervalo, tiendas, estados, ultima vuelta y «Probar ahora») y la
  columna **Asignado** + boton **«Asignar pedidos»** en la lista de Pedidos.

### 16.9 Credenciales sin tocar el `.env` (`/api/credenciales`)

Para que el admin no tenga que editar `server/.env`, el backend guarda sus
propias credenciales de LucidSales en `server/credenciales.json` (permisos
`600` y en el `.gitignore`) y **las pega en memoria en el `config`**: el
cambio es inmediato, sin reiniciar nada ni tocar ficheros a mano.

| Metodo | Ruta | Cuerpo | Respuesta |
|--------|------|--------|-----------|
| `GET`  | `/api/credenciales` | — | `{ok, guardadas, email:"s******o@dominio", origen}` |
| `PUT`  | `/api/credenciales` | `{email, password}` | idem (nunca con la contraseña) |
| `DELETE` | `/api/credenciales` | — | `{ok, guardadas:false}` |

- **La contraseña nunca sale del servidor**: el `GET` solo devuelve el correo
  enmascarado (`servicio@zunto.test` → `s******o@zunto.test`).
- El `PUT` valida formato (correo real y contraseña de 4+ caracteres → 400 si
  no), escribe el archivo de forma atómica, actualiza `config` y llama a
  `cliente.reiniciar()` para olvidar los tokens viejos.
- Si el archivo existe al arrancar, **manda sobre lo del `.env`** y
  `faltantesDeConfig` deja de marcarlas (por eso `/api/salud` pasa a
  `listo: true`).
- Si no hay archivo (o se borran), siguen valiendo las del `.env`.
- En el panel: tarjeta **«Conexión del backend con LucidSales»** en
  Ajustes → Usuarios, con el chip *guardadas · correo* / *sin credenciales* y
  los botones **Guardar credenciales** / **Quitar credenciales**.

---

## 17. Métricas (`/analitica/get-analytics-data`)

Es el **único** endpoint que usa la pantalla oficial de Métricas (rutas
`metricas` y `metricas-lucidsales`, permiso **4**; chunk
`assets/MetricasLucidSalesScreen-*.js`). Salio de rastrear el bundle público
del panel oficial (`https://panel.lucidsales.co/`) y se verificó contra la API
real con token de la tienda 3682.

### 17.1 Consulta

```
GET /analitica/get-analytics-data
    ?startDate=2026-10-06T05:00:00.000Z
    &endDate=2026-10-07T04:59:59.999Z
    &compareStartDate=2026-10-05T05:00:00.000Z
    &compareEndDate=2026-10-06T04:59:59.999Z
    &idShop=3682
    &productId=...            (opcional)
    &source=...               (opcional)
    &dropshippingProvider=... (opcional)

Headers:  x-token: <token tras addShopId>
```

- Las cuatro fechas van en **ISO con hora local recortada a día**: esos
  `05:00Z` son las `00:00` de Colombia (UTC-5). El oficial las arma con
  `Mi()` = `setHours(0,0,0,0)` y `oh()` = `setHours(23,59,59,999)`.
- Se mandan **dos periodos**: el elegido y el **anterior inmediato** de la
  misma duración, para pintar "actual vs. anterior" y el % de variación.
  `compareEnd` = el día anterior al inicio; `compareStart` = `compareEnd −
  (días − 1)`. Ej.: 6 oct (1 día) → 5 oct; 29 sep–5 oct (7 días) → 22–28 sep.
- Los opcionales vacíos **no se mandan** (se filtran antes de serializar).

### 17.2 Respuesta (real, tienda 3682, rango de 1 día)

```json
{
  "ok": true,
  "ventasTotales": { "value": 31843929, "change": -56 },
  "pedidosTotales": { "value": 241, "change": -56 },
  "utilidaData": { "value": 0, "change": "", "gananciaEsperada": 0,
                   "costoPublicidad": 0, "costoDevolucion": 0 },
  "lineChartData": [
    { "name": "00:00", "current": 136000, "previous": 664000,
      "orders_current": 2, "orders_previous": 4 },
    { "name": "01:00", "current": 303400, "previous": 60000,
      "orders_current": 3, "orders_previous": 1 }
  ],
  "confirmationData": [
    { "name": "Por confirmar", "value": 175, "amount": 22785395,
      "percentage": 73, "change": 42 },
    { "name": "Cancelado", "value": 3, "amount": 368800,
      "percentage": 1, "change": -5 },
    { "name": "Confirmado", "value": 63, "amount": 8689734,
      "percentage": 26, "change": -36 }
  ],
  "statusData": [ { "name": "GUIA_GENERADA", "value": 31, "amount": 4516764,
                    "percentage": 76, "change": -5 } ],
  "shippingStatusData": [ { "name": "GUIA_GENERADA", "value": 31,
                            "amount": 4516764, "percentage": 76, "change": -5 } ],
  "rawMetrics": {
    "main":       { "totalSales": "31843929.00", "totalOrders": "241",
                    "ganancia": 0, "adSpend": 0, "costoDev": 0 },
    "comparison": { "totalSales": "72988795.00", "totalOrders": "554",
                    "ganancia": 0, "adSpend": 700.76, "costoDev": 0 }
  }
}
```

### 17.3 Detalles que hay que conocer

- `lineChartData`: con **1 día** son **24 franjas horarias** (`"00:00"` …
  `"23:00"`); con más de 1 día es **una franja por día** en formato `dd/MM`
  (7 días → 6-7 filas). `current`/`previous` son **ventas**;
  `orders_current`/`orders_previous` son **pedidos**.
- `statusData` y `shippingStatusData` traen **una fila por estado** y no siempre
  son iguales: 4 filas en un día, 24 en 7 días (incluye `ENTREGADO`,
  `RECLAME EN OFICINA`, `NOVEDAD`…). No se puede confiar en el número de filas.
- `utilidaData.value = gananciaEsperada − costoPublicidad − costoDevolucion`;
  `change` puede venir como `""`.
- `rawMetrics` da los totales en crudo del periodo actual y del anterior
  (`totalSales`, `totalOrders`, `ganancia`, `adSpend`, `costoDev`).
- **Tasa de entrega** = `percentage` de la fila `ENTREGADO` de `statusData`
  (si no existe, 0).
- **Agrupación de la dona de guías** (la que hace el oficial): nombre con
  `entregad` → Entregado; `devoluci` → Devuelto; `novedad` → En Novedad;
  el resto → En Tránsito.
- Filtros: `productId` = `id` del producto (de `POST /productos/getproductos`,
  que en algunas respuestas trae `product_id`); `source` = valores de
  `GET /pedidos/get-filters-data` (`filtersData.sources`); `dropshippingProvider`
  = nombre de la integración (`dropi`, `hoko`, `venndelo`…).

### 17.4 En nuestro panel

| Pieza | Fichero |
|-------|---------|
| Ruta `/metricas` + permiso 4 | `panel/src/App.tsx`, `panel/src/auth/permisos.ts` (`PERMISOS.metricas`) |
| Enlace del menú | `panel/src/components/Layout.tsx` |
| Endpoint | `panel/src/api/endpoints.ts` → `analitica.get()` |
| Rangos y comparación (réplica de `Mi`/`oh`/`xr`/`ah`) | `panel/src/lib/metricas.ts` |
| Pantalla (tarjetas, gráficas SVG, filtros) | `panel/src/pages/MetricasPage.tsx` |
| Estilos (`.metricas-*`, `.grafica-*`, `.donut`) | `panel/src/styles.css` |

- Sin el permiso **4** la ruta pinta el aviso estándar y **no se hace ninguna
  llamada** (el menú tampoco la muestra).
- Las gráficas son **SVG propio**, sin librería: el bundle solo sube ~15 kB.
- Pruebas: bloques `METRICAS` (45 comprobaciones) y `METRICASROL` (5, con
  `ROL=2`) del harness, con el mock calibrado con la respuesta real.

### 17.5 Métricas de Meta / «Ventas LucidBot» (`/meta/metrics/{id}`)

La **otra** pantalla de métricas del oficial: la ruta `metricas` (chunk
`page-*.js`, título **«Ventas LucidBot»** y encabezado **«Reporte de
Métricas»**), con las campañas de Meta. Se descubrió igual: rastreando el
bundle público.

```
GET /meta/metrics/1
    ?page=1
    &itemsPerPage=100
    &search=                         (texto libre; vacio = sin filtro)
    &filters=[{"name":"costPerSale","searchValues":[],"sortOrder":"asc"}]
    &startDate=2026-10-06            (AAAA-MM-DD, SIN hora ni Z)
    &endDate=2026-10-06

Headers:  x-token: <token tras addShopId>
```

- El `1` del path es el `:id` de la ruta del oficial; **si no viene manda
  `"1"`** y con `3682` responde igual.
- `filters` es el mismo formato que en los pedidos; el orden por defecto de la
  tabla es **`costPerSale` ascendente**.
- **`page`/`itemsPerPage` no paginan**: devuelve todo el rango (78 filas en 1
  día, 287 en 7). Se envían porque los manda el oficial.
- Sin coincidencias responde **sin `insights`**:
  `{ok:true, msg:"No hay insights registrados"}` → hay que leer `insights`
  de forma defensiva.

**Respuesta:**

```json
{
  "ok": true,
  "count": 1,
  "insights": [
    { "adTitle": "Anuncio img 2 PINTANDO", "Test": 1,
      "Producto": "Pistola de Pintura PRO", "idProducto": 44241,
      "adSetTitle": "conjunto de anuncios PISTOLA DE PINTURA - Nuevo Numero",
      "campaignTitle": "SINTETICA Pistola De Pintura Pro - Copia",
      "accountTitle": "000000000000001", "adId": "000000000000000002",
      "messages": null, "costPerMessage": null, "sells": 1,
      "total": "129000.00", "costPerSale": null, "cierre": null,
      "clicks": null, "spend": null, "impressions": null, "reach": null,
      "ctr": null, "cpm": null, "orderStatus": 2,
      "fulfillmentStatus": "GUIA_GENERADA" },
    { "adTitle": null, "Producto": "Pulverizadora Raptor + kit de raches",
      "adId": "organico", "sells": 2, "total": "229200.00",
      "orderStatus": 2, "fulfillmentStatus": "GUIA_GENERADA", "…": null }
  ]
}
```

Notas importantes:

- **Las 78 filas del 6/10 traían `spend`, `clicks`, `impressions`, `reach`,
  `ctr`, `cpm`, `messages` y `costPerMessage` TODOS a `null`**: son los campos
  de Meta y solo se llenan cuando hay insights sincronizados (los de la tienda
  3682 no lo estaban). `sells`, `total`, `Producto` y `fulfillmentStatus`
  **sí** vienen siempre (salen de los pedidos).
- `adId = "organico"` marca las **ventas sin anuncio** (7 de 78): sus campos de
  campaña (`campaignTitle`, `adSetTitle`, `adTitle`) son `null`.
- `total` viene como **string** (`"129000.00"`).
- **Pantalla oficial**: dos destacados (**Total Inversión** en rojo y
  **Ventas** en verde), 10 KPI (Impresiones, Alcance, CTR, CPM, Click,
  # Mensajes, % Cierre, Costo por venta, Costo mensaje, ROAS) y la tabla de 12
  columnas (Campaña · Conjunto de Anuncios · Anuncio · Producto · Mensajes ·
  Costo por Mensaje · Cantidad Ventas · Total Ventas · Costo por Venta ·
  % Cierre · Click · Inversión), con buscador, selector de rango y
  «Descargar Reporte».
- **Los KPI se calculan sobre las filas cargadas**: suma para
  impressions/reach/clicks/messages/sells/total/spend y **promedio** para
  ctr/cpm/costPerMessage (contando solo las filas con valor); aparte
  `costo por venta = inversión/ventas`, `% cierre = ventas/mensajes` y
  `ROAS = total/inversión`.
- **Sincronización**: `GET /meta/insights/last` → `{lastSync, nextAttempt}` y
  `GET /meta/insights/sync` fuerza la lectura. El límite son **3 horas**: si se
  pide antes responde **429** («Demasiado pronto») y `nextAttempt` marca la
  hora. **Verificado**: tras una sincronización los campos de Meta se rellenan
  (2026-10-06: 107 de 142 filas con `spend`, `clicks`, `impressions`, `reach`,
  `ctr`, `cpm` y `messages` → 357,05 de inversión, 5.708 clics, 196.908
  impresiones, 164.068 de alcance, 1.013 mensajes).
- **Monedas**: `spend` viene en la **moneda de la cuenta publicitaria** de
  Meta (p. ej. USD: CPM ≈ 1,81) mientras que `total` está en **COP**. Por eso
  `ROAS = total/spend` a pelo sale gigante: hay que convertir. El oficial no
  lo hace (manda el ratio tal cual).
- **`GET /meta/campaigns`** (sin parámetros) devuelve
  `{ok, campaigns:[{value, label}]}`: solo **id y nombre** de cada campaña
  (148 en la tienda 3682), sin métricas; es el selector que usa la ficha de
  producto (§3.6).

**En nuestro panel**: pestaña **«Ventas LucidBot (Meta)»** dentro de
`/metricas` (`metaMetricas.list()` en `endpoints.ts`; `acumulaMeta()`,
`agrupaCampanas()`, `etiquetaCampana()` y `aDia()` en `lib/metricas.ts`):

- Reutiliza el rango de fechas (en plano `AAAA-MM-DD`), manda `search`
  **siempre** —como el oficial, que lo incluye vacío— y ordena por
  `costPerSale` ↑.
- **Dos vistas conmutables**:
  - **Por campaña** (la que se abre): agrupa por `campaignTitle` (lo orgánico
    como «Orgánico») con columnas *Campaña · Inversión · Impresiones ·
    Alcance · Clics · CTR · CPM · Mensajes · Ventas · Total Ventas · Costo
    por Venta · ROAS*, **cabeceras ordenables** y orden por defecto de **mayor
    a menor inversión**. Pulsar una campaña pasa al detalle con ese filtro
    puesto (chip con × para quitarlo).
  - **Detalle (anuncio)**: la tabla original de 12 columnas.
- **KPI** iguales a los del oficial; un campo **«COP por 1 USD»** convierte
  Inversión, CPM, Costo por venta y ROAS a COP (se guarda en
  `localStorage → zunto.meta.fx`). Sin él se muestran los valores crudos de
  Meta, como el oficial.
- Modal con el detalle de cada fila, **Descargar Reporte** en CSV y botón
  **🔄 Sincronizar Insights** desactivado mientras `nextAttempt` siga en el
  futuro (con la hora en el tooltip; si responde 429 se avisa igual).
