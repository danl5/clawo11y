package api

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
	"github.com/danl5/clawo11y/services/server/schemas"
)

func RegisterNode(c *gin.Context) {
	var payload schemas.NodeInfo
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	openclawVersion := ""
	if payload.OpenClawVersion != nil {
		openclawVersion = *payload.OpenClawVersion
	}
	hostname := ""
	if payload.Hostname != nil {
		hostname = *payload.Hostname
	}

	dbNode := models.Node{
		NodeID:          payload.NodeID,
		OSName:          payload.OSName,
		IPAddress:       payload.IPAddress,
		OpenClawVersion: openclawVersion,
		Hostname:        hostname,
		LastSeenAt:      time.Now(),
	}

	// Upsert node (SQLite compatible way)
	var existingNode models.Node
	result := database.DB.Where("node_id = ?", payload.NodeID).First(&existingNode)

	if result.Error == nil {
		// Found, update it
		existingNode.OSName = payload.OSName
		existingNode.IPAddress = payload.IPAddress
		existingNode.OpenClawVersion = openclawVersion
		existingNode.Hostname = hostname
		existingNode.LastSeenAt = time.Now()
		if err := database.DB.Save(&existingNode).Error; err != nil {
			c.JSON(500, gin.H{"detail": err.Error()})
			return
		}
	} else {
		// Not found, create it
		if err := database.DB.Create(&dbNode).Error; err != nil {
			c.JSON(500, gin.H{"detail": err.Error()})
			return
		}
	}

	c.JSON(200, gin.H{"message": "Node registered successfully", "node_id": payload.NodeID})
}

func GetNodes(c *gin.Context) {
	var nodes []models.Node
	if err := database.DB.Find(&nodes).Error; err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}

	// Format response to match python
	resp := make([]gin.H, 0, len(nodes))
	for _, n := range nodes {
		resp = append(resp, gin.H{
			"node_id":          n.NodeID,
			"os_name":          n.OSName,
			"ip_address":       n.IPAddress,
			"openclaw_version": n.OpenClawVersion,
			"hostname":         n.Hostname,
			"last_seen_at":     n.LastSeenAt.Format(time.RFC3339Nano),
		})
	}
	c.JSON(200, resp)
}
