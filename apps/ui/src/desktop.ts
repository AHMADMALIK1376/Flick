// window.flick: only there when the UI runs inside the Flick desktop app (Electron).
// In the browser (npm run dev) it is null, so every call must use `desktop?.…`.

export interface FlickDesktop {
  isDesktop: true;
  onToggleAsk(callback: () => void): () => void;
  setListening(listening: boolean): void;
  onListening(callback: (listening: boolean) => void): () => void;
  showCard(): void;
  hideCard(): void;
  showCanvas(): void;
  hideCanvas(): void;
  /** Mic window: a small button, or the bigger question box (which can take typing). */
  setMicMode?(mode: 'button' | 'panel'): void;
  /** Real path of a picked file (Electron); '' when unknown. */
  pathForFile?(file: File): string;
}

declare global {
  interface Window {
    flick?: FlickDesktop;
  }
}

export const desktop: FlickDesktop | null = typeof window !== 'undefined' && window.flick ? window.flick : null;
