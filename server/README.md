# ZuntoStore API (backend propio)

Backend de la plataforma para **cambiar el estado de un pedido** sin que el
navegador tenga que armar el cuerpo del `update` de LucidSales, y para que
otras apps nuestras (bot, ERP, automatizaciones) puedan hacerlo tambien.

- Node 20+ **sin dependencias** (solo `node:http`, `fetch` nativo).
- Documentacion completa de la API que consume: `../lucidsales_api_doc.md`
  (seccion **16** = este servicio).

## Arrancar

```bash
cp .env.example .env    # ver tabla de variables
npm start               # http://localhost:8787
npm run dev             # igual, con recarga (node --watch)
npm test                # 132 pruebas contra LucidSales e Inter falsos
```

Desde el panel tambien puedes usar `npm run api`.

## Variables (`.env`)

| Variable | Obligatoria | Descripcion |
|----------|-------------|-------------|
| `PORT` | no | Puerto HTTP (defecto `8787`) |
| `API_KEY` | no | Solo integraciones servidor-a-servidor (cabecera `x-api-key`). El panel entra con la sesión de LucidSales |
| `LUCID_EMAIL` / `LUCID_PASSWORD` | **si** | Cuenta de servicio contra LucidSales |
| `LUCID_TIENDA` | no | Tienda por defecto; si esta vacia se usa la primera de la cuenta |
| `LUCID_BASE` | no | `https://panel.lucidsales.co/b` (sin barra final) |
| `CORS_ORIGIN` | no | Origen permitido (defecto `*`; es una API interna con API key) |
| `HISTORIAL` | no | Ruta del registro JSONL (defecto `server/historial.jsonl`) |
| `CONVERSACION` | no | JSONL con el chat de cada pedido (lo manda el bot, lo lee el agente) |
| `SUBIDA_AUTO` | no | JSON de config + registro de la subida automatica a Dropi |
| `ASIGNACION` | no | Ruta del JSON de horarios y asignaciones (defecto `server/asignacion.json`) |
| `TZ_ASIGNACION` | no | Zona con la que se evaluan los horarios (defecto `America/Bogota`) |
| `REPARTO_AUTOMATICO` | no | Semilla del interruptor de reparto automatico (`1`/`true` = encendido) |
| `REPARTO_CADA` | no | Cada cuantos segundos mira pedidos nuevos (10..3600, defecto `60`) |
| `CREDENCIALES` | no | JSON con las credenciales que guarda el panel (defecto `server/credenciales.json`) |
| `ANUNCIOS_CONFIG` | no | JSON de la app de Meta para rentabilidad: `appId`/`appSecret`, `version`, TRM por defecto (defecto `server/config/anuncios.json`) |
| `ANUNCIOS_DIR` | no | Carpeta de datos de rentabilidad: `usuarios/<email>/` de cada usuario (defecto `server/anuncios/`) |
| `TIMEOUT_MS` | no | Timeout por llamada a LucidSales (defecto `15000`) |
| `INTER_BASE` | no | API de Inter Rapidísimo (defecto `https://www3.interrapidisimo.com/Apicanalesventa/api`) |
| `TIMEOUT_INTER_LENTO_MS` | no | Timeout de las consultas lentas a Inter: listado y horarios (defecto `45000`) |
| `LLM_API_KEY` | no | Clave del LLM que lee el chat (agente de Dropi). Sin ella el agente frena |
| `LLM_BASE` | no | Base OpenAI-compatible (defecto `https://api.openai.com/v1`) |
| `LLM_MODELO` | no | Modelo del LLM (defecto `gpt-5-mini`) |
| `LLM_TIMEOUT_MS` | no | Timeout del LLM (defecto `30000`) |
| `DROPI_PERFIL` | no | Carpeta del perfil de Chrome con la sesion de Dropi (defecto `server/.dropi-perfil`) |
| `DROPI_CHROME` | no | Ruta de Chrome (defecto `C:\Program Files\Google\Chrome\Application\chrome.exe`) |
| `DROPI_HEADLESS` | no | `1` para correr el navegador sin ventana (defecto `0`) |
| `DROPI_NAVEGADOR_MS` | no | Timeout por paso del navegador (defecto `30000`) |
| `DROPI_PRODUCTOS_CSV` | no | Google Sheets (CSV) con el mapa `idProductoDropi -> dropiLink` |

