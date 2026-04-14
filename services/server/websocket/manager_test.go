package websocket

import "testing"

func TestBroadcastRawSendsToConnectedClients(t *testing.T) {
	manager := &ConnectionManager{
		clients: make(map[*Client]bool),
	}
	client := &Client{send: make(chan []byte, 1)}
	manager.clients[client] = true

	manager.BroadcastRaw([]byte("hello"))

	select {
	case msg := <-client.send:
		if string(msg) != "hello" {
			t.Fatalf("expected broadcast payload, got %q", string(msg))
		}
	default:
		t.Fatal("expected message to be delivered to client")
	}
}

func TestBroadcastRawDoesNotBlockWhenClientBufferFull(t *testing.T) {
	manager := &ConnectionManager{
		clients: make(map[*Client]bool),
	}
	client := &Client{send: make(chan []byte, 1)}
	client.send <- []byte("existing")
	manager.clients[client] = true

	manager.BroadcastRaw([]byte("new"))

	select {
	case msg := <-client.send:
		if string(msg) != "existing" {
			t.Fatalf("expected existing buffered message to remain, got %q", string(msg))
		}
	default:
		t.Fatal("expected original message to remain buffered")
	}
}

func TestBroadcastRawWithNoClientsIsSafe(t *testing.T) {
	manager := &ConnectionManager{
		clients: make(map[*Client]bool),
	}

	manager.BroadcastRaw([]byte("ignored"))
}
