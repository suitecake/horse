// Level model. A level is a fixed-size grid of tiles plus sign text.

export const COLS = 32;
export const ROWS = 18;
export const TILE = 16;
export const WIDTH = COLS * TILE; // 512
export const HEIGHT = ROWS * TILE; // 288

export const enum T {
  Empty = 0,
  Solid = 1,
  Spike = 2,
  Start = 3,
  Goal = 4,
  Spring = 5,
  Crumble = 6,
  Fake = 7,
  Sign = 8,
  Platform = 9, // moves side to side
  Lift = 10, // moves up and down
}

/** The link format packs a tile into 4 bits, so there's room for 16. */
export const TILE_COUNT = 11;

export interface Level {
  title: string;
  author: string;
  tiles: Uint8Array; // COLS * ROWS, row-major
  signs: Map<number, string>; // tile index -> text
  /** Platform and Lift tiles that start off going the other way (left, or down). */
  flips: Set<number>;
}

export const SIGN_MAX = 80;
export const TITLE_MAX = 32;
export const NAME_MAX = 16;

export function idx(col: number, row: number): number {
  return row * COLS + col;
}

export function emptyLevel(): Level {
  return { title: "", author: "", tiles: new Uint8Array(COLS * ROWS), signs: new Map(), flips: new Set() };
}

export function cloneLevel(l: Level): Level {
  return { title: l.title, author: l.author, tiles: l.tiles.slice(), signs: new Map(l.signs), flips: new Set(l.flips) };
}

export function isPlank(t: number): boolean {
  return t === T.Platform || t === T.Lift;
}

export function findTile(l: Level, t: T): number {
  return l.tiles.indexOf(t);
}

/** The level a new visitor lands on: small, beatable, and a hint of what's possible. */
export function starterLevel(): Level {
  const l = emptyLevel();
  const set = (c: number, r: number, t: T) => (l.tiles[idx(c, r)] = t);
  for (let c = 0; c < COLS; c++) {
    set(c, ROWS - 1, T.Solid);
    set(c, ROWS - 2, T.Solid);
  }
  // a pit with crumbling bridge
  for (let c = 13; c < 18; c++) {
    set(c, ROWS - 1, T.Empty);
    set(c, ROWS - 2, T.Empty);
    set(c, ROWS - 2, T.Crumble);
  }
  set(3, ROWS - 3, T.Start);
  set(6, ROWS - 3, T.Sign);
  l.signs.set(idx(6, ROWS - 3), "this is your level. paint over it.");
  set(10, ROWS - 3, T.Spike);
  set(21, ROWS - 3, T.Spring);
  for (let c = 23; c < 30; c++) set(c, 10, T.Solid);
  set(26, 10, T.Fake);
  set(28, 9, T.Goal);
  return l;
}

export interface LevelProblem {
  ok: boolean;
  reason?: string;
}

export function checkPlayable(l: Level): LevelProblem {
  if (findTile(l, T.Start) < 0) return { ok: false, reason: "Place a start" };
  if (findTile(l, T.Goal) < 0) return { ok: false, reason: "Place a goal" };
  return { ok: true };
}
