FROM node:14.19.0-slim as build

# Install dependency /usr/bin/ldd for snappy library
RUN apt-get -y install --no-install-recommends libc-bin=2.24-11+deb9u4 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm install

COPY src/ src

RUN npm run build

# Create the second stage from the Google distroless image to
# keep the image size down and more secure.
# amd64 specified here is required for the distroless image to
# locate module for snappy x64 library.
FROM gcr.io/distroless/nodejs:14

WORKDIR /app

COPY --from=build /usr/bin/ldd /usr/bin/ldd
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src/public ./public
COPY --from=build /app/dist .

COPY moleculer.config.js .

CMD ["node_modules/moleculer/bin/moleculer-runner.js"]
