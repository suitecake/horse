// Tiny synthesized blips. No audio files.

let ctx: AudioContext | null = null;
let muted = localStorage.getItem("horse.muted") === "1";

export function isMuted() {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem("horse.muted", muted ? "1" : "0");
  return muted;
}

function tone(freq: number, freqEnd: number, dur: number, type: OscillatorType, vol = 0.08, delay = 0) {
  if (muted) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  jump: () => tone(320, 640, 0.12, "square", 0.05),
  spring: () => tone(220, 1100, 0.25, "triangle", 0.12),
  crumble: () => tone(140, 60, 0.18, "sawtooth", 0.04),
  land: () => tone(120, 80, 0.05, "square", 0.03),
  die: () => {
    tone(440, 110, 0.3, "square", 0.07);
    tone(220, 55, 0.35, "sawtooth", 0.04, 0.05);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.14, "square", 0.06, i * 0.09));
  },
  ghostDie: () => tone(600 + Math.random() * 300, 200, 0.08, "square", 0.015),
  click: () => tone(900, 700, 0.03, "square", 0.025),
};
