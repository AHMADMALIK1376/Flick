// Issue #9 · Design screen: L3
//
// Record from the microphone with MediaRecorder and return one audio Blob.
// The mic is released after every recording, so the Windows mic light turns off.

export interface Recorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  readonly recording: boolean;
}

export function isRecordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function createRecorder(): Recorder {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  function release() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
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
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
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
