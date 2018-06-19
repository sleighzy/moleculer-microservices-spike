// https://github.com/SOHU-Co/kafka-node

const { config } = require('./config.json');
const fs = require('fs');
// const kafka = require('kafka-node');
const { HighLevelProducer, KeyedMessage, KafkaClient } = require('kafka-node');
const readline = require('readline');

// const HighLevelProducer = kafka.HighLevelProducer;
// const KeyedMessage = kafka.KeyedMessage;
// const KafkaClient = kafka.KafkaClient;

const client = new KafkaClient({
  kafkaHost: config.kafkaHost,
});

// For this demo we just log client errors to the console.
client.on('error', (error) => {
  console.error(error);
});

const producer = new HighLevelProducer(client, {
  // Configuration for when to consider a message as acknowledged, default 1
  requireAcks: 1,
  // The amount of time in milliseconds to wait for all acks before considered, default 100ms
  ackTimeoutMs: 100,
  // Partitioner type (default = 0, random = 1, cyclic = 2, keyed = 3, custom = 4), default 2
  partitionerType: 3,
});

function createPayload(message) {
  return {
    topic: config.topic,
    messages: [message],
    attributes: 1,
    timestamp: Date.now(),
  };
}

// const payloads = [{
//   topic: config.topic,
//   messages: ['test 1', 'test 2'],
//   attributes: 1, // Use GZip compression for the payload.
//   timestamp: Date.now()
// }];
function send(payloads) {
  // Send payloads to Kafka and log result/error
  producer.send(payloads, (error, result) => {
    console.info('Sent payload to Kafka: ', payloads);
    if (error) {
      console.error(error);
    } else {
      // const formattedResult = result[0]
      console.log('result: ', result);
    }
  });
}

producer.on('ready', () => {
  // Create a new payload of messages from log file events.
  // const events = [];

  const inputFile = readline.createInterface({
    input: fs.createReadStream(config.inputFile),
  });

  inputFile.on('line', (line) => {
    // events.push(createPayload(line));
    send([createPayload(line)]);
  });

  inputFile.on('close', () => {
    // send(events);
  });
});

producer.on('error', (error) => {
  console.error(error);
});
