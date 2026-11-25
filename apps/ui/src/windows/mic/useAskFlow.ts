// Ask Flick by voice. Used by the floating mic, the presenter view and the Study page.
//
//   idle → listening ("Listening…", then the words appear while you speak)
//        → writing (a moment) → review (you stopped talking: read it, fix it by typing, press ✓ to ask or ✕ to drop it;
//                  untouched for 20 s → it closes by itself)
//        → answering → done → idle
//
// The answer itself shows on the answer card through live events.
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/flick';
import { desktop } from '../../desktop';
import { createRecorder } from './recorder';

export type AskPhase = 'idle' | 'listening' | 'writing' | 'review' | 'answering' | 'done';

/** Longest question. */
const MAX_RECORDING_MS = 45_000;
/** Nothing said this long after pressing the mic → close. */
const NO_SPEECH_MS = 8_000;
/** Quiet this long after speaking → you have finished. */
const END_SILENCE_MS = 1_800;
/** Loud this long → you are speaking (ignores a click or a cough). */
const SPEECH_MIN_MS = 250;
/** The written question waits this long for ✓ before closing by itself. */
export const REVIEW_MS = 20_000;
/** New live text this often while speaking. */
const LIVE_EVERY_MS = 1_200;
const DONE_MS = 2_500;
const TICK_MS = 100;

