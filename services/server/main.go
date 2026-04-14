package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/api"
	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
)

func getEnvString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		log.Printf("Invalid integer for %s=%q, using default %d", key, value, fallback)
		return fallback
	}
	return parsed
}

func cleanupOldData(ctx context.Context, retentionDays int) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cutoffDate := time.Now().UTC().AddDate(0, 0, -retentionDays)
			// Cleanup old data
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.SystemMetric{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.AgentEvent{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.WorkspaceEvent{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.CronEvent{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.SessionsEvent{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.GatewayLogEvent{})
			database.DB.Where("timestamp < ?", cutoffDate).Delete(&models.HealthHistoryEvent{})
		}
	}
}

func main() {
	serverAddr := getEnvString("O11Y_SERVER_ADDR", "0.0.0.0:8000")
	retentionDays := getEnvInt("O11Y_DATA_RETENTION_DAYS", 7)
	shutdownTimeoutSec := getEnvInt("O11Y_SERVER_SHUTDOWN_TIMEOUT_SEC", 5)

	database.InitDB()

	// Create a context that is canceled on SIGINT or SIGTERM
	ctx, cancel := context.WithCancel(context.Background())

	// Start background tasks
	go api.StartEventProcessors(ctx)
	go api.StartOtelProcessors(ctx)
	go cleanupOldData(ctx, retentionDays)

	router := gin.Default()

	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"*"}
	router.Use(cors.New(config))

	v1 := router.Group("/api/v1")
	{
		nodes := v1.Group("/nodes")
		{
			nodes.POST("/register", api.RegisterNode)
			nodes.GET("/", api.GetNodes)
		}

		metrics := v1.Group("/metrics")
		{
			metrics.POST("/", api.ReportSystemMetrics)
		}

		events := v1.Group("/events")
		{
			events.POST("/", api.ReportAgentEvent)
			events.GET("/snapshot", api.GetSnapshot)

			events.POST("/workspace/", api.ReportWorkspaceEvent)
			events.POST("/cron/", api.ReportCronEvent)
			events.POST("/sessions/", api.ReportSessionsEvent)
			events.POST("/gateway/", api.ReportGatewayLogEvent)
			events.POST("/health/", api.ReportHealthHistoryEvent)
		}

		// OTLP endpoints
		otlpGroup := v1.Group("/otlp")
		{
			otlpGroup.POST("/traces", api.ReceiveOtelTraces)
			otlpGroup.POST("/metrics", api.ReceiveOtelMetrics)
			otlpGroup.POST("/logs", api.ReceiveOtelLogs)

			// Analytics & Views APIs
			otlpGroup.GET("/dashboard/cost", api.GetCostDashboard)
			otlpGroup.GET("/dashboard/metrics", api.GetMetricsDashboard)
			otlpGroup.GET("/dashboard/overview", api.GetOtelOverview)
			otlpGroup.GET("/dashboard/health", api.GetOtelHealth)
			otlpGroup.GET("/dashboard/security", api.GetOtelSecurityTimeline)
			otlpGroup.GET("/dashboard/context-bloat", api.GetOtelContextBloat)
			otlpGroup.GET("/traces/recent", api.GetRecentTraces)
			otlpGroup.GET("/trace/:trace_id", api.GetTraceTree)
			otlpGroup.GET("/logs/recent", api.GetRecentLogs)
		}

		timeline := v1.Group("/timeline")
		{
			timeline.GET("/list", api.ListSessions)
			timeline.GET("/:session_id/timeline", api.GetSessionTimeline)
		}

		v1.GET("/ws", api.WebsocketEndpoint)
	}

	// Serve Static Files (if any)
	webDist := "services/web/dist"
	if stat, err := os.Stat(webDist); err == nil && stat.IsDir() {
		// Serve static files
		router.Static("/", webDist)
		// For SPA routing
		router.NoRoute(func(c *gin.Context) {
			c.File(webDist + "/index.html")
		})
	} else {
		// Fallback for local development
		webDistDev := "../web/dist"
		if stat, err := os.Stat(webDistDev); err == nil && stat.IsDir() {
			router.Static("/", webDistDev)
			router.NoRoute(func(c *gin.Context) {
				c.File(webDistDev + "/index.html")
			})
		}
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy"})
	})

	srv := &http.Server{
		Addr:    serverAddr,
		Handler: router,
	}

	go func() {
		log.Printf("Starting Go server on %s (retention_days=%d, shutdown_timeout_sec=%d)", serverAddr, retentionDays, shutdownTimeoutSec)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server with a timeout of 5 seconds.
	quit := make(chan os.Signal, 1)
	// kill (no param) default send syscall.SIGTERM
	// kill -2 is syscall.SIGINT
	// kill -9 is syscall.SIGKILL but can't be catch, so don't need add it
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutdown Server ...")

	// Cancel the context to stop background queues
	cancel()

	// Wait briefly to allow background batch inserts to flush
	time.Sleep(2 * time.Second)

	ctxShutdown, cancelShutdown := context.WithTimeout(context.Background(), time.Duration(shutdownTimeoutSec)*time.Second)
	defer cancelShutdown()
	if err := srv.Shutdown(ctxShutdown); err != nil {
		log.Fatal("Server Shutdown:", err)
	}

	log.Println("Server exiting")
}
