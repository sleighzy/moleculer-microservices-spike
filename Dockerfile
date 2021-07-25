FROM node:16.5.0-slim

ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

COPY package.json .

RUN npm install --production --ignore-scripts

COPY src/ .

CMD ["npm", "start"]
