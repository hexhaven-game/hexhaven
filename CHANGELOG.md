# Changelog

All notable changes to Hexhaven. The game reads this file too: the version in the main menu opens it.

## 0.4 — 24-09-2026

### New
- Timeline: every round of the game as a strip in the status bar, coloured by season, with markers for what's coming (your crops ripening, harvest fairs, bandit risk at each new season, year 2, the last round). Hover a round for details, click for a full "What's coming" list. On phones, tap the round number.
- Every dialog has a close button in the top-right corner.

### Improved
- Desktop status bar is compact: season icon, year, timeline, round and your actions. Longer explanations show on hover.
- On medium-sized screens the status bar sits next to the player cards, with the timeline as a second row, so it never runs under the resources.
- One icon style everywhere: trade, market and order dialogs use the same coloured resource icons as the top bar, and seasons have their own icons.
- Scouted finds that sit next to each other join into one sand bank instead of separate islets.
- Phones: the turn banner is one small line, and an opponent's turn is shown once, at the bottom.
- The code is split into core rules, rendering and UI modules, so the game is easier to extend.

## 0.3.1 — 24-09-2026

### Improved
- Haven orders explain themselves: the card shows how much you already have of each good, and tapping an order (or the ?) tells you what orders are, where to get the goods and what they pay.
- Phones: the player scores sit in the status bar, so the top of the screen is two rows instead of three; tap the scores to see the full player list.

## 0.3 — 24-09-2026

### Improved
- The open sea stays calm: only spots where you can place (your colour) or scout (yellow) are drawn and clickable, so tapping empty water does nothing.
- Slot outlines sit on the hex edge, so neighbouring spots share one line instead of two.
- Haven orders live in one small labelled card with what Haven wants and what it pays; on phones it only shows up when you can deliver.
- The pause button on desktop is a small round button lined up with the resource bar.
- The title island no longer shows the Haven label, and the swell rings on the water are softer.

### Fixed
- White hex outlines from the title island's landing effect no longer stay behind in the sea after starting or loading a game.

## 0.2 — 24-09-2026

### New
- Haven: a walled market town of seven hexes in the middle of the map, with a keep, six districts and an outer wall.
- Tile goals: some tiles come with a flag asking you to grow that area; finishing one gives prosperity and a bonus tile.
- Workshop perks (Cart, Seed store, Surveyor, Watchtower, Guild seal, Map room) and a second level for every building.
- Economy overview: what you have, what you earn each round, where it comes from and what your crops will bring in.
- Synergy preview: while holding a tile you see which neighbours support it and what it would earn.
- Unclaimed finds you scouted show up as small islets in the sea, clearly marked as nobody's.
- Badges on tiles for guards, buildings, crops, ruins and perks.
- Save slots, autosave, continue, settings and a changelog in the main menu.

### Improved
- Playable on phones: tap a spot to preview, tap again (or "Place here") to place, drag the map with one finger, pinch to zoom and turn.
- Phone layout: compact top bar, icon-first resources, small player badges, thumb-reach buttons and dialogs that slide up from the bottom.
- Cleaner HUD on desktop: slim player cards (tap one to see its resources), the turn hint lives in the status bar, readable order chips.
- The island sits in a turquoise sea again, with beaches that grow along with each tile as the world is built.
- Open sea slots are thin outlines; only spots where you can place (your colour) or scout (yellow) are filled.
- The title screen shows a calm, anonymous island without names or badges.
- Loading a game flows straight from the menu camera into play, without flashes or jumps.
- The camera follows opponents calmly and never jolts when a new turn starts mid-flight.
- Opponents play at a relaxed pace so you can follow what they do.
- The tile menu is a ring of buttons around the tile and closes by itself after an action.
- Full-map games stay smooth: tile updates, harvest labels and log lines are spread over frames.

### Fixed
- The turn banner no longer flickers while hovering, and tells you why a spot can't be used.
- The points preview no longer jumps between neighbouring spots.
- Opponent trade offers no longer darken the screen.
- Haven's wall and towers no longer flicker.
- Ruins and mills no longer overlap mountain peaks, field rows or buildings on the same tile.

## 0.1 — 24-09-2026

### New
- First playable version: place hex tiles, farm, build, trade with three AI towns, fight bandits and race to the most prosperity.
