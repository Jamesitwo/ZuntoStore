# Preparación para Railway

El backend ya tiene un contenedor para Railway en `server/Dockerfile`. Incluye
Chromium para la automatización de Dropi, lo ejecuta en modo headless y guarda
los archivos de estado y el perfil del navegador bajo `/data`.

## Configurar el servicio API

1. Crea un servicio desde el repositorio y configura su **Root Directory** como
   `/server`. Railway construirá el `Dockerfile` de esa carpeta.
2. Añade un volumen persistente montado en `/data`. Los pedidos procesados,
   ajustes, tokens guardados y sesión de Dropi usan ese volumen.
3. Configura `/api/salud` como ruta de health check. Este endpoint confirma que
   el proceso responde; revisa también su campo `faltantes` antes de aceptar
   tráfico real.
4. Deja una sola réplica. El estado actual usa archivos JSON/JSONL y un único
   perfil de Chrome; varias instancias podrían procesar el mismo pedido o
   escribir datos a la vez.
5. Añade las variables secretas desde Railway, nunca desde el repositorio:
   `API_KEY` (32+ caracteres aleatorios), credenciales de LucidSales, tokens de
   Dropi y LLM, además de `CORS_ORIGIN` con el origen HTTPS exacto del panel.
   Railway proporciona `PORT`; el contenedor usa `HOST=0.0.0.0`.
6. Mantén la API en la red privada de Railway mientras se completa la
   autenticación de usuario. No generes un dominio público para el servicio API.

Railway monta el volumen al iniciar el contenedor (no durante el build); por eso
la imagen inicializa `/data` en su entrypoint. El proceso Node se ejecuta como
usuario sin privilegios aunque el volumen llegue montado como `root`. Detalles
en la [documentación de volúmenes](https://docs.railway.com/volumes),
[monorepos](https://docs.railway.com/deployments/monorepo) y
[health checks](https://docs.railway.com/deployments/healthchecks).

## Bloqueo antes de publicar el panel

Todavía no publiques la interfaz frente a este API. El contrato actual confía
en `x-api-key` y `x-usuario` enviados por el navegador; el primero se puede
extraer del bundle y el segundo se puede falsificar. La interfaz y el backend
necesitan una puerta de acceso que valide la sesión real de LucidSales y aplique
rol y tienda en el servidor. Luego el panel puede enrutar `/api` por una puerta
privada sin incluir la clave en el bundle.

Después de resolver autenticación, publica el panel como otro servicio en la
misma aplicación Railway, usa la red privada para alcanzar la API y enruta
`/b` hacia `https://panel.lucidsales.co`. Configura el dominio y HTTPS en el
servicio del panel, con `/api` y `/b` bajo ese mismo origen. No habilites la
subida automática ni el reparto durante el primer despliegue.

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
