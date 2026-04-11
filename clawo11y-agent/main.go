package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/danl5/clawo11y/clawo11y-agent/client"
	"github.com/danl5/clawo11y/clawo11y-agent/monitor"
	"github.com/danl5/clawo11y/clawo11y-agent/schemas"
	"github.com/danl5/clawo11y/clawo11y-agent/watcher"
)

const (
	chanBufferSize = 50000
	metricsBufSize = 100
)

func detectOpenClawDirs() (agentsBaseDir, cronPath, workspaceBaseDir, gatewayLogDir string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", "", ""
	}
	baseDir := filepath.Join(home, ".openclaw")

	agentsBaseDir = filepath.Join(baseDir, "agents")
	cronPath = filepath.Join(baseDir, "cron/jobs.json")
	gatewayLogDir = filepath.Join(baseDir, "logs")

	if _, err := os.Stat(filepath.Join(baseDir, "logs")); os.IsNotExist(err) {
		if info, err := os.Stat("/tmp/moltbot"); err == nil && info.IsDir() {
			gatewayLogDir = "/tmp/moltbot"
		}
	}

	workspaceBaseDir = baseDir
	return
}

func main() {
	serverURL := os.Getenv("O11Y_SERVER_URL")
	if serverURL == "" {
		serverURL = "http://127.0.0.1:8000"
	}

	agentsBaseDir, cronPath, workspaceBaseDir, gatewayLogDir := detectOpenClawDirs()

	log.Printf("Detected paths — agents: %s, cron: %s, workspaceBase: %s, gateway_logs: %s",
		agentsBaseDir, cronPath, workspaceBaseDir, gatewayLogDir)

	sysMonitor := monitor.NewSystemMonitor()
	nodeInfo := sysMonitor.GetNodeInfo()
	srvClient := client.NewServerClient(serverURL)

	log.Printf("Starting OpenClaw O11y Agent for node: %s", nodeInfo.NodeID)

	for i := 0; i < 5; i++ {
		if err := srvClient.RegisterNode(nodeInfo); err != nil {
			log.Printf("Failed to register (attempt %d/5): %v", i+1, err)
			time.Sleep(2 * time.Second)
		} else {
			log.Println("Successfully registered with server.")
			break
		}
	}

	sessionEventChan := make(chan schemas.AgentEventPayload, chanBufferSize)
	multiSessionWatcher := watcher.NewMultiSessionWatcher(agentsBaseDir, sessionEventChan)
	if err := multiSessionWatcher.Start(); err != nil {
		log.Printf("MultiSessionWatcher failed: %v", err)
	} else {
		log.Printf("MultiSessionWatcher started")
	}

	workspaceEventChan := make(chan watcher.WorkspaceEvent, 100)
	workspaceWatcher := watcher.NewWorkspaceWatcher(
		workspaceBaseDir,
		workspaceEventChan,
	)
	if err := workspaceWatcher.Start(); err != nil {
		log.Printf("Workspace watcher failed: %v", err)
	}

	cronEventChan := make(chan watcher.CronEvent, 100)
	cronWatcher := watcher.NewCronWatcher(cronPath, cronEventChan)
	if err := cronWatcher.Start(); err != nil {
		log.Printf("Cron watcher failed: %v", err)
	}

	sessionsEventChan := make(chan watcher.SessionsEvent, 100)
	sessionsWatcher := watcher.NewSessionsWatcher(agentsBaseDir, sessionsEventChan)
	if err := sessionsWatcher.Start(); err != nil {
		log.Printf("Sessions watcher failed: %v", err)
	}

	gatewayEventChan := make(chan watcher.GatewayLogEvent, 100)
	gatewayWatcher := watcher.NewGatewayLogWatcher(gatewayLogDir, gatewayEventChan)
	if err := gatewayWatcher.Start(); err != nil {
		log.Printf("Gateway log watcher failed: %v", err)
	}

	metricsChan := make(chan schemas.SystemMetricsPayload, metricsBufSize)

	// Metrics collector goroutine — isolated so it doesn't block on slow sends
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		// Send an initial metric immediately on boot
		initialMetrics := sysMonitor.GetMetrics()

		// Fake a point 60s ago to allow React Recharts to draw a line immediately
		pastMetrics := initialMetrics
		pastMetrics.Timestamp = time.Now().Add(-60 * time.Second).UTC()
		metricsChan <- pastMetrics

		metricsChan <- initialMetrics

		for {
			<-ticker.C
			metrics := sysMonitor.GetMetrics()
			select {
			case metricsChan <- metrics:
			default:
				// Drop if full — metrics are less critical than events
			}
		}
	}()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	log.Println("Agent running... Press Ctrl+C to exit.")

	for {
		select {
		case m, ok := <-metricsChan:
			if !ok {
				continue
			}
			if err := srvClient.SendMetrics(m); err != nil {
				log.Printf("Error sending metrics: %v", err)
			} else {
				log.Printf("Metrics: CPU %.1f%% RAM %.0fMB Load %.2f",
					m.CPUPercent, m.RAMUsedMB, m.LoadAvg1m)
			}

		case ev, ok := <-sessionEventChan:
			if !ok {
				continue
			}
			ev.NodeID = nodeInfo.NodeID
			go func(e schemas.AgentEventPayload) {
				if err := srvClient.SendAgentEvent(e); err != nil {
					log.Printf("Error sending session event: %v", err)
				} else if e.EventType == "token_usage" {
					log.Printf("Token usage: %s %s in=%d out=%d cost=$%.6f",
						e.SessionID, e.Model, e.InputTokens, e.OutputTokens, e.CostUSD)
				}
			}(ev)

		case ev, ok := <-workspaceEventChan:
			if !ok {
				continue
			}
			ev.NodeID = nodeInfo.NodeID
			if err := srvClient.SendWorkspaceEvent(toWorkspacePayload(ev)); err != nil {
				log.Printf("Error sending workspace event: %v", err)
			} else {
				log.Printf("Workspace event: %s", ev.Type)
			}

		case ev, ok := <-cronEventChan:
			if !ok {
				continue
			}
			ev.NodeID = nodeInfo.NodeID
			if err := srvClient.SendCronEvent(toCronPayload(ev)); err != nil {
				log.Printf("Error sending cron event: %v", err)
			} else {
				log.Printf("Cron event: %d jobs tracked", len(ev.Jobs))
			}

		case ev, ok := <-sessionsEventChan:
			if !ok {
				continue
			}
			ev.NodeID = nodeInfo.NodeID
			if err := srvClient.SendSessionsEvent(toSessionsPayload(ev)); err != nil {
				log.Printf("Error sending sessions event: %v", err)
			} else {
				log.Printf("Sessions: %d total, %d active",
					ev.SessionCount, ev.ActiveCount)
			}

		case ev, ok := <-gatewayEventChan:
			if !ok {
				continue
			}
			ev.NodeID = nodeInfo.NodeID
			if err := srvClient.SendGatewayLogEvent(toGatewayPayload(ev)); err != nil {
				log.Printf("Error sending gateway log event: %v", err)
			}

		case sig := <-sigs:
			log.Printf("Shutting down (signal: %s)...", sig)
			multiSessionWatcher.Stop()
			workspaceWatcher.Stop()
			cronWatcher.Stop()
			sessionsWatcher.Stop()
			gatewayWatcher.Stop()
			os.Exit(0)
		}
	}
}

