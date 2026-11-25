// xterm supplies text for typing and byte strings for classic mouse reports.
// Queue both in event order while the previous native write is pending.
export class TerminalInput {
  private readonly parts: { data: string; binary: boolean }[] = [];
  private size = 0;

  push(data: string, binary: boolean) {
    if (this.size + data.length > 128 * 1024) return false;
    if (!data.length) return true;
    const last = this.parts[this.parts.length - 1];
    if (last?.binary === binary) last.data += data;
    else this.parts.push({ data, binary });
    this.size += data.length;
    return true;
  }

  take(): string | number[] | undefined {
    const part = this.parts[0];
    if (!part) return;
    // Even four-byte characters fit the backend's 32 KiB message limit.
    let end = Math.min(8192, part.data.length);
    if (!part.binary && end < part.data.length && /[\uD800-\uDBFF]/.test(part.data[end - 1])) end--;
    const chunk = part.data.slice(0, end);
    if (end === part.data.length) this.parts.shift();
    else part.data = part.data.slice(end);
    this.size -= end;
    return part.binary ? Array.from(chunk, char => char.charCodeAt(0)) : chunk;
  }

  clear() {
    this.parts.length = 0;
    this.size = 0;
  }
}
