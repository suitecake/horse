# HORSE

Build a pixel-art platformer level, beat it yourself, then send it to a friend and watch every one of their deaths.

Like the playground game: you have to make the shot before anyone else has to match it. Sharing stays locked until you clear your own level, and the link carries your winning run so the game can check it. Your friend's attempts come back as ghosts, all replayed at once.

## How it works

- **Edit** (`/`): paint tiles, press Enter to playtest. Clearing it unlocks Share. Drafts save to localStorage.
- **Play** (`/#p=…`): a friend plays the level. Every attempt is recorded and survives a refresh. When they're done (or give up) they get a "send your ghosts back" message to paste.
- **Watch** (`/#g=…`): the creator watches every attempt replay at once, with a breakdown of how they died.

There's no backend. Levels and ghosts are deflated and base64url-encoded into the URL hash. Ghost links trim themselves (keeping clears and the newest attempts) to fit in a 2000-character Discord message. A typical level link is ~150 characters; 80 attempts fit in about 1000.

### Determinism

`src/sim.ts` is integer-only physics on a fixed 60Hz step (positions in 1/256 px), so a replay is just one input byte per frame and plays back identically everywhere. Replays are run-length encoded. The creator's clear is re-simulated on load, so a level link with a faked clear is rejected.

Keep `sim.ts` free of floats, `Math.random`, and wall-clock time.

## Blocks

Ground, Spikes, Spring, Crumble (falls 24 frames after you step on it), Fake (looks exactly like ground, isn't), Platform, Lift, Sign, Start, Goal.

Platforms slide side to side and Lifts ride up and down. Both travel through empty space and turn around at anything else (fake blocks included, so they never give one away), and a run of them side by side is one wide plank. They're one-way: jump up through them, land on top, get carried. They never push you, so nothing gets crushed; if a wall or ceiling stops you, the plank slides out from under you. Lifts stop a tile short of a ceiling so there's always room to ride. Where a platform is depends only on the frame number, so every ghost shares the same platforms.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: physics, codec, share links
npm run build      # typecheck + production build into dist/
```

`/sprites.html` (dev server only) shows every sprite at 8×. Sprites are text grids in `src/sprites.ts`.

This project runs Claude Code in a sandboxed dev container. See [.devcontainer/README.md](.devcontainer/README.md) for setup.
