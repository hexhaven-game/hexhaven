import { RES, CROPS, ROUNDS_PER_SEASON, ROUNDS_PER_YEAR, MARKET_BASE, costText } from './data.js';
import { neighborKeys, dist, distOrigin, allCells } from './hex.js';
import { Economy } from './systems/economy.js';
import { Quests } from './systems/quests.js';
import { Placement } from './systems/placement.js';
import { Actions } from './systems/actions.js';
import { Combat } from './systems/combat.js';

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

// The game state and the round flow. The rules for each part of the game live in ./systems/
// and are mixed into the prototype below, so everything is still called as game.method().
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

  hasPerk(p, id) {
    return !!p.perks?.includes(id);
  }

  cropCost(p, cropType) {
    const cost = { ...CROPS[cropType].cost };
    if (this.hasPerk(p, 'seeds') && cost.grain) cost.grain--;
    return cost;
  }

  get lastRound() {
    return ROUNDS_PER_YEAR * 2;
  }

  leader() {
    return [...this.players].sort((a, b) => b.prosp - a.prosp)[0];
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
}

Object.assign(Game.prototype, Economy, Quests, Placement, Actions, Combat);
