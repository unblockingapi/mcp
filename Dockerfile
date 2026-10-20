# Hosted MCP server (mcp.unblockingapi.com): the http entry of this package.
# The stdio entry ships on npm; this image only runs dist/http.js.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY guides ./guides
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/guides ./guides
USER node
EXPOSE 8080
CMD ["node", "dist/http.js"]
