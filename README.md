# Bounce Balls

A bouncing-ball weapon battle engine, the kind from those YouTube Shorts where balls with spinning weapons fight and get stronger with every hit.

## Play without installing anything

Download [`BounceBalls.html`](BounceBalls.html) (on GitHub: open it, then use the **Download raw file** button) and double-click it. It's a single self-contained file, and everything works offline, fonts included.

## Run it from source

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). Click anywhere once to enable sound.

On Windows, if PowerShell says running scripts is disabled, run the same commands as `npm.cmd install` and `npm.cmd run dev`, or use Command Prompt instead.

To regenerate the standalone file after making changes, run `npm run build:single`.

## How it plays

- Each ball carries a pixel-art weapon that spins around it, with a grip, gem or band in the fighter's color. A weapon touching an enemy ball deals damage.
- **Parries:** when two weapons touch, they clang, throw sparks, and both reverse their spin direction.
- **Every hit makes the attacker stronger**, and each weapon scales in its own way:

| Weapon  | Scaling |
|---------|---------|
| Sword   | +1 damage per hit |
| Dagger  | Spins faster (and slightly harder) per hit |
| Spear   | Longer reach and +0.5 damage per hit |
| Hammer  | Massive knockback; the head grows per hit |
| Scythe  | Heals itself on hit; lifesteal grows |
| Bow     | Fires volleys of arrows; +1 arrow per hit. Melee weapons can block arrows |
| Musket  | Waits until it's lined up on an enemy, then fires one heavy shot with recoil and smoke; +1 damage and a faster reload per hit. Melee weapons can deflect bullets. A faint laser sight shows where it's aiming and turns red when it's on a target |
| Spider  | Each wall bounce pins a web strand from the wall to the ball, and it stays attached as the ball moves. Enemies that touch a strand get stuck and hurt; blades and projectiles cut strands |
| Bomber  | Drops bouncing bombs that go off when an enemy gets close (or the fuse runs out). Blasts chain into other bombs and clear webs |
| Splitter | Spiky body that damages on contact. Splits in two at half HP, up to four pieces; you have to pop every piece to win |
| Unarmed | Speeds up on every wall bounce; body slams deal damage based on speed |

- **Look:** flat, Shorts-ready 9:16 canvas with a scoreboard header and a light or dark theme. Nothing but the fight is drawn on the canvas, so it records cleanly.
- **Juice:** hitstop (freeze frames), screen shake, particles, damage numbers, shockwaves, slow-mo on K.O., and synthesized sound.
- Up to 6 fighters in a free-for-all, with a square or circle arena.

## Music mode

Switch the panel to **Music**. Every bounce plays the next note (or chord) of a song, so the ball's rhythm becomes the song's rhythm.

- **Songs:** Für Elise, Ode to Joy, Canon in D and Hall of the Mountain King are built in. **Load a MIDI file** plays any `.mid` you have; drums are skipped and notes that start together play as a chord.
- **Formats:**
  - **Ring:** one ball in one ring, looping forever. Turn on **Shrink ring** to have it close in until the ball is squeezed.
  - **Escape:** break out through the gaps of 10 spinning rings; each one shatters on the way out.
  - **Grow:** the ball grows on every bounce until it fills the ring.
  - **Beat Sync:** the ball falls through slanted platforms placed ahead of time, hitting each one exactly on the song's real rhythm (planned in `src/music/sync.ts`). Best with MIDI files, which carry real timing.
    - **Ball per instrument** (on by default): each part gets its own ball, column, color and sound, e.g. melody, harmony, bass and drums. MIDI files are split by channel (up to 3 pitched parts plus drums, using each channel's General MIDI instrument to pick a lead, keys, pad or bass voice). Built-in songs are arranged in separate melody, harmony and bass parts. Each lane is mixed to its own level and panned left to right to match its column.
- Battle and music never mix: wall bounces in battles are plain thuds.

## Controls

- **Drag a ball** to grab and fling it
- **Space** to pause, **R** for a rematch
- Panel: choose fighters, arena shape, theme, gravity, ball size, simulation speed, sound, trails, and auto-rematch

## Code layout

- `src/game.ts`: simulation (fixed 240 Hz step, collisions, parries, damage, hitstop, slow-mo)
- `src/weapons.ts`: weapon classes. Each defines its hitboxes (capsules), scaling, and drawing
- `src/pixel.ts`: pixel-art sprites (character grids) and the sprite renderer
- `src/render.ts`: canvas rendering (720×1280 vertical layout, Shorts-ready)
- `src/fx.ts`: particles, floating text, rings, shake, flash
- `src/audio.ts`: Web Audio sound synthesis
- `src/music/`: music mode (`songs.ts` scores, `midi.ts` MIDI parser, `musicGame.ts` simulation, `musicRender.ts` drawing)
- `src/main.ts`: UI panel, input, and the game loop

### Adding a weapon

Draw its sprite as a character grid in `src/pixel.ts` (`c` is replaced with the fighter's color). Then subclass `Weapon` in `src/weapons.ts`, implement `capsules()` (hitboxes, matching the sprite), `onHit()` (scaling), `stats()` and `draw()`, and add it to `WEAPON_INFO` and `createWeapon()`.
