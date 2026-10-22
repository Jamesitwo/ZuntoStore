# API de Inter Rapidísimo — investigación para integración

> Investigado el 2026-10-04 contra el sitio real
> `https://www3.interrapidisimo.com/SitioOficinaMasCercana/` (app Angular cuyo
> bundle fué descargado y analizado) y con llamadas HTTP de prueba.
>
> **Objetivo**: traer la información de la oficina de Inter según el municipio
> del pedido.
>
> ✅ **Integrado**: endpoint en nuestro backend y tarjeta en el detalle del
> pedido → **§7**.

---

## 1. Resumen (lo importante)

| Punto | Hallazgo |
|-------|----------|
| Base URL | `https://www3.interrapidisimo.com/Apicanalesventa/api/` |
| Autenticación | **Ninguna**. Todo es JSON público |
| CORS | **Totalmente abierto**: `access-control-allow-origin: *`, `allow-headers: *`, `allow-methods: GET, POST, PUT, DELETE, OPTIONS` → el panel puede llamarlo **directo desde el navegador** |
| Caché HTTP | `cache-control: max-age=0, no-cache, no-store` → **hay que cachear nosotros** (el listado de ciudades pesa 366 KB) |
| Municipios cubiertos | 1117 registros en `Ciudad_CV/ObtenerCiudades` |
| Por municipio | `ObtenerOficinaPrincipalCiudad?idCiudad=` (1 oficina, ~1-4 s) y `ObtenerCentrosServicioHorarios` (**todas** las oficinas + horarios) |
| Tiempo del listado | `ObtenerCentrosServicioHorarios` tarda **13-25 s** siempre → hay que hacerlo en segundo plano |
| Listado vacío | A veces devuelve `[]` aunque las oficinas existan (Cartagena: 5 veces seguidas el 2026-10-04) → **reintentar** y apoyarse en la oficina principal |
| Errores vistos | `ObtenerCentrosServicioFiltrado` → 404 (ya no existe); `ObtenerServiciosCentroServicio` → 500 siempre |

---

## 2. Endpoints

Todos responden `application/json; charset=utf-8`.

### 2.1 Catálogo de municipios (la clave para mapear)

```
GET /Ciudad_CV/ObtenerCiudades
```

1117 registros, 366 KB:

```json
{
  "IdCiudad": "05002000",
  "Descripcion": "ABEJORRAL",
  "Departamento": "ANTIOQUIA",
  "IdCentroServicioPrincipal": 0,
  "PuntoPrincipal": null,
  "IdLocalidadRegionalAdm": 2338,
  "DescripcionRegional": "RACOL/MEDELLIN/ANT/CARRERA  46 # 27 - 100",
  "NombreCentroLogistico": "COL/MEDELLIN/ANT/COL/OF. PRINC CL 30 A 65 B 59 ",
  "IdCentroLogistico": 2339
}
```

- `IdCiudad` = **código DANE del municipio + `000`** (Bogotá `11001000`,
  Medellín `05001000`, Cartagena `13001000`). Hay unos pocos códigos
  especiales (`999991`, de 5–6 dígitos) y **1 registro sin `Descripcion`**.
- `Descripcion` trae el municipio **con el desambiguador de departamento**
  cuando hay homónimos: `CARTAGENA BOLIVAR`, `ARMENIA QUINDIO`,
  `FLORENCIA CAQUETA`, `ALTAMIRA HUILA`, `SAN ANDRES ARCHIPIELAGO DE SAN
  ANDRES , PROVIDENCIA Y SANTA CATALINA`.

### 2.2 Oficina principal de un municipio

```
GET /CentroServicio_CV/ObtenerOficinaPrincipalCiudad?idCiudad=11001000
```

Devuelve **array con 1 elemento** (la oficina principal/agencia de esa ciudad).

```
GET /CentroServicio_CV/ObtenerBodegaPrincipalPorCiudad?idCiudad=11001000
```

Devuelve **objeto único o `null`** (la bodega principal; en Bogotá existe,
en Abejorral no).

### 2.3 Todas las oficinas del municipio + horarios

