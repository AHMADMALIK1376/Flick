// window.flick: only there when the UI runs inside the Flick desktop app (Electron).
// In the browser (npm run dev) it is null, so every call must use `desktop?.…`.

export interface FlickDesktop {
  isDesktop: true;
  onToggleAsk(callback: () => void): () => void;
  setListening(listening: boolean): void;
  onListening(callback: (listening: boolean) => void): () => void;
  showCard(): void;
  hideCard(): void;
}

declare global {
  interface Window {
    flick?: FlickDesktop;
  }
}

export const desktop: FlickDesktop | null = typeof window !== 'undefined' && window.flick ? window.flick : null;
