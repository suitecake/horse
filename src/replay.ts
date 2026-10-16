// A replay is one input byte per frame. On the wire it's run-length encoded:
// each run is a single varint of (length << 3 | buttons).

import { Reader, Writer } from "./codec";

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;

/** Ten minutes at 60fps. Attempts that run longer are cut off. */
export const MAX_FRAMES = 60 * 60 * 10;

export function writeReplay(w: Writer, inputs: Uint8Array) {
  let runs = 0;
  for (let i = 0; i < inputs.length; ) {
    let j = i;
    while (j < inputs.length && inputs[j] === inputs[i]) j++;
    runs++;
    i = j;
  }
  w.varint(runs);
  for (let i = 0; i < inputs.length; ) {
    let j = i;
    while (j < inputs.length && inputs[j] === inputs[i]) j++;
    w.varint((j - i) * 8 + (inputs[i] & 7));
    i = j;
  }
}

export function readReplay(r: Reader): Uint8Array {
  const runs = r.varint();
  const out: number[] = [];
  for (let k = 0; k < runs; k++) {
    const v = r.varint();
    const len = Math.floor(v / 8);
    if (out.length + len > MAX_FRAMES) throw new Error("replay too long");
    for (let i = 0; i < len; i++) out.push(v & 7);
  }
  return Uint8Array.from(out);
}

/** Grows as frames are recorded. */
export class Recorder {
  private buf = new Uint8Array(1024);
  length = 0;
  push(input: number) {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = input;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
