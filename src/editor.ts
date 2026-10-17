// The editor. Paint tiles, press Enter to playtest, clear it to unlock sharing.

import { pack, Reader, unpack, Writer } from "./codec";
import { isTyping, sampleInput } from "./input";
import {
  checkPlayable,
  cloneLevel,
  COLS,
  idx,
  hasPlanks,
  isMover,
  NAME_MAX,
  SIGN_MAX,
  starterLevel,
  T,
  TITLE_MAX,
  type Level,
} from "./level";
import { drawScene, tileIcon } from "./render";
import { readReplay, writeReplay } from "./replay";
import { Runner } from "./runner";
import { encodeLevelLink, linkFor, readLevel, URL_BUDGET, writeLevel } from "./share";
import { runReplay } from "./sim";
import { sfx } from "./sound";
import { Stage, startLoop } from "./stage";
import { copyButtons, fmtTime, h, maskedLink, modal, savedName, saveName, toast } from "./ui";

const TOOLS: { tile: T; name: string; key: string; tip: string }[] = [
  { tile: T.Solid, name: "Ground", key: "1", tip: "Solid. You can stand on it." },
  { tile: T.Spike, name: "Spikes", key: "2", tip: "Touch them and you die." },
  { tile: T.Spring, name: "Spring", key: "3", tip: "Launches you about seven tiles up." },
  { tile: T.Crumble, name: "Crumble", key: "4", tip: "Falls away shortly after you step on it." },
  { tile: T.Fake, name: "Fake", key: "5", tip: "Looks exactly like ground. Isn't. Only you can see the marks." },
  {
    tile: T.Platform,
    name: "Platform",
    key: "p",
    tip: "Slides side to side, turning back at anything in its way. Paint a row for a wider one. Click one to flip which way it starts.",
  },
  {
    tile: T.Lift,
    name: "Lift",
    key: "l",
    tip: "Rides up and down, turning back at anything in its way, a tile short of the ceiling. Click one to flip which way it starts.",
  },
  {
    tile: T.Bridge,
    name: "Bridge",
    key: "b",
    tip: "A thin plank that stays put. Jump up through it, stand on it, hold Down to drop through. So can any platform or lift.",
  },
  { tile: T.Sign, name: "Sign", key: "6", tip: "Says whatever you want. Lie if you like." },
  { tile: T.Start, name: "Start", key: "7", tip: "Where the horse begins. Only one." },
  { tile: T.Goal, name: "Goal", key: "8", tip: "Touch it to win." },
  { tile: T.Empty, name: "Erase", key: "0", tip: "Or right-click anywhere." },
];

const DRAFT_KEY = "horse.draft";
/** Bump when writeLevel or writeReplay change, and migrate older drafts in loadDraft. */
const DRAFT_VERSION = 2;

interface Clear {
  fp: string;
  inputs: Uint8Array;
  frames: number;
}

/** What the clear-check is about: the tiles and which way platforms start. Title, author and sign text can change freely. */
function fingerprint(l: Level): string {
  const flips = [...l.flips].filter((i) => isMover(l.tiles[i])).sort((a, b) => a - b);
  return `${l.tiles.join("")}/${flips.join(",")}`;
}

async function saveDraft(level: Level, clear: Clear | null) {
  const w = new Writer();
  w.u8(DRAFT_VERSION);
  writeLevel(w, level);
  w.u8(clear ? 1 : 0);
  if (clear) writeReplay(w, clear.inputs);
  localStorage.setItem(DRAFT_KEY, await pack(w.finish()));
}

async function loadDraft(): Promise<{ level: Level; clear: Clear | null } | null> {
  const s = localStorage.getItem(DRAFT_KEY);
  if (!s) return null;
  try {
    const r = new Reader(await unpack(s));
    const v = r.u8();
    // draft v1 predates platform directions and the Down button
    if (v !== 1 && v !== DRAFT_VERSION) throw new Error(`unknown draft version ${v}`);
    const level = readLevel(r, v === 1 ? 1 : 2);
    let clear: Clear | null = null;
    if (r.u8() === 1) {
      const inputs = readReplay(r, v === 1 ? 1 : 2);
      const out = runReplay(level, inputs);
      if (out.status === "won") clear = { fp: fingerprint(level), inputs, frames: out.frames };
    }
    return { level, clear };
  } catch {
    // Keep the unreadable draft around rather than letting the next save overwrite it.
    try {
      localStorage.setItem(`${DRAFT_KEY}.unreadable`, s);
    } catch {
      // storage full; nothing more to do
    }
    return null;
  }
}

