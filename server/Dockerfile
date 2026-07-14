FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/

RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY src/data/restaurants src/data/restaurants

EXPOSE 3001

CMD ["npm", "-w", "server", "run", "start"]
