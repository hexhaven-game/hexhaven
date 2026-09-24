import {
  TRADE_RES, TILE_TYPES, BUILDINGS, CROPS, HOME_LEVELS, POIS, GUARD_COST, PERSONALITIES, BUILDING_UPGRADES, PERKS,
} from './data.js';
import { neighborKeys, dist, distOrigin } from './hex.js';

const pers = (p) => PERSONALITIES[p.kind];

export function goals(g, p) {
  const list = [];
  const home = g.homeTile(p.id);
  if (home.level < HOME_LEVELS.length - 1) {
    const L = HOME_LEVELS[home.level + 1];
    list.push({ kind: 'upgrade', cost: L.cost, score: 5 + (g.round > 4 ? 1.5 : 0) });
  }
  const counts = {};
  for (const t of g.owned(p.id)) if (t.building) counts[t.building] = (counts[t.building] || 0) + 1;
  const seen = new Set();
  for (const t of g.owned(p.id)) {
    const bid = Object.keys(BUILDINGS).find((b) => BUILDINGS[b].on === t.type);
    if (bid && !t.building && !seen.has(bid)) {
      seen.add(bid);
      list.push({
        kind: 'build', key: t.key, bid, cost: BUILDINGS[bid].cost,
        score: 3.5 + (pers(p).tiles[t.type] || 1) - (counts[bid] || 0) * 0.8,
      });
    }
    if (t.poi && POIS[t.poi.type].repair && !t.poi.repaired) {
      list.push({ kind: 'repair', key: t.key, cost: POIS[t.poi.type].repair, score: 6 });
    }
  }
  if (g.banditsNear(p.id).length && p.guards < 3) list.push({ kind: 'guard', cost: GUARD_COST, score: 5.5 });
  const improvable = g.owned(p.id).find((t) => t.building && !t.upgraded);
  if (improvable) {
    list.push({ kind: 'improve', key: improvable.key, cost: BUILDING_UPGRADES[improvable.building].cost, score: 3.2 });
  }
  // personality flavours which perk it chases first
  const pref = { farmer: ['seeds', 'cart', 'watchtower'], merchant: ['cart', 'guild', 'surveyor'], explorer: ['maproom', 'surveyor', 'cart'] }[p.kind] || [];
  for (const id of Object.keys(PERKS)) {
    if (!g.perkAvailable(p, id)) continue;
    const rank = pref.indexOf(id);
    list.push({ kind: 'perk', perk: id, cost: PERKS[id].cost, score: 3 + (rank >= 0 ? 1.5 - rank * 0.5 : 0) });
  }
  return list.sort((a, b) => b.score - a.score);
}

export function needs(g, p) {
  const need = {};
  for (const goal of goals(g, p).slice(0, 2)) {
    for (const [r, n] of Object.entries(goal.cost)) {
      const miss = n - p.res[r];
      if (miss > 0) need[r] = (need[r] || 0) + miss;
    }
  }
  return need;
}

function execGoal(g, p, goal) {
  switch (goal.kind) {
    case 'upgrade': return g.upgradeHome(p.id);
    case 'build': return g.build(p.id, goal.key, goal.bid);
    case 'repair': return g.repair(p.id, goal.key);
    case 'guard': return g.recruit(p.id);
    case 'improve': return g.upgradeBuilding(p.id, goal.key);
    case 'perk': return g.buyPerk(p.id, goal.perk);
  }
}

