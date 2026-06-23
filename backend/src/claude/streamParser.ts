import { classifyEvent, type ClaudeEvent } from "./events.js";

/**
 * Incremental, defensive parser for newline-delimited stream-json.
 *
 * `feed(chunk)` returns the events completed by that chunk; partial trailing
 * lines are buffered across chunk boundaries. `flush()` parses any trailing
 * line with no final newline. Unparseable lines are skipped (never thrown), so
 * a stray non-JSON line from the CLI can't crash the wrapper.
 */
export class StreamParser {
  private buffer = "";

  feed(chunk: string | Buffer): ClaudeEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const events: ClaudeEvent[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const ev = this.parseLine(line);
      if (ev) events.push(ev);
    }
    return events;
  }

  flush(): ClaudeEvent[] {
    const line = this.buffer;
    this.buffer = "";
    const ev = this.parseLine(line);
    return ev ? [ev] : [];
  }

  private parseLine(line: string): ClaudeEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null; // ignore non-JSON noise
    }
    return classifyEvent(obj);
  }
}
