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

## Authenticated API Calls

Some API calls require that the request be made using an authenticated JWT. This
can be achieved by the following:

- register a user so that a new user account is created
- login as the new user
- take the generated JWT token from the login response and add in the
  `Authorization` header in subsequent API calls

The commands below use the fantastic [HTTPie] client, an excellent replacement
for `curl`.

### Registering a new user

The `test/requests/register-user.json` file contains the json payload describing
the new user account. The command below can be run to post this to the
`/api/register` endpoint.

```bash
http POST http://api-127-0-0-1.nip.io/api/register < test/requests/register-user.json
```

**WARNING:** When the account is created an event will be fired to a Kafka
`users` topic. This is my environment, unlike the other services, returns a
broker error that a leader cannot be found for the very first account that gets
created. The user account is however successfully created. All accounts created
after this do not generate errors, and the user creation events are successfully
published to the Kafka topic.

### Login the user

The command below can be run to log in the new user. The response will contain a
`token` field containing a valid authenticated JWT.

```bash
http http://api-127-0-0-1.nip.io/api/login username='bob' password='secret-password'

{
    "_id": "5fe97aac26c85f0014d789c7",
    "email": "bob@example.com",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.....",
    "username": "bob"
}
```

### Authenticated API call

The below command will retrieve the information for the `bob` user account. The
`/api/users/:username` endpoint requires a valid JWT to be provided in the call.
The JWT previously obtained when logging in should be added in the
`Authorization` header with a value of `Bearer <jwt>`.

```bash
http http://api-127-0-0-1.nip.io/api/users/bob \
  Authorization:'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.....'

{
    "__v": 0,
    "_id": "5fe97aac26c85f0014d789c7",
    "created": "2020-12-28T06:26:52.631Z",
    "email": "bob@example.com",
    "password": "$2b$10$/XSiWYRmwSEP..koLhmx3eCGGm2JB8Kghi9K9Na513O8vSX5OcRH.",
    "updated": "2020-12-28T06:26:52.631Z",
    "username": "bob"
}
```

[confluent]: https://www.confluent.io/
[httpie]: https://httpie.io/
[jaeger]: https://www.jaegertracing.io/
[kafka]: https://kafka.apache.org/
[moleculer]: https://moleculer.services/
[mongodb]: https://www.mongodb.com/
[redis]: https://redis.io/
[traefik]: https://traefik.io/traefik/
