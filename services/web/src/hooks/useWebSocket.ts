import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsMessage } from '../types';

export function useWebSocket(url: string) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shouldReconnect = useRef(true);

  const initData = useCallback(async () => {
    try {
      const host = import.meta.env.DEV ? 'http://localhost:8000' : '';
      const r = await fetch(`${host}/api/v1/events/snapshot`);
      const data = await r.json();
      if (data.messages && Array.isArray(data.messages)) {
        setMessages(data.messages.reverse());
      }
    } catch (e) {
      console.error('[HTTP] failed to fetch snapshot', e);
    }
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected');
      initData();
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        setMessages((prev) => [msg, ...prev].slice(0, 5000));
      } catch {
        console.error('[WS] Failed to parse message', event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!shouldReconnect.current) return;
      console.log('[WS] Disconnected, reconnecting in 3s...');
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (!shouldReconnect.current) return;
      console.warn('[WS] Connection error, retrying...');
      ws.close();
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    return () => {
      shouldReconnect.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { messages, connected };
}
