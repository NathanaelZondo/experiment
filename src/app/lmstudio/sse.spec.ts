import { SseParser } from './sse';

describe('SseParser', () => {
  it('parses a complete frame delivered in one chunk', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"a":1}\n\n');
    expect(events).toEqual([{ value: '{"a":1}' }]);
  });

  it('reassembles frames split across arbitrary chunk boundaries', () => {
    const parser = new SseParser();
    // Split mid-key, mid-value and even inside the terminating blank line.
    expect(parser.push('da')).toEqual([]);
    expect(parser.push('ta: {"x":')).toEqual([]);
    expect(parser.push('2}\n\n')).toEqual([{ value: '{"x":2}' }]);
  });

  it('handles CRLF and lone CR line endings', () => {
    const parser = new SseParser();
    expect(parser.push('data: one\r\ndata: two\r\n\r\n')).toEqual([{ value: 'one\ntwo' }]);
    // Lone CRs are normalised to line breaks, so this also terminates a frame.
    const crOnly = new SseParser();
    expect(crOnly.push('data: solo\r\r')).toEqual([{ value: 'solo' }]);
  });

  it('joins multi-line data fields of one frame with newlines (SSE spec)', () => {
    const parser = new SseParser();
    // Two `data:` lines before the blank line form ONE frame.
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual([{ value: 'line1\nline2' }]);
  });

  it('emits separate frames when a blank line separates them', () => {
    const parser = new SseParser();
    expect(parser.push('data: first\n\ndata: second\n\n')).toEqual([{ value: 'first' }, { value: 'second' }]);
  });

  it('ignores comments and unknown fields', () => {
    const parser = new SseParser();
    const events = parser.push(': keep-alive\nevent: delta\nid: 7\nretry: 3000\ndata: payload\n\n');
    expect(events).toEqual([{ value: 'payload' }]);
  });

  it('strips exactly one leading space after the colon', () => {
    const parser = new SseParser();
    // "data:no-space" keeps its full value; "data: two-spaces " loses only the first space.
    expect(parser.push('data:no-space\ndata: two-spaces \n\n')).toEqual([{ value: 'no-space\ntwo-spaces ' }]);
  });

  it('emits multiple frames from a single chunk', () => {
    const parser = new SseParser();
    const events = parser.push('data: a\n\ndata: b\n\n');
    expect(events).toEqual([{ value: 'a' }, { value: 'b' }]);
  });

  it('flushes a trailing frame without its terminating blank line on finish()', () => {
    const parser = new SseParser();
    expect(parser.push('data: tail')).toEqual([]); // No newline yet — still buffered.
    expect(parser.finish()).toEqual([{ value: 'tail' }]);
  });

  it('returns nothing from finish() when no frame is pending', () => {
    const parser = new SseParser();
    parser.push('data: done\n\n');
    expect(parser.finish()).toEqual([]);
  });

  it('treats a line without a colon as an empty data value', () => {
    const parser = new SseParser();
    expect(parser.push('data\n\n')).toEqual([{ value: '' }]);
  });
});
