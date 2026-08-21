import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ConversationStore } from './conversation-store';
import { ThemeService } from './theme.service';
import { LmStudioService } from './lmstudio/lm-studio.service';
import { formatBytes, formatParams } from './lmstudio/format';
import {
  DEFAULT_GENERATION_SETTINGS,
  GenerationSettingsService,
  REASONING_MODES,
  ReasoningMode,
  validateGenerationField
} from './chat/generation-settings';
import { IconButton } from './design-system/icon-button';
import { Icon } from './design-system/icon';
import { InputField } from './design-system/input';
import { Button } from './design-system/button';
import { TextareaField } from './design-system/textarea';
import { StatusBadge, BadgeTone } from './design-system/status-badge';

type NumericGenField = 'temperature' | 'topP' | 'topK' | 'repeatPenalty' | 'maxTokens';

@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton, Icon, InputField, Button, TextareaField, StatusBadge],
  template: `
    <div class="settings">
      <header class="settings-header">
        <h2>Settings</h2>
        <app-icon-button label="Close settings" (click)="close.emit()">
          <app-icon name="close" [size]="18"></app-icon>
        </app-icon-button>
      </header>

      @if (store.selected(); as conv) {
        <section class="settings-section">
          <h3>System prompt</h3>
          <p class="settings-hint">
            Sent as a system message with every request for “{{ conv.title }}”.
          </p>
          <app-textarea
            label="System prompt"
            [rows]="6"
            placeholder="e.g. You are a concise technical writing assistant."
            [hint]="'Saved automatically for this conversation.'"
            [value]="conv.systemPrompt"
            (valueChange)="onPromptChange($event)"
          ></app-textarea>
        </section>

        <section class="settings-section">
          <h3>Conversation</h3>
          <dl class="settings-meta">
            <dt>Title</dt>
            <dd>{{ conv.title }}</dd>
            <dt>Messages</dt>
            <dd>{{ conv.messages.length }}</dd>
          </dl>
        </section>
      } @else {
        <p class="settings-empty">Select or create a conversation to edit its settings.</p>
      }

      <section class="settings-section" aria-label="Generation parameters">
        <div class="gen-header-row">
          <h3>Generation</h3>
          <app-button size="sm" variant="secondary" [disabled]="generationSettings.isDefault()" (click)="resetGeneration()">
            Reset to defaults
          </app-button>
        </div>
        <p class="settings-hint">Sampling parameters sent with every request. Held in memory only.</p>

        <div class="gen-grid">
          <app-input
            label="Temperature"
            type="number"
            step="0.1"
            [value]="genValue('temperature')"
            hint="0–2 · default 0.7"
            (valueChange)="onGenInput('temperature', $event)"
          ></app-input>
          @if (genError('temperature')) {
            <span class="field-error">{{ genError('temperature') }}</span>
          }

          <app-input
            label="Top P"
            type="number"
            step="0.05"
            [value]="genValue('topP')"
            hint="0–1 · default 1"
            (valueChange)="onGenInput('topP', $event)"
          ></app-input>
          @if (genError('topP')) {
            <span class="field-error">{{ genError('topP') }}</span>
          }

          <app-input
            label="Top K"
            type="number"
            step="1"
            [value]="genValue('topK')"
            hint="0–256, 0 = off · default 40"
            (valueChange)="onGenInput('topK', $event)"
          ></app-input>
          @if (genError('topK')) {
            <span class="field-error">{{ genError('topK') }}</span>
          }

          <app-input
            label="Repeat penalty"
            type="number"
            step="0.05"
            [value]="genValue('repeatPenalty')"
            hint="0.5–2 · default 1.1"
            (valueChange)="onGenInput('repeatPenalty', $event)"
          ></app-input>
          @if (genError('repeatPenalty')) {
            <span class="field-error">{{ genError('repeatPenalty') }}</span>
          }

          <app-input
            label="Max tokens"
            type="number"
            step="1"
            [value]="genValue('maxTokens')"
            hint="1–32768 · default 2048"
            (valueChange)="onGenInput('maxTokens', $event)"
          ></app-input>
          @if (genError('maxTokens')) {
            <span class="field-error">{{ genError('maxTokens') }}</span>
          }

          <label class="field gen-reasoning">
            <span class="field-label">Reasoning mode</span>
            <select
              class="field-control"
              [value]="generationSettings.settings().reasoningMode"
              aria-label="Reasoning mode"
              (change)="onReasoningModeChange($event)"
            >
              @for (mode of REASONING_MODES; track mode) {
                <option [value]="mode">{{ reasoningLabel(mode) }}</option>
              }
            </select>
            <span class="field-hint">off = no reasoning effort is sent</span>
          </label>
        </div>
      </section>

      <section class="settings-section" aria-label="LM Studio connection">
        <h3>LM Studio</h3>

        <div class="lm-status-row">
          <app-status-badge [tone]="statusTone()" [text]="statusText()"></app-status-badge>
          @if (lm.lastCheckedAt(); as ts) {
            <span class="lm-last-checked">Last success {{ formatTime(ts) }}</span>
          }
        </div>

        <app-input
          label="Server URL"
          type="search"
          [value]="lm.serverUrl()"
          placeholder="http://localhost:1234"
          hint="Held in memory only — cleared on refresh."
          (valueChange)="onUrlInput($event)"
        ></app-input>

        <app-input
          label="API token (optional)"
          type="password"
          [value]="lm.apiToken()"
          placeholder="Leave empty if no auth is enabled"
          hint="Held in memory only — never sent anywhere except the server above."
          (valueChange)="onTokenInput($event)"
        ></app-input>

        <div class="lm-actions">
          <app-button size="sm" [loading]="lm.checking()" [disabled]="lm.serverUrl().trim() === ''" (click)="lm.testConnection()">
            @if (lm.status() === 'connected') { Re-test connection } @else { Test connection }
          </app-button>
        </div>

        @if (lm.error(); as err) {
          <div class="lm-error" role="alert">
            <p class="lm-error-message">{{ err.message }}</p>
            @if (err.guidance.length > 0) {
              <ul class="lm-guidance">
                @for (g of err.guidance; track $index) {
                  <li>{{ g }}</li>
                }
              </ul>
            }
          </div>
        }

        @if (lm.lifecycleError(); as err) {
          <div class="lm-error" role="alert">
            <p class="lm-error-message">{{ err.message }}</p>
            @if (err.guidance.length > 0) {
              <ul class="lm-guidance">
                @for (g of err.guidance; track $index) {
                  <li>{{ g }}</li>
                }
              </ul>
            }
          </div>
        }

        @if (lm.lastAppliedConfig(); as cfg) {
          <div class="lm-applied-config">
            <h4>Loaded model</h4>
            <p class="applied-model-name">{{ cfg.modelId }}</p>
            @if (hasSettings(cfg)) {
              <dl class="model-meta applied-settings">
                @for (entry of configEntries(cfg); track entry.key) {
                  <dt>{{ entry.key }}</dt>
                  <dd>{{ formatSettingValue(entry.value) }}</dd>
                }
              </dl>
            } @else {
              <p class="settings-hint">Loaded with LM Studio defaults.</p>
            }
          </div>
        }

        @if (lm.status() === 'connected') {
          <div class="lm-catalog">
            <div class="lm-catalog-header">
              <h4>Models</h4>
              <label class="lm-filter">
                <input type="checkbox" [checked]="lm.chatOnly()" (change)="onToggleChatOnly($event)" />
                Chat-capable only
              </label>
            </div>

            @if (lm.visibleModels().length === 0) {
              <p class="settings-hint">
                @if (lm.models().length === 0) { No models are available on this server. }
                @else if (lm.chatOnly()) { None of the available models support chat. }
              </p>
            } @else {
              <div class="model-catalog-wrap">
                <ul class="model-list" aria-label="Available models">
                  @for (m of lm.visibleModels(); track m.id) {
                    <li class="model-card">
                      <div class="model-head">
                        <span class="model-name">{{ m.id }}</span>
                        @if (m.loaded) {
                          <app-status-badge tone="success" text="Loaded"></app-status-badge>
                        }
                      </div>
                      @if (m.publisher) {
                        <p class="model-publisher">{{ m.publisher }}</p>
                      }
                      <dl class="model-meta">
                        <dt>Quant</dt>
                        <dd>{{ m.quantization ?? '—' }}</dd>
                        <dt>Params</dt>
                        <dd>{{ fmtParams(m.parameterCount) }}</dd>
                        <dt>Size</dt>
                        <dd>{{ fmtSize(m.sizeBytes) }}</dd>
                        <dt>Format</dt>
                        <dd>{{ m.format ?? '—' }}</dd>
                      </dl>
                      @if (m.capabilities.length > 0) {
                        <ul class="model-caps">
                          @for (cap of m.capabilities; track cap) {
                            <li class="cap-chip">{{ cap }}</li>
                          }
                        </ul>
                      }
                      <div class="model-actions">
                        @if (!m.loaded) {
                          <app-button size="sm" [disabled]="lifecycleBusy()" (click)="onLoadModel(m.id)">
                            Load
                          </app-button>
                        } @else {
                          <app-button size="sm" variant="secondary" [disabled]="lifecycleBusy()" (click)="onUnloadModel(m.id)">
                            Unload
                          </app-button>
                        }
                      </div>
                    </li>
                  }
                </ul>

                @if (lm.lifecyclePhase() !== 'idle') {
                  <div class="lifecycle-overlay" role="status">
                    <span class="btn-spinner lifecycle-spinner" aria-hidden="true"></span>
                    <p class="lifecycle-title">{{ lifecycleLabel() }}</p>
                    <p class="lifecycle-elapsed">{{ formatElapsed(lm.lifecycleElapsedMs()) }}</p>
                  </div>
                }
              </div>
            }
          </div>
        } @else if (lm.status() === 'disconnected' && lm.lastCheckedAt() === null) {
          <p class="settings-hint">Test the connection to see locally available models.</p>
        }
      </section>

      <section class="settings-section">
        <h3>Appearance</h3>
        <div class="theme-row">
          <span>Theme: {{ theme.theme() }}</span>
          <app-icon-button label="Toggle dark mode" (click)="theme.toggle()">
            @if (theme.theme() === 'dark') {
              <app-icon name="sun" [size]="18"></app-icon>
            } @else {
              <app-icon name="moon" [size]="18"></app-icon>
            }
          </app-icon-button>
        </div>
      </section>

      <footer class="settings-footer">
        <app-status-badge tone="warning" text="Session only — refreshing clears chats"></app-status-badge>
      </footer>
    </div>
  `,
  styleUrl: './settings-panel.scss'
})
export class SettingsPanel {
  readonly store = inject(ConversationStore);
  readonly theme = inject(ThemeService);
  readonly lm = inject(LmStudioService);
  readonly generationSettings = inject(GenerationSettingsService);