El servidor **arranca igual** si faltan credenciales: `/api/salud` reporta
`listo: false` con el detalle en `faltantes`, y los cambios devuelven `503`.

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| `GET` | `/api/salud` | - | `listo`, `faltantes`, `upstream` |
| `POST` | `/api/pedidos/:id/estado` | `x-api-key` | Cambia el estado |
| `POST` | `/api/pedidos/:id/conversacion` | `x-api-key` | Guarda una conversación local (compatibilidad anterior) |
| `GET` | `/api/pedidos/:id/conversacion` | `x-api-key` | Trae la conversación actual desde el campo de LucidBot; usa el registro local como alternativa |
| `POST` | `/api/pedidos/:id/validar` | `x-api-key` | Agente: valida el chat y dice `subir`/`frenar` (no sube) |
| `POST` | `/api/pedidos/:id/subir` | `x-api-key` | Valida y sube a Dropi por navegador (`{via:"navegador"}`) |
| `GET` | `/api/subida` | `x-api-key` | Estado de la subida automatica a Dropi |
| `PUT` | `/api/subida/config` | `x-api-key` | Enciende/apaga y configura la subida automatica |
| `GET` / `PUT` | `/api/lucidbot/config` | `x-api-key` | Configura token X-ACCESS-TOKEN, ID del campo con la conversación y avisos de resultado de Dropi |
| `POST` | `/api/subida/probar` | `x-api-key` | Ejecuta una vuelta de subida ahora mismo |
| `GET` | `/api/historial?limite=50` | `x-api-key` | Ultimos cambios |
| `GET` | `/api/interrapidisimo/oficina` | - | Oficina de Inter por municipio |
| `GET` | `/api/interrapidisimo/oficinas` | - | **Todas** las oficinas del municipio |
| `GET` | `/api/interrapidisimo/municipios` | - | Buscador del catalogo de Inter |
| `GET` | `/api/asignacion?idEmpresa=` | `x-api-key` | Horarios + asignaciones + quien esta en turno |
| `PUT` | `/api/asignacion/horario` | `x-api-key` | Guardar/borrar el horario de un usuario |
| `PUT` | `/api/asignacion/config` | `x-api-key` | Enciende/apaga el reparto automatico |
| `POST` | `/api/asignacion/probar` | `x-api-key` | Ejecuta una vuelta ahora mismo |
| `GET` | `/api/credenciales` | `x-api-key` | Si hay credenciales (correo enmascarado) |
| `PUT` | `/api/credenciales` | `x-api-key` | Guarda correo/contraseña **sin reiniciar** |
| `DELETE` | `/api/credenciales` | `x-api-key` | Las borra |
| `POST` | `/api/asignacion/repartir` | `x-api-key` | Reparte pedidos **equitativamente** |
| `DELETE` | `/api/asignacion/pedido/:id` | `x-api-key` | Desasigna un pedido |
| `POST` | `/api/asignacion/limpiar` | `x-api-key` | Borra las asignaciones de una tienda |
| `GET` | `/api/anuncios?dias=7\|15\|30` | `x-api-key` | Rentabilidad de las campanas de Meta |
| `POST` | `/api/anuncios/actualizar` | `x-api-key` | Vuelve a bajar los datos de Meta |
| `POST` | `/api/anuncios/ganancia` | `x-api-key` | `{nombre, ganancia}` y recalcula |
| `GET` | `/api/anuncios/plan` | `x-api-key` | Plan de acciones marcadas |
| `POST` | `/api/anuncios/plan` | `x-api-key` | `{id, hecho?, nota?}` |
| `GET` | `/api/anuncios/csv?dias=&vista=` | `x-api-key` | CSV (`campanas` \| `alertas` \| `productos`) |
| `GET` | `/api/anuncios/ganancias` | `x-api-key` | Ajustes, progreso y ultimo traído de pedidos |
| `POST` | `/api/anuncios/ganancias` | `x-api-key` | `{dias?, forzar?, esperar?}` trae las ganancias de los pedidos |
| `POST` | `/api/anuncios/ganancias/ajustes` | `x-api-key` | `{auto?, minPedidos?, tienda?, dias?}` |
| `GET` | `/api/anuncios/cuenta` | `x-api-key` | Estado de la cuenta Meta del usuario (`x-usuario`) |
| `POST` | `/api/anuncios/conectar` | `x-api-key` | `{token}`: valida contra `/me` y lista `/me/adaccounts` |
| `POST` | `/api/anuncios/cuentas` | `x-api-key` | `{cuentas[], trm?}`: que cuentas entran al analisis |
| `POST` | `/api/anuncios/desconectar` | `x-api-key` | `{borrar?}`: quita el token (y sus datos) |

### Horarios y reparto equitativo

Los horarios de los usuarios y que pedido le toca a cada uno viven en un JSON
(`ASIGNACION`, `server/asignacion.json`): se lee una vez, se mantiene en
memoria y se vuelveca entero al disco (temporal + rename).

```json
{
  "horarios": {
    "ana@demo.com": { "nombre": "Ana", "activo": true,
                      "dias": [1,2,3,4,5], "desde": "08:00", "hasta": "17:00" }
  },
  "asignaciones": {
    "3256175": { "usuario": "ana@demo.com", "nombre": "Ana", "idEmpresa": 3682, "ts": "..." }
  }
}
```

* Dias: **1 = lunes ... 7 = domingo**; la hora se calcula con `Intl` en
  `TZ_ASIGNACION` (defecto Bogota), no en la zona del proceso.
* **Equitativo**: cada pedido va al usuario con **menos asignaciones** (las que
  ya tiene cuentan), desempate por nombre para que el orden sea estable.
* `POST /api/asignacion/repartir`:

```json
{ "idEmpresa": 3682, "modo": "todos", "reasignar": false,
  "usuarios": [{"usuario": "ana@demo.com", "nombre": "Ana"}],
  "pedidos": [3256175, 3256176] }
```

`modo:"horario"` reparte solo entre los que estan **en turno** (409 si no hay
nadie); los ya asignados se omiten salvo `reasignar:true`. Respuesta:
`{ok, reparto[], omitidos[], totales{usuario:n}, ahora}`.

En el panel: columna **Horario** en Ajustes -> Usuarios, y columna
**Asignado** + boton **«Asignar pedidos»** en la lista de Pedidos.

**Reparto automatico.** Con `config.automatico` encendido, el proceso despierta
cada `cadaSegundos`, baja los pedidos recientes de las `tiendas` marcadas (vacias
=> `LUCID_TIENDA`) con los `estados` indicados (defecto `[0]` = Por confirmar),
filtra los que ya tienen dueno y los reparte con la misma regla equitativa.
Nunca reasigna, y un fallo no rompe el intervalo: queda en `ultimo`.

```json
PUT /api/asignacion/config
{ "automatico": true, "cadaSegundos": 60, "modo": "horario",
  "tiendas": ["3682"], "estados": [0], "usuarios": ["ana@demo.com"] }
```

`usuarios` es la lista de los que estan **dentro** (los demas quedan fuera);
sin lista (`null`) participan todos los activos y con `[]` nadie (el reparto
responde 400 diciendolo). Los inactivos nunca reciben pedidos.

La semilla viene de `REPARTO_AUTOMATICO` y `REPARTO_CADA` del `.env`; a partir
de ahi manda lo guardado en el JSON (lo que cambia el panel). Para probarlo sin
esperar: `POST /api/asignacion/probar` ejecuta una vuelta **aunque este
apagado** y devuelve `{resultado: {repartidos, omitidos, porTienda}, ultimo}`.

