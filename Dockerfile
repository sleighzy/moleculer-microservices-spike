FROM node:16.6.2-slim

ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

COPY package.json .

RUN npm install --production --ignore-scripts

COPY src/ .

CMD ["npm", "start"]
