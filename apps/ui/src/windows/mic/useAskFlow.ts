// Record a spoken question and send it to Flick. Used by the mic widget and the presenter view.
//
//   idle → (start) listening → (stop) answering → done → idle
//
// The answer itself shows on the answer card through live events.
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/flick';
import { createRecorder } from './recorder';

export type AskPhase = 'idle' | 'listening' | 'answering' | 'done';

const MAX_RECORDING_MS = 30_000;
const DONE_MS = 2_500;

function errorText(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
    return 'Microphone blocked or not found. Allow it in Windows settings.';
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function useAskFlow() {
  const [phase, setPhase] = useState<AskPhase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const recorder = useRef(createRecorder());
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const finish = useCallback(async () => {
    if (!recorder.current.recording) return;
    setPhase('answering');
    try {
      const audio = await recorder.current.stop();
      const result = await api.askAudio(audio);
      if (!result.answer) {
        setNote("Didn't catch that");
        setPhase('idle');
        later(() => setNote(null), DONE_MS);
        return;
      }
      setPhase('done');
      later(() => setPhase('idle'), DONE_MS);
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
      setPhase('idle');
    }
  }, []);

  const start = useCallback(async () => {
    setNote(null);
    api.questionStarting().catch(() => undefined); // warms up; result not needed
    try {
      await recorder.current.start();
      setPhase('listening');
      later(() => void finish(), MAX_RECORDING_MS);
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
      setPhase('idle');
    }
  }, [finish]);

  /** Click / hotkey: start when idle, stop when listening. */
  const toggle = useCallback(() => {
    if (phase === 'idle' || phase === 'done') void start();
    else if (phase === 'listening') void finish();
  }, [phase, start, finish]);

  return { phase, note, toggle };
}
