package websocket

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
}

type ConnectionManager struct {
	clients map[*Client]bool
	mu      sync.RWMutex
}

var Manager = &ConnectionManager{
	clients: make(map[*Client]bool),
}

func (m *ConnectionManager) Connect(conn *websocket.Conn) {
	client := &Client{
		conn: conn,
		send: make(chan []byte, 1024),
	}

	m.mu.Lock()
	m.clients[client] = true
	m.mu.Unlock()

	log.Printf("WebSocket connected. Total clients: %d", len(m.clients))

	// Start a writer goroutine for this client
	go m.writePump(client)

	// We need to keep reading from the connection to detect disconnects
	go m.readPump(client)
}

func (m *ConnectionManager) readPump(client *Client) {
	defer m.Disconnect(client)
	client.conn.SetReadLimit(512)
	for {
		messageType, p, err := client.conn.ReadMessage()
		if err != nil {
			break
		}
		if messageType == websocket.TextMessage && string(p) == "ping" {
			select {
			case client.send <- []byte("pong"):
			default:
			}
		}
	}
}

func (m *ConnectionManager) writePump(client *Client) {
	defer client.conn.Close()
	for msg := range client.send {
		if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
}

func (m *ConnectionManager) Disconnect(client *Client) {
	m.mu.Lock()
	if _, ok := m.clients[client]; ok {
		delete(m.clients, client)
		close(client.send)
		client.conn.Close()
	}
	m.mu.Unlock()
	log.Printf("WebSocket disconnected. Total clients: %d", len(m.clients))
}

func (m *ConnectionManager) BroadcastRaw(msgJSON []byte) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.clients) == 0 {
		return
	}

	for client := range m.clients {
		select {
		case client.send <- msgJSON:
		default:
			// If the send buffer is full, we assume the client is dead or too slow.
			// The writePump or readPump will eventually clean it up, or we can just drop the message.
			log.Printf("Warning: WebSocket client buffer full, dropping message")
		}
	}
}
