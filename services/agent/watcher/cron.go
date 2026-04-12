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
)

type CronRunRecord struct {
	Timestamp int64  `json:"ts"`
	Status    string `json:"status"`
	Summary   string `json:"summary,omitempty"`
	Error     string `json:"error,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Duration  int64  `json:"durationMs,omitempty"`
}

type CronJob struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Schedule   interface{}     `json:"schedule"`
	Enabled    bool            `json:"enabled"`
	Payload    interface{}     `json:"payload,omitempty"`
	LastRun    int64           `json:"lastRunMs,omitempty"`
	NextRun    int64           `json:"nextRunMs,omitempty"`
	RunCount   int             `json:"runCount,omitempty"`
	ErrorCount int             `json:"errorCount,omitempty"`
	RecentRuns []CronRunRecord `json:"recent_runs,omitempty"`
}

type CronEvent struct {
	NodeID    string    `json:"node_id"`
	Type      string    `json:"type"`
	Jobs      []CronJob `json:"jobs,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type CronWatcher struct {
	watcher   *fsnotify.Watcher
	cronPath  string
	eventChan chan CronEvent
	ready     bool
}

func NewCronWatcher(cronPath string, eventChan chan CronEvent) *CronWatcher {
	return &CronWatcher{
		cronPath:  cronPath,
		eventChan: eventChan,
	}
}

func (w *CronWatcher) Start() error {
	if w.cronPath == "" {
		log.Println("Cron watcher: no cron path configured")
		return nil
	}

	cronDir := filepath.Dir(w.cronPath)
	if err := os.MkdirAll(cronDir, 0755); err != nil {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	if err := watcher.Add(cronDir); err != nil {
		return err
	}
	runsDir := filepath.Join(cronDir, "runs")
	if info, err := os.Stat(runsDir); err == nil && info.IsDir() {
		watcher.Add(runsDir)
	}

	w.ready = true
	w.emitJobs()
	go w.watchLoop()
	return nil
}

func (w *CronWatcher) readJobs() ([]CronJob, error) {
	data, err := os.ReadFile(w.cronPath)
	if err != nil {
		return nil, err
	}

	var raw struct {
		Jobs []CronJob `json:"jobs"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	cronDir := filepath.Dir(w.cronPath)
	for i := range raw.Jobs {
		j := &raw.Jobs[i]

		// Parse run history from runs/ directory
		runFile := filepath.Join(cronDir, "runs", j.ID+".jsonl")
		f, err := os.Open(runFile)
		if err == nil {
			runCount := 0
			errCount := 0
			var runs []CronRunRecord

			scanner := bufio.NewScanner(f)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				var rec struct {
					Action    string `json:"action"`
					Status    string `json:"status"`
					Summary   string `json:"summary"`
					Error     string `json:"error"`
					Ts        int64  `json:"ts"`
					Duration  int64  `json:"durationMs"`
					SessionID string `json:"sessionId"`
				}
				if err := json.Unmarshal([]byte(line), &rec); err == nil && rec.Action == "finished" {
					runCount++
					if rec.Status == "error" {
						errCount++
					}
					// keep latest 5000 to allow full pagination on web
					runs = append(runs, CronRunRecord{
						Timestamp: rec.Ts,
						Status:    rec.Status,
						Summary:   rec.Summary,
						Error:     rec.Error,
						SessionID: rec.SessionID,
						Duration:  rec.Duration,
					})
					if len(runs) > 5000 {
						runs = runs[1:]
					}
				}
			}
			f.Close()

			j.RunCount = runCount
			j.ErrorCount = errCount
			j.RecentRuns = runs
			if len(runs) > 0 {
				j.LastRun = runs[len(runs)-1].Timestamp
			}
		}
	}

	return raw.Jobs, nil
}

func (w *CronWatcher) emitJobs() {
	if !w.ready {
		return
	}
	jobs, err := w.readJobs()
	if err != nil || jobs == nil {
		return
	}
	select {
	case w.eventChan <- CronEvent{Type: "cron_event", Jobs: jobs, Timestamp: time.Now().UTC()}:
	case <-time.After(5 * time.Second):
		log.Printf("CronWatcher: channel full, dropped event after 5s timeout")
	}
}

func (w *CronWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
				base := filepath.Base(event.Name)
				if base == filepath.Base(w.cronPath) || strings.HasSuffix(base, ".jsonl") {
					w.emitJobs()
				}
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Cron watcher error: %v", err)
		}
	}
}

func (w *CronWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}
