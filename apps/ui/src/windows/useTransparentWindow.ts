// Small Electron windows (card, mic) are see-through: only the card or button shows.
import { useEffect } from 'react';

export function useTransparentWindow() {
  useEffect(() => {
    document.body.classList.add('window-transparent');
    return () => document.body.classList.remove('window-transparent');
  }, []);
}
