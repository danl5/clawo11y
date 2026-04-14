import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

describe('useWebSocket', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let MockWebSocket: any;
  let wsInstances: any[];

  beforeEach(() => {
    wsInstances = [];
    MockWebSocket = class {
      url: string;
      onopen: any;
      onmessage: any;
      onclose: any;
      onerror: any;
      constructor(url: string) {
        this.url = url;
        wsInstances.push(this);
      }
      close() {
        if (this.onclose) this.onclose();
      }
    };
    globalThis.WebSocket = MockWebSocket as any;

    mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ messages: [{ id: 1, text: 'old' }] }),
    });
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with disconnected state and empty messages', () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost/test'));
    expect(result.current.connected).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('connects to websocket and fetches initial data', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost/test'));
    expect(wsInstances).toHaveLength(1);
    
    // Simulate connection open
    await act(async () => {
      wsInstances[0].onopen();
    });

    expect(result.current.connected).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    
    // Check initial data loading
    expect(result.current.messages).toEqual([{ id: 1, text: 'old' }]);
  });

  it('handles incoming websocket messages', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost/test'));
    
    // Simulate connection open and initial load
    await act(async () => {
      wsInstances[0].onopen();
    });

    // Simulate incoming message
    act(() => {
      wsInstances[0].onmessage({ data: JSON.stringify({ id: 2, text: 'new' }) });
    });

    // The new message should be prepended
    expect(result.current.messages).toEqual([{ id: 2, text: 'new' }, { id: 1, text: 'old' }]);
  });

  it('handles invalid json messages without crashing', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost/test'));
    
    await act(async () => {
      wsInstances[0].onopen();
    });

    const initialMessages = [...result.current.messages];

    act(() => {
      wsInstances[0].onmessage({ data: 'invalid json' });
    });

    // Should not crash and messages should be unchanged
    expect(result.current.messages).toEqual(initialMessages);
  });

  it('cleans up connection on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://localhost/test'));
    
    const closeSpy = vi.spyOn(wsInstances[0], 'close');
    unmount();
    
    expect(closeSpy).toHaveBeenCalled();
  });
});
