/**
 * Test helpers for mocking globalThis.fetch against the LM Studio client.
 *
 * - `createFetchMock()` records every request (URL, method, body, headers) and
 *   routes to a configurable responder — used by the endpoint regression tests.
 * - `sseBody(chunks)` builds an immediately-available SSE response body.
 * - `GatedSseBody` delivers chunks only when the test releases them, which makes
 *   cancellation / connection-loss mid-stream deterministic (no timer races).
 */

export interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Headers;
  signal?: AbortSignal;
}

/** A fetch mock that records calls and delegates to a configurable responder. */
export function createFetchMock() {
  const calls: FetchCall[] = [];
  let responder: (call: FetchCall) => Response | Promise<Response> = () => new Response('{}', { status: 200 });

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? undefined
    };
    calls.push(call);
    return responder(call);
  });

  return {
    fn,
    calls,
    setResponder(responderFn: (call: FetchCall) => Response | Promise<Response>): void {
      responder = responderFn;
    },
    reset(): void {
      calls.length = 0;
    }
  };
}

/** Build an SSE response body whose chunks are all available immediately. */
export function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

/**
 * A pull-based SSE body that only delivers data when the test calls push()/close()/fail().
 * `pendingReads` lets a test wait until the consumer is actually blocked on a read.
 */
export class GatedSseBody {
  private queue: string[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;
  private failure: unknown = null;
  private readonly encoder = new TextEncoder();

  /** The stream to hand to a mocked Response. */
  readonly stream: ReadableStream<Uint8Array>;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
    const self = this;
    this.stream = new ReadableStream({
      pull(controller) {
        void self.pump(controller).catch(() => {
          /* pump surfaces its own errors via controller.error */
        });
      }
    });
  }

  private signal?: AbortSignal;

  /** Number of reads currently waiting for data. */
  get pendingReads(): number {
    return this.waiters.length;
  }

  /** Deliver one chunk to the next (or current) blocked read. */
  push(chunk: string): void {
    this.queue.push(chunk);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  /** End the stream cleanly. */
  close(): void {
    this.closed = true;
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  /** Fail the next read with `error` (e.g. a network TypeError). */
  fail(error: unknown): void {
    this.failure = error;
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private async pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    for (;;) {
      if (this.signal?.aborted || this.failure !== null) {
        try {
          controller.error(this.failure ?? new DOMException('Aborted', 'AbortError'));
        } catch {
          /* stream already settled */
        }
        return;
      }
      const chunk = this.queue.shift();
      if (chunk !== undefined) {
        controller.enqueue(this.encoder.encode(chunk));
        return;
      }
      if (this.closed) {
        try {
          controller.close();
        } catch {
          /* stream already settled */
        }
        return;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
          };
          const cleanup = () => this.signal?.removeEventListener('abort', onAbort);
          if (this.signal) this.signal.addEventListener('abort', onAbort, { once: true });
          this.waiters.push(() => {
            cleanup();
            resolve();
          });
        });
      } catch (err) {
        try {
          controller.error(err);
        } catch {
          /* stream already settled */
        }
        return;
      }
    }
  }
}

/** Poll a condition until true or the timeout elapses (deterministic test sync). */
export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