```
POST /CentroServicio_CV/ObtenerCentrosServicioHorarios?lat=<n>&lng=<n>&idCiudad=<8>
content-type: application/json

[]
```

- `lat`/`lng` se usan para calcular `Distancia` (en la web los pone la
  geolocalización; puedes poner las coordenadas del centro de la ciudad).
- El **cuerpo es un array de filtros**; `[]` devuelve todo.
  La web manda filtros con esta forma:

```json
[{ "Id": 0, "NombreTabla": "DiasSemana", "Llaves": ["Id"], "Valores": [1], "Operador": ["="] }]
```

Medido **2026-10-04** con `body: []`:

| Llamada | Resultado |
|---------|-----------|
| `idCiudad=05001000` (Medellín) | **4 oficinas**, todas del municipio y con `HorariosCentroServio` |
| `idCiudad=11001000` (Bogotá) | **37 oficinas** del municipio |
| `idCiudad=13001000` (Cartagena) | **0** por la tarde (a la mañana devolvió **20**) → a veces contesta `[]` aunque la oficina exista |
| `idCiudad=08001000` (Barranquilla) | **0** |
| sin `idCiudad` | **~210** oficinas de todo el país (subconjunto distinto en cada llamada), **no** las de la ciudad pedida |

Consecuencias prácticas:

- El filtro `idCiudad` **sí funciona**, pero Inter devuelve `[]` de vez en
  cuando (Cartagena: 5 veces seguidas el 2026-10-04, sin rate-limit — Medellín
  seguía respondiendo bien en las mismas pruebas). Hay que **reintentar** y
  apoyarse en `ObtenerOficinaPrincipalCiudad`.
- Sin `idCiudad` **no sirve como índice nacional**: no devuelve las oficinas
  del municipio pedido.
- Con `idCiudad`, `lat`/`lng` solo cambian el campo `Distancia` (misma lista
  con coordenadas de Medellín o con las del centro del país). Sin `idCiudad`,
  las coordenadas cambian el subconjunto de ~210 que devuelve, pero nunca
  garantiza las oficinas de un municipio concreto.
- El `body` también puede vaciar la respuesta: un filtro de días
  (`NombreTabla: "DiasSemana"`) contestó en 0,4 s con `[]`, y filtrar
  `NombreTabla: "CentroServicio" / Llaves: ["IdCiudad"]` se comportó igual
  que el parámetro de la query.

### 2.4 Utilidades

| Ruta | Método | Respuesta |
|------|--------|-----------|
| `CentroServicio_CV/ObtenerFechaHoraServidor` | GET | `"03/10/2026 22:43:38"` |
| `DiaSemana_CV/ObtenerDiasSemana` | GET | `[{Id:1,Descripcion:"LUNES"}, … {Id:7,Descripcion:"DOMINGO"}]` |
| `DiaSemana_CV/ObtenerDiaSemanaActual` | GET | `{"Id":6,"Descripcion":null}` (hoy) |
| `Tipohorario_CV/ObtenerTiposHorario` | GET | `[{IdTipoHorario:1,Descripcion:"NORMAL"}, {2:"CONTINUO"}, {3:"EXTENDIDO"}]` |

### 2.5 Rutas que NO funcionan

| Ruta | Resultado |
|------|-----------|
| `POST CentroServicio_CV/ObtenerCentrosServicioFiltrado` | **404** (el método existe en el bundle, pero no en el servidor) |
| `GET CentroServicioServicio_CV/ObtenerServiciosCentroServicio?idCentroServicio=&idDia=&idTipoHorario=` | **500** con cualquier combinación → no usar; los horarios vienen dentro de `HorariosCentroServio` |

---

## 3. Esquema de una oficina