**Credenciales sin tocar el `.env`.** El admin puede dar de alta la cuenta de
servicio desde el panel (Ajustes -> Usuarios -> «Conexión del backend con
LucidSales»): `PUT /api/credenciales {email, password}` valida el formato,
escribe `server/credenciales.json` (permisos 600, en el `.gitignore`), lo pega
en memoria en `config` (inmediato, **sin reiniciar**) y olvida los tokens del
cliente. El `GET` solo devuelve el correo enmascarado (`s******o@dominio`), la
contraseña **nunca sale del servidor**. Si el archivo ya existe al arrancar
manda sobre el `.env`; `DELETE /api/credenciales` lo borra y vuelve a valer lo
del `.env`.

### Cambiar estado

```bash
curl -X POST http://localhost:8787/api/pedidos/3256175/estado \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"estado":2,"motivo":""}'
```

- `estado`: entero **0..9** (0 Por confirmar … 9 Novedad Solucionada).
- `motivo`: obligatorio cuando `estado` es **1 (Cancelado)**, max. 400 car.
- Si el pedido ya esta en ese estado responde `sinCambios: true` sin tocar
  LucidSales.

Respuesta:

```json
{ "ok": true, "id": 3256175, "idPedido": 6106, "idEmpresa": 3682,
  "estadoAnterior": 0, "estadoNuevo": 2, "nombreEstado": "Confirmado",
  "msg": "Pedido actualizado", "sinCambios": false }
```

Errores: `400` validacion · `401` API key · `404` pedido inexistente ·
`413` cuerpo grande · `502` LucidSales rechazo · `503` sin configurar ·
`504` timeout. Siempre `{ "ok": false, "msg": "..." }`.

### Estado del envio desde Lucid Bot

Si el pedido se sube a Dropi por fuera de LucidSales, LucidSales se queda en
"Sin Envio"; Lucid Bot si recibe el estado de la guia. Un flujo de Lucid Bot
con **Solicitud externa** lo manda aqui y el panel lo muestra (lista y detalle,
con la marca «Lucid Bot») en los pedidos que LucidSales tiene "Sin Envio".

```bash
curl -X POST https://TU-DOMINIO/api/envios/estado \
  -H "content-type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"telefono":"+573001234567","estado":"EN REPARTO","guia":"240012345678",
       "transportadora":"COORDINADORA","pedido":"6106","novedad":""}'
```

- Obligatorios: `estado` y uno de `telefono`, `guia` o `pedido` (numero o id
  de LucidSales). Tambien acepta `status`, `phone`, `numero_guia`, `carrier`...
  Una variable vacia de Lucid Bot (`{{guia}}`) se ignora.
- A cada pedido le toca el ultimo aviso del mismo pedido; si no, de la misma
  guia; si no, del mismo telefono recibido despues de crear el pedido.
- Solo con `x-api-key` (un usuario del panel no puede inventar estados).
- `POST /api/envios/consultar {pedidos:[{id,idPedido,telefono,fecha}]}` (panel)
  y `GET /api/envios/ultimos` (admin) para revisar que esten llegando.
- Se guarda en `ENVIOS` (`/data/envios.json` en Railway).

### Historial

```bash
curl http://localhost:8787/api/historial?limite=20 -H "x-api-key: $API_KEY"
```

Cada cambio es una linea en `historial.jsonl`:

```json
{"ts":"2026-10-03T18:20:11.482Z","id":3256175,"idPedido":6106,"idEmpresa":3682,"de":0,"a":2,"motivo":null,"origen":"panel","usuario":"Alberto Castano","sinCambios":false,"ok":true}
```

`origen` sale de la cabecera `x-origen` (el panel manda `panel`; las apps
externas pueden mandar la suya o dejarla en `api`) y `usuario` de `x-usuario`.

### Oficina de Inter Rapidísimo

Información **pública** (sin `x-api-key`, sin credenciales) del punto de
servicio de Inter según el municipio del pedido. Detalle completo del API de
terceros en `../interrapidisimo_api_doc.md`.

```bash
# con los ids de LucidSales que ya trae el pedido (lo que usa el panel)
curl "http://localhost:8787/api/interrapidisimo/oficina?municipio=71&departamento=2"

# con nombres (resuelve homónimos: Cartagena -> CARTAGENA BOLIVAR)
curl "http://localhost:8787/api/interrapidisimo/oficina?municipio=Cartagena&departamento=Bolivar"

# id de Inter directo, o solo departamento (=> oficina de la cabecera)
curl "http://localhost:8787/api/interrapidisimo/oficina?idCiudad=05001000"
curl "http://localhost:8787/api/interrapidisimo/oficina?departamento=Antioquia"

# catalogo de municipios (para depurar por que un pueblo no coincide)
curl "http://localhost:8787/api/interrapidisimo/municipios?buscar=cartag"
```

Respuesta:

```json
{ "ok": true,
  "consultado": { "origen": "ids lucidsales", "municipio": "Medellin",
                  "departamento": "Antioquia", "idCiudad": "05001000",
                  "coincidencia": "exacta", "listado": "MEDELLIN" },
  "oficina": { "id": 4777, "nombre": "PTO/MEDELLIN/ANT/COL/CL 30 A 65 B 59 R.O",
               "direccion": "CL 30 A 65 B 59 R.O", "barrio": "BELEN ROSALES",
               "telefono1": "3232554455", "lat": 6.23341798, "lng": -75.5840966,
               "reclamaOficina": true, "recibeGiros": true, "pagaGiros": true,
               "pesoMaximo": 80 },
  "horarios": [ { "idDia": 6, "dia": "SABADO",
                  "franjas": [ { "tipo": "CONTINUO", "inicio": "06:00", "fin": "18:00" } ] } ],
  "bodega": { "nombre": "COL/MEDELLIN/...", "direccion": "..." },
  "diaActual": { "id": 6, "nombre": "SABADO" },
  "totalOficinas": null, "pendiente": "horarios" }
```

