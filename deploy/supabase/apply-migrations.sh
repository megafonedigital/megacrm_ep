#!/bin/bash
# Aplica supabase/migrations/*.sql em ordem, uma única vez cada
# (rastreadas em public._app_migrations).
# Cada migration roda numa única transação psql: migration + INSERT juntos.
# Se o SQL falhar, a transação faz rollback automático e o arquivo NÃO é
# marcado como aplicado — a próxima execução recomeça do zero sem estado parcial.
set -euo pipefail

echo "[migrate] aguardando Postgres..."
until pg_isready -q; do sleep 1; done

# O schema storage é criado pelas migrations internas do storage-api, que
# rodam depois do healthcheck HTTP responder. Como as migrations do app
# fazem insert/policies em storage.buckets/objects, esperamos a tabela existir.
echo "[migrate] aguardando schema storage (storage-api)..."
until [ "$(psql -tAc "SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'buckets'")" = "1" ]; do
  sleep 2
done

psql -v ON_ERROR_STOP=1 -c "
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
  echo "[migrate] aplicando $name ..."
  # Uma única conexão psql: BEGIN + arquivo + INSERT + COMMIT.
  # Se ON_ERROR_STOP=1 abortar no meio, a conexão fecha sem COMMIT e o
  # Postgres faz ROLLBACK automaticamente — sem estado parcial.
  psql -v ON_ERROR_STOP=1 \
    -c "BEGIN;" \
    -f "$f" \
    -c "INSERT INTO public._app_migrations(name) VALUES ('$name');" \
    -c "COMMIT;"
  applied=$((applied + 1))
  echo "[migrate] ok: $name"
done

echo "[migrate] concluído: $applied aplicadas, $skipped já existentes"
