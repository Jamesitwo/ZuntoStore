#!/bin/sh
set -eu

mkdir -p /data/config /data/anuncios/usuarios /data/dropi-profile
chown -R node:node /data

# Node corre como hijo (no como PID 1): asi el vigilante (vigia.js) puede
# terminarlo si se bloquea, el contenedor sale con error y Railway lo
# reinicia. Las señales de Railway (apagar/redeploy) se le pasan a Node.
hijo=""
trap 'if [ -n "$hijo" ]; then kill -TERM "$hijo" 2>/dev/null || true; fi' TERM INT
gosu node:node node /app/index.js &
hijo=$!
st=0
while :; do
  if wait "$hijo"; then st=0; else st=$?; fi
  kill -0 "$hijo" 2>/dev/null || break
done
echo "[arranque] Node terminó con código $st"
exit "$st"