export function choosePlacement(g, p) {
  const valid = g.validPlacements(p.id);
  const need = needs(g, p);
  const P = pers(p);
  const connected = g.connected(p.id);
  const frontier = g.frontier();
  const quests = g.quests.filter((q) => q.pid === p.id && !q.done).map((q) => ({ ...q, cells: g.cluster(q.key) }));
  let best = null;
  for (const type of p.offer) {
    const main = Object.keys(TILE_TYPES[type].prod)[0];
    for (const k of valid) {
      const nbs = neighborKeys(k).map((n) => g.tiles.get(n));
      let s = P.tiles[type] || 1;
      s += 1.2 * Math.min(3, nbs.filter((t) => t?.type === type).length);
      if (type === 'field' && nbs.some((t) => t?.type === 'lake')) s += 1.2;
      if (type === 'lake') s += 0.8 * nbs.filter((t) => t?.type === 'field' && t.owner === p.id).length;
      if (main && need[main]) s += 1.5;
      if (g.revealed.has(k)) {
        const sec = g.secrets.get(k);
        s += { bandits: -6, treasure: 3, ruins: 2.5, mill: 2 }[sec] ?? 0;
      }
      if (nbs.some((t) => g.isBandit(t))) s -= 1;
      for (const q of quests) {
        if (q.type === type && neighborKeys(k).some((n) => q.cells.has(n))) s += 2.5;
      }
      if (P.explore > 1) {
        s += 0.3 * neighborKeys(k).filter((n) => frontier.has(n) || !g.tiles.has(n)).length;
        s += 0.15 * dist(k, p.home);
      }
      if (!connected) s += (5 - distOrigin(k)) * 0.35;
      s += Math.random() * 0.8;
      if (!best || s > best.s) best = { s, type, key: k };
    }
  }
  return best;
}

function chooseCrop(g, p, t) {
  const need = needs(g, p);
  const left = g.growRoundsLeft();
  let best = null;
  for (const [id, c] of Object.entries(CROPS)) {
    if (!g.canAfford(p, g.cropCost(p, id))) continue;
    const grow = g.growTime(t, id);
    if (grow > left) continue;
    let v = 0;
    for (const [r, n] of Object.entries(c.yield)) v += n * (r === 'gold' ? 1 : g.market[r].p) * (need[r] ? 1.5 : 1);
    v = (v + c.prosp * 2) / grow;
    if (p.kind === 'farmer' && id === 'pumpkin') v *= 1.3;
    if (!best || v > best.v) best = { v, id };
  }
  return best?.id;
}

// Performs one AI decision. Returns a short description, or null when the turn is done.
export function aiStep(g, p, st) {
  const P = pers(p);

  const ri = g.requests.findIndex((q) => p.res[q.res] >= q.amount);
  if (ri >= 0 && (st.req || 0) < 2) {
    st.req = (st.req || 0) + 1;
    g.fulfillRequest(p.id, ri);
    return 'request';
  }

  if (!st.sold) {
    st.sold = true;
    const need = needs(g, p);
    const keep = p.kind === 'merchant' ? 3 : 5;
    let sold = false;
    const ordered = new Set(g.requests.map((q) => q.res));
    for (const r of TRADE_RES) {
      const surplus = p.res[r] - keep;
      if (surplus > 0 && !need[r] && !ordered.has(r)) {
        g.sell(p.id, r, surplus);
        sold = true;
      }
    }
    if (sold) return 'sell';
  }

  if (!st.tile && p.res.gold >= g.tilePrice(p.id) + 6) {
    st.tile = true;
    if (g.buyTile(p.id)) return 'buy-tile';
  }

  const explorable = g.explorable(p.id);
  if (p.freeExplore && explorable.length) {
    g.explore(p.id, explorable[Math.floor(Math.random() * explorable.length)]);
    return 'explore';
  }

  if (p.actionsLeft <= 0) return null;

  for (const t of g.banditsNear(p.id)) {
    if (p.guards > 0 && g.winChance(p.guards, t.poi.strength) >= 0.55) {
      g.challenge(p.id, t.key);
      return 'challenge';
    }
  }

  const gl = goals(g, p);
  for (const goal of gl) {
    if (g.canAfford(p, goal.cost)) {
      if (execGoal(g, p, goal).ok) return goal.kind;
    }
  }

  if (!st.bought && gl.length) {
    st.bought = true;
    const top = gl[0];
    const missing = Object.entries(top.cost)
      .map(([r, n]) => [r, n - p.res[r]])
      .filter(([, n]) => n > 0);
    const price = missing.reduce((s, [r, n]) => s + (r === 'gold' ? 999 : g.buyPrice(r, p.id) * n), 0);
    const count = missing.reduce((s, [, n]) => s + n, 0);
    if (count <= 5 && price <= p.res.gold - (top.cost.gold || 0)) {
      for (const [r, n] of missing) g.buy(p.id, r, n);
      if (g.canAfford(p, top.cost) && execGoal(g, p, top).ok) return top.kind;
    }
  }

  const empty = g.owned(p.id).find((t) => t.type === 'field' && !t.crop);
  if (empty) {
    const crop = chooseCrop(g, p, empty);
    if (crop && g.plant(p.id, empty.key, crop).ok) return 'plant';
  }

  if (explorable.length && (P.explore > 1 || Math.random() < P.explore + 0.3)) {
    const k = explorable.sort((a, b) => dist(a, p.home) - dist(b, p.home))[0];
    g.explore(p.id, k);
    return 'explore';
  }

  return null;
}

