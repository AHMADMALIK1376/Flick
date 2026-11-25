// Numbers for the Token Analyzer: money in dollars (tiny amounts need more decimals) and tokens.

export function usd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

/** "25 Nov, 8:23 PM" */
export function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function duration(start: number, end: number | null): string | null {
  if (!end) return null;
  const minutes = Math.max(1, Math.round((end - start) / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
