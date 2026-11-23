// Issue #9 · Design screen: L3
//
// Record from the microphone with MediaRecorder and return one audio Blob.

export interface Recorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
}

export function createRecorder(): Recorder {
  // TODO(#9): getUserMedia({ audio: true }) + MediaRecorder (audio/webm). Stop the mic tracks after stop().
  return {
    async start() {
      throw new Error('Not built yet (#9)');
    },
    async stop() {
      throw new Error('Not built yet (#9)');
    },
  };
}
