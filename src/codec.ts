// Binary encoding helpers: a byte writer/reader with varints and strings,
// raw deflate, and base64url for putting it all in a URL.

export class Writer {
  private buf: number[] = [];
  u8(n: number) {
    this.buf.push(n & 0xff);
  }
  varint(n: number) {
    if (n < 0 || !Number.isInteger(n)) throw new Error(`bad varint ${n}`);
    while (n >= 0x80) {
      this.buf.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.buf.push(n);
  }
  bytes(b: Uint8Array) {
    this.varint(b.length);
    for (const x of b) this.buf.push(x);
  }
  str(s: string) {
    this.bytes(new TextEncoder().encode(s));
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

export class Reader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}
  get done() {
    return this.pos >= this.buf.length;
  }
  u8(): number {
    if (this.pos >= this.buf.length) throw new Error("unexpected end of data");
    return this.buf[this.pos++];
  }
  varint(): number {
    let n = 0;
    let mul = 1;
    for (let i = 0; i < 6; i++) {
      const b = this.u8();
      n += (b & 0x7f) * mul;
      if (!(b & 0x80)) return n;
      mul *= 128;
    }
    throw new Error("varint too long");
  }
  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new Error("unexpected end of data");
    const out = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  str(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Nothing we encode comes close; this stops a crafted link from inflating into gigabytes. */
export const MAX_INFLATED = 1 << 20;

export const deflate = (d: Uint8Array) => pipe(d, new CompressionStream("deflate-raw"));

export async function inflate(d: Uint8Array, max = MAX_INFLATED): Promise<Uint8Array> {
  const reader = new Blob([d as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("data too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function toBase64Url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Pack bytes for a URL: deflate then base64url. */
export async function pack(b: Uint8Array): Promise<string> {
  return toBase64Url(await deflate(b));
}

export async function unpack(s: string): Promise<Uint8Array> {
  return inflate(fromBase64Url(s));
}
