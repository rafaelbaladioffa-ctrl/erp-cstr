FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

COPY bot/package.json ./
RUN npm install --omit=dev

COPY bot /app

RUN mkdir -p /app/auth_info

CMD ["node", "index.js"]