function errorText(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
    return 'Microphone blocked or not found. Allow it in Windows settings.';
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function useAskFlow() {
  const [phase, setPhase] = useState<AskPhase>('idle');
  const [note, setNote] = useState<string | null>(null);
  /** The words heard so far (while listening), then the question to send (editable). */
  const [text, setText] = useState('');
  /** true once the speaker has started talking (shows "Writing…" instead of "Listening…"). */
  const [speaking, setSpeaking] = useState(false);
  /** Loudness 0..1 for the little level bars. */
  const [level, setLevel] = useState(0);
  /** ms left before the written question closes by itself. */
  const [closesIn, setClosesIn] = useState(REVIEW_MS);

  const recorder = useRef(createRecorder());
  const phaseRef = useRef<AskPhase>('idle');
  const timers = useRef<number[]>([]);
  const meter = useRef<number | null>(null);
  const reviewTimer = useRef<number | null>(null);
  const liveBusy = useRef(false);
  const liveVersion = useRef(0);

  const go = (p: AskPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const stopMeter = () => {
    if (meter.current !== null) window.clearInterval(meter.current);
    meter.current = null;
  };
  const stopReviewTimer = () => {
    if (reviewTimer.current !== null) window.clearInterval(reviewTimer.current);
    reviewTimer.current = null;
  };

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      stopMeter();
      stopReviewTimer();
    },
    [],
  );

  const backToIdle = useCallback((message?: string) => {
    stopMeter();
    stopReviewTimer();
    setText('');
    setSpeaking(false);
    setLevel(0);
    go('idle');
    if (message) {
      setNote(message);
      later(() => setNote(null), DONE_MS);
    }
  }, []);

  /** ✕, Esc, or 20 s untouched: drop the question; a paused talk carries on. */
  const cancel = useCallback(() => {
    if (phaseRef.current === 'listening' && recorder.current.recording) void recorder.current.stop().catch(() => undefined);
    desktop?.setListening(false);
    api.questionCancelled().catch(() => undefined);
    backToIdle();
  }, [backToIdle]);

  const startReviewTimer = useCallback(() => {
    stopReviewTimer();
    const ends = Date.now() + REVIEW_MS;
    setClosesIn(REVIEW_MS);
    reviewTimer.current = window.setInterval(() => {
      const left = ends - Date.now();
      setClosesIn(Math.max(0, left));
      if (left <= 0) cancel();
    }, 250);
  }, [cancel]);

  /** Typing or clicking in the box: the 20 s start again. */
  const touch = useCallback(() => {
    if (phaseRef.current === 'review') startReviewTimer();
  }, [startReviewTimer]);

  const edit = useCallback(
    (value: string) => {
      setText(value);
      touch();
    },
    [touch],
  );

  /** ✓ (or Enter): ask Flick the written question. */
  const send = useCallback(async () => {
    if (phaseRef.current !== 'review') return;
    const question = text.trim();
    if (!question) return cancel();
    stopReviewTimer();
    go('answering');
    try {
      await api.ask(question);
      setText('');
      go('done');
      later(() => phaseRef.current === 'done' && go('idle'), DONE_MS);
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
      go('review'); // keep the words, so they can try again
      startReviewTimer();
    }
  }, [text, cancel, startReviewTimer]);

  /** You stopped talking (or pressed the mic again): write out the whole question for checking. */
  const finish = useCallback(async () => {
    if (phaseRef.current !== 'listening' || !recorder.current.recording) return;
    stopMeter();
    setLevel(0);
    liveVersion.current += 1; // late live text must not overwrite the final text
    desktop?.setListening(false);
    go('writing'); // a moment: writing out the final words
    try {
      const audio = await recorder.current.stop();
      const result = await api.transcribe(audio);
      const words = result.text.trim();
      if (!words) {
        api.questionCancelled().catch(() => undefined);
        return backToIdle("Didn't catch that");
      }
      setText(words);
      go('review');
      startReviewTimer();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
      api.questionCancelled().catch(() => undefined);
      backToIdle();
    }
  }, [backToIdle, startReviewTimer]);

  /** While speaking: send what was said so far, and show the words. */
  const liveText = useCallback(async () => {
    if (liveBusy.current) return;
    const audio = recorder.current.snapshot();
    if (!audio) return;
    liveBusy.current = true;
    const version = liveVersion.current;
    try {
      const result = await api.transcribe(audio);
      if (version === liveVersion.current && phaseRef.current === 'listening' && result.text.trim()) {
        setText(result.text.trim());
      }
    } catch {
      // live text is a nicety: the final text is written when they stop
    } finally {
      liveBusy.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    setNote(null);
    setText('');
    setSpeaking(false);
    stopReviewTimer();
    api.questionStarting().catch(() => undefined); // raises the hand while presenting
    try {
      await recorder.current.start();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
      return backToIdle();
    }
    go('listening');
    desktop?.setListening(true);
    liveVersion.current += 1;

    // Notice speech and the silence after it.
    const began = Date.now();
    let floor = Infinity; // background noise: the quietest moment so far (works even if they speak at once)
    let loudFor = 0;
    let quietFor = 0;
    let heard = false;
    let lastLive = 0;
    meter.current = window.setInterval(() => {
      const now = Date.now();
      const rms = recorder.current.level();
      setLevel(Math.min(1, rms * 8));
      floor = Math.min(floor, rms);
      const threshold = Math.min(0.04, Math.max(0.015, floor * 3)); // speech is well above this
      if (rms > threshold) {
        loudFor += TICK_MS;
        quietFor = 0;
        if (!heard && loudFor >= SPEECH_MIN_MS) {
          heard = true;
          setSpeaking(true);
        }
      } else {
        loudFor = Math.max(0, loudFor - TICK_MS / 2); // short gaps between syllables don't count
        quietFor += TICK_MS;
      }
      if (heard && now - lastLive >= LIVE_EVERY_MS) {
        lastLive = now;
        void liveText();
      }
      if (heard && quietFor >= END_SILENCE_MS) void finish();
      else if (!heard && now - began >= NO_SPEECH_MS) void finish();
      else if (now - began >= MAX_RECORDING_MS) void finish();
    }, TICK_MS);
  }, [backToIdle, finish, liveText]);

  /** Mic button / hotkey: start when idle, stop listening, or send the written question. */
  const toggle = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'idle' || p === 'done') void start();
    else if (p === 'listening') void finish();
    else if (p === 'review') void send();
  }, [start, finish, send]);

  return { phase, note, toggle, text, edit, touch, send, cancel, speaking, level, closesIn };
}

export type AskFlow = ReturnType<typeof useAskFlow>;
