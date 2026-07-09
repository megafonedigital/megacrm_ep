#!/bin/bash
# Aplica supabase/migrations/*.sql em ordem, uma única vez cada
# (rastreadas em public._app_migrations). Idempotente — roda em todo `up`.
set -euo pipefail

echo "[migrate] aguardando Postgres..."
until pg_isready -q; do sleep 1; done

psql -v ON_ERROR_STOP=1 -q -c "
  CREATE TABLE IF NOT EXISTS public._app_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );"

applied=0
skipped=0
for f in $(ls /migrations/*.sql | sort); do
  name=$(basename "$f")
  exists=$(psql -tAc "SELECT 1 FROM public._app_migrations WHERE name = '$name'")
  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "[migrate] aplicando $name"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
  psql -q -c "INSERT INTO public._app_migrations(name) VALUES ('$name')"
  applied=$((applied + 1))
done

echo "[migrate] concluído: $applied aplicadas, $skipped já existentes"
