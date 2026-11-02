# syntax=docker/dockerfile:1
# Static build of the web app. Running the image copies it into /web, a volume that
# Jumedia-server serves (JUMEDIA_WEB_DIR / JUMEDIA_STATIC_DIR); the container then exits.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public public
COPY src src
RUN VITE_MOCK=0 npm run build

FROM busybox:1.37
COPY --from=build /src/dist /dist
# Hashed assets go in before index.html points at them; older chunks stay for pages already open.
CMD ["sh", "-c", "mkdir -p /web && cp -a /dist/assets /web/ && cp -a /dist/. /web/ && echo 'web files installed'"]
