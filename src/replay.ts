// A replay is one input byte per frame. On the wire it's run-length encoded,
// each run a single varint of (length << bits | buttons).
//
//   format 1: a varint run count, then runs with 3 bits of buttons
//   format 2: a varint of (run count << 1 | wide). Wide replays use 4 bits,
//             for Down; the rest keep 3, so most links stay the same size.

import { Reader, Writer } from "./codec";

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_DOWN = 8;

export const REPLAY_FORMAT = 2;

/** Ten minutes at 60fps. Attempts that run longer are cut off. */
export const MAX_FRAMES = 60 * 60 * 10;

export function writeReplay(w: Writer, inputs: Uint8Array, format = REPLAY_FORMAT) {
  let runs = 0;
  for (let i = 0; i < inputs.length; ) {
    let j = i;
    while (j < inputs.length && inputs[j] === inputs[i]) j++;
    runs++;
    i = j;
  }
  const wide = format >= 2 && inputs.some((x) => (x & IN_DOWN) !== 0);
  const bits = wide ? 16 : 8;
  w.varint(format >= 2 ? runs * 2 + (wide ? 1 : 0) : runs);
  for (let i = 0; i < inputs.length; ) {
    let j = i;
    while (j < inputs.length && inputs[j] === inputs[i]) j++;
    w.varint((j - i) * bits + (inputs[i] & (bits - 1)));
    i = j;
  }
}

export function readReplay(r: Reader, format = REPLAY_FORMAT): Uint8Array {
  const head = r.varint();
  const runs = format >= 2 ? Math.floor(head / 2) : head;
  const bits = format >= 2 && head % 2 === 1 ? 16 : 8;
  const out: number[] = [];
  for (let k = 0; k < runs; k++) {
    const v = r.varint();
    const len = Math.floor(v / bits);
    if (out.length + len > MAX_FRAMES) throw new Error("replay too long");
    for (let i = 0; i < len; i++) out.push(v % bits);
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
