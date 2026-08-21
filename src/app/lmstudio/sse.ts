/** A complete SSE frame whose `data:` payload has been assembled. */
export interface SseDataEvent {
  /** The data payload of one frame — JSON text or the `[DONE]` sentinel. */
  value: string;
}

/**
 * Incremental Server-Sent-Events parser for readable-stream consumption.
 *
 * Feed it raw chunks from `response.body.getReader()` via {@link push}; it
 * buffers partial lines across chunk boundaries (LF and CRLF), assembles
 * multi-line `data:` frames per the SSE spec, ignores comments (`:…`) and
 * unknown fields, and returns each completed frame. Call {@link finish} when
 * the stream ends to flush a trailing frame that lacked its terminating
 * blank line (recovery from interrupted streams).
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];

  /** Feeds raw stream text and returns every frame completed by this chunk. */
  push(chunk: string): SseDataEvent[] {
    // Normalise line endings so only LF needs handling (CRLF → LF, lone CR → LF).
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const events: SseDataEvent[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const event = this.consumeLine(line);
      if (event !== null) {
        events.push(event);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
    return events;
  }

  /**
   * Signals end-of-stream: processes any buffered partial line and flushes a
   * pending frame that never received its terminating blank line (recovery
   * from interrupted streams). Safe to call when nothing is pending.
   */
  finish(): SseDataEvent[] {
    const events = this.push('\n'); // Simulate the stream's final line break.
    const event = this.flushFrame();
    if (event !== null) {
      events.push(event);
    }
    return events;
  }

  private consumeLine(line: string): SseDataEvent | null {
    if (line === '') {
      // A blank line terminates the current frame.
      return this.flushFrame();
    }
    if (line.startsWith(':')) {
      return null; // Comment / keep-alive — nothing to do.
    }

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1); // Per the SSE spec: strip exactly one leading space.
    }

    if (field === 'data') {
      this.dataLines.push(value);
    }
    // Other fields (event, id, retry) are not used by chat streams — ignore them.
    return null;
  }

  private flushFrame(): SseDataEvent | null {
    if (this.dataLines.length === 0) {
      return null;
    }
    const value = this.dataLines.join('\n');
    this.dataLines = [];
    return { value };
  }
}
