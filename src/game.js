import {
  RES, TRADE_RES, RES_INFO, TILE_TYPES, PLACEABLE, BUILDINGS, CROPS, HOME_LEVELS, POIS,
  GUARD_COST, MAX_GUARDS, BUILDING_UPGRADES, PERKS, ROUNDS_PER_SEASON, ROUNDS_PER_YEAR, MARKET_BASE, QUEST_TYPES, costText,
} from './data.js';
import { neighborKeys, dist, distOrigin, inMap, allCells } from './hex.js';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

function makePlayer(id, name, color, kind, bonus, home) {
  return {
    id, name, color, kind, bonus, home,
    isAI: kind !== 'human',
    res: { wood: 2, stone: 1, grain: 2, veg: 0, wool: 0, gold: 3 },
    prosp: 0,
    guards: 0,
    actionsLeft: 0,
    offer: [],
    freeExplore: 0,
    bonusTiles: 0,
    perks: [],
    delivered: 0,
  };
}

export class Game {
  constructor() {
    this.listeners = {};
  }

  on(ev, fn) {
    (this.listeners[ev] ??= []).push(fn);
  }

  emit(ev, ...args) {
    (this.listeners[ev] || []).forEach((fn) => fn(...args));
  }

  log(msg, pid = null) {
    this.emit('log', msg, pid);
  }

  setup({ name, bonus }) {
    this.round = 0;
    this.tiles = new Map();
    this.secrets = new Map();
    this.revealed = new Set();
    this.requests = [];
    this.quests = [];
    this.questSeq = 0;
    this.over = false;
    this.phase = 'start';
    this.turnIdx = 0;
    this.turnBegun = false;
    this.order = [0, 1, 2, 3];
    this.market = {};
    for (const r of Object.keys(MARKET_BASE)) this.market[r] = { p: MARKET_BASE[r] };

    this.players = [
      makePlayer(0, name || 'Jelle', 0x2f6fd6, 'human', bonus, '1,3'),
      makePlayer(1, 'Sophie', 0xc8342f, 'farmer', 'farmer', '-1,-3'),
      makePlayer(2, 'Tom', 0xe0b12a, 'merchant', 'shepherd', '4,-3'),
      makePlayer(3, 'Laura', 0x3f9a3a, 'explorer', 'explorer', '-4,3'),
    ];

    // Haven: a seven-hex walled town in the middle (keep + six districts)
    this.addTile('0,0', 'village', null, { district: 0 });
    neighborKeys('0,0').forEach((k, i) => this.addTile(k, 'village', null, { district: i + 1 }));

    for (const p of this.players) {
      this.addTile(p.home, 'home', p.id, { level: 1 });
      const nbs = neighborKeys(p.home).sort((a, b) => distOrigin(a) - distOrigin(b));
      this.addTile(nbs[0], 'field', p.id);
      const meadow = this.addTile(nbs[1], 'meadow', p.id);
      if (p.bonus === 'shepherd') meadow.building = 'pen';
    }

    for (const k of allCells()) {
      if (this.tiles.has(k) || distOrigin(k) < 2) continue;
      const nearHome = Math.min(...this.players.map((p) => dist(k, p.home)));
      const r = Math.random();
      if (r < 0.08 && nearHome >= 3) this.secrets.set(k, 'bandits');
      else if (r < 0.18) this.secrets.set(k, 'ruins');
      else if (r < 0.24) this.secrets.set(k, 'mill');
      else if (r < 0.31) this.secrets.set(k, 'treasure');
    }
  }

  // ---------- save / load ----------
  serialize() {
    return {
      v: 1,
      savedAt: Date.now(),
      round: this.round,
      phase: this.phase,
      turnIdx: this.turnIdx,
      turnBegun: this.turnBegun,
      order: this.order,
      requests: this.requests,
      quests: this.quests,
      questSeq: this.questSeq,
      market: this.market,
      over: this.over,
      players: this.players,
      tiles: [...this.tiles.values()],
      secrets: [...this.secrets],
      revealed: [...this.revealed],
    };
  }

