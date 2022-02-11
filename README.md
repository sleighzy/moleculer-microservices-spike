# moleculer-microservices-spike

[![Moleculer](https://img.shields.io/badge/Powered%20by-Moleculer-green.svg?colorB=0e83cd)](https://moleculer.services)
![Lint Code Base]

This project is a number of microservices built using the [Moleculer]
microservices framework.

The inspiration for this was to learn more about the Moleculer framework and
build a proof-of-concept based on the Confluent [Building a Microservices
Ecosystem with Kafka Streams and KSQL] blog. This proof-of-concept is not using
Kafka Streams or KSQL, but the services are built using event sourcing (with
Kafka as the messaging platform) with additional patterns and incorporating many
of the Moleculer features as an example.

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

# Start developing with REPL, this starts all services
npm run dev

# Run unit tests
npm test

# Run continuous test mode
npm run ci

# Run ESLint
npm run lint
```

## Running Services

Individual services can be started with the following commands:

`npm run service:<service-name>`

- `service:api`
- `service:auth`
- `service:emailer`
- `service:inventory`
- `service:metrics`
- `service:orders`
- `service:slack`
- `service:users`

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

## Moleculer Web Console

Navigate to the Moleculer Web Console to view nodes, services, and make API
calls. Click the _Execute_ button on the _Authentication_ page to login and
generate an auth token. The token will be automatically added in the
`Authorization` header when calling APIs from other pages in the web console.

<http://moleculer-127-0-0-1.nip.io/>

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
http POST http://moleculer-127-0-0-1.nip.io/api/auth/register < test/requests/register-user.json
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
http http://moleculer-127-0-0-1.nip.io/api/auth/login username='bob' password='secret-password'

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
http http://moleculer-127-0-0-1.nip.io/api/users/bob \
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

## Inventory Service

The Inventory service maintains a list of available products, their price, and
the available quantity. This is stored within the MongoDB database. This service
uses event sourcing via a Kafka topic to update stock in the database based on
events consumed from the `inventory` topic. When the HTTP API is invoked with a
product item to add to the inventory an event is sent to the Kafka topic. This
event is then consumed by the service again and updates the database with this
item.

Run the below command to use the [kafkacat] utility to watch the `inventory`
topic.

```sh
kafkacat -C -b localhost:9092 -t inventory
```

Run the below command using the [httpie] client to call the Inventory `create`
handler via the [Moleculer API Gateway].

```sh
echo '{ "item": { "product": "Raspberry Pi 4b", "price": 145.00 } }' | http POST http://moleculer-127-0-0-1.nip.io/api/inventory
```

This should output the below message in the Kafkacat terminal for the event that
was published from the API call. This event will be used to create the database
insertion of this item.

```json
{
  "eventType": "ItemAdded",
  "item": { "product": "Raspberry Pi", "price": 145, "state": "Available" }
}
```

## Emailer Service

The `Emailer` service sends email messages for order events consumed from a
Kafka topic. The `OrderCreated` event contains the `customerId` within the
`order` object, this is used to retrieve the user account associated with that
identifier and populate the email address.

This deployment uses the online fake SMTP service [Ethereal] for testing the
sending of emails. Create an account on that site and then set the `SMTP_USER`
and `SMTP_PASS` to match the account details you are provided.

Run the below command to use the [kafkacat] utility to publish an order event.
In the example below the customer id of `12345` should be updated with the value
from your user account. You can get the list of users and their customer
identifier by making an authenticated API call to the
<http://moleculer-127-0-0-1.nip.io/api/users> endpoint.

```sh
echo '{ "eventType": "OrderCreated", "order": { "customerId": 12345, "product": "Raspberry Pi 4b", "quantity": 1, "price": 145.00, "state": "Pending" } }' \
  | kafkacat \
  -P \
  -b localhost:9092 \
  -t orders
```

An email message will be created and viewable in your Ethereal account.

## Slack Messaging Service

The `Slack` service provides an API for sending messages to a [Slack channel]
using either HTTP POST requests, or publishing messages to a Kafka topic.

See the Slack documentation on creating an account and obtaining a webhook url.
The webhook url needs to set as the value for the `SLACK_WEBHOOK_URI`
environment variable.

### Sending messages via HTTP POST

The below command uses the [HTTPie] client to post a message to the Slack
service that will then be delivered to your Slack channel.

```bash
http POST http://moleculer-127-0-0-1.nip.io/api/slack message='Hello from the Slack service using HTTP POST'
```

### Sending messages via Kafka

The Slack service runs a Kafka consumer that connects to the Kafka bootstrap
server configured in the `SLACK_BOOTSTRAP_SERVER` environment variable. This
consumes messages from the Kafka topic, configured for the `SLACK_KAFKA_TOPIC`
environment variable, and delivers them to your Slack channel.

The example below uses the awesome [kafkacat] command-line utility for producing
and consuming messages (plus more) to/from Kafka. See further below as to the
usage of `localhost:9092`.

```bash
echo 'slack message via Kafka' | kafkacat -P -b localhost:9092 -t slack-notifications
```

## Kafka Service and Kafka Broker Listeners

The `docker-compose.yml` file for the Docker deployment contains the following
environment variables for the `kafka` service:

```yaml
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT
# Internal listener for communication to brokers from within the
# Docker network, external listener for accessing from Docker host.
KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:29092,EXTERNAL://192.168.68.103:9092
```

The `INTERNAL` listener, `kafka:29092`, is used by the services defined within
the Docker Compose file, e.g. the Slack service and its `SLACK_BOOTSTRAP_SERVER`
environment variable value. This is the address that is contactable by all
containers in this network. The `EXTERNAL` listener is the one published for you
to connect to from your local machine. The ip address for the `EXTERNAL`
listener should be updated to match your local machine ip. You can then connect
to the Kafka container on `localhost:9092`, the bootstrap server will
subsequently direct the Kafka producer to send messages to your machine's ip
address, which then get forwarded to the actual Kafka broker via the port
binding in the Docker Compose file. Read the Confluent blog post [Kafka
Listeners - Explained] for a good explanation, diagrams, and examples of this.

## Troubleshooting

### Clearing bad messages from Kafka topics

// The consumer group id consists of the prefix 'moleculer-', the name of the
service that // this mixin is being merged into, and the topic being consumed.
groupId: `moleculer-${this.name}-${topic}`,

```sh
❯ kafkacat -b localhost:9092 -G moleculer-orders-orders orders
% Waiting for group rebalance
% Group moleculer-orders-orders rebalanced (memberid rdkafka-5a47dbea-0cdf-42da-a91b-e256c1fdb0dd): assigned: orders [0]
% Reached end of topic orders [0] at offset 2
^C% Group moleculer-orders-orders rebalanced (memberid rdkafka-5a47dbea-0cdf-42da-a91b-e256c1fdb0dd): revoked: orders [0]
❯ kafkacat -b localhost:9092 -G moleculer-emailer-orders orders
% Waiting for group rebalance
% Group moleculer-emailer-orders rebalanced (memberid rdkafka-525bc97b-f3c3-42c1-b605-cd39801e0802): assigned: orders [0]
{ "eventType": "OrderCreated", "order": { "customerId": 61026a41abc3d40013fdd8d0 , "product": "Raspberry Pi 4b", "quantity": 1, "price": 145.00, "state": "Pending" } }
{ "eventType": "OrderCreated", "order": { "customerId": "61026a41abc3d40013fdd8d0", "product": "Raspberry Pi 3", "quantity": 1, "price": 99.00, "state": "Pending" } }
% Reached end of topic orders [0] at offset 2
^C% Group moleculer-emailer-orders rebalanced (memberid rdkafka-525bc97b-f3c3-42c1-b605-cd39801e0802): revoked: orders [0]
```

## License

[![MIT license]](https://lbesson.mit-license.org/)

[building a microservices ecosystem with kafka streams and ksql]:
  https://www.confluent.io/blog/building-a-microservices-ecosystem-with-kafka-streams-and-ksql/
[confluent]: https://www.confluent.io/
[ethereal]: https://ethereal.email/
[httpie]: https://httpie.io/
[jaeger]: https://www.jaegertracing.io/
[kafka]: https://kafka.apache.org/
[kafkacat]: https://github.com/edenhill/kafkacat
[kafka listeners - explained]:
  https://www.confluent.io/blog/kafka-listeners-explained/
[lint code base]:
  https://github.com/sleighzy/moleculer-microservices-spike/workflows/Lint%20Code%20Base/badge.svg
[mit license]: https://img.shields.io/badge/License-MIT-blue.svg
[moleculer]: https://moleculer.services/
[moleculer api gateway]: https://moleculer.services/docs/0.14/moleculer-web.html
[mongodb]: https://www.mongodb.com/
[redis]: https://redis.io/
[slack channel]: https://slack.com/
[traefik]: https://traefik.io/traefik/
