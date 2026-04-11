package monitor

import (
	"log"
	"net"
	"os"
	"runtime"
	"time"

	"github.com/danl5/clawo11y/clawo11y-agent/schemas"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gopsutilnet "github.com/shirou/gopsutil/v3/net"
)

type SystemMonitor struct {
	NodeID    string
	OSName    string
	IPAddress string
}

func NewSystemMonitor() *SystemMonitor {
	hostname, _ := os.Hostname()
	return &SystemMonitor{
		NodeID:    hostname,
		OSName:    runtime.GOOS,
		IPAddress: getOutboundIP(),
	}
}

func (m *SystemMonitor) GetNodeInfo() schemas.NodeInfo {
	return schemas.NodeInfo{
		NodeID:          m.NodeID,
		OSName:          m.OSName,
		IPAddress:       m.IPAddress,
		OpenClawVersion: "v1.2.0-go-agent",
		Hostname:        m.NodeID,
	}
}

func (m *SystemMonitor) GetMetrics() schemas.SystemMetricsPayload {
	cpuPercents, _ := cpu.Percent(0, false)
	var cpuPercent float64
	if len(cpuPercents) > 0 {
		cpuPercent = cpuPercents[0]
	}

	avg, _ := load.Avg()
	var load1, load5, load15 float64
	if avg != nil {
		load1, load5, load15 = avg.Load1, avg.Load5, avg.Load15
	}

	var ramUsed, ramTotal, ramPercent, swapUsed, swapTotal float64
	if v, err := mem.VirtualMemory(); err == nil {
		ramUsed = float64(v.Used) / 1024 / 1024
		ramTotal = float64(v.Total) / 1024 / 1024
		ramPercent = v.UsedPercent
	}
	if s, err := mem.SwapMemory(); err == nil {
		swapUsed = float64(s.Used) / 1024 / 1024
		swapTotal = float64(s.Total) / 1024 / 1024
	}

	var diskPercent, diskTotal float64
	if d, err := disk.Usage("/"); err == nil {
		diskPercent = d.UsedPercent
		diskTotal = float64(d.Total) / 1024 / 1024 / 1024
	}

	var uptime, bootTime int64
	if h, err := host.Info(); err == nil {
		uptime = int64(h.Uptime)
		bootTime = int64(h.BootTime)
	}

	var netTx, netRx uint64
	ifaces, _ := gopsutilnet.IOCounters(false)
	for _, iface := range ifaces {
		netTx += iface.BytesSent
		netRx += iface.BytesRecv
	}

	return schemas.SystemMetricsPayload{
		NodeID:          m.NodeID,
		CPUPercent:      cpuPercent,
		CPUCount:        runtime.NumCPU(),
		LoadAvg1m:       load1,
		LoadAvg5m:       load5,
		LoadAvg15m:      load15,
		RAMUsedMB:       ramUsed,
		RAMTotalMB:      ramTotal,
		RAMPercent:      ramPercent,
		SwapUsedMB:      swapUsed,
		SwapTotalMB:     swapTotal,
		DiskUsedPercent: diskPercent,
		DiskTotalGB:     diskTotal,
		UptimeSeconds:   uptime,
		BootTimeSeconds: bootTime,
		NetTxBytes:      netTx,
		NetRxBytes:      netRx,
		Timestamp:       time.Now().UTC(),
	}
}

func getOutboundIP() string {
	conn, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.ParseIP("8.8.8.8"), Port: 80})
	if err != nil {
		log.Printf("Failed to get local IP: %v", err)
		return "127.0.0.1"
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String()
}

var MODEL_PRICING = map[string]struct {
	Input      float64
	Output     float64
	CacheRead  float64
	CacheWrite float64
}{
	"anthropic/claude-opus-4-6":         {Input: 15.00, Output: 75.00, CacheRead: 1.875, CacheWrite: 18.75},
	"anthropic/claude-opus-4-5":         {Input: 15.00, Output: 75.00, CacheRead: 1.875, CacheWrite: 18.75},
	"anthropic/claude-sonnet-4-6":       {Input: 3.00, Output: 15.00, CacheRead: 0.30, CacheWrite: 3.75},
	"anthropic/claude-sonnet-4-5":       {Input: 3.00, Output: 15.00, CacheRead: 0.30, CacheWrite: 3.75},
	"anthropic/claude-3-5-haiku-latest": {Input: 0.80, Output: 4.00, CacheRead: 0.08, CacheWrite: 1.00},
	"google/gemini-3-pro-preview":       {Input: 1.25, Output: 10.00, CacheRead: 0.31, CacheWrite: 4.50},
	"google/gemini-3-flash-preview":     {Input: 0.15, Output: 0.60, CacheRead: 0.04, CacheWrite: 0.15},
}

func EstimateTokenCost(provider, model string, inputTokens, outputTokens, cacheRead, cacheWrite int) float64 {
	key := provider + "/" + model
	if rates, ok := MODEL_PRICING[key]; ok {
		return (float64(inputTokens)/1_000_000)*rates.Input +
			(float64(outputTokens)/1_000_000)*rates.Output +
			(float64(cacheRead)/1_000_000)*rates.CacheRead +
			(float64(cacheWrite)/1_000_000)*rates.CacheWrite
	}
	return 0.0
}