  /** Reasoning modes offered by the select, exposed to the template. */
  protected readonly REASONING_MODES = REASONING_MODES;

  /** Last raw text per numeric field — shown while its validation fails. */
  private genDrafts: Partial<Record<NumericGenField, string>> = {};
  /** Validation error per numeric field (null when the last input was valid). */
  private genErrors: Record<NumericGenField, string | null> = {
    temperature: null,
    topP: null,
    topK: null,
    repeatPenalty: null,
    maxTokens: null,
  };

  /** Emitted when the close button is pressed (used by drawer layouts). */
  readonly close = output<void>();

  onPromptChange(value: string): void {
    const id = this.store.selectedId();
    if (id) {
      this.store.setSystemPrompt(id, value);
    }
  }

  /** Live URL edits invalidate any previous connection result. */
  onUrlInput(value: string): void {
    this.lm.serverUrl.set(value);
    if (this.lm.status() === 'connected' || this.lm.status() === 'failed') {
      this.lm.reset();
    }
  }

  /** Live token edits invalidate any previous connection result. */
  onTokenInput(value: string): void {
    this.lm.apiToken.set(value);
    if (this.lm.status() === 'connected' || this.lm.status() === 'failed') {
      this.lm.reset();
    }
  }

  onToggleChatOnly(event: Event): void {
    this.lm.chatOnly.set((event.target as HTMLInputElement).checked);
  }

