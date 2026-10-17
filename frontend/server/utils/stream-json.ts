/**
 * Incremental scanner for a streamed JSON object. Calls `onItem(key, value)` each
 * time an object element of a top-level array (e.g. `sections[]`, `facts[]`) closes.
 * Items are previews only; the complete response is still validated as a whole.
 */
export class TopLevelArrayItems {
  private buffer = "";
  private position = 0;
  private stack: { kind: "object" | "array"; key: string | null; start: number }[] = [];
  private inString = false;
  private escaped = false;
  private stringStart = 0;
  private lastString: string | null = null;
  private pendingKey: string | null = null;

  private onItem: (key: string, value: unknown) => void;
  constructor(onItem: (key: string, value: unknown) => void) { this.onItem = onItem; }

  push(chunk: string) {
    this.buffer += chunk;
    for (; this.position < this.buffer.length; this.position++) {
      const ch = this.buffer[this.position]!;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          try { this.lastString = JSON.parse(this.buffer.slice(this.stringStart, this.position + 1)); }
          catch { this.lastString = null; }
        }
        continue;
      }
      if (ch === '"') { this.inString = true; this.stringStart = this.position; }
      else if (ch === ":") this.pendingKey = this.lastString;
      else if (ch === "{" || ch === "[") {
        const parent = this.stack.at(-1);
        this.stack.push({ kind: ch === "{" ? "object" : "array", key: parent?.kind === "object" ? this.pendingKey : null, start: this.position });
        this.pendingKey = null;
      } else if (ch === "}" || ch === "]") {
        const closed = this.stack.pop();
        const parent = this.stack.at(-1);
        // root object → array (depth 1) → element object closing here.
        if (closed?.kind === "object" && parent?.kind === "array" && this.stack.length === 2 && parent.key) {
          try { this.onItem(parent.key, JSON.parse(this.buffer.slice(closed.start, this.position + 1))); }
          catch { /* malformed preview item; final validation decides */ }
        }
      } else if (ch === ",") this.pendingKey = null;
    }
  }
}