```json
{
  "IdCentroServicio": 11725,
  "Tipo": "PTO",                        // PTO | AGE | OFF | COL | …
  "Nombre": "PTO/BOGOTA/CUND/COL/CL 102 A 70 B 37",
  "Direccion": "CL 102 A 70 B 37",
  "Barrio": "SANTA ROSA",
  "IdCiudad": "11001000",
  "Estado": "ACT",
  "Telefono1": "3118358501",
  "Telefono2": "3118358501",
  "Latitud": 4.69684315143838,
  "Longitud": -74.0749204479048,
  "Distancia": 1.55,                    // km respecto a lat/lng enviados
  "RecibeGiros": true,
  "PagaGiros": true,
  "PesoMaximo": 150,
  "VolumenMaximo": 150,
  "ReclamaOficina": false,              // se puede reclamar ahi
  "Recaudo": false,
  "Transacciones": false,
  "MostrarenOficinaCercana": true,
  "FechaGrabacion": "2024-09-20T10:37:38.957",
  "Ciudad": { "IdCiudad": "11001000", "Descripcion": "BOGOTA", "Departamento": "CUNDINAMARCA", "DescripcionRegional": "…", "NombreCentroLogistico": "…" },
  "HorariosCentroServio": [ /* ver abajo */ ],
  "Servicios": null
}
```

### Horarios

```json
"HorariosCentroServio": [
  {
    "DiaSemana": { "Id": 6, "Descripcion": "SABADO" },
    "Franjas": [
      {
        "IdFranja": 2,
        "IdTipoHorario": 2,
        "HoraInicio": "2018-01-08T06:00:00",
        "HoraFin": "2018-01-08T18:00:00",
        "TipoHorario": { "IdTipoHorario": 2, "Descripcion": "CONTINUO" },
        "Horarios": [ { "IdDia": 6, "HoraInicio": 9, "HoraFin": 18, … } ]
      }
    ]
  }
]
```

> Ojo: las fechas de `HoraInicio`/`HoraFin` son **viejas (2018)**; lo útil es
> la hora (`T06:00:00`) o `Horarios[].HoraInicio/HoraFin` (numéricos). El tipo
> (`NORMAL`, `CONTINUO`, `EXTENDIDO`) explica si el horario es continuo.

---

## 4. Del municipio del pedido a la oficina

### 4.1 Qué tiene LucidSales

El pedido trae **ids propios de LucidSales**, no nombres:

```json
"Pais": 47, "Departamento": 2, "Ciudad": 71
```

Tres endpoints **públicos** de LucidSales traducen esos ids (ya documentados
en `lucidsales_api_doc.md` §5):

```
GET /tools/getCountries               → { ok, countries: [{id:47, name:"Colombia", …}] }
GET /tools/getCountryState?country=47 → { ok, states: [{id:2, name:"Antioquia"}, …] }   (33)
GET /tools/getStateCity?state=2       → { ok, cities: [{id:71, name:"…"}, …] }
```

### 4.2 Algoritmo de emparejamiento

```text
pedido.Departamento ──► getCountryState(country=47) ──► "Antioquia"
pedido.Ciudad       ──► getStateCity(state=2)       ──► "Medellín"

normalizar(ambos): mayúsculas, sin tildes, sin puntuación, espacios simples

1) match exacto  norm(nombre)          → desempatar por norm(departamento)
2) match difuso  empieza-contiene (≥4) → desempatar por norm(departamento)
3) SIN match     → usar la CABECERA del departamento
                   (IdCiudad terminado en "001000": Medellín 05001000)
```

El desempate por departamento es **obligatorio**: sin él, `Altamira`
(Antioquia) cae en `ALTAMIRA HUILA`, `San Pedro` (Bolívar) en otro homónimo.

### 4.3 Cobertura medida (2026-10-04)

Se compararon los **1749 municipios/localidades de LucidSales** (33
departamentos) contra los 1117 de Inter:

| Resultado | Cantidad |
|-----------|----------|
| Coincidencia exacta | 973 |
| Coincidencia difusa | 353 |
| Sin coincidencia | 423 |
| **Cobertura global** | **75,8 %** |

- **Las 4 capitales que "fallan" con match exacto** (`CARTAGENA`, `ARMENIA`,
  `FLORENCIA`, `SAN ANDRES`) **sí se resuelven con el paso difuso**, porque
  Inter les agrega el departamento: `CARTAGENA BOLIVAR`, `ARMENIA QUINDIO`,
  `FLORENCIA CAQUETA`, `SAN ANDRES ARCHIPIELAGO…`.
