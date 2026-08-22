import { Injectable } from '@angular/core';

export type ConnectionState = 'checking' | 'connected' | 'disconnected' | 'failed';

export interface ModelInfo {
  id: string;
  name: string;
  publisher: string;
  quantization: string;
  parameterCount: string;
  size: string;
  format: string;
  capabilities: string[];
}

export interface LmStudioConfig {
  serverUrl: string;
  apiToken?: string;
}

/**
 * Result of a streaming chat generation.
 */
export interface StreamingChatResult {
  /** The final aggregated response text */
  response: string;
  /** Usage statistics from the server */
  stats?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    elapsedMs: number;
  };
  /** If the generation was cancelled */
  cancelled: boolean;
}

/**
 * Streaming chat event types from LM Studio.
 */
export type StreamingChatEvent =
  | { type: 'chat.start' }
  | { type: 'reasoning.delta'; delta: string }
  | { type: 'message.delta'; delta: string }
  | { type: 'error'; message: string }
  | { type: 'chat.end'; response: string; stats?: StreamingChatResult['stats'] };

/**
 * Configuration for streaming chat generation.
 */
export interface StreamingChatConfig {
  /** Model to use for generation */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** User message */
  message: string;
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p sampling (0-1) */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Repeat penalty */
  repeatPenalty?: number;
  /** Maximum output tokens */
  maxTokens?: number;
  /** Reasoning mode setting */
  reasoningMode?: 'disabled' | 'enabled' | 'auto';
}

/**
 * LM Studio client service.
 * Holds server configuration and connection state in RAM only (no persistence).
 */
@Injectable({ providedIn: 'root' })
export class LmStudioService {
  /** Server URL held in RAM */
  public readonly serverUrl = signal<string>('');

  /** Optional API token held in RAM */
  public readonly apiToken = signal<string | undefined>(undefined);

  /** Current connection state */
  public readonly connectionState = signal<ConnectionState>('disconnected');

  /** Loading flag for model fetch */
  public readonly isLoading = signal<boolean>(false);

  /** Cached model list */
  public readonly models = signal<ModelInfo[]>([]);

  /** Filtered (chat-capable only) model list */
  public readonly chatModels = signal<ModelInfo[]>([]);

  /** Currently loaded model, or null if none */
  public readonly activeModel = signal<string | null>(null);

  /** Whether a model is currently being loaded */
  public readonly loadingModel = signal<boolean>(false);

  /** Whether a generation is actively in progress (non-streaming) */
  public readonly isGenerating = signal<boolean>(false);

  /** Whether a streaming generation is actively in progress */
  public readonly isStreaming = signal<boolean>(false);

  /** Cumulative response text from current stream */
  private readonly streamingResponse = signal<string>('');

  /** Current accumulated reasoning text */
  private readonly streamingReasoning = signal<string>('');

  /** Track concurrent request promises for cancellation/protection */
  private activeGenerationPromise: Promise<StreamingChatResult> | null =
    null;

  /**
   * Server URL getter
   */
  public getServerUrl(): string {
    return this.serverUrl();
  }

  /**
   * Optional API token getter
   */
  public getApiToken(): string | undefined {
    return this.apiToken();
  }

  /**
   * Current connection state label text
   */
  public getConnectionStateLabel(): string {
    switch (this.connectionState()) {
      case 'checking':
        return 'Checking connection...';
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Disconnected';
      case 'failed':
        return 'Connection failed';
      default:
        return 'Unknown';
    }
  }

  /**
   * Current connection state CSS class
   */
  public getConnectionStateClass(): string {
    switch (this.connectionState()) {
      case 'checking':
        return 'checking';
      case 'connected':
        return 'connected';
      case 'disconnected':
        return 'disconnected';
      case 'failed':
        return 'failed';
      default:
        return '';
    }
  }

  /** Check if currently connected */
  public isConnected(): boolean {
    return this.connectionState() === 'connected';
  }

  /** Check if currently checking */
  public isChecking(): boolean {
    return this.connectionState() === 'checking';
  }

  /** Check if connection failed */
  public isFailed(): boolean {
    return this.connectionState() === 'failed';
  }

  /** Check if currently generating (non-streaming) */
  public isGeneratingActive(): boolean {
    return this.isGenerating();
  }

  /** Check if currently streaming */
  public isStreamingActive(): boolean {
    return this.isStreaming();
  }