  /** True while a load/unload is in flight or a chat generation is active. */
  lifecycleBusy(): boolean {
    return this.lm.lifecyclePhase() !== 'idle' || this.lm.generating();
  }

  onLoadModel(modelId: string): void {
    void this.lm.loadModel(modelId);
  }

  onUnloadModel(modelId: string): void {
    void this.lm.unloadModel(modelId);
  }

  lifecycleLabel(): string {
    const id = this.lm.loadingModelId();
    if (this.lm.lifecyclePhase() === 'unloading') {
      return `Unloading ${id ?? 'model'}…`;
    }
    return `Loading ${id ?? 'model'}…`;
  }

  formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s elapsed`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s elapsed`;
  }

  configEntries(cfg: { settings: Record<string, unknown> }): Array<{ key: string; value: unknown }> {
    return Object.entries(cfg.settings).map(([key, value]) => ({ key, value }));
  }

  hasSettings(cfg: { settings: Record<string, unknown> }): boolean {
    return Object.keys(cfg.settings).length > 0;
  }

  formatSettingValue(value: unknown): string {
    if (typeof value === 'boolean') {
      return value ? 'on' : 'off';
    }
    if (value instanceof Date) {
      return value.toLocaleTimeString();
    }
    return String(value);
  }

  statusTone(): BadgeTone {
    switch (this.lm.status()) {
      case 'connected':
        return 'success';
      case 'checking':
        return 'info';
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  statusText(): string {
    switch (this.lm.status()) {
      case 'connected':
        return `Connected — ${this.lm.models().length} model${this.lm.models().length === 1 ? '' : 's'}`;
      case 'checking':
        return 'Checking…';
      case 'failed':
        return 'Failed';
      default:
        return 'Disconnected';
    }
  }

  fmtSize(bytes?: number): string {
    return formatBytes(bytes);
  }

  fmtParams(billions?: number): string {
    return formatParams(billions);
  }

  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // --- Generation parameters (Phase 8) ------------------------------------

  /** Field value shown in the input: the invalid draft while editing, else the committed value. */
  genValue(field: NumericGenField): string {
    const draft = this.genDrafts[field];
    if (draft !== undefined && this.genErrors[field] !== null) {
      return draft;
    }
    return String(this.generationSettings.settings()[field]);
  }

  genError(field: NumericGenField): string | null {
    return this.genErrors[field];
  }

  /** Validates live input; commits valid values, shows errors for invalid ones. */
  onGenInput(field: NumericGenField, raw: string): void {
    const result = validateGenerationField(field, raw);
    if (result.ok) {
      this.genDrafts[field] = undefined;
      this.genErrors[field] = null;
      this.generationSettings.update({ [field]: result.value });
    } else {
      this.genDrafts[field] = raw;
      this.genErrors[field] = result.error;
    }
  }

  onReasoningModeChange(event: Event): void {
    const mode = (event.target as HTMLSelectElement).value as ReasoningMode;
    if ((REASONING_MODES as string[]).includes(mode)) {
      this.generationSettings.update({ reasoningMode: mode });
    }
  }

  resetGeneration(): void {
    this.generationSettings.reset();
    // Clear any pending invalid drafts so the inputs show the restored defaults.
    this.genDrafts = {};
    this.genErrors = { temperature: null, topP: null, topK: null, repeatPenalty: null, maxTokens: null };
  }

  reasoningLabel(mode: ReasoningMode): string {
    switch (mode) {
      case 'off':
        return 'Off';
      case 'low':
        return 'Low';
      case 'medium':
        return 'Medium';
      case 'high':
        return 'High';
    }
  }

  /** Exposed for tests: the defaults a reset restores. */
  protected readonly DEFAULTS = DEFAULT_GENERATION_SETTINGS;
}
