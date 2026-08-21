import { AppliedLoadConfig, LmStudioConnectionError, LmStudioModel } from './types';
import { normalizeBaseUrl } from './format';

/** Default LM Studio local server (matches the environment configuration). */
export const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234';

const MODELS_PATH = '/api/v1/models';
const LOAD_PATH = '/api/v1/models/load';
const UNLOAD_PATH = '/api/v1/models/unload';

/**
 * Raw shape of a model entry as returned by the API. All fields except an id
 * (or `key` on newer servers) are optional. Both wire shapes are accepted:
 * - classic: `{ id, publisher, quantization, parameter_count, size, format, capabilities[], loaded }`
 * - current: `{ key, display_name, type, quantization: { name }, params_string, size_bytes, loaded_instances[] }`
 */
interface RawModel {
  id?: string;
  key?: string;
  display_name?: string | null;
  publisher?: string | null;
  /** A plain tag (classic) or `{ name, bits_per_weight }` (current). */
  quantization?: unknown;
  parameter_count?: number | null;
  /** e.g. "30B" on current servers. */
  params_string?: string | null;
  size?: number | null;
  size_bytes?: number | null;
  format?: string | null;
  type?: string | null;
  /** A tag array (classic) or a flag object (current). */
  capabilities?: unknown;
  loaded?: boolean | null;
  loaded_instances?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Derives capability tags from either wire shape. LLMs are chat-capable. */
export function deriveCapabilities(type: string | undefined, rawCapabilities: unknown): string[] {
  if (Array.isArray(rawCapabilities)) {
    return rawCapabilities.filter((c): c is string => typeof c === 'string');
  }
  const tags: string[] = [];
  if (type === 'llm') {
    tags.push('chat');
  }
  if (isRecord(rawCapabilities)) {
    if (rawCapabilities['vision'] === true) {
      tags.push('vision');
    }
    if (rawCapabilities['trained_for_tool_use'] === true) {
      tags.push('tools');
    }
    if (rawCapabilities['reasoning'] !== undefined && rawCapabilities['reasoning'] !== null) {
      tags.push('reasoning');
    }
  }
  return tags;
}

/** Maps one raw API entry into the typed model contract. Missing fields stay undefined. */
export function parseModel(raw: RawModel): LmStudioModel | null {
  const id =
    typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id
      : typeof raw.key === 'string' && raw.key.trim() !== ''
        ? raw.key
        : null;
  if (id === null) {
    return null;
  }

  let quantization: string | undefined;
  if (typeof raw.quantization === 'string' && raw.quantization !== '') {
    quantization = raw.quantization;
  } else if (isRecord(raw.quantization)) {
    const name = raw.quantization['name'];
    if (typeof name === 'string' && name !== '') {
      quantization = name;
    }
  }

  let parameterCount: number | undefined;
  if (typeof raw.parameter_count === 'number' && Number.isFinite(raw.parameter_count)) {
    parameterCount = raw.parameter_count;
  } else if (typeof raw.params_string === 'string') {
    const match = raw.params_string.match(/^(\d+(?:\.\d+)?)\s*B$/i);
    if (match !== null) {
      parameterCount = Number.parseFloat(match[1]);
    }
  }

  let sizeBytes: number | undefined;
  for (const candidate of [raw.size, raw.size_bytes]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      sizeBytes = candidate;
      break;
    }
  }

  const loaded =
    raw.loaded === true || (Array.isArray(raw.loaded_instances) ? raw.loaded_instances.length > 0 : false);

  return {
    id,
    displayName: typeof raw.display_name === 'string' && raw.display_name !== '' ? raw.display_name : undefined,
    publisher: typeof raw.publisher === 'string' && raw.publisher !== '' ? raw.publisher : undefined,
    quantization,
    parameterCount,
    sizeBytes,
    format: typeof raw.format === 'string' && raw.format !== '' ? raw.format : undefined,
    capabilities: deriveCapabilities(raw.type ?? undefined, raw.capabilities),
    loaded,
  };
}

/** Extracts and parses the model list from a response body of unknown shape. */
export function parseModelsResponse(body: unknown): LmStudioModel[] {
  const record = isRecord(body) ? body : null;
  // Classic envelope `{ object: 'list', data: [...] }` or current `{ models: [...] }`.
  const data = record === null ? undefined : (record['data'] ?? record['models']);
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry) => {
    const model = isRecord(entry) ? parseModel(entry as RawModel) : null;
    return model ? [model] : [];
  });
}

