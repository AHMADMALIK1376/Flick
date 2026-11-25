import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake microphone: `loud` decides what the level meter hears.
const mic = { loud: false, recording: false };
vi.mock('./recorder', () => ({
  createRecorder: () => ({
    get recording() {
      return mic.recording;
    },
    start: async () => {
      mic.recording = true;
    },
    stop: async () => {
      mic.recording = false;
      return new Blob(['audio']);
    },
    snapshot: () => new Blob(['so far']),
    level: () => (mic.loud ? 0.3 : 0.001),
  }),
}));

const api = vi.hoisted(() => ({
  questionStarting: vi.fn(async () => undefined),
  questionCancelled: vi.fn(async () => undefined),
  transcribe: vi.fn(async () => ({ text: 'what is row level security', duration_ms: 10 })),
  ask: vi.fn(async () => null),
}));
vi.mock('../../api/flick', () => ({ api }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

import { REVIEW_MS, useAskFlow } from './useAskFlow';

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAskFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mic.loud = false;
    mic.recording = false;
    Object.values(api).forEach((f) => f.mockClear());
  });
  afterEach(() => vi.useRealTimers());

  it('listens, writes while you speak, and waits for ✓ when you stop', async () => {
    const { result } = renderHook(() => useAskFlow());
    await act(async () => result.current.toggle());
    expect(result.current.phase).toBe('listening');
    expect(result.current.speaking).toBe(false); // "Listening…"

    mic.loud = true;
    await advance(1500);
    expect(result.current.speaking).toBe(true); // "Writing…"
    expect(result.current.text).toBe('what is row level security'); // live words

    mic.loud = false;
    await advance(2000); // you stopped talking
    expect(result.current.phase).toBe('review');
    expect(api.ask).not.toHaveBeenCalled(); // nothing is sent until ✓

    act(() => result.current.edit('what is row-level security in PostgreSQL'));
    await act(async () => result.current.send());
    expect(api.ask).toHaveBeenCalledWith('what is row-level security in PostgreSQL');
    expect(result.current.phase).toBe('done');
  });

  it('closes by itself 20 seconds after you stop, and the talk carries on', async () => {
    const { result } = renderHook(() => useAskFlow());
    await act(async () => result.current.toggle());
    mic.loud = true;
    await advance(600);
    mic.loud = false;
    await advance(2000);
    expect(result.current.phase).toBe('review');

    await advance(REVIEW_MS - 2000);
    expect(result.current.phase).toBe('review'); // still waiting
    await advance(2500);
    expect(result.current.phase).toBe('idle');
    expect(api.ask).not.toHaveBeenCalled();
    expect(api.questionCancelled).toHaveBeenCalled();
  });

  it('typing restarts the 20 seconds', async () => {
    const { result } = renderHook(() => useAskFlow());
    await act(async () => result.current.toggle());
    mic.loud = true;
    await advance(600);
    mic.loud = false;
    await advance(2000);
    await advance(REVIEW_MS - 3000);
    act(() => result.current.edit('changed'));
    await advance(10_000);
    expect(result.current.phase).toBe('review');
  });

  it('closes when nothing is said', async () => {
    api.transcribe.mockResolvedValueOnce({ text: '', duration_ms: 1 });
    const { result } = renderHook(() => useAskFlow());
    await act(async () => result.current.toggle());
    await advance(8500);
    expect(result.current.phase).toBe('idle');
    expect(result.current.note).toBe("Didn't catch that");
  });

  it('✕ drops the question', async () => {
    const { result } = renderHook(() => useAskFlow());
    await act(async () => result.current.toggle());
    act(() => result.current.cancel());
    expect(result.current.phase).toBe('idle');
    expect(api.questionCancelled).toHaveBeenCalled();
  });
});
