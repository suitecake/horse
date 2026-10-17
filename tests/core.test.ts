import { describe, expect, it } from "vitest";
import { COLS, idx, ROWS, starterLevel, T, emptyLevel } from "../src/level";
import { createSim, platformsOf, platPos, PH, runReplay, step } from "../src/sim";
import { IN_DOWN, IN_JUMP, IN_LEFT, IN_RIGHT, MAX_FRAMES, readReplay, writeReplay } from "../src/replay";
import { deflate, inflate, pack, Reader, Writer } from "../src/codec";
import {
  decodeGhostLink,
  decodeLevelLink,
  encodeGhostLink,
  encodeLevelLink,
  MAX_GHOST_FRAMES,
  writeLevel,
} from "../src/share";

function flat(): ReturnType<typeof emptyLevel> {
  const l = emptyLevel();
  for (let c = 0; c < COLS; c++) l.tiles[idx(c, ROWS - 1)] = T.Solid;
  l.tiles[idx(2, ROWS - 2)] = T.Start;
  return l;
}

function hold(input: number, frames: number): number[] {
  return Array(frames).fill(input);
}

describe("sim", () => {
  it("lands on the floor and stands still", () => {
    const sim = createSim(flat());
    for (let i = 0; i < 120; i++) step(sim, 0);
    expect(sim.status).toBe("playing");
    expect(sim.p.grounded).toBe(true);
    expect(sim.p.y % 256).toBe(0);
  });

  it("dies on spikes", () => {
    const l = flat();
    l.tiles[idx(6, ROWS - 2)] = T.Spike;
    const out = runReplay(l, Uint8Array.from(hold(IN_RIGHT, 120)));
    expect(out.status).toBe("dead");
    expect(out.cause).toBe("spike");
  });

  it("falls through fake blocks into the pit", () => {
    const l = flat();
    for (let c = 5; c < 9; c++) l.tiles[idx(c, ROWS - 1)] = T.Fake;
    const out = runReplay(l, Uint8Array.from(hold(IN_RIGHT, 200)));
    expect(out.status).toBe("dead");
    expect(out.cause).toBe("fake");
  });

  it("crumbling blocks drop you after a moment", () => {
    const l = flat();
    l.tiles[idx(2, ROWS - 1)] = T.Crumble;
    const out = runReplay(l, Uint8Array.from(hold(0, 200)));
    expect(out.status).toBe("dead");
    expect(out.cause).toBe("crumble");
  });

  it("jumps a single spike and reaches the goal", () => {
    const l = flat();
    l.tiles[idx(6, ROWS - 2)] = T.Spike;
    l.tiles[idx(12, ROWS - 2)] = T.Goal;
    const inputs = [...hold(IN_RIGHT, 30), ...hold(IN_RIGHT | IN_JUMP, 20), ...hold(IN_RIGHT, 100)];
    const out = runReplay(l, Uint8Array.from(inputs));
    expect(out.status).toBe("won");
  });

  it("springs launch higher than a jump", () => {
    const peak = (spring: boolean) => {
      const l = flat();
      if (spring) l.tiles[idx(2, ROWS - 1)] = T.Spring;
      const sim = createSim(l);
      const y0 = sim.p.y;
      let minY = Infinity;
      for (let i = 0; i < 90; i++) {
        step(sim, spring ? 0 : i > 10 ? IN_JUMP : 0);
        minY = Math.min(minY, sim.p.y);
      }
      return (y0 - minY) / 256 / 16;
    };
    expect(peak(false)).toBeGreaterThan(2);
    expect(peak(false)).toBeLessThan(3);
    expect(peak(true)).toBeGreaterThan(5);
  });

  it("the starter level is beatable", () => {
    // A known winning run, as [buttons, frames] pairs. If physics tuning breaks
    // this, re-check that the starter level is still clearable.
    const runs = [[0,32],[4,27],[0,15],[2,21],[3,15],[4,23],[2,26],[6,29],[2,57],[4,29],[0,23],[2,12],[6,10],[2,14],[4,17],[3,4],[2,9]];
    const inputs = Uint8Array.from(runs.flatMap(([b, n]) => hold(b, n)));
    expect(runReplay(starterLevel(), inputs).status).toBe("won");
  });

  it("is deterministic", () => {
    const l = starterLevel();
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const inputs = Uint8Array.from({ length: 2000 }, () => (rand() >> 16) % 8);
    expect(runReplay(l, inputs)).toEqual(runReplay(l, inputs));
  });
});

