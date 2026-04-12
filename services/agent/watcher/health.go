package watcher

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
)

type HealthSnapshot struct {
	Timestamp int64   `json:"timestamp"`
	CPU       float64 `json:"cpu_percent"`
	RAM       float64 `json:"ram_percent"`
	Disk      float64 `json:"disk_percent"`
	TempCPU   float64 `json:"temp_cpu,omitempty"`
}

type HealthHistoryEvent struct {
	NodeID    string           `json:"node_id"`
	Type      string           `json:"type"`
	Snapshots []HealthSnapshot `json:"snapshots"`
	Count     int              `json:"count"`
	Timestamp time.Time        `json:"timestamp"`
}

type HealthHistoryWatcher struct {
	watcher   *fsnotify.Watcher
	filePath  string
	eventChan chan HealthHistoryEvent
}

func NewHealthHistoryWatcher(healthHistoryPath string, eventChan chan HealthHistoryEvent) *HealthHistoryWatcher {
	return &HealthHistoryWatcher{
		filePath:  healthHistoryPath,
		eventChan: eventChan,
	}
}

func (w *HealthHistoryWatcher) Start() error {
	if w.filePath == "" {
		log.Println("Health history watcher: no health history path configured")
		return nil
	}

	dir := filepath.Dir(w.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	if err := watcher.Add(dir); err != nil {
		return err
	}

	w.emit()
	go w.watchLoop()
	return nil
}

func (w *HealthHistoryWatcher) emit() {
	data, err := os.ReadFile(w.filePath)
	if err != nil {
		return
	}

	var raw []HealthSnapshot
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}

	if len(raw) == 0 {
		return
	}

	// Keep last 288 entries (24h at 5min intervals)
	snapshots := raw
	if len(snapshots) > 288 {
		snapshots = raw[len(raw)-288:]
	}

	select {
	case w.eventChan <- HealthHistoryEvent{
		Type:      "health_history.update",
		Snapshots: snapshots,
		Count:     len(snapshots),
		Timestamp: time.Now().UTC(),
	}:
	default:
	}
}

func (w *HealthHistoryWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if filepath.Base(event.Name) == filepath.Base(w.filePath) && (event.Has(fsnotify.Write) || event.Has(fsnotify.Create)) {
				w.emit()
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Health history watcher error: %v", err)
		}
	}
}

func (w *HealthHistoryWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}