**Por que `pendiente`**: Inter responde rápido en los `GET` (oficina ~2 s,
bodega ~0,5 s) pero su `POST` de horarios tarda **13-25 s medidos**, y ciudades
como Cartagena o Barranquilla ni siquiera devuelven "oficina principal" (hay
que bajar el listado completo). El backend devuelve lo rápido de inmediato y
lanza lo lento **en segundo plano** (una sola tarea por municipio, cacheada 1 h):

| `pendiente` | Significado | El cliente... |
|-------------|-------------|---------------|
| `"horarios"` | el POST todavía corre | vuelve a consultar (el panel lo hace con backoff 4 s / 9 s / 18 s / 30 s) |
| `"oficina"` | buscan el listado del municipio | idem |
| `null` | todo listo (o ya hubo fallo) | no hace falta reconsultar |

Si lo lento **falla**, la oficina se responde igual con `aviso` (p. ej.
`"Sin horarios: ..."`); no se reintenta solo durante 5 min, pero
`?reintentar=1` borra ese fallo y relanza la tarea (botón *Reintentar* del
panel). Errores de verdad: `400` sin municipio / ids invalidos ·
`502` Inter rechazo · `504` timeout · siempre `{ "ok": false, "msg": "..." }`.

**Emparejamiento municipio -> oficina** (cobertura medida: 75,8 % exacta +
difusa sobre las 1749 localidades de LucidSales): nombre exacto, luego
coincidencia parcial con desempate por departamento (Inter desambigua homónimos
como `CARTAGENA BOLIVAR`), y si no, **cabecera del departamento** (`IdCiudad`
terminado en `001000`). Los registros con nombre vacío del catálogo se ignoran.
`consultado.coincidencia` explica cual de los tres casos se uso
(`exacta` / `difusa` / `cabecera` / `ninguna`).

### Todas las oficinas del municipio

Mismos parametros que `/oficina` (`municipio`+`departamento` en ids o texto,
`idCiudad`, `pais`, `reintentar`), misma ausencia de `x-api-key`. Devuelve el
listado completo para que el panel pueda **elegir una oficina y usar su
direccion**:

```bash
curl "http://localhost:8787/api/interrapidisimo/oficinas?municipio=Medellin&departamento=Antioquia"
```

```json
{ "ok": true,
  "consultado": { "origen": "nombres", "municipio": "Medellin", "idCiudad": "05001000",
                  "coincidencia": "exacta", "listado": "MEDELLIN" },
  "idCiudad": "05001000", "origen": "listado",
  "oficinas": [ { "id": 6241, "nombre": "PTO/MEDELLIN/ANT/COL/CLL 45 53 50",
                  "direccion": "CLL 45 53 50", "barrio": "CENTRO",
                  "telefono1": "3104968811", "lat": 6.2467, "lng": -75.5725,
                  "distancia": 2, "reclamaOficina": true, "recibeGiros": true,
                  "horarios": [ { "idDia": 1, "dia": "LUNES",
                                  "franjas": [ { "tipo": "NORMAL", "inicio": "08:00", "fin": "18:00" } ] } ],
                  "horarioHoy": [ { "tipo": "CONTINUO", "inicio": "06:00", "fin": "18:00" } ] } ],
  "total": 4, "enInter": 4,
  "diaActual": { "id": 7, "nombre": "DOMINGO" },
  "bodega": { "direccion": "OF. PRINC CL 30 A 65 B 59" },
  "pendiente": null }
```

- Las oficinas salen **ordenadas de mas cercana a mas lejana** (`distancia`, en
  km, calculada contra la oficina principal / bodega / centro del pais).
- `horarios` trae la semana de cada oficina; `horarioHoy` solo las franjas de
  hoy para no inflar la respuesta.
- `origen`: `listado` (Inter devolvio el municipio) · `principal` (el listado
  vino vacio y se uso la oficina principal como respaldo, con `aviso`) ·
  `vacio` (Inter no devolvio nada, tambien con `aviso`).

**Flujo**: igual que `/oficina`, lo lento va detras. La primera consulta
responde en ~2-3 s con `pendiente: "listado"` y lanza el `POST` de Inter
(**13-25 s**); si sale vacio lo reintenta una vez, y si aun asi sale vacio
apoya en la oficina principal. El listado cachea **1 h**; si vino vacio solo
**60 s** (asi *Reintentar* sirve pronto). El panel reconsulta con backoff
4 / 6 / 9 / 13 / 18 / 25 / 35 s mientras `pendiente` siga en `"listado"`.

Errores: `400` sin municipio / `idCiudad` invalido · `502` Inter rechazo ·
`504` timeout · `{ "ok": false, "msg": "..." }` siempre.

### Validador de direcciones (propio)

`POST /api/pedidos/:id/direccion/validar {direccion?}` (permiso Pedidos):

1. **Formato** con reglas fijas (`direccionColombia.js`): via, manzana,
   oficinas de transportadora, rural / sin nomenclatura. Si el numero viene
   pegado (`Cra 21 #1212`) se prueban candidatos (`# 12-12`) y solo vale el
   que Google confirma.
2. **Mapa** (`validadorDireccion.js`): Google Geocoding con `country:CO` y la
   ciudad/departamento del pedido. `exacta` (placa ROOFTOP/interpolada),
   `aproximada` (solo calle/barrio o coincidencia parcial), `otra-ciudad`,
   `no-encontrada`. Cache en memoria para no repetir consultas.

Veredicto: `valida` | `revisar` | `invalida` | `oficina`, con `sugerida` (la
direccion bien escrita), `avisos` (p. ej. sin barrio) y link a Google Maps.
**Calificacion 0-100** (`calificar`): formato 40 + mapa hasta 50 (placa
exacta 50, calle 25, barrio 10; parcial -10) + barrio/referencia 10; en otra
ciudad maximo 10. La subida (automatica y manual) la mira como la
verificacion `direccionMapa`: por debajo de `minCalificacionDireccion` (70 por
defecto, 0 = apagado) el pedido queda `direccion-invalida` con la nota y el
motivo en el analisis. Si el mapa no se pudo consultar (sin key o error) no
frena. Fuera de las ciudades principales (`CIUDADES_PRINCIPALES`: capitales y
areas metropolitanas) Google casi no tiene placas: ahi solo suma la placa
exacta; lo demas (incluido ubicarla en otro municipio, que suele ser Google
adivinando) queda `sinCobertura` y se decide por el formato. Si Google confirma la placa, se sube con la direccion bien escrita.

