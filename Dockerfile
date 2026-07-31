# PagePulse — production image.
# Docker is optional; normal local development only needs Node 20+.
#
#   docker build -t pagepulse .
#   docker run -p 3000:3000 -v pagepulse-data:/app/data pagepulse

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
