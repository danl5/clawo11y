package client

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/danl5/clawo11y/services/agent/schemas"
	"github.com/go-resty/resty/v2"
)

type ServerClient struct {
	client  *resty.Client
	baseURL string
}

type ClientOptions struct {
	Timeout       time.Duration
	RetryCount    int
	RetryWaitTime time.Duration
}

func NewServerClient(baseURL string, opts *ClientOptions) *ServerClient {
	timeout := 10 * time.Second
	retryCount := 3
	retryWaitTime := 1 * time.Second
	if opts != nil {
		if opts.Timeout > 0 {
			timeout = opts.Timeout
		}
		if opts.RetryCount >= 0 {
			retryCount = opts.RetryCount
		}
		if opts.RetryWaitTime > 0 {
			retryWaitTime = opts.RetryWaitTime
		}
	}
	return &ServerClient{
		client:  resty.New().SetTimeout(timeout).SetRetryCount(retryCount).SetRetryWaitTime(retryWaitTime),
		baseURL: baseURL,
	}
}

func (c *ServerClient) RegisterNode(info schemas.NodeInfo) error {
	resp, err := c.client.R().
		SetBody(info).
		Post(c.baseURL + "/api/v1/nodes/register")

	if err != nil {
		return err
	}
	if resp.IsError() {
		log.Printf("Failed to register node: HTTP %d", resp.StatusCode())
	}
	return nil
}

func (c *ServerClient) SendMetrics(metrics schemas.SystemMetricsPayload) error {
	return c.sendJSON("/api/v1/metrics/", metrics)
}

func (c *ServerClient) SendAgentEvent(event schemas.AgentEventPayload) error {
	return c.sendJSON("/api/v1/events/", event)
}

func (c *ServerClient) SendWorkspaceEvent(event schemas.WorkspaceEventPayload) error {
	return c.sendJSON("/api/v1/events/workspace/", event)
}

func (c *ServerClient) SendCronEvent(event schemas.CronEventPayload) error {
	return c.sendJSON("/api/v1/events/cron/", event)
}

func (c *ServerClient) SendSessionsEvent(event schemas.SessionsEventPayload) error {
	return c.sendJSON("/api/v1/events/sessions/", event)
}

func (c *ServerClient) SendGatewayLogEvent(event schemas.GatewayLogEventPayload) error {
	return c.sendJSON("/api/v1/events/gateway/", event)
}

func (c *ServerClient) SendHealthHistoryEvent(event schemas.HealthHistoryEventPayload) error {
	return c.sendJSON("/api/v1/events/health/", event)
}

func (c *ServerClient) SendOtlpData(endpoint string, payload []byte) error {
	resp, err := c.client.R().
		SetHeader("Content-Type", "application/x-protobuf").
		SetBody(payload).
		Post(c.baseURL + endpoint)

	if err != nil {
		return err
	}
	if resp.IsError() {
		return fmt.Errorf("HTTP %d", resp.StatusCode())
	}
	return nil
}

func (c *ServerClient) sendJSON(endpoint string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := c.client.R().
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(c.baseURL + endpoint)

	if err != nil {
		return err
	}
	if resp.IsError() {
		log.Printf("Failed to send to %s: HTTP %d", endpoint, resp.StatusCode())
	}
	return nil
}
