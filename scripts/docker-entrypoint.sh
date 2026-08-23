#!/bin/sh
# Entrypoint for the orchestrator container (issue #90): apply pending SQLite
# migrations, then hand PID 1 over to the server so `docker stop` delivers
# SIGTERM straight to node instead of an intermediate shell.
set -e

cd /app/server

echo "==> Applying database migrations"
npx prisma migrate deploy

echo "==> Starting orchestrator"
exec node dist/index.js
