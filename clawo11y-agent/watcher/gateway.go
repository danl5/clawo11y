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

	if err := watcher.Add(w.logDir); err != nil {
		return err
	}

	w.scanExisting()
	go w.watchLoop()
	return nil
}

func (w *GatewayLogWatcher) scanExisting() {
	entries, err := os.ReadDir(w.logDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".log") {
			fpath := filepath.Join(w.logDir, entry.Name())
			info, err := os.Stat(fpath)
			if err == nil {
				// Set initial offset to the end of the file so we only tail new lines
				w.knownFiles[fpath] = info.Size()
			}
		}
	}
}

func (w *GatewayLogWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) && strings.HasSuffix(event.Name, ".log") {
				w.readNewLines(event.Name)
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Gateway log watcher error: %v", err)
		}
	}
}

func (w *GatewayLogWatcher) readNewLines(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return
	}

	lastSize := w.knownFiles[path]
	if info.Size() <= lastSize {
		return
	}

	file.Seek(lastSize, 0)
	scanner := bufio.NewScanner(file)
	var lines []map[string]interface{}
	for scanner.Scan() {
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		line := w.parseLine(text)
		if line != nil {
			lines = append(lines, line)
		}
	}
	w.knownFiles[path] = info.Size()

	if len(lines) > 0 {
		select {
		case w.eventChan <- GatewayLogEvent{Type: "gateway.log", LogPath: path, Lines: lines, Timestamp: time.Now().UTC()}:
		case <-time.After(5 * time.Second):
			log.Printf("GatewayLogWatcher: channel full, dropped event after 5s timeout")
		}
	}
}

func (w *GatewayLogWatcher) parseLine(text string) map[string]interface{} {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		return map[string]interface{}{"raw_text": text}
	}
	return raw
}

func (w *GatewayLogWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}
