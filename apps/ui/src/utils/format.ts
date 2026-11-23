// Small helpers for showing values.

/** 1234 → "1.2 s", 340 → "340 ms" */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** Backend timestamps are seconds since 1970. */
export function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
