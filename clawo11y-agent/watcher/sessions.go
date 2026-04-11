package watcher

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type SessionEntry struct {
	SessionID  string  `json:"sessionId"`
	Key        string  `json:"key"`
	Label      string  `json:"label,omitempty"`
	Model      string  `json:"model,omitempty"`
	Provider   string  `json:"provider,omitempty"`
	Status     string  `json:"status,omitempty"`
	CreatedAt  int64   `json:"created_at_ms,omitempty"`
	LastActive int64   `json:"last_active_ms,omitempty"`
	TokenCount int     `json:"token_count,omitempty"`
	CostUSD    float64 `json:"cost_usd,omitempty"`
	AgentName  string  `json:"agent_name,omitempty"`
	Channel    string  `json:"channel,omitempty"`
}

type SessionsEvent struct {
	NodeID       string         `json:"node_id"`
	Type         string         `json:"type"`
	Sessions     []SessionEntry `json:"sessions,omitempty"`
	SessionCount int            `json:"session_count"`
	ActiveCount  int            `json:"active_count"`
	Timestamp    time.Time      `json:"timestamp"`
}

type SessionsWatcher struct {
	watcher       *fsnotify.Watcher
	agentsBaseDir string
	eventChan     chan SessionsEvent
	lastHashes    map[string][]byte
	ready         bool
}

func NewSessionsWatcher(agentsBaseDir string, eventChan chan SessionsEvent) *SessionsWatcher {
	return &SessionsWatcher{
		agentsBaseDir: agentsBaseDir,
		eventChan:     eventChan,
		lastHashes:    make(map[string][]byte),
	}
}

func (w *SessionsWatcher) Start() error {
	if w.agentsBaseDir == "" {
		log.Println("Sessions watcher: no agents dir configured")
		return nil
	}

	if err := os.MkdirAll(w.agentsBaseDir, 0755); err != nil {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	if err := w.addAllSessionsJson(); err != nil {
		log.Printf("Warning: failed to watch session indexes: %v", err)
	}

	w.ready = true
	w.emit()
	go w.watchLoop()
	return nil
}

func (w *SessionsWatcher) addAllSessionsJson() error {
	entries, err := os.ReadDir(w.agentsBaseDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		sessionsJson := filepath.Join(w.agentsBaseDir, entry.Name(), "sessions", "sessions.json")
		if _, err := os.Stat(sessionsJson); os.IsNotExist(err) {
			continue
		}
		if err := w.watcher.Add(sessionsJson); err != nil {
			log.Printf("Warning: failed to watch %s: %v", sessionsJson, err)
		} else {
			log.Printf("Sessions watcher: now monitoring %s", sessionsJson)
		}
	}
	return nil
}

func (w *SessionsWatcher) readSessions() (*SessionsEvent, error) {
	entries, err := os.ReadDir(w.agentsBaseDir)
	if err != nil {
		return nil, err
	}

	var allSessions []SessionEntry
	nowMs := time.Now().UnixMilli()
	activeCount := 0

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		sessionsJson := filepath.Join(w.agentsBaseDir, entry.Name(), "sessions", "sessions.json")
		data, err := os.ReadFile(sessionsJson)
		if err != nil {
			continue
		}

		h := data
		w.lastHashes[sessionsJson] = h

		var raw map[string]struct {
			SessionID   string  `json:"sessionId"`
			Label       string  `json:"label,omitempty"`
			Model       string  `json:"model,omitempty"`
			Provider    string  `json:"provider,omitempty"`
			Status      string  `json:"status,omitempty"`
			UpdatedAt   int64   `json:"updatedAt,omitempty"`
			CreatedAt   int64   `json:"createdAt,omitempty"`
			TokenCount  int     `json:"tokenCount,omitempty"`
			CostUSD     float64 `json:"costUsd,omitempty"`
			LastChannel string  `json:"lastChannel,omitempty"`
			Origin      struct {
				Label string `json:"label,omitempty"`
			} `json:"origin,omitempty"`
		}
		if err := json.Unmarshal(data, &raw); err != nil {
			log.Printf("SessionsWatcher: failed to parse %s: %v", sessionsJson, err)
			continue
		}

		agentName := entry.Name()
		for key, s := range raw {
			_ = key
			if s.UpdatedAt > 0 && nowMs-s.UpdatedAt < 5*60*1000 {
				activeCount++
			}
			channel := s.LastChannel
			if channel == "" {
				channel = s.Origin.Label
			}
			allSessions = append(allSessions, SessionEntry{
				SessionID:  s.SessionID,
				Key:        key,
				Label:      s.Label,
				Model:      s.Model,
				Provider:   s.Provider,
				Status:     s.Status,
				CreatedAt:  s.CreatedAt,
				LastActive: s.UpdatedAt,
				TokenCount: s.TokenCount,
				CostUSD:    s.CostUSD,
				AgentName:  agentName,
				Channel:    channel,
			})
		}
	}

	return &SessionsEvent{
		Type:         "sessions_event",
		Sessions:     allSessions,
		SessionCount: len(allSessions),
		ActiveCount:  activeCount,
		Timestamp:    time.Now().UTC(),
	}, nil
}

func (w *SessionsWatcher) emit() {
	if !w.ready {
		return
	}
	event, err := w.readSessions()
	if err != nil || event == nil {
		return
	}
	select {
	case w.eventChan <- *event:
	case <-time.After(5 * time.Second):
		log.Printf("SessionsWatcher: channel full, dropped event after 5s timeout")
	}
}

func (w *SessionsWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if filepath.Base(event.Name) == "sessions.json" && (event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename)) {
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
					if err := w.watcher.Add(event.Name); err != nil {
						log.Printf("Sessions watcher: failed to watch new file %s: %v", event.Name, err)
					}
				}
				w.emit()
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Sessions watcher error: %v", err)
		}
	}
}

func (w *SessionsWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}

func DiscoverAgentNames(agentsBaseDir string) []string {
	var names []string
	entries, err := os.ReadDir(agentsBaseDir)
	if err != nil {
		return names
	}
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			names = append(names, entry.Name())
		}
	}
	return names
}
