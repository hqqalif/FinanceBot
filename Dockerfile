# Use Node 22 Alpine (Production LTS release)
FROM node:22-alpine AS build
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image stage
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

CMD ["node", "dist/main.js"]