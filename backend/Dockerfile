FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json backend/tsconfig.json ./
RUN npm ci --ignore-scripts
COPY backend/src ./src
COPY catalog/recommendations.mjs catalog/recommendations.d.mts /app/catalog/
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/migrations ./migrations
COPY catalog /app/catalog
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]

FROM runtime AS demo
COPY demo /app/demo
ENV ENABLE_LOCAL_DEMO=true
CMD ["node", "dist/server.js", "demo"]

FROM runtime AS production
