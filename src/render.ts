// Drawing. Everything renders at native 512x288 into a buffer, which is then
// scaled up by a whole number so pixels stay square.

import { COLS, HEIGHT, ROWS, T, TILE, WIDTH, type Level } from "./level";
import { CRUMBLE_DELAY, PH, PW, crumbleFallen, type Sim } from "./sim";
import { flipped, HORSE_ART, PAL, silhouette, sprite, TILE_ART } from "./sprites";

type Img = HTMLCanvasElement;

interface Horse {
  right: Img;
  left: Img;
}

let art: {
  tiles: Record<string, Img>;
  horse: Record<string, Horse>;
  ghost: Record<string, Horse>;
  gold: Record<string, Horse>;
  bg: Img;
} | null = null;

function both(img: Img): Horse {
  return { right: img, left: flipped(img) };
}

function loadArt() {
  if (art) return art;
  const tiles: Record<string, Img> = {};
  for (const [k, v] of Object.entries(TILE_ART)) tiles[k] = sprite(v);
  const horse: Record<string, Horse> = {};
  const ghost: Record<string, Horse> = {};
  const gold: Record<string, Horse> = {};
  for (const [k, v] of Object.entries(HORSE_ART)) {
    const s = sprite(v);
    horse[k] = both(s);
    ghost[k] = both(silhouette(s, PAL.ghost));
    gold[k] = both(silhouette(s, PAL.gold));
  }
  art = { tiles, horse, ghost, gold, bg: makeBackground() };
  return art;
}

