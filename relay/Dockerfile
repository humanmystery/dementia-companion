FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.ts ./
ENV NODE_ENV=production
CMD ["node", "server.ts"]
