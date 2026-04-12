.PHONY: all build build-agent build-server build-web clean run-agent run-server dev help build-all-platforms

# Default target
all: build

## 🔨 Build
build: build-agent build-server build-web ## Build all services for current platform

build-agent: ## Build the Go Agent for current platform
	@echo "Building Agent..."
	@cd services/agent && go build -o ../../bin/clawo11y-agent main.go

build-server: ## Build the Go Server for current platform
	@echo "Building Server..."
	@cd services/server && go build -o ../../bin/clawo11y-server main.go

build-web: ## Build the React Web UI
	@echo "Building Web UI..."
	@cd services/web && npm install && npm run build

## 🌍 Cross-Compilation
PLATFORMS := darwin/amd64 darwin/arm64 linux/amd64 linux/arm64 windows/amd64

build-all-platforms: ## Build Go binaries for all platforms (darwin, linux, windows) x (amd64, arm64)
	@echo "Building cross-platform binaries..."
	@for platform in $(PLATFORMS); do \
		GOOS=$${platform%/*}; \
		GOARCH=$${platform#*/}; \
		EXT=""; \
		if [ "$$GOOS" = "windows" ]; then EXT=".exe"; fi; \
		echo "Building Agent for $$GOOS/$$GOARCH..."; \
		cd services/agent && GOOS=$$GOOS GOARCH=$$GOARCH go build -o ../../bin/clawo11y-agent-$$GOOS-$$GOARCH$$EXT main.go && cd ../..; \
		echo "Building Server for $$GOOS/$$GOARCH..."; \
		cd services/server && CGO_ENABLED=0 GOOS=$$GOOS GOARCH=$$GOARCH go build -o ../../bin/clawo11y-server-$$GOOS-$$GOARCH$$EXT main.go && cd ../..; \
	done
	@echo "Cross-compilation complete! Binaries are in the bin/ directory."

## 🧹 Clean
clean: ## Remove build artifacts
	@echo "Cleaning up..."
	@rm -rf bin/
	@rm -rf services/web/dist/

## 🚀 Run (Development)
run-agent: build-agent ## Run the Agent locally
	@echo "Running Agent..."
	@./bin/clawo11y-agent

run-server: build-server ## Run the Server locally
	@echo "Running Server..."
	@./bin/clawo11y-server

dev: ## Start both Server and Web UI in development mode
	@echo "Starting development environment..."
	@# Run server in background, then run web UI
	@cd services/server && go run main.go &
	@cd services/web && npm run dev

## 🛠️ Tidy
tidy: ## Run 'go mod tidy' for all Go modules
	@echo "Tidying Agent module..."
	@cd services/agent && go mod tidy
	@echo "Tidying Server module..."
	@cd services/server && go mod tidy

## ❓ Help
help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