func toWorkspacePayload(ev watcher.WorkspaceEvent) schemas.WorkspaceEventPayload {
	files := make([]schemas.WorkspaceFilePayload, len(ev.Files))
	for i, f := range ev.Files {
		files[i] = schemas.WorkspaceFilePayload{
			Path:     f.Path,
			Filename: f.Filename,
			Type:     f.Type,
			Content:  f.Content,
		}
	}
	var summary *schemas.WorkspaceSummary
	if ev.Summary != nil {
		summary = &schemas.WorkspaceSummary{
			AgentName:    ev.Summary.AgentName,
			MemoryExists: ev.Summary.MemoryExists,
		}
	}
	return schemas.WorkspaceEventPayload{
		NodeID:    ev.NodeID,
		Type:      ev.Type,
		Files:     files,
		Summary:   summary,
		Timestamp: ev.Timestamp,
	}
}

func toCronPayload(ev watcher.CronEvent) schemas.CronEventPayload {
	jobs := make([]schemas.CronJob, len(ev.Jobs))
	for i, j := range ev.Jobs {
		runs := make([]schemas.CronRunRecord, len(j.RecentRuns))
		for k, r := range j.RecentRuns {
			runs[k] = schemas.CronRunRecord{
				Timestamp: r.Timestamp,
				Status:    r.Status,
				Summary:   r.Summary,
				Error:     r.Error,
				SessionID: r.SessionID,
				Duration:  r.Duration,
			}
		}
		jobs[i] = schemas.CronJob{
			ID:         j.ID,
			Name:       j.Name,
			Schedule:   j.Schedule,
			Enabled:    j.Enabled,
			Payload:    j.Payload,
			LastRunMs:  j.LastRun,
			NextRunMs:  j.NextRun,
			RunCount:   j.RunCount,
			ErrorCount: j.ErrorCount,
			RecentRuns: runs,
		}
	}
	return schemas.CronEventPayload{
		NodeID:    ev.NodeID,
		Type:      ev.Type,
		Jobs:      jobs,
		Timestamp: ev.Timestamp,
	}
}

