# legalbridge-migrate — DDL migration runner (Cloud Run Job)
# Build context: migrations/  (see cloudbuild-migrate.yaml)
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Runs pending migrations/NNNN_*.sql against DATABASE_URL, then exits.
CMD ["node", "run.mjs"]