`POST /api/pedidos/:id/direccion {direccion}` la guarda en LucidSales sin
tocar nada mas del pedido. API key: Ajustes (`/api/mapas/config`, se guarda
en `MAPAS_CONFIG`) o `GOOGLE_MAPS_KEY`. Sin key solo se revisa el formato.

### Google Sheets de productos

El link de Dropi de cada producto sale de un Google Sheets (columnas
`idProductoDropi` y `dropiLink`). Se configura en **Ajustes → Subida a
Dropi** pegando el link normal del sheet (`GET/PUT /api/dropi/productos`,
`POST /api/dropi/productos/probar`): el servidor lo convierte a CSV, lo prueba
y lo guarda en `DROPI_PRODUCTOS_CONFIG`; manda sobre `DROPI_PRODUCTOS_CSV` del
`.env`. Se relee cada 10 minutos.

### Subida a Dropi: envio

La direccion que se escribe en Dropi es **la direccion validada + ", " + las
Referencias del pedido** (ahi suelen venir el barrio y los puntos de
referencia), sin repetirlas si ya estan en la direccion
(`direccionConReferencias`). En entrega en oficina va solo la direccion.

Config en `SUBIDA_AUTO` (`PUT /api/subida/config`), la usan la subida
automatica y la manual:

- `cadaSegundos`: de 30 s a 12 h (43.200).
- `transportadoras`: orden de preferencia general (ids de Dropi: 5
  Coordinadora, 3 Interrapidisimo, 2 Envia, 4 Domina, 10 TCC...). Se usa la
  primera que este **disponible** para la ciudad y cuyo flete no pase el tope.
- `envio: {maxPesos, maxPorcentaje}`: tope del flete en pesos y/o en % del
  valor del pedido (Total de LucidSales). Si hay los dos, manda el menor.
- `reglasProducto: {"<id producto LucidSales>": {nombre, transportadoras[],
  maxPesos, maxPorcentaje}}`: lo que tenga la regla manda sobre lo general.
- `oficinaInter`: un pedido cuya direccion dice oficina de Interrapidisimo
  pasa por el flujo normal (chat + IA, sin validar calle; el chat tambien
  tiene que decir oficina) y se sube con Inter **solo si Dropi muestra UNA
  oficina** en `centro-servicio-interrapidisimo`; con varias o ninguna queda
  `requiere-humano`. Las de Coordinadora siempre van a mano.
- `detectarOficinaInter` (por defecto `true`): hay clientes que dan la
  direccion de una oficina de Inter **sin decir "oficina"**. Antes de subir se
  compara la direccion (tipo de via + numeros, sin importar como este escrita:
  "Calle 30A # 65B-59" = "CL 30 A 65 B 59 R.O") con las oficinas de Inter del
  municipio (`oficinasCompletas`, cache 1 h; la primera consulta por ciudad
  tarda 13-25 s). Si coincide -> Interrapidisimo eligiendo **esa** oficina en
  Dropi (si no aparece en la lista de Dropi, `requiere-humano`). Si no
  coincide -> transportadora normal (Coordinadora con seguro). Si Inter no
  responde, se sube normal.

El flete se lee de la tarjeta de cada transportadora en Crear Orden. Si todas
pasan el tope -> `envio-caro`; si ninguna esta disponible ->
`sin-transportadora`. Los dos son finales, se avisan por Lucid Bot y se
reintentan desde el panel. El seguro antidevoluciones es obligatorio con
Coordinadora; con otra transportadora se activa si Dropi lo ofrece. El
registro guarda la transportadora y el flete usados.

### Rentabilidad de anuncios (Meta Ads)

Modulo `anunciosMeta.js`: baja las campañas de las cuentas que **cada
usuario** conecta (Graph API de Meta, COP tal cual y USD con su TRM), las
cruza con el producto de cada una y estima la rentabilidad.

```
por compra = ganancia por pedido ENTREGADO x efectividad de entrega
margen     = compras (omni_purchase, sin duplicar) x por compra
neto       = margen - gasto        ROI = margen / gasto       CPA = gasto / compras
```

- **Efectividad de entrega** = entregados / (entregados + cancelados,
  devoluciones, rechazados, guias anuladas), de los estados de envio que
  trae el traedor de ganancias. Los que van en camino no cuentan; los que
  nunca se enviaron solo si `entrega.contarSinEnvio`. Se puede fijar a mano
  (`entrega.modo: "manual"`, `entrega.tasa`). Sin datos se supone 100% y sale
  un aviso. `GET|POST /api/anuncios/entrega`.
- Una campana de **varios productos** usa el promedio de sus ganancias y, en
  la vista por producto, reparte gasto y compras en partes iguales (la suma
  da el total, no el doble). Si alguno de sus productos no tiene ganancia, la
  campana queda **Sin dato**.
- Las campanas **archivadas o borradas** que gastaron en la ventana tambien
  cuentan (salen de los insights aunque ya no esten en `/campaigns`).
- Cuentas en una moneda que no sea COP ni USD quedan fuera con aviso.
- Fechas en hora de Colombia (`TZ_ANUNCIOS`, por defecto la de
  `TZ_ASIGNACION` o `America/Bogota`), no la del servidor.
- El gasto **sin dato** (campanas sin producto o sin ganancia) no entra en
  neto ni ROI y se informa aparte (`totales.gastoSinDato`).

Clasificacion: **Rentable** ROI >= 3x · **Ajustada** 1,5-3x · **Por vigilar**
< 1,5x con neto positivo · **Perdida** con neto negativo · **Sin dato** si la
campana no tiene producto vinculado o el producto no tiene ganancia.

