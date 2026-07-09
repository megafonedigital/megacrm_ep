#!/bin/sh
# Sidecar de cron: aciona os endpoints /api/public/cron/* do app que NÃO
# são de broadcast (esses vivem no worker dedicado). Intervalos via env.
WEB_URL="${WEB_URL:-http://web:3000}"
FAST="${FAST_INTERVAL:-5}"
MEDIUM="${MEDIUM_INTERVAL:-15}"
SLOW="${SLOW_INTERVAL:-60}"
BROADCAST_FALLBACK="${BROADCAST_FALLBACK:-false}"

hit() {
  curl -s -o /dev/null -w "[cron] %{http_code} $1\n" -X POST --max-time 30 "$WEB_URL$1" || echo "[cron] FAIL $1"
}

echo "[cron] iniciado — web=$WEB_URL fast=${FAST}s medium=${MEDIUM}s slow=${SLOW}s broadcast_fallback=$BROADCAST_FALLBACK"

now() { date +%s; }
last_medium=0
last_slow=0

while true; do
  # Rápidos (a cada FAST s): drains de filas leves
  hit /api/public/cron/ai-agents-drain &
  hit /api/public/cron/contact-imports-drain &
  hit /api/public/cron/integrations-drain &
  if [ "$BROADCAST_FALLBACK" = "true" ]; then
    hit /api/public/cron/broadcast-loop &
  fi

  t=$(now)

  if [ $((t - last_medium)) -ge "$MEDIUM" ]; then
    hit /api/public/hooks/automation-tick &
    last_medium=$t
  fi

  if [ $((t - last_slow)) -ge "$SLOW" ]; then
    hit /api/public/cron/integrations-poll &
    hit /api/public/cron/pipeline-activities-tick &
    if [ "$BROADCAST_FALLBACK" = "true" ]; then
      hit /api/public/cron/broadcast-reconcile &
    fi
    last_slow=$t
  fi

  wait
  sleep "$FAST"
done