describe("moving platforms", () => {
  const TS = 16 * 256;

  /** A floorless level: a start on a ledge at the left, the pit everywhere else. */
  function ledge(): ReturnType<typeof emptyLevel> {
    const l = emptyLevel();
    for (let c = 0; c < 3; c++) l.tiles[idx(c, 12)] = T.Solid;
    l.tiles[idx(1, 11)] = T.Start;
    return l;
  }

  it("turns around at anything in the way, fakes included", () => {
    const l = emptyLevel();
    l.tiles[idx(4, 5)] = T.Solid;
    l.tiles[idx(6, 5)] = T.Platform;
    l.tiles[idx(7, 5)] = T.Platform;
    l.tiles[idx(12, 5)] = T.Fake;
    const [pl] = platformsOf(l);
    expect(platformsOf(l).length).toBe(1);
    expect(pl.w).toBe(2 * TS);
    expect(pl.lo).toBe(5 * TS);
    expect(pl.hi).toBe(10 * TS);
    const xs = Array.from({ length: 400 }, (_, f) => platPos(pl, f).x);
    expect(Math.min(...xs)).toBe(5 * TS);
    expect(Math.max(...xs)).toBe(10 * TS);
    expect(xs[1]).toBeGreaterThan(xs[0]); // heads right first
  });

  it("lifts stop a tile short of the ceiling", () => {
    const l = emptyLevel();
    l.tiles[idx(5, 2)] = T.Solid;
    l.tiles[idx(5, 10)] = T.Lift;
    l.tiles[idx(5, 14)] = T.Spike;
    const [pl] = platformsOf(l);
    expect(pl.lo).toBe(4 * TS);
    expect(pl.hi).toBe(14 * TS - 6 * 256);
    expect(platPos(pl, 1).y).toBeLessThan(platPos(pl, 0).y); // heads up first
  });

  it("carries you across a pit", () => {
    const l = ledge();
    l.tiles[idx(1, 11)] = T.Empty;
    l.tiles[idx(3, 11)] = T.Start; // standing on the platform
    for (let c = 3; c < 5; c++) l.tiles[idx(c, 12)] = T.Platform;
    for (let c = 28; c < 32; c++) l.tiles[idx(c, 12)] = T.Solid;
    l.tiles[idx(30, 11)] = T.Goal;
    // ride it to the far side, then walk off
    const sim = createSim(l);
    const inputs = [...hold(0, 345), ...hold(IN_RIGHT, 100)];
    let rode = false;
    for (const i of inputs) {
      step(sim, i);
      if (sim.p.ride >= 0) rode = true;
    }
    expect(rode).toBe(true);
    expect(sim.status).toBe("won");
  });

  it("lets you jump up through from below and land on top", () => {
    const l = flat();
    l.tiles[idx(1, ROWS - 3)] = T.Platform;
    l.tiles[idx(2, ROWS - 3)] = T.Platform;
    l.tiles[idx(3, ROWS - 3)] = T.Platform;
    l.tiles[idx(0, ROWS - 3)] = T.Solid;
    l.tiles[idx(4, ROWS - 3)] = T.Solid; // pin it in place
    const sim = createSim(l);
    for (let i = 0; i < 20; i++) step(sim, 0);
    for (let i = 0; i < 60; i++) step(sim, IN_JUMP);
    expect(sim.p.grounded).toBe(true);
    expect(sim.p.ride).toBe(0);
    expect(sim.p.y + PH * 256).toBe((ROWS - 3) * TS);
  });

  it("rides a lift up to a tile short of the ceiling", () => {
    const l = flat();
    l.tiles[idx(2, ROWS - 2)] = T.Empty;
    l.tiles[idx(2, ROWS - 3)] = T.Start; // standing on the lift
    l.tiles[idx(2, ROWS - 2)] = T.Lift;
    l.tiles[idx(2, 4)] = T.Solid;
    const sim = createSim(l);
    let minY = Infinity;
    for (let i = 0; i < 400; i++) {
      step(sim, 0);
      minY = Math.min(minY, sim.p.y);
      expect(sim.p.ride).toBe(0);
    }
    expect(sim.status).toBe("playing");
    expect(minY + PH * 256).toBe(6 * TS);
  });

  it("a rising lift catches you mid-air", () => {
    // you start in mid-air above a lift, which rises to meet you
    const l = flat();
    for (let c = 1; c < 4; c++) l.tiles[idx(c, ROWS - 2)] = T.Lift;
    l.tiles[idx(2, ROWS - 2)] = T.Lift;
    l.tiles[idx(2, ROWS - 4)] = T.Start;
    for (let c = 0; c < 5; c++) if (c < 1 || c > 3) l.tiles[idx(c, ROWS - 4)] = T.Solid;
    const sim = createSim(l);
    expect(sim.plats.length).toBe(1);
    let caught = -1;
    for (let i = 0; i < 120 && caught < 0; i++) {
      step(sim, 0);
      if (sim.p.ride >= 0) caught = i;
    }
    expect(caught).toBeGreaterThan(0);
    const y = sim.p.y;
    for (let i = 0; i < 30; i++) step(sim, 0);
    expect(sim.p.ride).toBe(0);
    expect(sim.p.y).toBe(y - 30 * 256);
  });

  it("slides out from under you when a wall stops you", () => {
    const l = ledge();
    l.tiles[idx(3, 12)] = T.Platform;
    for (let r = 0; r < 12; r++) l.tiles[idx(8, r)] = T.Solid; // a wall above the platform's path
    const out = runReplay(l, Uint8Array.from([...hold(IN_RIGHT, 22), ...hold(0, 400)]));
    expect(out.status).toBe("dead");
    expect(out.cause).toBe("pit");
  });

  it("doesn't move until the clock starts, and is deterministic", () => {
    const l = ledge();
    l.tiles[idx(4, 12)] = T.Platform;
    l.tiles[idx(6, 8)] = T.Lift;
    let seed = 5;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const inputs = Uint8Array.from({ length: 3000 }, () => (rand() >> 16) % 8);
    expect(runReplay(l, inputs)).toEqual(runReplay(l, inputs));
    const [pl] = createSim(l).plats;
    expect(platPos(pl, 0)).toEqual({ x: pl.x, y: pl.y });
  });

  it("can be flipped to start off the other way", () => {
    const l = emptyLevel();
    l.tiles[idx(6, 5)] = T.Platform;
    l.tiles[idx(7, 5)] = T.Platform;
    l.tiles[idx(12, 9)] = T.Lift;
    const [a, b] = platformsOf(l);
    expect(platPos(a, 1).x).toBeGreaterThan(platPos(a, 0).x);
    expect(platPos(b, 1).y).toBeLessThan(platPos(b, 0).y);
    // any tile of a plank flips the whole plank
    l.flips.add(idx(7, 5));
    l.flips.add(idx(12, 9));
    const [fa, fb] = platformsOf(l);
    expect(platPos(fa, 1).x).toBeLessThan(platPos(fa, 0).x);
    expect(platPos(fb, 1).y).toBeGreaterThan(platPos(fb, 0).y);
    // same loop, just started from the other end
    const xs = Array.from({ length: 2000 }, (_, f) => platPos(fa, f).x);
    expect(Math.min(...xs)).toBe(fa.lo);
    expect(Math.max(...xs)).toBe(fa.hi);
  });

  it("bridges hold you up, let you jump through, and drop you on Down", () => {
    const l = flat();
    for (let c = 0; c < 6; c++) l.tiles[idx(c, ROWS - 3)] = T.Bridge;
    const sim = createSim(l);
    expect(sim.plats.length).toBe(1);
    const onFloor = (ROWS - 1) * TS - PH * 256;
    const onBridge = (ROWS - 3) * TS - PH * 256;
    for (let i = 0; i < 20; i++) step(sim, 0);
    expect(sim.p.y).toBe(onFloor); // started under it
    for (let i = 0; i < 60; i++) step(sim, IN_JUMP);
    expect(sim.p.y).toBe(onBridge);
    expect(sim.p.grounded).toBe(true);
    for (let i = 0; i < 60; i++) step(sim, 0);
    expect(sim.p.y).toBe(onBridge); // stays put
    for (let i = 0; i < 4; i++) step(sim, IN_DOWN);
    for (let i = 0; i < 60; i++) step(sim, 0);
    expect(sim.p.y).toBe(onFloor);
  });

  it("holding Down drops you off a moving platform too", () => {
    const l = ledge();
    l.tiles[idx(1, 11)] = T.Empty;
    l.tiles[idx(3, 11)] = T.Start;
    for (let c = 3; c < 5; c++) l.tiles[idx(c, 12)] = T.Platform;
    const ride = runReplay(l, Uint8Array.from(hold(0, 200)));
    expect(ride.status).toBe("playing");
    const drop = runReplay(l, Uint8Array.from([...hold(0, 100), ...hold(IN_DOWN, 100)]));
    expect(drop.status).toBe("dead");
    expect(drop.cause).toBe("pit");
  });

  it("round-trips through a level link, directions and all", async () => {
    const level = ledge();
    level.tiles[idx(4, 12)] = T.Platform;
    level.tiles[idx(6, 8)] = T.Lift;
    level.flips.add(idx(6, 8));
    level.flips.add(idx(20, 3)); // not a platform: dropped
    const back = await decodeLevelLink(await encodeLevelLink({ level, clear: Uint8Array.from(hold(IN_RIGHT, 10)) }));
    expect(back.level.tiles).toEqual(level.tiles);
    expect([...back.level.flips]).toEqual([idx(6, 8)]);
  });
});

