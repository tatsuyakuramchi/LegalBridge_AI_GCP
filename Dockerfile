# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend assets
RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the built frontend
COPY --from=builder /app/dist ./dist

# Copy the server and source code (since we run server.ts directly)
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/templates ./templates

# Node needs tsx to run .ts files if we aren't compiling to JS
# But we can also use Node 22's native (experimental) TS support or just install tsx
RUN npm install tsx

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start the server using tsx to handle .ts imports correctly in ESM
CMD ["npx", "tsx", "server.ts"]
