package watcher

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type GatewayLogEvent struct {
	NodeID    string                   `json:"node_id"`
	Type      string                   `json:"type"`
	LogPath   string                   `json:"log_path"`
	Lines     []map[string]interface{} `json:"lines,omitempty"`
	Error     string                   `json:"error,omitempty"`
	Timestamp time.Time                `json:"timestamp"`
}

type GatewayLogWatcher struct {
	watcher    *fsnotify.Watcher
	logDir     string
	eventChan  chan GatewayLogEvent
	knownFiles map[string]int64
}

func NewGatewayLogWatcher(logDir string, eventChan chan GatewayLogEvent) *GatewayLogWatcher {
	return &GatewayLogWatcher{
		logDir:     logDir,
		eventChan:  eventChan,
		knownFiles: make(map[string]int64),
	}
}

func (w *GatewayLogWatcher) Start() error {
	if w.logDir == "" {
		log.Println("Gateway log watcher: no log dir configured")
		return nil
	}

	if err := os.MkdirAll(w.logDir, 0755); err != nil {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	if err := w.addWatchDirs(w.logDir); err != nil {
		return err
	}

	w.scanExisting()
	go w.watchLoop()
	return nil
}

func (w *GatewayLogWatcher) addWatchDirs(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if err := w.watcher.Add(path); err != nil {
				log.Printf("Gateway log watcher: failed to watch %s: %v", path, err)
			}
		}
		return nil
	})
}

func (w *GatewayLogWatcher) scanExisting() {
	w.loadState()
	_ = filepath.Walk(w.logDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if isGatewayLogFile(path) {
			if offset, ok := w.knownFiles[path]; ok {
				if offset > info.Size() {
					w.knownFiles[path] = 0
				}
				if count := w.readNewLines(path); count == 0 && info.Size() > 0 {
					w.emitTailSnapshot(path, 100)
				}
			} else {
				w.knownFiles[path] = 0
				w.readNewLines(path)
			}
		}
		return nil
	})
	w.saveState()
}

func (w *GatewayLogWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = w.addWatchDirs(event.Name)
					continue
				}
			}
			if isGatewayLogFile(event.Name) {
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
					w.knownFiles[event.Name] = 0
				}
				if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
					w.readNewLines(event.Name)
				}
				if event.Has(fsnotify.Remove) {
					delete(w.knownFiles, event.Name)
					w.saveState()
				}
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Gateway log watcher error: %v", err)
		}
	}
}

func isGatewayLogFile(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	return strings.Contains(base, "openclaw") && strings.Contains(base, ".log")
}

func (w *GatewayLogWatcher) readNewLines(path string) int {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return 0
	}

	lastSize := w.knownFiles[path]

	if info.Size() < lastSize {
		lastSize = 0
	}
	if info.Size() == lastSize {
		return 0
	}

	if _, err := file.Seek(lastSize, 0); err != nil {
		return 0
	}
	reader := bufio.NewReader(file)
	currentOffset := lastSize
	var lines []map[string]interface{}
	totalLines := 0
	const batchSize = 200
	for {
		chunk, err := reader.ReadString('\n')
		if len(chunk) > 0 {
			currentOffset += int64(len(chunk))
			text := strings.TrimSpace(chunk)
			if text != "" {
				line := w.parseLine(path, text)
				if line != nil {
					lines = append(lines, line)
					totalLines++
				}
			}
			if len(lines) >= batchSize {
				w.emitLines(path, lines)
				lines = nil
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("Gateway log watcher read error for %s: %v", path, err)
			break
		}
	}

	w.knownFiles[path] = currentOffset
	w.saveState()
	w.emitLines(path, lines)
	return totalLines
}

func (w *GatewayLogWatcher) emitLines(path string, lines []map[string]interface{}) {
	if len(lines) == 0 {
		return
	}
	select {
	case w.eventChan <- GatewayLogEvent{Type: "gateway.log", LogPath: path, Lines: lines, Timestamp: time.Now().UTC()}:
	case <-time.After(5 * time.Second):
		log.Printf("GatewayLogWatcher: channel full, dropped event after 5s timeout")
	}
}

func (w *GatewayLogWatcher) emitTailSnapshot(path string, maxLines int) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	buffer := make([]string, 0, maxLines)
	for {
		chunk, err := reader.ReadString('\n')
		if len(chunk) > 0 {
			text := strings.TrimSpace(chunk)
			if text != "" {
				if len(buffer) == maxLines {
					buffer = append(buffer[1:], text)
				} else {
					buffer = append(buffer, text)
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return
		}
	}

	lines := make([]map[string]interface{}, 0, len(buffer))
	for _, text := range buffer {
		line := w.parseLine(path, text)
		if line != nil {
			line["snapshot"] = true
			lines = append(lines, line)
		}
	}
	w.emitLines(path, lines)
}

func (w *GatewayLogWatcher) stateFilePath() string {
	return filepath.Join(w.logDir, ".o11y-gateway-state.json")
}

func (w *GatewayLogWatcher) loadState() {
	data, err := os.ReadFile(w.stateFilePath())
	if err != nil {
		return
	}
	var state map[string]int64
	if err := json.Unmarshal(data, &state); err != nil {
		return
	}
	for path, offset := range state {
		w.knownFiles[path] = offset
	}
}

func (w *GatewayLogWatcher) saveState() {
	data, err := json.Marshal(w.knownFiles)
	if err != nil {
		return
	}
	_ = os.WriteFile(w.stateFilePath(), data, 0644)
}

func (w *GatewayLogWatcher) parseLine(path string, text string) map[string]interface{} {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		return map[string]interface{}{
			"source":   filepath.Base(path),
			"log_path": path,
			"level":    detectLevelFromText(text),
			"message":  text,
			"raw_text": text,
		}
	}
	line := map[string]interface{}{
		"source":   filepath.Base(path),
		"log_path": path,
		"raw_text": text,
	}
	for k, v := range raw {
		line[k] = v
	}
	if _, ok := line["level"]; !ok {
		if level := firstString(raw, "severity", "lvl", "status"); level != "" {
			line["level"] = normalizeLevel(level)
		} else {
			line["level"] = "info"
		}
	} else if level, ok := line["level"].(string); ok {
		line["level"] = normalizeLevel(level)
	}
	if _, ok := line["message"]; !ok {
		if msg := firstString(raw, "msg", "error", "err", "event"); msg != "" {
			line["message"] = msg
		}
	}
	if _, ok := line["timestamp"]; !ok {
		if ts := firstString(raw, "time", "ts", "@timestamp"); ts != "" {
			line["timestamp"] = ts
		}
	}
	if _, ok := line["logger"]; !ok {
		if logger := firstString(raw, "module", "component"); logger != "" {
			line["logger"] = logger
		}
	}
	if _, ok := line["service"]; !ok {
		if service := firstString(raw, "app", "source_name"); service != "" {
			line["service"] = service
		}
	}
	return line
}

func firstString(raw map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func normalizeLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "warning":
		return "warn"
	case "fatal", "panic":
		return "error"
	case "":
		return "info"
	default:
		return strings.ToLower(strings.TrimSpace(level))
	}
}

func detectLevelFromText(text string) string {
	upper := strings.ToUpper(text)
	switch {
	case strings.Contains(upper, "ERROR"), strings.Contains(upper, "FATAL"), strings.Contains(upper, "PANIC"):
		return "error"
	case strings.Contains(upper, "WARN"):
		return "warn"
	case strings.Contains(upper, "DEBUG"), strings.Contains(upper, "TRACE"):
		return "debug"
	default:
		return "info"
	}
}

func (w *GatewayLogWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}
