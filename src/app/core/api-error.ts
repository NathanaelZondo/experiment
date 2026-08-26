/**
 * Typed API error contract for LM Studio communication.
 *
 * Every failure that leaves the application is normalized into an `LmApiError`
 * so stores and components can react to a single, typed shape instead of raw
 * fetch/HTTP exceptions. Error messages never contain credentials: the client
 * only ever appends an Authorization header at request time and this module
 * has no access to it.
 */

export type LmApiErrorKind =
  /** The server could not be reached (not running, wrong URL/port) or a CORS policy blocked the response. */
  | 'network'
  /** The server answered with a non-2xx HTTP status. */
  | 'http'
  /** The response body could not be parsed as expected JSON. */
  | 'parse'
  /** The request was aborted by the user (cancellation). Not an error state for the UI. */
  | 'aborted'
  /** Anything else. */
  | 'unknown';

export class LmApiError extends Error {
  constructor(
    message: string,
    public readonly kind: LmApiErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LmApiError';
  }
}

/** True when `err` is an abort caused by AbortController. */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === 'AbortError' ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
  );
}

/**
 * Normalize an unknown failure thrown by `fetch`/response handling into an
 * LmApiError. In browsers, both "server not running" and CORS rejections surface
 * as a TypeError from fetch, so the network kind carries guidance for both.
 */
export function toLmApiError(err: unknown): LmApiError {
  if (err instanceof LmApiError) {
    return err;
  }
  if (isAbortError(err)) {
    return new LmApiError('Request cancelled', 'aborted');
  }
  if (err instanceof TypeError) {
    return new LmApiError(
      'Could not reach the LM Studio server. Check that it is running and that its CORS settings allow this page.',
      'network'
    );
  }
  if (err instanceof Error) {
    // Never propagate raw messages that could embed request details; keep a safe summary.
    return new LmApiError(err.message || 'Unknown error', 'unknown');
  }
  return new LmApiError('Unknown error', 'unknown');
}

/** Build an LmApiError for a non-2xx HTTP response, with a short body excerpt when JSON. */
export function httpError(status: number, bodyExcerpt?: string): LmApiError {
  const detail = bodyExcerpt ? ` (${bodyExcerpt})` : '';
  return new LmApiError(`LM Studio returned HTTP ${status}${detail}`, 'http', status);
}
