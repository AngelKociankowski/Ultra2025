# Imagen de la plataforma, para cualquier proveedor que acepte Docker
# (Railway, Fly.io, un VPS propio…). Render no la necesita: usa render.yaml.
#
#   docker build -t ultra-guardias .
#   docker run -p 3000:3000 -v ultra-datos:/datos ultra-guardias
#
# El volumen es lo único que no se puede olvidar: ahí vive la base.

FROM node:20-slim

# better-sqlite3 se compila durante la instalación y necesita estas tres cosas.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# Sin --omit=dev: Tailwind y PostCSS son de desarrollo pero hacen falta para
# construir la interfaz.
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/datos/ultra.db
VOLUME /datos
EXPOSE 3000

# Siembra idempotente: carga los datos la primera vez y no hace nada después.
CMD ["sh", "-c", "node scripts/seed.mjs && npm run start"]
