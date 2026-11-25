// Follows the whiteboard events for one place: the class (floating window) or the Study page.
import { useState } from 'react';
import type { Drawing } from '../api/types';
import { useFlickEvent } from './useEvents';

export interface CanvasState {
  id: string;
  drawing: Drawing;
  slide: number | null;
  /** Steps shown so far (0 = only the title). */
  step: number;
  /** What Flick is saying for the current step (caption). */
  say: string | null;
}

export function useCanvas(target: 'class' | 'study') {
  const [canvas, setCanvas] = useState<CanvasState | null>(null);

  useFlickEvent('canvas', (event) => {
    if (event.target !== target) return;
    if (event.action === 'open') {
      const { id, slide, title, elements, steps } = event;
      setCanvas({ id, slide, drawing: { title, elements, steps }, step: 0, say: null });
    } else if (event.action === 'step') {
      setCanvas((c) => (c && c.id === event.id ? { ...c, step: event.step, say: event.say } : c));
    } else {
      setCanvas((c) => (c && c.id === event.id ? null : c));
    }
  });

  return { canvas, close: () => setCanvas(null), setCanvas };
}
