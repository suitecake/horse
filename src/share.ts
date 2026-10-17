// What goes in the URL.
//
//   #p=<level link>   a level plus the creator's clearing replay
//   #g=<ghost link>   the same, plus every attempt a friend made
//
// Both are a versioned binary blob, deflated, then base64url.

import { pack, Reader, unpack, Writer } from "./codec";
import { COLS, isPlank, NAME_MAX, ROWS, SIGN_MAX, T, TILE_COUNT, TITLE_MAX, type Level } from "./level";
import { MAX_FRAMES, readReplay, writeReplay } from "./replay";
import { runReplay } from "./sim";

const LEVEL_VERSION = 2;
const GHOST_VERSION = 3;

/**
 * How a level itself is laid out inside a link or draft.
 *   1: title, author, tiles, signs
 *   2: plus which platforms start off going the other way
 */
export const LEVEL_FORMAT = 2;

/** Discord's message limit is 2000 characters; leave room for a few words. */
export const URL_BUDGET = 1900;

export function writeLevel(w: Writer, l: Level, format = LEVEL_FORMAT) {
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
  if (format < 2) return;
  const flips = [...l.flips].filter((i) => isPlank(t[i])).sort((a, b) => a - b);
  w.varint(flips.length);
  for (const i of flips) w.varint(i);
}

export function readLevel(r: Reader, format = LEVEL_FORMAT): Level {
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
  const flips = new Set<number>();
  const nf = format < 2 ? 0 : r.varint();
  if (nf > tiles.length) throw new Error("bad platform data");
  for (let k = 0; k < nf; k++) {
    const i = r.varint();
    if (i < tiles.length && isPlank(tiles[i])) flips.add(i);
  }
  return { title, author, tiles, signs, flips };
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
  /** Attempt number (1-based, out of `total`) of the first clear, or 0 if never cleared. */
  firstClear: number;
  /** Clears in total, kept in the link or not. */
  clears: number;
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
  if (v !== 1 && v !== LEVEL_VERSION) throw new Error(`unknown level version ${v}`);
  const level = readLevel(r, v === 1 ? 1 : 2);
  const clear = readReplay(r);
  return { level, clear };
}

/**
 * Frames across every attempt in a ghost link. The watch screen simulates them
 * all up front, so a link that packs in more than this is refused.
 */
export const MAX_GHOST_FRAMES = MAX_FRAMES * 20;

async function encodeGhostRaw(g: GhostLink): Promise<string> {
  const w = new Writer();
  w.u8(GHOST_VERSION);
  writeLevel(w, g.level);
  writeReplay(w, g.clear);
  w.str(g.player.slice(0, NAME_MAX));
  w.varint(g.total);
  w.varint(g.firstClear);
  w.varint(g.clears);
  w.varint(g.attempts.length);
  for (const a of g.attempts) writeReplay(w, a);
  return pack(w.finish());
}

/**
 * Encode a ghost link that fits in `budget` characters. `won[i]` says whether
 * attempt i cleared the level. If every attempt doesn't fit, attempts are kept
 * in priority order (the first clear, then other clears newest first, then the
 * rest newest first) and the rest dropped.
 */
export async function encodeGhostLink(
  g: Omit<GhostLink, "total" | "firstClear" | "clears">,
  won: boolean[],
  budget: number,
): Promise<{ data: string; kept: number }> {
  const first = won.indexOf(true);
  const full: GhostLink = {
    ...g,
    total: g.attempts.length,
    firstClear: first + 1,
    clears: won.filter(Boolean).length,
  };
  const frames = (as: Uint8Array[]) => as.reduce((n, a) => n + a.length, 0);
  const fits = (data: string, as: Uint8Array[]) => data.length <= budget && frames(as) <= MAX_GHOST_FRAMES;

  let data = await encodeGhostRaw(full);
  if (fits(data, full.attempts)) return { data, kept: full.attempts.length };

  const newestFirst = g.attempts.map((_, i) => i).reverse();
  const priority = [
    ...(first >= 0 ? [first] : []),
    ...newestFirst.filter((i) => won[i] && i !== first),
    ...newestFirst.filter((i) => !won[i]),
  ];
  const build = (n: number) => {
    const keep = new Set(priority.slice(0, n));
    return { ...full, attempts: g.attempts.filter((_, i) => keep.has(i)) };
  };
  // Binary search for how many attempts, in priority order, fit.
  let lo = 0;
  let hi = priority.length - 1;
  let best = await encodeGhostRaw(build(0));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const trial = build(mid);
    data = await encodeGhostRaw(trial);
    if (fits(data, trial.attempts)) {
      lo = mid;
      best = data;
    } else hi = mid - 1;
  }
  return { data: best, kept: lo };
}

export async function decodeGhostLink(s: string): Promise<GhostLink> {
  const r = new Reader(await unpack(s));
  const v = r.u8();
  if (v < 1 || v > GHOST_VERSION) throw new Error(`unknown ghost version ${v}`);
  const level = readLevel(r, v < 3 ? 1 : 2);
  const clear = readReplay(r);
  const player = r.str().slice(0, NAME_MAX);
  let total = r.varint();
  // v1 didn't record clears; they're worked out from the attempts below.
  let firstClear = v === 1 ? -1 : r.varint();
  let clears = v === 1 ? -1 : r.varint();
  const n = r.varint();
  if (n > 5000) throw new Error("too many attempts");
  const attempts: Uint8Array[] = [];
  let frames = 0;
  for (let k = 0; k < n; k++) {
    const a = readReplay(r);
    frames += a.length;
    if (frames > MAX_GHOST_FRAMES) throw new Error("too many frames");
    attempts.push(a);
  }
  total = Math.max(total, n);
  if (v === 1) {
    const won = attempts.map((a) => runReplay(level, a).status === "won");
    firstClear = won.indexOf(true) + 1;
    clears = won.filter(Boolean).length;
  }
  if (firstClear > total) throw new Error("bad first clear");
  clears = firstClear === 0 ? 0 : Math.min(Math.max(clears, 1), total);
  return { level, clear, player, attempts, total, firstClear, clears };
}

export function linkFor(kind: "p" | "g", data: string): string {
  const u = new URL(location.href);
  u.search = "";
  u.hash = `${kind}=${data}`;
  return u.toString();
}
