// Settings and save slots in localStorage.
import { SEASONS } from '../core/data.js';


import { game } from './app.js';


export const SETTINGS_KEY = 'hexhaven-settings';

export const settings = { quality: 'high', speed: 1, follow: true, ...readJSON(SETTINGS_KEY) };

export const saveKey = (slot) => `hexhaven-save-${slot}`;

export function readJSON(k, store = localStorage) {
  try { return JSON.parse(store.getItem(k)) || null; } catch { return null; }
}

export function writeJSON(k, v, store = localStorage) {
  try { store.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
}

export const readSave = (slot) => readJSON(saveKey(slot));

export const writeSave = (slot) => writeJSON(saveKey(slot), game.serialize());

export function deleteSave(slot) {
  try { localStorage.removeItem(saveKey(slot)); } catch { /* storage unavailable */ }
}

export function saveMeta(d) {
  if (!d) return null;
  const r = Math.max(1, d.round);
  const season = SEASONS[Math.floor((r - 1) / 3) % 4];
  const year = Math.floor((r - 1) / 12) + 1;
  const ago = Math.round((Date.now() - d.savedAt) / 60000);
  const when = ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : new Date(d.savedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `Year ${year}, ${season.name.toLowerCase()} · ${when}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * settings.speed));