/** Cheap deterministic hash for texture variation. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Ordered dithering between two colours, for the sky.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function makeBackground(): Img {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext("2d")!;
  const bands = [PAL.night, "#2f2045", PAL.plum, "#623660", PAL.mauve, "#a2516a", PAL.rose, "#de8160", PAL.apricot];
  const bandH = HEIGHT / (bands.length - 1);
  for (let y = 0; y < HEIGHT; y++) {
    const t = y / bandH;
    const i = Math.min(bands.length - 2, Math.floor(t));
    const f = t - i;
    for (let x = 0; x < WIDTH; x++) {
      const threshold = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      ctx.fillStyle = f > threshold ? bands[i + 1] : bands[i];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // stars in the upper sky
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 1) % WIDTH;
    const y = hash(i, 2) % (HEIGHT * 0.4);
    ctx.fillStyle = hash(i, 3) % 4 === 0 ? PAL.butter : PAL.cream;
    ctx.globalAlpha = 0.35 + (hash(i, 4) % 60) / 100;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  // a fat setting sun, low on the horizon
  const sx = 352;
  const sy = 168;
  const R = 30;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d = x * x + y * y;
      if (d > R * R) continue;
      if (y > 4 && y % 6 < 1 + Math.floor((y - 4) / 7)) continue; // retro sun stripes
      ctx.fillStyle = d > (R - 3) * (R - 3) ? PAL.apricot : y < -8 ? PAL.cream : PAL.butter;
      ctx.fillRect(sx + x, sy + y, 1, 1);
    }
  }
  // mesas: flat tops, stepped sides, a lit rim along the top
  const mesa = (x0: number, w: number, top: number, color: string, rim: string) => {
    for (let y = top; y < HEIGHT; y++) {
      const spread = Math.floor((y - top) / 3) + ((y - top) % 7 === 0 ? 1 : 0);
      ctx.fillStyle = color;
      ctx.fillRect(x0 - spread, y, w + spread * 2, 1);
    }
    ctx.fillStyle = rim;
    ctx.fillRect(x0, top, w, 1);
  };
  for (const [x, w, top] of [
    [20, 70, 176],
    [150, 40, 190],
    [250, 110, 182],
    [430, 60, 170],
  ])
    mesa(x, w, top, "#5a3460", "#8a4f6e");
  for (const [x, w, top] of [
    [-20, 90, 214],
    [120, 60, 226],
    [300, 50, 206],
    [400, 130, 222],
  ])
    mesa(x, w, top, "#3d2547", "#6b3a5c");
  ctx.fillStyle = "#2c1c38";
  ctx.fillRect(0, 250, WIDTH, HEIGHT - 250);
  return c;
}

function looksSolid(t: number) {
  return t === T.Solid || t === T.Fake;
}

function tileAt(level: Level, c: number, r: number): number {
  if (c < 0 || c >= COLS || r >= ROWS) return T.Solid;
  if (r < 0) return T.Empty;
  return level.tiles[r * COLS + c];
}

/** Dirt with a grassy top, edged where it meets air. Fake blocks use this too. */
function drawGroundAt(ctx: CanvasRenderingContext2D, level: Level, c: number, r: number) {
  const up = looksSolid(tileAt(level, c, r - 1));
  const down = looksSolid(tileAt(level, c, r + 1));
  const left = looksSolid(tileAt(level, c - 1, r));
  const right = looksSolid(tileAt(level, c + 1, r));
  drawGround(ctx, c * TILE, c, r, up, down, left, right);
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  x: number,
  c: number,
  r: number,
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean,
) {
  const y = r * TILE;
  ctx.fillStyle = PAL.dirt;
  ctx.fillRect(x, y, TILE, TILE);
  for (let i = 0; i < 6; i++) {
    const h = hash(c * 31 + i, r * 17 + i);
    ctx.fillStyle = i % 3 === 0 ? PAL.dirtDark : PAL.dirtSpeck;
    ctx.fillRect(x + (h % 14) + 1, y + ((h >>> 8) % 14) + 1, i % 2 ? 2 : 1, 1);
  }
  ctx.fillStyle = PAL.ink;
  if (!left) ctx.fillRect(x, y, 1, TILE);
  if (!right) ctx.fillRect(x + TILE - 1, y, 1, TILE);
  if (!down) ctx.fillRect(x, y + TILE - 1, TILE, 1);
  ctx.fillStyle = PAL.dirtDark;
  if (!down) ctx.fillRect(x + (left ? 0 : 1), y + TILE - 3, TILE - (left ? 0 : 1) - (right ? 0 : 1), 2);
  if (!up) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x, y, TILE, 1);
    ctx.fillStyle = PAL.grass;
    ctx.fillRect(x + (left ? 0 : 1), y + 1, TILE - (left ? 0 : 1) - (right ? 0 : 1), 4);
    ctx.fillStyle = PAL.grassLight;
    ctx.fillRect(x + (left ? 0 : 1), y + 1, TILE - (left ? 0 : 1) - (right ? 0 : 1), 1);
    // ragged grass edge
    ctx.fillStyle = PAL.grassDark;
    for (let i = 0; i < TILE; i += 2) {
      if (!left && i === 0) continue;
      if (!right && i >= TILE - 2) continue;
      const h = hash(c * 16 + i, r);
      ctx.fillRect(x + i, y + 5, 2, 1 + (h % 3 === 0 ? 1 : 0));
    }
    if (!left) ctx.fillRect(x + 1, y + 1, 1, 4);
    if (!right) ctx.fillRect(x + TILE - 2, y + 1, 1, 4);
  }
}

export interface DrawOpts {
  editor?: boolean;
  /** Crumble state comes from the sim. Without one, all crumbles are intact. */
  sim?: Sim | null;
  /** For animation; doesn't affect the game. */
  t: number;
  /** In the editor, where the cursor is. */
  hover?: { c: number; r: number; tile: number } | null;
  /** Spring tiles currently squashed. */
  squash?: Set<number>;
}

