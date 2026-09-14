#!/bin/sh
# Production entrypoint: wait for Postgres, run migrations, start the app.
#
# Failure semantics — read carefully:
# `docker compose up -d` with a new TAG stops and REPLACES the old app
# container first. So if `migrate deploy` exits non-zero here, the previous
# version is already gone and this container crash-loops (restart policy)
# until someone re-dispatches the previous image SHA. A failed migration =
# downtime, not a graceful continue on the old version.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

# Fail fast on a malformed URL (e.g. unencoded special chars in the password)
# instead of hanging in the wait loop below.
if ! node -e "new URL(process.env.DATABASE_URL)"; then
  echo "FATAL: DATABASE_URL is not a valid URL" >&2
  exit 1
fi

echo "Waiting for Postgres..."
tries=0
until node -e "
const u = new URL(process.env.DATABASE_URL);
const s = require('net').connect(
  { host: u.hostname, port: Number(u.port || 5432) },
  () => { s.end(); process.exit(0); },
);
s.on('error', () => process.exit(1));
setTimeout(() => process.exit(1), 3000);"; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "FATAL: Postgres unreachable after ~60s" >&2
    exit 1
  fi
  sleep 2
done

echo "Postgres is up, running migrations..."
npx prisma migrate deploy

echo "Starting RunLoop..."
exec node server.js
