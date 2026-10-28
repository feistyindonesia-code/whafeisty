FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-migrations ./dist-migrations
RUN mkdir -p /app/sessions /app/uploads /app/private_uploads/payments /app/private_uploads/media \
    && chown -R node:node /app

EXPOSE 4000

USER node

CMD ["node", "dist/app.js"]
