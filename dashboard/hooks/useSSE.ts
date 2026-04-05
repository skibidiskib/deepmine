'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface SSEHook {
  isConnected: boolean;
  lastEvent: any | null;
  events: any[];
}

export function useSSE(url: string, maxEvents = 50): SSEHook {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'heartbeat') return;

        setLastEvent(data);
        setEvents((prev) => {
          const next = [data, ...prev];
          return next.slice(0, maxEvents);
        });
      } catch {
        // Ignore non-JSON messages (comments, heartbeats)
      }
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url, maxEvents]);

  return { isConnected, lastEvent, events };
}