  load(d) {
    const copy = JSON.parse(JSON.stringify(d));
    Object.assign(this, {
      round: copy.round, phase: copy.phase, turnIdx: copy.turnIdx, turnBegun: copy.turnBegun,
      order: copy.order, requests: copy.requests || [], quests: copy.quests || [], questSeq: copy.questSeq || 0,
      market: copy.market, over: copy.over, players: copy.players,
    });
    this.tiles = new Map(copy.tiles.map((t) => [t.key, t]));
    this.secrets = new Map(copy.secrets);
    this.revealed = new Set(copy.revealed);
  }

  addTile(k, type, owner, extra = {}) {
    const t = { key: k, type, owner, building: null, crop: null, poi: null, level: 0, ...extra };
    this.tiles.set(k, t);
    return t;
  }

  // ---------- queries ----------
  get season() {
    return this.seasonOf(Math.max(1, this.round));
  }

  get year() {
    return Math.floor((Math.max(1, this.round) - 1) / ROUNDS_PER_YEAR) + 1;
  }

  seasonOf(round) {
    return Math.floor((round - 1) / ROUNDS_PER_SEASON) % 4;
  }

  homeTile(pid) {
    return this.tiles.get(this.players[pid].home);
  }

  owned(pid) {
    return [...this.tiles.values()].filter((t) => t.owner === pid);
  }

  isBandit(t) {
    return t?.poi?.type === 'bandits';
  }

  frontier() {
    const set = new Set();
    for (const t of this.tiles.values()) {
      for (const n of neighborKeys(t.key)) if (!this.tiles.has(n) && inMap(n)) set.add(n);
    }
    return set;
  }

  validPlacements(pid) {
    return [...this.frontier()].filter((k) =>
      neighborKeys(k).some((n) => this.tiles.get(n)?.owner === pid));
  }

  explorable(pid) {
    const own = this.owned(pid);
    return [...this.frontier()].filter((k) =>
      !this.revealed.has(k) && own.some((t) => dist(t.key, k) <= 2));
  }

  banditsNear(pid) {
    return [...this.tiles.values()].filter((t) =>
      this.isBandit(t) && neighborKeys(t.key).some((n) => this.tiles.get(n)?.owner === pid));
  }

  connected(pid) {
    return this.owned(pid).some((t) => distOrigin(t.key) <= 2);
  }

  irrigated(t) {
    return neighborKeys(t.key).some((n) => this.tiles.get(n)?.type === 'lake');
  }

  millBoost(t) {
    return neighborKeys(t.key).some((n) => {
      const m = this.tiles.get(n);
      return m?.poi?.type === 'mill' && m.poi.repaired && m.owner === t.owner;
    });
  }

  growTime(t, cropType = t.crop?.type) {
    let g = CROPS[cropType].grow;
    if (this.irrigated(t)) g--;
    if (t.owner != null && this.players[t.owner].bonus === 'farmer') g--;
    return Math.max(1, g);
  }

  growRoundsLeft() {
    let n = 0;
    for (let r = this.round; r <= this.lastRound; r++) if (this.seasonOf(r) !== 3) n++;
    return n;
  }

  production(t) {
    const out = {};
    if (t.owner == null || this.isBandit(t)) return out;
    const add = (obj) => { for (const [r, n] of Object.entries(obj)) out[r] = (out[r] || 0) + n; };
    add(TILE_TYPES[t.type].prod);
    if (t.building) add(BUILDINGS[t.building].prod);
    if (t.building && t.upgraded) add(BUILDING_UPGRADES[t.building].prod);
    const main = Object.keys(TILE_TYPES[t.type].prod)[0];
    if (main) {
      const same = neighborKeys(t.key).filter((n) => this.tiles.get(n)?.type === t.type).length;
      if (same >= 2) add({ [main]: 1 });
    }
    if (t.poi?.type === 'ruins' && t.poi.repaired) add({ gold: 1 });
    if (t.type === 'home') add({ gold: HOME_LEVELS[t.level].gold });
    return out;
  }

  hasPerk(p, id) {
    return !!p.perks?.includes(id);
  }

  cropCost(p, cropType) {
    const cost = { ...CROPS[cropType].cost };
    if (this.hasPerk(p, 'seeds') && cost.grain) cost.grain--;
    return cost;
  }

