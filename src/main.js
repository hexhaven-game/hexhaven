import { Game } from './game.js';
import { World3D } from './world3d.js';
import { choosePlacement, aiStep, respondToOffer, proposeTrade } from './ai.js';
import {
  RES, TRADE_RES, RES_INFO, TILE_TYPES, BUILDINGS, CROPS, HOME_LEVELS, POIS, GUARD_COST, MAX_GUARDS,
  SEASONS, BONUSES, WIN_GOAL, BUILDING_UPGRADES, PERKS, PLACEABLE,
} from './data.js';
import { svg, iconify } from './icons.js';
import changelogMd from '../CHANGELOG.md?raw';

// ---------- changelog (the same CHANGELOG.md that lives in the repo root) ----------
function parseChangelog(md) {
  const releases = [];
  let rel = null;
  let sec = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const v = line.match(/^##\s+([\d.]+)\s*[—-]\s*(.+)$/);
    if (v) {
      rel = { version: v[1], date: v[2].trim(), sections: [] };
      releases.push(rel);
      sec = null;
      continue;
    }
    const h = line.match(/^###\s+(.+)$/);
    if (h && rel) {
      sec = { title: h[1].trim(), items: [] };
      rel.sections.push(sec);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item && sec) sec.items.push(item[1]);
  }
  return releases;
}
const RELEASES = parseChangelog(changelogMd);
const APP_VERSION = RELEASES[0]?.version ?? '0';

const $ = (s) => document.querySelector(s);
const hexColor = (c) => `#${c.toString(16).padStart(6, '0')}`;
const amount = (obj) => Object.entries(obj).filter(([, n]) => n > 0)
  .map(([r, n]) => `<span class="amt">${n}${svg(r)}</span>`).join(' ') || 'free';

// ---------- settings & saves ----------
const SETTINGS_KEY = 'hexhaven-settings';
const settings = { quality: 'high', speed: 1, follow: true, ...readJSON(SETTINGS_KEY) };
const saveKey = (slot) => `hexhaven-save-${slot}`;

function readJSON(k, store = localStorage) {
  try { return JSON.parse(store.getItem(k)) || null; } catch { return null; }
}
function writeJSON(k, v, store = localStorage) {
  try { store.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
}
const readSave = (slot) => readJSON(saveKey(slot));
const writeSave = (slot) => writeJSON(saveKey(slot), game.serialize());
function deleteSave(slot) {
  try { localStorage.removeItem(saveKey(slot)); } catch { /* storage unavailable */ }
}

function saveMeta(d) {
  if (!d) return null;
  const r = Math.max(1, d.round);
  const season = SEASONS[Math.floor((r - 1) / 3) % 4];
  const year = Math.floor((r - 1) / 12) + 1;
  const ago = Math.round((Date.now() - d.savedAt) / 60000);
  const when = ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : new Date(d.savedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `Year ${year}, ${season.name.toLowerCase()} · ${when}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * settings.speed));

// Menu flies out, the world morphs (see World3D.transitionTo), then the HUD fades in and play starts
function enterGame() {
  const menu = $('#menu');
  menu.classList.add('leaving');
  world.setMenuMode(false);
  $('#log').innerHTML = '';
  const settle = world.transitionTo(human().home);
  setTimeout(() => {
    menu.classList.add('hidden');
    menu.classList.remove('leaving');
    document.body.classList.remove('in-menu');
    $('#hud').classList.add('enter');
    setTimeout(() => $('#hud').classList.remove('enter'), 2000);
  }, 700);
  setTimeout(run, Math.max(1500, settle * 1000 - 200));
}

// ---------- core objects ----------
const game = new Game();
const world = new World3D($('#scene'), game);
world.setQuality(settings.quality);
window.hexhaven = { game, world, settings };

let inGame = false;
let muted = false;
let mode = { kind: 'idle' };
let selKey = null;
let flash = '';

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

const aiActing = () => {
  const cur = current();
  return inGame && cur != null && game.players[cur].isAI;
};

game.on('log', (msg, pid) => { if (!muted && inGame) addLog(msg, pid); });
game.on('state', () => { if (!muted && inGame) scheduleRender(); });
game.on('tilePlaced', (t) => {
  if (muted) return;
  world.addTile(t, true);
  world.syncFrontier();
});
game.on('tileChanged', (t, opts) => {
  if (muted) return;
  world.refreshTile(t, opts);
  // follow whatever an opponent touches (building, planting, restoring) so you can watch it happen
  if (aiActing() && game.phase === 'action' && settings.follow) world.follow(t.key, 0.9);
});
game.on('quests', () => { if (!muted) world.syncQuests(); });
game.on('revealed', () => { if (!muted) world.syncFrontier(); });
game.on('float', (k, text) => {
  if (!muted) world.floatText(k, text);
});

const human = () => game.players.find((p) => !p.isAI);

// ---------- log / toast / modal ----------
// Log lines are batched per frame and only the newest three are kept, so a big harvest
// (dozens of messages at once) costs one small DOM update instead of dozens
let logQueue = [];
function addLog(msg, pid) {
  logQueue.push({ msg, pid });
  if (logQueue.length > 1) return;
  requestAnimationFrame(() => {
    const items = logQueue.slice(-3);
    logQueue = [];
    const log = $('#log');
    for (const { msg: m, pid: id } of items) {
      const div = document.createElement('div');
      div.innerHTML = iconify(m);
      if (id != null) div.style.setProperty('--c', hexColor(game.players[id].color));
      log.prepend(div);
    }
    while (log.children.length > 3) log.lastChild.remove();
  });
}

function toast(title, sub = '', ms = 2000) {
  const el = $('#toast');
  el.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  return new Promise((res) => setTimeout(() => { el.classList.remove('show'); setTimeout(res, 250); }, ms * settings.speed));
}

let modalClose = null;
function openModal(html, bind, { onClose, wide, noDim } = {}) {
  const m = $('#modal');
  const card = m.querySelector('.card');
  card.innerHTML = html;
  card.classList.toggle('wide', !!wide);
  m.classList.toggle('nodim', !!noDim);
  m.classList.remove('hidden');
  modalClose = onClose || null;
  bind?.(card);
  $('#tooltip').style.display = 'none';
}
function closeModal() {
  $('#modal').classList.add('hidden');
  const fn = modalClose;
  modalClose = null;
  fn?.();
}
const modalOpen = () => !$('#modal').classList.contains('hidden');

// ---------- main menu ----------
function buildDemoWorld() {
  muted = true;
  game.setup({ name: 'Jelle', bonus: 'farmer' });
  for (const p of game.players) p.isAI = true;
  for (let r = 0; r < 9; r++) {
    game.startRound();
    for (const pid of game.order) {
      const p = game.players[pid];
      const c = choosePlacement(game, p);
      if (c) game.placeTile(pid, c.type, c.key);
      p.actionsLeft = 2;
      const st = {};
      for (let i = 0; i < 8 && aiStep(game, p, st); i++);
    }
    game.worldPhase();
  }
  game.quests = [];
  muted = false;
  world.setSeason([0, 1, 2][Math.floor(Math.random() * 3)], true);
  world.showNames = false; // the title island is anonymous: no player names
  world.playIntro();
}

const WORD_COLORS = ['#4f9e38', '#e0b12a', '#2f6fd6', '#c8342f'];

function showMainMenu() {
  inGame = false;
  document.body.classList.add('in-menu');
  world.setMenuMode(true);
  const auto = readSave('auto');
  const canContinue = auto && !auto.over;
  const hasSaves = ['auto', 1, 2, 3].some((s) => readSave(s));
  const menu = $('#menu');
  menu.innerHTML = `
    <div class="menu-inner">
      <div class="wordmark" aria-hidden="true">${[...'hexhaven'].map((ch, i) => `<span style="--i:${i};--c:${WORD_COLORS[i % 4]}"><i>${ch}</i></span>`).join('')}</div>
      <nav class="menu-nav">
        ${canContinue ? `<button data-m="continue">Continue<small>${saveMeta(auto)}</small></button>` : ''}
        <button data-m="new">New game</button>
        ${hasSaves ? '<button data-m="load">Load</button>' : ''}
        <button data-m="settings">Settings</button>
        <button data-m="help">How to play</button>
      </nav>
      <button class="version" data-m="changelog" title="What's new">Version ${APP_VERSION}</button>
    </div>`;
  menu.classList.remove('hidden');
  menu.onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    ({
      continue: () => startFromSave('auto'),
      new: () => showNewGame(),
      load: () => showSlots('load'),
      settings: () => showSettings(),
      help: () => showHelp(),
      changelog: () => showChangelog(),
    })[b.dataset.m]();
  };
}

function hideMainMenu() {
  $('#menu').classList.add('hidden');
  document.body.classList.remove('in-menu');
  world.setMenuMode(false);
}

function showNewGame() {
  let bonus = 'farmer';
  const saved = readJSON('hexhaven-name') || 'Jelle';
  const icons = { shepherd: 'wool', farmer: 'grain', explorer: 'compass' };
  openModal(`
    <h2>New game</h2>
    <label class="field">Your name<input type="text" id="pname" maxlength="14" value="${saved}"></label>
    <p class="label">Starting perk</p>
    <div class="bonuses">
      ${Object.entries(BONUSES).map(([id, b]) => `
        <button class="bonus ${id === bonus ? 'sel' : ''}" data-b="${id}">
          ${svg(icons[id], 'ic big')}<b>${b.name}</b><span>${b.desc}</span>
        </button>`).join('')}
    </div>
    <p class="note">You play against Sophie, Tom and Laura. First to ${WIN_GOAL} prosperity wins, or whoever leads after two years.</p>
    <div class="actions">
      <button class="ghost" data-x="cancel">Back</button>
      <button class="primary" data-x="start">Start</button>
    </div>`, (card) => {
    card.onclick = (e) => {
      const b = e.target.closest('[data-b]');
      if (b) {
        bonus = b.dataset.b;
        card.querySelectorAll('.bonus').forEach((el) => el.classList.toggle('sel', el === b));
      }
      const x = e.target.closest('[data-x]');
      if (x?.dataset.x === 'cancel') closeModal();
      if (x?.dataset.x === 'start') {
        const name = card.querySelector('#pname').value.trim() || 'Jelle';
        writeJSON('hexhaven-name', name);
        closeModal();
        startNewGame(name, bonus);
      }
    };
    card.querySelector('#pname').focus();
  });
}

function startNewGame(name, bonus) {
  if (inGame) {
    writeJSON('hexhaven-boot', { action: 'new', name, bonus }, sessionStorage);
    location.reload();
    return;
  }
  muted = true;
  game.setup({ name, bonus });
  muted = false;
  enterGame();
}

function startFromSave(slot) {
  const d = readSave(slot);
  if (!d) return;
  if (inGame) {
    writeJSON('hexhaven-boot', { action: 'load', slot }, sessionStorage);
    location.reload();
    return;
  }
  game.load(d);
  enterGame();
}

function showSlots(kind) {
  const slots = kind === 'load' ? ['auto', 1, 2, 3] : [1, 2, 3];
  const draw = (card, msg = '') => {
    card.innerHTML = `
      <h2>${kind === 'load' ? 'Load game' : 'Save game'}</h2>
      <div class="slots">
        ${slots.map((s) => {
          const d = readSave(s);
          return `<div class="slot ${d ? '' : 'empty'}">
            <div><b>${s === 'auto' ? 'Autosave' : `Slot ${s}`}</b><span>${d ? saveMeta(d) : 'empty'}</span></div>
            <div class="slot-btns">
              ${kind === 'save' ? `<button class="primary small" data-save="${s}">${d ? 'Overwrite' : 'Save'}</button>` : ''}
              ${kind === 'load' && d ? `<button class="primary small" data-load="${s}">Load</button>` : ''}
              ${d && s !== 'auto' ? `<button class="ghost small" data-del="${s}" title="Delete">${svg('close')}</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
      <p class="note">${msg || (kind === 'save' ? 'The game also saves itself at the start of each of your turns.' : '')}</p>
      <div class="actions"><button class="ghost" data-x="close">Back</button></div>`;
  };
  openModal('', (card) => {
    draw(card);
    card.onclick = (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.x === 'close') return closeModal();
      if (t.dataset.save) draw(card, writeSave(t.dataset.save) ? 'Saved.' : 'Could not save: browser storage is full or blocked.');
      if (t.dataset.load) { closeModal(); startFromSave(t.dataset.load); }
      if (t.dataset.del) { deleteSave(t.dataset.del); draw(card); }
    };
  });
}

function showSettings() {
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

function showHelp() {
  openModal(`
    <h2>How to play</h2>
    <ol class="rules">
      <li>Each round, pick one of three tiles and place it against your own land. Matching neighbours earn extra prosperity.</li>
      <li>Then spend your actions: plant, build, scout, hire a guard or attack a bandit camp.</li>
      <li>Trading and the Haven market are free. Haven always has two open orders.</li>
      <li>Some tiles come with a goal flag: grow that area to the number shown for prosperity and a bonus tile.</li>
      <li>A lake next to a field makes crops grow a round faster. Nothing grows in winter.</li>
      <li>Grow your farm into a homestead, manor, village and finally a town for more actions and income.</li>
      <li>Buildings can be improved once for a little extra, and your farm's workshop unlocks small personal perks as it grows.</li>
      <li>At the end of each year the harvest fair rewards whoever filled the most orders.</li>
      <li>Spare gold buys extra tiles, one per round, a little pricier each time.</li>
      <li>First to ${WIN_GOAL} prosperity wins. Otherwise the leader after two years wins. Gold only breaks ties.</li>
    </ol>
    <p class="note">Keys: 1 2 3 pick a tile · E end turn · M market · T trade · I economy · Esc menu</p>
    <div class="actions"><button class="primary" data-x="close">Got it</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  });
}

function showChangelog() {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // dates are written Dutch-style (dd-mm-yyyy) in CHANGELOG.md and shown as-is
  const fmtDate = (d) => d;
  const kind = (title) => ({ new: 'new', improved: 'improved', fixed: 'fixed', fix: 'fixed' }[title.toLowerCase()] || 'other');
  const release = (r) => `
    <div class="rel-head"><b>Version ${r.version}</b><span>${fmtDate(r.date)}</span></div>
    ${r.sections.map((sec) => `
      <div class="rel-sec">
        <span class="rel-tag ${kind(sec.title)}">${esc(sec.title)}</span>
        <ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`).join('')}`;
  openModal(`
    <h2>What's new</h2>
    <div class="changelog">
      ${RELEASES.length ? release(RELEASES[0]) : '<p class="note">No changes recorded yet.</p>'}
      ${RELEASES.slice(1).map((r) => `<details class="rel-old"><summary><i class="chev" aria-hidden="true"></i>Version ${r.version} <span>${fmtDate(r.date)}</span></summary>${release(r)}</details>`).join('')}
    </div>
    <div class="actions"><button class="primary" data-x="close">Close</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  }, { wide: true });
}

function showPause() {
  openModal(`
    <h2>Paused</h2>
    <nav class="menu-nav compact">
      <button data-p="resume">Resume</button>
      <button data-p="save">Save</button>
      <button data-p="load">Load</button>
      <button data-p="new">New game</button>
      <button data-p="settings">Settings</button>
      <button data-p="help">How to play</button>
      <button data-p="changelog">What's new</button>
      <button data-p="menu">Main menu</button>
    </nav>`, (card) => {
    card.onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      ({
        resume: closeModal,
        save: () => showSlots('save'),
        load: () => showSlots('load'),
        new: showNewGame,
        settings: showSettings,
        help: showHelp,
        changelog: showChangelog,
        menu: () => { writeJSON('hexhaven-boot', { action: 'menu' }, sessionStorage); location.reload(); },
      })[b.dataset.p]();
    };
  });
}

// ---------- game loop ----------
const goalReached = () => game.leader().prosp >= WIN_GOAL;

async function run() {
  inGame = true;
  render();
  while (true) {
    if (game.phase === 'start') {
      if (game.round >= game.lastRound || goalReached()) break;
      const { newSeason, raid } = game.startRound();
      game.phase = 'place';
      game.turnIdx = 0;
      game.turnBegun = false;
      render();
      const S = SEASONS[game.season];
      if (newSeason) {
        world.setSeason(game.season);
        await toast(S.name, `Year ${game.year} · round ${game.round}`, 2200);
      } else {
        await toast(`Round ${game.round}`, '', 1000);
      }
      if (raid) {
        world.follow(raid.key);
        await toast('Raiders', 'a new bandit camp has appeared', 2000);
      }
    }
    if (game.phase === 'place') {
      while (game.turnIdx < game.order.length) {
        await placeTurn(game.order[game.turnIdx]);
        game.turnIdx++;
      }
      game.phase = 'action';
      game.turnIdx = 0;
      game.turnBegun = false;
    }
    if (game.phase === 'action') {
      while (game.turnIdx < game.order.length) {
        const pid = game.order[game.turnIdx];
        const p = game.players[pid];
        if (!game.turnBegun) {
          p.actionsLeft = HOME_LEVELS[game.homeTile(pid).level].actions;
          game.turnBegun = true;
        }
        await actionTurn(pid);
        game.turnIdx++;
        game.turnBegun = false;
      }
      game.phase = 'world';
    }
    if (game.phase === 'world') {
      render();
      await toast('Harvest', '', 1000);
      const report = game.worldPhase();
      await sleep(1800);
      if (report.fair?.length) {
        await toast('Harvest fair', report.fair.map(({ p, prize }) => `${p.name} +${prize}`).join(' · '), 2600);
      }
      game.phase = 'start';
    }
  }
  game.over = true;
  deleteSave('auto');
  render();
  showEnd();
}

const current = () => (game.phase === 'place' || game.phase === 'action' ? game.order[game.turnIdx] : null);

async function placeTurn(pid) {
  const p = game.players[pid];
  render();
  let places = 1;
  while (places-- > 0) {
    if (p.isAI) {
      // AI pacing: look at the spot first, then drop, then let the landing settle
      await sleep(700);
      const c = choosePlacement(game, p);
      if (c) {
        if (settings.follow) world.follow(c.key, 1.1);
        await sleep(settings.follow ? 1300 : 700);
        game.placeTile(pid, c.type, c.key);
        await sleep(1200);
      }
    } else {
      await humanPlace(p);
    }
    if (p.bonusTiles > 0) {
      p.bonusTiles--;
      p.offer = game.drawOffer(game.hasPerk(p, 'surveyor') ? 4 : 3);
      places++;
      if (!p.isAI) await toast('Bonus tile', 'place one more', 1100);
      render();
    }
  }
}

async function humanPlace(p) {
  const valid = game.validPlacements(p.id);
  if (!valid.length) {
    addLog('There is no room left to place a tile.', p.id);
    return;
  }
  world.follow(p.home, 0.9);
  writeSave('auto');
  await new Promise((resolve) => {
    mode = { kind: 'place', pid: p.id, sel: 0, resolve, valid };
    world.setValid(valid, p.color);
    world.setPreview(p.offer[0]);
    render();
  });
}

async function actionTurn(pid) {
  const p = game.players[pid];
  render();
  if (p.isAI) {
    if (settings.follow) world.follow(p.home, 1.1);
    await sleep(1000);
    const h = human();
    if (Math.random() < (p.kind === 'merchant' ? 0.6 : 0.35)) {
      const prop = proposeTrade(game, p, h);
      if (prop && game.canAfford(h, prop.aiWants) && game.canAfford(p, prop.aiGives)) {
        const ok = await aiOfferModal(p, prop);
        if (ok) game.trade(p.id, h.id, prop.aiGives, prop.aiWants);
        else addLog(`${h.name} turns down ${p.name}'s offer.`, h.id);
      }
    }
    const st = {};
    for (let i = 0; i < 14; i++) {
      const r = aiStep(game, p, st);
      if (!r) break;
      await sleep(r === 'sell' || r === 'request' ? 900 : 1500);
    }
    return;
  }
  world.follow(p.home, 0.9);
  writeSave('auto');
  selKey = null;
  await new Promise((resolve) => {
    mode = { kind: 'action', pid, resolve };
    refreshHighlights();
    render();
  });
}

function endHumanTurn() {
  if (mode.kind !== 'action') return;
  const r = mode.resolve;
  mode = { kind: 'idle' };
  selKey = null;
  world.setHighlights([]);
  render();
  r();
}

function selectOffer(i) {
  if (mode.kind !== 'place') return;
  mode.sel = i;
  world.setPreview(game.players[mode.pid].offer[i]);
  render();
  updateSynergy();
}

// ---------- world input ----------
// Place the held tile on k (from a click, a second tap, or the "Place here" button)
function placeHeldAt(k) {
  if (mode.kind !== 'place' || !mode.valid.includes(k)) return;
  {
    const p = game.players[mode.pid];
    const type = p.offer[mode.sel];
    const pv = game.placementPreview(p.id, type, k);
    world.clearSynergy();
    $('#synergy').classList.add('hidden');
    synKey = null;
    synSig = '';
    world.prepareDrop(k);
    world.pulseTiles(pv.links.map((l) => l.key));
    setTimeout(() => world.floatText(k, `+${pv.gain}⭐`), 450);
    world.setValid([]);
    world.setPreview(null);
    const r = mode.resolve;
    mode = { kind: 'idle' };
    game.placeTile(p.id, type, k);
    r();
  }
}

world.onClick = (k, info = {}) => {
  if (modalOpen() || !inGame) return;
  if (mode.kind === 'place') {
    // touch has no hover: the first tap previews the spot (held tile, score, reason), the
    // second tap on the same spot places it
    if (info.touch && world.hoverKey !== k) {
      world.hoverAt(k);
      return;
    }
    placeHeldAt(k);
    return;
  }
  if (mode.kind === 'action') {
    selKey = selKey === k ? null : k;
    ringView = 'main';
    flash = '';
    if (selKey) world.follow(selKey, 0.5);
    render();
  }
};

// ---------- synergy preview while holding a tile ----------
let synKey = null;
let synSig = '';
$('#synergy').addEventListener('click', (e) => {
  if (e.target.closest('[data-place]') && synKey) placeHeldAt(synKey);
});
function updateSynergy() {
  const el = $('#synergy');
  const k = world.hoverKey;
  if (mode.kind !== 'place' || !k || !mode.valid.includes(k)) {
    if (synKey) { world.clearSynergy(); el.classList.add('hidden'); synKey = null; synSig = ''; }
    return;
  }
  const type = game.players[mode.pid].offer[mode.sel];
  const sig = `${k}|${type}`;
  if (sig === synSig && synKey) return; // same spot, same tile: nothing to redo (no re-pop)
  synSig = sig;
  const pv = game.placementPreview(mode.pid, type, k);
  world.showSynergy(k, pv.links);
  el.innerHTML = `<div class="syn-wrap"><div class="syn-gain">+${pv.gain}${svg('crown')}</div>${pv.notes.map((n) => `<div class="syn-note">${svg(n.icon)}${n.text}</div>`).join('')}${world.touch ? '<button class="syn-place" data-place>Place here</button>' : ''}</div>`;
  el.classList.toggle('rich', pv.notes.length > 0);
  if (synKey !== k) {
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  if (!synKey) requestAnimationFrame(positionSynergy);
  synKey = k;
}
function positionSynergy() {
  if (!synKey) return;
  const p = world.projectKey(synKey, 1.45);
  $('#synergy').style.transform = `translate(${p.x}px, ${p.y}px)`;
  requestAnimationFrame(positionSynergy);
}

world.onHover = (k, e) => {
  if (mode.kind === 'place') { renderGoal(); updateSynergy(); }
  const tip = $('#tooltip');
  if (!k || !e || modalOpen() || !inGame || (mode.kind === 'place' && mode.valid.includes(k))) {
    tip.style.display = 'none';
    return;
  }
  tip.innerHTML = describe(k);
  tip.style.display = 'block';
  if (e) {
    tip.style.left = `${Math.min(e.clientX + 16, innerWidth - 250)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  }
};

function describe(k) {
  const t = game.tiles.get(k);
  if (!t) {
    const sec = game.revealed.has(k) ? game.secrets.get(k) : null;
    if (sec) return `<b>${POIS[sec].name}</b><span>Unclaimed. Place a tile here to make it yours.</span><span>${POIS[sec].desc}</span>`;
    if (game.revealed.has(k)) return '<b>Scouted</b><span>Nothing special here.</span>';
    return '<b>Unexplored</b><span>Scout it or place a tile here.</span>';
  }
  const lines = [];
  let title = t.type === 'home' ? HOME_LEVELS[t.level].name : TILE_TYPES[t.type].name;
  if (t.owner != null) lines.push(`<b style="color:${hexColor(game.players[t.owner].color)}">${game.players[t.owner].name}</b>`);
  if (t.type === 'village') lines.push('Market town. Buys, sells and places orders.');
  if (t.building) lines.push(t.upgraded ? BUILDING_UPGRADES[t.building].name : BUILDINGS[t.building].name);
  if (t.crop) lines.push(`${CROPS[t.crop.type].name}: ${t.crop.progress} of ${game.growTime(t)} rounds`);
  if (t.type === 'field' && game.irrigated(t)) lines.push('Watered by a lake');
  if (t.poi) {
    if (t.poi.type === 'bandits') {
      title = 'Bandit camp';
      lines.push(`Strength ${t.poi.strength}`);
    } else lines.push(`${POIS[t.poi.type].name}${t.poi.repaired ? ' (restored)' : ''}`);
  }
  const q = game.quests.find((x) => !x.done && game.cluster(x.key).has(k) && game.tiles.get(x.key)?.type === t.type);
  if (q) lines.push(`Goal: grow to ${q.target} tiles (${game.questProgress(q)} now)`);
  const prod = game.production(t);
  if (Object.keys(prod).length) lines.push(`${amount(prod)} per round`);
  return `<b>${title}</b>${lines.map((l) => `<span>${l}</span>`).join('')}`;
}

function refreshHighlights() {
  if (mode.kind !== 'action') return world.setHighlights([]);
  const p = game.players[mode.pid];
  const keys = [];
  if (p.actionsLeft > 0) {
    for (const t of game.owned(p.id)) {
      const canBuild = Object.values(BUILDINGS).some((b) => b.on === t.type) && !t.building;
      const canPlant = t.type === 'field' && !t.crop;
      const canRepair = t.poi && POIS[t.poi.type].repair && !t.poi.repaired;
      if (canBuild || canPlant || canRepair || t.type === 'home') keys.push(t.key);
    }
    for (const t of game.banditsNear(p.id)) keys.push(t.key);
  }
  if (p.actionsLeft > 0 || p.freeExplore) keys.push(...game.explorable(p.id));
  world.setHighlights(keys);
}

// ---------- rendering ----------
function render() {
  world.syncBadges();
  if (!inGame) return;
  renderPlayers();
  renderStatus();
  renderGoal();
  renderScore();
  renderHand();
  renderPanel();
}

// resources shown on the small player cards on the left
const CARD_RES = ['gold', 'wood', 'wool'];

let openCard = null;
function renderPlayers() {
  const cur = current();
  $('#players').innerHTML = game.players.map((p) => `
    <div class="pcard ${cur === p.id ? 'active' : ''} ${openCard === p.id ? 'open' : ''}" data-pid="${p.id}" style="--c:${hexColor(p.color)}"
      title="${p.name}: ${RES.map((r) => `${RES_INFO[r].name} ${p.res[r]}`).join(', ')}">
      <div class="phead">
        <span class="pav">${p.name[0]}</span>
        <span class="pname">${p.name}${p.isAI ? '' : '<em>you</em>'}</span>
        <span class="pscore">${svg('crown')}${p.prosp}</span>
      </div>
      <div class="pbar"><i style="width:${Math.min(100, (p.prosp / WIN_GOAL) * 100)}%"></i></div>
      <div class="pres">
        ${RES.map((r) => `<span class="r" style="--rc:${RES_COLOR[r]}">${svg(r)}<b>${p.res[r]}</b></span>`).join('')}
      </div>
    </div>`).join('');
}
// tap/click a player card to peek at their resources
$('#players').addEventListener('click', (e) => {
  const c = e.target.closest('.pcard');
  if (!c) return;
  const pid = Number(c.dataset.pid);
  openCard = openCard === pid ? null : pid;
  renderPlayers();
});

let statusSig = '';
function renderStatus() {
  const S = SEASONS[game.season];
  const me = human();
  const left = me.actionsLeft;
  const total = HOME_LEVELS[game.homeTile(me.id).level].actions;
  const pips = Array.from({ length: total }, (_, i) => `<i class="${i >= left ? 'used' : ''}"></i>`).join('');
  const placing = mode.kind === 'place' && mode.pid === me.id;
  const compact = innerWidth <= 760;
  const sig = `${game.season}|${game.year}|${game.round}|${game.lastRound}|${left}|${me.freeExplore}|${total}|${placing}|${mode.kind}|${game.phase}|${compact}`;
  if (sig === statusSig) return;
  statusSig = sig;
  if (compact) {
    // phones: just the essentials, icons over words
    const cur = current();
    const who = cur != null && game.players[cur].isAI ? game.players[cur] : null;
    $('#status').innerHTML = `
      <span class="seg"><span class="sem">${S.icon}</span><b>${game.round}<span class="of">/${game.lastRound}</span></b></span>
      ${mode.kind === 'action' ? `<span class="seg"><span class="gpips">${pips}</span>${me.freeExplore ? '<b class="free">+scout</b>' : ''}</span>` : ''}
      ${placing ? '<span class="seg lbl">Your tile</span>' : ''}
      ${who ? `<span class="seg lbl"><span class="dot" style="--c:${hexColor(who.color)}"></span>${who.name}</span>` : ''}
      ${game.phase === 'world' ? '<span class="seg lbl">Harvest</span>' : ''}`;
    return;
  }
  $('#status').innerHTML = `
    <span class="seg"><span class="sem">${S.icon}</span><b>${S.name}</b><span class="lbl">Year ${game.year}</span></span>
    <i class="vdiv"></i>
    <span class="seg lbl">Round ${game.round}<span class="of">/${game.lastRound}</span></span>
    <i class="vdiv"></i>
    ${placing
      ? '<span class="seg"><span class="lbl">Place a tile</span></span>'
      : mode.kind === 'action'
        ? `<span class="seg"><span class="gpips">${pips}</span><span class="lbl">${left > 0 || me.freeExplore ? `${left} action${left === 1 ? '' : 's'} left · tap your land` : 'Actions used · end your turn'}</span>${me.freeExplore ? '<b class="free">+scout</b>' : ''}</span>`
        : `<span class="seg"><span class="lbl">${game.phase === 'world' ? 'Harvest' : 'Waiting'}</span></span>`}`;
}

addEventListener('resize', () => { statusSig = ''; if (inGame) renderStatus(); });

let goalSig = '';
function renderGoal() {
  // The objective banner: what should I do right now?
  const cur = current();
  const p = cur != null ? game.players[cur] : null;
  let sig = 'none';
  let html = '';
  const steps = (list, at) => `<div class="steps">${list.map((t, i) => `<span class="step ${i < at ? 'done' : i === at ? 'now' : ''}"><i>${i < at ? '✓' : i + 1}</i><span>${t}</span></span>`).join('<b class="sep"></b>')}</div>`;
  if (game.over) {
    sig = 'over';
  } else if (mode.kind === 'place') {
    const me = game.players[mode.pid];
    // hovering only patches the hint line (below), it never rebuilds the banner
    const held = TILE_TYPES[me.offer[mode.sel]].name;
    sig = `place|${me.bonusTiles}|${me.offer.join(',')}`;
    const swap = world.touch ? 'tap a card to swap' : `1–${me.offer.length} to swap`;
    html = `<div class="goal-head">${me.bonusTiles > 0 ? 'Bonus tile' : 'Your turn'}</div>
      ${steps([`${held} in hand · ${swap}`, world.touch ? 'Tap a glowing spot, tap again to place' : 'Drop it on a glowing spot'], 1)}
      <div class="goal-hint"></div>`;
  } else if (mode.kind === 'action') {
    // the status bar says how many actions are left; no extra panel needed
    sig = 'action';
  } else if (p && !p.isAI) {
    sig = 'ready';
  } else if (p) {
    sig = `ai|${cur}|${game.phase}`;
    html = `<div class="goal-head ai" style="--c:${hexColor(p.color)}"><span class="hx">${p.name[0]}</span>${p.name} ${game.phase === 'place' ? 'is placing a tile' : 'is taking a turn'}<span class="dots"><i></i><i></i><i></i></span></div>`;
  } else if (game.phase === 'world') {
    sig = 'world';
    html = '<div class="goal-head">Harvest time</div><div class="goal-sub">Crops grow, land produces, bandits prowl</div>';
  }
  if (sig !== goalSig) {
    goalSig = sig;
    const el = $('#goal');
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  if (mode.kind === 'place') {
    const me = game.players[mode.pid];
    const label = $('#goal .step span');
    const text = `${TILE_TYPES[me.offer[mode.sel]].name} in hand · ${world.touch ? 'tap a card to swap' : `1–${me.offer.length} to swap`}`;
    if (label && label.textContent !== text) label.textContent = text;
    const k = world.hoverKey;
    let hint = '';
    if (k && !mode.valid.includes(k)) {
      hint = game.tiles.has(k) ? 'This spot is already taken' : 'Too far: place it next to your own land';
    }
    const el = $('#goal .goal-hint');
    if (el && el.textContent !== hint) {
      el.textContent = hint;
      el.classList.toggle('show', !!hint);
    }
  }
}

const RES_COLOR = { wood: '#9a6a40', stone: '#7f8a87', grain: '#d69e1c', veg: '#e0702a', wool: '#9c86c2', gold: '#d9a514' };
let lastRes = null;

function renderScore() {
  const h = human();
  const canDeliver = mode.kind === 'action';
  const inc = game.economy(h.id).income;
  const el = $('#score');
  // build once, then only patch numbers so changes can animate
  if (!el.querySelector('.resbar')) {
    el.innerHTML = `
      <button class="resbar" data-act="economy" title="Your economy (I)">
        ${RES.map((r) => `<span class="rs" data-r="${r}" style="--rc:${RES_COLOR[r]}" title="${RES_INFO[r].name}">
          <span class="ico">${svg(r)}</span><b></b><small></small></span>`).join('')}
      </button>
      <div class="orders"></div>`;
  }
  for (const r of RES) {
    const cell = el.querySelector(`.rs[data-r="${r}"]`);
    const b = cell.querySelector('b');
    const n = h.res[r];
    if (b.textContent !== String(n)) {
      b.textContent = n;
      const prev = lastRes?.[r];
      if (prev != null && prev !== n) {
        cell.classList.remove('bump');
        void cell.offsetWidth;
        cell.classList.add('bump');
        const d = document.createElement('span');
        d.className = `delta ${n > prev ? 'up' : 'down'}`;
        d.textContent = `${n > prev ? '+' : '−'}${Math.abs(n - prev)}`;
        cell.appendChild(d);
        setTimeout(() => d.remove(), 1200);
      }
    }
    cell.querySelector('small').textContent = inc[r] ? `+${inc[r]}` : '';
  }
  lastRes = { ...h.res };
  el.querySelector('.orders').innerHTML = game.requests.map((q, i) => {
    const ok = canDeliver && h.res[q.res] >= q.amount;
    return `<button class="order ${ok ? 'ready' : ''}" data-act="deliver" data-i="${i}" ${ok ? '' : 'disabled'} title="Order from Haven">
      ${svg('flag')} ${amount({ [q.res]: q.amount })} <span class="arrow">→</span> ${amount({ gold: q.gold })} +${q.prosp}${ok ? '<em>Deliver</em>' : ''}</button>`;
  }).join('');
}

function showEconomy() {
  const h = human();
  const eco = game.economy(h.id);
  const soon = {};
  for (const c of eco.crops) {
    if (c.left <= 3) for (const [r, n] of Object.entries(c.yield)) soon[r] = (soon[r] || 0) + n;
  }
  const hist = eco.history;
  const maxW = Math.max(10, ...hist.map((x) => x.worth));
  // fixed-size bars (12 slots) so a short history doesn't stretch into blobs
  const bars = hist.length
    ? `<svg class="chart" viewBox="0 0 264 84">${hist.map((x, i) => {
      const bh = Math.max(3, (x.worth / maxW) * 54);
      return `<g><rect x="${i * 22 + 3}" y="${70 - bh}" width="16" height="${bh}" rx="3"><title>Round ${x.round}: worth ${x.worth} gold</title></rect>
        <text x="${i * 22 + 11}" y="${64 - bh}" text-anchor="middle">${Math.round(x.worth)}</text>
        <text x="${i * 22 + 11}" y="82" text-anchor="middle" class="r">${x.round}</text></g>`;
    }).join('')}</svg>`
    : '<p class="note">Your income appears here after the first harvest.</p>';
  const trend = hist.length >= 2 ? hist[hist.length - 1].worth - hist[hist.length - 2].worth : 0;
  const perRound = RES.reduce((s, r) => s + (eco.income[r] || 0) * (r === 'gold' ? 1 : game.market[r].p), 0);
  openModal(`
    <h2>Your economy</h2>
    <div class="eco-top">
      <div><small>stock is worth</small><b>${Math.round(eco.value)}</b>${svg('gold')}</div>
      <div><small>income per round</small><b>${Math.round(perRound)}</b>${svg('gold')}</div>
      <div><small>vs previous round</small><b class="${trend >= 0 ? 'good' : 'bad'}">${trend >= 0 ? '+' : '−'}${Math.abs(Math.round(trend))}</b></div>
    </div>
    <table class="eco">
      <tr><th></th><th>have</th><th>each round</th><th>from crops soon</th><th>sells for</th></tr>
      ${RES.map((r) => `<tr>
        <td><span class="ico" style="--rc:${RES_COLOR[r]}">${svg(r)}</span>${RES_INFO[r].name}</td>
        <td><b>${h.res[r]}</b></td>
        <td class="${eco.income[r] ? 'good' : 'dim'}">${eco.income[r] ? `+${eco.income[r]}` : '–'}</td>
        <td class="${soon[r] ? '' : 'dim'}">${soon[r] ? `+${soon[r]}` : '–'}</td>
        <td class="dim">${r === 'gold' ? '' : game.sellPrice(h.id, r)}</td></tr>`).join('')}
    </table>
    <div class="eco-cols">
      <div>
        <h4>Where it comes from</h4>
        ${eco.sources.length ? eco.sources.map((src) => `<div class="src"><span>${src.n > 1 ? `${src.n}× ` : ''}${src.label}</span><span>${amount(src.gives)}</span></div>`).join('') : '<p class="note">Nothing yet. Forests, meadows and mountains produce every round.</p>'}
      </div>
      <div>
        <h4>In the ground</h4>
        ${eco.crops.length ? eco.crops.map((c) => `<div class="src"><span>${c.name}</span><span>${c.left ? `${c.left} round${c.left > 1 ? 's' : ''}` : 'this round'} → ${amount(c.yield)}</span></div>`).join('') : '<p class="note">No crops planted. Click a field to plant.</p>'}
        <h4>Income per round</h4>
        ${bars}
        ${eco.bandits ? `<p class="note warn">${eco.bandits} bandit camp${eco.bandits > 1 ? 's' : ''} next to your land. Your guards stop ${Math.round(eco.block * 100)}% of raids.</p>` : ''}
      </div>
    </div>
    <div class="actions"><button class="primary" data-x="close">Close</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  }, { wide: true });
}

let handSig = '';
function setHand(sig, html) {
  if (sig === handSig) return false;
  handSig = sig;
  $('#hand').innerHTML = html;
  return true;
}

function renderHand() {
  const roundsLeft = game.lastRound - game.round;
  const stackH = Math.max(1, Math.min(7, Math.ceil(roundsLeft / 3)));
  const stack = (type) => `
    <div class="stack" title="${roundsLeft} rounds left">
      <img src="${world.stackThumb(type || 'field', stackH)}" alt="">
      <div class="count">${roundsLeft}</div>
    </div>`;
  if (game.over) { setHand('over', ''); return; }
  if (mode.kind === 'place') {
    const p = game.players[mode.pid];
    // rebuild only when the offer itself changes; picking a card just moves the selection
    const built = setHand(`place|${game.round}|${p.bonusTiles}|${p.offer.join(',')}`, `
      <div class="tray">
        <div class="tray-head">Choose 1 tile to place</div>
        <div class="cards">${p.offer.map((t, i) => `
          <button class="tcard" data-act="sel-tile" data-i="${i}">
            <img src="${world.thumb(t)}" alt="">
            <span class="name">${TILE_TYPES[t].name}</span>
            <span class="desc">${TILE_TYPES[t].desc}</span>
            <kbd>${i + 1}</kbd>
          </button>`).join('')}
        </div>
      </div>
      ${stack(p.offer[mode.sel])}`);
    const el = $('#hand');
    el.querySelectorAll('.tcard').forEach((c, i) => {
      const was = c.classList.contains('sel');
      c.classList.toggle('sel', i === mode.sel);
      if (!built && !was && i === mode.sel) {
        c.classList.remove('pick');
        void c.offsetWidth;
        c.classList.add('pick');
      }
    });
    const img = el.querySelector('.stack img');
    const src = world.stackThumb(p.offer[mode.sel], stackH);
    if (img && img.getAttribute('src') !== src) img.src = src;
    return;
  }
  if (mode.kind === 'action') {
    const p = human();
    const canBuy = p.boughtRound !== game.round && p.res.gold >= game.tilePrice(p.id);
    setHand(`action|${game.round}|${p.actionsLeft}|${p.freeExplore}|${canBuy}|${game.tilePrice(p.id)}`, `
      <div class="actbar">
        <div class="hexbtns">
          <button class="hexbtn" data-act="market" title="Market (M)">${svg('market')}<span>Market</span></button>
          <button class="hexbtn" data-act="trade" title="Trade (T)">${svg('trade')}<span>Trade</span></button>
          <button class="hexbtn" data-act="buy-tile" ${canBuy ? '' : 'disabled'} title="Buy an extra tile for next round (${game.tilePrice(p.id)} gold)">${svg('tile')}<span>+1 tile</span></button>
          <button class="hexbtn go ${p.actionsLeft === 0 && !p.freeExplore ? 'nudge' : ''}" data-act="end" title="End turn (E)">${svg('next')}<span>End Turn</span></button>
        </div>
      </div>
      ${stack(null)}`);
    return;
  }
  const cur = current();
  const p = cur != null ? game.players[cur] : null;
  const waiting = p && !p.isAI ? '' : `<div class="waiting">${p ? `<span class="dot" style="--c:${hexColor(p.color)}"></span>${p.name}'s turn` : 'Harvest'}</div>`;
  setHand(`wait|${cur}|${game.phase}|${roundsLeft}`, `${waiting}${stack(null)}`);
}

// ---------- tile ring: hex buttons around the selected tile ----------
let ringView = 'main';

function tileOptions(k) {
  const p = human();
  const t = game.tiles.get(k);
  const hasAct = p.actionsLeft > 0;
  const opts = [];
  const add = (o) => opts.push({ enabled: true, ...o });
  if (!t) {
    if (game.explorable(p.id).includes(k)) {
      add({ act: 'explore', icon: 'compass', label: 'Scout', desc: 'Reveal what is hidden here.', cost: p.freeExplore ? 'free' : '1 action', enabled: hasAct || p.freeExplore, data: `data-k="${k}"` });
    }
    return opts;
  }
  if (ringView === 'workshop' && t.type === 'home' && t.owner === p.id) {
    add({ act: 'ring-back', icon: 'next', label: 'Back', desc: '', back: true });
    for (const [id, perk] of Object.entries(PERKS)) {
      const owned = game.hasPerk(p, id);
      const unlocked = t.level >= perk.level;
      add({
        act: 'perk', icon: owned ? 'crown' : 'tile', label: perk.name,
        desc: owned ? `${perk.desc} (built)` : unlocked ? perk.desc : `${perk.desc} Needs a ${HOME_LEVELS[perk.level].name.toLowerCase()}.`,
        cost: owned ? '' : amount(perk.cost), enabled: !owned && unlocked && hasAct && game.canAfford(p, perk.cost), owned, data: `data-perk="${id}"`,
      });
    }
    return opts;
  }
  if (t.owner === p.id && t.type === 'field' && !t.crop) {
    for (const [id, c] of Object.entries(CROPS)) {
      const grow = game.growTime(t, id);
      const cost = game.cropCost(p, id);
      const fits = grow <= game.growRoundsLeft();
      add({
        act: 'plant', icon: { wheat: 'grain', carrot: 'veg', pumpkin: 'plant' }[id], label: c.name,
        desc: `Ready in ${grow} rounds, yields ${amount(c.yield)}.${game.season === 3 ? ' Nothing grows in winter.' : ''}`,
        cost: amount(cost), enabled: hasAct && fits && game.canAfford(p, cost), data: `data-k="${k}" data-c="${id}"`,
      });
    }
  }
  if (t.owner === p.id && !t.building) {
    for (const [id, b] of Object.entries(BUILDINGS)) {
      if (b.on !== t.type) continue;
      add({ act: 'build', icon: 'hammer', label: b.name, desc: b.desc, cost: amount(b.cost), enabled: hasAct && game.canAfford(p, b.cost), data: `data-k="${k}" data-b="${id}"` });
    }
  }
  if (t.owner === p.id && t.building && !t.upgraded) {
    const up = BUILDING_UPGRADES[t.building];
    add({ act: 'improve', icon: 'hammer', label: up.name, desc: up.desc, cost: amount(up.cost), enabled: hasAct && game.canAfford(p, up.cost), data: `data-k="${k}"` });
  }
  if (t.owner === p.id && t.poi && POIS[t.poi.type].repair && !t.poi.repaired) {
    const P = POIS[t.poi.type];
    add({ act: 'repair', icon: t.poi.type === 'mill' ? 'mill' : 'ruins', label: 'Restore', desc: P.desc, cost: amount(P.repair), enabled: hasAct && game.canAfford(p, P.repair), data: `data-k="${k}"` });
  }
  if (t.type === 'home' && t.owner === p.id) {
    const next = HOME_LEVELS[t.level + 1];
    if (next) {
      const extra = next.actions > HOME_LEVELS[t.level].actions ? ', +1 action' : '';
      add({ act: 'upgrade', icon: 'house', label: `Grow into a ${next.name.toLowerCase()}`, desc: `+${next.prosp} prosperity${extra}, +${next.gold} gold each round.`, cost: amount(next.cost), enabled: hasAct && game.canAfford(p, next.cost) });
    }
    add({ act: 'recruit', icon: 'shield', label: 'Hire a guard', desc: `Guards protect your land and fight bandits. You have ${p.guards} of ${MAX_GUARDS}.`, cost: amount(GUARD_COST), enabled: hasAct && p.guards < MAX_GUARDS && game.canAfford(p, GUARD_COST) });
    add({ act: 'ring-workshop', icon: 'workshop', label: 'Workshop', desc: 'Small personal perks. More unlock as your farm grows.', cost: `${p.perks?.length || 0} of ${Object.keys(PERKS).length}` });
  }
  if (game.isBandit(t)) {
    const near = game.banditsNear(p.id).includes(t);
    const chance = Math.round(game.winChance(p.guards, t.poi.strength) * 100);
    add({
      act: 'challenge', icon: 'sword', label: 'Attack',
      desc: near ? `${p.guards} guards against strength ${t.poi.strength}: ${chance}% chance to win.` : 'Only camps that border your land.',
      cost: '1 action', enabled: hasAct && near && p.guards > 0, data: `data-k="${k}"`,
    });
  }
  return opts;
}

function renderPanel() {
  const el = $('#panel');
  if (mode.kind !== 'action' || !selKey) {
    el.classList.add('hidden');
    ringView = 'main';
    return;
  }
  const opts = tileOptions(selKey);
  const t = game.tiles.get(selKey);
  const title = t ? (t.type === 'home' ? HOME_LEVELS[t.level].name : t.poi?.type === 'bandits' ? 'Bandit camp' : TILE_TYPES[t.type].name) : 'Unexplored';
  const n = opts.length;
  // spread the buttons on an arc above the tile; the arc widens with more buttons
  const spread = Math.min(Math.PI * 1.1, 0.62 * Math.max(1, n - 1));
  const radius = Math.max(78, n * 17);
  el.innerHTML = `
    <div class="ring-title">${title}</div>
    ${opts.map((o, i) => {
      const a = -Math.PI / 2 + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1));
      return `<button class="rbtn ${o.owned ? 'owned' : ''} ${o.back ? 'back' : ''}" data-act="${o.act}" ${o.data || ''} data-i="${i}" ${o.enabled ? '' : 'disabled'}
        style="--x:${Math.cos(a) * radius}px;--y:${Math.sin(a) * radius}px;--d:${i * 0.03}s">${svg(o.icon)}</button>`;
    }).join('')}
    <div class="ring-cap">${flash ? `<span class="warn">${flash}</span>` : n ? '' : describe(selKey)}</div>`;
  el.classList.remove('hidden');
  el.dataset.n = n;
  el.onmouseover = (e) => {
    const b = e.target.closest('.rbtn');
    if (!b) return;
    const o = opts[Number(b.dataset.i)];
    el.querySelector('.ring-cap').innerHTML = `<b>${o.label}</b>${o.desc ? `<span>${o.desc}</span>` : ''}${o.cost ? `<em>${o.cost}</em>` : ''}`;
  };
  el.onmouseleave = () => { el.querySelector('.ring-cap').innerHTML = flash ? `<span class="warn">${flash}</span>` : ''; };
  positionRing();
}

function positionRing() {
  const el = $('#panel');
  if (el.classList.contains('hidden') || !selKey) return;
  const p = world.projectKey(selKey);
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  requestAnimationFrame(positionRing);
}

// ---------- actions ----------
function doAction(res) {
  flash = res.ok ? '' : res.msg;
  // a successful action closes the ring; a failed one keeps it open with the reason
  if (res.ok) {
    selKey = null;
    ringView = 'main';
  }
  refreshHighlights();
  render();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || !inGame || modalOpen()) return;
  const d = b.dataset;
  const pid = human().id;
  switch (d.act) {
    case 'sel-tile': selectOffer(Number(d.i)); break;
    case 'plant': doAction(game.plant(pid, d.k, d.c)); break;
    case 'build': doAction(game.build(pid, d.k, d.b)); break;
    case 'repair': doAction(game.repair(pid, d.k)); break;
    case 'explore': {
      const r = game.explore(pid, d.k);
      if (r.ok) selKey = null;
      doAction(r);
      break;
    }
    case 'challenge': {
      const r = game.challenge(pid, d.k);
      if (r.ok) {
        selKey = null;
        refreshHighlights();
        render();
        toast(r.won ? 'Victory' : 'Defeat', r.won ? 'the camp is yours now' : 'you lost a guard', 1500);
      } else doAction(r);
      break;
    }
    case 'upgrade': doAction(game.upgradeHome(pid)); break;
    case 'improve': doAction(game.upgradeBuilding(pid, d.k)); break;
    case 'perk': doAction(game.buyPerk(pid, d.perk)); break;
    case 'recruit': doAction(game.recruit(pid)); break;
    case 'market': showMarket(); break;
    case 'economy': showEconomy(); break;
    case 'trade': showTrade(); break;
    case 'deliver': if (mode.kind === 'action') { game.fulfillRequest(pid, Number(d.i)); render(); } break;
    case 'buy-tile': if (game.buyTile(pid)) toast('Extra tile', 'you place it next round', 1200); break;
    case 'end': endHumanTurn(); break;
    case 'close-panel': selKey = null; render(); break;
    case 'ring-workshop': ringView = 'workshop'; render(); break;
    case 'ring-back': ringView = 'main'; render(); break;
  }
});

