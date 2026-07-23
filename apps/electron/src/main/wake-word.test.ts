import { describe, it, expect, vi } from 'vitest';
import {
  WakeWordListener,
  type WakeEngine,
  type FrameRecorder,
} from './wake-word';

/**
 * A recorder that yields a scripted sequence of frames, then blocks so the
 * loop parks cleanly instead of spinning once the script is exhausted.
 */
function scriptedRecorder(frames: Int16Array[]): FrameRecorder {
  let i = 0;
  let recording = false;
  return {
    get isRecording() {
      return recording;
    },
    start() {
      recording = true;
    },
    stop() {
      recording = false;
    },
    release() {},
    read() {
      if (i < frames.length) {
        return Promise.resolve(frames[i++]);
      }
      // Nothing left — never resolve, so the loop awaits here until stop().
      return new Promise<Int16Array>(() => {});
    },
  };
}

/** Engine that reports a wake on frames whose first sample is non-zero. */
function markerEngine(): WakeEngine {
  return {
    frameLength: 512,
    process: (frame) => (frame[0] !== 0 ? 0 : -1),
    release: vi.fn(),
  };
}

const silent = new Int16Array(512);
const wake = new Int16Array(512).fill(1);

describe('WakeWordListener', () => {
  it('fires onWake when the engine detects the keyword', async () => {
    const onWake = vi.fn();
    const listener = new WakeWordListener(
      markerEngine(),
      scriptedRecorder([silent, wake, silent]),
      onWake,
    );

    listener.start();
    await vi.waitFor(() => expect(onWake).toHaveBeenCalledOnce());
    await listener.stop();
  });

  it('does not fire on silence alone', async () => {
    const onWake = vi.fn();
    const listener = new WakeWordListener(
      markerEngine(),
      scriptedRecorder([silent, silent, silent]),
      onWake,
    );

    listener.start();
    // Give the loop time to consume the frames.
    await new Promise((r) => setTimeout(r, 20));
    await listener.stop();

    expect(onWake).not.toHaveBeenCalled();
  });

  it('starts and stops the recorder with the listener', async () => {
    const recorder = scriptedRecorder([silent]);
    const listener = new WakeWordListener(markerEngine(), recorder, vi.fn());

    expect(recorder.isRecording).toBe(false);
    listener.start();
    expect(recorder.isRecording).toBe(true);
    await listener.stop();
    expect(recorder.isRecording).toBe(false);
  });

  it('ignores a repeated start', () => {
    const recorder = scriptedRecorder([silent]);
    const startSpy = vi.spyOn(recorder, 'start');
    const listener = new WakeWordListener(markerEngine(), recorder, vi.fn());

    listener.start();
    listener.start();

    expect(startSpy).toHaveBeenCalledOnce();
  });

  it('keeps listening after a mic read error', async () => {
    const onWake = vi.fn();
    let call = 0;
    const flaky: FrameRecorder = {
      isRecording: true,
      start() {},
      stop() {},
      release() {},
      read() {
        call++;
        if (call === 1) return Promise.reject(new Error('glitch'));
        if (call === 2) return Promise.resolve(wake);
        return new Promise<Int16Array>(() => {});
      },
    };
    const listener = new WakeWordListener(markerEngine(), flaky, onWake);

    listener.start();
    await vi.waitFor(() => expect(onWake).toHaveBeenCalledOnce());
    await listener.stop();
  });

  it('does not fire onWake after being stopped', async () => {
    const onWake = vi.fn();
    const listener = new WakeWordListener(
      markerEngine(),
      scriptedRecorder([silent]),
      onWake,
    );

    listener.start();
    await listener.stop();

    expect(listener.isRunning).toBe(false);
    expect(onWake).not.toHaveBeenCalled();
  });

  it('releases both engine and recorder', () => {
    const engine = markerEngine();
    const recorder = scriptedRecorder([silent]);
    const relSpy = vi.spyOn(recorder, 'release');
    const listener = new WakeWordListener(engine, recorder, vi.fn());

    listener.release();

    expect(engine.release).toHaveBeenCalledOnce();
    expect(relSpy).toHaveBeenCalledOnce();
  });
});