describe("share links", () => {
  it("round-trips a level link", async () => {
    const level = starterLevel();
    level.title = "trust me";
    level.author = "suitecake";
    const clear = Uint8Array.from([...hold(IN_RIGHT, 40), ...hold(IN_JUMP | IN_RIGHT, 12), ...hold(0, 5)]);
    const data = await encodeLevelLink({ level, clear });
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(data.length).toBeLessThan(400);
    const back = await decodeLevelLink(data);
    expect(back.level.tiles).toEqual(level.tiles);
    expect(back.level.signs).toEqual(level.signs);
    expect(back.level.title).toBe("trust me");
    expect(back.clear).toEqual(clear);
  });

  it("trims ghost links to fit the budget, keeping clears", async () => {
    const level = flat();
    level.tiles[idx(12, ROWS - 2)] = T.Goal;
    level.tiles[idx(8, ROWS - 1)] = T.Fake;
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const attempts = Array.from({ length: 200 }, () =>
      Uint8Array.from({ length: 60 + ((rand() >> 16) % 200) }, () => (rand() >> 16) % 8),
    );
    const tries = Array.from({ length: 60 }, (_, k) =>
      Uint8Array.from([...hold(IN_RIGHT, k), ...hold(IN_RIGHT | IN_JUMP, 16), ...hold(IN_RIGHT, 80)]),
    );
    const win = tries.find((t) => runReplay(level, t).status === "won")!;
    expect(win).toBeDefined();
    attempts.splice(3, 0, win);
    const won = attempts.map((a) => runReplay(level, a).status === "won");
    const g = { level, clear: win, player: "pal", attempts };
    const { data, kept } = await encodeGhostLink(g, won, 1500);
    expect(data.length).toBeLessThanOrEqual(1500);
    expect(kept).toBeLessThan(attempts.length);
    const back = await decodeGhostLink(data);
    expect(back.total).toBe(201);
    expect(back.firstClear).toBe(won.indexOf(true) + 1);
    expect(back.clears).toBe(won.filter(Boolean).length);
    expect(back.attempts.length).toBe(kept);
    expect(back.attempts.some((a) => a.length === win.length && a.every((x, i) => x === win[i]))).toBe(true);
    expect(back.attempts.at(-1)).toEqual(attempts.at(-1));
  });

  it("keeps the real attempt number of the first clear when trimming", async () => {
    const level = flat();
    level.tiles[idx(12, ROWS - 2)] = T.Goal;
    const win = Uint8Array.from(hold(IN_RIGHT, 200));
    expect(runReplay(level, win).status).toBe("won");
    let seed = 3;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    // left-ish noise never reaches the goal
    const junk = () => Uint8Array.from({ length: 300 }, () => ((rand() >> 16) % 8) & ~IN_RIGHT);
    const attempts = [...Array.from({ length: 40 }, junk), win, ...Array.from({ length: 100 }, junk)];
    const won = attempts.map((a) => runReplay(level, a).status === "won");
    const { data } = await encodeGhostLink({ level, clear: win, player: "pal", attempts }, won, 1200);
    const back = await decodeGhostLink(data);
    expect(back.attempts.length).toBeLessThan(attempts.length);
    expect(back.firstClear).toBe(41);
    expect(back.clears).toBe(1);
  });

  it("drops clears too when the clears alone don't fit", async () => {
    const level = flat();
    level.tiles[idx(30, ROWS - 2)] = T.Goal;
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    // long, noisy, all-winning runs: hold right, sprinkle in jumps and lefts
    const attempts = Array.from({ length: 80 }, () =>
      Uint8Array.from({ length: 600 }, () => IN_RIGHT | ((rand() >> 16) % 3 === 0 ? IN_JUMP : 0)),
    );
    const won = attempts.map((a) => runReplay(level, a).status === "won");
    expect(won.filter(Boolean).length).toBeGreaterThan(20);
    const { data, kept } = await encodeGhostLink({ level, clear: attempts[0], player: "pal", attempts }, won, 1000);
    expect(data.length).toBeLessThanOrEqual(1000);
    expect(kept).toBeGreaterThan(0);
    const back = await decodeGhostLink(data);
    expect(back.attempts.length).toBe(kept);
    expect(back.clears).toBe(won.filter(Boolean).length);
    // the first clear is the first thing kept
    const first = attempts[won.indexOf(true)];
    expect(back.attempts.some((a) => a.length === first.length && a.every((x, i) => x === first[i]))).toBe(true);
  });

  it("refuses ghost links with too many frames", async () => {
    const w = new Writer();
    w.u8(2);
    writeLevel(w, flat(), 1);
    writeReplay(w, Uint8Array.from(hold(IN_LEFT, 10)), 1);
    w.str("evil");
    w.varint(5000);
    w.varint(0);
    w.varint(0);
    w.varint(5000);
    for (let k = 0; k < 5000; k++) {
      w.varint(1);
      w.varint(MAX_FRAMES * 8);
    }
    expect(5000 * MAX_FRAMES).toBeGreaterThan(MAX_GHOST_FRAMES);
    const data = await pack(w.finish());
    expect(data.length).toBeLessThan(2000);
    await expect(decodeGhostLink(data)).rejects.toThrow("too many frames");
  });

  it("still reads v1 ghost links", async () => {
    const level = flat();
    level.tiles[idx(12, ROWS - 2)] = T.Goal;
    const win = Uint8Array.from(hold(IN_RIGHT, 200));
    const lose = Uint8Array.from(hold(IN_LEFT, 50));
    const w = new Writer();
    w.u8(1);
    writeLevel(w, level, 1);
    writeReplay(w, win, 1);
    w.str("pal");
    w.varint(3);
    w.varint(3);
    for (const a of [lose, win, win]) writeReplay(w, a, 1);
    const back = await decodeGhostLink(await pack(w.finish()));
    expect(back.firstClear).toBe(2);
    expect(back.clears).toBe(2);
    expect(back.total).toBe(3);
  });

  it("still reads v1 level links", async () => {
    const level = starterLevel();
    const clear = Uint8Array.from(hold(IN_RIGHT, 40));
    const w = new Writer();
    w.u8(1);
    writeLevel(w, level, 1);
    writeReplay(w, clear, 1);
    const back = await decodeLevelLink(await pack(w.finish()));
    expect(back.level.tiles).toEqual(level.tiles);
    expect(back.level.signs).toEqual(level.signs);
    expect(back.level.flips.size).toBe(0);
    expect(back.clear).toEqual(clear);
  });

  it("still reads v2 ghost links", async () => {
    const level = flat();
    level.tiles[idx(12, ROWS - 2)] = T.Goal;
    const win = Uint8Array.from(hold(IN_RIGHT, 200));
    const w = new Writer();
    w.u8(2);
    writeLevel(w, level, 1);
    writeReplay(w, win, 1);
    w.str("pal");
    w.varint(1);
    w.varint(1);
    w.varint(1);
    w.varint(1);
    writeReplay(w, win, 1);
    const back = await decodeGhostLink(await pack(w.finish()));
    expect(back.level.tiles).toEqual(level.tiles);
    expect(back.firstClear).toBe(1);
    expect(back.attempts).toEqual([win]);
  });

  it("only spends the extra replay bit when Down is used", () => {
    const enc = (inputs: Uint8Array, format?: number) => {
      const w = new Writer();
      writeReplay(w, inputs, format);
      return w.finish();
    };
    const plain = Uint8Array.from([...hold(IN_RIGHT, 40), ...hold(IN_RIGHT | IN_JUMP, 12), ...hold(0, 300)]);
    expect(enc(plain).length).toBe(enc(plain, 1).length);
    expect(readReplay(new Reader(enc(plain)))).toEqual(plain);
    const down = Uint8Array.from([...plain, ...hold(IN_DOWN, 20), ...hold(IN_DOWN | IN_LEFT | IN_JUMP, 7)]);
    expect(readReplay(new Reader(enc(down)))).toEqual(down);
    // format 1 has no room for Down
    expect(readReplay(new Reader(enc(down, 1)), 1).every((x) => (x & IN_DOWN) === 0)).toBe(true);
  });

  it("round-trips a bridge level with a clear that uses Down", async () => {
    const level = flat();
    for (let c = 0; c < 6; c++) level.tiles[idx(c, ROWS - 3)] = T.Bridge;
    const clear = Uint8Array.from([...hold(IN_JUMP, 30), ...hold(IN_DOWN, 10), ...hold(IN_RIGHT, 50)]);
    const back = await decodeLevelLink(await encodeLevelLink({ level, clear }));
    expect(back.level.tiles).toEqual(level.tiles);
    expect(back.clear).toEqual(clear);
  });

  it("caps how far data inflates", async () => {
    const big = await deflate(new Uint8Array(4 << 20));
    await expect(inflate(big)).rejects.toThrow("too large");
    expect((await inflate(await deflate(new Uint8Array(1000)))).length).toBe(1000);
  });
});
