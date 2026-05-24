# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# ↓↓↓ docker CLI를 runtime stage에 설치 ↓↓↓
RUN apk add --no-cache docker-cli

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]