export function drawScene(ctx: CanvasRenderingContext2D, level: Level, o: DrawOpts) {
  const a = loadArt();
  ctx.drawImage(a.bg, 0, 0);
  if (o.editor) drawGrid(ctx);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const t = level.tiles[i];
      const x = c * TILE;
      const y = r * TILE;
      switch (t) {
        case T.Solid:
          drawGroundAt(ctx, level, c, r);
          break;
        case T.Fake:
          drawGroundAt(ctx, level, c, r);
          if (o.editor) drawFakeMark(ctx, x, y, o.t);
          break;
        case T.Spike:
          ctx.drawImage(a.tiles.spike, x, y);
          break;
        case T.Spring:
          ctx.drawImage(o.squash?.has(i) ? a.tiles.springSquash : a.tiles.spring, x, y);
          break;
        case T.Crumble:
          drawCrumble(ctx, a.tiles.crumble, x, y, o.sim ?? null, i);
          break;
        case T.Goal: {
          ctx.drawImage(a.tiles.goal, x, y);
          break;
        }
        case T.Sign:
          ctx.drawImage(a.tiles.sign, x, y);
          break;
        case T.Start:
          if (o.editor) ctx.drawImage(a.tiles.start, x, y);
          break;
      }
    }
  }
  if (o.hover) drawHover(ctx, o.hover, o.t);
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(251,236,200,0.07)";
  for (let c = 1; c < COLS; c++) ctx.fillRect(c * TILE, 0, 1, HEIGHT);
  for (let r = 1; r < ROWS; r++) ctx.fillRect(0, r * TILE, WIDTH, 1);
}

function drawFakeMark(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // marching dashed border plus a "?" so only the builder can tell
  ctx.fillStyle = PAL.butter;
  const off = Math.floor(t / 8) % 4;
  for (let i = 0; i < 16; i++) {
    if ((i + off) % 4 < 2) {
      ctx.fillRect(x + i, y, 1, 1);
      ctx.fillRect(x + 15 - i, y + 15, 1, 1);
      ctx.fillRect(x, y + 15 - i, 1, 1);
      ctx.fillRect(x + 15, y + i, 1, 1);
    }
  }
  const q = ["kkk.", "...k", "..k.", "....", "..k."];
  for (let r = 0; r < q.length; r++)
    for (let c = 0; c < 4; c++) if (q[r][c] === "k") ctx.fillRect(x + 6 + c, y + 6 + r, 1, 1);
}

function drawCrumble(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, sim: Sim | null, i: number) {
  if (!sim || sim.crumbleAt[i] === 0) {
    ctx.drawImage(img, x, y);
    return;
  }
  const age = sim.frame - (sim.crumbleAt[i] - 1);
  if (!crumbleFallen(sim, i)) {
    const shake = age % 4 < 2 ? -1 : 1;
    ctx.drawImage(img, x + (age > CRUMBLE_DELAY / 3 ? shake : 0), y);
    return;
  }
  const fall = age - CRUMBLE_DELAY;
  if (fall > 40) return;
  ctx.globalAlpha = Math.max(0, 1 - fall / 40);
  const dy = Math.floor((fall * fall) / 6);
  ctx.drawImage(img, 0, 0, 8, 16, x - Math.floor(fall / 4), y + dy, 8, 16);
  ctx.drawImage(img, 8, 0, 8, 16, x + 8 + Math.floor(fall / 4), y + dy + 2, 8, 16);
  ctx.globalAlpha = 1;
}

