// Settings dialog.



import { world } from '../app.js';
import { openModal, closeModal } from '../dom.js';
import { SETTINGS_KEY, settings, writeJSON } from '../storage.js';


export function showSettings() {
  const opt = (key, val, label) => `<button class="seg ${settings[key] === val ? 'on' : ''}" data-k="${key}" data-v="${val}">${label}</button>`;
  openModal(`
    <h2>Settings</h2>
    <div class="setting"><span>Graphics</span><div class="segs">${opt('quality', 'high', 'Pretty')}${opt('quality', 'low', 'Fast')}</div></div>
    <div class="setting"><span>Opponent speed</span><div class="segs">${opt('speed', 1, 'Relaxed')}${opt('speed', 0.45, 'Brisk')}</div></div>
    <div class="setting"><span>Follow opponents with the camera</span><div class="segs">${opt('follow', true, 'On')}${opt('follow', false, 'Off')}</div></div>
    <div class="actions"><button class="primary" data-x="close">Done</button></div>`, (card) => {
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.x) return closeModal();
      const raw = b.dataset.v;
      const v = b.dataset.k === 'speed' ? Number(raw) : b.dataset.k === 'follow' ? raw === 'true' : raw;
      settings[b.dataset.k] = v;
      if (b.dataset.k === 'quality') world.setQuality(v);
      writeJSON(SETTINGS_KEY, settings);
      showSettings();
    };
  });
}
