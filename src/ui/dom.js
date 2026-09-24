// Small DOM helpers shared by the HUD and dialogs: query, colours, amounts, toast and the modal.


import { svg, ICON_COLOR } from './icons.js';

import { settings } from './storage.js';


export const $ = (s) => document.querySelector(s);

export const hexColor = (c) => `#${c.toString(16).padStart(6, '0')}`;

export const amount = (obj) => Object.entries(obj).filter(([, n]) => n > 0)
  .map(([r, n]) => `<span class="amt">${n}${svg(r)}</span>`).join(' ') || 'free';

// resource colours, shared with the icons (see ICON_COLOR)
export const RES_COLOR = ICON_COLOR;

export function toast(title, sub = '', ms = 2000) {
  const el = $('#toast');
  el.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  return new Promise((res) => setTimeout(() => { el.classList.remove('show'); setTimeout(res, 250); }, ms * settings.speed));
}

export let modalClose = null;

// Every dialog gets a close button top-right (unless noClose); `bind` receives the dialog body,
// which is the element dialogs redraw, so the button survives redraws.
export function openModal(html, bind, { onClose, wide, noDim, noClose } = {}) {
  const m = $('#modal');
  const card = m.querySelector('.card');
  card.innerHTML = `${noClose ? '' : `<button class="mclose" aria-label="Close" title="Close (Esc)">${svg('close')}</button>`}<div class="mbody">${html}</div>`;
  card.classList.toggle('wide', !!wide);
  m.classList.toggle('nodim', !!noDim);
  m.classList.remove('hidden');
  modalClose = onClose || null;
  const x = card.querySelector('.mclose');
  if (x) x.onclick = () => closeModal();
  bind?.(card.querySelector('.mbody'));
  $('#tooltip').style.display = 'none';
}

// silent: close without running the dialog's onClose (the dialog already handled the outcome)
export function closeModal({ silent = false } = {}) {
  $('#modal').classList.add('hidden');
  const fn = modalClose;
  modalClose = null;
  if (!silent) fn?.();
}

export const modalOpen = () => !$('#modal').classList.contains('hidden');
