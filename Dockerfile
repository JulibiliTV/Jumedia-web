# syntax=docker/dockerfile:1
# Static build of the web app. Running the image copies it into /web, a volume that
# Jumedia-server serves (JUMEDIA_WEB_DIR / JUMEDIA_STATIC_DIR); the container then exits.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY build build
COPY public public
COPY src src
COPY scripts/check-bundle.mjs scripts/check-bundle.mjs
RUN VITE_MOCK=0 npm run build && npm run check:bundle -- --production

FROM busybox:1.37
COPY --from=build /src/dist /dist
# Hashed assets go in before index.html points at them; older chunks stay for pages already open.
CMD ["sh", "-c", "mkdir -p /web && cp -a /dist/assets /web/ && cp -a /dist/. /web/ && echo 'web files installed'"]
