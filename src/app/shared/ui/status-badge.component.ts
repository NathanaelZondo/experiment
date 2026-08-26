import { Component, computed, input } from '@angular/core';

export type BadgeState = 'connected' | 'disconnected' | 'checking' | 'failed' | 'generating' | 'loading';

const DEFAULT_LABELS: Record<BadgeState, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  checking: 'Checking…',
  failed: 'Failed',
  generating: 'Generating',
  loading: 'Loading model'
};

@Component({
  selector: 'app-status-badge',
  template: `<span [class]="'lb-badge lb-badge--' + state()"><i class="lb-badge__dot" aria-hidden="true"></i>{{ label() }}</span>`,
  styles: `
    .lb-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text-secondary);
    }

    .lb-badge__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }

    .lb-badge--connected { color: var(--status-connected); }
    .lb-badge--disconnected { color: var(--status-disconnected); }
    .lb-badge--checking { color: var(--status-checking); }
    .lb-badge--failed { color: var(--status-failed); }
    .lb-badge--generating { color: var(--status-generating); }
    .lb-badge--loading { color: var(--status-loading); }

    .lb-badge--checking .lb-badge__dot,
    .lb-badge--generating .lb-badge__dot,
    .lb-badge--loading .lb-badge__dot {
      animation: lb-pulse 1.2s ease-in-out infinite;
    }

    @keyframes lb-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
  `
})
export class StatusBadge {
  readonly state = input<BadgeState>('disconnected');
  /** Optional label override (defaults per state). */
  readonly text = input<string | null>(null);

  protected readonly label = computed(() => this.text() ?? DEFAULT_LABELS[this.state()]);
}
