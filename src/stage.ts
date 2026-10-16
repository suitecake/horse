// The game screen: a low-res buffer scaled up by whole numbers into a display
// canvas, with an HTML layer on top for text (signs, banners).

import { COLS, HEIGHT, ROWS, TILE, WIDTH } from "./level";

export class Stage {
  readonly el: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  readonly buf: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private display: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private bubble: HTMLDivElement;
  private bubbleKey = -1;
  scale = 1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "stage";
    this.display = document.createElement("canvas");
    this.display.className = "screen";
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.bubble = document.createElement("div");
    this.bubble.className = "bubble";
    this.bubble.hidden = true;
    this.overlay.append(this.bubble);
    this.el.append(this.display, this.overlay);
    parent.append(this.el);
    this.buf = document.createElement("canvas");
    this.buf.width = WIDTH;
    this.buf.height = HEIGHT;
    this.ctx = this.buf.getContext("2d")!;
    this.dctx = this.display.getContext("2d")!;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(parent);
    this.resize();
  }

  private resize() {
    const parent = this.el.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const availW = parent.clientWidth * dpr;
    const availH = Math.max(window.innerHeight * 0.72, 300) * dpr;
    const s = Math.max(1, Math.floor(Math.min(availW / WIDTH, availH / HEIGHT)));
    this.scale = s;
    this.display.width = WIDTH * s;
    this.display.height = HEIGHT * s;
    const cssW = (WIDTH * s) / dpr;
    const cssH = (HEIGHT * s) / dpr;
    this.el.style.width = `${cssW}px`;
    this.el.style.height = `${cssH}px`;
    this.el.style.setProperty("--px", `${s / dpr}px`);
    this.dctx.imageSmoothingEnabled = false;
  }

  present() {
    this.dctx.imageSmoothingEnabled = false;
    this.dctx.drawImage(this.buf, 0, 0, this.display.width, this.display.height);
  }

  /** Tile under a mouse event, or null if outside. */
  tileAt(e: MouseEvent): { c: number; r: number } | null {
    const rect = this.display.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return { c, r };
  }

  get canvas() {
    return this.display;
  }

  /** Show a speech bubble above a tile, or hide it with null. */
  say(tileIndex: number | null, text = "") {
    if (tileIndex === null || !text) {
      this.bubble.hidden = true;
      this.bubbleKey = -1;
      return;
    }
    if (this.bubbleKey === tileIndex && !this.bubble.hidden) return;
    this.bubbleKey = tileIndex;
    const c = tileIndex % COLS;
    const r = Math.floor(tileIndex / COLS);
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    const x = ((c * TILE + TILE / 2) / WIDTH) * 100;
    const y = ((r * TILE) / HEIGHT) * 100;
    this.bubble.style.left = `${Math.min(88, Math.max(12, x))}%`;
    this.bubble.style.top = `${y}%`;
    this.bubble.classList.toggle("below", r < 4);
    if (r < 4) this.bubble.style.top = `${(((r + 1) * TILE) / HEIGHT) * 100}%`;
  }

  /** A small heads-up line in the top-left corner. Cheap to call every frame. */
  hud(html: string | null) {
    if (html === this.hudHtml) return;
    this.hudHtml = html;
    let el = this.overlay.querySelector<HTMLDivElement>(".hud");
    if (!html) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "hud";
      this.overlay.append(el);
    }
    el.innerHTML = html;
  }
  private hudHtml: string | null = null;

  /** A big centred message over the game. */
  banner(html: string | null, cls = "") {
    let b = this.overlay.querySelector<HTMLDivElement>(".banner");
    if (!html) {
      b?.remove();
      return;
    }
    if (!b) {
      b = document.createElement("div");
      this.overlay.append(b);
    }
    b.className = `banner ${cls}`;
    b.innerHTML = html;
  }
}

/** Fixed 60Hz loop. `step` runs zero or more times per animation frame. */
export function startLoop(step: () => void, draw: () => void): () => void {
  const DT = 1000 / 60;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let running = true;
  const frame = (now: number) => {
    if (!running) return;
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= DT) {
      step();
      acc -= DT;
    }
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}
