// Record from the microphone with MediaRecorder.
// - snapshot(): everything said so far, as one playable file (for live text while speaking)
// - level(): how loud it is right now, 0..1 (to notice when the speaker stops talking)
// The mic is released after every recording, so the Windows mic light turns off.

export interface Recorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  /** Everything recorded so far (a complete file: the first piece carries the header). */
  snapshot(): Blob | null;
  /** Loudness now, 0..1 (root mean square of the last few milliseconds). */
  level(): number;
  readonly recording: boolean;
}

/** A new piece of audio every this many ms, so the live text can follow the speaker. */
const SLICE_MS = 400;

export function isRecordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function createRecorder(): Recorder {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let audio: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Float32Array<ArrayBuffer> | null = null;

  function release() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
    analyser = null;
    samples = null;
    audio?.close().catch(() => undefined);
    audio = null;
  }

  return {
    get recording() {
      return recorder !== null;
    },

    async start() {
      if (recorder) return; // already recording
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch (err) {
        release();
        throw err;
      }
      try {
        audio = new AudioContext();
        analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        samples = new Float32Array(analyser.fftSize);
        audio.createMediaStreamSource(stream).connect(analyser);
      } catch {
        analyser = null; // no level meter: the speaker stops with the button instead
      }
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(SLICE_MS);
    },

    snapshot() {
      if (!chunks.length) return null;
      return new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    },

    level() {
      if (!analyser || !samples) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      return Math.sqrt(sum / samples.length);
    },

    stop() {
      const active = recorder;
      if (!active) return Promise.reject(new Error('Not recording'));
      return new Promise<Blob>((resolve) => {
        active.onstop = () => {
          const blob = new Blob(chunks, { type: active.mimeType || 'audio/webm' });
          chunks = [];
          release();
          resolve(blob);
        };
        active.stop();
      });
    },
  };
}
