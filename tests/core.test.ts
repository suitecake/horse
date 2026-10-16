import { describe, expect, it } from "vitest";
import { COLS, idx, ROWS, starterLevel, T, emptyLevel } from "../src/level";
import { createSim, runReplay, step } from "../src/sim";
import { IN_JUMP, IN_LEFT, IN_RIGHT, MAX_FRAMES, writeReplay } from "../src/replay";
import { deflate, inflate, pack, Writer } from "../src/codec";
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
    writeLevel(w, flat());
    writeReplay(w, Uint8Array.from(hold(IN_LEFT, 10)));
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
    writeLevel(w, level);
    writeReplay(w, win);
    w.str("pal");
    w.varint(3);
    w.varint(3);
    for (const a of [lose, win, win]) writeReplay(w, a);
    const back = await decodeGhostLink(await pack(w.finish()));
    expect(back.firstClear).toBe(2);
    expect(back.clears).toBe(2);
    expect(back.total).toBe(3);
  });

  it("caps how far data inflates", async () => {
    const big = await deflate(new Uint8Array(4 << 20));
    await expect(inflate(big)).rejects.toThrow("too large");
    expect((await inflate(await deflate(new Uint8Array(1000)))).length).toBe(1000);
  });
});
