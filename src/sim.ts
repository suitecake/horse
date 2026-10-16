// Deterministic platformer physics.
//
// Everything here is integer math on a fixed 60Hz step, so a list of inputs
// replays to exactly the same result on every machine. Positions are in
// subpixels: 256 per pixel, so one 16px tile is 4096 (1 << 12).
// Don't introduce floats, Math.random, or wall-clock time in this file.

import { COLS, ROWS, T, type Level } from "./level";
import { IN_JUMP, IN_LEFT, IN_RIGHT, MAX_FRAMES } from "./replay";

const SUB = 256;
const TS = 16 * SUB; // tile size in subpixels
const TSHIFT = 12;

export const PW = 10; // player hitbox, px
export const PH = 12;

const ACCEL_GROUND = 40;
const ACCEL_AIR = 30;
const TURN_GROUND = 90;
const FRICTION_GROUND = 48;
const FRICTION_AIR = 10;
const MAX_RUN = 512;
const JUMP_V = 1100;
const SPRING_V = 1760;
const G_HOLD = 56; // rising with jump held, or bouncing off a spring
const G_FALL = 120;
const MAX_FALL = 1400;
const COYOTE = 5;
const JUMP_BUFFER = 6;
export const CRUMBLE_DELAY = 24;

export type Status = "playing" | "dead" | "won";
export type Cause = "spike" | "pit" | "fake" | "crumble" | "timeout" | null;

/** How recently a fake or crumbling block must have been involved to get the blame. */
const BLAME_WINDOW = 120;

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  springing: boolean;
  facing: 1 | -1;
}

export interface Sim {
  level: Level;
  frame: number;
  p: Player;
  status: Status;
  cause: Cause;
  prevInput: number;
  /** 0 = intact, otherwise the frame it was stepped on (+1). */
  crumbleAt: Int32Array;
  /** Last frames the player touched a fake block or stood on a crumbling one. */
  lastFake: number;
  lastCrumble: number;
  /** Events from the most recent step, for sound and particles. */
  events: SimEvent[];
}

export type SimEvent = "jump" | "spring" | "land" | "crumble" | "die" | "win";

export function spawnPoint(level: Level): { x: number; y: number } {
  let i = level.tiles.indexOf(T.Start);
  if (i < 0) i = 0;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { x: (col * 16 + (16 - PW) / 2) * SUB, y: (row * 16 + 16 - PH) * SUB };
}

export function createSim(level: Level): Sim {
  const s = spawnPoint(level);
  return {
    level,
    frame: 0,
    p: { x: s.x, y: s.y, vx: 0, vy: 0, grounded: false, coyote: 0, buffer: 0, springing: false, facing: 1 },
    status: "playing",
    cause: null,
    prevInput: 0,
    crumbleAt: new Int32Array(COLS * ROWS),
    lastFake: -BLAME_WINDOW,
    lastCrumble: -BLAME_WINDOW,
    events: [],
  };
}

export function crumbleFallen(sim: Sim, i: number): boolean {
  const at = sim.crumbleAt[i];
  return at > 0 && sim.frame - (at - 1) >= CRUMBLE_DELAY;
}

function tileAt(sim: Sim, col: number, row: number): number {
  if (col < 0 || col >= COLS || row < 0) return T.Solid; // walls and ceiling
  if (row >= ROWS) return T.Empty; // the pit
  return sim.level.tiles[row * COLS + col];
}

function solidAt(sim: Sim, col: number, row: number): boolean {
  const t = tileAt(sim, col, row);
  if (t === T.Solid || t === T.Spring) return true;
  if (t === T.Crumble) return !crumbleFallen(sim, row * COLS + col);
  return false;
}

function anySolid(sim: Sim, c0: number, c1: number, r0: number, r1: number): boolean {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidAt(sim, c, r)) return true;
  return false;
}

function moveX(sim: Sim) {
  const p = sim.p;
  if (p.vx === 0) return;
  const nx = p.x + p.vx;
  const r0 = p.y >> TSHIFT;
  const r1 = (p.y + PH * SUB - 1) >> TSHIFT;
  if (p.vx > 0) {
    const c = (nx + PW * SUB - 1) >> TSHIFT;
    if (anySolid(sim, c, c, r0, r1)) {
      p.x = c * TS - PW * SUB;
      p.vx = 0;
      return;
    }
  } else {
    const c = nx >> TSHIFT;
    if (anySolid(sim, c, c, r0, r1)) {
      p.x = (c + 1) * TS;
      p.vx = 0;
      return;
    }
  }
  p.x = nx;
}