/** Guidance for the two most common browser-side failures (server down or CORS). */
export function networkGuidance(baseUrl: string): string[] {
  const location = baseUrl.trim() === '' ? 'the configured address' : baseUrl;
  return [
    `Make sure LM Studio is running and its local server is started at ${location}.`,
    'In LM Studio, open Developer → Settings and enable "Allow cross-origin requests" so the browser can reach it.',
    'Check that no firewall or proxy is blocking the port.',
  ];
}

/** Classifies a thrown fetch error into actionable guidance. */
export function classifyNetworkError(error: unknown, baseUrl: string): LmStudioConnectionError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') {
    return {
      kind: 'timeout',
      message: 'The request timed out.',
      guidance: [
        'LM Studio may be busy loading a model — wait a moment and try again.',
        'Check that the server URL is correct and reachable from this browser.',
      ],
    };
  }
  return {
    kind: 'network',
    message: 'Could not reach the LM Studio server. This usually means the server is not running or the browser blocked the request (CORS).',
    guidance: networkGuidance(baseUrl),
  };
}

/** Classifies a non-OK HTTP response into actionable guidance. */
export function classifyHttpError(status: number, baseUrl: string): LmStudioConnectionError {
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      message: `The server rejected the request (${status}).`,
      guidance: [
        'If you set an API token in LM Studio, paste it into the "API token" field above.',
        'Leave the token empty if your server has no authentication enabled.',
      ],
    };
  }
  return {
    kind: 'http',
    message: `The server responded with status ${status}.`,
    guidance: [
      `Verify that ${baseUrl} is pointing at an LM Studio local server (not another API).`,
      'Restart the LM Studio local server and try again.',
    ],
  };
}

/** Raw shape of the load response: `{ model, settings }` — parsed defensively. */
interface LoadResponse {
  model?: unknown;
  settings?: unknown;
}

/** Extracts and parses the applied load configuration from a response body of unknown shape. */
export function parseLoadResponse(body: unknown): AppliedLoadConfig | null {
  if (!isRecord(body)) {
    return null;
  }
  const raw = body as LoadResponse;
  const modelId = typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model : undefined;
  const settings = isRecord(raw.settings) ? (raw.settings as Record<string, unknown>) : {};
  if (!modelId) {
    return null;
  }
  return { modelId, settings, at: Date.now() };
}

/** Error carrying a classified connection failure. */
export class LmStudioRequestError extends Error {
  constructor(readonly classification: LmStudioConnectionError, cause?: unknown) {
    super(classification.message);
    this.name = 'LmStudioRequestError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Typed client for the LM Studio HTTP API. Pure class — no Angular, no storage:
 * every call takes its configuration explicitly so it is trivially testable.
 */
export class LmStudioClient {
  /** GET /api/v1/models with an optional Bearer token and abort signal. */
  async listModels(baseUrl: string, apiToken?: string, signal?: AbortSignal): Promise<LmStudioModel[]> {
    const body = await this.request<unknown>(baseUrl, MODELS_PATH, 'GET', undefined, apiToken, signal);
    return parseModelsResponse(body);
  }

  /**
   * POST /api/v1/models/load with LM Studio defaults (no advanced settings).
   * Returns the final applied load configuration reported by the server.
   */
  async loadModel(baseUrl: string, modelId: string, apiToken?: string, signal?: AbortSignal): Promise<AppliedLoadConfig> {
    const body = await this.request<unknown>(baseUrl, LOAD_PATH, 'POST', { model: modelId }, apiToken, signal);
    const config = parseLoadResponse(body);
    if (!config) {
      // The server accepted the load but returned an unexpected shape —
      // report success with the requested id and no settings rather than failing.
      return { modelId, settings: {}, at: Date.now() };
    }
    return config;
  }

  /** POST /api/v1/models/unload. When a model id is given only that model is unloaded. */
  async unloadModel(baseUrl: string, modelId?: string, apiToken?: string, signal?: AbortSignal): Promise<void> {
    await this.request<unknown>(baseUrl, UNLOAD_PATH, 'POST', modelId ? { model: modelId } : undefined, apiToken, signal);
  }

  /** Shared request plumbing: auth headers, error classification and JSON parsing. */
  private async request<T>(
    baseUrl: string,
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    apiToken?: string,
    signal?: AbortSignal
  ): Promise<T> {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (apiToken && apiToken.trim() !== '') {
      headers.set('Authorization', `Bearer ${apiToken.trim()}`);
    }

    let response: Response;
    try {
      response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new LmStudioRequestError(classifyNetworkError(error, baseUrl), error);
    }

    if (!response.ok) {
      throw new LmStudioRequestError(classifyHttpError(response.status, baseUrl));
    }

    try {
      return (await response.json()) as T;
    } catch {
      // A 2xx with a non-JSON body is treated as an empty result.
      return undefined as T;
    }
  }
}
