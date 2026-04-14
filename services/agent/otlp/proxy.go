package otlp

import (
	"io"
	"log"
	"net/http"
	"time"

	"github.com/danl5/clawo11y/services/agent/client"
)

type payloadItem struct {
	endpoint string
	data     []byte
}

type OtlpProxy struct {
	serverClient *client.ServerClient
	queue        chan payloadItem
	retryInterval time.Duration
}

type ProxyOptions struct {
	QueueSize     int
	RetryInterval time.Duration
}

func NewOtlpProxy(serverClient *client.ServerClient, opts *ProxyOptions) *OtlpProxy {
	queueSize := 5000
	retryInterval := 5 * time.Second
	if opts != nil {
		if opts.QueueSize > 0 {
			queueSize = opts.QueueSize
		}
		if opts.RetryInterval > 0 {
			retryInterval = opts.RetryInterval
		}
	}
	return &OtlpProxy{
		serverClient: serverClient,
		queue:        make(chan payloadItem, queueSize),
		retryInterval: retryInterval,
	}
}

func (p *OtlpProxy) Start(addr string) error {
	// Start the background worker for forwarding data with retries
	go p.worker()

	mux := http.NewServeMux()

	// Support all three OpenTelemetry signals
	mux.HandleFunc("/v1/traces", p.handle("/api/v1/otlp/traces"))
	mux.HandleFunc("/v1/metrics", p.handle("/api/v1/otlp/metrics"))
	mux.HandleFunc("/v1/logs", p.handle("/api/v1/otlp/logs"))

	log.Printf("Agent OTLP proxy listening on %s", addr)
	return http.ListenAndServe(addr, mux)
}

func (p *OtlpProxy) worker() {
	for item := range p.queue {
		// Infinite retry loop for each item
		for {
			err := p.serverClient.SendOtlpData(item.endpoint, item.data)
			if err == nil {
				// Success, break the retry loop and move to the next item
				break
			}

			log.Printf("Failed to forward OTLP data to %s: %v. Retrying in %s...", item.endpoint, err, p.retryInterval)
			time.Sleep(p.retryInterval)
		}
	}
}

func (p *OtlpProxy) handle(targetEndpoint string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		// Non-blocking enqueue to memory buffer
		select {
		case p.queue <- payloadItem{endpoint: targetEndpoint, data: body}:
			// Successfully queued
		default:
			// Queue is full, drop the data (safeguard against memory leak)
			log.Printf("Warning: OTLP proxy queue full, dropping payload for %s", targetEndpoint)
		}

		// Immediately return 200 OK to OpenClaw Agent
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
	}
}
