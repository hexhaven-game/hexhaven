# Hexhaven

A cozy hex-tile strategy game built with three.js: Dorfromantik-style tile placement, Catan-like
trading and farming, light combat against bandits, and three AI opponents.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Balance check

```bash
node tools/sim.mjs 40   # plays AI-only games and reports pacing and upgrade impact
```

## Layout

- `src/game.js` – rules, economy, quests, save/load
- `src/ai.js` – opponent decisions and trading
- `src/world3d.js` – rendering (baked tiles, toon shading, water, particles, camera)
- `src/shaders.js` – water, landing marker, weather, final grade
- `src/main.js` – game loop, HUD, menus
- `src/data.js` – tiles, buildings, crops, perks and tuning values
