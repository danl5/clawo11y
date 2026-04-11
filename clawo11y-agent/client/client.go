package client

import (
	"encoding/json"
	"log"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/danl5/clawo11y/clawo11y-agent/schemas"
)

type ServerClient struct {
	client  *resty.Client
	baseURL string
}

func NewServerClient(baseURL string) *ServerClient {
	return &ServerClient{
		client:  resty.New().SetTimeout(10 * time.Second).SetRetryCount(3).SetRetryWaitTime(1 * time.Second),
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
