# syntax=docker/dockerfile:1
# relvia — obraz monolitu: CAP (Node) serwuje zbudowany frontend + /chat + /admin.
# NIE jest produktem SAP / BTP — CAP użyty jako zwykły backend Node.

# ── Stage 1: build ────────────────────────────────────────────────────────────
# Pełny obraz node:22 (ma toolchain) — kompiluje natywny better-sqlite3 i devDeps
# (m.in. @sap/cds-dk do `cds deploy`). NODE_ENV nie jest tu 'production', więc
# npm ci instaluje też devDependencies.
FROM node:22 AS build
WORKDIR /app

# Zależności backendu (osobna warstwa = lepszy cache)
COPY package.json package-lock.json ./
RUN npm ci

# Zależności + build frontendu. Vite rozwiązuje alias @shared → ../shared,
# więc shared/ musi być obecny obok web/ podczas builda.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY shared/ ./shared/
COPY web/ ./web/
RUN npm --prefix web run build

# Źródła backendu (po buildzie frontu — rzadziej zmieniany cache wyżej)
COPY srv/ ./srv/
COPY db/ ./db/

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
# Slim (ten sam glibc co builder → skompilowany better-sqlite3 działa). NODE_ENV
# 'production' aktywuje profil CAP [production] (baza na /data/db.sqlite + schema_evolution).
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node_modules z buildera: zawiera skompilowany better-sqlite3 ORAZ @sap/cds-dk
# (potrzebny do `cds deploy` przy starcie kontenera).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/srv ./srv
COPY --from=build /app/db ./db
COPY --from=build /app/shared ./shared
COPY --from=build /app/web/dist ./web/dist

# Punkt montowania trwałego wolumenu z bazą (Fly montuje tu dysk relvia_data)
RUN mkdir -p /data
EXPOSE 4004

# Migracja schematu na wolumen (idempotentna dzięki schema_evolution: auto — NIE
# czyści danych przy restarcie/redeployu) → start serwera CAP.
CMD npx cds deploy && exec npx cds-serve
