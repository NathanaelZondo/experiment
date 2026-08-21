/** Formats a byte count as a human-readable size, e.g. 4900000000 → "4.9 GB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/** Formats a parameter count (in billions) as e.g. "8B" or "13.1B". */
export function formatParams(billions: number | undefined): string {
  if (billions === undefined || !Number.isFinite(billions)) {
    return '—';
  }
  const rounded = Math.round(billions * 10) / 10;
  return `${rounded}B`;
}

/** Normalises a user-entered base URL: trims, strips trailing slashes. */
export function normalizeBaseUrl(url: string): string {
  let trimmed = url.trim();
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/** Formats a timestamp as a local clock time, e.g. "4:35 PM". */
export function formatClockTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
