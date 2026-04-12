# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app/services/web

# Copy package.json and install dependencies
COPY services/web/package*.json ./
RUN npm install

# Copy frontend source and build
COPY services/web/ .
RUN npm run build

# ==========================================
# Stage 2: Build the Go Server
# ==========================================
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy Go module files
COPY services/server/go.mod services/server/go.sum ./services/server/
WORKDIR /app/services/server
RUN go mod download

# Copy the source code
WORKDIR /app
COPY services/server/ ./services/server/

# Build the server binary
WORKDIR /app/services/server
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server-bin .

# ==========================================
# Stage 3: Final Production Image
# ==========================================
FROM alpine:latest
WORKDIR /app

# Install CA certificates for HTTPS requests if needed
RUN apk --no-cache add ca-certificates tzdata

# Copy the compiled Go binary
COPY --from=backend-builder /app/server-bin /app/server

# Copy the built frontend from Stage 1
COPY --from=frontend-builder /app/services/web/dist /app/services/web/dist

# Expose the API and UI port
EXPOSE 8000

# Create data directory for SQLite
RUN mkdir -p /app/data

# Run the server
CMD ["/app/server"]
