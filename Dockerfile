# Etapa 1: Builder
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# Copiar dependencias y Prisma
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

# Copiar código fuente y archivos de configuración
COPY . .
# Forzar copia explícita (por si .dockerignore los excluye)
COPY tsconfig.json ./tsconfig.json
COPY nest-cli.json ./nest-cli.json

# Compilar (genera dist/ según tsconfig)
RUN npm run build

# Etapa 2: Producción
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# Copiar artefactos desde builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

# Comando: migraciones + app (usando el script start:prod del package.json)
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]