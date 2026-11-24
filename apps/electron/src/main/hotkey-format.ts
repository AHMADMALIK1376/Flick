// Pure helper (no Electron import), so it can be tested anywhere.

/** Settings use "Ctrl+Shift+Space"; Electron accepts the same names. Empty → null. */
export function toAccelerator(hotkey: string | undefined | null): string | null {
  const value = (hotkey ?? '').trim();
  if (!value) return null;
  return value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+');
}
