FROM node:10.23-buster-slim

ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

COPY package.json .

RUN npm install --production

COPY src/ .

CMD ["npm", "start"]
