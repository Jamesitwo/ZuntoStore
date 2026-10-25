FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium gosu ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY railway-entrypoint.sh /usr/local/bin/zuntostore-entrypoint
RUN chmod 755 /usr/local/bin/zuntostore-entrypoint

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DROPI_CHROME=/usr/bin/chromium \
    DROPI_HEADLESS=1 \
    DATA_DIR=/data \
    DROPI_PERFIL=/data/dropi-profile \
    HISTORIAL=/data/historial.jsonl \
    CONVERSACION=/data/conversacion.jsonl \
    SUBIDA_AUTO=/data/subidaAutomatica.json \
    ENVIOS=/data/envios.json \
    INTENTOS=/data/intentos.jsonl \
    PROGRAMADOS=/data/programados.json \
    APIKEY_CONFIG=/data/config/apikey.json \
    LUCIDBOT_PEDIDOS=/data/lucidbot-pedidos.json \
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
