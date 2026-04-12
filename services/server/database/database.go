package database

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/danl5/clawo11y/services/server/models"
)

var DB *gorm.DB

func resolveDatabaseURL() string {
	rawURL := os.Getenv("O11Y_DB_URL")
	if rawURL == "" {
		rawURL = "sqlite:///./o11y_server.db"
	}
	if !strings.HasPrefix(rawURL, "sqlite:///") {
		return rawURL
	}

	sqlitePath := strings.Replace(rawURL, "sqlite:///", "", 1)
	if !filepath.IsAbs(sqlitePath) {
		absPath, _ := filepath.Abs(sqlitePath)
		sqlitePath = absPath
	}

	dir := filepath.Dir(sqlitePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatalf("Failed to create database directory: %v", err)
	}

	return sqlitePath
}

func InitDB() {
	dsn := resolveDatabaseURL()
	var err error

	// Note: gorm sqlite driver does not support connection pooling perfectly for writes.
	// But it handles concurrency better than default python sqlite if we use proper pragmas.
	// E.g., we can enable WAL mode.
	DB, err = gorm.Open(sqlite.Open(dsn+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	sqlDB, err := DB.DB()
	if err == nil {
		// Optimization for high concurrency in SQLite
		sqlDB.SetMaxOpenConns(1)
	}

	err = DB.AutoMigrate(
		&models.Node{},
		&models.SystemMetric{},
		&models.AgentEvent{},
		&models.WorkspaceEvent{},
		&models.CronEvent{},
		&models.SessionsEvent{},
		&models.GatewayLogEvent{},
		&models.HealthHistoryEvent{},
	)
	if err != nil {
		log.Fatalf("Failed to auto-migrate database: %v", err)
	}
}
