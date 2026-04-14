package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegisterSpaFallbackServesIndexForRootAndSpaRoutes(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	webDist := t.TempDir()
	indexPath := filepath.Join(webDist, "index.html")
	if err := os.WriteFile(indexPath, []byte("INDEX"), 0644); err != nil {
		t.Fatalf("write index: %v", err)
	}

	router := gin.New()
	registerSpaFallback(router, webDist)

	for _, path := range []string{"/", "/metrics", "/trace/some-id"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, rec.Code)
		}
		if body := rec.Body.String(); body != "INDEX" {
			t.Fatalf("%s: expected index body, got %q", path, body)
		}
	}
}

func TestRegisterSpaFallbackServesStaticAssetWhenFileExists(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	webDist := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDist, "index.html"), []byte("INDEX"), 0644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	assetsDir := filepath.Join(webDist, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "app.js"), []byte("console.log('ok');"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	router := gin.New()
	registerSpaFallback(router, webDist)

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if body := rec.Body.String(); body != "console.log('ok');" {
		t.Fatalf("expected asset body, got %q", body)
	}
}

func TestRegisterSpaFallbackDoesNotHijackAPIOrUnsupportedMethods(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	webDist := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDist, "index.html"), []byte("INDEX"), 0644); err != nil {
		t.Fatalf("write index: %v", err)
	}

	router := gin.New()
	router.GET("/api/v1/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	registerSpaFallback(router, webDist)

	apiReq := httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil)
	apiRec := httptest.NewRecorder()
	router.ServeHTTP(apiRec, apiReq)
	if apiRec.Code != http.StatusNotFound {
		t.Fatalf("expected API miss to return 404, got %d", apiRec.Code)
	}

	postReq := httptest.NewRequest(http.MethodPost, "/metrics", nil)
	postRec := httptest.NewRecorder()
	router.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusNotFound {
		t.Fatalf("expected POST fallback to return 404, got %d", postRec.Code)
	}
}

func TestRegisterSpaFallbackFallsBackToIndexForMissingFile(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	webDist := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDist, "index.html"), []byte("INDEX"), 0644); err != nil {
		t.Fatalf("write index: %v", err)
	}

	router := gin.New()
	registerSpaFallback(router, webDist)

	req := httptest.NewRequest(http.MethodGet, "/missing/chunk.js", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if body := rec.Body.String(); body != "INDEX" {
		t.Fatalf("expected index fallback, got %q", body)
	}
}

func TestGetEnvHelpers(t *testing.T) {
	t.Setenv("O11Y_TEST_STRING", "value")
	if got := getEnvString("O11Y_TEST_STRING", "fallback"); got != "value" {
		t.Fatalf("expected env string value, got %q", got)
	}
	if got := getEnvString("O11Y_TEST_STRING_MISSING", "fallback"); got != "fallback" {
		t.Fatalf("expected fallback string, got %q", got)
	}

	t.Setenv("O11Y_TEST_INT", "42")
	if got := getEnvInt("O11Y_TEST_INT", 7); got != 42 {
		t.Fatalf("expected parsed int 42, got %d", got)
	}
	t.Setenv("O11Y_TEST_INT", "bad")
	if got := getEnvInt("O11Y_TEST_INT", 7); got != 7 {
		t.Fatalf("expected fallback int 7, got %d", got)
	}
	if got := getEnvInt("O11Y_TEST_INT_MISSING", 9); got != 9 {
		t.Fatalf("expected missing fallback 9, got %d", got)
	}
}