- **Ajuste de la app** (`ANUNCIOS_CONFIG`, `server/config/anuncios.json`):
  `appId`/`appSecret` (para saber cuando vence cada token), `version` y la
  `trm` por defecto. Si tiene `token`/`cuentas`, solo los usan las
  integraciones sin usuario (x-api-key sin x-usuario), nunca el panel.
- **Datos** (`ANUNCIOS_DIR`, `server/anuncios/`): `datos_7d|15d|30d_FECHA.json`
  (cache del dia, `actualizar=1` lo salta), `productos.json` (ganancia
  promedio, editable desde el panel), `manual.json` (mapeo campana ->
  producto), `plan.json` (acciones marcadas) y `snapshot.json` (respaldo: si
  Meta no responde se sirve el ultimo corte y sale un aviso).
- **Un espacio por usuario** (`anunciosTenant.js`): el email de la sesion
  verificada del panel resuelve el espacio, en
  `server/anuncios/usuarios/<email>/` (`config.json` con su token, cuentas,
  TRM y ajustes; `productos.json`, `manual.json`, `plan.json` y sus caches).
  Quien no conecto su token **no ve datos de nadie** (`409`). Cada usuario
  configura lo suyo: conecta Meta y elige cuentas, importa los productos de
  su tienda activa (`POST /api/anuncios/productos/importar`), trae la
  ganancia de sus pedidos y vincula cada campana a su producto
  (`POST /api/anuncios/vincular {campana, productos[]}`; si el nombre se
  parece a un producto, el panel lo sugiere).
- **Migrar el espacio compartido de antes** a un usuario:
  `node migrarAnuncios.js correo@usuario.com` (copia productos, vinculos,
  plan y ganancias a su carpeta, le pasa el token y las cuentas, y deja el
  compartido solo con los datos de la app; guarda `anuncios.json.bak`).
- **Ganancias de los pedidos** (`POST /api/anuncios/ganancias`): por cada
  producto le pide a LucidSales su analitica (`/analitica/get-analytics-data`
  de la **tienda activa del panel**, con la **sesion de LucidSales del propio
  usuario** (no con las credenciales del servidor), sin ventana de comparacion porque la hace
  15 veces mas lenta y los numeros actuales salen iguales) y calcula

  ```
  promedio = utilidaData.gananciaEsperada
           / pedidos que tienen estado de envio (statusData)
         = ganancia NETA REAL por pedido, promediada en la ventana
  ```

  `gananciaEsperada` ya viene **descontando flete y costo del proveedor**
  (ej. Total 84.900 - flete 20.790,5 - costo 40.000 = 24.109,5), asi que el
  promedio es directamente el margen neto por pedido.

  **La muestra son los pedidos que traen ganancia**: Dropi calcula el flete y
  el costo del proveedor al entregar, asi que los demas (en transito, sin
  envio, cancelados, en novedad, devueltos) entran con ganancia 0 y, si se
  dividen entre ellos, hunden el promedio de los que si dejaron plata (en una
  ventana real, dividir entre TODOS los pedidos dejaba un producto de $18.177
  en $3.504). El desglose por estado viene en `statusData` de la misma
  llamada, no cuesta una llamada extra. Por defecto solo cuenta `ENTREGADO`
  (`ganancias.incluirEstados`) y se amplia desde el selector «¿Qué estados
  cuentan para el promedio?» del panel o a mano en el config. Si la respuesta
  no trae el desglose se reparte entre todos los pedidos, como siempre; si
  trae desglose pero no hubo ninguna entrega en la ventana no hay muestra y el
  promedio queda en 0.

  El resultado **no pisa nunca la ganancia escrita a mano**: solo rellena las
  que estan en 0 y cuando hay `ganancias.minPedidos` (20) pedidos o mas en la
  ventana. El promedio queda guardado por producto (`productos.json ->
  pedidos: {n, nTotal, estados, prom, ganancia, desde, hasta, fecha}`, donde
  `n` es la muestra (los pedidos con ganancia) y `nTotal` el total de la
  ventana) y sale en
  `GET /api/anuncios` como `pedidosProm` / `pedidosN` / `pedidosNTotal`, para
  que el panel lo muestre al lado («n=746 (de 834)») y se pueda adoptar con
  un clic. Dura uno o dos minutos (una llamada por producto) asi
  que corre **en segundo plano**: `POST` responde ya con `enCurso: true` y el
  panel sondea `GET /api/anuncios/ganancias` cada 2 s. Si casi toda la
  analitica falla no se guarda nada. Ajustes (`ganancias` en el config del
  espacio): `auto` (se recalcula solo una vez al dia cuando se piden datos,
  con corte de 10 min si fallo), `minPedidos`, `dias` (7|15|30) y
  `incluirEstados` (por defecto `["ENTREGADO"]`). El
  `GET /api/anuncios/ganancias` agrega ademas `estados`, el desglose
  agregado de todos los productos (`[{nombre, n, excluido}]`, ordenado por
  pedidos y con los que cuentan aunque no hayan aparecido, para poder
  apagarlos): es lo que el panel pinta como selector.
- **Conexion** (token pegado, sin OAuth): `POST /api/anuncios/conectar` valida
  el token con `/me`, baja `/me/adaccounts` (y `debug_token` con
  `appId|appSecret` para la fecha de vencimiento) y lo guarda en SU carpeta;
  despues `POST /api/anuncios/cuentas` elige que cuentas entran y la TRM.
  `POST /api/anuncios/desconectar` lo quita (`borrar: true` borra tambien sus
  datos). El flujo OAuth ("Conectar con Facebook") queda pendiente de que la
  app este en modo Produccion.
- **Pagina**: `/anuncios` en el panel (permiso `rentabilidad`, que usa el `4`
  de Metricas). Resumen con KPIs, alertas con casilla *Hecho*, tabla de
  campanas con filtros, productos con ganancia editable, cuentas y reporte
  imprimible (PDF) + CSV, mas el modal **Cuenta de Meta** (conectar / elegir
  cuentas / TRM / desconectar) y la lista de pasos que le faltan al usuario
  para que los numeros sean confiables.