function moveY(sim: Sim) {
  const p = sim.p;
  const ny = p.y + p.vy;
  const c0 = p.x >> TSHIFT;
  const c1 = (p.x + PW * SUB - 1) >> TSHIFT;
  const wasGrounded = p.grounded;
  p.grounded = false;
  if (p.vy > 0) {
    const r = (ny + PH * SUB - 1) >> TSHIFT;
    if (anySolid(sim, c0, c1, r, r)) {
      p.y = r * TS - PH * SUB;
      p.grounded = true;
      p.springing = false;
      let spring = false;
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(sim, c, r);
        if (t === T.Spring) spring = true;
        if (t === T.Crumble) {
          sim.lastCrumble = sim.frame;
          const i = r * COLS + c;
          if (sim.crumbleAt[i] === 0) {
            sim.crumbleAt[i] = sim.frame + 1;
            sim.events.push("crumble");
          }
        }
      }
      if (spring) {
        p.vy = -SPRING_V;
        p.grounded = false;
        p.springing = true;
        p.coyote = 0;
        sim.events.push("spring");
      } else {
        if (!wasGrounded && p.vy > G_FALL * 2) sim.events.push("land");
        p.vy = 0;
      }
      return;
    }
  } else if (p.vy < 0) {
    const r = ny >> TSHIFT;
    if (anySolid(sim, c0, c1, r, r)) {
      p.y = (r + 1) * TS;
      p.vy = 0;
      p.springing = false;
      return;
    }
  }
  p.y = ny;
}

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Spikes, the goal, and the pit. Hazard boxes are a bit smaller than the art. */
function checkTouch(sim: Sim) {
  const p = sim.p;
  if (p.y >= ROWS * TS) {
    die(sim, "pit");
    return;
  }
  const c0 = Math.max(0, p.x >> TSHIFT);
  const c1 = Math.min(COLS - 1, (p.x + PW * SUB - 1) >> TSHIFT);
  const r0 = Math.max(0, p.y >> TSHIFT);
  const r1 = Math.min(ROWS - 1, (p.y + PH * SUB - 1) >> TSHIFT);
  let won = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = sim.level.tiles[r * COLS + c];
      const tx = c * TS;
      const ty = r * TS;
      if (t === T.Spike && overlaps(p.x, p.y, PW * SUB, PH * SUB, tx + 3 * SUB, ty + 7 * SUB, 10 * SUB, 9 * SUB)) {
        die(sim, "spike");
        return;
      }
      if (t === T.Fake) sim.lastFake = sim.frame;
      if (t === T.Goal && overlaps(p.x, p.y, PW * SUB, PH * SUB, tx + 4 * SUB, ty + 2 * SUB, 8 * SUB, 14 * SUB)) {
        won = true;
      }
    }
  }
  if (won) {
    sim.status = "won";
    sim.events.push("win");
  }
}

function die(sim: Sim, cause: Cause) {
  if (cause === "pit" || cause === "spike") {
    if (sim.frame - sim.lastFake < BLAME_WINDOW) cause = "fake";
    else if (cause === "pit" && sim.frame - sim.lastCrumble < BLAME_WINDOW) cause = "crumble";
  }
  sim.status = "dead";
  sim.cause = cause;
  sim.events.push("die");
}

export function step(sim: Sim, input: number) {
  sim.events.length = 0;
  if (sim.status !== "playing") return;
  const p = sim.p;
  const left = (input & IN_LEFT) !== 0;
  const right = (input & IN_RIGHT) !== 0;
  const jump = (input & IN_JUMP) !== 0;
  const jumpPressed = jump && (sim.prevInput & IN_JUMP) === 0;
  sim.prevInput = input;

  const dir = left === right ? 0 : left ? -1 : 1;
  if (dir !== 0) {
    p.facing = dir;
    const turning = p.vx !== 0 && Math.sign(p.vx) !== dir;
    const a = p.grounded ? (turning ? TURN_GROUND : ACCEL_GROUND) : ACCEL_AIR;
    p.vx += dir * a;
    if (p.vx > MAX_RUN) p.vx = MAX_RUN;
    if (p.vx < -MAX_RUN) p.vx = -MAX_RUN;
  } else {
    const f = p.grounded ? FRICTION_GROUND : FRICTION_AIR;
    if (p.vx > 0) p.vx = Math.max(0, p.vx - f);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + f);
  }

  if (jumpPressed) p.buffer = JUMP_BUFFER;
  else if (p.buffer > 0) p.buffer--;
  if (p.grounded) p.coyote = COYOTE;
  else if (p.coyote > 0) p.coyote--;

  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_V;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    p.springing = false;
    sim.events.push("jump");
  }

  const g = p.vy < 0 && (jump || p.springing) ? G_HOLD : G_FALL;
  p.vy += g;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;

  moveX(sim);
  moveY(sim);
  sim.frame++;
  checkTouch(sim);
  if (sim.status === "playing" && sim.frame >= MAX_FRAMES) die(sim, "timeout");
}

export interface Outcome {
  status: Status;
  cause: Cause;
  frames: number;
  x: number; // px, center of player
  y: number;
}

export function outcomeOf(sim: Sim): Outcome {
  return {
    status: sim.status,
    cause: sim.cause,
    frames: sim.frame,
    x: (sim.p.x >> 8) + PW / 2,
    y: (sim.p.y >> 8) + PH / 2,
  };
}

/** Re-run a replay from scratch. Used to verify clears. */
export function runReplay(level: Level, inputs: Uint8Array): Outcome {
  const sim = createSim(level);
  for (let i = 0; i < inputs.length && sim.status === "playing"; i++) step(sim, inputs[i]);
  return outcomeOf(sim);
}
