# MegaCRM web — TanStack Start compilado para Node (nitro node-server).
# O target Cloudflare do Lovable é trocado via NITRO_PRESET (vite.config.ts).

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

# VITE_* são embutidas no bundle do cliente em build-time
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    NITRO_PRESET=node-server \
    NODE_OPTIONS=--max-old-space-size=8192

RUN npx vite build

# ─── Runtime ───
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY --from=build /app/.output ./.output

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
