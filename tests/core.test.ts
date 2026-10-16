import { describe, expect, it } from "vitest";
import { COLS, idx, ROWS, starterLevel, T, emptyLevel } from "../src/level";
import { IN_JUMP, IN_RIGHT } from "../src/replay";
import { createSim, runReplay, step } from "../src/sim";
import { decodeGhostLink, decodeLevelLink, encodeGhostLink, encodeLevelLink } from "../src/share";

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
    const g = { level, clear: win, player: "pal", attempts, total: attempts.length };
    const { data, kept } = await encodeGhostLink(g, 1500);
    expect(data.length).toBeLessThanOrEqual(1500);
    expect(kept).toBeLessThan(attempts.length);
    const back = await decodeGhostLink(data);
    expect(back.total).toBe(201);
    expect(back.attempts.some((a) => a.length === win.length && a.every((x, i) => x === win[i]))).toBe(true);
    expect(back.attempts.at(-1)).toEqual(attempts.at(-1));
  });
});
