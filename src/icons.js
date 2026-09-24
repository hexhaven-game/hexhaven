// Hand-made 24x24 glyphs used in both the DOM (SVG) and the 3D markers (canvas Path2D).
export const ICONS = {
  wood: 'M4 9h13a3 3 0 0 1 0 6H4a3 3 0 0 1 0-6zM17 10.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8z',
  stone: 'M5 16l2-7 5-3 6 3 2 7-4 3H9z',
  grain: 'M11 21h2V11h-2zM12 3c2 2 2 4 0 6c-2-2-2-4 0-6zM7.5 7c2.5.5 3.5 2.5 3.5 5c-2.5-.5-3.5-2.5-3.5-5zM16.5 7c-2.5.5-3.5 2.5-3.5 5c2.5-.5 3.5-2.5 3.5-5z',
  veg: 'M5 20c1-5 5-10 9.5-11.5l1.5 1.5C14.5 14.5 9.5 18.5 5 20zM15 8c-.2-2.6.8-4.2 3-5c.2 2.1-.6 3.6-2.2 4.6zM16 9c1.8-1.3 3.7-1.6 5.5-.6c-1.6 1.3-3.4 1.6-5 1.3z',
  wool: 'M7 17a3 3 0 0 1-1-5.8A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 6 3.2A3 3 0 0 1 17 17z',
  gold: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 6.3a5.7 5.7 0 1 1 0 11.4a5.7 5.7 0 1 1 0-11.4zM12 8.2a3.8 3.8 0 1 0 0 7.6a3.8 3.8 0 1 0 0-7.6z',
  workshop: 'M3 8h12a4 4 0 0 0 4-4h2v3a5 5 0 0 1-5 5h-1v3h2v4H7v-4h2v-3H7a4 4 0 0 1-4-4z',
  tile: 'M12 2l8.66 5v10L12 22l-8.66-5V7zM12 4.3l-6.66 3.85v7.7L12 19.7l6.66-3.85v-7.7z',
  crown: 'M3.5 18h17l1-10.5-5.5 4.5-4-6.5-4 6.5-5.5-4.5z',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10c-4-2-7-5-7-10V6z',
  house: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  menu: 'M4 7h16v2H4zM4 11h16v2H4zM4 15h16v2H4z',
  flag: 'M6 3h2v18H6zM8 4h11l-3 4 3 4H8z',
  market: 'M3 9l2-5h14l2 5zM5 10.5h14V20h-4v-6H9v6H5z',
  trade: 'M4 7h11.2l-2.6-2.6L14 3l5 5-5 5-1.4-1.4 2.6-2.6H4zM20 17H8.8l2.6 2.6L10 21l-5-5 5-5 1.4 1.4L8.8 15H20z',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4.5 3 5.6V19h8v-3.4c1.7-1.1 3-3.1 3-5.6a7 7 0 0 0-7-7zM9 9.5a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM15 9.5a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z',
  ruins: 'M4 20h16v-2H4zM6.5 17h2.2V9H6.5zM10.9 17h2.2V9h-2.2zM15.3 17h2.2v-5h-2.2zM4 8h16V5.5H4z',
  mill: 'M10 21l1-10h2l1 10zM11.3 2.5h1.4v15h-1.4zM4.5 9.3h15v1.4h-15z',
  treasure: 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4zM4 12.5h16V19H4zM11 11h2v3.5h-2z',
  compass: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14zM15.5 8.5l-2 5-5 2 2-5z',
  sword: 'M18 3h3v3L10.5 16.5l-3-3zM5.5 13.5l5 5-1.4 1.4-1.6-1.6-2.8 2.8-1.4-1.4 2.8-2.8-1.6-1.6z',
  plant: 'M11 21v-8h2v8zM12 13.5c-4 0-6-2.2-6-6.5c4 0 6 2.2 6 6.5zM12 12c0-4.2 2-6.5 6-6.5c0 4.2-2 6.5-6 6.5z',
  hammer: 'M3 19.5l9-9 2 2-9 9zM10.5 6.5l4.5-3.5 6 6-3.5 4.5-2-2-2 2-3-3 2-2z',
  next: 'M5 11h10.2l-3.6-3.6L13 6l6 6-6 6-1.4-1.4 3.6-3.6H5z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
};

export function svg(name, cls = 'ic') {
  const d = ICONS[name];
  if (!d) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
}

export const EMOJI_TO_ICON = {
  '🪵': 'wood', '🪨': 'stone', '🌾': 'grain', '🥕': 'veg', '🐑': 'wool', '🪙': 'gold', '⭐': 'crown',
  '☠️': 'skull', '🏛️': 'ruins', '🏚️': 'mill', '💰': 'treasure', '🛡️': 'shield', '🧭': 'compass',
  '⚔️': 'sword', '🌱': 'plant', '🔨': 'hammer', '🏡': 'house', '📜': 'flag', '🏪': 'market', '🤝': 'trade', '🧺': 'grain', '🚩': 'flag',
};

// Replace the emoji shorthand used in game messages with our own glyphs; drop any other emoji.
export function iconify(text) {
  let out = String(text);
  for (const [e, name] of Object.entries(EMOJI_TO_ICON)) out = out.split(e).join(svg(name));
  return out.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export function drawIcon(ctx, name, x, y, size, color) {
  const p = new Path2D(ICONS[name]);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(p, 'evenodd');
  ctx.restore();
}