function drawHover(ctx: CanvasRenderingContext2D, h: { c: number; r: number; tile: number }, t: number) {
  const x = h.c * TILE;
  const y = h.r * TILE;
  ctx.globalAlpha = 0.55;
  if (h.tile !== T.Empty) {
    const a = loadArt();
    const img =
      h.tile === T.Solid || h.tile === T.Fake
        ? null
        : { [T.Spike]: a.tiles.spike, [T.Spring]: a.tiles.spring, [T.Crumble]: a.tiles.crumble, [T.Goal]: a.tiles.goal, [T.Sign]: a.tiles.sign, [T.Start]: a.horse.stand.right }[h.tile];
    if (img) ctx.drawImage(img, x, y);
    else {
      ctx.fillStyle = PAL.dirt;
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = h.tile === T.Empty ? PAL.x : PAL.cream;
  const blink = Math.floor(t / 20) % 2 ? 1 : 0;
  for (const [dx, dy, w, hh] of [
    [0, 0, 4, 1],
    [0, 0, 1, 4],
    [12, 0, 4, 1],
    [15, 0, 1, 4],
    [0, 15, 4, 1],
    [0, 12, 1, 4],
    [12, 15, 4, 1],
    [15, 12, 1, 4],
  ])
    ctx.fillRect(x + dx - blink, y + dy - blink, w, hh);
}

export type HorseLook = "player" | "ghost" | "gold";

export function horsePose(sim: Sim): string {
  const p = sim.p;
  if (!p.grounded) return "jump";
  if (p.vx === 0) return "stand";
  return Math.floor(sim.frame / 6) % 2 ? "run1" : "run2";
}

/** x, y are the player's hitbox top-left in pixels. */
export function drawHorse(ctx: CanvasRenderingContext2D, x: number, y: number, facing: 1 | -1, pose: string, look: HorseLook) {
  const a = loadArt();
  const set = look === "player" ? a.horse : look === "ghost" ? a.ghost : a.gold;
  const img = set[pose] ?? set.stand;
  ctx.drawImage(facing > 0 ? img.right : img.left, x - (16 - PW) / 2, y - (16 - PH));
}

export function drawSimHorse(ctx: CanvasRenderingContext2D, sim: Sim, look: HorseLook) {
  drawHorse(ctx, sim.p.x >> 8, sim.p.y >> 8, sim.p.facing, horsePose(sim), look);
}

export function drawDeathMark(ctx: CanvasRenderingContext2D, x: number, y: number, age: number) {
  // a little red X that pops in
  const s = age < 4 ? 4 : age < 8 ? 3 : 2;
  ctx.fillStyle = PAL.ink;
  for (let i = -s - 1; i <= s + 1; i++) {
    ctx.fillRect(x + i - 1, y + i - 1, 3, 3);
    ctx.fillRect(x + i - 1, y - i - 1, 3, 3);
  }
  ctx.fillStyle = PAL.x;
  for (let i = -s; i <= s; i++) {
    ctx.fillRect(x + i, y + i, 1, 1);
    ctx.fillRect(x + i, y - i, 1, 1);
  }
}

// --- particles (cosmetic only, never touches the sim) ---

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  g: number;
}

export class Particles {
  private list: Particle[] = [];
  private seed = 1;
  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  burst(x: number, y: number, n: number, colors: string[], speed: number, g = 0.08, life = 30) {
    for (let i = 0; i < n; i++) {
      const ang = this.rnd() * Math.PI * 2;
      const sp = speed * (0.4 + this.rnd() * 0.6);
      this.list.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - speed * 0.4,
        life: life * (0.6 + this.rnd() * 0.4),
        max: life,
        color: colors[Math.floor(this.rnd() * colors.length)],
        g,
      });
    }
  }
  dust(x: number, y: number) {
    for (let i = 0; i < 5; i++) {
      this.list.push({ x, y, vx: (this.rnd() - 0.5) * 1.6, vy: -this.rnd() * 0.5, life: 14, max: 14, color: PAL.bone, g: 0 });
    }
  }
  update() {
    for (const p of this.list) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.life--;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  clear() {
    this.list.length = 0;
  }
}

/** A small icon of a tile for the toolbar. */
export function tileIcon(tile: number): string {
  const a = loadArt();
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  switch (tile) {
    case T.Solid:
    case T.Fake:
      drawGround(ctx, 0, 0, 0, false, false, false, false);
      if (tile === T.Fake) drawFakeMark(ctx, 0, 0, 0);
      break;
    case T.Spike:
      ctx.drawImage(a.tiles.spike, 0, 0);
      break;
    case T.Spring:
      ctx.drawImage(a.tiles.spring, 0, 0);
      break;
    case T.Crumble:
      ctx.drawImage(a.tiles.crumble, 0, 0);
      break;
    case T.Goal:
      ctx.drawImage(a.tiles.goal, 0, 0);
      break;
    case T.Sign:
      ctx.drawImage(a.tiles.sign, 0, 0);
      break;
    case T.Start:
      ctx.drawImage(a.horse.stand.right, 0, 0);
      break;
  }
  return c.toDataURL();
}

export function horseIcon(): string {
  return loadArt().horse.stand.right.toDataURL();
}
