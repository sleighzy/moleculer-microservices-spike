# moleculer-microservices-spike

[![Moleculer](https://img.shields.io/badge/Powered%20by-Moleculer-green.svg?colorB=0e83cd)](https://moleculer.services)

This project is a number of microservices built in Node.js using the [Moleculer]
microservices framework.

This deployment uses Docker containers and consists of the following components:

- [Moleculer] is a the microservices framework for Node.js
- [Redis] is an in-memory datastore used as a caching layer
- [Kafka] is a distributed streaming platform. This deployment uses the
  [Confluent] distribution for the Docker containers
- [MongoDB] is a document-based database
- [Jaeger] provides an OpenTracing implementation and collection of tracing data
- [Traefik] is a Cloud Native reverse proxy and load balancer and routes
  traffics between the containers

## Build and Setup

```bash
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

## Run Docker Deployment of Services

The environment variables used when deploying the Docker container are
configured in the `docker-compose.env` file. The `moleculer.config.js` file
contains the default configuration for the Moleculer service brokers. This
configuration however is overridden by the environment variables when running
the Docker deployment. For example, the default `transporter: 'TCP'` setting in
`moleculer.config.js` will be overridden by the `TRANSPORTER` environment
variable value.

Copy the `docker-compose.example.env` to `docker-compose.env` and update it with
the below settings:

- the webhook address for your Slack channel to receive alerts on
- username and password for email server
- kafka brokers if listening on a different server or ports

Run the command below to pull all Docker images defined in the
`docker-compose.yml` file.

```bash
docker-compose pull
```

Run the command below to build the Moleculer services images.

```bash
docker-compose build
```

The initial startup of ZooKeeper and Kafka may be slower than the other services
so these can be started first if necessary.

```bash
docker-compose up -d zookeeper kafka
```

Run the command below to startup all services.

```bash
docker-compose up -d
```

[confluent]: https://www.confluent.io/
[jaeger]: https://www.jaegertracing.io/
[kafka]: https://kafka.apache.org/
[moleculer]: https://moleculer.services/
[mongodb]: https://www.mongodb.com/
[redis]: https://redis.io/
[traefik]: https://traefik.io/traefik/