$('#menuBtn').addEventListener('click', () => { if (inGame) showPause(); });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') {
    if (modalOpen()) closeModal();
    else if (selKey) { selKey = null; render(); }
    else if (inGame) showPause();
    return;
  }
  if (modalOpen() || !inGame) return;
  if (mode.kind === 'place' && /^[1-4]$/.test(e.key) && Number(e.key) <= game.players[mode.pid].offer.length) selectOffer(Number(e.key) - 1);
  if (mode.kind === 'action') {
    const k = e.key.toLowerCase();
    if (k === 'e') endHumanTurn();
    if (k === 'm') showMarket();
    if (k === 't') showTrade();
  }
  if (e.key.toLowerCase() === 'i') showEconomy();
});

// ---------- market ----------
function showMarket() {
  const pid = human().id;
  const draw = (card) => {
    const p = human();
    const conn = game.connected(pid);
    card.innerHTML = `
      <h2>Haven market</h2>
      <p class="note">${conn ? 'Your land borders Haven, so you get the full price.' : 'Your land doesn’t reach Haven yet: selling costs 1 gold transport each.'}</p>
      <table class="market">
        <tr><th></th><th>you have</th><th>sell</th><th>buy</th><th></th></tr>
        ${TRADE_RES.map((r) => `<tr>
            <td>${svg(r)} ${RES_INFO[r].name}</td>
            <td>${p.res[r]}</td>
            <td>${game.sellPrice(pid, r)}</td>
            <td>${game.buyPrice(r, pid)}</td>
            <td class="btncell">
              <button class="small" data-sell="${r}" ${p.res[r] ? '' : 'disabled'}>Sell</button>
              <button class="small ghost" data-sellall="${r}" ${p.res[r] > 1 ? '' : 'disabled'}>All</button>
              <button class="small" data-buy="${r}" ${p.res.gold >= game.buyPrice(r, pid) ? '' : 'disabled'}>Buy</button>
            </td></tr>`).join('')}
      </table>
      <p class="note">You have ${amount({ gold: p.res.gold })}. Prices drop when a lot is sold and recover each round.</p>
      <div class="actions"><button class="primary" data-x="close">Close</button></div>`;
  };
  openModal('', (card) => {
    draw(card);
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.x) return closeModal();
      if (b.dataset.sell) game.sell(pid, b.dataset.sell, 1);
      if (b.dataset.sellall) game.sell(pid, b.dataset.sellall, human().res[b.dataset.sellall]);
      if (b.dataset.buy) game.buy(pid, b.dataset.buy, 1);
      draw(card);
    };
  }, { wide: true, onClose: () => { refreshHighlights(); render(); } });
}

