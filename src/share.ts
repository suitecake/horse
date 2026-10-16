// What goes in the URL.
//
//   #p=<level link>   a level plus the creator's clearing replay
//   #g=<ghost link>   the same, plus every attempt a friend made
//
// Both are a versioned binary blob, deflated, then base64url.

import { pack, Reader, unpack, Writer } from "./codec";
import { COLS, NAME_MAX, ROWS, SIGN_MAX, T, TILE_COUNT, TITLE_MAX, type Level } from "./level";
import { readReplay, writeReplay } from "./replay";
import { runReplay } from "./sim";

const LEVEL_VERSION = 1;
const GHOST_VERSION = 1;

/** Discord's message limit is 2000 characters; leave room for a few words. */
export const URL_BUDGET = 1900;

export function writeLevel(w: Writer, l: Level) {
  w.str(l.title.slice(0, TITLE_MAX));
  w.str(l.author.slice(0, NAME_MAX));
  const t = l.tiles;
  let runs = 0;
  for (let i = 0; i < t.length; ) {
    let j = i;
    while (j < t.length && t[j] === t[i]) j++;
    runs++;
    i = j;
  }
  w.varint(runs);
  for (let i = 0; i < t.length; ) {
    let j = i;
    while (j < t.length && t[j] === t[i]) j++;
    w.varint((j - i) * 16 + t[i]);
    i = j;
  }
  const signs = [...l.signs].filter(([i, s]) => t[i] === T.Sign && s.length > 0);
  w.varint(signs.length);
  for (const [i, s] of signs) {
    w.varint(i);
    w.str(s.slice(0, SIGN_MAX));
  }
}

export function readLevel(r: Reader): Level {
  const title = r.str().slice(0, TITLE_MAX);
  const author = r.str().slice(0, NAME_MAX);
  const tiles = new Uint8Array(COLS * ROWS);
  const runs = r.varint();
  let pos = 0;
  for (let k = 0; k < runs; k++) {
    const v = r.varint();
    const tile = v & 15;
    const len = Math.floor(v / 16);
    if (tile >= TILE_COUNT || pos + len > tiles.length) throw new Error("bad tile data");
    tiles.fill(tile, pos, pos + len);
    pos += len;
  }
  if (pos !== tiles.length) throw new Error("bad tile data");
  const signs = new Map<number, string>();
  const n = r.varint();
  for (let k = 0; k < n; k++) {
    const i = r.varint();
    const s = r.str().slice(0, SIGN_MAX);
    if (i < tiles.length && tiles[i] === T.Sign) signs.set(i, s);
  }
  return { title, author, tiles, signs };
}

export interface LevelLink {
  level: Level;
  clear: Uint8Array; // the creator's winning inputs
}

export interface GhostLink extends LevelLink {
  player: string;
  attempts: Uint8Array[];
  /** Attempts made in total, which can exceed attempts.length if trimmed to fit. */
  total: number;
}

export async function encodeLevelLink(link: LevelLink): Promise<string> {
  const w = new Writer();
  w.u8(LEVEL_VERSION);
  writeLevel(w, link.level);
  writeReplay(w, link.clear);
  return pack(w.finish());
}

export async function decodeLevelLink(s: string): Promise<LevelLink> {
  const r = new Reader(await unpack(s));
  const v = r.u8();
  if (v !== LEVEL_VERSION) throw new Error(`unknown level version ${v}`);
  const level = readLevel(r);
  const clear = readReplay(r);
  return { level, clear };
}

async function encodeGhostRaw(g: GhostLink): Promise<string> {
  const w = new Writer();
  w.u8(GHOST_VERSION);
  writeLevel(w, g.level);
  writeReplay(w, g.clear);
  w.str(g.player.slice(0, NAME_MAX));
  w.varint(g.total);
  w.varint(g.attempts.length);
  for (const a of g.attempts) writeReplay(w, a);
  return pack(w.finish());
}

/**
 * Encode a ghost link that fits in `budget` characters. If every attempt
 * doesn't fit, keep clears and the most recent attempts and drop the rest.
 */
export async function encodeGhostLink(g: GhostLink, budget: number): Promise<{ data: string; kept: number }> {
  let data = await encodeGhostRaw(g);
  if (data.length <= budget) return { data, kept: g.attempts.length };

  const clears = new Set<number>();
  g.attempts.forEach((a, i) => {
    if (runReplay(g.level, a).status === "won") clears.add(i);
  });
  // Binary search for how many of the most recent non-clear attempts fit.
  const others = g.attempts.map((_, i) => i).filter((i) => !clears.has(i));
  const build = (n: number) => {
    const keep = new Set([...clears, ...others.slice(others.length - n)]);
    return { ...g, attempts: g.attempts.filter((_, i) => keep.has(i)) };
  };
  let lo = 0;
  let hi = others.length;
  let best = await encodeGhostRaw(build(0));
  let bestKept = clears.size;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const trial = build(mid);
    data = await encodeGhostRaw(trial);
    if (data.length <= budget) {
      lo = mid;
      best = data;
      bestKept = trial.attempts.length;
    } else hi = mid - 1;
  }
  return { data: best, kept: bestKept };
}

export async function decodeGhostLink(s: string): Promise<GhostLink> {
  const r = new Reader(await unpack(s));
  const v = r.u8();
  if (v !== GHOST_VERSION) throw new Error(`unknown ghost version ${v}`);
  const level = readLevel(r);
  const clear = readReplay(r);
  const player = r.str().slice(0, NAME_MAX);
  const total = r.varint();
  const n = r.varint();
  if (n > 5000) throw new Error("too many attempts");
  const attempts: Uint8Array[] = [];
  for (let k = 0; k < n; k++) attempts.push(readReplay(r));
  return { level, clear, player, attempts, total: Math.max(total, n) };
}

export function linkFor(kind: "p" | "g", data: string): string {
  const u = new URL(location.href);
  u.search = "";
  u.hash = `${kind}=${data}`;
  return u.toString();
}
