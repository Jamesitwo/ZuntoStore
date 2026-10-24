# Preparación para Railway

El backend ya tiene un contenedor para Railway en `server/Dockerfile`. Incluye
Chromium para la automatización de Dropi, lo ejecuta en modo headless y guarda
los archivos de estado y el perfil del navegador bajo `/data`.

## Un solo servicio (API + panel)

El `Dockerfile` de la **raiz** del repositorio compila el panel y lo sirve el
mismo servidor (`PANEL_DIR=/app/panel`): un dominio, `/api` es la API, `/b` se
reenvia a LucidSales (como el proxy de Vite) y lo demas es el panel. No hace
falta `CORS_ORIGIN` (mismo dominio) ni un segundo servicio.

1. New Project -> Deploy from GitHub repo -> `Jamesitwo/ZuntoStore`. Deja el
   **Root Directory vacio** (raiz): Railway usa el `Dockerfile` de la raiz.
2. Volumen persistente montado en `/data` (pedidos procesados, ajustes, tokens,
   sesion y perfil de Chrome de Dropi).
3. Health check: `/api/salud`.
4. **Una sola replica** (archivos JSON y un unico perfil de Chrome).
5. Variables (Variables del servicio, nunca en el repo): `LUCID_EMAIL`,
   `LUCID_PASSWORD`, `LUCID_TIENDA`, `TZ_ASIGNACION`, `LLM_API_KEY`,
   `LLM_MODELO`, `DROPI_TOKEN`, `DROPI_USER_ID`, `DROPI_SUPPLIER_ID`,
   `DROPI_SHOP_ID`, `DROPI_WAREHOUSE_ID`, `DROPI_SEGURO`, `DROPI_PRODUCTOS_CSV`
   y, si se usa, `API_KEY` (32+). `GOOGLE_MAPS_KEY`, la IA, el sheet y Lucid
   Bot tambien se pueden poner desde el panel. Railway da `PORT`.
6. Settings -> Networking -> Generate Domain.

`server/Dockerfile` (solo la API, Root Directory `/server`) sigue sirviendo si
se quiere el panel aparte; entonces si hay que definir `CORS_ORIGIN`.

**No dejes corriendo a la vez tu equipo y Railway con la subida automatica:**
los dos subirian los mismos pedidos.

Railway monta el volumen al iniciar el contenedor (no durante el build); por eso
la imagen inicializa `/data` en su entrypoint. El proceso Node se ejecuta como
usuario sin privilegios aunque el volumen llegue montado como `root`. Detalles
en la [documentación de volúmenes](https://docs.railway.com/volumes),
[monorepos](https://docs.railway.com/deployments/monorepo) y
[health checks](https://docs.railway.com/deployments/healthchecks).

## Acceso al panel (resuelto)

El panel ya no lleva ninguna clave en su JavaScript. Cada petición a `/api`
manda la sesión de LucidSales del usuario (`x-token`, el token de
`/auth/addShopId`) y la tienda activa (`x-tienda`). El servidor la verifica con
LucidSales (`POST /auth/addShopId`, caché de 5 minutos) y aplica los permisos
reales del usuario (ver `server/sesionPanel.js` y `REGLAS_ACCESO` en
`server/servidor.js`):

| Permiso de LucidSales | Qué habilita en el backend |
|---|---|
| 2 Pedidos | validar/subir pedidos, conversación, estados, reparto |
| 4 Métricas | anuncios |
| 7 Usuarios y Permisos | horarios |
| 8 Ajustes Tienda | subida automática, IA, Lucid Bot, sesión de Dropi, credenciales |

`API_KEY` queda solo para integraciones servidor-a-servidor (por ejemplo, el
bot que manda conversaciones); es opcional y, si se define en producción, debe
tener 32+ caracteres. No la pongas en el panel.

Publica el panel como otro servicio en la misma aplicación Railway, usa la red
privada para alcanzar la API y enruta `/b` hacia `https://panel.lucidsales.co`.
Configura el dominio y HTTPS en el servicio del panel, con `/api` y `/b` bajo
ese mismo origen, y define `CORS_ORIGIN` con ese origen exacto. Despliega con
la subida en «Preparar sin crear» y el reparto apagado; actívalos después de
revisar unos pedidos.

## Despliegues y sesión Dropi

En Railway no hay pantalla para `node dropiLogin.mjs`. La sesión se actualiza
desde el panel (Ajustes > Subida a Dropi > **Sesión de Dropi**): inicias sesión
en Dropi en tu navegador, copias su `localStorage` con
`copy(JSON.stringify(localStorage))` en la consola, lo pegas en el panel y el
servidor lo carga en su perfil (`POST /api/dropi/sesion`) y comprueba que Dropi
lo acepte. Cuando la sesión vence o aparece un captcha, la subida se detiene,
los pedidos quedan pendientes (se suben al restablecerla) y llega **un** aviso
por Lucid Bot al teléfono del admin (`sesion-vencida` o `captcha`). Hay que
confirmar en el primer despliegue que Dropi acepta una sesión iniciada en otra
IP.

El volumen conserva la sesión del navegador entre reinicios, pero la
automatización puede requerir volver a iniciar sesión si Dropi invalida esa
sesión o presenta un captcha. No hay que intentar evadir captchas. El piloto
inicial debe mantener `automatico=false` y `dryRun=true`, validar pedidos
manualmente y revisar los logs antes de cambiar esa política.

Un servicio con volumen tiene una breve interrupción al desplegar, porque
Railway no ejecuta dos deployments simultáneos sobre el mismo volumen. La
sesión de Chrome y los archivos JSON también hacen que este backend no sea
apto para escalar horizontalmente sin migrar antes el estado a una base de
datos y coordinar los trabajos. [Referencia de Railway sobre volúmenes y
despliegues](https://docs.railway.com/guides/roll-back-bad-deploy).
