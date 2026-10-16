// A friend playing a shared level. Every attempt is kept so it can be sent
// back to the creator as ghosts.

import { fromBase64Url, toBase64Url } from "./codec";
import { clearInput, isTyping, sampleInput } from "./input";
import { NAME_MAX } from "./level";
import { drawSimHorse } from "./render";
import { Runner } from "./runner";
import { decodeLevelLink, encodeGhostLink, linkFor, URL_BUDGET } from "./share";
import { createSim, runReplay, step, type Sim } from "./sim";
import { sfx } from "./sound";
import { Stage, startLoop } from "./stage";
import { copyText, esc, fmtTime, h, modal, savedName, saveName, strHash } from "./ui";

/** Deaths before the creator's ghost becomes available to race. */
const GHOST_HINT_AFTER = 10;

export async function startPlay(root: HTMLElement, data: string) {
  let link;
  try {
    link = await decodeLevelLink(data);
  } catch {
    return brokenLink(root, "This link is broken. Maybe it got cut off when it was pasted?");
  }
  const { level, clear } = link;
  const check = runReplay(level, clear);
  if (check.status !== "won") {
    return brokenLink(
      root,
      "This level's clear doesn't check out. The creator's winning run doesn't actually win, so it might not be beatable.",
    );
  }
  const par = check.frames;
  const by = level.author || "someone";
  const name = level.title || "Untitled level";

  // Attempts survive a refresh.
  const storeKey = `horse.attempts.${strHash(data)}`;
  const attempts: Uint8Array[] = loadAttempts(storeKey);
  // won[i]: whether attempt i cleared the level. Worked out once, here and in onEnd.
  const won: boolean[] = [];
  let deaths = 0;
  let clears = 0;
  for (const a of attempts) {
    const o = runReplay(level, a);
    won.push(o.status === "won");
    if (o.status === "dead") deaths++;
    if (o.status === "won") clears++;
  }
  let raceGhost = false;
  let ghost: Sim | null = null;
  let wonAt = -1;
  let t = 0;

  const deathsEl = h("b", {}, String(deaths));
  const headline = h(
    "div",
    { class: "bar" },
    h(
      "div",
      { class: "titles" },
      h("h1", { class: "level-title" }, name),
      h("span", { class: "by" }, "by"),
      h("span", { class: "author" }, by),
    ),
    h("div", { class: "status ok" }, h("span", { class: "dot" }), `${by} beat it in ${fmtTime(par)}`),
  );
  const stageWrap = h("div", { class: "stage-wrap" });
  const sendBtn = h("button", { class: "btn primary", onclick: () => void sendGhosts() });
  const raceBtn = h("button", { class: "btn ghost", onclick: () => toggleRace() });
  const restartBtn = h("button", { class: "btn ghost", onclick: () => restart() }, "Restart ", h("kbd", {}, "R"));
  const counter = h("div", { class: "counter" }, h("span", { class: "skull" }, "✕"), deathsEl, " deaths");
  const tip = h("div", { class: "tip" });

  root.append(
    h(
      "section",
      { class: "play" },
      headline,
      stageWrap,
      h("div", { class: "bar bottom" }, counter, h("div", { class: "actions" }, restartBtn, raceBtn, sendBtn)),
      tip,
    ),
  );
  const stage = new Stage(stageWrap);

  const runner: Runner = new Runner(level, {
    onEnd(inputs, out) {
      attempts.push(inputs);
      won.push(out.status === "won");
      saveAttempts(storeKey, attempts);
      if (out.status === "dead") {
        deaths++;
        deathsEl.textContent = String(deaths);
        counter.classList.remove("bump");
        void counter.offsetWidth;
        counter.classList.add("bump");
      }
      if (out.status === "won") {
        clears++;
        wonAt = t;
        const n = attempts.length;
        stage.banner(
          `<div class="big">Cleared!</div><div>attempt ${n} · ${fmtTime(out.frames)}${
            out.frames < par ? ` · faster than ${esc(by)}` : ""
          }</div><div class="small">Press <kbd>R</kbd> to go again, or send your ghosts back.</div>`,
          "win",
        );
      }
      refresh();
    },
  });

  function restart() {
    runner.restart();
    stage.banner(null);
    wonAt = -1;
    resetGhost();
  }

  function resetGhost() {
    ghost = raceGhost ? createSim(level) : null;
  }

  function toggleRace() {
    raceGhost = !raceGhost;
    restart();
    refresh();
  }

  function refresh() {
    sendBtn.disabled = attempts.length === 0;
    sendBtn.innerHTML = clears > 0 ? "Send your ghosts back ➜" : attempts.length > 0 ? "Give up & send ghosts" : "Send ghosts";
    const raceOk = clears > 0 || deaths >= GHOST_HINT_AFTER;
    raceBtn.hidden = !raceOk;
    raceBtn.textContent = raceGhost ? `Hide ${by}'s ghost` : `Race ${by}'s ghost`;
    tip.innerHTML =
      attempts.length === 0
        ? `${esc(by)} beat this, so it can be beaten. Arrows/WASD to run, Space/Z/↑ to jump.`
        : !raceOk
          ? `Every attempt is recorded. ${esc(by)} gets to watch them all.`
          : `Every attempt is recorded. Stuck? Racing ${esc(by)}'s ghost shows you how they did it.`;
  }

  async function sendGhosts() {
    const input = h("input", { maxlength: NAME_MAX, value: savedName(), placeholder: "your name" });
    const box = h("textarea", { class: "link-box", readonly: true, rows: 4 });
    const note = h("p", { class: "dim small" });
    const copyBtn = h("button", { class: "btn primary" }, "Copy message");
    let text = "";
    let latest = 0;
    const build = async () => {
      const seq = ++latest;
      const player = input.value.trim() || "Someone";
      saveName(input.value.trim());
      const base = linkFor("g", "").length;
      const { data: g, kept } = await encodeGhostLink({ level, clear, player, attempts }, won, URL_BUDGET - base - 120);
      // a later keystroke started its own build; let that one win
      if (seq !== latest) return;
      const url = linkFor("g", g);
      const verdict =
        clears > 0
          ? `beat ${JSON.stringify(name)} on attempt ${won.indexOf(true) + 1}`
          : `gave up on ${JSON.stringify(name)}`;
      text = `${player} ${verdict}. ${"✕".repeat(Math.min(deaths, 12))}${deaths > 12 ? `+${deaths - 12}` : ""} Watch every death: ${url}`;
      box.value = text;
      note.textContent =
        kept < attempts.length
          ? `Your ${attempts.length} attempts don't all fit in one message, so this sends ${kept}: your clears first, then the most recent.`
          : `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}, ${deaths} death${deaths === 1 ? "" : "s"}.`;
    };
    input.addEventListener("input", () => void build());
    copyBtn.addEventListener("click", async () => {
      if (await copyText(text, box)) {
        copyBtn.textContent = "Copied ✓";
        sfx.click();
      }
    });
    await build();
    modal(
      clears > 0 ? "Send your ghosts back" : "Admit defeat",
      h("p", {}, `Paste this where ${by} will see it. They'll watch all your attempts at once.`),
      h("label", { class: "field" }, h("span", {}, "Who are you?"), input),
      box,
      note,
      h("div", { class: "row" }, copyBtn),
    );
  }

  window.addEventListener("keydown", (e) => {
    if (isTyping() || document.querySelector("dialog[open]")) return;
    if (e.code === "KeyR") restart();
  });
  clearInput();

  startLoop(
    () => {
      t++;
      const before = runner.frames;
      runner.tick(sampleInput());
      if (ghost) {
        // the ghost restarts whenever you do
        if (before > 0 && runner.frames === 0) resetGhost();
        else if (ghost.frame < clear.length && ghost.status === "playing" && runner.status === "playing")
          step(ghost, clear[ghost.frame]);
      }
      if (wonAt >= 0 && t - wonAt > 600) stage.banner(null);
    },
    () => {
      const ctx = stage.ctx;
      runner.draw(ctx);
      if (ghost && ghost.status !== "dead") {
        ctx.globalAlpha = 0.55;
        drawSimHorse(ctx, ghost, "gold");
        ctx.globalAlpha = 1;
      }
      const s = runner.signUnderPlayer();
      stage.say(s, s === null ? "" : level.signs.get(s));
      stage.hud(`<span>${fmtTime(runner.frames)}</span><span class="dim">par ${fmtTime(par)}</span>`);
      stage.present();
    },
  );
  refresh();
}


function loadAttempts(key: string): Uint8Array[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
    return raw.map(fromBase64Url);
  } catch {
    return [];
  }
}

function saveAttempts(key: string, attempts: Uint8Array[]) {
  try {
    localStorage.setItem(key, JSON.stringify(attempts.map(toBase64Url)));
  } catch {
    // storage full: attempts still live in memory for this session
  }
}

export function brokenLink(root: HTMLElement, msg: string) {
  root.append(
    h(
      "section",
      { class: "broken" },
      h("h1", {}, "Hmm."),
      h("p", {}, msg),
      h("a", { class: "btn primary", href: "./" }, "Make your own level instead"),
    ),
  );
}
