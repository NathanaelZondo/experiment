import { Pipe, PipeTransform } from '@angular/core';

/** Human-readable byte sizes (consistent formatting for model data). */
@Pipe({ name: 'bytes', pure: true })
export class BytesPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? String(Math.round(size)) : size.toFixed(1)} ${units[unit]}`;
  }
}

/** Human-readable durations (ms → s / min). */
@Pipe({ name: 'duration', pure: true })
export class DurationPipe implements PipeTransform {
  transform(valueMs: number | null | undefined): string {
    if (valueMs === null || valueMs === undefined || !Number.isFinite(valueMs)) return '—';
    if (valueMs < 1000) return `${Math.round(valueMs)} ms`;
    const seconds = valueMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes} min ${rest} s`;
  }
}

/** Consistent numeric formatting for metrics (2 decimals, trimmed). */
@Pipe({ name: 'metric', pure: true })
export class MetricPipe implements PipeTransform {
  transform(value: number | null | undefined, suffix = ''): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 100) / 100;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
    return suffix ? `${text} ${suffix}` : text;
  }
}
