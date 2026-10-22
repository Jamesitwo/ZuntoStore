#!/bin/sh
set -eu

mkdir -p /data/config /data/anuncios/usuarios /data/dropi-profile
chown -R node:node /data
exec gosu node:node node /app/index.js