## Como funciona por dentro

```
x-api-key  ->  validar estado/motivo  ->  login  ->  addShopId(tienda)
           ->  get-pedido-by-id/:id   ->  parchear EstadoPedido(+motivo)
           ->  pedidos/update         ->  historial.jsonl
```

- El token de `addShopId` se **cachea por tienda**; si el pedido pertenece a
  otra tienda se activa esa.
- Si alguna llamada responde **401**, se invalidan los tokens, se vuelve a
  loguear y se reintenta **una sola vez**.
- El cuerpo del `update` es una copia fiel de `panel/src/api/pedidoBody.ts`
  (el mismo que envia el panel oficial).
- Sin CORS complicado: `CORS_ORIGIN` (defecto `*`) + cabeceras en cada
  respuesta; `OPTIONS` respondido con `204`.

Las oficinas de Inter van por `interrapidisimo.js`:

```
municipio/departamento (ids o texto)
  -> /tools/getCountryState + /tools/getStateCity   (LucidSales, cache 24 h)
  -> Ciudad_CV/ObtenerCiudades                      (cache 24 h, 1117 registros)
  -> emparejar()  exacta | difusa | cabecera
  -> ObtenerOficinaPrincipalCiudad + bodega + dia   (cache 1 h, rapido)
  -> [segundo plano] ObtenerCentrosServicioHorarios (cache 1 h, lento)
```

Todo se cachea en memoria porque Inter responde `cache-control: no-store`.

## Como lo usa el panel

`panel/vite.config.ts` hace de proxy: `/api` -> `http://localhost:8787`.
`cambiarEstadoPedido()` en `panel/src/api/endpoints.ts` manda la sesión de
LucidSales (`x-token` + `x-tienda`) y `x-origen: panel`; si el backend no responde
(404/503/504/timeout/red) **vuelve al flujo directo** contra LucidSales y el
toast anota `· API directa`, asi que el panel nunca se queda sin cambio de
estado.

La tarjeta **Oficina Inter Rapidísimo** del detalle del pedido
(`PedidoDetallePage` -> `components/OficinaInter.tsx`) no consulta nada hasta
que se pulsa **Buscar oficinas de Inter** (no a todos los pedidos les hace
falta). Entonces `oficinasInter()` pide `/api/interrapidisimo/oficinas` y, con
`pendiente: "listado"`, va reconsultando con backoff hasta que llegue la lista.
Al pulsar **Usar esta dirección** de una fila, el campo `Direccion` del pedido
queda como `Oficina Interrapidisimo - <direccion de la oficina>` (marcado como
cambio pendiente de guardar) y sale un toast. La fila elegida se resalta con
badge *Dirección en el pedido*. La tarjeta no necesita `x-api-key` ni tiene
respaldo directo: si el backend no esta corriendo muestra su error y un botón
*Reintentar*.

La pagina **Anuncios** (`/anuncios`) pide `/api/anuncios?dias=` con
`x-api-key` a traves de `panel/src/api/backend.ts`; los unicos escritos son
la ganancia promedio (`POST /api/anuncios/ganancia`) y las casillas del plan
(`POST /api/anuncios/plan`), y el CSV se baja con `backendArchivo()` (blob +
nombre del `content-disposition`, asi tambien lleva las cabeceras).

## Pruebas

`npm test` levanta un **LucidSales falso** (login, addShopId, get-pedido-by-id,
update, geografía pública) y un **Inter falso** (catálogo, oficina principal,
listado, horarios, bodega, dia) y comprueba: cuerpo exacto del update,
`motivo` al cancelar, estados invalidos, API key, `503` sin clave,
recuperacion tras `401`, `404`, `sinCambios`, `502` si LucidSales rechaza,
historial y rutas.

De Inter Rapidísimo (en verde):

- `/oficina`: emparejamiento (exacta/difusa/cabecera), `pendiente` -> siguiente
  consulta, cache del catalogo, horarios caidos con `aviso`, 502 si Inter cae.
- `/oficinas`: `pendiente: "listado"` -> lista, cache del `POST` lento,
  `reintentar=1`, municipio no catalogado, `400` sin parametros, endpoint
  publico, respaldo por oficina principal cuando el listado sale vacio, y
  Inter caido (responde `aviso` y `reintentar=1` lo relanza).

Del agente de Dropi (`test/agente.test.js`, `test/dropi.test.js`,
`test/subida.test.js` y `test/conversacion.test.js`):

- **agente**: `parsearPrecio` (punto de miles colombiano), `coincideProducto` /
  `coincidePrecio` / `coincideDireccion`, la decision `subir`/`frenar` y el
  `resumenDePedido` (que ademas lee `TipoPago` y el nombre del producto del
  campo top-level `producto`, no solo del `Json`).
- **conversacion**: el parser de la transcripcion que manda el bot
  (`Usuario (fecha): ...` / `Bot (fecha): ...`), con mensajes multilinea y
  emisores alternativos.
- **dropi**: el payload de Dropi (`insurance`, `type`, `products`, ...) y sus
  campos obligatorios.
- **subida**: config, `dryRun`, no repetir pedidos ya procesados, frenar si no
  calza, **frenar los "Sin Recaudo" (prepago) para que los suba un humano**, y
  la resolucion de ciudad/depto y del link de Dropi.

De rentabilidad de anuncios (`test/anuncios.test.js`, 12 pruebas en verde):

- `x-api-key` obligatoria y `503` si el servidor no tiene el modulo.
- Calculo: USD x TRM, COP tal cual, compras **sin
  duplicar** (una compra repetida en tres `action_type` cuenta una vez),
  clasificacion + accion sugerida y roll-ups por producto y por cuenta.
