// Pixel art, drawn as text. Each character is a palette key; "." is clear.

export const PAL = {
  ink: "#1b1424",
  night: "#241a35",
  plum: "#4a2d5a",
  mauve: "#7d4470",
  rose: "#c4606a",
  apricot: "#f2a65a",
  butter: "#ffd56b",
  cream: "#fbecc8",
  bone: "#e9dfcb",
  stone: "#9b8f9c",
  dirt: "#8a4b38",
  dirtDark: "#5e2f2e",
  dirtSpeck: "#a8613f",
  grass: "#7fb04a",
  grassLight: "#c2df6b",
  grassDark: "#4d7a3a",
  sand: "#d9a066",
  sandDark: "#a0663e",
  wood: "#b0703c",
  woodDark: "#6e3d24",
  red: "#e0474c",
  redDark: "#8c2638",
  chestnut: "#c06a3a",
  chestnutDark: "#87422a",
  mane: "#3a2236",
  ghost: "#f4eefc",
  gold: "#ffd56b",
  x: "#ff4d6d",
} as const;

const KEYS: Record<string, string> = {
  k: PAL.ink,
  b: PAL.chestnut,
  d: PAL.chestnutDark,
  m: PAL.mane,
  c: PAL.cream,
  w: PAL.bone,
  s: PAL.stone,
  r: PAL.red,
  R: PAL.redDark,
  y: PAL.butter,
  a: PAL.apricot,
  o: PAL.wood,
  O: PAL.woodDark,
  n: PAL.sand,
  N: PAL.sandDark,
  g: PAL.grass,
  G: PAL.grassLight,
  e: PAL.ink,
  p: PAL.plum,
};

export type Art = string[];

export function sprite(art: Art, keys: Record<string, string> = KEYS): HTMLCanvasElement {
  const h = art.length;
  const w = art[0].length;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = art[y][x];
      if (ch === "." || ch === " ") continue;
      ctx.fillStyle = keys[ch] ?? "#ff00ff";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** A one-colour copy of a sprite, for ghosts. */
export function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function flipped(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

// The horse. 16x16, facing right. Hitbox is the bottom-centre 10x12.
const HORSE_TOP = [
  "................",
  "...........k.k..",
  "..........kmkmk.",
  ".........kmmbbk.",
  "........kmmbbebk",
  "........kmbbbbck",
  ".......kmmbbkcck",
  "..kk..kmmbbk.kk.",
  ".kmmkkkbbbbk....",
  ".kmkbbbbbbbbk...",
  "..kbbbbbbbbbk...",
  "..kdbbbbbbbdk...",
];

export const HORSE_ART: Record<string, Art> = {
  stand: [
    ...HORSE_TOP,
    "..kdkkkkkkkdk...",
    "...dk.dk.dk.dk..",
    "...dk.dk.dk.dk..",
    "...kk.kk.kk.kk..",
  ],
  run1: [
    ...HORSE_TOP,
    "..kdkkkkkkkdk...",
    "..dk..dk..dk.dk.",
    ".dk...dk...dk.dk",
    ".kk...kk...kk.kk",
  ],
  run2: [
    ...HORSE_TOP,
    "..kdkkkkkkkdk...",
    "...dkdk...dkdk..",
    "....dkk....dkk..",
    "....kk.....kk...",
  ],
  jump: [
    ...HORSE_TOP,
    ".kdkkkkkkkkdk...",
    "kdk.......kdk.dk",
    "kk.........kdk.k",
    "............kk..",
  ],
};

export const TILE_ART: Record<string, Art> = {
  spike: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...k.......k....",
    "..kwk.....kwk...",
    "..kwk.....kwk...",
    ".kwwsk...kwwsk..",
    ".kwwsk...kwwsk..",
    "kwwwssk.kwwwssk.",
    "kwwwssk.kwwwssk.",
    "kwwwwssksswwwssk",
    "kkkkkkkkkkkkkkkk",
    "kssssssssssssssk",
  ],
  spring: [
    "................",
    "................",
    "................",
    "................",
    "................",
    ".kkkkkkkkkkkkkk.",
    "kyyyyyyyyyyyyyyk",
    "kaaaaaaaaaaaaaak",
    ".kkkkkkkkkkkkkk.",
    "...kwwwwwwwwk...",
    "....ksssssk.....",
    "...kwwwwwwwwk...",
    "....ksssssk.....",
    ".kkkkkkkkkkkkkk.",
    "kRrrrrrrrrrrrrRk",
    "kRRRRRRRRRRRRRRk",
  ],
  springSquash: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".kkkkkkkkkkkkkk.",
    "kyyyyyyyyyyyyyyk",
    "kaaaaaaaaaaaaaak",
    ".kkkkkkkkkkkkkk.",
    "...kwwwwwwwwk...",
    ".kkkkkkkkkkkkkk.",
    "kRrrrrrrrrrrrrRk",
    "kRRRRRRRRRRRRRRk",
  ],
  crumble: [
    "kkkkkkkkkkkkkkkk",
    "knnnnnnknnnnnnnk",
    "knnnnnnNknnnnnNk",
    "knnwnnnNknnnnnNk",
    "knnnnnNNknnwnnNk",
    "kNNnnnNkkkknnnNk",
    "kkkkNNkknnnkNNNk",
    "knnnkkknnnnnkkkk",
    "knnnnNknnnnnnnNk",
    "knwnnNknnnwnnnNk",
    "knnnNkkknnnnnNNk",
    "kkNNkknnkkNNNkkk",
    "knnkknnnnnkknnnk",
    "knnnNknnnnnNknNk",
    "kNNNNkNNNNNNkNNk",
    "kkkkkkkkkkkkkkkk",
  ],
  goal: [
    "..kk............",
    ".kwwkkkkkkk.....",
    ".kwkyyyyyyykk...",
    ".kwkyyyyyyyyyyk.",
    ".kwkyyrryyyyyk..",
    ".kwkyyrrryyyk...",
    ".kwkaaaaaaak....",
    ".kwkkkkkkkk.....",
    ".kwk............",
    ".kwk............",
    ".kwk............",
    ".kwk............",
    ".kwk............",
    ".kwk............",
    "kkwkk...........",
    "kswsk...........",
  ],
  sign: [
    "................",
    "................",
    "kkkkkkkkkkkkkkkk",
    "koooooooooooooOk",
    "kockkkcokkckkoOk",
    "koooooooooooooOk",
    "kockkcokkkkckoOk",
    "koooooooooooooOk",
    "kOOOOOOOOOOOOOOk",
    "kkkkkkkOOkkkkkkk",
    "......kOOk......",
    "......kOOk......",
    "......kOOk......",
    "......kOOk......",
    ".....kkOOkk.....",
    "....kOOOOOOk....",
  ],
  start: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....kkkkkkkk....",
    "...kssssssssk...",
    "...kskk..kksk...",
    "...ksk....ksk...",
    "...kwk....kwk...",
    "...kkk....kkk...",
  ],
};
