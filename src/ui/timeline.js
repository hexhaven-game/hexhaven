// What's coming: a strip of all rounds under the status bar (desktop) and a list of upcoming
// events (a dialog on desktop, a bottom sheet on phones). Everything here is derived from the
// game state, so it never needs saving.
import { SEASONS, ROUNDS_PER_SEASON, ROUNDS_PER_YEAR, WIN_GOAL } from '../core/data.js';
import { svg } from './icons.js';
import { game, human } from './app.js';
import { $, openModal, closeModal } from './dom.js';

const seasonOf = (r) => Math.floor((r - 1) / ROUNDS_PER_SEASON) % 4;
const WINTER = 3;

// the round in which a crop with `left` growth steps is harvested (winter rounds don't count)
function readyRound(left) {
  let r = game.round;
  let n = left;
  while (r <= game.lastRound) {
    if (seasonOf(r) !== WINTER) n--;
    if (n <= 0) return r;
    r++;
  }
  return null;
}

// Events per round, from the current round to the end: [{ icon, title, desc, mine }]
export function upcoming() {
  const me = human();
  const out = new Map();
  const add = (r, e) => { if (r >= game.round && r <= game.lastRound) (out.get(r) || out.set(r, []).get(r)).push(e); };

  for (let r = game.round; r <= game.lastRound; r++) {
    const S = SEASONS[seasonOf(r)];
    if ((r - 1) % ROUNDS_PER_SEASON === 0 && r > 1) {
      add(r, { icon: S.icon, title: `${S.name} begins`, desc: S.desc });
      const y2 = r > ROUNDS_PER_YEAR;
      add(r, { icon: 'skull', title: 'Bandits may show up', desc: `${y2 ? 'Very likely' : 'Even odds'}: a new bandit camp can appear. Guards keep your land safe.` });
    }
    if (r === ROUNDS_PER_YEAR + 1) add(r, { icon: 'flag', title: 'Year 2', desc: 'Haven orders get bigger and pay more prosperity.' });
    if (r % ROUNDS_PER_YEAR === 0) {
      add(r, {
        icon: 'crown', title: 'Harvest fair',
        desc: `Most Haven orders this year wins +10 prosperity, runner-up +5. You filled ${me.delivered || 0}.`,
      });
    }
  }

  // your crops, grouped per round
  const byRound = new Map();
  for (const c of game.economy(me.id).crops) {
    const r = readyRound(c.left);
    if (r == null) continue;
    const g = byRound.get(r) || byRound.set(r, {}).get(r);
    g[c.name] = (g[c.name] || 0) + 1;
  }
  for (const [r, g] of byRound) {
    const list = Object.entries(g).map(([name, n]) => `${n} × ${name.toLowerCase()}`).join(', ');
    add(r, { icon: 'plant', title: 'Your crops are ready', desc: `${list}, harvested at the end of the round.`, mine: true });
  }

  add(game.lastRound, { icon: 'flag', title: 'Last round', desc: `Most prosperity wins. The game also ends as soon as someone reaches ${WIN_GOAL}.` });
  return out;
}

// the marker shown in the strip for a round: the most important event wins
const PRIORITY = ['plant', 'crown', 'flag', 'skull'];
const markerOf = (events) => PRIORITY.find((i) => events.some((e) => e.icon === i));

// the strip is one element that lives inside the status bar on desktop; the status bar rebuilds
// its HTML, so we keep a reference and put the strip back into its slot each time
const el = $('#timeline');
export function mountTimeline(slot) {
  if (slot && el.parentNode !== slot) slot.appendChild(el);
}

let sig = '';
export function renderTimeline() {
  const me = human();
  const ev = upcoming();
  const key = `${game.round}|${game.phase}|${me.delivered}|${[...ev].map(([r, l]) => `${r}:${l.map((e) => e.icon + e.desc).join()}`).join(';')}`;
  if (key === sig) return;
  sig = key;
  let cells = '';
  let marks = '';
  for (let r = 1; r <= game.lastRound; r++) {
    const s = seasonOf(r);
    const cls = r < game.round ? 'past' : r === game.round ? 'now' : '';
    const year = r === ROUNDS_PER_YEAR + 1 ? ' y2' : '';
    cells += `<i class="c s${s} ${cls}${year}" data-r="${r}"></i>`;
    const m = ev.has(r) ? markerOf(ev.get(r)) : null;
    marks += `<span class="m${year}" data-r="${r}">${m ? svg(m) : ''}</span>`;
  }
  el.innerHTML = `<button class="tl" data-act="timeline" aria-label="What's coming">
      <div class="tl-marks">${marks}</div><div class="tl-cells">${cells}</div>
    </button><div class="tl-pop"></div>`;
}

// hover a round in the strip: a small card with what happens then
export function bindTimeline() {
  el.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-r]');
    const pop = el.querySelector('.tl-pop');
    if (!t || !pop) return;
    const r = Number(t.dataset.r);
    if (pop.dataset.r === String(r)) return;
    pop.dataset.r = r;
    const S = SEASONS[seasonOf(r)];
    const list = upcoming().get(r) || [];
    const when = r < game.round ? 'done' : r === game.round ? 'now' : `in ${r - game.round} round${r - game.round === 1 ? '' : 's'}`;
    pop.innerHTML = `<div class="tp-h">${svg(S.icon)}<b>Round ${r}</b><span>${S.name} · ${when}</span></div>
      ${list.map((e) => `<div class="tp-e">${svg(e.icon)}<span>${e.title}</span></div>`).join('')}`;
    const box = el.getBoundingClientRect();
    const tb = t.getBoundingClientRect();
    pop.style.left = `${tb.left + tb.width / 2 - box.left}px`;
    pop.classList.add('show');
  });
  el.addEventListener('pointerleave', () => {
    const pop = el.querySelector('.tl-pop');
    if (pop) { pop.classList.remove('show'); pop.dataset.r = ''; }
  });
}

export function showTimeline() {
  const ev = upcoming();
  const rows = [...ev].sort((a, b) => a[0] - b[0]).map(([r, list]) => {
    const S = SEASONS[seasonOf(r)];
    const when = r === game.round ? 'This round' : r === game.round + 1 ? 'Next round' : `In ${r - game.round} rounds`;
    return `<div class="tl-row ${r === game.round ? 'now' : ''}">
      <div class="tl-when"><b>${when}</b><span>${svg(S.icon)}Round ${r}</span></div>
      <div class="tl-evs">${list.map((e) => `<div class="tl-ev ${e.mine ? 'mine' : ''}">${svg(e.icon)}<div><b>${e.title}</b><small>${e.desc}</small></div></div>`).join('')}</div>
    </div>`;
  }).join('');
  openModal(`
    <h2>What's coming</h2>
    <p class="note">Round ${game.round} of ${game.lastRound}. Each season lasts ${ROUNDS_PER_SEASON} rounds; every round ends with the harvest.</p>
    <div class="tl-list">${rows}</div>
    <div class="actions"><button class="primary" data-close>Close</button></div>`,
  (card) => { card.querySelector('[data-close]').onclick = () => closeModal(); });
}