- **Alerta solo para campanas que se pueden juzgar**: la bandera `alerta` se
  enciende cuando la clase es prioritaria (PERDIDA / RIESGO / SINDATO), la
  campana sigue **ACTIVA** y lleva al menos `minDiasAlerta` dias (3 por
  defecto, configurable en `config/anuncios.json`) con datos. Una pausada ya
  fue decidida (no hace falta volver a decir "pausala") y una de 1 dia todavia
  no dice nada: su accion sugerida pasa a **«Esperar: todavia no se puede
  juzgar»** hasta alcanzar el minimo. El flag sale como `alerta` /
  `alertaMotivo` ("" | "pausada" | "nueva") por campana, `datos.minDiasAlerta`
  en el dataset y la vista CSV `alertas` sigue exactamente la misma regla.
- Cache por ventana (`datos_7d_...`, `datos_30d_...`) y `actualizar` que si
  vuelve a llamar a Meta.
- Ganancia editable (`400` si el producto no existe o el valor es negativo)
  que recalcula neto, clase y accion, y persiste en `productos.json`; plan de
  acciones que se guarda y se lee (`plan.json`).
- CSV (cabecera, numero de filas, BOM, vista invalida -> `400`) y snapshot
  cuando el Graph API esta caido (responde 200 con `fuente: "snapshot"`).
- Utilidades puras: `comprasDe` (prioriza `omni_purchase` y nunca suma) y
  `normalizar` (acentos, signos y emojis para emparejar campanas).

De multiusuario (`test/anunciosUsuarios.test.js`, 8 pruebas en verde):

- Sin `x-usuario` (integraciones) se trabaja en el **compartido**; un usuario
  sin conexion **no** cae ahi: `enUso: "ninguna"` y `409` en datos y plan.
- `conectar` con token invalido -> `400` (nada se guarda); con token valido
  guarda su `config.json` en `usuarios/<email>/` y devuelve sus cuentas (aun
  sin elegir: `datos` sale vacio).
- Cada quien analiza **sus** cuentas con **su** TRM: los del usuario no se
  mezclan con las del compartido y las ganancias que guarda uno no aparecen en
  el otro.
- `desconectar` lo deja sin datos (`409`) conservando sus archivos; `borrar:
  true` elimina la carpeta.
- `compartida: false` -> `409` en los endpoints de datos hasta que conecte.

De calculos y configuracion por usuario (`test/anunciosCalculo.test.js`):

- `hoy()` en hora de Colombia aunque el servidor este en UTC.
- Efectividad de entrega desde los estados de envio, contando o no los que
  nunca se enviaron, y fijada a mano.
- Campana compartida: gasto y compras repartidos sin contar doble; un
  producto sin ganancia deja la campana sin dato.
- Campanas archivadas que gastaron, cuentas en otra moneda (aviso), cache que
  se invalida al cambiar de cuentas.
- Vincular / cambiar / quitar el producto de una campana y la sugerencia por
  nombre; importar productos y traer ganancias con la tienda de la sesion.

## Estructura

```
server/
  config.js             carga de .env + defectos + faltantes
  lucidsales.js         cliente upstream: login, addShopId, 401 -> reintentar
  interrapidisimo.js    oficinas por municipio: catalogo, matching, cache
  estado.js             validacion, cuerpo del update y orquestacion
  historial.js          registro JSONL (escribir / leer)
  anunciosMeta.js       rentabilidad de campanas Meta (Graph + calculo + CSV)
  anunciosTenant.js     un espacio por usuario (x-usuario) + conexion Meta
  servidor.js           rutas, API key, CORS, errores
  index.js              punto de entrada
  config/anuncios.json  token compartido, TRM, cuentas y appId/appSecret
  anuncios/             caches diarios, productos.json, plan.json, snapshot
  anuncios/usuarios/    espacio de cada usuario (token, productos, plan)
  test/                 node --test
```

## Despliegue

Detras de un reverse proxy en el mismo dominio que el panel (ruta `/api`),
o en otro host con `VITE_API_PROPIA=https://api.tudominio.com` y
`CORS_ORIGIN=https://tudominio.com`. Usa una **cuenta de servicio** de
LucidSales con los permisos minimos, y guarda `API_KEY` en el gestor de
secretos (no en el repositorio).

### Estado de preparación para producción

- El backend se enlaza a `127.0.0.1` por defecto; si corre en un contenedor,
  configura `HOST=0.0.0.0` y publica el puerto solo en la red privada del proxy.
- Con `NODE_ENV=production` el proceso no inicia si `API_KEY` (cuando se
  define) tiene menos de 32 caracteres o `CORS_ORIGIN` está vacío o es `*`. Configura el origen HTTPS
  exacto del panel. El backend verifica el encabezado `Origin` y añade cabeceras
  de seguridad y `no-store` a sus respuestas.
- **Acceso del panel:** cada petición lleva la sesión de LucidSales del usuario
  (`x-token`) y su tienda (`x-tienda`); el servidor la verifica con LucidSales
  (`POST /auth/addShopId`, caché de 5 min) y aplica sus permisos por ruta
  (`REGLAS_ACCESO` en `servidor.js`: 2 pedidos, 4 anuncios, 7 horarios,
  8 configuración). Las tiendas pedidas por parámetro también se comprueban.
- Los JSON/JSONL, credenciales, configuración Meta y perfil de Chrome contienen
  estado o secretos. Monta almacenamiento persistente privado con permisos
  restringidos y copias de seguridad cifradas; no los sirvas desde el proxy.
- El panel debe compilarse con `npm run build`; el proxy de Vite es solo para
  desarrollo. El proxy de producción debe servir `panel/dist`, reenviar `/api`
  al backend y `/b` a LucidSales, activar HTTPS y tener límites de cuerpo/tiempo.
- No habilites reparto ni subida automática a Dropi al desplegar. Conserva
  `automatico=false` y `dryRun=true` hasta terminar un piloto manual controlado.
- Rota las credenciales que hayan estado en archivos locales o bundles y
  configúralas solo en el gestor de secretos del entorno.

No pongas claves en variables `VITE_*`: cualquier visitante puede extraerlas
del JavaScript compilado.
