import { Component, computed, inject } from '@angular/core';
import { ConversationStore } from '../../core/conversation.store';
import type { ResponseMetrics } from '../../core/types/lm-studio.types';
import { Button } from '../../shared/ui/button.component';
import { DurationPipe, MetricPipe } from '../../shared/pipes/format.pipe';

/**
 * Session aggregates for the active conversation (Phase 9): response count,
 * token totals and average throughput across all completed/cancelled responses
 * that reported metrics. Includes a copy-session-as-JSON action.
 */
@Component({
  selector: 'app-session-metrics',
  imports: [Button, DurationPipe, MetricPipe],
  templateUrl: './session-metrics.component.html',
  styleUrl: './session-metrics.component.scss'
})
export class SessionMetrics {
  private readonly store = inject(ConversationStore);

  protected readonly aggregates = computed(() => {
    const conv = this.store.active();
    if (!conv) return null;
    const metricsList: ResponseMetrics[] = [];
    for (const m of conv.messages) {
      if (m.role === 'assistant' && m.metrics !== undefined) metricsList.push(m.metrics);
    }
    if (metricsList.length === 0) return null;

    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let totalElapsedMs = 0;
    let tpsSum = 0;
    let tpsCount = 0;
    for (const m of metricsList) {
      inputTokens += m.inputTokens ?? 0;
      outputTokens += m.outputTokens ?? 0;
      reasoningTokens += m.reasoningTokens ?? 0;
      totalElapsedMs += m.totalElapsedMs ?? 0;
      if (m.tokensPerSecond !== undefined) {
        tpsSum += m.tokensPerSecond;
        tpsCount += 1;
      }
    }

    return {
      responses: metricsList.length,
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalElapsedMs,
      avgTps: tpsCount > 0 ? tpsSum / tpsCount : undefined
    };
  });

  protected get sessionJson(): string {
    const conv = this.store.active();
    if (!conv) return '';
    const rows = conv.messages
      .filter((m) => m.role === 'assistant' && m.metrics !== undefined)
      .map((m) => ({
        model: m.modelId ?? null,
        timestamp: new Date(m.createdAt).toISOString(),
        status: m.status,
        metrics: m.metrics ?? {}
      }));
    return JSON.stringify({ conversation: conv.title, responses: rows }, null, 2);
  }

  async copySession(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.sessionJson);
    } catch {
      // Clipboard unavailable — fail quietly.
    }
  }
}
