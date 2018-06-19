[![Moleculer](https://img.shields.io/badge/Powered%20by-Moleculer-green.svg?colorB=0e83cd)](https://moleculer.services)

# moleculer-microservices-spike

This project is a number of microservices built in Node.js using the [Moleculer](https://moleculer.services/) microservice framework.

This deployment uses Docker containers and consists of the following components:
* [Moleculer](https://moleculer.services/) as the microservices framework.
* [Redis](https://redis.io/) as the cache layer.
* [Kafka](https://kafka.apache.org/) for the messaging layer. This uses the [Confluent](https://www.confluent.io/) distribution for the Docker containers.
* [MongoDB](https://www.mongodb.com/) for the database layer.
* [Jaeger](https://www.jaegertracing.io/) for the metrics and tracing.
* [Traefik](https://traefik.io/) for proxying and load balancing requests to the API gateway.

## Build and Setup

``` bash
# Install dependencies
npm install

# Start developing with REPL
npm run dev

# Start production
npm start

# Run unit tests
npm test

# Run continuous test mode
npm run ci

# Run ESLint
npm run lint
```

## Run in Docker

```bash
$ docker-compose up -d --build
```