- Los ~423 fallos son en su mayoría **veredas y corregimientos** que Inter no
  maneja como municipio (`Bolombolo`, `Currulao`, `El Doce`, `Santa Elena`,
  `Cano Limon`…). Ahí aplica el **fallback 3** (cabecera del departamento).
- 31 de 35 capitales probadas resuelven con match exacto.

---

## 5. Ejemplos de llamada

```bash
# 1) municipios
curl -s "https://www3.interrapidisimo.com/Apicanalesventa/api/Ciudad_CV/ObtenerCiudades" | head -c 300

# 2) oficina principal de Medellín (05001000)
curl -s "https://www3.interrapidisimo.com/Apicanalesventa/api/CentroServicio_CV/ObtenerOficinaPrincipalCiudad?idCiudad=05001000"

# 3) todas las oficinas de Medellín con horarios
curl -s -X POST "https://www3.interrapidisimo.com/Apicanalesventa/api/CentroServicio_CV/ObtenerCentrosServicioHorarios?lat=6.25&lng=-75.56&idCiudad=05001000" \
  -H "content-type: application/json" -d '[]'
```

Desde el navegador (CORS abierto):

```js
const ciudades = await fetch("https://www3.interrapidisimo.com/Apicanalesventa/api/Ciudad_CV/ObtenerCiudades").then(r => r.json());
const oficinas = await fetch(
  "https://www3.interrapidisimo.com/Apicanalesventa/api/CentroServicio_CV/ObtenerCentrosServicioHorarios?lat=6.25&lng=-75.56&idCiudad=05001000",
  { method: "POST", headers: { "content-type": "application/json" }, body: "[]" },
).then(r => r.json());
```

Link de mapa: `https://www.google.com/maps/search/?api=1&query=<Latitud>,<Longitud>`

---

## 6. Advertencias

1. **Sin caché del lado de ellos** (`no-store`): descarga el catálogo de
   ciudades **una vez y guárdalo** (memoria/localStorage, 24 h).
2. `Distancia` depende de `lat`/`lng`; si no tienes coordenadas, manda las de
   la cabecera de la ciudad o ignora ese campo.
3. **No uses su key de Google Maps**: el bundle del sitio expone una
   (`AIzaSyCIs8QrZvf-DXGWZLDMdpN9y__9BtNeEzE`, restringida a su dominio).
4. El sitio **no documenta** su API (no hay Swagger); el endpoint
   `Apicanalesventa` es interno. Puede cambiar sin aviso → **envuelve las
   llamadas con manejo de error y caché**.
5. No se detectó límite de peticiones en las pruebas, pero al ser un servicio
   de terceros conviene cachear y no refrescar por pedido.
6. Los campos `Recaudo`, `Transacciones`, `ReclamaOficina` varían por oficina;
   úsalos para filtrar (p. ej. solo `ReclamaOficina: true` si el pedido se
   reclama allí).
7. **`ObtenerCentrosServicioHorarios` devuelve `[]` esporádicamente** aunque
   las oficinas existan (medido 2026-10-04: Cartagena, 5 veces seguidas por la
   tarde; a la mañana devolvió 20) y **tarda 13-25 s** siempre. No interpretes
   `[]` como "no hay oficinas": reintenta, cachea poco lo vacío y apóyate en
   `ObtenerOficinaPrincipalCiudad`.

---

## 7. Integración implementada

**Decisión**: el emparejamiento y la caché viven en **nuestro backend**
(`server/`) y el panel solo consume un endpoint. Cualquier otra app nuestra
(bots, ERP, automatizaciones) puede usar el mismo servicio.

### 7.1 Endpoints en `server/`

