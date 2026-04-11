package watcher

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/danl5/clawo11y/clawo11y-agent/schemas"
)

type SessionWatcher struct {
	watcher    *fsnotify.Watcher
	sessionDir string
	eventChan  chan schemas.AgentEventPayload
	knownFiles map[string]int64
	ready      bool
}

func NewSessionWatcher(sessionDir string, eventChan chan schemas.AgentEventPayload) *SessionWatcher {
	return &SessionWatcher{
		sessionDir: sessionDir,
		eventChan:  eventChan,
		knownFiles: make(map[string]int64),
	}
}

func (w *SessionWatcher) Start() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	if err := os.MkdirAll(w.sessionDir, 0755); err != nil {
		return err
	}

	if err := watcher.Add(w.sessionDir); err != nil {
		return err
	}

	if err := w.scanExistingFiles(); err != nil {
		log.Printf("Warning: failed to scan existing session files in %s: %v", w.sessionDir, err)
	}
	w.ready = true

	go w.watchLoop()
	return nil
}

func (w *SessionWatcher) scanExistingFiles() error {
	entries, err := os.ReadDir(w.sessionDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".jsonl") &&
			!strings.Contains(entry.Name(), ".deleted.") &&
			!strings.Contains(entry.Name(), ".reset.") {
			filePath := filepath.Join(w.sessionDir, entry.Name())
			w.knownFiles[filePath] = 0
			w.readNewLines(filePath)
		}
	}
	return nil
}

func (w *SessionWatcher) readNewLines(filePath string) {
	file, err := os.Open(filePath)
	if err != nil {
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return
	}

	lastSize := w.knownFiles[filePath]
	if info.Size() <= lastSize {
		return
	}

	file.Seek(lastSize, 0)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		w.parseAndSend(filePath, line)
	}

	w.knownFiles[filePath] = info.Size()
}

func (w *SessionWatcher) parseAndSend(filePath, line string) {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return
	}

	sessionID := strings.TrimSuffix(filepath.Base(filePath), ".jsonl")
	eventType := w.classifyEvent(raw)
	payload := schemas.AgentEventPayload{
		NodeID:    "",
		SessionID: sessionID,
		EventType: eventType,
		Content:   raw,
		Timestamp: time.Now().UTC(),
	}

	w.enrichWithUsage(raw, &payload)
	w.enrichWithTool(raw, &payload)
	w.enrichWithModel(raw, &payload)

	w.eventChan <- payload
}

func (w *SessionWatcher) classifyEvent(raw map[string]interface{}) string {
	if t, ok := raw["type"].(string); ok {
		return t
	}
	if role, ok := raw["role"].(string); ok {
		switch role {
		case "user":
			return "message"
		case "assistant":
			return "message"
		case "system":
			return "message"
		}
	}
	return "custom"
}

func (w *SessionWatcher) enrichWithUsage(raw map[string]interface{}, payload *schemas.AgentEventPayload) {
	if inputTokens, ok := raw["input_tokens"].(float64); ok {
		payload.InputTokens = int(inputTokens)
	}
	if outputTokens, ok := raw["output_tokens"].(float64); ok {
		payload.OutputTokens = int(outputTokens)
	}
	if cacheRead, ok := raw["cache_read"].(float64); ok {
		payload.CacheRead = int(cacheRead)
	}
	if cacheWrite, ok := raw["cache_write"].(float64); ok {
		payload.CacheWrite = int(cacheWrite)
	}
	if costUSD, ok := raw["cost_usd"].(float64); ok {
		payload.CostUSD = costUSD
	}

	if usage, ok := raw["usage"].(map[string]interface{}); ok {
		if v, ok := usage["input_tokens"].(float64); ok && payload.InputTokens == 0 {
			payload.InputTokens = int(v)
		} else if v, ok := usage["input"].(float64); ok && payload.InputTokens == 0 {
			payload.InputTokens = int(v)
		}

		if v, ok := usage["output_tokens"].(float64); ok && payload.OutputTokens == 0 {
			payload.OutputTokens = int(v)
		} else if v, ok := usage["output"].(float64); ok && payload.OutputTokens == 0 {
			payload.OutputTokens = int(v)
		}

		if v, ok := usage["cache_read_tokens"].(float64); ok && payload.CacheRead == 0 {
			payload.CacheRead = int(v)
		} else if v, ok := usage["cacheRead"].(float64); ok && payload.CacheRead == 0 {
			payload.CacheRead = int(v)
		}

		if v, ok := usage["cache_write_tokens"].(float64); ok && payload.CacheWrite == 0 {
			payload.CacheWrite = int(v)
		} else if v, ok := usage["cacheWrite"].(float64); ok && payload.CacheWrite == 0 {
			payload.CacheWrite = int(v)
		}

		if v, ok := usage["cost_usd"].(float64); ok && payload.CostUSD == 0 {
			payload.CostUSD = v
		} else if costObj, ok := usage["cost"].(map[string]interface{}); ok && payload.CostUSD == 0 {
			if total, ok := costObj["total"].(float64); ok {
				payload.CostUSD = total
			}
		}
	}
}

func (w *SessionWatcher) enrichWithTool(raw map[string]interface{}, payload *schemas.AgentEventPayload) {
	if name, ok := raw["name"].(string); ok {
		payload.ToolName = name
	}
	if tool, ok := raw["tool"].(string); ok {
		payload.ToolName = tool
	}
}

func (w *SessionWatcher) enrichWithModel(raw map[string]interface{}, payload *schemas.AgentEventPayload) {
	if model, ok := raw["model"].(string); ok {
		payload.Model = model
	}
	if provider, ok := raw["provider"].(string); ok {
		payload.Provider = provider
	}
}

func (w *SessionWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) && strings.HasSuffix(event.Name, ".jsonl") {
				w.readNewLines(event.Name)
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Session watcher error: %v", err)
		}
	}
}

func (w *SessionWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}

type MultiSessionWatcher struct {
	sessionDirs []string
	eventChan   chan schemas.AgentEventPayload
	watchers    []*SessionWatcher
}

func NewMultiSessionWatcher(agentsBaseDir string, eventChan chan schemas.AgentEventPayload) *MultiSessionWatcher {
	sessionDirs := discoverSessionDirs(agentsBaseDir)
	return &MultiSessionWatcher{
		sessionDirs: sessionDirs,
		eventChan:   eventChan,
	}
}

func discoverSessionDirs(agentsBaseDir string) []string {
	var dirs []string
	entries, err := os.ReadDir(agentsBaseDir)
	if err != nil {
		log.Printf("discoverSessionDirs: failed to read %s: %v", agentsBaseDir, err)
		return dirs
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		sessionsDir := filepath.Join(agentsBaseDir, entry.Name(), "sessions")
		if info, err := os.Stat(sessionsDir); err == nil && info.IsDir() {
			dirs = append(dirs, sessionsDir)
			log.Printf("discoverSessionDirs: found sessions dir for agent '%s'", entry.Name())
		}
	}
	return dirs
}

func (w *MultiSessionWatcher) Start() error {
	for _, dir := range w.sessionDirs {
		sw := NewSessionWatcher(dir, w.eventChan)
		if err := sw.Start(); err != nil {
			log.Printf("MultiSessionWatcher: failed to start watcher for %s: %v", dir, err)
			continue
		}
		w.watchers = append(w.watchers, sw)
	}
	return nil
}

func (w *MultiSessionWatcher) Stop() {
	for _, sw := range w.watchers {
		sw.Stop()
	}
}
