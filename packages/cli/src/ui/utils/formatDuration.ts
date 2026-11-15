/** `0.1s` below a minute, then `1m 30s`, then `1h 2m 3s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainder}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}
