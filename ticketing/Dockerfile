FROM node:20-alpine

WORKDIR /app

COPY ticketing/package.json ticketing/package-lock.json ./

RUN npm ci --omit=dev

COPY ticketing/server/ ./server/

EXPOSE 3001

CMD ["node", "--import", "./server/instrumentation.mjs", "./server/index.js"]