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
	IsHistory  bool    `json:"is_history"`
}

type SessionsEvent struct {
	NodeID       string         `json:"node_id"`
	Type         string         `json:"type"`
	Sessions     []SessionEntry `json:"sessions,omitempty"`
	SessionCount int            `json:"session_count"`
	ActiveCount  int            `json:"active_count"`
	HistoryCount int            `json:"history_count"`
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
		sessionsDir := filepath.Join(w.agentsBaseDir, entry.Name(), "sessions")
		sessionsJson := filepath.Join(sessionsDir, "sessions.json")
		if _, err := os.Stat(sessionsJson); os.IsNotExist(err) {
			continue
		}
		if err := w.watcher.Add(sessionsDir); err != nil {
			log.Printf("Warning: failed to watch %s: %v", sessionsDir, err)
		} else {
			log.Printf("Sessions watcher: now monitoring %s", sessionsDir)
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
	seenSessions := make(map[string]bool)
	activeCount := 0
	historyCount := 0

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		sessionsDir := filepath.Join(w.agentsBaseDir, entry.Name(), "sessions")
		sessionsJson := filepath.Join(sessionsDir, "sessions.json")
		data, err := os.ReadFile(sessionsJson)
		if err != nil {
			continue
		}

		// First, collect all actual files in the sessions directory to determine if a session is history
		sessionFiles, _ := os.ReadDir(sessionsDir)
		activeSessionsMap := make(map[string]bool)
		for _, f := range sessionFiles {
			name := f.Name()
			if strings.Contains(name, ".jsonl") && !strings.Contains(name, ".reset.") && !strings.Contains(name, ".deleted.") {
				// e657a5e2-1ae0-4634-a1f3-2fddb07d58a1.jsonl -> e657a5e2-1ae0-4634-a1f3-2fddb07d58a1
				sessionID := strings.Split(name, ".jsonl")[0]
				activeSessionsMap[sessionID] = true
			}
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

		metadataBySessionID := make(map[string]struct {
			Key        string
			Label      string
			Model      string
			Provider   string
			Status     string
			UpdatedAt  int64
			CreatedAt  int64
			TokenCount int
			CostUSD    float64
			Channel    string
		})

		agentName := entry.Name()
		for key, s := range raw {
			channel := s.LastChannel
			if channel == "" {
				channel = s.Origin.Label
			}
			metadataBySessionID[s.SessionID] = struct {
				Key        string
				Label      string
				Model      string
				Provider   string
				Status     string
				UpdatedAt  int64
				CreatedAt  int64
				TokenCount int
				CostUSD    float64
				Channel    string
			}{
				Key:        key,
				Label:      s.Label,
				Model:      s.Model,
				Provider:   s.Provider,
				Status:     s.Status,
				UpdatedAt:  s.UpdatedAt,
				CreatedAt:  s.CreatedAt,
				TokenCount: s.TokenCount,
				CostUSD:    s.CostUSD,
				Channel:    channel,
			}
		}

		for _, f := range sessionFiles {
			if f.IsDir() {
				continue
			}

			name := f.Name()
			if !strings.Contains(name, ".jsonl") {
				continue
			}

			sessionID := strings.Split(name, ".jsonl")[0]
			if sessionID == "" {
				continue
			}

			sessionKey := agentName + ":" + name
			if seenSessions[sessionKey] {
				continue
			}
			seenSessions[sessionKey] = true

			isHistory := strings.Contains(name, ".reset.") || strings.Contains(name, ".deleted.") || !activeSessionsMap[sessionID]
			if isHistory {
				historyCount++
			} else {
				activeCount++
			}

			meta, ok := metadataBySessionID[sessionID]
			info, statErr := f.Info()
			fileTimeMs := int64(0)
			if statErr == nil {
				fileTimeMs = info.ModTime().UnixMilli()
			}

			status := ""
			if ok {
				status = meta.Status
			}
			if status == "" {
				switch {
				case strings.Contains(name, ".deleted."):
					status = "deleted"
				case strings.Contains(name, ".reset."):
					status = "reset"
				default:
					status = "active"
				}
			}

			createdAt := fileTimeMs
			lastActive := fileTimeMs
			if ok {
				if meta.CreatedAt > 0 {
					createdAt = meta.CreatedAt
				}
				if meta.UpdatedAt > 0 {
					lastActive = meta.UpdatedAt
				}
			}

			key := name
			label := ""
			model := ""
			provider := ""
			tokenCount := 0
			costUSD := 0.0
			channel := ""
			if ok {
				label = meta.Label
				model = meta.Model
				provider = meta.Provider
				tokenCount = meta.TokenCount
				costUSD = meta.CostUSD
				channel = meta.Channel
			}

			allSessions = append(allSessions, SessionEntry{
				SessionID:  sessionID,
				Key:        key,
				Label:      label,
				Model:      model,
				Provider:   provider,
				Status:     status,
				CreatedAt:  createdAt,
				LastActive: lastActive,
				TokenCount: tokenCount,
				CostUSD:    costUSD,
				AgentName:  agentName,
				Channel:    channel,
				IsHistory:  isHistory,
			})
		}
	}

	return &SessionsEvent{
		Type:         "sessions_event",
		Sessions:     allSessions,
		SessionCount: len(allSessions),
		ActiveCount:  activeCount,
		HistoryCount: historyCount,
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
			base := filepath.Base(event.Name)
			isSessionsIndexChange := base == "sessions.json" && (event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename))
			isSessionFileChange := strings.Contains(base, ".jsonl") && (event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) || event.Has(fsnotify.Remove))

			if isSessionsIndexChange || isSessionFileChange {
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
