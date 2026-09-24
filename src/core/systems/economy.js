// Resources, production, the Haven market, Haven orders and trading between players.
// Mixed into Game.prototype (see ../game.js), so `this` is the game.
import {
  TRADE_RES, RES_INFO, TILE_TYPES, BUILDINGS, CROPS, HOME_LEVELS, BUILDING_UPGRADES,
  MARKET_BASE, costText,
} from '../data.js';
import { neighborKeys } from '../hex.js';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

export const Economy = {
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
  },

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
  },

  canAfford(p, cost) {
    return Object.entries(cost).every(([r, n]) => p.res[r] >= n);
  },

  pay(p, cost) {
    for (const [r, n] of Object.entries(cost)) p.res[r] -= n;
  },

  gain(p, obj) {
    for (const [r, n] of Object.entries(obj)) p.res[r] = (p.res[r] || 0) + n;
  },

  // ---------- free actions ----------
  sellPrice(pid, r) {
    const fee = this.connected(pid) || this.hasPerk(this.players[pid], 'cart') ? 0 : 1;
    return Math.max(1, Math.round(this.market[r].p) - fee);
  },

  buyPrice(r, pid = null) {
    const guild = pid != null && this.hasPerk(this.players[pid], 'guild') ? 1 : 0;
    return Math.round(this.market[r].p) + 2 - guild;
  },

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
  },

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
  },

  // Haven keeps two open orders; they grow in the second year
  ensureRequests() {
    while (this.requests.length < 2) {
      const taken = this.requests.map((q) => q.res);
      const res = pick(TRADE_RES.filter((r) => !taken.includes(r)));
      const amount = (this.year === 1 ? 4 : 7) + rand(4);
      const q = { res, amount, gold: amount * MARKET_BASE[res] + 2, prosp: this.year === 1 ? 4 : 7 };
      this.requests.push(q);
    }
  },

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
  },

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
  },
};