// ---------- trading ----------
function showTrade() {
  const h = human();
  const give = {};
  const want = {};
  let responses = null;
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
  const stepper = (side, r) => {
    const obj = side === 'give' ? give : want;
    const max = side === 'give' ? h.res[r] : 9;
    return `<div class="line"><span>${svg(r)} ${RES_INFO[r].name}${side === 'give' ? ` <small>${h.res[r]}</small>` : ''}</span>
      <span class="stepper"><button class="small ghost" data-s="${side}" data-r="${r}" data-d="-1" ${obj[r] ? '' : 'disabled'}>−</button>
      <b>${obj[r] || 0}</b>
      <button class="small ghost" data-s="${side}" data-r="${r}" data-d="1" ${(obj[r] || 0) < max ? '' : 'disabled'}>+</button></span></div>`;
  };
  const draw = (card) => {
    const g = clean(give);
    const w = clean(want);
    const valid = Object.keys(g).length && Object.keys(w).length;
    card.innerHTML = `
      <h2>Trade</h2>
      <div class="trade-grid">
        <div><h4>You give</h4>${RES.map((r) => stepper('give', r)).join('')}</div>
        <div><h4>You ask for</h4>${RES.map((r) => stepper('want', r)).join('')}</div>
      </div>
      <div class="actions">
        <button class="ghost" data-x="close">Close</button>
        <button class="primary" data-x="offer" ${valid ? '' : 'disabled'}>Make offer</button>
      </div>
      ${responses ? `<div class="responses">${responses.map((r, i) => {
        const ai = game.players[r.pid];
        const action = r.kind === 'accept'
          ? `<button class="primary small" data-accept="${i}">Trade</button>`
          : r.kind === 'counter'
            ? `<span class="counter">${amount(r.gives)} for ${amount(r.wants)}</span><button class="primary small" data-accept="${i}" ${game.canAfford(h, r.gives) ? '' : 'disabled'}>Accept</button>`
            : '<span class="no">no</span>';
        return `<div class="resp" style="--c:${hexColor(ai.color)}"><div><b>${ai.name}</b><span class="q">${r.text}</span></div><div class="ra">${action}</div></div>`;
      }).join('')}</div>` : ''}`;
  };
  openModal('', (card) => {
    draw(card);
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.x === 'close') return closeModal();
      if (b.dataset.s) {
        const obj = b.dataset.s === 'give' ? give : want;
        obj[b.dataset.r] = Math.max(0, (obj[b.dataset.r] || 0) + Number(b.dataset.d));
        responses = null;
      }
      if (b.dataset.x === 'offer') {
        responses = game.players.filter((p) => p.isAI).map((ai) => ({ pid: ai.id, ...respondToOffer(game, ai, h, clean(give), clean(want)) }));
      }
      if (b.dataset.accept != null) {
        const r = responses[Number(b.dataset.accept)];
        if (game.trade(h.id, r.pid, r.gives, r.wants)) {
          closeModal();
          toast('Traded', `with ${game.players[r.pid].name}`, 1300);
          return;
        }
      }
      draw(card);
    };
  }, { wide: true, onClose: () => { refreshHighlights(); render(); } });
}

