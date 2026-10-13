# Bounce Balls

A bouncing-ball weapon battle engine, the kind from those YouTube Shorts where balls with spinning weapons fight and get stronger with every hit.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). Click anywhere once to enable sound.

## How it plays

- Each ball carries a weapon that spins around it. A weapon touching an enemy ball deals damage.
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
| Unarmed | Speeds up on every wall bounce; body slams deal damage based on speed |

- **Juice:** hitstop (freeze frames), screen shake, particles, damage numbers, shockwaves, slow-mo on K.O., and synthesized sound (wall bounces play a pentatonic melody).
- Up to 6 fighters in a free-for-all, with a square or circle arena.

## Controls

- **Drag a ball** to grab and fling it
- **Space** to pause, **R** for a rematch
- Panel: choose fighters, arena shape, gravity, simulation speed, sound, trails, and auto-rematch

## Code layout

- `src/game.ts`: simulation (fixed 240 Hz step, collisions, parries, damage, hitstop, slow-mo)
- `src/weapons.ts`: weapon classes. Each defines its hitboxes (capsules), scaling, and drawing
- `src/render.ts`: canvas rendering (720×1280 vertical layout, Shorts-ready)
- `src/fx.ts`: particles, floating text, rings, shake, flash
- `src/audio.ts`: Web Audio sound synthesis
- `src/main.ts`: UI panel, input, and the game loop

### Adding a weapon

Subclass `Weapon` in `src/weapons.ts`, implement `capsules()` (hitboxes), `onHit()` (scaling), `stats()` and `draw()`, then add it to `WEAPON_INFO` and `createWeapon()`.
