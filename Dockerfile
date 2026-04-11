# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:18-alpine AS frontend-builder
WORKDIR /app/web

# Copy package.json and install dependencies
COPY web/package*.json ./
RUN npm install

# Copy frontend source and build
COPY web/ .
RUN npm run build

# ==========================================
# Stage 2: Build the Python Server
# ==========================================
FROM python:3.10-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python backend source
COPY core/ /app/core/

# Copy the built frontend from Stage 1
COPY --from=frontend-builder /app/web/dist /app/web/dist

# Set environment variables
ENV PYTHONPATH=/app
ENV O11Y_DB_URL="sqlite:////app/data/o11y_server.db"

# Expose the API and UI port
EXPOSE 8000

# Create data directory for SQLite
RUN mkdir -p /app/data

# Run the server
CMD ["python", "-m", "core.server.main"]
