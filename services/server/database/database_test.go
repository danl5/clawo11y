package database

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDatabaseURLUsesRawNonSQLiteURL(t *testing.T) {
	t.Setenv("O11Y_DB_URL", "mysql://example")
	if got := resolveDatabaseURL(); got != "mysql://example" {
		t.Fatalf("expected non-sqlite URL passthrough, got %q", got)
	}
}

func TestResolveDatabaseURLCreatesAbsoluteSQLitePath(t *testing.T) {
	cwd := t.TempDir()
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(oldWd)
	}()
	if err := os.Chdir(cwd); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	t.Setenv("O11Y_DB_URL", "sqlite:///./data/test.db")
	got := resolveDatabaseURL()
	if !filepath.IsAbs(got) {
		t.Fatalf("expected absolute sqlite path, got %q", got)
	}
	if !strings.HasSuffix(got, filepath.Join("data", "test.db")) {
		t.Fatalf("expected path to end with data/test.db, got %q", got)
	}
	if _, err := os.Stat(filepath.Dir(got)); err != nil {
		t.Fatalf("expected db directory to be created: %v", err)
	}
}

func TestResolveDatabaseURLDefaultsWhenUnset(t *testing.T) {
	cwd := t.TempDir()
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(oldWd)
	}()
	if err := os.Chdir(cwd); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	t.Setenv("O11Y_DB_URL", "")
	got := resolveDatabaseURL()
	if !filepath.IsAbs(got) {
		t.Fatalf("expected absolute default sqlite path, got %q", got)
	}
	if !strings.HasSuffix(got, "o11y_server.db") {
		t.Fatalf("expected default sqlite filename, got %q", got)
	}
}