func toSessionsPayload(ev watcher.SessionsEvent) schemas.SessionsEventPayload {
	sessions := make([]schemas.SessionEntry, len(ev.Sessions))
	for i, s := range ev.Sessions {
		sessions[i] = schemas.SessionEntry{
			SessionID:    s.SessionID,
			Key:          s.Key,
			Label:        s.Label,
			Model:        s.Model,
			Provider:     s.Provider,
			Status:       s.Status,
			CreatedAtMs:  s.CreatedAt,
			LastActiveMs: s.LastActive,
			TokenCount:   s.TokenCount,
			CostUSD:      s.CostUSD,
			AgentName:    s.AgentName,
			Channel:      s.Channel,
		}
	}
	return schemas.SessionsEventPayload{
		NodeID:       ev.NodeID,
		Type:         ev.Type,
		Sessions:     sessions,
		SessionCount: ev.SessionCount,
		ActiveCount:  ev.ActiveCount,
		Timestamp:    ev.Timestamp,
	}
}

func toGatewayPayload(ev watcher.GatewayLogEvent) schemas.GatewayLogEventPayload {
	return schemas.GatewayLogEventPayload{
		NodeID:    ev.NodeID,
		Type:      ev.Type,
		LogPath:   ev.LogPath,
		Lines:     ev.Lines,
		Timestamp: ev.Timestamp,
	}
}

func toHealthPayload(ev watcher.HealthHistoryEvent) schemas.HealthHistoryEventPayload {
	snapshots := make([]schemas.HealthSnapshot, len(ev.Snapshots))
	for i, s := range ev.Snapshots {
		snapshots[i] = schemas.HealthSnapshot{
			Timestamp: s.Timestamp,
			CPU:       s.CPU,
			RAM:       s.RAM,
			Disk:      s.Disk,
			TempCPU:   s.TempCPU,
		}
	}
	return schemas.HealthHistoryEventPayload{
		NodeID:    ev.NodeID,
		Type:      ev.Type,
		Snapshots: snapshots,
		Count:     ev.Count,
		Timestamp: ev.Timestamp,
	}
}
