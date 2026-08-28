FROM node:22-slim

WORKDIR /app

COPY bot/package.json ./
RUN npm install --omit=dev

COPY bot /app

RUN mkdir -p /app/auth_info

CMD ["node", "index.js"]
