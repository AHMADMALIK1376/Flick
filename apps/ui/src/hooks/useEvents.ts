// Live events from the backend (WebSocket /events).
//
// Usage:
//   useFlickEvent('prep_progress', (p) => setProgress(p));
//   useFlickEvent('answer', (a) => setAnswers((old) => [a, ...old]));
//
// One shared connection for the whole window. It reconnects by itself.
import { useEffect, useRef, useState } from 'react';
import { connection } from '../api/connection';
import type { FlickEvent, FlickEventMap, FlickEventType } from '../api/types';

type Listener = (event: FlickEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let socket: WebSocket | null = null;
let connected = false;
let retryTimer: number | undefined;

function setConnected(value: boolean) {
  connected = value;
  statusListeners.forEach((fn) => fn(value));
}

function connect() {
  if (socket) return;
  socket = new WebSocket(connection.wsUrl);
  socket.onopen = () => setConnected(true);
  socket.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as FlickEvent;
      listeners.forEach((fn) => fn(event));
    } catch {
      // ignore bad messages
    }
  };
  socket.onclose = () => {
    socket = null;
    setConnected(false);
    if (listeners.size + statusListeners.size > 0) {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, 1500);
    }
  };
}

/** Call `handler` every time an event of this type arrives. */
export function useFlickEvent<T extends FlickEventType>(
  type: T,
  handler: (data: FlickEventMap[T]) => void,
) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const listener: Listener = (event) => {
      if (event.type === type) saved.current(event.data as FlickEventMap[T]);
    };
    listeners.add(listener);
    connect();
    return () => {
      listeners.delete(listener);
    };
  }, [type]);
}

/** true while the live connection to the backend is open. */
export function useEventsConnected(): boolean {
  const [value, setValue] = useState(connected);
  useEffect(() => {
    statusListeners.add(setValue);
    connect();
    return () => {
      statusListeners.delete(setValue);
    };
  }, []);
  return value;
}