// ---------- trading ----------
function valueOf(g, p, r, need) {
  if (r === 'gold') return 1;
  const have = p.res[r];
  let m = 1;
  if (need[r]) m = 1.7;
  else if (have >= 6) m = 0.6;
  else if (have >= 3) m = 0.85;
  return g.market[r].p * m;
}

const bundleValue = (g, p, b, need) =>
  Object.entries(b).reduce((s, [r, n]) => s + n * valueOf(g, p, r, need), 0);

const count = (b) => Object.values(b).reduce((s, n) => s + n, 0);

const LINES = {
  accept: ['Deal.', 'Fair enough.', 'I can live with that.', 'Sounds good.'],
  counter: ['Not quite enough.', 'Close. Add a little.', 'Sweeten it a bit.', 'That’s worth more to me.'],
  decline: ['No thanks.', 'Not interested.', 'I’ll pass.'],
};
const line = (k) => LINES[k][Math.floor(Math.random() * LINES[k].length)];

// human offers `gives`, wants `wants` from ai
export function respondToOffer(g, ai, human, gives, wants) {
  if (!g.canAfford(ai, wants)) return { kind: 'decline', text: 'I don’t have that.' };
  const need = needs(g, ai);
  const margin = pers(ai).margin;
  const vIn = bundleValue(g, ai, gives, need);
  const vOut = bundleValue(g, ai, wants, need);
  if (vIn >= vOut * margin) return { kind: 'accept', text: line('accept'), gives, wants };
  const extra = Math.ceil(vOut * margin - vIn);
  const goldLeft = human.res.gold - (gives.gold || 0);
  if (extra <= 4 && goldLeft >= extra) {
    return { kind: 'counter', text: line('counter'), gives: { ...gives, gold: (gives.gold || 0) + extra }, wants };
  }
  if (count(wants) > 1) {
    const reduced = { ...wants };
    const biggest = Object.keys(reduced).sort((a, b) => reduced[b] - reduced[a])[0];
    reduced[biggest]--;
    if (!reduced[biggest]) delete reduced[biggest];
    if (vIn >= bundleValue(g, ai, reduced, need) * margin) {
      return { kind: 'counter', text: 'I can’t spare that much.', gives, wants: reduced };
    }
  }
  return { kind: 'decline', text: line('decline') };
}

// AI proposes a trade to another player (typically the human). Returns {aiGives, aiWants, text} or null
export function proposeTrade(g, ai, other) {
  const need = needs(g, ai);
  const wanted = Object.keys(need).filter((r) => r !== 'gold' && other.res[r] > 0);
  if (!wanted.length) return null;
  const r = wanted[Math.floor(Math.random() * wanted.length)];
  const amount = Math.min(need[r], other.res[r], 3);
  const worth = amount * g.market[r].p;
  const offers = TRADE_RES
    .filter((s) => s !== r && !need[s] && ai.res[s] > 0)
    .sort((a, b) => ai.res[b] - ai.res[a]);
  for (const s of offers) {
    const n = Math.max(1, Math.round(worth / g.market[s].p));
    if (ai.res[s] >= n) return { aiGives: { [s]: n }, aiWants: { [r]: amount } };
  }
  const gold = Math.ceil(worth);
  if (ai.res.gold - gold >= 2) return { aiGives: { gold }, aiWants: { [r]: amount } };
  return null;
}

