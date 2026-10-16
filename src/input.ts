// Keyboard state, sampled once per sim step.

import { IN_JUMP, IN_LEFT, IN_RIGHT } from "./replay";

const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
const JUMP = new Set(["Space", "KeyZ", "ArrowUp", "KeyW", "KeyK"]);

const held = new Set<string>();

export function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

window.addEventListener("keydown", (e) => {
  if (isTyping()) return;
  if (LEFT.has(e.code) || RIGHT.has(e.code) || JUMP.has(e.code)) {
    held.add(e.code);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => held.delete(e.code));
window.addEventListener("blur", () => held.clear());

export function sampleInput(): number {
  let n = 0;
  for (const k of held) {
    if (LEFT.has(k)) n |= IN_LEFT;
    if (RIGHT.has(k)) n |= IN_RIGHT;
    if (JUMP.has(k)) n |= IN_JUMP;
  }
  return n;
}

export function clearInput() {
  held.clear();
}
