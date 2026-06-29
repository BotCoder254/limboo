/** Formats a byte count as a short human label (e.g. "0 B", "12 KB", "3.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  // Whole numbers for bytes/KB; one decimal once we reach MB+.
  const rounded = exp >= 2 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[exp]}`;
}

/** Compact integer label (e.g. 1234 → "1.2k") for file/commit counts. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.floor(n)));
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

/** Formats an epoch-ms timestamp as a short relative label (e.g. "now", "12m"). */
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - epochMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  return `${wk}w`;
}