```
GET /api/interrapidisimo/oficina       la oficina principal del municipio
     ?municipio=71&departamento=2&pais=47   ids de LucidSales (lo que usa el panel)
     ?municipio=Medellin&departamento=Antioquia
     ?idCiudad=05001000                     id de Inter directo
     ?departamento=Antioquia                => oficina de la cabecera
     &reintentar=1                          borra el ultimo fallo y relanza la tarea lenta

GET /api/interrapidisimo/oficinas      TODAS las oficinas del municipio
     (mismos parametros que /oficina)

GET /api/interrapidisimo/municipios?buscar=cartag&limite=20   buscador del catálogo
```

- **Sin autenticación** (dato público) y sin credenciales: funciona aunque el
  backend no tenga `LUCID_EMAIL`/`API_KEY`.
- `consultado.coincidencia`: `exacta` | `difusa` | `cabecera` | `directa` |
  `ninguna`; `listado`/`depListado` muestran como lo llama Inter.
- `/oficina` → `oficina`, `horarios`, `bodega`, `diaActual`, `totalOficinas`.
- `/oficinas` → `oficinas[]` (con `horarios` de la semana y `horarioHoy`),
  `total`, `enInter`, `diaActual`, `bodega`, `origen`
  (`listado` | `principal` | `vacio`); las oficinas salen **ordenadas de más
  cercana a más lejana** (`distancia` en km).
- **`pendiente`**: `"horarios"` u `"oficina"` en `/oficina`, `"listado"` en
  `/oficinas`, mientras corre en segundo plano (el cliente vuelve a consultar)
  · `null` cuando ya está todo.
- **`aviso`**: algo lento falló pero la respuesta se arma igual; no se
  reintenta solo durante 5 min (usar `reintentar=1`).
- Errores: `400` sin municipio o ids inválidos · `502` Inter rechazó ·
  `504` timeout · siempre `{ ok: false, msg }`.

### 7.2 Por qué el esquema rápido / segundo plano

Tiempos medidos el 2026-10-04 contra su API:

| Llamada | Tiempo |
|---------|--------|
| `DiaSemana_CV/ObtenerDiaSemanaActual` | 0,05–0,1 s |
| `CentroServicio_CV/ObtenerBodegaPrincipalPorCiudad` | 0,1–0,5 s |
| `CentroServicio_CV/ObtenerOficinaPrincipalCiudad` | 1,2–4,5 s |
| `Ciudad_CV/ObtenerCiudades` (366 KB, primera vez) | ~1–3 s |
| **`POST CentroServicio_CV/ObtenerCentrosServicioHorarios`** | **13,5–25 s** (constante, con o sin `lat`/`lng`, con o sin filtro) |

Por eso el `POST` **no bloquea la respuesta**: se lanza una sola tarea por
municipio (`TIMEOUT_INTER_LENTO_MS`, 45 s por defecto) y se cachea 1 h. El
panel reconsulta con backoff **4/9/18/30 s** en `/oficina` y
**4/6/9/13/18/25/35 s** en `/oficinas` mientras haya `pendiente`.

Además, `ObtenerOficinaPrincipalCiudad` devuelve `[]` en ciudades importantes
(comprobado con **Cartagena** y **Barranquilla**) y el listado a veces sale
**vacío** aunque las oficinas existan (§2.3). Por eso `oficinasPorListado()`
sigue una escalera:

1. `POST ObtenerCentrosServicioHorarios?lat=&lng=&idCiudad=` con las
   coordenadas de referencia (oficina principal → bodega → centro del país, así
   `Distancia` sirve para ordenar de más cercana a más lejana).
2. Si sale `[]`, **espera 1,5 s y lo repite una vez**.
3. Si sigue vacío, respaldo con la oficina principal (GET rápido) →
   `origen: "principal"` + `aviso`.
4. Si no hay nada → `origen: "vacio"` + `aviso` y caché de **60 s** (para que
   *Reintentar* sirva pronto).

### 7.3 Caché

| Qué | TTL | Dónde |
|-----|-----|-------|
| `ObtenerCiudades` | 24 h | memoria del backend (`interrapidisimo.js`) |
| Geografía LucidSales (`getCountryState`/`getStateCity`) | 24 h | memoria |
| Oficina principal, bodega, horarios, listado por municipio | 1 h | memoria |
| Listado que vino **vacío** (para poder repetir pronto) | 60 s | memoria |
| `ObtenerDiaSemanaActual` | 5 min | memoria |
| Fallo reciente (no reintenta solo) | 5 min | memoria |