export async function startEditor(root: HTMLElement) {
  const draft = await loadDraft();
  let level = draft?.level ?? starterLevel();
  if (!level.author) level.author = savedName();
  let clear: Clear | null = draft?.clear ?? null;
  let tool: T = T.Solid;
  let mode: "edit" | "test" = "edit";
  let hover: { c: number; r: number } | null = null;
  let painting: { erase: boolean } | null = null;
  /** The level as it was when the current stroke began, until the stroke changes something. */
  let strokeStart: Level | null = null;
  const undo: Level[] = [];
  const redo: Level[] = [];
  let runner: Runner | null = null;
  let testDeaths = 0;
  let wonAt = -1;
  let t = 0;

  // --- layout ---
  const title = h("input", {
    class: "title-input",
    placeholder: "Untitled level",
    maxlength: TITLE_MAX,
    value: level.title,
    "aria-label": "Level title",
  });
  const author = h("input", {
    class: "author-input",
    placeholder: "your name",
    maxlength: NAME_MAX,
    value: level.author,
    "aria-label": "Your name",
  });
  const status = h("div", { class: "status" });
  const stageWrap = h("div", { class: "stage-wrap" });
  const palette = h("div", { class: "palette", role: "toolbar", "aria-label": "Blocks" });
  const toolButtons = TOOLS.map((tl) => {
    const b = h(
      "button",
      { class: "tool", title: `${tl.name} (${tl.key.toUpperCase()}): ${tl.tip}`, "data-tile": tl.tile, onclick: () => pick(tl.tile) },
      tl.tile === T.Empty ? h("span", { class: "erase-icon" }, "✕") : h("img", { src: tileIcon(tl.tile), alt: "" }),
      h("span", { class: "tool-name" }, tl.name),
      h("kbd", {}, tl.key.toUpperCase()),
    );
    palette.append(b);
    return b;
  });
  const tip = h("div", { class: "tip" });
  const testBtn = h("button", { class: "btn primary", onclick: () => toggleTest() });
  const shareBtn = h("button", { class: "btn share", onclick: () => void share() });
  const undoBtn = h("button", { class: "btn ghost small", title: "Undo (Ctrl+Z)", onclick: () => doUndo() }, "Undo");
  const wipeBtn = h("button", { class: "btn ghost small", title: "Start from a blank level", onclick: () => wipe() }, "New");

  root.append(
    h(
      "section",
      { class: "editor" },
      h("div", { class: "bar" }, h("div", { class: "titles" }, title, h("span", { class: "by" }, "by"), author), status),
      stageWrap,
      h(
        "div",
        { class: "bar bottom" },
        palette,
        h("div", { class: "actions" }, undoBtn, wipeBtn, testBtn, shareBtn),
      ),
      tip,
    ),
  );
  const stage = new Stage(stageWrap);

  title.addEventListener("input", () => {
    level.title = title.value;
    persist();
  });
  author.addEventListener("input", () => {
    level.author = author.value;
    saveName(author.value);
    persist();
  });
  for (const el of [title, author])
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") el.blur();
    });

  // --- state helpers ---
  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveDraft(level, clear), 250);
  }

  /**
   * Whether the level is exactly the one you beat. Any change to the tiles
   * locks sharing until you beat it again, even if your old run would still
   * win: otherwise you could keep making it harder in ways your run happens to
   * dodge. Undoing back to the cleared layout unlocks it again.
   */
  function cleared(): boolean {
    return !!clear && fingerprint(level) === clear.fp;
  }

  function pick(tl: T) {
    tool = tl;
    sfx.click();
    refresh();
  }

  function refresh() {
    toolButtons.forEach((b, i) => b.classList.toggle("on", TOOLS[i].tile === tool));
    const tl = TOOLS.find((x) => x.tile === tool)!;
    const ok = cleared();
    if (mode === "test") {
      testBtn.innerHTML = `■ Stop <kbd>Enter</kbd>`;
      const drop = hasPlanks(level) ? ", ↓ to drop through planks" : "";
      tip.innerHTML = `Arrows/WASD to run, Space/Z/↑ to jump${drop}, <kbd>R</kbd> to restart, <kbd>Esc</kbd> to stop.`;
    } else {
      testBtn.innerHTML = `▶ Test <kbd>Enter</kbd>`;
      tip.innerHTML = `<b>${tl.name}</b> — ${tl.tip} <span class="dim">Click and drag to paint, right-click to erase.</span>`;
    }
    shareBtn.disabled = !ok;
    shareBtn.innerHTML = ok ? "Share ➜" : `<span class="lock">🔒</span> Share`;
    shareBtn.title = ok ? "Get a link to send" : "Beat your own level to unlock sharing";
    status.className = `status ${ok ? "ok" : ""}`;
    status.innerHTML = ok
      ? `<span class="dot"></span> Cleared in ${fmtTime(clear!.frames)} · ready to send`
      : clear
        ? `<span class="dot"></span> Changed since your clear · beat it again to share`
        : `<span class="dot"></span> Not cleared yet · beat it to share`;
    undoBtn.disabled = undo.length === 0;
  }

  function snapshot(prev: Level = cloneLevel(level)) {
    undo.push(prev);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }

  function doUndo() {
    const prev = undo.pop();
    if (!prev) return;
    redo.push(cloneLevel(level));
    level = { ...prev, title: level.title, author: level.author };
    persist();
    refresh();
  }

  function doRedo() {
    const next = redo.pop();
    if (!next) return;
    undo.push(cloneLevel(level));
    level = { ...next, title: level.title, author: level.author };
    persist();
    refresh();
  }

  function wipe() {
    if (!confirm("Start a new blank level? (Undo can bring this one back.)")) return;
    snapshot();
    level.tiles.fill(T.Empty);
    level.signs.clear();
    level.flips.clear();
    // keep just the floor, a start and a goal so it's immediately testable
    for (let c = 0; c < COLS; c++) level.tiles[idx(c, 17)] = T.Solid;
    level.tiles[idx(2, 16)] = T.Start;
    level.tiles[idx(29, 16)] = T.Goal;
    persist();
    refresh();
  }

  function setTile(c: number, r: number, tile: T): boolean {
    const i = idx(c, r);
    if (level.tiles[i] === tile) return false;
    if (tile === T.Start) {
      const old = level.tiles.indexOf(T.Start);
      if (old >= 0) level.tiles[old] = T.Empty;
    }
    if (level.tiles[i] === T.Sign) level.signs.delete(i);
    level.flips.delete(i);
    level.tiles[i] = tile;
    return true;
  }

  /** Reverse which way the plank through tile i starts off. A plank is a run of the same tile in a row. */
  function flipPlank(i: number) {
    const kind = level.tiles[i];
    const row = i - (i % COLS);
    let a = i;
    while (a > row && level.tiles[a - 1] === kind) a--;
    let b = i;
    while (b + 1 < row + COLS && level.tiles[b + 1] === kind) b++;
    let flipped = false;
    for (let k = a; k <= b; k++) if (level.flips.has(k)) flipped = true;
    snapshot();
    for (let k = a; k <= b; k++) {
      if (flipped) level.flips.delete(k);
      else level.flips.add(k);
    }
    sfx.click();
    persist();
    refresh();
  }

  function paintAt(c: number, r: number) {
    const tile = painting!.erase ? T.Empty : tool;
    if (setTile(c, r, tile) && strokeStart) {
      snapshot(strokeStart);
      strokeStart = null;
    }
  }

  /** `undoable`: false when the sign was just placed, so placing and writing it undo together. */
  function editSign(i: number, undoable = true) {
    const input = h("input", {
      class: "sign-input",
      maxlength: SIGN_MAX,
      value: level.signs.get(i) ?? "",
      placeholder: "don't jump",
    });
    const save = () => {
      const v = input.value.trim();
      if (undoable && v !== (level.signs.get(i) ?? "")) snapshot();
      if (v) level.signs.set(i, v);
      else level.signs.delete(i);
      persist();
      refresh();
      d.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
    const d = modal(
      "What does the sign say?",
      input,
      h("p", { class: "dim" }, `Up to ${SIGN_MAX} characters. Shown when the horse walks past.`),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: save }, "Put it up")),
    );
    input.focus();
  }

  // --- mouse ---
  const canvas = stage.canvas;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    if (mode !== "edit") return;
    const at = stage.tileAt(e);
    if (!at) return;
    e.preventDefault();
    const erase = e.button === 2 || tool === T.Empty;
    const i = idx(at.c, at.r);
    // clicking an existing sign with the sign tool edits it
    if (!erase && tool === T.Sign && level.tiles[i] === T.Sign) {
      editSign(i);
      return;
    }
    // and clicking a platform with its own tool flips which way it starts
    if (!erase && isMover(tool) && level.tiles[i] === tool) {
      flipPlank(i);
      return;
    }
    strokeStart = cloneLevel(level);
    painting = { erase };
    paintAt(at.c, at.r);
    if (!erase && tool === T.Sign) {
      painting = null;
      finishStroke();
      editSign(i, false);
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    const at = stage.tileAt(e);
    hover = at;
    if (painting && at && mode === "edit") {
      if (tool === T.Start || tool === T.Sign) return;
      paintAt(at.c, at.r);
    }
  });
  canvas.addEventListener("mouseleave", () => (hover = null));
  window.addEventListener("mouseup", () => {
    if (painting) {
      painting = null;
      finishStroke();
    }
  });

  function finishStroke() {
    // strokeStart is cleared on the first change, so it's only still set if nothing changed
    if (!strokeStart) {
      sfx.click();
      persist();
    }
    strokeStart = null;
    refresh();
  }

  // --- testing ---
  function toggleTest() {
    if (mode === "test") return stopTest();
    const p = checkPlayable(level);
    if (!p.ok) {
      toast(`${p.reason} first.`, "bad");
      return;
    }
    mode = "test";
    testDeaths = 0;
    wonAt = -1;
    const snap = cloneLevel(level);
    const fp = fingerprint(snap);
    runner = new Runner(snap, {
      onEnd(inputs, out) {
        if (out.status === "dead") testDeaths++;
        if (out.status === "won") {
          wonAt = t;
          const verify = runReplay(snap, inputs);
          if (verify.status === "won") {
            const first = !cleared();
            clear = { fp, inputs, frames: out.frames };
            persist();
            stage.banner(
              `<div class="big">Cleared!</div><div>${fmtTime(out.frames)}${first ? " · sharing unlocked" : ""}</div>`,
              "win",
            );
          }
        }
      },
    });
    stage.banner(null);
    refresh();
  }

  function stopTest() {
    mode = "edit";
    runner = null;
    stage.banner(null);
    stage.say(null);
    refresh();
  }

  // --- sharing ---
  async function share() {
    if (!cleared()) {
      toast("Beat it yourself first. That's the rule.", "bad");
      return;
    }
    const data = await encodeLevelLink({ level, clear: clear!.inputs });
    const url = linkFor("p", data);
    const name = level.title.trim();
    const intro = `I made ${name ? JSON.stringify(name) : "a level"} in HORSE. I beat it, so you can too.`;
    const text = `${intro} ${url}`;
    const box = h("textarea", { class: "link-box", readonly: true, rows: 4 }, text);
    const copyBtns = copyButtons(box, () => [text, `${intro} ${maskedLink("Play it", url)}`]);
    modal(
      "Send it to someone",
      h("p", {}, "Paste this in Discord, a group chat, wherever. When they're done they'll send their ghosts back."),
      box,
      h(
        "div",
        { class: "row" },
        ...copyBtns,
        h("a", { class: "btn ghost", href: url, target: "_blank", rel: "noopener" }, "Open as a player"),
      ),
      h(
        "p",
        { class: "dim small" },
        `${url.length} characters${url.length > URL_BUDGET ? " — that's long; some chats may cut it off" : ""}.`,
      ),
    );
  }

  // --- keys ---
  window.addEventListener("keydown", (e) => {
    if (isTyping() || document.querySelector("dialog[open]")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      toggleTest();
      return;
    }
    if (mode === "test") {
      if (e.key === "Escape") stopTest();
      if (e.code === "KeyR") {
        runner?.restart();
        stage.banner(null);
        wonAt = -1;
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      e.shiftKey ? doRedo() : doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
      e.preventDefault();
      doRedo();
      return;
    }
    const tl = TOOLS.find((x) => x.key === e.key.toLowerCase()) ?? (e.key === "e" ? TOOLS[TOOLS.length - 1] : undefined);
    if (tl) pick(tl.tile);
  });

  // --- loop ---
  startLoop(
    () => {
      t++;
      if (mode === "test" && runner) {
        runner.tick(sampleInput());
        if (wonAt >= 0 && t - wonAt > 110) stopTest();
      }
    },
    () => {
      const ctx = stage.ctx;
      if (mode === "test" && runner) {
        runner.draw(ctx);
        const s = runner.signUnderPlayer();
        stage.say(s, s === null ? "" : level.signs.get(s));
        stage.hud(`<span>TEST</span><span>${fmtTime(runner.frames)}</span><span class="deaths">✕ ${testDeaths}</span>`);
      } else {
        const hv = hover ? { ...hover, tile: tool } : null;
        drawScene(ctx, level, { editor: true, t, hover: hv });
        stage.say(null);
        stage.hud(null);
      }
      stage.present();
    },
  );

  refresh();
}
