// Speaks answers aloud with the Windows voice, sentence by sentence as they stream in.
// Only inside the desktop app: in the browser the Speak button is used instead.
import { useFlickEvent } from '../../hooks/useEvents';
import { desktop } from '../../desktop';
import { speechFor, type SpeechStep } from './speech';

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.startsWith('en') && /natural|aria|jenny|guy/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith('en') && v.localService) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  );
}

function run(step: SpeechStep) {
  if (!step) return;
  if ('cancel' in step) {
    window.speechSynthesis.cancel();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(step.say);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance); // queued after anything already being said
}

export function useAutoSpeak() {
  const on = !!desktop && typeof window.speechSynthesis !== 'undefined';
  useFlickEvent('thinking', (data) => on && run(speechFor({ type: 'thinking', data })));
  useFlickEvent('searching', (data) => on && run(speechFor({ type: 'searching', data })));
  useFlickEvent('answer_delta', (data) => on && run(speechFor({ type: 'answer_delta', data })));
  useFlickEvent('answer', (data) => on && run(speechFor({ type: 'answer', data })));
}
