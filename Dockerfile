# Un solo servicio para Railway: la API (server/) + el panel (panel/) en el
# mismo dominio. El panel se compila aqui y lo sirve el servidor (PANEL_DIR).

# ---- 1. compilar el panel ----
FROM node:22-bookworm-slim AS panel
WORKDIR /panel
COPY panel/package.json panel/package-lock.json ./
RUN npm ci
COPY panel/ ./
RUN npm run build

# ---- 2. servidor con Chromium (Dropi) ----
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium gosu ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=panel /panel/dist /app/panel
COPY server/railway-entrypoint.sh /usr/local/bin/zuntostore-entrypoint
RUN chmod 755 /usr/local/bin/zuntostore-entrypoint

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PANEL_DIR=/app/panel \
    DROPI_CHROME=/usr/bin/chromium \
    DROPI_HEADLESS=1 \
    DROPI_PERFIL=/data/dropi-profile \
    HISTORIAL=/data/historial.jsonl \
    CONVERSACION=/data/conversacion.jsonl \
    SUBIDA_AUTO=/data/subidaAutomatica.json \
    LUCIDBOT_CONTACTOS_CONFIG=/data/config/lucidbot-contactos.json \
    ASIGNACION=/data/asignacion.json \
    CREDENCIALES=/data/credenciales.json \
    ANUNCIOS_DIR=/data/anuncios \
    ANUNCIOS_CONFIG=/data/config/anuncios.json \
    LLM_CONFIG=/data/config/llm.json \
    MAPAS_CONFIG=/data/config/mapas.json \
    DROPI_PRODUCTOS_CONFIG=/data/config/productosDropi.json

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/zuntostore-entrypoint"]
