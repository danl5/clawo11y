package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type WorkspaceFile struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Type     string `json:"type"`
	Content  string `json:"content,omitempty"`
}

type WorkspaceSummary struct {
	AgentName     string `json:"agent_name"`
	SoulExists    bool   `json:"soul_exists"`
	AgentsExists  bool   `json:"agents_exists"`
	MemoryExists  bool   `json:"memory_exists"`
	StateExists   bool   `json:"state_exists"`
	SoulContent   string `json:"soul_content,omitempty"`
	AgentsContent string `json:"agents_content,omitempty"`
	StateContent  string `json:"state_content,omitempty"`
	HeartbeatMs   int64  `json:"heartbeat_ms_ago"`
	DailyNotes    int    `json:"daily_notes_count"`
}

type WorkspaceEvent struct {
	NodeID    string            `json:"node_id"`
	Type      string            `json:"type"`
	Files     []WorkspaceFile   `json:"files,omitempty"`
	Summary   *WorkspaceSummary `json:"summary,omitempty"`
	Timestamp time.Time         `json:"timestamp"`
}

func readFileContent(path string, maxBytes int) string {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return ""
	}
	size := info.Size()
	if size > int64(maxBytes) {
		size = int64(maxBytes)
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, size)
	n, _ := f.Read(buf)
	return string(buf[:n])
}

type WorkspaceWatcher struct {
	watcher    *fsnotify.Watcher
	baseDir    string // usually ~/.openclaw
	eventChan  chan WorkspaceEvent
	knownFiles map[string]int64
	ready      bool
}

func NewWorkspaceWatcher(baseDir string, eventChan chan WorkspaceEvent) *WorkspaceWatcher {
	return &WorkspaceWatcher{
		baseDir:    baseDir,
		eventChan:  eventChan,
		knownFiles: make(map[string]int64),
	}
}

func (w *WorkspaceWatcher) Start() error {
	if w.baseDir == "" {
		return nil
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.watcher = watcher

	// Add baseDir itself to watch for new workspace directories
	if err := watcher.Add(w.baseDir); err != nil {
		log.Printf("Failed to watch base dir %s: %v", w.baseDir, err)
	}

	w.scanAndWatchWorkspaces()

	w.ready = true
	w.emitSummary()
	go w.watchLoop()
	return nil
}

func (w *WorkspaceWatcher) scanAndWatchWorkspaces() {
	entries, err := os.ReadDir(w.baseDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "workspace") {
			wsDir := filepath.Join(w.baseDir, entry.Name())
			w.watcher.Add(wsDir)

			// Watch subdirectories like memory/ if they exist
			memoryDir := filepath.Join(wsDir, "memory")
			if info, err := os.Stat(memoryDir); err == nil && info.IsDir() {
				w.watcher.Add(memoryDir)
			}
		}
	}
}

func (w *WorkspaceWatcher) emitSummary() {
	if !w.ready {
		return
	}

	entries, err := os.ReadDir(w.baseDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "workspace") {
			continue
		}

		wsDir := filepath.Join(w.baseDir, entry.Name())
		agentName := "main"
		if entry.Name() != "workspace" {
			agentName = strings.TrimPrefix(entry.Name(), "workspace-")
		}

		// Scan root dir for all .md and .json files
		var files []WorkspaceFile
		subEntries, err := os.ReadDir(wsDir)
		if err == nil {
			for _, subEntry := range subEntries {
				if subEntry.IsDir() {
					continue
				}
				name := subEntry.Name()
				if strings.HasSuffix(name, ".md") || strings.HasSuffix(name, ".json") {
					content := readFileContent(filepath.Join(wsDir, name), 50000)
					files = append(files, WorkspaceFile{
						Path:     filepath.Join(wsDir, name),
						Filename: name,
						Type:     "file",
						Content:  content,
					})
				}
			}
		}

		summary := &WorkspaceSummary{
			AgentName:    agentName,
			MemoryExists: fileExists(filepath.Join(wsDir, "memory")),
		}

		select {
		case w.eventChan <- WorkspaceEvent{Type: "workspace_event", Summary: summary, Files: files, Timestamp: time.Now().UTC()}:
		case <-time.After(5 * time.Second):
			log.Printf("WorkspaceWatcher: channel full, dropped event for %s after 5s timeout", agentName)
		}
	}
}

func (w *WorkspaceWatcher) watchLoop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
				w.handleChange(event.Name)
				w.emitSummary()
			}
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Workspace watcher error: %v", err)
		}
	}
}

func (w *WorkspaceWatcher) handleChange(path string) {
	filename := filepath.Base(path)
	dir := filepath.Dir(path)
	isMemory := strings.HasSuffix(dir, "memory")

	var fileType string
	if isMemory {
		fileType = "memory.daily_note"
	} else {
		switch filename {
		case "SOUL.md":
			fileType = "soul"
		case "AGENTS.md":
			fileType = "agents"
		case "MEMORY.md":
			fileType = "memory"
		case "HEARTBEAT.md":
			fileType = "heartbeat"
		case "IDENTITY.md":
			fileType = "identity"
		case "TOOLS.md":
			fileType = "tools"
		case "USER.md":
			fileType = "user"
		case "state.json":
			fileType = "state"
		default:
			return
		}
	}

	content := readFileContent(path, 100000)
	wf := WorkspaceFile{
		Path:     path,
		Filename: filename,
		Type:     fileType,
		Content:  content,
	}

	select {
	case w.eventChan <- WorkspaceEvent{Type: "workspace.file_changed", Files: []WorkspaceFile{wf}, Timestamp: time.Now().UTC()}:
	case <-time.After(5 * time.Second):
	}
}

func (w *WorkspaceWatcher) Stop() error {
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