### 7.4 Tarjeta en el panel

`panel/src/components/OficinaInter.tsx`, montada en
`panel/src/pages/PedidoDetallePage.tsx` justo debajo de Cliente/Estado.

**No consulta nada hasta que se pulsa “Buscar oficinas de Inter”** (el listado
no hace falta en todos los pedidos): mientras tanto solo se ve el título, una
nota y el botón. Se oculta del todo si el pedido no tiene departamento o si
`Pais ≠ 47`; si la transportadora contiene “interrap” se marca *Transportadora
del pedido*.

Al pulsarlo:

1. Llama a `/api/interrapidisimo/oficinas` con los ids del pedido y, mientras
   `pendiente: "listado"`, muestra “Descargando las oficinas…” y reconsulta con
   backoff (4 / 6 / 9 / 13 / 18 / 25 / 35 s).
2. Pinta el listado: nombre + tipo (`PTO`/`AGE`/`COL`), dirección · barrio,
   teléfonos (fijos, móviles y 01800 formateados a mano; `lib/format#telefono`
   asume `+57`), “Ver en el mapa” (`google.com/maps/search?query=lat,lng`),
   **Hoy hh:mm–hh:mm** y un desplegable con los horarios de la semana. Badge
   con la distancia y recuento “N oficinas en {municipio}” (con filtro de texto
   si hay más de 6).
3. **Usar esta dirección** → el campo `Direccion` del pedido pasa a
   `Oficina Interrapidisimo - <dirección de la oficina>` (queda como cambio
   pendiente de guardar) y sale un toast; la fila se resalta con el badge
   *Dirección en el pedido* y su botón se desactiva.

Estados: nota *difusa/cabecera* (banner azul), `aviso` (banner ámbar +
*Reintentar*), `msg` (texto muted), error de red/backend (banner rojo +
*Reintentar*) y `400` = ids geográficos del pedido, explicado en tono muted
(no es un fallo del sistema). Al pie: **Actualizar** (`reintentar=1`) y
**Ocultar** (vuelve a dejar la tarjeta en reposo).

No necesita `x-api-key`; si el backend no responde muestra el error y
*Reintentar* (no hay respaldo directo contra Inter a propósito: una sola
fuente de verdad y una sola caché).

### 7.5 Pruebas

`cd server && npm test` → **36 pruebas**, contra un **Inter falso**:

- `/oficina`: emparejamiento exacto/difusa/cabecera, ids de LucidSales,
  municipio sin oficina principal (listado en 2 consultas), `pendiente` →
  siguiente consulta, caché del catálogo, fallo de horarios con `aviso` +
  `reintentar=1`, caída total (`502`) y búsqueda en `/municipios`.
- `/oficinas`: `pendiente: "listado"` → lista, caché del `POST` lento,
  `reintentar=1`, municipio no catalogado, `400` sin parámetros, endpoint
  público, respaldo por oficina principal cuando el listado sale vacío, e
  Inter caído (responde `aviso` y `reintentar=1` lo relanza).

En el panel, `harness/run.cjs` con `OFICINA=1` comprueba 16 checks de la
tarjeta (no consulta sola, botón, listado, horarios, mapa, reemplazo de la
dirección, toast) más los estados `MOCK_INTER=error|pendiente|aviso|400`.

### 7.6 Código

```
server/interrapidisimo.js   cliente + matching + caché + tareas en segundo plano
server/servidor.js          rutas /api/interrapidisimo/*
server/config.js            INTER_BASE, TIMEOUT_INTER_LENTO_MS
server/test/api.test.js     Inter falso + geografía de LucidSales falso
panel/src/api/endpoints.ts  oficinaInter() y oficinasInter()
panel/src/components/OficinaInter.tsx   la tarjeta (busqueda + listado + seleccion)
```
