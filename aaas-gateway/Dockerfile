# --- Build stage ---
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
# tenants.yaml is mounted at runtime via docker-compose, not baked in.

EXPOSE 8080
CMD ["node", "dist/server.js"]
