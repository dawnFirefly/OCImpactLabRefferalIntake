/**
 * Incremental scanner for a streamed JSON object. Calls `onItem(key, value)` each
 * time an object element of a top-level array (e.g. `sections[]`, `facts[]`) closes.
 * Items are previews only; the complete response is still validated as a whole.
 *
 * Only the current item and the current string are buffered (from chunk slices), so
 * CPU stays linear in the output size; this matters on Cloudflare Workers' CPU budget.
 */
export class TopLevelArrayItems {
  private stack: { kind: "object" | "array"; key: string | null }[] = [];
  private inString = false;
  private escaped = false;
  private stringText = "";
  private lastString: string | null = null;
  private pendingKey: string | null = null;
  private item: string | null = null;
  private onItem: (key: string, value: unknown) => void;
  constructor(onItem: (key: string, value: unknown) => void) { this.onItem = onItem; }

  push(chunk: string) {
    let itemFrom = 0, stringFrom = 0;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          this.stringText += chunk.slice(stringFrom, i + 1);
          try { this.lastString = JSON.parse(this.stringText); } catch { this.lastString = null; }
        }
        continue;
      }
      if (ch === '"') { this.inString = true; this.stringText = ""; stringFrom = i; }
      else if (ch === ":") this.pendingKey = this.lastString;
      else if (ch === "{" || ch === "[") {
        const parent = this.stack.at(-1);
        this.stack.push({ kind: ch === "{" ? "object" : "array", key: parent?.kind === "object" ? this.pendingKey : null });
        this.pendingKey = null;
        // root object → array → element object: start capturing this item.
        if (ch === "{" && this.stack.length === 3 && this.stack[1]!.kind === "array") { this.item = ""; itemFrom = i; }
      } else if (ch === "}" || ch === "]") {
        const closed = this.stack.pop();
        if (closed?.kind === "object" && this.stack.length === 2 && this.item !== null) {
          const text = this.item + chunk.slice(itemFrom, i + 1);
          this.item = null;
          const key = this.stack[1]!.key;
          if (key) {
            try { this.onItem(key, JSON.parse(text)); }
            catch { /* malformed preview item; final validation decides */ }
          }
        }
      } else if (ch === ",") this.pendingKey = null;
    }
    if (this.inString) this.stringText += chunk.slice(stringFrom);
    if (this.item !== null) this.item += chunk.slice(itemFrom);
  }
}