  // Everything a player needs to understand their economy right now
  economy(pid) {
    const p = this.players[pid];
    const income = {};
    const sources = new Map();
    const addSrc = (label, obj) => {
      const cur = sources.get(label) || { label, n: 0, gives: {} };
      cur.n++;
      for (const [r, n] of Object.entries(obj)) {
        if (!n) continue;
        cur.gives[r] = (cur.gives[r] || 0) + n;
        income[r] = (income[r] || 0) + n;
      }
      sources.set(label, cur);
    };
    const crops = [];
    for (const t of this.owned(pid)) {
      if (this.isBandit(t)) continue;
      const base = TILE_TYPES[t.type].prod;
      if (Object.keys(base).length) addSrc(TILE_TYPES[t.type].name, base);
      if (t.building) {
        const b = BUILDINGS[t.building];
        const prod = { ...b.prod };
        if (t.upgraded) for (const [r, n] of Object.entries(BUILDING_UPGRADES[t.building].prod)) prod[r] = (prod[r] || 0) + n;
        if (Object.keys(prod).length) addSrc(t.upgraded ? BUILDING_UPGRADES[t.building].name : b.name, prod);
      }
      const main = Object.keys(base)[0];
      if (main && neighborKeys(t.key).filter((n) => this.tiles.get(n)?.type === t.type).length >= 2) addSrc('Cluster bonus', { [main]: 1 });
      if (t.poi?.type === 'ruins' && t.poi.repaired) addSrc('Restored ruins', { gold: 1 });
      if (t.type === 'home' && HOME_LEVELS[t.level].gold) addSrc(HOME_LEVELS[t.level].name, { gold: HOME_LEVELS[t.level].gold });
      if (t.crop) {
        const c = CROPS[t.crop.type];
        const grow = this.growTime(t);
        const y = { ...c.yield };
        const main2 = Object.keys(c.yield)[0];
        y[main2] += (t.building === 'barn' ? 2 + (t.upgraded ? 1 : 0) : 0) + (this.millBoost(t) ? 2 : 0);
        crops.push({ key: t.key, name: c.name, left: Math.max(0, grow - t.crop.progress), yield: y });
      }
    }
    const value = TRADE_RES.reduce((s, r) => s + p.res[r] * this.sellPrice(pid, r), 0) + p.res.gold;
    const bandits = this.banditsNear(pid);
    const block = Math.min(0.85, p.guards * 0.2 + (this.hasPerk(p, 'watchtower') ? 0.15 : 0));
    return {
      income, crops: crops.sort((a, b) => a.left - b.left), value,
      sources: [...sources.values()].sort((a, b) => b.n - a.n),
      bandits: bandits.length, block, history: p.history || [],
    };
  }

  canAfford(p, cost) {
    return Object.entries(cost).every(([r, n]) => p.res[r] >= n);
  }

  pay(p, cost) {
    for (const [r, n] of Object.entries(cost)) p.res[r] -= n;
  }

  gain(p, obj) {
    for (const [r, n] of Object.entries(obj)) p.res[r] = (p.res[r] || 0) + n;
  }

  get lastRound() {
    return ROUNDS_PER_YEAR * 2;
  }

  leader() {
    return [...this.players].sort((a, b) => b.prosp - a.prosp)[0];
  }