  /** Getter for connection state label text */
  public getConnectionStateLabelText(): string {
    return this.getConnectionStateLabel();
  }

  /** Clear server configuration */
  public clearConfig(): void {
    this.serverUrl.set('');
    this.apiToken.set(undefined);
    this.connectionState.set('disconnected');
    this.models.set([]);
    this.chatModels.set([]);
    this.activeModel.set(null);
    this.loadingModel.set(false);
    this.isGenerating.set(false);
    this.isStreaming.set(false);
    this.streamingResponse.set('');
    this.streamingReasoning.set('');
    this.activeGenerationPromise = null;
  }

  /** Test the connection to LM Studio via GET /api/v1/models. */
  public async testConnection(): Promise<boolean> {
    const url = this.serverUrl().trim();
    if (!url) {
      this.connectionState.set('failed');
      return false;
    }

    this.connectionState.set('checking');

    try {
      const token = this.apiToken() ?? '';
      const headers: Record<string, string> = {};

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${url}/api/v1/models`, {
        method: 'GET',
        headers,
        credentials: 'omit',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`,
        );
      }

      const data = (await response.json()) as ModelInfo[];
      this.models.set(data || []);
      this.chatModels.set(this.filterChatCapable(data));
      this.connectionState.set('connected');
      return true;
    } catch (error) {
      console.error('LM Studio connection error:', error);
      const err = error as Error;
      if (
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError')
      ) {
        this.connectionState.set('failed');
      } else {
        this.connectionState.set('failed');
      }
      this.models.set([]);
      this.chatModels.set([]);
      return false;
    }
  }

  /** Filter models to only chat-capable LLMs. */
  private filterChatCapable(models: ModelInfo[]): ModelInfo[] {
    return models.filter((model) => {
      const idLower = model.id.toLowerCase();
      const nameLower = model.name.toLowerCase();

      // Check capabilities array
      if (model.capabilities && model.capabilities.includes('chat')) {
        return true;
      }

      // Check for common chat indicators in ID/name
      const chatKeywords = ['chat', 'instruct', 'chatml', 'llama'];
      const hasChatKeyword = chatKeywords.some((kw) => idLower.includes(kw));
      if (hasChatKeyword) {
        return true;
      }

      // If no explicit markers, include all models and let the UI decide
      return true;
    });
  }

  /**
   * Stream a chat generation from LM Studio.
   * Uses Server-Sent Events (SSE) via fetch() with AbortController support.
   *
   * Event stream format: SSE "data: {event_type}: {json}" lines
   * Supported events:
   *   - chat.start: Model loading and prompt-processing start
   *   - reasoning.delta: Incremental reasoning text update
   *   - message.delta: Incremental response text update
   *   - error: Error occurrence, stream terminates
   *   - chat.end: Final aggregated response and stats
   *
   * @param config - Streaming generation configuration
   * @returns Promise resolving to {response, stats, cancelled}
   */
  public async streamChat(
    config: StreamingChatConfig,
  ): Promise<StreamingChatResult> {
    const { model, systemPrompt, message, temperature = 0.7, topP = 1 } =
      config;

    const topK = config.topK ?? -1;
    const repeatPenalty = config.repeatPenalty ?? 1.05;
    const maxTokens = config.maxTokens ?? 4096;
    const reasoningMode = config.reasoningMode ?? 'disabled';

    // Concurrency protection: set up fresh state for new generation
    if (this.activeGenerationPromise !== null) {
      this.isStreaming.set(true);
      this.streamingResponse.set('');
      this.streamingReasoning.set('');
    }

    const abortController = new AbortController();

    let result: StreamingChatResult = {
      response: '',
      cancelled: false,
    };

    try {
      const url = this.serverUrl().trim();
      if (!url) {
        throw new Error('No server URL configured');
      }

      // Build query parameters for generation settings
      const params = new URLSearchParams({
        model,
        temperature: temperature.toString(),
        top_p: topP.toString(),
        top_k: topK >= 0 ? topK.toString() : '',
        repeat_penalty: repeatPenalty.toString(),
        max_tokens: maxTokens.toString(),
        reasoning_mode: reasoningMode,
      });

      // Add system prompt if provided
      if (systemPrompt) {
        params.append('system_prompt', systemPrompt);
      }

      const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      const streamUrl = `${baseUrl}/api/v1/chat/stream?${params.toString()}`;

      // Send the message via POST to initiate streaming
      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiToken() ?? undefined && {
            Authorization: `Bearer ${this.apiToken()}`,
          }),
        },
        body: JSON.stringify({ message }),
        credentials: 'omit',
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`,
        );
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        // Check for cancellation using abortController.signal.aborted
        if (abortController.signal.aborted) {
          result.cancelled = true;
          try {
            const { done, value } = await reader.read();
            if (!done && value) {
              buffer += decoder.decode(value, { stream: true });
              this.processSseEvents(buffer, result);
            }
          } catch (readError) {
            // Ignore read errors after cancellation
          }
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            this.processSseEvents(buffer, result);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        this.processSseEvents(buffer, result);

        // After processing, trim buffer to incomplete last event line
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline >= 0) {
          buffer = buffer.substring(lastNewline + 1);
        } else {
          buffer = '';
        }
      }

      // If not cancelled, final response from chat.end event
      if (!result.cancelled && result.response === '') {
        result.response = this.streamingResponse() || message;
      }

    } catch (error) {
      console.error('Streaming chat error:', error);
      if (!result.cancelled) {
        result = { response: '', cancelled: false };
      }
    } finally {
      // Only clear streaming state if not cancelled
      if (!result.cancelled) {
        this.isStreaming.set(false);
      }
      this.activeGenerationPromise = null;
    }

    return result;
  }

  /**
   * Process individual SSE events from the buffer.
   * Updates streaming state and result as events arrive.
   */
  private processSseEvents(
    buffer: string,
    result: StreamingChatResult,
  ): void {
    const lines = buffer.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let eventData: any;
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.substring(5).trim();
        if (!jsonStr) {
          continue;
        }
        try {
          eventData = JSON.parse(jsonStr);
        } catch (e) {
          console.warn('Malformed SSE data event:', jsonStr);
          this.handleRecovery(jsonStr, result);
          continue;
        }
      } else {
        try {
          eventData = JSON.parse(trimmed);
        } catch (e) {
          console.warn('Non-SSE line, skipping:', trimmed);
          continue;
        }
      }

      if (!eventData || typeof eventData.type !== 'string') {
        console.warn('Invalid SSE event (missing type):', eventData);
        continue;
      }

      switch (eventData.type) {
        case 'chat.start':
          this.isStreaming.set(true);
          this.streamingResponse.set('');
          this.streamingReasoning.set('');
          break;

        case 'reasoning.delta':
          if (eventData.delta !== undefined) {
            const current = this.streamingReasoning() || '';
            this.streamingReasoning.set(current + eventData.delta);
          }
          break;

        case 'message.delta':
          if (eventData.delta !== undefined) {
            const current = this.streamingResponse() || '';
            this.streamingResponse.set(current + eventData.delta);
          }
          break;

        case 'error':
          console.error('SSE error event:', eventData.message);
          result.response = `Error: ${eventData.message}`;
          break;

        case 'chat.end':
          if (eventData.response !== undefined) {
            this.streamingResponse.set(eventData.response);
          }
          result.response = eventData.response || this.streamingResponse();
          if (eventData.stats) {
            result.stats = eventData.stats;
          }
          this.isStreaming.set(false);
          break;

        default:
          console.log('Unknown SSE event type:', eventData.type);
      }
    }
  }

  /**
   * Handle recovery from malformed or interrupted streams.
   */
  private handleRecovery(fallbackText: string, result: StreamingChatResult): void {
    if (fallbackText && fallbackText.trim().length > 0) {
      const trimmed = fallbackText.trim();
      const maxChunk = 500;
      result.response =
        trimmed.length > maxChunk
          ? trimmed.substring(0, maxChunk) + '...'
          : trimmed;
    }
  }

  /**
   * Send a message and get a streaming response.
   *
   * @param model - Model ID to use
   * @param message - User message content
   * @param options - Optional generation settings
   * @returns Promise resolving to {response, stats, cancelled}
   */
  public async generateStreaming(
    model: string,
    message: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repeatPenalty?: number;
      maxTokens?: number;
      reasoningMode?: 'disabled' | 'enabled' | 'auto';
    },
  ): Promise<StreamingChatResult> {
    return this.streamChat({
      model,
      message,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature ?? 0.7,
      topP: options?.topP ?? 1,
      topK: options?.topK ?? -1,
      repeatPenalty: options?.repeatPenalty ?? 1.05,
      maxTokens: options?.maxTokens ?? 4096,
      reasoningMode: options?.reasoningMode ?? 'disabled',
    });
  }
}