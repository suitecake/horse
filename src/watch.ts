// The creator watches every attempt a friend made, all at once.

import { HEIGHT } from "./level";
import { drawDeathMark, drawScene, drawSimHorse, Particles } from "./render";
import { decodeGhostLink, type GhostLink } from "./share";
import { createSim, PH, PW, runReplay, step, type Cause, type Sim } from "./sim";
import { sfx } from "./sound";
import { PAL } from "./sprites";
import { Stage, startLoop } from "./stage";
import { esc, fmtTime, h } from "./ui";
import { brokenLink } from "./play";

interface Ghost {
  sim: Sim;
  inputs: Uint8Array;
  ended: boolean;
}

interface Mark {
  x: number;
  y: number;
  at: number;
}

const CAUSE_TEXT: Record<Exclude<Cause, null> | "quit", string> = {
  fake: "fell for a fake block",
  spike: "got spiked",
  pit: "fell in a pit",
  crumble: "rode a crumbling block down",
  timeout: "ran out the clock",
  quit: "gave up mid-run",
};

export async function startWatch(root: HTMLElement, data: string) {
  let g: GhostLink;
  try {
    g = await decodeGhostLink(data);
  } catch {
    return brokenLink(root, "These ghosts didn't make it. The link is probably cut off.");
  }
  const { level, attempts, player } = g;
  const who = player || "Someone";
  const name = level.title ? `“${level.title}”` : "your level";

  // Work out the whole story up front.
  const outcomes = attempts.map((a) => runReplay(level, a));
  const deaths = outcomes.filter((o) => o.status === "dead").length;
  const beat = g.firstClear > 0;
  // fastest clear that made it into the link, if any did
  const winFrames = outcomes.filter((o) => o.status === "won").map((o) => o.frames);
  const bestWin = winFrames.length ? Math.min(...winFrames) : -1;
  const causes = new Map<string, number>();
  for (const o of outcomes) {
    if (o.status === "won") continue;
    const k = o.status === "dead" ? (o.cause ?? "pit") : "quit";
    causes.set(k, (causes.get(k) ?? 0) + 1);
  }
  const ranked = [...causes].sort((a, b) => b[1] - a[1]);
  const longest = Math.max(1, ...attempts.map((a) => a.length));

  const headlineText =
    beat
      ? `${who} beat ${name} on attempt ${g.firstClear}.`
      : `${who} gave up on ${name} after ${g.total} attempt${g.total === 1 ? "" : "s"}.`;
  const deathCount = h("b", {}, "0");
  const stageWrap = h("div", { class: "stage-wrap" });
  const speedBtns = [1, 2, 4].map((s) =>
    h("button", { class: "btn ghost small", onclick: () => setSpeed(s) }, `${s}×`),
  );
  const replayBtn = h("button", { class: "btn primary", onclick: () => reset() }, "↺ Replay");
  const meBtn = h("button", { class: "btn ghost small", onclick: () => toggleMe() });
  const summary = h("div", { class: "summary", hidden: true });

  root.append(
    h(
      "section",
      { class: "watch" },
      h(
        "div",
        { class: "bar" },
        h("h1", { class: "headline" }, headlineText),
        h("div", { class: "counter big" }, h("span", { class: "skull" }, "✕"), deathCount, " deaths"),
      ),
      stageWrap,
      h(
        "div",
        { class: "bar bottom" },
        h("div", { class: "speed" }, h("span", { class: "dim" }, "speed"), ...speedBtns, meBtn),
        h("div", { class: "actions" }, replayBtn, h("a", { class: "btn ghost", href: "./" }, "Make another level")),
      ),
      summary,
    ),
  );
  const stage = new Stage(stageWrap);
  const particles = new Particles();

  let ghosts: Ghost[] = [];
  let me: Sim | null = null;
  let showMe = true;
  let marks: Mark[] = [];
  let frame = 0;
  let t = 0;
  let speed = attempts.length > 20 ? 2 : 1;
  let shownDeaths = 0;
  let blips = 0;
  const INTRO = 90;
  let intro = INTRO;

  function reset() {
    ghosts = attempts.map((inputs) => ({ sim: createSim(level), inputs, ended: false }));
    me = createSim(level);
    marks = [];
    frame = 0;
    shownDeaths = 0;
    deathCount.textContent = "0";
    summary.hidden = true;
    particles.clear();
    intro = INTRO;
    stage.banner(
      `<div class="big">${esc(who)}</div><div>${g.total} attempt${g.total === 1 ? "" : "s"}. here they come.</div>`,
      "intro",
    );
  }

  function setSpeed(s: number) {
    speed = s;
    speedBtns.forEach((b, i) => b.classList.toggle("on", [1, 2, 4][i] === s));
  }

  function toggleMe() {
    showMe = !showMe;
    labelMe();
  }

  function labelMe() {
    meBtn.textContent = showMe ? "hide your run" : "show your run";
  }

  function tick() {
    frame++;
    for (const gh of ghosts) {
      if (gh.ended) continue;
      const s = gh.sim;
      if (s.frame >= gh.inputs.length || s.status !== "playing") {
        gh.ended = true;
        const cx = (s.p.x >> 8) + PW / 2;
        const cy = Math.min(HEIGHT - 5, (s.p.y >> 8) + PH / 2);
        if (s.status === "won") {
          particles.burst(cx, cy, 50, [PAL.butter, PAL.apricot, PAL.cream, PAL.grassLight], 3, 0.06, 60);
          sfx.win();
        } else if (s.status === "dead") {
          // nudge each mark a little so a pile of deaths reads as a pile
          const k = marks.length;
          marks.push({ x: cx + ((k * 3) % 7) - 3, y: cy + ((k * 2) % 5) - 2, at: frame });
          particles.burst(cx, cy, 10, [PAL.ghost, PAL.x], 1.6);
          shownDeaths++;
          deathCount.textContent = String(shownDeaths);
          if (blips++ < 3) sfx.ghostDie();
        } else {
          particles.burst(cx, cy, 6, [PAL.ghost], 0.8);
        }
        continue;
      }
      step(s, gh.inputs[s.frame]);
    }
    if (me && me.status === "playing" && me.frame < g.clear.length) step(me, g.clear[me.frame]);
    particles.update();
    if (frame === longest + 60) finish();
  }

  function finish() {
    const lines = ranked.map(
      ([k, n]) => `<li><b>${n}×</b> ${CAUSE_TEXT[k as keyof typeof CAUSE_TEXT] ?? k}</li>`,
    );
    if (beat) {
      const time = bestWin < 0 ? "" : `${g.clears > 1 ? ", fastest" : ","} in ${fmtTime(bestWin)}`;
      lines.push(`<li class="win"><b>${g.clears}×</b> cleared it${time}</li>`);
    }
    const top = ranked[0];
    const verdict =
      top && top[0] === "fake" && top[1] >= 3
        ? "The fake block did its job."
        : deaths === 0
          ? "Not a single death. Make it meaner."
          : deaths >= 20
            ? "That's a lot of horses."
            : "";
    summary.innerHTML = `
      <h2>How ${esc(who)} died</h2>
      <ul>${lines.join("")}</ul>
      ${g.total > attempts.length ? `<p class="dim small">Showing ${attempts.length} of ${g.total} attempts — the rest didn't fit in the link.</p>` : ""}
      ${verdict ? `<p class="verdict">${verdict}</p>` : ""}`;
    summary.hidden = false;
    stage.banner(
      `<div class="big"><span class="num">${deaths}</span> ✕</div><div>${beat ? "and then they beat it" : "and they never beat it"}</div>`,
      beat ? "win" : "lose",
    );
  }

  reset();
  setSpeed(speed);
  labelMe();
  startLoop(
    () => {
      t++;
      blips = 0;
      if (intro > 0) {
        if (--intro === 0) stage.banner(null);
        return;
      }
      for (let i = 0; i < speed; i++) tick();
    },
    () => {
      const ctx = stage.ctx;
      drawScene(ctx, level, { t, sim: null, frame });
      for (const m of marks) drawDeathMark(ctx, m.x, m.y, frame - m.at);
      ctx.globalAlpha = 0.7;
      for (const gh of ghosts) if (!gh.ended) drawSimHorse(ctx, gh.sim, "ghost");
      ctx.globalAlpha = 1;
      if (me && showMe && me.status !== "dead") {
        ctx.globalAlpha = 0.8;
        drawSimHorse(ctx, me, "gold");
        ctx.globalAlpha = 1;
      }
      particles.draw(ctx);
      const alive = ghosts.filter((x) => !x.ended).length;
      stage.hud(`<span>${fmtTime(frame)}</span><span class="dim">${alive} running</span>`);
      stage.present();
    },
  );
}