function aiOfferModal(ai, prop) {
  return new Promise((resolve) => {
    openModal(`
      <h2><span class="dot" style="--c:${hexColor(ai.color)}"></span>${ai.name} wants to trade</h2>
      <div class="offer-box">
        <div><small>you get</small><b>${amount(prop.aiGives)}</b></div>
        <div class="arrow">${svg('trade')}</div>
        <div><small>you give</small><b>${amount(prop.aiWants)}</b></div>
      </div>
      <div class="actions">
        <button class="ghost" data-r="0">No thanks</button>
        <button class="primary" data-r="1">Trade</button>
      </div>`, (card) => {
      card.onclick = (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        modalClose = null;
        closeModal();
        resolve(b.dataset.r === '1');
      };
    }, { onClose: () => resolve(false), noDim: true });
  });
}

// ---------- end ----------
function showEnd() {
  const ranks = game.finalScores();
  const winner = ranks[0].p;
  openModal(`
    <h2>${winner.isAI ? `${winner.name} wins` : 'You win'}</h2>
    <p class="note">${goalReached() ? `${game.leader().name} reached ${WIN_GOAL} prosperity.` : 'Two years have passed.'} Gold breaks ties.</p>
    ${ranks.map(({ p, score }, i) => `
      <div class="rank" style="--c:${hexColor(p.color)}">
        <span class="pos">${i + 1}</span>
        <div><b>${p.name}</b><small>${game.owned(p.id).length} tiles · ${HOME_LEVELS[game.homeTile(p.id).level].name.toLowerCase()} · ${p.res.gold} gold</small></div>
        <span class="sc">${score}</span>
      </div>`).join('')}
    <div class="actions">
      <button class="ghost" data-e="menu">Main menu</button>
      <button class="primary" data-e="new">Play again</button>
    </div>`, (card) => {
    card.onclick = (e) => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      if (b.dataset.e === 'menu') { writeJSON('hexhaven-boot', { action: 'menu' }, sessionStorage); location.reload(); }
      if (b.dataset.e === 'new') showNewGame();
    };
  });
}

// ---------- boot ----------
async function boot() {
  // canvas labels use the web font, so wait for it (but never block on it for long)
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  const b = readJSON('hexhaven-boot', sessionStorage);
  try { sessionStorage.removeItem('hexhaven-boot'); } catch { /* storage unavailable */ }
  if (b?.action === 'load' && readSave(b.slot)) startFromSave(b.slot);
  else if (b?.action === 'new') startNewGame(b.name, b.bonus);
  else {
    buildDemoWorld();
    showMainMenu();
    world.prewarmThumbs(PLACEABLE, [7]);
  }
}
boot();
