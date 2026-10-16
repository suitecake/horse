// Plays a level live: one sim at a time, recording inputs, respawning on death.
// Used by the editor's playtest and by a friend playing a shared level.

import { COLS, ROWS, T, TILE, type Level } from "./level";
import { Recorder } from "./replay";
import { drawScene, drawSimHorse, Particles } from "./render";
import { createSim, outcomeOf, PH, PW, step, type Outcome, type Sim } from "./sim";
import { sfx } from "./sound";
import { PAL } from "./sprites";

const DEATH_PAUSE = 28; // frames between dying and respawning

export interface RunnerEvents {
  /** An attempt ended: died, won, or was abandoned (status "playing"). */
  onEnd(inputs: Uint8Array, outcome: Outcome): void;
}

export class Runner {
  sim: Sim;
  private rec = new Recorder();
  private deadFor = 0;
  private squash = new Map<number, number>();
  readonly particles = new Particles();
  t = 0;

  constructor(
    public level: Level,
    private events: RunnerEvents,
  ) {
    this.sim = createSim(level);
  }

  get frames() {
    return this.sim.frame;
  }

  get status() {
    return this.sim.status;
  }

  /** Advance one 60Hz tick. */
  tick(input: number) {
    this.t++;
    this.particles.update();
    for (const [i, n] of this.squash) n <= 1 ? this.squash.delete(i) : this.squash.set(i, n - 1);

    if (this.sim.status === "dead") {
      if (++this.deadFor >= DEATH_PAUSE) this.respawn();
      return;
    }
    if (this.sim.status === "won") return;
    // The clock starts on the first input, not when the level appears.
    if (this.sim.frame === 0 && input === 0) return;

    this.rec.push(input);
    step(this.sim, input);
    const p = this.sim.p;
    const cx = (p.x >> 8) + PW / 2;
    const feet = (p.y >> 8) + PH;
    for (const e of this.sim.events) {
      switch (e) {
        case "jump":
          sfx.jump();
          this.particles.dust(cx, feet);
          break;
        case "land":
          sfx.land();
          this.particles.dust(cx, feet);
          break;
        case "spring": {
          sfx.spring();
          const i = Math.floor(feet / TILE) * COLS + Math.floor(cx / TILE);
          this.squash.set(i, 8);
          // the spring under either foot
          const j = Math.floor(feet / TILE) * COLS + Math.floor((p.x >> 8) / TILE);
          this.squash.set(j, 8);
          break;
        }
        case "crumble":
          sfx.crumble();
          break;
        case "die":
          sfx.die();
          this.particles.burst(cx, (p.y >> 8) + PH / 2, 26, [PAL.chestnut, PAL.cream, PAL.mane, PAL.x], 2.2);
          this.deadFor = 0;
          this.events.onEnd(this.rec.result(), outcomeOf(this.sim));
          break;
        case "win":
          sfx.win();
          this.particles.burst(cx, (p.y >> 8), 60, [PAL.butter, PAL.apricot, PAL.cream, PAL.grassLight, PAL.rose], 3, 0.06, 60);
          this.events.onEnd(this.rec.result(), outcomeOf(this.sim));
          break;
      }
    }
  }

  /** Abandon the current attempt (if it has started) and start over. */
  restart() {
    if (this.sim.status === "playing" && this.sim.frame > 0) {
      this.events.onEnd(this.rec.result(), outcomeOf(this.sim));
    }
    this.respawn();
  }

  respawn() {
    this.sim = createSim(this.level);
    this.rec = new Recorder();
    this.deadFor = 0;
    this.squash.clear();
  }

  draw(ctx: CanvasRenderingContext2D) {
    drawScene(ctx, this.level, { sim: this.sim, t: this.t, squash: new Set(this.squash.keys()) });
    if (this.sim.status !== "dead") drawSimHorse(ctx, this.sim, "player");
    this.particles.draw(ctx);
  }

  /** The sign the player is next to, if any. */
  signUnderPlayer(): number | null {
    if (this.sim.status === "dead") return null;
    const SLACK = 4;
    const x = this.sim.p.x >> 8;
    const y = this.sim.p.y >> 8;
    const c0 = Math.max(0, Math.floor((x - SLACK) / TILE));
    const c1 = Math.min(COLS - 1, Math.floor((x + PW - 1 + SLACK) / TILE));
    const r0 = Math.max(0, Math.floor(y / TILE));
    const r1 = Math.min(ROWS - 1, Math.floor((y + PH - 1) / TILE));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (this.level.tiles[r * COLS + c] === T.Sign) return r * COLS + c;
    return null;
  }
}
