// Small DOM helpers.

import { sfx } from "./sound";

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function toast(msg: string, kind: "info" | "bad" = "info") {
  const el = h("div", { class: `toast ${kind}` }, msg);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

export async function copyText(text: string, fallback?: HTMLInputElement | HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      fallback.focus();
      fallback.select();
    }
    return false;
  }
}

/**
 * Discord markdown link: chat shows `label`, the full URL stays underneath.
 * Discord still unfurls it into the og: card from index.html, which is what
 * tells a friend what HORSE is, so don't wrap the URL in <> to suppress it.
 * Other chat apps don't render this, so it's offered alongside the plain text.
 */
export function maskedLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

/**
 * "Copy message" and "Copy for Discord" buttons. `texts` returns the current
 * [plain, discord] messages; whichever is copied is shown in `box`.
 */
export function copyButtons(box: HTMLTextAreaElement, texts: () => [string, string]): HTMLButtonElement[] {
  const labels = ["Copy message", "Copy for Discord"];
  const btns = labels.map((label, i) =>
    h(
      "button",
      {
        class: i === 0 ? "btn primary" : "btn",
        onclick: async () => {
          const text = texts()[i];
          box.value = text;
          if (await copyText(text, box)) {
            btns.forEach((b, j) => (b.textContent = j === i ? "Copied ✓" : labels[j]));
            sfx.click();
          }
        },
      },
      label,
    ),
  );
  return btns;
}

/** A modal built on <dialog>. Returns the dialog so callers can close it. */
export function modal(title: string, ...body: Child[]): HTMLDialogElement {
  const d = h(
    "dialog",
    { class: "modal" },
    h("button", { class: "close", "aria-label": "Close", onclick: () => d.close() }, "×"),
    h("h2", {}, title),
    ...body,
  );
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

export function fmtTime(frames: number): string {
  const s = frames / 60;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(2).padStart(5, "0");
  return m > 0 ? `${m}:${rest}` : `${(s).toFixed(2)}s`;
}

/** Stable short hash of a string, for localStorage keys. */
export function strHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function savedName(): string {
  return localStorage.getItem("horse.name") ?? "";
}

export function saveName(n: string) {
  localStorage.setItem("horse.name", n);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
