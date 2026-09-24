// The shared objects every UI module works with: the game state, the 3D world, and hooks back
// into the game loop in main.js (so dialogs can ask for a redraw without importing main.js).
import { Game } from '../core/game.js';
import { World3D } from '../render/world3d.js';

export const game = new Game();
export const world = new World3D(document.querySelector('#scene'), game);
export const human = () => game.players.find((p) => !p.isAI);

// filled in by main.js
export const hooks = {
  render: () => {},
  refreshHighlights: () => {},
  doAction: () => {},
};
