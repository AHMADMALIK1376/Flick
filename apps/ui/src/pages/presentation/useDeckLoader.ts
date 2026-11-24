// Loading a presentation: from a .pptx file or from the deck open in PowerPoint.
// Shared by the empty state (D1) and the ready state (D2).
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { api } from '../../api/flick';

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function isPptx(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pptx');
}

export function useDeckLoader(onLoaded: () => void) {
  const [busy, setBusy] = useState<'file' | 'powerpoint' | null>(null);

  async function run(kind: 'file' | 'powerpoint', load: () => Promise<{ name: string; slide_count: number }>) {
    setBusy(kind);
    try {
      const deck = await load();
      notifications.show({ color: 'teal', message: `Loaded ${deck.name} (${deck.slide_count} slides). Preparing questions…` });
      onLoaded();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    uploadFile: (file: File | null) => {
      if (!file) return;
      if (!isPptx(file)) {
        notifications.show({ color: 'red', message: 'Please choose a .pptx file.' });
        return;
      }
      void run('file', () => api.uploadDeck(file));
    },
    loadFromPowerPoint: () => void run('powerpoint', () => api.loadFromPowerPoint()),
  };
}
