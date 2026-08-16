FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

USER node
CMD ["node", "src/index.js"]
