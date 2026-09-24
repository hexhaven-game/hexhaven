# Hexhaven

**A cozy hex-tile strategy game in your browser.** Place hexagonal landscape tiles, farm crops,
trade with rival towns, clear out bandit camps and grow the most valuable haven — against three AI
opponents. Built with three.js: no backend, no install.

[![Deploy to GitHub Pages](https://github.com/hexhaven-game/hexhaven/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/hexhaven-game/hexhaven/actions/workflows/deploy-pages.yml)

**▶ Play now: <https://hexhaven-game.github.io/hexhaven/>**

![Hexhaven in play: hexagon landscape tiles on the board, rival towns and the tile hand](https://hexhaven-game.github.io/hexhaven/og-image.png)

## What is Hexhaven?

Hexhaven is a single-player hex-grid strategy game for the web. Each round you draw a handful of
landscape tiles and place them on an expanding hexagon map, Dorfromantik-style: matching terrain
next to matching terrain scores, and every tile you place changes what the next one is worth. On
top of that puzzle sits a light economy — crops, buildings, resources and a market where three
rival towns trade with you — plus small tactical fights against the bandits that spawn at the
edges of the map.

A game runs for a fixed number of rounds and ends with a score, so a session fits in a coffee break
or an evening. Progress is saved automatically in the browser, so you can close the tab and pick it
up later.

## Features

- **Hex tile placement** with terrain matching, adjacency bonuses and synergy scoring
- **Farming and production** — crops, buildings and resource chains that pay out each round
- **Trading** with three AI towns, each with its own personality and prices
- **Light combat** against bandit camps, so expansion is never free
- **Quests and orders** from the Haven that turn resources into gold
- **Three AI opponents** that place tiles, trade and expand on their own
- **Save and load** with three manual slots plus autosave, stored in `localStorage`
- **Runs anywhere** — desktop and mobile browsers, WebGL, no account needed

## How to play

| Action | Key |
| --- | --- |
| Pick a tile from your hand | `1` `2` `3` |
| Place the selected tile | click a highlighted hex |
| End turn | `E` |
| Open the market | `M` |
| Trade with a town | `T` |
| Economy overview | `I` |
| Menu / pause | `Esc` |

The in-game **How to play** panel repeats these, and tile tooltips explain what each tile is worth
before you place it.

## Tech stack

- **three.js** for the 3D diorama: baked tiles, toon shading, water, particles and camera work
- **Vite** for the dev server and production builds
- **Vanilla JavaScript** ES modules — no UI framework, three.js is the only runtime dependency
- **GitHub Actions + GitHub Pages** for continuous deployment

## Development

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # production build in dist/
npm run preview  # serve the production build on http://localhost:5181
```

### Balance check

`tools/sim.mjs` plays AI-only games and reports pacing, scoring and upgrade impact — handy after
tuning numbers in `src/core/data.js`:

```bash
node tools/sim.mjs 40   # 40 simulated games
```

## Project layout

The code is split in three layers. `core/` knows nothing about the browser, so the simulator can
run it headless; `render/` draws the state; `ui/` is everything made of HTML.

| Path | Contents |
| --- | --- |
| `src/main.js` | entry point: game loop, turn flow, input, HUD rendering, menus |
| `src/core/data.js` | tiles, buildings, crops, perks and tuning values |
| `src/core/game.js` | game state, setup, save/load and the round flow |
| `src/core/systems/` | the rules, one file per part: `economy`, `placement`, `actions`, `quests`, `combat` |
| `src/core/ai.js` | opponent decisions and trading |
| `src/core/hex.js` | hex grid maths |
| `src/render/world3d.js` | the 3D world: tiles, sea and coast, camera, picking, frame loop |
| `src/render/builders.js` | procedural tile dioramas (one builder per terrain) |
| `src/render/materials.js` | shared toon material, season/sway shader patch, geometry cache |
| `src/render/sprites.js` | canvas textures: labels, badges, floating harvest text |
| `src/render/effects.js` | particles and bloom |
| `src/render/shaders.js` | water, landing marker, weather and final grade shaders |
| `src/ui/app.js` | the shared `game` and `world`, plus hooks back into the loop |
| `src/ui/dom.js` | DOM helpers: toast, modal, amounts |
| `src/ui/storage.js` | settings and save slots |
| `src/ui/changelog.js` | the in-game changelog |
| `src/ui/dialogs/` | one file per dialog: market, trade, economy, orders, help, settings |
| `src/ui/icons.js` | inline SVG icon set and icon colours |
| `src/style.css` | HUD and menu styling |
| `tools/sim.mjs` | headless AI balance simulator |
| `public/` | static files served as-is: `robots.txt`, `sitemap.xml`, `llms.txt`, icons |

Adding a rule usually means adding values to `core/data.js` and a method to the matching file in
`core/systems/` (methods there are mixed into `Game`, so they are called as `game.method()`).
A new dialog is a new file in `ui/dialogs/` that uses `openModal` from `ui/dom.js`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). The game reads the same file: click the version number in the
main menu to open it.

## Deployment

Every push to `main` builds the game with Vite and publishes `dist/` to GitHub Pages through
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). The site is served from
a subpath, so the build uses `--base=/hexhaven/` and goes live on
<https://hexhaven-game.github.io/hexhaven/>. Other branches are not deployed; run `npm run build`
locally to check a change before pushing.

## Credits

Made by [Jelle Siderius](https://github.com/jellesiderius). Fonts: Fredoka and Nunito from Google
Fonts (OFL). Built on [three.js](https://threejs.org/).