  // ---------- quests: grow a connected area of one terrain to a target size ----------
  cluster(k) {
    const start = this.tiles.get(k);
    if (!start) return new Set();
    const seen = new Set([k]);
    const stack = [k];
    while (stack.length) {
      const cur = stack.pop();
      for (const n of neighborKeys(cur)) {
        const t = this.tiles.get(n);
        if (!seen.has(n) && t && t.type === start.type && t.owner === start.owner) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen;
  }

  questProgress(q) {
    return this.cluster(q.key).size;
  }

  maybeCreateQuest(t, p) {
    if (!QUEST_TYPES.includes(t.type) || t.owner !== p.id) return null;
    const active = this.quests.filter((q) => q.pid === p.id && !q.done);
    if (active.length >= 2 || active.some((q) => this.cluster(q.key).has(t.key))) return null;
    if (Math.random() > 0.35) return null;
    const size = this.cluster(t.key).size;
    const q = { id: ++this.questSeq, key: t.key, pid: p.id, type: t.type, target: size + 3 + rand(3), done: false };
    this.quests.push(q);
    this.log(`🚩 New goal for ${p.name}: grow this ${TILE_TYPES[t.type].name.toLowerCase()} to ${q.target} tiles.`, p.id);
    return q;
  }

  checkQuests(pid) {
    const done = [];
    for (const q of this.quests) {
      if (q.done || q.pid !== pid) continue;
      if (this.questProgress(q) >= q.target) {
        q.done = true;
        const p = this.players[pid];
        const main = Object.keys(TILE_TYPES[q.type].prod)[0] || 'grain';
        const reward = { [main]: 3 };
        p.prosp += 6;
        p.bonusTiles++;
        this.gain(p, reward);
        this.log(`🚩 ${p.name} completes a goal: +6 prosperity, ${costText(reward)} and a bonus tile.`, pid);
        this.emit('float', q.key, 'Goal complete!');
        done.push(q);
      }
    }
    if (done.length) this.emit('quests');
    return done;
  }

  // ---------- round flow ----------
  startRound() {
    this.round++;
    const newSeason = (this.round - 1) % ROUNDS_PER_SEASON === 0;
    const start = (this.round - 1) % this.players.length;
    this.order = this.players.map((_, i) => (start + i) % this.players.length);
    for (const p of this.players) {
      p.offer = this.drawOffer(this.hasPerk(p, 'surveyor') ? 4 : 3);
      p.freeExplore = (p.bonus === 'explorer' ? 1 : 0) + (this.hasPerk(p, 'maproom') ? 1 : 0);
    }
    let raid = null;
    this.ensureRequests();
    if (newSeason && this.round > 1 && Math.random() < (this.year === 1 ? 0.5 : 0.9)) raid = this.spawnRaid();
    this.emit('state');
    return { newSeason, raid };
  }

  drawOffer(n = 3) {
    const out = [];
    while (out.length < n) {
      const total = PLACEABLE.reduce((s, t) => s + TILE_TYPES[t].weight, 0);
      let x = Math.random() * total;
      for (const t of PLACEABLE) {
        x -= TILE_TYPES[t].weight;
        if (x <= 0) {
          if (!out.includes(t)) out.push(t);
          break;
        }
      }
    }
    return out;
  }

  // Haven keeps two open orders; they grow in the second year
  ensureRequests() {
    while (this.requests.length < 2) {
      const taken = this.requests.map((q) => q.res);
      const res = pick(TRADE_RES.filter((r) => !taken.includes(r)));
      const amount = (this.year === 1 ? 4 : 7) + rand(4);
      const q = { res, amount, gold: amount * MARKET_BASE[res] + 2, prosp: this.year === 1 ? 4 : 7 };
      this.requests.push(q);
    }
  }

  spawnRaid() {
    const richest = [...this.players].sort((a, b) => b.prosp - a.prosp)[0];
    const own = this.owned(richest.id);
    const cands = [...this.frontier()].filter((k) =>
      own.some((t) => dist(t.key, k) <= 2) && dist(k, richest.home) >= 2);
    if (!cands.length) return null;
    const k = pick(cands);
    const t = this.addTile(k, pick(['forest', 'mountain', 'meadow']), null);
    t.poi = { type: 'bandits', strength: 2 + this.year + (richest.prosp > 60 ? 1 : 0) };
    this.secrets.delete(k);
    this.revealed.delete(k);
    this.log(`Raiders have set up camp near ${richest.name} (strength ${t.poi.strength}).`);
    this.emit('tilePlaced', t, { raid: true });
    return t;
  }

  // ---------- world phase ----------
  worldPhase() {
    const season = this.season;
    const report = this.players.map(() => ({}));
    const addRep = (pid, obj) => {
      for (const [r, n] of Object.entries(obj)) report[pid][r] = (report[pid][r] || 0) + n;
    };

    for (const t of this.tiles.values()) {
      if (!t.crop || t.owner == null || this.isBandit(t)) continue;
      if (season !== 3) t.crop.progress++;
      if (t.crop.progress >= this.growTime(t)) {
        const c = CROPS[t.crop.type];
        const y = { ...c.yield };
        const main = Object.keys(c.yield)[0];
        y[main] += (t.building === 'barn' ? 2 + (t.upgraded ? 1 : 0) : 0) + (this.millBoost(t) ? 2 : 0) + (season === 2 ? 1 : 0);
        const p = this.players[t.owner];
        this.gain(p, y);
        addRep(p.id, y);
        p.prosp += c.prosp;
        this.log(`🧺 ${p.name} harvests ${c.name.toLowerCase()}: ${costText(y)}`, p.id);
        this.emit('float', t.key, `🧺 ${costText(y)}`);
        t.crop = null;
      }
      this.emit('tileChanged', t);
    }

    for (const t of this.tiles.values()) {
      const prod = this.production(t);
      if (!Object.keys(prod).length) continue;
      const p = this.players[t.owner];
      this.gain(p, prod);
      addRep(p.id, prod);
      this.emit('float', t.key, `+${costText(prod)}`);
    }

    for (const t of this.tiles.values()) {
      if (!this.isBandit(t)) continue;
      const victims = new Set(neighborKeys(t.key).map((n) => this.tiles.get(n)?.owner).filter((o) => o != null));
      for (const pid of victims) {
        const p = this.players[pid];
        const tower = this.hasPerk(p, 'watchtower');
        if (Math.random() < Math.min(0.85, p.guards * 0.2 + (tower ? 0.15 : 0))) {
          this.log(`🛡️ ${p.name}'s guards keep the bandits out.`, pid);
          continue;
        }
        const n = t.poi.strength >= 4 && !tower ? 2 : 1;
        const stolen = {};
        for (let i = 0; i < n; i++) {
          const opts = RES.filter((r) => p.res[r] > 0);
          if (!opts.length) break;
          const r = pick(opts);
          p.res[r]--;
          stolen[r] = (stolen[r] || 0) + 1;
        }
        if (Object.keys(stolen).length) {
          this.log(`☠️ Bandits steal ${costText(stolen)} from ${p.name}.`, pid);
          this.emit('float', t.key, `☠️ -${costText(stolen)}`);
        }
      }
    }

    let fair = null;
    if (this.round % ROUNDS_PER_YEAR === 0) {
      const ranked = [...this.players].filter((p) => p.delivered > 0).sort((a, b) => b.delivered - a.delivered);
      fair = ranked.slice(0, 2).map((p, i) => ({ p, prize: i === 0 ? 10 : 5 }));
      for (const { p, prize } of fair) {
        p.prosp += prize;
        this.log(`Harvest fair: ${p.name} filled ${p.delivered} orders this year and earns ${prize} prosperity.`, p.id);
      }
      for (const p of this.players) p.delivered = 0;
    }

    for (const [r, m] of Object.entries(this.market)) {
      const base = MARKET_BASE[r] + (season === 1 && r === 'wool' ? 1 : 0) + (season === 3 && r === 'veg' ? 1 : 0);
      m.p += (base - m.p) * 0.35 + (Math.random() - 0.5) * 0.5;
      m.p = Math.max(1, Math.min(base * 2.5, m.p));
    }
    report.forEach((rep, i) => {
      const p = this.players[i];
      const worth = Object.entries(rep).reduce((s, [r, n]) => s + n * (r === 'gold' ? 1 : MARKET_BASE[r]), 0);
      p.history = [...(p.history || []), { round: this.round, worth, res: rep }].slice(-12);
    });
    this.emit('state');
    report.fair = fair;
    return report;
  }

  // Prosperity decides; gold only breaks ties
  finalScores() {
    return this.players
      .map((p) => ({ p, score: p.prosp }))
      .sort((a, b) => b.score - a.score || b.p.res.gold - a.p.res.gold);
  }

  tilePrice(pid) {
    return 10 + 6 * (this.players[pid].tilesBought || 0);
  }

  // Gold sink: buy an extra tile for the next placement phase (once per round)
  buyTile(pid) {
    const p = this.players[pid];
    const price = this.tilePrice(pid);
    if (p.boughtRound === this.round || p.res.gold < price) return false;
    p.res.gold -= price;
    p.tilesBought = (p.tilesBought || 0) + 1;
    p.boughtRound = this.round;
    p.bonusTiles++;
    this.log(`🪙 ${p.name} buys an extra tile for ${price}🪙.`, pid);
    this.emit('state');
    return true;
  }

  // What placing `type` at `k` would do, so the UI can show how tiles support each other
  placementPreview(pid, type, k) {
    const nbs = neighborKeys(k).map((n) => this.tiles.get(n)).filter(Boolean);
    const same = nbs.filter((t) => t.type === type);
    const gain = 1 + Math.min(same.length, 3);
    const links = same.map((t) => ({ key: t.key, kind: 'match' }));
    const notes = [];
    const main = Object.keys(TILE_TYPES[type].prod)[0];
    if (main && same.length >= 2) notes.push({ icon: main, text: `cluster: +1 ${RES_INFO[main].name.toLowerCase()} here` });
    if (main) {
      // neighbours that reach the cluster bonus thanks to this tile
      const boosted = same.filter((t) => t.owner === pid
        && neighborKeys(t.key).filter((n) => this.tiles.get(n)?.type === type).length === 1).length;
      if (boosted) notes.push({ icon: main, text: `${boosted} neighbour${boosted > 1 ? 's' : ''} +1 ${RES_INFO[main].name.toLowerCase()}` });
    }
    if (type === 'field') {
      const lakes = nbs.filter((t) => t.type === 'lake');
      if (lakes.length) {
        notes.push({ icon: 'plant', text: 'watered: crops grow a round faster' });
        lakes.forEach((t) => links.push({ key: t.key, kind: 'water' }));
      }
    }
    if (type === 'lake') {
      const fields = nbs.filter((t) => t.type === 'field' && t.owner === pid && !this.irrigated(t));
      if (fields.length) {
        notes.push({ icon: 'plant', text: `waters ${fields.length} field${fields.length > 1 ? 's' : ''}` });
        fields.forEach((t) => links.push({ key: t.key, kind: 'water' }));
      }
    }
    for (const q of this.quests) {
      if (q.done || q.pid !== pid || q.type !== type) continue;
      const cl = this.cluster(q.key);
      if (neighborKeys(k).some((n) => cl.has(n))) notes.push({ icon: 'flag', text: `goal ${Math.min(q.target, cl.size + 1)} / ${q.target}` });
    }
    const sec = this.revealed.has(k) ? this.secrets.get(k) : null;
    if (sec) notes.push({ icon: { ruins: 'ruins', mill: 'mill', treasure: 'treasure', bandits: 'skull' }[sec], text: POIS[sec].name });
    return { gain, links, notes };
  }

  // ---------- placement ----------
  placeTile(pid, type, k) {
    const p = this.players[pid];
    const t = this.addTile(k, type, pid);
    const same = neighborKeys(k).filter((n) => this.tiles.get(n)?.type === type).length;
    const gain = 1 + Math.min(same, 3);
    p.prosp += gain;
    const secret = this.secrets.get(k);
    this.secrets.delete(k);
    this.revealed.delete(k);
    let msg = `${p.name} places ${TILE_TYPES[type].name.toLowerCase()}${same ? ` (${same} matching)` : ''}.`;
    if (secret === 'bandits') {
      t.owner = null;
      t.poi = { type: 'bandits', strength: 2 + rand(2) + (this.round > 6 ? 1 : 0) };
      msg += ` ☠️ A bandit camp! (strength ${t.poi.strength})`;
    } else if (secret === 'treasure') {
      p.res.gold += 4;
      msg += ' 💰 Hidden treasure: +4 gold!';
      this.emit('float', k, '💰 +4🪙');
    } else if (secret) {
      t.poi = { type: secret, repaired: false };
      msg += ` ${POIS[secret].icon} Found: ${POIS[secret].name.toLowerCase()}.`;
    }
    this.log(msg, pid);
    this.emit('tilePlaced', t);
    if (t.owner === pid) this.maybeCreateQuest(t, p);
    this.checkQuests(pid);
    this.emit('quests');
    this.emit('state');
    return { tile: t, gain, secret };
  }

  // ---------- actions (cost 1 action unless noted) ----------
  _check(p, cond, msg) {
    if (!cond) throw new Error(msg);
  }

  _act(pid, fn) {
    const p = this.players[pid];
    try {
      const res = fn(p);
      this.emit('state');
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }

  plant(pid, k, crop) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const c = CROPS[crop];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && t.type === 'field' && !t.crop, 'You can’t plant here.');
      const cost = this.cropCost(p, crop);
      this._check(p, this.canAfford(p, cost), 'Not enough resources.');
      this.pay(p, cost);
      t.crop = { type: crop, progress: 0 };
      p.actionsLeft--;
      const g = this.growTime(t);
      this.log(`🌱 ${p.name} plants ${c.name.toLowerCase()} (${g} round${g === 1 ? '' : 's'}).`, pid);
      this.emit('tileChanged', t);
    });
  }

  build(pid, k, bid) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const b = BUILDINGS[bid];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && t.type === b.on && !t.building, 'You can’t build that here.');
      this._check(p, this.canAfford(p, b.cost), 'Not enough resources.');
      this.pay(p, b.cost);
      t.building = bid;
      p.prosp += b.prosp;
      p.actionsLeft--;
      this.log(`🔨 ${p.name} builds a ${b.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  }

  upgradeBuilding(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const up = t?.building && BUILDING_UPGRADES[t.building];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && up && !t.upgraded, 'Nothing to improve here.');
      this._check(p, this.canAfford(p, up.cost), 'Not enough resources.');
      this.pay(p, up.cost);
      t.upgraded = true;
      p.prosp += up.prosp;
      p.actionsLeft--;
      this.log(`🔨 ${p.name} improves a building into a ${up.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  }

  perkAvailable(p, id) {
    return !this.hasPerk(p, id) && this.homeTile(p.id).level >= PERKS[id].level;
  }

  buyPerk(pid, id) {
    return this._act(pid, (p) => {
      const perk = PERKS[id];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, perk && !this.hasPerk(p, id), 'You already have that.');
      this._check(p, this.homeTile(pid).level >= perk.level, 'Your farm needs to grow first.');
      this._check(p, this.canAfford(p, perk.cost), 'Not enough resources.');
      this.pay(p, perk.cost);
      p.perks = [...(p.perks || []), id];
      p.prosp += perk.prosp;
      p.actionsLeft--;
      if (id === 'maproom') p.freeExplore++;
      this.log(`🏡 ${p.name} builds a ${perk.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', this.homeTile(pid), { built: true });
    });
  }

  repair(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const poi = t?.poi && POIS[t.poi.type];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && poi?.repair && !t.poi.repaired, 'Nothing to restore.');
      this._check(p, this.canAfford(p, poi.repair), 'Not enough resources.');
      this.pay(p, poi.repair);
      t.poi.repaired = true;
      p.prosp += poi.prosp;
      p.actionsLeft--;
      this.log(`${p.name} restores the ${poi.name.toLowerCase()}: +${poi.prosp} prosperity.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  }

  explore(pid, k) {
    return this._act(pid, (p) => {
      this._check(p, p.freeExplore || p.actionsLeft > 0, 'No actions left.');
      this._check(p, this.explorable(pid).includes(k), 'You can’t scout there.');
      if (p.freeExplore) p.freeExplore--;
      else p.actionsLeft--;
      this.revealed.add(k);
      const secret = this.secrets.get(k);
      if (secret) p.prosp += 1;
      this.log(`🧭 ${p.name} scouts: ${secret ? `${POIS[secret].icon} ${POIS[secret].name.toLowerCase()}` : 'nothing there'}.`, pid);
      this.emit('revealed', k);
      return { secret };
    });
  }

  recruit(pid) {
    return this._act(pid, (p) => {
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, p.guards < MAX_GUARDS, 'You have the maximum number of guards.');
      this._check(p, this.canAfford(p, GUARD_COST), 'Not enough resources.');
      this.pay(p, GUARD_COST);
      p.guards++;
      p.actionsLeft--;
      this.log(`🛡️ ${p.name} hires a guard (${p.guards}).`, pid);
      this.emit('tileChanged', this.homeTile(pid));
    });
  }

  upgradeHome(pid) {
    return this._act(pid, (p) => {
      const t = this.homeTile(pid);
      const next = HOME_LEVELS[t.level + 1];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, next, 'Already fully grown.');
      this._check(p, this.canAfford(p, next.cost), 'Not enough resources.');
      this.pay(p, next.cost);
      t.level++;
      p.prosp += next.prosp;
      p.actionsLeft--;
      this.log(`🏡 ${p.name}'s farm grows into a ${next.name.toLowerCase()}: +${next.prosp} prosperity.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  }

  winChance(guards, strength) {
    let win = 0;
    for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (guards + a >= strength + d) win++;
    return win / 36;
  }

  challenge(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, this.isBandit(t) && this.banditsNear(pid).includes(t), 'No bandits next to your land.');
      this._check(p, p.guards > 0, 'You need guards.');
      p.actionsLeft--;
      const a = 1 + rand(6);
      const d = 1 + rand(6);
      const atk = p.guards + a;
      const def = t.poi.strength + d;
      if (atk >= def) {
        t.poi = null;
        t.owner = pid;
        p.res.gold += 3;
        p.prosp += 4;
        this.log(`⚔️ ${p.name} drives out the bandits (${atk} vs ${def}): +3🪙 +4 prosperity.`, pid);
        this.emit('tileChanged', t, { built: true });
        this.emit('float', k, '⚔️ Overwinning!');
        return { won: true };
      }
      p.guards--;
      this.log(`${p.name} loses the fight (${atk} vs ${def}) and a guard.`, pid);
      this.emit('tileChanged', this.homeTile(pid));
      this.emit('float', k, '💥 Verloren');
      return { won: false };
    });
  }

  // ---------- free actions ----------
  sellPrice(pid, r) {
    const fee = this.connected(pid) || this.hasPerk(this.players[pid], 'cart') ? 0 : 1;
    return Math.max(1, Math.round(this.market[r].p) - fee);
  }

  buyPrice(r, pid = null) {
    const guild = pid != null && this.hasPerk(this.players[pid], 'guild') ? 1 : 0;
    return Math.round(this.market[r].p) + 2 - guild;
  }

  sell(pid, r, n = 1) {
    const p = this.players[pid];
    let got = 0;
    for (let i = 0; i < n && p.res[r] > 0; i++) {
      const price = this.sellPrice(pid, r);
      p.res[r]--;
      p.res.gold += price;
      got += price;
      this.market[r].p = Math.max(1, this.market[r].p - 0.5);
    }
    if (got) this.log(`🏪 ${p.name} sells ${n}${RES_INFO[r].icon} for ${got}🪙.`, pid);
    this.emit('state');
    return got;
  }

  buy(pid, r, n = 1) {
    const p = this.players[pid];
    let bought = 0;
    for (let i = 0; i < n; i++) {
      const price = this.buyPrice(r, pid);
      if (p.res.gold < price) break;
      p.res.gold -= price;
      p.res[r]++;
      bought++;
      this.market[r].p += 0.35;
    }
    if (bought) this.log(`🏪 ${p.name} buys ${bought}${RES_INFO[r].icon}.`, pid);
    this.emit('state');
    return bought;
  }

  fulfillRequest(pid, idx = 0) {
    const p = this.players[pid];
    const q = this.requests[idx];
    if (!q || p.res[q.res] < q.amount) return false;
    p.res[q.res] -= q.amount;
    p.res.gold += q.gold;
    p.prosp += q.prosp;
    p.delivered++;
    this.requests.splice(idx, 1);
    this.log(`📜 ${p.name} fills an order for Haven: +${q.gold}🪙 +${q.prosp} prosperity.`, pid);
    this.emit('state');
    return true;
  }

  // a gives giveA to b, b gives giveB to a
  trade(aId, bId, giveA, giveB) {
    const a = this.players[aId];
    const b = this.players[bId];
    if (!this.canAfford(a, giveA) || !this.canAfford(b, giveB)) return false;
    this.pay(a, giveA);
    this.gain(b, giveA);
    this.pay(b, giveB);
    this.gain(a, giveB);
    this.log(`🤝 ${a.name} trades ${costText(giveA)} with ${b.name} for ${costText(giveB)}.`);
    this.emit('state');
    return true;
  }
}
