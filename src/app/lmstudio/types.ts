/** A model entry as reported by LM Studio's GET /api/v1/models endpoint. */
export interface LmStudioModel {
  /** Unique model identifier, e.g. "Llama-3.2-8B-Instruct-Q4_K_M.gguf". */
  id: string;
  /** Human-friendly name reported by newer LM Studio servers (falls back to id). */
  displayName?: string;
  publisher?: string;
  quantization?: string;
  /** Parameter count in billions (e.g. 8 or 13.1). */
  parameterCount?: number;
  /** Size on disk in bytes. */
  sizeBytes?: number;
  /** File format, e.g. "gguf". */
  format?: string;
  /** Capability tags such as "chat", "vision" or "tools". */
  capabilities: string[];
  /** True when the model is currently loaded into memory. */
  loaded: boolean;
}

/** Lifecycle of a connection attempt against the LM Studio server. */
export type ConnectionStatus = 'disconnected' | 'checking' | 'connected' | 'failed';

/** Phase of the one-model-at-a-time load/unload lifecycle. */
export type LifecyclePhase = 'idle' | 'unloading' | 'loading';

/** The final applied load configuration reported by LM Studio after a successful load. */
export interface AppliedLoadConfig {
  /** Model id that was loaded. */
  modelId: string;
  /** Settings actually applied (LM Studio defaults when none were overridden). */
  settings: Record<string, unknown>;
  /** Timestamp of the successful load. */
  at: number;
}

/** Why a connection attempt failed, used to pick user-facing guidance. */
export type LmStudioErrorKind = 'network' | 'auth' | 'http' | 'timeout';

/** A classified connection error with actionable, token-free guidance. */
export interface LmStudioConnectionError {
  kind: LmStudioErrorKind;
  message: string;
  /** Actionable steps for the user. Never includes the API token. */
  guidance: string[];
}
